// Las lecturas de Facturas de Express: la lista, el detalle, el estado, las estadísticas ligeras, los avisos y el recibo como datos. Son las mismas
// peticiones que hacen los servicios de la app completa (api/facturas.ts y api/stats.ts), escritas aquí sobre `getList`, `getJson` y `qs` de http.ts
// porque api/facturas.ts trae zod (el esquema de emisión) y zod no puede estar en el primer pintado. Una URL cambiada en un lado y no en el otro
// la atrapa tests/lecturas.test.ts, que recorre las dos con un `fetch` que graba lo que se pide.
// Devuelven lo que dice el API, sin leerlo (`unknown`): quien las usa lo lee con lib/filas, lib/alertas y lib/paginas.
// Ninguna recibe un `signal`: `getList` y `getJson` no toman un `RequestInit`, así que la consulta que se sustituye no cancela la petición, solo
// descarta la respuesta que llega tarde (la cancelación del anexo 15.4 no está en v1).
import { ApiError } from '@/api/errores'
import { getJson, getList, qs } from '@/api/http'
import type { ListResult } from '@/api/types'

/**
 * Lo que se puede pedir a la lista de facturas. `lean` (sin las líneas, la respuesta de la DGII ni el XML firmado) y `archivadas` (false: sin los intentos
 * archivados) son pedidos que solo hace Express y que solo entiende el API del plan 05; uno anterior los ignora, y por eso la lista también oculta lo archivado.
 */
interface FiltrosLista {
  page?: number
  pageSize?: number
  query?: string
  estado?: string
  tipo_ecf?: string
  client_id?: number
  lean?: boolean
  archivadas?: boolean
}

/**
 * ¿El API ya contestó 422 a `estado=accion`? Un API anterior al plan 05 no conoce ese filtro y lo rechaza como a cualquier valor que no es uno. Se
 * recuerda mientras dure la página, y desde entonces se pide `rechazado` sin volver a probar: el chip «Por revisar» sigue funcionando, con las
 * cuentas que da `rechazado` (que incluye lo archivado y deja fuera lo no encontrado y lo que dio error).
 */
let sinEstadoAccion = false

/** Olvida lo que se aprendió del API (`estado=accion`). Para las pruebas: la página real no lo necesita, el API no cambia debajo de ella. */
export function _reiniciarCapacidades(): void {
  sinEstadoAccion = false
}

/** GET /api/facturas con estos filtros y ese `estado` (que no es siempre el de `p`: ver `listFacturas`). `lean` y `archivadas` viajan solo como 1 y 0. */
function pedirLista(p: FiltrosLista, estado: string | undefined): Promise<ListResult<unknown>> {
  const query = qs({
    page: p.page,
    pageSize: p.pageSize,
    query: p.query,
    estado,
    tipo_ecf: p.tipo_ecf,
    client_id: p.client_id,
    lean: p.lean === true ? 1 : undefined,
    archivadas: p.archivadas === false ? 0 : undefined,
  })
  return getList<unknown>(`/api/facturas${query}`)
}

/**
 * Una página de la lista de facturas, con su paginación. Con `estado=accion` (el chip «Por revisar») y un API que lo rechaza con 422 se repite UNA
 * vez la misma petición con `estado=rechazado` y, si esa sale bien, se recuerda para no volver a probar. Si el reintento también falla el 422 era de
 * otra cosa (un `client_id` que el API no acepta): el error del reintento sale tal cual y no se recuerda nada. Un error que no es un 422 (la red, un
 * 401, un 500) tampoco cambia el filtro. Solo se sustituye `accion`: cualquier otro filtro con 422 falla como siempre.
 */
export async function listFacturas(p: FiltrosLista = {}): Promise<ListResult<unknown>> {
  if (p.estado !== 'accion') return pedirLista(p, p.estado)
  if (sinEstadoAccion) return pedirLista(p, 'rechazado')
  try {
    return await pedirLista(p, 'accion')
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 422) throw e
  }
  const lista = await pedirLista(p, 'rechazado')
  sinEstadoAccion = true
  return lista
}

/** El detalle de una factura (GET /api/facturas?id=). El API manda `data: [fila]`, y por si cambia, también una fila suelta; null si no hay fila. */
export async function getFactura(id: number): Promise<unknown | null> {
  const data = await getJson<unknown>(`/api/facturas${qs({ id })}`)
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

/** Lo que la DGII dice ahora de una factura (GET /api/facturas/{id}/estado). El API puede ir a preguntarle a la DGII, así que la lista nunca la pide por fila. */
export function getEstado(id: number): Promise<unknown> {
  return getJson<unknown>(`/api/facturas/${id}/estado`)
}

/** Las estadísticas que usa el inicio, sin lo que pesa (`stats=light`): las cuentas por estado, las secuencias, las ventas por día y por mes y el resumen. */
export function getStatsLight(): Promise<unknown> {
  return getJson<unknown>(`/api/facturas/stats${qs({ stats: 'light' })}`)
}

/** Los avisos de numeración (GET /api/facturas/avisos): los tipos con pocos números o ninguno. Los del POS (el certificado que falló, ventas sin rango) no pueden darse en Express. */
export function getAvisos(): Promise<unknown> {
  return getJson<unknown>('/api/facturas/avisos')
}

/**
 * El recibo de una factura como datos, para dibujarlo en pantalla (GET /api/facturas/{id}/pdf?format=datos&formato=pos). Siempre `formato=pos`, el ancho
 * de 80 mm: sin él el API contesta 422, y Express no tiene impresora cuyo ancho elegir (la app completa lo toma de stores/impresora).
 */
export function getReciboDatos(id: number): Promise<unknown> {
  return getJson<unknown>(`/api/facturas/${id}/pdf${qs({ format: 'datos', formato: 'pos' })}`)
}

/**
 * Las claves de la caché de consultas. Las cuatro de una factura cuelgan de `['facturas']` y la ligera de `['stats']`: invalidar ese prefijo las
 * recarga todas (después de un resultado, de verificar un estado o de volver de un detalle). `lista` lleva los filtros, y cada combinación es su caché.
 */
export const claves = {
  lista: (filtros: object) => ['facturas', 'lista', filtros] as const,
  detalle: (id: number) => ['facturas', 'detalle', id] as const,
  estado: (id: number) => ['facturas', 'estado', id] as const,
  recibo: (id: number) => ['facturas', 'recibo', id] as const,
  stats: ['stats', 'light'] as const,
  avisos: ['avisos'] as const,
  emisor: ['emisor'] as const,
}

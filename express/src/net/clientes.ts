// Las peticiones de Clientes de Express: la lista, el detalle, el alta, la edición y la consulta de RNC a la DGII. Son las mismas del servicio de la app completa
// (api/clients.ts y api/rnc.ts, que se importan por su ruta exacta: no traen zod); lo que se agrega aquí es lo que Express necesita aparte: la lista SIEMPRE con `page` y
// `pageSize`, la consulta de RNC con su propio tiempo límite (12 s: el servidor espera a la DGII hasta 5) y la recuperación de un alta cuya respuesta no llegó.
import { createClient, getClient, listClients, updateClient } from '@/api/clients'
import { ApiError } from '@/api/errores'
import { request, qs } from '@/api/http'
import type { ConsultaRnc } from '@/api/rnc'
import type { ClientRow, ListResult } from '@/api/types'
import { formatoRnc, soloDigitos } from '@/pos/montos'
import { clienteYaCreado, coincidenciasRnc, duplicadoDelServidor, esFalloAmbiguo, textoDeError } from '~/lib/clientes'
import type { AltaCliente, EdicionCliente } from '~/lib/clientes'

/** Las claves de la caché de consultas: empiezan por el recurso de la app completa (`clients`) para tener su frescura (config/cache.ts), y invalidar `['clients']` las recarga todas. */
export const claves = {
  todos: ['clients'] as const,
  lista: (query: string) => ['clients', 'lista', query] as const,
  item: (id: number) => ['clients', 'item', id] as const,
}

/** Una página de clientes (GET /api/clients). `query` vacío no se manda. El orden es el del servidor: el más nuevo primero. */
export function buscarClientes(p: { query?: string; page: number; pageSize: number }): Promise<ListResult<ClientRow>> {
  return listClients({ page: p.page, pageSize: p.pageSize, query: p.query === undefined || p.query === '' ? undefined : p.query })
}

/** El detalle de un cliente (GET /api/clients?id=). Un 404 llega como `ApiError` con ese estado. */
export function leerCliente(id: number): Promise<ClientRow> {
  return getClient(id)
}

/** PUT /api/clients: solo lo que cambió (el servidor conserva el resto). Idempotente: si falla se puede volver a tocar «Guardar». */
export function editarCliente(cambios: EdicionCliente): Promise<unknown> {
  return updateClient(cambios)
}

/**
 * Lo que la DGII sabe de un RNC o una cédula (GET /api/rnc/consulta). Lanza `ApiError`: 404 no inscrito, 422 sin 9 u 11 dígitos, 502 el servicio externo no contestó. Espera a lo sumo
 * 12 s y no avisa «sin conexión» por su cuenta: quien la llama decide qué decir (lib/clientes `resultadoConsultaRnc`).
 */
export function consultarRncExpress(rnc: string): Promise<ConsultaRnc> {
  return request<ConsultaRnc>(`/api/rnc/consulta${qs({ rnc })}`, { method: 'GET', signal: AbortSignal.timeout(12_000) })
}

/**
 * Los clientes que ya tienen este RNC. El servidor busca con LIKE sobre lo guardado: los clientes nuevos guardan solo dígitos, pero los de la app completa o de antes pueden
 * traer guiones, y esos solo aparecen buscándolos con guiones: dos búsquedas. Si una falla no se sabe, y no cuenta: nunca impide guardar.
 */
export async function clientesPorRnc(digitos: string): Promise<ClientRow[]> {
  const pedir = (query: string): Promise<ClientRow[]> => listClients({ page: 1, pageSize: 5, query }).then((r) => r.items)
  const [planas, conGuiones] = await Promise.allSettled([pedir(soloDigitos(digitos)), pedir(formatoRnc(soloDigitos(digitos)))])
  const filas = [...(planas.status === 'fulfilled' ? planas.value : []), ...(conGuiones.status === 'fulfilled' ? conGuiones.value : [])]
  const vistas = new Set<number>()
  return coincidenciasRnc(filas, soloDigitos(digitos)).filter((f) => {
    if (vistas.has(f.id)) return false
    vistas.add(f.id)
    return true
  })
}

/** Lo que pasó al guardar un cliente nuevo. */
export type ResultadoAlta =
  | { kind: 'creado'; fila: ClientRow }
  | { kind: 'rechazado'; mensaje: string; existente: ClientRow | null }
  | { kind: 'fallo'; mensaje: string }

/** Busca por el nombre de contacto (el servidor ordena el más nuevo primero) y deja pasar lo que `elegir` quiera de esas filas. Un fallo es «no hay»: no es motivo para otro error. */
async function buscarEntre(alta: AltaCliente, elegir: (filas: ClientRow[], alta: AltaCliente) => ClientRow | null): Promise<ClientRow | null> {
  try {
    const r = await listClients({ page: 1, pageSize: 25, query: alta.client_name })
    return elegir(r.items, alta)
  } catch {
    return null
  }
}

/**
 * POST /api/clients, sin repetirse nunca solo (el alta no es idempotente). Tres desenlaces:
 *  - `creado`: la fila nueva, con su id. También cuando la respuesta se perdió pero el cliente ya está (se busca antes de ofrecer reintentar), para no duplicarlo.
 *  - `rechazado`: el servidor dijo que no (su texto, tal cual). Con correo o teléfono, si hay un cliente igual al que el servidor llama «el mismo» (correo, contacto y teléfono),
 *    viene en `existente` para ofrecer usarlo.
 *  - `fallo`: no se sabe si se guardó y buscarlo tampoco lo encontró; tocar «Guardar» otra vez es seguro porque ya se buscó.
 */
export async function crearCliente(alta: AltaCliente): Promise<ResultadoAlta> {
  try {
    return { kind: 'creado', fila: await createClient(alta) }
  } catch (e) {
    if (!(e instanceof ApiError)) console.error('[clientes] alta', e) // lo que no es del API no se le enseña a nadie, pero queda en la consola
    const mensaje = textoDeError(e, 'No se pudo guardar el cliente. Inténtalo de nuevo.')
    if (esFalloAmbiguo(e)) {
      const fila = await buscarEntre(alta, clienteYaCreado)
      return fila !== null ? { kind: 'creado', fila } : { kind: 'fallo', mensaje }
    }
    return { kind: 'rechazado', mensaje, existente: await buscarEntre(alta, duplicadoDelServidor) }
  }
}

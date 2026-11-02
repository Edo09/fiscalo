// Qué pasó con una emisión (POST /api/facturas), decidido por el ESTADO primero y por el HTTP después (anexo 12.3). El HTTP 200 no quiere decir aceptada (ENVIADO,
// RFCE_ERROR...), y un 422 o un 502 CON `data.factura_id` es una factura guardada: el estado es el que habla.
//
//  - Con `data.factura_id` usable decide `estado_dgii` (la tabla única de lib/etiquetas): aceptada, enProceso, rechazada (con los motivos de la DGII, verbatim),
//    noEncontrada (solo la clave NO_ENCONTRADO) o guardadaIncierta (todo lo demás, también lo desconocido y lo ausente: ante la duda NO se emite otra vez).
//  - Sin datos: 502 con el JSON del servidor es «no guardada» (no se guardó nada); 400, 404 y 422 son validación; 403 es bloqueada; 409 `EN_CURSO` es enCurso y 409
//    `CLAVE_REUTILIZADA` bloqueada. Todo lo demás, un 502 que es la página de un proxy, un 401, un 200 sin datos y la red caída o agotada, es desconocido: no se sabe si
//    la factura quedó guardada, y no se vuelve a emitir.
// Cada mensaje del servidor pasa por `humanizar`: un texto claro (los de negocio, los de la DGII) sale sin cambios y uno técnico («SQLSTATE...») se reemplaza.
// Se decide por `codigo`, nunca por el texto.
import { humanizar } from '@/api/errores'
import { bucketDe } from '~/lib/etiquetas'
import { extraerMotivos } from '~/lib/motivos'

/** Lo que dejó la petición: el HTTP, si el cuerpo era el JSON de la API, y de él `data`, `error` y `codigo`. */
export interface RespuestaEmision {
  /** El HTTP; 0 si no hubo respuesta (la red se cayó o se agotó el tiempo). */
  status: number
  /** true si el cuerpo era el JSON de la API; false con la página de un proxy, un cuerpo vacío o sin respuesta. */
  sobre: boolean
  data?: unknown
  /** El texto `error` del servidor, tal cual. */
  error?: string
  codigo?: string | null
}

export type KindConFactura = 'aceptada' | 'enProceso' | 'noEncontrada' | 'guardadaIncierta'

interface DeFactura {
  facturaId: number
  eNcf: string | null
  /** El `estado_dgii` tal cual lo mandó el servidor ('' si no mandó). */
  estado: string
  /** El total que dice el servidor (el que vale); null si no lo mandó. */
  total: number | null
}

export type Outcome =
  | ({ kind: KindConFactura } & DeFactura)
  | ({ kind: 'rechazada'; motivos: string[] } & DeFactura)
  | { kind: 'noGuardada'; mensaje: string }
  | { kind: 'validacion'; mensaje: string }
  | { kind: 'bloqueada'; codigo: string; mensaje: string }
  | { kind: 'enCurso' }
  | { kind: 'desconocido' }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Un entero positivo que llega como número o como texto de MySQL («41»); null si no lo es. */
function idDe(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function totalDe(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * La categoría de un estado DGII para quien emite. Sale de `bucketDe` (la única tabla de estados): aceptada, enProceso y rechazada son sus buckets; solo la clave
 * `NO_ENCONTRADO` es noEncontrada (la que se puede reenviar con el mismo número); todo lo demás, también lo desconocido, el vacío y lo archivado, es guardadaIncierta.
 */
export function clasificarEstado(estado: string | null | undefined): KindConFactura | 'rechazada' {
  const bucket = bucketDe(estado)
  if (bucket === 'aceptada') return 'aceptada'
  if (bucket === 'enProceso') return 'enProceso'
  if (bucket === 'rechazada') return 'rechazada'
  return estado === 'NO_ENCONTRADO' ? 'noEncontrada' : 'guardadaIncierta'
}

const CONTEXTO = { metodo: 'POST', path: '/api/facturas' }

/** El texto del servidor para el usuario: sin cambios si es claro, reemplazado si es técnico, y uno por HTTP si no vino ninguno. */
function mensajeDe(r: RespuestaEmision): string {
  return humanizar(r.error, r.status, { ...CONTEXTO, ilegible: !r.sobre }).mensaje
}

/** Decide qué pasó con la emisión. Nunca lanza: una respuesta que no se entiende es `desconocido`. */
export function clasificar(r: RespuestaEmision): Outcome {
  const data = esObjeto(r.data) ? r.data : null
  const facturaId = data === null ? null : idDe(data.factura_id)
  if (data !== null && facturaId !== null) {
    const estado = typeof data.estado_dgii === 'string' ? data.estado_dgii : ''
    const base: DeFactura = { facturaId, eNcf: texto(data.e_ncf) ?? texto(data.no_factura), estado, total: totalDe(data.total) }
    const kind = clasificarEstado(estado)
    if (kind !== 'rechazada') return { kind, ...base }
    // Los motivos: lo que dijo la DGII; si no, el mensaje de rechazo de una repetición; y si no, el texto del servidor.
    let motivos = extraerMotivos(data.dgii_response)
    const repetido = texto(data.mensaje_rechazo)
    if (motivos.length === 0 && repetido !== null) motivos = [repetido]
    if (motivos.length === 0 && r.error !== undefined && texto(r.error) !== null) motivos = [mensajeDe(r)]
    return { kind, motivos, ...base }
  }

  const { status } = r
  if (status === 502 && r.sobre) return { kind: 'noGuardada', mensaje: mensajeDe(r) }
  if (status === 400 || status === 404 || status === 422) return { kind: 'validacion', mensaje: mensajeDe(r) }
  if (status === 403) return { kind: 'bloqueada', codigo: r.codigo ?? 'SIN_PERMISO', mensaje: mensajeDe(r) }
  if (status === 409 && r.codigo === 'EN_CURSO') return { kind: 'enCurso' }
  if (status === 409 && r.codigo === 'CLAVE_REUTILIZADA') return { kind: 'bloqueada', codigo: r.codigo, mensaje: mensajeDe(r) }
  return { kind: 'desconocido' }
}

// Cliente HTTP tipado para la API e-CF.
//
// Todo error sale como ApiError con un texto apto para el cajero: el del
// servidor si es claro, o uno genérico si era técnico (ver errores.ts). Por eso
// las pantallas pueden seguir haciendo `e instanceof ApiError ? e.message : …`.
import { API_BASE_URL, API_KEY } from './config'
import { getToken, clearSession } from '@/stores/auth'
import { errorDeRespuesta, networkError, referenciaDe, sesionExpirada, textoError, type ContextoError } from './errores'
import type { ListResult } from './types'

// ApiError y networkError viven en errores.ts; se re-exportan aquí porque
// siempre se importaron desde este módulo.
export { ApiError, networkError } from './errores'

/**
 * Timeouts por tipo de petición. Lecturas cortas; escrituras generosas porque
 * emitir un e-CF hace un viaje síncrono a DGII (firma + envío) y un timeout
 * falso en una escritura es peor que una respuesta lenta (la factura podría
 * quedar emitida en el servidor aunque el cliente ya se haya rendido).
 */
const TIMEOUT_READ_MS = 30_000
const TIMEOUT_WRITE_MS = 90_000
const TIMEOUT_BLOB_MS = 60_000

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // Auth de app: token de sesión del usuario (POST /api/auth/login) como Bearer.
  // Si no hay sesión, se cae a VITE_API_KEY (solo prod sin proxy / integración).
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  else if (API_KEY) headers['X-API-KEY'] = API_KEY
  return { ...headers, ...(extra as Record<string, string>) }
}

/**
 * 401 => el token venció o es inválido: cerramos sesión para volver al login.
 * El texto es siempre el del front: los del servidor (AuthMiddleware) están en
 * inglés o hablan de cabeceras, y se comparten con los integradores.
 */
function handleUnauthorized(body: unknown, ctx: ContextoError): never {
  clearSession()
  throw sesionExpirada(textoError(body), ctx)
}

/**
 * Hace la petición, valida HTTP/`status:false` y devuelve el cuerpo JSON crudo
 * (incluyendo hermanos del envoltorio como `pagination`). Lanza ApiError.
 */
async function fetchBody(path: string, init: RequestInit = {}): Promise<unknown> {
  const ctx: ContextoError = { metodo: init.method ?? 'GET', path }
  let res: Response
  try {
    const timeout = ctx.metodo === 'GET' ? TIMEOUT_READ_MS : TIMEOUT_WRITE_MS
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeout),
      headers: buildHeaders(init.headers),
      // Nunca leer de la cache HTTP del navegador. La respuesta del API es de
      // UN tenant y UN usuario, pero la clave de esa cache es la URL: el header
      // Authorization no la diversifica, asi que la respuesta de una empresa se
      // le puede servir a otra en el mismo equipo. El backend ya manda
      // no-store; esto ademas SALTA las entradas que quedaron guardadas antes
      // de ese arreglo, que si no se seguirian sirviendo sin llegar al servidor.
      cache: 'no-store',
    })
  } catch (e) {
    throw networkError(e, ctx)
  }

  const raw = await res.text()
  let body: unknown = null
  let ilegible = false
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      ilegible = true
    }
  }

  // El 401 va antes que el cuerpo: aunque la respuesta no sea JSON (un proxy),
  // la sesión ya no sirve y hay que volver al login.
  if (res.status === 401) handleUnauthorized(body, ctx)
  if (ilegible) {
    // Página HTML del hosting, un 413 de PHP, o dos JSON pegados. El comienzo
    // va a la consola: es lo único que dice qué pasó.
    console.warn('[API] respuesta que no es JSON', { ...ctx, status: res.status, inicio: raw.slice(0, 300) })
    throw errorDeRespuesta(null, res.status, { ...ctx, ilegible: true })
  }
  if (body && typeof body === 'object' && 'status' in body && (body as { status: unknown }).status === false) {
    const texto = textoError(body)
    throw errorDeRespuesta(texto, res.status, { ...ctx, referencia: referenciaDe(body, texto) }, (body as { data?: unknown }).data)
  }
  if (!res.ok) {
    throw errorDeRespuesta(null, res.status, ctx)
  }
  return body
}

/** ¿El cuerpo es el envoltorio { status:true, data, ... }? */
function isEnvelope(body: unknown): body is { status: true; data: unknown; pagination?: unknown } {
  return !!body && typeof body === 'object' && 'status' in body && (body as { status: unknown }).status === true
}

/**
 * Realiza una petición y devuelve `data` del envoltorio { status, data }.
 * Lanza ApiError ante fallos de red, HTTP o `status:false`.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const body = await fetchBody(path, init)
  if (isEnvelope(body)) return body.data as T
  return body as T
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

/**
 * GET que devuelve el SOBRE completo, sin desenvolver `data`.
 *
 * `getJson` se queda con `data` y `getList` solo con `items` + paginación. Hay
 * endpoints cuyo sobre lleva más cosas al mismo nivel (el valor de inventario
 * manda los totales del inventario completo, no los de la página); para esos,
 * quedarse con `data` es perder justo el dato que importa.
 */
export function getEnvelope<T>(path: string): Promise<T> {
  return fetchBody(path, { method: 'GET' }) as Promise<T>
}

/**
 * Como `request`, pero devuelve el SOBRE completo, para cualquier método. Para
 * respuestas cuya forma cambió entre versiones del backend (el id de un alta
 * puede venir en `data` o al lado de `data`).
 */
export function requestEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  return fetchBody(path, init) as Promise<T>
}

/**
 * GET de un listado paginado. Tolera dos formas reales del backend:
 *   { status, data: [...], pagination: { total, page, pageSize, totalPages } }
 *   { status, data: { items|data|..., total } }       (forma alterna)
 * Devuelve `{ items, total, page, pageSize, totalPages }`; los campos de
 * paginación se toman del bloque `pagination` cuando existe (null si falta).
 */
export async function getList<T>(path: string): Promise<ListResult<T>> {
  const body = await fetchBody(path, { method: 'GET' })
  const env = isEnvelope(body) ? body : { data: body, pagination: undefined as unknown }
  const data = env.data

  let items: T[] = []
  let total: number | null = null

  if (Array.isArray(data)) {
    items = data as T[]
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    const arr = [o.items, o.data, o.gastos, o.facturas, o.clients, o.users].find(Array.isArray)
    items = (arr as T[]) ?? []
    if (typeof o.total === 'number') total = o.total
  }

  let page: number | null = null
  let pageSize: number | null = null
  let totalPages: number | null = null
  const pag = (env as { pagination?: unknown }).pagination
  if (pag && typeof pag === 'object') {
    const p = pag as Record<string, unknown>
    if (typeof p.total === 'number') total = p.total
    if (typeof p.page === 'number') page = p.page
    if (typeof p.pageSize === 'number') pageSize = p.pageSize
    if (typeof p.totalPages === 'number') totalPages = p.totalPages
  }
  return { items, total, page, pageSize, totalPages }
}

/** Descarga binaria (PDF/XML directo). Lanza ApiError ante fallos HTTP. */
export async function getBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const ctx: ContextoError = { metodo: 'GET', path }
  let res: Response
  try {
    // PDFs/XML pueden tardar más que un GET normal (el backend genera el documento).
    res = await fetch(`${API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_BLOB_MS),
      headers: buildHeaders(),
      cache: 'no-store', // un PDF tambien es dato del tenant (ver fetchBody)
    })
  } catch (e) {
    throw networkError(e, ctx)
  }
  if (!res.ok) {
    let errBody: unknown = null
    try {
      errBody = await res.json()
    } catch {
      /* respuesta no-JSON */
    }
    if (res.status === 401) handleUnauthorized(errBody, ctx)
    const texto = textoError(errBody)
    throw errorDeRespuesta(texto, res.status, {
      ...ctx,
      referencia: referenciaDe(errBody, texto),
      ilegible: errBody === null,
    })
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = /filename="?([^";]+)"?/.exec(cd)
  const filename = m ? m[1] : (path.split('/').pop() ?? 'documento').split('?')[0]
  return { blob, filename }
}

export function postJson<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** Construye un query string a partir de pares definidos. */
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

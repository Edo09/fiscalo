// Cliente HTTP tipado para la API e-CF.
import { API_BASE_URL, API_KEY } from './config'
import { getToken, clearSession } from '@/auth/session'

/** Error normalizado de la API (con código HTTP cuando aplica). */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Timeouts por tipo de petición. Lecturas cortas; escrituras generosas porque
 * emitir un e-CF hace un viaje síncrono a DGII (firma + envío) y un timeout
 * falso en una escritura es peor que una respuesta lenta (la factura podría
 * quedar emitida en el servidor aunque el cliente ya se haya rendido).
 */
const TIMEOUT_READ_MS = 30_000
const TIMEOUT_WRITE_MS = 90_000
const TIMEOUT_BLOB_MS = 60_000

/** Normaliza fallos de red/timeout de fetch a un ApiError con mensaje claro. */
export function networkError(e: unknown): ApiError {
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return new ApiError('El servidor tardó demasiado en responder. Inténtalo de nuevo.', 0)
  }
  return new ApiError('No se pudo conectar con el servidor. ¿Está configurada la API?', 0)
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // Auth de app: token de sesión del usuario (POST /api/auth/login) como Bearer.
  // Si no hay sesión, se cae a VITE_API_KEY (solo prod sin proxy / integración).
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  else if (API_KEY) headers['X-API-KEY'] = API_KEY
  return { ...headers, ...(extra as Record<string, string>) }
}

/** 401 => el token venció o es inválido: cerramos sesión para volver al login. */
function handleUnauthorized(body: unknown, status: number): never {
  clearSession()
  const msg = (body as { error?: string } | null)?.error || 'Tu sesión expiró. Vuelve a iniciar sesión.'
  throw new ApiError(msg, status)
}

/**
 * Hace la petición, valida HTTP/`status:false` y devuelve el cuerpo JSON crudo
 * (incluyendo hermanos del envoltorio como `pagination`). Lanza ApiError.
 */
async function fetchBody(path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response
  try {
    const timeout = (init.method ?? 'GET') === 'GET' ? TIMEOUT_READ_MS : TIMEOUT_WRITE_MS
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeout),
      headers: buildHeaders(init.headers),
    })
  } catch (e) {
    throw networkError(e)
  }

  const raw = await res.text()
  let body: unknown = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ApiError(`Respuesta no válida del servidor (HTTP ${res.status}).`, res.status)
    }
  }

  if (res.status === 401) handleUnauthorized(body, res.status)
  if (body && typeof body === 'object' && 'status' in body && (body as { status: unknown }).status === false) {
    throw new ApiError((body as { error?: string }).error || `Error HTTP ${res.status}.`, res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Error HTTP ${res.status}.`, res.status)
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
 * GET de un listado paginado. Tolera dos formas reales del backend:
 *   { status, data: [...], pagination: { total } }   (gastos/facturas/clients/users)
 *   { status, data: { items|data|..., total } }       (forma alterna)
 * Devuelve siempre `{ items, total }` con el total tomado de `pagination` si existe.
 */
export async function getList<T>(path: string): Promise<{ items: T[]; total: number | null }> {
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

  const pag = (env as { pagination?: unknown }).pagination
  if (pag && typeof pag === 'object' && typeof (pag as { total?: unknown }).total === 'number') {
    total = (pag as { total: number }).total
  }
  return { items, total }
}

/** Descarga binaria (PDF/XML directo). Lanza ApiError ante fallos HTTP. */
export async function getBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  let res: Response
  try {
    // PDFs/XML pueden tardar más que un GET normal (el backend genera el documento).
    res = await fetch(`${API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_BLOB_MS),
      headers: buildHeaders(),
    })
  } catch (e) {
    throw networkError(e)
  }
  if (!res.ok) {
    let msg = `Error HTTP ${res.status}.`
    let errBody: { error?: string } | null = null
    try {
      errBody = (await res.json()) as { error?: string }
      if (errBody?.error) msg = errBody.error
    } catch {
      /* respuesta no-JSON */
    }
    if (res.status === 401) handleUnauthorized(errBody, res.status)
    throw new ApiError(msg, res.status)
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

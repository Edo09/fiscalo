// Cliente HTTP tipado para la API e-CF.
import { API_BASE_URL, API_KEY } from './config'

/** Error normalizado de la API (con código HTTP cuando aplica). */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // En dev la clave la inyecta el proxy; en prod sin proxy se manda aquí.
  if (API_KEY) headers['X-API-KEY'] = API_KEY
  return { ...headers, ...(extra as Record<string, string>) }
}

/**
 * Hace la petición, valida HTTP/`status:false` y devuelve el cuerpo JSON crudo
 * (incluyendo hermanos del envoltorio como `pagination`). Lanza ApiError.
 */
async function fetchBody(path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: buildHeaders(init.headers) })
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. ¿Está configurada la API?', 0)
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
    res = await fetch(`${API_BASE_URL}${path}`, { headers: buildHeaders() })
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. ¿Está configurada la API?', 0)
  }
  if (!res.ok) {
    let msg = `Error HTTP ${res.status}.`
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      /* respuesta no-JSON */
    }
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

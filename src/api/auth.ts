// Servicio: autenticación (login / registro / cierre de sesión).
//
// OJO: los endpoints /api/auth/* del backend usan un envoltorio
// { success, data, error } — distinto al { status, data } del resto de la API —,
// por eso este módulo no reutiliza request()/fetchBody() de http.ts: necesita
// leer `success`/`error` para mostrar el mensaje real (ej. "Invalid email or password").
import { API_BASE_URL } from './config'
import { ApiError } from './http'
import { getToken, type SessionUser } from '@/auth/session'

export interface LoginResult {
  token: string
  user: SessionUser
}

interface AuthEnvelope<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

async function authPost<T>(path: string, payload: unknown, withAuth = false): Promise<AuthEnvelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (withAuth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. ¿Está configurada la API?', 0)
  }

  const raw = await res.text()
  let body: AuthEnvelope<T> | null = null
  if (raw) {
    try {
      body = JSON.parse(raw) as AuthEnvelope<T>
    } catch {
      throw new ApiError(`Respuesta no válida del servidor (HTTP ${res.status}).`, res.status)
    }
  }

  if (!body || body.success !== true) {
    throw new ApiError(body?.error || `Error HTTP ${res.status}.`, res.status)
  }
  return body
}

/**
 * Inicia sesión. En multi-tenant el login por EMAIL funciona global; por USERNAME
 * el backend exige tenant_id (el username es único por tenant, no global).
 */
export async function login(emailOrUsername: string, password: string, tenantId?: number | string): Promise<LoginResult> {
  const payload: Record<string, unknown> = { emailOrUsername, password }
  if (tenantId !== undefined && tenantId !== '') payload.tenant_id = tenantId
  const body = await authPost<LoginResult>('/api/auth/login', payload)
  return body.data as LoginResult
}

/** Revoca el token en el backend (best-effort). El borrado local lo hace clearSession(). */
export async function logout(): Promise<void> {
  try {
    await authPost('/api/auth/signout', {}, true)
  } catch {
    /* aunque falle la revocación remota, cerramos sesión local igual */
  }
}

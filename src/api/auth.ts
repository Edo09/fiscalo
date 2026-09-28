// Servicio: autenticación (login / registro / cierre de sesión).
//
// OJO: los endpoints /api/auth/* del backend usan un envoltorio
// { success, data, error } — distinto al { status, data } del resto de la API —,
// por eso este módulo no reutiliza request()/fetchBody() de http.ts: necesita
// leer `success`/`error` para mostrar el motivo real del rechazo del login. Ese
// texto pasa por la misma red de seguridad que el resto (errores.ts): uno claro
// se muestra tal cual y uno técnico o en inglés se cambia por uno en español.
import { API_BASE_URL } from './config'
import { errorDeRespuesta, networkError, textoError, type ContextoError } from './errores'
import { getToken, type SessionUser } from '@/stores/auth'

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

  // El 401 del login es "usuario o clave equivocados", no "sesión expirada":
  // errores.ts lo distingue por la ruta, por eso no se cierra sesión aquí.
  const ctx: ContextoError = { metodo: 'POST', path }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers,
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw networkError(e, ctx)
  }

  const body = await leerSobre<T>(res, ctx)
  if (!body || body.success !== true) {
    throw errorDeRespuesta(textoError(body), res.status, ctx)
  }
  return body
}

/** Cuerpo JSON del sobre (null si vino vacío). Un cuerpo que no es JSON lanza ApiError. */
async function leerSobre<T>(res: Response, ctx: ContextoError): Promise<AuthEnvelope<T> | null> {
  const raw = await res.text()
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthEnvelope<T>
  } catch {
    console.warn('[API] respuesta que no es JSON', { ...ctx, status: res.status, inicio: raw.slice(0, 300) })
    throw errorDeRespuesta(null, res.status, { ...ctx, ilegible: true })
  }
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

/**
 * Devuelve el usuario actual (rol + permisos vivos) sin re-login. Úsalo para
 * refrescar los módulos cuando un admin cambia el rol. GET con el mismo
 * envoltorio { success, data } de los demás /api/auth/*.
 */
export async function me(): Promise<SessionUser> {
  const token = getToken()
  const ctx: ContextoError = { metodo: 'GET', path: '/api/auth/me' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Identidad de la sesion: jamas desde la cache del navegador, que se
      // indexa por URL y no distingue un token de otro (ver http.ts).
      cache: 'no-store',
    })
  } catch (e) {
    throw networkError(e, ctx)
  }
  const body = await leerSobre<{ user: SessionUser }>(res, ctx)
  if (!body || body.success !== true || !body.data?.user) {
    // Un 401 aquí da el texto de sesión expirada (nunca el del servidor). No se
    // cierra la sesión: quien llama decide (App.tsx lo ignora y la próxima
    // petición normal, si también da 401, la cierra).
    throw errorDeRespuesta(textoError(body), res.status, ctx)
  }
  return body.data.user
}

/** Revoca el token en el backend (best-effort). El borrado local lo hace clearSession(). */
export async function logout(): Promise<void> {
  try {
    await authPost('/api/auth/signout', {}, true)
  } catch {
    /* aunque falle la revocación remota, cerramos sesión local igual */
  }
}

// Sesión de la app: token de usuario + datos del usuario, persistidos en localStorage.
//
// Vive FUERA de React a propósito por dos razones:
//   1) el cliente HTTP (src/api/http.ts) no es un componente y necesita leer el
//      token para mandar `Authorization: Bearer <token>` en cada petición;
//   2) ante un 401 el cliente HTTP llama clearSession() y, vía subscribe(), los
//      componentes (App, Navbar) reaccionan y muestran el login.
//
// El token lo emite POST /api/auth/login (ver src/api/auth.ts) y el backend lo
// valida como token de sesión de app (AuthMiddleware: Authorization: Bearer).

/** Usuario autenticado, tal como lo devuelve /api/auth/login. */
export interface SessionUser {
  id: number
  email: string
  username: string
  name: string
  role: string
}

const TOKEN_KEY = 'fiscalo.token'
const USER_KEY = 'fiscalo.user'

function readUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

let token: string | null = localStorage.getItem(TOKEN_KEY)
let user: SessionUser | null = readUser()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function getToken(): string | null {
  return token
}

export function getUser(): SessionUser | null {
  return user
}

export function isAuthenticated(): boolean {
  return token !== null
}

/** Guarda la sesión tras un login exitoso y notifica a los suscriptores. */
export function setSession(newToken: string, newUser: SessionUser): void {
  token = newToken
  user = newUser
  localStorage.setItem(TOKEN_KEY, newToken)
  localStorage.setItem(USER_KEY, JSON.stringify(newUser))
  notify()
}

/** Borra la sesión (logout o 401). No hace nada si ya estaba vacía. */
export function clearSession(): void {
  if (token === null && user === null) return
  token = null
  user = null
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  notify()
}

/** Suscribe un callback a los cambios de sesión. Devuelve la función para desuscribir. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

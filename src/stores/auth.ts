// Store global de sesión (Zustand): token + usuario autenticado.
//
// Única fuente de verdad de la autenticación. Persiste en localStorage vía el
// middleware `persist`. Expone tres formas de consumo:
//   - useAuthStore  — el store crudo (selectores finos: useAuthStore(s => s.user))
//   - useSession()  — hook de conveniencia { token, user, authenticated }
//   - accesores no-React (getToken, setSession, clearSession…) para el cliente
//     HTTP y los servicios, que no son componentes pero necesitan leer el token
//     y poder cerrar la sesión ante un 401.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/** Usuario autenticado, tal como lo devuelve POST /api/auth/login. */
export interface SessionUser {
  id: number
  email: string
  username: string
  name: string
  role: string
  /** Módulos del rol (ej. ["facturas","gastos"] o ["*"] para admin). Lo provee
      el backend en login y /api/auth/me; ausente en sesiones viejas (fail-open). */
  permissions?: string[]
}

interface AuthState {
  token: string | null
  user: SessionUser | null
  /** Guarda la sesión tras un login exitoso. */
  setSession: (token: string, user: SessionUser) => void
  /** Borra la sesión (logout o 401). */
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      clearSession: () => set({ token: null, user: null }),
    }),
    {
      name: 'fiscalo.auth', // clave en localStorage
      storage: createJSONStorage(() => localStorage),
      // Solo se persiste el estado, no las acciones.
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
)

// --- Hook de conveniencia para componentes ----------------------------------
export interface Session {
  token: string | null
  user: SessionUser | null
  authenticated: boolean
}

export function useSession(): Session {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  return { token, user, authenticated: token !== null }
}

// --- Accesores no-React (cliente HTTP / servicios) ---------------------------
export const getToken = (): string | null => useAuthStore.getState().token
export const getUser = (): SessionUser | null => useAuthStore.getState().user
export const isAuthenticated = (): boolean => useAuthStore.getState().token !== null
export const setSession = (token: string, user: SessionUser): void =>
  useAuthStore.getState().setSession(token, user)
export const clearSession = (): void => useAuthStore.getState().clearSession()

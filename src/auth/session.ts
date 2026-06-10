// Sesión de la app (token + usuario) gestionada con Zustand.
//
// El store es la única fuente de verdad y persiste en localStorage mediante el
// middleware `persist`. Además se exponen unos accesores NO-React (getToken,
// setSession, clearSession…) porque el cliente HTTP y los servicios no son
// componentes pero necesitan leer el token y poder cerrar la sesión ante un 401.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/** Usuario autenticado, tal como lo devuelve POST /api/auth/login. */
export interface SessionUser {
  id: number
  email: string
  username: string
  name: string
  role: string
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

// --- Accesores no-React (cliente HTTP / servicios) -------------------------
export const getToken = (): string | null => useAuthStore.getState().token
export const getUser = (): SessionUser | null => useAuthStore.getState().user
export const isAuthenticated = (): boolean => useAuthStore.getState().token !== null
export const setSession = (token: string, user: SessionUser): void =>
  useAuthStore.getState().setSession(token, user)
export const clearSession = (): void => useAuthStore.getState().clearSession()

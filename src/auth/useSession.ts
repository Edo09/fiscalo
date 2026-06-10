// Hook de React para leer la sesión. La fuente de verdad es el store Zustand
// (`useAuthStore` en ./session); este hook solo selecciona los slices y se
// re-renderiza cuando cambian (login, logout o 401).
import { useAuthStore, type SessionUser } from './session'

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

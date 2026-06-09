// Hook de React para leer la sesión y re-renderizar cuando cambia
// (login, logout o 401). La fuente de verdad vive en session.ts.
import { useEffect, useReducer } from 'react'
import { getToken, getUser, subscribe, type SessionUser } from './session'

export interface Session {
  token: string | null
  user: SessionUser | null
  authenticated: boolean
}

export function useSession(): Session {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribe(force), [])
  const token = getToken()
  return { token, user: getUser(), authenticated: token !== null }
}

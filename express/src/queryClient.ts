// El cliente de datos de Express (TanStack Query) y su vínculo con la sesión. Lo que está en caché es del usuario y la empresa que miran: se
// vacía cuando eso cambia (un cierre explícito de sesión o entrar otro usuario) y nunca con un null inesperado, para que la pantalla sobre la
// que se abre la hoja de sesión conserve sus datos.
import { QueryClient } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import { escucharSesion } from '~/lib/sesion'

/**
 * Un cliente con los valores de Express. Un reintento en las lecturas (más sería esperar de más con mala señal) y ninguno en las escrituras:
 * repetir una por su cuenta puede emitir dos veces. Sin refresco al volver a la ventana: eso lo decide la app con `useAlVolver`, y el cambio de
 * pestaña de un teléfono no debe disparar lecturas. Los datos duran 30 minutos en caché aunque nadie los mire.
 */
export function crearQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: FRESCURA.NORMAL, gcTime: 1_800_000 },
      mutations: { retry: 0 },
    },
  })
}

/** El cliente de la app. */
export const queryClient = crearQueryClient()

/** Vacía `client` en un cierre explícito de sesión y cuando entra otro usuario (los dos avisos de `escucharSesion`). Devuelve la función que lo desvincula. */
export function vincularLimpieza(client: QueryClient): () => void {
  return escucharSesion(() => {
    client.clear()
  })
}

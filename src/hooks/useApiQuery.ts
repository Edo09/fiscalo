// Hook de datos sobre TanStack Query (sustituye al viejo useAsync).
// Mantiene la forma { data, error, loading, reload } que ya usaban las vistas,
// pero con caché compartida por queryKey: al volver a una página ya visitada se
// muestra el dato cacheado al instante y solo se refetchea si caducó su frescura.
// Claves iguales => una sola petición compartida.
//
// El staleTime NO es único para toda la app: sale del recurso de la queryKey
// (ver config/cache.ts), porque las facturas cambian solas y un catálogo DGII no.
// El refetch nunca borra lo que ya está en pantalla — `loading` solo es true
// cuando todavía no hay dato —, así que refrescar en segundo plano no parpadea.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { staleTimeFor } from '@/config/cache'
import { ApiError } from '@/api/errores'

/**
 * Un error que no es ApiError es un fallo de la propia app (un TypeError al
 * leer una respuesta con otra forma, por ejemplo) y su texto está en inglés
 * ("Cannot read properties of undefined"). En pantalla va este; el original,
 * a la consola (lo registra el queryFn, una vez por intento).
 */
const MSG_INESPERADO = 'Ocurrió un problema inesperado al mostrar los datos. Recarga la página; si sigue pasando, avisa a soporte.'

export interface ApiQueryState<T> {
  data: T | null
  error: string | null
  /** Código HTTP del error (0 = sin respuesta del servidor), para la pantalla
      que trata un código distinto; null si no hay error o no vino de la API. */
  errorStatus: number | null
  /** true solo cuando no hay dato aún (primer fetch); con caché no parpadea. */
  loading: boolean
  /** true mientras hay un fetch en vuelo, aunque haya datos cacheados visibles. */
  fetching: boolean
  /** Re-consulta ignorando el staleTime. Devuelve la promesa del refetch
      (para que un botón "Actualizar" pueda esperar y mostrar feedback). */
  reload: () => Promise<unknown>
}

export function useApiQuery<T>(
  key: readonly unknown[],
  fn: () => Promise<T>,
  opts: { keepPrevious?: boolean; staleTime?: number } = {},
): ApiQueryState<T> {
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await fn()
      } catch (e) {
        if (!(e instanceof ApiError)) console.error('[useApiQuery] error inesperado', key, e)
        throw e
      }
    },
    // Frescura por recurso (config/cache.ts). `staleTime` explícito la sobrescribe
    // para un caso puntual sin tener que tocar la tabla.
    staleTime: opts.staleTime ?? staleTimeFor(key),
    // keepPrevious: al cambiar la clave (ej. tecleo en un buscador) se sigue
    // mostrando el resultado anterior mientras llega el nuevo (sin parpadeo).
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
  return {
    data: q.data ?? null,
    error: q.error ? (q.error instanceof ApiError ? q.error.message : MSG_INESPERADO) : null,
    errorStatus: q.error instanceof ApiError ? q.error.status : null,
    loading: q.isPending,
    fetching: q.isFetching,
    reload: () => q.refetch(),
  }
}

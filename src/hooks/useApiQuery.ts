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

export interface ApiQueryState<T> {
  data: T | null
  error: string | null
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
    queryFn: fn,
    // Frescura por recurso (config/cache.ts). `staleTime` explícito la sobrescribe
    // para un caso puntual sin tener que tocar la tabla.
    staleTime: opts.staleTime ?? staleTimeFor(key),
    // keepPrevious: al cambiar la clave (ej. tecleo en un buscador) se sigue
    // mostrando el resultado anterior mientras llega el nuevo (sin parpadeo).
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
  return {
    data: q.data ?? null,
    error: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : null,
    loading: q.isPending,
    fetching: q.isFetching,
    reload: () => q.refetch(),
  }
}

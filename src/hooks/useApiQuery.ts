// Hook de datos sobre TanStack Query (sustituye al viejo useAsync).
// Mantiene la forma { data, error, loading, reload } que ya usaban las vistas,
// pero con caché compartida por queryKey: al volver a una página ya visitada se
// muestra el dato cacheado al instante y solo se refetchea si pasó el staleTime
// (configurado en main.tsx). Claves iguales => una sola petición compartida.
import { keepPreviousData, useQuery } from '@tanstack/react-query'

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
  opts: { keepPrevious?: boolean } = {},
): ApiQueryState<T> {
  const q = useQuery({
    queryKey: key,
    queryFn: fn,
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

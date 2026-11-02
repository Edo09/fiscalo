// Lo que comparten las listas de Clientes y de Productos: el buscador con su espera y las páginas con «Cargar más».
//
// `usePaginas` es un `useInfiniteQuery` de `pageSize` filas por página (SIEMPRE con `page` y `pageSize`: sin ellos el servidor manda toda la tabla). La siguiente página la dice la
// paginación del servidor, y sin ella una página llena (`hayMasPaginas`). Mientras se teclea y llega la búsqueda nueva se siguen viendo las filas de la anterior (`keepPreviousData`: sin
// parpadeo), y el vacío («Sin resultados») nunca sale mientras lo que se ve es de una búsqueda anterior. Sin conexión y sin filas se dice que no se pudo, no se deja un esqueleto eterno
// (una lectura sin red queda en pausa y no falla).
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { staleTimeFor } from '@/config/cache'
import type { ListResult } from '@/api/types'
import { ESPERA_BUSQUEDA_MS, hayMasPaginas } from '~/lib/clientes'
import { useEnLinea } from '~/net/enLinea'

/** Lo que guarda la caché de una página: sus filas ya leídas, el número de página que dijo el servidor y si hay otra. */
interface Pagina<T> {
  items: T[]
  page: number
  hayMas: boolean
}

/** Qué se ve: el esqueleto, el error con «Reintentar», nada que mostrar o las filas. */
export type EstadoLista = 'cargando' | 'error' | 'vacio' | 'filas'

export interface PaginasLista<T> {
  items: T[]
  estado: EstadoLista
  hayMas: boolean
  /** Se está pidiendo la página siguiente. */
  cargandoMas: boolean
  /** La página siguiente falló: las filas de antes siguen a la vista. */
  falloMas: boolean
  masPaginas(): void
  /** Vuelve a pedir lo que falló: la página siguiente si fue esa, y si no, la lista. */
  reintentar(): void
}

/** Las filas sin repetir por `id`, en su orden: con la lista cambiando entre una página y otra (un cliente nuevo) una fila puede venir al final de una y al principio de la siguiente. */
function sinRepetidas<T extends { id: number }>(filas: T[]): T[] {
  const vistas = new Set<number>()
  return filas.filter((f) => {
    if (vistas.has(f.id)) return false
    vistas.add(f.id)
    return true
  })
}

export function usePaginas<T extends { id: number }>(o: {
  clave: readonly unknown[]
  pedir(pagina: number): Promise<ListResult<unknown>>
  mapear(fila: unknown): T
  pageSize: number
}): PaginasLista<T> {
  const { clave, pedir, mapear, pageSize } = o
  const enLinea = useEnLinea()
  const q = useInfiniteQuery({
    queryKey: clave,
    queryFn: async ({ pageParam }): Promise<Pagina<T>> => {
      const r = await pedir(pageParam)
      const page = r.page ?? pageParam
      return { items: r.items.map(mapear), page, hayMas: hayMasPaginas(r, page, pageSize) }
    },
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.hayMas ? ultima.page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: staleTimeFor(clave),
  })

  const paginas = q.data?.pages
  const items = useMemo(() => sinRepetidas((paginas ?? []).flatMap((p) => p.items)), [paginas])
  let estado: EstadoLista
  if (q.data === undefined) estado = q.isError || !enLinea ? 'error' : 'cargando'
  else if (items.length > 0) estado = 'filas'
  else estado = q.isPlaceholderData ? 'cargando' : 'vacio'

  const { fetchNextPage, refetch, isFetchNextPageError } = q
  return {
    items,
    estado,
    hayMas: q.hasNextPage,
    cargandoMas: q.isFetchingNextPage,
    falloMas: isFetchNextPageError,
    masPaginas: () => void fetchNextPage(),
    reintentar: () => void (isFetchNextPageError ? fetchNextPage() : refetch()),
  }
}

/**
 * El texto del buscador y lo que se consulta de él: `consulta` alcanza a `texto` `ESPERA_BUSQUEDA_MS` después de la última tecla, o en el acto al borrarlo todo o al tocar «Buscar»
 * (`buscarYa`, que también cierra el teclado para ver los resultados).
 */
export function useBusqueda(): { texto: string; cambiar(t: string): void; consulta: string; buscarYa(): void } {
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  useEffect(() => {
    if (texto === consulta) return
    const espera = window.setTimeout(() => setConsulta(texto), ESPERA_BUSQUEDA_MS)
    return () => window.clearTimeout(espera)
  }, [texto, consulta])
  return {
    texto,
    consulta,
    cambiar: (t) => {
      setTexto(t)
      if (t.trim() === '') setConsulta('')
    },
    buscarYa: () => {
      setConsulta(texto)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
  }
}

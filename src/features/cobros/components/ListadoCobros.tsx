// La pestaña "Cobros": filtros, tabla y paginación. Los filtros, la página y el tamaño viven en el store de
// interfaz; la lista, en TanStack Query (con keepPrevious: cambiar un filtro no parpadea).
import { Btn, Card, EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui'
import { useListaCobros } from '../hooks'
import { PAGE_SIZES, hayFiltros, useCobrosUi } from '../store'
import { FiltrosCobros } from './FiltrosCobros'
import { TablaCobros } from './TablaCobros'

export function ListadoCobros() {
  const filtros = useCobrosUi((s) => s.filtros)
  const page = useCobrosUi((s) => s.page)
  const pageSize = useCobrosUi((s) => s.pageSize)
  const setPage = useCobrosUi((s) => s.setPage)
  const setPageSize = useCobrosUi((s) => s.setPageSize)
  const limpiarFiltros = useCobrosUi((s) => s.limpiarFiltros)
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const { data, error, loading, fetching, reload } = useListaCobros(filtros, page, pageSize)

  const filas = data?.items ?? []
  const total = data?.total ?? null
  const totalPages = data?.totalPages ?? null
  const filtrado = hayFiltros(filtros)

  return (
    <>
      <FiltrosCobros buscando={fetching && !loading} />

      {!loading && !error && filas.length > 0 && (
        <Pagination
          compact page={page} totalPages={totalPages} total={total} pageSize={pageSize} count={filas.length}
          onPage={setPage} onPageSize={setPageSize} pageSizeOptions={PAGE_SIZES}
        />
      )}

      <Card noPad>
        {loading ? (
          <LoadingState rows={7} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los cobros" onRetry={reload}>{error}</ErrorState>
        ) : filas.length === 0 ? (
          <EmptyState
            icon="wallet" title={filtrado ? 'Ningún cobro coincide' : 'Aún no hay cobros'}
            action={filtrado
              ? <Btn variant="secondary" icon="x" onClick={limpiarFiltros}>Limpiar filtros</Btn>
              : <Btn variant="primary" icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId: null })}>Nuevo cobro</Btn>}
          >
            {filtrado
              ? 'Prueba con otros filtros o con otro nombre.'
              : 'Crea el primer cobro, o configura el cobro mensual de un cliente para que se genere solo al cobrar.'}
          </EmptyState>
        ) : (
          <TablaCobros cobros={filas} />
        )}
      </Card>

      {!loading && !error && (filas.length > 0 || page > 1) && (
        <Pagination
          page={page} totalPages={totalPages} total={total} pageSize={pageSize} count={filas.length}
          onPage={setPage} onPageSize={setPageSize} pageSizeOptions={PAGE_SIZES}
        />
      )}
    </>
  )
}

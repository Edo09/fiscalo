import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Icon, Btn, RefreshButton, Money, Card, Modal, PageHead, Pagination,
  EmptyState, LoadingState, ErrorState,
} from '@/components/ui'
import { ApiError, listFacturasSimples, deleteFacturaSimple, getFacturaSimplePdf } from '@/api'
import type { FacturaSimpleRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import type { Nav } from '@/config/navigation'

const PAGE_SIZES = [10, 25, 50]
const SEARCH_DEBOUNCE_MS = 350

function fecha(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? (v ?? '—') : d.toLocaleDateString('es-DO')
}

function cliente(f: FacturaSimpleRow): string {
  return f.client_name || f.company_name || `Cliente #${f.client_id ?? '—'}`
}

/* FISCALO — Facturas simples: listado (GET /api/facturas-simples).
   Documentos internos, sin e-NCF ni NCF fiscal: no van a la DGII ni al 607. */
export function SimpleInvoiceListView({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [confirmDel, setConfirmDel] = useState<FacturaSimpleRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)

  // Búsqueda servida por el backend: se fija al dejar de teclear y vuelve a la
  // página 1. Enter la dispara al instante.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim()
      if (q !== query) { setQuery(q); setPage(1) }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, query])

  const { data, error, loading, fetching, reload } = useApiQuery(
    ['facturas-simples', 'list', { page, pageSize, query }],
    () => listFacturasSimples({ page, pageSize, query }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const totalPages = data?.totalPages ?? null
  const searching = fetching && !loading
  const sumaPagina = rows.reduce((c, f) => c + Number(f.total ?? 0), 0)

  const changePageSize = (n: number) => { setPageSize(n); setPage(1) }

  const verPdf = async (f: FacturaSimpleRow) => {
    setPdfBusy(f.id)
    try {
      presentDocument(await getFacturaSimplePdf(f.id))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfBusy(null)
    }
  }

  const borrar = async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteFacturaSimple(confirmDel.id)
      toast.success(`Factura ${confirmDel.no_factura} eliminada.`)
      setConfirmDel(null)
      await queryClient.invalidateQueries({ queryKey: ['facturas-simples'] })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo eliminar la factura.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Facturas simples"
        sub={total != null ? `${total} documentos internos` : 'Documentos internos, sin valor fiscal'}
        actions={
          <>
            <RefreshButton onRefresh={() => reload()} />
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-simple-nueva')}>
              Nueva factura simple
            </Btn>
          </>
        }
      />

      <Card className="mb-md">
        <div className="row gap-sm" style={{ alignItems: 'flex-start' }}>
          <Icon name="info" size={16} style={{ color: 'var(--text-3)', marginTop: 2 }} />
          <span className="text-sm muted">
            Estas facturas no se envían a la DGII: no llevan e-NCF ni NCF fiscal y no
            entran en el reporte 607. Para un comprobante fiscal, emite una factura
            electrónica desde Facturación.
          </span>
        </div>
      </Card>

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1) }}>
          <Icon name={searching ? 'loader' : 'search'} className={searching ? 'spin' : undefined} />
          <input
            placeholder="Buscar por número, cliente o artículo…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </form>
        {query && (
          <button type="button" className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}>
            <Icon name="x" />Limpiar
          </button>
        )}
      </div>

      {!loading && !error && rows.length > 0 && (
        <Pagination
          compact
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          count={rows.length}
          onPage={setPage}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      <Card noPad>
        {loading ? (
          <LoadingState rows={7} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las facturas simples" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="file"
            title="No hay facturas simples"
            action={
              <Btn variant="primary" icon="plus" onClick={() => nav('factura-simple-nueva')}>
                Crear factura simple
              </Btn>
            }
          >
            {query ? `Sin resultados para "${query}".` : 'Aún no has creado ninguna.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Número</th><th>Cliente</th><th>Fecha</th>
                  <th className="num">Total</th><th style={{ width: 108 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} onClick={() => nav('factura-simple-editar', { kind: 'factura-simple', id: f.id })}>
                    <td>
                      <span className="mono text-sm fw6">{f.no_factura}</span>
                      {f.description && <div className="cell-desc" title={f.description}>{f.description}</div>}
                    </td>
                    <td>
                      <span className="cell-main">{cliente(f)}</span>
                      {f.company_name && f.client_name !== f.company_name && (
                        <div className="cell-sub">{f.company_name}</div>
                      )}
                    </td>
                    <td className="muted text-sm">{fecha(f.date)}</td>
                    <td className="num fw6"><Money value={Number(f.total ?? 0)} cur={false} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row gap-xs">
                        <Btn
                          variant="ghost" size="sm" icon="download"
                          onClick={() => void verPdf(f)}
                          disabled={pdfBusy === f.id}
                          aria-label={`Ver PDF de ${f.no_factura}`}
                        />
                        <Btn
                          variant="ghost" size="sm" icon="trash-2"
                          onClick={() => setConfirmDel(f)}
                          aria-label={`Eliminar ${f.no_factura}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={3} className="fw6 text-sm" style={{ padding: '11px 14px' }}>
                    Total en esta página ({rows.length})
                  </td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}>
                    <Money value={sumaPagina} cur={false} />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && (rows.length > 0 || page > 1) && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          count={rows.length}
          onPage={setPage}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      {confirmDel && (
        <Modal
          title="Eliminar factura simple"
          icon="trash-2"
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setConfirmDel(null)}>Cancelar</Btn>
              <Btn variant="danger" onClick={() => void borrar()} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </Btn>
            </>
          }
        >
          <p className="text-sm">
            Se eliminará la factura <strong>{confirmDel.no_factura}</strong> de{' '}
            {cliente(confirmDel)} y sus líneas. Esta acción no se puede deshacer.
          </p>
        </Modal>
      )}
    </div>
  )
}

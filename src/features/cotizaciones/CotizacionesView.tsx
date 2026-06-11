import { useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Money, Avatar, Card, PageHead, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { ApiError, listCotizaciones, getCotizacionPdf, formatApiDate } from '@/api'
import type { CotizacionRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import { CotizacionFormModal } from './CotizacionFormModal'
import type { Nav } from '@/config/navigation'
import type { FacturaPrefill } from '@/types/domain'

const PAGE_SIZE = 15

/** Borrador de factura a partir de una cotización (cliente + líneas). */
function toFacturaPrefill(c: CotizacionRow): FacturaPrefill {
  return {
    kind: 'factura-prefill',
    clienteId: c.client_id != null ? String(c.client_id) : '',
    clienteNombre: c.client_name || '',
    origen: c.code || `#${c.id}`,
    lineas: (c.items ?? [])
      .filter((it) => (it.description ?? '').trim() !== '')
      .map((it) => ({
        nombre: (it.description ?? '').trim(),
        cantidad: Math.max(1, Number(it.quantity ?? 1)),
        precio: Number(it.amount ?? 0),
      })),
  }
}

/* FISCALO — Cotizaciones (GET /api/cotizaciones) */
export function CotizacionesView({ nav }: { nav: Nav }) {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<{ cotizacion: CotizacionRow | null } | null>(null)
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)

  const { data, error, loading, reload } = useApiQuery(
    ['cotizaciones', 'list', { page, pageSize: PAGE_SIZE, query }],
    () => listCotizaciones({ page, pageSize: PAGE_SIZE, query }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  const openPdf = async (c: CotizacionRow) => {
    setPdfBusy(c.id)
    try {
      presentDocument(await getCotizacionPdf(c.id))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfBusy(null)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead title="Cotizaciones" sub={total != null ? `${total} cotizaciones registradas` : 'Propuestas para tus clientes'}
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => setModal({ cotizacion: null })}>Nueva cotización</Btn>
          </>
        } />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por código o cliente…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={6} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las cotizaciones" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="file-plus" title="No hay cotizaciones"
            action={<Btn variant="primary" icon="plus" onClick={() => setModal({ cotizacion: null })}>Nueva cotización</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Crea tu primera cotización para enviarla a un cliente.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Código</th><th>Cliente</th><th>Descripción</th><th>Fecha</th><th className="num">Total</th><th style={{ width: 190 }}></th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setModal({ cotizacion: c })}>
                    <td><span className="mono text-sm fw6">{c.code || `#${c.id}`}</span></td>
                    <td><div className="row gap-sm"><Avatar name={c.client_name || '—'} size={28} /><span className="cell-main">{c.client_name || '—'}</span></div></td>
                    <td className="text-sm muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
                    <td className="muted text-sm">{formatApiDate(c.date)}</td>
                    <td className="num fw6"><Money value={Number(c.total ?? 0)} cur={false} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                        <Btn variant="ghost" size="sm" icon="printer" onClick={() => openPdf(c)} disabled={pdfBusy === c.id}>
                          {pdfBusy === c.id ? '…' : 'PDF'}
                        </Btn>
                        <Btn variant="secondary" size="sm" icon="file-text" title="Convertir a factura e-CF"
                          onClick={() => nav('factura-nueva', toFacturaPrefill(c))}>
                          Facturar
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && (rows.length > 0 || page > 1) && (
        <div className="row between mt-md">
          <span className="text-sm muted-3">Página {page}{total != null ? ` · ${total} en total` : ''}</span>
          <div className="row gap-sm">
            <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Btn>
            <Btn variant="secondary" size="sm" iconRight="chevron-right" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}

      {modal && <CotizacionFormModal cotizacion={modal.cotizacion} onClose={() => setModal(null)} />}
    </div>
  )
}

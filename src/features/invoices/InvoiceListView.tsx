import { useState } from 'react'
import { Icon, Btn, Money, EstadoBadge, Card, Tabs, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listFacturas, mapFacturaRow } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import type { Nav } from '@/app/navigation'

const PAGE_SIZE = 10

/* FISCALO — Facturación: listado (GET /api/facturas) */
export function InvoiceListView({ nav }: { nav: Nav }) {
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [tab, setTab] = useState('todas')

  const { data, error, loading, reload } = useAsync(
    () => listFacturas({ page, pageSize: PAGE_SIZE, query }),
    [page, query],
  )

  const rows = (data?.items ?? []).map(mapFacturaRow)
  const total = data?.total ?? null

  const estados = ['Aceptado', 'En proceso', 'Rechazado', 'Pendiente']
  const tabs = [
    { id: 'todas', label: 'Todas', count: rows.length },
    ...estados
      .map((e) => ({ id: e, label: e, count: rows.filter((f) => f.dgii === e).length }))
      .filter((t) => t.count > 0),
  ]
  const filtered = tab === 'todas' ? rows : rows.filter((f) => f.dgii === tab)
  const totalSum = filtered.reduce((a, f) => a + f.total, 0)

  const submitSearch = () => { setQuery(input.trim()); setPage(1); setTab('todas') }

  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE

  return (
    <div className="page page-wide">
      <PageHead
        title="Facturación"
        sub={total != null ? `${total} comprobantes emitidos` : 'Comprobantes fiscales electrónicos'}
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Nueva factura</Btn>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="toolbar">
        <form
          className="search-input"
          onSubmit={(e) => { e.preventDefault(); submitSearch() }}
        >
          <Icon name="search" />
          <input placeholder="Buscar por e-NCF, cliente…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && (
          <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}>
            <Icon name="x" />Limpiar
          </button>
        )}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={7} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las facturas" onRetry={reload}>{error}</ErrorState>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="file-text"
            title="No hay facturas aquí"
            action={<Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Crear factura</Btn>}
          >
            {query ? `Sin resultados para "${query}".` : 'Aún no se han emitido comprobantes.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Comprobante</th><th>Cliente</th><th>Tipo</th><th>Fecha</th><th>Estado DGII</th>
                  <th className="num">Total</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} onClick={() => nav('factura-ver', f)}>
                    <td><span className="mono text-sm fw6">{f.ncf}</span></td>
                    <td><span className="cell-main">{f.cliente}</span></td>
                    <td><span className="ecf-tag">e-CF {f.tipo}</span></td>
                    <td className="muted text-sm">{f.fecha}</td>
                    <td>{f.dgii !== '—' ? <EstadoBadge estado={f.dgii} /> : <span className="muted-3">—</span>}</td>
                    <td className="num fw6"><Money value={f.total} cur={false} /></td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={5} className="fw6 text-sm" style={{ padding: '11px 14px' }}>Total en esta página ({filtered.length})</td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={totalSum} cur={false} /></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && (filtered.length > 0 || page > 1) && (
        <div className="row between mt-md">
          <span className="text-sm muted-3">Página {page}{total != null ? ` · ${total} en total` : ''}</span>
          <div className="row gap-sm">
            <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Btn>
            <Btn variant="secondary" size="sm" iconRight="chevron-right" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

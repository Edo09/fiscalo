import { useState } from 'react'
import { Icon, Btn, Money, EstadoBadge, Card, Tabs, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listFacturas, mapFacturaRow } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import type { Nav } from '@/app/navigation'

const PAGE_SIZE = 25

/* FISCALO — Bandeja DGII (facturas filtradas por estado DGII) */
export function DgiiInboxView({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState('todos')
  const { data, error, loading, reload } = useAsync(() => listFacturas({ page: 1, pageSize: PAGE_SIZE }), [])

  const rows = (data?.items ?? []).map(mapFacturaRow)
  const estados = ['Aceptado', 'En proceso', 'Rechazado', 'Pendiente']
  const tabs = [
    { id: 'todos', label: 'Todos', count: rows.length },
    ...estados
      .map((e) => ({ id: e, label: e, count: rows.filter((f) => f.dgii === e).length }))
      .filter((t) => t.count > 0),
  ]
  const filtered = tab === 'todos' ? rows : rows.filter((f) => f.dgii === tab)

  return (
    <div className="page page-wide">
      <PageHead
        crumbs={[{ label: 'e-CF (DGII)', onClick: () => nav('ecf') }, { label: 'Bandeja DGII' }]}
        title="Bandeja DGII"
        sub="Estado de los comprobantes enviados a la Dirección General de Impuestos Internos."
        actions={<Btn variant="secondary" icon="refresh-cw" onClick={reload}>Sincronizar</Btn>}
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudo cargar la bandeja" onRetry={reload}>{error}</ErrorState>
        ) : filtered.length === 0 ? (
          <EmptyState icon="inbox" title="Bandeja vacía">No hay comprobantes en este estado.</EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>e-CF</th><th>Tipo</th><th>Cliente</th><th className="num">Monto</th><th>Track ID</th><th>Estado</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} onClick={() => nav('factura-ver', f)}>
                    <td className="mono text-sm fw6">{f.ncf}</td>
                    <td><span className="ecf-tag">{f.tipo}</span></td>
                    <td className="text-sm">{f.cliente}</td>
                    <td className="num fw6"><Money value={f.total} cur={false} /></td>
                    <td className="mono text-xs muted">{f.trackId ?? '—'}</td>
                    <td>{f.dgii !== '—' ? <EstadoBadge estado={f.dgii} /> : <span className="muted-3">—</span>}</td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

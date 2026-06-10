import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, Badge, EstadoBadge, Card, KPI, Tabs, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listGastos, getGastoStats } from '@/api'
import type { GastoCategoria, GastoRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CATEGORIA_LABEL, categoriaLabel, gastoEstadoLabel, tipoLabel } from '@/app/gastos'
import { GastoFormModal } from './GastoFormModal'
import { GastoDetailDrawer } from './GastoDetailDrawer'

const PAGE_SIZE = 10

/* FISCALO — Gastos (GET /api/gastos + /stats, POST /api/gastos) */
export function ExpensesView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'todos' | GastoCategoria>('todos')
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<GastoRow | null>(null)

  const categoria = tab === 'todos' ? undefined : tab

  const stats = useApiQuery(['gastos', 'stats'], () => getGastoStats())
  const list = useApiQuery(
    ['gastos', 'list', { page, pageSize: PAGE_SIZE, query, categoria }],
    () => listGastos({ page, pageSize: PAGE_SIZE, query, categoria }),
    { keepPrevious: true },
  )

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? null
  const resumen = stats.data?.resumen
  const porCat = stats.data?.por_categoria ?? []
  const countFor = (c: GastoCategoria) => porCat.find((p) => p.categoria === c)?.total ?? 0

  const tabs = [
    { id: 'todos', label: 'Todos', count: resumen?.total_gastos },
    { id: 'gastos_menores', label: CATEGORIA_LABEL.gastos_menores, count: countFor('gastos_menores') },
    { id: 'facturas_proveedores', label: CATEGORIA_LABEL.facturas_proveedores, count: countFor('facturas_proveedores') },
  ]

  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  const onCreated = () => {
    setFormOpen(false)
    // Invalida TODAS las queries de gastos (listas de otras páginas/tabs y stats).
    void queryClient.invalidateQueries({ queryKey: ['gastos'] })
  }

  return (
    <div className="page page-wide">
      <PageHead title="Gastos" sub="Compras a proveedores y gastos menores (e-CF de costos)"
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={() => { list.reload(); stats.reload() }}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => setFormOpen(true)}>Registrar gasto</Btn>
          </>
        } />

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Total gastos" value={resumen?.total_gastos ?? 0} icon="receipt" iconBg="var(--warning-soft)" iconColor="var(--warning)" />
        <KPI label="Monto total" value={resumen?.monto_total ?? 0} money icon="trending-down" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
        <KPI label="ITBIS" value={resumen?.itbis_total ?? 0} money icon="landmark" />
        <KPI label="Tipos distintos" value={resumen?.tipos_distintos ?? 0} icon="layers" />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(t) => { setTab(t as 'todos' | GastoCategoria); setPage(1) }} />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por NCF, RNC o proveedor…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {list.loading ? (
          <LoadingState rows={7} />
        ) : list.error ? (
          <ErrorState title="No se pudieron cargar los gastos" onRetry={list.reload}>{list.error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="receipt" title="No hay gastos aquí" action={<Btn variant="primary" icon="plus" onClick={() => setFormOpen(true)}>Registrar gasto</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Aún no se han registrado gastos.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tipo</th><th>Proveedor</th><th>NCF</th><th>Categoría</th><th>Fecha</th>
                  <th className="num">ITBIS</th><th className="num">Total</th><th>Estado</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} onClick={() => setDetail(g)}>
                    <td><span className="ecf-tag">{g.tipo_gasto}</span><div className="cell-sub">{tipoLabel(g.tipo_gasto)}</div></td>
                    <td><span className="cell-main">{g.nombre_proveedor ?? '—'}</span><div className="cell-sub mono">{g.rnc_proveedor ?? '—'}</div></td>
                    <td className="mono text-xs muted">{g.ncf ?? '—'}</td>
                    <td><Badge tone="neutral">{categoriaLabel(g.categoria)}</Badge></td>
                    <td className="muted text-sm">{g.fecha ?? '—'}</td>
                    <td className="num muted"><Money value={Number(g.itbis ?? 0)} cur={false} /></td>
                    <td className="num fw6"><Money value={Number(g.total ?? 0)} cur={false} /></td>
                    <td>{g.estado_dgii ? <EstadoBadge estado={gastoEstadoLabel(g.estado_dgii)} /> : <span className="muted-3">—</span>}</td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!list.loading && !list.error && (rows.length > 0 || page > 1) && (
        <div className="row between mt-md">
          <span className="text-sm muted-3">Página {page}{total != null ? ` · ${total} en total` : ''}</span>
          <div className="row gap-sm">
            <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Btn>
            <Btn variant="secondary" size="sm" iconRight="chevron-right" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}

      {formOpen && <GastoFormModal onClose={() => setFormOpen(false)} onCreated={onCreated} />}
      {detail && <GastoDetailDrawer gasto={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// FISCALO — Listado de gastos de UNA categoría (compartido por dos vistas):
//   Gastos  -> categoria="gastos_menores"      (E43, auto-emisión)
//   Compras -> categoria="facturas_proveedores" (E41/E47 auto-emisión + E31/B01/E33/E34 recibidos)
// GET /api/gastos?categoria=... + /api/gastos/stats (KPIs acotados a la categoría).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Card, KPI, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listGastos, getGastoStats } from '@/api'
import type { GastoCategoria, GastoRow, GastoTipo } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CATEGORIA_TIPOS, gastoEstadoLabel, tipoLabel } from '@/config/gastos'
import { GastoFormModal } from './GastoFormModal'
import { GastoDetailDrawer } from './GastoDetailDrawer'

const PAGE_SIZE = 10

export interface GastosListadoProps {
  categoria: GastoCategoria
  title: string
  sub: string
  /** Etiqueta del botón de alta (ej. "Registrar gasto" / "Registrar compra"). */
  ctaLabel: string
  /** Icono del KPI principal y del estado vacío. */
  icon: string
}

export function GastosListado({ categoria, title, sub, ctaLabel, icon }: GastosListadoProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<GastoRow | null>(null)

  const stats = useApiQuery(['gastos', 'stats'], () => getGastoStats())
  const list = useApiQuery(
    ['gastos', 'list', { page, pageSize: PAGE_SIZE, query, categoria }],
    () => listGastos({ page, pageSize: PAGE_SIZE, query, categoria }),
    { keepPrevious: true },
  )

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? null

  // KPIs acotados a ESTA categoría (los stats globales traen por_categoria/por_tipo).
  const cat = (stats.data?.por_categoria ?? []).find((p) => p.categoria === categoria)
  const tiposCat = CATEGORIA_TIPOS[categoria]
  const tiposDistintos = (stats.data?.por_tipo ?? [])
    .filter((t) => tiposCat.includes(t.tipo_gasto as GastoTipo) && t.total > 0).length

  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  const onCreated = () => {
    setFormOpen(false)
    // Invalida TODAS las queries de gastos (ambas vistas, otras páginas y stats).
    void queryClient.invalidateQueries({ queryKey: ['gastos'] })
  }

  return (
    <div className="page page-wide">
      <PageHead title={title} sub={sub}
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={() => { list.reload(); stats.reload() }}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => setFormOpen(true)}>{ctaLabel}</Btn>
          </>
        } />

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Registros" value={cat?.total ?? 0} icon={icon} iconBg="var(--warning-soft)" iconColor="var(--warning)" />
        <KPI label="Monto total" value={Number(cat?.monto_total ?? 0)} money icon="trending-down" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
        <KPI label="ITBIS" value={Number(cat?.itbis_total ?? 0)} money icon="landmark" />
        <KPI label="Tipos distintos" value={tiposDistintos} icon="layers" />
      </div>

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
          <ErrorState title="No se pudieron cargar los registros" onRetry={list.reload}>{list.error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon={icon} title="No hay registros aquí" action={<Btn variant="primary" icon="plus" onClick={() => setFormOpen(true)}>{ctaLabel}</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Aún no se ha registrado nada en esta sección.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tipo</th><th>Proveedor</th><th>NCF</th><th>Fecha</th>
                  <th className="num">ITBIS</th><th className="num">Total</th><th>Estado</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} onClick={() => setDetail(g)}>
                    <td><span className="ecf-tag">{g.tipo_gasto}</span><div className="cell-sub">{tipoLabel(g.tipo_gasto)}</div></td>
                    <td><span className="cell-main">{g.nombre_proveedor ?? '—'}</span><div className="cell-sub mono">{g.rnc_proveedor ?? '—'}</div></td>
                    <td className="mono text-xs muted">{g.ncf ?? '—'}</td>
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

      {formOpen && <GastoFormModal categoria={categoria} onClose={() => setFormOpen(false)} onCreated={onCreated} />}
      {detail && <GastoDetailDrawer gasto={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

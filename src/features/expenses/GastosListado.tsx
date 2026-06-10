// FISCALO — Listado de gastos de UNA categoría (compartido por dos vistas):
//   Gastos  -> categoria="gastos_menores"      (E43, auto-emisión)
//   Compras -> categoria="facturas_proveedores" (E41/E47 auto-emisión + E31/B01/E33/E34 recibidos)
// GET /api/gastos?categoria=... + /api/gastos/stats (KPIs acotados a la categoría).
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Card, KPI, EmptyState, LoadingState, ErrorState, PageHead, Pagination } from '@/components/ui'
import { listGastos, getGastoStats } from '@/api'
import type { GastoCategoria, GastoRow, GastoTipo } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CATEGORIA_TIPOS, gastoEstadoLabel, tipoLabel } from '@/config/gastos'
import { GastoFormModal } from './GastoFormModal'
import { GastoDetailDrawer } from './GastoDetailDrawer'

const PAGE_SIZES = [10, 25, 50]
const SEARCH_DEBOUNCE_MS = 350

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
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<GastoRow | null>(null)

  // Búsqueda servida por el backend: al dejar de teclear (debounce) se fija la
  // consulta y se vuelve a la página 1. Enter la dispara al instante.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim()
      if (q !== query) { setQuery(q); setPage(1) }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, query])

  const stats = useApiQuery(['gastos', 'stats'], () => getGastoStats())
  const list = useApiQuery(
    ['gastos', 'list', { page, pageSize, query, categoria }],
    () => listGastos({ page, pageSize, query, categoria }),
    { keepPrevious: true },
  )

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? null
  const totalPages = list.data?.totalPages ?? null
  const totalSum = rows.reduce((a, g) => a + Number(g.total ?? 0), 0)
  const itbisSum = rows.reduce((a, g) => a + Number(g.itbis ?? 0), 0)

  // KPIs acotados a ESTA categoría (los stats globales traen por_categoria/por_tipo).
  const cat = (stats.data?.por_categoria ?? []).find((p) => p.categoria === categoria)
  const tiposCat = CATEGORIA_TIPOS[categoria]
  const tiposDistintos = (stats.data?.por_tipo ?? [])
    .filter((t) => tiposCat.includes(t.tipo_gasto as GastoTipo) && t.total > 0).length

  const submitSearch = () => { setQuery(input.trim()); setPage(1) }
  const clearSearch = () => { setInput(''); setQuery(''); setPage(1) }
  const changePageSize = (n: number) => { setPageSize(n); setPage(1) }
  const searching = list.fetching && !list.loading

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
          <Icon name={searching ? 'loader' : 'search'} className={searching ? 'spin' : undefined} />
          <input placeholder="Buscar por NCF, RNC o proveedor…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button type="button" className="filter-chip" onClick={clearSearch}><Icon name="x" />Limpiar</button>}
      </div>

      {!list.loading && !list.error && rows.length > 0 && (
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
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={4} className="fw6 text-sm" style={{ padding: '11px 14px' }}>Total en esta página ({rows.length})</td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={itbisSum} cur={false} /></td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={totalSum} cur={false} /></td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {!list.loading && !list.error && (rows.length > 0 || page > 1) && (
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

      {formOpen && <GastoFormModal categoria={categoria} onClose={() => setFormOpen(false)} onCreated={onCreated} />}
      {detail && <GastoDetailDrawer gasto={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

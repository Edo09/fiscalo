import { useEffect } from 'react'
import { Icon, Btn, RefreshButton, Money, EstadoBadge, Card, KPI, EmptyState, LoadingState, ErrorState, PageHead, Pagination } from '@/components/ui'
import { listFacturas, mapFacturaRow, getStats } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFacturasList } from '@/stores/facturasList'
import type { FacturaEstadoUi } from '@/stores/facturasList'
import type { Nav } from '@/config/navigation'

const PAGE_SIZES = [10, 25, 50]
const SEARCH_DEBOUNCE_MS = 500

// Filtros server-side: estado (?estado=) y tipo e-CF (?tipo_ecf=). 'todos' => sin filtro.
const ESTADO_OPCIONES: { value: FacturaEstadoUi; label: string }[] = [
  { value: 'aprobado', label: 'Aprobados' },
  { value: 'rechazado', label: 'Rechazados' },
  { value: 'todos', label: 'Todos' },
]

// Tipos e-CF (e-NCF 001). Valor con prefijo E para el backend (?tipo_ecf=E31).
const TIPO_OPCIONES: { value: string; label: string }[] = [
  { value: 'todos', label: 'Todos los tipos' },
  { value: 'E31', label: 'E31 · Crédito Fiscal' },
  { value: 'E32', label: 'E32 · Consumo' },
  { value: 'E33', label: 'E33 · Nota de Débito' },
  { value: 'E34', label: 'E34 · Nota de Crédito' },
  { value: 'E41', label: 'E41 · Compras' },
  { value: 'E43', label: 'E43 · Gastos Menores' },
  { value: 'E44', label: 'E44 · Régimen Especial' },
  { value: 'E45', label: 'E45 · Gubernamental' },
  { value: 'E46', label: 'E46 · Exportaciones' },
  { value: 'E47', label: 'E47 · Pagos al Exterior' },
]

/* FISCALO — Facturación: listado paginado (GET /api/facturas?query&page&pageSize) */
export function InvoiceListView({ nav }: { nav: Nav }) {
  // Estado persistido fuera del componente: al abrir una factura y volver, los
  // filtros y la página se conservan (el componente se desmonta al navegar).
  const { page, pageSize, input, query, estado, tipo, patch } = useFacturasList()
  const setPage = (p: number) => patch({ page: p })
  const setInput = (v: string) => patch({ input: v })

  // Búsqueda servida por el backend: al dejar de teclear (debounce) se fija la
  // consulta y se vuelve a la página 1. Solo si el texto cambió, para no resetear
  // la página al re-montar (volver del detalle con la misma búsqueda).
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim()
      if (q !== query) patch({ query: q, page: 1 })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, query, patch])

  const { data, error, loading, fetching, reload } = useApiQuery(
    ['facturas', 'list', { page, pageSize, query, estado, tipo }],
    () => listFacturas({
      page,
      pageSize,
      query,
      estado: estado === 'todos' ? undefined : estado,
      tipoEcf: tipo === 'todos' ? undefined : tipo,
    }),
    { keepPrevious: true },
  )

  // KPIs globales (GET /api/facturas/stats) — misma clave que el dashboard e-CF
  // y el formulario de factura: caché compartida.
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const resumen = stats.data?.resumen
  const porEstado = stats.data?.por_estado ?? []
  const aceptados = porEstado
    .filter((e) => ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO'].includes(e.estado))
    .reduce((a, e) => a + e.total, 0)
  const rechazadosBuckets = porEstado.filter((e) => ['RECHAZADO', 'RFCE_RECHAZADO'].includes(e.estado))
  const rechazados = rechazadosBuckets.reduce((a, e) => a + e.total, 0)
  // El "Monto total" excluye los rechazados: un comprobante rechazado no es ingreso.
  const montoTotal = Number(resumen?.monto_total ?? 0) - rechazadosBuckets.reduce((a, e) => a + e.monto_total, 0)

  const rows = (data?.items ?? []).map(mapFacturaRow)
  const total = data?.total ?? null
  const totalPages = data?.totalPages ?? null
  const totalSum = rows.reduce((a, f) => a + f.total, 0)
  const itbisSum = rows.reduce((a, f) => a + f.itbis, 0)

  const submitSearch = () => { patch({ query: input.trim(), page: 1 }) }
  const clearSearch = () => { patch({ input: '', query: '', page: 1 }) }
  const changePageSize = (n: number) => { patch({ pageSize: n, page: 1 }) }
  const changeEstado = (e: FacturaEstadoUi) => { patch({ estado: e, page: 1 }) }
  const changeTipo = (t: string) => { patch({ tipo: t, page: 1 }) }
  const searching = fetching && !loading

  return (
    <div className="page page-wide">
      <PageHead
        title="Facturación"
        sub={total != null ? `${total} comprobantes emitidos` : 'Comprobantes fiscales electrónicos'}
        actions={
          <>
            <RefreshButton onRefresh={() => Promise.all([reload(), stats.reload()])} />
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Nueva factura</Btn>
          </>
        }
      />

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Comprobantes" value={resumen?.total_ecf ?? 0} icon="file-text" />
        <KPI label="Monto total" value={montoTotal} money icon="trending-up" iconBg="var(--success-soft)" iconColor="var(--success)" />
        <KPI label="Aceptados" value={aceptados} icon="check-circle" iconBg="var(--success-soft)" iconColor="var(--success)" />
        <KPI label="Rechazados" value={rechazados} icon="x-circle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
      </div>

      <div className="toolbar">
        <form
          className="search-input"
          onSubmit={(e) => { e.preventDefault(); submitSearch() }}
        >
          <Icon name={searching ? 'loader' : 'search'} className={searching ? 'spin' : undefined} />
          <input placeholder="Buscar por e-NCF, cliente, artículo…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && (
          <button type="button" className="filter-chip" onClick={clearSearch}>
            <Icon name="x" />Limpiar
          </button>
        )}
        <select
          className="select"
          value={estado}
          onChange={(e) => changeEstado(e.target.value as FacturaEstadoUi)}
          aria-label="Filtrar por estado DGII"
          style={{ width: 'auto' }}
        >
          {ESTADO_OPCIONES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="select"
          value={tipo}
          onChange={(e) => changeTipo(e.target.value)}
          aria-label="Filtrar por tipo e-CF"
          style={{ width: 'auto' }}
        >
          {TIPO_OPCIONES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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
          <ErrorState title="No se pudieron cargar las facturas" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="file-text"
            title="No hay facturas aquí"
            action={<Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Crear factura</Btn>}
          >
            {query
              ? `Sin resultados para "${query}".`
              : estado !== 'todos' || tipo !== 'todos'
                ? 'Ninguna factura coincide con los filtros.'
                : 'Aún no se han emitido comprobantes.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Comprobante</th><th>Cliente</th><th>Tipo</th><th>Fecha</th><th>Estado DGII</th>
                  <th className="num">ITBIS</th><th className="num">Total</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} onClick={() => nav('factura-ver', f)}>
                    <td>
                      <span className="mono text-sm fw6">{f.ncf}</span>
                      {f.descripcion && <div className="cell-desc" title={f.descripcion}>{f.descripcion}</div>}
                    </td>
                    <td>
                      <span className="cell-main">{f.cliente}</span>
                      {f.empresa && <div className="cell-sub">{f.empresa}</div>}
                    </td>
                    <td><span className="ecf-tag">E{f.tipo}</span></td>
                    <td className="muted text-sm">{f.fecha}</td>
                    <td>{f.dgii !== '—' ? <EstadoBadge estado={f.dgii} /> : <span className="muted-3">—</span>}</td>
                    <td className="num text-sm muted"><Money value={f.itbis} cur={false} /></td>
                    <td className="num fw6"><Money value={f.total} cur={false} /></td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={5} className="fw6 text-sm" style={{ padding: '11px 14px' }}>Total en esta página ({rows.length})</td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={itbisSum} cur={false} /></td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={totalSum} cur={false} /></td>
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
    </div>
  )
}

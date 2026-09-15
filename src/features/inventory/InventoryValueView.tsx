import { useEffect, useState } from 'react'
import {
  Icon, Btn, Money, Card, Badge, KPI, Drawer, PageHead, Pagination, RefreshButton,
  EmptyState, LoadingState, ErrorState,
} from '@/components/ui'
import { getValorInventario, listMovimientos, listWarehouses, listCategories } from '@/api'
import type { EstadoValorInv, MovimientoRow, ValorInventarioRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { motivoLabel } from './motivos'

/* FISCALO — Inventario > Valor de inventario.
   Cuánto vale lo que hay en almacén, producto por producto, a una fecha de
   corte; y el historial de movimientos de cada uno. Misma estructura que
   Ajustes de inventario: KPIs, barra de filtros y tabla, con el detalle en un
   drawer lateral. */

const PAGE_SIZES = [25, 50, 100]

const ESTADOS: { id: EstadoValorInv; label: string }[] = [
  { id: 'activos', label: 'Ítems activos' },
  { id: 'inactivos', label: 'Ítems inactivos' },
  { id: 'todos', label: 'Todos los ítems' },
]

const fmtFecha = (f?: string | null) => (f ? String(f).slice(0, 16).replace('T', ' ') : '—')
const fmtDia = (f: string) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—')

/** De dónde vino el movimiento y por qué. */
function concepto(m: MovimientoRow): string {
  if (m.referencia_tipo === 'ajuste') {
    return m.motivo ? `Ajuste · ${motivoLabel(m.motivo)}` : 'Ajuste'
  }
  if (m.referencia_tipo === 'factura') {
    if (m.tipo_movimiento === 'DEVOLUCION') return 'Devolución (nota de crédito)'
    return m.tipo_movimiento === 'COMPRA' ? 'Compra (E41)' : 'Venta'
  }
  // Registrado en Compras (/api/gastos): E31/E41/E47 entran, E34 vuelve al proveedor.
  if (m.referencia_tipo === 'gasto') {
    return m.tipo_movimiento === 'DEVOLUCION' ? 'Devolución a proveedor (nota de crédito)' : 'Compra'
  }
  return m.tipo_movimiento || '—'
}

export function InventoryValueView() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [estado, setEstado] = useState<EstadoValorInv>('activos')
  const [hasta, setHasta] = useState('')
  const [detalle, setDetalle] = useState<ValorInventarioRow | null>(null)

  // Buscar sin botón: se espera a que el usuario deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(input.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [input])

  const almacenes = useApiQuery(['warehouses', 'list'], () => listWarehouses({ pageSize: 100 }))
  const categorias = useApiQuery(['categories', 'list'], () => listCategories({ pageSize: 100 }))

  const { data, error, loading, fetching, reload } = useApiQuery(
    ['inventario', 'valor', { page, pageSize, query, warehouseId, categoryId, estado, hasta }],
    () => getValorInventario({
      page, pageSize, query: query || undefined,
      warehouse_id: warehouseId ? Number(warehouseId) : undefined,
      category_id: categoryId ? Number(categoryId) : undefined,
      estado, hasta: hasta || undefined,
    }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const totales = data?.totales
  const total = data?.total ?? null
  const totalPages = total != null ? Math.ceil(total / pageSize) : null

  const filtrar = (fn: () => void) => { fn(); setPage(1) }
  const hayFiltros = !!(query || warehouseId || categoryId || hasta || estado !== 'activos')
  const limpiar = () => filtrar(() => {
    setInput(''); setQuery(''); setWarehouseId(''); setCategoryId(''); setEstado('activos'); setHasta('')
  })

  return (
    <div className="page page-wide">
      <PageHead
        title="Valor de inventario"
        sub={total != null
          ? `${total} ${total === 1 ? 'producto' : 'productos'} en existencia`
          : 'Existencia, costo promedio y valor de lo que hay en almacén'}
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className="kpi-grid compact" style={{ marginBottom: 16 }}>
        <KPI label="Productos" value={totales?.productos ?? 0} icon="package" />
        <KPI
          label="Unidades en existencia"
          value={totales?.existencia ?? 0}
          icon="box"
          iconBg="var(--warning-soft)"
          iconColor="var(--warning)"
        />
        <KPI
          label="Valor del inventario"
          value={totales?.valor ?? 0}
          money
          icon="hand-coins"
          iconBg="var(--success-soft)"
          iconColor="var(--success)"
          foot={hasta ? `al ${fmtDia(hasta)}` : 'a hoy'}
        />
      </div>

      <div className="toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input
            placeholder="Buscar por nombre o SKU…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <select
          className="input" style={{ maxWidth: 180 }} value={warehouseId}
          onChange={(e) => filtrar(() => setWarehouseId(e.target.value))}
          aria-label="Filtrar por almacén"
        >
          <option value="">Todos los almacenes</option>
          {(almacenes.data?.items ?? []).map((w) => (
            <option key={w.id} value={String(w.id)}>{w.nombre}</option>
          ))}
        </select>
        <select
          className="input" style={{ maxWidth: 180 }} value={categoryId}
          onChange={(e) => filtrar(() => setCategoryId(e.target.value))}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {(categorias.data?.items ?? []).map((c) => (
            <option key={c.id} value={String(c.id)}>{c.nombre}</option>
          ))}
        </select>
        <select
          className="input" style={{ maxWidth: 160 }} value={estado}
          onChange={(e) => filtrar(() => setEstado(e.target.value as EstadoValorInv))}
          aria-label="Filtrar por estado del ítem"
        >
          {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <span className="text-xs muted-3">Hasta</span>
        <input
          type="date" className="input" style={{ maxWidth: 155 }} value={hasta}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => filtrar(() => setHasta(e.target.value))}
          aria-label="Existencias hasta esta fecha"
          title="Deja la fecha vacía para ver la existencia de hoy"
        />
        {hayFiltros && (
          <button type="button" className="filter-chip" onClick={limpiar}>
            <Icon name="x" />Limpiar
          </button>
        )}
        {fetching && !loading && <Icon name="loader" className="spin" />}
      </div>

      {hasta && (
        <p className="text-xs muted" style={{ marginTop: -6, marginBottom: 14 }}>
          Existencias al {fmtDia(hasta)}: se parte del saldo de hoy y se deshacen los movimientos
          posteriores a esa fecha.
        </p>
      )}

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudo cargar el valor de inventario" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="package" title="Sin productos">
            {hayFiltros
              ? 'Ningún producto cumple los filtros. Prueba a limpiarlos.'
              : 'Todavía no hay productos con existencia en el catálogo.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Entradas</th>
                  <th style={{ textAlign: 'right' }}>Salidas</th>
                  <th style={{ textAlign: 'right' }}>Existencia</th>
                  <th style={{ textAlign: 'right' }}>Costo promedio</th>
                  <th style={{ textAlign: 'right' }}>Valor inventario</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setDetalle(r)}>
                    <td>
                      <span className="cell-main">{r.nombre}</span>
                      <div className="cell-sub">
                        {r.sku && <span className="mono">{r.sku}</span>}
                        {r.sku && r.categoria ? ' · ' : ''}
                        {r.categoria}
                        {!r.activo && <> · <Badge tone="neutral">Inactivo</Badge></>}
                      </div>
                    </td>
                    <td className="num text-sm" style={r.entradas > 0 ? { color: 'var(--success)' } : undefined}>
                      {r.entradas || '—'}
                    </td>
                    <td className="num text-sm" style={r.salidas > 0 ? { color: 'var(--danger)' } : undefined}>
                      {r.salidas || '—'}
                    </td>
                    {/* Un saldo negativo es un descuadre real, no un cero: se marca. */}
                    <td className="num fw6" style={r.existencia < 0 ? { color: 'var(--danger)' } : undefined}>
                      {r.existencia.toLocaleString('es-DO')}
                    </td>
                    <td className="num text-sm">
                      <Money value={r.costo_promedio} cur={false} />
                      {!r.costo_ponderado && (
                        <div
                          className="cell-sub"
                          title="Sin entradas en el libro: se muestra el costo de la ficha del producto, no un promedio calculado."
                        >
                          de ficha
                        </div>
                      )}
                    </td>
                    <td className="num fw6"><Money value={r.valor_inventario} cur={false} /></td>
                  </tr>
                ))}
              </tbody>
              {totales && (
                <tfoot>
                  <tr>
                    <td colSpan={5} className="fw6 text-sm">
                      Total del inventario ({totales.productos} {totales.productos === 1 ? 'producto' : 'productos'})
                    </td>
                    <td className="num fw6"><Money value={totales.valor} cur={false} /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && rows.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          count={rows.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1) }}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      <p className="text-xs muted-3" style={{ marginTop: 12 }}>
        El costo promedio es el ponderado de las entradas registradas en el libro; los productos sin
        entradas muestran el costo de su ficha. Los servicios no aparecen: no tienen existencia.
      </p>

      {detalle && <MovimientosDrawer producto={detalle} onClose={() => setDetalle(null)} />}
    </div>
  )
}

/* Kardex del producto: todo lo que entró y salió, con su saldo y su valor. */
function MovimientosDrawer({ producto, onClose }: { producto: ValorInventarioRow; onClose: () => void }) {
  const { data, loading, error } = useApiQuery(
    ['inventario', 'movimientos', producto.id],
    () => listMovimientos(producto.id, { pageSize: 100 }),
  )
  const movs = data?.items ?? []

  return (
    <Drawer
      title={producto.nombre}
      sub={[producto.sku, producto.categoria, producto.almacen].filter(Boolean).join(' · ')}
      width={720}
      onClose={onClose}
      footer={<Btn variant="ghost" onClick={onClose}>Cerrar</Btn>}
    >
      <div className="card card-pad mb-md">
        <div className="row between">
          <span className="text-sm muted">Existencia</span>
          <span className="fw6" style={producto.existencia < 0 ? { color: 'var(--danger)' } : undefined}>
            {producto.existencia.toLocaleString('es-DO')}
          </span>
        </div>
        <div className="row between mt-sm">
          <span className="text-sm muted">
            Costo promedio
            {!producto.costo_ponderado && <span className="text-xs muted-3"> · de ficha</span>}
          </span>
          <span className="fw6"><Money value={producto.costo_promedio} cur={false} /></span>
        </div>
        <div className="row between mt-sm">
          <span className="text-sm muted">Valor de inventario</span>
          <span className="fw6"><Money value={producto.valor_inventario} /></span>
        </div>
      </div>

      {loading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState title="No se pudieron cargar los movimientos">{error}</ErrorState>
      ) : movs.length === 0 ? (
        <EmptyState icon="git-compare" title="Sin movimientos">
          Su existencia viene de la carga inicial del catálogo, no de una entrada registrada. El
          primer conteo físico deja el libro cuadrado con lo que hay.
        </EmptyState>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th style={{ textAlign: 'right' }}>Entrada</th>
                <th style={{ textAlign: 'right' }}>Salida</th>
                <th style={{ textAlign: 'right' }}>Existencia</th>
                <th style={{ textAlign: 'right' }}>Costo unit.</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => {
                const cant = Number(m.cantidad)
                return (
                  <tr key={m.id} style={{ cursor: 'default' }}>
                    <td className="muted text-sm">{fmtFecha(m.created_at)}</td>
                    <td className="text-sm">
                      {concepto(m)}
                      {m.ajuste_codigo && <div className="cell-sub mono">{m.ajuste_codigo}</div>}
                    </td>
                    <td className="num fw6" style={cant > 0 ? { color: 'var(--success)' } : undefined}>
                      {cant > 0 ? cant : '—'}
                    </td>
                    <td className="num fw6" style={cant < 0 ? { color: 'var(--danger)' } : undefined}>
                      {cant < 0 ? -cant : '—'}
                    </td>
                    <td className="num">{Number(m.cantidad_nueva).toLocaleString('es-DO')}</td>
                    <td className="num text-sm muted"><Money value={Number(m.costo_unitario)} cur={false} /></td>
                    <td className="num text-sm"><Money value={Number(m.valor_movimiento)} cur={false} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  )
}

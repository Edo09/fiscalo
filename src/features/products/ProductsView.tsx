import { useState } from 'react'
import { Icon, Btn, Money, EstadoBadge, Card, PageHead, LoadingState, ErrorState, EmptyState } from '@/components/ui'
import { listProducts, mapProductRow } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { ProductFormModal } from './ProductFormModal'
import type { Producto } from '@/types/domain'

/* FISCALO — Productos y servicios (GET /api/products) */
export function ProductsView() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todas')
  const [modal, setModal] = useState<{ product: Producto | null } | null>(null)
  const { data, error, loading, reload } = useAsync(() => listProducts({ pageSize: 100 }), [])

  const productos = (data?.items ?? []).map(mapProductRow)
  const cats = ['Todas', ...new Set(productos.map((p) => p.cat))]
  const rows = productos.filter(
    (p) => (cat === 'Todas' || p.cat === cat) && (p.nombre + p.sku).toLowerCase().includes(q.toLowerCase()),
  )
  const bajos = productos.filter((p) => p.estado === 'Bajo' || p.estado === 'Agotado').length

  return (
    <div className="page page-wide">
      <PageHead title="Productos y servicios" sub={`${productos.length} artículos en el catálogo`}
        actions={<><Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn><Btn variant="primary" icon="plus" onClick={() => setModal({ product: null })}>Nuevo producto</Btn></>} />

      {bajos > 0 && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--warning-soft)', borderColor: 'transparent', color: 'var(--warning)' }}>
          <Icon name="alert-triangle" size={16} /><span className="fw6 text-sm">{bajos} productos necesitan reabastecimiento</span>
        </div>
      )}

      <div className="toolbar">
        <div className="search-input"><Icon name="search" /><input placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cats.map((c) => <button key={c} className={'filter-chip' + (cat === c ? ' active' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los productos" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="package" title="No hay productos">
            {productos.length === 0 ? 'Aún no hay productos en el catálogo.' : `Sin resultados para los filtros actuales.`}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Existencia</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setModal({ product: p })}>
                    <td><div className="row gap-sm"><span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 30, height: 30 }}><Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} /></span><div><span className="cell-main">{p.nombre}</span><div className="cell-sub">{p.tipo} · {p.itbis > 0 ? `ITBIS ${p.itbis}%` : 'Exento'}</div></div></div></td>
                    <td className="mono text-sm muted">{p.sku || '—'}</td>
                    <td className="text-sm">{p.cat}</td>
                    <td className="num muted">{p.costo ? <Money value={p.costo} cur={false} /> : '—'}</td>
                    <td className="num fw6"><Money value={p.precio} cur={false} /></td>
                    <td className="num">{p.stock === null ? <span className="muted-3">N/A</span> : p.stock}</td>
                    <td><EstadoBadge estado={p.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && <ProductFormModal product={modal.product} onClose={() => setModal(null)} onSaved={reload} />}
    </div>
  )
}

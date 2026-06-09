import { useState } from 'react'
import { Icon, Btn, Money, EstadoBadge, Card, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Productos y servicios */
export function ProductsView() {
  const D = DATA
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todas')
  const cats = ['Todas', ...new Set(D.productos.map((p) => p.cat))]
  const rows = D.productos.filter((p) => (cat === 'Todas' || p.cat === cat) && (p.nombre + p.sku).toLowerCase().includes(q.toLowerCase()))
  const bajos = D.productos.filter((p) => p.estado === 'Bajo' || p.estado === 'Agotado').length

  return (
    <div className="page page-wide">
      <PageHead title="Productos y servicios" sub={`${D.productos.length} artículos en el catálogo`}
        actions={<><Btn variant="secondary" icon="tag">Categorías</Btn><Btn variant="primary" icon="plus">Nuevo producto</Btn></>} />

      {bajos > 0 && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--warning-soft)', borderColor: 'transparent', color: 'var(--warning)' }}>
          <Icon name="alert-triangle" size={16} /><span className="fw6 text-sm">{bajos} productos necesitan reabastecimiento</span>
          <Btn variant="ghost" size="sm" iconRight="arrow-right" style={{ marginLeft: 'auto', color: 'var(--warning)' }}>Ver inventario</Btn>
        </div>
      )}

      <div className="toolbar">
        <div className="search-input"><Icon name="search" /><input placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cats.map((c) => <button key={c} className={'filter-chip' + (cat === c ? ' active' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>

      <Card noPad>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Existencia</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><div className="row gap-sm"><span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 30, height: 30 }}><Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} /></span><div><span className="cell-main">{p.nombre}</span><div className="cell-sub">{p.tipo} · ITBIS {p.itbis}%</div></div></div></td>
                  <td className="mono text-sm muted">{p.sku}</td>
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
      </Card>
    </div>
  )
}

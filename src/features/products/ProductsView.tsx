import { useEffect, useState } from 'react'
import { Icon, Btn, RefreshButton, Money, EstadoBadge, Card, PageHead, LoadingState, ErrorState, EmptyState } from '@/components/ui'
import { listCategories, listProducts, mapProductRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ProductFormModal } from './ProductFormModal'
import type { Producto } from '@/types/domain'

/* FISCALO — Productos y servicios (GET /api/products) */
export function ProductsView() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todas')
  const [modal, setModal] = useState<{ product: Producto | null } | null>(null)

  // La busqueda va al servidor: el catalogo tiene cientos de articulos y filtrar
  // solo la primera pagina dejaria fuera la mayoria. Con el buscador vacio se
  // reusa la misma clave de cache que el resto de la app.
  const [qDebounced, setQDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  // Sin filtros se reusa la clave compartida con los selectores de producto de
  // facturas y cotizaciones; con filtros, cada combinacion es su propia entrada.
  const catId = cat === 'Todas' ? null : Number(cat)
  const filtrando = qDebounced !== '' || catId != null
  const { data, error, loading, fetching, reload } = useApiQuery(
    filtrando ? ['products', 'list', qDebounced, catId] : ['products', 'list'],
    () => listProducts({
      pageSize: 100,
      query: qDebounced || undefined,
      categoryId: catId ?? undefined,
    }),
    { keepPrevious: true },
  )
  // Los chips salen del catalogo de categorias, no de los productos cargados:
  // derivarlos de la pagina cargada dejaria fuera las categorias que no salieron
  // en ella, y al buscar desapareceria el chip activo con el filtro puesto.
  // Misma clave que el formulario de producto => cache compartida.
  const categorias = useApiQuery(['categories', 'list'], () => listCategories({ pageSize: 100 }))

  // Texto y categoria los filtra el servidor: estas son ya las filas a pintar.
  const rows = (data?.items ?? []).map(mapProductRow)
  const cats = [
    { id: 'Todas', nombre: 'Todas' },
    ...(categorias.data?.items ?? []).map((c) => ({ id: String(c.id), nombre: c.nombre || '—' })),
  ]
  const bajos = rows.filter((p) => p.estado === 'Bajo' || p.estado === 'Agotado').length
  // `total` viene filtrado por el backend; puede ser mayor que lo cargado porque
  // solo se pide una pagina de 100.
  const total = data?.total ?? rows.length
  const hayMas = total > rows.length

  return (
    <div className="page page-wide">
      <PageHead title="Productos y servicios"
        sub={(filtrando
          ? `${total} ${total === 1 ? 'resultado' : 'resultados'}`
          : `${total} ${total === 1 ? 'artículo' : 'artículos'} en el catálogo`)
          + (hayMas ? ` · se muestran los ${rows.length} más recientes` : '')}
        actions={<><RefreshButton onRefresh={reload} /><Btn variant="primary" icon="plus" onClick={() => setModal({ product: null })}>Nuevo producto</Btn></>} />

      {/* Es un dato del catalogo completo: con un filtro activo contaria solo
          los resultados, asi que se oculta en vez de decir otra cosa. */}
      {bajos > 0 && !filtrando && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--warning-soft)', borderColor: 'transparent', color: 'var(--warning)' }}>
          <Icon name="alert-triangle" size={16} /><span className="fw6 text-sm">{bajos} productos necesitan reabastecimiento</span>
        </div>
      )}

      <div className="toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input placeholder="Buscar por nombre, SKU o categoría…" value={q} onChange={(e) => setQ(e.target.value)} />
          {fetching && !loading && <Icon name="loader" className="spin" />}
        </div>
        {cats.map((c) => <button key={c.id} className={'filter-chip' + (cat === c.id ? ' active' : '')} onClick={() => setCat(c.id)}>{c.nombre}</button>)}
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los productos" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="package" title={filtrando ? 'Sin resultados' : 'No hay productos'}>
            {qDebounced
              ? `Ningún producto coincide con «${qDebounced}»${catId != null ? ' en esta categoría' : ''}.`
              : catId != null
                ? 'Ningún producto en esta categoría.'
                : 'Aún no hay productos en el catálogo.'}
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

// Catálogo táctil de la caja (api-gratex docs/specs/pos.md C3 y C4): buscador,
// chips de categoría y grilla de productos. Tocar una tarjeta agrega 1 unidad.
// La búsqueda es en memoria y, mientras hay texto, busca en todas las categorías.
import { useMemo, type RefObject } from 'react'
import { Btn, Icon } from '@/components/ui'
import { colorFor, fmtCantidad } from '@/lib/format'
import type { CatalogoPos, ProductoPos } from './api'
import { coincide, formatoCentavos, iniciales, semaforo } from './montos'

interface Props {
  catalogo: CatalogoPos | null
  /** Error al cargar el catálogo (con catálogo previo, se sigue mostrando ese). */
  error: string | null
  onReintentar: () => void
  busqueda: string
  onBusqueda: (texto: string) => void
  /** null = Todos. */
  categoria: number | null
  onCategoria: (c: number | null) => void
  buscadorRef: RefObject<HTMLInputElement>
  /** Cantidad de cada producto que ya está en el carrito. */
  enCarrito: Map<number, number>
  onAgregar: (p: ProductoPos) => void
  /** Cobro sin confirmar: la venta no se puede cambiar hasta reintentarlo. */
  bloqueado?: boolean
}

const SIN_CATEGORIA = '#7a8699'

/** Productos visibles con la búsqueda y la categoría (la búsqueda manda). */
function filtrar(catalogo: CatalogoPos | null, busqueda: string, categoria: number | null): ProductoPos[] {
  if (!catalogo) return []
  if (busqueda.trim() !== '') return catalogo.productos.filter((p) => coincide(p, busqueda))
  if (categoria === null) return catalogo.productos
  return catalogo.productos.filter((p) => p.category_id === categoria)
}

function Existencia({ p }: { p: ProductoPos }) {
  switch (semaforo(p.stock, p.stock_minimo)) {
    case 'servicio': return <span className="pos-exist">Servicio</span>
    case 'agotado': return <span className="pos-exist agotado">Agotado</span>
    case 'bajo': return <span className="pos-exist bajo">Quedan {fmtCantidad(p.stock)}</span>
    default: return <span className="pos-exist">{fmtCantidad(p.stock)} disp.</span>
  }
}

export function CatalogoPanel({
  catalogo, error, onReintentar, busqueda, onBusqueda, categoria, onCategoria, buscadorRef, enCarrito, onAgregar,
  bloqueado = false,
}: Props) {
  const colores = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of catalogo?.categorias ?? []) m.set(c.id, colorFor(c.nombre))
    return m
  }, [catalogo])
  const productos = useMemo(() => filtrar(catalogo, busqueda, categoria), [catalogo, busqueda, categoria])
  const buscando = busqueda.trim() !== ''

  return (
    <section className="pos-catalogo" aria-label="Catálogo">
      <div className="pos-buscador">
        <Icon name="search" size={20} />
        <input
          ref={buscadorRef}
          value={busqueda}
          onChange={(e) => onBusqueda(e.target.value)}
          onKeyDown={(e) => {
            // Enter con un solo resultado lo agrega: búsqueda + Enter sin tocar la pantalla.
            if (e.key === 'Enter' && productos.length === 1 && !bloqueado) {
              e.preventDefault()
              onAgregar(productos[0])
              onBusqueda('')
            }
          }}
          placeholder="Buscar por nombre o código (F1)"
          aria-label="Buscar producto"
          autoComplete="off"
          spellCheck={false}
        />
        {busqueda !== '' && (
          <button type="button" className="pos-buscador-limpiar" onClick={() => { onBusqueda(''); buscadorRef.current?.focus() }}
            aria-label="Limpiar búsqueda">
            <Icon name="x" size={18} />
          </button>
        )}
      </div>

      {catalogo && catalogo.categorias.length > 0 && (
        <div className="pos-chips" role="tablist" aria-label="Categorías">
          <button type="button" role="tab" aria-selected={!buscando && categoria === null}
            className={'pos-chip' + (!buscando && categoria === null ? ' on' : '')}
            onClick={() => { onBusqueda(''); onCategoria(null) }}>
            Todos <span>{catalogo.productos.length}</span>
          </button>
          {catalogo.categorias.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={!buscando && categoria === c.id}
              className={'pos-chip' + (!buscando && categoria === c.id ? ' on' : '')}
              onClick={() => { onBusqueda(''); onCategoria(c.id) }}>
              <i style={{ background: colores.get(c.id) }} />{c.nombre} <span>{c.productos}</span>
            </button>
          ))}
        </div>
      )}

      {error && catalogo && (
        <div className="pos-aviso" style={{ margin: 0 }}>
          <Icon name="alert-triangle" size={16} />
          <span>No se pudo actualizar el catálogo; se muestra el último que llegó. {error}</span>
        </div>
      )}

      <div className="pos-grilla">
        {!catalogo ? (
          error ? (
            <div className="pos-grilla-vacia">
              <Icon name="alert-circle" size={30} style={{ color: 'var(--danger)' }} />
              <p>{error}</p>
              <Btn variant="primary" icon="refresh-cw" onClick={onReintentar}>Reintentar</Btn>
            </div>
          ) : (
            <div className="pos-grilla-vacia"><div className="spinner" style={{ width: 30, height: 30, borderWidth: 3 }} /></div>
          )
        ) : productos.length === 0 ? (
          <div className="pos-grilla-vacia">
            <Icon name={buscando ? 'search' : 'package'} size={30} style={{ color: 'var(--text-3)' }} />
            <p>
              {buscando
                ? `Nada coincide con "${busqueda.trim()}".`
                : catalogo.productos.length === 0
                  ? 'No hay productos para vender. Se cargan en FiscalPoint → Productos y servicios (activos y facturables).'
                  : 'Esta categoría no tiene productos.'}
            </p>
          </div>
        ) : (
          productos.map((p) => {
            const cant = enCarrito.get(p.id) ?? 0
            const agotado = p.stock !== null && p.stock <= 0
            return (
              <button key={p.id} type="button" className={'pos-producto' + (agotado ? ' agotado' : '') + (cant > 0 ? ' en-carrito' : '')}
                onClick={() => onAgregar(p)} disabled={bloqueado} aria-label={`Agregar ${p.nombre}, ${formatoCentavos(p.precio_centavos)} pesos`}>
                <span className="pos-producto-top">
                  <span className="pos-ini" style={{ background: p.category_id !== null ? colores.get(p.category_id) ?? SIN_CATEGORIA : SIN_CATEGORIA }}>
                    {iniciales(p.nombre)}
                  </span>
                  {cant > 0 && <span className="pos-producto-cant">×{fmtCantidad(cant)}</span>}
                </span>
                <span className="pos-producto-nombre">{p.nombre}</span>
                {p.sku && <span className="pos-producto-sku">{p.sku}</span>}
                <span className="pos-producto-pie">
                  <b className="pos-producto-precio">{formatoCentavos(p.precio_centavos)}</b>
                  <Existencia p={p} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}

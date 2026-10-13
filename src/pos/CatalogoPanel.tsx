// Catálogo táctil de la caja (api-gratex docs/specs/pos.md C3 y C4): buscador,
// chips de categoría y grilla de productos. Tocar una tarjeta agrega 1 unidad.
// La foto (o las iniciales) va grande y centrada; con el producto en la venta,
// sobre el borde de la tarjeta: arriba a la derecha el − y el contador, arriba a
// la izquierda el botón que lo quita de la venta.
// La búsqueda es en memoria y, mientras hay texto, busca en todas las categorías.
// Vista (tarjetas, compacta, lista), orden y cuántos se pintan son preferencia
// del equipo (catalogoVista.ts). Con muchas categorías, "Todas" las despliega.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Btn, Icon } from '@/components/ui'
import { fmtCantidad } from '@/lib/format'
import { colorDeCategoria } from '@/features/categories/colores'
import { API_BASE_URL } from '@/api/config'
import { urlFoto } from '@/lib/fotoProducto'
import type { CatalogoPos, ProductoPos } from './api'
import { coincide, formatoCentavos, iniciales, semaforo } from './montos'
import {
  cargarPreferencias, guardarPreferencias, limitar, LIMITES, ordenar, ORDENES, VISTAS, type PreferenciasCatalogo,
} from './catalogoVista'
import { SelectorCaja } from './SelectorCaja'

interface Props {
  catalogo: CatalogoPos | null
  /** Error al cargar el catálogo (con catálogo previo, se sigue mostrando ese). */
  error: string | null
  onReintentar: () => void
  /** Botón Actualizar (y F5): trae de nuevo catálogo y estado sin recargar la página (sin PIN). */
  onRecargar: () => void
  recargando: boolean
  /** Recién actualizado: el botón muestra la marca de listo un instante. */
  recargado: boolean
  busqueda: string
  onBusqueda: (texto: string) => void
  /** null = Todos. */
  categoria: number | null
  onCategoria: (c: number | null) => void
  buscadorRef: RefObject<HTMLInputElement>
  /** Cantidad de cada producto que ya está en el carrito. */
  enCarrito: Map<number, number>
  onAgregar: (p: ProductoPos) => void
  /** Una unidad menos; con una sola, sale de la venta (queda registrada, V4). */
  onQuitarUno: (p: ProductoPos) => void
  /** Fuera de la venta con todas sus unidades (queda registrado, V4). */
  onQuitar: (p: ProductoPos) => void
  /** Cobro sin confirmar: la venta no se puede cambiar hasta reintentarlo. */
  bloqueado?: boolean
}

const SIN_CATEGORIA = '#7a8699'

/** La foto del producto o, sin foto (o si no carga), sus iniciales en el color de la categoría. */
function Marca({ p, color }: { p: ProductoPos; color: string }) {
  const [rota, setRota] = useState(false)
  const src = urlFoto(API_BASE_URL, p.imagen)
  return src && !rota ? (
    <span className="pos-ini con-foto"><img src={src} alt="" loading="lazy" draggable={false} onError={() => setRota(true)} /></span>
  ) : (
    <span className="pos-ini" style={{ background: color }}>{iniciales(p.nombre)}</span>
  )
}

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
  catalogo, error, onReintentar, onRecargar, recargando, recargado, busqueda, onBusqueda, categoria, onCategoria,
  buscadorRef, enCarrito, onAgregar, onQuitarUno, onQuitar, bloqueado = false,
}: Props) {
  const colores = useMemo(() => {
    const m = new Map<number, string>()
    // El color elegido en app.* (Categorías) o, sin elegir, el calculado del nombre.
    for (const c of catalogo?.categorias ?? []) m.set(c.id, colorDeCategoria(c.nombre, c.color))
    return m
  }, [catalogo])
  const [prefs, setPrefs] = useState<PreferenciasCatalogo>(cargarPreferencias)
  useEffect(() => { guardarPreferencias(prefs) }, [prefs])
  const productos = useMemo(() => ordenar(filtrar(catalogo, busqueda, categoria), prefs.orden), [catalogo, busqueda, categoria, prefs.orden])
  const { visibles, ocultos } = limitar(productos, prefs.limite)
  const buscando = busqueda.trim() !== ''

  // Categorías: una fila que se desliza; si no caben, "Todas" las muestra en varias filas.
  const chipsRef = useRef<HTMLDivElement>(null)
  const [desborda, setDesborda] = useState(false)
  const [abiertas, setAbiertas] = useState(false)
  useLayoutEffect(() => {
    const el = chipsRef.current
    if (!el) return
    // Abiertas en varias filas nada desborda: vale lo medido con la fila plegada (si
    // no, al plegar el botón "Todas" desaparecería un instante y la fila saltaría).
    const medir = () => { if (!abiertas) setDesborda(el.scrollWidth > el.clientWidth + 1) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [catalogo, abiertas])
  const elegirCategoria = (c: number | null) => {
    onBusqueda('')
    onCategoria(c)
    setAbiertas(false)
  }
  // Al plegarlas, que la elegida quede a la vista en la fila.
  useEffect(() => {
    if (!abiertas) chipsRef.current?.querySelector('.pos-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [abiertas, categoria])

  return (
    <section className="pos-catalogo" aria-label="Catálogo">
      <div className="pos-catalogo-cab">
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
        <div className="pos-catalogo-herr">
          <div className="pos-vistas" role="radiogroup" aria-label="Vista del catálogo">
            {VISTAS.map((v) => (
              <button key={v.valor} type="button" role="radio" aria-checked={prefs.vista === v.valor} title={v.nombre} aria-label={v.nombre}
                className={prefs.vista === v.valor ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, vista: v.valor }))}>
                <Icon name={v.icono} size={20} />
              </button>
            ))}
          </div>
          <SelectorCaja rotulo="Ordenar" titulo="Ordenar productos por" icono="arrow-up-down" valor={prefs.orden} opciones={ORDENES}
            onCambio={(orden) => setPrefs((p) => ({ ...p, orden }))} />
          <SelectorCaja rotulo="Mostrar" titulo="Productos en pantalla" icono="layers" valor={prefs.limite} opciones={LIMITES}
            onCambio={(limite) => setPrefs((p) => ({ ...p, limite }))} />
          <button
            type="button"
            className={'pos-recargar' + (recargando ? ' girando' : '') + (recargado ? ' listo' : '')}
            onClick={onRecargar}
            disabled={recargando}
            title="Actualizar productos y precios (F5)"
            aria-label={recargado ? 'Catálogo actualizado' : 'Actualizar productos y precios'}
          >
            <Icon name={recargado ? 'check' : 'refresh-cw'} size={20} />
          </button>
        </div>
      </div>

      {catalogo && catalogo.categorias.length > 0 && (
        <div className={'pos-chips-fila' + (abiertas ? ' abiertas' : '')}>
          <div ref={chipsRef} className="pos-chips" role="tablist" aria-label="Categorías">
            <button type="button" role="tab" aria-selected={!buscando && categoria === null}
              className={'pos-chip' + (!buscando && categoria === null ? ' on' : '')}
              onClick={() => elegirCategoria(null)}>
              Todos <span>{catalogo.productos.length}</span>
            </button>
            {catalogo.categorias.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={!buscando && categoria === c.id}
                className={'pos-chip' + (!buscando && categoria === c.id ? ' on' : '')}
                onClick={() => elegirCategoria(c.id)}>
                <i style={{ background: colores.get(c.id) }} />{c.nombre} <span>{c.productos}</span>
              </button>
            ))}
          </div>
          {(desborda || abiertas) && (
            <button type="button" className="pos-chips-mas" aria-expanded={abiertas} onClick={() => setAbiertas((a) => !a)}>
              <Icon name="chevron-down" size={18} />{abiertas ? 'Menos' : `Todas (${catalogo.categorias.length})`}
            </button>
          )}
        </div>
      )}

      {error && catalogo && (
        <div className="pos-aviso" style={{ margin: 0 }}>
          <Icon name="alert-triangle" size={16} />
          <span>No se pudo actualizar el catálogo; se muestra el último que llegó. {error}</span>
        </div>
      )}

      <div key={prefs.vista} className={'pos-grilla vista-' + prefs.vista}>
        {!catalogo ? (
          error ? (
            <div className="pos-grilla-vacia">
              <Icon name="alert-circle" size={30} style={{ color: 'var(--danger)' }} />
              <p>{error}</p>
              <Btn variant="primary" icon="refresh-cw" onClick={onReintentar}>Reintentar</Btn>
            </div>
          ) : (
            // Cargando: tarjetas fantasma con el tamaño de la vista elegida.
            Array.from({ length: 12 }, (_, i) => <div key={i} className="pos-esqueleto" aria-hidden="true" />)
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
          visibles.map((p) => {
            const cant = enCarrito.get(p.id) ?? 0
            const agotado = p.stock !== null && p.stock <= 0
            // Los botones van fuera de la tarjeta (un botón no puede ir dentro de
            // otro), montados sobre su borde en las esquinas de arriba; la grilla
            // deja aire alrededor para que no se monten sobre la vecina.
            return (
              <div key={p.id} className="pos-producto-celda">
                <button type="button" className={'pos-producto' + (agotado ? ' agotado' : '') + (cant > 0 ? ' en-carrito' : '')}
                  onClick={() => onAgregar(p)} disabled={bloqueado} aria-label={`Agregar ${p.nombre}, ${formatoCentavos(p.precio_centavos)} pesos`}>
                  <span className="pos-producto-top">
                    <Marca key={p.imagen ?? ''} p={p} color={p.category_id !== null ? colores.get(p.category_id) ?? SIN_CATEGORIA : SIN_CATEGORIA} />
                  </span>
                  <span className="pos-producto-nombre">{p.nombre}</span>
                  {p.sku && <span className="pos-producto-sku">{p.sku}</span>}
                  <span className="pos-producto-pie">
                    <b className="pos-producto-precio"><span className="pos-moneda">RD$</span>{formatoCentavos(p.precio_centavos)}</b>
                    <Existencia p={p} />
                  </span>
                </button>
                {cant > 0 && (
                  <>
                    <button type="button" className="pos-producto-quitar" onClick={() => onQuitar(p)} disabled={bloqueado}
                      aria-label={`Quitar ${p.nombre} de la venta`} title="Quitar de la venta">
                      <Icon name="trash-2" size={16} />
                    </button>
                    <span className="pos-producto-paso">
                      <button type="button" className="pos-producto-menos" onClick={() => onQuitarUno(p)} disabled={bloqueado}
                        aria-label={cant > 1 ? `Quitar una unidad de ${p.nombre}` : `Quitar ${p.nombre} de la venta`}>
                        <Icon name="minus" size={17} />
                      </button>
                      <span key={cant} className="pos-producto-cant">×{fmtCantidad(cant)}</span>
                    </span>
                  </>
                )}
              </div>
            )
          })
        )}
        {ocultos > 0 && (
          <div className="pos-grilla-mas">
            <span>Se muestran {visibles.length} de {productos.length} productos. Busca o elige una categoría para encontrar los demás.</span>
            <Btn size="sm" onClick={() => setPrefs((p) => ({ ...p, limite: 0 }))}>Mostrar todos</Btn>
          </div>
        )}
      </div>
    </section>
  )
}

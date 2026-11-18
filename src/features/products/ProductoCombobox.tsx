// FISCALO — Buscador del catálogo para AGREGAR productos a un documento.
// A diferencia de ProveedorCombobox no guarda un valor: cada elección se le
// entrega al padre, que arma la línea, y el buscador queda listo para la
// siguiente. Busca en el servidor con debounce: el catálogo tiene cientos de
// artículos y filtrar solo la primera página dejaría fuera la mayoría.
import { useEffect, useRef, useState } from 'react'
import { Icon, Money, Spinner } from '@/components/ui'
import { listProducts, mapProductRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { fmtCantidad, fmtPrecio } from '@/lib/format'
import { eleccionDePrecio, precioParaMostrar, type NumeroLista } from '@/lib/listasPrecio'
import type { Producto } from '@/types/domain'
import { ElegirPrecio } from './ElegirPrecio'

interface ProductoComboboxProps {
  /**
   * `precio` solo viaja con `mostrarPrecio`: el de la lista que se eligió. Un producto con varias
   * listas de precio pregunta antes (ElegirPrecio, dentro del desplegable); con una sola se agrega ya.
   * Sin `mostrarPrecio` (gasto, conduce) no se pregunta nada: llega solo el producto.
   */
  onSelect: (producto: Producto, precio?: number) => void
  placeholder?: string
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
  /**
   * Muestra el precio de venta en vez del costo. Un gasto se piensa en lo que
   * cuesta el artículo; una cotización, en lo que paga el cliente.
   */
  mostrarPrecio?: boolean
  /**
   * Lista de precio por defecto del cliente del documento (solo con `mostrarPrecio`): un producto que
   * la ofrece se agrega a ese precio sin preguntar, y su fila lo dice. Sin ella, la regla de siempre.
   */
  listaCliente?: NumeroLista | null
  /**
   * No muestra ningún monto (ni costo ni precio): para un documento sin
   * precios, como el conduce. La línea de abajo (SKU, categoría, existencia)
   * se queda: es lo que una entrega necesita ver.
   */
  ocultarMonto?: boolean
}

export function ProductoCombobox({
  onSelect,
  placeholder = 'Buscar producto por nombre, SKU o categoría…',
  debounceMs = 250,
  mostrarPrecio = false,
  listaCliente,
  ocultarMonto = false,
}: ProductoComboboxProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /** Producto con varias listas de precio que espera a que se elija una. */
  const [elegir, setElegir] = useState<Producto | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  const { data, loading, error, fetching } = useApiQuery(
    ['products', 'search', query],
    () => listProducts({ query: query || undefined, pageSize: 8 }),
    { keepPrevious: true },
  )
  const rows = (data?.items ?? []).map(mapProductRow)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setElegir(null) }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const terminar = (p: Producto, precio?: number) => {
    if (precio === undefined) onSelect(p)
    else onSelect(p, precio)
    setInput('')
    setOpen(false)
    setElegir(null)
  }
  const select = (p: Producto) => {
    if (!mostrarPrecio) { terminar(p); return }
    const e = eleccionDePrecio(p, listaCliente)
    if (e.tipo === 'directo') terminar(p, e.precio)
    else setElegir(p)
  }
  // Lo que dice la fila con precios: el precio con sus decimales (hasta 4: es el que se copia a la
  // línea) y, debajo, "3 precios" (al elegirlo se pregunta cuál usar) o "Precio 2 · cliente" (se
  // agrega a la lista del cliente sin preguntar).
  const precioDeFila = (p: Producto) => {
    const { precio, etiqueta } = precioParaMostrar(p, listaCliente)
    return <>Precio <span className="num">{fmtPrecio(precio)}</span>{etiqueta && <><br />{etiqueta}</>}</>
  }

  return (
    <div ref={ref} className="combobox">
      <div className="search-input" style={{ width: '100%' }}>
        <Icon name="package" />
        <input
          placeholder={placeholder}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {fetching && <Spinner />}
      </div>

      {open && (
        <div className="menu combobox-menu">
          {elegir ? (
            <ElegirPrecio producto={elegir} onElegir={(precio) => terminar(elegir, precio)} onVolver={() => setElegir(null)} />
          ) : error ? (
            <div className="combobox-msg" style={{ color: 'var(--danger)' }}>{error}</div>
          ) : loading && rows.length === 0 ? (
            <div className="combobox-msg row gap-sm" style={{ justifyContent: 'center' }}><Spinner /> Buscando…</div>
          ) : rows.length === 0 ? (
            <div className="combobox-msg">
              {query ? `Ningún producto coincide con “${query}”.` : 'No hay productos en el catálogo.'}
            </div>
          ) : (
            rows.map((p) => (
              <div
                key={p.id}
                className="combobox-item row between gap-sm"
                style={{ alignItems: 'center' }}
                onClick={() => select(p)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="cell-main">{p.nombre}</div>
                  <div className="cell-sub mono">
                    {[p.sku, p.cat !== '—' ? p.cat : '', p.tipo === 'Servicio' ? 'Servicio' : `Existencia ${fmtCantidad(p.stock ?? 0)}`]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </div>
                </div>
                {!ocultarMonto && (
                  <span className="text-xs muted" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {mostrarPrecio ? precioDeFila(p) : <>Costo <Money value={p.costo} cur={false} /></>}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

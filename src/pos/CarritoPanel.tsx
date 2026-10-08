// Carrito de la venta en curso (api-gratex docs/specs/pos.md V1-V4): líneas con
// − / cantidad / +, aviso de existencia, totales al centavo e ITBIS incluido.
// El cobro (P1-P4) llega con la emisión: por ahora el botón está deshabilitado.
import { Btn, Icon } from '@/components/ui'
import { fmtCantidad } from '@/lib/format'
import type { LineaCarrito } from './carrito'
import { formatoCentavos, importeLinea, itbisIncluido } from './montos'

interface Props {
  lineas: LineaCarrito[]
  onMas: (l: LineaCarrito) => void
  onMenos: (l: LineaCarrito) => void
  onCantidad: (l: LineaCarrito) => void
  onQuitar: (l: LineaCarrito) => void
  onCancelar: () => void
}

/** Existencia de la línea (V3): se vende igual, pero se avisa. */
function avisoExistencia(l: LineaCarrito): string | null {
  if (l.stock === null) return null
  if (l.stock <= 0) return 'Sin existencia'
  if (l.cantidad > l.stock) return `Solo hay ${fmtCantidad(l.stock)} en existencia`
  return null
}

export function CarritoPanel({ lineas, onMas, onMenos, onCantidad, onQuitar, onCancelar }: Props) {
  const importes = lineas.map((l) => ({ importe: importeLinea(l.precioCentavos, l.cantidad), tasa: l.tasa }))
  const total = importes.reduce((s, i) => s + i.importe, 0)
  const itbis = itbisIncluido(importes)
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)

  return (
    <aside className="pos-carrito" aria-label="Venta en curso">
      <div className="pos-carrito-cab">
        <div>
          <b>Venta</b>
          <small>{lineas.length === 0 ? 'Sin artículos' : `${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'} · ${fmtCantidad(unidades)} ${unidades === 1 ? 'unidad' : 'unidades'}`}</small>
        </div>
        <Btn variant="ghost" icon="x-circle" onClick={onCancelar} disabled={lineas.length === 0}
          style={lineas.length > 0 ? { color: 'var(--danger)' } : undefined}>Cancelar</Btn>
      </div>

      <div className="pos-lineas">
        {lineas.length === 0 ? (
          <div className="pos-lineas-vacio">
            <Icon name="shopping-cart" size={30} />
            <p>Toca un producto para agregarlo.</p>
          </div>
        ) : lineas.map((l, i) => {
          const aviso = avisoExistencia(l)
          return (
            <div key={l.productoId} className="pos-linea">
              <div className="pos-linea-info">
                <b>{l.nombre}</b>
                <small>{formatoCentavos(l.precioCentavos)} × {fmtCantidad(l.cantidad)}{l.tasa === 0 ? ' · Exento' : ''}</small>
                {aviso && <small className="pos-linea-aviso"><Icon name="alert-triangle" size={13} />{aviso}</small>}
              </div>
              <b className="pos-linea-importe">{formatoCentavos(importes[i].importe)}</b>
              <div className="pos-cant">
                <button type="button" onClick={() => onMenos(l)} disabled={l.cantidad <= 1} aria-label={`Quitar una unidad de ${l.nombre}`}>
                  <Icon name="minus" size={20} />
                </button>
                <button type="button" className="pos-cant-valor" onClick={() => onCantidad(l)} aria-label={`Cambiar la cantidad de ${l.nombre}`}>
                  {fmtCantidad(l.cantidad)}
                </button>
                <button type="button" onClick={() => onMas(l)} aria-label={`Agregar una unidad de ${l.nombre}`}>
                  <Icon name="plus" size={20} />
                </button>
                <button type="button" className="pos-quitar" onClick={() => onQuitar(l)} aria-label={`Quitar ${l.nombre} de la venta`}>
                  <Icon name="trash-2" size={19} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="pos-totales">
        <div className="pos-total-fila"><span>ITBIS incluido</span><span>{formatoCentavos(itbis)}</span></div>
        <div className="pos-total-fila pos-total"><span>Total</span><span>RD$ {formatoCentavos(total)}</span></div>
        <Btn variant="primary" className="pos-cobrar" icon="banknote" disabled title="El cobro llega en la próxima entrega">
          Cobrar
        </Btn>
        <small className="pos-cobrar-nota">El cobro y la impresión llegan en la próxima entrega.</small>
      </div>
    </aside>
  )
}

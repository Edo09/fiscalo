// Carrito de la venta en curso (api-gratex docs/specs/pos.md V1-V5, F2): líneas
// con − / cantidad / +, aviso de existencia, cliente de crédito fiscal (E31) con
// su descuento, totales al centavo e ITBIS incluido. El cobro va en CobroModal;
// aquí se decide si se puede cobrar (turno, cobro sin confirmar).
import { Btn, Icon } from '@/components/ui'
import { fmtCantidad } from '@/lib/format'
import type { ClientePos } from './api'
import type { LineaCarrito } from './carrito'
import { formatoCentavos, formatoRnc, totalesCarrito } from './montos'

interface Props {
  lineas: LineaCarrito[]
  /** Cliente de crédito fiscal (E31); null = consumidor final (E32). */
  cliente: ClientePos | null
  /** Cobro sin confirmar: la venta queda congelada y el botón reintenta. */
  enDuda: boolean
  puedeCobrar: boolean
  /** Por qué no se puede cobrar (turno de otro cajero, cargando...). */
  motivoNoCobrar: string | null
  /** La caja no tiene turno: el botón ofrece abrirlo. */
  sinTurno: boolean
  onCobrar: () => void
  onAbrirTurno: () => void
  onMas: (l: LineaCarrito) => void
  onMenos: (l: LineaCarrito) => void
  onCantidad: (l: LineaCarrito) => void
  onQuitar: (l: LineaCarrito) => void
  onCancelar: () => void
  onCliente: () => void
  onQuitarCliente: () => void
}

/** Existencia de la línea (V3): se vende igual, pero se avisa. */
function avisoExistencia(l: LineaCarrito): string | null {
  if (l.stock === null) return null
  if (l.stock <= 0) return 'Sin existencia'
  if (l.cantidad > l.stock) return `Solo hay ${fmtCantidad(l.stock)} en existencia`
  return null
}

export function CarritoPanel({
  lineas, cliente, enDuda, puedeCobrar, motivoNoCobrar, sinTurno, onCobrar, onAbrirTurno, onMas, onMenos, onCantidad, onQuitar, onCancelar,
  onCliente, onQuitarCliente,
}: Props) {
  const t = totalesCarrito(lineas, cliente?.descuento ?? 0)
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)

  return (
    <aside className="pos-carrito" aria-label="Venta en curso">
      <div className="pos-carrito-cab">
        <div>
          <b>Venta</b>
          <small>{lineas.length === 0 ? 'Sin artículos' : `${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'} · ${fmtCantidad(unidades)} ${unidades === 1 ? 'unidad' : 'unidades'}`}</small>
        </div>
        <Btn variant="ghost" icon="x-circle" onClick={onCancelar} disabled={lineas.length === 0 || enDuda}
          style={lineas.length > 0 && !enDuda ? { color: 'var(--danger)' } : undefined}>Cancelar</Btn>
      </div>

      {enDuda && (
        <div className="pos-franja aviso" style={{ borderBottom: '1px solid var(--border)' }}>
          <Icon name="wifi-off" size={16} />
          <span>El último cobro no se confirmó. La venta no se puede cambiar: toca <b>Reintentar cobro</b>.</span>
        </div>
      )}
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
                <small>RD$ {formatoCentavos(l.precioCentavos)} × {fmtCantidad(l.cantidad)}{l.tasa === 0 ? ' · Exento' : ''}</small>
                {aviso && <small className="pos-linea-aviso"><Icon name="alert-triangle" size={13} />{aviso}</small>}
              </div>
              <b key={t.lineas[i].bruto} className="pos-linea-importe pos-num"><span className="pos-moneda">RD$</span>{formatoCentavos(t.lineas[i].bruto)}</b>
              <div className="pos-cant">
                <button type="button" onClick={() => onMenos(l)} disabled={l.cantidad <= 1 || enDuda} aria-label={`Quitar una unidad de ${l.nombre}`}>
                  <Icon name="minus" size={20} />
                </button>
                <button type="button" className="pos-cant-valor" onClick={() => onCantidad(l)} disabled={enDuda} aria-label={`Cambiar la cantidad de ${l.nombre}`}>
                  {fmtCantidad(l.cantidad)}
                </button>
                <button type="button" onClick={() => onMas(l)} disabled={enDuda} aria-label={`Agregar una unidad de ${l.nombre}`}>
                  <Icon name="plus" size={20} />
                </button>
                <button type="button" className="pos-quitar" onClick={() => onQuitar(l)} disabled={enDuda} aria-label={`Quitar ${l.nombre} de la venta`}>
                  <Icon name="trash-2" size={19} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="pos-totales">
        {cliente ? (
          <div className="pos-cliente-barra">
            <Icon name="building-2" size={18} />
            <div>
              <small>Crédito fiscal</small>
              <b>{cliente.nombre}</b>
              <small>{cliente.rnc.length === 11 ? 'Cédula' : 'RNC'} {formatoRnc(cliente.rnc)}</small>
              {/* Su descuento ya va aplicado en los precios: aquí se dice cuánto es. */}
              {cliente.descuento > 0 && (
                <small className="pos-cliente-ahorro">
                  Descuento {cliente.descuento}%{t.descuento > 0 ? ` · −RD$ ${formatoCentavos(t.descuento)}` : ''}
                </small>
              )}
            </div>
            <Btn variant="ghost" className="pos-cliente-quitar" onClick={onQuitarCliente} disabled={enDuda} aria-label="Quitar el cliente: la venta vuelve a consumo">Quitar</Btn>
          </div>
        ) : !enDuda && (
          <Btn className="pos-cliente-boton" icon="building-2" onClick={onCliente}>Crédito fiscal (RNC)</Btn>
        )}
        {/* Como el recibo: subtotal sin ITBIS + ITBIS = total. */}
        <div className="pos-total-fila"><span>Subtotal</span><span>RD$ {formatoCentavos(t.subtotal)}</span></div>
        <div className="pos-total-fila"><span>ITBIS</span><span>RD$ {formatoCentavos(t.itbis)}</span></div>
        <div className="pos-total-fila pos-total"><span>Total</span><span key={t.total} className="pos-num">RD$ {formatoCentavos(t.total)}</span></div>
        {enDuda ? (
          <Btn variant="primary" className="pos-cobrar" icon="refresh-cw" onClick={onCobrar}>Reintentar cobro</Btn>
        ) : sinTurno ? (
          <Btn variant="primary" className="pos-cobrar" icon="clock" onClick={onAbrirTurno}>Abrir turno</Btn>
        ) : (
          <Btn variant="primary" className="pos-cobrar" icon="banknote" disabled={!puedeCobrar || lineas.length === 0} onClick={onCobrar}>
            Cobrar
          </Btn>
        )}
        <small className="pos-cobrar-nota">
          {motivoNoCobrar ?? (sinTurno ? 'Abre el turno con el fondo de la gaveta para empezar a cobrar.' : 'F9 efectivo · F2 tarjeta · F3 transferencia · F4 crédito fiscal')}
        </small>
      </div>
    </aside>
  )
}

// Las líneas de la factura (anexo 6.3): «Líneas (N)», desplegable. Cada una con su descripción, `cantidad × precio` y el subtotal, y un chip de ITBIS cuando no es el 18 % de siempre (indicador 1). Debajo, el
// bloque Subtotal, ITBIS y Total solo si la factura trae las tres cifras derivadas del e-CF firmado (una fila vieja o sin XML no las trae y no se inventan).
import { fmtCantidad } from '@/lib/format'
import { rd } from '~/lib/dinero'
import type { FacturaVista, LineaVista } from '~/lib/filas'
import { Plegable } from './Plegable'
import './Lineas.css'

/** El chip del indicador de facturación de una línea; null para el 1 (ITBIS 18 %), que no lleva. Un código que no se conoce no lleva chip. */
const CHIP_DE_ITBIS = new Map<number, string>([
  [0, 'No facturable'],
  [2, 'ITBIS 16%'],
  [3, 'Tasa cero'],
  [4, 'Exento'],
])

function Linea(p: { l: LineaVista }): JSX.Element {
  const { l } = p
  const chip = CHIP_DE_ITBIS.get(l.indicadorFacturacion)
  return (
    <li className="linea">
      <p className="linea__descripcion">{l.descripcion === '' ? '—' : l.descripcion}</p>
      <div className="linea__cifras">
        <span className="linea__cantidad tabular">
          {fmtCantidad(l.cantidad)} × {rd(l.precio)}
        </span>
        <span className="linea__subtotal tabular">{rd(l.subtotal)}</span>
      </div>
      {chip !== undefined && <span className="linea__chip">{chip}</span>}
    </li>
  )
}

export function Lineas(p: { f: FacturaVista }): JSX.Element {
  const { f } = p
  const totales = f.montoGravado !== null && f.montoExento !== null && f.totalItbis !== null ? { subtotal: f.montoGravado + f.montoExento, itbis: f.totalItbis } : null
  return (
    <Plegable titulo={`Líneas (${f.items.length})`}>
      {f.items.length === 0 ? (
        <p className="lineas__vacio">Esta factura no trae líneas.</p>
      ) : (
        <ul className="lineas">
          {f.items.map((l, i) => (
            <Linea key={i} l={l} />
          ))}
        </ul>
      )}
      {totales !== null && (
        <dl className="lineas__totales">
          <div className="lineas__total">
            <dt>Subtotal</dt>
            <dd className="tabular">{rd(totales.subtotal)}</dd>
          </div>
          <div className="lineas__total">
            <dt>ITBIS</dt>
            <dd className="tabular">{rd(totales.itbis)}</dd>
          </div>
          <div className="lineas__total lineas__total--final">
            <dt>Total</dt>
            <dd className="tabular">{rd(f.total)}</dd>
          </div>
        </dl>
      )}
    </Plegable>
  )
}

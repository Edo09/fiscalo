import { useState } from 'react'
import { Icon } from '@/components/ui'
import { descuentoDePorcentaje, porcentajeDeDescuento } from './descuento'

/* FISCALO — La fila "Descuento" del panel de totales de la cotización de
   Ferretería, bajo el Sub-total.

   Lo que se guarda es UN monto en RD$ (el campo de la derecha, como los demás
   montos del panel). El porcentaje de al lado es solo una forma de escribirlo:
   al teclear un %, el monto se calcula sobre el Sub-total de ese momento, y
   después el % muestra qué parte del Sub-total es el monto. Si luego cambian las
   líneas, el monto se queda y el % cambia: así lo que se ve es siempre lo que se
   guardó (un "10%" que se recalculara solo se perdería al recargar, porque el
   backend no lo conoce).

   Mientras el % tiene el foco se muestra lo que se teclea, no el derivado: con
   un Sub-total que no admite ese % exacto a centavos (12.5% de 33.33), teclear
   "12.5" y verlo saltar a "12.51" sería una pelea con el campo. */
export function CampoDescuento({
  subtotal, value, error, cambiado, onValue,
}: {
  /** Sub-total de las líneas (antes del descuento): la base del %. */
  subtotal: number
  /** Descuento en RD$. */
  value: number
  error?: string
  /** Difiere de lo guardado: se marca como los demás campos tocados. */
  cambiado?: boolean
  onValue: (v: number) => void
}) {
  const [pctTexto, setPctTexto] = useState<string | null>(null)
  const clase = (extra: string) =>
    `fx-field fx-num ${extra}` + (cambiado ? ' fx-mod' : '') + (error ? ' fx-field--err' : '')
  return (
    <>
      <div className="fx-total-linea">
        <label htmlFor="fx-aj-descuento">Descuento</label>
        <span className="fx-descuento-campos">
          <input
            className={clase('fx-ajuste-pct')}
            type="number" min={0} max={100} step="any" inputMode="decimal"
            value={pctTexto ?? porcentajeDeDescuento(subtotal, value)}
            onChange={(e) => {
              setPctTexto(e.target.value)
              onValue(descuentoDePorcentaje(subtotal, +e.target.value || 0))
            }}
            onBlur={() => setPctTexto(null)}
            aria-label="Descuento en porcentaje del sub-total"
            aria-invalid={error ? true : undefined}
          />
          <span className="fx-descuento-signo" aria-hidden="true">%</span>
          <span className="fx-descuento-signo fx-descuento-menos" aria-hidden="true">−</span>
          <input
            id="fx-aj-descuento"
            className={clase('fx-ajuste-monto')}
            type="number" min={0} step="0.01" inputMode="decimal"
            value={value}
            onChange={(e) => onValue(+e.target.value || 0)}
            aria-invalid={error ? true : undefined}
          />
        </span>
      </div>
      {error && <span className="fx-err fx-ajuste-err"><Icon name="alert-circle" size={12} />{error}</span>}
    </>
  )
}

// Un interruptor de sí o no («Permitir crédito», «Disponible para facturar»): un `input type="checkbox" role="switch"` de verdad (se lee como interruptor, el teclado lo cambia con espacio)
// y una pista que lo dibuja. Toda la fila es el objetivo táctil, de 56 px como mínimo. El estado se ve por la posición de la bola además del color.
import { useId } from 'react'
import './Interruptor.css'

export function Interruptor(p: { etiqueta: string; ayuda?: string; activo: boolean; onCambio(activo: boolean): void }): JSX.Element {
  const { etiqueta, ayuda, activo, onCambio } = p
  const id = useId()
  return (
    <label className="interruptor" htmlFor={id}>
      <span className="interruptor__texto">
        <span className="interruptor__etiqueta">{etiqueta}</span>
        {ayuda !== undefined && ayuda !== '' && <span className="interruptor__ayuda">{ayuda}</span>}
      </span>
      <input id={id} className="interruptor__entrada sr-only" type="checkbox" role="switch" checked={activo} onChange={(e) => onCambio(e.target.checked)} />
      <span className="interruptor__pista" aria-hidden="true">
        <span className="interruptor__bola" />
      </span>
    </label>
  )
}

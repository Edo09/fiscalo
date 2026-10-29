// Un control segmentado (anexo 8): de 2 a 4 opciones, una elegida, todas a la vista. Son radios de verdad (un `radiogroup` con sus `input type="radio"`), así
// que los lectores de pantalla lo leen como grupo («Tema, Automático, 1 de 3») y las flechas del teclado cambian de opción sin código nuestro. Cada
// segmento mide 48 px y el rótulo nunca se corta: si no cabe en una línea, se parte y el segmento crece.
import { useId } from 'react'
import './SegmentedControl.css'

export function SegmentedControl<T extends string>(p: {
  etiquetaGrupo: string
  opciones: { valor: T; etiqueta: string }[]
  valor: T
  onCambio(v: T): void
}): JSX.Element {
  const { etiquetaGrupo, opciones, valor, onCambio } = p
  const grupo = useId() // los radios de un grupo comparten `name`
  return (
    <div className="segmentos" role="radiogroup" aria-label={etiquetaGrupo}>
      {opciones.map((opcion) => (
        <label key={opcion.valor} className="segmento">
          <input
            type="radio"
            className="segmento__radio sr-only"
            name={grupo}
            value={opcion.valor}
            checked={opcion.valor === valor}
            onChange={() => onCambio(opcion.valor)}
          />
          <span className="segmento__etiqueta">{opcion.etiqueta}</span>
        </label>
      ))}
    </div>
  )
}

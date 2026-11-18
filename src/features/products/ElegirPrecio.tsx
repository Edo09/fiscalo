// FISCALO — Segundo paso de los selectores de productos: un producto con varias listas de precio no
// entra a la factura o cotización hasta que se elija una. La regla de cuándo preguntar vive en
// src/lib/listasPrecio.ts (eleccionDePrecio); aquí solo se pinta la pregunta.
import { useEffect } from 'react'
import { Icon } from '@/components/ui'
import { fmtPrecio } from '@/lib/format'
import { opcionesDePrecio, type NumeroLista } from '@/lib/listasPrecio'
import type { Producto } from '@/types/domain'

export interface ElegirPrecioProps {
  producto: Pick<Producto, 'nombre' | 'precio' | 'otrosPrecios'>
  onElegir: (precio: number, lista: NumeroLista) => void
  onVolver: () => void
}

export function ElegirPrecio({ producto, onElegir, onVolver }: ElegirPrecioProps) {
  // Esc vuelve a la lista en vez de cerrar el diálogo de afuera: el Modal escucha Escape en `window`
  // en la fase de burbuja, así que este listener va en captura y corta la propagación.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onVolver()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onVolver])

  return (
    <div className="elegir-precio">
      <button type="button" className="elegir-precio-volver" onClick={onVolver}>
        <Icon name="arrow-left" size={16} />
        <span>{producto.nombre}</span>
      </button>
      <div className="elegir-precio-titulo">Elige el precio</div>
      <div className="elegir-precio-ops">
        {opcionesDePrecio(producto).map((o, i) => (
          <button
            type="button" key={o.lista} className="elegir-precio-op" autoFocus={i === 0}
            // El segundo clic de un doble clic sobre la fila del producto cae sobre la opción que quedó
            // debajo del cursor y elegía un precio sin que nadie lo eligiera: con detail > 1 no cuenta.
            // Con el teclado (Enter o espacio) detail es 0 y pasa.
            onClick={(e) => { if (e.detail > 1) return; onElegir(o.precio, o.lista) }}
          >
            <span>Precio {o.lista}</span>
            {/* El valor con sus decimales (hasta 4): es el que se copia a la línea. */}
            <span className="num">{fmtPrecio(o.precio)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

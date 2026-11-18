// Elegir el precio de un producto que ofrece varios (listas de precio, listas.ts): un botón grande por
// cada precio, con su monto final (ITBIS incluido, como la tarjeta). VentaView lo abre solo cuando
// decisionPos dice `elegir`: el POS nunca escoge un precio por el cajero. Molde de CantidadModal
// (PosModales.tsx): también responde al teclado, con el número de la lista.
import { useEffect } from 'react'
import { Btn } from '@/components/ui'
import type { ProductoPos } from './api'
import { opcionesPos, type NumeroLista } from './listas'
import { formatoCentavos } from './montos'
import { Overlay } from './PosModales'

export function ElegirPrecioModal({ producto, onElegir, onCerrar }: {
  producto: ProductoPos
  onElegir: (lista: NumeroLista) => void
  onCerrar: () => void
}) {
  const opciones = opcionesPos(producto)

  // Teclado: 1 a 4 eligen esa lista si el producto la ofrece; Esc cancela. Un número sin precio no hace
  // nada, pero tampoco se queda tecleado en el buscador que sigue enfocado debajo del diálogo.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Ctrl, Cmd o Alt + número son atajos del navegador (cambiar de pestaña): no se tocan.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') onCerrar()
      else if (/^[1-4]$/.test(e.key)) {
        const op = opciones.find((o) => o.lista === Number(e.key))
        if (op) onElegir(op.lista)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <Overlay>
      <div className="pos-modal-cab">
        <div>
          <small>Precio</small>
          <b>{producto.nombre}</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <div className="pos-precio-ops">
        {opciones.map((o) => (
          <button key={o.lista} type="button" className="pos-precio-op" onClick={() => onElegir(o.lista)}
            aria-label={`Precio ${o.lista}, ${formatoCentavos(o.precioCentavos)} pesos`}>
            <span>Precio {o.lista}</span>
            <b><span className="pos-moneda">RD$</span>{formatoCentavos(o.precioCentavos)}</b>
          </button>
        ))}
      </div>
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Cancelar</Btn>
      </div>
    </Overlay>
  )
}

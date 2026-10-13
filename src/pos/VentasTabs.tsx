// Pestañas de las ventas abiertas del empleado (ventas en espera): atender a
// otro cliente sin perder la venta del primero. Cada pestaña es una venta con
// su carrito y su cliente; se guardan en el equipo (carrito.ts).
//
// - El nombre es el del cliente de crédito fiscal o "Venta N".
// - Una venta con un cobro sin confirmar no se puede cerrar: se reintenta en
//   su pestaña (el reintento tiene que salir con la misma clave).
// - F8 abre una venta nueva y F7 pasa a la siguiente (VentaView).
import { useEffect, useRef } from 'react'
import { Icon } from '@/components/ui'
import { MAX_VENTAS, nombreVenta, type VentaAbierta } from './carrito'

interface Props {
  ventas: VentaAbierta[]
  activaId: string
  onCambiar: (id: string) => void
  onNueva: () => void
  onCerrar: (venta: VentaAbierta) => void
  /** Con un diálogo abierto (cobro, cantidad…) no se cambia de venta. */
  bloqueadas: boolean
}

export function VentasTabs({ ventas, activaId, onCambiar, onNueva, onCerrar, bloqueadas }: Props) {
  const llenas = ventas.length >= MAX_VENTAS
  // En pantallas angostas la fila se desliza: la activa siempre a la vista.
  const filaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    filaRef.current?.querySelector('.pos-venta-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activaId, ventas.length])
  return (
    <div ref={filaRef} className="pos-ventas-tabs" role="tablist" aria-label="Ventas abiertas">
      {ventas.map((v) => {
        const activa = v.id === activaId
        const nombre = nombreVenta(v)
        const n = v.lineas.length
        return (
          <div key={v.id} className={'pos-venta-tab' + (activa ? ' on' : '') + (v.cobroEnDuda ? ' duda' : '')}>
            <button
              type="button"
              role="tab"
              aria-selected={activa}
              className="pos-venta-tab-btn"
              onClick={() => onCambiar(v.id)}
              disabled={bloqueadas && !activa}
              title={v.cobroEnDuda ? `${nombre}: cobro sin confirmar, reinténtalo aquí` : `${nombre}${n > 0 ? ` · ${n} ${n === 1 ? 'producto' : 'productos'}` : ''}`}
            >
              <Icon name={v.cobroEnDuda ? 'wifi-off' : 'shopping-cart'} size={15} />
              <span className="pos-venta-tab-nombre">{nombre}</span>
              {n > 0 && <span className="pos-venta-tab-n">{n}</span>}
            </button>
            {ventas.length > 1 && !v.cobroEnDuda && (
              <button
                type="button"
                className="pos-venta-tab-cerrar"
                onClick={() => onCerrar(v)}
                disabled={bloqueadas}
                aria-label={`Cerrar ${nombre}`}
                title={n > 0 ? 'Cerrar (cancela esta venta)' : 'Cerrar'}
              >
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="pos-venta-tab-nueva"
        onClick={onNueva}
        disabled={llenas || bloqueadas}
        aria-label="Nueva venta (F8)"
        title={llenas ? `Máximo ${MAX_VENTAS} ventas abiertas: cobra o cierra una` : 'Nueva venta (F8)'}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  )
}

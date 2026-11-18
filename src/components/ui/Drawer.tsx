// Panel lateral deslizante (cierra con Escape o click en el overlay).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Btn } from './Btn'

// Debe calzar con la duración de @keyframes slideout/fadeOut en styles.css.
const EXIT_MS = 180

export interface DrawerProps {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
  /**
   * false = la tecla Escape no lo cierra. Para cuando hay un modal ENCIMA del panel: los dos escuchan
   * Escape en `window` y, sin esto, un solo Escape cerraba el modal y también el panel de abajo.
   * Por defecto sí (nada cambia para quien no lo pasa).
   */
  cerrarConEscape?: boolean
}
export function Drawer({ title, sub, children, footer, onClose, width = 560, cerrarConEscape = true }: DrawerProps) {
  const [closing, setClosing] = useState(false)
  // El valor de AHORA, no el del montaje: el listener de abajo se registra una sola vez.
  const escapeActivo = useRef(cerrarConEscape)
  useEffect(() => { escapeActivo.current = cerrarConEscape })
  // Igual que Modal: solo X/overlay/Escape animan la salida; el footer de cada
  // caller llama su propio onClose directo y cierra al instante.
  const requestClose = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, EXIT_MS)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && escapeActivo.current) requestClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestClose se recrea cada render por diseño; solo importa montar/desmontar el listener una vez
  }, [])

  return (
    <Fragment>
      <div className={'drawer-overlay' + (closing ? ' closing' : '')} onClick={requestClose}></div>
      <div className={'drawer' + (closing ? ' closing' : '')} style={{ maxWidth: width }}>
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16 }}>{title}</h3>
            {sub && <div className="sub" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" icon="x" onClick={requestClose} aria-label="Cerrar" title="Cerrar" />
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </Fragment>
  )
}

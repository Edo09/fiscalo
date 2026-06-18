// Diálogo modal centrado (cierra con Escape o click en el overlay).
import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Btn } from './Btn'

// Debe calzar con la duración de @keyframes popOut/fadeOut en styles.css.
const EXIT_MS = 160

export interface ModalProps {
  title: ReactNode
  sub?: ReactNode
  icon?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}
export function Modal({ title, sub, icon, children, footer, onClose, width = 520 }: ModalProps) {
  const [closing, setClosing] = useState(false)
  // Pasos por X/overlay/Escape: anima la salida antes de desmontar. Los botones
  // del footer (Cancelar/Guardar) los provee cada caller con su propio onClose
  // directo, así que cierran al instante — fuera del alcance de este componente.
  const requestClose = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, EXIT_MS)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestClose se recrea cada render por diseño; solo importa montar/desmontar el listener una vez
  }, [])

  return (
    <div className={'overlay' + (closing ? ' closing' : '')} onClick={requestClose}>
      <div className={'modal' + (closing ? ' closing' : '')} style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {icon && (
            <span className="kpi-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 34, height: 34 }}>
              <Icon name={icon} size={18} />
            </span>
          )}
          <div style={{ flex: 1 }}>
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" icon="x" onClick={requestClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

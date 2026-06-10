// Diálogo modal centrado (cierra con Escape o click en el overlay).
import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Btn } from './Btn'

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
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
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
          <Btn variant="ghost" size="sm" icon="x" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

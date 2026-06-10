// Panel lateral deslizante (cierra con Escape o click en el overlay).
import { Fragment, useEffect, type ReactNode } from 'react'
import { Btn } from './Btn'

export interface DrawerProps {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}
export function Drawer({ title, sub, children, footer, onClose, width = 560 }: DrawerProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <Fragment>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer" style={{ maxWidth: width }}>
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16 }}>{title}</h3>
            {sub && <div className="sub" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" icon="x" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </Fragment>
  )
}

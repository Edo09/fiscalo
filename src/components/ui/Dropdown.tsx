// Menú desplegable anclado a un trigger (cierra al hacer click fuera).
// Se renderiza en un portal con posición fija para no quedar recortado por
// contenedores con overflow (p.ej. `.tbl-wrap`).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface DropdownProps {
  trigger: ReactNode
  children?: ReactNode
  align?: 'left' | 'right'
  width?: number
  /** Clase del contenedor (p.ej. `desktop-only` para ocultarlo en móvil). */
  className?: string
}
export function Dropdown({ trigger, children, align = 'right', width = 200, className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const trig = ref.current
    if (!trig) return
    const r = trig.getBoundingClientRect()
    const gap = 6
    const menuH = menuRef.current?.offsetHeight ?? 0
    const spaceBelow = window.innerHeight - r.bottom
    // Abre hacia arriba si no cabe abajo pero sí arriba.
    const up = spaceBelow < menuH + gap && r.top > spaceBelow
    const style: CSSProperties = {
      position: 'fixed',
      minWidth: width,
      ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
      ...(align === 'right' ? { right: window.innerWidth - r.right } : { left: r.left }),
    }
    setPos(style)
  }, [align, width])

  // Posiciona antes de pintar (mide alto real del menú) y re-posiciona en scroll/resize.
  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, place])

  return (
    <div ref={ref} className={className} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && createPortal(
        <div ref={menuRef} className="menu" style={{ ...pos, visibility: pos ? 'visible' : 'hidden' }} onClick={() => setOpen(false)}>
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

export interface MenuItemProps {
  icon?: string
  children?: ReactNode
  danger?: boolean
  onClick?: () => void
}
export function MenuItem({ icon, children, danger, onClick }: MenuItemProps) {
  return (
    <div className={'menu-item' + (danger ? ' danger' : '')} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}{children}
    </div>
  )
}

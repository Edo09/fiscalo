// Menú desplegable anclado a un trigger (cierra al hacer click fuera).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface DropdownProps {
  trigger: ReactNode
  children?: ReactNode
  align?: 'left' | 'right'
  width?: number
}
export function Dropdown({ trigger, children, align = 'right', width = 200 }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const menuStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    minWidth: width,
    ...(align === 'right' ? { right: 0 } : { left: 0 }),
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className="menu" style={menuStyle} onClick={() => setOpen(false)}>
          {children}
        </div>
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

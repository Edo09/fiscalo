// Menú desplegable anclado a un trigger (cierra al hacer click fuera).
// Se renderiza en un portal con posición fija para no quedar recortado por
// contenedores con overflow (p.ej. `.tbl-wrap`).
//
// Se usa también con teclado: al abrir, el foco pasa al primer ítem (el portal
// queda al final del body, así que con Tab nunca se llegaría a él); las flechas
// recorren los ítems, Escape cierra y devuelve el foco al trigger, y Tab cierra
// y sigue desde el trigger.
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

const ITEM = '[role="menuitem"]'

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
  const enfocarAlAbrir = useRef(false)
  useLayoutEffect(() => {
    if (!open) return
    enfocarAlAbrir.current = true
    place()
  }, [open, place])

  // El foco entra cuando el menú ya es visible: mientras no tiene posición está
  // con visibility:hidden y un elemento oculto no toma el foco. Una sola vez por
  // apertura: re-posicionar al hacer scroll no debe devolverlo al primer ítem.
  useEffect(() => {
    if (!open || !pos || !enfocarAlAbrir.current) return
    enfocarAlAbrir.current = false
    menuRef.current?.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true })
  }, [open, pos])

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

  const cerrarAlTrigger = () => {
    setOpen(false)
    ref.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
  }

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const ir = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus() }
    switch (e.key) {
      case 'ArrowDown': ir(i + 1); break
      case 'ArrowUp': ir(i - 1); break
      case 'Home': ir(0); break
      case 'End': ir(items.length - 1); break
      // Sin cortar la propagación, el Escape también cerraría un Modal de debajo.
      case 'Escape': e.preventDefault(); e.stopPropagation(); cerrarAlTrigger(); break
      // Sin preventDefault: con el foco ya de vuelta en el trigger, Tab sigue
      // desde ahí y no desde el final del body, donde vive el portal.
      case 'Tab': cerrarAlTrigger(); break
    }
  }

  return (
    <div ref={ref} className={className} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="menu"
          style={{ ...pos, visibility: pos ? 'visible' : 'hidden' }}
          onClick={() => setOpen(false)}
          onKeyDown={onMenuKeyDown}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

export interface MenuItemProps {
  icon?: IconName
  children?: ReactNode
  danger?: boolean
  onClick?: () => void
}
export function MenuItem({ icon, children, danger, onClick }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className={'menu-item' + (danger ? ' danger' : '')} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}{children}
    </button>
  )
}

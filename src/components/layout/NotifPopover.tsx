import { useEffect, useRef } from 'react'
import { Btn } from '@/components/ui'
import type { Nav } from '@/config/navigation'

export function NotifPopover({ onClose, nav }: { onClose: () => void; nav: Nav }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const id = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', h) }
  }, [onClose])

  return (
    <div ref={ref} className="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360, padding: 0 }}>
      <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <span className="fw6 text-sm">Notificaciones</span>
      </div>
      <div style={{ padding: '28px 14px', textAlign: 'center' }}>
        <span className="text-sm muted">No tienes notificaciones.</span>
      </div>
      <div style={{ padding: 8 }}><Btn variant="ghost" size="sm" style={{ width: '100%' }} onClick={() => { onClose(); nav('notificaciones') }}>Ver todas</Btn></div>
    </div>
  )
}

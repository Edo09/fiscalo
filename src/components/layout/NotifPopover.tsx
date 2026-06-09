import { useEffect, useRef } from 'react'
import { Icon, Btn } from '@/components/ui'
import { DATA } from '@/data/mockData'
import type { Nav } from '@/app/navigation'
import type { NotifTipo } from '@/types/domain'

export function NotifPopover({ onClose, nav }: { onClose: () => void; nav: Nav }) {
  const D = DATA
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const id = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', h) }
  }, [onClose])

  const toneMap: Record<NotifTipo, string> = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--accent)', success: 'var(--success)' }
  const bgMap: Record<NotifTipo, string> = { danger: 'var(--danger-soft)', warning: 'var(--warning-soft)', info: 'var(--accent-soft)', success: 'var(--success-soft)' }

  return (
    <div ref={ref} className="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360, padding: 0 }}>
      <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <span className="fw6 text-sm">Notificaciones</span>
        <span className="badge badge-danger">3 nuevas</span>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {D.notificaciones.slice(0, 4).map((n) => (
          <div key={n.id} className="row gap-sm" style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => { onClose(); nav('notificaciones') }}>
            <span className="kpi-ic" style={{ background: bgMap[n.tipo], color: toneMap[n.tipo], width: 30, height: 30, flexShrink: 0 }}><Icon name={n.ic} size={14} /></span>
            <div style={{ flex: 1 }}><div className="fw6 text-sm">{n.titulo}</div><div className="text-xs muted">{n.txt}</div><div className="text-xs muted-3 mt-sm">{n.hora}</div></div>
          </div>
        ))}
      </div>
      <div style={{ padding: 8 }}><Btn variant="ghost" size="sm" style={{ width: '100%' }} onClick={() => { onClose(); nav('notificaciones') }}>Ver todas</Btn></div>
    </div>
  )
}

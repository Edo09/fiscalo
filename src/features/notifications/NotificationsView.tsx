import { useState } from 'react'
import { Icon, Btn, Card, EmptyState, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'
import type { NotifTipo } from '@/types/domain'

/* FISCALO — Centro de notificaciones */
export function NotificationsView() {
  const D = DATA
  const [items, setItems] = useState(D.notificaciones)
  const toneMap: Record<NotifTipo, string> = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--accent)', success: 'var(--success)' }
  const bgMap: Record<NotifTipo, string> = { danger: 'var(--danger-soft)', warning: 'var(--warning-soft)', info: 'var(--accent-soft)', success: 'var(--success-soft)' }
  return (
    <div className="page">
      <PageHead title="Centro de notificaciones" sub={`${items.filter((n) => !n.leida).length} sin leer`}
        actions={<Btn variant="secondary" icon="check-check" onClick={() => setItems(items.map((i) => ({ ...i, leida: true })))}>Marcar todas como leídas</Btn>} />
      <Card noPad>
        {items.map((n) => (
          <div key={n.id} className="row gap-md" style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', background: n.leida ? 'transparent' : 'var(--surface-2)', alignItems: 'flex-start' }}>
            <span className="kpi-ic" style={{ background: bgMap[n.tipo], color: toneMap[n.tipo], width: 36, height: 36, flexShrink: 0 }}><Icon name={n.ic} size={17} /></span>
            <div style={{ flex: 1 }}>
              <div className="row gap-sm"><span className="fw6 text-sm">{n.titulo}</span>{!n.leida && <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--accent)' }}></span>}</div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>{n.txt}</div>
              <div className="text-xs muted-3" style={{ marginTop: 4 }}>{n.hora}</div>
            </div>
            <Btn variant="ghost" size="sm" icon="x" onClick={() => setItems(items.filter((i) => i.id !== n.id))} />
          </div>
        ))}
        {items.length === 0 && <EmptyState icon="bell-off" title="Todo al día">No tienes notificaciones pendientes.</EmptyState>}
      </Card>
    </div>
  )
}

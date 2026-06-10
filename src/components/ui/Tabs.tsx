// Pestañas con contador opcional y control segmentado.
import type { ReactNode } from 'react'

export interface TabItem {
  id: string
  label: ReactNode
  count?: number
}
export interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
}
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab' + (active === t.id ? ' on' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && (
            <span className="muted-3" style={{ marginLeft: 6, fontWeight: 500 }}>{t.count}</span>
          )}
        </div>
      ))}
    </div>
  )
}

export interface SegProps {
  options: string[]
  value: string
  onChange: (value: string) => void
}
export function Seg({ options, value, onChange }: SegProps) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  )
}

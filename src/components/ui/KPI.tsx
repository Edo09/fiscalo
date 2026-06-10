// Tarjeta de indicador: etiqueta, valor (numérico o monetario), delta y pie.
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Money } from './Money'
import { fmt0 } from '@/lib/format'

export interface KpiProps {
  label: string
  value: number | string
  money?: boolean
  icon?: string
  iconBg?: string
  iconColor?: string
  delta?: string
  deltaDir?: 'up' | 'down'
  foot?: ReactNode
}
export function KPI({
  label, value, money = false, icon,
  iconBg = 'var(--accent-soft)', iconColor = 'var(--accent)',
  delta, deltaDir = 'up', foot,
}: KpiProps) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && (
          <span className="kpi-ic" style={{ background: iconBg, color: iconColor }}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="kpi-value">
        {money && typeof value === 'number'
          ? <Money value={value} />
          : <span className="num">{typeof value === 'number' ? fmt0(value) : value}</span>}
      </div>
      <div className="kpi-foot">
        {delta != null && (
          <span className={`delta ${deltaDir}`}>
            <Icon name={deltaDir === 'up' ? 'trending-up' : 'trending-down'} size={13} />
            {delta}
          </span>
        )}
        {foot && <span>{foot}</span>}
      </div>
    </div>
  )
}

// Estados de página/lista: vacío, cargando (skeleton), error y spinner.
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Btn } from './Btn'

export interface EmptyStateProps {
  icon?: string
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}
export function EmptyState({ icon = 'inbox', title, children, action }: EmptyStateProps) {
  return (
    <div className="state">
      <div className="state-ic"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row" style={{ padding: '11px 14px', gap: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="skel" style={{ width: 32, height: 32, borderRadius: 8 }}></div>
          <div className="skel" style={{ height: 12, flex: 1, maxWidth: 180 }}></div>
          <div className="skel" style={{ height: 12, width: 90 }}></div>
          <div className="skel" style={{ height: 12, width: 70, marginLeft: 'auto' }}></div>
          <div className="skel" style={{ height: 20, width: 64, borderRadius: 99 }}></div>
        </div>
      ))}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  children?: ReactNode
  onRetry?: () => void
}
export function ErrorState({ title = 'Algo salió mal', children, onRetry }: ErrorStateProps) {
  return (
    <div className="state">
      <div className="state-ic" style={{ background: 'var(--danger-soft)' }}>
        <Icon name="cloud-off" size={24} style={{ color: 'var(--danger)' }} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {onRetry && <Btn variant="secondary" icon="refresh-cw" onClick={onRetry}>Reintentar</Btn>}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner"></span>
}

// Tarjeta con cabecera (título/sub/acciones) y cuerpo opcionalmente sin padding.
import type { ReactNode } from 'react'

export interface CardProps {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  noPad?: boolean
}
export function Card({ title, sub, actions, children, className = '', noPad = false }: CardProps) {
  return (
    <div className={'card ' + className}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'card-pad'}>{children}</div>
    </div>
  )
}

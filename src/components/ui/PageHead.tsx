// Cabecera de página: breadcrumbs, título, subtítulo y acciones.
import { Fragment, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface Crumb {
  label: ReactNode
  onClick?: () => void
}
export interface PageHeadProps {
  title: ReactNode
  sub?: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
}
export function PageHead({ title, sub, crumbs, actions }: PageHeadProps) {
  return (
    <div>
      {crumbs && (
        <div className="breadcrumb">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <Icon name="chevron-right" size={13} className="sep" />}
              <a
                style={{ cursor: c.onClick ? 'pointer' : 'default', color: i === crumbs.length - 1 ? 'var(--text-2)' : 'inherit' }}
                onClick={c.onClick}
              >
                {c.label}
              </a>
            </Fragment>
          ))}
        </div>
      )}
      <div className="page-head">
        <div className="titles">
          <h1 className="page-title">{title}</h1>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}

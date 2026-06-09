import { Icon } from '@/components/ui'
import { NAV, type Nav } from '@/app/navigation'

export interface SidebarProps {
  nav: Nav
  activeTop: string
  sbClass: string
  mobileOpen: boolean
  onCloseMobile: () => void
}

export function Sidebar({ nav, activeTop, sbClass, mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      <div className={'sidebar-backdrop' + (mobileOpen ? ' show' : '')} onClick={onCloseMobile}></div>
      <aside className={'sidebar' + sbClass + (mobileOpen ? ' mobile-open' : '')}>
        <div className="sidebar-brand" onClick={() => nav('dashboard')}>
          <div className="brand-mark">F</div>
          <span className="brand-name">Fiscalo<b>.</b></span>
        </div>
        <div className="sidebar-scroll">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((it) => (
                <div key={it.id} className={'nav-item' + (activeTop === it.id ? ' active' : '')} onClick={() => nav(it.id)}>
                  <Icon name={it.icon} size={17} />
                  <span>{it.label}</span>
                  {it.badge && (
                    <span className={'nav-item-badge' + (it.badgeTone === 'danger' ? ' danger' : it.badgeTone === 'warn' ? ' warn' : '')}>
                      {it.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <div className="nav-item" onClick={() => nav('configuracion')} style={{ background: 'var(--surface-hover)' }}>
            <Icon name="life-buoy" size={17} /><span>Ayuda y soporte</span>
          </div>
        </div>
      </aside>
    </>
  )
}

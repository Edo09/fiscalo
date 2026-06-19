import { Icon, Image } from '@/components/ui'
import { NAV, type Nav } from '@/config/navigation'
import { hasModule } from '@/config/permissions'
import { useSession } from '@/stores/auth'

export interface SidebarProps {
  nav: Nav
  activeTop: string
  sbClass: string
  mobileOpen: boolean
  onCloseMobile: () => void
}

export function Sidebar({ nav, activeTop, sbClass, mobileOpen, onCloseMobile }: SidebarProps) {
  const { user } = useSession()
  const perms = user?.permissions
  // Visible si el item no exige módulo, o el rol lo tiene. Fail-open cuando no hay
  // lista de permisos (sesión previa a RBAC): el backend sigue siendo la barrera real.
  const canSee = (module?: string) => !module || !perms || hasModule(perms, module)

  return (
    <>
      <div className={'sidebar-backdrop' + (mobileOpen ? ' show' : '')} onClick={onCloseMobile}></div>
      <aside className={'sidebar' + sbClass + (mobileOpen ? ' mobile-open' : '')}>
        <div className="sidebar-brand" onClick={() => nav('dashboard')}>
          <Image className="brand-icon" src="/assets/logos/fiscalpoit-notext.png" alt="" />
          <span className="brand-name">FiscalPoint<b>.</b></span>
        </div>
        <div className="sidebar-scroll">
          {NAV.map((g) => {
            const items = g.items.filter((it) => canSee(it.module))
            if (items.length === 0) return null
            return (
              <div className="nav-group" key={g.group}>
                <div className="nav-group-label">{g.group}</div>
                {items.map((it) => (
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
            )
          })}
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

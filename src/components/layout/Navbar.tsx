import { Icon, Btn, Avatar, Dropdown, MenuItem } from '@/components/ui'
import { DATA } from '@/data/mockData'
import { useSession } from '@/auth/useSession'
import { clearSession } from '@/auth/session'
import { logout } from '@/api/auth'
import type { Nav } from '@/app/navigation'

export interface NavbarProps {
  nav: Nav
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenSearch: () => void
  onOpenMobileNav: () => void
}

export function Navbar({
  nav, theme, onToggleTheme, onOpenSearch, onOpenMobileNav,
}: NavbarProps) {
  const D = DATA
  const { user } = useSession()
  const userName = user?.name || D.usuario.nombre
  const userEmail = user?.email || D.usuario.email
  const userRole = user?.role || D.usuario.rol

  // Logout: revoca el token en el backend (best-effort) y limpia la sesión local.
  // clearSession() notifica a App, que vuelve a mostrar el login.
  const handleLogout = async () => {
    await logout()
    clearSession()
  }

  return (
    <header className="navbar">
      <button className="icon-btn mobile-only" onClick={onOpenMobileNav}><Icon name="menu" /></button>
      <div className="co-switch desktop-only">
        <span className="co-logo">DC</span>
        <span className="nm">{D.empresa.nombre}</span>
        <Icon name="chevrons-up-down" size={14} style={{ color: 'var(--text-3)' }} />
      </div>
      <div className="navbar-search desktop-only" onClick={onOpenSearch}>
        <Icon name="search" /><span style={{ flex: 1 }}>Buscar facturas, clientes, e-CF…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="navbar-spacer"></div>
      <div className="navbar-actions">
        <button className="icon-btn mobile-only" onClick={onOpenSearch}><Icon name="search" /></button>
        <Btn variant="primary" size="sm" icon="plus" className="desktop-only" onClick={() => nav('factura-nueva')}>Nueva</Btn>
        <button className="icon-btn" onClick={onToggleTheme} title="Cambiar tema">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <span className="navbar-divider"></span>
        <Dropdown align="right" width={220} trigger={
          <div className="user-chip"><Avatar name={userName} color={user ? undefined : D.usuario.color} size={30} /><div className="desktop-only col"><span className="nm">{userName}</span><span className="rl">{userRole}</span></div></div>
        }>
          <div className="menu-label">{userEmail}</div>
          <MenuItem icon="user">Mi perfil</MenuItem>
          <MenuItem icon="building-2">Datos de empresa</MenuItem>
          <MenuItem icon="settings" onClick={() => nav('configuracion')}>Configuración</MenuItem>
          <div className="menu-sep"></div>
          <MenuItem icon="log-out" danger onClick={handleLogout}>Cerrar sesión</MenuItem>
        </Dropdown>
      </div>
    </header>
  )
}

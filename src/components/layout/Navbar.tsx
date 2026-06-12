import { useState } from 'react'
import { Icon, Btn, Avatar, Dropdown, MenuItem } from '@/components/ui'
import { DATA } from '@/data/mockData'
import { getEmisor } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession, clearSession } from '@/stores/auth'
import { logout } from '@/api/auth'
import type { Nav } from '@/config/navigation'

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
  const [loggingOut, setLoggingOut] = useState(false)

  // Empresa real del tenant (GET /api/emisor) — misma caché que Configuración.
  const emisorQ = useApiQuery(['emisor'], getEmisor)
  const empresaNombre = emisorQ.data?.nombre_comercial || emisorQ.data?.razon_social || ''
  const empresaIniciales = empresaNombre
    ? empresaNombre.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '…'

  const handleLogout = async () => {
    setLoggingOut(true)
    await logout()
    clearSession()
  }

  return (
    <>
    {loggingOut && (
      <div className="overlay" style={{ zIndex: 9999 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <span style={{ color: '#fff', fontSize: 14, opacity: 0.85 }}>Cerrando sesión…</span>
        </div>
      </div>
    )}
    <header className="navbar">
      <button className="icon-btn mobile-only" onClick={onOpenMobileNav}><Icon name="menu" /></button>
      <div className="co-switch desktop-only" style={{ cursor: 'default' }} title={emisorQ.data?.rnc ? `RNC ${emisorQ.data.rnc}` : undefined}>
        <span className="co-logo">{empresaIniciales}</span>
        <span className="nm">{emisorQ.loading ? 'Cargando…' : empresaNombre || 'Empresa sin configurar'}</span>
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
          <MenuItem icon="settings" onClick={() => nav('configuracion')}>Configuración</MenuItem>
          <div className="menu-sep"></div>
          <MenuItem icon="log-out" danger onClick={handleLogout}>Cerrar sesión</MenuItem>
        </Dropdown>
      </div>
    </header>
    </>
  )
}

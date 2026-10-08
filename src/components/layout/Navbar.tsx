import { useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Avatar, Dropdown, MenuItem, type IconName } from '@/components/ui'
import { getEmisor, getBranding, ApiError } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession, clearSession } from '@/stores/auth'
import { logout, posHandoff } from '@/api/auth'
import { hasModule } from '@/config/permissions'
import { puedeVerVista, type Nav, type NavPayload, type ViewId } from '@/config/navigation'

// Accesos del botón "Nueva". Cada uno se muestra solo si el rol puede abrir su
// vista (mismo criterio que el sidebar, ver puedeVerVista).
const NUEVOS: { view: ViewId; payload?: NavPayload; icon: IconName; label: string }[] = [
  { view: 'factura-nueva', icon: 'file-text', label: 'Factura' },
  { view: 'gastos', payload: { kind: 'nuevo' }, icon: 'receipt', label: 'Gasto menor' },
  { view: 'compras', payload: { kind: 'nuevo' }, icon: 'shopping-cart', label: 'Compra' },
  { view: 'cotizacion-nueva', icon: 'file-plus', label: 'Cotización' },
]

export interface NavbarProps {
  nav: Nav
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenSearch: () => void
  onOpenMobileNav: () => void
  /** Pregunta antes de cerrar sesión si la vista tiene algo sin guardar (ver useHistoryNav). */
  confirmarSalida: (accion: () => void) => void
}

export function Navbar({
  nav, theme, onToggleTheme, onOpenSearch, onOpenMobileNav, confirmarSalida,
}: NavbarProps) {
  const { user } = useSession()
  const userName = user?.name || 'Usuario'
  const userEmail = user?.email || ''
  const userRole = user?.role || ''
  const [loggingOut, setLoggingOut] = useState(false)
  const nuevos = NUEVOS.filter((n) => puedeVerVista(user, n.view))

  // Empresa real del tenant (GET /api/emisor) — misma caché que Configuración.
  const emisorQ = useApiQuery(['emisor'], getEmisor)
  const empresaNombre = emisorQ.data?.nombre_comercial || emisorQ.data?.razon_social || ''
  const empresaIniciales = empresaNombre
    ? empresaNombre.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '…'

  // Botón POS (api-gratex docs/specs/pos.md A1): solo si la empresa tiene el
  // POS activo y el rol tiene el módulo 'pos'. Misma caché de branding que el
  // resto de la app.
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const puedePos = branding?.pos_enabled === true && hasModule(user?.permissions ?? [], 'pos')
  const [abriendoPos, setAbriendoPos] = useState(false)

  const abrirPos = async () => {
    // La pestaña se abre YA, en el clic: abierta después del await, el
    // navegador la bloquea como ventana emergente. Se le pone la URL al llegar.
    const pestana = window.open('', '_blank')
    setAbriendoPos(true)
    try {
      const r = await posHandoff()
      // En desarrollo no hay pos.fiscalpoint.com.do: el POS vive en /pos.html.
      const url = import.meta.env.DEV ? `${window.location.origin}/pos.html#code=${r.code}` : r.url
      if (pestana) {
        pestana.opener = null
        pestana.location.href = url
      } else {
        window.location.href = url
      }
    } catch (e) {
      pestana?.close()
      toast.error(e instanceof ApiError ? e.message : 'No se pudo abrir el POS. Inténtalo de nuevo.')
    } finally {
      setAbriendoPos(false)
    }
  }

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
        {puedePos && (
          <Btn
            size="sm" icon="printer" className="desktop-only"
            onClick={() => void abrirPos()} disabled={abriendoPos}
            title="Abrir el punto de venta en una pestaña nueva"
          >POS</Btn>
        )}
        {/* Sin ningún acceso permitido no hay botón: un menú vacío no lleva a nada. */}
        {nuevos.length > 0 && (
          <Dropdown align="right" width={210} className="desktop-only" trigger={
            <Btn variant="primary" size="sm" icon="plus">Nueva</Btn>
          }>
            {nuevos.map((n) => (
              <MenuItem key={n.view} icon={n.icon} onClick={() => nav(n.view, n.payload)}>{n.label}</MenuItem>
            ))}
          </Dropdown>
        )}
        <button className="icon-btn" onClick={onToggleTheme} title="Cambiar tema">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <span className="navbar-divider"></span>
        <Dropdown align="right" width={220} trigger={
          <div className="user-chip"><Avatar name={userName} size={30} /><div className="desktop-only col"><span className="nm">{userName}</span><span className="rl">{userRole}</span></div></div>
        }>
          <div className="menu-label">{userEmail}</div>
          <MenuItem icon="settings" onClick={() => nav('configuracion')}>Configuración</MenuItem>
          <div className="menu-sep"></div>
          <MenuItem icon="log-out" danger onClick={() => confirmarSalida(() => void handleLogout())}>Cerrar sesión</MenuItem>
        </Dropdown>
      </div>
    </header>
    </>
  )
}

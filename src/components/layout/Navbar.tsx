import { useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Avatar, Dropdown, MenuItem, type IconName } from '@/components/ui'
import { getEmisor, ApiError } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession, clearSession, setSession } from '@/stores/auth'
import { cambiarEmpresa, logout, posHandoff, type EmpresaAcceso } from '@/api/auth'
import { hasModule } from '@/config/permissions'
import { usePosActivo } from '@/features/pos/usePosActivo'
import { CambiarEmpresaModal } from '@/features/auth/CambiarEmpresaModal'
import { enEmpresaDeCliente, iniciales, tieneAccesoGlobal } from '@/features/auth/accesoGlobal'
import { haySinGuardar, rearmarSinGuardar } from '@/hooks/useAvisoSalida'
import { puedeVerVista, type Nav, type NavPayload, type ViewId } from '@/config/navigation'

// Accesos del botón "Nueva". Cada uno se muestra solo si el rol puede abrir su
// vista (mismo criterio que el sidebar, ver puedeVerVista).
const NUEVOS: { view: ViewId; payload?: NavPayload; icon: IconName; label: string }[] = [
  { view: 'factura-nueva', icon: 'file-text', label: 'Factura' },
  { view: 'gastos', payload: { kind: 'nuevo' }, icon: 'receipt', label: 'Gasto menor' },
  { view: 'compras', payload: { kind: 'nuevo' }, icon: 'shopping-cart', label: 'Compra' },
  { view: 'cotizacion-nueva', icon: 'file-plus', label: 'Cotización' },
  { view: 'cobros', payload: { kind: 'nuevo' }, icon: 'wallet', label: 'Cobro' },
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
  // Un usuario de soporte trae además la de su sesión: sirve si el emisor no está configurado.
  const emisorQ = useApiQuery(['emisor'], getEmisor)
  const empresaNombre = emisorQ.data?.nombre_comercial || emisorQ.data?.razon_social || user?.empresa?.nombre || ''
  const empresaIniciales = empresaNombre ? iniciales(empresaNombre) : '…'
  const empresaRnc = emisorQ.data?.rnc || user?.empresa?.rnc || ''

  // Soporte (acceso global, api-gratex docs/modules/acceso-global.md): puede pasar
  // su sesión a otra empresa. En la de un cliente la caja se pinta de aviso.
  const accesoGlobal = tieneAccesoGlobal(user)
  const deCliente = enEmpresaDeCliente(user)
  const [selector, setSelector] = useState(false)
  const [entrandoA, setEntrandoA] = useState<string | null>(null)

  // habiaSinGuardar: la vista tenía algo sin guardar y el usuario aceptó perderlo. Si el
  // cambio falla, la vista sigue en pantalla y su aviso tiene que volver a valer.
  const entrar = async (e: EmpresaAcceso, habiaSinGuardar: boolean) => {
    setEntrandoA(e.nombre)
    try {
      // Sesión NUEVA en esa empresa (token nuevo): esta pestaña se queda con ella; otra
      // abierta sigue con su token en la empresa que muestra, hasta que se recargue.
      const s = await cambiarEmpresa(e.id)
      setSession(s.token, s.user)
      // Lo que hay en pantalla y en la caché es de la empresa anterior: se recarga
      // la app entera, y abre en el panel (la vista guardada era de la otra empresa).
      try {
        localStorage.setItem('fiscalo.view', 'dashboard')
      } catch {
        /* sin almacenamiento: abre en la vista que tenía */
      }
      window.location.reload()
    } catch (err) {
      setEntrandoA(null)
      if (err instanceof ApiError && err.status === 401) {
        clearSession()
        return
      }
      if (habiaSinGuardar) rearmarSinGuardar()
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar de empresa. Inténtalo de nuevo.')
    }
  }
  // El selector se cierra antes de preguntar por lo que haya sin guardar: si no,
  // quedarían dos diálogos uno encima del otro.
  const elegirEmpresa = (e: EmpresaAcceso) => {
    setSelector(false)
    const habia = haySinGuardar()
    confirmarSalida(() => void entrar(e, habia))
  }

  // Botón POS (api-gratex docs/specs/pos.md A1): solo si la empresa tiene el
  // POS activo y el rol tiene el módulo 'pos' (mismo criterio que el menú).
  const posActivo = usePosActivo()
  const puedePos = posActivo === true && hasModule(user?.permissions ?? [], 'pos')
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
    {(loggingOut || entrandoA !== null) && (
      <div className="overlay" style={{ zIndex: 9999 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <span style={{ color: '#fff', fontSize: 14, opacity: 0.85 }}>
            {entrandoA !== null ? `Entrando a ${entrandoA}…` : 'Cerrando sesión…'}
          </span>
        </div>
      </div>
    )}
    {selector && <CambiarEmpresaModal onClose={() => setSelector(false)} onElegir={elegirEmpresa} />}
    <header className="navbar">
      <button className="icon-btn mobile-only" onClick={onOpenMobileNav}><Icon name="menu" /></button>
      {accesoGlobal ? (
        <button
          type="button"
          className={'co-switch desktop-only' + (deCliente ? ' soporte' : '')}
          onClick={() => setSelector(true)}
          title={(deCliente ? 'Estás como soporte en la empresa de un cliente. ' : '')
            + (empresaRnc ? `RNC ${empresaRnc}. ` : '') + 'Clic para cambiar de empresa.'}
        >
          <span className="co-logo">{empresaIniciales}</span>
          <span className="nm">{emisorQ.loading && !user?.empresa ? 'Cargando…' : empresaNombre || 'Empresa sin configurar'}</span>
          {deCliente && <span className="co-tag">Soporte</span>}
          <Icon name="chevron-down" size={14} />
        </button>
      ) : (
        <div className="co-switch desktop-only" style={{ cursor: 'default' }} title={empresaRnc ? `RNC ${empresaRnc}` : undefined}>
          <span className="co-logo">{empresaIniciales}</span>
          <span className="nm">{emisorQ.loading ? 'Cargando…' : empresaNombre || 'Empresa sin configurar'}</span>
        </div>
      )}
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
              <MenuItem
                key={n.view} icon={n.icon}
                // Cobros recibe la señal como objeto NUEVO en cada clic (compara por identidad): con el mismo objeto,
                // la segunda vez que se pulsa "Cobro" no cambiaba nada y el formulario no se abría. Gastos y Compras
                // siguen con el suyo: con un objeto nuevo preguntarían por lo sin guardar al repetir el clic.
                onClick={() => nav(n.view, n.view === 'cobros' && n.payload ? { ...n.payload } : n.payload)}
              >
                {n.label}
              </MenuItem>
            ))}
          </Dropdown>
        )}
        <button className="icon-btn" onClick={onToggleTheme} title="Cambiar tema">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <span className="navbar-divider"></span>
        {/* En el teléfono la caja de la empresa no se ve: sin esto, nada diría que la
            sesión está en la empresa de un cliente. */}
        {deCliente && (
          <span className="co-tag mobile-only" title={`Soporte en ${user?.empresa?.nombre ?? 'otra empresa'}`}>
            Soporte
          </span>
        )}
        <Dropdown align="right" width={220} trigger={
          <div className="user-chip"><Avatar name={userName} size={30} /><div className="desktop-only col"><span className="nm">{userName}</span><span className="rl">{userRole}</span></div></div>
        }>
          <div className="menu-label">{userEmail}</div>
          {accesoGlobal && (
            <>
              {/* En el teléfono la caja de la empresa no se ve: aquí dice dónde está. */}
              {user?.empresa && (
                <div className="menu-label">{deCliente ? 'Soporte en ' : 'En '}{user.empresa.nombre}</div>
              )}
              <MenuItem icon="arrow-left-right" onClick={() => setSelector(true)}>Cambiar de empresa</MenuItem>
            </>
          )}
          <MenuItem icon="settings" onClick={() => nav('configuracion')}>Configuración</MenuItem>
          <div className="menu-sep"></div>
          <MenuItem icon="log-out" danger onClick={() => confirmarSalida(() => void handleLogout())}>Cerrar sesión</MenuItem>
        </Dropdown>
      </div>
    </header>
    </>
  )
}

import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { Sidebar } from '@/components/layout/Sidebar'
import { Navbar } from '@/components/layout/Navbar'
import { SearchPalette } from '@/components/layout/SearchPalette'
import { DashboardView } from '@/features/dashboard/DashboardView'
import { InvoiceListView } from '@/features/invoices/InvoiceListView'
import { InvoiceDetailView } from '@/features/invoices/InvoiceDetailView'
import { InvoiceFormView } from '@/features/invoices/InvoiceFormView'
import { SimpleInvoiceListView } from '@/features/invoices/SimpleInvoiceListView'
import { SimpleInvoiceFormView } from '@/features/invoices/SimpleInvoiceFormView'
import { RecurringView } from '@/features/invoices/RecurringView'
import { EcfDashboardView } from '@/features/ecf/EcfDashboardView'
import { EcfTypeView } from '@/features/ecf/EcfTypeView'
import { ApproveEcfView } from '@/features/ecf/ApproveEcfView'
import { DgiiInboxView } from '@/features/ecf/DgiiInboxView'
import { ClientsView } from '@/features/clients/ClientsView'
import { CotizacionesView } from '@/features/cotizaciones/CotizacionesView'
import { CotizacionFormView } from '@/features/cotizaciones/CotizacionFormView'
import { ProductsView } from '@/features/products/ProductsView'
import { CategoriesView } from '@/features/categories/CategoriesView'
import { WarehousesView } from '@/features/warehouses/WarehousesView'
import { AdjustmentsView } from '@/features/inventory/AdjustmentsView'
import { InventoryValueView } from '@/features/inventory/InventoryValueView'
import { AdjustmentFormView } from '@/features/inventory/AdjustmentFormView'
import { ExpensesView } from '@/features/expenses/ExpensesView'
import { PurchasesView } from '@/features/purchases/PurchasesView'
import { SuppliersView } from '@/features/suppliers/SuppliersView'
import { ReportsView } from '@/features/reports/ReportsView'
import { ReportesFiscalesView } from '@/features/reports/ReportesFiscalesView'
import { Reporte606View } from '@/features/reports/Reporte606View'
import { Reporte607View } from '@/features/reports/Reporte607View'
import { VentasView } from '@/features/reports/VentasView'
import { TreasuryView } from '@/features/treasury/TreasuryView'
import { UsersView } from '@/features/users/UsersView'
import { AuditLogView } from '@/features/audit/AuditLogView'
import { SettingsView } from '@/features/settings/SettingsView'
import { NotificationsView } from '@/features/notifications/NotificationsView'
import { LoginView } from '@/features/auth/LoginView'
import { useSession, getToken, setSession } from '@/stores/auth'
import { me } from '@/api/auth'
import { esRolAdmin, hasModule } from '@/config/permissions'
import { useHistoryNav } from '@/hooks/useHistoryNav'
import { isCotizacionRef, isFacturaPrefill, isFacturaSimpleRef, isNuevoSignal, navModuleFor, navSoloAdmin, type ViewId } from '@/config/navigation'
import type { EcfTipo, Factura } from '@/types/domain'

/* ============================================================
   FISCALO — App shell (sidebar + navbar + ruteo)
   ============================================================ */

// Apariencia fija del prototipo (en producción saldría de Configuración).
// Sin `as const`: las propiedades son `string`, así las comparaciones siguen siendo válidas.
const THEME = { accent: 'blue', sidebarStyle: 'espaciado', dashLayout: 'completo', density: 'comodo' }

type ThemeMode = 'light' | 'dark'

// Vistas que necesitan un payload en memoria (la factura abierta, el tipo e-CF).
// `view` se persiste pero el payload NO, asi que al reabrir la pestana quedarian
// en blanco ('No hay factura seleccionada') con el menu marcando su grupo, que
// se lee como "el listado salio vacio". Se cae al listado correspondiente.
// Mismo criterio al volver con "atras" a una de ellas despues de una recarga.
const VIEW_SIN_PAYLOAD: Partial<Record<ViewId, ViewId>> = {
  'factura-ver': 'facturas',
  'factura-simple-editar': 'facturas-simples',
  'ecf-tipo': 'ecf',
  // Recargar sobre una cotizacion en edicion mostraria un formulario en blanco
  // que parece listo para guardar: se vuelve al listado, que deja claro que lo
  // que se estaba escribiendo ya no esta.
  'cotizacion-nueva': 'cotizaciones',
}

function restoreView(): ViewId {
  const guardada = localStorage.getItem('fiscalo.view') as ViewId | null
  if (!guardada) return 'dashboard'
  return VIEW_SIN_PAYLOAD[guardada] ?? guardada
}

function App() {
  // Puerta de autenticación: sin sesión se muestra el login; con sesión, el shell.
  const { authenticated } = useSession()
  return authenticated ? <AppShell /> : <LoginView />
}

function AppShell() {
  const { user } = useSession()
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('fiscalo.theme') as ThemeMode) || 'light')
  const [mobileNav, setMobileNav] = useState(false)
  const [search, setSearch] = useState(false)

  // Vista actual enlazada al historial del navegador: atrás/adelante se mueven
  // entre vistas de la app. Cualquier cambio de vista, venga de un clic o del
  // navegador, cierra el menú móvil y la búsqueda y sube el scroll.
  const { view, payload, nav } = useHistoryNav({
    inicial: restoreView,
    sinPayload: VIEW_SIN_PAYLOAD,
    onCambio: () => {
      setMobileNav(false)
      setSearch(false)
      const c = document.querySelector('.content')
      if (c) c.scrollTop = 0
    },
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fiscalo.theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('fiscalo.view', view) }, [view])
  useEffect(() => { document.documentElement.setAttribute('data-accent', THEME.accent) }, [])

  // Refresca rol/permisos vivos desde el backend al montar (sin re-login), así el
  // menú refleja cambios de rol. Best-effort: si falla, se conserva la sesión actual.
  useEffect(() => {
    const token = getToken()
    if (!token) return
    me().then((u) => setSession(token, u)).catch(() => {})
  }, [])

  const sbClass = THEME.sidebarStyle === 'contraste' ? ' sb-contrast' : THEME.sidebarStyle === 'compacto' ? ' sb-compact' : ''

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) }
      if (e.key === 'Escape') setSearch(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Ojo con el orden: 'facturas-simples' y 'factura-simple-*' tambien empiezan
  // por 'factura', asi que se resuelven ANTES del prefijo generico.
  const activeTop: string = view.startsWith('factura-simple') || view === 'facturas-simples'
    ? 'facturas-simples'
    : view.startsWith('factura')
    ? 'facturas'
    : view === 'recurrentes'
      ? 'facturas'
      : view === 'ecf-tipo'
        ? 'ecf'
        : view.startsWith('reportes')
          ? 'reportes'
          : view

  // Si el rol no tiene el módulo de la vista actual, volver al dashboard (evita
  // quedar en una página que el backend va a rechazar con 403). Fail-open sin permisos.
  // Reemplaza en vez de apilar: si no, "atrás" volvería a la vista prohibida y
  // la redirección se repetiría, dejando al usuario atrapado.
  useEffect(() => {
    const mod = navModuleFor(activeTop as ViewId)
    const perms = user?.permissions
    if (mod && perms && !hasModule(perms, mod)) nav('dashboard', null, { replace: true })
    // Lo exclusivo del admin no es fail-open: sin rol admin, fuera.
    else if (navSoloAdmin(activeTop as ViewId) && user && !esRolAdmin(user.role)) nav('dashboard', null, { replace: true })
  }, [activeTop, user, nav])

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView nav={nav} variant={THEME.dashLayout === 'enfoque' ? 'focus' : 'balanced'} />
      case 'facturas': return <InvoiceListView nav={nav} />
      case 'factura-nueva': return <InvoiceFormView nav={nav} prefill={isFacturaPrefill(payload) ? payload : null} />
      case 'factura-ver': return <InvoiceDetailView factura={payload as Factura | null} nav={nav} />
      case 'facturas-simples': return <SimpleInvoiceListView nav={nav} />
      case 'factura-simple-nueva': return <SimpleInvoiceFormView nav={nav} facturaId={null} />
      case 'factura-simple-editar':
        return <SimpleInvoiceFormView nav={nav} facturaId={isFacturaSimpleRef(payload) ? payload.id : null} />
      case 'recurrentes': return <RecurringView nav={nav} />
      case 'cotizaciones': return <CotizacionesView nav={nav} />
      case 'cotizacion-nueva':
        return <CotizacionFormView nav={nav} cotizacionId={isCotizacionRef(payload) ? payload.id : null} />
      case 'clientes': return <ClientsView nav={nav} />
      case 'productos': return <ProductsView />
      case 'categorias': return <CategoriesView />
      case 'almacenes': return <WarehousesView />
      case 'ajustes': return <AdjustmentsView nav={nav} />
      case 'inventario-valor': return <InventoryValueView />
      case 'ajuste-nuevo': return <AdjustmentFormView nav={nav} />
      case 'ecf': return <EcfDashboardView nav={nav} />
      case 'ecf-tipo': return <EcfTypeView tipo={payload as EcfTipo | null} nav={nav} />
      case 'aprobar-ecf': return <ApproveEcfView />
      case 'bandeja-dgii': return <DgiiInboxView nav={nav} />
      case 'gastos': return <ExpensesView autoNew={isNuevoSignal(payload)} />
      case 'compras': return <PurchasesView autoNew={isNuevoSignal(payload)} />
      case 'proveedores': return <SuppliersView />
      case 'tesoreria': return <TreasuryView />
      case 'reportes': return <ReportsView nav={nav} />
      case 'reportes-fiscales': return <ReportesFiscalesView nav={nav} />
      case 'reportes-606': return <Reporte606View nav={nav} />
      case 'reportes-607': return <Reporte607View nav={nav} />
      case 'reportes-ventas': return <VentasView nav={nav} />
      case 'usuarios': return <UsersView />
      case 'bitacora': return <AuditLogView nav={nav} />
      case 'configuracion': return <SettingsView />
      case 'notificaciones': return <NotificationsView />
      default: return <DashboardView nav={nav} />
    }
  }

  return (
    <div className={'app' + (THEME.density === 'compacto' ? ' density-compact' : '')}>
      <Sidebar
        nav={nav}
        activeTop={activeTop}
        sbClass={sbClass}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
      />

      <div className="main-col">
        <Navbar
          nav={nav}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onOpenSearch={() => setSearch(true)}
          onOpenMobileNav={() => setMobileNav(true)}
        />
        <div className="content">{renderView()}</div>
      </div>

      {search && <SearchPalette nav={nav} onClose={() => setSearch(false)} />}
      <Toaster theme={theme} position="top-right" richColors closeButton />
    </div>
  )
}

export default App

import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { Sidebar } from '@/components/layout/Sidebar'
import { Navbar } from '@/components/layout/Navbar'
import { SearchPalette } from '@/components/layout/SearchPalette'
import { DashboardView } from '@/features/dashboard/DashboardView'
import { InvoiceListView } from '@/features/invoices/InvoiceListView'
import { InvoiceDetailView } from '@/features/invoices/InvoiceDetailView'
import { InvoiceFormView } from '@/features/invoices/InvoiceFormView'
import { RecurringView } from '@/features/invoices/RecurringView'
import { EcfDashboardView } from '@/features/ecf/EcfDashboardView'
import { EcfTypeView } from '@/features/ecf/EcfTypeView'
import { ApproveEcfView } from '@/features/ecf/ApproveEcfView'
import { DgiiInboxView } from '@/features/ecf/DgiiInboxView'
import { ClientsView } from '@/features/clients/ClientsView'
import { CotizacionesView } from '@/features/cotizaciones/CotizacionesView'
import { ProductsView } from '@/features/products/ProductsView'
import { ExpensesView } from '@/features/expenses/ExpensesView'
import { PurchasesView } from '@/features/purchases/PurchasesView'
import { SuppliersView } from '@/features/suppliers/SuppliersView'
import { ReportsView } from '@/features/reports/ReportsView'
import { ReportesFiscalesView } from '@/features/reports/ReportesFiscalesView'
import { Reporte606View } from '@/features/reports/Reporte606View'
import { Reporte607View } from '@/features/reports/Reporte607View'
import { TreasuryView } from '@/features/treasury/TreasuryView'
import { UsersView } from '@/features/users/UsersView'
import { SettingsView } from '@/features/settings/SettingsView'
import { NotificationsView } from '@/features/notifications/NotificationsView'
import { LoginView } from '@/features/auth/LoginView'
import { useSession } from '@/stores/auth'
import { isFacturaPrefill, isNuevoSignal, type Nav, type NavPayload, type ViewId } from '@/config/navigation'
import type { EcfTipo, Factura } from '@/types/domain'

/* ============================================================
   FISCALO — App shell (sidebar + navbar + ruteo)
   ============================================================ */

// Apariencia fija del prototipo (en producción saldría de Configuración).
// Sin `as const`: las propiedades son `string`, así las comparaciones siguen siendo válidas.
const THEME = { accent: 'blue', sidebarStyle: 'espaciado', dashLayout: 'completo', density: 'comodo' }

type ThemeMode = 'light' | 'dark'

function App() {
  // Puerta de autenticación: sin sesión se muestra el login; con sesión, el shell.
  const { authenticated } = useSession()
  return authenticated ? <AppShell /> : <LoginView />
}

function AppShell() {
  const [view, setView] = useState<ViewId>(() => (localStorage.getItem('fiscalo.view') as ViewId) || 'dashboard')
  const [payload, setPayload] = useState<NavPayload>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('fiscalo.theme') as ThemeMode) || 'light')
  const [mobileNav, setMobileNav] = useState(false)
  const [search, setSearch] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fiscalo.theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('fiscalo.view', view) }, [view])
  useEffect(() => { document.documentElement.setAttribute('data-accent', THEME.accent) }, [])

  const sbClass = THEME.sidebarStyle === 'contraste' ? ' sb-contrast' : THEME.sidebarStyle === 'compacto' ? ' sb-compact' : ''

  const nav = useCallback<Nav>((v, p = null) => {
    setView(v)
    setPayload(p)
    setMobileNav(false)
    const c = document.querySelector('.content')
    if (c) c.scrollTop = 0
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) }
      if (e.key === 'Escape') setSearch(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const activeTop: string = view.startsWith('factura')
    ? 'facturas'
    : view === 'recurrentes'
      ? 'facturas'
      : view === 'ecf-tipo'
        ? 'ecf'
        : view.startsWith('reportes')
          ? 'reportes'
          : view

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView nav={nav} variant={THEME.dashLayout === 'enfoque' ? 'focus' : 'balanced'} />
      case 'facturas': return <InvoiceListView nav={nav} />
      case 'factura-nueva': return <InvoiceFormView nav={nav} prefill={isFacturaPrefill(payload) ? payload : null} />
      case 'factura-ver': return <InvoiceDetailView factura={payload as Factura | null} nav={nav} />
      case 'recurrentes': return <RecurringView nav={nav} />
      case 'cotizaciones': return <CotizacionesView nav={nav} autoNew={isNuevoSignal(payload)} />
      case 'clientes': return <ClientsView nav={nav} />
      case 'productos': return <ProductsView />
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
      case 'usuarios': return <UsersView />
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

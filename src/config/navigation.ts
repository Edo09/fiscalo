// Navegación de la aplicación: vistas, grupos del sidebar y títulos.
import type { IconName } from '@/components/ui/Icon'
import type { Factura, EcfTipo, FacturaPrefill } from '@/types/domain'
import { esRolAdmin, hasModule } from '@/config/permissions'

export type ViewId =
  | 'dashboard'
  | 'notificaciones'
  | 'facturas'
  | 'factura-nueva'
  | 'factura-ver'
  | 'facturas-simples'
  | 'factura-simple-nueva'
  | 'factura-simple-editar'
  | 'recurrentes'
  | 'cotizaciones'
  | 'cotizacion-nueva'
  | 'clientes'
  | 'productos'
  | 'categorias'
  | 'almacenes'
  | 'inventario-valor'
  | 'ajustes'
  | 'ajuste-nuevo'
  | 'ecf'
  | 'ecf-tipo'
  | 'aprobar-ecf'
  | 'bandeja-dgii'
  | 'gastos'
  | 'compras'
  | 'proveedores'
  | 'tesoreria'
  | 'reportes'
  | 'reportes-fiscales'
  | 'reportes-ventas'
  | 'reportes-606'
  | 'reportes-607'
  | 'usuarios'
  | 'bitacora'
  | 'configuracion'

/** Señal del botón "Nueva" del navbar: abre el formulario de alta al llegar a la vista. */
export interface NuevoSignal { kind: 'nuevo' }

/** Referencia a una factura simple para abrirla en su formulario de edición. */
export interface FacturaSimpleRef { kind: 'factura-simple'; id: number }

/** Referencia a una cotización para abrirla en su editor. */
export interface CotizacionRef { kind: 'cotizacion'; id: number }

export type NavPayload = Factura | EcfTipo | FacturaPrefill | NuevoSignal | FacturaSimpleRef | CotizacionRef | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
}

/** ¿El payload apunta a una factura simple? */
export function isFacturaSimpleRef(p: NavPayload): p is FacturaSimpleRef {
  return p != null && (p as FacturaSimpleRef).kind === 'factura-simple'
}

/** ¿El payload apunta a una cotización existente? */
export function isCotizacionRef(p: NavPayload): p is CotizacionRef {
  return p != null && (p as CotizacionRef).kind === 'cotizacion'
}

/** ¿El payload pide abrir el formulario de "nuevo" (desde el botón Nueva)? */
export function isNuevoSignal(p: NavPayload): p is NuevoSignal {
  return p != null && (p as NuevoSignal).kind === 'nuevo'
}

export interface NavOptions {
  /**
   * Reemplaza la entrada actual del historial en vez de apilar una nueva. Para
   * redirecciones: tras guardar o borrar, "atrás" no debe volver al formulario
   * ya enviado; y una vista sin permiso no debe quedar detrás, o "atrás"
   * volvería a ella y redirigiría otra vez.
   */
  replace?: boolean
  /**
   * Sale aunque la vista tenga algo sin guardar, sin preguntar (ver
   * hooks/useAvisoSalida). Para cuando quedarse no es opción: una vista sin
   * permiso tampoco podría guardar.
   */
  forzar?: boolean
}

/** Cambia de vista, con un payload opcional (factura, tipo e-CF…). Cada cambio
    queda en el historial del navegador (ver hooks/useHistoryNav). */
export type Nav = (view: ViewId, payload?: NavPayload, opts?: NavOptions) => void

export type BadgeTone = 'danger' | 'warn'

export interface NavItem {
  id: ViewId
  label: string
  icon: IconName
  badge?: number
  badgeTone?: BadgeTone
  /** Módulo RBAC requerido para ver este item (del catálogo en config/permissions).
      Sin `module` => siempre visible. Ver hasModule() / docs/roles-permisos.md. */
  module?: string
  /** Solo para el rol admin (por nombre de rol, no por módulo). Ver esRolAdmin(). */
  soloAdmin?: boolean
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    group: 'Principal',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
      // 'notificaciones' (Centro de notificaciones) oculto hasta implementarlo.
    ],
  },
  {
    group: 'Ventas',
    items: [
      { id: 'facturas', label: 'Facturación', icon: 'file-text', module: 'facturas' },
      { id: 'facturas-simples', label: 'Facturas simples', icon: 'file', module: 'facturas-simples' },
      { id: 'cotizaciones', label: 'Cotizaciones', icon: 'file-plus', module: 'cotizaciones' },
      { id: 'clientes', label: 'Clientes', icon: 'users', module: 'clients' },
    ],
  },
  {
    group: 'Inventario',
    items: [
      { id: 'productos', label: 'Productos y servicios', icon: 'package', module: 'products' },
      { id: 'categorias', label: 'Categorías', icon: 'tag', module: 'categories' },
      { id: 'almacenes', label: 'Almacenes', icon: 'archive', module: 'warehouses' },
      { id: 'ajustes', label: 'Ajuste de inventario', icon: 'git-compare', module: 'products' },
      { id: 'inventario-valor', label: 'Valor de inventario', icon: 'hand-coins', module: 'products' },
    ],
  },
  {
    group: 'Compras',
    items: [
      { id: 'gastos', label: 'Gastos', icon: 'receipt', module: 'gastos' },
      { id: 'compras', label: 'Compras', icon: 'shopping-cart', module: 'gastos' },
      { id: 'proveedores', label: 'Proveedores', icon: 'truck', module: 'proveedores' },
    ],
  },
    {
    group: 'Fiscal · DGII',
    items: [
      { id: 'ecf', label: 'Comprobantes e-CF', icon: 'badge-check', module: 'facturas' },
      { id: 'aprobar-ecf', label: 'Aprobar e-CF', icon: 'check-circle', module: 'aprobaciones' },
      // 'bandeja-dgii' (Bandeja DGII) oculto: redundante con el dashboard e-CF (estado por tipo).
    ],
  },
  {
    group: 'Finanzas',
    items: [
      // 'tesoreria' no tiene módulo RBAC propio → siempre visible (solo se ocultan
      // las páginas con un permiso real que el rol no tenga).
      { id: 'tesoreria', label: 'Tesorería', icon: 'landmark' },
      { id: 'reportes', label: 'Reportes', icon: 'bar-chart-3', module: 'reportes' },
    ],
  },
  {
    group: 'Administración',
    items: [
      { id: 'usuarios', label: 'Usuarios y roles', icon: 'shield', module: 'users' },
      { id: 'bitacora', label: 'Bitácora', icon: 'history', soloAdmin: true },
      // 'configuracion' sin módulo RBAC propio → siempre visible.
      { id: 'configuracion', label: 'Configuración', icon: 'settings' },
    ],
  },
]

/**
 * Subvistas (formularios, detalles, sub-reportes) → item del menú al que
 * pertenecen. El sidebar resalta ese item y la subvista hereda su módulo RBAC
 * y su restricción de admin. Una vista que no esté en NAV ni aquí queda SIN
 * gatear: toda vista nueva de un módulo tiene que entrar en uno de los dos.
 */
const SUBVISTA_DE: Partial<Record<ViewId, ViewId>> = {
  'factura-nueva': 'facturas',
  'factura-ver': 'facturas',
  recurrentes: 'facturas',
  'factura-simple-nueva': 'facturas-simples',
  'factura-simple-editar': 'facturas-simples',
  'cotizacion-nueva': 'cotizaciones',
  'ajuste-nuevo': 'ajustes',
  'ecf-tipo': 'ecf',
  'bandeja-dgii': 'ecf',
  'reportes-fiscales': 'reportes',
  'reportes-ventas': 'reportes',
  'reportes-606': 'reportes',
  'reportes-607': 'reportes',
}

/** Item del menú de una vista: ella misma, o el de su grupo si es una subvista. */
export function navTopFor(view: ViewId): ViewId {
  return SUBVISTA_DE[view] ?? view
}

/** ¿La vista (o su item del menú) es solo para el rol admin? */
export function navSoloAdmin(view: ViewId): boolean {
  const top = navTopFor(view)
  return NAV.some((g) => g.items.some((i) => i.id === top && i.soloAdmin))
}

/** Módulo RBAC asociado a una vista (resolviendo subvistas a su item del menú).
    undefined => la vista no está gateada (siempre accesible). */
export function navModuleFor(view: ViewId): string | undefined {
  const top = navTopFor(view)
  for (const g of NAV) {
    const it = g.items.find((i) => i.id === top)
    if (it) return it.module
  }
  return undefined
}

/** Lo que hace falta de la sesión para decidir qué se muestra (ver stores/auth). */
export interface SesionNav {
  role?: string
  permissions?: string[]
}

/**
 * ¿La sesión puede ver el item? Único criterio para el sidebar, el buscador, el
 * botón "Nueva" y la redirección de App. Fail-open cuando no hay lista de
 * permisos (sesión previa a RBAC): el backend sigue siendo la barrera real. Lo
 * exclusivo del admin NO es fail-open: sin rol admin no se muestra.
 */
export function puedeVerItem(user: SesionNav | null | undefined, it: { module?: string; soloAdmin?: boolean }): boolean {
  if (it.soloAdmin) return esRolAdmin(user?.role)
  const perms = user?.permissions
  return !it.module || !perms || hasModule(perms, it.module)
}

/** ¿La sesión puede abrir la vista? Las subvistas heredan el permiso de su item del menú. */
export function puedeVerVista(user: SesionNav | null | undefined, view: ViewId): boolean {
  return puedeVerItem(user, { module: navModuleFor(view), soloAdmin: navSoloAdmin(view) })
}

export const TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  facturas: 'Facturación',
  'factura-nueva': 'Nueva factura',
  'factura-ver': 'Factura',
  'facturas-simples': 'Facturas simples',
  'factura-simple-nueva': 'Nueva factura simple',
  'factura-simple-editar': 'Factura simple',
  recurrentes: 'Recurrentes',
  cotizaciones: 'Cotizaciones',
  'cotizacion-nueva': 'Nueva cotización',
  clientes: 'Clientes',
  productos: 'Productos',
  categorias: 'Categorías',
  almacenes: 'Almacenes',
  ajustes: 'Ajustes de inventario',
  'inventario-valor': 'Valor de inventario',
  'ajuste-nuevo': 'Crear ajuste',
  ecf: 'e-CF',
  'ecf-tipo': 'Tipo e-CF',
  'aprobar-ecf': 'Aprobar e-CF',
  'bandeja-dgii': 'Bandeja DGII',
  gastos: 'Gastos',
  compras: 'Compras',
  proveedores: 'Proveedores',
  tesoreria: 'Tesorería',
  reportes: 'Reportes',
  'reportes-fiscales': 'Reportes fiscales',
  'reportes-ventas': 'Ventas',
  'reportes-606': 'Reporte 606',
  'reportes-607': 'Reporte 607',
  usuarios: 'Usuarios',
  bitacora: 'Bitácora',
  configuracion: 'Configuración',
  notificaciones: 'Notificaciones',
}

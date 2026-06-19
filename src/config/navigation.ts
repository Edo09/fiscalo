// Navegación de la aplicación: vistas, grupos del sidebar y títulos.
import type { Factura, EcfTipo, FacturaPrefill } from '@/types/domain'

export type ViewId =
  | 'dashboard'
  | 'notificaciones'
  | 'facturas'
  | 'factura-nueva'
  | 'factura-ver'
  | 'recurrentes'
  | 'cotizaciones'
  | 'clientes'
  | 'productos'
  | 'categorias'
  | 'almacenes'
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
  | 'reportes-606'
  | 'reportes-607'
  | 'usuarios'
  | 'configuracion'

/** Señal del botón "Nueva" del navbar: abre el formulario de alta al llegar a la vista. */
export interface NuevoSignal { kind: 'nuevo' }

export type NavPayload = Factura | EcfTipo | FacturaPrefill | NuevoSignal | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
}

/** ¿El payload pide abrir el formulario de "nuevo" (desde el botón Nueva)? */
export function isNuevoSignal(p: NavPayload): p is NuevoSignal {
  return p != null && (p as NuevoSignal).kind === 'nuevo'
}

/** Cambia de vista, con un payload opcional (factura, tipo e-CF…). */
export type Nav = (view: ViewId, payload?: NavPayload) => void

export type BadgeTone = 'danger' | 'warn'

export interface NavItem {
  id: ViewId
  label: string
  icon: string
  badge?: number
  badgeTone?: BadgeTone
  /** Módulo RBAC requerido para ver este item (del catálogo en config/permissions).
      Sin `module` => siempre visible. Ver hasModule() / docs/roles-permisos.md. */
  module?: string
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
      // 'configuracion' sin módulo RBAC propio → siempre visible.
      { id: 'configuracion', label: 'Configuración', icon: 'settings' },
    ],
  },
]

/** Módulo RBAC asociado a una vista (resolviendo subvistas a su item del menú).
    undefined => la vista no está gateada (siempre accesible). */
export function navModuleFor(view: ViewId): string | undefined {
  for (const g of NAV) {
    const it = g.items.find((i) => i.id === view)
    if (it) return it.module
  }
  return undefined
}

export const TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  facturas: 'Facturación',
  'factura-nueva': 'Nueva factura',
  'factura-ver': 'Factura',
  recurrentes: 'Recurrentes',
  cotizaciones: 'Cotizaciones',
  clientes: 'Clientes',
  productos: 'Productos',
  categorias: 'Categorías',
  almacenes: 'Almacenes',
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
  'reportes-606': 'Reporte 606',
  'reportes-607': 'Reporte 607',
  usuarios: 'Usuarios',
  configuracion: 'Configuración',
  notificaciones: 'Notificaciones',
}

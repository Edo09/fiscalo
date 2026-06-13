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
  | 'ecf'
  | 'ecf-tipo'
  | 'aprobar-ecf'
  | 'bandeja-dgii'
  | 'gastos'
  | 'compras'
  | 'proveedores'
  | 'tesoreria'
  | 'reportes'
  | 'usuarios'
  | 'configuracion'

export type NavPayload = Factura | EcfTipo | FacturaPrefill | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
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
      { id: 'facturas', label: 'Facturación', icon: 'file-text' },
      { id: 'cotizaciones', label: 'Cotizaciones', icon: 'file-plus' },
      { id: 'clientes', label: 'Clientes', icon: 'users' },
      { id: 'productos', label: 'Productos y servicios', icon: 'package' },
    ],
  },

  {
    group: 'Compras',
    items: [
      { id: 'gastos', label: 'Gastos', icon: 'receipt' },
      { id: 'compras', label: 'Compras', icon: 'shopping-cart' },
      { id: 'proveedores', label: 'Proveedores', icon: 'truck' },
    ],
  },
    {
    group: 'Fiscal · DGII',
    items: [
      { id: 'ecf', label: 'Comprobantes e-CF', icon: 'badge-check' },
      { id: 'aprobar-ecf', label: 'Aprobar e-CF', icon: 'check-circle' },
      { id: 'bandeja-dgii', label: 'Bandeja DGII', icon: 'inbox' },
    ],
  },
  {
    group: 'Finanzas',
    items: [
      { id: 'tesoreria', label: 'Tesorería', icon: 'landmark' },
      { id: 'reportes', label: 'Reportes', icon: 'bar-chart-3' },
    ],
  },
  {
    group: 'Administración',
    items: [
      { id: 'usuarios', label: 'Usuarios y roles', icon: 'shield' },
      { id: 'configuracion', label: 'Configuración', icon: 'settings' },
    ],
  },
]

export const TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  facturas: 'Facturación',
  'factura-nueva': 'Nueva factura',
  'factura-ver': 'Factura',
  recurrentes: 'Recurrentes',
  cotizaciones: 'Cotizaciones',
  clientes: 'Clientes',
  productos: 'Productos',
  ecf: 'e-CF',
  'ecf-tipo': 'Tipo e-CF',
  'aprobar-ecf': 'Aprobar e-CF',
  'bandeja-dgii': 'Bandeja DGII',
  gastos: 'Gastos',
  compras: 'Compras',
  proveedores: 'Proveedores',
  tesoreria: 'Tesorería',
  reportes: 'Reportes',
  usuarios: 'Usuarios',
  configuracion: 'Configuración',
  notificaciones: 'Notificaciones',
}

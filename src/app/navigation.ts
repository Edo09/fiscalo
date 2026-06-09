// Navegación de la aplicación: vistas, grupos del sidebar y títulos.
import type { Factura, EcfTipo } from '@/types/domain'

export type ViewId =
  | 'dashboard'
  | 'notificaciones'
  | 'facturas'
  | 'factura-nueva'
  | 'factura-ver'
  | 'recurrentes'
  | 'clientes'
  | 'productos'
  | 'ecf'
  | 'ecf-tipo'
  | 'bandeja-dgii'
  | 'gastos'
  | 'compras'
  | 'proveedores'
  | 'tesoreria'
  | 'reportes'
  | 'usuarios'
  | 'configuracion'

export type NavPayload = Factura | EcfTipo | null

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
      { id: 'notificaciones', label: 'Notificaciones', icon: 'bell', badge: 3, badgeTone: 'danger' },
    ],
  },
  {
    group: 'Ventas',
    items: [
      { id: 'facturas', label: 'Facturación', icon: 'file-text' },
      { id: 'clientes', label: 'Clientes', icon: 'users' },
      { id: 'productos', label: 'Productos y servicios', icon: 'package' },
    ],
  },
  {
    group: 'Fiscal · DGII',
    items: [
      { id: 'ecf', label: 'Comprobantes e-CF', icon: 'badge-check' },
      { id: 'bandeja-dgii', label: 'Bandeja DGII', icon: 'inbox', badge: 1, badgeTone: 'warn' },
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
  clientes: 'Clientes',
  productos: 'Productos',
  ecf: 'e-CF',
  'ecf-tipo': 'Tipo e-CF',
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

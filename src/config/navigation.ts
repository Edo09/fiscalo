// Navegación de la aplicación: vistas, grupos del sidebar y títulos.
//
// Imports de valor SOLO por ruta relativa con .ts: así
// scripts/test-nav-formato.ts carga este archivo con `node` tal cual. Lo de
// '@/…' va solo como `import type`, que Node borra.
import type { IconName } from '@/components/ui/Icon'
import type { Factura, EcfTipo, FacturaPrefill, FacturaSimplePrefill } from '@/types/domain'
import type { FormatoId } from '@/features/cotizaciones/formatos'
import { esRolAdmin, hasModule } from './permissions.ts'

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
  | 'conduces'
  | 'conduce-editar'
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

/** Referencia a un conduce guardado para abrirlo en su formulario. */
export interface ConduceRef { kind: 'conduce'; id: number }

/** Conduce nuevo a partir de una cotización de Ferretería (botón "Conduce"). */
export interface ConduceDesdeCotizacion { kind: 'conduce-desde-cotizacion'; cotizacionId: number }

export type NavPayload =
  | Factura | EcfTipo | FacturaPrefill | FacturaSimplePrefill | NuevoSignal | FacturaSimpleRef | CotizacionRef
  | ConduceRef | ConduceDesdeCotizacion | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
}

/** ¿El payload es un borrador de factura simple (conversión de cotización de Ferretería)? */
export function isFacturaSimplePrefill(p: unknown): p is FacturaSimplePrefill {
  return p != null && (p as FacturaSimplePrefill).kind === 'factura-simple-prefill'
}

/**
 * La `key` con que App monta el formulario de factura (e-CF o simple) para un
 * borrador. Cada borrador monta un formulario limpio: el formulario toma el
 * borrador solo al montarse (sus líneas son estado propio), así que sin una key
 * distinta, ir de una factura convertida a Nueva > Factura, o de una conversión
 * a otra, dejaría lo de la primera. El origen se identifica por su tipo
 * (`origenTipo`; ausente = cotización) y su código (COT-…, CON-… o #id), que no
 * se repiten entre documentos: dos orígenes distintos nunca comparten key.
 * Sin borrador la key es siempre 'nueva': Nueva > Factura no borra lo que ya se
 * escribió en un formulario en blanco.
 */
export function claveFormularioFactura(borrador: { origenTipo?: 'conduce'; origen?: string } | null): string {
  return borrador ? `${borrador.origenTipo ?? 'cotizacion'}-${borrador.origen ?? ''}` : 'nueva'
}

/** ¿El payload apunta a una factura simple? */
export function isFacturaSimpleRef(p: NavPayload): p is FacturaSimpleRef {
  return p != null && (p as FacturaSimpleRef).kind === 'factura-simple'
}

/** ¿El payload apunta a una cotización existente? */
export function isCotizacionRef(p: NavPayload): p is CotizacionRef {
  return p != null && (p as CotizacionRef).kind === 'cotizacion'
}

/** ¿El payload apunta a un conduce guardado? */
export function isConduceRef(p: unknown): p is ConduceRef {
  return p != null && (p as ConduceRef).kind === 'conduce'
}

/** ¿El payload pide un conduce nuevo desde una cotización? */
export function isConduceDesdeCotizacion(p: unknown): p is ConduceDesdeCotizacion {
  return p != null && (p as ConduceDesdeCotizacion).kind === 'conduce-desde-cotizacion'
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
  /**
   * Solo para los tenants con este formato de cotización (los conduces son de
   * Ferretería). Además de `module`, no en vez de él. Ver puedeVerItem().
   */
  formato?: FormatoId
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
      // Solo Ferretería: el conduce sale de sus cotizaciones (spec conduces 5.1).
      // El permiso es el de Cotizaciones; el formato lo dice branding (puedeVerItem).
      { id: 'conduces', label: 'Conduces', icon: 'truck', module: 'cotizaciones', formato: 'ferreteria' },
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
 * pertenecen. El sidebar resalta ese item y la subvista hereda su módulo RBAC,
 * su restricción de admin y su formato. Una vista que no esté en NAV ni aquí
 * queda SIN gatear: toda vista nueva de un módulo tiene que entrar en uno de los dos.
 */
const SUBVISTA_DE: Partial<Record<ViewId, ViewId>> = {
  'factura-nueva': 'facturas',
  'factura-ver': 'facturas',
  recurrentes: 'facturas',
  'factura-simple-nueva': 'facturas-simples',
  'factura-simple-editar': 'facturas-simples',
  'cotizacion-nueva': 'cotizaciones',
  'conduce-editar': 'conduces',
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

/** Formato de cotización que exige una vista (resolviendo subvistas a su item del menú).
    undefined => la vista no depende del formato del tenant. */
export function navFormatoFor(view: ViewId): FormatoId | undefined {
  const top = navTopFor(view)
  for (const g of NAV) {
    const it = g.items.find((i) => i.id === top)
    if (it) return it.formato
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
 *
 * El formato tampoco es fail-open: un item con `formato` solo se ve cuando el
 * del tenant se sabe y es ese. Sin saberlo (branding cargando o con error, o
 * quien llama sin pasarlo) no se ve, porque Gratex no debe ver nunca lo de
 * Ferretería. Los items sin `formato` dan lo mismo que antes, se pase o no.
 */
export function puedeVerItem(
  user: SesionNav | null | undefined,
  it: { module?: string; soloAdmin?: boolean; formato?: FormatoId },
  formato?: FormatoId | null,
): boolean {
  if (it.formato !== undefined && formato !== it.formato) return false
  if (it.soloAdmin) return esRolAdmin(user?.role)
  const perms = user?.permissions
  return !it.module || !perms || hasModule(perms, it.module)
}

/** ¿La sesión puede abrir la vista? Las subvistas heredan el permiso y el formato de su item del menú. */
export function puedeVerVista(user: SesionNav | null | undefined, view: ViewId, formato?: FormatoId | null): boolean {
  return puedeVerItem(user, { module: navModuleFor(view), soloAdmin: navSoloAdmin(view), formato: navFormatoFor(view) }, formato)
}

/**
 * ¿App tiene que sacar al usuario de la vista? El módulo y lo del admin se
 * aplican ya, como siempre. El formato, solo cuando se sabe: con `formato`
 * null (branding cargando o con error) no se saca a nadie, porque recargar
 * sobre Conduces mandaría al dashboard antes de que branding responda. Sabido
 * y distinto (un Gratex con 'conduces' guardado en el navegador), se sale.
 */
export function debeSalirDeVista(user: SesionNav | null | undefined, view: ViewId, formato: FormatoId | null): boolean {
  if (!puedeVerItem(user, { module: navModuleFor(view), soloAdmin: navSoloAdmin(view) })) return true
  const exigido = navFormatoFor(view)
  return exigido !== undefined && formato !== null && formato !== exigido
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
  conduces: 'Conduces',
  'conduce-editar': 'Conduce',
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

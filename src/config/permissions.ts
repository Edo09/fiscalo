// Catálogo de módulos (permisos) — espejo estático de `config/permissions.php`
// del backend. Un permiso = acceso a un módulo (no hay read/write separados);
// un rol = la lista de módulos que puede ver/usar, o `*` (todos).
//
// El catálogo es IGUAL para todos los tenants (un tenant no inventa rutas, solo
// combina módulos en sus roles). Qué módulos tiene cada rol es per-tenant (DB).
// Ver docs/roles-permisos.md.

/** Permiso comodín: acceso a todos los módulos (rol admin). */
export const PERMISSION_ALL = '*'

export interface ModuleDef {
  /** Nombre del módulo, tal cual lo espera el backend (ej. `facturas`). */
  id: string
  /** Etiqueta para mostrar en la UI. */
  label: string
  /** true = módulo de administración (excluido del rol `user` por defecto). */
  admin?: boolean
}

/** Catálogo de módulos válidos. El orden es el de presentación en la UI. */
export const MODULE_CATALOG: ModuleDef[] = [
  // Operativos
  { id: 'facturas', label: 'Facturación' },
  { id: 'facturas-simples', label: 'Facturas simples' },
  { id: 'cotizaciones', label: 'Cotizaciones' },
  { id: 'clients', label: 'Clientes' },
  { id: 'products', label: 'Productos y servicios' },
  { id: 'gastos', label: 'Gastos y compras' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'aprobaciones', label: 'Aprobación de e-CF' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'ncf', label: 'Secuencias NCF' },
  { id: 'unidades', label: 'Unidades de medida' },
  // Administración (solo admin por defecto)
  { id: 'emisor', label: 'Emisor', admin: true },
  { id: 'branding', label: 'Branding', admin: true },
  { id: 'landing', label: 'Landing', admin: true },
  { id: 'users', label: 'Usuarios', admin: true },
  { id: 'roles', label: 'Roles', admin: true },
]

/** Etiqueta de un módulo (o el id crudo si no está en el catálogo). */
export function moduleLabel(id: string): string {
  if (id === PERMISSION_ALL) return 'Todos los módulos'
  return MODULE_CATALOG.find((m) => m.id === id)?.label ?? id
}

/** ¿El rol concede acceso al módulo? (`*` concede todo.) */
export function hasModule(permissions: string[], moduleId: string): boolean {
  return permissions.includes(PERMISSION_ALL) || permissions.includes(moduleId)
}

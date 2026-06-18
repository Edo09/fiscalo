// Helpers compartidos por la página de Usuarios y roles.
import type { RoleRow, UserRow } from '@/api'
import { PERMISSION_ALL } from '@/config/permissions'

/** Nombre visible de un usuario (nombre + apellido, o username, o el correo). */
export function displayName(u: UserRow): string {
  const full = [u.name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.username || u.email || `Usuario ${u.id}`
}

/** El rol (RoleRow) que corresponde al nombre guardado en el usuario. */
export function roleOf(u: UserRow, roles: RoleRow[]): RoleRow | undefined {
  return roles.find((r) => r.name === u.role)
}

/** ¿El rol concede acceso total (`*`)? */
export function isAdminRole(role: RoleRow | undefined): boolean {
  return !!role && role.permissions.includes(PERMISSION_ALL)
}

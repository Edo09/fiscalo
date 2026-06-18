// Servicio: roles y permisos (RBAC) — /api/roles. Ver docs/roles-permisos.md.
// El módulo `roles` se exige siempre a admin (aun en sombra): es un vector de
// escalada de privilegios.
import { getJson, postJson, request } from './http'
import type { AssignRoleInput, CreateRoleInput, RoleRow, UpdateRoleInput } from './types'

/** Lista los roles del tenant (con sus permisos). */
export async function listRoles(): Promise<RoleRow[]> {
  const data = await getJson<unknown>('/api/roles')
  if (Array.isArray(data)) return data as RoleRow[]
  // Tolera formas envueltas: { roles: [...] } o { items: [...] }.
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    const arr = [o.roles, o.items, o.data].find(Array.isArray)
    if (arr) return arr as RoleRow[]
  }
  return []
}

export function getRole(id: number | string): Promise<RoleRow> {
  return getJson<RoleRow>(`/api/roles/${encodeURIComponent(id)}`)
}

export function createRole(input: CreateRoleInput): Promise<{ id: number; message?: string }> {
  return postJson('/api/roles', input)
}

export function updateRole(id: number | string, input: UpdateRoleInput): Promise<unknown> {
  return request(`/api/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteRole(id: number | string): Promise<unknown> {
  return request(`/api/roles/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Asigna un rol (por nombre) a un usuario del tenant. */
export function assignUserRole(input: AssignRoleInput): Promise<unknown> {
  return request('/api/roles/assign', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

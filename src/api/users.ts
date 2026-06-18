// Servicio: usuarios del tenant (/api/users). Hard-gated por el módulo `users`
// (admin). El tenant sale del token, nunca del body. Ver docs/roles-permisos.md.
import { getList, getJson, postJson, request, qs } from './http'
import type { CreateUserInput, ListParams, ListResult, UpdateUserInput, UserRow } from './types'

export function listUsers(params: ListParams = {}): Promise<ListResult<UserRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<UserRow>(`/api/users${query}`)
}

export function getUser(id: number | string): Promise<UserRow> {
  return getJson<UserRow>(`/api/users/${encodeURIComponent(id)}`)
}

export function createUser(input: CreateUserInput): Promise<{ id: number; message?: string }> {
  return postJson('/api/users', input)
}

export function updateUser(id: number | string, input: UpdateUserInput): Promise<unknown> {
  return request(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteUser(id: number | string): Promise<unknown> {
  return request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

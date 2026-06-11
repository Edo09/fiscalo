// Servicio: directorio de proveedores (/api/proveedores).
import { getList, getJson, postJson, request, qs } from './http'
import type { CreateProveedorInput, ListParams, ListResult, ProveedorRow } from './types'

export function listProveedores(params: ListParams = {}): Promise<ListResult<ProveedorRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ProveedorRow>(`/api/proveedores${query}`)
}

export function getProveedor(id: number | string): Promise<ProveedorRow> {
  return getJson<ProveedorRow>(`/api/proveedores?id=${encodeURIComponent(id)}`)
}

export function createProveedor(input: CreateProveedorInput): Promise<{ id: number; message: string }> {
  return postJson('/api/proveedores', input)
}

export function updateProveedor(input: CreateProveedorInput & { id: number | string }): Promise<unknown> {
  return request('/api/proveedores', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteProveedor(id: number | string): Promise<unknown> {
  return request('/api/proveedores', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

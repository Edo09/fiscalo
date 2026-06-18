// Servicio: almacenes de inventario (/api/warehouses). Ver docs/inventario.md.
// Guardas de borrado (400): Almacén Principal, o almacén con productos asignados.
import { getList, getJson, postJson, request, qs } from './http'
import type { CreateWarehouseInput, ListParams, ListResult, WarehouseRow } from './types'

export function listWarehouses(params: ListParams = {}): Promise<ListResult<WarehouseRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<WarehouseRow>(`/api/warehouses${query}`)
}

export function getWarehouse(id: number | string): Promise<WarehouseRow> {
  return getJson<WarehouseRow>(`/api/warehouses?id=${encodeURIComponent(id)}`)
}

export function createWarehouse(input: CreateWarehouseInput): Promise<{ id: number; message: string }> {
  return postJson('/api/warehouses', input)
}

export function updateWarehouse(input: CreateWarehouseInput & { id: number | string }): Promise<unknown> {
  return request('/api/warehouses', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteWarehouse(id: number | string): Promise<unknown> {
  return request('/api/warehouses', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

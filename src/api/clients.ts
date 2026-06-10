// Servicio: clientes.
import { getList, request, qs } from './http'
import type { ClientRow, ListParams, ListResult } from './types'

export function listClients(params: ListParams = {}): Promise<ListResult<ClientRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ClientRow>(`/api/clients${query}`)
}

/** Actualiza un cliente (PUT con id en el cuerpo, igual que products). */
export function updateClient(input: Partial<Omit<ClientRow, 'id'>> & { id: number | string }): Promise<unknown> {
  return request('/api/clients', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteClient(id: number | string): Promise<unknown> {
  return request('/api/clients', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

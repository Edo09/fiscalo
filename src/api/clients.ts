// Servicio: clientes.
import { getJson, getList, request, qs } from './http'
import type { ClientRow, ListParams, ListResult } from './types'

export function listClients(params: ListParams = {}): Promise<ListResult<ClientRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ClientRow>(`/api/clients${query}`)
}

/**
 * Alta de un cliente. El backend exige email valido, nombre de contacto,
 * empresa y telefono; el RNC es opcional. Devuelve el registro creado.
 */
export interface NewClientInput {
  client_name: string
  company_name: string
  email: string
  phone_number: string
  rnc?: string
}

export function createClient(input: NewClientInput): Promise<ClientRow> {
  return request<ClientRow>('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Detalle de un cliente (registro completo: RNC, dirección, correo…). */
export function getClient(id: number | string): Promise<ClientRow> {
  return getJson<ClientRow>(`/api/clients${qs({ id })}`)
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

// Servicio: clientes.
import { getList, qs } from './http'
import type { ClientRow, ListParams, ListResult } from './types'

export function listClients(params: ListParams = {}): Promise<ListResult<ClientRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ClientRow>(`/api/clients${query}`)
}

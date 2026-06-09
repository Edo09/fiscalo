// Servicio: usuarios.
import { getList, qs } from './http'
import type { ListParams, ListResult, UserRow } from './types'

export function listUsers(params: ListParams = {}): Promise<ListResult<UserRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<UserRow>(`/api/users${query}`)
}

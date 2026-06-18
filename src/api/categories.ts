// Servicio: categorías de inventario (/api/categories). Ver docs/inventario.md.
import { getList, getJson, postJson, request, qs } from './http'
import type { CategoryRow, CreateCategoryInput, ListParams, ListResult } from './types'

export function listCategories(params: ListParams = {}): Promise<ListResult<CategoryRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<CategoryRow>(`/api/categories${query}`)
}

export function getCategory(id: number | string): Promise<CategoryRow> {
  return getJson<CategoryRow>(`/api/categories?id=${encodeURIComponent(id)}`)
}

export function createCategory(input: CreateCategoryInput): Promise<{ id: number; message: string }> {
  return postJson('/api/categories', input)
}

export function updateCategory(input: CreateCategoryInput & { id: number | string }): Promise<unknown> {
  return request('/api/categories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteCategory(id: number | string): Promise<unknown> {
  return request('/api/categories', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

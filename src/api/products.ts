// Servicio: catálogo de productos/servicios (/api/products).
import { getList, getJson, postJson, request, qs } from './http'
import type { CreateProductInput, ListParams, ListResult, ProductRow } from './types'

export function listProducts(params: ListParams = {}): Promise<ListResult<ProductRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ProductRow>(`/api/products${query}`)
}

export function getProduct(id: number | string): Promise<ProductRow> {
  return getJson<ProductRow>(`/api/products?id=${encodeURIComponent(id)}`)
}

export function createProduct(input: CreateProductInput): Promise<{ id: number; message: string }> {
  return postJson('/api/products', input)
}

export function updateProduct(input: CreateProductInput & { id: number | string }): Promise<unknown> {
  return request('/api/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteProduct(id: number | string): Promise<unknown> {
  return request('/api/products', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

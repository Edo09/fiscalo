// Servicio: catálogo de productos/servicios (/api/products).
import { getList, getJson, postJson, request, qs } from './http'
import type { CreateProductInput, ListResult, ProductListParams, ProductRow } from './types'

export function listProducts(params: ProductListParams = {}): Promise<ListResult<ProductRow>> {
  const query = qs({
    page: params.page, pageSize: params.pageSize, query: params.query, category_id: params.categoryId,
  })
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

/**
 * Sube (o cambia) la foto del producto: el JPEG ya reducido de reducirFoto.
 * Responde la ruta nueva; la anterior la borra el servidor.
 */
export function subirFotoProducto(id: number | string, foto: Blob): Promise<{ id: number; imagen_path: string }> {
  const form = new FormData()
  form.append('id', String(id))
  form.append('imagen', foto, 'foto.jpg')
  // Sin Content-Type explícito: el navegador pone el boundary del multipart.
  return request('/api/products/imagen', { method: 'POST', body: form })
}

/** Quita la foto del producto (y el servidor borra el archivo). */
export function quitarFotoProducto(id: number | string): Promise<unknown> {
  return request('/api/products/imagen', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export function deleteProduct(id: number | string): Promise<unknown> {
  return request('/api/products', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

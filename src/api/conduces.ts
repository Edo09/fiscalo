// Servicio: conduces de mercancía de Ferretería (/api/conduces).
//
// El conduce es el papel que va con la mercancía y que el cliente firma. Sale
// de una cotización de Ferretería y nunca muestra precios: cada línea guarda
// el suyo solo para Facturar. El backend lo numera (CON-000001, un número que
// no se vuelve a usar) y no borra nada: Eliminar lo desactiva. A un tenant que
// no tiene el formato 'ferreteria' le responde 422 en todo.
// Ver api-gratex docs/api/conduces.md.
import { getList, getJson, postJson, request, qs } from './http'
import type { ConduceInput, ConduceRow, DocBase64, ListParams, ListResult } from './types'

export function listConduces(params: ListParams = {}): Promise<ListResult<ConduceRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ConduceRow>(`/api/conduces${query}`)
}

/**
 * Detalle (el backend responde `data: [conduce]`, con sus líneas activas).
 * null si no existe o se eliminó: el backend responde `[]` en los dos casos.
 */
export async function getConduce(id: number | string): Promise<ConduceRow | null> {
  const data = await getJson<ConduceRow[] | ConduceRow>(`/api/conduces${qs({ id })}`)
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

/** Crea el conduce de una cotización (`cotizacion_id` obligatorio). El número lo asigna el backend. */
export function createConduce(input: ConduceInput): Promise<{ id: number; code: string; numero: number }> {
  return postJson('/api/conduces', input)
}

/**
 * Guarda una edición: cliente, fecha y el juego completo de líneas. Número,
 * código y cotización de origen no cambian nunca.
 */
export function updateConduce(input: ConduceInput & { id: number }): Promise<{ id: number; code: string; numero: number }> {
  return request('/api/conduces', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Lo desactiva: deja de verse en la lista, y su número no se vuelve a usar. */
export function deleteConduce(id: number | string): Promise<unknown> {
  return request('/api/conduces', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

/** PDF de un conduce guardado, en base64 (mismo formato que cotizaciones). */
export function getConducePdf(id: number | string): Promise<DocBase64> {
  return getJson<DocBase64>(`/api/conduces/${id}/pdf${qs({ format: 'base64' })}`)
}

/**
 * Vista previa del PDF SIN guardar. Con `id` (al editar) sale con el número y
 * la cotización de esa fila; sin `id`, el backend valida `cotizacion_id` como
 * al crear.
 */
export function previewConduce(input: ConduceInput & { id?: number }): Promise<DocBase64> {
  return postJson<DocBase64>('/api/conduces/preview', input)
}

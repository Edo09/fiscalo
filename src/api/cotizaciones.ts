// Servicio: cotizaciones (/api/cotizaciones).
import { getList, getJson, postJson, request, qs } from './http'
import type {
  CotizacionRow, CreateCotizacionInput, DocBase64, ListParams, ListResult,
} from './types'

export function listCotizaciones(params: ListParams = {}): Promise<ListResult<CotizacionRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<CotizacionRow>(`/api/cotizaciones${query}`)
}

/** Detalle (el backend responde `data: [cotizacion]`, con `items` incluidos). */
export async function getCotizacion(id: number | string): Promise<CotizacionRow | null> {
  const data = await getJson<CotizacionRow[] | CotizacionRow>(`/api/cotizaciones${qs({ id })}`)
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

export function createCotizacion(input: CreateCotizacionInput): Promise<{ id: number; code: string; message: string }> {
  return postJson('/api/cotizaciones', input)
}

export function updateCotizacion(input: CreateCotizacionInput & { id: number | string }): Promise<unknown> {
  return request('/api/cotizaciones', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteCotizacion(id: number | string): Promise<unknown> {
  return request('/api/cotizaciones', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

/** PDF de una cotización guardada, en base64 (mismo formato que facturas). */
export function getCotizacionPdf(id: number | string): Promise<DocBase64> {
  return getJson<DocBase64>(`/api/cotizaciones/${id}/pdf${qs({ format: 'base64' })}`)
}

/** Vista previa del PDF SIN guardar la cotización. */
export function previewCotizacion(input: Omit<CreateCotizacionInput, 'user_id' | 'sent_email'>): Promise<DocBase64> {
  return postJson<DocBase64>('/api/cotizaciones/preview', input)
}

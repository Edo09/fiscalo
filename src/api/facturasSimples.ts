// Servicio: facturas simples (no electrónicas).
//
// Una factura simple es un documento INTERNO: no se emite a la DGII, no lleva
// e-NCF ni NCF fiscal y no entra en el reporte 607. El backend genera el número
// (`0001-230826`) y calcula subtotal e ITBIS de cada línea a partir de
// `indicador_facturacion`, así que el formulario solo manda lo que el usuario
// escribe. Ver src/Controllers/facturaSimpleController.php en la API.
import { getJson, getList, postJson, request, qs } from './http'
import type {
  DocBase64,
  FacturaSimple,
  FacturaSimpleInput,
  FacturaSimpleRow,
  ListResult,
} from './types'

export interface FacturaSimpleListParams {
  page?: number
  pageSize?: number
  query?: string
}

export function listFacturasSimples(
  params: FacturaSimpleListParams = {},
): Promise<ListResult<FacturaSimpleRow>> {
  return getList<FacturaSimpleRow>(`/api/facturas-simples${qs({
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
  })}`)
}

export function getFacturaSimple(id: number): Promise<FacturaSimple> {
  return getJson<FacturaSimple>(`/api/facturas-simples/${id}`)
}

export function createFacturaSimple(input: FacturaSimpleInput): Promise<FacturaSimple> {
  return postJson<FacturaSimple>('/api/facturas-simples', input)
}

export function updateFacturaSimple(
  id: number,
  input: Partial<FacturaSimpleInput>,
): Promise<FacturaSimple> {
  return request<FacturaSimple>(`/api/facturas-simples/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteFacturaSimple(id: number): Promise<unknown> {
  return request(`/api/facturas-simples/${id}`, { method: 'DELETE' })
}

/** PDF de una factura ya guardada. */
export function getFacturaSimplePdf(id: number): Promise<DocBase64> {
  return getJson<DocBase64>(`/api/facturas-simples/${id}/pdf`)
}

/** PDF previo, sin guardar nada. */
export function previewFacturaSimple(input: FacturaSimpleInput): Promise<DocBase64> {
  return postJson<DocBase64>('/api/facturas-simples/preview', input)
}

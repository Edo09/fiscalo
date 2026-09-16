// Servicio: facturas simples (no electrónicas).
//
// Una factura simple es un documento INTERNO: no se emite a la DGII, no lleva
// e-NCF ni NCF fiscal y no entra en el reporte 607. Al no ser un comprobante
// fiscal tampoco lleva ITBIS: sus líneas no tienen tasa ni impuesto, y el total
// es la suma de los subtotales. El backend genera el número (`0001-230826`) y
// calcula el subtotal de cada línea, así que el formulario solo manda lo que el
// usuario escribe. Ver src/Controllers/facturaSimpleController.php en la API.
import { getJson, getList, postJson, request, qs } from './http'
import { parametroFormato } from './impresion'
import type {
  DocBase64,
  FacturaSimple,
  FormatoImpresion,
  FacturaSimpleInput,
  FacturaSimpleRow,
  ListResult,
  ReciboDatos,
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

/** PDF de una factura ya guardada, en hoja carta o en tirilla POS (ancho de este equipo). */
export function getFacturaSimplePdf(id: number, formato: FormatoImpresion = 'carta'): Promise<DocBase64> {
  return getJson<DocBase64>(`/api/facturas-simples/${id}/pdf${qs({ formato: parametroFormato(formato) })}`)
}

/** Recibo de tirilla de una factura guardada, como datos para imprimirlo como página web. */
export function getReciboFacturaSimple(id: number): Promise<ReciboDatos> {
  return getJson<ReciboDatos>(`/api/facturas-simples/${id}/pdf${qs({ format: 'datos', formato: parametroFormato('pos') })}`)
}

/** Recibo de tirilla de lo que hay en pantalla, sin guardar, como datos. */
export function previewReciboFacturaSimple(input: FacturaSimpleInput): Promise<ReciboDatos> {
  return postJson<ReciboDatos>('/api/facturas-simples/preview', { ...input, formato: parametroFormato('pos'), format: 'datos' })
}

/** PDF previo, sin guardar nada. */
export function previewFacturaSimple(
  input: FacturaSimpleInput,
  formato: FormatoImpresion = 'carta',
): Promise<DocBase64> {
  const f = parametroFormato(formato)
  return postJson<DocBase64>('/api/facturas-simples/preview', { ...input, ...(f ? { formato: f } : {}) })
}

// Servicio: facturas simples (no electrónicas).
//
// Una factura simple es un documento INTERNO: no se emite a la DGII, no lleva
// e-NCF ni NCF fiscal y no entra en el reporte 607. Al no ser un comprobante
// fiscal tampoco lleva ITBIS: sus líneas no tienen tasa ni impuesto, y el total
// es la suma de los subtotales. El backend genera el número (`0001-230826`) y
// calcula el subtotal de cada línea, así que el formulario solo manda lo que el
// usuario escribe. Ver src/Controllers/facturaSimpleController.php en la API.
import { ApiError } from './errores'
import { getJson, getList, postJson, request, qs } from './http'
import { parametroFormato } from './impresion'
import type {
  DocBase64,
  FacturaSimple,
  FormatoImpresion,
  FacturaSimpleInput,
  FacturaSimpleRow,
  FacturaSimpleStats,
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

/**
 * Cuántas facturas simples hay y cuánto suman, por mes y por día (dashboard).
 *
 * Se valida la forma: un backend anterior a este endpoint no da 404, trata
 * "stats" como el listado y responde 200 con un arreglo de facturas. Sin la
 * validación, el dashboard leería `por_mes` de ese arreglo y se caería entero.
 */
export async function getFacturaSimpleStats(): Promise<FacturaSimpleStats> {
  const d = await getJson<unknown>('/api/facturas-simples/stats')
  const o = d as Partial<FacturaSimpleStats> | null
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.por_mes) || !Array.isArray(o.por_dia)) {
    throw new ApiError('Las estadísticas de facturas simples todavía no están disponibles.', 404, {
      original: 'GET /api/facturas-simples/stats no devolvió por_mes/por_dia (backend anterior al endpoint)',
    })
  }
  return o as FacturaSimpleStats
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

/**
 * Tirilla de lo que hay en pantalla, sin guardar, como datos. Solo para verla
 * DENTRO de la app con el sello de vista previa (ver VistaPreviaRecibo): una
 * tirilla sin guardar que se pueda imprimir limpia parece una venta y no lo es.
 */
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

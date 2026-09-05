// Servicio: inventario — ajustes y libro de movimientos (/api/inventario).
//
// Un ajuste NO se edita ni se borra: se anula creando el ajuste inverso, y los
// dos quedan en el historial. Por eso aquí no hay update ni delete.
import { getJson, getList, request, qs } from './http'
import type { AjusteRow, Ajuste, MovimientoRow, CrearAjusteInput, ListParams, ListResult } from './types'

export function listAjustes(
  params: ListParams & { motivo?: string; desde?: string; hasta?: string } = {},
): Promise<ListResult<AjusteRow>> {
  const query = qs({
    page: params.page,
    pageSize: params.pageSize,
    motivo: params.motivo,
    desde: params.desde,
    hasta: params.hasta,
  })
  return getList<AjusteRow>(`/api/inventario/ajustes${query}`)
}

/** Detalle con sus líneas (cada línea es un movimiento del libro). */
export function getAjuste(id: number | string): Promise<Ajuste> {
  return getJson<Ajuste>(`/api/inventario/ajustes/${id}`)
}

export function crearAjuste(input: CrearAjusteInput): Promise<Ajuste> {
  return request<Ajuste>('/api/inventario/ajustes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Anula creando el ajuste inverso. Devuelve el ajuste de anulación. */
export function anularAjuste(id: number | string, nota?: string): Promise<Ajuste> {
  return request<Ajuste>(`/api/inventario/ajustes/${id}/anular`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nota }),
  })
}

/** Kardex: todos los movimientos de un producto, del más reciente al más viejo. */
export function listMovimientos(
  productId: number | string,
  params: ListParams = {},
): Promise<ListResult<MovimientoRow>> {
  const query = qs({ product_id: productId, page: params.page, pageSize: params.pageSize })
  return getList<MovimientoRow>(`/api/inventario/movimientos${query}`)
}

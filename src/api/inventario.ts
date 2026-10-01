// Servicio: inventario — ajustes y libro de movimientos (/api/inventario).
//
// Un ajuste NO se edita ni se borra: se anula creando el ajuste inverso, y los
// dos quedan en el historial. Por eso aquí no hay update ni delete.
import { getEnvelope, getJson, getList, request, qs } from './http'
import type {
  AjusteRow, Ajuste, MovimientoRow, CrearAjusteInput, ListParams, ListResult,
  ValorInventarioParams, ValorInventarioRow, ValorInventarioTotales,
} from './types'
import { aNumero } from '@/lib/format'

/** Lo que manda la API: los campos numéricos pueden venir como texto DECIMAL. */
type ConTexto<T, K extends keyof T> = Omit<T, K> & { [P in K]: number | string }
type ValorInventarioRowApi = ConTexto<
  ValorInventarioRow, 'entradas' | 'salidas' | 'existencia' | 'costo_promedio' | 'valor_inventario'
>
type ValorInventarioTotalesApi = ConTexto<ValorInventarioTotales, 'productos' | 'existencia' | 'valor'>

/**
 * Valor del inventario producto por producto a una fecha de corte.
 *
 * Devuelve además los totales del inventario COMPLETO (no de la página): el
 * backend calcula sobre todo lo filtrado y pagina después, porque el número que
 * importa en un reporte de valorización es el total, no el de lo que se ve.
 */
export async function getValorInventario(
  params: ValorInventarioParams = {},
): Promise<{ items: ValorInventarioRow[]; total: number; totales: ValorInventarioTotales; hasta: string }> {
  const query = qs({
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
    warehouse_id: params.warehouse_id,
    category_id: params.category_id,
    estado: params.estado,
    hasta: params.hasta,
  })
  const res = await getEnvelope<{
    data: ValorInventarioRowApi[]
    totales: ValorInventarioTotalesApi
    hasta: string
    pagination: { total: number }
  }>(`/api/inventario/valor${query}`)
  // Existencias con decimales (kg, metro): si llegaran como texto ("12.500"),
  // `r.entradas > 0` y la suma de la vista trabajarían sobre texto. Se
  // convierten aquí, una vez, y las pantallas reciben siempre números.
  const items = res.data.map<ValorInventarioRow>((r) => ({
    ...r,
    entradas: aNumero(r.entradas),
    salidas: aNumero(r.salidas),
    existencia: aNumero(r.existencia),
    costo_promedio: aNumero(r.costo_promedio),
    valor_inventario: aNumero(r.valor_inventario),
  }))
  const totales: ValorInventarioTotales = {
    productos: aNumero(res.totales.productos),
    existencia: aNumero(res.totales.existencia),
    valor: aNumero(res.totales.valor),
  }
  return { items, total: res.pagination.total, totales, hasta: res.hasta }
}

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

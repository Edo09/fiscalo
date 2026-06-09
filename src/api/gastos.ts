// Servicio: gastos (módulo de egresos / e-CF de compras).
import { getJson, postJson, getBlob, getList, qs } from './http'
import type {
  CreateGastoInput,
  GastoListParams,
  GastoRow,
  GastoStatsData,
  ListResult,
} from './types'

export function listGastos(params: GastoListParams = {}): Promise<ListResult<GastoRow>> {
  const query = qs({
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
    categoria: params.categoria,
  })
  return getList<GastoRow>(`/api/gastos${query}`)
}

export function getGasto(id: number): Promise<GastoRow> {
  return getJson<GastoRow>(`/api/gastos${qs({ id })}`)
}

export function getGastoStats(): Promise<GastoStatsData> {
  return getJson<GastoStatsData>('/api/gastos/stats')
}

/** Consulta el estado del e-CF en DGII (solo gastos auto-emitidos). */
export function getGastoEstado(id: number): Promise<GastoRow> {
  return getJson<GastoRow>(`/api/gastos/${id}/estado`)
}

/** XML firmado del e-CF de un gasto auto-emitido. */
export function getGastoXml(id: number): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/gastos/${id}/xml`)
}

export function createGasto(input: CreateGastoInput): Promise<GastoRow> {
  return postJson<GastoRow>('/api/gastos', input)
}

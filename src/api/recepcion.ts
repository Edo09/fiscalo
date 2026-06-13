// Servicio: e-CF recibidos de otros emisores + aprobación comercial (ACECF).
// Ver docs/aprobacion-comercial-recibidos.md.
import { getList, postJson, qs } from './http'
import type {
  AprobacionComercialInput,
  AprobacionComercialResponse,
  EcfRecibidoListParams,
  EcfRecibidoRow,
  ListResult,
} from './types'

/** Lista paginada de los e-CF que otros emisores te enviaron (GET /api/ecf/recepcion). */
export function listEcfRecibidos(params: EcfRecibidoListParams = {}): Promise<ListResult<EcfRecibidoRow>> {
  return getList<EcfRecibidoRow>(`/api/ecf/recepcion${qs({ page: params.page, pageSize: params.pageSize })}`)
}

/** Aprueba o rechaza un e-CF recibido: arma y firma el ACECF y lo envía a la DGII. */
export function aprobarEcfRecibido(input: AprobacionComercialInput): Promise<AprobacionComercialResponse> {
  return postJson<AprobacionComercialResponse>('/api/aprobaciones-comerciales', input)
}

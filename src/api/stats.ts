// Servicio: estadísticas y avisos e-CF.
import { getJson } from './http'
import type { AvisosEcf, StatsData } from './types'

export function getStats(): Promise<StatsData> {
  return getJson<StatsData>('/api/facturas/stats')
}

/** Avisos para el administrador (certificado, secuencias, ventas sin rango): solo lectura. */
export function getAvisosEcf(): Promise<AvisosEcf> {
  return getJson<AvisosEcf>('/api/facturas/avisos')
}

// Servicio: estadísticas e-CF.
import { getJson } from './http'
import type { StatsData } from './types'

export function getStats(): Promise<StatsData> {
  return getJson<StatsData>('/api/facturas/stats')
}

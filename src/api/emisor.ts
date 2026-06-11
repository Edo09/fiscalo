// Servicio: datos del emisor (GET /api/emisor, solo lectura).
import { getJson } from './http'
import type { EmisorData } from './types'

export function getEmisor(): Promise<EmisorData> {
  return getJson<EmisorData>('/api/emisor')
}

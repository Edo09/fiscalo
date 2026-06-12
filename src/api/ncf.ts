// Servicio: rangos e-NCF autorizados por DGII (/api/ncf/rangos).
import { getJson, postJson, qs } from './http'
import type { NcfRango, RegisterRangoInput } from './types'

/** Rangos del ambiente activo (filtro opcional por tipo, ej. E31). */
export function listNcfRangos(type?: string): Promise<NcfRango[]> {
  return getJson<NcfRango[]>(`/api/ncf/rangos${qs({ type })}`)
}

/** Registra un rango aprobado por DGII (Número Desde/Hasta + vencimiento). */
export function registerNcfRango(input: RegisterRangoInput): Promise<NcfRango> {
  return postJson<NcfRango>('/api/ncf/rangos', input)
}

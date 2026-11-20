// Servicio: rangos e-NCF autorizados por DGII (/api/ncf/rangos).
import { getJson, postJson, putJson, qs } from './http'
import type { NcfRango, RegisterRangoInput, UpdateRangoInput } from './types'

/** Rangos del ambiente activo (filtro opcional por tipo, ej. E31). */
export function listNcfRangos(type?: string): Promise<NcfRango[]> {
  return getJson<NcfRango[]>(`/api/ncf/rangos${qs({ type })}`)
}

/** Registra un rango aprobado por DGII (Número Desde/Hasta + vencimiento). */
export function registerNcfRango(input: RegisterRangoInput): Promise<NcfRango> {
  return postJson<NcfRango>('/api/ncf/rangos', input)
}

/** Corrige un rango ya registrado: solo lo que cambió (fecha, autorización, Hasta y, sin usados, Desde). */
export function updateNcfRango(id: number, input: UpdateRangoInput): Promise<NcfRango> {
  return putJson<NcfRango>(`/api/ncf/rangos/${id}`, input)
}

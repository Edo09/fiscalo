// Servicio: consulta de RNC / cédula (GET /api/rnc/consulta).
// El backend consulta un servicio externo de terceros; ver RncConsultaField.
import { getJson, qs } from './http'

/** Contribuyente tal como lo normaliza el backend. */
export interface ConsultaRnc {
  /** Solo dígitos: 9 = RNC, 11 = cédula. */
  rnc: string
  tipo: 'RNC' | 'CEDULA'
  razon_social: string
  nombre_comercial: string
  /** ACTIVO, SUSPENDIDO, DADO DE BAJA… tal como lo reporta la DGII. */
  estado: string
  facturador_electronico: boolean
  actividad_economica: string
  regimen_pagos: string
}

/**
 * Consulta un RNC o cédula. Lanza ApiError con status 404 si no está inscrito,
 * 422 si no tiene 9 u 11 dígitos y 502 si el servicio externo no respondió.
 */
export function consultarRnc(rnc: string): Promise<ConsultaRnc> {
  return getJson<ConsultaRnc>(`/api/rnc/consulta${qs({ rnc })}`)
}

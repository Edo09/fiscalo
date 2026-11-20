// Servicio: datos de la empresa (el emisor). GET /api/emisor lo puede leer cualquier rol;
// PUT /api/emisor lo cambia el administrador: todo menos el RNC y la razón social.
// Reglas, permisos y códigos de respuesta: api-gratex docs/modules/emisor.md.
import { getJson, request } from './http'
import type { EmisorData, EmisorInput } from './types'

export function getEmisor(): Promise<EmisorData> {
  return getJson<EmisorData>('/api/emisor')
}

/**
 * Cambia datos de la empresa. El PUT es parcial: solo viaja lo que cambió y el
 * servidor conserva el resto. Un dato opcional en blanco ('') lo deja vacío.
 * Responde con los datos ya guardados, con la misma forma que el GET.
 */
export function updateEmisor(input: EmisorInput): Promise<EmisorData> {
  return request<EmisorData>('/api/emisor', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

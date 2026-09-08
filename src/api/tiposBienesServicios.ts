// Servicio: catálogo DGII "Tipo de Bienes y Servicios Comprados"
// (/api/tipos-bienes-servicios).
//
// El `codigo` es el que se declara en el campo 3 del Formato 606, y viaja como
// CADENA de 2 dígitos ('01'..'11') de punta a punta. Nunca lo conviertas a
// número: '01' se volvería '1' y la DGII rechaza el archivo completo.
import { getJson } from './http'
import type { TipoBienesServicios } from './types'

export function listTiposBienesServicios(): Promise<TipoBienesServicios[]> {
  return getJson<TipoBienesServicios[]>('/api/tipos-bienes-servicios')
}

// Servicio: catálogo DGII de provincias y municipios (/api/provincias-municipios).
// `codigo` es lo que se persiste (emisor/cliente); descripcion solo para mostrar.
import { getJson } from './http'
import type { Ubicacion } from './types'

export function listUbicaciones(): Promise<Ubicacion[]> {
  return getJson<Ubicacion[]>('/api/provincias-municipios')
}

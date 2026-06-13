// Servicio: catálogo DGII de unidades de medida (/api/unidades-medida).
// `id` = código numérico DGII (43 = Unidad); codigo/descripcion solo para mostrar.
import { getJson } from './http'
import type { UnidadMedida } from './types'

export function listUnidadesMedida(): Promise<UnidadMedida[]> {
  return getJson<UnidadMedida[]>('/api/unidades-medida')
}

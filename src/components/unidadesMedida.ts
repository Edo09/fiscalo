// Catálogo DGII de unidades de medida (/api/unidades-medida), compartido por el
// selector y por los formularios que validan sus líneas antes de enviar.
import { listUnidadesMedida } from '@/api'
import type { UnidadMedida } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

/** Misma clave de caché en toda la app: el catálogo se pide una sola vez. */
export function useUnidadesMedida(): UnidadMedida[] {
  const { data } = useApiQuery(['unidades-medida'], () => listUnidadesMedida())
  return data ?? []
}

/**
 * ¿El código está en el catálogo? Un producto migrado puede traer una unidad
 * que la DGII no reconoce; sin revisarla, el comprobante fallaba al emitir con
 * un mensaje técnico. Mientras el catálogo no ha llegado no se juzga (true).
 */
export function unidadValida(id: number, catalogo: UnidadMedida[]): boolean {
  return catalogo.length === 0 || catalogo.some((u) => u.id === id)
}

export const MSG_UNIDAD = 'Elige la unidad de medida de esta línea.'

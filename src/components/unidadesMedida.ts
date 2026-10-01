// Catálogo DGII de unidades de medida (/api/unidades-medida), compartido por el
// selector y por los formularios que validan sus líneas antes de enviar.
import { listUnidadesMedida } from '@/api'
import type { UnidadMedida } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { decimalesDe } from '@/lib/format'

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

/**
 * ¿Una cantidad en esta unidad puede llevar decimales? Mismo criterio que el
 * backend (unidadMedidaModel::permiteDecimales): si no se sabe (catálogo sin
 * cargar, unidad desconocida o marca ausente) no se bloquea.
 */
export function admiteDecimales(id: number | string | null | undefined, catalogo: UnidadMedida[]): boolean {
  const u = catalogo.find((x) => x.id === Number(id))
  return !u || u.permite_decimales !== false
}

/**
 * Qué está mal en una cantidad, en palabras del usuario, o null si está bien.
 * `maxDecimales`: 2 en lo que va a la DGII (e-CF, cotización, compra auto-emitida),
 * 3 en la factura simple y el inventario.
 */
export function problemaCantidad(
  cantidad: number,
  opts: { unidadId?: number | string | null; catalogo: UnidadMedida[]; maxDecimales: 2 | 3 },
): string | null {
  // Se juzga lo que de verdad se va a guardar: 0.0001 con 2 decimales queda
  // en 0, y un 0 no puede llegar al comprobante.
  if (!(cantidad > 0) || !(Math.round(cantidad * 10 ** opts.maxDecimales) > 0)) return 'La cantidad debe ser mayor que 0.'
  const dec = decimalesDe(cantidad)
  if (dec === 0) return null
  if (!admiteDecimales(opts.unidadId, opts.catalogo)) {
    const u = opts.catalogo.find((x) => x.id === Number(opts.unidadId))
    return `La unidad «${u?.descripcion ?? 'Unidad'}» no admite fracciones: usa una cantidad entera o cambia la unidad.`
  }
  if (dec > opts.maxDecimales) return `La cantidad admite hasta ${opts.maxDecimales} decimales.`
  return null
}


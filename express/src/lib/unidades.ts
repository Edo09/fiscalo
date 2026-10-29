// Las unidades de medida de la DGII (/api/unidades-medida) y lo que dicen de una cantidad. `admiteDecimales` y `problemaCantidad` son copia de
// las de la app completa (src/components/unidadesMedida.ts: no se importa de allí porque ese archivo trae el barril `@/api`), y
// tests/unidades.test.ts compara las dos copias para que sigan diciendo lo mismo.
//
// UNA diferencia, a propósito: sin catálogo (aún no llegó, o la carga falló, algo común con mala señal) la app completa deja pasar cualquier
// cantidad, porque el servidor la revisa al emitir; en Express, cuyo teclado de cantidades se arma con esta respuesta, eso dejaría teclear
// «1.5» en una unidad que no admite fracciones y devolvería el error recién con la factura armada. Por eso, mientras el catálogo está vacío
// solo se admiten cantidades enteras (cerrado), y la unidad por defecto es la 43, «Unidad».
import { listUnidadesMedida } from '@/api/unidadesMedida'
import type { UnidadMedida } from '@/api/types'
import { useApiQuery } from '@/hooks/useApiQuery'
import { decimalesDe } from '@/lib/format'

/** El código DGII de «Unidad» (43), la unidad de una línea mientras nadie elige otra. En texto, como viaja en el carrito. */
export const UNIDAD_POR_DEFECTO = '43'

/** El catálogo mientras no ha llegado. Es siempre el mismo arreglo, para que no cambie entre renders; quien lo recibe no lo modifica. */
const SIN_CATALOGO: UnidadMedida[] = []

/**
 * ¿Una cantidad en esta unidad puede llevar decimales? Con el catálogo cargado, el mismo criterio de la app completa y del backend
 * (unidadMedidaModel::permiteDecimales): solo la bloquea una unidad marcada `permite_decimales: false`, y si no se sabe (unidad que el
 * catálogo no tiene, marca ausente o nula) no se bloquea. Con el catálogo vacío NO: solo enteros.
 */
export function admiteDecimales(id: number | string | null | undefined, catalogo: UnidadMedida[]): boolean {
  if (catalogo.length === 0) return false
  const u = catalogo.find((x) => x.id === Number(id))
  return !u || u.permite_decimales !== false
}

/**
 * Qué está mal en una cantidad, en palabras del usuario, o null si está bien.
 * `maxDecimales`: 2 en lo que va a la DGII (e-CF, cotización, compra auto-emitida), 3 en la factura simple y el inventario.
 */
export function problemaCantidad(
  cantidad: number,
  opts: { unidadId?: number | string | null; catalogo: UnidadMedida[]; maxDecimales: 2 | 3 },
): string | null {
  // Se juzga lo que de verdad se va a guardar: 0.0001 con 2 decimales queda en 0, y un 0 no puede llegar al comprobante.
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

/**
 * El catálogo DGII de unidades de medida. Su clave, `['unidades-medida']`, es la de la app completa y no es un capricho: config/cache.ts la
 * trata como catálogo fijo (no se vuelve a pedir en toda la sesión), y todo lo de Express que la use comparte una sola consulta. `cargado`
 * es false mientras no hay catálogo, y entonces `catalogo` es una lista vacía que `admiteDecimales` trata como «solo enteros».
 */
export function useUnidades(): { catalogo: UnidadMedida[]; cargado: boolean } {
  const { data } = useApiQuery(['unidades-medida'], listUnidadesMedida)
  return { catalogo: data ?? SIN_CATALOGO, cargado: data !== null }
}

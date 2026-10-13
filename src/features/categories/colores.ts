// Color de una categoría: el que eligió el dueño en Categorías (categories.color,
// migración 034) o, sin elegir, el calculado de su nombre. Mismo criterio en
// app.* y en el POS (chips y tarjetas del catálogo).
import { colorFor } from '@/lib/format'

/**
 * Colores sugeridos en el selector: distintos entre sí y legibles como punto o
 * fondo de las iniciales en el POS, en tema claro y oscuro. Cualquier otro HEX
 * se puede escribir a mano.
 */
export const COLORES_SUGERIDOS = [
  '#2A6FDB', '#1F8A5B', '#C47F12', '#8A4FCF', '#D14343', '#0E8A8A', '#C2487F', '#5566C9',
  '#E8590C', '#5C940D', '#862E9C', '#A61E4D', '#1864AB', '#0B7285', '#F08C00', '#495057',
]

/** El color con que se pinta la categoría. */
export function colorDeCategoria(nombre: string | null | undefined, color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : colorFor(nombre || '')
}

/**
 * Lo escrito en el campo HEX: '#RRGGBB' en mayúsculas, null si está vacío
 * (automático) o 'invalido'. Acepta sin '#'.
 */
export function leerHex(texto: string): string | null | 'invalido' {
  const t = texto.trim()
  if (t === '') return null
  const m = /^#?([0-9a-f]{6})$/i.exec(t)
  return m ? `#${m[1].toUpperCase()}` : 'invalido'
}

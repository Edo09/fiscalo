// Qué facturas consulta «Verificar» (anexo 6.2). En Pendientes, el botón de la cabecera le pregunta a la DGII (`/estado`), de a una, por las primeras tres facturas ENVIADO o
// EN_PROCESO de las que se ven, y recarga: la lista nunca pide el estado por fila. Son exactamente esos dos estados: las otras del chip «En proceso» (sus gemelas RFCE_) no entran,
// porque el anexo nombra solo estos dos. Es una regla pura y está aparte de Facturas.tsx para poder probarla (tests/verificar.test.ts).
import type { FacturaVista } from '~/lib/filas'

/** Cuántas facturas consulta «Verificar» de una vez (anexo 6.2). */
export const MAX_VERIFICAR = 3

/** Los estados DGII que «Verificar» consulta desde la lista, tal como los manda el API (`FacturaVista.estado` no los cambia). */
const VERIFICABLES: ReadonlySet<string> = new Set(['ENVIADO', 'EN_PROCESO'])

/** Las primeras `MAX_VERIFICAR` filas ENVIADO o EN_PROCESO, en el orden de la lista. Un arreglo nuevo: `filas` no se toca. */
export function filasPorVerificar(filas: readonly FacturaVista[]): FacturaVista[] {
  return filas.filter((f) => VERIFICABLES.has(f.estado)).slice(0, MAX_VERIFICAR)
}

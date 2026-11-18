// Listas de precio 2–4 (products.precio_2..4, migración 019 de api-gratex): qué listas ofrece un
// producto, cuándo hay que preguntar cuál usar y cómo se leen y se escriben en el formulario de
// producto. Módulo puro y sin imports de valor: `node scripts/test-listas-precio.ts` lo carga sin
// compilar.

export type NumeroLista = 1 | 2 | 3 | 4
/** Precios de las listas 2, 3 y 4, en ese orden (null = no aplica). */
export type OtrosPrecios = readonly [number | null, number | null, number | null]
export interface OpcionPrecio { lista: NumeroLista; precio: number }
export type EleccionPrecio = { tipo: 'directo'; precio: number } | { tipo: 'elegir'; opciones: OpcionPrecio[] }
type ConPrecios = { precio: number; otrosPrecios: OtrosPrecios }

export const SIN_OTROS_PRECIOS: OtrosPrecios = [null, null, null]

/**
 * Un precio de la API (DECIMAL como texto) o del formulario → número finito mayor que 0.
 * Vacío, 0, NULL, texto o negativo → null: "esta lista no aplica" y nunca se ofrece.
 */
export function precioOpcional(v: unknown): number | null {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Las listas 2–4 de una fila de /api/products. Sin las columnas (API viejo): ninguna. */
export function otrosPreciosDeFila(r: { precio_2?: unknown; precio_3?: unknown; precio_4?: unknown }): OtrosPrecios {
  return [precioOpcional(r.precio_2), precioOpcional(r.precio_3), precioOpcional(r.precio_4)]
}

/** Las listas que el producto ofrece (precio mayor que 0), en orden 1..4. */
export function opcionesDePrecio(p: ConPrecios): OpcionPrecio[] {
  const listas: [NumeroLista, number | null][] = [
    [1, precioOpcional(p.precio)],
    [2, precioOpcional(p.otrosPrecios[0])],
    [3, precioOpcional(p.otrosPrecios[1])],
    [4, precioOpcional(p.otrosPrecios[2])],
  ]
  return listas.flatMap(([lista, precio]) => (precio === null ? [] : [{ lista, precio }]))
}

/**
 * Qué hacer al agregar el producto a un documento: con 0 o 1 lista ofrecida se agrega directo
 * (al precio de esa lista, aunque no sea la 1; sin ninguna, a `p.precio` como siempre); con 2 o
 * más hay que preguntar.
 */
export function eleccionDePrecio(p: ConPrecios): EleccionPrecio {
  const opciones = opcionesDePrecio(p)
  if (opciones.length >= 2) return { tipo: 'elegir', opciones }
  return { tipo: 'directo', precio: opciones[0]?.precio ?? p.precio }
}

/** "3 precios" cuando hay que elegir (2 o más listas); si no, null. */
export function etiquetaPrecios(p: ConPrecios): string | null {
  const n = opcionesDePrecio(p).length
  return n >= 2 ? `${n} precios` : null
}

/** Los textos de los tres campos del formulario de producto a partir de lo guardado. */
export function textosDeOtrosPrecios(o: OtrosPrecios): [string, string, string] {
  return [o[0], o[1], o[2]].map((n) => (n === null ? '' : String(n))) as [string, string, string]
}

/** Lo que está mal en un precio extra tecleado, o null. Vacío y 0 valen: significan "no aplica". */
export function problemaPrecioExtra(texto: string, lista: 2 | 3 | 4): string | null {
  const t = texto.trim()
  return t !== '' && Number(t) < 0 ? `El precio ${lista} no puede ser negativo.` : null
}

/** Lo que viaja al API: vacío, 0 o texto → null; un valor → el número. */
export function payloadOtrosPrecios(textos: readonly [string, string, string]): {
  precio_2: number | null
  precio_3: number | null
  precio_4: number | null
} {
  return { precio_2: precioOpcional(textos[0]), precio_3: precioOpcional(textos[1]), precio_4: precioOpcional(textos[2]) }
}

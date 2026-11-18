// Listas de precio 2–4 (products.precio_2..4, migración 019 de api-gratex): qué listas ofrece un
// producto, cuándo hay que preguntar cuál usar y cómo se leen y se escriben en el formulario de
// producto; cómo se lee la lista por defecto de un cliente (clients.lista_precio) y qué cliente
// rige al editar un documento guardado. Módulo puro y sin imports de valor:
// `node scripts/test-listas-precio.ts` lo carga sin compilar.

export type NumeroLista = 1 | 2 | 3 | 4
/** Precios de las listas 2, 3 y 4, en ese orden (null = no aplica). */
export type OtrosPrecios = readonly [number | null, number | null, number | null]
export interface OpcionPrecio { lista: NumeroLista; precio: number }
export type EleccionPrecio =
  // `lista` y `delCliente` solo vienen cuando se usó la lista por defecto del cliente.
  | { tipo: 'directo'; precio: number; lista?: NumeroLista; delCliente?: true }
  | { tipo: 'elegir'; opciones: OpcionPrecio[] }
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
 * Qué hacer al agregar el producto a un documento. Si el cliente tiene una lista por defecto
 * (`listaCliente`) y el producto la ofrece, se agrega directo a ese precio, aunque ofrezca más
 * listas. Si no la ofrece (o el cliente no tiene), manda la regla de siempre: con 0 o 1 lista
 * ofrecida se agrega directo (al precio de esa lista, aunque no sea la 1; sin ninguna, a `p.precio`
 * como siempre); con 2 o más hay que preguntar, nunca cae en silencio al precio 1.
 */
export function eleccionDePrecio(p: ConPrecios, listaCliente?: NumeroLista | null): EleccionPrecio {
  const opciones = opcionesDePrecio(p)
  const opcionCliente = opciones.find((o) => o.lista === listaCliente)
  if (opcionCliente) return { tipo: 'directo', precio: opcionCliente.precio, lista: opcionCliente.lista, delCliente: true }
  if (opciones.length >= 2) return { tipo: 'elegir', opciones }
  return { tipo: 'directo', precio: opciones[0]?.precio ?? p.precio }
}

/** "3 precios" cuando hay que elegir (2 o más listas); si no, null. */
export function etiquetaPrecios(p: ConPrecios): string | null {
  const n = opcionesDePrecio(p).length
  return n >= 2 ? `${n} precios` : null
}

/**
 * Lo que dice la fila de un producto en el selector de un documento: el precio que usaría un toque
 * sin más y su etiqueta. Con la lista del cliente, ese precio y "Precio 2 · cliente". Si se agrega
 * directo por la regla de siempre, el precio de esa decisión y ninguna etiqueta (un producto con la
 * lista 1 en 0 y una sola otra lista muestra el precio de esa, no "0.00"). Si hay que preguntar, el
 * precio 1 y "3 precios".
 */
export function precioParaMostrar(
  p: ConPrecios, listaCliente?: NumeroLista | null,
): { precio: number; etiqueta: string | null } {
  const e = eleccionDePrecio(p, listaCliente)
  if (e.tipo === 'elegir') return { precio: p.precio, etiqueta: etiquetaPrecios(p) }
  return { precio: e.precio, etiqueta: e.delCliente ? `Precio ${e.lista} · cliente` : null }
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

/**
 * La lista de precio por defecto de un cliente (clients.lista_precio): un entero de 1 a 4, que
 * MySQL también manda como texto ("2"). NULL, vacío, 0, 5, texto, decimal o booleano → null: el
 * cliente no tiene lista y se pregunta cada vez.
 */
export function listaDeCliente(v: unknown): NumeroLista | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null
}

/**
 * El cliente que rige un documento mientras se arma, y con él su lista de precio para los productos
 * que se agreguen: el elegido en el buscador; si no hay ninguno y se edita un documento guardado,
 * el cliente de ese documento (`guardado`, su ficha), mientras no se haya escrito un nombre libre
 * en su lugar; si no, ninguno. Genérica en el tipo de cliente: este módulo no importa nada.
 */
export function clienteVigente<C>(elegido: C | null, guardado: C | null, editando: boolean, nombreLibre: string): C | null {
  if (elegido) return elegido
  return editando && nombreLibre.trim() === '' ? guardado : null
}

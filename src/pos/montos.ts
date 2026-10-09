// Cuentas del carrito del POS (api-gratex docs/specs/pos.md V1, V2, C3 y C4).
//
// El dinero va SIEMPRE en centavos enteros: nada de sumar floats. Las reglas son
// las de la emisión con IndicadorMontoGravado = 1 (F4), para que lo que ve el
// cajero sea, al centavo, lo que dice el e-CF:
//   - importe de la línea = round(precio final × cantidad, 2)
//   - total               = suma de las líneas
//   - ITBIS incluido      = por tasa: base = round(suma / (1 + tasa), 2) e
//                           ITBIS = suma − base (así lo calcula la DGII)
//
// Sin imports a propósito: scripts/test-pos-montos.ts lo prueba con Node solo.

/** Cantidad en centésimas: el XSD admite 2 decimales en CantidadItem. */
export function aCentesimas(cantidad: number): number {
  return Math.round(cantidad * 100)
}

/** Importe de una línea en centavos: round(precio × cantidad, 2), mitad hacia arriba. */
export function importeLinea(precioCentavos: number, cantidad: number): number {
  return Math.floor((precioCentavos * aCentesimas(cantidad) + 50) / 100)
}

/** División entera redondeando la mitad hacia arriba (a y b positivos). */
function divRedondeo(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b))
}

/**
 * ITBIS incluido en un grupo de líneas, en centavos (informativo, V2). Se agrupa
 * por tasa porque la DGII saca la base de cada tasa de la SUMA de sus líneas,
 * no línea por línea.
 */
export function itbisIncluido(lineas: { importe: number; tasa: number }[]): number {
  const porTasa = new Map<number, number>()
  for (const l of lineas) {
    if (l.tasa > 0) porTasa.set(l.tasa, (porTasa.get(l.tasa) ?? 0) + l.importe)
  }
  let itbis = 0
  for (const [tasa, suma] of porTasa) {
    itbis += suma - divRedondeo(suma * 100, 100 + tasa)
  }
  return itbis
}

/** "1,234.50" a partir de centavos. */
export function formatoCentavos(centavos: number): string {
  return new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)
}

/** Texto sin acentos y en minúsculas, para buscar "contiene" (C3). */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * ¿El producto coincide con la búsqueda? Cada palabra tiene que estar en el
 * nombre o en el sku, en cualquier orden: "agua 500" encuentra "Agua 500 ml".
 */
export function coincide(producto: { nombre: string; sku: string | null }, busqueda: string): boolean {
  const palabras = normalizar(busqueda).split(' ').filter(Boolean)
  if (palabras.length === 0) return true
  const texto = normalizar(`${producto.nombre} ${producto.sku ?? ''}`)
  return palabras.every((p) => texto.includes(p))
}

export type Semaforo = 'servicio' | 'agotado' | 'bajo' | 'disponible'

/** Semáforo de existencia (C4). Sin stock_minimo no hay "bajo". */
export function semaforo(stock: number | null, stockMinimo: number | null): Semaforo {
  if (stock === null) return 'servicio'
  if (stock <= 0) return 'agotado'
  if (stockMinimo !== null && stock <= stockMinimo) return 'bajo'
  return 'disponible'
}

/**
 * Cantidad escrita en el teclado del POS → número, o null si no sirve: tiene
 * que ser mayor que 0, con 2 decimales como máximo y entera si la unidad no
 * admite decimales.
 */
export function leerCantidad(texto: string, decimales: boolean): number | null {
  const t = texto.trim()
  const patron = decimales ? /^\d{1,5}(\.\d{1,2})?$/ : /^\d{1,5}$/
  if (!patron.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

/**
 * Iniciales de la tarjeta del producto: "Agua 500 ml" → "A5", "Pan" → "PA".
 * Solo letras y números: "Huevos (unidad)" → "HU", no "H(".
 */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).map((p) => p.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[1][0]).toUpperCase()
}

/** Texto escrito ("1500", "245.5") → centavos, o null si está vacío o no sirve. */
export function montoACentavos(texto: string): number | null {
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(texto)) return null
  return Math.round(Number(texto) * 100)
}

/** Aplica una tecla al texto del monto respetando el formato. */
export function teclearMonto(actual: string, tecla: string): string {
  if (tecla === '⌫') return actual.slice(0, -1)
  if (tecla === 'C') return ''
  if (tecla === '.') return actual.includes('.') ? actual : (actual === '' ? '0.' : actual + '.')
  const [entero, dec] = actual.split('.')
  if (dec !== undefined) return dec.length >= 2 ? actual : actual + tecla
  if (entero.length >= 7) return actual
  return actual === '0' ? tecla : actual + tecla
}

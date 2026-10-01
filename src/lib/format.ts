// Formato de moneda y números para República Dominicana (es-DO).

const currencyFormatter = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const integerFormatter = new Intl.NumberFormat('es-DO', {
  maximumFractionDigits: 0,
})

/** Formatea un número con 2 decimales: 1234.5 -> "1,234.50". */
export const fmt = (n: number): string => currencyFormatter.format(n)

/** Formatea un número sin decimales: 1234.5 -> "1,235". */
export const fmt0 = (n: number): string => integerFormatter.format(n)

// Cantidades y precios unitarios. Desde la migración 025 la API los devuelve
// como texto DECIMAL ("3.000", "84.7500"): sin estos formatos se imprimiría el
// relleno de ceros, y sumarlos con + los concatenaría.
const cantidadFormatter = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})
const precioFormatter = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

/** Número a partir de lo que mande la API (number o texto DECIMAL); NaN/vacío -> 0. */
export const aNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  // `|| 0` también convierte -0 en 0: si no, una cantidad en cero saldría "-0".
  return Number.isFinite(n) ? n || 0 : 0
}

/** Cantidad sin ceros de relleno: 3 -> "3", 1.5 -> "1.5", 0.125 -> "0.125". */
export const fmtCantidad = (v: unknown): string => cantidadFormatter.format(aNumero(v))

/**
 * Precio unitario con 2 decimales, o hasta 4 si los tiene: 100 -> "100.00",
 * 84.7458 -> "84.7458". Así el precio impreso por la cantidad da el valor.
 */
export const fmtPrecio = (v: unknown): string => precioFormatter.format(aNumero(v))

/**
 * Cuántos decimales trae un número (0.125 -> 3). Tolera el ruido binario con
 * una tolerancia RELATIVA al valor: con una fija (1e-7), un precio correcto de
 * 4 decimales desde ~65,536 (139625.5169 × 10⁴ = 1396255168.9999998) contaba
 * como 6 y el formulario rechazaba la factura. Mismo criterio que
 * unidadMedidaModel::decimalesDe en el backend.
 */
export const decimalesDe = (n: number): number => {
  if (!Number.isFinite(n) || n === 0) return 0
  for (let d = 0; d <= 6; d++) {
    if (Math.abs(n - Math.round(n * 10 ** d) / 10 ** d) <= Math.abs(n) * 1e-12) return d
  }
  return 6
}

// Paleta determinista para avatares.
const palette = [
  '#2a6fdb', '#1f8a5b', '#c47f12', '#8a4fcf',
  '#d14343', '#0e8a8a', '#c2487f', '#5566c9',
]

/** Devuelve un color estable de la paleta a partir de un texto. */
export const colorFor = (s: string): string => {
  const sum = s.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return palette[sum % palette.length]
}

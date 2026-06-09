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

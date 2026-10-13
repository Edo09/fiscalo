// Textos de la caja sobre una venta (pantalla de cobro y listas de ventas del
// turno y del día). La pantalla del cajero no muestra nada de la DGII (decisión
// U3 de la spec del POS sobre el write-ahead): ni el estado de la venta ni si se
// envió. Lo vigila scripts/test-pos-sin-dgii.ts.

/**
 * Número de una venta para el cajero: el e-NCF o, si la venta salió como
 * factura simple (sin e-NCF), "Factura <id>".
 */
export function numeroVenta(v: { e_ncf: string | null; factura_id: number }): string {
  return v.e_ncf ? v.e_ncf : `Factura ${v.factura_id}`
}

/** Título de la venta cobrada por tipo de comprobante; una factura simple (tipo null) es solo "Factura". */
export function tituloVenta(tipoEcf: string | null): string {
  if (tipoEcf === '31') return 'Factura de crédito fiscal'
  if (tipoEcf === '32') return 'Factura de consumo'
  return 'Factura'
}

/** "9:41 a. m." de una fecha "2026-10-09 09:41:00". */
export function horaDe(fecha: string): string {
  const m = /[ T](\d{2}):(\d{2})/.exec(fecha)
  if (!m) return fecha
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** "jueves, 9 de octubre" de "2026-10-09". */
export function diaLargo(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })
}

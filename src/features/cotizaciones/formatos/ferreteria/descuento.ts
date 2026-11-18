// Descuento de la cotización de Ferretería: un monto en RD$ que se resta del
// Sub-total ANTES del ITBIS (el impuesto y la retención se calculan sobre lo
// que queda). Lo único que se guarda es ese monto; el porcentaje es solo una
// forma cómoda de escribirlo y de leerlo.
//
// Las cuentas son las que hará FerreteriaFormato::totales del backend
// (api-gratex src/Utils/Cotizacion/FerreteriaFormato.php), con el mismo
// redondeo (Redondeo::r2 = r2 de aquí): si los dos lados no dan igual al
// centavo, el usuario guarda un TOTAL y el PDF imprime otro. Un cambio de regla
// va en los dos lados en el mismo cambio.
//
// Imports de valor SOLO por ruta relativa con .ts (como totales.ts): así
// `node` carga este archivo tal cual para scripts/test-descuento-cotizacion.ts.
import { montosLinea, r2, redondear } from '../../../invoices/montosLinea.ts'

/**
 * El descuento que de verdad se aplica: a centavos, nunca negativo y nunca más
 * que el Sub-total (un descuento no puede dejar el documento en negativo). Lo
 * escrito de más se ve como error al guardar; aquí solo se evita que la pantalla
 * muestre un total absurdo mientras tanto.
 */
export function descuentoAplicable(subtotal: number, descuento: number): number {
  const d = Number.isFinite(descuento) ? r2(descuento) : 0
  return d > 0 ? Math.min(d, subtotal) : 0
}

/**
 * Reparte el descuento entre las líneas en proporción a la base de cada una,
 * al centavo y sin dejar resto: la suma de las partes es EXACTAMENTE el
 * descuento. Sirve para el ITBIS (cada línea paga su tasa sobre lo que le
 * queda) y para llevar el descuento a una factura, que lo guarda por línea.
 *
 * Método del acumulado: a la línea i le toca lo que debe llevar repartido hasta
 * ella, redondeado, menos lo ya repartido. Sin empates que desempatar ni línea
 * "de ajuste": el resto se va corriendo y la última cierra en el descuento.
 * (Es la misma cuenta, operación por operación, que el backend.)
 */
export function repartirDescuento(bases: number[], descuento: number): number[] {
  const total = r2(bases.reduce((a, b) => a + b, 0))
  const d = descuentoAplicable(total, descuento)
  if (d <= 0) return bases.map(() => 0)
  let acumBase = 0
  let repartido = 0
  return bases.map((base) => {
    acumBase = r2(acumBase + base)
    const hasta = r2((d * acumBase) / total)
    const parte = r2(hasta - repartido)
    repartido = hasta
    return parte
  })
}

/** Monto en RD$ de un porcentaje del Sub-total, a centavos y acotado a 0 – Sub-total. */
export function descuentoDePorcentaje(subtotal: number, pct: number): number {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  return descuentoAplicable(subtotal, r2((subtotal * p) / 100))
}

/** Qué porcentaje del Sub-total es un descuento, a 2 decimales (solo para mostrarlo). */
export function porcentajeDeDescuento(subtotal: number, descuento: number): number {
  if (!(subtotal > 0) || !(descuento > 0)) return 0
  return redondear((descuento / subtotal) * 100, 2)
}

/**
 * Porcentaje de descuento de UNA línea que hace que el formulario de factura
 * (montosLinea) calcule exactamente `monto`. Las facturas guardan el descuento
 * por línea y lo escriben en %: con 2 decimales no siempre sale al centavo
 * (7.77 sobre 254.24 da 3.06% → 7.78), así que se usan los decimales que hagan
 * falta, hasta 8. El descuento se calcula sobre cantidad × precio SIN
 * redondear, y eso es lo que reproduce montosLinea aquí.
 */
export function porcentajeDeLinea(cantidad: number, precio: number, monto: number): number {
  const q = redondear(cantidad, 2)
  const p = redondear(precio, 4)
  const bruto = r2(q * p)
  if (!(monto > 0) || !(bruto > 0)) return 0
  if (monto >= bruto) return 100
  const exacto = (monto / (q * p)) * 100
  for (let d = 2; d <= 8; d++) {
    const pct = redondear(exacto, d)
    if (montosLinea({ cant: q, precio: p, desc: pct, indFact: 4 }, false).descuentoMonto === monto) return pct
  }
  return redondear(exacto, 8)
}

// Los totales de la venta, SOLO con las funciones del servidor (`montosLinea` y `totalesDocumento`, que copian el redondeo de PHP 8.3 a propósito): lo que se ve en
// pantalla es lo que el servidor emite. Los precios del carrito son netos y el ITBIS va encima, así que siempre `montosLinea(l, false)`.
import { montosLinea, r2, totalesDocumento } from '@/features/invoices/montosLinea'
import type { LineaMontable, MontosLinea } from '@/features/invoices/montosLinea'
import type { LineaCarrito } from '~/lib/carrito'

export interface ResumenTotales {
  /** Los montos de cada línea, en el orden de las líneas. */
  lineas: MontosLinea[]
  subtotal: number
  descuentos: number
  itbis: number
  total: number
  /** Una fila por cada tasa de ITBIS que hay en la factura (el exento y la tasa cero no suman fila). */
  itbisPorTasa: { indFact: 1 | 2; etiqueta: string; monto: number }[]
}

const ETIQUETA_TASA: Record<1 | 2, string> = { 1: 'ITBIS 18%', 2: 'ITBIS 16%' }

/** Lo que `montosLinea` necesita de una línea del carrito. */
export function lineaMontable(l: LineaCarrito): LineaMontable {
  return { cant: l.cant, precio: l.precio, desc: l.desc, indFact: l.indFact }
}

/** Los montos de una línea tal como el servidor los calcula (precio neto). */
export function montosDe(l: LineaCarrito): MontosLinea {
  return montosLinea(lineaMontable(l), false)
}

/** Los totales de la venta, y el ITBIS desglosado por tasa: cada fila suma los ITBIS de sus líneas, y las filas suman lo mismo que el ITBIS del documento (con 0.005 de margen). */
export function resumenTotales(lineas: LineaCarrito[]): ResumenTotales {
  const montos = lineas.map(montosDe)
  const doc = totalesDocumento(montos)
  const itbisPorTasa: ResumenTotales['itbisPorTasa'] = []
  for (const ind of [1, 2] as const) {
    const propias = lineas.flatMap((l, i) => (l.indFact === ind ? [montos[i]] : []))
    if (propias.length > 0) itbisPorTasa.push({ indFact: ind, etiqueta: ETIQUETA_TASA[ind], monto: r2(propias.reduce((suma, m) => suma + m.itbis, 0)) })
  }
  return { lineas: montos, ...doc, itbisPorTasa }
}

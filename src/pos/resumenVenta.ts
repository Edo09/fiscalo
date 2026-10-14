// Resumen de compra de la pantalla "Venta cobrada" del POS: qué se llevó el
// cliente, cuánto pagó y cuánto se le devuelve. Es una FOTO de la venta tomada al
// cobrar: no guarda referencias al carrito, así que no cambia si el carrito se
// vacía o se refresca después.
//
// Las cuentas son las del carrito (totalesCarrito): mismo importe por línea,
// mismo subtotal, ITBIS y total que ve el cajero y que imprime el recibo.
//
// Sin React ni stores a propósito: scripts/test-pos-resumen-venta.ts lo prueba con Node solo.
import { fmtCantidad } from '../lib/format.ts'
import { formatoCentavos, totalesCarrito } from './montos.ts'

/** Lo que el resumen necesita de una línea del carrito (LineaCarrito lo cumple). */
export interface LineaParaResumen {
  nombre: string
  precioCentavos: number
  cantidad: number
  tasa: number
}

export interface ResumenVenta {
  /** Una por producto, en el orden del carrito. */
  lineas: {
    /** Cantidad como la muestra el carrito: "1", "1.25". */
    cantidad: string
    nombre: string
    /** Importe de la línea como lo muestra el carrito: precio × cantidad, sin el descuento del cliente. */
    importeCentavos: number
  }[]
  /** Total sin ITBIS (el "Subtotal" del carrito y del recibo). */
  subtotalCentavos: number
  itbisCentavos: number
  /** Descuento del cliente de crédito fiscal, ya restado del total; 0 si no tiene. */
  descuentoCentavos: number
  descuentoPct: number
  totalCentavos: number
}

export function resumenVenta(lineas: LineaParaResumen[], descuentoPct = 0): ResumenVenta {
  const t = totalesCarrito(lineas, descuentoPct)
  return {
    lineas: lineas.map((l, i) => ({ cantidad: fmtCantidad(l.cantidad), nombre: l.nombre, importeCentavos: t.lineas[i].bruto })),
    subtotalCentavos: t.subtotal,
    itbisCentavos: t.itbis,
    descuentoCentavos: t.descuento,
    descuentoPct: t.descuento > 0 ? descuentoPct : 0,
    totalCentavos: t.total,
  }
}

/** Lo que el servidor contesta del cobro (VentaRespuesta['cobro'] lo cumple). */
export interface CobroParaResumen {
  forma_pago_nombre: string
  total_centavos: number
  recibido_centavos: number | null
  devuelta_centavos: number | null
}

export interface PagoVenta {
  /** "Efectivo", "Tarjeta", "Transferencia". */
  metodo: string
  /** Efectivo: "Recibido RD$ 3,558.00" ('' si el servidor no lo dijo). Tarjeta o transferencia: "RD$ 2,643.20", el total. */
  detalle: string
  /** Solo efectivo: lo que se devuelve (0 = pago exacto). null en tarjeta o transferencia. */
  devueltaCentavos: number | null
}

export function pagoVenta(cobro: CobroParaResumen): PagoVenta {
  const efectivo = cobro.devuelta_centavos !== null
  const monto = efectivo ? cobro.recibido_centavos : cobro.total_centavos
  const dinero = monto === null ? '' : `RD$ ${formatoCentavos(monto)}`
  return {
    metodo: cobro.forma_pago_nombre,
    detalle: efectivo && dinero ? `Recibido ${dinero}` : dinero,
    devueltaCentavos: cobro.devuelta_centavos,
  }
}

/** «Efectivo · Recibido RD$ 3,558.00», «Tarjeta · RD$ 2,643.20». */
export function textoPago(p: PagoVenta): string {
  return p.detalle ? `${p.metodo} · ${p.detalle}` : p.metodo
}

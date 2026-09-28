// Montos de una línea del e-CF tal como los calcula el backend
// (api-gratex EcfItemMapper::map / ::totales). El formulario muestra ESTO, no
// una cuenta propia: lo que se ve es lo que se emite.
//
// El backend siempre trata `precio_unitario` como precio SIN ITBIS y suma el
// impuesto encima (IndicadorMontoGravado = 0 en el XML). Por eso, cuando el
// usuario escribe precios con ITBIS incluido, aquí se desglosa el precio antes
// de mandarlo: si viajara el precio con ITBIS, la DGII recibiría un 18% más.
import type { IndicadorFacturacion } from '@/api'

/** Tasa de ITBIS según indicador_facturacion: 1=18%, 2=16%, 3 y 4 = 0%. */
export function itbisRate(ind: IndicadorFacturacion): number {
  return ind === 1 ? 0.18 : ind === 2 ? 0.16 : 0
}

/**
 * Redondeo a `dec` decimales, la mitad hacia arriba sobre el valor DECIMAL
 * (84.75 × 18% = 15.255 → 15.26). Math.round a secas redondea el binario
 * (15.254999… → 15.25). toPrecision(15) es el mismo "pre-redondeo" de round()
 * en PHP ≤ 8.3.
 *
 * Depende de la versión de PHP del servidor: producción corre PHP 8.3
 * (confirmado el 2026-09-28). Desde PHP 8.4 round() ya no pre-redondea
 * (84.75 × 18% da 15.25), así que con un PHP local 8.4+ la pantalla puede
 * diferir 1 centavo de lo que emite ESE backend. Si producción se actualiza a
 * 8.4 o más, este redondeo tiene que cambiar a la vez, o la pantalla y la DGII
 * dejan de cuadrar.
 */
function redondear(x: number, dec: number): number {
  const f = 10 ** dec
  const v = Number((Math.abs(x) * f).toPrecision(15))
  return (Math.sign(x) * Math.round(v)) / f
}

export const r2 = (x: number): number => redondear(x, 2)

/** Lo que importa de una línea del formulario para sus montos. */
export interface LineaMontable {
  cant: number
  /** Precio que escribió el usuario (con o sin ITBIS según el interruptor). */
  precio: number
  /** Descuento en %. */
  desc: number
  indFact: IndicadorFacturacion
}

export interface MontosLinea {
  /** PrecioUnitarioItem que viaja: SIN ITBIS (hasta 4 decimales, lo que admite la DGII). */
  precioUnitario: number
  /** DescuentoMonto que viaja, sobre el precio sin ITBIS (0 = sin descuento). */
  descuentoMonto: number
  /** MontoItem: cantidad × precio − descuento, sin ITBIS. */
  base: number
  itbis: number
  /** Columna Importe: con el ITBIS si los precios lo incluyen, como lo escribió el usuario. */
  importe: number
}

/** Montos de una línea con las mismas reglas y redondeos que EcfItemMapper. */
export function montosLinea(l: LineaMontable, precioConItbis: boolean): MontosLinea {
  const rate = itbisRate(l.indFact)
  const precioUnitario = precioConItbis ? redondear(l.precio / (1 + rate), 4) : l.precio
  const bruto = r2(l.cant * precioUnitario)
  // Mismo tope que el backend: un descuento no puede pasar de la línea.
  const descuentoMonto = l.desc > 0 ? Math.min(bruto, r2((l.cant * precioUnitario * l.desc) / 100)) : 0
  const base = r2(bruto - descuentoMonto)
  const itbis = r2(base * rate)
  return { precioUnitario, descuentoMonto, base, itbis, importe: precioConItbis ? r2(base + itbis) : base }
}

/** Totales del documento: los mismos que el MontoTotal que firma el backend. */
export function totalesDocumento(montos: MontosLinea[]) {
  const suma = (k: 'base' | 'itbis' | 'descuentoMonto') => r2(montos.reduce((a, m) => a + m[k], 0))
  const subtotal = suma('base')
  const itbis = suma('itbis')
  return { subtotal, itbis, descuentos: suma('descuentoMonto'), total: r2(subtotal + itbis) }
}

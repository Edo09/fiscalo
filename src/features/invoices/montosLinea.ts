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
 *
 * Exportado para que la factura simple, la cotización y el gasto redondeen
 * cantidades (3) y precios (4) igual que su backend, sin otra copia.
 */
export function redondear(x: number, dec: number): number {
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
  /** CantidadItem que viaja: a 2 decimales, lo que admite la DGII. */
  cantidad: number
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

/**
 * Montos de una línea con las mismas reglas y redondeos que EcfItemMapper.
 *
 * Cantidad y precio se normalizan UNA vez, antes de cualquier cuenta: el XML
 * imprime CantidadItem con 2 decimales y PrecioUnitarioItem con 4, así que
 * MontoItem tiene que salir de esos mismos valores. Con la cantidad cruda
 * (1.125) el XML decía 1.13 × precio y el MontoItem no daba esa cuenta. El
 * precio sin ITBIS escrito a mano también se lleva a 4: con 5 decimales el XML
 * lo recortaba a 2 y dejaba de cuadrar igual.
 */
export function montosLinea(l: LineaMontable, precioConItbis: boolean): MontosLinea {
  const rate = itbisRate(l.indFact)
  const cantidad = redondear(l.cant, 2)
  const precioUnitario = redondear(precioConItbis ? l.precio / (1 + rate) : l.precio, 4)
  const bruto = r2(cantidad * precioUnitario)
  // Mismo tope que el backend: un descuento no puede pasar de la línea.
  const descuentoMonto = l.desc > 0 ? Math.min(bruto, r2((cantidad * precioUnitario * l.desc) / 100)) : 0
  const base = r2(bruto - descuentoMonto)
  const itbis = r2(base * rate)
  return { cantidad, precioUnitario, descuentoMonto, base, itbis, importe: precioConItbis ? r2(base + itbis) : base }
}

/** Totales del documento: los mismos que el MontoTotal que firma el backend. */
export function totalesDocumento(montos: MontosLinea[]) {
  const suma = (k: 'base' | 'itbis' | 'descuentoMonto') => r2(montos.reduce((a, m) => a + m[k], 0))
  const subtotal = suma('base')
  const itbis = suma('itbis')
  return { subtotal, itbis, descuentos: suma('descuentoMonto'), total: r2(subtotal + itbis) }
}

/**
 * Cómo se resuelve una línea vieja que no cuadra (ver lineaQueCuadra):
 * 'ecf' = precio recortado primero y cantidad a 2 decimales (CantidadItem);
 * 'simple' = cantidad redondeada primero y a 3. Mismos nombres que
 * EcfDocumento::MODO_ECF / MODO_SIMPLE del backend.
 */
export type ModoLinea = 'ecf' | 'simple'

/** De dónde salió lo resuelto; mismos textos que el `origen` del backend. */
export type OrigenLinea = 'xml' | 'bd' | 'precio_derivado' | 'cantidad_derivada' | 'cantidad_y_precio_derivados'

/** CantidadItem, PrecioUnitarioItem y MontoItem del Item firmado (null = no vino o no se lee). */
export interface ItemFirmado {
  cantidad: number | null
  precio: number | null
  monto: number | null
}

export interface LineaResuelta {
  cantidad: number
  precio: number
  origen: OrigenLinea
}

/**
 * Cantidad y precio de una línea YA GUARDADA tales que
 * r2(r2(cantidad × precio) − descuento) dé su importe guardado.
 *
 * COPIA EXACTA de EcfDocumento::resolverLinea (api-gratex
 * src/Utils/Pdf/EcfDocumento.php), que es lo que imprimen la carta, la tirilla
 * y el recibo: si este lado resolviera distinto, el formulario cargaría otra
 * línea que la del papel y guardar cualquier otro cambio la reescribiría. Un
 * cambio aquí va allá en el mismo cambio.
 *
 * Antes de la migración 025 la cantidad era INT (1.5 m se guardó como 2) y el
 * precio DECIMAL(10,2) (84.7458 quedó en 84.75), pero el importe se calculó con
 * lo escrito. La precisión perdida no vuelve, y con cantidades grandes las dos
 * explicaciones cuadran a la vez (100 / 84.75 / 8474.58 es 100 × 84.7458 o
 * 99.995 × 84.75). El modo dice cuál fue la pérdida realista: el e-CF manda el
 * precio sin ITBIS con 4 decimales (se perdía el precio); la factura simple usa
 * precios de catálogo de 2 y cantidades con decimales (se perdía la cantidad).
 *   1. e-CF con su Item firmado, si su MontoItem es el importe: lo del XML;
 *   2. la fila ya cuadra: tal cual (todas las nuevas);
 *   3. y 4., en el orden del modo ('ecf': precio y luego cantidad; 'simple':
 *      cantidad y luego precio):
 *      - precio recortado: P' = (importe + desc) / cantidad a 4, solo si cuadra
 *        y r2(P') es justo el precio guardado;
 *      - cantidad redondeada: Q' = (importe + desc) / precio a 2|3, solo si la
 *        guardada es entera, redondear(Q', 0) es ella y Q' cuadra con el precio;
 *   5. se perdieron las dos: ese Q' con el precio ajustado a él, a 4;
 *   6. el precio que cuadra con la cantidad guardada, aunque no redondee al guardado;
 *   7. nada lo explica: tal cual.
 * `importe` null = la fila no lo trae: se calcula como el backend (redondeo por
 * línea), así que la fila cuadra sola.
 */
export function lineaQueCuadra(
  cantidad: number, precio: number, importe: number | null, descuento: number, modo: ModoLinea,
  xml: ItemFirmado | null = null,
): LineaResuelta {
  const valor = importe ?? r2(r2(cantidad * precio) - descuento)
  // MontoItem es el mismo número que se guardó como subtotal: si no coincide,
  // ese Item no es esta fila y mezclarlos daría una línea que no suma.
  if (xml != null && xml.precio != null && (xml.monto == null || Math.abs(xml.monto - valor) < 0.005)) {
    return { cantidad: xml.cantidad ?? cantidad, precio: xml.precio, origen: 'xml' }
  }
  const cuadra = (q: number, p: number) => Math.abs(r2(r2(q * p) - descuento) - valor) < 0.005
  if (cuadra(cantidad, precio)) return { cantidad, precio, origen: 'bd' }
  const bruto = valor + descuento

  // Precio recortado: el que cuadra y que el DECIMAL(10,2) habría dejado justo en el guardado.
  const precioDerivado = cantidad > 0 ? redondear(bruto / cantidad, 4) : null
  const cuadraConPrecio = precioDerivado != null && cuadra(cantidad, precioDerivado)
  const porPrecio: LineaResuelta | null = precioDerivado != null && cuadraConPrecio
    && Math.abs(r2(precioDerivado) - precio) < 1e-6
    ? { cantidad, precio: precioDerivado, origen: 'precio_derivado' }
    : null

  // Cantidad redondeada: solo si el INT la explica (1.5 → 2 y 0.4 → 0, la mitad
  // hacia arriba como MySQL), no una cantidad cualquiera.
  let cantidadDerivada: number | null = null
  if (Math.abs(cantidad - redondear(cantidad, 0)) < 1e-9 && precio > 0) {
    const q = redondear(bruto / precio, modo === 'ecf' ? 2 : 3)
    if (q > 0 && Math.abs(q - cantidad) > 1e-9 && Math.abs(redondear(q, 0) - cantidad) < 1e-9) cantidadDerivada = q
  }
  const porCantidad: LineaResuelta | null = cantidadDerivada != null && cuadra(cantidadDerivada, precio)
    ? { cantidad: cantidadDerivada, precio, origen: 'cantidad_derivada' }
    : null

  const primero = modo === 'ecf' ? (porPrecio ?? porCantidad) : (porCantidad ?? porPrecio)
  if (primero) return primero

  if (cantidadDerivada != null) {
    const precioAjustado = redondear(bruto / cantidadDerivada, 4)
    if (cuadra(cantidadDerivada, precioAjustado)) {
      return { cantidad: cantidadDerivada, precio: precioAjustado, origen: 'cantidad_y_precio_derivados' }
    }
  }
  if (precioDerivado != null && cuadraConPrecio) return { cantidad, precio: precioDerivado, origen: 'precio_derivado' }
  return { cantidad, precio, origen: 'bd' }
}

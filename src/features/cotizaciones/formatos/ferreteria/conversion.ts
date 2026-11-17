// Facturar una cotización de Ferretería (spec 8.3): arma el borrador con que
// se abre la factura e-CF (InvoiceFormView) o la factura simple
// (SimpleInvoiceFormView). Solo datos: los dos formularios siguen editables y
// aplican el descuento fijo del cliente al cargarlo, igual que al elegirlo a
// mano.
//
// El descuento de la cotización (la fila "Descuento") SÍ se copia: la factura lo
// guarda por línea y en %, así que se reparte entre las líneas en proporción a
// su valor (repartirDescuento) y cada una recibe el % que le hace dar su parte
// al centavo (porcentajeDeLinea). Con él, la factura e-CF da el mismo ITBIS y el
// mismo total que la cotización. Como ya lleva el descuento de esta venta, el
// descuento fijo del CLIENTE no se aplica encima (`descuentoOrigen` se lo dice
// a la factura): sería descontar dos veces.
//
// Lo que NO se copia: los cargos adicionales (cargos bancarios, manejo, mano
// de obra) van como aviso, porque el usuario decide si los cobra en la
// factura; retención y abono tampoco, porque el cobro se registra en la factura.
//
// Imports de valor SOLO por ruta relativa con .ts (como totales.ts): así
// scripts/test-conversion-ferreteria.ts carga este archivo con `node` tal cual.
// Lo de '@/…' va solo como `import type`, que Node borra.
import type { CotizacionItemRow, CotizacionRow, IndicadorFacturacion } from '@/api'
import type { FacturaPrefill, FacturaSimplePrefill } from '@/types/domain'
import { itbisRate, r2, redondear } from '../../../invoices/montosLinea.ts'
import { aNumero, fmt } from '../../../../lib/format.ts'
import { porcentajeDeDescuento, porcentajeDeLinea, repartirDescuento } from './descuento.ts'

/** Ajustes que suben el TOTAL de la cotización (sin ITBIS), en el orden del PDF. */
const CARGOS: { clave: string; etiqueta: string }[] = [
  { clave: 'cargos_bancarios', etiqueta: 'Cargos bancarios' },
  { clave: 'manejo_bancario', etiqueta: 'Manejos de operaciones bancarias' },
  { clave: 'mano_obra', etiqueta: 'Costo mano de obra' },
]

/** Cómo la nombra el banner de la factura: su código, o el id (mismo criterio que la conversión de Gratex). */
const origenDe = (c: CotizacionRow): string => c.code || `#${c.id}`

const clienteDe = (c: CotizacionRow) => ({
  clienteId: c.client_id != null ? String(c.client_id) : '',
  clienteNombre: c.client_name || '',
})

/**
 * Aviso de los cargos que la factura no trae, con sus montos. Vacío si la
 * cotización no tenía ninguno (una de Gratex llega con `ajustes` = {}).
 */
export function avisosCargos(c: CotizacionRow): string[] {
  const cargos = CARGOS
    .map(({ clave, etiqueta }) => ({ etiqueta, monto: aNumero(c.ajustes?.[clave]) }))
    .filter((x) => x.monto > 0)
  if (cargos.length === 0) return []
  const lista = cargos.map((x) => `${x.etiqueta} RD$ ${fmt(x.monto)}`).join(', ')
  return [`La cotización ${origenDe(c)} tenía cargos adicionales: ${lista} — agrégalos como línea si corresponde.`]
}

/** Las líneas con texto: una sin descripción no tiene qué facturar. */
const conTexto = (c: CotizacionRow): CotizacionItemRow[] =>
  (c.items ?? []).filter((it) => (it.description ?? '').trim() !== '')

/** Cantidad y precio de la línea como los lleva la cuenta del e-CF (cantidad a 2 decimales, precio a 4). */
const cantidadDe = (it: CotizacionItemRow): number => redondear(aNumero(it.quantity ?? 1), 2)
const precioDe = (it: CotizacionItemRow): number => redondear(aNumero(it.amount), 4)

/** Descuento en RD$ de la cotización guardada (la fila "Descuento"); 0 si no trae. */
export function descuentoDe(c: CotizacionRow): number {
  const d = r2(aNumero(c.ajustes?.descuento))
  return d > 0 ? d : 0
}

/**
 * El descuento de la cotización repartido entre las líneas que se facturan,
 * como el % de descuento de cada una (en el orden de `lineas`). Cada % hace que
 * montosLinea dé justo la parte que le tocó, así que las partes suman el
 * descuento y la factura e-CF calcula el mismo ITBIS que la cotización.
 */
function porcentajesPorLinea(c: CotizacionRow, lineas: CotizacionItemRow[]): number[] {
  const descuento = descuentoDe(c)
  if (!(descuento > 0)) return lineas.map(() => 0)
  const partes = repartirDescuento(lineas.map((it) => r2(cantidadDe(it) * precioDe(it))), descuento)
  return lineas.map((it, i) => porcentajeDeLinea(cantidadDe(it), precioDe(it), partes[i]))
}

/**
 * Aviso de la factura cuando la cotización traía descuento: dice cuánto era y
 * que pasó a las líneas. Vacío si no traía ninguno.
 */
export function avisosDescuento(c: CotizacionRow): string[] {
  const descuento = descuentoDe(c)
  if (!(descuento > 0)) return []
  const subtotal = r2(conTexto(c).reduce((a, it) => a + r2(cantidadDe(it) * precioDe(it)), 0))
  const pct = porcentajeDeDescuento(subtotal, descuento)
  const parte = pct > 0 ? ` (${pct}% del sub-total)` : ''
  return [
    `La cotización ${origenDe(c)} tenía un descuento de RD$ ${fmt(descuento)}${parte}: pasó a las líneas de la factura. `
    + 'Si el cliente tiene un descuento fijo, no se suma a este.',
  ]
}

/** indicador_facturacion de la línea. Ausente o fuera de 1-4: 1 (18%), lo que el backend guarda por defecto. */
function indicadorDe(it: CotizacionItemRow): IndicadorFacturacion {
  const n = aNumero(it.indicador_facturacion)
  return n === 2 || n === 3 || n === 4 ? n : 1
}

/** El producto ligado, como el id de texto de los formularios. Línea libre: nada. */
function productoDe(it: CotizacionItemRow): { prodId?: string } {
  const id = aNumero(it.product_id)
  return id > 0 ? { prodId: String(id) } : {}
}

/** Código DGII de la unidad (la API lo manda como texto, ej. '43'). 0 = no vino. */
const unidadDe = (it: CotizacionItemRow): number => aNumero(it.unidad_medida)

/**
 * Borrador de la factura e-CF. Precios SIN ITBIS, como en la cotización (la
 * factura lo suma encima), y cada línea con su producto, unidad, indicador y
 * bien/servicio: emitir el e-CF descuenta inventario como cualquier venta.
 */
export function ferreteriaAFacturaPrefill(c: CotizacionRow): FacturaPrefill {
  const lineas = conTexto(c)
  const pct = porcentajesPorLinea(c, lineas)
  const descuento = descuentoDe(c)
  return {
    kind: 'factura-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    precioConItbis: false,
    avisos: [...avisosCargos(c), ...avisosDescuento(c)],
    ...(descuento > 0 ? { descuentoOrigen: descuento } : {}),
    lineas: lineas.map((it, i) => ({
      nombre: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: aNumero(it.amount),
      ...(pct[i] > 0 ? { desc: pct[i] } : {}),
      ...productoDe(it),
      unidadMedida: unidadDe(it) || 43,
      indFact: indicadorDe(it),
      tipoItem: aNumero(it.indicador_bien_servicio) === 2 ? 'Servicio' : 'Bien',
    })),
  }
}

/**
 * Borrador de la factura simple. La factura simple no desglosa ITBIS, así que
 * cada precio lo trae incluido, r4(precio × (1 + tasa)), y el cliente paga
 * casi el TOTAL cotizado (unos centavos de diferencia por redondear cada
 * precio; el spec lo acepta). La unidad viaja solo si la cotización la tenía.
 *
 * El descuento viaja como el mismo % por línea que en la factura e-CF: un % es
 * igual sobre el valor sin ITBIS que sobre el que lo trae incluido, así que la
 * rebaja es proporcional a la que hizo la cotización (con esos mismos centavos
 * de diferencia por redondear cada precio).
 */
export function ferreteriaAFacturaSimplePrefill(c: CotizacionRow): FacturaSimplePrefill {
  const lineas = conTexto(c)
  const pct = porcentajesPorLinea(c, lineas)
  const descuento = descuentoDe(c)
  return {
    kind: 'factura-simple-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    avisos: [...avisosCargos(c), ...avisosDescuento(c)],
    ...(descuento > 0 ? { descuentoOrigen: descuento } : {}),
    lineas: lineas.map((it, i) => ({
      ...productoDe(it),
      descripcion: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: redondear(aNumero(it.amount) * (1 + itbisRate(indicadorDe(it))), 4),
      ...(pct[i] > 0 ? { desc: pct[i] } : {}),
      unidadMedida: unidadDe(it) || null,
    })),
  }
}

// Facturar un conduce de Ferretería (spec 5.6): arma el borrador con que se
// abre la factura e-CF (InvoiceFormView) o la factura simple
// (SimpleInvoiceFormView). Mismas reglas que facturar una cotización de
// Ferretería (formatos/ferreteria/conversion.ts): cada línea lleva el precio
// interno que guarda el conduce (sin ITBIS), su ITBIS, su producto y su
// unidad, así que emitir descuenta inventario como cualquier venta. Solo
// datos: los dos formularios siguen editables y aplican el descuento fijo del
// cliente al cargarlo.
//
// Lo distinto de la cotización: el borrador dice que viene de un conduce
// (origenTipo), y un conduce no tiene cargos ni totales. Su "Línea libre" se
// guarda sin precio (amount 0) porque el conduce no muestra precios: los
// formularios no dejan emitir ni guardar hasta escribirlo (la DGII rechaza un
// MontoItem 0 después de reservar el e-NCF).
//
// Imports de valor SOLO por ruta relativa con .ts (como la conversión de
// Ferretería): así scripts/test-conversion-conduce.ts carga este archivo con
// `node` tal cual. Lo de '@/…' va solo como `import type`, que Node borra.
import type { ConduceItemRow, ConduceRow } from '@/api'
import type { FacturaPrefill, FacturaSimplePrefill } from '@/types/domain'
import { itbisRate, redondear } from '../invoices/montosLinea.ts'
import { aNumero } from '../../lib/format.ts'
import { indicadorDe } from '../cotizaciones/formatos/ferreteria/lineas.ts'
import { MSG_CLIENTE_BORRADO } from './schema.ts'

/** Error de cada línea sin precio en los dos formularios de factura (spec 5.6). */
export const MSG_SIN_PRECIO = 'Escribe el precio: en el conduce esta línea no tenía.'

/** Nombre del cliente que se muestra: el actual o, si se borró, el que guardó el conduce (spec 5.2). */
export function nombreConduce(c: ConduceRow): string {
  return c.client_name || c.client_name_guardado || ''
}

/** Cómo lo nombra el banner de la factura: su código (CON-000001), o el id. */
const origenDe = (c: ConduceRow): string => c.code || `#${c.id}`

/**
 * El cliente sigue existiendo. `client_name` sale del LEFT JOIN con clients y
 * esa columna es NOT NULL: null quiere decir que el cliente se borró (el
 * conduce conserva el id viejo, sin FK).
 */
const clienteVivo = (c: ConduceRow): boolean => c.client_id != null && c.client_name != null

/**
 * Con el cliente borrado la factura abre sin cliente y lo dice: con el id
 * viejo, la e-CF fallaría al emitir y la simple se guardaría sin nombre.
 */
const clienteDe = (c: ConduceRow) => ({
  clienteId: clienteVivo(c) ? String(c.client_id) : '',
  clienteNombre: nombreConduce(c),
})

/** Las líneas con texto: una sin descripción no tiene qué facturar. */
const conTexto = (c: ConduceRow): ConduceItemRow[] =>
  (c.items ?? []).filter((it) => (it.description ?? '').trim() !== '')

/** Cuántas de las líneas que pasan a la factura no tienen precio (amount 0 o ausente). */
export function lineasSinPrecio(c: ConduceRow): number {
  return conTexto(c).filter((it) => aNumero(it.amount) === 0).length
}

/** Avisos bajo el banner: el cliente borrado y las líneas que hay que completar. */
function avisosDe(c: ConduceRow): string[] {
  const n = lineasSinPrecio(c)
  return [
    ...(clienteVivo(c) ? [] : [MSG_CLIENTE_BORRADO]),
    ...(n > 0 ? [`${n} línea(s) del conduce no tienen precio: escríbelo antes de emitir.`] : []),
  ]
}

/** El producto ligado, como el id de texto de los formularios. Línea libre: nada. */
function productoDe(it: ConduceItemRow): { prodId?: string } {
  const id = aNumero(it.product_id)
  return id > 0 ? { prodId: String(id) } : {}
}

/** Código DGII de la unidad (la API lo manda como texto, ej. '43'). 0 = no vino. */
const unidadDe = (it: ConduceItemRow): number => aNumero(it.unidad_medida)

/**
 * Borrador de la factura e-CF. Precios SIN ITBIS, los internos del conduce (la
 * factura lo suma encima), y cada línea con su producto, unidad, indicador y
 * bien/servicio.
 */
export function conduceAFacturaPrefill(c: ConduceRow): FacturaPrefill {
  return {
    kind: 'factura-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    origenTipo: 'conduce',
    precioConItbis: false,
    avisos: avisosDe(c),
    lineas: conTexto(c).map((it) => ({
      nombre: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: aNumero(it.amount),
      ...productoDe(it),
      unidadMedida: unidadDe(it) || 43,
      indFact: indicadorDe(it.indicador_facturacion),
      tipoItem: aNumero(it.indicador_bien_servicio) === 2 ? 'Servicio' : 'Bien',
    })),
  }
}

/**
 * Borrador de la factura simple. La factura simple no desglosa ITBIS, así que
 * cada precio lo trae incluido, r4(precio × (1 + tasa)), igual que al facturar
 * una cotización de Ferretería. Una línea sin precio sigue en 0.
 */
export function conduceAFacturaSimplePrefill(c: ConduceRow): FacturaSimplePrefill {
  return {
    kind: 'factura-simple-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    origenTipo: 'conduce',
    avisos: avisosDe(c),
    lineas: conTexto(c).map((it) => ({
      ...productoDe(it),
      descripcion: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: redondear(aNumero(it.amount) * (1 + itbisRate(indicadorDe(it.indicador_facturacion))), 4),
      unidadMedida: unidadDe(it) || null,
    })),
  }
}

// Líneas y cliente del papel de Ferretería, compartidos por la cotización
// (FerreteriaCotizacionForm) y el conduce (features/conduces): la línea libre,
// la de un producto del catálogo, las líneas y el cliente de un documento
// guardado, y el RNC con guiones del PDF. Salieron tal cual del formulario de
// la cotización (spec conduces 5.5): cambiar algo aquí cambia los dos papeles.
//
// Imports de valor SOLO por ruta relativa con .ts y '@/…' solo como
// `import type`: así `node` carga este archivo para
// scripts/test-lineas-ferreteria.ts sin compilar nada.
import type { IndicadorFacturacion } from '@/api'
import type { Cliente, Producto } from '@/types/domain'
import { aNumero } from '../../../../lib/format.ts'
import { indFactFromItbis } from '../../../invoices/montosLinea.ts'
import type { LineaFerreteriaForm } from './schema.ts'

export const siguienteId = (ls: LineaFerreteriaForm[]) => Math.max(0, ...ls.map((l) => l.id)) + 1

/** Línea escrita a mano: gravada al 18%, por unidad y como bien, igual que en la factura. */
export const lineaLibre = (id: number): LineaFerreteriaForm => ({
  id, prodId: '', descripcion: '', cantidad: 1, precio: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
})

/** Indicador guardado (TINYINT, null en una línea sin él) → uno válido; 1 por defecto, como el backend. */
export const indicadorDe = (v: unknown): IndicadorFacturacion => {
  const n = Number(v)
  return n === 2 || n === 3 || n === 4 ? n : 1
}

/**
 * Columnas de una línea guardada que leen los dos papeles: las que comparten
 * cotizacion_items (CotizacionItemRow) y conduce_items (ConduceItemRow).
 */
export interface LineaGuardada {
  description?: string | null
  quantity?: string | number | null
  amount?: string | number | null
  product_id?: number | null
  unidad_medida?: string | null
  indicador_facturacion?: number | string | null
  indicador_bien_servicio?: number | string | null
}

/**
 * Líneas de una cotización o un conduce guardados. Cantidad y precio llegan
 * como texto DECIMAL ("2.000", "935.0000"); los indicadores, como número o
 * como texto.
 */
export function lineasDeFila(row: { items?: LineaGuardada[] | null }): LineaFerreteriaForm[] {
  return (row.items ?? []).map((it, i) => ({
    id: i + 1,
    prodId: it.product_id ? String(it.product_id) : '',
    descripcion: it.description ?? '',
    cantidad: aNumero(it.quantity ?? 1),
    precio: aNumero(it.amount),
    indFact: indicadorDe(it.indicador_facturacion),
    unidadMedida: Number(it.unidad_medida ?? 43) || 43,
    tipoItem: Number(it.indicador_bien_servicio ?? 1) === 2 ? 'Servicio' : 'Bien',
  }))
}

/**
 * Ficha provisional con lo que trae la fila (id y nombre), mientras llega el
 * cliente completo. Con ella el client_id ya está puesto: si la ficha no
 * llegara, guardar sigue funcionando.
 */
export function clienteDeFila(row: { client_id?: number | null; client_name?: string | null }): Cliente | null {
  if (!row.client_id) return null
  return {
    id: String(row.client_id), nombre: row.client_name || `Cliente #${row.client_id}`,
    contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
    balance: 0, facturas: 0, estado: '', desde: '', descuento: 0, permiteCredito: false,
  }
}

/** RNC o cédula con guiones, como lo imprime el PDF (FerreteriaFormato::formatearRnc). */
export function formatearRnc(rnc: string | null | undefined): string {
  const tal = (rnc ?? '').trim()
  const d = tal.replace(/\D/g, '')
  if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return tal
}

/**
 * Línea de un artículo del catálogo: su nombre, su precio SIN ITBIS, su
 * unidad, su tasa y si es bien o servicio. En el conduce el precio no se ve:
 * queda guardado para Facturar.
 */
export function lineaDesdeProducto(p: Producto, id: number): LineaFerreteriaForm {
  return {
    id,
    prodId: p.id,
    descripcion: p.nombre,
    cantidad: 1,
    precio: p.precio,
    indFact: indFactFromItbis(p.itbis),
    unidadMedida: p.unidadMedida || 43,
    tipoItem: p.tipo === 'Servicio' ? 'Servicio' : 'Bien',
  }
}

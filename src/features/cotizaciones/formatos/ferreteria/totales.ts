// Totales de la cotización de Ferretería (spec 6.2): las MISMAS reglas y
// redondeos que FerreteriaFormato::totales (api-gratex
// src/Utils/Cotizacion/FerreteriaFormato.php). La pantalla muestra esto y el
// servidor recalcula lo mismo al guardar, sin mirar lo que mande el front: si
// los dos lados no dan igual al centavo, el usuario guarda un TOTAL y el PDF
// imprime otro. Un cambio de regla va en los dos lados en el mismo cambio, y
// scripts/parity-cotizacion-ferreteria.ts corre los casos del backend.
//
// Imports de valor SOLO por ruta relativa con .ts: así `node` carga este
// archivo tal cual para el script de paridad (Node quita los tipos pero no
// resuelve el alias '@/'). Lo de '@/…' va solo como `import type`, que se
// borra; nada de enums ni otra sintaxis que no se pueda borrar.
import type { IndicadorFacturacion } from '@/api'
import { itbisRate, montosLinea, r2 } from '../../../invoices/montosLinea.ts'
import { descuentoAplicable, repartirDescuento } from './descuento.ts'

/** Lo que importa de una línea para sus montos. */
export interface LineaFerreteria {
  cantidad: number
  /** Precio unitario SIN ITBIS, como en la hoja de Excel. */
  precio: number
  /** indicador_facturacion: 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indFact: number
}

/** Descuento y grupo "Cargos y abonos" del formulario. */
export interface AjustesFerreteriaForm {
  cargosBancarios: number
  manejoBancario: number
  manoObra: number
  abono: number
  /** Casilla "Retención Renta 5%". */
  retencion: boolean
  /**
   * Descuento en RD$ de la fila "Descuento", bajo el Sub-total. Se resta antes
   * del ITBIS (ver totalesFerreteria). Fuera del grupo de cargos y abonos, pero
   * viaja con ellos en `ajustes.descuento` del API.
   */
  descuento: number
}

export interface TotalesFerreteria {
  /** Cada línea SIN descuento: lo que dice su fila (cantidad × precio y el ITBIS de ese valor). */
  lineas: { base: number; itbis: number }[]
  /** Σ de las líneas, antes del descuento. */
  subtotal: number
  /** El descuento aplicado (a centavos, entre 0 y el Sub-total). */
  descuento: number
  /** Sub-total − descuento: la base del ITBIS y de la retención. */
  subtotalNeto: number
  /** ITBIS del Sub-total ya rebajado. */
  itbis: number
  cargosBancarios: number
  manejoBancario: number
  manoObra: number
  total: number
  retencion: number
  /** TOTAL − retención: lo que el abono no puede pasar. */
  adeudado: number
  abono: number
  restante: number
  etiquetaItbis: 'ITBIS 18%' | 'ITBIS'
  /** Restante (Adeudado) solo se muestra si hubo retención o abono. */
  mostrarRestante: boolean
}

/** Retención Renta por Tercero: 5% del Sub-total (ya con el descuento), el monto antes del ITBIS. */
const TASA_RETENCION = 0.05

/**
 * Cada línea con las reglas del e-CF (montosLinea con precio SIN ITBIS y sin
 * descuento: base = r2(r2(cantidad) × r4(precio)), ITBIS por línea sobre esa
 * base) y las sumas redondeadas al final, como totalesDocumento.
 *
 * El descuento (la fila "Descuento") se resta del Sub-total antes del ITBIS: se
 * reparte entre las líneas en proporción a su base (repartirDescuento) y cada
 * una paga su tasa sobre lo que le queda, igual que lo hará la factura que
 * salga de la cotización (la que guarda el descuento por línea). El descuento
 * fijo del CLIENTE sigue sin ir aquí: lo aplica la factura al convertir, salvo
 * que la cotización ya traiga el suyo (ver conversion.ts).
 *
 * Cargos y mano de obra se suman después del ITBIS y no lo llevan; retención
 * y abono no cambian el TOTAL, solo lo que queda por pagar. La retención es el
 * 5% del Sub-total ya rebajado.
 */
export function totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria {
  const montos = lineas.map((l) =>
    montosLinea({ cant: l.cantidad, precio: l.precio, desc: 0, indFact: l.indFact as IndicadorFacturacion }, false))
  const subtotal = r2(montos.reduce((a, m) => a + m.base, 0))
  const descuento = descuentoAplicable(subtotal, ajustes.descuento)
  const subtotalNeto = r2(subtotal - descuento)
  // Sin descuento las partes son 0 y esto es exactamente Σ ITBIS de cada línea.
  const partes = repartirDescuento(montos.map((m) => m.base), descuento)
  const itbis = r2(montos.reduce((a, m, i) => a + r2(r2(m.base - partes[i]) * itbisRate(lineas[i].indFact as IndicadorFacturacion)), 0))
  const cargosBancarios = r2(ajustes.cargosBancarios)
  const manejoBancario = r2(ajustes.manejoBancario)
  const manoObra = r2(ajustes.manoObra)
  const total = r2(subtotalNeto + itbis + cargosBancarios + manejoBancario + manoObra)
  const retencion = ajustes.retencion ? r2(subtotalNeto * TASA_RETENCION) : 0
  const adeudado = r2(total - retencion)
  const abono = r2(ajustes.abono)
  // "ITBIS 18%" solo si todo lo que lleva ITBIS va al 18%: con una línea al
  // 16%, o sin nada gravado, el rótulo no puede prometer una tasa.
  const gravadas = lineas.filter((_, i) => montos[i].itbis > 0)
  const etiquetaItbis = gravadas.length > 0 && gravadas.every((l) => l.indFact === 1) ? 'ITBIS 18%' : 'ITBIS'
  return {
    lineas: montos.map((m) => ({ base: m.base, itbis: m.itbis })),
    subtotal,
    descuento,
    subtotalNeto,
    itbis,
    cargosBancarios,
    manejoBancario,
    manoObra,
    total,
    retencion,
    adeudado,
    abono,
    restante: r2(adeudado - abono),
    etiquetaItbis,
    mostrarRestante: retencion > 0 || abono > 0,
  }
}

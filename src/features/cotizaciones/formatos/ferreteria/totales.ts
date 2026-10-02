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
import { montosLinea, r2 } from '../../../invoices/montosLinea.ts'

/** Lo que importa de una línea para sus montos. */
export interface LineaFerreteria {
  cantidad: number
  /** Precio unitario SIN ITBIS, como en la hoja de Excel. */
  precio: number
  /** indicador_facturacion: 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indFact: number
}

/** Grupo "Cargos y abonos" del formulario. */
export interface AjustesFerreteriaForm {
  cargosBancarios: number
  manejoBancario: number
  manoObra: number
  abono: number
  /** Casilla "Retención Renta 5%". */
  retencion: boolean
}

export interface TotalesFerreteria {
  lineas: { base: number; itbis: number }[]
  subtotal: number
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

/** Retención Renta por Tercero: 5% del Sub-total, el monto antes del ITBIS. */
const TASA_RETENCION = 0.05

/**
 * Cada línea con las reglas del e-CF (montosLinea con precio SIN ITBIS y sin
 * descuento: base = r2(r2(cantidad) × r4(precio)), ITBIS por línea sobre esa
 * base) y las sumas redondeadas al final, como totalesDocumento. El descuento
 * fijo del cliente no va aquí: lo aplica la factura al convertir.
 *
 * Cargos y mano de obra se suman después del ITBIS y no lo llevan; retención
 * y abono no cambian el TOTAL, solo lo que queda por pagar.
 */
export function totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria {
  const montos = lineas.map((l) =>
    montosLinea({ cant: l.cantidad, precio: l.precio, desc: 0, indFact: l.indFact as IndicadorFacturacion }, false))
  const subtotal = r2(montos.reduce((a, m) => a + m.base, 0))
  const itbis = r2(montos.reduce((a, m) => a + m.itbis, 0))
  const cargosBancarios = r2(ajustes.cargosBancarios)
  const manejoBancario = r2(ajustes.manejoBancario)
  const manoObra = r2(ajustes.manoObra)
  const total = r2(subtotal + itbis + cargosBancarios + manejoBancario + manoObra)
  const retencion = ajustes.retencion ? r2(subtotal * TASA_RETENCION) : 0
  const adeudado = r2(total - retencion)
  const abono = r2(ajustes.abono)
  // "ITBIS 18%" solo si todo lo que lleva ITBIS va al 18%: con una línea al
  // 16%, o sin nada gravado, el rótulo no puede prometer una tasa.
  const gravadas = lineas.filter((_, i) => montos[i].itbis > 0)
  const etiquetaItbis = gravadas.length > 0 && gravadas.every((l) => l.indFact === 1) ? 'ITBIS 18%' : 'ITBIS'
  return {
    lineas: montos.map((m) => ({ base: m.base, itbis: m.itbis })),
    subtotal,
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

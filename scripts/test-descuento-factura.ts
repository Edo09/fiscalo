// Facturar una cotización de Ferretería que trae descuento: la factura que sale
// de ella tiene que dar el mismo Sub-total, ITBIS y TOTAL, al centavo.
//
// La factura e-CF guarda el descuento por línea y lo escribe en %: el borrador
// (ferreteriaAFacturaPrefill) reparte el descuento entre las líneas y busca el %
// de cada una para que dé justo su parte. Aquí se prueba con 2,000 cotizaciones
// al azar (cantidades, precios, tasas y descuentos de todo tipo, con semilla
// fija) que la cuenta de la factura (montosLinea + totalesDocumento) es la de la
// cotización (totalesFerreteria). La factura simple cobra precios con el ITBIS
// ya dentro y se desvía unos centavos por redondear cada precio, con o sin
// descuento; aquí se comprueba que el descuento no agrega más de un centavo por
// línea a ese desvío.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-descuento-factura.ts
import type { CotizacionRow } from '../src/api/types.ts'
import {
  ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill,
} from '../src/features/cotizaciones/formatos/ferreteria/conversion.ts'
import { totalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import type { AjustesFerreteriaForm } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import { montosLinea, r2, redondear, totalesDocumento } from '../src/features/invoices/montosLinea.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const SIN: AjustesFerreteriaForm = {
  cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false, descuento: 0,
}

console.log('\nFacturar con descuento: 2,000 cotizaciones al azar, la factura e-CF cuadra al centavo con la cotización')
{
  // Generador con semilla (mulberry32): el mismo resultado en cada corrida.
  let s = 777
  const azar = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))

  let casos = 0
  let malosEcf = 0
  let primerMalo = ''
  let desvioSimple = 0
  for (let i = 0; i < 2000; i++) {
    const n = entre(1, 6)
    const items = Array.from({ length: n }, () => ({
      description: 'ARTICULO', quantity: String(entre(1, 5000) / 100), amount: String(entre(1, 5_000_000) / 10000),
      indicador_facturacion: entre(1, 4), indicador_bien_servicio: 1, unidad_medida: '43',
    }))
    const lineas = items.map((it) => ({ cantidad: Number(it.quantity), precio: Number(it.amount), indFact: it.indicador_facturacion }))
    const subtotal = totalesFerreteria(lineas, SIN).subtotal
    if (!(subtotal > 0)) continue
    const D = r2(entre(1, Math.round(subtotal * 100)) / 100)
    const t = totalesFerreteria(lineas, { ...SIN, descuento: D })
    const fila: CotizacionRow = { id: 1, code: 'COT-000001', client_id: 1, client_name: 'CLIENTE', formato: 'ferreteria', items, ajustes: { descuento: String(D) } }
    casos++

    // e-CF: las líneas del borrador, con las cuentas del formulario de factura.
    const prefill = ferreteriaAFacturaPrefill(fila)
    const doc = totalesDocumento(prefill.lineas.map((l) =>
      montosLinea({ cant: l.cantidad, precio: l.precio, desc: l.desc ?? 0, indFact: (l.indFact ?? 1) as 1 | 2 | 3 | 4 }, false)))
    if (doc.subtotal !== t.subtotalNeto || doc.itbis !== t.itbis || doc.total !== t.total || doc.descuentos !== t.descuento) {
      malosEcf++
      if (!primerMalo) primerMalo = `D=${D}: factura ${JSON.stringify(doc)} contra cotización neto ${t.subtotalNeto} ITBIS ${t.itbis} TOTAL ${t.total}`
    }

    // Factura simple: precios con ITBIS incluido y % por línea (las cuentas de SimpleInvoiceFormView).
    const simple = (f: CotizacionRow) => ferreteriaAFacturaSimplePrefill(f).lineas.reduce((a, l) => {
      const cant = redondear(l.cantidad, 3)
      const precio = redondear(l.precio, 4)
      const bruto = r2(cant * precio)
      const desc = (l.desc ?? 0) > 0 ? Math.min(bruto, r2((cant * precio * (l.desc ?? 0)) / 100)) : 0
      return a + r2(bruto - desc)
    }, 0)
    const sinD = totalesFerreteria(lineas, SIN)
    const extra = Math.abs((simple(fila) - simple({ ...fila, ajustes: {} })) - (t.total - sinD.total))
    desvioSimple = Math.max(desvioSimple, extra / n)
  }
  chk(`${casos} cotizaciones: sub-total, descuentos, ITBIS y TOTAL de la factura e-CF iguales a la cotización${malosEcf ? ` (${malosEcf} distintas; primera: ${primerMalo})` : ''}`, malosEcf === 0)
  chk(`factura simple: el descuento agrega a lo sumo 1 centavo por línea de desvío (el peor: ${desvioSimple.toFixed(4)} por línea)`, desvioSimple <= 0.01 + 1e-9)
}

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)

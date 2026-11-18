// Descuento de la cotización de Ferretería: el reparto entre las líneas, los
// totales con descuento (ITBIS y retención sobre el Sub-total YA rebajado) y los
// porcentajes que van y vienen. Las cuentas son las que hará FerreteriaFormato
// del backend (api-gratex), y las cifras de los casos fijos salieron de hacerlas
// a mano, no del código: el reparto es "al centavo" y no admite una cuenta que
// "más o menos" cuadre.
//
// Además de los casos fijos corre cientos de casos al azar contra una
// referencia aparte en enteros (BigInt, centavos): si la cuenta con decimales
// de JS se desviara aunque sea un centavo, o si las líneas repartidas no sumaran
// el descuento, fallaría aquí.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-descuento-cotizacion.ts
import {
  descuentoAplicable, descuentoDePorcentaje, porcentajeDeDescuento, porcentajeDeLinea, repartirDescuento,
} from '../src/features/cotizaciones/formatos/ferreteria/descuento.ts'
import { totalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import type { AjustesFerreteriaForm, LineaFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import { montosLinea, r2 } from '../src/features/invoices/montosLinea.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const a = JSON.stringify(obtenido)
  const b = JSON.stringify(esperado)
  chk(a === b ? desc : `${desc}: dio ${a}, se esperaba ${b}`, a === b)
}

const SIN: AjustesFerreteriaForm = {
  cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false, descuento: 0,
}
const l = (cantidad: number, precio: number, indFact = 1): LineaFerreteria => ({ cantidad, precio, indFact })

// ---------------------------------------------------------------------------
console.log('\nrepartirDescuento: sin descuento no se reparte nada')
igual('descuento 0', repartirDescuento([100, 50], 0), [0, 0])
igual('descuento negativo', repartirDescuento([100, 50], -5), [0, 0])
igual('sin líneas', repartirDescuento([], 10), [])
igual('bases en 0 (nada que rebajar)', repartirDescuento([0, 0], 10), [0, 0])

console.log('\nrepartirDescuento: casos hechos a mano')
igual('una línea se lleva todo', repartirDescuento([59400], 5940), [5940])
igual('proporcional y exacto: 1000/500/200 con 170 → 100/50/20', repartirDescuento([1000, 500, 200], 170), [100, 50, 20])
// 10.00 sobre 3 × 33.33 (99.99): 3.333… cada una. Acumulado redondeado: 3.33, 6.67, 10.00.
igual('tres líneas iguales con resto: 3.33 / 3.34 / 3.33 (suma 10.00)', repartirDescuento([33.33, 33.33, 33.33], 10), [3.33, 3.34, 3.33])
igual('descuento = sub-total: cada línea se lleva su base', repartirDescuento([33.33, 20.01, 0.05], 53.39), [33.33, 20.01, 0.05])
igual('un centavo entre dos líneas iguales: lo lleva la primera (0.005 sube a 0.01)', repartirDescuento([10, 10], 0.01), [0.01, 0])
igual('un descuento mayor que el sub-total se acota al sub-total', repartirDescuento([60, 40], 500), [60, 40])

// ---------------------------------------------------------------------------
console.log('\ndescuentoAplicable')
igual('negativo → 0', descuentoAplicable(1000, -5), 0)
igual('con 3 decimales se redondea a centavos', descuentoAplicable(1000, 12.345), 12.35)
igual('mayor que el sub-total → el sub-total', descuentoAplicable(100, 150), 100)
igual('sin sub-total → 0', descuentoAplicable(0, 20), 0)
igual('NaN → 0', descuentoAplicable(100, Number.NaN), 0)

console.log('\nporcentaje ↔ monto')
igual('10% de 59,400 = 5,940', descuentoDePorcentaje(59400, 10), 5940)
igual('7.5% de 1,234.56 = 92.59 (92.592 a centavos)', descuentoDePorcentaje(1234.56, 7.5), 92.59)
igual('0.5% de 33.33 = 0.17 (0.16665 a centavos)', descuentoDePorcentaje(33.33, 0.5), 0.17)
igual('el % se acota a 0–100', [descuentoDePorcentaje(200, 150), descuentoDePorcentaje(200, -3)], [200, 0])
igual('% de un sub-total en 0', descuentoDePorcentaje(0, 10), 0)
igual('5,940 de 59,400 = 10%', porcentajeDeDescuento(59400, 5940), 10)
igual('92.59 de 1,234.56 = 7.5 (7.4999…)', porcentajeDeDescuento(1234.56, 92.59), 7.5)
igual('sin sub-total → 0%', porcentajeDeDescuento(0, 5), 0)

// ---------------------------------------------------------------------------
console.log('\nporcentajeDeLinea: el % que hace que montosLinea dé el monto repartido')
{
  // 10% limpio: 2 decimales alcanzan.
  igual('10% sobre 1 × 1000', porcentajeDeLinea(1, 1000, 100), 10)
  // El descuento se calcula sobre cantidad × precio SIN redondear (3 × 84.7458 = 254.2374).
  const pct = porcentajeDeLinea(3, 84.7458, 7.77)
  chk(`7.77 sobre 3 × 84.7458 sale con ${pct}%`, montosLinea({ cant: 3, precio: 84.7458, desc: pct, indFact: 1 }, false).descuentoMonto === 7.77)
  igual('un monto en 0 no pide descuento', porcentajeDeLinea(2, 50, 0), 0)
  igual('línea en 0 no pide descuento', porcentajeDeLinea(0, 50, 5), 0)
  igual('el monto de toda la línea es 100%', porcentajeDeLinea(2, 50, 100), 100)
}

// ---------------------------------------------------------------------------
console.log('\ntotalesFerreteria con descuento: casos hechos a mano')
{
  // La captura de pantalla: 600 × 99.00 = 59,400.00; ITBIS 18% = 10,692.00; TOTAL 70,092.00.
  const base = totalesFerreteria([l(600, 99)], SIN)
  igual('sin descuento la captura da lo de siempre', [base.subtotal, base.itbis, base.total, base.descuento, base.subtotalNeto],
    [59400, 10692, 70092, 0, 59400])

  // 10% (5,940.00): ITBIS sobre 53,460.00 → 9,622.80; TOTAL 63,082.80.
  const t = totalesFerreteria([l(600, 99)], { ...SIN, descuento: 5940 })
  igual('con 5,940 de descuento: sub-total, descuento y neto', [t.subtotal, t.descuento, t.subtotalNeto], [59400, 5940, 53460])
  igual('el ITBIS se calcula sobre el neto (53,460 × 18%)', t.itbis, 9622.8)
  igual('TOTAL = neto + ITBIS', t.total, 63082.8)
  igual('la línea sigue mostrando su valor sin descuento', t.lineas, [{ base: 59400, itbis: 10692 }])
  igual('"ITBIS 18%" se conserva', t.etiquetaItbis, 'ITBIS 18%')
  igual('sin retención ni abono no hay Restante', [t.retencion, t.abono, t.mostrarRestante], [0, 0, false])

  // Cargos después del ITBIS, sin ITBIS y sin tocar el descuento.
  const c = totalesFerreteria([l(600, 99)], { ...SIN, descuento: 5940, cargosBancarios: 100 })
  igual('cargos se suman después del ITBIS: 63,082.80 + 100', c.total, 63182.8)

  // Retención 5% sobre el Sub-total NETO: 2,673.00 (no 2,970.00); adeudado 60,509.80.
  const r = totalesFerreteria([l(600, 99)], { ...SIN, descuento: 5940, cargosBancarios: 100, retencion: true, abono: 500 })
  igual('retención sobre el neto (53,460 × 5%)', r.retencion, 2673)
  igual('adeudado = TOTAL − retención', r.adeudado, 60509.8)
  igual('restante = adeudado − abono', r.restante, 60009.8)
  igual('con retención o abono se muestra el Restante', r.mostrarRestante, true)

  // Tasas mezcladas: 1,000 al 18%, 500 al 16%, 200 exenta; 170 de descuento (10%).
  // Reparto 100 / 50 / 20 → netos 900 / 450 / 180 → ITBIS 162 + 72 + 0 = 234.
  const m = totalesFerreteria([l(1, 1000, 1), l(1, 500, 2), l(1, 200, 4)], { ...SIN, descuento: 170 })
  igual('tasas mezcladas: neto 1,530', m.subtotalNeto, 1530)
  igual('tasas mezcladas: ITBIS 234 (cada tasa sobre su parte rebajada)', m.itbis, 234)
  igual('tasas mezcladas: TOTAL 1,764', m.total, 1764)
  igual('con tasas mezcladas el rótulo es "ITBIS"', m.etiquetaItbis, 'ITBIS')

  // Centavos: 3 × 33.33 al 18% y 10.00 de descuento → netos 30.00 / 29.99 / 30.00.
  const c3 = totalesFerreteria([l(1, 33.33), l(1, 33.33), l(1, 33.33)], { ...SIN, descuento: 10 })
  igual('3 × 33.33 con 10.00: neto 89.99', c3.subtotalNeto, 89.99)
  igual('3 × 33.33 con 10.00: ITBIS 5.40 + 5.40 + 5.40 = 16.20', c3.itbis, 16.2)
  igual('3 × 33.33 con 10.00: TOTAL 106.19', c3.total, 106.19)

  // Redondeo de producción (PHP ≤ 8.3, mitad hacia arriba sobre el decimal): 84.75 × 18% = 15.255 → 15.26.
  igual('sin descuento 84.75 da ITBIS 15.26', totalesFerreteria([l(1, 84.75)], SIN).itbis, 15.26)
  const h = totalesFerreteria([l(1, 84.75)], { ...SIN, descuento: 0.05 })
  igual('con 0.05 de descuento: neto 84.70 y ITBIS 15.25 (15.246)', [h.subtotalNeto, h.itbis, h.total], [84.7, 15.25, 99.95])

  // Descuento de más: se acota al Sub-total (la pantalla nunca muestra un total negativo).
  const a = totalesFerreteria([l(1, 100)], { ...SIN, descuento: 150, cargosBancarios: 10 })
  igual('descuento mayor que el sub-total: se aplica el sub-total', [a.descuento, a.subtotalNeto, a.itbis, a.total], [100, 0, 0, 10])
  igual('descuento negativo: no sube el total', totalesFerreteria([l(1, 100)], { ...SIN, descuento: -20 }).total, 118)
  igual('descuento con 3 decimales: se redondea a centavos', totalesFerreteria([l(1, 100)], { ...SIN, descuento: 10.005 }).descuento, 10.01)
}

// ---------------------------------------------------------------------------
// Referencia aparte, en enteros: centavos para los montos y milésimas de punto
// para las tasas. Mitad hacia arriba, igual que el redondeo de producción.
console.log('\ntotalesFerreteria con descuento: 1,500 casos al azar contra una referencia en enteros')
{
  // Generador con semilla (mulberry32): el mismo resultado en cada corrida.
  let s = 20261117
  const azar = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))

  const mitadArriba = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den) // num, den > 0
  const TASA_BP: Record<number, bigint> = { 1: 1800n, 2: 1600n, 3: 0n, 4: 0n }

  let casos = 0
  let malos = 0
  let primerMalo = ''
  for (let i = 0; i < 1500; i++) {
    const n = entre(1, 6)
    const lineas: LineaFerreteria[] = []
    const centavosCant: bigint[] = []
    const diezmilPrecio: bigint[] = []
    const inds: number[] = []
    for (let k = 0; k < n; k++) {
      const cantC = entre(1, 5000) // 0.01 … 50.00
      const precioM = entre(1, 5_000_000) // 0.0001 … 500.0000
      const ind = entre(1, 4)
      lineas.push({ cantidad: cantC / 100, precio: precioM / 10000, indFact: ind })
      centavosCant.push(BigInt(cantC))
      diezmilPrecio.push(BigInt(precioM))
      inds.push(ind)
    }
    // Base de cada línea en centavos: cantidad (centésimas) × precio (diezmilésimas) / 10,000.
    const bases = centavosCant.map((q, k) => mitadArriba(q * diezmilPrecio[k], 10000n))
    const S = bases.reduce((a, b) => a + b, 0n)
    // 0 con cierta frecuencia, el sub-total entero a veces y el resto en medio.
    const modo = azar()
    const D = S === 0n || modo < 0.1 ? 0n : modo < 0.2 ? S : BigInt(entre(1, Number(S)))

    // Reparto acumulado: hasta_i = round(D × acumulado_i / S).
    let acum = 0n
    let hechoPrev = 0n
    const netos: bigint[] = []
    for (let k = 0; k < n; k++) {
      acum += bases[k]
      const hasta = S === 0n ? 0n : mitadArriba(D * acum, S)
      netos.push(bases[k] - (hasta - hechoPrev))
      hechoPrev = hasta
    }
    const itbis = netos.reduce((a, neto, k) => a + mitadArriba(neto * TASA_BP[inds[k]], 10000n), 0n)
    const neto = S - D
    const totalRef = neto + itbis

    const t = totalesFerreteria(lineas, { ...SIN, descuento: Number(D) / 100 })
    const cent = (x: number) => BigInt(Math.round(x * 100))
    const ok = cent(t.subtotal) === S && cent(t.descuento) === D && cent(t.subtotalNeto) === neto
      && cent(t.itbis) === itbis && cent(t.total) === totalRef
    casos++
    if (!ok) {
      malos++
      if (!primerMalo) {
        primerMalo = `líneas ${JSON.stringify(lineas)} D=${D}: dio sub ${t.subtotal} desc ${t.descuento} neto ${t.subtotalNeto} itbis ${t.itbis} total ${t.total}; ref S=${S} neto=${neto} itbis=${itbis} total=${totalRef}`
      }
    }

    // El reparto en sí: suma exacta, cada parte entre 0 y su base.
    const partes = repartirDescuento(lineas.map((_, k) => Number(bases[k]) / 100), Number(D) / 100)
    const suma = partes.reduce((a, p) => a + cent(p), 0n)
    const dentro = partes.every((p, k) => cent(p) >= 0n && cent(p) <= bases[k])
    if (suma !== D || !dentro) {
      malos++
      if (!primerMalo) primerMalo = `reparto de ${D} entre ${JSON.stringify(bases.map(String))}: ${JSON.stringify(partes)}`
    }
  }
  chk(`${casos} casos: totales y reparto iguales a la referencia en enteros${malos ? ` (${malos} distintos; primero: ${primerMalo})` : ''}`, malos === 0)
}

// ---------------------------------------------------------------------------
console.log('\nSin descuento nada cambia')
{
  const lineas = [l(7, 2000), l(1, 1000, 2), l(2.5, 13.7, 3), l(3, 84.7458, 4)]
  const sinD = totalesFerreteria(lineas, SIN)
  const conCero = totalesFerreteria(lineas, { ...SIN, descuento: 0 })
  igual('descuento 0: neto = sub-total', [sinD.descuento, sinD.subtotalNeto === sinD.subtotal], [0, true])
  igual('descuento 0 es igual a no tenerlo', conCero, sinD)
  // ITBIS sin descuento = suma del ITBIS de cada línea (lo de siempre).
  igual('ITBIS = Σ ITBIS por línea', sinD.itbis, r2(sinD.lineas.reduce((a, x) => a + x.itbis, 0)))
}

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)

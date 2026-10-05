// Notas de crédito y débito vinculadas a una factura (listado y detalle): qué
// línea va bajo el e-NCF, los montos con signo (la nota de crédito resta), el
// propósito de cada nota y las filas de "Comprobantes relacionados". Las filas
// son como las de GET /api/facturas: PDO manda los INT y los DECIMAL como texto.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-notas-vinculadas.ts
import type { FacturaRow } from '../src/api/types.ts'
import {
  anuladaPor, conSigno, filasRelacionadas, lineasVinculo, modificaDeFila, montoTotalKpi, notasDeFila,
  propositoNota, sumaConSigno, tipoNotaLabel,
} from '../src/features/invoices/notasVinculadas.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves.
const ordenar = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
      : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

// --- Filas de la API -------------------------------------------------------
// El caso que originó esto: E440000000001 anulada por completo con E340000000001.
const original = {
  id: 5, tipo_ecf: '44', e_ncf: 'E440000000001', total: '82200.00',
  notas: [
    { id: '9', e_ncf: 'E340000000001', tipo_ecf: '34', codigo_modificacion: '1', total: '82200.00',
      estado_dgii: 'ACEPTADO', date: '2026-09-30 10:00:00' },
  ],
  modifica: null,
} as unknown as FacturaRow
const nota = {
  id: 9, tipo_ecf: '34', e_ncf: 'E340000000001', total: '82200.00', codigo_modificacion: '1',
  ncf_modificado: 'E440000000001',
  notas: [],
  modifica: { id: '5', e_ncf: 'E440000000001', tipo_ecf: '44', total: '82200.00', date: '2026-09-29 08:00:00' },
} as unknown as FacturaRow

console.log('notasDeFila / modificaDeFila (texto de PDO -> números)')
igual('nota: id y total pasan a número, código y estado se conservan', notasDeFila(original), [
  { id: 9, ncf: 'E340000000001', tipo: '34', codigoModificacion: '1', total: 82200, estadoDgii: 'ACEPTADO',
    fecha: '2026-09-30 10:00:00' },
])
igual('backend viejo (sin "notas") -> []', notasDeFila({ id: 1 } as FacturaRow), [])
igual('notas null -> []', notasDeFila({ id: 1, notas: null } as unknown as FacturaRow), [])
igual('código vacío o nulo -> null; código numérico -> texto', notasDeFila({
  id: 1,
  notas: [
    { id: 2, e_ncf: 'E340000000002', tipo_ecf: '34', codigo_modificacion: '', total: '1.50', estado_dgii: 'ENVIADO', date: null },
    { id: 3, e_ncf: 'E330000000001', tipo_ecf: '33', codigo_modificacion: 3, total: 10, estado_dgii: 'ACEPTADO', date: null },
  ],
} as unknown as FacturaRow).map((n) => n.codigoModificacion), [null, '3'])
igual('modifica: id y total pasan a número', modificaDeFila(nota), {
  id: 5, ncf: 'E440000000001', tipo: '44', total: 82200, fecha: '2026-09-29 08:00:00',
})
igual('modifica de un NCF que no está en facturas (papel): id/tipo/total null', modificaDeFila({
  id: 1, modifica: { id: null, e_ncf: 'B0100000123', tipo_ecf: null, total: null, date: null },
} as unknown as FacturaRow), { id: null, ncf: 'B0100000123', tipo: null, total: null, fecha: null })
igual('sin modifica (o backend viejo) -> null', [
  modificaDeFila({ id: 1 } as FacturaRow), modificaDeFila({ id: 1, modifica: null } as FacturaRow),
], [null, null])

// Atajos para los casos de las líneas.
type N = ReturnType<typeof notasDeFila>[number]
const n = (id: number, tipo: string, codigo: string | null, ncf: string, total = 100): N => ({
  id, ncf, tipo, codigoModificacion: codigo, total, estadoDgii: 'ACEPTADO', fecha: null,
})
const mod = (ncf: string) => ({ id: 5, ncf, tipo: '44', total: 82200, fecha: null })

console.log('lineasVinculo (bajo el e-NCF del listado)')
igual('anulada por una nota de crédito con código 1 (tono danger)',
  lineasVinculo({ notas: notasDeFila(original), modifica: null }),
  [{ texto: 'Anulada por E340000000001', tono: 'danger' }])
igual('la anulación gana aunque no sea la primera nota, con " +N" por las demás',
  lineasVinculo({ notas: [n(3, '33', '3', 'E330000000001'), n(9, '34', '1', 'E340000000001')] }),
  [{ texto: 'Anulada por E340000000001 +1', tono: 'danger' }])
igual('nota de crédito que no anula (código 3): la primera nota, tono muted',
  lineasVinculo({ notas: [n(4, '34', '3', 'E340000000002')] }),
  [{ texto: 'Nota de crédito E340000000002', tono: 'muted' }])
igual('nota de débito',
  lineasVinculo({ notas: [n(6, '33', '3', 'E330000000001')] }),
  [{ texto: 'Nota de débito E330000000001', tono: 'muted' }])
igual('una nota de débito con código 1 no es anulación',
  lineasVinculo({ notas: [n(6, '33', '1', 'E330000000001')] }),
  [{ texto: 'Nota de débito E330000000001', tono: 'muted' }])
igual('primera nota y " +2" por las otras dos',
  lineasVinculo({ notas: [n(4, '34', '3', 'E340000000002'), n(6, '33', '3', 'E330000000001'), n(7, '34', '2', 'E340000000003')] }),
  [{ texto: 'Nota de crédito E340000000002 +2', tono: 'muted' }])
igual('fila de una nota: "Modifica <e-NCF>"',
  lineasVinculo({ notas: [], modifica: mod('E440000000001') }),
  [{ texto: 'Modifica E440000000001', tono: 'muted' }])
igual('nota que a su vez tiene notas: primero su "Modifica", luego la otra línea',
  lineasVinculo({ notas: [n(12, '33', '3', 'E330000000004')], modifica: mod('E310000000007') }),
  [{ texto: 'Modifica E310000000007', tono: 'muted' }, { texto: 'Nota de débito E330000000004', tono: 'muted' }])
igual('sin relaciones -> ninguna línea', lineasVinculo({}), [])
igual('anuladaPor: la nota de crédito código 1, o null',
  [anuladaPor([n(3, '33', '3', 'A'), n(9, '34', '1', 'B')])?.ncf ?? null, anuladaPor([n(4, '34', '3', 'C')])],
  ['B', null])

console.log('conSigno / sumaConSigno (la nota de crédito resta)')
igual('E34 en texto "82200.00" -> -82200', conSigno('34', '82200.00'), -82200)
igual('E31/E33 conservan el signo', [conSigno('31', '82200.00'), conSigno('33', 100)], [82200, 100])
igual('nulo o no numérico -> 0', [conSigno('34', null), conSigno(undefined, 'abc'), conSigno('31', undefined)], [0, 0, 0])
chk('E34 en cero da 0, no -0 (Money pintaría "−0.00")', Object.is(conSigno('34', '0.00'), 0))
igual('la factura anulada y su nota se cancelan en el total de la página', sumaConSigno([
  { tipo: '44', total: 82200, itbis: 0 },
  { tipo: '34', total: 82200, itbis: 0 },
  { tipo: '31', total: 118, itbis: 18 },
]), { total: 118, itbis: 18 })
igual('el ITBIS de la nota de crédito también resta', sumaConSigno([
  { tipo: '31', total: 1180, itbis: 180 },
  { tipo: '34', total: 590, itbis: 90 },
]), { total: 590, itbis: 90 })
const cero = sumaConSigno([{ tipo: '31', total: 0.1, itbis: 0 }, { tipo: '31', total: 0.2, itbis: 0 }, { tipo: '34', total: 0.3, itbis: 0 }])
chk(`0.1 + 0.2 − 0.3 da 0 exacto (dio ${cero.total})`, Object.is(cero.total, 0))
igual('página vacía', sumaConSigno([]), { total: 0, itbis: 0 })

console.log('montoTotalKpi')
igual('usa monto_neto cuando viene (texto de PDO)', montoTotalKpi({ monto_total: '164400.00', monto_neto: '15000.50' }, 999), 15000.5)
igual('monto_neto en 0 es un valor, no ausencia', montoTotalKpi({ monto_total: 164400, monto_neto: 0 }, 999), 0)
igual('backend viejo (sin monto_neto): monto_total menos los rechazados', montoTotalKpi({ monto_total: '164400.00' }, 400), 164000)
igual('monto_neto null: misma fórmula vieja', montoTotalKpi({ monto_total: 1000, monto_neto: null }, 100), 900)
igual('sin stats todavía', montoTotalKpi(null, 0), 0)

console.log('propositoNota / tipoNotaLabel')
igual('códigos 1-5', ['1', '2', '3', '4', '5'].map(propositoNota), [
  'Anula', 'Corrige texto', 'Corrige montos', 'Reemplazo de contingencia', 'Referencia a factura de consumo',
])
igual('código nulo o desconocido -> ""', [propositoNota(null), propositoNota(undefined), propositoNota('9')], ['', '', ''])
igual('tipos de nota', [tipoNotaLabel('34'), tipoNotaLabel('33'), tipoNotaLabel('31')], ['Nota de crédito', 'Nota de débito', ''])

console.log('filasRelacionadas (tarjeta del detalle)')
igual('original: una fila por nota, con propósito, monto con signo y estado DGII',
  filasRelacionadas({ notas: notasDeFila(original), modifica: null, codigoModificacion: null }), [
    { clave: 'nota-9', id: 9, ncf: 'E340000000001', relacion: 'Nota de crédito', tipo: '34', proposito: 'Anula',
      monto: -82200, estadoDgii: 'ACEPTADO', fecha: '2026-09-30 10:00:00' },
  ])
igual('nota: la fila "Modifica" lleva el propósito de la propia nota y va primero',
  filasRelacionadas({
    notas: [n(12, '33', '3', 'E330000000004', 50)],
    modifica: modificaDeFila(nota),
    codigoModificacion: '1',
  }), [
    { clave: 'modifica', id: 5, ncf: 'E440000000001', relacion: 'Modifica', tipo: '44', proposito: 'Anula',
      monto: 82200, estadoDgii: null, fecha: '2026-09-29 08:00:00' },
    { clave: 'nota-12', id: 12, ncf: 'E330000000004', relacion: 'Nota de débito', tipo: '33', proposito: 'Corrige montos',
      monto: 50, estadoDgii: 'ACEPTADO', fecha: null },
  ])
igual('modifica de papel: sin id ni monto',
  filasRelacionadas({ modifica: { id: null, ncf: 'B0100000123', tipo: null, total: null, fecha: null }, codigoModificacion: '3' }), [
    { clave: 'modifica', id: null, ncf: 'B0100000123', relacion: 'Modifica', tipo: null, proposito: 'Corrige montos',
      monto: null, estadoDgii: null, fecha: null },
  ])
igual('sin relaciones -> sin filas (la tarjeta no se muestra)', filasRelacionadas({ notas: [] }), [])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)

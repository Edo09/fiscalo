// lib/totales: los totales salen de `montosLinea` y `totalesDocumento` (los del servidor), con precio NETO y el ITBIS encima.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { IndFact, LineaCarrito } from '~/lib/carrito'
import { resumenTotales } from '~/lib/totales'

let n = 0
const linea = (cant: number, precio: number, p: Partial<LineaCarrito> = {}): LineaCarrito => ({
  id: ++n,
  nombre: 'Algo',
  cant,
  precio,
  desc: 0,
  indFact: 1 as IndFact,
  tipoItem: 2,
  unidad: '43',
  ...p,
})

test('1 x 5000 mas 2 x 2500 al 18 % da subtotal 10000, ITBIS 1800 y total 11800', () => {
  const r = resumenTotales([linea(1, 5000), linea(2, 2500)])
  assert.deepEqual([r.subtotal, r.itbis, r.total, r.descuentos], [10000, 1800, 11800, 0])
  assert.deepEqual(r.itbisPorTasa, [{ indFact: 1, etiqueta: 'ITBIS 18%', monto: 1800 }])
})

test('exento 1000 mas 18 % 2000: ITBIS 360, total 3360 y una sola fila de tasa', () => {
  const r = resumenTotales([linea(1, 1000, { indFact: 4 }), linea(1, 2000)])
  assert.deepEqual([r.itbis, r.total], [360, 3360])
  assert.equal(r.itbisPorTasa.length, 1)
})

test('una línea al 16 % y otra al 18 % dan dos filas que suman el ITBIS del documento', () => {
  const r = resumenTotales([linea(1, 1000, { indFact: 2 }), linea(1, 3333.33)])
  assert.deepEqual(r.itbisPorTasa.map((f) => f.etiqueta), ['ITBIS 18%', 'ITBIS 16%'])
  const suma = r.itbisPorTasa.reduce((s, f) => s + f.monto, 0)
  assert.ok(Math.abs(suma - r.itbis) < 0.005)
})

test('84.75 al 18 % da ITBIS 15.26 (el redondeo de PHP 8.3, no 15.25)', () => {
  assert.equal(resumenTotales([linea(1, 84.75)]).itbis, 15.26)
})

test('10 % de descuento sobre 2 x 500: descuento 100, base 900, ITBIS 162 y total 1062', () => {
  const r = resumenTotales([linea(2, 500, { desc: 10 })])
  assert.equal(r.lineas[0].descuentoMonto, 100)
  assert.deepEqual([r.subtotal, r.descuentos, r.itbis, r.total], [900, 100, 162, 1062])
})

test('sin líneas todo es cero y no hay filas de ITBIS', () => {
  const r = resumenTotales([])
  assert.deepEqual([r.subtotal, r.itbis, r.total, r.itbisPorTasa.length], [0, 0, 0, 0])
})

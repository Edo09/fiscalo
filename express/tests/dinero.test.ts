// lib/dinero: pesos dominicanos como se leen en pantalla, `RD$ 11,800.00`. Miles con coma y decimales con punto (es-DO); el signo de un negativo
// va delante de la moneda.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rd, rd0 } from '~/lib/dinero'

test('rd y rd0', () => {
  assert.equal(rd(11800), 'RD$ 11,800.00')
  assert.equal(rd(-11800), '-RD$ 11,800.00')
  assert.equal(rd(0), 'RD$ 0.00')
  assert.equal(rd0(23600), 'RD$ 23,600')
  assert.equal(rd0(184250.4), 'RD$ 184,250')
})

test('rd siempre lleva dos decimales y agrupa los miles', () => {
  assert.equal(rd(1234.5), 'RD$ 1,234.50')
  assert.equal(rd(1234.567), 'RD$ 1,234.57')
  assert.equal(rd(0.1 + 0.2), 'RD$ 0.30') // el ruido binario no se ve
  assert.equal(rd(7), 'RD$ 7.00')
  assert.equal(rd(1_000_000), 'RD$ 1,000,000.00')
  assert.equal(rd(-0.01), '-RD$ 0.01')
  assert.equal(rd(-1234.5), '-RD$ 1,234.50')
})

test('rd0 redondea al peso, agrupa los miles y no lleva decimales', () => {
  assert.equal(rd0(0), 'RD$ 0')
  assert.equal(rd0(999.5), 'RD$ 1,000')
  assert.equal(rd0(1234567.89), 'RD$ 1,234,568')
  assert.equal(rd0(-1234.6), '-RD$ 1,235')
  assert.equal(rd0(-23600), '-RD$ 23,600')
})

test('un negativo que se ve como cero no lleva signo: nunca «-RD$ 0.00»', () => {
  assert.equal(rd(-0), 'RD$ 0.00') // `Intl` escribe -0 como «-0.00»
  assert.equal(rd(-0.004), 'RD$ 0.00')
  assert.equal(rd0(-0), 'RD$ 0')
  assert.equal(rd0(-0.4), 'RD$ 0')
  assert.equal(rd(0.004), 'RD$ 0.00')
})

test('lo que manda el API como texto se lee, y lo que no es un número se ve como cero (aNumero)', () => {
  assert.equal(rd('11800.00' as unknown as number), 'RD$ 11,800.00') // los DECIMAL de MySQL llegan como texto
  assert.equal(rd('-84.7500' as unknown as number), '-RD$ 84.75')
  assert.equal(rd0('23600.00' as unknown as number), 'RD$ 23,600')
  for (const v of [NaN, Infinity, -Infinity, null, undefined, '', 'abc']) {
    assert.equal(rd(v as unknown as number), 'RD$ 0.00', String(v))
    assert.equal(rd0(v as unknown as number), 'RD$ 0', String(v))
  }
})

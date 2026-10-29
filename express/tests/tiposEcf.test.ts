// lib/tiposEcf: lo que Express sabe de los tipos de comprobante (contratos 4.4). Se vende E31 (crédito fiscal), E32 (consumo) y E45
// (gubernamental); E33 y E34 (notas de débito y de crédito) existen en las filas y los detalles pero el asistente de ventas no las emite.
import assert from 'node:assert/strict'
import test from 'node:test'
import { esTipoDeVenta, exigeComprador, nombreTipo, permiteCredito, tituloNuevaFactura, UMBRAL_CONSUMO } from '~/lib/tiposEcf'

test('tiposEcf', () => {
  assert.ok(exigeComprador('31', 1) && exigeComprador('45', 1))
  assert.equal(exigeComprador('32', 249999.99), false)
  assert.equal(exigeComprador('32', 250000), true)
  assert.ok(permiteCredito('31') && permiteCredito('45') && !permiteCredito('32'))
  assert.deepEqual(['31', '32', '45', '33', '34', '41'].map(esTipoDeVenta), [true, true, true, false, false, false])
  assert.equal(tituloNuevaFactura('45'), 'Nueva factura E45')
})

test('el umbral del consumo es 250000 y alcanza desde ahí, no desde el centavo siguiente', () => {
  assert.equal(UMBRAL_CONSUMO, 250000)
  assert.equal(exigeComprador('32', UMBRAL_CONSUMO - 0.01), false)
  assert.equal(exigeComprador('32', UMBRAL_CONSUMO), true)
  assert.equal(exigeComprador('32', UMBRAL_CONSUMO + 0.01), true)
  assert.equal(exigeComprador('32', 0), false) // un consumo pequeño no necesita comprador
  assert.equal(exigeComprador('32', 1_000_000), true)
})

test('E31 y E45 piden comprador y permiten crédito sea cual sea el total', () => {
  for (const total of [0.01, 1, 249999.99, 250000, 5_000_000]) {
    assert.equal(exigeComprador('31', total), true, `E31 ${total}`)
    assert.equal(exigeComprador('45', total), true, `E45 ${total}`)
  }
  assert.equal(permiteCredito('31'), true)
  assert.equal(permiteCredito('45'), true)
  assert.equal(permiteCredito('32'), false) // el consumo es de contado
})

test('un código que Express no vende es estricto: pide comprador, no permite crédito y no es de venta', () => {
  for (const codigo of ['33', '34', '41', '43', '44', '46', '47', '99', '', 'E45']) {
    assert.equal(esTipoDeVenta(codigo), false, `esTipoDeVenta ${JSON.stringify(codigo)}`)
    assert.equal(permiteCredito(codigo), false, `permiteCredito ${JSON.stringify(codigo)}`)
    assert.equal(exigeComprador(codigo, 1), true, `exigeComprador ${JSON.stringify(codigo)}`)
  }
})

test('tituloNuevaFactura: «Nueva factura» y el código con la E', () => {
  assert.equal(tituloNuevaFactura('45'), 'Nueva factura E45')
  assert.equal(tituloNuevaFactura('31'), 'Nueva factura E31')
  assert.equal(tituloNuevaFactura('32'), 'Nueva factura E32')
})

test('nombreTipo: el nombre de cada comprobante, y E más el código si no se conoce', () => {
  assert.equal(nombreTipo('45'), 'Gubernamental')
  assert.equal(nombreTipo('31'), 'Crédito fiscal')
  assert.equal(nombreTipo('32'), 'Consumo')
  assert.equal(nombreTipo('34'), 'Nota de crédito')
  assert.equal(nombreTipo('33'), 'Nota de débito')
  assert.equal(nombreTipo('41'), 'E41')
  // Los nombres no se buscan en un objeto: un código que es una propiedad de Object.prototype no puede devolver una función.
  for (const raro of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(nombreTipo(raro), `E${raro}`, raro)
})

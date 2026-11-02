// lib/sondeo: cada cuánto se le pregunta a la DGII por una factura que no está en un estado final (anexo 12.6): a los 5, 10, 20 y 40 segundos y luego cada 60, hasta unos
// cinco minutos. La pantalla pide el siguiente plazo con la cuenta de las consultas que ya hizo; cuando ya no hay plazo, deja de preguntar.
import assert from 'node:assert/strict'
import test from 'node:test'
import { SONDEO_MS, siguienteSondeoMs } from '~/lib/sondeo'

test('siguienteSondeoMs', () => {
  assert.equal(siguienteSondeoMs(0), 5000)
  assert.equal(siguienteSondeoMs(3), 40000)
  assert.equal(siguienteSondeoMs(4), 60000)
  assert.equal(siguienteSondeoMs(7), 60000)
  assert.equal(siguienteSondeoMs(8), null)
  assert.equal(siguienteSondeoMs(-1), 5000)
})

test('SONDEO_MS: 5, 10, 20 y 40 segundos y luego cuatro de 60, unos cinco minutos en total', () => {
  assert.deepEqual([...SONDEO_MS], [5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000])
  assert.equal(
    SONDEO_MS.reduce((suma, ms) => suma + ms, 0),
    315_000, // 5 min 15 s: «unos cinco minutos»
  )
  for (let i = 1; i < SONDEO_MS.length; i++) assert.ok(SONDEO_MS[i] >= SONDEO_MS[i - 1], `el plazo ${i} no baja`) // retroceso: nunca se pregunta más seguido con el tiempo
  assert.ok(SONDEO_MS.every((ms) => ms >= 5000), 'ningún plazo baja de 5 s: cada consulta puede ser hasta tres llamadas a la DGII')
})

test('siguienteSondeoMs recorre SONDEO_MS en orden y, pasado el último plazo, no hay más', () => {
  const recorrido: (number | null)[] = []
  for (let intento = 0; intento < SONDEO_MS.length + 3; intento++) recorrido.push(siguienteSondeoMs(intento))
  assert.deepEqual(recorrido, [...SONDEO_MS, null, null, null])
  assert.equal(siguienteSondeoMs(SONDEO_MS.length - 1), 60000)
  assert.equal(siguienteSondeoMs(SONDEO_MS.length), null)
  assert.equal(siguienteSondeoMs(1000), null)
})

test('un intento que no es un entero no cuenta de más: se lee como su parte entera, y lo que no es un número no hace preguntar', () => {
  assert.equal(siguienteSondeoMs(0.9), 5000) // todavía no se hizo la primera consulta completa
  assert.equal(siguienteSondeoMs(2.5), 20000)
  assert.equal(siguienteSondeoMs(7.9), 60000)
  assert.equal(siguienteSondeoMs(8.1), null)
  assert.equal(siguienteSondeoMs(-0.5), 5000)
  assert.equal(siguienteSondeoMs(-1000), 5000) // un contador que se pasó por debajo vuelve al primer plazo
  assert.equal(siguienteSondeoMs(-Infinity), 5000)
  assert.equal(siguienteSondeoMs(Infinity), null)
  assert.equal(siguienteSondeoMs(NaN), null) // sin una cuenta que valga no se pregunta: cada consulta le cuesta llamadas a la DGII
})

test('SONDEO_MS no se puede cambiar: es de toda la app', () => {
  assert.throws(() => (SONDEO_MS as number[]).push(1000), TypeError)
  assert.throws(() => {
    ;(SONDEO_MS as number[])[0] = 1
  }, TypeError)
  assert.equal(siguienteSondeoMs(0), 5000)
  assert.equal(SONDEO_MS.length, 8)
})

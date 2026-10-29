// lib/numeracion: el estado de la numeración de un tipo de comprobante (anexo 6.12, D20). Gana la primera regla que coincide: agotada, sin rango, sin límite
// (pruebas), vence pronto (7 días), pocos (50 o menos), por vencer (30 días) y vigente. Los días se cuentan con `diasHasta` (días enteros sobre el
// calendario) y `hoy` es un dato que se pasa, así que el resultado no depende de la zona del teléfono (Review Focus 5).
import assert from 'node:assert/strict'
import test from 'node:test'
import { conZona } from './ayudas'
import type { Ambiente } from '~/entitlements'
import { estadoNumeracion } from '~/lib/numeracion'
import type { EstadoNumeracion, RangoNcf, SecuenciaStats } from '~/lib/numeracion'

const H = '2026-10-27'

/** Una fila de `stats.secuencias`: lo que quedan, lo emitido y, si hay, el vencimiento. */
const S = (restantes: number | string | null | undefined, emitidos: number | string, vencimiento?: string | null): SecuenciaStats => ({
  type: 'E45',
  total_emitidos: emitidos,
  restantes,
  vencimiento,
})

/** Una fila de GET /api/ncf/rangos (el rango arranca en 1): hasta dónde llega, el último número asignado y, si hay, su vencimiento. */
const R = (hasta: number | string | null, actual: number | string, vencimiento?: string | null): RangoNcf => ({
  id: 4,
  type: 'E45',
  numero_desde: 1,
  numero_hasta: hasta,
  current_value: actual,
  fecha_vencimiento: vencimiento,
})

test('estadoNumeracion: el primero que coincide gana', () => {
  assert.equal(estadoNumeracion(S(0, 5), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S(0, 0), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S(null, 5), 'ecf', H), 'sinRango')
  for (const a of ['testecf', 'certecf'] as const) assert.equal(estadoNumeracion(S(null, 5), a, H), 'sinLimite')
  assert.equal(estadoNumeracion(S(10, 5, '2026-11-03'), 'ecf', H), 'vencePronto')
  assert.equal(estadoNumeracion(S(10, 5, '2026-11-04'), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S(50, 5), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S(51, 5), 'ecf', H), 'vigente')
  assert.equal(estadoNumeracion(S(100, 5, '2026-11-26'), 'ecf', H), 'porVencer')
  assert.equal(estadoNumeracion(S(100, 5, '2026-11-27'), 'ecf', H), 'vigente')
  assert.equal(estadoNumeracion(S('312', 5), 'ecf', H), 'vigente')
  assert.equal(estadoNumeracion(S(1, 1), 'ecf', H, { numero_hasta: 500, current_value: 188 } as any), 'vigente')
})

// --- los límites de cada regla -------------------------------------------------------------------------------------------------------

test('los límites: 50 restantes son pocos y 51 no; 7 días es vence pronto y 8 no; 30 días es por vencer y 31 no', () => {
  const casos: [SecuenciaStats, Ambiente, EstadoNumeracion][] = [
    [S(0, 5), 'ecf', 'agotada'],
    [S(0, 1), 'ecf', 'agotada'], // con un solo número emitido ya cuenta como «el tipo emitió»
    [S(null, 5), 'ecf', 'sinRango'],
    [S(null, 5), 'testecf', 'sinLimite'],
    [S(50, 5), 'ecf', 'pocos'],
    [S(51, 5), 'ecf', 'vigente'],
    [S(1, 5), 'ecf', 'pocos'],
    [S(100, 5, '2026-11-03'), 'ecf', 'vencePronto'], // 7 días
    [S(100, 5, '2026-11-04'), 'ecf', 'porVencer'], // 8 días
    [S(100, 5, '2026-11-26'), 'ecf', 'porVencer'], // 30 días
    [S(100, 5, '2026-11-27'), 'ecf', 'vigente'], // 31 días
    [S(100, 5, '2027-12-31'), 'ecf', 'vigente'],
    [S(100, 5, '2026-10-28'), 'ecf', 'vencePronto'], // mañana
    [S(100, 5, H), 'ecf', 'vencePronto'], // vence hoy
  ]
  for (const [secuencia, ambiente, esperado] of casos) {
    assert.equal(estadoNumeracion(secuencia, ambiente, H), esperado, `${secuencia.restantes} restantes, vence ${secuencia.vencimiento}, ${ambiente}`)
  }
  // La tabla llega a los siete estados: ninguno queda sin probar.
  assert.deepEqual([...new Set(casos.map(([, , estado]) => estado))].sort(), ['agotada', 'pocos', 'porVencer', 'sinLimite', 'sinRango', 'vencePronto', 'vigente'])
})

test('un vencimiento que ya pasó es vence pronto, no vigente', () => {
  // El API solo cuenta rangos que no han vencido, pero el reloj del teléfono puede ir un día adelante: lo vencido es lo más urgente.
  for (const v of ['2026-10-26', '2026-10-01', '2025-01-01']) assert.equal(estadoNumeracion(S(100, 5, v), 'ecf', H), 'vencePronto', v)
})

test('el vencimiento puede ser un DATETIME: cuenta el día', () => {
  assert.equal(estadoNumeracion(S(100, 5, '2026-11-03 23:59:59'), 'ecf', H), 'vencePronto')
  assert.equal(estadoNumeracion(S(100, 5, '2026-11-04 00:00:00'), 'ecf', H), 'porVencer')
})

test('un vencimiento que no es una fecha no cuenta: se juzga solo por lo que queda', () => {
  // Los tres últimos no son texto: no son lo que el API manda, y tampoco hacen lanzar a una insignia que se pinta en cada pantalla.
  for (const v of ['', '   ', 'no es una fecha', '0000-00-00', '2026-02-30', '31/12/2027', null, undefined, 20261103, true, {}]) {
    assert.equal(estadoNumeracion(S(100, 5, v as any), 'ecf', H), 'vigente', String(v))
    assert.equal(estadoNumeracion(S(10, 5, v as any), 'ecf', H), 'pocos', String(v))
    assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 188, v as any)), 'vigente', String(v))
  }
  // Y tampoco rompe con un `hoy` ilegible.
  assert.equal(estadoNumeracion(S(100, 5, '2026-10-28'), 'ecf', 'ayer'), 'vigente')
})

// --- el orden de las reglas ----------------------------------------------------------------------------------------------------------

test('el orden: agotada, sin rango o sin límite, vence pronto, pocos, por vencer, vigente', () => {
  const casos: [SecuenciaStats, Ambiente, EstadoNumeracion][] = [
    [S(0, 5, '2026-10-28'), 'ecf', 'agotada'], // agotada antes que vence pronto
    [S(0, 5), 'testecf', 'agotada'], // el ambiente no cambia lo agotado
    [S(null, 5, '2026-10-28'), 'ecf', 'sinRango'], // sin rango antes que vence pronto
    [S(null, 5, '2026-10-28'), 'certecf', 'sinLimite'], // sin límite antes que vence pronto
    [S(10, 5, '2026-10-28'), 'ecf', 'vencePronto'], // vence pronto antes que pocos
    [S(10, 5, '2026-11-20'), 'ecf', 'pocos'], // pocos antes que por vencer
    [S(0, 0, '2026-11-20'), 'ecf', 'pocos'], // sin números emitidos, un rango en cero no es «agotada»
    [S(100, 5, '2026-11-20'), 'ecf', 'porVencer'],
  ]
  for (const [secuencia, ambiente, esperado] of casos) {
    assert.equal(estadoNumeracion(secuencia, ambiente, H), esperado, `${secuencia.restantes} / ${secuencia.vencimiento} / ${ambiente}`)
  }
})

test('con restantes, el ambiente no cambia el estado', () => {
  const ambientes: Ambiente[] = ['ecf', 'certecf', 'testecf']
  for (const a of ambientes) {
    assert.equal(estadoNumeracion(S(10, 5), a, H), 'pocos', a)
    assert.equal(estadoNumeracion(S(312, 5), a, H), 'vigente', a)
    assert.equal(estadoNumeracion(S(100, 5, '2026-10-30'), a, H), 'vencePronto', a)
  }
})

test('sin restantes: sin rango en producción y sin límite en pruebas y certificación', () => {
  for (const sinDato of [null, undefined, '', '   ', 'abc', NaN, Infinity, -Infinity, 'Infinity']) {
    assert.equal(estadoNumeracion(S(sinDato, 5), 'ecf', H), 'sinRango', String(sinDato))
    assert.equal(estadoNumeracion(S(sinDato, 5), 'testecf', H), 'sinLimite', String(sinDato))
    assert.equal(estadoNumeracion(S(sinDato, 5), 'certecf', H), 'sinLimite', String(sinDato))
  }
  assert.equal(estadoNumeracion({ type: 'E34', total_emitidos: 0 }, 'ecf', H), 'sinRango') // la clave `restantes` ausente
})

// --- lo que manda el API: texto ------------------------------------------------------------------------------------------------------

test('restantes y total_emitidos llegan como texto DECIMAL y se leen como números', () => {
  assert.equal(estadoNumeracion(S('0', '5'), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S('0', '0'), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S('0', '1'), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S(0, '5'), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S('0', 5), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S('50', '5'), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S('51', '5'), 'ecf', H), 'vigente')
  assert.equal(estadoNumeracion(S('312', '5'), 'ecf', H), 'vigente')
  assert.equal(estadoNumeracion(S('312.000', '5'), 'ecf', H), 'vigente')
  // Un total emitido que no se lee es «ninguno»: lo agotado necesita números emitidos.
  assert.equal(estadoNumeracion(S(0, 'abc'), 'ecf', H), 'pocos')
  assert.equal(estadoNumeracion(S(0, ''), 'ecf', H), 'pocos')
})

test('lo que queda por debajo de cero cuenta como cero: agotada, y no pocos', () => {
  assert.equal(estadoNumeracion(S(-3, 5), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S('-1', 5), 'ecf', H), 'agotada')
  assert.equal(estadoNumeracion(S(-3, 0), 'ecf', H), 'pocos')
})

// --- con un rango --------------------------------------------------------------------------------------------------------------------

test('con un rango, restantes es el límite menos el último número asignado, y el de la secuencia no cuenta', () => {
  assert.equal(estadoNumeracion(S(1, 1), 'ecf', H, R(500, 188)), 'vigente') // 312 restantes, no 1
  assert.equal(estadoNumeracion(S(null, 5), 'ecf', H, R(500, 188)), 'vigente') // la secuencia no sabía de rangos y este sí
  assert.equal(estadoNumeracion(S(1000, 5), 'ecf', H, R(500, 488)), 'pocos') // 12 restantes, no 1000
  assert.equal(estadoNumeracion(S(1, 1), 'ecf', H, R('500', '450')), 'pocos') // 50
  assert.equal(estadoNumeracion(S(1, 1), 'ecf', H, R('500', '449')), 'vigente') // 51
})

test('con un rango agotado: agotada si se emitió algo, pocos si no', () => {
  assert.equal(estadoNumeracion(S(1, 5), 'ecf', H, R(500, 500)), 'agotada')
  assert.equal(estadoNumeracion(S(1, 0), 'ecf', H, R(500, 500)), 'pocos')
  // Un último número pasado del límite (un dato roto) no da un restante negativo: está agotado.
  assert.equal(estadoNumeracion(S(1, 5), 'ecf', H, R(500, 501)), 'agotada')
  assert.equal(estadoNumeracion(S(1, 5), 'ecf', H, R('500', '650')), 'agotada')
})

test('un rango sin límite (numero_hasta null) no tiene restantes: sin rango en producción, sin límite en pruebas', () => {
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(null, 0)), 'sinRango')
  assert.equal(estadoNumeracion(S(100, 5), 'testecf', H, R(null, 0)), 'sinLimite')
  assert.equal(estadoNumeracion(S(100, 5), 'certecf', H, R(null, 12)), 'sinLimite')
  // Un límite o un último número que no se leen tampoco dan restantes.
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R('abc', 5)), 'sinRango')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 'abc')), 'sinRango')
  assert.equal(estadoNumeracion(S(100, 5), 'testecf', H, R(500, '')), 'sinLimite')
  // Un rango al que le faltan las columnas tampoco: no hay de dónde sacar lo que queda, y lo de la secuencia es de otro rango.
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, { current_value: 188 } as any), 'sinRango')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, { numero_hasta: 500 } as any), 'sinRango')
  assert.equal(estadoNumeracion(S(100, 5), 'certecf', H, {} as any), 'sinLimite')
})

test('con un rango, el vencimiento es el del rango y no el de la secuencia', () => {
  // El de la secuencia es el del rango que vence primero, que puede ser otro.
  assert.equal(estadoNumeracion(S(100, 5, '2026-10-28'), 'ecf', H, R(500, 188, '2027-12-31')), 'vigente')
  assert.equal(estadoNumeracion(S(100, 5, '2026-10-28'), 'ecf', H, R(500, 188)), 'vigente') // este rango no vence
  assert.equal(estadoNumeracion(S(100, 5, '2026-10-28'), 'ecf', H, R(500, 188, null)), 'vigente')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 188, '2026-10-30')), 'vencePronto')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 188, '2026-11-20')), 'porVencer')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 188, '2026-11-27')), 'vigente')
  assert.equal(estadoNumeracion(S(100, 5), 'ecf', H, R(500, 488, '2026-11-20')), 'pocos') // pocos antes que por vencer, también por rango
})

// --- entradas y zona -----------------------------------------------------------------------------------------------------------------

test('estadoNumeracion no modifica lo que recibe', () => {
  const secuencia = Object.freeze(S('12', '5', '2026-11-03'))
  const rango = Object.freeze(R('500', '188', '2026-11-20'))
  assert.equal(estadoNumeracion(secuencia, 'ecf', H), 'vencePronto')
  assert.equal(estadoNumeracion(secuencia, 'ecf', H, rango), 'porVencer')
  assert.deepEqual(secuencia, S('12', '5', '2026-11-03'))
  assert.deepEqual(rango, R('500', '188', '2026-11-20'))
})

test('el estado no depende de la zona del teléfono: cuenta días del calendario con el `hoy` que recibe', () => {
  // Detrás de UTC (RD, UTC-4), delante (UTC+14), UTC, y dos con cambio de hora en fechas distintas (Nueva York y Madrid).
  const zonas = ['America/Santo_Domingo', 'Pacific/Kiritimati', 'UTC', 'America/New_York', 'Europe/Madrid']
  const casos: [SecuenciaStats, EstadoNumeracion][] = [
    [S(100, 5, '2026-11-03'), 'vencePronto'],
    [S(100, 5, '2026-11-04'), 'porVencer'],
    [S(100, 5, '2026-11-26'), 'porVencer'],
    [S(100, 5, '2026-11-27'), 'vigente'],
    [S(100, 5, '2026-10-27'), 'vencePronto'],
  ]
  for (const zona of zonas) {
    conZona(zona, () => {
      for (const [secuencia, esperado] of casos) assert.equal(estadoNumeracion(secuencia, 'ecf', H), esperado, `${zona}: vence ${secuencia.vencimiento}`)
    })
  }
})

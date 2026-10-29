// lib/fechas: las fechas que manda el API (DATE `2026-10-27` y DATETIME `2026-10-27 10:42:00`, en texto) se leen por sus números. Nunca con
// `new Date('2026-10-28')`, que es la medianoche UTC y en RD (UTC-4) cae en la tarde del 27: un vencimiento se leería un día antes.
// Review Focus 5: contar días no depende de la zona del teléfono, y «hoy» y «ayer» siguen a la fecha local (el reloj de lib/reloj se prueba
// en reloj.test.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { conZona } from './ayudas'
import { diasHasta, etiquetaDia, fmtFechaISO, horaDe } from '~/lib/fechas'

// Detrás de UTC (RD, UTC-4), delante (UTC+14), UTC, y dos con cambio de hora en fechas distintas (Nueva York y Madrid).
const ZONAS = ['America/Santo_Domingo', 'Pacific/Kiritimati', 'UTC', 'America/New_York', 'Europe/Madrid']

// --- fmtFechaISO ---------------------------------------------------------------------------------------------------------------------

test('fmtFechaISO: día sin cero a la izquierda, mes abreviado y año', () => {
  assert.equal(fmtFechaISO('2027-12-31'), '31 dic 2027')
  assert.equal(fmtFechaISO('2026-10-05'), '5 oct 2026')
  assert.equal(fmtFechaISO('2026-01-01'), '1 ene 2026')
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  meses.forEach((mes, i) => assert.equal(fmtFechaISO(`2026-${String(i + 1).padStart(2, '0')}-15`), `15 ${mes} 2026`))
})

test('fmtFechaISO lee los 10 primeros caracteres: un DATETIME también sirve', () => {
  assert.equal(fmtFechaISO('2026-10-26 09:41:00'), '26 oct 2026')
  assert.equal(fmtFechaISO('2026-10-26T09:41:00'), '26 oct 2026')
  assert.equal(fmtFechaISO('2026-12-31 23:59:59'), '31 dic 2026')
})

test('fmtFechaISO: lo que no es una fecha del calendario vuelve tal cual, sin lanzar', () => {
  for (const texto of ['', 'no es una fecha', '0000-00-00', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29', '26-10-27', '2026/10/27']) {
    assert.equal(fmtFechaISO(texto), texto, JSON.stringify(texto))
  }
  assert.equal(fmtFechaISO('2028-02-29'), '29 feb 2028') // 2028 es bisiesto
})

// --- diasHasta -----------------------------------------------------------------------------------------------------------------------

test('diasHasta', () => {
  assert.equal(diasHasta('2026-10-28', '2026-10-27'), 1)
  assert.equal(diasHasta('2026-10-27', '2026-10-27'), 0)
  assert.equal(diasHasta('2026-10-20', '2026-10-27'), -7)
  assert.equal(diasHasta('2028-03-01', '2028-02-28'), 2)
})

test('diasHasta cruza meses, años y años bisiestos', () => {
  assert.equal(diasHasta('2027-01-01', '2026-12-31'), 1)
  assert.equal(diasHasta('2026-12-31', '2027-01-01'), -1)
  assert.equal(diasHasta('2027-03-01', '2027-02-28'), 1) // 2027 no es bisiesto
  assert.equal(diasHasta('2027-10-27', '2026-10-27'), 365)
  assert.equal(diasHasta('2028-10-27', '2027-10-27'), 366) // cuenta el 29 de febrero de 2028
  assert.equal(diasHasta('2026-11-14', '2026-10-26'), 19) // «Vence 14 nov 2026 (19 días)» del anexo
})

test('diasHasta da un entero (nunca -0) y lee un DATETIME por sus 10 primeros caracteres', () => {
  assert.ok(Object.is(diasHasta('2026-10-27', '2026-10-27'), 0))
  assert.equal(diasHasta('2026-10-28 23:59:59', '2026-10-27 00:00:00'), 1)
  for (const [iso, hoy] of [['2026-10-27', '2026-10-27'], ['2030-02-28', '2026-10-27'], ['1999-12-31', '2026-10-27']]) {
    assert.ok(Number.isInteger(diasHasta(iso, hoy)), `${iso} / ${hoy}`)
  }
})

test('diasHasta: una fecha que no existe da NaN y no un día corrido al mes siguiente', () => {
  for (const [iso, hoy] of [
    ['', '2026-10-27'],
    ['2026-10-27', ''],
    ['no es una fecha', '2026-10-27'],
    ['2026-02-30', '2026-10-27'], // sin el chequeo sería el 2 de marzo
    ['0000-00-00', '2026-10-27'], // la fecha cero de MySQL
    ['2026-13-01', '2026-10-27'],
  ]) {
    assert.ok(Number.isNaN(diasHasta(iso, hoy)), `${iso} / ${hoy}`)
  }
})

test('el calendario completo: cada día vale uno más que el anterior y solo los días que existen son fechas', () => {
  // Del 1996 al 2104 (con los bisiestos de siglo 2000 y 2100), todos los meses 0 a 14 y los días 0 a 33: lo que existe se cuenta de uno en uno
  // sin saltos entre meses y años, y lo que no existe (mes 0, 13 y 14, día 0, 31 de abril, 29 de febrero de un año común) da NaN y no se corre.
  const bisiesto = (anio: number): boolean => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
  const diasDelMes = (anio: number, mes: number): number => [31, bisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
  const dos = (n: number): string => String(n).padStart(2, '0')
  let anterior: string | null = null
  let existentes = 0
  for (let anio = 1996; anio <= 2104; anio++) {
    for (let mes = 0; mes <= 14; mes++) {
      for (let dia = 0; dia <= 33; dia++) {
        const iso = `${anio}-${dos(mes)}-${dos(dia)}`
        if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDelMes(anio, mes)) {
          existentes++
          if (anterior !== null) assert.equal(diasHasta(iso, anterior), 1, `${iso} tras ${anterior}`)
          assert.notEqual(fmtFechaISO(iso), iso, iso)
          anterior = iso
        } else {
          assert.ok(Number.isNaN(diasHasta(iso, '2026-10-27')), `${iso} no existe y dio un número`)
          assert.equal(fmtFechaISO(iso), iso, `${iso} no existe y se formateó`)
        }
      }
    }
  }
  assert.equal(existentes, 109 * 365 + 27) // 109 años (1996 a 2104) con 27 bisiestos: los de cada 4 años menos el 2100
  // Los siglos que no son bisiestos y el que sí.
  assert.equal(diasHasta('1900-03-01', '1900-02-28'), 1)
  assert.equal(diasHasta('2400-03-01', '2400-02-28'), 2)
})

test('diasHasta no depende de la zona', () => {
  // Review Focus 5. Los días del cambio de hora miden 23 o 25 horas y valen un día: Nueva York cambia el 8 de marzo y el 1 de noviembre de
  // 2026 y Madrid el 29 de marzo y el 25 de octubre (contados en milisegundos locales darían 0.96 o 1.04 días).
  const cambios = [
    ['2026-03-08', '2026-03-07'], ['2026-03-09', '2026-03-08'], ['2026-11-01', '2026-10-31'], ['2026-11-02', '2026-11-01'],
    ['2026-03-29', '2026-03-28'], ['2026-03-30', '2026-03-29'], ['2026-10-25', '2026-10-24'], ['2026-10-26', '2026-10-25'],
  ]
  for (const zona of ZONAS) {
    conZona(zona, () => {
      assert.equal(diasHasta('2026-10-28', '2026-10-27'), 1, zona)
      assert.equal(fmtFechaISO('2027-12-31'), '31 dic 2027', zona)
      assert.equal(diasHasta('2027-01-01', '2026-01-01'), 365, zona)
      assert.equal(diasHasta('2026-03-01', '2026-11-01'), -245, zona)
      for (const [dia, antes] of cambios) assert.equal(diasHasta(dia, antes), 1, `${zona}: ${dia} tras ${antes}`)
    })
  }
})

test('una fecha en texto nunca pasa por Date', () => {
  // `new Date('2026-10-28')` y `Date.parse` leen la fecha como medianoche UTC. Aquí Date se vuelve una trampa que lanza si recibe un texto:
  // un cambio futuro que lea la fecha con `new Date(iso)` (el fallo de `formatApiDate` en la app completa) no pasa esta prueba.
  const DateReal = globalThis.Date
  const trampa = new Proxy(DateReal, {
    construct(objetivo, args) {
      if (args.some((a) => typeof a === 'string')) throw new Error(`new Date(${JSON.stringify(args[0])}) lee un texto`)
      return Reflect.construct(objetivo, args)
    },
    get(objetivo, propiedad) {
      if (propiedad === 'parse') {
        return () => {
          throw new Error('Date.parse lee un texto')
        }
      }
      return Reflect.get(objetivo, propiedad)
    },
  })
  globalThis.Date = trampa
  try {
    assert.equal(fmtFechaISO('2026-10-27 10:42:00'), '27 oct 2026')
    assert.equal(diasHasta('2026-10-28', '2026-10-27'), 1)
    assert.ok(Number.isNaN(diasHasta('2026-02-30', '2026-10-27'))) // ni una fecha inválida se le pasa a Date como texto
    assert.equal(etiquetaDia('2026-10-26 08:15:00', '2026-10-27'), 'ayer 08:15')
    assert.equal(etiquetaDia('2025-10-20 09:41:00', '2026-10-27'), '20 oct 2025 09:41')
    assert.equal(horaDe('2026-10-26 08:15:00'), '08:15')
  } finally {
    globalThis.Date = DateReal
  }
  assert.throws(() => new trampa('2026-10-28'), /lee un texto/) // y la trampa de verdad atrapa: no pasó en vano
})

// --- etiquetaDia y horaDe ------------------------------------------------------------------------------------------------------------

test('etiquetaDia', () => {
  const H = '2026-10-27'
  assert.equal(etiquetaDia('2026-10-27 10:42:00', H), 'hoy 10:42')
  assert.equal(etiquetaDia('2026-10-26 08:15:00', H), 'ayer 08:15')
  assert.equal(etiquetaDia('2026-10-20 09:41:00', H), '20 oct 09:41')
  assert.equal(etiquetaDia('2025-10-20 09:41:00', H), '20 oct 2025 09:41')
  assert.equal(etiquetaDia('2025-12-31 23:00:00', '2026-01-01'), 'ayer 23:00')
})

test('etiquetaDia: el año se omite solo si es el de hoy, y «ayer» no es «hace dos días»', () => {
  assert.equal(etiquetaDia('2025-10-27 09:00:00', '2026-10-27'), '27 oct 2025 09:00') // hace un año: no es «hoy»
  assert.equal(etiquetaDia('2026-01-05 09:00:00', '2026-10-27'), '5 ene 09:00')
  assert.equal(etiquetaDia('2026-10-25 09:00:00', '2026-10-27'), '25 oct 09:00') // anteayer
  assert.equal(etiquetaDia('2026-10-28 09:00:00', '2026-10-27'), '28 oct 09:00') // mañana (un teléfono con el reloj atrasado): sin etiqueta
  assert.equal(etiquetaDia('2026-12-31 09:00:00', '2026-10-27'), '31 dic 09:00')
  assert.equal(etiquetaDia('2027-01-01 09:00:00', '2026-12-31'), '1 ene 2027 09:00') // mañana, ya de otro año
})

test('etiquetaDia toma la hora tal como viene, también con T, y sin hora no deja un espacio de sobra', () => {
  const H = '2026-10-27'
  assert.equal(etiquetaDia('2026-10-27T10:42:00', H), 'hoy 10:42')
  assert.equal(etiquetaDia('2026-10-27 00:05:09', H), 'hoy 00:05')
  assert.equal(etiquetaDia('2026-10-26 23:59:59', H), 'ayer 23:59')
  assert.equal(etiquetaDia('2026-10-27', H), 'hoy')
  assert.equal(etiquetaDia('2026-10-26', H), 'ayer')
  assert.equal(etiquetaDia('2026-10-20', H), '20 oct')
  assert.equal(etiquetaDia('2025-10-20', H), '20 oct 2025')
})

test('etiquetaDia: lo que no es una fecha vuelve tal cual, y un «hoy» inválido deja la fecha completa', () => {
  for (const texto of ['', 'no es una fecha', '0000-00-00 00:00:00', '2026-02-30 10:00:00']) {
    assert.equal(etiquetaDia(texto, '2026-10-27'), texto, JSON.stringify(texto))
  }
  assert.equal(etiquetaDia('2026-10-27 10:42:00', 'no es una fecha'), '27 oct 2026 10:42')
})

test('horaDe: HH:MM de un DATETIME, con espacio o con T', () => {
  assert.equal(horaDe('2026-10-27 10:42:00'), '10:42')
  assert.equal(horaDe('2026-10-27T08:15:59'), '08:15')
  assert.equal(horaDe('2026-10-27 00:00:00'), '00:00')
  assert.equal(horaDe('2026-10-27 23:59:59'), '23:59')
  assert.equal(horaDe('2026-10-27 09:41'), '09:41') // sin segundos
})

test('horaDe: null cuando no hay una hora que mostrar', () => {
  const sinHora = ['2026-10-27', '', 'no es una fecha', '10:42', 'a las 10:42:00', '2026-10-27 24:00:00', '2026-10-27 10:60:00', '2026-10-27 7:05:00']
  for (const texto of sinHora) assert.equal(horaDe(texto), null, JSON.stringify(texto))
})

test('etiquetaDia y horaDe tampoco dependen de la zona', () => {
  for (const zona of ZONAS) {
    conZona(zona, () => {
      assert.equal(etiquetaDia('2026-10-27 23:30:00', '2026-10-27'), 'hoy 23:30', zona)
      assert.equal(etiquetaDia('2026-10-26 00:30:00', '2026-10-27'), 'ayer 00:30', zona)
      // Horas que en alguna zona no existen (02:30 del 8 de marzo en Nueva York y del 29 en Madrid) o existen dos veces (01:30 del 1 de noviembre).
      assert.equal(etiquetaDia('2026-03-08 02:30:00', '2026-03-09'), 'ayer 02:30', zona)
      assert.equal(etiquetaDia('2026-03-29 02:30:00', '2026-03-30'), 'ayer 02:30', zona)
      assert.equal(etiquetaDia('2026-11-01 01:30:00', '2026-11-01'), 'hoy 01:30', zona)
      assert.equal(horaDe('2026-10-27 09:41:00'), '09:41', zona)
    })
  }
})

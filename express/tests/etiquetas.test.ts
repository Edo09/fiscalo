// lib/etiquetas: cada uno de los 25 estados de `DGII_LABEL` (src/api/estadosDgii.ts) cae en UN bucket, y de cada bucket sale el chip (texto, tono e
// icono) que ve el usuario. Review Focus 1: lo que la DGII no ha aceptado nunca pasa por aceptado, y lo incierto (un estado que no se conoce, el
// null y el vacío) cae en «sin confirmar», el bucket que no ofrece ninguna emisión nueva.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ESTADOS_EN_VUELO, isEnVuelo, puedeReenviarEstado } from '@/api/estadosDgii'
import type { Ambiente } from '~/entitlements'
import { bucketDe, etiquetaAmbiente, etiquetaDe, PORCLAVE, tonoNumeracion } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import type { EstadoNumeracion } from '~/lib/numeracion'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/

/**
 * Las claves de `DGII_LABEL`, sacadas de su archivo: la tabla no se exporta, y esta prueba no puede quedarse con una lista propia que no se
 * entere de que la app completa agregó un estado.
 */
const CLAVES = [...leer('src/api/estadosDgii.ts').split('const DGII_LABEL: Record<string, string> = {')[1].split('\n}')[0].matchAll(/^\s{2}([A-Z_]+):/gm)].map(
  (m) => m[1],
)

/** El bucket de cada una de las 25, escrito a mano: lo que se prueba es PORCLAVE, así que no se deriva de ella. */
const ESPERADO: [string, Bucket][] = [
  ['ACEPTADO', 'aceptada'],
  ['RFCE_ACEPTADO', 'aceptada'],
  ['ACEPTADO_CONDICIONAL', 'aceptada'],
  ['RFCE_ACEPTADO_CONDICIONAL', 'aceptada'],
  ['RFCE_ACEPTADO_CONDIC', 'aceptada'], // cortado a 20 caracteres (VARCHAR(20) antes de la migración 028)
  ['ENVIADO', 'enProceso'],
  ['EN_PROCESO', 'enProceso'],
  ['RFCE_ENVIADO', 'enProceso'],
  ['RFCE_EN_PROCESO', 'enProceso'],
  ['PENDIENTE', 'sinConfirmar'],
  ['PENDIENTE_ENVIO', 'sinConfirmar'],
  ['ENVIO_INCIERTO', 'sinConfirmar'],
  ['RECHAZADO', 'rechazada'],
  ['RFCE_RECHAZADO', 'rechazada'],
  ['NO_ENCONTRADO', 'noEncontrada'],
  ['RFCE_NO_ENCONTRADO', 'noEncontrada'],
  ['ERROR', 'error'],
  ['RFCE_ERROR', 'error'],
  ['RECHAZADO_ARCHIVADO', 'reemplazada'],
  ['NO_ENCONTRADO_ARCHIVADO', 'reemplazada'],
  ['RFCE_RECHAZADO_ARCHIVADO', 'reemplazada'],
  ['RFCE_NO_ENCONTRADO_ARCHIVADO', 'reemplazada'],
  ['RFCE_RECHAZADO_ARCHI', 'reemplazada'], // los tres cortados a 20 caracteres
  ['NO_ENCONTRADO_ARCHIV', 'reemplazada'],
  ['RFCE_NO_ENCONTRADO_A', 'reemplazada'],
]

const BUCKETS: Bucket[] = ['aceptada', 'enProceso', 'sinConfirmar', 'rechazada', 'noEncontrada', 'error', 'reemplazada']

/** El chip de cada bucket (texto, tono, icono), tal como lo fija el plan. */
const CHIP: Record<Bucket, { texto: string; tono: string; icono: string }> = {
  aceptada: { texto: 'Aceptada', tono: 'ok', icono: 'circle-check' },
  enProceso: { texto: 'En proceso', tono: 'info', icono: 'clock' },
  sinConfirmar: { texto: 'Sin confirmar', tono: 'warn', icono: 'triangle-alert' },
  rechazada: { texto: 'Rechazada', tono: 'danger', icono: 'circle-x' },
  noEncontrada: { texto: 'No encontrada', tono: 'neutral', icono: 'circle-help' },
  error: { texto: 'Error', tono: 'danger', icono: 'circle-alert' },
  reemplazada: { texto: 'Reemplazada', tono: 'neutral', icono: 'rotate-ccw' },
}

/** Los dos estados sin confirmar que dicen algo más preciso que «Sin confirmar». */
const TEXTO_PROPIO: Record<string, string> = { PENDIENTE_ENVIO: 'Por enviar', PENDIENTE: 'Pendiente' }

// --- bucketDe ------------------------------------------------------------------------------------------------------------------------

test('las 25 claves de DGII_LABEL tienen exactamente un bucket', () => {
  assert.equal(CLAVES.length, 25)
  assert.equal(new Set(CLAVES).size, 25)
  assert.deepEqual(Object.keys(PORCLAVE).sort(), [...CLAVES].sort())
  assert.deepEqual(ESPERADO.map(([clave]) => clave).sort(), [...CLAVES].sort()) // la tabla de esta prueba cubre las mismas 25
  for (const [clave, bucket] of ESPERADO) assert.equal(bucketDe(clave), bucket, clave)
})

test('los siete buckets se usan, con el reparto del plan: 5 aceptada, 4 en proceso, 3 sin confirmar, 2, 2 y 2, y 7 reemplazadas', () => {
  const cuenta = (bucket: Bucket): number => ESPERADO.filter(([, b]) => b === bucket).length
  assert.deepEqual(BUCKETS.map(cuenta), [5, 4, 3, 2, 2, 2, 7])
  assert.deepEqual(
    Object.values(PORCLAVE).filter((b) => !BUCKETS.includes(b)),
    [],
  ) // ningún valor fuera de los siete
})

test('un estado cortado a 20 caracteres cae en el mismo bucket que el estado completo', () => {
  // Un tenant sin modo estricto pudo guardar el estado así antes de la migración 028: dice lo mismo que el completo.
  const truncadas = CLAVES.filter((clave) => clave.length === 20 && CLAVES.some((otra) => otra.length > 20 && otra.startsWith(clave)))
  assert.equal(truncadas.length, 4)
  for (const corta of truncadas) {
    for (const larga of CLAVES.filter((otra) => otra.length > 20 && otra.startsWith(corta))) assert.equal(bucketDe(corta), bucketDe(larga), `${corta} / ${larga}`)
  }
})

test('desconocidos caen a sinConfirmar', () => {
  for (const v of [null, undefined, '', 'INVENTADO']) assert.equal(bucketDe(v as any), 'sinConfirmar')
})

test('bucketDe lee el estado exacto: otra grafía de un estado aceptado no cuenta como aceptado', () => {
  // El API manda los códigos en mayúsculas. Un texto que casi lo es no se «arregla»: lo que no se reconoce es incierto, y lo incierto no se comparte.
  for (const v of ['aceptado', 'Aceptado', ' ACEPTADO', 'ACEPTADO ', 'ACEPTADA', 'E45', 'ACEPTADO\n']) assert.equal(bucketDe(v), 'sinConfirmar', JSON.stringify(v))
})

test('bucketDe no lee nada de Object.prototype ni de lo que no es texto', () => {
  // Un nombre como `constructor` o `__proto__` no es una clave de la tabla: con una búsqueda ingenua devolvería la función de Object.prototype.
  for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) assert.equal(bucketDe(v), 'sinConfirmar', v)
  // Una clave de propiedad se convierte a texto: sin la guarda de tipo, un arreglo `['ACEPTADO']` leería el bucket de 'ACEPTADO'.
  for (const v of [['ACEPTADO'], { toString: () => 'ACEPTADO' }, 42, true, Symbol.iterator]) assert.equal(bucketDe(v as any), 'sinConfirmar')
})

test('cada resultado de bucketDe es uno de los siete buckets, sea cual sea la entrada', () => {
  for (const v of [...CLAVES, null, undefined, '', 'X', 'constructor', '__proto__']) assert.ok(BUCKETS.includes(bucketDe(v)), String(v))
})

test('los estados en vuelo de la app completa son todos «sin confirmar» (nunca se ofrece una emisión nueva con ellos)', () => {
  assert.deepEqual([...ESTADOS_EN_VUELO], ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'])
  for (const clave of CLAVES) if (isEnVuelo(clave)) assert.equal(bucketDe(clave), 'sinConfirmar', clave)
  for (const clave of ESTADOS_EN_VUELO) assert.equal(bucketDe(clave), 'sinConfirmar', clave)
})

test('lo que la app completa deja reenviar es un rechazo o un «no encontrada», nunca algo sin confirmar', () => {
  const reenviables = CLAVES.filter((clave) => puedeReenviarEstado(clave))
  assert.deepEqual(reenviables.sort(), ['NO_ENCONTRADO', 'RECHAZADO', 'RFCE_RECHAZADO'])
  for (const clave of reenviables) assert.ok(['rechazada', 'noEncontrada'].includes(bucketDe(clave)), clave)
})

// --- etiquetaDe ----------------------------------------------------------------------------------------------------------------------

test('etiquetas', () => {
  assert.equal(etiquetaDe('PENDIENTE_ENVIO').texto, 'Por enviar')
  assert.deepEqual(etiquetaAmbiente('certecf'), { texto: 'CERTIFICACIÓN', tono: 'warn' })
})

test('el chip de cada una de las 25 claves sale de su bucket, y solo PENDIENTE y PENDIENTE_ENVIO cambian el texto', () => {
  const combinaciones = new Set<string>()
  for (const [clave, bucket] of ESPERADO) {
    const esperado = { ...CHIP[bucket], texto: TEXTO_PROPIO[clave] ?? CHIP[bucket].texto }
    assert.deepEqual(etiquetaDe(clave), esperado, clave)
    combinaciones.add(`${esperado.tono}/${esperado.icono}`)
  }
  // Un tono y un icono por bucket: siete combinaciones, de modo que cada estado se distingue por icono y por texto, no solo por color.
  assert.equal(combinaciones.size, 7)
  assert.equal(new Set(Object.values(CHIP).map((chip) => chip.icono)).size, 7)
})

test('lo incierto se ve como «Sin confirmar»: un estado que no se conoce, el null y el vacío', () => {
  for (const v of [null, undefined, '', 'INVENTADO', 'aceptado', 'constructor', '__proto__', 'toString']) {
    assert.deepEqual(etiquetaDe(v), CHIP.sinConfirmar, String(v))
  }
})

test('los siete iconos de los chips son los que Icon va a tener', () => {
  const iconos = new Set(ESPERADO.map(([clave]) => etiquetaDe(clave).icono))
  assert.deepEqual([...iconos].sort(), ['circle-alert', 'circle-check', 'circle-help', 'circle-x', 'clock', 'rotate-ccw', 'triangle-alert'])
})

test('etiquetaDe acepta el tipo de comprobante y en v1 no cambia nada', () => {
  for (const tipo of [undefined, '45', '31', '32', '34', '33', 'E45', '']) {
    for (const [clave] of ESPERADO) assert.deepEqual(etiquetaDe(clave, tipo), etiquetaDe(clave), `${clave} / ${String(tipo)}`)
  }
})

test('etiquetaDe da un objeto nuevo cada vez: quien lo modifique no cambia el chip de la fila siguiente', () => {
  const a = etiquetaDe('ACEPTADO')
  a.texto = 'otra cosa'
  a.tono = 'danger'
  assert.deepEqual(etiquetaDe('ACEPTADO'), CHIP.aceptada)
  assert.notEqual(etiquetaDe('ACEPTADO'), etiquetaDe('ACEPTADO'))
  const p = etiquetaDe('PENDIENTE_ENVIO')
  p.texto = 'x'
  assert.equal(etiquetaDe('ENVIO_INCIERTO').texto, 'Sin confirmar') // el texto propio de PENDIENTE_ENVIO no se escribe en el chip del bucket
})

// --- etiquetaAmbiente y tonoNumeracion -----------------------------------------------------------------------------------------------

test('etiquetaAmbiente: pruebas y certificación en aviso, producción en verde', () => {
  assert.deepEqual(etiquetaAmbiente('testecf'), { texto: 'PRUEBAS', tono: 'warn' })
  assert.deepEqual(etiquetaAmbiente('certecf'), { texto: 'CERTIFICACIÓN', tono: 'warn' })
  assert.deepEqual(etiquetaAmbiente('ecf'), { texto: 'PRODUCCIÓN', tono: 'ok' })
  // Solo el ambiente real es verde: nada que no sea producción se ve como producción.
  const ambientes: Ambiente[] = ['testecf', 'certecf', 'ecf']
  assert.deepEqual(
    ambientes.filter((a) => etiquetaAmbiente(a).tono === 'ok'),
    ['ecf'],
  )
  const e = etiquetaAmbiente('ecf')
  e.texto = 'x'
  assert.equal(etiquetaAmbiente('ecf').texto, 'PRODUCCIÓN') // un objeto nuevo cada vez
})

test('tonoNumeracion: rojo para lo que bloquea o urge, ámbar para lo que avisa, verde, y gris sin límite', () => {
  const tonos: [EstadoNumeracion, string][] = [
    ['agotada', 'danger'],
    ['sinRango', 'danger'],
    ['vencePronto', 'danger'],
    ['pocos', 'warning'],
    ['porVencer', 'warning'],
    ['vigente', 'ok'],
    ['sinLimite', 'neutral'],
  ]
  for (const [estado, tono] of tonos) assert.equal(tonoNumeracion(estado), tono, estado)
  assert.equal(tonos.length, 7)
})

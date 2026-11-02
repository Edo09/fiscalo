// lib/lineaTiempo: los tres pasos del detalle (anexo 6.3): Guardada, Enviada a la DGII y la respuesta de la DGII, con la hora tal como está guardada. Lo que decide esta
// prueba es cuándo cada paso está hecho, pendiente o en alerta, y que la línea nunca diga que la DGII aceptó lo que no aceptó (el mismo cuidado que acciones.ts: lo
// incierto se ve incierto).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bucketDe } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import type { FacturaVista } from '~/lib/filas'
import { lineaTiempo } from '~/lib/lineaTiempo'
import type { PasoTiempo } from '~/lib/lineaTiempo'
import { UMBRAL_CONSUMO } from '~/lib/tiposEcf'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/

/** Las claves de `DGII_LABEL` (src/api/estadosDgii.ts), sacadas de su archivo: la tabla no se exporta y esta prueba no puede quedarse con una lista propia. */
const CLAVES_DGII = [...leer('src/api/estadosDgii.ts').split('const DGII_LABEL: Record<string, string> = {')[1].split('\n}')[0].matchAll(/^\s{2}([A-Z_]+):/gm)].map(
  (m) => m[1],
)

/** Una venta E45 aceptada: guardada a las 09:41:00 y firmada a las 09:41:12, con su track id. */
const BASE: FacturaVista = {
  id: 1,
  numero: 'E450000000013',
  eNcf: 'E450000000013',
  tipo: '45',
  cliente: 'Min. de Obras Públicas',
  clienteId: 9,
  rnc: '401123456',
  fecha: '2026-10-26 09:41:00',
  total: 11800,
  totalConSigno: 11800,
  estado: 'ACEPTADO',
  trackId: null,
  codigoSeguridad: null,
  fechaEmisionDgii: '2026-10-26 09:41:12',
  secuenciaUtilizada: null,
  tipoPago: 1,
  items: [],
  notas: [],
  modifica: null,
  codigoModificacion: null,
  respuestaDgii: null,
  montoGravado: null,
  montoExento: null,
  totalItbis: null,
}
const factura = (o: Record<string, unknown> = {}): FacturaVista => ({ ...BASE, ...o }) as FacturaVista

/** El paso con esa clave. */
const paso = (f: FacturaVista, clave: PasoTiempo['clave']): PasoTiempo => {
  const encontrado = lineaTiempo(f).find((p) => p.clave === clave)
  assert.ok(encontrado, clave)
  return encontrado
}
const estados = (f: FacturaVista): string[] => lineaTiempo(f).map((p) => p.estado)
const horas = (f: FacturaVista): (string | null)[] => lineaTiempo(f).map((p) => p.hora)
const textos = (f: FacturaVista): string[] => lineaTiempo(f).map((p) => p.texto)

// --- Los casos del plan ------------------------------------------------------------------------------------------------------------------

test('aceptada: tres pasos hechos, con las horas de fecha y de fechaEmisionDgii', () => {
  assert.deepEqual(lineaTiempo(factura({ estado: 'ACEPTADO', trackId: '9f3a1c2e' })), [
    { clave: 'guardada', texto: 'Guardada', hora: '09:41', estado: 'hecho' },
    { clave: 'enviada', texto: 'Enviada a la DGII', hora: '09:41', estado: 'hecho' },
    { clave: 'respuesta', texto: 'Aceptada', hora: '09:41', estado: 'hecho' },
  ])
})

test('ENVIO_INCIERTO: guardada hecho, enviada pendiente y la respuesta en alerta', () => {
  const f = factura({ estado: 'ENVIO_INCIERTO' })
  assert.deepEqual(estados(f), ['hecho', 'pendiente', 'alerta'])
  assert.deepEqual(lineaTiempo(f), [
    { clave: 'guardada', texto: 'Guardada', hora: '09:41', estado: 'hecho' },
    { clave: 'enviada', texto: 'Enviada a la DGII', hora: null, estado: 'pendiente' }, // todavía no se sabe que llegó: sin hora
    { clave: 'respuesta', texto: 'Sin respuesta DGII', hora: null, estado: 'alerta' },
  ])
})

test('E32 de menos de RD$250,000 nombra la respuesta «Resumen de consumo»; de 250,000 en adelante, no', () => {
  const e32 = (total: number, o: object = {}) => factura({ tipo: '32', total, totalConSigno: total, estado: 'RFCE_ACEPTADO', ...o })
  assert.equal(UMBRAL_CONSUMO, 250000)
  assert.equal(paso(e32(4000), 'respuesta').texto, 'Resumen de consumo')
  assert.equal(paso(e32(UMBRAL_CONSUMO - 0.01), 'respuesta').texto, 'Resumen de consumo')
  assert.equal(paso(e32(250000), 'respuesta').texto, 'Aceptada')
  assert.equal(paso(e32(UMBRAL_CONSUMO + 0.01), 'respuesta').texto, 'Aceptada')
  // el nombre depende del tipo y del total, no de que el estado empiece con RFCE_
  assert.equal(paso(e32(4000, { estado: 'ACEPTADO' }), 'respuesta').texto, 'Resumen de consumo')
  // una E31 o una E45 de poco monto no es un resumen; tampoco una nota
  for (const tipo of ['31', '45', '34', '33']) assert.equal(paso(e32(4000, { tipo }), 'respuesta').texto, 'Aceptada', tipo)
  // solo cambia el nombre de la respuesta: la forma, las horas y los estados son los de siempre
  assert.deepEqual(estados(e32(4000)), ['hecho', 'hecho', 'hecho'])
  assert.deepEqual(horas(e32(4000)), ['09:41', '09:41', '09:41'])
})

test('el nombre «Resumen de consumo» es solo de la respuesta aceptada: lo que no se aceptó conserva su propio nombre', () => {
  const e32 = (estado: string) => factura({ tipo: '32', total: 4000, totalConSigno: 4000, estado })
  assert.equal(paso(e32('RFCE_RECHAZADO'), 'respuesta').texto, 'Rechazada')
  assert.equal(paso(e32('RFCE_ENVIADO'), 'respuesta').texto, 'En proceso')
  assert.equal(paso(e32('RFCE_NO_ENCONTRADO'), 'respuesta').texto, 'No encontrada')
  assert.equal(paso(e32('RFCE_ERROR'), 'respuesta').texto, 'Error')
  assert.equal(paso(e32('ENVIO_INCIERTO'), 'respuesta').texto, 'Sin respuesta DGII') // lo incierto nunca se renombra a algo que suene a recibido
  assert.equal(paso(e32('INVENTADO'), 'respuesta').texto, 'Sin respuesta DGII')
})

// --- La respuesta, por bucket -----------------------------------------------------------------------------------------------------------

test('la respuesta lleva el nombre de su bucket y solo es «hecho» si la DGII aceptó', () => {
  const POR_BUCKET: [string[], string, 'hecho' | 'pendiente' | 'alerta'][] = [
    [['ACEPTADO', 'RFCE_ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDIC'], 'Aceptada', 'hecho'],
    [['ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'], 'En proceso', 'pendiente'],
    [['PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO'], 'Sin respuesta DGII', 'alerta'],
    [['RECHAZADO', 'RFCE_RECHAZADO'], 'Rechazada', 'alerta'],
    [['NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO'], 'No encontrada', 'alerta'],
    [['ERROR', 'RFCE_ERROR'], 'Error', 'alerta'],
    [
      ['RECHAZADO_ARCHIVADO', 'NO_ENCONTRADO_ARCHIVADO', 'RFCE_RECHAZADO_ARCHIVADO', 'RFCE_NO_ENCONTRADO_ARCHIVADO', 'RFCE_RECHAZADO_ARCHI', 'NO_ENCONTRADO_ARCHIV', 'RFCE_NO_ENCONTRADO_A'],
      'Reemplazada',
      'alerta', // el intento archivado terminó mal: no se marca como hecho algo que la DGII no aceptó
    ],
  ]
  assert.deepEqual([...POR_BUCKET.flatMap(([claves]) => claves)].sort(), [...CLAVES_DGII].sort()) // las 25 claves, cada una una vez
  for (const [claves, texto, estado] of POR_BUCKET) {
    for (const clave of claves) {
      const respuesta = paso(factura({ estado: clave }), 'respuesta')
      assert.equal(respuesta.texto, texto, clave)
      assert.equal(respuesta.estado, estado, clave)
    }
  }
  // lo que no se conoce, el null y el vacío: sin respuesta
  for (const clave of ['INVENTADO', '', null, 'aceptado', 'constructor']) {
    const respuesta = paso(factura({ estado: clave }), 'respuesta')
    assert.deepEqual({ texto: respuesta.texto, estado: respuesta.estado }, { texto: 'Sin respuesta DGII', estado: 'alerta' }, String(clave))
  }
})

test('la línea nunca dice que la DGII aceptó lo que no aceptó: ni «Aceptada», ni «Resumen de consumo», ni «hecho» en la respuesta', () => {
  for (const estado of [...CLAVES_DGII, null, '', 'INVENTADO']) {
    for (const [tipo, total] of [['45', 11800], ['32', 4000], ['32', 250000], ['34', 500]] as const) {
      const f = factura({ estado, tipo, total, trackId: 'T1' }) // con track id: aunque se sepa que se envió, la respuesta sigue siendo lo que la DGII dijo
      const aceptada = bucketDe(estado as any) === 'aceptada'
      const respuesta = paso(f, 'respuesta')
      assert.equal(respuesta.estado === 'hecho', aceptada, `${estado}/${tipo}`)
      assert.equal(['Aceptada', 'Resumen de consumo'].includes(respuesta.texto), aceptada, `${estado}/${tipo}`)
      assert.equal(respuesta.hora !== null, aceptada && f.fechaEmisionDgii !== null, `${estado}/${tipo}`) // la hora de la respuesta es solo la de lo aceptado
    }
  }
})

// --- La forma ------------------------------------------------------------------------------------------------------------------------

test('siempre son tres pasos, en el orden guardada, enviada, respuesta, y la guardada siempre está hecha', () => {
  for (const estado of [...CLAVES_DGII, null, '', 'INVENTADO']) {
    for (const trackId of [null, 'T1']) {
      const pasos = lineaTiempo(factura({ estado, trackId }))
      assert.deepEqual(
        pasos.map((p) => p.clave),
        ['guardada', 'enviada', 'respuesta'],
        `${estado}`,
      )
      assert.deepEqual(
        pasos.map((p) => p.texto).slice(0, 2),
        ['Guardada', 'Enviada a la DGII'],
        `${estado}`,
      )
      assert.equal(pasos[0].estado, 'hecho', `${estado}`)
      for (const p of pasos) assert.ok(['hecho', 'pendiente', 'alerta'].includes(p.estado), `${estado}: ${p.estado}`)
    }
  }
})

test('lineaTiempo da objetos nuevos cada vez: quien cambie un paso no cambia la línea siguiente', () => {
  const a = lineaTiempo(factura())
  a[0].texto = 'otra cosa'
  a[1].hora = null
  a.length = 0
  assert.deepEqual(textos(factura()), ['Guardada', 'Enviada a la DGII', 'Aceptada'])
  assert.deepEqual(horas(factura()), ['09:41', '09:41', '09:41'])
  assert.notEqual(lineaTiempo(factura()), lineaTiempo(factura()))
})

// --- Enviada -------------------------------------------------------------------------------------------------------------------------

test('enviada: hecha con un track id, o con un estado que ya pasó el envío, o con un estado RFCE_; pendiente si no', () => {
  // Sin track id: lo que ya pasó el envío (la DGII contestó algo, o lo tiene en proceso) está enviado, y lo que está en vuelo, incierto o heredado sin enviar, no.
  const SIN_ENVIAR = ['PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO']
  for (const estado of CLAVES_DGII) {
    const enviada = paso(factura({ estado, trackId: null }), 'enviada')
    assert.equal(enviada.estado, SIN_ENVIAR.includes(estado) ? 'pendiente' : 'hecho', estado)
  }
  for (const estado of ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'PENDIENTE', null, '', 'INVENTADO']) {
    assert.equal(paso(factura({ estado, trackId: null }), 'enviada').estado, 'pendiente', String(estado))
    assert.equal(paso(factura({ estado, trackId: 'T1' }), 'enviada').estado, 'hecho', `${estado} con track id`) // un track id solo lo da la DGII al recibirlo
  }
  // Un estado RFCE_ que esta tabla no conoce: el resumen de consumo pasa por el envío y por eso se dice enviado, y la respuesta sigue sin conocerse.
  const nuevo = factura({ estado: 'RFCE_NUEVO' })
  assert.equal(paso(nuevo, 'enviada').estado, 'hecho')
  assert.deepEqual({ texto: paso(nuevo, 'respuesta').texto, estado: paso(nuevo, 'respuesta').estado }, { texto: 'Sin respuesta DGII', estado: 'alerta' })
  assert.equal(paso(factura({ estado: 'rfce_nuevo' }), 'enviada').estado, 'pendiente') // el API manda los códigos en mayúsculas: otra grafía no cuenta
})

// --- Las horas -----------------------------------------------------------------------------------------------------------------------

test('cada hora sale de su columna: guardada de fecha, y enviada y la respuesta aceptada de fechaEmisionDgii', () => {
  const f = factura({ fecha: '2026-10-26 08:05:33', fechaEmisionDgii: '2026-10-26 09:41:12' })
  assert.deepEqual(horas(f), ['08:05', '09:41', '09:41'])
  assert.deepEqual(horas(factura({ fecha: '2026-10-26 23:59:59', fechaEmisionDgii: '2026-10-27 00:00:01' })), ['23:59', '00:00', '00:00']) // tal como está guardada, en 24 horas
})

test('sin hora que mostrar, la hora es null y el paso conserva su estado', () => {
  // `fecha` sin hora, o que no es un DATETIME: guardada sigue hecha y sin hora
  for (const fecha of ['2026-10-26', '', 'ayer por la tarde', '2026-10-26 25:00:00']) {
    assert.deepEqual(horas(factura({ fecha })), [null, '09:41', '09:41'], fecha)
    assert.equal(paso(factura({ fecha }), 'guardada').estado, 'hecho', fecha)
  }
  // `fechaEmisionDgii` null, vacía o en otro formato (el API de emisión la manda como 27-05-2026): enviada y la respuesta siguen hechas, sin hora
  for (const fechaEmisionDgii of [null, '', '27-05-2026']) {
    const f = factura({ fechaEmisionDgii, trackId: 'T1' })
    assert.deepEqual(horas(f), ['09:41', null, null], String(fechaEmisionDgii))
    assert.deepEqual(estados(f), ['hecho', 'hecho', 'hecho'], String(fechaEmisionDgii))
  }
})

test('solo lo aceptado lleva hora en la respuesta; en proceso, rechazado, sin respuesta o con error no', () => {
  for (const estado of ['ENVIADO', 'EN_PROCESO', 'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'ENVIO_INCIERTO', 'RECHAZADO_ARCHIVADO']) {
    assert.equal(paso(factura({ estado }), 'respuesta').hora, null, estado)
  }
  // la enviada, en cambio, lleva la hora en cuanto se sabe que se envió, sea cual sea lo que contestó la DGII
  for (const estado of ['ENVIADO', 'RECHAZADO', 'NO_ENCONTRADO', 'ERROR']) assert.equal(paso(factura({ estado }), 'enviada').hora, '09:41', estado)
})

// --- Los nombres ---------------------------------------------------------------------------------------------------------------------

test('los nombres de los pasos son los del anexo: «Guardada», «Enviada a la DGII» y la respuesta por bucket', () => {
  const BUCKETS: [Bucket, string][] = [
    ['aceptada', 'Aceptada'],
    ['enProceso', 'En proceso'],
    ['sinConfirmar', 'Sin respuesta DGII'],
    ['rechazada', 'Rechazada'],
    ['noEncontrada', 'No encontrada'],
    ['error', 'Error'],
    ['reemplazada', 'Reemplazada'],
  ]
  const ejemplo: Record<Bucket, string> = {
    aceptada: 'ACEPTADO',
    enProceso: 'ENVIADO',
    sinConfirmar: 'ENVIO_INCIERTO',
    rechazada: 'RECHAZADO',
    noEncontrada: 'NO_ENCONTRADO',
    error: 'ERROR',
    reemplazada: 'RECHAZADO_ARCHIVADO',
  }
  for (const [bucket, texto] of BUCKETS) {
    assert.equal(bucketDe(ejemplo[bucket]), bucket)
    assert.deepEqual(textos(factura({ estado: ejemplo[bucket] })), ['Guardada', 'Enviada a la DGII', texto], bucket)
  }
})

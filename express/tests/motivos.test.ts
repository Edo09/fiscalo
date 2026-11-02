// lib/motivos: los motivos de un rechazo, tal como los dice la DGII (anexo 6.3: `respuesta_dgii.mensajes`, con `mensaje` y `error` de respaldo). El texto es de la DGII y
// se muestra tal cual: solo se recortan los bordes, se descartan los vacíos y se quitan los repetidos. Lo que no se puede leer no inventa motivos: da una lista vacía.
import assert from 'node:assert/strict'
import test from 'node:test'
import { respuestaDgii } from '../dev/mock/datos.mjs'
import { normalizarFactura } from '~/lib/filas'
import { extraerMotivos } from '~/lib/motivos'

test('extraerMotivos', () => {
  const j = JSON.stringify({ mensajes: [{ valor: 'Fecha de vencimiento de la secuencia vencida', codigo: 145 }] })
  assert.deepEqual(extraerMotivos(j), ['Fecha de vencimiento de la secuencia vencida'])
  assert.deepEqual(extraerMotivos({ mensajes: ['a', { valor: 'b' }, 'a', ' '] }), ['a', 'b'])
  assert.deepEqual(extraerMotivos({ mensaje: 'x' }), ['x'])
  for (const v of ['no es json', null, {}]) assert.deepEqual(extraerMotivos(v), [])
})

test('un texto JSON y el objeto ya leído dan lo mismo', () => {
  const objeto = { trackId: 'T1', codigo: '2', estado: 'Rechazado', mensajes: [{ valor: 'Motivo uno', codigo: 1 }, { valor: 'Motivo dos', codigo: 2 }] }
  assert.deepEqual(extraerMotivos(objeto), ['Motivo uno', 'Motivo dos'])
  assert.deepEqual(extraerMotivos(JSON.stringify(objeto)), ['Motivo uno', 'Motivo dos'])
  assert.deepEqual(extraerMotivos(`  \n${JSON.stringify(objeto)}\n `), ['Motivo uno', 'Motivo dos']) // el texto de la columna puede traer espacios en los bordes
})

test('mensajes: cada entrada es un texto o un objeto con `valor` de texto; lo demás no es un motivo', () => {
  const entradas = ['uno', { valor: 'dos', codigo: 2 }, { valor: 3 }, { codigo: 4 }, null, undefined, 5, true, ['seis'], { valor: ['siete'] }, { valor: null }, {}, 'ocho']
  assert.deepEqual(extraerMotivos({ mensajes: entradas }), ['uno', 'dos', 'ocho'])
})

test('el texto se deja como lo escribió la DGII: solo se recortan los bordes', () => {
  const texto = 'El RNC del comprador no coincide con su nombre.'
  assert.deepEqual(extraerMotivos({ mensajes: [`  ${texto}\t`, '\n  Segundo  motivo\ncon  dos líneas  \n'] }), [texto, 'Segundo  motivo\ncon  dos líneas']) // lo de adentro, tal cual
  const raros = ['  MAYÚSCULAS y minúsculas, acentos: áéíóú ñ ¿qué? «comillas» "rectas" 100% & <b>etiqueta</b>', 'sin punto final', 'Con punto final.']
  assert.deepEqual(extraerMotivos({ mensajes: raros }), raros.map((t) => t.trim()))
  const largo = 'palabra '.repeat(500).trim()
  assert.deepEqual(extraerMotivos({ mensajes: [largo] }), [largo]) // no se acorta
})

test('los repetidos se quitan después de recortar, la primera vez gana el lugar, y mayúsculas y minúsculas no son lo mismo', () => {
  assert.deepEqual(extraerMotivos({ mensajes: ['a', ' a ', { valor: 'a' }, 'b', 'a', 'A', { valor: ' b' }] }), ['a', 'b', 'A'])
  assert.deepEqual(extraerMotivos({ mensajes: [' ', '', '\n\t', { valor: '  ' }] }), []) // solo espacios no es un motivo
})

test('sin motivos en `mensajes` se lee `mensaje` y, si no, `error`: el primero que diga algo, uno solo', () => {
  assert.deepEqual(extraerMotivos({ mensajes: [], mensaje: 'x', error: 'y' }), ['x'])
  assert.deepEqual(extraerMotivos({ mensajes: [' ', null], mensaje: ' x ', error: 'y' }), ['x'])
  assert.deepEqual(extraerMotivos({ mensajes: [], mensaje: '', error: 'y' }), ['y'])
  assert.deepEqual(extraerMotivos({ mensaje: '   ', error: ' y ' }), ['y'])
  assert.deepEqual(extraerMotivos({ error: 'y' }), ['y'])
  assert.deepEqual(extraerMotivos({ mensaje: 'x', error: 'y' }), ['x']) // el respaldo no suma `error`
  assert.deepEqual(extraerMotivos({ mensajes: ['a'], mensaje: 'x', error: 'y' }), ['a']) // con motivos, el respaldo no se lee
  assert.deepEqual(extraerMotivos({ mensaje: 5, error: ['z'] }), []) // el respaldo es de texto
  assert.deepEqual(extraerMotivos({ mensaje: { valor: 'x' }, error: { valor: 'y' } }), [])
  assert.deepEqual(extraerMotivos({ mensajes: 'texto suelto', mensaje: 'x' }), ['x']) // `mensajes` que no es una lista no cuenta, y el respaldo sí
  assert.deepEqual(extraerMotivos({ mensajes: { valor: 'a' } }), [])
  assert.deepEqual(extraerMotivos({ mensajes: null, error: 'y' }), ['y'])
})

test('lo que no se puede leer da una lista vacía, sin lanzar', () => {
  const sinMotivos = ['no es json', '', '   ', '{', '{"mensajes": ["a"]', null, undefined, {}, [], 42, 0, true, false, '123', '"texto"', 'null', 'true', '[]', '[{"mensajes":["a"]}]', [{ mensajes: ['a'] }], Symbol('x')]
  for (const v of sinMotivos) assert.deepEqual(extraerMotivos(v), [], String(typeof v === 'symbol' ? 'symbol' : JSON.stringify(v)))
  assert.deepEqual(extraerMotivos(() => ({ mensajes: ['a'] })), []) // una función no es una respuesta
  assert.deepEqual(extraerMotivos(new Date()), [])
  assert.deepEqual(extraerMotivos('{"__proto__": {"mensajes": ["heredado"]}}'), []) // la clave `__proto__` de un JSON es una propiedad más: no cambia de qué hereda nada
})

test('da una lista nueva cada vez y no toca lo que recibe', () => {
  const entrada = Object.freeze({ mensajes: Object.freeze(['a', ' b ', 'a']) })
  const una = extraerMotivos(entrada)
  una.push('x')
  assert.deepEqual(extraerMotivos(entrada), ['a', 'b'])
  assert.deepEqual(entrada.mensajes, ['a', ' b ', 'a'])
  assert.notEqual(extraerMotivos(entrada), extraerMotivos(entrada))
})

// --- Lo que guarda el API ------------------------------------------------------------------------------------------------------------------

test('con lo que guarda el API (el mock replica su `respuesta_dgii`): los motivos de un rechazo, tal cual, y nada en lo demás', () => {
  const MOTIVOS = [
    { valor: 'Fecha de vencimiento de la secuencia vencida', codigo: 145 },
    { valor: 'El RNC del comprador no coincide con su nombre.', codigo: 1 },
  ]
  const columna = (estado: string, mensajes: { valor: string; codigo: number }[] = []): string | null =>
    respuestaDgii(estado, { trackId: 'T1', rnc: '131000001', encf: 'E450000000013', fecha: '2026-10-26 09:41:00', mensajes })
  const LEIDOS = MOTIVOS.map((m) => m.valor)

  // la columna como texto, tal como llega del API, y ya leída por normalizarFactura (lo que ve la pantalla)
  for (const estado of ['RECHAZADO', 'RFCE_RECHAZADO', 'RECHAZADO_ARCHIVADO']) {
    assert.deepEqual(extraerMotivos(columna(estado, MOTIVOS)), LEIDOS, estado)
    assert.deepEqual(extraerMotivos(normalizarFactura({ id: 1, estado_dgii: estado, respuesta_dgii: columna(estado, MOTIVOS) }).respuestaDgii), LEIDOS, estado)
  }
  // un rechazo sin lista de motivos no inventa ninguno
  assert.deepEqual(extraerMotivos(columna('RECHAZADO')), [])
  // un ERROR guarda `mensaje` (el detalle) y `error` (lo general): se lee `mensaje`
  assert.deepEqual(extraerMotivos(columna('ERROR')), ['Tiempo de espera agotado'])
  // lo que todavía no dio motivos: aceptado, en proceso, no encontrado, y lo que está en vuelo (sin respuesta: la columna es null)
  for (const estado of ['ACEPTADO', 'ENVIADO', 'EN_PROCESO', 'NO_ENCONTRADO', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO']) {
    assert.deepEqual(extraerMotivos(columna(estado)), [], estado)
    assert.deepEqual(extraerMotivos(normalizarFactura({ id: 1, estado_dgii: estado, respuesta_dgii: columna(estado) }).respuestaDgii), [], estado)
  }
})

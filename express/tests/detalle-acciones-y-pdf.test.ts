// screens/detalle: lo que no es de React y fija cómo se comporta el detalle de una factura: el registro de acciones (una sin manejador no se dibuja), la verificación (una sola consulta en
// vuelo por factura, su error a la vista y lo que recarga) y los PDF en memoria (los tres últimos). Ninguna petición sale de la máquina: `fetch` es falso.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { ApiError } from '@/api/errores'
import { queryClient } from '~/queryClient'
import { manejadorDe, registrarAccionDetalle } from '~/screens/detalle/acciones-registro'
import { guardarPdf, pdfEnMano } from '~/screens/detalle/pdf'
import { esFalloDeRed, estadoDeVerificacion, olvidarVerificacion, verificarEstado } from '~/screens/detalle/verificar'

const fetchReal = globalThis.fetch
let pedidas: string[] = []
let contestar: () => Promise<Response>

const json = (status: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  pedidas = []
  contestar = async () => json(200, { status: true, data: { factura_id: 7, estado_dgii: 'ACEPTADO' } })
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    pedidas.push(String(url))
    return contestar()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = fetchReal
  olvidarVerificacion(7)
  queryClient.clear()
})

test('el registro: una acción sin manejador no está, y la que se registra se encuentra', () => {
  const duplicar = (): void => undefined
  assert.equal(manejadorDe('duplicar'), undefined)
  registrarAccionDetalle('duplicar', duplicar)
  assert.equal(manejadorDe('duplicar'), duplicar)
  assert.equal(manejadorDe('anular'), undefined) // lo de otro plan no aparece por sí solo
})

test('verificarEstado: dos toques a la vez son UNA petición, y al volver recarga las facturas y las estadísticas pero no los avisos', async () => {
  queryClient.setQueryData(['facturas', 'detalle', 7], { id: 7 })
  queryClient.setQueryData(['stats', 'light'], {})
  queryClient.setQueryData(['avisos'], {})
  const a = verificarEstado(7)
  const b = verificarEstado(7)
  assert.equal(a, b) // la misma consulta
  assert.equal(estadoDeVerificacion(7).preguntando, true)
  await a
  assert.deepEqual(pedidas, ['/api/facturas/7/estado'])
  assert.deepEqual(estadoDeVerificacion(7), { preguntando: false, error: null })
  assert.equal(queryClient.getQueryState(['facturas', 'detalle', 7])?.isInvalidated, true) // el detalle cuelga de ['facturas']
  assert.equal(queryClient.getQueryState(['stats', 'light'])?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(['avisos'])?.isInvalidated, false)
  // terminada la primera, otra consulta sale de nuevo
  await verificarEstado(7)
  assert.equal(pedidas.length, 2)
})

test('verificarEstado: el fallo del servidor deja su texto a la vista, se vuelve a lanzar y no recarga; el de red se reconoce', async () => {
  queryClient.setQueryData(['facturas', 'detalle', 7], { id: 7 })
  contestar = async () => json(422, { status: false, error: 'Esta factura no se envió a la DGII. Revísala en el listado.' })
  let fallo: unknown = null
  await verificarEstado(7).catch((e: unknown) => {
    fallo = e
  })
  assert.ok(fallo instanceof ApiError && fallo.status === 422)
  assert.equal(estadoDeVerificacion(7).error, fallo.message)
  assert.equal(estadoDeVerificacion(7).preguntando, false)
  assert.equal(esFalloDeRed(fallo), false) // el sondeo se detiene con este
  assert.equal(queryClient.getQueryState(['facturas', 'detalle', 7])?.isInvalidated, false)

  contestar = async () => {
    throw new TypeError('fetch failed')
  }
  const sinRed = await verificarEstado(7).catch((e: unknown) => e)
  assert.ok(sinRed instanceof ApiError)
  assert.equal(esFalloDeRed(sinRed), true) // este no detiene el sondeo
  assert.equal(esFalloDeRed(new Error('otra cosa')), false)
})

test('olvidarVerificacion suelta el error de una visita anterior, y no toca una consulta en curso', async () => {
  contestar = async () => json(422, { status: false, error: 'No se pudo consultar.' })
  await verificarEstado(7).catch(() => undefined)
  assert.notEqual(estadoDeVerificacion(7).error, null)
  olvidarVerificacion(7)
  assert.deepEqual(estadoDeVerificacion(7), { preguntando: false, error: null })

  let soltar: () => void = () => undefined
  contestar = () =>
    new Promise<Response>((resolver) => {
      soltar = () => resolver(json(200, { status: true, data: {} }))
    })
  const enCurso = verificarEstado(7)
  olvidarVerificacion(7)
  assert.equal(estadoDeVerificacion(7).preguntando, true)
  soltar()
  await enCurso
  assert.equal(estadoDeVerificacion(7).preguntando, false)
})

test('los PDF en memoria son los tres últimos, y volver a guardar uno lo hace el más reciente', () => {
  const pdf = (id: number) => ({ blob: new Blob([String(id)]), filename: `${id}.pdf` })
  for (const id of [1, 2, 3, 4]) guardarPdf(id, pdf(id))
  assert.equal(pdfEnMano(1), undefined) // el más viejo se soltó
  assert.equal(pdfEnMano(4)?.filename, '4.pdf')
  guardarPdf(2, pdf(2)) // 2 pasa a ser el más reciente: ahora el más viejo es el 3
  guardarPdf(5, pdf(5))
  assert.equal(pdfEnMano(3), undefined)
  assert.deepEqual([2, 4, 5].map((id) => pdfEnMano(id)?.filename), ['2.pdf', '4.pdf', '5.pdf'])
})

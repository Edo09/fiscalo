// lib/version: cómo sabe la app que salió una versión nueva. `esVersionNueva` compara el BUILD_ID con el version.json que hay en el servidor;
// `pedirVersionRemota` lo pide; `crearVigiaDeVersion` decide cuándo (al volver a primer plano, a lo sumo cada 10 minutos y nunca con una factura
// en vuelo o sin confirmar) y recuerda lo que vio. `useVersionNueva` es solo el pegamento de React sobre eso. Aquí no hay DOM: el documento es
// falso y el reloj lo mueve cada prueba.
import assert from 'node:assert/strict'
import test from 'node:test'
import { crearVigiaDeVersion, esVersionNueva, INTERVALO_VERSION_MS, pedirVersionRemota } from '~/lib/version'
import { esperar } from './ayudas'

type DocumentoVisible = Parameters<typeof crearVigiaDeVersion>[0]['doc']
type Buscar = NonNullable<Parameters<typeof pedirVersionRemota>[0]>

const A = '26.10.26-a1b2c3d'
const B = '26.10.27-ffffff0'

// --- esVersionNueva -----------------------------------------------------------------------------------------------------------------

test('esVersionNueva', () => {
  assert.equal(esVersionNueva(A, { version: B }), true)
  assert.equal(esVersionNueva(A, { version: A }), false)
  for (const a of ['local', 'dev']) assert.equal(esVersionNueva(a, { version: 'x' }), false)
  for (const r of [null, {}, { version: 5 }]) assert.equal(esVersionNueva(A, r), false)
})

test('esVersionNueva: solo vale un version de texto con contenido, y lo demás del JSON no cuenta', () => {
  for (const r of [undefined, '', 'x', 5, true, [], [B], { version: '' }, { version: null }, { version: [B] }, { version: { id: B } }]) {
    assert.equal(esVersionNueva(A, r), false, JSON.stringify(r))
  }
  assert.equal(esVersionNueva(A, { version: B, construido: '2026-10-27T12:00:00.000Z' }), true)
  assert.equal(esVersionNueva(A, { construido: '2026-10-27T12:00:00.000Z' }), false)
})

test('esVersionNueva: una compilación sin identificar (vacía, dev o local) no se compara con nada', () => {
  for (const a of ['', 'dev', 'local']) assert.equal(esVersionNueva(a, { version: B }), false, JSON.stringify(a))
  // Sin git la compilación sale 26.10.29-local (fecha y sha): esa sí es de un día concreto, y se compara.
  assert.equal(esVersionNueva('26.10.29-local', { version: '26.10.30-local' }), true)
  assert.equal(esVersionNueva('26.10.29-local', { version: '26.10.29-local' }), false)
})

// --- pedirVersionRemota -------------------------------------------------------------------------------------------------------------

test('pedirVersionRemota: pide /version.json con un parámetro que salta cualquier caché, sin guardarlo y con plazo, y entrega el JSON', async () => {
  const llamadas: Array<{ url: string; cache: string; signal: unknown }> = []
  const buscar: Buscar = async (url, init) => {
    llamadas.push({ url, cache: init.cache, signal: init.signal })
    return { ok: true, json: async () => ({ version: B }) }
  }
  assert.deepEqual(await pedirVersionRemota(buscar, () => 1234), { version: B })
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].url, '/version.json?t=1234')
  assert.equal(llamadas[0].cache, 'no-store')
  assert.ok(llamadas[0].signal instanceof AbortSignal)
})

test('pedirVersionRemota: rechaza con un HTTP que no es 2xx y con un cuerpo que no es JSON (el shell que sirve un servidor sin version.json)', async () => {
  const noEncontrado: Buscar = async () => ({ ok: false, json: async () => ({ version: B }) })
  await assert.rejects(pedirVersionRemota(noEncontrado, () => 1))
  const html: Buscar = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    },
  })
  await assert.rejects(pedirVersionRemota(html, () => 1), SyntaxError)
  const sinRed: Buscar = async () => {
    throw new TypeError('Failed to fetch')
  }
  await assert.rejects(pedirVersionRemota(sinRed, () => 1), TypeError)
})

// --- El vigía -----------------------------------------------------------------------------------------------------------------------

/** Un documento falso: guarda los oyentes de `visibilitychange` y `poner` cambia el estado de visibilidad y emite el evento, como el navegador. */
function documentoFalso(inicial: 'visible' | 'hidden' = 'visible') {
  let estado = inicial
  const oyentes = new Set<() => void>()
  return {
    doc: {
      get visibilityState() {
        return estado
      },
      addEventListener: (tipo: string, oyente: () => void): void => {
        if (tipo === 'visibilitychange') oyentes.add(oyente)
      },
      removeEventListener: (tipo: string, oyente: () => void): void => {
        if (tipo === 'visibilitychange') oyentes.delete(oyente)
      },
    } as unknown as DocumentoVisible,
    poner(nuevo: 'visible' | 'hidden'): void {
      estado = nuevo
      for (const oyente of [...oyentes]) oyente()
    },
    oyentes: (): number => oyentes.size,
  }
}

/** Un vigía sobre un documento falso y un reloj que mueve la prueba. `servidor.respuesta` es lo que contesta el version.json; `pedidos.n`, cuántas veces se pidió. */
function armar(opts: { actual?: string; remota?: () => Promise<unknown> } = {}) {
  const pantalla = documentoFalso()
  const reloj = { t: 1_000_000 }
  const pedidos = { n: 0 }
  const servidor = { respuesta: (): Promise<unknown> => Promise.resolve({ version: A }) }
  const vigia = crearVigiaDeVersion({
    actual: opts.actual ?? A,
    doc: pantalla.doc,
    leerRemota: () => {
      pedidos.n++
      return (opts.remota ?? servidor.respuesta)()
    },
    ahoraMs: () => reloj.t,
  })
  return { pantalla, reloj, pedidos, servidor, vigia }
}

/** La app vuelve a primer plano: se oculta y se vuelve a mostrar. Deja correr las promesas pendientes. */
async function volver(pantalla: ReturnType<typeof documentoFalso>): Promise<void> {
  pantalla.poner('hidden')
  pantalla.poner('visible')
  await esperar()
}

test('el vigía pregunta al volver a primer plano y, si la versión es otra, lo recuerda y avisa una sola vez', async () => {
  const { pantalla, pedidos, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.resolve({ version: B })
  let avisos = 0
  vigia.suscribir(() => void avisos++)
  vigia.vigilar(() => false)
  assert.deepEqual([vigia.hayNueva(), pedidos.n, avisos], [false, 0, 0]) // arrancar no pregunta: la app acaba de bajar

  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n, avisos], [true, 1, 1])
})

test('una pestaña que pasa a oculta no pregunta nada', async () => {
  const { pantalla, pedidos, vigia } = armar()
  vigia.vigilar(() => false)
  pantalla.poner('hidden')
  await esperar()
  assert.equal(pedidos.n, 0)
})

test('a lo sumo una pregunta cada 10 minutos, medidos desde la última que se hizo', async () => {
  const { pantalla, reloj, pedidos, vigia } = armar()
  vigia.vigilar(() => false)
  await volver(pantalla)
  assert.equal(pedidos.n, 1)

  reloj.t += INTERVALO_VERSION_MS - 1
  await volver(pantalla)
  assert.equal(pedidos.n, 1) // un milisegundo antes: no

  reloj.t += 1
  await volver(pantalla)
  assert.equal(pedidos.n, 2) // justo a los 10 minutos: sí

  reloj.t += 60_000
  await volver(pantalla)
  assert.equal(pedidos.n, 2) // y de nuevo hay que esperar los 10 minutos desde esa
  assert.equal(INTERVALO_VERSION_MS, 600_000)
})

test('con la misma versión no avisa y vuelve a preguntar pasados los 10 minutos', async () => {
  const { pantalla, reloj, pedidos, vigia } = armar()
  let avisos = 0
  vigia.suscribir(() => void avisos++)
  vigia.vigilar(() => false)
  await volver(pantalla)
  reloj.t += INTERVALO_VERSION_MS
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n, avisos], [false, 2, 0])
})

test('con una factura en vuelo o sin confirmar no pregunta, y esa vuelta no gasta el intervalo', async () => {
  const { pantalla, reloj, pedidos, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.resolve({ version: B })
  let ocupada = true
  vigia.vigilar(() => ocupada)

  await volver(pantalla)
  reloj.t += 3_000
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [false, 0]) // ocupada: ni una pregunta

  ocupada = false
  reloj.t += 3_000 // sin haber pasado 10 minutos desde nada: la espera de arriba no contó
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [true, 1])
})

test('una vez que vio la versión nueva ya no pregunta más, y sigue diciendo que hay una', async () => {
  const { pantalla, reloj, pedidos, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.resolve({ version: B })
  vigia.vigilar(() => false)
  await volver(pantalla)
  reloj.t += 5 * INTERVALO_VERSION_MS
  servidor.respuesta = () => Promise.resolve({ version: A }) // aunque el servidor volviera a la de antes (un rollback), el aviso no se retira
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [true, 1])
})

test('una respuesta que falla (sin red, sin JSON) se ignora sin lanzar ni avisar, y tampoco se reintenta antes de tiempo', async () => {
  const { pantalla, reloj, pedidos, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.reject(new TypeError('Failed to fetch'))
  vigia.vigilar(() => false)
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [false, 1])

  reloj.t += 60_000
  await volver(pantalla)
  assert.equal(pedidos.n, 1) // una pregunta que falla cuenta: con la red mala no se insiste en cada vuelta

  servidor.respuesta = () => Promise.resolve({ version: B })
  reloj.t += INTERVALO_VERSION_MS
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [true, 2])
})

test('una respuesta que no es el version.json (otro objeto, null) no avisa', async () => {
  const { pantalla, reloj, pedidos, servidor, vigia } = armar()
  vigia.vigilar(() => false)
  for (const respuesta of [null, {}, { version: 5 }, { version: '' }]) {
    servidor.respuesta = () => Promise.resolve(respuesta)
    reloj.t += INTERVALO_VERSION_MS
    await volver(pantalla)
  }
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [false, 4])
})

test('dos componentes que vigilan a la vez comparten el intervalo: un solo pedido por vuelta', async () => {
  const { pantalla, reloj, pedidos, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.resolve({ version: B })
  const dejarDeVigilarUno = vigia.vigilar(() => false)
  vigia.vigilar(() => false)
  assert.equal(pantalla.oyentes(), 2)
  await volver(pantalla)
  assert.deepEqual([vigia.hayNueva(), pedidos.n], [true, 1])

  dejarDeVigilarUno()
  assert.equal(pantalla.oyentes(), 1) // cada vigilancia se cancela por separado
  reloj.t += INTERVALO_VERSION_MS
  await volver(pantalla)
  assert.equal(pedidos.n, 1)
})

test('mientras una pregunta sigue en vuelo otra vuelta no lanza una segunda', async () => {
  let responder: (valor: unknown) => void = () => {}
  const { pantalla, reloj, pedidos, vigia } = armar({ remota: () => new Promise((resolver) => (responder = resolver)) })
  vigia.vigilar(() => false)
  await volver(pantalla)
  assert.equal(pedidos.n, 1)
  reloj.t += 1000
  await volver(pantalla)
  assert.equal(pedidos.n, 1)
  responder({ version: B })
  await esperar()
  assert.equal(vigia.hayNueva(), true)
})

test('cancelar la vigilancia quita el oyente del documento, y se puede cancelar dos veces', async () => {
  const { pantalla, pedidos, vigia } = armar()
  assert.equal(pantalla.oyentes(), 0) // crear el vigía no registra nada
  const cancelar = vigia.vigilar(() => false)
  assert.equal(pantalla.oyentes(), 1)
  cancelar()
  cancelar()
  assert.equal(pantalla.oyentes(), 0)
  await volver(pantalla)
  assert.equal(pedidos.n, 0)
})

test('una compilación sin identificar (dev o local) no pregunta nada: no hay con qué comparar', async () => {
  for (const actual of ['dev', 'local', '']) {
    const { pantalla, pedidos, vigia } = armar({ actual })
    vigia.vigilar(() => false)
    await volver(pantalla)
    assert.deepEqual([vigia.hayNueva(), pedidos.n], [false, 0], JSON.stringify(actual))
  }
})

test('suscribir: cada suscripción se cancela por separado, y cancelar dos veces no rompe nada', async () => {
  const { pantalla, servidor, vigia } = armar()
  servidor.respuesta = () => Promise.resolve({ version: B })
  const avisos = { a: 0, b: 0 }
  const cancelarA = vigia.suscribir(() => void avisos.a++)
  const cancelarB = vigia.suscribir(() => void avisos.b++)
  cancelarA()
  cancelarA()
  vigia.vigilar(() => false)
  await volver(pantalla)
  assert.deepEqual(avisos, { a: 0, b: 1 })
  cancelarB()
})

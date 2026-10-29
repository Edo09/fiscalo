// El shim de AbortSignal.timeout. La función existe desde Chrome 103 y Safari 16, y el piso de la app es Chrome 90 e iOS 14.5: sin ella,
// cada pedido de src/api/http.ts lanzaría TypeError antes de salir y la app lo mostraría como «sin conexión».
import assert from 'node:assert/strict'
import test from 'node:test'
import { esperar } from './ayudas'
import { instalarPolyfills } from '~/polyfills'

/** Corre `fn` sin `AbortSignal.timeout`, como en Chrome 90, y lo deja como estaba (con su descriptor original) pase lo que pase. */
async function sinNativo(fn: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
  assert.ok(original, 'este Node no trae AbortSignal.timeout: no hay nada que quitar')
  Reflect.deleteProperty(AbortSignal, 'timeout')
  try {
    await fn()
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', original)
  }
}

test('AbortSignal.timeout ausente: el shim aborta', async () => {
  await sinNativo(async () => {
    assert.equal(typeof AbortSignal.timeout, 'undefined')
    instalarPolyfills()
    const senal = AbortSignal.timeout(10)
    assert.equal(senal.aborted, false)
    await esperar(60)
    assert.equal(senal.aborted, true)
  })
})

test('con el nativo presente no lo pisa', () => {
  const nativo = AbortSignal.timeout
  instalarPolyfills()
  assert.equal(AbortSignal.timeout, nativo)
})

test('el shim agenda el aborto con el setTimeout de g y los ms pedidos, y llama a abort() sin motivo', () => {
  // abort(motivo) es de Chrome 98: en Chrome 90 el argumento se ignoraría, así que no se pasa ninguno. El pedido que se aborta falla con
  // AbortError, y networkError (src/api/errores.ts) lo lee igual que el TimeoutError del nativo.
  const agendados: Array<{ accion: () => void; ms: number }> = []
  const llamadasAbort: unknown[][] = []
  class ControladorEspia {
    signal = { aborted: false }
    abort(...argumentos: unknown[]): void {
      llamadasAbort.push(argumentos)
      this.signal.aborted = true
    }
  }
  const g = {
    AbortSignal: {},
    AbortController: ControladorEspia,
    setTimeout: (accion: () => void, ms: number): number => agendados.push({ accion, ms }),
  } as unknown as typeof globalThis

  instalarPolyfills(g)
  const senal = g.AbortSignal.timeout(250)
  assert.deepEqual(
    agendados.map((a) => a.ms),
    [250],
  )
  assert.equal(senal.aborted, false)

  agendados[0].accion()
  assert.equal(senal.aborted, true)
  assert.deepEqual(llamadasAbort, [[]])
})

test('con g que ya trae AbortSignal.timeout no lo pisa', () => {
  const nativo = (): AbortSignal => new AbortController().signal
  const g = { AbortSignal: { timeout: nativo }, setTimeout: () => 0 } as unknown as typeof globalThis
  instalarPolyfills(g)
  assert.equal(g.AbortSignal.timeout, nativo)
})

test('importar polyfills.ts instala el shim: main.tsx solo lo importa, no llama a nada', async () => {
  await sinNativo(async () => {
    // Un especificador con otra consulta es otra instancia del módulo, y su cuerpo vuelve a correr contra un AbortSignal sin `timeout`.
    const especificador: string = '~/polyfills.ts?sin-nativo'
    await import(especificador)
    assert.equal(typeof AbortSignal.timeout, 'function')
    const senal = AbortSignal.timeout(10)
    await esperar(60)
    assert.equal(senal.aborted, true)
  })
})

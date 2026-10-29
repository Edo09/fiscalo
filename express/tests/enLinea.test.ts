// net/enLinea: el estado de la conexión (banner «sin conexión», botones que necesitan red) y el aviso de que la app volvió a primer
// plano tras un rato. Aquí no hay DOM, así que no se montan los ganchos de React: se prueba lo que deciden, que son funciones sobre una
// ventana y un documento falsos que se portan como los del navegador.
import assert from 'node:assert/strict'
import test from 'node:test'
import { crearMonitorEnLinea, escucharVuelta } from '~/net/enLinea'

type VentanaDeRed = Parameters<typeof crearMonitorEnLinea>[0]
type DocumentoVisible = Parameters<typeof escucharVuelta>[0]

/**
 * Una ventana falsa con la regla del navegador: cuando la red cambia, `navigator.onLine` ya dice lo nuevo al llegar el evento.
 * Los oyentes se guardan como en el DOM: una misma función registrada dos veces para el mismo evento cuenta una sola vez.
 */
function crearRedFalsa() {
  const oyentes = new Map<string, Set<() => void>>()
  let conRed = true
  const emitir = (tipo: string): void => {
    for (const oyente of [...(oyentes.get(tipo) ?? [])]) oyente()
  }
  return {
    ventana: {
      addEventListener: (tipo: string, oyente: () => void): void => {
        oyentes.set(tipo, (oyentes.get(tipo) ?? new Set<() => void>()).add(oyente))
      },
      removeEventListener: (tipo: string, oyente: () => void): void => {
        oyentes.get(tipo)?.delete(oyente)
      },
    } as unknown as VentanaDeRed,
    leer: (): boolean => conRed,
    perderRed(): void {
      conRed = false
      emitir('offline')
    },
    recuperarRed(): void {
      conRed = true
      emitir('online')
    },
    oyentes: (): number => [...oyentes.values()].reduce((suma, tipo) => suma + tipo.size, 0),
  }
}

test('offline y luego online cambian leer() y avisan una vez cada uno; desuscribir corta los avisos', () => {
  const red = crearRedFalsa()
  const monitor = crearMonitorEnLinea(red.ventana, red.leer)
  let avisos = 0
  const desuscribir = monitor.suscribir(() => {
    avisos++
  })
  assert.deepEqual([monitor.leer(), avisos], [true, 0])

  red.perderRed()
  assert.deepEqual([monitor.leer(), avisos], [false, 1])
  red.recuperarRed()
  assert.deepEqual([monitor.leer(), avisos], [true, 2])

  desuscribir()
  red.perderRed()
  assert.deepEqual([monitor.leer(), avisos], [false, 2]) // el estado sigue al navegador; ya nadie recibe el aviso
  assert.equal(red.oyentes(), 0) // y no queda ningún oyente en la ventana
})

test('sin suscriptores no hay oyentes en la ventana, y crear el monitor no registra ninguno', () => {
  const red = crearRedFalsa()
  const monitor = crearMonitorEnLinea(red.ventana, red.leer)
  assert.equal(red.oyentes(), 0)
  const desuscribir = monitor.suscribir(() => {})
  assert.equal(red.oyentes(), 2) // online y offline
  desuscribir()
  desuscribir() // cancelar dos veces no rompe nada
  assert.equal(red.oyentes(), 0)
})

test('la misma función suscrita dos veces recibe dos avisos y cada suscripción se cancela por separado', () => {
  const red = crearRedFalsa()
  const monitor = crearMonitorEnLinea(red.ventana, red.leer)
  let avisos = 0
  const aviso = (): void => {
    avisos++
  }
  const primera = monitor.suscribir(aviso)
  const segunda = monitor.suscribir(aviso)

  red.perderRed()
  assert.equal(avisos, 2)
  primera()
  red.recuperarRed()
  assert.equal(avisos, 3) // la segunda sigue
  segunda()
  red.perderRed()
  assert.equal(avisos, 3)
  assert.equal(red.oyentes(), 0)
})

test('con un EventTarget de verdad', () => {
  const ventana = new EventTarget()
  let conRed = true
  const monitor = crearMonitorEnLinea(ventana as unknown as VentanaDeRed, () => conRed)
  let avisos = 0
  const desuscribir = monitor.suscribir(() => {
    avisos++
  })

  conRed = false
  ventana.dispatchEvent(new Event('offline'))
  assert.deepEqual([monitor.leer(), avisos], [false, 1])
  conRed = true
  ventana.dispatchEvent(new Event('online'))
  assert.deepEqual([monitor.leer(), avisos], [true, 2])

  desuscribir()
  ventana.dispatchEvent(new Event('offline'))
  assert.equal(avisos, 2)
})

// --- escucharVuelta: «al volver a la app» ---------------------------------------------------------------------------------------

/** Un documento falso: `cambiarA` cambia la visibilidad y emite `visibilitychange`, como el navegador. */
function crearDocumentoFalso(estado: DocumentVisibilityState = 'visible') {
  const oyentes = new Set<() => void>()
  const documento = {
    visibilityState: estado,
    addEventListener: (tipo: string, oyente: () => void): void => {
      if (tipo === 'visibilitychange') oyentes.add(oyente)
    },
    removeEventListener: (tipo: string, oyente: () => void): void => {
      if (tipo === 'visibilitychange') oyentes.delete(oyente)
    },
  }
  return {
    documento: documento as unknown as DocumentoVisible,
    cambiarA(nuevo: DocumentVisibilityState): void {
      documento.visibilityState = nuevo
      for (const oyente of [...oyentes]) oyente()
    },
    oyentes: (): number => oyentes.size,
  }
}

const MINUTO = 60_000

test('al volver a ser visible tras estar oculta al menos el mínimo, avisa; antes del mínimo, no', () => {
  const pagina = crearDocumentoFalso()
  let t = 0
  let avisos = 0
  escucharVuelta(pagina.documento, MINUTO, () => avisos++, () => t)

  pagina.cambiarA('hidden')
  t += MINUTO
  pagina.cambiarA('visible')
  assert.equal(avisos, 1) // justo el mínimo cuenta

  t += 1000
  pagina.cambiarA('hidden')
  t += MINUTO - 1
  pagina.cambiarA('visible')
  assert.equal(avisos, 1) // un milisegundo menos, no
})

test('el tiempo se cuenta desde que se oculta y cada ocultamiento avisa a lo sumo una vez', () => {
  const pagina = crearDocumentoFalso()
  let t = 0
  let avisos = 0
  escucharVuelta(pagina.documento, MINUTO, () => avisos++, () => t)

  t = 10 * MINUTO // mucho tiempo visible no cuenta
  pagina.cambiarA('hidden')
  t += 30_000
  pagina.cambiarA('visible')
  assert.equal(avisos, 0)

  pagina.cambiarA('hidden')
  t += 2 * MINUTO
  pagina.cambiarA('visible')
  pagina.cambiarA('visible') // un segundo visible seguido no es otro regreso
  assert.equal(avisos, 1)
})

test('visible sin haber estado oculta no avisa', () => {
  const pagina = crearDocumentoFalso('visible')
  let avisos = 0
  escucharVuelta(pagina.documento, 0, () => avisos++, () => 0)
  pagina.cambiarA('visible')
  assert.equal(avisos, 0)
})

test('una página que arranca oculta cuenta desde el arranque', () => {
  const pagina = crearDocumentoFalso('hidden')
  let t = 5000
  let avisos = 0
  escucharVuelta(pagina.documento, MINUTO, () => avisos++, () => t)
  t += MINUTO
  pagina.cambiarA('visible')
  assert.equal(avisos, 1)
})

test('sin reloj propio mide con Date.now', () => {
  const ahoraReal = Date.now
  let t = ahoraReal()
  Date.now = () => t
  try {
    const pagina = crearDocumentoFalso()
    let avisos = 0
    escucharVuelta(pagina.documento, MINUTO, () => avisos++)
    pagina.cambiarA('hidden')
    t += MINUTO - 1
    pagina.cambiarA('visible')
    assert.equal(avisos, 0)
    pagina.cambiarA('hidden')
    t += MINUTO
    pagina.cambiarA('visible')
    assert.equal(avisos, 1)
  } finally {
    Date.now = ahoraReal
  }
})

test('quien se desuscribe deja de recibir avisos y no queda oyente', () => {
  const pagina = crearDocumentoFalso()
  let avisos = 0
  const dejar = escucharVuelta(pagina.documento, 0, () => avisos++, () => 0)
  assert.equal(pagina.oyentes(), 1)
  dejar()
  assert.equal(pagina.oyentes(), 0)
  pagina.cambiarA('hidden')
  pagina.cambiarA('visible')
  assert.equal(avisos, 0)
})

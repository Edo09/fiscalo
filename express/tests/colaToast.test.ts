// ui/colaToast: la cola de avisos (uno a la vez), cuánto dura cada uno y el almacén que `mostrarToast` y `ToastHost` comparten. Es pura: el componente
// (ui/Toast.tsx) importa su CSS y Node no puede cargarlo, así que lo que decide qué se ve y cuánto dura vive aquí.
import assert from 'node:assert/strict'
import test from 'node:test'
import { agregar, crearColaToast, duracionMs } from '~/ui/colaToast'
import type { ToastItem } from '~/ui/colaToast'

test('colaToast', () => {
  const t = (deshacer?: () => void): ToastItem => ({ id: 1, texto: 'x', tipo: 'info', creadoEn: 0, deshacer })
  assert.equal(duracionMs(t()), 4000)
  assert.equal(duracionMs(t(() => {})), 6000)
  const nuevo = { ...t(), id: 2 }
  assert.equal(agregar(t(), nuevo), nuevo)
})

test('agregar sin aviso visible devuelve el nuevo, y el nuevo reemplaza al que se ve también cuando es de otro tipo', () => {
  const viejo: ToastItem = { id: 1, texto: 'No se pudo guardar', tipo: 'error', creadoEn: 0 }
  const nuevo: ToastItem = { id: 2, texto: 'Copiado', tipo: 'ok', creadoEn: 10 }
  assert.equal(agregar(null, nuevo), nuevo)
  assert.equal(agregar(viejo, nuevo), nuevo) // un aviso a la vez: el último manda, también sobre un error
})

test('un aviso con deshacer dura 6 segundos y uno sin deshacer 4, sea cual sea su tipo', () => {
  for (const tipo of ['info', 'ok', 'error'] as const) {
    assert.equal(duracionMs({ id: 1, texto: 'x', tipo, creadoEn: 0 }), 4000, tipo)
    assert.equal(duracionMs({ id: 1, texto: 'x', tipo, creadoEn: 0, deshacer: () => {} }), 6000, tipo)
  }
})

test('la cola: mostrar da ids que suben, tipo info por defecto, la hora de ahora y deja el aviso como el visible', () => {
  let reloj = 1000
  const cola = crearColaToast(() => reloj)
  assert.equal(cola.leer(), null)

  const primero = cola.mostrar('Copiado')
  assert.deepEqual({ ...primero }, { id: 1, texto: 'Copiado', tipo: 'info', creadoEn: 1000, deshacer: undefined })
  assert.equal(cola.leer(), primero)

  reloj = 2500
  const deshacer = (): void => {}
  const segundo = cola.mostrar('Línea quitada', { deshacer, tipo: 'ok' })
  assert.deepEqual({ ...segundo }, { id: 2, texto: 'Línea quitada', tipo: 'ok', creadoEn: 2500, deshacer })
  assert.equal(cola.leer(), segundo) // reemplazó al primero
})

test('la cola avisa a quien escucha una vez por cambio, y dejar de escuchar corta los avisos', () => {
  const cola = crearColaToast(() => 0)
  let avisos = 0
  const dejar = cola.suscribir(() => {
    avisos++
  })
  cola.mostrar('a')
  cola.mostrar('b')
  assert.equal(avisos, 2)
  cola.descartar(2)
  assert.equal(avisos, 3)
  dejar()
  dejar() // dos veces no rompe nada
  cola.mostrar('c')
  assert.equal(avisos, 3)
})

test('la misma función suscrita dos veces recibe dos avisos y cada suscripción se cancela por separado', () => {
  const cola = crearColaToast(() => 0)
  let avisos = 0
  const aviso = (): void => {
    avisos++
  }
  const primera = cola.suscribir(aviso)
  const segunda = cola.suscribir(aviso)
  cola.mostrar('a')
  assert.equal(avisos, 2)
  primera()
  cola.mostrar('b')
  assert.equal(avisos, 3) // la segunda sigue
  segunda()
  cola.mostrar('c')
  assert.equal(avisos, 3)
})

test('descartar solo quita el aviso que se ve: el temporizador de uno viejo no se lleva al nuevo', () => {
  const cola = crearColaToast(() => 0)
  const viejo = cola.mostrar('viejo')
  const nuevo = cola.mostrar('nuevo') // reemplaza al viejo; el temporizador del viejo todavía existe
  let avisos = 0
  cola.suscribir(() => {
    avisos++
  })

  cola.descartar(viejo.id) // llega el temporizador del viejo
  assert.equal(cola.leer(), nuevo)
  assert.equal(avisos, 0) // y no hubo nada que avisar

  cola.descartar(999) // un id que no existe
  assert.equal(cola.leer(), nuevo)

  cola.descartar(nuevo.id)
  assert.equal(cola.leer(), null)
  assert.equal(avisos, 1)
  cola.descartar(nuevo.id) // ya no está
  assert.equal(avisos, 1)
})

test('leer devuelve el mismo objeto mientras no cambie nada (lo que useSyncExternalStore pide), y los ids no se repiten tras descartar', () => {
  const cola = crearColaToast(() => 0)
  const a = cola.mostrar('a')
  assert.equal(cola.leer(), cola.leer())
  cola.descartar(a.id)
  const b = cola.mostrar('b')
  assert.equal(b.id, 2) // el id no se reutiliza: el temporizador del primero no puede confundirse con el segundo
})

test('dos colas son independientes', () => {
  const una = crearColaToast(() => 0)
  const otra = crearColaToast(() => 0)
  una.mostrar('a')
  assert.equal(otra.leer(), null)
  assert.equal(otra.mostrar('b').id, 1)
})

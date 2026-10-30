// shell/desplazamiento: la memoria del desplazamiento de la página por pestaña. Aquí no hay DOM: se prueba contra un entorno falso que se porta como el navegador
// (acota el scroll a lo que hay para desplazar, lanza `scroll` cuando la posición cambia y avisa cuando la página crece), y se ve lo que la memoria decide.
import assert from 'node:assert/strict'
import test from 'node:test'
import { crearMemoriaDeDesplazamiento, ESPERA_RESTAURAR_MS } from '~/shell/desplazamiento'
import type { EntornoDeDesplazamiento } from '~/shell/desplazamiento'

/**
 * Una página falsa. `max` es lo que hay para desplazar (alto del contenido menos el de la ventana): `irA` se acota a eso, como `scrollTo`. Lo que dispara el
 * navegador por su cuenta se pide con `desplazarPorUsuario` (un gesto), `crecer` (llegan filas), `interactuar` (un toque, la rueda, una tecla) y `bloquear` (una hoja
 * fija el cuerpo). El reloj es falso: `pasar(ms)` lanza los temporizadores que vencen.
 */
function paginaFalsa(max = 10_000) {
  let y = 0
  let alto = max
  let bloqueada = false
  let ahora = 0
  const oyentes = { desplazar: new Set<() => void>(), crecer: new Set<() => void>(), interactuar: new Set<() => void>() }
  const temporizadores = new Map<number, { vence: number; cb: () => void }>()
  let siguiente = 1
  const pedidos: number[] = []
  const emitir = (conjunto: Set<() => void>): void => {
    for (const oyente of [...conjunto]) oyente()
  }
  const poner = (conjunto: Set<() => void>, cb: () => void): (() => void) => {
    conjunto.add(cb)
    return () => conjunto.delete(cb)
  }
  const entorno: EntornoDeDesplazamiento = {
    leerY: () => y,
    irA(destino) {
      pedidos.push(destino)
      const nuevo = Math.max(0, Math.min(destino, alto))
      if (nuevo === y) return
      y = nuevo
      emitir(oyentes.desplazar)
    },
    bloqueado: () => bloqueada,
    alDesplazar: (cb) => poner(oyentes.desplazar, cb),
    alCrecer: (cb) => poner(oyentes.crecer, cb),
    alInteractuar: (cb) => poner(oyentes.interactuar, cb),
    esperar(ms, cb) {
      const id = siguiente++
      temporizadores.set(id, { vence: ahora + ms, cb })
      return () => temporizadores.delete(id)
    },
  }
  return {
    entorno,
    get y() {
      return y
    },
    pedidos,
    /** El usuario deja la página en `nuevo`: el navegador lanza `scroll`. */
    desplazarPorUsuario(nuevo: number) {
      y = nuevo
      emitir(oyentes.desplazar)
    },
    /** Cambia lo que hay para desplazar (llegan filas o se va un esqueleto) y el navegador avisa del cambio de tamaño. */
    crecer(nuevoMax: number) {
      alto = nuevoMax
      emitir(oyentes.crecer)
    },
    /** Fija lo que hay para desplazar sin avisar de nada: el estado de la página antes de que alguien mire. */
    fijarMax(nuevoMax: number) {
      alto = nuevoMax
    },
    /** Una hoja bloquea (o libera) el scroll de la página. */
    bloquear(valor: boolean) {
      bloqueada = valor
    },
    interactuar: () => emitir(oyentes.interactuar),
    pasar(ms: number) {
      ahora += ms
      for (const [id, t] of [...temporizadores]) {
        if (t.vence > ahora) continue
        temporizadores.delete(id)
        t.cb()
      }
    },
    /** Cuántos oyentes y temporizadores quedan puestos: lo que una memoria bien portada suelta al terminar. */
    puestos: () => ({ desplazar: oyentes.desplazar.size, crecer: oyentes.crecer.size, interactuar: oyentes.interactuar.size, temporizadores: temporizadores.size }),
  }
}

const NADA = { desplazar: 0, crecer: 0, interactuar: 0, temporizadores: 0 }

test('recordar guarda el desplazamiento de cada pestaña y restaurar devuelve la página a él', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)

  const dejarClientes = memoria.recordar('clientes')
  p.desplazarPorUsuario(400)
  dejarClientes()
  const dejarFacturas = memoria.recordar('facturas')
  p.desplazarPorUsuario(700)
  dejarFacturas()

  memoria.restaurar('clientes')
  assert.equal(p.y, 400)
  memoria.restaurar('facturas')
  assert.equal(p.y, 700)
  assert.deepEqual(p.puestos(), NADA, 'si llegó de una vez no queda nada vigilando')
})

test('una pestaña que nunca se vio empieza arriba, y restaurar sin nada guardado no vigila nada', () => {
  const p = paginaFalsa()
  p.desplazarPorUsuario(250) // venía de otra pantalla
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  memoria.restaurar('productos')
  assert.equal(p.y, 0)
  assert.deepEqual(p.puestos(), NADA)
})

test('recordar deja de guardar cuando se suelta: una pestaña no pisa el desplazamiento de otra', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejarClientes = memoria.recordar('clientes')
  p.desplazarPorUsuario(400)
  dejarClientes()
  assert.equal(p.puestos().desplazar, 0)
  p.desplazarPorUsuario(0) // ya en otra pantalla: lo que pase aquí no es de Clientes
  memoria.restaurar('clientes')
  assert.equal(p.y, 400)
})

// iOS 15 y anteriores no entienden `overscroll-behavior: contain`, así que la hoja de Más fija el cuerpo: `scrollY` pasa a 0 y el navegador lanza un `scroll`. Ese 0 no es del
// usuario. Antes de este arreglo la memoria lo guardaba, y tras abrir Más, tocar una fila y volver con atrás la pestaña quedaba arriba y no donde estaba.
test('con el scroll bloqueado por una hoja, el scroll con scrollY 0 no pisa lo guardado', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  memoria.recordar('clientes')
  p.desplazarPorUsuario(400)

  p.bloquear(true) // se abre Más
  p.desplazarPorUsuario(0) // lo que lanza el navegador al fijar el cuerpo
  p.bloquear(false) // una fila de Más cambia de pantalla: la hoja se va y libera el cuerpo

  memoria.restaurar('clientes') // atrás: otra vez Clientes
  assert.equal(p.y, 400)
})

test('con el scroll desbloqueado, un scroll vuelve a guardarse', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  memoria.recordar('clientes')
  p.bloquear(true)
  p.desplazarPorUsuario(0)
  p.bloquear(false)
  p.desplazarPorUsuario(90)
  p.desplazarPorUsuario(0)
  memoria.restaurar('clientes')
  assert.equal(p.y, 0, 'el último scroll del usuario manda')
})

// Una pantalla que pinta un esqueleto corto y trae las filas después: `scrollTo` se acota a lo que hay y el desplazamiento se perdía.
test('restaurar espera a que la página crezca: con un esqueleto corto se acota y al llegar las filas vuelve al punto guardado', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0) // se fue a un detalle

  // Vuelve a la pestaña y las filas todavía no llegaron: no hay más que 100 para desplazar.
  p.fijarMax(100)
  memoria.recordar('clientes')
  memoria.restaurar('clientes')
  assert.equal(p.y, 100, 'el navegador la acota al final de lo que hay')
  assert.deepEqual(p.puestos().crecer, 1, 'sigue vigilando el tamaño de la página')

  p.crecer(5000) // llegan las filas
  assert.equal(p.y, 700)
  assert.deepEqual(p.puestos(), { ...NADA, desplazar: 1 }, 'al llegar suelta lo que vigilaba (queda solo el oyente de recordar)')
})

test('mientras espera, el scroll que dejó el navegador al acotar no pisa lo guardado: irse antes de que lleguen las filas no pierde el punto', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0)

  p.fijarMax(100)
  memoria.recordar('clientes')
  const irse = memoria.restaurar('clientes') // la acotación a 100 lanza un scroll
  irse() // la pantalla se va (otro cambio de pestaña) antes de que lleguen las filas

  p.fijarMax(5000)
  memoria.restaurar('clientes')
  assert.equal(p.y, 700, 'lo guardado sigue siendo 700 y no el 100 de la acotación')
})

test('si el usuario toma el control (un gesto) deja de insistir, y su scroll vuelve a guardarse', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0)

  p.fijarMax(100)
  memoria.recordar('clientes')
  memoria.restaurar('clientes')
  p.interactuar() // el dedo toca la pantalla: la página es suya
  assert.deepEqual(p.puestos(), { ...NADA, desplazar: 1 })

  p.crecer(5000) // las filas llegan, pero ya no hay quien las espere
  assert.equal(p.y, 100)
  p.desplazarPorUsuario(30)
  memoria.restaurar('clientes')
  assert.equal(p.y, 30, 'tras el gesto, lo que hace el usuario es lo que se recuerda')
})

test(`pasados ${ESPERA_RESTAURAR_MS} ms deja de insistir: unas filas que nunca llegan no dejan la memoria vigilando`, () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0)

  p.fijarMax(100)
  memoria.restaurar('clientes')
  p.pasar(ESPERA_RESTAURAR_MS - 1)
  assert.equal(p.puestos().crecer, 1, 'un milisegundo antes sigue esperando')
  p.pasar(1)
  assert.deepEqual(p.puestos(), NADA)

  p.crecer(5000)
  assert.equal(p.y, 100, 'ya no mueve la página')
})

test('la función que devuelve restaurar suelta todo (la pantalla se va) y llamarla dos veces no descuenta la espera de otra', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0)

  p.fijarMax(100)
  memoria.recordar('clientes')
  const primera = memoria.restaurar('clientes')
  const segunda = memoria.restaurar('clientes') // StrictMode, o un cambio de pestaña muy seguido
  primera()
  primera() // llamarla dos veces no puede descontar la espera de la segunda
  assert.equal(p.puestos().crecer, 1, 'la segunda espera sigue puesta')
  p.desplazarPorUsuario(100) // el navegador vuelve a acotar mientras la segunda espera: eso tampoco se guarda
  segunda()
  assert.deepEqual(p.puestos(), { ...NADA, desplazar: 1 }, 'queda solo el oyente de recordar')

  p.fijarMax(5000)
  memoria.restaurar('clientes')
  assert.equal(p.y, 700, 'lo guardado sigue siendo 700')

  // Ya no espera nadie: el scroll del usuario se guarda otra vez.
  p.desplazarPorUsuario(55)
  memoria.restaurar('clientes')
  assert.equal(p.y, 55)
})

test('con una hoja bloqueando la página no la mueve, y cuando se libera y crece, sí', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(700)
  dejar()
  p.desplazarPorUsuario(0)

  p.fijarMax(100)
  p.bloquear(true)
  memoria.restaurar('clientes')
  p.crecer(300)
  assert.deepEqual(p.pedidos, [], 'bloqueada, no pide mover la página (con el cuerpo fijo scrollTo no es del usuario)')
  assert.equal(p.puestos().crecer, 1, 'pero sigue esperando')

  p.bloquear(false)
  p.crecer(5000)
  assert.deepEqual(p.pedidos, [700])
  assert.equal(p.y, 700)
})

test('olvidar borra lo guardado: la sesión que termina no deja su desplazamiento a la que entra', () => {
  const p = paginaFalsa()
  const memoria = crearMemoriaDeDesplazamiento(p.entorno)
  const dejar = memoria.recordar('clientes')
  p.desplazarPorUsuario(400)
  dejar()
  memoria.olvidar()
  p.desplazarPorUsuario(90)
  memoria.restaurar('clientes')
  assert.equal(p.y, 0)
})

// public/theme-init.js corre antes del primer pintado: aplica el tema guardado sin esperar al módulo de la app.
// Aquí se ejecuta tal cual en un contexto de `node:vm` (un script clásico, como en el navegador) con un localStorage falso.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'

const RUTA = new URL('../public/theme-init.js', import.meta.url)
const fuente = readFileSync(RUTA, 'utf8')

type Almacen = { getItem(clave: string): string | null }

/** Corre theme-init.js y devuelve los atributos que puso en <html>, en orden. `'bloqueado'`: leer `localStorage` lanza, como con las cookies bloqueadas. */
function correr(almacen: Almacen | 'bloqueado'): Array<[string, string]> {
  const atributos: Array<[string, string]> = []
  const contexto = createContext({
    document: {
      documentElement: {
        setAttribute: (nombre: string, valor: string) => {
          atributos.push([nombre, valor])
        },
      },
    },
  })
  // `localStorage` se define dentro del contexto: un getter puesto en el objeto de afuera no relanza su error al script
  // (vm lo toma por una variable inexistente) y la prueba no vería el SecurityError de verdad.
  const definir = runInContext('(valor) => Object.defineProperty(globalThis, "localStorage", valor)', contexto)
  definir(
    almacen === 'bloqueado'
      ? {
          get() {
            throw new DOMException('Access is denied for this document.', 'SecurityError')
          },
        }
      : { value: almacen },
  )
  runInContext(fuente, contexto)
  return atributos
}

/** Un storage que solo guarda el tema, bajo la clave que usa la app: con otra clave la lectura da null. */
const conTema = (valor: string | null): Almacen => ({ getItem: (clave) => (clave === 'express.theme' ? valor : null) })

test('tema guardado dark: pone data-theme dark', () => {
  assert.deepEqual(correr(conTema('dark')), [['data-theme', 'dark']])
})

test('tema guardado light: pone data-theme light', () => {
  assert.deepEqual(correr(conTema('light')), [['data-theme', 'light']])
})

test('auto, sin valor o cualquier otro valor: no pone nada y manda el sistema', () => {
  for (const valor of ['auto', null, '', 'Dark', 'oscuro']) {
    assert.doesNotThrow(() => correr(conTema(valor)), String(valor))
    assert.deepEqual(correr(conTema(valor)), [], String(valor))
  }
})

test('storage bloqueado (localStorage lanza al leerlo): no pone nada y no lanza', () => {
  assert.doesNotThrow(() => correr('bloqueado'))
  assert.deepEqual(correr('bloqueado'), [])
})

test('getItem que lanza: no pone nada y no lanza', () => {
  const roto: Almacen = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  }
  assert.doesNotThrow(() => correr(roto))
  assert.deepEqual(correr(roto), [])
})

test('pesa a lo sumo 400 bytes (presupuesto de theme-init.js)', () => {
  assert.ok(statSync(RUTA).size <= 400, `pesa ${statSync(RUTA).size} bytes`)
})

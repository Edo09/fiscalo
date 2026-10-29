// lib/almacen: todo el localStorage de la app pasa por aquí. Con el storage bloqueado (ventana privada, cookies bloqueadas) o lleno,
// `localStorage` lanza al leerlo o al escribirlo: la app tiene que seguir andando y devolver lo escrito mientras viva la página.
//
// El respaldo en memoria es del módulo y dura lo que el proceso: cada prueba usa sus propias claves, y las que cambian el storage lo
// hacen por conStorage, que lo devuelve aunque falle una aserción.
import assert from 'node:assert/strict'
import test from 'node:test'
import { instalarStorage } from './ayudas'
import { borrar, claveUsuario, escribirJson, escribirTexto, leerJson, leerTexto, purgarUsuario } from '~/lib/almacen'

/** Corre `fn` con un `localStorage` de prueba (ver instalarStorage) y lo devuelve al final, pase lo que pase. */
function conStorage(modo: 'memoria' | 'lanza', fn: (s: ReturnType<typeof instalarStorage>) => void): void {
  const s = instalarStorage(modo)
  try {
    fn(s)
  } finally {
    s.restaurar()
  }
}

test('ida y vuelta, JSON corrupto y claveUsuario', () => {
  conStorage('memoria', () => {
    escribirJson('k', { a: 1 })
    assert.deepEqual(leerJson('k'), { a: 1 })
    localStorage.setItem('mal', '{')
    assert.equal(leerJson('mal'), null)
    assert.equal(claveUsuario(12, 5, 'borrador'), 'fx:v1:12:5:borrador')
    escribirTexto('express.theme', 'dark')
    assert.equal(localStorage.getItem('express.theme'), 'dark')
    assert.equal(leerTexto('express.theme'), 'dark')
    assert.equal(leerTexto('nada'), null)
  })
})

test('ida y vuelta de cada tipo de JSON', () => {
  conStorage('memoria', (s) => {
    const valores: unknown[] = [0, false, '', 'texto', [1, [2]], { a: { b: null }, c: [] }]
    for (const [i, valor] of valores.entries()) {
      escribirJson(`tipo${i}`, valor)
      assert.deepEqual(leerJson(`tipo${i}`), valor, JSON.stringify(valor))
    }
    assert.equal(s.datos.get('tipo3'), '"texto"') // en el storage va el JSON, no el texto a secas
  })
})

test('storage que lanza: la lectura devuelve lo escrito en memoria', () => {
  // Review Focus 2: el teléfono con el storage bloqueado.
  conStorage('lanza', () => {
    assert.doesNotThrow(() => escribirJson('k', { a: 2 }))
    assert.deepEqual(leerJson('k'), { a: 2 })
    borrar('k')
    assert.equal(leerJson('k'), null)
    const circular: any = {}
    circular.yo = circular
    assert.doesNotThrow(() => escribirJson('c', circular))
  })
})

test('storage que lanza: el texto suelto (tema, bandera de la vista previa) también se lee de memoria', () => {
  conStorage('lanza', () => {
    assert.equal(leerTexto('texto.bloqueado'), null)
    assert.doesNotThrow(() => escribirTexto('texto.bloqueado', 'dark'))
    assert.equal(leerTexto('texto.bloqueado'), 'dark')
    borrar('texto.bloqueado')
    assert.equal(leerTexto('texto.bloqueado'), null)
  })
})

test('storage lleno: lo último escrito manda aunque no llegue al storage, y al haber lugar vuelve a mandar el storage', () => {
  // La bandera llena la cuota del localStorage de _loader.mjs (el de ayudas.ts no la mira): aquí no se cambia de storage.
  const g = globalThis as any
  escribirJson('lleno', { n: 0 }) // esta sí llega
  g.__CUOTA_LLENA__ = true
  try {
    assert.doesNotThrow(() => escribirJson('lleno', { n: 1 }))
    assert.equal(localStorage.getItem('lleno'), '{"n":0}') // el storage conserva lo viejo...
    assert.deepEqual(leerJson('lleno'), { n: 1 }) // ...y la lectura no lo devuelve
  } finally {
    g.__CUOTA_LLENA__ = false
  }
  escribirJson('lleno', { n: 2 })
  assert.equal(localStorage.getItem('lleno'), '{"n":2}')
  localStorage.setItem('lleno', '{"n":3}') // con el storage al día, la copia en memoria ya no se consulta
  assert.deepEqual(leerJson('lleno'), { n: 3 })
  localStorage.removeItem('lleno')
})

test('borrar después de una escritura que no cupo: la clave queda borrada, no la copia en memoria', () => {
  const g = globalThis as any
  escribirJson('lleno.borrado', { n: 0 })
  g.__CUOTA_LLENA__ = true
  try {
    escribirJson('lleno.borrado', { n: 1 }) // no cabe: queda en memoria
    borrar('lleno.borrado') // quitar sí se puede, con la cuota llena
  } finally {
    g.__CUOTA_LLENA__ = false
  }
  assert.equal(leerJson('lleno.borrado'), null)
  assert.equal(localStorage.getItem('lleno.borrado'), null)
})

test('borrar con un storage que no deja quitar: la lectura da null aunque el valor siga en el storage', () => {
  conStorage('memoria', (s) => {
    escribirJson('quita', 1)
    localStorage.removeItem = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    assert.doesNotThrow(() => borrar('quita'))
    assert.equal(s.datos.has('quita'), true)
    assert.equal(leerJson('quita'), null)
  })
})

test('escribirJson con undefined borra la clave: no deja el texto "undefined"', () => {
  conStorage('memoria', (s) => {
    escribirJson('u', 1)
    escribirJson('u', undefined)
    assert.equal(s.datos.has('u'), false)
    assert.equal(leerJson('u'), null)
  })
})

test('un valor que no se puede serializar no lanza ni pisa lo guardado', () => {
  conStorage('memoria', () => {
    escribirJson('s', { ok: true })
    const circular: any = {}
    circular.yo = circular
    assert.doesNotThrow(() => escribirJson('s', circular))
    assert.doesNotThrow(() => escribirJson('s', { n: 1n }))
    assert.deepEqual(leerJson('s'), { ok: true })
  })
})

test('purgarUsuario quita borrador y recientes y conserva envio', () => {
  conStorage('memoria', () => {
    for (const q of ['borrador', 'recientes', 'envio']) escribirJson(claveUsuario(12, 5, q), 1)
    purgarUsuario(12, 5, ['borrador', 'recientes'])
    assert.deepEqual(
      ['borrador', 'recientes', 'envio'].map((q) => leerJson(claveUsuario(12, 5, q))),
      [null, null, 1],
    )
  })
})

test('purgarUsuario no toca a otro usuario ni a otra empresa', () => {
  conStorage('memoria', () => {
    const ajenas = [claveUsuario(12, 6, 'borrador'), claveUsuario(13, 5, 'borrador')]
    for (const clave of [...ajenas, claveUsuario(12, 5, 'borrador')]) escribirJson(clave, 1)
    purgarUsuario(12, 5, ['borrador'])
    assert.equal(leerJson(claveUsuario(12, 5, 'borrador')), null)
    assert.deepEqual(ajenas.map((clave) => leerJson(clave)), [1, 1])
  })
})

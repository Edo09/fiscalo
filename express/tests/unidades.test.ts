// lib/unidades: las reglas de cantidad por unidad de medida y el catálogo DGII en Express. `admiteDecimales` y `problemaCantidad` son copia de las
// de la app completa (src/components/unidadesMedida.ts, que Express no puede importar: trae el barril `@/api`), con UNA diferencia a propósito:
// con el catálogo vacío (sin cargar, o la carga falló) la app completa no bloquea nada y Express solo deja cantidades enteras. La prueba de
// paridad saca las dos funciones del archivo de la app completa, las evalúa y las compara con las de Express: si alguien cambia las de la
// app, esta prueba avisa de que la copia hay que revisarla.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UnidadMedida } from '@/api/types'
import { decimalesDe } from '@/lib/format'
import { admiteDecimales, problemaCantidad, UNIDAD_POR_DEFECTO, useUnidades } from '~/lib/unidades'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/

type IdUnidad = number | string | null | undefined
type Opciones = { unidadId?: number | string | null; catalogo: UnidadMedida[]; maxDecimales: 2 | 3 }

/** La forma que comparten las dos copias; asignar las de Express a esto comprueba también que sus firmas son las de la app completa. */
interface Reglas {
  admiteDecimales(id: IdUnidad, catalogo: UnidadMedida[]): boolean
  problemaCantidad(cantidad: number, opts: Opciones): string | null
}
const deExpress: Reglas = { admiteDecimales, problemaCantidad }

/**
 * Los tipos de un trozo de TypeScript fuera. Node avisa «ExperimentalWarning» la primera vez que `stripTypeScriptTypes` corre en un proceso:
 * hooks.mjs lo calla en el hilo de los hooks y este es otro, así que aquí se calla solo ese aviso, de la misma manera.
 */
function sinTipos(fuente: string): string {
  const emitirAviso = process.emitWarning
  process.emitWarning = ((aviso: unknown, ...resto: unknown[]) => {
    if (!String(aviso).includes('stripTypeScriptTypes')) (emitirAviso as any).call(process, aviso, ...resto)
  }) as typeof process.emitWarning
  try {
    return stripTypeScriptTypes(fuente, { mode: 'strip' })
  } finally {
    process.emitWarning = emitirAviso
  }
}

/** Las dos funciones de la app completa, sacadas de su archivo y evaluadas con el `decimalesDe` de verdad: lo que esa app responde hoy. */
function reglasDeLaApp(): Reglas {
  const fuente = leer('src/components/unidadesMedida.ts')
  const funcion = (nombre: string): string => {
    // De `export function nombre(` a la primera llave de cierre en la columna 0, que es la de la función.
    const m = new RegExp(`^export function ${nombre}\\([\\s\\S]*?^\\}$`, 'm').exec(fuente)
    assert.ok(m, `src/components/unidadesMedida.ts ya no tiene «export function ${nombre}»: la copia de Express hay que revisarla`)
    return m[0].replace(/^export /, '')
  }
  const js = sinTipos(`${funcion('admiteDecimales')}\n${funcion('problemaCantidad')}`)
  return new Function('decimalesDe', `${js}\nreturn { admiteDecimales, problemaCantidad }`)(decimalesDe) as Reglas
}
let reglasMemo: Reglas | undefined
const laApp = (): Reglas => (reglasMemo ??= reglasDeLaApp())

const CATALOGO: UnidadMedida[] = [
  { id: 43, codigo: 'UND', descripcion: 'Unidad', permite_decimales: false },
  { id: 12, codigo: 'MTR', descripcion: 'Metro', permite_decimales: true },
  { id: 5, codigo: 'CJA', descripcion: 'Caja', permite_decimales: false }, // otra que no admite fracciones: el mensaje lleva SU nombre
  { id: 7, codigo: 'SIN', descripcion: 'Sin marca' }, // la master sin la marca (migración 010): no bloquea
  { id: 8, codigo: 'NUL', descripcion: 'Marca nula', permite_decimales: null },
]
const CANTIDADES = [0, -1, 1, 1.5, 0.5, 0.001, 0.0001, 2.555, 2.5, 10, 1234.5678, NaN]
const UNIDADES: IdUnidad[] = [43, '43', 12, '12', 5, 7, 8, 999, null, undefined, '', 'abc']
const MAXIMOS: (2 | 3)[] = [2, 3]

const SIN_FRACCIONES = 'La unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.'
const MAYOR_QUE_0 = 'La cantidad debe ser mayor que 0.'

// --- paridad con la app completa -----------------------------------------------------------------------------------------------------

test('unidades: paridad con la app completa con el catálogo cargado', () => {
  const resultados = new Set<string | null>()
  for (const unidadId of UNIDADES) {
    assert.equal(deExpress.admiteDecimales(unidadId, CATALOGO), laApp().admiteDecimales(unidadId, CATALOGO), `admiteDecimales(${String(unidadId)})`)
    for (const cantidad of CANTIDADES) {
      for (const maxDecimales of MAXIMOS) {
        const opts = { unidadId, catalogo: CATALOGO, maxDecimales }
        const esperado = laApp().problemaCantidad(cantidad, opts)
        const caso = `problemaCantidad(${cantidad}, unidad ${String(unidadId)}, ${maxDecimales} decimales)`
        assert.equal(deExpress.problemaCantidad(cantidad, opts), esperado, caso)
        resultados.add(esperado)
      }
    }
  }
  // Que no sea comparar nada con nada: la matriz da el texto de cada razón, y también «sin problema».
  for (const texto of [null, SIN_FRACCIONES, MAYOR_QUE_0, 'La cantidad admite hasta 2 decimales.', 'La cantidad admite hasta 3 decimales.']) {
    assert.ok(resultados.has(texto), `la matriz no llegó a ${String(texto)}`)
  }
  // Sin `unidadId`: la clave ausente, que no es lo mismo que puesta en undefined.
  const sinUnidad = { catalogo: CATALOGO, maxDecimales: 2 as const }
  assert.equal(deExpress.problemaCantidad(1.5, sinUnidad), laApp().problemaCantidad(1.5, sinUnidad))
})

test('unidades: lo que dice cada función con el catálogo cargado (43 solo enteros, 12 admite fracciones)', () => {
  const con = (unidadId: IdUnidad, maxDecimales: 2 | 3 = 2): Opciones => ({ unidadId, catalogo: CATALOGO, maxDecimales })
  assert.equal(admiteDecimales(43, CATALOGO), false)
  assert.equal(admiteDecimales('43', CATALOGO), false)
  assert.equal(admiteDecimales(12, CATALOGO), true)
  assert.equal(admiteDecimales(7, CATALOGO), true) // sin marca: no se bloquea
  assert.equal(admiteDecimales(8, CATALOGO), true) // marca nula: no se bloquea
  assert.equal(admiteDecimales(999, CATALOGO), true) // unidad que el catálogo no tiene: no se bloquea
  assert.equal(problemaCantidad(1, con(43)), null)
  assert.equal(problemaCantidad(1.5, con(43)), SIN_FRACCIONES)
  assert.equal(problemaCantidad(1.5, con(5)), 'La unidad «Caja» no admite fracciones: usa una cantidad entera o cambia la unidad.') // su nombre
  assert.equal(problemaCantidad(1.5, con('5')), 'La unidad «Caja» no admite fracciones: usa una cantidad entera o cambia la unidad.')
  assert.equal(problemaCantidad(1.5, con(12)), null)
  assert.equal(problemaCantidad(0.001, con(12)), MAYOR_QUE_0) // con 2 decimales se guardaría 0
  assert.equal(problemaCantidad(0.001, con(12, 3)), null)
  assert.equal(problemaCantidad(2.555, con(12)), 'La cantidad admite hasta 2 decimales.')
  assert.equal(problemaCantidad(2.555, con(12, 3)), null)
  assert.equal(problemaCantidad(0, con(12)), MAYOR_QUE_0)
  assert.equal(problemaCantidad(-1, con(12)), MAYOR_QUE_0)
  assert.equal(problemaCantidad(NaN, con(12)), MAYOR_QUE_0)
})

// --- la divergencia cerrada: sin catálogo --------------------------------------------------------------------------------------------

test('unidades: con el catálogo vacío Express solo deja enteros y la app completa no bloquea', () => {
  for (const unidadId of UNIDADES) {
    assert.equal(admiteDecimales(unidadId, []), false, `Express: admiteDecimales(${String(unidadId)}, [])`)
    assert.equal(laApp().admiteDecimales(unidadId, []), true, `app completa: admiteDecimales(${String(unidadId)}, [])`)
  }
  // El caso del plan: 1.5 sin catálogo.
  const sinCatalogo: Opciones = { unidadId: 12, catalogo: [], maxDecimales: 2 }
  assert.equal(laApp().problemaCantidad(1.5, sinCatalogo), null)
  assert.match(problemaCantidad(1.5, sinCatalogo) ?? '', /no admite fracciones/)
  assert.equal(problemaCantidad(1.5, sinCatalogo), SIN_FRACCIONES) // sin catálogo no se sabe el nombre de la unidad: «Unidad»
  assert.equal(problemaCantidad(1, sinCatalogo), null) // un entero pasa
  assert.equal(problemaCantidad(10, sinCatalogo), null)
})

test('unidades: sin catálogo Express y la app completa solo se separan en las cantidades con fracción', () => {
  let separadas = 0
  for (const unidadId of UNIDADES) {
    for (const cantidad of CANTIDADES) {
      for (const maxDecimales of MAXIMOS) {
        const opts: Opciones = { unidadId, catalogo: [], maxDecimales }
        const hecho = problemaCantidad(cantidad, opts)
        const valida = cantidad > 0 && Math.round(cantidad * 10 ** maxDecimales) > 0
        const caso = `problemaCantidad(${cantidad}, unidad ${String(unidadId)}, ${maxDecimales} decimales)`
        // Lo que no tiene fracción (un entero, un cero, un negativo, un NaN, algo que se guardaría como 0) responde igual que la app completa;
        // lo que sí la tiene, Express lo rechaza con el texto de «no admite fracciones» aunque la app completa lo deje pasar.
        if (valida && decimalesDe(cantidad) > 0) {
          assert.equal(hecho, SIN_FRACCIONES, caso)
          separadas++
        } else {
          assert.equal(hecho, laApp().problemaCantidad(cantidad, opts), caso)
        }
      }
    }
  }
  assert.ok(separadas > 0, 'la matriz no probó ninguna cantidad con fracción')
})

test('unidades: la unidad por defecto es la 43 (texto), la de «Unidad», que solo admite enteros', () => {
  assert.equal(UNIDAD_POR_DEFECTO, '43')
  assert.equal(admiteDecimales(UNIDAD_POR_DEFECTO, CATALOGO), false)
  assert.equal(admiteDecimales(UNIDAD_POR_DEFECTO, []), false)
})

// --- useUnidades: el catálogo sobre la caché de consultas ----------------------------------------------------------------------------

/** Renderiza `useUnidades` bajo `client` (a texto, sin DOM: en servidor un gancho de datos solo lee la caché) y devuelve lo que vio. */
function leerGancho(client: QueryClient): ReturnType<typeof useUnidades> {
  const visto: { valor?: ReturnType<typeof useUnidades> } = {}
  const Sonda = (): null => {
    visto.valor = useUnidades()
    return null
  }
  const fetchReal = globalThis.fetch
  // Las pruebas de Express no piden nada fuera de la máquina, y esta no pide nada en absoluto: si el gancho pidiera el catálogo, esto lanza.
  globalThis.fetch = (() => {
    throw new Error('useUnidades pidió algo a la red en la prueba')
  }) as typeof fetch
  try {
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Sonda)))
  } finally {
    globalThis.fetch = fetchReal
  }
  assert.ok(visto.valor, 'el gancho no corrió')
  return visto.valor
}

test('useUnidades: con el catálogo en la caché bajo la clave de la app completa está cargado', () => {
  // Esa clave es la que config/cache.ts trata como catálogo fijo: otra clave sería otra consulta, con otra frescura.
  const client = new QueryClient()
  client.setQueryData(['unidades-medida'], CATALOGO)
  const visto = leerGancho(client)
  assert.equal(visto.cargado, true)
  assert.equal(visto.catalogo, CATALOGO) // el mismo arreglo que está en la caché
})

test('useUnidades: sin catálogo es una lista vacía, no cargado, y la misma lista cada vez (no cambia entre renders)', () => {
  const primero = leerGancho(new QueryClient())
  const segundo = leerGancho(new QueryClient())
  assert.deepEqual(primero, { catalogo: [], cargado: false })
  assert.equal(primero.catalogo, segundo.catalogo)
  // Con eso la cantidad con fracción se rechaza hasta que llegue el catálogo.
  assert.equal(admiteDecimales(12, primero.catalogo), false)
})

test('useUnidades: un catálogo que llegó vacío cuenta como cargado y sigue cerrado a enteros', () => {
  const client = new QueryClient()
  client.setQueryData(['unidades-medida'], [])
  const visto = leerGancho(client)
  assert.equal(visto.cargado, true)
  assert.equal(admiteDecimales(12, visto.catalogo), false)
})

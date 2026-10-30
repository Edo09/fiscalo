// screens/precarga: la precarga de las pantallas perezosas (`CARGADORES` y `precargarRuta`) y la regla que la mantiene fuera de un ciclo de imports.
// `registro` importa a Facturas, y las piezas de Facturas piden `precargarRuta` en su `pointerdown`: si la función viviera en `registro` habría un ciclo
// (registro -> Facturas -> pieza -> registro) que solo funciona mientras Facturas y la función sigan siendo declaraciones de función (TDZ si no), y ni el
// build ni check-graph lo notan. Aquí se vigila con el recorrido de imports de dev/graph-rules.mjs: `precarga.ts` es una hoja y `registro.ts` no está en ningún ciclo.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cadenaDe, EXTENSION_FUENTE, normalizarId, recorrerGrafo } from '../dev/graph-rules.mjs'
import type { Cargador } from '~/screens/precarga'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)) // la raíz del repo (fiscalo/), con separador final
const REGISTRO = 'express/src/screens/registro.ts'
const PRECARGA = 'express/src/screens/precarga.ts'
const FACTURAS = 'express/src/screens/Facturas.tsx'
const TARJETA = 'express/src/screens/facturas/Tarjeta.tsx'
const enDisco = (raiz: string, id: string): string => join(raiz, ...id.split('/'))

// --- El recorrido: los ciclos que pasan por un módulo ------------------------------------------------------------------------------

/** Lo que de un id se lee como código del repo: ni los paquetes (hojas del grafo, sin archivo que leer aquí) ni los CSS o imágenes. */
const esCodigoDelRepo = (id: string): boolean => EXTENSION_FUENTE.test(id) && !/(^|\/)node_modules\//.test(id)

/**
 * Los ciclos de imports estáticos (de valor) por los que pasa `entrada`, cada uno como cadena de ids `entrada -> ... -> entrada`: uno por cada import directo de
 * `entrada` desde cuya clausura estática se vuelve a ella. Un `import type` no cuenta (se borra al compilar) y un `import()` tampoco: carga su trozo cuando se
 * llama y no al enlazar el módulo, así que no hay TDZ que temer.
 */
function ciclosPor(entrada: string, raiz: string): string[][] {
  assert.equal(normalizarId(enDisco(raiz, entrada), raiz), entrada)
  const ciclos: string[][] = []
  for (const [directo, padre] of recorrerGrafo([enDisco(raiz, entrada)], raiz).padresEstaticos) {
    if (padre !== entrada || !esCodigoDelRepo(directo)) continue
    const desde = recorrerGrafo([enDisco(raiz, directo)], raiz)
    if (desde.estaticos.has(entrada)) ciclos.push([entrada, ...cadenaDe(desde.padresEstaticos, entrada)])
  }
  return ciclos
}

/** Un árbol de archivos temporal (`ruta desde la raíz` -> contenido) que hace de raíz del repo. Se borra al terminar la prueba. */
function arbol(t: TestContext, archivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), 'express-precarga-'))
  t.after(() => rmSync(raiz, { recursive: true, force: true }))
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(enDisco(raiz, ruta)), { recursive: true })
    writeFileSync(enDisco(raiz, ruta), contenido)
  }
  return raiz
}

/** Lo mismo que `registro` y Facturas antes del arreglo, en chico: la pieza le pide la función al registro, y el registro importa a la pantalla. */
const FACTURAS_CON_UNA_PIEZA = `import { Tarjeta } from './facturas/Tarjeta'\nexport default function Facturas() { return Tarjeta() }\n`

test('la guardia de ciclos ve el que habia: registro -> Facturas -> pieza -> registro', (t) => {
  const raiz = arbol(t, {
    [REGISTRO]: `import Facturas from './Facturas'\nexport function precargarRuta(id: string): void { void id }\nexport const registro = { facturas: Facturas }\n`,
    [FACTURAS]: FACTURAS_CON_UNA_PIEZA,
    [TARJETA]: `import { precargarRuta } from '~/screens/registro'\nexport function Tarjeta() { precargarRuta('factura'); return null }\n`,
  })
  assert.deepEqual(ciclosPor(REGISTRO, raiz), [[REGISTRO, FACTURAS, TARJETA, REGISTRO]])
})

test('la guardia de ciclos no ve ciclo cuando la pieza le pide la funcion a una hoja, ni en un import type de vuelta ni en un import() de vuelta', (t) => {
  const raiz = arbol(t, {
    [REGISTRO]: `import Facturas from './Facturas'\nexport { precargarRuta } from './precarga'\nexport const registro = { facturas: Facturas }\n`,
    [PRECARGA]: 'export function precargarRuta(id: string): void { void id }\n',
    [FACTURAS]: FACTURAS_CON_UNA_PIEZA,
    [TARJETA]:
      `import { precargarRuta } from '~/screens/precarga'\nimport type { registro } from '~/screens/registro'\n` +
      `export const cargarRegistro = () => import('~/screens/registro')\nexport function Tarjeta(r?: typeof registro) { precargarRuta('factura'); return r ?? null }\n`,
  })
  assert.deepEqual(ciclosPor(REGISTRO, raiz), [])
})

test('la guardia de ciclos no se cae con un paquete ni con un CSS entre los imports (no son codigo del repo)', (t) => {
  const raiz = arbol(t, {
    [REGISTRO]: `import { lazy } from 'react'\nimport './registro.css'\nexport const registro = { lazy }\n`,
    'express/src/screens/registro.css': '.a { color: red }\n',
  })
  assert.deepEqual(ciclosPor(REGISTRO, raiz), [])
})

// --- Lo que se vigila del repo ----------------------------------------------------------------------------------------------------

test('precarga.ts es una hoja: ningun import de valor, asi que no puede estar en un ciclo ni arrastrar una pantalla', () => {
  const grafo = recorrerGrafo([enDisco(RAIZ, PRECARGA)], RAIZ)
  const directos = [...grafo.padresEstaticos].filter(([, padre]) => padre === PRECARGA).map(([id]) => id)
  assert.deepEqual([...grafo.estaticos], [PRECARGA], `precarga.ts importa ${directos.join(', ')}: tiene que ser una hoja (ver su encabezado)`)
})

test('registro.ts no esta en ningun ciclo de imports estaticos: Facturas y sus piezas no lo importan de vuelta (piden precargarRuta a precarga.ts)', () => {
  const ciclos = ciclosPor(REGISTRO, RAIZ)
  assert.deepEqual(ciclos, [], `ciclos de imports que pasan por registro.ts:\n${ciclos.map((ciclo) => `  ${ciclo.join(' -> ')}`).join('\n')}`)
})

// --- precargarRuta ----------------------------------------------------------------------------------------------------------------

/**
 * `screens/precarga` se importa al correr cada prueba y no al cargar este archivo: si dejara de ser una hoja y arrastrara una pantalla (un .tsx, que Node no lee), la
 * prueba de la hoja diría por qué en vez de que el archivo entero no cargara.
 */
const precarga = () => import('~/screens/precarga')

type IdDePrueba = 'factura' | 'clientes'

/** Pone esos cargadores mientras corre `prueba` y deja `CARGADORES` como estaba (un plan posterior agrega los cargadores de verdad). */
async function conCargadores(puestos: Partial<Record<IdDePrueba, Cargador>>, prueba: () => Promise<void> | void): Promise<void> {
  const { CARGADORES } = await precarga()
  const ids = Object.keys(puestos) as IdDePrueba[]
  const previos = ids.map((id) => [id, CARGADORES[id]] as const)
  for (const id of ids) CARGADORES[id] = puestos[id]
  try {
    await prueba()
  } finally {
    for (const [id, previo] of previos) {
      if (previo === undefined) delete CARGADORES[id]
      else CARGADORES[id] = previo
    }
  }
}

/** Lo que entrega un `import()` en estas pruebas: una pantalla de mentira. */
const PANTALLA = { default: () => null }

/** Un cargador que anota que lo pidieron. */
const queAnota =
  (pedidos: string[], id: string): Cargador =>
  async () => {
    pedidos.push(id)
    return PANTALLA
  }

test('precargarRuta de una ruta sin cargador no hace nada (Facturas es del arranque y Mas es una hoja, no una pantalla)', async () => {
  const { CARGADORES, precargarRuta } = await precarga()
  assert.equal(CARGADORES.facturas, undefined)
  assert.equal(CARGADORES.mas, undefined)
  assert.equal(precargarRuta('facturas'), undefined)
  assert.equal(precargarRuta('mas'), undefined)
})

test('precargarRuta pide el cargador de esa ruta, en el acto y solo ese', async () => {
  const { precargarRuta } = await precarga()
  const pedidos: string[] = []
  await conCargadores({ factura: queAnota(pedidos, 'factura'), clientes: queAnota(pedidos, 'clientes') }, () => {
    assert.equal(precargarRuta('factura'), undefined)
    assert.deepEqual(pedidos, ['factura']) // sin esperar: el cargador ya corrio cuando vuelve la llamada
    precargarRuta('factura') // es idempotente porque import() da el mismo modulo; aqui solo se vuelve a pedir
    assert.deepEqual(pedidos, ['factura', 'factura'])
  })
})

test('precargarRuta no avisa de un trozo que no llego: es una precarga, y la pantalla lo pide cuando se dibuja', async () => {
  const { precargarRuta } = await precarga()
  const sinManejar: unknown[] = []
  const alRechazar = (motivo: unknown): void => {
    sinManejar.push(motivo)
  }
  process.on('unhandledRejection', alRechazar)
  try {
    await conCargadores({ factura: () => Promise.reject(new Error('sin red')) }, async () => {
      assert.equal(precargarRuta('factura'), undefined)
      await new Promise((resolver) => setTimeout(resolver, 20)) // Node avisa de un rechazo sin manejar al terminar el turno del bucle de eventos
    })
  } finally {
    process.off('unhandledRejection', alRechazar)
  }
  assert.deepEqual(sinManejar, [])
})

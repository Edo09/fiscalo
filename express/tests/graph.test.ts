// Guardia de imports de Express: dev/graph-rules.mjs (qué entra desde fiscalo/src y el recorrido del grafo con el AST de typescript),
// dev/check-graph.mjs (el script previo al merge) y dev/plugins.mjs (la guardia del build). Todo se lee desde la ubicación de esta
// prueba, no desde el directorio de trabajo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { revisarGrafo } from '../dev/check-graph.mjs'
import { cadenaDe, evaluarArranque, evaluarIds, PERMITIDOS, PROHIBIDOS, recorrerGrafo } from '../dev/graph-rules.mjs'
import { forbiddenModuleGuard } from '../dev/plugins.mjs'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)) // la raíz del repo (fiscalo/), con separador final
const FIX = (nombre: string): string => join(RAIZ, 'express', 'tests', 'fixtures', 'mal-import', nombre)
const MAIN = join(RAIZ, 'express', 'src', 'main.tsx')
const CLI = join(RAIZ, 'express', 'dev', 'check-graph.mjs')

/** Un árbol de archivos temporal (`ruta desde la raíz` -> contenido) que hace de raíz del repo. Se borra al terminar la prueba. */
function arbol(t: TestContext, archivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), 'express-grafo-'))
  t.after(() => rmSync(raiz, { recursive: true, force: true }))
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true })
    writeFileSync(join(raiz, ruta), contenido)
  }
  return raiz
}

// --- Qué entra: evaluarIds ----------------------------------------------------------------------------------------------

const PROHIBIDOS_EJEMPLOS = [
  'src/api/mappers.ts', 'src/api/index.ts', 'src/App.tsx', 'src/main.tsx', 'src/config/navigation.ts',
  'src/components/layout/Sidebar.tsx', 'src/components/ui/Button.tsx', 'src/features/invoices/InvoiceFormView.tsx',
  'src/features/clients/NewClientModal.tsx', 'src/features/clients/ClientCombobox.tsx', 'src/components/RncConsultaField.tsx',
  'src/hooks/useHistoryNav.ts', 'src/hooks/useAvisoSalida.ts', 'src/lib/file.ts', 'src/lib/printHtml.ts', 'src/pos/PosApp.tsx',
  'src/styles/styles.css', 'src/features/invoices/reciboHtml.ts', 'node_modules/sonner/dist/index.mjs', 'node_modules/lucide-react/dist/esm/lucide-react.js',
]

test('cada ejemplo prohibido da violacion', () => {
  for (const id of PROHIBIDOS_EJEMPLOS) assert.equal(evaluarIds([id], RAIZ).violaciones.length, 1, id)
})

test('permitidos y montos.ts pasan', () => {
  assert.deepEqual(evaluarIds([...PERMITIDOS, 'src/pos/montos.ts'], RAIZ).violaciones, [])
})

test('cada prohibido lo es por una regla de PROHIBIDOS y no solo por faltar en PERMITIDOS', () => {
  // Sin esto una regla rota pasaría sin que nadie lo note: lo que falta en PERMITIDOS se rechaza igual, pero con otro motivo.
  const mas = ['src/styles/bold.css', 'src/styles/responsive.css', 'src/pos/main.tsx', 'src/pos/CobroModal.tsx', 'src/pos/montos.tsx',
    'src/features/reports/VentasView.tsx', 'node_modules/sonner/dist/index.js', 'node_modules/lucide-react/dist/cjs/lucide-react.js']
  for (const id of [...PROHIBIDOS_EJEMPLOS, ...mas]) {
    assert.ok(PROHIBIDOS.some((regla) => regla.test(id)), `${id} no coincide con ninguna regla de PROHIBIDOS`)
    assert.match(evaluarIds([id], RAIZ).violaciones[0].motivo, /^prohibido/, id)
  }
})

test('las reglas no confunden lo de express/ ni los paquetes parecidos con lo prohibido de src/', () => {
  // Express tiene su propio App.tsx, main.tsx y archivos *Modal o *View: las reglas de src/ no los alcanzan.
  const propios = ['express/src/App.tsx', 'express/src/main.tsx', 'express/src/ui/BottomSheetModal.tsx', 'express/src/screens/ClientesView.tsx',
    'express/src/ui/ClientCombobox.tsx', 'express/src/lib/file.ts', 'express/src/pos/PosApp.tsx', 'express/src/styles/styles.css',
    'node_modules/sonner-extra/dist/index.js', 'node_modules/lucide-react-native/index.js', 'node_modules/@scope/sonner/index.js']
  assert.deepEqual(evaluarIds(propios, RAIZ).violaciones, [])
})

test('evaluarIds: ids absolutos, con sufijo, con barras invertidas y los virtuales de Rollup', () => {
  // Rollup entrega los ids absolutos y con barras normales, también en Windows: `C:/…/fiscalo/src/api/mappers.ts?v=1`.
  const abs = (ruta: string): string => RAIZ.replace(/\\/g, '/') + ruta
  const mal = [{ id: 'src/api/mappers.ts', motivo: /prohibido/ }]
  const comparar = (ids: string[], esperado: { id: string; motivo: RegExp }[]) => {
    const { violaciones } = evaluarIds(ids, RAIZ)
    assert.deepEqual(violaciones.map((v) => v.id), esperado.map((e) => e.id), ids.join(', '))
    esperado.forEach((e, i) => assert.match(violaciones[i].motivo, e.motivo))
  }
  comparar([abs('src/api/mappers.ts')], mal)
  comparar([join(RAIZ, 'src', 'api', 'mappers.ts')], mal) // la ruta nativa de la plataforma
  comparar([abs('src/api/mappers.ts?v=abc123')], mal)
  comparar([abs('src/api/mappers.ts#hash')], mal)
  comparar(['src\\api\\mappers.ts'], mal)
  comparar(['./src/api/mappers.ts', 'express/../src/api/mappers.ts'], mal) // el mismo módulo escrito de dos maneras: una sola violación
  // Lo que no es un archivo (los ids virtuales de Rollup empiezan con \0) no se juzga.
  comparar(['\0vite/modulepreload-polyfill.js', '\0commonjsHelpers.js', `\0${abs('node_modules/react/index.js?commonjs-module')}`, ''], [])
  // Express, los paquetes y los permitidos, absolutos o relativos, también con un node_modules por encima de la raíz.
  comparar([abs('express/src/main.tsx'), abs('express/index.html'), abs('node_modules/react/index.js'), 'node_modules/react-dom/client.js',
    '../../node_modules/react/index.js', abs('src/api/http.ts')], [])
  comparar(['../../node_modules/sonner/dist/index.mjs'], [{ id: '../../node_modules/sonner/dist/index.mjs', motivo: /prohibido/ }])
  // Los otros dos motivos: algo de src/ que no está en la lista y algo fuera de express/, src/ y node_modules/.
  comparar(['src/api/categories.ts'], [{ id: 'src/api/categories.ts', motivo: /permitidos/ }])
  comparar([abs('scripts/test-x.ts'), 'D:/otro/lugar/x.ts'], [{ id: 'scripts/test-x.ts', motivo: /fuera/ }, { id: 'D:/otro/lugar/x.ts', motivo: /fuera/ }])
})

test('las listas son coherentes: ningun permitido es prohibido, no se repiten y existen en disco', () => {
  assert.equal(new Set(PERMITIDOS).size, PERMITIDOS.length, 'PERMITIDOS repite una ruta')
  for (const ruta of PERMITIDOS) {
    assert.equal(PROHIBIDOS.some((regla) => regla.test(ruta)), false, `${ruta} está en las dos listas`)
    assert.ok(existsSync(join(RAIZ, ruta)), `${ruta} no existe: se renombró o se borró en src/ y la lista quedó vieja`)
  }
})

test('la clausura de los permitidos queda dentro de PERMITIDOS: ningun import de valor se escapa de la lista', () => {
  // Es lo que vigila el script previo al merge: un cambio en la app de escritorio que haga que un archivo permitido importe uno
  // prohibido solo rompería a Express, y esta prueba (y check-graph.mjs) lo avisan antes.
  const { todos, padresTodos } = recorrerGrafo(PERMITIDOS, RAIZ)
  const fuera = evaluarIds([...todos], RAIZ).violaciones.map((v) => `${cadenaDe(padresTodos, v.id).join(' -> ')} (${v.motivo})`)
  assert.deepEqual(fuera, [])
})

// --- El recorrido: recorrerGrafo ----------------------------------------------------------------------------------------

test('mal-import llega a mappers', () => assert.ok(recorrerGrafo([FIX('entrada.ts')], RAIZ).todos.has('src/api/mappers.ts')))

test('import type no es arista', () => {
  const { estaticos, todos } = recorrerGrafo([FIX('solo-tipos.ts')], RAIZ)
  assert.equal(todos.has('src/api/index.ts'), false)
  // Ni `import type { X }` ni `import { type Y }` dejan arista: el único módulo del grafo es la propia entrada.
  assert.deepEqual([...todos], ['express/tests/fixtures/mal-import/solo-tipos.ts'])
  assert.deepEqual([...estaticos], [...todos])
})

test('zod fuera del arranque', () => {
  // zod-estatico.ts importa zod con un import estático: queda en la clausura estática y, si esa fuera la del arranque, es violación.
  const { estaticos } = recorrerGrafo([FIX('zod-estatico.ts')], RAIZ)
  assert.ok(estaticos.has('node_modules/zod'))
  assert.deepEqual(evaluarArranque([...estaticos], RAIZ).violaciones.map((v) => v.id), ['node_modules/zod'])
  // Los tres módulos del escritorio que traen zod tampoco pueden estar en el arranque; sus vecinos sí.
  const conZod = ['src/api/facturas.ts', 'src/api/schemas/factura.ts', 'src/features/invoices/factura.schema.ts']
  assert.deepEqual(evaluarArranque(conZod, RAIZ).violaciones.map((v) => v.id), conZod)
  assert.deepEqual(evaluarArranque(['src/api/http.ts', 'src/api/errores.ts', 'node_modules/react-dom', 'express/src/main.tsx'], RAIZ).violaciones, [])
  // El arranque real de Express no los tiene.
  assert.deepEqual(evaluarArranque([...recorrerGrafo([MAIN], RAIZ).estaticos], RAIZ).violaciones, [])
})

test('el grafo real de express/src esta limpio', () => assert.deepEqual(evaluarIds([...recorrerGrafo([MAIN], RAIZ).todos], RAIZ).violaciones, []))

test('recorrerGrafo: import type, import { type } y export type no son aristas; export desde, de efecto, por defecto y * si', (t) => {
  const hojas = 'abdefghijklmno'.split('').map((letra) => [`src/${letra}.ts`, ''])
  const raiz = arbol(t, {
    'express/src/entrada.ts': [
      "import type { A } from '../../src/a'",
      "import { type B, type C } from '../../src/b'", // todos los especificadores son type
      "export type { D } from '../../src/d'",
      "export { type E } from '../../src/e'",
      "export type * from '../../src/o'",
      "import { f } from '../../src/f'",
      "import { type G, h } from '../../src/g'", // basta un valor
      "export * from '../../src/i'",
      "export { j } from '../../src/j'",
      "import '../../src/k'", // de efecto
      "import L, { type M } from '../../src/l'", // el valor por defecto
      "import * as N from '../../src/n'",
    ].join('\n'),
    ...Object.fromEntries(hojas),
  })
  const { estaticos } = recorrerGrafo([join(raiz, 'express/src/entrada.ts')], raiz)
  assert.deepEqual([...estaticos].sort(), ['express/src/entrada.ts', 'src/f.ts', 'src/g.ts', 'src/i.ts', 'src/j.ts', 'src/k.ts', 'src/l.ts', 'src/n.ts'])
})

test('recorrerGrafo: import() cuenta solo en todos, y lo que el perezoso importa tambien', (t) => {
  const raiz = arbol(t, {
    'express/src/main.ts': [
      "export const cargar = () => import('./perezoso')",
      'export const otro = () => import(`./otro`)', // plantilla sin sustituciones: se sabe a dónde va
      'export const variable = (ruta: string) => import(ruta)', // no se sabe: no hay arista
    ].join('\n'),
    'express/src/perezoso.ts': "import 'zod'\nimport './hoja'",
    'express/src/otro.ts': 'export const x = 1',
    'express/src/hoja.ts': '',
  })
  const g = recorrerGrafo([join(raiz, 'express/src/main.ts')], raiz)
  assert.deepEqual([...g.estaticos], ['express/src/main.ts'])
  assert.deepEqual([...g.todos].sort(), ['express/src/hoja.ts', 'express/src/main.ts', 'express/src/otro.ts', 'express/src/perezoso.ts', 'node_modules/zod'])
  assert.deepEqual(cadenaDe(g.padresTodos, 'node_modules/zod'), ['express/src/main.ts', 'express/src/perezoso.ts', 'node_modules/zod'])
  assert.deepEqual(evaluarArranque([...g.estaticos], raiz).violaciones, []) // tras un import() zod no está en el arranque
})

test('recorrerGrafo: alias @ y ~, extensiones, index, .js que es .ts, consulta y paquetes; lo que no resuelve se ignora', (t) => {
  const raiz = arbol(t, {
    'express/src/main.ts': [
      "import '@/lib/uno'", // @ es fiscalo/src
      "import '~/ui/dos'", // ~ es fiscalo/express/src, y el archivo es .tsx
      "import './carpeta'", // carpeta/index.ts
      "import './explicito.ts'",
      "import './compilado.js'", // solo existe compilado.ts
      "import './estilos.css?inline'", // sin el sufijo
      "import 'react-dom/client'", // un paquete es node_modules/<paquete>, sin entrar a su código
      "import '@tanstack/react-query'",
      "import 'zustand/middleware'",
      "import 'node:fs'",
      "import 'https://cdn.ejemplo.test/x.js'",
      "import './no-existe'",
    ].join('\n'),
    'src/lib/uno.ts': '',
    'express/src/ui/dos.tsx': '',
    'express/src/carpeta/index.ts': '',
    'express/src/explicito.ts': '',
    'express/src/compilado.ts': '',
    'express/src/estilos.css': '',
  })
  const esperado = [
    'express/src/carpeta/index.ts', 'express/src/compilado.ts', 'express/src/estilos.css', 'express/src/explicito.ts', 'express/src/main.ts',
    'express/src/ui/dos.tsx', 'node_modules/@tanstack/react-query', 'node_modules/react-dom', 'node_modules/zustand', 'src/lib/uno.ts',
  ]
  assert.deepEqual([...recorrerGrafo([join(raiz, 'express/src/main.ts')], raiz).todos].sort(), esperado)
})

test('recorrerGrafo: una entrada que no existe es un error y no un grafo vacio', (t) => {
  const raiz = arbol(t, {})
  assert.throws(() => recorrerGrafo([join(raiz, 'express/src/falta.ts')], raiz), /falta\.ts/)
})

test('recorrerGrafo: acepta entradas relativas a la raiz, resuelve los ciclos y no repite modulos', (t) => {
  const raiz = arbol(t, {
    'express/src/a.ts': "import './b'",
    'express/src/b.ts': "import './a'\nimport './b'",
  })
  assert.deepEqual([...recorrerGrafo(['express/src/a.ts', join(raiz, 'express/src/b.ts')], raiz).todos].sort(), ['express/src/a.ts', 'express/src/b.ts'])
})

// --- El informe: revisarGrafo -------------------------------------------------------------------------------------------

test('revisarGrafo: informa el primer modulo prohibido de cada cadena, con su cadena, y no lo que ese modulo arrastra', (t) => {
  const raiz = arbol(t, {
    'express/src/main.ts': "import '~/pantalla'",
    'express/src/pantalla.ts': "import '@/features/clients/NuevoModal'",
    'src/features/clients/NuevoModal.tsx': "import '@/lib/auxiliar'", // prohibido por su nombre
    'src/lib/auxiliar.ts': '', // tampoco está en la lista, pero entró por culpa del anterior: no es otro error
  })
  const principal = join(raiz, 'express/src/main.ts')
  const { violaciones, modulos } = revisarGrafo([principal], [principal], raiz)
  assert.deepEqual(violaciones.map((v) => [v.id, v.cadena]), [
    ['src/features/clients/NuevoModal.tsx', ['express/src/main.ts', 'express/src/pantalla.ts', 'src/features/clients/NuevoModal.tsx']],
  ])
  assert.match(violaciones[0].motivo, /prohibido/)
  assert.equal(modulos, 4)
})

test('revisarGrafo: zod y sus esquemas solo se admiten tras un import(), y la cadena dice quien los trae', (t) => {
  const archivos = (principal: string): Record<string, string> => ({
    'express/src/main.ts': principal,
    'express/src/pantalla.ts': "import '@/api/facturas'", // permitido, pero con zod dentro
    'src/api/facturas.ts': "import 'zod'",
  })
  const estatico = arbol(t, archivos("import '~/pantalla'"))
  const entrada = join(estatico, 'express/src/main.ts')
  assert.deepEqual(revisarGrafo([entrada], [entrada], estatico).violaciones.map((v) => [v.id, v.cadena]), [
    ['src/api/facturas.ts', ['express/src/main.ts', 'express/src/pantalla.ts', 'src/api/facturas.ts']],
    ['node_modules/zod', ['express/src/main.ts', 'express/src/pantalla.ts', 'src/api/facturas.ts', 'node_modules/zod']],
  ])
  const perezoso = arbol(t, archivos("export const pantalla = () => import('~/pantalla')"))
  const entradaPerezosa = join(perezoso, 'express/src/main.ts')
  assert.deepEqual(revisarGrafo([entradaPerezosa], [entradaPerezosa], perezoso).violaciones, [])
})

// --- El script: check-graph.mjs -----------------------------------------------------------------------------------------

/** `node check-graph.mjs <args>` desde el directorio temporal: el script ubica la raíz por su propia ruta, no por el directorio de trabajo. */
const correr = (ruta: string, ...args: string[]) => spawnSync(process.execPath, [ruta, ...args], { cwd: tmpdir(), encoding: 'utf8' })

test('CLI: el grafo real sale con 0 e imprime OK, corra desde donde corra', () => {
  const r = correr(CLI)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^OK/)
  assert.equal(r.stderr, '')
})

test('CLI: una entrada que importa un modulo prohibido sale con 1 e imprime la cadena', () => {
  const r = correr(CLI, FIX('entrada.ts'))
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stderr, /^FALLA/)
  assert.match(r.stderr, /src\/api\/mappers\.ts/)
  assert.match(r.stderr, /express\/tests\/fixtures\/mal-import\/entrada\.ts -> src\/api\/mappers\.ts/)
})

test('CLI: los import type no fallan; una entrada que no existe si', () => {
  const tipos = correr(CLI, FIX('solo-tipos.ts'))
  assert.equal(tipos.status, 0, tipos.stderr)
  const falta = correr(CLI, join(tmpdir(), 'no-existe-express.ts'))
  assert.equal(falta.status, 1)
  assert.match(falta.stderr, /^FALLA.*no-existe-express\.ts/)
})

test('CLI: sin argumentos revisa todos los archivos de express/src, aunque el arranque no los alcance', (t) => {
  // Se copia el script a un árbol propio (con enlace al node_modules del repo, de donde saca typescript) para que la raíz que
  // encuentre desde import.meta.url sea esa y no el repo.
  const raiz = arbol(t, {
    'express/src/main.tsx': 'export {}',
    'express/src/huerfano.ts': "import '../../src/api/mappers'", // nadie lo importa, pero está en express/src
    'src/api/mappers.ts': '',
  })
  mkdirSync(join(raiz, 'express', 'dev'), { recursive: true })
  for (const archivo of ['check-graph.mjs', 'graph-rules.mjs']) copyFileSync(join(RAIZ, 'express', 'dev', archivo), join(raiz, 'express', 'dev', archivo))
  symlinkSync(join(RAIZ, 'node_modules'), join(raiz, 'node_modules'), 'junction')
  const r = correr(join(raiz, 'express', 'dev', 'check-graph.mjs'))
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stderr, /express\/src\/huerfano\.ts -> src\/api\/mappers\.ts/)
  writeFileSync(join(raiz, 'express', 'src', 'huerfano.ts'), 'export {}')
  const limpio = correr(join(raiz, 'express', 'dev', 'check-graph.mjs'))
  assert.equal(limpio.status, 0, limpio.stderr)
})

// --- La guardia del build: forbiddenModuleGuard -------------------------------------------------------------------------

/**
 * La guardia con un contexto de plugin falso (`this.error` lanza, como en Rollup). `parsed(id, importados, dinamicos, esEntrada)` llama a
 * moduleParsed con los campos de ModuleInfo que usa; `abs` arma ids como los entrega Rollup (absolutos y con barras normales).
 */
function guardia() {
  const plugin: any = forbiddenModuleGuard()
  const contexto = {
    error(mensaje: string): never {
      throw new Error(mensaje)
    },
  }
  const parsed = (id: string, importados: string[] = [], dinamicos: string[] = [], esEntrada = false) =>
    plugin.moduleParsed.call(contexto, { id, importedIds: importados, dynamicallyImportedIds: dinamicos, isEntry: esEntrada })
  const abs = (ruta: string): string => RAIZ.replace(/\\/g, '/') + ruta
  return { plugin, parsed, abs }
}

/** El mensaje con que lanza `fn`; falla si no lanza (`assert.throws` con una expresión regular la prueba contra `Error: mensaje`, y no deja anclar con ^). */
function mensajeDe(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    return (error as Error).message
  }
  return assert.fail('debía lanzar y no lanzó')
}

test('forbiddenModuleGuard: el modulo permitido que importa algo prohibido falla, con lo que importa; lo permitido pasa', () => {
  const { plugin, parsed, abs } = guardia()
  assert.equal(plugin.apply, 'build')
  assert.doesNotThrow(() => parsed(abs('express/src/main.tsx'), [abs('src/api/http.ts'), abs('node_modules/react/index.js'), '\0vite/preload-helper.js']))
  // Falla nombrando quién importa y lo prohibido, con el motivo; lo permitido que también importa no se nombra.
  const mensaje = mensajeDe(() => parsed(abs('express/src/main.tsx'), [abs('src/api/mappers.ts'), abs('src/api/http.ts')]))
  assert.match(mensaje, /^express\/src\/main\.tsx importa módulos prohibidos en Express:\n {2}src\/api\/mappers\.ts: prohibido en Express/)
  assert.doesNotMatch(mensaje, /src\/api\/http\.ts/)
  // Un import() también mete el módulo al build.
  assert.match(mensajeDe(() => parsed(abs('express/src/main.tsx'), [], [abs('node_modules/sonner/dist/index.mjs')])), /^express\/src\/main\.tsx importa.*\n {2}node_modules\/sonner/)
  // Un archivo permitido de src/ que importa uno que no está en la lista: el caso de un cambio en la app de escritorio.
  assert.match(mensajeDe(() => parsed(abs('src/lib/format.ts'), [abs('src/lib/otro.ts')])), /^src\/lib\/format\.ts importa.*\n {2}src\/lib\/otro\.ts: no está en la lista de permitidos/)
  // Un módulo virtual (el id lleva \0 al principio) que importa algo prohibido se nombra sin el \0.
  const virtual = mensajeDe(() => parsed(`\0${abs('node_modules/x/index.js?commonjs-es-import')}`, [abs('src/api/mappers.ts')]))
  assert.equal(virtual.includes('\0'), false)
  assert.match(virtual, /src\/api\/mappers\.ts/)
})

test('forbiddenModuleGuard: un modulo ya prohibido calla, para que el error nombre al primero y no al mas hondo; una entrada prohibida falla', () => {
  // Rollup da por fallido un módulo cuando termina de cargar lo que importa: si cada módulo prohibido informara lo suyo, saldría primero el
  // más hondo (`existencia.ts`) y no `mappers.ts`, que es lo que alguien escribió. Solo informa el importador permitido, en cualquier orden.
  const { parsed, abs } = guardia()
  assert.doesNotThrow(() => parsed(abs('src/api/mappers.ts'), [abs('src/features/inventory/existencia.ts')]))
  assert.doesNotThrow(() => parsed(abs('src/features/inventory/existencia.ts')))
  assert.match(mensajeDe(() => parsed(abs('express/src/main.tsx'), [abs('src/api/mappers.ts')])), /src\/api\/mappers\.ts/)
  // Una entrada no tiene importador: se juzga ella misma.
  assert.match(mensajeDe(() => parsed(abs('src/pos/PosApp.tsx'), [], [], true)), /^Hay un módulo prohibido.*\n {2}src\/pos\/PosApp\.tsx: prohibido en Express.*entrada del build/)
  assert.doesNotThrow(() => parsed(abs('express/index.html'), [abs('express/src/main.tsx')], [], true))
})

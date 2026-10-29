// Plugins de Vite de Express: los que vigilan el build (módulos prohibidos, presupuesto de peso) y el que escribe version.json. Se registran
// en vite.config.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { evaluarIds, normalizarId } from './graph-rules.mjs'
import { evaluarPresupuesto, idCompilacion, tablaPresupuesto } from './presupuesto.mjs'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)) // la raíz del repo: se ubica desde este archivo, no desde el directorio de trabajo

/**
 * Falla el build si un módulo prohibido (anexo 3.3) entra al grafo de Express: algo de `fiscalo/src` que no esté en PERMITIDOS, el
 * barril `@/api`, sonner, lucide-react... La regla vive en graph-rules.mjs, la misma que usa check-graph.mjs antes del merge.
 *
 * `moduleParsed` corre cuando Rollup ya resolvió los imports del módulo (`importedIds`, `dynamicallyImportedIds`), pero antes de que
 * cargue los módulos a los que apuntan. `importers` todavía no está completo en ese momento y no sirve para saber quién importa a quién.
 *
 * Informa solo el módulo permitido que importa algo prohibido, con lo que importa: es el import que alguien escribió. Un módulo que ya es
 * prohibido calla aunque importe más cosas prohibidas (los archivos de `src/` que arrastra `mappers.ts`). Si cada prohibido informara lo
 * suyo, el error dependería del orden de carga: Rollup espera el resultado de `moduleParsed` de un módulo hasta haber cargado todo lo
 * que ese módulo importa, así que saldría primero el error del más hondo (`existencia.ts`) y no el de `mappers.ts`. Una entrada del
 * build no tiene importador y se juzga ella misma.
 * @returns {import('vite').Plugin}
 */
export function forbiddenModuleGuard() {
  return {
    name: 'express:forbidden-module-guard',
    apply: 'build', // el servidor de desarrollo no llama a moduleParsed; ahí vigilan eslint (no-restricted-imports) y check-graph.mjs
    moduleParsed(info) {
      const propio = evaluarIds([info.id], RAIZ).violaciones[0]
      if (propio !== undefined) {
        if (info.isEntry) this.error(`Hay un módulo prohibido en el grafo de Express:\n  ${propio.id}: ${propio.motivo} (es una entrada del build)`)
        return
      }
      const { violaciones } = evaluarIds([...info.importedIds, ...info.dynamicallyImportedIds], RAIZ)
      if (violaciones.length === 0) return
      const importador = normalizarId(info.id, RAIZ) ?? info.id.replace(/\0/g, '') // un módulo virtual lleva \0 al principio
      this.error(`${importador} importa módulos prohibidos en Express:\n${violaciones.map(({ id, motivo }) => `  ${id}: ${motivo}`).join('\n')}`)
    },
  }
}

// --- Presupuesto de peso ------------------------------------------------------------------------------------------------

/**
 * `false`: el presupuesto avisa y el build sigue (el plan 06 mide por primera vez y todavía no sabe cuánto pesará la app). El plan 07, en
 * su última tarea, lo cambia a `true`: desde entonces un exceso (pasar el límite; pasar el objetivo sigue siendo un aviso) rompe el build.
 */
export const FALLAR_PRESUPUESTO = false

/** El peso gzip de un contenido, medido como lo mide Vite al listar el build. */
const pesoGzip = (contenido) => gzipSync(contenido).length

const FUENTE = /\.(?:woff2?|ttf|otf)$/i
const esDeZod = (id) => id.replace(/\\/g, '/').includes('/node_modules/zod/')
const desdeNodeModules = (id) => {
  const ruta = id.replace(/\\/g, '/')
  return ruta.slice(ruta.indexOf('node_modules/'))
}

/** El tipo de presupuesto (presupuesto.mjs) de un recurso del bundle que no es JS. */
function tipoDeRecurso(nombre) {
  if (/\.html$/i.test(nombre)) return 'html'
  if (/\.css$/i.test(nombre)) return 'css'
  if (FUENTE.test(nombre)) return 'fuente'
  return 'otro'
}

/** Los nombres de los chunks que la entrada carga sin `import()`: ella misma y, hasta donde llegue, lo que importa de forma estática. */
function chunksDelArranque(bundle) {
  const vistos = new Set()
  const pendientes = Object.values(bundle)
    .filter((salida) => salida.type === 'chunk' && salida.isEntry)
    .map((salida) => salida.fileName)
  while (pendientes.length > 0) {
    const nombre = pendientes.pop()
    const salida = bundle[nombre]
    if (vistos.has(nombre) || salida?.type !== 'chunk') continue // un import externo no es un chunk del bundle
    vistos.add(nombre)
    pendientes.push(...salida.imports)
  }
  return vistos
}

/**
 * theme-init.js y las fuentes de `public/`. Vite las copia al build sin pasarlas por el bundle, así que `generateBundle` no las ve y,
 * sin esto, ni el límite de theme-init.js ni la fuente (que cuenta en la carga fría) se medirían nunca.
 * @param {string | false | undefined} publico la carpeta public de la configuración de Vite
 * @param {(contenido: string | Uint8Array) => number} medir
 * @returns {import('./presupuesto.mjs').ArchivoMedido[]}
 */
function archivosPublicos(publico, medir) {
  if (!publico) return []
  const archivos = []
  const tema = path.join(publico, 'theme-init.js')
  if (existsSync(tema)) archivos.push({ nombre: 'theme-init.js', tipo: 'themeInit', gzip: medir(readFileSync(tema)) })
  const carpeta = path.join(publico, 'fonts')
  if (existsSync(carpeta)) {
    for (const nombre of readdirSync(carpeta).sort()) {
      if (FUENTE.test(nombre)) archivos.push({ nombre: `fonts/${nombre}`, tipo: 'fuente', gzip: medir(readFileSync(path.join(carpeta, nombre))) })
    }
  }
  return archivos
}

/**
 * Mide el build contra el presupuesto de peso (anexo 15.4; el cálculo está en presupuesto.mjs): imprime una tabla y avisa de lo que pasa el
 * objetivo o el límite. Con `fallar` (por omisión FALLAR_PRESUPUESTO) un exceso rompe el build; un aviso, nunca.
 *
 * Clasifica así: la entrada y lo que importa sin `import()` es JS de arranque; el chunk que trae `/node_modules/zod/`, JS de zod; los demás
 * chunks, JS de ruta. Tiene que correr después de `vite:build-html` y `vite:css-post`, que dejan el HTML y el CSS finales en el bundle:
 * de ahí `enforce: 'post'`.
 *
 * Con independencia del presupuesto, ROMPE SIEMPRE el build si zod cae en lo que la entrada carga sin `import()`: zod no cabe en el primer
 * pintado. Es la regla de check-graph.mjs (que mira los import del código) aplicada a los chunks que de verdad salieron, por si Rollup
 * junta zod con el arranque aunque ningún import suyo sea estático.
 * @param {{ fallar?: boolean, medir?: (contenido: string | Uint8Array) => number }} [opciones] `medir` da el peso gzip; las pruebas lo cambian por la longitud
 * @returns {import('vite').Plugin}
 */
export function budget({ fallar = FALLAR_PRESUPUESTO, medir = pesoGzip } = {}) {
  let config
  return {
    name: 'express:budget',
    apply: 'build',
    enforce: 'post',
    configResolved(resuelta) {
      config = resuelta
    },
    generateBundle(_opciones, bundle) {
      const arranque = chunksDelArranque(bundle)
      for (const nombre of arranque) {
        const zod = Object.keys(bundle[nombre].modules).find(esDeZod)
        if (zod !== undefined) {
          this.error(
            `zod está en el JS de arranque: ${nombre} trae ${desdeNodeModules(zod)}. Los esquemas solo se cargan con import() desde un chunk ` +
              'perezoso; node express/dev/check-graph.mjs dice qué import lo trae.',
          )
        }
      }

      const archivos = []
      for (const [nombre, salida] of Object.entries(bundle)) {
        if (salida.type === 'chunk') {
          const tipo = arranque.has(nombre) ? 'entryJs' : Object.keys(salida.modules).some(esDeZod) ? 'zodJs' : 'rutaJs'
          archivos.push({ nombre, tipo, gzip: medir(salida.code) })
        } else {
          archivos.push({ nombre, tipo: tipoDeRecurso(nombre), gzip: medir(salida.source) })
        }
      }
      archivos.push(...archivosPublicos(config.publicDir, medir))

      config.logger.info(tablaPresupuesto(archivos))
      const { avisos, excesos } = evaluarPresupuesto(archivos)
      for (const aviso of avisos) this.warn(aviso)
      if (fallar && excesos.length > 0) this.error(`El bundle pasa el presupuesto:\n${excesos.map((exceso) => `  ${exceso}`).join('\n')}`)
      for (const exceso of excesos) this.warn(exceso)
    },
  }
}

// --- Versión de la compilación ------------------------------------------------------------------------------------------

const gitCorto = () =>
  execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true })

/**
 * El sha del commit que se compila: el de Vercel (`VERCEL_GIT_COMMIT_SHA`), si no el de git (`git rev-parse --short HEAD`), si no `local`
 * (sin git, o fuera de un repositorio). Una variable vacía no cuenta.
 * @param {Record<string, string | undefined>} [env]
 * @param {() => string} [git] lo que imprime git; las pruebas lo sustituyen
 * @returns {string}
 */
export function shaDeCompilacion(env = process.env, git = gitCorto) {
  const deVercel = (env.VERCEL_GIT_COMMIT_SHA ?? '').trim()
  if (deVercel !== '') return deVercel
  try {
    const deGit = git().trim()
    if (deGit !== '') return deGit
  } catch {
    // sin git, o fuera de un repositorio: cae a `local`
  }
  return 'local'
}

/**
 * La versión de esta compilación: `version` (idCompilacion) y `construido` (la hora, en ISO UTC). Se calcula una sola vez, en
 * vite.config.ts, y de ella salen `define.__BUILD_ID__` y `version.json`: la app compara su BUILD_ID con el `version` de version.json, y
 * si no fueran el mismo valor avisaría de una versión nueva siempre, o nunca.
 * @param {Date} [ahora]
 * @param {string} [sha]
 * @returns {{ version: string, construido: string }}
 */
export function compilacionActual(ahora = new Date(), sha = shaDeCompilacion()) {
  return { version: idCompilacion(ahora, sha), construido: ahora.toISOString() }
}

/**
 * Escribe `version.json` (`{ version, construido }`) en la raíz del build: la app lo consulta para saber si hay una versión nueva. Vercel
 * lo sirve con `Cache-Control: no-store` (express/vercel.json).
 * @param {{ version: string, construido: string }} [compilacion] la de vite.config.ts; por omisión, la de ahora
 * @returns {import('vite').Plugin}
 */
export function versionJson(compilacion = compilacionActual()) {
  return {
    name: 'express:version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(compilacion)}\n` })
    },
  }
}

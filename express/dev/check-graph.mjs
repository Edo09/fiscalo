// Guardia previa al merge: recorre los import de express/src, sin compilar, y falla si el grafo llega a un módulo que Express no puede
// importar (graph-rules.mjs, anexo 3.3) o si zod entra en el arranque. Es la misma regla que el plugin `forbiddenModuleGuard` aplica al
// build, pero se corre aparte (CI, `npm run check-graph`) porque un cambio posterior en la app de escritorio puede añadir un import
// prohibido a un archivo permitido, y el build de la app completa seguiría pasando mientras el de Express se rompe.
//
// Uso: `node express/dev/check-graph.mjs [entrada...]`, desde cualquier directorio (la raíz del repo se ubica desde este archivo).
//  - Sin entradas revisa todos los archivos fuente de express/src; con ellas, solo las que se den (rutas desde el directorio de trabajo).
//  - zod fuera del arranque se comprueba siempre sobre express/src/main.tsx.
// Imprime OK y sale con 0; si no, imprime FALLA con la cadena de imports de cada módulo malo y sale con 1.
import { readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cadenaDe, evaluarArranque, evaluarIds, EXTENSION_FUENTE, recorrerGrafo } from './graph-rules.mjs'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)) // la raíz del repo: se ubica desde este archivo, no desde el directorio de trabajo
const ARRANQUE = path.join(RAIZ, 'express', 'src', 'main.tsx')

/**
 * Revisa el grafo de imports que sale de `entradas`: los módulos que no pueden estar en Express (en cualquier arista, también las de
 * `import()`) y lo que no puede estar en la clausura estática de `arranque` (zod y sus esquemas). De cada cadena solo se informa el primer
 * módulo malo: lo que ese módulo importa después entró por su culpa y no es otro error.
 * @param {string[]} entradas archivos fuente, absolutos o relativos a la raíz
 * @param {string[]} arranque las entradas del arranque de la app
 * @param {string} raiz la raíz del repo
 * @returns {{ violaciones: { id: string, motivo: string, cadena: string[] }[], modulos: number }}
 */
export function revisarGrafo(entradas, arranque, raiz) {
  const grafo = recorrerGrafo(entradas, raiz)
  const prohibidos = evaluarIds([...grafo.todos], raiz).violaciones
  const malos = new Set(prohibidos.map(({ id }) => id))
  const violaciones = prohibidos
    .map((violacion) => ({ ...violacion, cadena: cadenaDe(grafo.padresTodos, violacion.id) }))
    .filter(({ cadena }) => !cadena.slice(0, -1).some((id) => malos.has(id)))
  const inicio = recorrerGrafo(arranque, raiz)
  for (const violacion of evaluarArranque([...inicio.estaticos], raiz).violaciones) {
    violaciones.push({ ...violacion, cadena: cadenaDe(inicio.padresEstaticos, violacion.id) })
  }
  return { violaciones, modulos: grafo.todos.size }
}

/** Todos los archivos fuente de `carpeta`, en orden. */
function archivosFuente(carpeta) {
  const archivos = []
  for (const entrada of readdirSync(carpeta, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const ruta = path.join(carpeta, entrada.name)
    if (entrada.isDirectory()) archivos.push(...archivosFuente(ruta))
    else if (EXTENSION_FUENTE.test(entrada.name)) archivos.push(ruta)
  }
  return archivos
}

/** Este archivo es el script que Node arrancó, y no uno que lo importa (graph.test.ts lo importa). */
function esLaEntrada() {
  const entrada = process.argv[1]
  if (!entrada) return false
  if (import.meta.url === pathToFileURL(entrada).href) return true
  try {
    // import.meta.url trae la ruta real y process.argv[1] la que se escribió: con un enlace en el camino ya no son iguales y el
    // script no correría (ni imprimiría nada), así que la guardia pasaría sin comprobar nada.
    return import.meta.url === pathToFileURL(realpathSync(entrada)).href
  } catch {
    return false
  }
}

if (esLaEntrada()) {
  try {
    const argumentos = process.argv.slice(2)
    const entradas = argumentos.length > 0 ? argumentos.map((argumento) => path.resolve(argumento)) : archivosFuente(path.join(RAIZ, 'express', 'src'))
    const { violaciones, modulos } = revisarGrafo(entradas, [ARRANQUE], RAIZ)
    if (violaciones.length === 0) {
      console.log(`OK: ${modulos} módulos revisados desde ${entradas.length} archivos; ninguno prohibido y zod queda fuera del arranque.`)
    } else {
      const cuantos = violaciones.length === 1 ? 'un módulo que no debe estar' : `${violaciones.length} módulos que no deben estar`
      const lineas = violaciones.map(({ id, motivo, cadena }) => `  ${id}\n    ${motivo}\n    cadena: ${cadena.join(' -> ')}`)
      console.error(`FALLA: el grafo de Express tiene ${cuantos}:\n\n${lineas.join('\n\n')}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`FALLA: ${error.message}`)
    process.exitCode = 1
  }
}

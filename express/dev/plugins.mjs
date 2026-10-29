// Plugins de Vite de Express: los que vigilan el build. Se registran en vite.config.ts.
import { fileURLToPath } from 'node:url'
import { evaluarIds, normalizarId } from './graph-rules.mjs'

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

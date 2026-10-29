// Reglas de aislamiento de Express (anexo 3.3) y el recorrido del grafo de imports que las comprueba.
//
// Express comparte con la app completa solo código de lectura: de `fiscalo/src` entra únicamente lo que esté en PERMITIDOS, por su ruta
// exacta y nunca por un barril. Lo demás (la UI de escritorio, el barril `@/api`, `api/mappers.ts`, sonner, lucide-react...) llevaría al
// teléfono código que no usa y que no cabe en el presupuesto de peso.
//
// Lo usan tres cosas:
//  - plugins.mjs (`forbiddenModuleGuard`): falla el build de Vite si un id prohibido entra al grafo. Solo necesita `evaluarIds`.
//  - check-graph.mjs, el script previo al merge: recorre los import del código fuente, sin compilar, y falla con la cadena de imports
//    que llega al módulo prohibido. Existe porque un cambio posterior en la app de escritorio puede añadir un import prohibido a un
//    archivo permitido, y sin él solo fallaría el proyecto de Express mientras la app completa sigue desplegándose.
//  - tests/graph.test.ts.
//
// Un id es la ruta de un módulo desde la raíz del repo (`fiscalo/`), en posix: `src/api/http.ts`, `express/src/main.tsx`. Un paquete de
// npm es `node_modules/<paquete>`: no se entra a su código.
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// --- Las reglas ---------------------------------------------------------------------------------------------------------

/**
 * Lo único de `fiscalo/src` que Express puede importar como valor: la lista "Allowed" del anexo 3.3 más tres hojas que esos archivos
 * importan a su vez (`api/config.ts` desde `http.ts` y `auth.ts`; `api/impresion.ts` desde `facturas.ts`, que trae `stores/impresora.ts`).
 * Agregar una ruta es decisión del dueño y no un arreglo para que pase el build, y la clausura de imports de la ruta nueva tiene que
 * estar ya dentro de la lista (graph.test.ts lo comprueba).
 * @type {string[]}
 */
export const PERMITIDOS = [
  // API: el cliente HTTP y los servicios de lectura. `facturas.ts` (trae zod) solo desde chunks perezosos: lo vigila FUERA_DEL_ARRANQUE.
  'src/api/http.ts',
  'src/api/errores.ts',
  'src/api/auth.ts',
  'src/api/clients.ts',
  'src/api/products.ts',
  'src/api/rnc.ts',
  'src/api/ncf.ts',
  'src/api/emisor.ts',
  'src/api/users.ts',
  'src/api/stats.ts',
  'src/api/estadosDgii.ts',
  'src/api/unidadesMedida.ts',
  'src/api/schemas/factura.ts',
  'src/api/types.ts', // solo tipos (incluye `ReciboDatos`)
  'src/api/facturas.ts',
  // Las hojas que los de arriba importan a su vez.
  'src/api/config.ts',
  'src/api/impresion.ts',
  'src/stores/impresora.ts',
  // Sesión, reglas de facturación y utilidades.
  'src/stores/auth.ts',
  'src/features/invoices/montosLinea.ts',
  'src/features/invoices/enVuelo.ts',
  'src/features/invoices/reenvio.ts',
  'src/features/invoices/notasVinculadas.ts',
  'src/features/invoices/factura.schema.ts',
  'src/features/ecf/avisosEcf.ts',
  'src/features/ecf/rangosNcf.ts',
  'src/features/clients/validacion.ts',
  'src/lib/format.ts',
  'src/lib/date.ts',
  'src/config/ecf.ts',
  'src/config/cache.ts',
  'src/hooks/useAccionUnica.ts',
  'src/hooks/useApiQuery.ts',
  'src/pos/montos.ts', // del POS entran cinco ayudantes de este archivo y nada más
]

/**
 * Lo que el anexo 3.3 prohíbe (fila "Forbidden"), sobre ids desde la raíz del repo. Todo lo de `src/` que no está en PERMITIDOS también
 * se rechaza; esta lista da el motivo exacto y cubre los paquetes de npm, que PERMITIDOS no conoce.
 * @type {RegExp[]}
 */
export const PROHIBIDOS = [
  /^src\/(App|main)\.tsx$/, // el shell y el arranque de la app completa
  /^src\/config\/navigation\.ts$/, // `puedeVerItem` falla abierto
  /^src\/components\/(layout|ui)\//, // el barril de UI trae sonner y las gráficas
  /^src\/api\/(index|mappers)\.ts$/, // el barril `@/api` y los mapeadores de la app completa
  /^src\/features\/invoices\/reciboHtml\.ts$/,
  /^src\/features\/.*View\.tsx$/,
  /^src\/.*(Modal|Combobox)\.tsx$/,
  /^src\/(.*\/)?RncConsultaField\.tsx$/,
  /^src\/hooks\/(useHistoryNav|useAvisoSalida)\.ts$/,
  /^src\/lib\/(file|printHtml)\.ts$/,
  /^src\/pos\/(?!montos\.ts$)/, // del POS solo entra `pos/montos.ts`
  /^src\/styles\/(styles|bold|responsive)\.css$/, // `bold.css` usa color-mix(), fuera del piso de navegadores
  /(^|\/)node_modules\/(sonner|lucide-react)(\/|$)/, // los avisos y los iconos de Express son propios (los iconos se generan)
]

/**
 * Lo que solo puede cargarse tras un `import()`: zod y los módulos que lo traen. Fuera de la clausura estática del arranque
 * (`express/src/main.tsx`), porque zod en el primer pintado revienta el presupuesto de peso.
 * @type {RegExp[]}
 */
export const FUERA_DEL_ARRANQUE = [
  /(^|\/)node_modules\/zod(\/|$)/,
  /^src\/api\/facturas\.ts$/,
  /^src\/api\/schemas\/factura\.ts$/,
  /^src\/features\/invoices\/factura\.schema\.ts$/,
]

const PERMITIDOS_SET = new Set(PERMITIDOS)
const ES_DE_PAQUETE = /(^|\/)node_modules\//

// --- Qué entra: ids -----------------------------------------------------------------------------------------------------

/**
 * El id de un módulo como ruta desde la raíz del repo, en posix y sin sufijos (`?v=1`, `#x`): `src/api/http.ts`. Una ruta fuera de la
 * raíz queda absoluta, y una relativa se normaliza (`express/../src/a.ts` es `src/a.ts`). Null para lo que no es un archivo: los ids
 * virtuales de Rollup (empiezan con `\0`) y los vacíos.
 * @param {string} id absoluto (con `/` o `\`) o relativo a la raíz
 * @param {string} raiz la raíz del repo
 * @returns {string | null}
 */
export function normalizarId(id, raiz) {
  if (id.startsWith('\0')) return null
  const limpio = id.replace(/[?#].*$/, '').replace(/\\/g, '/')
  if (limpio === '') return null
  if (!path.isAbsolute(limpio)) return path.posix.normalize(limpio)
  const relativa = path.relative(path.resolve(raiz), path.resolve(limpio))
  if (relativa === '') return null
  const fuera = relativa === '..' || relativa.startsWith(`..${path.sep}`) || path.isAbsolute(relativa)
  return fuera ? limpio : relativa.split(path.sep).join('/')
}

/** Por qué un id no puede entrar a Express, o null si puede. */
function motivoDeId(id) {
  if (PROHIBIDOS.some((regla) => regla.test(id))) return 'prohibido en Express (anexo 3.3)'
  if (ES_DE_PAQUETE.test(id) || id.startsWith('express/')) return null
  if (id.startsWith('src/')) return PERMITIDOS_SET.has(id) ? null : 'no está en la lista de permitidos: de src/ solo entran esas rutas exactas (anexo 3.3)'
  return 'fuera de express/, de src/ y de node_modules/'
}

/** Por qué un id no puede estar en la clausura estática del arranque, o null si puede. */
function motivoDeArranque(id) {
  return FUERA_DEL_ARRANQUE.some((regla) => regla.test(id)) ? 'solo puede cargarse con import(): en el arranque rompe el presupuesto del primer pintado' : null
}

/** Cada id distinto, normalizado, con el motivo por el que no pasa. */
function juzgar(ids, raiz, motivoDe) {
  const violaciones = []
  const vistos = new Set()
  for (const original of ids) {
    const id = normalizarId(original, raiz)
    if (id === null || vistos.has(id)) continue
    vistos.add(id)
    const motivo = motivoDe(id)
    if (motivo !== null) violaciones.push({ id, motivo })
  }
  return { violaciones }
}

/**
 * Los ids que no pueden estar en Express: lo prohibido (anexo 3.3), lo de `src/` que no está en PERMITIDOS y lo que queda fuera de
 * `express/`, `src/` y `node_modules/`. Un id repetido cuenta una vez.
 * @param {string[]} ids absolutos o relativos a la raíz; los sufijos de consulta (`?v=1`) se ignoran
 * @param {string} raiz la raíz del repo
 * @returns {{ violaciones: { id: string, motivo: string }[] }}
 */
export function evaluarIds(ids, raiz) {
  return juzgar(ids, raiz, motivoDeId)
}

/**
 * Lo que sobra en la clausura estática del arranque: zod y sus esquemas solo se cargan con `import()`.
 * @param {string[]} estaticos la clausura estática de `express/src/main.tsx` (el `estaticos` de recorrerGrafo)
 * @param {string} raiz la raíz del repo
 * @returns {{ violaciones: { id: string, motivo: string }[] }}
 */
export function evaluarArranque(estaticos, raiz) {
  return juzgar(estaticos, raiz, motivoDeArranque)
}

// --- Qué importa quién: el AST ------------------------------------------------------------------------------------------

let typescript
/**
 * `typescript` se carga con el primer recorrido y no al importar este archivo: vite.config.ts importa evaluarIds (por el plugin) y el
 * build ni debe pagar los ~275 ms de cargar TypeScript ni depender de él.
 */
const cargarTypescript = () => (typescript ??= createRequire(import.meta.url)('typescript'))

/**
 * Los especificadores de un archivo fuente, tal como se escribieron, con solo las aristas de VALOR: un import cuya cláusula es
 * `import type`, o cuyos especificadores son todos `type`, se borra al compilar y no cuenta (`montosLinea.ts` y `config/ecf.ts`
 * importan tipos del barril `@/api` así). `export ... from` cuenta igual que un import. Un `import()` es dinámico: carga un chunk
 * aparte y por eso se devuelve a un lado.
 * @returns {{ estaticos: string[], dinamicos: string[] }}
 */
function importsDe(archivo, texto) {
  const ts = cargarTypescript()
  const tipo = /\.[jt]sx$/.test(archivo) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(archivo) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, false, tipo)
  const todosTipo = (elementos) => elementos.length > 0 && elementos.every((elemento) => elemento.isTypeOnly)
  const estaticos = []
  const dinamicos = []
  const visitar = (nodo) => {
    if (ts.isImportDeclaration(nodo)) {
      const clausula = nodo.importClause // sin cláusula es `import 'x'`, de efecto: arista
      const enlaces = clausula?.namedBindings
      const soloTipos =
        clausula !== undefined && (clausula.isTypeOnly || (clausula.name === undefined && enlaces !== undefined && ts.isNamedImports(enlaces) && todosTipo(enlaces.elements)))
      if (!soloTipos && ts.isStringLiteralLike(nodo.moduleSpecifier)) estaticos.push(nodo.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(nodo)) {
      const clausula = nodo.exportClause
      const soloTipos = nodo.isTypeOnly || (clausula !== undefined && ts.isNamedExports(clausula) && todosTipo(clausula.elements))
      if (!soloTipos && nodo.moduleSpecifier !== undefined && ts.isStringLiteralLike(nodo.moduleSpecifier)) estaticos.push(nodo.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(nodo)) {
      const referencia = nodo.moduleReference // `import x = require('y')`
      if (!nodo.isTypeOnly && ts.isExternalModuleReference(referencia) && ts.isStringLiteralLike(referencia.expression)) estaticos.push(referencia.expression.text)
    } else if (ts.isCallExpression(nodo) && nodo.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argumento] = nodo.arguments // con una variable no se sabe adónde va: sin arista
      if (argumento !== undefined && ts.isStringLiteralLike(argumento)) dinamicos.push(argumento.text)
    }
    ts.forEachChild(nodo, visitar)
  }
  visitar(fuente)
  return { estaticos, dinamicos }
}

// --- Adónde apunta cada import: la resolución ---------------------------------------------------------------------------

const EXTENSIONES = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'] // el orden de resolve.extensions de Vite
const COMPILADO_A_FUENTE = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'] } // `./a.js` que en disco es `a.ts`
export const EXTENSION_FUENTE = /\.(?:[cm]?[jt]s|[jt]sx)$/ // lo que se lee con el AST (check-graph.mjs también la usa para listar express/src)

const esArchivo = (ruta) => {
  try {
    return statSync(ruta).isFile()
  } catch {
    return false
  }
}

/** `destino` (ruta absoluta, con o sin extensión) como archivo real: tal cual, con una extensión o su index; null si no hay. */
function archivoDe(destino) {
  if (esArchivo(destino)) return destino
  const extension = path.extname(destino)
  for (const fuente of COMPILADO_A_FUENTE[extension] ?? []) {
    const candidato = destino.slice(0, -extension.length) + fuente
    if (esArchivo(candidato)) return candidato
  }
  for (const sufijo of EXTENSIONES) if (esArchivo(destino + sufijo)) return destino + sufijo
  for (const sufijo of EXTENSIONES) if (esArchivo(path.join(destino, `index${sufijo}`))) return path.join(destino, `index${sufijo}`)
  return null
}

/** `node_modules/<paquete>` para un especificador de paquete (`zustand/middleware`, `@tanstack/react-query`); null si no es uno. */
function idDePaquete(especificador) {
  // `node:fs`, `https://…`, `virtual:x` (un esquema), `/ruta` (de la raíz de Vite) y `#interno` no son paquetes.
  if (especificador === '' || /^[a-z][a-z0-9+.-]*:/i.test(especificador) || /^[/#]/.test(especificador)) return null
  const partes = especificador.split('/')
  return `node_modules/${especificador.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0]}`
}

/**
 * El id al que apunta `especificador` desde el archivo `desde` (ruta absoluta), con los alias de vite.config.ts (`@` es `src/`, `~` es
 * `express/src/`); null si no lleva a nada que resolver: un archivo que no existe, un esquema o un especificador vacío.
 */
function resolverEspecificador(especificador, desde, raiz) {
  const limpio = especificador.replace(/[?#].*$/, '') // `./a.svg?raw` es `./a.svg`
  let destino
  if (limpio.startsWith('@/')) destino = path.join(raiz, 'src', limpio.slice(2))
  else if (limpio.startsWith('~/')) destino = path.join(raiz, 'express', 'src', limpio.slice(2))
  else if (limpio === '.' || limpio === '..' || limpio.startsWith('./') || limpio.startsWith('../')) destino = path.resolve(path.dirname(desde), limpio)
  else return idDePaquete(limpio)
  const archivo = archivoDe(destino)
  return archivo === null ? null : normalizarId(archivo, raiz)
}

// --- El recorrido -------------------------------------------------------------------------------------------------------

const SIN_ARISTAS = { estaticas: [], dinamicas: [] }

/** Solo se lee el código fuente del repo: ni los paquetes (hojas del grafo), ni lo que cae fuera de la raíz, ni los CSS o imágenes. */
const esFuenteDelRepo = (id) => EXTENSION_FUENTE.test(id) && !path.isAbsolute(id) && !id.startsWith('../') && !ES_DE_PAQUETE.test(id)

/** Los ids que importa `archivo` (ruta absoluta): `estaticas` y `dinamicas`, sin repetidos y sin los que no se resuelven. */
function leerAristas(archivo, raiz) {
  const { estaticos, dinamicos } = importsDe(archivo, readFileSync(archivo, 'utf8'))
  const resolver = (especificador) => resolverEspecificador(especificador, archivo, raiz)
  const sinNulos = (ids) => [...new Set(ids.filter((id) => id !== null))]
  return { estaticas: sinNulos(estaticos.map(resolver)), dinamicas: sinNulos(dinamicos.map(resolver)) }
}

/**
 * El grafo de imports de VALOR que sale de `entradas`, leído del código fuente con el AST de `typescript` (no compila ni ejecuta nada).
 * `estaticos` es la clausura por imports estáticos (lo que carga el arranque) y `todos` suma lo que se alcanza con `import()`.
 * `padresEstaticos` y `padresTodos` dicen, por módulo, quién lo trajo primero (null para una entrada): `cadenaDe` arma con ellos la
 * cadena de imports hasta un módulo. Un import que no resuelve (un archivo que no existe) se ignora: lo dicen tsc y el build. Solo ve lo
 * que está escrito: el runtime de JSX (`react/jsx-runtime`), que el compilador agrega solo, no aparece.
 * @param {string[]} entradas archivos fuente, absolutos o relativos a la raíz; una que no existe lanza un Error
 * @param {string} raiz la raíz del repo
 * @returns {{ estaticos: Set<string>, todos: Set<string>, padresEstaticos: Map<string, string | null>, padresTodos: Map<string, string | null> }}
 */
export function recorrerGrafo(entradas, raiz) {
  const base = path.resolve(raiz)
  const memo = new Map()
  const aristasDe = (id) => {
    let aristas = memo.get(id)
    if (aristas === undefined) {
      aristas = esFuenteDelRepo(id) ? leerAristas(path.resolve(base, id), base) : SIN_ARISTAS
      memo.set(id, aristas)
    }
    return aristas
  }
  const inicio = entradas.map((entrada) => {
    const id = normalizarId(entrada, base)
    if (id === null || !esArchivo(path.resolve(base, id))) throw new Error(`la entrada ${entrada} no existe`)
    return id
  })
  const recorrer = (conImportDinamico) => {
    const padres = new Map(inicio.map((id) => [id, null]))
    const cola = [...padres.keys()]
    for (let i = 0; i < cola.length; i++) {
      const { estaticas, dinamicas } = aristasDe(cola[i])
      for (const hijo of conImportDinamico ? [...estaticas, ...dinamicas] : estaticas) {
        if (padres.has(hijo)) continue
        padres.set(hijo, cola[i])
        cola.push(hijo)
      }
    }
    return padres
  }
  const padresEstaticos = recorrer(false)
  const padresTodos = recorrer(true)
  return { estaticos: new Set(padresEstaticos.keys()), todos: new Set(padresTodos.keys()), padresEstaticos, padresTodos }
}

/**
 * La cadena de imports que lleva de una entrada hasta `id`, de la entrada al módulo, según un mapa de padres de recorrerGrafo.
 * @param {Map<string, string | null>} padres `padresEstaticos` o `padresTodos`
 * @param {string} id
 * @returns {string[]}
 */
export function cadenaDe(padres, id) {
  const cadena = []
  for (let actual = id; actual !== null && actual !== undefined; actual = padres.get(actual)) cadena.unshift(actual)
  return cadena
}

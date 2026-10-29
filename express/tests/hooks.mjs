// Hooks de módulos del cargador de pruebas (los registra _loader.mjs). Enseñan a Node lo que Vite hace por la app:
// los alias `@` y `~`, los imports sin extensión y `import.meta.env`. Los tipos de TypeScript los quita Node con
// `stripTypeScriptTypes`, que no transforma: el código que se prueba no puede usar enums, namespaces ni propiedades
// de parámetro, y los tipos se importan con `import type`.
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

// En la primera llamada a stripTypeScriptTypes de cada proceso Node avisa «ExperimentalWarning», y el corredor de pruebas lo
// reenviaría en la salida de cada archivo. Este módulo corre en el hilo de los hooks, no en el de las pruebas: solo se calla ese aviso.
const emitirAviso = process.emitWarning
process.emitWarning = (aviso, ...resto) => {
  if (!String(aviso).includes('stripTypeScriptTypes')) emitirAviso.call(process, aviso, ...resto)
}

const RAIZ_APP = new URL('../../src/', import.meta.url) // alias @: fiscalo/src
const RAIZ_EXPRESS = new URL('../src/', import.meta.url) // alias ~: fiscalo/express/src

const esArchivo = (url) => {
  try {
    return statSync(fileURLToPath(url)).isFile()
  } catch {
    return false
  }
}

const esRelativo = (especificador) => especificador.startsWith('./') || especificador.startsWith('../')

/** `ruta.ts` y luego `ruta/index.ts`: la primera que exista, o null. */
function completar(url) {
  for (const sufijo of ['.ts', '/index.ts']) {
    const candidata = new URL(url)
    candidata.pathname += sufijo
    if (esArchivo(candidata)) return candidata
  }
  return null
}

/** La URL a la que apunta un alias o un relativo de la app; null si Node lo resuelve como siempre (paquetes, `node:`). */
function destinoDe(especificador, padre) {
  if (especificador.startsWith('@/')) return new URL(especificador.slice(2), RAIZ_APP)
  if (especificador.startsWith('~/')) return new URL(especificador.slice(2), RAIZ_EXPRESS)
  // Los relativos de un paquete de node_modules tampoco se tocan.
  if (esRelativo(especificador) && padre?.startsWith('file:') && !padre.includes('/node_modules/')) return new URL(especificador, padre)
  return null
}

export async function resolve(especificador, contexto, siguiente) {
  const destino = destinoDe(especificador, contexto.parentURL)
  if (destino === null) return siguiente(especificador, contexto)

  const completo = completar(destino)
  if (completo !== null) return siguiente(completo.href, contexto)
  // Ya trae extensión (`@/x.json`, `./x.ts`): un alias se resuelve por su ruta real, un relativo tal cual.
  return siguiente(esRelativo(especificador) ? especificador : destino.href, contexto)
}

export async function load(url, contexto, siguiente) {
  const { protocol, pathname } = new URL(url)
  if (protocol !== 'file:' || !pathname.endsWith('.ts') || pathname.includes('/node_modules/')) return siguiente(url, contexto)

  const fuente = await readFile(fileURLToPath(url), 'utf8')
  // Vite sustituye `import.meta.env` al compilar; aquí se lee de la global que define _loader.mjs, en cada acceso.
  const source = stripTypeScriptTypes(fuente, { mode: 'strip' }).replace(/\bimport\.meta\.env\b/g, 'globalThis.__VITE_ENV__')
  return { format: 'module', source, shortCircuit: true }
}

// Guardia del origen del API: express/vercel.json y el vercel.json de la raíz mandan /api/:path* al mismo origen.
// El destino de express/vercel.json se copia a mano del de la raíz (Vercel lee el archivo tal cual, sin variables). Esta guardia
// es el primer paso del build de Express (`node express/dev/check-api-origin.mjs`, ver package.json): si los dos orígenes
// se separan, falla antes de compilar un shell que hablaría con un API distinto del de la app completa.
//
// Uso: `node express/dev/check-api-origin.mjs`. Imprime OK y sale con 0; si no, imprime FALLA y sale con 1.
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REESCRITURA_API = '/api/:path*'
const RAIZ = new URL('../../', import.meta.url) // la raíz del repo: se ubica desde este archivo, no desde el directorio de trabajo

/**
 * El origen (esquema, host y puerto) al que el JSON de Vercel manda `/api/:path*`, o null si no hay uno que decir: sin esa
 * reescritura, con un destino que no es una URL http(s) absoluta o con algo que no es un vercel.json.
 * @param {unknown} vercelJson el contenido ya parseado de un vercel.json
 * @returns {string | null}
 */
export function origenApi(vercelJson) {
  const reescrituras = vercelJson?.rewrites
  if (!Array.isArray(reescrituras)) return null
  const api = reescrituras.find((r) => r?.source === REESCRITURA_API)
  if (typeof api?.destination !== 'string') return null
  try {
    const url = new URL(api.destination)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * @param {unknown} raiz el vercel.json de la raíz del repo (la app completa)
 * @param {unknown} express el vercel.json de express/
 * @returns {{ ok: boolean, mensaje: string }}
 */
export function compararOrigenes(raiz, express) {
  const origenRaiz = origenApi(raiz)
  const origenExpress = origenApi(express)
  const sinOrigen = (archivo) =>
    `FALLA: ${archivo} no manda ${REESCRITURA_API} a un origen http(s): falta esa reescritura o su destino no es una URL absoluta.`
  if (origenRaiz === null) return { ok: false, mensaje: sinOrigen('vercel.json de la raíz') }
  if (origenExpress === null) return { ok: false, mensaje: sinOrigen('express/vercel.json') }
  if (origenRaiz !== origenExpress) {
    return {
      ok: false,
      mensaje: `FALLA: express/vercel.json manda ${REESCRITURA_API} a ${origenExpress} y vercel.json de la raíz a ${origenRaiz}. Deben ser el mismo origen: copia el destino de la raíz a express/vercel.json.`,
    }
  }
  return { ok: true, mensaje: `OK: express/vercel.json y vercel.json de la raíz mandan ${REESCRITURA_API} al mismo origen (${origenRaiz}).` }
}

/** Este archivo es el script que Node arrancó, y no uno que lo importa (hosting.test.ts lo importa). */
function esLaEntrada() {
  const entrada = process.argv[1]
  if (!entrada) return false
  if (import.meta.url === pathToFileURL(entrada).href) return true
  try {
    // import.meta.url trae la ruta real (Node resuelve los enlaces simbólicos y las uniones de Windows) y process.argv[1] la que
    // se escribió: con un enlace en el camino ya no son iguales, la guardia no correría y el build pasaría sin comprobar nada.
    return import.meta.url === pathToFileURL(realpathSync(entrada)).href
  } catch {
    return false
  }
}

/** El JSON de `archivo`, una ruta desde la raíz del repo. */
function leerJson(archivo) {
  try {
    return JSON.parse(readFileSync(new URL(archivo, RAIZ), 'utf8'))
  } catch (error) {
    throw new Error(`no se pudo leer ${archivo}: ${error.message}`)
  }
}

if (esLaEntrada()) {
  let resultado
  try {
    resultado = compararOrigenes(leerJson('vercel.json'), leerJson('express/vercel.json'))
  } catch (error) {
    resultado = { ok: false, mensaje: `FALLA: ${error.message}` }
  }
  if (resultado.ok) {
    console.log(resultado.mensaje)
  } else {
    console.error(resultado.mensaje)
    process.exitCode = 1
  }
}

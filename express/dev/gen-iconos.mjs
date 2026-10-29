// Genera express/src/ui/iconos.ts: los nodos SVG de los iconos de lucide que usa Express, como datos que dibuja ui/Icon.tsx. La app no importa
// lucide-react (traería al arranque un paquete de miles de iconos, anexo 15.4): copia de él solo estos nombres.
// Uso, desde fiscalo/: node express/dev/gen-iconos.mjs
// Cada icono de lucide es un archivo node_modules/lucide-react/dist/esm/icons/<nombre>.js que le pasa a `createLucideIcon` una lista de nodos. Aquí
// se saca ese literal del texto del archivo, se evalúa dentro de este script (a la app no llega nada que se evalúe: la CSP prohíbe `eval`) y se
// escribe como datos, sin la `key` que lucide pone a cada nodo para React (Icon pone la suya).
// Para agregar un icono: ponlo en NOMBRES, corre el script y sube el iconos.ts que sale. tests/iconos.test.ts falla si la tabla no es la que sale hoy
// de lucide.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

/** Los iconos que usa Express, en el orden de `IconName` (plan 06, tarea 14). El tipo `IconName` y la tabla `ICONOS` salen de esta lista. */
export const NOMBRES = [
  'file-text',
  'users',
  'plus',
  'package',
  'ellipsis',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'refresh-cw',
  'circle-check',
  'clock',
  'triangle-alert',
  'circle-x',
  'circle-help',
  'circle-alert',
  'rotate-ccw',
  'hash',
  'message-circle',
  'log-out',
  'share-2',
  'copy',
  'check',
  'search',
  'x',
  'wifi-off',
  'building-2',
]

/** Las etiquetas SVG que ui/Icon dibuja. Un icono con otra (ellipse, polygon...) no se extrae: antes hay que enseñársela a Icon. */
const ETIQUETAS = ['path', 'circle', 'rect', 'line', 'polyline']

const RAIZ = new URL('../../', import.meta.url) // fiscalo/
const CARPETA_LUCIDE = new URL('node_modules/lucide-react/dist/esm/icons/', RAIZ)
const DESTINO = new URL('express/src/ui/iconos.ts', RAIZ)

/**
 * Los nodos de un icono: el literal que su archivo de lucide le pasa a `createLucideIcon`, evaluado, sin la `key` de cada nodo y ya comprobado
 * (solo etiquetas que Icon dibuja, atributos que son texto y ninguno vacío).
 * @param {string} fuente el texto del archivo de lucide
 * @param {string} nombre el nombre del icono (solo para los mensajes de error)
 * @returns {Array<[string, Record<string, string>]>}
 */
export function extraerNodos(fuente, nombre) {
  // Hay una sola llamada por archivo; la lista llega hasta el último `]` que va antes del `)` y el `;` (en `check.js` todo está en una línea).
  const llamada = /createLucideIcon\(\s*"[^"]*"\s*,\s*(\[[\s\S]*\])\s*\)\s*;/.exec(fuente)
  if (llamada === null) throw new Error(`${nombre}: no encuentro createLucideIcon("Nombre", [...]) en el archivo de lucide`)
  // Un contexto vacío: el literal es de un paquete de confianza, pero tampoco tiene por qué ver `process` ni `require`. El paso por JSON lo trae al
  // mundo de este script (los arreglos de otro contexto tienen otro prototipo y `assert.deepEqual` los distingue) y asegura que sean solo datos.
  const crudo = JSON.parse(JSON.stringify(runInNewContext(`(${llamada[1]})`, {}, { timeout: 1000 })))
  if (!Array.isArray(crudo) || crudo.length === 0) throw new Error(`${nombre}: la lista de nodos está vacía o no es una lista`)
  return crudo.map((nodo) => {
    if (!Array.isArray(nodo) || nodo.length !== 2) throw new Error(`${nombre}: un nodo no es [etiqueta, atributos]`)
    const [etiqueta, atributos] = nodo
    if (!ETIQUETAS.includes(etiqueta)) throw new Error(`${nombre}: la etiqueta «${etiqueta}» no la dibuja ui/Icon (solo ${ETIQUETAS.join(', ')})`)
    if (typeof atributos !== 'object' || atributos === null || Array.isArray(atributos)) {
      throw new Error(`${nombre}: los atributos de ${etiqueta} no son un objeto`)
    }
    const limpios = Object.fromEntries(Object.entries(atributos).filter(([atributo]) => atributo !== 'key'))
    const pares = Object.entries(limpios)
    if (pares.length === 0) throw new Error(`${nombre}: un ${etiqueta} sin más atributos que la key no dibuja nada`)
    for (const [atributo, valor] of pares) {
      if (typeof valor !== 'string' || valor === '') throw new Error(`${nombre}: ${etiqueta}.${atributo} no es un texto con contenido`)
    }
    return [etiqueta, limpios]
  })
}

/**
 * Los nodos de cada icono de `nombres`, leídos de los archivos de lucide-react instalados.
 * @param {string[]} nombres
 * @param {URL} carpeta la carpeta de iconos de lucide (solo la cambia quien pruebe con otra)
 * @returns {Record<string, Array<[string, Record<string, string>]>>}
 */
export function leerIconos(nombres = NOMBRES, carpeta = CARPETA_LUCIDE) {
  const iconos = {}
  for (const nombre of nombres) {
    const archivo = new URL(`${nombre}.js`, carpeta)
    if (!existsSync(archivo)) {
      throw new Error(`no existe ${fileURLToPath(archivo)}: ¿falta correr npm ci en fiscalo/, o «${nombre}» no está en esta versión de lucide-react?`)
    }
    iconos[nombre] = extraerNodos(readFileSync(archivo, 'utf8'), nombre)
  }
  return iconos
}

/** El texto entre comillas simples, como se escribe en el resto de Express. */
const comillas = (texto) => `'${texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** El nombre de una propiedad, con comillas solo si no es un identificador. */
const propiedad = (nombre) => (/^[A-Za-z_$][\w$]*$/.test(nombre) ? nombre : comillas(nombre))

/**
 * El texto de iconos.ts. Una función pura, para que se pueda probar sin tocar el disco.
 * @param {Record<string, Array<[string, Record<string, string>]>>} iconos
 * @param {string} version la de lucide-react de donde salen
 * @returns {string}
 */
export function generarFuente(iconos, version) {
  const nombres = Object.keys(iconos)
  const lineas = [
    `// GENERADO por express/dev/gen-iconos.mjs a partir de lucide-react ${version}. No lo edites: cambia NOMBRES en el script y vuelve a correrlo`,
    '// (`node express/dev/gen-iconos.mjs`, desde fiscalo/). tests/iconos.test.ts falla si esta tabla no es la que sale hoy de lucide.',
    '// Los trazados son de Lucide (licencia ISC, https://lucide.dev/license): se copian los datos y no el paquete, para que el arranque no cargue los',
    '// iconos que Express no usa.',
    '',
    '/** Las etiquetas SVG que dibuja `Icon`. */',
    `export type EtiquetaSvg = ${ETIQUETAS.map(comillas).join(' | ')}`,
    '',
    '/** Un nodo de un icono: la etiqueta SVG y sus atributos (sin la `key` de lucide). */',
    'export type NodoIcono = readonly [EtiquetaSvg, Readonly<Record<string, string>>]',
    '',
    'export type IconName =',
    ...nombres.map((nombre) => `  | ${comillas(nombre)}`),
    '',
    'export const ICONOS: Readonly<Record<IconName, readonly NodoIcono[]>> = {',
  ]
  for (const nombre of nombres) {
    lineas.push(`  ${comillas(nombre)}: [`)
    for (const [etiqueta, atributos] of iconos[nombre]) {
      const pares = Object.entries(atributos).map(([atributo, valor]) => `${propiedad(atributo)}: ${comillas(valor)}`)
      lineas.push(`    [${comillas(etiqueta)}, { ${pares.join(', ')} }],`)
    }
    lineas.push('  ],')
  }
  lineas.push('}', '')
  return lineas.join('\n')
}

/** Este archivo es el script que Node arrancó, y no uno que lo importa (tests/iconos.test.ts lo importa). */
function esLaEntrada() {
  const entrada = process.argv[1]
  if (!entrada) return false
  if (import.meta.url === pathToFileURL(entrada).href) return true
  try {
    // import.meta.url trae la ruta real y process.argv[1] la que se escribió: con un enlace en el camino ya no son iguales.
    return import.meta.url === pathToFileURL(realpathSync(entrada)).href
  } catch {
    return false
  }
}

if (esLaEntrada()) {
  try {
    const iconos = leerIconos()
    const version = JSON.parse(readFileSync(new URL('node_modules/lucide-react/package.json', RAIZ), 'utf8')).version
    const fuente = generarFuente(iconos, version)
    mkdirSync(new URL('./', DESTINO), { recursive: true })
    writeFileSync(DESTINO, fuente)
    const nodos = Object.values(iconos).reduce((suma, lista) => suma + lista.length, 0)
    console.log(`express/src/ui/iconos.ts: ${Object.keys(iconos).length} iconos, ${nodos} nodos, ${Buffer.byteLength(fuente)} bytes (lucide-react ${version})`)
  } catch (error) {
    console.error(`FALLA: ${error.message}`)
    process.exitCode = 1
  }
}

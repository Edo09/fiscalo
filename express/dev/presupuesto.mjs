// Comprobaciones del build de Express que no dependen de Vite: el presupuesto de peso (anexo 15.4), el piso de CSS y el identificador
// de la compilación. Son funciones puras: plugins.mjs las conecta al build (`budget`, `versionJson`) y tests/presupuesto.test.ts y
// tests/css-floor.test.ts las prueban.

// --- Presupuesto de peso ------------------------------------------------------------------------------------------------

/**
 * Los límites del anexo 15.4, en bytes gzip (1 KB = 1024 bytes). `entryJs` es el límite duro del JS de arranque; pasar `entryJsObjetivo`
 * (95 KB) solo avisa. Los demás tienen un único límite. `cargaFria` es lo que baja el teléfono para pintar el login: HTML, CSS, JS de
 * arranque y fuente.
 */
export const PRESUPUESTO = Object.freeze({
  html: 2048,
  themeInit: 410,
  css: 15360,
  entryJs: 112640,
  entryJsObjetivo: 97280,
  rutaJs: 46080,
  zodJs: 25600,
  fuente: 30720,
  cargaFria: 163840,
})

/**
 * @typedef {'html' | 'themeInit' | 'css' | 'entryJs' | 'rutaJs' | 'zodJs' | 'fuente' | 'otro'} TipoArchivo
 * @typedef {{ nombre: string, tipo: TipoArchivo, gzip: number }} ArchivoMedido un archivo del build y su peso gzip en bytes; `otro` no tiene presupuesto
 */

const ETIQUETAS = {
  html: 'HTML',
  themeInit: 'theme-init.js',
  css: 'CSS',
  entryJs: 'JS de arranque',
  rutaJs: 'JS de ruta',
  zodJs: 'JS de zod',
  fuente: 'Fuente',
}
const TIPOS = new Set([...Object.keys(ETIQUETAS), 'otro'])
/** El anexo cuenta el JS de arranque (la entrada y su chunk compartido) y el CSS en total; lo demás, archivo por archivo. */
const EN_TOTAL = new Set(['css', 'entryJs'])
const CARGA_FRIA = ['html', 'css', 'entryJs', 'fuente']

/** Un peso para leer: en bytes si no llega a 1 KB (el límite de theme-init.js son 410 bytes), si no en KB con dos decimales. */
const peso = (bytes) => (bytes < 1024 ? `${Math.round(bytes)} B` : `${(bytes / 1024).toFixed(2)} KB`)
const suma = (archivos) => archivos.reduce((total, archivo) => total + archivo.gzip, 0)

/** Los nombres de unos archivos para un mensaje: hasta tres, y cuántos más. */
function nombres(archivos) {
  const lista = archivos.map((archivo) => archivo.nombre)
  return lista.length <= 3 ? lista.join(', ') : `${lista.slice(0, 3).join(', ')} y ${lista.length - 3} más`
}

/**
 * Cada cosa que se mide contra un límite: una por archivo, salvo el JS de arranque y el CSS (una por tipo, con la suma) y la carga fría.
 * @param {ArchivoMedido[]} archivos
 * @returns {{ etiqueta: string, detalle: string, gzip: number, limite: number, objetivo: number }[]}
 */
function partidasDe(archivos) {
  for (const { nombre, tipo } of archivos) {
    if (!TIPOS.has(tipo)) throw new Error(`Tipo de archivo desconocido en el presupuesto: ${tipo} (${nombre})`)
  }
  const partidas = []
  for (const tipo of Object.keys(ETIQUETAS)) {
    const delTipo = archivos.filter((archivo) => archivo.tipo === tipo)
    if (delTipo.length === 0) continue
    const limite = PRESUPUESTO[tipo]
    const base = { etiqueta: ETIQUETAS[tipo], limite, objetivo: tipo === 'entryJs' ? PRESUPUESTO.entryJsObjetivo : limite }
    if (EN_TOTAL.has(tipo)) partidas.push({ ...base, detalle: nombres(delTipo), gzip: suma(delTipo) })
    else for (const archivo of delTipo) partidas.push({ ...base, detalle: archivo.nombre, gzip: archivo.gzip })
  }
  const fria = archivos.filter((archivo) => CARGA_FRIA.includes(archivo.tipo))
  if (fria.length > 0) {
    const { cargaFria } = PRESUPUESTO
    partidas.push({ etiqueta: 'Carga en frío', detalle: 'HTML + CSS + JS de arranque + fuente', gzip: suma(fria), limite: cargaFria, objetivo: cargaFria })
  }
  return partidas
}

const estadoDe = (partida) => (partida.gzip > partida.limite ? 'exceso' : partida.gzip > partida.objetivo ? 'aviso' : 'ok')

/**
 * Compara el peso del build con PRESUPUESTO. Pasar el objetivo es un aviso; pasar el límite, un exceso (y ya no además un aviso). El
 * JS de arranque y el CSS se miden en total; el JS de ruta, el de zod y la fuente, archivo por archivo; la carga fría es la suma de
 * HTML, CSS, JS de arranque y fuente. Un tipo que no conoce es un error: ignorarlo dejaría pasar un archivo sin medir.
 * @param {ArchivoMedido[]} archivos
 * @returns {{ avisos: string[], excesos: string[] }}
 */
export function evaluarPresupuesto(archivos) {
  const avisos = []
  const excesos = []
  for (const partida of partidasDe(archivos)) {
    const estado = estadoDe(partida)
    const que = `${partida.etiqueta} (${partida.detalle}): ${peso(partida.gzip)} gzip`
    if (estado === 'exceso') excesos.push(`${que} pasa el límite de ${peso(partida.limite)}`)
    else if (estado === 'aviso') avisos.push(`${que} pasa el objetivo de ${peso(partida.objetivo)} (límite ${peso(partida.limite)})`)
  }
  return { avisos, excesos }
}

const ESTADOS = { ok: 'ok', aviso: 'AVISO', exceso: 'EXCESO' }

/**
 * La tabla que imprime el build: una fila por cosa medida, con su peso, su límite y su estado.
 * @param {ArchivoMedido[]} archivos
 * @returns {string}
 */
export function tablaPresupuesto(archivos) {
  const filas = partidasDe(archivos).map((partida) => [
    partida.etiqueta,
    partida.detalle,
    peso(partida.gzip),
    `de ${peso(partida.limite)}${partida.objetivo < partida.limite ? ` (objetivo ${peso(partida.objetivo)})` : ''}`,
    ESTADOS[estadoDe(partida)],
  ])
  const ancho = (columna) => Math.max(...filas.map((fila) => fila[columna].length))
  const [a, b, c, d] = [0, 1, 2, 3].map(ancho)
  const lineas = filas.map(([etiqueta, detalle, tamano, limite, estado]) => `  ${etiqueta.padEnd(a)}  ${detalle.padEnd(b)}  ${tamano.padStart(c)}  ${limite.padEnd(d)}  ${estado}`)
  return ['Presupuesto de bundle (gzip, 1 KB = 1024 bytes)', ...lineas].join('\n')
}

// --- Piso de CSS --------------------------------------------------------------------------------------------------------

// Lo que el piso (Chrome y WebView 90, Safari e iOS 14.5) no tiene, o tiene a medias, y que el CSS de Express no puede usar. Se mira el
// texto del CSS y, para :hover, aspect-ratio y dvh, la estructura (qué bloque lo contiene y qué @media lo envuelve): por eso se parte
// en bloques en lugar de buscar con una sola expresión.

const REGLA_HOVER = ':hover fuera de (hover:hover) and (pointer:fine)'
const PATRONES = [
  ['color-mix()', /color-mix\s*\(/gi],
  [':has()', /:has\s*\(/gi],
  ['@container', /@container(?![\w-])/gi],
]
const HOVER = /:hover(?![\w-])/i
const DVH = /\ddvh(?![\w-])/i
const VH = /\dvh(?![\w-])/i // `100dvh` no coincide: tras el dígito viene la d

/**
 * El CSS sin lo que no es CSS que se ejecuta: los comentarios y las cadenas se vacían, y el contenido de un url() sin comillas también (un
 * data: trae ; y texto cualquiera). Si no, un :hover dentro de un comentario o un 100dvh dentro de un data: darían falsos positivos.
 */
function limpiarCss(css) {
  const aVaciar = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|url\(\s*[^)\s"'][^)]*\)/gi
  return css.replace(aVaciar, (trozo) => (trozo.startsWith('/*') ? ' ' : /^url/i.test(trozo) ? 'url()' : '""'))
}

/**
 * @typedef {{ preludio: string, padre: Bloque | undefined, declaraciones: string[] }} Bloque un bloque `preludio { ... }` del CSS: su preludio
 * (selector o @-regla), el bloque que lo contiene y las declaraciones que tiene directamente
 */

/**
 * Cada bloque del CSS, hijos antes que padres. Entiende el anidado, aunque el build no lo emita.
 * @param {string} css ya limpio (limpiarCss)
 * @returns {Bloque[]}
 */
function bloquesDe(css) {
  const bloques = []
  const abiertos = []
  let inicio = 0
  const cerrarSentencia = (fin) => {
    const texto = css.slice(inicio, fin).trim()
    if (texto !== '' && abiertos.length > 0) abiertos[abiertos.length - 1].declaraciones.push(texto)
    inicio = fin + 1
  }
  for (let i = 0; i < css.length; i++) {
    const letra = css[i]
    if (letra === '{') {
      abiertos.push({ preludio: css.slice(inicio, i).trim(), padre: abiertos[abiertos.length - 1], declaraciones: [] })
      inicio = i + 1
    } else if (letra === ';') {
      cerrarSentencia(i)
    } else if (letra === '}') {
      cerrarSentencia(i)
      const bloque = abiertos.pop()
      if (bloque !== undefined) bloques.push(bloque)
    }
  }
  return bloques
}

/** Un preludio `@media` cuyas consultas piden (hover:hover) y (pointer:fine) a la vez; con una alternativa que no (la coma es un O) o con `not`, no. */
function esMediaDeHover(preludio) {
  if (!/^@media(?![\w-])/i.test(preludio)) return false
  const consultas = preludio.slice('@media'.length).toLowerCase().replace(/\s+/g, '').split(',')
  return consultas.every((consulta) => !consulta.startsWith('not') && consulta.includes('(hover:hover)') && consulta.includes('(pointer:fine)'))
}

/** Algún bloque que contiene a `bloque`, del más cercano al más lejano, es un @media de hover. */
function dentroDeMediaDeHover(bloque) {
  for (let ancestro = bloque.padre; ancestro !== undefined; ancestro = ancestro.padre) {
    if (esMediaDeHover(ancestro.preludio)) return true
  }
  return false
}

const compacto = (texto) => texto.replace(/\s+/g, ' ').trim().slice(0, 80)
const alrededor = (texto, indice) => compacto(texto.slice(Math.max(0, indice - 20), indice + 40))

/**
 * Lo que hay en `css` que el piso del navegador no soporta, una ofensa por ocurrencia con la regla que la rompe: `color-mix()`, `:has()`,
 * `@container`, la propiedad `aspect-ratio`, un `:hover` fuera de un `@media (hover:hover) and (pointer:fine)` y un `dvh` sin un `vh`
 * antes (de la misma propiedad y en el mismo bloque). Vacío si todo está dentro del piso.
 * @param {string} css
 * @returns {string[]}
 */
export function cssNoSoportado(css) {
  const limpio = limpiarCss(css)
  const ofensas = []
  for (const [regla, patron] of PATRONES) {
    for (const coincidencia of limpio.matchAll(patron)) ofensas.push(`${regla}: ${alrededor(limpio, coincidencia.index)}`)
  }
  for (const bloque of bloquesDe(limpio)) {
    const { preludio } = bloque
    if (!preludio.startsWith('@') && HOVER.test(preludio) && !dentroDeMediaDeHover(bloque)) ofensas.push(`${REGLA_HOVER}: ${compacto(preludio)}`)
    const conVh = new Set() // propiedades que ya tienen una línea con vh en este bloque
    for (const declaracion of bloque.declaraciones) {
      const dosPuntos = declaracion.indexOf(':')
      if (dosPuntos < 0) continue
      const propiedad = declaracion.slice(0, dosPuntos).trim().toLowerCase()
      const valor = declaracion.slice(dosPuntos + 1)
      if (propiedad === 'aspect-ratio') ofensas.push(`aspect-ratio: ${compacto(declaracion)}`)
      if (DVH.test(valor)) {
        if (!conVh.has(propiedad)) ofensas.push(`dvh sin vh: ${compacto(declaracion)}`)
      } else if (VH.test(valor)) {
        conVh.add(propiedad)
      }
    }
  }
  return ofensas
}

// --- Identificador de la compilación -------------------------------------------------------------------------------------

/**
 * El identificador de una compilación: `AA.MM.DD-sha`, con la fecha en UTC (la misma en el Vercel de la compilación que en la máquina
 * de quien prueba) y el sha recortado a 7. Es el valor de `BUILD_ID` en la app y el `version` de `version.json`.
 * @param {Date} fecha
 * @param {string} sha el del commit, o `local`
 * @returns {string}
 */
export function idCompilacion(fecha, sha) {
  const dos = (numero) => String(numero).padStart(2, '0')
  return `${dos(fecha.getUTCFullYear() % 100)}.${dos(fecha.getUTCMonth() + 1)}.${dos(fecha.getUTCDate())}-${sha.slice(0, 7)}`
}

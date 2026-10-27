#!/usr/bin/env node
/**
 * probar.mjs — comprobaciones del spike S0 de Express contra un proyecto Vercel
 * desechable (runbook R3, en docs/superpowers/specs/2026-10-27-express-p0-runbook.md).
 *
 * Una linea OK o FALLA por comprobacion, con el estado HTTP, los segundos y un
 * extracto del cuerpo:
 *   1. GET /                       trae <title>Express S0</title> (se construyo y se sirve el stub)
 *   2. cabecera x-express-s0       la del bloque `headers` de express/vercel.json
 *   3. GET /api/public/x           404 y NO el shell (el rewrite bloqueado a /__no_existe__)
 *   4. GET /facturas               200 con el shell (el comodin de la SPA)
 *   5. GET /sonda?paso=info        el JSON de la sonda (el rewrite externo y la cadena de consulta llegan al origen)
 *   6. POST /sonda?paso=dormir&seg=N, N = 15, 30, 45 y 60: 200 y unos N segundos. Se detiene en la primera que falla.
 *
 * Uso:
 *   node probar.mjs --base=https://<desechable>.vercel.app --token=<token de la sonda>
 *
 * El token (el de R1) solo viaja en la cabecera X-Probe-Token y nunca se imprime.
 * Salida: 0 si todo OK, 1 si alguna comprobacion fallo, 2 si el uso es incorrecto.
 * Tarda unos 150 s: las cuatro esperas del paso 6 son reales.
 */

const TITULO = '<title>Express S0</title>'
const ESPERAS_SEG = [15, 30, 45, 60]
// El origen duerme N s completos, asi que menos de N - 1 s es sospechoso; mas de N + 10 s
// ya no es "cerca de N" (red del dueno, TLS, arranque en frio).
const HOLGURA_ABAJO_SEG = 1
const HOLGURA_ARRIBA_SEG = 10
const LIMITE_GET_SEG = 30
const EXTRACTO_MAX = 90

function usoIncorrecto(mensaje) {
  console.error(`${mensaje}\nUso: node probar.mjs --base=https://<desechable>.vercel.app --token=<token de la sonda>`)
  process.exit(2)
}

function leerArgumentos(argv) {
  const valores = {}
  for (const arg of argv) {
    const m = /^--(base|token)=(.*)$/.exec(arg)
    // Solo el nombre: un argumento mal escrito puede traer el token despues del "=".
    if (!m) usoIncorrecto(`Argumento no reconocido: ${arg.split('=')[0]}`)
    valores[m[1]] = m[2]
  }
  if (!valores.base) usoIncorrecto('Falta --base.')
  if (!valores.token) usoIncorrecto('Falta --token.')
  let url
  try {
    url = new URL(valores.base)
  } catch {
    usoIncorrecto('--base no es una URL valida.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    usoIncorrecto('--base es solo el origen (esquema y dominio, sin ruta), por ejemplo https://mi-proyecto.vercel.app')
  }
  return { base: url.origin, token: valores.token }
}

const { base, token } = leerArgumentos(process.argv.slice(2))

/** Texto de una sola linea, corto y sin el token (por si algun cuerpo lo repitiera). */
function extracto(texto) {
  const limpio = String(texto).split(token).join('***').replace(/\s+/g, ' ').trim()
  return limpio.length > EXTRACTO_MAX ? `${limpio.slice(0, EXTRACTO_MAX)}...` : limpio
}

function describirError(e, limiteSeg) {
  if (e?.name === 'TimeoutError') return `sin respuesta en ${limiteSeg} s`
  return `${e?.name ?? 'Error'}: ${e?.cause?.code ?? e?.cause?.message ?? e?.message ?? 'desconocido'}`
}

/** Una peticion sin seguir redirecciones (un 3xx es un resultado, no algo que arreglar en silencio). */
async function pedir(ruta, { metodo = 'GET', conToken = false, limiteSeg = LIMITE_GET_SEG } = {}) {
  const inicio = performance.now()
  try {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: conToken ? { 'X-Probe-Token': token } : {},
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(limiteSeg * 1000),
    })
    const cuerpo = await r.text()
    return { estado: r.status, cabeceras: r.headers, cuerpo, seg: (performance.now() - inicio) / 1000, error: null }
  } catch (e) {
    return { estado: 0, cabeceras: new Headers(), cuerpo: '', seg: (performance.now() - inicio) / 1000, error: describirError(e, limiteSeg) }
  }
}

function jsonDe(cuerpo) {
  try {
    const dato = JSON.parse(cuerpo)
    return dato !== null && typeof dato === 'object' ? dato : null
  } catch {
    return null
  }
}

const esShell = (cuerpo) => cuerpo.includes(TITULO)

let fallas = 0

/** Imprime la linea de una comprobacion. `motivo` solo se usa si fallo; `detalle` reemplaza al extracto del cuerpo. */
function informar(nombre, r, motivo, detalle) {
  const ok = motivo === null
  if (!ok) fallas++
  const estado = r.error ? 'sin respuesta' : `HTTP ${r.estado}`
  const partes = [`${ok ? 'OK   ' : 'FALLA'} ${nombre}`, estado, `${r.seg.toFixed(1)} s`]
  if (!ok) partes.push(motivo)
  partes.push(r.error ?? detalle ?? extracto(r.cuerpo))
  console.log(partes.join(' | '))
  return ok
}

/** Motivo de fallo de una respuesta que debia ser el JSON de la sonda; null si lo es. */
function motivoDeSonda(r, paso) {
  if (r.error) return 'la peticion no obtuvo respuesta'
  if (r.estado === 403) return 'la sonda dijo 403: token incorrecto o sonda vencida (repite R1)'
  if (esShell(r.cuerpo)) return 'devolvio el shell: el rewrite de /sonda no salio hacia el origen'
  const json = jsonDe(r.cuerpo)
  if (json === null) return 'el cuerpo no es JSON de la sonda'
  if (typeof json.error === 'string' && json.error.includes('paso desconocido')) return 'la sonda no recibio ?paso= (la cadena de consulta no llego)'
  if (r.estado !== 200) return 'esperaba 200'
  if (json.paso !== paso) return `esperaba paso=${paso}`
  return null
}

console.log(`S0 contra ${base}`)

// 1 y 2: la pagina de entrada y la cabecera del bloque `headers`.
const raiz = await pedir('/')
informar(
  'GET /',
  raiz,
  raiz.estado !== 200 ? 'esperaba 200' : esShell(raiz.cuerpo) ? null : `no trae ${TITULO}`,
)
const cabecera = raiz.cabeceras.get('x-express-s0')
informar('cabecera x-express-s0 en /', raiz, cabecera === '1' ? null : 'falta la cabecera x-express-s0: 1', `x-express-s0: ${cabecera ?? '(ausente)'}`)

// 3: el rewrite bloqueado. Se muestran server y x-vercel-error para distinguir un 404 de Vercel de uno del origen.
const bloqueada = await pedir('/api/public/x')
informar(
  'GET /api/public/x',
  bloqueada,
  esShell(bloqueada.cuerpo)
    ? 'devolvio el shell: el rewrite bloqueado cayo al comodin'
    : bloqueada.estado === 404
      ? null
      : 'esperaba 404',
  `server: ${bloqueada.cabeceras.get('server') ?? '(ausente)'}; x-vercel-error: ${bloqueada.cabeceras.get('x-vercel-error') ?? '(ausente)'}; ${extracto(bloqueada.cuerpo)}`,
)

// 4: el comodin de la SPA.
const facturas = await pedir('/facturas')
informar(
  'GET /facturas',
  facturas,
  facturas.estado !== 200 ? 'esperaba 200' : esShell(facturas.cuerpo) ? null : `no trae el shell (${TITULO})`,
)

// 5: el rewrite externo con la cadena de consulta.
const info = await pedir('/sonda?paso=info', { conToken: true })
informar('GET /sonda?paso=info', info, motivoDeSonda(info, 'info'))

// 6: POST largo por el rewrite externo. Se detiene en la primera espera que falla.
let ultimaBuena = null
let murio = null
for (const n of ESPERAS_SEG) {
  const r = await pedir(`/sonda?paso=dormir&seg=${n}`, { metodo: 'POST', conToken: true, limiteSeg: n + LIMITE_GET_SEG })
  let motivo = motivoDeSonda(r, 'dormir')
  if (motivo === null) {
    const json = jsonDe(r.cuerpo)
    if (json.slept_seconds !== n) motivo = `esperaba slept_seconds=${n}`
    else if (json.method !== 'POST') motivo = `el origen recibio ${json.method} y no POST`
    else if (r.seg < n - HOLGURA_ABAJO_SEG || r.seg > n + HOLGURA_ARRIBA_SEG) motivo = `tardo ${r.seg.toFixed(1)} s y se esperaba cerca de ${n}`
  }
  if (!informar(`POST /sonda?paso=dormir&seg=${n}`, r, motivo)) {
    murio = n
    break
  }
  ultimaBuena = n
}

if (murio !== null) {
  const previa = ultimaBuena === null ? 'ninguna' : `${ultimaBuena} s`
  console.log(`La espera POST de ${murio} s fallo (la ultima que paso: ${previa}). No se probaron las siguientes.`)
}
console.log(fallas === 0 ? 'S0: todo OK' : `S0: ${fallas} comprobacion(es) con FALLA`)
// exitCode y no process.exit(): en Windows, salir de golpe con conexiones de fetch aun cerrandose
// hace abortar a Node (Assertion failed ... async.c) y el codigo de salida deja de ser 0 o 1.
process.exitCode = fallas === 0 ? 0 : 1

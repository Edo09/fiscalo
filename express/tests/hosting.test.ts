// Contrato de hosting de Express: express/vercel.json (reescrituras y cabeceras), la guardia del origen del API y el shell
// (index.html). Los archivos se leen desde la ubicación de esta prueba, no desde el directorio de trabajo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compararOrigenes, origenApi } from '../dev/check-api-origin.mjs'

const GUARDIA = fileURLToPath(new URL('../dev/check-api-origin.mjs', import.meta.url))
const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/
const express = JSON.parse(leer('express/vercel.json'))
const raiz = JSON.parse(leer('vercel.json'))
const html = leer('express/index.html')

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

// Vercel lee `source` como path-to-regexp. Esto lo aproxima para las dos formas que usa el archivo: `:path*` y un grupo con su propia expresión.
const coincide = (source: string, ruta: string): boolean => new RegExp(`^${source.replace(/:path\*/g, '.*')}$`).test(ruta)

test('rewrites en orden', () => {
  assert.equal(express.rewrites[0].source, '/api/public/:path*')
  assert.equal(express.rewrites[0].destination, '/__no_existe__')
  assert.equal(express.rewrites[1].source, '/api/:path*')
  assert.equal(express.rewrites[2].source, '/((?!assets/|icons/|fonts/|theme-init.js|version.json|__no_existe__).*)')
  assert.equal(express.rewrites[2].destination, '/index.html')
})

test('el comodin de la SPA no atrapa el destino bloqueado: /api/public/* da 404 y nunca el shell', () => {
  // Spike S0: tras el primer rewrite Vercel sigue probando los demás contra la ruta nueva. Si el comodín la atrapa, el bloqueo
  // responde 200 con el shell en vez de 404.
  const bloqueado = express.rewrites[0].destination
  for (const r of express.rewrites.slice(1)) assert.equal(coincide(r.source, bloqueado), false, `${r.source} atraparia ${bloqueado}`)
  // Sin esto la comprobación de arriba no probaría nada: el comodín sí atrapa las rutas de la SPA y deja pasar los archivos estáticos.
  const comodin = express.rewrites[2].source
  for (const ruta of ['/', '/facturas', '/facturas/123']) assert.equal(coincide(comodin, ruta), true, ruta)
  for (const ruta of ['/assets/index-a1b2c3.js', '/icons/mark.svg', '/fonts/inter.woff2', '/theme-init.js', '/version.json']) {
    assert.equal(coincide(comodin, ruta), false, ruta)
  }
})

test('mismo origen del API que la raiz', () => {
  assert.equal(compararOrigenes(raiz, express).ok, true)
  const mal = { rewrites: express.rewrites.map((r: any) => (r.source === '/api/:path*' ? { ...r, destination: 'https://otro.ejemplo.test/api/:path*' } : r)) }
  assert.equal(compararOrigenes(raiz, mal).ok, false)
})

/** Un vercel.json mínimo cuyo `/api/:path*` va a `destino` (los hosts de estas pruebas son inventados: el real solo está en los dos vercel.json). */
const vercelConApi = (destino: unknown) => ({
  rewrites: [
    { source: '/(.*)', destination: '/app.html' },
    { source: '/api/:path*', destination: destino },
  ],
})

test('origenApi: el origen del destino de /api/:path*', () => {
  assert.equal(origenApi(vercelConApi('https://api.ejemplo.test/api/:path*')), 'https://api.ejemplo.test')
  assert.equal(origenApi(vercelConApi('HTTPS://Api.Ejemplo.Test:443/api/:path*')), 'https://api.ejemplo.test') // mayúsculas y puerto por defecto
  assert.equal(origenApi(vercelConApi('http://localhost:8787/api/:path*')), 'http://localhost:8787')
})

test('origenApi: null cuando no hay un origen que decir', () => {
  const sinOrigen: unknown[] = [
    null,
    undefined,
    42,
    'x',
    [],
    {},
    { rewrites: 'x' },
    { rewrites: [] },
    { rewrites: [null, 3] },
    { rewrites: [{ source: '/(.*)', destination: '/app.html' }] }, // sin la reescritura de /api
    vercelConApi(undefined),
    vercelConApi(7),
    vercelConApi('/api/:path*'), // relativo: no es un origen
    vercelConApi('no es una url'),
    vercelConApi('ftp://api.ejemplo.test/api/:path*'),
    vercelConApi('file:///api/:path*'),
  ]
  for (const json of sinOrigen) assert.equal(origenApi(json), null, JSON.stringify(json))
})

test('compararOrigenes: OK si coinciden; si no, FALLA y dice cual', () => {
  const a = vercelConApi('https://a.ejemplo.test/api/:path*')
  const b = vercelConApi('https://b.ejemplo.test/api/:path*')
  const igual = compararOrigenes(a, a)
  assert.equal(igual.ok, true)
  assert.match(igual.mensaje, /^OK.*https:\/\/a\.ejemplo\.test/)
  const distinto = compararOrigenes(a, b)
  assert.equal(distinto.ok, false)
  assert.match(distinto.mensaje, /^FALLA.*https:\/\/b\.ejemplo\.test.*https:\/\/a\.ejemplo\.test/)
  const sinRaiz = compararOrigenes({}, a)
  assert.equal(sinRaiz.ok, false)
  assert.match(sinRaiz.mensaje, /^FALLA.*ra[ií]z/)
  const sinExpress = compararOrigenes(a, {})
  assert.equal(sinExpress.ok, false)
  assert.match(sinExpress.mensaje, /^FALLA.*express\/vercel\.json/)
})

/** Las cabeceras del único bloque de express/vercel.json con ese `source`, por nombre. */
const cabeceras = (source: string): Record<string, string> => {
  const bloques = express.headers.filter((b: any) => b.source === source)
  assert.equal(bloques.length, 1, `un solo bloque de cabeceras para ${source}`)
  return Object.fromEntries(bloques[0].headers.map((h: any) => [h.key, h.value]))
}

test('cabeceras', () => {
  const todo = cabeceras('/(.*)')
  assert.equal(todo['X-Content-Type-Options'], 'nosniff')
  assert.equal(todo['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.equal(todo['X-Frame-Options'], 'DENY')
  assert.equal(todo['Content-Security-Policy'], CSP)
  assert.equal(cabeceras('/assets/(.*)')['Cache-Control'], 'public, max-age=31536000, immutable')
  assert.equal(cabeceras('/')['Cache-Control'], 'no-cache')
  assert.equal(cabeceras('/index.html')['Cache-Control'], 'no-cache')
  assert.equal(cabeceras('/version.json')['Cache-Control'], 'no-store')
})

const etiquetas = (nombre: string): string[] => html.match(new RegExp(`<${nombre}\\b[^>]*>`, 'g')) ?? []
const atributo = (etiqueta: string, nombre: string): string | null => new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta)?.[1] ?? null
const meta = (nombre: string): string[] => etiquetas('meta').filter((m) => atributo(m, 'name') === nombre)

test('index.html', () => {
  assert.equal(atributo(etiquetas('html')[0], 'lang'), 'es-DO')
  assert.match(html, /<title>Fiscalpoint Express<\/title>/)

  // Sin script en línea (script-src 'self' lo bloquearía): todo <script> trae src y no tiene cuerpo.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, (html.match(/<script\b/g) ?? []).length, 'hay un <script sin cerrar')
  for (const [, atributos, cuerpo] of scripts) {
    assert.notEqual(atributo(atributos, 'src'), null, `<script${atributos}> sin src`)
    assert.equal(cuerpo.trim(), '', `<script${atributos}> con código en línea`)
  }
  // theme-init.js: script clásico (sin type, async ni defer) y antes del módulo, para aplicar el tema antes del primer pintado.
  const iTema = scripts.findIndex(([, a]) => atributo(a, 'src') === '/theme-init.js')
  const iModulo = scripts.findIndex(([, a]) => atributo(a, 'type') === 'module')
  assert.ok(iTema >= 0 && iModulo >= 0 && iTema < iModulo, 'theme-init.js debe ir antes del módulo')
  assert.doesNotMatch(scripts[iTema][1], /\s(type|async|defer)\b/)

  // El zoom del usuario no se bloquea y la app se extiende bajo las barras del sistema.
  assert.equal(meta('viewport').length, 1)
  assert.match(atributo(meta('viewport')[0], 'content') ?? '', /viewport-fit=cover/)
  assert.doesNotMatch(html, /maximum-scale/)

  assert.deepEqual(meta('color-scheme').map((m) => atributo(m, 'content')), ['light dark'])
  // El primer theme-color que aplica gana (HTML Standard) y uno sin `media` siempre aplica: si el claro no llevara media, taparía al oscuro.
  assert.deepEqual(
    meta('theme-color').map((m) => [atributo(m, 'content'), atributo(m, 'media')]),
    [
      ['#f7f8fa', '(prefers-color-scheme: light)'],
      ['#24272d', '(prefers-color-scheme: dark)'],
    ],
  )
  assert.ok(etiquetas('link').some((l) => atributo(l, 'rel') === 'apple-touch-icon' && atributo(l, 'href') === '/icons/apple-touch-icon.png'))
})

// --- La guardia como programa (`node express/dev/check-api-origin.mjs`, el primer paso del build) -------------------------

const API = (host: string): string => JSON.stringify({ rewrites: [{ source: '/api/:path*', destination: `https://${host}/api/:path*` }] })

/** Copia la guardia a `<temporal>/arbol/express/dev/` con los vercel.json que se le den (`undefined`: ese archivo no existe), como están en el repo. */
function armarArbol(t: TestContext, archivos: { raiz?: string; express?: string }): string {
  const base = mkdtempSync(join(tmpdir(), 'express-guardia-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const arbol = join(base, 'arbol')
  mkdirSync(join(arbol, 'express', 'dev'), { recursive: true })
  copyFileSync(GUARDIA, join(arbol, 'express', 'dev', 'check-api-origin.mjs'))
  if (archivos.raiz !== undefined) writeFileSync(join(arbol, 'vercel.json'), archivos.raiz)
  if (archivos.express !== undefined) writeFileSync(join(arbol, 'express', 'vercel.json'), archivos.express)
  return arbol
}

/** `node <ruta>` desde el directorio temporal: la guardia ubica los vercel.json por su propia ruta, no por el directorio de trabajo. */
const correr = (ruta: string) => spawnSync(process.execPath, [ruta], { cwd: tmpdir(), encoding: 'utf8' })
const guardiaEn = (arbol: string): string => join(arbol, 'express', 'dev', 'check-api-origin.mjs')

test('guardia (CLI): con los archivos del repo imprime OK y sale con 0', () => {
  const r = correr(GUARDIA)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^OK/)
})

test('guardia (CLI): imprime FALLA y sale con 1 si los origenes no coinciden o no se pueden leer', (t) => {
  const casos: Record<string, { raiz?: string; express?: string }> = {
    'otro origen': { raiz: API('a.ejemplo.test'), express: API('b.ejemplo.test') },
    'express sin la reescritura /api/:path*': { raiz: API('a.ejemplo.test'), express: '{"rewrites":[]}' },
    'JSON ilegible': { raiz: API('a.ejemplo.test'), express: '{' },
    'sin vercel.json en la raiz': { express: API('a.ejemplo.test') },
  }
  for (const [caso, archivos] of Object.entries(casos)) {
    const r = correr(guardiaEn(armarArbol(t, archivos)))
    assert.equal(r.status, 1, `${caso}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /^FALLA/, caso)
  }
})

test('guardia (CLI): corre tambien si la ruta pasa por un enlace', (t) => {
  // import.meta.url trae la ruta real y process.argv[1] la que se escribió: sin tenerlo en cuenta la guardia no correría
  // (ni imprimiría nada) y el build pasaría sin comprobar el origen.
  const arbol = armarArbol(t, { raiz: API('a.ejemplo.test'), express: API('a.ejemplo.test') })
  const enlace = join(dirname(arbol), 'enlace')
  symlinkSync(arbol, enlace, 'junction')
  const r = correr(guardiaEn(enlace))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^OK/)
})

test('guardia: importarla no corre el CLI', (t) => {
  // Con orígenes distintos, si el CLI corriera al importar saldría con 1 y escribiría FALLA.
  const arbol = armarArbol(t, { raiz: API('a.ejemplo.test'), express: API('b.ejemplo.test') })
  writeFileSync(join(arbol, 'importar.mjs'), "import { origenApi } from './express/dev/check-api-origin.mjs'\nconsole.log(typeof origenApi)\n")
  const r = correr(join(arbol, 'importar.mjs'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'function')
  assert.equal(r.stderr, '')
})

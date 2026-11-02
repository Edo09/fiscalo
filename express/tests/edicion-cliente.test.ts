// La cabecera X-Fiscalpoint-Edicion: Express se anuncia ante la API en CADA petición, el login, /me y el cierre de sesión incluidos, para que una
// empresa que usa la app completa Y Express reciba los límites y el bloque `entitlements` de Express solo en estas peticiones (API:
// TenantResolver::esFilaExpress). Una petición sin ella corre como la app completa, así que ningún `fetch` a la API puede olvidarla: son cinco, y
// esta prueba pasa por cada uno. Un `fetch` que graba las cabeceras de lo que se le manda; ninguna petición sale de la máquina.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

// Lo que fija `define` en express/vite.config.ts. Va ANTES de importar: CABECERAS_CLIENTE se calcula al cargar src/api/config.ts, y cada archivo de prueba
// corre en su propio proceso (la app completa, que no la define, la prueba edicion-cliente-app-completa.test.ts).
;(globalThis as unknown as { __VITE_ENV__: Record<string, unknown> }).__VITE_ENV__.VITE_EDICION_CLIENTE = 'express'
const { CABECERAS_CLIENTE, EDICION_CLIENTE } = await import('@/api/config')
const { getBlob, getJson, request } = await import('@/api/http')
const { login, logout, me } = await import('@/api/auth')
const { enviarSignoutPendiente } = await import('~/lib/sesion')

interface Vista {
  ruta: string
  cabeceras: Headers
}
const fetchReal = globalThis.fetch
let vistas: Vista[] = []

beforeEach(() => {
  vistas = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const ruta = String(url)
    vistas.push({ ruta, cabeceras: new Headers(init?.headers) })
    if (ruta.includes('/api/auth/')) {
      return new Response(JSON.stringify({ success: true, data: { token: 'tok', user: { id: 7, role: 'admin', permissions: [] } } }), { status: 200 })
    }
    if (ruta.includes('/pdf')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })
    return new Response(JSON.stringify({ status: true, data: {} }), { status: 200 })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

const NOMBRE = 'x-fiscalpoint-edicion'

test('la edición del cliente es express y sus cabeceras son exactamente una: X-Fiscalpoint-Edicion', () => {
  assert.equal(EDICION_CLIENTE, 'express')
  assert.deepEqual(CABECERAS_CLIENTE, { 'X-Fiscalpoint-Edicion': 'express' })
})

test('el login (POST /api/auth/login) la manda: sin ella el API no entrega el bloque entitlements a una empresa que usa las dos versiones', async () => {
  await login('admin_pos_a', 'clave')
  assert.equal(vistas.length, 1)
  assert.match(vistas[0]!.ruta, /\/api\/auth\/login$/)
  assert.equal(vistas[0]!.cabeceras.get(NOMBRE), 'express')
})

test('/me (GET /api/auth/me) y el cierre de sesión por http.ts/auth.ts la mandan', async () => {
  await me()
  await logout()
  assert.deepEqual(vistas.map((v) => v.ruta.replace(/^.*\/api/, '/api')), ['/api/auth/me', '/api/auth/signout'])
  for (const v of vistas) assert.equal(v.cabeceras.get(NOMBRE), 'express', v.ruta)
})

test('las lecturas y las escrituras de http.ts la mandan, y no pisan Accept', async () => {
  await getJson('/api/facturas')
  await request('/api/facturas', { method: 'POST', body: '{}' })
  assert.equal(vistas.length, 2)
  for (const v of vistas) {
    assert.equal(v.cabeceras.get(NOMBRE), 'express', v.ruta)
    assert.equal(v.cabeceras.get('accept'), 'application/json')
  }
})

test('la descarga de un PDF (getBlob) la manda', async () => {
  await getBlob('/api/facturas/12/pdf')
  assert.equal(vistas.length, 1)
  assert.equal(vistas[0]!.cabeceras.get(NOMBRE), 'express')
})

test('el cierre de sesión pendiente de Express (su propio fetch, con el token de la cola) la manda y conserva el token', async () => {
  await enviarSignoutPendiente('tok-viejo')
  assert.equal(vistas.length, 1)
  assert.match(vistas[0]!.ruta, /\/api\/auth\/signout$/)
  assert.equal(vistas[0]!.cabeceras.get(NOMBRE), 'express')
  assert.equal(vistas[0]!.cabeceras.get('authorization'), 'Bearer tok-viejo')
})

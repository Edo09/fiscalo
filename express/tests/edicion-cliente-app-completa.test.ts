// La contraparte de edicion-cliente.test.ts: la app completa NO define VITE_EDICION_CLIENTE, así que los mismos módulos compartidos (src/api/config.ts,
// http.ts y auth.ts) no mandan la cabecera X-Fiscalpoint-Edicion y la API la sirve exactamente como siempre. Es la mitad de "una empresa que usa las dos
// versiones": la cabecera es lo único que distingue a una petición de Express de una de la app completa.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { CABECERAS_CLIENTE, EDICION_CLIENTE } from '@/api/config'
import { login, me } from '@/api/auth'
import { getJson } from '@/api/http'

const fetchReal = globalThis.fetch
let cabeceras: Headers[] = []

beforeEach(() => {
  cabeceras = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    cabeceras.push(new Headers(init?.headers))
    const cuerpo = String(url).includes('/api/auth/') ? { success: true, data: { token: 'tok', user: { id: 7 } } } : { status: true, data: {} }
    return new Response(JSON.stringify(cuerpo), { status: 200 })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

test('sin VITE_EDICION_CLIENTE la edición del cliente es vacía y no hay cabeceras de cliente', () => {
  assert.equal(EDICION_CLIENTE, '')
  assert.deepEqual(CABECERAS_CLIENTE, {})
})

test('el login, /me y las lecturas de la app completa no llevan X-Fiscalpoint-Edicion', async () => {
  await login('usuario', 'clave')
  await me()
  await getJson('/api/facturas')
  assert.equal(cabeceras.length, 3)
  for (const c of cabeceras) assert.equal(c.get('x-fiscalpoint-edicion'), null)
})

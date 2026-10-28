import test from 'node:test'
import assert from 'node:assert/strict'
import { PERSONAS, MANEJADORES, parseFaultTokens, evaluarRuta, asegurarLoopback, crearServidor } from '../dev/mock-api.mjs'
const p = (n) => PERSONAS[n]
test('tokens de falla', () => {
  assert.deepEqual([...parseFaultTokens('x [drop] y rechazo')].sort(), ['drop', 'rechazo'])
  assert.deepEqual([...parseFaultTokens('e34rechazo')], ['e34rechazo'])
  assert.equal(parseFaultTokens('sin nada').size, 0)
})
test('allowlist: filas representativas de 4.3(f)', () => {
  const ev = (m, r, n) => evaluarRuta(m, r, p(n))
  assert.equal(ev('GET', '/api/facturas?page=1', 'admin.e45').permitido, true)
  assert.deepEqual([ev('DELETE', '/api/facturas/5', 'admin.e45').http, ev('DELETE', '/api/facturas/5', 'admin.e45').codigo], [403, 'EDICION_NO_INCLUYE'])
  assert.equal(ev('GET', '/api/gastos', 'admin.e45').codigo, 'EDICION_NO_INCLUYE')
  assert.deepEqual([ev('POST', '/api/ncf/rangos', 'user.e45').http, ev('POST', '/api/ncf/rangos', 'user.e45').codigo], [403, null])
  assert.equal(ev('GET', '/api/users', 'user.e45').http, 403)
  assert.equal(ev('GET', '/api/products', 'admin.sinproductos').codigo, 'EDICION_NO_INCLUYE')
  assert.equal(ev('GET', '/api/unidades-medida', 'admin.sinproductos').permitido, true)
  assert.equal(ev('GET', '/api/facturas/../gastos', 'admin.e45').codigo, 'SOLICITUD_INVALIDA')
  assert.equal(ev('GET', '/api/facturas?x=/api/gastos', 'admin.e45').http, 400)
  assert.equal(ev('GET', '/api/gastos', 'admin.completa').permitido, true)
})
test('loopback', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1']) asegurarLoopback(h)
  for (const h of ['0.0.0.0', '192.168.1.5', 'express.fiscalpoint.com.do']) assert.throws(() => asegurarLoopback(h))
})
test('servidor: login de las diez personas, me, signout y allowlist', async (t) => {
  const srv = crearServidor(); await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  // Se cierra siempre, también si una aserción falla: con el servidor abierto el proceso no termina y el CI esperaría hasta su tiempo límite.
  t.after(() => { srv.closeAllConnections(); srv.close() })
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = (ruta, cuerpo, token) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(cuerpo ?? {}) })
  for (const n of Object.keys(PERSONAS)) {
    const r = await post('/api/auth/login', { emailOrUsername: n, password: `mock-${n}` }); const j = await r.json()
    assert.equal(r.status, 200, n); assert.ok(j.data.token, n)
    assert.equal('entitlements' in j.data.user, !['admin.completa', 'admin.sinbloque'].includes(n), n)
  }
  const mal = await post('/api/auth/login', { emailOrUsername: 'admin.e45', password: 'x' })
  assert.equal(mal.status, 401); assert.equal((await mal.json()).error, 'El usuario o la contraseña no son correctos. Revísalos e inténtalo de nuevo.')
  const { data } = await (await post('/api/auth/login', { emailOrUsername: 'admin.e45@express.test', password: 'mock-admin.e45' })).json()
  const h = { Authorization: `Bearer ${data.token}` }
  assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 200)
  const gastos = await fetch(base + '/api/gastos', { headers: h }); const denegado = await gastos.json()
  assert.equal(gastos.status, 403); assert.equal(denegado.codigo, 'EDICION_NO_INCLUYE')
  // el texto del contrato 4.3(b), sin punto final y en NFC: la constante del API del plan 02 tiene que ser idéntica, byte a byte
  assert.equal(denegado.error, 'Tu plan Express no incluye esta función'); assert.equal(denegado.error, denegado.error.normalize('NFC'))
  // allowed by the allowlist but owned by no plan, so no later plan has to flip this assertion
  const xml = await fetch(base + '/api/facturas/1/xml', { headers: h }); assert.equal(xml.status, 404); assert.equal((await xml.json()).error, 'El mock todavía no implementa esta ruta.')
  // the seam writes binary answers (plan 06's PDF): push a temporary handler, read it back, remove it.
  // The route is allowlisted and unowned (/api/_bin would be denied by the allowlist before any handler runs).
  const tmp = { metodo: 'GET', patron: /^\/api\/facturas\/2\/xml$/, atender: () => ({ http: 200, binario: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), tipo: 'application/pdf' }) }
  MANEJADORES.push(tmp)
  const bin = await fetch(base + '/api/facturas/2/xml', { headers: h })
  assert.equal(bin.headers.get('content-type'), 'application/pdf'); assert.equal(Buffer.from(await bin.arrayBuffer()).toString('latin1'), '%PDF-')
  MANEJADORES.splice(MANEJADORES.indexOf(tmp), 1)
  await post('/api/auth/signout', {}, data.token)
  assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 401)
})

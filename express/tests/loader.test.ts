// Pruebas del cargador (_loader.mjs y hooks.mjs): alias, extensiones, import.meta.env y el localStorage falso
// de los que dependen todas las demás pruebas de Express.
import assert from 'node:assert/strict'
import test from 'node:test'
import { instalarStorage } from './ayudas'

test('alias @ y completado de .ts', async () => { const { fmt } = await import('@/lib/format'); assert.equal(fmt(1234.5), '1,234.50') })
test('import.meta.env sustituido', async () => { const c = await import('@/api/config'); assert.equal(c.API_BASE_URL, ''); assert.equal(c.API_KEY, '') })
test('alias ~ y relativos sin extension', async () => { assert.equal((await import('~/config')).SOPORTE_WHATSAPP, ''); assert.equal((await import('@/api/http')).qs({ a: 1 }), '?a=1') })
test('localStorage falso en los dos modos', () => {
  const s = instalarStorage('memoria'); localStorage.setItem('a', '1'); assert.equal(localStorage.getItem('a'), '1'); s.restaurar()
  const l = instalarStorage('lanza'); assert.throws(() => localStorage.getItem('a'), { name: 'SecurityError' }); l.restaurar()
})
test('cuota llena solo mientras la bandera esta puesta', () => { const g = globalThis as any; g.__CUOTA_LLENA__ = true
  try { assert.throws(() => localStorage.setItem('q', '1'), { name: 'QuotaExceededError' }); assert.equal(localStorage.getItem('q'), null) } finally { g.__CUOTA_LLENA__ = false }
  localStorage.setItem('q', '1'); assert.equal(localStorage.getItem('q'), '1') })

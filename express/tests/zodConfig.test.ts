// zodConfig: importarlo apaga la compilación de zod con `new Function` (`jitless`), que la CSP de Express no deja correr. No exporta nada: lo que hay
// que comprobar es el efecto. La prueba lo mira en la configuración global de zod, que cada archivo de prueba tiene limpia (corre en su propio proceso).
import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'

test('importar zodConfig pone jitless en la configuracion global de zod, que antes no lo tenia', async () => {
  assert.notEqual(z.config().jitless, true)
  await import('~/zodConfig')
  assert.equal(z.config().jitless, true)
})

test('con la configuracion puesta un esquema de zod sigue validando', async () => {
  await import('~/zodConfig')
  const esquema = z.object({ id: z.number().int().positive(), nombre: z.string().min(1) })
  assert.deepEqual(esquema.parse({ id: 3, nombre: 'Ana' }), { id: 3, nombre: 'Ana' })
  assert.equal(esquema.safeParse({ id: -1, nombre: '' }).success, false)
})

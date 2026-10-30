// screens/loginReglas: lo que el login decide sin tocar la pantalla (qué mensaje ve quien se equivoca, dónde se puede iniciar sesión y adónde va la app
// cuando la sesión cambia de manos). Login.tsx lo usa; aquí no hay DOM, así que se prueban las funciones puras.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '@/api/errores'
import type { Ruta } from '~/router'
import { loginPermitido, mensajeLogin, rutaTrasEvento } from '~/screens/loginReglas'

// --- loginPermitido -----------------------------------------------------------------------------------------------------------------

test('loginPermitido', () => {
  assert.equal(loginPermitido('abc.vercel.app', null), false)
  assert.equal(loginPermitido('abc.vercel.app', '1'), true)
  for (const h of ['express.fiscalpoint.com.do', 'localhost', 'vercel.app.evil.com']) assert.equal(loginPermitido(h, null), true, h)
})

test('loginPermitido: en una vista previa solo abre la bandera escrita exactamente 1', () => {
  for (const bandera of ['0', '', 'true', 'si', ' 1', '1 ', '11', 'on']) assert.equal(loginPermitido('abc.vercel.app', bandera), false, JSON.stringify(bandera))
  assert.equal(loginPermitido('abc.vercel.app', '1'), true)
})

test('loginPermitido: reconoce la vista previa con otras mayúsculas, con el punto final del dominio absoluto y con subdominios', () => {
  // `location.hostname` conserva el punto de `https://abc.vercel.app./`: sin quitarlo, ese enlace saltaría la prohibición.
  for (const h of ['ABC.Vercel.App', 'abc.vercel.app.', 'abc.vercel.app..', 'a.b.vercel.app', 'vercel.app']) assert.equal(loginPermitido(h, null), false, h)
})

test('loginPermitido: un nombre que solo se parece a *.vercel.app no es una vista previa', () => {
  for (const h of ['myvercel.app', 'vercel.app.evil.com', 'abc.vercel.app.evil.com', 'vercel-app.example.com', 'abc.vercel.application', '127.0.0.1']) {
    assert.equal(loginPermitido(h, null), true, h)
  }
})

// --- mensajeLogin -------------------------------------------------------------------------------------------------------------------

test('mensajeLogin', () => {
  assert.equal(mensajeLogin(new ApiError('x', 401)), 'Correo o contraseña incorrectos')
  assert.equal(mensajeLogin(new ApiError('x', 403)), 'Correo o contraseña incorrectos')
  assert.equal(mensajeLogin(new ApiError('Sin red', 0)), 'Sin red')
  assert.equal(mensajeLogin(new ApiError('Demasiados', 429)), 'Demasiados')
  assert.equal(mensajeLogin(new Error('x')), 'No se pudo iniciar sesión. Inténtalo de nuevo.')
})

test('mensajeLogin: el texto de un ApiError ya es apto para el usuario y pasa tal cual, sea cual sea su código', () => {
  // Las dos validaciones del API contestan 200 con success:false (el mock las copia): el ApiError lleva ese 200.
  assert.equal(mensajeLogin(new ApiError('Escribe tu contraseña.', 200)), 'Escribe tu contraseña.')
  assert.equal(mensajeLogin(new ApiError('Escribe tu correo o tu usuario.', 200)), 'Escribe tu correo o tu usuario.')
  assert.equal(mensajeLogin(new ApiError('No se pudo iniciar sesión por un problema del servidor. Inténtalo de nuevo en unos minutos.', 502)), 'No se pudo iniciar sesión por un problema del servidor. Inténtalo de nuevo en unos minutos.')
  assert.equal(mensajeLogin(new ApiError('Cuenta bloqueada', 423)), 'Cuenta bloqueada')
})

test('mensajeLogin: un ApiError sin texto, o cualquier otra cosa que lance el código, da el mensaje general y nunca el texto de un error de JavaScript', () => {
  const general = 'No se pudo iniciar sesión. Inténtalo de nuevo.'
  assert.equal(mensajeLogin(new ApiError('', 500)), general)
  assert.equal(mensajeLogin(new ApiError('   ', 0)), general)
  assert.equal(mensajeLogin(new TypeError("Cannot read properties of undefined (reading 'token')")), general)
  for (const raro of [null, undefined, 'Invalid email or password', 401, { status: 401, message: 'x' }]) assert.equal(mensajeLogin(raro), general, String(raro))
})

// --- rutaTrasEvento -----------------------------------------------------------------------------------------------------------------

test('rutaTrasEvento', () => {
  const f: Ruta = { id: 'factura', facturaId: 12 }
  assert.deepEqual(rutaTrasEvento('usuarioCambio', f), { id: 'facturas' })
  assert.equal(rutaTrasEvento('cierreExplicito', f), null)
})

test('rutaTrasEvento: otro usuario cae siempre en Facturas sin filtros, venga de la pantalla que venga; un cierre explícito nunca mueve nada', () => {
  const rutas: Ruta[] = [
    { id: 'facturas', q: 'Constructora', estado: 'pendiente', tipo: '45' },
    { id: 'factura', facturaId: 12 },
    { id: 'facturar-revisar' },
    { id: 'cliente', clienteId: 3 },
    { id: 'mas' },
    { id: 'mas-usuarios' },
  ]
  for (const actual of rutas) {
    assert.deepEqual(rutaTrasEvento('usuarioCambio', actual), { id: 'facturas' }, actual.id)
    assert.equal(rutaTrasEvento('cierreExplicito', actual), null, actual.id)
  }
})

test('rutaTrasEvento: la ruta nueva es un objeto distinto en cada llamada y la ruta de entrada no se toca', () => {
  const actual: Ruta = { id: 'facturas', q: 'x' }
  const una = rutaTrasEvento('usuarioCambio', actual)
  const otra = rutaTrasEvento('usuarioCambio', actual)
  assert.notEqual(una, otra) // quien la reciba puede cambiarla sin tocar la de otro
  assert.deepEqual(actual, { id: 'facturas', q: 'x' })
})

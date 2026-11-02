// lib/envio: el borrador y el registro de envío que sobreviven a una recarga. Lo que se fija: la clave UUID v4 sin `randomUUID`, qué registro deja cada respuesta del
// servidor, cuáles bloquean emitir otra factura, y que lo guardado se lee solo si es de este usuario, tiene la forma de un registro y el borrador tiene menos de 7 días.
import assert from 'node:assert/strict'
import test from 'node:test'
import { agregarProducto, carritoVacio } from '~/lib/carrito'
import type { Carrito } from '~/lib/carrito'
import type { Outcome } from '~/lib/clasificar'
import { escribirTexto, claveUsuario } from '~/lib/almacen'
import {
  aplicarEstado,
  aplicarOutcome,
  bloqueaEmision,
  borrarBorrador,
  borrarEnvio,
  crearEnvio,
  guardarBorrador,
  guardarEnvio,
  leerBorrador,
  leerEnvio,
  nuevaClave,
  sinPeticion,
  TTL_BORRADOR_MS,
} from '~/lib/envio'
import type { EnvioRecord } from '~/lib/envio'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const U = { tenantId: 12, userId: 5 }
const OTRO = { tenantId: 12, userId: 6 }
const AHORA = 1_800_000_000_000

const envio = (): EnvioRecord => crearEnvio({ clave: nuevaClave(), tipo: '45', total: 11800, clienteNombre: 'Min. de Obras', ahora: AHORA })
const factura = { facturaId: 41, eNcf: 'E450000000014', estado: 'ACEPTADO', total: 11800 }
const conProducto = (): Carrito => agregarProducto(carritoVacio('45'), { id: 7, nombre: 'Asesoría', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43' }).carrito

test('nuevaClave es un UUID v4 en minúsculas, distinto cada vez, y lo sigue siendo con bytes todos en 0xff', () => {
  assert.match(nuevaClave(), V4)
  assert.notEqual(nuevaClave(), nuevaClave())
  assert.match(nuevaClave({ getRandomValues: ((a: Uint8Array) => a.fill(0xff)) as Crypto['getRandomValues'] }), V4)
  assert.match(nuevaClave(undefined), V4) // sin crypto cae al azar de siempre
})

test('lo que contesta el servidor deja su registro: factura aceptada, rechazada, en proceso, sin confirmar, sin guardar y sin saber', () => {
  const r = envio()
  assert.equal(r.fase, 'enviando')
  const con = (o: Outcome): EnvioRecord | null => aplicarOutcome(r, o)
  assert.deepEqual(con({ kind: 'aceptada', ...factura }), { ...r, fase: 'terminada', facturaId: 41, eNcf: 'E450000000014', estado: 'ACEPTADO', total: 11800 })
  const rechazada = con({ kind: 'rechazada', ...factura, estado: 'RECHAZADO', motivos: ['Un motivo'] })
  assert.deepEqual([rechazada?.fase, rechazada?.motivos], ['terminada', ['Un motivo']])
  assert.equal(con({ kind: 'enProceso', ...factura, estado: 'ENVIADO' })?.fase, 'enProceso')
  assert.equal(con({ kind: 'guardadaIncierta', ...factura, estado: 'ENVIO_INCIERTO' })?.fase, 'incierta')
  assert.equal(con({ kind: 'noEncontrada', ...factura, estado: 'NO_ENCONTRADO' })?.fase, 'terminada')
  assert.deepEqual(con({ kind: 'noGuardada', mensaje: 'No se guardó.' }), { ...r, fase: 'noGuardada', mensaje: 'No se guardó.' })
  assert.equal(con({ kind: 'desconocido' })?.fase, 'comprobando')
  assert.equal(con({ kind: 'enCurso' })?.fase, 'comprobando')
  assert.equal(con({ kind: 'bloqueada', codigo: 'CLAVE_REUTILIZADA', mensaje: 'x' })?.fase, 'comprobando')
  assert.equal(con({ kind: 'bloqueada', codigo: 'TIPO_NO_HABILITADO', mensaje: 'x' }), null) // no se guardó nada: no queda registro
  assert.equal(con({ kind: 'validacion', mensaje: 'x' }), null)
  assert.equal(con({ kind: 'aceptada', ...factura, total: null })?.total, 11800) // sin total del servidor se queda el de la pantalla
  assert.equal(con({ kind: 'aceptada', ...factura, eNcf: null })?.eNcf, undefined)
})

test('solo lo sin confirmar y lo que no se sabe bloquea emitir otra; un envío que quedó en vuelo tras una recarga es "no se sabe"', () => {
  const r = envio()
  const fase = (f: EnvioRecord['fase']): EnvioRecord => ({ ...r, fase: f })
  assert.deepEqual((['enviando', 'terminada', 'enProceso', 'incierta', 'noGuardada', 'comprobando'] as const).map((f) => bloqueaEmision(fase(f))), [false, false, false, true, false, true])
  assert.equal(bloqueaEmision(null), false)
  assert.equal(sinPeticion(r).fase, 'comprobando')
  assert.equal(sinPeticion(fase('terminada')).fase, 'terminada')
})

test('verificar el estado vuelve a clasificar con la misma tabla de la emisión', () => {
  const r = { ...envio(), fase: 'incierta' as const }
  assert.equal(aplicarEstado(r, 'ACEPTADO', 'E450000000014').fase, 'terminada')
  assert.equal(aplicarEstado(r, 'ACEPTADO', 'E450000000014').eNcf, 'E450000000014')
  assert.equal(aplicarEstado(r, 'ENVIADO').fase, 'enProceso')
  assert.equal(aplicarEstado(r, 'ENVIO_INCIERTO').fase, 'incierta')
  assert.equal(aplicarEstado(r, 'RECHAZADO').fase, 'terminada')
})

test('el registro se guarda por usuario, se lee tal cual y lo corrupto se lee como que no hay', () => {
  const r = { ...envio(), fase: 'incierta' as const, facturaId: 41, eNcf: 'E450000000014', estado: 'ENVIO_INCIERTO' }
  guardarEnvio(U, r)
  assert.deepEqual(leerEnvio(U), r)
  assert.equal(leerEnvio(OTRO), null)
  escribirTexto(claveUsuario(U.tenantId, U.userId, 'envio'), '{no es json')
  assert.equal(leerEnvio(U), null)
  escribirTexto(claveUsuario(U.tenantId, U.userId, 'envio'), JSON.stringify({ clave: 'x', fase: 'inventada', creadoEn: 1, tipo: '45', total: 1 }))
  assert.equal(leerEnvio(U), null)
  guardarEnvio(U, r)
  borrarEnvio(U)
  assert.equal(leerEnvio(U), null)
})

test('el borrador se guarda y se lee, no se guarda vacío, es de cada usuario y a los 7 días se descarta', () => {
  guardarBorrador(U, conProducto(), AHORA, 1)
  assert.deepEqual(leerBorrador(U, AHORA + 1000), { carrito: conProducto(), ultimoTipoItem: 1 })
  assert.equal(leerBorrador(OTRO, AHORA), null)
  assert.notEqual(leerBorrador(U, AHORA + TTL_BORRADOR_MS), null) // justo a los 7 días todavía vale
  assert.equal(leerBorrador(U, AHORA + TTL_BORRADOR_MS + 1), null)
  assert.equal(leerBorrador(U, AHORA), null) // y se borró al descartarlo
  guardarBorrador(U, conProducto(), AHORA)
  guardarBorrador(U, carritoVacio('45'), AHORA) // un carrito vacío borra el borrador
  assert.equal(leerBorrador(U, AHORA), null)
  guardarBorrador(U, conProducto(), AHORA)
  borrarBorrador(U)
  assert.equal(leerBorrador(U, AHORA), null)
  escribirTexto(claveUsuario(U.tenantId, U.userId, 'borrador'), JSON.stringify({ guardadoEn: AHORA, carrito: { tipo: 5 } }))
  assert.equal(leerBorrador(U, AHORA), null)
})

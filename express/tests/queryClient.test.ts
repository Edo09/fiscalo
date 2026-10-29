// queryClient: los valores por defecto de la caché de datos y su vínculo con la sesión. Lo que se ve en pantalla sobrevive a un null inesperado
// (la hoja de sesión se abre encima de la pantalla con sus datos) y se vacía solo cuando los datos dejan de ser de quien mira: cierre
// explícito de sesión u otro usuario. Los eventos salen del seguimiento de sesión de verdad, sobre el store real y un `me` falso.
//
// Cada consulta que entra a la caché programa su recolección a los 30 minutos (`gcTime`): una prueba que siembra datos los vacía al
// terminar, o ese temporizador mantendría vivo el proceso de Node media hora.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import type { QueryClient } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import { clearSession, setSession, useAuthStore } from '@/stores/auth'
import type { UsuarioExpress } from '~/entitlements'
import { _reiniciarParaPruebas, borrarSesion, iniciarSesionTracking, marcarCierreExplicito } from '~/lib/sesion'
import { crearQueryClient, queryClient, vincularLimpieza } from '~/queryClient'
import { esperar } from './ayudas'

const U1: UsuarioExpress = {
  id: 5,
  email: 'ana@express.test',
  username: 'ana',
  name: 'Ana',
  role: 'admin',
  entitlements: {
    edicion: 'express',
    tenant: { id: 12, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' },
    modulos: ['facturacion'],
    tipos_ecf: ['31'],
    capacidades: { idempotencia: true, reconciliador: false, certificado: true },
  },
}

const reloj = { t: 0 }
let expiradas = 0
let detener: () => void = () => {}
let desvincular: () => void = () => {}
let cliente: QueryClient = crearQueryClient()

/** La clave de una lista que está en pantalla. */
const LISTA = ['facturas', 'lista', { estado: 'todas' }] as const

beforeEach(() => {
  _reiniciarParaPruebas()
  useAuthStore.setState({ token: null, user: null })
  reloj.t = 0
  expiradas = 0
  detener = iniciarSesionTracking({
    onExpirada: () => void expiradas++,
    me: async () => U1,
    ahora: () => reloj.t,
  })
  cliente = crearQueryClient()
  desvincular = vincularLimpieza(cliente)
})

afterEach(() => {
  desvincular()
  detener()
  cliente.clear() // ver la nota de arriba
})

test('los valores por defecto: un reintento, sin refresco al volver a la ventana, frescura NORMAL, 30 min en caché, mutaciones sin reintento', () => {
  const por = crearQueryClient().getDefaultOptions()
  assert.equal(por.queries?.retry, 1)
  assert.equal(por.queries?.refetchOnWindowFocus, false)
  assert.equal(por.queries?.staleTime, FRESCURA.NORMAL)
  assert.equal(por.queries?.gcTime, 1_800_000)
  assert.equal(por.mutations?.retry, 0)
})

test('queryClient es un cliente con esos mismos valores, y cada crearQueryClient da uno nuevo', () => {
  assert.deepEqual(queryClient.getDefaultOptions(), crearQueryClient().getDefaultOptions())
  assert.notEqual(crearQueryClient(), crearQueryClient())
  assert.notEqual(queryClient, crearQueryClient())
})

test('una caché sembrada sobrevive a un null inesperado, incluso al que abre la hoja de sesión', async () => {
  cliente.setQueryData(LISTA, { filas: [1, 2, 3] })
  setSession('t1', U1)
  clearSession() // un 401 transitorio: se reintenta me()
  await esperar()
  assert.deepEqual(cliente.getQueryData(LISTA), { filas: [1, 2, 3] })
  reloj.t = 5_000
  clearSession() // el segundo en 30 s: se abre la hoja de sesión sobre la pantalla
  await esperar()
  assert.equal(expiradas, 1)
  assert.deepEqual(cliente.getQueryData(LISTA), { filas: [1, 2, 3] })
})

test('el mismo usuario que vuelve a entrar con la sesión vencida conserva la caché', async () => {
  cliente.setQueryData(LISTA, { filas: [1] })
  setSession('t1', U1)
  clearSession()
  await esperar()
  reloj.t = 5_000
  clearSession()
  setSession('t2', U1) // desde la hoja de sesión
  assert.deepEqual(cliente.getQueryData(LISTA), { filas: [1] })
})

test('cierreExplicito vacía la caché', () => {
  cliente.setQueryData(LISTA, { filas: [1, 2, 3] })
  cliente.setQueryData(['clients', 1], { nombre: 'X' })
  setSession('t1', U1)
  marcarCierreExplicito()
  borrarSesion()
  assert.equal(cliente.getQueryData(LISTA), undefined)
  assert.equal(cliente.getQueryData(['clients', 1]), undefined)
  assert.equal(cliente.getQueryCache().getAll().length, 0)
})

test('usuarioCambio (otro id o otra empresa) vacía la caché; el mismo usuario con otro token, no', () => {
  setSession('t1', U1)
  cliente.setQueryData(LISTA, { filas: [1] })
  setSession('t1b', U1)
  assert.deepEqual(cliente.getQueryData(LISTA), { filas: [1] })

  setSession('t2', { ...U1, id: 99 })
  assert.equal(cliente.getQueryData(LISTA), undefined)

  cliente.setQueryData(LISTA, { filas: [2] })
  const deOtraEmpresa: UsuarioExpress = { ...U1, id: 99, entitlements: { ...(U1.entitlements as object), tenant: { id: 77, nombre: 'Y', rnc: '1', ambiente: 'ecf' } } }
  setSession('t3', deOtraEmpresa)
  assert.equal(cliente.getQueryData(LISTA), undefined)
})

test('vincularLimpieza devuelve la función que deja de limpiar', () => {
  cliente.setQueryData(LISTA, { filas: [1] })
  desvincular()
  setSession('t1', U1)
  marcarCierreExplicito()
  borrarSesion()
  assert.deepEqual(cliente.getQueryData(LISTA), { filas: [1] })
})

test('vincularLimpieza vacía el cliente que se le pasa y solo ese', () => {
  const otro = crearQueryClient()
  try {
    otro.setQueryData(LISTA, { filas: ['otro'] })
    cliente.setQueryData(LISTA, { filas: ['mio'] })
    setSession('t1', U1)
    marcarCierreExplicito()
    borrarSesion()
    assert.equal(cliente.getQueryData(LISTA), undefined)
    assert.deepEqual(otro.getQueryData(LISTA), { filas: ['otro'] })
  } finally {
    otro.clear()
  }
})

// lib/sesion: el seguimiento de la sesión (snapshot, un reintento de me() ante un 401 transitorio, cierre explícito contra null inesperado), la
// cola de cierres de sesión que no llegaron al servidor y el cierre de sesión de Express. Corre con el store de sesión de verdad (zustand, bajo
// el localStorage falso del cargador) y un `me` falso inyectado: aquí no hay red. Cada prueba arranca con el módulo y el store limpios.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApiError } from '@/api/errores'
import { clearSession, getToken, setSession, useAuthStore } from '@/stores/auth'
import type { UsuarioExpress } from '~/entitlements'
import { borrar, claveUsuario, escribirJson, leerJson } from '~/lib/almacen'
import {
  CLAVES_PURGA_AL_SALIR,
  _reiniciarParaPruebas,
  borrarSesion,
  cerrarSesionExpress,
  encolarSignout,
  enviarSignoutPendiente,
  escucharSesion,
  guardarSesion,
  iniciarSesionTracking,
  marcarCierreExplicito,
  marcarExpirada,
  puedeReintentarMe,
  refrescarMe,
  reinstalarSnapshot,
  snapshot,
  useSesionExpirada,
  vaciarSignout,
} from '~/lib/sesion'
import { esperar } from './ayudas'

// --- Datos --------------------------------------------------------------------------------------------------------------------------

/** El bloque `entitlements` de 4.3(a) de una cuenta de la empresa `tenantId`: lo único que la sesión lee de él es el id de la empresa. */
const entitlementsDe = (tenantId: number): Record<string, unknown> => ({
  edicion: 'express',
  tenant: { id: tenantId, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' },
  modulos: ['facturacion', 'clientes', 'productos'],
  tipos_ecf: ['31', '45'],
  capacidades: { idempotencia: true, reconciliador: false, certificado: true },
})
const BASE = { id: 5, email: 'ana@express.test', username: 'ana', name: 'Ana', role: 'admin' }
const U1: UsuarioExpress = { ...BASE, entitlements: entitlementsDe(12) }
const conTenant = (u: UsuarioExpress, tenantId: number): UsuarioExpress => ({ ...u, entitlements: entitlementsDe(tenantId) })

/** La clave de la cola de cierres de sesión pendientes (contracts 4.4). */
const COLA = 'fx:v1:pendingSignout'
const DIA = 24 * 3_600_000

// --- El arnés -----------------------------------------------------------------------------------------------------------------------

/** El reloj del seguimiento: lo mueve cada prueba. */
const reloj = { t: 0 }
let llamadasMe = 0
/** El token que había en el store en el instante en que se llamó a me(): el `me` real lo lee de ahí para armar el Authorization. */
let tokensEnMe: (string | null)[] = []
let expiradas = 0
let eventos: string[] = []
let respuestaMe: () => Promise<UsuarioExpress> = async () => U1
let detener: () => void = () => {}
let dejarDeEscuchar: () => void = () => {}

const me = (): Promise<UsuarioExpress> => {
  llamadasMe++
  tokensEnMe.push(getToken())
  return respuestaMe()
}

/** (Re)inicia el seguimiento con el reloj y el `me` falsos. `onExpirada` cuenta los avisos salvo que se pase otro. */
function iniciar(onExpirada: () => void = () => void expiradas++): void {
  detener()
  detener = iniciarSesionTracking({ onExpirada, me, ahora: () => reloj.t })
}

/** Deja la sesión vencida: un null inesperado que se reintenta bien y un segundo dentro de los 30 s. Sin token y con el snapshot en su sitio. */
async function dejarVencida(): Promise<void> {
  reloj.t = 0
  setSession('t1', U1)
  clearSession()
  await esperar()
  reloj.t = 5_000
  clearSession()
  await esperar()
}

/** Un componente que pinta lo que dice el gancho. Sin DOM se renderiza a texto: en servidor el gancho da el mismo valor. */
function Sonda() {
  return createElement('i', null, String(useSesionExpirada()))
}
const leerGancho = (): string => renderToStaticMarkup(createElement(Sonda))

beforeEach(() => {
  const g = globalThis as any
  g.__CUOTA_LLENA__ = false
  _reiniciarParaPruebas()
  useAuthStore.setState({ token: null, user: null }) // sesión vacía; el seguimiento anterior ya está detenido y no se entera
  borrar(COLA)
  reloj.t = 0
  llamadasMe = 0
  tokensEnMe = []
  expiradas = 0
  eventos = []
  respuestaMe = async () => U1
  iniciar()
  dejarDeEscuchar = escucharSesion((e) => {
    eventos.push(e)
  })
})

afterEach(() => {
  dejarDeEscuchar()
  detener()
})

// --- Snapshot -----------------------------------------------------------------------------------------------------------------------

test('1 snapshot sigue a setSession', () => {
  assert.equal(snapshot(), null)
  setSession('t1', U1)
  assert.equal(snapshot()?.token, 't1')
  assert.deepEqual(snapshot(), { token: 't1', user: U1 })
  setSession('t1b', { ...U1, name: 'Ana M.' }) // se renueva el token y el usuario
  assert.deepEqual(snapshot(), { token: 't1b', user: { ...U1, name: 'Ana M.' } })
})

test('1b el seguimiento toma la sesión que ya había al arrancar: la hidratación del store va antes que él', () => {
  detener()
  useAuthStore.setState({ token: 'guardado', user: U1 }) // lo que dejó el localStorage; todavía nadie escuchaba
  iniciar()
  assert.deepEqual(snapshot(), { token: 'guardado', user: U1 })
  clearSession() // el primer 401 tras abrir la app ya tiene a quién reinstalar
  assert.equal(getToken(), 'guardado')
  assert.equal(llamadasMe, 1)
})

test('reinstalarSnapshot: sin snapshot, con un token puesto o tras un cierre explícito no hace nada', () => {
  assert.equal(reinstalarSnapshot(), false) // nada que reinstalar
  setSession('t1', U1)
  assert.equal(reinstalarSnapshot(), false) // ya hay token: no se pisa con uno viejo
  marcarCierreExplicito()
  clearSession()
  assert.equal(reinstalarSnapshot(), false) // el cierre explícito soltó el snapshot
  assert.equal(getToken(), null)
})

test('reinstalarSnapshot devuelve al store la sesión retenida cuando no hay token', async () => {
  await dejarVencida() // sin token y con el snapshot de t1
  assert.equal(getToken(), null)
  assert.equal(reinstalarSnapshot(), true)
  assert.deepEqual([getToken(), useAuthStore.getState().user], ['t1', U1])
})

// --- 401 transitorio y vencimiento --------------------------------------------------------------------------------------------------

test('2 401 transitorio: reinstala el token y llama me() una vez sin avisar', async () => {
  // Review Focus 3
  setSession('t1', U1)
  clearSession()
  assert.equal(getToken(), 't1', 'la pantalla no llega a ver la sesión vacía: el token vuelve en el mismo turno')
  await esperar()
  assert.equal(getToken(), 't1')
  assert.equal(llamadasMe, 1)
  assert.equal(expiradas, 0)
  assert.deepEqual(eventos, [])
  assert.deepEqual(tokensEnMe, ['t1'], 'me() sale con el token ya reinstalado: sin él iría sin Authorization y daría 401 siempre')
  assert.deepEqual(useAuthStore.getState().user, U1)
  assert.deepEqual(snapshot(), { token: 't1', user: U1 })
})

test('2b otro 401 del mismo incidente mientras el me() va en vuelo no abre la hoja: lo decide ese me()', async () => {
  // Una caída de la base de datos hace fallar a la vez todas las peticiones en vuelo (la lista, las estadísticas, los avisos).
  let responder!: (u: UsuarioExpress) => void
  respuestaMe = () => new Promise<UsuarioExpress>((resolve) => void (responder = resolve))
  setSession('t1', U1)
  clearSession()
  assert.equal(llamadasMe, 1)
  clearSession()
  clearSession()
  assert.deepEqual([getToken(), llamadasMe, expiradas], ['t1', 1, 0])
  responder(U1)
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], ['t1', 1, 0])
  assert.deepEqual(eventos, [])
})

test('2c ...y si ese me() da 401, la hoja se abre una sola vez', async () => {
  let rechazar!: (e: unknown) => void
  respuestaMe = () => new Promise<UsuarioExpress>((_, reject) => void (rechazar = reject))
  setSession('t1', U1)
  clearSession()
  clearSession()
  rechazar(new ApiError('Tu sesión venció', 401))
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], [null, 1, 1])
})

test('2d cerrar sesión mientras el me() va en vuelo gana: su respuesta tardía ni revive la sesión ni avisa', async () => {
  let rechazar!: (e: unknown) => void
  respuestaMe = () => new Promise<UsuarioExpress>((_, reject) => void (rechazar = reject))
  setSession('t1', U1)
  clearSession() // reintento en vuelo
  marcarCierreExplicito()
  borrarSesion()
  assert.deepEqual(eventos, ['cierreExplicito'])
  rechazar(new ApiError('Tu sesión venció', 401))
  await esperar()
  assert.deepEqual([getToken(), snapshot(), expiradas], [null, null, 0])
})

test('2e si el me() vencido borra el token cuando el usuario ya había pedido salir, ese borrado es su cierre y no abre la hoja', async () => {
  let rechazar!: (e: unknown) => void
  respuestaMe = () => new Promise<UsuarioExpress>((_, reject) => void (rechazar = reject))
  setSession('t1', U1)
  clearSession() // reintento en vuelo
  marcarCierreExplicito() // cerrarSesionExpress espera al servidor y todavía no ha borrado
  rechazar(new ApiError('Tu sesión venció', 401))
  await esperar()
  assert.deepEqual([getToken(), snapshot(), expiradas, eventos], [null, null, 0, ['cierreExplicito']])
  borrarSesion() // el borrado de cerrarSesionExpress, que llega después: ya no queda nada que cerrar
  assert.deepEqual([expiradas, eventos], [0, ['cierreExplicito']])
})

test('2f si entra otra sesión mientras va el me(), el 401 tardío del viejo ni la cierra ni avisa', async () => {
  let rechazar!: (e: unknown) => void
  respuestaMe = () => new Promise<UsuarioExpress>((_, reject) => void (rechazar = reject))
  setSession('t1', U1)
  clearSession() // reintento en vuelo
  guardarSesion('t2', { ...U1, id: 99 }) // entró otro usuario por la hoja de sesión
  rechazar(new ApiError('Tu sesión venció', 401))
  await esperar()
  assert.deepEqual([getToken(), expiradas, eventos], ['t2', 0, ['usuarioCambio']])
})

test('3 segundo null en 30 s: avisa sin me()', async () => {
  reloj.t = 0
  setSession('t1', U1)
  clearSession()
  await esperar()
  reloj.t = 5_000
  clearSession()
  await esperar()
  assert.deepEqual([llamadasMe, expiradas], [1, 1])
  reloj.t = 36_000
  assert.equal(puedeReintentarMe(reloj.t), true)
  assert.equal(getToken(), null, 'al avisar no se reinstala nada: la hoja de sesión pide entrar otra vez')
  assert.equal(snapshot()?.token, 't1', 'y el snapshot se queda, para saber de quién era la sesión')
})

test('3b puedeReintentarMe: libre al principio, cerrado 30 s desde el último reintento y abierto justo a los 30 s', async () => {
  assert.equal(puedeReintentarMe(0), true)
  reloj.t = 1_000
  setSession('t1', U1)
  clearSession()
  await esperar() // reintento en t = 1000
  assert.equal(puedeReintentarMe(1_000), false)
  assert.equal(puedeReintentarMe(30_999), false)
  assert.equal(puedeReintentarMe(31_000), true)
  reloj.t = 30_999
  assert.equal(puedeReintentarMe(), false, 'sin argumento mide con el reloj del seguimiento')
  reloj.t = 31_000
  assert.equal(puedeReintentarMe(), true)
})

test('3c pasados los 30 s un null inesperado vuelve a reintentar', async () => {
  setSession('t1', U1)
  clearSession()
  await esperar()
  reloj.t = 31_000
  clearSession()
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], ['t1', 2, 0])
})

test('4 me() con ApiError 401: limpia y avisa una vez', async () => {
  respuestaMe = async () => {
    throw new ApiError('Tu sesión venció', 401)
  }
  setSession('t1', U1)
  clearSession()
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], [null, 1, 1])
  assert.equal(snapshot()?.token, 't1', 'el snapshot se queda: la hoja de sesión necesita saber de quién era')
  assert.deepEqual(eventos, [], 'no es un cierre explícito: nada se purga ni se limpia')
})

test('4b el 401 del handler de http.ts y la suscripción al store coinciden: onExpirada suena una sola vez', async () => {
  // Un me() que pasara por http.ts cerraría la sesión él mismo antes de lanzar.
  respuestaMe = async () => {
    clearSession()
    throw new ApiError('Tu sesión venció', 401)
  }
  setSession('t1', U1)
  clearSession()
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], [null, 1, 1])
})

test('4c onExpirada vuelve a poder avisar cuando reaparece un token', async () => {
  respuestaMe = async () => {
    throw new ApiError('Tu sesión venció', 401)
  }
  setSession('t1', U1)
  clearSession()
  await esperar()
  assert.equal(expiradas, 1)
  clearSession() // otra petición con el 401 de siempre: ya no hay token, no es otro vencimiento
  assert.equal(expiradas, 1)
  setSession('t2', U1) // entra otra vez
  reloj.t = 10_000
  clearSession() // dentro de los 30 s del reintento: avisa sin me()
  assert.deepEqual([getToken(), llamadasMe, expiradas], [null, 1, 2])
})

test('4d con la sesión ya vencida, un 401 rezagado no reinstala nada ni reintenta, aunque ya hayan pasado los 30 s', async () => {
  await dejarVencida()
  reloj.t = 40_000
  clearSession() // la respuesta tardía de otra petición que salió con el token de antes
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], [null, 1, 1])
})

for (const [nombre, error] of [
  ['ApiError status 0 (sin red)', new ApiError('Sin conexión', 0)],
  ['ApiError status 500', new ApiError('Error del servidor', 500)],
  ['ApiError status 403', new ApiError('No permitido', 403)],
  ['un error que no es ApiError', new TypeError('boom')],
] as const) {
  test(`5 me() con ${nombre}: conserva el token y no avisa`, async () => {
    respuestaMe = async () => {
      throw error
    }
    setSession('t1', U1)
    clearSession()
    await esperar()
    assert.deepEqual([getToken(), llamadasMe, expiradas, eventos], ['t1', 1, 0, []])
    assert.deepEqual(snapshot(), { token: 't1', user: U1 })
  })
}

// --- Cierre explícito y cambio de usuario -------------------------------------------------------------------------------------------

test('6 cierre explicito', async () => {
  setSession('t1', U1)
  marcarCierreExplicito()
  clearSession()
  await esperar()
  assert.deepEqual(eventos, ['cierreExplicito'])
  assert.equal(llamadasMe, 0)
  assert.equal(expiradas, 0)
  assert.equal(snapshot(), null) // sin snapshot App muestra Login y no la hoja de sesión
})

test('6b el cierre explícito se consume: el siguiente null inesperado ya es un 401 transitorio', async () => {
  setSession('t1', U1)
  marcarCierreExplicito()
  clearSession()
  setSession('t2', U1)
  clearSession()
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas, eventos], ['t2', 1, 0, ['cierreExplicito']])
})

test('6c cerrar con la sesión ya vencida (sin token) también suelta el snapshot y apaga la hoja', async () => {
  detener()
  detener = iniciarSesionTracking({ onExpirada: marcarExpirada, me, ahora: () => reloj.t })
  await dejarVencida()
  assert.equal(leerGancho(), '<i>true</i>')
  marcarCierreExplicito()
  borrarSesion() // el store ya estaba sin token: no hay una transición que esperar
  assert.deepEqual(eventos, ['cierreExplicito'])
  assert.deepEqual([snapshot(), leerGancho()], [null, '<i>false</i>'])
})

test('7 usuarioCambio por otro user.id o tenant, no por refresco del mismo usuario', () => {
  setSession('t1', U1)
  setSession('t1b', U1)
  assert.deepEqual(eventos, []) // mismo usuario, token nuevo
  setSession('t2', { ...U1, id: 99 })
  assert.deepEqual(eventos, ['usuarioCambio']) // otro usuario
  setSession('t3', conTenant(U1, 77))
  assert.deepEqual(eventos, ['usuarioCambio', 'usuarioCambio']) // otro tenant
})

test('7b el mismo usuario con datos nuevos (permisos, nombre) no es otro usuario; la empresa o el id sí lo cambian', () => {
  const vistos: (number | undefined)[] = []
  escucharSesion(() => void vistos.push(snapshot()?.user.id)) // el oyente ve ya el snapshot del usuario nuevo
  setSession('t1', U1)
  setSession('t1', { ...U1, name: 'Ana M.', permissions: ['facturas'] })
  setSession('t1', U1)
  assert.deepEqual(eventos, [])
  setSession('t2', conTenant(U1, 13)) // mismo id, otra empresa
  assert.deepEqual(eventos, ['usuarioCambio'])
  setSession('t3', { ...conTenant(U1, 13), id: 6 }) // misma empresa, otro id
  assert.deepEqual(eventos, ['usuarioCambio', 'usuarioCambio'])
  assert.deepEqual(vistos, [5, 6])
})

test('7c tras un cierre explícito no hay a quién compararse: entrar con otro usuario no emite usuarioCambio', () => {
  setSession('t1', U1)
  marcarCierreExplicito()
  clearSession()
  setSession('t2', { ...U1, id: 99 })
  assert.deepEqual(eventos, ['cierreExplicito'])
})

test('7d con la sesión vencida se compara con el snapshot retenido: el mismo usuario no cambia nada, otro sí', async () => {
  await dejarVencida()
  guardarSesion('t2', U1) // entra el mismo desde la hoja de sesión
  assert.deepEqual(eventos, [])
  reloj.t = 6_000
  clearSession() // dentro de los 30 s: vuelve a vencer
  guardarSesion('t3', { ...U1, id: 99 }) // entra otro usuario
  assert.deepEqual(eventos, ['usuarioCambio'])
})

// --- Cola de cierres de sesión pendientes -------------------------------------------------------------------------------------------

/** Un envío falso que apunta los tokens que recibe y lanza con los de `fallan`. */
function remitente(enviados: string[], fallan: readonly string[] = []): (token: string) => Promise<void> {
  return async (token) => {
    enviados.push(token)
    if (fallan.includes(token)) throw new Error('sin red')
  }
}

test('8 cola de signout', async () => {
  const t0 = 1_000_000
  encolarSignout('tok', t0)
  assert.notEqual(localStorage.getItem(COLA), null, 'queda en la clave fx:v1:pendingSignout')
  const enviados: string[] = []
  reloj.t = t0 + 1_000
  await vaciarSignout(remitente(enviados))
  assert.deepEqual(enviados, ['tok'])
  assert.equal(localStorage.getItem(COLA), null, 'enviado, la clave se borra')
})

test('8b pasadas las 24 h se descarta sin enviar; a las 24 h justas todavía se envía', async () => {
  const t0 = 1_000_000
  const enviados: string[] = []
  encolarSignout('viejo', t0)
  reloj.t = t0 + DIA + 1
  await vaciarSignout(remitente(enviados))
  assert.deepEqual(enviados, [])
  assert.equal(localStorage.getItem(COLA), null, 'y se borra: un token vencido no se guarda más')
  encolarSignout('justo', t0)
  reloj.t = t0 + DIA
  await vaciarSignout(remitente(enviados))
  assert.deepEqual(enviados, ['justo'])
})

test('8c un envío que lanza conserva la entrada, y vaciarSignout no lanza', async () => {
  const t0 = 1_000_000
  const enviados: string[] = []
  encolarSignout('tok', t0)
  reloj.t = t0 + 1_000
  await assert.doesNotReject(vaciarSignout(remitente(enviados, ['tok'])))
  assert.deepEqual(enviados, ['tok'])
  assert.notEqual(localStorage.getItem(COLA), null)
  await vaciarSignout(remitente(enviados)) // la próxima vez (volvió la red) sale
  assert.deepEqual(enviados, ['tok', 'tok'])
  assert.equal(localStorage.getItem(COLA), null)
})

test('8d con varias entradas, la que falla no frena a las demás y es la única que queda', async () => {
  const enviados: string[] = []
  for (const token of ['a', 'b', 'c']) encolarSignout(token, 1_000)
  reloj.t = 2_000
  await vaciarSignout(remitente(enviados, ['b']))
  assert.deepEqual(enviados, ['a', 'b', 'c'])
  const despues: string[] = []
  await vaciarSignout(remitente(despues))
  assert.deepEqual(despues, ['b'])
  assert.equal(localStorage.getItem(COLA), null)
})

test('8e encolar el mismo token dos veces no lo duplica', async () => {
  encolarSignout('tok', 1_000)
  encolarSignout('tok', 2_000)
  const enviados: string[] = []
  reloj.t = 3_000
  await vaciarSignout(remitente(enviados))
  assert.deepEqual(enviados, ['tok'])
})

test('8f dos vaciados a la vez (arranque y evento online) no envían dos veces', async () => {
  encolarSignout('tok', 1_000)
  reloj.t = 2_000
  const enviados: string[] = []
  const envio = remitente(enviados)
  await Promise.all([vaciarSignout(envio), vaciarSignout(envio)])
  assert.deepEqual(enviados, ['tok'])
})

test('8g lo que se encola mientras se vacía no se pierde', async () => {
  encolarSignout('a', 1_000)
  reloj.t = 2_000
  const enviados: string[] = []
  await vaciarSignout(async (token) => {
    enviados.push(token)
    encolarSignout('b', 1_500) // otro cierre de sesión sin red mientras sale el primero
  })
  assert.deepEqual(enviados, ['a'])
  const despues: string[] = []
  await vaciarSignout(remitente(despues))
  assert.deepEqual(despues, ['b'])
})

test('8h basura en la clave: no lanza, no envía y la limpia', async () => {
  const enviados: string[] = []
  localStorage.setItem(COLA, '{')
  await assert.doesNotReject(vaciarSignout(remitente(enviados)))
  assert.equal(localStorage.getItem(COLA), null)
  escribirJson(COLA, [1, null, { token: 5 }, { token: '', creadoEn: 1 }, { token: 'x' }, { token: 'x', creadoEn: 'ayer' }, 'texto'])
  await assert.doesNotReject(vaciarSignout(remitente(enviados)))
  assert.equal(localStorage.getItem(COLA), null)
  for (const otraForma of [{ token: 'x', creadoEn: 1 }, 5, 'x', true]) {
    escribirJson(COLA, otraForma) // una entrada suelta o un valor que no es lista tampoco vale
    await assert.doesNotReject(vaciarSignout(remitente(enviados)))
    assert.equal(localStorage.getItem(COLA), null)
  }
  assert.deepEqual(enviados, [])
})

test('8j un token vacío no se encola', () => {
  encolarSignout('')
  assert.equal(localStorage.getItem(COLA), null)
})

test('8i sin argumento de reloj, encolarSignout marca con el reloj del seguimiento', async () => {
  reloj.t = 5_000
  encolarSignout('tok')
  const enviados: string[] = []
  reloj.t = 5_000 + DIA // justo las 24 h desde el reloj del seguimiento
  await vaciarSignout(remitente(enviados))
  assert.deepEqual(enviados, ['tok'])
})

// --- refrescarMe --------------------------------------------------------------------------------------------------------------------

test('9 refrescarMe de una sola vuelta', async () => {
  setSession('t1', U1)
  let responder!: (u: UsuarioExpress) => void
  respuestaMe = () => new Promise<UsuarioExpress>((resolve) => void (responder = resolve))
  const a = refrescarMe()
  const b = refrescarMe()
  assert.equal(llamadasMe, 1, 'dos llamadas simultáneas, un solo me()')
  const fresco = { ...U1, name: 'Ana M.', permissions: ['facturas'] }
  responder(fresco)
  await Promise.all([a, b])
  assert.deepEqual(snapshot(), { token: 't1', user: fresco }, 'en éxito se guarda setSession(token, user)')
  assert.deepEqual(useAuthStore.getState().user, fresco)
  assert.deepEqual(eventos, [], 'el mismo usuario con datos al día no es otro usuario')
  assert.deepEqual(tokensEnMe, ['t1'])

  respuestaMe = async () => {
    throw new ApiError('Error del servidor', 500)
  }
  await assert.doesNotReject(refrescarMe()) // me() que falla no lanza (ni tras terminar la vuelta anterior)
  assert.equal(llamadasMe, 2)
  assert.deepEqual([getToken(), expiradas], ['t1', 0])
})

test('9b refrescarMe con un 401 no cierra nada ni avisa: lo hará la próxima petición normal', async () => {
  setSession('t1', U1)
  respuestaMe = async () => {
    throw new ApiError('Tu sesión venció', 401)
  }
  await assert.doesNotReject(refrescarMe())
  assert.deepEqual([getToken(), expiradas, eventos], ['t1', 0, []])
})

test('9c refrescarMe sin sesión no llama a me()', async () => {
  await refrescarMe()
  assert.equal(llamadasMe, 0)
})

test('9d refrescarMe no cuenta para el reintento de los 30 s: un 401 justo después sigue teniendo su me()', async () => {
  setSession('t1', U1)
  await refrescarMe()
  clearSession()
  await esperar()
  assert.deepEqual([getToken(), llamadasMe, expiradas], ['t1', 2, 0])
})

test('9e una respuesta que llega con la sesión ya cerrada o cambiada no la revive ni la pisa', async () => {
  setSession('t1', U1)
  let responder!: (u: UsuarioExpress) => void
  respuestaMe = () => new Promise<UsuarioExpress>((resolve) => void (responder = resolve))
  const cerrada = refrescarMe()
  marcarCierreExplicito()
  borrarSesion()
  responder(U1)
  await cerrada
  assert.equal(getToken(), null)

  setSession('t2', U1)
  const cambiada = refrescarMe()
  guardarSesion('t3', { ...U1, id: 99 }) // entró otro usuario mientras tanto
  responder({ ...U1, name: 'viejo' })
  await cambiada
  assert.equal(getToken(), 't3')
  assert.equal(useAuthStore.getState().user?.id, 99)
})

// --- cerrarSesionExpress ------------------------------------------------------------------------------------------------------------

/** Escribe `borrador`, `recientes` y `envio` de un usuario y dice cuáles quedan. */
function datosDe(tenant: number, usuario: number): { sembrar(): void; quedan(): string[] } {
  const claves = ['borrador', 'recientes', 'envio']
  return {
    sembrar: () => claves.forEach((q) => escribirJson(claveUsuario(tenant, usuario, q), { q })),
    quedan: () => claves.filter((q) => leerJson(claveUsuario(tenant, usuario, q)) !== null),
  }
}

test('10 cerrarSesionExpress', async () => {
  const mios = datosDe(12, 5)
  mios.sembrar()
  setSession('t1', U1)

  // Sin red: no intenta enviar, encola, limpia la sesión y quita borrador y recientes, pero no envio.
  const enviados: string[] = []
  await cerrarSesionExpress({ enviar: remitente(enviados), enLinea: () => false })
  assert.deepEqual(enviados, [])
  assert.deepEqual([getToken(), snapshot()], [null, null])
  assert.deepEqual(mios.quedan(), ['envio'])
  assert.deepEqual(eventos, ['cierreExplicito'])
  assert.deepEqual([llamadasMe, expiradas], [0, 0])
  const alReconectar: string[] = []
  await vaciarSignout(remitente(alReconectar))
  assert.deepEqual(alReconectar, ['t1'], 'quedó en la cola y sale al volver la red')

  // Con red pero un envío que lanza: encola.
  mios.sembrar()
  setSession('t2', U1)
  await cerrarSesionExpress({ enviar: remitente(enviados, ['t2']), enLinea: () => true })
  assert.deepEqual(enviados, ['t2'])
  assert.deepEqual([getToken(), mios.quedan()], [null, ['envio']])
  const despues: string[] = []
  await vaciarSignout(remitente(despues))
  assert.deepEqual(despues, ['t2'])

  // Con red y envío bueno: no encola.
  mios.sembrar()
  setSession('t3', U1)
  await cerrarSesionExpress({ enviar: remitente(enviados), enLinea: () => true })
  assert.deepEqual(enviados, ['t2', 't3'])
  assert.deepEqual([getToken(), mios.quedan()], [null, ['envio']])
  assert.equal(localStorage.getItem(COLA), null, 'si salió bien no queda nada que reenviar')
  assert.deepEqual(eventos, ['cierreExplicito', 'cierreExplicito', 'cierreExplicito'])
})

test('10b cerrarSesionExpress solo purga al usuario que sale: ni a otro usuario ni a otra empresa', async () => {
  const otroUsuario = datosDe(12, 6)
  const otraEmpresa = datosDe(13, 5)
  otroUsuario.sembrar()
  otraEmpresa.sembrar()
  setSession('t1', U1)
  await cerrarSesionExpress({ enviar: remitente([]), enLinea: () => true })
  assert.deepEqual(otroUsuario.quedan(), ['borrador', 'recientes', 'envio'])
  assert.deepEqual(otraEmpresa.quedan(), ['borrador', 'recientes', 'envio'])
  assert.deepEqual([...CLAVES_PURGA_AL_SALIR], ['borrador', 'recientes'])
})

test('10c cerrar con la sesión vencida (sin token en el store) envía el token del snapshot y lo suelta', async () => {
  await dejarVencida() // sin token, con el snapshot de t1
  const enviados: string[] = []
  await cerrarSesionExpress({ enviar: remitente(enviados), enLinea: () => true })
  assert.deepEqual(enviados, ['t1'])
  assert.deepEqual([snapshot(), eventos], [null, ['cierreExplicito']])
})

test('10d cerrarSesionExpress sin sesión no envía, no lanza y deja el cierre consumido', async () => {
  const enviados: string[] = []
  await assert.doesNotReject(cerrarSesionExpress({ enviar: remitente(enviados), enLinea: () => true }))
  assert.deepEqual(enviados, [])
  setSession('t1', U1)
  clearSession() // con una bandera sin consumir esto sería un cierre explícito: tiene que ser un 401 transitorio
  assert.equal(getToken(), 't1')
  assert.equal(llamadasMe, 1)
})

test('10e un usuario sin entitlements sale igual: sin empresa no hay claves que purgar', async () => {
  const datos = datosDe(12, 5)
  datos.sembrar()
  setSession('t1', BASE)
  await assert.doesNotReject(cerrarSesionExpress({ enviar: remitente([]), enLinea: () => true }))
  assert.equal(getToken(), null)
  assert.deepEqual(datos.quedan(), ['borrador', 'recientes', 'envio'])
})

test('10f pase lo que pase la sesión se cierra: un enLinea que lanza no la deja abierta', async () => {
  setSession('t1', U1)
  await assert.rejects(
    cerrarSesionExpress({
      enviar: remitente([]),
      enLinea: () => {
        throw new Error('navigator roto')
      },
    }),
    /navigator roto/,
  )
  assert.deepEqual([getToken(), snapshot()], [null, null])
})

// --- enviarSignoutPendiente ---------------------------------------------------------------------------------------------------------

/** Corre `fn` con un fetch falso que contesta `responder(n)` (la respuesta, o el error que lanza el fetch); lo devuelve al terminar. */
async function conFetch(responder: (n: number) => Response | Error, fn: () => Promise<void>): Promise<{ url: string; init: RequestInit }[]> {
  const original = globalThis.fetch
  const llamadas: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    llamadas.push({ url: String(url), init })
    const respuesta = responder(llamadas.length)
    if (respuesta instanceof Error) throw respuesta
    return respuesta
  }) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
  return llamadas
}

test('11 enviarSignoutPendiente', async () => {
  // 200 y 401 resuelven (un 401 es que el token ya no sirve: está cerrado); 500 y el error de red rechazan para que la entrada siga en la cola.
  const llamadas = await conFetch(
    () => new Response('{"success":true}', { status: 200 }),
    () => enviarSignoutPendiente('tok'),
  )
  assert.equal(llamadas.length, 1)
  assert.ok(llamadas[0].url.endsWith('/api/auth/signout'), llamadas[0].url)
  assert.equal(llamadas[0].init.method, 'POST')
  assert.equal(new Headers(llamadas[0].init.headers).get('authorization'), 'Bearer tok')
  assert.ok(llamadas[0].init.signal instanceof AbortSignal, 'con un plazo: un servidor mudo no deja el cierre de sesión colgado')

  await conFetch(
    () => new Response(null, { status: 204 }),
    () => enviarSignoutPendiente('tok'),
  )
  await conFetch(
    () => new Response('{"success":false}', { status: 401 }),
    () => enviarSignoutPendiente('tok'),
  )
  for (const status of [500, 502, 403, 404, 429]) {
    await conFetch(
      () => new Response('{}', { status }),
      () => assert.rejects(enviarSignoutPendiente('tok'), /signout/),
    )
  }
  await conFetch(
    () => new TypeError('fetch failed'),
    () => assert.rejects(enviarSignoutPendiente('tok'), /fetch failed/),
  )
})

test('11b enviarSignoutPendiente usa el token que se le da, nunca el de la sesión viva, y un 401 no la cierra', async () => {
  setSession('viva', U1)
  const llamadas = await conFetch(
    () => new Response('{"success":false}', { status: 401 }),
    () => enviarSignoutPendiente('viejo'),
  )
  assert.equal(new Headers(llamadas[0].init.headers).get('authorization'), 'Bearer viejo')
  assert.deepEqual([getToken(), expiradas, eventos], ['viva', 0, []])
})

test('11c el mensaje del rechazo no lleva el token', async () => {
  await conFetch(
    () => new Response('{}', { status: 500 }),
    async () => {
      const error = await enviarSignoutPendiente('secreto-123').then(
        () => null,
        (e: unknown) => e,
      )
      assert.ok(error instanceof Error)
      assert.equal(error.message.includes('secreto-123'), false)
    },
  )
})

test('11d cerrarSesionExpress sin argumentos envía con enviarSignoutPendiente cuando hay red', async () => {
  setSession('t1', U1)
  const llamadas = await conFetch(
    () => new Response('{"success":true}', { status: 200 }),
    () => cerrarSesionExpress(),
  )
  assert.equal(llamadas.length, 1)
  assert.ok(llamadas[0].url.endsWith('/api/auth/signout'), llamadas[0].url)
  assert.equal(new Headers(llamadas[0].init.headers).get('authorization'), 'Bearer t1')
  assert.deepEqual([getToken(), snapshot(), localStorage.getItem(COLA)], [null, null, null])
})

test('11e ...y sin red (navigator.onLine falso) ni lo intenta: lo deja en la cola', async () => {
  setSession('t1', U1)
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  try {
    const llamadas = await conFetch(
      () => new Response('{}', { status: 200 }),
      () => cerrarSesionExpress(),
    )
    assert.equal(llamadas.length, 0)
    assert.notEqual(localStorage.getItem(COLA), null)
    assert.equal(getToken(), null)
  } finally {
    Reflect.deleteProperty(navigator, 'onLine')
  }
})

// --- Con el me() real (src/api/auth.ts): lo que el seguimiento lee de sus errores y lo que le manda -----------------------------------

/** El cuerpo de GET /api/auth/me con la forma que manda el API. */
const cuerpoMe = (user: UsuarioExpress): Response => new Response(JSON.stringify({ success: true, data: { user } }), { status: 200 })

/** Corre `fn` sin el console.warn del cliente del API, que avisa de cada fallo de red. */
async function sinAvisos<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.warn
  console.warn = () => {}
  try {
    return await fn()
  } finally {
    console.warn = original
  }
}

/** Reinicia el seguimiento sin `me` inyectado: usa el del API. */
function iniciarConMeReal(): void {
  detener()
  detener = iniciarSesionTracking({ onExpirada: () => void expiradas++, ahora: () => reloj.t })
}

test('14 con el me() real: el reintento sale con el Authorization del token reinstalado y un 200 deja la sesión como estaba', async () => {
  iniciarConMeReal()
  setSession('t1', U1)
  const llamadas = await conFetch(
    () => cuerpoMe(U1),
    async () => {
      clearSession()
      await esperar()
    },
  )
  assert.equal(llamadas.length, 1)
  assert.ok(llamadas[0].url.endsWith('/api/auth/me'), llamadas[0].url)
  assert.equal(new Headers(llamadas[0].init.headers).get('authorization'), 'Bearer t1')
  assert.deepEqual([getToken(), expiradas, eventos], ['t1', 0, []])
})

test('14b con el me() real: un 401 del API vence la sesión y avisa una vez', async () => {
  iniciarConMeReal()
  setSession('t1', U1)
  await sinAvisos(() =>
    conFetch(
      () => new Response('{"success":false,"error":"Unauthorized"}', { status: 401 }),
      async () => {
        clearSession()
        await esperar()
      },
    ),
  )
  assert.deepEqual([getToken(), expiradas], [null, 1])
})

test('14c con el me() real: una falla de red no es un vencimiento', async () => {
  iniciarConMeReal()
  setSession('t1', U1)
  await sinAvisos(() =>
    conFetch(
      () => new TypeError('fetch failed'),
      async () => {
        clearSession()
        await esperar()
      },
    ),
  )
  assert.deepEqual([getToken(), expiradas], ['t1', 0])
})

// --- Cuota llena --------------------------------------------------------------------------------------------------------------------

test('12 cuota llena: guardarSesion y borrarSesion no lanzan y la sesion queda en memoria', () => {
  // Review Focus 2
  const g = globalThis as any
  g.__CUOTA_LLENA__ = true
  try {
    assert.doesNotThrow(() => guardarSesion('t9', U1))
    assert.equal(getToken(), 't9')
    assert.equal(snapshot()?.token, 't9', 'el seguimiento ya se enteró: zustand avisa antes de escribir')
    marcarCierreExplicito()
    assert.doesNotThrow(() => borrarSesion())
    assert.equal(getToken(), null)
    assert.deepEqual([snapshot(), eventos], [null, ['cierreExplicito']])
  } finally {
    g.__CUOTA_LLENA__ = false
  }
})

test('12b con la cuota llena el store sí lanza si se le llama directo (por eso la app pasa por guardarSesion y borrarSesion)', () => {
  const g = globalThis as any
  g.__CUOTA_LLENA__ = true
  try {
    assert.throws(() => setSession('t9', U1), /quota/i)
    assert.equal(getToken(), 't9') // y aun así la memoria ya cambió
  } finally {
    g.__CUOTA_LLENA__ = false
  }
})

test('12c la cuota llena no impide el reintento ante un 401 transitorio', async () => {
  setSession('t1', U1)
  const g = globalThis as any
  g.__CUOTA_LLENA__ = true
  try {
    assert.throws(() => clearSession(), /quota/i) // el 401 de http.ts: lanza tras actualizar la memoria (fuera del alcance de la app)
    assert.equal(getToken(), 't1', 'el token ya estaba de vuelta antes de que zustand escribiera')
    await esperar()
    assert.deepEqual([getToken(), llamadasMe, expiradas], ['t1', 1, 0])
  } finally {
    g.__CUOTA_LLENA__ = false
  }
})

// --- useSesionExpirada --------------------------------------------------------------------------------------------------------------

test('13 useSesionExpirada: marcarExpirada lo enciende y un token nuevo lo apaga', () => {
  assert.equal(leerGancho(), '<i>false</i>')
  marcarExpirada()
  assert.equal(leerGancho(), '<i>true</i>')
  marcarExpirada() // repetirlo no cambia nada
  assert.equal(leerGancho(), '<i>true</i>')
  setSession('t1', U1)
  assert.equal(leerGancho(), '<i>false</i>')
})

test('13b con marcarExpirada como onExpirada, la hoja se enciende al vencer y se apaga al volver a entrar', async () => {
  detener()
  detener = iniciarSesionTracking({ onExpirada: marcarExpirada, me, ahora: () => reloj.t })
  await dejarVencida()
  assert.equal(leerGancho(), '<i>true</i>')
  guardarSesion('t2', U1)
  assert.equal(leerGancho(), '<i>false</i>')
  assert.equal(getToken(), 't2')
})

// --- Oyentes y seguimiento ----------------------------------------------------------------------------------------------------------

test('un oyente que lanza no deja sin aviso a los demás ni rompe el store', () => {
  const llamadas: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void llamadas.push(args)
  try {
    const otros: string[] = []
    const dejar = escucharSesion(() => {
      throw new Error('oyente roto')
    })
    escucharSesion((e) => void otros.push(e))
    setSession('t1', U1)
    marcarCierreExplicito()
    assert.doesNotThrow(() => clearSession())
    assert.deepEqual(otros, ['cierreExplicito'])
    assert.equal(llamadas.length, 1)
    dejar()
  } finally {
    console.error = original
  }
})

test('escucharSesion: la misma función suscrita dos veces recibe dos avisos y cada suscripción se cancela por separado', () => {
  const recibidos: string[] = []
  const oyente = (e: string): void => void recibidos.push(e)
  const primera = escucharSesion(oyente)
  const segunda = escucharSesion(oyente)
  setSession('t1', U1)
  setSession('t2', { ...U1, id: 99 })
  assert.deepEqual(recibidos, ['usuarioCambio', 'usuarioCambio'])
  primera()
  setSession('t3', U1)
  assert.deepEqual(recibidos, ['usuarioCambio', 'usuarioCambio', 'usuarioCambio'])
  segunda()
  setSession('t4', { ...U1, id: 99 })
  assert.equal(recibidos.length, 3)
})

test('detener el seguimiento deja de seguir al store', async () => {
  detener()
  setSession('t1', U1)
  clearSession() // nadie escucha: ni reintento ni aviso
  await esperar()
  assert.deepEqual([llamadasMe, expiradas], [0, 0])
})

test('iniciar el seguimiento dos veces deja una sola suscripción al store; el primero, ya reemplazado, no puede quitar al segundo', () => {
  const original = useAuthStore.subscribe
  let activas = 0
  useAuthStore.subscribe = ((oyente: Parameters<typeof original>[0]) => {
    activas++
    const dejar = original(oyente)
    return () => {
      activas--
      dejar()
    }
  }) as typeof original
  try {
    detener() // el de beforeEach, que se suscribió antes de contar
    const opts = { onExpirada: () => {}, me, ahora: () => reloj.t }
    const primero = iniciarSesionTracking(opts)
    const segundo = iniciarSesionTracking(opts) // un seguimiento a la vez: el segundo reemplaza al primero
    assert.equal(activas, 1)
    primero() // ya lo reemplazó el segundo: detenerlo no quita nada
    assert.equal(activas, 1)
    segundo()
    segundo() // detener dos veces tampoco quita de más
    assert.equal(activas, 0)
  } finally {
    useAuthStore.subscribe = original
  }
})

test('detener el seguimiento devuelve el me y el reloj reales', async () => {
  reloj.t = 1_000
  setSession('t1', U1)
  clearSession()
  await esperar() // reintento en t = 1000, con el reloj y el me falsos
  assert.equal(puedeReintentarMe(), false)
  detener()
  assert.equal(puedeReintentarMe(), true, 'con el reloj real han pasado muchísimo más de 30 s desde t = 1000')
  const llamadas = await conFetch(
    () => cuerpoMe(U1),
    () => refrescarMe(),
  )
  assert.equal(llamadasMe, 1, 'el me falso solo sonó en el reintento de antes')
  assert.equal(llamadas.length, 1, 'ahora refrescarMe va al API de verdad')
  assert.ok(llamadas[0].url.endsWith('/api/auth/me'), llamadas[0].url)
})

test('un onExpirada que lanza no rompe el store', async () => {
  const original = console.error
  console.error = () => {}
  try {
    iniciar(() => {
      throw new Error('aviso roto')
    })
    await dejarVencida()
    assert.equal(getToken(), null)
  } finally {
    console.error = original
  }
})

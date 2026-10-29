// La sesión de Express: qué hacer cuando el token desaparece del store, la cola de cierres de sesión que no llegaron al servidor y el cierre de
// sesión de la app (anexo 6.14 y F10).
//
// El store de sesión (src/stores/auth.ts) es la fuente de verdad del token y se vacía por dos caminos que él no distingue: el usuario que cierra
// sesión y cualquier petición que reciba un 401 (http.ts llama a clearSession() directamente). Este módulo los distingue:
//  - Cierre explícito (`marcarCierreExplicito` antes de borrar): se suelta el snapshot y se avisa `cierreExplicito`; la app muestra el Login.
//  - Null inesperado: casi siempre es un 401 transitorio (la búsqueda del token cae en un error de base de datos y contesta «inválido»). El token
//    del snapshot se reinstala en el mismo turno, para que la pantalla no llegue a ver la sesión vacía, y se pregunta una vez a me(). Si me() da
//    401 el token murió de verdad: se vacía y se avisa con `onExpirada` (la hoja de sesión sobre la pantalla), con el snapshot retenido para saber
//    de quién era la sesión. Una falla de red de ese me() no es un vencimiento: el token se queda. Un segundo null dentro de los 30 s no
//    reintenta: avisa, porque un 401 que se repite ya no es un tropiezo.
// Los datos de pantalla solo se vacían en un cierre explícito o ante otro usuario (queryClient.ts), nunca con un null inesperado.
import { useSyncExternalStore } from 'react'
import { me as meDelApi } from '@/api/auth'
import { API_BASE_URL } from '@/api/config'
import { ApiError } from '@/api/errores'
import { clearSession, getToken, setSession, useAuthStore } from '@/stores/auth'
import type { SessionUser } from '@/stores/auth'
import { leerEntitlements } from '~/entitlements'
import type { UsuarioExpress } from '~/entitlements'
import { borrar, escribirJson, leerJson, purgarUsuario } from '~/lib/almacen'
import { ahora as ahoraDelTelefono } from '~/lib/reloj'

/** Cada cuánto, a lo sumo, se reintenta me() ante un null inesperado. */
const VENTANA_ME_MS = 30_000
/** Cuánto vive en la cola un cierre de sesión que no se pudo enviar: pasado esto se descarta sin enviarlo. */
const TTL_SIGNOUT_MS = 24 * 3_600_000
/** Cuánto se espera al servidor al cerrar sesión. Si no contesta, el cierre se encola y la sesión se cierra igual. */
const TIMEOUT_SIGNOUT_MS = 10_000
/** La cola de cierres de sesión pendientes (contracts 4.4). No es de un usuario: guarda los tokens de cualquiera que haya salido sin red. */
const CLAVE_SIGNOUT = 'fx:v1:pendingSignout'

/** Lo que se quita del teléfono al cerrar sesión: el borrador y lo reciente (clientes, productos y líneas que usó) del usuario. Nunca `envio`: una factura en vuelo no se pierde. */
export const CLAVES_PURGA_AL_SALIR = ['borrador', 'recientes'] as const

/** Qué le cuenta `escucharSesion` a quien la escucha. */
type EventoSesion = 'cierreExplicito' | 'usuarioCambio'

/** Lo que este módulo lee del store de sesión. */
type EstadoSesion = { token: string | null; user: SessionUser | null }

// --- El estado del módulo: una sola sesión, un solo seguimiento --------------------------------------------------------------------

/** El token y el usuario de la última sesión viva. Se retiene al quedarse el store sin token por un null inesperado; un cierre explícito lo suelta. */
let instantanea: { token: string; user: UsuarioExpress } | null = null
/** Hay un cierre de sesión pedido por el usuario que el store todavía no ha reflejado. Lo consume el próximo borrado. */
let cierreExplicito = false
/** El instante del último reintento de me() ante un null inesperado (no cuenta lo que pide `refrescarMe`). */
let ultimoReintentoMe: number | null = null
/** Hay un me() de reintento en vuelo: los demás 401 de ese mismo incidente esperan su respuesta. */
let reintentoEnVuelo = false
/** Lo que dice `useSesionExpirada`: la hoja de sesión tiene que estar abierta. */
let expirada = false
/** `onExpirada` ya sonó y no ha reaparecido un token: no vuelve a sonar. */
let avisada = false
let meEnVuelo: Promise<void> | null = null
let vaciando: Promise<void> | null = null

const relojDelTelefono = (): number => ahoraDelTelefono().getTime()
let consultarMe: () => Promise<UsuarioExpress> = meDelApi
let relojMs: () => number = relojDelTelefono
let alExpirar: () => void = () => {}
/** Quita el seguimiento que está puesto (null si no hay): con uno solo en pie, el estado de arriba tiene un solo dueño. */
let detenerActual: (() => void) | null = null

const oyentesSesion = new Set<(evento: EventoSesion) => void>()
const oyentesExpirada = new Set<() => void>()

// --- Guardar y borrar la sesión ----------------------------------------------------------------------------------------------------

/**
 * Pone la sesión en el store. Con la cuota del localStorage llena el `persist` de zustand lanza DESPUÉS de actualizar la memoria y de avisar a
 * los suscriptores: la sesión ya está puesta, y aquí solo se calla ese fallo de escritura. Login y la hoja de sesión pasan por aquí, nunca por
 * el store, para que un teléfono sin espacio pueda entrar.
 */
export function guardarSesion(token: string, user: UsuarioExpress): void {
  try {
    setSession(token, user)
  } catch {
    /* el store ya cambió; lo que falló fue escribirlo */
  }
}

/** Vacía la sesión del store con la misma salvedad de `guardarSesion`: si la escritura falla, la memoria ya quedó vacía. */
export function borrarSesion(): void {
  try {
    clearSession()
  } catch {
    /* el store ya cambió; lo que falló fue escribirlo */
  }
}

// --- Snapshot y avisos -------------------------------------------------------------------------------------------------------------

/**
 * El token y el usuario de la última sesión viva, o null si no la hubo o ya se cerró a propósito. Tras un 401 se queda aunque el store esté sin
 * token: sin él la app no sabría si mostrar el Login (null) o la hoja de sesión sobre la pantalla (snapshot).
 */
export function snapshot(): { token: string; user: UsuarioExpress } | null {
  return instantanea
}

/**
 * Llama a `cb` en un cierre explícito de sesión y cuando la sesión pasa a ser de otro usuario (otro `user.id` u otra empresa; renovar el token o
 * los datos del mismo usuario no cuenta). Se avisa con el snapshot ya al día. Devuelve la función que deja de avisar.
 */
export function escucharSesion(cb: (evento: EventoSesion) => void): () => void {
  // Una función propia por suscripción: cancelar una no puede dejar sin aviso a otra suscripción de la misma función.
  const oyente = (evento: EventoSesion): void => cb(evento)
  oyentesSesion.add(oyente)
  return () => {
    oyentesSesion.delete(oyente)
  }
}

/** Avisa a todos los oyentes; uno que lanza no deja sin aviso a los demás ni rompe la escritura del store que lo disparó. */
function emitir(evento: EventoSesion): void {
  for (const oyente of [...oyentesSesion]) {
    try {
      oyente(evento)
    } catch (e) {
      console.error('[sesion] un oyente de la sesión falló', e)
    }
  }
}

// --- Seguimiento del store ---------------------------------------------------------------------------------------------------------

/** La empresa de una cuenta; null si no es de Express (sin bloque de entitlements que se pueda leer). */
const empresaDe = (user: UsuarioExpress): number | null => leerEntitlements(user)?.tenant.id ?? null
/** ¿Es el mismo usuario en la misma empresa? Los ids pueden repetirse entre empresas: el id solo no identifica. */
const mismaCuenta = (a: UsuarioExpress, b: UsuarioExpress): boolean => a.id === b.id && empresaDe(a) === empresaDe(b)

/** Marca que lo próximo que se borre de la sesión es un cierre pedido por el usuario y no un 401. Lo consume ese borrado. */
export function marcarCierreExplicito(): void {
  cierreExplicito = true
}

/** ¿Ya pasaron los 30 s del último reintento de me()? `ahoraMs` es el reloj del seguimiento si no se pasa. */
export function puedeReintentarMe(ahoraMs: number = relojMs()): boolean {
  return ultimoReintentoMe === null || ahoraMs - ultimoReintentoMe >= VENTANA_ME_MS
}

/**
 * Devuelve al store la sesión retenida. False si no hay ninguna que devolver (nunca la hubo o se cerró a propósito) o si el store ya tiene un
 * token: uno puesto es más nuevo que el del snapshot y no se pisa.
 */
export function reinstalarSnapshot(): boolean {
  if (instantanea === null || getToken() !== null) return false
  guardarSesion(instantanea.token, instantanea.user)
  return true
}

/** Avisa de que la sesión venció, una sola vez hasta que reaparezca un token (el 401 de me() y el null que deja en el store coinciden). */
function avisarExpirada(): void {
  if (avisada) return
  avisada = true
  try {
    alExpirar()
  } catch (e) {
    console.error('[sesion] onExpirada falló', e)
  }
}

/**
 * Pregunta a me() si el token que se acaba de reinstalar sirve. Solo un 401 es un vencimiento (el token murió de verdad): se vacía de nuevo y
 * se avisa. Cualquier otra falla (red, 5xx) no dice nada del token, y que responda bien tampoco hace falta aplicarlo: ya está puesto.
 */
async function reintentarMe(token: string): Promise<void> {
  let vencida = false
  try {
    await consultarMe()
  } catch (e) {
    vencida = e instanceof ApiError && e.status === 401
  }
  reintentoEnVuelo = false
  if (!vencida) return
  // Este 401 es de la sesión que se reintentó, y solo vale mientras lo siga siendo: si entre tanto se cerró o entró otra, ni se borra el token de
  // ahora ni se avisa. El borrado ya avisa por la vía del store; el aviso de abajo cubre que el token ya estuviera vacío, y no suena si ese
  // borrado resultó ser el cierre explícito de un usuario que salía justo ahora (el snapshot ya no es esta sesión).
  if (getToken() === token) borrarSesion()
  if (instantanea?.token === token) avisarExpirada()
}

/** El token se fue del store sin que nadie lo pidiera (un 401): reintento único con me(), o aviso si ya se reintentó hace menos de 30 s. */
function alPerderElToken(): void {
  if (reintentoEnVuelo) {
    reinstalarSnapshot() // otra petición del mismo incidente: el me() que ya va decide por todas
    return
  }
  const ahoraMs = relojMs()
  const sesion = instantanea
  if (sesion !== null && puedeReintentarMe(ahoraMs) && reinstalarSnapshot()) {
    ultimoReintentoMe = ahoraMs
    reintentoEnVuelo = true
    void reintentarMe(sesion.token) // el token ya está de vuelta: me() lo lee del store para el Authorization
    return
  }
  avisarExpirada()
}

function alHaberToken(token: string, user: SessionUser | null): void {
  const anterior = instantanea
  if (user !== null) instantanea = { token, user }
  avisada = false
  fijarExpirada(false)
  if (user !== null && anterior !== null && !mismaCuenta(anterior.user, user)) emitir('usuarioCambio')
}

function alCierreExplicito(): void {
  cierreExplicito = false
  instantanea = null
  avisada = false
  fijarExpirada(false)
  emitir('cierreExplicito')
}

/**
 * Lo que pasa con cada cambio del store. Con token: hay sesión (entró alguien, se renovó o se reinstaló). Sin token: lo pedido por el usuario va
 * primero, aunque el store ya estuviera vacío (cerrar con la sesión vencida); si no, solo cuenta que se haya ido un token que había, porque otro
 * borrado de una sesión ya vacía no es un vencimiento nuevo.
 */
function alCambiarElStore(estado: EstadoSesion, previo: EstadoSesion): void {
  if (estado.token !== null) alHaberToken(estado.token, estado.user)
  else if (cierreExplicito) alCierreExplicito()
  else if (previo.token !== null) alPerderElToken()
}

/**
 * Sigue al store de sesión. `onExpirada` suena cuando la sesión venció y hay que pedir que entre otra vez; `me` y `ahora` son para pruebas (por
 * defecto, el me() del API y el reloj del teléfono). Toma la sesión que el store ya tenga (la hidratación del localStorage va antes que este
 * seguimiento). Hay uno solo en pie: iniciar otro reemplaza al anterior. Devuelve la función que lo detiene.
 */
export function iniciarSesionTracking(opts: { onExpirada: () => void; me?: () => Promise<UsuarioExpress>; ahora?: () => number }): () => void {
  detenerActual?.()
  alExpirar = opts.onExpirada
  consultarMe = opts.me ?? meDelApi
  relojMs = opts.ahora ?? relojDelTelefono
  const { token, user } = useAuthStore.getState()
  instantanea = token !== null && user !== null ? { token, user } : null

  const desuscribir = useAuthStore.subscribe(alCambiarElStore)
  const detener = (): void => {
    if (detenerActual !== detener) return // ya se detuvo, o lo reemplazó otro seguimiento
    detenerActual = null
    desuscribir()
    alExpirar = () => {}
    consultarMe = meDelApi
    relojMs = relojDelTelefono
  }
  detenerActual = detener
  return detener
}

/**
 * Pide a me() los datos al día de la sesión (rol, permisos, entitlements) y los guarda con el mismo token. De una sola vuelta: las llamadas que
 * llegan con una en vuelo comparten su resultado. No lanza: un me() que falla (también con 401) no cierra nada, y la próxima petición normal
 * que dé 401 pasa por el reintento de arriba. Una respuesta que llega con la sesión ya cerrada o cambiada se descarta.
 */
export function refrescarMe(): Promise<void> {
  if (meEnVuelo !== null) return meEnVuelo
  const token = getToken()
  if (token === null) return Promise.resolve()
  const vuelo = (async (): Promise<void> => {
    try {
      const user = await consultarMe()
      if (getToken() === token) guardarSesion(token, user)
    } catch {
      /* no hay nada que hacer con un me() que falla */
    }
  })().finally(() => {
    meEnVuelo = null
  })
  meEnVuelo = vuelo
  return vuelo
}

// --- La hoja de sesión -------------------------------------------------------------------------------------------------------------

function fijarExpirada(valor: boolean): void {
  if (expirada === valor) return
  expirada = valor
  for (const aviso of [...oyentesExpirada]) aviso()
}

/** La sesión venció: App abre la hoja de sesión sobre la pantalla. Se apaga sola cuando aparece un token. */
export function marcarExpirada(): void {
  fijarExpirada(true)
}

function suscribirExpirada(aviso: () => void): () => void {
  oyentesExpirada.add(aviso)
  return () => {
    oyentesExpirada.delete(aviso)
  }
}

const leerExpirada = (): boolean => expirada

/** ¿Hay que mostrar la hoja de sesión? Verdadero desde `marcarExpirada` hasta que un token reaparece en el store. */
export function useSesionExpirada(): boolean {
  // El tercer argumento es el valor al renderizar en servidor: aquí no hay, pero las pruebas renderizan a texto y lo piden.
  return useSyncExternalStore(suscribirExpirada, leerExpirada, leerExpirada)
}

// --- Cierres de sesión que no llegaron al servidor ---------------------------------------------------------------------------------

interface EntradaSignout {
  token: string
  creadoEn: number
}

const esEntrada = (valor: unknown): valor is EntradaSignout => {
  if (typeof valor !== 'object' || valor === null) return false
  const { token, creadoEn } = valor as Record<string, unknown>
  return typeof token === 'string' && token !== '' && typeof creadoEn === 'number' && Number.isFinite(creadoEn)
}

/** La cola tal como está guardada; lo que no es una entrada válida (texto corrupto, otra forma) se ignora. */
function leerCola(): EntradaSignout[] {
  const cola = leerJson<unknown>(CLAVE_SIGNOUT)
  return Array.isArray(cola) ? cola.filter(esEntrada) : []
}

function guardarCola(cola: readonly EntradaSignout[]): void {
  if (cola.length === 0) borrar(CLAVE_SIGNOUT)
  else escribirJson(CLAVE_SIGNOUT, cola)
}

/** Deja en la cola el cierre de sesión de `token` (el de alguien que salió sin red): se envía al volver la red o al abrir la app. */
export function encolarSignout(token: string, ahoraMs: number = relojMs()): void {
  if (token === '') return
  guardarCola([...leerCola().filter((entrada) => entrada.token !== token), { token, creadoEn: ahoraMs }])
}

async function vaciar(enviar: (token: string) => Promise<void>): Promise<void> {
  const ahoraMs = relojMs()
  const resueltos = new Set<string>() // lo que ya no hay que guardar: lo enviado y lo vencido
  const porEnviar: string[] = []
  for (const entrada of leerCola()) {
    if (ahoraMs - entrada.creadoEn > TTL_SIGNOUT_MS) resueltos.add(entrada.token)
    else porEnviar.push(entrada.token)
  }
  for (const token of porEnviar) {
    try {
      await enviar(token)
      resueltos.add(token)
    } catch {
      /* se queda en la cola para la próxima vez; los demás no esperan por él */
    }
  }
  // Se vuelve a leer: mientras se enviaba pudo encolarse otro cierre de sesión, y escribir lo leído al principio lo perdería.
  guardarCola(leerCola().filter((entrada) => !resueltos.has(entrada.token)))
}

/**
 * Envía con `enviar` los cierres de sesión que quedaron en la cola y quita los que salieron bien o llevan más de 24 h. Uno que falla se queda y
 * no frena a los demás. No lanza. De una sola vuelta: el arranque y el evento `online` pueden coincidir sin enviar dos veces el mismo token.
 */
export function vaciarSignout(enviar: (token: string) => Promise<void>): Promise<void> {
  if (vaciando !== null) return vaciando
  vaciando = vaciar(enviar).finally(() => {
    vaciando = null
  })
  return vaciando
}

/**
 * Cierra en el servidor la sesión de `token` (POST /api/auth/signout con ese token y no con el de la sesión viva, que puede ser de otro
 * usuario). Resuelve con un 2xx y con un 401 (el token ya no sirve: está cerrado); rechaza con cualquier otra cosa, red y plazo incluidos, para
 * que la entrada siga en la cola. No pasa por http.ts: allí un 401 cerraría la sesión que esté puesta.
 */
export async function enviarSignoutPendiente(token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/auth/signout`, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_SIGNOUT_MS),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  })
  if (res.ok || res.status === 401) return
  throw new Error(`signout pendiente: el servidor contestó HTTP ${res.status}`)
}

// --- Cerrar sesión -----------------------------------------------------------------------------------------------------------------

/** ¿Cree el aparato que tiene red? Que diga que sí no prueba que algo llegue a internet: por eso un envío que falla también se encola. */
const hayRed = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * Cierra la sesión de Express. Sin red, o si el servidor no contesta bien, el cierre se encola y sale después (el token no queda vivo en el
 * servidor); en cualquier caso la sesión local se cierra (`snapshot()` queda en null y App muestra el Login) y se quita del teléfono el
 * borrador y lo reciente del usuario que sale. No toca `envio`: una factura que quedó a medias se retoma al volver a entrar.
 */
export async function cerrarSesionExpress(deps: { enviar?: (token: string) => Promise<void>; enLinea?: () => boolean } = {}): Promise<void> {
  const enviar = deps.enviar ?? enviarSignoutPendiente
  const enLinea = deps.enLinea ?? hayRed
  const sesion = instantanea
  marcarCierreExplicito()
  try {
    if (sesion !== null) {
      if (!enLinea()) encolarSignout(sesion.token)
      else
        try {
          await enviar(sesion.token)
        } catch {
          encolarSignout(sesion.token)
        }
    }
  } finally {
    borrarSesion()
    const entitlements = sesion === null ? null : leerEntitlements(sesion.user)
    if (sesion !== null && entitlements !== null) purgarUsuario(entitlements.tenant.id, sesion.user.id, CLAVES_PURGA_AL_SALIR)
  }
}

// --- Pruebas -----------------------------------------------------------------------------------------------------------------------

/** Solo para pruebas: detiene el seguimiento y deja el módulo como recién importado. El store de sesión no se toca. */
export function _reiniciarParaPruebas(): void {
  detenerActual?.()
  instantanea = null
  cierreExplicito = false
  ultimoReintentoMe = null
  reintentoEnVuelo = false
  expirada = false
  avisada = false
  meEnVuelo = null
  vaciando = null
  oyentesSesion.clear()
  oyentesExpirada.clear()
}

// El estado del asistente de venta, UNO para toda la app (un store de zustand a nivel de módulo): el carrito sobrevive a cambiar de paso, a la hoja de un cliente nuevo y a
// salir del asistente con la X. Aquí está también todo lo que decide si una factura se emite, porque la emisión es la parte que no puede salir mal:
//
//  - Un solo envío a la vez. `enviando` se pone en el store ANTES del primer `await` y no se suelta hasta que el servidor contesta; el botón además se deshabilita, pero la
//    bandera es la que manda (un segundo toque, otra pantalla o un doble clic no llegan a mandar nada).
//  - El registro de envío (lib/envio) se escribe ANTES del POST y se actualiza con lo que conteste el servidor. Si la respuesta se pierde, o la página se recarga con el envío
//    en vuelo, el registro queda en `comprobando` y NO se puede emitir otra factura hasta que la persona confirme (`confirmarNoSeEmitio`) que no se emitió.
//  - El POST no se repite nunca por su cuenta. Con la clave de idempotencia (solo si la cuenta lo anuncia) el servidor sabría reconocer un reintento; sin ella, reintentar
//    gastaría otro e-NCF.
//
// El borrador se guarda 400 ms después del último cambio (y al ocultarse la página), dura 7 días y se borra al emitir con éxito. Una pantalla del asistente llama a
// `iniciarWizard` al montarse: carga lo guardado del usuario de la sesión una sola vez, y otra vez si entra otro usuario.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useSession } from '@/stores/auth'
import { esAdmin, leerEntitlements, tiposVenta } from '~/entitlements'
import type { Entitlements, UsuarioExpress } from '~/entitlements'
import {
  actualizarLinea,
  agregarLinea,
  agregarProducto,
  cambiarCantidad,
  cambiarTipo,
  carritoVacio,
  elegirCliente,
  elegirPago,
  quitarLinea,
  restaurarLinea,
  tieneContenido,
} from '~/lib/carrito'
import type { Carrito, ClienteSel, Deshacer, LineaCarrito, Pago, ProductoSel, TipoItem } from '~/lib/carrito'
import { clasificar, clasificarEstado } from '~/lib/clasificar'
import type { Outcome } from '~/lib/clasificar'
import {
  aplicarEstado,
  aplicarOutcome,
  AUTOSAVE_MS,
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
} from '~/lib/envio'
import type { EnvioRecord, UsuarioClave } from '~/lib/envio'
import { conClave, construirPayloadVenta } from '~/lib/payload'
import { ahora, hoy } from '~/lib/reloj'
import { escucharSesion, snapshot } from '~/lib/sesion'
import { resumenTotales } from '~/lib/totales'
import { emitirVenta } from '~/net/emitir'
import { getEstado } from '~/net/lecturas'
import { queryClient } from '~/queryClient'
import { formatHash, navegar } from '~/router'

export interface ErrorDeEnvio {
  mensaje: string
  codigo: string | null
}

interface EstadoWizard {
  /** De quién son los datos cargados (`tenant:usuario`); null hasta que se cargan. */
  dueno: string | null
  carrito: Carrito | null
  /** El tipo (bien o servicio) de la última línea libre, para proponerlo en la siguiente. */
  ultimoTipoItem: TipoItem | undefined
  /** Hay un envío en vuelo ahora mismo. */
  enviando: boolean
  /** El registro del último envío (el de `fx:v1:...:envio`), al día. */
  envio: EnvioRecord | null
  /** Lo que el servidor dijo de una venta que no guardó (validación o bloqueo): se ve en Revisar hasta el próximo cambio. */
  errorEnvio: ErrorDeEnvio | null
  /** El carrito salió del borrador guardado (no es de esta visita): la pantalla lo avisa y deja empezar de nuevo. */
  recuperado: boolean
}

const VACIO: EstadoWizard = { dueno: null, carrito: null, ultimoTipoItem: undefined, enviando: false, envio: null, errorEnvio: null, recuperado: false }

export const useWizardStore = create<EstadoWizard>()(() => VACIO)

const estado = (): EstadoWizard => useWizardStore.getState()
const poner = (p: Partial<EstadoWizard>): void => useWizardStore.setState(p)
const duenoDe = (u: UsuarioClave): string => `${u.tenantId}:${u.userId}`
/** ¿Sigue cargado en el store lo de este usuario? Un envío que termina cuando ya salió la sesión no toca el store del que entró después. */
const esDe = (u: UsuarioClave): boolean => estado().dueno === duenoDe(u)

// --- La cuenta ----------------------------------------------------------------------------------------------------------------------

export interface Cuenta {
  usuario: UsuarioExpress | null
  entitlements: Entitlements | null
  /** De quién son los datos guardados; null con la sesión vencida y sin sesión retenida, o sin entitlements de Express. */
  u: UsuarioClave | null
  admin: boolean
}

/** La cuenta de la sesión. Con la sesión vencida el store de sesión queda vacío y la hoja de sesión se abre encima de esta pantalla: sigue con la cuenta retenida (como Facturas). */
export function useCuenta(): Cuenta {
  const { token, user } = useSession()
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const entitlements = useMemo(() => leerEntitlements(usuario), [usuario])
  const userId = usuario?.id
  const tenantId = entitlements?.tenant.id
  const u = useMemo<UsuarioClave | null>(() => (userId === undefined || tenantId === undefined ? null : { tenantId, userId }), [userId, tenantId])
  return { usuario, entitlements, u, admin: esAdmin(usuario) }
}

// --- Cargar y guardar el borrador ---------------------------------------------------------------------------------------------------

let usuarioActual: UsuarioClave | null = null
let temporizador: ReturnType<typeof setTimeout> | null = null
let suscrito = false
let hidratando = false

function cancelarGuardado(): void {
  if (temporizador !== null) clearTimeout(temporizador)
  temporizador = null
}

/** Escribe el borrador ya (un carrito sin nada borra el guardado). */
function guardarYa(): void {
  cancelarGuardado()
  const s = estado()
  if (usuarioActual === null || s.carrito === null || s.dueno !== duenoDe(usuarioActual)) return
  guardarBorrador(usuarioActual, s.carrito, ahora().getTime(), s.ultimoTipoItem)
}

function programarGuardado(): void {
  cancelarGuardado()
  temporizador = setTimeout(guardarYa, AUTOSAVE_MS)
}

/**
 * Carga el borrador y el registro de envío de este usuario, si no están ya cargados. Con un tipo que la cuenta ya no vende, el borrador pasa al primero que sí. Un registro que
 * dice `enviando` pero no tiene petición en vuelo (la página se recargó a medias) pasa a `comprobando`: no se sabe cómo terminó, y por eso no se vuelve a emitir.
 */
export function iniciarWizard(u: UsuarioClave, tipos: readonly string[]): void {
  const dueno = duenoDe(u)
  const s = estado()
  if (s.dueno === dueno && s.carrito !== null) return
  usuarioActual = u
  cancelarGuardado()
  const borrador = leerBorrador(u, ahora().getTime())
  let carrito = borrador?.carrito ?? carritoVacio(tipos[0] ?? '45')
  if (tipos.length > 0 && !tipos.includes(carrito.tipo)) carrito = cambiarTipo(carrito, tipos[0])
  const leido = leerEnvio(u)
  const envio = leido === null ? null : sinPeticion(leido)
  if (envio !== null && envio !== leido) guardarEnvio(u, envio)
  hidratando = true
  poner({ dueno, carrito, ultimoTipoItem: borrador?.ultimoTipoItem, enviando: false, envio, errorEnvio: null, recuperado: borrador !== null })
  hidratando = false
  if (!suscrito) {
    suscrito = true
    useWizardStore.subscribe((nuevo, previo) => {
      if (!hidratando && (nuevo.carrito !== previo.carrito || nuevo.ultimoTipoItem !== previo.ultimoTipoItem)) programarGuardado()
    })
    if (typeof window !== 'undefined') window.addEventListener('pagehide', guardarYa)
    // Al cerrar sesión (o entrar otro usuario) lo que está en memoria es de la sesión que termina: se vacía, y el autoguardado pendiente no escribe nada.
    escucharSesion(() => {
      cancelarGuardado()
      usuarioActual = null
      hidratando = true
      poner(VACIO)
      hidratando = false
    })
  }
}

/** Empieza de nuevo: borra el borrador y deja un carrito vacío del mismo tipo. */
export function descartarBorrador(): void {
  cancelarGuardado()
  const s = estado()
  if (usuarioActual !== null) borrarBorrador(usuarioActual)
  if (s.carrito === null) return
  hidratando = true // lo guardado ya se borró: no hay que escribir un borrador vacío
  poner({ carrito: carritoVacio(s.carrito.tipo), ultimoTipoItem: undefined, recuperado: false, errorEnvio: null })
  hidratando = false
}

// --- Cambiar el carrito -------------------------------------------------------------------------------------------------------------

/** Aplica un cambio al carrito. Cualquier cambio quita el aviso de un envío rechazado: la persona ya está corrigiendo. */
function mutar(cambio: (c: Carrito) => Carrito): void {
  const c = estado().carrito
  if (c === null) return
  const n = cambio(c)
  if (n !== c) poner({ carrito: n, errorEnvio: null })
}

export const wizard = {
  elegirTipo: (tipo: string): void => mutar((c) => cambiarTipo(c, tipo)),
  elegirCliente: (cliente: ClienteSel | null): void => mutar((c) => elegirCliente(c, cliente)),
  elegirPago: (p: { pago: Pago; plazoDias?: number; fechaLimite?: string | null }): void => mutar((c) => elegirPago(c, p)),
  actualizarLinea: (id: number, parche: Partial<Omit<LineaCarrito, 'id'>>): void => mutar((c) => actualizarLinea(c, id, parche)),

  /** Toca un producto: línea nueva o +1. Devuelve la línea y si hay que abrir su hoja (sin precio). Con 50 líneas, `lineaId` es null. */
  agregarProducto(p: ProductoSel): { lineaId: number | null; abrirLinea: boolean } {
    const c = estado().carrito
    if (c === null) return { lineaId: null, abrirLinea: false }
    const r = agregarProducto(c, p)
    if (r.carrito !== c) poner({ carrito: r.carrito, errorEnvio: null })
    return { lineaId: r.lineaId, abrirLinea: r.abrirLinea }
  },

  /** Agrega la línea que armó la hoja (una línea libre). Recuerda su tipo (bien o servicio) para la próxima. Con 50 líneas, `null`. */
  agregarLinea(linea: Omit<LineaCarrito, 'id'>): number | null {
    const c = estado().carrito
    if (c === null) return null
    const r = agregarLinea(c, linea)
    if (r.carrito !== c) poner({ carrito: r.carrito, ultimoTipoItem: linea.tipoItem, errorEnvio: null })
    return r.lineaId
  },

  /** Cambia la cantidad; en 0 quita la línea y devuelve cómo deshacerlo. */
  cambiarCantidad(id: number, cant: number): Deshacer | null {
    const c = estado().carrito
    if (c === null) return null
    const r = cambiarCantidad(c, id, cant)
    if (r.carrito !== c) poner({ carrito: r.carrito, errorEnvio: null })
    return r.deshacer
  },

  quitarLinea(id: number): Deshacer | null {
    const c = estado().carrito
    if (c === null) return null
    const r = quitarLinea(c, id)
    if (r.carrito !== c) poner({ carrito: r.carrito, errorEnvio: null })
    return r.deshacer
  },

  restaurarLinea: (d: Deshacer): void => mutar((c) => restaurarLinea(c, d)),
}

// --- Emitir ------------------------------------------------------------------------------------------------------------------------

/** ¿Este resultado deja la venta registrada en una factura de verdad, de modo que el borrador ya no hace falta? Aceptada, en proceso y no encontrada. */
const dejaFactura = (kind: Outcome['kind']): boolean => kind === 'aceptada' || kind === 'enProceso' || kind === 'noEncontrada'

/** Una factura nueva (o con otro estado) cambia la lista, las estadísticas y los avisos de Facturas: lo que tengan en caché es de antes. */
function refrescarListas(): void {
  for (const queryKey of [['facturas'], ['stats'], ['avisos']]) void queryClient.invalidateQueries({ queryKey })
}

/** La respuesta del servidor llegó: se guarda lo que dice y, si la venta ya es una factura, se borra el borrador. */
function terminarEnvio(u: UsuarioClave, registro: EnvioRecord, o: Outcome): void {
  const siguiente = aplicarOutcome(registro, o)
  if (siguiente === null) {
    // No se guardó nada (validación o bloqueo): sin registro, y la persona vuelve a Revisar con lo que dijo el servidor.
    borrarEnvio(u)
    if (!esDe(u)) return
    const mensaje = o.kind === 'validacion' || o.kind === 'bloqueada' ? o.mensaje : ''
    poner({ envio: null, enviando: false, errorEnvio: { mensaje, codigo: o.kind === 'bloqueada' ? o.codigo : null } })
    // Solo si la persona sigue mirando este envío: si se fue a otra parte, el aviso la espera en Revisar.
    if (typeof location !== 'undefined' && location.hash === formatHash({ id: 'facturar-resultado', clave: registro.clave })) navegar({ id: 'facturar-revisar' }, { reemplazar: true })
    return
  }
  guardarEnvio(u, siguiente)
  refrescarListas()
  if (!esDe(u)) return
  poner({ envio: siguiente, enviando: false })
  if (dejaFactura(o.kind)) descartarBorrador()
}

/**
 * Emite la venta del carrito. Un solo envío a la vez; el registro se escribe antes del POST; la pantalla pasa al resultado de inmediato y el POST sigue aunque la persona salga.
 * No lanza: lo que salga mal queda en el registro y el resultado lo dice. `idempotencia` es `entitlements.capacidades.idempotencia`.
 */
export async function emitirAhora(a: { u: UsuarioClave; idempotencia: boolean }): Promise<void> {
  const s = estado()
  if (s.enviando || s.carrito === null || s.dueno !== duenoDe(a.u)) return
  if (s.envio !== null && (s.envio.fase === 'enviando' || s.envio.fase === 'incierta' || s.envio.fase === 'comprobando')) return
  // Antes de cualquier await: nada más puede empezar un envío.
  poner({ enviando: true, errorEnvio: null })
  const carrito = s.carrito
  const base = construirPayloadVenta(carrito, hoy())
  const clave = nuevaClave()
  const payload = a.idempotencia ? conClave(base, clave) : base
  const registro = crearEnvio({ clave, tipo: carrito.tipo, total: resumenTotales(carrito.lineas).total, clienteNombre: carrito.cliente?.nombre, ahora: ahora().getTime() })
  guardarEnvio(a.u, registro)
  poner({ envio: registro })
  navegar({ id: 'facturar-resultado', clave }, { reemplazar: true })
  const respuesta = await emitirVenta(payload)
  terminarEnvio(a.u, registro, clasificar(respuesta))
}

/** «Ya revisé: no se emitió»: la persona miró Facturas y la factura no está. Suelta el registro y deja emitir de nuevo (el borrador sigue ahí). */
export function confirmarNoSeEmitio(u: UsuarioClave): void {
  borrarEnvio(u)
  poner({ envio: null })
}

/** Suelta un registro que ya cumplió (terminada, en proceso o no guardada). Uno sin confirmar se queda: sigue impidiendo emitir. */
export function soltarEnvio(u: UsuarioClave): void {
  const r = estado().envio
  if (r === null || r.fase === 'incierta' || r.fase === 'comprobando' || r.fase === 'enviando') return
  borrarEnvio(u)
  poner({ envio: null })
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/**
 * «Verificar ahora»: le pregunta a la DGII cómo va la factura (GET /api/facturas/{id}/estado) y actualiza el registro con la misma tabla de estados de la emisión. Si la
 * venta ya es una factura, borra el borrador. Dice si algo cambió (si no, la DGII todavía no responde y la pantalla lo avisa). Lanza el ApiError del servidor si no se pudo
 * preguntar: la pantalla lo dice.
 */
export async function verificarEnvio(u: UsuarioClave): Promise<boolean> {
  const r = estado().envio
  if (r === null || r.facturaId === undefined) return false
  const data = await getEstado(r.facturaId)
  const fila = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const nuevo = texto(fila.estado_dgii)
  if (nuevo === undefined) return false
  const actual = estado().envio
  if (actual === null || actual.clave !== r.clave) return false
  const siguiente = aplicarEstado(actual, nuevo, texto(fila.e_ncf))
  guardarEnvio(u, siguiente)
  poner({ envio: siguiente })
  refrescarListas()
  if (dejaFactura(clasificarEstado(nuevo))) descartarBorrador()
  return siguiente.fase !== actual.fase || siguiente.estado !== actual.estado
}

// --- Lo que el resto de la app muestra del asistente ---------------------------------------------------------------------------------

/** Lo que muestran el punto del borrador, las franjas «Enviando factura...» y «Factura sin confirmar» y el aviso de cerrar sesión (la forma de `IndicadoresFacturar`, lib/indicadores). */
export interface IndicadoresDelAsistente {
  /** Hay una factura a medias en el teléfono. */
  borrador: boolean
  /** Hay un envío en vuelo ahora mismo. */
  enviando: boolean
  /** Hay un envío cuyo resultado no se conoce: su e-NCF ('' si todavía no lo hay), el id de la factura si ya se guardó y la clave del registro. */
  sinConfirmar: { eNcf: string; facturaId: number | null; clave: string } | null
}

/**
 * Los indicadores del asistente para el shell: lo que `lib/indicadores.useIndicadoresFacturar` entrega a la barra, a las franjas, a Más y al aviso de versión. Carga lo guardado del
 * usuario al montarse (el shell siempre está montado, así que un envío sin confirmar se ve desde cualquier pantalla y también tras recargar), y devuelve el mismo objeto mientras nada cambie.
 */
export function useIndicadoresDelAsistente(): IndicadoresDelAsistente {
  const { entitlements, u } = useCuenta()
  const tiposClave = tiposVenta(entitlements).join(',')
  useEffect(() => {
    if (u !== null) iniciarWizard(u, tiposClave === '' ? [] : tiposClave.split(','))
  }, [u, tiposClave])
  const borrador = useWizardStore((s) => s.carrito !== null && tieneContenido(s.carrito))
  const enviando = useWizardStore((s) => s.enviando || s.envio?.fase === 'enviando')
  const envio = useWizardStore((s) => s.envio)
  return useMemo(() => {
    const sinConfirmar = envio !== null && bloqueaEmision(envio) ? { eNcf: envio.eNcf ?? '', facturaId: envio.facturaId ?? null, clave: envio.clave } : null
    return { borrador, enviando, sinConfirmar }
  }, [borrador, enviando, envio])
}

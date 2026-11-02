// Lo que el asistente guarda en el teléfono para sobrevivir a una recarga: el BORRADOR (la factura a medias) y el REGISTRO DE ENVÍO (la factura que se está emitiendo o
// cuyo resultado no se conoce). Los dos van por lib/almacen, con la clave de este usuario en esta empresa (`fx:v1:{tenant}:{user}:borrador` y `:envio`).
//
// La regla del dueño es que una conexión caída no produzca un segundo e-NCF. El registro se escribe ANTES de mandar la venta y se actualiza con lo que conteste el
// servidor; si la página se recarga con el envío en vuelo, o si la respuesta se pierde (red caída, tiempo agotado), el registro queda en `comprobando` y mientras tanto no se
// puede emitir otra factura. Solo la persona lo suelta, cuando mira Facturas y confirma que no se emitió.
//
// El borrador dura 7 días y no se guarda vacío. Lo guardado no es de fiar: lo que no tiene la forma esperada se descarta.
import { borrar, claveUsuario, escribirJson, leerJson } from '~/lib/almacen'
import { carritoDeJson, tieneContenido } from '~/lib/carrito'
import type { Carrito, TipoItem } from '~/lib/carrito'
import { clasificarEstado } from '~/lib/clasificar'
import type { Outcome } from '~/lib/clasificar'
import { rd } from '~/lib/dinero'
import { TEXTO_NO_ENCONTRADO, TITULO_NO_ENCONTRADO } from '@/features/invoices/reenvio'

/** De quién son los datos guardados: la empresa y el usuario (la sesión de otro en el mismo teléfono no ve ni retoma lo de este). */
export interface UsuarioClave {
  tenantId: number
  userId: number
}

/** Cuánto espera el autoguardado después de cada cambio. */
export const AUTOSAVE_MS = 400
/** Un borrador de más de 7 días se descarta al abrir. */
export const TTL_BORRADOR_MS = 7 * 24 * 60 * 60 * 1000

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// --- El borrador ------------------------------------------------------------------------------------------------------------------------

export interface Borrador {
  carrito: Carrito
  /** El tipo (bien o servicio) de la última línea libre, para proponerlo en la siguiente. */
  ultimoTipoItem?: TipoItem
}

/** El borrador de este usuario, o null si no hay, está corrupto o es de más de 7 días (y entonces se borra). `ahora` en ms. */
export function leerBorrador(u: UsuarioClave, ahora: number): Borrador | null {
  const clave = claveUsuario(u.tenantId, u.userId, 'borrador')
  const v = leerJson<unknown>(clave)
  if (v === null) return null
  const guardadoEn = esObjeto(v) && typeof v.guardadoEn === 'number' ? v.guardadoEn : NaN
  const carrito = esObjeto(v) ? carritoDeJson(v.carrito) : null
  if (carrito === null || !(ahora - guardadoEn <= TTL_BORRADOR_MS)) {
    borrar(clave)
    return null
  }
  const tipo = esObjeto(v) ? v.ultimoTipoItem : undefined
  return { carrito, ...(tipo === 1 || tipo === 2 ? { ultimoTipoItem: tipo } : {}) }
}

/** Guarda el borrador. Un carrito sin cliente ni líneas no es un borrador: borra el que hubiera. */
export function guardarBorrador(u: UsuarioClave, carrito: Carrito, ahora: number, ultimoTipoItem?: TipoItem): void {
  const clave = claveUsuario(u.tenantId, u.userId, 'borrador')
  if (!tieneContenido(carrito)) borrar(clave)
  else escribirJson(clave, { v: 1, guardadoEn: ahora, carrito, ultimoTipoItem })
}

export function borrarBorrador(u: UsuarioClave): void {
  borrar(claveUsuario(u.tenantId, u.userId, 'borrador'))
}

// --- El registro de envío ---------------------------------------------------------------------------------------------------------------

/**
 * En qué punto está la factura que se emitió:
 *  - `enviando`: la petición está en vuelo;
 *  - `terminada`: la DGII dio su veredicto (aceptada, rechazada o no encontrada: lo dice `estado`);
 *  - `enProceso`: guardada y enviada, la DGII la sigue revisando;
 *  - `incierta`: guardada con su número pero sin confirmar con la DGII;
 *  - `noGuardada`: el servidor dice que no guardó nada;
 *  - `comprobando`: no se sabe si quedó guardada (se cortó la señal, se agotó el tiempo o la página se recargó a medias).
 */
export type FaseEnvio = 'enviando' | 'terminada' | 'enProceso' | 'incierta' | 'noGuardada' | 'comprobando'

const FASES: readonly FaseEnvio[] = ['enviando', 'terminada', 'enProceso', 'incierta', 'noGuardada', 'comprobando']

export interface EnvioRecord {
  /** Un UUID v4 que identifica este envío: va en la ruta del resultado y, si el servidor lo admite, es la clave de idempotencia. */
  clave: string
  fase: FaseEnvio
  creadoEn: number
  tipo: string
  total: number
  clienteNombre?: string
  eNcf?: string
  facturaId?: number
  /** El `estado_dgii` tal cual lo dijo el servidor. */
  estado?: string
  /** Los motivos de un rechazo, tal cual los dijo la DGII. */
  motivos?: string[]
  /** El texto del servidor cuando no guardó nada. */
  mensaje?: string
}

/** Un UUID v4 en minúsculas, armado solo con `getRandomValues` (`crypto.randomUUID` no existe en Chrome 90 ni en Safari 14.5). */
export function nuevaClave(cripto: Pick<Crypto, 'getRandomValues'> | undefined = globalThis.crypto): string {
  const b = new Uint8Array(16)
  if (cripto !== undefined) cripto.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** El registro de un envío que acaba de empezar. */
export function crearEnvio(a: { clave: string; tipo: string; total: number; clienteNombre?: string; ahora: number }): EnvioRecord {
  const r: EnvioRecord = { clave: a.clave, fase: 'enviando', creadoEn: a.ahora, tipo: a.tipo, total: a.total }
  if (a.clienteNombre !== undefined && a.clienteNombre !== '') r.clienteNombre = a.clienteNombre
  return r
}

/** La fase de una categoría de estado de la DGII. */
function faseDe(kind: ReturnType<typeof clasificarEstado>): FaseEnvio {
  return kind === 'enProceso' ? 'enProceso' : kind === 'guardadaIncierta' ? 'incierta' : 'terminada'
}

/**
 * El registro después de lo que contestó el servidor, o null si no queda registro: una validación o un bloqueo (403) no guardaron nada y la persona vuelve a editar.
 * Con factura, el total que vale es el del servidor. Lo que no se sabe (`desconocido`, `enCurso`) queda en `comprobando`: no se vuelve a emitir.
 */
export function aplicarOutcome(r: EnvioRecord, o: Outcome): EnvioRecord | null {
  switch (o.kind) {
    case 'aceptada':
    case 'enProceso':
    case 'noEncontrada':
    case 'guardadaIncierta':
    case 'rechazada': {
      const siguiente: EnvioRecord = { ...r, fase: faseDe(o.kind), facturaId: o.facturaId, estado: o.estado }
      if (o.eNcf !== null) siguiente.eNcf = o.eNcf
      if (o.total !== null) siguiente.total = o.total
      if (o.kind === 'rechazada') siguiente.motivos = o.motivos
      return siguiente
    }
    case 'noGuardada':
      return { ...r, fase: 'noGuardada', mensaje: o.mensaje }
    case 'desconocido':
    case 'enCurso':
      return { ...r, fase: 'comprobando' }
    case 'bloqueada':
      return o.codigo === 'CLAVE_REUTILIZADA' ? { ...r, fase: 'comprobando' } : null
    case 'validacion':
      return null
  }
}

/** El registro después de preguntarle a la DGII el estado de la factura («Verificar ahora»): la misma tabla de estados que al emitir. */
export function aplicarEstado(r: EnvioRecord, estado: string, eNcf?: string): EnvioRecord {
  const siguiente: EnvioRecord = { ...r, fase: faseDe(clasificarEstado(estado)), estado }
  if (eNcf !== undefined && eNcf !== '') siguiente.eNcf = eNcf
  return siguiente
}

/** ¿Este registro impide emitir otra factura? Sí si no se sabe si quedó guardada (`comprobando`) o si quedó guardada sin confirmar (`incierta`). */
export function bloqueaEmision(r: EnvioRecord | null): boolean {
  return r !== null && (r.fase === 'incierta' || r.fase === 'comprobando')
}

/** El registro de un envío que ya no tiene petición en vuelo: si dice `enviando`, la página se recargó a medias y no se sabe cómo terminó. */
export function sinPeticion(r: EnvioRecord): EnvioRecord {
  return r.fase === 'enviando' ? { ...r, fase: 'comprobando' } : r
}

// --- Guardar y leer el registro ---------------------------------------------------------------------------------------------------------

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

function envioDeJson(v: unknown): EnvioRecord | null {
  if (!esObjeto(v)) return null
  const { clave, fase, creadoEn, tipo, total, facturaId, motivos } = v
  if (typeof clave !== 'string' || clave === '' || typeof tipo !== 'string' || typeof creadoEn !== 'number' || typeof total !== 'number') return null
  if (!FASES.some((f) => f === fase)) return null
  const r: EnvioRecord = { clave, fase: fase as FaseEnvio, creadoEn, tipo, total }
  const { clienteNombre, eNcf, estado, mensaje } = v
  if (texto(clienteNombre) !== undefined) r.clienteNombre = clienteNombre as string
  if (texto(eNcf) !== undefined) r.eNcf = eNcf as string
  if (typeof facturaId === 'number' && Number.isSafeInteger(facturaId) && facturaId > 0) r.facturaId = facturaId
  if (typeof estado === 'string') r.estado = estado
  if (texto(mensaje) !== undefined) r.mensaje = mensaje as string
  if (Array.isArray(motivos)) r.motivos = motivos.filter((m): m is string => typeof m === 'string')
  return r
}

/** El registro de envío de este usuario, o null si no hay o no tiene la forma de uno. */
export function leerEnvio(u: UsuarioClave): EnvioRecord | null {
  return envioDeJson(leerJson<unknown>(claveUsuario(u.tenantId, u.userId, 'envio')))
}

export function guardarEnvio(u: UsuarioClave, r: EnvioRecord): void {
  escribirJson(claveUsuario(u.tenantId, u.userId, 'envio'), r)
}

export function borrarEnvio(u: UsuarioClave): void {
  borrar(claveUsuario(u.tenantId, u.userId, 'envio'))
}

// --- Qué se le dice a la persona --------------------------------------------------------------------------------------------------------

export type Variante = 'enviando' | 'aceptada' | 'enProceso' | 'incierta' | 'rechazada' | 'noEncontrada' | 'noGuardada' | 'comprobando'
export type AccionId = 'verFactura' | 'nueva' | 'verFacturas' | 'verificar' | 'corregir' | 'volverRevisar'
export type TonoResultado = 'ok' | 'info' | 'warning' | 'danger' | 'neutral'

export interface Accion {
  id: AccionId
  etiqueta: string
  primaria?: boolean
}

export interface VistaEnvio {
  variante: Variante
  tono: TonoResultado
  titulo: string
  /** El e-NCF, el cliente y el total, para la tarjeta. */
  datos: string[]
  /** Lo que se explica, una frase por línea. */
  lineas: string[]
  /** Los motivos de la DGII de un rechazo, tal cual. */
  motivos: string[]
  acciones: Accion[]
}

/** La variante de un registro: qué pantalla le toca. Una factura terminada se mira por su estado: aceptada, rechazada o no encontrada. */
export function varianteDe(r: EnvioRecord): Variante {
  switch (r.fase) {
    case 'enviando':
    case 'enProceso':
    case 'incierta':
    case 'noGuardada':
    case 'comprobando':
      return r.fase
    case 'terminada': {
      const kind = clasificarEstado(r.estado ?? '')
      return kind === 'aceptada' || kind === 'rechazada' || kind === 'noEncontrada' ? kind : 'incierta'
    }
  }
}

/** Desde cuántos segundos enviando se ofrece «Seguir después», y el primer corte del texto de espera. */
export const SEGUIR_DESPUES_S = 20
const TARDANDO_S = 8

/**
 * Lo que dice y ofrece la pantalla de resultado para un registro. `segundos` es lo que lleva enviando. Las reglas del texto: nunca «Error 502» ni un texto técnico; lo incierto
 * dice siempre «No la vuelvas a emitir» y no ofrece «Nueva factura»; nunca se afirma que un número se usó o no se usó; los motivos de la DGII salen tal cual.
 */
export function vistaDeEnvio(r: EnvioRecord, segundos: number): VistaEnvio {
  const variante = varianteDe(r)
  const datos = [r.eNcf, r.clienteNombre ?? 'Consumidor final', rd(r.total)].filter((d): d is string => d !== undefined)
  const vista = (tono: TonoResultado, titulo: string, lineas: string[], acciones: Accion[], extra: { motivos?: string[]; sinDatos?: boolean } = {}): VistaEnvio => ({
    variante,
    tono,
    titulo,
    datos: extra.sinDatos === true ? [rd(r.total)] : datos,
    lineas,
    motivos: extra.motivos ?? [],
    acciones,
  })
  const verFactura: Accion[] = r.facturaId === undefined ? [] : [{ id: 'verFactura', etiqueta: 'Ver factura' }]
  const verificar: Accion[] = r.facturaId === undefined ? [] : [{ id: 'verificar', etiqueta: 'Verificar ahora' }]
  switch (variante) {
    case 'enviando':
      return vista(
        'info',
        `Emitiendo E${r.tipo}…`,
        [segundos < TARDANDO_S ? 'Firmando y enviando a la DGII' : 'La DGII está tardando. No toques Emitir', 'Si se corta la señal, la factura queda guardada.'],
        segundos >= SEGUIR_DESPUES_S ? [{ id: 'verFacturas', etiqueta: 'Seguir después' }] : [],
        { sinDatos: true },
      )
    case 'aceptada':
      return vista('ok', 'Factura aceptada', [], [{ id: 'verFactura', etiqueta: 'Ver factura', primaria: true }, { id: 'nueva', etiqueta: 'Nueva factura' }, { id: 'verFacturas', etiqueta: 'Ver Facturas' }])
    case 'enProceso':
      return vista('info', 'La DGII la está revisando', ['Puedes seguir trabajando. Verifica o abre la factura para ver cuándo la acepta.'], [
        ...verificar.map((a) => ({ ...a, primaria: true })),
        ...verFactura,
        { id: 'nueva', etiqueta: 'Nueva factura' },
      ])
    case 'incierta':
      return vista('warning', 'Tu factura quedó guardada', ['Esperando a la DGII.', 'No la vuelvas a emitir.', 'No la entregues todavía.'], [
        ...verificar.map((a) => ({ ...a, primaria: true })),
        ...verFactura,
        { id: 'verFacturas', etiqueta: 'Ver Facturas', primaria: verificar.length === 0 },
      ])
    case 'rechazada':
      return vista(
        'danger',
        'La DGII rechazó la factura',
        [r.motivos !== undefined && r.motivos.length > 0 ? 'Motivos de la DGII:' : 'La DGII no dio el motivo.', 'Corrige lo que indica y emítela de nuevo, o abre la factura para ver qué más se puede hacer.'].filter(
          (l) => l !== '',
        ),
        [{ id: 'corregir', etiqueta: 'Corregir y emitir de nuevo', primaria: true }, ...verFactura, { id: 'nueva', etiqueta: 'Nueva factura' }],
        { motivos: r.motivos ?? [] },
      )
    case 'noEncontrada':
      return vista('neutral', TITULO_NO_ENCONTRADO, [TEXTO_NO_ENCONTRADO], [...verFactura.map((a) => ({ ...a, primaria: true })), ...verificar, { id: 'nueva', etiqueta: 'Nueva factura' }])
    case 'noGuardada':
      return vista(
        'warning',
        'No se pudo emitir',
        ['El servidor no guardó la factura.', ...(r.mensaje !== undefined ? [`«${r.mensaje}»`] : []), 'Revisa los datos y vuelve a intentarlo.'],
        [{ id: 'volverRevisar', etiqueta: 'Volver y editar', primaria: true }],
        { sinDatos: true },
      )
    case 'comprobando':
      return vista(
        'warning',
        'No pudimos confirmar si se emitió',
        ['Se cortó la señal mientras emitías. Puede que la factura sí se haya guardado.', 'No la vuelvas a emitir.', 'Búscala en Facturas antes de intentarlo otra vez.'],
        [{ id: 'verFacturas', etiqueta: 'Ver Facturas', primaria: true }],
      )
  }
}

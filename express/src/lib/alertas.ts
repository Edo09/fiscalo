// Lo que Facturas cuenta de un vistazo con solo las estadísticas y los avisos del API: los dos tiles (Hoy y Este mes), los avisos del inicio (por revisar,
// sin confirmar, en proceso y la numeración), la insignia de Facturas en la barra y el punto de Más (anexo 6.2). Son funciones puras sobre lo que llegó
// del API, que entra como `unknown` y se lee con tolerancia: una fila a medias o una lista que no es una lista no tira la pantalla, solo no cuenta.
// «Hoy» se pasa (es el de lib/reloj, el único de la app) y las fechas se cuentan sobre el calendario, así que nada de esto depende de la zona del
// teléfono (Review Focus 5: a las 23:30 el tile Hoy es el del día local, nunca el UTC).
import { contarSinConfirmar } from '@/features/invoices/enVuelo'
import type { Entitlements } from '~/entitlements'
import { rd0 } from '~/lib/dinero'
import { bucketDe } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import { diasHasta } from '~/lib/fechas'
import { num } from '~/lib/filas'
import { estadoNumeracion } from '~/lib/numeracion'
import type { EstadoNumeracion, SecuenciaStats } from '~/lib/numeracion'
import { formatHash } from '~/router'
import type { IconName } from '~/ui/iconos'

/** Un aviso del inicio. */
export interface Alerta {
  /** Estable: la clave de React y de las pruebas. `porRevisar`, `sinConfirmar`, `enProceso`, o `num-{código}` para la numeración (`num-45`). */
  clave: string
  tono: 'danger' | 'warning' | 'info'
  icono: IconName
  texto: string
  /** A dónde lleva tocarlo: el hash de una ruta (`formatHash`). */
  hash: string
}

/** Un tile del inicio: la cifra grande y lo que la acompaña. */
export interface Tile {
  monto: string
  cantidad: string
}

/** Cuántos avisos se ven a la vez; el resto se junta en «+N avisos». */
const MAX_VISIBLES = 2

/** Los estados DGII que son «por revisar»: lo que la DGII rechazó, no encontró o dio error. Lo archivado no cuenta (es un intento que otro comprobante reemplazó). */
const POR_REVISAR: readonly Bucket[] = ['rechazada', 'noEncontrada', 'error']
/** Los estados DGII «en proceso»: enviado y con la DGII todavía revisándolo. */
const EN_PROCESO: readonly Bucket[] = ['enProceso']

// A dónde lleva cada aviso: los de facturas, a la lista filtrada que lo explica; los de numeración, a la pantalla de Numeración.
const HASH_POR_REVISAR = formatHash({ id: 'facturas', estado: 'accion' })
const HASH_PENDIENTES = formatHash({ id: 'facturas', estado: 'pendiente' })
const HASH_NUMERACION = formatHash({ id: 'mas-numeracion' })

/** Lo que se le dice a quien no administra: la numeración la registra el administrador. */
const SUFIJO_NO_ADMIN = ' Avisa al administrador.'

// El lugar de cada aviso en el orden en que se muestran (el menor va primero): por revisar; la numeración en danger (agotada, sin rango, vence pronto: así un
// vencimiento rojo nunca queda detrás de dos avisos menores); sin confirmar; en proceso; y la numeración en aviso (pocos, por vencer).
const LUGAR_POR_REVISAR = 0
const LUGAR_SIN_CONFIRMAR = 4
const LUGAR_EN_PROCESO = 5

/** Los estados de numeración que se avisan, con el tono del aviso y su lugar en el orden. `sinLimite` (pruebas y certificación) y `vigente` no avisan. */
const AVISO_DE_NUMERACION: Partial<Record<EstadoNumeracion, { lugar: number; tono: 'danger' | 'warning' }>> = {
  agotada: { lugar: 1, tono: 'danger' },
  sinRango: { lugar: 2, tono: 'danger' },
  vencePronto: { lugar: 3, tono: 'danger' },
  pocos: { lugar: 6, tono: 'warning' },
  porVencer: { lugar: 7, tono: 'warning' },
}

// --- Leer lo que manda el API -------------------------------------------------------------------------------------------------------------

type Fila = Record<string, unknown>

const esFila = (v: unknown): v is Fila => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Las filas de una lista del API; lo que no es una lista, y los elementos que no son filas, no cuentan. */
const filasDe = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter(esFila) : [])

/** Una fila de `por_estado`: el `estado_dgii` exacto y cuántas facturas tiene. */
interface FilaEstado {
  estado: string
  total: number
}

/** `stats.por_estado` limpio: solo las filas con un estado en texto, y el total como número (PDO lo manda como texto) y nunca negativo. */
function porEstadoDe(v: unknown): FilaEstado[] {
  const salida: FilaEstado[] = []
  for (const fila of filasDe(v)) {
    if (typeof fila.estado === 'string') salida.push({ estado: fila.estado, total: Math.max(0, num(fila.total)) })
  }
  return salida
}

/** La suma de los totales cuyo estado cae en alguno de esos buckets. */
function sumar(filas: readonly FilaEstado[], buckets: readonly Bucket[]): number {
  return filas.filter((f) => buckets.includes(bucketDe(f.estado))).reduce((suma, f) => suma + f.total, 0)
}

/** Cuántas facturas hay por revisar (rechazadas, no encontradas o con error; sin las archivadas), según `por_estado` de las estadísticas. */
export function contarPorRevisar(porEstado: unknown): number {
  return sumar(porEstadoDe(porEstado), POR_REVISAR)
}

/** Cuántas facturas están en proceso con la DGII (ENVIADO, EN_PROCESO y sus RFCE), según `por_estado`. */
export function contarEnProceso(porEstado: unknown): number {
  return sumar(porEstadoDe(porEstado), EN_PROCESO)
}

// --- Los tiles ----------------------------------------------------------------------------------------------------------------------------

/** «1 factura», «2 facturas», «0 facturas». */
const cuantasFacturas = (n: number): string => `${n} ${n === 1 ? 'factura' : 'facturas'}`

/**
 * El tile de una lista de ventas (`ventas_por_dia` o `ventas_por_mes`): la fila cuya `columna` vale `clave`. Con la lista presente y sin esa fila, el día o
 * el mes todavía no vendió y se ve en cero; sin la lista no hay nada que dibujar (null), y el otro tile no depende de este.
 */
function tileDe(filas: unknown, columna: 'dia' | 'mes', clave: string): Tile | null {
  if (!Array.isArray(filas)) return null
  const fila = filasDe(filas).find((f) => f[columna] === clave)
  return { monto: rd0(num(fila?.monto_total)), cantidad: cuantasFacturas(num(fila?.total)) }
}

/**
 * Los tiles Hoy y Este mes: las ventas del día `hoy` (`ventas_por_dia`) y del mes de `hoy` (`ventas_por_mes`, por sus siete primeros caracteres), netas
 * de notas de crédito, tal como las suma el API. `hoy` es la fecha local del teléfono (lib/reloj), no la del servidor ni la UTC.
 */
export function tilesDe(stats: unknown, hoy: string): { hoy: Tile | null; mes: Tile | null } {
  const s: Fila = esFila(stats) ? stats : {}
  return { hoy: tileDe(s.ventas_por_dia, 'dia', hoy), mes: tileDe(s.ventas_por_mes, 'mes', hoy.slice(0, 7)) }
}

// --- Los avisos ---------------------------------------------------------------------------------------------------------------------------

/** Un aviso con su lugar en el orden. */
interface Candidata {
  lugar: number
  alerta: Alerta
}

/** El código de un tipo como lo lista `tipos_ecf` (`45`) a partir del que manda el API (`E45`); null si no es un texto con un código. */
function codigoDe(tipo: unknown): string | null {
  if (typeof tipo !== 'string') return null
  const codigo = tipo.trim().replace(/^E/i, '')
  return codigo === '' ? null : codigo
}

/** Un número o un número en texto tal como lo manda el API; null si no es ninguno de los dos. */
const numeroOTexto = (v: unknown): number | string | null => (typeof v === 'number' || typeof v === 'string' ? v : null)

/** Cuándo vence el rango, dicho desde hoy: `dias` son los días enteros que faltan (0 hoy, 1 mañana, negativo si ya pasó). */
function venceTexto(dias: number): string {
  if (dias > 1) return `el rango vence en ${dias} días`
  if (dias === 1) return 'el rango vence mañana'
  if (dias === 0) return 'el rango vence hoy'
  if (dias === -1) return 'el rango venció ayer'
  return `el rango venció hace ${-dias} días`
}

/** Cuántos números quedan, dicho para el aviso. Sin una cifra que decir (cero, sin dato) se dice «pocos». */
function quedanTexto(restantes: number): string {
  if (restantes === 1) return 'queda 1 número'
  return restantes > 1 ? `quedan ${restantes} números` : 'quedan pocos números'
}

/**
 * El aviso de la numeración de un tipo según su estado, o null si ese estado no avisa. `restantes` son los números que quedan y `dias` los que faltan para
 * el vencimiento (NaN si no hay): solo se leen en los estados que los dicen. Quien no administra lleva al final a quién avisar.
 */
function avisoDeNumeracion(codigo: string, estado: EstadoNumeracion, restantes: number, dias: number, admin: boolean): Candidata | null {
  const aviso = AVISO_DE_NUMERACION[estado]
  if (aviso === undefined) return null
  const tipo = `E${codigo}`
  let texto: string
  if (estado === 'agotada') texto = `${tipo}: sin números disponibles`
  else if (estado === 'sinRango') texto = `${tipo}: sin numeración autorizada`
  else if (estado === 'pocos') texto = `${tipo}: ${quedanTexto(restantes)}`
  else texto = `${tipo}: ${venceTexto(dias)}`
  return {
    lugar: aviso.lugar,
    alerta: { clave: `num-${codigo}`, tono: aviso.tono, icono: 'hash', texto: admin ? texto : texto + SUFIJO_NO_ADMIN, hash: HASH_NUMERACION },
  }
}

/**
 * Los avisos de numeración. Los estados salen de `stats.secuencias` por `estadoNumeracion`, una fila por tipo y solo de los tipos de la cuenta (`tipos_ecf`);
 * `avisos` solo pone el suyo (agotada o pocos, con sus `restantes`) para un tipo que no tiene fila en las estadísticas, nunca contradice a una que está.
 * Una fila repetida de un tipo cuenta una vez.
 */
function avisosDeNumeracion(stats: Fila, avisos: unknown, entitlements: Entitlements, admin: boolean, hoy: string): Candidata[] {
  const tipos = new Set(entitlements.tipos_ecf)
  const vistos = new Set<string>()
  const salida: Candidata[] = []
  const anotar = (c: Candidata | null): void => {
    if (c !== null) salida.push(c)
  }

  for (const fila of filasDe(stats.secuencias)) {
    const codigo = codigoDe(fila.type)
    if (codigo === null || vistos.has(codigo)) continue
    vistos.add(codigo)
    if (!tipos.has(codigo)) continue
    const vencimiento = typeof fila.vencimiento === 'string' ? fila.vencimiento : null
    const secuencia: SecuenciaStats = {
      type: `E${codigo}`,
      total_emitidos: numeroOTexto(fila.total_emitidos) ?? 0,
      restantes: numeroOTexto(fila.restantes),
      vencimiento,
    }
    const estado = estadoNumeracion(secuencia, entitlements.tenant.ambiente, hoy)
    const dias = vencimiento === null ? NaN : diasHasta(vencimiento, hoy)
    anotar(avisoDeNumeracion(codigo, estado, num(fila.restantes), dias, admin))
  }

  for (const fila of filasDe(esFila(avisos) ? avisos.secuencias : undefined)) {
    const codigo = codigoDe(fila.tipo)
    if (codigo === null || vistos.has(codigo)) continue
    vistos.add(codigo)
    if (!tipos.has(codigo)) continue
    const estado: EstadoNumeracion | null = fila.estado === 'agotada' ? 'agotada' : fila.estado === 'pocos' ? 'pocos' : null
    if (estado !== null) anotar(avisoDeNumeracion(codigo, estado, num(fila.restantes), NaN, admin))
  }
  return salida
}

/**
 * Los avisos del inicio, en el orden en que se muestran: por revisar; la numeración en danger (agotada, sin rango, vence pronto); sin confirmar; en
 * proceso; y la numeración en aviso (pocos, por vencer). Se ven los dos primeros y `extra` es cuántos más hay («+N avisos»). Cada uno lleva a donde se
 * resuelve. Los números salen de `stats.por_estado` por el bucket de cada estado (los archivados no cuentan; «sin confirmar» son exactamente los dos
 * estados en vuelo, PENDIENTE_ENVIO y ENVIO_INCIERTO, que es lo que cuenta la app completa).
 */
export function calcularAlertas(e: { stats: unknown; avisos: unknown; entitlements: Entitlements; admin: boolean; hoy: string }): { visibles: Alerta[]; extra: number } {
  const stats: Fila = esFila(e.stats) ? e.stats : {}
  const filas = porEstadoDe(stats.por_estado)
  const candidatas: Candidata[] = []

  const porRevisar = sumar(filas, POR_REVISAR)
  if (porRevisar > 0) {
    candidatas.push({
      lugar: LUGAR_POR_REVISAR,
      alerta: { clave: 'porRevisar', tono: 'danger', icono: 'circle-alert', texto: `${cuantasFacturas(porRevisar)} por revisar`, hash: HASH_POR_REVISAR },
    })
  }
  const sinConfirmar = contarSinConfirmar(filas)
  if (sinConfirmar > 0) {
    candidatas.push({
      lugar: LUGAR_SIN_CONFIRMAR,
      alerta: { clave: 'sinConfirmar', tono: 'warning', icono: 'triangle-alert', texto: `${sinConfirmar} sin confirmar. Ver`, hash: HASH_PENDIENTES },
    })
  }
  const enProceso = sumar(filas, EN_PROCESO)
  if (enProceso > 0) {
    candidatas.push({
      lugar: LUGAR_EN_PROCESO,
      alerta: { clave: 'enProceso', tono: 'info', icono: 'clock', texto: `${enProceso} en proceso con la DGII`, hash: HASH_PENDIENTES },
    })
  }
  candidatas.push(...avisosDeNumeracion(stats, e.avisos, e.entitlements, e.admin, e.hoy))

  // `sort` es estable: a igual lugar quedan en el orden en que llegaron (el de las filas del API).
  const alertas = candidatas.sort((a, b) => a.lugar - b.lugar).map((c) => c.alerta)
  return { visibles: alertas.slice(0, MAX_VISIBLES), extra: Math.max(0, alertas.length - MAX_VISIBLES) }
}

// --- La insignia de Facturas y el punto de Más ----------------------------------------------------------------------------------------------

/**
 * La insignia de la pestaña Facturas: cuántas facturas tienen un aviso (por revisar, sin confirmar y en proceso, las mismas cuentas de los avisos), con el
 * tono `danger` si alguna está por revisar o sin confirmar y `info` si solo hay en proceso. `texto` es lo que se pinta (`9+` desde diez) y `etiqueta` lo que
 * lee un lector de pantalla («Facturas, 2 con alertas»; en singular con una sola). Null si no hay nada que avisar: no se dibuja.
 */
export function badgeFacturas(porEstado: unknown): { n: number; texto: string; tono: 'danger' | 'info'; etiqueta: string } | null {
  const filas = porEstadoDe(porEstado)
  const urgentes = sumar(filas, POR_REVISAR) + contarSinConfirmar(filas)
  const n = urgentes + sumar(filas, EN_PROCESO)
  if (n === 0) return null
  return { n, texto: n > 9 ? '9+' : String(n), tono: urgentes > 0 ? 'danger' : 'info', etiqueta: `Facturas, ${n} con ${n === 1 ? 'alerta' : 'alertas'}` }
}

/**
 * ¿Lleva punto la pestaña Más? Sí si hay una versión nueva de la app (la ve cualquiera). Y para quien administra, si algún aviso es de numeración (su
 * `clave` empieza con `num-`) o si el certificado está en mal estado (`certificadoMalo`, que pondrá el plan 09): son cosas que solo el administrador arregla.
 */
export function puntoMas(c: { alertas: Alerta[]; versionNueva: boolean; admin: boolean; certificadoMalo?: boolean }): boolean {
  if (c.versionNueva) return true
  return c.admin && (c.certificadoMalo === true || c.alertas.some((a) => a.clave.startsWith('num-')))
}

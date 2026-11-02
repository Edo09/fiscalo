// Mi empresa y Numeración e-CF: lo que manda el API (GET /api/emisor, GET /api/ncf/rangos y las secuencias de las estadísticas), leído sin fiarse de su forma, y las
// reglas del alta de un rango. Pura: «hoy» se pasa. Nada de esto decide qué puede hacer la cuenta: eso es la guardia de rutas y el API.
import type { Ambiente } from '~/entitlements'
import { diasHasta, fmtFechaISO } from '~/lib/fechas'
import { num } from '~/lib/filas'
import { estadoNumeracion } from '~/lib/numeracion'
import type { EstadoNumeracion, SecuenciaStats } from '~/lib/numeracion'
import { nombreTipo } from '~/lib/tiposEcf'

type Fila = Record<string, unknown>
const esFila = (v: unknown): v is Fila => typeof v === 'object' && v !== null && !Array.isArray(v)
/** El texto de lo que manda el API sin los espacios de los bordes; null si no es texto o queda vacío. */
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
/** El número de lo que manda el API (número o texto de MySQL); null si no hay o no es un número. */
function numONulo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
/** `E45`, `e45` y `45` son el código `45`; cualquier otra cosa, null. */
function codigoDe(v: unknown): string | null {
  const t = texto(v)
  if (t === null) return null
  const c = t.toUpperCase().replace(/^E/, '')
  return /^\d{2}$/.test(c) ? c : null
}

/** Solo los dígitos de un texto. */
export const soloDigitos = (v: string): string => v.replace(/\D/g, '')

/** Un RNC (9 dígitos) como `1-31-25643-2` y una cédula (11) como `001-0000000-0`; lo que no es ni lo uno ni lo otro se deja como llegó. */
export function formatoRnc(v: string | null | undefined): string {
  const d = soloDigitos(v ?? '')
  if (d.length === 9) return `${d.slice(0, 1)}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return (v ?? '').trim()
}

// --- Mi empresa ---------------------------------------------------------------------------------------------------------------

export type EstadoCertificado = 'vigente' | 'por_vencer' | 'vencido' | 'no_configurado' | 'sin_dato'
const ESTADOS_CERTIFICADO: readonly EstadoCertificado[] = ['vigente', 'por_vencer', 'vencido', 'no_configurado', 'sin_dato']
export interface CertificadoVista {
  estado: EstadoCertificado
  vence: string | null
  dias: number | null
}
export interface EmpresaVista {
  rnc: string
  razonSocial: string
  nombreComercial: string | null
  sucursal: string | null
  direccion: string | null
  municipio: string | null
  provincia: string | null
  telefono: string | null
  correo: string | null
  web: string | null
  actividad: string | null
  /** El estado del certificado que manda el API a una cuenta Express; null si no vino (un API anterior). */
  certificado: CertificadoVista | null
}

function certificadoDe(v: unknown): CertificadoVista | null {
  if (!esFila(v)) return null
  const estado = ESTADOS_CERTIFICADO.find((e) => e === v.estado)
  if (estado === undefined) return null
  return { estado, vence: texto(v.vence), dias: numONulo(v.dias) }
}

/** Los datos de la empresa de GET /api/emisor; null si no llegó nada que se pueda mostrar (ni RNC ni razón social). */
export function normalizarEmisor(raw: unknown): EmpresaVista | null {
  if (!esFila(raw)) return null
  const rnc = texto(raw.rnc) ?? ''
  const razonSocial = texto(raw.razon_social) ?? ''
  if (rnc === '' && razonSocial === '') return null
  return {
    rnc,
    razonSocial,
    nombreComercial: texto(raw.nombre_comercial),
    sucursal: texto(raw.sucursal),
    direccion: texto(raw.direccion),
    municipio: texto(raw.municipio),
    provincia: texto(raw.provincia),
    telefono: texto(raw.telefono),
    correo: texto(raw.correo),
    web: texto(raw.website),
    actividad: texto(raw.actividad_economica),
    certificado: certificadoDe(raw.certificado),
  }
}

/** Lo que dice el certificado y su tono; nunca el de «todo bien» ante la duda. */
export function textoCertificado(c: CertificadoVista): { texto: string; tono: 'ok' | 'warning' | 'danger' | 'neutral' } {
  const fecha = c.vence === null ? null : fmtFechaISO(c.vence)
  switch (c.estado) {
    case 'vigente':
      return { texto: fecha === null ? 'Vigente' : `Vigente hasta el ${fecha}`, tono: 'ok' }
    case 'por_vencer': {
      const cuando = c.dias === null ? '' : c.dias <= 0 ? ' Vence hoy.' : c.dias === 1 ? ' Vence mañana.' : ` Faltan ${c.dias} días.`
      return { texto: `Por vencer${fecha === null ? '' : ` el ${fecha}`}.${cuando} Renuévalo con tiempo.`, tono: 'warning' }
    }
    case 'vencido':
      return { texto: `Venció${fecha === null ? '' : ` el ${fecha}`}. Renuévalo para poder emitir.`, tono: 'danger' }
    case 'no_configurado':
      return { texto: 'Sin certificado digital. Escribe a soporte para cargarlo.', tono: 'danger' }
    case 'sin_dato':
      return { texto: 'No sabemos cuándo vence el certificado. Pregunta a soporte.', tono: 'neutral' }
  }
}

// --- Numeración ---------------------------------------------------------------------------------------------------------------

export interface RangoVista {
  id: number
  tipo: string
  desde: number
  hasta: number | null
  actual: number
  usados: number
  restantes: number | null
  vence: string | null
  estado: string
  noAutorizacion: string | null
}

/** Un rango de GET /api/ncf/rangos; null si no tiene un tipo que se entienda. */
export function normalizarRango(raw: unknown): RangoVista | null {
  if (!esFila(raw)) return null
  const tipo = codigoDe(raw.type)
  if (tipo === null) return null
  const hasta = numONulo(raw.numero_hasta)
  const actual = num(raw.current_value)
  return {
    id: num(raw.id),
    tipo,
    desde: num(raw.numero_desde),
    hasta,
    actual,
    usados: num(raw.usados),
    restantes: numONulo(raw.restantes) ?? (hasta === null ? null : Math.max(0, hasta - actual)),
    vence: texto(raw.fecha_vencimiento),
    estado: texto(raw.estado) ?? '',
    noAutorizacion: texto(raw.no_autorizacion),
  }
}

export interface TarjetaNumeracion {
  tipo: string
  nombre: string
  estado: EstadoNumeracion
  /** La frase corta del estado. */
  resumen: string
  /** Cuántos quedan y cuándo vence lo que queda, si se sabe. */
  detalle: string | null
  rangos: RangoVista[]
}

const RESUMEN: Record<EstadoNumeracion, string> = {
  agotada: 'Se acabaron los números',
  sinRango: 'Sin rango autorizado',
  sinLimite: 'Sin límite registrado',
  vencePronto: 'Vence pronto',
  pocos: 'Quedan pocos números',
  porVencer: 'Por vencer',
  vigente: 'Vigente',
}

const nombreDelTipo = (codigo: string): string => `E${codigo} ${nombreTipo(codigo)}`

/**
 * Una tarjeta por cada tipo de la cuenta, en el orden de `tipos`: el estado sale de `estadoNumeracion` con la fila del tipo en `secuencias` (GET /api/facturas/stats, `secuencias`;
 * sin fila, el tipo no ha emitido y no tiene límite conocido) y los rangos son los de ese tipo, el que vence primero arriba.
 */
export function tarjetasNumeracion(e: { tipos: readonly string[]; ambiente: Ambiente; secuencias: unknown; rangos: unknown; hoy: string }): TarjetaNumeracion[] {
  const filas = Array.isArray(e.secuencias) ? e.secuencias.filter(esFila) : []
  const rangos = (Array.isArray(e.rangos) ? e.rangos : []).map(normalizarRango).filter((r): r is RangoVista => r !== null)
  return e.tipos.map((tipo) => {
    const fila = filas.find((f) => codigoDe(f.type) === tipo)
    const secuencia: SecuenciaStats = {
      type: `E${tipo}`,
      total_emitidos: numONulo(fila?.total_emitidos) ?? 0,
      restantes: numONulo(fila?.restantes),
      vencimiento: texto(fila?.vencimiento),
    }
    const estado = estadoNumeracion(secuencia, e.ambiente, e.hoy)
    const quedan = numONulo(secuencia.restantes)
    const vence = texto(secuencia.vencimiento)
    const partes: string[] = []
    if (quedan !== null) partes.push(`Quedan ${quedan.toLocaleString('en-US')}`)
    if (vence !== null && !Number.isNaN(diasHasta(vence, e.hoy))) partes.push(`vence el ${fmtFechaISO(vence)}`)
    const delTipo = rangos.filter((r) => r.tipo === tipo).sort((a, b) => (a.vence ?? '9999-99-99').localeCompare(b.vence ?? '9999-99-99'))
    return { tipo, nombre: nombreDelTipo(tipo), estado, resumen: RESUMEN[estado], detalle: partes.length === 0 ? null : partes.join(' · '), rangos: delTipo }
  })
}

// --- Registrar un rango ---------------------------------------------------------------------------------------------------------

export interface FormRango {
  tipo: string
  desde: string
  hasta: string
  /** `YYYY-MM-DD`. */
  vence: string
  noSolicitud: string
  noAutorizacion: string
}
export type ErroresRango = Partial<Record<'tipo' | 'desde' | 'hasta' | 'vence' | 'noAutorizacion', string>>

/** Un entero positivo escrito por una persona (con o sin separadores de miles); null si no lo es. */
export function enteroPositivo(v: string): number | null {
  const d = v.replace(/[\s,.]/g, '')
  if (!/^\d+$/.test(d)) return null
  const n = Number(d)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/**
 * Lo que está mal en el formulario del rango, por campo (vacío si todo está bien). El API vuelve a validar todo; esto evita mandar lo que se sabe que rechazará.
 * En producción (`ecf`) la DGII da un número de autorización con el rango, y sin él el comprobante se rechaza: se pide.
 */
export function validarRango(f: FormRango, ctx: { hoy: string; ambiente: Ambiente; tipos: readonly string[] }): ErroresRango {
  const errores: ErroresRango = {}
  if (!ctx.tipos.includes(f.tipo)) errores.tipo = 'Elige el tipo de comprobante.'
  const desde = enteroPositivo(f.desde)
  const hasta = enteroPositivo(f.hasta)
  if (desde === null) errores.desde = 'Escribe el número inicial (un entero mayor que 0).'
  if (hasta === null) errores.hasta = 'Escribe el número final (un entero mayor que 0).'
  else if (desde !== null && hasta < desde) errores.hasta = 'El número final no puede ser menor que el inicial.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vence) || Number.isNaN(diasHasta(f.vence, ctx.hoy))) errores.vence = 'Escribe la fecha de vencimiento.'
  else if (diasHasta(f.vence, ctx.hoy) < 0) errores.vence = 'La fecha de vencimiento no puede ser anterior a hoy.'
  if (ctx.ambiente === 'ecf' && f.noAutorizacion.trim() === '') errores.noAutorizacion = 'Falta el número de autorización de la DGII.'
  return errores
}

/** El cuerpo del POST /api/ncf/rangos con lo que escribió la persona; solo se llama con `validarRango` sin errores. */
export function cuerpoRango(f: FormRango): { type: string; numero_desde: number; numero_hasta: number; fecha_vencimiento: string; no_solicitud?: string; no_autorizacion?: string } {
  return {
    type: `E${f.tipo}`,
    numero_desde: enteroPositivo(f.desde) ?? 0,
    numero_hasta: enteroPositivo(f.hasta) ?? 0,
    fecha_vencimiento: f.vence,
    ...(f.noSolicitud.trim() === '' ? {} : { no_solicitud: f.noSolicitud.trim() }),
    ...(f.noAutorizacion.trim() === '' ? {} : { no_autorizacion: f.noAutorizacion.trim() }),
  }
}

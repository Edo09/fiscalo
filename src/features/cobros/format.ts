// Textos y tonos de Cobros. Sin React: se prueba con scripts/test-cobros.ts.
// Los nombres de mes van escritos a mano (no Intl): la salida no cambia entre navegadores ni con Node.
import type { Cobro, ConfigCobro, EstadoCobro, TenantBuscado } from '@/api'
// Valores por ruta relativa con .ts: scripts/test-cobros.ts carga este archivo con `node` tal cual ('@/…' no existe allí).
import { aCentavos, textoDinero, type MotivoSiguiente } from '../../api/schemas/cobros.ts'
import { etiquetaAmbiente } from '../auth/accesoGlobal.ts'

type BadgeTono = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** El color de cada estado: lo que se debe se ve de un vistazo (rojo = vencido, ámbar = abono, verde = cobrado). */
export const TONO_ESTADO: Record<EstadoCobro, BadgeTono> = {
  Pendiente: 'info',
  Parcial: 'warning',
  Vencido: 'danger',
  Pagado: 'success',
  Cancelado: 'neutral',
}

const mesDe = (periodo: string): [number, number] | null => {
  const m = /^(\d{4})-(\d{2})/.exec(periodo)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** '2026-11' -> 'Nov 2026'. */
export function periodoCorto(periodo: string): string {
  const p = mesDe(periodo)
  if (!p || p[1] < 1 || p[1] > 12) return periodo
  return `${MESES_CORTOS[p[1] - 1][0].toUpperCase()}${MESES_CORTOS[p[1] - 1].slice(1)} ${p[0]}`
}

/** '2026-11' -> 'noviembre 2026'. */
export function periodoLargo(periodo: string): string {
  const p = mesDe(periodo)
  if (!p || p[1] < 1 || p[1] > 12) return periodo
  return `${MESES_LARGOS[p[1] - 1]} ${p[0]}`
}

/** '2026-11-16' -> '16 nov 2026'. */
export function fechaCorta(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return fecha
  return `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]} ${m[1]}`
}

/** '2026-11-16 09:30:00' -> '16 nov 2026 · 09:30'. */
export function fechaHoraCorta(fechaHora: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(fechaHora)
  return m ? `${fechaCorta(m[1])} · ${m[2]}` : fechaCorta(fechaHora)
}

/** El periodo que sigue: '2026-11' -> '2026-12', '2026-12' -> '2027-01'. */
export function periodoSiguiente(periodo: string): string {
  const p = mesDe(periodo)
  if (!p) return periodo
  return p[1] >= 12 ? `${String(p[0] + 1).padStart(4, '0')}-01` : `${String(p[0]).padStart(4, '0')}-${String(p[1] + 1).padStart(2, '0')}`
}

/** Cuántos días tiene el mes de un periodo ('2026-02' -> 28). */
export function diasDelMes(periodo: string): number {
  const p = mesDe(periodo)
  return p ? new Date(Date.UTC(p[0], p[1], 0)).getUTCDate() : 31
}

/**
 * El vencimiento de un periodo para el día configurado de un cliente: un día que el mes no tiene (31 en abril,
 * 30 en febrero) cae en el último día de ese mes. Es la MISMA regla del servidor (CobroReglas::vencimientoDe):
 * aquí solo sirve para mostrar la fecha antes de guardar; el servidor valida la que se envía.
 */
export function vencimientoDe(periodo: string, dia: number): string {
  return `${periodo}-${String(Math.max(1, Math.min(dia, diasDelMes(periodo)))).padStart(2, '0')}`
}

/** 1 -> '1 día', 5 -> '5 días'. */
export function diasTexto(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`
}

/**
 * Lo que se dice del vencimiento de un cobro abierto: 'Vence hoy', 'Vence mañana', 'Vence en 3 días' o
 * 'Vencido hace 16 días'. null si ya no hay nada que decir (pagado o cancelado).
 */
export function textoVencimiento(c: Pick<Cobro, 'estado' | 'dias_atraso' | 'dias_para_vencer'>): string | null {
  if (c.estado === 'Vencido') return `Vencido hace ${diasTexto(c.dias_atraso)}`
  if (c.estado === 'Pagado' || c.estado === 'Cancelado' || c.dias_para_vencer === null) return null
  if (c.dias_para_vencer === 0) return 'Vence hoy'
  if (c.dias_para_vencer === 1) return 'Vence mañana'
  return `Vence en ${diasTexto(c.dias_para_vencer)}`
}

/**
 * La frase que dice qué pasó con el cobro del mes siguiente cuando un pago (o un cambio) dejó un cobro pagado:
 * se generó (y si ya nació vencido, que se avise), o por qué no (sin cobro mensual, desactivado, ya existía).
 * null si no hay nada que decir.
 */
export function textoSiguiente(
  motivo: MotivoSiguiente | null,
  siguiente: Pick<Cobro, 'periodo' | 'monto' | 'fecha_vencimiento' | 'estado'> | null,
): string | null {
  switch (motivo) {
    case 'generado':
      if (!siguiente) return null
      return `Se generó el cobro de ${periodoLargo(siguiente.periodo)} por ${textoDinero(aCentavos(siguiente.monto))}, `
        + (siguiente.estado === 'Vencido'
          ? `que ya está vencido (venció el ${fechaCorta(siguiente.fecha_vencimiento)}).`
          : `vence el ${fechaCorta(siguiente.fecha_vencimiento)}.`)
    case 'sin_config':
      return 'No se generó el cobro del mes siguiente: este cliente no tiene cobro mensual configurado.'
    case 'inactivo':
      return 'No se generó el cobro del mes siguiente: el cobro mensual de este cliente está desactivado.'
    case 'ya_existia':
      return siguiente
        ? `El cobro de ${periodoLargo(siguiente.periodo)} ya existía, así que no se creó otro.`
        : 'El cobro del mes siguiente ya existía, así que no se creó otro.'
    default:
      return null
  }
}

/** 'Ago 2026, Sep 2026 y 1 más': los periodos (sin repetir, del más viejo al más nuevo) con un tope de nombres. */
export function resumenPeriodos(periodos: string[], max = 3): string {
  const unicos = [...new Set(periodos)].sort()
  if (unicos.length <= max) return unicos.map(periodoCorto).join(', ')
  return `${unicos.slice(0, max).map(periodoCorto).join(', ')} y ${unicos.length - max} más`
}

/** 'cobro' o 'cobros' según la cantidad: 1 cobro, 3 cobros. */
export function cobrosTexto(n: number): string {
  return `${n} ${n === 1 ? 'cobro' : 'cobros'}`
}

/** ¿Se le puede registrar un pago (o un recordatorio)? Solo a lo que tiene saldo y no está cancelado. */
export function admitePago(c: Pick<Cobro, 'estado'>): boolean {
  return c.estado === 'Pendiente' || c.estado === 'Parcial' || c.estado === 'Vencido'
}

/** El concepto de un cobro para mostrarlo: su descripción, o "Cobro mensual" si no tiene. */
export function conceptoCobro(c: Pick<Cobro, 'descripcion'>): string {
  return c.descripcion?.trim() ? c.descripcion : 'Cobro mensual'
}

/** El color de cada tramo de antigüedad (de lo vigente a lo muy atrasado). */
export const COLOR_TRAMO: Record<string, string> = {
  vigente: 'var(--success)',
  '1-30': 'var(--info)',
  '31-60': 'var(--warning)',
  '61-90': 'var(--danger)',
  '90+': 'var(--danger)',
}

/**
 * Lo que distingue a un tenant en una lista (sin su cobro): el RNC y, solo si sale de lo normal, que es de integración
 * (sin base propia), que está en certificación o pruebas, o que está dada de baja. Una empresa de producción con base propia
 * lleva solo el RNC.
 */
export function subtituloTenant(t: Pick<TenantBuscado, 'rnc' | 'tipo' | 'ambiente' | 'activo'>): string {
  return [
    t.rnc ? `RNC ${t.rnc}` : 'sin RNC',
    t.tipo === 'integracion' ? 'Integración' : null,
    etiquetaAmbiente(t.ambiente),
    t.activo ? null : 'Inactiva',
  ].filter(Boolean).join(' · ')
}

/** Por qué una unidad no se cobra, en una frase corta; null si se cobra. La marca lleva su motivo ("No es cliente · Es de prueba"). */
export function etiquetaOculta(t: Pick<TenantBuscado, 'motivo_oculto' | 'motivo_exclusion'>): string | null {
  if (t.motivo_oculto === 'solo_certificacion') return 'Solo certificación'
  if (t.motivo_oculto === 'excluido') return t.motivo_exclusion ? `No es cliente · ${t.motivo_exclusion}` : 'No es cliente'
  return null
}

/** El rótulo de un grupo de empresas ("Grupo · 3 empresas": la cabeza y sus hermanas); null si la unidad no tiene grupo. */
export function textoGrupo(t: Pick<TenantBuscado, 'grupo'>): string | null {
  if (t.grupo === null) return null
  const n = t.grupo.miembros.length + 1
  return `Grupo · ${n} ${n === 1 ? 'empresa' : 'empresas'}`
}

/** La línea de detalle de un tenant en el buscador de los formularios: su subtítulo y si ya tiene su cobro mensual configurado. */
export function detalleTenant(t: Pick<TenantBuscado, 'rnc' | 'tipo' | 'ambiente' | 'activo' | 'con_config'>): string {
  return [subtituloTenant(t), t.con_config ? 'Cobro mensual configurado' : null].filter(Boolean).join(' · ')
}

/** La segunda línea del cobro mensual de un tenant en la lista: "día 31 · activo" o "día 10 · inactivo". */
export function detalleCobroMensual(c: Pick<ConfigCobro, 'dia_vencimiento' | 'activo'>): string {
  return `día ${c.dia_vencimiento} · ${c.activo ? 'activo' : 'inactivo'}`
}

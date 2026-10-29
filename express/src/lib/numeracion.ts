// El estado de la numeración de un tipo de comprobante (anexo 6.12, D20): cuántos números quedan y cuándo vence lo que queda, resumido en uno de siete
// estados. Es la misma función para la insignia de Más, el aviso de Facturas, el texto del botón de Revisar y las tarjetas de Numeración. Pura: «hoy» se
// pasa, y los días se cuentan con `diasHasta` (días enteros del calendario), así que el resultado no depende de la zona del teléfono.
import type { Ambiente } from '~/entitlements'
import { diasHasta } from '~/lib/fechas'

export type EstadoNumeracion = 'agotada' | 'sinRango' | 'sinLimite' | 'vencePronto' | 'pocos' | 'porVencer' | 'vigente'

/**
 * Una fila de `stats.secuencias` (GET /api/facturas?stats=). `restantes` suma lo que queda en los rangos con límite que no han vencido, y es null si no hay
 * ninguno; `vencimiento` es el del rango que vence primero. PDO manda los números como texto.
 */
export interface SecuenciaStats {
  type: string
  total_emitidos: number | string
  restantes?: number | string | null
  vencimiento?: string | null
}

/** Un rango autorizado (GET /api/ncf/rangos): `current_value` es el último número asignado, y `numero_hasta` null es un rango sin límite. */
export interface RangoNcf {
  id: number
  type: string
  numero_desde: number | string
  numero_hasta: number | string | null
  current_value: number | string
  fecha_vencimiento?: string | null
}

/** Con 50 números o menos ya se avisa: es el AVISO_SECUENCIA_POCOS del API (facturaModel.php). */
const POCOS = 50
/** Días que faltan para el vencimiento, incluido el de hoy y lo ya vencido: hasta 7 es urgente (rojo) y hasta 30 es un aviso (ámbar). */
const DIAS_VENCE_PRONTO = 7
const DIAS_POR_VENCER = 30

/** El número de lo que manda el API (número o texto); null si no hay o no es un número: ausente, vacío o texto que no lo es. */
function numeroONulo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Cuántos números quedan, o null si no se sabe de un límite. Sin rango es el `restantes` de la secuencia; con rango, su límite menos el último número
 * asignado (null si el rango no tiene límite o si alguno de los dos no se lee). Nunca es negativo: pasarse del límite es estar agotado.
 */
function restantesDe(secuencia: SecuenciaStats, rango: RangoNcf | undefined): number | null {
  if (rango === undefined) {
    const restantes = numeroONulo(secuencia.restantes)
    return restantes === null ? null : Math.max(0, restantes)
  }
  const hasta = numeroONulo(rango.numero_hasta)
  const asignado = numeroONulo(rango.current_value)
  return hasta === null || asignado === null ? null : Math.max(0, hasta - asignado)
}

/**
 * El estado de la numeración de un tipo; gana la primera regla que coincide:
 *  1. agotada: no queda ningún número y el tipo ya emitió alguno (con cero emitidos un rango en cero no es «agotada»: sigue de largo).
 *  2. sinRango o sinLimite: no hay límite registrado. En producción (`ecf`) es sin rango; en pruebas y certificación es sin límite, y no es un problema.
 *  3. vencePronto: el vencimiento está a 7 días o menos (los 7 incluidos), también si ya pasó.
 *  4. pocos: quedan 50 o menos.
 *  5. porVencer: el vencimiento está a 30 días o menos.
 *  6. vigente.
 * Con `rango` (el detalle de un rango, para el administrador) lo que queda es el de ese rango y el vencimiento también: el de la secuencia es el del rango
 * que vence primero, que puede ser otro. Un vencimiento que no es una fecha del calendario no cuenta.
 */
export function estadoNumeracion(secuencia: SecuenciaStats, ambiente: Ambiente, hoy: string, rango?: RangoNcf): EstadoNumeracion {
  const restantes = restantesDe(secuencia, rango)
  const emitidos = numeroONulo(secuencia.total_emitidos) ?? 0
  if (restantes === 0 && emitidos > 0) return 'agotada'
  if (restantes === null) return ambiente === 'ecf' ? 'sinRango' : 'sinLimite'
  const vencimiento = rango === undefined ? secuencia.vencimiento : rango.fecha_vencimiento
  // NaN (sin vencimiento, o uno que no es una fecha) no es menor que nada: las reglas de fecha no coinciden.
  const dias = typeof vencimiento === 'string' ? diasHasta(vencimiento, hoy) : NaN
  if (dias <= DIAS_VENCE_PRONTO) return 'vencePronto'
  if (restantes <= POCOS) return 'pocos'
  if (dias <= DIAS_POR_VENCER) return 'porVencer'
  return 'vigente'
}

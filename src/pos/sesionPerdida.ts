// Por qué el POS deja la venta cuando el servidor ya no reconoce la sesión del empleado
// (api-gratex docs/api/pos.md: SESION_REQUERIDA y GET /api/pos/estado). Lógica pura, aparte de
// VentaView y PosApp, para probarla sin navegador (scripts/test-pos-sesion-perdida.ts).
//
// Casi siempre es un bloqueo (de pantalla, por inactividad, o la sesión vencida): se vuelve al teclado
// del PIN. Pero si un administrador le restableció el PIN a un usuario de FiscalPoint que estaba dentro,
// ya no tiene PIN que escribir: el servidor lo avisa (`pin_restablecido`) y el POS lo lleva directo a
// crear otro con su usuario, con el motivo a la vista (A5b).
import type { EstadoPos } from './api'

export type MotivoSesion =
  /** La sesión se cerró (bloqueo, venció, la cerraron): al teclado del PIN. */
  | 'bloqueo'
  /** Un administrador le restableció el PIN: directo a crear uno nuevo con su usuario. */
  | 'pin-restablecido'

/** Lo que ve la persona al llegar a crear su PIN después de un restablecimiento. */
export const AVISO_PIN_RESTABLECIDO = 'Un administrador restableció tu PIN. Entra con tu usuario para crear uno nuevo.'

/**
 * El motivo de un error SESION_REQUERIDA, según el campo extra del servidor. Sin el campo (un API anterior,
 * o cualquier otra causa) es un bloqueo: lo de siempre.
 */
export function motivoDeError(extra: Record<string, unknown>): MotivoSesion {
  return extra.pin_restablecido === true ? 'pin-restablecido' : 'bloqueo'
}

/** El motivo cuando GET /pos/estado vuelve sin empleado (la sesión que se mandó ya no vale). */
export function motivoDeEstado(r: Pick<EstadoPos, 'pin_restablecido'>): MotivoSesion {
  return r.pin_restablecido === true ? 'pin-restablecido' : 'bloqueo'
}

// «Reenviar a la DGII» en el detalle de una factura (POST /api/facturas/{id}/reenviar):
// qué tarjeta se muestra y si el botón está. Sin React: scripts/test-reenvio.ts lo
// prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual).
import { isRechazo, puedeReenviarEstado } from '../../api/estadosDgii.ts'

/**
 * Qué tarjeta lleva la acción de reenviar:
 *  - 'rechazado': la DGII rechazó el comprobante (tarjeta roja con los motivos);
 *  - 'no_encontrado': la DGII no tiene registro del e-NCF (tarjeta neutra: no es un
 *    rechazo, pero el API lo reenvía igual, con el mismo número);
 *  - null: no hay nada que reenviar ni explicar (aceptado, sin confirmar, archivado…).
 */
export type TarjetaReenvio = 'rechazado' | 'no_encontrado' | null

export function tarjetaReenvio(estadoRaw: string | null | undefined): TarjetaReenvio {
  if (isRechazo(estadoRaw)) return 'rechazado'
  return puedeReenviarEstado(estadoRaw) ? 'no_encontrado' : null
}

/**
 * ¿Se ofrece el botón? Las mismas condiciones que handleReenviar en la API: un
 * estado reenviable (puedeReenviarEstado, rechazado o no encontrado, sin archivar)
 * y la secuencia sin consumir; sin la bandera (null) se trata como sin consumir.
 * Un comprobante sin confirmar nunca se reenvía desde la app.
 */
export function puedeReenviarFactura(estadoRaw: string | null | undefined, secuenciaUtilizada: boolean | null | undefined): boolean {
  return puedeReenviarEstado(estadoRaw) && secuenciaUtilizada !== true
}

export const TITULO_NO_ENCONTRADO = 'La DGII no encontró este comprobante'
export const TEXTO_NO_ENCONTRADO =
  'No tiene registro del e-NCF, así que el número no se consumió. Puedes reenviarlo con el mismo e-NCF.'

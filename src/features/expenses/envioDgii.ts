// Estado del envío a la DGII de un gasto de auto-emisión (E41/E43/E47), dicho
// para quien lo registró.
import type { GastoRow } from '@/api'

/**
 * El gasto llegó a la DGII: tiene e-NCF y número de seguimiento. Sin eso no hay
 * estado que consultar ni XML firmado que descargar, y pedirlos respondía con
 * un error técnico en cuanto se abría el detalle.
 */
export function enviadoADgii(g: Pick<GastoRow, 'track_id' | 'ncf'>): boolean {
  return Boolean(g.track_id) && Boolean(g.ncf)
}

/**
 * Qué pasó con un gasto de auto-emisión que no llegó a la DGII, o null si
 * llegó.
 *
 * El `aviso` solo viene en la respuesta del alta, y el backend lo escribe para
 * el usuario (dice, por ejemplo, que se acabó el rango): si está, manda él.
 * Sin aviso (el gasto se abre desde el listado) se explica por el estado.
 *
 * @param momento 'guardado' = recién registrado (toast); 'detalle' = al abrirlo.
 */
export function avisoNoEnviado(
  g: Pick<GastoRow, 'estado_dgii' | 'track_id' | 'ncf' | 'aviso'>,
  momento: 'guardado' | 'detalle',
): string | null {
  if (enviadoADgii(g)) return null
  if (g.aviso) return g.aviso
  const conError = g.estado_dgii === 'ERROR'
  if (momento === 'guardado') {
    return conError
      ? 'El gasto se guardó, pero no se pudo enviar a la DGII. No lo registres de nuevo: avisa a soporte.'
      : 'El gasto se guardó, pero todavía no se ha enviado a la DGII: queda pendiente de envío.'
  }
  return conError
    ? 'No se pudo enviar este gasto a la DGII, así que no tiene estado ni XML. No lo registres de nuevo: avisa a soporte.'
    : 'Este gasto todavía no se ha enviado a la DGII, así que no tiene estado ni XML.'
}

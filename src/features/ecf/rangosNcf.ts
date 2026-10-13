// Rangos e-NCF autorizados: la regla de "este rango no se puede registrar" que el
// formulario de Rangos revisa antes de enviar. Sin React: scripts/test-rangos-ncf.ts
// la prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { NcfRango } from '@/api'

/**
 * Por qué no se puede registrar este rango con los que ya hay, o null. Es la
 * misma regla del backend (ncfModel::registerRange), calculada con los rangos
 * ya cargados en la tabla para decirlo antes de enviar y con el número exacto.
 *
 * El "Desde" tiene que quedar después de todo lo ya autorizado o usado del
 * tipo. De cada rango existente cuenta su "Hasta" autorizado: un contador que
 * pasó de ahí son números que el POS ya usó fuera de rango (ventas sin rango
 * autorizado, que esperan), y el rango nuevo puede cubrirlos: pedir un "Desde"
 * mayor que ese contador dejaría fuera justo el rango que el aviso de esas
 * ventas manda a registrar. Solo un rango legado sin "Hasta" (NULL) se mide por
 * su contador, porque no tiene otro tope.
 *
 * Excepción: la fila "sin límite" que el sistema siembra al crear la empresa,
 * cuando el rango nuevo empieza donde ella; esa fila se convierte en el rango
 * autorizado y su consumo no cuenta como tope.
 */
export function problemaConExistentes(rangos: NcfRango[], tipo: string, desde: number, hasta: number): string | null {
  const delTipo = rangos.filter((r) => r.type === tipo)
  const sinLimite = [...delTipo].reverse().find((r) => r.numero_hasta == null)
  const convertir = sinLimite != null && Number(sinLimite.numero_desde) === desde
  let tope = 0
  for (const r of delTipo) {
    if (convertir && r.id === sinLimite.id) continue
    tope = Math.max(tope, r.numero_hasta != null ? Number(r.numero_hasta) || 0 : Number(r.current_value) || 0)
  }
  if (desde <= tope) {
    return `El número «Desde» tiene que ser mayor que ${tope}, que es el último ya usado o autorizado para ${tipo}.`
  }
  if (convertir) {
    const usado = Math.max(Number(sinLimite.current_value) || 0, desde - 1)
    if (usado > hasta) {
      return `Ya se usaron números de ${tipo} hasta el ${usado}: el número «Hasta» tiene que ser ${usado} o más.`
    }
  }
  return null
}

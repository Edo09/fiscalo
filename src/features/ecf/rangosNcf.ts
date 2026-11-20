// Rangos e-NCF autorizados: la regla de "este rango no se puede registrar" que el
// formulario de Rangos revisa antes de enviar. Sin React: scripts/test-rangos-ncf.ts
// la prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { NcfRango, UpdateRangoInput } from '@/api'

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

/** Los campos del formulario de edición de un rango, tal como los escribe el usuario (todos texto). */
export interface FormularioEdicion {
  fecha_vencimiento: string
  numero_desde: string
  numero_hasta: string
  no_solicitud: string
  no_autorizacion: string
}

/**
 * Lo que de verdad cambió en el formulario de edición, para enviar solo eso (PUT /api/ncf/rangos/{id}).
 * La fecha se compara como la cadena cruda del API ('2027-12-31'), nunca como la fecha ya formateada.
 * «Desde» no va si el rango ya tiene usados (el servidor tampoco lo deja). Un «No.» vaciado va como ''
 * (borra el dato). Un número vacío o que no es número va como 0 o NaN: problemaConEdicion lo rechaza.
 * `{}` si no cambió nada. Las claves van siempre en este orden.
 */
export function cambiosDelFormulario(rango: NcfRango, form: FormularioEdicion): UpdateRangoInput {
  const cambios: UpdateRangoInput = {}
  if (form.fecha_vencimiento !== (rango.fecha_vencimiento ?? '')) cambios.fecha_vencimiento = form.fecha_vencimiento
  if (Number(rango.usados ?? 0) === 0 && Number(form.numero_desde) !== Number(rango.numero_desde)) {
    cambios.numero_desde = Number(form.numero_desde)
  }
  if (Number(form.numero_hasta) !== Number(rango.numero_hasta)) cambios.numero_hasta = Number(form.numero_hasta)
  if (form.no_solicitud.trim() !== (rango.no_solicitud ?? '').trim()) cambios.no_solicitud = form.no_solicitud.trim()
  if (form.no_autorizacion.trim() !== (rango.no_autorizacion ?? '').trim()) cambios.no_autorizacion = form.no_autorizacion.trim()
  return cambios
}

/**
 * Por qué no se puede guardar este cambio de un rango con los que ya hay, o null. Repite las reglas de
 * ncfModel::updateRange (docs/specs/ncf-rangos-edicion.md, reglas 4 y 5) sobre los rangos ya cargados
 * en la tabla, para avisar antes de enviar. Solo mira el contador: las facturas las ve únicamente el
 * servidor, que decide. El rango anterior es el del mismo tipo con el «Desde» menor más cercano; el
 * siguiente, el del «Desde» mayor más cercano.
 */
export function problemaConEdicion(rangos: NcfRango[], rango: NcfRango, cambios: UpdateRangoInput): string | null {
  const entero = (n: number) => Number.isInteger(n) && n >= 1
  if (cambios.numero_desde !== undefined && !entero(cambios.numero_desde)) {
    return 'El número «Desde» tiene que ser un número entero de 1 o más.'
  }
  if (cambios.numero_hasta !== undefined && !entero(cambios.numero_hasta)) {
    return 'El número «Hasta» tiene que ser un número entero de 1 o más.'
  }
  if (rango.numero_hasta == null) return 'Este tipo no tiene un rango registrado: usa «Registrar rango aprobado».'

  const desdeActual = Number(rango.numero_desde)
  const hastaActual = Number(rango.numero_hasta)
  const desde = cambios.numero_desde ?? desdeActual
  const hasta = cambios.numero_hasta ?? hastaActual
  const usado = Number(rango.current_value) || 0
  const vecinos = rangos.filter((r) => r.type === rango.type && r.id !== rango.id)
  const previo = vecinos
    .filter((r) => Number(r.numero_desde) < desdeActual)
    .sort((a, b) => Number(b.numero_desde) - Number(a.numero_desde))[0]
  const siguiente = vecinos
    .filter((r) => Number(r.numero_desde) > desdeActual)
    .sort((a, b) => Number(a.numero_desde) - Number(b.numero_desde))[0]

  if (cambios.numero_desde !== undefined && desde !== desdeActual) {
    if (usado >= desdeActual) {
      return `Este rango ya tiene números usados (hasta el ${usado}): el número «Desde» no se puede cambiar.`
    }
    if (previo) {
      const tope = previo.numero_hasta != null ? Number(previo.numero_hasta) : Number(previo.current_value) || 0
      if (desde <= tope) {
        return `El número «Desde» tiene que ser mayor que ${tope}, que es el último ya usado o autorizado para ${rango.type} en el rango anterior.`
      }
    }
    if (desde > hasta) return `El número «Desde» (${desde}) no puede ser mayor que el «Hasta» (${hasta}).`
  }
  if (cambios.numero_hasta !== undefined && hasta !== hastaActual) {
    if (hasta < desde) return `El número «Hasta» (${hasta}) no puede ser menor que el «Desde» (${desde}).`
    if (hasta < usado) return `El número «Hasta» no puede ser menor que ${usado}, el último número de ${rango.type} ya usado.`
    if (siguiente && hasta >= Number(siguiente.numero_desde)) {
      const sigHasta = siguiente.numero_hasta != null ? Number(siguiente.numero_hasta) : '∞'
      return `El número «Hasta» tiene que ser menor que ${Number(siguiente.numero_desde)}, donde empieza el siguiente rango (${rango.type} ${Number(siguiente.numero_desde)}–${sigHasta}).`
    }
  }
  return null
}

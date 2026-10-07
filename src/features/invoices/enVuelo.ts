// Factura e-CF en vuelo: guardada y firmada ANTES de enviarla a la DGII y
// todavía sin respuesta (PENDIENTE_ENVIO / ENVIO_INCIERTO). Su e-NCF está
// ocupado: no se emite otra vez; si no se confirma sola, la resuelve soporte.
// Aquí está lo que dicen de ella el listado, el formulario y el detalle. Sin
// React: scripts/test-en-vuelo.ts lo prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra. errores.ts es el
// mismo módulo que http.ts usa y '@/api' re-exporta: `instanceof ApiError`
// reconoce los errores de la API.
import type { Factura } from '@/types/domain'
import { ApiError } from '../../api/errores.ts'
import { dgiiLabel, isEnVuelo } from '../../api/estadosDgii.ts'

/** `data` del 502 "incierto" de POST /api/facturas: la fila que quedó guardada. */
export interface DatosEmisionIncierta {
  factura_id: number
  e_ncf: string
  tipo_ecf: string
  estado_dgii: string
}

/** Cuántas facturas están en vuelo, según `por_estado` de GET /api/facturas/stats. */
export function contarSinConfirmar(porEstado: readonly { estado: string; total: number }[] | null | undefined): number {
  return (porEstado ?? []).filter((e) => isEnVuelo(e.estado)).reduce((a, e) => a + (Number(e.total) || 0), 0)
}

/** Texto del chip del listado que lleva al filtro Pendientes. */
export function textoChipSinConfirmar(n: number): string {
  return n === 1 ? '1 comprobante sin confirmar · Ver' : `${n} comprobantes sin confirmar · Ver`
}

/**
 * Datos de un 502 "incierto": la factura quedó guardada pero no se sabe si la
 * DGII la recibió. null en cualquier otro error. Un 502 sin `data.factura_id`
 * es un fallo antes de enviar (nada quedó guardado) y se trata como siempre.
 */
export function datosEmisionIncierta(e: unknown): DatosEmisionIncierta | null {
  if (!(e instanceof ApiError) || e.status !== 502) return null
  if (e.datos == null || typeof e.datos !== 'object') return null
  const d = e.datos as Record<string, unknown>
  // PDO puede mandar el id como texto ("41").
  const id = Number(d.factura_id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    factura_id: id,
    e_ncf: String(d.e_ncf ?? ''),
    tipo_ecf: String(d.tipo_ecf ?? ''),
    estado_dgii: String(d.estado_dgii ?? ''),
  }
}

/**
 * La Factura con que "Ver factura" abre el detalle tras un 502 incierto: la
 * fila guardada (id, e-NCF, estado) y lo demás del formulario, como la que se
 * arma al emitir bien. Sin fecha (el detalle la trae) ni track ni código de
 * seguridad (la DGII no respondió).
 */
export function facturaEmisionIncierta(
  d: DatosEmisionIncierta,
  form: Pick<Factura, 'cliente' | 'clienteId' | 'rnc' | 'subtotal' | 'itbis' | 'total' | 'metodo'>,
): Factura {
  return {
    id: String(d.factura_id),
    facturaId: d.factura_id,
    ncf: d.e_ncf,
    tipo: d.tipo_ecf,
    cliente: form.cliente,
    clienteId: form.clienteId,
    rnc: form.rnc,
    fecha: '—',
    vence: '—',
    subtotal: form.subtotal,
    itbis: form.itbis,
    total: form.total,
    estado: 'Emitida',
    dgii: dgiiLabel(d.estado_dgii),
    metodo: form.metodo,
    trackId: null,
    codigoSeguridad: null,
    estadoDgiiRaw: d.estado_dgii,
  }
}

/** Primera línea de la tarjeta del detalle de una factura en vuelo. */
export function textoTarjetaEnVuelo(eNcf: string): string {
  return `Este comprobante quedó reservado con el e-NCF ${eNcf}, pero la DGII no ha confirmado su recepción.`
}

/** Pie del documento en el detalle. */
export const PIE_DOCUMENTO = 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF'
/** Pie de una factura en vuelo: firmada, pero sin la recepción de la DGII. */
export const PIE_DOCUMENTO_EN_VUELO =
  'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF'

export function textoPieDocumento(estadoRaw: string | null | undefined): string {
  return isEnVuelo(estadoRaw) ? PIE_DOCUMENTO_EN_VUELO : PIE_DOCUMENTO
}

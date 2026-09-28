// Servicio: gastos (módulo de egresos / e-CF de compras).
import { errorDeValidacion, esTecnico, type TextosCampos } from './errores'
import { getJson, postJson, getBlob, getList, qs } from './http'
import { createGastoSchema } from './schemas/gasto'
import type {
  CreateGastoInput,
  GastoListParams,
  GastoRow,
  GastoStatsData,
  ListResult,
} from './types'

export function listGastos(params: GastoListParams = {}): Promise<ListResult<GastoRow>> {
  const query = qs({
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
    categoria: params.categoria,
  })
  return getList<GastoRow>(`/api/gastos${query}`)
}

export function getGasto(id: number): Promise<GastoRow> {
  return getJson<GastoRow>(`/api/gastos${qs({ id })}`)
}

export function getGastoStats(): Promise<GastoStatsData> {
  return getJson<GastoStatsData>('/api/gastos/stats')
}

/** Consulta el estado del e-CF en DGII (solo gastos auto-emitidos). */
export function getGastoEstado(id: number): Promise<GastoRow> {
  return getJson<GastoRow>(`/api/gastos/${id}/estado`)
}

/** XML firmado del e-CF de un gasto auto-emitido. */
export function getGastoXml(id: number): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/gastos/${id}/xml`)
}

/** Texto por campo cuando el esquema no trae uno propio (ver errorDeValidacion). */
const TEXTOS_GASTO: TextosCampos = {
  categoria: 'Elige si es un gasto menor o una factura de proveedor.',
  tipo_gasto: 'Elige el tipo de comprobante.',
  tipo_bienes_servicios: 'Elige el tipo de costo o gasto.',
  rnc_proveedor: 'Revisa el RNC del proveedor.',
  nombre_proveedor: 'Escribe el nombre del proveedor.',
  ncf: 'Revisa el NCF del proveedor.',
  items: 'Agrega al menos una línea con descripción e importe.',
  description: 'Escribe la descripción.',
  amount: 'Escribe un importe válido.',
  quantity: 'Escribe una cantidad válida.',
  unidad_medida: 'Elige la unidad de medida.',
  product_id: 'El producto elegido no es válido. Quítalo y vuelve a agregarlo.',
  indicador_bien_servicio: 'Indica si es un bien o un servicio.',
  fecha: 'La fecha no es válida.',
  subtotal: 'Revisa los importes.',
  itbis: 'Revisa el ITBIS.',
  itbis_amount: 'Revisa el ITBIS.',
  total: 'Revisa los importes.',
  '*linea': 'Revisa los datos de esta línea.',
  '*': 'Hay un dato del gasto que no es válido. Revisa el formulario e inténtalo de nuevo.',
}

/**
 * Aviso del servidor cuando el gasto se guardó pero no se emitió a la DGII.
 * El backend viejo manda aquí la excepción cruda ("Fallo emision DGII: …",
 * "DGII_ECF_EMISSION_ENABLED=false…"), y la pantalla lo muestra en un toast.
 * El detalle técnico ya queda guardado en el gasto (respuesta_dgii).
 */
const AVISO_NO_ENVIADO = 'El gasto se guardó, pero no se envió a la DGII. Revisa su estado en el detalle del gasto.'

export async function createGasto(input: CreateGastoInput): Promise<GastoRow> {
  // Validación de frontera: ningún payload malformado llega al backend. El
  // fallo sale como ApiError con un texto claro (un ZodError no es ApiError).
  const r = createGastoSchema.safeParse(input)
  if (!r.success) throw errorDeValidacion(r.error.issues, TEXTOS_GASTO, { metodo: 'POST', path: '/api/gastos' })
  const g = await postJson<GastoRow>('/api/gastos', r.data)
  if (g && typeof g.aviso === 'string' && esTecnico(g.aviso)) {
    console.warn('[API] aviso técnico reemplazado', { path: '/api/gastos', original: g.aviso })
    return { ...g, aviso: AVISO_NO_ENVIADO }
  }
  return g
}

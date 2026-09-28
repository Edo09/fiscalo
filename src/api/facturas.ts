// Servicio: facturas e-CF.
import { errorDeValidacion, type TextosCampos } from './errores'
import { getJson, postJson, getList, qs } from './http'
import { createFacturaSchema } from './schemas/factura'
import { parametroFormato } from './impresion'
import type {
  CreateFacturaInput,
  CreateFacturaResponse,
  DocBase64,
  EstadoData,
  FormatoImpresion,
  FacturaListParams,
  ReciboDatos,
  FacturaRow,
  FacturaModificableRow,
  ListResult,
} from './types'

export function listFacturas(params: FacturaListParams = {}): Promise<ListResult<FacturaRow>> {
  const query = qs({
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
    estado: params.estado,
    tipo_ecf: params.tipoEcf,
  })
  return getList<FacturaRow>(`/api/facturas${query}`)
}

/**
 * Detalle de una factura. El backend responde `data: [factura]` (array por
 * compatibilidad), enriquecida con `items`, `cliente` y `emisor`.
 */
export async function getFactura(id: number): Promise<FacturaRow | null> {
  const data = await getJson<FacturaRow[] | FacturaRow>(`/api/facturas${qs({ id })}`)
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

/**
 * Facturas del cliente que una nota E33/E34 puede modificar (aceptadas por la
 * DGII, de venta), de la más reciente a la más vieja. `query` filtra por parte
 * del e-NCF.
 */
export function listFacturasModificables(clientId: number, query?: string): Promise<FacturaModificableRow[]> {
  return getJson<FacturaModificableRow[]>(`/api/facturas/modificables${qs({ client_id: clientId, query })}`)
}

/**
 * Qué decirle al usuario por campo cuando el esquema no trae un texto propio
 * (Zod pone el suyo, en inglés). Ver errorDeValidacion.
 */
const TEXTOS_FACTURA: TextosCampos = {
  client_id: 'El cliente elegido no es válido. Búscalo de nuevo en la lista y elígelo.',
  tipo_ecf: 'Elige el tipo de comprobante.',
  items: 'Agrega al menos un producto o servicio.',
  nombre_item: 'Escribe el nombre del producto o servicio.',
  descripcion: 'Revisa la descripción.',
  indicador_facturacion: 'Elige la tasa de ITBIS.',
  indicador_bien_servicio: 'Indica si es un bien o un servicio.',
  cantidad: 'Escribe una cantidad mayor que 0.',
  unidad_medida: 'Elige la unidad de medida.',
  precio_unitario: 'Escribe un precio válido.',
  descuento_monto: 'Revisa el descuento.',
  product_id: 'El producto elegido no es válido. Quítalo y vuelve a agregarlo.',
  fecha_emision: 'La fecha no es válida.',
  tipo_pago: 'Elige la forma de pago.',
  descuento: 'El descuento debe estar entre 0 y 100.',
  comprador: 'Revisa los datos del comprador.',
  informacion_referencia: 'Faltan los datos del comprobante que se modifica.',
  '*linea': 'Revisa los datos de esta línea.',
  '*': 'Hay un dato de la factura que no es válido. Revisa el formulario e inténtalo de nuevo.',
}

export async function createFactura(input: CreateFacturaInput): Promise<CreateFacturaResponse> {
  // Validación de frontera: garantiza que un payload malformado nunca llegue a la
  // DGII, incluso si un futuro llamador omite la validación del formulario. El
  // fallo sale como ApiError con un texto claro: un ZodError no es ApiError, y
  // las pantallas solo mostraban su respaldo genérico ("No se pudo emitir…").
  const r = createFacturaSchema.safeParse(input)
  if (!r.success) throw errorDeValidacion(r.error.issues, TEXTOS_FACTURA, { metodo: 'POST', path: '/api/facturas' })
  return postJson<CreateFacturaResponse>('/api/facturas', r.data)
}

export function previewFactura(
  input: Partial<CreateFacturaInput>,
  formato: FormatoImpresion = 'carta',
): Promise<DocBase64> {
  const f = parametroFormato(formato)
  return postJson<DocBase64>('/api/facturas/preview', { ...input, ...(f ? { formato: f } : {}) })
}

export function getEstado(id: number): Promise<EstadoData> {
  return getJson<EstadoData>(`/api/facturas/${id}/estado`)
}

/**
 * Recibo de tirilla de una factura e-CF como datos, en el ancho de este equipo,
 * para imprimirlo como página web.
 */
export function getReciboFactura(id: number): Promise<ReciboDatos> {
  return getJson<ReciboDatos>(`/api/facturas/${id}/pdf${qs({ format: 'datos', formato: parametroFormato('pos') })}`)
}

export type DocKind = 'pdf' | 'xml' | 'xml-rfce'

export function getDocumentBase64(
  id: number,
  kind: DocKind,
  formato: FormatoImpresion = 'carta',
): Promise<DocBase64> {
  const path =
    kind === 'pdf'
      // `formato` solo aplica al PDF: el XML firmado no tiene papel.
      ? `/api/facturas/${id}/pdf${qs({ format: 'base64', formato: parametroFormato(formato) })}`
      : kind === 'xml-rfce'
        ? `/api/facturas/${id}/xml${qs({ type: 'rfce', format: 'base64' })}`
        : `/api/facturas/${id}/xml${qs({ format: 'base64' })}`
  return getJson<DocBase64>(path)
}

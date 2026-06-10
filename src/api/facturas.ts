// Servicio: facturas e-CF.
import { getJson, postJson, getList, qs } from './http'
import type {
  CreateFacturaInput,
  CreateFacturaResponse,
  DocBase64,
  EstadoData,
  FacturaListParams,
  FacturaRow,
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

export function createFactura(input: CreateFacturaInput): Promise<CreateFacturaResponse> {
  return postJson<CreateFacturaResponse>('/api/facturas', input)
}

export function previewFactura(input: Partial<CreateFacturaInput>): Promise<DocBase64> {
  return postJson<DocBase64>('/api/facturas/preview', input)
}

export function getEstado(id: number): Promise<EstadoData> {
  return getJson<EstadoData>(`/api/facturas/${id}/estado`)
}

export type DocKind = 'pdf' | 'xml' | 'xml-rfce'

export function getDocumentBase64(id: number, kind: DocKind): Promise<DocBase64> {
  const path =
    kind === 'pdf'
      ? `/api/facturas/${id}/pdf${qs({ format: 'base64' })}`
      : kind === 'xml-rfce'
        ? `/api/facturas/${id}/xml${qs({ type: 'rfce', format: 'base64' })}`
        : `/api/facturas/${id}/xml${qs({ format: 'base64' })}`
  return getJson<DocBase64>(path)
}

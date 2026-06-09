// Servicio: facturas e-CF.
import { getJson, postJson, getList, qs } from './http'
import type {
  CreateFacturaInput,
  CreateFacturaResponse,
  DocBase64,
  EstadoData,
  FacturaRow,
  ListParams,
  ListResult,
} from './types'

export function listFacturas(params: ListParams = {}): Promise<ListResult<FacturaRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<FacturaRow>(`/api/facturas${query}`)
}

export function getFactura(id: number): Promise<FacturaRow> {
  return getJson<FacturaRow>(`/api/facturas${qs({ id })}`)
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

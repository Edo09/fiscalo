// Servicio: branding del PDF por tenant (plantilla, color de acento, logo).
// Ver docs/plantillas-factura.md — API /api/branding (token del tenant).
import { getJson, postJson, request } from './http'
import type { BrandingData, DocBase64 } from './types'

export interface BrandingInput {
  template?: string
  /** Hex #RRGGBB; null limpia el acento. */
  accent_color?: string | null
}

export function getBranding(): Promise<BrandingData> {
  return getJson<BrandingData>('/api/branding')
}

export function updateBranding(input: BrandingInput): Promise<unknown> {
  return request('/api/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** Sube el logo del tenant (PNG/JPG real, máx 2 MB en el servidor). */
export function uploadBrandingLogo(file: File): Promise<unknown> {
  const form = new FormData()
  form.append('logo', file)
  // Sin Content-Type explícito: el navegador pone el boundary del multipart.
  return request('/api/branding/logo', { method: 'POST', body: form })
}

/** Borra el logo propio; el PDF vuelve al logo global. */
export function deleteBrandingLogo(): Promise<unknown> {
  return request('/api/branding/logo', { method: 'DELETE' })
}

/** PDF de muestra (base64) con los ajustes dados, sin persistir nada. */
export function previewBranding(input: BrandingInput): Promise<DocBase64> {
  return postJson<DocBase64>('/api/branding/preview', input)
}

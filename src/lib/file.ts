// Utilidades para presentar documentos recibidos en base64.
import type { DocBase64 } from '@/api/types'

function base64ToBlob(content: string, mime: string): Blob {
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

/** Abre un documento base64 en una pestaña nueva (PDF) o lo descarga (XML). */
export function presentDocument(doc: DocBase64, opts: { download?: boolean } = {}): void {
  const blob = base64ToBlob(doc.content, doc.mime_type)
  const url = URL.createObjectURL(blob)
  if (opts.download) {
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename || 'documento'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else {
    window.open(url, '_blank', 'noopener')
  }
  // Libera el objeto URL tras dar tiempo a que el navegador lo use.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Descarga un Blob ya obtenido (p. ej. XML firmado de un gasto). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'documento'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

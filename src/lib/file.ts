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

/**
 * Manda un documento base64 directo al diálogo de impresión.
 *
 * Se carga en un iframe oculto y se imprime desde ahí. Para una tirilla en
 * mostrador, "abrir pestaña → Ctrl+P → volver" son dos pasos de más con el
 * cliente esperando; el diálogo del navegador ya muestra la vista previa, así
 * que no se pierde nada por saltarse la pestaña.
 *
 * Si el navegador no deja imprimir el blob (Safari y algunos bloqueadores
 * niegan `print()` sobre un iframe), cae a abrir el documento: es mejor eso que
 * un botón que aparenta funcionar y no imprime nada.
 *
 * @returns true si se lanzó el diálogo; false si hubo que abrir el documento.
 */
export function printDocument(doc: DocBase64): Promise<boolean> {
  return new Promise((resolve) => {
    const blob = base64ToBlob(doc.content, doc.mime_type)
    const url = URL.createObjectURL(blob)

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    // Fuera de la vista pero NO con display:none ni width:0 — varios
    // navegadores no montan el visor de PDF en un iframe sin caja.
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0',
      width: '1px', height: '1px', opacity: '0', border: '0',
    } satisfies Partial<CSSStyleDeclaration>)

    let resuelto = false
    const limpiar = () => {
      // Quitar el iframe mientras el diálogo sigue abierto cancela la impresión
      // en Chrome, así que se deja puesto un buen rato.
      setTimeout(() => {
        iframe.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    }
    const abrirEnPestana = () => {
      if (resuelto) return
      resuelto = true
      window.open(url, '_blank', 'noopener')
      limpiar()
      resolve(false)
    }

    iframe.onload = () => {
      if (resuelto) return
      try {
        const win = iframe.contentWindow
        if (!win) { abrirEnPestana(); return }
        // Un iframe recién insertado dispara `load` por su `about:blank` inicial,
        // ANTES de que llegue el blob. Sin esta comprobación se imprimía esa
        // hoja en blanco en vez del recibo. Se espera al load del documento real.
        if (!win.location.href.startsWith('blob:')) return
        win.focus()
        win.print()
        resuelto = true
        limpiar()
        resolve(true)
      } catch {
        abrirEnPestana()
      }
    }
    iframe.onerror = abrirEnPestana
    // Si el iframe nunca carga, no dejar la promesa (ni el botón) colgados.
    setTimeout(abrirEnPestana, 5000)

    iframe.src = url
    document.body.appendChild(iframe)
  })
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

// Ver e imprimir en hoja carta una cotización de Ferretería o un conduce YA
// GUARDADOS, como hace la factura simple con la suya: lo que se imprime sale
// siempre del documento guardado, nunca de lo que hay en pantalla.
import { toast } from 'sonner'
import { ApiError } from '@/api'
import type { DocBase64 } from '@/api/types'
import { printDocument } from '@/lib/file'

/** Los textos de un documento, con su género (la cotización, el conduce). */
export interface TextosDocumento {
  ver: string
  /** El navegador no abrió el diálogo de impresión: el PDF quedó abierto en otra pestaña. */
  abierto: string
  noAbre: string
  noImprime: string
  /** Se guardó, pero no se pudo imprimir. */
  guardadoSinImprimir: string
}

export const TEXTOS_COTIZACION: TextosDocumento = {
  ver: 'Ver cotización',
  abierto: 'Cotización abierta: imprímela con Ctrl+P.',
  noAbre: 'No se pudo abrir la cotización.',
  noImprime: 'No se pudo imprimir la cotización.',
  // Guardar vuelve al listado, y ahí está su botón PDF.
  guardadoSinImprimir: 'La cotización se guardó, pero no se pudo imprimir. Imprímela desde el listado.',
}

export const TEXTOS_CONDUCE: TextosDocumento = {
  ver: 'Ver conduce',
  abierto: 'Conduce abierto: imprímelo con Ctrl+P.',
  noAbre: 'No se pudo abrir el conduce.',
  noImprime: 'No se pudo imprimir el conduce.',
  // Guardar deja el conduce en pantalla (con el modal): ahí tiene su Imprimir.
  guardadoSinImprimir: 'El conduce se guardó, pero no se pudo imprimir. Imprímelo desde el conduce o desde el listado.',
}

/** Un documento guardado: cómo pedir su PDF carta y cómo nombrarlo. */
export interface DocumentoGuardado {
  pdf: () => Promise<DocBase64>
  textos: TextosDocumento
}

/**
 * Manda el PDF carta al diálogo de impresión. Avisa con toasts y nunca lanza:
 * quien lo llama ya terminó lo suyo (guardar) y no tiene nada que deshacer.
 *
 * @param error Qué decir si falla. El motivo del servidor va en su propia
 *   línea, como en la factura simple: trae su puntuación.
 */
export async function imprimirGuardado(doc: DocumentoGuardado, error: string): Promise<void> {
  try {
    if (!(await printDocument(await doc.pdf()))) toast.info(doc.textos.abierto)
  } catch (e) {
    toast.error(error, e instanceof ApiError ? { description: e.message } : undefined)
  }
}

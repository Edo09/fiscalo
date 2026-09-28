// Imprime el recibo de tirilla de una factura, en el modo configurado en este
// equipo (Configuración → Impresora de recibos):
//   - 'web': pide los datos del recibo, arma la página y la imprime con el
//     largo exacto del contenido (sin papel en blanco al final).
//   - 'pdf': el PDF de siempre; el largo lo decide el papel del driver.
//
// Solo de facturas guardadas: una tirilla de lo que hay en pantalla parecía una
// venta de verdad sin serlo (ver SimpleInvoiceFormView → guardar).
import { getDocumentBase64, getFacturaSimplePdf, getReciboFactura, getReciboFacturaSimple } from '@/api'
import { printDocument } from '@/lib/file'
import { printHtml } from '@/lib/printHtml'
import { getModoImpresion } from '@/stores/impresora'
import { reciboHtml, SELECTOR_RECIBO } from './reciboHtml'

export type OrigenRecibo =
  | { tipo: 'factura'; id: number }
  | { tipo: 'simple'; id: number }

/** @returns true si se abrió el diálogo de impresión; false si se abrió el recibo en otra pestaña. */
export async function imprimirRecibo(origen: OrigenRecibo): Promise<boolean> {
  if (getModoImpresion() === 'pdf') {
    const doc = origen.tipo === 'factura'
      ? await getDocumentBase64(origen.id, 'pdf', 'pos')
      : await getFacturaSimplePdf(origen.id, 'pos')
    return printDocument(doc)
  }

  const datos = origen.tipo === 'factura'
    ? await getReciboFactura(origen.id)
    : await getReciboFacturaSimple(origen.id)
  return printHtml(reciboHtml(datos), { anchoMm: datos.papel.ancho_mm, selector: SELECTOR_RECIBO })
}

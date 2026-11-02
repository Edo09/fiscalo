// Compartir una factura aceptada desde el teléfono (anexo 6.3): qué hace el botón según lo que el aparato sabe hacer (`decidirCompartir`), el texto del mensaje, el enlace de
// WhatsApp y el mensaje a soporte, y traer y entregar el PDF. El token va en el encabezado, así que el PDF se baja como blob (`getBlob`) y se entrega por una descarga con un
// ancla; nunca con `window.open`, que los teléfonos bloquean fuera del toque.
import { getBlob } from '@/api/http'
import { rd } from '~/lib/dinero'

/**
 * Qué hace el botón de compartir. `navigator.share` hay que llamarlo en el toque, sincrónico y con el archivo ya en la mano: sin el PDF (`tieneBlob` falso) primero se carga, y
 * tras bajarlo el toque ya pasó, así que se descarga. Con el PDF y un aparato que comparte archivos, se comparte; con el PDF y sin eso, se descarga.
 */
export function decidirCompartir(c: { puedeCompartirArchivos: boolean; tieneBlob: boolean }): 'archivo' | 'descargar' | 'cargar' {
  if (!c.tieneBlob) return 'cargar'
  return c.puedeCompartirArchivos ? 'archivo' : 'descargar'
}

/** El texto sin saltos de línea ni espacios de más: lo que se manda por mensaje va en una línea. */
const enUnaLinea = (t: string): string => t.replace(/\s+/g, ' ').trim()

/** `Factura E450000000013 de Constructora Cibao SRL para Min. de Obras Públicas por RD$ 11,800.00`. Sin el nombre de la empresa no queda un hueco: «Factura ... para ... por ...». */
export function textoCompartir(f: { eNcf: string; cliente: string; total: number }, emisor: string): string {
  const de = enUnaLinea(emisor)
  return enUnaLinea(`Factura ${f.eNcf}${de === '' ? '' : ` de ${de}`} para ${f.cliente} por ${rd(f.total)}`)
}

/** El enlace de wa.me con el número solo con dígitos (el + y los separadores se quitan) y el texto codificado; null si el número no tiene ni un dígito: no hay a quién escribirle. */
export function urlWhatsApp(numero: string, texto: string): string | null {
  const digitos = numero.replace(/\D/g, '')
  return digitos === '' ? null : `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}

/** El mensaje a soporte: la empresa, la versión y, si la hay, la factura; nada más. Lo que viene vacío no deja un «Empresa: .» y lo que no se pide (un token) no se cuela. */
export function textoSoporte(d: { empresa: string; build: string; eNcf?: string }): string {
  const partes = [
    'Hola, necesito ayuda con Fiscalpoint Express.',
    ...[
      ['Empresa', d.empresa],
      ['Versión', d.build],
      ['Factura', d.eNcf ?? ''],
    ]
      .map(([etiqueta, valor]) => [etiqueta, enUnaLinea(valor)])
      .filter(([, valor]) => valor !== '')
      .map(([etiqueta, valor]) => `${etiqueta}: ${valor}.`),
  ]
  return partes.join(' ')
}

/** El PDF por su id (GET /api/facturas/{id}/pdf, en streaming: `format=datos` es el recibo, que es otra cosa). El error del API sale tal cual: la pantalla lo muestra y ofrece reintentar. */
export function bajarPdf(id: number): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/facturas/${id}/pdf`)
}

/** El PDF por adelantado, para tenerlo en mano cuando se toque «Compartir». Con el ahorro de datos encendido no baja nada y da null: nadie lo ha pedido todavía. */
export async function prepararPdf(id: number): Promise<{ blob: Blob; filename: string } | null> {
  const conexion = (navigator as Navigator & { connection?: { saveData?: boolean } | null }).connection
  if (conexion?.saveData === true) return null
  return bajarPdf(id)
}

/** Entrega el archivo con un ancla `download` (en el documento antes del toque: algunos navegadores no tocan un ancla suelta) y suelta la URL a los 60 segundos, cuando el navegador ya lo copió. */
export function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const ancla = document.createElement('a')
  ancla.href = url
  ancla.download = filename
  document.body.appendChild(ancla)
  ancla.click()
  ancla.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

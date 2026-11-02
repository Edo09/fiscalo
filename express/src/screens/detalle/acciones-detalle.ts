// Lo que hace cada acción del detalle en esta versión de Express (anexo 6.3): compartir, verificar, avisar a soporte, abrir o descargar el PDF, copiar el e-NCF, ver la factura original, buscar la que
// reemplazó a un intento archivado y reenviar el mismo número. Se registran al importar este módulo (Detalle.tsx lo importa). Duplicar, Anular, «Corregir y emitir de nuevo» y «Reintentar anulación»
// no se registran: `accionesDe` los nombra, y sin manejador la pantalla no los dibuja.
//
// El toque de «Compartir» llama a `navigator.share` ANTES de cualquier `await`: el navegador solo lo deja con el toque vivo, y el archivo ya está a mano (screens/detalle/pdf.ts). Un manejador que falla lanza,
// y Acciones.tsx dice el texto (el de un `ApiError` es del servidor); lo que no es un error de verdad (cerrar la hoja de compartir) no lanza.
import { BUILD_ID, SOPORTE_WHATSAPP } from '~/config'
import { leerEntitlements } from '~/entitlements'
import { bajarPdf, decidirCompartir, descargarBlob, textoCompartir, textoSoporte, urlWhatsApp } from '~/lib/compartir'
import type { FacturaVista } from '~/lib/filas'
import { snapshot } from '~/lib/sesion'
import { navegar } from '~/router'
import { mostrarToast } from '~/ui/Toast'
import { registrarAccionDetalle } from './acciones-registro'
import { guardarPdf, pdfEnMano, puedeCompartirArchivos } from './pdf'
import type { PdfListo } from './pdf'
import { pedirReenvio } from './reenvio'
import { verificarEstado } from './verificar'

/** El nombre de la empresa de la sesión: lo que va en el mensaje de «Compartir» y en el de soporte. Vacío si no se sabe. */
function empresaDeLaSesion(): string {
  return leerEntitlements(snapshot()?.user ?? null)?.tenant.nombre ?? ''
}

/** El e-NCF de la factura, o su número guardado si no tiene (un intento archivado). */
const numeroDe = (f: FacturaVista): string => f.eNcf ?? f.numero

/** El nombre del archivo: el que manda el servidor si es un PDF, y si no el número de la factura. */
function nombreDelPdf(f: FacturaVista, pdf: PdfListo): string {
  if (/\.pdf$/i.test(pdf.filename)) return pdf.filename
  const base = numeroDe(f)
  return `${base === '' ? `factura-${f.id}` : base}.pdf`
}

/** El PDF de la factura: el que ya estaba a mano, o el que se baja ahora (aquí sí, aunque el ahorro de datos haya impedido la precarga: alguien lo pidió). */
async function pdfDe(f: FacturaVista): Promise<PdfListo> {
  const listo = pdfEnMano(f.id)
  if (listo !== undefined) return listo
  const bajado = await bajarPdf(f.id)
  guardarPdf(f.id, bajado)
  return bajado
}

/** ¿Cerró la persona la hoja de compartir? No es un fallo: no hay nada que decir. */
const fueCancelado = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

/** Abre un enlace con un ancla en el toque (un `window.open` fuera del toque lo bloquea el teléfono). */
function abrirEnlace(url: string): void {
  const ancla = document.createElement('a')
  ancla.href = url
  ancla.target = '_blank'
  ancla.rel = 'noopener noreferrer'
  document.body.appendChild(ancla)
  ancla.click()
  ancla.remove()
}

/** Copia el texto: con el portapapeles del navegador y, si no lo hay o lo niega, con un campo escondido y `execCommand`. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // Sin permiso o sin foco: sigue el respaldo.
  }
  try {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.setAttribute('readonly', '')
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    const copiado = document.execCommand('copy')
    campo.remove()
    return copiado
  } catch {
    return false
  }
}

registrarAccionDetalle('compartir', async (f) => {
  const listo = pdfEnMano(f.id)
  const decision = decidirCompartir({ puedeCompartirArchivos: puedeCompartirArchivos(), tieneBlob: listo !== undefined })
  if (decision === 'archivo' && listo !== undefined) {
    const archivo = new File([listo.blob], nombreDelPdf(f, listo), { type: 'application/pdf' })
    try {
      // Sin ningún `await` antes: el toque sigue vivo.
      await navigator.share({ files: [archivo], title: numeroDe(f), text: textoCompartir({ eNcf: numeroDe(f), cliente: f.cliente, total: f.total }, empresaDeLaSesion()) })
    } catch (e) {
      if (fueCancelado(e)) return
      descargarBlob(listo.blob, nombreDelPdf(f, listo)) // el aparato dijo que sí podía y no pudo: al menos se descarga
    }
    return
  }
  if (decision === 'descargar' && listo !== undefined) {
    descargarBlob(listo.blob, nombreDelPdf(f, listo))
    return
  }
  // Sin el PDF en mano ('cargar'): se baja y se descarga; el toque ya pasó, así que no se comparte. La próxima vez ya está a mano.
  const bajado = await pdfDe(f)
  descargarBlob(bajado.blob, nombreDelPdf(f, bajado))
})

registrarAccionDetalle('abrirPdf', async (f) => {
  const pdf = await pdfDe(f)
  descargarBlob(pdf.blob, nombreDelPdf(f, pdf))
})

registrarAccionDetalle('verificar', async (f) => {
  try {
    await verificarEstado(f.id)
  } catch {
    // El texto del fallo ya quedó a la vista en la pantalla (useVerificacion): no se avisa dos veces.
  }
})

registrarAccionDetalle('soporte', (f) => {
  const url = urlWhatsApp(SOPORTE_WHATSAPP, textoSoporte({ empresa: empresaDeLaSesion(), build: BUILD_ID, eNcf: f.eNcf ?? undefined }))
  if (url !== null) abrirEnlace(url)
})

registrarAccionDetalle('copiarNcf', async (f) => {
  const eNcf = f.eNcf ?? ''
  if (eNcf !== '' && (await copiarTexto(eNcf))) mostrarToast('e-NCF copiado', { tipo: 'ok' })
  else mostrarToast('No se pudo copiar el e-NCF.', { tipo: 'error' })
})

registrarAccionDetalle('verOriginal', (f) => {
  const id = f.modifica?.id ?? null
  if (id === null) mostrarToast('La factura original no está en tu cuenta.', { tipo: 'info' })
  else navegar({ id: 'factura', facturaId: id })
})

registrarAccionDetalle('buscarReemplazo', (f) => {
  navegar(f.numero === '' ? { id: 'facturas' } : { id: 'facturas', q: f.numero })
})

registrarAccionDetalle('reenviar', (f) => {
  pedirReenvio(f)
})

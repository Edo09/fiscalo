// El PDF de una factura aceptada, por adelantado (anexo 6.3). `navigator.share` hay que llamarlo en el toque, sincrónico y con el archivo ya en la mano (lib/compartir `decidirCompartir`): por eso, en cuanto la DGII
// aceptó la factura, `usePdfAdelantado` baja el PDF y lo deja a mano; el toque en «Compartir» lo encuentra listo. Solo lo aceptado: lo que no se aceptó no tiene nada que entregar. Con el ahorro de datos
// encendido no se baja nada hasta que alguien lo pide, y un fallo se ofrece reintentar. Los PDF van en la memoria de la página (los tres últimos) y se sueltan cuando termina o cambia la sesión.
import { useEffect, useState } from 'react'
import { prepararPdf } from '~/lib/compartir'
import { escucharSesion } from '~/lib/sesion'

export interface PdfListo {
  blob: Blob
  filename: string
}

/** Cuántos PDF se guardan en la memoria de la página: los blobs pesan, y solo se vuelven a usar al volver a la misma factura. */
const GUARDADOS = 3

const listos = new Map<number, PdfListo>()

/** El PDF de la factura `id` si ya se bajó; undefined si no. */
export function pdfEnMano(id: number): PdfListo | undefined {
  return listos.get(id)
}

/** Guarda el PDF de `id` (el más viejo se suelta si ya hay tres). */
export function guardarPdf(id: number, pdf: PdfListo): void {
  listos.delete(id)
  listos.set(id, pdf)
  while (listos.size > GUARDADOS) {
    const masViejo = listos.keys().next()
    if (masViejo.done === true) break
    listos.delete(masViejo.value)
  }
}

// Lo que se bajó es de la empresa y del usuario que miraban: se suelta con cualquier cambio de sesión.
escucharSesion(() => listos.clear())

let sabeCompartirArchivos: boolean | undefined

/** ¿Este aparato comparte archivos PDF (Web Share con `files`)? Se mide una vez con un archivo de prueba; Safari de escritorio, Firefox y muchos WebView no. */
export function puedeCompartirArchivos(): boolean {
  if (sabeCompartirArchivos !== undefined) return sabeCompartirArchivos
  try {
    const n = navigator as Navigator & { canShare?: (datos: { files: File[] }) => boolean }
    sabeCompartirArchivos =
      typeof n.share === 'function' && typeof n.canShare === 'function' && n.canShare({ files: [new File(['%PDF'], 'factura.pdf', { type: 'application/pdf' })] })
  } catch {
    sabeCompartirArchivos = false
  }
  return sabeCompartirArchivos
}

/** ¿Acepta el aparato compartir ESTE archivo? Antes de llamar a `navigator.share`: puede negar uno por su tipo o su tamaño aunque comparta archivos. */
export function puedeCompartirEste(archivo: File): boolean {
  try {
    const n = navigator as Navigator & { canShare?: (datos: { files: File[] }) => boolean }
    return typeof n.canShare !== 'function' || n.canShare({ files: [archivo] })
  } catch {
    return false
  }
}

export type EstadoPdf = 'ninguno' | 'cargando' | 'listo' | 'fallo'

/** Baja por adelantado el PDF de la factura `id` mientras `activo` (aceptada). `reintentar` vuelve a pedirlo tras un fallo. */
export function usePdfAdelantado(id: number, activo: boolean): { estado: EstadoPdf; reintentar(): void } {
  const [estado, setEstado] = useState<EstadoPdf>(() => (listos.has(id) ? 'listo' : activo ? 'cargando' : 'ninguno'))
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (!activo) return
    if (listos.has(id)) {
      setEstado('listo')
      return
    }
    let vivo = true
    setEstado('cargando')
    prepararPdf(id)
      .then((pdf) => {
        if (!vivo) return
        if (pdf === null) {
          setEstado('ninguno') // ahorro de datos: se baja cuando se toque
          return
        }
        guardarPdf(id, pdf)
        setEstado('listo')
      })
      .catch(() => {
        if (vivo) setEstado('fallo')
      })
    return () => {
      vivo = false
    }
  }, [id, activo, vuelta])

  return { estado: activo ? estado : 'ninguno', reintentar: () => setVuelta((n) => n + 1) }
}

// Foto del producto (api-gratex migración 032): una por producto, guardada en el
// servidor del API (public/uploads/productos/<tenant>/<aleatorio>.<ext>) y servida
// directo por Apache. La usan la lista de productos de app.* y el catálogo del POS.
//
// Antes de subirla se reduce en el navegador: a lo sumo LADO_MAX_FOTO px por lado
// y JPEG. Así pesa decenas de KB (el POS pinta cientos), no choca con el límite de
// subida del cPanel (a veces 2 MB) y se van los datos EXIF del teléfono (GPS).

export const LADO_MAX_FOTO = 800
/** Lo que se acepta elegir: lo que el servidor guarda (sin HEIC, GIF ni SVG). */
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']
const PESO_MAX_ORIGINAL = 30 * 1024 * 1024

/** Solo rutas con la forma que genera el servidor; cualquier otra cosa no se pinta. */
const RUTA_VALIDA = /^public\/uploads\/productos\/[A-Za-z0-9_-]+\/[0-9a-f]{32}\.(jpg|png|webp)$/

/** URL de la foto a partir de la base del API ('' en desarrollo con proxy) y la ruta guardada. */
export function urlFoto(base: string, ruta: string | null | undefined): string | null {
  if (!ruta || !RUTA_VALIDA.test(ruta)) return null
  return `${base.replace(/\/+$/, '')}/api/${ruta}`
}

/** Medidas al reducir: el lado mayor queda en ladoMax (nunca se agranda). */
export function medidasReducidas(ancho: number, alto: number, ladoMax = LADO_MAX_FOTO): { ancho: number; alto: number } {
  const escala = Math.min(1, ladoMax / Math.max(ancho, alto))
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

/**
 * La foto elegida, reducida y en JPEG, lista para subir. Lanza un Error con un
 * texto para el usuario si no es una imagen que se pueda usar.
 */
export async function reducirFoto(archivo: File, ladoMax = LADO_MAX_FOTO): Promise<Blob> {
  if (!TIPOS_FOTO.includes(archivo.type)) throw new Error('Elige una foto JPG, PNG o WebP.')
  if (archivo.size > PESO_MAX_ORIGINAL) throw new Error('La foto pesa demasiado (más de 30 MB). Elige otra.')
  let imagen: ImageBitmap
  try {
    // Respeta la orientación EXIF: la foto vertical del teléfono no sale acostada.
    imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer esa imagen. Elige otra foto.')
  }
  const { ancho, alto } = medidasReducidas(imagen.width, imagen.height, ladoMax)
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  const ctx = lienzo.getContext('2d')
  if (!ctx) { imagen.close(); throw new Error('No se pudo preparar la foto en este navegador.') }
  // JPEG no tiene transparencia: lo transparente de un PNG queda blanco, no negro.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, ancho, alto)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imagen, 0, 0, ancho, alto)
  imagen.close()
  const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, 'image/jpeg', 0.85))
  if (!blob) throw new Error('No se pudo preparar la foto en este navegador.')
  return blob
}

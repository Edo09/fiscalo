// Reglas de los datos de la empresa (Configuración › Datos de empresa).
//
// Son las que aplica el servidor (api-gratex `src/Utils/EmisorEdicion.php`), que a su vez son las del XSD de la DGII:
// lo que se guarda aquí viaja dentro del XML firmado de CADA e-CF, y un valor que el XSD no acepta hace que la DGII
// rechace los comprobantes. Se revisan ANTES de enviar para que el problema salga en el campo y con palabras de quien
// llena el formulario. Si cambian allá, cambian aquí (y al revés).
//
// Módulo puro (sin imports): se puede probar con Node sin levantar nada.

/** Datos que el administrador puede cambiar, en el orden de la pantalla (todo menos el RNC y la razón social). */
export const CAMPOS_EMISOR = [
  'nombre_comercial', 'sucursal', 'direccion', 'provincia', 'municipio',
  'telefono', 'correo', 'website', 'actividad_economica',
] as const

export type CampoEmisor = (typeof CAMPOS_EMISOR)[number]
export type FormEmisor = Record<CampoEmisor, string>

/** Largo máximo en caracteres (XSD: AlfNum150/20/100/50/100 y el correo de 80). */
export const LARGO_EMISOR = {
  nombre_comercial: 150,
  sucursal: 20,
  direccion: 100,
  correo: 80,
  website: 50,
  actividad_economica: 100,
} as const

const ROTULO: Record<keyof typeof LARGO_EMISOR, string> = {
  nombre_comercial: 'El nombre comercial',
  sucursal: 'La sucursal',
  direccion: 'La dirección',
  correo: 'El correo',
  website: 'El sitio web',
  actividad_economica: 'La actividad económica',
}

export const MSG_SIN_DIRECCION = 'Escribe la dirección de tu empresa.'
export const MSG_TELEFONO = 'El teléfono debe tener 10 dígitos, por ejemplo 809-555-1234.'
export const MSG_CORREO = 'El correo no es válido. Revisa que esté completo, por ejemplo nombre@empresa.com.'
export const MSG_WEBSITE_ESPACIOS = 'El sitio web no puede tener espacios.'

/** CorreoValidationType del XSD, tal cual (más estricto que el correo de un cliente). */
const CORREO_XSD = /^\w+(?:[-+.]\w+)*@\w+(?:[-.]\w+)*\.\w+(?:[-.]\w+)*$/

/** Una línea: recorta y junta espacios y saltos en uno solo, como el servidor. */
export const compactar = (v: string): string => v.replace(/\s+/g, ' ').trim()

/**
 * 809-555-1234, venga como venga (8095551234, (809) 555-1234, +1 809 555 1234…).
 * Si no son 10 dígitos devuelve el texto compactado tal cual, y `errorEmisor` lo señala.
 */
export function telefonoNormalizado(v: string): string {
  const t = compactar(v)
  let d = t.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : t
}

/** El valor tal como lo guardará el servidor: sirve para saber si algo cambió y para lo que se envía. */
export function valorEmisor(campo: CampoEmisor, v: string): string {
  return campo === 'telefono' ? telefonoNormalizado(v) : compactar(v)
}

/** Caracteres, no bytes ni unidades UTF-16: una `ñ` cuenta 1, igual que en el servidor y en la columna. */
const largoDe = (v: string): number => [...v].length

function conLargo(campo: keyof typeof LARGO_EMISOR, v: string): string | undefined {
  const max = LARGO_EMISOR[campo]
  return largoDe(v) > max ? `${ROTULO[campo]} no puede pasar de ${max} caracteres.` : undefined
}

/**
 * Qué está mal en un dato (ya pasado por `valorEmisor`), o undefined si vale. Un opcional en blanco vale: queda vacío.
 * La provincia y el municipio salen de un selector del catálogo, así que no se revisan aquí.
 */
export function errorEmisor(campo: CampoEmisor, v: string): string | undefined {
  switch (campo) {
    case 'direccion':
      return v ? conLargo(campo, v) : MSG_SIN_DIRECCION
    case 'nombre_comercial':
    case 'sucursal':
    case 'actividad_economica':
      return conLargo(campo, v)
    case 'website':
      if (!v) return undefined
      return v.includes(' ') ? MSG_WEBSITE_ESPACIOS : conLargo(campo, v)
    case 'correo':
      if (!v) return undefined
      return largoDe(v) > LARGO_EMISOR.correo || !CORREO_XSD.test(v) ? MSG_CORREO : undefined
    case 'telefono':
      if (!v) return undefined
      return /^\d{3}-\d{3}-\d{4}$/.test(v) ? undefined : MSG_TELEFONO
    case 'provincia':
    case 'municipio':
      return undefined
  }
}

/** Lo que dio el servidor (con null donde no hay dato) como el estado del formulario: todo texto, vacío donde no hay. */
export function formDesdeEmisor(e: Partial<Record<CampoEmisor, string | null | undefined>>): FormEmisor {
  return Object.fromEntries(CAMPOS_EMISOR.map((k) => [k, e[k] ?? ''])) as FormEmisor
}

/**
 * Huella de lo guardado: cambia cuando el servidor cambia algún dato (al guardar, o desde otra sesión). El formulario
 * se monta con ella como `key`, así que se reinicia con los datos nuevos en vez de quedarse con los viejos.
 */
export function claveEmisor(e: Partial<Record<CampoEmisor, string | null | undefined>>): string {
  return CAMPOS_EMISOR.map((k) => e[k] ?? '').join('\u0001')
}

/** Qué datos cambiaron respecto a lo guardado, comparando el valor que quedaría (un teléfono sin guiones no es un cambio). */
export function camposCambiados(form: FormEmisor, inicial: FormEmisor): CampoEmisor[] {
  return CAMPOS_EMISOR.filter((k) => valorEmisor(k, form[k]) !== valorEmisor(k, inicial[k]))
}

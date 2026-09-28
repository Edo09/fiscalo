// Reglas de los datos de contacto que comparten clientes y proveedores.
//
// Son las mismas que aplica el backend (clientController, proveedorController y
// el largo de las columnas): se revisan ANTES de enviar para que el problema
// salga en el campo, dicho con palabras de quien llena el formulario, y no como
// el texto del servidor ("Phone number must be no more than 20 characters").

/** Largos máximos de las columnas en la base de datos. */
export const LARGO = {
  nombreCliente: 100,
  empresa: 100,
  razonSocial: 150,
  correo: 100,
  telefono: 20,
  direccion: 100,
  nombreProveedor: 150,
  contactoProveedor: 100,
  direccionProveedor: 150,
} as const

export const soloDigitos = (v: string) => v.replace(/\D/g, '')

/** Mismo texto en todas las pantallas que piden RNC o cédula. */
export const MSG_RNC = 'El RNC debe tener 9 dígitos (empresa) u 11 (cédula).'

/** RNC (9 dígitos) o cédula (11), con o sin guiones. Vacío = sin documento, vale. */
export function errorRnc(valor: string): string | undefined {
  if (!valor.trim()) return undefined
  const n = soloDigitos(valor).length
  return n === 9 || n === 11 ? undefined : MSG_RNC
}

/**
 * Se acerca a FILTER_VALIDATE_EMAIL de PHP, que es el que decide en el backend:
 * sin tildes ni ñ, sin puntos seguidos y con un dominio que lleve punto. El
 * patrón anterior (algo@algo.algo) dejaba pasar correos que el servidor luego
 * rechazaba con un texto en inglés.
 */
const CORREO_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

/** Correo opcional: solo se revisa si se escribió algo. */
export function errorCorreo(valor: string, max: number = LARGO.correo): string | undefined {
  const v = valor.trim()
  if (!v) return undefined
  if (v.length > max) return `El correo no puede pasar de ${max} caracteres.`
  return CORREO_RE.test(v) ? undefined : 'El correo no es válido. Revisa que esté completo, por ejemplo nombre@correo.com.'
}

export function errorTelefono(valor: string): string | undefined {
  return valor.trim().length > LARGO.telefono
    ? `El teléfono no puede pasar de ${LARGO.telefono} caracteres.`
    : undefined
}

/**
 * Texto con tope de largo. `que` es el sujeto de la frase ("La empresa");
 * `siVacio`, el mensaje cuando es obligatorio y quedó en blanco.
 */
export function errorTexto(valor: string, max: number, que: string, siVacio?: string): string | undefined {
  const v = valor.trim()
  if (!v) return siVacio
  return v.length > max ? `${que} no puede pasar de ${max} caracteres.` : undefined
}

/** % de descuento del cliente: vacío cuenta como 0. */
export function errorDescuento(valor: string): string | undefined {
  const v = valor.trim()
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? undefined : 'El descuento debe ser un número entre 0 y 100.'
}

// Lo que el login decide sin tocar la pantalla (anexo 6.1 y 6.14): qué mensaje ve quien se equivoca, dónde se puede iniciar sesión y adónde va la app
// cuando la sesión cambia de manos. Son funciones puras para poder probarlas sin DOM; las usan Login.tsx y App.tsx.
import { ApiError } from '@/api/errores'
import type { Ruta } from '~/router'

/** Lo que se le dice a quien el servidor no deja entrar: no distingue si falló el correo o la contraseña, y la pantalla tampoco. */
const MSG_CREDENCIALES = 'Correo o contraseña incorrectos'
/** Para todo lo que no es un ApiError (un fallo del código, una respuesta rara) y para un ApiError sin texto: nunca el texto de un error de JavaScript. */
const MSG_GENERAL = 'No se pudo iniciar sesión. Inténtalo de nuevo.'

/**
 * El texto que ve quien intenta entrar y no puede. El 401 y el 403 son credenciales equivocadas, con un texto fijo. Cualquier otro ApiError ya trae un
 * texto en español hecho para el usuario (errores.ts: sin red, demasiados intentos, falla del servidor, las dos validaciones del API), y pasa tal cual.
 * Lo demás da el mensaje general.
 */
export function mensajeLogin(e: unknown): string {
  if (!(e instanceof ApiError)) return MSG_GENERAL
  if (e.status === 401 || e.status === 403) return MSG_CREDENCIALES
  return e.message.trim() === '' ? MSG_GENERAL : e.message
}

/** ¿Es el servidor de una vista previa de Vercel (`*.vercel.app`)? Ahí el proxy de /api apunta a producción. */
function esVistaPrevia(hostname: string): boolean {
  // `location.hostname` conserva el punto final de un dominio absoluto (`https://abc.vercel.app./`) y el navegador lo escribe en minúsculas, pero un
  // valor que llegue de otro lado puede traer mayúsculas: sin normalizar, esas formas saltarían la prohibición.
  const host = hostname.toLowerCase().replace(/\.+$/, '')
  // Se compara por el sufijo entero con su punto: `vercel.app.evil.com` y `myvercel.app` no son vistas previas.
  return host === 'vercel.app' || host.endsWith('.vercel.app')
}

/**
 * ¿Se puede iniciar sesión desde `hostname`? En una vista previa de Vercel no, salvo que la bandera de desarrollo valga exactamente `1` (config.ts
 * `CLAVE_PREVIEW`, el valor de localStorage que se lee con `leerTexto`): esas páginas proxian a producción y están para revisar el diseño. En
 * cualquier otro servidor (el dominio de Express, localhost) sí.
 */
export function loginPermitido(hostname: string, flag: string | null): boolean {
  return !esVistaPrevia(hostname) || flag === '1'
}

/**
 * A qué ruta va la app cuando la sesión cambia de manos (los eventos de `escucharSesion`); null si no tiene que moverse.
 *  - `usuarioCambio`: entró otro usuario u otra empresa. Cae siempre en Facturas sin filtros, desde la pantalla que sea: no puede quedarse viendo la
 *    pantalla del usuario anterior, ni su búsqueda.
 *  - `cierreExplicito`: null. El Login se dibuja sobre la ruta de ahora y el hash queda como destino de regreso: quien entre después vuelve ahí.
 * `actual` es lo que ve la app; hoy ninguna de las dos reglas lo mira, y se recibe para que quien llame pase siempre lo mismo.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `actual` no cambia la decisión (ver arriba)
export function rutaTrasEvento(e: 'cierreExplicito' | 'usuarioCambio', _actual: Ruta): Ruta | null {
  return e === 'usuarioCambio' ? { id: 'facturas' } : null
}

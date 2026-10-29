// La regla «Express solo habla con esta máquina» de las herramientas de desarrollo: qué URL cuenta como loopback y adónde manda el
// proxy de /api. La aplican run.mjs (rechaza antes de arrancar nada) y vite.config.ts (el proxy del servidor de desarrollo).
//
// Express se desarrolla únicamente contra el mock (mock-api.mjs). El proxy del .env de la raíz apunta a PRODUCCIÓN, por eso aquí no hay
// ningún modo de apuntar a un servidor real: EXPRESS_ALLOW_PROD no existe a propósito y, si alguien la define, se ignora.

/** Donde escucha el mock y adónde va el proxy de /api mientras no se pida otro destino loopback. */
export const OBJETIVO_MOCK = 'http://127.0.0.1:8787'

// Lo que `URL.hostname` devuelve para esas direcciones (el IPv6 conserva sus corchetes).
const SERVIDORES_LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * ¿Es `url` una URL http o https cuyo servidor es esta misma máquina?
 * Lo decide el servidor que encuentra el analizador de URL y no el texto: `http://127.0.0.1.evil.com`, `http://evil.com/@127.0.0.1` y
 * `http://usuario:clave@evil.com` no son loopback.
 * @param {string} url
 * @returns {boolean}
 */
export function esLoopback(url) {
  let analizada
  try {
    analizada = new URL(url)
  } catch {
    return false // vacía o no es una URL
  }
  return (analizada.protocol === 'http:' || analizada.protocol === 'https:') && SERVIDORES_LOOPBACK.has(analizada.hostname)
}

/**
 * El texto del rechazo. Dice adónde apuntaba el destino, pero solo esquema y servidor: ni usuario, ni ruta, ni query, que pueden llevar
 * credenciales; y si ni siquiera es una URL, no lo repite.
 * @param {string} pedido
 * @returns {string}
 */
function textoDelRechazo(pedido) {
  let apunta = 'EXPRESS_API_TARGET no es una URL'
  try {
    const url = new URL(pedido)
    apunta = `EXPRESS_API_TARGET apunta a ${url.protocol}//${url.host}`
  } catch {
    // no es una URL: se queda el texto de arriba
  }
  return `${apunta}, pero Express en desarrollo solo habla con el mock local: la URL tiene que ser http o https hacia 127.0.0.1, localhost o [::1]. No hay ninguna variable que levante esta regla.`
}

/**
 * El destino del proxy de /api del servidor de desarrollo: el de `EXPRESS_API_TARGET` si está puesto, y si no, el mock. Lanza un Error
 * (en español, con la regla) si ese destino no es loopback. Un valor vacío cuenta como no puesto.
 * @param {Record<string, string | undefined>} env normalmente `process.env`
 * @returns {string}
 */
export function objetivoProxy(env) {
  const pedido = (env.EXPRESS_API_TARGET ?? '').trim()
  if (pedido === '') return OBJETIVO_MOCK
  if (!esLoopback(pedido)) throw new Error(textoDelRechazo(pedido))
  return pedido
}

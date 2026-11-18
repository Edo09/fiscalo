// La clave de idempotencia de un intento de pago: un UUID v4 que genera el formulario al abrirse y que
// viaja con el pago. Si la respuesta se pierde y se repite la petición, el servidor ve la misma clave y
// devuelve el pago ya registrado en vez de registrar otro.
export function nuevaClave(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Sin randomUUID (un navegador viejo o una página sin HTTPS): v4 a partir de getRandomValues.
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

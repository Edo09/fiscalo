// Cada cuánto se le pregunta a la DGII por una factura que no está en un estado final (anexo 12.6): a los 5, 10, 20 y 40 segundos y luego cada 60, hasta unos cinco minutos
// (315 s en total). Cada consulta a `/estado` puede ser hasta tres llamadas a la DGII y guarda su veredicto, así que el retroceso es a propósito: con el tiempo nunca se
// pregunta más seguido. La pantalla (screens/Detalle) cuenta los plazos que ya esperó y pide el siguiente; cuando `siguienteSondeoMs` da null deja de preguntar y escribe
// «Seguimos confirmando. Abre la factura más tarde.». Preguntar solo mientras la pantalla se ve y solo por lo que no es final (`esSondeable`, lib/acciones) es cosa de ella.

/** Los plazos, en milisegundos: el de la posición `n` es lo que se espera después de la consulta `n` (la 0 es la que se hace al abrir la factura). */
export const SONDEO_MS: readonly number[] = Object.freeze([5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000])

/**
 * Cuánto esperar antes de la siguiente consulta, dados los plazos que ya se esperaron: 0 al abrir la factura (el primer plazo, 5 s), 1 después de la primera espera, y así.
 * Null cuando ya no quedan plazos: es hora de dejar de preguntar. Un número negativo vale como 0 y uno con decimales se lee por su parte entera; lo que no es un número
 * (NaN) no hace preguntar.
 */
export function siguienteSondeoMs(intento: number): number | null {
  const posicion = Math.max(0, Math.trunc(intento))
  return posicion < SONDEO_MS.length ? SONDEO_MS[posicion] : null
}

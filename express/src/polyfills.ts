// Shims de lo que le falta al piso de navegadores de la app (Chrome y WebView 90, Safari e iOS 14.5). main.tsx lo importa antes que
// nada: el módulo corre al importarse y no hay que llamar a nada.

/**
 * Pone `AbortSignal.timeout(ms)` si no existe (Chrome 103, Safari 16): un AbortController que aborta un `setTimeout`. No pasa motivo
 * porque `abort(motivo)` es de Chrome 98; el pedido abortado falla con AbortError, que `networkError` (src/api/errores.ts) lee igual
 * que el TimeoutError del nativo. Si ya existe, no lo toca.
 *
 * `g` es el objeto global, y de él salen el `AbortSignal` al que se agrega la función y el `setTimeout` que la dispara: en el
 * navegador es `window`, y las pruebas pasan un `g` propio porque Node no tiene `window`.
 */
export function instalarPolyfills(g: typeof globalThis = globalThis): void {
  if (typeof g.AbortSignal.timeout === 'function') return
  g.AbortSignal.timeout = (ms: number): AbortSignal => {
    const controlador = new g.AbortController()
    g.setTimeout(() => controlador.abort(), ms)
    return controlador.signal
  }
}

instalarPolyfills()

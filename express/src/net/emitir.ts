// La emisión: POST /api/facturas. A diferencia del resto de las llamadas, aquí NO basta con saber si salió bien o mal: la respuesta tiene que llegar con su HTTP y su
// cuerpo también cuando es 422 o 502, porque una factura rechazada o sin confirmar viaja en `data` de ese error (facturaController.php) y decide qué se le dice a la persona.
// `requestEnvelope` (src/api/http.ts) deja pasar el sobre del 200 completo, y en un error lanza un ApiError que conserva el estado, el `codigo` y los `datos`: de ahí sale
// lo que lib/clasificar necesita. Esta función NO lanza nunca y NO reintenta (reenviar a ciegas gastaría otro e-NCF): un error de red o un tiempo agotado es `status: 0`.
//
// El plazo del cliente es de 45 s: el servidor hace un viaje síncrono a la DGII (firma y envío), y pasado ese tiempo la factura puede haberse guardado igual, así que lo
// que sigue es `desconocido` (lib/clasificar) y no «falló». `AbortSignal.timeout` pasa por el shim de `~/polyfills` (Chrome antes del 103 y Safari antes del 16 no lo tienen).
import { ApiError } from '@/api/errores'
import { requestEnvelope } from '@/api/http'
import type { RespuestaEmision } from '~/lib/clasificar'
import { instalarPolyfills } from '~/polyfills'

/** Cuánto espera el cliente la respuesta de la emisión. */
export const PLAZO_EMISION_MS = 45_000

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lo que conserva un ApiError de la respuesta: el HTTP, `codigo`, `datos` y el texto crudo del servidor (`original`, solo si el servidor lo mandó). */
function deApiError(e: ApiError): RespuestaEmision {
  if (e.status === 0) return { status: 0, sobre: false } // la red se cayó o se agotó el tiempo
  const sobre = e.delServidor || e.datos !== undefined || e.codigo !== null
  return { status: e.status, sobre, data: e.datos, error: e.delServidor ? e.original : undefined, codigo: e.codigo }
}

/** Manda la venta. Siempre da una respuesta clasificable; nunca lanza ni repite el envío. */
export async function emitirVenta(payload: object): Promise<RespuestaEmision> {
  instalarPolyfills()
  try {
    const sobre = await requestEnvelope<unknown>('/api/facturas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PLAZO_EMISION_MS),
    })
    return esObjeto(sobre) ? { status: 200, sobre: true, data: sobre.data } : { status: 200, sobre: false }
  } catch (e) {
    return e instanceof ApiError ? deApiError(e) : { status: 0, sobre: false }
  }
}

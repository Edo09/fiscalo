// Reenviar el MISMO número a la DGII (POST /api/facturas/{id}/reenviar, anexo 6.3): solo una factura rechazada (o no encontrada) cuyo número no se consumió (`accionesDe` ya lo decide). El API vuelve a armar la
// factura como estaba y la emite con el mismo e-NCF; el intento anterior queda archivado y la fila nueva trae OTRO id. La respuesta es la de una emisión: un 200 trae `factura_id`, y un rechazo
// nuevo de la DGII (422) o un envío sin confirmar (502) traen la fila nueva en `datos`. En los tres casos se sigue a la fila nueva, que es donde está lo que pasó. Reenviar no se repite solo:
// el API corta el segundo de dos toques seguidos, y esta pantalla no vuelve a mandarlo si el resultado se pierde (la factura se recarga y se ve cómo quedó).
//
// Un almacén en el módulo (como el de verificar.ts) lleva la petición pendiente de confirmar y el envío en curso: `pedirReenvio` lo abre desde el manejador de la acción y
// `ReenviarHost` (la hoja de confirmación) y el aviso «Reenviando» lo leen con `useReenvio`.
import { useSyncExternalStore } from 'react'
import { ApiError } from '@/api/errores'
import { postJson } from '@/api/http'
import { num } from '~/lib/filas'
import type { FacturaVista } from '~/lib/filas'
import { parseHash, navegar } from '~/router'
import { queryClient } from '~/queryClient'
import { mostrarToast } from '~/ui/Toast'

export interface EstadoReenvio {
  /** La factura que se quiere reenviar; null si no hay ninguna. */
  factura: FacturaVista | null
  /** `confirmando`: la hoja pregunta. `enviando`: la petición va en camino. */
  fase: 'cerrada' | 'confirmando' | 'enviando'
}

const CERRADO: EstadoReenvio = { factura: null, fase: 'cerrada' }
let estado: EstadoReenvio = CERRADO
const oyentes = new Set<() => void>()

function cambiar(nuevo: EstadoReenvio): void {
  estado = nuevo
  for (const oyente of [...oyentes]) oyente()
}

const suscribir = (oyente: () => void): (() => void) => {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** La hoja de confirmación de «Reenviar» para `f`. Con un envío en curso no hace nada. */
export function pedirReenvio(f: FacturaVista): void {
  if (estado.fase === 'enviando') return
  cambiar({ factura: f, fase: 'confirmando' })
}

/** Cierra la hoja sin reenviar. */
export function cancelarReenvio(): void {
  if (estado.fase === 'confirmando') cambiar(CERRADO)
}

/** Pasa de la pregunta al envío: la hoja se cierra y `enviarReenvio` sale a la red. Quien lo llama espera a que su atrás aterrice (ui/capas `cuandoAterriceElAtras`). */
export function confirmarReenvio(): void {
  if (estado.fase === 'confirmando' && estado.factura !== null) cambiar({ factura: estado.factura, fase: 'enviando' })
}

export function useReenvio(): EstadoReenvio {
  return useSyncExternalStore(suscribir, () => estado)
}

/** El `factura_id` de lo que contestó el API (un número o un texto de PDO); null si no trae. */
function facturaNuevaDe(datos: unknown): number | null {
  if (typeof datos !== 'object' || datos === null) return null
  const id = num((datos as Record<string, unknown>).factura_id)
  return id > 0 ? id : null
}

/** ¿Sigue abierto el detalle de esta factura? Solo entonces se lleva a la fila nueva: quien ya se fue a otra pantalla no se secuestra. */
function sigueEnElDetalle(id: number): boolean {
  const ruta = parseHash(window.location.hash)
  return ruta.id === 'factura' && ruta.facturaId === id
}

/** Manda el reenvío de la factura en `enviando` y, pase lo que pase, recarga lo que cuelga de ella y sigue a la fila nueva. El texto de un `ApiError` es del servidor y se dice tal cual. */
export async function enviarReenvio(): Promise<void> {
  const f = estado.factura
  if (f === null || estado.fase !== 'enviando') return
  let nueva: number | null = null
  try {
    nueva = facturaNuevaDe(await postJson<unknown>(`/api/facturas/${f.id}/reenviar`, {}))
    mostrarToast('Comprobante reenviado a la DGII', { tipo: 'ok' })
  } catch (e) {
    if (e instanceof ApiError) {
      nueva = facturaNuevaDe(e.datos)
      mostrarToast(e.message, { tipo: 'error' })
    } else {
      console.error('[reenviar]', e)
      mostrarToast('No se pudo reenviar. Revisa la factura antes de intentarlo otra vez.', { tipo: 'error' })
    }
  } finally {
    cambiar(CERRADO)
  }
  void queryClient.invalidateQueries({ queryKey: ['facturas'] })
  void queryClient.invalidateQueries({ queryKey: ['stats'] })
  if (nueva !== null && nueva !== f.id && sigueEnElDetalle(f.id)) navegar({ id: 'factura', facturaId: nueva }, { reemplazar: true })
}

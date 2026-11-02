// «Verificar estado» del detalle (anexo 6.3 y 12.6): le pregunta a la DGII por la factura (GET /api/facturas/{id}/estado, que puede ir hasta tres veces a la DGII y guarda el veredicto) y recarga lo
// que cuelga de ella. Es UNA función para el botón y para el sondeo de la pantalla: una consulta en vuelo por factura (el botón y el sondeo a la vez comparten la misma, no preguntan dos veces)
// y lo que la pantalla necesita saber (si está preguntando, el último error) vive aquí, en un almacén que se lee con `useVerificacion`.
import { useSyncExternalStore } from 'react'
import { ApiError } from '@/api/errores'
import { getEstado } from '~/net/lecturas'
import { queryClient } from '~/queryClient'

export interface EstadoVerificacion {
  preguntando: boolean
  /** El texto del último fallo (el del servidor, tal cual); null si la última consulta salió bien o no hubo ninguna. */
  error: string | null
}

const SIN_ESTADO: EstadoVerificacion = { preguntando: false, error: null }
const estados = new Map<number, EstadoVerificacion>()
const oyentes = new Set<() => void>()
const enVuelo = new Map<number, Promise<void>>()

function poner(id: number, estado: EstadoVerificacion): void {
  estados.set(id, estado)
  for (const oyente of [...oyentes]) oyente()
}

const suscribir = (oyente: () => void): (() => void) => {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** Lo que se le dice a quien usa la app de un fallo: el texto de un `ApiError` es el del servidor ya revisado; de un error de JavaScript no se le enseña nada técnico (queda en la consola). */
function textoDe(e: unknown): string {
  if (e instanceof ApiError) return e.message
  console.error('[verificar]', e)
  return 'No se pudo consultar a la DGII. Inténtalo de nuevo.'
}

/** ¿Fue un fallo de la red (sin respuesta del servidor)? El sondeo no se rinde por uno: la señal puede volver. */
export const esFalloDeRed = (e: unknown): boolean => e instanceof ApiError && e.status === 0

/**
 * Pregunta a la DGII por la factura `id` y, si contesta, recarga la lista, el detalle y las estadísticas (todo cuelga de `['facturas']` y `['stats']`). Con una consulta ya en vuelo devuelve esa. Si falla, deja
 * el texto en el almacén (`useVerificacion`) y vuelve a lanzar el error: quien llama decide si sigue (el sondeo se detiene salvo en un fallo de red).
 */
export function verificarEstado(id: number): Promise<void> {
  const previa = enVuelo.get(id)
  if (previa !== undefined) return previa
  poner(id, { preguntando: true, error: null })
  const consulta = (async (): Promise<void> => {
    try {
      await getEstado(id)
      poner(id, { preguntando: false, error: null })
      void queryClient.invalidateQueries({ queryKey: ['facturas'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
    } catch (e) {
      poner(id, { preguntando: false, error: textoDe(e) })
      throw e
    } finally {
      enVuelo.delete(id)
    }
  })()
  enVuelo.set(id, consulta)
  return consulta
}

/** Olvida lo que quedó de una visita anterior a esta factura (un error viejo), salvo que haya una consulta en curso. */
export function olvidarVerificacion(id: number): void {
  if (estados.get(id)?.preguntando === true) return
  if (estados.delete(id)) for (const oyente of [...oyentes]) oyente()
}

/** Lo que pasa ahora con la verificación de la factura `id`. Es el mismo objeto mientras nada cambie (lo que un `useSyncExternalStore` necesita). */
export const estadoDeVerificacion = (id: number): EstadoVerificacion => estados.get(id) ?? SIN_ESTADO

/** Lo que pasa con la verificación de la factura `id`: si hay una consulta en curso y el texto del último fallo. */
export function useVerificacion(id: number): EstadoVerificacion {
  return useSyncExternalStore(suscribir, () => estadoDeVerificacion(id))
}

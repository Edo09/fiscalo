// La conexión y el regreso a la app. `useEnLinea` es el estado de la red para el banner «sin conexión» y para los botones que necesitan
// red; `useAlVolver` refresca lo que está a la vista cuando el usuario regresa a la app tras un rato. La lógica vive en funciones que
// reciben la ventana o el documento (`crearMonitorEnLinea`, `escucharVuelta`) para poder probarla en Node, que no tiene DOM: los ganchos
// de React son solo el pegamento.
import { useEffect, useRef, useSyncExternalStore } from 'react'

/** Lo que `useSyncExternalStore` pide de una fuente: su valor de ahora y cómo enterarse de que puede haber cambiado. */
export interface MonitorEnLinea {
  /** ¿Hay red? Lo que diga `leer`, que en la app es `navigator.onLine`: el navegador lo cambia antes de emitir el evento. */
  leer(): boolean
  /** Llama a `cb` cada vez que el navegador emite `online` u `offline`. Devuelve la función que deja de avisar. */
  suscribir(cb: () => void): () => void
}

/**
 * Un monitor de la conexión sobre `win` (que solo necesita addEventListener y removeEventListener) y `leer`. Los eventos no cargan el
 * estado: solo avisan de que hay que volver a leerlo. Mientras nadie está suscrito no hay ningún oyente puesto en `win`.
 */
export function crearMonitorEnLinea(win: Pick<Window, 'addEventListener' | 'removeEventListener'>, leer: () => boolean): MonitorEnLinea {
  return {
    leer,
    suscribir(cb) {
      // Una función propia por suscripción: el navegador junta en uno los oyentes repetidos de un mismo evento, y cancelar una
      // suscripción de `cb` no puede dejar sin aviso a otra suscripción de la misma función.
      const avisar = (): void => cb()
      win.addEventListener('online', avisar)
      win.addEventListener('offline', avisar)
      return () => {
        win.removeEventListener('online', avisar)
        win.removeEventListener('offline', avisar)
      }
    },
  }
}

let monitorDeLaVentana: MonitorEnLinea | undefined

/** El monitor de esta ventana, creado al usarlo por primera vez: importar el módulo no toca `window`, y las pruebas (Node) lo importan. */
function monitorGlobal(): MonitorEnLinea {
  if (!monitorDeLaVentana) monitorDeLaVentana = crearMonitorEnLinea(window, () => navigator.onLine)
  return monitorDeLaVentana
}

/**
 * ¿Cree el aparato que tiene red? `navigator.onLine` y sus eventos `online` y `offline`, como el `useEnLinea` del POS
 * (src/pos/PosApp.tsx) pero sobre `useSyncExternalStore`. Que diga que sí no prueba que algo llegue a internet.
 */
export function useEnLinea(): boolean {
  const monitor = monitorGlobal()
  return useSyncExternalStore(monitor.suscribir, monitor.leer)
}

/** Lo que `escucharVuelta` usa del `Document`: así una prueba puede pasarle uno falso. */
type DocumentoVisible = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/**
 * Llama a `cb` cuando la página vuelve a ser visible (`visibilitychange`) tras haber estado oculta al menos `minOcultoMs`. Una página
 * que arranca oculta cuenta desde el arranque. `ahoraMs` es el reloj con que se mide el rato oculto: milisegundos transcurridos del
 * reloj real, no el día del calendario de `lib/reloj`, así que el reloj simulado no lo toca. Devuelve la función que deja de escuchar.
 */
export function escucharVuelta(doc: DocumentoVisible, minOcultoMs: number, cb: () => void, ahoraMs: () => number = Date.now): () => void {
  let ocultoDesde: number | null = doc.visibilityState === 'hidden' ? ahoraMs() : null
  const alCambiar = (): void => {
    if (doc.visibilityState === 'hidden') {
      if (ocultoDesde === null) ocultoDesde = ahoraMs()
      return
    }
    const desde = ocultoDesde
    ocultoDesde = null
    if (desde !== null && ahoraMs() - desde >= minOcultoMs) cb()
  }
  doc.addEventListener('visibilitychange', alCambiar)
  return () => doc.removeEventListener('visibilitychange', alCambiar)
}

/**
 * Llama a `cb` cuando el usuario vuelve a la app tras haberla dejado oculta al menos `minOcultoMs` (cambió de app o apagó la pantalla).
 * `cb` puede ser una función nueva en cada render sin que se pierda la cuenta del rato oculto: siempre se llama a la última.
 */
export function useAlVolver(minOcultoMs: number, cb: () => void): void {
  const ultima = useRef(cb)
  useEffect(() => {
    ultima.current = cb
  })
  useEffect(() => escucharVuelta(document, minOcultoMs, () => ultima.current()), [minOcultoMs])
}

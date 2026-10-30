// La cola de avisos de Express (anexo 8: «own toast, one at a time, above the bar and above --kb-inset, 4 s (undo 6 s), no sonner»). Aquí está lo que decide qué se
// ve y cuánto dura, sin DOM, para poder probarlo en Node: `ui/Toast.tsx` es el dibujo y el temporizador. Un aviso a la vez: el nuevo reemplaza al que se ve,
// también a un error (lo último que pasó es lo que el usuario necesita leer).

export type TipoToast = 'info' | 'ok' | 'error'

export interface ToastItem {
  /** Sube con cada aviso y no se reutiliza: el temporizador de uno viejo no puede confundirse con el que lo reemplazó. */
  id: number
  texto: string
  tipo: TipoToast
  /** Con esto el aviso lleva un botón «Deshacer» que lo llama, y dura más. */
  deshacer?: () => void
  /** La hora en que se pidió, en ms (`Date.now`). */
  creadoEn: number
}

/** Lo que dura un aviso a secas. */
export const DURACION_TOAST_MS = 4000
/** Lo que dura uno con «Deshacer»: más, porque hay que leerlo y decidir. */
export const DURACION_TOAST_DESHACER_MS = 6000

/** Cuántos milisegundos se queda a la vista: 4 s, y 6 s si ofrece deshacer. */
export function duracionMs(t: ToastItem): number {
  return t.deshacer === undefined ? DURACION_TOAST_MS : DURACION_TOAST_DESHACER_MS
}

/** El aviso que queda a la vista al llegar `nuevo` estando `actual` (o ninguno): siempre el nuevo. */
export function agregar(_actual: ToastItem | null, nuevo: ToastItem): ToastItem {
  return nuevo
}

export interface ColaToast {
  /** Pone un aviso a la vista (reemplaza al que hubiera) y devuelve el item creado. */
  mostrar(texto: string, opts?: { deshacer?: () => void; tipo?: TipoToast }): ToastItem
  /**
   * Quita el aviso `id` si es el que se ve. Un id que ya no está a la vista (lo reemplazó otro, o ya se quitó) no hace nada: así el temporizador de un
   * aviso viejo no se lleva al nuevo.
   */
  descartar(id: number): void
  /** El aviso a la vista, o null. Es el mismo objeto mientras no cambie nada: lo que `useSyncExternalStore` pide como valor. */
  leer(): ToastItem | null
  /** Llama a `cb` cada vez que cambia el aviso a la vista. Devuelve la función que deja de avisar. */
  suscribir(cb: () => void): () => void
}

/** Una cola de avisos con su propio reloj (`ahora`, en ms): la de la app es una sola, la crea `ui/Toast.tsx`. */
export function crearColaToast(ahora: () => number = Date.now): ColaToast {
  let visible: ToastItem | null = null
  let ultimoId = 0
  const oyentes = new Set<() => void>()
  const avisar = (): void => {
    for (const oyente of [...oyentes]) oyente()
  }
  return {
    mostrar(texto, opts) {
      ultimoId++
      const nuevo: ToastItem = { id: ultimoId, texto, tipo: opts?.tipo ?? 'info', deshacer: opts?.deshacer, creadoEn: ahora() }
      visible = agregar(visible, nuevo)
      avisar()
      return nuevo
    },
    descartar(id) {
      if (visible === null || visible.id !== id) return
      visible = null
      avisar()
    },
    leer: () => visible,
    suscribir(cb) {
      // Una función propia por suscripción: cancelar una suscripción de `cb` no puede dejar sin aviso a otra suscripción de la misma función.
      const oyente = (): void => cb()
      oyentes.add(oyente)
      return () => {
        oyentes.delete(oyente)
      }
    },
  }
}

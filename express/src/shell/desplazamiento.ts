// La memoria del desplazamiento de la página por pestaña (anexo 5.4): al volver a Facturas, Clientes o Productos desde un detalle o desde otra pestaña, la página
// vuelve a donde estaba. Va en un módulo que recibe su entorno (el mismo patrón de ui/viewport.ts) para probarla en Node, que no tiene DOM; `memoriaDelShell` es esa
// misma lógica sobre `window`, creada la primera vez que se usa (importar este módulo no toca `window`).
//
// Dos cosas que una versión ingenua hace mal:
//  - Con una hoja abierta en iOS 15 y anteriores (que no entienden `overscroll-behavior: contain`) el cuerpo queda fijo, `scrollY` pasa a 0 y el navegador lanza un
//    `scroll` por eso. Ese 0 no es del usuario: guardarlo pisaba el desplazamiento de la pestaña de detrás, y tras abrir Más, tocar una fila y volver con atrás la
//    pestaña quedaba arriba. Con `bloqueado()` el scroll de una hoja no se guarda.
//  - Una pantalla que pinta primero un esqueleto corto y trae las filas después: `scrollTo` se acota a lo que hay para desplazar y el desplazamiento se perdía.
//    `restaurar` sigue intentándolo mientras la página crezca, hasta llegar al punto, hasta que el usuario toque la pantalla o pasen `ESPERA_RESTAURAR_MS`. Mientras
//    espera, el scroll que dejó el navegador al acotar tampoco se guarda (no es del usuario), así irse antes de que lleguen las filas no pierde el punto.
import { scrollBloqueado } from '~/ui/viewport'

/** Cuánto insiste `restaurar` en llegar al punto guardado, a lo sumo, mientras la página crece (llegan las filas de una lista). */
export const ESPERA_RESTAURAR_MS = 1500

/** Lo que la memoria usa del navegador: así una prueba puede pasarle uno falso. */
export interface EntornoDeDesplazamiento {
  /** Cuánto se ha bajado la página ahora (`scrollY`). */
  leerY(): number
  /** Pone la página en `y`; el navegador la acota a lo que haya para desplazar (`scrollTo`). */
  irA(y: number): void
  /** ¿Hay una hoja bloqueando el scroll de la página? Con el cuerpo fijo, `leerY()` y los `scroll` que lanza el navegador no son del usuario. */
  bloqueado(): boolean
  /** Llama a `cb` en cada `scroll` de la página. Devuelve la función que deja de avisar. */
  alDesplazar(cb: () => void): () => void
  /** Llama a `cb` cuando la página cambia de tamaño (llegan filas, se va un esqueleto). Devuelve la función que deja de avisar. */
  alCrecer(cb: () => void): () => void
  /** Llama a `cb` cuando el usuario toma la página: un toque, la rueda, una tecla. Devuelve la función que deja de avisar. */
  alInteractuar(cb: () => void): () => void
  /** Llama a `cb` pasados `ms` milisegundos. Devuelve la función que lo cancela. */
  esperar(ms: number, cb: () => void): () => void
}

export interface MemoriaDeDesplazamiento {
  /**
   * Guarda el desplazamiento de la página bajo `clave` en cada scroll, hasta que se llame a la función que devuelve. No guarda el scroll de una hoja que bloquea la
   * página ni el que deja el navegador mientras una `restaurar` espera.
   */
  recordar(clave: string): () => void
  /**
   * Devuelve la página al punto guardado de `clave` (arriba si no hay ninguno). Si la página no llega todavía, porque aún es corta, sigue intentándolo cada vez que
   * crece hasta llegar, hasta un gesto del usuario o hasta `ESPERA_RESTAURAR_MS`. Devuelve la función que deja de intentarlo (la pantalla se va): sirve llamarla
   * cuantas veces haga falta.
   */
  restaurar(clave: string): () => void
  /** Olvida todo lo guardado: lo recordado es de una sesión que termina. */
  olvidar(): void
}

/** Una memoria sobre `entorno`: cada una tiene lo suyo guardado. */
export function crearMemoriaDeDesplazamiento(entorno: EntornoDeDesplazamiento): MemoriaDeDesplazamiento {
  const guardado = new Map<string, number>()
  /** Cuántas `restaurar` siguen sin soltar: mientras haya alguna, `leerY()` es el que el navegador dejó al acotar, no el del usuario. */
  let esperando = 0

  return {
    recordar(clave) {
      return entorno.alDesplazar(() => {
        if (esperando > 0 || entorno.bloqueado()) return
        guardado.set(clave, entorno.leerY())
      })
    },

    restaurar(clave) {
      const destino = guardado.get(clave) ?? 0
      const soltar: Array<() => void> = []
      let activa = true
      // Cuenta desde antes del primer intento: el `scroll` que lanza ese `scrollTo` (acotado, si la página es corta) llega mientras se espera.
      esperando++
      const parar = (): void => {
        if (!activa) return
        activa = false
        esperando--
        for (const soltarUno of soltar) soltarUno()
      }
      /** Lo intenta y dice si la página ya está en el punto. Bloqueada por una hoja no se toca: `scrollTo` no es del usuario ahí. */
      const intentar = (): boolean => {
        if (!entorno.bloqueado()) entorno.irA(destino)
        return Math.abs(entorno.leerY() - destino) < 1
      }

      if (intentar()) {
        parar()
        return parar
      }
      soltar.push(
        entorno.alCrecer(() => {
          if (intentar()) parar()
        }),
        entorno.alInteractuar(parar),
        entorno.esperar(ESPERA_RESTAURAR_MS, parar),
      )
      return parar
    },

    olvidar() {
      guardado.clear()
    },
  }
}

// --- La memoria de la ventana -------------------------------------------------------------------------------------------------

/** Pone `cb` como oyente pasivo de `tipos` en la ventana y devuelve la función que los quita. */
function escuchar(tipos: readonly string[], cb: () => void): () => void {
  for (const tipo of tipos) window.addEventListener(tipo, cb, { passive: true })
  return () => {
    for (const tipo of tipos) window.removeEventListener(tipo, cb)
  }
}

/** El entorno de `window`. El tamaño de la página se vigila en la raíz del documento: crece con las filas (`html` no tiene alto fijo, ver styles/base.css). */
function entornoDeLaVentana(): EntornoDeDesplazamiento {
  return {
    leerY: () => window.scrollY,
    irA: (y) => window.scrollTo(0, y),
    bloqueado: scrollBloqueado,
    alDesplazar: (cb) => escuchar(['scroll'], cb),
    alCrecer(cb) {
      if (typeof ResizeObserver === 'undefined') return () => {} // sin él (no pasa en el piso de navegadores) queda el intento único de `restaurar`
      const observador = new ResizeObserver(cb)
      observador.observe(document.documentElement)
      return () => observador.disconnect()
    },
    alInteractuar: (cb) => escuchar(['pointerdown', 'wheel', 'keydown'], cb),
    esperar(ms, cb) {
      const id = window.setTimeout(cb, ms)
      return () => window.clearTimeout(id)
    },
  }
}

let memoriaDeLaVentana: MemoriaDeDesplazamiento | undefined

/** La memoria de esta ventana, creada al usarla por primera vez: las pruebas (Node, sin `window`) importan este módulo sin llegar aquí. */
export function memoriaDelShell(): MemoriaDeDesplazamiento {
  if (!memoriaDeLaVentana) memoriaDeLaVentana = crearMemoriaDeDesplazamiento(entornoDeLaVentana())
  return memoriaDeLaVentana
}

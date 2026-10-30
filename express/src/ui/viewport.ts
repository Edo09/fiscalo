// El teclado en pantalla y el scroll de la página bajo una hoja (anexo 5.5 y 8). `--kb-inset` es cuánto del borde de abajo de la ventana tapa el teclado
// (`innerHeight - visualViewport.height - visualViewport.offsetTop`): lo que se ancla abajo (la barra de acción, el pie de una hoja, el aviso) se sube con
// él y nunca queda detrás del teclado. Solo la barra inferior se esconde con el teclado (`useTecladoAbierto`).
//
// La lógica vive en funciones que reciben la ventana (`crearMonitorDeTeclado`, `crearBloqueoDeScroll`) para probarla en Node, que no tiene DOM; los ganchos y
// `bloquearScroll` son esas funciones sobre `window`, creadas la primera vez que se usan (importar este módulo no toca `window`).
import { useSyncExternalStore } from 'react'

/** Más que esto de la ventana tapado por abajo es un teclado en pantalla (anexo 5.1); menos son las barras del navegador que suben y bajan. */
export const UMBRAL_TECLADO_PX = 150

/**
 * Cuánto tapa el teclado del borde de abajo de la ventana: `innerHeight - vv.height - vv.offsetTop`, nunca menos de 0 (un visualViewport mayor que la
 * ventana no es un teclado), y 0 sin `visualViewport`. El `offsetTop` cuenta porque iOS desplaza el visualViewport para dejar a la vista el campo enfocado:
 * la capa fija se levanta solo lo que falta para quedar al ras del borde de abajo de lo que se ve.
 */
export function calcularInset(innerHeight: number, vv: { height: number; offsetTop: number } | null): number {
  if (vv === null) return 0
  return Math.max(0, innerHeight - vv.height - vv.offsetTop)
}

/** ¿Hay un teclado en pantalla con ese `inset`? Más de 150 px. */
export function tecladoAbierto(inset: number): boolean {
  return inset > UMBRAL_TECLADO_PX
}

// --- El monitor del teclado ---------------------------------------------------------------------------------------------------

/** Lo que el monitor usa del `visualViewport`. */
interface VisualViewportDeTeclado {
  readonly height: number
  readonly offsetTop: number
  /** El zoom de pellizco: 1 sin zoom. */
  readonly scale: number
  addEventListener(tipo: 'resize' | 'scroll', oyente: () => void): void
  removeEventListener(tipo: 'resize' | 'scroll', oyente: () => void): void
}

/** Lo que el monitor usa de la ventana: así una prueba puede pasarle una falsa. */
export interface VentanaDeTeclado {
  readonly innerHeight: number
  readonly visualViewport: VisualViewportDeTeclado | null
  addEventListener(tipo: 'resize', oyente: () => void): void
  removeEventListener(tipo: 'resize', oyente: () => void): void
}

export interface MonitorDeTeclado {
  /** El alto del teclado en píxeles enteros: 0 sin teclado, y mientras nadie escuche (sin suscriptores no se mide). */
  leer(): number
  /** Llama a `cb` cada vez que `leer()` cambia. Devuelve la función que deja de avisar. */
  suscribir(cb: () => void): () => void
}

/**
 * El alto del teclado ahora, en píxeles enteros (un 299.5 que oscila no hace temblar la capa fija). Con zoom de pellizco es 0: iOS deja `innerHeight` quieto
 * y encoge el visualViewport, y con la fórmula eso parecería un teclado de media pantalla (la barra de abajo se escondería con solo acercar la página, y el
 * zoom de pellizco sigue permitido en Express). Con el teclado y el zoom a la vez no se sabe cuál es cuál, y se prefiere no levantar nada a esconder la barra.
 */
function medir(win: VentanaDeTeclado): number {
  const vv = win.visualViewport
  if (!vv || vv.scale > 1.01) return 0
  return Math.round(calcularInset(win.innerHeight, vv))
}

/**
 * Un monitor del teclado sobre `win`. Mientras haya alguien suscrito escucha `resize` y `scroll` del visualViewport (el teclado sube y baja, iOS lo
 * desplaza) y `resize` de la ventana (un giro de pantalla); cada vez que el alto cambia llama a `aplicar` (la app lo escribe en `--kb-inset`) y avisa a los
 * suscritos. Sin suscriptores no hay ningún oyente puesto, y al irse el último `aplicar(0)` deja la raíz como estaba.
 */
export function crearMonitorDeTeclado(win: VentanaDeTeclado, aplicar: (inset: number) => void): MonitorDeTeclado {
  let actual = 0
  const oyentes = new Set<() => void>()

  const remedir = (): void => {
    const nuevo = medir(win)
    if (nuevo === actual) return
    actual = nuevo
    aplicar(nuevo)
    for (const oyente of [...oyentes]) oyente()
  }

  return {
    leer: () => actual,
    suscribir(cb) {
      // Una función propia por suscripción: cancelar una suscripción de `cb` no puede dejar sin aviso a otra suscripción de la misma función.
      const oyente = (): void => cb()
      oyentes.add(oyente)
      if (oyentes.size === 1) {
        win.addEventListener('resize', remedir)
        win.visualViewport?.addEventListener('resize', remedir)
        win.visualViewport?.addEventListener('scroll', remedir)
        remedir() // el teclado ya puede estar abierto cuando se monta lo primero que lo usa
      }
      let activa = true
      return () => {
        if (!activa) return
        activa = false
        oyentes.delete(oyente)
        if (oyentes.size > 0) return
        win.removeEventListener('resize', remedir)
        win.visualViewport?.removeEventListener('resize', remedir)
        win.visualViewport?.removeEventListener('scroll', remedir)
        if (actual !== 0) {
          actual = 0
          aplicar(0)
        }
      }
    },
  }
}

/** Escribe `--kb-inset` en la raíz del documento; con 0 quita el valor en línea y vale el de `tokens.css` (0px). */
function aplicarEnLaRaiz(inset: number): void {
  const estilo = document.documentElement.style
  if (inset === 0) estilo.removeProperty('--kb-inset')
  else estilo.setProperty('--kb-inset', `${inset}px`)
}

let monitorDeLaVentana: MonitorDeTeclado | undefined

/** El monitor de esta ventana, creado al usarlo por primera vez: las pruebas (Node, sin `window`) importan este módulo sin llegar aquí. */
function monitorGlobal(): MonitorDeTeclado {
  if (!monitorDeLaVentana) monitorDeLaVentana = crearMonitorDeTeclado(window, aplicarEnLaRaiz)
  return monitorDeLaVentana
}

/**
 * El alto del teclado en pantalla, en píxeles. Mientras algún componente use este gancho (o `useTecladoAbierto`) la app mantiene `--kb-inset` en la raíz:
 * quien se ancla abajo con CSS (la barra de acción, las hojas, los avisos) tiene que llamar a uno de los dos, aunque no use el número.
 */
export function useKbInset(): number {
  const monitor = monitorGlobal()
  return useSyncExternalStore(monitor.suscribir, monitor.leer)
}

/**
 * ¿Hay un teclado en pantalla? Solo vuelve a dibujar cuando se abre o se cierra, no con cada píxel de la animación del teclado. Mantiene `--kb-inset` como
 * `useKbInset`.
 */
export function useTecladoAbierto(): boolean {
  const monitor = monitorGlobal()
  return useSyncExternalStore(monitor.suscribir, () => tecladoAbierto(monitor.leer()))
}

// --- El bloqueo de scroll -----------------------------------------------------------------------------------------------------

/** Lo que el bloqueo usa de la ventana. */
interface VentanaConScroll {
  readonly scrollY: number
  scrollTo(x: number, y: number): void
}

/** El `style` del cuerpo, con lo que el bloqueo cambia. */
interface CuerpoBloqueable {
  style: { position: string; top: string; left: string; right: string; width: string }
}

/**
 * Un bloqueo de scroll sobre `win` y `cuerpo`: cada llamada a la función que devuelve bloquea la página (el cuerpo pasa a `position: fixed`, desplazado lo
 * que se había bajado para que no salte) y da la función que libera. Con varias hojas abiertas (una sobre otra) el cuerpo se queda fijo hasta que se libera
 * la última, y entonces recupera su estilo y la página vuelve al punto donde estaba. Liberar dos veces la misma hoja cuenta una (StrictMode, un cierre doble).
 */
export function crearBloqueoDeScroll(win: VentanaConScroll, cuerpo: CuerpoBloqueable): () => () => void {
  let bloqueos = 0
  let previo: CuerpoBloqueable['style'] | null = null
  let desplazado = 0

  return function bloquear(): () => void {
    if (bloqueos === 0) {
      const estilo = cuerpo.style
      desplazado = win.scrollY
      previo = { position: estilo.position, top: estilo.top, left: estilo.left, right: estilo.right, width: estilo.width }
      estilo.position = 'fixed'
      estilo.top = `-${desplazado}px`
      estilo.left = '0'
      estilo.right = '0'
      estilo.width = '100%'
    }
    bloqueos++
    let liberado = false
    return () => {
      if (liberado) return
      liberado = true
      bloqueos--
      if (bloqueos > 0 || previo === null) return
      const estilo = cuerpo.style
      estilo.position = previo.position
      estilo.top = previo.top
      estilo.left = previo.left
      estilo.right = previo.right
      estilo.width = previo.width
      previo = null
      win.scrollTo(0, desplazado)
    }
  }
}

let bloqueoDeLaPagina: (() => () => void) | undefined

/**
 * Bloquea el scroll de la página con `position: fixed` en el cuerpo (iOS 15 y anteriores ignoran `overscroll-behavior` y la página se movería bajo la
 * hoja) y devuelve la función que lo libera y devuelve la página a su sitio. Se puede llamar varias veces: ver `crearBloqueoDeScroll`.
 */
export function bloquearScroll(): () => void {
  if (!bloqueoDeLaPagina) bloqueoDeLaPagina = crearBloqueoDeScroll(window, document.body)
  return bloqueoDeLaPagina()
}

/**
 * ¿Entiende el navegador `overscroll-behavior: contain`? Con él, el cuerpo de una hoja no arrastra la página al llegar a su fin y no hace falta bloquear
 * nada; sin él (Safari de iOS hasta la 15) sí. Sin `CSS.supports` se supone que no.
 */
export function contieneElScroll(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overscroll-behavior', 'contain')
}

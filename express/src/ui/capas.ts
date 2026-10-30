// Lo que comparten las capas modales de Express: las hojas (`BottomSheet`) y el selector a pantalla completa (`FullScreenPicker`). Dos mitades, y una ayuda para la
// acción de una capa que navega (`cuandoAterriceElAtras`, más abajo).
//
//  1. El historial (`crearGestorDeCapas`, sin DOM, probado en Node). Cada capa empuja UNA entrada del historial al abrirse, para que el atrás del sistema (el
//     botón de Android, el gesto de iOS) la cierre en vez de sacar la pantalla de debajo. Es lo que el router (router.ts, `crearNavegador`) pide a quien empuje
//     entradas por su cuenta: la entrada conserva la marca del router (`fx` y `bajo`) tal cual, con la de la capa (`hoja`) añadida, así la profundidad no
//     cambia mientras la capa está abierta ni después; el `popstate` solo cierra cuando se sale de la entrada de la propia capa (`navegar` también lo lanza,
//     en el acto y con estado null); y cerrar retrocede por la entrada propia, sin `atras()` ni `marcar()` del router.
//  2. El DOM (`useCapa`): el foco entra, se queda dentro con Tab y vuelve a quien abrió la capa; lo de detrás se oculta a los lectores de pantalla con
//     `aria-hidden` (sin `inert`, que Chrome 90 no tiene); Esc cierra la de arriba; y en navegadores que no contienen el scroll se bloquea el de la página.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { bloquearScroll, contieneElScroll } from './viewport'

// --- El historial -------------------------------------------------------------------------------------------------------------

/** Lo que el gestor usa de la ventana: así una prueba puede pasarle una falsa (el mismo patrón que `crearNavegador`). */
export interface VentanaDeCapas {
  location: { readonly hash: string }
  history: {
    readonly state: unknown
    pushState(data: unknown, unused: string): void
    back(): void
    go(delta: number): void
  }
  addEventListener(tipo: 'popstate', oyente: () => void): void
  removeEventListener(tipo: 'popstate', oyente: () => void): void
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

export interface CapaAbierta {
  /**
   * Cierra la capa por código (su dueño puso `abierto` en false, o se desmontó): la saca de la pila y retrocede por su entrada del historial si todavía
   * está en su sitio. No avisa a la propia capa, pero sí a las que estaban encima de ella, que pierden su entrada con la suya. Cerrar dos veces cuenta una.
   */
  cerrar(): void
}

export interface GestorDeCapas {
  /**
   * Abre una capa y empuja su entrada del historial. `alRetroceder` se llama cuando el usuario sale de esa entrada hacia atrás (el atrás del sistema): su
   * dueño decide entonces si cierra (`abierto` en false) o no. Que la ruta cambie por otro lado (`navegar`) no es un atrás: la capa sigue abierta, sin
   * entrada, y su cierre posterior no toca el historial.
   */
  abrir(alRetroceder: () => void): CapaAbierta
}

/** Una carga de la página. La marca de una capa de OTRA carga (una recarga con la capa abierta deja su entrada en el historial, con su marca) no cuenta. */
const PAGINA = Math.random().toString(36).slice(2)

/** Cuánto se espera a que aterrice un atrás pedido antes de seguir sin él: si el navegador no lo cumple, el `popstate` no llega nunca. */
const ESPERA_ATRAS_MS = 500

/**
 * El nivel de capa de un estado del historial: 1 la primera capa abierta, 2 la que se abre encima, y 0 si la entrada no es de una capa de esta carga. Es el
 * «marcador propio» de cada capa: un atrás que cae en una entrada con un nivel igual o mayor que el suyo no la saca de su sitio.
 */
function nivelDe(estado: unknown, pagina: string): number {
  if (typeof estado !== 'object' || estado === null) return 0
  const marca: unknown = (estado as { hoja?: unknown }).hoja
  if (typeof marca !== 'object' || marca === null) return 0
  const { nivel, pagina: dePagina } = marca as { nivel?: unknown; pagina?: unknown }
  return dePagina === pagina && typeof nivel === 'number' && Number.isInteger(nivel) && nivel > 0 ? nivel : 0
}

interface Capa {
  alRetroceder: () => void
  /** La entrada que empujó (su nivel y el hash en que se abrió), o null si no pudo empujarla o ya no está bajo la actual (la ruta cambió por otro lado). */
  entrada: { nivel: number; hash: string } | null
}

/**
 * Un gestor de capas sobre `win`. Las capas forman una pila: la entrada de cada una lleva su nivel, que es cuántas capas con entrada tiene debajo más una,
 * y un solo oyente de `popstate` (puesto mientras haga falta) mira el nivel de la entrada a la que se llegó. Una capa con entrada cuyo nivel queda por encima
 * se salió de su sitio: si el hash es el de cuando se abrió, fue un atrás (se avisa a su dueño); si es otro, la ruta cambió por `navegar` (empujando o
 * reemplazando) y la capa se queda abierta pero sin entrada.
 *
 * Las operaciones sobre el historial van UNA A UNA: un `pushState` hecho con un `back` o `go` en vuelo (pedido y sin aterrizar) no desplaza el destino de este,
 * que cae por debajo de la entrada recién empujada y la deja enterrada (medido en Chromium, y es lo que pasa cuando una hoja se cierra y otra se abre en el
 * mismo turno: de una confirmación a la siguiente, o el doble efecto de StrictMode). Así que lo que se pide con un viaje en vuelo espera a que aterrice
 * (su `popstate`, o `esperaMs` si no llega), y sigue por orden. La capa ya está abierta para quien la usa (Esc, foco, fondo); lo único que espera es su entrada.
 */
export function crearGestorDeCapas(win: VentanaDeCapas, pagina: string = PAGINA, esperaMs: number = ESPERA_ATRAS_MS): GestorDeCapas {
  const pila: Capa[] = []
  let escuchando = false
  /** ¿Hay un `back` o `go` pedido que todavía no aterrizó? Mientras sea así no se toca el historial. */
  let enVuelo = false
  let espera: number | undefined
  /** Lo que se pidió con un viaje en vuelo (empujar la entrada de una capa nueva, retroceder las de una cerrada), por orden. */
  const cola: Array<() => void> = []

  const conEntrada = (): number => pila.filter((capa) => capa.entrada !== null).length

  /** Pone el oyente de `popstate` mientras haya capas con entrada, un viaje en vuelo o algo esperándolo, y lo quita cuando no. */
  function ajustarOyente(): void {
    const hacenFalta = enVuelo || cola.length > 0 || conEntrada() > 0
    if (hacenFalta && !escuchando) win.addEventListener('popstate', alIr)
    else if (!hacenFalta && escuchando) win.removeEventListener('popstate', alIr)
    escuchando = hacenFalta
  }

  /** Corre `operacion` ya, o cuando aterrice el viaje en vuelo, detrás de lo que esperaba antes. */
  function enOrden(operacion: () => void): void {
    if (enVuelo || cola.length > 0) cola.push(operacion)
    else operacion()
  }

  /** Pide un atrás (`delta` -1) o un `go` y se queda esperando a que aterrice. */
  function viajar(delta: number): void {
    enVuelo = true
    espera = win.setTimeout(alAterrizar, esperaMs)
    if (delta === -1) win.history.back()
    else win.history.go(delta)
  }

  /** El viaje aterrizó, o se dejó de esperarlo: sigue lo que había en cola, hasta el próximo viaje. */
  function alAterrizar(): void {
    if (!enVuelo) return
    enVuelo = false
    if (espera !== undefined) win.clearTimeout(espera)
    while (!enVuelo && cola.length > 0) cola.shift()?.()
    ajustarOyente()
  }

  /** Empuja la entrada de `capa` (si sigue abierta: pudo cerrarse mientras esperaba su turno). Su nivel se cuenta ahora, con lo que haya debajo. */
  function empujar(capa: Capa): void {
    if (!pila.includes(capa)) return
    const nivel = conEntrada() + 1
    const estado: unknown = win.history.state
    try {
      // `{ ...history.state }` y no un objeto nuevo: el router lee `fx` y `bajo` de ahí, y sin ellos `atras()` creería que no hay historial debajo.
      win.history.pushState({ ...(typeof estado === 'object' && estado !== null ? estado : {}), hoja: { nivel, pagina } }, '')
      capa.entrada = { nivel, hash: win.location.hash }
    } catch {
      // Safari corta la API de historial pasadas 100 llamadas en 30 segundos (lo mismo que le pasa a `marcar` en router.ts): la capa abre igual y el atrás
      // del sistema deja de cerrarla, que es lo seguro.
    }
    ajustarOyente()
  }

  /** Saca `cuantas` entradas de capa del historial. Con la entrada actual ya sin marca de capa (la ruta cambió por otro lado) no hace nada: sacaría la pantalla. */
  function retroceder(cuantas: number): void {
    if (nivelDe(win.history.state, pagina) === 0) return
    viajar(-cuantas)
  }

  function alIr(): void {
    const actual = nivelDe(win.history.state, pagina)
    const hash = win.location.hash
    const retroceden: Capa[] = []
    for (let i = pila.length - 1; i >= 0; i--) {
      const capa = pila[i]
      if (capa.entrada === null || capa.entrada.nivel <= actual) continue // sin entrada, o su entrada sigue puesta: esta no se tocó
      if (hash === capa.entrada.hash) {
        pila.splice(i, 1)
        retroceden.push(capa)
      } else {
        capa.entrada = null
      }
    }
    for (const capa of retroceden) capa.alRetroceder() // ya fuera de la pila: si el dueño reabre desde aquí, la pila está en orden
    alAterrizar()
    ajustarOyente()
  }

  return {
    abrir(alRetroceder) {
      const capa: Capa = { alRetroceder, entrada: null }
      pila.push(capa)
      enOrden(() => empujar(capa))
      ajustarOyente()
      return {
        cerrar() {
          const i = pila.indexOf(capa)
          if (i === -1) return // ya la sacó un atrás del sistema, o la capa de abajo al cerrarse
          const encima = pila.splice(i)
          const entradas = encima.filter((otra) => otra.entrada !== null).length
          // Las de arriba pierden su entrada con la de abajo: se les avisa, de arriba abajo, y se sacan todas de un golpe.
          for (let j = encima.length - 1; j > 0; j--) encima[j].alRetroceder()
          if (entradas > 0) enOrden(() => retroceder(entradas))
          ajustarOyente()
        },
      }
    },
  }
}

let gestorDeLaVentana: GestorDeCapas | undefined

/** El gestor de esta ventana, creado al usarlo por primera vez: las pruebas (Node, sin `window`) importan este módulo sin llegar aquí. */
function gestorGlobal(): GestorDeCapas {
  if (!gestorDeLaVentana) gestorDeLaVentana = crearGestorDeCapas(window)
  return gestorDeLaVentana
}

// --- Navegar tras cerrar una capa ---------------------------------------------------------------------------------------------

/** Lo que `cuandoAterriceElAtras` usa de la ventana: el `popstate` y los temporizadores del gestor, así una prueba puede pasarle la misma ventana falsa. */
type VentanaDelAtras = Pick<VentanaDeCapas, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>

/**
 * Corre `luego` cuando aterriza el próximo atrás del historial, y no antes. Es lo que espera la acción de una capa que navega (la hoja de cerrar sesión que lleva a
 * la factura sin confirmar; la hoja de sesión vencida cuando entra otro usuario): la capa empujó su propia entrada, y navegar mientras esa entrada es la actual
 * la deja enterrada bajo la pantalla nueva (un atrás de más mostraría la pantalla de antes) y hace que `reemplazar` copie una marca `bajo` de un nivel de menos.
 * Se cierra la capa primero y se navega cuando el atrás de su cierre ya aterrizó.
 *
 * Se llama ANTES de cerrar la capa (poner `abierto` en false, o lo que la desmonte): el atrás que pide el cierre aterriza en un turno posterior, y ponerla después
 * es una carrera que no se gana. Si ese atrás no llega (la capa no pudo empujar su entrada, o el navegador no lo cumple) `luego` corre igual pasado `esperaMs`,
 * el mismo respaldo del gestor. Corre una sola vez y quita su oyente antes de correr, así el `popstate` que lance lo que `luego` navegue (`navegar` lo lanza en
 * el acto) no la dispara otra vez. Su oyente se pone después del del gestor: cuando corre, el gestor ya procesó el aterrizaje.
 */
export function cuandoAterriceElAtras(luego: () => void, win: VentanaDelAtras = window, esperaMs: number = ESPERA_ATRAS_MS): void {
  const correr = (): void => {
    // Lo primero que hace es quitar sus dos disparadores (el oyente y el respaldo): así corre una sola vez, llegue lo que llegue después.
    win.removeEventListener('popstate', correr)
    win.clearTimeout(espera)
    luego()
  }
  win.addEventListener('popstate', correr)
  const espera = win.setTimeout(correr, esperaMs) // `correr` solo se llama después, desde el evento o desde este temporizador: `espera` ya existe
}

// --- El arrastre del asa ------------------------------------------------------------------------------------------------------

/** Cuántos píxeles hay que bajar el asa de una hoja para que se cierre (anexo 8). */
export const UMBRAL_ARRASTRE_PX = 80

/** ¿Cierra la hoja un arrastre de `dy` píxeles hacia abajo (negativo es hacia arriba) al soltar? Con 80 o más. */
export function cierraPorArrastre(dy: number): boolean {
  return dy >= UMBRAL_ARRASTRE_PX
}

// --- El DOM de una capa -------------------------------------------------------------------------------------------------------

/**
 * Los elementos raíz de las capas abiertas, de abajo arriba. La última es la que recibe el teclado (Esc, Tab) y la única que no se oculta a los lectores de
 * pantalla. Las capas son hijas directas del `body` (un portal), así que «lo de detrás» es el resto de los hijos del `body`.
 */
const abiertas: HTMLElement[] = []

/** Lo que ya tenía `aria-hidden` antes de que lo tocáramos, para devolverlo como estaba: lo que nosotros ocultamos y el valor que tenía (null: sin atributo). */
const ocultados = new Map<Element, string | null>()

/** Hijos del `body` que no son contenido: ocultarlos a los lectores de pantalla no cambia nada. */
const SIN_CONTENIDO = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE'])

/**
 * Pone `aria-hidden="true"` a todo lo que hay en el `body` salvo la capa de arriba (y lo que se marque con `data-capa-exenta`: el aviso, que tiene que
 * anunciarse aunque haya una hoja abierta), y devuelve a su sitio lo que ya no corresponde. Sin capas abiertas no queda nada oculto. Es el sustituto de
 * `inert`, que Chrome 90 no tiene.
 */
function sincronizarFondo(): void {
  const arriba = abiertas[abiertas.length - 1]
  for (const hijo of Array.from(document.body.children)) {
    const sobra = arriba !== undefined && hijo !== arriba && !hijo.hasAttribute('data-capa-exenta') && !SIN_CONTENIDO.has(hijo.tagName)
    if (sobra && !ocultados.has(hijo)) {
      ocultados.set(hijo, hijo.getAttribute('aria-hidden'))
      hijo.setAttribute('aria-hidden', 'true')
    } else if (!sobra && ocultados.has(hijo)) {
      const previo = ocultados.get(hijo)
      ocultados.delete(hijo)
      if (previo === null || previo === undefined) hijo.removeAttribute('aria-hidden')
      else hijo.setAttribute('aria-hidden', previo)
    }
  }
  for (const oculto of [...ocultados.keys()]) if (!oculto.isConnected) ocultados.delete(oculto) // lo que se quitó del DOM mientras estaba oculto
}

const ENFOCABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Lo que se puede enfocar con Tab dentro de `dentro`, en orden del documento y sin lo que no se ve. */
function enfocables(dentro: HTMLElement): HTMLElement[] {
  return Array.from(dentro.querySelectorAll<HTMLElement>(ENFOCABLE)).filter((el) => el.getClientRects().length > 0)
}

/** Tab y Mayús+Tab dan la vuelta dentro de `panel`: del último al primero y del primero al último. Sin nada enfocable el foco se queda en el propio panel. */
function atraparTab(e: KeyboardEvent, panel: HTMLElement): void {
  const lista = enfocables(panel)
  if (lista.length === 0) {
    e.preventDefault()
    panel.focus({ preventScroll: true })
    return
  }
  const primero = lista[0]
  const ultimo = lista[lista.length - 1]
  const activo = document.activeElement
  const dentro = activo !== null && panel.contains(activo)
  if (e.shiftKey && (!dentro || activo === primero || activo === panel)) {
    e.preventDefault()
    ultimo.focus({ preventScroll: true })
  } else if (!e.shiftKey && (!dentro || activo === ultimo)) {
    e.preventDefault()
    primero.focus({ preventScroll: true })
  }
}

/** El elemento con el foco ahora (a quien vuelve el foco al cerrar la capa), o null si no hay ninguno que valga (el `body` no cuenta). */
function elementoConFoco(): HTMLElement | null {
  const activo = document.activeElement
  return activo instanceof HTMLElement && activo !== document.body ? activo : null
}

export interface OpcionesDeCapa {
  /** La raíz de la capa: un hijo directo del `body` (un portal). Lo único que no se oculta a los lectores de pantalla. */
  raiz: RefObject<HTMLElement>
  /** El diálogo (lo que lleva `role`): ahí entra el foco y ahí se queda con Tab. En el selector a pantalla completa es la misma raíz. */
  dialogo: RefObject<HTMLElement>
  /**
   * Cierra la capa: la llaman Esc y el atrás del sistema al salir de su entrada. Quien la tiene decide: poner `abierto` en false o, si no se puede cerrar
   * (la hoja de sesión vencida), no hacer nada. En ese caso la capa vuelve a empujar su entrada y el atrás no la deja sin ella.
   */
  onCerrar: () => void
  /** Con false la capa no empuja entrada ni escucha `popstate`: la ruta es la dueña de su entrada (Más, `#/mas`), y `onCerrar` es el `atras` de la ruta. */
  conHistorial: boolean
}

/**
 * Lo que hace de una capa una capa modal. Va en el componente que SOLO existe mientras la capa está abierta (un componente interior que el exterior monta
 * con `abierto`): el montaje es la apertura y el desmontaje el cierre.
 *  - Historial: una entrada mientras está abierta (`crearGestorDeCapas`), salvo con `conHistorial` false.
 *  - Foco: al abrir entra al elemento con `data-foco-inicial` si lo hay y, si no, al propio diálogo (sin abrir el teclado); Tab da la vuelta dentro; si algo
 *    saca el foco de la capa de arriba, vuelve. Al cerrar vuelve a quien lo tenía al abrir. Quien abre la capa no debe pedir el foco con `autoFocus`: se
 *    pide desde un efecto o con `data-foco-inicial`, para que la capa sepa quién lo tenía antes.
 *  - Lectores de pantalla: lo demás del `body` queda con `aria-hidden` mientras haya una capa abierta. Con una capa sobre otra, solo la de arriba se ve.
 *  - Esc cierra, solo la de arriba (también cuando el foco no está dentro, tras tocar el fondo).
 *  - Scroll: donde el navegador no entiende `overscroll-behavior` (iOS 15 y anteriores), la página no se mueve bajo la capa; ver `bloquearScroll`.
 */
export function useCapa(p: OpcionesDeCapa): void {
  const { raiz, dialogo, conHistorial } = p
  const alCerrar = useRef(p.onCerrar)
  useEffect(() => {
    alCerrar.current = p.onCerrar // siempre la última, sin volver a armar nada
  })
  // A quien vuelve el foco: se lee al montar, antes de que nada dentro de la capa lo tome (el `autoFocus` de un hijo lo movería antes de cualquier efecto).
  const [abridor] = useState(elementoConFoco)
  const [rearmes, setRearmes] = useState(0)

  useEffect(() => {
    if (!conHistorial) return
    const capa = gestorGlobal().abrir(() => {
      alCerrar.current()
      // Si el dueño no la cerró (no se puede cerrar), la entrada que acaba de salir se vuelve a empujar: el atrás no la deja sin ella. Si la cerró, la capa
      // se desmonta con este mismo cambio y el efecto no vuelve a correr.
      setRearmes((n) => n + 1)
    })
    return () => capa.cerrar()
  }, [conHistorial, rearmes])

  useEffect(() => {
    const el = raiz.current
    const panel = dialogo.current
    if (el === null || panel === null) return
    abiertas.push(el)
    sincronizarFondo()
    const liberarScroll = contieneElScroll() ? null : bloquearScroll()
    if (!panel.contains(document.activeElement)) {
      const inicial = panel.querySelector<HTMLElement>('[data-foco-inicial]')
      ;(inicial ?? panel).focus({ preventScroll: true })
    }

    const esLaDeArriba = (): boolean => abiertas[abiertas.length - 1] === el
    const alTeclear = (e: KeyboardEvent): void => {
      if (!esLaDeArriba() || e.isComposing) return // Esc cancela la palabra que se arma con un teclado de composición: no es «cerrar»
      if (e.key === 'Escape') alCerrar.current()
      else if (e.key === 'Tab') atraparTab(e, panel)
    }
    const alEnfocar = (e: FocusEvent): void => {
      const destino = e.target
      if (!esLaDeArriba() || !(destino instanceof Element) || el.contains(destino) || destino.closest('[data-capa-exenta]') !== null) return
      ;(enfocables(panel)[0] ?? panel).focus({ preventScroll: true })
    }
    document.addEventListener('keydown', alTeclear)
    document.addEventListener('focusin', alEnfocar)

    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.removeEventListener('focusin', alEnfocar)
      liberarScroll?.()
      const lugar = abiertas.indexOf(el)
      if (lugar !== -1) abiertas.splice(lugar, 1)
      sincronizarFondo()
      if (abridor !== null && abridor.isConnected) abridor.focus({ preventScroll: true })
    }
  }, [raiz, dialogo, abridor])
}

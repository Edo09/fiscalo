// Botón "atrás" del navegador dentro de Fiscalo.
//
// La app no tiene una URL por vista: navegar es cambiar `view` en memoria. Sin
// esto, toda la sesión vive en UNA sola entrada del historial y "atrás" saca al
// usuario de la app. Aquí cada nav() apila una entrada (pushState) y el popstate
// de atrás/adelante vuelve a la vista de esa entrada.
//
// Debajo de la primera vista queda una entrada "tope": llegar a ella significa
// que ya no hay adónde volver dentro de la app, y en vez de salir se recarga.
//
// Si la vista en pantalla tiene algo sin guardar (hooks/useAvisoSalida), el
// cambio de vista se detiene hasta que el usuario confirme (`salidaPendiente`).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mismoDestino, payloadAlVolver,
  type Nav, type NavOptions, type NavPayload, type ViewId,
} from '@/config/navigation'
import { descartarSinGuardar, guardandoAhora, haySinGuardar, mensajeSinGuardar } from './useAvisoSalida'

interface EntradaVista {
  fiscalo: 'vista'
  /** Identifica la entrada para recuperar su payload (ver `payloads`). */
  key: string
  view: ViewId
  /** Se abrió con payload. Si ya no está en memoria (hubo recarga), se perdió. */
  conPayload: boolean
}

interface EntradaTope {
  fiscalo: 'tope'
}

const TOPE: EntradaTope = { fiscalo: 'tope' }

const esVista = (s: unknown): s is EntradaVista =>
  !!s && typeof s === 'object' && (s as { fiscalo?: unknown }).fiscalo === 'vista'

const esTope = (s: unknown): s is EntradaTope =>
  !!s && typeof s === 'object' && (s as { fiscalo?: unknown }).fiscalo === 'tope'

// Aleatoria y no un contador: las entradas sobreviven a una recarga, y un
// contador que vuelve a empezar reusaría las claves de entradas anteriores.
const nuevaKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Teclas que para el navegador no cuentan como interacción del usuario. */
const TECLAS_SIN_ACTIVACION = new Set(['Control', 'Shift', 'Alt', 'Meta', 'Escape'])

interface Opciones {
  /** Vista con la que abre la app. */
  inicial: () => ViewId
  /** Vistas que sin su payload no tienen qué mostrar: se cambian por su listado. */
  sinPayload: Partial<Record<ViewId, ViewId>>
  /** Efectos de UI de cualquier cambio de vista (cerrar menús, subir el scroll). */
  onCambio?: () => void
}

/**
 * Cambio de vista detenido porque la vista actual tiene algo sin guardar (ver
 * hooks/useAvisoSalida). El shell lo muestra como diálogo.
 */
export interface SalidaPendiente {
  /** Distinto en cada diálogo: el shell lo usa de key para no reciclar el anterior. */
  id: number
  mensaje: string
  /** Salir sin guardar: se completa el cambio de vista. */
  salir: () => void
  /** Seguir en la vista (y deshacer lo que el navegador ya movió, si fue atrás). */
  quedarse: () => void
}

export function useHistoryNav({ inicial, sinPayload, onCambio }: Opciones): {
  view: ViewId
  payload: NavPayload
  nav: Nav
  salidaPendiente: SalidaPendiente | null
  /** Salida que no es un cambio de vista (cerrar sesión): pregunta igual que nav(). */
  confirmarSalida: (accion: () => void) => void
} {
  const [view, setView] = useState<ViewId>(inicial)
  const [payload, setPayload] = useState<NavPayload>(null)
  const [salidaPendiente, setSalidaPendiente] = useState<SalidaPendiente | null>(null)
  /** El diálogo vigente, para que uno viejo no actúe (ver abrirSalida). */
  const pendiente = useRef<SalidaPendiente | null>(null)
  const ultimoId = useRef(0)

  // nav() y los listeners se crean una sola vez: leen el estado vigente de aquí.
  const actual = useRef<{ view: ViewId; payload: NavPayload }>({ view, payload })
  const onCambioRef = useRef(onCambio)
  const sinPayloadRef = useRef(sinPayload)
  useEffect(() => {
    onCambioRef.current = onCambio
    sinPayloadRef.current = sinPayload
  })

  // Los payloads NO van en history.state a propósito: el state se clona y
  // sobrevive a recargas, así que devolvería una factura tal como estaba al
  // abrirla (y un objeto no clonable haría fallar pushState). Tras recargar este
  // Map está vacío y las vistas que dependen del payload caen a su listado, la
  // misma regla que ya aplica restoreView.
  const payloads = useRef(new Map<string, NavPayload>())

  const cerrarSalida = useCallback(() => {
    pendiente.current = null
    setSalidaPendiente(null)
  }, [])

  /**
   * Pregunta antes de salir. Las acciones solo valen mientras el diálogo siga
   * siendo el vigente: el Escape del Modal llega tras su animación, y para
   * entonces otro diálogo o un cambio de vista (el guardado que termina) pudo
   * haberlo dejado sin objeto.
   */
  const abrirSalida = useCallback((acciones: { salir: () => void; quedarse: () => void }) => {
    const dialogo: SalidaPendiente = {
      id: ++ultimoId.current,
      mensaje: mensajeSinGuardar(),
      salir: () => {
        if (pendiente.current !== dialogo) return
        // Se empezó a guardar con el diálogo abierto (el teclado llega al
        // formulario de detrás): ya no hay nada que descartar, así que es quedarse.
        if (guardandoAhora()) {
          cerrarSalida()
          acciones.quedarse()
          return
        }
        descartarSinGuardar()
        cerrarSalida()
        acciones.salir()
      },
      quedarse: () => {
        if (pendiente.current !== dialogo) return
        cerrarSalida()
        acciones.quedarse()
      },
    }
    pendiente.current = dialogo
    setSalidaPendiente(dialogo)
  }, [cerrarSalida])

  const aplicar = useCallback((v: ViewId, p: NavPayload) => {
    actual.current = { view: v, payload: p }
    // La pregunta era por la vista que se va: si se cambió de vista por otro
    // camino (el guardado navega al terminar), ya no aplica.
    cerrarSalida()
    setView(v)
    setPayload(p)
    onCambioRef.current?.()
  }, [cerrarSalida])

  const crearEntrada = useCallback((v: ViewId, p: NavPayload): EntradaVista => {
    const key = nuevaKey()
    if (p != null) payloads.current.set(key, p)
    return { fiscalo: 'vista', key, view: v, conPayload: p != null }
  }, [])

  /**
   * Deja el tope debajo de la vista actual, si todavía no está.
   *
   * No se hace al montar sino con la primera interacción: si una página apila
   * entradas sin que el usuario haya interactuado, Chrome se las salta al ir
   * atrás (protección contra páginas que atrapan al usuario). Armado durante un
   * clic o una tecla, el tope sí se respeta.
   */
  const armar = useCallback(() => {
    const s: unknown = window.history.state
    if (esVista(s)) return
    if (!esTope(s)) window.history.replaceState(TOPE, '')
    const { view: v, payload: p } = actual.current
    window.history.pushState(crearEntrada(v, p), '')
  }, [crearEntrada])

  const navegar = useCallback((v: ViewId, p: NavPayload, opts?: NavOptions) => {
    const s: unknown = window.history.state
    // Volver a pulsar la vista en la que ya se está no apila otra copia: si no,
    // "atrás" parecería no hacer nada hasta gastarlas.
    const repetida = esVista(s) && s.view === v && p == null && !s.conPayload
    if (opts?.replace || repetida) {
      // Sin historial armado no hay entrada propia que reemplazar; al armarse
      // se apilará la vista vigente, que ya será esta.
      if (esVista(s)) {
        payloads.current.delete(s.key)
        window.history.replaceState(crearEntrada(v, p), '')
      }
    } else {
      armar()
      window.history.pushState(crearEntrada(v, p), '')
    }
    aplicar(v, p)
  }, [aplicar, armar, crearEntrada])

  const nav = useCallback<Nav>((v, p = null, opts) => {
    if (opts?.forzar) {
      descartarSinGuardar()
      navegar(v, p, opts)
      return
    }
    // Mismo destino que lo que hay en pantalla: la vista no se desmonta y no se
    // pierde nada, así que no hay qué preguntar.
    if (!mismoDestino(v, p, actual.current.view, actual.current.payload)) {
      // Guardando: al terminar, el guardado cambia de vista él mismo; si falla,
      // lo escrito sigue en pantalla. El clic se ignora.
      if (guardandoAhora()) return
      if (haySinGuardar()) {
        abrirSalida({ salir: () => navegar(v, p, opts), quedarse: () => {} })
        return
      }
    }
    navegar(v, p, opts)
  }, [abrirSalida, navegar])

  const confirmarSalida = useCallback((accion: () => void) => {
    if (guardandoAhora()) return
    if (haySinGuardar()) abrirSalida({ salir: accion, quedarse: () => {} })
    else accion()
  }, [abrirSalida])

  useEffect(() => {
    // Tras recargar a mitad del historial la vista sale de restoreView y el
    // payload ya no está: la entrada se alinea con lo que de verdad se muestra.
    const s: unknown = window.history.state
    if (esVista(s) && (s.view !== actual.current.view || s.conPayload)) {
      window.history.replaceState({ ...s, view: actual.current.view, conPayload: false }, '')
    }

    /** Adónde lleva una entrada del historial; null = el tope (o una entrada ajena). */
    const destinoDe = (entrada: unknown) => {
      if (!esVista(entrada)) return null
      const perdido = entrada.conPayload && !payloads.current.has(entrada.key)
      const guardado = payloads.current.get(entrada.key) ?? null
      // "Nueva → Gasto" abre el formulario al llegar; al volver no se repite.
      // En un conduce nuevo la señal es el documento mismo y sí vuelve (payloadAlVolver).
      const p = payloadAlVolver(entrada.view, guardado)
      const v = perdido ? (sinPayloadRef.current[entrada.view] ?? entrada.view) : entrada.view
      return { entrada, v, p, perdido }
    }

    const irA = (d: ReturnType<typeof destinoDe>) => {
      if (d == null) {
        // El tope (o una entrada que no es de la app): ya no hay adónde volver.
        window.location.reload()
        return
      }
      if (d.perdido) window.history.replaceState({ ...d.entrada, view: d.v, conPayload: false }, '')
      aplicar(d.v, d.p)
    }

    const alVolver = (e: PopStateEvent) => {
      const d = destinoDe(e.state)
      if (!haySinGuardar() && !guardandoAhora()) {
        irA(d)
        return
      }
      const { view: v, payload: p } = actual.current
      // Con el diálogo abierto se volvió a la entrada de la vista en pantalla
      // (adelante), o a otra entrada de la misma factura: es quedarse.
      if (d != null && mismoDestino(d.v, d.p, v, p)) {
        cerrarSalida()
        return
      }
      // El navegador ya cambió de entrada y eso no se cancela: la vista sigue en
      // pantalla. Para quedarse se vuelve a apilar su entrada.
      const reponer = () => {
        // Si se había vuelto hasta el tope, el clic en el diálogo ya la
        // apiló (ver armar): otra copia haría que "atrás" no hiciera nada.
        const s: unknown = window.history.state
        const yaEsta = esVista(s) && mismoDestino(s.view, payloads.current.get(s.key) ?? null, v, p)
        if (!yaEsta) window.history.pushState(crearEntrada(v, p), '')
      }
      // Guardando: como en nav(), se espera a que termine.
      if (guardandoAhora()) {
        reponer()
        return
      }
      abrirSalida({ salir: () => irA(d), quedarse: reponer })
    }

    const alInteractuar = (e: Event) => {
      if (e instanceof KeyboardEvent && TECLAS_SIN_ACTIVACION.has(e.key)) return
      armar()
    }

    window.addEventListener('popstate', alVolver)
    // Captura: corre antes que el onClick que pueda llamar a nav().
    window.addEventListener('pointerup', alInteractuar, true)
    window.addEventListener('keydown', alInteractuar, true)
    return () => {
      window.removeEventListener('popstate', alVolver)
      window.removeEventListener('pointerup', alInteractuar, true)
      window.removeEventListener('keydown', alInteractuar, true)
    }
  }, [abrirSalida, aplicar, armar, cerrarSalida, crearEntrada])

  return { view, payload, nav, salidaPendiente, confirmarSalida }
}

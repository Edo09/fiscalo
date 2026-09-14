// Botón "atrás" del navegador dentro de Fiscalo.
//
// La app no tiene una URL por vista: navegar es cambiar `view` en memoria. Sin
// esto, toda la sesión vive en UNA sola entrada del historial y "atrás" saca al
// usuario de la app. Aquí cada nav() apila una entrada (pushState) y el popstate
// de atrás/adelante vuelve a la vista de esa entrada.
//
// Debajo de la primera vista queda una entrada "tope": llegar a ella significa
// que ya no hay adónde volver dentro de la app, y en vez de salir se recarga.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isNuevoSignal, type Nav, type NavPayload, type ViewId } from '@/config/navigation'

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

export function useHistoryNav({ inicial, sinPayload, onCambio }: Opciones): {
  view: ViewId
  payload: NavPayload
  nav: Nav
} {
  const [view, setView] = useState<ViewId>(inicial)
  const [payload, setPayload] = useState<NavPayload>(null)

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

  const aplicar = useCallback((v: ViewId, p: NavPayload) => {
    actual.current = { view: v, payload: p }
    setView(v)
    setPayload(p)
    onCambioRef.current?.()
  }, [])

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

  const nav = useCallback<Nav>((v, p = null, opts) => {
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

  useEffect(() => {
    // Tras recargar a mitad del historial la vista sale de restoreView y el
    // payload ya no está: la entrada se alinea con lo que de verdad se muestra.
    const s: unknown = window.history.state
    if (esVista(s) && (s.view !== actual.current.view || s.conPayload)) {
      window.history.replaceState({ ...s, view: actual.current.view, conPayload: false }, '')
    }

    const alVolver = (e: PopStateEvent) => {
      const entrada: unknown = e.state
      if (!esVista(entrada)) {
        // El tope (o una entrada que no es de la app): ya no hay adónde volver.
        window.location.reload()
        return
      }
      const perdido = entrada.conPayload && !payloads.current.has(entrada.key)
      const guardado = payloads.current.get(entrada.key) ?? null
      // "Nueva → Gasto" abre el formulario al llegar; al volver no se repite.
      const p = isNuevoSignal(guardado) ? null : guardado
      const v = perdido ? (sinPayloadRef.current[entrada.view] ?? entrada.view) : entrada.view
      if (perdido) window.history.replaceState({ ...entrada, view: v, conPayload: false }, '')
      aplicar(v, p)
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
  }, [aplicar, armar])

  return { view, payload, nav }
}

// Pantalla del cajero con su sesión abierta (api-gratex docs/specs/pos.md §6.2,
// §6.3 y A7): catálogo táctil a la izquierda y la venta en curso a la derecha.
// Por ahora se arma la venta; el cobro, la emisión y la impresión llegan en la
// semana 3 (§12). El lector de código de barras quedó para después del piloto.
//
// - Catálogo: se pide al entrar y cada 5 minutos (C1). Si una actualización
//   falla, se sigue con el último.
// - Bloqueo de pantalla manual y a los 10 minutos sin actividad. El carrito se
//   conserva (vive en carrito.ts).
// - Teclado: F1 va al buscador; Esc limpia la búsqueda o, si no hay, ofrece
//   cancelar la venta.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type EstadoPos } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { useCarritoStore, type LineaCarrito } from './carrito'
import { CatalogoPanel } from './CatalogoPanel'
import { CarritoPanel } from './CarritoPanel'
import { CantidadModal, ConfirmarModal } from './PosModales'

/** Minutos sin tocar la pantalla antes de bloquearla (docs/specs/pos.md §8, punto 5). */
export const BLOQUEO_INACTIVIDAD_MIN = 10
/** Cada cuánto se vuelve a pedir el catálogo (C1). */
const CATALOGO_CADA_MS = 5 * 60_000

interface Props {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  /** La sesion se cerro (bloqueo, vencida o cerrada desde otro lado): volver al PIN. */
  onBloqueada: () => void
  onEquipoInvalido: (motivo: string) => void
}

type Modal = { tipo: 'cantidad'; linea: LineaCarrito } | { tipo: 'cancelar' } | null

function useReloj(): string {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return ahora.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })
}

export function VentaView({ equipo, sesion, onBloqueada, onEquipoInvalido }: Props) {
  const reloj = useReloj()
  const [estado, setEstado] = useState<EstadoPos | null>(null)
  const [bloqueando, setBloqueando] = useState(false)
  const ultimaActividad = useRef(Date.now())

  const { lineas, catalogo, agregar, cambiarCantidad, quitar, vaciar, guardarCatalogo } = useCarritoStore()
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState<number | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const buscadorRef = useRef<HTMLInputElement>(null)

  const bloquear = useCallback(async () => {
    setBloqueando(true)
    try {
      await posApi.salir(equipo.token, sesion.token)
    } catch {
      // Sin red o sesion ya cerrada: igual se vuelve al PIN (la sesion vence sola).
    }
    onBloqueada()
  }, [equipo.token, sesion.token, onBloqueada])

  /** Errores que cambian de pantalla; devuelve true si ya se atendió. */
  const errorDeSesion = useCallback((e: unknown): boolean => {
    if (!(e instanceof PosApiError)) return false
    if (e.codigo === 'SESION_REQUERIDA') { onBloqueada(); return true }
    if (e.codigo === 'EQUIPO_NO_HABILITADO') { onEquipoInvalido(e.message); return true }
    return false
  }, [onBloqueada, onEquipoInvalido])

  // Estado de la caja con la sesion; si la sesion ya no vale, al PIN.
  useEffect(() => {
    let vivo = true
    const cargar = () => posApi.estado(equipo.token, sesion.token)
      .then((r) => {
        if (!vivo) return
        if (r.empleado === null) { onBloqueada(); return }
        setEstado(r)
      })
      .catch((e) => { if (vivo) errorDeSesion(e) })
    void cargar()
    const id = window.setInterval(cargar, 60_000)
    return () => { vivo = false; window.clearInterval(id) }
  }, [equipo.token, sesion.token, onBloqueada, errorDeSesion])

  // Catálogo (C1): al entrar y cada 5 minutos.
  const vivoRef = useRef(true)
  const cargarCatalogo = useCallback(async () => {
    try {
      const c = await posApi.catalogo(equipo.token, sesion.token)
      if (!vivoRef.current) return
      guardarCatalogo(c)
      setErrorCatalogo(null)
    } catch (e) {
      if (!vivoRef.current || errorDeSesion(e)) return
      setErrorCatalogo(e instanceof PosApiError ? e.message : 'No se pudo cargar el catálogo.')
    }
  }, [equipo.token, sesion.token, guardarCatalogo, errorDeSesion])

  useEffect(() => {
    vivoRef.current = true
    void cargarCatalogo()
    const id = window.setInterval(() => void cargarCatalogo(), CATALOGO_CADA_MS)
    return () => { vivoRef.current = false; window.clearInterval(id) }
  }, [cargarCatalogo])

  // Bloqueo por inactividad: cualquier toque, tecla o movimiento cuenta.
  useEffect(() => {
    const marcar = () => { ultimaActividad.current = Date.now() }
    const eventos = ['pointerdown', 'keydown', 'pointermove', 'wheel'] as const
    eventos.forEach((ev) => window.addEventListener(ev, marcar, { passive: true }))
    const id = window.setInterval(() => {
      if (Date.now() - ultimaActividad.current > BLOQUEO_INACTIVIDAD_MIN * 60_000) void bloquear()
    }, 15_000)
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, marcar))
      window.clearInterval(id)
    }
  }, [bloquear])

  // Atajos (V6, sin los del cobro todavía). Con un diálogo abierto, manda el diálogo.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal !== null) return
      if (e.key === 'F1') {
        e.preventDefault()
        buscadorRef.current?.focus()
        buscadorRef.current?.select()
      } else if (e.key === 'Escape') {
        if (busqueda !== '') { e.preventDefault(); setBusqueda('') } else if (lineas.length > 0) { e.preventDefault(); setModal({ tipo: 'cancelar' }) }
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modal, busqueda, lineas.length])

  const enCarrito = useMemo(() => new Map(lineas.map((l) => [l.productoId, l.cantidad])), [lineas])

  const empresa = estado?.empresa.nombre ?? equipo.empresa ?? ''

  return (
    <>
      <header className="pos-barra">
        <Icon name="store" size={22} style={{ color: 'var(--accent)' }} />
        <div className="pos-barra-dato ocultable"><small>Empresa</small><b>{empresa || '—'}</b></div>
        <div className="pos-barra-dato"><small>Caja</small><b>{equipo.caja.nombre}</b></div>
        <div className="pos-barra-dato">
          <small>{sesion.empleado.rol === 'supervisor' ? 'Supervisor' : 'Cajero'}</small>
          <b>{sesion.empleado.nombre}</b>
        </div>
        <div className="pos-barra-espacio" />
        <span className="pos-reloj">{reloj}</span>
        <Btn icon="lock" onClick={() => void bloquear()} disabled={bloqueando}>Bloquear</Btn>
      </header>

      <main className="pos-venta">
        <CatalogoPanel
          catalogo={catalogo}
          error={errorCatalogo}
          onReintentar={() => void cargarCatalogo()}
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          categoria={categoria}
          onCategoria={setCategoria}
          buscadorRef={buscadorRef}
          enCarrito={enCarrito}
          onAgregar={agregar}
        />
        <CarritoPanel
          lineas={lineas}
          onMas={(l) => cambiarCantidad(l.productoId, Math.min(l.cantidad + 1, 99999))}
          onMenos={(l) => { if (l.cantidad > 1) cambiarCantidad(l.productoId, Math.round((l.cantidad - 1) * 100) / 100) }}
          onCantidad={(l) => setModal({ tipo: 'cantidad', linea: l })}
          onQuitar={(l) => quitar(l.productoId)}
          onCancelar={() => setModal({ tipo: 'cancelar' })}
        />
      </main>

      {modal?.tipo === 'cantidad' && (
        <CantidadModal
          linea={modal.linea}
          onCerrar={() => setModal(null)}
          onAceptar={(cantidad) => { cambiarCantidad(modal.linea.productoId, cantidad); setModal(null) }}
        />
      )}
      {modal?.tipo === 'cancelar' && (
        <ConfirmarModal
          titulo="¿Cancelar la venta?"
          texto={`Se ${lineas.length === 1 ? 'quita el producto' : `quitan los ${lineas.length} productos`} del carrito. No se emite nada.`}
          confirmar="Sí, cancelar venta"
          onCerrar={() => setModal(null)}
          onConfirmar={() => { vaciar(); setModal(null); setBusqueda('') }}
        />
      )}
    </>
  )
}

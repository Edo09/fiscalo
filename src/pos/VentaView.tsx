// Pantalla del cajero con su sesión abierta (api-gratex docs/specs/pos.md §6.2,
// §6.3, §6.5, K2-K5 y A7): catálogo táctil a la izquierda, la venta en curso a
// la derecha y el cobro en un diálogo. El lector de código de barras quedó para
// después del piloto.
//
// - Catálogo: se pide al entrar, cada 5 minutos y después de cada venta (C1).
// - Turno: sin turno propio abierto no se cobra. Al entrar sin turno se ofrece
//   abrirlo; con el de otro cajero se avisa (lo cierra un supervisor, K4).
// - Envíos pendientes (F7): se reintentan cada 2 minutos, también con la
//   pantalla en uso. Si la DGII rechaza una venta ya entregada, queda una
//   alerta hasta que alguien la lea.
// - Cierre (K6-K8): el propio o, con PIN de supervisor, el de otro cajero. Al
//   terminar el propio, la pantalla se bloquea (cambio de turno).
// - Ventas canceladas y líneas quitadas se registran para el cierre (V4).
// - Bloqueo de pantalla manual y a los 10 minutos sin actividad. El carrito se
//   conserva (vive en carrito.ts).
// - Crédito fiscal (F2 de la spec): el cajero escribe el RNC o la cédula y la
//   venta pasa a E31 a nombre de ese cliente, con su descuento (V5).
// - Teclado: F1 buscador; F9 / F2 / F3 cobrar en efectivo / tarjeta /
//   transferencia; F4 crédito fiscal; Esc limpia la búsqueda o ofrece cancelar
//   la venta.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type EstadoPos, type FormaPago, type Reenvio, type TurnoCaja } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { useCarritoStore, type LineaCarrito } from './carrito'
import { CatalogoPanel } from './CatalogoPanel'
import { CarritoPanel } from './CarritoPanel'
import { CantidadModal, ConfirmarModal } from './PosModales'
import { CobroModal } from './CobroModal'
import { AperturaTurnoModal, ImpresoraModal, SupervisorPinModal, TurnoModal } from './CajaModales'
import { CierreModal } from './CierreModal'
import { ClienteRncModal } from './ClienteRncModal'
import { VentasDiaModal } from './VentasDiaModal'
import { totalesCarrito } from './montos'

/** Minutos sin tocar la pantalla antes de bloquearla (docs/specs/pos.md §8, punto 5). */
export const BLOQUEO_INACTIVIDAD_MIN = 10
/** Cada cuánto se vuelve a pedir el catálogo (C1). */
const CATALOGO_CADA_MS = 5 * 60_000
/** Cada cuánto se reintentan los envíos pendientes a la DGII (§9.6, sin cron). */
const PENDIENTES_CADA_MS = 2 * 60_000

interface Props {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  /** La sesion se cerro (bloqueo, vencida o cerrada desde otro lado): volver al PIN. */
  onBloqueada: () => void
  onEquipoInvalido: (motivo: string) => void
}

type Modal =
  | { tipo: 'cantidad'; linea: LineaCarrito }
  | { tipo: 'cancelar' }
  | { tipo: 'cobro'; forma: FormaPago }
  | { tipo: 'apertura' }
  | { tipo: 'impresora' }
  | { tipo: 'turno' }
  | { tipo: 'supervisor' }
  | { tipo: 'cliente' }
  | { tipo: 'ventasDia' }
  /**
   * permiso: del supervisor (turno ajeno); null si cierra el propio o un supervisor.
   * turno: copia del que se cierra; el estado lo pierde apenas se cierra y el
   * resultado tiene que seguir en pantalla.
   */
  | { tipo: 'cierre'; permiso: string | null; propio: boolean; turno: TurnoCaja; cuenta: string }
  | null

function useReloj(): string {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return ahora.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })
}

const hora = (fecha: string) => new Date(fecha.replace(' ', 'T')).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })

export function VentaView({ equipo, sesion, onBloqueada, onEquipoInvalido }: Props) {
  const reloj = useReloj()
  const [estado, setEstado] = useState<EstadoPos | null>(null)
  const [bloqueando, setBloqueando] = useState(false)
  const ultimaActividad = useRef(Date.now())

  const { lineas, catalogo, cliente, cobroEnDuda, agregar, cambiarCantidad, quitar, vaciar, ponerCliente, guardarCatalogo } = useCarritoStore()
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState<number | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const buscadorRef = useRef<HTMLInputElement>(null)
  const [pendientes, setPendientes] = useState(0)
  const [rechazadas, setRechazadas] = useState<Reenvio['rechazadas']>([])
  const aperturaOfrecida = useRef(false)

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

  // Estado de la caja con la sesion (turno incluido); si la sesion ya no vale, al PIN.
  const vivoRef = useRef(true)
  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false }
  }, [])
  const cargarEstado = useCallback(async () => {
    try {
      const r = await posApi.estado(equipo.token, sesion.token)
      if (!vivoRef.current) return
      if (r.empleado === null) { onBloqueada(); return }
      setEstado(r)
    } catch (e) {
      if (vivoRef.current) errorDeSesion(e)
    }
  }, [equipo.token, sesion.token, onBloqueada, errorDeSesion])

  useEffect(() => {
    void cargarEstado()
    const id = window.setInterval(() => void cargarEstado(), 60_000)
    return () => window.clearInterval(id)
  }, [cargarEstado])

  // Catálogo (C1): al entrar y cada 5 minutos.
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
    void cargarCatalogo()
    const id = window.setInterval(() => void cargarCatalogo(), CATALOGO_CADA_MS)
    return () => window.clearInterval(id)
  }, [cargarCatalogo])

  // Envíos pendientes (F7): al entrar y cada 2 minutos.
  const reenviar = useCallback(async () => {
    try {
      const r = await posApi.reenviarPendientes(equipo.token)
      if (!vivoRef.current) return
      setPendientes(r.pendientes)
      if (r.rechazadas.length > 0) {
        setRechazadas((prev) => [...prev, ...r.rechazadas.filter((x) => !prev.some((p) => p.factura_id === x.factura_id))])
      }
    } catch {
      // Sin red: se intenta en la próxima vuelta.
    }
  }, [equipo.token])

  useEffect(() => {
    void reenviar()
    const id = window.setInterval(() => void reenviar(), PENDIENTES_CADA_MS)
    return () => window.clearInterval(id)
  }, [reenviar])

  // Bloqueo por inactividad: cualquier toque, tecla o movimiento cuenta.
  useEffect(() => {
    const marcar = () => { ultimaActividad.current = Date.now() }
    const eventos = ['pointerdown', 'keydown', 'pointermove', 'wheel'] as const
    eventos.forEach((ev) => window.addEventListener(ev, marcar, { passive: true }))
    const id = window.setInterval(() => {
      // Nunca a mitad de un cobro: el diálogo tiene que terminar.
      if (modal?.tipo === 'cobro') return
      if (Date.now() - ultimaActividad.current > BLOQUEO_INACTIVIDAD_MIN * 60_000) void bloquear()
    }, 15_000)
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, marcar))
      window.clearInterval(id)
    }
  }, [bloquear, modal])

  // --- Turno (K2-K5) ---------------------------------------------------------
  const turno = estado?.turno_caja ?? null
  const turnoPropio = turno !== null && turno.empleado_id === sesion.empleado.id
  const turnoAjeno = turno !== null && !turnoPropio
  // Al entrar sin turno, se ofrece abrirlo una vez; después, al intentar cobrar.
  useEffect(() => {
    if (estado && turno === null && !aperturaOfrecida.current && modal === null) {
      aperturaOfrecida.current = true
      setModal({ tipo: 'apertura' })
    }
  }, [estado, turno, modal])

  const motivoNoCobrar = !estado
    ? 'Cargando la caja…'
    : turnoAjeno
      ? `La caja tiene el turno abierto de ${turno?.empleado_nombre ?? 'otro cajero'}. Un supervisor tiene que cerrarlo.`
      : null

  // Cierre (K4, K6): el propio, o el de otro (supervisor en sesión, o con su PIN).
  // El propio no con una venta a medias; ninguno con un cobro sin confirmar.
  const motivoNoCerrar = cobroEnDuda
    ? 'Hay un cobro sin confirmar: reinténtalo antes de cerrar el turno.'
    : turnoPropio && lineas.length > 0
      ? 'Hay una venta en curso: cóbrala o cancélala antes de cerrar el turno.'
      : null
  const iniciarCierre = useCallback(() => {
    if (!turno || motivoNoCerrar) return
    if (turnoPropio || sesion.empleado.rol === 'supervisor') setModal({ tipo: 'cierre', permiso: null, propio: turnoPropio, turno, cuenta: sesion.empleado.nombre })
    else setModal({ tipo: 'supervisor' })
  }, [turno, motivoNoCerrar, turnoPropio, sesion.empleado.rol, sesion.empleado.nombre])

  // V4: lo que sale del carrito sin cobrarse queda registrado para el cierre
  // (con el descuento del cliente, si lo hay: lo que se habría cobrado).
  const registrarEvento = useCallback((tipo: 'cancelada' | 'quitada', ls: LineaCarrito[]) => {
    if (ls.length === 0) return
    const monto = totalesCarrito(ls, cliente?.descuento ?? 0).total
    posApi.evento(equipo.token, sesion.token, tipo, monto, ls.map((l) => ({ product_id: l.productoId, nombre: l.nombre, cantidad: l.cantidad })))
      .catch(() => { /* sin red: se pierde este registro, la venta sigue */ })
  }, [equipo.token, sesion.token, cliente])

  // Botones de la tarjeta del catálogo. El −: una unidad menos; con una sola (o
  // menos, si es fraccionaria) sale de la venta. Quitar: fuera con todas sus
  // unidades. Las dos salidas quedan registradas como la papelera del carrito (V4).
  const quitarUno = useCallback((p: { id: number }) => {
    const l = lineas.find((x) => x.productoId === p.id)
    if (!l || cobroEnDuda) return
    if (l.cantidad > 1) cambiarCantidad(l.productoId, Math.round((l.cantidad - 1) * 100) / 100)
    else { registrarEvento('quitada', [l]); quitar(l.productoId) }
  }, [lineas, cobroEnDuda, cambiarCantidad, registrarEvento, quitar])
  const quitarDeVenta = useCallback((p: { id: number }) => {
    const l = lineas.find((x) => x.productoId === p.id)
    if (!l || cobroEnDuda) return
    registrarEvento('quitada', [l])
    quitar(l.productoId)
  }, [lineas, cobroEnDuda, registrarEvento, quitar])

  const abrirCobro = useCallback((forma: FormaPago) => {
    if (cobroEnDuda) { setModal({ tipo: 'cobro', forma: cobroEnDuda.forma_pago }); return }
    if (lineas.length === 0 || !estado || turnoAjeno) return
    if (!turnoPropio) { setModal({ tipo: 'apertura' }); return }
    setModal({ tipo: 'cobro', forma })
  }, [cobroEnDuda, lineas.length, estado, turnoAjeno, turnoPropio])

  // Atajos (V6). Con un diálogo abierto, manda el diálogo.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal !== null) return
      if (e.key === 'F1') {
        e.preventDefault()
        buscadorRef.current?.focus()
        buscadorRef.current?.select()
      } else if (e.key === 'F9' || e.key === 'F2' || e.key === 'F3') {
        e.preventDefault()
        abrirCobro(e.key === 'F9' ? 1 : e.key === 'F2' ? 3 : 2)
      } else if (e.key === 'F4') {
        e.preventDefault()
        if (!cobroEnDuda) setModal({ tipo: 'cliente' })
      } else if (e.key === 'Escape') {
        if (busqueda !== '') { e.preventDefault(); setBusqueda('') } else if (lineas.length > 0 && !cobroEnDuda) { e.preventDefault(); setModal({ tipo: 'cancelar' }) }
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modal, busqueda, lineas.length, cobroEnDuda, abrirCobro])

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
        {pendientes > 0 && (
          <span className="pos-pendientes" title="Ventas que la DGII todavía no confirmó: se reenvían solas">
            <Icon name="clock" size={15} />{pendientes} <span className="ocultable">sin confirmar DGII</span>
          </span>
        )}
        <span className="pos-reloj">{reloj}</span>
        <Btn icon="receipt" onClick={() => setModal({ tipo: 'ventasDia' })} aria-label="Ventas del día"><span className="ocultable">Ventas del día</span></Btn>
        <Btn icon="clock" onClick={() => setModal({ tipo: 'turno' })} disabled={!estado} aria-label="Turno y ventas del turno"><span className="ocultable">Turno</span></Btn>
        <Btn icon="printer" onClick={() => setModal({ tipo: 'impresora' })} aria-label="Impresora de recibos"><span className="ocultable">Impresora</span></Btn>
        <Btn icon="lock" onClick={() => void bloquear()} disabled={bloqueando || modal?.tipo === 'cobro'}>Bloquear</Btn>
      </header>

      {rechazadas.length > 0 && (
        <div className="pos-alerta" role="alert">
          <Icon name="alert-triangle" size={18} />
          <span>
            <b>La DGII rechazó {rechazadas.length === 1 ? 'una venta que ya se había entregado' : `${rechazadas.length} ventas que ya se habían entregado`}:</b>{' '}
            {rechazadas.map((r) => `${r.e_ncf} (${r.motivo})`).join(' · ')} Avisa al supervisor.
          </span>
          <Btn size="sm" onClick={() => setRechazadas([])}>Entendido</Btn>
        </div>
      )}
      {turnoAjeno && turno && (
        <div className="pos-franja aviso">
          <Icon name="alert-triangle" size={16} />
          <span>Turno abierto de <b>{turno.empleado_nombre}</b> (desde las {hora(turno.abierto_at)}): para vender, un supervisor tiene que cerrarlo primero.</span>
          <Btn size="sm" icon="lock" onClick={iniciarCierre} disabled={motivoNoCerrar !== null}>
            {sesion.empleado.rol === 'supervisor' ? 'Cerrar su turno' : 'Cerrar su turno (supervisor)'}
          </Btn>
        </div>
      )}
      {turnoPropio && turno && turno.de_dia_anterior && (
        <div className="pos-franja aviso">
          <Icon name="clock" size={16} />
          <span>Tu turno está abierto desde un día anterior ({turno.abierto_at.slice(0, 16)}). Ciérralo al terminar el día.</span>
        </div>
      )}

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
          onQuitarUno={quitarUno}
          onQuitar={quitarDeVenta}
          bloqueado={cobroEnDuda !== null}
        />
        <CarritoPanel
          lineas={lineas}
          cliente={cliente}
          enDuda={cobroEnDuda !== null}
          puedeCobrar={motivoNoCobrar === null}
          motivoNoCobrar={motivoNoCobrar}
          sinTurno={estado !== null && turno === null}
          onCobrar={() => abrirCobro(1)}
          onAbrirTurno={() => setModal({ tipo: 'apertura' })}
          onMas={(l) => cambiarCantidad(l.productoId, Math.min(l.cantidad + 1, 99999))}
          onMenos={(l) => { if (l.cantidad > 1) cambiarCantidad(l.productoId, Math.round((l.cantidad - 1) * 100) / 100) }}
          onCantidad={(l) => setModal({ tipo: 'cantidad', linea: l })}
          onQuitar={(l) => { registrarEvento('quitada', [l]); quitar(l.productoId) }}
          onCancelar={() => setModal({ tipo: 'cancelar' })}
          onCliente={() => setModal({ tipo: 'cliente' })}
          onQuitarCliente={() => ponerCliente(null)}
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
          onConfirmar={() => { registrarEvento('cancelada', lineas); vaciar(); setModal(null); setBusqueda('') }}
        />
      )}
      {modal?.tipo === 'cobro' && (
        <CobroModal
          equipo={equipo}
          sesion={sesion}
          formaInicial={modal.forma}
          onCerrar={() => setModal(null)}
          onNuevaVenta={() => {
            vaciar()
            setModal(null)
            setBusqueda('')
            void cargarCatalogo()
            void reenviar()
          }}
          errorDeSesion={errorDeSesion}
          onRefrescarCatalogo={() => void cargarCatalogo()}
          onRefrescarEstado={() => void cargarEstado()}
        />
      )}
      {modal?.tipo === 'apertura' && (
        <AperturaTurnoModal
          equipo={equipo}
          sesion={sesion}
          errorDeSesion={errorDeSesion}
          onCerrar={() => setModal(null)}
          onAbierto={(t) => {
            setEstado((e) => (e ? { ...e, turno_caja: t } : e))
            setModal(null)
          }}
        />
      )}
      {modal?.tipo === 'cliente' && (
        <ClienteRncModal
          equipo={equipo}
          sesion={sesion}
          errorDeSesion={errorDeSesion}
          onCerrar={() => setModal(null)}
          onElegido={(c) => { ponerCliente(c); setModal(null) }}
        />
      )}
      {modal?.tipo === 'ventasDia' && (
        <VentasDiaModal equipo={equipo} sesion={sesion} errorDeSesion={errorDeSesion} onCerrar={() => setModal(null)} />
      )}
      {modal?.tipo === 'impresora' && <ImpresoraModal caja={equipo.caja.nombre} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'turno' && (
        <TurnoModal
          equipo={equipo}
          sesion={sesion}
          turno={turno}
          puedeCerrar={turno !== null && motivoNoCerrar === null}
          motivoNoCerrar={motivoNoCerrar}
          onCerrarTurno={iniciarCierre}
          onAbrirTurno={() => setModal({ tipo: 'apertura' })}
          onCerrar={() => setModal(null)}
          errorDeSesion={errorDeSesion}
        />
      )}
      {modal?.tipo === 'supervisor' && turno && (
        <SupervisorPinModal
          equipo={equipo}
          sesion={sesion}
          turno={turno}
          errorDeSesion={errorDeSesion}
          onCerrar={() => setModal(null)}
          onAutorizado={(permiso, supervisor) => setModal({ tipo: 'cierre', permiso, propio: false, turno, cuenta: supervisor })}
        />
      )}
      {modal?.tipo === 'cierre' && (
        <CierreModal
          equipo={equipo}
          sesion={sesion}
          turno={modal.turno}
          permiso={modal.permiso}
          cuenta={modal.cuenta}
          empresa={empresa || null}
          errorDeSesion={errorDeSesion}
          onCancelar={() => setModal(null)}
          onCerrado={() => { void cargarEstado() }}
          onTerminar={() => {
            if (modal.propio) {
              // Fin del turno propio: la caja queda lista para el siguiente.
              setModal(null)
              void bloquear()
            } else {
              aperturaOfrecida.current = true
              setModal({ tipo: 'apertura' })
            }
          }}
        />
      )}
    </>
  )
}

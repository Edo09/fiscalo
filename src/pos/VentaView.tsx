// Pantalla del cajero con su sesion abierta. La venta llega en la semana 3
// (docs/specs/pos.md §12); por ahora: barra de la caja, bloqueo de pantalla
// (A7, manual y a los 10 minutos sin actividad) y el turno de la caja.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type EstadoPos } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'

/** Minutos sin tocar la pantalla antes de bloquearla (docs/specs/pos.md §8, punto 5). */
export const BLOQUEO_INACTIVIDAD_MIN = 10

interface Props {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  /** La sesion se cerro (bloqueo, vencida o cerrada desde otro lado): volver al PIN. */
  onBloqueada: () => void
  onEquipoInvalido: (motivo: string) => void
}

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

  const bloquear = useCallback(async () => {
    setBloqueando(true)
    try {
      await posApi.salir(equipo.token, sesion.token)
    } catch {
      // Sin red o sesion ya cerrada: igual se vuelve al PIN (la sesion vence sola).
    }
    onBloqueada()
  }, [equipo.token, sesion.token, onBloqueada])

  // Estado de la caja con la sesion; si la sesion ya no vale, al PIN.
  useEffect(() => {
    let vivo = true
    const cargar = () => posApi.estado(equipo.token, sesion.token)
      .then((r) => {
        if (!vivo) return
        if (r.empleado === null) { onBloqueada(); return }
        setEstado(r)
      })
      .catch((e) => {
        if (!vivo || !(e instanceof PosApiError)) return
        if (e.codigo === 'EQUIPO_NO_HABILITADO') onEquipoInvalido(e.message)
      })
    void cargar()
    const id = window.setInterval(cargar, 60_000)
    return () => { vivo = false; window.clearInterval(id) }
  }, [equipo.token, sesion.token, onBloqueada, onEquipoInvalido])

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

  const turno = estado?.turno_caja ?? null
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

      <main className="pos-cuerpo">
        <div className="pos-panel" style={{ textAlign: 'center' }}>
          <Icon name="shopping-cart" size={34} style={{ color: 'var(--accent)' }} />
          <h1 className="pos-titulo">Hola, {sesion.empleado.nombre}</h1>
          <p className="pos-sub">
            Este equipo ya está listo como <b>{equipo.caja.nombre}</b>. La pantalla de venta
            (catálogo, escáner, cobro e impresión) llega en la próxima entrega.
          </p>
          {turno ? (
            <div className={turno.de_dia_anterior ? 'pos-aviso' : 'pos-info'} style={{ textAlign: 'left' }}>
              <Icon name="clock" size={16} />
              <span>Turno abierto de <b>{turno.empleado_nombre}</b>{turno.de_dia_anterior ? ', desde un día anterior' : ''}.</span>
            </div>
          ) : (
            <div className="pos-info" style={{ textAlign: 'left' }}>
              <Icon name="info" size={16} />
              <span>La caja no tiene un turno abierto. La apertura con fondo llega junto con la venta.</span>
            </div>
          )}
          <p className="pos-sub" style={{ fontSize: 13, marginBottom: 0 }}>
            La pantalla se bloquea sola después de {BLOQUEO_INACTIVIDAD_MIN} minutos sin uso.
          </p>
        </div>
      </main>
    </>
  )
}

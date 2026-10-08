// Entrar con el PIN (docs/specs/pos.md A6). Teclado en pantalla de 4 digitos,
// tambien con el teclado fisico (digitos, Borrar, Escape). Se envia solo al
// completar los 4 digitos: un toque menos en mostrador.
//
// Bloqueo: tras 5 PIN incorrectos el servidor bloquea el equipo y responde los
// segundos que faltan (cada bloqueo seguido dura el doble). Aqui solo se
// muestra la cuenta regresiva; el bloqueo real lo lleva el servidor, asi que
// recargar la pagina no lo salta.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui'
import { posApi, PosApiError, type EstadoPos, type SesionPos } from './api'
import type { EquipoGuardado } from './store'

export const DIGITOS_PIN = 4

interface Props {
  equipo: EquipoGuardado
  onEntro: (s: SesionPos) => void
  /** El servidor dijo que este equipo ya no esta habilitado. */
  onEquipoInvalido: (motivo: string) => void
  /** La empresa no tiene el POS activo (o esta inactiva). */
  onSinPos: (motivo: string) => void
  /** Un admin quiere habilitar este equipo de nuevo (otra caja, otra empresa). */
  onRehabilitar: () => void
}

function formatoCuenta(seg: number): string {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

function horaCorta(fecha: string): string {
  const d = new Date(fecha.replace(' ', 'T'))
  return isNaN(d.getTime()) ? fecha : d.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })
}

export function PinView({ equipo, onEntro, onEquipoInvalido, onSinPos, onRehabilitar }: Props) {
  const [pin, setPin] = useState('')
  const [estado, setEstado] = useState<EstadoPos | null>(null)
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null)
  const [temblor, setTemblor] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [bloqueoHasta, setBloqueoHasta] = useState<number | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const [cajaInactiva, setCajaInactiva] = useState<string | null>(null)
  const enviandoRef = useRef(false)

  const manejarError = useCallback((e: unknown) => {
    if (!(e instanceof PosApiError)) {
      setMensaje({ texto: 'Ocurrió un error inesperado. Inténtalo de nuevo.', error: true })
      return
    }
    switch (e.codigo) {
      case 'EQUIPO_NO_HABILITADO':
        onEquipoInvalido(e.message)
        return
      case 'POS_INACTIVO':
      case 'EMPRESA_INACTIVA':
        onSinPos(e.message)
        return
      case 'EQUIPO_BLOQUEADO': {
        const seg = Number(e.extra.bloqueo_segundos ?? 0)
        setBloqueoHasta(Date.now() + seg * 1000)
        setMensaje(null)
        return
      }
      case 'CAJA_INACTIVA':
        setCajaInactiva(e.message)
        return
      case 'PIN_INCORRECTO': {
        const quedan = Number(e.extra.intentos_restantes ?? 0)
        setMensaje({
          texto: quedan === 1 ? 'PIN incorrecto. Queda 1 intento antes de bloquear el equipo.' : `PIN incorrecto. Quedan ${quedan} intentos.`,
          error: true,
        })
        setTemblor(true)
        window.setTimeout(() => setTemblor(false), 400)
        return
      }
      default:
        setMensaje({ texto: e.message, error: true })
    }
  }, [onEquipoInvalido, onSinPos])

  // Estado del equipo al entrar y cada minuto (turno de la caja, bloqueo).
  useEffect(() => {
    let vivo = true
    const cargar = () => posApi.estado(equipo.token)
      .then((r) => {
        if (!vivo) return
        setEstado(r)
        if (r.equipo.bloqueado) setBloqueoHasta(Date.now() + r.equipo.bloqueo_segundos * 1000)
        if (r.caja && !r.caja.activa) setCajaInactiva('La caja de este equipo está desactivada. Pide a un administrador que la active.')
      })
      .catch((e) => { if (vivo) manejarError(e) })
    void cargar()
    const id = window.setInterval(cargar, 60_000)
    return () => { vivo = false; window.clearInterval(id) }
  }, [equipo.token, manejarError])

  // Cuenta regresiva del bloqueo.
  useEffect(() => {
    if (bloqueoHasta === null) return
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [bloqueoHasta])
  const segundosBloqueo = bloqueoHasta === null ? 0 : Math.max(0, Math.ceil((bloqueoHasta - ahora) / 1000))
  const bloqueado = segundosBloqueo > 0
  useEffect(() => {
    if (bloqueoHasta !== null && segundosBloqueo === 0) setBloqueoHasta(null)
  }, [bloqueoHasta, segundosBloqueo])

  const deshabilitado = bloqueado || enviando || cajaInactiva !== null

  const enviar = useCallback(async (completo: string) => {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    setMensaje(null)
    try {
      onEntro(await posApi.entrar(equipo.token, completo))
    } catch (e) {
      manejarError(e)
      setPin('')
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }, [equipo.token, onEntro, manejarError])

  const tocar = useCallback((d: string) => {
    if (deshabilitado) return
    setMensaje(null)
    setPin((p) => (p.length >= DIGITOS_PIN ? p : p + d))
  }, [deshabilitado])

  // La version vigente de `enviar`, para que el efecto de abajo dependa solo del PIN.
  const enviarRef = useRef(enviar)
  useEffect(() => { enviarRef.current = enviar }, [enviar])

  // Completo el PIN, se envia solo, UNA vez por PIN tecleado. En un efecto y no
  // dentro de setPin: React (StrictMode) puede llamar dos veces a la funcion que
  // actualiza el estado. Depende solo de `pin`: si dependiera de `enviar`, cada
  // render de PosApp (callbacks nuevos) lo volvia a disparar con el mismo PIN, se
  // abria una segunda sesion que cerraba la primera y la venta quedaba con un
  // token muerto ("Tu sesion se cerro").
  useEffect(() => {
    if (pin.length === DIGITOS_PIN) void enviarRef.current(pin)
  }, [pin])

  const borrar = useCallback(() => setPin((p) => p.slice(0, -1)), [])

  // Teclado fisico: digitos, Borrar y Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) tocar(e.key)
      else if (e.key === 'Backspace') borrar()
      else if (e.key === 'Escape') setPin('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tocar, borrar])

  const empresa = estado?.empresa.nombre ?? equipo.empresa ?? ''
  const caja = estado?.caja?.nombre ?? equipo.caja.nombre
  const turno = estado?.turno_caja ?? null

  return (
    <div className="pos-centro">
      <div className="pos-panel">
        <div className="pos-pin-encabezado">
          <div className="pos-pin-caja">{caja}{empresa ? ` · ${empresa}` : ''}</div>
          <h1 className="pos-titulo" style={{ marginTop: 8 }}>Entra con tu PIN</h1>
        </div>

        {turno && (
          <div className={turno.de_dia_anterior ? 'pos-aviso' : 'pos-info'}>
            <Icon name={turno.de_dia_anterior ? 'alert-triangle' : 'clock'} size={16} />
            <span>
              Turno abierto de <b>{turno.empleado_nombre}</b> desde {turno.de_dia_anterior ? 'un día anterior' : horaCorta(turno.abierto_at)}.
            </span>
          </div>
        )}
        {cajaInactiva && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{cajaInactiva}</span></div>}

        {bloqueado ? (
          <div style={{ padding: '18px 0 8px' }}>
            <div className="pos-cuenta">{formatoCuenta(segundosBloqueo)}</div>
            <p className="pos-sub" style={{ textAlign: 'center', marginTop: 8 }}>
              Demasiados PIN incorrectos. El equipo se desbloquea solo cuando termine la cuenta.
            </p>
          </div>
        ) : (
          <div className={'pos-puntos' + (temblor ? ' error' : '')} aria-label={`${pin.length} de ${DIGITOS_PIN} dígitos`}>
            {Array.from({ length: DIGITOS_PIN }, (_, i) => (
              <span key={i} className={'pos-punto' + (i < pin.length ? ' lleno' : '')} />
            ))}
          </div>
        )}

        <div className="pos-teclado">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="pos-tecla" disabled={deshabilitado} onClick={() => tocar(d)}>{d}</button>
          ))}
          <button type="button" className="pos-tecla secundaria" disabled={deshabilitado || pin === ''} onClick={() => setPin('')}>Borrar</button>
          <button type="button" className="pos-tecla" disabled={deshabilitado} onClick={() => tocar('0')}>0</button>
          <button type="button" className="pos-tecla secundaria" disabled={deshabilitado || pin === ''} onClick={borrar} aria-label="Borrar un dígito">
            <Icon name="delete" size={22} />
          </button>
        </div>

        <div className={'pos-mensaje-pin' + (mensaje?.error ? ' error' : '')}>
          {enviando ? 'Verificando…' : mensaje?.texto ?? ''}
        </div>
        <div style={{ textAlign: 'center' }}>
          <button type="button" className="pos-enlace" onClick={onRehabilitar}>Habilitar este equipo de nuevo</button>
        </div>
      </div>
    </div>
  )
}

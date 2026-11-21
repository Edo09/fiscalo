// Crear el PIN la primera vez que un usuario de FiscalPoint entra al POS (api-gratex
// docs/specs/pos.md A5b). Dos pasos: lo escribe y lo confirma (los pasos, en
// pinNuevo.ts). Teclado en pantalla y físico, y pegar, igual que la pantalla del PIN
// (PinView): se ve y se siente igual, solo que aquí el PIN lo elige la persona.
//
// Esta pantalla solo ve los errores que se arreglan escribiendo otro PIN (obvio, ya
// en uso, demasiados intentos, sin conexión). Los demás (sesión vencida, equipo de
// otra empresa, acceso desactivado) los resuelve quien la monta: no tienen arreglo aquí.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui'
import { PosApiError } from './api'
import { soloDigitos } from './montos'
import { usePegar } from './pegar'
import { DIGITOS_PIN, ESTADO_INICIAL, teclear, volverAEscribir, type EstadoPin, type EventoPin } from './pinNuevo'

interface Props {
  /** Nombre del empleado, para saludar. */
  nombre: string
  /**
   * Guarda el PIN (y, si sale bien, entra al POS: la pantalla se cierra sola). Lanza
   * PosApiError con el código del servidor si ese PIN no se pudo guardar.
   */
  onCrear: (pin: string) => Promise<void>
  /** "Ahora no": vuelve a la pantalla del PIN sin crear nada. */
  onCancelar: () => void
}

interface Vista {
  estado: EstadoPin
  /** El último evento que pide hacer algo; `n` cuenta cuántos van, para reaccionar a cada uno una sola vez. */
  evento: EventoPin
  n: number
}

const SIN_EVENTO: EventoPin = { tipo: 'nada' }

function formatoCuenta(seg: number): string {
  return `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`
}

export function CrearPinView({ nombre, onCrear, onCancelar }: Props) {
  const [vista, setVista] = useState<Vista>({ estado: ESTADO_INICIAL, evento: SIN_EVENTO, n: 0 })
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [temblor, setTemblor] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [esperaHasta, setEsperaHasta] = useState<number | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const enviandoRef = useRef(false)
  // La versión vigente de onCrear, para que el envío no dependa de un callback que cambia en cada render.
  const onCrearRef = useRef(onCrear)
  useEffect(() => { onCrearRef.current = onCrear })

  // Demasiados intentos con PIN que ya usa otro: el servidor dice cuánto esperar; aquí solo la cuenta regresiva.
  useEffect(() => {
    if (esperaHasta === null) return
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [esperaHasta])
  const esperaSeg = esperaHasta === null ? 0 : Math.max(0, Math.ceil((esperaHasta - ahora) / 1000))
  const enEspera = esperaSeg > 0
  useEffect(() => {
    if (esperaHasta !== null && esperaSeg === 0) setEsperaHasta(null)
  }, [esperaHasta, esperaSeg])

  const deshabilitado = enviando || enEspera

  const sacudir = useCallback(() => {
    setTemblor(true)
    window.setTimeout(() => setTemblor(false), 400)
  }, [])

  const tocar = useCallback((tecla: string) => {
    if (deshabilitado) return
    setMensaje(null)
    // Funcional: varias teclas seguidas (pegar, teclado rápido) se aplican una sobre otra, no sobre el render anterior.
    setVista((v) => {
      const r = teclear(v.estado, tecla)
      return { estado: r.estado, evento: r.evento, n: r.evento.tipo === 'nada' ? v.n : v.n + 1 }
    })
  }, [deshabilitado])

  const enviar = useCallback(async (pin: string) => {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    try {
      await onCrearRef.current(pin)
    } catch (e) {
      if (e instanceof PosApiError && e.codigo === 'PIN_DEMASIADOS_INTENTOS') {
        const ahoraMs = Date.now()
        const seg = Number(e.extra.espera_segundos)
        setAhora(ahoraMs)
        // Si el servidor no dijo cuánto, un minuto: lo que importa es que no quede sin explicación.
        setEsperaHasta(ahoraMs + (Number.isFinite(seg) && seg > 0 ? seg : 60) * 1000)
        setMensaje(null)
      } else {
        setMensaje(e instanceof PosApiError ? e.message : 'No se pudo guardar tu PIN. Inténtalo de nuevo.')
      }
      sacudir()
      // Se vuelve a empezar (mismo `n`: no es un evento nuevo).
      setVista((v) => ({ estado: ESTADO_INICIAL, evento: SIN_EVENTO, n: v.n }))
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }, [sacudir])

  // Lo que pide cada evento. Una sola vez por evento: depende de `n`, que solo sube con uno nuevo.
  useEffect(() => {
    if (vista.n === 0) return
    const ev = vista.evento
    if (ev.tipo === 'listo') {
      void enviar(ev.pin)
    } else if (ev.tipo === 'obvio') {
      setMensaje('Ese PIN es muy fácil de adivinar. Elige otro.')
      sacudir()
    } else if (ev.tipo === 'no-coinciden') {
      setMensaje('Los PIN no coinciden. Empieza de nuevo.')
      sacudir()
    }
  }, [vista.n, vista.evento, enviar, sacudir])

  // Teclado físico: dígitos, Borrar y Escape (borra lo escrito).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) tocar(e.key)
      else if (e.key === 'Backspace') tocar('⌫')
      else if (e.key === 'Escape') tocar('C')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tocar])

  // Pegar: los dígitos entran uno a uno, como si se hubieran tecleado.
  usePegar((texto) => {
    for (const d of soloDigitos(texto).slice(0, DIGITOS_PIN)) tocar(d)
  })

  const { estado } = vista
  const confirmando = estado.fase === 'confirmar'
  const llenos = enviando ? DIGITOS_PIN : estado.actual.length

  return (
    <div className="pos-centro">
      <div className="pos-panel">
        <div className="pos-pin-encabezado">
          <div className="pos-pin-caja">{nombre}</div>
          <h1 className="pos-titulo" style={{ marginTop: 8 }}>{confirmando ? 'Confirma tu PIN' : 'Crea tu PIN'}</h1>
        </div>
        <p className="pos-sub" style={{ textAlign: 'center', margin: '0 0 4px' }}>
          {confirmando ? 'Escríbelo otra vez, igual que antes.' : 'Elige 4 números que recuerdes: con ellos entrarás.'}
        </p>

        {enEspera && (
          <div className="pos-aviso">
            <Icon name="clock" size={16} />
            <span>Probaste muchos PIN que no están disponibles. Espera <b>{formatoCuenta(esperaSeg)}</b> e inténtalo de nuevo.</span>
          </div>
        )}

        <div className={'pos-puntos' + (temblor ? ' error' : '')} aria-label={`${llenos} de ${DIGITOS_PIN} dígitos`}>
          {Array.from({ length: DIGITOS_PIN }, (_, i) => (
            <span key={i} className={'pos-punto' + (i < llenos ? ' lleno' : '')} />
          ))}
        </div>

        <div className="pos-teclado">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="pos-tecla" disabled={deshabilitado} onClick={() => tocar(d)}>{d}</button>
          ))}
          <button type="button" className="pos-tecla secundaria" disabled={deshabilitado || estado.actual === ''} onClick={() => tocar('C')}>Borrar</button>
          <button type="button" className="pos-tecla" disabled={deshabilitado} onClick={() => tocar('0')}>0</button>
          <button type="button" className="pos-tecla secundaria" disabled={deshabilitado || estado.actual === ''} onClick={() => tocar('⌫')} aria-label="Borrar un dígito">
            <Icon name="delete" size={22} />
          </button>
        </div>

        <div className={'pos-mensaje-pin' + (mensaje ? ' error' : '')} aria-live="polite">
          {enviando ? 'Guardando tu PIN…' : mensaje ?? ''}
        </div>
        <div className="pos-enlaces">
          {confirmando && !enviando && (
            <button type="button" className="pos-enlace"
              onClick={() => setVista((v) => ({ estado: volverAEscribir(), evento: SIN_EVENTO, n: v.n }))}>
              Cambiar el PIN
            </button>
          )}
          <button type="button" className="pos-enlace" disabled={enviando} onClick={onCancelar}>Ahora no</button>
        </div>
      </div>
    </div>
  )
}

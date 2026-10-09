// Apertura del turno con su fondo (K2), impresora del equipo (P6), PIN de
// supervisor (S1) y el panel del turno con sus ventas (K9).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { printHtml } from '@/lib/printHtml'
import { reciboHtml, SELECTOR_RECIBO } from '@/features/invoices/reciboHtml'
import { ANCHOS_TIRILLA, useImpresoraStore } from '@/stores/impresora'
import type { AnchoTirilla } from '@/api/types'
import { posApi, PosApiError, type TurnoCaja, type VentaTurno } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { formatoCentavos, montoACentavos } from './montos'
import { Overlay } from './PosModales'
import { TecladoMonto } from './TecladoMonto'
import { ANCHO_UTIL_MM, fechaHora } from './reporteCierre'

export function AperturaTurnoModal({ equipo, sesion, onAbierto, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  onAbierto: (t: TurnoCaja) => void
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const [fondo, setFondo] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const centavos = fondo === '' ? 0 : montoACentavos(fondo)

  const abrir = async () => {
    if (centavos === null || abriendo) return
    setAbriendo(true)
    setError(null)
    try {
      const r = await posApi.abrirTurno(equipo.token, sesion.token, centavos)
      onAbierto(r.turno_caja)
    } catch (e) {
      if (errorDeSesion(e)) return
      setError(e instanceof PosApiError ? e.message : 'No se pudo abrir el turno.')
      setAbriendo(false)
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); void abrir() } else if (e.key === 'Escape') { e.preventDefault(); onCerrar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>{equipo.caja.nombre}</small>
          <b>Abrir turno</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <p className="pos-sub" style={{ margin: '0 0 12px' }}>
        Cuenta el efectivo con que empieza la gaveta y escríbelo. Sin turno abierto no se puede cobrar.
      </p>
      {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}
      <div className="pos-campo-monto" style={{ marginBottom: 12 }}>
        <small>Fondo inicial</small>
        <b className={fondo === '' ? 'vacio' : ''}>RD$ {fondo === '' ? '0.00' : fondo}</b>
      </div>
      <TecladoMonto onCambio={setFondo} />
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Ahora no</Btn>
        <Btn variant="primary" className="pos-boton-grande" icon="check" disabled={centavos === null || abriendo} onClick={() => void abrir()}>
          {abriendo ? 'Abriendo…' : `Abrir con RD$ ${formatoCentavos(centavos ?? 0)}`}
        </Btn>
      </div>
    </Overlay>
  )
}

function paginaDePrueba(ancho: AnchoTirilla, caja: string): string {
  const fecha = new Date().toLocaleString('es-DO')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba</title><style>
  html, body { margin: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .recibo { padding: 2mm 1mm; font-size: 9pt; text-align: center; line-height: 1.35; }
  .t { font-size: 11pt; font-weight: bold; }
  .sep { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .regla { display: flex; justify-content: space-between; font-size: 8pt; }
  </style></head><body><div class="recibo">
  <div class="t">FiscalPoint POS</div><div>Prueba de impresión</div><hr class="sep">
  <div>Rollo de ${ancho} mm · ${caja}</div><div>${fecha}</div><hr class="sep">
  <div class="regla"><span>|&lt; izquierda</span><span>derecha &gt;|</span></div>
  <div style="margin-top:2mm">Si ves las dos marcas completas y el papel se corta poco después de esta línea, el ancho está bien.</div>
  </div></body></html>`
}

export function ImpresoraModal({ caja, onCerrar }: { caja: string; onCerrar: () => void }) {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const setAncho = useImpresoraStore((s) => s.setAnchoTirilla)
  const [estado, setEstado] = useState<'listo' | 'imprimiendo' | 'error'>('listo')

  const prueba = async () => {
    setEstado('imprimiendo')
    try {
      await printHtml(paginaDePrueba(ancho, caja), { anchoMm: ANCHO_UTIL_MM[ancho], selector: '.recibo' })
      setEstado('listo')
    } catch {
      setEstado('error')
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>Este equipo</small>
          <b>Impresora de recibos</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <p className="pos-sub" style={{ margin: '0 0 12px' }}>
        Ancho del rollo de la impresora térmica de esta caja. El recibo sale con el diálogo de impresión: deja la
        térmica como impresora predeterminada.
      </p>
      <div className="pos-formas" style={{ marginBottom: 16 }}>
        {ANCHOS_TIRILLA.map((a) => (
          <button key={a} type="button" className={'pos-forma' + (ancho === a ? ' on' : '')} onClick={() => setAncho(a)}>
            <span>{a} mm</span>
          </button>
        ))}
      </div>
      {estado === 'error' && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>No se pudo abrir la impresión.</span></div>}
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" icon="printer" disabled={estado === 'imprimiendo'} onClick={() => void prueba()}>Imprimir prueba</Btn>
        <Btn variant="primary" className="pos-boton-grande" onClick={onCerrar}>Listo</Btn>
      </div>
    </Overlay>
  )
}

// --- PIN de supervisor (S1) ----------------------------------------------------

/**
 * El supervisor escribe su PIN en la sesión del cajero. Sale un permiso para
 * cerrar ESE turno; los PIN equivocados cuentan para el bloqueo del equipo.
 */
export function SupervisorPinModal({ equipo, sesion, turno, onAutorizado, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  turno: TurnoCaja
  onAutorizado: (permiso: string, supervisor: string) => void
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const enviar = useCallback(async (completo: string) => {
    setEnviando(true)
    setMensaje(null)
    try {
      const r = await posApi.autorizar(equipo.token, sesion.token, completo, turno.id)
      onAutorizado(r.permiso, r.supervisor.nombre)
    } catch (e) {
      if (errorDeSesion(e)) return
      setPin('')
      if (e instanceof PosApiError && (e.codigo === 'PIN_INCORRECTO' || e.codigo === 'PIN_SIN_PERMISO')) {
        const quedan = Number(e.extra.intentos_restantes ?? 0)
        setMensaje(`${e.message} ${quedan === 1 ? 'Queda 1 intento antes de bloquear el equipo.' : `Quedan ${quedan} intentos.`}`)
      } else if (e instanceof PosApiError && e.codigo === 'EQUIPO_BLOQUEADO') {
        const min = Math.max(1, Math.ceil(Number(e.extra.bloqueo_segundos ?? 0) / 60))
        setMensaje(`Demasiados PIN incorrectos: el equipo queda bloqueado ${min} min.`)
      } else {
        setMensaje(e instanceof Error ? e.message : 'No se pudo verificar el PIN.')
      }
      setEnviando(false)
    }
  }, [equipo.token, sesion.token, turno.id, onAutorizado, errorDeSesion])

  const tocar = useCallback((d: string) => {
    if (enviando) return
    setPin((p) => (d === '⌫' ? p.slice(0, -1) : p.length >= 4 ? p : p + d))
  }, [enviando])

  // Completo el PIN, se envía una vez. En un efecto que depende solo del PIN (no
  // dentro de setPin ni de `enviar`): si no, StrictMode o un render nuevo lo
  // mandan dos veces y cada PIN malo contaría doble para el bloqueo.
  const enviarRef = useRef(enviar)
  useEffect(() => { enviarRef.current = enviar }, [enviar])
  useEffect(() => {
    if (pin.length === 4) void enviarRef.current(pin)
  }, [pin])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) tocar(e.key)
      else if (e.key === 'Backspace') tocar('⌫')
      else if (e.key === 'Escape') onCerrar()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tocar, onCerrar])

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>Autorización de supervisor</small>
          <b>Cerrar el turno de {turno.empleado_nombre}</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <p className="pos-sub" style={{ margin: '0 0 6px' }}>Un supervisor escribe su PIN y después cuenta la gaveta.</p>
      <div className="pos-puntos" aria-label={`${pin.length} de 4 dígitos`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={'pos-punto' + (i < pin.length ? ' lleno' : '')} />)}
      </div>
      <div className="pos-teclado">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((t, i) => t === ''
          ? <span key={i} />
          : (
            <button key={i} type="button" className={'pos-tecla' + (t === '⌫' ? ' secundaria' : '')} disabled={enviando}
              onClick={() => tocar(t)} aria-label={t === '⌫' ? 'Borrar un dígito' : t}>
              {t === '⌫' ? <Icon name="delete" size={24} /> : t}
            </button>
          ))}
      </div>
      <div className={'pos-mensaje-pin' + (mensaje ? ' error' : '')}>{enviando ? 'Verificando…' : mensaje ?? ''}</div>
    </Overlay>
  )
}

// --- Panel del turno (K9) --------------------------------------------------------

const ESTADO_DGII: Record<string, string> = {
  RFCE_ACEPTADO: 'Aceptada', ACEPTADO: 'Aceptada', RFCE_ACEPTADO_CONDICIONAL: 'Aceptada', ACEPTADO_CONDICIONAL: 'Aceptada',
  RFCE_PENDIENTE: 'Sin confirmar DGII', ENVIO_PENDIENTE: 'Sin confirmar DGII', ENVIADO: 'DGII validando', EN_PROCESO: 'DGII validando',
  RFCE_RECHAZADO: 'Rechazada', RECHAZADO: 'Rechazada',
}

export function TurnoModal({ equipo, sesion, turno, puedeCerrar, motivoNoCerrar, onCerrarTurno, onAbrirTurno, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  turno: TurnoCaja | null
  puedeCerrar: boolean
  /** Por qué no se puede cerrar ahora (venta en curso, cobro sin confirmar). */
  motivoNoCerrar: string | null
  onCerrarTurno: () => void
  onAbrirTurno: () => void
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const [ventas, setVentas] = useState<VentaTurno[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    posApi.ventasTurno(equipo.token, sesion.token)
      .then((r) => { if (vivo) setVentas(r.ventas) })
      .catch((e) => { if (vivo && !errorDeSesion(e)) setError(e instanceof Error ? e.message : 'No se pudieron cargar las ventas.') })
    return () => { vivo = false }
  }, [equipo.token, sesion.token, errorDeSesion])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCerrar() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  const reimprimir = async (v: VentaTurno) => {
    setImprimiendo(v.factura_id)
    try {
      const { recibo } = await posApi.recibo(equipo.token, sesion.token, v.factura_id, ancho)
      await printHtml(reciboHtml(recibo), { anchoMm: recibo.papel.ancho_mm, selector: SELECTOR_RECIBO })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reimprimir.')
    } finally {
      window.focus()
      setImprimiendo(null)
    }
  }

  const ajeno = turno !== null && turno.empleado_id !== sesion.empleado.id

  return (
    <Overlay onCerrar={onCerrar} ancho={620}>
      <div className="pos-modal-cab">
        <div>
          <small>{equipo.caja.nombre}</small>
          <b>{turno ? `Turno de ${turno.empleado_nombre}` : 'Sin turno abierto'}</b>
          {turno && (
            <div className="pos-sub" style={{ margin: '2px 0 0', fontSize: 13 }}>
              Desde {fechaHora(turno.abierto_at)} · fondo RD$ {formatoCentavos(Math.round(turno.fondo_inicial * 100))}
            </div>
          )}
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>

      {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}

      {turno && (
        <div className="pos-ventas-turno">
          {ventas === null ? (
            <div className="pos-grilla-vacia" style={{ padding: 24 }}><div className="spinner" /></div>
          ) : ventas.length === 0 ? (
            <p className="pos-sub" style={{ margin: 0, padding: '16px 0', textAlign: 'center' }}>Todavía no hay ventas en este turno.</p>
          ) : ventas.map((v) => (
            <div key={v.factura_id} className="pos-venta-fila">
              <div>
                <b>{v.e_ncf}</b>
                <small>{fechaHora(v.fecha).split(' ').slice(1).join(' ')} · {v.forma_pago_nombre} · {ESTADO_DGII[v.estado_dgii] ?? v.estado_dgii}</small>
              </div>
              <b className="pos-linea-importe">RD$ {formatoCentavos(v.total_centavos)}</b>
              <Btn size="sm" icon="printer" disabled={imprimiendo !== null} onClick={() => void reimprimir(v)} aria-label={`Reimprimir ${v.e_ncf}`}>
                {imprimiendo === v.factura_id ? '…' : 'Reimprimir'}
              </Btn>
            </div>
          ))}
        </div>
      )}

      {motivoNoCerrar && turno && <div className="pos-aviso" style={{ marginTop: 12 }}><Icon name="info" size={16} /><span>{motivoNoCerrar}</span></div>}
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Volver</Btn>
        {turno ? (
          <Btn variant="primary" className="pos-boton-grande" icon="lock" disabled={!puedeCerrar} onClick={onCerrarTurno}>
            {ajeno ? (sesion.empleado.rol === 'supervisor' ? 'Cerrar su turno' : 'Cerrar su turno (supervisor)') : 'Cerrar turno'}
          </Btn>
        ) : (
          <Btn variant="primary" className="pos-boton-grande" icon="clock" onClick={onAbrirTurno}>Abrir turno</Btn>
        )}
      </div>
    </Overlay>
  )
}

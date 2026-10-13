// Cierre de turno (api-gratex docs/specs/pos.md K6-K8): conteo a ciegas por
// denominación, confirmación (después no se cambia), resultado con esperado y
// diferencia, nota opcional y el reporte en la impresora.
//
// A ciegas: mientras se cuenta, esta pantalla NO sabe cuánto debería haber; el
// esperado llega recién en la respuesta del cierre.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { printHtml } from '@/lib/printHtml'
import { useImpresoraStore } from '@/stores/impresora'
import { posApi, PosApiError, type Conteo, type ReporteCierre, type TurnoCaja } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import {
  BILLETES, contadoCentavos, DENOMINACIONES, formatoCentavos, montoACentavos, pegarEntero, pegarMonto, teclearEntero, teclearMonto,
} from './montos'
import { usePegar } from './pegar'
import { ANCHO_UTIL_MM, reporteCierreHtml, SELECTOR_REPORTE, textoDiferencia } from './reporteCierre'
import { Overlay } from './PosModales'

const FILAS = [...DENOMINACIONES.map(String), 'otros']

type Fase =
  | { tipo: 'conteo' }
  | { tipo: 'confirmar' }
  | { tipo: 'enviando' }
  | { tipo: 'error'; mensaje: string; volverAContar: boolean }
  | { tipo: 'resultado'; reporte: ReporteCierre; impresion: 'imprimiendo' | 'ok' | 'error' }

interface Props {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  turno: TurnoCaja
  /** Permiso del supervisor (turno de otro empleado), o null si cierra el propio o un supervisor. */
  permiso: string | null
  /** Quién cuenta: el cajero del turno o el supervisor que autorizó. */
  cuenta: string
  empresa: string | null
  onCancelar: () => void
  /** El turno quedó cerrado (aunque todavía se muestre el resultado). */
  onCerrado: () => void
  onTerminar: () => void
  errorDeSesion: (e: unknown) => boolean
}

export function CierreModal({ equipo, sesion, turno, permiso, cuenta, empresa, onCancelar, onCerrado, onTerminar, errorDeSesion }: Props) {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [activa, setActiva] = useState(FILAS[0])
  const [fase, setFase] = useState<Fase>({ tipo: 'conteo' })
  const [nota, setNota] = useState('')
  const [notaEstado, setNotaEstado] = useState<'editando' | 'guardando' | 'guardada' | 'error'>('editando')
  const terminarRef = useRef<HTMLButtonElement>(null)
  const filasRef = useRef<Record<string, HTMLButtonElement | null>>({})

  const conteo: Conteo = useMemo(() => {
    const c: Conteo = {}
    for (const d of DENOMINACIONES) c[String(d)] = Number(valores[String(d)] || 0)
    c.otros_centavos = montoACentavos(valores.otros || '0') ?? 0
    return c
  }, [valores])
  const contado = contadoCentavos(conteo)
  const otrosValido = valores.otros === undefined || valores.otros === '' || montoACentavos(valores.otros) !== null

  const teclear = useCallback((t: string) => {
    setValores((v) => ({ ...v, [activa]: activa === 'otros' ? teclearMonto(v[activa] ?? '', t) : teclearEntero(v[activa] ?? '', t) }))
  }, [activa])
  const mover = useCallback((paso: number) => {
    setActiva((a) => {
      const i = Math.min(FILAS.length - 1, Math.max(0, FILAS.indexOf(a) + paso))
      return FILAS[i]
    })
  }, [])
  useEffect(() => { filasRef.current[activa]?.scrollIntoView({ block: 'nearest' }) }, [activa])

  const imprimir = useCallback(async (reporte: ReporteCierre) => {
    setFase({ tipo: 'resultado', reporte, impresion: 'imprimiendo' })
    try {
      const mm = ANCHO_UTIL_MM[ancho]
      await printHtml(reporteCierreHtml(reporte, { empresa, anchoMm: mm }), { anchoMm: mm, selector: SELECTOR_REPORTE })
      setFase({ tipo: 'resultado', reporte, impresion: 'ok' })
    } catch {
      setFase({ tipo: 'resultado', reporte, impresion: 'error' })
    }
  }, [ancho, empresa])

  const cerrar = useCallback(async () => {
    setFase({ tipo: 'enviando' })
    try {
      const r = await posApi.cerrarTurno(equipo.token, sesion.token, turno.id, conteo, permiso)
      onCerrado()
      void imprimir(r.reporte)
    } catch (e) {
      if (errorDeSesion(e)) return
      const codigo = e instanceof PosApiError ? e.codigo : 'ERROR'
      const mensaje = e instanceof Error ? e.message : 'No se pudo cerrar el turno.'
      if (codigo === 'SIN_TURNO') {
        // Ya estaba cerrado (otro cierre, o este mismo y se perdió la respuesta).
        onCerrado()
        setFase({ tipo: 'error', volverAContar: false,
          mensaje: 'Este turno ya quedó cerrado. El reporte se puede reimprimir desde FiscalPoint → Punto de venta → Turnos.' })
      } else if (codigo === 'TURNO_CAMBIO' || codigo === 'PERMISO_INVALIDO') {
        setFase({ tipo: 'error', mensaje, volverAContar: false })
      } else {
        setFase({ tipo: 'error', mensaje, volverAContar: true })
      }
    }
  }, [equipo.token, sesion.token, turno.id, conteo, permiso, onCerrado, imprimir, errorDeSesion])

  const guardarNota = async (reporte: ReporteCierre) => {
    const texto = nota.trim()
    if (texto === '') return
    setNotaEstado('guardando')
    try {
      const r = await posApi.notaTurno(equipo.token, sesion.token, reporte.turno_id, texto)
      setNotaEstado('guardada')
      setFase((f) => (f.tipo === 'resultado' ? { ...f, reporte: r.reporte } : f))
    } catch {
      setNotaEstado('error')
    }
  }

  // Teclado físico en el conteo: dígitos y punto a la fila activa, Enter / flechas para moverse.
  useEffect(() => {
    if (fase.tipo !== 'conteo' && fase.tipo !== 'confirmar') return
    const h = (e: KeyboardEvent) => {
      if (fase.tipo === 'confirmar') {
        if (e.key === 'Enter') { e.preventDefault(); void cerrar() } else if (e.key === 'Escape') { e.preventDefault(); setFase({ tipo: 'conteo' }) }
        return
      }
      if (/^\d$/.test(e.key)) teclear(e.key)
      else if (e.key === '.' || e.key === ',') teclear('.')
      else if (e.key === 'Backspace') teclear('⌫')
      else if (e.key === 'Delete') teclear('C')
      else if (e.key === 'ArrowDown' || (e.key === 'Enter' && activa !== 'otros')) mover(1)
      else if (e.key === 'ArrowUp') mover(-1)
      else if (e.key === 'Enter' && otrosValido) setFase({ tipo: 'confirmar' })
      else if (e.key === 'Escape') onCancelar()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fase.tipo, teclear, mover, activa, otrosValido, cerrar, onCancelar])

  // Pegar en la fila activa: unidades (enteras) o, en "otros", un monto.
  usePegar((texto) => {
    setValores((v) => ({ ...v, [activa]: activa === 'otros' ? pegarMonto(texto) : pegarEntero(texto) }))
  }, fase.tipo === 'conteo')

  // Al imprimir, el foco queda en el iframe del reporte: se devuelve a "Terminar".
  const listo = fase.tipo === 'resultado' && fase.impresion !== 'imprimiendo'
  useEffect(() => {
    if (!listo) return
    window.focus()
    terminarRef.current?.focus()
  }, [listo])

  const ajeno = turno.empleado_id !== sesion.empleado.id

  return (
    <Overlay ancho={fase.tipo === 'conteo' || fase.tipo === 'confirmar' ? 760 : 480}>
      {(fase.tipo === 'conteo' || fase.tipo === 'confirmar') && (
        <>
          <div className="pos-modal-cab">
            <div>
              <small>Cerrar turno · {turno.empleado_nombre}{ajeno ? ` · cuenta ${cuenta}` : ''}</small>
              <b>Cuenta el efectivo de la gaveta</b>
            </div>
            <Btn variant="ghost" icon="x" onClick={onCancelar} aria-label="Cerrar" />
          </div>
          <p className="pos-sub" style={{ margin: '0 0 10px', fontSize: 14 }}>
            Escribe cuántos billetes y monedas hay de cada uno. Cuenta todo, incluido el fondo. El sistema no muestra cuánto
            debería haber hasta que confirmes.
          </p>
          <div className="pos-conteo">
            <div className="pos-conteo-filas">
              {FILAS.map((k) => {
                const esOtros = k === 'otros'
                const d = Number(k)
                const subtotal = esOtros ? (montoACentavos(valores.otros || '0') ?? 0) : d * 100 * Number(valores[k] || 0)
                const titulo = esOtros ? 'Otros / centavos' : `${(BILLETES as readonly number[]).includes(d) ? 'Billete' : 'Moneda'} de ${d.toLocaleString('es-DO')}`
                return (
                  <button key={k} type="button" ref={(el) => { filasRef.current[k] = el }}
                    className={'pos-conteo-fila' + (activa === k ? ' on' : '')} onClick={() => setActiva(k)}>
                    <span className="pos-conteo-den">{titulo}</span>
                    <b className={'pos-conteo-cant' + (valores[k] ? '' : ' vacio')}>{esOtros ? `RD$ ${valores[k] || '0'}` : `× ${valores[k] || '0'}`}</b>
                    <span className="pos-conteo-sub">{formatoCentavos(subtotal)}</span>
                  </button>
                )
              })}
            </div>
            <div>
              <div className="pos-teclado pos-teclado-monto">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', activa === 'otros' ? '.' : 'C', '0', '⌫'].map((t) => (
                  <button key={t} type="button" className={'pos-tecla' + (t === '⌫' ? ' secundaria' : t === 'C' ? ' pos-tecla-c' : '')} onClick={() => teclear(t)}
                    aria-label={t === '⌫' ? 'Borrar' : t === 'C' ? 'Limpiar' : t}>
                    {t === '⌫' ? <Icon name="delete" size={24} /> : t}
                  </button>
                ))}
              </div>
              <div className="pos-billetes" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
                <button type="button" className="pos-billete" onClick={() => mover(-1)}>↑ Anterior</button>
                <button type="button" className="pos-billete" onClick={() => mover(1)}>Siguiente ↓</button>
              </div>
            </div>
          </div>
          <div className="pos-conteo-total">
            <span>Total contado</span>
            <b>RD$ {formatoCentavos(contado)}</b>
          </div>
          <div className="pos-modal-pie">
            <Btn className="pos-boton-grande" onClick={onCancelar}>Cancelar</Btn>
            <Btn variant="primary" className="pos-boton-grande" icon="check" disabled={!otrosValido} onClick={() => setFase({ tipo: 'confirmar' })}>
              Confirmar conteo
            </Btn>
          </div>
          {fase.tipo === 'confirmar' && (
            <div className="pos-confirmar-capa">
              <div className="pos-modal" role="alertdialog" style={{ maxWidth: 420 }}>
                <div className="pos-modal-cab"><div><b>¿Confirmas RD$ {formatoCentavos(contado)}?</b></div></div>
                <p className="pos-sub" style={{ margin: '0 0 16px' }}>
                  Al confirmar, el turno se cierra y el conteo ya no se puede cambiar.
                </p>
                <div className="pos-modal-pie">
                  <Btn className="pos-boton-grande" onClick={() => setFase({ tipo: 'conteo' })}>Revisar</Btn>
                  <Btn variant="primary" className="pos-boton-grande" onClick={() => void cerrar()}>Sí, cerrar turno</Btn>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {fase.tipo === 'enviando' && (
        <div className="pos-cobro-estado">
          <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <b>Cerrando el turno…</b>
          <p className="pos-sub">Si hay una venta emitiéndose, espera a que termine.</p>
        </div>
      )}

      {fase.tipo === 'error' && (
        <div className="pos-cobro-estado">
          <span className="pos-cobro-mal"><Icon name="alert-circle" size={30} /></span>
          <b>No se cerró el turno</b>
          <p className="pos-sub" style={{ margin: 0 }}>{fase.mensaje}</p>
          <div className="pos-modal-pie" style={{ width: '100%' }}>
            <Btn className="pos-boton-grande" onClick={onCancelar}>Salir</Btn>
            {fase.volverAContar && <Btn variant="primary" className="pos-boton-grande" onClick={() => setFase({ tipo: 'confirmar' })}>Reintentar</Btn>}
          </div>
        </div>
      )}

      {fase.tipo === 'resultado' && (() => {
        const r = fase.reporte
        const dif = r.diferencia_centavos
        return (
          <div className="pos-cobro-estado">
            <span className={dif === 0 ? 'pos-cobro-ok' : dif < 0 ? 'pos-cobro-mal' : 'pos-cobro-duda'}>
              <Icon name={dif === 0 ? 'check' : 'alert-triangle'} size={30} />
            </span>
            <b>Turno cerrado</b>
            <div className={'pos-devuelta grande' + (dif < 0 ? ' falta' : '')}>
              <small>{dif === 0 ? 'La caja cuadra' : dif < 0 ? 'Falta' : 'Sobra'}</small>
              <b>{dif === 0 ? 'RD$ 0.00' : `RD$ ${formatoCentavos(Math.abs(dif))}`}</b>
            </div>
            <div className="pos-cierre-cifras">
              <div><small>Esperado</small><b>RD$ {formatoCentavos(r.esperado_centavos)}</b></div>
              <div><small>Contado</small><b>RD$ {formatoCentavos(r.contado_centavos)}</b></div>
              <div><small>Ventas</small><b>{r.ventas.cantidad} · RD$ {formatoCentavos(r.ventas.total_centavos)}</b></div>
            </div>
            {notaEstado === 'guardada' ? (
              <div className="pos-info" style={{ margin: 0, width: '100%' }}><Icon name="check" size={16} /><span>Nota guardada: {r.nota}</span></div>
            ) : (
              <div style={{ width: '100%' }}>
                <textarea className="pos-nota" value={nota} maxLength={255} rows={2} onChange={(e) => setNota(e.target.value)}
                  placeholder={dif === 0 ? 'Nota (opcional)' : `Nota (opcional): por qué ${textoDiferencia(dif).toLowerCase()}`} />
                {nota.trim() !== '' && (
                  <Btn size="sm" icon="save" disabled={notaEstado === 'guardando'} onClick={() => void guardarNota(r)}>
                    {notaEstado === 'guardando' ? 'Guardando…' : 'Guardar nota'}
                  </Btn>
                )}
                {notaEstado === 'error' && <small className="pos-sub" style={{ color: 'var(--danger)' }}> No se pudo guardar la nota.</small>}
              </div>
            )}
            {fase.impresion === 'error' && (
              <div className="pos-error" style={{ margin: 0 }}><Icon name="printer" size={16} /><span>No se pudo imprimir el reporte. Revisa la impresora y reimprime.</span></div>
            )}
            <div className="pos-modal-pie" style={{ width: '100%' }}>
              <Btn className="pos-boton-grande" icon="printer" disabled={fase.impresion === 'imprimiendo'} onClick={() => void imprimir(r)}>
                {fase.impresion === 'imprimiendo' ? 'Imprimiendo…' : 'Reimprimir'}
              </Btn>
              <button ref={terminarRef} type="button" className="btn btn-primary pos-boton-grande" onClick={onTerminar}>
                <Icon name="check" />Terminar
              </button>
            </div>
          </div>
        )
      })()}
    </Overlay>
  )
}

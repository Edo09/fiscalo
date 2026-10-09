// Crédito fiscal (api-gratex docs/specs/pos.md F2): el cajero escribe el RNC o
// la cédula, el servidor busca al cliente o lo crea desde el registro de
// contribuyentes, y la venta pasa a factura de crédito fiscal (E31) a su nombre.
// No inscrito o consulta caída: no hay E31 (la venta sigue como consumo).
import { useCallback, useEffect, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type ClientePos } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { Overlay } from './PosModales'
import { formatoRnc } from './montos'

type Fase =
  | { tipo: 'escribiendo'; error: string | null }
  | { tipo: 'buscando' }
  | { tipo: 'encontrado'; cliente: ClientePos; nuevo: boolean; estado: string | null }

export function ClienteRncModal({ equipo, sesion, onElegido, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  onElegido: (cliente: ClientePos) => void
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const [rnc, setRnc] = useState('')
  const [fase, setFase] = useState<Fase>({ tipo: 'escribiendo', error: null })
  const valido = rnc.length === 9 || rnc.length === 11

  const teclear = useCallback((t: string) => {
    if (fase.tipo !== 'escribiendo') return
    setRnc((r) => (t === '⌫' ? r.slice(0, -1) : t === 'C' ? '' : r.length >= 11 ? r : r + t))
  }, [fase.tipo])

  const buscar = useCallback(async () => {
    if (!valido) return
    setFase({ tipo: 'buscando' })
    try {
      const r = await posApi.clienteRnc(equipo.token, sesion.token, rnc)
      setFase({ tipo: 'encontrado', cliente: r.cliente, nuevo: r.nuevo, estado: r.estado_dgii })
    } catch (e) {
      if (errorDeSesion(e)) return
      setFase({ tipo: 'escribiendo', error: e instanceof PosApiError ? e.message : 'No se pudo buscar el RNC.' })
    }
  }, [valido, equipo.token, sesion.token, rnc, errorDeSesion])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) teclear(e.key)
      else if (e.key === 'Backspace') teclear('⌫')
      else if (e.key === 'Escape') onCerrar()
      else if (e.key === 'Enter') {
        if (fase.tipo === 'escribiendo') void buscar()
        else if (fase.tipo === 'encontrado') onElegido(fase.cliente)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [teclear, buscar, fase, onCerrar, onElegido])

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>Factura de crédito fiscal</small>
          <b>RNC o cédula del cliente</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>

      {fase.tipo === 'encontrado' ? (
        <>
          <div className="pos-cliente-ficha">
            <span className="pos-cobro-ok" style={{ width: 44, height: 44 }}><Icon name="check" size={22} /></span>
            <div>
              <b>{fase.cliente.nombre}</b>
              <small>{fase.cliente.rnc.length === 11 ? 'Cédula' : 'RNC'} {formatoRnc(fase.cliente.rnc)}
                {fase.nuevo ? ' · cliente nuevo, creado con los datos del registro' : ''}</small>
              {fase.cliente.descuento > 0 && <small className="pos-cliente-desc">Descuento del cliente: {fase.cliente.descuento}%</small>}
            </div>
          </div>
          {fase.estado && fase.estado !== 'ACTIVO' && (
            <div className="pos-aviso"><Icon name="alert-triangle" size={16} />
              <span>El registro dice que este contribuyente está <b>{fase.estado.toLowerCase()}</b>: la DGII podría rechazar el crédito fiscal.</span>
            </div>
          )}
          <div className="pos-modal-pie">
            <Btn className="pos-boton-grande" onClick={() => { setRnc(''); setFase({ tipo: 'escribiendo', error: null }) }}>Buscar otro</Btn>
            <Btn variant="primary" className="pos-boton-grande" icon="check" onClick={() => onElegido(fase.cliente)}>Usar en esta venta</Btn>
          </div>
        </>
      ) : (
        <>
          <div className={'pos-cantidad-visor' + (rnc === '' ? ' vacio' : '')} style={{ letterSpacing: '0.04em' }}>
            {rnc === '' ? '9 u 11 dígitos' : formatoRnc(rnc)}
          </div>
          <div className="pos-cantidad-ayuda">
            {fase.tipo === 'buscando'
              ? 'Buscando…'
              : fase.error
                ? <span className="error">{fase.error}</span>
                : rnc.length === 9 ? 'RNC' : rnc.length === 11 ? 'Cédula' : `${rnc.length} dígitos`}
          </div>
          <div className="pos-teclado">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((t) => (
              <button key={t} type="button" className={'pos-tecla' + (t === '⌫' || t === 'C' ? ' secundaria' : '')}
                disabled={fase.tipo === 'buscando'} onClick={() => teclear(t)} aria-label={t === '⌫' ? 'Borrar' : t === 'C' ? 'Limpiar' : t}>
                {t === '⌫' ? <Icon name="delete" size={24} /> : t}
              </button>
            ))}
          </div>
          <div className="pos-modal-pie">
            <Btn className="pos-boton-grande" onClick={onCerrar}>Cancelar</Btn>
            <Btn variant="primary" className="pos-boton-grande" icon="search" disabled={!valido || fase.tipo === 'buscando'} onClick={() => void buscar()}>
              {fase.tipo === 'buscando' ? 'Buscando…' : 'Buscar'}
            </Btn>
          </div>
        </>
      )}
    </Overlay>
  )
}

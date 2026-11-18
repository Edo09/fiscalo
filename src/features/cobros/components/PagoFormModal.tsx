// Registrar un pago (completo o parcial) de un cobro. Lee el cobro de ahora (no una copia vieja) para
// mostrar el saldo real; el monto no puede pasar del saldo ni la fecha ser de mañana; el método es efectivo
// o transferencia. Cada apertura del formulario genera UNA clave de idempotencia: si la respuesta se pierde y
// se repite, el servidor devuelve el mismo pago en vez de registrar otro.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, ErrorState, Icon, LoadingState, Modal } from '@/components/ui'
import { ApiError, type CobroDetalle } from '@/api'
import {
  ETIQUETA_METODO, METODOS_PAGO, aCentavos, centavosDeTexto, deCentavos, erroresPorCampo, pagoFormSchema,
  textoDinero, textoMontoCampo, type MetodoPago,
} from '@/api/schemas/cobros'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { nuevaClave } from '../clave'
import { admitePago, conceptoCobro, fechaCorta, periodoLargo, textoSiguiente } from '../format'
import { useDetalleParaFormulario, useRegistrarPago, useRelojServidor } from '../hooks'
import { Aviso } from './Aviso'
import { EstadoCobroBadge } from './EstadoCobroBadge'

/** Los 409 que dicen "esa clave ya es de otra operación": el siguiente intento tiene que ser una operación NUEVA. */
const CODIGOS_CLAVE_USADA = ['CLAVE_CON_OTROS_DATOS', 'CLAVE_REPETIDA', 'PAGO_ANULADO']

export function PagoFormModal({ cobroId, onClose }: { cobroId: number; onClose: () => void }) {
  // Espera al dato fresco: el monto por defecto sale del saldo al montarse el formulario (ver useDetalleParaFormulario).
  const { data, error, loading, reload } = useDetalleParaFormulario(cobroId)
  if (loading) return <Modal title="Registrar pago" icon="banknote" onClose={onClose}><LoadingState rows={3} /></Modal>
  // Un error SIN dato es el que no deja abrir el formulario. Con dato (un refetch que falló) el formulario sigue:
  // desmontarlo borraría lo que la persona ya escribió, y "Reintentar" le cambiaría la clave de idempotencia.
  if (!data) {
    return (
      <Modal title="Registrar pago" icon="banknote" onClose={onClose}>
        <ErrorState title="No se pudo abrir el cobro" onRetry={reload}>{error}</ErrorState>
      </Modal>
    )
  }
  return <FormPago cobro={data} errorActualizar={error} onClose={onClose} />
}

function FormPago({ cobro, errorActualizar, onClose }: { cobro: CobroDetalle; errorActualizar: string | null; onClose: () => void }) {
  const registrar = useRegistrarPago()
  const reloj = useRelojServidor()
  // Una clave por apertura del formulario (no por clic): el segundo clic sobre el mismo intento no duplica.
  const [clave, setClave] = useState(nuevaClave)
  const hoy = reloj().hoy
  const saldoCentavos = aCentavos(cobro.saldo)
  const [monto, setMonto] = useState(textoMontoCampo(saldoCentavos))
  const [fecha, setFecha] = useState(hoy)
  const [metodo, setMetodo] = useState<MetodoPago | ''>('efectivo')
  const [observaciones, setObservaciones] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const admite = admitePago(cobro)
  const centavos = centavosDeTexto(monto)
  const completa = centavos !== null && centavos === saldoCentavos

  const guardar = useAccionUnica(async () => {
    setError(null)
    const parsed = pagoFormSchema(saldoCentavos, reloj().hoy).safeParse({ monto, fecha, metodo, observaciones })
    if (!parsed.success) { setErrores(erroresPorCampo(parsed.error)); return }
    setErrores({})
    const d = parsed.data
    setSaving(true)
    try {
      const r = await registrar.mutateAsync({
        cobroId: cobro.id,
        pago: {
          monto: deCentavos(centavosDeTexto(d.monto) as number), fecha_pago: d.fecha, metodo: d.metodo,
          observaciones: d.observaciones || undefined, idempotency_key: clave,
        },
      })
      if (r.repetido) {
        toast.info(`Este pago ya estaba registrado (${textoDinero(aCentavos(r.pago.monto))} del ${fechaCorta(r.pago.fecha_pago)}): no se duplicó.`)
      } else if (r.cobro.estado === 'Pagado') {
        const siguiente = textoSiguiente(r.siguiente_motivo, r.siguiente)
        toast.success(`Cobro de ${periodoLargo(r.cobro.periodo)} pagado completo.${siguiente ? ` ${siguiente}` : ''}`)
      } else {
        toast.success(`Pago registrado. Saldo pendiente: ${textoDinero(aCentavos(r.cobro.saldo))}.`)
      }
      onClose()
    } catch (e) {
      // La clave ya es de otra operación (otro monto, un pago que se anuló…): lo que se mande ahora es un pago
      // distinto y tiene que llevar clave propia. La pantalla ya trae el saldo de ahora (la mutación refresca).
      if (e instanceof ApiError && e.codigo && CODIGOS_CLAVE_USADA.includes(e.codigo)) setClave(nuevaClave())
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el pago.')
    } finally {
      setSaving(false)
    }
  })

  const campo = (k: string, extra = '') => 'field' + extra + (errores[k] ? ' field-error' : '')

  return (
    <Modal
      title="Registrar pago" sub={`${cobro.cliente.nombre} · ${periodoLargo(cobro.periodo)}`} icon="banknote" width={520}
      onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={saving || !admite}>
            {saving ? 'Registrando…' : completa ? 'Registrar y completar el cobro' : 'Registrar pago'}
          </Btn>
        </>
      }
    >
      <div className="cobros-resumen-cobro">
        <div><div className="lbl">Monto del cobro</div><div className="val">{textoDinero(aCentavos(cobro.monto))}</div></div>
        <div><div className="lbl">Ya pagado</div><div className="val">{textoDinero(aCentavos(cobro.monto_pagado))}</div></div>
        <div>
          <div className="lbl">Saldo pendiente</div>
          <div className="val" style={cobro.estado === 'Vencido' ? { color: 'var(--danger)' } : undefined}>{textoDinero(saldoCentavos)}</div>
        </div>
      </div>
      <div className="row gap-sm text-sm muted mb-md" style={{ flexWrap: 'wrap' }}>
        <EstadoCobroBadge estado={cobro.estado} conAbonos={cobro.con_abonos} />
        <span>{conceptoCobro(cobro)} · vence el {fechaCorta(cobro.fecha_vencimiento)}</span>
      </div>

      {!admite && <Aviso tono="error">Este cobro está {cobro.estado === 'Cancelado' ? 'cancelado' : 'pagado completo'}: ya no admite pagos.</Aviso>}
      {errorActualizar && <Aviso tono="error">No se pudo actualizar el cobro ({errorActualizar}). Se muestran los últimos datos que llegaron; el saldo puede haber cambiado.</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="form-grid">
        <div className={campo('monto')}>
          <label className="label" htmlFor="pago-monto">Monto del pago <span className="req">*</span></label>
          <div className="input-group">
            <span className="input-prefix">RD$</span>
            <input
              id="pago-monto" className="input" inputMode="decimal" value={monto} autoFocus disabled={!admite}
              onChange={(e) => { setMonto(e.target.value); setErrores((x) => ({ ...x, monto: '' })) }}
            />
          </div>
          {errores.monto && <div className="err-msg">{errores.monto}</div>}
          {admite && !completa && (
            <button
              type="button" className="filter-chip" style={{ marginTop: 6, whiteSpace: 'nowrap' }}
              onClick={() => { setMonto(textoMontoCampo(saldoCentavos)); setErrores((x) => ({ ...x, monto: '' })) }}
            >
              <Icon name="check" />Pagar todo: {textoDinero(saldoCentavos)}
            </button>
          )}
        </div>
        <div className={campo('fecha')}>
          <label className="label" htmlFor="pago-fecha">Fecha del pago <span className="req">*</span></label>
          <input
            id="pago-fecha" className="input" type="date" value={fecha} max={hoy} disabled={!admite}
            onChange={(e) => { setFecha(e.target.value); setErrores((x) => ({ ...x, fecha: '' })) }}
          />
          {errores.fecha && <div className="err-msg">{errores.fecha}</div>}
        </div>

        <div className={campo('metodo', ' full')}>
          <label className="label">Método de pago <span className="req">*</span></label>
          <div className="cobros-metodos" role="radiogroup" aria-label="Método de pago">
            {METODOS_PAGO.map((m) => (
              <button
                key={m} type="button" role="radio" aria-checked={metodo === m} disabled={!admite}
                className={'cobros-metodo' + (metodo === m ? ' on' : '')} onClick={() => { setMetodo(m); setErrores((x) => ({ ...x, metodo: '' })) }}
              >
                <Icon name={m === 'efectivo' ? 'banknote' : 'landmark'} size={16} />{ETIQUETA_METODO[m]}
              </button>
            ))}
          </div>
          {errores.metodo && <div className="err-msg">{errores.metodo}</div>}
        </div>

        <div className={campo('observaciones', ' full')}>
          <label className="label" htmlFor="pago-obs">Observaciones <span className="opt">(opcional)</span></label>
          <input
            id="pago-obs" className="input" value={observaciones} maxLength={255} disabled={!admite}
            placeholder="Número de transferencia, quién pagó…" onChange={(e) => setObservaciones(e.target.value)}
          />
          {errores.observaciones && <div className="err-msg">{errores.observaciones}</div>}
        </div>
      </div>

      {admite && (
        <p className="text-xs muted-3" style={{ marginTop: 2 }}>
          {completa
            ? 'Con este pago el cobro queda pagado. Si el cliente tiene su cobro mensual activo, se genera solo el cobro del mes siguiente, con el monto mensual de ahora.'
            : 'Un pago parcial no genera el cobro del mes siguiente: eso pasa cuando el cobro queda pagado completo.'}
        </p>
      )}
    </Modal>
  )
}

// Anotar un recordatorio que alguien hizo a mano (una llamada, un mensaje, una visita…). Es solo un
// registro: Fiscalpoint no envía mensajes ni correos. Sirve para saber a quién ya se le recordó y cuándo.
// Se anota en UN cobro (desde la fila de un cliente, en su cobro más urgente), pero cuenta para el cliente entero.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, ErrorState, LoadingState, Modal } from '@/components/ui'
import { ApiError } from '@/api'
import {
  CANALES_RECORDATORIO, ETIQUETA_CANAL, aCentavos, erroresPorCampo, fechaHoraApi, recordatorioFormSchema, textoDinero,
  type CanalRecordatorio,
} from '@/api/schemas/cobros'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { fechaHoraCorta, periodoLargo } from '../format'
import { useDetalleCobro, useRegistrarRecordatorio, useRelojServidor } from '../hooks'
import { Aviso } from './Aviso'

export function RecordatorioFormModal({ cobroId, onClose }: { cobroId: number; onClose: () => void }) {
  const { data, error: errorCarga, loading, reload } = useDetalleCobro(cobroId)
  const registrar = useRegistrarRecordatorio()
  const reloj = useRelojServidor()
  // La hora de RD (la del servidor, no la del navegador): 'AAAA-MM-DD HH:MM:SS' -> fecha y hora de los campos.
  const [ahora] = useState(() => reloj().ahora)
  const [fecha, setFecha] = useState(ahora.slice(0, 10))
  const [hora, setHora] = useState(ahora.slice(11, 16))
  const [canal, setCanal] = useState<CanalRecordatorio | ''>('llamada')
  const [nota, setNota] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const guardar = useAccionUnica(async () => {
    setError(null)
    const ahoraT = reloj().ahora.replace(' ', 'T').slice(0, 16)
    const p = recordatorioFormSchema(ahoraT).safeParse({ fecha, hora, canal, nota })
    if (!p.success) { setErrores(erroresPorCampo(p.error)); return }
    setErrores({})
    setSaving(true)
    try {
      await registrar.mutateAsync({
        cobroId,
        recordatorio: { fecha_hora: fechaHoraApi(p.data.fecha, p.data.hora), canal: p.data.canal, nota: p.data.nota || undefined },
      })
      toast.success(`Recordatorio anotado${data ? ` en el cobro de ${periodoLargo(data.periodo)}` : ''}.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo anotar el recordatorio.')
    } finally {
      setSaving(false)
    }
  })

  if (loading) return <Modal title="Anotar recordatorio" icon="bell" onClose={onClose}><LoadingState rows={3} /></Modal>
  // Solo un error SIN dato impide abrirlo: con dato (un refetch fallido) el formulario sigue y no pierde lo escrito.
  if (!data) {
    return <Modal title="Anotar recordatorio" icon="bell" onClose={onClose}><ErrorState title="No se pudo abrir el cobro" onRetry={reload}>{errorCarga}</ErrorState></Modal>
  }
  const previos = data.recordatorios_lista

  return (
    <Modal
      title="Anotar recordatorio" sub={`${data.cliente.nombre} · ${periodoLargo(data.periodo)} · saldo ${textoDinero(aCentavos(data.saldo))}`}
      icon="bell" width={520} onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Anotar'}</Btn>
        </>
      }
    >
      <Aviso>
        Esto solo deja constancia de que ya le recordaste el pago al cliente: cuenta para todo lo que debe, aunque se anote en este
        cobro. Fiscalpoint no envía mensajes ni correos.
      </Aviso>
      {errorCarga && <Aviso tono="error">No se pudo actualizar el cobro ({errorCarga}). Se muestran los últimos datos que llegaron.</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      {previos.length > 0 && (
        <p className="text-sm muted mb-md">
          Último recordatorio de este cobro: {fechaHoraCorta(previos[0].fecha_hora)} ({ETIQUETA_CANAL[previos[0].canal as CanalRecordatorio] ?? previos[0].canal}
          {previos[0].nota ? `: ${previos[0].nota}` : ''}). En total, {previos.length}.
        </p>
      )}
      <div className="form-grid">
        <div className={'field' + (errores.fecha ? ' field-error' : '')}>
          <label className="label" htmlFor="rec-fecha">Fecha <span className="req">*</span></label>
          <input id="rec-fecha" className="input" type="date" value={fecha} max={ahora.slice(0, 10)} onChange={(e) => setFecha(e.target.value)} />
          {errores.fecha && <div className="err-msg">{errores.fecha}</div>}
        </div>
        <div className={'field' + (errores.hora ? ' field-error' : '')}>
          <label className="label" htmlFor="rec-hora">Hora <span className="req">*</span></label>
          <input id="rec-hora" className="input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          {errores.hora && <div className="err-msg">{errores.hora}</div>}
        </div>
        <div className={'field full' + (errores.canal ? ' field-error' : '')}>
          <label className="label" htmlFor="rec-canal">¿Cómo se lo recordaste? <span className="req">*</span></label>
          <select id="rec-canal" className="select" value={canal} autoFocus onChange={(e) => setCanal(e.target.value as CanalRecordatorio | '')}>
            <option value="">Elige…</option>
            {CANALES_RECORDATORIO.map((c) => <option key={c} value={c}>{ETIQUETA_CANAL[c]}</option>)}
          </select>
          {errores.canal && <div className="err-msg">{errores.canal}</div>}
        </div>
        <div className={'field full' + (errores.nota ? ' field-error' : '')}>
          <label className="label" htmlFor="rec-nota">Nota <span className="opt">(opcional)</span></label>
          <textarea
            id="rec-nota" className="textarea" rows={2} value={nota} maxLength={255}
            placeholder="Qué dijo, cuándo prometió pagar…" onChange={(e) => setNota(e.target.value)}
          />
          {errores.nota && <div className="err-msg">{errores.nota}</div>}
        </div>
      </div>
    </Modal>
  )
}

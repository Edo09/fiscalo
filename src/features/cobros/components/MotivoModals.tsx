// Cancelar un cobro y anular un pago: las dos acciones piden un motivo (opcional) y nunca borran nada.
// El cobro cancelado se puede reabrir; el pago anulado se queda a la vista, tachado, con su motivo.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, ErrorState, LoadingState, Modal } from '@/components/ui'
import { ApiError } from '@/api'
import { aCentavos, motivoFormSchema, textoDinero } from '@/api/schemas/cobros'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { fechaCorta, periodoLargo } from '../format'
import { useAnularPago, useCancelarCobro, useDetalleCobro } from '../hooks'
import { Aviso } from './Aviso'

function Cuerpo({ motivo, setMotivo, error, aviso, etiqueta }: {
  motivo: string; setMotivo: (m: string) => void; error: string | null; aviso: string; etiqueta: string
}) {
  return (
    <>
      <Aviso>{aviso}</Aviso>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="field">
        <label className="label" htmlFor="motivo">{etiqueta} <span className="opt">(opcional)</span></label>
        <textarea
          id="motivo" className="textarea" rows={3} value={motivo} maxLength={255} autoFocus
          placeholder="Por ejemplo: el cliente pidió saltar este mes" onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
    </>
  )
}

export function CancelarCobroModal({ cobroId, onClose }: { cobroId: number; onClose: () => void }) {
  const { data, error: errorCarga, loading, reload } = useDetalleCobro(cobroId)
  const cancelar = useCancelarCobro()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const confirmar = useAccionUnica(async () => {
    setError(null)
    const p = motivoFormSchema.safeParse({ motivo })
    if (!p.success) { setError(p.error.issues[0].message); return }
    setSaving(true)
    try {
      await cancelar.mutateAsync({ id: cobroId, motivo: p.data.motivo || undefined })
      toast.success('Cobro cancelado. Si fue un error, puedes reabrirlo.')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cancelar el cobro.')
    } finally {
      setSaving(false)
    }
  })

  if (loading) return <Modal title="Cancelar cobro" icon="ban" onClose={onClose}><LoadingState rows={2} /></Modal>
  // Solo un error SIN dato impide abrirlo: con dato (un refetch fallido) el formulario sigue y no pierde lo escrito.
  if (!data) {
    return <Modal title="Cancelar cobro" icon="ban" onClose={onClose}><ErrorState title="No se pudo abrir el cobro" onRetry={reload}>{errorCarga}</ErrorState></Modal>
  }
  return (
    <Modal
      title="Cancelar cobro" sub={`${data.cliente.nombre} · ${periodoLargo(data.periodo)} · ${textoDinero(aCentavos(data.monto))}`}
      icon="ban" onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>No cancelar</Btn>
          <Btn variant="danger" icon="ban" onClick={() => void confirmar()} disabled={saving}>{saving ? 'Cancelando…' : 'Cancelar el cobro'}</Btn>
        </>
      }
    >
      <Cuerpo
        motivo={motivo} setMotivo={setMotivo} error={error} etiqueta="Motivo"
        aviso="El cobro no se borra: queda en el historial como cancelado y se puede reabrir. Un cobro cancelado no genera el cobro del mes siguiente."
      />
    </Modal>
  )
}

export function AnularPagoModal({ pagoId, cobroId, onClose }: { pagoId: number; cobroId: number; onClose: () => void }) {
  const { data, error: errorCarga, loading, reload } = useDetalleCobro(cobroId)
  const anular = useAnularPago()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const confirmar = useAccionUnica(async () => {
    setError(null)
    const p = motivoFormSchema.safeParse({ motivo })
    if (!p.success) { setError(p.error.issues[0].message); return }
    setSaving(true)
    try {
      const r = await anular.mutateAsync({ pagoId, motivo: p.data.motivo || undefined })
      toast.success(`Pago anulado. Saldo pendiente: ${textoDinero(aCentavos(r.cobro.saldo))}.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo anular el pago.')
    } finally {
      setSaving(false)
    }
  })

  if (loading) return <Modal title="Anular pago" icon="ban" onClose={onClose}><LoadingState rows={2} /></Modal>
  if (!data) {
    return <Modal title="Anular pago" icon="ban" onClose={onClose}><ErrorState title="No se pudo abrir el cobro" onRetry={reload}>{errorCarga}</ErrorState></Modal>
  }
  const pago = data.pagos.find((x) => x.id === pagoId)
  if (!pago) {
    return <Modal title="Anular pago" icon="ban" onClose={onClose}><Aviso tono="error">Este pago ya no existe. Actualiza la pantalla.</Aviso></Modal>
  }
  return (
    <Modal
      title="Anular pago"
      sub={`${data.cliente.nombre} · ${periodoLargo(data.periodo)} · ${textoDinero(aCentavos(pago.monto))} del ${fechaCorta(pago.fecha_pago)}`}
      icon="ban" onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>No anular</Btn>
          <Btn variant="danger" icon="ban" onClick={() => void confirmar()} disabled={saving || pago.anulado}>{saving ? 'Anulando…' : 'Anular el pago'}</Btn>
        </>
      }
    >
      <Cuerpo
        motivo={motivo} setMotivo={setMotivo} error={error} etiqueta="Motivo de la anulación"
        aviso={pago.anulado
          ? 'Este pago ya está anulado.'
          : 'El pago deja de contar en el saldo del cobro, pero se queda en el historial, tachado y con su motivo. Si el cobro ya generó el del mes siguiente, ese se queda.'}
      />
    </Modal>
  )
}

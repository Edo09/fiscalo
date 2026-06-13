// FISCALO — Revisar un e-CF recibido: aprobarlo o rechazarlo ante la DGII
// (aprobación comercial / ACECF). POST /api/aprobaciones-comerciales.
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Seg, Icon, Money, EstadoBadge } from '@/components/ui'
import { ApiError, aprobarEcfRecibido, dgiiLabel, formatApiDate } from '@/api'
import type { EcfRecibidoRow } from '@/api'

export function ApproveEcfModal({ ecf, onClose }: { ecf: EcfRecibidoRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [decision, setDecision] = useState<'Aprobar' | 'Rechazar'>('Aprobar')
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rechazar = decision === 'Rechazar'

  const confirm = async () => {
    if (rechazar && motivo.trim() === '') {
      setError('El motivo del rechazo es obligatorio.')
      return
    }
    setError(null)
    setSubmitting(true)
    // El envío hace un viaje síncrono a la DGII (firma + envío del ACECF).
    const tid = toast.loading(rechazar ? 'Enviando rechazo a la DGII…' : 'Enviando aprobación a la DGII…')
    try {
      await aprobarEcfRecibido({
        rnc_emisor: ecf.rnc_emisor,
        e_ncf: ecf.e_ncf,
        // Se envía la fecha/monto tal como llegaron en el e-CF recibido.
        fecha_emision: ecf.fecha_emision ?? '',
        monto_total: String(ecf.monto_total ?? '0'),
        estado: rechazar ? '2' : '1',
        ...(rechazar ? { detalle_motivo: motivo.trim() } : {}),
      })
      // Refresca el listado (la columna Aprobación cambia).
      void queryClient.invalidateQueries({ queryKey: ['ecf-recibidos'] })
      toast.success(rechazar ? 'e-CF rechazado ante la DGII.' : 'e-CF aprobado ante la DGII.', { id: tid })
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'No se pudo enviar la respuesta a la DGII.'
      toast.error(msg, { id: tid })
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="Revisar e-CF recibido"
      sub={ecf.razon_social_emisor || ecf.rnc_emisor}
      icon="badge-check"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn
            variant="primary"
            icon={rechazar ? 'x-circle' : 'check-circle'}
            style={rechazar ? { background: 'var(--danger)' } : undefined}
            onClick={confirm}
            disabled={submitting}
          >
            {submitting ? 'Enviando…' : rechazar ? 'Rechazar e-CF' : 'Aprobar e-CF'}
          </Btn>
        </>
      }
    >
      <div className="col gap-sm" style={{ marginBottom: 16 }}>
        <SummaryRow label="e-NCF"><span className="mono fw6">{ecf.e_ncf}</span></SummaryRow>
        <SummaryRow label="Emisor">{ecf.razon_social_emisor || '—'}</SummaryRow>
        <SummaryRow label="RNC emisor"><span className="mono">{ecf.rnc_emisor}</span></SummaryRow>
        <SummaryRow label="Tipo"><span className="ecf-tag">{ecf.tipo_ecf}</span></SummaryRow>
        <SummaryRow label="Fecha">{formatApiDate(ecf.fecha_emision)}</SummaryRow>
        <SummaryRow label="Recepción">{ecf.estado ? <EstadoBadge estado={dgiiLabel(ecf.estado)} /> : '—'}</SummaryRow>
        <SummaryRow label="Monto total"><span className="fw6"><Money value={Number(ecf.monto_total ?? 0)} /></span></SummaryRow>
      </div>

      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      <div className="field" style={{ margin: 0 }}>
        <label className="label">Decisión</label>
        <Seg options={['Aprobar', 'Rechazar']} value={decision} onChange={(v) => setDecision(v as 'Aprobar' | 'Rechazar')} />
      </div>

      {rechazar && (
        <div className="field" style={{ marginTop: 14 }}>
          <label className="label">Motivo del rechazo <span className="req">*</span></label>
          <textarea
            className="textarea"
            placeholder="Explica por qué rechazas este comprobante (lo recibe la DGII)…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="text-xs muted-3" style={{ marginTop: 14 }}>
        {rechazar
          ? 'Se enviará tu rechazo comercial a la DGII (ACECF); el emisor verá que rechazaste el comprobante.'
          : 'Se enviará tu aprobación comercial a la DGII (ACECF), confirmando que aceptas este comprobante.'}
      </div>
    </Modal>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row between text-sm">
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  )
}

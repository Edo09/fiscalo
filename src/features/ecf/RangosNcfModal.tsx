// FISCALO — Rangos e-NCF autorizados por DGII: listado + registro de un rango
// nuevo (cuando el activo se agota, se solicita a DGII y se registra aquí).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Badge, Icon, Spinner, type BadgeTone } from '@/components/ui'
import { ApiError, listNcfRangos, registerNcfRango, formatApiDate } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ECF_TIPOS } from '@/config/ecf'

const ESTADO_RANGO: Record<string, { label: string; tone: BadgeTone }> = {
  activo: { label: 'Activo', tone: 'success' },
  pendiente: { label: 'En cola', tone: 'info' },
  agotado: { label: 'Agotado', tone: 'danger' },
  vencido: { label: 'Vencido', tone: 'danger' },
  sin_limite: { label: 'Sin límite', tone: 'warning' },
}

export function RangosNcfModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const rangos = useApiQuery(['ncf', 'rangos'], () => listNcfRangos())

  const [formOpen, setFormOpen] = useState(false)
  const [tipo, setTipo] = useState('E31')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [venc, setVenc] = useState('')
  const [solicitud, setSolicitud] = useState('')
  const [autorizacion, setAutorizacion] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const registrar = async () => {
    setError(null)
    const d = Number(desde)
    const h = Number(hasta)
    if (!d || !h || d < 1 || h < d) { setError('Indica un rango válido (desde ≥ 1, hasta ≥ desde).'); return }
    if (!venc) { setError('Indica la fecha de vencimiento del rango.'); return }
    setSaving(true)
    try {
      await registerNcfRango({
        type: tipo,
        numero_desde: d,
        numero_hasta: h,
        fecha_vencimiento: venc,
        no_solicitud: solicitud.trim() || undefined,
        no_autorizacion: autorizacion.trim() || undefined,
      })
      toast.success(`Rango ${tipo} ${d}–${h} registrado.`)
      // El próximo e-NCF y los restantes cambian: invalidar rangos y stats.
      void queryClient.invalidateQueries({ queryKey: ['ncf'] })
      void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })
      void queryClient.invalidateQueries({ queryKey: ['gastos', 'stats'] })
      setFormOpen(false)
      setDesde(''); setHasta(''); setVenc(''); setSolicitud(''); setAutorizacion('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el rango.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Rangos e-NCF autorizados"
      sub="Secuencias aprobadas por la DGII para el ambiente activo"
      icon="hash"
      width={680}
      onClose={onClose}
      footer={<Btn variant="ghost" onClick={onClose}>Cerrar</Btn>}
    >
      {rangos.loading ? (
        <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Spinner /></div>
      ) : rangos.error ? (
        <div className="text-sm" style={{ color: 'var(--danger)' }}>{rangos.error}</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tipo</th><th>Rango</th><th className="num">Usados</th><th className="num">Restantes</th>
                <th>Vence</th><th>Autorización</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(rangos.data ?? []).map((r) => {
                const est = ESTADO_RANGO[r.estado ?? ''] ?? { label: r.estado ?? '—', tone: 'neutral' as BadgeTone }
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td><span className="ecf-tag">{r.type}</span></td>
                    <td className="mono text-sm">
                      {Number(r.numero_desde)}–{r.numero_hasta != null ? Number(r.numero_hasta) : '∞'}
                    </td>
                    <td className="num">{Number(r.usados ?? 0)}</td>
                    <td className="num fw6">{r.restantes != null ? Number(r.restantes) : '—'}</td>
                    <td className="text-sm muted">{r.fecha_vencimiento ? formatApiDate(r.fecha_vencimiento) : '—'}</td>
                    <td className="mono text-xs muted">{r.no_autorizacion || '—'}</td>
                    <td><Badge tone={est.tone} dot>{est.label}</Badge></td>
                  </tr>
                )
              })}
              {(rangos.data ?? []).length === 0 && (
                <tr style={{ cursor: 'default' }}><td colSpan={7}><div className="state" style={{ padding: 20 }}><span className="text-sm muted">Sin rangos en este ambiente.</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-md">
        {!formOpen ? (
          <Btn variant="primary" icon="plus" onClick={() => setFormOpen(true)}>Registrar rango aprobado</Btn>
        ) : (
          <div className="card card-pad">
            <div className="fw6 text-sm mb-sm">Nuevo rango (aprobado por DGII)</div>
            {error && (
              <div className="row gap-sm" style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>
                <Icon name="alert-circle" size={14} /><span>{error}</span>
              </div>
            )}
            <div className="form-grid">
              <div className="field">
                <label className="label">Tipo e-CF</label>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {ECF_TIPOS.map((t) => <option key={t.code} value={`E${t.code}`}>E{t.code} · {t.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Fecha vencimiento <span className="req">*</span></label>
                <input className="input" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Número desde <span className="req">*</span></label>
                <input className="input num" type="number" min="1" value={desde} onChange={(e) => setDesde(e.target.value)} placeholder="101" />
              </div>
              <div className="field">
                <label className="label">Número hasta <span className="req">*</span></label>
                <input className="input num" type="number" min="1" value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="200" />
              </div>
              <div className="field">
                <label className="label">No. Solicitud <span className="opt">(opcional)</span></label>
                <input className="input mono" value={solicitud} onChange={(e) => setSolicitud(e.target.value)} placeholder="6009804999" />
              </div>
              <div className="field">
                <label className="label">No. Autorización <span className="opt">(opcional)</span></label>
                <input className="input mono" value={autorizacion} onChange={(e) => setAutorizacion(e.target.value)} placeholder="6005308087" />
              </div>
            </div>
            <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" onClick={() => { setFormOpen(false); setError(null) }}>Cancelar</Btn>
              <Btn variant="primary" size="sm" icon="check" onClick={registrar} disabled={saving}>
                {saving ? 'Registrando…' : 'Registrar rango'}
              </Btn>
            </div>
          </div>
        )}
      </div>
      <div className="text-xs muted-3 mt-sm">
        El rango se solicita en la Oficina Virtual de la DGII; al aprobarse, regístralo aquí con su Número Desde/Hasta, vencimiento y autorización.
      </div>
    </Modal>
  )
}

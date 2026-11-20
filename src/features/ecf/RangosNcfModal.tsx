// FISCALO — Rangos e-NCF autorizados por DGII: listado, registro de un rango nuevo (cuando el
// activo se agota, se solicita a DGII y se registra aquí) y corrección de uno ya registrado.
import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Badge, Icon, Spinner, type BadgeTone } from '@/components/ui'
import { ApiError, listNcfRangos, registerNcfRango, updateNcfRango, formatApiDate, type NcfRango } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ECF_TIPOS } from '@/config/ecf'
import { cambiosDelFormulario, problemaConEdicion, problemaConExistentes, type FormularioEdicion } from './rangosNcf'

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

  // Corrección de un rango ya registrado (PUT /api/ncf/rangos/{id}): el rango abierto y su formulario.
  const [editando, setEditando] = useState<NcfRango | null>(null)
  const [form, setForm] = useState<FormularioEdicion>({
    fecha_vencimiento: '', numero_desde: '', numero_hasta: '', no_solicitud: '', no_autorizacion: '',
  })
  const campo = (k: keyof FormularioEdicion) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // «Desde» no se cambia con números usados; sin cambios no hay nada que guardar.
  const desdeBloqueado = editando != null && Number(editando.usados ?? 0) > 0
  const sinCambios = editando != null && Object.keys(cambiosDelFormulario(editando, form)).length === 0

  // El próximo e-NCF y los restantes cambian: invalidar rangos y stats.
  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['ncf'] })
    void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })
    void queryClient.invalidateQueries({ queryKey: ['facturas', 'avisos'] })
    void queryClient.invalidateQueries({ queryKey: ['gastos', 'stats'] })
  }

  const registrar = async () => {
    setError(null)
    const d = Number(desde)
    const h = Number(hasta)
    if (!Number.isInteger(d) || d < 1) { setError('El número «Desde» tiene que ser un número entero de 1 o más.'); return }
    if (!Number.isInteger(h) || h < d) { setError('El número «Hasta» no puede ser menor que «Desde».'); return }
    if (!venc) { setError('Pon la fecha de vencimiento del rango.'); return }
    // Con la tabla cargada se sabe si choca con lo que ya hay; si no cargó,
    // decide el servidor.
    const choque = rangos.data ? problemaConExistentes(rangos.data, tipo, d, h) : null
    if (choque) { setError(choque); return }
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
      refrescar()
      setFormOpen(false)
      setDesde(''); setHasta(''); setVenc(''); setSolicitud(''); setAutorizacion('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el rango.')
    } finally {
      setSaving(false)
    }
  }

  const abrirEdicion = (r: NcfRango) => {
    setFormOpen(false)
    setError(null)
    setEditando(r)
    // Con las cadenas crudas del API: la fecha nunca pasa por formatApiDate (cambiaría lo que se compara y se envía).
    setForm({
      fecha_vencimiento: r.fecha_vencimiento ?? '',
      numero_desde: String(r.numero_desde),
      numero_hasta: String(r.numero_hasta ?? ''),
      no_solicitud: r.no_solicitud ?? '',
      no_autorizacion: r.no_autorizacion ?? '',
    })
  }
  const cerrarEdicion = () => { setEditando(null); setError(null) }

  const guardarEdicion = async () => {
    if (!editando) return
    setError(null)
    if (!form.fecha_vencimiento) { setError('Pon la fecha de vencimiento del rango.'); return }
    const cambios = cambiosDelFormulario(editando, form)
    // Con la tabla cargada se avisa antes de enviar; el servidor, que además ve las facturas, decide.
    const problema = problemaConEdicion(rangos.data ?? [], editando, cambios)
    if (problema) { setError(problema); return }
    setSaving(true)
    try {
      await updateNcfRango(editando.id, cambios)
      toast.success(`Rango ${editando.type} actualizado.`)
      refrescar()
      setEditando(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el cambio del rango.')
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
                <th>Vence</th><th>Autorización</th><th>Estado</th><th />
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
                    <td className="num">
                      {/* Las filas «sin límite» no son un rango: se formalizan con «Registrar rango aprobado». */}
                      {r.numero_hasta != null && (
                        <Btn variant="ghost" size="sm" icon="edit-3" title="Editar rango" aria-label={`Editar rango ${r.type}`} onClick={() => abrirEdicion(r)} />
                      )}
                    </td>
                  </tr>
                )
              })}
              {(rangos.data ?? []).length === 0 && (
                <tr style={{ cursor: 'default' }}><td colSpan={8}><div className="state" style={{ padding: 20 }}><span className="text-sm muted">Sin rangos en este ambiente.</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-md">
        {editando ? (
          <div className="card card-pad">
            <div className="fw6 text-sm mb-sm">Editar rango {editando.type} {Number(editando.numero_desde)}–{Number(editando.numero_hasta)}</div>
            {error && (
              <div className="row gap-sm" style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>
                <Icon name="alert-circle" size={14} /><span>{error}</span>
              </div>
            )}
            <div className="form-grid">
              <div className="field">
                <label className="label">Tipo e-CF</label>
                <input className="input mono" value={editando.type} disabled />
              </div>
              <div className="field">
                <label className="label">Fecha vencimiento <span className="req">*</span></label>
                <input className="input" type="date" value={form.fecha_vencimiento} onChange={campo('fecha_vencimiento')} />
                <div className="text-xs muted-3 mt-sm">Es la fecha que se envía a la DGII: debe coincidir con tu autorización.</div>
              </div>
              <div className="field">
                <label className="label">Número desde <span className="req">*</span></label>
                <input className="input num" type="number" min="1" value={form.numero_desde} onChange={campo('numero_desde')} disabled={desdeBloqueado} />
                {desdeBloqueado && <div className="text-xs muted-3 mt-sm">Ya hay {Number(editando.usados)} usados: no se puede cambiar.</div>}
              </div>
              <div className="field">
                <label className="label">Número hasta <span className="req">*</span></label>
                <input className="input num" type="number" min="1" value={form.numero_hasta} onChange={campo('numero_hasta')} />
              </div>
              <div className="field">
                <label className="label">No. Solicitud <span className="opt">(opcional)</span></label>
                <input className="input mono" value={form.no_solicitud} onChange={campo('no_solicitud')} placeholder="6009804999" />
              </div>
              <div className="field">
                <label className="label">No. Autorización <span className="opt">(opcional)</span></label>
                <input className="input mono" value={form.no_autorizacion} onChange={campo('no_autorizacion')} placeholder="6005308087" />
              </div>
            </div>
            <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="sm" onClick={cerrarEdicion}>Cancelar</Btn>
              <Btn variant="primary" size="sm" icon="check" onClick={guardarEdicion} disabled={saving || sinCambios}>
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </Btn>
            </div>
          </div>
        ) : !formOpen ? (
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

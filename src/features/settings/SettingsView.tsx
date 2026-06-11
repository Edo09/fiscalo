import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Switch, Card, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { getEmisor, getStats, getBranding, uploadBrandingLogo, deleteBrandingLogo, formatApiDate, ApiError } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { BrandingSection } from './BrandingSection'

/* FISCALO — Configuración */

// Valores reales del backend: testecf | certecf | ecf
const AMBIENTES: Record<string, string> = {
  ecf: 'Producción',
  certecf: 'Certificación (CerteCF)',
  testecf: 'Pruebas (TesteCF)',
}

function initials(name?: string | null): string {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—'
}

export function SettingsView() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sec, setSec] = useState('empresa')
  const [dgiiAuto, setDgiiAuto] = useState(true)
  const [logoBusy, setLogoBusy] = useState(false)
  const { data: emisor, error, loading, reload } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())

  const invalidateBranding = () => void queryClient.invalidateQueries({ queryKey: ['branding'] })

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast.error('El logo debe ser PNG o JPG.'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('El logo no puede pasar de 2 MB.'); return }
    setLogoBusy(true)
    try {
      await uploadBrandingLogo(file)
      invalidateBranding()
      toast.success('Logo actualizado.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir el logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  const removeLogo = async () => {
    setLogoBusy(true)
    try {
      await deleteBrandingLogo()
      invalidateBranding()
      toast.success('Logo eliminado.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el logo.')
    } finally {
      setLogoBusy(false)
    }
  }
  const secs = [
    { id: 'empresa', label: 'Datos de empresa', ic: 'building-2' },
    { id: 'fiscal', label: 'Configuración DGII', ic: 'landmark' },
    { id: 'numeracion', label: 'Numeraciones e-CF', ic: 'hash' },
    { id: 'plantillas', label: 'Plantillas PDF', ic: 'file-text' },
  ]
  return (
    <div className="page page-wide">
      <PageHead title="Configuración" sub="Ajustes generales y fiscales del sistema" />
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8 }}>
          {secs.map((s) => (
            <div key={s.id} className={'nav-item' + (sec === s.id ? ' active' : '')} onClick={() => setSec(s.id)}><Icon name={s.ic} size={17} />{s.label}</div>
          ))}
        </div>
        <div className="col gap-md">
          {sec === 'empresa' && (
            <Card title="Datos de empresa" sub="Datos del emisor registrados en la DGII · solo lectura">
              {loading ? (
                <LoadingState rows={5} />
              ) : error ? (
                <ErrorState title="No se pudieron cargar los datos del emisor" onRetry={reload}>{error}</ErrorState>
              ) : emisor && (
                <>
                  <div className="row gap-md mb-lg" style={{ alignItems: 'center' }}>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => void onLogoPick(e)} />
                    <div className="brand-mark" style={{ width: 56, height: 56, fontSize: 22 }}>{initials(emisor.razon_social)}</div>
                    <Btn variant="secondary" size="sm" icon="upload" onClick={() => fileRef.current?.click()} disabled={logoBusy}>
                      {branding?.has_custom_logo ? 'Cambiar logo' : 'Subir logo'}
                    </Btn>
                    {branding?.has_custom_logo && (
                      <Btn variant="ghost" size="sm" icon="trash-2" onClick={() => void removeLogo()} disabled={logoBusy}>Quitar</Btn>
                    )}
                    <span className="text-xs muted-3">PNG o JPG, máx. 2 MB</span>
                  </div>
                  <div className="form-grid">
                    <div className="field"><label>Razón social</label><input className="input" readOnly value={emisor.razon_social} /></div>
                    <div className="field"><label>Nombre comercial</label><input className="input" readOnly value={emisor.nombre_comercial ?? '—'} /></div>
                    <div className="field"><label>RNC</label><input className="input mono" readOnly value={emisor.rnc} /></div>
                    <div className="field"><label>Sucursal</label><input className="input" readOnly value={emisor.sucursal ?? '—'} /></div>
                    <div className="field full"><label>Dirección</label><input className="input" readOnly value={emisor.direccion ?? '—'} /></div>
                    <div className="field"><label>Municipio</label><input className="input" readOnly value={emisor.municipio ?? '—'} /></div>
                    <div className="field"><label>Provincia</label><input className="input" readOnly value={emisor.provincia ?? '—'} /></div>
                    <div className="field"><label>Teléfono</label><input className="input" readOnly value={emisor.telefono ?? '—'} /></div>
                    <div className="field"><label>Correo</label><input className="input" readOnly value={emisor.correo ?? '—'} /></div>
                    <div className="field"><label>Sitio web</label><input className="input" readOnly value={emisor.website ?? '—'} /></div>
                    <div className="field"><label>Actividad económica</label><input className="input" readOnly value={emisor.actividad_economica ?? '—'} /></div>
                  </div>
                </>
              )}
            </Card>
          )}
          {sec === 'fiscal' && (
            <Card title="Configuración DGII">
              {loading ? (
                <LoadingState rows={4} />
              ) : error ? (
                <ErrorState title="No se pudo cargar la configuración" onRetry={reload}>{error}</ErrorState>
              ) : (
                <div className="col gap-lg">
                  <div className="row between"><div><div className="fw6 text-sm">Envío automático a DGII</div><div className="text-xs muted">Transmite los e-CF al emitirlos, sin pasos extra.</div></div><Switch on={dgiiAuto} onChange={setDgiiAuto} /></div>
                  <div className="divider" style={{ margin: 0 }}></div>
                  <div className="form-grid">
                    <div className="field"><label>Ambiente</label><input className="input" readOnly value={AMBIENTES[emisor?.ambiente ?? ''] ?? emisor?.ambiente ?? '—'} /></div>
                    <div className="field"><label>RNC autorizado</label><input className="input mono" readOnly value={emisor?.rnc ?? '—'} /></div>
                    <div className="field"><label>Vencimiento de secuencias</label><input className="input" readOnly value={formatApiDate(emisor?.fecha_vencimiento_secuencia)} /></div>
                  </div>
                </div>
              )}
            </Card>
          )}
          {sec === 'numeracion' && (
            <Card title="Numeraciones e-CF" sub="Secuencias autorizadas por la DGII · solo lectura" noPad>
              {stats.loading ? (
                <LoadingState rows={4} />
              ) : stats.error ? (
                <ErrorState title="No se pudieron cargar las secuencias" onRetry={stats.reload}>{stats.error}</ErrorState>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Tipo</th><th>Próximo e-NCF</th><th className="num">Emitidos</th></tr></thead>
                  <tbody>
                    {(stats.data?.secuencias ?? []).map((s) => (
                      <tr key={s.type} style={{ cursor: 'default' }}>
                        <td><span className="ecf-tag">{s.type}</span> <span className="text-sm">{s.nombre}</span></td>
                        {/* secuencia_actual es el último número asignado; el próximo es +1 (10 dígitos). */}
                        <td className="mono text-sm muted">{s.type}{String((s.secuencia_actual ?? 0) + 1).padStart(10, '0')}</td>
                        <td className="num fw6">{s.total_emitidos}</td>
                      </tr>
                    ))}
                    {(stats.data?.secuencias ?? []).length === 0 && (
                      <tr style={{ cursor: 'default' }}>
                        <td colSpan={3}><div className="text-sm muted" style={{ padding: 20, textAlign: 'center' }}>Sin secuencias registradas.</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </Card>
          )}
          {sec === 'plantillas' && <BrandingSection />}
        </div>
      </div>
    </div>
  )
}

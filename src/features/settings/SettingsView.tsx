import { useState } from 'react'
import { Icon, Btn, Badge, Switch, Card, EmptyState, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Configuración */
export function SettingsView() {
  const D = DATA
  const [sec, setSec] = useState('empresa')
  const [dgiiAuto, setDgiiAuto] = useState(true)
  const [smtpOn, setSmtpOn] = useState(true)
  const secs = [
    { id: 'empresa', label: 'Datos de empresa', ic: 'building-2' },
    { id: 'fiscal', label: 'Configuración DGII', ic: 'landmark' },
    { id: 'certificado', label: 'Certificado digital', ic: 'shield-check' },
    { id: 'numeracion', label: 'Numeraciones e-CF', ic: 'hash' },
    { id: 'correo', label: 'Correo (SMTP)', ic: 'mail' },
    { id: 'plantillas', label: 'Plantillas PDF', ic: 'file-text' },
    { id: 'impuestos', label: 'Impuestos y monedas', ic: 'percent' },
    { id: 'sucursales', label: 'Sucursales', ic: 'map-pin' },
  ]
  const current = secs.find((s) => s.id === sec)!
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
            <Card title="Datos de empresa" sub="Aparecen en todos tus comprobantes">
              <div className="row gap-md mb-lg" style={{ alignItems: 'center' }}>
                <div className="brand-mark" style={{ width: 56, height: 56, fontSize: 22 }}>DC</div>
                <Btn variant="secondary" size="sm" icon="upload">Cambiar logo</Btn>
                <span className="text-xs muted-3">PNG o SVG, máx. 1MB</span>
              </div>
              <div className="form-grid">
                <div className="field full"><label>Razón social</label><input className="input" defaultValue={D.empresa.nombre} /></div>
                <div className="field"><label>RNC</label><input className="input mono" defaultValue={D.empresa.rnc} /></div>
                <div className="field"><label>Teléfono</label><input className="input" defaultValue={D.empresa.telefono} /></div>
                <div className="field full"><label>Dirección</label><input className="input" defaultValue={D.empresa.direccion} /></div>
                <div className="field full"><label>Correo</label><input className="input" defaultValue={D.empresa.email} /></div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><Btn variant="ghost">Cancelar</Btn><Btn variant="primary" icon="check">Guardar cambios</Btn></div>
            </Card>
          )}
          {sec === 'fiscal' && (
            <Card title="Configuración DGII">
              <div className="col gap-lg">
                <div className="row between"><div><div className="fw6 text-sm">Envío automático a DGII</div><div className="text-xs muted">Transmite los e-CF al emitirlos, sin pasos extra.</div></div><Switch on={dgiiAuto} onChange={setDgiiAuto} /></div>
                <div className="divider" style={{ margin: 0 }}></div>
                <div className="form-grid">
                  <div className="field"><label>Ambiente</label><select className="select"><option>Producción</option><option>Certificación (pruebas)</option></select></div>
                  <div className="field"><label>RNC autorizado</label><input className="input mono" defaultValue="131456789" /></div>
                </div>
                <div className="row gap-sm" style={{ padding: 12, background: 'var(--success-soft)', borderRadius: 9, color: 'var(--success)' }}><Icon name="check-circle" size={16} /><span className="text-sm fw5">Conexión con el webservice de la DGII verificada hace 4 min.</span></div>
              </div>
            </Card>
          )}
          {sec === 'certificado' && (
            <Card title="Certificado digital">
              <div className="row gap-md" style={{ padding: 16, background: 'var(--bg)', borderRadius: 9, border: '1px solid var(--border)' }}>
                <span className="kpi-ic" style={{ background: 'var(--success-soft)', color: 'var(--success)', width: 40, height: 40 }}><Icon name="shield-check" size={20} /></span>
                <div style={{ flex: 1 }}><div className="fw6">distribuidora_caribe.p12</div><div className="text-xs muted">Emitido por Avansi · Serie 4A:8F:3K · Vence 15 jul 2026</div></div>
                <Badge tone="warning">47 días</Badge>
              </div>
              <Btn variant="secondary" icon="upload" className="mt-md">Subir nuevo certificado</Btn>
            </Card>
          )}
          {sec === 'numeracion' && (
            <Card title="Numeraciones e-CF" sub="Secuencias autorizadas por la DGII" noPad>
              <table className="tbl">
                <thead><tr><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Disponibles</th></tr></thead>
                <tbody>
                  {D.ecfTipos.slice(0, 5).map((t) => (
                    <tr key={t.code} style={{ cursor: 'default' }}>
                      <td><span className="ecf-tag">{t.code}</span> <span className="text-sm">{t.nombre}</span></td>
                      <td className="mono text-sm muted">E{t.code}00000000001</td>
                      <td className="mono text-sm muted">E{t.code}00000010000</td>
                      <td className="num fw6">{D.fmt0(10000 - t.emitidos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {sec === 'correo' && (
            <Card title="Correo saliente (SMTP)">
              <div className="row between mb-lg"><div><div className="fw6 text-sm">Envío de facturas por correo</div><div className="text-xs muted">Adjunta el PDF y el XML automáticamente.</div></div><Switch on={smtpOn} onChange={setSmtpOn} /></div>
              <div className="form-grid">
                <div className="field"><label>Servidor SMTP</label><input className="input" defaultValue="smtp.distcaribe.do" /></div>
                <div className="field"><label>Puerto</label><input className="input" defaultValue="587" /></div>
                <div className="field full"><label>Correo remitente</label><input className="input" defaultValue="facturacion@distcaribe.do" /></div>
              </div>
            </Card>
          )}
          {(sec === 'plantillas' || sec === 'impuestos' || sec === 'sucursales') && (
            <Card title={current.label}>
              <EmptyState icon={current.ic} title="Configuración disponible" action={<Btn variant="primary" icon="plus">Configurar</Btn>}>
                Ajusta esta sección según las necesidades de tu negocio.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

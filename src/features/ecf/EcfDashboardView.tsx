import { useState } from 'react'
import { Icon, Btn, Money, Badge, Card, Progress, Spinner, ErrorState, PageHead } from '@/components/ui'
import { getStats, formatApiDate } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ECF_TIPOS } from '@/config/ecf'
import { RangosNcfModal } from './RangosNcfModal'
import type { Nav } from '@/config/navigation'

/* FISCALO — Dashboard e-CF (GET /api/facturas/stats) */
export function EcfDashboardView({ nav }: { nav: Nav }) {
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const d = stats.data
  const [rangosOpen, setRangosOpen] = useState(false)

  const totalAceptados = d?.por_estado.filter((e) => e.estado.includes('ACEPTADO')).reduce((a, e) => a + e.total, 0) ?? 0
  const totalEnProceso = d?.por_estado.filter((e) => e.estado === 'ENVIADO' || e.estado === 'EN_PROCESO').reduce((a, e) => a + e.total, 0) ?? 0
  const totalRechazados = d?.por_estado.filter((e) => e.estado.includes('RECHAZADO')).reduce((a, e) => a + e.total, 0) ?? 0
  const totalEcf = d?.resumen.total_ecf ?? 0

  const estados = [
    { label: 'Aceptados', value: totalAceptados, color: 'var(--success)', icon: 'check-circle', bg: 'var(--success-soft)' },
    { label: 'En proceso', value: totalEnProceso, color: 'var(--warning)', icon: 'loader', bg: 'var(--warning-soft)' },
    { label: 'Rechazados', value: totalRechazados, color: 'var(--danger)', icon: 'x-circle', bg: 'var(--danger-soft)' },
    { label: 'Total e-CF', value: totalEcf, color: 'var(--text-2)', icon: 'file-text', bg: 'var(--neutral-soft)' },
  ]

  return (
    <div className="page page-wide">
      <PageHead
        title="Comprobantes Fiscales Electrónicos"
        sub="Monitoreo de tu facturación electrónica ante la DGII."
        actions={
          <>
            <Btn variant="secondary" icon="inbox" onClick={() => nav('bandeja-dgii')}>Bandeja DGII</Btn>
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Emitir e-CF</Btn>
          </>
        }
      />

      {stats.error ? (
        <ErrorState title="No se pudieron cargar las estadísticas" onRetry={stats.reload}>{stats.error}</ErrorState>
      ) : (
        <>
          <div className="dash-grid">
            <div className="col gap-md">
            {/* KPIs compactos (2x2) al lado de Secuencias: sin franja vacía */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {estados.map((e, i) => (
                <div className="kpi" key={i} style={{ padding: '10px 14px' }}>
                  <div className="row between" style={{ alignItems: 'center' }}>
                    <div className="row gap-sm" style={{ alignItems: 'center' }}>
                      <span className="kpi-ic" style={{ background: e.bg, color: e.color, width: 26, height: 26 }}><Icon name={e.icon} size={14} /></span>
                      <span className="kpi-label">{e.label}</span>
                    </div>
                    <div className="row gap-sm" style={{ alignItems: 'baseline' }}>
                      <span className="num fw6" style={{ fontSize: 19, letterSpacing: '-0.02em' }}>{stats.loading ? '—' : e.value}</span>
                      <span className="text-xs muted-3">de {totalEcf}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Card title="Resumen por tipo" sub="Comprobantes emitidos por tipo de e-CF" noPad>
              {stats.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner /></div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>Tipo</th><th>Nombre</th><th className="num">Total</th><th className="num">Aceptados</th><th className="num">Rechazados</th><th className="num">Monto</th></tr></thead>
                    <tbody>
                      {(d?.por_tipo ?? []).map((t) => (
                        <tr key={t.tipo_ecf} onClick={() => nav('ecf-tipo', { code: t.tipo_ecf, nombre: t.nombre, emitidos: t.total, mes: t.total, desc: '' })}>
                          <td><span className="ecf-tag">{t.tipo_ecf}</span></td>
                          <td className="text-sm">{t.nombre}</td>
                          <td className="num fw6">{t.total}</td>
                          <td className="num" style={{ color: 'var(--success)' }}>{t.aceptados}</td>
                          <td className="num" style={{ color: t.rechazados > 0 ? 'var(--danger)' : 'var(--text-3)' }}>{t.rechazados}</td>
                          <td className="num fw6"><Money value={t.monto_total} cur={false} /></td>
                        </tr>
                      ))}
                      {(d?.por_tipo ?? []).length === 0 && (
                        <tr style={{ cursor: 'default' }}><td colSpan={6}><div className="state" style={{ padding: 24 }}><span className="text-sm muted">Sin comprobantes emitidos.</span></div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Tipos de comprobante" sub="Tipos de e-CF habilitados por la DGII" noPad>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Código</th><th>Nombre</th><th style={{ width: 40 }}></th></tr></thead>
                  <tbody>
                    {ECF_TIPOS.map((t) => (
                      <tr key={t.code} onClick={() => nav('ecf-tipo', { code: t.code, nombre: t.nombre, emitidos: 0, mes: 0, desc: t.desc })}>
                        <td><span className="ecf-tag" style={{ fontSize: 12 }}>{t.code}</span></td>
                        <td><span className="cell-main">{t.nombre}</span><div className="cell-sub">{t.desc}</div></td>
                        <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            </div>

            <div className="col gap-md">
              <Card title="Secuencias e-NCF" sub="Rangos autorizados por DGII"
                actions={<Btn variant="secondary" size="sm" icon="hash" onClick={() => setRangosOpen(true)}>Rangos</Btn>}>
                {stats.loading ? (
                  <div className="row" style={{ justifyContent: 'center', padding: 16 }}><Spinner /></div>
                ) : (
                  <div className="col gap-md">
                    {(d?.secuencias ?? []).map((s) => {
                      const restantes = s.restantes != null ? Number(s.restantes) : null
                      return (
                        <div key={s.type}>
                          <div className="row between mb-sm">
                            <span className="text-sm fw5">{s.type} · {s.nombre}</span>
                            {restantes != null ? (
                              <Badge tone={restantes === 0 ? 'danger' : restantes <= 10 ? 'danger' : restantes <= 25 ? 'warning' : 'success'}>
                                {restantes === 0 ? 'Agotado' : `Quedan ${restantes}`}
                              </Badge>
                            ) : (
                              <span className="text-xs muted-3 num">{s.total_emitidos}</span>
                            )}
                          </div>
                          <Progress value={Math.min(100, (s.total_emitidos / Math.max(1, s.secuencia_actual)) * 100)} />
                          {s.vencimiento && (
                            <div className="text-xs muted-3" style={{ marginTop: 3 }}>Rango vence: {formatApiDate(s.vencimiento)}</div>
                          )}
                        </div>
                      )
                    })}
                    {(d?.secuencias ?? []).length === 0 && <div className="text-sm muted">Sin secuencias registradas.</div>}
                  </div>
                )}
              </Card>
              <Card>
                <div className="row gap-sm mb-sm"><Icon name="shield-check" size={18} style={{ color: 'var(--success)' }} /><span className="fw6">Emisión electrónica</span></div>
                <div className="text-sm muted">Conectado a la API de emisión e-CF de la DGII.</div>
              </Card>
            </div>
          </div>
        </>
      )}

      {rangosOpen && <RangosNcfModal onClose={() => setRangosOpen(false)} />}
    </div>
  )
}

import { Btn, Money, EstadoBadge, Card, KPI, BarChart, Progress, Spinner, ErrorState, PageHead, type KpiProps } from '@/components/ui'
import { getStats, listFacturas, mapFacturaRow, formatMonthKey, dgiiLabel } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import type { Nav } from '@/app/navigation'

/* FISCALO — Dashboard (GET /api/facturas/stats + últimas facturas) */
export function DashboardView({ nav }: { nav: Nav; variant?: 'balanced' | 'focus' }) {
  const stats = useAsync(() => getStats(), [])
  const ultimasReq = useAsync(() => listFacturas({ page: 1, pageSize: 6 }), [])
  const ultimas = (ultimasReq.data?.items ?? []).map(mapFacturaRow)

  const d = stats.data
  const resumen = d?.resumen
  const aceptados = d?.por_estado
    .filter((e) => e.estado.includes('ACEPTADO'))
    .reduce((a, e) => a + e.total, 0) ?? 0
  const rechazados = d?.por_estado.find((e) => e.estado === 'RECHAZADO')?.total ?? 0
  const enProceso = d?.por_estado
    .filter((e) => e.estado === 'ENVIADO' || e.estado === 'EN_PROCESO')
    .reduce((a, e) => a + e.total, 0) ?? 0

  const kpiDefs: KpiProps[] = [
    { label: 'e-CF emitidos', value: resumen?.total_ecf ?? 0, icon: 'file-text', iconBg: 'var(--accent-soft)', iconColor: 'var(--accent)', foot: 'total' },
    { label: 'Monto facturado', value: resumen?.monto_total ?? 0, money: true, icon: 'trending-up', iconBg: 'var(--success-soft)', iconColor: 'var(--success)', foot: 'acumulado' },
    { label: 'Aceptados DGII', value: aceptados, icon: 'check-circle', iconBg: 'var(--success-soft)', iconColor: 'var(--success)', foot: 'comprobantes' },
    { label: 'En proceso', value: enProceso, icon: 'clock', iconBg: 'var(--warning-soft)', iconColor: 'var(--warning)', foot: 'por confirmar' },
    { label: 'Rechazados', value: rechazados, icon: 'x-circle', iconBg: 'var(--danger-soft)', iconColor: 'var(--danger)', foot: 'revisar' },
    { label: 'Tipos distintos', value: resumen?.tipos_distintos ?? 0, icon: 'layers', iconBg: 'var(--accent-soft)', iconColor: 'var(--accent)', foot: 'de e-CF' },
  ]

  // Serie mensual para el gráfico (orden cronológico ascendente).
  const serie = [...(d?.por_mes ?? [])]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => ({ mes: formatMonthKey(m.mes), ventas: m.monto_total }))

  const maxMonto = Math.max(1, ...(d?.por_tipo ?? []).map((t) => t.monto_total))

  return (
    <div className="page">
      <PageHead
        title="Dashboard"
        sub="Resumen de tu facturación electrónica ante la DGII."
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={() => { stats.reload(); ultimasReq.reload() }}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Nueva factura</Btn>
          </>
        }
      />

      {stats.error ? (
        <ErrorState title="No se pudieron cargar las estadísticas" onRetry={stats.reload}>{stats.error}</ErrorState>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            {stats.loading
              ? <div className="card card-pad row" style={{ justifyContent: 'center', gridColumn: '1 / -1' }}><Spinner /></div>
              : kpiDefs.map((k, i) => <KPI key={i} {...k} />)}
          </div>

          <div className="dash-grid" style={{ marginBottom: 16 }}>
            <Card title="Facturación por mes" sub="Monto emitido (RD$)">
              {stats.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 40 }}><Spinner /></div>
              ) : serie.length > 0 ? (
                <BarChart data={serie} valueScale={1} legend={{ primary: 'Monto emitido' }} />
              ) : (
                <div className="text-sm muted" style={{ padding: 24 }}>Sin datos mensuales.</div>
              )}
            </Card>

            <Card title="Secuencias e-NCF" noPad>
              <div className="card-pad col gap-md">
                {stats.loading ? (
                  <div className="row" style={{ justifyContent: 'center', padding: 12 }}><Spinner /></div>
                ) : (d?.secuencias ?? []).length > 0 ? (
                  d!.secuencias.map((s) => (
                    <div key={s.type}>
                      <div className="row between mb-sm">
                        <span className="text-sm fw5">{s.type} · {s.nombre}</span>
                        <span className="text-xs muted-3 num">{s.total_emitidos}</span>
                      </div>
                      <Progress value={Math.min(100, (s.total_emitidos / Math.max(1, s.secuencia_actual)) * 100)} />
                    </div>
                  ))
                ) : (
                  <div className="text-sm muted">Sin secuencias registradas.</div>
                )}
                <Btn variant="secondary" size="sm" icon="badge-check" style={{ width: '100%' }} onClick={() => nav('ecf')}>Ver e-CF</Btn>
              </div>
            </Card>
          </div>

          <div className="dash-grid">
            <Card
              title="Últimas facturas"
              actions={<Btn variant="ghost" size="sm" iconRight="arrow-right" onClick={() => nav('facturas')}>Ver todas</Btn>}
              noPad
            >
              {ultimasReq.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner /></div>
              ) : ultimas.length > 0 ? (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr><th>Comprobante</th><th>Cliente</th><th>Estado DGII</th><th className="num">Total</th></tr>
                    </thead>
                    <tbody>
                      {ultimas.map((f) => (
                        <tr key={f.id} onClick={() => nav('factura-ver', f)}>
                          <td><span className="mono text-sm fw6">{f.ncf}</span><div className="cell-sub">{f.fecha}</div></td>
                          <td><span className="cell-main">{f.cliente}</span></td>
                          <td>{f.dgii !== '—' ? <EstadoBadge estado={f.dgii} /> : <span className="muted-3">—</span>}</td>
                          <td className="num fw6"><Money value={f.total} cur={false} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm muted" style={{ padding: 24 }}>Aún no hay comprobantes emitidos.</div>
              )}
            </Card>

            <Card title="Por tipo de comprobante" noPad>
              <div className="card-pad">
                {stats.loading ? (
                  <div className="row" style={{ justifyContent: 'center', padding: 12 }}><Spinner /></div>
                ) : (d?.por_tipo ?? []).length > 0 ? (
                  d!.por_tipo.map((t) => (
                    <div key={t.tipo_ecf} className="mb-md">
                      <div className="row between mb-sm">
                        <span className="row gap-sm text-sm fw5"><span className="ecf-tag">{t.tipo_ecf}</span>{t.nombre}</span>
                        <span className="fw6 text-sm num">{t.total}</span>
                      </div>
                      <Progress value={(t.monto_total / maxMonto) * 100} />
                      <div className="row gap-sm mt-sm text-xs muted-3">
                        <span>{dgiiLabel('ACEPTADO')}: {t.aceptados}</span>
                        {t.rechazados > 0 && <span style={{ color: 'var(--danger)' }}>Rechazados: {t.rechazados}</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm muted">Sin datos por tipo.</div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

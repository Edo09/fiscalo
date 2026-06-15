import { Btn, RefreshButton, Money, EstadoBadge, Card, KPI, BarChart, Donut, Progress, Spinner, ErrorState, PageHead, type KpiProps } from '@/components/ui'
import { getStats, getGastoStats, listFacturas, listGastos, mapFacturaRow, formatMonthKey, dgiiLabel } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession } from '@/stores/auth'
import { gastoEstadoLabel } from '@/config/gastos'
import type { Nav } from '@/config/navigation'

/** Saludo según la hora local. */
function saludo(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

/** Delta % de un mes contra el anterior (undefined si no hay base). */
function deltaPct(cur: number, prev: number): { delta: string; dir: 'up' | 'down' } | null {
  if (prev <= 0) return null
  const p = ((cur - prev) / prev) * 100
  return { delta: `${Math.abs(p).toFixed(1)}%`, dir: p >= 0 ? 'up' : 'down' }
}

/* FISCALO — Dashboard (stats de facturas + gastos, métricas del día/mes e ITBIS) */
export function DashboardView({ nav }: { nav: Nav; variant?: 'balanced' | 'focus' }) {
  const { user } = useSession()

  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const gastoStats = useApiQuery(['gastos', 'stats'], () => getGastoStats())
  // El backend no expone métricas diarias ni ITBIS en /stats: se derivan de las
  // facturas/gastos recientes (hasta 100) filtrando por el mes/día en curso.
  const mesFacturas = useApiQuery(
    ['facturas', 'list', { page: 1, pageSize: 100, estado: 'aprobado' }],
    () => listFacturas({ page: 1, pageSize: 100, estado: 'aprobado' }),
  )
  // ITBIS pagado sale de las compras (facturas de proveedores) del mes.
  const mesCompras = useApiQuery(
    ['gastos', 'list', { page: 1, pageSize: 100, categoria: 'facturas_proveedores' }],
    () => listGastos({ page: 1, pageSize: 100, categoria: 'facturas_proveedores' }),
  )
  const ultimasReq = useApiQuery(['facturas', 'list', { page: 1, pageSize: 6 }], () => listFacturas({ page: 1, pageSize: 6 }))
  const ultimas = (ultimasReq.data?.items ?? []).map(mapFacturaRow)
  const ultimasGastosReq = useApiQuery(['gastos', 'list', { page: 1, pageSize: 6 }], () => listGastos({ page: 1, pageSize: 6 }))
  const ultimasGastos = ultimasGastosReq.data?.items ?? []

  const d = stats.data
  const resumen = d?.resumen

  // Claves del mes/día en curso y del mes anterior (YYYY-MM / YYYY-MM-DD).
  const now = new Date()
  const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const dk = `${mk}-${String(now.getDate()).padStart(2, '0')}`
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const pk = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  // Ventas/gastos del mes desde los stats mensuales del backend.
  const ventasMes = d?.por_mes.find((m) => m.mes === mk)?.monto_total ?? 0
  const ventasMesPrev = d?.por_mes.find((m) => m.mes === pk)?.monto_total ?? 0
  const gastosMes = gastoStats.data?.por_mes.find((m) => m.mes === mk)?.monto_total ?? 0
  const gastosMesPrev = gastoStats.data?.por_mes.find((m) => m.mes === pk)?.monto_total ?? 0

  // Métricas derivadas de las facturas aprobadas del mes (día e ITBIS).
  const facMes = (mesFacturas.data?.items ?? []).filter((r) => (r.fecha_emision_dgii ?? r.date ?? '').startsWith(mk))
  const ventasDia = facMes
    .filter((r) => (r.fecha_emision_dgii ?? r.date ?? '').startsWith(dk))
    .reduce((a, r) => a + Number(r.total ?? 0), 0)
  const itbisCobrado = facMes.reduce((a, r) => a + Number(r.total_itbis ?? 0), 0)
  // Pagado: ITBIS de las compras (facturas de proveedores) del mes en curso.
  const itbisPagado = (mesCompras.data?.items ?? [])
    .filter((g) => (g.fecha ?? '').startsWith(mk))
    .reduce((a, g) => a + Number(g.itbis ?? 0), 0)

  const dVentas = deltaPct(ventasMes, ventasMesPrev)
  const dGastos = deltaPct(gastosMes, gastosMesPrev)

  const kpiDefs: KpiProps[] = [
    { label: 'Ventas del día', value: ventasDia, money: true, icon: 'trending-up', iconBg: 'var(--accent-soft)', iconColor: 'var(--accent)', foot: 'hoy' },
    { label: 'Ventas del mes', value: ventasMes, money: true, icon: 'calendar', iconBg: 'var(--success-soft)', iconColor: 'var(--success)', delta: dVentas?.delta, deltaDir: dVentas?.dir, foot: 'vs mes anterior' },
    { label: 'Total facturas', value: resumen?.total_ecf ?? 0, icon: 'file-text', iconBg: 'var(--accent-soft)', iconColor: 'var(--accent)', foot: 'emitidas' },
    { label: 'ITBIS cobrado', value: itbisCobrado, money: true, icon: 'landmark', iconBg: 'var(--accent-soft)', iconColor: 'var(--accent)', foot: 'este mes' },
    { label: 'ITBIS pagado', value: itbisPagado, money: true, icon: 'hand-coins', iconBg: 'var(--warning-soft)', iconColor: 'var(--warning)', foot: 'este mes' },
    { label: 'Gastos del mes', value: gastosMes, money: true, icon: 'trending-down', iconBg: 'var(--danger-soft)', iconColor: 'var(--danger)', delta: dGastos?.delta, deltaDir: dGastos?.dir, foot: 'vs mes anterior' },
  ]

  // Serie de los últimos 12 meses (huecos en 0) con ventas y gastos por mes.
  const serie = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    return {
      mes: formatMonthKey(key),
      ventas: d?.por_mes.find((m) => m.mes === key)?.monto_total ?? 0,
      gastos: gastoStats.data?.por_mes.find((m) => m.mes === key)?.monto_total ?? 0,
    }
  })

  const maxMonto = Math.max(1, ...(d?.por_tipo ?? []).map((t) => t.monto_total))
  const fechaLarga = now.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="page">
      <PageHead
        title={`${saludo()}${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        sub={`Resumen de tu facturación electrónica · ${fechaLarga}`}
        actions={
          <RefreshButton onRefresh={() => Promise.all([stats.reload(), gastoStats.reload(), mesFacturas.reload(), mesCompras.reload(), ultimasReq.reload(), ultimasGastosReq.reload()])} />
        }
      />

      {stats.error ? (
        <ErrorState title="No se pudieron cargar las estadísticas" onRetry={stats.reload}>{stats.error}</ErrorState>
      ) : (
        <>
          {/* 6 KPIs en 3×2 + tarjeta ITBIS del mes al lado */}
          <div className="dash-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-grid kpi-cols-3">
              {stats.loading
                ? <div className="card card-pad row" style={{ justifyContent: 'center', gridColumn: '1 / -1' }}><Spinner /></div>
                : kpiDefs.map((k, i) => <KPI key={i} {...k} />)}
            </div>

            <Card title="ITBIS del mes">
              {mesFacturas.loading || mesCompras.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Spinner /></div>
              ) : itbisCobrado + itbisPagado > 0 ? (
                <>
                  <div className="donut-wrap" style={{ padding: '12px 0', justifyContent: 'space-evenly' }}>
                    <Donut
                      size={120}
                      thickness={20}
                      segments={[
                        { value: itbisCobrado, color: 'var(--accent)' },
                        { value: itbisPagado, color: 'var(--warning)' },
                      ]}
                    />
                    <div className="col gap-md">
                      <div>
                        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent)' }}></span>Cobrado</div>
                        <div className="fw6" style={{ marginTop: 2 }}><Money value={itbisCobrado} /></div>
                      </div>
                      <div>
                        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--warning)' }}></span>Pagado</div>
                        <div className="fw6" style={{ marginTop: 2 }}><Money value={itbisPagado} /></div>
                      </div>
                    </div>
                  </div>
                  <div className="divider" style={{ margin: '12px 0' }}></div>
                  {/* Cobrado (ITBIS a clientes) se debe a la DGII; pagado (ITBIS en
                      compras) lo adelanta la empresa. Cobrado > pagado => a pagar;
                      pagado > cobrado => saldo a favor. */}
                  <div className="row between">
                    <span className="text-sm muted">Promedio {itbisCobrado - itbisPagado > 0 ? 'Saldo a pagar' : 'Saldo a favor'}</span>
                    <span className="fw6" style={{ fontSize: 16 }}><Money value={Math.abs(itbisCobrado - itbisPagado)} /></span>
                  </div>
                </>
              ) : (
                <div className="text-sm muted" style={{ padding: 12 }}>Sin ITBIS registrado este mes.</div>
              )}
            </Card>
          </div>

          <div className="dash-grid" style={{ marginBottom: 16 }}>
            <Card title="Ventas vs. gastos" sub="Últimos 12 meses · RD$">
              {stats.loading || gastoStats.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 40 }}><Spinner /></div>
              ) : (
                <BarChart data={serie} valueScale={1} legend={{ primary: 'Ventas', secondary: 'Gastos' }} />
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

          <div className="grid-2">
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

            <Card
              title="Últimas compras y gastos"
              actions={<Btn variant="ghost" size="sm" iconRight="arrow-right" onClick={() => nav('compras')}>Ver todas</Btn>}
              noPad
            >
              {ultimasGastosReq.loading ? (
                <div className="row" style={{ justifyContent: 'center', padding: 32 }}><Spinner /></div>
              ) : ultimasGastos.length > 0 ? (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr><th>Tipo</th><th>Proveedor</th><th>Estado</th><th className="num">Total</th></tr>
                    </thead>
                    <tbody>
                      {ultimasGastos.map((g) => (
                        <tr key={g.id} onClick={() => nav(g.categoria === 'facturas_proveedores' ? 'compras' : 'gastos')}>
                          <td><span className="ecf-tag">{g.tipo_gasto}</span><div className="cell-sub">{g.fecha ?? '—'}</div></td>
                          <td><span className="cell-main">{g.nombre_proveedor ?? '—'}</span></td>
                          <td>{g.estado_dgii ? <EstadoBadge estado={gastoEstadoLabel(g.estado_dgii)} /> : <span className="muted-3">—</span>}</td>
                          <td className="num fw6"><Money value={Number(g.total ?? 0)} cur={false} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm muted" style={{ padding: 24 }}>Aún no hay compras ni gastos registrados.</div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

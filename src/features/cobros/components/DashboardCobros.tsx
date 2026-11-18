// El dashboard compacto de Cobros: cinco cifras arriba y, debajo, la antigüedad de lo pendiente, los
// próximos vencimientos y los clientes con pagos atrasados. Un clic en un cliente abre su historial.
import { Avatar, Card, ErrorState, KPI, LoadingState, Money } from '@/components/ui'
import { fmt } from '@/lib/format'
import { COLOR_TRAMO, diasTexto, fechaCorta, periodoLargo, textoVencimiento } from '../format'
import { DIAS_PROXIMOS, useResumenCobros } from '../hooks'
import { useCobrosUi } from '../store'

export function DashboardCobros() {
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const { data, error, loading, reload } = useResumenCobros(DIAS_PROXIMOS)

  if (loading) {
    return <div className="mb-md"><Card noPad><LoadingState rows={3} /></Card></div>
  }
  if (error || !data) {
    return (
      <div className="mb-md">
        <Card noPad>
          <ErrorState title="No se pudo cargar el resumen de cobros" onRetry={reload}>{error}</ErrorState>
        </Card>
      </div>
    )
  }

  const t = data.totales
  const mes = periodoLargo(data.mes)
  const mayor = Math.max(1, ...data.antiguedad.map((x) => x.monto))
  const hayPendiente = t.pendiente > 0

  return (
    <>
      <div className="kpi-grid compact" style={{ marginBottom: 12 }}>
        <KPI
          label="Pendiente por cobrar" value={t.pendiente} money icon="wallet"
          foot={`${t.cobros_abiertos} ${t.cobros_abiertos === 1 ? 'cobro' : 'cobros'} · ${t.clientes_con_saldo} ${t.clientes_con_saldo === 1 ? 'cliente' : 'clientes'}`}
        />
        <KPI
          label="Vencido" value={t.vencido} money icon="alert-triangle" iconBg="var(--danger-soft)" iconColor="var(--danger)"
          foot={`${t.cobros_vencidos} ${t.cobros_vencidos === 1 ? 'cobro' : 'cobros'} · ${t.clientes_con_atraso} ${t.clientes_con_atraso === 1 ? 'cliente' : 'clientes'}`}
        />
        <KPI
          label={`Vence en ${data.dias} días`} value={t.por_vencer} money icon="clock" iconBg="var(--warning-soft)" iconColor="var(--warning)"
          foot="Incluye lo que vence hoy"
        />
        <KPI
          label="Cobrado en el mes" value={t.cobrado_mes} money icon="check-circle" iconBg="var(--success-soft)" iconColor="var(--success)"
          foot={`pagos recibidos en ${mes}`}
        />
        <KPI
          label="Por cobrar en el mes" value={t.por_cobrar_mes} money icon="calendar"
          foot={`de RD$ ${fmt(t.facturado_mes)} que vencen en ${mes}`}
        />
      </div>

      <div className="cobros-panel-grid">
        <Card title="Antigüedad de lo pendiente" sub="Por días de atraso">
          {hayPendiente ? (
            <div className="cobros-tramos">
              {data.antiguedad.map((x) => (
                <div className="cobros-tramo" key={x.tramo}>
                  <span className="etiqueta">{x.etiqueta}</span>
                  <span className="barra">
                    <span style={{ width: `${x.monto > 0 ? Math.max(3, (x.monto / mayor) * 100) : 0}%`, background: COLOR_TRAMO[x.tramo] ?? 'var(--accent)' }} />
                  </span>
                  <span className="monto">
                    <Money value={x.monto} cur={false} />
                    <small>{x.cobros} {x.cobros === 1 ? 'cobro' : 'cobros'}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm muted">No hay nada pendiente por cobrar.</p>
          )}
        </Card>

        <Card title="Próximos vencimientos" sub={`En los próximos ${data.dias} días`}>
          {data.proximos.length === 0 ? (
            <p className="text-sm muted">Ningún cobro vence en los próximos {data.dias} días.</p>
          ) : (
            <div className="cobros-lista">
              {data.proximos.slice(0, 5).map((c) => (
                <button type="button" className="cobros-lista-item" key={c.id} onClick={() => abrirPanel(c.client_id)}>
                  <Avatar name={c.cliente.nombre} size={28} />
                  <span className="principal">
                    <div>{c.cliente.nombre}</div>
                    <div className="text-xs muted-3">{textoVencimiento(c)} · {fechaCorta(c.fecha_vencimiento)}</div>
                  </span>
                  <span className="valor"><Money value={c.saldo} cur={false} /></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Clientes con pagos atrasados" sub="Los que más deben primero">
          {data.atrasados.length === 0 ? (
            <p className="text-sm muted">Ningún cliente tiene pagos atrasados.</p>
          ) : (
            <div className="cobros-lista">
              {data.atrasados.slice(0, 5).map((a) => (
                <button type="button" className="cobros-lista-item" key={a.client_id} onClick={() => abrirPanel(a.client_id)}>
                  <Avatar name={a.cliente.nombre} size={28} />
                  <span className="principal">
                    <div>{a.cliente.nombre}</div>
                    <div className="text-xs muted-3">
                      {a.cobros_vencidos} {a.cobros_vencidos === 1 ? 'cobro vencido' : 'cobros vencidos'} · hace {diasTexto(a.dias_atraso)}
                    </div>
                  </span>
                  <span className="valor" style={{ color: 'var(--danger)' }}><Money value={a.saldo_vencido} cur={false} /></span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

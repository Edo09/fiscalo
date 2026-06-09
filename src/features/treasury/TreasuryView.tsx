import { Icon, Btn, Money, Card, BarChart, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Tesorería */
export function TreasuryView() {
  const D = DATA
  const cuentas = [
    { n: 'Caja general', t: 'Efectivo', bal: 184200, ic: 'wallet', c: 'var(--success)' },
    { n: 'Banco Popular ****4521', t: 'Cuenta corriente', bal: 2840500, ic: 'landmark', c: 'var(--accent)' },
    { n: 'Banco BHD ****8890', t: 'Cuenta de ahorro', bal: 1250000, ic: 'landmark', c: 'var(--accent)' },
    { n: 'Banreservas ****1102', t: 'Cuenta corriente', bal: 568300, ic: 'landmark', c: 'var(--accent)' },
  ]
  const movs = [
    { d: 'Pago Hotel Costa Azul', f: '28 May', t: 'Ingreso', m: 105256 },
    { d: 'Compra Distribuidora Nacional', f: '27 May', t: 'Egreso', m: -369000 },
    { d: 'Cobro Supermercado Bravo', f: '27 May', t: 'Ingreso', m: 184500 },
    { d: 'Pago nómina quincenal', f: '25 May', t: 'Egreso', m: -428000 },
    { d: 'Transferencia a ahorro', f: '24 May', t: 'Transferencia', m: -500000 },
  ]
  const totalBancos = cuentas.reduce((a, c) => a + c.bal, 0)
  return (
    <div className="page page-wide">
      <PageHead title="Tesorería" sub="Caja, bancos y flujo de efectivo"
        actions={<><Btn variant="secondary" icon="arrow-left-right">Transferencia</Btn><Btn variant="primary" icon="git-compare">Conciliar</Btn></>} />

      <div className="card card-pad mb-lg" style={{ background: 'var(--accent)', border: 'none', color: '#fff' }}>
        <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 4 }}>Disponible total</div>
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }} className="num">RD$ {D.fmt(totalBancos)}</div>
        <div className="row gap-lg mt-md" style={{ opacity: 0.92 }}>
          <span className="row gap-sm text-sm"><Icon name="arrow-down-left" size={15} />Ingresos mes: RD$ {D.fmt0(3340000)}</span>
          <span className="row gap-sm text-sm"><Icon name="arrow-up-right" size={15} />Egresos mes: RD$ {D.fmt0(1820000)}</span>
        </div>
      </div>

      <div className="dash-grid">
        <div className="col gap-md">
          <div className="grid-2">
            {cuentas.map((c, i) => (
              <div className="card card-pad" key={i}>
                <div className="row gap-sm mb-md"><span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: c.c, width: 34, height: 34 }}><Icon name={c.ic} size={16} /></span><div><div className="fw6 text-sm">{c.n}</div><div className="text-xs muted">{c.t}</div></div></div>
                <div className="fw6" style={{ fontSize: 19 }}><Money value={c.bal} /></div>
              </div>
            ))}
          </div>
          <Card title="Movimientos recientes" noPad>
            <table className="tbl">
              <tbody>
                {movs.map((m, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td><div className="row gap-sm"><span className="activity-ic" style={{ background: m.m > 0 ? 'var(--success-soft)' : 'var(--danger-soft)', color: m.m > 0 ? 'var(--success)' : 'var(--danger)' }}><Icon name={m.m > 0 ? 'arrow-down-left' : 'arrow-up-right'} size={14} /></span><div><span className="cell-main">{m.d}</span><div className="cell-sub">{m.f} · {m.t}</div></div></div></td>
                    <td className="num fw6" style={{ color: m.m > 0 ? 'var(--success)' : 'inherit' }}>{m.m > 0 ? '+' : '−'}<Money value={Math.abs(m.m)} cur={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="Flujo de efectivo" sub="Proyección 30 días">
          <BarChart data={D.ventasMes.slice(-6)} height={150} />
          <div className="divider"></div>
          <div className="col gap-sm text-sm">
            <div className="row between"><span className="muted">Saldo inicial</span><Money value={4800000} cur={false} /></div>
            <div className="row between"><span className="muted">Entradas previstas</span><span style={{ color: 'var(--success)' }}>+<Money value={3340000} cur={false} /></span></div>
            <div className="row between"><span className="muted">Salidas previstas</span><span style={{ color: 'var(--danger)' }}>−<Money value={1820000} cur={false} /></span></div>
            <div className="divider" style={{ margin: '4px 0' }}></div>
            <div className="row between fw6"><span>Saldo proyectado</span><Money value={6320000} cur={false} /></div>
          </div>
        </Card>
      </div>
    </div>
  )
}

import { Btn, Money, EstadoBadge, Card, KPI, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Compras */
export function PurchasesView() {
  const D = DATA
  return (
    <div className="page page-wide">
      <PageHead title="Compras" sub="Comprobantes de compra y cuentas por pagar"
        actions={<Btn variant="primary" icon="plus">Registrar compra</Btn>} />
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Compras del mes" value={574000} money icon="shopping-cart" />
        <KPI label="Cuentas por pagar" value={D.kpis.cxp} money icon="file-minus" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
        <KPI label="ITBIS acreditable" value={66238} money icon="landmark" iconBg="var(--success-soft)" iconColor="var(--success)" />
        <KPI label="Proveedores activos" value={D.proveedores.length} icon="truck" />
      </div>
      <Card title="Comprobantes de compra" noPad actions={<Btn variant="secondary" size="sm" icon="download">Reporte 606</Btn>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Proveedor</th><th>NCF</th><th>Concepto</th><th>Fecha</th><th className="num">ITBIS</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {D.gastos.map((g) => (
                <tr key={g.id}>
                  <td><span className="cell-main">{g.proveedor}</span></td>
                  <td className="mono text-xs muted">{g.ncf}</td>
                  <td className="text-sm">{g.concepto}</td>
                  <td className="muted text-sm">{g.fecha}</td>
                  <td className="num muted"><Money value={g.itbis} cur={false} /></td>
                  <td className="num fw6"><Money value={g.total} cur={false} /></td>
                  <td><EstadoBadge estado={g.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

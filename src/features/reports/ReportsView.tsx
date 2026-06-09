import { Icon, Btn, Money, Dropdown, MenuItem, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Reportes */
export function ReportsView() {
  const D = DATA
  const cats = [
    { t: 'Ventas', d: 'Ingresos por período, cliente y producto', ic: 'trending-up', c: 'var(--accent)' },
    { t: 'Gastos', d: 'Egresos por categoría y proveedor', ic: 'receipt', c: 'var(--warning)' },
    { t: 'Utilidad', d: 'Estado de resultados y margen neto', ic: 'wallet', c: 'var(--success)' },
    { t: 'ITBIS', d: 'Formulario IT-1, 606 y 607', ic: 'landmark', c: 'var(--accent)' },
    { t: 'Clientes', d: 'Antigüedad de saldos y cuentas por cobrar', ic: 'users', c: 'var(--accent)' },
    { t: 'Productos', d: 'Rotación de inventario y más vendidos', ic: 'box', c: 'var(--text-2)' },
    { t: 'Comisiones', d: 'Comisiones por vendedor y período', ic: 'percent', c: 'var(--warning)' },
    { t: 'Cuentas por cobrar', d: 'Saldos pendientes de clientes', ic: 'hand-coins', c: 'var(--accent)' },
    { t: 'Cuentas por pagar', d: 'Obligaciones con proveedores', ic: 'file-minus', c: 'var(--danger)' },
  ]
  return (
    <div className="page page-wide">
      <PageHead title="Reportes" sub="Genera informes financieros y fiscales en segundos"
        actions={<div className="seg"><button className="on">Mayo 2026</button><button>Trimestre</button><button>Año</button></div>} />

      <div className="grid-3 mb-lg">
        <div className="card card-pad"><div className="text-xs muted mb-sm">Ingresos</div><div className="fw6" style={{ fontSize: 22 }}><Money value={D.kpis.ventasMes} /></div><div className="delta up text-sm mt-sm"><Icon name="trending-up" size={13} />+8.1%</div></div>
        <div className="card card-pad"><div className="text-xs muted mb-sm">Egresos</div><div className="fw6" style={{ fontSize: 22 }}><Money value={D.kpis.gastosMes} /></div><div className="delta down text-sm mt-sm"><Icon name="trending-up" size={13} />+5.2%</div></div>
        <div className="card card-pad"><div className="text-xs muted mb-sm">Utilidad neta</div><div className="fw6" style={{ fontSize: 22, color: 'var(--success)' }}><Money value={D.kpis.utilidad} /></div><div className="delta up text-sm mt-sm"><Icon name="trending-up" size={13} />+11.0%</div></div>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Informes disponibles</h3>
      <div className="kpi-grid">
        {cats.map((r, i) => (
          <div className="card card-pad" key={i} style={{ cursor: 'pointer', transition: 'box-shadow .15s' }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: r.c, width: 36, height: 36, marginBottom: 12 }}><Icon name={r.ic} size={17} /></span>
              <Dropdown trigger={<Btn variant="ghost" size="sm" icon="download" />} width={150}>
                <MenuItem icon="file-text">PDF</MenuItem>
                <MenuItem icon="sheet">Excel</MenuItem>
              </Dropdown>
            </div>
            <div className="fw6" style={{ fontSize: 14.5 }}>{r.t}</div>
            <div className="text-sm muted" style={{ marginTop: 2 }}>{r.d}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

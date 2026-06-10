import { Btn, Money, Badge, Avatar, EstadoBadge, Card, Dropdown, MenuItem, PageHead } from '@/components/ui'
import type { Nav } from '@/config/navigation'

/* FISCALO — Facturación recurrente */
export function RecurringView({ nav }: { nav: Nav }) {
  const recs = [
    { c: 'Hotel Costa Azul', monto: 80000, frec: 'Mensual', prox: '01 Jun 2026', estado: 'Activo' },
    { c: 'Restaurante La Cazuela', monto: 22400, frec: 'Quincenal', prox: '01 Jun 2026', estado: 'Activo' },
    { c: 'Farmacia Carol', monto: 38900, frec: 'Mensual', prox: '05 Jun 2026', estado: 'Pausado' },
  ]
  return (
    <div className="page page-wide">
      <PageHead crumbs={[{ label: 'Facturación', onClick: () => nav('facturas') }, { label: 'Recurrentes' }]}
        title="Facturación recurrente" sub="Automatiza facturas que se repiten"
        actions={<Btn variant="primary" icon="plus">Nueva recurrencia</Btn>} />
      <Card noPad>
        <table className="tbl">
          <thead><tr><th>Cliente</th><th>Frecuencia</th><th>Próxima emisión</th><th className="num">Monto</th><th>Estado</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {recs.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><div className="row gap-sm"><Avatar name={r.c} size={30} /><span className="cell-main">{r.c}</span></div></td>
                <td><Badge tone="accent">{r.frec}</Badge></td>
                <td className="muted text-sm">{r.prox}</td>
                <td className="num fw6"><Money value={r.monto} cur={false} /></td>
                <td><EstadoBadge estado={r.estado === 'Activo' ? 'Activo' : 'Pendiente'} /></td>
                <td><Dropdown trigger={<Btn variant="ghost" size="sm" icon="more-horizontal" />}><MenuItem icon="pause">Pausar</MenuItem><MenuItem icon="edit-3">Editar</MenuItem><MenuItem icon="trash-2" danger>Eliminar</MenuItem></Dropdown></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

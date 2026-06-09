import { Btn, Money, Avatar, Card, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'

/* FISCALO — Proveedores */
export function SuppliersView() {
  const D = DATA
  return (
    <div className="page page-wide">
      <PageHead title="Proveedores" sub={`${D.proveedores.length} proveedores registrados`}
        actions={<Btn variant="primary" icon="plus">Nuevo proveedor</Btn>} />
      <Card noPad>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Proveedor</th><th>RNC</th><th>Contacto</th><th>Teléfono</th><th className="num">Compras</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {D.proveedores.map((p) => (
                <tr key={p.id}>
                  <td><div className="row gap-sm"><Avatar name={p.nombre} size={30} /><span className="cell-main">{p.nombre}</span></div></td>
                  <td className="mono text-sm muted">{p.rnc}</td>
                  <td className="text-sm">{p.contacto}</td>
                  <td className="text-sm muted">{p.tel}</td>
                  <td className="num">{p.compras}</td>
                  <td className="num fw6">{p.balance > 0 ? <Money value={p.balance} cur={false} /> : <span className="muted-3">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

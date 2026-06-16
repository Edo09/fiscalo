import { EmptyState, PageHead } from '@/components/ui'

/* FISCALO — Tesorería */
export function TreasuryView() {
  return (
    <div className="page page-wide">
      <PageHead title="Tesorería" sub="Caja, bancos y flujo de efectivo" />
      <div className="card card-pad">
        <EmptyState icon="landmark" title="Tesorería no disponible">
          Aún no hay cuentas ni movimientos conectados.
        </EmptyState>
      </div>
    </div>
  )
}

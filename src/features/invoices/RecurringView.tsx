import { EmptyState, PageHead } from '@/components/ui'
import type { Nav } from '@/config/navigation'

/* FISCALO — Facturación recurrente */
export function RecurringView({ nav }: { nav: Nav }) {
  return (
    <div className="page page-wide">
      <PageHead crumbs={[{ label: 'Facturación', onClick: () => nav('facturas') }, { label: 'Recurrentes' }]}
        title="Facturación recurrente" sub="Automatiza facturas que se repiten" />
      <div className="card card-pad">
        <EmptyState icon="repeat" title="Sin recurrencias">
          Aún no has configurado facturas recurrentes.
        </EmptyState>
      </div>
    </div>
  )
}

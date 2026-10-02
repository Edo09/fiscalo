import { Btn, Card, EmptyState, PageHead } from '@/components/ui'
import type { Nav } from '@/config/navigation'

/* FISCALO — Cotización con el formato de Ferretería (spec 8.1).
   Provisional: ocupa su lugar en el registro de formatos mientras se arma el
   formulario. Ningún tenant tiene este formato activo todavía (se activa por
   SQL en master.tenants.cotizacion_formato). */
export function FerreteriaCotizacionForm({ nav }: { nav: Nav; cotizacionId: number | null }) {
  return (
    <div className="page">
      <PageHead title="Cotización" crumbs={[{ label: 'Cotizaciones', onClick: () => nav('cotizaciones') }]} />
      <Card>
        <EmptyState
          icon="file-plus"
          title="Formato de cotización en preparación"
          action={<Btn variant="secondary" icon="arrow-left" onClick={() => nav('cotizaciones')}>Ir a cotizaciones</Btn>}
        >
          El formulario de este formato todavía no está disponible.
        </EmptyState>
      </Card>
    </div>
  )
}

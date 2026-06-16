import { Icon, PageHead } from '@/components/ui'
import type { Nav, ViewId } from '@/config/navigation'

/* FISCALO — Reportes (índice de categorías) */
interface Categoria {
  t: string
  d: string
  ic: string
  c: string
  to: ViewId
}

const CATEGORIAS: Categoria[] = [
  { t: 'Fiscales', d: 'Formatos DGII: 606, 607, 608, IR-17', ic: 'landmark', c: 'var(--accent)', to: 'reportes-fiscales' },
]

export function ReportsView({ nav }: { nav: Nav }) {
  return (
    <div className="page page-wide">
      <PageHead title="Reportes" sub="Genera informes financieros y fiscales en segundos" />

      <div className="grid-3">
        {CATEGORIAS.map((r) => (
          <div
            className="card card-pad"
            key={r.to}
            style={{ cursor: 'pointer', transition: 'box-shadow .15s' }}
            onClick={() => nav(r.to)}
          >
            <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: r.c, width: 36, height: 36, marginBottom: 12 }}>
              <Icon name={r.ic} size={17} />
            </span>
            <div className="row between" style={{ alignItems: 'center' }}>
              <div className="fw6" style={{ fontSize: 14.5 }}>{r.t}</div>
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
            </div>
            <div className="text-sm muted" style={{ marginTop: 2 }}>{r.d}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

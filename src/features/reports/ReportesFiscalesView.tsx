import { Icon, Badge, PageHead } from '@/components/ui'
import type { Nav, ViewId } from '@/config/navigation'

/* FISCALO — Reportes > Fiscales (formatos DGII) */
interface ReporteFiscal {
  code: string
  label: string
  desc: string
  ic: string
  c: string
  /** Vista destino; null mientras no esté implementado. */
  to: ViewId | null
}

const REPORTES: ReporteFiscal[] = [
  { code: '606', label: '606 — Compras', desc: 'Compras de bienes y servicios del período', ic: 'shopping-cart', c: 'var(--accent)', to: 'reportes-606' },
  { code: '607', label: '607 — Ventas', desc: 'Ventas de bienes y servicios del período', ic: 'trending-up', c: 'var(--success)', to: null },
  { code: '608', label: '608 — Anulados', desc: 'Comprobantes anulados', ic: 'file-x', c: 'var(--danger)', to: null },
  { code: 'IR-17', label: 'IR-17 — Retenciones', desc: 'Retenciones de renta a terceros', ic: 'percent', c: 'var(--warning)', to: null },
]

export function ReportesFiscalesView({ nav }: { nav: Nav }) {
  return (
    <div className="page page-wide">
      <PageHead
        title="Reportes fiscales"
        sub="Formatos de envío de datos a la DGII"
        crumbs={[{ label: 'Reportes', onClick: () => nav('reportes') }, { label: 'Fiscales' }]}
      />

      <div className="kpi-grid">
        {REPORTES.map((r) => {
          const ready = r.to != null
          return (
            <div
              className="card card-pad"
              key={r.code}
              style={{ cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.55, transition: 'box-shadow .15s' }}
              onClick={ready ? () => nav(r.to as ViewId) : undefined}
            >
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: r.c, width: 36, height: 36, marginBottom: 12 }}>
                  <Icon name={r.ic} size={17} />
                </span>
                {ready
                  ? <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
                  : <Badge tone="neutral">Próximamente</Badge>}
              </div>
              <div className="fw6" style={{ fontSize: 14.5 }}>{r.label}</div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>{r.desc}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

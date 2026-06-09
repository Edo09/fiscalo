import { Icon, Btn, Money, EstadoBadge, Card, KPI, LoadingState, ErrorState, EmptyState, PageHead } from '@/components/ui'
import { listFacturas, mapFacturaRow } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { ECF_TIPOS } from '@/app/ecf'
import type { Nav } from '@/app/navigation'
import type { EcfTipo } from '@/types/domain'

/* FISCALO — Detalle de un tipo e-CF (facturas reales filtradas por tipo) */
export function EcfTypeView({ tipo, nav }: { tipo: EcfTipo | null; nav: Nav }) {
  const code = tipo?.code ?? '31'
  const def = ECF_TIPOS.find((t) => t.code === code)
  const nombre = tipo?.nombre || def?.nombre || `Tipo ${code}`
  const desc = tipo?.desc || def?.desc || ''

  const { data, error, loading, reload } = useAsync(() => listFacturas({ page: 1, pageSize: 100 }), [])
  const all = (data?.items ?? []).map(mapFacturaRow)
  const rows = all.filter((f) => f.tipo === code)

  const aceptados = rows.filter((f) => f.dgii === 'Aceptado').length
  const rechazados = rows.filter((f) => f.dgii === 'Rechazado').length
  const montoTotal = rows.reduce((a, f) => a + f.total, 0)

  return (
    <div className="page page-wide">
      <PageHead
        crumbs={[{ label: 'e-CF (DGII)', onClick: () => nav('ecf') }, { label: `Tipo ${code}` }]}
        title={<span className="row gap-sm"><span className="ecf-tag" style={{ fontSize: 15, padding: '3px 10px' }}>{code}</span> {nombre}</span>}
        sub={desc}
        actions={
          <>
            <Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn>
            <Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Emitir {code}</Btn>
          </>
        }
      />

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Emitidos" value={rows.length} icon="file-text" />
        <KPI label="Monto total" value={montoTotal} money icon="trending-up" iconBg="var(--accent-soft)" iconColor="var(--accent)" />
        <KPI label="Aceptados DGII" value={aceptados} icon="check-circle" iconBg="var(--success-soft)" iconColor="var(--success)" />
        <KPI label="Rechazados" value={rechazados} icon="x-circle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
      </div>

      <Card title={`Comprobantes tipo ${code}`} noPad>
        {loading ? (
          <LoadingState rows={6} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los comprobantes" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="file-text" title={`Sin comprobantes tipo ${code}`} action={<Btn variant="primary" icon="plus" onClick={() => nav('factura-nueva')}>Emitir {code}</Btn>}>
            Aún no se han emitido comprobantes de este tipo.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>e-CF</th><th>Cliente</th><th>Fecha</th><th>Estado DGII</th><th className="num">Total</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} onClick={() => nav('factura-ver', f)}>
                    <td className="mono text-sm fw6">{f.ncf}</td>
                    <td><span className="cell-main">{f.cliente}</span></td>
                    <td className="muted text-sm">{f.fecha}</td>
                    <td>{f.dgii !== '—' ? <EstadoBadge estado={f.dgii} /> : <span className="muted-3">—</span>}</td>
                    <td className="num fw6"><Money value={f.total} cur={false} /></td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2 mt-md">
        <Card title="Auditoría y trazabilidad">
          <div className="col gap-md">
            {[
              { ic: 'file-plus', t: 'Emisión', d: 'Generación y firma del XML' },
              { ic: 'send', t: 'Transmisión', d: 'Envío al webservice de la DGII' },
              { ic: 'badge-check', t: 'Acuse de recibo', d: 'Track ID asignado por DGII' },
              { ic: 'shield-check', t: 'Aprobación comercial', d: 'Respuesta del receptor (si aplica)' },
            ].map((s, i) => (
              <div className="row gap-md" key={i}>
                <span className="kpi-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 34, height: 34 }}><Icon name={s.ic} size={16} /></span>
                <div><div className="fw6 text-sm">{s.t}</div><div className="text-xs muted">{s.d}</div></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Validación fiscal" sub="Requisitos para este tipo">
          <div className="col gap-sm text-sm">
            {[
              'RNC del emisor válido y activo',
              code === '31' ? 'RNC del comprador obligatorio' : 'RNC del comprador opcional',
              'Detalle de ITBIS por línea',
              'Firma digital con certificado vigente',
              'Código de seguridad del comprobante',
            ].map((r, i) => (
              <div className="row gap-sm" key={i}><Icon name="check-circle" size={15} style={{ color: 'var(--success)' }} /><span>{r}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

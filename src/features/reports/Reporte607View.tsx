import { useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Badge, PageHead, RefreshButton, LoadingState, ErrorState, EmptyState } from '@/components/ui'
import { useApiQuery } from '@/hooks/useApiQuery'
import { getReporte607Preview, downloadReporte607, ApiError } from '@/api'
import { downloadBlob } from '@/lib/file'
import type { EstadoTono } from '@/types/domain'
import type { Nav } from '@/config/navigation'

/* FISCALO — Reportes > Fiscales > 607 (ventas DGII) */

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Período AAAAMM del mes actual. */
function periodoActual(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Años seleccionables: actual y los 3 anteriores. */
function aniosDisponibles(): number[] {
  const y = new Date().getFullYear()
  return [y, y - 1, y - 2, y - 3]
}

/** 'AAAAMMDD' -> 'DD/MM/AAAA'; '—' si la fecha viene vacía. */
function fmtFecha(s: string): string {
  if (!s || s.length !== 8) return '—'
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`
}

/** Tono del badge según el estado DGII del comprobante. */
function tonoEstado(estado: string): EstadoTono {
  const e = estado.toUpperCase()
  if (e === 'ACEPTADO') return 'success'
  if (e.startsWith('RECHAZ')) return 'danger'
  return 'neutral'
}

export function Reporte607View({ nav }: { nav: Nav }) {
  const [periodo, setPeriodo] = useState<string>(periodoActual)
  const [descargando, setDescargando] = useState(false)

  const anio = periodo.slice(0, 4)
  const mes = periodo.slice(4, 6)

  const q = useApiQuery(
    ['reportes', '607', 'preview', periodo],
    () => getReporte607Preview(periodo),
    { keepPrevious: true },
  )
  const data = q.data

  const setAnio = (y: string) => setPeriodo(`${y}${mes}`)
  const setMes = (m: string) => setPeriodo(`${anio}${m}`)

  const descargar = async () => {
    setDescargando(true)
    const tid = toast.loading('Generando 607…')
    try {
      const { blob, filename } = await downloadReporte607(periodo)
      downloadBlob(blob, filename)
      toast.success(`Descargado ${filename}`, { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo descargar el 607.', { id: tid })
    } finally {
      setDescargando(false)
    }
  }

  const vacio = !!data && data.cantidad === 0
  const puedeDescargar = !!data && data.cantidad > 0 && !descargando

  return (
    <div className="page page-wide">
      <PageHead
        title="Reporte 607"
        sub="Ventas de bienes y servicios — formato DGII"
        crumbs={[
          { label: 'Reportes', onClick: () => nav('reportes') },
          { label: 'Fiscales', onClick: () => nav('reportes-fiscales') },
          { label: '607' },
        ]}
        actions={
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <RefreshButton onRefresh={q.reload} />
            <Btn variant="primary" icon="download" onClick={descargar} disabled={!puedeDescargar}>
              Descargar 607 (.txt)
            </Btn>
          </div>
        }
      />

      {/* Selector de período */}
      <div className="card card-pad mb-lg">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="r607-anio">Año</label>
            <select id="r607-anio" className="select" value={anio} onChange={(e) => setAnio(e.target.value)} style={{ width: 'auto' }}>
              {aniosDisponibles().map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="r607-mes">Mes</label>
            <select id="r607-mes" className="select" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: 'auto' }}>
              {MESES.map((nombre, i) => {
                const val = String(i + 1).padStart(2, '0')
                return <option key={val} value={val}>{nombre}</option>
              })}
            </select>
          </div>
          <div className="text-sm muted" style={{ paddingBottom: 8 }}>
            Período <span className="mono fw6">{periodo}</span>
            {data && <> · {data.cantidad} registro{data.cantidad === 1 ? '' : 's'}</>}
          </div>
        </div>
      </div>

      {/* Advertencias */}
      {data && data.advertencias.length > 0 && (
        <div className="card card-pad mb-lg" style={{ borderLeft: '3px solid var(--warning)' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="alert-triangle" size={16} style={{ color: 'var(--warning)' }} />
            <span className="fw6">Advertencias ({data.advertencias.length})</span>
            <Badge tone="warning">Revisar antes de declarar</Badge>
          </div>
          <ul className="text-sm muted" style={{ margin: 0, paddingLeft: 18 }}>
            {data.advertencias.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* Totales */}
      {data && data.cantidad > 0 && (
        <div className="kpi-grid mb-lg">
          <Total label="Monto facturado" value={data.totales.monto_facturado} icon="receipt" color="var(--success)" soft="var(--success-soft)" />
          <Total label="ITBIS facturado" value={data.totales.itbis_facturado} icon="landmark" color="var(--accent)" soft="var(--accent-soft)" />
          <Total label="ITBIS retenido" value={data.totales.itbis_retenido} icon="hand-coins" color="var(--warning)" soft="var(--warning-soft)" />
          <Total label="Retención renta" value={data.totales.retencion_renta} icon="percent" color="var(--danger)" soft="var(--danger-soft)" />
        </div>
      )}

      {/* Tabla de registros */}
      <Card noPad>
        {q.loading ? (
          <LoadingState rows={7} />
        ) : q.error ? (
          <ErrorState title="No se pudo cargar el reporte 607" onRetry={q.reload}>{q.error}</ErrorState>
        ) : vacio ? (
          <EmptyState icon="inbox" title="Sin transacciones en el período">
            No hay ventas registradas para {MESES[Number(mes) - 1]} {anio}.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th><th>RNC</th><th>Tipo</th><th>Estado</th><th>NCF</th><th>Fecha</th>
                  <th className="num">Facturado</th><th className="num">ITBIS</th><th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data?.registros.map((r, i) => (
                  <tr key={`${r.ncf}-${i}`}>
                    <td><span className="cell-main">{r.razon_social || '—'}</span></td>
                    <td className="mono text-sm muted">{r.rnc || '—'}</td>
                    <td><span className="ecf-tag">{r.tipo_comprobante}</span></td>
                    <td><Badge tone={tonoEstado(r.estado_dgii)}>{r.estado_dgii || '—'}</Badge></td>
                    <td className="mono text-sm">{r.ncf}</td>
                    <td className="muted text-sm">{fmtFecha(r.fecha_comprobante)}</td>
                    <td className="num text-sm"><Money value={r.monto_facturado} cur={false} /></td>
                    <td className="num text-sm muted"><Money value={r.itbis_facturado} cur={false} /></td>
                    <td className="num fw6"><Money value={r.monto_facturado + r.itbis_facturado} cur={false} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={6} className="fw6 text-sm" style={{ padding: '11px 14px' }}>
                    Totales ({data?.cantidad})
                  </td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={data?.totales.monto_facturado ?? 0} cur={false} /></td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={data?.totales.itbis_facturado ?? 0} cur={false} /></td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={(data?.totales.monto_facturado ?? 0) + (data?.totales.itbis_facturado ?? 0)} cur={false} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Total({ label, value, icon, color, soft }: { label: string; value: number; icon: string; color: string; soft: string }) {
  return (
    <div className="card card-pad" style={{ borderTop: `3px solid ${color}` }}>
      <div className="row between" style={{ alignItems: 'center', marginBottom: 10 }}>
        <span className="text-xs muted">{label}</span>
        <span className="kpi-ic" style={{ background: soft, color, width: 30, height: 30 }}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div className="fw6" style={{ fontSize: 19, color }}><Money value={value} /></div>
    </div>
  )
}

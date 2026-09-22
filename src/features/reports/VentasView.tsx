import { useState } from 'react'
import { toast } from 'sonner'
import {
  Icon, Btn, Money, Card, Badge, PageHead, RefreshButton, Tabs,
  LoadingState, ErrorState, EmptyState, type IconName,
} from '@/components/ui'
import { useApiQuery } from '@/hooks/useApiQuery'
import { getReporteVentas, downloadReporteVentas, ApiError } from '@/api'
import type { AgrupacionVentas, FormatoExportacion, VentaDocumento, VentaGrupo } from '@/api'
import { downloadBlob } from '@/lib/file'
import type { Nav } from '@/config/navigation'

/* FISCALO — Reportes > Ventas (gestión, no fiscal) */

/**
 * Las cuatro vistas del reporte. En el sistema anterior del cliente eran cinco
 * entradas de menú: "por vendedor" y "por usuario" salían por separado. Aquí son
 * la misma, porque hoy solo se guarda quién digitó la factura y no a quién se le
 * acredita la venta — de ahí la etiqueta doble.
 */
const VISTAS: { id: AgrupacionVentas; label: string; titulo: string }[] = [
  { id: 'documento', label: 'Detalle', titulo: 'Ventas' },
  { id: 'cliente', label: 'Por cliente', titulo: 'Ventas por cliente' },
  { id: 'forma_pago', label: 'Por forma de pago', titulo: 'Ventas por forma de pago' },
  { id: 'usuario', label: 'Por usuario', titulo: 'Ventas por usuario / vendedor' },
]

/** Primer día del mes en curso, en AAAA-MM-DD. */
function inicioDeMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

/** '2026-09-05 14:30:00' -> '05/09/2026'. */
function fmtFecha(s: string): string {
  if (!s) return '—'
  const [a, m, d] = s.slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : '—'
}

/**
 * El estado llega siempre desde el API, pero una fila sin él no puede tumbar la
 * pantalla entera: `estado.toUpperCase()` sobre undefined desmontaba la vista
 * completa y solo se veía el límite de error.
 */
function tonoEstado(estado: string | undefined | null): 'success' | 'danger' | 'neutral' {
  const e = (estado ?? '').toUpperCase()
  if (e.includes('ACEPTADO')) return 'success'
  if (e.startsWith('RECHAZ')) return 'danger'
  return 'neutral'
}

export function VentasView({ nav }: { nav: Nav }) {
  const [desde, setDesde] = useState(inicioDeMes)
  const [hasta, setHasta] = useState(hoy)
  const [agrupar, setAgrupar] = useState<AgrupacionVentas>('documento')
  // Guarda QUÉ formato se está generando: con un booleano los dos botones
  // decían "Generando…" a la vez.
  const [descargando, setDescargando] = useState<FormatoExportacion | null>(null)

  // El rango se arrastra en vez de poder quedar invertido: mover "desde" más
  // allá de "hasta" empuja el otro extremo. Así nunca hay un estado de error
  // que mostrar ni una consulta que el API vaya a rechazar con un 400.
  const cambiarDesde = (v: string) => { setDesde(v); if (v > hasta) setHasta(v) }
  const cambiarHasta = (v: string) => { setHasta(v); if (v < desde) setDesde(v) }

  const q = useApiQuery(
    ['reportes', 'ventas', desde, hasta, agrupar],
    () => getReporteVentas({ desde, hasta, agrupar }),
    { keepPrevious: true },
  )
  const data = q.data
  const vista = VISTAS.find((v) => v.id === agrupar) ?? VISTAS[0]
  const vacio = !!data && data.totales.cantidad === 0

  const descargar = async (formato: FormatoExportacion) => {
    setDescargando(formato)
    const tid = toast.loading(formato === 'pdf' ? 'Generando PDF…' : 'Generando Excel…')
    try {
      const { blob, filename } = await downloadReporteVentas({ desde, hasta, agrupar }, formato)
      downloadBlob(blob, filename)
      toast.success(`Descargado ${filename}`, { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo descargar el reporte.', { id: tid })
    } finally {
      setDescargando(null)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead
        title={vista.titulo}
        sub="Lo que vendiste en el período"
        crumbs={[{ label: 'Reportes', onClick: () => nav('reportes') }, { label: 'Ventas' }]}
        actions={
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <RefreshButton onRefresh={q.reload} />
            <Btn
              variant="secondary" icon="file-text" onClick={() => void descargar('pdf')}
              disabled={!data || vacio || descargando != null}
            >
              {descargando === 'pdf' ? 'Generando…' : 'PDF'}
            </Btn>
            <Btn
              variant="primary" icon="sheet" onClick={() => void descargar('xlsx')}
              disabled={!data || vacio || descargando != null}
            >
              {descargando === 'xlsx' ? 'Generando…' : 'Excel'}
            </Btn>
          </div>
        }
      />

      {/* Rango de fechas */}
      <div className="card card-pad mb-lg">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rv-desde">Desde</label>
            <input id="rv-desde" type="date" className="input" value={desde}
              onChange={(e) => cambiarDesde(e.target.value)} style={{ width: 'auto' }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rv-hasta">Hasta</label>
            <input id="rv-hasta" type="date" className="input" value={hasta}
              onChange={(e) => cambiarHasta(e.target.value)} style={{ width: 'auto' }} />
          </div>
          <div className="text-sm muted" style={{ paddingBottom: 8 }}>
            {data && <>{data.totales.cantidad} documento{data.totales.cantidad === 1 ? '' : 's'}</>}
          </div>
        </div>
      </div>

      <div className="mb-lg">
        <Tabs
          tabs={VISTAS.map((v) => ({ id: v.id, label: v.label }))}
          active={agrupar}
          onChange={(id) => setAgrupar(id as AgrupacionVentas)}
        />
      </div>

      {data && data.advertencias.length > 0 && (
        <div className="card card-pad mb-lg" style={{ borderLeft: '3px solid var(--warning)' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="alert-triangle" size={16} style={{ color: 'var(--warning)' }} />
            <span className="fw6">Advertencias ({data.advertencias.length})</span>
          </div>
          <ul className="text-sm muted" style={{ margin: 0, paddingLeft: 18 }}>
            {data.advertencias.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
          </ul>
        </div>
      )}

      {data && !vacio && (
        <div className="kpi-grid mb-lg">
          <Total label="Base" value={data.totales.base} icon="receipt" color="var(--accent)" soft="var(--accent-soft)" />
          <Total label="ITBIS" value={data.totales.itbis} icon="landmark" color="var(--warning)" soft="var(--warning-soft)" />
          <Total label="Total vendido" value={data.totales.total} icon="trending-up" color="var(--success)" soft="var(--success-soft)" />
        </div>
      )}

      <Card noPad>
        {q.error ? (
          <ErrorState title="No se pudo cargar el reporte" onRetry={q.reload}>{q.error}</ErrorState>
        ) : !data ? (
          // Cubre `loading` y cualquier hueco sin dato ni error: antes esto
          // aterrizaba en las tablas con un `data!` que habria reventado.
          <LoadingState rows={7} />
        ) : vacio ? (
          <EmptyState icon="inbox" title="Sin ventas en el período">
            No hay documentos de venta entre {fmtFecha(desde)} y {fmtFecha(hasta)}.
          </EmptyState>
        ) : agrupar === 'documento' ? (
          <TablaDetalle filas={data.filas as VentaDocumento[]} totales={data.totales} />
        ) : (
          <TablaGrupos
            filas={data.filas as VentaGrupo[]}
            totales={data.totales}
            encabezado={vista.label.replace('Por ', '')}
            conRnc={agrupar === 'cliente'}
          />
        )}
      </Card>

      <p className="text-xs muted" style={{ marginTop: 12 }}>
        Incluye facturas de venta (E31, E32, E44, E45, E46) y facturas simples. Las notas de crédito
        (E34) restan y las de débito (E33) suman. No entran compras ni gastos (E41, E43, E47) ni los
        comprobantes rechazados por la DGII.
      </p>
    </div>
  )
}

function TablaDetalle({ filas, totales }: { filas: VentaDocumento[]; totales: { cantidad: number; base: number; itbis: number; total: number } }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Fecha</th><th>Documento</th><th>Tipo</th><th>Cliente</th>
            <th>Forma de pago</th><th>Usuario</th><th>Estado</th>
            <th className="num">Base</th><th className="num">ITBIS</th><th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td className="muted text-sm">{fmtFecha(f.fecha)}</td>
              <td className="mono text-sm">{f.documento}</td>
              <td>
                <span className="ecf-tag">{f.tipo}</span>
                {/* Una nota de crédito resta: sin marcarla, un total en rojo parece un error. */}
                {f.es_devolucion && <span className="text-xs muted" style={{ marginLeft: 6 }}>resta</span>}
              </td>
              <td>
                <span className="cell-main">{f.cliente}</span>
                {f.cliente_rnc && <div className="cell-sub mono">{f.cliente_rnc}</div>}
              </td>
              <td className="text-sm">{f.forma_pago}</td>
              <td className="text-sm">{f.usuario}</td>
              <td><Badge tone={tonoEstado(f.estado)}>{f.estado || '—'}</Badge></td>
              <td className="num text-sm"><Money value={f.base} cur={false} /></td>
              <td className="num text-sm muted"><Money value={f.itbis} cur={false} /></td>
              <td className="num fw6" style={f.es_devolucion ? { color: 'var(--danger)' } : undefined}>
                <Money value={f.total} cur={false} />
              </td>
            </tr>
          ))}
        </tbody>
        <PieTotales colSpan={7} totales={totales} />
      </table>
    </div>
  )
}

function TablaGrupos({
  filas, totales, encabezado, conRnc,
}: {
  filas: VentaGrupo[]
  totales: { cantidad: number; base: number; itbis: number; total: number }
  encabezado: string
  conRnc: boolean
}) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ textTransform: 'capitalize' }}>{encabezado}</th>
            <th className="num">Documentos</th>
            <th className="num">Base</th><th className="num">ITBIS</th><th className="num">Total</th>
            <th className="num">% del total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.clave ?? 'sn'}-${i}`}>
              <td>
                <span className="cell-main">{f.etiqueta}</span>
                {conRnc && f.cliente_rnc && <div className="cell-sub mono">{f.cliente_rnc}</div>}
              </td>
              <td className="num text-sm muted">{f.cantidad}</td>
              <td className="num text-sm"><Money value={f.base} cur={false} /></td>
              <td className="num text-sm muted"><Money value={f.itbis} cur={false} /></td>
              <td className="num fw6"><Money value={f.total} cur={false} /></td>
              <td className="num text-sm muted">
                {totales.total !== 0 ? `${((f.total / totales.total) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <PieTotales colSpan={1} totales={totales} porcentaje />
      </table>
    </div>
  )
}

function PieTotales({
  colSpan, totales, porcentaje = false,
}: {
  colSpan: number
  totales: { cantidad: number; base: number; itbis: number; total: number }
  porcentaje?: boolean
}) {
  const celda = { padding: '11px 14px' }
  return (
    <tfoot>
      <tr style={{ background: 'var(--surface-2)' }}>
        <td colSpan={colSpan} className="fw6 text-sm" style={celda}>
          Totales ({totales.cantidad} documento{totales.cantidad === 1 ? '' : 's'})
        </td>
        {porcentaje && <td className="num fw6" style={celda}>{totales.cantidad}</td>}
        <td className="num fw6" style={celda}><Money value={totales.base} cur={false} /></td>
        <td className="num fw6" style={celda}><Money value={totales.itbis} cur={false} /></td>
        <td className="num fw6" style={celda}><Money value={totales.total} cur={false} /></td>
        {porcentaje && <td className="num fw6" style={celda}>100%</td>}
      </tr>
    </tfoot>
  )
}

function Total({ label, value, icon, color, soft }: { label: string; value: number; icon: IconName; color: string; soft: string }) {
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

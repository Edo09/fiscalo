// FISCALO — Punto de venta → Turnos (api-gratex docs/specs/pos.md K8, M1): los
// cierres de caja con su diferencia, y el reporte de cada uno para revisarlo o
// reimprimirlo. Es la misma foto que se imprimió en la caja al cerrar.
import { useState, type ReactNode } from 'react'
import { Btn, Badge, Card, Icon, Modal, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { getEmisor } from '@/api'
import { getPosTurno, listPosTurnos } from '@/api/pos'
import type { PosCaja, PosEmpleado, PosTurno, FiltrosTurnos } from '@/api/pos'
import { useApiQuery } from '@/hooks/useApiQuery'
import { printHtml } from '@/lib/printHtml'
import { getAnchoTirilla } from '@/stores/impresora'
import type { ReporteCierre } from '@/pos/api'
import { DENOMINACIONES, formatoCentavos } from '@/pos/montos'
import { ANCHO_UTIL_MM, fechaHora, reporteCierreHtml, SELECTOR_REPORTE, textoDiferencia } from '@/pos/reporteCierre'

const pesos = (n: number | null) => (n === null ? '—' : `RD$ ${formatoCentavos(Math.round(n * 100))}`)

function BadgeDiferencia({ t }: { t: PosTurno }) {
  if (t.abierto) return <Badge tone="info" dot>Abierto</Badge>
  const d = Math.round((t.diferencia ?? 0) * 100)
  if (d === 0) return <Badge tone="success" dot>Cuadra</Badge>
  return <Badge tone={d < 0 ? 'danger' : 'warning'} dot>{textoDiferencia(d)}</Badge>
}

export function TurnosPanel({ cajas, empleados }: { cajas: PosCaja[]; empleados: PosEmpleado[] }) {
  const [filtros, setFiltros] = useState<FiltrosTurnos>({})
  const [abierto, setAbierto] = useState<PosTurno | null>(null)
  const q = useApiQuery(['pos', 'turnos', filtros], () => listPosTurnos(filtros), { keepPrevious: true })
  const filas = q.data ?? []
  const cambiar = (k: keyof FiltrosTurnos, v: string) =>
    setFiltros((f) => ({ ...f, [k]: v === '' ? undefined : k === 'caja_id' || k === 'empleado_id' ? Number(v) : v }))

  return (
    <>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select className="input" style={{ maxWidth: 180 }} value={filtros.caja_id ?? ''} onChange={(e) => cambiar('caja_id', e.target.value)} aria-label="Caja">
          <option value="">Todas las cajas</option>
          {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 200 }} value={filtros.empleado_id ?? ''} onChange={(e) => cambiar('empleado_id', e.target.value)} aria-label="Cajero">
          <option value="">Todos los cajeros</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <label className="row gap-sm text-sm muted" style={{ alignItems: 'center' }}>
          Desde <input type="date" className="input" value={filtros.desde ?? ''} onChange={(e) => cambiar('desde', e.target.value)} />
        </label>
        <label className="row gap-sm text-sm muted" style={{ alignItems: 'center' }}>
          Hasta <input type="date" className="input" value={filtros.hasta ?? ''} onChange={(e) => cambiar('hasta', e.target.value)} />
        </label>
        {Object.keys(filtros).some((k) => filtros[k as keyof FiltrosTurnos] !== undefined) && (
          <button className="filter-chip" onClick={() => setFiltros({})}><Icon name="x" />Limpiar</button>
        )}
      </div>

      <Card noPad>
        {q.loading ? (
          <LoadingState rows={4} />
        ) : q.error ? (
          <ErrorState title="No se pudieron cargar los turnos" onRetry={q.reload}>{q.error}</ErrorState>
        ) : filas.length === 0 ? (
          <EmptyState icon="clock" title="No hay turnos">
            Los turnos se abren y se cierran en la caja (pos.fiscalpoint.com.do). Aquí sale cada cierre con su diferencia.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Caja</th><th>Cajero</th><th>Apertura</th><th>Cierre</th><th style={{ textAlign: 'right' }}>Esperado</th>
                <th style={{ textAlign: 'right' }}>Contado</th><th>Resultado</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {filas.map((t) => (
                  <tr key={t.id} onClick={() => setAbierto(t)}>
                    <td className="cell-main">{t.caja_nombre}</td>
                    <td>
                      {t.empleado_nombre}
                      {t.cerrado_por !== null && t.cerrado_por !== t.empleado_id && (
                        <div className="text-sm muted-3">Cerró {t.cerrado_por_nombre}</div>
                      )}
                    </td>
                    <td className="text-sm muted">{fechaHora(t.abierto_at)}</td>
                    <td className="text-sm muted">{t.cerrado_at ? fechaHora(t.cerrado_at) : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="text-sm">{pesos(t.efectivo_esperado)}</td>
                    <td style={{ textAlign: 'right' }} className="text-sm">{pesos(t.efectivo_contado)}</td>
                    <td><BadgeDiferencia t={t} />{t.nota && <Icon name="file-text" size={14} style={{ marginLeft: 6, color: 'var(--text-3)' }} />}</td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {abierto && <TurnoDetalleModal turno={abierto} onClose={() => setAbierto(null)} />}
    </>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="text-sm" style={{ fontWeight: 600, marginBottom: 6 }}>{titulo}</div>
      {children}
    </div>
  )
}

const Par = ({ a, b, fuerte = false }: { a: string; b: string; fuerte?: boolean }) => (
  <div className="row between text-sm" style={{ padding: '3px 0', fontWeight: fuerte ? 600 : 400 }}><span className={fuerte ? '' : 'muted'}>{a}</span><span>{b}</span></div>
)

function TurnoDetalleModal({ turno, onClose }: { turno: PosTurno; onClose: () => void }) {
  const q = useApiQuery(['pos', 'turno', turno.id], () => getPosTurno(turno.id))
  const emisor = useApiQuery(['emisor'], getEmisor)
  const [imprimiendo, setImprimiendo] = useState(false)
  const r: ReporteCierre | null = q.data?.reporte ?? null

  const reimprimir = async () => {
    if (!r) return
    setImprimiendo(true)
    try {
      const mm = ANCHO_UTIL_MM[getAnchoTirilla()]
      await printHtml(reporteCierreHtml(r, { empresa: emisor.data?.razon_social ?? null, anchoMm: mm }), { anchoMm: mm, selector: SELECTOR_REPORTE })
    } finally {
      setImprimiendo(false)
    }
  }

  return (
    <Modal title={`Turno de ${turno.empleado_nombre}`} sub={`${turno.caja_nombre} · ${fechaHora(turno.abierto_at)}`} icon="clock" width={620} onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
          {r && <Btn variant="primary" icon="printer" onClick={() => void reimprimir()} disabled={imprimiendo}>{imprimiendo ? 'Imprimiendo…' : 'Reimprimir reporte'}</Btn>}
        </>
      }>
      {q.loading ? <LoadingState rows={5} /> : q.error ? <ErrorState title="No se pudo cargar el turno">{q.error}</ErrorState> : !r ? (
        <div className="row gap-sm text-sm muted"><Icon name="info" size={16} /><span>El turno sigue abierto: el reporte sale cuando se cierre en la caja.</span></div>
      ) : (
        <>
          <div className="row gap-sm" style={{ marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <BadgeDiferencia t={turno} />
            <span className="text-sm muted">Cerrado {fechaHora(r.cerrado_at)}{r.cerrado_por.id !== r.empleado.id ? ` por ${r.cerrado_por.nombre} (supervisor)` : ''}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 24px' }}>
            <Bloque titulo={`Ventas (${r.ventas.cantidad})`}>
              {r.ventas.por_forma.map((f) => <Par key={f.forma_pago} a={`${f.nombre} (${f.cantidad})`} b={formatoCentavos(f.monto_centavos)} />)}
              <Par a="Total" b={formatoCentavos(r.ventas.total_centavos)} fuerte />
              <Par a="Comprobantes" b={Object.entries(r.comprobantes).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'ninguno'} />
              <Par a={`Ventas canceladas (${r.canceladas.cantidad})`} b={formatoCentavos(r.canceladas.monto_centavos)} />
              <Par a={`Líneas quitadas (${r.lineas_quitadas.cantidad})`} b={formatoCentavos(r.lineas_quitadas.monto_centavos)} />
            </Bloque>
            <Bloque titulo="Efectivo">
              <Par a="Fondo inicial" b={formatoCentavos(r.fondo_centavos)} />
              <Par a="+ Ventas en efectivo" b={formatoCentavos(r.efectivo_ventas_centavos)} />
              {r.efectivo_devoluciones_centavos > 0 && <Par a="− Devoluciones" b={formatoCentavos(r.efectivo_devoluciones_centavos)} />}
              <Par a="= Esperado" b={formatoCentavos(r.esperado_centavos)} fuerte />
              <Par a="Contado" b={formatoCentavos(r.contado_centavos)} fuerte />
              <Par a="Diferencia" b={textoDiferencia(r.diferencia_centavos)} fuerte />
            </Bloque>
          </div>
          <Bloque titulo="Conteo">
            <div className="text-sm muted">
              {DENOMINACIONES.filter((d) => (r.conteo[String(d)] ?? 0) > 0)
                .map((d) => `${d.toLocaleString('es-DO')} × ${r.conteo[String(d)]}`).join(' · ') || 'Sin billetes ni monedas'}
              {(r.conteo.otros_centavos ?? 0) > 0 && ` · otros ${formatoCentavos(r.conteo.otros_centavos)}`}
            </div>
          </Bloque>
          {(r.pendientes.length > 0 || r.rechazadas.length > 0) && (
            <Bloque titulo="DGII">
              {r.pendientes.map((p) => <Par key={p.e_ncf} a={`${p.e_ncf} · sin confirmar al cerrar`} b={formatoCentavos(p.total_centavos)} />)}
              {r.rechazadas.map((p) => <Par key={p.e_ncf} a={`${p.e_ncf} · rechazada`} b={formatoCentavos(p.total_centavos)} />)}
            </Bloque>
          )}
          {r.nota && <Bloque titulo="Nota"><div className="text-sm">{r.nota}</div></Bloque>}
        </>
      )}
    </Modal>
  )
}

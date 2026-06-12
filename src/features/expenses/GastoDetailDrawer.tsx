import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Drawer, Spinner } from '@/components/ui'
import { ApiError, getGasto, getGastoEstado, getGastoXml, isRechazo } from '@/api'
import type { GastoRow } from '@/api'
import { downloadBlob } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { categoriaLabel, gastoEstadoLabel, isAutoEmision, tipoLabel } from '@/config/gastos'

/* FISCALO — Detalle de un gasto (líneas + estado DGII + XML) */
export function GastoDetailDrawer({ gasto, onClose }: { gasto: GastoRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data, loading, reload } = useApiQuery(['gastos', 'detail', gasto.id], () => getGasto(gasto.id))
  const g = data ?? gasto
  const items = g.items ?? []
  const auto = typeof g.es_auto_emision === 'number'
    ? g.es_auto_emision === 1
    : typeof g.es_auto_emision === 'boolean'
      ? g.es_auto_emision
      : isAutoEmision(g.tipo_gasto)

  const [estadoBusy, setEstadoBusy] = useState(false)
  const [xmlBusy, setXmlBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [estado, setEstado] = useState<string | null>(g.estado_dgii ?? null)

  const consultarEstado = async () => {
    setEstadoBusy(true)
    setMsg(null)
    const tid = toast.loading('Consultando estado en la DGII…')
    try {
      const r = await getGastoEstado(g.id)
      setEstado(r.estado_dgii ?? estado)
      reload()
      toast.success(`Estado actualizado: ${gastoEstadoLabel(r.estado_dgii ?? '') || r.estado_dgii || '—'}.`, { id: tid })
    } catch (e) {
      const m = e instanceof ApiError ? e.message : 'No se pudo consultar el estado.'
      setMsg(m)
      toast.error(m, { id: tid })
    } finally {
      setEstadoBusy(false)
    }
  }

  useEffect(() => {
    if (auto) {
      void consultarEstado()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const descargarXml = async () => {
    setXmlBusy(true)
    setMsg(null)
    const tid = toast.loading('Descargando XML…')
    try {
      const { blob, filename } = await getGastoXml(g.id)
      downloadBlob(blob, filename)
      toast.success(`Descargado ${filename}.`, { id: tid })
    } catch (e) {
      const m = e instanceof ApiError ? e.message : 'No se pudo descargar el XML.'
      setMsg(m)
      toast.error(m, { id: tid })
    } finally {
      setXmlBusy(false)
    }
  }

  const estadoActual = estado ?? g.estado_dgii

  const prevEstadoRef = useRef<string | null>(null)
  useEffect(() => {
    if (estadoActual && estadoActual !== prevEstadoRef.current) {
      prevEstadoRef.current = estadoActual
      if (isRechazo(estadoActual)) {
        void queryClient.invalidateQueries({ queryKey: ['gastos', 'stats'] })
      }
    }
  }, [estadoActual, queryClient])

  return (
    <Drawer
      title={`${g.tipo_gasto ?? 'Gasto'} · ${g.nombre_proveedor ?? '—'}`}
      sub={categoriaLabel(g.categoria)}
      width={600}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
          {auto && <Btn variant="secondary" icon="refresh-cw" onClick={consultarEstado} disabled={estadoBusy}>{estadoBusy ? 'Consultando…' : 'Consultar estado'}</Btn>}
          {auto && <Btn variant="primary" icon="code" onClick={descargarXml} disabled={xmlBusy}>{xmlBusy ? 'Descargando…' : 'XML'}</Btn>}
        </>
      }
    >
      {msg && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
          <Icon name="alert-circle" size={16} /><span className="fw6 text-sm">{msg}</span>
        </div>
      )}

      {g.aviso && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--warning-soft)', borderColor: 'transparent', color: 'var(--warning)' }}>
          <Icon name="clock" size={16} /><span className="text-sm">{g.aviso}</span>
        </div>
      )}

      <div className="card card-pad col gap-md mb-md">
        <div className="row between"><span className="text-sm muted">Tipo</span><span className="fw6 text-sm">{tipoLabel(g.tipo_gasto)}</span></div>
        <div className="row between"><span className="text-sm muted">NCF</span><span className="mono text-sm">{g.ncf ?? '—'}</span></div>
        <div className="row between"><span className="text-sm muted">Proveedor</span><span className="text-sm">{g.nombre_proveedor ?? '—'}</span></div>
        <div className="row between"><span className="text-sm muted">RNC / Cédula</span><span className="mono text-sm">{g.rnc_proveedor ?? '—'}</span></div>
        <div className="row between"><span className="text-sm muted">Fecha</span><span className="text-sm">{g.fecha ?? '—'}</span></div>
        <div className="row between"><span className="text-sm muted">Origen</span><span className="text-sm">{auto ? 'Auto-emisión (DGII)' : 'Recibido'}</span></div>
        <div className="row between"><span className="text-sm muted">Estado</span>{estadoActual ? <EstadoBadge estado={gastoEstadoLabel(estadoActual)} /> : <span className="muted-3">—</span>}</div>
        {g.track_id && <div className="row between"><span className="text-sm muted">Track ID</span><span className="mono text-xs">{g.track_id}</span></div>}
      </div>

      <div className="fw6 text-sm mb-sm">Líneas</div>
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="row" style={{ justifyContent: 'center', padding: 20 }}><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="text-sm muted" style={{ padding: 16 }}>Sin líneas registradas.</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Descripción</th><th className="num">Cant.</th><th className="num">ITBIS</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={i} style={{ cursor: 'default' }}>
                  <td><span className="cell-main">{l.description ?? '—'}</span></td>
                  <td className="num">{Number(l.quantity ?? 0)}</td>
                  <td className="num muted"><Money value={Number(l.itbis_amount ?? 0)} cur={false} /></td>
                  <td className="num fw6"><Money value={Number(l.subtotal ?? Number(l.amount ?? 0) * Number(l.quantity ?? 1))} cur={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <div style={{ width: 240 }}>
          <div className="row between mb-sm text-sm"><span className="muted">Subtotal</span><Money value={Number(g.subtotal ?? 0)} cur={false} /></div>
          <div className="row between mb-sm text-sm"><span className="muted">ITBIS</span><Money value={Number(g.itbis ?? 0)} cur={false} /></div>
          <div className="divider" style={{ margin: '8px 0' }}></div>
          <div className="row between" style={{ fontSize: 17, fontWeight: 700 }}><span>Total</span><Money value={Number(g.total ?? 0)} /></div>
        </div>
      </div>
    </Drawer>
  )
}

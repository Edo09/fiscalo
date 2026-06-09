import { useState } from 'react'
import { Icon, Btn, Money, EstadoBadge, Card, Spinner, PageHead } from '@/components/ui'
import { DATA } from '@/data/mockData'
import {
  ApiError, getEstado, getFactura, getDocumentBase64, dgiiLabel, isRechazo, formatApiDate,
} from '@/api'
import type { DocKind } from '@/api'
import { presentDocument } from '@/lib/file'
import { useAsync } from '@/hooks/useAsync'
import type { Nav } from '@/app/navigation'
import type { Factura } from '@/types/domain'

/* FISCALO — Facturación: ver factura (estado DGII en vivo + PDF/XML) */
export function InvoiceDetailView({ factura, nav }: { factura: Factura | null; nav: Nav }) {
  const D = DATA
  const f = factura
  const id = f?.facturaId ?? null

  const estado = useAsync(() => (id != null ? getEstado(id) : Promise.resolve(null)), [id])
  const detalle = useAsync(() => (id != null ? getFactura(id) : Promise.resolve(null)), [id])

  const [docBusy, setDocBusy] = useState<DocKind | null>(null)
  const [docError, setDocError] = useState<string | null>(null)

  if (!f) {
    return (
      <div className="page">
        <PageHead title="Factura" crumbs={[{ label: 'Facturación', onClick: () => nav('facturas') }]} />
        <Card><div className="state" style={{ padding: 32 }}><span className="text-sm muted">No hay factura seleccionada.</span></div></Card>
      </div>
    )
  }

  const estadoData = estado.data
  const estadoRaw = estadoData?.estado_dgii ?? f.estadoDgiiRaw ?? null
  const mensajes = (estadoData?.consulta?.mensajes ?? []).filter((m) => m.valor)
  const rechazado = isRechazo(estadoRaw)
  const isRfce = (estadoRaw ?? '').startsWith('RFCE')
  const items = detalle.data?.items ?? []

  const openDoc = async (kind: DocKind, download = false) => {
    if (id == null) return
    setDocBusy(kind)
    setDocError(null)
    try {
      const doc = await getDocumentBase64(id, kind)
      presentDocument(doc, { download })
    } catch (e) {
      setDocError(e instanceof ApiError ? e.message : 'No se pudo obtener el documento.')
    } finally {
      setDocBusy(null)
    }
  }

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: 'Facturación', onClick: () => nav('facturas') }, { label: f.ncf }]}
        title={f.ncf}
        sub={`${f.cliente} · ${f.fecha}`}
        actions={
          <>
            <Btn variant="secondary" icon="download" onClick={() => openDoc('pdf')} disabled={id == null || docBusy === 'pdf'}>
              {docBusy === 'pdf' ? 'Abriendo…' : 'PDF'}
            </Btn>
            <Btn variant="secondary" icon="code" onClick={() => openDoc(isRfce ? 'xml-rfce' : 'xml', true)} disabled={id == null || docBusy != null}>
              XML
            </Btn>
            <Btn variant="secondary" icon="refresh-cw" onClick={estado.reload}>Estado</Btn>
          </>
        }
      />

      {docError && (
        <div className="card card-pad row gap-sm" style={{ marginBottom: 14, background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
          <Icon name="alert-circle" size={16} /><span className="fw6 text-sm">{docError}</span>
        </div>
      )}

      {rechazado && (
        <div className="card card-pad" style={{ marginBottom: 14, background: 'var(--danger-soft)', borderColor: 'transparent' }}>
          <div className="row gap-sm" style={{ color: 'var(--danger)' }}>
            <Icon name="x-circle" size={16} /><span className="fw6 text-sm">Rechazado por la DGII</span>
          </div>
          {mensajes.map((m, i) => (
            <div key={i} className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>• {m.valor} {m.codigo ? `(cód. ${m.codigo})` : ''}</div>
          ))}
          {estadoData?.secuencia_utilizada === false && (
            <div className="text-xs muted mt-sm">La secuencia no se consumió: puedes corregir y reemitir con el mismo e-NCF.</div>
          )}
          {estadoData?.secuencia_utilizada === true && (
            <div className="text-xs muted mt-sm">La secuencia se consumió: la reemisión tomará un nuevo e-NCF.</div>
          )}
        </div>
      )}

      <div className="dash-grid">
        {/* Documento */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '32px 36px', background: 'var(--surface)' }}>
            <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 28 }}>
              <div>
                <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 20, marginBottom: 12 }}>DC</div>
                <div className="fw6" style={{ fontSize: 15 }}>{D.empresa.nombre}</div>
                <div className="text-xs muted">RNC: {D.empresa.rnc}</div>
                <div className="text-xs muted" style={{ maxWidth: 220 }}>{D.empresa.direccion}</div>
              </div>
              <div className="tar">
                <div className="ecf-tag" style={{ fontSize: 12, marginBottom: 8, display: 'inline-block' }}>e-CF Tipo {f.tipo}</div>
                <div className="mono fw6" style={{ fontSize: 14 }}>{f.ncf}</div>
                <div className="text-xs muted mt-sm">Fecha: {f.fecha}</div>
                {f.codigoSeguridad && <div className="text-xs muted">Cód. seguridad: {f.codigoSeguridad}</div>}
              </div>
            </div>

            <div className="row gap-lg mb-lg" style={{ padding: '14px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div className="text-xs muted-3 fw6" style={{ textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Facturar a</div>
                <div className="fw6">{f.cliente}</div>
                {f.rnc && <div className="text-xs muted mono">RNC: {f.rnc}</div>}
              </div>
              <div style={{ flex: 1 }}>
                <div className="text-xs muted-3 fw6" style={{ textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Condiciones</div>
                <div className="text-sm">{f.metodo}</div>
                <div className="text-xs muted">Moneda: Peso dominicano (DOP)</div>
              </div>
            </div>

            {detalle.loading ? (
              <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Spinner /></div>
            ) : items.length > 0 ? (
              <table className="tbl" style={{ marginBottom: 4 }}>
                <thead>
                  <tr><th>Descripción</th><th className="num">Cant.</th><th className="num">ITBIS</th><th className="num">Importe</th></tr>
                </thead>
                <tbody>
                  {items.map((l, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td><span className="cell-main">{l.description ?? '—'}</span></td>
                      <td className="num">{Number(l.quantity ?? 0)}</td>
                      <td className="num muted"><Money value={Number(l.itbis_amount ?? 0)} cur={false} /></td>
                      <td className="num fw6"><Money value={Number(l.subtotal ?? l.amount ?? 0)} cur={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm muted" style={{ padding: '8px 0' }}>Detalle de líneas no disponible.</div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
              <div style={{ width: 240 }}>
                <div className="row between" style={{ fontSize: 17, fontWeight: 700 }}><span>Total</span><Money value={f.total} /></div>
              </div>
            </div>
          </div>
        </div>

        {/* Estado DGII */}
        <div className="col gap-md">
          <Card title="Estado DGII" actions={<Btn variant="ghost" size="sm" icon="refresh-cw" onClick={estado.reload} />}>
            {estado.loading ? (
              <div className="row" style={{ justifyContent: 'center', padding: 16 }}><Spinner /></div>
            ) : estado.error && id != null ? (
              <div className="text-sm" style={{ color: 'var(--danger)' }}>{estado.error}</div>
            ) : (
              <div className="col gap-md">
                <div className="row between">
                  <span className="text-sm muted">Estado</span>
                  {estadoRaw ? <EstadoBadge estado={dgiiLabel(estadoRaw)} /> : <span className="muted-3">—</span>}
                </div>
                <div className="row between"><span className="text-sm muted">e-NCF</span><span className="mono text-xs">{estadoData?.e_ncf ?? f.ncf}</span></div>
                <div className="row between"><span className="text-sm muted">Track ID</span><span className="mono text-xs">{estadoData?.track_id ?? f.trackId ?? '—'}</span></div>
                {estadoRaw && <div className="row between"><span className="text-sm muted">Estado bruto</span><span className="mono text-xs">{estadoRaw}</span></div>}
                <div className="divider" style={{ margin: 0 }}></div>
                <div className="row between"><span className="text-sm muted">Total</span><span className="fw6"><Money value={f.total} /></span></div>
              </div>
            )}
          </Card>

          <Card title="Documentos">
            <div className="col gap-sm">
              <Btn variant="secondary" icon="download" style={{ width: '100%' }} onClick={() => openDoc('pdf')} disabled={id == null || docBusy === 'pdf'}>Ver PDF</Btn>
              <Btn variant="secondary" icon="code" style={{ width: '100%' }} onClick={() => openDoc('xml', true)} disabled={id == null || docBusy === 'xml'}>Descargar XML firmado</Btn>
              {isRfce && (
                <Btn variant="ghost" icon="code" style={{ width: '100%' }} onClick={() => openDoc('xml-rfce', true)} disabled={id == null || docBusy === 'xml-rfce'}>Descargar XML RFCE</Btn>
              )}
            </div>
            {id == null && <div className="text-xs muted-3 mt-sm">Sin ID de factura: documentos no disponibles.</div>}
          </Card>

          <Card title="Emisor">
            <div className="text-sm">{formatApiDate(f.fecha)}</div>
            <div className="text-xs muted">{D.empresa.nombre} · RNC {D.empresa.rnc}</div>
          </Card>
        </div>
      </div>
    </div>
  )
}

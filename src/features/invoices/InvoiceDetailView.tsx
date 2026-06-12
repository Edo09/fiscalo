import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Card, Spinner, PageHead } from '@/components/ui'
import {
  ApiError, getEstado, getFactura, getDocumentBase64, dgiiLabel, isRechazo, formatApiDate,
} from '@/api'
import type { DocKind } from '@/api'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import type { Factura } from '@/types/domain'

/** Etiqueta corta de tasa según indicador_facturacion (1=18%, 2=16%, 3=0%, 4=exento). */
const IND_FACT_LABEL: Record<number, string> = {
  1: 'ITBIS 18%',
  2: 'ITBIS 16%',
  3: 'Tasa 0%',
  4: 'Exento',
}

/* FISCALO — Facturación: ver factura (detalle + estado DGII en vivo + PDF/XML).
   El detalle (GET /api/facturas?id=) trae items, cliente y emisor reales. */
export function InvoiceDetailView({ factura, nav }: { factura: Factura | null; nav: Nav }) {
  const f = factura
  const id = f?.facturaId ?? null
  const queryClient = useQueryClient()

  const estado = useApiQuery(['facturas', 'estado', id], () => (id != null ? getEstado(id) : Promise.resolve(null)))
  const detalle = useApiQuery(['facturas', 'detail', id], () => (id != null ? getFactura(id) : Promise.resolve(null)))

  const [docBusy, setDocBusy] = useState<DocKind | null>(null)

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

  const prevEstadoRef = useRef<string | null>(null)
  useEffect(() => {
    if (estadoRaw && estadoRaw !== prevEstadoRef.current) {
      prevEstadoRef.current = estadoRaw
      if (isRechazo(estadoRaw)) {
        void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })
      }
    }
  }, [estadoRaw, queryClient])

  // Detalle real desde la API. El documento muestra al COMPRADOR (receptor del
  // e-CF); el emisor (la propia empresa del tenant) solo va en la tarjeta lateral.
  const det = detalle.data
  const items = det?.items ?? []
  const emisor = det?.emisor
  const cliente = det?.cliente
  const emisorDireccion = [emisor?.direccion, emisor?.municipio, emisor?.provincia].filter(Boolean).join(', ')
  const clienteNombre = cliente?.razon_social || cliente?.company_name || cliente?.client_name || f.cliente
  const clienteContacto = cliente?.client_name && cliente.client_name !== clienteNombre ? cliente.client_name : ''
  const clienteRnc = cliente?.rnc || f.rnc || ''
  const total = Number(det?.total ?? f.total)
  // ITBIS y subtotal son a nivel de factura (el backend no los desglosa por línea).
  const itbisTotal = Number(det?.total_itbis ?? f.itbis ?? 0)
  const subtotalGravado = Number(det?.monto_gravado ?? f.subtotal ?? 0)
  const montoExento = Number(det?.monto_exento ?? 0)
  const fecha = det?.fecha_emision_dgii ? formatApiDate(det.fecha_emision_dgii) : f.fecha

  const openDoc = async (kind: DocKind, download = false) => {
    if (id == null) return
    setDocBusy(kind)
    const tid = toast.loading(kind === 'pdf' ? 'Generando PDF…' : 'Obteniendo XML…')
    try {
      const doc = await getDocumentBase64(id, kind)
      presentDocument(doc, { download })
      toast.success(download ? `Descargado ${doc.filename}.` : `Documento ${doc.filename} listo.`, { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo obtener el documento.', { id: tid })
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
            <Btn variant="ghost" icon="chevron-left" onClick={() => nav('facturas')}>Volver</Btn>
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
                <div className="ecf-tag" style={{ fontSize: 12, marginBottom: 8, display: 'inline-block' }}>e-CF Tipo {f.tipo}</div>
                <div className="mono fw6" style={{ fontSize: 16 }}>{f.ncf}</div>
              </div>
              <div className="tar">
                <div className="text-xs muted">Fecha: {fecha}</div>
                {f.codigoSeguridad && <div className="text-xs muted">Cód. seguridad: {f.codigoSeguridad}</div>}
              </div>
            </div>

            <div className="row gap-lg mb-lg" style={{ padding: '14px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div className="text-xs muted-3 fw6" style={{ textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Comprador</div>
                <div className="fw6">{clienteNombre}</div>
                {clienteRnc && <div className="text-xs muted mono">RNC: {clienteRnc}</div>}
                {clienteContacto && <div className="text-xs muted">Contacto: {clienteContacto}</div>}
                {cliente?.direccion && <div className="text-xs muted">{cliente.direccion}</div>}
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
                  <tr><th>Descripción</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">ITBIS</th><th className="num">Importe</th></tr>
                </thead>
                <tbody>
                  {items.map((l, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td>
                        <span className="cell-main">{l.description || `Línea ${i + 1}`}</span>
                        {l.indicador_facturacion != null && IND_FACT_LABEL[l.indicador_facturacion] && (
                          <div className="cell-sub">{IND_FACT_LABEL[l.indicador_facturacion]}</div>
                        )}
                      </td>
                      <td className="num">{Number(l.quantity ?? 0)}</td>
                      <td className="num muted"><Money value={Number(l.amount ?? 0)} cur={false} /></td>
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
              <div className="col gap-sm" style={{ width: 260 }}>
                <div className="row between text-sm"><span className="muted">Subtotal gravado</span><Money value={subtotalGravado} cur={false} /></div>
                {montoExento > 0 && <div className="row between text-sm"><span className="muted">Exento</span><Money value={montoExento} cur={false} /></div>}
                <div className="row between text-sm"><span className="muted">ITBIS</span><Money value={itbisTotal} cur={false} /></div>
                <div className="divider" style={{ margin: '4px 0' }}></div>
                <div className="row between" style={{ fontSize: 17, fontWeight: 700 }}><span>Total</span><Money value={total} /></div>
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
                <div className="row between"><span className="text-sm muted">Subtotal</span><span className="fw6"><Money value={subtotalGravado} cur={false} /></span></div>
                {montoExento > 0 && <div className="row between"><span className="text-sm muted">Exento</span><span className="fw6"><Money value={montoExento} cur={false} /></span></div>}
                <div className="row between"><span className="text-sm muted">ITBIS</span><span className="fw6"><Money value={itbisTotal} cur={false} /></span></div>
                <div className="row between"><span className="text-sm muted">Total</span><span className="fw6"><Money value={total} /></span></div>
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
            {detalle.loading ? (
              <div className="text-sm muted">Cargando…</div>
            ) : emisor ? (
              <div className="col gap-sm">
                <div className="text-sm fw6">{emisor.razon_social ?? '—'}</div>
                {emisor.rnc && <div className="text-xs muted mono">RNC {emisor.rnc}</div>}
                {emisorDireccion && <div className="text-xs muted">{emisorDireccion}</div>}
                {emisor.correo && <div className="text-xs muted">{emisor.correo}</div>}
                {emisor.telefono && <div className="text-xs muted">{emisor.telefono}</div>}
              </div>
            ) : (
              <div className="text-sm muted">Sin datos del emisor.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

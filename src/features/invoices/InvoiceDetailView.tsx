import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Card, Spinner, PageHead } from '@/components/ui'
import '@/styles/factura-doc.css'
import {
  ApiError, getBranding, getEstado, getFactura, getDocumentBase64, dgiiLabel, isRechazo, formatApiDate,
} from '@/api'
import type { DocKind } from '@/api'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import type { Factura } from '@/types/domain'

/** Titulo del documento por tipo e-CF (mismo criterio que la representacion impresa). */
const TIPO_TITULO: Record<string, string> = {
  '31': 'Factura de Crédito Fiscal',
  '32': 'Factura de Consumo',
  '33': 'Nota de Débito',
  '34': 'Nota de Crédito',
  '41': 'Comprobante de Compras',
  '43': 'Gastos Menores',
  '44': 'Régimen Especial',
  '45': 'Gubernamental',
  '46': 'Comprobante de Exportación',
  '47': 'Pagos al Exterior',
}

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
  // Logo del tenant para el encabezado del documento (misma clave que Configuración).
  const { data: branding } = useApiQuery(['branding'], getBranding)

  const [docBusy, setDocBusy] = useState<DocKind | null>(null)

  // Si el estado DGII pasa a un rechazo, refrescar los stats (la secuencia pudo
  // liberarse). Hooks ANTES del early return (rules-of-hooks).
  const prevEstadoRef = useRef<string | null>(null)
  useEffect(() => {
    const raw = estado.data?.estado_dgii ?? f?.estadoDgiiRaw ?? null
    if (raw && raw !== prevEstadoRef.current) {
      prevEstadoRef.current = raw
      if (isRechazo(raw)) {
        void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })
      }
    }
  }, [estado.data, f, queryClient])

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
    <div className="page fx-desk">
      <div className="row" style={{ marginBottom: 14 }}>
        <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => nav('facturas')}>Facturación</Btn>
      </div>

      {rechazado && (
        <div className="card card-pad" style={{ maxWidth: 1040, margin: '0 auto 14px', background: 'var(--danger-soft)', borderColor: 'transparent' }}>
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

      {/* Estado DGII: metadato del documento, no parte del comprobante impreso. */}
      <div className="fx-estado-band fx-estado-band--fuera">
        <span className="fx-estado-dato">
          {estado.loading
            ? <Spinner />
            : estadoRaw
              ? <EstadoBadge estado={dgiiLabel(estadoRaw)} />
              : <span className="muted-3">Estado no disponible</span>}
        </span>
        {estadoRaw && <span className="fx-estado-dato">DGII <b>{estadoRaw}</b></span>}
        <span className="fx-estado-dato">Track <b>{estadoData?.track_id ?? f.trackId ?? '—'}</b></span>
        {f.codigoSeguridad && <span className="fx-estado-dato">Cód. seguridad <b>{f.codigoSeguridad}</b></span>}
        <Btn variant="ghost" size="sm" icon="refresh-cw" onClick={estado.reload} aria-label="Actualizar estado">
          Actualizar
        </Btn>
      </div>

      <article className="fx-sheet fx-sheet--ancha">
        {/* --- Emisor + identificación del comprobante --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisor?.razon_social ?? '—'}</div>
            {emisorDireccion && <div className="fx-emisor-line">{emisorDireccion}</div>}
            {(emisor?.telefono || emisor?.correo) && (
              <div className="fx-emisor-line">{[emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')}</div>
            )}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {emisor.rnc}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Comprobante fiscal electrónico</span>
            <div className="fx-doc-title">{TIPO_TITULO[f.tipo] ?? `e-CF ${f.tipo}`}</div>
            <span className="fx-numero">{f.ncf}</span>
            <span className="fx-aviso fx-aviso--suave">Emitido el {fecha}</span>
          </div>
        </header>

        <div className="fx-rule" />

        {/* --- Comprador y condiciones --- */}
        <section className="fx-partes">
          <div>
            <span className="fx-eyebrow">Facturado a</span>
            <div className="fx-parte-nombre">{clienteNombre}</div>
            {clienteRnc && <div className="fx-parte-linea mono">RNC {clienteRnc}</div>}
            {clienteContacto && <div className="fx-parte-linea">{clienteContacto}</div>}
            {cliente?.direccion && <div className="fx-parte-linea">{cliente.direccion}</div>}
          </div>
          <div>
            <span className="fx-eyebrow">Condiciones</span>
            <div className="fx-parte-nombre" style={{ fontSize: 13.5 }}>{f.metodo}</div>
            <div className="fx-parte-linea">Moneda: peso dominicano (DOP)</div>
          </div>
        </section>

        {/* --- Líneas --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ver fx-items-head">
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span style={{ textAlign: 'right' }}>ITBIS</span>
            <span style={{ textAlign: 'right' }}>Importe</span>
          </div>

          {detalle.loading ? (
            <div className="row" style={{ justifyContent: 'center', padding: 24 }}><Spinner /></div>
          ) : items.length > 0 ? (
            items.map((l, i) => (
              <div className="fx-grid-ver fx-row" key={i}>
                <div className="fx-desc">
                  <span className="cell-main">{l.description || `Línea ${i + 1}`}</span>
                  {l.indicador_facturacion != null && IND_FACT_LABEL[l.indicador_facturacion] && (
                    <div className="fx-linea-tasa">{IND_FACT_LABEL[l.indicador_facturacion]}</div>
                  )}
                </div>
                <span className="fx-num fx-cell" data-label="Cant.">{Number(l.quantity ?? 0)}</span>
                <span className="fx-num fx-cell" data-label="Precio"><Money value={Number(l.amount ?? 0)} cur={false} /></span>
                <span className="fx-num fx-cell" data-label="ITBIS"><Money value={Number(l.itbis_amount ?? 0)} cur={false} /></span>
                <span className="fx-importe fx-cell" data-label="Importe">
                  <Money value={Number(l.subtotal ?? l.amount ?? 0)} cur={false} />
                </span>
              </div>
            ))
          ) : (
            <div className="text-sm muted" style={{ padding: '10px 0' }}>Detalle de líneas no disponible.</div>
          )}
        </section>

        {/* --- Totales --- */}
        <section className="fx-totales">
          <div className="fx-totales-box">
            <div className="fx-total-linea">
              <span>Subtotal gravado</span><span><Money value={subtotalGravado} cur={false} /></span>
            </div>
            {montoExento > 0 && (
              <div className="fx-total-linea">
                <span>Exento</span><span><Money value={montoExento} cur={false} /></span>
              </div>
            )}
            <div className="fx-total-linea">
              <span>ITBIS</span><span><Money value={itbisTotal} cur={false} /></span>
            </div>
            <div className="fx-total-final">
              <span>Total</span><span><Money value={total} cur={false} /></span>
            </div>
          </div>
        </section>

        <footer className="fx-nota">
          Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar fx-bar--ancha">
        <div className="fx-bar-total">
          <span className="text-sm muted">{items.length} {items.length === 1 ? 'línea' : 'líneas'}</span>
          <b><Money value={total} cur={false} /></b>
        </div>
        <div className="row gap-sm">
          <Btn variant="secondary" icon="download" onClick={() => openDoc('pdf')} disabled={id == null || docBusy === 'pdf'}>
            {docBusy === 'pdf' ? 'Abriendo…' : 'Ver PDF'}
          </Btn>
          <Btn variant="secondary" icon="code" onClick={() => openDoc(isRfce ? 'xml-rfce' : 'xml', true)} disabled={id == null || docBusy != null}>
            XML firmado
          </Btn>
          {isRfce && (
            <Btn variant="ghost" icon="code" onClick={() => openDoc('xml-rfce', true)} disabled={id == null || docBusy != null}>
              XML RFCE
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}

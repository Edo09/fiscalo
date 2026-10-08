import { useState, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, EstadoBadge, Card, Spinner, PageHead } from '@/components/ui'
import '@/styles/factura-doc.css'
import {
  ApiError, getBranding, getEstado, getFactura, getDocumentBase64, dgiiLabel, isRechazo, formatApiDate, mapFacturaRow,
} from '@/api'
import type { DocKind, FacturaItemRow, FormatoImpresion } from '@/api'
import { presentDocument } from '@/lib/file'
import { aNumero, fmtCantidad, fmtPrecio } from '@/lib/format'
import { useAnchoTirilla } from '@/stores/impresora'
import { imprimirRecibo } from './imprimirRecibo'
import { lineaQueCuadra, r2, type ItemFirmado } from './montosLinea'
import { anuladaPor, filasRelacionadas } from './notasVinculadas'
import { useApiQuery } from '@/hooks/useApiQuery'
import { staleTimeFor } from '@/config/cache'
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

/**
 * Lee los Item de DetallesItems del e-CF firmado, en su orden, con los montos
 * que usa lineaQueCuadra (CantidadItem, PrecioUnitarioItem y MontoItem). null
 * si no hay XML o no se deja leer: entonces se deriva de la fila.
 */
function itemsFirmados(xml: string | null | undefined): ItemFirmado[] | null {
  if (!xml) return null
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return null
    const detalles = doc.getElementsByTagName('DetallesItems')[0]
    if (!detalles) return null
    const num = (item: Element, tag: string): number | null => {
      const t = item.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
      const n = Number(t)
      return t !== '' && Number.isFinite(n) ? n : null
    }
    // Solo los Item hijos directos de DetallesItems, en su orden (= NumeroLinea).
    return Array.from(detalles.childNodes)
      .filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === 'Item')
      .map((el) => ({
        cantidad: num(el, 'CantidadItem'), precio: num(el, 'PrecioUnitarioItem'), monto: num(el, 'MontoItem'),
      }))
  } catch {
    return null
  }
}

/**
 * Cantidad y precio que se muestran de cada línea, de modo que cantidad ×
 * precio − descuento dé su importe. Las filas de antes de la migración 025
 * guardaron la cantidad como entero y el precio con 2 decimales, y la hoja decía
 * "3 × 84.75 = 254.24". Manda lo firmado ante la DGII: el XML trae los valores
 * exactos, y sus Item van en el orden de las filas (solo si son tantos como
 * ellas). Sin XML, se deriva lo que explica el importe con la misma regla que
 * la representación impresa (lineaQueCuadra en modo 'ecf' =
 * EcfDocumento::resolverLinea con MODO_ECF): la pantalla dice lo del papel.
 */
function lineasImpresas(items: FacturaItemRow[], xml: string | null | undefined) {
  const firmados = itemsFirmados(xml)
  const delXml = firmados != null && firmados.length === items.length ? firmados : null
  const conItbis = preciosIncluyenItbis(xml)
  return items.map((l, i) => {
    const descuento = aNumero(l.descuento_monto)
    const base = l.subtotal == null || l.subtotal === '' ? null : aNumero(l.subtotal)
    // Con precios con ITBIS (ventas del POS) subtotal guarda la base sin ITBIS,
    // que es lo que suman los reportes: el importe de la línea es el MontoItem
    // firmado, base + ITBIS. Igual que EcfDocumento::conItbisEnValor.
    const importe = base != null && conItbis ? r2(base + aNumero(l.itbis_amount)) : base
    // Sin cantidad cuenta 1, como en el backend.
    const { cantidad, precio } = lineaQueCuadra(
      aNumero(l.quantity ?? 1), aNumero(l.amount), importe, descuento, 'ecf', delXml?.[i] ?? null,
    )
    return { cantidad, precio, descuento, importe }
  })
}

/**
 * IndicadorMontoGravado = 1 en el e-CF firmado: los precios y el MontoItem de
 * cada línea traen el ITBIS adentro. Mismo criterio que
 * EcfDocumento::preciosIncluyenItbis en el backend.
 */
function preciosIncluyenItbis(xml: string | null | undefined): boolean {
  return xml != null && /<IndicadorMontoGravado>\s*1\s*<\/IndicadorMontoGravado>/.test(xml)
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

  // La clave distingue los dos PDF (carta y tirilla): con solo el DocKind los
  // dos botones mostraban "Abriendo…" a la vez.
  const [docBusy, setDocBusy] = useState<DocKind | 'pdf-pos' | null>(null)
  // Comprobante relacionado (nota o factura modificada) que se está abriendo.
  const [abriendo, setAbriendo] = useState<number | null>(null)
  const anchoTirilla = useAnchoTirilla()

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

  // Parsear el XML firmado no es gratis: solo cuando cambia el detalle.
  const impresas = useMemo(
    () => lineasImpresas(detalle.data?.items ?? [], detalle.data?.xml_firmado),
    [detalle.data],
  )

  // Marca del documento en pantalla: cambia al pasar a otro (la vista no tiene
  // key en App y sigue montada) y queda en null al salir. Al terminar de pedir un
  // relacionado solo se navega si la marca es la misma: el usuario no volvió al
  // listado ni abrió otro. Un objeto y no el id: un documento sin facturaId
  // (null) no se confunde con "ya salió".
  const enPantalla = useRef<object | null>(null)
  useEffect(() => {
    enPantalla.current = {}
    return () => { enPantalla.current = null }
  }, [id])

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
  const total = aNumero(det?.total ?? f.total)
  // ITBIS y subtotal son a nivel de factura (el backend no los desglosa por línea).
  const itbisTotal = aNumero(det?.total_itbis ?? f.itbis ?? 0)
  const subtotalGravado = aNumero(det?.monto_gravado ?? f.subtotal ?? 0)
  const montoExento = aNumero(det?.monto_exento ?? 0)
  const fecha = det?.fecha_emision_dgii ? formatApiDate(det.fecha_emision_dgii) : f.fecha
  // Notas que modifican este comprobante y, si es una nota, lo que modifica. Del
  // detalle cuando llega; mientras, de la fila del listado (sale al instante).
  const vinculos = det ? mapFacturaRow(det) : f
  const relacionadas = filasRelacionadas(vinculos)
  const anulacion = anuladaPor(vinculos.notas)

  // Abre otro comprobante como lo abre el listado: con su fila completa. Se pide
  // con la misma clave que usa esta vista, así el detalle ya llega en caché.
  const abrirRelacionado = async (docId: number) => {
    if (abriendo != null) return
    const desde = enPantalla.current
    const sigueAqui = () => desde != null && enPantalla.current === desde
    setAbriendo(docId)
    try {
      const key = ['facturas', 'detail', docId]
      const fila = await queryClient.fetchQuery({ queryKey: key, queryFn: () => getFactura(docId), staleTime: staleTimeFor(key) })
      // Se fue mientras cargaba: no arrastrarlo de vuelta ni apilar historial.
      if (!sigueAqui()) return
      if (fila) nav('factura-ver', mapFacturaRow(fila))
      else toast.error('No encontramos ese comprobante. Puede que se haya eliminado.')
    } catch (e) {
      if (sigueAqui()) toast.error(e instanceof ApiError ? e.message : 'No se pudo abrir el comprobante.')
    } finally {
      setAbriendo(null)
    }
  }

  const openDoc = async (kind: DocKind, download = false, formato: FormatoImpresion = 'carta') => {
    if (id == null) return
    const esPos = kind === 'pdf' && formato === 'pos'
    setDocBusy(esPos ? 'pdf-pos' : kind)
    const tid = toast.loading(
      kind !== 'pdf' ? 'Obteniendo XML…' : esPos ? 'Generando recibo…' : 'Generando PDF…',
    )
    try {
      // La tirilla va derecho al diálogo de impresión: es lo que se entrega en
      // mostrador, no algo que se abra para leer.
      if (esPos) {
        const impreso = await imprimirRecibo({ tipo: 'factura', id })
        toast.success(
          impreso ? 'Recibo enviado a la impresora.' : 'Recibo abierto: imprímelo con Ctrl+P.',
          { id: tid },
        )
      } else {
        const doc = await getDocumentBase64(id, kind, formato)
        presentDocument(doc, { download })
        toast.success(download ? `Descargado ${doc.filename}.` : `Documento ${doc.filename} listo.`, { id: tid })
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo obtener el documento.', { id: tid })
    } finally {
      setDocBusy(null)
    }
  }

  return (
    <div className="page fx-desk">
      <div className="row" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('facturas')}>Facturación</Btn>
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

      {/* Notas de crédito/débito que lo modifican, o lo que modifica si es una
          nota. Fuera del papel: no es parte del comprobante impreso. */}
      {relacionadas.length > 0 && (
        <div style={{ maxWidth: 1040, margin: '0 auto 12px' }}>
          <Card
            noPad
            title="Comprobantes relacionados"
            sub={anulacion
              ? <span style={{ color: 'var(--danger)' }}>Anulada por la nota de crédito {anulacion.ncf}</span>
              : undefined}
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Relación</th><th>Comprobante</th><th>Propósito</th><th>Fecha</th><th>Estado DGII</th>
                    <th className="num">Monto</th><th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {relacionadas.map((r) => {
                    const docId = r.id
                    const abrible = docId != null && docId !== id
                    const abrir = () => { if (docId != null && abrible) void abrirRelacionado(docId) }
                    return (
                      <tr
                        key={r.clave}
                        onClick={abrible ? abrir : undefined}
                        onKeyDown={abrible ? (e) => { if (e.key === 'Enter') abrir() } : undefined}
                        tabIndex={abrible ? 0 : undefined}
                        style={abrible ? undefined : { cursor: 'default' }}
                      >
                        <td className="fw6 text-sm">{r.relacion}</td>
                        <td>
                          <span className="mono text-sm fw6">{r.ncf}</span>
                          {r.clave === 'modifica' && (
                            <div className="cell-sub">
                              {r.tipo ? TIPO_TITULO[r.tipo] ?? `e-CF ${r.tipo}` : 'No registrado en Fiscalo'}
                            </div>
                          )}
                        </td>
                        <td className="text-sm">{r.proposito || <span className="muted-3">—</span>}</td>
                        <td className="muted text-sm">{formatApiDate(r.fecha)}</td>
                        <td>{r.estadoDgii ? <EstadoBadge estado={dgiiLabel(r.estadoDgii)} /> : <span className="muted-3">—</span>}</td>
                        <td className="num fw6">
                          {r.monto != null ? <Money value={r.monto} cur={false} /> : <span className="muted-3">—</span>}
                        </td>
                        <td>
                          {abriendo != null && abriendo === docId
                            ? <Spinner />
                            : abrible && <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

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
                {/* Cantidad sin ceros de relleno ("3", no "3.000") y precio con
                    sus 4 decimales si los tiene: Money lo cortaba a 2. */}
                <span className="fx-num fx-cell" data-label="Cant.">{fmtCantidad(impresas[i]?.cantidad ?? l.quantity)}</span>
                <span className="fx-num fx-cell" data-label="Precio"><span className="num">{fmtPrecio(impresas[i]?.precio ?? l.amount)}</span></span>
                <span className="fx-num fx-cell" data-label="ITBIS"><Money value={aNumero(l.itbis_amount)} cur={false} /></span>
                <span className="fx-importe fx-cell" data-label="Importe">
                  <Money value={impresas[i]?.importe ?? aNumero(l.subtotal ?? l.amount)} cur={false} />
                  {/* El importe ya viene neto del descuento: sin mostrarlo, la
                      línea no daba cantidad × precio. */}
                  {(impresas[i]?.descuento ?? 0) > 0 && (
                    <span className="fx-contador" style={{ display: 'block' }}>
                      Desc. −<Money value={impresas[i].descuento} cur={false} />
                    </span>
                  )}
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
          <Btn variant="secondary" icon="download" onClick={() => openDoc('pdf')} disabled={id == null || docBusy != null}>
            {docBusy === 'pdf' ? 'Abriendo…' : 'Ver PDF'}
          </Btn>
          {/* Mismo comprobante, papel de tirilla: lo que se entrega en mostrador. */}
          <Btn variant="secondary" icon="printer" onClick={() => openDoc('pdf', false, 'pos')} disabled={id == null || docBusy != null}>
            {docBusy === 'pdf-pos' ? 'Imprimiendo…' : `Imprimir recibo ${anchoTirilla} mm`}
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

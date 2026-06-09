import { useState } from 'react'
import { Icon, Btn, Money, Avatar, Card, Modal, PageHead, Spinner } from '@/components/ui'
import { DATA } from '@/data/mockData'
import {
  ApiError, DEFAULT_USER_ID, createFactura, listClients, previewFactura,
  mapClientRow, formatApiDate, dgiiLabel,
} from '@/api'
import type {
  CreateFacturaInput, FacturaItemInput, IndicadorFacturacion, TipoEcf,
} from '@/api'
import { presentDocument } from '@/lib/file'
import { useAsync } from '@/hooks/useAsync'
import type { Nav } from '@/app/navigation'
import type { Cliente, Producto, Factura } from '@/types/domain'

interface Linea {
  id: number
  prodId: string
  nombre: string
  cant: number
  precio: number
  desc: number
  itbis: number
  tipoItem: 'Bien' | 'Servicio'
}

type Toast = { type: 'ok' | 'err'; msg: string } | null

/** Deriva el indicador de facturación DGII desde la tasa de ITBIS del ítem. */
function indicadorFacturacion(itbis: number): IndicadorFacturacion {
  if (itbis === 18) return 1
  if (itbis === 16) return 2
  return 4 // 0% u otros -> exento en este formulario
}

/* FISCALO — Crear factura (emite contra POST /api/facturas) */
export function InvoiceFormView({ nav }: { nav: Nav }) {
  const D = DATA
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [clienteOpen, setClienteOpen] = useState(false)
  const [tipo, setTipo] = useState<TipoEcf>('32')
  const [metodo, setMetodo] = useState('Efectivo')
  const [obs, setObs] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([
    { id: 1, prodId: 'p1', nombre: 'Aceite Vegetal 1 Gal', cant: 10, precio: 485.0, desc: 0, itbis: 18, tipoItem: 'Bien' },
  ])
  const [prodPicker, setProdPicker] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [emitting, setEmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const clients = useAsync(() => listClients({ pageSize: 100 }), [])
  const clientesApi: Cliente[] = (clients.data?.items ?? []).map(mapClientRow)

  const addLinea = (p: Producto) => {
    setLineas([...lineas, {
      id: Date.now(), prodId: p.id, nombre: p.nombre, cant: 1,
      precio: p.precio, desc: 0, itbis: p.itbis,
      tipoItem: p.tipo === 'Servicio' ? 'Servicio' : 'Bien',
    }])
    setProdPicker(false)
  }
  const updLinea = (id: number, key: keyof Linea, val: number) =>
    setLineas(lineas.map((l) => (l.id === id ? { ...l, [key]: val } : l)))
  const delLinea = (id: number) => setLineas(lineas.filter((l) => l.id !== id))

  const calc = (l: Linea) => {
    const base = l.cant * l.precio * (1 - l.desc / 100)
    return { base, itbis: base * (l.itbis / 100) }
  }
  const subtotal = lineas.reduce((a, l) => a + calc(l).base, 0)
  const itbisTotal = lineas.reduce((a, l) => a + calc(l).itbis, 0)
  const descTotal = lineas.reduce((a, l) => a + l.cant * l.precio * (l.desc / 100), 0)
  const total = subtotal + itbisTotal

  const tipos: { code: TipoEcf; n: string }[] = [
    { code: '31', n: 'Crédito Fiscal' },
    { code: '32', n: 'Consumo' },
    { code: '34', n: 'Nota de Crédito' },
    { code: '33', n: 'Nota de Débito' },
  ]
  const metodos = ['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito 30 días', 'Cheque']

  /** Construye el payload mínimo para POST /api/facturas. */
  function buildPayload(): CreateFacturaInput | null {
    if (!cliente) {
      setToast({ type: 'err', msg: 'Selecciona un cliente para continuar.' })
      return null
    }
    if (lineas.length === 0) {
      setToast({ type: 'err', msg: 'Agrega al menos un producto o servicio.' })
      return null
    }
    if (tipo === '33' || tipo === '34') {
      setToast({ type: 'err', msg: `Las notas (e-CF ${tipo}) requieren un comprobante de referencia, aún no soportado en este formulario.` })
      return null
    }
    const items: FacturaItemInput[] = lineas.map((l, i) => ({
      numero_linea: i + 1,
      nombre_item: l.nombre,
      indicador_facturacion: indicadorFacturacion(l.itbis),
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
      cantidad: l.cant,
      unidad_medida: '43',
      precio_unitario: l.precio,
    }))
    return {
      client_id: Number(cliente.id),
      user_id: DEFAULT_USER_ID,
      tipo_ecf: tipo,
      tipo_pago: metodo === 'Efectivo' ? 1 : 2,
      indicador_monto_gravado: '1', // los precios del formulario excluyen ITBIS
      items,
    }
  }

  const emitir = async () => {
    const payload = buildPayload()
    if (!payload) return
    setEmitting(true)
    setToast(null)
    try {
      const res = await createFactura(payload)
      setToast({ type: 'ok', msg: `e-CF ${res.e_ncf} emitido (${dgiiLabel(res.estado_dgii)}).` })
      const created: Factura = {
        id: String(res.factura_id),
        facturaId: res.factura_id,
        ncf: res.e_ncf,
        tipo: res.tipo_ecf,
        cliente: cliente!.nombre,
        clienteId: cliente!.id,
        rnc: cliente!.doc,
        fecha: formatApiDate(res.fecha_emision_dgii),
        vence: '—',
        subtotal,
        itbis: itbisTotal,
        total: res.total,
        estado: 'Emitida',
        dgii: dgiiLabel(res.estado_dgii),
        metodo,
        trackId: res.track_id,
        codigoSeguridad: res.codigo_seguridad,
        estadoDgiiRaw: res.estado_dgii,
      }
      setTimeout(() => nav('factura-ver', created), 1200)
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof ApiError ? e.message : 'No se pudo emitir la factura.' })
    } finally {
      setEmitting(false)
    }
  }

  const previsualizar = async () => {
    if (!cliente) { setToast({ type: 'err', msg: 'Selecciona un cliente para la vista previa.' }); return }
    if (lineas.length === 0) { setToast({ type: 'err', msg: 'Agrega al menos un ítem.' }); return }
    setPreviewing(true)
    setToast(null)
    try {
      const items: FacturaItemInput[] = lineas.map((l, i) => ({
        numero_linea: i + 1,
        nombre_item: l.nombre,
        indicador_facturacion: indicadorFacturacion(l.itbis),
        indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
        cantidad: l.cant,
        unidad_medida: '43',
        precio_unitario: l.precio,
      }))
      const doc = await previewFactura({ client_id: Number(cliente.id), tipo_ecf: tipo, items })
      presentDocument(doc)
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.' })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead
        crumbs={[{ label: 'Facturación', onClick: () => nav('facturas') }, { label: 'Nueva factura' }]}
        title="Nueva factura"
        sub="Completa los datos y emite un comprobante fiscal electrónico."
        actions={
          <>
            <Btn variant="ghost" onClick={() => nav('facturas')}>Cancelar</Btn>
            <Btn variant="secondary" icon="eye" onClick={previsualizar} disabled={previewing}>
              {previewing ? 'Generando…' : 'Vista previa'}
            </Btn>
            <Btn variant="primary" icon="send" onClick={emitir} disabled={emitting}>
              {emitting ? 'Emitiendo…' : 'Emitir e-CF'}
            </Btn>
          </>
        }
      />

      {toast && (
        <div className="card card-pad row gap-sm" style={{ marginBottom: 14, background: toast.type === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)', borderColor: 'transparent', color: toast.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
          <Icon name={toast.type === 'ok' ? 'check-circle' : 'alert-circle'} size={16} /><span className="fw6 text-sm">{toast.msg}</span>
        </div>
      )}

      <div className="dash-grid">
        <div className="col gap-md">
          <Card title="Datos del comprobante">
            <div className="form-grid">
              <div className="field full">
                <label>Cliente <span className="req">*</span></label>
                {!cliente ? (
                  <div className="input row between" style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => setClienteOpen(true)}>
                    <span className="row gap-sm"><Icon name="user-plus" size={15} />Buscar cliente…</span>
                    <Icon name="chevron-down" size={15} />
                  </div>
                ) : (
                  <div className="input row between" style={{ cursor: 'pointer', height: 'auto', padding: '8px 11px' }} onClick={() => setClienteOpen(true)}>
                    <span className="row gap-sm"><Avatar name={cliente.nombre} size={28} /><span className="col"><span className="fw6 text-sm">{cliente.nombre}</span><span className="text-xs muted mono">{cliente.doc || 'sin RNC'}</span></span></span>
                    <Icon name="chevron-down" size={15} />
                  </div>
                )}
              </div>
              <div className="field">
                <label>Tipo de comprobante</label>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEcf)}>
                  {tipos.map((t) => <option key={t.code} value={t.code}>e-CF {t.code} · {t.n}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Método de pago</label>
                <select className="select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                  {metodos.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <Card title="Productos y servicios" noPad
            actions={<Btn variant="secondary" size="sm" icon="plus" onClick={() => setProdPicker(true)}>Agregar línea</Btn>}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ minWidth: 200 }}>Descripción</th><th className="num" style={{ width: 80 }}>Cant.</th>
                    <th className="num" style={{ width: 120 }}>Precio</th><th className="num" style={{ width: 80 }}>Desc%</th>
                    <th className="num" style={{ width: 70 }}>ITBIS</th><th className="num" style={{ width: 120 }}>Importe</th><th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id} style={{ cursor: 'default' }}>
                      <td><span className="cell-main">{l.nombre}</span><div className="cell-sub">{l.tipoItem}</div></td>
                      <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 64 }} type="number" value={l.cant} onChange={(e) => updLinea(l.id, 'cant', +e.target.value || 0)} /></td>
                      <td><input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.precio} onChange={(e) => updLinea(l.id, 'precio', +e.target.value || 0)} /></td>
                      <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 64 }} type="number" value={l.desc} onChange={(e) => updLinea(l.id, 'desc', +e.target.value || 0)} /></td>
                      <td className="num muted">{l.itbis}%</td>
                      <td className="num fw6"><Money value={calc(l).base} cur={false} /></td>
                      <td><Btn variant="ghost" size="sm" icon="trash-2" onClick={() => delLinea(l.id)} /></td>
                    </tr>
                  ))}
                  {lineas.length === 0 && (
                    <tr style={{ cursor: 'default' }}><td colSpan={7}><div className="state" style={{ padding: 28 }}><span className="text-sm muted">Sin líneas. Agrega un producto o servicio.</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
              <Btn variant="ghost" size="sm" icon="plus" onClick={() => setProdPicker(true)}>Agregar producto</Btn>
            </div>
          </Card>

          <Card title="Observaciones">
            <textarea className="textarea" placeholder="Notas internas o mensaje para el cliente (opcional)…" value={obs} onChange={(e) => setObs(e.target.value)}></textarea>
          </Card>
        </div>

        <div className="col gap-md" style={{ position: 'sticky', top: 16 }}>
          <Card title="Resumen">
            <div className="col gap-sm">
              <div className="row between text-sm"><span className="muted">Subtotal</span><Money value={subtotal} cur={false} /></div>
              <div className="row between text-sm"><span className="muted">Descuentos</span><span className="num" style={{ color: descTotal > 0 ? 'var(--danger)' : 'inherit' }}>{descTotal > 0 ? '−' : ''}<Money value={descTotal} cur={false} /></span></div>
              <div className="row between text-sm"><span className="muted">ITBIS (18%)</span><Money value={itbisTotal} cur={false} /></div>
              <div className="divider" style={{ margin: '6px 0' }}></div>
              <div className="row between" style={{ fontSize: 19, fontWeight: 700 }}><span>Total</span><Money value={total} /></div>
            </div>
            <div className="text-xs muted-3 mt-sm">Totales estimados. El monto fiscal definitivo lo calcula el backend al emitir.</div>
            <Btn variant="primary" icon="send" className="mt-md" style={{ width: '100%' }} onClick={emitir} disabled={emitting}>{emitting ? 'Emitiendo…' : 'Emitir e-CF'}</Btn>
            <Btn variant="secondary" icon="eye" className="mt-sm" style={{ width: '100%' }} onClick={previsualizar} disabled={previewing}>Vista previa</Btn>
          </Card>

          <Card>
            <div className="row gap-sm mb-sm"><Icon name="shield-check" size={16} style={{ color: 'var(--success)' }} /><span className="fw6 text-sm">Emisión a la DGII</span></div>
            <div className="col gap-sm text-sm muted">
              <div className="row gap-sm"><Icon name="check" size={14} style={{ color: 'var(--success)' }} />Secuencia e-NCF asignada por el backend</div>
              <div className="row gap-sm"><Icon name="check" size={14} style={{ color: 'var(--success)' }} />Firma y envío automáticos</div>
              <div className="row gap-sm"><Icon name="check" size={14} style={{ color: 'var(--success)' }} />Estado consultable tras emitir</div>
            </div>
          </Card>
        </div>
      </div>

      {clienteOpen && (
        <Modal title="Seleccionar cliente" sub="Clientes registrados en el sistema" icon="users" onClose={() => setClienteOpen(false)}
          footer={<><Btn variant="ghost" onClick={() => setClienteOpen(false)}>Cancelar</Btn></>}>
          {clients.loading ? (
            <div className="row" style={{ justifyContent: 'center', padding: 28 }}><Spinner /></div>
          ) : clients.error ? (
            <div className="state" style={{ padding: 28 }}><span className="text-sm" style={{ color: 'var(--danger)' }}>{clients.error}</span></div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -8px' }}>
              {clientesApi.length === 0 && <div className="state" style={{ padding: 28 }}><span className="text-sm muted">No hay clientes.</span></div>}
              {clientesApi.map((c) => (
                <div key={c.id} className="menu-item" style={{ padding: '9px 8px' }} onClick={() => { setCliente(c); setClienteOpen(false) }}>
                  <Avatar name={c.nombre} size={30} />
                  <div style={{ flex: 1 }}><div className="fw6 text-sm">{c.nombre}</div><div className="text-xs muted mono">{c.tipo}: {c.doc || '—'}</div></div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {prodPicker && (
        <Modal title="Agregar producto o servicio" icon="package" onClose={() => setProdPicker(false)}>
          <div className="search-input mb-md" style={{ width: '100%' }}><Icon name="search" /><input placeholder="Buscar en el catálogo…" autoFocus /></div>
          <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -8px' }}>
            {D.productos.map((p) => (
              <div key={p.id} className="menu-item" style={{ padding: '9px 8px' }} onClick={() => addLinea(p)}>
                <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 32, height: 32 }}><Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} /></span>
                <div style={{ flex: 1 }}><div className="fw6 text-sm">{p.nombre}</div><div className="text-xs muted mono">{p.sku} · {p.cat}</div></div>
                <span className="fw6 text-sm"><Money value={p.precio} cur={false} /></span>
              </div>
            ))}
          </div>
          <div className="text-xs muted-3 mt-sm">Catálogo local (sin endpoint de productos en la API).</div>
        </Modal>
      )}
    </div>
  )
}

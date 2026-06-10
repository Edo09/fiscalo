import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon, Btn, Money, Card, Modal, PageHead, Switch, Spinner } from '@/components/ui'
import {
  ApiError, DEFAULT_USER_ID, createFactura, previewFactura, getStats,
  listProducts, mapProductRow, formatApiDate, dgiiLabel,
} from '@/api'
import type {
  CreateFacturaInput, FacturaItemInput, IndicadorFacturacion, TipoEcf, StatsSecuencia,
} from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession } from '@/auth/useSession'
import type { Nav } from '@/app/navigation'
import type { Cliente, Producto, Factura } from '@/types/domain'

interface Linea {
  id: number
  prodId: string
  nombre: string
  cant: number
  precio: number
  desc: number
  /** El producto define si el ítem es gravado con ITBIS (true) o no (false). */
  gravado: boolean
  tipoItem: 'Bien' | 'Servicio'
}

type Toast = { type: 'ok' | 'err'; msg: string } | null

/** Tasa de ITBIS aplicada a un ítem gravado (los exentos van a 0%). */
const ITBIS_RATE = 0.18

/**
 * Indicador de facturación DGII según si el ítem es gravado o no:
 * gravado => ITBIS 18% (1); no gravado => Exento (4).
 */
function indicadorFacturacion(gravado: boolean): IndicadorFacturacion {
  return gravado ? 1 : 4
}

/**
 * e-NCF que el backend asignará a continuación para un tipo, derivado de
 * /api/facturas/stats. `secuencia_actual` es el ÚLTIMO número asignado, así que
 * el próximo es +1, con 10 dígitos a la derecha del prefijo (ej. E320000000009).
 */
function nextENcf(tipo: TipoEcf, secuencias?: StatsSecuencia[]): string | null {
  const seq = secuencias?.find((s) => s.type === `E${tipo}`)
  if (!seq) return null
  const next = (seq.secuencia_actual ?? 0) + 1
  return `E${tipo}${String(next).padStart(10, '0')}`
}

/* FISCALO — Crear factura (emite contra POST /api/facturas) */
export function InvoiceFormView({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [tipo, setTipo] = useState<TipoEcf>('32')
  const [metodo, setMetodo] = useState('Efectivo')
  const [obs, setObs] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([
    { id: 1, prodId: 'p1', nombre: 'Aceite Vegetal 1 Gal', cant: 10, precio: 485.0, desc: 0, gravado: true, tipoItem: 'Bien' },
  ])
  const [prodPicker, setProdPicker] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [emitting, setEmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  // Secuencias e-CF del ambiente activo, para mostrar el próximo e-NCF a usar.
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const proximoNcf = nextENcf(tipo, stats.data?.secuencias)

  // Catálogo de productos (GET /api/products) para el selector de líneas.
  // Misma clave que ProductsView => caché compartida, una sola petición.
  const productos = useApiQuery(['products', 'list'], () => listProducts({ pageSize: 100 }))
  const [prodQuery, setProdQuery] = useState('')
  const catalogo = (productos.data?.items ?? []).map(mapProductRow)
  const catalogoFiltrado = catalogo.filter((p) =>
    `${p.nombre} ${p.sku} ${p.cat}`.toLowerCase().includes(prodQuery.trim().toLowerCase()),
  )

  const addLinea = (p: Producto) => {
    setLineas([...lineas, {
      id: Date.now(), prodId: p.id, nombre: p.nombre, cant: 1,
      // El producto define el gravamen por defecto (itbis > 0 => gravado).
      precio: p.precio, desc: 0, gravado: p.itbis > 0,
      tipoItem: p.tipo === 'Servicio' ? 'Servicio' : 'Bien',
    }])
    setProdPicker(false)
  }
  const updLinea = (id: number, key: keyof Linea, val: number) =>
    setLineas(lineas.map((l) => (l.id === id ? { ...l, [key]: val } : l)))
  const setGravado = (id: number, gravado: boolean) =>
    setLineas(lineas.map((l) => (l.id === id ? { ...l, gravado } : l)))
  const delLinea = (id: number) => setLineas(lineas.filter((l) => l.id !== id))

  const calc = (l: Linea) => {
    const base = l.cant * l.precio * (1 - l.desc / 100)
    return { base, itbis: l.gravado ? base * ITBIS_RATE : 0 }
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
      indicador_facturacion: indicadorFacturacion(l.gravado),
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
      cantidad: l.cant,
      unidad_medida: '43',
      precio_unitario: l.precio,
    }))
    return {
      client_id: Number(cliente.id),
      // Emisor = usuario autenticado (id del login). Fallback al .env por si acaso.
      user_id: user?.id ?? DEFAULT_USER_ID,
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
      // Invalida listados y stats de facturas (la secuencia e-NCF avanzó).
      void queryClient.invalidateQueries({ queryKey: ['facturas'] })
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
        indicador_facturacion: indicadorFacturacion(l.gravado),
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
                <ClientCombobox value={cliente} onChange={setCliente} />
              </div>
              <div className="field">
                <label>Tipo de comprobante</label>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEcf)}>
                  {tipos.map((t) => <option key={t.code} value={t.code}>e-CF {t.code} · {t.n}</option>)}
                </select>
              </div>
              <div className="field">
                <label>e-NCF a asignar</label>
                <div className="input row gap-sm" style={{ alignItems: 'center', background: 'var(--surface-2)', cursor: 'default' }}>
                  <Icon name="hash" size={15} style={{ color: 'var(--text-3)' }} />
                  {stats.loading ? (
                    <span className="text-sm muted">Cargando…</span>
                  ) : proximoNcf ? (
                    <span className="mono fw6">{proximoNcf}</span>
                  ) : (
                    <span className="text-sm muted-3">{stats.error ? 'No disponible' : 'Sin secuencia'}</span>
                  )}
                </div>
                <div className="text-xs muted-3" style={{ marginTop: 4 }}>Próximo en la secuencia; el backend lo confirma al emitir.</div>
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
                    <th style={{ width: 124 }}>ITBIS</th><th className="num" style={{ width: 120 }}>Importe</th><th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id} style={{ cursor: 'default' }}>
                      <td><span className="cell-main">{l.nombre}</span><div className="cell-sub">{l.tipoItem}</div></td>
                      <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 64 }} type="number" value={l.cant} onChange={(e) => updLinea(l.id, 'cant', +e.target.value || 0)} /></td>
                      <td><input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.precio} onChange={(e) => updLinea(l.id, 'precio', +e.target.value || 0)} /></td>
                      <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 64 }} type="number" value={l.desc} onChange={(e) => updLinea(l.id, 'desc', +e.target.value || 0)} /></td>
                      <td>
                        <div className="row gap-sm" style={{ alignItems: 'center' }}>
                          <Switch on={l.gravado} onChange={(v) => setGravado(l.id, v)} />
                          <span className="text-xs muted">{l.gravado ? '18%' : 'Exento'}</span>
                        </div>
                      </td>
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

      {prodPicker && (
        <Modal title="Agregar producto o servicio" icon="package" onClose={() => setProdPicker(false)}>
          <div className="search-input mb-md" style={{ width: '100%' }}>
            <Icon name="search" />
            <input placeholder="Buscar en el catálogo…" value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} autoFocus />
          </div>
          {productos.loading ? (
            <div className="row" style={{ justifyContent: 'center', padding: 28 }}><Spinner /></div>
          ) : productos.error ? (
            <div className="state" style={{ padding: 28 }}><span className="text-sm" style={{ color: 'var(--danger)' }}>{productos.error}</span></div>
          ) : catalogoFiltrado.length === 0 ? (
            <div className="state" style={{ padding: 28 }}><span className="text-sm muted">{catalogo.length === 0 ? 'No hay productos en el catálogo.' : 'Sin resultados.'}</span></div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -8px' }}>
              {catalogoFiltrado.map((p) => (
                <div key={p.id} className="menu-item" style={{ padding: '9px 8px' }} onClick={() => addLinea(p)}>
                  <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 32, height: 32 }}><Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} /></span>
                  <div style={{ flex: 1 }}><div className="fw6 text-sm">{p.nombre}</div><div className="text-xs muted mono">{p.sku || '—'} · {p.cat}</div></div>
                  <span className="fw6 text-sm"><Money value={p.precio} cur={false} /></span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

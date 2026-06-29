import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Modal, PageHead, Spinner, Switch } from '@/components/ui'
import {
  ApiError, DEFAULT_USER_ID, createFactura, previewFactura, getStats, getClient,
  listProducts, mapClientRow, mapProductRow, formatApiDate, dgiiLabel,
} from '@/api'
import type {
  CreateFacturaInput, FacturaItemInput, IndicadorFacturacion, TipoEcf, StatsSecuencia,
} from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession } from '@/stores/auth'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto, Factura, FacturaPrefill } from '@/types/domain'
import { facturaFormSchema, mapFormIssues, emptyFormErrors, type FacturaFormErrors } from './factura.schema'

interface Linea {
  id: number
  prodId: string
  /** Nombre corto del ítem (DGII máx. 80 caracteres). */
  nombre: string
  /** Detalle largo opcional (DGII máx. 1000): material, medidas, color, etc. */
  descripcion: string
  cant: number
  precio: number
  desc: number
  /** Indicador de facturación DGII (1=18%, 2=16%, 3=tasa cero, 4=exento). */
  indFact: IndicadorFacturacion
  /** Código DGII de unidad de medida (id del catálogo; 43 = Unidad). */
  unidadMedida: number
  tipoItem: 'Bien' | 'Servicio'
}

/** Opciones de indicador de facturación DGII (tasa de ITBIS por línea). */
const IND_FACT_OPCIONES: { value: IndicadorFacturacion; label: string }[] = [
  { value: 1, label: '18%' },
  { value: 2, label: '16%' },
  { value: 3, label: 'Tasa 0%' },
  { value: 4, label: 'Exento' },
]

/** Tasa de ITBIS según indicador_facturacion: 1=18%, 2=16%, 3 y 4 = 0%. */
function itbisRate(ind: IndicadorFacturacion): number {
  return ind === 1 ? 0.18 : ind === 2 ? 0.16 : 0
}

/** Deriva el indicador desde la tasa de ITBIS del producto (18→1, 16→2, resto→exento). */
function indFactFromItbis(itbis: number): IndicadorFacturacion {
  return itbis === 18 ? 1 : itbis === 16 ? 2 : 4
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

/* FISCALO — Crear factura (emite contra POST /api/facturas).
   `prefill` permite llegar con cliente y líneas precargados (ej. al convertir
   una cotización); todo sigue siendo editable antes de emitir. */
export function InvoiceFormView({ nav, prefill = null }: { nav: Nav; prefill?: FacturaPrefill | null }) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const [cliente, setCliente] = useState<Cliente | null>(() =>
    prefill && prefill.clienteId
      ? {
          id: prefill.clienteId, nombre: prefill.clienteNombre || `Cliente #${prefill.clienteId}`,
          contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
          balance: 0, facturas: 0, estado: '', desde: '',
        }
      : null,
  )
  const [tipo, setTipo] = useState<TipoEcf>('32')
  const [metodo, setMetodo] = useState('Efectivo')
  const [obs, setObs] = useState('')
  // ¿Los precios de las líneas YA incluyen ITBIS? Las cotizaciones se cotizan
  // con impuesto incluido, así que al convertir arranca en true (editable).
  // Mapea a indicador_monto_gravado: true => "0" (incluido), false => "1" (excluido).
  const [precioConItbis, setPrecioConItbis] = useState(prefill != null)
  const [lineas, setLineas] = useState<Linea[]>(() =>
    (prefill?.lineas ?? []).map((l, i) => ({
      id: i + 1, prodId: '', nombre: l.nombre, descripcion: '', cant: l.cantidad, precio: l.precio,
      // La cotización no distingue ITBIS ni unidad: default gravado 18% / Unidad (43).
      desc: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
    })),
  )
  const [prodPicker, setProdPicker] = useState(false)
  const [emitting, setEmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [errors, setErrors] = useState<FacturaFormErrors>(emptyFormErrors)
  // Líneas con el campo de detalle (descripcion) desplegado. Se colapsa por
  // defecto para mantener la tabla compacta; la mayoría de líneas no lo necesitan.
  const [descOpen, setDescOpen] = useState<Set<number>>(() => new Set())
  const toggleDesc = (id: number) =>
    setDescOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // Mostrar el textarea de detalle si está desplegado o si ya trae contenido.
  const showDesc = (l: Linea) => l.descripcion.trim() !== '' || descOpen.has(l.id)

  // El prefill (cotización) solo trae id + nombre del cliente: se busca el
  // registro completo para que la ficha muestre el RNC real (E31 lo requiere).
  const prefillClientId = prefill?.clienteId ? Number(prefill.clienteId) : null
  const clienteEnriquecido = useRef(false)
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', prefillClientId],
    () => (prefillClientId ? getClient(prefillClientId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    if (!clienteEnriquecido.current && row && cliente && String(row.id) === cliente.id) {
      clienteEnriquecido.current = true
      setCliente(mapClientRow(row))
    }
  }, [clienteDetalle.data, cliente])

  // Secuencias e-CF del ambiente activo, para mostrar el próximo e-NCF a usar.
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const proximoNcf = nextENcf(tipo, stats.data?.secuencias)
  // Capacidad del rango DGII vigente para este tipo (null = sin límite registrado).
  const seqTipo = stats.data?.secuencias.find((s) => s.type === `E${tipo}`)
  const rangoRestantes = seqTipo?.restantes != null ? Number(seqTipo.restantes) : null

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
      id: Date.now(), prodId: p.id, nombre: p.nombre, descripcion: '', cant: 1,
      // El producto define el indicador y la unidad por defecto.
      precio: p.precio, desc: 0, indFact: indFactFromItbis(p.itbis),
      unidadMedida: p.unidadMedida || 43,
      tipoItem: p.tipo === 'Servicio' ? 'Servicio' : 'Bien',
    }])
    setProdPicker(false)
  }
  // Línea libre: una descripción sin producto del catálogo (como en un gasto).
  // El usuario escribe descripción, cantidad y precio; default gravado 18% / Unidad.
  const addLineaLibre = () =>
    setLineas([...lineas, {
      id: Date.now(), prodId: '', nombre: '', descripcion: '', cant: 1,
      precio: 0, desc: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
    }])
  // Limpia los errores en línea de una fila al editarla (o al eliminarla).
  const clearLineaErr = (id: number) =>
    setErrors((e) =>
      e.lineas[id]
        ? { ...e, lineas: Object.fromEntries(Object.entries(e.lineas).filter(([k]) => Number(k) !== id)) }
        : e,
    )
  const updLinea = (id: number, key: keyof Linea, val: number) => {
    setLineas(lineas.map((l) => (l.id === id ? { ...l, [key]: val } : l)))
    clearLineaErr(id)
  }
  const setNombre = (id: number, nombre: string) => {
    setLineas(lineas.map((l) => (l.id === id ? { ...l, nombre } : l)))
    clearLineaErr(id)
  }
  const setDescripcion = (id: number, descripcion: string) => {
    setLineas(lineas.map((l) => (l.id === id ? { ...l, descripcion } : l)))
    clearLineaErr(id)
  }
  const setIndFact = (id: number, indFact: IndicadorFacturacion) =>
    setLineas(lineas.map((l) => (l.id === id ? { ...l, indFact } : l)))
  const setUnidad = (id: number, unidadMedida: number) => {
    setLineas(lineas.map((l) => (l.id === id ? { ...l, unidadMedida } : l)))
    clearLineaErr(id)
  }
  const delLinea = (id: number) => {
    setLineas(lineas.filter((l) => l.id !== id))
    clearLineaErr(id)
  }

  const calc = (l: Linea) => {
    const bruto = l.cant * l.precio * (1 - l.desc / 100)
    const rate = itbisRate(l.indFact)
    if (precioConItbis) {
      // Precio con ITBIS incluido: se desglosa la base (bruto / 1.18) y el impuesto.
      const base = bruto / (1 + rate)
      return { base, itbis: bruto - base, importe: bruto }
    }
    return { base: bruto, itbis: bruto * rate, importe: bruto }
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
  // E32 (Consumo) y E43 (Gastos Menores) se pueden emitir sin cliente (consumidor
  // final); el resto sí lo requiere. Igual criterio que el backend.
  const requiereCliente = tipo !== '32' && tipo !== '43'

  /**
   * Valida el formulario con Zod (facturaFormSchema). Pinta errores en línea por
   * campo/línea y muestra un toast resumen. Devuelve true si el form es válido.
   */
  function validateForm(): boolean {
    const res = facturaFormSchema.safeParse({ cliente, tipo, lineas })
    if (!res.success) {
      setErrors(mapFormIssues(res.error, lineas))
      const n = res.error.issues.length
      toast.error(n === 1 ? 'Revisa 1 campo del formulario.' : `Revisa ${n} campos del formulario.`)
      return false
    }
    setErrors(emptyFormErrors())
    return true
  }

  /**
   * Mapea las líneas de la UI a items del payload e-CF. `nombre_item` (≤80) y
   * `descripcion` (≤1000) van separados y recortados; la descripción se omite si
   * está vacía. La longitud ya la garantiza la validación Zod (hard block).
   */
  function buildItems(): FacturaItemInput[] {
    return lineas.map((l, i) => ({
      numero_linea: i + 1,
      nombre_item: l.nombre.trim(),
      ...(l.descripcion.trim() ? { descripcion: l.descripcion.trim() } : {}),
      indicador_facturacion: l.indFact,
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
      cantidad: l.cant,
      unidad_medida: String(l.unidadMedida),
      precio_unitario: l.precio,
    }))
  }

  /** Construye el payload para POST /api/facturas (asume formulario ya validado). */
  function buildPayload(): CreateFacturaInput | null {
    // E32/E43 pueden emitirse sin cliente (consumidor final); el resto lo exige.
    if (!cliente && requiereCliente) return null
    const items = buildItems()
    return {
      // Sin cliente (E32/E43) se omite client_id: el backend factura a consumidor final.
      ...(cliente ? { client_id: Number(cliente.id) } : {}),
      // Emisor = usuario autenticado (id del login). Fallback al .env por si acaso.
      user_id: user?.id ?? DEFAULT_USER_ID,
      tipo_ecf: tipo,
      tipo_pago: metodo === 'Efectivo' ? 1 : 2,
      // "0" = el precio incluye ITBIS (DGII lo desglosa); "1" = se suma al precio.
      indicador_monto_gravado: precioConItbis ? '0' : '1',
      items,
    }
  }

  const emitir = async () => {
    if (emitting) return
    if (!validateForm()) return
    const payload = buildPayload()
    if (!payload) return
    setEmitting(true)
    // La emisión hace un viaje síncrono a la DGII: toast de progreso hasta resolver.
    const tid = toast.loading('Emitiendo e-CF a la DGII…')
    try {
      const res = await createFactura(payload)
      // Invalida listados y stats de facturas (la secuencia e-NCF avanzó).
      void queryClient.invalidateQueries({ queryKey: ['facturas'] })
      toast.success(`e-CF ${res.e_ncf} emitido (${dgiiLabel(res.estado_dgii)}).`, { id: tid })
      const created: Factura = {
        id: String(res.factura_id),
        facturaId: res.factura_id,
        ncf: res.e_ncf,
        tipo: res.tipo_ecf,
        cliente: cliente?.nombre ?? 'Consumidor final',
        clienteId: cliente?.id ?? '',
        rnc: cliente?.doc ?? '',
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
      // No se rehabilita el botón en éxito: queda deshabilitado (con spinner)
      // durante la ventana previa al redirect para evitar una segunda emisión.
      setTimeout(() => nav('factura-ver', created), 1200)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo emitir la factura.', { id: tid })
      setEmitting(false)
    }
  }

  const previsualizar = async () => {
    // validateForm ya exige cliente salvo en E32/E43 (consumidor final).
    if (!validateForm()) return
    setPreviewing(true)
    const tid = toast.loading('Generando vista previa…')
    try {
      const items = buildItems()
      const doc = await previewFactura({ ...(cliente ? { client_id: Number(cliente.id) } : {}), tipo_ecf: tipo, items })
      presentDocument(doc)
      toast.success('Vista previa generada.', { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.', { id: tid })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="page page-wide factura-new">
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

      {prefill?.origen && (
        <div className="card card-pad row gap-sm" style={{ marginBottom: 14, background: 'var(--info-soft)', borderColor: 'transparent', color: 'var(--info)' }}>
          <Icon name="file-plus" size={16} />
          <span className="fw6 text-sm">Convertida desde la cotización {prefill.origen}.</span>
          <span className="text-sm" style={{ opacity: 0.85 }}>
            Los precios vienen con ITBIS incluido (se desglosa, no se suma). Edita líneas, tipo e ITBIS libremente antes de emitir.
          </span>
        </div>
      )}

      <div className="dash-grid">
        <div className="col gap-md">
          <Card title="Datos del comprobante">
            <div className="form-grid">
              <div className={'field full' + (errors.cliente ? ' field-error' : '')}>
                <label>Cliente {requiereCliente ? <span className="req">*</span> : <span className="opt">(opcional)</span>}</label>
                <ClientCombobox value={cliente} onChange={(c) => { setCliente(c); if (errors.cliente) setErrors((e) => ({ ...e, cliente: undefined })) }} />
                {errors.cliente && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.cliente}</div>}
              </div>
              <div className={'field' + (errors.tipo ? ' field-error' : '')}>
                <label>Tipo de comprobante</label>
                <select className="select" value={tipo} onChange={(e) => { setTipo(e.target.value as TipoEcf); if (errors.tipo) setErrors((er) => ({ ...er, tipo: undefined })) }}>
                  {tipos.map((t) => <option key={t.code} value={t.code}>e-CF {t.code} · {t.n}</option>)}
                </select>
                {errors.tipo && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.tipo}</div>}
              </div>
              <div className="field">
                <label>e-NCF a asignar</label>
                {stats.loading ? (
                  <div className="ncf-callout" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <span className="ncf-ic" style={{ color: 'var(--text-3)' }}><Icon name="hash" size={15} /></span>
                    <span className="text-sm muted">Cargando secuencia…</span>
                  </div>
                ) : proximoNcf ? (
                  <div className="ncf-callout">
                    <span className="ncf-ic"><Icon name="hash" size={15} /></span>
                    <span className="ncf-meta">
                      <span className="ncf-lbl">Próximo comprobante</span>
                      <span className="ncf-num">{proximoNcf}</span>
                    </span>
                  </div>
                ) : (
                  <div className="ncf-callout" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <span className="ncf-ic" style={{ color: 'var(--text-3)' }}><Icon name="hash" size={15} /></span>
                    <span className="text-sm muted-3">{stats.error ? 'No disponible' : 'Sin secuencia'}</span>
                  </div>
                )}
                {rangoRestantes != null && rangoRestantes <= 10 ? (
                  <div className="row gap-sm text-xs" style={{ marginTop: 4, color: 'var(--danger)', alignItems: 'center' }}>
                    <Icon name="alert-triangle" size={13} />
                    <span>
                      {rangoRestantes === 0
                        ? 'Rango DGII agotado: solicita y registra el próximo rango para poder emitir.'
                        : `Quedan ${rangoRestantes} números en el rango DGII: solicita el próximo.`}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs muted-3" style={{ marginTop: 4 }}>Próximo en la secuencia; el backend lo confirma al emitir.</div>
                )}
              </div>
              <div className="field">
                <label>Método de pago</label>
                <select className="select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                  {metodos.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <label className={'field full opt-row' + (precioConItbis ? ' on' : '')} onClick={() => setPrecioConItbis(!precioConItbis)}>
                <Switch on={precioConItbis} onChange={setPrecioConItbis} />
                <span className="opt-txt">
                  <span className="text-sm fw6">Los precios incluyen ITBIS</span>
                  <span className="text-xs muted-3">
                    {precioConItbis
                      ? 'El ITBIS se desglosa del precio de cada línea (no se suma encima).'
                      : 'El ITBIS se calcula y se suma encima del precio de cada línea.'}
                  </span>
                </span>
              </label>
            </div>
          </Card>

          <Card title="Productos y servicios" noPad
            actions={
              <div className="row gap-sm">
                <Btn variant="secondary" size="sm" icon="package" onClick={() => setProdPicker(true)}>Producto</Btn>
                <Btn variant="secondary" size="sm" icon="file-plus" onClick={addLineaLibre}>Descripción</Btn>
              </div>
            }>
            <div className="line-list">
              {lineas.map((l, i) => {
                const le = errors.lineas[l.id]
                const c = calc(l)
                return (
                  <div key={l.id} className="line-card">
                    <div className="line-card-top">
                      <span className="line-num" aria-label={`Ítem ${i + 1}`}>#{i + 1}</span>
                      <div className={'line-name' + (le?.nombre || le?.descripcion ? ' field-error' : '')}>
                        <input
                          className="input line-input"
                          value={l.nombre}
                          placeholder="Nombre corto (ej. Sticker Vinyl 2x2)"
                          onChange={(e) => setNombre(l.id, e.target.value)}
                        />
                        <div className="row between" style={{ marginTop: 3, alignItems: 'center' }}>
                          <span className="row gap-sm" style={{ alignItems: 'center' }}>
                            {l.prodId !== '' && <span className="cell-sub">{l.tipoItem}</span>}
                            {!showDesc(l) ? (
                              <button type="button" className="line-detail-toggle" onClick={() => toggleDesc(l.id)}>+ Detalle</button>
                            ) : l.descripcion.trim() === '' ? (
                              <button type="button" className="line-detail-toggle" onClick={() => toggleDesc(l.id)}>− Ocultar</button>
                            ) : null}
                          </span>
                          <span className="text-xs" style={{ color: l.nombre.length > 80 ? 'var(--danger)' : 'var(--text-3)' }}>{l.nombre.length}/80</span>
                        </div>
                        {le?.nombre && <div className="err-msg"><Icon name="alert-circle" size={13} />{le.nombre}</div>}
                        {showDesc(l) && (
                          <>
                            <textarea
                              className="input line-input"
                              value={l.descripcion}
                              placeholder="Detalle: material, medidas, color, sucursal… (opcional)"
                              rows={2}
                              onChange={(e) => setDescripcion(l.id, e.target.value)}
                              style={{ height: 'auto', minHeight: 34, resize: 'vertical', lineHeight: 1.35, marginTop: 6 }}
                            />
                            {le?.descripcion && <div className="err-msg"><Icon name="alert-circle" size={13} />{le.descripcion}</div>}
                          </>
                        )}
                      </div>
                      <Btn variant="ghost" size="sm" icon="trash-2" onClick={() => delLinea(l.id)} />
                    </div>
                    <div className="line-fields">
                      <div className={'lf lf-cant' + (le?.cant ? ' field-error' : '')}>
                        <label>Cant.</label>
                        <input className="input line-input num" type="number" value={l.cant} onChange={(e) => updLinea(l.id, 'cant', +e.target.value || 0)} />
                        {le?.cant && <div className="err-msg">{le.cant}</div>}
                      </div>
                      <div className={'lf lf-unidad' + (le?.unidadMedida ? ' field-error' : '')}>
                        <label>Unidad</label>
                        <UnidadMedidaSelect className="select line-input" value={l.unidadMedida} onChange={(v) => setUnidad(l.id, v)} />
                        {le?.unidadMedida && <div className="err-msg">{le.unidadMedida}</div>}
                      </div>
                      <div className={'lf lf-precio' + (le?.precio ? ' field-error' : '')}>
                        <label>Precio</label>
                        <input className="input line-input num" type="number" value={l.precio} onChange={(e) => updLinea(l.id, 'precio', +e.target.value || 0)} />
                        {le?.precio && <div className="err-msg">{le.precio}</div>}
                      </div>
                      <div className={'lf lf-desc' + (le?.desc ? ' field-error' : '')}>
                        <label>Desc%</label>
                        <input className="input line-input num" type="number" value={l.desc} onChange={(e) => updLinea(l.id, 'desc', +e.target.value || 0)} />
                        {le?.desc && <div className="err-msg">{le.desc}</div>}
                      </div>
                      <div className="lf lf-itbis">
                        <label>ITBIS</label>
                        <select
                          className="select line-input"
                          value={l.indFact}
                          onChange={(e) => setIndFact(l.id, Number(e.target.value) as IndicadorFacturacion)}
                        >
                          {IND_FACT_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="lf lf-importe">
                        <label>Importe</label>
                        <div className="imp-cell">
                          <span className="fw6"><Money value={c.importe} cur={false} /></span>
                          <span className="imp-sub">ITBIS <Money value={c.itbis} cur={false} /></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {lineas.length === 0 && (
                <div className="state" style={{ padding: 28 }}>
                  <span className="text-sm" style={{ color: errors.form ? 'var(--danger)' : 'var(--text-2)' }}>{errors.form ?? 'Sin líneas. Agrega un producto del catálogo o una descripción libre.'}</span>
                </div>
              )}
            </div>
            <div className="card-pad row gap-sm" style={{ borderTop: '1px solid var(--border)' }}>
              <Btn variant="ghost" size="sm" icon="package" onClick={() => setProdPicker(true)}>Agregar producto</Btn>
              <Btn variant="ghost" size="sm" icon="file-plus" onClick={addLineaLibre}>Agregar descripción</Btn>
            </div>
          </Card>

          <Card title="Observaciones">
            <textarea className="textarea" placeholder="Notas internas o mensaje para el cliente (opcional)…" value={obs} onChange={(e) => setObs(e.target.value)}></textarea>
          </Card>
        </div>

        <div className="col gap-md" style={{ position: 'sticky', top: 16 }}>
          <Card title="Resumen">
            <div className="row between mb-sm">
              <span className="sum-head">Desglose</span>
              <span className="text-xs muted-3">{lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'}</span>
            </div>
            <div className="col gap-sm">
              <div className="row between text-sm"><span className="muted">Subtotal</span><Money value={subtotal} cur={false} /></div>
              {descTotal > 0 && (
                <div className="row between text-sm"><span className="muted">Descuentos</span><span className="num" style={{ color: 'var(--danger)' }}>−<Money value={descTotal} cur={false} /></span></div>
              )}
              <div className="row between text-sm"><span className="muted">ITBIS</span><Money value={itbisTotal} cur={false} /></div>
            </div>
            <div className="total-block">
              <span className="t-lbl">Total</span>
              <span className="t-val"><Money value={total} /></span>
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

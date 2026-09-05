import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Modal, PageHead, LoadingState, ErrorState } from '@/components/ui'
import {
  ApiError, createFacturaSimple, getBranding, getEmisor, getFacturaSimple,
  getFacturaSimplePdf, listProducts, mapProductRow, previewFacturaSimple, updateFacturaSimple,
} from '@/api'
import type { FacturaSimpleItemInput } from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import type { Cliente, Producto } from '@/types/domain'
import type { Nav } from '@/config/navigation'
import '@/styles/factura-doc.css'

/**
 * Campo de descripción que crece con el contenido: un artículo con nombre largo
 * se lee completo en vez de cortarse, que es lo que va impreso. Enter agrega
 * otra línea de la factura (Shift+Enter hace salto de línea dentro del texto).
 */
function AutoTextarea({
  value, onValue, onEnter, inputRef, ...rest
}: {
  value: string
  onValue: (v: string) => void
  onEnter: () => void
  /** Caja donde publicar el nodo (para que el padre pueda enfocarlo). */
  inputRef?: { current: HTMLTextAreaElement | null }
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'ref'>) {
  const propio = useRef<HTMLTextAreaElement | null>(null)

  // El alto se recalcula en cada cambio (y al cargar una factura existente).
  useLayoutEffect(() => {
    const el = propio.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      {...rest}
      ref={(el) => { propio.current = el; if (inputRef) inputRef.current = el }}
      rows={1}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter() }
      }}
    />
  )
}

/** Tasas de ITBIS que ofrece el formulario. El backend deriva el monto desde aquí. */
const TASAS = [
  { value: 1, label: '18%', rate: 0.18 },
  { value: 2, label: '16%', rate: 0.16 },
  { value: 3, label: '0%', rate: 0 },
  { value: 4, label: 'Exento', rate: 0 },
]

const rateOf = (ind: number) => TASAS.find((t) => t.value === ind)?.rate ?? 0

/** El ITBIS del catalogo (18/16/0) se traduce al indicador de la linea. */
const indicadorDeItbis = (itbis: number) => (itbis === 18 ? 1 : itbis === 16 ? 2 : 4)

interface Linea {
  id: number
  /** Producto del catalogo del que salio la linea (vacio = linea libre). */
  prodId: string
  descripcion: string
  cantidad: number
  precio: number
  /** Descuento de la linea en %, igual que en la factura con comprobante. */
  desc: number
  indicador: number
}

const lineaVacia = (id: number, desc = 0): Linea => ({ id, prodId: '', descripcion: '', cantidad: 1, precio: 0, desc, indicador: 1 })

/**
 * Metodos de pago que son venta a CREDITO (tipo_pago=2). Igual que en la factura
 * con comprobante: transferencia, tarjeta y cheque son cobros de contado.
 */
const METODOS_CREDITO = ['Credito 30 dias']
const esMetodoCredito = (m: string) => METODOS_CREDITO.includes(m)

/* FISCALO — Facturas simples: alta y edición (POST/PUT /api/facturas-simples).
   La pantalla tiene forma de documento: se escribe sobre el papel y cada dato
   queda donde va a imprimirse. Estilos en styles/factura-doc.css.
   Documento interno: no se envía a la DGII, no lleva e-NCF ni NCF fiscal. */
export function SimpleInvoiceFormView({ nav, facturaId }: { nav: Nav; facturaId: number | null }) {
  const queryClient = useQueryClient()
  const editando = facturaId != null

  const [cargando, setCargando] = useState(editando)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [numero, setNumero] = useState<string | null>(null)

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [metodo, setMetodo] = useState('Efectivo')
  const [clienteActual, setClienteActual] = useState<string | null>(null)
  const [clienteLibre, setClienteLibre] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia(1)])
  const [guardando, setGuardando] = useState(false)
  const [previaBusy, setPreviaBusy] = useState(false)
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  const [buscaProd, setBuscaProd] = useState('')
  const [cambiandoCliente, setCambiandoCliente] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  /** Foto del documento tal como se cargó: sirve para marcar qué se tocó. */
  const [original, setOriginal] = useState<{ fecha: string; lineas: Linea[] } | null>(null)

  // Identidad del emisor: el papel muestra los mismos datos que se van a
  // imprimir. Misma clave de caché que Configuración, así no se repite la
  // petición al navegar entre las dos pantallas.
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const productos = useApiQuery(['products', 'list'], () => listProducts({ pageSize: 100 }))

  // La última descripción agregada recibe el foco: se puede encadenar
  // "agregar línea → escribir" sin tocar el ratón.
  const ultimaDescRef = useRef<HTMLTextAreaElement | null>(null)
  const enfocarUltima = useRef(false)

  useEffect(() => {
    if (enfocarUltima.current) {
      ultimaDescRef.current?.focus()
      enfocarUltima.current = false
    }
  }, [lineas])

  // Edición: se cargan las líneas y se muestra el cliente actual como texto (el
  // combobox queda disponible para cambiarlo, y si no se toca no se envía).
  useEffect(() => {
    if (facturaId == null) return
    let vivo = true
    setCargando(true)
    getFacturaSimple(facturaId)
      .then((f) => {
        if (!vivo) return
        setNumero(f.no_factura)
        setClienteActual(f.client_name || f.company_name || null)
        if (Number(f.tipo_pago ?? 1) === 2) setMetodo(METODOS_CREDITO[0])
        if (f.date) setFecha(String(f.date).slice(0, 10))
        const cargadas: Linea[] = (f.items ?? []).map((it, i) => ({
          id: i + 1,
          prodId: it.product_id ? String(it.product_id) : '',
          descripcion: it.description ?? '',
          cantidad: Number(it.quantity ?? 1),
          precio: Number(it.amount ?? 0),
          // El backend guarda el descuento en monto; la UI lo maneja en %.
          desc: Number(it.amount ?? 0) * Number(it.quantity ?? 1) > 0
            ? Math.round((Number(it.descuento_monto ?? 0) / (Number(it.amount ?? 0) * Number(it.quantity ?? 1))) * 10000) / 100
            : 0,
          indicador: Number(it.indicador_facturacion ?? 1),
        }))
        setLineas(cargadas)
        setOriginal({ fecha: String(f.date ?? '').slice(0, 10), lineas: cargadas })
        setErrorCarga(null)
      })
      .catch((e) => { if (vivo) setErrorCarga(e instanceof ApiError ? e.message : 'No se pudo cargar la factura.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [facturaId])

  // Lista de metodos que ofrece el formulario (el credito depende del cliente).
  const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Credito 30 dias', 'Cheque']

  /**
   * Elegir cliente arrastra sus condiciones: su % de descuento pasa a todas las
   * lineas y, si no tiene credito, el pago vuelve a contado (el backend lo
   * rechaza con 422, igual que en la factura con comprobante).
   */
  const seleccionarCliente = (c: Cliente | null) => {
    setCliente(c)
    const pct = c?.descuento ?? 0
    setLineas((ls) => ls.map((l) => ({ ...l, desc: pct })))
    if (c && !c.permiteCredito) setMetodo((m) => (esMetodoCredito(m) ? 'Efectivo' : m))
  }

  const addLinea = () => {
    enfocarUltima.current = true
    setLineas((ls) => [...ls, lineaVacia(Math.max(0, ...ls.map((l) => l.id)) + 1, cliente?.descuento ?? 0)])
  }
  /**
   * Linea traida del catalogo: el producto define descripcion, precio y tasa.
   * Si la ultima linea sigue vacia se reemplaza, para no dejar huecos cuando se
   * abre el catalogo nada mas entrar.
   */
  const addProducto = (p: Producto) => {
    const desde = (id: number): Linea => ({
      id,
      prodId: p.id,
      descripcion: p.nombre,
      cantidad: 1,
      precio: p.precio,
      desc: cliente?.descuento ?? 0,
      indicador: indicadorDeItbis(p.itbis),
    })
    setLineas((ls) => {
      const ultima = ls[ls.length - 1]
      const ultimaVacia = ultima && ultima.descripcion.trim() === '' && ultima.precio === 0
      return ultimaVacia
        ? [...ls.slice(0, -1), desde(ultima.id)]
        : [...ls, desde(Math.max(0, ...ls.map((l) => l.id)) + 1)]
    })
    setCatalogoAbierto(false)
    setBuscaProd('')
  }

  const delLinea = (id: number) => setLineas((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.id !== id)))
  const updLinea = (id: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambio } : l)))

  const catalogo = (productos.data?.items ?? []).map(mapProductRow)
  const filtroProd = buscaProd.trim().toLowerCase()
  const catalogoFiltrado = filtroProd
    ? catalogo.filter((p) => `${p.nombre} ${p.sku} ${p.cat}`.toLowerCase().includes(filtroProd))
    : catalogo

  // Neto de descuento: el backend guarda el subtotal ya rebajado y calcula el
  // ITBIS sobre el, asi que la pantalla tiene que mostrar lo mismo.
  const descuentoDe = (l: Linea) => Math.round(l.cantidad * l.precio * l.desc) / 100
  const subtotalDe = (l: Linea) => Math.round(l.cantidad * l.precio * 100) / 100 - descuentoDe(l)
  const itbisDe = (l: Linea) => Math.round(subtotalDe(l) * rateOf(l.indicador) * 100) / 100
  const subtotal = lineas.reduce((c, l) => c + subtotalDe(l), 0)
  const itbis = lineas.reduce((c, l) => c + itbisDe(l), 0)
  const total = subtotal + itbis

  // --- Qué se tocó respecto al documento cargado -------------------------
  // Se compara contra la foto inicial en vez de llevar un flag "sucio": así el
  // usuario ve el campo exacto que cambió, y si lo devuelve a su valor original
  // la marca desaparece sola.
  const lineaOriginal = (id: number) => original?.lineas.find((o) => o.id === id)
  const esLineaNueva = (id: number) => original != null && lineaOriginal(id) === undefined
  const campoCambiado = (l: Linea, k: 'descripcion' | 'cantidad' | 'precio' | 'desc' | 'indicador') => {
    if (original == null) return false
    const o = lineaOriginal(l.id)
    return o ? o[k] !== l[k] : true
  }
  const clienteCambiado = original != null && (cliente != null || clienteLibre.trim() !== '')
  const fechaCambiada = original != null && original.fecha !== fecha
  const lineasBorradas = original != null && original.lineas.some((o) => !lineas.some((l) => l.id === o.id))
  const lineasCambiadas = original != null && (
    lineasBorradas ||
    lineas.some((l) => esLineaNueva(l.id) ||
      (['descripcion', 'cantidad', 'precio', 'desc', 'indicador'] as const).some((k) => campoCambiado(l, k)))
  )
  const hayCambios = clienteCambiado || fechaCambiada || lineasCambiadas
  const marca = (cond: boolean) => (cond ? ' fx-mod' : '')

  const lineasValidas = lineas.filter((l) => l.descripcion.trim() !== '' && l.cantidad > 0)
  const clienteResuelto = cliente != null || clienteLibre.trim() !== '' || clienteActual != null
  const puedeGuardar = clienteResuelto && lineasValidas.length > 0 && !guardando && (!editando || hayCambios)

  const items = (): FacturaSimpleItemInput[] =>
    lineasValidas.map((l) => ({
      ...(l.prodId ? { product_id: Number(l.prodId) } : {}),
      description: l.descripcion.trim(),
      quantity: l.cantidad,
      amount: l.precio,
      indicador_facturacion: l.indicador,
      ...(l.desc > 0 ? { descuento_monto: descuentoDe(l) } : {}),
    }))

  /**
   * Parte de cliente del payload: lo que el usuario eligió o escribió.
   * En edición, si no lo tocó se omite (el PUT es parcial y conserva el actual);
   * `incluirActual` lo fuerza para la vista previa, que sí exige un cliente.
   */
  const clienteBody = (incluirActual = false) => {
    if (cliente) return { client_id: Number(cliente.id) }
    if (clienteLibre.trim() !== '') return { client_name: clienteLibre.trim() }
    if (incluirActual && clienteActual) return { client_name: clienteActual }
    return {}
  }

  /** PDF de la factura tal como está guardada (no la edición en curso). */
  const verGuardada = async () => {
    if (facturaId == null) return
    setPdfBusy(true)
    try {
      presentDocument(await getFacturaSimplePdf(facturaId))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo abrir la factura.')
    } finally {
      setPdfBusy(false)
    }
  }

  const vistaPrevia = async () => {
    if (lineasValidas.length === 0) { toast.error('Agrega al menos una línea con descripción.'); return }
    setPreviaBusy(true)
    try {
      presentDocument(await previewFacturaSimple({ ...clienteBody(true), date: fecha, items: items() }))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.')
    } finally {
      setPreviaBusy(false)
    }
  }

  const guardar = async () => {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      if (editando && facturaId != null) {
        await updateFacturaSimple(facturaId, { ...clienteBody(), date: fecha, tipo_pago: esMetodoCredito(metodo) ? 2 : 1, items: items() })
        toast.success('Factura simple actualizada.')
      } else {
        const creada = await createFacturaSimple({ ...clienteBody(), date: fecha, tipo_pago: esMetodoCredito(metodo) ? 2 : 1, items: items() })
        toast.success(`Factura simple ${creada?.no_factura ?? ''} creada.`)
      }
      await queryClient.invalidateQueries({ queryKey: ['facturas-simples'] })
      nav('facturas-simples')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la factura.')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando || errorCarga) {
    return (
      <div className="page">
        <PageHead title="Factura simple" crumbs={[{ label: 'Facturas simples', onClick: () => nav('facturas-simples') }]} />
        <Card>
          {cargando
            ? <LoadingState rows={6} />
            : <ErrorState title="No se pudo cargar la factura">{errorCarga}</ErrorState>}
        </Card>
      </div>
    )
  }

  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contacto = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')

  return (
    <div className="page fx-desk">
      <div className="row" style={{ marginBottom: 14 }}>
        <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => nav('facturas-simples')}>
          Facturas simples
        </Btn>
      </div>

      <article className="fx-sheet">
        {/* --- Identidad del emisor + datos del documento --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisorNombre || 'Tu empresa'}</div>
            {emisor?.direccion && <div className="fx-emisor-line">{emisor.direccion}</div>}
            {contacto && <div className="fx-emisor-line">{contacto}</div>}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {emisor.rnc}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Documento interno</span>
            <div className="fx-doc-title">FACTURA</div>
            <span className={'fx-numero' + (numero ? '' : ' fx-numero-pend')}>
              {numero ?? 'Nº al guardar'}
            </span>
            <label className="fx-eyebrow" htmlFor="fx-fecha">Fecha</label>
            <input
              id="fx-fecha"
              className={'fx-field' + marca(fechaCambiada)}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ textAlign: 'right', width: 'auto' }}
            />
          </div>
        </header>

        <div className="fx-rule" />

        {/* --- Receptor --- */}
        <section className="fx-a-quien">
          <span className="fx-eyebrow">Facturar a</span>

          {clienteActual && !cliente && !cambiandoCliente ? (
            <div className="fx-cliente-actual">
              <span className="fx-cliente-nombre">{clienteActual}</span>
              <button type="button" className="fx-link" onClick={() => setCambiandoCliente(true)}>
                Cambiar
              </button>
            </div>
          ) : (
          <>
          <div className="fx-cliente-row">
            <div className="fx-cliente">
              <ClientCombobox value={cliente} onChange={seleccionarCliente} />
            </div>
            <button
              type="button"
              className="fx-cliente-add"
              onClick={() => setNuevoCliente(true)}
              title="Nuevo cliente"
              aria-label="Crear un cliente nuevo"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {!cliente && (
            <input
              className={'fx-field fx-field-visible' + marca(clienteCambiado && clienteLibre.trim() !== '')}
              style={{ marginTop: 8, fontSize: 15 }}
              placeholder="o escribe un nombre…"
              value={clienteLibre}
              onChange={(e) => setClienteLibre(e.target.value)}
              aria-label="Nombre del cliente si no está registrado"
            />
          )}
          </>
          )}
          <div style={{ marginTop: 12 }}>
            <span className="fx-eyebrow">Pago</span>
            <select
              className="fx-cond-sel"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              aria-label="Método de pago"
            >
              {METODOS_PAGO.map((m) => (
                <option key={m} disabled={esMetodoCredito(m) && cliente != null && !cliente.permiteCredito}>{m}</option>
              ))}
            </select>
            {cliente && !cliente.permiteCredito && (
              <span className="text-xs muted-3" style={{ display: 'block' }}>
                Este cliente no tiene crédito habilitado
              </span>
            )}
          </div>
        </section>

        {/* --- Líneas --- */}
        <section className="fx-items" style={{ marginTop: 26 }}>
          <div className="fx-grid fx-items-head">
            <span />
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span style={{ textAlign: 'right' }}>Desc.%</span>
            <span>ITBIS</span>
            <span style={{ textAlign: 'right' }}>Importe</span>
          </div>

          {lineas.map((l, i) => (
            <div className={'fx-grid fx-row' + (esLineaNueva(l.id) ? ' fx-row-nueva' : '')} key={l.id}>
              <button
                type="button"
                className="fx-gutter"
                onClick={() => delLinea(l.id)}
                disabled={lineas.length === 1}
                aria-label={`Quitar línea ${i + 1}`}
                title="Quitar línea"
              >
                <Icon name="x" size={14} />
              </button>

              <AutoTextarea
                className={'fx-field fx-desc' + marca(campoCambiado(l, 'descripcion'))}
                inputRef={i === lineas.length - 1 ? ultimaDescRef : undefined}
                placeholder="Concepto o artículo…"
                value={l.descripcion}
                onValue={(v) => updLinea(l.id, { descripcion: v })}
                onEnter={addLinea}
                aria-label={`Descripción de la línea ${i + 1}`}
              />

              <input
                className={'fx-field fx-num fx-cell' + marca(campoCambiado(l, 'cantidad'))} data-label="Cant."
                type="number" min={0} step="any" inputMode="decimal"
                value={l.cantidad}
                onChange={(e) => updLinea(l.id, { cantidad: Number(e.target.value) })}
                aria-label={`Cantidad de la línea ${i + 1}`}
              />

              <input
                className={'fx-field fx-num fx-cell' + marca(campoCambiado(l, 'precio'))} data-label="Precio"
                type="number" min={0} step="any" inputMode="decimal"
                value={l.precio}
                onChange={(e) => updLinea(l.id, { precio: Number(e.target.value) })}
                aria-label={`Precio de la línea ${i + 1}`}
              />

              <input
                className={'fx-field fx-num fx-cell' + marca(campoCambiado(l, 'desc'))} data-label="Desc.%"
                type="number" min={0} max={100} step="any" inputMode="decimal"
                value={l.desc}
                onChange={(e) => updLinea(l.id, { desc: Math.max(0, Math.min(100, Number(e.target.value))) })}
                aria-label={`Descuento en porcentaje de la línea ${i + 1}`}
              />

              <select
                className={'fx-tasa fx-cell' + marca(campoCambiado(l, 'indicador'))} data-label="ITBIS"
                value={l.indicador}
                onChange={(e) => updLinea(l.id, { indicador: Number(e.target.value) })}
                aria-label={`Tasa de ITBIS de la línea ${i + 1}`}
              >
                {TASAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>

              <span className="fx-importe fx-cell" data-label="Importe">
                <Money value={subtotalDe(l) + itbisDe(l)} cur={false} />
              </span>
            </div>
          ))}

          <div className="fx-add-row">
            <button type="button" className="fx-add" onClick={() => setCatalogoAbierto(true)}>
              <Icon name="package" size={14} />Producto
            </button>
            <button type="button" className="fx-add" onClick={addLinea}>
              <Icon name="plus" size={14} />Descripción
            </button>
          </div>
        </section>

        {/* --- Totales --- */}
        <section className="fx-totales">
          <div className="fx-totales-box">
            <div className="fx-total-linea">
              <span>Subtotal</span><span><Money value={subtotal} cur={false} /></span>
            </div>
            <div className="fx-total-linea">
              <span>ITBIS</span><span><Money value={itbis} cur={false} /></span>
            </div>
            <div className="fx-total-final">
              <span>Total</span><span><Money value={total} cur={false} /></span>
            </div>
          </div>
        </section>

        <footer className="fx-nota">
          Documento interno sin valor fiscal · no se envía a la DGII
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar">
        <div className="fx-bar-total">
          {hayCambios ? (
            <span className="fx-cambios">Cambios sin guardar</span>
          ) : (
            <span className="text-sm muted">
              {lineasValidas.length === 0
                ? 'Sin líneas todavía'
                : `${lineasValidas.length} ${lineasValidas.length === 1 ? 'línea' : 'líneas'}`}
            </span>
          )}
          <b><Money value={total} cur={false} /></b>
        </div>
        <div className="row gap-sm">
          {/* Factura ya creada y sin tocar: lo util es ver el documento real.
              En cuanto se modifica algo, ese PDF ya no refleja la pantalla, asi
              que el boton pasa a ser la vista previa de lo editado. */}
          {editando && !hayCambios ? (
            <Btn variant="secondary" icon="download" onClick={() => void verGuardada()} disabled={pdfBusy}>
              {pdfBusy ? 'Abriendo…' : 'Ver factura'}
            </Btn>
          ) : (
            <Btn variant="secondary" icon="eye" onClick={() => void vistaPrevia()} disabled={previaBusy}>
              {previaBusy ? 'Generando…' : 'Vista previa'}
            </Btn>
          )}
          <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={!puedeGuardar}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear factura'}
          </Btn>
        </div>
      </div>

      {catalogoAbierto && (
        <Modal
          title="Agregar del catálogo"
          sub="El producto trae su precio y su tasa de ITBIS"
          icon="package"
          onClose={() => { setCatalogoAbierto(false); setBuscaProd('') }}
        >
          <div className="search-input mb-md" style={{ width: '100%' }}>
            <Icon name="search" />
            <input
              placeholder="Buscar por nombre, SKU o categoría…"
              value={buscaProd}
              onChange={(e) => setBuscaProd(e.target.value)}
              autoFocus
            />
          </div>

          {productos.loading ? (
            <LoadingState rows={4} />
          ) : productos.error ? (
            <ErrorState title="No se pudo cargar el catálogo" onRetry={productos.reload}>
              {productos.error}
            </ErrorState>
          ) : catalogoFiltrado.length === 0 ? (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm muted">
                {catalogo.length === 0
                  ? 'No hay productos en el catálogo todavía.'
                  : `Sin resultados para "${buscaProd.trim()}".`}
              </span>
            </div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -10px' }}>
              {catalogoFiltrado.map((p) => (
                <button type="button" key={p.id} className="fx-prod" onClick={() => addProducto(p)}>
                  <Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} style={{ color: 'var(--text-3)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="fx-prod-nombre" style={{ display: 'block' }}>{p.nombre}</span>
                    <span className="fx-prod-meta">{p.sku || 'sin SKU'} · {p.cat || 'sin categoría'}</span>
                  </span>
                  <span className="fx-prod-precio"><Money value={p.precio} cur={false} /></span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {nuevoCliente && (
        <NewClientModal
          nombreInicial={clienteLibre.trim()}
          onClose={() => setNuevoCliente(false)}
          onCreated={(c) => { seleccionarCliente(c); setClienteLibre('') }}
        />
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Modal, Spinner, Switch } from '@/components/ui'
import {
  ApiError, DEFAULT_USER_ID, createFactura, previewFactura, getStats, getClient,
  getBranding, getEmisor, listProducts, mapClientRow, mapProductRow, formatApiDate, dgiiLabel, updateClient,
} from '@/api'
import type {
  CreateFacturaInput, FacturaItemInput, IndicadorFacturacion, TipoEcf, StatsSecuencia,
} from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession } from '@/stores/auth'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto, Factura, FacturaPrefill } from '@/types/domain'
import { facturaFormSchema, mapFormIssues, emptyFormErrors, type FacturaFormErrors } from './factura.schema'
import '@/styles/factura-doc.css'

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

/**
 * Métodos de pago que son venta a CRÉDITO (TipoPago=2 ante DGII). El resto
 * —efectivo, transferencia, tarjeta, cheque— son formas de cobro de una venta
 * de contado y van como TipoPago=1.
 */
const METODOS_CREDITO = ['Crédito 30 días']
const esMetodoCredito = (metodo: string) => METODOS_CREDITO.includes(metodo)

/** Opciones de indicador de facturación DGII (tasa de ITBIS por línea). */
const IND_FACT_OPCIONES: { value: IndicadorFacturacion; label: string }[] = [
  { value: 1, label: '18%' },
  { value: 2, label: '16%' },
  { value: 3, label: 'Tasa 0%' },
  { value: 4, label: 'Exento' },
]

/**
 * Selector del tipo de comprobante, dibujado como el titulo del documento.
 * Reemplaza al <select> nativo porque su lista la pinta el sistema operativo y
 * no admite estilos. Cierra con Escape, clic fuera o al elegir; las flechas
 * recorren las opciones.
 */
function TipoDocSelect({
  value, options, onChange,
}: {
  value: TipoEcf
  options: { code: TipoEcf; n: string }[]
  onChange: (t: TipoEcf) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)
  const actual = options.find((o) => o.code === value)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const mover = (desde: number, paso: number) => {
    const destino = (desde + paso + options.length) % options.length
    const btns = caja.current?.querySelectorAll<HTMLButtonElement>('.fx-tipo-op')
    btns?.[destino]?.focus()
  }

  return (
    <div className="fx-tipo" ref={caja} data-abierto={abierto ? 'true' : 'false'}>
      <button
        type="button"
        className="fx-tipo-trigger"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={`Tipo de comprobante: ${actual?.n ?? value}`}
      >
        {actual ? `${actual.n} · e-CF ${actual.code}` : `e-CF ${value}`}
        <Icon name="chevron-down" size={17} className="fx-tipo-chev" />
      </button>

      {abierto && (
        <div className="menu fx-tipo-menu" role="listbox" aria-label="Tipo de comprobante">
          {options.map((o, i) => (
            <button
              type="button"
              key={o.code}
              className="fx-tipo-op"
              role="option"
              aria-selected={o.code === value}
              onClick={() => { onChange(o.code); setAbierto(false) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); mover(i, 1) }
                if (e.key === 'ArrowUp') { e.preventDefault(); mover(i, -1) }
              }}
            >
              <span className="fx-tipo-op-nombre">{o.n}</span>
              <span className="fx-tipo-op-codigo">e-CF {o.code}</span>
              {o.code === value && <Icon name="check" size={15} className="fx-tipo-op-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
          // Placeholder: el efecto de abajo trae el cliente completo por id y
          // con el sus condiciones reales (descuento y credito).
          descuento: 0, permiteCredito: false,
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
      const completo = mapClientRow(row)
      setCliente(completo)
      // Al llegar el cliente real llegan sus condiciones: se aplican igual que
      // si se hubiera elegido a mano, para que convertir una cotizacion no se
      // comporte distinto que crear la factura desde cero.
      if (completo.descuento > 0) {
        setLineas((ls) => ls.map((l) => ({ ...l, desc: completo.descuento })))
      }
      if (!completo.permiteCredito) {
        setMetodo((m) => (esMetodoCredito(m) ? 'Efectivo' : m))
      }
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

  // Identidad del emisor: la hoja muestra los mismos datos que va a imprimir.
  // Mismas claves de caché que Configuración y la factura simple.
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contactoEmisor = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [rncModal, setRncModal] = useState(false)
  const [prodQuery, setProdQuery] = useState('')
  const catalogo = (productos.data?.items ?? []).map(mapProductRow)
  const catalogoFiltrado = catalogo.filter((p) =>
    `${p.nombre} ${p.sku} ${p.cat}`.toLowerCase().includes(prodQuery.trim().toLowerCase()),
  )

  // Descuento por defecto de las líneas: el que tenga el cliente elegido. El
  // usuario puede cambiarlo línea por línea después; esto solo lo precarga.
  const descuentoCliente = cliente?.descuento ?? 0

  /**
   * Elegir cliente arrastra sus condiciones comerciales al documento: su % de
   * descuento pasa a todas las líneas, y si no tiene crédito habilitado el
   * método de pago vuelve a contado (el backend rechazaría la factura con 422).
   */
  const seleccionarCliente = (c: Cliente | null) => {
    setCliente(c)
    if (errors.cliente) setErrors((e) => ({ ...e, cliente: undefined }))
    const pct = c?.descuento ?? 0
    setLineas((ls) => ls.map((l) => ({ ...l, desc: pct })))
    if (c && !c.permiteCredito && esMetodoCredito(metodo)) {
      setMetodo('Efectivo')
      toast.info(`${c.nombre} no tiene crédito habilitado: el pago queda de contado.`)
    }
  }

  const addLinea = (p: Producto) => {
    setLineas([...lineas, {
      id: Date.now(), prodId: p.id, nombre: p.nombre, descripcion: '', cant: 1,
      // El producto define el indicador y la unidad por defecto.
      precio: p.precio, desc: descuentoCliente, indFact: indFactFromItbis(p.itbis),
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
      precio: 0, desc: descuentoCliente, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
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
  // El RNC del comprador es obligatorio en el E31 (Crédito Fiscal) y lo exige la
  // DGII en las notas que modifican uno. Se avisa en vez de bloquear: el usuario
  // puede corregirlo sin salir de la factura.
  const faltaRnc = cliente != null && !cliente.doc.trim() && ['31', '33', '34'].includes(tipo)

  const metodos = ['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito 30 días', 'Cheque']
  // Solo el crédito es TipoPago=2 ante DGII. Transferencia, tarjeta y cheque son
  // formas de cobro de una venta de CONTADO: mandarlas como crédito falsea el
  // comprobante (y ahora el backend las rechaza si el cliente no tiene crédito).
  const esCredito = esMetodoCredito(metodo)
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
      // La UI maneja el descuento en %, pero DGII lo quiere en monto por línea.
      // Sin esto el descuento era solo visual: los totales de pantalla lo
      // restaban y el comprobante emitido salía al precio completo.
      ...(l.desc > 0 ? { descuento_monto: Math.round(l.cant * l.precio * l.desc) / 100 } : {}),
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
      tipo_pago: esCredito ? 2 : 1,
      // El descuento de las líneas ya va en cada item; se manda explícito para
      // que el backend no vuelva a aplicar el del cliente encima.
      descuento: 0,
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
    <div className="page fx-desk factura-new">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => nav('facturas')}>Facturación</Btn>
        {prefill?.origen && (
          <span className="row gap-sm text-sm" style={{ color: 'var(--info)' }}>
            <Icon name="file-plus" size={15} />
            Convertida desde la cotización {prefill.origen} · los precios ya traen ITBIS incluido
          </span>
        )}
      </div>

      <article className="fx-sheet fx-sheet--ancha">
        {/* --- Emisor + identificación del comprobante --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisorNombre || 'Tu empresa'}</div>
            {emisor?.direccion && <div className="fx-emisor-line">{emisor.direccion}</div>}
            {contactoEmisor && <div className="fx-emisor-line">{contactoEmisor}</div>}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {emisor.rnc}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Comprobante fiscal electrónico</span>
            {/* El tipo ES el título del documento: cambiarlo lo retitula. */}
            <TipoDocSelect
              value={tipo}
              options={tipos}
              onChange={(t) => { setTipo(t); if (errors.tipo) setErrors((er) => ({ ...er, tipo: undefined })) }}
            />
            {errors.tipo && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.tipo}</span>}

            <span className={'fx-numero' + (proximoNcf ? '' : ' fx-numero-pend')}>
              {stats.loading ? 'Cargando secuencia…' : proximoNcf ?? (stats.error ? 'Secuencia no disponible' : 'Sin secuencia')}
            </span>

            {rangoRestantes != null && rangoRestantes <= 10 ? (
              <span className="fx-aviso">
                <Icon name="alert-triangle" size={13} />
                {rangoRestantes === 0
                  ? 'Rango DGII agotado: registra el próximo para poder emitir.'
                  : `Quedan ${rangoRestantes} números en el rango DGII.`}
              </span>
            ) : (
              <span className="fx-aviso fx-aviso--suave">El backend confirma el e-NCF definitivo al emitir</span>
            )}
          </div>
        </header>

        <div className="fx-rule" />

        <div className="fx-doc-datos">
        {/* --- Receptor --- */}
        <section className="fx-a-quien">
          <span className="fx-eyebrow">
            Facturar a {requiereCliente ? <span className="req">*</span> : <span className="opt">(opcional)</span>}
          </span>
          <div className="fx-cliente-row">
            <div className="fx-cliente">
              <ClientCombobox
                value={cliente}
                onChange={seleccionarCliente}
              />
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
          {errors.cliente && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.cliente}</span>}
          {faltaRnc && cliente && (
            <span className="fx-aviso fx-aviso--receptor">
              <Icon name="alert-triangle" size={13} />
              {tipo === '31'
                ? `${cliente.nombre} no tiene RNC, y el Crédito Fiscal lo exige.`
                : `${cliente.nombre} no tiene RNC. Si esta nota modifica un Crédito Fiscal, la DGII lo exige.`}
              <button type="button" className="fx-link-btn" onClick={() => setRncModal(true)}>
                Agregar RNC
              </button>
            </span>
          )}
        </section>

        {/* --- Condiciones del documento --- */}
        <section className="fx-cond">
          <span className="fx-cond-item">
            <span className="fx-eyebrow">Pago</span>
            <select
              className="fx-cond-sel"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              aria-label="Método de pago"
            >
              {metodos.map((m) => (
                // El crédito se deshabilita si el cliente no lo tiene permitido:
                // vale más impedirlo aquí que dejar que la DGII lo rechace luego.
                <option key={m} disabled={esMetodoCredito(m) && cliente != null && !cliente.permiteCredito}>
                  {m}
                </option>
              ))}
            </select>
            {cliente && !cliente.permiteCredito && (
              <span className="text-xs muted-3" style={{ display: 'block' }}>
                Este cliente no tiene crédito habilitado
              </span>
            )}
          </span>
          <span className="fx-cond-item">
            <Switch on={precioConItbis} onChange={setPrecioConItbis} />
            <span className="text-sm">
              Los precios incluyen ITBIS
              <span className="text-xs muted-3" style={{ display: 'block' }}>
                {precioConItbis ? 'Se desglosa del precio de cada línea' : 'Se suma encima del precio de cada línea'}
              </span>
            </span>
          </span>
        </section>
        </div>

        {/* --- Líneas --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ecf fx-items-head">
            <span />
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span>Unidad</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span style={{ textAlign: 'right' }}>Desc%</span>
            <span>ITBIS</span>
            <span style={{ textAlign: 'right' }}>Importe</span>
          </div>

          {lineas.map((l, i) => {
            const le = errors.lineas[l.id]
            const c = calc(l)
            return (
              <div className="fx-grid-ecf fx-row" key={l.id}>
                <button
                  type="button"
                  className="fx-gutter"
                  onClick={() => delLinea(l.id)}
                  aria-label={`Quitar línea ${i + 1}`}
                  title="Quitar línea"
                >
                  <Icon name="x" size={14} />
                </button>

                <div className="fx-desc">
                  <input
                    className={'fx-field' + (le?.nombre ? ' fx-field--err' : '')}
                    value={l.nombre}
                    placeholder="Nombre del ítem (ej. Sticker Vinyl 2x2)"
                    onChange={(e) => setNombre(l.id, e.target.value)}
                    aria-label={`Nombre del ítem ${i + 1}`}
                  />
                  {le?.nombre && <span className="fx-err"><Icon name="alert-circle" size={12} />{le.nombre}</span>}

                  <div className="fx-linea-pie">
                    {!showDesc(l) ? (
                      <button type="button" className="fx-detalle-toggle" onClick={() => toggleDesc(l.id)}>+ Detalle</button>
                    ) : l.descripcion.trim() === '' ? (
                      <button type="button" className="fx-detalle-toggle" onClick={() => toggleDesc(l.id)}>− Ocultar detalle</button>
                    ) : null}
                    {l.prodId !== '' && <span className="fx-contador">{l.tipoItem}</span>}
                    <span className={'fx-contador' + (l.nombre.length > 80 ? ' fx-contador--tope' : '')}>
                      {l.nombre.length}/80
                    </span>
                  </div>

                  {showDesc(l) && (
                    <>
                      <textarea
                        className={'fx-obs' + (le?.descripcion ? ' fx-field--err' : '')}
                        style={{ minHeight: 40, fontSize: 12.5 }}
                        value={l.descripcion}
                        placeholder="Detalle: material, medidas, color, sucursal… (opcional)"
                        onChange={(e) => setDescripcion(l.id, e.target.value)}
                        aria-label={`Detalle del ítem ${i + 1}`}
                      />
                      {le?.descripcion && <span className="fx-err"><Icon name="alert-circle" size={12} />{le.descripcion}</span>}
                    </>
                  )}
                </div>

                <div className="fx-cell" data-label="Cant.">
                  <input
                    className={'fx-field fx-num' + (le?.cant ? ' fx-field--err' : '')}
                    type="number" inputMode="decimal"
                    value={l.cant}
                    onChange={(e) => updLinea(l.id, 'cant', +e.target.value || 0)}
                    aria-label={`Cantidad del ítem ${i + 1}`}
                  />
                  {le?.cant && <span className="fx-err">{le.cant}</span>}
                </div>

                <div className="fx-cell" data-label="Unidad">
                  <UnidadMedidaSelect
                    className={'fx-tasa' + (le?.unidadMedida ? ' fx-tasa--err' : '')}
                    value={l.unidadMedida}
                    onChange={(v) => setUnidad(l.id, v)}
                  />
                  {le?.unidadMedida && <span className="fx-err">{le.unidadMedida}</span>}
                </div>

                <div className="fx-cell" data-label="Precio">
                  <input
                    className={'fx-field fx-num' + (le?.precio ? ' fx-field--err' : '')}
                    type="number" inputMode="decimal"
                    value={l.precio}
                    onChange={(e) => updLinea(l.id, 'precio', +e.target.value || 0)}
                    aria-label={`Precio del ítem ${i + 1}`}
                  />
                  {le?.precio && <span className="fx-err">{le.precio}</span>}
                </div>

                <div className="fx-cell" data-label="Desc%">
                  <input
                    className={'fx-field fx-num' + (le?.desc ? ' fx-field--err' : '')}
                    type="number" inputMode="decimal"
                    value={l.desc}
                    onChange={(e) => updLinea(l.id, 'desc', +e.target.value || 0)}
                    aria-label={`Descuento del ítem ${i + 1}`}
                  />
                  {le?.desc && <span className="fx-err">{le.desc}</span>}
                </div>

                <select
                  className="fx-tasa fx-cell" data-label="ITBIS"
                  value={l.indFact}
                  onChange={(e) => setIndFact(l.id, Number(e.target.value) as IndicadorFacturacion)}
                  aria-label={`ITBIS del ítem ${i + 1}`}
                >
                  {IND_FACT_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                <span className="fx-importe fx-cell" data-label="Importe">
                  <Money value={c.importe} cur={false} />
                  <span className="fx-contador" style={{ display: 'block' }}>ITBIS <Money value={c.itbis} cur={false} /></span>
                </span>
              </div>
            )
          })}

          {lineas.length === 0 && (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm" style={{ color: errors.form ? 'var(--danger)' : 'var(--text-2)' }}>
                {errors.form ?? 'Sin líneas. Agrega un producto del catálogo o una descripción libre.'}
              </span>
            </div>
          )}

          <div className="fx-add-row">
            <button type="button" className="fx-add" onClick={() => setProdPicker(true)}>
              <Icon name="package" size={14} />Producto
            </button>
            <button type="button" className="fx-add" onClick={addLineaLibre}>
              <Icon name="plus" size={14} />Descripción
            </button>
          </div>
        </section>

        {/* --- Observaciones + totales, como en una factura impresa --- */}
        <section className="fx-cierre">
          <div>
            <span className="fx-eyebrow">Observaciones</span>
            <textarea
              className="fx-obs fx-obs--visible"
              placeholder="Notas internas o mensaje para el cliente (opcional)…"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              aria-label="Observaciones"
            />
          </div>

          <div className="fx-totales-box">
            <div className="fx-total-linea">
              <span>Subtotal</span><span><Money value={subtotal} cur={false} /></span>
            </div>
            {descTotal > 0 && (
              <div className="fx-total-linea">
                <span>Descuentos</span>
                <span style={{ color: 'var(--danger)' }}>−<Money value={descTotal} cur={false} /></span>
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
          Secuencia e-NCF asignada por el backend · firma y envío a la DGII automáticos ·
          el monto fiscal definitivo lo calcula el backend al emitir
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar fx-bar--ancha">
        <div className="fx-bar-total">
          <span className="text-sm muted">
            {lineas.length === 0
              ? 'Sin líneas todavía'
              : `${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}`}
          </span>
          <b><Money value={total} cur={false} /></b>
        </div>
        <div className="row gap-sm">
          <Btn variant="ghost" onClick={() => nav('facturas')}>Cancelar</Btn>
          <Btn variant="secondary" icon="eye" onClick={previsualizar} disabled={previewing}>
            {previewing ? 'Generando…' : 'Vista previa'}
          </Btn>
          <Btn variant="primary" icon="send" onClick={emitir} disabled={emitting}>
            {emitting ? 'Emitiendo…' : 'Emitir e-CF'}
          </Btn>
        </div>
      </div>

      {nuevoCliente && (
        <NewClientModal
          onClose={() => setNuevoCliente(false)}
          onCreated={(c) => seleccionarCliente(c)}
        />
      )}
      {rncModal && cliente && (
        <AgregarRncModal
          cliente={cliente}
          onClose={() => setRncModal(false)}
          onGuardado={(rnc) => {
            // Se refleja en la factura al instante, sin volver a elegir el cliente.
            setCliente({ ...cliente, doc: rnc, tipo: rnc.length === 11 ? 'Cédula' : 'RNC' })
            setErrors((e) => ({ ...e, cliente: undefined }))
            setRncModal(false)
          }}
        />
      )}
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

/**
 * Corrige el RNC de un cliente sin salir de la factura.
 *
 * Manda un PUT parcial (solo id + rnc): el backend conserva el resto del
 * registro. Eso importa con los catálogos migrados, donde muchos clientes no
 * tienen correo ni teléfono y un PUT completo no pasaría la validación.
 */
function AgregarRncModal({
  cliente, onClose, onGuardado,
}: {
  cliente: Cliente
  onClose: () => void
  onGuardado: (rnc: string) => void
}) {
  const queryClient = useQueryClient()
  const [rnc, setRnc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    const limpio = rnc.replace(/\D/g, '')
    // DGII solo acepta 9 dígitos (RNC de empresa) u 11 (cédula).
    if (limpio.length !== 9 && limpio.length !== 11) {
      setError('El RNC debe tener 9 dígitos (empresa) u 11 (cédula).')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await updateClient({ id: cliente.id, rnc: limpio })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      toast.success(`RNC guardado para ${cliente.nombre}.`)
      onGuardado(limpio)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el RNC.')
      setGuardando(false)
    }
  }

  return (
    <Modal
      title="Agregar RNC"
      sub={cliente.nombre}
      icon="user-check"
      onClose={onClose}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Btn>
        </>
      }
    >
      <div className="field">
        <label className="label">RNC o cédula</label>
        <input
          className="input mono"
          value={rnc}
          onChange={(e) => { setRnc(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void guardar() }}
          placeholder="131000000"
          inputMode="numeric"
          autoFocus
        />
        {error && <div className="err-msg"><Icon name="alert-circle" size={13} />{error}</div>}
        <div className="text-xs muted-3" style={{ marginTop: 6 }}>
          Se guarda en la ficha del cliente, no solo en esta factura.
        </div>
      </div>
    </Modal>
  )
}

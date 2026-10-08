import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Modal, PageHead, LoadingState, ErrorState, Dropdown, MenuItem } from '@/components/ui'
import {
  ApiError, createFacturaSimple, getBranding, getClient, getEmisor, getFacturaSimple, getFacturaSimplePdf,
  listProducts, mapClientRow, mapProductRow, previewFacturaSimple, previewReciboFacturaSimple, updateFacturaSimple,
} from '@/api'
import type { DocBase64, FacturaSimpleInput, FacturaSimpleItemInput, FormatoImpresion, ReciboDatos } from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { NombreClienteLibre } from '@/features/clients/NombreClienteLibre'
import { MSG_SIN_PRECIO } from '@/features/conduces/conversion'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { useAvisoSalida } from '@/hooks/useAvisoSalida'
import { presentDocument, printDocument } from '@/lib/file'
import { hoyLocal } from '@/lib/date'
import { aNumero } from '@/lib/format'
import { admiteDecimales, problemaCantidad, useUnidadesMedida } from '@/components/unidadesMedida'
import { useAnchoTirilla } from '@/stores/impresora'
import { imprimirRecibo, type OrigenRecibo } from './imprimirRecibo'
import { VistaPreviaRecibo } from './VistaPreviaRecibo'
import { lineaQueCuadra, r2, redondear } from './montosLinea'
import type { Cliente, FacturaSimplePrefill, Producto } from '@/types/domain'
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

interface Linea {
  id: number
  /** Producto del catalogo del que salio la linea (vacio = linea libre). */
  prodId: string
  descripcion: string
  cantidad: number
  precio: number
  /** Descuento de la linea en %, igual que en la factura con comprobante. */
  desc: number
  /**
   * Unidad DGII de la linea: la del producto del catalogo. null = no se sabe
   * (linea libre, o linea vieja guardada con la Unidad por defecto): no viaja y
   * el backend usa la del producto, si lo hay.
   */
  unidadMedida: number | null
}

const lineaVacia = (id: number, desc = 0): Linea => ({
  id, prodId: '', descripcion: '', cantidad: 1, precio: 0, desc, unidadMedida: null,
})

/**
 * % de descuento que reproduce el monto guardado. Con 2 decimales a veces no
 * sale (7.77 sobre 254.24 da 3.06% → 7.78) y reabrir la factura cambiaba el
 * descuento en un centavo al guardar; se usan los decimales que hagan falta.
 */
function pctDescuento(monto: number, cantidad: number, precio: number): number {
  const bruto = r2(cantidad * precio)
  if (!(monto > 0) || !(bruto > 0)) return 0
  const exacto = (monto / (cantidad * precio)) * 100
  for (let d = 2; d <= 6; d++) {
    const pct = redondear(exacto, d)
    if (Math.min(bruto, r2((cantidad * precio * pct) / 100)) === monto) return pct
  }
  return redondear(exacto, 2)
}

/**
 * Metodos de pago que son venta a CREDITO (tipo_pago=2). Igual que en la factura
 * con comprobante: transferencia, tarjeta y cheque son cobros de contado.
 */
const METODOS_CREDITO = ['Credito 30 dias']
const esMetodoCredito = (m: string) => METODOS_CREDITO.includes(m)

/* FISCALO — Facturas simples: alta y edición (POST/PUT /api/facturas-simples).
   La pantalla tiene forma de documento: se escribe sobre el papel y cada dato
   queda donde va a imprimirse. Estilos en styles/factura-doc.css.
   Documento interno: no se envía a la DGII, no lleva e-NCF ni NCF fiscal.
   `prefill` llega al convertir una cotización (Ferretería): la factura nueva
   arranca con su cliente y sus líneas, y todo sigue editable. */
export function SimpleInvoiceFormView({
  nav, facturaId, prefill = null,
}: { nav: Nav; facturaId: number | null; prefill?: FacturaSimplePrefill | null }) {
  const queryClient = useQueryClient()
  const editando = facturaId != null
  // Al editar manda la factura guardada: un borrador nunca la pisa.
  const borrador = editando ? null : prefill
  // Borrador de un conduce (Facturar en Conduces): cambia los textos de la
  // conversión y no deja guardar una línea sin precio (ver sinPrecio).
  const deConduce = borrador?.origenTipo === 'conduce'

  const [cargando, setCargando] = useState(editando)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [numero, setNumero] = useState<string | null>(null)

  // Con borrador arranca con el cliente de la cotización. Es un placeholder
  // con id y nombre (igual que en la factura e-CF): el efecto de más abajo trae
  // la ficha completa y con ella sus condiciones (descuento y crédito).
  const [cliente, setCliente] = useState<Cliente | null>(() =>
    borrador && borrador.clienteId
      ? {
          id: borrador.clienteId, nombre: borrador.clienteNombre || `Cliente #${borrador.clienteId}`,
          contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
          balance: 0, facturas: 0, estado: '', desde: '',
          descuento: 0, permiteCredito: false,
        }
      : null,
  )
  const [metodo, setMetodo] = useState('Efectivo')
  const [clienteActual, setClienteActual] = useState<string | null>(null)
  /**
   * Ficha del cliente de la factura que se edita (con sus condiciones). En
   * edición el cliente se muestra solo como texto, y sin su ficha se podía
   * elegir crédito para un cliente que ya no lo tiene: el backend lo rechazaba.
   */
  const [clienteGuardado, setClienteGuardado] = useState<Cliente | null>(null)
  const [clienteLibre, setClienteLibre] = useState('')
  /** Lo escrito en el buscador de clientes sin elegir un resultado (ver ClientCombobox). */
  const [busquedaCliente, setBusquedaCliente] = useState('')
  /** Ya se intentó seguir con un problema: desde ahí los campos se marcan en rojo. */
  const [intentoFallido, setIntentoFallido] = useState(false)
  const clienteCajaRef = useRef<HTMLDivElement | null>(null)
  const [fecha, setFecha] = useState(hoyLocal)
  // Con borrador, sus líneas: el precio ya trae el ITBIS (ver conversion.ts de
  // Ferretería) y el descuento lo pone el cliente al cargar. Sin fila vacía al
  // final, como al abrir una factura guardada: "Descripción" agrega otra.
  const [lineas, setLineas] = useState<Linea[]>(() =>
    borrador && borrador.lineas.length > 0
      ? borrador.lineas.map((l, i) => ({
          id: i + 1, prodId: l.prodId ?? '', descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio,
          desc: 0, unidadMedida: l.unidadMedida ?? null,
        }))
      : [lineaVacia(1)],
  )
  const [guardando, setGuardando] = useState(false)
  const [previaBusy, setPreviaBusy] = useState<FormatoImpresion | null>(null)
  /** Tirilla sin guardar abierta en pantalla (ver VistaPreviaRecibo). */
  const [previaRecibo, setPreviaRecibo] = useState<ReciboDatos | null>(null)
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  const [buscaProd, setBuscaProd] = useState('')
  const [cambiandoCliente, setCambiandoCliente] = useState(false)
  const [pdfBusy, setPdfBusy] = useState<FormatoImpresion | null>(null)
  const anchoTirilla = useAnchoTirilla()
  /** Foto del documento tal como se cargó: sirve para marcar qué se tocó. */
  const [original, setOriginal] = useState<{ fecha: string; metodo: string; lineas: Linea[] } | null>(null)

  // Identidad del emisor: el papel muestra los mismos datos que se van a
  // imprimir. Misma clave de caché que Configuración, así no se repite la
  // petición al navegar entre las dos pantallas.
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  // Qué unidades admiten fracciones (metro, kilo) y cuáles se cuentan enteras.
  const unidades = useUnidadesMedida()

  // La busqueda del catalogo va al servidor: hay cientos de articulos y filtrar
  // solo la primera pagina dejaria fuera la mayoria. Con el buscador vacio se
  // reusa la misma clave de cache que el resto de la app.
  const [buscaProdDebounced, setBuscaProdDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setBuscaProdDebounced(buscaProd.trim()), 300)
    return () => clearTimeout(t)
  }, [buscaProd])

  const productos = useApiQuery(
    buscaProdDebounced ? ['products', 'list', buscaProdDebounced] : ['products', 'list'],
    () => listProducts({ pageSize: 100, query: buscaProdDebounced || undefined }),
    { keepPrevious: true },
  )

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
        // Sus condiciones (crédito) llegan aparte. Si fallan no se bloquea nada:
        // el backend sigue validando el crédito al guardar.
        if (f.client_id) {
          getClient(f.client_id)
            .then((row) => { if (vivo && row) setClienteGuardado(mapClientRow(row)) })
            .catch(() => {})
        }
        // El backend solo guarda contado/credito: cualquier cobro de contado
        // vuelve como Efectivo.
        const metodoCargado = Number(f.tipo_pago ?? 1) === 2 ? METODOS_CREDITO[0] : 'Efectivo'
        setMetodo(metodoCargado)
        if (f.date) setFecha(String(f.date).slice(0, 10))
        const cargadas: Linea[] = (f.items ?? []).map((it, i) => {
          // Llegan como texto DECIMAL ("1.500", "84.7500"). En las filas de antes
          // de la migración 025 la cantidad (INT) o el precio (2 decimales) ya no
          // son los que dieron el importe: se toman los que lo explican, o
          // guardar cualquier otro cambio reescribía la línea (1.5 m guardado
          // como 2 × 100 = 150 pasaba a 200, y el inventario con él). Modo
          // 'simple': la misma regla con la que el backend imprime esta factura.
          const descuento = aNumero(it.descuento_monto)
          const { cantidad, precio } = lineaQueCuadra(
            aNumero(it.quantity ?? 1),
            aNumero(it.amount),
            it.subtotal == null || it.subtotal === '' ? null : aNumero(it.subtotal),
            descuento,
            'simple',
          )
          // La Unidad (43) es también lo que se guardaba cuando el formulario no
          // mandaba unidad: en una línea vieja no dice nada. Sin unidad no viaja
          // y el backend toma la del producto.
          const unidad = Number(it.unidad_medida ?? 0)
          return {
            id: i + 1,
            prodId: it.product_id ? String(it.product_id) : '',
            descripcion: it.description ?? '',
            cantidad,
            precio,
            // El backend guarda el descuento en monto; la UI lo maneja en %.
            desc: pctDescuento(descuento, cantidad, precio),
            unidadMedida: unidad > 0 && unidad !== 43 ? unidad : null,
          }
        })
        setLineas(cargadas)
        setOriginal({ fecha: String(f.date ?? '').slice(0, 10), metodo: metodoCargado, lineas: cargadas })
        setErrorCarga(null)
      })
      .catch((e) => { if (vivo) setErrorCarga(e instanceof ApiError ? e.message : 'No se pudo cargar la factura.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [facturaId])

  // Borrador de una cotización: el cliente llegó como placeholder. Se trae su
  // ficha con la misma consulta que la factura e-CF y se aplican sus
  // condiciones como al elegirlo a mano (seleccionarCliente): su descuento pasa
  // a las líneas y, sin crédito, el pago queda de contado.
  const borradorClienteId = borrador?.clienteId ? Number(borrador.clienteId) : null
  const clienteEnriquecido = useRef(false)
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', borradorClienteId],
    () => (borradorClienteId ? getClient(borradorClienteId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    // Una sola vez, y solo si sigue siendo ese cliente: si el usuario ya
    // eligió otro, valen las condiciones del que eligió.
    if (!clienteEnriquecido.current && row && cliente && String(row.id) === cliente.id) {
      clienteEnriquecido.current = true
      const completo = mapClientRow(row)
      setCliente(completo)
      // Las líneas del borrador arrancan en 0%: con descuento queda igual que
      // seleccionarCliente, y sin él no pisa uno escrito mientras cargaba.
      if (completo.descuento > 0) setLineas((ls) => ls.map((l) => ({ ...l, desc: completo.descuento })))
      if (!completo.permiteCredito) setMetodo((m) => (esMetodoCredito(m) ? 'Efectivo' : m))
    }
  }, [clienteDetalle.data, cliente])

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
      // Sin esto toda línea se imprimía como UND, también el cable por metro, y
      // no había con qué saber si la cantidad admite fracciones.
      unidadMedida: p.unidadMedida || 43,
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

  // Ya viene filtrado por el servidor: no se vuelve a filtrar en memoria.
  const catalogo = (productos.data?.items ?? []).map(mapProductRow)

  // Neto de descuento: el backend guarda el subtotal ya rebajado, asi que la
  // pantalla tiene que mostrar lo mismo. Sin impuestos: la factura simple es un
  // documento interno, no se emite a la DGII y no lleva ITBIS.
  //
  // Mismas cuentas que facturaModel::normalizeSimpleItems y con su redondeo (r2
  // imita el round() de PHP 8.3): con Math.round, 0.5 × 19.99 se veía 9.99 y se
  // guardaba 10.00. Cantidad a 3 decimales y precio a 4, lo que guarda la base.
  const cantDe = (l: Linea) => redondear(l.cantidad, 3)
  const precioDe = (l: Linea) => redondear(l.precio, 4)
  const brutoDe = (l: Linea) => r2(cantDe(l) * precioDe(l))
  const descuentoDe = (l: Linea) =>
    l.desc > 0 ? Math.min(brutoDe(l), r2((cantDe(l) * precioDe(l) * l.desc) / 100)) : 0
  const subtotalDe = (l: Linea) => r2(brutoDe(l) - descuentoDe(l))
  const subtotal = r2(lineas.reduce((c, l) => c + subtotalDe(l), 0))
  const total = subtotal

  // --- Qué se tocó respecto al documento cargado -------------------------
  // Se compara contra la foto inicial en vez de llevar un flag "sucio": así el
  // usuario ve el campo exacto que cambió, y si lo devuelve a su valor original
  // la marca desaparece sola.
  const lineaOriginal = (id: number) => original?.lineas.find((o) => o.id === id)
  const esLineaNueva = (id: number) => original != null && lineaOriginal(id) === undefined
  const campoCambiado = (l: Linea, k: 'descripcion' | 'cantidad' | 'precio' | 'desc') => {
    if (original == null) return false
    const o = lineaOriginal(l.id)
    return o ? o[k] !== l[k] : true
  }
  const clienteCambiado = original != null && (cliente != null || clienteLibre.trim() !== '')
  const fechaCambiada = original != null && original.fecha !== fecha
  // Solo cuenta pasar de contado a credito o al reves: Efectivo, Transferencia,
  // Tarjeta y Cheque se guardan igual (tipo_pago=1).
  const metodoCambiado = original != null && esMetodoCredito(original.metodo) !== esMetodoCredito(metodo)
  const lineasBorradas = original != null && original.lineas.some((o) => !lineas.some((l) => l.id === o.id))
  const lineasCambiadas = original != null && (
    lineasBorradas ||
    lineas.some((l) => esLineaNueva(l.id) ||
      (['descripcion', 'cantidad', 'precio', 'desc'] as const).some((k) => campoCambiado(l, k)))
  )
  const hayCambios = clienteCambiado || fechaCambiada || metodoCambiado || lineasCambiadas
  const marca = (cond: boolean) => (cond ? ' fx-mod' : '')

  const esValida = (l: Linea) => l.descripcion.trim() !== '' && l.cantidad > 0
  /**
   * Fila sin contenido facturable: la que el formulario deja siempre al final.
   * Se descarta sin avisar porque no hay nada que perder.
   *
   * La cantidad NO cuenta como contenido a proposito: vaciar ese campo da
   * Number('') === 0, y bloquear el guardado por una fila por lo demas vacia
   * seria pedirle al usuario que arregle algo que no escribio. En cuanto la fila
   * tiene descripcion, precio, producto o descuento, una cantidad <= 0 si
   * bloquea (ver lineasIncompletas).
   */
  const estaEnBlanco = (l: Linea) =>
    l.descripcion.trim() === '' && l.precio === 0 && l.prodId === '' && l.desc === 0

  const lineasValidas = lineas.filter(esValida)

  /**
   * Lineas CON datos que no se guardarian. Antes se descartaban en silencio: al
   * guardar, el PUT reemplaza todas las lineas, asi que borrar una descripcion
   * para reescribirla hacia desaparecer su importe de la factura para siempre.
   * La unica senal era un total que bajaba solo.
   */
  const lineasIncompletas = lineas
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !esValida(l) && !estaEnBlanco(l))
    .map(({ l, n }) => ({
      n,
      motivo: l.descripcion.trim() === '' ? 'falta la descripción' : 'la cantidad debe ser mayor que 0',
    }))

  /**
   * Factura de un conduce: línea que se guardaría sin precio. El conduce no
   * muestra precios y su "Línea libre" se guarda en 0: se pide escribirlo en
   * vez de guardar la mercancía regalada. Sin conduce, el precio 0 se sigue
   * aceptando como hoy.
   */
  const sinPrecio = (l: Linea) => deConduce && esValida(l) && l.precio === 0
  const haySinPrecio = lineas.some(sinPrecio)

  /**
   * Cantidad heredada: la misma que tenía, al abrir la factura, una línea del
   * mismo producto. Una factura vieja pudo guardar 1.5 en un producto que hoy
   * se cuenta entero; el backend no le aplica la regla de la unidad a esa
   * línea mientras la cantidad no cambie (facturaModel::problemaCantidadesSimples
   * con las líneas guardadas), así que aquí tampoco se marca. `original` trae
   * la cantidad ya resuelta, la misma que el backend deriva de la fila.
   */
  const cantidadHeredada = (l: Linea) => original != null
    && original.lineas.some((o) => o.prodId === l.prodId && Math.abs(o.cantidad - l.cantidad) < 1e-9)

  /**
   * Cantidades que el backend rechazaría: fracciones en una unidad que se cuenta
   * entera (la del producto: unidad, caja) o más de 3 decimales. Una línea libre
   * no tiene unidad, así que ahí solo cuenta el tope de decimales; una cantidad
   * heredada, tampoco (mayor que 0 y hasta 3 decimales sí). Mismos textos que
   * el backend.
   */
  const problemaCantidadDe = (l: Linea) => problemaCantidad(l.cantidad, {
    unidadId: l.prodId && !cantidadHeredada(l) ? l.unidadMedida : null, catalogo: unidades, maxDecimales: 3,
  })
  const cantidadesMal = lineas
    .map((l, i) => ({ n: i + 1, id: l.id, motivo: esValida(l) ? problemaCantidadDe(l) : null }))
    .filter((x): x is { n: number; id: number; motivo: string } => x.motivo != null)
  const cantidadMal = (l: Linea) => cantidadesMal.some((x) => x.id === l.id)
  const textoCantidadMal = (x: { n: number; motivo: string }) =>
    `Línea ${x.n}: ${x.motivo.charAt(0).toLowerCase()}${x.motivo.slice(1)}`

  const clienteResuelto = cliente != null || clienteLibre.trim() !== '' || clienteActual != null

  // --- Qué impide guardar, dicho con palabras ---------------------------
  // Los botones se deshabilitan, así que cada motivo se muestra junto a ellos:
  // antes quedaban en gris sin que se supiera por qué.

  // Texto en el buscador sin elegir resultado: se ve como un cliente puesto,
  // pero no viaja. Cuenta aunque haya cliente actual (edición): quien lo
  // escribió quería cambiarlo, y guardar con el anterior sería un cambio mudo.
  const busquedaPendiente = cliente == null && clienteLibre.trim() === '' ? busquedaCliente : ''
  const problemaCliente = busquedaPendiente
    ? `«${busquedaPendiente}» no está elegido: elígelo de la lista o escríbelo como nombre.`
    : !clienteResuelto ? 'Elige un cliente de la lista o escribe su nombre abajo.' : null
  // Una fecha vacía llegaba al servidor y fallaba al guardar con un error técnico.
  const problemaFecha = fecha ? null : 'Pon la fecha de la factura.'
  // El crédito lo decide el cliente elegido o, al editar sin cambiarlo, el de
  // la factura: el backend valida contra ese aunque se escriba un nombre libre.
  const clienteCredito = cliente ?? (editando ? clienteGuardado : null)
  const sinCredito = clienteCredito != null && !clienteCredito.permiteCredito
  const problemaCredito = sinCredito && esMetodoCredito(metodo)
    ? 'Este cliente no tiene crédito habilitado: cambia el pago a contado.'
    : null
  const motivoBloqueo = problemaCliente ?? problemaFecha ?? problemaCredito
    ?? (lineasValidas.length === 0 ? 'Agrega al menos una línea con descripción.' : null)
    ?? (lineasIncompletas.length > 0 ? 'Completa o quita las líneas marcadas en rojo.' : null)
    ?? (cantidadesMal.length > 0 ? 'Corrige la cantidad de las líneas marcadas en rojo.' : null)
    ?? (haySinPrecio ? 'Escribe el precio de las líneas marcadas en rojo.' : null)
    ?? (editando && !hayCambios ? 'No hay cambios que guardar.' : null)
  const puedeGuardar = motivoBloqueo == null && !guardando
  const marcarCliente = intentoFallido && problemaCliente != null

  const items = (): FacturaSimpleItemInput[] =>
    lineasValidas.map((l) => ({
      ...(l.prodId ? { product_id: Number(l.prodId) } : {}),
      description: l.descripcion.trim(),
      // Los mismos valores con los que se calculó el importe en pantalla.
      quantity: cantDe(l),
      amount: precioDe(l),
      ...(l.unidadMedida != null ? { unidad_medida: String(l.unidadMedida) } : {}),
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

  /**
   * La tirilla va derecho a imprimir; la hoja se abre para verla. `recibo` dice
   * de dónde sale la tirilla y `hoja` cómo pedir el PDF carta.
   */
  const mostrar = async (formato: FormatoImpresion, recibo: OrigenRecibo, hoja: () => Promise<DocBase64>) => {
    if (formato !== 'pos') { presentDocument(await hoja()); return }
    if (!(await imprimirRecibo(recibo))) toast.info('Recibo abierto: imprímelo con Ctrl+P.')
  }

  /** La factura tal como está guardada (no la edición en curso). */
  const verGuardada = async (formato: FormatoImpresion = 'carta') => {
    if (facturaId == null) return
    setPdfBusy(formato)
    try {
      await mostrar(formato, { tipo: 'simple', id: facturaId }, () => getFacturaSimplePdf(facturaId))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo abrir la factura.')
    } finally {
      setPdfBusy(null)
    }
  }

  /**
   * Lo que hay en pantalla, sin guardar, para revisarlo. La hoja carta se abre
   * como PDF; la tirilla se ve dentro de la app, sellada (ver VistaPreviaRecibo).
   */
  const vistaPrevia = async (formato: FormatoImpresion) => {
    // Lo mismo que exige guardar (salvo las líneas a medias, que la vista previa
    // simplemente no muestra). Sin esto el servidor respondía con un texto técnico.
    const problema = problemaCliente ?? problemaFecha
      ?? (lineasValidas.length === 0 ? 'Agrega al menos una línea con descripción.' : null)
      ?? (cantidadesMal.length > 0 ? textoCantidadMal(cantidadesMal[0]) : null)
    if (problema) {
      setIntentoFallido(true)
      toast.error(problema)
      if (problemaCliente) clienteCajaRef.current?.querySelector<HTMLInputElement>('input')?.focus()
      return
    }
    // Pasó la revisión: la marca roja del cliente vale para el último intento, no
    // para siempre (si después se quita el cliente, no debe salir marcado de golpe).
    setIntentoFallido(false)
    setPreviaBusy(formato)
    try {
      // En edición viaja el id de la factura: el backend juzga las cantidades
      // contra sus líneas guardadas, igual que al guardar (ver cantidadHeredada).
      // Sin él, una línea vieja que sí se deja guardar no se dejaba ver.
      const input: FacturaSimpleInput & { factura_id?: number } = {
        ...clienteBody(true), date: fecha, items: items(), ...(facturaId != null ? { factura_id: facturaId } : {}),
      }
      if (formato === 'pos') setPreviaRecibo(await previewReciboFacturaSimple(input))
      else presentDocument(await previewFacturaSimple(input))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.')
    } finally {
      setPreviaBusy(null)
    }
  }

  // Salir con la factura a medias pide confirmación. Una nueva cuenta en cuanto
  // tiene algo escrito; una existente, cuando se tocó algo.
  const hayAlgoEscrito = cliente != null || clienteLibre.trim() !== '' || lineas.some((l) => !estaEnBlanco(l))
  const salida = useAvisoSalida(
    editando ? hayCambios : hayAlgoEscrito,
    editando
      ? `Los cambios de la factura ${numero ?? ''} no se han guardado. Si sales ahora, se pierden.`
      : 'Esta factura no se ha guardado: no tiene número, no descontó inventario y no aparecerá en las ventas. Si sales ahora, se pierde.',
    // Mientras se guarda no se pregunta: la navegación espera a que termine.
    guardando,
  )

  // El guardado sigue aunque la pantalla se cierre a mitad (p. ej. la sesión
  // venció): en ese caso no debe navegar ni imprimir desde una vista que ya no está.
  const montado = useRef(false)
  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  /**
   * Acción única: un doble clic crearia la misma factura dos veces. Guardar e
   * imprimir comparten el candado porque imprimir también guarda.
   *
   * La tirilla sale siempre de la factura ya guardada. Una impresa desde la
   * pantalla era igual a una venta de verdad, pero sin número, sin descontar
   * inventario y sin quedar en ventas: se entregaba al cliente y la factura no
   * se guardaba nunca.
   *
   * @param imprimir Formato en que se imprime al terminar; null = solo guardar.
   */
  const guardar = useAccionUnica(async (imprimir: FormatoImpresion | null) => {
    if (!puedeGuardar) return
    setGuardando(true)
    let id: number | undefined
    try {
      if (editando && facturaId != null) {
        await updateFacturaSimple(facturaId, { ...clienteBody(), date: fecha, tipo_pago: esMetodoCredito(metodo) ? 2 : 1, items: items() })
        id = facturaId
        toast.success('Factura simple actualizada.')
      } else {
        const creada = await createFacturaSimple({ ...clienteBody(), date: fecha, tipo_pago: esMetodoCredito(metodo) ? 2 : 1, items: items() })
        id = creada?.id
        toast.success(`Factura simple ${creada?.no_factura ?? ''} creada.`)
      }
      await queryClient.invalidateQueries({ queryKey: ['facturas-simples'] })
      if (!montado.current) return
      salida.liberar()
      nav('facturas-simples', null, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la factura.')
      return
    } finally {
      setGuardando(false)
    }
    if (imprimir == null) return

    // Ya guardada: si la impresión falla, la factura queda y se reimprime
    // desde el listado, que es donde ya está el usuario.
    const recibo = imprimir === 'pos'
    const noImpresa = recibo
      ? 'La factura se guardó, pero no se pudo imprimir el recibo. Imprímelo desde el listado.'
      : 'La factura se guardó, pero no se pudo imprimir. Imprímela desde el listado.'
    if (id == null) {
      // Sin el id no hay de dónde pedir el documento; la factura sí quedó.
      console.warn('[factura simple] la respuesta del guardado no trae el id; no se imprime')
      toast.error(noImpresa)
      return
    }
    try {
      const conDialogo = recibo
        ? await imprimirRecibo({ tipo: 'simple', id })
        : await printDocument(await getFacturaSimplePdf(id, 'carta'))
      if (!conDialogo) toast.info(recibo ? 'Recibo abierto: imprímelo con Ctrl+P.' : 'Factura abierta: imprímela con Ctrl+P.')
    } catch (e) {
      // El motivo del servidor va en su propia línea: trae su puntuación (y a
      // veces su propio consejo), y pegado a la frase quedaba "de nuevo.. Imprímela".
      toast.error(noImpresa, e instanceof ApiError ? { description: e.message } : undefined)
    }
  })

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

  // Avisos bajo el banner de la conversión: lo que el origen no copió y, ya
  // con el cliente cargado, su descuento fijo, que hace que el total no sea el
  // de la cotización. Un conduce no tiene total: solo se dice que sus precios
  // llevan el descuento.
  const pctCliente = cliente?.descuento ?? 0
  const avisosConversion = borrador
    ? [
        ...(borrador.avisos ?? []),
        ...(pctCliente > 0
          ? [deConduce
              ? `Se aplicó el descuento fijo del cliente (${pctCliente}%) a los precios del conduce.`
              : `Se aplicó el descuento fijo del cliente (${pctCliente}%): el total difiere del de la cotización.`]
          : []),
      ]
    : []

  return (
    <div className="page fx-desk">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('facturas-simples')}>
          Facturas simples
        </Btn>
        {borrador && (
          <div className="col" style={{ alignItems: 'flex-end', textAlign: 'right', gap: 4, minWidth: 0 }}>
            <span className="row gap-sm text-sm" style={{ color: 'var(--info)' }}>
              <Icon name="file-plus" size={15} />
              {deConduce
                ? `Convertida desde el conduce ${borrador.origen} · cada precio ya incluye su ITBIS`
                : `Convertida desde la cotización ${borrador.origen} · cada precio ya incluye su ITBIS`}
            </span>
            {avisosConversion.map((a, i) => (
              <span key={i} className="row gap-sm text-xs" style={{ color: 'var(--warning)' }}>
                <Icon name="alert-triangle" size={13} />
                {a}
              </span>
            ))}
          </div>
        )}
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
              className={'fx-field' + marca(fechaCambiada) + (problemaFecha ? ' fx-field--err' : '')}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={{ textAlign: 'right', width: 'auto' }}
              aria-invalid={problemaFecha ? true : undefined}
            />
            {problemaFecha && <span className="fx-err"><Icon name="alert-circle" size={12} />{problemaFecha}</span>}
          </div>
        </header>

        <div className="fx-rule" />

        {/* --- Receptor --- */}
        <section className="fx-a-quien">
          <span className="fx-eyebrow">Facturar a <span className="req">*</span></span>

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
            <div className="fx-cliente" ref={clienteCajaRef}>
              <ClientCombobox
                value={cliente}
                onChange={seleccionarCliente}
                onBusquedaChange={setBusquedaCliente}
                invalido={marcarCliente}
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
          {!cliente && (
            <NombreClienteLibre
              value={clienteLibre}
              onChange={setClienteLibre}
              onGuardado={(c) => { seleccionarCliente(c); setClienteLibre('') }}
              className={marca(clienteCambiado && clienteLibre.trim() !== '')}
            />
          )}
          </>
          )}
          {marcarCliente && <span className="fx-err"><Icon name="alert-circle" size={12} />{problemaCliente}</span>}
          <div style={{ marginTop: 12 }}>
            <span className="fx-eyebrow">Pago</span>
            <select
              className={'fx-cond-sel' + marca(metodoCambiado)}
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              aria-label="Método de pago"
            >
              {METODOS_PAGO.map((m) => (
                <option key={m} disabled={esMetodoCredito(m) && sinCredito}>{m}</option>
              ))}
            </select>
            {/* Factura a crédito de un cliente que ya no lo tiene (al editar):
                no se cambia sola a contado, pero así no se puede guardar. */}
            {problemaCredito ? (
              <span className="fx-err"><Icon name="alert-circle" size={12} />{problemaCredito}</span>
            ) : sinCredito && (
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
            <span style={{ textAlign: 'right' }}>Importe</span>
          </div>

          {lineas.map((l, i) => (
            <div
              className={'fx-grid fx-row' + (esLineaNueva(l.id) ? ' fx-row-nueva' : '')
                + ((!esValida(l) && !estaEnBlanco(l)) || cantidadMal(l) || sinPrecio(l) ? ' fx-row-incompleta' : '')}
              key={l.id}
            >
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
                className={'fx-field fx-desc' + marca(campoCambiado(l, 'descripcion'))
                  + (l.descripcion.trim() === '' && !estaEnBlanco(l) ? ' fx-field--err' : '')}
                inputRef={i === lineas.length - 1 ? ultimaDescRef : undefined}
                placeholder="Concepto o artículo…"
                value={l.descripcion}
                onValue={(v) => updLinea(l.id, { descripcion: v })}
                onEnter={addLinea}
                aria-label={`Descripción de la línea ${i + 1}`}
              />

              {/* Paso y teclado según la unidad del producto: un producto por
                  unidad o caja se cuenta entero; uno por metro o kilo, no. */}
              <input
                className={'fx-field fx-num fx-cell' + marca(campoCambiado(l, 'cantidad'))
                  + ((l.cantidad <= 0 && !estaEnBlanco(l)) || cantidadMal(l) ? ' fx-field--err' : '')} data-label="Cant."
                type="number" min={0}
                step={l.prodId && !admiteDecimales(l.unidadMedida, unidades) ? 1 : 'any'}
                inputMode={l.prodId && !admiteDecimales(l.unidadMedida, unidades) ? 'numeric' : 'decimal'}
                aria-invalid={cantidadMal(l) ? true : undefined}
                value={l.cantidad}
                onChange={(e) => updLinea(l.id, { cantidad: Number(e.target.value) })}
                aria-label={`Cantidad de la línea ${i + 1}`}
              />

              <input
                className={'fx-field fx-num fx-cell' + marca(campoCambiado(l, 'precio'))
                  + (sinPrecio(l) ? ' fx-field--err' : '')} data-label="Precio"
                type="number" min={0} step="any" inputMode="decimal"
                aria-invalid={sinPrecio(l) ? true : undefined}
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

              <span className="fx-importe fx-cell" data-label="Importe">
                <Money value={subtotalDe(l)} cur={false} />
              </span>

              {/* En su propio renglón de la cuadrícula, bajo la línea: en la
                  columna del precio no cabe. */}
              {sinPrecio(l) && (
                <span className="fx-err" style={{ gridColumn: '1 / -1' }}>
                  <Icon name="alert-circle" size={12} />{MSG_SIN_PRECIO}
                </span>
              )}
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

          {/* Lineas con datos que no se guardarian: se dicen en voz alta y
              bloquean el guardado, en vez de desaparecer sin dejar rastro. */}
          {lineasIncompletas.length > 0 && (
            <div className="fx-incompletas" role="alert">
              <Icon name="alert-circle" size={14} />
              <span>
                {lineasIncompletas.length === 1
                  ? `La línea ${lineasIncompletas[0].n} no se guardará: ${lineasIncompletas[0].motivo}.`
                  : `Estas líneas no se guardarán: ${lineasIncompletas.map((x) => `${x.n} (${x.motivo})`).join(', ')}.`}
                {' '}Complétalas o quítalas con la ✕.
              </span>
            </div>
          )}
          {/* Cantidades que no se pueden guardar así (fracción en una unidad
              que se cuenta entera, o demasiados decimales): bloquean el guardado. */}
          {cantidadesMal.length > 0 && (
            <div className="fx-incompletas" role="alert">
              <Icon name="alert-circle" size={14} />
              <span>{cantidadesMal.map(textoCantidadMal).join(' ')}</span>
            </div>
          )}
        </section>

        {/* --- Totales --- */}
        <section className="fx-totales">
          <div className="fx-totales-box">
            <div className="fx-total-linea">
              <span>Subtotal</span><span><Money value={subtotal} cur={false} /></span>
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
        <div className="row gap-sm fx-acciones">
          {/* Factura ya creada y sin tocar: lo util es ver el documento real.
              En cuanto se modifica algo, ese PDF ya no refleja la pantalla, asi
              que el boton pasa a ser la vista previa de lo editado. */}
          {/* La tirilla sale siempre de la factura guardada: sin tocar, se
              imprime tal cual; nueva o con cambios, se guarda primero (ver guardar). */}
          {editando && !hayCambios ? (
            <>
              <Btn variant="secondary" icon="download" onClick={() => void verGuardada()} disabled={pdfBusy != null}>
                {pdfBusy === 'carta' ? 'Abriendo…' : 'Ver factura'}
              </Btn>
              <Btn variant="secondary" icon="printer" onClick={() => void verGuardada('pos')} disabled={pdfBusy != null}>
                {pdfBusy === 'pos' ? 'Imprimiendo…' : `Imprimir recibo ${anchoTirilla} mm`}
              </Btn>
              <span className="fx-motivo">No hay cambios que guardar.</span>
              <Btn variant="primary" icon="check" disabled title="No hay cambios que guardar.">Guardar cambios</Btn>
            </>
          ) : (
            <>
              {motivoBloqueo && !guardando && (
                // Sin role="status": el motivo cambia con cada tecla del buscador y un
                // lector de pantalla lo repetiría entero; el botón lo lleva en su title.
                <span className="fx-motivo">{motivoBloqueo}</span>
              )}
              <Dropdown
                align="right"
                width={200}
                trigger={
                  <Btn variant="secondary" icon="eye" iconRight="chevron-down" disabled={previaBusy != null}>
                    {previaBusy ? 'Generando…' : 'Vista previa'}
                  </Btn>
                }
              >
                <MenuItem icon="file" onClick={() => void vistaPrevia('carta')}>Hoja carta</MenuItem>
                <MenuItem icon="receipt" onClick={() => void vistaPrevia('pos')}>Recibo {anchoTirilla} mm</MenuItem>
              </Dropdown>

              {/* Lo de todos los días (guardar e imprimir la tirilla) va a un clic;
                  las variantes, en el menú del mismo botón. */}
              <div className="fx-split">
                <Btn
                  variant="primary" icon="printer" onClick={() => void guardar('pos')}
                  disabled={!puedeGuardar} title={motivoBloqueo ?? undefined}
                >
                  {guardando ? 'Guardando…' : `Guardar e imprimir ${anchoTirilla} mm`}
                </Btn>
                <Dropdown
                  align="right"
                  width={250}
                  trigger={
                    <Btn
                      variant="primary" icon="chevron-down" disabled={!puedeGuardar}
                      aria-label="Otras formas de guardar" title={motivoBloqueo ?? 'Otras formas de guardar'}
                    />
                  }
                >
                  <MenuItem icon="file" onClick={() => void guardar('carta')}>Guardar e imprimir en hoja carta</MenuItem>
                  <MenuItem icon="check" onClick={() => void guardar(null)}>
                    {editando ? 'Solo guardar los cambios' : 'Solo guardar'}
                  </MenuItem>
                </Dropdown>
              </div>
            </>
          )}
        </div>
      </div>

      {previaRecibo && (
        <VistaPreviaRecibo
          datos={previaRecibo}
          puedeGuardar={puedeGuardar}
          motivo={guardando ? null : motivoBloqueo}
          onGuardarEImprimir={() => { setPreviaRecibo(null); void guardar('pos') }}
          onClose={() => setPreviaRecibo(null)}
        />
      )}

      {catalogoAbierto && (
        <Modal
          title="Agregar del catálogo"
          sub="El producto trae su precio"
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
            {productos.fetching && !productos.loading && <Icon name="loader" className="spin" />}
          </div>

          {productos.loading ? (
            <LoadingState rows={4} />
          ) : productos.error ? (
            <ErrorState title="No se pudo cargar el catálogo" onRetry={productos.reload}>
              {productos.error}
            </ErrorState>
          ) : catalogo.length === 0 ? (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm muted">
                {buscaProdDebounced
                  ? `Sin resultados para "${buscaProdDebounced}".`
                  : 'No hay productos en el catálogo todavía.'}
              </span>
            </div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -10px' }}>
              {catalogo.map((p) => (
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
          // Lo que ya escribió (como nombre libre o en el buscador) no se vuelve a teclear.
          nombreInicial={clienteLibre.trim() || busquedaPendiente}
          onClose={() => setNuevoCliente(false)}
          onCreated={(c) => { seleccionarCliente(c); setClienteLibre('') }}
        />
      )}
    </div>
  )
}

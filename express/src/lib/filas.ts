// Las filas del API a tipos de verdad. PDO manda los INT y los DECIMAL como texto («11800.00»), los flags como '0' y '1' (`permitir_credito` puede ser el
// texto "0", que como texto es verdadero) y `respuesta_dgii` como texto JSON: aquí se leen una sola vez y las pantallas no vuelven a mirar el texto. Una
// fila que no es un objeto, o a la que le faltan columnas, no lanza: da los valores vacíos de cada tipo (el API no siempre manda todo, y un listado no
// puede caerse por una fila).
import { conSigno, modificaDeFila, notasDeFila } from '@/features/invoices/notasVinculadas'
import type { ComprobanteModificado, NotaVinculada } from '@/types/domain'
import { UNIDAD_POR_DEFECTO } from '~/lib/unidades'

/** Una línea de la factura (`factura_items`): precio y cantidad como números, el ITBIS de la línea y el indicador de facturación (1 es ITBIS 18 %). */
export interface LineaVista {
  descripcion: string
  cantidad: number
  precio: number
  subtotal: number
  itbis: number
  indicadorFacturacion: number
  unidad: string
}

export interface ClienteVista {
  id: number
  nombre: string
  rnc: string | null
  telefono: string | null
  email: string | null
  permiteCredito: boolean
  descuento: number
}

export interface ProductoVista {
  id: number
  nombre: string
  sku: string | null
  precio: number
  indicadorFacturacion: number
  indicadorBienServicio: 1 | 2
  unidad: string
  activo: boolean
}

/**
 * Una fila de facturas, del listado o del detalle. `rnc` sale del registro `cliente`, que solo trae GET /api/facturas?id=: es null en una fila de listado
 * y en un E32 sin cliente. `items`, `respuestaDgii` y los montos solo vienen completos en el detalle (el listado `lean` no los trae).
 */
export interface FacturaVista {
  id: number
  /** El e-NCF o, si la fila no lo tiene (un intento archivado), el número tal como se guardó. */
  numero: string
  /** El e-NCF de la fila; null si no lo tiene: no hay nada que copiar ni compartir. */
  eNcf: string | null
  /** El código sin la E: '45'. */
  tipo: string
  cliente: string
  clienteId: number | null
  rnc: string | null
  /** El DATETIME de la fila, 'AAAA-MM-DD HH:MM:SS', tal como viene. */
  fecha: string
  total: number
  /** El total con el signo con que cuenta: el de una nota de crédito (E34), negativo. */
  totalConSigno: number
  /** El `estado_dgii` tal cual lo manda el API, sin cambiarlo; '' si no hay. Qué significa lo decide lib/etiquetas. */
  estado: string
  trackId: string | null
  codigoSeguridad: string | null
  fechaEmisionDgii: string | null
  /** null si la columna no viene. */
  secuenciaUtilizada: boolean | null
  /** 1 contado, 2 crédito, 3 gratuito. */
  tipoPago: number | null
  items: LineaVista[]
  notas: NotaVinculada[]
  modifica: ComprobanteModificado | null
  codigoModificacion: string | null
  /** Lo último que dijo la DGII, ya leído del texto JSON; null si todavía no ha dicho nada. */
  respuestaDgii: unknown
  montoGravado: number | null
  montoExento: number | null
  totalItbis: number | null
}

type Fila = Record<string, unknown>

const CONSUMIDOR_FINAL = 'Consumidor final'

const esFila = (v: unknown): v is Fila => typeof v === 'object' && v !== null && !Array.isArray(v)

/** La fila como objeto: lo que no lo es (null, texto, un arreglo) es una fila sin columnas. */
const comoFila = (v: unknown): Fila => (esFila(v) ? v : {})

/** Las filas de una lista del API; lo que no es una lista, y los elementos que no son filas, no cuentan. */
const filasDe = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter(esFila) : [])

/** El texto recortado, o null si no hay: ausente, vacío o solo espacios. Un número se lee como texto: un código puede llegar de las dos maneras. */
function texto(v: unknown): string | null {
  const t = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  const limpio = t.trim()
  return limpio === '' ? null : limpio
}

/**
 * El número de lo que manda el API (un número o un DECIMAL en texto); null si no hay o no es un número: ausente, vacío o texto que no lo es. Sin -0, que
 * se vería «-0». No convierte lo que no es número ni texto (`true`, un arreglo): no es lo que el API manda y leerlo como número sería inventar.
 */
function numONulo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n || 0 : null
}

/**
 * El número de lo que manda el API: un número, o un INT o DECIMAL en texto (`"11800.00"`). 0 si no es un número. Coincide con `aNumero` de la app completa
 * (src/lib/format.ts) en todo lo que el API manda de verdad; no convierte `true` ni un arreglo.
 */
export function num(v: unknown): number {
  return numONulo(v) ?? 0
}

/**
 * ¿Vale uno? Los flags de MySQL llegan como 1, '1' o true, y 0, '0', null o '' son que no. Solo el uno es sí: un texto «verdadero» como '0' o 'false' no
 * puede dar crédito a un cliente «solo contado».
 */
export function esUno(v: unknown): boolean {
  return v === true || numONulo(v) === 1
}

/** El flag de una columna que puede no venir: null si no viene, y si viene, si es uno. */
const banderaONulo = (v: unknown): boolean | null => (v === undefined || v === null || v === '' ? null : esUno(v))

/** El nombre que se muestra de un registro de clients: razon_social, o company_name, o client_name (el orden del anexo); null si no tiene ninguno. */
const nombreDeCliente = (c: Fila): string | null => texto(c.razon_social) ?? texto(c.company_name) ?? texto(c.client_name)

/** Una fila de clients (GET /api/clients). Sin nombre, es el consumidor final. */
export function normalizarCliente(r: unknown): ClienteVista {
  const f = comoFila(r)
  return {
    id: num(f.id),
    nombre: nombreDeCliente(f) ?? CONSUMIDOR_FINAL,
    rnc: texto(f.rnc),
    telefono: texto(f.phone_number),
    email: texto(f.email),
    permiteCredito: esUno(f.permitir_credito),
    descuento: num(f.descuento),
  }
}

/**
 * Una fila de products (GET /api/products). Lo que falta toma lo que la columna trae por omisión y la app completa supone: ITBIS 18 % (indicador 1; el 0 es
 * «no facturable» y se queda en 0), un bien, la unidad por defecto (43) y activo.
 */
export function normalizarProducto(r: unknown): ProductoVista {
  const f = comoFila(r)
  return {
    id: num(f.id),
    nombre: texto(f.nombre) ?? '—',
    sku: texto(f.sku),
    precio: num(f.precio),
    indicadorFacturacion: numONulo(f.indicador_facturacion) ?? 1,
    indicadorBienServicio: numONulo(f.indicador_bien_servicio) === 2 ? 2 : 1,
    unidad: texto(f.unidad_medida) ?? UNIDAD_POR_DEFECTO,
    activo: f.activo === undefined || f.activo === null ? true : esUno(f.activo),
  }
}

/** Una fila de factura_items: el precio es el unitario sin ITBIS (amount) y la cantidad admite decimales. */
function normalizarLinea(f: Fila): LineaVista {
  return {
    descripcion: texto(f.description) ?? '',
    cantidad: num(f.quantity),
    precio: num(f.amount),
    subtotal: num(f.subtotal),
    itbis: num(f.itbis_amount),
    indicadorFacturacion: numONulo(f.indicador_facturacion) ?? 1,
    unidad: texto(f.unidad_medida) ?? UNIDAD_POR_DEFECTO,
  }
}

/**
 * `respuesta_dgii` es un texto JSON (o null si la DGII todavía no ha dicho nada). Un texto que no se puede leer, como los de las filas más viejas, se
 * conserva tal cual en lugar de perderse; lo que ya no es texto pasa como está.
 */
function leerRespuesta(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null
  if (v.trim() === '') return null
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

type FilasDeNotas = NonNullable<Parameters<typeof notasDeFila>[0]['notas']>
type DeModifica = Parameters<typeof modificaDeFila>[0]

/**
 * Una fila de facturas (GET /api/facturas, con o sin `lean`, o ?id=). El cliente es lo que se emitió (`client_name`); sin él, `company_name`, y sin ese, el
 * nombre del registro `cliente` del detalle; sin nada, el consumidor final. Las notas y el comprobante que modifica salen de notasVinculadas, como en la
 * app completa; el monto que no viene es null y el que viene en cero es 0.
 */
export function normalizarFactura(r: unknown): FacturaVista {
  const f = comoFila(r)
  const registro = comoFila(f.cliente) // el registro de clients: solo el detalle lo trae
  const tipo = texto(f.tipo_ecf) ?? ''
  const eNcf = texto(f.e_ncf)
  const total = num(f.total)
  return {
    id: num(f.id),
    numero: eNcf ?? texto(f.no_factura) ?? '',
    eNcf,
    tipo,
    cliente: texto(f.client_name) ?? texto(f.company_name) ?? nombreDeCliente(registro) ?? CONSUMIDOR_FINAL,
    clienteId: numONulo(f.client_id),
    rnc: texto(registro.rnc),
    fecha: texto(f.date) ?? '',
    total,
    totalConSigno: conSigno(tipo, total),
    // Sin recortar ni cambiar mayúsculas: lib/etiquetas lee el texto exacto, y un estado que casi coincide con uno aceptado no puede pasar por aceptado aquí.
    estado: typeof f.estado_dgii === 'string' ? f.estado_dgii : '',
    trackId: texto(f.track_id),
    codigoSeguridad: texto(f.codigo_seguridad),
    fechaEmisionDgii: texto(f.fecha_emision_dgii),
    secuenciaUtilizada: banderaONulo(f.secuencia_utilizada),
    tipoPago: numONulo(f.tipo_pago),
    items: filasDe(f.items).map(normalizarLinea),
    // notasDeFila lee cada campo de la nota y tolera los que faltan; lo único que no tolera es un elemento que no sea un objeto, y eso ya lo quitó filasDe.
    notas: notasDeFila({ notas: filasDe(f.notas) as unknown as FilasDeNotas }),
    modifica: modificaDeFila(f as DeModifica),
    codigoModificacion: texto(f.codigo_modificacion),
    // Un E32 de menos de 250 mil sale por el resumen de consumo: su respuesta (y los motivos de un rechazo) vive en `rfce_respuesta` y `respuesta_dgii` queda en null.
    respuestaDgii: leerRespuesta(f.respuesta_dgii) ?? leerRespuesta(f.rfce_respuesta),
    montoGravado: numONulo(f.monto_gravado),
    montoExento: numONulo(f.monto_exento),
    totalItbis: numONulo(f.total_itbis),
  }
}

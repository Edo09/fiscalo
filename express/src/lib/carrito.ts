// El carrito del asistente de venta (anexo 6.5): el cliente, las líneas, el pago y el plazo. Todo son funciones puras que devuelven objetos nuevos y no cambian
// lo que reciben; el estado y el almacenamiento son de screens/facturar/useWizard. Los precios son NETOS (el ITBIS va encima), así que nada de aquí calcula
// montos: eso es de lib/totales.
//
// El nombre de una línea cabe en 80 caracteres porque así lo cuenta el esquema del servidor (`nombre_item`, .max(80)): UTF-16, como `String.length`. Un nombre
// de catálogo más largo se corta SIN partir una pareja de sustitutos (un emoji) y su texto completo pasa a `descripcion` (hasta 1000).
import { redondear } from '@/features/invoices/montosLinea'
import { permiteCredito } from '~/lib/tiposEcf'
import { UNIDAD_POR_DEFECTO } from '~/lib/unidades'
import type { ClienteVista, ProductoVista } from '~/lib/filas'

/** Cuántas líneas admite una factura: el tope blando del anexo 6.5. */
export const MAX_LINEAS = 50
/** El largo máximo de `nombre_item` (DGII AlfNum80Type) y de `descripcion` (AlfNum1000Type), en unidades UTF-16. */
export const MAX_NOMBRE = 80
export const MAX_DESCRIPCION = 1000

export type Pago = 'contado' | 'credito'
/** 1 = ITBIS 18 %, 2 = 16 %, 3 = tasa cero, 4 = exento (el `indicador_facturacion` del e-CF). */
export type IndFact = 1 | 2 | 3 | 4
/** 1 = bien, 2 = servicio (`indicador_bien_servicio`). */
export type TipoItem = 1 | 2

export interface ClienteSel {
  id: number
  nombre: string
  rnc: string | null
  permiteCredito: boolean
  descuento: number
}

export interface ProductoSel {
  id: number
  nombre: string
  precio: number
  indFact: IndFact
  tipoItem: TipoItem
  unidad: string
}

export interface LineaCarrito {
  id: number
  nombre: string
  descripcion?: string
  cant: number
  /** Precio unitario SIN ITBIS. */
  precio: number
  /** Descuento en %. */
  desc: number
  indFact: IndFact
  tipoItem: TipoItem
  unidad: string
  /** Del catálogo, solo para saber si el producto ya es una línea: nunca viaja al servidor. */
  productoId?: number
}

export interface Carrito {
  tipo: string
  cliente: ClienteSel | null
  lineas: LineaCarrito[]
  pago: Pago
  plazoDias: number
  fechaLimite: string | null
  siguienteId: number
}

/** Lo que hace falta para deshacer un quitar: la línea y el lugar donde estaba. */
export interface Deshacer {
  linea: LineaCarrito
  indice: number
}

export const PLAZO_POR_DEFECTO = 30

/** Un carrito sin nada: contado, plazo de 30 días y sin fecha propia. */
export function carritoVacio(tipo: string): Carrito {
  return { tipo, cliente: null, lineas: [], pago: 'contado', plazoDias: PLAZO_POR_DEFECTO, fechaLimite: null, siguienteId: 1 }
}

/** ¿Hay algo que guardar como borrador? Un carrito sin cliente ni líneas no es un borrador. */
export function tieneContenido(c: Carrito): boolean {
  return c.cliente !== null || c.lineas.length > 0
}

/** El cliente de una fila ya leída (`normalizarCliente`): lo que el carrito recuerda de él. */
export function clienteSel(v: ClienteVista): ClienteSel {
  return { id: v.id, nombre: v.nombre, rnc: v.rnc, permiteCredito: v.permiteCredito, descuento: v.descuento }
}

/**
 * El producto de una fila ya leída (`normalizarProducto`), o null si no se puede vender: inactivo, o con un indicador de facturación que no es de 1 a 4 (el 0 es
 * «no facturable»). El precio de una fila sin precio es 0 y abre la hoja de la línea para pedirlo.
 */
export function productoSel(v: ProductoVista): ProductoSel | null {
  const ind = v.indicadorFacturacion
  if (!v.activo || v.id < 1 || (ind !== 1 && ind !== 2 && ind !== 3 && ind !== 4)) return null
  return { id: v.id, nombre: v.nombre, precio: v.precio, indFact: ind, tipoItem: v.indicadorBienServicio, unidad: v.unidad }
}

/** El mayor prefijo de `texto` que mide `max` unidades UTF-16 o menos, sin partir un carácter de dos unidades. */
export function prefijoDe(texto: string, max: number): string {
  if (texto.length <= max) return texto
  let salida = ''
  for (const caracter of texto) {
    if (salida.length + caracter.length > max) break
    salida += caracter
  }
  return salida
}

/**
 * Nombre y descripción de una línea a partir de un texto. Recorta los bordes; si cabe en `max`, es solo el nombre, y si no, el nombre es el prefijo que cabe y la
 * descripción es el texto completo (con su propio tope de 1000, sin partir una pareja).
 */
export function cortarNombre(texto: string, max: number = MAX_NOMBRE): { nombre: string; descripcion?: string } {
  const limpio = texto.trim()
  if (limpio.length <= max) return { nombre: limpio }
  return { nombre: prefijoDe(limpio, max), descripcion: prefijoDe(limpio, MAX_DESCRIPCION) }
}

/** El descuento con que nace una línea nueva: el del cliente si lo tiene (nunca más de 100). Las líneas que ya están no se tocan al cambiar de cliente. */
const descuentoInicial = (c: Carrito): number => {
  const d = c.cliente?.descuento ?? 0
  return d > 0 ? Math.min(100, d) : 0
}

function conLinea(c: Carrito, linea: Omit<LineaCarrito, 'id'>): { carrito: Carrito; lineaId: number } {
  const id = c.siguienteId
  return { carrito: { ...c, lineas: [...c.lineas, { ...linea, id }], siguienteId: id + 1 }, lineaId: id }
}

/**
 * Toca un producto del catálogo: una línea nueva de cantidad 1 con su precio neto, su indicador, su tipo y su unidad, o +1 a la línea que ya lo tenga. `abrirLinea`
 * dice que la línea sigue sin precio y hay que pedirlo. Con 50 líneas no agrega nada (`lineaId` null) pero sí suma a una existente.
 */
export function agregarProducto(c: Carrito, p: ProductoSel): { carrito: Carrito; lineaId: number | null; abrirLinea: boolean } {
  const existente = c.lineas.find((l) => l.productoId === p.id)
  if (existente !== undefined) {
    const cant = redondear(existente.cant + 1, 2)
    return { carrito: actualizarLinea(c, existente.id, { cant }), lineaId: existente.id, abrirLinea: existente.precio === 0 }
  }
  if (c.lineas.length >= MAX_LINEAS) return { carrito: c, lineaId: null, abrirLinea: false }
  const { nombre, descripcion } = cortarNombre(p.nombre)
  const linea: Omit<LineaCarrito, 'id'> = {
    nombre,
    cant: 1,
    precio: p.precio,
    desc: descuentoInicial(c),
    indFact: p.indFact,
    tipoItem: p.tipoItem,
    unidad: p.unidad,
    productoId: p.id,
  }
  if (descripcion !== undefined) linea.descripcion = descripcion
  const { carrito, lineaId } = conLinea(c, linea)
  return { carrito, lineaId, abrirLinea: p.precio === 0 }
}

/** Una línea libre en blanco, sin agregarla: con 18 %, unidad '43' y el último tipo usado (servicio la primera vez). La hoja de la línea la completa y la agrega al guardar. */
export function lineaLibre(c: Carrito, ultimoTipoItem?: TipoItem): Omit<LineaCarrito, 'id'> {
  return { nombre: '', cant: 1, precio: 0, desc: descuentoInicial(c), indFact: 1, tipoItem: ultimoTipoItem ?? 2, unidad: UNIDAD_POR_DEFECTO }
}

/** Agrega una línea libre con ese nombre (cortado a 80 si hace falta). Con 50 líneas no agrega nada. */
export function agregarLibre(c: Carrito, nombre: string, ultimoTipoItem?: TipoItem): { carrito: Carrito; lineaId: number | null } {
  if (c.lineas.length >= MAX_LINEAS) return { carrito: c, lineaId: null }
  const { nombre: corto, descripcion } = cortarNombre(nombre)
  const linea: Omit<LineaCarrito, 'id'> = { ...lineaLibre(c, ultimoTipoItem), nombre: corto }
  if (descripcion !== undefined) linea.descripcion = descripcion
  return conLinea(c, linea)
}

/** Agrega una línea ya armada (la que confirma la hoja). Con 50 líneas no agrega nada. */
export function agregarLinea(c: Carrito, linea: Omit<LineaCarrito, 'id'>): { carrito: Carrito; lineaId: number | null } {
  if (c.lineas.length >= MAX_LINEAS) return { carrito: c, lineaId: null }
  return conLinea(c, linea)
}

/** Cambia la cantidad de una línea (a 2 decimales, sin el ruido de 0.1 + 0.2). En 0 o menos la quita y devuelve cómo deshacerlo. */
export function cambiarCantidad(c: Carrito, id: number, cant: number): { carrito: Carrito; deshacer: Deshacer | null } {
  const redondeada = redondear(cant, 2)
  if (!(redondeada > 0)) {
    if (!c.lineas.some((l) => l.id === id)) return { carrito: c, deshacer: null }
    return quitarLinea(c, id)
  }
  return { carrito: actualizarLinea(c, id, { cant: redondeada }), deshacer: null }
}

/** Quita una línea; `deshacer` la devuelve a su lugar. Una línea que no existe no cambia nada. */
export function quitarLinea(c: Carrito, id: number): { carrito: Carrito; deshacer: Deshacer | null } {
  const indice = c.lineas.findIndex((l) => l.id === id)
  if (indice === -1) return { carrito: c, deshacer: null }
  return { carrito: { ...c, lineas: c.lineas.filter((l) => l.id !== id) }, deshacer: { linea: c.lineas[indice], indice } }
}

/** Devuelve una línea quitada a su lugar. No hace nada si ya está, o si mientras tanto se llegó al tope. */
export function restaurarLinea(c: Carrito, d: Deshacer): Carrito {
  if (c.lineas.some((l) => l.id === d.linea.id) || c.lineas.length >= MAX_LINEAS) return c
  const lineas = [...c.lineas]
  lineas.splice(Math.min(Math.max(0, d.indice), lineas.length), 0, d.linea)
  return { ...c, lineas, siguienteId: Math.max(c.siguienteId, d.linea.id + 1) }
}

/** Cambia campos de una línea. Una línea que no existe no cambia nada. */
export function actualizarLinea(c: Carrito, id: number, parche: Partial<Omit<LineaCarrito, 'id'>>): Carrito {
  if (!c.lineas.some((l) => l.id === id)) return c
  return { ...c, lineas: c.lineas.map((l) => (l.id === id ? { ...l, ...parche } : l)) }
}

/** Elige el cliente (o ninguno). Sin cliente, o con uno solo de contado, el pago vuelve a contado. Las líneas que ya están no se tocan. */
export function elegirCliente(c: Carrito, cliente: ClienteSel | null): Carrito {
  const contado = cliente === null || !cliente.permiteCredito
  return { ...c, cliente, ...(contado && c.pago === 'credito' ? { pago: 'contado' as const, fechaLimite: null } : {}) }
}

/** Cambia el tipo de comprobante: las líneas y el cliente se quedan (el cliente se vuelve a validar al revisar). Un tipo que no da crédito vuelve el pago a contado. */
export function cambiarTipo(c: Carrito, tipo: string): Carrito {
  return { ...c, tipo, ...(!permiteCredito(tipo) && c.pago === 'credito' ? { pago: 'contado' as const, fechaLimite: null } : {}) }
}

/** El pago: contado o crédito. Con un plazo en días (los chips) se borra la fecha propia; con una fecha, esa fecha manda. */
export function elegirPago(c: Carrito, p: { pago: Pago; plazoDias?: number; fechaLimite?: string | null }): Carrito {
  const siguiente: Carrito = { ...c, pago: p.pago }
  if (p.plazoDias !== undefined) {
    siguiente.plazoDias = p.plazoDias
    siguiente.fechaLimite = null
  }
  if (p.fechaLimite !== undefined) siguiente.fechaLimite = p.fechaLimite
  return siguiente
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const dos = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD` más `dias` días, con aritmética del calendario en UTC (sin cambios de hora). Un texto que no es una fecha se devuelve tal cual. */
export function sumarDias(iso: string, dias: number): string {
  const m = FECHA.exec(iso)
  if (m === null) return iso
  const f = new Date(0)
  f.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias)
  return `${String(f.getUTCFullYear()).padStart(4, '0')}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`
}

/** La fecha límite de pago de un crédito: la que la persona eligió o, si no, hoy más el plazo. `hoy` es el de lib/reloj. */
export function fechaLimiteEfectiva(c: Carrito, hoy: string): string {
  return c.fechaLimite ?? sumarDias(hoy, c.plazoDias)
}

// --- Leer un carrito guardado -----------------------------------------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const esIndFact = (v: unknown): v is IndFact => v === 1 || v === 2 || v === 3 || v === 4
const esTipoItem = (v: unknown): v is TipoItem => v === 1 || v === 2

function lineaDeJson(v: unknown): LineaCarrito | null {
  if (!esObjeto(v)) return null
  const { id, nombre, descripcion, cant, precio, desc, indFact, tipoItem, unidad, productoId } = v
  if (!esNumero(id) || typeof nombre !== 'string' || !esNumero(cant) || !esNumero(precio) || !esNumero(desc)) return null
  if (!esIndFact(indFact) || !esTipoItem(tipoItem) || typeof unidad !== 'string' || unidad === '') return null
  const linea: LineaCarrito = { id, nombre, cant, precio, desc, indFact, tipoItem, unidad }
  if (typeof descripcion === 'string' && descripcion !== '') linea.descripcion = descripcion
  if (esNumero(productoId)) linea.productoId = productoId
  return linea
}

function clienteDeJson(v: unknown): ClienteSel | null {
  if (!esObjeto(v)) return null
  const { id, nombre, rnc, permiteCredito, descuento } = v
  if (!esNumero(id) || id < 1 || typeof nombre !== 'string') return null
  return { id, nombre, rnc: typeof rnc === 'string' && rnc !== '' ? rnc : null, permiteCredito: permiteCredito === true, descuento: esNumero(descuento) ? descuento : 0 }
}

/**
 * Un carrito leído del almacenamiento, o null si no tiene la forma de uno. Lo guardado no es de fiar (otra versión, un texto a medias): lo que no se puede
 * leer se descarta antes que arriesgar una factura con datos inventados. Una línea ilegible se descarta sola y el resto se queda.
 */
export function carritoDeJson(v: unknown): Carrito | null {
  if (!esObjeto(v) || typeof v.tipo !== 'string' || v.tipo === '' || !Array.isArray(v.lineas)) return null
  const lineas = v.lineas.map(lineaDeJson).filter((l): l is LineaCarrito => l !== null).slice(0, MAX_LINEAS)
  const maxId = lineas.reduce((m, l) => Math.max(m, l.id), 0)
  const plazo = esNumero(v.plazoDias) && v.plazoDias > 0 ? Math.trunc(v.plazoDias) : PLAZO_POR_DEFECTO
  return {
    tipo: v.tipo,
    cliente: clienteDeJson(v.cliente),
    lineas,
    pago: v.pago === 'credito' ? 'credito' : 'contado',
    plazoDias: plazo,
    fechaLimite: typeof v.fechaLimite === 'string' && FECHA.test(v.fechaLimite) ? v.fechaLimite : null,
    siguienteId: Math.max(maxId + 1, esNumero(v.siguienteId) ? Math.trunc(v.siguienteId) : 1),
  }
}

// lib/productos: las reglas puras de los productos de Express: el precio escrito, el ITBIS, la validación del formulario, el alta, la edición que NO pierde lo que Express no muestra y las unidades.
// Sin React ni red: lo usan las pantallas de Productos y las pruebas.
//
// Lo que sabe del servidor (api-gratex productController y productModel): el PUT es un UPDATE de la fila COMPLETA de 16 columnas. Lo que no viaja se pisa: `sku`, `descripcion`, `category_id`,
// `precio_2..4`, `stock` y `stock_minimo` quedan en NULL, `costo` en 0, `activo` e `indicador_*` vuelven a 1. Express no muestra esas columnas (vienen de la app completa), así que cada edición
// LEE la fila fresca, le pone encima solo lo que el usuario cambió y manda las 16 columnas (`fusionarProducto`, `guardarEdicion`). El alta manda solo seis: sin almacén (el servidor pone el
// «Almacén Principal») ni existencia. Los precios son NETOS: el ITBIS va encima, y `montosLinea` es el único redondeo (el de PHP 8.3 de producción).
import type { CreateProductInput, UnidadMedida } from '@/api/types'
import { ApiError } from '@/api/errores'
import { montosLinea, r2 } from '@/features/invoices/montosLinea'
import { esUno, num } from '~/lib/filas'
import type { ProductoVista } from '~/lib/filas'
import { admiteDecimales, UNIDAD_POR_DEFECTO } from '~/lib/unidades'

/** Lo más largo que puede ser el nombre de un producto NUEVO: una línea de la factura lleva 80 (el catálogo guarda 150). Uno ya guardado más largo se edita sin cortarse. */
export const MAX_NOMBRE_PRODUCTO = 80

/** Las 16 columnas del UPDATE completo del servidor, en su orden: lo que la edición manda siempre. */
export const FUSION_COLUMNAS: readonly string[] = [
  'sku',
  'nombre',
  'descripcion',
  'category_id',
  'warehouse_id',
  'indicador_bien_servicio',
  'indicador_facturacion',
  'precio',
  'precio_2',
  'precio_3',
  'precio_4',
  'costo',
  'unidad_medida',
  'stock',
  'stock_minimo',
  'activo',
]

/** Lo que dice un indicador de facturación: 1 «+ ITBIS 18%», 2 «+ ITBIS 16%», 3 tasa cero, 4 exento, 0 no facturable. Un valor que no se conoce se lee como exento, que es como lo calcula `montosLinea`. */
export function etiquetaItbis(ind: number): string {
  switch (ind) {
    case 1:
      return '+ ITBIS 18%'
    case 2:
      return '+ ITBIS 16%'
    case 3:
      return 'ITBIS 0% (tasa cero)'
    case 0:
      return 'No facturable'
    default:
      return 'Exento'
  }
}

type IndicadorDeLinea = Parameters<typeof montosLinea>[0]['indFact']

/** El precio con su ITBIS encima, con el redondeo de `montosLinea` (el del servidor): 5000 al 18 % es 5900. */
export function precioConItbis(precio: number, ind: number): number {
  const m = montosLinea({ cant: 1, precio, desc: 0, indFact: ind as IndicadorDeLinea }, false)
  return r2(m.base + m.itbis)
}

// --- El precio escrito -----------------------------------------------------------------------------------------------------------------

const MILES = /^[1-9]\d{0,2}(,\d{3})+$/

/**
 * El precio escrito como número con punto decimal («1250.5»), o null si no es un número. Vacío es «0» (precio abierto). La coma es de miles si el texto también lleva punto («1,250.50») o si
 * son grupos de tres dígitos exactos («1,250», «12,345», «1,250,000»); si no, una sola coma es el decimal («1,25», «5000,5», «0,500»), y varias comas que no son de miles no es un número.
 * Un «-1» se lee como -1 para que la validación pueda decir «negativo».
 */
function normalizarPrecio(texto: string): string | null {
  const t = texto.trim()
  if (t === '') return '0'
  let limpio: string
  if (t.includes('.')) limpio = t.replace(/,/g, '')
  else if (MILES.test(t)) limpio = t.replace(/,/g, '')
  else if ((t.match(/,/g) ?? []).length <= 1) limpio = t.replace(',', '.')
  else return null
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(limpio) ? limpio : null
}

/** El precio como número; null si lo escrito no lo es. */
export function leerPrecio(texto: string): number | null {
  const n = normalizarPrecio(texto)
  return n === null ? null : Number(n)
}

/** El precio de una fila del servidor como se escribe en el campo: 5000 es «5000». */
const textoDePrecio = (precio: number): string => String(precio)

// --- El formulario ---------------------------------------------------------------------------------------------------------------------

export interface ChipItbis {
  valor: number
  etiqueta: string
  /** Es el indicador que trae el producto de la app completa (16 %, tasa cero, no facturable): se conserva si no se cambia. */
  preservado: boolean
}

/** Los chips de ITBIS: 18 % y Exento siempre, y un tercero marcado como preservado si el producto guardado tiene otro indicador (el formulario de escritorio lo aplana, Express no). */
export function chipsItbisForm(guardado: number | null): ChipItbis[] {
  const chips: ChipItbis[] = [
    { valor: 1, etiqueta: '18%', preservado: false },
    { valor: 4, etiqueta: 'Exento', preservado: false },
  ]
  if (guardado === 2) chips.push({ valor: 2, etiqueta: '16%', preservado: true })
  else if (guardado === 3) chips.push({ valor: 3, etiqueta: '0%', preservado: true })
  else if (guardado === 0) chips.push({ valor: 0, etiqueta: 'No facturable', preservado: true })
  return chips
}

export interface FormProducto {
  nombre: string
  /** Lo escrito, sin leer: la coma y el punto los resuelve `leerPrecio`. */
  precio: string
  indicador: number
  /** 1 Bien (Producto), 2 Servicio. */
  tipo: 1 | 2
  /** El código DGII de la unidad, en texto: '43' es «Unidad». */
  unidad: string
  activo: boolean
}

/** El formulario de un producto nuevo: un producto con ITBIS 18 %, en «Unidad» y disponible. */
export function formNuevoProducto(nombre = ''): FormProducto {
  return { nombre, precio: '', indicador: 1, tipo: 1, unidad: UNIDAD_POR_DEFECTO, activo: true }
}

/** El formulario de editar un producto guardado, con todo lo suyo. */
export function formDesdeProducto(p: ProductoVista): FormProducto {
  return { nombre: p.nombre, precio: textoDePrecio(p.precio), indicador: p.indicadorFacturacion, tipo: p.indicadorBienServicio, unidad: p.unidad, activo: p.activo }
}

/**
 * Qué está mal en el formulario, por campo. El nombre se juzga solo si es nuevo o si el que se escribió es distinto del guardado (un nombre viejo de 120 caracteres no impide corregir el
 * precio); la unidad, solo si el catálogo ya llegó y no es la que el producto ya tenía (sin catálogo no se bloquea nada: lo revisa el servidor).
 */
export function validarFormProducto(f: FormProducto, catalogo: UnidadMedida[], original?: ProductoVista): Partial<Record<keyof FormProducto, string>> {
  const e: Partial<Record<keyof FormProducto, string>> = {}
  const nombre = f.nombre.trim()
  if (original === undefined || nombre !== original.nombre) {
    if (nombre === '') e.nombre = 'Escribe el nombre del producto o servicio.'
    else if (nombre.length > MAX_NOMBRE_PRODUCTO) e.nombre = `El nombre no puede pasar de ${MAX_NOMBRE_PRODUCTO} caracteres.`
  }
  const texto = normalizarPrecio(f.precio)
  if (texto === null) e.precio = 'El precio tiene que ser un número.'
  else if (Number(texto) < 0) e.precio = 'El precio no puede ser negativo.'
  else if ((texto.split('.')[1] ?? '').length > 4) e.precio = 'El precio admite hasta 4 decimales.'
  else if (Number(texto) >= 1e12) e.precio = 'El precio es demasiado grande.'
  if (catalogo.length > 0 && f.unidad !== original?.unidad && !catalogo.some((u) => String(u.id) === f.unidad)) {
    e.unidad = 'Elige la unidad de medida: la que tenía no está en el catálogo de la DGII.'
  }
  return e
}

/** El cuerpo del POST /api/products: seis claves, y nunca almacén ni existencia (el servidor pone el «Almacén Principal»). */
export function payloadCrear(f: FormProducto): CreateProductInput {
  return {
    nombre: f.nombre.trim(),
    precio: leerPrecio(f.precio) ?? 0,
    indicador_facturacion: f.indicador,
    indicador_bien_servicio: f.tipo,
    unidad_medida: f.unidad,
    activo: 1,
  }
}

/** Lo que el usuario cambió de un producto guardado: solo eso se pone sobre la fila fresca. */
export type CambiosProducto = Partial<{
  nombre: string
  precio: number
  indicador_facturacion: number
  indicador_bien_servicio: number
  unidad_medida: string
  activo: 0 | 1
}>

export function cambiosProducto(original: ProductoVista, f: FormProducto): CambiosProducto {
  const c: CambiosProducto = {}
  const nombre = f.nombre.trim()
  if (nombre !== original.nombre) c.nombre = nombre
  const precio = leerPrecio(f.precio) ?? 0
  if (precio !== original.precio) c.precio = precio
  if (f.indicador !== original.indicadorFacturacion) c.indicador_facturacion = f.indicador
  if (f.tipo !== original.indicadorBienServicio) c.indicador_bien_servicio = f.tipo
  if (f.unidad !== original.unidad) c.unidad_medida = f.unidad
  if (f.activo !== original.activo) c.activo = f.activo ? 1 : 0
  return c
}

// --- La edición que no pierde nada -----------------------------------------------------------------------------------------------------

export type PutProducto = Record<string, unknown> & { id: number }

type Fila = Record<string, unknown>

/** Un número de una columna que puede ser NULL: null sigue siendo null (nunca `Number(null)`, que es 0), y un texto «640.0000» es 640. */
function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** Un texto de una columna que puede ser NULL. */
const textoONulo = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)

/**
 * El cuerpo del PUT: las 16 columnas de la fila fresca (los números como números, NULL como NULL, el costo y el ITBIS tal cual) con encima lo que cambió el usuario. No viajan ni la foto ni los
 * nombres de categoría y almacén (son de lectura). Una columna que la fila fresca no trae toma lo que el servidor pone por omisión.
 */
export function fusionarProducto(fresco: Fila, cambios: CambiosProducto): PutProducto {
  const f: Fila = typeof fresco === 'object' && fresco !== null ? fresco : {}
  const base: PutProducto = {
    id: num(f.id),
    sku: textoONulo(f.sku),
    nombre: typeof f.nombre === 'string' ? f.nombre : '',
    descripcion: textoONulo(f.descripcion),
    category_id: numeroONulo(f.category_id),
    warehouse_id: numeroONulo(f.warehouse_id),
    indicador_bien_servicio: numeroONulo(f.indicador_bien_servicio) ?? 1,
    indicador_facturacion: numeroONulo(f.indicador_facturacion) ?? 1,
    precio: numeroONulo(f.precio) ?? 0,
    precio_2: numeroONulo(f.precio_2),
    precio_3: numeroONulo(f.precio_3),
    precio_4: numeroONulo(f.precio_4),
    costo: numeroONulo(f.costo) ?? 0,
    unidad_medida: textoONulo(f.unidad_medida)?.trim() || UNIDAD_POR_DEFECTO,
    stock: numeroONulo(f.stock),
    stock_minimo: numeroONulo(f.stock_minimo),
    activo: f.activo === undefined || f.activo === null ? 1 : esUno(f.activo) ? 1 : 0,
  }
  return { ...base, ...cambios }
}

/**
 * Guarda los cambios de un producto: LEE la fila fresca antes de escribir y manda esa fila con los cambios encima. Si la lectura falla no se escribe nada (escribir a ciegas pisaría lo que no se ve).
 * Es idempotente: repetirla manda lo mismo.
 */
export async function guardarEdicion(
  d: { leer: (id: number) => Promise<Fila>; enviar: (cuerpo: PutProducto) => Promise<unknown> },
  id: number,
  cambios: CambiosProducto,
): Promise<void> {
  const fresco = await d.leer(id)
  await d.enviar({ ...fusionarProducto(fresco, cambios), id })
}

// --- El alta ---------------------------------------------------------------------------------------------------------------------------

const igualTexto = (a: unknown, b: unknown): boolean => (textoONulo(a) ?? '').trim().toLowerCase() === (textoONulo(b) ?? '').trim().toLowerCase()

/** Tras un fallo ambiguo del alta: el producto que ya está guardado con lo que se mandó (mismo nombre, precio, ITBIS, tipo y unidad), el de más id; null si no está. */
export function productoYaCreado(items: Fila[], enviado: CreateProductInput): Fila | null {
  let mejor: Fila | null = null
  for (const f of items) {
    const igual =
      igualTexto(f.nombre, enviado.nombre) &&
      numeroONulo(f.precio) === (enviado.precio ?? 0) &&
      (numeroONulo(f.indicador_facturacion) ?? 1) === (enviado.indicador_facturacion ?? 1) &&
      (numeroONulo(f.indicador_bien_servicio) ?? 1) === (enviado.indicador_bien_servicio ?? 1) &&
      (textoONulo(f.unidad_medida)?.trim() || UNIDAD_POR_DEFECTO) === (enviado.unidad_medida ?? UNIDAD_POR_DEFECTO)
    if (igual && (mejor === null || num(f.id) > num(mejor.id))) mejor = f
  }
  return mejor
}

/**
 * El texto para el usuario de un fallo al guardar un producto: el del servidor, tal cual (los de validación están escritos para quien llena el formulario), salvo el de una cuenta sin almacén
 * (el servidor pide elegir uno y Express no tiene dónde elegirlo: es de soporte). Es el único texto del servidor por el que se decide, porque ese caso no trae código.
 */
export function mensajeGuardarProducto(e: unknown): string {
  if (!(e instanceof ApiError)) return 'No se pudo guardar el producto. Inténtalo de nuevo.'
  if (e.message.includes('Elige el almacén del producto') || e.original.includes('Elige el almacén del producto')) return 'Tu cuenta no está lista para guardar productos. Contacta a soporte'
  return e.message
}

// --- La unidad -------------------------------------------------------------------------------------------------------------------------

export interface OpcionUnidad {
  id: string
  descripcion: string
  /** Una cantidad en esta unidad puede llevar decimales (metro, kilo, litro). */
  fracciones: boolean
}

/** Las unidades que se ofrecen: las del catálogo de la DGII, con su aviso de fracciones; sin el catálogo (no llegó o falló), solo «Unidad», que es la de siempre. */
export function opcionesUnidad(catalogo: UnidadMedida[]): OpcionUnidad[] {
  if (catalogo.length === 0) return [{ id: UNIDAD_POR_DEFECTO, descripcion: 'Unidad', fracciones: false }]
  return catalogo.map((u) => ({ id: String(u.id), descripcion: u.descripcion, fracciones: admiteDecimales(u.id, catalogo) }))
}

/** Cómo se llama una unidad en una tarjeta: la del catálogo; si el catálogo no llegó, «Unidad» para la de siempre y nada para otra; si llegó y no la tiene, su código. */
export function nombreDeUnidad(catalogo: UnidadMedida[], id: string): string {
  const u = catalogo.find((x) => String(x.id) === id)
  if (u !== undefined) return u.descripcion
  if (catalogo.length === 0) return id === UNIDAD_POR_DEFECTO ? 'Unidad' : ''
  return `Unidad ${id}`
}

/** El `query` de la lista de productos para lo escrito: recortado, y vacío con menos de 2 caracteres (no se busca). */
export function consultaProducto(texto: string): string {
  const t = texto.trim()
  return t.length < 2 ? '' : t
}

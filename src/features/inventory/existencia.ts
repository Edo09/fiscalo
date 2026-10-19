// Control de existencias en las ventas (spec 2026-10-19-control-existencias-ventas,
// 4.4 y 4.6): funciones puras para el error STOCK_INSUFICIENTE y para el aviso
// que las facturas dan ANTES de enviar.
//
// Con "Bloquear ventas sin existencia" activo, el API rechaza (422) una factura
// que pide más de lo que hay y manda la lista en `data.faltantes`. Aquí se lee
// esa lista, se arma el texto (el del servidor puede ser reemplazado por el
// humanizador de errores.ts, así que la pantalla no depende de él) y se arman
// las líneas con las que se abre «Ajuste de inventario».
//
// La revisión local (consumoPorProducto + faltantesLocales) es solo un AVISO: la
// existencia que ve el navegador puede tener hasta 3 minutos, y el API tiene la
// última palabra. Por eso nunca bloquea el botón de enviar.
//
// Las cantidades se comparan en MILÉSIMAS enteras (la existencia es DECIMAL(15,3)),
// igual que el API: 0.1 + 0.2 contra 0.3 pasa, 0.3 contra 0.299 falta 0.001.
//
// Imports relativos con .ts y sin '@/': scripts/test-existencia.ts corre este
// módulo con Node, sin compilar.
import { ApiError } from '../../api/errores.ts'
import { fmtCantidad } from '../../lib/format.ts'
import { redondear } from '../invoices/montosLinea.ts'

/** `codigo` con el que el API marca el rechazo por falta de existencia. */
export const CODIGO_STOCK_INSUFICIENTE = 'STOCK_INSUFICIENTE'

/** Un producto que pide más de lo que hay (una fila de `data.faltantes`, ya con claves del front). */
export interface FaltanteStock {
  productId: number
  nombre: string
  sku: string | null
  /** Código de la unidad como está en el producto (el formulario de Ajuste lo necesita para juzgar fracciones). */
  unidadMedida: string | null
  /** Lo que la venta pide en total de este producto (las líneas repetidas ya van sumadas). */
  solicitado: number
  /** Lo que hay, sin bajar de 0: nunca se dice «quedan -3». */
  disponible: number
  /** Cuánto hay que agregar para cubrir la venta (con existencia negativa es más que `solicitado - disponible`). */
  faltante: number
}

// --- Números -----------------------------------------------------------------

/** A milésimas enteras, pasando por el redondeo de 3 decimales del proyecto. */
const aMilesimas = (x: number): number => Math.round(redondear(x, 3) * 1000)
const deMilesimas = (m: number): number => m / 1000

/** Número de lo que mande el API (number o texto DECIMAL), a 3 decimales; null si no es un número. */
function aCantidad(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? redondear(n, 3) : null
}

const aTexto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// --- El error del API --------------------------------------------------------

/** Una fila de `data.faltantes` -> FaltanteStock; null si le falta el producto o una cantidad. */
function filaFaltante(fila: unknown): FaltanteStock | null {
  if (fila === null || typeof fila !== 'object') return null
  const f = fila as Record<string, unknown>
  const productId = aCantidad(f.product_id)
  const solicitado = aCantidad(f.solicitado)
  const disponible = aCantidad(f.disponible)
  const faltante = aCantidad(f.faltante)
  if (productId === null || !Number.isInteger(productId) || productId <= 0) return null
  if (solicitado === null || disponible === null || faltante === null) return null
  return {
    productId,
    nombre: aTexto(f.nombre) ?? `Producto ${productId}`,
    sku: aTexto(f.sku),
    unidadMedida: aTexto(f.unidad_medida),
    solicitado,
    disponible: Math.max(0, disponible),
    faltante,
  }
}

/**
 * Los faltantes del error STOCK_INSUFICIENTE (422 de POST /api/facturas,
 * POST/PUT /api/facturas-simples), o null si `e` es cualquier otra cosa: un 409
 * ("pantalla desactualizada"), un 422 llano (producto inexistente, cantidad <= 0),
 * un error de red. Una fila rota se descarta; si no queda ninguna, null.
 */
export function datosStockInsuficiente(e: unknown): FaltanteStock[] | null {
  if (!(e instanceof ApiError) || e.status !== 422) return null
  // Un 422 con OTRO código no es de existencia. Sin código (null) se lee igual:
  // la forma de los datos, que solo manda este error, es la que decide.
  if (e.codigo !== null && e.codigo !== CODIGO_STOCK_INSUFICIENTE) return null
  const filas = (e.datos as { faltantes?: unknown } | null | undefined)?.faltantes
  if (!Array.isArray(filas)) return null
  const faltantes = filas.map(filaFaltante).filter((f): f is FaltanteStock => f !== null)
  return faltantes.length > 0 ? faltantes : null
}

/**
 * La frase de un producto: «No hay existencia suficiente de «Cemento gris»:
 * pides 5 y hay 2.» Mismo texto que el del API, pero aquí el nombre se muestra
 * siempre (el API lo omite cuando parece una constante, por su humanizador).
 */
export function textoFaltante(f: FaltanteStock): string {
  return `No hay existencia suficiente de «${f.nombre}»: pides ${fmtCantidad(f.solicitado)} y hay ${fmtCantidad(Math.max(0, f.disponible))}.`
}

// --- Revisión local (solo un aviso) -----------------------------------------

/** Una línea de la venta, como la necesita la revisión (la pantalla la saca de su formulario). */
export interface LineaConsumo {
  /** null = línea de texto libre: no mueve existencia. */
  productId: number | null
  cantidad: number
  /** Servicio: no mueve existencia. */
  esServicio?: boolean
}

/**
 * Lo que la venta pide por producto. Suma las líneas repetidas del mismo producto
 * (comparar línea por línea dejaría pasar 2 de 3 contra una existencia de 4) y
 * se salta lo que el API no revisa: líneas sin producto, servicios, y cantidades
 * en cero o negativas (no pueden tapar la falta de otra línea).
 */
export function consumoPorProducto(lineas: LineaConsumo[]): Map<number, number> {
  const consumo = new Map<number, number>()
  for (const l of lineas) {
    if (l.esServicio || l.productId === null || !Number.isFinite(l.productId) || l.productId <= 0) continue
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) continue
    consumo.set(l.productId, redondear((consumo.get(l.productId) ?? 0) + l.cantidad, 3))
  }
  return consumo
}

/** Lo que la pantalla sabe de un producto para revisar la existencia. */
export interface ExistenciaConocida {
  /** null = Bien sin existencia anotada: cuenta como 0, igual que en el API. */
  stock: number | null
  nombre: string
  esServicio: boolean
  sku?: string | null
  unidadMedida?: string | null
}

/**
 * Los productos que piden más de lo que hay, con la existencia que la pantalla
 * conoce. `consumo` sale de consumoPorProducto. `credito` = lo que una factura
 * ya guardada tiene de cada producto: al editarla se suma a la existencia (su
 * venta se revierte antes de revisar la nueva), así que subir de 3 a 5 con
 * existencia 1 falta 1, no 4.
 *
 * Un producto que no está en `existencias` (la lista aún no cargó) no se marca:
 * no hay dato con qué compararlo. En cambio uno con `stock: null` sí cuenta como 0.
 * Ordenados por producto, como los del API.
 */
export function faltantesLocales(
  consumo: Map<number, number>,
  existencias: Map<number, ExistenciaConocida>,
  credito?: Map<number, number>,
): FaltanteStock[] {
  const faltantes: FaltanteStock[] = []
  for (const [productId, pedido] of consumo) {
    const info = existencias.get(productId)
    if (!info || info.esServicio) continue
    // `undefined` no debería llegar (el tipo no lo admite), pero un dato sin
    // cargar o ilegible no es una existencia de 0: no se marca.
    const stock = info.stock as number | null | undefined
    if (stock === undefined || (stock !== null && !Number.isFinite(stock))) continue
    const solicitadoM = aMilesimas(pedido)
    if (!(solicitadoM > 0)) continue
    const saldoM = aMilesimas(stock ?? 0) + aMilesimas(credito?.get(productId) ?? 0)
    if (solicitadoM <= saldoM) continue
    faltantes.push({
      productId,
      nombre: info.nombre,
      sku: info.sku ?? null,
      unidadMedida: info.unidadMedida ?? null,
      solicitado: deMilesimas(solicitadoM),
      disponible: deMilesimas(Math.max(0, saldoM)),
      faltante: deMilesimas(solicitadoM - saldoM),
    })
  }
  return faltantes.sort((a, b) => a.productId - b.productId)
}

/**
 * ¿El bloqueo revisa la existencia de este tipo de e-CF? Las entradas (E34 nota
 * de crédito, E41) no sacan nada del almacén y el API no las revisa. Cualquier
 * otro tipo (incluida la nota de débito E33) se revisa, igual que en el API.
 * Lo usan el aviso de las líneas y el selector de productos (el «Agotado» no se
 * pinta donde el API no lo va a exigir).
 */
export function ecfRevisaExistencia(tipoEcf: string): boolean {
  return tipoEcf !== '34' && tipoEcf !== '41'
}

/**
 * El aviso del formulario de factura electrónica: faltantesLocales según el tipo
 * de e-CF (ver ecfRevisaExistencia: de las entradas la pantalla tampoco avisa).
 */
export function faltantesLocalesEcf(
  tipoEcf: string,
  lineas: LineaConsumo[],
  existencias: Map<number, ExistenciaConocida>,
): FaltanteStock[] {
  if (!ecfRevisaExistencia(tipoEcf)) return []
  return faltantesLocales(consumoPorProducto(lineas), existencias)
}

// --- Existencia en Productos -------------------------------------------------

/** Lo que Productos muestra de la existencia de un artículo. */
export interface EstadoExistencia {
  /** La existencia que se muestra; null = «N/A» (no hay número que enseñar). */
  stock: number | null
  /** Sin existencia: sale «Agotado» en vez de «Disponible». */
  agotado: boolean
}

/**
 * La existencia de un artículo tal como la ven Productos y su lista (C18).
 *
 * Con la regla "Bloquear ventas sin existencia" activa, un Bien con la existencia
 * en blanco vale 0 y sale «Agotado»: es lo que hace el bloqueo (NULL cuenta como 0)
 * y la pantalla tiene que decir lo mismo que el API. Un servicio no tiene
 * existencia que bloquear: sigue en «N/A». Con la regla apagada nada cambia: un
 * Bien en blanco es «N/A» y «Disponible», y cualquier número ≤ 0 es «Agotado»
 * (el libro deja la existencia en negativo, y se muestra el número guardado).
 */
export function estadoExistencia(stock: number | null, esServicio: boolean, estricto: boolean): EstadoExistencia {
  const visto = estricto && !esServicio && stock === null ? 0 : stock
  return { stock: visto, agotado: visto !== null && visto <= 0 }
}

// --- Ajuste de inventario ----------------------------------------------------

/**
 * Las líneas con las que se abre «Ajuste de inventario»: una por producto, con
 * la cantidad que falta (sube la existencia hasta lo que la venta pide, también
 * cuando el saldo estaba en negativo). Un faltante que no suma nada no genera
 * línea: un ajuste de 0 no es válido.
 */
export function lineasPrefillAjuste(faltantes: FaltanteStock[]): { productId: number; cantidad: number }[] {
  return faltantes
    .filter((f) => Number.isFinite(f.faltante) && f.faltante > 0)
    .map((f) => ({ productId: f.productId, cantidad: redondear(f.faltante, 3) }))
}

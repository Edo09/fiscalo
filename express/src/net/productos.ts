// Las peticiones de Productos de Express: la lista, el detalle, el alta y la edición. Son las del servicio de la app completa (api/products.ts, que se importa por su ruta exacta: no trae zod); lo que se agrega
// aquí es lo que Express necesita aparte: la lista SIEMPRE con `page` y `pageSize`, la edición que lee la fila fresca y manda las 16 columnas (el PUT del servidor pisa lo que no viaja: lib/productos
// `guardarEdicion`) y el alta que, si su respuesta se perdió, busca el producto antes de dejar reintentar.
import { ApiError } from '@/api/errores'
import { createProduct, getProduct, listProducts, updateProduct } from '@/api/products'
import type { CreateProductInput, ListResult, ProductRow } from '@/api/types'
import { esFalloAmbiguo } from '~/lib/clientes'
import { num } from '~/lib/filas'
import { guardarEdicion, mensajeGuardarProducto, productoYaCreado } from '~/lib/productos'
import type { CambiosProducto } from '~/lib/productos'

/** Las claves de la caché de consultas: empiezan por el recurso de la app completa (`products`) para tener su frescura (config/cache.ts), e invalidar `['products']` las recarga todas. */
export const claves = {
  todos: ['products'] as const,
  lista: (query: string) => ['products', 'lista', query] as const,
  item: (id: number) => ['products', 'item', id] as const,
}

/** Una página de productos (GET /api/products). `query` vacío no se manda. Orden del servidor: el más nuevo primero. */
export function buscarProductos(p: { query?: string; page: number; pageSize: number }): Promise<ListResult<ProductRow>> {
  return listProducts({ page: p.page, pageSize: p.pageSize, query: p.query === undefined || p.query === '' ? undefined : p.query })
}

/** El detalle de un producto (GET /api/products?id=). Un 404 llega como `ApiError` con ese estado. */
export function leerProducto(id: number): Promise<ProductRow> {
  return getProduct(id)
}

/**
 * Guarda los cambios de un producto: lee la fila fresca (GET ?id=) y manda el PUT con las 16 columnas de esa fila y los cambios encima. Sin esto, el UPDATE completo del servidor borraría el SKU, la
 * descripción, la categoría, los precios 2 a 4 y la existencia, y pondría el costo en 0. Idempotente: si falla, se puede volver a tocar «Guardar».
 */
export function guardarCambios(id: number, cambios: CambiosProducto): Promise<void> {
  return guardarEdicion(
    {
      leer: async (i) => (await getProduct(i)) as unknown as Record<string, unknown>,
      enviar: (cuerpo) => updateProduct(cuerpo as unknown as CreateProductInput & { id: number }),
    },
    id,
    cambios,
  )
}

/** Lo que pasó al guardar un producto nuevo. */
export type ResultadoAltaProducto = { kind: 'creado' } | { kind: 'fallo'; mensaje: string }

/**
 * POST /api/products, sin repetirse nunca solo (el alta no es idempotente). Si el servidor dice que no, su texto (o el de soporte si la cuenta no tiene almacén). Si la respuesta se perdió (sin red, un 5xx),
 * se busca el producto por su nombre antes de ofrecer reintentar: si ya está, es `creado` y no se duplica.
 */
export async function crearProducto(payload: CreateProductInput): Promise<ResultadoAltaProducto> {
  try {
    await createProduct(payload)
    return { kind: 'creado' }
  } catch (e) {
    if (!(e instanceof ApiError)) console.error('[productos] alta', e) // lo que no es del API no se le enseña a nadie, pero queda en la consola
    const mensaje = mensajeGuardarProducto(e)
    if (!esFalloAmbiguo(e)) return { kind: 'fallo', mensaje }
    try {
      const r = await listProducts({ page: 1, pageSize: 25, query: payload.nombre })
      const ya = productoYaCreado(r.items as unknown as Record<string, unknown>[], payload)
      return ya !== null && num(ya.id) > 0 ? { kind: 'creado' } : { kind: 'fallo', mensaje }
    } catch {
      return { kind: 'fallo', mensaje }
    }
  }
}

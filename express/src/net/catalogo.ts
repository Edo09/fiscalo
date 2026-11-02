// La búsqueda de clientes y de productos del asistente: GET /api/clients y GET /api/products con `page`, `pageSize` y `query` (lo único que el API entiende de esos
// listados). Las filas llegan de MySQL como texto («5000.0000», «0», una unidad nula): `normalizarCliente` y `normalizarProducto` las leen una sola vez, y las pantallas
// reciben números y banderas de verdad. Un producto inactivo o no facturable lo descarta quien lo muestra (lib/carrito `productoSel`).
import { getList, qs } from '@/api/http'
import { normalizarCliente, normalizarProducto } from '~/lib/filas'
import type { ClienteVista, ProductoVista } from '~/lib/filas'

/** Una página ya leída: sus filas, el número de página que dijo el API y cuántas páginas hay (null si no mandó la paginación). */
export interface PaginaCatalogo<T> {
  items: T[]
  page: number
  totalPages: number | null
}

export interface ParamsBusqueda {
  /** Lo que se busca (ya recortado); vacío trae lo más reciente. */
  query?: string
  page: number
  pageSize: number
}

async function leer<T>(ruta: string, p: ParamsBusqueda, normalizar: (fila: unknown) => T): Promise<PaginaCatalogo<T>> {
  const r = await getList<unknown>(`${ruta}${qs({ page: p.page, pageSize: p.pageSize, query: p.query })}`)
  return { items: r.items.map(normalizar), page: r.page ?? p.page, totalPages: r.totalPages ?? null }
}

/** Clientes por nombre, empresa, correo, teléfono o RNC (la búsqueda es del servidor). */
export function buscarClientes(p: ParamsBusqueda): Promise<PaginaCatalogo<ClienteVista>> {
  return leer('/api/clients', p, normalizarCliente)
}

/** Productos por nombre o código (la búsqueda es del servidor: también acierta en almacén y categoría, y trae inactivos). */
export function buscarProductos(p: ParamsBusqueda): Promise<PaginaCatalogo<ProductoVista>> {
  return leer('/api/products', p, normalizarProducto)
}

// Cómo se ve el catálogo en la caja: vista (tarjetas, compacta, lista), orden y
// cuántos productos se pintan. Es una preferencia de ESTE equipo: se guarda en
// el localStorage de pos.* y, si no se puede leer, se usan los valores por defecto.
import type { ProductoPos } from './api'

export type Vista = 'tarjetas' | 'compacta' | 'lista'
export type Orden = 'nombre' | 'precio_asc' | 'precio_desc' | 'codigo' | 'existencia'
/** 0 = todos. */
export type Limite = 200 | 300 | 500 | 0
/** Lo que elige "Mostrar": cuántos se pintan, o solo los favoritos del empleado (sin límite). */
export type Mostrar = Limite | 'favoritos'

export interface PreferenciasCatalogo {
  vista: Vista
  orden: Orden
  limite: Mostrar
}

export const VISTAS: { valor: Vista; nombre: string; icono: 'layout-grid' | 'grid-3x3' | 'list' }[] = [
  { valor: 'tarjetas', nombre: 'Tarjetas', icono: 'layout-grid' },
  { valor: 'compacta', nombre: 'Compacta', icono: 'grid-3x3' },
  { valor: 'lista', nombre: 'Lista', icono: 'list' },
]
/**
 * Una opción de los selectores de la caja. `corto` va en el botón cerrado;
 * `detalle` explica en el menú qué hace; el glifo es un texto corto o un ícono.
 */
export interface OpcionSelector<T extends string | number> {
  valor: T
  nombre: string
  corto: string
  detalle?: string
  glifo?: string
  icono?: 'trending-up' | 'trending-down' | 'hash' | 'package' | 'layers' | 'star'
}

export const ORDENES: OpcionSelector<Orden>[] = [
  { valor: 'nombre', nombre: 'Nombre', corto: 'Nombre A–Z', detalle: 'De la A a la Z, sin importar acentos', glifo: 'AZ' },
  { valor: 'precio_asc', nombre: 'Precio: menor primero', corto: 'Precio ↑', detalle: 'Lo más barato arriba', icono: 'trending-up' },
  { valor: 'precio_desc', nombre: 'Precio: mayor primero', corto: 'Precio ↓', detalle: 'Lo más caro arriba', icono: 'trending-down' },
  { valor: 'codigo', nombre: 'Código', corto: 'Código', detalle: 'Por SKU; los que no tienen, al final', icono: 'hash' },
  { valor: 'existencia', nombre: 'Existencia: menor primero', corto: 'Existencia', detalle: 'Lo que se está acabando arriba', icono: 'package' },
]
export const LIMITES: OpcionSelector<Mostrar>[] = [
  { valor: 'favoritos', nombre: 'Favoritos', corto: 'Favoritos', detalle: 'Solo los que marcaste con la estrella', icono: 'star' },
  { valor: 200, nombre: '200 productos', corto: '200', detalle: 'Por defecto: rápido en cualquier PC', glifo: '200' },
  { valor: 300, nombre: '300 productos', corto: '300', glifo: '300' },
  { valor: 500, nombre: '500 productos', corto: '500', glifo: '500' },
  { valor: 0, nombre: 'Todos', corto: 'Todos', detalle: 'Todo el catálogo; con miles puede ir más lento', icono: 'layers' },
]

export const PREFERENCIAS_POR_DEFECTO: PreferenciasCatalogo = { vista: 'tarjetas', orden: 'nombre', limite: 200 }
const CLAVE = 'fiscalpoint.pos.catalogo'

/** Lo guardado, validado campo por campo: lo que no se reconozca vuelve al valor por defecto. */
export function leerPreferencias(texto: string | null): PreferenciasCatalogo {
  let crudo: Record<string, unknown> = {}
  try {
    const v: unknown = texto ? JSON.parse(texto) : null
    if (v && typeof v === 'object') crudo = v as Record<string, unknown>
  } catch {
    // Texto dañado: valores por defecto.
  }
  const d = PREFERENCIAS_POR_DEFECTO
  return {
    vista: VISTAS.some((x) => x.valor === crudo.vista) ? crudo.vista as Vista : d.vista,
    orden: ORDENES.some((x) => x.valor === crudo.orden) ? crudo.orden as Orden : d.orden,
    limite: LIMITES.some((x) => x.valor === crudo.limite) ? crudo.limite as Mostrar : d.limite,
  }
}

export function cargarPreferencias(): PreferenciasCatalogo {
  try {
    return leerPreferencias(window.localStorage.getItem(CLAVE))
  } catch {
    return PREFERENCIAS_POR_DEFECTO
  }
}

export function guardarPreferencias(p: PreferenciasCatalogo): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(p))
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): vale solo mientras la página siga abierta.
  }
}

const texto = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
const porNombre = (a: ProductoPos, b: ProductoPos) => texto.compare(a.nombre, b.nombre) || a.id - b.id

/**
 * Copia ordenada; empates por nombre. Sin código o sin existencia (servicios)
 * van al final, en cualquier sentido.
 */
export function ordenar(productos: ProductoPos[], orden: Orden): ProductoPos[] {
  const lista = [...productos]
  switch (orden) {
    case 'precio_asc': return lista.sort((a, b) => a.precio_centavos - b.precio_centavos || porNombre(a, b))
    case 'precio_desc': return lista.sort((a, b) => b.precio_centavos - a.precio_centavos || porNombre(a, b))
    case 'codigo': return lista.sort((a, b) => {
      const sa = (a.sku ?? '').trim()
      const sb = (b.sku ?? '').trim()
      if (sa === '' || sb === '') return (sa === '' ? 1 : 0) - (sb === '' ? 1 : 0) || porNombre(a, b)
      return texto.compare(sa, sb) || porNombre(a, b)
    })
    case 'existencia': return lista.sort((a, b) => {
      if (a.stock === null || b.stock === null) return (a.stock === null ? 1 : 0) - (b.stock === null ? 1 : 0) || porNombre(a, b)
      return a.stock - b.stock || porNombre(a, b)
    })
    default: return lista.sort(porNombre)
  }
}

// --- Favoritos (la estrella de la tarjeta) -----------------------------------
// De cada empleado en ESTE equipo, como sus ventas abiertas (favoritos.ts los
// guarda). Van primero en la grilla, en cualquier orden, categoría o búsqueda.

/** Favoritos primero; cada grupo conserva el orden que ya traía (estable). Antes del límite: nunca quedan fuera. */
export function favoritosPrimero(lista: ProductoPos[], favoritos: ReadonlySet<number>): ProductoPos[] {
  if (favoritos.size === 0) return lista
  return [...lista.filter((p) => favoritos.has(p.id)), ...lista.filter((p) => !favoritos.has(p.id))]
}

/** Mostrar → Favoritos: solo los marcados, en el orden que traen. */
export function soloFavoritos(lista: ProductoPos[], favoritos: ReadonlySet<number>): ProductoPos[] {
  return lista.filter((p) => favoritos.has(p.id))
}

/** Marca o desmarca un producto. */
export function alternarFavorito(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/** Lo guardado: { [empleadoId]: ids }. Lo que no se entiende se descarta (sin romper la caja). */
export function leerFavoritos(texto: string | null): Record<string, number[]> {
  let crudo: unknown
  try {
    crudo = texto === null ? null : JSON.parse(texto)
  } catch {
    return {}
  }
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) return {}
  const out: Record<string, number[]> = {}
  for (const [empleado, ids] of Object.entries(crudo as Record<string, unknown>)) {
    // Solo ids de empleado: una clave como "__proto__" cambiaría el prototipo de out.
    if (!/^\d+$/.test(empleado) || !Array.isArray(ids)) continue
    const buenos = [...new Set(ids.filter((x): x is number => Number.isInteger(x) && (x as number) > 0))]
    if (buenos.length > 0) out[empleado] = buenos
  }
  return out
}

/** Los que se pintan y cuántos quedan fuera por el límite. */
export function limitar<T>(lista: T[], limite: Mostrar): { visibles: T[]; ocultos: number } {
  if (limite === 0 || limite === 'favoritos' || lista.length <= limite) return { visibles: lista, ocultos: 0 }
  return { visibles: lista.slice(0, limite), ocultos: lista.length - limite }
}

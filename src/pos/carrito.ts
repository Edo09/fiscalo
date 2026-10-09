// Venta en curso y catálogo de la caja, en memoria (api-gratex docs/specs/pos.md
// C1, V1, A7 y F5).
//
// - El carrito sobrevive al bloqueo de pantalla (A7): vive aquí y no en
//   VentaView, que se desmonta al volver al PIN. Recargar la página lo pierde,
//   igual que la sesión del empleado; nada de esto va a localStorage.
// - El catálogo se guarda para que, al desbloquear, la grilla salga al instante
//   mientras se refresca. Al refrescarlo, las líneas toman el precio y la
//   existencia nuevos: en pantalla siempre el precio que va a cobrar el servidor.
// - Cobro (F5): cada intento lleva una clave. Si no se sabe cómo terminó (se
//   cayó la red con la petición en el aire), el carrito queda CONGELADO con esa
//   clave hasta reintentar: cambiarlo y cobrar con otra clave podría emitir la
//   misma venta dos veces.
import { create } from 'zustand'
import type { CatalogoPos, ProductoPos, VentaCuerpo } from './api'

export interface LineaCarrito {
  productoId: number
  nombre: string
  sku: string | null
  precioCentavos: number
  tasa: number
  cantidad: number
  decimales: boolean
  stock: number | null
}

interface CarritoState {
  lineas: LineaCarrito[]
  catalogo: CatalogoPos | null
  /** Hora del primer artículo (métrica de tiempo por venta). */
  iniciadaMs: number | null
  /**
   * Cobro sin confirmar: el cuerpo exacto (con su clave) que hay que reenviar.
   * Mientras exista, el carrito no se puede tocar.
   */
  cobroEnDuda: VentaCuerpo | null
  /** Agrega 1 unidad; si el producto ya está, suma a su línea (V1). */
  agregar: (p: ProductoPos) => void
  cambiarCantidad: (productoId: number, cantidad: number) => void
  quitar: (productoId: number) => void
  /** Venta cobrada o cancelada: carrito vacío y sin cobro pendiente. */
  vaciar: () => void
  marcarCobroEnDuda: (cuerpo: VentaCuerpo | null) => void
  guardarCatalogo: (c: CatalogoPos) => void
  /** Al olvidar el equipo (revocado, otra empresa): no queda nada de la venta. */
  olvidarTodo: () => void
}

export const useCarritoStore = create<CarritoState>()((set) => ({
  lineas: [],
  catalogo: null,
  iniciadaMs: null,
  cobroEnDuda: null,
  agregar: (p) => set((s) => {
    if (s.cobroEnDuda) return s
    const existe = s.lineas.find((l) => l.productoId === p.id)
    if (existe) {
      return { lineas: s.lineas.map((l) => (l.productoId === p.id ? { ...l, cantidad: Math.min(l.cantidad + 1, 99999) } : l)) }
    }
    const linea: LineaCarrito = {
      productoId: p.id, nombre: p.nombre, sku: p.sku, precioCentavos: p.precio_centavos, tasa: p.tasa,
      cantidad: 1, decimales: p.decimales, stock: p.stock,
    }
    return { lineas: [...s.lineas, linea], iniciadaMs: s.lineas.length === 0 ? Date.now() : s.iniciadaMs }
  }),
  cambiarCantidad: (productoId, cantidad) => set((s) => (s.cobroEnDuda ? s : {
    lineas: s.lineas.map((l) => (l.productoId === productoId ? { ...l, cantidad } : l)),
  })),
  quitar: (productoId) => set((s) => {
    if (s.cobroEnDuda) return s
    const lineas = s.lineas.filter((l) => l.productoId !== productoId)
    return { lineas, iniciadaMs: lineas.length === 0 ? null : s.iniciadaMs }
  }),
  vaciar: () => set({ lineas: [], iniciadaMs: null, cobroEnDuda: null }),
  marcarCobroEnDuda: (cobroEnDuda) => set({ cobroEnDuda }),
  guardarCatalogo: (catalogo) => set((s) => {
    // Con un cobro en duda las líneas no cambian: el reintento manda lo mismo.
    if (s.cobroEnDuda) return { catalogo }
    const porId = new Map(catalogo.productos.map((p) => [p.id, p]))
    const lineas = s.lineas.map((l) => {
      const p = porId.get(l.productoId)
      return p
        ? { ...l, nombre: p.nombre, sku: p.sku, precioCentavos: p.precio_centavos, tasa: p.tasa, decimales: p.decimales, stock: p.stock }
        : l
    })
    return { catalogo, lineas }
  }),
  olvidarTodo: () => set({ lineas: [], catalogo: null, iniciadaMs: null, cobroEnDuda: null }),
}))

/** Clave nueva para un intento de cobro (UUID v4). */
export function nuevaClave(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

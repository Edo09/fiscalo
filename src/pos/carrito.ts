// Venta en curso y catálogo de la caja, en memoria (api-gratex docs/specs/pos.md
// C1, V1 y A7).
//
// - El carrito sobrevive al bloqueo de pantalla (A7): vive aquí y no en
//   VentaView, que se desmonta al volver al PIN. Recargar la página lo pierde,
//   igual que la sesión del empleado; nada de esto va a localStorage.
// - El catálogo se guarda para que, al desbloquear, la grilla salga al instante
//   mientras se refresca. Al refrescarlo, las líneas toman el precio y la
//   existencia nuevos: en pantalla siempre el precio que va a cobrar el servidor.
import { create } from 'zustand'
import type { CatalogoPos, ProductoPos } from './api'

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
  /** Agrega 1 unidad; si el producto ya está, suma a su línea (V1). */
  agregar: (p: ProductoPos) => void
  cambiarCantidad: (productoId: number, cantidad: number) => void
  quitar: (productoId: number) => void
  vaciar: () => void
  guardarCatalogo: (c: CatalogoPos) => void
  /** Al olvidar el equipo (revocado, otra empresa): no queda nada de la venta. */
  olvidarTodo: () => void
}

export const useCarritoStore = create<CarritoState>()((set) => ({
  lineas: [],
  catalogo: null,
  agregar: (p) => set((s) => {
    const existe = s.lineas.find((l) => l.productoId === p.id)
    if (existe) {
      return { lineas: s.lineas.map((l) => (l.productoId === p.id ? { ...l, cantidad: l.cantidad + 1 } : l)) }
    }
    const linea: LineaCarrito = {
      productoId: p.id, nombre: p.nombre, sku: p.sku, precioCentavos: p.precio_centavos, tasa: p.tasa,
      cantidad: 1, decimales: p.decimales, stock: p.stock,
    }
    return { lineas: [...s.lineas, linea] }
  }),
  cambiarCantidad: (productoId, cantidad) => set((s) => ({
    lineas: s.lineas.map((l) => (l.productoId === productoId ? { ...l, cantidad } : l)),
  })),
  quitar: (productoId) => set((s) => ({ lineas: s.lineas.filter((l) => l.productoId !== productoId) })),
  vaciar: () => set({ lineas: [] }),
  guardarCatalogo: (catalogo) => set((s) => {
    const porId = new Map(catalogo.productos.map((p) => [p.id, p]))
    const lineas = s.lineas.map((l) => {
      const p = porId.get(l.productoId)
      return p
        ? { ...l, nombre: p.nombre, sku: p.sku, precioCentavos: p.precio_centavos, tasa: p.tasa, decimales: p.decimales, stock: p.stock }
        : l
    })
    return { catalogo, lineas }
  }),
  olvidarTodo: () => set({ lineas: [], catalogo: null }),
}))

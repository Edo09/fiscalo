// Ventas en curso y catálogo de la caja (api-gratex docs/specs/pos.md C1, V1,
// A7 y F5; ventas en espera, fase 2).
//
// - Ventas abiertas (pestañas): cada empleado tiene las suyas, hasta
//   MAX_VENTAS, cada una con su carrito y su cliente. Arriba del estado está
//   siempre la ACTIVA (lineas, cliente, cobroEnDuda, iniciadaMs) con los mismos
//   nombres de antes: catálogo, carrito y cobro trabajan con ella sin saber que
//   hay otras.
// - Se guardan EN EL EQUIPO (localStorage) por caja y empleado: sobreviven al
//   bloqueo de pantalla (A7) y a recargar la página. Otro empleado que entra en
//   la misma caja ve solo las suyas. La sesión sigue sin guardarse: recargar
//   pide el PIN y después las ventas siguen ahí.
// - El catálogo se guarda en memoria para que, al desbloquear, la grilla salga
//   al instante mientras se refresca. Al refrescarlo, las líneas de TODAS las
//   ventas toman el precio y la existencia nuevos: en pantalla siempre el
//   precio que va a cobrar el servidor.
// - Listas de precio: cada línea recuerda la suya (1 a 4) y cobra el precio de
//   ESA lista. Si el catálogo nuevo ya no la ofrece, la línea vuelve al precio
//   1 y `listaPerdida` dice cuál era, para avisarlo: nunca se sigue cobrando
//   una lista que no existe ni se cambia de lista sin decirlo. Cambiar de lista
//   a propósito (`cambiarLista` una línea, `aplicarLista` las de la venta, p. ej.
//   con la lista del cliente) toma el precio del catálogo de ahora y quita ese aviso.
//   Elegir con `cambiarLista` la lista en que la línea ya está (el precio 1 que se
//   le cobra) tampoco cambia nada más que quitarlo.
// - Cobro (F5): cada intento lleva una clave. Si no se sabe cómo terminó (se
//   cayó la red con la petición en el aire), esa venta queda CONGELADA con esa
//   clave hasta reintentar: cambiarla y cobrar con otra clave podría emitir la
//   misma venta dos veces. Por eso el cobro en duda también se guarda: después
//   de recargar, el reintento sale con la misma clave.
import { create } from 'zustand'
import type { CatalogoPos, ClientePos, ProductoPos, VentaCuerpo } from './api'
import { centavosDeLista, lineasCambiables, opcionesPos, type NumeroLista } from './listas.ts'

export interface LineaCarrito {
  productoId: number
  nombre: string
  sku: string | null
  /** Precio de SU lista (final con ITBIS, en centavos): el que va a cobrar el servidor. */
  precioCentavos: number
  /** Lista de precio de la línea (1 a 4). Un carrito guardado antes de las listas no la trae: es la 1. */
  lista: NumeroLista
  /** Lista que tenía y el catálogo nuevo ya no ofrece: la línea volvió al precio 1 y hay que avisarlo. */
  listaPerdida?: 2 | 3 | 4
  tasa: number
  cantidad: number
  decimales: boolean
  stock: number | null
}

/** Una venta abierta: la activa o una en espera. */
export interface VentaAbierta {
  id: string
  /** Número de la pestaña ("Venta 2"): el menor libre al abrirla; no cambia después. */
  numero: number
  lineas: LineaCarrito[]
  /** Hora del primer artículo (métrica de tiempo por venta). */
  iniciadaMs: number | null
  /** Cliente de crédito fiscal (E31) o null = consumidor final (E32). */
  cliente: ClientePos | null
  /**
   * Cobro sin confirmar: el cuerpo exacto (con su clave) que hay que reenviar.
   * Mientras exista, la venta no se puede tocar ni cerrar.
   */
  cobroEnDuda: VentaCuerpo | null
}

/** Ventas abiertas a la vez por empleado. */
export const MAX_VENTAS = 5

/** Nombre de la pestaña: el del cliente de crédito fiscal o "Venta N". */
export const nombreVenta = (v: VentaAbierta): string => v.cliente?.nombre || `Venta ${v.numero}`

interface CarritoState {
  // --- La venta activa (copia de ventas[activaId]) -------------------------
  lineas: LineaCarrito[]
  iniciadaMs: number | null
  cliente: ClientePos | null
  cobroEnDuda: VentaCuerpo | null
  // --------------------------------------------------------------------------
  catalogo: CatalogoPos | null
  /** Todas las ventas abiertas del empleado en sesión, la activa incluida. */
  ventas: VentaAbierta[]
  activaId: string
  /** De quién son: "<caja>.<empleado>"; null = de nadie todavía (sin sesión). */
  dueno: string | null
  /**
   * Agrega 1 unidad; si el producto ya está, suma a su línea (V1) y `lista` no cuenta: un solo precio por
   * producto en la venta. Si no está, entra al precio de esa lista (la 1 por defecto).
   */
  agregar: (p: ProductoPos, lista?: NumeroLista) => void
  /**
   * Pasa a esa lista las líneas de la venta activa que se pueden cambiar (lineasCambiables: productos que el catálogo de ahora
   * la ofrece y que no están ya en ella), al precio de esa lista, y dice cuántas cambió. Con un cobro en duda no toca nada: 0.
   */
  aplicarLista: (lista: NumeroLista) => number
  /**
   * Pasa la línea de ese producto a esa lista, al precio que le da el catálogo. No hace nada si el producto no la ofrece o si hay un
   * cobro en duda. Si la línea ya está en ella no cambia de lista ni de precio, pero pierde su aviso de lista perdida (el cajero acaba
   * de elegir el precio que se le cobra); sin aviso, no hace nada.
   */
  cambiarLista: (productoId: number, lista: NumeroLista) => void
  cambiarCantidad: (productoId: number, cantidad: number) => void
  quitar: (productoId: number) => void
  /** La venta activa queda vacía, sin cliente y sin cobro pendiente. */
  vaciar: () => void
  /**
   * Venta activa cobrada o cancelada: si hay otras abiertas se cierra su
   * pestaña y pasa a la anterior; si era la única, queda vacía.
   */
  terminarActiva: () => void
  marcarCobroEnDuda: (cuerpo: VentaCuerpo | null) => void
  ponerCliente: (cliente: ClientePos | null) => void
  guardarCatalogo: (c: CatalogoPos) => void
  /** Abre una venta nueva y la activa. false si ya hay MAX_VENTAS. */
  nuevaVenta: () => boolean
  cambiarA: (id: string) => void
  /** Cierra una venta (quien llama registra la cancelación). Con cobro en duda no se cierra. */
  cerrarVenta: (id: string) => void
  /** Al entrar un empleado: sus ventas guardadas en este equipo (o una vacía). */
  abrirVentasDe: (cajaId: number, empleadoId: number) => void
  /** Al olvidar el equipo (revocado, otra empresa): no queda ninguna venta, tampoco guardada. */
  olvidarTodo: () => void
}

const PREFIJO = 'fiscalpoint.pos.ventas.'

function ventaVacia(numero: number): VentaAbierta {
  return { id: nuevaClave(), numero, lineas: [], iniciadaMs: null, cliente: null, cobroEnDuda: null }
}

const espejo = (v: VentaAbierta) => ({ lineas: v.lineas, iniciadaMs: v.iniciadaMs, cliente: v.cliente, cobroEnDuda: v.cobroEnDuda })

function activaDe(s: Pick<CarritoState, 'ventas' | 'activaId'>): VentaAbierta {
  return s.ventas.find((v) => v.id === s.activaId) ?? s.ventas[0]
}

function numeroLibre(ventas: VentaAbierta[]): number {
  for (let n = 1; n <= MAX_VENTAS; n++) if (!ventas.some((v) => v.numero === n)) return n
  return ventas.length + 1
}

/** Aplica un cambio a la venta activa. Sin cambio devuelve el mismo estado (no avisa a nadie). */
function enActiva(s: CarritoState, cambio: (v: VentaAbierta) => VentaAbierta): CarritoState | Partial<CarritoState> {
  const v = activaDe(s)
  const nv = cambio(v)
  if (nv === v) return s
  return { ventas: s.ventas.map((x) => (x.id === v.id ? nv : x)), ...espejo(nv) }
}

/** Quita una venta y deja activa la vecina (o una vacía si no queda ninguna). */
function sinVenta(s: CarritoState, id: string): Partial<CarritoState> {
  const i = s.ventas.findIndex((v) => v.id === id)
  if (i < 0) return {}
  const ventas = s.ventas.filter((v) => v.id !== id)
  if (ventas.length === 0) ventas.push(ventaVacia(1))
  const activa = id === s.activaId ? ventas[Math.max(0, i - 1)] : activaDe({ ventas, activaId: s.activaId })
  return { ventas, activaId: activa.id, ...espejo(activa) }
}

/** La línea con lo que dice el catálogo nuevo: el precio de SU lista, o el 1 (avisando cuál se perdió) si ya no se ofrece. */
function lineaAlDia(l: LineaCarrito, p: ProductoPos): LineaCarrito {
  const alDia = { ...l, nombre: p.nombre, sku: p.sku, tasa: p.tasa, decimales: p.decimales, stock: p.stock }
  // La 1 es el precio del producto y siempre está; las otras salen de `listas` y pueden dejar de ofrecerse.
  if (l.lista === 1) return { ...alDia, precioCentavos: p.precio_centavos }
  const centavos = centavosDeLista(p, l.lista)
  return centavos === null
    ? { ...alDia, lista: 1, precioCentavos: p.precio_centavos, listaPerdida: l.lista }
    : { ...alDia, precioCentavos: centavos }
}

/** Precio, lista y existencia del catálogo nuevo; con cobro en duda, nada cambia. */
function conCatalogo(v: VentaAbierta, porId: Map<number, ProductoPos>): VentaAbierta {
  if (v.cobroEnDuda || v.lineas.length === 0) return v
  return {
    ...v,
    lineas: v.lineas.map((l) => {
      const p = porId.get(l.productoId)
      return p ? lineaAlDia(l, p) : l
    }),
  }
}

/**
 * La venta con sus líneas cambiables pasadas a esa lista (todas, o solo las de un producto): el precio de SU producto en el
 * catálogo y fuera el aviso de lista perdida. Y cuántas líneas cambió. Con un cobro en duda, o sin catálogo, no cambia nada.
 */
function pasarALista(
  v: VentaAbierta, catalogo: CatalogoPos | null, lista: NumeroLista, productoId?: number,
): { venta: VentaAbierta; cambiadas: number } {
  if (v.cobroEnDuda || !catalogo) return { venta: v, cambiadas: 0 }
  const lineas = productoId === undefined ? v.lineas : v.lineas.filter((l) => l.productoId === productoId)
  const nuevas = new Map<number, LineaCarrito>()
  for (const l of lineasCambiables(lineas, catalogo.productos, lista)) {
    const p = catalogo.productos.find((x) => x.id === l.productoId)
    const centavos = p ? centavosDeLista(p, lista) : null
    if (centavos === null) continue
    const nueva = { ...l, lista, precioCentavos: centavos }
    delete nueva.listaPerdida
    nuevas.set(l.productoId, nueva)
  }
  if (nuevas.size === 0) return { venta: v, cambiadas: 0 }
  return { venta: { ...v, lineas: v.lineas.map((l) => nuevas.get(l.productoId) ?? l) }, cambiadas: nuevas.size }
}

/**
 * La venta con la línea de ese producto sin su aviso de lista perdida: para cuando el cajero vuelve a elegir el precio que ya se cobra.
 * Solo si la línea está en esa lista, el catálogo de ahora la sigue ofreciendo (como opcionesPos) y la línea tiene el aviso; no toca
 * su lista ni su precio. Con un cobro en duda, sin catálogo o sin nada que quitar, devuelve la misma venta.
 */
function sinAvisoDeLista(v: VentaAbierta, catalogo: CatalogoPos | null, lista: NumeroLista, productoId: number): VentaAbierta {
  if (v.cobroEnDuda || !catalogo) return v
  const p = catalogo.productos.find((x) => x.id === productoId)
  const l = v.lineas.find((x) => x.productoId === productoId)
  if (!p || !l || l.lista !== lista || l.listaPerdida === undefined || !opcionesPos(p).some((o) => o.lista === lista)) return v
  const sin = { ...l }
  delete sin.listaPerdida
  return { ...v, lineas: v.lineas.map((x) => (x === l ? sin : x)) }
}

// --- Guardado en el equipo ----------------------------------------------------
// localStorage puede no estar (modo privado, bloqueado): entonces las ventas
// viven solo en memoria, como antes.

interface Guardadas { ventas: VentaAbierta[]; activaId: string }

function leerGuardadas(dueno: string): Guardadas | null {
  try {
    const raw = localStorage.getItem(PREFIJO + dueno)
    if (!raw) return null
    const g = JSON.parse(raw) as Partial<Guardadas>
    const ventas = Array.isArray(g.ventas)
      ? g.ventas.filter((v): v is VentaAbierta =>
        !!v && typeof v.id === 'string' && typeof v.numero === 'number' && Array.isArray(v.lineas))
        .slice(0, MAX_VENTAS)
        // Lo guardado antes de las listas no trae `lista` en las líneas: es la 1.
        .map((v) => ({ ...v, lineas: v.lineas.map((l) => ({ ...l, lista: l.lista ?? 1 })) }))
      : []
    if (ventas.length === 0) return null
    return { ventas, activaId: typeof g.activaId === 'string' ? g.activaId : ventas[0].id }
  } catch {
    return null
  }
}

function escribirGuardadas(dueno: string, g: Guardadas): void {
  try {
    // Una sola venta vacía es lo mismo que nada: no se deja basura en el equipo.
    const vacio = g.ventas.length === 1 && g.ventas[0].lineas.length === 0 && !g.ventas[0].cliente && !g.ventas[0].cobroEnDuda
    if (vacio) localStorage.removeItem(PREFIJO + dueno)
    else localStorage.setItem(PREFIJO + dueno, JSON.stringify(g))
  } catch { /* sin almacenamiento: quedan en memoria */ }
}

function borrarTodasGuardadas(): void {
  try {
    const claves: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIJO)) claves.push(k)
    }
    claves.forEach((k) => localStorage.removeItem(k))
  } catch { /* idem */ }
}

const inicial = ventaVacia(1)

export const useCarritoStore = create<CarritoState>()((set, get) => ({
  ...espejo(inicial),
  catalogo: null,
  ventas: [inicial],
  activaId: inicial.id,
  dueno: null,
  agregar: (p, lista = 1) => set((s) => enActiva(s, (v) => {
    if (v.cobroEnDuda) return v
    const existe = v.lineas.find((l) => l.productoId === p.id)
    if (existe) {
      return { ...v, lineas: v.lineas.map((l) => (l.productoId === p.id ? { ...l, cantidad: Math.min(l.cantidad + 1, 99999) } : l)) }
    }
    // Si el catálogo no ofrece esa lista (la pantalla solo deja elegir entre las ofrecidas: no debería pasar), entra en la 1.
    const centavos = centavosDeLista(p, lista)
    const linea: LineaCarrito = {
      productoId: p.id, nombre: p.nombre, sku: p.sku, tasa: p.tasa,
      precioCentavos: centavos ?? p.precio_centavos, lista: centavos === null ? 1 : lista,
      cantidad: 1, decimales: p.decimales, stock: p.stock,
    }
    return { ...v, lineas: [...v.lineas, linea], iniciadaMs: v.lineas.length === 0 ? Date.now() : v.iniciadaMs }
  })),
  aplicarLista: (lista) => {
    const s = get()
    const { venta, cambiadas } = pasarALista(activaDe(s), s.catalogo, lista)
    set((x) => enActiva(x, () => venta))
    return cambiadas
  },
  cambiarLista: (productoId, lista) => {
    const s = get()
    const v = activaDe(s)
    const { venta } = pasarALista(v, s.catalogo, lista, productoId)
    // Si no se movió porque ya estaba en esa lista, elegirla otra vez solo le quita el aviso de lista perdida (si lo tenía).
    const nueva = venta === v ? sinAvisoDeLista(v, s.catalogo, lista, productoId) : venta
    set((x) => enActiva(x, () => nueva))
  },
  cambiarCantidad: (productoId, cantidad) => set((s) => enActiva(s, (v) => (v.cobroEnDuda ? v : {
    ...v, lineas: v.lineas.map((l) => (l.productoId === productoId ? { ...l, cantidad } : l)),
  }))),
  quitar: (productoId) => set((s) => enActiva(s, (v) => {
    if (v.cobroEnDuda) return v
    const lineas = v.lineas.filter((l) => l.productoId !== productoId)
    return { ...v, lineas, iniciadaMs: lineas.length === 0 ? null : v.iniciadaMs }
  })),
  vaciar: () => set((s) => enActiva(s, (v) => ({ ...v, lineas: [], iniciadaMs: null, cobroEnDuda: null, cliente: null }))),
  terminarActiva: () => {
    const s = get()
    if (s.ventas.length > 1) set(sinVenta(s, s.activaId))
    else s.vaciar()
  },
  marcarCobroEnDuda: (cobroEnDuda) => set((s) => enActiva(s, (v) => ({ ...v, cobroEnDuda }))),
  // Con un cobro en duda tampoco se cambia el cliente: el reintento manda lo mismo.
  ponerCliente: (cliente) => set((s) => enActiva(s, (v) => (v.cobroEnDuda ? v : { ...v, cliente }))),
  guardarCatalogo: (catalogo) => set((s) => {
    const porId = new Map(catalogo.productos.map((p) => [p.id, p]))
    const ventas = s.ventas.map((v) => conCatalogo(v, porId))
    return { catalogo, ventas, ...espejo(activaDe({ ventas, activaId: s.activaId })) }
  }),
  nuevaVenta: () => {
    const s = get()
    if (s.ventas.length >= MAX_VENTAS) return false
    const v = ventaVacia(numeroLibre(s.ventas))
    set({ ventas: [...s.ventas, v], activaId: v.id, ...espejo(v) })
    return true
  },
  cambiarA: (id) => set((s) => {
    const v = s.ventas.find((x) => x.id === id)
    return v && v.id !== s.activaId ? { activaId: v.id, ...espejo(v) } : s
  }),
  cerrarVenta: (id) => set((s) => {
    const v = s.ventas.find((x) => x.id === id)
    return !v || v.cobroEnDuda ? s : sinVenta(s, id)
  }),
  abrirVentasDe: (cajaId, empleadoId) => {
    const dueno = `${cajaId}.${empleadoId}`
    // El mismo empleado que vuelve del bloqueo: sus ventas ya están en memoria.
    if (get().dueno === dueno) return
    const g = leerGuardadas(dueno)
    const ventas = g?.ventas ?? [ventaVacia(1)]
    const activa = activaDe({ ventas, activaId: g?.activaId ?? ventas[0].id })
    // Con el catálogo que ya hay, los precios guardados se ponen al día.
    const catalogo = get().catalogo
    const porId = catalogo ? new Map(catalogo.productos.map((p) => [p.id, p])) : null
    const alDia = porId ? ventas.map((v) => conCatalogo(v, porId)) : ventas
    const activaAlDia = activaDe({ ventas: alDia, activaId: activa.id })
    set({ dueno, ventas: alDia, activaId: activaAlDia.id, ...espejo(activaAlDia) })
  },
  olvidarTodo: () => {
    borrarTodasGuardadas()
    const v = ventaVacia(1)
    set({ ...espejo(v), catalogo: null, ventas: [v], activaId: v.id, dueno: null })
  },
}))

// Cada cambio de las ventas del empleado se guarda en el equipo.
useCarritoStore.subscribe((s, antes) => {
  if (s.dueno && (s.ventas !== antes.ventas || s.activaId !== antes.activaId || s.dueno !== antes.dueno)) {
    escribirGuardadas(s.dueno, { ventas: s.ventas, activaId: s.activaId })
  }
})

/** Clave nueva para un intento de cobro (UUID v4). También identifica cada venta abierta. */
export function nuevaClave(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Listas de precio del POS (api-gratex docs/api/pos.md: `listas` en el catálogo y `lista` en cada línea
// de la venta): qué precios ofrece un producto, qué hace un toque sobre él y cómo viajan las líneas al
// cobrar. El navegador manda el número de lista (1 a 4) de cada línea, nunca un monto: el precio lo
// pone el servidor.
//
// Sin React, sin stores y sin imports de valor a propósito: scripts/test-pos-ventas.ts lo prueba con Node solo.
import type { ProductoPos } from './api'

export type NumeroLista = 1 | 2 | 3 | 4
export interface OpcionPos { lista: NumeroLista; precioCentavos: number }
/** Lo que estas funciones necesitan de un producto del catálogo (ProductoPos lo cumple). */
export type ConPreciosPos = Pick<ProductoPos, 'precio_centavos' | 'listas'>

/** Los precios que el POS ofrece: la lista 1 si su precio es > 0 y las de `listas`, en orden. */
export function opcionesPos(p: ConPreciosPos): OpcionPos[] {
  const otras = (p.listas ?? []).map((l): OpcionPos => ({ lista: l.lista, precioCentavos: l.precio_centavos }))
  return p.precio_centavos > 0 ? [{ lista: 1, precioCentavos: p.precio_centavos }, ...otras] : otras
}

/** Centavos de esa lista: la 1 es precio_centavos; las demás salen de `listas`, o null si el catálogo ya no la ofrece. */
export function centavosDeLista(p: ConPreciosPos, lista: NumeroLista): number | null {
  if (lista === 1) return p.precio_centavos
  return p.listas?.find((l) => l.lista === lista)?.precio_centavos ?? null
}

/**
 * Qué hace un toque en un producto que no está en la venta: si el cliente de la venta tiene una lista y el producto la ofrece,
 * directo en ella (solo es lo que propone la pantalla: no obliga a nada). Si no, con 0 o 1 precio ofrecido, directo en esa lista
 * (la 1 si no hay ninguno); con 2 o más, elegir.
 */
export type DecisionPos = { tipo: 'directo'; lista: NumeroLista } | { tipo: 'elegir' }
export function decisionPos(p: ConPreciosPos, listaCliente?: NumeroLista | null): DecisionPos {
  const opciones = opcionesPos(p)
  const delCliente = opciones.find((o) => o.lista === listaCliente)
  if (delCliente) return { tipo: 'directo', lista: delCliente.lista }
  return opciones.length >= 2 ? { tipo: 'elegir' } : { tipo: 'directo', lista: opciones[0]?.lista ?? 1 }
}

/**
 * Las líneas que se pueden pasar a esa lista: las de productos del catálogo que la ofrecen (como opcionesPos) y que no están ya en ella.
 * Las demás (producto que ya no está en el catálogo, que no la ofrece, o ya en ella) no cuentan.
 */
export function lineasCambiables<L extends { productoId: number; lista: NumeroLista }>(
  lineas: readonly L[], catalogo: readonly ProductoPos[], lista: NumeroLista,
): L[] {
  const porId = new Map(catalogo.map((p) => [p.id, p]))
  return lineas.filter((l) => {
    const p = porId.get(l.productoId)
    return l.lista !== lista && p !== undefined && opcionesPos(p).some((o) => o.lista === lista)
  })
}

/** Las líneas del cuerpo de POST /api/pos/ventas: `lista` solo cuando es mayor que 1. */
export function lineasParaCobro(
  lineas: readonly { productoId: number; cantidad: number; lista: NumeroLista }[],
): { product_id: number; cantidad: number; lista?: NumeroLista }[] {
  return lineas.map((l) => (l.lista > 1
    ? { product_id: l.productoId, cantidad: l.cantidad, lista: l.lista }
    : { product_id: l.productoId, cantidad: l.cantidad }))
}

// El cuerpo de POST /api/facturas para una venta (anexo 7.1). Exactamente `{ client_id?, tipo_ecf, tipo_pago, fecha_limite_pago?, descuento: 0, items }`: nada más.
//
// Lo que NUNCA viaja (lo pone el servidor o es de la app completa): `user_id`, `ambiente`, `e_ncf`, `fecha_emision`, `totales`, `product_id`, `strict_input`, `emisor`,
// `precios_incluyen_itbis`, `indicador_monto_gravado`, `numero_linea`. `descuento` va siempre en 0: el descuento del cliente baja a cada línea como `descuento_monto`
// (visible en pantalla), y sin esa clave el servidor aplicaría `clients.descuento` encima, a escondidas.
// Cada item lleva SIEMPRE sus seis claves obligatorias; `descripcion` solo si hay texto y `descuento_monto` solo si es mayor que 0. Los números son los que da
// `montosLinea` (cantidad a 2 decimales, precio a 4), no los que la persona tecleó: el ruido de 0.1 + 0.2 nunca llega al servidor.
//
// `clave_idempotencia` no está aquí: se agrega DESPUÉS, solo si la cuenta lo anuncia (`conClave`), porque un servidor que no la conoce la ignoraría o la rechazaría.
import type { Carrito, IndFact, LineaCarrito, TipoItem } from '~/lib/carrito'
import { fechaLimiteEfectiva, MAX_DESCRIPCION, prefijoDe } from '~/lib/carrito'
import { montosDe } from '~/lib/totales'

export interface ItemPayload {
  nombre_item: string
  descripcion?: string
  cantidad: number
  unidad_medida: string
  precio_unitario: number
  descuento_monto?: number
  indicador_facturacion: IndFact
  indicador_bien_servicio: TipoItem
}

export interface PayloadVenta {
  client_id?: number
  tipo_ecf: string
  tipo_pago: 1 | 2
  fecha_limite_pago?: string
  descuento: 0
  items: ItemPayload[]
}

/** El item de una línea. `descripcion` va solo si tiene texto (recortado, hasta 1000) y `descuento_monto` solo si es mayor que 0. */
export function itemDeLinea(l: LineaCarrito): ItemPayload {
  const m = montosDe(l)
  const item: ItemPayload = {
    nombre_item: l.nombre.trim(),
    cantidad: m.cantidad,
    unidad_medida: l.unidad,
    precio_unitario: m.precioUnitario,
    indicador_facturacion: l.indFact,
    indicador_bien_servicio: l.tipoItem,
  }
  const descripcion = (l.descripcion ?? '').trim()
  if (descripcion !== '') item.descripcion = prefijoDe(descripcion, MAX_DESCRIPCION)
  if (m.descuentoMonto > 0) item.descuento_monto = m.descuentoMonto
  return item
}

/** El payload de la venta. A crédito lleva `fecha_limite_pago` (la elegida, o hoy más el plazo); de contado no. `hoy` es el de lib/reloj. */
export function construirPayloadVenta(c: Carrito, hoy: string): PayloadVenta {
  const credito = c.pago === 'credito'
  const payload: PayloadVenta = { tipo_ecf: c.tipo, tipo_pago: credito ? 2 : 1, descuento: 0, items: c.lineas.map(itemDeLinea) }
  if (c.cliente !== null) payload.client_id = c.cliente.id
  if (credito) payload.fecha_limite_pago = fechaLimiteEfectiva(c, hoy)
  return payload
}

/** El payload con la clave de idempotencia (un UUID v4 en minúsculas). Solo para una cuenta cuyo servidor la anuncia: `capacidades.idempotencia`. */
export function conClave(p: PayloadVenta, clave: string): PayloadVenta & { clave_idempotencia: string } {
  return { ...p, clave_idempotencia: clave }
}

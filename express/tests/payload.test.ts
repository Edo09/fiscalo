// lib/payload: el cuerpo de POST /api/facturas. Las claves exactas, nada de lo prohibido, y lo mismo que acepta `createFacturaSchema` (el que aplica el servidor).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFacturaSchema } from '@/api/schemas/factura'
import { agregarLibre, agregarProducto, carritoVacio, elegirCliente, elegirPago } from '~/lib/carrito'
import type { Carrito, ClienteSel, ProductoSel } from '~/lib/carrito'
import { conClave, construirPayloadVenta } from '~/lib/payload'

const HOY = '2026-10-27'
const cliente = (c: Partial<ClienteSel> = {}): ClienteSel => ({ id: 3, nombre: 'Min. de Obras', rnc: '401123456', permiteCredito: true, descuento: 0, ...c })
const producto = (p: Partial<ProductoSel> = {}): ProductoSel => ({ id: 7, nombre: 'Asesoría', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43', ...p })
const E45 = (): Carrito => {
  let c = elegirCliente(carritoVacio('45'), cliente())
  c = agregarProducto(c, producto()).carrito
  c = agregarProducto(c, producto({ id: 8, nombre: 'Mantenimiento', precio: 2500 })).carrito
  return agregarProducto(c, producto({ id: 8, nombre: 'Mantenimiento', precio: 2500 })).carrito
}

const PROHIBIDO = /user_id|ambiente|e_ncf|fecha_emision|totales|product_id|strict_input|emisor|precios_incluyen|indicador_monto_gravado|clave_idempotencia|numero_linea/

test('un E45 a crédito lleva exactamente client_id, descuento 0, fecha_limite_pago, items, tipo_ecf y tipo_pago 2', () => {
  const p = construirPayloadVenta(elegirPago(E45(), { pago: 'credito', plazoDias: 30 }), HOY)
  assert.deepEqual(Object.keys(p).sort(), ['client_id', 'descuento', 'fecha_limite_pago', 'items', 'tipo_ecf', 'tipo_pago'])
  assert.equal(p.tipo_pago, 2)
  assert.equal(p.descuento, 0)
  assert.equal(p.fecha_limite_pago, '2026-11-26')
  assert.equal(p.client_id, 3)
})

test('de contado no lleva fecha límite; un E32 sin cliente no lleva client_id', () => {
  const contado = construirPayloadVenta(E45(), HOY)
  assert.equal(contado.tipo_pago, 1)
  assert.equal('fecha_limite_pago' in contado, false)
  const consumo = construirPayloadVenta(agregarLibre(carritoVacio('32'), 'Flete').carrito, HOY)
  assert.equal('client_id' in consumo, false)
})

test('nada prohibido viaja, y cada item lleva sus seis claves; la idempotencia entra solo con conClave', () => {
  const p = construirPayloadVenta(E45(), HOY)
  assert.doesNotMatch(JSON.stringify(p), PROHIBIDO)
  for (const item of p.items) {
    for (const clave of ['nombre_item', 'cantidad', 'unidad_medida', 'precio_unitario', 'indicador_facturacion', 'indicador_bien_servicio']) assert.ok(clave in item, clave)
    assert.equal('descripcion' in item, false)
    assert.equal('descuento_monto' in item, false)
  }
  assert.equal(p.items[1].cantidad, 2)
  assert.match(JSON.stringify(conClave(p, '0e4f1c1e-6f3e-4a5b-9c1d-123456789abc')), /"clave_idempotencia":"0e4f1c1e-/)
})

test('descripcion solo con texto y descuento_monto solo si es mayor que 0', () => {
  let c = elegirCliente(carritoVacio('31'), cliente({ descuento: 10 }))
  c = agregarProducto(c, producto({ nombre: 'x'.repeat(90) })).carrito
  const [item] = construirPayloadVenta(c, HOY).items
  assert.equal(item.nombre_item.length, 80)
  assert.equal(item.descripcion, 'x'.repeat(90))
  assert.equal(item.descuento_monto, 500) // el descuento del cliente baja a la línea como monto; el del documento va en 0
})

test('la cantidad con ruido binario viaja limpia: 0.1 + 0.2 es 0.3', () => {
  const c = agregarLibre(carritoVacio('32'), 'Tela').carrito
  const c2 = { ...c, lineas: [{ ...c.lineas[0], cant: 0.1 + 0.2, precio: 100 }] }
  assert.equal(construirPayloadVenta(c2, HOY).items[0].cantidad, 0.3)
})

test('lo que se manda lo acepta createFacturaSchema sin quitarle nada (crédito, nombres de 80 unidades con emoji y descripción)', () => {
  let c = elegirPago(E45(), { pago: 'credito', plazoDias: 45 })
  c = agregarProducto(c, producto({ id: 20, nombre: '😀'.repeat(40) })).carrito
  c = agregarProducto(c, producto({ id: 21, nombre: '😀'.repeat(50) })).carrito
  const p = construirPayloadVenta(c, HOY)
  const r = createFacturaSchema.safeParse(p)
  assert.equal(r.success, true)
  assert.deepEqual(r.data, p)
  assert.equal(p.items[3].nombre_item.length, 80)
})

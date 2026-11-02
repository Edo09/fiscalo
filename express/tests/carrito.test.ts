// lib/carrito: el carrito del asistente de venta. Lo que se fija es lo que cuesta dinero o rechaza el servidor: la cantidad sin ruido, el nombre de 80 unidades UTF-16
// (con emoji), el tope de 50 líneas, el descuento del cliente solo en las líneas nuevas y el crédito solo donde se puede.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actualizarLinea,
  agregarLibre,
  agregarProducto,
  cambiarCantidad,
  cambiarTipo,
  carritoDeJson,
  carritoVacio,
  clienteSel,
  cortarNombre,
  elegirCliente,
  elegirPago,
  fechaLimiteEfectiva,
  MAX_LINEAS,
  productoSel,
  quitarLinea,
  restaurarLinea,
  sumarDias,
} from '~/lib/carrito'
import type { Carrito, ClienteSel, ProductoSel } from '~/lib/carrito'
import { normalizarCliente, normalizarProducto } from '~/lib/filas'

const producto = (p: Partial<ProductoSel> = {}): ProductoSel => ({ id: 7, nombre: 'Asesoría técnica', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43', ...p })
const cliente = (c: Partial<ClienteSel> = {}): ClienteSel => ({ id: 3, nombre: 'Constructora Cibao', rnc: '131256432', permiteCredito: true, descuento: 0, ...c })
const conUnaLinea = (): Carrito => agregarProducto(carritoVacio('45'), producto()).carrito

test('una fila de producto de MySQL (precio en texto, unidad nula) da el producto con el precio como número y la unidad 43', () => {
  const fila = { id: 7, nombre: 'Asesoría técnica', precio: '5000.0000', indicador_facturacion: 1, indicador_bien_servicio: 2, unidad_medida: null, activo: 1 }
  assert.deepEqual(productoSel(normalizarProducto(fila)), { id: 7, nombre: 'Asesoría técnica', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43' })
  assert.equal(productoSel(normalizarProducto({ ...fila, indicador_facturacion: 0 })), null) // no facturable
  assert.equal(productoSel(normalizarProducto({ ...fila, activo: '0' })), null) // inactivo
  assert.equal(productoSel(normalizarProducto({ ...fila, precio: null }))?.precio, 0)
})

test('un cliente de MySQL: el nombre sale de razón social, empresa o contacto y el crédito "0" es solo contado', () => {
  const fila = { id: 3, razon_social: '', company_name: 'Constructora Cibao', client_name: 'Maria', rnc: '131256432', permitir_credito: '0', descuento: '10.00' }
  assert.deepEqual(clienteSel(normalizarCliente(fila)), { id: 3, nombre: 'Constructora Cibao', rnc: '131256432', permiteCredito: false, descuento: 10 })
})

test('tocar el mismo producto dos veces deja una línea de cantidad 2; sin precio pide abrir la hoja', () => {
  const una = agregarProducto(carritoVacio('45'), producto())
  const dos = agregarProducto(una.carrito, producto())
  assert.equal(dos.carrito.lineas.length, 1)
  assert.equal(dos.carrito.lineas[0].cant, 2)
  assert.equal(dos.lineaId, una.lineaId)
  assert.equal(una.abrirLinea, false)
  assert.equal(agregarProducto(carritoVacio('45'), producto({ id: 8, precio: 0 })).abrirLinea, true)
})

test('el descuento del cliente es el de una línea NUEVA; las que ya estaban no cambian al elegirlo', () => {
  const antes = conUnaLinea()
  const conCliente = elegirCliente(antes, cliente({ descuento: 10 }))
  assert.equal(conCliente.lineas[0].desc, 0)
  const nueva = agregarProducto(conCliente, producto({ id: 8 })).carrito
  assert.equal(nueva.lineas[1].desc, 10)
  assert.equal(nueva.lineas[0].desc, 0)
})

test('la línea 51 no entra: el carrito es el mismo y el id es null', () => {
  let c = carritoVacio('45')
  for (let i = 1; i <= MAX_LINEAS; i++) c = agregarProducto(c, producto({ id: i })).carrito
  assert.equal(c.lineas.length, MAX_LINEAS)
  const mas = agregarProducto(c, producto({ id: 99 }))
  assert.equal(mas.lineaId, null)
  assert.equal(mas.carrito, c)
  const libre = agregarLibre(c, 'Flete')
  assert.equal(libre.lineaId, null)
  assert.equal(libre.carrito.lineas.length, MAX_LINEAS)
})

test('la cantidad se redondea a 2 decimales sin ruido: 0.1 + 0.2 es 0.3 y 1.005 es 1.01', () => {
  const c = conUnaLinea()
  assert.equal(cambiarCantidad(c, 1, 0.1 + 0.2).carrito.lineas[0].cant, 0.3)
  assert.equal(cambiarCantidad(c, 1, 1.005).carrito.lineas[0].cant, 1.01)
})

test('cantidad 0 quita la línea y deshacer la devuelve a su lugar', () => {
  let c = conUnaLinea()
  c = agregarProducto(c, producto({ id: 8, nombre: 'Mantenimiento' })).carrito
  const { carrito, deshacer } = cambiarCantidad(c, 1, 0)
  assert.equal(carrito.lineas.length, 1)
  assert.ok(deshacer !== null)
  const vuelta = restaurarLinea(carrito, deshacer)
  assert.deepEqual(vuelta.lineas.map((l) => l.nombre), ['Asesoría técnica', 'Mantenimiento'])
  assert.equal(restaurarLinea(vuelta, deshacer), vuelta) // ya está: no se duplica
  assert.equal(quitarLinea(c, 999).deshacer, null)
})

test('elegir un cliente solo de contado, o ninguno, devuelve el pago a contado; elegir pago con un chip borra la fecha propia', () => {
  const credito = elegirPago(elegirCliente(conUnaLinea(), cliente()), { pago: 'credito', plazoDias: 45 })
  assert.equal(credito.pago, 'credito')
  assert.equal(credito.plazoDias, 45)
  assert.equal(elegirCliente(credito, cliente({ permiteCredito: false })).pago, 'contado')
  assert.equal(elegirCliente(credito, null).pago, 'contado')
  assert.equal(elegirCliente(credito, cliente({ id: 4 })).pago, 'credito')
  const conFecha = elegirPago(credito, { pago: 'credito', fechaLimite: '2026-12-31' })
  assert.equal(conFecha.fechaLimite, '2026-12-31')
  assert.equal(elegirPago(conFecha, { pago: 'credito', plazoDias: 15 }).fechaLimite, null)
  assert.equal(cambiarTipo(credito, '32').pago, 'contado') // el consumo es de contado
  assert.equal(cambiarTipo(credito, '31').pago, 'credito')
})

test('cortarNombre cuenta unidades UTF-16 como el servidor y no parte un emoji', () => {
  assert.deepEqual(cortarNombre('  Flete '), { nombre: 'Flete' })
  const largo = 'ñ'.repeat(85)
  assert.deepEqual(cortarNombre(largo), { nombre: 'ñ'.repeat(80), descripcion: largo })
  const emojis = '😀'.repeat(41)
  const c1 = cortarNombre(emojis)
  assert.equal(c1.nombre, '😀'.repeat(40))
  assert.equal(c1.nombre.length, 80)
  assert.equal(c1.descripcion, emojis)
  const c2 = cortarNombre('a' + '😀'.repeat(40))
  assert.equal(c2.nombre, 'a' + '😀'.repeat(39)) // 79 unidades: el emoji que no cabe se va entero
  assert.equal(cortarNombre('😀'.repeat(40)).descripcion, undefined) // 80 unidades caben
  assert.equal(cortarNombre('x'.repeat(1200)).descripcion?.length, 1000)
})

test('un producto de catálogo de 50 emojis es una línea de 80 unidades con su texto completo en la descripción', () => {
  const { carrito } = agregarProducto(carritoVacio('45'), producto({ nombre: '😀'.repeat(50) }))
  assert.equal(carrito.lineas[0].nombre.length, 80)
  assert.equal(carrito.lineas[0].descripcion, '😀'.repeat(50))
})

test('una línea libre nace al 18 %, unidad 43, servicio la primera vez y el último tipo después', () => {
  const primera = agregarLibre(carritoVacio('31'), 'Flete').carrito.lineas[0]
  assert.deepEqual([primera.indFact, primera.unidad, primera.tipoItem, primera.cant, primera.precio], [1, '43', 2, 1, 0])
  assert.equal(agregarLibre(carritoVacio('31'), 'Pieza', 1).carrito.lineas[0].tipoItem, 1)
  assert.equal(actualizarLinea(conUnaLinea(), 99, { cant: 5 }).lineas[0].cant, 1) // una línea que no existe no cambia nada
})

test('sumarDias es aritmética de calendario y la fecha límite elegida gana', () => {
  assert.equal(sumarDias('2026-10-27', 30), '2026-11-26')
  assert.equal(sumarDias('2026-12-15', 30), '2027-01-14')
  assert.equal(sumarDias('2028-02-15', 15), '2028-03-01')
  const c = elegirPago(carritoVacio('45'), { pago: 'credito', plazoDias: 30 })
  assert.equal(fechaLimiteEfectiva(c, '2026-10-31'), '2026-11-30')
  assert.equal(fechaLimiteEfectiva({ ...c, fechaLimite: '2026-12-05' }, '2026-10-31'), '2026-12-05')
})

test('un borrador guardado vuelve a ser un carrito; lo que no es un carrito, o una línea rota, se descarta', () => {
  const c = elegirCliente(agregarProducto(carritoVacio('45'), producto()).carrito, cliente())
  assert.deepEqual(carritoDeJson(JSON.parse(JSON.stringify(c))), c)
  assert.equal(carritoDeJson(null), null)
  assert.equal(carritoDeJson({ tipo: '45' }), null)
  const rota = carritoDeJson({ ...JSON.parse(JSON.stringify(c)), lineas: [{ id: 1, nombre: 'x' }, ...JSON.parse(JSON.stringify(c.lineas))] })
  assert.equal(rota?.lineas.length, 1)
  assert.ok((rota?.siguienteId ?? 0) > 1)
})

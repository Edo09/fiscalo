// lib/reglas: los mensajes exactos de la validación previa y el estado del botón Emitir (con su precedencia).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFacturaSchema } from '@/api/schemas/factura'
import { agregarLibre, agregarProducto, carritoVacio, elegirCliente, elegirPago } from '~/lib/carrito'
import type { Carrito, ClienteSel, LineaCarrito, ProductoSel } from '~/lib/carrito'
import { construirPayloadVenta } from '~/lib/payload'
import { estadoBotonEmitir, validarLinea, validarRevision } from '~/lib/reglas'
import type { EntradaRevision } from '~/lib/reglas'

const cliente = (c: Partial<ClienteSel> = {}): ClienteSel => ({ id: 3, nombre: 'Min. de Obras', rnc: '401123456', permiteCredito: true, descuento: 0, ...c })
const producto = (p: Partial<ProductoSel> = {}): ProductoSel => ({ id: 7, nombre: 'Asesoría', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43', ...p })

/** Un E45 válido: el carrito del ejemplo (1 x 5000 + 2 x 2500 = RD$ 11,800.00). */
function base(cambios: Partial<EntradaRevision> = {}, carrito?: Carrito): EntradaRevision {
  let c = elegirCliente(carritoVacio('45'), cliente())
  c = agregarProducto(c, producto()).carrito
  c = agregarProducto(c, producto({ id: 8, nombre: 'Mantenimiento', precio: 2500 })).carrito
  c = agregarProducto(c, producto({ id: 8, nombre: 'Mantenimiento', precio: 2500 })).carrito
  return {
    carrito: carrito ?? c,
    hoy: '2026-10-27',
    rncEmisor: '131-00000-1',
    admiteDecimales: () => true,
    unidadValida: () => true,
    enLinea: true,
    rangoVigente: true,
    tipoHabilitado: true,
    envioEnCurso: false,
    envioSinConfirmar: false,
    ...cambios,
  }
}
const mensajes = (e: EntradaRevision): string[] => validarRevision(e).map((x) => x.mensaje)
const linea = (l: Partial<LineaCarrito> = {}): LineaCarrito => ({ id: 1, nombre: 'Flete', cant: 1, precio: 100, desc: 0, indFact: 1, tipoItem: 2, unidad: '43', ...l })

test('un E45 válido no tiene errores y el botón dice Emitir E45 · RD$ 11,800.00', () => {
  assert.deepEqual(validarRevision(base()), [])
  assert.deepEqual(estadoBotonEmitir(base()), { kind: 'listo', etiqueta: 'Emitir E45 · RD$ 11,800.00' })
})

test('el cliente: sin cliente, sin RNC y con el RNC de la empresa dicen sus textos exactos', () => {
  const e = base()
  assert.deepEqual(mensajes({ ...e, carrito: { ...e.carrito, cliente: null } }), ['Elige un cliente de la lista o créalo con el botón +.'])
  assert.deepEqual(mensajes({ ...e, carrito: elegirCliente(e.carrito, cliente({ rnc: null })) }), ['Falta el RNC'])
  assert.deepEqual(mensajes({ ...e, carrito: elegirCliente(e.carrito, cliente({ rnc: '131-00000-1' })) }), ['Es el RNC de tu empresa'])
})

test('un E32 pasa sin cliente en 249,999.99 y con 250,000 pide comprador con RNC', () => {
  const c = agregarLibre(carritoVacio('32'), 'Venta').carrito
  const con = (precio: number): EntradaRevision => base({}, { ...c, lineas: [{ ...c.lineas[0], precio, indFact: 4 }] })
  assert.deepEqual(validarRevision(con(249999.99)), [])
  assert.deepEqual(mensajes(con(250000)), ['Las facturas de consumo de RD$250,000 o más tienen que identificar al comprador. Elige un cliente con RNC o cédula.'])
  const e = con(250000)
  assert.deepEqual(validarRevision({ ...e, carrito: elegirCliente(e.carrito, cliente()) }), [])
  assert.deepEqual(mensajes({ ...e, carrito: elegirCliente(e.carrito, cliente({ rnc: '131000001' })) }), ['Es el RNC de tu empresa'])
})

test('el crédito: cliente solo de contado, sin cliente y una fecha pasada dicen cada uno su texto', () => {
  const e = base()
  const credito = elegirPago(e.carrito, { pago: 'credito', plazoDias: 30 })
  assert.deepEqual(validarRevision({ ...e, carrito: credito }), [])
  assert.deepEqual(mensajes({ ...e, carrito: { ...credito, cliente: cliente({ permiteCredito: false }) } }), ['Este cliente es solo de contado'])
  assert.deepEqual(mensajes({ ...e, carrito: { ...credito, cliente: null } }).slice(-1), ['Elige un cliente para vender a crédito'])
  assert.deepEqual(mensajes({ ...e, carrito: elegirPago(credito, { pago: 'credito', fechaLimite: '2026-10-01' }) }), ['La fecha límite de pago no puede ser anterior a hoy.'])
})

test('sin líneas: el texto de agregar; una sola línea sin precio da el error de precio y no el del total', () => {
  const e = base()
  assert.deepEqual(mensajes({ ...e, carrito: { ...e.carrito, lineas: [] } }), ['Agrega al menos un producto o servicio.'])
  const sinPrecio = agregarLibre(e.carrito, 'Flete')
  const solo = { ...e, carrito: { ...e.carrito, lineas: sinPrecio.carrito.lineas.slice(-1) } }
  assert.deepEqual(mensajes(solo), ['El precio debe ser mayor que 0.'])
})

test('los mensajes de cada campo de una línea', () => {
  const m = (l: Partial<LineaCarrito>, admite = true): string[] => validarLinea(linea(l), admite).map((x) => x.mensaje)
  assert.deepEqual(m({ nombre: '  ' }), ['El nombre es obligatorio.'])
  assert.deepEqual(m({ nombre: 'a'.repeat(81) }), ['El nombre no puede superar 80 caracteres (límite DGII).'])
  assert.deepEqual(m({ nombre: '😀'.repeat(41) }), ['El nombre no puede superar 80 caracteres (límite DGII).'])
  assert.deepEqual(m({ nombre: '😀'.repeat(40) }), []) // 80 unidades
  assert.deepEqual(m({ cant: 0 }), ['La cantidad debe ser mayor que 0.'])
  assert.deepEqual(m({ cant: 1.005 }), ['La cantidad admite hasta 2 decimales.'])
  assert.deepEqual(m({ cant: 0.5 }, false), ['Esta unidad no admite fracciones'])
  assert.deepEqual(m({ precio: 0 }), ['El precio debe ser mayor que 0.'])
  assert.deepEqual(m({ precio: 1.23456 }), ['El precio admite hasta 4 decimales.'])
  assert.deepEqual(m({ desc: 101 }), ['El descuento debe estar entre 0 y 100.'])
  assert.deepEqual(m({ desc: -1 }), ['El descuento debe estar entre 0 y 100.'])
})

test('un nombre que pasa la validación también pasa createFacturaSchema', () => {
  for (const nombre of ['😀'.repeat(40), 'ñ'.repeat(80), 'a']) {
    const e = base({}, { ...base().carrito, lineas: [linea({ nombre })] })
    assert.equal(validarLinea(e.carrito.lineas[0], true).length, 0)
    assert.equal(createFacturaSchema.safeParse(construirPayloadVenta(e.carrito, e.hoy)).success, true, nombre)
  }
})

test('la unidad que el catálogo no tiene pide elegir otra', () => {
  assert.deepEqual(mensajes(base({ unidadValida: (u) => u !== '43' })).slice(0, 1), ['Elige la unidad de medida de esta línea.'])
})

test('el botón: cada estado gana a los de abajo, con sus rótulos exactos', () => {
  const malo = { ...base().carrito, cliente: null }
  const todo = { ...base({}, malo), envioEnCurso: true, envioSinConfirmar: true, tipoHabilitado: false, enLinea: false, rangoVigente: false }
  assert.deepEqual(estadoBotonEmitir(todo), { kind: 'enCurso', etiqueta: 'Hay una emisión en curso: Ver' })
  assert.deepEqual(estadoBotonEmitir({ ...todo, envioEnCurso: false }), { kind: 'sinConfirmar', etiqueta: 'Hay un envío sin confirmar: revisa Facturas' })
  assert.deepEqual(estadoBotonEmitir({ ...todo, envioEnCurso: false, envioSinConfirmar: false }), { kind: 'planNoIncluye', etiqueta: 'Tu plan no incluye E45' })
  assert.deepEqual(estadoBotonEmitir({ ...todo, envioEnCurso: false, envioSinConfirmar: false, tipoHabilitado: true }), { kind: 'sinConexion', etiqueta: 'Sin conexión: borrador guardado' })
  const sinRango = { ...todo, envioEnCurso: false, envioSinConfirmar: false, tipoHabilitado: true, enLinea: true }
  assert.deepEqual(estadoBotonEmitir(sinRango), { kind: 'sinRango', etiqueta: 'No hay numeración vigente para E45' })
  assert.equal(estadoBotonEmitir({ ...sinRango, rangoVigente: null }).kind, 'corregir') // sin dato de numeración no se bloquea
})

test('Corregir cuenta los campos: un error de cliente y uno de línea son 2', () => {
  const e = base()
  const carrito = { ...e.carrito, cliente: null, lineas: [{ ...e.carrito.lineas[0], precio: 0 }] }
  assert.deepEqual(estadoBotonEmitir({ ...e, carrito }), { kind: 'corregir', etiqueta: 'Corregir 2 campos' })
  assert.deepEqual(estadoBotonEmitir({ ...e, carrito: { ...carrito, cliente: cliente() } }), { kind: 'corregir', etiqueta: 'Corregir 1 campo' })
})

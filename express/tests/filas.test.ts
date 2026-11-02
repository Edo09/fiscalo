// lib/filas: las filas del API a tipos de verdad. PDO manda los INT y los DECIMAL como texto («11800.00»), los flags como '0' y '1' (`permitir_credito`
// puede ser el texto "0", que como texto es verdadero) y `respuesta_dgii` como texto JSON: aquí se leen una sola vez y las pantallas no vuelven a
// mirar el texto. Todo lo que se normaliza es de mentira.
import assert from 'node:assert/strict'
import test from 'node:test'
import { aNumero } from '@/lib/format'
import { esUno, normalizarCliente, normalizarFactura, normalizarProducto, num } from '~/lib/filas'
import type { FacturaVista, LineaVista } from '~/lib/filas'
import { UNIDAD_POR_DEFECTO } from '~/lib/unidades'

/** Congela el valor y todo lo que contiene: una función que intente escribir en la fila que recibe lanza (los módulos de ESM son estrictos). */
function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const hijo of Object.values(valor)) congelar(hijo)
  }
  return valor
}

// --- esUno y num ---------------------------------------------------------------------------------------------------------------------

test('esUno y num', () => {
  for (const v of ['1', 1, true]) assert.equal(esUno(v), true)
  for (const v of ['0', 0, null, '']) assert.equal(esUno(v), false)
  assert.equal(num('11800.00'), 11800)
  for (const v of ['', null, 'abc']) assert.equal(num(v), 0)
})

test('esUno es «vale uno»: lo demás, también el texto que es verdadero en JavaScript, es falso', () => {
  // `permitir_credito` es 1 (se le puede facturar a crédito) o 0 (solo contado). Leerlo como texto daría crédito a un cliente «solo contado»:
  // lo que no es claramente uno es no.
  for (const v of [false, undefined, 2, '2', -1, 'true', 'yes', 'abc', NaN, [1], {}, '0.0', ' ']) assert.equal(esUno(v), false, JSON.stringify(v) ?? String(v))
  for (const v of [1, '1', true, 1.0, '1.00', ' 1 ']) assert.equal(esUno(v), true, JSON.stringify(v))
})

test('num lee el número de un DECIMAL en texto y da 0 a lo que no es un número', () => {
  assert.equal(num('84.7500'), 84.75)
  assert.equal(num('-5.50'), -5.5)
  assert.equal(num(3.5), 3.5)
  assert.equal(num('1e3'), 1000)
  for (const v of [undefined, NaN, Infinity, -Infinity, 'Infinity', '  ', 'RD$ 5', '1,250', {}, [], true, false, [5]]) assert.equal(num(v), 0, String(v))
  // Nunca -0: sería «-0» en pantalla.
  assert.ok(Object.is(num(-0), 0))
  assert.ok(Object.is(num('-0'), 0))
  assert.ok(Object.is(num('-0.00'), 0))
})

test('num y aNumero de la app completa dicen lo mismo de lo que el API manda de verdad (número, DECIMAL en texto, vacío)', () => {
  const valores: unknown[] = [0, 1, -1, 3.5, '3.000', '84.7500', '11800.00', '-5.50', '1e3', ' 12 ', '', null, undefined, 'abc', NaN, Infinity, 'Infinity', -0, '-0']
  for (const v of valores) assert.ok(Object.is(num(v), aNumero(v)), String(v))
})

// --- normalizarCliente ---------------------------------------------------------------------------------------------------------------

test('normalizarCliente', () => {
  const c = normalizarCliente({ id: '7', razon_social: 'ACME SRL', company_name: 'x', client_name: 'y', permitir_credito: '0', descuento: '10.00' })
  assert.deepEqual([c.nombre, c.permiteCredito, c.descuento], ['ACME SRL', false, 10])
  assert.equal(normalizarCliente({ id: 1 }).nombre, 'Consumidor final')
})

test('normalizarCliente: una fila de clients completa, con el id y los DECIMAL en texto', () => {
  const fila = {
    id: '7',
    email: 'compras@acme.test',
    rnc: '131880681',
    razon_social: 'ACME SRL',
    direccion: 'Calle 1',
    municipio: 'Santo Domingo',
    provincia: 'Distrito Nacional',
    client_name: 'Ana Pérez',
    company_name: 'ACME',
    phone_number: '809-555-0100',
    descuento: '5.50',
    permitir_credito: '1',
  }
  assert.deepEqual(normalizarCliente(fila), {
    id: 7,
    nombre: 'ACME SRL',
    rnc: '131880681',
    telefono: '809-555-0100',
    email: 'compras@acme.test',
    permiteCredito: true,
    descuento: 5.5,
  })
})

test('normalizarCliente: el nombre es razon_social, o company_name, o client_name, y los vacíos no cuentan', () => {
  assert.equal(normalizarCliente({ razon_social: 'A', company_name: 'B', client_name: 'C' }).nombre, 'A')
  assert.equal(normalizarCliente({ razon_social: '', company_name: 'B', client_name: 'C' }).nombre, 'B')
  assert.equal(normalizarCliente({ razon_social: null, company_name: 'B', client_name: 'C' }).nombre, 'B')
  assert.equal(normalizarCliente({ razon_social: '   ', company_name: 'B', client_name: 'C' }).nombre, 'B')
  assert.equal(normalizarCliente({ company_name: '', client_name: 'C' }).nombre, 'C')
  assert.equal(normalizarCliente({ razon_social: ' ACME SRL ' }).nombre, 'ACME SRL')
  for (const fila of [{}, { razon_social: '', company_name: null, client_name: '  ' }]) assert.equal(normalizarCliente(fila).nombre, 'Consumidor final')
})

test('normalizarCliente: lo que no hay es null, y un cliente solo contado no es de crédito', () => {
  const c = normalizarCliente({ id: 3, rnc: '', phone_number: null, email: '   ' })
  assert.deepEqual([c.rnc, c.telefono, c.email], [null, null, null])
  assert.equal(normalizarCliente({ id: 3, rnc: ' 401123456 ' }).rnc, '401123456')
  for (const v of ['1', 1, true]) assert.equal(normalizarCliente({ permitir_credito: v }).permiteCredito, true, String(v))
  for (const v of ['0', 0, false, null, undefined, '', 'false']) assert.equal(normalizarCliente({ permitir_credito: v }).permiteCredito, false, String(v))
  assert.equal(normalizarCliente({}).permiteCredito, false)
  assert.equal(normalizarCliente({ descuento: null }).descuento, 0)
  assert.equal(normalizarCliente({ descuento: 'abc' }).descuento, 0)
  assert.equal(normalizarCliente({ descuento: 12.5 }).descuento, 12.5)
})

test('normalizarCliente con algo que no es una fila no lanza: es un consumidor final sin datos', () => {
  for (const r of [null, undefined, 'x', 7, [], true]) {
    assert.deepEqual(normalizarCliente(r), { id: 0, nombre: 'Consumidor final', rnc: null, telefono: null, email: null, permiteCredito: false, descuento: 0 })
  }
})

// --- normalizarProducto --------------------------------------------------------------------------------------------------------------

/** Una fila de products completa: lo que la vista no usa (stock, costo, nombres de categoría y almacén, foto) se ignora. */
const PRODUCTO = {
  id: '7',
  sku: 'CEM-42',
  nombre: 'Cemento gris 42 kg',
  descripcion: 'Saco',
  category_id: 3,
  warehouse_id: 2,
  indicador_bien_servicio: 1,
  indicador_facturacion: 2,
  precio: '640.0000',
  costo: '410.5000',
  unidad_medida: '43',
  stock: '12.500',
  stock_minimo: '2.000',
  activo: 1,
  imagen_path: 'p/7.jpg',
  categoria_nombre: 'Obra',
  almacen_nombre: 'Almacén Principal',
}

test('normalizarProducto', () => {
  const p = normalizarProducto({ id: 1, nombre: 'Lijas', precio: '84.7500', activo: '0' })
  assert.equal(p.precio, 84.75)
  assert.equal(p.activo, false)
})

test('normalizarProducto: una fila de products completa', () => {
  assert.deepEqual(normalizarProducto(PRODUCTO), {
    id: 7,
    nombre: 'Cemento gris 42 kg',
    sku: 'CEM-42',
    precio: 640,
    indicadorFacturacion: 2,
    indicadorBienServicio: 1,
    unidad: '43',
    activo: true,
  })
})

test('normalizarProducto: lo que falta toma lo que la columna trae por omisión', () => {
  // ITBIS 18 %, bien, unidad 43 y activo: los mismos supuestos de la app completa (mapProductRow).
  assert.deepEqual(normalizarProducto({ id: 1 }), {
    id: 1,
    nombre: '—',
    sku: null,
    precio: 0,
    indicadorFacturacion: 1,
    indicadorBienServicio: 1,
    unidad: UNIDAD_POR_DEFECTO,
    activo: true,
  })
  assert.equal(UNIDAD_POR_DEFECTO, '43')
})

test('normalizarProducto: «no facturable» (0) se queda en 0 y no se vuelve ITBIS 18 %', () => {
  for (const v of [0, '0']) assert.equal(normalizarProducto({ indicador_facturacion: v }).indicadorFacturacion, 0, String(v))
  for (const [v, esperado] of [[1, 1], ['2', 2], [3, 3], ['4', 4], [null, 1], [undefined, 1], ['', 1]] as const) {
    assert.equal(normalizarProducto({ indicador_facturacion: v }).indicadorFacturacion, esperado, String(v))
  }
})

test('normalizarProducto: bien o servicio, solo 2 es servicio', () => {
  for (const v of [2, '2']) assert.equal(normalizarProducto({ indicador_bien_servicio: v }).indicadorBienServicio, 2, String(v))
  for (const v of [1, '1', null, undefined, '', 0, 3, 'x']) assert.equal(normalizarProducto({ indicador_bien_servicio: v }).indicadorBienServicio, 1, String(v))
})

test('normalizarProducto: activo es 1, y solo una columna ausente o nula cuenta como activo', () => {
  for (const v of [1, '1', true, null, undefined]) assert.equal(normalizarProducto({ activo: v }).activo, true, String(v))
  for (const v of [0, '0', false, '']) assert.equal(normalizarProducto({ activo: v }).activo, false, String(v))
  assert.equal(normalizarProducto({}).activo, true)
})

test('normalizarProducto: sku y unidad son texto, y la unidad que falta es la 43', () => {
  assert.equal(normalizarProducto({ sku: '' }).sku, null)
  assert.equal(normalizarProducto({ sku: '  ' }).sku, null)
  assert.equal(normalizarProducto({ sku: ' A-1 ' }).sku, 'A-1')
  assert.equal(normalizarProducto({ unidad_medida: 12 }).unidad, '12')
  assert.equal(normalizarProducto({ unidad_medida: '12' }).unidad, '12')
  for (const v of [null, undefined, '', '  ', NaN, Infinity]) assert.equal(normalizarProducto({ unidad_medida: v }).unidad, '43', String(v)) // un número que no lo es, no es un código
  assert.equal(normalizarProducto({ sku: NaN }).sku, null)
  assert.equal(normalizarProducto({ precio: null }).precio, 0)
  assert.equal(normalizarProducto({ precio: '1250.5000' }).precio, 1250.5)
})

test('normalizarProducto con algo que no es una fila no lanza', () => {
  for (const r of [null, undefined, 'x', 7, [], true]) assert.equal(normalizarProducto(r).id, 0)
})

// --- normalizarFactura ---------------------------------------------------------------------------------------------------------------

/** Las columnas de una fila de facturas que el API manda en el listado y en el detalle: el dinero y los id como texto, `tipo_ecf` sin la E. */
const BASE = {
  id: '412',
  no_factura: 'E450000000013',
  e_ncf: 'E450000000013',
  tipo_ecf: '45',
  date: '2026-10-26 09:41:00',
  client_id: '9',
  client_name: 'Min. de Obras Públicas',
  total: '11800.00',
  tipo_pago: '1',
  estado_dgii: 'ACEPTADO',
  track_id: '9f3a1c2e-0000-4000-8000-0000000000e2',
  codigo_seguridad: 'Kx9PqL',
  fecha_emision_dgii: '2026-10-26 09:41:12',
  secuencia_utilizada: '1',
  monto_gravado: '10000.00',
  monto_exento: '0.00',
  total_itbis: '1800.00',
  ncf_modificado: null,
  codigo_modificacion: null,
  notas: [
    { id: '413', e_ncf: 'E340000000002', tipo_ecf: '34', codigo_modificacion: '1', total: '11800.00', estado_dgii: 'ACEPTADO', date: '2026-10-27 10:00:00' },
  ],
  modifica: null,
}

/** GET /api/facturas?id=: la fila completa, con `items`, `cliente` (el registro, con su RNC), `emisor` y `respuesta_dgii` como texto JSON. */
const DETALLE = {
  ...BASE,
  respuesta_dgii: '{"trackId":"9f3a1c2e","codigo":"1","estado":"Aceptado","mensajes":[]}',
  items: [
    {
      id: '1',
      factura_id: '412',
      description: 'Asesoría técnica',
      amount: '5000.0000',
      quantity: '2.000',
      subtotal: '10000.00',
      descuento_monto: '0.00',
      itbis_amount: '1800.00',
      indicador_facturacion: '1',
      indicador_bien_servicio: '2',
      unidad_medida: '43',
    },
  ],
  cliente: { id: '9', rnc: '401123456', razon_social: 'Ministerio de Obras Públicas', client_name: 'Contacto', company_name: 'MOPC', phone_number: '809-555-0100' },
  emisor: { rnc: '131000001', razon_social: 'Emisor Mock SRL' },
  xml_firmado: '<ECF/>',
}

/** GET /api/facturas (lean): las columnas y el resumen plano, sin `items`, `cliente`, `emisor` ni `respuesta_dgii`. */
const LISTA = { ...BASE, company_name: 'Min. de Obras Públicas' }

const LINEA: LineaVista = { descripcion: 'Asesoría técnica', cantidad: 2, precio: 5000, subtotal: 10000, itbis: 1800, indicadorFacturacion: 1, unidad: '43' }

const DETALLE_VISTA: FacturaVista = {
  id: 412,
  numero: 'E450000000013',
  eNcf: 'E450000000013',
  tipo: '45',
  cliente: 'Min. de Obras Públicas',
  clienteId: 9,
  rnc: '401123456',
  fecha: '2026-10-26 09:41:00',
  total: 11800,
  totalConSigno: 11800,
  estado: 'ACEPTADO',
  trackId: '9f3a1c2e-0000-4000-8000-0000000000e2',
  codigoSeguridad: 'Kx9PqL',
  fechaEmisionDgii: '2026-10-26 09:41:12',
  secuenciaUtilizada: true,
  tipoPago: 1,
  items: [LINEA],
  notas: [{ id: 413, ncf: 'E340000000002', tipo: '34', codigoModificacion: '1', total: 11800, estadoDgii: 'ACEPTADO', fecha: '2026-10-27 10:00:00' }],
  modifica: null,
  codigoModificacion: null,
  respuestaDgii: { trackId: '9f3a1c2e', codigo: '1', estado: 'Aceptado', mensajes: [] },
  montoGravado: 10000,
  montoExento: 0,
  totalItbis: 1800,
}

/** Una nota de crédito (E34) que anula la factura de arriba. */
const NOTA = {
  ...BASE,
  id: '413',
  no_factura: 'E340000000002',
  e_ncf: 'E340000000002',
  tipo_ecf: '34',
  date: '2026-10-27 10:00:00',
  ncf_modificado: 'E450000000013',
  codigo_modificacion: '1',
  notas: [],
  modifica: { id: '412', e_ncf: 'E450000000013', tipo_ecf: '45', total: '11800.00', date: '2026-10-26 09:41:00' },
}

test('normalizarFactura: el detalle, con el dinero y los id como texto, queda en números de verdad', () => {
  assert.deepEqual(normalizarFactura(DETALLE), DETALLE_VISTA)
  const v = normalizarFactura(DETALLE)
  for (const campo of ['id', 'total', 'totalConSigno', 'clienteId', 'tipoPago', 'montoGravado', 'montoExento', 'totalItbis'] as const) {
    assert.equal(typeof v[campo], 'number', campo)
  }
  for (const campo of ['cantidad', 'precio', 'subtotal', 'itbis', 'indicadorFacturacion'] as const) assert.equal(typeof v.items[0][campo], 'number', campo)
})

test('normalizarFactura: la línea de la factura, con 4 decimales en el precio y 3 en la cantidad', () => {
  const linea = (o: Record<string, unknown>) => normalizarFactura({ ...BASE, items: [{ ...DETALLE.items[0], ...o }] }).items[0]
  assert.deepEqual(linea({ amount: '84.7500', quantity: '1.500', subtotal: '127.13', itbis_amount: '22.88' }), {
    ...LINEA,
    precio: 84.75,
    cantidad: 1.5,
    subtotal: 127.13,
    itbis: 22.88,
  })
  assert.equal(linea({ unidad_medida: 12 }).unidad, '12')
  assert.equal(linea({ indicador_facturacion: 4 }).indicadorFacturacion, 4)
  assert.equal(linea({ indicador_facturacion: '0' }).indicadorFacturacion, 0) // 0 es «no facturable» y se queda en 0
  assert.deepEqual(normalizarFactura({ ...BASE, items: [{}] }).items, [
    { descripcion: '', cantidad: 0, precio: 0, subtotal: 0, itbis: 0, indicadorFacturacion: 1, unidad: UNIDAD_POR_DEFECTO },
  ])
})

test('normalizarFactura: un item o una nota que no es una fila se descarta, y lo que no es lista es una lista vacía', () => {
  assert.deepEqual(normalizarFactura({ ...BASE, items: [null, 'x', 7, [], [1, 2], undefined, true, { description: 'Bueno' }] }).items.map((l) => l.descripcion), ['Bueno'])
  assert.deepEqual(normalizarFactura({ ...BASE, notas: [null, 'x', [], [1], BASE.notas[0]] }).notas.map((n) => n.id), [413])
  for (const malo of [null, undefined, 'x', 7, {}]) {
    assert.deepEqual(normalizarFactura({ ...BASE, items: malo }).items, [])
    assert.deepEqual(normalizarFactura({ ...BASE, notas: malo }).notas, [])
  }
  assert.deepEqual(normalizarFactura({ ...BASE, items: undefined }).items, [])
})

test('normalizarFactura: rnc sale del cliente del detalle, y es null en una fila de lista y en un E32 sin cliente', () => {
  assert.equal(normalizarFactura(DETALLE).rnc, '401123456')
  // La fila de lista no trae `cliente`: ni el RNC ni nada del registro.
  assert.equal(normalizarFactura(LISTA).rnc, null)
  // Un E32 sin cliente: el detalle trae `cliente: null`.
  const e32 = { ...DETALLE, id: '77', e_ncf: 'E320000000005', no_factura: 'E320000000005', tipo_ecf: '32', client_id: null, client_name: null, total: '590.00', cliente: null }
  const v = normalizarFactura(e32)
  assert.equal(v.rnc, null)
  assert.equal(v.clienteId, null)
  assert.equal(v.cliente, 'Consumidor final')
  // Un cliente sin RNC (o con el RNC en blanco) tampoco da un texto vacío.
  assert.equal(normalizarFactura({ ...DETALLE, cliente: { id: '9', rnc: null } }).rnc, null)
  assert.equal(normalizarFactura({ ...DETALLE, cliente: { id: '9', rnc: '  ' } }).rnc, null)
  assert.equal(normalizarFactura({ ...DETALLE, cliente: 'x' }).rnc, null)
})

test('normalizarFactura: la fila de lista no trae items, respuesta ni cliente, y lo demás es igual que en el detalle', () => {
  const v = normalizarFactura(LISTA)
  assert.deepEqual(v.items, [])
  assert.equal(v.respuestaDgii, null)
  assert.deepEqual({ ...v, rnc: DETALLE_VISTA.rnc, items: DETALLE_VISTA.items, respuestaDgii: DETALLE_VISTA.respuestaDgii }, DETALLE_VISTA)
})

test('normalizarFactura: numero es el e-NCF, o no_factura si el e-NCF es null (una fila archivada)', () => {
  assert.equal(normalizarFactura(DETALLE).numero, 'E450000000013')
  // El e-NCF gana aunque no_factura sea otro texto: no_factura es el número tal como se guardó, y solo es el de la fila si no hay e-NCF.
  assert.equal(normalizarFactura({ ...BASE, no_factura: 'F-0001' }).numero, 'E450000000013')
  assert.equal(normalizarFactura({ ...BASE, no_factura: 'F-0001' }).eNcf, 'E450000000013')
  const archivada = normalizarFactura({ ...BASE, id: '5', e_ncf: null, no_factura: 'E450000000014', estado_dgii: 'RECHAZADO_ARCHIVADO', track_id: null })
  assert.equal(archivada.numero, 'E450000000014')
  assert.equal(archivada.eNcf, null) // no hay e-NCF que copiar ni compartir: su número lo reusó otro comprobante
  assert.equal(archivada.trackId, null)
  assert.equal(archivada.estado, 'RECHAZADO_ARCHIVADO')
  assert.equal(normalizarFactura({ ...BASE, e_ncf: '', no_factura: 'F-9' }).numero, 'F-9')
  assert.equal(normalizarFactura({ ...BASE, e_ncf: null, no_factura: null }).numero, '')
  assert.equal(normalizarFactura({ ...BASE, e_ncf: ' E450000000013 ' }).eNcf, 'E450000000013')
})

test('normalizarFactura: una factura simple (NCF de papel, sin e-NCF) no tiene e-NCF que copiar ni compartir', () => {
  // La app completa muestra `e_ncf || NCF`; Express no: un B01 no es un e-NCF, y «Copiar e-NCF» y Compartir son solo de lo que la DGII aceptó.
  const simple = normalizarFactura({ ...BASE, e_ncf: null, no_factura: '00123', NCF: 'B0100000001', tipo_ecf: null, estado_dgii: null, track_id: null })
  assert.equal(simple.eNcf, null)
  assert.equal(simple.numero, '00123')
  assert.equal(simple.tipo, '')
  assert.equal(simple.estado, '')
})

test('normalizarFactura: una nota de crédito (E34) resta, y el total de las demás suma', () => {
  const nota = normalizarFactura(NOTA)
  assert.equal(nota.total, 11800)
  assert.equal(nota.totalConSigno, -nota.total)
  assert.equal(nota.totalConSigno, -11800)
  assert.equal(nota.tipo, '34')
  assert.deepEqual(nota.modifica, { id: 412, ncf: 'E450000000013', tipo: '45', total: 11800, fecha: '2026-10-26 09:41:00' })
  assert.equal(nota.codigoModificacion, '1')
  // Una nota de débito (E33) suma; una factura también.
  assert.equal(normalizarFactura({ ...NOTA, tipo_ecf: '33' }).totalConSigno, 11800)
  assert.equal(normalizarFactura(DETALLE).totalConSigno, 11800)
  // Un total en cero no es «-0» ni en una nota de crédito.
  assert.ok(Object.is(normalizarFactura({ ...NOTA, total: '0.00' }).totalConSigno, 0))
  assert.ok(Object.is(normalizarFactura({ ...NOTA, total: null }).totalConSigno, 0))
})

test('normalizarFactura: las notas que la modifican llegan con id y total en número', () => {
  const v = normalizarFactura({ ...DETALLE, notas: [{ id: '413', e_ncf: 'E340000000002', tipo_ecf: '34', codigo_modificacion: ' 1 ', total: '82200.00', estado_dgii: 'ENVIO_INCIERTO', date: null }] })
  assert.deepEqual(v.notas, [{ id: 413, ncf: 'E340000000002', tipo: '34', codigoModificacion: '1', total: 82200, estadoDgii: 'ENVIO_INCIERTO', fecha: null }])
  assert.deepEqual(normalizarFactura(NOTA).notas, [])
  assert.equal(normalizarFactura(DETALLE).modifica, null)
})

test('normalizarFactura: el monto que falta es null, y el que viene en cero es 0', () => {
  const sinMontos: Record<string, unknown> = { ...BASE }
  for (const columna of ['monto_gravado', 'monto_exento', 'total_itbis']) delete sinMontos[columna] // la clave ausente, no puesta en undefined
  const v = normalizarFactura(sinMontos)
  assert.deepEqual([v.montoGravado, v.montoExento, v.totalItbis], [null, null, null])
  for (const vacio of [null, undefined, '', '  ', 'abc']) {
    const f = normalizarFactura({ ...BASE, monto_gravado: vacio, monto_exento: vacio, total_itbis: vacio })
    assert.deepEqual([f.montoGravado, f.montoExento, f.totalItbis], [null, null, null], String(vacio))
  }
  const ceros = normalizarFactura({ ...BASE, monto_gravado: '0.00', monto_exento: 0, total_itbis: '0' })
  assert.deepEqual([ceros.montoGravado, ceros.montoExento, ceros.totalItbis], [0, 0, 0])
  assert.equal(normalizarFactura({ ...BASE, monto_exento: '2500.50' }).montoExento, 2500.5)
})

test('normalizarFactura: secuencia_utilizada llega como 1, 0, "1", "0", booleano o ausente', () => {
  const casos: [unknown, boolean | null][] = [
    ['1', true],
    [1, true],
    [true, true],
    ['0', false],
    [0, false],
    [false, false],
    [null, null],
    [undefined, null],
    ['', null],
  ]
  for (const [valor, esperado] of casos) assert.equal(normalizarFactura({ ...BASE, secuencia_utilizada: valor }).secuenciaUtilizada, esperado, JSON.stringify(valor) ?? 'undefined')
  const sinColumna: Record<string, unknown> = { ...BASE }
  delete sinColumna.secuencia_utilizada
  assert.equal(normalizarFactura(sinColumna).secuenciaUtilizada, null) // la columna no está
})

test('normalizarFactura: tipo_pago es 1, 2 o 3 en número, o null', () => {
  for (const [valor, esperado] of [['1', 1], [2, 2], ['3', 3], [null, null], [undefined, null], ['', null], ['abc', null]] as const) {
    assert.equal(normalizarFactura({ ...BASE, tipo_pago: valor }).tipoPago, esperado, String(valor))
  }
})

test('normalizarFactura: respuesta_dgii es JSON en texto, y lo que no se puede leer se conserva tal cual', () => {
  const respuesta = (valor: unknown): unknown => normalizarFactura({ ...BASE, respuesta_dgii: valor }).respuestaDgii
  assert.deepEqual(respuesta('{"estado":"Rechazado","mensajes":[{"valor":"Fecha vencida","codigo":145}]}'), {
    estado: 'Rechazado',
    mensajes: [{ valor: 'Fecha vencida', codigo: 145 }],
  })
  for (const vacio of [null, undefined, '', '   ']) assert.equal(respuesta(vacio), null, String(vacio)) // en vuelo: la DGII todavía no ha dicho nada
  assert.equal(respuesta('"Recibido"'), 'Recibido') // una fila vieja guarda un texto JSON
  assert.equal(respuesta('Recibido'), 'Recibido') // y una más vieja, texto que ni es JSON: se conserva
  assert.equal(respuesta('{"estado":'), '{"estado":') // JSON cortado
  assert.equal(respuesta('null'), null)
  assert.equal(respuesta('123'), 123)
  const yaLeida = { estado: 'Aceptado' }
  assert.equal(respuesta(yaLeida), yaLeida) // si el API algún día manda el objeto, pasa tal cual
  // Un JSON con un mensaje de rechazo no se vuelve texto a medias: es un objeto con sus mensajes.
  assert.equal(typeof respuesta('{"mensajes":[]}'), 'object')
})

test('normalizarFactura: un E32 de resumen de consumo trae su respuesta en rfce_respuesta, y respuesta_dgii manda si las dos vienen', () => {
  const rechazo = '{"codigo":2,"estado":"Rechazado","mensajes":[{"valor":"El MontoTotal no corresponde","codigo":999}]}'
  const del = (campos: Record<string, unknown>): unknown => normalizarFactura({ ...BASE, ...campos }).respuestaDgii
  assert.deepEqual(del({ respuesta_dgii: null, rfce_respuesta: rechazo }), { codigo: 2, estado: 'Rechazado', mensajes: [{ valor: 'El MontoTotal no corresponde', codigo: 999 }] })
  assert.equal(del({ respuesta_dgii: null, rfce_respuesta: null }), null)
  assert.deepEqual(del({ respuesta_dgii: '{"estado":"Aceptado"}', rfce_respuesta: rechazo }), { estado: 'Aceptado' })
})

test('normalizarFactura: el cliente de la fila es client_name, y sin él company_name, el del registro del detalle o «Consumidor final»', () => {
  const nombre = (o: Record<string, unknown>): string => normalizarFactura({ ...BASE, ...o }).cliente
  assert.equal(nombre({ client_name: 'Constructora Cibao', company_name: 'Otra', cliente: DETALLE.cliente }), 'Constructora Cibao') // lo que se emitió
  assert.equal(nombre({ client_name: '', company_name: 'Otra SRL', cliente: DETALLE.cliente }), 'Otra SRL')
  assert.equal(nombre({ client_name: null, company_name: null, cliente: DETALLE.cliente }), 'Ministerio de Obras Públicas') // razon_social del registro
  assert.equal(nombre({ client_name: null, cliente: { company_name: 'MOPC', client_name: 'Contacto' } }), 'MOPC')
  assert.equal(nombre({ client_name: null, cliente: { client_name: 'Contacto' } }), 'Contacto')
  for (const o of [{ client_name: null }, { client_name: '   ', company_name: '' }, { client_name: null, cliente: null }, { client_name: null, cliente: {} }]) {
    assert.equal(nombre(o), 'Consumidor final', JSON.stringify(o))
  }
  assert.equal(nombre({ client_name: '  Ana  ' }), 'Ana')
})

test('normalizarFactura: lo que falta en la fila queda en su valor vacío, sin lanzar', () => {
  assert.deepEqual(normalizarFactura({ id: 5 }), {
    id: 5,
    numero: '',
    eNcf: null,
    tipo: '',
    cliente: 'Consumidor final',
    clienteId: null,
    rnc: null,
    fecha: '',
    total: 0,
    totalConSigno: 0,
    estado: '',
    trackId: null,
    codigoSeguridad: null,
    fechaEmisionDgii: null,
    secuenciaUtilizada: null,
    tipoPago: null,
    items: [],
    notas: [],
    modifica: null,
    codigoModificacion: null,
    respuestaDgii: null,
    montoGravado: null,
    montoExento: null,
    totalItbis: null,
  })
  for (const r of [null, undefined, 'x', 7, [], true]) assert.equal(normalizarFactura(r).id, 0)
})

test('normalizarFactura: tipo_ecf y estado_dgii son texto, y el estado se conserva tal cual lo manda el API', () => {
  assert.equal(normalizarFactura({ ...BASE, tipo_ecf: 45 }).tipo, '45')
  assert.equal(normalizarFactura({ ...BASE, tipo_ecf: null }).tipo, '')
  for (const estado of ['ENVIO_INCIERTO', 'RFCE_ACEPTADO_CONDIC', 'RECHAZADO_ARCHIVADO', 'INVENTADO']) {
    assert.equal(normalizarFactura({ ...BASE, estado_dgii: estado }).estado, estado)
  }
  for (const vacio of [null, undefined, '']) assert.equal(normalizarFactura({ ...BASE, estado_dgii: vacio }).estado, '') // sin estado: el bucket lo trata como sin confirmar
  // El estado llega a lib/etiquetas sin tocar: ni se recorta ni se pasa a mayúsculas, así que lo que casi es un estado aceptado no se vuelve aceptado
  // aquí. Y lo que no es texto no es un estado.
  for (const casi of ['aceptado', 'Aceptado', ' ACEPTADO', 'ACEPTADO ', 'ACEPTADO\n', '  ']) assert.equal(normalizarFactura({ ...BASE, estado_dgii: casi }).estado, casi, JSON.stringify(casi))
  for (const raro of [['ACEPTADO'], 7, true, {}]) assert.equal(normalizarFactura({ ...BASE, estado_dgii: raro }).estado, '')
  assert.equal(normalizarFactura({ ...BASE, codigo_modificacion: ' 1 ' }).codigoModificacion, '1')
  assert.equal(normalizarFactura({ ...BASE, codigo_seguridad: '' }).codigoSeguridad, null)
})

test('normalizarFactura no modifica la fila que recibe y no comparte con ella lo que arma', () => {
  // Con la fila congelada, cualquier escritura en ella lanza.
  const fila: typeof DETALLE = congelar(JSON.parse(JSON.stringify(DETALLE)))
  const v = normalizarFactura(fila)
  assert.deepEqual(v, DETALLE_VISTA)
  assert.notEqual(v.items, fila.items)
  assert.notEqual(v.notas, fila.notas)
  // Dos llamadas, dos resultados: cambiar uno no cambia el otro.
  const w = normalizarFactura(fila)
  w.items.push(LINEA)
  w.notas.length = 0
  assert.equal(normalizarFactura(fila).items.length, 1)
  assert.equal(normalizarFactura(fila).notas.length, 1)
  // Lo mismo con una nota, que lleva `modifica`.
  assert.equal(normalizarFactura(congelar(JSON.parse(JSON.stringify(NOTA)))).modifica?.id, 412)
})

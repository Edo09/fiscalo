// net/clientes y net/productos: lo que viaja por la red. Un `fetch` que graba cada petición (método, ruta, cuerpo) y contesta lo que se le diga; ninguna sale de la máquina. Se fija lo que el API real
// espera: la lista siempre con `page` y `pageSize`, el PUT de clientes solo con lo que cambió, el PUT de productos con las 16 columnas leídas justo antes (el servidor pisa lo que no viaja), el alta sin
// descuento ni crédito, y que un alta cuya respuesta se perdió se busca y NO se repite.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { ApiError } from '@/api/errores'
import type { ClientRow } from '@/api/types'
import { construirAltaCliente } from '~/lib/clientes'
import { payloadCrear, formNuevoProducto } from '~/lib/productos'
import { buscarClientes, clientesPorRnc, consultarRncExpress, crearCliente, editarCliente, leerCliente } from '~/net/clientes'
import { buscarProductos, crearProducto, guardarCambios, leerProducto } from '~/net/productos'

interface Peticion {
  metodo: string
  ruta: string
  params: URLSearchParams
  cuerpo: any
  senal: boolean
}
type Contestacion = { status: number; cuerpo: unknown } | 'sin-red'

const ORIGEN = 'http://prueba.test'
const fetchReal = globalThis.fetch
let peticiones: Peticion[] = []
let porContestar: Contestacion[] = []
const ok = (data: unknown, extra: object = {}): Contestacion => ({ status: 200, cuerpo: { status: true, data, ...extra } })
const lista = (items: unknown[]): Contestacion => ok(items, { pagination: { page: 1, pageSize: 25, total: items.length, totalPages: 1 } })

beforeEach(() => {
  peticiones = []
  porContestar = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url), ORIGEN)
    peticiones.push({ metodo: init?.method ?? 'GET', ruta: u.pathname, params: u.searchParams, cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null, senal: init?.signal instanceof AbortSignal })
    const c = porContestar.shift() ?? ok([])
    if (c === 'sin-red') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(c.cuerpo), { status: c.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

const ya = (...c: Contestacion[]): void => {
  porContestar = [...c]
}
const tal = (p: Peticion): string => `${p.metodo} ${p.ruta}${p.params.toString() === '' ? '' : `?${p.params.toString()}`}`

// --- Clientes -------------------------------------------------------------------------------------------------------------------------

test('la lista de clientes siempre lleva page y pageSize, y el query solo si hay', async () => {
  await buscarClientes({ page: 2, pageSize: 20, query: '131256432' })
  await buscarClientes({ page: 1, pageSize: 20 })
  await buscarClientes({ page: 1, pageSize: 20, query: '' })
  assert.deepEqual(peticiones.map(tal), ['GET /api/clients?page=2&pageSize=20&query=131256432', 'GET /api/clients?page=1&pageSize=20', 'GET /api/clients?page=1&pageSize=20'])
})

test('el detalle de un cliente pide ?id= y un 404 llega como ApiError 404', async () => {
  ya(ok({ id: '7', client_name: 'Juan' }))
  const fila = await leerCliente(7)
  assert.equal(tal(peticiones[0]), 'GET /api/clients?id=7')
  assert.equal((fila as any).client_name, 'Juan')
  ya({ status: 404, cuerpo: { status: false, error: 'No encontramos este cliente. Puede que lo hayan eliminado.' } })
  await assert.rejects(leerCliente(99), (e: unknown) => e instanceof ApiError && e.status === 404)
})

test('editar un cliente es un PUT con el id y solo lo que cambió', async () => {
  await editarCliente({ id: 1, phone_number: '8095550199' })
  assert.deepEqual(peticiones.map(tal), ['PUT /api/clients'])
  assert.deepEqual(peticiones[0].cuerpo, { id: 1, phone_number: '8095550199' })
})

test('la consulta de RNC va por ?rnc= con su tiempo límite', async () => {
  ya(ok({ rnc: '131256432', tipo: 'RNC', razon_social: 'CONSTRUCTORA CIBAO SRL', estado: 'ACTIVO' }))
  const r = await consultarRncExpress('131256432')
  assert.equal(tal(peticiones[0]), 'GET /api/rnc/consulta?rnc=131256432')
  assert.equal(peticiones[0].senal, true)
  assert.equal(r.razon_social, 'CONSTRUCTORA CIBAO SRL')
})

test('el alta manda solo lo que se escribió (nunca descuento ni crédito) y devuelve la fila con id numérico', async () => {
  const alta = construirAltaCliente({ rnc: '1-31-25643-2', nombre: 'Constructora Cibao', telefono: '(809) 555-0100' })
  ya(ok({ id: '15', client_name: 'Constructora Cibao', company_name: 'Constructora Cibao', rnc: '131256432', phone_number: '8095550100', descuento: '0.00', permitir_credito: '1' }))
  const r = await crearCliente(alta)
  assert.deepEqual(peticiones.map(tal), ['POST /api/clients'])
  assert.deepEqual(peticiones[0].cuerpo, { client_name: 'Constructora Cibao', company_name: 'Constructora Cibao', rnc: '131256432', phone_number: '8095550100' })
  assert.equal(r.kind, 'creado')
  assert.equal(r.kind === 'creado' && r.fila.id, 15)
})

test('si la respuesta del alta se pierde se busca el cliente y NO se repite el POST', async () => {
  const alta = construirAltaCliente({ rnc: '131256432', nombre: 'Constructora Cibao' })
  const guardada = { id: '15', client_name: 'Constructora Cibao', company_name: 'Constructora Cibao', rnc: '131256432', phone_number: '', email: '' }
  ya('sin-red', lista([{ ...guardada, id: '3', rnc: null }, guardada]))
  const r = await crearCliente(alta)
  assert.deepEqual(peticiones.map(tal), ['POST /api/clients', 'GET /api/clients?page=1&pageSize=25&query=Constructora+Cibao'])
  assert.equal(r.kind === 'creado' && r.fila.id, 15) // lo encontró: el alta sí se hizo
})

test('si la respuesta se perdió y el cliente no está, es un fallo y se puede reintentar sin duplicar', async () => {
  ya('sin-red', lista([]))
  const r = await crearCliente(construirAltaCliente({ rnc: '', nombre: 'Juan' }))
  assert.equal(r.kind, 'fallo')
  assert.equal(peticiones.filter((p) => p.metodo === 'POST').length, 1)
})

test('un rechazo por «el mismo cliente» (correo, contacto y teléfono) ofrece el que ya existe, con el texto del servidor', async () => {
  const alta = construirAltaCliente({ rnc: '', nombre: 'Maria Lopez', telefono: '809-555-0100', correo: 'a@b.com' })
  const existente = { id: '5', client_name: 'Maria Lopez', company_name: 'Otra', email: 'a@b.com', phone_number: '8095550100' }
  ya({ status: 200, cuerpo: { status: false, error: 'Ya tienes un cliente con el mismo nombre de contacto, correo y teléfono. Búscalo en la lista en vez de crearlo otra vez.' } }, lista([existente]))
  const r = await crearCliente(alta)
  assert.equal(r.kind, 'rechazado')
  assert.equal(r.kind === 'rechazado' && r.mensaje.startsWith('Ya tienes un cliente'), true)
  assert.equal(r.kind === 'rechazado' && r.existente?.id, 5)
  assert.equal(peticiones.length, 2)
})

test('un rechazo sin correo ni teléfono no busca a nadie', async () => {
  ya({ status: 422, cuerpo: { status: false, error: 'Escribe el nombre de la empresa o razón social.' } })
  const r = await crearCliente(construirAltaCliente({ rnc: '', nombre: 'Juan' }))
  assert.equal(r.kind, 'rechazado')
  assert.equal(r.kind === 'rechazado' && r.existente, null)
  assert.equal(peticiones.length, 1)
})

test('clientesPorRnc busca con los dígitos y con guiones (los clientes viejos), sin repetir ni traer otro RNC', async () => {
  const nuevo = { id: '8', client_name: 'A', company_name: 'A', rnc: '131256432' }
  const viejo = { id: '4', client_name: 'B', company_name: 'B', rnc: '1-31-25643-2' }
  const otro = { id: '9', client_name: 'C', company_name: 'C', rnc: '401123456', phone_number: '131256432' }
  ya(lista([nuevo, otro]), lista([viejo, nuevo]))
  const filas = await clientesPorRnc('131256432')
  assert.deepEqual(peticiones.map((p) => p.params.get('query')).sort(), ['1-31-25643-2', '131256432'])
  assert.deepEqual(filas.map((f: ClientRow) => f.id).sort(), [4, 8])
})

test('clientesPorRnc no falla si una de las dos búsquedas falla', async () => {
  ya({ status: 500, cuerpo: { status: false, error: 'x' } }, lista([{ id: '4', client_name: 'B', company_name: 'B', rnc: '1-31-25643-2' }]))
  const filas = await clientesPorRnc('131256432')
  assert.deepEqual(filas.map((f: ClientRow) => f.id), [4])
})

// --- Productos ------------------------------------------------------------------------------------------------------------------------

const FRESCO = {
  id: 7,
  sku: 'CEM-42',
  nombre: 'Cemento gris 42 kg',
  descripcion: 'Saco',
  category_id: 3,
  warehouse_id: 2,
  indicador_bien_servicio: 1,
  indicador_facturacion: 2,
  precio: '640.0000',
  precio_2: '600.0000',
  precio_3: null,
  precio_4: null,
  costo: '410.5000',
  unidad_medida: '43',
  stock: 12.5,
  stock_minimo: 2,
  activo: 1,
  imagen_path: 'p/7.jpg',
  categoria_nombre: 'Obra',
  almacen_nombre: 'Almacén Principal',
}

test('la lista de productos siempre lleva page y pageSize', async () => {
  await buscarProductos({ page: 1, pageSize: 20, query: 'cem' })
  await buscarProductos({ page: 3, pageSize: 20 })
  assert.deepEqual(peticiones.map(tal), ['GET /api/products?page=1&pageSize=20&query=cem', 'GET /api/products?page=3&pageSize=20'])
  ya(ok(FRESCO))
  await leerProducto(7)
  assert.equal(tal(peticiones[2]), 'GET /api/products?id=7')
})

test('editar un producto LEE la fila fresca y manda el PUT con las 16 columnas y el cambio encima', async () => {
  ya(ok(FRESCO), ok('Product updated'))
  await guardarCambios(7, { precio: 700 })
  assert.deepEqual(peticiones.map(tal), ['GET /api/products?id=7', 'PUT /api/products'])
  assert.deepEqual(peticiones[1].cuerpo, {
    id: 7,
    sku: 'CEM-42',
    nombre: 'Cemento gris 42 kg',
    descripcion: 'Saco',
    category_id: 3,
    warehouse_id: 2,
    indicador_bien_servicio: 1,
    indicador_facturacion: 2,
    precio: 700,
    precio_2: 600,
    precio_3: null,
    precio_4: null,
    costo: 410.5,
    unidad_medida: '43',
    stock: 12.5,
    stock_minimo: 2,
    activo: 1,
  })
})

test('si no se puede leer el producto no se escribe nada', async () => {
  ya({ status: 404, cuerpo: { status: false, error: 'Este producto no existe.' } })
  await assert.rejects(guardarCambios(7, { precio: 700 }))
  assert.deepEqual(peticiones.map(tal), ['GET /api/products?id=7'])
})

test('el alta de un producto manda seis claves; el servidor pone almacén y existencia', async () => {
  ya(ok({ id: 9, message: 'Product saved' }))
  const r = await crearProducto(payloadCrear({ ...formNuevoProducto('Asesoria tecnica'), precio: '5000', indicador: 1, tipo: 2 }))
  assert.deepEqual(peticiones.map(tal), ['POST /api/products'])
  assert.deepEqual(peticiones[0].cuerpo, { nombre: 'Asesoria tecnica', precio: 5000, indicador_facturacion: 1, indicador_bien_servicio: 2, unidad_medida: '43', activo: 1 })
  assert.equal(r.kind, 'creado')
})

test('si la respuesta del alta de un producto se pierde se busca y NO se repite el POST', async () => {
  const payload = payloadCrear({ ...formNuevoProducto('Asesoria tecnica'), precio: '5000', indicador: 1, tipo: 2 })
  ya('sin-red', lista([{ id: '9', nombre: 'Asesoria tecnica', precio: '5000.0000', indicador_facturacion: '1', indicador_bien_servicio: '2', unidad_medida: '43' }]))
  const r = await crearProducto(payload)
  assert.deepEqual(peticiones.map(tal), ['POST /api/products', 'GET /api/products?page=1&pageSize=25&query=Asesoria+tecnica'])
  assert.equal(r.kind, 'creado')
  ya('sin-red', lista([]))
  const otra = await crearProducto(payload)
  assert.equal(otra.kind, 'fallo')
  assert.equal(peticiones.filter((p) => p.metodo === 'POST').length, 2) // uno por intento del usuario, ninguno por su cuenta
})

test('un rechazo del servidor sale con su texto, y el de una cuenta sin almacén es de soporte', async () => {
  ya({ status: 422, cuerpo: { status: false, error: 'El precio no puede ser negativo.' } })
  const a = await crearProducto(payloadCrear({ ...formNuevoProducto('x'), precio: '-1' }))
  assert.deepEqual(a, { kind: 'fallo', mensaje: 'El precio no puede ser negativo.' })
  ya({ status: 200, cuerpo: { status: false, error: 'Elige el almacén del producto. Si no tienes ninguno, créalo primero en Almacenes.' } })
  const b = await crearProducto(payloadCrear(formNuevoProducto('x')))
  assert.deepEqual(b, { kind: 'fallo', mensaje: 'Tu cuenta no está lista para guardar productos. Contacta a soporte' })
  assert.equal(peticiones.length, 2) // un rechazo es definitivo: no se busca
})

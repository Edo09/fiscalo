// entitlements: qué puede hacer esta cuenta en Express. `leerEntitlements` falla cerrado ante un bloque ausente o mal formado y `guardia` es la única
// política de rutas (anexo 5.4). Son funciones puras: nada de esto toca el DOM.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PERSONAS } from '../dev/mock-api.mjs'
import { esAdmin, esMultiTipo, guardia, leerEntitlements, tieneModulo, tiposFiltro, tiposVenta } from '~/entitlements'
import type { Entitlements, UsuarioExpress } from '~/entitlements'
import { parseHash } from '~/router'
import type { Ruta } from '~/router'

const MODULOS = ['facturacion', 'clientes', 'productos', 'usuarios', 'configuracion']
const TENANT = { id: 12, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' }
const BASE = { id: 1, email: 'a@express.test', username: 'a', name: 'A', role: 'admin' }

/** El bloque `user.entitlements` de 4.3(a) como llega por la red; `cambios` pisa claves de primer nivel (con `undefined` la clave queda sin valor). */
const bloque = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  edicion: 'express',
  tenant: { ...TENANT },
  modulos: [...MODULOS],
  tipos_ecf: ['45', '34'],
  capacidades: { idempotencia: true, reconciliador: false, certificado: true },
  ...cambios,
})
const conTenant = (cambios: Record<string, unknown>): Record<string, unknown> => bloque({ tenant: { ...TENANT, ...cambios } })
const usuario = (entitlements: unknown): UsuarioExpress => ({ ...BASE, entitlements })

/** Los entitlements de un bloque que se tiene que leer bien: si no, la prueba falla aquí. */
function ent(cambios?: Record<string, unknown>): Entitlements {
  const e = leerEntitlements(usuario(bloque(cambios)))
  assert.ok(e, 'el bloque debía leerse')
  return e
}

const OK = { kind: 'ok' }
const A_INICIO = { kind: 'redirigir', hash: '#/facturas' }
const g = (r: Ruta, e: Entitlements | null, admin = true) => guardia(r, { entitlements: e, admin })

/** Las 16 rutas, una de cada id. */
const RUTAS: Ruta[] = [
  { id: 'facturas' },
  { id: 'factura', facturaId: 1 },
  { id: 'anular', facturaId: 1 },
  { id: 'facturar' },
  { id: 'facturar-productos' },
  { id: 'facturar-revisar' },
  { id: 'facturar-resultado', clave: 'k' },
  { id: 'clientes' },
  { id: 'cliente-nuevo' },
  { id: 'cliente', clienteId: 1 },
  { id: 'productos' },
  { id: 'producto', productoId: 1 },
  { id: 'mas' },
  { id: 'mas-empresa' },
  { id: 'mas-numeracion' },
  { id: 'mas-usuarios' },
]
const DEL_ASISTENTE = ['facturar', 'facturar-productos', 'facturar-revisar', 'facturar-resultado']

// --- leerEntitlements ---------------------------------------------------------------------------------------------------------------

test('leerEntitlements lee el bloque de 4.3(a) y entrega copias', () => {
  const crudo = bloque()
  const e = leerEntitlements(usuario(crudo))
  assert.ok(e)
  assert.deepEqual(e, {
    edicion: 'express',
    tenant: { id: 12, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' },
    modulos: MODULOS,
    tipos_ecf: ['45', '34'],
    capacidades: { idempotencia: true, reconciliador: false, certificado: true },
  })
  // Las listas son copias: cambiar lo leído no toca el bloque de la sesión.
  e.modulos.pop()
  e.tipos_ecf.pop()
  assert.equal((crudo.modulos as string[]).length, 5)
  assert.equal((crudo.tipos_ecf as string[]).length, 2)
})

test('leerEntitlements falla cerrado: sin usuario, sin bloque, otra edición o un bloque que no es el de 4.3(a)', () => {
  const sinBloque: UsuarioExpress = { ...BASE }
  const NULOS: [string, UsuarioExpress | null | undefined][] = [
    ['usuario null', null],
    ['usuario undefined', undefined],
    ['sin bloque', sinBloque],
    ['bloque null', usuario(null)],
    ['bloque de texto', usuario('express')],
    ['bloque que es una lista', usuario([bloque()])],
    ['bloque que es un número', usuario(7)],
    ['edicion completa', usuario(bloque({ edicion: 'completa' }))],
    ['edicion con otra capitalización', usuario(bloque({ edicion: 'Express' }))],
    ['edicion con un espacio', usuario(bloque({ edicion: ' express' }))],
    ['edicion sin valor', usuario(bloque({ edicion: undefined }))],
    ['modulos sin valor', usuario(bloque({ modulos: undefined }))],
    ['modulos null', usuario(bloque({ modulos: null }))],
    ['modulos es texto', usuario(bloque({ modulos: 'facturacion' }))],
    ['modulos es un objeto', usuario(bloque({ modulos: { 0: 'facturacion' } }))],
    ['tenant sin valor', usuario(bloque({ tenant: undefined }))],
    ['tenant null', usuario(bloque({ tenant: null }))],
    ['tenant es texto', usuario(bloque({ tenant: 'Constructora X' }))],
    ['tenant es una lista', usuario(bloque({ tenant: [] }))],
  ]
  for (const [descripcion, u] of NULOS) assert.equal(leerEntitlements(u), null, descripcion)
})

test('leerEntitlements: el id del tenant y el ambiente son obligatorios y exactos (el id arma las claves de lo guardado en el teléfono)', () => {
  for (const id of [0, -1, 1.5, NaN, Infinity, '12', null, undefined, true]) assert.equal(leerEntitlements(usuario(conTenant({ id }))), null, `id ${String(id)}`)
  for (const ambiente of ['prod', 'ECF', ' ecf', '', null, undefined, 1]) assert.equal(leerEntitlements(usuario(conTenant({ ambiente }))), null, `ambiente ${String(ambiente)}`)
  for (const ambiente of ['ecf', 'certecf', 'testecf']) assert.equal(leerEntitlements(usuario(conTenant({ ambiente })))?.tenant.ambiente, ambiente)
})

test('leerEntitlements: un nombre o un RNC que no son texto quedan vacíos y no tumban el bloque (solo se muestran)', () => {
  const e = leerEntitlements(usuario(conTenant({ nombre: 7, rnc: null })))
  assert.ok(e)
  assert.deepEqual(e.tenant, { id: 12, nombre: '', rnc: '', ambiente: 'ecf' })
  assert.equal(leerEntitlements(usuario(conTenant({ rnc: undefined })))?.tenant.rnc, '')
})

test('leerEntitlements descarta lo desconocido y cuida el orden y que nada se repita', () => {
  const e = ent({ modulos: ['facturacion', 'reportes', 7, null, 'clientes', 'clientes', 'Productos'], tipos_ecf: ['34', '45', '99', 45, null, '45', '41'] })
  assert.deepEqual(e.modulos, ['facturacion', 'clientes'])
  assert.deepEqual(e.tipos_ecf, ['34', '45'])
  // Todo desconocido deja la lista vacía: no es un bloque inválido, es una cuenta sin módulos o sin tipos.
  assert.deepEqual(ent({ modulos: ['x'] }).modulos, [])
  assert.deepEqual(ent({ tipos_ecf: ['x'] }).tipos_ecf, [])
})

test('leerEntitlements: un tipos_ecf ausente o que no es una lista no deja emitir nada, pero el resto del bloque se lee', () => {
  for (const tipos of [undefined, null, '45', { 0: '45' }]) {
    const e = ent({ tipos_ecf: tipos })
    assert.deepEqual(e.tipos_ecf, [])
    assert.deepEqual(tiposVenta(e), [])
    assert.equal(tieneModulo(e, 'facturacion'), true)
  }
})

test('leerEntitlements: capacidades ausente es todo falso, y solo un true verdadero cuenta', () => {
  const TODO_FALSO = { idempotencia: false, reconciliador: false, certificado: false }
  for (const capacidades of [undefined, null, 'si', [], {}]) assert.deepEqual(ent({ capacidades }).capacidades, TODO_FALSO)
  assert.deepEqual(ent({ capacidades: { certificado: true } }).capacidades, { idempotencia: false, reconciliador: false, certificado: true })
  assert.deepEqual(ent({ capacidades: { idempotencia: 'true', reconciliador: 1, certificado: true } }).capacidades, {
    idempotencia: false,
    reconciliador: false,
    certificado: true,
  })
})

// --- los accesores ------------------------------------------------------------------------------------------------------------------

test('tieneModulo', () => {
  const e = ent({ modulos: ['facturacion', 'clientes'] })
  assert.equal(tieneModulo(e, 'clientes'), true)
  assert.equal(tieneModulo(e, 'productos'), false)
  assert.equal(tieneModulo(null, 'facturacion'), false)
})

test('tiposVenta deja solo los de venta (31, 32 y 45), en el orden del bloque', () => {
  assert.deepEqual(tiposVenta(ent({ tipos_ecf: ['45', '34'] })), ['45'])
  assert.deepEqual(tiposVenta(ent({ tipos_ecf: ['31', '32', '45', '34', '33'] })), ['31', '32', '45'])
  assert.deepEqual(tiposVenta(ent({ tipos_ecf: ['45', '31', '34'] })), ['45', '31'])
  assert.deepEqual(tiposVenta(ent({ tipos_ecf: ['34'] })), [])
  assert.deepEqual(tiposVenta(null), [])
})

test('esMultiTipo: dos o más tipos de venta; la nota de crédito que se deriva no cuenta', () => {
  assert.equal(esMultiTipo(ent({ tipos_ecf: ['45', '34'] })), false)
  assert.equal(esMultiTipo(ent({ tipos_ecf: ['34'] })), false)
  assert.equal(esMultiTipo(ent({ tipos_ecf: ['31', '45', '34'] })), true)
  assert.equal(esMultiTipo(ent({ tipos_ecf: ['31', '32', '45', '34'] })), true)
  assert.equal(esMultiTipo(null), false)
})

test('tiposFiltro: tipos_ecf en su orden y como copia', () => {
  const e = ent({ tipos_ecf: ['31', '32', '45', '34'] })
  assert.deepEqual(tiposFiltro(e), ['31', '32', '45', '34'])
  tiposFiltro(e).pop()
  assert.deepEqual(e.tipos_ecf, ['31', '32', '45', '34'])
  assert.deepEqual(tiposFiltro(null), [])
})

test('esAdmin: solo el rol llamado admin, escrito igual', () => {
  assert.equal(esAdmin({ role: 'admin' }), true)
  for (const role of ['Admin', 'ADMIN', ' admin', 'user', '']) assert.equal(esAdmin({ role }), false, role)
  assert.equal(esAdmin({}), false)
  assert.equal(esAdmin(null), false)
  assert.equal(esAdmin(undefined), false)
})

// --- guardia ------------------------------------------------------------------------------------------------------------------------

test('guardia: sin entitlements es la pantalla de edición, en cualquier ruta (también Más)', () => {
  for (const r of RUTAS) assert.deepEqual(g(r, null), { kind: 'edicion' }, r.id)
  assert.deepEqual(g({ id: 'mas' }, null, false), { kind: 'edicion' })
})

test('guardia: una cuenta con todos los módulos y un tipo de venta pasa por las 16 rutas', () => {
  const e = ent()
  for (const r of RUTAS) assert.deepEqual(g(r, e), OK, r.id)
})

test('guardia: la ruta de un módulo que la cuenta no tiene redirige al inicio', () => {
  const soloFacturar = ent({ modulos: ['facturacion'] })
  const DE_OTROS_MODULOS: Ruta[] = [
    { id: 'clientes' },
    { id: 'cliente-nuevo' },
    { id: 'cliente', clienteId: 1 },
    { id: 'productos' },
    { id: 'producto', productoId: 1 },
    { id: 'mas-empresa' },
    { id: 'mas-numeracion' },
    { id: 'mas-usuarios' },
  ]
  for (const r of DE_OTROS_MODULOS) assert.deepEqual(g(r, soloFacturar), A_INICIO, r.id)
  // Con el módulo de Clientes sí pasa, y Productos sigue negado.
  const conClientes = ent({ modulos: ['facturacion', 'clientes'] })
  assert.deepEqual(g({ id: 'clientes' }, conClientes), OK)
  assert.deepEqual(g({ id: 'productos' }, conClientes), A_INICIO)
})

test('guardia: Usuarios pide ser administrador y tener el módulo', () => {
  const conUsuarios = ent()
  assert.deepEqual(g({ id: 'mas-usuarios' }, conUsuarios, false), A_INICIO)
  assert.deepEqual(g({ id: 'mas-usuarios' }, ent({ modulos: ['facturacion', 'configuracion'] }), true), A_INICIO)
  assert.deepEqual(g({ id: 'mas-usuarios' }, conUsuarios, true), OK)
})

test('guardia: Más siempre pasa; Mi empresa y Numeración piden configuración y no piden ser administrador', () => {
  assert.deepEqual(g({ id: 'mas' }, ent({ modulos: [] }), false), OK)
  const conConfiguracion = ent({ modulos: ['facturacion', 'configuracion'] })
  assert.deepEqual(g({ id: 'mas-empresa' }, conConfiguracion, false), OK)
  assert.deepEqual(g({ id: 'mas-numeracion' }, conConfiguracion, false), OK) // el facturador la ve de solo lectura
  assert.deepEqual(g({ id: 'mas-empresa' }, ent({ modulos: ['facturacion'] })), A_INICIO)
  assert.deepEqual(g({ id: 'mas-numeracion' }, ent({ modulos: ['facturacion'] })), A_INICIO)
})

test('guardia: con un solo tipo de venta no hay filtro por tipo, y se conserva el resto de la búsqueda', () => {
  const soloE45 = ent({ tipos_ecf: ['45', '34'] })
  assert.deepEqual(g({ id: 'facturas', tipo: '31' }, soloE45), A_INICIO)
  // Ni siquiera el tipo propio vale: no hay selector ni filtro en ninguna parte.
  for (const tipo of ['45', '34', '31', '99']) assert.deepEqual(g({ id: 'facturas', tipo }, soloE45), A_INICIO, tipo)
  assert.deepEqual(g({ id: 'facturas', q: 'abc', estado: 'accion', tipo: '31' }, soloE45), { kind: 'redirigir', hash: '#/facturas?q=abc&estado=accion' })
  assert.deepEqual(g({ id: 'facturas', q: 'abc', estado: 'accion' }, soloE45), OK)
  assert.deepEqual(g({ id: 'facturas' }, soloE45), OK)
})

test('guardia: con varios tipos de venta un tipo que no es de la cuenta se cambia por el primero', () => {
  const multi = ent({ tipos_ecf: ['31', '32', '45', '34'] })
  assert.deepEqual(g({ id: 'facturas', tipo: '33' }, multi), { kind: 'redirigir', hash: '#/facturas?tipo=31' })
  for (const tipo of ['31', '32', '45', '34']) assert.deepEqual(g({ id: 'facturas', tipo }, multi), OK, tipo)
  assert.deepEqual(g({ id: 'facturas', q: 'x', estado: 'pendiente', tipo: '33' }, multi), { kind: 'redirigir', hash: '#/facturas?q=x&estado=pendiente&tipo=31' })
  // El primero permitido es el primero del bloque, no el menor.
  assert.deepEqual(g({ id: 'facturas', tipo: '33' }, ent({ tipos_ecf: ['45', '31', '34'] })), { kind: 'redirigir', hash: '#/facturas?tipo=45' })
})

test('guardia: el asistente no se abre sin un tipo de venta', () => {
  for (const tipos of [['34'], []]) {
    const sinVenta = ent({ tipos_ecf: tipos })
    for (const id of DEL_ASISTENTE) {
      const r = RUTAS.find((x) => x.id === id)
      assert.ok(r)
      assert.deepEqual(g(r, sinVenta), A_INICIO, `${id} con tipos ${tipos.join(',') || 'ninguno'}`)
    }
    // Lo demás de facturación sigue abierto: ver facturas y anular una no es abrir el asistente.
    for (const r of [{ id: 'facturas' }, { id: 'factura', facturaId: 1 }, { id: 'anular', facturaId: 1 }] as Ruta[]) assert.deepEqual(g(r, sinVenta), OK, r.id)
  }
})

test('guardia: sin el módulo de facturación, Facturas no se redirige a sí misma: es la pantalla de edición', () => {
  const sinFacturacion = ent({ modulos: ['clientes'] })
  assert.deepEqual(g({ id: 'facturas' }, sinFacturacion), { kind: 'edicion' })
  assert.deepEqual(g({ id: 'clientes' }, sinFacturacion), OK)
  assert.deepEqual(g({ id: 'factura', facturaId: 1 }, sinFacturacion), A_INICIO)
  assert.deepEqual(g({ id: 'facturar' }, sinFacturacion), A_INICIO)
  // El orden es edición, módulo o administrador y tipo: el módulo se mira antes que el filtro por tipo.
  assert.deepEqual(g({ id: 'facturas', tipo: '31' }, sinFacturacion), { kind: 'edicion' })
})

test('guardia: seguir las redirecciones siempre termina (no hay bucles), en una pantalla permitida o en la de edición', () => {
  const VARIANTES = [
    ent(),
    ent({ modulos: [] }),
    ent({ modulos: ['facturacion'] }),
    ent({ modulos: ['clientes', 'productos'] }),
    ent({ tipos_ecf: [] }),
    ent({ tipos_ecf: ['34'] }),
    ent({ tipos_ecf: ['31', '32', '45', '34'] }),
    ent({ tipos_ecf: ['45', '31', '34'], modulos: ['facturacion', 'usuarios'] }),
    null,
  ]
  const CON_TIPOS: Ruta[] = [...RUTAS, { id: 'facturas', tipo: '31' }, { id: 'facturas', tipo: '33' }, { id: 'facturas', tipo: '99', q: 'x', estado: 'accion' }]
  for (const e of VARIANTES) {
    for (const admin of [true, false]) {
      for (const inicial of CON_TIPOS) {
        let ruta = inicial
        for (let paso = 0; ; paso++) {
          assert.ok(paso <= 3, `bucle en ${JSON.stringify(inicial)} (admin ${admin})`)
          const v = g(ruta, e, admin)
          if (v.kind !== 'redirigir') break
          ruta = parseHash(v.hash)
        }
      }
    }
  }
})

test('guardia no cambia la ruta que recibe', () => {
  const r: Ruta = Object.freeze({ id: 'facturas' as const, q: 'a', tipo: '33' })
  assert.doesNotThrow(() => g(r, ent({ tipos_ecf: ['45', '34'] })))
  assert.doesNotThrow(() => g(r, ent({ tipos_ecf: ['31', '45', '34'] })))
  assert.deepEqual(r, { id: 'facturas', q: 'a', tipo: '33' })
})

// --- con las personas del mock ------------------------------------------------------------------------------------------------------

test('los bloques que sirve el mock se leen enteros (4.3(a) tal como llega por la red)', () => {
  for (const [nombre, p] of Object.entries(PERSONAS)) {
    const e = leerEntitlements({ ...BASE, username: nombre, role: p.rol, entitlements: p.entitlements ?? undefined })
    if (p.entitlements === null) {
      assert.equal(e, null, `${nombre}: sin bloque no hay Express`)
      continue
    }
    const crudo = p.entitlements as any
    assert.ok(e, nombre)
    assert.deepEqual(e.tenant, crudo.tenant, nombre)
    assert.deepEqual(e.modulos, crudo.modulos, nombre)
    assert.deepEqual(e.tipos_ecf, crudo.tipos_ecf, nombre)
    assert.deepEqual(e.capacidades, crudo.capacidades, nombre)
  }
  assert.equal(Object.values(PERSONAS).filter((p) => p.entitlements === null).length, 2) // admin.completa y admin.sinbloque
})

test('las personas del mock: tipos de venta, módulos y quién es administrador', () => {
  const de = (nombre: string) => {
    const p = PERSONAS[nombre]
    return { e: leerEntitlements({ ...BASE, role: p.rol, entitlements: p.entitlements }), admin: esAdmin({ role: p.rol }) }
  }
  assert.deepEqual(tiposVenta(de('admin.e45').e), ['45'])
  assert.equal(esMultiTipo(de('admin.e45').e), false)
  assert.deepEqual(tiposVenta(de('admin.multi').e), ['31', '32', '45'])
  assert.equal(esMultiTipo(de('admin.multi').e), true)
  assert.deepEqual(tiposVenta(de('admin.e32').e), ['32'])
  assert.equal(tieneModulo(de('admin.e32').e, 'clientes'), false)
  assert.equal(tieneModulo(de('admin.sinproductos').e, 'productos'), false)

  // user.e45 es de la misma empresa que admin.e45 y no es administrador: tiene el módulo de Usuarios y aun así la guardia lo manda al inicio.
  const facturador = de('user.e45')
  assert.equal(facturador.admin, false)
  assert.equal(facturador.e?.tenant.id, de('admin.e45').e?.tenant.id)
  assert.deepEqual(g({ id: 'mas-usuarios' }, facturador.e, facturador.admin), A_INICIO)
  assert.deepEqual(g({ id: 'mas-usuarios' }, de('admin.e45').e, true), OK)

  // admin.e32 no tiene Clientes: la ruta se niega, y el E32 no necesita comprador para emitir.
  assert.deepEqual(g({ id: 'clientes' }, de('admin.e32').e), A_INICIO)
  assert.deepEqual(g({ id: 'facturar' }, de('admin.e32').e), OK)
})

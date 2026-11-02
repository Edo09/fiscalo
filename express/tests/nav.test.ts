// nav: la barra inferior y las filas de Más (anexo 5.1 y 5.2). Es presentación: que una pestaña o una fila no salga nunca es un control de seguridad
// (la guardia de rutas y el API niegan lo mismo), y aquí se comprueba que la barra, las filas y la guardia están de acuerdo.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PERSONAS } from '../dev/mock-api.mjs'
import { guardia, leerEntitlements } from '~/entitlements'
import type { Entitlements } from '~/entitlements'
import { construirBarra, etiquetaRol, filasMas, mitadesBarra, PANTALLAS_LISTAS } from '~/nav'
import { formatHash, parseHash } from '~/router'
import type { Ruta } from '~/router'

const TODOS = ['facturacion', 'clientes', 'productos', 'usuarios', 'configuracion']
const sin = (...quitar: string[]): string[] => TODOS.filter((m) => !quitar.includes(m))
const ADMIN = { admin: true, soporte: false }
const LISTAS = { empresa: true, numeracion: true, usuarios: true }

/** Los entitlements de una cuenta Express con esos módulos, leídos como los lee la app. */
function ent(modulos: string[], tipos: string[] = ['45', '34']): Entitlements {
  const e = leerEntitlements({
    id: 1,
    email: 'a@express.test',
    username: 'a',
    name: 'A',
    role: 'admin',
    entitlements: {
      edicion: 'express',
      tenant: { id: 12, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' },
      modulos,
      tipos_ecf: tipos,
      capacidades: { idempotencia: true, reconciliador: false, certificado: true },
    },
  })
  assert.ok(e, 'el bloque debía leerse')
  return e
}

const ids = (filas: { id: string }[]): string[] => filas.map((f) => f.id)

/** [variante, módulos, ids de la barra, ids de la mitad izquierda, ids de la mitad derecha]. */
const VARIANTES: [string, string[], string[], string[], string[]][] = [
  ['con todos los módulos', TODOS, ['facturas', 'clientes', 'facturar', 'productos', 'mas'], ['facturas', 'clientes'], ['productos', 'mas']],
  ['sin Productos', sin('productos'), ['facturas', 'clientes', 'facturar', 'mas'], ['facturas', 'clientes'], ['mas']],
  ['sin Clientes', sin('clientes'), ['facturas', 'facturar', 'productos', 'mas'], ['facturas'], ['productos', 'mas']],
  ['sin Clientes ni Productos', sin('clientes', 'productos'), ['facturas', 'facturar', 'mas'], ['facturas'], ['mas']],
]

// --- construirBarra y mitadesBarra --------------------------------------------------------------------------------------------------

test('construirBarra: los ids y el botón central (solo Facturar) de cada variante', () => {
  for (const [descripcion, modulos, esperados] of VARIANTES) {
    const barra = construirBarra(ent(modulos))
    assert.deepEqual(ids(barra), esperados, descripcion)
    assert.deepEqual(ids(barra.filter((s) => s.central)), ['facturar'], descripcion)
  }
})

test('construirBarra: etiqueta, hash e icono de cada pestaña (anexo 5.1)', () => {
  assert.deepEqual(construirBarra(ent(TODOS)), [
    { id: 'facturas', etiqueta: 'Facturas', hash: '#/facturas', icono: 'file-text', central: false },
    { id: 'clientes', etiqueta: 'Clientes', hash: '#/clientes', icono: 'users', central: false },
    { id: 'facturar', etiqueta: 'Facturar', hash: '#/facturar', icono: 'plus', central: true },
    { id: 'productos', etiqueta: 'Productos', hash: '#/productos', icono: 'package', central: false },
    { id: 'mas', etiqueta: 'Más', hash: '#/mas', icono: 'ellipsis', central: false },
  ])
})

test('construirBarra: el hash de cada pestaña abre su propia ruta', () => {
  for (const [descripcion, modulos] of VARIANTES) {
    for (const slot of construirBarra(ent(modulos))) assert.deepEqual(parseHash(slot.hash), { id: slot.id }, `${descripcion}: ${slot.id}`)
  }
})

test('construirBarra solo mira Clientes y Productos: los otros módulos y los tipos no la cambian', () => {
  assert.deepEqual(ids(construirBarra(ent(['facturacion']))), ['facturas', 'facturar', 'mas'])
  assert.deepEqual(ids(construirBarra(ent(sin('usuarios', 'configuracion')))), ['facturas', 'clientes', 'facturar', 'productos', 'mas'])
  assert.deepEqual(ids(construirBarra(ent(TODOS, ['31', '32', '45', '34']))), ['facturas', 'clientes', 'facturar', 'productos', 'mas'])
})

test('construirBarra falla cerrado: sin entitlements no hay pestañas', () => {
  assert.deepEqual(construirBarra(null), [])
})

test('mitadesBarra pone Facturar entre las dos mitades en cada variante', () => {
  for (const [descripcion, modulos, , izquierda, derecha] of VARIANTES) {
    const barra = construirBarra(ent(modulos))
    const { izq, der } = mitadesBarra(barra)
    assert.deepEqual(ids(izq), izquierda, descripcion)
    assert.deepEqual(ids(der), derecha, descripcion)
    // Facturar no está en ninguna mitad: la barra lo dibuja en medio, y juntas las tres partes son la barra completa.
    assert.deepEqual([...izq, ...barra.filter((s) => s.central), ...der], barra, descripcion)
  }
})

test('mitadesBarra: una barra vacía da dos mitades vacías y, sin botón central, todo queda a la izquierda', () => {
  assert.deepEqual(mitadesBarra([]), { izq: [], der: [] })
  const sinCentro = construirBarra(ent(TODOS)).filter((s) => !s.central)
  const mitades = mitadesBarra(sinCentro)
  assert.deepEqual(mitades.izq, sinCentro)
  assert.deepEqual(mitades.der, [])
  assert.notEqual(mitades.izq, sinCentro) // una copia: la barra no queda atada a lo que haga quien la reciba
})

test('las personas del mock arman la barra del recorrido manual', () => {
  const barraDe = (nombre: string): string[] => {
    const p = PERSONAS[nombre]
    const e = leerEntitlements({ id: 1, email: 'a@express.test', username: nombre, name: nombre, role: p.rol, entitlements: p.entitlements })
    return ids(construirBarra(e))
  }
  assert.deepEqual(barraDe('admin.e45'), ['facturas', 'clientes', 'facturar', 'productos', 'mas'])
  assert.deepEqual(barraDe('admin.sinproductos'), ['facturas', 'clientes', 'facturar', 'mas'])
  assert.deepEqual(barraDe('admin.e32'), ['facturas', 'facturar', 'productos', 'mas']) // esta empresa no tiene Clientes
  assert.deepEqual(barraDe('admin.sinbloque'), []) // sin bloque no hay Express: la app muestra la pantalla de edición
})

// --- filasMas -----------------------------------------------------------------------------------------------------------------------

test('filasMas tal como se entrega: Mi empresa y Numeración (con el módulo de configuración), Ayuda si hay soporte, Tema y Cerrar sesión; Usuarios todavía no', () => {
  assert.deepEqual(PANTALLAS_LISTAS, { empresa: true, numeracion: true, usuarios: false })
  const e = ent(TODOS)
  assert.deepEqual(ids(filasMas(e, { admin: true, soporte: true })), ['empresa', 'numeracion', 'ayuda', 'tema', 'salir'])
  assert.deepEqual(ids(filasMas(e, { admin: true, soporte: false })), ['empresa', 'numeracion', 'tema', 'salir'])
  assert.deepEqual(ids(filasMas(e, { admin: false, soporte: false })), ['empresa', 'numeracion', 'tema', 'salir'])
})

test('filasMas con todas las pantallas listas: Mi empresa, Numeración, Usuarios, Ayuda, Tema y Cerrar sesión, en ese orden', () => {
  assert.deepEqual(filasMas(ent(TODOS), { admin: true, soporte: true }, LISTAS), [
    { id: 'empresa', etiqueta: 'Mi empresa', hash: '#/mas/empresa', icono: 'building-2' },
    { id: 'numeracion', etiqueta: 'Numeración e-CF', hash: '#/mas/numeracion', icono: 'hash' },
    { id: 'usuarios', etiqueta: 'Usuarios', hash: '#/mas/usuarios', icono: 'users' },
    { id: 'ayuda', etiqueta: 'Ayuda y soporte', icono: 'circle-help' },
    { id: 'tema', etiqueta: 'Tema', icono: '' },
    { id: 'salir', etiqueta: 'Cerrar sesión', icono: 'log-out', peligro: true },
  ])
})

test('filasMas: Usuarios pide un administrador con el módulo; Mi empresa y Numeración piden configuración y se ven sin ser administrador', () => {
  const filas = (e: Entitlements | null, ctx: { admin: boolean; soporte: boolean }): string[] => ids(filasMas(e, ctx, LISTAS))
  assert.deepEqual(filas(ent(TODOS), ADMIN), ['empresa', 'numeracion', 'usuarios', 'tema', 'salir'])
  // Un facturador de una empresa con todos los módulos ve la configuración (la numeración, de solo lectura) pero no Usuarios.
  assert.deepEqual(filas(ent(TODOS), { admin: false, soporte: false }), ['empresa', 'numeracion', 'tema', 'salir'])
  // Un administrador sin el módulo de Usuarios, y uno sin configuración.
  assert.deepEqual(filas(ent(sin('usuarios')), ADMIN), ['empresa', 'numeracion', 'tema', 'salir'])
  assert.deepEqual(filas(ent(sin('configuracion')), ADMIN), ['usuarios', 'tema', 'salir'])
  assert.deepEqual(filas(ent(sin('configuracion', 'usuarios')), ADMIN), ['tema', 'salir'])
  // Sin entitlements solo salen las filas que no dependen de ellos: siempre se puede cerrar sesión.
  assert.deepEqual(filas(null, { admin: true, soporte: true }), ['ayuda', 'tema', 'salir'])
})

test('filasMas: cada pantalla se enciende con su propia bandera', () => {
  const e = ent(TODOS)
  assert.deepEqual(ids(filasMas(e, ADMIN, { empresa: true, numeracion: false, usuarios: false })), ['empresa', 'tema', 'salir'])
  assert.deepEqual(ids(filasMas(e, ADMIN, { empresa: false, numeracion: true, usuarios: false })), ['numeracion', 'tema', 'salir'])
  assert.deepEqual(ids(filasMas(e, ADMIN, { empresa: false, numeracion: false, usuarios: true })), ['usuarios', 'tema', 'salir'])
})

test('filasMas: solo Cerrar sesión es de peligro, solo Tema no lleva icono y solo las pantallas de Más llevan ruta', () => {
  const filas = filasMas(ent(TODOS), { admin: true, soporte: true }, LISTAS)
  assert.deepEqual(ids(filas.filter((f) => f.peligro === true)), ['salir'])
  assert.deepEqual(ids(filas.filter((f) => f.icono === '')), ['tema'])
  assert.deepEqual(ids(filas.filter((f) => f.hash !== undefined)), ['empresa', 'numeracion', 'usuarios'])
})

test('la fila oculta y la ruta negada coinciden: toda fila con ruta la deja pasar la guardia, y toda ruta de Más que pasa tiene su fila', () => {
  const RUTAS_DE_MAS: Ruta[] = [{ id: 'mas-empresa' }, { id: 'mas-numeracion' }, { id: 'mas-usuarios' }]
  let comprobadas = 0
  for (let mascara = 0; mascara < 1 << TODOS.length; mascara++) {
    const modulos = TODOS.filter((_, i) => (mascara & (1 << i)) !== 0)
    const e = ent(modulos)
    for (const admin of [true, false]) {
      const contexto = `módulos ${modulos.join(',') || 'ninguno'}, admin ${admin}`
      const filas = filasMas(e, { admin, soporte: true }, LISTAS)
      for (const fila of filas) {
        if (fila.hash === undefined) continue
        assert.deepEqual(guardia(parseHash(fila.hash), { entitlements: e, admin }), { kind: 'ok' }, `${fila.id}: ${contexto}`)
        comprobadas++
      }
      const conFila = new Set(filas.map((f) => f.hash))
      for (const ruta of RUTAS_DE_MAS) {
        const pasa = guardia(ruta, { entitlements: e, admin }).kind === 'ok'
        assert.equal(pasa, conFila.has(formatHash(ruta)), `${ruta.id}: ${contexto}`)
      }
    }
  }
  assert.ok(comprobadas > 0)
})

// --- etiquetaRol --------------------------------------------------------------------------------------------------------------------

test('etiquetaRol: el rol en español; uno que no se conoce se muestra tal cual', () => {
  assert.equal(etiquetaRol('admin'), 'Administrador')
  assert.equal(etiquetaRol('user'), 'Facturador')
  assert.equal(etiquetaRol('contador'), 'contador')
  assert.equal(etiquetaRol('Admin'), 'Admin') // el rol se compara por su nombre exacto, como esAdmin
  assert.equal(etiquetaRol(''), '')
})

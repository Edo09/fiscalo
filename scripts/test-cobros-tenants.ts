// Cobros de tenants (la plataforma le cobra a las empresas que la usan: src/features/cobros con el ámbito 'tenants',
// src/api/rutas-cobros.ts y src/api/schemas/cobros.ts), sin navegador ni servidor:
//   1. CONTRATO: las respuestas REALES del modelo de la API en el ámbito de tenants (scripts/fixtures/cobros-tenants/*.json,
//      volcadas por `php tools/test_cobros_tenants.php --fixtures=<carpeta>` en api-gratex) pasan por los MISMOS esquemas Zod
//      que los cobros de una empresa, y el buscador de tenants por el suyo. Los tenants del fixture son inventados.
//   2. RUTAS: el servicio de cada ámbito pide la base correcta (/api/cobros o /api/cobros-tenants) y las mismas formas de ruta
//      que reconoce el servidor (CobroReglas::ruta); un ámbito no pide nunca la ruta del otro.
//   3. CLAVES de caché y frescura: cada ámbito tiene su raíz, así una mutación invalida solo lo suyo.
//   4. STORES de interfaz: uno por ámbito, independientes, y los dos se reinician al cambiar de sesión.
//   5. NAVEGACIÓN: la vista y su item del menú son solo para cuentas de soporte (acceso global), sin fail-open.
//   6. El texto del buscador de tenants.
//   7. El directorio de tenants (la pestaña Clientes): contrato con lo que debe cada uno, filtros, conteos y rótulos.
//
// Para regenerar los fixtures (en api-gratex, con pdo_sqlite):
//   php -d extension=php_pdo_sqlite.dll tools/test_cobros_tenants.php --fixtures=<ruta de fiscalo-react>/scripts/fixtures/cobros-tenants
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-cobros-tenants.ts
import { readFileSync } from 'node:fs'
import {
  ESTADOS_COBRO, cobroDetalleSchema, cobroSchema, configCobroSchema, pagoAnuladoSchema, pagoResultadoSchema, panelClienteSchema,
  recordatorioResultadoSchema, recordatoriosCobrosSchema, resumenCobrosSchema, tenantBuscadoSchema, tenantsBuscadosSchema,
} from '../src/api/schemas/cobros.ts'
import { BASE_COBROS, BASE_COBROS_TENANTS, rutasCobros } from '../src/api/rutas-cobros.ts'
import { cobrosKeys, cobrosTenantsKeys, crearCobrosKeys } from '../src/features/cobros/claves.ts'
import { detalleCobroMensual, detalleTenant, subtituloTenant } from '../src/features/cobros/format.ts'
import {
  FILTROS_DIRECTORIO, MAX_DIRECTORIO, TIPOS_DIRECTORIO, conteoDeFiltro, cumpleFiltro, filtrarDirectorio, resumenDirectorio,
} from '../src/features/cobros/directorio.ts'
import {
  NAV, TITLES, debeSalirDeVista, navModuleFor, navSoloAccesoGlobal, navSoloAdmin, navTopFor, puedeVerItem, puedeVerVista,
} from '../src/config/navigation.ts'
import { FRESCURA, staleTimeFor } from '../src/config/cache.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido).slice(0, 400)}`}`)
}
const igual = (desc: string, obtenido: unknown, esperado: unknown) =>
  chk(desc, JSON.stringify(obtenido) === JSON.stringify(esperado), obtenido)

const fixture = (nombre: string): { data: unknown; pagination?: unknown } =>
  JSON.parse(readFileSync(new URL(`./fixtures/cobros-tenants/${nombre}.json`, import.meta.url), 'utf8'))

// ---------------------------------------------------------------------------
console.log('1. Contrato con la API: las respuestas reales del ámbito de tenants pasan por los esquemas')
const lista = fixture('lista')
const filas = (lista.data as unknown[]).map((f) => cobroSchema.safeParse(f))
chk(`la lista (${filas.length} cobros) pasa por cobroSchema, el mismo de los cobros de una empresa`, filas.length === 8 && filas.every((f) => f.success),
  filas.filter((f) => !f.success).map((f) => !f.success && f.error.issues[0]))
const cobros = filas.flatMap((f) => (f.success ? [f.data] : []))
chk('la lista trae los cinco estados', ESTADOS_COBRO.every((e) => cobros.some((c) => c.estado === e)), [...new Set(cobros.map((c) => c.estado))])
chk('la paginación del sobre trae page, pageSize, total y totalPages', ['page', 'pageSize', 'total', 'totalPages'].every((k) => typeof (lista.pagination as Record<string, unknown>)[k] === 'number'))
chk('el cliente de cada cobro es un tenant: su nombre hace de nombre, contacto y empresa, y trae su RNC',
  cobros.every((c) => c.cliente.nombre !== '' && c.cliente.nombre === c.cliente.contacto && c.cliente.nombre === c.cliente.empresa && /^\d{9}$/.test(c.cliente.rnc)))
chk('el teléfono de un tenant siempre viene vacío (no tiene)', cobros.every((c) => c.cliente.telefono === ''))
const clienteDe = (nombre: string) => cobros.find((c) => c.cliente.nombre === nombre)?.cliente
chk('el correo es el de su primer admin ("admin@alfa.test") y vacío si el tenant no tiene usuarios (integración)',
  clienteDe('Alfa Comercial SRL')?.email === 'admin@alfa.test' && clienteDe('Gamma Integraciones')?.email === '' && clienteDe('Delta 100% Pruebas')?.email === '')
chk('los montos son números, con saldo = monto - pagado (salvo cancelado = 0)', cobros.every((c) =>
  typeof c.monto === 'number' && Math.round(c.saldo * 100) === (c.estado === 'Cancelado' ? 0 : Math.round(c.monto * 100) - Math.round(c.monto_pagado * 100))))

const detalle = cobroDetalleSchema.safeParse(fixture('detalle').data)
chk('el detalle de un cobro pasa por cobroDetalleSchema', detalle.success && detalle.data.periodo === '2026-10' && detalle.data.cliente.nombre === 'Alfa Comercial SRL', !detalle.success && detalle.error.issues[0])
const pago = pagoResultadoSchema.safeParse(fixture('pago').data)
chk('el pago que completa un cobro pasa por pagoResultadoSchema y generó el del mes siguiente (6,000, el monto ACTUAL)',
  pago.success && pago.data.siguiente_motivo === 'generado' && pago.data.siguiente_nuevo === true && pago.data.siguiente?.monto === 6000 && pago.data.cobro.estado === 'Pagado',
  !pago.success && pago.error.issues[0])
const repetido = pagoResultadoSchema.safeParse(fixture('pago-repetido').data)
chk('repetir el pago con la misma clave: repetido = true y sin otro cobro', repetido.success && repetido.data.repetido === true && repetido.data.siguiente_nuevo === false, !repetido.success && repetido.error.issues[0])
const anulado = pagoAnuladoSchema.safeParse(fixture('anulado').data)
chk('un pago anulado pasa por pagoAnuladoSchema y se queda a la vista con su motivo', anulado.success && anulado.data.pago.anulado === true && anulado.data.pago.motivo_anulacion === 'Se digito mal', !anulado.success && anulado.error.issues[0])
const resumen = resumenCobrosSchema.safeParse(fixture('resumen').data)
chk('el dashboard pasa por resumenCobrosSchema, con los valores calculados a mano por el servidor (pendiente 11,000; vencido 2,300; 4 tenants con saldo)',
  resumen.success && resumen.data.totales.pendiente === 11000 && resumen.data.totales.vencido === 2300 && resumen.data.totales.clientes_con_saldo === 4
  && resumen.data.atrasados.map((a) => a.cliente.nombre).join('|') === 'Delta 100% Pruebas|Gamma Integraciones', !resumen.success && resumen.error.issues[0])
const recordatorios = recordatoriosCobrosSchema.safeParse(fixture('recordatorios').data)
chk('los recordatorios pasan por recordatoriosCobrosSchema: por tenant, con el correo de su admin',
  recordatorios.success && recordatorios.data.clientes.length === 3 && recordatorios.data.clientes.some((c) => c.cliente.email === 'admin@epsilon.test'), !recordatorios.success && recordatorios.error.issues[0])
const recordatorio = recordatorioResultadoSchema.safeParse(fixture('recordatorio').data)
chk('un recordatorio anotado pasa por recordatorioResultadoSchema', recordatorio.success && recordatorio.data.recordatorio.usuario === 'soporte', !recordatorio.success && recordatorio.error.issues[0])
const panel = panelClienteSchema.safeParse(fixture('panel').data)
chk('el panel de un tenant pasa por panelClienteSchema: su configuración, sus 2 cobros y lo sugerido (diciembre, 6,000, día 31)',
  panel.success && panel.data.cliente.nombre === 'Alfa Comercial SRL' && panel.data.cobros.length === 2 && panel.data.config?.monto_mensual === 6000
  && panel.data.sugerido.periodo === '2026-12' && panel.data.sugerido.fecha_vencimiento === '2026-12-31', !panel.success && panel.error.issues[0])
const panelSin = panelClienteSchema.safeParse(fixture('panel-sin-config').data)
chk('el panel de un tenant sin configuración: config null y sin monto sugerido', panelSin.success && panelSin.data.config === null && panelSin.data.sugerido.monto === null, !panelSin.success && panelSin.error.issues[0])
const config = configCobroSchema.safeParse(fixture('config').data)
chk('la configuración mensual de un tenant pasa por configCobroSchema', config.success && config.data.client_id === 1 && config.data.dia_vencimiento === 31, !config.success && config.error.issues[0])

const buscar = tenantsBuscadosSchema.safeParse(fixture('buscar').data)
chk('el buscador de tenants pasa por tenantsBuscadosSchema (5 tenants)', buscar.success && buscar.data.length === 5, !buscar.success && buscar.error.issues[0])
const tenants = buscar.success ? buscar.data : []
igual('...los activos primero, por nombre, y el inactivo al final', tenants.map((t) => t.id), [1, 2, 4, 3, 5])
chk('...cada uno dice qué es: integración, certificación, inactiva', tenants.find((t) => t.id === 3)?.tipo === 'integracion' && tenants.find((t) => t.id === 4)?.ambiente === 'certecf'
  && tenants.find((t) => t.id === 5)?.activo === false && tenants.find((t) => t.id === 1)?.activo === true)
igual('...y si ya tiene su cobro mensual configurado (solo Alfa en ese momento)', tenants.map((t) => t.con_config), [true, false, false, false, false])
const dirResp = tenantsBuscadosSchema.safeParse(fixture('directorio').data)
chk('el directorio (con su cobro mensual y lo que debe cada uno) pasa por tenantsBuscadosSchema: 5 tenants', dirResp.success && dirResp.data.length === 5, !dirResp.success && dirResp.error.issues[0])
const dir = dirResp.success ? dirResp.data : []
const dirDe = (id: number) => dir.find((t) => t.id === id)
igual('...los activos primero y por nombre (Alfa, Beta, Delta, Gamma) y la inactiva al final', dir.map((t) => t.id), [1, 2, 4, 3, 5])
igual('...con lo que debe cada uno, calculado a mano por el servidor: [id, pendiente, vencido, abiertos, vencidos, días de atraso, próximo vencimiento]',
  dir.map((t) => [t.id, t.saldo_pendiente, t.saldo_vencido, t.cobros_abiertos, t.cobros_vencidos, t.dias_atraso, t.proximo_vencimiento]),
  [[1, 6000, 0, 1, 0, 0, '2026-11-30'], [2, 0, 0, 0, 0, 0, null], [4, 3500, 2000, 2, 1, 1, '2026-12-15'], [3, 300, 300, 1, 1, 15, null], [5, 1200, 0, 1, 0, 0, '2026-11-16']])
chk('...y su cobro mensual: el de Alfa (6,000, día 31, activo), el de Beta inactivo (1,000, día 10) y null en el que no tiene (Gamma y Epsilon)',
  dirDe(1)?.config?.monto_mensual === 6000 && dirDe(1)?.config?.dia_vencimiento === 31 && dirDe(1)?.config?.activo === true
  && dirDe(2)?.config?.monto_mensual === 1000 && dirDe(2)?.config?.activo === false && dirDe(3)?.config === null && dirDe(5)?.config === null
  && dir.every((t) => t.con_config === (t.config !== null)))
chk('...y lo que suma el directorio cuadra con el dashboard (pendiente 11,000 y vencido 2,300)',
  resumenDirectorio(dir).saldoPendiente === 11000 && resumenDirectorio(dir).saldoVencido === 2300
  && resumen.success && resumen.data.totales.pendiente === 11000 && resumen.data.totales.vencido === 2300)
const sinSaldo = { ...(fixture('directorio').data as Record<string, unknown>[])[0] }
delete sinSaldo.saldo_pendiente
chk('...y un tenant al que le falta un campo nuevo del contrato (saldo_pendiente) NO pasa por el esquema', !tenantBuscadoSchema.safeParse(sinSaldo).success)
const sinTipo = { ...(fixture('buscar').data as Record<string, unknown>[])[0] }
delete sinTipo.tipo
chk('un tenant al que le falta un campo del contrato NO pasa por tenantBuscadoSchema (el esquema no es de adorno)', !tenantBuscadoSchema.safeParse(sinTipo).success)
chk('un cobro de un tenant con el cliente mal formado tampoco pasa por cobroSchema',
  !cobroSchema.safeParse({ ...(lista.data as Record<string, unknown>[])[0], cliente: { id: 1, nombre: 'X' } }).success)

// ---------------------------------------------------------------------------
console.log('\n2. Rutas: cada ámbito pide la suya')
// Las formas que reconoce el servidor (api-gratex CobroReglas::ruta), sin el query string.
const formaServidor = (base: string) =>
  new RegExp(`^${base}(/(resumen|recordatorios|clientes|clientes/\\d+|clientes/\\d+/config|\\d+|\\d+/(pagos|cancelar|reabrir|recordatorios)|pagos/\\d+/anular))?$`)
for (const [base, nombre] of [[BASE_COBROS, 'empresa'], [BASE_COBROS_TENANTS, 'tenants']] as const) {
  const r = rutasCobros(base)
  const todas = [
    r.lista(), r.lista({ page: 2, pageSize: 25, query: 'alfa', client_id: 4, estado: 'Vencido' }), r.resumen(), r.resumen(30), r.recordatorios(),
    r.recordatorios({ dias: 15, cada: 7 }), r.buscar(), r.buscar('Alfa', 20), r.cliente(7), r.config(7), r.cobro(12), r.pagos(12), r.cancelar(12),
    r.reabrir(12), r.recordatorio(12), r.anularPago(9),
  ]
  chk(`ámbito ${nombre}: las 16 rutas empiezan por ${base} y tienen una forma que el servidor reconoce`,
    todas.every((p) => formaServidor(base).test(p.split('?')[0])), todas.filter((p) => !formaServidor(base).test(p.split('?')[0])))
  igual(`ámbito ${nombre}: los ids y los filtros van donde el servidor los espera`, [
    r.lista(), r.lista({ page: 2, pageSize: 25, query: 'alfa', client_id: 4, estado: 'Vencido' }), r.resumen(), r.resumen(30), r.recordatorios({ dias: 15, cada: 7 }),
    r.cliente(7), r.config(7), r.cobro(12), r.pagos(12), r.cancelar(12), r.reabrir(12), r.recordatorio(12), r.anularPago(9),
  ], [
    base, `${base}?page=2&pageSize=25&query=alfa&client_id=4&estado=Vencido`, `${base}/resumen`, `${base}/resumen?dias=30`, `${base}/recordatorios?dias=15&cada=7`,
    `${base}/clientes/7`, `${base}/clientes/7/config`, `${base}/12`, `${base}/12/pagos`, `${base}/12/cancelar`, `${base}/12/reabrir`, `${base}/12/recordatorios`,
    `${base}/pagos/9/anular`,
  ])
}
const rt = rutasCobros(BASE_COBROS_TENANTS)
igual('el buscador de tenants: sin texto no manda query; con texto y límite, ambos; un % y un espacio van codificados',
  [rt.buscar(), rt.buscar(''), rt.buscar('Alfa', 20), rt.buscar('Delta 100%'), rt.buscar(undefined, 5)],
  ['/api/cobros-tenants/clientes', '/api/cobros-tenants/clientes', '/api/cobros-tenants/clientes?query=Alfa&limite=20', '/api/cobros-tenants/clientes?query=Delta+100%25', '/api/cobros-tenants/clientes?limite=5'])
chk('las bases son las del servidor y ninguna es prefijo de la ruta de la otra (/api/cobros-tenants no empieza por /api/cobros/)',
  BASE_COBROS === '/api/cobros' && BASE_COBROS_TENANTS === '/api/cobros-tenants' && !`${BASE_COBROS_TENANTS}/resumen`.startsWith(`${BASE_COBROS}/`) && !formaServidor(BASE_COBROS).test(`${BASE_COBROS_TENANTS}/resumen`))

// ---------------------------------------------------------------------------
console.log('\n3. Claves de caché y frescura por ámbito')
const unaDeCada = (k: ReturnType<typeof crearCobrosKeys>) => [
  k.lista({ page: 1 }), k.resumen(7), k.recordatorios(7, 7), k.cliente(5), k.detalle(5), k.buscar('alfa'), k.directorio('alfa'),
]
chk('las claves de cada ámbito cuelgan de su raíz (invalidar ["cobros"] no toca ["cobros-tenants"] ni al revés)',
  cobrosKeys.todo[0] === 'cobros' && cobrosTenantsKeys.todo[0] === 'cobros-tenants'
  && unaDeCada(cobrosKeys).every((k) => k[0] === 'cobros') && unaDeCada(cobrosTenantsKeys).every((k) => k[0] === 'cobros-tenants'))
chk('el cliente 5 de una empresa y el tenant 5 son claves distintas (ids de tablas distintas)', JSON.stringify(cobrosKeys.cliente(5)) !== JSON.stringify(cobrosTenantsKeys.cliente(5))
  && JSON.stringify(cobrosKeys.detalle(5)) !== JSON.stringify(cobrosTenantsKeys.detalle(5)))
igual('las claves del ámbito de tenants, una por una', unaDeCada(cobrosTenantsKeys),
  [['cobros-tenants', 'lista', { page: 1 }], ['cobros-tenants', 'resumen', 7], ['cobros-tenants', 'recordatorios', 7, 7], ['cobros-tenants', 'cliente', 5], ['cobros-tenants', 'detalle', 5], ['cobros-tenants', 'buscar', 'alfa'], ['cobros-tenants', 'directorio', 'alfa']])
chk('la caché de cobros de tenants es volátil, como la de las empresas (otro usuario cobra; el estado cambia con la fecha)',
  staleTimeFor(['cobros-tenants', 'lista', {}]) === FRESCURA.VOLATIL && staleTimeFor(['cobros', 'lista', {}]) === FRESCURA.VOLATIL)

// ---------------------------------------------------------------------------
console.log('\n4. Stores de interfaz: uno por ámbito')
// El store de sesión persiste en localStorage: en Node no existe, así que se le da uno en memoria ANTES de importarlo.
const memoria = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => void memoria.set(k, v), removeItem: (k: string) => void memoria.delete(k) },
})
const { cobrosUiEmpresa, cobrosUiTenants, crearCobrosUi, FILTROS_VACIOS } = await import('../src/features/cobros/store.ts')
const { useAuthStore } = await import('../src/stores/auth.ts')
const empresa = () => cobrosUiEmpresa.getState()
const tenantsUi = () => cobrosUiTenants.getState()
chk('son dos stores distintos, los dos en su estado inicial; cada pantalla abre en su pestaña (empresas: Cobros; plataforma: Clientes, el directorio)',
  cobrosUiEmpresa !== cobrosUiTenants
  && [empresa(), tenantsUi()].every((s) => s.page === 1 && s.pageSize === 10 && s.panelClienteId === null && s.modal === null && s.recordatoriosDias === 7)
  && empresa().tab === 'cobros' && tenantsUi().tab === 'clientes')
tenantsUi().abrirPanel(5, 'config')
tenantsUi().setFiltros({ clientId: 5, clienteNombre: 'Alfa Comercial SRL', estado: 'Vencido' })
tenantsUi().abrirModal({ tipo: 'pago', cobroId: 3 })
tenantsUi().setTab('recordatorios')
chk('lo que se hace en la pantalla de tenants no toca el store de las empresas (el panel del tenant 5 no abre el cliente 5)',
  empresa().panelClienteId === null && JSON.stringify(empresa().filtros) === JSON.stringify(FILTROS_VACIOS) && empresa().modal === null && empresa().tab === 'cobros'
  && tenantsUi().panelClienteId === 5 && tenantsUi().filtros.clientId === 5 && tenantsUi().tab === 'recordatorios')
empresa().abrirPanel(9)
empresa().setPageSize(50)
chk('...ni al revés', tenantsUi().panelClienteId === 5 && tenantsUi().pageSize === 10 && empresa().panelClienteId === 9 && empresa().pageSize === 50)
const nuevoStore = crearCobrosUi()
chk('crearCobrosUi() da un store nuevo, en su estado inicial, que no comparte nada con los otros', nuevoStore !== cobrosUiTenants
  && nuevoStore.getState().panelClienteId === null && nuevoStore.getState().filtros.clientId === null && nuevoStore.getState().page === 1)
const conClientes = crearCobrosUi('clientes')
conClientes.getState().setTab('recordatorios')
conClientes.getState().reset()
chk('crearCobrosUi: sin argumento abre en Cobros; con una pestaña, en esa, y al reiniciarse vuelve a ella (no a Cobros)',
  nuevoStore.getState().tab === 'cobros' && conClientes.getState().tab === 'clientes')
useAuthStore.getState().setSession('token-de-otra-empresa', { id: 1, email: 'a@x.do', username: 'a', name: 'A', role: 'admin', permissions: ['*'] })
igual('al cambiar de sesión (otra empresa de soporte, otro usuario) los DOS stores vuelven al principio, cada uno a su pestaña', [
  empresa().panelClienteId, empresa().pageSize, tenantsUi().panelClienteId, tenantsUi().modal, tenantsUi().tab, tenantsUi().filtros,
], [null, 10, null, null, 'clientes', FILTROS_VACIOS])
tenantsUi().abrirPanel(33)
empresa().abrirPanel(34)
useAuthStore.getState().clearSession()
chk('al cerrar sesión también se reinician los dos', tenantsUi().panelClienteId === null && empresa().panelClienteId === null)

// ---------------------------------------------------------------------------
console.log('\n5. Navegación: solo cuentas de soporte')
const admin = NAV.find((g) => g.group === 'Administración')?.items ?? []
const iBitacora = admin.findIndex((i) => i.id === 'bitacora')
const item = admin[iBitacora + 1]
chk('el menú tiene "Cobros de tenants" en Administración, justo después de la Bitácora, solo para acceso global y sin módulo RBAC',
  item?.id === 'cobros-tenants' && item.label === 'Cobros de tenants' && item.soloAccesoGlobal === true && item.module === undefined && item.soloAdmin === undefined, item)
chk('la vista tiene título, es su propio item del menú y ni hereda un módulo ni es "solo admin"',
  TITLES['cobros-tenants'] === 'Cobros de tenants' && navTopFor('cobros-tenants') === 'cobros-tenants' && navModuleFor('cobros-tenants') === undefined && !navSoloAdmin('cobros-tenants'))
chk('navSoloAccesoGlobal: solo esa vista (ni Cobros de las empresas ni la Bitácora)', navSoloAccesoGlobal('cobros-tenants') && !navSoloAccesoGlobal('cobros') && !navSoloAccesoGlobal('bitacora') && !navSoloAccesoGlobal('dashboard'))
const soporte = { role: 'admin', permissions: ['*'], acceso_global: true }
chk('una cuenta de soporte la ve, y también con otro rol y sin el módulo cobros (el servidor solo mira el acceso global)',
  puedeVerVista(soporte, 'cobros-tenants') && puedeVerVista({ role: 'user', permissions: ['facturas'], acceso_global: true }, 'cobros-tenants') && puedeVerItem(soporte, item))
chk('el admin de una empresa NO la ve (ni con "*"), ni acceso_global false, ni una sesión previa a RBAC sin el dato (no es fail-open), ni sin sesión',
  !puedeVerVista({ role: 'admin', permissions: ['*'] }, 'cobros-tenants') && !puedeVerVista({ role: 'admin', permissions: ['*'], acceso_global: false }, 'cobros-tenants')
  && !puedeVerVista({ role: 'user' }, 'cobros-tenants') && !puedeVerVista(null, 'cobros-tenants') && !puedeVerVista(undefined, 'cobros-tenants'))
chk('el sidebar de un admin de empresa no la trae y el de soporte sí',
  !admin.filter((i) => puedeVerItem({ role: 'admin', permissions: ['*'] }, i)).some((i) => i.id === 'cobros-tenants')
  && admin.filter((i) => puedeVerItem(soporte, i)).some((i) => i.id === 'cobros-tenants'))
chk('debeSalirDeVista: a quien no es de soporte y llega a la vista (guardada en el navegador) lo saca; a soporte no',
  debeSalirDeVista({ role: 'admin', permissions: ['*'] }, 'cobros-tenants', null) && !debeSalirDeVista(soporte, 'cobros-tenants', null))
chk('el acceso global NO da el módulo Cobros de las empresas: sin él, esa vista sigue oculta (son cuentas por cobrar distintas)',
  !puedeVerVista({ role: 'user', permissions: ['facturas'], acceso_global: true }, 'cobros') && puedeVerVista({ role: 'user', permissions: ['cobros'] }, 'cobros'))

// ---------------------------------------------------------------------------
console.log('\n6. El buscador de tenants: la línea de detalle')
igual('un tenant normal (producción, con base propia): solo el RNC', detalleTenant({ rnc: '101000011', tipo: 'app', ambiente: 'ecf', activo: true, con_config: false }), 'RNC 101000011')
igual('de integración, en certificación, inactivo y con cobro mensual: todo lo que sale de lo normal',
  detalleTenant({ rnc: '101000033', tipo: 'integracion', ambiente: 'certecf', activo: false, con_config: true }),
  'RNC 101000033 · Integración · Certificación · Inactiva · Cobro mensual configurado')
igual('sin RNC lo dice, y un ambiente de pruebas también', detalleTenant({ rnc: '', tipo: 'app', ambiente: 'testecf', activo: true, con_config: false }), 'sin RNC · Pruebas')

// ---------------------------------------------------------------------------
console.log('\n7. El directorio de tenants (la pestaña Clientes): filtros, conteos y rótulos')
const ids = (xs: { id: number }[]) => xs.map((x) => x.id)
chk('el tope del directorio es el del servidor (500) y hay un filtro rápido por cada cosa que se quiere ver',
  MAX_DIRECTORIO === 500 && FILTROS_DIRECTORIO.map((f) => f.id).join() === 'todos,con-saldo,vencidos,sin-cobro' && TIPOS_DIRECTORIO.map((f) => f.id).join() === 'todas,app,integracion')
igual('sin filtros salen todos, en el orden que mandó el servidor', ids(filtrarDirectorio(dir, { filtro: 'todos', tipo: 'todas' })), [1, 2, 4, 3, 5])
igual('con saldo: los que deben algo (Alfa, Delta, Gamma y Epsilon; Beta no)', ids(filtrarDirectorio(dir, { filtro: 'con-saldo', tipo: 'todas' })), [1, 4, 3, 5])
igual('vencidos: los que ya pasaron su vencimiento (Delta y Gamma; Epsilon vence HOY, no está vencida)', ids(filtrarDirectorio(dir, { filtro: 'vencidos', tipo: 'todas' })), [4, 3])
igual('sin cobro mensual: los que no lo tienen configurado (Gamma y Epsilon)', ids(filtrarDirectorio(dir, { filtro: 'sin-cobro', tipo: 'todas' })), [3, 5])
igual('por tipo: con base propia (Alfa, Beta, Delta, Epsilon) y de integración (Gamma)', [
  ids(filtrarDirectorio(dir, { filtro: 'todos', tipo: 'app' })), ids(filtrarDirectorio(dir, { filtro: 'todos', tipo: 'integracion' })),
], [[1, 2, 4, 5], [3]])
igual('el filtro rápido y el tipo se combinan: con saldo y con base propia; vencidos y de integración; vencidos y con base propia',
  [ids(filtrarDirectorio(dir, { filtro: 'con-saldo', tipo: 'app' })), ids(filtrarDirectorio(dir, { filtro: 'vencidos', tipo: 'integracion' })), ids(filtrarDirectorio(dir, { filtro: 'vencidos', tipo: 'app' }))],
  [[1, 4, 5], [3], [4]])
const resumenFx = resumenDirectorio(dir)
igual('los contadores de los filtros y lo que deben todos (sumado en centavos)', resumenFx, { total: 5, conSaldo: 4, vencidos: 2, sinCobro: 2, saldoPendiente: 11000, saldoVencido: 2300 })
igual('conteoDeFiltro da el contador de cada filtro rápido', FILTROS_DIRECTORIO.map((f) => conteoDeFiltro(resumenFx, f.id)), [5, 4, 2, 2])
const dosCobros = (a: number, b: number) => [a, b].map((m) => ({ saldo_pendiente: m, saldo_vencido: 0, config: null, tipo: 'app' }))
chk('sumar en centavos: 0.10 + 0.20 da exactamente 0.30 (en flotante daría 0.30000000000000004)', resumenDirectorio(dosCobros(0.1, 0.2)).saldoPendiente === 0.3 && 0.1 + 0.2 !== 0.3)
chk('un saldo de cero no cuenta como "con saldo" ni como "vencido", y config null es "sin cobro mensual"',
  !cumpleFiltro({ saldo_pendiente: 0, saldo_vencido: 0, config: null, tipo: 'app' }, 'con-saldo') && !cumpleFiltro({ saldo_pendiente: 0, saldo_vencido: 0, config: null, tipo: 'app' }, 'vencidos')
  && cumpleFiltro({ saldo_pendiente: 0, saldo_vencido: 0, config: null, tipo: 'app' }, 'sin-cobro'))
igual('un directorio vacío da todo en cero', resumenDirectorio([]), { total: 0, conSaldo: 0, vencidos: 0, sinCobro: 0, saldoPendiente: 0, saldoVencido: 0 })
igual('subtituloTenant: el RNC y solo lo que sale de lo normal (integración, certificación, inactiva), sin hablar del cobro',
  [subtituloTenant({ rnc: '101000011', tipo: 'app', ambiente: 'ecf', activo: true }), subtituloTenant({ rnc: '101000033', tipo: 'integracion', ambiente: 'certecf', activo: false }), subtituloTenant({ rnc: '', tipo: 'app', ambiente: 'testecf', activo: true })],
  ['RNC 101000011', 'RNC 101000033 · Integración · Certificación · Inactiva', 'sin RNC · Pruebas'])
igual('detalleCobroMensual: el día y si está activo', [detalleCobroMensual({ dia_vencimiento: 31, activo: true }), detalleCobroMensual({ dia_vencimiento: 10, activo: false })], ['día 31 · activo', 'día 10 · inactivo'])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)

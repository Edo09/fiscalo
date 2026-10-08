// Puerta por formato del menú (spec conduces 5.1): qué items y vistas se ven
// según el formato de cotización del tenant, y cuándo App saca al usuario de
// una vista. Lo que no tiene formato tiene que dar EXACTAMENTE lo de antes: se
// compara con una copia de la regla de antes (permisos y admin).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-nav-formato.ts
import type { FormatoId } from '../src/features/cotizaciones/formatos/index.ts'
import type { NavItem, SesionNav, ViewId } from '../src/config/navigation.ts'
import {
  NAV, TITLES, debeSalirDeVista, isConduceDesdeCotizacion, isConduceRef, navFormatoFor, navModuleFor, navSoloAdmin,
  navTopFor, puedeVerItem, puedeVerVista,
} from '../src/config/navigation.ts'
import { esRolAdmin, hasModule } from '../src/config/permissions.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// La regla de antes, copiada tal cual estaba puedeVerItem antes del formato.
const antes = (user: SesionNav | null | undefined, it: { module?: string; soloAdmin?: boolean }): boolean => {
  if (it.soloAdmin) return esRolAdmin(user?.role)
  const perms = user?.permissions
  return !it.module || !perms || hasModule(perms, it.module)
}

const admin: SesionNav = { role: 'admin', permissions: ['*'] }
const vendedor: SesionNav = { role: 'vendedor', permissions: ['cotizaciones', 'clients'] }
const contable: SesionNav = { role: 'contable', permissions: ['facturas', 'reportes'] }
// Sesión de antes de RBAC: sin lista de permisos (fail-open).
const previa: SesionNav = { role: 'user' }
const SESIONES: { nombre: string; user: SesionNav | null }[] = [
  { nombre: 'admin', user: admin },
  { nombre: 'vendedor', user: vendedor },
  { nombre: 'contable', user: contable },
  { nombre: 'previa', user: previa },
  { nombre: 'sin sesión', user: null },
]
const FORMATOS: (FormatoId | null | undefined)[] = [undefined, null, 'gratex', 'ferreteria']
const nombreFormato = (f: FormatoId | null | undefined) => (f === undefined ? 'sin pasar' : String(f))

// El item de Conduces lo agrega al menú su página. Si el menú todavía no lo
// trae, se simula aquí con los mismos datos, para probar la puerta igual.
if (!NAV.some((g) => g.items.some((i) => i.id === 'conduces'))) {
  const simulado: NavItem = { id: 'conduces', label: 'Conduces', icon: 'truck', module: 'cotizaciones', formato: 'ferreteria' }
  NAV.push({ group: 'Prueba', items: [simulado] })
}

console.log('Items sin formato: lo mismo que antes, se pase el formato o no')
for (const it of NAV.flatMap((g) => g.items).filter((i) => i.formato === undefined)) {
  const difs: string[] = []
  for (const s of SESIONES) {
    for (const f of FORMATOS) {
      if (puedeVerItem(s.user, it, f) !== antes(s.user, it)) difs.push(`${s.nombre}/${nombreFormato(f)}`)
    }
  }
  chk(`${it.label}${difs.length ? `: difiere en ${difs.join(', ')}` : ''}`, difs.length === 0)
}

console.log('Vistas sin formato: lo mismo que antes, y App saca solo por permiso')
const VISTAS = Object.keys(TITLES) as ViewId[]
const sinFormato = VISTAS.filter((v) => navFormatoFor(v) === undefined)
{
  const difsVer: string[] = []
  const difsSalir: string[] = []
  for (const v of sinFormato) {
    const reglas = { module: navModuleFor(v), soloAdmin: navSoloAdmin(v) }
    for (const s of SESIONES) {
      for (const f of FORMATOS) {
        if (puedeVerVista(s.user, v, f) !== antes(s.user, reglas)) difsVer.push(`${v}/${s.nombre}/${nombreFormato(f)}`)
        if (f !== undefined && debeSalirDeVista(s.user, v, f) !== !antes(s.user, reglas)) {
          difsSalir.push(`${v}/${s.nombre}/${nombreFormato(f)}`)
        }
      }
    }
  }
  chk(`puedeVerVista en ${sinFormato.length} vistas${difsVer.length ? `: difiere en ${difsVer.slice(0, 6).join(', ')}` : ''}`,
    difsVer.length === 0)
  chk(`debeSalirDeVista en ${sinFormato.length} vistas${difsSalir.length ? `: difiere en ${difsSalir.slice(0, 6).join(', ')}` : ''}`,
    difsSalir.length === 0)
}
// Los llamadores de hoy (Navbar "Nueva", Facturar de Cotizaciones) no pasan formato.
chk('sin pasar formato: el contable no ve Cotizaciones, el vendedor sí',
  !puedeVerVista(contable, 'cotizaciones') && puedeVerVista(vendedor, 'cotizacion-nueva'))
chk('sin pasar formato: la Bitácora sigue siendo solo del admin',
  puedeVerVista(admin, 'bitacora') && !puedeVerVista(previa, 'bitacora'))

console.log('Item con formato')
const conduces = { module: 'cotizaciones', formato: 'ferreteria' as const }
chk('admin + ferreteria: se ve', puedeVerItem(admin, conduces, 'ferreteria'))
chk('admin + gratex: no se ve', !puedeVerItem(admin, conduces, 'gratex'))
chk('admin + formato null (cargando o error): no se ve', !puedeVerItem(admin, conduces, null))
chk('admin sin pasar formato: no se ve', !puedeVerItem(admin, conduces))
chk('vendedor (con cotizaciones) + ferreteria: se ve', puedeVerItem(vendedor, conduces, 'ferreteria'))
chk('contable (sin cotizaciones) + ferreteria: no se ve (el módulo sigue mandando)',
  !puedeVerItem(contable, conduces, 'ferreteria'))
chk('sesión previa a RBAC + ferreteria: se ve (los permisos siguen fail-open)', puedeVerItem(previa, conduces, 'ferreteria'))
chk('sesión previa a RBAC + gratex: no se ve (el formato no es fail-open)', !puedeVerItem(previa, conduces, 'gratex'))
chk('sesión previa a RBAC + null: no se ve', !puedeVerItem(previa, conduces, null))
const soloAdminFer = { soloAdmin: true, formato: 'ferreteria' as const }
chk('soloAdmin + formato: el admin de ferreteria lo ve', puedeVerItem(admin, soloAdminFer, 'ferreteria'))
chk('soloAdmin + formato: el admin de gratex no', !puedeVerItem(admin, soloAdminFer, 'gratex'))
chk('soloAdmin + formato: el vendedor de ferreteria no', !puedeVerItem(vendedor, soloAdminFer, 'ferreteria'))
const soloGratex = { formato: 'gratex' as const }
chk('item de gratex sin módulo: gratex lo ve, ferreteria y null no',
  puedeVerItem(vendedor, soloGratex, 'gratex') && !puedeVerItem(vendedor, soloGratex, 'ferreteria')
  && !puedeVerItem(vendedor, soloGratex, null))

console.log('Vistas de Conduces')
chk('conduce-editar es subvista de conduces', navTopFor('conduce-editar') === 'conduces')
chk('conduces y conduce-editar exigen ferreteria',
  navFormatoFor('conduces') === 'ferreteria' && navFormatoFor('conduce-editar') === 'ferreteria')
chk('conduce-editar hereda el módulo cotizaciones', navModuleFor('conduce-editar') === 'cotizaciones')
chk('títulos: Conduces / Conduce', TITLES.conduces === 'Conduces' && TITLES['conduce-editar'] === 'Conduce')
chk('puedeVerVista(admin, conduces): solo con ferreteria',
  puedeVerVista(admin, 'conduces', 'ferreteria') && !puedeVerVista(admin, 'conduces', 'gratex')
  && !puedeVerVista(admin, 'conduces', null) && !puedeVerVista(admin, 'conduces'))
chk('puedeVerVista(vendedor, conduce-editar, ferreteria): sí; contable: no',
  puedeVerVista(vendedor, 'conduce-editar', 'ferreteria') && !puedeVerVista(contable, 'conduce-editar', 'ferreteria'))
chk('recarga sobre conduces con branding cargando o en error (null): App no saca',
  !debeSalirDeVista(admin, 'conduces', null) && !debeSalirDeVista(vendedor, 'conduce-editar', null))
chk('Gratex con conduces guardado: App saca', debeSalirDeVista(admin, 'conduces', 'gratex'))
chk('Gratex en conduce-editar: App saca', debeSalirDeVista(vendedor, 'conduce-editar', 'gratex'))
chk('Ferretería en conduces: App no saca', !debeSalirDeVista(admin, 'conduces', 'ferreteria'))
chk('sin módulo cotizaciones: App saca ya, sin esperar el formato',
  debeSalirDeVista(contable, 'conduces', null) && debeSalirDeVista(contable, 'conduce-editar', 'ferreteria'))
chk('sesión previa a RBAC en Ferretería: App no saca', !debeSalirDeVista(previa, 'conduces', 'ferreteria'))

console.log('Gratex nunca ve un item con formato (sidebar y buscador)')
const items = NAV.flatMap((g) => g.items)
for (const f of [undefined, null, 'gratex'] as const) {
  const visibles = SESIONES.flatMap((s) => items.filter((it) => puedeVerItem(s.user, it, f)))
  chk(`formato ${nombreFormato(f)}: ningún item con formato`, !visibles.some((it) => it.formato !== undefined))
}
chk('ferreteria + admin: se ven todos los items', items.every((it) => puedeVerItem(admin, it, 'ferreteria')))

console.log('Payloads')
chk('isConduceRef', isConduceRef({ kind: 'conduce', id: 3 }) && !isConduceRef({ kind: 'cotizacion', id: 3 })
  && !isConduceRef(null) && !isConduceRef(undefined))
chk('isConduceDesdeCotizacion',
  isConduceDesdeCotizacion({ kind: 'conduce-desde-cotizacion', cotizacionId: 12 })
  && !isConduceDesdeCotizacion({ kind: 'conduce', id: 12 }) && !isConduceDesdeCotizacion(null))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)

// Puerta por formato del menú (spec conduces 5.1): qué items y vistas se ven
// según el formato de cotización del tenant, y cuándo App saca al usuario de
// una vista. Lo que no tiene formato tiene que dar EXACTAMENTE lo de antes: se
// compara con una copia de la regla de antes (permisos y admin).
//
// También la puerta del POS (api-gratex docs/specs/pos.md M1): "Punto de venta"
// solo se ve si la empresa tiene el POS activo. Con el POS activo, ese item se
// compara con la regla de antes como los demás; aparte se prueba su puerta.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-nav-formato.ts
import type { FormatoId } from '../src/features/cotizaciones/formatos/index.ts'
import type { NavItem, SesionNav, ViewId } from '../src/config/navigation.ts'
import {
  NAV, TITLES, debeSalirDeVista, isConduceDesdeCotizacion, isConduceRef, navFormatoFor, navModuleFor, navRequierePos,
  navSoloAdmin, navTopFor, puedeVerItem, puedeVerVista,
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

// El item de Conduces es el del menú de verdad: en Ventas, justo después de
// Cotizaciones, con el mismo módulo que ellas y la puerta de Ferretería.
console.log('Item de Conduces en el menú')
{
  const ventas: NavItem[] = NAV.find((g) => g.group === 'Ventas')?.items ?? []
  const it = ventas[ventas.findIndex((i) => i.id === 'cotizaciones') + 1]
  chk('Ventas: Conduces justo después de Cotizaciones (truck, módulo cotizaciones, formato ferreteria)',
    it?.id === 'conduces' && it.label === 'Conduces' && it.icon === 'truck' && it.module === 'cotizaciones'
    && it.formato === 'ferreteria')
}

console.log('Items sin formato: lo mismo que antes, se pase el formato o no')
for (const it of NAV.flatMap((g) => g.items).filter((i) => i.formato === undefined)) {
  const difs: string[] = []
  for (const s of SESIONES) {
    for (const f of FORMATOS) {
      if (puedeVerItem(s.user, it, f, true) !== antes(s.user, it)) difs.push(`${s.nombre}/${nombreFormato(f)}`)
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
        if (puedeVerVista(s.user, v, f, true) !== antes(s.user, reglas)) difsVer.push(`${v}/${s.nombre}/${nombreFormato(f)}`)
        if (f !== undefined && debeSalirDeVista(s.user, v, f, true) !== !antes(s.user, reglas)) {
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
chk('ferreteria + admin + POS activo: se ven todos los items', items.every((it) => puedeVerItem(admin, it, 'ferreteria', true)))

console.log('Punto de venta (POS)')
{
  const ventas: NavItem[] = NAV.find((g) => g.group === 'Ventas')?.items ?? []
  const pv = ventas.find((i) => i.id === 'punto-venta')
  chk('Ventas: Punto de venta (printer, módulo pos, requierePos, sin formato)',
    pv?.label === 'Punto de venta' && pv.icon === 'printer' && pv.module === 'pos' && pv.requierePos === true
    && pv.formato === undefined)
  chk('es el único item con requierePos', items.filter((i) => i.requierePos).map((i) => i.id).join() === 'punto-venta')
  if (pv) {
    chk('admin + POS activo: se ve', puedeVerItem(admin, pv, 'gratex', true) && puedeVerItem(admin, pv, null, true))
    chk('admin + POS inactivo: no se ve', !puedeVerItem(admin, pv, 'gratex', false))
    chk('admin + POS sin saber (null): no se ve', !puedeVerItem(admin, pv, 'gratex', null))
    chk('admin sin pasar posActivo: no se ve', !puedeVerItem(admin, pv, 'gratex'))
    chk('vendedor (sin módulo pos) + POS activo: no se ve', !puedeVerItem(vendedor, pv, 'gratex', true))
    chk('cajero de app (con módulo pos) + POS activo: se ve',
      puedeVerItem({ role: 'cajero', permissions: ['pos'] }, pv, 'gratex', true))
    chk('sesión previa a RBAC + POS activo: se ve (permisos fail-open)', puedeVerItem(previa, pv, 'gratex', true))
    chk('sesión previa a RBAC + POS null: no se ve (el POS no es fail-open)', !puedeVerItem(previa, pv, 'gratex', null))
  }
  chk('navRequierePos: solo punto-venta',
    navRequierePos('punto-venta') && VISTAS.filter((v) => navRequierePos(v)).join() === 'punto-venta')
  chk('título: Punto de venta', TITLES['punto-venta'] === 'Punto de venta')
  chk('puedeVerVista(admin, punto-venta): solo con POS activo',
    puedeVerVista(admin, 'punto-venta', 'gratex', true) && !puedeVerVista(admin, 'punto-venta', 'gratex', false)
    && !puedeVerVista(admin, 'punto-venta', 'gratex', null) && !puedeVerVista(admin, 'punto-venta'))
  chk('App no saca de punto-venta mientras no se sabe (null) ni con el POS activo',
    !debeSalirDeVista(admin, 'punto-venta', 'gratex', null) && !debeSalirDeVista(admin, 'punto-venta', 'gratex', true)
    && !debeSalirDeVista(admin, 'punto-venta', 'gratex'))
  chk('App saca de punto-venta si la empresa no tiene POS', debeSalirDeVista(admin, 'punto-venta', 'gratex', false))
  chk('App saca de punto-venta sin módulo pos, aunque el POS esté activo',
    debeSalirDeVista(vendedor, 'punto-venta', 'gratex', true) && debeSalirDeVista(vendedor, 'punto-venta', null, null))
  // El POS no toca nada más: los demás items dan lo mismo con el POS activo, inactivo o sin saber.
  const otros = items.filter((i) => !i.requierePos)
  const difs = otros.filter((it) => SESIONES.some((ses) => FORMATOS.some((f) =>
    puedeVerItem(ses.user, it, f, false) !== puedeVerItem(ses.user, it, f, true)
    || puedeVerItem(ses.user, it, f, null) !== puedeVerItem(ses.user, it, f, true))))
  chk(`los otros ${otros.length} items no dependen del POS${difs.length ? `: difieren ${difs.map((i) => i.id).join(', ')}` : ''}`,
    difs.length === 0)
  const vistasOtras = VISTAS.filter((v) => !navRequierePos(v))
  const difsSalir = vistasOtras.filter((v) => SESIONES.some((ses) =>
    debeSalirDeVista(ses.user, v, 'gratex', false) !== debeSalirDeVista(ses.user, v, 'gratex', true)))
  chk(`App no saca de ninguna otra vista por el POS${difsSalir.length ? `: ${difsSalir.join(', ')}` : ''}`, difsSalir.length === 0)
}

console.log('Payloads')
chk('isConduceRef', isConduceRef({ kind: 'conduce', id: 3 }) && !isConduceRef({ kind: 'cotizacion', id: 3 })
  && !isConduceRef(null) && !isConduceRef(undefined))
chk('isConduceDesdeCotizacion',
  isConduceDesdeCotizacion({ kind: 'conduce-desde-cotizacion', cotizacionId: 12 })
  && !isConduceDesdeCotizacion({ kind: 'conduce', id: 12 }) && !isConduceDesdeCotizacion(null))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)

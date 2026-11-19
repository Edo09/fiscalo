// El directorio de tenants de "Cobros de tenants" (la pestaña Clientes): lo que se filtra y se cuenta, sin React.
// scripts/test-cobros-tenants.ts lo prueba con Node. La búsqueda por nombre o RNC la hace el servidor (así sigue
// siendo correcta con más tenants de los que caben en una respuesta); aquí solo los filtros rápidos de la lista.
//
// Imports de valor por ruta relativa con .ts: Node carga este archivo tal cual. Lo de '@/…' va solo como `import type`.
import type { TenantBuscado } from '@/api'
import { aCentavos, deCentavos } from '../../api/schemas/cobros.ts'

/** Cuántos tenants trae el directorio en una respuesta: el tope del servidor (api-gratex cobroModel::MAX_DIRECTORIO). */
export const MAX_DIRECTORIO = 500

/** Los filtros rápidos de la lista. */
export const FILTROS_DIRECTORIO = [
  { id: 'todos', label: 'Todos' },
  { id: 'con-saldo', label: 'Con saldo' },
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'sin-cobro', label: 'Sin cobro mensual' },
] as const
export type FiltroDirectorio = (typeof FILTROS_DIRECTORIO)[number]['id']

/** Por qué clase de empresa (en un grupo, la de su cabeza). */
export const TIPOS_DIRECTORIO = [
  { id: 'todas', label: 'Todas' },
  { id: 'app', label: 'Con base propia' },
  { id: 'integracion', label: 'De integración' },
] as const
export type TipoDirectorio = (typeof TIPOS_DIRECTORIO)[number]['id']

type ParaFiltrar = Pick<TenantBuscado, 'saldo_pendiente' | 'saldo_vencido' | 'config' | 'tipo' | 'facturable'>

/** ¿Cumple el filtro rápido? Con saldo = debe algo; vencidos = algo ya pasó su vencimiento; sin cobro = no tiene cobro mensual. */
export function cumpleFiltro(t: ParaFiltrar, filtro: FiltroDirectorio): boolean {
  switch (filtro) {
    case 'con-saldo': return aCentavos(t.saldo_pendiente) > 0
    case 'vencidos': return aCentavos(t.saldo_vencido) > 0
    case 'sin-cobro': return t.config === null
    default: return true
  }
}

/**
 * Los que se ven en la lista ANTES de los filtros rápidos: las unidades que se cobran, y las que no (marcadas "no es un cliente" o
 * que solo certificaron) solo si se pidió verlas. Con esto se calculan los contadores y el pie, para que no cuenten lo que no se ve.
 */
export function clientesDelDirectorio<T extends Pick<TenantBuscado, 'facturable'>>(items: readonly T[], conOcultas: boolean): T[] {
  return items.filter((t) => conOcultas || t.facturable)
}

/**
 * Lo que la plataforma cobra cada mes: la suma de los cobros mensuales ACTIVOS de las unidades que se cobran (en centavos: nada
 * de sumar floats) y cuántas empresas son. Un cobro mensual apagado, una unidad que no se cobra o una sin cobro mensual no suman.
 */
export function totalCobroMensual(items: readonly Pick<TenantBuscado, 'facturable' | 'config'>[]): { total: number; empresas: number } {
  let centavos = 0
  let empresas = 0
  for (const t of items) {
    if (t.facturable && t.config !== null && t.config.activo) {
      centavos += aCentavos(t.config.monto_mensual)
      empresas++
    }
  }
  return { total: deCentavos(centavos), empresas }
}

/** Cuántas unidades no se cobran (marcadas "no es un cliente" o solo de certificación). */
export function contarOcultas(items: readonly Pick<TenantBuscado, 'facturable'>[]): number {
  return items.filter((t) => !t.facturable).length
}

/** Los de la lista que cumplen el filtro rápido y el tipo de empresa, en el mismo orden que mandó el servidor. */
export function filtrarDirectorio<T extends ParaFiltrar>(
  items: readonly T[], f: { filtro: FiltroDirectorio; tipo: TipoDirectorio; conOcultas: boolean },
): T[] {
  return clientesDelDirectorio(items, f.conOcultas).filter((t) => cumpleFiltro(t, f.filtro) && (f.tipo === 'todas' || t.tipo === f.tipo))
}

export interface ResumenDirectorio {
  total: number
  conSaldo: number
  vencidos: number
  sinCobro: number
  /** Lo que deben todos los de la lista, en RD$ (sumado en centavos: nada de sumar floats). */
  saldoPendiente: number
  saldoVencido: number
}

/** Cuántos hay de cada cosa y cuánto deben, para los contadores de los filtros y el pie de la tabla. */
export function resumenDirectorio(items: readonly ParaFiltrar[]): ResumenDirectorio {
  let pendiente = 0
  let vencido = 0
  for (const t of items) {
    pendiente += aCentavos(t.saldo_pendiente)
    vencido += aCentavos(t.saldo_vencido)
  }
  return {
    total: items.length,
    conSaldo: items.filter((t) => cumpleFiltro(t, 'con-saldo')).length,
    vencidos: items.filter((t) => cumpleFiltro(t, 'vencidos')).length,
    sinCobro: items.filter((t) => cumpleFiltro(t, 'sin-cobro')).length,
    saldoPendiente: deCentavos(pendiente),
    saldoVencido: deCentavos(vencido),
  }
}

/** El contador que acompaña a un filtro rápido. */
export function conteoDeFiltro(r: ResumenDirectorio, filtro: FiltroDirectorio): number {
  switch (filtro) {
    case 'con-saldo': return r.conSaldo
    case 'vencidos': return r.vencidos
    case 'sin-cobro': return r.sinCobro
    default: return r.total
  }
}

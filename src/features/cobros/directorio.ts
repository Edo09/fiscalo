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

/** Por qué clase de empresa: la mayoría de las de integración se crearon solo para certificar y no son clientes. */
export const TIPOS_DIRECTORIO = [
  { id: 'todas', label: 'Todas' },
  { id: 'app', label: 'Con base propia' },
  { id: 'integracion', label: 'De integración' },
] as const
export type TipoDirectorio = (typeof TIPOS_DIRECTORIO)[number]['id']

type ParaFiltrar = Pick<TenantBuscado, 'saldo_pendiente' | 'saldo_vencido' | 'config' | 'tipo' | 'excluido'>

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
 * Los que se ven en la lista ANTES de los filtros rápidos: los clientes, y las empresas marcadas como "no es un cliente" solo si se
 * pidió verlas. Con esto se calculan los contadores y el pie, para que no cuenten lo que no se ve.
 */
export function clientesDelDirectorio<T extends Pick<TenantBuscado, 'excluido'>>(items: readonly T[], conExcluidos: boolean): T[] {
  return items.filter((t) => conExcluidos || !t.excluido)
}

/** Cuántas empresas están marcadas como "no es un cliente". */
export function contarExcluidos(items: readonly Pick<TenantBuscado, 'excluido'>[]): number {
  return items.filter((t) => t.excluido).length
}

/** Los de la lista que cumplen el filtro rápido y el tipo de empresa, en el mismo orden que mandó el servidor. */
export function filtrarDirectorio<T extends ParaFiltrar>(
  items: readonly T[], f: { filtro: FiltroDirectorio; tipo: TipoDirectorio; conExcluidos: boolean },
): T[] {
  return clientesDelDirectorio(items, f.conExcluidos).filter((t) => cumpleFiltro(t, f.filtro) && (f.tipo === 'todas' || t.tipo === f.tipo))
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

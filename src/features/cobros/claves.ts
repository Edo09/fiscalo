// Las claves de TanStack Query de Cobros, por ámbito: cada uno tiene su propia raíz ('cobros' para las empresas,
// 'cobros-tenants' para la plataforma). Así una mutación invalida SOLO lo de su ámbito, y el id de un cliente de una
// empresa nunca se confunde en la caché con el de un tenant (son ids de tablas distintas).
// La raíz también decide la frescura (config/cache.ts, por el primer segmento de la clave).
//
// scripts/test-cobros-tenants.ts carga este archivo con `node` tal cual: lo de '@/…' va solo como `import type`.
import type { ListarCobrosParams } from '@/api'

export type RaizCobros = 'cobros' | 'cobros-tenants'

export function crearCobrosKeys(raiz: RaizCobros) {
  return {
    /** Todo lo del ámbito (para invalidar). */
    todo: [raiz] as const,
    lista: (p: ListarCobrosParams) => [raiz, 'lista', p] as const,
    resumen: (dias: number) => [raiz, 'resumen', dias] as const,
    recordatorios: (dias: number, cada: number) => [raiz, 'recordatorios', dias, cada] as const,
    cliente: (id: number) => [raiz, 'cliente', id] as const,
    detalle: (id: number) => [raiz, 'detalle', id] as const,
    /** El buscador de tenants (solo en la plataforma). */
    buscar: (texto: string) => [raiz, 'buscar', texto] as const,
    /** El directorio de tenants, con su cobro mensual y lo que deben, para lo que se busca ('' = todos). Solo en la plataforma. */
    directorio: (texto: string) => [raiz, 'directorio', texto] as const,
  }
}

export type CobrosKeys = ReturnType<typeof crearCobrosKeys>

/** Las claves del ámbito de empresa. */
export const cobrosKeys = crearCobrosKeys('cobros')
/** Las claves del ámbito de la plataforma. */
export const cobrosTenantsKeys = crearCobrosKeys('cobros-tenants')

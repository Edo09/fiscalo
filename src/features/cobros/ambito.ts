// El ámbito de Cobros: el mismo módulo sirve a DOS pantallas con datos distintos (api-gratex docs/modules/cobros.md):
//   - 'empresa': cada empresa cobra a SUS clientes (/api/cobros, módulo RBAC 'cobros').
//   - 'tenants': la plataforma cobra a sus tenants, las empresas que usan Fiscalpoint (/api/cobros-tenants, solo cuentas
//     de soporte con acceso global).
// Cada ámbito trae su servicio, sus claves de caché, su store de interfaz y sus textos, y las pantallas los leen del
// contexto: ningún componente sabe de qué ámbito es, y un ámbito no puede tocar el estado del otro (un id de cliente de una
// empresa y el de un tenant son ids de tablas distintas).
//
// Imports de valor por ruta relativa con .ts: scripts/test-cobros-tenants.ts carga store.ts, que usa este archivo.
// Lo de '@/…' va solo como `import type`, que Node borra.
import { createContext, useContext } from 'react'
import type { StoreApi } from 'zustand'
import type { ApiCobros } from '@/api'
import type { CobrosKeys } from './claves.ts'
import type { CobrosUi } from './store.ts'

export type IdAmbitoCobros = 'empresa' | 'tenants'

/** Los textos que cambian de un ámbito a otro; el resto de la pantalla habla de "cliente" en los dos. */
export interface TextosAmbito {
  titulo: string
  subtitulo: string
  /** Botón que abre el panel de un cliente para configurar su cobro mensual. */
  botonConfigurar: string
  elegirTitulo: string
  elegirSub: string
  filtrarTitulo: string
  filtrarSub: string
  /** Nota bajo el buscador de clientes de los modales de elegir. */
  elegirNota: string
  /** Placeholder del buscador de tenants. */
  buscarPlaceholder: string
  /** Placeholder de la búsqueda de la tabla de cobros. */
  placeholderFiltro: string
  /** Rótulo del botón de filtro por cliente (y de su chip). */
  chipCliente: string
  /** Texto del filtro de la tabla cuando solo hay un id (sin nombre). */
  filtroSinNombre: (id: number) => string
}

export interface AmbitoCobros {
  id: IdAmbitoCobros
  /** Tiene la pestaña Clientes (el directorio de tenants con su cobro mensual y lo que deben): solo la plataforma. */
  directorio: boolean
  api: ApiCobros
  keys: CobrosKeys
  /** El store de interfaz de ESTE ámbito (filtros, panel, modal). */
  ui: StoreApi<CobrosUi>
  textos: TextosAmbito
}

export const AmbitoCobrosContext = createContext<AmbitoCobros | null>(null)

/** El ámbito de la pantalla en que se pinta. Fuera de una pantalla de Cobros es un error de programación. */
export function useAmbitoCobros(): AmbitoCobros {
  const ambito = useContext(AmbitoCobrosContext)
  if (!ambito) throw new Error('useAmbitoCobros se usó fuera de una pantalla de Cobros.')
  return ambito
}

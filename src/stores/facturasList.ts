// Estado de filtros/paginación del listado de Facturación.
// Vive fuera del componente (Zustand) para sobrevivir a la navegación: al abrir
// una factura y volver, los filtros, la búsqueda y la página siguen aplicados.
import { create } from 'zustand'

export type FacturaEstadoUi = 'aprobado' | 'rechazado' | 'todos'

export interface FacturasListState {
  page: number
  pageSize: number
  /** Texto del buscador (sin confirmar). */
  input: string
  /** Búsqueda confirmada (la que va a la API). */
  query: string
  estado: FacturaEstadoUi
  /** Tipo e-CF con prefijo (`E31`…) o `todos`. */
  tipo: string
  patch: (partial: Partial<Omit<FacturasListState, 'patch'>>) => void
}

export const useFacturasList = create<FacturasListState>((set) => ({
  page: 1,
  pageSize: 10,
  input: '',
  query: '',
  estado: 'aprobado',
  tipo: 'todos',
  patch: (partial) => set(partial),
}))

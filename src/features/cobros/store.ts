// Estado de INTERFAZ de Cobros (Zustand): la pestaña, los filtros, la página, el panel del cliente y el
// modal abierto. Los DATOS no viven aquí: son de TanStack Query (hooks.ts), con su caché y sus
// invalidaciones. Un modal guarda solo ids, nunca una copia de un cobro: si guardara la fila, el saldo
// que muestra el formulario de pago se quedaría viejo mientras otro usuario cobra.
// Imports de valor por ruta relativa con .ts: scripts/test-cobros.ts carga este archivo con `node` tal cual.
// Lo de '@/…' va solo como `import type`, que Node borra.
import { create, useStore, type StateCreator } from 'zustand'
import type { EstadoCobro } from '@/api'
import { useAuthStore } from '../../stores/auth.ts'
import { useAmbitoCobros } from './ambito.ts'

export type TabCobros = 'cobros' | 'recordatorios'
/** Las pestañas del panel del cliente. */
export type PestanaPanel = 'historial' | 'config' | 'recordatorios'

export interface FiltrosCobros {
  /** Búsqueda por nombre del cliente. */
  query: string
  clientId: number | null
  /** Nombre del cliente elegido, solo para mostrarlo en el filtro. */
  clienteNombre: string
  estado: EstadoCobro | ''
  /** AAAA-MM */
  periodo: string
  venceDesde: string
  venceHasta: string
}

export const FILTROS_VACIOS: FiltrosCobros = {
  query: '', clientId: null, clienteNombre: '', estado: '', periodo: '', venceDesde: '', venceHasta: '',
}

/** El modal abierto. `cobroId: null` en 'cobro' = crear uno nuevo. */
export type ModalCobros =
  | { tipo: 'cobro'; cobroId: number | null; clientId: number | null }
  | { tipo: 'pago'; cobroId: number }
  | { tipo: 'cancelar'; cobroId: number }
  | { tipo: 'anular'; pagoId: number; cobroId: number }
  | { tipo: 'recordatorio'; cobroId: number }
  | { tipo: 'elegir-cliente' }
  | { tipo: 'filtrar-cliente' }

export const PAGE_SIZES = [10, 25, 50]

/** Ventanas de "vence pronto" (días) que ofrece la sección Recordatorios; la primera es la de siempre. */
export const VENTANAS_RECORDATORIO = [7, 15, 30]

export interface CobrosUi {
  tab: TabCobros
  filtros: FiltrosCobros
  page: number
  pageSize: number
  /** Cliente cuyo panel (historial) está abierto. */
  panelClienteId: number | null
  /** Pestaña con que se abre el panel (la de configuración si se llegó por "Cobro mensual de un cliente"). */
  panelPestana: PestanaPanel
  /** Ventana (días) de la sección Recordatorios: la usan la propia sección y el contador de la pestaña. */
  recordatoriosDias: number
  modal: ModalCobros | null
  setTab: (tab: TabCobros) => void
  /** Cambia filtros y vuelve a la página 1 (el resultado es otro). */
  setFiltros: (cambios: Partial<FiltrosCobros>) => void
  limpiarFiltros: () => void
  setPage: (page: number) => void
  setPageSize: (n: number) => void
  setRecordatoriosDias: (dias: number) => void
  abrirPanel: (clientId: number, pestana?: PestanaPanel) => void
  cerrarPanel: () => void
  abrirModal: (modal: ModalCobros) => void
  /**
   * Cierra el modal. Con `modal` cierra SOLO si ese es el que sigue abierto: un formulario que termina
   * tarde (su guardado tardó) no puede cerrar otro que la persona abrió mientras tanto.
   */
  cerrarModal: (modal?: ModalCobros) => void
  reset: () => void
}

const INICIAL = {
  tab: 'cobros' as TabCobros,
  filtros: FILTROS_VACIOS,
  page: 1,
  pageSize: PAGE_SIZES[0],
  panelClienteId: null as number | null,
  panelPestana: 'historial' as PestanaPanel,
  recordatoriosDias: VENTANAS_RECORDATORIO[0],
  modal: null as ModalCobros | null,
}

const definirUi: StateCreator<CobrosUi> = (set) => ({
  ...INICIAL,
  setTab: (tab) => set({ tab }),
  setFiltros: (cambios) => set((s) => ({ filtros: { ...s.filtros, ...cambios }, page: 1 })),
  limpiarFiltros: () => set({ filtros: FILTROS_VACIOS, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setRecordatoriosDias: (recordatoriosDias) => set({ recordatoriosDias }),
  abrirPanel: (panelClienteId, pestana = 'historial') => set({ panelClienteId, panelPestana: pestana }),
  cerrarPanel: () => set({ panelClienteId: null }),
  abrirModal: (modal) => set({ modal }),
  cerrarModal: (modal) => set((s) => (modal === undefined || s.modal === modal ? { modal: null } : {})),
  reset: () => set({ ...INICIAL }),
})

/**
 * Un store de interfaz nuevo, en su estado inicial. Hay UNO POR ÁMBITO (ver ambito.ts): los filtros, el cliente del panel
 * y el modal de las empresas no pueden mezclarse con los de la plataforma, que usa ids de otra tabla.
 */
export const crearCobrosUi = () => create<CobrosUi>()(definirUi)
/** El de las empresas (/api/cobros). */
export const cobrosUiEmpresa = crearCobrosUi()
/** El de la plataforma (/api/cobros-tenants). */
export const cobrosUiTenants = crearCobrosUi()

// Los ids de cliente son de UNA empresa: al cambiar de sesión (otra empresa de soporte, otro usuario, cerrar
// sesión) se vuelve al principio, o el panel abriría un cliente de la empresa anterior. Los dos ámbitos.
useAuthStore.subscribe((estado, previo) => {
  if (estado.token !== previo.token) {
    cobrosUiEmpresa.getState().reset()
    cobrosUiTenants.getState().reset()
  }
})

/** El store de interfaz del ámbito en que se pinta (para leer su estado fuera del render: `.getState()`). */
export function useCobrosUiStore() {
  return useAmbitoCobros().ui
}

/** Lee del store del ámbito en que se pinta, como un hook de Zustand: `useCobrosUi((s) => s.filtros)`. */
export function useCobrosUi<T>(selector: (s: CobrosUi) => T): T {
  return useStore(useAmbitoCobros().ui, selector)
}

/** ¿Hay algún filtro puesto (además del orden por defecto)? */
export function hayFiltros(f: FiltrosCobros): boolean {
  return f.query !== '' || f.clientId !== null || f.estado !== '' || f.periodo !== '' || f.venceDesde !== '' || f.venceHasta !== ''
}

// Estado del POS en este equipo.
//
// - El token del EQUIPO se guarda en localStorage (fiscalpoint.pos.equipo):
//   es lo que hace de esta PC "Caja 1". Lo entrega un admin al habilitarla y
//   solo abre /api/pos/*. Borrar los datos del navegador = habilitar de nuevo.
// - La sesion del EMPLEADO vive solo en memoria: recargar la pagina pide el PIN
//   otra vez (docs/specs/pos.md §9.1). Nunca va a localStorage.
// - La sesion del admin que habilita el equipo tampoco se guarda: se usa para
//   habilitar y se cierra (POST /api/auth/signout).
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Caja, Empleado } from './api'
import { useCarritoStore } from './carrito'

export interface EquipoGuardado {
  token: string
  caja: Caja
  /** Nombre de la empresa, para mostrarlo antes de que responda el estado. */
  empresa: string | null
}

interface PosState {
  equipo: EquipoGuardado | null
  /** Sesion del empleado: token + quien es. Solo en memoria. */
  sesion: { token: string; empleado: Empleado } | null
  guardarEquipo: (e: EquipoGuardado) => void
  olvidarEquipo: () => void
  abrirSesion: (token: string, empleado: Empleado) => void
  cerrarSesion: () => void
}

/** localStorage que no rompe en modo privado o con el almacenamiento bloqueado. */
const almacen = createJSONStorage(() => ({
  getItem: (k: string) => {
    try { return localStorage.getItem(k) } catch { return null }
  },
  setItem: (k: string, v: string) => {
    try { localStorage.setItem(k, v) } catch { /* sin almacenamiento: habra que habilitar al recargar */ }
  },
  removeItem: (k: string) => {
    try { localStorage.removeItem(k) } catch { /* idem */ }
  },
}))

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      equipo: null,
      sesion: null,
      guardarEquipo: (equipo) => {
        // Otro equipo (habilitado de nuevo, quiza en otra caja o empresa): la
        // venta en curso y el catalogo eran del anterior.
        if (get().equipo?.token !== equipo.token) useCarritoStore.getState().olvidarTodo()
        set({ equipo })
      },
      // Olvidar el equipo cierra tambien la sesion y descarta la venta: sin equipo no hay caja.
      olvidarEquipo: () => {
        useCarritoStore.getState().olvidarTodo()
        set({ equipo: null, sesion: null })
      },
      abrirSesion: (token, empleado) => set({ sesion: { token, empleado } }),
      cerrarSesion: () => set({ sesion: null }),
    }),
    {
      name: 'fiscalpoint.pos.equipo',
      storage: almacen,
      // Solo el equipo se persiste; la sesion del empleado nunca.
      partialize: (s) => ({ equipo: s.equipo }),
    },
  ),
)

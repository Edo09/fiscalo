// Favoritos del catálogo (la estrella de la tarjeta): de cada empleado en ESTE
// equipo, como sus ventas abiertas. Se guardan en el localStorage de pos.*; si
// no se puede, valen mientras la página siga abierta. Al habilitar el equipo en
// otra caja o empresa se borran (store.ts): los productos serían otros.
import { useMemo } from 'react'
import { create } from 'zustand'
import { alternarFavorito, leerFavoritos } from './catalogoVista'

const CLAVE = 'fiscalpoint.pos.favoritos'

function cargar(): Record<string, number[]> {
  try {
    return leerFavoritos(window.localStorage.getItem(CLAVE))
  } catch {
    return {}
  }
}

function guardar(porEmpleado: Record<string, number[]>): void {
  try {
    if (Object.keys(porEmpleado).length === 0) window.localStorage.removeItem(CLAVE)
    else window.localStorage.setItem(CLAVE, JSON.stringify(porEmpleado))
  } catch {
    // Sin almacenamiento: vale mientras la página siga abierta.
  }
}

interface FavoritosState {
  /** { [empleadoId]: ids de producto, en el orden en que se marcaron }. */
  porEmpleado: Record<string, number[]>
  alternar: (empleadoId: number, productoId: number) => void
  /** Borra los de todos (el equipo cambió de caja o de empresa). */
  olvidar: () => void
}

export const useFavoritosStore = create<FavoritosState>()((set, get) => ({
  porEmpleado: cargar(),
  alternar: (empleadoId, productoId) => {
    const clave = String(empleadoId)
    const ids = alternarFavorito(get().porEmpleado[clave] ?? [], productoId)
    const { [clave]: _anterior, ...resto } = get().porEmpleado
    void _anterior
    const porEmpleado = ids.length > 0 ? { ...resto, [clave]: ids } : resto
    guardar(porEmpleado)
    set({ porEmpleado })
  },
  olvidar: () => {
    guardar({})
    set({ porEmpleado: {} })
  },
}))

const NINGUNO: number[] = []

/** Los favoritos de un empleado, como Set para consultar rápido. */
export function useFavoritos(empleadoId: number): ReadonlySet<number> {
  const ids = useFavoritosStore((s) => s.porEmpleado[String(empleadoId)] ?? NINGUNO)
  return useMemo(() => new Set(ids), [ids])
}

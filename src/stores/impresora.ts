// Impresora de recibos de ESTE equipo (Zustand, persistido en localStorage).
//
// El ancho del rollo es de la impresora conectada a cada caja, no de la empresa:
// un mismo negocio puede tener una caja con térmica de 80 mm y otra con una de
// impacto de 76. Por eso vive en el navegador y no en el backend. Lo leen el
// botón "Imprimir recibo" (para rotularse con el ancho) y el cliente de la API
// (para pedir la tirilla de ese ancho), así que los dos dicen siempre lo mismo.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AnchoTirilla } from '@/api/types'

/** Anchos que genera el backend (ReciboPos::MARGENES), del más común al menos. */
export const ANCHOS_TIRILLA: readonly AnchoTirilla[] = [80, 76, 72]

const ANCHO_POR_DEFECTO: AnchoTirilla = 80

function normalizarAncho(valor: unknown): AnchoTirilla {
  return ANCHOS_TIRILLA.includes(valor as AnchoTirilla) ? (valor as AnchoTirilla) : ANCHO_POR_DEFECTO
}

interface ImpresoraState {
  anchoTirilla: AnchoTirilla
  setAnchoTirilla: (ancho: AnchoTirilla) => void
}

export const useImpresoraStore = create<ImpresoraState>()(
  persist(
    (set) => ({
      anchoTirilla: ANCHO_POR_DEFECTO,
      setAnchoTirilla: (ancho) => set({ anchoTirilla: normalizarAncho(ancho) }),
    }),
    {
      name: 'fiscalo.impresora', // clave en localStorage
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ anchoTirilla: s.anchoTirilla }),
      // Un valor que no es uno de los anchos (editado a mano, o de una versión
      // con otros anchos) pediría un formato que el backend trata como hoja
      // carta: se cae al de 80 mm.
      merge: (guardado, actual) => ({
        ...actual,
        anchoTirilla: normalizarAncho((guardado as Partial<ImpresoraState> | undefined)?.anchoTirilla),
      }),
    },
  ),
)

/** Ancho configurado, para rotular botones (se actualiza al cambiarlo). */
export const useAnchoTirilla = (): AnchoTirilla => useImpresoraStore((s) => s.anchoTirilla)

/** Accesor no-React para el cliente de la API. */
export const getAnchoTirilla = (): AnchoTirilla => useImpresoraStore.getState().anchoTirilla

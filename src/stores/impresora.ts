// Impresora de recibos de ESTE equipo (Zustand, persistido en localStorage).
//
// El ancho del rollo es de la impresora conectada a cada caja, no de la empresa:
// un mismo negocio puede tener una caja con térmica de 80 mm y otra con una de
// impacto de 76. Por eso vive en el navegador y no en el backend. Lo leen el
// botón "Imprimir recibo" (para rotularse con el ancho) y el cliente de la API
// (para pedir la tirilla de ese ancho), así que los dos dicen siempre lo mismo.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AnchoTirilla, ModoImpresion } from '@/api/types'

/** Anchos que genera el backend (ReciboPos::MEDIDAS), del más común al menos. */
export const ANCHOS_TIRILLA: readonly AnchoTirilla[] = [80, 76, 72]

const ANCHO_POR_DEFECTO: AnchoTirilla = 80
const MODO_POR_DEFECTO: ModoImpresion = 'web'

function normalizarAncho(valor: unknown): AnchoTirilla {
  return ANCHOS_TIRILLA.includes(valor as AnchoTirilla) ? (valor as AnchoTirilla) : ANCHO_POR_DEFECTO
}

function normalizarModo(valor: unknown): ModoImpresion {
  return valor === 'pdf' || valor === 'web' ? valor : MODO_POR_DEFECTO
}

interface ImpresoraState {
  anchoTirilla: AnchoTirilla
  /** 'web' mide el recibo y fija el largo del papel; 'pdf' es la alternativa. */
  modoImpresion: ModoImpresion
  setAnchoTirilla: (ancho: AnchoTirilla) => void
  setModoImpresion: (modo: ModoImpresion) => void
}

export const useImpresoraStore = create<ImpresoraState>()(
  persist(
    (set) => ({
      anchoTirilla: ANCHO_POR_DEFECTO,
      modoImpresion: MODO_POR_DEFECTO,
      setAnchoTirilla: (ancho) => set({ anchoTirilla: normalizarAncho(ancho) }),
      setModoImpresion: (modo) => set({ modoImpresion: normalizarModo(modo) }),
    }),
    {
      name: 'fiscalo.impresora', // clave en localStorage
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ anchoTirilla: s.anchoTirilla, modoImpresion: s.modoImpresion }),
      // Un valor que no es uno de los válidos (editado a mano, o de otra
      // versión) pediría un formato que el backend trata como hoja carta: se
      // cae al valor por defecto.
      merge: (guardado, actual) => {
        const g = guardado as Partial<ImpresoraState> | undefined
        return {
          ...actual,
          anchoTirilla: normalizarAncho(g?.anchoTirilla),
          modoImpresion: normalizarModo(g?.modoImpresion),
        }
      },
    },
  ),
)

/** Ancho configurado, para rotular botones (se actualiza al cambiarlo). */
export const useAnchoTirilla = (): AnchoTirilla => useImpresoraStore((s) => s.anchoTirilla)

/** Accesores no-React para el cliente de la API y la impresión. */
export const getAnchoTirilla = (): AnchoTirilla => useImpresoraStore.getState().anchoTirilla
export const getModoImpresion = (): ModoImpresion => useImpresoraStore.getState().modoImpresion

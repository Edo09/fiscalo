// Tamaño de la pantalla del POS (textos, botones, tarjetas): preferencia de
// ESTE equipo, como el tema. En pantallas de poca resolución (1366×768,
// 1280×720) todo se veía grande; en una grande puede quedar chico.
//
// Se aplica con CSS `zoom` sobre .pos-root (pos.css, variable --pos-zoom): las
// medidas del POS están en px, así que escala todo junto y la disposición no se
// rompe. No toca el iframe con el que se imprimen recibos y reportes (está fuera
// de .pos-root): el papel sale siempre igual.
import { create } from 'zustand'

/** Pasos, en %. 100 = el diseño tal cual. */
export const TAMANOS = [80, 90, 100, 110, 120] as const
export type TamanoPos = (typeof TAMANOS)[number]

const CLAVE = 'fiscalpoint.pos.tamano'

export function leerTamano(): TamanoPos {
  try {
    const v = Number(window.localStorage.getItem(CLAVE))
    return (TAMANOS as readonly number[]).includes(v) ? (v as TamanoPos) : 100
  } catch {
    return 100
  }
}

/** Pone el tamaño en <html> (--pos-zoom); antes de pintar, para que no salte. */
export function aplicarTamano(tamano: TamanoPos): void {
  document.documentElement.style.setProperty('--pos-zoom', String(tamano / 100))
}

function guardar(tamano: TamanoPos): void {
  try {
    window.localStorage.setItem(CLAVE, String(tamano))
  } catch {
    // Sin almacenamiento: vale mientras la página siga abierta.
  }
}

interface TamanoState {
  tamano: TamanoPos
  /** Un paso más chico (hasta el 80 %). */
  achicar: () => void
  /** Un paso más grande (hasta el 120 %). */
  agrandar: () => void
  /** Vuelve al 100 %. */
  normal: () => void
}

export const useTamanoPos = create<TamanoState>()((set, get) => {
  const poner = (tamano: TamanoPos) => {
    guardar(tamano)
    aplicarTamano(tamano)
    set({ tamano })
  }
  const paso = (delta: number) => {
    const i = TAMANOS.indexOf(get().tamano) + delta
    if (i >= 0 && i < TAMANOS.length) poner(TAMANOS[i])
  }
  return {
    tamano: leerTamano(),
    achicar: () => paso(-1),
    agrandar: () => paso(1),
    normal: () => poner(100),
  }
})

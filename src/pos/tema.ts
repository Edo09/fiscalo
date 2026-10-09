// Tema del POS: claro (el de siempre) o "gris oscuro". Es preferencia de ESTE
// equipo: se guarda en el localStorage de pos.* (otro dominio que app.*, así que
// no se mezcla con el tema de la app).
//
// El oscuro del POS se monta sobre el modo oscuro del sistema de diseño
// (data-theme="dark", que ya conocen los componentes compartidos) con su propia
// paleta, más clara: data-pos-tema="gris" (ver pos.css, "Tema gris oscuro").
import { create } from 'zustand'

export type TemaPos = 'claro' | 'oscuro'

const CLAVE = 'fiscalpoint.pos.tema'
/** Lo que dura el fundido de colores al cambiar de tema (pos.css, .pos-tema-cambiando). */
const FUNDIDO_MS = 320

export function leerTema(): TemaPos {
  try {
    return window.localStorage.getItem(CLAVE) === 'oscuro' ? 'oscuro' : 'claro'
  } catch {
    return 'claro'
  }
}

/** Pone el tema en <html>. Con `fundir`, los colores pasan de uno a otro en vez de saltar. */
export function aplicarTema(tema: TemaPos, fundir = false): void {
  const html = document.documentElement
  if (fundir && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    html.classList.add('pos-tema-cambiando')
    window.setTimeout(() => html.classList.remove('pos-tema-cambiando'), FUNDIDO_MS)
  }
  if (tema === 'oscuro') {
    html.setAttribute('data-theme', 'dark')
    html.setAttribute('data-pos-tema', 'gris')
  } else {
    html.removeAttribute('data-theme')
    html.removeAttribute('data-pos-tema')
  }
  // Barras de desplazamiento y controles nativos del mismo color que la página.
  html.style.colorScheme = tema === 'oscuro' ? 'dark' : 'light'
}

export const useTemaPos = create<{ tema: TemaPos; alternar: () => void }>()((set, get) => ({
  tema: leerTema(),
  alternar: () => {
    const tema: TemaPos = get().tema === 'oscuro' ? 'claro' : 'oscuro'
    try {
      window.localStorage.setItem(CLAVE, tema)
    } catch {
      // Sin almacenamiento: vale mientras la página siga abierta.
    }
    aplicarTema(tema, true)
    set({ tema })
  },
}))

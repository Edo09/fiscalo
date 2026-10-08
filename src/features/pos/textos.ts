// Textos compartidos de "Punto de venta" (app.*). Aparte de los componentes
// para que react-refresh pueda recargar los .tsx sin perder estado.
import type { PosRol } from '@/api/pos'

export const ROL_LABEL: Record<PosRol, string> = { cajero: 'Cajero', supervisor: 'Supervisor' }

export const ROL_AYUDA: Record<PosRol, string> = {
  cajero: 'Vende y cobra, y abre y cierra su propio turno.',
  supervisor: 'Además autoriza descuentos, cambios de precio, "Varios" y devoluciones, y puede cerrar el turno de otro cajero.',
}

/** 'YYYY-MM-DD HH:MM' (hora del servidor, igual que el resto de la app). */
export const fmtFecha = (f?: string | null): string => (f ? String(f).slice(0, 16).replace('T', ' ') : '—')

// Servicio: reportes fiscales DGII (Formato 606 — compras, 607 — ventas del período).
// Ver docs/reporte-606-frontend.md y docs/reporte-607-frontend.md.
// El período siempre es AAAAMM (6 dígitos).
import { getJson, getBlob, qs } from './http'
import type {
  AgrupacionVentas, FormatoExportacion,
  Reporte606Preview, Reporte607Preview, ReporteVentas,
} from './types'

/** Preview estructurado del 606: registros, totales y advertencias para la tabla. */
export function getReporte606Preview(periodo: string): Promise<Reporte606Preview> {
  return getJson<Reporte606Preview>(`/api/reportes/606/preview${qs({ periodo })}`)
}

/** Descarga el .txt del 606 listo para subir al portal DGII. */
export function downloadReporte606(periodo: string): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/reportes/606${qs({ periodo })}`)
}

/** Preview estructurado del 607 (ventas): registros, totales y advertencias. */
export function getReporte607Preview(periodo: string): Promise<Reporte607Preview> {
  return getJson<Reporte607Preview>(`/api/reportes/607/preview${qs({ periodo })}`)
}

/** Descarga el .txt del 607 listo para subir al portal DGII. */
export function downloadReporte607(periodo: string): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/reportes/607${qs({ periodo })}`)
}

// ---------------------------------------------------------------------------
// Ventas (gestión) — no es un formato DGII: responde "cuánto vendí y a quién".
// Las fechas van en AAAA-MM-DD y el rango incluye los dos extremos.
// ---------------------------------------------------------------------------

export interface VentasParams {
  desde: string
  hasta: string
  agrupar: AgrupacionVentas
}

export function getReporteVentas(p: VentasParams): Promise<ReporteVentas> {
  return getJson<ReporteVentas>(`/api/reportes/ventas${qs({ ...p })}`)
}

/**
 * Mismo reporte para descargar. El PDF trae el membrete del emisor y sale listo
 * para imprimir; el Excel trae los montos como números, para seguir trabajando.
 */
export function downloadReporteVentas(
  p: VentasParams,
  formato: FormatoExportacion,
): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/reportes/ventas${qs({ ...p, format: formato })}`)
}

// Servicio: reportes fiscales DGII (Formato 606 — compras del período).
// Ver docs/reporte-606-frontend.md. El período siempre es AAAAMM (6 dígitos).
import { getJson, getBlob, qs } from './http'
import type { Reporte606Preview } from './types'

/** Preview estructurado del 606: registros, totales y advertencias para la tabla. */
export function getReporte606Preview(periodo: string): Promise<Reporte606Preview> {
  return getJson<Reporte606Preview>(`/api/reportes/606/preview${qs({ periodo })}`)
}

/** Descarga el .txt del 606 listo para subir al portal DGII. */
export function downloadReporte606(periodo: string): Promise<{ blob: Blob; filename: string }> {
  return getBlob(`/api/reportes/606${qs({ periodo })}`)
}

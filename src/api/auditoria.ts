// Servicio: bitácora de auditoría (GET /api/audit-logs). Solo lectura y solo
// para el rol admin; el backend filtra siempre por la empresa del usuario.
import { getJson, getList, qs } from './http'
import type { AuditFacetas, AuditLogFiltros, AuditLogRow, AuditResumen, ListResult } from './types'

function paramsFiltros(f: AuditLogFiltros): Record<string, string | number | undefined> {
  return {
    from: f.desde,
    to: f.hasta,
    user_id: f.userId,
    module: f.modulo,
    action: f.accion,
    success: f.resultado === 'exito' ? 1 : f.resultado === 'fallo' ? 0 : undefined,
    q: f.texto,
  }
}

export function listAuditLogs(f: AuditLogFiltros & { page?: number; pageSize?: number }): Promise<ListResult<AuditLogRow>> {
  return getList<AuditLogRow>(`/api/audit-logs${qs({ ...paramsFiltros(f), page: f.page, pageSize: f.pageSize })}`)
}

/** Tarjetas del encabezado: mismos filtros que la lista. */
export function getAuditResumen(f: AuditLogFiltros): Promise<AuditResumen> {
  return getJson<AuditResumen>(`/api/audit-logs/resumen${qs(paramsFiltros(f))}`)
}

/** Módulos, acciones y usuarios que tienen registros (para los filtros). */
export function getAuditFacetas(): Promise<AuditFacetas> {
  return getJson<AuditFacetas>('/api/audit-logs/facetas')
}

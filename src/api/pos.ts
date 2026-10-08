// Servicio: administración del POS desde app.* (/api/pos-admin/*, módulo `pos`).
// Contrato: api-gratex docs/api/pos.md. El POS (pos.fiscalpoint.com.do) solo
// vende; cajas, empleados con PIN y equipos se administran aquí.
//
// El PIN de un empleado llega UNA sola vez (al crearlo o al generar uno nuevo):
// el API no lo puede volver a mostrar, solo reemplazar.
import { getJson, postJson, request } from './http'

export interface PosCaja {
  id: number
  nombre: string
  activa: boolean
  created_at: string
  updated_at: string
}

export type PosRol = 'cajero' | 'supervisor'

export interface PosEmpleado {
  id: number
  nombre: string
  rol: PosRol
  activo: boolean
  /** Cuándo se generó su PIN actual. */
  pin_generado_at: string
  created_at: string
  updated_at: string
}

export interface PosEquipo {
  id: number
  caja_id: number
  caja: PosCaja | null
  nombre: string | null
  created_at: string
  last_used: string | null
  bloqueado: boolean
  bloqueo_segundos: number
  habilitado_por: number | null
  habilitado_por_nombre: string | null
}

function jsonInit(method: 'PUT' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
}

// --- Cajas -----------------------------------------------------------------
export async function listPosCajas(): Promise<PosCaja[]> {
  return (await getJson<{ cajas: PosCaja[] }>('/api/pos-admin/cajas')).cajas
}
export async function crearPosCaja(nombre: string): Promise<PosCaja> {
  return (await postJson<{ caja: PosCaja }>('/api/pos-admin/cajas', { nombre })).caja
}
export async function actualizarPosCaja(id: number, campos: { nombre?: string; activa?: boolean }): Promise<PosCaja> {
  return (await request<{ caja: PosCaja }>(`/api/pos-admin/cajas/${id}`, jsonInit('PUT', campos))).caja
}

// --- Empleados ---------------------------------------------------------------
export async function listPosEmpleados(): Promise<PosEmpleado[]> {
  return (await getJson<{ empleados: PosEmpleado[] }>('/api/pos-admin/empleados')).empleados
}
/** Crea el empleado; el PIN generado se ve solo en esta respuesta. */
export function crearPosEmpleado(nombre: string, rol: PosRol): Promise<{ empleado: PosEmpleado; pin: string }> {
  return postJson('/api/pos-admin/empleados', { nombre, rol })
}
export async function actualizarPosEmpleado(
  id: number,
  campos: { nombre?: string; rol?: PosRol; activo?: boolean },
): Promise<PosEmpleado> {
  return (await request<{ empleado: PosEmpleado }>(`/api/pos-admin/empleados/${id}`, jsonInit('PUT', campos))).empleado
}
/** PIN nuevo: el anterior deja de servir y sus sesiones se cierran. */
export function regenerarPosPin(id: number): Promise<{ empleado: PosEmpleado; pin: string }> {
  return postJson(`/api/pos-admin/empleados/${id}/pin`, {})
}

// --- Equipos -----------------------------------------------------------------
export async function listPosEquipos(): Promise<PosEquipo[]> {
  return (await getJson<{ equipos: PosEquipo[] }>('/api/pos-admin/equipos')).equipos
}
/** Revoca un equipo: deja de funcionar como caja y sus sesiones se cierran. */
export function revocarPosEquipo(id: number): Promise<unknown> {
  return request(`/api/pos-admin/equipos/${id}`, jsonInit('DELETE'))
}

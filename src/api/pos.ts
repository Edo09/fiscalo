// Servicio: administración del POS desde app.* (/api/pos-admin/*, módulo `pos`).
// Contrato: api-gratex docs/api/pos.md. El POS (pos.fiscalpoint.com.do) solo
// vende; cajas, empleados con PIN y equipos se administran aquí.
//
// El PIN de un empleado llega UNA sola vez (al crearlo o al generar uno nuevo):
// el API no lo puede volver a mostrar, solo reemplazar. Los usuarios de FiscalPoint
// son empleados del POS por defecto (A5b) y eligen su propio PIN al entrar al POS: el
// API no se lo genera ni lo muestra; el administrador solo puede restablecerlo.
import { getJson, postJson, request } from './http'
import type { ReporteCierre } from '@/pos/api'

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
  /**
   * Id del usuario de FiscalPoint del que es empleado (se crea solo: todo usuario de la empresa lo es);
   * null = lo creó un administrador a mano, sin usuario. Ausente con un API viejo.
   */
  usuario_id?: number | null
  /** Usuario de FiscalPoint que todavía no creó su PIN: lo crea la primera vez que entra al POS. Ausente con un API viejo. */
  pin_pendiente?: boolean
  /** Cuándo se generó (o se creó) su PIN actual; null mientras está pendiente. */
  pin_generado_at: string | null
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
/** Lo que cambió al poner los empleados al día con los usuarios de FiscalPoint de la empresa. */
export interface ResumenSincronizacionPos {
  creados: number
  renombrados: number
  desactivados: number
}
/**
 * Todo usuario de FiscalPoint de la empresa es empleado del POS (con el PIN pendiente hasta que lo cree al
 * entrar): crea los que faltan, sigue los cambios de nombre y desactiva a los usuarios que ya no existen.
 * Se puede repetir sin efecto.
 */
export function sincronizarPosEmpleados(): Promise<ResumenSincronizacionPos> {
  return postJson('/api/pos-admin/empleados/sincronizar', {})
}
/** La lista de empleados puesta al día con los usuarios. Si ponerla al día falla, se lista lo que haya. */
export async function listPosEmpleadosAlDia(): Promise<PosEmpleado[]> {
  try {
    await sincronizarPosEmpleados()
  } catch {
    /* se lista lo que hay: la lista es lo que importa */
  }
  return listPosEmpleados()
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
/**
 * PIN nuevo de un empleado creado a mano: el anterior deja de servir y sus sesiones se cierran.
 * A un usuario de FiscalPoint no se le genera nada (el administrador no debe conocer su PIN): se le
 * restablece, `pin` viene null y él crea otro la próxima vez que entra al POS.
 */
export function regenerarPosPin(id: number): Promise<{ empleado: PosEmpleado; pin: string | null }> {
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

// --- Turnos (cierres de caja, K8) -------------------------------------------------
export interface PosTurno {
  id: number
  caja_id: number
  caja_nombre: string | null
  empleado_id: number
  empleado_nombre: string | null
  abierto: boolean
  abierto_at: string
  cerrado_at: string | null
  /** Empleado que contó: el del turno, o un supervisor si era de otro. */
  cerrado_por: number | null
  cerrado_por_nombre: string | null
  fondo_inicial: number
  efectivo_esperado: number | null
  efectivo_contado: number | null
  /** contado − esperado: + sobra, − falta. */
  diferencia: number | null
  nota: string | null
}

export interface FiltrosTurnos {
  caja_id?: number
  empleado_id?: number
  /** AAAA-MM-DD (fecha de apertura). */
  desde?: string
  hasta?: string
}

export async function listPosTurnos(f: FiltrosTurnos = {}): Promise<PosTurno[]> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== null) q.set(k, String(v))
  const qs = q.toString()
  return (await getJson<{ turnos: PosTurno[] }>(`/api/pos-admin/turnos${qs ? `?${qs}` : ''}`)).turnos
}

/** El turno y la foto de su cierre (null si sigue abierto): lo mismo que se imprimió al cerrar. */
export function getPosTurno(id: number): Promise<{ turno: PosTurno; reporte: ReporteCierre | null }> {
  return getJson(`/api/pos-admin/turnos/${id}`)
}

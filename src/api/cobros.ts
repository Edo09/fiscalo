// Servicio: Cobros (cuentas por cobrar por cliente) — /api/cobros.
// Contrato y reglas: api-gratex docs/modules/cobros.md. Cada respuesta se valida con su esquema Zod
// (src/api/schemas/cobros.ts): si el servidor cambia de forma, falla aquí con un texto claro y no
// más adelante con un "undefined" en pantalla.
import type { z } from 'zod'
import { ApiError } from './errores'
import { getJson, getList, qs, request } from './http'
import type { ListResult } from './types'
import {
  cobroActualizadoSchema, cobroDetalleSchema, cobroSchema, configCobroSchema, pagoAnuladoSchema, pagoResultadoSchema,
  panelClienteSchema, recordatorioResultadoSchema, recordatoriosCobrosSchema, resumenCobrosSchema,
  type Cobro, type CobroActualizado, type CobroDetalle, type ConfigCobro, type EstadoCobro, type MetodoPago,
  type PagoAnulado, type PagoResultado, type PanelCliente, type RecordatorioResultado, type RecordatoriosCobros,
  type ResumenCobros, type CanalRecordatorio,
} from './schemas/cobros'

const MSG_RESPUESTA = 'Recibimos del servidor una respuesta que no entendemos. Actualiza la página e inténtalo de nuevo; si sigue pasando, avisa a soporte.'

/** Valida lo que mandó el servidor; si no encaja, un ApiError con texto claro (el detalle va a la consola). */
function parsear<T extends z.ZodType>(schema: T, datos: unknown, que: string): z.infer<T> {
  const r = schema.safeParse(datos)
  if (r.success) return r.data
  const i = r.error.issues[0]
  console.error('[cobros] respuesta inesperada de', que, r.error.issues.slice(0, 5))
  throw new ApiError(MSG_RESPUESTA, 200, { original: `${que}: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`.trim() })
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enviar = (path: string, method: 'POST' | 'PUT', cuerpo: unknown) =>
  request<unknown>(path, { method, headers: JSON_HEADERS, body: JSON.stringify(cuerpo ?? {}) })

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export interface ListarCobrosParams {
  page?: number
  pageSize?: number
  /** Búsqueda por nombre del cliente (o RNC). */
  query?: string
  client_id?: number
  estado?: EstadoCobro
  /** AAAA-MM */
  periodo?: string
  vence_desde?: string
  vence_hasta?: string
  orden?: 'urgencia' | 'vencimiento_asc' | 'vencimiento_desc' | 'saldo_desc'
}

/** Cobros paginados, con filtros. El orden por defecto es el de urgencia (lo más atrasado primero). */
export async function listCobros(params: ListarCobrosParams = {}): Promise<ListResult<Cobro>> {
  const res = await getList<unknown>(`/api/cobros${qs({ ...params })}`)
  return { ...res, items: res.items.map((i) => parsear(cobroSchema, i, 'GET /api/cobros')) }
}

/** El dashboard: totales, antigüedad, próximos vencimientos y clientes con atraso. `dias` = ventana de "vence pronto". */
export async function getResumenCobros(dias?: number): Promise<ResumenCobros> {
  return parsear(resumenCobrosSchema, await getJson<unknown>(`/api/cobros/resumen${qs({ dias })}`), 'GET /api/cobros/resumen')
}

/** A quién recordarle: cobros vencidos o que vencen en `dias` días, con su último recordatorio. */
export async function getRecordatoriosCobros(params: { dias?: number; cada?: number } = {}): Promise<RecordatoriosCobros> {
  return parsear(recordatoriosCobrosSchema, await getJson<unknown>(`/api/cobros/recordatorios${qs({ ...params })}`), 'GET /api/cobros/recordatorios')
}

/** El panel de un cliente: configuración mensual, resumen, todos sus cobros con sus pagos y sus recordatorios. */
export async function getClienteCobros(clientId: number): Promise<PanelCliente> {
  return parsear(panelClienteSchema, await getJson<unknown>(`/api/cobros/clientes/${clientId}`), `GET /api/cobros/clientes/${clientId}`)
}

/** Un cobro con sus pagos (vigentes y anulados) y sus recordatorios. */
export async function getCobro(id: number): Promise<CobroDetalle> {
  return parsear(cobroDetalleSchema, await getJson<unknown>(`/api/cobros/${id}`), `GET /api/cobros/${id}`)
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export interface ConfigCobroInput {
  monto_mensual: number
  /** 1 a 31; en un mes más corto vence el último día. */
  dia_vencimiento: number
  descripcion?: string
  activo: boolean
}

/** Monto mensual y día de vencimiento de un cliente. No toca los cobros que ya existen. */
export async function guardarConfigCobro(clientId: number, input: ConfigCobroInput): Promise<ConfigCobro> {
  return parsear(configCobroSchema, await enviar(`/api/cobros/clientes/${clientId}/config`, 'PUT', input), 'PUT config')
}

export interface NuevoCobroInput {
  client_id: number
  periodo?: string
  fecha_vencimiento?: string
  monto?: number
  descripcion?: string
}

/** Crea un cobro a mano. Un cobro del mismo cliente y periodo ya existente da 409 (codigo COBRO_DUPLICADO). */
export async function createCobro(input: NuevoCobroInput): Promise<CobroDetalle> {
  return parsear(cobroDetalleSchema, await enviar('/api/cobros', 'POST', input), 'POST /api/cobros')
}

export interface CambiosCobroInput {
  monto?: number
  fecha_vencimiento?: string
  /** '' vacía la descripción. */
  descripcion?: string
}

/** Cambia el monto, el vencimiento o la descripción. Si el cambio lo deja pagado completo, trae el cobro que se generó. */
export async function updateCobro(id: number, cambios: CambiosCobroInput): Promise<CobroActualizado> {
  return parsear(cobroActualizadoSchema, await enviar(`/api/cobros/${id}`, 'PUT', cambios), `PUT /api/cobros/${id}`)
}

export interface PagoInput {
  monto: number
  /** AAAA-MM-DD; sin ella, hoy. */
  fecha_pago?: string
  metodo: MetodoPago
  observaciones?: string
  /** UUID de este intento: repetir la petición con la misma clave no registra otro pago. */
  idempotency_key: string
}

/** Registra un pago, completo o parcial. Si completa el cobro, el servidor genera el del mes siguiente. */
export async function registrarPagoCobro(cobroId: number, input: PagoInput): Promise<PagoResultado> {
  return parsear(pagoResultadoSchema, await enviar(`/api/cobros/${cobroId}/pagos`, 'POST', input), 'POST pagos')
}

/** Cancela un cobro (nunca se borra). Uno con pagos vigentes da 409: hay que anular el pago antes. */
export async function cancelarCobro(id: number, motivo?: string): Promise<CobroDetalle> {
  return parsear(cobroDetalleSchema, await enviar(`/api/cobros/${id}/cancelar`, 'POST', { motivo }), 'POST cancelar')
}

/** Reabre un cobro cancelado. */
export async function reabrirCobro(id: number): Promise<CobroDetalle> {
  return parsear(cobroDetalleSchema, await enviar(`/api/cobros/${id}/reabrir`, 'POST', {}), 'POST reabrir')
}

export interface RecordatorioInput {
  /** AAAA-MM-DD HH:MM:SS (hora de RD); sin ella, ahora. */
  fecha_hora?: string
  canal: CanalRecordatorio
  nota?: string
}

/** Anota un recordatorio que alguien hizo a mano. La app no envía nada. */
export async function registrarRecordatorioCobro(cobroId: number, input: RecordatorioInput): Promise<RecordatorioResultado> {
  return parsear(recordatorioResultadoSchema, await enviar(`/api/cobros/${cobroId}/recordatorios`, 'POST', input), 'POST recordatorios')
}

/** Anula un pago: deja de contar en el saldo, pero se queda a la vista con su motivo. */
export async function anularPagoCobro(pagoId: number, motivo?: string): Promise<PagoAnulado> {
  return parsear(pagoAnuladoSchema, await enviar(`/api/cobros/pagos/${pagoId}/anular`, 'POST', { motivo }), 'POST anular')
}

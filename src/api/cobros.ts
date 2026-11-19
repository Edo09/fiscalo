// Servicio: Cobros (cuentas por cobrar por cliente) — /api/cobros y /api/cobros-tenants.
// Contrato y reglas: api-gratex docs/modules/cobros.md. Cada respuesta se valida con su esquema Zod
// (src/api/schemas/cobros.ts): si el servidor cambia de forma, falla aquí con un texto claro y no
// más adelante con un "undefined" en pantalla.
//
// DOS ámbitos, el mismo servicio: `apiCobros` (cada empresa cobra a sus clientes, /api/cobros) y `apiCobrosTenants` (la
// plataforma cobra a sus tenants, /api/cobros-tenants, solo cuentas de soporte). Las rutas salen de rutas-cobros.ts.
// Las funciones sueltas de siempre (`listCobros`…) son las del ámbito de empresa.
import type { z } from 'zod'
import { ApiError } from './errores'
import { getJson, getList, request } from './http'
import { BASE_COBROS, BASE_COBROS_TENANTS, rutasCobros } from './rutas-cobros'
import type { ListResult } from './types'
import {
  cobroActualizadoSchema, cobroDetalleSchema, cobroSchema, configCobroSchema, pagoAnuladoSchema, pagoResultadoSchema,
  exclusionResultadoSchema, panelClienteSchema, recordatorioResultadoSchema, recordatoriosCobrosSchema, resumenCobrosSchema, tenantsBuscadosSchema,
  type Cobro, type CobroActualizado, type CobroDetalle, type ConfigCobro, type EstadoCobro, type MetodoPago,
  type PagoAnulado, type PagoResultado, type PanelCliente, type RecordatorioResultado, type RecordatoriosCobros,
  type ResumenCobros, type CanalRecordatorio, type ExclusionResultado, type TenantBuscado,
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
// Entradas
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

export interface ConfigCobroInput {
  monto_mensual: number
  /** 1 a 31; en un mes más corto vence el último día. */
  dia_vencimiento: number
  descripcion?: string
  activo: boolean
}

export interface NuevoCobroInput {
  client_id: number
  periodo?: string
  fecha_vencimiento?: string
  monto?: number
  descripcion?: string
}

export interface CambiosCobroInput {
  monto?: number
  fecha_vencimiento?: string
  /** '' vacía la descripción. */
  descripcion?: string
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

export interface RecordatorioInput {
  /** AAAA-MM-DD HH:MM:SS (hora de RD); sin ella, ahora. */
  fecha_hora?: string
  canal: CanalRecordatorio
  nota?: string
}

// ---------------------------------------------------------------------------
// El servicio de un ámbito
// ---------------------------------------------------------------------------

/** Todo lo que se le pide a la API de Cobros, para un ámbito (una base de rutas). */
export interface ApiCobros {
  /** Cobros paginados, con filtros. El orden por defecto es el de urgencia (lo más atrasado primero). */
  listCobros(params?: ListarCobrosParams): Promise<ListResult<Cobro>>
  /** El dashboard: totales, antigüedad, próximos vencimientos y clientes con atraso. `dias` = ventana de "vence pronto". */
  getResumenCobros(dias?: number): Promise<ResumenCobros>
  /** A quién recordarle: cobros vencidos o que vencen en `dias` días, con su último recordatorio. */
  getRecordatoriosCobros(params?: { dias?: number; cada?: number }): Promise<RecordatoriosCobros>
  /** El panel de un cliente: configuración mensual, resumen, todos sus cobros con sus pagos y sus recordatorios. */
  getClienteCobros(clientId: number): Promise<PanelCliente>
  /** Un cobro con sus pagos (vigentes y anulados) y sus recordatorios. */
  getCobro(id: number): Promise<CobroDetalle>
  /**
   * El directorio de tenants, por nombre o RNC (los activos primero), con su cobro mensual y lo que deben: una fila por unidad
   * de cobro (un grupo de empresas es la fila de su cabeza). Solo salen las que se cobran (`facturable`); con `conExcluidos`
   * salen también las que no (marcadas "no es un cliente" o que solo certificaron, cada una con su `motivo_oculto`). SOLO existe
   * en la plataforma (/api/cobros-tenants): en el ámbito de una empresa el buscador es el de Clientes y esta ruta da 404.
   */
  buscarTenants(query?: string, limite?: number, conExcluidos?: boolean): Promise<TenantBuscado[]>
  /**
   * Quita a un tenant de la lista de clientes (`excluido: true`, con su motivo si se quiere) o lo devuelve (`false`). No borra nada.
   * Con cobros abiertos o su cobro mensual activo da 409 (codigo TIENE_COBROS_ABIERTOS / CONFIG_ACTIVA). Solo en la plataforma.
   */
  excluirTenant(clientId: number, excluido: boolean, motivo?: string): Promise<ExclusionResultado>
  /** Monto mensual y día de vencimiento de un cliente. No toca los cobros que ya existen. */
  guardarConfigCobro(clientId: number, input: ConfigCobroInput): Promise<ConfigCobro>
  /** Crea un cobro a mano. Un cobro del mismo cliente y periodo ya existente da 409 (codigo COBRO_DUPLICADO). */
  createCobro(input: NuevoCobroInput): Promise<CobroDetalle>
  /** Cambia el monto, el vencimiento o la descripción. Si el cambio lo deja pagado completo, trae el cobro que se generó. */
  updateCobro(id: number, cambios: CambiosCobroInput): Promise<CobroActualizado>
  /** Registra un pago, completo o parcial. Si completa el cobro, el servidor genera el del mes siguiente. */
  registrarPagoCobro(cobroId: number, input: PagoInput): Promise<PagoResultado>
  /** Cancela un cobro (nunca se borra). Uno con pagos vigentes da 409: hay que anular el pago antes. */
  cancelarCobro(id: number, motivo?: string): Promise<CobroDetalle>
  /** Reabre un cobro cancelado. */
  reabrirCobro(id: number): Promise<CobroDetalle>
  /** Anota un recordatorio que alguien hizo a mano. La app no envía nada. */
  registrarRecordatorioCobro(cobroId: number, input: RecordatorioInput): Promise<RecordatorioResultado>
  /** Anula un pago: deja de contar en el saldo, pero se queda a la vista con su motivo. */
  anularPagoCobro(pagoId: number, motivo?: string): Promise<PagoAnulado>
}

/** El servicio de Cobros para una base de rutas: '/api/cobros' (empresa) o '/api/cobros-tenants' (plataforma). */
export function crearApiCobros(base: string): ApiCobros {
  const r = rutasCobros(base)
  return {
    async listCobros(params = {}) {
      const res = await getList<unknown>(r.lista({ ...params }))
      return { ...res, items: res.items.map((i) => parsear(cobroSchema, i, `GET ${base}`)) }
    },
    async getResumenCobros(dias) {
      return parsear(resumenCobrosSchema, await getJson<unknown>(r.resumen(dias)), `GET ${base}/resumen`)
    },
    async getRecordatoriosCobros(params = {}) {
      return parsear(recordatoriosCobrosSchema, await getJson<unknown>(r.recordatorios(params)), `GET ${base}/recordatorios`)
    },
    async getClienteCobros(clientId) {
      return parsear(panelClienteSchema, await getJson<unknown>(r.cliente(clientId)), `GET ${base}/clientes/${clientId}`)
    },
    async getCobro(id) {
      return parsear(cobroDetalleSchema, await getJson<unknown>(r.cobro(id)), `GET ${base}/${id}`)
    },
    async buscarTenants(query, limite, conExcluidos) {
      return parsear(tenantsBuscadosSchema, await getJson<unknown>(r.buscar(query, limite, conExcluidos)), `GET ${base}/clientes`)
    },
    async excluirTenant(clientId, excluido, motivo) {
      return parsear(exclusionResultadoSchema, await enviar(r.excluido(clientId), 'PUT', { excluido, motivo }), 'PUT excluido')
    },
    async guardarConfigCobro(clientId, input) {
      return parsear(configCobroSchema, await enviar(r.config(clientId), 'PUT', input), 'PUT config')
    },
    async createCobro(input) {
      return parsear(cobroDetalleSchema, await enviar(base, 'POST', input), `POST ${base}`)
    },
    async updateCobro(id, cambios) {
      return parsear(cobroActualizadoSchema, await enviar(r.cobro(id), 'PUT', cambios), `PUT ${base}/${id}`)
    },
    async registrarPagoCobro(cobroId, input) {
      return parsear(pagoResultadoSchema, await enviar(r.pagos(cobroId), 'POST', input), 'POST pagos')
    },
    async cancelarCobro(id, motivo) {
      return parsear(cobroDetalleSchema, await enviar(r.cancelar(id), 'POST', { motivo }), 'POST cancelar')
    },
    async reabrirCobro(id) {
      return parsear(cobroDetalleSchema, await enviar(r.reabrir(id), 'POST', {}), 'POST reabrir')
    },
    async registrarRecordatorioCobro(cobroId, input) {
      return parsear(recordatorioResultadoSchema, await enviar(r.recordatorio(cobroId), 'POST', input), 'POST recordatorios')
    },
    async anularPagoCobro(pagoId, motivo) {
      return parsear(pagoAnuladoSchema, await enviar(r.anularPago(pagoId), 'POST', { motivo }), 'POST anular')
    },
  }
}

/** Cobros de cada empresa a SUS clientes (/api/cobros). */
export const apiCobros = crearApiCobros(BASE_COBROS)
/** Cobros de la plataforma a sus tenants (/api/cobros-tenants): solo cuentas de soporte (acceso global). */
export const apiCobrosTenants = crearApiCobros(BASE_COBROS_TENANTS)

// Las funciones de siempre: las del ámbito de empresa.
export const {
  listCobros, getResumenCobros, getRecordatoriosCobros, getClienteCobros, getCobro, guardarConfigCobro, createCobro,
  updateCobro, registrarPagoCobro, cancelarCobro, reabrirCobro, registrarRecordatorioCobro, anularPagoCobro,
} = apiCobros

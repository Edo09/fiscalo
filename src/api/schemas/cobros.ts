// Esquemas Zod de Cobros (api-gratex docs/modules/cobros.md): la forma de las respuestas de
// /api/cobros y las reglas de los formularios. Los tipos se INFIEREN de aquí (fuente única).
//
// Todo lo que no es de React vive en este archivo y se prueba sin navegador
// (scripts/test-cobros.ts): el dinero se maneja en CENTAVOS enteros —nunca float— y las
// reglas de cada formulario espejan las del servidor, para decirle al usuario lo que está mal
// antes de enviar (el servidor valida igual y manda).
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/** Estados de un cobro. Se DERIVAN en el servidor (saldo, vencimiento y hoy): no se guardan. */
export const ESTADOS_COBRO = ['Pendiente', 'Parcial', 'Vencido', 'Pagado', 'Cancelado'] as const
export type EstadoCobro = (typeof ESTADOS_COBRO)[number]

/** Medios de pago del módulo. */
export const METODOS_PAGO = ['efectivo', 'transferencia'] as const
export type MetodoPago = (typeof METODOS_PAGO)[number]
export const ETIQUETA_METODO: Record<MetodoPago, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia' }

/** Cómo se hizo un recordatorio. Es solo un registro: la app no envía nada. */
export const CANALES_RECORDATORIO = ['llamada', 'mensaje', 'correo', 'visita', 'otro'] as const
export type CanalRecordatorio = (typeof CANALES_RECORDATORIO)[number]
export const ETIQUETA_CANAL: Record<CanalRecordatorio, string> = {
  llamada: 'Llamada', mensaje: 'Mensaje', correo: 'Correo', visita: 'Visita', otro: 'Otro',
}

/** Por qué el pago (o el cambio) que completó un cobro generó, o no, el del mes siguiente. */
export const MOTIVOS_SIGUIENTE = ['generado', 'sin_config', 'inactivo', 'ya_existia'] as const
export type MotivoSiguiente = (typeof MOTIVOS_SIGUIENTE)[number]

/** Lo que cabe en DECIMAL(12,2): 9,999,999,999.99 en centavos. */
export const MAX_CENTAVOS = 999_999_999_999
export const MAX_DESCRIPCION = 150
export const MAX_TEXTO = 255

// ---------------------------------------------------------------------------
// Respuestas de la API
// ---------------------------------------------------------------------------

export const clienteCobroSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  contacto: z.string(),
  empresa: z.string(),
  rnc: z.string(),
  email: z.string(),
  telefono: z.string(),
})
export type ClienteCobro = z.infer<typeof clienteCobroSchema>

export const pagoCobroSchema = z.object({
  id: z.number(),
  cobro_id: z.number(),
  monto: z.number(),
  fecha_pago: z.string(),
  metodo: z.enum(METODOS_PAGO),
  observaciones: z.string().nullable(),
  anulado: z.boolean(),
  anulado_at: z.string().nullable(),
  motivo_anulacion: z.string().nullable(),
  created_at: z.string(),
})
export type PagoCobro = z.infer<typeof pagoCobroSchema>

export const recordatorioCobroSchema = z.object({
  id: z.number(),
  cobro_id: z.number(),
  periodo: z.string(),
  fecha_hora: z.string(),
  canal: z.string(),
  nota: z.string().nullable(),
  usuario: z.string().nullable(),
  created_at: z.string(),
})
export type RecordatorioCobro = z.infer<typeof recordatorioCobroSchema>

/** Un cobro tal como lo lista la API, con su estado ya derivado. */
export const cobroSchema = z.object({
  id: z.number(),
  client_id: z.number(),
  cliente: clienteCobroSchema,
  /** Mes del cobro, AAAA-MM. */
  periodo: z.string(),
  descripcion: z.string().nullable(),
  monto: z.number(),
  monto_pagado: z.number(),
  /** Lo que falta por cobrar (0 si está pagado o cancelado). */
  saldo: z.number(),
  fecha_vencimiento: z.string(),
  estado: z.enum(ESTADOS_COBRO),
  /** Días de atraso: solo en un cobro Vencido (0 en los demás). */
  dias_atraso: z.number(),
  /** Días que faltan para vencer: en uno abierto que aún no vence (0 = vence hoy). */
  dias_para_vencer: z.number().nullable(),
  /** Tiene pagos vigentes (un Vencido con abonos sigue Vencido). */
  con_abonos: z.boolean(),
  cancelado_at: z.string().nullable(),
  motivo_cancelacion: z.string().nullable(),
  generado_de_cobro_id: z.number().nullable(),
  ultimo_pago: z.string().nullable(),
  ultimo_recordatorio: z.string().nullable(),
  recordatorios: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
})
export type Cobro = z.infer<typeof cobroSchema>

export const cobroConPagosSchema = cobroSchema.extend({ pagos: z.array(pagoCobroSchema) })
export type CobroConPagos = z.infer<typeof cobroConPagosSchema>

/** Un cobro con todo su historial (GET /api/cobros/{id}). */
export const cobroDetalleSchema = cobroConPagosSchema.extend({
  recordatorios_lista: z.array(recordatorioCobroSchema),
  /** Cobros que se generaron al quedar pagado este. */
  genero: z.array(z.object({ id: z.number(), periodo: z.string() })),
})
export type CobroDetalle = z.infer<typeof cobroDetalleSchema>

export const configCobroSchema = z.object({
  client_id: z.number(),
  monto_mensual: z.number(),
  dia_vencimiento: z.number(),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
  updated_at: z.string().nullable(),
})
export type ConfigCobro = z.infer<typeof configCobroSchema>

/**
 * Un tenant del DIRECTORIO de la plataforma (GET /api/cobros-tenants/clientes): lo de un cliente (el nombre del tenant
 * hace de nombre, contacto y empresa; el correo es el de su primer admin), qué es, su cobro mensual y lo que debe.
 * Lo usan el buscador de los formularios y la pestaña Clientes de Cobros de tenants.
 */
export const tenantBuscadoSchema = clienteCobroSchema.extend({
  /** 'app' (con base propia) o 'integracion' (sin ella). */
  tipo: z.string(),
  /** Ambiente DGII: ecf (producción), certecf (certificación), testecf. */
  ambiente: z.string(),
  activo: z.boolean(),
  /** Ya tiene su cobro mensual configurado (resume `config`). */
  con_config: z.boolean(),
  /** Su cobro mensual; null si no tiene. */
  config: configCobroSchema.nullable(),
  /** Todo lo abierto que debe (un cobro pagado o cancelado no suma). */
  saldo_pendiente: z.number(),
  /** Lo que ya pasó su vencimiento. */
  saldo_vencido: z.number(),
  cobros_abiertos: z.number(),
  cobros_vencidos: z.number(),
  /** Días de atraso del cobro vencido más viejo (0 si nada está vencido). */
  dias_atraso: z.number(),
  /** El primer vencimiento que aún no pasó (hoy cuenta como "aún no"); null si no hay. */
  proximo_vencimiento: z.string().nullable(),
})
export type TenantBuscado = z.infer<typeof tenantBuscadoSchema>
export const tenantsBuscadosSchema = z.array(tenantBuscadoSchema)

export const resumenCobrosSchema = z.object({
  /** La fecha de RD del servidor, AAAA-MM-DD. */
  hoy: z.string(),
  /** La fecha y hora de RD del servidor, 'AAAA-MM-DD HH:MM:SS' (el navegador puede estar en otra zona horaria). */
  ahora: z.string(),
  mes: z.string(),
  dias: z.number(),
  totales: z.object({
    pendiente: z.number(),
    vencido: z.number(),
    por_vencer: z.number(),
    cobrado_mes: z.number(),
    por_cobrar_mes: z.number(),
    facturado_mes: z.number(),
    cobros_abiertos: z.number(),
    cobros_vencidos: z.number(),
    clientes_con_saldo: z.number(),
    clientes_con_atraso: z.number(),
  }),
  antiguedad: z.array(z.object({ tramo: z.string(), etiqueta: z.string(), cobros: z.number(), monto: z.number() })),
  proximos: z.array(cobroSchema),
  atrasados: z.array(z.object({
    client_id: z.number(),
    cliente: clienteCobroSchema,
    cobros_vencidos: z.number(),
    saldo_vencido: z.number(),
    mas_antiguo: z.string(),
    dias_atraso: z.number(),
  })),
})
export type ResumenCobros = z.infer<typeof resumenCobrosSchema>

export const panelClienteSchema = z.object({
  cliente: clienteCobroSchema,
  config: configCobroSchema.nullable(),
  resumen: z.object({
    saldo_pendiente: z.number(),
    saldo_vencido: z.number(),
    cobros_abiertos: z.number(),
    cobros_vencidos: z.number(),
    total_cobrado: z.number(),
    total_facturado: z.number(),
    proximo_vencimiento: z.object({
      cobro_id: z.number(), periodo: z.string(), fecha_vencimiento: z.string(), saldo: z.number(),
    }).nullable(),
    vencido_desde: z.string().nullable(),
  }),
  /** Lo que se le sugiere al crear su próximo cobro a mano (con su configuración, monto y vencimiento). */
  sugerido: z.object({
    periodo: z.string(),
    monto: z.number().nullable(),
    fecha_vencimiento: z.string().nullable(),
    descripcion: z.string().nullable(),
  }),
  cobros: z.array(cobroConPagosSchema),
  recordatorios: z.array(recordatorioCobroSchema),
})
export type PanelCliente = z.infer<typeof panelClienteSchema>

/**
 * Un cliente al que hay que recordarle (o ya se le recordó): lo que debe vencido y lo que vence pronto, su último
 * recordatorio en CUALQUIERA de sus cobros y si ya toca otro. `cobro_id` es su cobro más urgente: ahí se anota.
 */
export const clienteRecordatorioSchema = z.object({
  client_id: z.number(),
  cliente: clienteCobroSchema,
  motivo: z.enum(['vencido', 'por_vencer']),
  cobros_vencidos: z.number(),
  cobros_por_vencer: z.number(),
  saldo_vencido: z.number(),
  saldo_por_vencer: z.number(),
  /** Vencimiento del cobro vencido más antiguo; null si no tiene ninguno vencido. */
  mas_antiguo: z.string().nullable(),
  /** Vencimiento del próximo cobro por vencer; null si no tiene ninguno. */
  proximo_vencimiento: z.string().nullable(),
  dias_atraso: z.number(),
  /** Recordatorios del cliente en todos sus cobros. */
  recordatorios: z.number(),
  ultimo: recordatorioCobroSchema.nullable(),
  requiere_recordatorio: z.boolean(),
  cobro_id: z.number(),
  periodo: z.string(),
})
export type ClienteRecordatorio = z.infer<typeof clienteRecordatorioSchema>

export const recordatoriosCobrosSchema = z.object({
  hoy: z.string(),
  ahora: z.string(),
  dias: z.number(),
  cada: z.number(),
  /** true = había más cobros de los que mira la lista (los más atrasados primero): los totales son de lo que se muestra. */
  truncado: z.boolean(),
  resumen: z.object({
    por_recordar: z.number(), recordados: z.number(), vencidos: z.number(), por_vencer: z.number(),
    clientes: z.number(), clientes_por_recordar: z.number(), clientes_recordados: z.number(),
  }),
  clientes: z.array(clienteRecordatorioSchema),
  items: z.array(cobroSchema.extend({
    requiere_recordatorio: z.boolean(),
    motivo: z.enum(['vencido', 'por_vencer']),
    /** El último recordatorio del CLIENTE (en cualquiera de sus cobros); el de este cobro es `ultimo_recordatorio`. */
    ultimo: recordatorioCobroSchema.nullable(),
  })),
})
export type RecordatoriosCobros = z.infer<typeof recordatoriosCobrosSchema>
export type ItemRecordatorio = RecordatoriosCobros['items'][number]

/** Respuesta de registrar un pago. `siguiente_nuevo` = el cobro del mes siguiente se generó en ESTA petición. */
export const pagoResultadoSchema = z.object({
  pago: pagoCobroSchema,
  cobro: cobroDetalleSchema,
  siguiente: cobroSchema.nullable(),
  siguiente_nuevo: z.boolean(),
  /** Por qué se generó o no el cobro siguiente cuando ESTE pago completó el cobro; null si no lo completó. */
  siguiente_motivo: z.enum(MOTIVOS_SIGUIENTE).nullable(),
  repetido: z.boolean(),
})
export type PagoResultado = z.infer<typeof pagoResultadoSchema>

export const cobroActualizadoSchema = z.object({
  cobro: cobroDetalleSchema,
  siguiente: cobroSchema.nullable(),
  siguiente_motivo: z.enum(MOTIVOS_SIGUIENTE).nullable(),
})
export type CobroActualizado = z.infer<typeof cobroActualizadoSchema>

export const recordatorioResultadoSchema = z.object({ recordatorio: recordatorioCobroSchema, cobro: cobroDetalleSchema })
export type RecordatorioResultado = z.infer<typeof recordatorioResultadoSchema>

export const pagoAnuladoSchema = z.object({ pago: pagoCobroSchema, cobro: cobroDetalleSchema })
export type PagoAnulado = z.infer<typeof pagoAnuladoSchema>

// ---------------------------------------------------------------------------
// Dinero y fechas de los formularios (sin React)
// ---------------------------------------------------------------------------

/**
 * Centavos de lo que escribió el usuario: "1500", "1,500.50", "1500.5", "RD$ 1,500". Solo números,
 * coma de miles opcional y hasta 2 decimales. null si no es un monto. Nunca pasa por float.
 */
export function centavosDeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(/^RD\$\s*/i, '').replace(/\s/g, '')
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(limpio)) return null
  const [enteros, decimales = ''] = limpio.replace(/,/g, '').split('.')
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'))
  return Number.isSafeInteger(centavos) ? centavos : null
}

/** Centavos de un monto de la API (número con a lo sumo 2 decimales). */
export function aCentavos(monto: number): number {
  return Math.round(monto * 100)
}

/** El monto como número para enviar a la API (centavos / 100: el mismo valor que el literal). */
export function deCentavos(centavos: number): number {
  return Math.round(centavos) / 100
}

/** Cómo se rellena un campo de monto: 150050 -> "1500.50", 150000 -> "1500.00". */
export function textoMontoCampo(centavos: number): string {
  return (centavos / 100).toFixed(2)
}

/** Fecha 'AAAA-MM-DD' que existe de verdad (no el 30 de febrero), entre 2000 y 2100. */
export function esFechaReal(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || y > 2100) return false
  const f = new Date(Date.UTC(y, mes - 1, d))
  return f.getUTCFullYear() === y && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d
}

/** Periodo AAAA-MM válido. */
export function esPeriodo(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** Primer problema de un monto escrito, o null si sirve. */
export function problemaDeMonto(texto: string): string | null {
  if (texto.trim() === '') return 'Escribe el monto.'
  const c = centavosDeTexto(texto)
  if (c === null) return 'El monto no es válido. Usa solo números, con hasta 2 decimales (por ejemplo 1500.50).'
  if (c <= 0) return 'El monto tiene que ser mayor que 0.'
  if (c > MAX_CENTAVOS) return 'El monto es demasiado grande. El máximo es RD$ 9,999,999,999.99.'
  return null
}

/** Para mensajes: 123456 -> "RD$ 1,234.56". */
export function textoDinero(centavos: number): string {
  return 'RD$ ' + (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Una fecha y hora en formato de la API: 'AAAA-MM-DD HH:MM:00'. */
export function fechaHoraApi(fecha: string, hora: string): string {
  return `${fecha} ${hora}:00`
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

const montoCampo = z.string().superRefine((s, ctx) => {
  const p = problemaDeMonto(s)
  if (p) ctx.addIssue({ code: 'custom', message: p })
})
const descripcionCampo = z.string().trim().max(MAX_DESCRIPCION, `La descripción puede tener como máximo ${MAX_DESCRIPCION} caracteres.`)
const fechaCampo = (vacio: string) => z.string().superRefine((s, ctx) => {
  if (s === '') ctx.addIssue({ code: 'custom', message: vacio })
  else if (!esFechaReal(s)) ctx.addIssue({ code: 'custom', message: 'La fecha no es válida.' })
})

/** Crear o editar un cobro. `clientId` es null hasta que se elige el cliente. */
export const cobroFormSchema = z.object({
  clientId: z.number({ error: 'Elige un cliente.' }).int().positive('Elige un cliente.'),
  periodo: z.string().refine(esPeriodo, 'Elige el periodo (mes y año).'),
  fechaVencimiento: fechaCampo('Elige la fecha de vencimiento.'),
  monto: montoCampo,
  descripcion: descripcionCampo,
})
export type CobroForm = z.input<typeof cobroFormSchema>

/** Configuración mensual de un cliente. */
export const configFormSchema = z.object({
  monto: montoCampo,
  dia: z.string().superRefine((s, ctx) => {
    const n = Number(s)
    if (s.trim() === '' || !/^\d{1,2}$/.test(s.trim()) || n < 1 || n > 31) {
      ctx.addIssue({ code: 'custom', message: 'El día de vencimiento tiene que ser un número entre 1 y 31.' })
    }
  }),
  descripcion: descripcionCampo,
  activo: z.boolean(),
})
export type ConfigForm = z.input<typeof configFormSchema>

/**
 * Registrar un pago. El monto no puede pasar del saldo (en centavos) ni la fecha ser posterior
 * a hoy: `saldoCentavos` y `hoy` ('AAAA-MM-DD') son del momento en que se abre el formulario.
 */
export function pagoFormSchema(saldoCentavos: number, hoy: string) {
  return z.object({
    monto: montoCampo,
    fecha: z.string().superRefine((s, ctx) => {
      if (s === '') ctx.addIssue({ code: 'custom', message: 'Elige la fecha del pago.' })
      else if (!esFechaReal(s)) ctx.addIssue({ code: 'custom', message: 'La fecha no es válida.' })
      else if (s > hoy) ctx.addIssue({ code: 'custom', message: 'La fecha del pago no puede ser posterior a hoy.' })
    }),
    metodo: z.enum(METODOS_PAGO, { error: 'Elige cómo se pagó: efectivo o transferencia.' }),
    observaciones: z.string().trim().max(MAX_TEXTO, `Las observaciones pueden tener como máximo ${MAX_TEXTO} caracteres.`),
  }).superRefine((v, ctx) => {
    const c = centavosDeTexto(v.monto)
    if (c !== null && c > saldoCentavos) {
      ctx.addIssue({
        code: 'custom', path: ['monto'],
        message: `El pago no puede ser mayor que el saldo pendiente (${textoDinero(saldoCentavos)}).`,
      })
    }
  })
}
export type PagoForm = { monto: string; fecha: string; metodo: MetodoPago | ''; observaciones: string }

/** Anotar un recordatorio hecho a mano. `ahora` = 'AAAA-MM-DDTHH:MM' (hora local) para no aceptar el futuro. */
export function recordatorioFormSchema(ahora: string) {
  return z.object({
    fecha: z.string().superRefine((s, ctx) => {
      if (s === '') ctx.addIssue({ code: 'custom', message: 'Elige la fecha.' })
      else if (!esFechaReal(s)) ctx.addIssue({ code: 'custom', message: 'La fecha no es válida.' })
    }),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Escribe la hora (por ejemplo 09:30).'),
    canal: z.enum(CANALES_RECORDATORIO, { error: 'Elige cómo se hizo el recordatorio.' }),
    nota: z.string().trim().max(MAX_TEXTO, `La nota puede tener como máximo ${MAX_TEXTO} caracteres.`),
  }).superRefine((v, ctx) => {
    if (esFechaReal(v.fecha) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.hora) && `${v.fecha}T${v.hora}` > ahora) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'El recordatorio no puede ser de una fecha y hora que todavía no llegaron.' })
    }
  })
}
export type RecordatorioForm = { fecha: string; hora: string; canal: CanalRecordatorio | ''; nota: string }

/** El motivo (opcional) de cancelar un cobro o anular un pago. */
export const motivoFormSchema = z.object({
  motivo: z.string().trim().max(MAX_TEXTO, `El motivo puede tener como máximo ${MAX_TEXTO} caracteres.`),
})

/** El primer mensaje de error de cada campo: { monto: '...', fecha: '...' }. */
export function erroresPorCampo(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? '_')
    out[campo] ??= issue.message
  }
  return out
}

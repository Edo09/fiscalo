// Esquemas Zod del payload e-CF (POST /api/facturas) — fuente única de verdad.
// Los tipos de CreateFacturaInput y derivados se infieren de aquí (z.infer) y se
// re-exportan desde ../types para no duplicar definiciones.
import { z } from 'zod'

/** Tipos de comprobante fiscal electrónico (DGII). */
export const tipoEcfSchema = z.enum(['31', '32', '33', '34', '41', '43', '44', '45', '46', '47'])

/** 1=ITBIS 18%, 2=ITBIS 16%, 3=Tasa cero, 4=Exento. */
export const indicadorFacturacionSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4),
])

/** 1=Bien, 2=Servicio. */
export const indicadorBienServicioSchema = z.union([z.literal(1), z.literal(2)])

export const facturaItemSchema = z.object({
  numero_linea: z.number().int().optional(),
  // DGII AlfNum80Type: máx. 80 caracteres. El nombre debe ser corto; el detalle
  // (material, medidas, color, sucursal) va en `descripcion`.
  nombre_item: z.string().min(1, 'El nombre del ítem es obligatorio.').max(80, 'El nombre del ítem no puede superar 80 caracteres (límite DGII).'),
  // DGII AlfNum1000Type: detalle largo opcional, hasta 1000 caracteres.
  descripcion: z.string().max(1000, 'La descripción no puede superar 1000 caracteres (límite DGII).').optional(),
  indicador_facturacion: indicadorFacturacionSchema,
  indicador_bien_servicio: indicadorBienServicioSchema,
  cantidad: z.number().positive('La cantidad debe ser mayor que 0.'),
  unidad_medida: z.string().min(1, 'La unidad de medida es obligatoria.'),
  precio_unitario: z.number().nonnegative('El precio no puede ser negativo.'),
  // Retenciones (E41/E47) — opcionales, el backend las calcula si faltan.
  indicador_agente_retencion_percepcion: z.string().optional(),
  monto_itbis_retenido: z.number().optional(),
  monto_isr_retenido: z.number().optional(),
})

export const compradorSchema = z.object({
  rnc: z.string().optional(),
  razon_social: z.string().optional(),
  identificador_extranjero: z.string().optional(),
  direccion: z.string().optional(),
  municipio: z.string().optional(),
  provincia: z.string().optional(),
  correo: z.string().optional(),
  contacto: z.string().optional(),
})

export const totalesSchema = z.object({
  itbis1: z.string().optional(),
  itbis2: z.string().optional(),
  itbis3: z.string().optional(),
  total_itbis_retenido: z.number().optional(),
  total_isr_retencion: z.number().optional(),
})

export const informacionReferenciaSchema = z.object({
  ncf_modificado: z.string(),
  rnc_otro_contribuyente: z.string().nullable(),
  fecha_ncf_modificado: z.string(),
  codigo_modificacion: z.string(),
  razon_modificacion: z.string(),
})

export const createFacturaSchema = z.object({
  // Opcional: E32 (Consumo) y E43 (Gastos Menores) se emiten sin comprador.
  client_id: z.number().int().positive().optional(),
  tipo_ecf: tipoEcfSchema,
  items: z.array(facturaItemSchema).min(1, 'Agrega al menos un producto o servicio.'),
  user_id: z.number().int().optional(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').optional(),
  tipo_pago: z.number().optional(),
  tipo_ingresos: z.string().optional(),
  indicador_monto_gravado: z.string().optional(),
  indicador_nota_credito: z.string().optional(),
  comprador: compradorSchema.optional(),
  totales: totalesSchema.optional(),
  informacion_referencia: informacionReferenciaSchema.optional(),
  e_ncf: z.string().optional(),
})

// Tipos inferidos — fuente única de verdad para el contrato de la API.
export type TipoEcf = z.infer<typeof tipoEcfSchema>
export type IndicadorFacturacion = z.infer<typeof indicadorFacturacionSchema>
export type IndicadorBienServicio = z.infer<typeof indicadorBienServicioSchema>
export type FacturaItemInput = z.infer<typeof facturaItemSchema>
export type CompradorInput = z.infer<typeof compradorSchema>
export type TotalesInput = z.infer<typeof totalesSchema>
export type InformacionReferencia = z.infer<typeof informacionReferenciaSchema>
export type CreateFacturaInput = z.infer<typeof createFacturaSchema>

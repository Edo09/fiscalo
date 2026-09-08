// Esquemas Zod del payload de gastos (POST /api/gastos) — fuente única de verdad.
// Los tipos de CreateGastoInput y derivados se infieren de aquí (z.infer) y se
// re-exportan desde ../types para no duplicar definiciones.
import { z } from 'zod'

export const gastoCategoriaSchema = z.enum(['gastos_menores', 'facturas_proveedores'])

/** Auto-emitidos por la empresa: E41/E43/E47. Recibidos: E31/B01/E33/E34. */
export const gastoTipoSchema = z.enum(['E43', 'E41', 'E47', 'E31', 'B01', 'E33', 'E34'])

export const gastoItemSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria.'),
  amount: z.number(),
  quantity: z.number().optional(),
  subtotal: z.number().optional(),
  itbis_amount: z.number().optional(),
  unidad_medida: z.string().optional(),
})

/**
 * Tipo de Bienes y Servicios Comprados — campo 3 del Formato 606 DGII.
 * Cadena de 2 dígitos ('01'..'11'), NUNCA número: '01' como number es 1 y la
 * DGII rechaza el archivo. El catálogo vive en /api/tipos-bienes-servicios.
 */
export const tipoBienesServiciosSchema = z
  .string()
  .regex(/^\d{2}$/, 'Elige el tipo de costo o gasto.')

export const createGastoSchema = z.object({
  categoria: gastoCategoriaSchema,
  tipo_gasto: gastoTipoSchema,
  tipo_bienes_servicios: tipoBienesServiciosSchema,
  rnc_proveedor: z.string(),
  nombre_proveedor: z.string(),
  // Solo para tipos recibidos (E31/B01/E33/E34); en auto-emisión se ignora.
  ncf: z.string().optional(),
  items: z.array(gastoItemSchema).min(1, 'Agrega al menos una línea con descripción e importe.'),
  fecha: z.string().optional(),
  subtotal: z.number().optional(),
  itbis: z.number().optional(),
  total: z.number().optional(),
  user_id: z.number().optional(),
})

// Tipos inferidos — fuente única de verdad para el contrato de la API.
export type GastoCategoria = z.infer<typeof gastoCategoriaSchema>
export type GastoTipo = z.infer<typeof gastoTipoSchema>
export type GastoItemInput = z.infer<typeof gastoItemSchema>
export type CreateGastoInput = z.infer<typeof createGastoSchema>

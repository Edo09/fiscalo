// Validación a nivel de FORMULARIO de "Nueva factura". La forma de la UI (Linea,
// Cliente) difiere del payload de la API, así que validamos el estado del form y
// producimos rutas amigables para mostrar errores en línea por campo/línea.
import { z } from 'zod'
import { indicadorFacturacionSchema } from '@/api/schemas/factura'

const lineaSchema = z.object({
  id: z.number(),
  // Nombre corto del ítem (DGII AlfNum80Type, máx. 80). El detalle largo va en `descripcion`.
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre no puede superar 80 caracteres (límite DGII). Mueve el detalle a la descripción.'),
  // Detalle largo opcional (DGII AlfNum1000Type, máx. 1000).
  descripcion: z.string().trim().max(1000, 'La descripción no puede superar 1000 caracteres (límite DGII).').optional(),
  cant: z.number().positive('La cantidad debe ser mayor que 0.'),
  precio: z.number().nonnegative('El precio no puede ser negativo.'),
  desc: z.number().min(0, 'El descuento debe estar entre 0 y 100.').max(100, 'El descuento debe estar entre 0 y 100.'),
  indFact: indicadorFacturacionSchema,
  unidadMedida: z.number().positive('Selecciona una unidad de medida.'),
})

export const facturaFormSchema = z
  .object({
    cliente: z.any(),
    tipo: z.string(),
    lineas: z.array(lineaSchema).min(1, 'Agrega al menos un producto o servicio.'),
  })
  .superRefine((val, ctx) => {
    // E32 (Consumo) y E43 (Gastos Menores) pueden emitirse sin comprador
    // (consumidor final); el resto sí exige cliente. Igual que el backend
    // (facturaController: $permiteSinCliente).
    const permiteSinCliente = val.tipo === '32' || val.tipo === '43'
    if (!val.cliente) {
      if (!permiteSinCliente) {
        ctx.addIssue({ code: 'custom', path: ['cliente'], message: 'Selecciona un cliente.' })
      }
    } else if (val.tipo === '31' && !String(val.cliente.doc ?? '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['cliente'], message: 'El cliente debe tener RNC para e-CF 31 (Crédito Fiscal).' })
    }
    if (val.tipo === '33' || val.tipo === '34') {
      ctx.addIssue({
        code: 'custom',
        path: ['tipo'],
        message: `Las notas (e-CF ${val.tipo}) requieren un comprobante de referencia, aún no soportado en este formulario.`,
      })
    }
  })

/** Errores por campo, listos para render en línea. `lineas` se indexa por `Linea.id`. */
export interface FacturaFormErrors {
  cliente?: string
  tipo?: string
  /** Error a nivel de formulario (ej. sin líneas). */
  form?: string
  lineas: Record<number, LineaErrors>
}

export interface LineaErrors {
  nombre?: string
  descripcion?: string
  cant?: string
  precio?: string
  desc?: string
  unidadMedida?: string
}

export const emptyFormErrors = (): FacturaFormErrors => ({ lineas: {} })

/**
 * Traduce las incidencias de Zod a `FacturaFormErrors`. Las rutas de línea llegan
 * como `['lineas', i, campo]`; se resuelven al `id` de la línea para casar con la UI.
 */
export function mapFormIssues(error: z.ZodError, lineas: { id: number }[]): FacturaFormErrors {
  const out = emptyFormErrors()
  for (const issue of error.issues) {
    const [head, idx, field] = issue.path
    if (head === 'cliente') {
      out.cliente ??= issue.message
    } else if (head === 'tipo') {
      out.tipo ??= issue.message
    } else if (head === 'lineas') {
      if (typeof idx === 'number' && typeof field === 'string') {
        const lineId = lineas[idx]?.id
        if (lineId != null) {
          const bucket = (out.lineas[lineId] ??= {})
          if (!(field in bucket)) (bucket as Record<string, string>)[field] = issue.message
        }
      } else {
        // ['lineas'] sin índice => error de longitud mínima (sin líneas).
        out.form ??= issue.message
      }
    }
  }
  return out
}

// Validación a nivel de FORMULARIO del modal "Registrar gasto/compra". La forma
// de la UI (Linea, Proveedor) difiere del payload de la API, así que validamos el
// estado del form y producimos rutas amigables para errores en línea.
import { z } from 'zod'

const gastoLineaSchema = z.object({
  id: z.number(),
  description: z.string().trim().min(1, 'La descripción es obligatoria.'),
  quantity: z.number().positive('La cantidad debe ser mayor que 0.'),
  amount: z.number().positive('El importe debe ser mayor que 0.'),
  itbis_amount: z.number().nonnegative('El ITBIS no puede ser negativo.'),
  unidad_medida: z.number().positive('Selecciona una unidad de medida.'),
})

export const gastoFormSchema = z
  .object({
    esCompra: z.boolean(),
    recibido: z.boolean(),
    tipo: z.string(),
    proveedor: z.any(),
    ncf: z.string(),
    lineas: z.array(gastoLineaSchema).min(1, 'Agrega al menos una línea con descripción e importe.'),
  })
  .superRefine((val, ctx) => {
    if (val.esCompra) {
      if (!val.proveedor) {
        ctx.addIssue({ code: 'custom', path: ['proveedor'], message: 'Selecciona un proveedor del directorio o crea uno nuevo.' })
      } else if (!val.proveedor.rnc) {
        ctx.addIssue({ code: 'custom', path: ['proveedor'], message: 'El proveedor seleccionado no tiene RNC; complétalo en Proveedores.' })
      }
      if (val.recibido && !val.ncf.trim()) {
        ctx.addIssue({ code: 'custom', path: ['ncf'], message: `El tipo ${val.tipo} es recibido: digita el NCF que entregó el proveedor.` })
      }
    }
  })

/** Errores por campo, listos para render en línea. `lineas` se indexa por `Linea.id`. */
export interface GastoFormErrors {
  proveedor?: string
  ncf?: string
  /** Error a nivel de formulario (ej. sin líneas). */
  form?: string
  lineas: Record<number, GastoLineaErrors>
}

export interface GastoLineaErrors {
  description?: string
  quantity?: string
  amount?: string
  itbis_amount?: string
  unidad_medida?: string
}

export const emptyGastoErrors = (): GastoFormErrors => ({ lineas: {} })

/**
 * Traduce las incidencias de Zod a `GastoFormErrors`. `lineas` es el subconjunto de
 * líneas con contenido que se validó; el índice de la ruta se resuelve a su `id`.
 */
export function mapGastoIssues(error: z.ZodError, lineas: { id: number }[]): GastoFormErrors {
  const out = emptyGastoErrors()
  for (const issue of error.issues) {
    const [head, idx, field] = issue.path
    if (head === 'proveedor') {
      out.proveedor ??= issue.message
    } else if (head === 'ncf') {
      out.ncf ??= issue.message
    } else if (head === 'lineas') {
      if (typeof idx === 'number' && typeof field === 'string') {
        const lineId = lineas[idx]?.id
        if (lineId != null) {
          const bucket = (out.lineas[lineId] ??= {})
          if (!(field in bucket)) (bucket as Record<string, string>)[field] = issue.message
        }
      } else {
        out.form ??= issue.message
      }
    }
  }
  return out
}

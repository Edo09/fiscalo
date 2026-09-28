// Validación a nivel de FORMULARIO de "Nueva factura". La forma de la UI (Linea,
// Cliente) difiere del payload de la API, así que validamos el estado del form y
// producimos rutas amigables para mostrar errores en línea por campo/línea.
import { z } from 'zod'
import { indicadorFacturacionSchema } from '@/api/schemas/factura'
import type { CodigoModificacion, FacturaModificableRow } from '@/api'
import { fmt } from '@/lib/format'

/** Bloque "Comprobante que modifica" de una nota E33/E34 (InformacionReferencia). */
export interface ReferenciaNotaForm {
  /** Factura elegida de las aceptadas del cliente (trae su fecha y su saldo). */
  original: FacturaModificableRow | null
  codigo: CodigoModificacion | ''
  razon: string
}

/** RazonModificacion de la DGII: AlfNum90. */
export const RAZON_NOTA_MAX = 90

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
    // Solo cuentan en las notas (E33/E34).
    referencia: z.custom<ReferenciaNotaForm>().optional(),
    /** Total del documento tal como se ve: el tope de una nota de crédito. */
    total: z.number().optional(),
  })
  .superRefine((val, ctx) => {
    // E32 (Consumo) y E43 (Gastos Menores) pueden emitirse sin comprador
    // (consumidor final); el resto sí exige cliente. Igual que el backend
    // (facturaController: $permiteSinCliente).
    const permiteSinCliente = val.tipo === '32' || val.tipo === '43'
    if (!val.cliente) {
      if (!permiteSinCliente) {
        ctx.addIssue({ code: 'custom', path: ['cliente'], message: 'Elige un cliente de la lista o créalo con el botón +.' })
      }
    } else if (val.tipo === '31' && !String(val.cliente.doc ?? '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['cliente'], message: 'El Crédito Fiscal (e-CF 31) exige que el cliente tenga RNC. Agrégaselo o cambia a Consumo.' })
    }
    // Notas: la DGII exige la factura que modifican, qué corrigen y (para el
    // impreso) la razón. El backend lo vuelve a validar antes de reservar el
    // e-NCF, pero aquí el error sale junto al campo.
    if (val.tipo === '33' || val.tipo === '34') {
      const nota = val.tipo === '34' ? 'nota de crédito' : 'nota de débito'
      const ref = val.referencia
      const original = ref?.original
      if (!original) {
        ctx.addIssue({
          code: 'custom',
          path: ['referencia', 'original'],
          message: val.cliente
            ? `Elige la factura que modifica esta ${nota}.`
            : `Elige el cliente y luego la factura que modifica esta ${nota}.`,
        })
      } else if (val.tipo === '34' && (val.total ?? 0) > original.saldo + 0.005) {
        // Una nota de crédito resta de las ventas (reporte y dashboard): pasar
        // del saldo restaría más de lo que se vendió.
        ctx.addIssue({
          code: 'custom',
          path: ['referencia', 'monto'],
          message: original.saldo <= 0
            ? `La factura ${original.e_ncf} ya está acreditada por completo: no le queda monto para otra nota de crédito.`
            : `Esta nota de crédito es de RD$ ${fmt(val.total ?? 0)} y a la factura ${original.e_ncf} solo le quedan RD$ ${fmt(original.saldo)} por acreditar. Baja el monto de las líneas.`,
        })
      }
      if (!ref?.codigo) {
        ctx.addIssue({ code: 'custom', path: ['referencia', 'codigo'], message: `Elige qué corrige esta ${nota}.` })
      }
      const razon = ref?.razon.trim() ?? ''
      if (!razon) {
        ctx.addIssue({
          code: 'custom',
          path: ['referencia', 'razon'],
          message: `Escribe la razón de la ${nota}: sale impresa en el comprobante.`,
        })
      } else if (razon.length > RAZON_NOTA_MAX) {
        ctx.addIssue({
          code: 'custom',
          path: ['referencia', 'razon'],
          message: `La razón puede tener hasta ${RAZON_NOTA_MAX} caracteres (límite DGII) y tiene ${razon.length}. Acórtala.`,
        })
      }
    }
  })

/** Errores por campo, listos para render en línea. `lineas` se indexa por `Linea.id`. */
export interface FacturaFormErrors {
  cliente?: string
  tipo?: string
  /** Error a nivel de formulario (ej. sin líneas). */
  form?: string
  lineas: Record<number, LineaErrors>
  /** Bloque de la nota E33/E34. `monto` = la nota de crédito pasa del saldo. */
  referencia?: ReferenciaErrors
}

export interface ReferenciaErrors {
  original?: string
  codigo?: string
  razon?: string
  monto?: string
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
    } else if (head === 'referencia') {
      if (typeof idx === 'string') {
        const bucket = (out.referencia ??= {}) as Record<string, string>
        bucket[idx] ??= issue.message
      }
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

// Validación del formulario de cotización de Ferretería y armado del cuerpo
// que espera el API (CotizacionFerreteriaInput, spec 6.5). Mismo enfoque que
// invoices/factura.schema.ts: se valida el estado de la PANTALLA (líneas,
// cliente elegido, casillas) y los errores salen con rutas que la pantalla
// sabe pintar junto a cada campo y cada línea.
//
// Las reglas son las del backend (FerreteriaFormato::validarForma): si aquí
// pasa, allá también, salvo lo que solo sabe la base (que el cliente y el
// producto existan). Lo que el servidor rechace igual se muestra tal cual.
//
// Imports de valor SOLO por ruta relativa con .ts y '@/…' solo como
// `import type`: así `node` carga este archivo para
// scripts/test-schema-cotizacion-ferreteria.ts sin compilar nada. Por eso las
// reglas de la unidad (que necesitan el catálogo DGII, pedido al API) llegan
// como funciones: el formulario pasa las de components/unidadesMedida.
import { z } from 'zod'
import type { CotizacionFerreteriaInput, IndicadorFacturacion } from '@/api'
import type { Cliente } from '@/types/domain'
import { decimalesDe, fmt } from '../../../../lib/format.ts'
import { isoLocal } from '../../../../lib/date.ts'
import { r2, redondear } from '../../../invoices/montosLinea.ts'
import { totalesFerreteria } from './totales.ts'
import type { AjustesFerreteriaForm } from './totales.ts'

/** Tope de la descripción: el mismo que FerreteriaFormato::MAX_DESCRIPCION. */
export const MAX_DESCRIPCION = 1000

/** Una línea tal como la edita el formulario. */
export interface LineaFerreteriaForm {
  id: number
  /** Producto del catálogo de donde salió ('' = línea libre). */
  prodId: string
  descripcion: string
  cantidad: number
  /** Precio unitario SIN ITBIS: el impuesto se suma encima, como en la hoja de Excel. */
  precio: number
  indFact: IndicadorFacturacion
  /** Código DGII de la unidad (= unidades_medida.id; 43 = Unidad). */
  unidadMedida: number
  tipoItem: 'Bien' | 'Servicio'
}

/** Todo lo que se valida antes de guardar o pedir la vista previa. */
export interface FormFerreteria {
  cliente: Cliente | null
  /**
   * Lo escrito sin elegir un cliente: en el buscador, o como nombre libre que
   * todavía no se guardó. Se ve como un cliente puesto pero no lo es, y la
   * cotización exige `client_id`: el mensaje lo dice con ese mismo texto.
   */
  clienteEscrito: { buscador: string; libre: string }
  /** 'YYYY-MM-DD' del input de fecha. */
  fecha: string
  /** Solo las líneas con contenido (ver lineaEnBlanco). */
  lineas: LineaFerreteriaForm[]
  ajustes: AjustesFerreteriaForm
}

/**
 * Lo que el backend juzga con el catálogo de unidades. Cada función devuelve
 * el texto del problema o null. El formulario pasa problemaCantidad /
 * unidadValida de components/unidadesMedida con el catálogo ya cargado.
 */
export interface ReglasUnidad {
  problemaCantidad: (cantidad: number, unidad: number) => string | null
  problemaUnidad: (unidad: number) => string | null
}

/**
 * Fila sin nada que cotizar: sin producto, sin descripción y sin precio. Se
 * descarta sin avisar. La cantidad no cuenta: vaciar ese campo da 0, y pedir
 * que se arregle una fila que por lo demás está vacía no tendría sentido.
 */
export const lineaEnBlanco = (l: LineaFerreteriaForm): boolean =>
  l.prodId === '' && l.descripcion.trim() === '' && l.precio === 0

/** ¿Una fecha 'YYYY-MM-DD' que existe? (2026-02-30 no.) */
function fechaReal(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T12:00:00`)
  return !Number.isNaN(d.getTime()) && isoLocal(d) === f
}

/**
 * Un número con UN solo mensaje. Zod 4 corre todas las reglas de un campo, y
 * con .positive() + .refine() un mismo precio podía contar como dos errores.
 */
const numero = (problema: (n: number) => string | null) =>
  z.number().superRefine((n, ctx) => {
    const msg = problema(n)
    if (msg) ctx.addIssue({ code: 'custom', message: msg })
  })

/** Cargos y abono: ≥ 0 y con centavos como mucho (DECIMAL(18,2) en cotizacion_ajustes). */
const monto = (que: string) =>
  numero((n) => (n < 0
    ? `El monto de «${que}» no puede ser negativo.`
    : decimalesDe(n) > 2 ? `El monto de «${que}» admite hasta 2 decimales.` : null))

const ajustesSchema = z.object({
  cargosBancarios: monto('Cargos bancarios'),
  manejoBancario: monto('Manejos de operaciones bancarias'),
  manoObra: monto('Costo mano de obra'),
  abono: monto('Abono realizado'),
  retencion: z.boolean(),
})

/** Esquema del formulario con las reglas de unidad del catálogo cargado. */
export function ferreteriaFormSchema(reglas: ReglasUnidad) {
  const linea = z
    .object({
      id: z.number(),
      prodId: z.string(),
      descripcion: z.string().superRefine((d, ctx) => {
        const t = d.trim()
        const msg = t === ''
          ? 'Escribe la descripción.'
          : t.length > MAX_DESCRIPCION ? `La descripción admite hasta ${MAX_DESCRIPCION} caracteres.` : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      cantidad: z.number(),
      // amount del API: > 0 y hasta 4 decimales, como el precio del e-CF.
      precio: numero((n) => (!(n > 0)
        ? 'El precio debe ser mayor que 0.'
        : decimalesDe(n) > 4 ? 'El precio admite hasta 4 decimales.' : null)),
      indFact: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      unidadMedida: z.number(),
      tipoItem: z.enum(['Bien', 'Servicio']),
    })
    .superRefine((l, ctx) => {
      // La unidad decide si la cantidad admite fracciones (metro sí, unidad
      // no) y el tope es de 2 decimales: lo que viaja al e-CF al facturar.
      const unidad = reglas.problemaUnidad(l.unidadMedida)
      if (unidad) ctx.addIssue({ code: 'custom', path: ['unidadMedida'], message: unidad })
      const cantidad = reglas.problemaCantidad(l.cantidad, l.unidadMedida)
      if (cantidad) ctx.addIssue({ code: 'custom', path: ['cantidad'], message: cantidad })
    })

  return z
    .object({
      cliente: z.custom<Cliente | null>(),
      clienteEscrito: z.object({ buscador: z.string(), libre: z.string() }),
      fecha: z.string().superRefine((f, ctx) => {
        const msg = f === '' ? 'Pon la fecha de la cotización.' : !fechaReal(f) ? 'La fecha no es válida.' : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      lineas: z.array(linea).min(1, 'Agrega al menos una línea: un producto del catálogo o una línea libre.'),
      ajustes: ajustesSchema,
    })
    .superRefine((val, ctx) => {
      if (!val.cliente) {
        const { buscador, libre } = val.clienteEscrito
        ctx.addIssue({
          code: 'custom',
          path: ['cliente'],
          message: libre
            ? `«${libre}» todavía no es un cliente: pulsa «Guardar» en el campo para registrarlo, o elígelo de la lista.`
            : buscador
              ? `«${buscador}» no está elegido: elígelo de la lista o créalo con el botón +.`
              : 'Elige un cliente de la lista o créalo con el botón +.',
        })
      }
      // El abono no puede pasar de lo adeudado (TOTAL − retención), comparando
      // los montos ya redondeados, con el mismo texto que
      // FerreteriaFormato::errorAbono.
      const t = totalesFerreteria(
        val.lineas.map((l) => ({ cantidad: l.cantidad, precio: l.precio, indFact: l.indFact })),
        val.ajustes,
      )
      if (t.abono > t.adeudado) {
        ctx.addIssue({
          code: 'custom',
          path: ['ajustes', 'abono'],
          message: `El abono (RD$ ${fmt(t.abono)}) no puede ser mayor que lo adeudado (RD$ ${fmt(t.adeudado)}).`,
        })
      }
    })
}

export interface ErroresLineaFerreteria {
  descripcion?: string
  cantidad?: string
  precio?: string
  unidadMedida?: string
}

/** Errores por campo, listos para pintar. `lineas` se indexa por `LineaFerreteriaForm.id`. */
export interface ErroresFerreteria {
  cliente?: string
  fecha?: string
  /** Error del formulario entero (sin líneas). */
  form?: string
  lineas: Record<number, ErroresLineaFerreteria>
  ajustes: Partial<Record<keyof AjustesFerreteriaForm, string>>
}

export const sinErrores = (): ErroresFerreteria => ({ lineas: {}, ajustes: {} })

/**
 * Traduce las incidencias de Zod a ErroresFerreteria. Las rutas de línea
 * llegan como ['lineas', i, campo]; `i` se resuelve al id de la línea de
 * `lineas`, que debe ser la misma lista que se validó.
 */
export function mapearErrores(error: z.ZodError, lineas: { id: number }[]): ErroresFerreteria {
  const out = sinErrores()
  for (const issue of error.issues) {
    const [head, a, b] = issue.path
    if (head === 'cliente') {
      out.cliente ??= issue.message
    } else if (head === 'fecha') {
      out.fecha ??= issue.message
    } else if (head === 'ajustes') {
      if (typeof a === 'string') out.ajustes[a as keyof AjustesFerreteriaForm] ??= issue.message
    } else if (head === 'lineas') {
      if (typeof a === 'number' && typeof b === 'string') {
        const id = lineas[a]?.id
        if (id != null) {
          const bucket = (out.lineas[id] ??= {})
          bucket[b as keyof ErroresLineaFerreteria] ??= issue.message
        }
      } else {
        // ['lineas'] sin índice: no hay ninguna.
        out.form ??= issue.message
      }
    }
  }
  return out
}

/**
 * Cuerpo de POST / PUT / preview (sin `id`: lo agrega quien llama). Las
 * cantidades y los precios viajan con el redondeo con que la pantalla calculó
 * los totales (2 y 4 decimales), y los cargos y el abono, a centavos.
 * `retencion_isr` va siempre como booleano: el backend calcula el 5%.
 * `date` ausente = el backend usa ahora (POST) o conserva la guardada (PUT).
 */
export function cuerpoFerreteria(datos: {
  clienteId: number
  lineas: LineaFerreteriaForm[]
  ajustes: AjustesFerreteriaForm
  date?: string
}): CotizacionFerreteriaInput {
  const a = datos.ajustes
  return {
    // Siempre: si el formato del tenant ya no es este (pantalla vieja), el
    // backend responde 409 en vez de guardar con reglas de otro formato.
    formato: 'ferreteria',
    client_id: datos.clienteId,
    ...(datos.date ? { date: datos.date } : {}),
    items: datos.lineas.map((l) => ({
      product_id: l.prodId ? Number(l.prodId) : null,
      description: l.descripcion.trim(),
      quantity: redondear(l.cantidad, 2),
      amount: redondear(l.precio, 4),
      unidad_medida: String(l.unidadMedida),
      indicador_facturacion: l.indFact,
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
    })),
    ajustes: {
      cargos_bancarios: r2(a.cargosBancarios),
      manejo_bancario: r2(a.manejoBancario),
      mano_obra: r2(a.manoObra),
      abono: r2(a.abono),
      retencion_isr: a.retencion,
    },
  }
}

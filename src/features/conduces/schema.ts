// Validación del formulario del conduce de mercancía (Ferretería), el cuerpo
// que espera /api/conduces (ConduceInput, spec conduces 4.1) y los textos fijos
// de la pantalla (spec 5.5).
//
// Un conduce es la cotización de Ferretería sin montos a la vista: las mismas
// líneas (de un producto del catálogo o libres), con su unidad y su cantidad,
// y las mismas reglas por línea que la cotización (ferreteria/schema.ts). Lo
// que cambia:
//   - el precio, el ITBIS y bien/servicio viajan pero no se ven, y el precio no
//     se valida aquí: es el del catálogo o el de la cotización, o 0 en una línea
//     libre (el backend lo acepta; al facturar se escribe);
//   - no hay cargos ni abonos: el backend rechaza el cuerpo que los traiga;
//   - una fila "vacía" es la que no tiene producto ni descripción: el precio no
//     se ve, así que no cuenta.
// Las reglas son las del backend (FerreteriaConduce::validarForma con
// FerreteriaFormato::normalizarLinea(…, true)): si aquí pasa, allá también,
// salvo lo que solo sabe la base (que el cliente, el producto y la cotización
// existan). Lo que el servidor rechace igual se muestra tal cual.
//
// Imports de valor SOLO por ruta relativa con .ts y '@/…' solo como
// `import type`: así `node` carga este archivo para
// scripts/test-schema-conduce.ts sin compilar nada.
import { z } from 'zod'
import type { ConduceInput, CotizacionRow } from '@/api'
import type { Cliente } from '@/types/domain'
import { aNumero, fmt } from '../../lib/format.ts'
import { isoLocal } from '../../lib/date.ts'
import { redondear } from '../invoices/montosLinea.ts'
import { MAX_DESCRIPCION, mapearErrores } from '../cotizaciones/formatos/ferreteria/schema.ts'
import type { ErroresFerreteria, LineaFerreteriaForm, ReglasUnidad } from '../cotizaciones/formatos/ferreteria/schema.ts'

// --- Textos fijos de la pantalla ---------------------------------------------

export const MSG_COTIZACION_NO_EXISTE = 'Esta cotización ya no existe'
export const MSG_SOLO_FERRETERIA = 'Solo las cotizaciones de Ferretería generan conduces.'
export const MSG_CONDUCE_NO_EXISTE = 'Este conduce ya no existe'
/** El cliente del conduce (o de su cotización) se borró: el formulario abre sin cliente. */
export const MSG_CLIENTE_BORRADO = 'El cliente ya no existe: elige otro.'
/** Los del encabezado son los del backend (FerreteriaConduce::MSG_SIN_CLIENTE, MSG_SIN_LINEAS, MSG_FECHA). */
export const MSG_SIN_CLIENTE = 'Elige un cliente para el conduce.'
export const MSG_SIN_LINEAS = 'Agrega al menos una línea al conduce.'
export const MSG_FECHA = 'La fecha no es válida.'

/** Confirmación de Eliminar: el conduce se desactiva y su número queda gastado. */
export const confirmacionEliminar = (codigo: string): string =>
  `El conduce dejará de verse en la lista. Su número ${codigo} no se vuelve a usar.`

/** Cargos que suben el TOTAL de la cotización, en el orden y con las etiquetas del PDF (como ferreteria/conversion.ts). */
const CARGOS: { clave: string; etiqueta: string }[] = [
  { clave: 'cargos_bancarios', etiqueta: 'Cargos bancarios' },
  { clave: 'manejo_bancario', etiqueta: 'Manejos de operaciones bancarias' },
  { clave: 'mano_obra', etiqueta: 'Costo mano de obra' },
]

/**
 * Aviso del conduce nuevo cuando su cotización tenía cargos adicionales: no se
 * copian (un conduce no lleva montos) y tampoco llegan a la factura que salga
 * del conduce. null si no tenía ninguno, con el mismo criterio que
 * avisosCargos() al facturar la cotización: monto > 0 en alguna de las tres.
 */
export function avisoCargosConduce(c: CotizacionRow): string | null {
  const lista = CARGOS
    .map(({ clave, etiqueta }) => ({ etiqueta, monto: aNumero(c.ajustes?.[clave]) }))
    .filter((x) => x.monto > 0)
    .map((x) => `${x.etiqueta} RD$ ${fmt(x.monto)}`)
    .join(', ')
  if (lista === '') return null
  return `La cotización ${c.code || `#${c.id}`} tenía cargos adicionales (${lista}): no pasan al conduce ni a la factura que salga de él.`
}

// --- Validación ----------------------------------------------------------------

/** Todo lo que se valida antes de guardar o pedir la vista previa. */
export interface FormConduce {
  cliente: Cliente | null
  /** Lo escrito sin elegir un cliente (ver FormFerreteria.clienteEscrito): el mensaje lo nombra. */
  clienteEscrito: { buscador: string; libre: string }
  /** 'YYYY-MM-DD' del input de fecha. */
  fecha: string
  /** Solo las líneas con contenido (ver lineaVacia). */
  lineas: LineaFerreteriaForm[]
}

/**
 * Fila sin nada que entregar: sin producto y sin descripción. Se descarta sin
 * avisar. A diferencia de la cotización, el precio no cuenta: no se ve, y una
 * fila que se ve vacía no puede pedir que se arregle.
 */
export const lineaVacia = (l: LineaFerreteriaForm): boolean => l.prodId === '' && l.descripcion.trim() === ''

/** ¿Una fecha 'YYYY-MM-DD' que existe? (2026-02-30 no.) La misma regla que la cotización. */
function fechaReal(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T12:00:00`)
  return !Number.isNaN(d.getTime()) && isoLocal(d) === f
}

/** Esquema del formulario con las reglas de unidad del catálogo cargado (las de la cotización). */
export function conduceFormSchema(reglas: ReglasUnidad) {
  const linea = z
    .object({
      id: z.number(),
      prodId: z.string(),
      // Los textos de la cotización de Ferretería, línea por línea.
      descripcion: z.string().superRefine((d, ctx) => {
        const t = d.trim()
        const msg = t === ''
          ? 'Escribe la descripción.'
          : t.length > MAX_DESCRIPCION ? `La descripción admite hasta ${MAX_DESCRIPCION} caracteres.` : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      cantidad: z.number(),
      // Interno y sin validar aquí (ver arriba).
      precio: z.number(),
      indFact: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      unidadMedida: z.number(),
      tipoItem: z.enum(['Bien', 'Servicio']),
    })
    .superRefine((l, ctx) => {
      // La unidad decide si la cantidad admite fracciones, y el tope es de 2
      // decimales: lo que viaja al e-CF al facturar el conduce.
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
        const msg = f === '' ? 'Pon la fecha del conduce.' : !fechaReal(f) ? MSG_FECHA : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      lineas: z.array(linea).min(1, MSG_SIN_LINEAS),
    })
    .superRefine((val, ctx) => {
      if (val.cliente) return
      const { buscador, libre } = val.clienteEscrito
      ctx.addIssue({
        code: 'custom',
        path: ['cliente'],
        message: libre
          ? `«${libre}» todavía no es un cliente: pulsa «Guardar» en el campo para registrarlo, o elígelo de la lista.`
          : buscador
            ? `«${buscador}» no está elegido: elígelo de la lista o créalo con el botón +.`
            : MSG_SIN_CLIENTE,
      })
    })
}

/** Errores por campo, listos para pintar: los de la cotización sin el grupo de cargos y abonos. */
export type ErroresConduce = Omit<ErroresFerreteria, 'ajustes'>

export const sinErroresConduce = (): ErroresConduce => ({ lineas: {} })

/**
 * Traduce las incidencias de Zod a ErroresConduce. Las rutas son las de la
 * cotización (cliente, fecha, lineas[i].campo), así que se usa su traductor;
 * `lineas` debe ser la misma lista que se validó.
 */
export function mapearErroresConduce(error: z.ZodError, lineas: { id: number }[]): ErroresConduce {
  const { cliente, fecha, form, lineas: porLinea } = mapearErrores(error, lineas)
  return { cliente, fecha, form, lineas: porLinea }
}

// --- Cuerpo del API ------------------------------------------------------------

/**
 * Cuerpo de POST / PUT / preview (sin `id`: lo agrega quien llama). Cantidad y
 * precio con el redondeo de la cotización (2 y 4 decimales). Sin `ajustes` ni
 * `formato`: un conduce no lleva cargos (el backend respondería 422) y su
 * formato es siempre el de Ferretería.
 * `cotizacionId` solo al crear: al editar no viaja (el PUT la ignora).
 * `date` ausente = el backend usa ahora (POST) o conserva la guardada (PUT).
 */
export function cuerpoConduce(datos: {
  clienteId: number
  lineas: LineaFerreteriaForm[]
  cotizacionId?: number | null
  date?: string
}): ConduceInput {
  return {
    ...(datos.cotizacionId != null ? { cotizacion_id: datos.cotizacionId } : {}),
    client_id: datos.clienteId,
    ...(datos.date ? { date: datos.date } : {}),
    items: datos.lineas.map((l) => ({
      product_id: l.prodId ? Number(l.prodId) : null,
      description: l.descripcion.trim(),
      quantity: redondear(l.cantidad, 2),
      unidad_medida: String(l.unidadMedida),
      amount: redondear(l.precio, 4),
      indicador_facturacion: l.indFact,
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
    })),
  }
}

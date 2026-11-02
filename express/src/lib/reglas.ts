// Las reglas que se revisan ANTES de mandar la venta (anexo 7.4) y el estado del botón Emitir. El servidor devuelve textos libres sin decir en qué campo está el
// problema, así que aquí se atrapa todo lo que se pueda con las palabras de quien llena la factura. Los límites son los de `createFacturaSchema` (nombre de 80
// unidades UTF-16, cantidad con 2 decimales, precio con 4) sin importar zod: es lo que el servidor aplica, y un nombre que pasa aquí no falla al enviar.
//
// El botón nunca se deshabilita en silencio: cada estado tiene su rótulo, y gana el primero de esta lista:
//   enCurso > sinConfirmar > planNoIncluye > sinConexion > sinRango > corregir > listo.
import { decimalesDe } from '@/lib/format'
import type { Carrito, LineaCarrito } from '~/lib/carrito'
import { fechaLimiteEfectiva, MAX_NOMBRE } from '~/lib/carrito'
import type { Ambiente } from '~/entitlements'
import { rd } from '~/lib/dinero'
import { estadoNumeracion } from '~/lib/numeracion'
import type { SecuenciaStats } from '~/lib/numeracion'
import { exigeComprador, permiteCredito } from '~/lib/tiposEcf'
import { resumenTotales } from '~/lib/totales'

export interface ErrorCampo {
  /** `cliente`, `lineas`, `total`, `pago`, o el de una línea: `nombre`, `cant`, `precio`, `desc`, `unidad`. */
  campo: 'cliente' | 'lineas' | 'total' | 'pago' | 'nombre' | 'cant' | 'precio' | 'desc' | 'unidad'
  mensaje: string
  /** El `id` de la línea, si el error es de una línea. */
  linea?: number
}

export const MSG = {
  sinCliente: 'Elige un cliente de la lista o créalo con el botón +.',
  sinRnc: 'Falta el RNC',
  rncPropio: 'Es el RNC de tu empresa',
  consumoGrande: 'Las facturas de consumo de RD$250,000 o más tienen que identificar al comprador. Elige un cliente con RNC o cédula.',
  sinLineas: 'Agrega al menos un producto o servicio.',
  total: 'El total debe ser mayor que 0.',
  soloContado: 'Este cliente es solo de contado',
  creditoSinCliente: 'Elige un cliente para vender a crédito',
  fechaLimite: 'La fecha límite de pago no puede ser anterior a hoy.',
  unidad: 'Elige la unidad de medida de esta línea.',
  nombre: 'El nombre es obligatorio.',
  nombreLargo: 'El nombre no puede superar 80 caracteres (límite DGII).',
  cantidad: 'La cantidad debe ser mayor que 0.',
  cantidadDecimales: 'La cantidad admite hasta 2 decimales.',
  sinFracciones: 'Esta unidad no admite fracciones',
  precio: 'El precio debe ser mayor que 0.',
  precioDecimales: 'El precio admite hasta 4 decimales.',
  descuento: 'El descuento debe estar entre 0 y 100.',
} as const

export interface EntradaRevision {
  carrito: Carrito
  /** El día de hoy, de lib/reloj. */
  hoy: string
  /** El RNC de la empresa (con o sin guiones). */
  rncEmisor: string
  admiteDecimales: (unidad: string) => boolean
  unidadValida: (unidad: string) => boolean
  enLinea: boolean
  /** false solo si se sabe que no queda numeración vigente para el tipo; null si no se sabe (no bloquea). */
  rangoVigente: boolean | null
  /** false si el servidor ya dijo que el plan no incluye este tipo. */
  tipoHabilitado: boolean
  /** Hay un envío en vuelo ahora mismo. */
  envioEnCurso: boolean
  /** Hay un envío cuyo resultado no se conoce y la persona todavía no confirmó que no se emitió. */
  envioSinConfirmar: boolean
}

const soloDigitos = (v: string): string => v.replace(/\D/g, '')

/** Lo que está mal de una línea, en palabras de quien la llena. `admiteDecimales` es el de su unidad (sin catálogo, solo enteros). */
export function validarLinea(l: LineaCarrito, admiteDecimales: boolean): ErrorCampo[] {
  const errores: ErrorCampo[] = []
  const agregar = (campo: ErrorCampo['campo'], mensaje: string): void => {
    errores.push({ campo, mensaje, linea: l.id })
  }
  const nombre = l.nombre.trim()
  if (nombre === '') agregar('nombre', MSG.nombre)
  else if (nombre.length > MAX_NOMBRE) agregar('nombre', MSG.nombreLargo)

  if (!(l.cant > 0)) agregar('cant', MSG.cantidad)
  else {
    const decimales = decimalesDe(l.cant)
    if (decimales > 0 && !admiteDecimales) agregar('cant', MSG.sinFracciones)
    else if (decimales > 2) agregar('cant', MSG.cantidadDecimales)
  }

  if (!(l.precio > 0)) agregar('precio', MSG.precio)
  else if (decimalesDe(l.precio) > 4) agregar('precio', MSG.precioDecimales)

  if (!(l.desc >= 0 && l.desc <= 100)) agregar('desc', MSG.descuento)
  return errores
}

/** Todo lo que impide emitir esta venta, en el orden de la pantalla: el cliente, las líneas, el total y el pago. Vacío si se puede emitir. */
export function validarRevision(e: EntradaRevision): ErrorCampo[] {
  const { carrito: c } = e
  const errores: ErrorCampo[] = []
  const totales = resumenTotales(c.lineas)
  const cliente = c.cliente
  const rnc = cliente === null ? '' : soloDigitos(cliente.rnc ?? '')

  if (exigeComprador(c.tipo, totales.total)) {
    if (c.tipo === '32') {
      // El consumo desde RD$250,000: el servidor pide un comprador con RNC o cédula (`UMBRAL_CONSUMO`). Por debajo, el comprador es opcional.
      if (rnc === '') errores.push({ campo: 'cliente', mensaje: MSG.consumoGrande })
    } else if (cliente === null) errores.push({ campo: 'cliente', mensaje: MSG.sinCliente })
    else if (rnc === '') errores.push({ campo: 'cliente', mensaje: MSG.sinRnc })
  }
  const rncEmisor = soloDigitos(e.rncEmisor)
  if (rnc !== '' && rncEmisor !== '' && rnc === rncEmisor) errores.push({ campo: 'cliente', mensaje: MSG.rncPropio })

  if (c.lineas.length === 0) errores.push({ campo: 'lineas', mensaje: MSG.sinLineas })
  let hayErrorDeLinea = false
  for (const linea of c.lineas) {
    const deLinea = validarLinea(linea, e.admiteDecimales(linea.unidad))
    if (!e.unidadValida(linea.unidad)) deLinea.push({ campo: 'unidad', mensaje: MSG.unidad, linea: linea.id })
    if (deLinea.length > 0) hayErrorDeLinea = true
    errores.push(...deLinea)
  }
  if (c.lineas.length > 0 && !hayErrorDeLinea && !(totales.total > 0)) errores.push({ campo: 'total', mensaje: MSG.total })

  if (c.pago === 'credito') {
    if (cliente === null) errores.push({ campo: 'pago', mensaje: MSG.creditoSinCliente })
    else if (!cliente.permiteCredito || !permiteCredito(c.tipo)) errores.push({ campo: 'pago', mensaje: MSG.soloContado })
    else if (fechaLimiteEfectiva(c, e.hoy) < e.hoy) errores.push({ campo: 'pago', mensaje: MSG.fechaLimite })
  }
  return errores
}

export type EstadoBoton = 'listo' | 'corregir' | 'sinConexion' | 'sinRango' | 'planNoIncluye' | 'sinConfirmar' | 'enCurso'

/** El estado del botón Emitir con su rótulo, y qué hacer: `listo` emite; `corregir` lleva al primer error; los demás no emiten (el botón dice por qué). */
export function estadoBotonEmitir(e: EntradaRevision): { kind: EstadoBoton; etiqueta: string } {
  const tipo = e.carrito.tipo
  if (e.envioEnCurso) return { kind: 'enCurso', etiqueta: 'Hay una emisión en curso: Ver' }
  if (e.envioSinConfirmar) return { kind: 'sinConfirmar', etiqueta: 'Hay un envío sin confirmar: revisa Facturas' }
  if (!e.tipoHabilitado) return { kind: 'planNoIncluye', etiqueta: `Tu plan no incluye E${tipo}` }
  if (!e.enLinea) return { kind: 'sinConexion', etiqueta: 'Sin conexión: borrador guardado' }
  if (e.rangoVigente === false) return { kind: 'sinRango', etiqueta: `No hay numeración vigente para E${tipo}` }
  const errores = validarRevision(e)
  if (errores.length > 0) return { kind: 'corregir', etiqueta: `Corregir ${errores.length} ${errores.length === 1 ? 'campo' : 'campos'}` }
  return { kind: 'listo', etiqueta: `Emitir E${tipo} · ${rd(resumenTotales(e.carrito.lineas).total)}` }
}

/** Por qué un cliente no se puede elegir para este comprobante: sin RNC (el crédito fiscal y el gubernamental lo exigen) o con el RNC de la empresa (no se factura a uno mismo). */
export function estadoFilaCliente(c: { rnc: string | null }, tipo: string, rncEmisor: string): { seleccionable: boolean; motivo: 'sinRnc' | 'rncPropio' | null } {
  const rnc = soloDigitos(c.rnc ?? '')
  const propio = soloDigitos(rncEmisor)
  if (rnc !== '' && propio !== '' && rnc === propio) return { seleccionable: false, motivo: 'rncPropio' }
  if (tipo !== '32' && rnc === '') return { seleccionable: false, motivo: 'sinRnc' }
  return { seleccionable: true, motivo: null }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * ¿Queda numeración vigente para este tipo? Sale de `secuencias` de las estadísticas (GET /api/facturas/stats) y de `estadoNumeracion`, el mismo cálculo del aviso de Facturas: es
 * false solo si el tipo está agotado o, en producción, sin rango registrado. Sin la fila del tipo, o sin estadísticas, es null: no se sabe, y no se bloquea (el servidor decide).
 */
export function rangoVigenteDe(stats: unknown, tipo: string, ambiente: Ambiente, hoy: string): boolean | null {
  const filas = esObjeto(stats) && Array.isArray(stats.secuencias) ? stats.secuencias : []
  for (const fila of filas) {
    if (!esObjeto(fila) || String(fila.type ?? '').replace(/^E/i, '') !== tipo) continue
    const secuencia: SecuenciaStats = {
      type: `E${tipo}`,
      total_emitidos: typeof fila.total_emitidos === 'number' || typeof fila.total_emitidos === 'string' ? fila.total_emitidos : 0,
      restantes: typeof fila.restantes === 'number' || typeof fila.restantes === 'string' ? fila.restantes : null,
      vencimiento: typeof fila.vencimiento === 'string' ? fila.vencimiento : null,
    }
    const estado = estadoNumeracion(secuencia, ambiente, hoy)
    return estado !== 'agotada' && estado !== 'sinRango'
  }
  return null
}

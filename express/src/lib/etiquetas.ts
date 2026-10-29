// Los estados DGII de una factura (`facturas.estado_dgii`) como los lee Express. Cada uno de los 25 que conoce `DGII_LABEL` (src/api/estadosDgii.ts) cae en
// UNA categoría, el «bucket», y de ella salen el chip (texto, tono e icono: el color nunca va solo) y lo que la pantalla ofrece (lib/acciones). Lo que no
// se conoce, el null y el vacío caen en «sin confirmar»: ante la duda no se comparte nada y no se ofrece una emisión nueva. tests/etiquetas.test.ts lee
// `DGII_LABEL` de la app completa y exige que esta tabla tenga las mismas 25 claves, así que un estado nuevo allí no puede quedar sin bucket.
import type { Ambiente } from '~/entitlements'
import type { EstadoNumeracion } from '~/lib/numeracion'

export type Bucket = 'aceptada' | 'enProceso' | 'sinConfirmar' | 'rechazada' | 'noEncontrada' | 'error' | 'reemplazada'

/** Lo que dice un chip de estado: el texto, el tono (el color) y el nombre del icono (ui/Icon). */
interface Etiqueta {
  texto: string
  tono: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
  icono: string
}

/** Un bucket por cada clave de `DGII_LABEL`: lo que no está aquí es desconocido, y `bucketDe` lo trata como «sin confirmar». */
export const PORCLAVE: Record<string, Bucket> = {
  // La DGII lo aceptó (RFCE es el resumen de consumo del E32 de menos de RD$250,000). El último es el condicional cortado a 20 caracteres.
  ACEPTADO: 'aceptada',
  RFCE_ACEPTADO: 'aceptada',
  ACEPTADO_CONDICIONAL: 'aceptada',
  RFCE_ACEPTADO_CONDICIONAL: 'aceptada',
  RFCE_ACEPTADO_CONDIC: 'aceptada',
  // Enviado, con la DGII todavía revisándolo.
  ENVIADO: 'enProceso',
  EN_PROCESO: 'enProceso',
  RFCE_ENVIADO: 'enProceso',
  RFCE_EN_PROCESO: 'enProceso',
  // Sin respuesta de la DGII y sin forma de saber qué pasó: PENDIENTE_ENVIO y ENVIO_INCIERTO son las que están en vuelo (guardadas y firmadas antes de
  // enviar), y PENDIENTE es el valor por defecto de las filas viejas. El número está ocupado: nunca se vuelve a emitir.
  PENDIENTE: 'sinConfirmar',
  PENDIENTE_ENVIO: 'sinConfirmar',
  ENVIO_INCIERTO: 'sinConfirmar',
  RECHAZADO: 'rechazada',
  RFCE_RECHAZADO: 'rechazada',
  NO_ENCONTRADO: 'noEncontrada',
  RFCE_NO_ENCONTRADO: 'noEncontrada',
  ERROR: 'error',
  RFCE_ERROR: 'error',
  // Intentos archivados de un número que se volvió a emitir (`e_ncf` NULL): lo que vale es el comprobante que los reemplazó. Los tres últimos son los
  // mismos cortados a 20 caracteres (VARCHAR(20) antes de la migración 028).
  RECHAZADO_ARCHIVADO: 'reemplazada',
  NO_ENCONTRADO_ARCHIVADO: 'reemplazada',
  RFCE_RECHAZADO_ARCHIVADO: 'reemplazada',
  RFCE_NO_ENCONTRADO_ARCHIVADO: 'reemplazada',
  RFCE_RECHAZADO_ARCHI: 'reemplazada',
  NO_ENCONTRADO_ARCHIV: 'reemplazada',
  RFCE_NO_ENCONTRADO_A: 'reemplazada',
}

/**
 * El bucket de un estado DGII. Lee el texto exacto (el API manda los códigos en mayúsculas: otra grafía no se «arregla») y solo las claves propias de la
 * tabla: `constructor` o `__proto__` no son estados, y un valor que no es texto (una clave de propiedad se convierte a texto: `['ACEPTADO']` leería
 * 'ACEPTADO') tampoco. Todo eso, el null y el vacío son «sin confirmar».
 */
export function bucketDe(estadoDgii: string | null | undefined): Bucket {
  if (typeof estadoDgii !== 'string' || !Object.prototype.hasOwnProperty.call(PORCLAVE, estadoDgii)) return 'sinConfirmar'
  return PORCLAVE[estadoDgii]
}

/** El chip de cada bucket. Los textos son femeninos: son de «la factura». */
const ETIQUETAS: Record<Bucket, Etiqueta> = {
  aceptada: { texto: 'Aceptada', tono: 'ok', icono: 'circle-check' },
  enProceso: { texto: 'En proceso', tono: 'info', icono: 'clock' },
  sinConfirmar: { texto: 'Sin confirmar', tono: 'warn', icono: 'triangle-alert' },
  rechazada: { texto: 'Rechazada', tono: 'danger', icono: 'circle-x' },
  noEncontrada: { texto: 'No encontrada', tono: 'neutral', icono: 'circle-help' },
  error: { texto: 'Error', tono: 'danger', icono: 'circle-alert' },
  reemplazada: { texto: 'Reemplazada', tono: 'neutral', icono: 'rotate-ccw' },
}

/** Dos estados sin confirmar dicen algo más preciso que «Sin confirmar»: el chip conserva el tono y el icono del bucket y cambia solo el texto. */
const TEXTO_PROPIO = new Map([
  ['PENDIENTE_ENVIO', 'Por enviar'],
  ['PENDIENTE', 'Pendiente'],
])

/**
 * El chip de un estado DGII: texto, tono e icono. Un objeto nuevo en cada llamada. El tipo de comprobante se acepta y en v1 no cambia nada (contratos
 * 4.4): el texto es el mismo en un E31, un E45 o una nota de crédito.
 */
export function etiquetaDe(estadoDgii: string | null | undefined, tipoEcf?: string): Etiqueta {
  void tipoEcf
  const base = ETIQUETAS[bucketDe(estadoDgii)]
  const propio = typeof estadoDgii === 'string' ? TEXTO_PROPIO.get(estadoDgii) : undefined
  return { ...base, texto: propio ?? base.texto }
}

const AMBIENTES: Record<Ambiente, { texto: string; tono: 'warn' | 'ok' }> = {
  testecf: { texto: 'PRUEBAS', tono: 'warn' },
  certecf: { texto: 'CERTIFICACIÓN', tono: 'warn' },
  ecf: { texto: 'PRODUCCIÓN', tono: 'ok' },
}

/** El ambiente del tenant como se ve en la cabecera: pruebas y certificación en aviso, solo producción en verde. Un objeto nuevo en cada llamada. */
export function etiquetaAmbiente(a: Ambiente): { texto: string; tono: 'warn' | 'ok' } {
  return { ...AMBIENTES[a] }
}

const TONOS_NUMERACION: Record<EstadoNumeracion, 'danger' | 'warning' | 'ok' | 'neutral'> = {
  agotada: 'danger',
  sinRango: 'danger',
  vencePronto: 'danger',
  pocos: 'warning',
  porVencer: 'warning',
  vigente: 'ok',
  sinLimite: 'neutral',
}

/** El tono de un estado de numeración (anexo 6.12): rojo lo que bloquea o urge, ámbar lo que avisa, verde lo vigente y gris lo que no tiene límite. */
export function tonoNumeracion(e: EstadoNumeracion): 'danger' | 'warning' | 'ok' | 'neutral' {
  return TONOS_NUMERACION[e]
}

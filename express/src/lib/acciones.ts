// Qué ofrece el detalle de una factura según su estado DGII y su tipo (anexo 6.3, «Actions by state»). Es una tabla pura: dibujar los botones y lo que hace cada uno son de la
// pantalla (screens/Detalle). Dos reglas mandan sobre todas las filas: lo que la DGII no ha aceptado (en proceso, sin confirmar, rechazado, no encontrado, con error,
// archivado, el null y lo que no se conoce) nunca ofrece Compartir, copiar el e-NCF, el PDF ni la tarjeta de datos; y lo incierto (el bucket «sin confirmar») y lo que dio
// error nunca ofrece una emisión nueva: ni Duplicar, ni Corregir, ni Anular, ni Reenviar.
//
// Tres familias de tipo: las ventas que Express emite (E31, E32, E45), las notas (E33, E34) y cualquier otro código (E41...), que solo conserva lo que no emite nada nuevo.
import { anuladaPor } from '@/features/invoices/notasVinculadas'
import { puedeReenviarFactura } from '@/features/invoices/reenvio'
import { bucketDe } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import type { FacturaVista } from '~/lib/filas'
import { esTipoDeVenta } from '~/lib/tiposEcf'

export type AccionId =
  | 'compartir'
  | 'verificar'
  | 'soporte'
  | 'duplicar'
  | 'anular'
  | 'abrirPdf'
  | 'copiarNcf'
  | 'reenviar'
  | 'corregir'
  | 'reintentarAnulacion'
  | 'verOriginal'
  | 'buscarReemplazo'

/** La tarjeta de estado que lleva el detalle: lo que se dice de lo que la DGII no ha dado por bueno. */
export type AvisoDeEstado = 'sinConfirmar' | 'rechazada' | 'noEncontrada'

export interface Acciones {
  primaria: AccionId | null
  secundaria: AccionId | null
  mas: AccionId[]
  /** El e-NCF de la nota de crédito aceptada que anula la factura (puede ser el texto vacío si la nota no trae el suyo); null si no está anulada. Se decide con `!== null`. */
  anuladaPor: string | null
  /** La tarjeta de «Datos DGII y QR»: solo de lo que la DGII aceptó. */
  mostrarDatosDgii: boolean
  aviso: AvisoDeEstado | null
}

type Familia = 'venta' | 'nota' | 'otro'

interface Fila {
  primaria: AccionId | null
  secundaria: AccionId | null
  mas: AccionId[]
}

const familiaDe = (tipo: string): Familia => (esTipoDeVenta(tipo) ? 'venta' : tipo === '33' || tipo === '34' ? 'nota' : 'otro')

/** Lo que una factura anulada ya no ofrece: anular otra vez, reenviar el número (la anulación ya lo cerró) y duplicar. */
const NO_SI_ANULADA: ReadonlySet<AccionId> = new Set<AccionId>(['anular', 'reenviar', 'duplicar'])

const AVISOS: Partial<Record<Bucket, AvisoDeEstado>> = { sinConfirmar: 'sinConfirmar', rechazada: 'rechazada', noEncontrada: 'noEncontrada' }

/** La fila de la tabla del anexo para este estado y esta familia, sin la regla de las facturas anuladas. Arreglos nuevos en cada llamada. */
function filaDe(f: FacturaVista, bucket: Bucket, familia: Familia): Fila {
  const venta = familia === 'venta'
  const reenvia = puedeReenviarFactura(f.estado, f.secuenciaUtilizada)
  switch (bucket) {
    case 'aceptada':
      return { primaria: 'compartir', secundaria: venta ? 'duplicar' : familia === 'nota' ? 'verOriginal' : null, mas: venta ? ['anular', 'abrirPdf', 'copiarNcf'] : ['abrirPdf', 'copiarNcf'] }
    case 'enProceso':
      if (venta) return { primaria: 'verificar', secundaria: null, mas: ['duplicar'] }
      return { primaria: 'verificar', secundaria: familia === 'nota' ? 'soporte' : null, mas: [] }
    case 'sinConfirmar':
      return { primaria: 'verificar', secundaria: 'soporte', mas: [] }
    case 'rechazada':
      if (venta) return { primaria: reenvia ? 'reenviar' : 'corregir', secundaria: reenvia ? 'corregir' : null, mas: ['duplicar'] }
      if (familia === 'nota') return { primaria: reenvia ? 'reenviar' : 'reintentarAnulacion', secundaria: 'verOriginal', mas: [] }
      return { primaria: reenvia ? 'reenviar' : null, secundaria: null, mas: [] }
    case 'noEncontrada':
      return { primaria: reenvia ? 'reenviar' : 'verificar', secundaria: reenvia ? 'verificar' : null, mas: venta ? ['duplicar'] : [] }
    case 'error':
      return { primaria: typeof f.trackId === 'string' && f.trackId !== '' ? 'verificar' : 'soporte', secundaria: null, mas: [] }
    case 'reemplazada':
      return { primaria: 'buscarReemplazo', secundaria: null, mas: [] }
  }
}

/** Quita de la fila lo que una factura anulada no ofrece. La secundaria sube si la principal se va: una fila nunca queda con secundaria y sin principal. */
function sinLoAnulado(fila: Fila): Fila {
  const quedan = [fila.primaria, fila.secundaria].filter((id): id is AccionId => id !== null && !NO_SI_ANULADA.has(id))
  return { primaria: quedan[0] ?? null, secundaria: quedan[1] ?? null, mas: fila.mas.filter((id) => !NO_SI_ANULADA.has(id)) }
}

/** Las acciones del detalle de una factura (anexo 6.3). Un objeto nuevo, con arreglos nuevos, en cada llamada: quien cambie uno no cambia la fila siguiente. */
export function accionesDe(f: FacturaVista): Acciones {
  const bucket = bucketDe(f.estado)
  const anulada = anuladaPor(f.notas)
  const fila = filaDe(f, bucket, familiaDe(f.tipo))
  const final = anulada === null ? fila : sinLoAnulado(fila)
  return { ...final, anuladaPor: anulada === null ? null : anulada.ncf, mostrarDatosDgii: bucket === 'aceptada', aviso: AVISOS[bucket] ?? null }
}

/** ¿Se vuelve a preguntar a la DGII por una factura en este bucket? Solo lo que está en el aire (en proceso y sin confirmar); lo final no. */
export function esSondeable(bucket: Bucket): boolean {
  return bucket === 'enProceso' || bucket === 'sinConfirmar'
}

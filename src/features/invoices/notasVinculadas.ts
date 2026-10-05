// Notas de crédito (E34) y débito (E33) vinculadas a una factura: qué se dice
// en el listado y en el detalle, y cómo suman los montos. Sin React ni alias en
// tiempo de ejecución: scripts/test-notas-vinculadas.ts lo prueba con Node.
//
// La API (GET /api/facturas y ?id=) trae en cada fila `notas` (las notas que la
// modifican, por id ascendente) y `modifica` (en una nota, el comprobante que
// modifica). PDO manda los INT y los DECIMAL como texto: aquí se convierten.
import type { FacturaModificaRow, FacturaNotaRow } from '@/api'
import type { ComprobanteModificado, NotaVinculada } from '@/types/domain'

const NOTA_CREDITO = '34'
const NOTA_DEBITO = '33'
/** CodigoModificacion DGII que anula el comprobante. */
const CODIGO_ANULA = '1'

const PROPOSITO: Record<string, string> = {
  '1': 'Anula',
  '2': 'Corrige texto',
  '3': 'Corrige montos',
  '4': 'Reemplazo de contingencia',
  '5': 'Referencia a factura de consumo',
}

/** Número desde lo que mande la API; null si no viene o no es número. */
const numeroONulo = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Redondeo a centavos que además quita el -0 (Money pintaría "−0.00"). */
const centavos = (n: number): number => Math.round(n * 100) / 100 || 0

/** ¿Es una nota de crédito (E34)? Su monto resta. */
export const esNotaCredito = (tipo: string | null | undefined): boolean => tipo === NOTA_CREDITO

/** "Nota de crédito" / "Nota de débito"; '' para otro tipo. */
export function tipoNotaLabel(tipo: string | null | undefined): string {
  if (tipo === NOTA_CREDITO) return 'Nota de crédito'
  if (tipo === NOTA_DEBITO) return 'Nota de débito'
  return ''
}

/** Propósito de una nota según su CodigoModificacion; '' si no hay o no se conoce. */
export function propositoNota(codigo: string | null | undefined): string {
  return codigo == null ? '' : PROPOSITO[String(codigo).trim()] ?? ''
}

/** Monto con el signo con que cuenta: el de una nota de crédito, negativo. */
export function conSigno(tipo: string | null | undefined, monto: number | string | null | undefined): number {
  const n = numeroONulo(monto) ?? 0
  return (esNotaCredito(tipo) ? -n : n) || 0
}

/** Total e ITBIS de un grupo de comprobantes, con las notas de crédito restando. */
export function sumaConSigno(filas: readonly { tipo: string; total: number; itbis: number }[]): { total: number; itbis: number } {
  let total = 0
  let itbis = 0
  for (const f of filas) {
    total += conSigno(f.tipo, f.total)
    itbis += conSigno(f.tipo, f.itbis)
  }
  return { total: centavos(total), itbis: centavos(itbis) }
}

/**
 * KPI "Monto total" del listado: el monto_neto del backend (notas de crédito
 * restando, sin rechazados). Un backend anterior no lo trae: entonces
 * monto_total menos lo rechazado, como antes.
 */
export function montoTotalKpi(
  resumen: { monto_total?: number | string | null; monto_neto?: number | string | null } | null | undefined,
  montoRechazado: number,
): number {
  const neto = numeroONulo(resumen?.monto_neto)
  if (neto != null) return neto
  return (numeroONulo(resumen?.monto_total) ?? 0) - montoRechazado
}

/** Notas de una fila de la API, con id y total en número. [] si no trae. */
export function notasDeFila(r: { notas?: FacturaNotaRow[] | null }): NotaVinculada[] {
  if (!Array.isArray(r.notas)) return []
  return r.notas.map((n) => {
    const codigo = n.codigo_modificacion == null ? '' : String(n.codigo_modificacion).trim()
    return {
      id: Number(n.id),
      ncf: String(n.e_ncf ?? ''),
      tipo: String(n.tipo_ecf ?? ''),
      codigoModificacion: codigo === '' ? null : codigo,
      total: numeroONulo(n.total) ?? 0,
      estadoDgii: String(n.estado_dgii ?? ''),
      fecha: n.date ?? null,
    }
  })
}

/** Comprobante que modifica una nota, con id y total en número; null si no aplica. */
export function modificaDeFila(r: { modifica?: FacturaModificaRow | null }): ComprobanteModificado | null {
  const m = r.modifica
  if (!m || !m.e_ncf) return null
  return {
    id: numeroONulo(m.id),
    ncf: String(m.e_ncf),
    tipo: m.tipo_ecf ?? null,
    total: numeroONulo(m.total),
    fecha: m.date ?? null,
  }
}

/** La nota de crédito que anula el comprobante (código 1), o null. */
export function anuladaPor(notas: readonly NotaVinculada[] | null | undefined): NotaVinculada | null {
  return notas?.find((n) => esNotaCredito(n.tipo) && n.codigoModificacion === CODIGO_ANULA) ?? null
}

export interface LineaVinculo {
  texto: string
  tono: 'danger' | 'muted'
}

/**
 * Líneas cortas bajo el e-NCF en el listado. En una nota, primero el
 * comprobante que modifica; después, si la fila tiene notas, la que la anula
 * (en rojo) o la primera, con " +N" por las demás.
 */
export function lineasVinculo(f: {
  notas?: readonly NotaVinculada[] | null
  modifica?: ComprobanteModificado | null
}): LineaVinculo[] {
  const lineas: LineaVinculo[] = []
  if (f.modifica) lineas.push({ texto: `Modifica ${f.modifica.ncf}`, tono: 'muted' })
  const notas = f.notas ?? []
  if (notas.length > 0) {
    const mas = notas.length > 1 ? ` +${notas.length - 1}` : ''
    const anula = anuladaPor(notas)
    if (anula) {
      lineas.push({ texto: `Anulada por ${anula.ncf}${mas}`, tono: 'danger' })
    } else {
      const primera = notas[0]
      lineas.push({ texto: `${tipoNotaLabel(primera.tipo) || 'Nota'} ${primera.ncf}${mas}`, tono: 'muted' })
    }
  }
  return lineas
}

export interface FilaRelacionada {
  clave: string
  /** null: el comprobante no está en Fiscalo y no se puede abrir. */
  id: number | null
  ncf: string
  /** "Modifica", "Nota de crédito" o "Nota de débito". */
  relacion: string
  tipo: string | null
  proposito: string
  /** Con signo (la nota de crédito, negativa); null si no se conoce. */
  monto: number | null
  estadoDgii: string | null
  fecha: string | null
}

/**
 * Filas de la tarjeta "Comprobantes relacionados" del detalle: el comprobante
 * que modifica (con el propósito de la propia nota) y cada nota que la modifica.
 */
export function filasRelacionadas(f: {
  notas?: readonly NotaVinculada[] | null
  modifica?: ComprobanteModificado | null
  codigoModificacion?: string | null
}): FilaRelacionada[] {
  const filas: FilaRelacionada[] = []
  const m = f.modifica
  if (m) {
    filas.push({
      clave: 'modifica',
      id: m.id,
      ncf: m.ncf,
      relacion: 'Modifica',
      tipo: m.tipo,
      proposito: propositoNota(f.codigoModificacion),
      monto: m.total == null ? null : conSigno(m.tipo, m.total),
      estadoDgii: null,
      fecha: m.fecha,
    })
  }
  for (const n of f.notas ?? []) {
    filas.push({
      clave: `nota-${n.id}`,
      id: n.id,
      ncf: n.ncf,
      relacion: tipoNotaLabel(n.tipo) || 'Nota',
      tipo: n.tipo,
      proposito: propositoNota(n.codigoModificacion),
      monto: conSigno(n.tipo, n.total),
      estadoDgii: n.estadoDgii || null,
      fecha: n.fecha,
    })
  }
  return filas
}

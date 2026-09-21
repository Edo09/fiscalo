// Cambios de un registro de la bitácora: old_values vs new_values, campo a campo.

export interface FilaCambio {
  campo: string
  antes: unknown
  despues: unknown
  /** false = mismo valor antes y después (solo en modificaciones). */
  cambio: boolean
}

export type Registro = Record<string, unknown>

export function esRegistro(v: unknown): v is Registro {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Filas campo por campo. Con antes y después (modificación) marca qué cambió;
 * con uno solo (alta o baja), todas las filas cuentan como cambio.
 */
export function filasCambio(antes: unknown, despues: unknown): FilaCambio[] {
  const a = esRegistro(antes) ? antes : null
  const d = esRegistro(despues) ? despues : null
  if (!a && !d) return []
  const campos = Array.from(new Set([...Object.keys(a ?? {}), ...Object.keys(d ?? {})]))
  return campos.map((campo) => ({
    campo,
    antes: a?.[campo],
    despues: d?.[campo],
    cambio: a && d ? !igual(a[campo], d[campo]) : true,
  }))
}

/** El backend reemplaza los secretos por este texto antes de guardar. */
export const REDACTADO = '***REDACTED***'

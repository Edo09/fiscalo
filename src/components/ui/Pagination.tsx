// Paginación: resumen de rango, selector de tamaño de página y páginas numeradas.
// Pensada para listados servidos por la API (`pagination` del backend). Si no
// llega `totalPages`, degrada a Anterior/Siguiente usando `count` vs `pageSize`.
import { Btn } from './Btn'

const DEFAULT_SIZES = [10, 25, 50]

export interface PaginationProps {
  page: number
  /** Total de páginas (del backend). Si es null, se usa prev/next simple. */
  totalPages?: number | null
  /** Total de registros (del backend) para el resumen "de N". */
  total?: number | null
  pageSize: number
  /** Nº de filas en la página actual (resumen + fallback de "siguiente"). */
  count: number
  onPage: (page: number) => void
  /** Si se pasa, muestra el selector de tamaño de página. */
  onPageSize?: (size: number) => void
  pageSizeOptions?: number[]
  /** Solo resumen + selector (sin botones de página). Para la barra superior. */
  compact?: boolean
  /** Clase del contenedor (margen). Por defecto `mt-md`. */
  className?: string
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  count,
  onPage,
  onPageSize,
  pageSizeOptions = DEFAULT_SIZES,
  compact = false,
  className,
}: PaginationProps) {
  const hasNext = totalPages != null ? page < totalPages : count >= pageSize
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1
  const to = total != null ? Math.min(page * pageSize, total) : (page - 1) * pageSize + count

  const summary = (
    <div className="row gap-md">
      <span className="text-sm muted-3">
        {total != null ? `Mostrando ${from}–${to} de ${total}` : `Página ${page}`}
      </span>
      {onPageSize && (
        <label className="row gap-sm text-sm muted-3">
          Por página
          <select
            className="select"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            style={{ width: 'auto', padding: '5px 8px' }}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )

  if (compact) {
    return <div className={'row ' + (className ?? 'mb-sm')}>{summary}</div>
  }

  const pages = pageNumbers(page, totalPages ?? null)
  return (
    <div className={'row between ' + (className ?? 'mt-md')} style={{ flexWrap: 'wrap', gap: 12 }}>
      {summary}
      <div className="row gap-sm">
        <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Btn>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="muted-3" style={{ padding: '0 4px' }}>…</span>
          ) : (
            <Btn key={p} variant={p === page ? 'primary' : 'secondary'} size="sm" onClick={() => onPage(p)}>
              {p}
            </Btn>
          ),
        )}
        <Btn variant="secondary" size="sm" iconRight="chevron-right" disabled={!hasNext} onClick={() => onPage(page + 1)}>
          Siguiente
        </Btn>
      </div>
    </div>
  )
}

/**
 * Páginas a mostrar con elipsis. `[]` si no hay `totalPages` (fallback prev/next).
 * ≤7 páginas: todas. Si no: 1 … (page±1) … N.
 */
function pageNumbers(page: number, totalPages: number | null): (number | '…')[] {
  if (!totalPages || totalPages < 1) return []
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const lo = Math.max(2, page - 1)
  const hi = Math.min(totalPages - 1, page + 1)
  if (lo > 2) out.push('…')
  for (let p = lo; p <= hi; p++) out.push(p)
  if (hi < totalPages - 1) out.push('…')
  out.push(totalPages)
  return out
}

// FISCALO — Buscador del catálogo para AGREGAR productos a un documento.
// A diferencia de ProveedorCombobox no guarda un valor: cada elección se le
// entrega al padre, que arma la línea, y el buscador queda listo para la
// siguiente. Busca en el servidor con debounce: el catálogo tiene cientos de
// artículos y filtrar solo la primera página dejaría fuera la mayoría.
import { useEffect, useRef, useState } from 'react'
import { Icon, Money, Spinner } from '@/components/ui'
import { listProducts, mapProductRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Producto } from '@/types/domain'

interface ProductoComboboxProps {
  onSelect: (producto: Producto) => void
  placeholder?: string
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
}

export function ProductoCombobox({
  onSelect,
  placeholder = 'Buscar producto por nombre, SKU o categoría…',
  debounceMs = 250,
}: ProductoComboboxProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  const { data, loading, error, fetching } = useApiQuery(
    ['products', 'search', query],
    () => listProducts({ query: query || undefined, pageSize: 8 }),
    { keepPrevious: true },
  )
  const rows = (data?.items ?? []).map(mapProductRow)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const select = (p: Producto) => {
    onSelect(p)
    setInput('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="combobox">
      <div className="search-input" style={{ width: '100%' }}>
        <Icon name="package" />
        <input
          placeholder={placeholder}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {fetching && <Spinner />}
      </div>

      {open && (
        <div className="menu combobox-menu">
          {error ? (
            <div className="combobox-msg" style={{ color: 'var(--danger)' }}>{error}</div>
          ) : loading && rows.length === 0 ? (
            <div className="combobox-msg row gap-sm" style={{ justifyContent: 'center' }}><Spinner /> Buscando…</div>
          ) : rows.length === 0 ? (
            <div className="combobox-msg">
              {query ? `Ningún producto coincide con “${query}”.` : 'No hay productos en el catálogo.'}
            </div>
          ) : (
            rows.map((p) => (
              <div
                key={p.id}
                className="combobox-item row between gap-sm"
                style={{ alignItems: 'center' }}
                onClick={() => select(p)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="cell-main">{p.nombre}</div>
                  <div className="cell-sub mono">
                    {[p.sku, p.cat !== '—' ? p.cat : '', p.tipo === 'Servicio' ? 'Servicio' : `Existencia ${p.stock ?? 0}`]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </div>
                </div>
                <span className="text-xs muted" style={{ whiteSpace: 'nowrap' }}>
                  Costo <Money value={p.costo} cur={false} />
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

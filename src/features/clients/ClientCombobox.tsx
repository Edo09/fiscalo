// FISCALO — Buscador de clientes con autocompletado.
// Cada tecla (con debounce) consulta GET /api/clients?query=... y muestra las
// coincidencias en un desplegable. Al elegir una, devuelve el Cliente mapeado.
import { useEffect, useRef, useState } from 'react'
import { Icon, Avatar, Spinner } from '@/components/ui'
import { listClients, mapClientRow } from '@/api'
import type { ClientRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Cliente } from '@/types/domain'

interface ClientComboboxProps {
  value: Cliente | null
  onChange: (cliente: Cliente | null) => void
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
}

/** Nombre principal (persona/contacto) que se muestra en negrita. */
function clientName(r: ClientRow): string {
  return r.client_name || r.razon_social || r.company_name || `Cliente #${r.id}`
}

/** Subtítulo "Empresa · correo · RNC" para una fila de cliente. */
function clientSub(r: ClientRow): string {
  const rnc = (r.rnc ?? '').trim()
  return [r.company_name || r.razon_social || '', r.email || '', rnc ? `RNC ${rnc}` : '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join('  ·  ')
}

export function ClientCombobox({ value, onChange, debounceMs = 250 }: ClientComboboxProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce: la consulta real solo se actualiza tras `debounceMs` sin teclear.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  // GET /api/clients?query=... — cacheado por término; keepPrevious evita el
  // parpadeo mientras llega el resultado del nuevo término tecleado.
  const { data, loading, error, fetching } = useApiQuery(
    ['clients', 'search', query],
    () => listClients({ query, pageSize: 8 }),
    { keepPrevious: true },
  )
  const rows = data?.items ?? []

  // Cerrar el desplegable al hacer click fuera del componente.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const select = (r: ClientRow) => {
    onChange(mapClientRow(r))
    setOpen(false)
    setInput('')
  }

  const clear = () => {
    onChange(null)
    setInput('')
    setQuery('')
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // Cliente ya elegido: ficha con nombre, empresa y RNC, y botón para cambiarlo.
  if (value) {
    const nombre = value.contacto || value.nombre
    const empresa = value.empresa && value.empresa !== nombre ? value.empresa : ''
    return (
      <div className="input row between" style={{ height: 'auto', padding: '8px 11px' }}>
        <span className="row gap-sm">
          <Avatar name={nombre} size={32} />
          <span className="col">
            <span className="fw6 text-sm">{nombre}</span>
            {empresa && <span className="text-xs muted">{empresa}</span>}
            <span className="text-xs muted mono">{value.doc ? `RNC ${value.doc}` : 'sin RNC'}</span>
          </span>
        </span>
        <button type="button" className="icon-btn" onClick={clear} title="Cambiar cliente">
          <Icon name="x" size={15} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="combobox">
      <div className="search-input" style={{ width: '100%' }}>
        <Icon name="search" />
        <input
          ref={inputRef}
          placeholder="Buscar cliente por nombre, RNC o correo…"
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
            <div className="combobox-msg">{query ? `Sin resultados para “${query}”.` : 'Escribe para buscar un cliente.'}</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="combobox-item" onClick={() => select(r)}>
                <div className="cell-main">{clientName(r)}</div>
                <div className="cell-sub mono">{clientSub(r)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

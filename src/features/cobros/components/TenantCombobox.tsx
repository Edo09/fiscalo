// Buscador de tenants para Cobros de tenants (la plataforma le cobra a las empresas que la usan): cada tecla (con demora)
// consulta GET /api/cobros-tenants/clientes?query=… y muestra las coincidencias en un desplegable, con el aspecto de
// ClientCombobox. Al elegir una avisa con su id y su nombre: quien lo usa decide qué hace (abrir su panel, filtrar, crear un cobro).
import { useEffect, useRef, useState } from 'react'
import { Icon, Spinner } from '@/components/ui'
import { useAmbitoCobros } from '../ambito'
import { detalleTenant } from '../format'
import { useBuscarTenants } from '../hooks'

interface Props {
  onElegir: (id: number, nombre: string) => void
  /** Marca el buscador en rojo (el formulario encontró un problema con la empresa). */
  invalido?: boolean
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
}

export function TenantCombobox({ onElegir, invalido = false, debounceMs = 250 }: Props) {
  const { textos } = useAmbitoCobros()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // La consulta real solo se actualiza tras `debounceMs` sin teclear.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  const { data, loading, error, fetching } = useBuscarTenants(query)
  const filas = data ?? []

  // Cerrar el desplegable al hacer click fuera del componente.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={ref} className="combobox">
      <div className={'search-input' + (invalido ? ' search-input--err' : '')} style={{ width: '100%' }}>
        <Icon name="search" />
        <input
          aria-invalid={invalido || undefined}
          placeholder={textos.buscarPlaceholder}
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
          ) : loading && filas.length === 0 ? (
            <div className="combobox-msg row gap-sm" style={{ justifyContent: 'center' }}><Spinner /> Buscando…</div>
          ) : filas.length === 0 ? (
            <div className="combobox-msg">{query ? `Sin resultados para “${query}”.` : 'No hay empresas registradas.'}</div>
          ) : (
            filas.map((t) => (
              <div
                key={t.id} className="combobox-item"
                onClick={() => { onElegir(t.id, t.nombre); setOpen(false); setInput('') }}
              >
                <div className="cell-main">{t.nombre}</div>
                <div className="cell-sub mono">{detalleTenant(t)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

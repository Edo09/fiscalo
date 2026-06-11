// FISCALO — Buscador de proveedores con autocompletado y alta inline.
// Cada tecla (con debounce) consulta GET /api/proveedores?query=... y muestra
// coincidencias; si no existe, permite CREARLO sin salir del formulario
// (razón social y RNC obligatorios) vía POST /api/proveedores.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Avatar, Btn, Spinner } from '@/components/ui'
import { ApiError, createProveedor, listProveedores, mapProveedorRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Proveedor } from '@/types/domain'

interface ProveedorComboboxProps {
  value: Proveedor | null
  onChange: (proveedor: Proveedor | null) => void
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
}

export function ProveedorCombobox({ value, onChange, debounceMs = 250 }: ProveedorComboboxProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Alta inline (razón social + RNC obligatorios)
  const [creating, setCreating] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoRnc, setNuevoRnc] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => clearTimeout(t)
  }, [input, debounceMs])

  const { data, loading, error, fetching } = useApiQuery(
    ['proveedores', 'search', query],
    () => listProveedores({ query, pageSize: 8 }),
    { keepPrevious: true },
  )
  const rows = (data?.items ?? []).map(mapProveedorRow)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false) }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const select = (p: Proveedor) => {
    onChange(p)
    setOpen(false)
    setCreating(false)
    setInput('')
  }

  const clear = () => {
    onChange(null)
    setInput('')
    setQuery('')
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const startCreate = () => {
    setCreating(true)
    setCreateError(null)
    setNuevoNombre(input.trim())
    setNuevoRnc('')
  }

  const submitCreate = async () => {
    const nombre = nuevoNombre.trim()
    const rncDigits = nuevoRnc.replace(/\D/g, '')
    if (!nombre) { setCreateError('La razón social es obligatoria.'); return }
    if (rncDigits.length !== 9 && rncDigits.length !== 11) {
      setCreateError('El RNC debe tener 9 dígitos (RNC) u 11 (cédula).')
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await createProveedor({ nombre, rnc: rncDigits, activo: true })
      void queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success(`Proveedor "${nombre}" creado.`)
      select({
        id: String(res.id), nombre, rnc: rncDigits,
        contacto: '', tel: '', balance: 0, compras: 0, activo: true,
      })
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : 'No se pudo crear el proveedor.')
      setCreateBusy(false)
    }
  }

  // Proveedor ya elegido: ficha compacta con botón para cambiarlo.
  if (value) {
    return (
      <div className="input row between" style={{ height: 'auto', padding: '8px 11px' }}>
        <span className="row gap-sm">
          <Avatar name={value.nombre} size={28} />
          <span className="col">
            <span className="fw6 text-sm">{value.nombre}</span>
            <span className="text-xs muted mono">{value.rnc ? `RNC ${value.rnc}` : 'sin RNC'}</span>
          </span>
        </span>
        <button type="button" className="icon-btn" onClick={clear} title="Cambiar proveedor">
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
          placeholder="Buscar proveedor por nombre o RNC…"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); setCreating(false) }}
          onFocus={() => setOpen(true)}
        />
        {fetching && <Spinner />}
      </div>

      {open && (
        <div className="menu combobox-menu">
          {creating ? (
            <div style={{ padding: 12 }}>
              <div className="fw6 text-sm mb-sm">Nuevo proveedor</div>
              {createError && (
                <div className="row gap-sm" style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>
                  <Icon name="alert-circle" size={14} /><span>{createError}</span>
                </div>
              )}
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="label">Razón social <span className="req">*</span></label>
                <input className="input" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Suplidora XYZ SRL" autoFocus />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="label">RNC / Cédula <span className="req">*</span></label>
                <input className="input mono" value={nuevoRnc} onChange={(e) => setNuevoRnc(e.target.value)} placeholder="131880681" />
              </div>
              <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                <Btn variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancelar</Btn>
                <Btn variant="primary" size="sm" icon="check" onClick={submitCreate} disabled={createBusy}>
                  {createBusy ? 'Creando…' : 'Crear y usar'}
                </Btn>
              </div>
            </div>
          ) : (
            <>
              {error ? (
                <div className="combobox-msg" style={{ color: 'var(--danger)' }}>{error}</div>
              ) : loading && rows.length === 0 ? (
                <div className="combobox-msg row gap-sm" style={{ justifyContent: 'center' }}><Spinner /> Buscando…</div>
              ) : rows.length === 0 ? (
                <div className="combobox-msg">{query ? `Sin resultados para “${query}”.` : 'Escribe para buscar un proveedor.'}</div>
              ) : (
                rows.map((p) => (
                  <div key={p.id} className="combobox-item" onClick={() => select(p)}>
                    <div className="cell-main">{p.nombre}</div>
                    <div className="cell-sub mono">
                      {[p.rnc ? `RNC ${p.rnc}` : '', p.contacto].filter(Boolean).join('  ·  ') || '—'}
                    </div>
                  </div>
                ))
              )}
              <div
                className="combobox-item row gap-sm"
                style={{ color: 'var(--accent)', fontWeight: 600, alignItems: 'center', borderTop: '1px solid var(--border)' }}
                onClick={startCreate}
              >
                <Icon name="plus" size={15} />
                <span className="text-sm">Crear nuevo proveedor{input.trim() ? ` “${input.trim()}”` : ''}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

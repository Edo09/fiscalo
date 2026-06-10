import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui'
import { NAV, type Nav } from '@/config/navigation'
import { DATA } from '@/data/mockData'

interface Result {
  type: string
  label: string
  icon: string
  action: () => void
}

export function SearchPalette({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const D = DATA
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const pages: Result[] = NAV.flatMap((g) => g.items).map((i) => ({ type: 'Página', label: i.label, icon: i.icon, action: () => nav(i.id) }))
  const facturas: Result[] = D.facturas.map((f) => ({ type: 'Factura', label: `${f.ncf} · ${f.cliente}`, icon: 'file-text', action: () => nav('factura-ver', f) }))
  const clientes: Result[] = D.clientes.map((c) => ({ type: 'Cliente', label: c.nombre, icon: 'user', action: () => nav('clientes') }))
  const all = [...pages, ...facturas, ...clientes]
  const results = q ? all.filter((r) => r.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : pages.slice(0, 6)

  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="row gap-sm" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={18} className="muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar facturas, clientes, páginas…" style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 15, flex: 1, color: 'var(--text)' }} />
          <span className="kbd">ESC</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 ? (
            <div className="state" style={{ padding: 32 }}><span className="text-sm muted">Sin resultados para "{q}"</span></div>
          ) : results.map((r, i) => (
            <div key={i} className="menu-item" style={{ padding: '10px 12px' }} onClick={() => { r.action(); onClose() }}>
              <Icon name={r.icon} size={16} />
              <span style={{ flex: 1 }}>{r.label}</span>
              <span className="badge badge-neutral">{r.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

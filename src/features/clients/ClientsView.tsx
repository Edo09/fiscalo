import { useState } from 'react'
import { Icon, Btn, Avatar, Card, KPI, Drawer, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listClients, mapClientRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import type { Cliente } from '@/types/domain'

const PAGE_SIZE = 20

/* FISCALO — Clientes (GET /api/clients) */
export function ClientsView({ nav }: { nav: Nav }) {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [perfil, setPerfil] = useState<Cliente | null>(null)

  const { data, error, loading, reload } = useApiQuery(
    ['clients', 'list', { page, pageSize: PAGE_SIZE, query }],
    () => listClients({ page, pageSize: PAGE_SIZE, query }),
    { keepPrevious: true },
  )

  const rows = (data?.items ?? []).map(mapClientRow)
  const total = data?.total ?? null
  const conRnc = rows.filter((c) => c.doc).length
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE

  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  return (
    <div className="page page-wide">
      <PageHead title="Clientes" sub={total != null ? `${total} clientes registrados` : 'Clientes registrados'}
        actions={<><Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn><Btn variant="primary" icon="user-plus">Nuevo cliente</Btn></>} />

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="En esta página" value={rows.length} icon="users" />
        <KPI label="Con RNC/Cédula" value={conRnc} icon="user-check" iconBg="var(--success-soft)" iconColor="var(--success)" />
        <KPI label="Total registrados" value={total ?? rows.length} icon="layers" />
        <KPI label="Página" value={page} icon="file-text" />
      </div>

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar cliente…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los clientes" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="No hay clientes">{query ? `Sin resultados para "${query}".` : 'Aún no hay clientes registrados.'}</EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Cliente</th><th>RNC / Cédula</th><th>Ciudad</th><th>Correo</th><th>Teléfono</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setPerfil(c)}>
                    <td><div className="row gap-sm"><Avatar name={c.nombre} size={30} /><div><span className="cell-main">{c.nombre}</span>{c.contacto && <div className="cell-sub">{c.contacto}</div>}</div></div></td>
                    <td>{c.doc ? <><span className="mono text-sm">{c.doc}</span><div className="cell-sub">{c.tipo}</div></> : <span className="muted-3">—</span>}</td>
                    <td className="muted text-sm">{c.ciudad || '—'}</td>
                    <td className="muted text-sm">{c.email || '—'}</td>
                    <td className="muted text-sm">{c.tel || '—'}</td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && (rows.length > 0 || page > 1) && (
        <div className="row between mt-md">
          <span className="text-sm muted-3">Página {page}{total != null ? ` · ${total} en total` : ''}</span>
          <div className="row gap-sm">
            <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Btn>
            <Btn variant="secondary" size="sm" iconRight="chevron-right" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        </div>
      )}

      {perfil && <ClientProfile cliente={perfil} nav={nav} onClose={() => setPerfil(null)} />}
    </div>
  )
}

function ClientProfile({ cliente, nav, onClose }: { cliente: Cliente; nav: Nav; onClose: () => void }) {
  const c = cliente
  return (
    <Drawer title={c.nombre} sub={c.doc ? `${c.tipo}: ${c.doc}` : 'Sin documento'} width={560} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cerrar</Btn><Btn variant="primary" icon="plus" onClick={() => { onClose(); nav('factura-nueva') }}>Nueva factura</Btn></>}>
      <div className="row gap-md mb-lg">
        <Avatar name={c.nombre} size={52} />
        <div style={{ flex: 1 }}>
          <div className="fw6" style={{ fontSize: 16 }}>{c.nombre}</div>
          {c.contacto && <div className="text-sm muted">{c.contacto}</div>}
          {c.doc && <div className="text-xs muted-3 mono">{c.tipo}: {c.doc}</div>}
        </div>
      </div>

      <div className="card card-pad col gap-md">
        <div className="row gap-sm"><Icon name="mail" size={16} className="muted" /><span className="text-sm">{c.email || 'Sin correo'}</span></div>
        <div className="row gap-sm"><Icon name="phone" size={16} className="muted" /><span className="text-sm">{c.tel || 'Sin teléfono'}</span></div>
        <div className="row gap-sm"><Icon name="map-pin" size={16} className="muted" /><span className="text-sm">{c.ciudad || 'Sin ciudad'}</span></div>
      </div>
    </Drawer>
  )
}

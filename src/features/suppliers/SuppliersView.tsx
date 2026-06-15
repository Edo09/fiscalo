import { useState } from 'react'
import { Icon, Btn, RefreshButton, Avatar, Badge, Card, PageHead, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { listProveedores, mapProveedorRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ProveedorFormModal } from './ProveedorFormModal'
import type { Proveedor } from '@/types/domain'

const PAGE_SIZE = 20

/* FISCALO — Proveedores (GET /api/proveedores) */
export function SuppliersView() {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<{ proveedor: Proveedor | null } | null>(null)

  const { data, error, loading, reload } = useApiQuery(
    ['proveedores', 'list', { page, pageSize: PAGE_SIZE, query }],
    () => listProveedores({ page, pageSize: PAGE_SIZE, query }),
    { keepPrevious: true },
  )

  const rows = (data?.items ?? []).map(mapProveedorRow)
  const total = data?.total ?? null
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  return (
    <div className="page page-wide">
      <PageHead title="Proveedores" sub={total != null ? `${total} proveedores registrados` : 'Directorio de proveedores'}
        actions={
          <>
            <RefreshButton onRefresh={reload} />
            <Btn variant="primary" icon="plus" onClick={() => setModal({ proveedor: null })}>Nuevo proveedor</Btn>
          </>
        } />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por nombre, RNC o contacto…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={6} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los proveedores" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="truck" title="No hay proveedores"
            action={<Btn variant="primary" icon="plus" onClick={() => setModal({ proveedor: null })}>Nuevo proveedor</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Registra tu primer proveedor para usarlo en compras y gastos.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Proveedor</th><th>RNC</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th className="num">Compras</th><th>Estado</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => setModal({ proveedor: p })}>
                    <td><div className="row gap-sm"><Avatar name={p.nombre} size={30} /><span className="cell-main">{p.nombre}</span></div></td>
                    <td className="mono text-sm muted">{p.rnc || '—'}</td>
                    <td className="text-sm">{p.contacto || '—'}</td>
                    <td className="text-sm muted">{p.tel || '—'}</td>
                    <td className="text-sm muted">{p.correo || '—'}</td>
                    <td className="num">{p.compras}</td>
                    <td><Badge tone={p.activo ? 'success' : 'neutral'} dot>{p.activo ? 'Activo' : 'Inactivo'}</Badge></td>
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

      {modal && <ProveedorFormModal proveedor={modal.proveedor} onClose={() => setModal(null)} />}
    </div>
  )
}

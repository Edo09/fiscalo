import { useState } from 'react'
import { Icon, Btn, RefreshButton, Badge, Card, PageHead, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { listWarehouses } from '@/api'
import type { WarehouseRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { WarehouseFormModal } from './WarehouseFormModal'

const PAGE_SIZE = 20

/* FISCALO — Almacenes de inventario (GET/POST/PUT/DELETE /api/warehouses).
   Ver docs/inventario.md. */
export function WarehousesView() {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<{ warehouse: WarehouseRow | null } | null>(null)

  const { data, error, loading, reload } = useApiQuery(
    ['warehouses', 'list', { page, pageSize: PAGE_SIZE, query }],
    () => listWarehouses({ page, pageSize: PAGE_SIZE, query }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  return (
    <div className="page page-wide">
      <PageHead title="Almacenes" sub={total != null ? `${total} almacenes registrados` : 'Dónde se guardan tus productos'}
        actions={
          <>
            <RefreshButton onRefresh={reload} />
            <Btn variant="primary" icon="plus" onClick={() => setModal({ warehouse: null })}>Nuevo almacén</Btn>
          </>
        } />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por nombre o descripción…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={6} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los almacenes" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="archive" title="No hay almacenes"
            action={<Btn variant="primary" icon="plus" onClick={() => setModal({ warehouse: null })}>Nuevo almacén</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Crea tu primer almacén para ubicar tus productos.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {rows.map((w) => {
                  const activo = w.estado === undefined || w.estado === null ? true : Boolean(Number(w.estado))
                  return (
                    <tr key={w.id} onClick={() => setModal({ warehouse: w })}>
                      <td><div className="row gap-sm"><span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 30, height: 30 }}><Icon name="archive" size={15} /></span><span className="cell-main">{w.nombre || '—'}</span></div></td>
                      <td className="text-sm muted">{w.descripcion || '—'}</td>
                      <td><Badge tone={activo ? 'success' : 'neutral'} dot>{activo ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                    </tr>
                  )
                })}
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

      {modal && <WarehouseFormModal warehouse={modal.warehouse} onClose={() => setModal(null)} />}
    </div>
  )
}

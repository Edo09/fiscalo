// FISCALO — Aprobar e-CF: lista los comprobantes que otros emisores te enviaron
// y te deja aprobarlos o rechazarlos ante la DGII (aprobación comercial).
// GET /api/ecf/recepcion + POST /api/aprobaciones-comerciales.
// Ver docs/aprobacion-comercial-recibidos.md.
import { useState } from 'react'
import {
  Icon, Btn, RefreshButton, Money, Badge, EstadoBadge, Card, LoadingState, ErrorState, EmptyState, PageHead, Pagination,
} from '@/components/ui'
import { listEcfRecibidos, dgiiLabel, formatApiDate } from '@/api'
import type { EcfRecibidoRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ApproveEcfModal } from './ApproveEcfModal'

const PAGE_SIZES = [10, 25, 50]

/** Etiqueta de la decisión comercial (null = aún sin responder). */
function aprobacionLabel(v: string | null): string {
  if (!v) return 'Pendiente'
  const up = v.toUpperCase()
  return up === 'ACEPTADO' ? 'Aceptado' : up === 'RECHAZADO' ? 'Rechazado' : v
}

export function ApproveEcfView() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [search, setSearch] = useState('')
  const [review, setReview] = useState<EcfRecibidoRow | null>(null)

  const list = useApiQuery(
    ['ecf-recibidos', 'list', { page, pageSize }],
    () => listEcfRecibidos({ page, pageSize }),
    { keepPrevious: true },
  )

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? null
  const totalPages = list.data?.totalPages ?? null

  // Búsqueda client-side sobre la página actual (el endpoint no filtra server-side).
  const q = search.trim().toLowerCase()
  const filtered = q === ''
    ? rows
    : rows.filter((e) =>
        `${e.e_ncf} ${e.razon_social_emisor ?? ''} ${e.rnc_emisor} ${e.fecha_emision ?? ''}`.toLowerCase().includes(q),
      )

  const pendientes = rows.filter((e) => !e.aprobacion_comercial).length
  const changePageSize = (n: number) => { setPageSize(n); setPage(1) }

  return (
    <div className="page page-wide">
      <PageHead
        title={<span className="row gap-sm" style={{ alignItems: 'center' }}>Aprobar <span className="ecf-tag" style={{ fontSize: 13, padding: '2px 8px' }}>e-CF</span></span>}
        sub={
          total != null
            ? `${total} recibido${total === 1 ? '' : 's'}${pendientes ? ` · ${pendientes} pendiente${pendientes === 1 ? '' : 's'} en esta página` : ''}`
            : 'Comprobantes que otros emisores te enviaron'
        }
        actions={<RefreshButton onRefresh={list.reload} />}
      />

      <div className="toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input placeholder="Buscar por NCF, emisor, RNC, fecha…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {search && <button type="button" className="filter-chip" onClick={() => setSearch('')}><Icon name="x" />Limpiar</button>}
      </div>

      {!list.loading && !list.error && rows.length > 0 && (
        <Pagination
          compact page={page} totalPages={totalPages} total={total} pageSize={pageSize}
          count={rows.length} onPage={setPage} onPageSize={changePageSize} pageSizeOptions={PAGE_SIZES}
        />
      )}

      <Card noPad>
        {list.loading ? (
          <LoadingState rows={6} />
        ) : list.error ? (
          <ErrorState title="No se pudieron cargar los e-CF recibidos" onRetry={list.reload}>{list.error}</ErrorState>
        ) : filtered.length === 0 ? (
          <EmptyState icon="inbox" title={search ? 'Sin resultados' : 'No hay e-CF recibidos'}>
            {search ? `Sin resultados para "${search}" en esta página.` : 'Aún no has recibido comprobantes de otros emisores.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>NCF</th><th>Emisor</th><th>RNC emisor</th><th>Tipo</th><th>Fecha</th>
                  <th>Recepción</th><th>Aprobación</th><th className="num">Total</th><th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const pendiente = !e.aprobacion_comercial
                  const procesada = Number(e.aprobacion_comercial_procesada) === 1
                  return (
                    <tr key={e.track_id} style={{ cursor: 'default' }}>
                      <td className="mono text-sm fw6">{e.e_ncf}</td>
                      <td><span className="cell-main">{e.razon_social_emisor || '—'}</span></td>
                      <td className="mono text-xs muted">{e.rnc_emisor}</td>
                      <td><span className="ecf-tag">{e.tipo_ecf}</span></td>
                      <td className="muted text-sm">{formatApiDate(e.fecha_emision)}</td>
                      <td>{e.estado ? <EstadoBadge estado={dgiiLabel(e.estado)} /> : <span className="muted-3">—</span>}</td>
                      <td>
                        {pendiente ? (
                          <Badge tone="warning" dot>Pendiente</Badge>
                        ) : (
                          <span className="row gap-sm" style={{ alignItems: 'center' }}>
                            <EstadoBadge estado={aprobacionLabel(e.aprobacion_comercial)} />
                            {!procesada && (
                              <Icon name="alert-triangle" size={13} style={{ color: 'var(--warning)' }} />
                            )}
                          </span>
                        )}
                      </td>
                      <td className="num fw6"><Money value={Number(e.monto_total ?? 0)} cur={false} /></td>
                      <td>
                        <Btn variant={pendiente ? 'primary' : 'secondary'} size="sm" onClick={() => setReview(e)}>
                          {pendiente ? 'Revisar' : 'Reenviar'}
                        </Btn>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!list.loading && !list.error && (rows.length > 0 || page > 1) && (
        <Pagination
          page={page} totalPages={totalPages} total={total} pageSize={pageSize}
          count={rows.length} onPage={setPage} onPageSize={changePageSize} pageSizeOptions={PAGE_SIZES}
        />
      )}

      {review && <ApproveEcfModal ecf={review} onClose={() => setReview(null)} />}
    </div>
  )
}

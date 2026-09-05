import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Icon, Btn, RefreshButton, Card, KPI, Drawer, EmptyState, LoadingState, ErrorState, PageHead, Pagination, Money,
} from '@/components/ui'
import { ApiError, listAjustes, getAjuste, anularAjuste } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import type { Nav } from '@/config/navigation'
import { MOTIVOS, motivoLabel } from './motivos'

const PAGE_SIZES = [10, 25, 50]

const fmtFecha = (f?: string | null) => (f ? String(f).slice(0, 16).replace('T', ' ') : '—')

/* FISCALO — Ajustes de inventario (GET/POST /api/inventario/ajustes).
   Historial de todo aumento o disminución de existencias. Un ajuste no se edita
   ni se borra: se anula creando el inverso, y los dos quedan a la vista. */
export function AdjustmentsView({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [motivo, setMotivo] = useState('')
  const [detalle, setDetalle] = useState<number | null>(null)

  const { data, error, loading, fetching, reload } = useApiQuery(
    ['inventario', 'ajustes', { page, pageSize, motivo }],
    () => listAjustes({ page, pageSize, motivo: motivo || undefined }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const totalPages = data?.totalPages ?? null
  // Valor neto de lo ajustado en la página: cuánto dinero entró o salió del almacén.
  const valorNeto = rows.reduce((a, r) => a + Number(r.total_valor ?? 0), 0)

  return (
    <div className="page page-wide">
      <PageHead
        title="Ajustes de inventario"
        sub={total != null ? `${total} ajustes registrados` : 'Aumentos y disminuciones de existencias'}
        actions={
          <>
            <RefreshButton onRefresh={reload} />
            <Btn variant="primary" icon="plus" onClick={() => nav('ajuste-nuevo')}>Crear ajuste</Btn>
          </>
        }
      />

      <div className="kpi-grid compact" style={{ marginBottom: 16 }}>
        <KPI label="Ajustes registrados" value={total ?? rows.length} icon="git-compare" />
        <KPI
          label="Valor neto (esta página)"
          value={valorNeto.toLocaleString('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 2 })}
          icon={valorNeto < 0 ? 'trending-down' : 'trending-up'}
          iconBg={valorNeto < 0 ? 'var(--danger-soft)' : 'var(--success-soft)'}
          iconColor={valorNeto < 0 ? 'var(--danger)' : 'var(--success)'}
        />
      </div>

      <div className="toolbar">
        <select
          className="input"
          style={{ maxWidth: 220 }}
          value={motivo}
          onChange={(e) => { setMotivo(e.target.value); setPage(1) }}
          aria-label="Filtrar por motivo"
        >
          <option value="">Todos los motivos</option>
          {MOTIVOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          <option value="ANULACION">Anulaciones</option>
        </select>
        {motivo && (
          <button type="button" className="filter-chip" onClick={() => { setMotivo(''); setPage(1) }}>
            <Icon name="x" />Limpiar
          </button>
        )}
        {fetching && !loading && <Icon name="loader" className="spin" />}
      </div>

      <Card noPad>
        {loading ? (
          <LoadingState rows={8} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar los ajustes" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="git-compare" title="Todavía no hay ajustes">
            El primer ajuste suele ser el conteo físico: fija la existencia real de la que parte todo lo demás.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Código</th><th>Fecha</th><th>Motivo</th><th>Almacén</th>
                  <th style={{ textAlign: 'right' }}>Líneas</th>
                  <th style={{ textAlign: 'right' }}>Valor ajustado</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} onClick={() => setDetalle(a.id)}>
                    <td>
                      <span className="cell-main mono">{a.codigo}</span>
                      {a.anulado_por_id && <div className="cell-sub" style={{ color: 'var(--danger)' }}>Anulado</div>}
                      {a.anula_a_id && <div className="cell-sub">Anula otro ajuste</div>}
                    </td>
                    <td className="muted text-sm">{fmtFecha(a.fecha)}</td>
                    <td>{motivoLabel(a.motivo)}</td>
                    <td className="muted text-sm">{a.almacen_nombre ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{a.total_lineas}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ color: Number(a.total_valor) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        <Money value={Number(a.total_valor ?? 0)} />
                      </span>
                    </td>
                    <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && (rows.length > 0 || page > 1) && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          count={rows.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1) }}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      {detalle != null && (
        <AjusteDrawer
          id={detalle}
          onClose={() => setDetalle(null)}
          onAnulado={() => {
            void queryClient.invalidateQueries({ queryKey: ['inventario'] })
            void queryClient.invalidateQueries({ queryKey: ['products'] })
            setDetalle(null)
          }}
        />
      )}
    </div>
  )
}

/* Detalle del ajuste con sus líneas, y la anulación. */
function AjusteDrawer({ id, onClose, onAnulado }: { id: number; onClose: () => void; onAnulado: () => void }) {
  const { data: ajuste, loading, error } = useApiQuery(['inventario', 'ajuste', id], () => getAjuste(id))
  const [anulando, setAnulando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)

  // Acción única: dos anulaciones a la vez revertirian el stock dos veces.
  const anular = useAccionUnica(async () => {
    setAnulando(true)
    try {
      const inverso = await anularAjuste(id)
      toast.success(`Ajuste anulado con ${inverso.codigo}. Las existencias volvieron a su valor anterior.`)
      onAnulado()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo anular el ajuste.')
      setAnulando(false)
    }
  })

  const yaAnulado = !!ajuste?.anulado_por_id
  const esAnulacion = ajuste?.motivo === 'ANULACION'

  return (
    <Drawer
      title={ajuste?.codigo ?? 'Ajuste'}
      sub={ajuste ? `${motivoLabel(ajuste.motivo)} · ${fmtFecha(ajuste.fecha)}` : ''}
      width={640}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
          {ajuste && !yaAnulado && !esAnulacion && (
            confirmar ? (
              <>
                <Btn variant="secondary" onClick={() => setConfirmar(false)}>Cancelar</Btn>
                <Btn variant="primary" icon="repeat" onClick={() => void anular()} disabled={anulando}>
                  {anulando ? 'Anulando…' : 'Confirmar anulación'}
                </Btn>
              </>
            ) : (
              <Btn variant="secondary" icon="repeat" onClick={() => setConfirmar(true)}>Anular</Btn>
            )
          )}
        </>
      }
    >
      {loading ? (
        <LoadingState rows={4} />
      ) : error || !ajuste ? (
        <ErrorState title="No se pudo cargar el ajuste">{error}</ErrorState>
      ) : (
        <>
          {yaAnulado && (
            <div className="card card-pad row gap-sm mb-md"
                 style={{ background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
              <Icon name="alert-circle" size={16} />
              <span className="fw6 text-sm">Este ajuste fue anulado. Su efecto ya se revirtió.</span>
            </div>
          )}
          {confirmar && !yaAnulado && (
            <div className="card card-pad mb-md" style={{ background: 'var(--warning-soft)', borderColor: 'transparent' }}>
              <span className="text-sm">
                No se borra nada: se crea un ajuste inverso que devuelve las existencias a como estaban.
                Los dos quedan en el historial.
              </span>
            </div>
          )}

          {ajuste.nota && <p className="text-sm muted mb-md">{ajuste.nota}</p>}

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Antes</th>
                  <th style={{ textAlign: 'right' }}>Ajuste</th>
                  <th style={{ textAlign: 'right' }}>Después</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {ajuste.lineas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="cell-main">{l.producto_nombre ?? `#${l.product_id}`}</span>
                      {l.sku && <div className="cell-sub mono">{l.sku}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted">{l.cantidad_anterior}</td>
                    <td style={{ textAlign: 'right', color: Number(l.cantidad) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {Number(l.cantidad) > 0 ? '+' : ''}{l.cantidad}
                    </td>
                    <td style={{ textAlign: 'right' }} className="fw6">{l.cantidad_nueva}</td>
                    <td style={{ textAlign: 'right' }}><Money value={Number(l.valor_movimiento ?? 0)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 12, marginTop: 14 }}>
            <span className="text-sm muted">Total ajustado</span>
            <span className="fw6"><Money value={Number(ajuste.total_valor ?? 0)} /></span>
          </div>
        </>
      )}
    </Drawer>
  )
}

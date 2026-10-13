import { useState } from 'react'
import {
  Icon, Btn, RefreshButton, Money, Avatar, Card, PageHead, EmptyState, LoadingState, ErrorState,
} from '@/components/ui'
import { listCotizaciones, formatApiDate } from '@/api'
import type { CotizacionRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { useCotizacionFormato, type FormatoId } from './formatos'
import { AccionesCotizacion } from './AccionesCotizacion'
import { usePermisosCotizacion } from './permisosCotizacion'

const PAGE_SIZE = 15

/* FISCALO — Cotizaciones (GET /api/cotizaciones) */
export function CotizacionesView({ nav }: { nav: Nav }) {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  // Las columnas siguen el formato del tenant; las acciones, el de cada fila
  // (una cotización guardada con otro formato se factura con sus reglas). Si
  // branding falla se usan las columnas de Gratex: es un listado de solo
  // lectura y no hay nada que se pueda guardar mal.
  const formatoTenant = useCotizacionFormato()
  const columnas: FormatoId = formatoTenant.error != null ? 'gratex' : formatoTenant.formato
  const permisos = usePermisosCotizacion()

  // Crear y editar viven en su propia pantalla (el editor "en papel", igual que
  // el de factura), no en un modal.
  const abrir = (c: CotizacionRow | null) =>
    nav('cotizacion-nueva', c ? { kind: 'cotizacion', id: c.id } : undefined)

  const { data, error, loading, reload } = useApiQuery(
    ['cotizaciones', 'list', { page, pageSize: PAGE_SIZE, query }],
    () => listCotizaciones({ page, pageSize: PAGE_SIZE, query }),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  return (
    <div className="page page-wide">
      <PageHead title="Cotizaciones" sub={total != null ? `${total} cotizaciones registradas` : 'Propuestas para tus clientes'}
        actions={
          <>
            <RefreshButton onRefresh={reload} />
            <Btn variant="primary" icon="plus" onClick={() => abrir(null)}>Nueva cotización</Btn>
          </>
        } />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por código o cliente…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {/* Espera también al formato: sin él no se sabe qué columnas van, y
            montar unas para cambiarlas al momento se ve como un salto. */}
        {loading || formatoTenant.cargando ? (
          <LoadingState rows={6} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las cotizaciones" onRetry={reload}>{error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="file-plus" title="No hay cotizaciones"
            action={<Btn variant="primary" icon="plus" onClick={() => abrir(null)}>Nueva cotización</Btn>}>
            {query ? `Sin resultados para "${query}".` : 'Crea tu primera cotización para enviarla a un cliente.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              {/* Ferretería: Número | Cliente | Fecha | Total (su hoja no tiene
                  resumen de descripciones). Gratex, como siempre. */}
              <thead>
                <tr>
                  <th>{columnas === 'gratex' ? 'Código' : 'Número'}</th>
                  <th>Cliente</th>
                  {columnas === 'gratex' && <th>Descripción</th>}
                  <th>Fecha</th>
                  <th className="num">Total</th>
                  {/* Ferretería con conduces lleva tres botones (PDF, Conduce, Facturar). */}
                  <th style={{ width: columnas === 'gratex' ? 190 : permisos.puedeConduce ? 320 : 210 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => abrir(c)}>
                    <td><span className="mono text-sm fw6">{c.code || `#${c.id}`}</span></td>
                    <td><div className="row gap-sm"><Avatar name={c.client_name || '—'} size={28} /><span className="cell-main">{c.client_name || '—'}</span></div></td>
                    {columnas === 'gratex' && (
                      <td className="text-sm muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
                    )}
                    <td className="muted text-sm">{formatApiDate(c.date)}</td>
                    <td className="num fw6"><Money value={Number(c.total ?? 0)} cur={false} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                        <AccionesCotizacion cotizacion={c} nav={nav} permisos={permisos} />
                      </div>
                    </td>
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

    </div>
  )
}

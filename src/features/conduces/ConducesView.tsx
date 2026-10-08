import { useState } from 'react'
import { toast } from 'sonner'
import {
  Icon, Btn, RefreshButton, Avatar, Card, PageHead, EmptyState, LoadingState, ErrorState, Dropdown, MenuItem,
} from '@/components/ui'
import { ApiError, listConduces, getConducePdf, formatApiDate } from '@/api'
import type { ConduceRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import { useSession } from '@/stores/auth'
import { puedeVerVista, type Nav } from '@/config/navigation'
import { useFormatoTenant } from '@/features/cotizaciones/formatos/useFormatoTenant'
import { conduceAFacturaPrefill, conduceAFacturaSimplePrefill, nombreConduce } from './conversion'

const PAGE_SIZE = 15

/* FISCALO — Conduces de mercancía (GET /api/conduces, spec conduces 5.4).

   El conduce es el papel que va con la mercancía y que el cliente firma. Sale
   de una cotización de Ferretería (botón "Conduce" del listado de
   cotizaciones), así que aquí no hay "Nuevo". Nunca muestra precios. Eliminar
   lo desactiva: deja de salir aquí y su número no se vuelve a usar.

   Es solo del formato 'ferreteria'. Hasta que branding dice el del tenant no
   se pide nada, porque a otro formato el backend le responde 422 en todo. Si
   el formato se sabe y es otro, App saca de aquí al dashboard
   (debeSalirDeVista): esta vista solo espera. */
export function ConducesView({ nav }: { nav: Nav }) {
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)
  const { user } = useSession()

  // Otro observador de ['branding'] con las mismas opciones que el de
  // AppShell: no hace ninguna petición de más.
  const { formato, error: errorFormato, reintentar } = useFormatoTenant()
  const listo = formato === 'ferreteria'

  // Facturar ofrece solo los destinos que el rol puede abrir (mismo criterio
  // que el sidebar y que Cotizaciones). Ver conduces no pide permiso de facturas.
  const puedeEcf = puedeVerVista(user, 'factura-nueva')
  const puedeSimple = puedeVerVista(user, 'factura-simple-nueva')

  // Editar vive en su propia pantalla (el papel), como la cotización.
  const abrir = (c: ConduceRow) => nav('conduce-editar', { kind: 'conduce', id: c.id })

  // `listo` va en la clave: mientras se espera el formato, la consulta guarda
  // un null, y con la misma clave ese null seguiría en caché al saberse el
  // formato, en vez de pedirse la lista.
  const { data, error, reload } = useApiQuery(
    ['conduces', 'list', { page, pageSize: PAGE_SIZE, query, listo }],
    () => (listo ? listConduces({ page, pageSize: PAGE_SIZE, query }) : Promise.resolve(null)),
    { keepPrevious: true },
  )

  const rows = data?.items ?? []
  const total = data?.total ?? null
  const hasNext = total != null ? page * PAGE_SIZE < total : rows.length === PAGE_SIZE
  // Todavía sin lista. No basta `loading`: al saberse el formato, keepPrevious
  // muestra el null de la espera mientras llega la lista, y eso no es una
  // lista vacía.
  const cargando = data == null && error == null
  const submitSearch = () => { setQuery(input.trim()); setPage(1) }

  const openPdf = async (c: ConduceRow) => {
    setPdfBusy(c.id)
    try {
      presentDocument(await getConducePdf(c.id))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfBusy(null)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead
        title="Conduces"
        sub={total != null
          ? `${total} ${total === 1 ? 'conduce registrado' : 'conduces registrados'}`
          : 'La mercancía que entregas, firmada por el cliente'}
        actions={<RefreshButton onRefresh={reload} />}
      />

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name="search" /><input placeholder="Buscar por número, cotización, cliente o RNC…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button className="filter-chip" onClick={() => { setInput(''); setQuery(''); setPage(1) }}><Icon name="x" />Limpiar</button>}
        <div className="toolbar-spacer"></div>
        <Btn variant="secondary" size="sm" icon="search" onClick={submitSearch}>Buscar</Btn>
      </div>

      <Card noPad>
        {!listo ? (
          // Sin el formato no se sabe si esta empresa tiene conduces.
          errorFormato ? (
            <ErrorState title="No se pudo saber el formato de tu empresa" onRetry={reintentar}>
              Sin ese dato no se pueden mostrar los conduces.
            </ErrorState>
          ) : (
            <LoadingState rows={6} />
          )
        ) : error ? (
          <ErrorState title="No se pudieron cargar los conduces" onRetry={reload}>{error}</ErrorState>
        ) : cargando ? (
          <LoadingState rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon="truck" title="No hay conduces"
            action={query ? undefined : (
              <Btn variant="secondary" icon="file-plus" onClick={() => nav('cotizaciones')}>Ir a Cotizaciones</Btn>
            )}>
            {query ? `Sin resultados para "${query}".` : 'Todavía no hay conduces. Crea uno desde una cotización con el botón Conduce.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Cotización</th>
                  {/* PDF + Facturar ▾: el ancho de las cotizaciones de Ferretería. */}
                  <th style={{ width: 210 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  // El cliente se pudo borrar: queda el nombre que guardó el conduce.
                  const cliente = nombreConduce(c) || '—'
                  return (
                    <tr key={c.id} onClick={() => abrir(c)}>
                      <td><span className="mono text-sm fw6">{c.code || `#${c.id}`}</span></td>
                      <td><div className="row gap-sm"><Avatar name={cliente} size={28} /><span className="cell-main">{cliente}</span></div></td>
                      <td className="muted text-sm">{formatApiDate(c.date)}</td>
                      {/* La cotización de origen se pudo eliminar: su código llega en null. */}
                      <td>
                        {c.cotizacion_code
                          ? <span className="mono text-sm">{c.cotizacion_code}</span>
                          : <span className="muted text-sm">eliminada</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <Btn variant="ghost" size="sm" icon="printer" onClick={() => openPdf(c)} disabled={pdfBusy === c.id}>
                            {pdfBusy === c.id ? '…' : 'PDF'}
                          </Btn>
                          {/* A e-CF o a factura simple, con el precio interno de cada
                              línea (conversion.ts). Cada destino sale solo si el rol
                              puede abrirlo; sin ninguno, no hay botón. */}
                          {(puedeEcf || puedeSimple) && (
                            <Dropdown
                              align="right"
                              width={220}
                              trigger={
                                <Btn variant="secondary" size="sm" icon="file-text" iconRight="chevron-down" title="Convertir en factura">
                                  Facturar
                                </Btn>
                              }
                            >
                              {puedeEcf && (
                                <MenuItem icon="file-text" onClick={() => nav('factura-nueva', conduceAFacturaPrefill(c))}>
                                  Factura electrónica (e-CF)
                                </MenuItem>
                              )}
                              {puedeSimple && (
                                <MenuItem icon="file" onClick={() => nav('factura-simple-nueva', conduceAFacturaSimplePrefill(c))}>
                                  Factura simple
                                </MenuItem>
                              )}
                            </Dropdown>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {listo && !cargando && !error && (rows.length > 0 || page > 1) && (
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

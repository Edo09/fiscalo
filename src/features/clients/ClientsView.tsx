import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, RefreshButton, Avatar, Card, KPI, Drawer, EmptyState, LoadingState, ErrorState, PageHead, Pagination } from '@/components/ui'
import { ApiError, listClients, updateClient, deleteClient, mapClientRow } from '@/api'
import type { ClientRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import type { Cliente } from '@/types/domain'

const PAGE_SIZES = [10, 25, 50]
const SEARCH_DEBOUNCE_MS = 350

/* FISCALO — Clientes (GET/PUT/DELETE /api/clients) */
export function ClientsView({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [perfil, setPerfil] = useState<ClientRow | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Búsqueda servida por el backend: al dejar de teclear (debounce) se fija la
  // consulta y se vuelve a la página 1. Enter la dispara al instante.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim()
      if (q !== query) { setQuery(q); setPage(1) }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input, query])

  const { data, error, loading, fetching, reload } = useApiQuery(
    ['clients', 'list', { page, pageSize, query }],
    () => listClients({ page, pageSize, query }),
    { keepPrevious: true },
  )

  const raws = data?.items ?? []
  const rows = raws.map(mapClientRow)
  const total = data?.total ?? null
  const totalPages = data?.totalPages ?? null
  const conRnc = rows.filter((c) => c.doc).length

  const submitSearch = () => { setQuery(input.trim()); setPage(1) }
  const clearSearch = () => { setInput(''); setQuery(''); setPage(1) }
  const changePageSize = (n: number) => { setPageSize(n); setPage(1) }
  const searching = fetching && !loading

  const del = async (id: number) => {
    setDeleting(true)
    try {
      await deleteClient(id)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      toast.success('Cliente eliminado.')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo eliminar el cliente.')
    } finally {
      setDeleting(false)
      setConfirmDel(null)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead title="Clientes" sub={total != null ? `${total} clientes registrados` : 'Clientes registrados'}
        actions={<><RefreshButton onRefresh={reload} /><Btn variant="primary" icon="user-plus">Nuevo cliente</Btn></>} />

      <div className="kpi-grid compact" style={{ marginBottom: 16 }}>
        <KPI label="Total registrados" value={total ?? rows.length} icon="users" />
        <KPI label="Con RNC/Cédula" value={conRnc} icon="user-check" iconBg="var(--success-soft)" iconColor="var(--success)" />
      </div>

      <div className="toolbar">
        <form className="search-input" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <Icon name={searching ? 'loader' : 'search'} className={searching ? 'spin' : undefined} />
          <input placeholder="Buscar cliente…" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        {query && <button type="button" className="filter-chip" onClick={clearSearch}><Icon name="x" />Limpiar</button>}
      </div>

      {!loading && !error && rows.length > 0 && (
        <Pagination
          compact
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          count={rows.length}
          onPage={setPage}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

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
              <thead><tr><th>Cliente</th><th>RNC / Cédula</th><th>Ciudad</th><th>Correo</th><th>Teléfono</th><th style={{ width: 96 }}></th></tr></thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id} onClick={() => setPerfil(raws[i])}>
                    <td><div className="row gap-sm"><Avatar name={c.nombre} size={30} /><div><span className="cell-main">{c.nombre}</span>{c.contacto && <div className="cell-sub">{c.contacto}</div>}</div></div></td>
                    <td>{c.doc ? <><span className="mono text-sm">{c.doc}</span><div className="cell-sub">{c.tipo}</div></> : <span className="muted-3">—</span>}</td>
                    <td className="muted text-sm">{c.ciudad || '—'}</td>
                    <td className="muted text-sm">{c.email || '—'}</td>
                    <td className="muted text-sm">{c.tel || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {confirmDel === raws[i].id ? (
                        <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(null)}>No</Btn>
                          <Btn variant="ghost" size="sm" style={{ color: 'var(--danger)' }} disabled={deleting} onClick={() => del(raws[i].id)}>
                            {deleting ? '…' : 'Sí'}
                          </Btn>
                        </span>
                      ) : (
                        <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <Btn variant="ghost" size="sm" icon="trash-2" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(raws[i].id)} />
                          <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
                        </span>
                      )}
                    </td>
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
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      {perfil && <ClientEditDrawer client={perfil} nav={nav} onClose={() => setPerfil(null)} />}
    </div>
  )
}

/* Drawer de cliente: datos editables, guarda con PUT /api/clients. */
function ClientEditDrawer({ client, nav, onClose }: { client: ClientRow; nav: Nav; onClose: () => void }) {
  const queryClient = useQueryClient()
  const cliente: Cliente = mapClientRow(client)
  const [form, setForm] = useState({
    client_name: client.client_name ?? '',
    company_name: client.company_name ?? '',
    razon_social: client.razon_social ?? '',
    rnc: client.rnc ?? '',
    email: client.email ?? '',
    phone_number: client.phone_number ?? '',
    direccion: client.direccion ?? '',
    municipio: client.municipio ?? '',
    provincia: client.provincia ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateClient({ id: client.id, ...form })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      toast.success('Cliente actualizado.')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el cliente.')
      setSaving(false)
    }
  }

  return (
    <Drawer title={cliente.nombre} sub={cliente.doc ? `${cliente.tipo}: ${cliente.doc}` : 'Sin documento'} width={560} onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="secondary" icon="plus" onClick={() => { onClose(); nav('factura-nueva') }}>Nueva factura</Btn>
          <Btn variant="primary" icon="save" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </>
      }>
      <div className="row gap-md mb-lg">
        <Avatar name={cliente.nombre} size={52} />
        <div style={{ flex: 1 }}>
          <div className="fw6" style={{ fontSize: 16 }}>{cliente.nombre}</div>
          {cliente.contacto && <div className="text-sm muted">{cliente.contacto}</div>}
          {cliente.doc && <div className="text-xs muted-3 mono">{cliente.tipo}: {cliente.doc}</div>}
        </div>
      </div>

      {error && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
          <Icon name="alert-circle" size={16} /><span className="fw6 text-sm">{error}</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field"><label className="label">Razón social</label><input className="input" value={form.razon_social} onChange={set('razon_social')} /></div>
        <div className="field"><label className="label">Empresa</label><input className="input" value={form.company_name} onChange={set('company_name')} /></div>
        <div className="field"><label className="label">Contacto</label><input className="input" value={form.client_name} onChange={set('client_name')} /></div>
        <div className="field"><label className="label">RNC / Cédula</label><input className="input mono" value={form.rnc} onChange={set('rnc')} /></div>
        <div className="field"><label className="label">Correo</label><input className="input" type="email" value={form.email} onChange={set('email')} /></div>
        <div className="field"><label className="label">Teléfono</label><input className="input" value={form.phone_number} onChange={set('phone_number')} /></div>
        <div className="field full"><label className="label">Dirección</label><input className="input" value={form.direccion} onChange={set('direccion')} /></div>
        <div className="field"><label className="label">Municipio</label><input className="input" value={form.municipio} onChange={set('municipio')} /></div>
        <div className="field"><label className="label">Provincia</label><input className="input" value={form.provincia} onChange={set('provincia')} /></div>
      </div>
    </Drawer>
  )
}

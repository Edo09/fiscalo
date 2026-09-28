import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, RefreshButton, Avatar, Card, KPI, Drawer, EmptyState, LoadingState, ErrorState, PageHead, Pagination } from '@/components/ui'
import { ApiError, listClients, updateClient, deleteClient, mapClientRow, listUbicaciones } from '@/api'
import type { ClientRow, Ubicacion } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import type { Cliente } from '@/types/domain'
import { NewClientModal } from './NewClientModal'
import {
  LARGO, errorCorreo, errorDescuento, errorRnc, errorTelefono, errorTexto, soloDigitos,
} from './validacion'

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
  const [nuevoAbierto, setNuevoAbierto] = useState(false)
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
        actions={<><RefreshButton onRefresh={reload} /><Btn variant="primary" icon="user-plus" onClick={() => setNuevoAbierto(true)}>Nuevo cliente</Btn></>} />

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
      {nuevoAbierto && <NewClientModal onClose={() => setNuevoAbierto(false)} />}
    </div>
  )
}

/**
 * Municipio y provincia salen del catálogo DGII (`/api/provincias-municipios`),
 * no de texto libre: lo que se persiste es el `codigo` de 6 dígitos, que es lo
 * que viaja en el XML del e-CF. Un nombre escrito a mano no lo resuelve DGII.
 *
 * Los clientes migrados de sistemas anteriores traen nombres sueltos ("SAN
 * FRANCISCO DE MACORIS"). Para no perderlos en silencio, si el valor guardado
 * no es un código conocido se intenta casar por nombre y, si tampoco, se ofrece
 * como una opción más marcada como valor actual.
 */
function opcionesUbicacion(
  ubicaciones: Ubicacion[] | null | undefined,
  tipo: 'PROVINCIA' | 'MUNICIPIO',
  provinciaCodigo2: string,
  valorActual: string,
): Ubicacion[] {
  const todas = (ubicaciones ?? []).filter((u) => u.tipo === tipo)
  const lista = tipo === 'MUNICIPIO' && provinciaCodigo2
    ? todas.filter((u) => (u.provincia_codigo ?? '') === provinciaCodigo2)
    : todas
  const v = valorActual.trim()
  if (!v || lista.some((u) => u.codigo === v)) return lista
  // Valor heredado: si coincide con un nombre del catálogo se usa ese código.
  const porNombre = todas.find((u) => u.descripcion.toLowerCase() === v.toLowerCase())
  if (porNombre) return lista.some((u) => u.codigo === porNombre.codigo) ? lista : [porNombre, ...lista]
  return [{ tipo, codigo: v, descripcion: `${v} (valor actual)`, provincia_codigo: null }, ...lista]
}

/* Drawer de cliente: datos editables, guarda con PUT /api/clients. */
function ClientEditDrawer({ client, nav, onClose }: { client: ClientRow; nav: Nav; onClose: () => void }) {
  const queryClient = useQueryClient()
  const cliente: Cliente = mapClientRow(client)
  const { data: ubicaciones } = useApiQuery(['ubicaciones'], listUbicaciones)
  // Foto del registro al abrir: se compara contra ella para mandar solo lo que
  // cambió (ver save).
  const [inicial] = useState(() => ({
    client_name: client.client_name ?? '',
    company_name: client.company_name ?? '',
    razon_social: client.razon_social ?? '',
    rnc: client.rnc ?? '',
    email: client.email ?? '',
    phone_number: client.phone_number ?? '',
    direccion: client.direccion ?? '',
    municipio: client.municipio ?? '',
    provincia: client.provincia ?? '',
    // Condiciones comerciales del cliente (descuento y crédito).
    descuento: String(client.descuento ?? 0),
    permitir_credito: Number(client.permitir_credito ?? 0) === 1,
  }))
  const [form, setForm] = useState(inicial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errores, setErrores] = useState<Partial<Record<keyof typeof form, string>>>({})

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value })
    if (errores[k]) setErrores((er) => ({ ...er, [k]: undefined }))
  }
  const claseCampo = (k: keyof typeof form, extra = '') => 'field' + extra + (errores[k] ? ' field-error' : '')
  const errorDe = (k: keyof typeof form) =>
    errores[k] && <div className="err-msg"><Icon name="alert-circle" size={13} />{errores[k]}</div>

  // Codigo de 2 digitos de la provincia elegida: filtra los municipios. Sale del
  // catalogo, o de los 2 primeros digitos del codigo guardado como respaldo.
  const provinciaCodigo2 =
    (ubicaciones ?? []).find((u) => u.tipo === 'PROVINCIA' && u.codigo === form.provincia)?.provincia_codigo
    ?? form.provincia.slice(0, 2)

  /**
   * Solo viaja lo que cambió: el PUT es parcial y el backend conserva el resto.
   * Mandar el registro entero hacía fallar a los clientes migrados sin contacto
   * o sin empresa en cuanto se tocaba cualquier otro dato (p. ej. el descuento).
   * Por lo mismo, solo se valida lo que cambió, con las reglas del alta.
   */
  const save = async () => {
    const cambiados = (Object.keys(form) as (keyof typeof form)[]).filter((k) => form[k] !== inicial[k])
    if (cambiados.length === 0) { toast.info('No hay cambios que guardar.'); onClose(); return }
    const reglas: Partial<Record<keyof typeof form, () => string | undefined>> = {
      client_name: () => errorTexto(form.client_name, LARGO.nombreCliente, 'El nombre de contacto', 'Escribe el nombre de contacto.'),
      company_name: () => errorTexto(form.company_name, LARGO.empresa, 'La empresa', 'Escribe la empresa.'),
      razon_social: () => errorTexto(form.razon_social, LARGO.razonSocial, 'La razón social'),
      rnc: () => errorRnc(form.rnc),
      email: () => errorCorreo(form.email),
      phone_number: () => errorTelefono(form.phone_number),
      direccion: () => errorTexto(form.direccion, LARGO.direccion, 'La dirección'),
      descuento: () => errorDescuento(form.descuento),
    }
    const e: Partial<Record<keyof typeof form, string>> = {}
    for (const k of cambiados) {
      const msg = reglas[k]?.()
      if (msg) e[k] = msg
    }
    setErrores(e)
    if (Object.keys(e).length > 0) return

    const cambios: Record<string, string | number> = {}
    for (const k of cambiados) {
      if (k === 'permitir_credito') cambios[k] = form.permitir_credito ? 1 : 0
      else if (k === 'descuento') cambios[k] = Number(form.descuento) || 0
      // Solo los dígitos: con guiones, un RNC de 9 no cabe en la columna de 11.
      else if (k === 'rnc') cambios[k] = soloDigitos(form.rnc)
      else cambios[k] = form[k].trim()
    }
    setSaving(true)
    setError(null)
    try {
      await updateClient({ ...cambios, id: client.id })
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
        <div className={claseCampo('razon_social')}><label className="label">Razón social</label><input className="input" value={form.razon_social} onChange={set('razon_social')} maxLength={LARGO.razonSocial} />{errorDe('razon_social')}</div>
        <div className={claseCampo('company_name')}><label className="label">Empresa</label><input className="input" value={form.company_name} onChange={set('company_name')} maxLength={LARGO.empresa} />{errorDe('company_name')}</div>
        <div className={claseCampo('client_name')}><label className="label">Contacto</label><input className="input" value={form.client_name} onChange={set('client_name')} maxLength={LARGO.nombreCliente} />{errorDe('client_name')}</div>
        <div className={claseCampo('rnc')}><label className="label">RNC / Cédula</label><input className="input mono" value={form.rnc} onChange={set('rnc')} inputMode="numeric" />{errorDe('rnc')}</div>
        <div className={claseCampo('email')}><label className="label">Correo</label><input className="input" type="email" value={form.email} onChange={set('email')} maxLength={LARGO.correo} />{errorDe('email')}</div>
        <div className={claseCampo('phone_number')}><label className="label">Teléfono</label><input className="input" value={form.phone_number} onChange={set('phone_number')} maxLength={LARGO.telefono} />{errorDe('phone_number')}</div>
        <div className={claseCampo('direccion', ' full')}><label className="label">Dirección</label><input className="input" value={form.direccion} onChange={set('direccion')} maxLength={LARGO.direccion} />{errorDe('direccion')}</div>
        <div className="field">
          <label className="label">Provincia</label>
          <select
            className="input"
            value={form.provincia}
            onChange={(e) => {
              // Cambiar de provincia invalida el municipio: pertenece a la anterior.
              const prov = e.target.value
              setForm((f) => ({ ...f, provincia: prov, municipio: '' }))
            }}
          >
            <option value="">— Sin especificar —</option>
            {opcionesUbicacion(ubicaciones, 'PROVINCIA', '', form.provincia).map((u) => (
              <option key={u.codigo} value={u.codigo}>{u.descripcion}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Municipio</label>
          <select
            className="input"
            value={form.municipio}
            onChange={set('municipio')}
            disabled={!form.provincia}
          >
            <option value="">{form.provincia ? '— Sin especificar —' : 'Elige una provincia primero'}</option>
            {opcionesUbicacion(ubicaciones, 'MUNICIPIO', provinciaCodigo2, form.municipio).map((u) => (
              <option key={u.codigo} value={u.codigo}>{u.descripcion}</option>
            ))}
          </select>
        </div>
        <div className={claseCampo('descuento')}><label className="label">Descuento por defecto (%)</label><input className="input" inputMode="decimal" value={form.descuento} onChange={set('descuento')} />{errorDe('descuento')}</div>
        <div className="field">
          <label className="label">Crédito</label>
          <label className="text-sm">
            <input
              type="checkbox"
              checked={form.permitir_credito}
              onChange={(e) => setForm({ ...form, permitir_credito: e.target.checked })}
            />{' '}
            Permitir facturar a crédito
          </label>
        </div>
      </div>
    </Drawer>
  )
}

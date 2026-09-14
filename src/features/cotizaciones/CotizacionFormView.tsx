import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Modal, Switch, Spinner } from '@/components/ui'
import {
  ApiError, createCotizacion, updateCotizacion, deleteCotizacion, previewCotizacion,
  getCotizacion, getClient, getBranding, getEmisor, listProducts, mapClientRow, mapProductRow,
} from '@/api'
import type { CotizacionItemInput } from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { useSession } from '@/stores/auth'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto } from '@/types/domain'
import '@/styles/factura-doc.css'

/* FISCALO — Crear/editar una cotización, con el mismo editor "en papel" que la
   factura. Antes era un modal de 640 px con una tabla; el usuario pedía la
   misma interfaz que al facturar, y de paso el documento se ve como lo que es.

   Lo que NO se copió de la factura es lo que una cotización no guarda: unidad
   de medida, descuento e ITBIS por línea no existen en `cotizacion_items`
   (solo description, amount y quantity). Poner esas columnas habría sido pintar
   campos que el backend tira a la basura al guardar. */

interface Linea {
  id: number
  description: string
  quantity: number
  amount: number
}

const LINEA_VACIA = (): Linea => ({ id: Date.now() + Math.random(), description: '', quantity: 1, amount: 0 })

export function CotizacionFormView({ nav, cotizacionId = null }: {
  nav: Nav
  /** null => nueva; un id => se carga y se edita. */
  cotizacionId?: number | null
}) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const editing = cotizacionId != null

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [enviarCorreo, setEnviarCorreo] = useState(false)
  const [codigo, setCodigo] = useState<string>('')
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [prodPicker, setProdPicker] = useState(false)
  const [prodQuery, setProdQuery] = useState('')
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [errorCliente, setErrorCliente] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [borrando, setBorrando] = useState(false)

  // --- Emisor: el membrete del papel, igual que en la factura ---
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contactoEmisor = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')

  // --- Carga al editar ---
  const cargada = useRef(false)
  const detalle = useApiQuery(
    ['cotizaciones', 'detail', cotizacionId],
    () => (cotizacionId != null ? getCotizacion(cotizacionId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = detalle.data
    if (cargada.current || !row) return
    cargada.current = true
    setCodigo(row.code || `#${row.id}`)
    setLineas(
      (row.items ?? []).map((it, i) => ({
        id: i + 1,
        description: it.description ?? '',
        quantity: Math.max(1, Number(it.quantity ?? 1)),
        amount: Number(it.amount ?? 0),
      })),
    )
  }, [detalle.data])

  // El row de la cotización solo trae client_id + nombre; se busca el registro
  // completo para que la ficha muestre sus condiciones reales, no un placeholder.
  const clienteId = detalle.data?.client_id ?? null
  const clienteCargado = useRef(false)
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', clienteId],
    () => (clienteId ? getClient(clienteId) : Promise.resolve(null)),
  )
  useEffect(() => {
    if (clienteCargado.current || !clienteDetalle.data) return
    clienteCargado.current = true
    setCliente(mapClientRow(clienteDetalle.data))
  }, [clienteDetalle.data])

  // --- Catálogo ---
  const productos = useApiQuery(['products', 'list'], () => listProducts({ pageSize: 100 }))
  const catalogo = useMemo(() => (productos.data?.items ?? []).map(mapProductRow), [productos.data])
  const catalogoFiltrado = catalogo.filter((p) =>
    `${p.nombre} ${p.sku} ${p.cat}`.toLowerCase().includes(prodQuery.trim().toLowerCase()),
  )

  // --- Líneas ---
  const addProducto = (p: Producto) => {
    setLineas((ls) => [...ls, { id: Date.now(), description: p.nombre, quantity: 1, amount: p.precio }])
    setProdPicker(false)
    setProdQuery('')
    setErrorForm(null)
  }
  const addLineaLibre = () => { setLineas((ls) => [...ls, LINEA_VACIA()]); setErrorForm(null) }
  const delLinea = (id: number) => setLineas((ls) => ls.filter((l) => l.id !== id))
  const updLinea = (id: number, patch: Partial<Linea>) => {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setErrorForm(null)
  }

  const total = useMemo(
    () => lineas.reduce((a, l) => a + l.amount * Math.max(1, l.quantity), 0),
    [lineas],
  )

  /** Valida y arma el cuerpo que espera el API. null => hay un error en pantalla. */
  const construir = () => {
    setErrorCliente(null)
    setErrorForm(null)
    if (!cliente) {
      setErrorCliente('Selecciona un cliente.')
      return null
    }
    const items = lineas
      .filter((l) => l.description.trim() !== '' && l.amount > 0)
      .map<CotizacionItemInput>((l) => ({
        description: l.description.trim(),
        amount: l.amount,
        // El backend guarda la cantidad como entero.
        quantity: Math.max(1, Math.round(l.quantity)),
      }))
    if (items.length === 0) {
      setErrorForm('Agrega al menos una línea con descripción e importe.')
      return null
    }
    return { client_id: Number(cliente.id), items, total }
  }

  // Acción única: un doble clic crearía la misma cotización dos veces.
  const guardar = useAccionUnica(async () => {
    const base = construir()
    if (!base) return
    setGuardando(true)
    try {
      const payload = {
        ...base,
        date: new Date().toISOString().slice(0, 19).replace('T', ' '),
        user_id: user?.id,
        sent_email: enviarCorreo,
      }
      if (editing && cotizacionId != null) {
        await updateCotizacion({ id: cotizacionId, ...payload })
        toast.success(`Cotización ${codigo} actualizada.`)
      } else {
        const res = await createCotizacion(payload)
        toast.success(`Cotización ${res.code} creada.`)
      }
      if (enviarCorreo) toast.info('Se solicitó el envío por correo al cliente.')
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      setErrorForm(e instanceof ApiError ? e.message : 'No se pudo guardar la cotización.')
      setGuardando(false)
    }
  })

  const vistaPrevia = async () => {
    const base = construir()
    if (!base) return
    setPreviewing(true)
    const tid = toast.loading('Generando vista previa…')
    try {
      presentDocument(await previewCotizacion(base))
      toast.success('Vista previa generada.', { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.', { id: tid })
    } finally {
      setPreviewing(false)
    }
  }

  const borrar = async () => {
    if (cotizacionId == null) return
    setBorrando(true)
    try {
      await deleteCotizacion(cotizacionId)
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      toast.success(`Cotización ${codigo} eliminada.`)
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      setErrorForm(e instanceof ApiError ? e.message : 'No se pudo eliminar la cotización.')
      setBorrando(false)
    }
  }

  const cargandoDetalle = editing && detalle.loading

  return (
    <div className="page fx-desk factura-new">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('cotizaciones')}>Cotizaciones</Btn>
        {editing && confirmDel ? (
          <span className="row gap-sm" style={{ alignItems: 'center' }}>
            <span className="text-sm muted">¿Eliminar esta cotización?</span>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
            <Btn variant="primary" size="sm" style={{ background: 'var(--danger)' }} onClick={() => void borrar()} disabled={borrando}>
              {borrando ? 'Eliminando…' : 'Sí, eliminar'}
            </Btn>
          </span>
        ) : editing ? (
          <Btn variant="ghost" size="sm" icon="trash-2" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
            Eliminar
          </Btn>
        ) : null}
      </div>

      <article className="fx-sheet fx-sheet--ancha">
        {/* --- Emisor + identificación del documento --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisorNombre || 'Tu empresa'}</div>
            {emisor?.direccion && <div className="fx-emisor-line">{emisor.direccion}</div>}
            {contactoEmisor && <div className="fx-emisor-line">{contactoEmisor}</div>}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {emisor.rnc}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Propuesta comercial</span>
            <div className="fx-tipo-fijo">Cotización</div>
            <span className={'fx-numero' + (codigo ? '' : ' fx-numero-pend')}>
              {codigo || 'El código lo asigna el sistema al guardar'}
            </span>
            <span className="fx-aviso fx-aviso--suave">
              No es un comprobante fiscal: no lleva e-NCF ni se envía a la DGII
            </span>
          </div>
        </header>

        <div className="fx-rule" />

        <div className="fx-doc-datos">
          {/* --- Cliente --- */}
          <section className="fx-a-quien">
            <span className="fx-eyebrow">Cotizar a <span className="req">*</span></span>
            <div className="fx-cliente-row">
              <div className="fx-cliente">
                <ClientCombobox
                  value={cliente}
                  onChange={(c) => { setCliente(c); setErrorCliente(null) }}
                />
              </div>
              <button
                type="button"
                className="fx-cliente-add"
                onClick={() => setNuevoCliente(true)}
                title="Nuevo cliente"
                aria-label="Crear un cliente nuevo"
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            {errorCliente && <span className="fx-err"><Icon name="alert-circle" size={12} />{errorCliente}</span>}
          </section>

          {/* --- Condiciones --- */}
          <section className="fx-cond">
            <span className="fx-cond-item">
              <Switch on={enviarCorreo} onChange={setEnviarCorreo} />
              <span className="text-sm">
                Enviar por correo al guardar
                <span className="text-xs muted-3" style={{ display: 'block' }}>
                  {cliente?.email
                    ? `Se envía a ${cliente.email}`
                    : 'El cliente seleccionado no tiene correo registrado'}
                </span>
              </span>
            </span>
          </section>
        </div>

        {/* --- Líneas --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ecf fx-grid-cot fx-items-head">
            <span />
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span style={{ textAlign: 'right' }}>Importe</span>
          </div>

          {cargandoDetalle ? (
            <div className="state" style={{ padding: 26 }}><Spinner /></div>
          ) : (
            lineas.map((l, i) => (
              <div className="fx-grid-ecf fx-grid-cot fx-row" key={l.id}>
                <button
                  type="button"
                  className="fx-gutter"
                  onClick={() => delLinea(l.id)}
                  aria-label={`Quitar línea ${i + 1}`}
                  title="Quitar línea"
                >
                  <Icon name="x" size={14} />
                </button>

                <div className="fx-desc">
                  <input
                    className="fx-field"
                    value={l.description}
                    placeholder="Concepto (ej. Sticker Vinyl 2x2)"
                    onChange={(e) => updLinea(l.id, { description: e.target.value })}
                    aria-label={`Descripción de la línea ${i + 1}`}
                  />
                </div>

                <div className="fx-cell" data-label="Cant.">
                  <input
                    className="fx-field fx-num"
                    type="number" inputMode="numeric" min="1"
                    value={l.quantity}
                    onChange={(e) => updLinea(l.id, { quantity: +e.target.value || 1 })}
                    aria-label={`Cantidad de la línea ${i + 1}`}
                  />
                </div>

                <div className="fx-cell" data-label="Precio">
                  <input
                    className="fx-field fx-num"
                    type="number" inputMode="decimal" min="0" step="0.01"
                    value={l.amount}
                    onChange={(e) => updLinea(l.id, { amount: +e.target.value || 0 })}
                    aria-label={`Precio de la línea ${i + 1}`}
                  />
                </div>

                <div className="fx-importe" data-label="Importe">
                  <Money value={l.amount * Math.max(1, l.quantity)} cur={false} />
                </div>
              </div>
            ))
          )}

          {!cargandoDetalle && lineas.length === 0 && (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm" style={{ color: errorForm ? 'var(--danger)' : 'var(--text-2)' }}>
                {errorForm ?? 'Sin líneas. Agrega un producto del catálogo o una descripción libre.'}
              </span>
            </div>
          )}

          <div className="fx-add-row">
            <button type="button" className="fx-add" onClick={() => setProdPicker(true)}>
              <Icon name="package" size={14} />Producto
            </button>
            <button type="button" className="fx-add" onClick={addLineaLibre}>
              <Icon name="plus" size={14} />Descripción
            </button>
          </div>

          {errorForm && lineas.length > 0 && (
            <span className="fx-err" style={{ marginTop: 10 }}>
              <Icon name="alert-circle" size={12} />{errorForm}
            </span>
          )}
        </section>

        {/* --- Totales --- */}
        <section className="fx-cierre">
          <div />
          <div className="fx-totales-box">
            <div className="fx-total-final">
              <span>Total</span><span><Money value={total} cur={false} /></span>
            </div>
          </div>
        </section>

        <footer className="fx-nota">
          El código lo asigna el sistema al guardar · las condiciones de pago salen impresas en el PDF ·
          convertir la cotización en factura no la modifica
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar fx-bar--ancha">
        <div className="fx-bar-total">
          <span className="text-sm muted">{lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'}</span>
          <b><Money value={total} cur={false} /></b>
        </div>
        <div className="row gap-sm">
          <Btn variant="ghost" onClick={() => nav('cotizaciones')}>Cancelar</Btn>
          <Btn variant="secondary" icon="eye" onClick={() => void vistaPrevia()} disabled={previewing}>
            {previewing ? 'Generando…' : 'Vista previa'}
          </Btn>
          <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear cotización'}
          </Btn>
        </div>
      </div>

      {nuevoCliente && (
        <NewClientModal
          onClose={() => setNuevoCliente(false)}
          onCreated={(c) => { setCliente(c); setErrorCliente(null); setNuevoCliente(false) }}
        />
      )}

      {prodPicker && (
        <Modal title="Agregar producto o servicio" icon="package" onClose={() => setProdPicker(false)}>
          <div className="search-input mb-md" style={{ width: '100%' }}>
            <Icon name="search" />
            <input
              placeholder="Buscar por nombre, SKU o categoría…"
              value={prodQuery}
              onChange={(e) => setProdQuery(e.target.value)}
              autoFocus
            />
          </div>
          {productos.loading ? (
            <div className="state" style={{ padding: 28 }}><Spinner /></div>
          ) : productos.error ? (
            <div className="state" style={{ padding: 28 }}>
              <span className="text-sm" style={{ color: 'var(--danger)' }}>{productos.error}</span>
            </div>
          ) : catalogoFiltrado.length === 0 ? (
            <div className="state" style={{ padding: 28 }}>
              <span className="text-sm muted">
                {catalogo.length === 0 ? 'No hay productos en el catálogo.' : 'Sin resultados.'}
              </span>
            </div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -8px' }}>
              {catalogoFiltrado.map((p) => (
                <div key={p.id} className="menu-item" style={{ padding: '9px 8px' }} onClick={() => addProducto(p)}>
                  <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 32, height: 32 }}>
                    <Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="fw6 text-sm">{p.nombre}</div>
                    <div className="text-xs muted mono">{p.sku || '—'} · {p.cat}</div>
                  </div>
                  <span className="fw6 text-sm"><Money value={p.precio} cur={false} /></span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

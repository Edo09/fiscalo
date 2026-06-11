// FISCALO — Crear/editar/eliminar una cotización (CRUD contra /api/cotizaciones).
// El código lo genera el backend; el total se calcula de las líneas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Money, Icon, Checkbox, Spinner } from '@/components/ui'
import {
  ApiError, createCotizacion, updateCotizacion, deleteCotizacion, previewCotizacion,
  getClient, listProducts, mapClientRow, mapProductRow,
} from '@/api'
import type { CotizacionRow, CotizacionItemInput } from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { presentDocument } from '@/lib/file'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useSession } from '@/stores/auth'
import type { Cliente, Producto } from '@/types/domain'

interface Linea {
  id: number
  description: string
  amount: number
  quantity: number
}

/** Cliente mínimo para precargar el combobox al editar (solo id + nombre). */
function clienteFromRow(c: CotizacionRow): Cliente | null {
  if (!c.client_id) return null
  return {
    id: String(c.client_id), nombre: c.client_name || `Cliente #${c.client_id}`,
    contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
    balance: 0, facturas: 0, estado: '', desde: '',
  }
}

export function CotizacionFormModal({ cotizacion, onClose }: {
  /** null => crear; una CotizacionRow => editar. */
  cotizacion: CotizacionRow | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const editing = cotizacion !== null

  const [cliente, setCliente] = useState<Cliente | null>(cotizacion ? clienteFromRow(cotizacion) : null)
  const [lineas, setLineas] = useState<Linea[]>(() =>
    cotizacion?.items?.length
      ? cotizacion.items.map((it, i) => ({
          id: i + 1,
          description: it.description ?? '',
          amount: Number(it.amount ?? 0),
          quantity: Number(it.quantity ?? 1),
        }))
      : [{ id: 1, description: '', amount: 0, quantity: 1 }],
  )
  // Al editar, el row solo trae client_id + nombre: se busca el registro completo
  // del cliente para que la ficha muestre su RNC real (y no "sin RNC").
  const clienteEnriquecido = useRef(false)
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', cotizacion?.client_id ?? null],
    () => (cotizacion?.client_id ? getClient(cotizacion.client_id) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    if (!clienteEnriquecido.current && row && cliente && String(row.id) === cliente.id) {
      clienteEnriquecido.current = true
      setCliente(mapClientRow(row))
    }
  }, [clienteDetalle.data, cliente])

  // Catálogo de productos para agregar líneas (misma caché que Productos/Factura).
  const productos = useApiQuery(['products', 'list'], () => listProducts({ pageSize: 100 }))
  const catalogo = (productos.data?.items ?? []).map(mapProductRow)
  const [prodQuery, setProdQuery] = useState('')
  const [prodOpen, setProdOpen] = useState(false)
  const prodRef = useRef<HTMLDivElement>(null)
  const filtrados = catalogo
    .filter((p) => `${p.nombre} ${p.sku} ${p.cat}`.toLowerCase().includes(prodQuery.trim().toLowerCase()))
    .slice(0, 8)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (prodRef.current && !prodRef.current.contains(e.target as Node)) setProdOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const addProducto = (p: Producto) => {
    setLineas((ls) => {
      const nueva: Linea = { id: Date.now(), description: p.nombre, amount: p.precio, quantity: 1 }
      // Si solo hay una línea vacía (el placeholder inicial), se sustituye.
      if (ls.length === 1 && !ls[0].description.trim() && ls[0].amount === 0) return [nueva]
      return [...ls, nueva]
    })
    setProdQuery('')
    setProdOpen(false)
  }

  const [enviarCorreo, setEnviarCorreo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addLinea = () => setLineas((ls) => [...ls, { id: Date.now(), description: '', amount: 0, quantity: 1 }])
  const delLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls))
  const updLinea = (id: number, key: keyof Linea, val: string | number) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, [key]: val } : l)))

  const total = useMemo(() => lineas.reduce((a, l) => a + l.amount * l.quantity, 0), [lineas])

  /** Valida y arma {client_id, items, total}; null si hay error (lo deja en pantalla). */
  const buildBase = () => {
    if (!cliente) { setError('Selecciona un cliente.'); return null }
    const items = lineas
      .filter((l) => l.description.trim() && l.amount > 0)
      .map<CotizacionItemInput>((l) => ({
        description: l.description.trim(),
        amount: l.amount,
        quantity: Math.max(1, Math.round(l.quantity)),
      }))
    if (items.length === 0) { setError('Agrega al menos una línea con descripción e importe.'); return null }
    return { client_id: Number(cliente.id), items, total }
  }

  const save = async () => {
    setError(null)
    const base = buildBase()
    if (!base) return
    setSaving(true)
    try {
      const payload = {
        ...base,
        date: new Date().toISOString().slice(0, 19).replace('T', ' '),
        user_id: user?.id,
        sent_email: enviarCorreo,
      }
      if (editing && cotizacion) {
        await updateCotizacion({ id: cotizacion.id, ...payload })
        toast.success(`Cotización ${cotizacion.code || ''} actualizada.`)
      } else {
        const res = await createCotizacion(payload)
        toast.success(`Cotización ${res.code} creada.`)
      }
      if (enviarCorreo) toast.info('Se solicitó el envío por correo al cliente.')
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la cotización.')
      setSaving(false)
    }
  }

  const preview = async () => {
    setError(null)
    const base = buildBase()
    if (!base) return
    setPreviewing(true)
    try {
      presentDocument(await previewCotizacion(base))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.')
    } finally {
      setPreviewing(false)
    }
  }

  const remove = async () => {
    if (!cotizacion) return
    setError(null)
    setDeleting(true)
    try {
      await deleteCotizacion(cotizacion.id)
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      toast.success(`Cotización ${cotizacion.code || ''} eliminada.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la cotización.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? `Editar cotización ${cotizacion?.code ?? ''}` : 'Nueva cotización'}
      sub={editing ? cotizacion?.client_name ?? '' : 'Propuesta de precios para un cliente (no emite e-CF)'}
      icon="file-plus"
      width={640}
      onClose={onClose}
      footer={
        <>
          {editing && (confirmDel ? (
            <span className="row gap-sm" style={{ marginRight: 'auto', alignItems: 'center' }}>
              <span className="text-sm muted">¿Eliminar?</span>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
              <Btn variant="primary" size="sm" style={{ background: 'var(--danger)' }} onClick={remove} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </Btn>
            </span>
          ) : (
            <Btn variant="ghost" icon="trash-2" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>Eliminar</Btn>
          ))}
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="secondary" icon="eye" onClick={preview} disabled={previewing}>
            {previewing ? 'Generando…' : 'Vista previa'}
          </Btn>
          <Btn variant="primary" icon="save" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      <div className="field">
        <label className="label">Cliente <span className="req">*</span></label>
        <ClientCombobox value={cliente} onChange={setCliente} />
      </div>

      <div className="row between mt-md mb-sm" style={{ alignItems: 'center' }}>
        <span className="fw6 text-sm">Líneas de la cotización</span>
        <Btn variant="secondary" size="sm" icon="plus" onClick={addLinea}>Agregar línea</Btn>
      </div>

      <div ref={prodRef} className="combobox mb-sm">
        <div className="search-input" style={{ width: '100%' }}>
          <Icon name="package" />
          <input
            placeholder="Agregar del catálogo de productos…"
            value={prodQuery}
            onChange={(e) => { setProdQuery(e.target.value); setProdOpen(true) }}
            onFocus={() => setProdOpen(true)}
          />
          {productos.fetching && <Spinner />}
        </div>
        {prodOpen && (
          <div className="menu combobox-menu">
            {productos.error ? (
              <div className="combobox-msg" style={{ color: 'var(--danger)' }}>{productos.error}</div>
            ) : filtrados.length === 0 ? (
              <div className="combobox-msg">{catalogo.length === 0 ? 'No hay productos en el catálogo.' : 'Sin resultados.'}</div>
            ) : (
              filtrados.map((p) => (
                <div key={p.id} className="combobox-item row gap-sm" style={{ alignItems: 'center' }} onClick={() => addProducto(p)}>
                  <Icon name={p.tipo === 'Servicio' ? 'wrench' : 'box'} size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="cell-main">{p.nombre}</div>
                    <div className="cell-sub mono">{p.sku || '—'} · {p.cat}</div>
                  </div>
                  <span className="fw6 text-sm num"><Money value={p.precio} cur={false} /></span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Descripción</th>
              <th className="num" style={{ width: 70 }}>Cant.</th>
              <th className="num" style={{ width: 120 }}>Precio</th>
              <th className="num" style={{ width: 110 }}>Subtotal</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td><input className="input" style={{ padding: '5px 8px' }} value={l.description} onChange={(e) => updLinea(l.id, 'description', e.target.value)} placeholder="Concepto…" /></td>
                <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 58 }} type="number" min="1" value={l.quantity} onChange={(e) => updLinea(l.id, 'quantity', +e.target.value || 1)} /></td>
                <td><input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" min="0" step="0.01" value={l.amount} onChange={(e) => updLinea(l.id, 'amount', +e.target.value || 0)} /></td>
                <td className="num fw6"><Money value={l.amount * l.quantity} cur={false} /></td>
                <td><Btn variant="ghost" size="sm" icon="trash-2" onClick={() => delLinea(l.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row between mt-md" style={{ alignItems: 'center' }}>
        <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setEnviarCorreo(!enviarCorreo)}>
          <Checkbox on={enviarCorreo} onChange={setEnviarCorreo} />
          <span className="text-sm">Enviar por correo al cliente al guardar</span>
        </span>
        <span className="fw6" style={{ fontSize: 17 }}>Total <Money value={total} /></span>
      </div>
      <div className="text-xs muted-3 mt-sm">El código de la cotización lo asigna el sistema al guardar.</div>
    </Modal>
  )
}

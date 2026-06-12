import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Money, Modal, Badge, Checkbox } from '@/components/ui'
import { ApiError, createGasto, getGastoStats } from '@/api'
import type { CreateGastoInput, GastoCategoria, GastoItemInput, GastoRow, GastoTipo } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CATEGORIA_TIPOS, GASTO_TIPOS, isAutoEmision } from '@/config/gastos'
import { ProveedorCombobox } from '@/features/suppliers/ProveedorCombobox'
import type { Proveedor } from '@/types/domain'

interface Linea {
  id: number
  description: string
  amount: number
  quantity: number
  itbis_amount: number
}

const hoy = () => new Date().toISOString().slice(0, 10)

/* FISCALO — Registrar gasto/compra (POST /api/gastos).
   La categoría la fija la página que abre el modal:
   Gastos -> gastos_menores · Compras -> facturas_proveedores */
export function GastoFormModal({ categoria, onClose, onCreated }: {
  categoria: GastoCategoria
  onClose: () => void
  onCreated: (g: GastoRow) => void
}) {
  const [tipo, setTipo] = useState<GastoTipo>(CATEGORIA_TIPOS[categoria][0])
  const [proveedor, setProveedor] = useState<Proveedor | null>(null)
  const [ncf, setNcf] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [conProveedor, setConProveedor] = useState(false)
  const [lineas, setLineas] = useState<Linea[]>([{ id: 1, description: '', amount: 0, quantity: 1, itbis_amount: 0 }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const tiposPermitidos = CATEGORIA_TIPOS[categoria]
  const recibido = !isAutoEmision(tipo)
  const esCompra = categoria === 'facturas_proveedores'
  const esGastoMenor = !esCompra

  // Próximo NCF (informativo): misma query cacheada que la página de Gastos;
  // se invalida al crear, así que siempre refleja la secuencia vigente.
  const stats = useApiQuery(['gastos', 'stats'], () => getGastoStats())
  const seqE43 = stats.data?.secuencias.find((s) => s.type === 'E43')
  const proximoNcf = seqE43 != null ? `E43${String(seqE43.secuencia_actual + 1).padStart(10, '0')}` : null
  const seqCompra = (!recibido && esCompra) ? stats.data?.secuencias.find((s) => s.type === tipo) : undefined
  const proximoNcfCompra = seqCompra != null ? `${tipo}${String(seqCompra.secuencia_actual + 1).padStart(10, '0')}` : null

  const addLinea = () => setLineas((ls) => [...ls, { id: Date.now(), description: '', amount: 0, quantity: 1, itbis_amount: 0 }])
  const delLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls))
  const updLinea = (id: number, key: keyof Linea, val: string | number) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, [key]: val } : l)))

  const { subtotal, itbis, total } = useMemo(() => {
    const sub = lineas.reduce((a, l) => a + l.amount * l.quantity, 0)
    const itb = lineas.reduce((a, l) => a + l.itbis_amount, 0)
    return { subtotal: sub, itbis: itb, total: sub + itb }
  }, [lineas])

  const submit = async () => {
    setError(null)
    // Gastos menores (E43): proveedor enteramente opcional (el e-CF 43 se emite
    // sin comprador y el backend pone fecha y etiqueta por defecto).
    if (esCompra) {
      if (!proveedor) { setError('Selecciona un proveedor del directorio o crea uno nuevo.'); return }
      if (!proveedor.rnc) { setError('El proveedor seleccionado no tiene RNC; complétalo en Proveedores.'); return }
      if (recibido && !ncf.trim()) { setError(`El tipo ${tipo} es recibido: digita el NCF que entregó el proveedor.`); return }
    }
    const items = lineas.filter((l) => l.description.trim() && l.amount > 0)
    if (items.length === 0) { setError('Agrega al menos una línea con descripción e importe.'); return }

    // En gastos menores el proveedor solo viaja si el usuario activó la sección.
    const incluirProveedor = (esCompra || conProveedor) && proveedor != null
    const payload: CreateGastoInput = {
      categoria,
      tipo_gasto: tipo,
      rnc_proveedor: incluirProveedor && proveedor ? proveedor.rnc : '',
      nombre_proveedor: incluirProveedor && proveedor ? proveedor.nombre : '',
      items: items.map<GastoItemInput>((l) => ({
        description: l.description.trim(),
        amount: l.amount,
        quantity: l.quantity,
        itbis_amount: l.itbis_amount,
      })),
    }
    if (esCompra) payload.fecha = fecha
    if (recibido) payload.ncf = ncf.trim()

    setSaving(true)
    try {
      const g = await createGasto(payload)
      toast.success(`${esCompra ? 'Compra registrada' : 'Gasto registrado'}${g.ncf ? ` · ${g.ncf}` : ''}.`)
      if (g.aviso) toast.warning(g.aviso)
      onCreated(g)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el gasto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={esCompra ? 'Registrar compra' : 'Registrar gasto'}
      sub={esCompra
        ? 'Factura de proveedor: auto-emisión (E41/E47) o recibida (E31/B01/E33/E34)'
        : 'Gasto menor (E43, auto-emisión a DGII)'}
      icon={esCompra ? 'shopping-cart' : 'receipt'}
      width={620}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="check" onClick={submit} disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="card card-pad row gap-sm mb-md" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
          <Icon name="alert-circle" size={16} /><span className="fw6 text-sm">{error}</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label>Tipo de comprobante</label>
          {tiposPermitidos.length === 1 ? (
            <div className="input row gap-sm" style={{ color: 'var(--text-2)', alignItems: 'center', background: 'var(--surface-2)', cursor: 'default' }}>
              <span className="ecf-tag">{tipo}</span>
              <span className="text-sm">{GASTO_TIPOS[tipo].label} · NCF {GASTO_TIPOS[tipo].ncf}</span>
            </div>
          ) : (
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as GastoTipo)}>
              {tiposPermitidos.map((t) => <option key={t} value={t}>{t} · {GASTO_TIPOS[t].label}</option>)}
            </select>
          )}
        </div>

        {esGastoMenor ? (
          <div className="field">
            <label>NCF a asignar</label>
            <div className="input row gap-sm" style={{ alignItems: 'center', background: 'var(--surface-2)', cursor: 'default' }}>
              <Icon name="hash" size={14} style={{ color: 'var(--text-3)' }} />
              {stats.loading ? (
                <span className="text-sm muted">Cargando…</span>
              ) : proximoNcf ? (
                <span className="mono fw6">{proximoNcf}</span>
              ) : (
                <span className="text-sm muted-3">Sin secuencia E43</span>
              )}
            </div>
          </div>
        ) : recibido ? (
          <div className="field">
            <label>NCF del proveedor <span className="req">*</span></label>
            <input className="input mono" value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="E310000000123" />
          </div>
        ) : (
          <div className="field">
            <label>NCF a asignar</label>
            <div className="input row gap-sm" style={{ alignItems: 'center', background: 'var(--surface-2)', cursor: 'default' }}>
              <Icon name="hash" size={14} style={{ color: 'var(--text-3)' }} />
              {stats.loading ? (
                <span className="text-sm muted">Cargando…</span>
              ) : proximoNcfCompra ? (
                <span className="mono fw6">{proximoNcfCompra}</span>
              ) : (
                <span className="text-sm muted-3">Sin secuencia {tipo}</span>
              )}
            </div>
          </div>
        )}

        {esGastoMenor ? (
          <>
            <div className="field">
              <label>Proveedor</label>
              <div
                className="input row gap-sm"
                style={{ alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setConProveedor(!conProveedor)}
              >
                <Checkbox on={conProveedor} onChange={setConProveedor} />
                <span className="text-sm">Información del proveedor (opcional)</span>
              </div>
            </div>
            {conProveedor && (
              <div className="field full">
                <label>Proveedor <span className="opt">(busca o crea uno)</span></label>
                <ProveedorCombobox value={proveedor} onChange={setProveedor} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field full">
              <label>Proveedor <span className="req">*</span></label>
              <ProveedorCombobox value={proveedor} onChange={setProveedor} />
            </div>
            {recibido && (
              <div className="field">
                <label>Fecha</label>
                <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="row between mt-md mb-sm" style={{ alignItems: 'center' }}>
        <span className="fw6 text-sm">Líneas del gasto</span>
        <Btn variant="secondary" size="sm" icon="plus" onClick={addLinea}>Agregar línea</Btn>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>Descripción</th>
              <th className="num" style={{ width: 70 }}>Cant.</th>
              <th className="num" style={{ width: 110 }}>Importe</th>
              <th className="num" style={{ width: 100 }}>ITBIS</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td><input className="input" style={{ padding: '5px 8px' }} value={l.description} onChange={(e) => updLinea(l.id, 'description', e.target.value)} placeholder="Concepto…" /></td>
                <td><input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 58 }} type="number" value={l.quantity} onChange={(e) => updLinea(l.id, 'quantity', +e.target.value || 0)} /></td>
                <td><input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.amount} onChange={(e) => updLinea(l.id, 'amount', +e.target.value || 0)} /></td>
                <td><input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.itbis_amount} onChange={(e) => updLinea(l.id, 'itbis_amount', +e.target.value || 0)} /></td>
                <td><Btn variant="ghost" size="sm" icon="trash-2" onClick={() => delLinea(l.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row between mt-md" style={{ alignItems: 'center' }}>
        <Badge tone={recibido ? 'neutral' : 'accent'}>
          {recibido ? 'Recibido · solo se registra' : 'Auto-emisión · se emite a DGII'}
        </Badge>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="text-xs muted">Subtotal <Money value={subtotal} cur={false} /> · ITBIS <Money value={itbis} cur={false} /></span>
          <span className="fw6" style={{ fontSize: 17 }}>Total <Money value={total} /></span>
        </div>
      </div>
      <div className="text-xs muted-3 mt-sm">El backend recalcula los totales y la secuencia NCF al guardar.</div>
    </Modal>
  )
}

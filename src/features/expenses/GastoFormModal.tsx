import { useMemo, useState } from 'react'
import { Icon, Btn, Money, Modal, Badge } from '@/components/ui'
import { ApiError, createGasto } from '@/api'
import type { CreateGastoInput, GastoCategoria, GastoItemInput, GastoRow, GastoTipo } from '@/api'
import {
  CATEGORIA_TIPOS, CATEGORIA_LABEL, GASTO_CATEGORIAS, GASTO_TIPOS, isAutoEmision,
} from '@/app/gastos'

interface Linea {
  id: number
  description: string
  amount: number
  quantity: number
  itbis_amount: number
}

const hoy = () => new Date().toISOString().slice(0, 10)

/* FISCALO — Registrar gasto (POST /api/gastos) */
export function GastoFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (g: GastoRow) => void }) {
  const [categoria, setCategoria] = useState<GastoCategoria>('gastos_menores')
  const [tipo, setTipo] = useState<GastoTipo>('E43')
  const [rnc, setRnc] = useState('')
  const [nombre, setNombre] = useState('')
  const [ncf, setNcf] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [lineas, setLineas] = useState<Linea[]>([{ id: 1, description: '', amount: 0, quantity: 1, itbis_amount: 0 }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const tiposPermitidos = CATEGORIA_TIPOS[categoria]
  const recibido = !isAutoEmision(tipo)

  const onCategoria = (c: GastoCategoria) => {
    setCategoria(c)
    setTipo(CATEGORIA_TIPOS[c][0]) // primer tipo válido de la categoría
  }

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
    if (!nombre.trim()) { setError('Indica el nombre del proveedor.'); return }
    if (!rnc.trim()) { setError('Indica el RNC/Cédula del proveedor.'); return }
    if (recibido && !ncf.trim()) { setError(`El tipo ${tipo} es recibido: digita el NCF que entregó el proveedor.`); return }
    const items = lineas.filter((l) => l.description.trim() && l.amount > 0)
    if (items.length === 0) { setError('Agrega al menos una línea con descripción e importe.'); return }

    const payload: CreateGastoInput = {
      categoria,
      tipo_gasto: tipo,
      rnc_proveedor: rnc.trim(),
      nombre_proveedor: nombre.trim(),
      fecha,
      items: items.map<GastoItemInput>((l) => ({
        description: l.description.trim(),
        amount: l.amount,
        quantity: l.quantity,
        itbis_amount: l.itbis_amount,
      })),
    }
    if (recibido) payload.ncf = ncf.trim()

    setSaving(true)
    try {
      const g = await createGasto(payload)
      onCreated(g)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el gasto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Registrar gasto"
      sub="Gasto menor (auto-emisión) o factura de proveedor (recibida)"
      icon="receipt"
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
          <label>Categoría</label>
          <select className="select" value={categoria} onChange={(e) => onCategoria(e.target.value as GastoCategoria)}>
            {GASTO_CATEGORIAS.map((c) => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de comprobante</label>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as GastoTipo)}>
            {tiposPermitidos.map((t) => <option key={t} value={t}>{t} · {GASTO_TIPOS[t].label}</option>)}
          </select>
        </div>

        <div className="field">
          <label>RNC / Cédula proveedor <span className="req">*</span></label>
          <input className="input mono" value={rnc} onChange={(e) => setRnc(e.target.value)} placeholder="131880681" />
        </div>
        <div className="field">
          <label>Nombre proveedor <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Suplidora XYZ SRL" />
        </div>

        {recibido ? (
          <div className="field">
            <label>NCF del proveedor <span className="req">*</span></label>
            <input className="input mono" value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="E310000000123" />
          </div>
        ) : (
          <div className="field">
            <label>NCF</label>
            <div className="input row gap-sm" style={{ color: 'var(--text-3)', alignItems: 'center' }}>
              <Icon name="shield-check" size={14} /><span className="text-sm">Lo asigna el sistema (auto-emisión)</span>
            </div>
          </div>
        )}
        <div className="field">
          <label>Fecha</label>
          <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
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

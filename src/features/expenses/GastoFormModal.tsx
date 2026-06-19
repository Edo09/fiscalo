import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Icon, Btn, Money, Modal, Badge, Checkbox } from '@/components/ui'
import { ApiError, createGasto, getGastoStats } from '@/api'
import type { CreateGastoInput, GastoCategoria, GastoItemInput, GastoRow, GastoTipo } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CATEGORIA_TIPOS, GASTO_TIPOS, isAutoEmision } from '@/config/gastos'
import { ProveedorCombobox } from '@/features/suppliers/ProveedorCombobox'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import type { Proveedor } from '@/types/domain'
import { gastoFormSchema, mapGastoIssues, emptyGastoErrors, type GastoFormErrors } from './gasto.schema'

interface Linea {
  id: number
  description: string
  amount: number
  quantity: number
  itbis_amount: number
  /** Código DGII de unidad de medida (id del catálogo; 43 = Unidad). */
  unidad_medida: number
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
  const [lineas, setLineas] = useState<Linea[]>([{ id: 1, description: '', amount: 0, quantity: 1, itbis_amount: 0, unidad_medida: 43 }])
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<GastoFormErrors>(emptyGastoErrors)
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

  // Limpia los errores en línea de una fila al editarla (o al eliminarla).
  const clearLineaErr = (id: number) =>
    setErrors((e) =>
      e.lineas[id]
        ? { ...e, lineas: Object.fromEntries(Object.entries(e.lineas).filter(([k]) => Number(k) !== id)) }
        : e,
    )
  const addLinea = () => setLineas((ls) => [...ls, { id: Date.now(), description: '', amount: 0, quantity: 1, itbis_amount: 0, unidad_medida: 43 }])
  const delLinea = (id: number) => {
    setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls))
    clearLineaErr(id)
  }
  const updLinea = (id: number, key: keyof Linea, val: string | number) => {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, [key]: val } : l)))
    clearLineaErr(id)
  }

  const { subtotal, itbis, total } = useMemo(() => {
    const sub = lineas.reduce((a, l) => a + l.amount * l.quantity, 0)
    const itb = lineas.reduce((a, l) => a + l.itbis_amount, 0)
    return { subtotal: sub, itbis: itb, total: sub + itb }
  }, [lineas])

  // Líneas con algún contenido (las completamente vacías se ignoran). Gastos
  // menores (E43): proveedor opcional; el backend pone fecha/etiqueta por defecto.
  const lineasConContenido = () =>
    lineas.filter((l) => l.description.trim() !== '' || l.amount > 0 || l.itbis_amount > 0)

  /**
   * Valida el formulario con Zod (gastoFormSchema). Pinta errores en línea por
   * campo/línea y muestra un toast resumen. Devuelve true si el form es válido.
   */
  function validateForm(): boolean {
    const validables = lineasConContenido()
    const res = gastoFormSchema.safeParse({ esCompra, recibido, tipo, proveedor, ncf, lineas: validables })
    if (!res.success) {
      setErrors(mapGastoIssues(res.error, validables))
      const n = res.error.issues.length
      toast.error(n === 1 ? 'Revisa 1 campo del formulario.' : `Revisa ${n} campos del formulario.`)
      return false
    }
    setErrors(emptyGastoErrors())
    return true
  }

  const submit = async () => {
    setError(null)
    if (!validateForm()) return
    const items = lineasConContenido()

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
        unidad_medida: String(l.unidad_medida),
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
          <div className={'field' + (errors.ncf ? ' field-error' : '')}>
            <label>NCF del proveedor <span className="req">*</span></label>
            <input className="input mono" value={ncf} onChange={(e) => { setNcf(e.target.value); if (errors.ncf) setErrors((er) => ({ ...er, ncf: undefined })) }} placeholder="E310000000123" />
            {errors.ncf && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.ncf}</div>}
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
            <div className={'field full' + (errors.proveedor ? ' field-error' : '')}>
              <label>Proveedor <span className="req">*</span></label>
              <ProveedorCombobox value={proveedor} onChange={(p) => { setProveedor(p); if (errors.proveedor) setErrors((er) => ({ ...er, proveedor: undefined })) }} />
              {errors.proveedor && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.proveedor}</div>}
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
              <th style={{ minWidth: 150 }}>Descripción</th>
              <th className="num" style={{ width: 64 }}>Cant.</th>
              <th style={{ width: 140 }}>Unidad</th>
              <th className="num" style={{ width: 104 }}>Importe</th>
              <th className="num" style={{ width: 96 }}>ITBIS</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const le = errors.lineas[l.id]
              return (
              <tr key={l.id} style={{ cursor: 'default' }}>
                <td className={le?.description ? 'field-error' : undefined}>
                  <input className="input" style={{ padding: '5px 8px' }} value={l.description} onChange={(e) => updLinea(l.id, 'description', e.target.value)} placeholder="Concepto…" />
                  {le?.description && <div className="err-msg">{le.description}</div>}
                </td>
                <td className={le?.quantity ? 'field-error' : undefined}>
                  <input className="input" style={{ padding: '5px 8px', textAlign: 'right', width: 56 }} type="number" value={l.quantity} onChange={(e) => updLinea(l.id, 'quantity', +e.target.value || 0)} />
                  {le?.quantity && <div className="err-msg">{le.quantity}</div>}
                </td>
                <td className={le?.unidad_medida ? 'field-error' : undefined}>
                  <UnidadMedidaSelect style={{ padding: '5px 8px' }} value={l.unidad_medida} onChange={(v) => updLinea(l.id, 'unidad_medida', v)} />
                  {le?.unidad_medida && <div className="err-msg">{le.unidad_medida}</div>}
                </td>
                <td className={le?.amount ? 'field-error' : undefined}>
                  <input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.amount} onChange={(e) => updLinea(l.id, 'amount', +e.target.value || 0)} />
                  {le?.amount && <div className="err-msg">{le.amount}</div>}
                </td>
                <td className={le?.itbis_amount ? 'field-error' : undefined}>
                  <input className="input num" style={{ padding: '5px 8px', textAlign: 'right' }} type="number" value={l.itbis_amount} onChange={(e) => updLinea(l.id, 'itbis_amount', +e.target.value || 0)} />
                  {le?.itbis_amount && <div className="err-msg">{le.itbis_amount}</div>}
                </td>
                <td><Btn variant="ghost" size="sm" icon="trash-2" onClick={() => delLinea(l.id)} /></td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {errors.form && (
        <div className="row gap-sm text-sm mt-sm" style={{ color: 'var(--danger)', alignItems: 'center' }}>
          <Icon name="alert-circle" size={13} />{errors.form}
        </div>
      )}

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

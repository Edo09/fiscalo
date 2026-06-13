// FISCALO — Alta/edición/eliminación de un producto (CRUD contra /api/products).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Seg, Icon } from '@/components/ui'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import { ApiError, createProduct, updateProduct, deleteProduct } from '@/api'
import type { Producto } from '@/types/domain'

interface ProductFormModalProps {
  /** null => crear; un Producto => editar. */
  product: Producto | null
  onClose: () => void
  /** Se llama tras guardar/eliminar con éxito (la vista recarga la lista). */
  onSaved: () => void
}

export function ProductFormModal({ product, onClose, onSaved }: ProductFormModalProps) {
  const queryClient = useQueryClient()
  const editing = product !== null
  const [nombre, setNombre] = useState(product && product.nombre !== '—' ? product.nombre : '')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [categoria, setCategoria] = useState(product && product.cat !== '—' ? product.cat : '')
  const [tipo, setTipo] = useState<'Bien' | 'Servicio'>(product?.tipo === 'Servicio' ? 'Servicio' : 'Bien')
  const [gravado, setGravado] = useState(product ? product.itbis > 0 : true)
  const [unidadMedida, setUnidadMedida] = useState(product?.unidadMedida || 43)
  const [precio, setPrecio] = useState(product ? String(product.precio) : '')
  const [costo, setCosto] = useState(product ? String(product.costo) : '')
  const [stock, setStock] = useState(product?.stock != null ? String(product.stock) : '')
  const [stockMin, setStockMin] = useState(product?.min != null ? String(product.min) : '')
  const [activo, setActivo] = useState(product ? product.estado !== 'Inactivo' : true)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setError(null)
    setSaving(true)
    const payload = {
      nombre: nombre.trim(),
      sku: sku.trim() || undefined,
      categoria: categoria.trim() || undefined,
      indicador_bien_servicio: tipo === 'Servicio' ? 2 : 1,
      indicador_facturacion: gravado ? 1 : 4, // 1=gravado 18%, 4=exento
      unidad_medida: String(unidadMedida),
      precio: Number(precio) || 0,
      costo: Number(costo) || 0,
      stock: tipo === 'Servicio' || stock === '' ? null : Number(stock),
      stock_minimo: stockMin === '' ? null : Number(stockMin),
      activo,
    }
    try {
      if (editing && product) await updateProduct({ id: product.id, ...payload })
      else await createProduct(payload)
      // Invalida la caché de productos en TODAS las vistas (lista y picker de factura).
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(editing ? `Producto "${payload.nombre}" actualizado.` : `Producto "${payload.nombre}" creado.`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el producto.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!product) return
    setError(null)
    setDeleting(true)
    try {
      await deleteProduct(product.id)
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Producto "${product.nombre}" eliminado.`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el producto.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar producto' : 'Nuevo producto'}
      sub={editing ? product?.nombre : 'Agrega un artículo al catálogo'}
      icon="package"
      width={560}
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
          <Btn variant="primary" icon="save" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </>
      }
    >
      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto o servicio" autoFocus />
        </div>
        <div className="field">
          <label className="label">SKU <span className="opt">(opcional)</span></label>
          <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. ALM-0451" />
        </div>
        <div className="field">
          <label className="label">Categoría <span className="opt">(opcional)</span></label>
          <input className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej. Alimentos" />
        </div>
        <div className="field">
          <label className="label">Tipo</label>
          <Seg options={['Bien', 'Servicio']} value={tipo} onChange={(v) => setTipo(v as 'Bien' | 'Servicio')} />
        </div>
        <div className="field">
          <label className="label">ITBIS</label>
          <div className="row gap-sm" style={{ alignItems: 'center', minHeight: 36 }}>
            <Switch on={gravado} onChange={setGravado} />
            <span className="text-sm muted">{gravado ? 'Gravado 18%' : 'Exento'}</span>
          </div>
        </div>
        <div className="field">
          <label className="label">Unidad de medida</label>
          <UnidadMedidaSelect value={unidadMedida} onChange={setUnidadMedida} />
        </div>
        <div className="field">
          <label className="label">Precio (RD$)</label>
          <input className="input num" type="number" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field">
          <label className="label">Costo (RD$)</label>
          <input className="input num" type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0.00" />
        </div>
        {tipo === 'Bien' && (
          <>
            <div className="field">
              <label className="label">Existencia</label>
              <input className="input num" type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="—" />
            </div>
            <div className="field">
              <label className="label">Stock mínimo</label>
              <input className="input num" type="number" value={stockMin} onChange={(e) => setStockMin(e.target.value)} placeholder="—" />
            </div>
          </>
        )}
        <div className="field full">
          <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActivo(!activo)}>
            <Switch on={activo} onChange={setActivo} />
            <span className="text-sm">Activo (visible en facturación)</span>
          </span>
        </div>
      </div>
    </Modal>
  )
}

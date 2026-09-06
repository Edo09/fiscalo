// FISCALO — Alta/edición/eliminación de un producto (CRUD contra /api/products).
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Seg, Icon } from '@/components/ui'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import { ApiError, createProduct, updateProduct, deleteProduct, listCategories, listWarehouses } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Producto } from '@/types/domain'

/** Valores con los que abrir el alta (p. ej. la línea de factura que se convierte). */
export interface ProductoInicial {
  nombre?: string
  precio?: number
  unidadMedida?: number
  tipo?: 'Bien' | 'Servicio'
  gravado?: boolean
}

interface ProductFormModalProps {
  /** null => crear; un Producto => editar. */
  product: Producto | null
  /**
   * Prellenado del alta. Solo aplica al crear: sirve para convertir en producto
   * algo que el usuario ya escribió en otra pantalla, sin volver a teclearlo.
   */
  initial?: ProductoInicial
  onClose: () => void
  /**
   * Tras guardar o eliminar. Al CREAR recibe el producto recién creado, para que
   * quien abrió el modal pueda enlazarlo en el acto (la factura necesita el id:
   * sin él la venta no descuenta inventario). En editar/eliminar llega null.
   */
  onSaved: (creado?: Producto | null) => void
}

export function ProductFormModal({ product, initial, onClose, onSaved }: ProductFormModalProps) {
  const queryClient = useQueryClient()
  const editing = product !== null
  const [nombre, setNombre] = useState(
    product && product.nombre !== '—' ? product.nombre : (initial?.nombre ?? ''),
  )
  const [sku, setSku] = useState(product?.sku ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId != null ? String(product.categoryId) : '')
  const [warehouseId, setWarehouseId] = useState(product?.warehouseId != null ? String(product.warehouseId) : '')
  const [tipo, setTipo] = useState<'Bien' | 'Servicio'>(
    (product ? product.tipo : initial?.tipo) === 'Servicio' ? 'Servicio' : 'Bien',
  )
  const [gravado, setGravado] = useState(product ? product.itbis > 0 : (initial?.gravado ?? true))
  const [unidadMedida, setUnidadMedida] = useState(product?.unidadMedida || initial?.unidadMedida || 43)
  const [precio, setPrecio] = useState(
    product ? String(product.precio) : (initial?.precio ? String(initial.precio) : ''),
  )
  const [costo, setCosto] = useState(product ? String(product.costo) : '')
  const [stock, setStock] = useState(product?.stock != null ? String(product.stock) : '')
  const [stockMin, setStockMin] = useState(product?.min != null ? String(product.min) : '')
  const [activo, setActivo] = useState(product ? product.estado !== 'Inactivo' : true)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Opciones de los selects (inventario). Listas pequeñas → cargar todas.
  const catsQ = useApiQuery(['categories', 'list'], () => listCategories({ pageSize: 100 }))
  const whQ = useApiQuery(['warehouses', 'list'], () => listWarehouses({ pageSize: 100 }))
  const categories = useMemo(() => catsQ.data?.items ?? [], [catsQ.data])
  const warehouses = useMemo(() => whQ.data?.items ?? [], [whQ.data])

  // Al crear, preseleccionar el Almacén Principal (o el primero) cuando carguen.
  useEffect(() => {
    if (editing || warehouseId || warehouses.length === 0) return
    const principal = warehouses.find((w) => (w.nombre || '').toLowerCase().includes('principal'))
    setWarehouseId(String((principal ?? warehouses[0]).id))
  }, [warehouses, editing, warehouseId])

  const save = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setError(null)
    setSaving(true)
    const payload = {
      nombre: nombre.trim(),
      sku: sku.trim() || undefined,
      category_id: categoryId ? Number(categoryId) : null,
      warehouse_id: warehouseId ? Number(warehouseId) : undefined,
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
      let creado: Producto | null = null
      if (editing && product) {
        await updateProduct({ id: product.id, ...payload })
      } else {
        const res = await createProduct(payload)
        // Se arma con lo que se acaba de enviar en vez de recargar el catálogo:
        // el id es lo único que faltaba y ya viene en la respuesta.
        creado = {
          id: String(res.id),
          sku: payload.sku ?? '',
          nombre: payload.nombre,
          cat: '',
          categoryId: payload.category_id ?? null,
          warehouseId: payload.warehouse_id ?? null,
          tipo,
          precio: payload.precio,
          costo: payload.costo,
          stock: payload.stock,
          min: payload.stock_minimo,
          itbis: gravado ? 18 : 0,
          unidadMedida,
          estado: activo ? 'Activo' : 'Inactivo',
        }
      }
      // Invalida la caché de productos en TODAS las vistas (lista y picker de factura).
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(editing ? `Producto "${payload.nombre}" actualizado.` : `Producto "${payload.nombre}" creado.`)
      onSaved(creado)
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
      onSaved(null)
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
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={catsQ.loading}>
            <option value="">Sin categoría</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Almacén</label>
          <select className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={whQ.loading}>
            {warehouses.length === 0 && <option value="">{whQ.loading ? 'Cargando…' : 'Sin almacenes'}</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nombre}</option>)}
          </select>
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

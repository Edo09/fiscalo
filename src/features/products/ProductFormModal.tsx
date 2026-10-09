// FISCALO — Alta/edición/eliminación de un producto (CRUD contra /api/products).
// La foto (una por producto) se elige y se ve al instante, ya reducida, pero se
// sube al Guardar, después del producto: Cancelar no deja nada a medias.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Seg, Icon } from '@/components/ui'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import { admiteDecimales, unidadValida, useUnidadesMedida } from '@/components/unidadesMedida'
import {
  ApiError, createProduct, updateProduct, deleteProduct, listCategories, listWarehouses, subirFotoProducto, quitarFotoProducto,
} from '@/api'
import { API_BASE_URL } from '@/api/config'
import { reducirFoto, TIPOS_FOTO, urlFoto } from '@/lib/fotoProducto'
import type { UnidadMedida } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { redondear } from '@/features/invoices/montosLinea'
import { decimalesDe } from '@/lib/format'
import type { Producto } from '@/types/domain'

/** Largo máximo del nombre (columna products.nombre). */
const MAX_NOMBRE = 150

/** Decimales que guarda products.stock / stock_minimo (DECIMAL(15,3)). */
const MAX_DECIMALES_STOCK = 3

/** Tope de products.stock / stock_minimo: DECIMAL(15,3) llega a 999,999,999,999.999. */
const MAX_EXISTENCIA = 1e12

/**
 * Qué está mal en la existencia o el stock mínimo, o null si está bien. Mismo
 * criterio que problemaCantidad (la unidad decide si hay fracciones, hasta 3
 * decimales), pero aquí el 0 vale y la existencia puede venir negativa: el
 * libro deja vender sin existencia, y bloquearla impediría editar el producto.
 *
 * `sinCambio`: al editar, el valor y la unidad son los que ya tenía el
 * producto. Entonces no se juzgan los decimales ni la unidad, igual que el
 * backend (productController::problemaExistencias): el libro puede dejar 8,5 en
 * un producto por «Unidad» (una línea de factura vendida en metros) y, si se
 * juzgara, no se podría guardar ni un cambio de precio. Lo demás sí se revisa.
 */
function problemaExistencia(
  valor: string,
  campo: 'la existencia' | 'el stock mínimo',
  unidadId: number,
  catalogo: UnidadMedida[],
  sinCambio = false,
): string | null {
  if (valor.trim() === '') return null
  const n = Number(valor)
  const alInicio = campo.charAt(0).toUpperCase() + campo.slice(1)
  if (!Number.isFinite(n)) return `${alInicio} tiene que ser un número.`
  if (campo === 'el stock mínimo' && n < 0) return 'El stock mínimo no puede ser negativo.'
  // Se mira lo que se guarda (3 decimales), como el backend.
  if (Math.abs(redondear(n, MAX_DECIMALES_STOCK)) >= MAX_EXISTENCIA) return `${alInicio} es demasiado grande.`
  const dec = decimalesDe(Math.abs(n))
  if (dec === 0 || sinCambio) return null
  if (!admiteDecimales(unidadId, catalogo)) {
    const u = catalogo.find((x) => x.id === unidadId)
    return `Con la unidad «${u?.descripcion ?? 'Unidad'}» ${campo} va sin decimales: quítalos o cambia la unidad.`
  }
  if (dec > MAX_DECIMALES_STOCK) return `${alInicio} admite hasta ${MAX_DECIMALES_STOCK} decimales.`
  return null
}

/** Foto en el formulario: la que ya tiene, una nueva sin subir todavía, o ninguna. */
type Foto =
  | { tipo: 'guardada'; ruta: string }
  | { tipo: 'nueva'; blob: Blob; vista: string }
  | { tipo: 'ninguna' }

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
  const [foto, setFoto] = useState<Foto>(product?.imagen ? { tipo: 'guardada', ruta: product.imagen } : { tipo: 'ninguna' })
  const [preparandoFoto, setPreparandoFoto] = useState(false)
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  const [fotoRota, setFotoRota] = useState(false)
  const elegirFotoRef = useRef<HTMLInputElement>(null)
  // La vista previa de una foto nueva es un blob: se libera al cambiarla o al cerrar.
  const vistaNueva = foto.tipo === 'nueva' ? foto.vista : null
  useEffect(() => () => { if (vistaNueva) URL.revokeObjectURL(vistaNueva) }, [vistaNueva])
  const srcFoto = foto.tipo === 'nueva' ? foto.vista : foto.tipo === 'guardada' ? urlFoto(API_BASE_URL, foto.ruta) : null

  const elegirFoto = async (archivo: File | undefined) => {
    if (!archivo) return
    setErrorFoto(null)
    setPreparandoFoto(true)
    try {
      const blob = await reducirFoto(archivo)
      setFotoRota(false)
      setFoto({ tipo: 'nueva', blob, vista: URL.createObjectURL(blob) })
    } catch (e) {
      setErrorFoto(e instanceof Error ? e.message : 'No se pudo usar esa foto.')
    } finally {
      setPreparandoFoto(false)
    }
  }

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Opciones de los selects (inventario). Listas pequeñas → cargar todas.
  const catsQ = useApiQuery(['categories', 'list'], () => listCategories({ pageSize: 100 }))
  const whQ = useApiQuery(['warehouses', 'list'], () => listWarehouses({ pageSize: 100 }))
  const categories = useMemo(() => catsQ.data?.items ?? [], [catsQ.data])
  const warehouses = useMemo(() => whQ.data?.items ?? [], [whQ.data])
  const unidades = useUnidadesMedida()
  // Existencia en kg o metros puede llevar fracción; en unidades o cajas no.
  // Se revisa mientras se escribe y al cambiar la unidad, no solo al guardar:
  // antes 12.5 se guardaba como 12 sin decir nada.
  const fracciona = admiteDecimales(unidadMedida, unidades)
  // Al editar, un valor que no se tocó y con la misma unidad no se juzga por
  // decimales (ver problemaExistencia). La misma tolerancia que el backend.
  const sinCambio = (valor: string, original: number | null | undefined) =>
    editing && product != null && unidadMedida === product.unidadMedida && original != null &&
    valor.trim() !== '' && Number.isFinite(Number(valor)) && Math.abs(Number(valor) - original) < 0.0005
  const problemaStock = tipo === 'Bien'
    ? problemaExistencia(stock, 'la existencia', unidadMedida, unidades, sinCambio(stock, product?.stock))
    : null
  const problemaMin = tipo === 'Bien'
    ? problemaExistencia(stockMin, 'el stock mínimo', unidadMedida, unidades, sinCambio(stockMin, product?.min))
    : null

  // Al crear, preseleccionar el Almacén Principal (o el primero) cuando carguen.
  useEffect(() => {
    if (editing || warehouseId || warehouses.length === 0) return
    const principal = warehouses.find((w) => (w.nombre || '').toLowerCase().includes('principal'))
    setWarehouseId(String((principal ?? warehouses[0]).id))
  }, [warehouses, editing, warehouseId])

  const save = async () => {
    // Las reglas del backend, antes de enviar. El campo numérico deja teclear
    // un signo menos, y un precio negativo volvía del servidor como error.
    const n = nombre.trim()
    const problema =
      !n ? 'Escribe el nombre del producto o servicio.'
      : n.length > MAX_NOMBRE ? `El nombre no puede pasar de ${MAX_NOMBRE} caracteres.`
      : Number(precio) < 0 ? 'El precio no puede ser negativo.'
      : Number(costo) < 0 ? 'El costo no puede ser negativo.'
      : !unidadValida(unidadMedida, unidades) ? 'Elige la unidad de medida: la que tenía no está en el catálogo de la DGII.'
      : problemaStock ?? problemaMin
    if (problema) { setError(problema); return }
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
      let id: string
      if (editing && product) {
        await updateProduct({ id: product.id, ...payload })
        id = product.id
      } else {
        const res = await createProduct(payload)
        id = String(res.id)
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
          imagen: null,
        }
      }
      // La foto va después: el producto ya quedó guardado aunque ella falle, y
      // entonces se avisa sin dejar el formulario abierto (un segundo Guardar
      // del alta crearía el producto dos veces).
      let errorAlSubir: string | null = null
      try {
        if (foto.tipo === 'nueva') {
          const r = await subirFotoProducto(id, foto.blob)
          if (creado) creado = { ...creado, imagen: r.imagen_path }
        } else if (foto.tipo === 'ninguna' && product?.imagen) {
          await quitarFotoProducto(id)
        }
      } catch (e) {
        errorAlSubir = e instanceof ApiError ? e.message : 'No se pudo guardar la foto.'
      }
      // Invalida la caché de productos en TODAS las vistas (lista y picker de factura).
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      if (errorAlSubir) {
        toast.error(`El producto "${payload.nombre}" se guardó, pero la foto no: ${errorAlSubir}`)
      } else {
        toast.success(editing ? `Producto "${payload.nombre}" actualizado.` : `Producto "${payload.nombre}" creado.`)
      }
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
          <Btn variant="primary" icon="save" onClick={save} disabled={saving || preparandoFoto}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
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
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto o servicio" autoFocus maxLength={MAX_NOMBRE} />
        </div>
        <div className="field full">
          <label className="label">Foto <span className="opt">(opcional)</span></label>
          <div className="foto-producto">
            <div className="foto-producto-vista">
              {preparandoFoto ? <Icon name="loader" className="spin" size={22} />
                : srcFoto && !fotoRota ? <img src={srcFoto} alt="" onError={() => setFotoRota(true)} />
                : <Icon name={fotoRota ? 'alert-triangle' : 'package'} size={26} />}
            </div>
            <div className="foto-producto-acciones">
              <div className="row gap-sm">
                <Btn size="sm" icon="upload" onClick={() => elegirFotoRef.current?.click()} disabled={preparandoFoto || saving}>
                  {foto.tipo === 'ninguna' ? 'Elegir foto' : 'Cambiar foto'}
                </Btn>
                {foto.tipo !== 'ninguna' && (
                  <Btn size="sm" variant="ghost" icon="trash-2" style={{ color: 'var(--danger)' }} disabled={preparandoFoto || saving}
                    onClick={() => { setErrorFoto(null); setFotoRota(false); setFoto({ tipo: 'ninguna' }) }}>Quitar</Btn>
                )}
              </div>
              <span className="text-sm muted">
                {errorFoto
                  ? <span style={{ color: 'var(--danger)' }}>{errorFoto}</span>
                  : fotoRota ? 'No se pudo cargar la foto guardada. Puedes cambiarla o quitarla.'
                  : foto.tipo === 'nueva' ? 'Se sube al guardar.'
                  : foto.tipo === 'ninguna' && product?.imagen ? 'Se quita al guardar.'
                  : 'JPG, PNG o WebP. Se ve en el POS y en la lista de productos.'}
              </span>
            </div>
            <input ref={elegirFotoRef} type="file" accept={TIPOS_FOTO.join(',')} hidden
              onChange={(e) => { void elegirFoto(e.target.files?.[0]); e.target.value = '' }} />
          </div>
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
            <div className={'field' + (problemaStock ? ' field-error' : '')}>
              <label className="label">Existencia</label>
              <input
                className="input num" type="number" step={fracciona ? 'any' : 1} inputMode={fracciona ? 'decimal' : 'numeric'}
                value={stock} onChange={(e) => setStock(e.target.value)} placeholder="—"
                aria-invalid={problemaStock != null || undefined}
              />
              {problemaStock && <div className="err-msg">{problemaStock}</div>}
            </div>
            <div className={'field' + (problemaMin ? ' field-error' : '')}>
              <label className="label">Stock mínimo</label>
              <input
                className="input num" type="number" min="0" step={fracciona ? 'any' : 1} inputMode={fracciona ? 'decimal' : 'numeric'}
                value={stockMin} onChange={(e) => setStockMin(e.target.value)} placeholder="—"
                aria-invalid={problemaMin != null || undefined}
              />
              {problemaMin && <div className="err-msg">{problemaMin}</div>}
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

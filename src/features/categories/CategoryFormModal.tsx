// FISCALO — Alta/edición/eliminación de una categoría (CRUD contra /api/categories).
// Borrar una categoría deja sus productos sin categoría (category_id → NULL).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Icon } from '@/components/ui'
import { ApiError, createCategory, updateCategory, deleteCategory } from '@/api'
import type { CategoryRow } from '@/api'

interface CategoryFormModalProps {
  /** null => crear; un CategoryRow => editar. */
  category: CategoryRow | null
  onClose: () => void
}

export function CategoryFormModal({ category, onClose }: CategoryFormModalProps) {
  const queryClient = useQueryClient()
  const editing = category !== null
  const [nombre, setNombre] = useState(category?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(category?.descripcion ?? '')
  const [activo, setActivo] = useState(category ? category.estado == null || Boolean(Number(category.estado)) : true)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setError(null)
    setSaving(true)
    const payload = { nombre: nombre.trim(), descripcion: descripcion.trim() || undefined, estado: activo ? 1 : 0 }
    try {
      if (editing && category) await updateCategory({ id: category.id, ...payload })
      else await createCategory(payload)
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(editing ? `Categoría "${payload.nombre}" actualizada.` : `Categoría "${payload.nombre}" creada.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la categoría.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!category) return
    setError(null)
    setDeleting(true)
    try {
      await deleteCategory(category.id)
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Categoría "${category.nombre}" eliminada.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la categoría.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar categoría' : 'Nueva categoría'}
      sub={editing ? category?.nombre ?? undefined : 'Clasifica los productos de tu catálogo'}
      icon="tag"
      width={520}
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

      {editing && (
        <div className="row gap-sm" style={{ color: 'var(--text-2)', marginBottom: 14, fontSize: 12.5 }}>
          <Icon name="alert-circle" size={15} /><span>Al eliminar, los productos de esta categoría quedan sin categoría (no se borran).</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Bebidas" autoFocus />
        </div>
        <div className="field full">
          <label className="label">Descripción <span className="opt">(opcional)</span></label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Para qué sirve esta categoría" />
        </div>
        <div className="field full">
          <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActivo(!activo)}>
            <Switch on={activo} onChange={setActivo} />
            <span className="text-sm">Activa</span>
          </span>
        </div>
      </div>
    </Modal>
  )
}

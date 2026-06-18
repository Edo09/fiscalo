// FISCALO — Alta/edición/eliminación de un almacén (CRUD contra /api/warehouses).
// El backend rechaza (400) borrar el Almacén Principal o uno con productos; ese
// mensaje se muestra en el banner de error.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Icon } from '@/components/ui'
import { ApiError, createWarehouse, updateWarehouse, deleteWarehouse } from '@/api'
import type { WarehouseRow } from '@/api'

interface WarehouseFormModalProps {
  /** null => crear; un WarehouseRow => editar. */
  warehouse: WarehouseRow | null
  onClose: () => void
}

export function WarehouseFormModal({ warehouse, onClose }: WarehouseFormModalProps) {
  const queryClient = useQueryClient()
  const editing = warehouse !== null
  const [nombre, setNombre] = useState(warehouse?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(warehouse?.descripcion ?? '')
  const [activo, setActivo] = useState(warehouse ? warehouse.estado == null || Boolean(Number(warehouse.estado)) : true)

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
      if (editing && warehouse) await updateWarehouse({ id: warehouse.id, ...payload })
      else await createWarehouse(payload)
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(editing ? `Almacén "${payload.nombre}" actualizado.` : `Almacén "${payload.nombre}" creado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el almacén.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!warehouse) return
    setError(null)
    setDeleting(true)
    try {
      await deleteWarehouse(warehouse.id)
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Almacén "${warehouse.nombre}" eliminado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el almacén.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar almacén' : 'Nuevo almacén'}
      sub={editing ? warehouse?.nombre ?? undefined : 'Define dónde se guardan tus productos'}
      icon="archive"
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

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Almacén Principal" autoFocus />
        </div>
        <div className="field full">
          <label className="label">Descripción <span className="opt">(opcional)</span></label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ubicación o detalle del almacén" />
        </div>
        <div className="field full">
          <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActivo(!activo)}>
            <Switch on={activo} onChange={setActivo} />
            <span className="text-sm">Activo</span>
          </span>
        </div>
      </div>
    </Modal>
  )
}

// FISCALO — Alta/edición/eliminación de un proveedor (CRUD contra /api/proveedores).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Icon } from '@/components/ui'
import { ApiError, createProveedor, updateProveedor, deleteProveedor } from '@/api'
import type { Proveedor } from '@/types/domain'

interface ProveedorFormModalProps {
  /** null => crear; un Proveedor => editar. */
  proveedor: Proveedor | null
  onClose: () => void
}

export function ProveedorFormModal({ proveedor, onClose }: ProveedorFormModalProps) {
  const queryClient = useQueryClient()
  const editing = proveedor !== null
  const [nombre, setNombre] = useState(proveedor && proveedor.nombre !== '—' ? proveedor.nombre : '')
  const [rnc, setRnc] = useState(proveedor?.rnc ?? '')
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [telefono, setTelefono] = useState(proveedor?.tel ?? '')
  const [correo, setCorreo] = useState(proveedor?.correo ?? '')
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '')
  const [activo, setActivo] = useState(proveedor?.activo ?? true)

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
      rnc: rnc.trim() || undefined,
      contacto: contacto.trim() || undefined,
      telefono: telefono.trim() || undefined,
      correo: correo.trim() || undefined,
      direccion: direccion.trim() || undefined,
      activo,
    }
    try {
      if (editing && proveedor) await updateProveedor({ id: proveedor.id, ...payload })
      else await createProveedor(payload)
      void queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success(editing ? `Proveedor "${payload.nombre}" actualizado.` : `Proveedor "${payload.nombre}" creado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el proveedor.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!proveedor) return
    setError(null)
    setDeleting(true)
    try {
      await deleteProveedor(proveedor.id)
      void queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success(`Proveedor "${proveedor.nombre}" eliminado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el proveedor.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar proveedor' : 'Nuevo proveedor'}
      sub={editing ? proveedor?.nombre : 'Agrega un proveedor al directorio'}
      icon="truck"
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
          <label className="label">Nombre / Razón social <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Suplidora XYZ SRL" autoFocus />
        </div>
        <div className="field">
          <label className="label">RNC / Cédula <span className="opt">(opcional)</span></label>
          <input className="input mono" value={rnc} onChange={(e) => setRnc(e.target.value)} placeholder="131880681" />
        </div>
        <div className="field">
          <label className="label">Contacto <span className="opt">(opcional)</span></label>
          <input className="input" value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Nombre de la persona" />
        </div>
        <div className="field">
          <label className="label">Teléfono <span className="opt">(opcional)</span></label>
          <input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="(809) 555-0000" />
        </div>
        <div className="field">
          <label className="label">Correo <span className="opt">(opcional)</span></label>
          <input className="input" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="compras@proveedor.do" />
        </div>
        <div className="field full">
          <label className="label">Dirección <span className="opt">(opcional)</span></label>
          <input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, sector, ciudad" />
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

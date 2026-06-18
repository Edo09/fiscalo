// FISCALO — Alta/edición/eliminación de un rol y sus permisos (módulos).
// CRUD contra /api/roles. Ver docs/roles-permisos.md.
//   - Permiso = nombre de módulo (o `*` = todos).
//   - Roles de sistema (admin/user) son de solo lectura: ni edición ni borrado.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Icon, Checkbox } from '@/components/ui'
import { ApiError, createRole, updateRole, deleteRole } from '@/api'
import type { RoleRow } from '@/api'
import { MODULE_CATALOG, PERMISSION_ALL, type ModuleDef } from '@/config/permissions'

interface RoleFormModalProps {
  /** null => crear; un RoleRow => editar. */
  role: RoleRow | null
  onClose: () => void
}

export function RoleFormModal({ role, onClose }: RoleFormModalProps) {
  const queryClient = useQueryClient()
  const editing = role !== null
  const isSystem = !!(role && Number(role.is_system))
  // Roles de sistema: solo lectura (el backend rechaza PUT/DELETE igual).
  const readOnly = isSystem

  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const initialPerms = role?.permissions ?? []
  const [allModules, setAllModules] = useState(initialPerms.includes(PERMISSION_ALL))
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialPerms.filter((p) => p !== PERMISSION_ALL)),
  )

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canEditModules = !readOnly && !allModules

  const toggle = (id: string) => {
    if (!canEditModules) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (readOnly) return
    const cleanName = name.trim()
    if (!editing && !cleanName) { setError('El nombre del rol es obligatorio.'); return }
    const permissions = allModules ? [PERMISSION_ALL] : Array.from(selected)
    if (permissions.length === 0) { setError('Selecciona al menos un módulo.'); return }
    setError(null)
    setSaving(true)
    try {
      if (editing && role) {
        await updateRole(role.id, { description: description.trim(), permissions })
      } else {
        await createRole({ name: cleanName, description: description.trim() || undefined, permissions })
      }
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(editing ? `Rol "${role!.name}" actualizado.` : `Rol "${cleanName}" creado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el rol.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!role) return
    setError(null)
    setDeleting(true)
    try {
      await deleteRole(role.id)
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success(`Rol "${role.name}" eliminado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el rol.')
      setDeleting(false)
    }
  }

  const renderModule = (m: ModuleDef) => {
    const checked = allModules || selected.has(m.id)
    return (
      <div
        key={m.id}
        className="row gap-sm"
        onClick={() => toggle(m.id)}
        style={{ alignItems: 'center', padding: '7px 2px', cursor: canEditModules ? 'pointer' : 'default', opacity: allModules ? 0.55 : 1 }}
      >
        <Checkbox on={checked} onChange={() => toggle(m.id)} />
        <span className="text-sm">{m.label}</span>
        <span className="mono text-sm muted-3" style={{ marginLeft: 'auto' }}>{m.id}</span>
      </div>
    )
  }

  const operativos = MODULE_CATALOG.filter((m) => !m.admin)
  const admin = MODULE_CATALOG.filter((m) => m.admin)

  return (
    <Modal
      title={editing ? (readOnly ? 'Rol del sistema' : 'Editar rol') : 'Nuevo rol'}
      sub={editing ? role?.name : 'Define qué módulos puede usar el rol'}
      icon="shield"
      width={560}
      onClose={onClose}
      footer={
        readOnly ? (
          <Btn variant="primary" onClick={onClose}>Cerrar</Btn>
        ) : (
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
        )
      }
    >
      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      {readOnly && (
        <div className="row gap-sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="shield-check" size={16} /><span>Rol de sistema: no se puede editar ni eliminar.</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre del rol {!editing && <span className="req">*</span>}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Contador, Vendedor…" disabled={editing} autoFocus={!editing} />
          {editing && <span className="text-sm muted-3" style={{ marginTop: 4 }}>El nombre no se puede cambiar.</span>}
        </div>
        <div className="field full">
          <label className="label">Descripción <span className="opt">(opcional)</span></label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Para qué sirve este rol" disabled={readOnly} />
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <label className="label">Módulos con acceso</label>

        <div
          className="row gap-sm"
          onClick={() => !readOnly && setAllModules(!allModules)}
          style={{ alignItems: 'center', padding: '9px 2px', cursor: readOnly ? 'default' : 'pointer', borderBottom: '1px solid var(--border)' }}
        >
          <Checkbox on={allModules} onChange={() => !readOnly && setAllModules(!allModules)} />
          <span className="fw6 text-sm">Acceso a todos los módulos</span>
          <span className="mono text-sm muted-3" style={{ marginLeft: 'auto' }}>*</span>
        </div>

        <div className="muted-3 text-sm" style={{ margin: '12px 0 2px', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Operativos</div>
        {operativos.map(renderModule)}

        <div className="muted-3 text-sm" style={{ margin: '12px 0 2px', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Administración</div>
        {admin.map(renderModule)}
      </div>
    </Modal>
  )
}

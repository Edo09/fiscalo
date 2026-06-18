// FISCALO — Alta/edición/eliminación de un usuario del tenant (CRUD /api/users).
// Ver docs/roles-permisos.md. El rol se valida contra los roles del tenant.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Icon } from '@/components/ui'
import { ApiError, createUser, updateUser, deleteUser } from '@/api'
import type { RoleRow, UserRow } from '@/api'
import { useSession } from '@/stores/auth'

interface UserFormModalProps {
  /** null => crear; un UserRow => editar. */
  user: UserRow | null
  roles: RoleRow[]
  onClose: () => void
}

export function UserFormModal({ user, roles, onClose }: UserFormModalProps) {
  const queryClient = useQueryClient()
  const { user: me } = useSession()
  const editing = user !== null
  const isSelf = !!(user && me && user.id === me.id)

  const [name, setName] = useState(user?.name ?? '')
  const [lastName, setLastName] = useState(user?.last_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [role, setRole] = useState(user?.role || roles[0]?.name || 'user')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const cleanName = name.trim()
    const cleanEmail = email.trim()
    const cleanUser = username.trim()
    if (!cleanName) { setError('El nombre es obligatorio.'); return }
    if (!cleanEmail) { setError('El correo es obligatorio.'); return }
    if (!editing && !cleanUser) { setError('El nombre de usuario es obligatorio.'); return }
    if (!editing && password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    setError(null)
    setSaving(true)
    try {
      if (editing && user) {
        await updateUser(user.id, {
          name: cleanName,
          last_name: lastName.trim(),
          email: cleanEmail,
          username: cleanUser,
          role,
          ...(password ? { password } : {}),
        })
      } else {
        await createUser({
          name: cleanName,
          last_name: lastName.trim() || undefined,
          email: cleanEmail,
          username: cleanUser,
          password,
          role,
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success(editing ? `Usuario "${cleanName}" actualizado.` : `Usuario "${cleanName}" creado.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el usuario.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!user) return
    setError(null)
    setDeleting(true)
    try {
      await deleteUser(user.id)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario eliminado.')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el usuario.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar usuario' : 'Nuevo usuario'}
      sub={editing ? (user?.email ?? undefined) : 'Crea una cuenta para tu equipo'}
      icon={editing ? 'user-check' : 'user-plus'}
      width={560}
      onClose={onClose}
      footer={
        <>
          {editing && !isSelf && (confirmDel ? (
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
        <div className="field">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="María" autoFocus />
        </div>
        <div className="field">
          <label className="label">Apellido <span className="opt">(opcional)</span></label>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Pérez" />
        </div>
        <div className="field full">
          <label className="label">Correo <span className="req">*</span></label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@empresa.do" />
        </div>
        <div className="field">
          <label className="label">Usuario <span className="req">*</span></label>
          <input className="input mono" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mperez" />
        </div>
        <div className="field">
          <label className="label">Rol</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.length === 0 && <option value={role}>{role}</option>}
            {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
        </div>
        <div className="field full">
          <label className="label">
            Contraseña {editing ? <span className="opt">(dejar en blanco para no cambiar)</span> : <span className="req">*</span>}
          </label>
          <div className="login-pass-wrap">
            <input className="input" type={showPass ? 'text' : 'password'} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '••••••••' : 'Mínimo 6 caracteres'} autoComplete="new-password" />
            <button type="button" className="login-pass-toggle" onClick={() => setShowPass((s) => !s)} tabIndex={-1}>
              <Icon name={showPass ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
        </div>
      </div>

      {editing && isSelf && (
        <div className="text-sm muted-3" style={{ marginTop: 4 }}>Es tu propia cuenta: no puedes eliminarla desde aquí.</div>
      )}
    </Modal>
  )
}

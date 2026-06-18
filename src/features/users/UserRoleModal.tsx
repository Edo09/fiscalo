// FISCALO — Cambio rápido de rol de un usuario (PUT /api/roles/assign).
// El backend lee el rol vivo en cada request, así que el cambio aplica sin
// re-login del usuario afectado. Ver docs/roles-permisos.md.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Icon, Avatar } from '@/components/ui'
import { ApiError, assignUserRole } from '@/api'
import type { RoleRow, UserRow } from '@/api'
import { moduleLabel } from '@/config/permissions'
import { displayName } from './helpers'

interface UserRoleModalProps {
  user: UserRow
  roles: RoleRow[]
  onClose: () => void
}

export function UserRoleModal({ user, roles, onClose }: UserRoleModalProps) {
  const queryClient = useQueryClient()
  const name = displayName(user)
  const current = user.role ?? ''
  const [role, setRole] = useState(current || roles[0]?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = roles.find((r) => r.name === role)

  const save = async () => {
    if (!role) { setError('Selecciona un rol.'); return }
    setError(null)
    setSaving(true)
    try {
      await assignUserRole({ user_id: user.id, role })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success(`Rol de ${name} actualizado a "${role}".`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo asignar el rol.')
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Cambiar rol"
      sub={name}
      icon="shield"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="save" onClick={save} disabled={saving || role === current}>
            {saving ? 'Guardando…' : 'Asignar rol'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      <div className="row gap-sm" style={{ alignItems: 'center', marginBottom: 16 }}>
        <Avatar name={name} size={36} />
        <div>
          <div className="fw6">{name}</div>
          <div className="text-sm muted">{user.email || '—'}</div>
        </div>
      </div>

      <div className="field full">
        <label className="label">Rol</label>
        {roles.length === 0 ? (
          <div className="text-sm muted">No hay roles disponibles. Crea uno primero.</div>
        ) : (
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.name}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>
            ))}
          </select>
        )}
      </div>

      {selected && (
        <div style={{ marginTop: 14 }}>
          <div className="text-xs muted-3" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Módulos del rol</div>
          <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
            {selected.permissions.length === 0 ? (
              <span className="text-sm muted">Sin módulos.</span>
            ) : (
              selected.permissions.map((p) => (
                <span key={p} className={'perm-chip' + (p === '*' ? ' all' : '')}>{moduleLabel(p)}</span>
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

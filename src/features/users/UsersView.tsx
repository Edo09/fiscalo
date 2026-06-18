import { useMemo, useState, type ReactNode, type MouseEvent } from 'react'
import { Btn, RefreshButton, Badge, Avatar, Icon, Card, Tabs, Dropdown, MenuItem, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listUsers, listRoles } from '@/api'
import type { RoleRow, UserRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { moduleLabel } from '@/config/permissions'
import { RoleFormModal } from './RoleFormModal'
import { UserRoleModal } from './UserRoleModal'
import { UserFormModal } from './UserFormModal'
import { displayName, roleOf, isAdminRole } from './helpers'

/* FISCALO — Usuarios y roles (GET/POST/PUT/DELETE /api/users · /api/roles).
   Ver docs/roles-permisos.md. */
export function UsersView() {
  const [tab, setTab] = useState<'usuarios' | 'roles'>('usuarios')
  const [search, setSearch] = useState('')
  // Modales: cada uno null cuando está cerrado.
  const [userForm, setUserForm] = useState<{ user: UserRow | null } | null>(null)
  const [roleAssign, setRoleAssign] = useState<UserRow | null>(null)
  const [roleForm, setRoleForm] = useState<{ role: RoleRow | null } | null>(null)

  const usersQ = useApiQuery(['users', 'list'], () => listUsers({ pageSize: 100 }))
  const rolesQ = useApiQuery(['roles', 'list'], listRoles)

  const users = useMemo(() => usersQ.data?.items ?? [], [usersQ.data])
  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data])
  const reload = () => Promise.all([usersQ.reload(), rolesQ.reload()])

  // Conteo de usuarios por nombre de rol.
  const userCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const u of users) { const r = u.role || '—'; m[r] = (m[r] ?? 0) + 1 }
    return m
  }, [users])

  const adminCount = useMemo(
    () => users.filter((u) => u.role === 'admin' || isAdminRole(roleOf(u, roles))).length,
    [users, roles],
  )
  const customRoles = roles.filter((r) => !Number(r.is_system)).length

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      `${displayName(u)} ${u.email ?? ''} ${u.username ?? ''} ${u.role ?? ''}`.toLowerCase().includes(q),
    )
  }, [users, search])

  return (
    <div className="page page-wide">
      <PageHead title="Usuarios y roles" sub="Gestiona tu equipo y qué puede ver cada quien"
        actions={
          <>
            <RefreshButton onRefresh={reload} />
            {tab === 'roles'
              ? <Btn variant="primary" icon="plus" onClick={() => setRoleForm({ role: null })}>Nuevo rol</Btn>
              : <Btn variant="primary" icon="user-plus" onClick={() => setUserForm({ user: null })}>Nuevo usuario</Btn>}
          </>
        } />

      <div className="kpi-grid compact" style={{ marginBottom: 20 }}>
        <Stat icon="users" tone="accent" label="Usuarios" value={users.length} />
        <Stat icon="shield-check" tone="success" label="Administradores" value={adminCount} />
        <Stat icon="shield" tone="info" label="Roles" value={roles.length} />
        <Stat icon="key" tone="warning" label="Roles personalizados" value={customRoles} />
      </div>

      <Tabs
        tabs={[{ id: 'usuarios', label: 'Usuarios', count: users.length }, { id: 'roles', label: 'Roles', count: roles.length }]}
        active={tab}
        onChange={(id) => setTab(id as 'usuarios' | 'roles')}
      />

      {tab === 'usuarios'
        ? <UsersTab q={usersQ} users={filtered} roles={roles} search={search} setSearch={setSearch}
            onNew={() => setUserForm({ user: null })} onEdit={(u) => setUserForm({ user: u })} onAssign={(u) => setRoleAssign(u)} />
        : <RolesTab q={rolesQ} roles={roles} userCount={userCount} onNew={() => setRoleForm({ role: null })} onOpen={(r) => setRoleForm({ role: r })} />}

      {userForm && <UserFormModal user={userForm.user} roles={roles} onClose={() => setUserForm(null)} />}
      {roleAssign && <UserRoleModal user={roleAssign} roles={roles} onClose={() => setRoleAssign(null)} />}
      {roleForm && <RoleFormModal role={roleForm.role} onClose={() => setRoleForm(null)} />}
    </div>
  )
}

// --- KPI compacto -----------------------------------------------------------
const TONE_BG: Record<string, string> = {
  accent: 'var(--accent-soft)', success: 'var(--success-soft)', info: 'var(--info-soft)', warning: 'var(--warning-soft)',
}
const TONE_FG: Record<string, string> = {
  accent: 'var(--accent)', success: 'var(--success)', info: 'var(--info)', warning: 'var(--warning)',
}
function Stat({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-ic" style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}><Icon name={icon} /></span>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  )
}

// --- Pestaña Usuarios -------------------------------------------------------
function UsersTab({ q, users, roles, search, setSearch, onNew, onEdit, onAssign }: {
  q: { loading: boolean; error: string | null; reload: () => unknown }
  users: UserRow[]
  roles: RoleRow[]
  search: string
  setSearch: (v: string) => void
  onNew: () => void
  onEdit: (u: UserRow) => void
  onAssign: (u: UserRow) => void
}) {
  if (q.loading) return <Card noPad><LoadingState rows={6} /></Card>
  if (q.error) return <ErrorState title="No se pudieron cargar los usuarios" onRetry={q.reload}>{q.error}</ErrorState>

  return (
    <>
      <div className="toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input placeholder="Buscar por nombre, correo, usuario o rol…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {search && <button className="filter-chip" onClick={() => setSearch('')}><Icon name="x" />Limpiar</button>}
      </div>

      <Card noPad>
        {users.length === 0 ? (
          <EmptyState icon="users" title={search ? 'Sin resultados' : 'No hay usuarios'}
            action={!search && <Btn variant="primary" icon="user-plus" onClick={onNew}>Nuevo usuario</Btn>}>
            {search ? `Nada coincide con "${search}".` : 'Crea la primera cuenta para tu equipo.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Acceso</th><th style={{ width: 44 }}></th></tr></thead>
              <tbody>
                {users.map((u) => {
                  const role = roleOf(u, roles)
                  const all = isAdminRole(role)
                  const mods = role?.permissions.length ?? 0
                  return (
                    <tr key={u.id} onClick={() => onEdit(u)}>
                      <td>
                        <div className="user-cell">
                          <Avatar name={displayName(u)} size={34} />
                          <div>
                            <div className="u-name">{displayName(u)}</div>
                            {u.username && <div className="u-sub">@{u.username}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="muted text-sm">{u.email || '—'}</td>
                      <td><Badge tone={all ? 'accent' : 'neutral'}>{u.role || '—'}</Badge></td>
                      <td className="text-sm muted">
                        {all ? <span className="perm-chip all">Acceso total</span> : role ? `${mods} módulo${mods !== 1 ? 's' : ''}` : '—'}
                      </td>
                      <RowMenu onClick={(e) => e.stopPropagation()}>
                        <Dropdown trigger={<Btn variant="ghost" size="sm" icon="more-horizontal" />}>
                          <MenuItem icon="user-check" onClick={() => onEdit(u)}>Editar usuario</MenuItem>
                          <MenuItem icon="shield" onClick={() => onAssign(u)}>Cambiar rol</MenuItem>
                        </Dropdown>
                      </RowMenu>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

/** Celda de acciones que no propaga el click al `<tr>` (evita abrir el editor). */
function RowMenu({ children, onClick }: { children: ReactNode; onClick: (e: MouseEvent) => void }) {
  return <td onClick={onClick} style={{ textAlign: 'right' }}>{children}</td>
}

// --- Pestaña Roles ----------------------------------------------------------
function RolesTab({ q, roles, userCount, onNew, onOpen }: {
  q: { loading: boolean; error: string | null; reload: () => unknown }
  roles: RoleRow[]
  userCount: Record<string, number>
  onNew: () => void
  onOpen: (r: RoleRow) => void
}) {
  if (q.loading) return <Card noPad><LoadingState rows={4} /></Card>
  if (q.error) return <ErrorState title="No se pudieron cargar los roles" onRetry={q.reload}>{q.error}</ErrorState>

  return (
    <div className="roles-grid">
      {roles.map((r) => {
        const count = userCount[r.name] ?? 0
        const isSystem = !!Number(r.is_system)
        const all = r.permissions.includes('*')
        const shown = r.permissions.slice(0, 4)
        const extra = r.permissions.length - shown.length
        return (
          <div className="role-card" key={r.id} onClick={() => onOpen(r)}>
            <div className="role-card-top">
              <div className={'role-ic' + (all ? ' is-admin' : '')}><Icon name={all ? 'shield-check' : 'shield'} size={20} /></div>
              <Icon name={isSystem ? 'eye' : 'edit-3'} size={15} className="edit-hint" />
            </div>
            <div>
              <div className="role-name-row">
                <span className="role-name">{r.name}</span>
                {isSystem && <Badge tone="info">Sistema</Badge>}
              </div>
              <div className="role-desc">{r.description || (all ? 'Acceso total a la plataforma.' : 'Rol personalizado.')}</div>
            </div>
            <div className="role-perms">
              {all ? (
                <span className="perm-chip all">Acceso total</span>
              ) : r.permissions.length === 0 ? (
                <span className="perm-chip">Sin módulos</span>
              ) : (
                <>
                  {shown.map((p) => <span key={p} className="perm-chip">{moduleLabel(p)}</span>)}
                  {extra > 0 && <span className="perm-chip more">+{extra}</span>}
                </>
              )}
            </div>
            <div className="role-foot">
              <span className="it"><Icon name="users" />{count} usuario{count !== 1 ? 's' : ''}</span>
              <span className="it"><Icon name="layers" />{all ? 'Todos' : `${r.permissions.length} módulo${r.permissions.length !== 1 ? 's' : ''}`}</span>
            </div>
          </div>
        )
      })}

      <div className="role-card add" onClick={onNew}>
        <div className="role-ic"><Icon name="plus" size={20} /></div>
        <span className="fw6">Nuevo rol</span>
        <span className="text-xs muted-3">Define un conjunto de módulos</span>
      </div>
    </div>
  )
}

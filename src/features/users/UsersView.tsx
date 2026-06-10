import { useState } from 'react'
import { Btn, Badge, EstadoBadge, Avatar, Card, Tabs, EmptyState, LoadingState, ErrorState, PageHead } from '@/components/ui'
import { listUsers, mapUserRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

/* FISCALO — Usuarios y roles (GET /api/users) */
export function UsersView() {
  const [tab, setTab] = useState('usuarios')
  const { data, error, loading, reload } = useApiQuery(['users', 'list'], () => listUsers({ pageSize: 100 }))
  const usuarios = (data?.items ?? []).map(mapUserRow)

  // Roles derivados de los usuarios (la API no expone un endpoint de roles).
  const roles = Object.entries(
    usuarios.reduce<Record<string, number>>((acc, u) => {
      const r = u.rol || '—'
      acc[r] = (acc[r] ?? 0) + 1
      return acc
    }, {}),
  ).map(([nombre, count]) => ({ nombre, count }))

  return (
    <div className="page page-wide">
      <PageHead title="Usuarios y roles" sub="Gestiona el acceso de tu equipo"
        actions={<><Btn variant="secondary" icon="refresh-cw" onClick={reload}>Actualizar</Btn><Btn variant="primary" icon="user-plus">Invitar usuario</Btn></>} />
      <Tabs
        tabs={[{ id: 'usuarios', label: 'Usuarios', count: usuarios.length }, { id: 'roles', label: 'Roles', count: roles.length }]}
        active={tab}
        onChange={setTab}
      />

      {loading ? (
        <Card noPad><LoadingState rows={6} /></Card>
      ) : error ? (
        <ErrorState title="No se pudieron cargar los usuarios" onRetry={reload}>{error}</ErrorState>
      ) : tab === 'usuarios' ? (
        <Card noPad>
          {usuarios.length === 0 ? (
            <EmptyState icon="users" title="No hay usuarios">Aún no hay usuarios registrados.</EmptyState>
          ) : (
            <table className="tbl">
              <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} style={{ cursor: 'default' }}>
                    <td><div className="row gap-sm"><Avatar name={u.nombre} color={u.color} size={32} /><span className="cell-main">{u.nombre}</span></div></td>
                    <td className="muted text-sm">{u.email || '—'}</td>
                    <td><Badge tone="accent">{u.rol}</Badge></td>
                    <td><EstadoBadge estado={u.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <div className="kpi-grid">
          {roles.length === 0 ? (
            <Card><EmptyState icon="shield" title="Sin roles">No hay roles asignados.</EmptyState></Card>
          ) : (
            roles.map((r) => (
              <div className="card card-pad" key={r.nombre}>
                <div className="row between mb-sm">
                  <span className="kpi-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 34, height: 34 }}><Avatar name={r.nombre} size={24} /></span>
                  <Badge tone="neutral">{r.count} usuario{r.count !== 1 ? 's' : ''}</Badge>
                </div>
                <div className="fw6" style={{ fontSize: 15 }}>{r.nombre}</div>
                <div className="text-sm muted" style={{ marginTop: 2 }}>Rol del sistema</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

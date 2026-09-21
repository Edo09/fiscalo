// FISCALO — Bitácora: todo lo que quedó registrado en audit_logs de la empresa.
// Solo para el rol admin (lo exige el backend; el menú solo lo esconde).
import { useEffect, useMemo, useState } from 'react'
import {
  Badge, Card, EmptyState, ErrorState, Icon, KPI, LoadingState, PageHead, Pagination, RefreshButton,
} from '@/components/ui'
import { getAuditFacetas, getAuditResumen, listAuditLogs } from '@/api'
import type { AuditLogFiltros, AuditLogRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { etiquetaAccion, etiquetaModulo, fechaHora, quien, tonoAccion } from './etiquetas'
import { AuditDetailDrawer } from './AuditDetailDrawer'

const PAGE_SIZES = [25, 50, 100]

type Periodo = 'hoy' | '7d' | '30d' | 'mes' | 'todo' | 'rango'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'todo', label: 'Todo' },
  { id: 'rango', label: 'Rango' },
]

/** Filtros que eligen QUÉ registros ver; los atajos los combinan. */
interface Seleccion {
  modulo?: string
  accion?: string
  resultado?: 'exito' | 'fallo'
}

const ATAJOS: { id: string; label: string; sel: Seleccion }[] = [
  { id: 'todo', label: 'Todos los registros', sel: {} },
  { id: 'fallidos', label: 'Fallidos', sel: { resultado: 'fallo' } },
  { id: 'denegados', label: 'Accesos denegados', sel: { accion: 'ACCESS_DENIED' } },
  { id: 'sesiones', label: 'Sesiones', sel: { modulo: 'auth' } },
  { id: 'emisiones', label: 'Emisiones e-CF', sel: { accion: 'EMIT' } },
  { id: 'eliminaciones', label: 'Eliminaciones', sel: { accion: 'DELETE' } },
]

const mismaSeleccion = (a: Seleccion, b: Seleccion) =>
  (a.modulo ?? '') === (b.modulo ?? '') && (a.accion ?? '') === (b.accion ?? '') && (a.resultado ?? '') === (b.resultado ?? '')

/** Fecha local 'YYYY-MM-DD' (no toISOString: esa es UTC y de noche daría mañana). */
function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function rangoDe(periodo: Periodo, desde: string, hasta: string): { desde?: string; hasta?: string } {
  const hoy = new Date()
  const haceDias = (n: number) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return isoLocal(d) }
  switch (periodo) {
    case 'hoy': return { desde: isoLocal(hoy), hasta: isoLocal(hoy) }
    case '7d': return { desde: haceDias(6), hasta: isoLocal(hoy) }
    case '30d': return { desde: haceDias(29), hasta: isoLocal(hoy) }
    case 'mes': return { desde: isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: isoLocal(hoy) }
    case 'todo': return {}
    case 'rango': return { desde: desde || undefined, hasta: hasta || undefined }
  }
}

export function AuditLogView({ nav }: { nav: Nav }) {
  const [periodo, setPeriodo] = useState<Periodo>('7d')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [userId, setUserId] = useState<number | undefined>(undefined)
  const [sel, setSel] = useState<Seleccion>({})
  const [textoInput, setTextoInput] = useState('')
  const [texto, setTexto] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [detalle, setDetalle] = useState<AuditLogRow | null>(null)

  // Búsqueda libre con debounce: se consulta al dejar de teclear, no por tecla.
  useEffect(() => {
    const t = setTimeout(() => { setTexto(textoInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [textoInput])

  const filtros: AuditLogFiltros = useMemo(() => ({
    ...rangoDe(periodo, desde, hasta),
    userId,
    modulo: sel.modulo,
    accion: sel.accion,
    resultado: sel.resultado,
    texto: texto || undefined,
  }), [periodo, desde, hasta, userId, sel, texto])

  // Cualquier cambio de filtro vuelve a la página 1.
  const cambiar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

  const facetas = useApiQuery(['auditoria', 'facetas'], getAuditFacetas)
  const resumen = useApiQuery(['auditoria', 'resumen', filtros], () => getAuditResumen(filtros), { keepPrevious: true })
  const lista = useApiQuery(
    ['auditoria', 'lista', filtros, page, pageSize],
    () => listAuditLogs({ ...filtros, page, pageSize }),
    { keepPrevious: true },
  )

  const rows = lista.data?.items ?? []
  const r = resumen.data
  const buscando = lista.fetching && !lista.loading
  const hayFiltros = userId !== undefined || !mismaSeleccion(sel, {}) || texto !== ''

  const limpiar = () => { setUserId(undefined); setSel({}); setTextoInput(''); setTexto(''); setPage(1) }
  const recargar = () => Promise.all([lista.reload(), resumen.reload(), facetas.reload()])

  // Opciones = lo que existe en la bitácora, más lo elegido aunque no esté: un
  // atajo puede pedir una acción que todavía no ocurrió ("Emisiones e-CF" sin
  // emisiones), y el desplegable diría "Todas" con el filtro puesto.
  const conElegido = (lista: string[], elegido?: string) =>
    elegido && !lista.includes(elegido) ? [...lista, elegido] : lista
  const modulos = conElegido(facetas.data?.modulos ?? [], sel.modulo)
  const acciones = conElegido(facetas.data?.acciones ?? [], sel.accion)
  const usuarios = facetas.data?.usuarios ?? []

  return (
    <div className="page page-wide">
      <PageHead
        title="Bitácora"
        sub="Todo lo que se hizo en el sistema: quién, qué, cuándo y desde dónde"
        actions={<RefreshButton onRefresh={recargar} />}
      />

      {/* ---- Resumen del período y filtros elegidos ---- */}
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <KPI label="Eventos" value={r?.total ?? 0} icon="history"
          foot={r ? `${r.usuarios} ${r.usuarios === 1 ? 'usuario' : 'usuarios'}` : undefined} />
        <KPI label="Fallidos" value={r?.fallidos ?? 0} icon="x-circle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
        <KPI label="Accesos denegados" value={r?.accesos_denegados ?? 0} icon="ban" iconBg="var(--warning-soft)" iconColor="var(--warning)" />
        <KPI label="Inicios de sesión fallidos" value={r?.logins_fallidos ?? 0} icon="key" iconBg="var(--warning-soft)" iconColor="var(--warning)" />
      </div>

      {r && (r.top_usuarios.length > 0 || r.por_modulo.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Card title="Usuarios más activos" sub="Clic para ver solo sus registros">
            <div className="col" style={{ gap: 2 }}>
              {r.top_usuarios.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  className={'filter-chip' + (userId === u.user_id ? ' active' : '')}
                  style={{ justifyContent: 'space-between', width: '100%' }}
                  aria-label={`${u.username ?? u.email ?? `Usuario ${u.user_id}`}: ${u.total} registros`}
                  aria-pressed={userId === u.user_id}
                  onClick={() => cambiar(setUserId)(userId === u.user_id ? undefined : u.user_id)}
                >
                  <span>{u.username ?? u.email ?? `Usuario ${u.user_id}`}</span>
                  <span className="num fw6">{u.total}</span>
                </button>
              ))}
              {r.top_usuarios.length === 0 && <span className="text-sm muted">Sin actividad de usuarios en el período.</span>}
            </div>
          </Card>
          <Card title="Por módulo" sub="Clic para filtrar">
            <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
              {r.por_modulo.slice(0, 12).map((m) => (
                <button
                  key={m.module}
                  type="button"
                  className={'filter-chip' + (sel.modulo === m.module && !sel.accion ? ' active' : '')}
                  onClick={() => cambiar(setSel)(sel.modulo === m.module && !sel.accion ? {} : { modulo: m.module })}
                >
                  {etiquetaModulo(m.module)} <span className="num fw6" style={{ marginLeft: 4 }}>{m.total}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ---- Qué registros ver ---- */}
      <div className="row gap-sm" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        {ATAJOS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={'filter-chip' + (mismaSeleccion(sel, a.sel) ? ' active' : '')}
            onClick={() => cambiar(setSel)(a.sel)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-input">
          <Icon name={buscando ? 'loader' : 'search'} className={buscando ? 'spin' : undefined} />
          <input
            placeholder="Buscar por usuario, documento, descripción o IP…"
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            aria-label="Buscar en la bitácora"
          />
        </div>
        <div className="seg" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" className={periodo === p.id ? 'on' : ''} onClick={() => cambiar(setPeriodo)(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {periodo === 'rango' && (
          <>
            <input className="input" type="date" style={{ maxWidth: 155 }} value={desde} max={hasta || undefined}
              onChange={(e) => cambiar(setDesde)(e.target.value)} aria-label="Desde" />
            <input className="input" type="date" style={{ maxWidth: 155 }} value={hasta} min={desde || undefined}
              onChange={(e) => cambiar(setHasta)(e.target.value)} aria-label="Hasta" />
          </>
        )}
      </div>

      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Usuario"
          value={userId ?? ''} onChange={(e) => cambiar(setUserId)(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">Todos los usuarios</option>
          {usuarios.map((u) => (
            <option key={u.user_id} value={u.user_id}>{u.username ?? u.email ?? `Usuario ${u.user_id}`}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} aria-label="Módulo"
          value={sel.modulo ?? ''} onChange={(e) => cambiar(setSel)({ ...sel, modulo: e.target.value || undefined })}>
          <option value="">Todos los módulos</option>
          {modulos.map((m) => <option key={m} value={m}>{etiquetaModulo(m)}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} aria-label="Acción"
          value={sel.accion ?? ''} onChange={(e) => cambiar(setSel)({ ...sel, accion: e.target.value || undefined })}>
          <option value="">Todas las acciones</option>
          {acciones.map((a) => <option key={a} value={a}>{etiquetaAccion(a)}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} aria-label="Resultado"
          value={sel.resultado ?? ''}
          onChange={(e) => cambiar(setSel)({ ...sel, resultado: (e.target.value || undefined) as Seleccion['resultado'] })}>
          <option value="">Exitosos y fallidos</option>
          <option value="exito">Solo exitosos</option>
          <option value="fallo">Solo fallidos</option>
        </select>
        {hayFiltros && (
          <button type="button" className="filter-chip" onClick={limpiar}><Icon name="x" />Limpiar filtros</button>
        )}
      </div>

      {!lista.loading && !lista.error && rows.length > 0 && (
        <Pagination
          compact
          page={page}
          totalPages={lista.data?.totalPages ?? null}
          total={lista.data?.total ?? null}
          pageSize={pageSize}
          count={rows.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1) }}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      <Card noPad>
        {lista.loading ? (
          <LoadingState rows={8} />
        ) : lista.error ? (
          <ErrorState title="No se pudo cargar la bitácora" onRetry={lista.reload}>{lista.error}</ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState icon="history" title="Sin registros">
            {hayFiltros || periodo !== 'todo'
              ? 'Ningún registro coincide con el período y los filtros elegidos.'
              : 'Todavía no hay actividad registrada.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Fecha</th>
                  <th>Usuario</th>
                  <th>Módulo</th>
                  <th>Acción</th>
                  <th>Descripción</th>
                  <th>Origen</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => setDetalle(row)}>
                    <td className="mono text-sm">{fechaHora(row.created_at)}</td>
                    <td className="text-sm">
                      {quien(row)}
                      {row.email && row.username && <div className="cell-sub">{row.email}</div>}
                    </td>
                    <td className="text-sm">{etiquetaModulo(row.module)}</td>
                    <td><Badge tone={tonoAccion(row)} dot>{etiquetaAccion(row.action)}</Badge></td>
                    <td className="text-sm" style={{ maxWidth: 360 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description ?? '—'}</div>
                      {!row.success && row.error_message && (
                        <div className="cell-sub" style={{ color: 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.error_message}
                        </div>
                      )}
                    </td>
                    <td className="text-sm">
                      <span className="mono">{row.ip_address ?? '—'}</span>
                      {(row.browser || row.os) && <div className="cell-sub">{[row.browser, row.os].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td><Icon name="chevron-right" size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detalle && <AuditDetailDrawer row={detalle} onClose={() => setDetalle(null)} nav={nav} />}
    </div>
  )
}

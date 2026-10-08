// FISCALO — Punto de venta: administración del POS (api-gratex docs/specs/pos.md M1).
// El POS (pos.fiscalpoint.com.do) solo vende; los empleados con PIN, las cajas
// y los equipos habilitados se administran aquí, contra /api/pos-admin.
// Visible con el módulo `pos` y si la empresa tiene el POS activo (navigation.ts).
import { useState } from 'react'
import { Icon, Btn, RefreshButton, Badge, Card, PageHead, Tabs, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { listPosCajas, listPosEmpleados, listPosEquipos } from '@/api/pos'
import type { PosCaja, PosEmpleado, PosEquipo } from '@/api/pos'
import { useApiQuery, type ApiQueryState } from '@/hooks/useApiQuery'
import { EmpleadoModal, PinModal, CajaModal, RevocarEquipoModal } from './PosModals'
import { ROL_LABEL, fmtFecha } from './textos'

type Pestana = 'empleados' | 'cajas'

type ModalPos =
  | { tipo: 'empleado'; empleado: PosEmpleado | null }
  | { tipo: 'pin'; empleado: PosEmpleado; pin: string; nuevo: boolean }
  | { tipo: 'caja'; caja: PosCaja | null }
  | { tipo: 'revocar'; equipo: PosEquipo }

export function PuntoVentaView() {
  const [pestana, setPestana] = useState<Pestana>('empleados')
  const [modal, setModal] = useState<ModalPos | null>(null)

  const empleados = useApiQuery(['pos', 'empleados'], listPosEmpleados)
  const cajas = useApiQuery(['pos', 'cajas'], listPosCajas)
  const equipos = useApiQuery(['pos', 'equipos'], listPosEquipos)

  const recargar = () => Promise.all([empleados.reload(), cajas.reload(), equipos.reload()])
  const equipoDe = (cajaId: number) => equipos.data?.find((e) => e.caja_id === cajaId) ?? null

  return (
    <div className="page page-wide">
      <PageHead title="Punto de venta"
        sub="Empleados, cajas y equipos del POS. Las ventas se hacen en la caja (pos.fiscalpoint.com.do)."
        actions={
          <>
            <RefreshButton onRefresh={recargar} />
            {pestana === 'empleados'
              ? <Btn variant="primary" icon="user-plus" onClick={() => setModal({ tipo: 'empleado', empleado: null })}>Nuevo empleado</Btn>
              : <Btn variant="primary" icon="plus" onClick={() => setModal({ tipo: 'caja', caja: null })}>Nueva caja</Btn>}
          </>
        } />

      <Tabs active={pestana} onChange={(id) => setPestana(id as Pestana)} tabs={[
        { id: 'empleados', label: 'Empleados', count: empleados.data?.length },
        { id: 'cajas', label: 'Cajas y equipos', count: cajas.data?.length },
      ]} />

      <div className="mt-md">
        {pestana === 'empleados'
          ? <EmpleadosTabla q={empleados} onAbrir={(e) => setModal({ tipo: 'empleado', empleado: e })}
              onNuevo={() => setModal({ tipo: 'empleado', empleado: null })} />
          : <CajasTabla cajas={cajas} equipos={equipos} equipoDe={equipoDe}
              onAbrir={(c) => setModal({ tipo: 'caja', caja: c })}
              onNueva={() => setModal({ tipo: 'caja', caja: null })}
              onRevocar={(e) => setModal({ tipo: 'revocar', equipo: e })} />}
      </div>

      {modal?.tipo === 'empleado' && (
        <EmpleadoModal empleado={modal.empleado} onClose={() => setModal(null)}
          onPin={(empleado, pin, nuevo) => setModal({ tipo: 'pin', empleado, pin, nuevo })} />
      )}
      {modal?.tipo === 'pin' && (
        <PinModal empleado={modal.empleado} pin={modal.pin} nuevo={modal.nuevo} onClose={() => setModal(null)} />
      )}
      {modal?.tipo === 'caja' && (
        <CajaModal caja={modal.caja} equipo={modal.caja ? equipoDe(modal.caja.id) : null} onClose={() => setModal(null)} />
      )}
      {modal?.tipo === 'revocar' && <RevocarEquipoModal equipo={modal.equipo} onClose={() => setModal(null)} />}
    </div>
  )
}

// --- Empleados ---------------------------------------------------------------

function EmpleadosTabla({ q, onAbrir, onNuevo }: {
  q: ApiQueryState<PosEmpleado[]>
  onAbrir: (e: PosEmpleado) => void
  onNuevo: () => void
}) {
  const filas = q.data ?? []
  return (
    <Card noPad>
      {q.loading ? (
        <LoadingState rows={4} />
      ) : q.error ? (
        <ErrorState title="No se pudieron cargar los empleados" onRetry={q.reload}>{q.error}</ErrorState>
      ) : filas.length === 0 ? (
        <EmptyState icon="users" title="Todavía no hay empleados"
          action={<Btn variant="primary" icon="user-plus" onClick={onNuevo}>Nuevo empleado</Btn>}>
          Crea a tus cajeros y supervisores. El sistema le genera a cada uno un PIN de 4 dígitos para entrar al POS;
          no necesitan usuario en FiscalPoint.
        </EmptyState>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nombre</th><th>Rol</th><th>PIN generado</th><th>Estado</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {filas.map((e) => (
                <tr key={e.id} onClick={() => onAbrir(e)}>
                  <td>
                    <div className="row gap-sm">
                      <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 30, height: 30 }}><Icon name="user" size={15} /></span>
                      <span className="cell-main">{e.nombre}</span>
                    </div>
                  </td>
                  <td><Badge tone={e.rol === 'supervisor' ? 'accent' : 'neutral'}>{ROL_LABEL[e.rol]}</Badge></td>
                  <td className="text-sm muted">{fmtFecha(e.pin_generado_at)}</td>
                  <td><Badge tone={e.activo ? 'success' : 'neutral'} dot>{e.activo ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td><Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// --- Cajas y equipos ---------------------------------------------------------

function CajasTabla({ cajas, equipos, equipoDe, onAbrir, onNueva, onRevocar }: {
  cajas: ApiQueryState<PosCaja[]>
  equipos: ApiQueryState<PosEquipo[]>
  equipoDe: (cajaId: number) => PosEquipo | null
  onAbrir: (c: PosCaja) => void
  onNueva: () => void
  onRevocar: (e: PosEquipo) => void
}) {
  const filas = cajas.data ?? []
  const cargando = cajas.loading || equipos.loading
  const error = cajas.error ?? equipos.error
  return (
    <>
      <Card noPad>
        {cargando ? (
          <LoadingState rows={3} />
        ) : error ? (
          <ErrorState title="No se pudieron cargar las cajas" onRetry={() => Promise.all([cajas.reload(), equipos.reload()])}>{error}</ErrorState>
        ) : filas.length === 0 ? (
          <EmptyState icon="monitor" title="Todavía no hay cajas"
            action={<Btn variant="primary" icon="plus" onClick={onNueva}>Nueva caja</Btn>}>
            Crea una caja por cada punto de cobro. Después habilita la PC de cada una desde el POS.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Caja</th><th>Estado</th><th>Equipo habilitado</th><th>Último uso</th><th style={{ width: 120 }}></th></tr></thead>
              <tbody>
                {filas.map((c) => {
                  const eq = equipoDe(c.id)
                  return (
                    <tr key={c.id} onClick={() => onAbrir(c)}>
                      <td>
                        <div className="row gap-sm">
                          <span className="kpi-ic" style={{ background: 'var(--neutral-soft)', color: 'var(--text-2)', width: 30, height: 30 }}><Icon name="monitor" size={15} /></span>
                          <span className="cell-main">{c.nombre}</span>
                        </div>
                      </td>
                      <td><Badge tone={c.activa ? 'success' : 'neutral'} dot>{c.activa ? 'Activa' : 'Inactiva'}</Badge></td>
                      <td>
                        {eq ? (
                          <div>
                            <div className="row gap-sm" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                              <span className="text-sm">{eq.nombre || 'Equipo sin nombre'}</span>
                              {eq.bloqueado && (
                                <Badge tone="danger" dot>Bloqueado {Math.max(1, Math.ceil(eq.bloqueo_segundos / 60))} min</Badge>
                              )}
                            </div>
                            <div className="text-sm muted-3">
                              Habilitado {fmtFecha(eq.created_at)}{eq.habilitado_por_nombre ? ` por ${eq.habilitado_por_nombre}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm muted-3">Sin equipo</span>
                        )}
                      </td>
                      <td className="text-sm muted">{eq ? (eq.last_used ? fmtFecha(eq.last_used) : 'Nunca') : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {eq && (
                          <Btn variant="ghost" size="sm" icon="ban" style={{ color: 'var(--danger)' }}
                            onClick={(ev) => { ev.stopPropagation(); onRevocar(eq) }}>Revocar</Btn>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-md" title="Cómo habilitar una PC como caja">
        <ol className="text-sm" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, color: 'var(--text-2)' }}>
          <li>En la PC de la caja, entra a FiscalPoint con un usuario que tenga permiso de Punto de venta.</li>
          <li>Pulsa el botón <b>POS</b> de la barra superior (o abre pos.fiscalpoint.com.do e inicia sesión ahí).</li>
          <li>Elige la caja. Desde ese momento esa PC es la caja y los empleados entran solo con su PIN.</li>
        </ol>
        <div className="text-sm muted mt-md">
          Cada caja funciona en un solo equipo: habilitar otra PC en la misma caja revoca la anterior.
          Si un equipo queda bloqueado por PINs incorrectos y no puedes esperar, revócalo y habilítalo de nuevo.
        </div>
      </Card>
    </>
  )
}

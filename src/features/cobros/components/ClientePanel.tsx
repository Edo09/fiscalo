// El panel del cliente (sin salir de la página): su configuración mensual y monto actual, lo que debe y lo
// vencido, su próximo vencimiento, el historial completo de cobros con sus pagos, y sus recordatorios.
import { useState } from 'react'
import { Avatar, Btn, Drawer, EmptyState, ErrorState, LoadingState, Money, Tabs } from '@/components/ui'
import { ETIQUETA_CANAL, type CanalRecordatorio } from '@/api/schemas/cobros'
import { detalleCobroMensual, fechaCorta, fechaHoraCorta, periodoCorto, totalMensual } from '../format'
import { usePanelCliente } from '../hooks'
import { useCobrosUi, useCobrosUiStore, type PestanaPanel } from '../store'
import { Aviso } from './Aviso'
import { ConfigClienteForm } from './ConfigClienteForm'
import { HistorialCobros } from './HistorialCobros'

export function ClientePanel({ clientId }: { clientId: number }) {
  const cerrarPanel = useCobrosUi((s) => s.cerrarPanel)
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const modalAbierto = useCobrosUi((s) => s.modal !== null)
  const { data, error, loading, reload } = usePanelCliente(clientId)
  // La pestaña con que se abre: la de configuración si se llegó por "Cobro mensual de un cliente".
  const ui = useCobrosUiStore()
  const [tab, setTab] = useState<PestanaPanel>(() => ui.getState().panelPestana)

  const cliente = data?.cliente
  const sub = cliente
    ? [cliente.rnc ? `RNC ${cliente.rnc}` : null, cliente.telefono || null, cliente.email || null].filter(Boolean).join(' · ') || 'Sin datos de contacto'
    : undefined

  return (
    <Drawer
      title={cliente?.nombre ?? 'Cliente'} sub={sub} width={880} onClose={cerrarPanel} cerrarConEscape={!modalAbierto}
      footer={
        <>
          <Btn variant="ghost" onClick={cerrarPanel}>Cerrar</Btn>
          <Btn variant="primary" icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId })} disabled={!data}>Nuevo cobro</Btn>
        </>
      }
    >
      {loading ? (
        <LoadingState rows={6} />
      ) : !data ? (
        // Solo un error SIN dato lo desmonta: con dato (un refetch fallido) el panel sigue y no pierde lo escrito en su formulario.
        <ErrorState title="No se pudo abrir el cliente" onRetry={reload}>{error}</ErrorState>
      ) : (
        <>
          {error && <Aviso tono="error">No se pudo actualizar el panel ({error}). Se muestran los últimos datos que llegaron.</Aviso>}
          <div className="row gap-md mb-md">
            <Avatar name={data.cliente.nombre} size={44} />
            <div style={{ flex: 1 }}>
              <div className="fw6" style={{ fontSize: 15 }}>{data.cliente.nombre}</div>
              {data.cliente.contacto && data.cliente.contacto !== data.cliente.nombre && <div className="text-sm muted">Contacto: {data.cliente.contacto}</div>}
            </div>
          </div>

          {data.config?.activo && data.resumen.cobros_abiertos === 0 && (
            <Aviso>
              Tiene el cobro mensual activo pero ningún cobro abierto, así que no se generará ninguno solo: los siguientes salen cuando
              queda pagado un cobro. Crea el del mes con "Nuevo cobro".
            </Aviso>
          )}

          <div className="cobros-cifras">
            <div className="cobros-cifra">
              <div className="lbl">Pendiente</div>
              <div className="val"><Money value={data.resumen.saldo_pendiente} /></div>
              <div className="sub">{data.resumen.cobros_abiertos === 1 ? '1 cobro abierto' : `${data.resumen.cobros_abiertos} cobros abiertos`}</div>
            </div>
            <div className="cobros-cifra">
              <div className="lbl">Vencido</div>
              <div className="val" style={data.resumen.saldo_vencido > 0 ? { color: 'var(--danger)' } : undefined}><Money value={data.resumen.saldo_vencido} /></div>
              <div className="sub">{data.resumen.vencido_desde ? `desde el ${fechaCorta(data.resumen.vencido_desde)}` : 'nada vencido'}</div>
            </div>
            <div className="cobros-cifra">
              <div className="lbl">Próximo vencimiento</div>
              <div className="val" style={{ fontSize: 14 }}>{data.resumen.proximo_vencimiento ? fechaCorta(data.resumen.proximo_vencimiento.fecha_vencimiento) : '—'}</div>
              <div className="sub">
                {data.resumen.proximo_vencimiento
                  ? <>{periodoCorto(data.resumen.proximo_vencimiento.periodo)} · <Money value={data.resumen.proximo_vencimiento.saldo} cur={false} /></>
                  : 'ninguno por vencer'}
              </div>
            </div>
            <div className="cobros-cifra">
              <div className="lbl">Cobro mensual actual</div>
              <div className="val">{data.config ? <Money value={totalMensual(data.config, data.empresas_que_pagan)} /> : <span className="muted-3">Sin configurar</span>}</div>
              <div className="sub">{data.config ? detalleCobroMensual(data.config, data.empresas_que_pagan) : 'ver la pestaña Cobro mensual'}</div>
            </div>
            <div className="cobros-cifra">
              <div className="lbl">Cobrado en total</div>
              <div className="val"><Money value={data.resumen.total_cobrado} /></div>
              <div className="sub">de <Money value={data.resumen.total_facturado} cur={false} /> facturados</div>
            </div>
          </div>

          <Tabs
            tabs={[
              { id: 'historial', label: 'Historial de cobros', count: data.cobros.length },
              { id: 'config', label: 'Cobro mensual' },
              { id: 'recordatorios', label: 'Recordatorios', count: data.recordatorios.length },
            ]}
            active={tab} onChange={(id) => setTab(id as PestanaPanel)}
          />

          {tab === 'historial' && <HistorialCobros cobros={data.cobros} clientId={clientId} />}
          {tab === 'config' && (
            <ConfigClienteForm clientId={clientId} config={data.config} periodoInicial={data.sugerido.periodo} empresasQuePagan={data.empresas_que_pagan} />
          )}
          {tab === 'recordatorios' && (
            data.recordatorios.length === 0 ? (
              <EmptyState icon="bell" title="Sin recordatorios">Aquí aparecen los recordatorios que se anoten a mano a los cobros de este cliente.</EmptyState>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Cuándo</th><th>Cobro</th><th>Cómo</th><th>Nota</th><th>Quién</th></tr></thead>
                  <tbody>
                    {data.recordatorios.map((r) => (
                      <tr key={r.id} style={{ cursor: 'default' }}>
                        <td className="text-sm">{fechaHoraCorta(r.fecha_hora)}</td>
                        <td className="text-sm">{periodoCorto(r.periodo)}</td>
                        <td className="text-sm">{ETIQUETA_CANAL[r.canal as CanalRecordatorio] ?? r.canal}</td>
                        <td className="text-sm muted">{r.nota ?? '—'}</td>
                        <td className="text-sm muted">{r.usuario ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </Drawer>
  )
}

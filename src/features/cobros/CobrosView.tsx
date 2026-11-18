import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Btn, PageHead, RefreshButton, Tabs } from '@/components/ui'
import '@/styles/cobros.css'
import { ClientePanel } from './components/ClientePanel'
import { DashboardCobros } from './components/DashboardCobros'
import { ListadoCobros } from './components/ListadoCobros'
import { ModalesCobros } from './components/ModalesCobros'
import { RecordatoriosSection } from './components/RecordatoriosSection'
import { cobrosKeys, useRecordatoriosCobros } from './hooks'
import { useCobrosUi } from './store'

/* FISCALO — Cobros (cuentas por cobrar por cliente): /api/cobros.
   Dashboard compacto, tabla con filtros, panel del cliente (historial, pagos y cobro mensual),
   formularios de cobro y de pago, y recordatorios informativos. Reglas y contrato: api-gratex
   docs/modules/cobros.md. Los datos son de TanStack Query (hooks.ts), la interfaz de Zustand (store.ts)
   y las validaciones de Zod (src/api/schemas/cobros.ts). */
export function CobrosView({ senalNuevo = null, clienteInicial = null }: {
  /**
   * La señal "Nueva > Cobro": el OBJETO del payload de navegación, no un booleano. Cada clic en el menú trae
   * uno nuevo, así que el alta se abre cada vez; con un booleano, la segunda vez no cambiaba nada y no pasaba nada.
   */
  senalNuevo?: object | null
  /** Abre el panel de este cliente al llegar (botón "Cobros" de la ficha del cliente). */
  clienteInicial?: number | null
}) {
  const queryClient = useQueryClient()
  const tab = useCobrosUi((s) => s.tab)
  const setTab = useCobrosUi((s) => s.setTab)
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const panelClienteId = useCobrosUi((s) => s.panelClienteId)
  const recordatoriosDias = useCobrosUi((s) => s.recordatoriosDias)
  // El mismo pedido (misma ventana de días) que la sección Recordatorios: una sola consulta compartida.
  const recordatorios = useRecordatoriosCobros(recordatoriosDias)

  // Al llegar con una señal (Nueva > Cobro, o "Cobros" desde un cliente), se actúa una vez por señal.
  useEffect(() => {
    if (senalNuevo) abrirModal({ tipo: 'cobro', cobroId: null, clientId: null })
  }, [senalNuevo, abrirModal])
  useEffect(() => {
    if (clienteInicial !== null) abrirPanel(clienteInicial)
  }, [clienteInicial, abrirPanel])
  // Al salir de la vista no se queda un modal ni un panel abiertos en el store: con Atrás y volver reaparecerían
  // (el modal en blanco y con otra clave de pago).
  useEffect(() => () => {
    const ui = useCobrosUi.getState()
    ui.cerrarModal()
    ui.cerrarPanel()
  }, [])

  const actualizar = () => queryClient.invalidateQueries({ queryKey: cobrosKeys.todo })

  return (
    <div className="page page-wide">
      <PageHead
        title="Cobros"
        sub="Cuentas por cobrar por cliente · montos en RD$"
        actions={
          <>
            <RefreshButton onRefresh={actualizar} />
            <Btn variant="secondary" icon="user-check" onClick={() => abrirModal({ tipo: 'elegir-cliente' })}>Cobro mensual de un cliente</Btn>
            <Btn variant="primary" icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId: null })}>Nuevo cobro</Btn>
          </>
        }
      />

      <DashboardCobros />

      <Tabs
        tabs={[
          { id: 'cobros', label: 'Cobros' },
          { id: 'recordatorios', label: 'Recordatorios', count: recordatorios.data?.resumen.clientes_por_recordar },
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'cobros' | 'recordatorios')}
      />

      {tab === 'cobros' ? <ListadoCobros /> : <RecordatoriosSection />}

      {panelClienteId !== null && <ClientePanel key={panelClienteId} clientId={panelClienteId} />}
      <ModalesCobros />
    </div>
  )
}

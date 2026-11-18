import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Btn, PageHead, RefreshButton, Tabs } from '@/components/ui'
import '@/styles/cobros.css'
import { AmbitoCobrosContext, useAmbitoCobros } from './ambito'
import { AMBITO_EMPRESA, AMBITO_TENANTS } from './ambitos'
import { ClientePanel } from './components/ClientePanel'
import { DashboardCobros } from './components/DashboardCobros'
import { ListadoCobros } from './components/ListadoCobros'
import { ModalesCobros } from './components/ModalesCobros'
import { RecordatoriosSection } from './components/RecordatoriosSection'
import { useRecordatoriosCobros } from './hooks'
import { useCobrosUi, useCobrosUiStore } from './store'

/* FISCALO — Cobros (cuentas por cobrar por cliente): /api/cobros y /api/cobros-tenants.
   Dashboard compacto, tabla con filtros, panel del cliente (historial, pagos y cobro mensual),
   formularios de cobro y de pago, y recordatorios informativos. Reglas y contrato: api-gratex
   docs/modules/cobros.md. Los datos son de TanStack Query (hooks.ts), la interfaz de Zustand (store.ts)
   y las validaciones de Zod (src/api/schemas/cobros.ts).

   DOS pantallas con el mismo cuerpo y distinto ÁMBITO (ambito.ts): `CobrosView` es la de cada empresa, que cobra a SUS
   clientes; `CobrosTenantsView` es la de la plataforma, que cobra a sus tenants (solo cuentas de soporte). Cada una
   pone su ámbito en el contexto y todo lo de abajo lee de allí su servicio, sus claves de caché, su store y sus textos. */

interface PropsPantalla {
  /**
   * La señal "Nueva > Cobro": el OBJETO del payload de navegación, no un booleano. Cada clic en el menú trae
   * uno nuevo, así que el alta se abre cada vez; con un booleano, la segunda vez no cambiaba nada y no pasaba nada.
   */
  senalNuevo?: object | null
  /** Abre el panel de este cliente al llegar (botón "Cobros" de la ficha del cliente). */
  clienteInicial?: number | null
}

/** Cobros de una empresa: lo que sus clientes le deben (/api/cobros). */
export function CobrosView(props: PropsPantalla) {
  return (
    <AmbitoCobrosContext.Provider value={AMBITO_EMPRESA}>
      <PantallaCobros {...props} />
    </AmbitoCobrosContext.Provider>
  )
}

/** Cobros de tenants: lo que la plataforma le cobra a las empresas que la usan (/api/cobros-tenants). Solo soporte. */
export function CobrosTenantsView() {
  return (
    <AmbitoCobrosContext.Provider value={AMBITO_TENANTS}>
      <PantallaCobros />
    </AmbitoCobrosContext.Provider>
  )
}

function PantallaCobros({ senalNuevo = null, clienteInicial = null }: PropsPantalla) {
  const { keys, textos } = useAmbitoCobros()
  const ui = useCobrosUiStore()
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
    const estado = ui.getState()
    estado.cerrarModal()
    estado.cerrarPanel()
  }, [ui])

  const actualizar = () => queryClient.invalidateQueries({ queryKey: keys.todo })

  return (
    <div className="page page-wide">
      <PageHead
        title={textos.titulo}
        sub={textos.subtitulo}
        actions={
          <>
            <RefreshButton onRefresh={actualizar} />
            <Btn variant="secondary" icon="user-check" onClick={() => abrirModal({ tipo: 'elegir-cliente' })}>{textos.botonConfigurar}</Btn>
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

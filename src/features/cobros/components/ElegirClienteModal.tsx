// Elegir un cliente para dos cosas: abrir su panel de cobros (configurar su cobro mensual o ver su historial) o
// filtrar la tabla por él. El buscador es el del ámbito (SelectorCliente): el de Clientes de siempre en una empresa, y el
// de tenants en la plataforma.
import { Modal } from '@/components/ui'
import { useAmbitoCobros } from '../ambito'
import { useCobrosUi } from '../store'
import { SelectorCliente } from './SelectorCliente'

export function ElegirClienteModal({ modo, onClose }: { modo: 'panel' | 'filtro'; onClose: () => void }) {
  const { textos } = useAmbitoCobros()
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const setFiltros = useCobrosUi((s) => s.setFiltros)

  return (
    <Modal
      title={modo === 'panel' ? textos.elegirTitulo : textos.filtrarTitulo}
      sub={modo === 'panel' ? textos.elegirSub : textos.filtrarSub}
      icon="user" width={520} onClose={onClose}
    >
      <SelectorCliente
        onElegir={(id, nombre) => {
          // "Cobro mensual de un cliente" abre su panel en la pestaña donde se configura el cobro mensual.
          if (modo === 'panel') abrirPanel(id, 'config')
          else setFiltros({ clientId: id, clienteNombre: nombre })
          onClose()
        }}
      />
      <p className="text-xs muted-3" style={{ marginTop: 10, minHeight: 90 }}>{textos.elegirNota}</p>
    </Modal>
  )
}

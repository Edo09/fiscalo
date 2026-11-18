// Elegir un cliente (con el buscador de siempre: ClientCombobox) para dos cosas: abrir su panel de cobros
// (configurar su cobro mensual o ver su historial) o filtrar la tabla por él.
import { Modal } from '@/components/ui'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { useCobrosUi } from '../store'

export function ElegirClienteModal({ modo, onClose }: { modo: 'panel' | 'filtro'; onClose: () => void }) {
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const setFiltros = useCobrosUi((s) => s.setFiltros)

  return (
    <Modal
      title={modo === 'panel' ? 'Cobro mensual de un cliente' : 'Filtrar por cliente'}
      sub={modo === 'panel' ? 'Elige el cliente para configurar su cobro o ver su historial' : 'Solo los cobros de ese cliente'}
      icon="user" width={520} onClose={onClose}
    >
      <ClientCombobox
        value={null}
        onChange={(c) => {
          if (!c) return
          // "Cobro mensual de un cliente" abre su panel en la pestaña donde se configura el cobro mensual.
          if (modo === 'panel') abrirPanel(Number(c.id), 'config')
          else setFiltros({ clientId: Number(c.id), clienteNombre: c.nombre })
          onClose()
        }}
      />
      <p className="text-xs muted-3" style={{ marginTop: 10, minHeight: 90 }}>
        Los clientes son los de la sección Clientes: si falta uno, créalo allí primero.
      </p>
    </Modal>
  )
}

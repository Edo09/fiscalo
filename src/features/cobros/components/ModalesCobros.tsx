// Los modales de Cobros: el store dice cuál está abierto y aquí se monta. Van dentro de `cobros-capa-modal`
// (ver styles/cobros.css) para quedar ENCIMA del panel del cliente, que es un Drawer.
import { useCobrosUi } from '../store'
import { CobroFormModal } from './CobroFormModal'
import { ElegirClienteModal } from './ElegirClienteModal'
import { AnularPagoModal, CancelarCobroModal } from './MotivoModals'
import { PagoFormModal } from './PagoFormModal'
import { QuitarClienteModal } from './QuitarClienteModal'
import { SinPagoModal } from './SinPagoModal'
import { RecordatorioFormModal } from './RecordatorioFormModal'

export function ModalesCobros() {
  const modal = useCobrosUi((s) => s.modal)
  const cerrarModal = useCobrosUi((s) => s.cerrarModal)
  if (!modal) return null

  // Cierra SOLO este modal: un formulario cuyo guardado termina tarde no puede cerrar otro que se abrió después.
  const cerrar = () => cerrarModal(modal)
  // key: cada apertura es un modal NUEVO. Modal fija su Escape al montar y los formularios toman su estado
  // inicial al montarse: reciclar uno mostraría lo escrito en el anterior.
  const clave = JSON.stringify(modal)
  return (
    <div className="cobros-capa-modal">
      {modal.tipo === 'cobro' && <CobroFormModal key={clave} cobroId={modal.cobroId} clientId={modal.clientId} onClose={cerrar} />}
      {modal.tipo === 'pago' && <PagoFormModal key={clave} cobroId={modal.cobroId} onClose={cerrar} />}
      {modal.tipo === 'cancelar' && <CancelarCobroModal key={clave} cobroId={modal.cobroId} onClose={cerrar} />}
      {modal.tipo === 'anular' && <AnularPagoModal key={clave} pagoId={modal.pagoId} cobroId={modal.cobroId} onClose={cerrar} />}
      {modal.tipo === 'recordatorio' && <RecordatorioFormModal key={clave} cobroId={modal.cobroId} onClose={cerrar} />}
      {modal.tipo === 'elegir-cliente' && <ElegirClienteModal key={clave} modo="panel" onClose={cerrar} />}
      {modal.tipo === 'filtrar-cliente' && <ElegirClienteModal key={clave} modo="filtro" onClose={cerrar} />}
      {modal.tipo === 'no-paga' && <SinPagoModal key={clave} clientId={modal.clientId} nombre={modal.nombre} onClose={cerrar} />}
      {modal.tipo === 'excluir' && <QuitarClienteModal key={clave} clientId={modal.clientId} nombre={modal.nombre} empresas={modal.empresas} onClose={cerrar} />}
    </div>
  )
}

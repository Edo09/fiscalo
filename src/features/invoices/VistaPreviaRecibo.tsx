import { Btn, Modal } from '@/components/ui'
import type { ReciboDatos } from '@/api'
import { reciboHtml, ZOOM_VISTA_PREVIA } from './reciboHtml'

/**
 * La tirilla de una factura SIN guardar, vista dentro de la app.
 *
 * No se abre en otra pestaña como la hoja carta a propósito: una tirilla sin
 * guardar que se pueda imprimir limpia es exactamente el recibo que se
 * entregaba sin que la venta quedara registrada. Aquí va en un iframe sin
 * permisos (sandbox vacío: no corre scripts ni abre el diálogo de imprimir),
 * con sello y marca de agua. Imprimir la página saca la pantalla de la app, no
 * un recibo; para entregar uno hay que guardar, y el pie ofrece hacerlo.
 */
export function VistaPreviaRecibo({
  datos, puedeGuardar, onGuardarEImprimir, onClose,
}: {
  datos: ReciboDatos
  puedeGuardar: boolean
  onGuardarEImprimir: () => void
  onClose: () => void
}) {
  const ancho = datos.papel.ancho_mm
  return (
    <Modal
      title={`Vista previa · recibo ${ancho} mm`}
      sub="Sin guardar: no es válida como factura"
      icon="receipt"
      width={500}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
          <Btn variant="primary" icon="printer" onClick={onGuardarEImprimir} disabled={!puedeGuardar}>
            Guardar e imprimir {ancho} mm
          </Btn>
        </>
      }
    >
      <div className="fx-previa-recibo">
        <iframe
          title={`Vista previa del recibo de ${ancho} mm`}
          sandbox=""
          srcDoc={reciboHtml(datos, { vistaPrevia: true })}
          // Ancho del papel ya aumentado, más la barra de desplazamiento.
          style={{ width: `calc(${ancho}mm * ${ZOOM_VISTA_PREVIA} + 18px)` }}
        />
      </div>
    </Modal>
  )
}

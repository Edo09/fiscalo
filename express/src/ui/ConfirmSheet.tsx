// La confirmación de una acción que no se deshace (anexo 8): la pregunta nombrando lo que se va a hacer, UNA frase con la consecuencia y dos botones de 48 px,
// «Cancelar» a la izquierda y la acción a la derecha (en rojo si es destructiva). Es una hoja con `role="alertdialog"`, y el foco entra a «Cancelar»: Intro
// sobre una confirmación recién abierta no puede ejecutar la acción. Cancelar, Esc, el atrás del sistema, arrastrar el asa y tocar el fondo cancelan.
// Es para Cerrar sesión, borrar un usuario, Reenviar y Anular; nunca para el «Emitir» principal, que no se confirma dos veces.
import { useId } from 'react'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import './ConfirmSheet.css'

export interface ConfirmSheetProps {
  abierto: boolean
  /** La pregunta, con el nombre de lo que afecta: «¿Cerrar sesión?», «¿Anular la factura E45...14?». Es el título de la hoja. */
  pregunta: string
  /** Una frase: lo que pasa si se confirma. */
  consecuencia: string
  /** El rótulo de la acción, con el verbo («Cerrar sesión», «Anular»): nunca «Aceptar». */
  etiquetaAccion: string
  /** La acción va en rojo: es de las que no se deshacen. */
  peligro?: boolean
  onConfirmar(): void
  onCancelar(): void
}

export function ConfirmSheet(p: ConfirmSheetProps): JSX.Element {
  const { abierto, pregunta, consecuencia, etiquetaAccion, peligro = false, onConfirmar, onCancelar } = p
  const idConsecuencia = useId()
  return (
    <BottomSheet
      abierto={abierto}
      onCerrar={onCancelar}
      titulo={pregunta}
      cerrarConFondo
      rol="alertdialog"
      idDescripcion={idConsecuencia}
      pie={
        <div className="confirmar__botones">
          <Button variante="secundario" data-foco-inicial="" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variante={peligro ? 'peligro' : 'primario'} onClick={onConfirmar}>
            {etiquetaAccion}
          </Button>
        </div>
      }
    >
      <p id={idConsecuencia} className="confirmar__consecuencia">
        {consecuencia}
      </p>
    </BottomSheet>
  )
}

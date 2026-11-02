// La hoja de confirmación de «Reenviar» y el aviso mientras va (anexo 6.3). Reenviar emite otra vez: se confirma, con «Cancelar» como botón por omisión (ConfirmSheet). La hoja se cierra al confirmar y
// el envío sale cuando su atrás aterriza (`cuandoAterriceElAtras`): navegar a la fila nueva con la entrada de la hoja puesta la dejaría enterrada bajo la pantalla. Se monta una vez en el detalle.
import { cuandoAterriceElAtras } from '~/ui/capas'
import { Banner } from '~/ui/Banner'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { cancelarReenvio, confirmarReenvio, enviarReenvio, useReenvio } from './reenvio'

export function ReenviarHost(): JSX.Element | null {
  const { factura, fase } = useReenvio()
  const numero = factura === null ? '' : factura.numero
  return (
    <>
      <ConfirmSheet
        abierto={fase === 'confirmando'}
        pregunta={numero === '' ? '¿Reenviar la factura a la DGII?' : `¿Reenviar la factura ${numero} a la DGII?`}
        consecuencia="Sale otra vez con el mismo e-NCF. Si la DGII la acepta, reemplaza este intento."
        etiquetaAccion="Reenviar"
        onConfirmar={() => {
          cuandoAterriceElAtras(() => void enviarReenvio())
          confirmarReenvio()
        }}
        onCancelar={cancelarReenvio}
      />
      {fase === 'enviando' && <Banner tono="info">Reenviando a la DGII. No cierres esta pantalla.</Banner>}
    </>
  )
}

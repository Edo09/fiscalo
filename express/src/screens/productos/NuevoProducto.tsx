// «Nuevo producto o servicio»: una hoja sobre la lista de Productos (no hay ruta propia: `#/productos/:id` es solo la edición). Se monta al abrirse. Los mismos campos que la edición (CamposProducto); «Guardar» va en el pie de
// la hoja, sobre el teclado, y sin conexión está apagado con su razón. Cerrar con algo escrito pregunta «¿Descartar?».
import { useState } from 'react'
import { useEnLinea } from '~/net/enLinea'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { CamposProducto } from './CamposProducto'
import { useFormProducto } from './useFormProducto'

export function NuevoProducto(p: { nombre?: string; onCerrar(): void }): JSX.Element {
  const { nombre, onCerrar } = p
  const enLinea = useEnLinea()
  const [descartar, setDescartar] = useState(false)
  const form = useFormProducto({ nombreInicial: nombre, onGuardado: onCerrar })
  const cerrar = (): void => (form.sucio ? setDescartar(true) : onCerrar())
  return (
    <>
      <BottomSheet
        abierto
        titulo="Nuevo producto o servicio"
        onCerrar={cerrar}
        pie={
          <Button bloque cargando={form.guardando} disabled={!enLinea} razon="Sin conexión: no puedes guardar ahora." onClick={() => void form.guardar()}>
            Guardar
          </Button>
        }
      >
        <CamposProducto modo="crear" f={form.f} errores={form.errores} poner={form.poner} catalogo={form.catalogo} error={form.error} />
      </BottomSheet>
      <ConfirmSheet
        abierto={descartar}
        pregunta="¿Descartar este producto?"
        consecuencia="Lo que escribiste no se guarda."
        etiquetaAccion="Descartar"
        peligro
        onConfirmar={onCerrar}
        onCancelar={() => setDescartar(false)}
      />
    </>
  )
}

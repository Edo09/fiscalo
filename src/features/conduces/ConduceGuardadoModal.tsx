import { useEffect, useRef } from 'react'
import { Btn, Modal } from '@/components/ui'
import {
  BTN_SEGUIR_EN_CONDUCE, BTN_VOLVER_A_LA_LISTA, PREGUNTA_VOLVER_A_LA_LISTA, tituloConduceGuardado,
  type ConduceGuardado,
} from './schema'

/* FISCALO — Lo que se pregunta después de guardar un conduce (decisión del 2026-10-08).

   Guardar ya no navega ni avisa con un toast: este modal dice qué se guardó
   ("Conduce CON-000005 creado" / "…actualizado") y pregunta si volver a la lista.
   - "Volver a la lista" (lo principal): la lista de conduces, como antes.
   - "Seguir en el conduce": se queda en el conduce guardado (ConduceForm decide
     cómo; destinoSeguirEnConduce en schema.ts).
   Cerrarlo con la X, Esc o el fondo es lo mismo que "Seguir en el conduce": cerrar
   nunca saca al usuario de la pantalla. */
export function ConduceGuardadoModal({ guardado, onVolver, onSeguir }: {
  guardado: ConduceGuardado
  onVolver: () => void
  onSeguir: () => void
}) {
  // Una sola respuesta. El Modal cierra con X, Esc o fondo tras una animación de
  // 160 ms y llama a onClose con lo que vio al montar: un clic en "Volver a la
  // lista" dentro de esos 160 ms dejaría pendiente un "seguir" que, al llegar,
  // navegaría al conduce justo después de salir hacia la lista. El primero que
  // responde gana; el otro ya no hace nada.
  const respondido = useRef(false)
  // Desmontado (la lista, otra vista, atrás del navegador) ya no responde: la
  // salida pendiente de Esc no debe navegar desde una pantalla que ya no está.
  // Se vuelve a abrir al montar para que el doble montaje de StrictMode no la deje cerrada.
  useEffect(() => {
    respondido.current = false
    return () => { respondido.current = true }
  }, [])
  const responder = (accion: () => void) => () => {
    if (respondido.current) return
    respondido.current = true
    accion()
  }

  return (
    <Modal
      title={tituloConduceGuardado(guardado)}
      icon="check-circle"
      onClose={responder(onSeguir)}
      footer={
        <>
          <Btn variant="ghost" onClick={responder(onSeguir)}>{BTN_SEGUIR_EN_CONDUCE}</Btn>
          <Btn variant="primary" onClick={responder(onVolver)} autoFocus>{BTN_VOLVER_A_LA_LISTA}</Btn>
        </>
      }
    >
      <p className="text-sm">{PREGUNTA_VOLVER_A_LA_LISTA}</p>
    </Modal>
  )
}

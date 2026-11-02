// El sondeo del detalle (anexo 6.3 y 12.6): una factura que no está en un estado final (en proceso o sin confirmar, `esSondeable`) se le pregunta a la DGII una vez al abrirla y luego con el retroceso de
// `siguienteSondeoMs` (5, 10, 20, 40 y 60 s hasta unos cinco minutos), SOLO mientras la pantalla se ve: con la app oculta no se pregunta, y al volver se pregunta en el acto y se sigue desde donde iba. Se
// detiene en el primer error que no es de red (el texto ya quedó a la vista en `useVerificacion`: por ejemplo el 422 de una fila sin track id) y no se rinde por un fallo de red, que conserva el plazo.
// Al agotar los plazos dice `agotado` y la pantalla escribe «Seguimos confirmando. Abre la factura más tarde.».
import { useEffect, useState } from 'react'
import { siguienteSondeoMs } from '~/lib/sondeo'
import { esFalloDeRed, olvidarVerificacion, verificarEstado } from './verificar'

/** Sondea la factura `id` mientras `activo`. `agotado`: ya no quedan plazos y la factura sigue sin estado final. */
export function useSondeo(id: number, activo: boolean): { agotado: boolean } {
  const [agotado, setAgotado] = useState(false)

  useEffect(() => {
    olvidarVerificacion(id)
    setAgotado(false)
    if (!activo) return
    let vivo = true
    let intento = 0
    let espera: number | undefined
    let alVolver: (() => void) | undefined

    const dejarDeEsperarLaVista = (): void => {
      if (alVolver !== undefined) document.removeEventListener('visibilitychange', alVolver)
      alVolver = undefined
    }

    const preguntar = async (): Promise<void> => {
      if (!vivo) return
      if (document.visibilityState !== 'visible') {
        // Oculta: no se gasta ningún plazo. Al verse otra vez se pregunta en el acto.
        dejarDeEsperarLaVista()
        alVolver = () => {
          if (document.visibilityState !== 'visible') return
          dejarDeEsperarLaVista()
          void preguntar()
        }
        document.addEventListener('visibilitychange', alVolver)
        return
      }
      try {
        await verificarEstado(id)
      } catch (e) {
        if (!esFalloDeRed(e)) return // el texto ya está en `useVerificacion`; con un fallo que el servidor dio no se insiste
      }
      if (!vivo) return
      const plazo = siguienteSondeoMs(intento)
      intento += 1
      if (plazo === null) {
        setAgotado(true)
        return
      }
      espera = window.setTimeout(() => void preguntar(), plazo)
    }

    void preguntar()
    return () => {
      vivo = false
      window.clearTimeout(espera)
      dejarDeEsperarLaVista()
    }
  }, [id, activo])

  return { agotado: activo && agotado }
}

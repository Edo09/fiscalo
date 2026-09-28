// Aviso de "sin guardar" al salir de una pantalla.
//
// La vista que tiene algo que se perdería lo declara con useAvisoSalida(activo).
// La navegación (hooks/useHistoryNav) lo consulta antes de cambiar de vista,
// venga de un clic dentro de la app o de atrás/adelante del navegador, y pide
// confirmación. Al cerrar o recargar la pestaña avisa el propio navegador.
//
// Hay un solo registro porque la app muestra una sola vista a la vez.
import { useEffect, useRef } from 'react'

interface Registro {
  activo: boolean
  mensaje: string
  /** Hay un guardado en curso: ni se pregunta ni se sale hasta que termine. */
  ocupado: boolean
  /** Ya no hay nada que perder aunque `activo` siga en true (se guardó o se descartó). */
  liberado: boolean
}

let registro: Registro | null = null

/** Hay una vista montada con algo sin guardar. */
export function haySinGuardar(): boolean {
  return registro != null && registro.activo && !registro.liberado
}

/**
 * La vista está guardando. Salir a mitad no descartaría nada (la petición ya
 * salió y la factura se crea igual) y el guardado, al terminar, cambiaría de
 * vista por su cuenta: la navegación espera.
 */
export function guardandoAhora(): boolean {
  return registro != null && registro.ocupado && !registro.liberado
}

/** Qué se perdería, para el diálogo de confirmación. */
export function mensajeSinGuardar(): string {
  return registro?.mensaje ?? ''
}

/**
 * El usuario eligió salir sin guardar. Sin esto, salir recargando (atrás hasta
 * el tope del historial) repetiría la pregunta con el aviso del navegador.
 */
export function descartarSinGuardar(): void {
  if (registro) registro.liberado = true
}

/** Cierre o recarga de la pestaña: el navegador pone su propio texto. */
const alDescargar = (e: BeforeUnloadEvent) => {
  if (!haySinGuardar() && !guardandoAhora()) return
  e.preventDefault()
  e.returnValue = ''
}

/**
 * @param activo  La vista tiene algo que se perdería al salir.
 * @param mensaje Qué se pierde, dicho para el diálogo.
 * @param ocupado Hay un guardado en curso (ver guardandoAhora).
 * @returns `liberar()`: llamarlo justo antes de salir tras guardar. El estado de
 *   React se aplica en el siguiente render, y el nav() que sigue al guardado
 *   todavía vería `activo` en true.
 */
export function useAvisoSalida(activo: boolean, mensaje: string, ocupado = false): { liberar: () => void } {
  const propio = useRef<Registro>({ activo, mensaje, ocupado, liberado: false })

  // Se actualiza tras cada render, igual que las refs de useHistoryNav.
  useEffect(() => {
    propio.current.activo = activo
    propio.current.mensaje = mensaje
    propio.current.ocupado = ocupado
  })

  useEffect(() => {
    const r = propio.current
    registro = r
    window.addEventListener('beforeunload', alDescargar)
    return () => {
      if (registro === r) registro = null
      window.removeEventListener('beforeunload', alDescargar)
    }
  }, [])

  return { liberar: () => { propio.current.liberado = true } }
}

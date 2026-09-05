import { useRef } from 'react'

/**
 * Envuelve una acción asíncrona para que no pueda dispararse dos veces.
 *
 * El `if (enviando) return` de siempre no basta: el estado de React se aplica en
 * el siguiente render, así que dos clics dentro del mismo turno del event loop
 * leen el mismo `false` y los dos pasan. El `disabled` del botón llega igual de
 * tarde, porque también depende de ese render. Una ref se cierra en el acto.
 *
 * Importa donde repetir cuesta caro y no se puede deshacer: emitir un e-CF dos
 * veces quema un NCF en la DGII, y un ajuste duplicado mueve el stock dos veces.
 */
export function useAccionUnica<A extends unknown[]>(accion: (...args: A) => Promise<unknown>) {
  const enCurso = useRef(false)

  return async (...args: A): Promise<void> => {
    if (enCurso.current) return
    enCurso.current = true
    try {
      await accion(...args)
    } finally {
      // Se libera aunque el componente ya se haya desmontado (tras navegar al
      // guardar): escribir una ref de un componente muerto no tiene efecto.
      enCurso.current = false
    }
  }
}

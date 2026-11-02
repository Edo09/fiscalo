// Lo que comparten los pasos del asistente: lo que va a la derecha de la cabecera («1 / 3» y, en el primero, la X que sale con el borrador guardado) y la pantalla
// de espera mientras se carga lo guardado del usuario.
import { navegar } from '~/router'
import { Cabecera } from '~/ui/Cabecera'
import { Icon } from '~/ui/Icon'
import { Skeleton } from '~/ui/Skeleton'
import './Paso.css'

/** «1 / 3» y, en el primer paso, la X: sale del asistente (a Facturas) y el borrador se queda. */
export function PasoDerecha(p: { paso: 1 | 2 | 3; salir?: boolean }): JSX.Element {
  return (
    <>
      <span className="paso__numero">{p.paso} / 3</span>
      {p.salir === true && (
        <button type="button" className="paso__salir" aria-label="Salir de Nueva factura" onClick={() => navegar({ id: 'facturas' })}>
          <Icon name="x" />
        </button>
      )}
    </>
  )
}

/** Lo que se ve el primer instante de un paso, mientras se carga el borrador del usuario (el esqueleto sale a los 150 ms, no antes). */
export function PasoCargando(p: { titulo: string }): JSX.Element {
  return (
    <div className="pantalla paso" aria-busy="true">
      <Cabecera titulo={p.titulo} />
      <div className="paso__cuerpo">
        <Skeleton filas={4} alto={64} />
      </div>
    </div>
  )
}

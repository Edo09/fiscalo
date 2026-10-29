// El botón de Express (anexo 8). El primario mide 52 px (es el que va ancho en formularios y barras de acción, al alcance del pulgar) y los demás 48. Tres
// reglas que lo distinguen de un <button> a secas:
//  - Cargando: conserva su ancho (el rótulo sigue ahí, transparente, y el aro de espera va encima) y marca `aria-busy`. No se deshabilita: sigue con el
//    foco, para que quien usa teclado o lector de pantalla no lo pierda a mitad de la operación, pero el clic no hace nada (no se envía dos veces).
//  - Nunca se deshabilita en silencio: con `disabled` y `razon`, la razón se escribe debajo (y es la descripción del botón). Un botón deshabilitado sin
//    `razon` rompe la regla: quien lo use tiene que pasarla.
//  - `type` es "button" salvo que se pida otro: dentro de un <form>, un botón sin tipo envía.
// `razon` sale como hermano del botón, justo después (sin envoltorio, para que el <button> siga siendo hijo directo de su contenedor): ponlo en un
// contenedor de bloque, o de columna si es flex; en una fila flex quedaría al lado y no debajo.
import { useId } from 'react'
import type { ButtonHTMLAttributes, MouseEvent } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import './Button.css'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Por defecto `primario`. `peligro` es el rojo de las acciones que no se deshacen; `texto` no tiene fondo ni borde. */
  variante?: 'primario' | 'secundario' | 'peligro' | 'texto'
  /** Operación en curso: aro de espera, mismo ancho, `aria-busy` y clic ignorado. */
  cargando?: boolean
  /** Por qué está deshabilitado: se muestra debajo mientras `disabled` sea true. */
  razon?: string
  /** Un icono antes del rótulo. */
  icono?: IconName
  /** Todo el ancho del contenedor. */
  bloque?: boolean
}

export function Button(p: ButtonProps): JSX.Element {
  const { variante = 'primario', cargando = false, razon, icono, bloque = false, className, children, onClick, disabled, type, ...resto } = p
  const idRazon = useId()
  const mostrarRazon = disabled === true && razon !== undefined && razon !== ''
  const descripcion = [resto['aria-describedby'], mostrarRazon ? idRazon : undefined].filter((id) => id !== undefined && id !== '').join(' ')
  const clases = ['boton', `boton--${variante}`, bloque ? 'boton--bloque' : '', cargando ? 'boton--cargando' : '', className ?? '']
    .filter((c) => c !== '')
    .join(' ')

  const alHacerClic = (e: MouseEvent<HTMLButtonElement>): void => {
    if (cargando) {
      e.preventDefault() // un botón de envío no envía el formulario
      return
    }
    onClick?.(e)
  }

  return (
    <>
      <button
        type={type ?? 'button'}
        {...resto}
        className={clases}
        disabled={disabled}
        aria-busy={cargando || undefined}
        aria-disabled={cargando || undefined}
        aria-describedby={descripcion === '' ? undefined : descripcion}
        onClick={alHacerClic}
      >
        <span className="boton__contenido">
          {icono !== undefined && <Icon name={icono} size={20} />}
          {children}
        </span>
        {cargando && <span className="boton__espera" aria-hidden="true" />}
      </button>
      {mostrarRazon && (
        <p id={idRazon} className="boton__razon">
          {razon}
        </p>
      )}
    </>
  )
}

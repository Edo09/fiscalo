// El selector a pantalla completa de Express (anexo 8: elegir un cliente o un producto): una capa que ocupa toda la ventana, con arriba, fijo, el botón de
// cerrar y el campo de búsqueda de 48 px, debajo la lista que pone quien lo usa (`children`) con su propio scroll y, si hace falta, un pie fijo sobre el teclado.
// Empuja UNA entrada del historial al abrirse (el atrás del sistema lo cierra: ui/capas.ts) y comparte con las hojas el foco atrapado, el fondo oculto a los
// lectores de pantalla, Esc y el bloqueo de scroll. `onCerrar` lo llaman la X, Esc y el atrás.
//
// Qué hay en la lista, cuánto se espera para buscar (250 ms) y el «Cargar más» de 52 px son de quien lo usa: aquí solo está la capa y el campo. Al ocupar toda la
// ventana no hay «tocar fuera para cerrar» (el `mousedown` de los combobox de la app completa no llega en iOS): se cierra con la X, Esc y el atrás.
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCapa } from './capas'
import { Icon } from './Icon'
import { TextField } from './TextField'
import { useTecladoAbierto } from './viewport'
import './FullScreenPicker.css'

export interface FullScreenPickerProps {
  abierto: boolean
  /** El nombre accesible del selector («Elegir cliente»). Sin él se usa el texto de la búsqueda. No se dibuja. */
  titulo?: string
  /** Lo que dice el campo de búsqueda vacío («Buscar cliente»): también es su nombre para el lector de pantalla. */
  placeholderBusqueda: string
  busqueda: string
  onBusqueda(v: string): void
  onCerrar(): void
  /** La lista y lo que haya bajo el campo: se desplaza solo. */
  children: ReactNode
  /** Lo que queda fijo abajo, sobre el teclado. Una columna: un botón con su `razon` la deja debajo. */
  pie?: ReactNode
}

export function FullScreenPicker(p: FullScreenPickerProps): JSX.Element | null {
  return p.abierto ? <SelectorAbierto {...p} /> : null
}

/** El selector mientras está abierto: montarlo es abrirlo y desmontarlo cerrarlo (ver `useCapa`). */
function SelectorAbierto(p: FullScreenPickerProps): JSX.Element {
  const { titulo, placeholderBusqueda, busqueda, onBusqueda, onCerrar, children, pie } = p
  const raiz = useRef<HTMLDivElement>(null)
  useTecladoAbierto() // mantiene `--kb-inset` al día mientras el selector está abierto: el CSS lo sube con él
  useCapa({ raiz, dialogo: raiz, onCerrar, conHistorial: true })

  const hayPie = pie !== undefined && pie !== null && pie !== false
  return createPortal(
    <div className="selector" ref={raiz} role="dialog" aria-modal="true" aria-label={titulo ?? placeholderBusqueda} tabIndex={-1}>
      <div className="selector__cabecera">
        <button type="button" className="selector__cerrar" aria-label="Cerrar" onClick={onCerrar}>
          <Icon name="x" />
        </button>
        <div className="selector__busqueda">
          <TextField tipo="search" etiqueta={placeholderBusqueda} valor={busqueda} onCambio={onBusqueda} limpiable enterkeyhint="search" autoComplete="off" />
        </div>
      </div>
      <div className={hayPie ? 'selector__cuerpo' : 'selector__cuerpo selector__cuerpo--sin-pie'}>{children}</div>
      {hayPie && <div className="selector__pie">{pie}</div>}
    </div>,
    document.body,
  )
}

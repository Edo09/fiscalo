// La hoja inferior de Express (anexo 8): un panel que sube desde abajo con lo que hay que decidir sin sacar al usuario de la pantalla. De hasta 85 dvh (con
// el vh de respaldo), el asa de 48 px arriba, el cuerpo con su propio scroll y el pie siempre a la vista, por encima del teclado (`--kb-inset`).
//
// Se cierra con el atrás del sistema (la hoja empuja UNA entrada del historial al abrirse: ui/capas.ts), con Esc, arrastrando el asa 80 px hacia abajo, y
// tocando el fondo solo si `cerrarConFondo` (una hoja con datos escritos o un envío en curso no se cierra de un toque perdido). Todas llaman a `onCerrar`: quien
// tiene la hoja decide si pone `abierto` en false, o no (la hoja de sesión vencida no se cierra: el atrás no la deja sin su entrada). El fondo se dibuja
// siempre y tapa la pantalla de detrás (que además queda oculta a los lectores de pantalla): `cerrarConFondo` solo dice si tocarlo cierra.
//
// `historialDeRuta`: la ruta es la dueña de la entrada del historial (Más, `#/mas`): la hoja no empuja nada ni escucha `popstate`, y `onCerrar` es el `atras`
// de la ruta. Quien abre una hoja desde una acción que navega tiene que cerrarla primero y navegar cuando el atrás aterrice: con la hoja abierta `navegar`
// dejaría su entrada enterrada bajo la nueva pantalla y un atrás mostraría la pantalla de antes una vez más.
//
// El cuerpo de la hoja no debe pedir el foco con `autoFocus` (ver `useCapa`): un campo que deba recibirlo al abrir lleva `data-foco-inicial`.
import { useId, useRef } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cierraPorArrastre, useCapa } from './capas'
import { useTecladoAbierto } from './viewport'
import './BottomSheet.css'

export interface BottomSheetProps {
  abierto: boolean
  onCerrar(): void
  titulo: string
  children: ReactNode
  /** Lo que queda fijo abajo (el botón principal): sobre el teclado, con fondo sólido. Una columna: un botón con su `razon` la deja debajo. */
  pie?: ReactNode
  /** Que tocar el fondo cierre la hoja. Por defecto no. */
  cerrarConFondo?: boolean
  /** La ruta es la dueña de la entrada del historial: la hoja no empuja ninguna ni escucha `popstate`. */
  historialDeRuta?: boolean
  /** `alertdialog` en una confirmación (ConfirmSheet); por defecto `dialog`. */
  rol?: 'dialog' | 'alertdialog'
  /** El `id` del texto que describe la hoja (en una confirmación, su consecuencia): el lector de pantalla lo lee al abrir. */
  idDescripcion?: string
}

export function BottomSheet(p: BottomSheetProps): JSX.Element | null {
  return p.abierto ? <HojaAbierta {...p} /> : null
}

/** La hoja mientras está abierta: montarla es abrirla y desmontarla cerrarla, así el foco y el historial sigue cada apertura por separado. */
function HojaAbierta(p: BottomSheetProps): JSX.Element {
  const { onCerrar, titulo, children, pie, cerrarConFondo = false, historialDeRuta = false, rol = 'dialog', idDescripcion } = p
  const idTitulo = useId()
  const raiz = useRef<HTMLDivElement>(null)
  const dialogo = useRef<HTMLDivElement>(null)
  useTecladoAbierto() // mantiene `--kb-inset` al día mientras la hoja está abierta: el CSS la sube con él
  useCapa({ raiz, dialogo, onCerrar, conHistorial: !historialDeRuta })

  // El asa: la hoja sigue al dedo hacia abajo y, al soltar, se cierra si bajó 80 px o más y si no vuelve a su sitio. Eventos de puntero (con `setPointerCapture`
  // el dedo puede salirse del asa sin perder el arrastre) y `touch-action: none` en el asa, para que el navegador no empiece a desplazar la página.
  const arrastre = useRef<{ id: number; desde: number } | null>(null)
  const alBajarElAsa = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    arrastre.current = { id: e.pointerId, desde: e.clientY }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // El puntero ya no está activo (un toque muy rápido): sin captura el arrastre sigue mientras el dedo esté sobre el asa, que es lo que cabe esperar.
    }
    if (dialogo.current !== null) dialogo.current.style.transition = 'none' // sigue al dedo sin retraso
  }
  const alMoverElAsa = (e: PointerEvent<HTMLDivElement>): void => {
    const actual = arrastre.current
    if (actual === null || actual.id !== e.pointerId || dialogo.current === null) return
    dialogo.current.style.transform = `translateY(${Math.max(0, e.clientY - actual.desde)}px)`
  }
  const soltarElAsa = (e: PointerEvent<HTMLDivElement>, cancelado: boolean): void => {
    const actual = arrastre.current
    if (actual === null || actual.id !== e.pointerId) return
    arrastre.current = null
    if (dialogo.current !== null) {
      dialogo.current.style.transition = '' // vuelve a la del CSS: si no se cierra, regresa deslizándose
      dialogo.current.style.transform = ''
    }
    if (!cancelado && cierraPorArrastre(e.clientY - actual.desde)) onCerrar()
  }

  const hayPie = pie !== undefined && pie !== null && pie !== false
  return createPortal(
    <div className="capa" ref={raiz}>
      <div className="capa__fondo" aria-hidden="true" onClick={cerrarConFondo ? onCerrar : undefined} />
      <div className="hoja" ref={dialogo} role={rol} aria-modal="true" aria-labelledby={idTitulo} aria-describedby={idDescripcion} tabIndex={-1}>
        <div
          className="hoja__asa"
          aria-hidden="true"
          onPointerDown={alBajarElAsa}
          onPointerMove={alMoverElAsa}
          onPointerUp={(e) => soltarElAsa(e, false)}
          onPointerCancel={(e) => soltarElAsa(e, true)}
        >
          <span className="hoja__asa-barra" />
        </div>
        <h2 id={idTitulo} className="hoja__titulo">
          {titulo}
        </h2>
        <div className={hayPie ? 'hoja__cuerpo' : 'hoja__cuerpo hoja__cuerpo--sin-pie'}>{children}</div>
        {hayPie && <div className="hoja__pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  )
}

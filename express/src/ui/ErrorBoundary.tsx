import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from './Button'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  /** Lo que dice el botón «Copiar detalle» tras tocarlo: nada, que copió o que no pudo. */
  copia: 'ninguna' | 'copiado' | 'fallo'
  /** El detalle técnico se abre solo si no se pudo copiar, para que se pueda seleccionar a mano. */
  abierto: boolean
}

/** El texto que sale bajo «Detalle técnico» y que copia el botón: el mensaje del error, o el error como texto si no trae mensaje (un `throw 'texto'`). */
const detalleDe = (error: Error): string => error.message || String(error)

/**
 * Copia `texto` al portapapeles y dice si pudo. `navigator.clipboard` solo existe en páginas seguras (HTTPS o localhost) y en navegadores recientes;
 * sin él, o si lo niega, se usa un campo de texto temporal y `execCommand('copy')`. Hay que llamarla desde el toque: los dos caminos lo exigen.
 */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // Sin permiso o sin foco: se prueba el otro camino.
  }
  const previo = document.activeElement
  const campo = document.createElement('textarea')
  campo.value = texto
  campo.setAttribute('readonly', '') // sin esto iOS abre el teclado al seleccionar
  campo.style.position = 'fixed'
  campo.style.top = '0'
  campo.style.opacity = '0'
  document.body.appendChild(campo)
  try {
    campo.select()
    campo.setSelectionRange(0, texto.length) // iOS no selecciona con `select()` a secas
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    campo.remove()
    if (previo instanceof HTMLElement) previo.focus() // el botón que se tocó no pierde el foco
  }
}

/**
 * Límite de error global: un fallo de render deja de vaciar la pantalla.
 *
 * Sin esto, cualquier excepción durante el render (un campo que llega null y se
 * lee con `.length`, un `.map` sobre algo que no es arreglo) desmonta el árbol
 * entero y el usuario se queda mirando una página en blanco, sin nada que
 * reportar y sin forma de saber si fue la app, la red o su sesión. Es el mismo
 * problema que el 500 con el cuerpo vacío del API, en el otro extremo del cable.
 *
 * El mensaje del error se conserva a propósito: quien lo usa está en producción
 * y sin consola abierta, y ese texto es lo único que puede copiar y mandar. Pero
 * va plegado bajo "Detalle técnico": sale en inglés y con jerga de JavaScript,
 * y lo primero que se lee tiene que ser qué pasó y qué hacer.
 *
 * En Express son dos botones de 52 px: «Recargar» y «Copiar detalle» (en el
 * teléfono no hay forma cómoda de seleccionar el texto de abajo y mandarlo).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copia: 'ninguna', abierto: false }

  /** El aviso del botón de copiar dura un rato y vuelve a «Copiar detalle». */
  private temporizador: number | undefined = undefined

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // La traza de componentes dice QUÉ pantalla reventó; el error solo dice qué línea.
    console.error('[ErrorBoundary] fallo de render:', error, info.componentStack)
  }

  componentWillUnmount() {
    window.clearTimeout(this.temporizador)
  }

  private copiarDetalle = async (): Promise<void> => {
    const { error } = this.state
    if (!error) return
    const copiado = await copiarAlPortapapeles(detalleDe(error))
    window.clearTimeout(this.temporizador)
    this.setState((estado) => ({ copia: copiado ? 'copiado' : 'fallo', abierto: estado.abierto || !copiado }))
    this.temporizador = window.setTimeout(() => this.setState({ copia: 'ninguna' }), 3000)
  }

  render() {
    const { error, copia, abierto } = this.state
    if (!error) return this.props.children

    return (
      <div className="limite-error" role="alert">
        <div className="limite-error__contenido">
          <h1 className="limite-error__titulo">La pantalla no se pudo mostrar</h1>
          <p className="limite-error__texto">
            Algo falló dentro de la aplicación. Lo que ya guardaste no se ha perdido. Recarga para volver a intentarlo; si vuelve a pasar, avisa a soporte y
            mándales el detalle técnico.
          </p>
          <details className="limite-error__detalle" open={abierto}>
            <summary>Detalle técnico (para soporte)</summary>
            <pre>{detalleDe(error)}</pre>
          </details>
          <div className="limite-error__acciones">
            <Button onClick={() => window.location.reload()}>Recargar</Button>
            <Button variante="secundario" icono={copia === 'copiado' ? 'check' : 'copy'} onClick={this.copiarDetalle}>
              {copia === 'copiado' ? 'Detalle copiado' : copia === 'fallo' ? 'No se pudo copiar' : 'Copiar detalle'}
            </Button>
          </div>
          {/* El botón cambia de rótulo, pero eso no siempre se anuncia: esto sí. */}
          <p className="sr-only" role="status">
            {copia === 'copiado' ? 'Detalle copiado' : copia === 'fallo' ? 'No se pudo copiar. Selecciona el texto del detalle técnico.' : ''}
          </p>
        </div>
      </div>
    )
  }
}

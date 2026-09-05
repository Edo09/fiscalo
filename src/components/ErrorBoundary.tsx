import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Límite de error global: un fallo de render deja de vaciar la pantalla.
 *
 * Sin esto, cualquier excepción durante el render (un campo que llega null y se
 * lee con `.length`, un `.map` sobre algo que no es arreglo) desmonta el árbol
 * entero y el usuario se queda mirando una página en blanco, sin nada que
 * reportar y sin forma de saber si fue la app, la red o su sesión. Es el mismo
 * problema que el 500 con el cuerpo vacío del API, en el otro extremo del cable.
 *
 * Se muestra el mensaje del error a propósito: quien lo usa está en producción
 * y sin consola abierta, y ese texto es lo único que puede copiar y mandar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // La traza de componentes dice QUÉ pantalla reventó; el error solo dice qué línea.
    console.error('[ErrorBoundary] fallo de render:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg, #f7f7f8)',
          color: 'var(--text, #1a1a1a)',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>La pantalla no se pudo mostrar</h1>
          <p style={{ margin: '0 0 16px', opacity: 0.75, lineHeight: 1.5 }}>
            Los datos que ya guardaste no se han perdido. Recarga para volver a intentarlo; si
            vuelve a pasar, copia el detalle de abajo y mándalo.
          </p>
          <pre
            style={{
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--surface-2, #ececee)',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              margin: '0 0 16px',
            }}
          >
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: 0,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--primary, #1a1a1a)',
              color: 'var(--on-primary, #fff)',
            }}
          >
            Recargar
          </button>
        </div>
      </div>
    )
  }
}

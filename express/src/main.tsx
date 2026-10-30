// El arranque de Express. Orden que importa:
//  1. `./polyfills` PRIMERO, antes de react-dom y de cualquier otro módulo: el login, el cliente HTTP, el cierre de sesión y la vigilancia de versión usan
//     `AbortSignal.timeout`, que no existe en Chrome ni Safari anteriores a 103 y 16 (el piso es Chrome 90 y Safari 14.5). Sin el shim esas pantallas se rompen en
//     silencio en esos teléfonos. Ningún archivo lo comprueba: esta línea es la única garantía.
//  2. Los dos CSS globales, tokens y base. Los de cada componente llegan con él, después, y por eso ganan por cascada.
//  3. Lo de la sesión y los datos, antes de dibujar nada.
//
// `zodConfig` NO se importa aquí ni en App: zod en el arranque revienta el presupuesto del primer pintado, y check-graph lo prohíbe. Lo importa primero cada trozo
// perezoso que trae zod.
import './polyfills'
import './styles/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { enviarSignoutPendiente, iniciarSesionTracking, marcarExpirada, vaciarSignout } from '~/lib/sesion'
import { ErrorBoundary } from '~/ui/ErrorBoundary'
import App from './App'
import { queryClient, vincularLimpieza } from './queryClient'

// La sesión: qué hacer cuando el token desaparece del store (un 401 transitorio no vacía nada; uno que se repite abre la hoja de sesión) y vaciar la caché de datos
// cuando la sesión es de otro. Los dos se instalan una vez, antes de dibujar, y duran lo que la página.
iniciarSesionTracking({ onExpirada: marcarExpirada })
vincularLimpieza(queryClient)

// Los cierres de sesión que quedaron sin enviar (se salió sin red) salen al abrir la app y cada vez que vuelve la red. `vaciarSignout` no lanza y es de una sola vuelta.
void vaciarSignout(enviarSignoutPendiente)
window.addEventListener('online', () => void vaciarSignout(enviarSignoutPendiente))

const raiz = document.getElementById('root')
if (!raiz) throw new Error('No se encontró el elemento #root')

createRoot(raiz).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

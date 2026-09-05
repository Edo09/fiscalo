import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FRESCURA } from './config/cache'
import { useAuthStore } from './stores/auth'
import './styles/styles.css'
// Capa "Bold": restyle global (sidebar ink, tipografía display, KPIs, login).
// Debe importarse DESPUÉS de styles.css: gana por cascada.
import './styles/bold.css'
// Capa responsive: adapta el layout a tablet/móvil/teléfono. Va al final para
// ganar por cascada sobre el layout base de escritorio.
import './styles/responsive.css'
// Para usar el tema "Editorial / Esmeralda", descomenta la siguiente línea:
// import './styles/styles-v2.css'

// Caché de datos de la API.
//
// La frescura de cada dato NO se decide aquí: sale del recurso de la queryKey
// (config/cache.ts), porque una factura cambia sola y un catálogo DGII no. El
// FRESCURA.NORMAL de abajo es solo el respaldo para queries sin recurso conocido.
//
// refetchOnWindowFocus va ENCENDIDO a propósito. Estaba apagado y era la causa
// de tener que recargar a mano: al volver de otra pestaña (el portal de la DGII,
// phpMyAdmin, el correo) la app seguía mostrando lo de antes sin volver a
// preguntar. Solo refetchea lo que ya venció su frescura, y como el dato
// cacheado sigue en pantalla mientras llega el nuevo, no parpadea.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FRESCURA.NORMAL,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

// Al cerrar sesión (logout o 401) se vacía la caché: los datos pertenecen al
// usuario/tenant anterior y no deben verse tras un cambio de cuenta.
useAuthStore.subscribe((state, prev) => {
  if (prev.token !== null && state.token === null) queryClient.clear()
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No se encontró el elemento #root')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

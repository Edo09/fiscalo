import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
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

// Caché de datos de la API: con staleTime de 5 min, cambiar de página y volver
// NO dispara otra petición; se sirve de la caché y solo refetchea si caducó.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
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
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

// FISCALO — POS (pos.fiscalpoint.com.do). Punto de entrada propio: no importa
// App.tsx ni el cliente HTTP de app.* (que va atado a la sesion del usuario).
// Contrato del backend: api-gratex docs/api/pos.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PosApp } from './PosApp'
import { aplicarTema, leerTema } from './tema'
import { aplicarTamano, leerTamano } from './tamano'
import '../styles/styles.css'
import '../styles/bold.css'
import './pos.css'

// El tema del equipo antes de pintar nada: con el oscuro, la página no destella en blanco.
aplicarTema(leerTema())
// Y su tamaño de pantalla, para que no se vea un instante al 100 % y salte.
aplicarTamano(leerTamano())

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No se encontró el elemento #root')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <PosApp />
    </ErrorBoundary>
  </StrictMode>,
)

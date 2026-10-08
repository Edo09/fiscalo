// FISCALO — POS (pos.fiscalpoint.com.do). Punto de entrada propio: no importa
// App.tsx ni el cliente HTTP de app.* (que va atado a la sesion del usuario).
// Contrato del backend: api-gratex docs/api/pos.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PosApp } from './PosApp'
import '../styles/styles.css'
import '../styles/bold.css'
import './pos.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No se encontró el elemento #root')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <PosApp />
    </ErrorBoundary>
  </StrictMode>,
)

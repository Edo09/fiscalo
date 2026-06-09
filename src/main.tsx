import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/styles.css'
// Para usar el tema "Editorial / Esmeralda", descomenta la siguiente línea:
// import './styles/styles-v2.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No se encontró el elemento #root')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

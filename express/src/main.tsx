import { createRoot } from 'react-dom/client'

// Página provisional: el andamio solo comprueba que el build produce algo. La app real la reemplaza.
const raiz = document.getElementById('root')
if (!raiz) throw new Error('No se encontró el elemento #root')

createRoot(raiz).render(<h1>Fiscalpoint Express</h1>)

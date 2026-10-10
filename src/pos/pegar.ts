// Pegar (Ctrl+V o el menú del navegador) en los teclados del POS: monto, RNC,
// cantidad, conteo de la gaveta y PIN. Los teclados no son campos de texto:
// muestran el número en un visor y escuchan las teclas en la ventana, así que
// pegar no hacía nada. Cómo se limpia lo pegado: montos.ts (pegarMonto, ...).
import { useEffect, useRef } from 'react'

/**
 * Escucha el pegado en la ventana mientras `activo` (solo el teclado a la vista,
 * igual que su teclado físico) y entrega el texto. Lo que se pega dentro de un
 * campo de texto (el buscador, una nota) lo maneja ese campo.
 */
export function usePegar(alPegar: (texto: string) => void, activo = true): void {
  // El manejador vigente sin volver a suscribirse en cada render.
  const ref = useRef(alPegar)
  useEffect(() => { ref.current = alPegar })
  useEffect(() => {
    if (!activo) return
    const h = (e: ClipboardEvent) => {
      const destino = e.target instanceof Element ? e.target : null
      if (destino?.closest('input, textarea, [contenteditable="true"]')) return
      const texto = e.clipboardData?.getData('text') ?? ''
      if (texto.trim() === '') return
      e.preventDefault()
      ref.current(texto)
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [activo])
}

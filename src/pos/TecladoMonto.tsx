// Teclado de montos en pesos (efectivo recibido, fondo del turno). Táctil y
// con el teclado físico; el texto se valida aquí: hasta 7 cifras y 2 decimales.
import { useCallback, useEffect } from 'react'
import { Icon } from '@/components/ui'
import { teclearMonto } from './montos'

interface Props {
  valor: string
  onCambio: (texto: string) => void
  /** Escuchar el teclado físico (solo el teclado visible a la vez). */
  fisico?: boolean
}

export function TecladoMonto({ valor, onCambio, fisico = true }: Props) {
  const teclear = useCallback((t: string) => onCambio(teclearMonto(valor, t)), [valor, onCambio])

  useEffect(() => {
    if (!fisico) return
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) teclear(e.key)
      else if (e.key === '.' || e.key === ',' || e.key === 'Decimal') teclear('.')
      else if (e.key === 'Backspace') teclear('⌫')
      else if (e.key === 'Delete') teclear('C')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fisico, teclear])

  return (
    <div className="pos-teclado pos-teclado-monto">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((t) => (
        <button key={t} type="button" className={'pos-tecla' + (t === '⌫' ? ' secundaria' : '')}
          onClick={() => teclear(t)} aria-label={t === '⌫' ? 'Borrar' : t === '.' ? 'Punto decimal' : t}>
          {t === '⌫' ? <Icon name="delete" size={24} /> : t}
        </button>
      ))}
    </div>
  )
}

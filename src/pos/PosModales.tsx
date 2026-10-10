// Diálogos táctiles del POS: teclado de cantidad (V1) y confirmación.
// Botones grandes, sin hover; también responden al teclado físico.
import { useEffect, useState, type ReactNode } from 'react'
import { Btn, Icon } from '@/components/ui'
import { fmtCantidad } from '@/lib/format'
import { leerCantidad } from './montos'
import type { LineaCarrito } from './carrito'
import { usePegar } from './pegar'

/** Fondo oscuro + panel. Tocar fuera cierra (si `onCerrar` lo permite). */
/**
 * Fondo y caja de todos los diálogos del POS. Tocar fuera NO cierra: un toque
 * de más en la pantalla táctil (o el cliente apoyando la mano) cerraba el cobro
 * a medias. Cada diálogo se cierra solo con sus botones.
 */
export function Overlay({ children, ancho }: { children: ReactNode; ancho?: number }) {
  return (
    <div className="pos-overlay">
      <div className="pos-modal" role="dialog" aria-modal="true" style={ancho ? { maxWidth: ancho } : undefined}>{children}</div>
    </div>
  )
}

/** Máximo de caracteres de una cantidad: 99999.99 */
const MAX_LARGO = 8

/** Una tecla en el campo de cantidad: decimales solo si la unidad los admite, hasta 2. */
function teclearCantidad(actual: string, t: string, decimales: boolean): string {
  if (t === '⌫') return actual.slice(0, -1)
  if (actual.length >= MAX_LARGO) return actual
  if (t === '.') {
    if (!decimales || actual.includes('.')) return actual
    return actual === '' ? '0.' : actual + '.'
  }
  const [, dec] = actual.split('.')
  if (dec !== undefined && dec.length >= 2) return actual
  return actual === '0' ? t : actual + t
}

export function CantidadModal({ linea, onAceptar, onCerrar }: {
  linea: LineaCarrito
  onAceptar: (cantidad: number) => void
  onCerrar: () => void
}) {
  const [texto, setTexto] = useState('')
  const valor = leerCantidad(texto, linea.decimales)

  const teclear = (t: string) => setTexto((actual) => teclearCantidad(actual, t, linea.decimales))
  // Pegar: reemplaza la cantidad, tecla por tecla con las mismas reglas ("1,5" no
  // es 1.5: la coma es de miles y se descarta, como en los montos).
  usePegar((pegado) => setTexto([...pegado.replace(/[^\d.]/g, '')].reduce((a, t) => teclearCantidad(a, t, linea.decimales), '')))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) teclear(e.key)
      else if (e.key === '.' || e.key === ',') teclear('.')
      else if (e.key === 'Backspace') teclear('⌫')
      else if (e.key === 'Escape') onCerrar()
      else if (e.key === 'Enter' && valor !== null) onAceptar(valor)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', linea.decimales ? '.' : '', '0', '⌫']

  return (
    <Overlay>
      <div className="pos-modal-cab">
        <div>
          <small>Cantidad</small>
          <b>{linea.nombre}</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <div className={'pos-cantidad-visor' + (texto === '' ? ' vacio' : '')}>
        {texto === '' ? fmtCantidad(linea.cantidad) : texto}
      </div>
      <div className="pos-cantidad-ayuda">
        {texto !== '' && valor === null && !texto.endsWith('.')
          ? <span className="error">Cantidad no válida</span>
          : linea.decimales ? 'Admite hasta 2 decimales' : 'Solo cantidades enteras'}
      </div>
      <div className="pos-teclado">
        {teclas.map((t, i) => t === ''
          ? <span key={i} />
          : (
            <button key={i} type="button" className={'pos-tecla' + (t === '⌫' ? ' secundaria' : '')}
              onClick={() => teclear(t)} aria-label={t === '⌫' ? 'Borrar' : t}>
              {t === '⌫' ? <Icon name="delete" size={24} /> : t}
            </button>
          ))}
      </div>
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Cancelar</Btn>
        <Btn variant="primary" className="pos-boton-grande" icon="check" disabled={valor === null}
          onClick={() => { if (valor !== null) onAceptar(valor) }}>Aceptar</Btn>
      </div>
    </Overlay>
  )
}

export function ConfirmarModal({ titulo, texto, confirmar, onConfirmar, onCerrar }: {
  titulo: string
  texto: ReactNode
  confirmar: string
  onConfirmar: () => void
  onCerrar: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCerrar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  return (
    <Overlay>
      <div className="pos-modal-cab">
        <div><b>{titulo}</b></div>
      </div>
      <p className="pos-sub" style={{ margin: '4px 0 20px' }}>{texto}</p>
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>No</Btn>
        <Btn variant="danger" className="pos-boton-grande" onClick={onConfirmar}>{confirmar}</Btn>
      </div>
    </Overlay>
  )
}

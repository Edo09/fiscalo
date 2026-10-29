// El esqueleto de carga (anexo 8): bloques grises con la altura de lo que va a llegar (`alto`, una tarjeta de 64 px por defecto; `filas` bloques). No se dibuja
// en los primeros 150 ms (`RETRASO_ESQUELETO_MS`): una lectura que contesta rápido no deja un parpadeo gris. El brillo que lo cruza es un `transform`, que
// no obliga a repintar; con movimiento reducido (base.css) se queda quieto. Es decoración (`aria-hidden`): que algo carga lo dice quien lo usa, con
// `aria-busy` en su contenedor.
import { useEffect, useState } from 'react'
import { RETRASO_ESQUELETO_MS } from '~/config'
import './Skeleton.css'

export function Skeleton(p: { alto?: number; filas?: number }): JSX.Element | null {
  const { alto = 64, filas = 1 } = p
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const espera = window.setTimeout(() => setVisible(true), RETRASO_ESQUELETO_MS)
    return () => window.clearTimeout(espera)
  }, [])

  if (!visible) return null
  return (
    <div className="esqueleto" aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto__fila" style={{ height: alto }} />
      ))}
    </div>
  )
}

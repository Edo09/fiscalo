// La cabecera de una pantalla (anexo 5.5): 48 px, pegada arriba al desplazar (`position: sticky`), con el título, un «Volver» opcional y un hueco a la
// derecha para lo que cada pantalla ponga (el botón de actualizar, la etiqueta de ambiente). El botón de volver mide 48x48.
// `atras` dice adónde cae «Volver» si no hay nada de la app debajo en el historial (un enlace directo, una recarga): con una ruta, esa; con `'historial'`,
// el inicio (Facturas). Con historial debajo, las dos retroceden una entrada y no agregan otra (router.ts `atras`), y nunca sacan al usuario de la app.
import type { ReactNode } from 'react'
import { atras as irAtras } from '~/router'
import type { Ruta } from '~/router'
import { Icon } from './Icon'
import './Cabecera.css'

export function Cabecera(p: { titulo: string; atras?: Ruta | 'historial'; derecha?: ReactNode }): JSX.Element {
  const { titulo, atras, derecha } = p
  return (
    <header className="cabecera">
      {atras !== undefined && (
        <button type="button" className="cabecera__atras" aria-label="Volver" onClick={() => irAtras(atras === 'historial' ? { id: 'facturas' } : atras)}>
          <Icon name="chevron-left" />
        </button>
      )}
      <h1 className="cabecera__titulo">{titulo}</h1>
      {derecha !== undefined && <div className="cabecera__derecha">{derecha}</div>}
    </header>
  )
}

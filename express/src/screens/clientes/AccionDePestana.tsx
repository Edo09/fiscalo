// La acción principal de una pantalla de pestaña (Clientes, Productos, el detalle de un cliente): «+ Nuevo cliente», «Facturar a este cliente». Es la `StickyActionBar` de siempre, pero
// POSADA SOBRE la barra inferior (que sigue a la vista en estas pantallas) y no encima de ella; con el teclado abierto la barra inferior se esconde (App) y la acción vuelve a ir
// pegada al teclado, que es lo que hace la barra sola. Se pone como último hijo de la pantalla.
import type { ReactNode } from 'react'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { useTecladoAbierto } from '~/ui/viewport'
import './AccionDePestana.css'

export function AccionDePestana(p: { children: ReactNode }): JSX.Element {
  const teclado = useTecladoAbierto()
  return (
    <div className={teclado ? undefined : 'accion-sobre-barra'}>
      <StickyActionBar>{p.children}</StickyActionBar>
    </div>
  )
}

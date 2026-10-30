// La barra de acción anclada abajo de Express (anexo 5.5 y 8): la acción principal (un botón de 52 px, ancho) de una pantalla de varios pasos, siempre a la mano.
// Fondo sólido, sin desenfoque. Sube con el teclado (`--kb-inset`: ver ui/viewport.ts) y nunca queda detrás de él: en un formulario, el teclado numérico de iOS
// no tiene tecla de Intro, y esta acción es la salida. Es lo único que acompaña al teclado: la barra inferior sí se esconde con él.
//
// Es `position: fixed` y deja en el flujo un hueco del mismo alto (se mide con un `ResizeObserver`: con la razón de un botón deshabilitado debajo, o con dos
// acciones, el alto cambia), así lo último de la pantalla no queda tapado y la pantalla no tiene que saber cuánto mide. Se pone como último hijo de la pantalla.
// Los hijos van en una columna: un `Button` deshabilitado con `razon` deja su razón debajo, y un botón suelto ocupa todo el ancho.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTecladoAbierto } from './viewport'
import './StickyActionBar.css'

export function StickyActionBar(p: { children: ReactNode }): JSX.Element {
  useTecladoAbierto() // mantiene `--kb-inset` al día mientras la barra está en pantalla: el CSS la sube con él
  const barra = useRef<HTMLDivElement>(null)
  const [alto, setAlto] = useState(0)

  useLayoutEffect(() => {
    const el = barra.current
    if (el === null) return
    const medir = (): void => setAlto(el.offsetHeight)
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  return (
    <>
      <div className="accion-hueco" style={{ height: alto }} aria-hidden="true" />
      <div className="accion-anclada" ref={barra}>
        {p.children}
      </div>
    </>
  )
}

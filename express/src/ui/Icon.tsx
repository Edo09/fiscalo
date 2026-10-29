// Un icono de la lista cerrada de `iconos.ts` (26 de lucide, generados: el paquete no entra al bundle). Es decorativo salvo que se le dé `label`: sin ella
// `aria-hidden` lo saca de los lectores de pantalla (el texto de al lado ya dice qué es) y con ella es una imagen con ese nombre, para el botón que solo
// tiene el icono. Viewbox de 24, `currentColor` (toma el color del texto que lo rodea) y trazo de 2, como en lucide.
import { createElement } from 'react'
import { ICONOS } from './iconos'
import type { IconName } from './iconos'
import './Icon.css'

export type { IconName }

export function Icon(p: { name: IconName; size?: number; label?: string }): JSX.Element {
  const { name, size = 24, label } = p
  // `nav.ts` y `etiquetas.ts` escriben los nombres como texto y el compilador no los comprueba (tests/iconos.test.ts sí): con uno que no exista,
  // o el vacío de una fila sin icono, queda un cuadro vacío del mismo tamaño y no una pantalla caída.
  const nodos = ICONOS[name] ?? []
  const accesible = label === undefined || label === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }
  return (
    <svg
      className="icono"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...accesible}
    >
      {nodos.map(([etiqueta, atributos], i) => createElement(etiqueta, { key: i, ...atributos }))}
    </svg>
  )
}

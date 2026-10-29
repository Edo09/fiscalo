// El chip del estado DGII de una factura (anexo 8): 28 px, con el color, el icono y el texto que dice `etiquetaDe` (lib/etiquetas). Las tres cosas juntas:
// el color nunca va solo. Lo que no es una factura aceptada, un estado que no se conoce, el null y el vacío incluidos, sale como «Sin confirmar»: ante la
// duda el chip no dice «Aceptada». `tipoEcf` se acepta y en esta versión no cambia nada (contratos 4.4).
import { etiquetaDe } from '~/lib/etiquetas'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import './StatusChip.css'

export function StatusChip(p: { estado: string | null | undefined; tipoEcf?: string }): JSX.Element {
  const { texto, tono, icono } = etiquetaDe(p.estado, p.tipoEcf)
  return (
    <span className={`chip-estado chip-estado--${tono}`}>
      {/* `etiquetaDe` da el nombre como texto; tests/iconos.test.ts comprueba que el de cada estado exista en la tabla. */}
      <Icon name={icono as IconName} size={16} />
      <span>{texto}</span>
    </span>
  )
}

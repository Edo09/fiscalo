// Avisos de una línea de Cobros: un error del servidor dentro de un modal, o una nota informativa.
import type { ReactNode } from 'react'
import { Icon } from '@/components/ui'

export function Aviso({ tono = 'info', children }: { tono?: 'info' | 'error' | 'exito'; children: ReactNode }) {
  return (
    <div className={'cobros-aviso' + (tono === 'info' ? '' : ` ${tono}`)} role={tono === 'error' ? 'alert' : undefined}>
      <Icon name={tono === 'error' ? 'alert-circle' : tono === 'exito' ? 'check-circle' : 'info'} size={15} />
      <span>{children}</span>
    </div>
  )
}

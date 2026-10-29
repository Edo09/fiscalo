// Un aviso en línea (anexo 8): lo que hay que decirle al usuario sin sacarlo de la pantalla («No se pudo cargar la lista.», «Sin conexión»). Cada tono
// tiene su color, su icono y su texto: el color nunca va solo. `danger` y `warning` son `role="alert"` (el lector de pantalla los lee en cuanto
// aparecen); `info` y `ok` son `status` (los lee cuando termina lo que estaba diciendo). La acción («Reintentar») es un botón de 48 px debajo del texto.
import type { ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import './Banner.css'

type Tono = 'info' | 'warning' | 'danger' | 'ok'

/** El icono de cada tono. Los cuatro se distinguen por la forma además del color (círculo con signo, triángulo, círculo con equis, círculo con marca). */
const ICONO: Record<Tono, IconName> = { info: 'circle-alert', warning: 'triangle-alert', danger: 'circle-x', ok: 'circle-check' }

export function Banner(p: { tono: Tono; titulo?: string; children?: ReactNode; accion?: { etiqueta: string; onClick(): void } }): JSX.Element {
  const { tono, titulo, children, accion } = p
  return (
    <div className={`banner banner--${tono}`} role={tono === 'danger' || tono === 'warning' ? 'alert' : 'status'}>
      <Icon name={ICONO[tono]} />
      <div className="banner__cuerpo">
        {titulo !== undefined && titulo !== '' && <p className="banner__titulo">{titulo}</p>}
        <div className="banner__texto">{children}</div>
        {accion !== undefined && (
          <div className="banner__accion">
            <Button variante="secundario" onClick={accion.onClick}>
              {accion.etiqueta}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

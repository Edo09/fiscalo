// Lo que se ve cuando no hay nada que mostrar (anexo 5.5): un icono, qué pasa y, si hay algo que hacer, la acción principal («Crear primera factura»). La
// acción es un botón primario de 52 px: una pantalla vacía no debe dejar al usuario sin saber qué sigue.
import { Button } from './Button'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import './EmptyState.css'

export function EmptyState(p: { icono: IconName; titulo: string; texto?: string; accion?: { etiqueta: string; onClick(): void } }): JSX.Element {
  const { icono, titulo, texto, accion } = p
  return (
    <div className="vacio">
      <div className="vacio__icono">
        <Icon name={icono} size={32} />
      </div>
      <h2 className="vacio__titulo">{titulo}</h2>
      {texto !== undefined && texto !== '' && <p className="vacio__texto">{texto}</p>}
      {accion !== undefined && (
        <div className="vacio__accion">
          <Button bloque onClick={accion.onClick}>
            {accion.etiqueta}
          </Button>
        </div>
      )}
    </div>
  )
}

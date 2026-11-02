// La unidad de medida de un producto: una fila que muestra la de ahora y abre el selector a pantalla completa con el catálogo de la DGII (con su búsqueda y la etiqueta «acepta fracciones» en las que dejan
// cantidades como 1.5: metro, kilo, litro). Sin el catálogo (no llegó, o la carga falló) solo se ofrece «Unidad», la de siempre: la que el producto ya tenía se conserva aunque el catálogo no la traiga.
import { useMemo, useState } from 'react'
import type { UnidadMedida } from '@/api/types'
import { normalizar } from '@/pos/montos'
import { nombreDeUnidad, opcionesUnidad } from '~/lib/productos'
import { FullScreenPicker } from '~/ui/FullScreenPicker'
import { Icon } from '~/ui/Icon'
import './Productos.css'

export function SelectorUnidad(p: { valor: string; catalogo: UnidadMedida[]; onCambio(id: string): void; error?: string }): JSX.Element {
  const { valor, catalogo, onCambio, error } = p
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const opciones = useMemo(() => opcionesUnidad(catalogo), [catalogo])
  const filtro = normalizar(busqueda)
  const visibles = filtro === '' ? opciones : opciones.filter((o) => normalizar(o.descripcion).includes(filtro))
  const actual = opciones.find((o) => o.id === valor)
  const cerrar = (): void => {
    setAbierto(false)
    setBusqueda('')
  }
  return (
    <div className="producto-form__grupo">
      <span className="producto-form__etiqueta">Unidad</span>
      <button type="button" className="unidad-actual" aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <span className="unidad-actual__texto">{actual?.descripcion ?? (nombreDeUnidad(catalogo, valor) || 'Unidad')}</span>
        {actual?.fracciones === true && <span className="unidad__etiqueta">acepta fracciones</span>}
        <Icon name="chevron-right" />
      </button>
      {error !== undefined && (
        <p className="producto-form__error" role="alert">
          {error}
        </p>
      )}
      <FullScreenPicker abierto={abierto} titulo="Unidad de medida" placeholderBusqueda="Buscar unidad..." busqueda={busqueda} onBusqueda={setBusqueda} onCerrar={cerrar}>
        {visibles.length === 0 ? (
          <p className="unidades__vacio">No hay unidades con ese nombre.</p>
        ) : (
          <ul className="unidades">
            {visibles.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="unidad"
                  aria-current={o.id === valor ? 'true' : undefined}
                  onClick={() => {
                    onCambio(o.id)
                    cerrar()
                  }}
                >
                  <span className="unidad__texto">{o.descripcion}</span>
                  {o.fracciones && <span className="unidad__etiqueta">acepta fracciones</span>}
                  {o.id === valor && <Icon name="check" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </FullScreenPicker>
    </div>
  )
}

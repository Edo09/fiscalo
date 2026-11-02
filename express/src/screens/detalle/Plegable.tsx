// Una sección que se despliega (anexo 6.3: «Líneas (2)», «Datos DGII y QR»): el título es un botón de 48 px de alto con su chevrón, `aria-expanded` y `aria-controls`. Cerrada por omisión, y su contenido no
// se dibuja mientras está cerrada: lo que tiene que pedir al abrirse (los datos del recibo) no pide nada hasta que alguien la abre.
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '~/ui/Icon'
import './Plegable.css'

export function Plegable(p: { titulo: string; children: ReactNode }): JSX.Element {
  const [abierta, setAbierta] = useState(false)
  const idCuerpo = useId()
  return (
    <section className="plegable">
      <h2 className="plegable__titulo">
        <button type="button" className="plegable__boton" aria-expanded={abierta} aria-controls={idCuerpo} onClick={() => setAbierta(!abierta)}>
          <span className="plegable__rotulo">{p.titulo}</span>
          <Icon name={abierta ? 'chevron-down' : 'chevron-right'} />
        </button>
      </h2>
      {abierta && (
        <div id={idCuerpo} className="plegable__cuerpo">
          {p.children}
        </div>
      )}
    </section>
  )
}

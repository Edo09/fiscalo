// El campo de búsqueda de Facturas (anexo 6.2): «Buscar e-NCF o cliente». El servidor busca en e-NCF, cliente, RNC, teléfono, correo y descripción de las líneas; aquí solo se
// escribe. Es `type="search"` con la tecla «Buscar» del teléfono (`enterKeyHint`), un botón de borrar de 48 px y 16 px de letra (a menos, iOS acerca la página al enfocarlo).
//
// Lo escrito vive en el campo y se pasa al hash (`q`, con reemplazo) cuando se deja de teclear `DEBOUNCE_BUSQUEDA_MS`: la ruta es la única fuente de verdad de la búsqueda
// (la lista se pide con ella) y teclear no llena el historial. Intro la aplica en el acto y cierra el teclado, para ver los resultados. Dos direcciones que se cruzan,
// y cómo no se pisan:
//  - campo a ruta: la espera guarda lo último que este campo pidió (`pedido`), y el efecto no pide lo que ya está pedido ni lo que ya dice la ruta;
//  - ruta a campo: un `q` de la ruta que NO es lo último que este campo pidió lo cambió otro (la barra que borra la búsqueda al volver a tocar Facturas, «Borrar búsqueda»,
//    un atrás del historial) y el campo lo adopta. Si se adoptara cualquier cambio, lo que se siguiera tecleando mientras llega el eco de la ruta se perdería.
// `onEscribiendo` dice si hay texto en el campo, ya, sin esperar a la ruta: con él la pantalla pliega los tiles y los avisos en cuanto se empieza a teclear.
import { useEffect, useRef, useState } from 'react'
import { DEBOUNCE_BUSQUEDA_MS } from '~/config'
import { TextField } from '~/ui/TextField'

export function Busqueda(p: { q: string; onBuscar(q: string): void; onEscribiendo(hayTexto: boolean): void }): JSX.Element {
  const { q, onBuscar, onEscribiendo } = p
  const [texto, setTexto] = useState(q)
  const pedido = useRef(q)
  // La última `onBuscar` de la pantalla, no la del dibujo en que se armó la espera: con los filtros que haya al cumplirse, sin reiniciar la espera en cada dibujo.
  const ultimaBusqueda = useRef(onBuscar)
  useEffect(() => {
    ultimaBusqueda.current = onBuscar
  })

  useEffect(() => {
    if (q === pedido.current) return
    pedido.current = q
    setTexto(q)
  }, [q])

  useEffect(() => {
    if (texto === pedido.current) return
    const espera = window.setTimeout(() => {
      if (texto === pedido.current) return
      pedido.current = texto
      ultimaBusqueda.current(texto)
    }, DEBOUNCE_BUSQUEDA_MS)
    return () => window.clearTimeout(espera)
  }, [texto])

  useEffect(() => {
    onEscribiendo(texto.trim() !== '')
  }, [texto, onEscribiendo])

  const buscarYa = (): void => {
    if (texto !== pedido.current) {
      pedido.current = texto
      ultimaBusqueda.current(texto)
    }
    // Cierra el teclado: con él abierto la barra inferior no está y los resultados quedan tapados a medias.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return (
    <TextField
      etiqueta="Buscar e-NCF o cliente"
      tipo="search"
      modoInput="search"
      enterkeyhint="search"
      autoComplete="off"
      autoCapitalize="none"
      limpiable
      valor={texto}
      onCambio={setTexto}
      onEnter={buscarYa}
    />
  )
}

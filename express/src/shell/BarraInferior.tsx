// La barra inferior de Express (anexo 5.1): cinco lugares en orden fijo (Facturas, Clientes, Facturar, Productos, Más), 56 px más el área segura, sin objetivo táctil
// de menos de 48x48. Qué pestañas salen lo decide `construirBarra` (nav.ts) y cómo se reparten, `mitadesBarra`: dos mitades de igual ancho alrededor del botón
// elevado de Facturar, así queda centrado aunque falte Clientes o Productos. Que una pestaña no salga no es un control de seguridad (lo es la guardia de rutas).
//
// La pestaña activa se ve por cuatro cosas, nunca solo por el color: el acento, la letra en negrita, un indicador de 3x24 px y `aria-current="page"`. Es la
// pestaña de la pantalla en que se está: el detalle de una factura es de Facturas, un cliente es de Clientes, Más y sus pantallas son de Más.
//
// Qué hace un toque:
//  - una pestaña distinta: `irATab` (router.ts) decide si empuja una entrada, reemplaza la actual o retrocede, y `precargarRuta` baja el trozo de su pantalla en el
//    `pointerdown`, antes de que el dedo suba;
//  - la pestaña en cuya raíz ya se está: sube al principio y, en Facturas, borra la búsqueda `q` (los filtros se quedan);
//  - desde una pantalla de la pestaña (un detalle) o desde otra: va a su raíz, como cualquier cambio de pestaña;
//  - Más abre la hoja: empuja `#/mas` (la hoja es una ruta; `accionHoja('abrir')`, cuyo resultado es siempre empujar).
// El botón elevado lleva el punto del borrador (`borrador`) y, mientras hay una emisión en vuelo (`enviando`), un aro que gira (solo CSS, con `aria-busy`).
// La insignia con la cuenta de Facturas y el punto de Más (tarea 19) se anclan al contenedor del icono (`.barra__icono`).
//
// App no la dibuja en el asistente (que tiene su propia barra de acción), con el teclado abierto, en Login ni en la pantalla de edición.
import { useId } from 'react'
import { useRuta, irATab, navegar } from '~/router'
import type { Ruta } from '~/router'
import type { Entitlements } from '~/entitlements'
import { useIndicadoresFacturar } from '~/lib/indicadores'
import { construirBarra, mitadesBarra } from '~/nav'
import type { Slot, SlotId } from '~/nav'
import { precargarRuta } from '~/screens/registro'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import './BarraInferior.css'

/** La pestaña a la que pertenece una ruta (anexo 5.1): su raíz y las pantallas que cuelgan de ella. El asistente es del botón central; Más y sus pantallas, de Más. */
function pestanaDe(r: Ruta): SlotId {
  switch (r.id) {
    case 'facturas':
    case 'factura':
    case 'anular':
      return 'facturas'
    case 'clientes':
    case 'cliente-nuevo':
    case 'cliente':
      return 'clientes'
    case 'productos':
    case 'producto':
      return 'productos'
    case 'facturar':
    case 'facturar-productos':
    case 'facturar-revisar':
    case 'facturar-resultado':
      return 'facturar'
    case 'mas':
    case 'mas-empresa':
    case 'mas-numeracion':
    case 'mas-usuarios':
      return 'mas'
  }
}

/** Una pestaña de las dos mitades: el icono de 24 px y la etiqueta de 12/600 en una línea (con puntos suspensivos si no cabe; el nombre completo va en `aria-label`). */
function Pestana(p: { slot: Slot; activa: boolean; onTocar(slot: Slot): void }): JSX.Element {
  const { slot, activa, onTocar } = p
  return (
    <button
      type="button"
      className={activa ? 'barra__tab barra__tab--activa' : 'barra__tab'}
      aria-label={slot.etiqueta}
      aria-current={activa ? 'page' : undefined}
      onPointerDown={() => precargarRuta(slot.id)}
      onClick={() => onTocar(slot)}
    >
      <span className="barra__icono">
        {/* `nav.ts` escribe los nombres de icono como texto; tests/nav.test.ts y tests/iconos.test.ts comprueban que cada uno exista en la tabla. */}
        <Icon name={slot.icono as IconName} />
      </span>
      <span className="barra__etiqueta">{slot.etiqueta}</span>
    </button>
  )
}

export function BarraInferior(p: { entitlements: Entitlements }): JSX.Element {
  const ruta = useRuta()
  const idBorrador = useId()
  const { borrador, enviando } = useIndicadoresFacturar()
  const slots = construirBarra(p.entitlements)
  const { izq, der } = mitadesBarra(slots)
  const central = slots.find((slot) => slot.central)
  const activa = pestanaDe(ruta)

  const tocar = (slot: Slot): void => {
    if (slot.id === 'mas') {
      navegar({ id: 'mas' })
      return
    }
    // Volver a tocar la pestaña en cuya raíz se está: arriba del todo, y en Facturas sin la búsqueda (los chips de estado y de tipo se quedan).
    if (ruta.id === slot.id) {
      window.scrollTo(0, 0)
      if (ruta.id === 'facturas' && ruta.q !== undefined) {
        const sinBusqueda: Extract<Ruta, { id: 'facturas' }> = { id: 'facturas' }
        if (ruta.estado !== undefined) sinBusqueda.estado = ruta.estado
        if (ruta.tipo !== undefined) sinBusqueda.tipo = ruta.tipo
        navegar(sinBusqueda, { reemplazar: true })
      }
      return
    }
    irATab({ id: slot.id })
  }

  return (
    <nav className="barra" aria-label="Principal">
      <div className="barra__mitad">
        {izq.map((slot) => (
          <Pestana key={slot.id} slot={slot} activa={activa === slot.id} onTocar={tocar} />
        ))}
      </div>
      {central !== undefined && (
        <div className="barra__centro">
          <button
            type="button"
            className="barra__central"
            aria-label="Nueva factura"
            aria-describedby={borrador ? idBorrador : undefined}
            aria-busy={enviando || undefined}
            onPointerDown={() => precargarRuta(central.id)}
            onClick={() => tocar(central)}
          >
            <Icon name={central.icono as IconName} size={28} />
            {borrador && <span className="barra__punto" aria-hidden="true" />}
          </button>
          {/* El punto del borrador no se ve con un lector de pantalla: su texto va aparte y es la descripción del botón. */}
          {borrador && (
            <span id={idBorrador} className="sr-only">
              Hay un borrador sin emitir
            </span>
          )}
        </div>
      )}
      <div className="barra__mitad">
        {der.map((slot) => (
          <Pestana key={slot.id} slot={slot} activa={activa === slot.id} onTocar={tocar} />
        ))}
      </div>
    </nav>
  )
}

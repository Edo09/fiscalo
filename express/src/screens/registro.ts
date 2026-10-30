// El registro de pantallas: qué componente dibuja cada ruta (el shell lo busca con `registro[ruta.id]` y le pasa su ruta como propiedad, `<Pantalla ruta={...} />`: una pantalla no
// lee `useRuta`, que con Más abierto dice `mas`). `mas` no está: es una hoja que el shell dibuja sobre la última pantalla (screens/Mas.tsx), no una pantalla. Cada entrada empieza como
// el relleno `Pendiente` y los planes la reemplazan una por una, sin tocar las demás:
//  - una pantalla del arranque (Facturas) se importa y se pone en su entrada de `registro`. Ella y sus piezas piden `precargarRuta` a `./precarga` y nunca a este archivo: este
//    importa la pantalla, y pedírselo a él sería un ciclo de imports (tests/precarga.test.ts lo vigila);
//  - una perezosa se agrega a CARGADORES, en `./precarga` (`factura: () => import('./Detalle')`): desde ahí `registro` la sirve con `lazy` y `precargarRuta` baja ese mismo trozo
//    antes de que se toque, así que no hay que tocar su entrada aquí.
import { lazy } from 'react'
import type { Ruta } from '~/router'
import Facturas from './Facturas'
import Pendiente from './Pendiente'
import { CARGADORES } from './precarga'
import type { Pantalla } from './precarga'

// El shell (Mas, Franjas, BarraInferior) la pide aquí. Vive en `./precarga`, que es una hoja.
export { precargarRuta } from './precarga'

type IdPantalla = Exclude<Ruta['id'], 'mas'>

/** La pantalla de `id`: la perezosa si tiene cargador, y si no el relleno. */
function pantallaDe(id: IdPantalla): Pantalla {
  const cargar = CARGADORES[id]
  return cargar === undefined ? Pendiente : lazy(cargar)
}

export const registro: Record<IdPantalla, Pantalla> = {
  facturas: Facturas,
  factura: pantallaDe('factura'),
  anular: pantallaDe('anular'),
  facturar: pantallaDe('facturar'),
  'facturar-productos': pantallaDe('facturar-productos'),
  'facturar-revisar': pantallaDe('facturar-revisar'),
  'facturar-resultado': pantallaDe('facturar-resultado'),
  clientes: pantallaDe('clientes'),
  'cliente-nuevo': pantallaDe('cliente-nuevo'),
  cliente: pantallaDe('cliente'),
  productos: pantallaDe('productos'),
  producto: pantallaDe('producto'),
  'mas-empresa': pantallaDe('mas-empresa'),
  'mas-numeracion': pantallaDe('mas-numeracion'),
  'mas-usuarios': pantallaDe('mas-usuarios'),
}

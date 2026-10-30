// El registro de pantallas: qué componente dibuja cada ruta (el shell lo busca con `registro[ruta.id]`). `mas` no está: es una hoja que el shell
// dibuja sobre la última pantalla (screens/Mas.tsx), no una pantalla. Cada entrada empieza como el relleno `Pendiente` y los planes la reemplazan
// una por una, sin tocar las demás:
//  - una pantalla del arranque (Facturas) se importa y se pone en su entrada de `registro`;
//  - una perezosa se agrega a CARGADORES (`factura: () => import('./Detalle')`). Desde ahí `registro` la sirve con `lazy` y `precargarRuta` la baja
//    antes de que se toque: es la misma función para las dos cosas, y así la precarga nunca baja un trozo distinto del que la pantalla usa.
import { lazy } from 'react'
import type { ComponentType } from 'react'
import type { Ruta } from '~/router'
import Facturas from './Facturas'
import Pendiente from './Pendiente'

type Pantalla = ComponentType<{ ruta: Ruta }>
type IdPantalla = Exclude<Ruta['id'], 'mas'>
type Cargador = () => Promise<{ default: Pantalla }>

/** Las pantallas que se bajan con `import()`. Vacío por ahora: la primera es el Detalle, en la tarea 21 de este plan. */
const CARGADORES: Partial<Record<Ruta['id'], Cargador>> = {}

/** La pantalla de `id`: la perezosa si tiene cargador, y si no el relleno. */
function pantallaDe(id: IdPantalla): Pantalla {
  const cargar = CARGADORES[id]
  return cargar === undefined ? Pendiente : lazy(cargar)
}

// Facturas es del arranque: se importa y se pone aquí. Sus piezas piden `precargarRuta` a este mismo archivo (Facturas -> facturas/TarjetaFactura -> registro -> Facturas es un ciclo de
// imports): es seguro porque `Facturas` y `precargarRuta` son declaraciones de función, que existen desde que se enlaza el módulo, y `precargarRuta` solo corre con un toque,
// cuando todo está cargado. No lo cambies a una constante ni a una flecha.
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

/**
 * Baja el trozo de la pantalla de `id` sin dibujarla, para que al abrirla ya esté. Se llama en el `pointerdown` del control que lleva a ella (el
 * usuario ya la pidió) y en la precarga del rato libre, que solo corre sin `saveData` y con `effectiveType` `4g`: esa condición la pone quien llama.
 * Es idempotente porque `import()` entrega el mismo módulo todas las veces que se pida. Una pantalla del arranque, o `mas`, no tiene cargador y no
 * hace nada. Un fallo aquí no se avisa a nadie: es una precarga, y si el módulo no llegó lo pide la pantalla cuando se dibuja.
 */
export function precargarRuta(id: Ruta['id']): void {
  void CARGADORES[id]?.().catch(() => undefined)
}

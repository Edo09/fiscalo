// La precarga de las pantallas perezosas: qué trozos se bajan con `import()` (CARGADORES) y la función que los baja antes de que se toquen (`precargarRuta`).
//
// Es una HOJA a propósito: no importa ninguna pantalla ni `screens/registro`. `registro` importa a Facturas (una pantalla del arranque) y las piezas de Facturas (TarjetaFactura,
// Alertas) piden `precargarRuta` en su `pointerdown`: si la función viviera en `registro` habría un ciclo de imports (registro -> Facturas -> pieza -> registro) que solo funciona
// mientras `Facturas` y `precargarRuta` sigan siendo declaraciones de función, que existen desde que se enlaza el módulo, y se rompería sin aviso (TDZ) con una constante o
// una lectura de `registro` al evaluar. Desde aquí no hay ciclo que cuidar. Una pantalla del arranque y sus piezas piden `precargarRuta` a este archivo, nunca a `registro`;
// `registro` la reexporta para el shell (Mas, Franjas, BarraInferior). tests/precarga.test.ts vigila las dos cosas: que esto sea una hoja y que `registro` no esté en ningún ciclo.
import type { ComponentType } from 'react'
import type { Ruta } from '~/router'

/**
 * Una pantalla de `registro`. Recibe su ruta como propiedad y no la lee con `useRuta`: con la hoja de Más abierta `useRuta` dice `mas`, y la pantalla de detrás tiene que seguir con
 * la suya (el shell le sigue pasando la última pantalla que no es Más).
 */
export type Pantalla = ComponentType<{ ruta: Ruta }>

/** Lo que baja el trozo de una pantalla: un `import()`. */
export type Cargador = () => Promise<{ default: Pantalla }>

/**
 * Las pantallas que se bajan con `import()`, por id de ruta: una perezosa se agrega aquí (`factura: () => import('./Detalle')`). Desde ahí `registro` la sirve con `lazy` y
 * `precargarRuta` la baja antes de que se toque: es la misma función para las dos cosas, y así la precarga nunca baja un trozo distinto del que la pantalla usa. Vacío por ahora:
 * la primera es el Detalle, en la tarea 21 de este plan.
 */
export const CARGADORES: Partial<Record<Ruta['id'], Cargador>> = {
  factura: () => import('./Detalle'),
  facturar: () => import('./facturar/PasoCliente'),
  'facturar-productos': () => import('./facturar/PasoProductos'),
  'facturar-revisar': () => import('./facturar/PasoRevisar'),
  'facturar-resultado': () => import('./facturar/Resultado'),
  clientes: () => import('./clientes/Clientes'),
  'cliente-nuevo': () => import('./clientes/ClienteNuevo'),
  cliente: () => import('./clientes/ClienteDetalle'),
  productos: () => import('./productos/Productos'),
  producto: () => import('./productos/ProductoForm'),
  'mas-empresa': () => import('./mas/Empresa'),
  'mas-numeracion': () => import('./mas/Numeracion'),
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

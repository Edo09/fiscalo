// La barra inferior y las filas de Más (anexo 5.1 y 5.2): qué sale a cada cuenta. Es presentación y nada más: que una pestaña o una fila no salga no
// es un control de seguridad, lo es la guardia de rutas (entitlements.ts) y detrás de ella el API, que niegan las mismas rutas. Por eso aquí solo se
// decide qué se dibuja, con los mismos módulos que mira la guardia.
import { tieneModulo } from '~/entitlements'
import type { Entitlements } from '~/entitlements'
import { formatHash } from '~/router'

export type SlotId = 'facturas' | 'clientes' | 'facturar' | 'productos' | 'mas'

/** Una pestaña de la barra. `icono` es el nombre de un icono de `ui/Icon`; `central` es el botón elevado de Facturar. */
export interface Slot {
  id: SlotId
  etiqueta: string
  hash: string
  icono: string
  central: boolean
}

/** Una pestaña a partir de su id: su hash es el de la ruta del mismo id, y solo Facturar es el botón central. */
function pestana(id: SlotId, etiqueta: string, icono: string): Slot {
  return { id, etiqueta, hash: formatHash({ id }), icono, central: id === 'facturar' }
}

/**
 * Las pestañas de la barra, en su orden fijo: Facturas, Clientes, Facturar, Productos, Más (anexo 5.1). Facturas, Facturar y Más salen siempre;
 * Clientes y Productos solo si la cuenta tiene el módulo. Falla cerrado: sin entitlements no hay ninguna (la app no monta la barra, muestra la
 * pantalla de edición).
 */
export function construirBarra(e: Entitlements | null): Slot[] {
  if (e === null) return []
  const barra: Slot[] = [pestana('facturas', 'Facturas', 'file-text')]
  if (tieneModulo(e, 'clientes')) barra.push(pestana('clientes', 'Clientes', 'users'))
  barra.push(pestana('facturar', 'Facturar', 'plus'))
  if (tieneModulo(e, 'productos')) barra.push(pestana('productos', 'Productos', 'package'))
  barra.push(pestana('mas', 'Más', 'ellipsis'))
  return barra
}

/**
 * La barra partida en dos mitades de igual ancho alrededor del botón central (anexo 5.1): lo que va antes de Facturar y lo que va después. Facturar
 * no está en ninguna de las dos: la barra lo dibuja entre ellas, así queda centrado aunque falte Clientes o Productos. Sin botón central todo queda
 * en la izquierda. Son copias.
 */
export function mitadesBarra(slots: Slot[]): { izq: Slot[]; der: Slot[] } {
  const centro = slots.findIndex((slot) => slot.central)
  if (centro === -1) return { izq: [...slots], der: [] }
  return { izq: slots.slice(0, centro), der: slots.slice(centro + 1) }
}

/**
 * Una fila del menú Más (anexo 5.2). `hash` es la pantalla a la que lleva, y no lo tiene la que no navega: Ayuda abre un enlace de WhatsApp, Tema
 * es un control en la propia fila y Cerrar sesión pide confirmación. `icono` es el nombre de un icono de `ui/Icon`, y vacío en Tema, que no
 * tiene icono (su control lo dibuja la fila). `peligro` pinta la fila con el color de peligro.
 */
export interface FilaMas {
  id: 'empresa' | 'numeracion' | 'usuarios' | 'ayuda' | 'tema' | 'salir'
  etiqueta: string
  hash?: string
  icono: string
  peligro?: boolean
}

/**
 * Qué pantallas de Más ya existen. Una fila cuya pantalla no está lista no sale, porque abriría el relleno «Esta sección llega pronto». El plan 09
 * pone `empresa` y `numeracion` en true al registrar sus pantallas, y el seguimiento de Usuarios pone `usuarios`. Es una constante y no una búsqueda
 * del relleno en `screens/registro`: ese archivo importa componentes, y esta lógica se prueba sin DOM. Que la fila no salga no cierra la ruta: un
 * hash escrito a mano pasa la guardia y dibuja el relleno.
 */
export const PANTALLAS_LISTAS: { empresa: boolean; numeracion: boolean; usuarios: boolean } = { empresa: true, numeracion: true, usuarios: false }

/**
 * Las filas de Más, en este orden (anexo 5.2): Mi empresa, Numeración e-CF, Usuarios, Ayuda y soporte, Tema y Cerrar sesión. Mi empresa y Numeración
 * piden el módulo `configuracion` (Numeración se ve también sin ser administrador, de solo lectura); Usuarios pide ser administrador y el módulo
 * `usuarios`; Ayuda solo sale si hay un número de soporte (`ctx.soporte`); Tema y Cerrar sesión salen siempre, incluso sin entitlements, para poder
 * salir. Las tres pantallas de Más solo salen cuando `listas` dice que existen.
 */
export function filasMas(e: Entitlements | null, ctx: { admin: boolean; soporte: boolean }, listas: typeof PANTALLAS_LISTAS = PANTALLAS_LISTAS): FilaMas[] {
  const filas: FilaMas[] = []
  if (listas.empresa && tieneModulo(e, 'configuracion')) {
    filas.push({ id: 'empresa', etiqueta: 'Mi empresa', hash: formatHash({ id: 'mas-empresa' }), icono: 'building-2' })
  }
  if (listas.numeracion && tieneModulo(e, 'configuracion')) {
    filas.push({ id: 'numeracion', etiqueta: 'Numeración e-CF', hash: formatHash({ id: 'mas-numeracion' }), icono: 'hash' })
  }
  if (listas.usuarios && ctx.admin && tieneModulo(e, 'usuarios')) {
    filas.push({ id: 'usuarios', etiqueta: 'Usuarios', hash: formatHash({ id: 'mas-usuarios' }), icono: 'users' })
  }
  if (ctx.soporte) filas.push({ id: 'ayuda', etiqueta: 'Ayuda y soporte', icono: 'circle-help' })
  filas.push({ id: 'tema', etiqueta: 'Tema', icono: '' })
  filas.push({ id: 'salir', etiqueta: 'Cerrar sesión', icono: 'log-out', peligro: true })
  return filas
}

/** El nombre del rol para mostrarlo: `admin` es Administrador y `user`, Facturador; un rol que no se conoce se muestra tal cual. */
export function etiquetaRol(role: string): string {
  if (role === 'admin') return 'Administrador'
  if (role === 'user') return 'Facturador'
  return role
}

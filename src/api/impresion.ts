// Valor del parámetro `formato` de los endpoints de PDF de facturas.
import { getAnchoTirilla } from '@/stores/impresora'
import type { FormatoImpresion } from './types'

/**
 * `undefined` para la hoja carta, que el backend da por defecto. La tirilla se
 * pide en el ancho configurado en este equipo (Configuración → Impresora de
 * recibos).
 *
 * La de 80 mm se sigue pidiendo como `pos` a secas, igual que antes de haber
 * varios anchos: así un backend que todavía no tenga los anchos nuevos devuelve
 * el recibo de siempre, y solo 76 y 72 dependen de la versión que acepta
 * `pos76` / `pos72` (una versión vieja los trata como hoja carta).
 */
export function parametroFormato(formato: FormatoImpresion): string | undefined {
  if (formato !== 'pos') return undefined
  const ancho = getAnchoTirilla()
  return ancho === 80 ? 'pos' : `pos${ancho}`
}

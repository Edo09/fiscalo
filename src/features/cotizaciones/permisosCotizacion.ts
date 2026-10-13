import { useSession } from '@/stores/auth'
import { puedeVerVista } from '@/config/navigation'
import { useFormatoTenant } from './formatos/useFormatoTenant'

/** Qué acciones de una cotización guardada puede usar el rol (ver AccionesCotizacion). */
export interface PermisosCotizacion {
  puedeEcf: boolean
  puedeSimple: boolean
  puedeConduce: boolean
}

/**
 * Se calcula una vez por pantalla (el listado, el editor) y baja como prop: el
 * listado no abre una suscripción a branding por fila.
 */
export function usePermisosCotizacion(): PermisosCotizacion {
  const { user } = useSession()
  // "Conduce" sale cuando el formato de la empresa SE SABE y es Ferretería: el
  // mismo criterio que muestra la página de Conduces (mientras branding carga,
  // o si falló, no sale).
  const { formato } = useFormatoTenant()
  return {
    // Facturar ofrece solo los destinos que el rol puede abrir (mismo criterio que el sidebar).
    puedeEcf: puedeVerVista(user, 'factura-nueva'),
    puedeSimple: puedeVerVista(user, 'factura-simple-nueva'),
    puedeConduce: formato === 'ferreteria' && puedeVerVista(user, 'conduce-editar', formato),
  }
}

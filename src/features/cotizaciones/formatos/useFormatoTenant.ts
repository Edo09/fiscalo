// Formato de cotización del TENANT para decidir qué se ve (spec conduces 5.1):
// el menú, el buscador, la redirección de App y las páginas de conduces. Se
// lee una vez, en AppShell, y baja como prop.
//
// No es useCotizacionFormato (index.ts), que para una cotización nueva cae en
// Gratex si no sabe otra cosa. Aquí no se supone nada: mientras branding no
// responde, o si falló, el formato es null, y lo que depende de él ni se
// muestra ni redirige (ver puedeVerItem y debeSalirDeVista en config/navigation).
//
// Este observador no vuelve a pedir branding al volver a la pestaña ni porque
// pase el tiempo: el formato del tenant no cambia solo, y cuando cambia desde
// Configuración, BrandingSection invalida ['branding'] y esto se actualiza. Los
// formularios siguen con sus propios observadores y su frescura (config/cache.ts).
// Otra cuenta (otro tenant) no hereda el formato de la anterior: al cerrar
// sesión main.tsx vacía la caché, y AppShell vuelve a montar este observador.
import { getBranding } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { esFormato, type FormatoId } from './index'

export function useFormatoTenant(): { formato: FormatoId | null; error: boolean; reintentar: () => void } {
  const { data, error, errorStatus, reload } = useApiQuery(['branding'], getBranding, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  // 409 = instalación single-tenant: sin tenant se cotiza con Gratex, y
  // reintentar no cambia nada (ver useCotizacionFormato).
  const sinTenant = data == null && errorStatus === 409
  const crudo = data?.cotizacion_formato
  // Como en useCotizacionFormato: sin el campo, o con uno que este front no
  // conoce, es Gratex.
  const formato: FormatoId | null = data != null ? (esFormato(crudo) ? crudo : 'gratex') : sinTenant ? 'gratex' : null
  return {
    formato,
    // Un refresco fallido con el dato ya en caché no cuenta: el formato se sigue sabiendo.
    error: formato === null && error !== null,
    reintentar: () => void reload(),
  }
}

// ¿La empresa tiene el POS activo? (master tenants.pos_enabled, vía GET
// /api/branding). Decide si se ven el botón POS del navbar y "Punto de venta"
// en el menú. null mientras branding no responde o si falló: lo que depende de
// esto ni se muestra ni redirige (mismo criterio que useFormatoTenant).
//
// Misma caché que el resto de la app (['branding']); no se vuelve a pedir al
// volver a la pestaña: el POS de una empresa no se activa solo.
import { getBranding } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

export function usePosActivo(): boolean | null {
  const { data } = useApiQuery(['branding'], getBranding, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  return data != null ? data.pos_enabled === true : null
}

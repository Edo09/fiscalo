// ¿La empresa bloquea las ventas sin existencia? (master tenants.inventario_estricto,
// vía GET /api/branding). Decide si las facturas muestran la existencia, el
// «Agotado» y el aviso antes de enviar, si la factura electrónica avisa antes
// de salir de la pantalla con líneas sin emitir, y si Productos deja escribir la
// existencia al editar. null mientras branding no responde o si falló: lo que
// depende de esto ni se muestra ni avisa (mismo criterio que usePosActivo).
//
// Misma consulta que usePosActivo y el resto de la app (['branding']), pero con
// frescura normal (3 minutos, config/cache.ts) y refresco al volver a la pestaña,
// a diferencia de usePosActivo: este interruptor SÍ lo cambia un administrador
// mientras otros tienen la app abierta, y Productos solo se enteraba al recargar.
// Cada observador lleva sus propias opciones: el de usePosActivo sigue sin pedir
// nada por su cuenta, y si este refresca, el dato nuevo llega a todos los que
// leen ['branding']. Al cambiar el interruptor en Configuración se invalida
// ['branding'] y las pantallas lo ven al instante; el API tiene la última palabra
// aunque esta pantalla esté desactualizada.
import { getBranding } from '@/api'
import { FRESCURA } from '@/config/cache'
import { useApiQuery } from '@/hooks/useApiQuery'

export function useInventarioEstricto(): boolean | null {
  const { data } = useApiQuery(['branding'], getBranding, {
    staleTime: FRESCURA.NORMAL,
    refetchOnWindowFocus: true,
  })
  return data != null ? data.inventario_estricto === true : null
}

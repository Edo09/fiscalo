// El registro de lo que HACE cada acción del detalle (anexo 6.3): `accionesDe` (lib/acciones) dice QUÉ se ofrece según el estado de la factura, y este registro dice qué hace cada una. Una
// acción sin manejador registrado no se dibuja (screens/detalle/Acciones.tsx): así la tabla puede nombrar lo que esta versión de Express todavía no trae (Duplicar, Anular, Corregir y
// emitir de nuevo, Reintentar anulación) sin que aparezca un botón que no hace nada. Los manejadores de esta versión están en ./acciones-detalle.
import type { AccionId } from '~/lib/acciones'
import type { FacturaVista } from '~/lib/filas'

/** Lo que hace una acción con la factura abierta. Si lanza, la pantalla lo dice (el texto de un `ApiError` es del servidor y se enseña tal cual). */
export type ManejadorDeAccion = (f: FacturaVista) => void | Promise<void>

const manejadores = new Map<AccionId, ManejadorDeAccion>()

/** Registra (o reemplaza) lo que hace `id`. Se llama al importar el módulo que lo define, no al dibujar. */
export function registrarAccionDetalle(id: AccionId, manejador: ManejadorDeAccion): void {
  manejadores.set(id, manejador)
}

/** Lo que hace `id`; undefined si nadie lo registró (la acción no se dibuja). */
export function manejadorDe(id: AccionId): ManejadorDeAccion | undefined {
  return manejadores.get(id)
}

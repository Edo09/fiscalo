// Configuración del cliente API (resuelta desde variables de entorno Vite).

/**
 * Base URL de la API.
 * - En desarrollo se deja vacía: las llamadas van a `/api/...` (mismo origen)
 *   y el dev-proxy de Vite las reenvía al backend inyectando la X-API-KEY.
 * - En producción (build estático sin proxy) se usa VITE_API_BASE_URL.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * X-API-KEY enviada desde el navegador. Normalmente vacía: en dev la pone el
 * proxy. Solo se define en producción sin proxy (queda embebida en el bundle).
 */
export const API_KEY = import.meta.env.VITE_API_KEY ?? ''

/** user_id por defecto para emitir comprobantes. */
export const DEFAULT_USER_ID = Number(import.meta.env.VITE_DEFAULT_USER_ID ?? 1)

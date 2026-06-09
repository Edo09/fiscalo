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

/**
 * tenant_id (código de empresa) para el login multi-tenant. Se define en el .env
 * (VITE_TENANT_ID) y se envía en POST /api/auth/login, así el usuario no lo teclea.
 * Vacío => no se manda y el backend resuelve por email (único global).
 */
export const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? ''

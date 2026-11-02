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

/**
 * Edición con la que este cliente se anuncia ante la API (VITE_EDICION_CLIENTE). La app completa no la define y no manda nada;
 * Express la fija en `express/vite.config.ts` (define) y manda la cabecera X-Fiscalpoint-Edicion en CADA petición, el login incluido.
 * Una empresa que usa las dos versiones recibe los límites y el bloque de Express solo en las peticiones que la traen (API: TenantResolver::esFilaExpress).
 * La cabecera solo restringe: no abre nada que la cuenta no tenga ya.
 */
export const EDICION_CLIENTE = import.meta.env.VITE_EDICION_CLIENTE ?? ''

/**
 * Las cabeceras con las que el cliente se anuncia: vacío en la app completa, `X-Fiscalpoint-Edicion: <edición>` en Express. Todo `fetch` a la API las suma
 * (http.ts, auth.ts y el cierre de sesión pendiente de Express), porque son un mismo cliente: una petición sin ellas corre como la app completa.
 */
export const CABECERAS_CLIENTE: Readonly<Record<string, string>> = EDICION_CLIENTE === '' ? {} : { 'X-Fiscalpoint-Edicion': EDICION_CLIENTE }

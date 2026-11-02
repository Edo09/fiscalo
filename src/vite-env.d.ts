/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL de la API en producción (build sin dev-proxy). Vacío en dev. */
  readonly VITE_API_BASE_URL?: string
  /** X-API-KEY embebida en el bundle (solo si no se usa el dev-proxy). */
  readonly VITE_API_KEY?: string
  /** user_id por defecto para POST /api/facturas. */
  readonly VITE_DEFAULT_USER_ID?: string
  /** tenant_id (código de empresa) que se envía en el login multi-tenant. */
  readonly VITE_TENANT_ID?: string
  /** Edición con la que el cliente se anuncia a la API (`express`); solo la define express/vite.config.ts. */
  readonly VITE_EDICION_CLIENTE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

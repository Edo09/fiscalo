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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Constantes de la app Express. Nada secreto: el bundle es público.

/**
 * Número de WhatsApp de soporte. Vacío hasta que el dueño lo defina: mientras lo esté se ocultan la
 * fila «Ayuda y soporte» y «Avisar a soporte».
 */
export const SOPORTE_WHATSAPP: string = ''

/** App completa de FiscalPoint: adonde manda la pantalla de «cuenta no habilitada en Express». */
export const APP_COMPLETA_URL = 'https://app.fiscalpoint.com.do'

/** Clave de localStorage (con valor `1`) que deja iniciar sesión en una vista previa de Vercel; sin ella ahí se rechaza el login. */
export const CLAVE_PREVIEW = 'express.dev.allowPreviewLogin'

/**
 * Identificador de la compilación. Vite sustituye `__BUILD_ID__` con `define`; bajo Node (las
 * pruebas) no existe y `typeof` evita el ReferenceError.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/** Filas por página del historial de Facturas (anexo 6.2). */
export const PAGINA = 15

/** Filas por página de Clientes, Productos y los selectores del asistente (anexo 6.5, 6.9 y 6.10). */
export const PAGINA_LISTAS = 20

/** Espera antes de buscar mientras se teclea, en todos los campos de búsqueda (anexo 6.9 y 6.10). */
export const DEBOUNCE_BUSQUEDA_MS = 250

/** Una lectura sin respuesta pasado este tiempo muestra «Tarda más de lo normal», sin abortarse. */
export const LECTURA_LENTA_MS = 12_000

/** El esqueleto de carga solo aparece si la lectura tarda más que esto, para que no parpadee. */
export const RETRASO_ESQUELETO_MS = 150

/** Al volver a la app pasado este tiempo, se refresca lo que está a la vista. */
export const REFRESCO_VISIBLE_MS = 60_000

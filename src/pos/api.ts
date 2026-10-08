// Cliente HTTP del POS (pos.fiscalpoint.com.do). Contrato: api-gratex
// docs/api/pos.md.
//
// No reutiliza src/api/http.ts a proposito: ese cliente manda el Bearer de la
// sesion de app.* y ante un 401 cierra esa sesion. El POS tiene tres
// credenciales distintas (equipo, empleado y, solo para habilitar el equipo,
// la de un admin) y un 401 significa cosas distintas segun el `codigo`:
// EQUIPO_NO_HABILITADO lleva a habilitar el equipo, SESION_REQUERIDA al PIN.
import { API_BASE_URL } from '@/api/config'

const TIMEOUT_MS = 30_000

/** Error del POS con el `codigo` estable del backend (el texto puede cambiar). */
export class PosApiError extends Error {
  readonly codigo: string
  readonly http: number
  /** Campos extra del cuerpo: intentos_restantes, bloqueo_segundos, equipo_actual... */
  readonly extra: Record<string, unknown>

  constructor(mensaje: string, codigo: string, http: number, extra: Record<string, unknown> = {}) {
    super(mensaje)
    this.name = 'PosApiError'
    this.codigo = codigo
    this.http = http
    this.extra = extra
  }
}

export interface Credenciales {
  /** Token del equipo de caja (X-POS-EQUIPO). */
  equipo?: string | null
  /** Token de la sesion del empleado (X-POS-SESION). */
  sesion?: string | null
  /** Sesion de un admin (Bearer), solo para habilitar el equipo. */
  admin?: string | null
}

const SIN_CONEXION = 'No hay conexión con el servidor. Revisa el internet de este equipo.'

/**
 * Peticion al API. Devuelve `data` del sobre ({status|success: true, data}).
 * Lanza PosApiError con el `codigo` del backend, o SIN_CONEXION si no hubo red.
 */
export async function posFetch<T>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  ruta: string,
  cred: Credenciales = {},
  cuerpo?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json'
  if (cred.equipo) headers['X-POS-EQUIPO'] = cred.equipo
  if (cred.sesion) headers['X-POS-SESION'] = cred.sesion
  if (cred.admin) headers['Authorization'] = `Bearer ${cred.admin}`

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new PosApiError(SIN_CONEXION, 'SIN_CONEXION', 0)
  }

  let body: Record<string, unknown> | null = null
  try {
    const raw = await res.text()
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch {
    body = null
  }

  const ok = body !== null && (body.status === true || body.success === true)
  if (res.ok && ok) {
    return body!.data as T
  }

  const { error, codigo, status: _s, success: _ok, data: _d, ...extra } = body ?? {}
  void _s; void _ok; void _d
  const mensaje = typeof error === 'string' && error !== ''
    ? error
    : res.status >= 500
      ? 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.'
      : 'No se pudo completar la operación.'
  // Sin `codigo` (p. ej. el 403 del gate central con PERMISSIONS_ENFORCE) se
  // deduce del HTTP: es lo que el backend habria puesto.
  const cod = typeof codigo === 'string' && codigo !== ''
    ? codigo
    : res.status === 403 ? 'SIN_PERMISO' : res.status === 401 ? 'NO_AUTORIZADO' : 'ERROR'
  throw new PosApiError(mensaje, cod, res.status, extra)
}

// ---------------------------------------------------------------------------
// Tipos del contrato (docs/api/pos.md)
// ---------------------------------------------------------------------------

export interface Caja {
  id: number
  nombre: string
  activa: boolean
}

export interface Empleado {
  id: number
  nombre: string
  rol: 'cajero' | 'supervisor'
  activo: boolean
}

export interface TurnoCaja {
  id: number
  empleado_id: number
  empleado_nombre: string
  abierto_at: string
  fondo_inicial: number
  de_dia_anterior: boolean
}

export interface EstadoPos {
  empresa: { nombre: string | null; rnc: string | null }
  equipo: { id: number; nombre: string | null; bloqueado: boolean; bloqueo_segundos: number }
  caja: Caja | null
  empleado: Empleado | null
  turno_caja: TurnoCaja | null
}

export interface SesionPos {
  token: string
  empleado: Empleado
  caja: Caja
  turno_caja: TurnoCaja | null
}

/** Producto del catálogo de la caja (GET /api/pos/catalogo, C1-C4). */
export interface ProductoPos {
  id: number
  nombre: string
  sku: string | null
  /** null: sin categoría, o su categoría está inactiva (sale solo en "Todos"). */
  category_id: number | null
  /** Precio final con ITBIS, en centavos. Lo calcula el servidor (C2). */
  precio_centavos: number
  /** ITBIS en %: 18, 16 o 0. */
  tasa: number
  indicador_facturacion: number
  /** null = servicio (sin existencia). */
  stock: number | null
  stock_minimo: number | null
  unidad_medida: string
  /** ¿La cantidad admite decimales (kilo, libra, metro)? */
  decimales: boolean
}

export interface CategoriaPos {
  id: number
  nombre: string
  productos: number
}

export interface CatalogoPos {
  productos: ProductoPos[]
  categorias: CategoriaPos[]
  generado_at: string
}

export interface LoginAdmin {
  token: string
  user: { id: number; name: string; username: string; permissions?: string[] }
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

export const posApi = {
  // Equipo y empleado
  estado: (equipo: string, sesion?: string | null) =>
    posFetch<EstadoPos>('GET', '/pos/estado', { equipo, sesion }),
  entrar: (equipo: string, pin: string) =>
    posFetch<SesionPos>('POST', '/pos/sesion', { equipo }, { pin }),
  salir: (equipo: string, sesion: string) =>
    posFetch<{ cerrada: boolean }>('DELETE', '/pos/sesion', { equipo, sesion }),
  catalogo: (equipo: string, sesion: string) =>
    posFetch<CatalogoPos>('GET', '/pos/catalogo', { equipo, sesion }),

  // Admin, solo para habilitar el equipo
  login: (usuario: string, clave: string) =>
    posFetch<LoginAdmin>('POST', '/auth/login', {}, { emailOrUsername: usuario, password: clave }),
  canjear: (code: string) =>
    posFetch<LoginAdmin>('POST', '/auth/pos-handoff/canje', {}, { code }),
  cerrarAdmin: (admin: string) =>
    posFetch<unknown>('POST', '/auth/signout', { admin }, {}),
  cajas: (admin: string) =>
    posFetch<{ cajas: Caja[] }>('GET', '/pos-admin/cajas', { admin }),
  crearCaja: (admin: string, nombre: string) =>
    posFetch<{ caja: Caja }>('POST', '/pos-admin/cajas', { admin }, { nombre }),
  habilitar: (admin: string, cajaId: number, reemplazar: boolean) =>
    posFetch<{ equipo: { id: number; nombre: string; caja: Caja }; token: string }>(
      'POST', '/pos-admin/equipos', { admin }, { caja_id: cajaId, reemplazar },
    ),
}

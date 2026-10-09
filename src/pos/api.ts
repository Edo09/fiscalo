// Cliente HTTP del POS (pos.fiscalpoint.com.do). Contrato: api-gratex
// docs/api/pos.md.
//
// No reutiliza src/api/http.ts a proposito: ese cliente manda el Bearer de la
// sesion de app.* y ante un 401 cierra esa sesion. El POS tiene tres
// credenciales distintas (equipo, empleado y, solo para habilitar el equipo,
// la de un admin) y un 401 significa cosas distintas segun el `codigo`:
// EQUIPO_NO_HABILITADO lleva a habilitar el equipo, SESION_REQUERIDA al PIN.
import { API_BASE_URL } from '@/api/config'
import type { ReciboDatos } from '@/api/types'

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
  timeoutMs: number = TIMEOUT_MS,
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
      signal: AbortSignal.timeout(timeoutMs),
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

/** Forma de pago (codigo DGII de TablaFormasPago): 1 efectivo, 2 transferencia/deposito, 3 tarjeta. */
export type FormaPago = 1 | 2 | 3

/** Cliente de crédito fiscal (POST /api/pos/clientes/rnc, F2). */
export interface ClientePos {
  id: number
  /** Razón social (o el nombre que tenga). */
  nombre: string
  rnc: string
  /** % de descuento del cliente (V5); 0 = sin descuento. */
  descuento: number
}

/** Cuerpo de POST /api/pos/ventas. El POS no manda precios: solo producto y cantidad. */
export interface VentaCuerpo {
  /** '32' consumo (sin cliente) o '31' crédito fiscal (con client_id). */
  tipo_ecf: '32' | '31'
  client_id: number | null
  /** Una por intento de venta: repetirla nunca saca otro e-NCF (F5). */
  clave: string
  lineas: { product_id: number; cantidad: number }[]
  /** El total que vio el cajero; si el servidor calcula otro, responde TOTAL_DISTINTO. */
  total_centavos: number
  forma_pago: FormaPago
  recibido_centavos: number | null
  ancho: number
  iniciada_ms: number | null
}

export interface VentaRespuesta {
  venta: {
    factura_id: number
    e_ncf: string
    tipo_ecf: string
    estado_dgii: string
    /**
     * Sin veredicto de la DGII todavía: no respondió a tiempo (RFCE_PENDIENTE /
     * ENVIO_PENDIENTE) o, en un E31, recibió el e-CF y lo está validando
     * (ENVIADO / EN_PROCESO). Se imprimió y se confirma solo (F6, F7).
     */
    envio_pendiente: boolean
    total_centavos: number
    cliente: ClientePos | null
  }
  cobro: {
    forma_pago: FormaPago
    forma_pago_nombre: string
    total_centavos: number
    recibido_centavos: number | null
    devuelta_centavos: number | null
  }
  /** null si no se pudo armar: se pide con posApi.recibo. */
  recibo: ReciboDatos | null
  /** true = esa clave ya tenía venta: es la misma, no otra. */
  repetida: boolean
}

export interface Reenvio {
  revisadas: number
  aceptadas: number
  rechazadas: { factura_id: number; e_ncf: string; motivo: string }[]
  pendientes: number
}

/** Conteo de la gaveta: unidades por denominación ("2000": 3...) y otros/centavos. */
export type Conteo = Record<string, number>

/** Foto del cierre de un turno (pos_turnos.totales_json, K8). Montos en centavos. */
export interface ReporteCierre {
  version: number
  turno_id: number
  caja: { id: number; nombre: string }
  empleado: { id: number; nombre: string }
  cerrado_por: { id: number; nombre: string; rol: 'cajero' | 'supervisor' }
  abierto_at: string
  cerrado_at: string
  fondo_centavos: number
  ventas: GrupoFormas
  devoluciones: GrupoFormas
  /** { "E32": 4 } */
  comprobantes: Record<string, number>
  canceladas: { cantidad: number; monto_centavos: number }
  lineas_quitadas: { cantidad: number; monto_centavos: number }
  pendientes: { e_ncf: string; total_centavos: number }[]
  rechazadas: { e_ncf: string; total_centavos: number }[]
  conteo: Conteo
  efectivo_ventas_centavos: number
  efectivo_devoluciones_centavos: number
  esperado_centavos: number
  contado_centavos: number
  /** contado − esperado: + sobra, − falta. */
  diferencia_centavos: number
  nota?: string | null
}

export interface GrupoFormas {
  cantidad: number
  total_centavos: number
  por_forma: { forma_pago: number; nombre: string; cantidad: number; monto_centavos: number }[]
}

/** Venta cobrada del turno (K9). */
export interface VentaTurno {
  factura_id: number
  e_ncf: string
  tipo_ecf: string
  fecha: string
  total_centavos: number
  forma_pago: number
  forma_pago_nombre: string
  estado_dgii: string
  envio_pendiente: boolean
}

/** Ventas de hoy del cajero en esta caja, de todos sus turnos (GET /api/pos/ventas/dia). */
export interface VentasDia {
  fecha: string
  caja: { id: number; nombre: string }
  empleado: { id: number; nombre: string }
  resumen: {
    cantidad: number
    total_centavos: number
    por_forma: { forma_pago: number; nombre: string; cantidad: number; total_centavos: number }[]
  }
  ventas: (VentaTurno & { turno_id: number; cliente: string | null })[]
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
  // Consulta el registro de contribuyentes si el cliente no existe (hasta ~5 s).
  clienteRnc: (equipo: string, sesion: string, rnc: string) =>
    posFetch<{ cliente: ClientePos; nuevo: boolean; estado_dgii: string | null }>('POST', '/pos/clientes/rnc', { equipo, sesion }, { rnc }, 30_000),
  abrirTurno: (equipo: string, sesion: string, fondoCentavos: number) =>
    posFetch<{ turno_caja: TurnoCaja }>('POST', '/pos/turno', { equipo, sesion }, { fondo_centavos: fondoCentavos }),
  // La emision puede esperar a la DGII (y, con doble toque, a la otra peticion): mas margen.
  vender: (equipo: string, sesion: string, cuerpo: VentaCuerpo) =>
    posFetch<VentaRespuesta>('POST', '/pos/ventas', { equipo, sesion }, cuerpo, 75_000),
  recibo: (equipo: string, sesion: string, facturaId: number, ancho: number) =>
    posFetch<{ recibo: ReciboDatos }>('GET', `/pos/ventas/${facturaId}/recibo?ancho=${ancho}`, { equipo, sesion }),
  reenviarPendientes: (equipo: string) =>
    posFetch<Reenvio>('POST', '/pos/pendientes/reenviar', { equipo }, {}, 75_000),

  // Turno: ventas, cierre y autorizaciones (K4-K9, S1, V4)
  ventasTurno: (equipo: string, sesion: string) =>
    posFetch<{ turno_caja: TurnoCaja | null; ventas: VentaTurno[] }>('GET', '/pos/ventas', { equipo, sesion }),
  ventasDia: (equipo: string, sesion: string) =>
    posFetch<VentasDia>('GET', '/pos/ventas/dia', { equipo, sesion }),
  autorizar: (equipo: string, sesion: string, pin: string, turnoId: number) =>
    posFetch<{ permiso: string; supervisor: { id: number; nombre: string }; vence_en_segundos: number }>(
      'POST', '/pos/autorizar', { equipo, sesion }, { pin, accion: 'cerrar_turno', turno_id: turnoId },
    ),
  // El cierre espera a una venta que se esté emitiendo (candado del turno): más margen.
  cerrarTurno: (equipo: string, sesion: string, turnoId: number, conteo: Conteo, permiso: string | null) =>
    posFetch<{ turno: unknown; reporte: ReporteCierre }>(
      'POST', '/pos/turno/cerrar', { equipo, sesion }, { turno_id: turnoId, conteo, permiso }, 75_000,
    ),
  notaTurno: (equipo: string, sesion: string, turnoId: number, nota: string) =>
    posFetch<{ turno: unknown; reporte: ReporteCierre }>('POST', '/pos/turno/nota', { equipo, sesion }, { turno_id: turnoId, nota }),
  evento: (equipo: string, sesion: string, tipo: 'cancelada' | 'quitada', montoCentavos: number,
    lineas: { product_id: number; nombre: string; cantidad: number }[]) =>
    posFetch<{ registrado: boolean }>('POST', '/pos/eventos', { equipo, sesion }, { tipo, monto_centavos: montoCentavos, lineas }),

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

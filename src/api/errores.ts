// Red de seguridad para los textos de error que ve el cajero.
//
// Las pantallas muestran `e.message` de un ApiError tal cual (toast, banner del
// modal, ErrorState). Durante años eso dejó pasar textos pensados para
// programadores: "client_id o client_name requerido", "Invalid email or
// password", "SQLSTATE[22007]…", rutas de certificados. El backend se está
// reescribiendo, pero un texto técnico nuevo (o uno de un backend viejo) no
// debe volver a llegar a caja. Este módulo decide, en un solo sitio, qué texto
// se enseña:
//
//   - Un texto claro del servidor pasa SIN cambios: es el más específico.
//   - Uno técnico se cambia por uno genérico según el código HTTP y la acción
//     (guardar, vista previa, consultar…), y el original va a la consola.
//   - Los motivos de rechazo de la DGII pasan siempre: son el motivo legal y
//     pueden traer nombres de etiquetas o códigos que sí hay que leer.
//
// Lo usan http.ts y auth.ts (que tiene otro sobre). No importa nada de la app
// para que ningún módulo quede en un ciclo de imports.

/** Datos extra de un ApiError. Todos opcionales: `new ApiError(msg, status)` sigue valiendo. */
export interface OpcionesApiError {
  /** Texto crudo (el del servidor, o una descripción técnica si no hubo). */
  original?: string
  /** true si el texto vino del servidor ({status:false,error} / {success:false,error}). */
  delServidor?: boolean
  /** true si lo que se muestra es un texto genérico del front y no el del servidor. */
  reemplazado?: boolean
  /** error_id del ErrorHandler del backend: el código que soporte busca en el log. */
  referencia?: string | null
  /** Código propio del front para casos que una pantalla trata distinto (ver CODIGO_*). */
  codigo?: string | null
  /** `data` que acompañaba al error (p. ej. el e-NCF guardado de un rechazo DGII). */
  datos?: unknown
}

/**
 * Error normalizado de la API. `message` es SIEMPRE un texto apto para el
 * usuario; el crudo queda en `original` para la consola y para soporte.
 */
export class ApiError extends Error {
  readonly status: number
  readonly original: string
  readonly delServidor: boolean
  readonly reemplazado: boolean
  readonly referencia: string | null
  readonly codigo: string | null
  readonly datos: unknown
  constructor(message: string, status: number, opts: OpcionesApiError = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.original = opts.original ?? message
    this.delServidor = opts.delServidor ?? false
    this.reemplazado = opts.reemplazado ?? false
    this.referencia = opts.referencia ?? null
    this.codigo = opts.codigo ?? null
    this.datos = opts.datos
  }
}

/** De qué petición salió el error: elige el texto de respaldo y va a la consola. */
export interface ContextoError {
  /** Método HTTP ('GET' si falta). */
  metodo?: string
  /** Ruta pedida (/api/…, con query si la llevaba). */
  path?: string
  /** error_id del ErrorHandler, si vino en el cuerpo. */
  referencia?: string | null
  /** El cuerpo no era JSON (página HTML del hosting, dos JSON pegados…). */
  ilegible?: boolean
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export const MSG_SESION_EXPIRADA = 'Tu sesión expiró. Vuelve a iniciar sesión.'
const MSG_SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.'
const MSG_TARDO = 'El servidor tardó demasiado en responder. Inténtalo de nuevo.'
// En una escritura no se invita a repetir a ciegas: emitir un e-CF viaja a la
// DGII, y si el servidor terminó después de que el navegador se rindiera, un
// segundo intento duplica la factura y quema otro e-NCF.
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
const MSG_SIN_PERMISO = 'No tienes permiso para hacer esto. Pídele acceso a un administrador.'
const MSG_NO_DISPONIBLE = 'Esta opción no está disponible ahora mismo. Recarga la página; si sigue pasando, avisa a soporte.'
const MSG_MUY_GRANDE = 'El archivo es demasiado grande. Usa uno más liviano.'
const MSG_DEMASIADOS = 'Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo.'
const MSG_CONFLICTO = 'Alguien más cambió estos datos al mismo tiempo. Actualiza la pantalla e inténtalo de nuevo.'
const MSG_NO_ENCONTRADO = 'No encontramos lo que buscas. Puede que se haya eliminado; actualiza la pantalla.'
const MSG_ARCHIVO_NO_ENCONTRADO = 'No se encontró el archivo. Puede que el documento todavía no se haya generado.'
const MSG_SERVIDOR = 'El servidor tuvo un problema y no pudo terminar. Inténtalo de nuevo en unos minutos.'
const MSG_INESPERADO = 'El servidor respondió algo inesperado. Inténtalo de nuevo en unos minutos; si sigue pasando, avisa a soporte.'
const MSG_INESPERADO_ESCRITURA =
  'El servidor respondió algo inesperado. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
const MSG_LOGIN_CREDENCIALES = 'El usuario o la contraseña no son correctos.'
const MSG_LOGIN_FALTAN = 'Escribe tu correo o usuario y tu contraseña.'
const MSG_LOGIN_SERVIDOR = 'No se pudo iniciar sesión por un problema del servidor. Inténtalo de nuevo en unos minutos.'
const MSG_LOGIN_GENERICO = 'No se pudo iniciar sesión. Inténtalo de nuevo.'

/** Código de ApiError: el cliente se creó, pero no se pudo identificar para elegirlo. */
export const CODIGO_CLIENTE_SIN_ELEGIR = 'cliente_creado_sin_elegir'

// ---------------------------------------------------------------------------
// ¿Es técnico?
// ---------------------------------------------------------------------------

/**
 * Qué clase de texto técnico es. `interno` = excepción, SQL, rutas del
 * servidor: el problema no lo causó el usuario. `ruta` = habla de endpoints o
 * verbos HTTP: la app pidió algo que el servidor no tiene.
 */
export type TipoTecnico = 'interno' | 'ruta' | 'tecnico'

// Motivos de la DGII: pasan siempre, sin tocarlos (el motivo legal es lo que
// hay que corregir, y los separa ' | ', que NO cuenta como sintaxis de código).
const RE_MOTIVO_DGII = /^(e-?CF (rechazado|no procesado) por (la )?DGII|La DGII (rechazó|no pudo procesar|no procesó|no aceptó))/i

// Vocabulario del usuario: se quita ANTES de evaluar para que un texto claro
// que dice RNC, e-NCF o E31 no parezca técnico. Se cambia por 'Q' (y no por un
// espacio) para que "E31..E47" siga pareciendo un rango de código.
const RE_VOCABULARIO =
  /\b(e-?NCF|NCF|RNC|e-?CF|ITBIS|DGII|ISR|SKU|PDF|MB|KB|PNG|JPE?G|E3[1-4]|E4[1-7]|606|607|B0[1-4]|B1[1-7])\b/gi
// Lo que el usuario escribió (nombres entre comillas, correos) tampoco cuenta:
// un producto que se llama "Power Bank" no hace técnico al mensaje.
const RE_ENTRECOMILLAS = /'[^']*'|"[^"]*"|«[^»]*»|“[^”]*”|‘[^’]*’/g
const RE_CORREO = /\S+@\S+\.\S+/g

// Envoltorios del backend anterior ("Fallo en emision DGII: <excepción>",
// "Fallo consultando DGII: …"): por construcción siempre llevan detrás el texto
// crudo de una excepción, aunque ese texto por sí solo no dispare otra regla.
const RE_ENVOLTORIO_VIEJO = /^Fallo (en )?(emisi[oó]n|consultando|enviando)\b[^:]*\bDGII\b[^:]*:/i

// Fugas y fallos internos. Se buscan en el texto ORIGINAL, sin quitar
// comillas: una ruta de certificado o un SQL entre comillas sigue siendo una fuga.
const RE_INTERNO = new RegExp(
  [
    'SQLSTATE', 'Exception', 'Stack trace', 'Uncaught', 'Fatal error', '\\.php\\b', 'Integrity constraint',
    'Duplicate entry', 'Database error', 'request failed', 'cURL error', 'Call to (undefined|a member)',
    'Undefined (index|variable|offset|array key|property)', 'on line \\d+', '\\berrno\\b', 'Traceback',
    '\\b(Warning|Notice|Deprecated):', '\\b[A-Z][a-z]+Error\\b', '^\\s*Error interno del servidor',
    // Rutas de archivos del servidor y certificados.
    '[A-Za-z]:\\\\', '(^|[\\s(:])/(var|home|usr|etc|opt|srv|tmp|www)/', '\\.(p12|pfx|pem|key|log)\\b',
  ].join('|'),
  'i',
)
// Nombres de variables de entorno / constantes (DGII_ECF_CERT_PATH,
// PENDIENTE_EMISION). También en el original: nunca deben verse. Tras el
// guion bajo exige letra, para no confundir un SKU como ABC_01.
const RE_CONSTANTE = /\b[A-Z][A-Z0-9]+_[A-Z][A-Z0-9_]{2,}\b/
// …salvo los estados DGII de una factura, que las reglas de negocio citan
// ("ya existe una factura … en estado EN_PROCESO") y el usuario ve en la lista.
const RE_ESTADO_DGII =
  /\b(RFCE_)?(ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|ACEPTADO|RECHAZADO|ENVIADO)\b/g
const RE_JERGA_INTERNA = /\b(php|pdo|sql|mysql|curl|openssl|fpdf|vendor|libxml)\b/i

const RE_RUTA = /\/api\/|\/inventario\/|https?:\/\/|\bsub-?rutas?\b|\bendpoints?\b/i
// Verbos solo en mayúsculas: en minúsculas "post" o "get" pueden ser otra cosa.
const RE_VERBO = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/

const SENALES_TECNICAS: RegExp[] = [
  // snake_case: client_id, tipo_pago, emisor_config, track_id.
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/,
  // Sintaxis de código: llaves, corchetes, <token>, ==, estado=2, "tipo = 1",
  // 01..11, E31..E47, "(31, 32…)", entidades HTML, \n, flechas, ::.
  /[{}[\]<>]|[=!<>]=|\w=\w|\s=\s|\w\.\.\w|\(\s*\d+\s*,\s*\d+|&#?\w+;|\\[nrt]\b|=>|->|::/,
  // Jerga interna.
  /\b(tenant|payload|body|token|bearer|json|base64|api|backend|frontend|header|headers|null|undefined|nan|http|query|string|array|boolean|integer|timestamp|datetime|varchar|stdclass|webhook)\b/i,
  // Formatos para programadores.
  /\b(YYYY|AAAA)-?MM(-?DD)?\b|\bDD[-/]MM[-/](YYYY|AAAA)\b|\bHH:MM(:SS)?\b|#RRGGBB/i,
  // "Falta el id de la categoria": al cajero un id no le dice nada.
  /\b(el|del|un|sin|su) id\b/i,
]

// Frase que empieza con el nombre de un campo en minúscula ("items debe ser…",
// "ncf requerido…", "estado invalido…"). Un texto para el usuario empieza en
// mayúscula; la excepción es e-CF / e-NCF. Se mira en el original: saneado,
// "ncf" ya sería 'Q'.
const RE_CAMPO_AL_INICIO = /^(?!e-?N?CF\b)[a-záéíóúñ]/

// Inglés. Solo palabras que no existen en español: ni 'error', ni 'no', ni
// 'email', ni 'total', ni 'use' o 'has' (que sí se escriben en un texto en tú),
// ni 'user'/'admin' (son nombres de rol).
const RE_INGLES = new RegExp(
  '\\b(' +
    [
      'the', 'there', 'is', 'are', 'was', 'were', 'be', 'been', 'not', 'must', 'found', 'failed', 'fail', 'unable',
      'missing', 'required', 'require', 'invalid', 'valid', 'already', 'allowed', 'provided', 'empty', 'cannot',
      'can', 'should', 'please', 'method', 'and', 'or', 'of', 'to', 'for', 'with', 'without', 'from', 'this',
      'that', 'than', 'more', 'less', 'only', 'exist', 'exists', 'saved', 'updated', 'deleted', 'denied',
      'unauthorized', 'forbidden', 'inactive', 'access', 'expired', 'password', 'username', 'name', 'phone',
      'number', 'characters', 'digits', 'negative', 'amount', 'quantity', 'description', 'price', 'cost', 'file',
      'image', 'upload', 'size', 'type', 'input', 'expected', 'received', 'too', 'small', 'big', 'option',
      'least', 'at', 'an', 'registered', 'taken', 'save', 'update', 'delete', 'database', 'server', 'internal',
      'request', 'response', 'client', 'product', 'category', 'warehouse', 'enabled', 'disabled', 'configured',
      'supported', 'implemented', 'route', 'value', 'field', 'format', 'root', 'template', 'returned',
    ].join('|') +
    ')\\b',
  'gi',
)

// Señales débiles: solas no bastan (XML es un botón visible para los
// contadores, y un "id" suelto se entiende), pero dos juntas sí.
const SENALES_DEBILES: RegExp[] = [
  /\bXML\b/i,
  /\bID\b/i,
  // camelCase / PascalCase pegado: RNCEmisor, TipoeCF, fechaEmision.
  /\b[a-z]+[A-Z][A-Za-z]*\b|\b[A-Z][a-z]+[A-Z][A-Za-z]*\b|\b[A-Z]{2,}[a-z]{2,}[A-Za-z]*\b/,
  /\b(ACECF|ARECF|ANECF|RFCE)\b/,
]

const palabras = (t: string): number => (t.match(/[a-záéíóúñü]{2,}/gi) ?? []).length

/** Copia del texto sin lo que escribió el usuario ni su vocabulario (ver arriba). */
function sanear(texto: string): string {
  return texto.replace(RE_ENTRECOMILLAS, ' Q ').replace(RE_CORREO, ' Q ').replace(RE_VOCABULARIO, 'Q')
}

/**
 * Clasifica un texto: null si se puede enseñar tal cual; si no, qué clase de
 * texto técnico es. Exportada para reutilizarla con textos que no son errores
 * HTTP (avisos del servidor, mensajes de validación).
 */
export function clasificar(texto: string): TipoTecnico | null {
  const t = texto.trim()
  if (!t) return null
  if (RE_ENVOLTORIO_VIEJO.test(t)) return 'interno'
  if (RE_INTERNO.test(t) || RE_CONSTANTE.test(t.replace(RE_ESTADO_DGII, 'Q'))) return 'interno'
  const s = sanear(t)
  if (RE_JERGA_INTERNA.test(s)) return 'interno'
  if (RE_RUTA.test(s) || RE_VERBO.test(s)) return 'ruta'
  if (RE_CAMPO_AL_INICIO.test(t) || SENALES_TECNICAS.some((re) => re.test(s))) return 'tecnico'
  // Inglés: dos palabras, o una sola si es la mitad del texto ("Unauthorized",
  // "Forbidden"). Con una suelta en una frase larga no basta: el nombre de un
  // cliente como "The Home Depot" no vuelve técnico el mensaje.
  const ingles = (s.match(RE_INGLES) ?? []).length
  if (ingles >= 2 || (ingles === 1 && ingles / Math.max(palabras(s), 1) >= 0.5)) return 'tecnico'
  if (SENALES_DEBILES.filter((re) => re.test(s)).length >= 2) return 'tecnico'
  return null
}

/** ¿El texto es técnico (no apto para el usuario)? */
export const esTecnico = (texto: string): boolean => clasificar(texto) !== null

// ---------------------------------------------------------------------------
// Texto de respaldo
// ---------------------------------------------------------------------------

const metodoDe = (ctx: ContextoError) => (ctx.metodo ?? 'GET').toUpperCase()
const rutaDe = (ctx: ContextoError) => (ctx.path ?? '').split('?')[0]
const esLogin = (ctx: ContextoError) => /\/api\/auth\/login\b/.test(rutaDe(ctx))
const esVistaPrevia = (ctx: ContextoError) => /\/preview\b/.test(rutaDe(ctx))
const esDocumento = (ctx: ContextoError) => /\/(pdf|xml)\b/.test(rutaDe(ctx))
const esEstadoDgii = (ctx: ContextoError) => /\/estado\b/.test(rutaDe(ctx))
const esEmisionEcf = (ctx: ContextoError) => metodoDe(ctx) === 'POST' && /^\/api\/facturas\/?$/.test(rutaDe(ctx))

/**
 * ¿La petición pudo dejar algo guardado? Decide si un timeout o una respuesta
 * rota invitan a reintentar. Vista previa y login no guardan nada.
 */
export function esEscritura(ctx: ContextoError): boolean {
  const m = metodoDe(ctx)
  if (m === 'GET' || m === 'HEAD') return false
  return !esVistaPrevia(ctx) && !/\/api\/auth\//.test(rutaDe(ctx))
}

const conReferencia = (texto: string, ref: string | null | undefined) =>
  ref ? `${texto} Si sigue pasando, avisa a soporte con el código ${ref}.` : texto

/** Texto propio del front para un fallo del servidor (5xx o excepción cruda). */
function textoServidor(ctx: ContextoError): string {
  if (esLogin(ctx)) return MSG_LOGIN_SERVIDOR
  if (esEmisionEcf(ctx)) {
    // Un fallo a mitad de la emisión puede haber dejado el e-CF enviado: antes
    // de repetir hay que mirar el listado.
    return 'No se pudo completar la emisión del e-CF. Revisa el listado de facturas antes de intentarlo otra vez.'
  }
  if (esEstadoDgii(ctx)) return 'No se pudo consultar el estado en la DGII. Inténtalo de nuevo en unos minutos.'
  if (esDocumento(ctx)) return 'No se pudo generar el documento. Inténtalo de nuevo en unos minutos.'
  if (/\/api\/aprobaciones-comerciales\b/.test(rutaDe(ctx))) {
    return 'No se pudo enviar la respuesta a la DGII. Inténtalo de nuevo en unos minutos.'
  }
  return MSG_SERVIDOR
}

/** Texto de respaldo por código HTTP y acción, cuando el del servidor no sirve. */
function textoPorStatus(status: number, tipo: TipoTecnico | null, ctx: ContextoError): string {
  const ref = ctx.referencia
  if (esLogin(ctx)) {
    if (tipo === 'interno' || status >= 500 || ctx.ilegible) return conReferencia(MSG_LOGIN_SERVIDOR, ref)
    if (status === 429) return MSG_DEMASIADOS
    // El login responde 401 a un usuario o clave equivocados.
    if (status === 401 || status === 403) return MSG_LOGIN_CREDENCIALES
    // tipo null = el servidor no dijo nada: no se puede culpar a lo que se escribió.
    return tipo === null ? MSG_LOGIN_GENERICO : MSG_LOGIN_FALTAN
  }
  if (status === 401) return MSG_SESION_EXPIRADA
  if (status === 403) return MSG_SIN_PERMISO
  if (status === 405 || (status === 404 && (tipo === 'ruta' || ctx.ilegible))) return MSG_NO_DISPONIBLE
  if (status === 413) return MSG_MUY_GRANDE
  if (status === 429) return MSG_DEMASIADOS
  // 504 = el proxy se cansó de esperar, pero el servidor pudo seguir y guardar.
  if (status === 504 && esEscritura(ctx)) return MSG_TARDO_ESCRITURA
  if (ctx.ilegible && status < 500) return esEscritura(ctx) ? MSG_INESPERADO_ESCRITURA : MSG_INESPERADO
  if (tipo === 'interno' || status >= 500) return conReferencia(textoServidor(ctx), ref)
  if (status === 409) return MSG_CONFLICTO
  if (status === 404) return esDocumento(ctx) ? MSG_ARCHIVO_NO_ENCONTRADO : MSG_NO_ENCONTRADO
  // 400, 422, y los 200 con status:false de clientes y cotizaciones.
  if (esVistaPrevia(ctx)) return 'No se pudo generar la vista previa. Revisa los datos e inténtalo de nuevo.'
  const m = metodoDe(ctx)
  if (m === 'GET') return 'No se pudo mostrar la información. Revisa los filtros o las fechas e inténtalo de nuevo.'
  if (m === 'DELETE') return 'No se pudo eliminar. Actualiza la pantalla e inténtalo de nuevo.'
  if (esEmisionEcf(ctx)) return 'No se pudo emitir el e-CF. Revisa los datos e inténtalo de nuevo.'
  return 'No se pudo guardar. Revisa los datos e inténtalo de nuevo.'
}

/** Frase corta que se añade a un comienzo rescatado (ver rescatarComienzo). */
function pistaPorStatus(status: number, tipo: TipoTecnico, ref: string | null | undefined): string {
  if (tipo === 'interno') return conReferencia('El servidor tuvo un problema; inténtalo de nuevo en unos minutos.', ref)
  if (status >= 500) return ref ? conReferencia('', ref).trim() : 'Si sigue pasando, avisa a soporte.'
  if (status === 404) return 'Puede que se haya eliminado; actualiza la pantalla.'
  if (status === 409) return 'Actualiza la pantalla e inténtalo de nuevo.'
  return 'Revisa los datos e inténtalo de nuevo.'
}

/**
 * Muchos textos técnicos empiezan con una frase clara y después pegan el
 * detalle: "No se pudo crear la factura: SQLSTATE[…]", "El cliente X no tiene
 * crédito habilitado: … (tipo_pago = 1)". Se conserva esa primera frase si es
 * clara y dice algo (3 palabras o más). "Fallo en emision DGII: …" solo dice
 * que falló; ahí lo útil, si lo hay, viene después.
 */
function rescatarComienzo(texto: string): string | null {
  const m = /: |\. |; | \(/.exec(texto)
  if (!m) return null
  const comienzo = texto.slice(0, m.index).trim()
  const resto = texto.slice(m.index + m[0].length).trim()
  if (/^Fallo\b/i.test(comienzo)) return resto ? rescatarComienzo(resto) : null
  if (palabras(comienzo) < 3 || esTecnico(comienzo)) return null
  return /[.!?]$/.test(comienzo) ? comienzo : `${comienzo}.`
}

export interface Humanizado {
  /** Texto para el usuario. */
  mensaje: string
  /** true si no es el del servidor (era técnico, o no vino ninguno). */
  reemplazado: boolean
}

/**
 * Decide qué texto se muestra para una respuesta de error.
 * `raw` = el texto del servidor (null si no mandó ninguno).
 */
export function humanizar(raw: string | null | undefined, status: number, ctx: ContextoError = {}): Humanizado {
  const t = (raw ?? '').trim()
  const login = esLogin(ctx)
  // 401 fuera del login: los textos de AuthMiddleware ("Invalid or inactive API
  // token", "Credenciales requeridas… Bearer <token>") son para integradores y
  // se comparten con ellos. Al cajero solo le sirve saber que debe volver a entrar.
  if (status === 401 && !login) return { mensaje: MSG_SESION_EXPIRADA, reemplazado: true }
  // 405: la app pidió un método que la ruta no tiene; el texto nunca le sirve al cajero.
  if (status === 405) return { mensaje: MSG_NO_DISPONIBLE, reemplazado: true }
  if (!t || ctx.ilegible) return { mensaje: textoPorStatus(status, null, ctx), reemplazado: true }
  if (RE_MOTIVO_DGII.test(t)) return { mensaje: t, reemplazado: false }

  const tipo = clasificar(t)
  if (tipo === null) return { mensaje: t, reemplazado: false }

  if (!login && status !== 403) {
    const comienzo = rescatarComienzo(t)
    if (comienzo) return { mensaje: `${comienzo} ${pistaPorStatus(status, tipo, ctx.referencia)}`, reemplazado: true }
  }
  return { mensaje: textoPorStatus(status, tipo, ctx), reemplazado: true }
}

// ---------------------------------------------------------------------------
// Fábricas de ApiError
// ---------------------------------------------------------------------------

function avisarReemplazo(motivo: string, ctx: ContextoError, status: number, original: string): void {
  console.warn(`[API] ${motivo}`, {
    metodo: metodoDe(ctx),
    path: ctx.path ?? '',
    status,
    original,
    referencia: ctx.referencia ?? null,
  })
}

/** error_id del cuerpo, o el código que traía el texto del ErrorHandler viejo. */
export function referenciaDe(body: unknown, raw?: string | null): string | null {
  const id = (body as { error_id?: unknown } | null)?.error_id
  if (typeof id === 'string' && id.trim()) return id.trim()
  if (typeof id === 'number') return String(id)
  const m = /Referencia:\s*([\w-]+)/i.exec(raw ?? '')
  return m ? m[1] : null
}

/** El `error` del sobre, solo si es un texto con contenido. */
export function textoError(body: unknown): string | null {
  const e = (body as { error?: unknown } | null)?.error
  return typeof e === 'string' && e.trim() ? e : null
}

/**
 * ApiError para una respuesta de error del servidor. `raw` = texto del sobre
 * (null si no vino). Si el texto se reemplaza, el original va a la consola.
 */
export function errorDeRespuesta(
  raw: string | null,
  status: number,
  ctx: ContextoError = {},
  datos?: unknown,
): ApiError {
  const referencia = ctx.referencia ?? referenciaDe(null, raw)
  const c = { ...ctx, referencia }
  const { mensaje, reemplazado } = humanizar(raw, status, c)
  const original = raw ?? (ctx.ilegible ? `Respuesta no válida del servidor (HTTP ${status}).` : `Error HTTP ${status}.`)
  // Con un cuerpo ilegible no se avisa aquí: quien lo leyó ya registró su comienzo.
  if (reemplazado && !ctx.ilegible) {
    avisarReemplazo(raw ? 'mensaje técnico reemplazado' : 'error sin texto del servidor', c, status, original)
  }
  return new ApiError(mensaje, status, { original, delServidor: raw !== null, reemplazado, referencia, datos })
}

/**
 * 401: siempre el texto propio del front (ver humanizar). El del servidor se
 * guarda en `original` y va a la consola. Quien llama cierra la sesión.
 */
export function sesionExpirada(raw: string | null, ctx: ContextoError = {}): ApiError {
  const original = raw ?? 'HTTP 401'
  if (raw) avisarReemplazo('401 del servidor', ctx, 401, original)
  return new ApiError(MSG_SESION_EXPIRADA, 401, { original, delServidor: raw !== null, reemplazado: raw !== null })
}

/** Normaliza fallos de red/timeout de fetch a un ApiError con mensaje claro. */
export function networkError(e: unknown, ctx: ContextoError = {}): ApiError {
  const timeout = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
  const mensaje = timeout ? (esEscritura(ctx) ? MSG_TARDO_ESCRITURA : MSG_TARDO) : MSG_SIN_CONEXION
  const original = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  console.warn('[API] fallo de red', { metodo: metodoDe(ctx), path: ctx.path ?? '', original })
  return new ApiError(mensaje, 0, { original })
}

// ---------------------------------------------------------------------------
// Validación local (Zod) antes de enviar
// ---------------------------------------------------------------------------

/** Lo mínimo de un issue de Zod que se usa (sin atar este módulo a la versión de Zod). */
export interface IssueValidacion {
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

/**
 * Texto por campo del esquema. Claves: el nombre del campo (la última parte de
 * la ruta, p. ej. 'cantidad'), el primer nivel ('comprador'), '*linea' para un
 * campo de línea sin texto propio y '*' para lo demás.
 */
export type TextosCampos = Record<string, string>

const conPunto = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`)
// "La cantidad…" -> "la cantidad…" tras "Línea 2: ", sin estropear siglas ("RNC…").
const minusculaInicial = (t: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t)

/**
 * Convierte los errores de un esquema Zod en un ApiError con UN texto claro:
 * el mensaje propio del esquema si lo tiene (ya está en español), o el del
 * campo; nunca la ruta de Zod ("items.0.cantidad") ni su texto en inglés.
 */
export function errorDeValidacion(
  issues: ReadonlyArray<IssueValidacion>,
  textos: TextosCampos,
  ctx: ContextoError = {},
): ApiError {
  const issue = issues[0]
  const path = issue?.path ?? []
  const claves = path.filter((p): p is string => typeof p === 'string')
  const indice = path.find((p): p is number => typeof p === 'number')
  const linea = indice !== undefined ? indice + 1 : null
  const propio = issue && issue.message.trim() && !esTecnico(issue.message) ? issue.message.trim() : null
  const delCampo =
    textos[claves[claves.length - 1] ?? ''] ??
    (linea !== null ? textos['*linea'] : textos[claves[0] ?? '']) ??
    textos['*']
  let mensaje = conPunto(propio ?? delCampo ?? 'Hay un dato que no es válido. Revisa el formulario e inténtalo de nuevo.')
  if (linea !== null) mensaje = `Línea ${linea}: ${minusculaInicial(mensaje)}`
  const original = issues.map((i) => `${i.path.map(String).join('.') || '(raíz)'}: ${i.message}`).join('; ')
  console.warn('[API] datos rechazados antes de enviar', { metodo: metodoDe(ctx), path: ctx.path ?? '', original })
  return new ApiError(mensaje, 422, { original, reemplazado: propio === null })
}

// Mock de la API de Fiscalpoint Express: solo desarrollo, solo loopback, datos inventados.
//
// Uso: node express/dev/mock-api.mjs [--host=127.0.0.1] [--port=8787]
//
// Qué hace este esqueleto (sin dependencias, ESM puro):
//   - diez personas de prueba (contratos 4.4): login por nombre o por correo, `/me` y signout;
//   - la lista blanca de rutas del contrato 4.3(f), con los mismos textos y códigos de error;
//   - el analizador de tokens de falla (`[drop]`, `rechazo`, ...) y el extractor de su texto libre;
//   - las personas `flaky`, `slow` y `offline`, que rompen la red a propósito;
//   - la costura `MANEJADORES`, donde los planes 06, 07 y 09 empujan sus rutas.
//
// Solo escucha en loopback: el mock no valida nada real y sus datos son falsos. El proxy de
// desarrollo del .env de la raíz apunta a PRODUCCIÓN, por eso Express habla únicamente con este mock.
// Como CLI corre solo si es el archivo de entrada, de modo que una prueba puede importarlo.

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Personas (contratos 4.4). Clave `<persona>`, contraseña `mock-<persona>`,
// correo `<persona>@express.test`. Ids y RNC inventados con la forma 1310000NN.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Persona
 * @property {string} nombre   Nombre con el que se entra (también sale como `username`).
 * @property {'admin'|'user'} rol
 * @property {'express'|'completa'} edicion
 * @property {object|null} entitlements  Bloque `user.entitlements` de 4.3(a), con la lista `modulos` que lee la lista
 *   blanca. `null`: el login y `/me` responden sin bloque y la lista blanca no se aplica.
 * @property {'flaky'|'slow'|'offline'|null} falla
 */

const MODULOS = ['facturacion', 'clientes', 'productos', 'usuarios', 'configuracion']
const dos = (n) => String(n).padStart(2, '0')

/** Bloque de 4.3(a). `tipos` son los tipos de venta; el 34 (anulación) se deriva siempre que haya alguno. */
function bloque(n, tipos, modulos = MODULOS) {
  return {
    edicion: 'express',
    tenant: { id: n, nombre: `Empresa Mock ${dos(n)}`, rnc: `1310000${dos(n)}`, ambiente: 'testecf' },
    modulos: [...modulos],
    tipos_ecf: [...tipos, '34'],
    capacidades: { idempotencia: true, reconciliador: true, certificado: true },
  }
}

const definir = (nombre, rol, entitlements, edicion = 'express', falla = null) => [nombre, { nombre, rol, edicion, entitlements, falla }]

/** @type {Record<string, Persona>} */
export const PERSONAS = Object.fromEntries([
  definir('admin.e45', 'admin', bloque(1, ['45'])),
  definir('user.e45', 'user', bloque(1, ['45'])), // el facturador de la misma empresa que admin.e45
  definir('admin.multi', 'admin', bloque(2, ['31', '32', '45'])),
  definir('admin.e32', 'admin', bloque(3, ['32'], ['facturacion', 'productos', 'usuarios', 'configuracion'])), // sin `clientes`
  definir('admin.sinproductos', 'admin', bloque(4, ['45'], MODULOS.filter((m) => m !== 'productos'))),
  definir('admin.completa', 'admin', null, 'completa'), // empresa `completa`: sin bloque y sin lista blanca
  definir('admin.sinbloque', 'admin', null), // empresa Express cuya respuesta olvida el bloque: el cliente debe fallar cerrado
  definir('flaky', 'admin', bloque(5, ['45']), 'express', 'flaky'), // cada tercera petición (fuera de /api/auth) da un 500 HTML
  definir('slow', 'admin', bloque(6, ['45']), 'express', 'slow'), // toda respuesta tarda DEMORA_SLOW_MS
  definir('offline', 'admin', bloque(7, ['45']), 'express', 'offline'), // tras el login, cada petición pierde el socket
])

const DEMORA_SLOW_MS = 2000
const TOKEN_DE_MODULO = { facturacion: 'facturas', clientes: 'clients', productos: 'products', usuarios: 'users', configuracion: 'ncf' }
const ROL_USER = ['facturas', 'clients', 'products', 'unidades'] // el preset Facturador del rol `user`

/** Permisos del usuario: los del rol cruzados con los módulos del plan (`permisosEfectivos` del API). */
function permisosDe(p) {
  if (p.edicion === 'completa') return ['*']
  const modulos = p.entitlements?.modulos ?? MODULOS // sinbloque: el servidor sí los calcula aunque no los envíe
  const fichas = modulos.map((m) => TOKEN_DE_MODULO[m])
  if (modulos.some((m) => m === 'facturacion' || m === 'clientes' || m === 'productos')) fichas.push('unidades')
  return p.rol === 'admin' ? fichas : ROL_USER.filter((f) => fichas.includes(f))
}

/** El objeto `user` de login y `/me`: id, email, username, name, role, permissions y, si hay bloque, entitlements. */
function usuarioDe(p) {
  const u = {
    id: 101 + Object.keys(PERSONAS).indexOf(p.nombre),
    email: `${p.nombre}@express.test`,
    username: p.nombre,
    name: `Mock ${p.nombre}`,
    role: p.rol,
    permissions: permisosDe(p),
  }
  if (p.entitlements) u.entitlements = structuredClone(p.entitlements)
  return u
}

// ---------------------------------------------------------------------------
// Tokens de falla (contratos 4.4), buscados en texto libre y nunca en una cabecera.
// ---------------------------------------------------------------------------

const TOKENS_CON_CORCHETES = ['drop', 'slow', '500', 'html502', '403', '401'].map((n) => [n, new RegExp(`\\[${n}\\]`, 'i')])
// Palabra entera: `e34rechazo` no contiene `rechazo` porque lo precede un dígito.
const TOKENS_PALABRA = ['rechazo', 'incierto', 'nosaved', 'validacion', 'enCurso', 'norange', 'e34rechazo'].map((n) => [n, new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'iu')])

/**
 * Los tokens de falla que trae un texto, con su nombre canónico. Los de corchetes se escriben `[drop]`;
 * los demás valen como palabra entera. Sin distinguir mayúsculas.
 * @param {string} texto
 * @returns {Set<string>}
 */
export function parseFaultTokens(texto) {
  const t = String(texto ?? '')
  const hallados = new Set()
  for (const [n, re] of [...TOKENS_CON_CORCHETES, ...TOKENS_PALABRA]) if (re.test(t)) hallados.add(n)
  return hallados
}

/**
 * El texto libre donde se buscan los tokens: `items[].nombre_item`, `items[].descripcion`,
 * `informacion_referencia.razon_modificacion`, `cliente.nombre` y `no_autorizacion`.
 * @param {unknown} cuerpo
 * @returns {string}
 */
export function textoDeFallas(cuerpo) {
  const c = cuerpo && typeof cuerpo === 'object' ? /** @type {any} */ (cuerpo) : {}
  const partes = []
  for (const it of Array.isArray(c.items) ? c.items : []) partes.push(it?.nombre_item, it?.descripcion)
  partes.push(c.informacion_referencia?.razon_modificacion, c.cliente?.nombre, c.no_autorizacion)
  return partes.filter((x) => typeof x === 'string' && x !== '').join(' ')
}

// ---------------------------------------------------------------------------
// Lista blanca de rutas: contrato 4.3(f), fila por fila (`rutas` de config/editions.php del API).
// `path` se ancla sobre lo que sigue a `/api/<route>/`; `modulos` es "cualquiera de" (vacío: siempre);
// `admin`: solo el rol de nombre `admin`. Lo que no aparece aquí se deniega: gastos, facturas-simples,
// cotizaciones, conduces, proveedores, inventario, categories, warehouses, reportes,
// aprobaciones-comerciales, ecf, facturacion-electronica, roles, branding, landing, audit-logs, pos,
// pos-admin, integracion, y también facturas/preview, PUT y DELETE de facturas, DELETE de clients/products
// y products/imagen. `auth/login` nunca llega a la lista (es pública); `PUT auth/password` lo añade el plan 05.
// ---------------------------------------------------------------------------

const RUTAS = [
  { route: 'auth', metodos: ['GET'], path: /^me$/, modulos: [], admin: false },
  { route: 'auth', metodos: ['POST'], path: /^signout$/, modulos: [], admin: false },
  { route: 'facturas', metodos: ['GET'], path: /^(|stats|avisos|modificables|\d+\/(pdf|xml|estado))$/, modulos: ['facturacion'], admin: false },
  { route: 'facturas', metodos: ['POST'], path: /^(|\d+\/reenviar)$/, modulos: ['facturacion'], admin: false },
  { route: 'clients', metodos: ['GET', 'POST', 'PUT'], path: /^(|\d+)$/, modulos: ['clientes'], admin: false },
  { route: 'products', metodos: ['GET', 'POST', 'PUT'], path: /^(|\d+)$/, modulos: ['productos'], admin: false },
  { route: 'rnc', metodos: ['GET'], path: /^consulta$/, modulos: ['clientes'], admin: false },
  { route: 'unidades-medida', metodos: ['GET'], path: /^$/, modulos: ['facturacion', 'productos'], admin: false },
  { route: 'emisor', metodos: ['GET'], path: /^$/, modulos: ['facturacion', 'configuracion'], admin: false },
  { route: 'ncf', metodos: ['GET'], path: /^rangos$/, modulos: ['configuracion'], admin: false },
  { route: 'ncf', metodos: ['POST'], path: /^rangos$/, modulos: ['configuracion'], admin: true },
  { route: 'users', metodos: ['GET', 'POST', 'PUT', 'DELETE'], path: /^(|\d+)$/, modulos: ['usuarios'], admin: true },
]

const PERMITIDO = { permitido: true, http: 200, codigo: null, modulo: null }
const solicitudInvalida = () => ({ permitido: false, http: 400, codigo: 'SOLICITUD_INVALIDA', modulo: null })

/**
 * Parte una URI como `parse_url` de PHP: sin fragmento, y con `//host/ruta` leído como host y ruta.
 * `null` cuando PHP daría `false` (`///x`).
 */
function partirUri(uri) {
  let u = String(uri)
  const almohadilla = u.indexOf('#')
  if (almohadilla !== -1) u = u.slice(0, almohadilla)
  if (u.startsWith('///')) return null
  if (u.startsWith('//')) {
    const fin = u.slice(2).search(/[/?]/)
    u = fin === -1 ? '' : u.slice(2 + fin)
  }
  const interrogante = u.indexOf('?')
  return interrogante === -1 ? { path: u, query: '' } : { path: u.slice(0, interrogante), query: u.slice(interrogante + 1) }
}

/**
 * Decisión pura de la lista blanca, con la forma de `TenantEntitlements::evaluarRuta` del API.
 * Una persona `completa` o sin bloque pasa sin más (identidad). Si no, 400 `SOLICITUD_INVALIDA` ante un
 * segmento `..` (o `%2e%2e`) o un `/api/` dentro de la query; 403 `EDICION_NO_INCLUYE` si ninguna fila
 * encaja o si ningún módulo de la fila está en el plan; 403 sin código en una fila de admin para otro rol.
 * `modulo` es el primer módulo de la fila que encajó, o null.
 * @param {string} metodo
 * @param {string} rutaCompleta  URI tal como llegó, con su query.
 * @param {Persona} persona
 * @returns {{permitido: boolean, http: number, codigo: string|null, modulo: string|null}}
 */
export function evaluarRuta(metodo, rutaCompleta, persona) {
  if (!persona || persona.edicion === 'completa' || !persona.entitlements) return { ...PERMITIDO }
  const partes = partirUri(rutaCompleta)
  if (!partes) return solicitudInvalida()
  const { path, query } = partes
  if (path.split('/').some((s) => s === '..' || /^(%2e|\.){2}$/i.test(s)) || query.includes('/api/')) return solicitudInvalida()

  const denegado = (codigo, modulo = null) => ({ permitido: false, http: 403, codigo, modulo })
  if (path === '' || path.endsWith('/')) return denegado('EDICION_NO_INCLUYE') // el Router sirve docs.html para una ruta con `/` final
  // Como el Router: lo que sigue al primer `/api/` (o la ruta sin barras iniciales); la ruta es el primer segmento, sin tocar mayúsculas.
  const apiPos = path.indexOf('/api/')
  const resto = apiPos !== -1 ? path.slice(apiPos + 5) : path
  const [route, ...demas] = resto.replace(/^\/+/, '').split('/')
  const m = String(metodo).toUpperCase()
  const fila = RUTAS.find((r) => r.route === route && r.metodos.includes(m) && r.path.test(demas.join('/')))
  if (!fila) return denegado('EDICION_NO_INCLUYE')
  const modulo = fila.modulos[0] ?? null
  if (fila.modulos.length && !fila.modulos.some((x) => persona.entitlements.modulos.includes(x))) return denegado('EDICION_NO_INCLUYE', modulo)
  if (fila.admin && persona.rol.trim().toLowerCase() !== 'admin') return denegado(null, modulo)
  return { ...PERMITIDO, modulo }
}

// ---------------------------------------------------------------------------
// Loopback
// ---------------------------------------------------------------------------

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

/** Lanza salvo para `127.0.0.1`, `localhost` o `::1`: el mock no se expone fuera de este equipo. */
export function asegurarLoopback(host) {
  if (!LOOPBACK.has(host)) {
    throw new Error(`El mock solo puede escuchar en loopback (127.0.0.1, localhost o ::1), no en "${host}". Sus datos son de prueba y no deben salir de este equipo.`)
  }
}

// ---------------------------------------------------------------------------
// La costura de rutas y el servidor
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Respuesta
 * @property {number} http
 * @property {unknown} [cuerpo]       Se envía como JSON.
 * @property {string} [html]          Se envía como text/html (una página de error de proxy, por ejemplo).
 * @property {Uint8Array} [binario]   Se envía tal cual, con `tipo` como Content-Type (el PDF del plan 06).
 * @property {string} [tipo]
 * @property {boolean} [destruir]     Destruye el socket sin responder (una respuesta ambigua).
 * @property {number} [demoraMs]      Espera antes de responder o de destruir.
 */

/**
 * Rutas que añaden los demás planes. Una entrada responde cuando `metodo` coincide y `patron` encaja con la
 * ruta sin query (`/api/facturas/2/xml`), y solo si la lista blanca ya dejó pasar la petición.
 * `ctx.query` es un `URLSearchParams`, `ctx.cuerpo` el JSON recibido (null si no vino o no era JSON) y
 * `ctx.estado` el estado del servidor, para que cada plan guarde ahí lo suyo.
 * @type {Array<{metodo: string, patron: RegExp, atender: (ctx: {metodo: string, ruta: string, query: URLSearchParams, cuerpo: any, persona: Persona, token: string, estado: any}) => Respuesta | Promise<Respuesta>}>}
 */
export const MANEJADORES = []

const PAGINA_500 = '<!DOCTYPE html>\n<html><head><title>500 Internal Server Error</title></head>\n<body><h1>Internal Server Error</h1></body></html>\n'
const MSG_EDICION = 'Tu plan Express no incluye esta función.'
const MSG_ADMIN = 'No tienes permiso para hacer esto. Pídeselo a un administrador.'
const MSG_LOGIN = 'El usuario o la contraseña no son correctos. Revísalos e inténtalo de nuevo.'
const MSG_SIN_CREDENCIALES = 'Credenciales requeridas. Integracion: X-API-KEY + X-API-SECRET. App: Authorization: Bearer <token>.'

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function leerCuerpo(req) {
  const trozos = []
  for await (const t of req) trozos.push(t)
  const texto = Buffer.concat(trozos).toString('utf8')
  if (!texto.trim()) return null
  try { return JSON.parse(texto) } catch { return null }
}

/** El token de sesión de la app: `X-API-KEY` primero, luego `Authorization: Bearer`, como `AuthMiddleware`. */
function tokenDe(req) {
  const clave = req.headers['x-api-key']
  if (typeof clave === 'string' && clave.trim()) return clave.trim()
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())
  return m ? m[1].trim() : null
}

/** 401 de la sesión: los /api/auth/* usan el sobre `success`, el resto el `{status:false}` de `sendUnauthorized`. */
const noAutorizado = (esAuth, error) => ({ http: 401, cuerpo: esAuth ? { success: false, error } : { status: false, error } })

function login(cuerpo, estado) {
  const quien = typeof cuerpo?.emailOrUsername === 'string' ? cuerpo.emailOrUsername.trim() : ''
  const clave = typeof cuerpo?.password === 'string' ? cuerpo.password : ''
  // Como el API real, estas dos validaciones responden 200 con success:false.
  if (!quien) return { http: 200, cuerpo: { success: false, error: 'Escribe tu correo o tu usuario.' } }
  if (!clave.trim()) return { http: 200, cuerpo: { success: false, error: 'Escribe tu contraseña.' } }
  const p = Object.values(PERSONAS).find((x) => [x.nombre, `${x.nombre}@express.test`].includes(quien.toLowerCase()))
  if (!p || clave !== `mock-${p.nombre}`) return { http: 401, cuerpo: { success: false, error: MSG_LOGIN } }
  const token = randomBytes(24).toString('hex')
  estado.sesiones.set(token, { persona: p, sinAuth: 0 })
  const r = { http: 200, cuerpo: { success: true, data: { token, user: usuarioDe(p) } } }
  return p.falla === 'slow' ? { ...r, demoraMs: DEMORA_SLOW_MS } : r
}

/** Lo que responde el mock a una petición. Orden: login, sesión, fallas de red, lista blanca, /me y signout, manejadores. */
async function procesar(req, estado) {
  const url = req.url ?? '/'
  const metodo = (req.method ?? 'GET').toUpperCase()
  const corte = url.indexOf('?')
  const ruta = corte === -1 ? url : url.slice(0, corte)
  const query = new URLSearchParams(corte === -1 ? '' : url.slice(corte + 1))
  const cuerpo = await leerCuerpo(req)

  if (metodo === 'POST' && /^\/api\/auth\/login\/?$/.test(ruta)) return login(cuerpo, estado)

  const esAuth = ruta.startsWith('/api/auth/')
  const token = tokenDe(req)
  if (!token) return noAutorizado(esAuth, MSG_SIN_CREDENCIALES)
  const sesion = estado.sesiones.get(token)
  if (!sesion) return noAutorizado(esAuth, 'Invalid or inactive API token')
  const p = sesion.persona

  if (p.falla === 'offline') return { http: 500, destruir: true }
  if (p.falla === 'flaky' && !esAuth && ++sesion.sinAuth % 3 === 0) return { http: 500, html: PAGINA_500 }
  const r = await atenderSesion({ metodo, ruta, url, query, cuerpo, persona: p, token, estado })
  return p.falla === 'slow' ? { ...r, demoraMs: Math.max(r.demoraMs ?? 0, DEMORA_SLOW_MS) } : r
}

async function atenderSesion({ metodo, ruta, url, query, cuerpo, persona: p, token, estado }) {
  const d = evaluarRuta(metodo, url, p)
  if (!d.permitido) {
    if (d.http === 400) return { http: 400, cuerpo: { status: false, error: 'La solicitud no es válida.', codigo: d.codigo } }
    return { http: 403, cuerpo: d.codigo ? { status: false, error: MSG_EDICION, codigo: d.codigo } : { status: false, error: MSG_ADMIN } }
  }
  if (metodo === 'GET' && /^\/api\/auth\/me\/?$/.test(ruta)) return { http: 200, cuerpo: { success: true, data: { user: usuarioDe(p) } } }
  if (metodo === 'POST' && /^\/api\/auth\/signout\/?$/.test(ruta)) {
    estado.sesiones.delete(token)
    return { http: 200, cuerpo: { success: true, message: 'Signed out successfully' } }
  }
  const h = MANEJADORES.find((x) => x.metodo === metodo && x.patron.test(ruta))
  if (h) return h.atender({ metodo, ruta, query, cuerpo, persona: p, token, estado })
  return { http: 404, cuerpo: { status: false, error: 'El mock todavía no implementa esta ruta.' } }
}

async function escribir(req, res, r) {
  if (r.demoraMs) await esperar(r.demoraMs)
  if (r.destruir) { req.socket.destroy(); return }
  if (r.binario) {
    res.writeHead(r.http, { 'Content-Type': r.tipo ?? 'application/octet-stream', 'Content-Length': r.binario.byteLength })
    res.end(r.binario)
  } else if (r.html !== undefined) {
    res.writeHead(r.http, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(r.html)
  } else if (r.cuerpo !== undefined) {
    const json = JSON.stringify(r.cuerpo)
    res.writeHead(r.http, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) })
    res.end(json)
  } else {
    res.writeHead(r.http)
    res.end()
  }
}

/**
 * Crea el servidor del mock; quien lo llama hace `listen` (y decide el host: ver `asegurarLoopback`).
 * Cada servidor trae su propio estado de sesiones.
 * @returns {http.Server}
 */
export function crearServidor() {
  const estado = { sesiones: new Map() }
  return http.createServer(async (req, res) => {
    let r
    try {
      r = await procesar(req, estado)
    } catch (e) {
      console.error('[mock] error atendiendo', req.method, req.url, e)
      r = { http: 500, cuerpo: { status: false, error: 'Error interno del mock.' } }
    }
    await escribir(req, res, r)
  })
}

// ---------------------------------------------------------------------------
// CLI (solo si este archivo es el de entrada)
// ---------------------------------------------------------------------------

const USO = 'Uso: node express/dev/mock-api.mjs [--host=127.0.0.1] [--port=8787]'

function salir(mensaje) {
  console.error(mensaje)
  process.exit(2)
}

function iniciar(args) {
  let host = '127.0.0.1'
  let puerto = 8787
  for (const a of args) {
    const m = /^--(host|port)=(.*)$/.exec(a)
    if (!m) salir(`Argumento desconocido: "${a}". ${USO}`)
    else if (m[1] === 'host') host = m[2]
    else if (/^\d{1,5}$/.test(m[2]) && Number(m[2]) <= 65535) puerto = Number(m[2])
    else salir(`El puerto "${m[2]}" no es válido. ${USO}`)
  }
  try { asegurarLoopback(host) } catch (e) { salir(e.message) }
  const srv = crearServidor()
  srv.on('error', (e) => {
    console.error(`No se pudo iniciar el mock en ${host}:${puerto}: ${e.message}`)
    process.exit(1)
  })
  srv.listen(puerto, host, () => console.log(`mock en http://${host.includes(':') ? `[${host}]` : host}:${srv.address().port}`))
}

function esEntrada() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])) } catch { return false }
}

if (esEntrada()) iniciar(process.argv.slice(2))

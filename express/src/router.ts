// El router de hash de Express (anexo 5.4): sin dependencias, y se porta igual en el servidor de desarrollo, en las vistas previas de Vercel y en
// producción, sin regla de reescritura para los enlaces directos. Lo puro (leer y escribir el hash, el módulo de cada ruta y qué hacer con el
// historial) va en funciones sueltas; lo que toca la ventana va en `crearNavegador`, que recibe la ventana para poder probarlo sin DOM, y las
// funciones `navegar`, `atras`, `irATab` y `useRuta` son ese navegador sobre `window`, creado la primera vez que se usa (importar este módulo no
// toca `window`).
import { useMemo, useSyncExternalStore } from 'react'
import type { Modulo } from '~/entitlements'

export type Ruta =
  | { id: 'facturas'; q?: string; estado?: string; tipo?: string }
  | { id: 'factura'; facturaId: number }
  | { id: 'anular'; facturaId: number }
  | { id: 'facturar' }
  | { id: 'facturar-productos' }
  | { id: 'facturar-revisar' }
  | { id: 'facturar-resultado'; clave: string }
  | { id: 'clientes' }
  | { id: 'cliente-nuevo' }
  | { id: 'cliente'; clienteId: number }
  | { id: 'productos' }
  | { id: 'producto'; productoId: number }
  | { id: 'mas' }
  | { id: 'mas-empresa' }
  | { id: 'mas-numeracion' }
  | { id: 'mas-usuarios' }

// --- Leer y escribir el hash --------------------------------------------------------------------------------------------------------

/** Los valores de `estado` que existen en Facturas: los de los chips Pendientes, Por revisar y Aceptadas (Todas no lleva `estado`). */
const ESTADOS = ['pendiente', 'accion', 'aprobado']

/** El código de un comprobante en el filtro por tipo: dos dígitos. Que el tenant lo tenga lo decide la guardia (entitlements.ts), no este módulo. */
const CODIGO_DE_TIPO = /^\d{2}$/

/** Un id de la URL: entero positivo en su forma canónica (sin signo, ceros a la izquierda ni decimales); null si no lo es. */
function idDe(texto: string | undefined): number | null {
  if (texto === undefined || !/^[1-9]\d*$/.test(texto)) return null
  const n = Number(texto)
  return Number.isSafeInteger(n) ? n : null
}

/** El texto de un segmento de la URL ya decodificado; null si el `%` está mal formado (`decodeURIComponent` lanza). */
function decodificar(segmento: string): string | null {
  try {
    return decodeURIComponent(segmento)
  } catch {
    return null
  }
}

/** El carácter de reemplazo, U+FFFD. */
const REEMPLAZO = String.fromCharCode(0xfffd)

/**
 * `encodeURIComponent` que no lanza. Con un sustituto suelto (media pareja de un emoji, que un teclado puede dejar a medias en el campo de
 * búsqueda) `encodeURIComponent` lanza URIError: aquí ese carácter se cambia por U+FFFD y un emoji entero pasa tal cual.
 */
function codificar(texto: string): string {
  try {
    return encodeURIComponent(texto)
  } catch {
    // `Array.from` recorre por caracteres enteros: una pareja viene junta (longitud 2) y un sustituto suelto viene solo (longitud 1).
    const suelto = (c: string): boolean => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff
    return encodeURIComponent(Array.from(texto, (c) => (suelto(c) ? REEMPLAZO : c)).join(''))
  }
}

/** El inicio. Una ruta nueva en cada llamada: quien la reciba puede cambiarla sin tocar la de otro. */
function inicio(): Ruta {
  return { id: 'facturas' }
}

/**
 * La ruta de Facturas con sus filtros. Cada uno que no sea válido se descarta solo y deja los demás. `q` va tal cual, sin recortar: el campo de
 * búsqueda escribe aquí mientras se teclea y un espacio al final es del usuario.
 */
function facturas(consulta: string): Ruta {
  const params = new URLSearchParams(consulta)
  const ruta: { id: 'facturas'; q?: string; estado?: string; tipo?: string } = { id: 'facturas' }
  const q = params.get('q')
  if (q) ruta.q = q
  const estado = params.get('estado')
  if (estado !== null && ESTADOS.includes(estado)) ruta.estado = estado
  const tipo = params.get('tipo')
  if (tipo !== null && CODIGO_DE_TIPO.test(tipo)) ruta.tipo = tipo
  return ruta
}

/** La ruta de hasta tres segmentos (`undefined` si faltan), o null si no es ninguna. Los filtros son solo de Facturas. */
function rutaDe(a: string | undefined, b: string | undefined, c: string | undefined, consulta: string): Ruta | null {
  switch (a) {
    case undefined:
      return facturas(consulta)
    case 'facturas': {
      if (b === undefined) return facturas(consulta)
      const facturaId = idDe(b)
      if (facturaId === null) return null
      if (c === undefined) return { id: 'factura', facturaId }
      return c === 'anular' ? { id: 'anular', facturaId } : null
    }
    case 'facturar': {
      if (b === undefined) return { id: 'facturar' }
      if (b === 'productos' && c === undefined) return { id: 'facturar-productos' }
      if (b === 'revisar' && c === undefined) return { id: 'facturar-revisar' }
      if (b === 'resultado' && c !== undefined) {
        const clave = decodificar(c)
        return clave === null ? null : { id: 'facturar-resultado', clave }
      }
      return null
    }
    case 'clientes': {
      if (b === undefined) return { id: 'clientes' }
      if (c !== undefined) return null
      if (b === 'nuevo') return { id: 'cliente-nuevo' }
      const clienteId = idDe(b)
      return clienteId === null ? null : { id: 'cliente', clienteId }
    }
    case 'productos': {
      if (b === undefined) return { id: 'productos' }
      if (c !== undefined) return null
      const productoId = idDe(b)
      return productoId === null ? null : { id: 'producto', productoId }
    }
    case 'mas': {
      if (b === undefined) return { id: 'mas' }
      if (c !== undefined) return null
      if (b === 'empresa') return { id: 'mas-empresa' }
      if (b === 'numeracion') return { id: 'mas-numeracion' }
      return b === 'usuarios' ? { id: 'mas-usuarios' } : null
    }
    default:
      return null
  }
}

/**
 * La ruta de un hash (`location.hash`, con o sin `#`). Lo que no es una ruta de la lista (anexo 5.4), un id que no es un entero positivo o
 * un segmento de sobra cae en Facturas: nunca lanza ni deja una pantalla sin ruta.
 */
export function parseHash(hash: string): Ruta {
  const texto = hash.startsWith('#') ? hash.slice(1) : hash
  const corte = texto.indexOf('?')
  const camino = corte === -1 ? texto : texto.slice(0, corte)
  const consulta = corte === -1 ? '' : texto.slice(corte + 1)
  const [a, b, c, ...resto] = camino.split('/').filter((segmento) => segmento !== '')
  if (resto.length > 0) return inicio()
  return rutaDe(a, b, c, consulta) ?? inicio()
}

/**
 * El hash de una ruta: la forma canónica que `parseHash` lee de vuelta. El inicio sin filtros es `#/facturas` y no el hash vacío: es lo que usan
 * la barra y la guardia, y navegar a un hash vacío con `location.replace` recargaría la página. Los filtros van en el orden `q`, `estado`, `tipo`,
 * sin los vacíos y codificados. Tampoco lanza, con el texto que sea.
 */
export function formatHash(r: Ruta): string {
  switch (r.id) {
    case 'facturas': {
      const params: string[] = []
      if (r.q) params.push(`q=${codificar(r.q)}`)
      if (r.estado) params.push(`estado=${codificar(r.estado)}`)
      if (r.tipo) params.push(`tipo=${codificar(r.tipo)}`)
      return params.length === 0 ? '#/facturas' : `#/facturas?${params.join('&')}`
    }
    case 'factura':
      return `#/facturas/${r.facturaId}`
    case 'anular':
      return `#/facturas/${r.facturaId}/anular`
    case 'facturar':
      return '#/facturar'
    case 'facturar-productos':
      return '#/facturar/productos'
    case 'facturar-revisar':
      return '#/facturar/revisar'
    case 'facturar-resultado':
      return `#/facturar/resultado/${codificar(r.clave)}`
    case 'clientes':
      return '#/clientes'
    case 'cliente-nuevo':
      return '#/clientes/nuevo'
    case 'cliente':
      return `#/clientes/${r.clienteId}`
    case 'productos':
      return '#/productos'
    case 'producto':
      return `#/productos/${r.productoId}`
    case 'mas':
      return '#/mas'
    case 'mas-empresa':
      return '#/mas/empresa'
    case 'mas-numeracion':
      return '#/mas/numeracion'
    case 'mas-usuarios':
      return '#/mas/usuarios'
  }
}

/**
 * El módulo que pide una ruta y si pide ser administrador (anexo 5.4). Facturas y el asistente piden `facturacion`; Clientes, `clientes`;
 * Productos, `productos`; Mi empresa y Numeración, `configuracion` (Numeración la ve también quien no es administrador, de solo lectura);
 * Usuarios, `usuarios` y ser administrador; Más no pide nada. La política que usa esto es `guardia` (entitlements.ts).
 */
export function moduloDeRuta(r: Ruta): { modulo: Modulo | null; admin: boolean } {
  switch (r.id) {
    case 'facturas':
    case 'factura':
    case 'anular':
    case 'facturar':
    case 'facturar-productos':
    case 'facturar-revisar':
    case 'facturar-resultado':
      return { modulo: 'facturacion', admin: false }
    case 'clientes':
    case 'cliente-nuevo':
    case 'cliente':
      return { modulo: 'clientes', admin: false }
    case 'productos':
    case 'producto':
      return { modulo: 'productos', admin: false }
    case 'mas':
      return { modulo: null, admin: false }
    case 'mas-empresa':
    case 'mas-numeracion':
      return { modulo: 'configuracion', admin: false }
    case 'mas-usuarios':
      return { modulo: 'usuarios', admin: true }
  }
}

// --- Qué hacer con el historial -----------------------------------------------------------------------------------------------------

/** Lo que se hace con el historial al ir a una ruta: agregar una entrada, cambiar la actual, o retroceder una. */
export type AccionHistorial = 'push' | 'replace' | 'back'

/**
 * Cómo ir de la ruta `actual` a la pestaña `destino` (anexo 5.4: el historial de las pestañas es el inicio más, a lo sumo, una entrada; no hay
 * entrada centinela). Desde el inicio (Facturas) a otra pestaña se empuja una; entre las demás se reemplaza, así atrás sigue llevando al inicio;
 * al inicio se vuelve con atrás si hay historial de la app debajo, y si no (un enlace directo) se reemplaza, para no sacar al usuario de la app.
 * Tocar la pestaña en que ya se está reemplaza (no agrega entradas). El asistente (`facturar`) no es una pestaña: se entra siempre empujando,
 * para que atrás vuelva a la pestaña de donde se vino.
 *
 * Solo sabe SI hay historial debajo, no QUÉ hay. Por eso `irATab` (`crearNavegador`) cambia el `'back'` a Facturas por `'replace'` cuando la
 * entrada de abajo no es Facturas (la lista de Clientes bajo un detalle, un enlace directo bajo Más): un atrás mostraría esa otra pantalla.
 */
export function accionTab(actual: Ruta, destino: Ruta, hayHistorial: boolean): AccionHistorial {
  if (destino.id === 'facturar') return 'push'
  if (destino.id === 'facturas') {
    if (actual.id === 'facturas') return 'replace'
    return hayHistorial ? 'back' : 'replace'
  }
  return actual.id === 'facturas' ? 'push' : 'replace'
}

/**
 * Qué hacer con el historial en una hoja que es una ruta (Más, anexo 5.2). Abrirla empuja una entrada; tocar una de sus filas reemplaza esa
 * entrada por la pantalla de la fila, así un solo atrás de Android cae en la pestaña de origen; cerrarla es retroceder si hay historial de la
 * app debajo, y reemplazar por la ruta de respaldo si no (se abrió con un enlace directo).
 */
export function accionHoja(evento: 'abrir' | 'fila' | 'volver', hayHistorial: boolean): AccionHistorial {
  if (evento === 'abrir') return 'push'
  if (evento === 'fila') return 'replace'
  return hayHistorial ? 'back' : 'replace'
}

// --- Navegar ------------------------------------------------------------------------------------------------------------------------

/** Lo que el navegador de rutas usa de la ventana: así una prueba puede pasarle una falsa. */
export interface VentanaDeRutas {
  location: { hash: string; replace(url: string): void }
  history: { readonly state: unknown; back(): void; replaceState(data: unknown, unused: string): void }
  addEventListener(tipo: 'hashchange', oyente: () => void): void
  removeEventListener(tipo: 'hashchange', oyente: () => void): void
}

export interface Navegador {
  /** `location.hash` ahora: lo que `useSyncExternalStore` pide como valor (un texto, que es igual mientras el hash no cambie). */
  hashActual(): string
  /** Llama a `cb` cada vez que el hash cambia. Devuelve la función que deja de avisar. */
  suscribir(cb: () => void): () => void
  /** ¿Hay una entrada del historial creada por la app debajo de la actual? */
  hayHistorial(): boolean
  /** Va a `r`: agrega una entrada del historial, o con `reemplazar` cambia la actual. Ir a la ruta en que ya se está no hace nada. */
  navegar(r: Ruta, opts?: { reemplazar?: boolean }): void
  /** Retrocede una entrada si hay historial de la app; si no, reemplaza la actual por `fallback`. Nunca saca al usuario de la app. */
  atras(fallback: Ruta): void
  /** Cambia de pestaña según `accionTab`. Hacia Facturas solo retrocede si la entrada de abajo es Facturas; si no, reemplaza la actual. */
  irATab(destino: Ruta): void
}

/**
 * Un navegador de rutas sobre `win`. Cada entrada que crea lleva en `history.state` una marca `{ fx, bajo }`: `fx` es cuántas entradas creadas por
 * la app hay debajo de ella y `bajo` el hash de la que está justo debajo. Se lee de ahí y no de una variable para que sobreviva a una recarga y a un
 * atrás del sistema (el botón de Android), que un contador en memoria no vería. `fx` dice si atrás se queda dentro de la app; `bajo`, a dónde
 * llevaría: tocar la pestaña Facturas solo retrocede si esa entrada es Facturas (un detalle apilado sobre Clientes, o Más sobre un enlace
 * directo, tienen otra pantalla debajo). Una entrada sin marca (el enlace con que se abrió la página, o una a la que el navegador no dejó marcar)
 * vale 0, y una marca sin `bajo` (la de una versión anterior) no dice a dónde lleva: atrás reemplaza en vez de retroceder, que es lo seguro.
 *
 * Quien empuje entradas por su cuenta (la hoja que guarda `{ sheet }`) debe marcarlas como lo hace `navegar`: `fx` una más que la actual y `bajo`
 * el `location.hash` de ahora, con sus propias claves aparte. Sin eso, mientras esa entrada esté arriba, `atras` reemplazaría en vez de retroceder.
 */
export function crearNavegador(win: VentanaDeRutas): Navegador {
  /** La marca de la entrada actual; `bajo` es null si la marca no lo trae o no es un texto, y `fx` 0 si no hay marca válida. */
  const leerMarca = (): { fx: number; bajo: string | null } => {
    const estado: unknown = win.history.state
    const marca: { fx?: unknown; bajo?: unknown } = typeof estado === 'object' && estado !== null ? estado : {}
    const fx = typeof marca.fx === 'number' && Number.isInteger(marca.fx) && marca.fx > 0 ? marca.fx : 0
    return { fx, bajo: typeof marca.bajo === 'string' ? marca.bajo : null }
  }

  const marcar = (fx: number, bajo: string | null): void => {
    try {
      win.history.replaceState(bajo === null ? { fx } : { fx, bajo }, '')
    } catch {
      // Safari corta la API de historial pasadas 100 llamadas en 30 segundos. Sin marca la entrada vale 0 y atrás reemplaza: nunca sale de la app.
    }
  }

  const hayAtras = (): boolean => leerMarca().fx > 0

  /** ¿La entrada de justo debajo es Facturas? Solo se sabe si la marca lo dice (`bajo` puede ser '': la raíz sin hash es Facturas). */
  const abajoEsFacturas = (): boolean => {
    const { bajo } = leerMarca()
    return bajo !== null && parseHash(bajo).id === 'facturas'
  }

  // Asignar `location.hash` y llamar a `location.replace` con un hash son navegaciones al fragmento, que el navegador resuelve en el acto: al volver
  // la entrada ya es la nueva (sin estado) y se la puede marcar enseguida. El `hashchange` llega después, y para entonces ya está marcada.
  // Salvedad medida en Chromium: antes del evento `load` un empujón por `location.hash` se convierte en reemplazo (no nace una entrada) y la marca diría
  // que hay una de la app debajo cuando no la hay. `history.length` no sirve para notarlo: también baja al empujar teniendo entradas de adelante.
  const ir = (r: Ruta, opts?: { reemplazar?: boolean }): void => {
    const destino = formatHash(r)
    const actual = win.location.hash
    if (opts?.reemplazar === true) {
      if (destino === actual) return
      const { fx, bajo } = leerMarca()
      win.location.replace(destino)
      if (fx > 0) marcar(fx, bajo) // nace sin estado y lo de abajo no cambió: se le copia la marca. A profundidad 0 ya vale 0 y se ahorra una llamada
    } else {
      // Empujar la ruta en que ya se está dejaría dos entradas iguales ('' y #/facturas son la misma ruta).
      if (destino === formatHash(parseHash(actual))) return
      const fx = leerMarca().fx + 1
      win.location.hash = destino
      marcar(fx, actual) // la entrada de abajo es la que se deja, con el hash que tenía
    }
  }

  const volver = (fallback: Ruta): void => {
    if (hayAtras()) win.history.back()
    else ir(fallback, { reemplazar: true })
  }

  const aTab = (destino: Ruta): void => {
    let accion = accionTab(parseHash(win.location.hash), destino, hayAtras())
    // `accionTab` solo sabe que hay historial debajo: un atrás a Facturas solo es cierto si lo de abajo es Facturas.
    if (accion === 'back' && !abajoEsFacturas()) accion = 'replace'
    if (accion === 'back') win.history.back()
    else ir(destino, { reemplazar: accion === 'replace' })
  }

  return {
    hashActual: () => win.location.hash,
    suscribir(cb) {
      // Una función propia por suscripción: el navegador junta en uno los oyentes repetidos de un mismo evento, y cancelar una suscripción de
      // `cb` no puede dejar sin aviso a otra suscripción de la misma función.
      const avisar = (): void => cb()
      win.addEventListener('hashchange', avisar)
      return () => win.removeEventListener('hashchange', avisar)
    },
    hayHistorial: hayAtras,
    navegar: ir,
    atras: volver,
    irATab: aTab,
  }
}

let navegadorDeLaVentana: Navegador | undefined

/** El navegador de esta ventana, creado al usarlo por primera vez: las pruebas (Node, sin `window`) importan este módulo sin llegar aquí. */
function navegadorGlobal(): Navegador {
  if (!navegadorDeLaVentana) navegadorDeLaVentana = crearNavegador(window)
  return navegadorDeLaVentana
}

/** Ve a `r`: agrega una entrada del historial, o con `reemplazar` cambia la actual. */
export function navegar(r: Ruta, opts?: { reemplazar?: boolean }): void {
  navegadorGlobal().navegar(r, opts)
}

/** Vuelve atrás; si no hay historial de la app debajo (un enlace directo, una recarga sin marca), reemplaza la ruta actual por `fallback`. */
export function atras(fallback: Ruta): void {
  navegadorGlobal().atras(fallback)
}

/** Cambia de pestaña: `accionTab` decide si agrega una entrada, reemplaza la actual o retrocede. `destino` es la raíz de una pestaña o el asistente. */
export function irATab(destino: Ruta): void {
  navegadorGlobal().irATab(destino)
}

/** ¿Hay una entrada creada por la app debajo de la actual? Es el `hayHistorial` que piden `accionTab` y `accionHoja`. */
export function hayHistorial(): boolean {
  return navegadorGlobal().hayHistorial()
}

/** La ruta de ahora: se actualiza con cada `hashchange`. La ruta es la misma mientras el hash no cambie. */
export function useRuta(): Ruta {
  const navegador = navegadorGlobal()
  const hash = useSyncExternalStore(navegador.suscribir, navegador.hashActual)
  return useMemo(() => parseHash(hash), [hash])
}

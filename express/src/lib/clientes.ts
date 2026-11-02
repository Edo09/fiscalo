// lib/clientes: las reglas puras de los clientes de Express. El RNC (limpiarlo, validarlo, formatearlo y qué dice la DGII de él), la búsqueda, el alta, la edición parcial, los
// enlaces de contacto y la acción «Facturar a este cliente». Sin React ni red: lo usan ui/ClienteForm, las pantallas de Clientes y las pruebas.
//
// Lo que sabe del servidor (api-gratex clientController y clientModel): el alta pide `client_name` y `company_name` (los dos, 100 como máximo); RNC, teléfono y correo son
// opcionales y el RNC se guarda solo con dígitos; el servidor rechaza un alta con el mismo correo, nombre de contacto y teléfono (con al menos uno de los dos datos de contacto);
// el PUT es PARCIAL (lo que no viaja se conserva, un correo, teléfono o dirección vacíos limpian, un RNC vacío no puede quitarse) y un alta sin `descuento` ni
// `permitir_credito` toma los valores por omisión (sin descuento y con crédito): por eso Express nunca los manda al crear.
import type { NewClientInput } from '@/api/clients'
import { ApiError, CODIGO_CLIENTE_SIN_ELEGIR } from '@/api/errores'
import type { ConsultaRnc } from '@/api/rnc'
import type { ClientRow } from '@/api/types'
import { errorCorreo, errorDescuento, errorRnc, errorTexto, LARGO } from '@/features/clients/validacion'
import { formatoRnc, soloDigitos } from '@/pos/montos'
import { normalizarCliente, num } from '~/lib/filas'
import { esTipoDeVenta, exigeComprador } from '~/lib/tiposEcf'

/** Cuánto se espera tras la última tecla antes de buscar en Clientes y en Productos. */
export const ESPERA_BUSQUEDA_MS = 300

/** Lo que se avisa cuando no se pudo comprobar el RNC de un comprobante que exige comprador (E31 y E45). */
export const MSG_RNC_NO_VERIFICADO = 'No se pudo verificar este RNC; si es incorrecto la DGII rechazará la factura'

// --- El RNC ----------------------------------------------------------------------------------------------------------------------------

/** Los dígitos de un RNC o una cédula escritos como sea: «1-31-25643-2» y «131 256 432» dan 131256432. */
export const normalizarRnc = (texto: string): string => soloDigitos(texto)

/** ¿Son los dígitos de un RNC (9) o de una cédula (11)? */
export const esRncOCedula = (digitos: string): boolean => digitos.length === 9 || digitos.length === 11

/** Qué está mal en un RNC o cédula escrito, o undefined si está bien o vacío («sin documento» vale). Se aceptan separadores. */
export const validarRnc = (texto: string): string | undefined => errorRnc(texto)

/** 131256432 es 1-31-25643-2 y 00112345678 es 001-1234567-8; lo que no tiene 9 u 11 dígitos queda como sus dígitos. */
export const formatearRnc = (texto: string): string => formatoRnc(soloDigitos(texto))

/** Un contador de turnos: una respuesta que llega tarde (de una consulta que ya no es la última) no es `vigente` y no debe pisar a la más nueva. */
export function contadorTurno(): { siguiente(): number; vigente(n: number): boolean } {
  let actual = 0
  return {
    siguiente: () => ++actual,
    vigente: (n) => n === actual,
  }
}

/** Lo que dijo la DGII de un RNC: sus datos, que no está inscrito, que no se pudo preguntar o que el número no sirve. Ninguno impide guardar el cliente. */
export type ResultadoRnc =
  | { kind: 'encontrado'; rnc: string; razonSocial: string; estado: string; activo: boolean }
  | { kind: 'noInscrito'; mensaje: string }
  | { kind: 'noDisponible' }
  | { kind: 'invalido'; mensaje: string }

/**
 * La respuesta de GET /api/rnc/consulta o su error, como uno de los cuatro desenlaces. Un 404 con texto del servidor es «no inscrito» y uno sin texto (un proxy, un servidor
 * viejo) es «no disponible»; un 422 es «inválido» con el texto del servidor; todo lo demás (502, sin red, tiempo agotado) es «no disponible». Un estado distinto de ACTIVO no
 * bloquea: solo marca `activo: false`.
 */
export function resultadoConsultaRnc(r: { ok: ConsultaRnc } | { error: unknown }): ResultadoRnc {
  if ('ok' in r) {
    const c = r.ok
    const estado = typeof c.estado === 'string' ? c.estado.trim() : ''
    const razon = typeof c.razon_social === 'string' ? c.razon_social.trim() : ''
    const comercial = typeof c.nombre_comercial === 'string' ? c.nombre_comercial.trim() : ''
    return { kind: 'encontrado', rnc: soloDigitos(String(c.rnc ?? '')), razonSocial: razon !== '' ? razon : comercial, estado, activo: estado.toUpperCase() === 'ACTIVO' }
  }
  const e = r.error
  if (e instanceof ApiError) {
    if (e.status === 404) return e.delServidor ? { kind: 'noInscrito', mensaje: e.message } : { kind: 'noDisponible' }
    if (e.status === 422) return { kind: 'invalido', mensaje: e.message }
  }
  return { kind: 'noDisponible' }
}

/** «SUSPENDIDO» es «Suspendido»: el estado de la DGII como se lee en una frase. */
export function capitalizar(texto: string): string {
  const t = texto.trim().toLowerCase()
  return t === '' ? t : t.charAt(0).toUpperCase() + t.slice(1)
}

/** De las filas dadas, las que tienen este RNC (9 u 11 dígitos), aunque el RNC esté guardado con guiones (los clientes viejos). */
export function coincidenciasRnc(filas: ClientRow[], digitos: string): ClientRow[] {
  if (!esRncOCedula(digitos)) return []
  return filas.filter((f) => soloDigitos(String(f.rnc ?? '')) === digitos)
}

// --- La búsqueda -----------------------------------------------------------------------------------------------------------------------

export type ModoBusqueda = { kind: 'vacio' } | { kind: 'texto'; query: string } | { kind: 'rnc'; digitos: string }

/**
 * Qué se le pregunta al servidor por lo que se escribió en el buscador. Un texto de solo dígitos y separadores con exactamente 9 u 11 dígitos es un RNC o cédula (se
 * busca por sus dígitos, que es como se guardan); con menos de 2 caracteres no se busca nada; lo demás se busca tal cual, recortado.
 */
export function modoBusqueda(texto: string): ModoBusqueda {
  const t = texto.trim()
  if (/^[\d\s.-]+$/.test(t) && esRncOCedula(soloDigitos(t))) return { kind: 'rnc', digitos: soloDigitos(t) }
  return t.length < 2 ? { kind: 'vacio' } : { kind: 'texto', query: t }
}

/** El `query` de la lista de clientes para lo escrito: vacío si no hay nada que buscar. */
export function consultaDeBusqueda(texto: string): string {
  const modo = modoBusqueda(texto)
  return modo.kind === 'rnc' ? modo.digitos : modo.kind === 'texto' ? modo.query : ''
}

// --- Leer lo que mandó el servidor -----------------------------------------------------------------------------------------------------

type Fila = Record<string, unknown>

const comoFila = (v: unknown): Fila => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Fila) : {})

/** El texto recortado de una columna; vacío si no hay. Un número se lee como texto (un teléfono puede llegar de las dos maneras). */
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/** Un cliente con todo lo que muestran el detalle y la edición. `rnc` son solo dígitos; `nombre` es lo que se muestra (razón social, o empresa, o contacto). */
export interface FichaCliente {
  id: number
  nombre: string
  contacto: string
  empresa: string
  rnc: string
  telefono: string
  correo: string
  direccion: string
  descuento: number
  permiteCredito: boolean
}

/** Una fila de GET /api/clients?id= como ficha. Las columnas llegan como texto de MySQL: el crédito y el descuento se leen con `esUno` y `num`, nunca como texto «verdadero». */
export function fichaCliente(r: unknown): FichaCliente {
  const f = comoFila(r)
  const v = normalizarCliente(r)
  return {
    id: v.id,
    nombre: v.nombre,
    contacto: texto(f.client_name),
    empresa: texto(f.company_name),
    rnc: soloDigitos(texto(f.rnc)),
    telefono: texto(f.phone_number),
    correo: texto(f.email),
    direccion: texto(f.direccion),
    descuento: v.descuento,
    permiteCredito: v.permiteCredito,
  }
}

/** Una etiqueta de la tarjeta de un cliente: «Sin RNC» (en aviso solo si la cuenta vende E31 o E45, que lo exigen), «Solo contado» y «N% desc.». */
export function chipsCliente(c: { rnc: string | null; permiteCredito: boolean; descuento: number }, tiposEcf: string[]): { texto: string; tono: 'neutral' | 'warn' }[] {
  const chips: { texto: string; tono: 'neutral' | 'warn' }[] = []
  if (soloDigitos(c.rnc ?? '') === '') chips.push({ texto: 'Sin RNC', tono: tiposEcf.includes('31') || tiposEcf.includes('45') ? 'warn' : 'neutral' })
  if (!c.permiteCredito) chips.push({ texto: 'Solo contado', tono: 'neutral' })
  if (c.descuento > 0) chips.push({ texto: `${c.descuento}% desc.`, tono: 'neutral' })
  return chips
}

// --- Contacto --------------------------------------------------------------------------------------------------------------------------

/** El teléfono para guardar: solo dígitos, salvo que el texto lleve letras (una nota como «ext 2»): ahí se guarda lo escrito, recortado. Vacío si no hay nada. */
export function telefonoParaGuardar(valor: string): string {
  const t = valor.trim()
  return /[A-Za-zÀ-ÿ]/.test(t) ? t : soloDigitos(t)
}

/** Los dígitos del número de un teléfono guardado: lo que va antes de una nota con letras («809-555-0100 ext 2» es 8095550100). */
function digitosDeTelefono(valor: string): string {
  const corte = valor.search(/[A-Za-zÀ-ÿ]/)
  return soloDigitos(corte === -1 ? valor : valor.slice(0, corte))
}

/** Los enlaces de llamar, WhatsApp y correo de un cliente; null donde no hay dato o no sirve (un WhatsApp pide 10 dígitos, o 11 que empiecen con 1). */
export function urlContacto(c: { telefono: string | null; email: string | null }): { tel: string | null; wa: string | null; mailto: string | null } {
  const d = digitosDeTelefono(c.telefono ?? '')
  const correo = (c.email ?? '').trim()
  return {
    tel: d.length >= 7 ? `tel:${d}` : null,
    wa: d.length === 10 ? `https://wa.me/1${d}` : d.length === 11 && d.startsWith('1') ? `https://wa.me/${d}` : null,
    mailto: correo !== '' && errorCorreo(correo) === undefined ? `mailto:${correo}` : null,
  }
}

// --- El alta ---------------------------------------------------------------------------------------------------------------------------

/** Lo que se escribe en el formulario de un cliente nuevo. Sin `contacto`, el servidor recibe el nombre también como persona de contacto. */
export interface FormCliente {
  rnc: string
  nombre: string
  contacto?: string
  telefono?: string
  correo?: string
  direccion?: string
}

export type ErroresFormCliente = Partial<Record<keyof FormCliente, string>>

/**
 * Qué está mal en el formulario de un cliente nuevo, por campo. `exigeRnc` es para un comprobante que pide comprador (E31, E45): sin RNC ese cliente no se podría usar. Los
 * largos son los de las columnas: un nombre de más de 100 caracteres (una razón social larga de la DGII) es un error en el campo y nunca se corta en silencio.
 */
export function errorFormCliente(f: FormCliente, o: { exigeRnc?: boolean } = {}): ErroresFormCliente {
  const e: ErroresFormCliente = {}
  const nombre = errorTexto(f.nombre, LARGO.empresa, 'El nombre', 'Escribe el nombre o la razón social.')
  if (nombre !== undefined) e.nombre = nombre
  const rnc = o.exigeRnc === true && soloDigitos(f.rnc) === '' ? 'Escribe el RNC o la cédula del cliente: este comprobante lo necesita.' : errorRnc(f.rnc)
  if (rnc !== undefined) e.rnc = rnc
  const contacto = errorTexto(f.contacto ?? '', LARGO.nombreCliente, 'El contacto')
  if (contacto !== undefined) e.contacto = contacto
  if (telefonoParaGuardar(f.telefono ?? '').length > LARGO.telefono) e.telefono = `El teléfono no puede pasar de ${LARGO.telefono} caracteres.`
  const correo = errorCorreo(f.correo ?? '')
  if (correo !== undefined) e.correo = correo
  const direccion = errorTexto(f.direccion ?? '', LARGO.direccion, 'La dirección')
  if (direccion !== undefined) e.direccion = direccion
  return e
}

/** El cuerpo del POST /api/clients: el alta de la app completa más la dirección, que el servidor guarda aunque `NewClientInput` no la declare. */
export type AltaCliente = NewClientInput & { direccion?: string }

/**
 * El alta de lo escrito: el nombre va como empresa y como contacto (el servidor exige los dos; un contacto escrito reemplaza solo al segundo), el RNC con solo dígitos y lo
 * opcional solo si hay algo. NUNCA lleva `razon_social` (el servidor la toma de la empresa), `descuento`, `permitir_credito` ni `sent_mail`: sus valores por omisión (sin
 * descuento, con crédito) son los que Express quiere y un correo de bienvenida no se pidió.
 */
export function construirAltaCliente(f: FormCliente): AltaCliente {
  const nombre = f.nombre.trim()
  const alta: AltaCliente = { client_name: (f.contacto ?? '').trim() || nombre, company_name: nombre }
  const rnc = soloDigitos(f.rnc)
  if (rnc !== '') alta.rnc = rnc
  const telefono = telefonoParaGuardar(f.telefono ?? '')
  if (telefono !== '') alta.phone_number = telefono
  const correo = (f.correo ?? '').trim()
  if (correo !== '') alta.email = correo
  const direccion = (f.direccion ?? '').trim()
  if (direccion !== '') alta.direccion = direccion
  return alta
}

/** El texto para el usuario de un error: el del servidor (ya pasó por `humanizar` en `@/api/http`) o, de cualquier otra cosa, el de respaldo: nunca el texto de un error de JavaScript. */
export function textoDeError(e: unknown, respaldo: string): string {
  return e instanceof ApiError ? e.message : respaldo
}

/**
 * ¿Pudo la escritura hacerse aunque la respuesta no llegó? Sí sin respuesta (sin red, tiempo agotado: estado 0), con un error del servidor (5xx), con un alta que se hizo pero no se
 * pudo elegir, y con un fallo que no es del API (no se sabe en qué momento ocurrió). Un 4xx o un rechazo con texto es definitivo: no se guardó nada.
 */
export function esFalloAmbiguo(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true
  return e.status === 0 || e.status >= 500 || e.codigo === CODIGO_CLIENTE_SIN_ELEGIR
}

const igual = (a: unknown, b: unknown): boolean => texto(a).toLowerCase() === texto(b).toLowerCase()

/** El cliente de más id de estas filas, o null si no hay ninguna. */
function elMasNuevo(filas: ClientRow[]): ClientRow | null {
  let mejor: ClientRow | null = null
  for (const f of filas) if (mejor === null || num(f.id) > num(mejor.id)) mejor = f
  return mejor
}

/** Tras un fallo ambiguo: el cliente que ya se guardó con lo que se mandó (mismo contacto, empresa, RNC, correo y teléfono; lo que no se mandó es vacío), el de más id. */
export function clienteYaCreado(filas: ClientRow[], alta: AltaCliente): ClientRow | null {
  return elMasNuevo(
    filas.filter(
      (f) =>
        igual(f.client_name, alta.client_name) &&
        igual(f.company_name, alta.company_name) &&
        soloDigitos(texto(f.rnc)) === soloDigitos(alta.rnc ?? '') &&
        igual(f.email, alta.email ?? '') &&
        igual(f.phone_number, alta.phone_number ?? ''),
    ),
  )
}

/** Tras un rechazo: el cliente que causa el «ya tienes un cliente» del servidor, que mira correo, contacto y teléfono, y solo si hay al menos un dato de contacto. */
export function duplicadoDelServidor(filas: ClientRow[], alta: AltaCliente): ClientRow | null {
  if ((alta.email ?? '') === '' && (alta.phone_number ?? '') === '') return null
  return elMasNuevo(filas.filter((f) => igual(f.client_name, alta.client_name) && igual(f.email, alta.email ?? '') && igual(f.phone_number, alta.phone_number ?? '')))
}

// --- La edición parcial ----------------------------------------------------------------------------------------------------------------

/** El formulario de editar un cliente: el RNC son solo dígitos, el descuento un texto (vacío es sin descuento) y el crédito un interruptor. */
export interface FormEdicionCliente {
  nombre: string
  rnc: string
  telefono: string
  correo: string
  direccion: string
  descuento: string
  permiteCredito: boolean
}

export function formDesdeFicha(c: FichaCliente): FormEdicionCliente {
  return { nombre: c.nombre, rnc: c.rnc, telefono: c.telefono, correo: c.correo, direccion: c.direccion, descuento: c.descuento > 0 ? String(c.descuento) : '', permiteCredito: c.permiteCredito }
}

const descuentoDe = (valor: string): number => (valor.trim() === '' ? 0 : Number(valor))

/** Qué campos del formulario cambiaron respecto a la ficha. Un teléfono solo cambia si cambian sus dígitos, y el RNC se compara por sus dígitos (con guiones o sin ellos es el mismo). */
function cambios(orig: FichaCliente, f: FormEdicionCliente): Record<keyof FormEdicionCliente, boolean> {
  return {
    nombre: f.nombre.trim() !== orig.nombre,
    rnc: soloDigitos(f.rnc) !== orig.rnc,
    telefono: telefonoParaGuardar(f.telefono) !== telefonoParaGuardar(orig.telefono),
    correo: f.correo.trim() !== orig.correo,
    direccion: f.direccion.trim() !== orig.direccion,
    descuento: descuentoDe(f.descuento) !== orig.descuento,
    permiteCredito: f.permiteCredito !== orig.permiteCredito,
  }
}

/**
 * Qué está mal, por campo, SOLO en lo que cambió: un dato viejo que ya no pasaría la validación (un RNC de 10 dígitos, un nombre de 120 caracteres) no impide corregir el
 * teléfono. Un RNC no se puede quitar (el servidor conserva el que tiene cuando llega vacío): se dice en el campo.
 */
export function validarEdicionCliente(orig: FichaCliente, f: FormEdicionCliente): Partial<Record<keyof FormEdicionCliente, string>> {
  const e: Partial<Record<keyof FormEdicionCliente, string>> = {}
  const c = cambios(orig, f)
  if (c.nombre) {
    const m = errorTexto(f.nombre, LARGO.empresa, 'El nombre', 'Escribe el nombre o la razón social.')
    if (m !== undefined) e.nombre = m
  }
  if (c.rnc) {
    const m = soloDigitos(f.rnc) === '' ? 'El RNC se puede cambiar, no quitar.' : errorRnc(f.rnc)
    if (m !== undefined) e.rnc = m
  }
  if (c.telefono && telefonoParaGuardar(f.telefono).length > LARGO.telefono) e.telefono = `El teléfono no puede pasar de ${LARGO.telefono} caracteres.`
  if (c.correo) {
    const m = errorCorreo(f.correo)
    if (m !== undefined) e.correo = m
  }
  if (c.direccion) {
    const m = errorTexto(f.direccion, LARGO.direccion, 'La dirección')
    if (m !== undefined) e.direccion = m
  }
  if (c.descuento) {
    const m = errorDescuento(f.descuento)
    if (m !== undefined) e.descuento = m
  }
  return e
}

/** El cuerpo del PUT /api/clients de una edición. */
export type EdicionCliente = { id: number } & Partial<Record<'company_name' | 'client_name' | 'rnc' | 'phone_number' | 'email' | 'direccion', string>> &
  Partial<{ descuento: number; permitir_credito: 0 | 1 }>

/**
 * El PUT de una edición: el id y SOLO lo que cambió (el servidor conserva lo que no viaja). El nombre es la empresa, y también el contacto cuando este era igual a la empresa
 * o no había (si había uno distinto, se conserva); un correo, teléfono o dirección vacíos limpian el dato; un RNC vacío nunca viaja (no se puede quitar).
 */
export function payloadEdicionCliente(orig: FichaCliente, f: FormEdicionCliente): EdicionCliente {
  const c = cambios(orig, f)
  const p: EdicionCliente = { id: orig.id }
  if (c.nombre) {
    const nombre = f.nombre.trim()
    p.company_name = nombre
    if (orig.contacto === '' || orig.contacto === orig.empresa) p.client_name = nombre
  }
  if (c.rnc && soloDigitos(f.rnc) !== '') p.rnc = soloDigitos(f.rnc)
  if (c.telefono) p.phone_number = telefonoParaGuardar(f.telefono)
  if (c.correo) p.email = f.correo.trim()
  if (c.direccion) p.direccion = f.direccion.trim()
  if (c.descuento) p.descuento = descuentoDe(f.descuento)
  if (c.permiteCredito) p.permitir_credito = f.permiteCredito ? 1 : 0
  return p
}

/** ¿Hay algo que guardar? */
export function hayCambiosCliente(orig: FichaCliente, f: FormEdicionCliente): boolean {
  return Object.keys(payloadEdicionCliente(orig, f)).length > 1
}

// --- Facturar a este cliente -----------------------------------------------------------------------------------------------------------

export type AccionFacturar = { accion: 'facturar' } | { accion: 'agregarRnc' } | { accion: 'esMiEmpresa' }

/**
 * Qué ofrece el detalle de un cliente: facturarle; agregarle el RNC, si no lo tiene y todos los tipos que la cuenta vende lo exigen (E31, E45); o nada porque su RNC es el de la
 * propia empresa (el servidor rechaza facturarle). Sin ningún tipo de venta (la cuenta no puede emitir) no se ofrece nada.
 */
export function accionFacturar(c: FichaCliente, tipos: string[], rncEmpresa: string): AccionFacturar | null {
  const ventas = tipos.filter(esTipoDeVenta)
  if (ventas.length === 0) return null
  if (c.rnc !== '' && soloDigitos(rncEmpresa) === c.rnc) return { accion: 'esMiEmpresa' }
  if (c.rnc === '' && ventas.every((t) => exigeComprador(t, 0))) return { accion: 'agregarRnc' }
  return { accion: 'facturar' }
}

/** Lo que Clientes le deja al asistente de venta en `facturarA` (contrato entre las dos pantallas): quién es el cliente y lo que decide cómo se le puede facturar. */
export interface FacturarA {
  id: number
  nombre: string
  rnc: string | null
  permiteCredito: boolean
  descuento: number
}

export function datosFacturarA(c: FichaCliente): FacturarA {
  return { id: c.id, nombre: c.nombre, rnc: c.rnc === '' ? null : c.rnc, permiteCredito: c.permiteCredito, descuento: c.descuento }
}

// --- Lo que se lleva de una pantalla a «Nuevo cliente» ---------------------------------------------------------------------------------

/** Cuánto vale una precarga sin usarse: lo justo para pasar de la lista al formulario. Una más vieja es de un paso que nadie terminó y no se aplica. */
const VIGENCIA_PRECARGA_MS = 10_000

let precarga: { datos: Partial<FormCliente>; hasta: number } | null = null

/** Deja lo que el formulario de «Nuevo cliente» debe traer escrito al abrirse (el nombre buscado, el RNC): se lee con `leerPrecarga`. */
export function fijarPrecarga(datos: Partial<FormCliente>, ahoraMs: number = Date.now()): void {
  precarga = { datos: { ...datos }, hasta: ahoraMs + VIGENCIA_PRECARGA_MS }
}

/**
 * La precarga vigente, o vacío. NO la gasta: React en modo estricto dibuja dos veces al montar y una lectura que borrara lo leído dejaría vacío el segundo dibujo (el que se
 * queda). La pantalla la deja en un estado al montar y llama a `limpiarPrecarga` en un efecto.
 */
export function leerPrecarga(ahoraMs: number = Date.now()): Partial<FormCliente> {
  return precarga !== null && ahoraMs <= precarga.hasta ? { ...precarga.datos } : {}
}

export function limpiarPrecarga(): void {
  precarga = null
}

/** El estado de un formulario de cliente recién abierto: `inicial` puede ser el nombre (un texto) o los campos que ya se saben; el RNC pasa a dígitos. */
export function formInicial(inicial: string | Partial<FormCliente> | undefined): Required<FormCliente> {
  const d: Partial<FormCliente> = typeof inicial === 'string' ? { nombre: inicial } : (inicial ?? {})
  return { rnc: soloDigitos(d.rnc ?? ''), nombre: d.nombre ?? '', contacto: d.contacto ?? '', telefono: d.telefono ?? '', correo: d.correo ?? '', direccion: d.direccion ?? '' }
}

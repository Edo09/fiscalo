// Servicio: clientes.
import { ApiError, CODIGO_CLIENTE_SIN_ELEGIR } from './errores'
import { getJson, getList, request, requestEnvelope, qs } from './http'
import type { ClientRow, ListParams, ListResult } from './types'

export function listClients(params: ListParams = {}): Promise<ListResult<ClientRow>> {
  const query = qs({ page: params.page, pageSize: params.pageSize, query: params.query })
  return getList<ClientRow>(`/api/clients${query}`)
}

/**
 * Datos del alta de un cliente. El backend exige nombre de contacto y empresa;
 * RNC, telefono y correo son opcionales (el correo, si viene, debe ser valido).
 */
export interface NewClientInput {
  client_name: string
  company_name: string
  /** Opcional: sin correo el cliente se guarda con el campo vacío. */
  email?: string
  /** Opcional: sin teléfono el cliente se guarda con el campo vacío. */
  phone_number?: string
  rnc?: string
  /** % de descuento por defecto de sus facturas (0-100). */
  descuento?: number
  /** 1 = se le puede facturar a crédito; 0 = solo contado. */
  permitir_credito?: 0 | 1
}

const MSG_CREADO_SIN_ELEGIR = 'Se creó el cliente, pero no pudimos elegirlo aquí. Búscalo en la lista para elegirlo.'

/** Id numérico > 0 (MySQL puede mandarlo como texto: "12"). null si no lo es. */
function idValido(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * El id del alta, esté donde esté. El backend viejo manda `data: 'Client saved'`
 * sin id; el nuevo lo manda en `data` (el registro, `{id}` o el número) o al
 * lado de `data`. Se aceptan todas para no depender de qué versión esté desplegada.
 */
function idDelAlta(sobre: unknown): { id: number; fila: ClientRow | null } | null {
  const s = (sobre ?? {}) as Record<string, unknown>
  const data = s.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>
    const id = idValido(d.id) ?? idValido(d.client_id)
    // Solo cuenta como registro si trae algún nombre; un `{id}` suelto no.
    if (id !== null) return { id, fila: d.client_name || d.company_name ? ({ ...d, id } as ClientRow) : null }
  }
  const id = idValido(data) ?? idValido(s.id) ?? idValido(s.client_id)
  return id !== null ? { id, fila: null } : null
}

const recortado = (v: string | null | undefined) => (v ?? '').trim()
const digitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

/**
 * Backend sin id en la respuesta: busca el cliente recién creado. Mismo nombre
 * de contacto exacto y, además, lo demás que se envió (empresa, RNC, correo,
 * teléfono): el backend guarda eso tal cual, así que el nuevo siempre coincide,
 * y un cliente viejo que solo se llama igual no se cuela. Si hay varios, el de
 * id más alto (el más nuevo).
 */
async function buscarRecienCreado(input: NewClientInput): Promise<ClientRow | null> {
  const nombre = recortado(input.client_name)
  // El listado ordena por id descendente: el recién creado sale en la primera página.
  const res = await listClients({ query: nombre, pageSize: 25 })
  const candidatos = res.items.filter((r) =>
    idValido(r.id) !== null &&
    recortado(r.client_name) === nombre &&
    recortado(r.company_name) === recortado(input.company_name) &&
    (!input.rnc || digitos(r.rnc) === digitos(input.rnc)) &&
    (!input.email || recortado(r.email).toLowerCase() === recortado(input.email).toLowerCase()) &&
    (!input.phone_number || recortado(r.phone_number) === recortado(input.phone_number)))
  if (!candidatos.length) return null
  return candidatos.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a))
}

/**
 * Alta de un cliente. Devuelve SIEMPRE el registro con un id numérico, listo
 * para elegirlo en una factura, o lanza ApiError.
 *
 * Por qué no basta con devolver `data`: el backend respondía `data:'Client
 * saved'` sin id, y las pantallas lo tomaban como cliente. Salía uno con id
 * "undefined" que viajaba como client_id:null, y la vista previa o el guardado
 * de la factura fallaban con "client_id o client_name requerido". Si el id no
 * viene, se busca el recién creado; si tampoco se encuentra, se lanza un
 * ApiError con código CODIGO_CLIENTE_SIN_ELEGIR (el alta SÍ se hizo: la
 * pantalla puede cerrar el formulario en vez de invitar a crearlo otra vez).
 */
export async function createClient(input: NewClientInput): Promise<ClientRow> {
  const sobre = await requestEnvelope<unknown>('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const alta = idDelAlta(sobre)
  if (alta?.fila) return alta.fila
  if (alta) {
    // Solo el id: se trae el registro completo (RNC normalizado, razón social
    // por defecto…). Si esa lectura falla, basta con lo que se envió.
    try {
      const fila = await getClient(alta.id)
      if (idValido(fila?.id) !== null) return { ...fila, id: alta.id }
    } catch (e) {
      console.warn('[clientes] no se pudo leer el cliente recién creado', alta.id, e)
    }
    return { ...input, rnc: input.rnc ? digitos(input.rnc) : input.rnc, id: alta.id }
  }
  try {
    const fila = await buscarRecienCreado(input)
    if (fila) return { ...fila, id: Number(fila.id) }
  } catch (e) {
    // El alta ya se hizo: un fallo al buscarla no debe parecer un alta fallida.
    console.warn('[clientes] no se pudo ubicar el cliente recién creado', e)
  }
  throw new ApiError(MSG_CREADO_SIN_ELEGIR, 200, {
    original: `POST /api/clients sin id en la respuesta: ${JSON.stringify(sobre).slice(0, 200)}`,
    codigo: CODIGO_CLIENTE_SIN_ELEGIR,
  })
}

/** Detalle de un cliente (registro completo: RNC, dirección, correo…). */
export function getClient(id: number | string): Promise<ClientRow> {
  return getJson<ClientRow>(`/api/clients${qs({ id })}`)
}

/** Actualiza un cliente (PUT con id en el cuerpo, igual que products). */
export function updateClient(input: Partial<Omit<ClientRow, 'id'>> & { id: number | string }): Promise<unknown> {
  return request('/api/clients', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteClient(id: number | string): Promise<unknown> {
  return request('/api/clients', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

// Conversión de filas de la API a los tipos de dominio de la UI.
import type { ClientRow, EstadoDgii, FacturaRow, UserRow } from './types'
import type { Cliente, Factura, UsuarioRow } from '@/types/domain'
import { colorFor } from '@/lib/format'

/** Formatea fechas de la API (`dd-mm-yyyy`, `yyyy-mm-dd hh:mm:ss`, ISO). */
export function formatApiDate(value?: string | null): string {
  if (!value) return '—'
  const s = value.trim()
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s)
  const d = ddmmyyyy
    ? new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]))
    : new Date(s.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Etiqueta corta (reutiliza los tonos de EstadoBadge) para un estado DGII. */
const DGII_LABEL: Record<string, string> = {
  ACEPTADO: 'Aceptado',
  RFCE_ACEPTADO: 'Aceptado',
  ACEPTADO_CONDICIONAL: 'Aceptado',
  ENVIADO: 'En proceso',
  EN_PROCESO: 'En proceso',
  RECHAZADO: 'Rechazado',
  RFCE_RECHAZADO: 'Rechazado',
  NO_ENCONTRADO: 'Pendiente',
  RFCE_NO_ENCONTRADO: 'Pendiente',
}

export function dgiiLabel(raw?: string | null): string {
  if (!raw) return '—'
  return DGII_LABEL[raw] ?? raw
}

/** `2026-05` -> `may` (abreviatura de mes en es-DO). */
export function formatMonthKey(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim())
  if (!m) return key
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return d.toLocaleDateString('es-DO', { month: 'short' })
}

/** ¿El estado DGII es un rechazo (incluido RFCE)? */
export function isRechazo(raw?: string | null): boolean {
  return raw === 'RECHAZADO' || raw === 'RFCE_RECHAZADO'
}

export function mapFacturaRow(r: FacturaRow): Factura {
  return {
    id: String(r.id),
    facturaId: r.id,
    ncf: r.e_ncf || r.NCF || '—',
    tipo: r.tipo_ecf || '',
    cliente: r.client_name || '—',
    clienteId: r.client_id != null ? String(r.client_id) : '',
    rnc: '',
    fecha: formatApiDate(r.fecha_emision_dgii || r.date),
    vence: '—',
    subtotal: 0,
    itbis: 0,
    total: Number(r.total ?? 0),
    estado: 'Emitida',
    dgii: dgiiLabel(r.estado_dgii),
    metodo: '—',
    trackId: r.track_id ?? null,
    codigoSeguridad: r.codigo_seguridad ?? null,
    estadoDgiiRaw: (r.estado_dgii as EstadoDgii | null) ?? null,
  }
}

export function mapUserRow(r: UserRow): UsuarioRow {
  const nombre = [r.name, r.last_name].filter(Boolean).join(' ').trim() || r.username || '—'
  return {
    id: String(r.id),
    nombre,
    email: r.email || '',
    rol: r.role || '—',
    estado: 'Activo',
    ultimo: '',
    color: colorFor(nombre),
  }
}

export function mapClientRow(r: ClientRow): Cliente {
  const rnc = (r.rnc ?? '').trim()
  const tipo = rnc.length === 11 ? 'Cédula' : rnc.length === 9 ? 'RNC' : rnc ? 'RNC' : '—'
  return {
    id: String(r.id),
    nombre: r.razon_social || r.company_name || r.client_name || '—',
    contacto: r.client_name || '',
    tipo,
    doc: rnc,
    email: r.email || '',
    tel: r.phone_number || '',
    ciudad: r.municipio || r.provincia || '',
    balance: 0,
    facturas: 0,
    estado: 'Al día',
    desde: '',
  }
}

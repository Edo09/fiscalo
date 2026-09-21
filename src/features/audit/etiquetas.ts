// Textos en español para la bitácora: módulos, acciones, quién y cuándo.
// Los valores crudos (CREATE, 'facturas'…) son los que guarda el backend en
// audit_logs; un valor que no esté aquí se muestra tal cual.
import type { AuditLogRow } from '@/api'
import type { BadgeTone } from '@/components/ui'
import { moduleLabel } from '@/config/permissions'

const MODULOS: Record<string, string> = {
  auth: 'Sesiones',
  facturas: 'Facturación e-CF',
  'facturas-simples': 'Facturas simples',
  gastos: 'Gastos y compras',
  aprobaciones: 'Aprobaciones enviadas',
  ecf: 'e-CF recibidos',
  'dgii-auth': 'Autenticación DGII',
  integracion: 'Integración',
  ncf: 'Secuencias NCF',
  inventario: 'Inventario',
  clients: 'Clientes',
  products: 'Productos',
  proveedores: 'Proveedores',
  categories: 'Categorías',
  warehouses: 'Almacenes',
  cotizaciones: 'Cotizaciones',
  users: 'Usuarios',
  roles: 'Roles',
  branding: 'Branding',
  landing: 'Landing',
  audit: 'Bitácora',
}

export function etiquetaModulo(modulo: string): string {
  return MODULOS[modulo] ?? moduleLabel(modulo)
}

const ACCIONES: Record<string, string> = {
  LOGIN_SUCCESS: 'Inicio de sesión',
  LOGIN_FAILED: 'Inicio de sesión fallido',
  LOGOUT: 'Cierre de sesión',
  CREATE: 'Creación',
  UPDATE: 'Modificación',
  DELETE: 'Eliminación',
  EMIT: 'Emisión e-CF',
  STATUS_CHANGE: 'Cambio de estado',
  ACECF_SENT: 'Aprobación comercial enviada',
  ECF_RECEIVED: 'e-CF recibido',
  ACECF_RECEIVED: 'Aprobación comercial recibida',
  INTEGRACION_EMIT: 'Emisión por integración',
  INTEGRACION_ACECF: 'Aprobación por integración',
  NCF_RANGE_REGISTER: 'Registro de rango NCF',
  NCF_SEQUENCE_UPDATE: 'Cambio de secuencia NCF',
  AJUSTE_CREAR: 'Ajuste de inventario',
  AJUSTE_ANULAR: 'Anulación de ajuste',
  ASSIGN: 'Asignación de rol',
  LOGO_UPLOAD: 'Logo subido',
  LOGO_DELETE: 'Logo eliminado',
  ACCESS_DENIED: 'Acceso denegado',
  DGII_AUTH_IN_OK: 'Autenticación entrante',
  DGII_AUTH_IN_FAILED: 'Autenticación entrante rechazada',
  DGII_AUTH_OUT_FAILED: 'La DGII negó el token',
}

export function etiquetaAccion(accion: string): string {
  return ACCIONES[accion] ?? accion
}

/** Color del badge de la acción: lo fallido manda sobre el tipo de acción. */
export function tonoAccion(r: Pick<AuditLogRow, 'action' | 'success'>): BadgeTone {
  if (!r.success) return 'danger'
  if (r.action === 'DELETE' || r.action === 'AJUSTE_ANULAR' || r.action === 'LOGO_DELETE') return 'warning'
  if (r.action === 'CREATE' || r.action === 'EMIT' || r.action === 'INTEGRACION_EMIT') return 'success'
  if (r.action.startsWith('LOGIN') || r.action === 'LOGOUT' || r.action.startsWith('DGII_AUTH')) return 'info'
  return 'neutral'
}

/** Módulos cuyos eventos llegan sin usuario de la app (los manda otro sistema). */
const EXTERNOS = new Set(['ecf', 'dgii-auth', 'integracion'])

/** Quién hizo la acción, para la columna de la tabla. */
export function quien(r: Pick<AuditLogRow, 'username' | 'email' | 'module'>): string {
  if (r.username) return r.username
  if (r.email) return r.email
  return EXTERNOS.has(r.module) ? 'DGII / sistema externo' : 'Sistema'
}

/** 'YYYY-MM-DD HH:MM:SS' (hora del servidor) -> 'DD/MM/YYYY HH:MM:SS'. */
export function fechaHora(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(valor)
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : valor
}

/** 'snake_case' -> 'Snake case', para los nombres de campo del detalle. */
export function etiquetaCampo(campo: string): string {
  const t = campo.replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : campo
}

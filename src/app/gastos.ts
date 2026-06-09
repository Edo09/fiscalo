// Catálogo del módulo de Gastos: categorías, tipos permitidos y etiquetas.
// Refleja la matriz de gastos-module.md (el servidor valida la combinación).
import type { GastoCategoria, GastoTipo } from '@/api'

export interface GastoTipoDef {
  label: string
  /** Código NCF DGII (11, 13, 17, 01, 03, 04). */
  ncf: string
  /** true = la empresa emite (E41/E43/E47); false = recibido (digita NCF). */
  autoEmision: boolean
}

export const GASTO_TIPOS: Record<GastoTipo, GastoTipoDef> = {
  E43: { label: 'Gastos Menores', ncf: '13', autoEmision: true },
  E41: { label: 'Comprobante de Compras', ncf: '11', autoEmision: true },
  E47: { label: 'Pagos al Exterior', ncf: '17', autoEmision: true },
  E31: { label: 'Crédito Fiscal (recibido)', ncf: '01', autoEmision: false },
  B01: { label: 'Crédito Fiscal NCF (recibido)', ncf: '01', autoEmision: false },
  E33: { label: 'Nota de Débito (recibida)', ncf: '03', autoEmision: false },
  E34: { label: 'Nota de Crédito (recibida)', ncf: '04', autoEmision: false },
}

export const CATEGORIA_TIPOS: Record<GastoCategoria, GastoTipo[]> = {
  gastos_menores: ['E43'],
  facturas_proveedores: ['E41', 'E47', 'E31', 'B01', 'E33', 'E34'],
}

export const CATEGORIA_LABEL: Record<GastoCategoria, string> = {
  gastos_menores: 'Gastos Menores',
  facturas_proveedores: 'Facturas de Proveedores',
}

export const GASTO_CATEGORIAS: GastoCategoria[] = ['gastos_menores', 'facturas_proveedores']

export function isAutoEmision(tipo: string | null | undefined): boolean {
  return tipo ? GASTO_TIPOS[tipo as GastoTipo]?.autoEmision === true : false
}

export function tipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return '—'
  return GASTO_TIPOS[tipo as GastoTipo]?.label ?? tipo
}

export function categoriaLabel(cat: string | null | undefined): string {
  if (!cat) return '—'
  return CATEGORIA_LABEL[cat as GastoCategoria] ?? cat
}

/** Etiqueta legible del estado DGII de un gasto (mapea a tonos de EstadoBadge). */
export function gastoEstadoLabel(raw: string | null | undefined): string {
  switch (raw) {
    case 'ACEPTADO':
    case 'ACEPTADO_CONDICIONAL':
      return 'Aceptado'
    case 'ENVIADO':
    case 'EN_PROCESO':
      return 'En proceso'
    case 'RECHAZADO':
      return 'Rechazado'
    case 'ERROR':
      return 'Error'
    case 'REGISTRADO':
      return 'Registrado'
    case 'PENDIENTE_EMISION':
      return 'Por emitir'
    case 'NO_ENCONTRADO':
      return 'Pendiente'
    default:
      return raw || '—'
  }
}

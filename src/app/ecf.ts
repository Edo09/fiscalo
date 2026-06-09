// Catálogo estático de tipos de comprobante fiscal electrónico (DGII).
import type { TipoEcf } from '@/api'

export interface EcfTipoDef {
  code: TipoEcf
  nombre: string
  desc: string
}

export const ECF_TIPOS: EcfTipoDef[] = [
  { code: '31', nombre: 'Factura de Crédito Fiscal', desc: 'B2B. Requiere RNC del comprador (crédito de ITBIS).' },
  { code: '32', nombre: 'Factura de Consumo', desc: 'B2C. ≥250k a DGII directo; <250k vía RFCE.' },
  { code: '33', nombre: 'Nota de Débito', desc: 'Aumenta el valor de un comprobante previo.' },
  { code: '34', nombre: 'Nota de Crédito', desc: 'Reduce o anula un comprobante previo.' },
  { code: '41', nombre: 'Comprobante de Compras', desc: 'Compras a proveedores; retención de ITBIS/ISR.' },
  { code: '43', nombre: 'Gastos Menores', desc: 'Gastos pequeños sin RNC del proveedor.' },
  { code: '44', nombre: 'Regímenes Especiales', desc: 'Zonas francas y regímenes especiales.' },
  { code: '45', nombre: 'Gubernamental', desc: 'Ventas al Estado dominicano.' },
  { code: '46', nombre: 'Comprobante de Exportaciones', desc: 'Ventas al exterior (tasa cero).' },
  { code: '47', nombre: 'Pagos al Exterior', desc: 'Pagos a no residentes (ISR retenido).' },
]

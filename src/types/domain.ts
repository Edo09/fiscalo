// Tipos de dominio para la UI (datos de ejemplo del prototipo).
// Independientes del esquema de base de datos en `@/types/database`.

export type EstadoTono = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'
export type NotifTipo = 'danger' | 'warning' | 'info' | 'success'

export interface Empresa {
  nombre: string
  rnc: string
  direccion: string
  telefono: string
  email: string
  sucursal: string
  moneda: string
}

export interface EmpresaItem {
  id: string
  nombre: string
  rnc: string
  logo: string
}

export interface Usuario {
  nombre: string
  rol: string
  iniciales: string
  color: string
  email: string
}

export interface Cliente {
  id: string
  nombre: string
  contacto: string
  /** Nombre de la empresa (company_name / razón social). */
  empresa?: string
  tipo: string
  doc: string
  email: string
  tel: string
  ciudad: string
  balance: number
  facturas: number
  estado: string
  desde: string
}

export interface Producto {
  id: string
  sku: string
  nombre: string
  cat: string
  tipo: string
  precio: number
  costo: number
  stock: number | null
  min: number | null
  itbis: number
  estado: string
}

export interface Factura {
  id: string
  ncf: string
  tipo: string
  cliente: string
  clienteId: string
  rnc: string
  fecha: string
  vence: string
  subtotal: number
  itbis: number
  total: number
  estado: string
  dgii: string
  metodo: string
  // Campos opcionales presentes cuando la factura viene de la API e-CF.
  facturaId?: number
  trackId?: string | null
  codigoSeguridad?: string | null
  estadoDgiiRaw?: string | null
}

export interface FacturaLinea {
  prod: string
  sku: string
  cant: number
  precio: number
  desc: number
  itbis: number
}

export interface EcfTipo {
  code: string
  nombre: string
  emitidos: number
  mes: number
  desc: string
}

export interface DgiiColaItem {
  id: string
  tipo: string
  cliente: string
  monto: number
  hora: string
  estado: string
  track: string
  motivo?: string
}

export interface Gasto {
  id: string
  concepto: string
  proveedor: string
  cat: string
  fecha: string
  ncf: string
  subtotal: number
  itbis: number
  total: number
  estado: string
}

export interface Proveedor {
  id: string
  nombre: string
  rnc: string
  contacto: string
  tel: string
  balance: number
  compras: number
}

export interface Actividad {
  tipo: string
  txt: string
  monto: string | null
  hora: string
  ic: string
  color: string
}

export interface Notificacion {
  id: string
  tipo: NotifTipo
  ic: string
  titulo: string
  txt: string
  hora: string
  leida: boolean
}

export interface VentaMes {
  mes: string
  ventas: number
  gastos: number
}

export interface TopCliente {
  nombre: string
  monto: number
  pct: number
}

export interface Kpis {
  ventasDia: number
  ventasMes: number
  facturasEmitidas: number
  facturasPendientes: number
  gastosMes: number
  itbisCobrado: number
  itbisPorPagar: number
  cxc: number
  cxp: number
  utilidad: number
}

export interface UsuarioRow {
  id: string
  nombre: string
  email: string
  rol: string
  estado: string
  ultimo: string
  color: string
}

export interface Rol {
  nombre: string
  desc: string
  usuarios: number
  permisos: string
}

import type { IconName } from '@/components/ui/Icon'
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
  /** % de descuento que se aplica por defecto a sus facturas (0 = ninguno). */
  descuento: number
  /** Si se le puede facturar a crédito. Con `false`, el pago debe ser de contado. */
  permiteCredito: boolean
}

export interface Producto {
  id: string
  sku: string
  nombre: string
  /** Nombre de la categoría (categoria_nombre), para mostrar/filtrar. */
  cat: string
  /** FK a `categories` (null = sin categoría). */
  categoryId: number | null
  /** FK a `warehouses` (almacén asignado). */
  warehouseId: number | null
  tipo: string
  precio: number
  costo: number
  stock: number | null
  min: number | null
  itbis: number
  /** Código DGII de unidad de medida (id del catálogo; 43 = Unidad). */
  unidadMedida: number
  estado: string
}

export interface Factura {
  id: string
  ncf: string
  tipo: string
  cliente: string
  /** Razón social / empresa del comprador (company_name). */
  empresa?: string
  /** Descripción del primer ítem (resumen del listado). */
  descripcion?: string
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
  /** Notas E33/E34 que modifican esta factura (vacío si no tiene). */
  notas?: NotaVinculada[]
  /** En una nota E33/E34: el comprobante que modifica. */
  modifica?: ComprobanteModificado | null
  /** En una nota E33/E34: su código de modificación DGII ('1' = anula…). */
  codigoModificacion?: string | null
  /** En una nota E33/E34: e-NCF del comprobante que modifica. */
  ncfModificado?: string | null
}

/** Nota de crédito (E34) o débito (E33) que modifica una factura. */
export interface NotaVinculada {
  id: number
  ncf: string
  /** '33' | '34' */
  tipo: string
  codigoModificacion: string | null
  /** Total de la nota, positivo como se guarda (ver conSigno). */
  total: number
  estadoDgii: string
  /** Fecha tal como la manda la API (formatApiDate para mostrarla). */
  fecha: string | null
}

/** Comprobante que modifica una nota. id/tipo/total null: no está en Fiscalo (NCF de papel). */
export interface ComprobanteModificado {
  id: number | null
  ncf: string
  tipo: string | null
  total: number | null
  fecha: string | null
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

/** Borrador para precargar el formulario de factura (ej. convertir una cotización). */
export interface FacturaPrefill {
  kind: 'factura-prefill'
  /** Vacío si el documento de origen no tenía cliente. */
  clienteId: string
  clienteNombre: string
  /** Código del documento de origen (ej. cotización) — informativo. */
  origen?: string
  /**
   * Estado inicial del interruptor "Los precios incluyen ITBIS". Ausente = true
   * (cotización Gratex, precios con ITBIS); Ferretería manda false.
   */
  precioConItbis?: boolean
  /** Avisos bajo el banner de conversión (ej. cargos de la cotización que no se copiaron). */
  avisos?: string[]
  /**
   * Los campos opcionales ligan la línea al catálogo. Ausentes = línea libre
   * como hasta ahora: sin producto, unidad 43, indicador 1, 'Bien'.
   */
  lineas: {
    nombre: string
    cantidad: number
    precio: number
    prodId?: string
    /** Código DGII de la unidad (= unidades_medida.id). */
    unidadMedida?: number
    /** indicador_facturacion: 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
    indFact?: number
    tipoItem?: 'Bien' | 'Servicio'
  }[]
}

/** Borrador para precargar la factura simple (convertir una cotización de Ferretería). */
export interface FacturaSimplePrefill {
  kind: 'factura-simple-prefill'
  /** Vacío si el documento de origen no tenía cliente. */
  clienteId: string
  clienteNombre: string
  /** Código del documento de origen (ej. COT-000012), para el banner. */
  origen: string
  /** Avisos bajo el banner de conversión. */
  avisos?: string[]
  /** `precio` YA incluye el ITBIS: la factura simple cobra precios finales. */
  lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
}

export interface Proveedor {
  id: string
  nombre: string
  rnc: string
  contacto: string
  tel: string
  balance: number
  compras: number
  correo?: string
  direccion?: string
  notas?: string
  activo?: boolean
}

export interface Actividad {
  tipo: string
  txt: string
  monto: string | null
  hora: string
  ic: IconName
  color: string
}

export interface Notificacion {
  id: string
  tipo: NotifTipo
  ic: IconName
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

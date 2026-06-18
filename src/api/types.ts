// Tipos de petición/respuesta de la API e-CF.
// Derivados de ecf-api-payloads.md y del esquema gratexdb.

/** Envoltorio estándar de respuesta de la API. */
export type ApiEnvelope<T> =
  | { status: true; data: T }
  | { status: false; error: string }

/** Tipos de comprobante fiscal electrónico (DGII). */
export type TipoEcf = '31' | '32' | '33' | '34' | '41' | '43' | '44' | '45' | '46' | '47'

/** 1=ITBIS 18%, 2=ITBIS 16%, 3=Tasa cero, 4=Exento. */
export type IndicadorFacturacion = 1 | 2 | 3 | 4
/** 1=Bien, 2=Servicio. */
export type IndicadorBienServicio = 1 | 2

/** Estados posibles devueltos por DGII. */
export type EstadoDgii =
  | 'ENVIADO'
  | 'ACEPTADO'
  | 'ACEPTADO_CONDICIONAL'
  | 'EN_PROCESO'
  | 'RECHAZADO'
  | 'NO_ENCONTRADO'
  | 'RFCE_ACEPTADO'
  | 'RFCE_RECHAZADO'
  | 'RFCE_NO_ENCONTRADO'

// ---------------------------------------------------------------------------
// Crear factura — POST /api/facturas
// ---------------------------------------------------------------------------

export interface FacturaItemInput {
  numero_linea?: number
  nombre_item: string
  indicador_facturacion: IndicadorFacturacion
  indicador_bien_servicio: IndicadorBienServicio
  cantidad: number
  unidad_medida: string
  precio_unitario: number
  // Retenciones (E41/E47) — opcionales, el backend las calcula si faltan.
  indicador_agente_retencion_percepcion?: string
  monto_itbis_retenido?: number
  monto_isr_retenido?: number
}

export interface CompradorInput {
  rnc?: string
  razon_social?: string
  identificador_extranjero?: string
  direccion?: string
  municipio?: string
  provincia?: string
  correo?: string
  contacto?: string
}

export interface TotalesInput {
  itbis1?: string
  itbis2?: string
  itbis3?: string
  total_itbis_retenido?: number
  total_isr_retencion?: number
}

export interface InformacionReferencia {
  ncf_modificado: string
  rnc_otro_contribuyente: string | null
  fecha_ncf_modificado: string
  codigo_modificacion: string
  razon_modificacion: string
}

export interface CreateFacturaInput {
  client_id: number
  tipo_ecf: TipoEcf
  items: FacturaItemInput[]
  user_id?: number
  fecha_emision?: string
  tipo_pago?: number
  tipo_ingresos?: string
  indicador_monto_gravado?: string
  indicador_nota_credito?: string
  comprador?: CompradorInput
  totales?: TotalesInput
  informacion_referencia?: InformacionReferencia
  e_ncf?: string
}

/** Respuesta de POST /api/facturas. */
export interface CreateFacturaResponse {
  factura_id: number
  e_ncf: string
  track_id: string | null
  estado_dgii: EstadoDgii
  codigo_seguridad: string
  total: number
  tipo_ecf: string
  ambiente: string
  fecha_emision_dgii: string
  rfce_track_id?: string | null
  dgii_response?: unknown
}

// ---------------------------------------------------------------------------
// Filas de factura (listado / detalle) — esquema gratexdb.facturas
// ---------------------------------------------------------------------------

export interface FacturaRow {
  id: number
  no_factura?: string | null
  date?: string | null
  client_id?: number | null
  client_name?: string | null
  user_id?: number | null
  total?: number | string | null
  NCF?: string | null
  tipo_ecf?: string | null
  e_ncf?: string | null
  track_id?: string | null
  estado_dgii?: string | null
  codigo_seguridad?: string | null
  fecha_emision_dgii?: string | null
  secuencia_utilizada?: boolean | null
  // Presentes en el listado (GET /api/facturas): resumen plano de la factura.
  company_name?: string | null
  description?: string | null
  monto_gravado?: number | string | null
  monto_exento?: number | string | null
  total_itbis?: number | string | null
  items?: FacturaItemRow[]
  /** Solo en GET /api/facturas?id=: registro completo del cliente. */
  cliente?: ClientRow | null
  /** Solo en GET /api/facturas?id=: configuración del emisor (emisor_config). */
  emisor?: EmisorRow | null
}

/** Configuración del emisor (emisor_config; también vía GET /api/emisor). */
export interface EmisorRow {
  id?: number
  rnc?: string | null
  razon_social?: string | null
  nombre_comercial?: string | null
  sucursal?: string | null
  direccion?: string | null
  municipio?: string | null
  provincia?: string | null
  telefono?: string | null
  correo?: string | null
  website?: string | null
  /** Solo en GET /api/emisor: ambiente del tenant (testecf | certecf | ecf). */
  ambiente?: string | null
  /** Solo en GET /api/emisor: 'emisor_config' o 'tenant' (integración). */
  fuente?: string
}

/** esquema gratexdb.factura_items */
export interface FacturaItemRow {
  id?: number
  factura_id?: number
  description?: string | null
  amount?: number | string | null
  quantity?: number | string | null
  subtotal?: number | string | null
  itbis_amount?: number | string | null
  /** 1=ITBIS 18%, 2=16%, 3=tasa cero, 4=exento. */
  indicador_facturacion?: number | null
}

export interface ListParams {
  page?: number
  pageSize?: number
  query?: string
}

export interface ListResult<T> {
  items: T[]
  total: number | null
  /** Página actual reportada por el backend (bloque `pagination`). */
  page?: number | null
  /** Tamaño de página reportado por el backend. */
  pageSize?: number | null
  /** Total de páginas reportado por el backend. */
  totalPages?: number | null
}

/**
 * Filtro de estado DGII (server-side, `?estado=`). Minúsculas.
 * `aprobado` = ACEPTADO/ACEPTADO_CONDICIONAL/RFCE_* aceptados; `rechazado`
 * incluye RFCE_RECHAZADO. (Ver ecf-api-payloads.md.)
 */
export type FacturaEstadoFiltro = 'aprobado' | 'rechazado'

export interface FacturaListParams extends ListParams {
  estado?: FacturaEstadoFiltro
  /** Tipo e-CF con prefijo, p.ej. `E31`, `E32` (`?tipo_ecf=`). */
  tipoEcf?: string
}

// ---------------------------------------------------------------------------
// Estado DGII — GET /api/facturas/{id}/estado
// ---------------------------------------------------------------------------

export interface DgiiMensaje {
  valor: string
  codigo: number
}

export interface EstadoData {
  factura_id: number
  e_ncf: string
  track_id: string | null
  estado_dgii: EstadoDgii
  secuencia_utilizada: boolean | null
  consulta?: {
    trackId?: string
    codigo?: string
    estado?: string
    rnc?: string
    encf?: string
    secuenciaUtilizada?: boolean
    fechaRecepcion?: string
    mensajes?: DgiiMensaje[]
  }
}

// ---------------------------------------------------------------------------
// Documentos en base64 — ?format=base64
// ---------------------------------------------------------------------------

export interface DocBase64 {
  filename: string
  content: string
  mime_type: string
}

// ---------------------------------------------------------------------------
// Estadísticas — GET /api/facturas/stats
// ---------------------------------------------------------------------------

export interface StatsResumen {
  total_ecf: number
  monto_total: number
  tipos_distintos: number
  primer_ecf: string | null
  ultimo_ecf: string | null
}

export interface StatsPorTipo {
  tipo_ecf: string
  nombre: string
  total: number
  monto_total: number
  aceptados: number
  rfce: number
  rechazados: number
  enviados: number
  ultimo_emitido: string | null
}

export interface StatsPorEstado {
  estado: string
  total: number
  monto_total: number
}

export interface StatsPorMes {
  mes: string
  total: number
  monto_total: number
}

export interface StatsSecuencia {
  type: string
  nombre: string
  secuencia_actual: number
  total_emitidos: number
  /** Números disponibles en rangos vigentes; null = sin rango con límite registrado. */
  restantes?: number | string | null
  /** Vencimiento del rango vigente que dispensa. */
  vencimiento?: string | null
}

export interface StatsData {
  resumen: StatsResumen
  por_tipo: StatsPorTipo[]
  por_estado: StatsPorEstado[]
  por_mes: StatsPorMes[]
  secuencias: StatsSecuencia[]
}

// ---------------------------------------------------------------------------
// Clientes — esquema gratexdb.clients
// ---------------------------------------------------------------------------

export interface ClientRow {
  id: number
  email?: string | null
  rnc?: string | null
  razon_social?: string | null
  direccion?: string | null
  municipio?: string | null
  provincia?: string | null
  client_name?: string | null
  company_name?: string | null
  phone_number?: string | null
}

// ---------------------------------------------------------------------------
// Productos — tabla `products` (catálogo del tenant)
// ---------------------------------------------------------------------------

export interface ProductRow {
  id: number
  sku?: string | null
  nombre?: string | null
  descripcion?: string | null
  categoria?: string | null
  /** FK a `categories` (nullable). */
  category_id?: number | null
  /** FK a `warehouses` (obligatorio; default Almacén Principal). */
  warehouse_id?: number | null
  /** Nombres resueltos vía JOIN para mostrar en tablas. */
  categoria_nombre?: string | null
  almacen_nombre?: string | null
  /** 1=Bien | 2=Servicio */
  indicador_bien_servicio?: number | null
  /** 0=No facturable | 1=ITBIS 18% (gravado) | 2=16% | 3=Tasa cero | 4=Exento */
  indicador_facturacion?: number | null
  precio?: number | string | null
  costo?: number | string | null
  unidad_medida?: string | null
  stock?: number | null
  stock_minimo?: number | null
  activo?: number | boolean | null
}

export interface CreateProductInput {
  nombre: string
  sku?: string
  descripcion?: string
  categoria?: string
  category_id?: number | null
  warehouse_id?: number
  indicador_bien_servicio?: number
  indicador_facturacion?: number
  precio?: number
  costo?: number
  unidad_medida?: string
  stock?: number | null
  stock_minimo?: number | null
  activo?: boolean | number
}

// ---------------------------------------------------------------------------
// Cotizaciones — tablas `cotizaciones` / `cotizacion_items`
// ---------------------------------------------------------------------------

export interface CotizacionItemRow {
  id?: number
  cotizacion_id?: number
  description?: string | null
  amount?: number | string | null
  quantity?: number | string | null
  subtotal?: number | string | null
}

export interface CotizacionRow {
  id: number
  /** Código único generado por el backend (ej. 48213AB). */
  code?: string | null
  date?: string | null
  client_id?: number | null
  client_name?: string | null
  total?: number | string | null
  /** Resumen: descripciones de los ítems unidas (lo arma el backend). */
  description?: string | null
  items?: CotizacionItemRow[]
}

export interface CotizacionItemInput {
  description: string
  amount: number
  quantity: number
}

export interface CreateCotizacionInput {
  client_id: number
  items: CotizacionItemInput[]
  total: number
  date?: string
  user_id?: number
  /** true => el backend envía la cotización por correo al cliente. */
  sent_email?: boolean
}

// ---------------------------------------------------------------------------
// Proveedores — tabla `proveedores` (directorio del tenant)
// ---------------------------------------------------------------------------

export interface ProveedorRow {
  id: number
  rnc?: string | null
  nombre?: string | null
  contacto?: string | null
  telefono?: string | null
  correo?: string | null
  direccion?: string | null
  notas?: string | null
  activo?: number | boolean | null
  /** Derivado: cantidad de gastos/compras asociados al RNC. */
  compras?: number | string | null
}

export interface CreateProveedorInput {
  nombre: string
  rnc?: string
  contacto?: string
  telefono?: string
  correo?: string
  direccion?: string
  notas?: string
  activo?: boolean | number
}

// ---------------------------------------------------------------------------
// Inventario — tablas `categories` / `warehouses` (DB del tenant)
// Mismo contrato CRUD que /api/products. Ver docs/inventario.md.
//   estado: 1 = activo | 0 = inactivo (desactivar en vez de borrar).
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: number
  nombre?: string | null
  descripcion?: string | null
  estado?: number | boolean | null
  created_at?: string
  updated_at?: string
}

export interface CreateCategoryInput {
  nombre: string
  descripcion?: string
  estado?: number
}

export interface WarehouseRow {
  id: number
  nombre?: string | null
  descripcion?: string | null
  estado?: number | boolean | null
  created_at?: string
  updated_at?: string
}

export interface CreateWarehouseInput {
  nombre: string
  descripcion?: string
  estado?: number
}

// ---------------------------------------------------------------------------
// Usuarios — esquema gratexdb.users
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number
  name?: string | null
  last_name?: string | null
  email?: string | null
  username?: string | null
  role?: string | null
}

/** Alta de usuario — POST /api/users. El tenant sale del token, nunca del body. */
export interface CreateUserInput {
  email: string
  password: string
  name: string
  username: string
  last_name?: string
  /** Rol validado contra los roles del tenant; default `user`. */
  role?: string
}

/** Edición de usuario — PUT /api/users/{id}. Todo opcional; password en blanco = sin cambio. */
export interface UpdateUserInput {
  name?: string
  last_name?: string
  email?: string
  username?: string
  role?: string
  password?: string
}

// ---------------------------------------------------------------------------
// Roles y permisos (RBAC) — /api/roles. Ver docs/roles-permisos.md.
//   Permiso = nombre de módulo (`facturas`, `gastos`, …) o `*` (todos).
//   Roles de sistema (`is_system=1`: admin/user) no se editan ni borran.
// ---------------------------------------------------------------------------

export interface RoleRow {
  id: number
  tenant_id?: number | null
  name: string
  description?: string | null
  /** 1 = rol de sistema (admin/user): no editable ni borrable. */
  is_system?: number | boolean | null
  /** Módulos que concede el rol (`['*']` = todos). */
  permissions: string[]
}

export interface CreateRoleInput {
  name: string
  description?: string
  permissions: string[]
}

/** Actualización de un rol (no aplica a roles de sistema). */
export interface UpdateRoleInput {
  description?: string
  permissions?: string[]
}

/** Asignar un rol (por nombre) a un usuario. */
export interface AssignRoleInput {
  user_id: number
  role: string
}

// ---------------------------------------------------------------------------
// Gastos — /api/gastos (tablas gastos / gasto_items)
// ---------------------------------------------------------------------------

export type GastoCategoria = 'gastos_menores' | 'facturas_proveedores'
/** Auto-emitidos por la empresa: E41/E43/E47. Recibidos: E31/B01/E33/E34. */
export type GastoTipo = 'E43' | 'E41' | 'E47' | 'E31' | 'B01' | 'E33' | 'E34'

export interface GastoItemInput {
  description: string
  amount: number
  quantity?: number
  subtotal?: number
  itbis_amount?: number
  /** Código DGII de unidad de medida (id del catálogo; 43 = Unidad). */
  unidad_medida?: string
}

// ---------------------------------------------------------------------------
// Unidades de medida — catálogo DGII (/api/unidades-medida)
// ---------------------------------------------------------------------------

/** `id` = código numérico DGII (va en el XML); codigo/descripcion para mostrar. */
export interface UnidadMedida {
  id: number
  codigo: string
  descripcion: string
}

export interface CreateGastoInput {
  categoria: GastoCategoria
  tipo_gasto: GastoTipo
  rnc_proveedor: string
  nombre_proveedor: string
  /** Solo para tipos recibidos (E31/B01/E33/E34); en auto-emisión se ignora. */
  ncf?: string
  items: GastoItemInput[]
  fecha?: string
  subtotal?: number
  itbis?: number
  total?: number
  user_id?: number
}

export interface GastoItemRow {
  id?: number
  gasto_id?: number
  description?: string | null
  amount?: number | string | null
  quantity?: number | string | null
  subtotal?: number | string | null
  itbis_amount?: number | string | null
  indicador_facturacion?: number | null
  indicador_bien_servicio?: number | null
}

export interface GastoRow {
  id: number
  categoria?: string | null
  tipo_gasto?: string | null
  ncf?: string | null
  rnc_proveedor?: string | null
  nombre_proveedor?: string | null
  fecha?: string | null
  subtotal?: number | string | null
  itbis?: number | string | null
  total?: number | string | null
  es_auto_emision?: number | boolean | null
  estado_dgii?: string | null
  track_id?: string | null
  codigo_seguridad?: string | null
  ambiente?: string | null
  user_id?: number | null
  items?: GastoItemRow[]
  /** Presente cuando la emisión DGII está deshabilitada (guard apagado). */
  aviso?: string
}

export interface GastoListParams extends ListParams {
  categoria?: GastoCategoria
}

// Estadísticas de gastos — GET /api/gastos/stats
export interface GastoStatsResumen {
  total_gastos: number
  monto_total: number
  subtotal_total: number
  itbis_total: number
  tipos_distintos: number
  primer_gasto: string | null
  ultimo_gasto: string | null
}
export interface GastoStatsPorTipo {
  tipo_gasto: string
  total: number
  monto_total: number
  subtotal_total: number
  itbis_total: number
  auto_emitidos: number
  recibidos: number
  nombre: string
}
export interface GastoStatsPorCategoria {
  categoria: string
  total: number
  monto_total: number
  itbis_total: number
  nombre: string
}
export interface GastoStatsPorMes {
  mes: string
  total: number
  monto_total: number
}
export interface GastoStatsSecuencia {
  type: string
  secuencia_actual: number
  total_emitidos: number
  nombre: string
  /** Números disponibles en rangos vigentes; null = sin rango con límite registrado. */
  restantes?: number | string | null
  /** Vencimiento del rango vigente que dispensa. */
  vencimiento?: string | null
}

// ---------------------------------------------------------------------------
// Rangos e-NCF autorizados por DGII — /api/ncf/rangos
// ---------------------------------------------------------------------------

export interface NcfRango {
  id: number
  type: string
  ambiente?: string | null
  current_value: number | string
  numero_desde: number | string
  numero_hasta?: number | string | null
  fecha_vencimiento?: string | null
  no_solicitud?: string | null
  no_autorizacion?: string | null
  usados?: number | string | null
  restantes?: number | string | null
  /** activo | pendiente | agotado | vencido | sin_limite */
  estado?: string
}

export interface RegisterRangoInput {
  type: string
  numero_desde: number
  numero_hasta: number
  /** YYYY-MM-DD */
  fecha_vencimiento: string
  no_solicitud?: string
  no_autorizacion?: string
}
export interface GastoStatsData {
  resumen: GastoStatsResumen
  por_tipo: GastoStatsPorTipo[]
  por_categoria: GastoStatsPorCategoria[]
  por_mes: GastoStatsPorMes[]
  secuencias: GastoStatsSecuencia[]
  ambiente_activo: string
}

// ---------------------------------------------------------------------------
// Emisor — GET /api/emisor (datos fiscales del emisor; solo lectura)
// ---------------------------------------------------------------------------

export interface EmisorData {
  rnc: string
  razon_social: string
  nombre_comercial?: string | null
  sucursal?: string | null
  direccion?: string | null
  municipio?: string | null
  provincia?: string | null
  telefono?: string | null
  correo?: string | null
  website?: string | null
  actividad_economica?: string | null
  fecha_vencimiento_secuencia?: string | null
  ambiente: string
  fuente?: string
}

// ---------------------------------------------------------------------------
// e-CF recibidos + aprobación comercial
//   GET  /api/ecf/recepcion            -> e-CF que otros emisores te enviaron
//   POST /api/aprobaciones-comerciales -> apruebas/rechazas uno (ACECF a DGII)
// Ver docs/aprobacion-comercial-recibidos.md.
// ---------------------------------------------------------------------------

/** Fila de un e-CF que otro emisor te envió (GET /api/ecf/recepcion). */
export interface EcfRecibidoRow {
  track_id: string
  tipo_ecf: string
  e_ncf: string
  rnc_emisor: string
  razon_social_emisor: string | null
  rnc_comprador: string | null
  monto_total: number | string | null
  fecha_emision: string | null
  /** Estado TÉCNICO de recepción (firma): ENVIADO/ACEPTADO/EN_PROCESO/RECHAZADO. */
  estado: string | null
  ambiente: string | null
  /** Tu decisión COMERCIAL enviada a DGII: ACEPTADO/RECHAZADO; null = pendiente. */
  aprobacion_comercial: string | null
  aprobacion_comercial_codigo_dgii?: string | null
  aprobacion_comercial_estado_dgii?: string | null
  /** 1 = DGII procesó tu aprobación; 0 = no procesada (mismatch/error). */
  aprobacion_comercial_procesada?: number | string | null
  aprobacion_comercial_fecha?: string | null
}

/** El endpoint de recepción pagina por page/pageSize (sin búsqueda server-side). */
export type EcfRecibidoListParams = ListParams

/** Cuerpo de POST /api/aprobaciones-comerciales (aprobar/rechazar un recibido). */
export interface AprobacionComercialInput {
  rnc_emisor: string
  e_ncf: string
  fecha_emision: string
  monto_total: string | number
  /** '1' = Aceptado, '2' = Rechazado. */
  estado: '1' | '2'
  /** Obligatorio si estado='2'. */
  detalle_motivo?: string
  /** Override de ambiente (testecf|certecf|ecf); por defecto el del e-CF recibido. */
  ambiente?: string
}

export interface AprobacionComercialResponse {
  rnc_emisor: string
  e_ncf: string
  estado_aprobacion: string
  track_id: string | null
  estado_dgii: string | null
  codigo_seguridad: string | null
  ambiente: string | null
  fecha_envio: string | null
  dgii_response?: unknown
}

// ---------------------------------------------------------------------------
// Branding — /api/branding (plantilla PDF, acento y logo del tenant)
// ---------------------------------------------------------------------------

export interface BrandingData {
  template: string
  accent_color: string | null
  logo_path: string | null
  has_custom_logo: boolean
  available_templates: string[]
}

// ---------------------------------------------------------------------------
// Reportes fiscales — Formato 606 (compras) — GET /api/reportes/606/preview
//   Los montos vienen como `number` (listos para formatear). Las fechas son
//   strings `AAAAMMDD` (vacías si no aplican). Ver docs/reporte-606-frontend.md.
// ---------------------------------------------------------------------------

/** Un registro del 606: 3 campos auxiliares de display + los 23 oficiales DGII. */
export interface Reporte606Registro {
  // Auxiliares de display (no forman parte de los 23 campos del 606).
  razon_social: string
  origen: string // 'ecf_recibido' | 'gasto'
  tipo_comprobante: string // E31, E41, E43, B01…
  // Los 23 campos oficiales del 606, en orden.
  rnc: string
  tipo_id: string // 1=RNC, 2=Cédula
  tipo_bienes_serv: string
  ncf: string
  ncf_modificado: string
  fecha_comprobante: string // AAAAMMDD
  fecha_pago: string // AAAAMMDD o ''
  monto_servicios: number
  monto_bienes: number
  total_facturado: number
  itbis_facturado: number
  itbis_retenido: number
  itbis_proporcionalidad: number
  itbis_costo: number
  itbis_adelantar: number
  itbis_percibido: number
  tipo_retencion_isr: string
  retencion_renta: number
  isr_percibido: number
  isc: number
  otros_impuestos: number
  propina_legal: number
  forma_pago: string // código DGII 01–08
}

export interface Reporte606Totales {
  monto_servicios: number
  monto_bienes: number
  total_facturado: number
  itbis_facturado: number
  itbis_retenido: number
  retencion_renta: number
}

export interface Reporte606Preview {
  periodo: string // AAAAMM
  rnc_emisor: string
  cantidad: number
  totales: Reporte606Totales
  advertencias: string[]
  registros: Reporte606Registro[]
}

// ---------------------------------------------------------------------------
// Reportes fiscales — Formato 607 (ventas) — GET /api/reportes/607/preview
//   Contraparte del 606. Montos como `number`; fechas `AAAAMMDD` (vacías si no
//   aplican). Ver docs/reporte-607-frontend.md.
// ---------------------------------------------------------------------------

/** Un registro del 607: 3 campos auxiliares de display + los 23 oficiales DGII. */
export interface Reporte607Registro {
  // Auxiliares de display (no forman parte de los 23 campos del 607).
  razon_social: string
  tipo_comprobante: string // E31/E32/E33/E34 (e-CF) o NCF (factura simple)
  estado_dgii: string // ACEPTADO, PENDIENTE…
  // Los 23 campos oficiales del 607, en orden.
  rnc: string
  tipo_id: string // 1=RNC, 2=Cédula
  ncf: string
  ncf_modificado: string
  tipo_ingreso: string // default 01
  fecha_comprobante: string // AAAAMMDD
  fecha_retencion: string // AAAAMMDD o ''
  monto_facturado: number
  itbis_facturado: number
  itbis_retenido: number
  itbis_percibido: number
  retencion_renta: number
  isr_percibido: number
  isc: number
  otros_impuestos: number
  propina_legal: number
  efectivo: number
  cheque_transf: number
  tarjeta: number
  credito: number
  bonos: number
  permuta: number
  otras: number
}

export interface Reporte607Totales {
  monto_facturado: number
  itbis_facturado: number
  itbis_retenido: number
  retencion_renta: number
}

export interface Reporte607Preview {
  periodo: string // AAAAMM
  rnc_emisor: string
  cantidad: number
  totales: Reporte607Totales
  advertencias: string[]
  registros: Reporte607Registro[]
}

// Tipos de petición/respuesta de la API e-CF.
// Derivados de ecf-api-payloads.md y del esquema gratexdb.
import type { GastoCategoria } from './schemas/gasto'

/** Envoltorio estándar de respuesta de la API. */
export type ApiEnvelope<T> =
  | { status: true; data: T }
  | { status: false; error: string }

// Tipos del payload e-CF inferidos desde los esquemas Zod (fuente única de verdad).
export type {
  TipoEcf,
  IndicadorFacturacion,
  IndicadorBienServicio,
  FacturaItemInput,
  CompradorInput,
  TotalesInput,
  CodigoModificacion,
  InformacionReferencia,
  CreateFacturaInput,
} from './schemas/factura'

/** Estados posibles devueltos por DGII. */
export type EstadoDgii =
  | 'ENVIADO'
  | 'ACEPTADO'
  | 'ACEPTADO_CONDICIONAL'
  | 'EN_PROCESO'
  | 'RECHAZADO'
  | 'RECHAZADO_ARCHIVADO'
  | 'NO_ENCONTRADO'
  | 'RFCE_ACEPTADO'
  | 'RFCE_RECHAZADO'
  | 'RFCE_NO_ENCONTRADO'
  | 'RFCE_PENDIENTE'
  | 'ENVIO_PENDIENTE'

// ---------------------------------------------------------------------------
// Crear factura — POST /api/facturas
// El payload (FacturaItemInput, CompradorInput, TotalesInput,
// InformacionReferencia, CreateFacturaInput) se infiere de los esquemas Zod en
// ./schemas/factura y se re-exporta arriba.
// ---------------------------------------------------------------------------

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
  /**
   * Solo en GET /api/facturas?id= (f.*): el e-CF tal como se firmó. Sus Item
   * van en el orden de `items` y traen la cantidad y el precio exactos que las
   * filas viejas ya no guardan (ver InvoiceDetailView).
   */
  xml_firmado?: string | null
  /** Notas E33/E34: e-NCF del comprobante que modifican (InformacionReferencia). */
  ncf_modificado?: string | null
  /** Notas E33/E34: 1=Anula, 2=Corrige texto, 3=Corrige montos, 4=Reemplazo de contingencia, 5=Ref. factura de consumo. */
  codigo_modificacion?: string | null
  /**
   * Notas (E33/E34, no rechazadas, mismo ambiente) que modifican esta fila, por
   * id ascendente. En el listado y en el detalle; [] si no tiene. Opcional: un
   * backend anterior no lo trae. Leer con notasDeFila (features/invoices/notasVinculadas).
   */
  notas?: FacturaNotaRow[] | null
  /**
   * En una nota E33/E34: el comprobante que modifica. null en las demás filas.
   * Leer con modificaDeFila (features/invoices/notasVinculadas).
   */
  modifica?: FacturaModificaRow | null
}

/**
 * Nota que modifica una factura (campo `notas` de GET /api/facturas). PDO manda
 * el id y el total como texto ("82200.00"): convertir con Number().
 */
export interface FacturaNotaRow {
  id: number | string
  e_ncf: string
  tipo_ecf: string
  codigo_modificacion: string | null
  total: number | string
  estado_dgii: string
  date: string | null
}

/**
 * Comprobante que modifica una nota (campo `modifica`). id/tipo_ecf/total/date
 * son null cuando el e-NCF referido no está en facturas (un NCF de papel).
 */
export interface FacturaModificaRow {
  id: number | string | null
  e_ncf: string
  tipo_ecf: string | null
  total: number | string | null
  date: string | null
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

/**
 * esquema gratexdb.factura_items. Las columnas DECIMAL llegan como texto
 * ("3.000", "84.7500"): leerlas con aNumero y mostrarlas con fmtCantidad/fmtPrecio.
 */
export interface FacturaItemRow {
  id?: number
  factura_id?: number
  product_id?: number | null
  description?: string | null
  /** Precio unitario sin ITBIS (DECIMAL(18,4) desde la migración 025). */
  amount?: number | string | null
  /** DECIMAL(12,3) desde la migración 025 (antes INT). */
  quantity?: number | string | null
  /** MontoItem: cantidad × precio − descuento, sin ITBIS. */
  subtotal?: number | string | null
  descuento_monto?: number | string | null
  itbis_amount?: number | string | null
  /** 1=ITBIS 18%, 2=16%, 3=tasa cero, 4=exento. */
  indicador_facturacion?: number | null
  indicador_bien_servicio?: number | null
  /** Código DGII de la unidad de medida (43 = Unidad). */
  unidad_medida?: string | null
}

/**
 * Factura que una nota (E33/E34) puede modificar: de venta y aceptada por la
 * DGII (GET /api/facturas/modificables?client_id=).
 */
export interface FacturaModificableRow {
  id: number
  client_id: number | null
  tipo_ecf: string
  e_ncf: string
  /** Fecha de emisión del e-CF (dd-mm-aaaa): la que va en FechaNCFModificado. */
  fecha_emision: string
  estado_dgii: string
  total: number
  /** Suma de las notas de crédito ya emitidas contra esta factura (sin rechazadas). */
  notas_credito: number
  notas_debito: number
  /** total + notas de débito − notas de crédito: el tope de una nota de crédito nueva. */
  saldo: number
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

export interface ProductListParams extends ListParams {
  /**
   * Filtra el listado por la categoría del producto (`?category_id=`). Distinto
   * de `query`, que además matchea el nombre de la categoría (y traería los
   * productos que la mencionan en su propio nombre o descripción).
   */
  categoryId?: number
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

/**
 * Papel de la representación impresa. 'carta' es la hoja 8½×11 de siempre;
 * 'pos' es la tirilla de rollo, de alto variable, en el ancho configurado en
 * este equipo (ver AnchoTirilla). El contenido fiscal es idéntico en las dos —
 * la DGII exige los mismos datos — así que la elección es del usuario en el
 * momento de imprimir, no un ajuste de la cuenta.
 */
export type FormatoImpresion = 'carta' | 'pos'

/**
 * Ancho del rollo de la impresora de recibos, en mm. Es de cada equipo, no de
 * la empresa: ver src/stores/impresora.ts.
 */
export type AnchoTirilla = 72 | 76 | 80

/**
 * Cómo se manda la tirilla a la impresora. 'web': página HTML con el largo
 * exacto del recibo (@page). 'pdf': el PDF de siempre, cuyo largo de papel
 * decide el tamaño elegido en el driver.
 */
export type ModoImpresion = 'web' | 'pdf'

// ---------------------------------------------------------------------------
// Bitácora de auditoría (/api/audit-logs)
// ---------------------------------------------------------------------------

/** Una fila de audit_logs, tal como la devuelve el backend. */
export interface AuditLogRow {
  id: number
  tenant_id: number | null
  /** null en eventos sin usuario: e-CF recibido, login de un usuario inexistente… */
  user_id: number | null
  username: string | null
  email: string | null
  /** Módulo del evento: 'facturas', 'auth', 'dgii-auth'… (o el módulo al que se intentó entrar, en ACCESS_DENIED). */
  module: string
  entity_type: string | null
  /** id numérico o texto (e-NCF, track id), según la entidad. */
  entity_id: string | null
  /** CREATE, UPDATE, DELETE, EMIT, LOGIN_SUCCESS, ACCESS_DENIED… */
  action: string
  http_method: string | null
  endpoint: string | null
  ip_address: string | null
  user_agent: string | null
  browser: string | null
  os: string | null
  device_type: string | null
  /** Estado previo (UPDATE/DELETE), ya decodificado. Secretos como '***REDACTED***'. */
  old_values: unknown
  /** Estado nuevo (CREATE/UPDATE) o detalle del evento, ya decodificado. */
  new_values: unknown
  description: string | null
  success: boolean
  error_message: string | null
  /** 'YYYY-MM-DD HH:MM:SS' (hora del servidor). */
  created_at: string
}

/** Filtros de la bitácora; los ausentes no filtran. */
export interface AuditLogFiltros {
  /** 'YYYY-MM-DD' inclusive. */
  desde?: string
  /** 'YYYY-MM-DD' inclusive (el backend toma el día completo). */
  hasta?: string
  userId?: number
  modulo?: string
  accion?: string
  resultado?: 'exito' | 'fallo'
  /** Texto libre: usuario, email, entidad, descripción, endpoint o IP. */
  texto?: string
}

export interface AuditResumen {
  total: number
  fallidos: number
  accesos_denegados: number
  logins_fallidos: number
  usuarios: number
  top_usuarios: { user_id: number; username: string | null; email: string | null; total: number }[]
  por_modulo: { module: string; total: number }[]
}

export interface AuditFacetas {
  modulos: string[]
  acciones: string[]
  usuarios: { user_id: number; username: string | null; email: string | null }[]
}

/**
 * Recibo de tirilla como datos (`?format=datos` en los endpoints de PDF), para
 * imprimirlo como página web. Los textos llegan ya formateados por el backend
 * con los mismos helpers que el PDF (ReciboPos::datos): aquí solo se dibujan.
 */
export interface ReciboDatos {
  /** Nombre del documento sin extensión, p. ej. "Factura_E310000000011_POS80". */
  nombre: string
  /** Ancho de página y margen en mm: lo que imprime el driver, no lo que mide el rollo. */
  papel: { opcion: AnchoTirilla; ancho_mm: number; margen_mm: number }
  fuente: 'Arial' | 'Times' | 'Courier'
  /** data URI (PNG/JPG) o null. */
  logo: string | null
  emisor: { razon_social: string; rnc: string; direccion: string; contacto: string }
  titulo: string
  /** Pares [etiqueta, valor]: e-NCF y fechas, o número y NCF en las simples. */
  identificacion: [string, string][]
  /** null cuando el comprobante no lleva comprador (E43). */
  receptor: { pares: [string, string][]; contacto: string } | null
  lineas: { descripcion: string; cantidad_precio: string; itbis: string; valor: string }[]
  /** Motivo de nota E33/E34 que no cupo en una línea; '' si no aplica. */
  motivo: string
  totales: { etiqueta: string; valor: string; total: boolean }[]
  /** null en facturas no electrónicas. */
  timbre: { qr: string | null; aviso_preview: string; codigo_seguridad: string; fecha_firma: string } | null
  leyenda_qr: string
  gracias: string
}

// ---------------------------------------------------------------------------
// Reporte de ventas (gestión) — GET /api/reportes/ventas
// ---------------------------------------------------------------------------

/** Agrupación del reporte. 'documento' = detalle sin agrupar. */
export type AgrupacionVentas = 'documento' | 'cliente' | 'forma_pago' | 'usuario'

/** Formato de descarga del reporte: PDF para imprimir, Excel para seguir trabajando. */
export type FormatoExportacion = 'pdf' | 'xlsx'

/** Una venta del detalle. Las notas de crédito vienen con los montos en negativo. */
export interface VentaDocumento {
  id: number
  fecha: string
  documento: string
  tipo: string
  estado: string
  client_id: number | null
  cliente: string
  cliente_rnc: string
  tipo_pago: number
  forma_pago: string
  user_id: number | null
  usuario: string
  es_devolucion: boolean
  sin_lineas: boolean
  base: number
  itbis: number
  total: number
}

/** Una fila agrupada (por cliente, forma de pago o usuario). */
export interface VentaGrupo {
  clave: number | string | null
  etiqueta: string
  cantidad: number
  cliente_rnc?: string
  base: number
  itbis: number
  total: number
}

export interface ReporteVentas {
  desde: string
  hasta: string
  agrupar: AgrupacionVentas
  totales: { cantidad: number; base: number; itbis: number; total: number }
  advertencias: string[]
  filas: VentaDocumento[] | VentaGrupo[]
}

// ---------------------------------------------------------------------------
// Estadísticas — GET /api/facturas/stats
// ---------------------------------------------------------------------------

export interface StatsResumen {
  total_ecf: number
  monto_total: number
  /**
   * monto_total neto: la nota de crédito (E34) resta y los rechazados no
   * cuentan. Llega como texto (DECIMAL). Opcional: un backend anterior no lo trae.
   */
  monto_neto?: number | string | null
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

export interface StatsPorDia {
  /** YYYY-MM-DD */
  dia: string
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
  /** e-CF emitidos por mes, de TODOS los tipos (compras incluidas): no son ventas. */
  por_mes: StatsPorMes[]
  /**
   * Ventas en e-CF por mes (últimos 12), con las reglas del reporte de ventas:
   * la nota de crédito (E34) resta y E41/E43/E47 no entran. Sin facturas simples.
   * Opcional: un backend anterior no lo trae.
   */
  ventas_por_mes?: StatsPorMes[]
  /** Igual que `ventas_por_mes`, por día (últimos 31). */
  ventas_por_dia?: StatsPorDia[]
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
  /** % de descuento fijo del cliente (0 = ninguno). Llega como string desde MySQL. */
  descuento?: number | string | null
  /** 1 = se le puede facturar a crédito; 0 = solo contado. */
  permitir_credito?: number | string | boolean | null
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
  /**
   * DECIMAL(12,3) desde la migración 025: llega como texto ("12.500"). Se
   * convierte en mapProductRow; compararlo o sumarlo crudo fallaría en silencio.
   */
  stock?: number | string | null
  stock_minimo?: number | string | null
  /** Foto (migración 032): ruta relativa al API; null = sin foto. */
  imagen_path?: string | null
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
  /** Hasta 3 decimales, y solo si la unidad admite fracciones (kg, metro…). */
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
  // Columnas de la migración 026 (formatos con catálogo, ej. Ferretería).
  // null en las líneas de Gratex y ausentes antes de la 026.
  product_id?: number | null
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida?: string | null
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion?: number | null
  /** 1 = Bien, 2 = Servicio. */
  indicador_bien_servicio?: number | null
  /** DECIMAL como string: leer con aNumero. */
  itbis_amount?: string | number | null
}

export interface CotizacionRow {
  id: number
  /** Código único generado por el backend (Gratex: ej. 48213AB; Ferretería: COT-000123). */
  code?: string | null
  date?: string | null
  client_id?: number | null
  client_name?: string | null
  total?: number | string | null
  /** Resumen: descripciones de los ítems unidas (lo arma el backend). */
  description?: string | null
  items?: CotizacionItemRow[]
  /** Formato con que se guardó. null o ausente = gratex (filas de antes de la 026). */
  formato?: string | null
  /** Consecutivo del formato Ferretería (el de `code`); null en Gratex. */
  numero?: number | null
  /** DECIMAL como string (leer con aNumero); null en Gratex. */
  subtotal?: string | number | null
  itbis?: string | number | null
  /**
   * Ajustes por concepto (cargos_bancarios, manejo_bancario, mano_obra, abono,
   * retencion_isr), montos DECIMAL como string. Siempre objeto: `{}` en Gratex;
   * una clave ausente es 0. `retencion_isr` es el monto guardado, no la casilla.
   */
  ajustes?: Record<string, string | number>
}

export interface CotizacionItemInput {
  description: string
  /** Precio con ITBIS incluido, hasta 4 decimales. */
  amount: number
  /** Hasta 2 decimales: la cotización se convierte en e-CF (CantidadItem de la DGII). */
  quantity: number
  /** round(cantidad × precio, 2): el backend lo guarda tal cual en cotizacion_items. */
  subtotal?: number
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

/**
 * Cargos y abonos del formato Ferretería (debajo del ITBIS). Montos ≥ 0 con
 * hasta 2 decimales; una clave ausente es 0. Cargos y mano de obra se suman al
 * TOTAL sin ITBIS; retención y abono solo bajan lo adeudado.
 */
export interface AjustesFerreteria {
  cargos_bancarios?: number
  manejo_bancario?: number
  mano_obra?: number
  abono?: number
  /** Casilla "Retención Renta 5%": el backend calcula el 5% del Sub-total en cada guardado. */
  retencion_isr: boolean
}

/** Línea del formato Ferretería: de un producto del catálogo o libre (`product_id` null). */
export interface CotizacionFerreteriaItemInput {
  product_id: number | null
  description: string
  /** Hasta 2 decimales, y solo si la unidad admite fracciones. */
  quantity: number
  /** Precio unitario SIN ITBIS (el backend suma el ITBIS encima), hasta 4 decimales. */
  amount: number
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida: string
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion: number
  /** 1 = Bien, 2 = Servicio. Con `product_id`, el backend usa el del producto. */
  indicador_bien_servicio: number
}

/**
 * Cuerpo de POST / PUT / preview del formato Ferretería. Sin `total` ni
 * `user_id`: el backend calcula los totales y toma el usuario del token.
 * `formato` va siempre: si no es el del tenant (pantalla vieja) el backend
 * responde 409 sin guardar.
 */
export interface CotizacionFerreteriaInput {
  formato: 'ferreteria'
  client_id: number
  /** 'YYYY-MM-DD HH:MM:SS'. Ausente en PUT = se conserva la fecha guardada. */
  date?: string
  items: CotizacionFerreteriaItemInput[]
  /** Un PUT reemplaza el juego completo. */
  ajustes: AjustesFerreteria
}

// ---------------------------------------------------------------------------
// Conduces de mercancía (Ferretería) — tablas `conduces` / `conduce_items`
//   Nada se borra: `activo` 0 es un conduce eliminado o una línea que una
//   edición reemplazó. El API solo devuelve lo activo.
// ---------------------------------------------------------------------------

export interface ConduceItemRow {
  id?: number
  conduce_id?: number
  /** null = línea libre, o el producto se borró del catálogo después. */
  product_id?: number | null
  description?: string | null
  /** DECIMAL como string: leer con aNumero. */
  quantity?: string | number | null
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida?: string | null
  /** Precio interno SIN ITBIS, solo para Facturar: el conduce nunca lo muestra. DECIMAL como string. */
  amount?: string | number | null
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion?: number | string | null
  /** 1 = Bien, 2 = Servicio. */
  indicador_bien_servicio?: number | string | null
  activo?: number | string | null
}

export interface ConduceRow {
  id: number
  /** Consecutivo del conduce (el de `code`). */
  numero?: number | string | null
  /** CON-000001. No se vuelve a usar nunca, ni después de Eliminar. */
  code?: string | null
  date?: string | null
  /** Cotización de origen; null = sin cotización (se creó sin ella, o esa cotización se eliminó). */
  cotizacion_id?: number | null
  /** Código de la cotización de origen (COT-…); null = sin cotización. */
  cotizacion_code?: string | null
  client_id?: number | null
  /** Del cliente actual (LEFT JOIN clients): null si el cliente se borró. */
  client_name?: string | null
  company_name?: string | null
  rnc?: string | null
  /**
   * Nombre guardado en el conduce al crearlo o editarlo. Es el que se muestra
   * cuando el cliente ya no existe: `client_name || client_name_guardado`.
   */
  client_name_guardado?: string | null
  user_id?: number | null
  activo?: number | string | null
  /** Solo las líneas activas, por id. */
  items?: ConduceItemRow[]
}

/** Línea de un conduce: de un producto del catálogo o libre (`product_id` null). */
export interface ConduceItemInput {
  product_id: number | null
  description: string
  /** Las reglas de la cotización: hasta 2 decimales, y solo si la unidad admite fracciones. */
  quantity: number
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida: string
  /** Precio interno SIN ITBIS, hasta 4 decimales; 0 se acepta (línea libre). El formulario no lo muestra. */
  amount: number
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion: number
  /** 1 = Bien, 2 = Servicio. Con `product_id`, el backend usa el del producto. */
  indicador_bien_servicio: number
}

/**
 * Cuerpo de POST / PUT / preview de /api/conduces. Sin `ajustes` (el backend
 * responde 422: un conduce no lleva cargos ni abonos) ni `user_id` (sale del
 * token). En PUT el `id` va en el cuerpo, como en cotizaciones.
 */
export interface ConduceInput {
  /**
   * Al crear: la cotización de Ferretería de origen. Ausente = un conduce sin
   * cotización. En PUT se ignora.
   */
  cotizacion_id?: number
  client_id: number
  /** 'YYYY-MM-DD HH:MM:SS'. Ausente en PUT = se conserva la fecha guardada. */
  date?: string
  /** Un PUT reemplaza el juego completo (las líneas anteriores quedan inactivas). */
  items: ConduceItemInput[]
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

// Tipos del payload de gastos inferidos desde los esquemas Zod (./schemas/gasto).
export type {
  GastoCategoria,
  GastoTipo,
  GastoItemInput,
  CreateGastoInput,
} from './schemas/gasto'

// ---------------------------------------------------------------------------
// Unidades de medida — catálogo DGII (/api/unidades-medida)
// ---------------------------------------------------------------------------

/** `id` = código numérico DGII (va en el XML); codigo/descripcion para mostrar. */
export interface UnidadMedida {
  id: number
  codigo: string
  descripcion: string
  /**
   * La cantidad puede llevar decimales en esta unidad (metro, kg, litro, hora).
   * null/ausente = la master aún no tiene la marca (migración 010): no bloquea.
   */
  permite_decimales?: boolean | null
}

// ---------------------------------------------------------------------------
// Tipo de Bienes y Servicios Comprados — catálogo DGII
// (/api/tipos-bienes-servicios). Campo 3 del Formato 606.
// ---------------------------------------------------------------------------

/** `codigo` = '01'..'11'; se declara tal cual en el 606, siempre como cadena. */
export interface TipoBienesServicios {
  codigo: string
  descripcion: string
}

// ---------------------------------------------------------------------------
// Ubicaciones — catálogo DGII de provincias y municipios (/api/provincias-municipios)
// ---------------------------------------------------------------------------

/** `codigo` es lo que se persiste (emisor/cliente); descripcion solo para mostrar. */
export interface Ubicacion {
  /** El catálogo trae los tres niveles: 32 provincias, 156 municipios, 394 distritos. */
  tipo: 'PROVINCIA' | 'MUNICIPIO' | 'DISTRITO'
  codigo: string
  descripcion: string
  provincia_codigo?: string | null
}

// CreateGastoInput se infiere desde ./schemas/gasto (re-exportado arriba).

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
  /** Producto del catálogo (migración 024); null = línea libre. */
  product_id?: number | null
  unidad_medida?: string | null
}

export interface GastoRow {
  id: number
  categoria?: string | null
  tipo_gasto?: string | null
  /** Código DGII '01'..'11' (campo 3 del 606). null = gasto previo al campo. */
  tipo_bienes_servicios?: string | null
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
  /** Logo listo para <img src>. El API no sirve logos/ por URL: llega embebido. */
  logo_data_uri: string | null
  available_templates: string[]
  /**
   * Formato de cotización del tenant ('gratex' | 'ferreteria'; master
   * tenants.cotizacion_formato). Ausente si el backend todavía no lo expone:
   * el front lo trata como 'gratex'.
   */
  cotizacion_formato?: string
  /**
   * El POS está activo para la empresa (master tenants.pos_enabled). Con esto
   * se muestra el botón POS del navbar. Ausente si el backend no lo expone: sin POS.
   */
  pos_enabled?: boolean
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

// ---------------------------------------------------------------------------
// Facturas simples — /api/facturas-simples
//   Factura interna que NO se emite a la DGII (tipo_ecf IS NULL): sin e-NCF, sin
//   NCF fiscal y fuera del reporte 607. El backend genera el numero (0001-230826)
//   y calcula subtotal e ITBIS de cada linea desde indicador_facturacion.
// ---------------------------------------------------------------------------

/** Linea que el formulario envia. El backend deriva subtotal e itbis_amount. */
// Una factura simple no lleva impuestos: es un documento interno, no se emite a
// la DGII y no entra en el 606/607. Sus líneas no tienen tasa ni ITBIS.
export interface FacturaSimpleItemInput {
  /** Producto del catálogo; ausente = línea libre (no mueve inventario). */
  product_id?: number
  description: string
  /** Hasta 3 decimales (DECIMAL(12,3)); sin fracciones si la unidad no las admite. */
  quantity: number
  /** Hasta 4 decimales (DECIMAL(18,4)). */
  amount: number
  /** Descuento de la línea EN MONTO. El backend deja el subtotal neto de él. */
  descuento_monto?: number
  /** Unidad DGII del producto. Ausente = el backend usa la del producto, o ninguna en una línea libre. */
  unidad_medida?: string
}

export interface FacturaSimpleInput {
  client_id?: number | null
  client_name?: string
  date?: string
  /** 1=Contado 2=Crédito 3=Gratuito 4=Permuta 5=Otros (códigos DGII). */
  tipo_pago?: number
  /** Plazo del crédito en días (30, 45, 60). null = contado; sin plazo, el backend asume 30. */
  dias_credito?: number | null
  items: FacturaSimpleItemInput[]
}

/**
 * Linea tal como la devuelve el backend. Las columnas DECIMAL llegan como texto
 * ("1.500", "84.7500"): con `+` se concatenarían, así que se leen con aNumero.
 */
export interface FacturaSimpleItem {
  id?: number
  /** Producto del catálogo del que salió la línea (null = línea libre). */
  product_id?: number | null
  description: string
  quantity: number | string
  amount: number | string
  subtotal: number | string
  /** Descuento aplicado a la línea; `subtotal` ya viene neto de él. */
  descuento_monto?: number | string | null
  /** Código DGII de la unidad ('43' = Unidad, también el valor por defecto). */
  unidad_medida?: string | null
}

/** Fila del listado (GET /api/facturas-simples). */
export interface FacturaSimpleRow {
  id: number
  no_factura: string
  date: string
  client_id: number | null
  client_name: string | null
  company_name?: string | null
  total: number | string
  /** 1=Contado 2=Crédito 3=Gratuito 4=Permuta 5=Otros (códigos DGII). */
  tipo_pago?: number | string | null
  /** Plazo del crédito en días (migración 033). null = contado o crédito de 30. */
  dias_credito?: number | string | null
  /** Descripciones de las lineas concatenadas (para la columna Concepto). */
  description?: string | null
}

/**
 * Resumen de facturas simples para el dashboard (GET /api/facturas-simples/stats).
 * Mismos campos que los stats de e-CF, para sumarlos tal cual. Los meses y días
 * sin facturas no vienen.
 */
export interface FacturaSimpleStats {
  resumen: { total: number; monto_total: number } | null
  /** Últimos 12 meses (`mes` = YYYY-MM). */
  por_mes: StatsPorMes[]
  /** Últimos 31 días (`dia` = YYYY-MM-DD). */
  por_dia: StatsPorDia[]
}

/** Detalle (GET /api/facturas-simples/{id}), con sus lineas. */
export interface FacturaSimple extends FacturaSimpleRow {
  items: FacturaSimpleItem[]
  client_email?: string | null
}

// ---------------------------------------------------------------------------
// Inventario — ajustes y libro de movimientos (/api/inventario)
//
// El ajuste es la CABECERA (motivo, nota, totales) y cada línea es un
// movimiento del libro, con la foto del saldo antes y después. `products.stock`
// es el saldo derivado: toda variación pasa por aquí.
// ---------------------------------------------------------------------------

/** Motivos de un ajuste. ANULACION la pone el sistema, no el usuario. */
export type MotivoAjuste =
  | 'CONTEO_FISICO' | 'MERMA' | 'DANO' | 'ROBO'
  | 'DEVOLUCION' | 'ERROR_CAPTURA' | 'ANULACION' | 'OTRO'

export interface AjusteRow {
  id: number
  codigo: string
  fecha: string
  motivo: MotivoAjuste
  nota?: string | null
  warehouse_id: number
  almacen_nombre?: string | null
  total_lineas: number | string
  total_valor: number | string
  /** Ajuste que anuló a este (si tiene valor, este ajuste está anulado). */
  anulado_por_id?: number | null
  /** Este ajuste es la anulación de aquel. */
  anula_a_id?: number | null
}

/** Un movimiento del libro. Es también la línea de un ajuste. */
/** Estado de los productos que entran al reporte de valor. */
export type EstadoValorInv = 'activos' | 'inactivos' | 'todos'

export interface ValorInventarioParams {
  page?: number
  pageSize?: number
  query?: string
  warehouse_id?: number
  category_id?: number
  estado?: EstadoValorInv
  /** Corte AAAA-MM-DD. Vacío = hoy. */
  hasta?: string
}

/**
 * Una fila del reporte de valor: un producto a la fecha de corte. Los campos
 * numéricos ya vienen convertidos a number por getValorInventario, aunque la API
 * los mande como texto DECIMAL.
 */
export interface ValorInventarioRow {
  id: number
  sku: string
  nombre: string
  categoria: string
  almacen: string
  activo: boolean
  /**
   * Cantidades acumuladas hasta el corte, no número de movimientos. Pueden
   * traer hasta 3 decimales (kg, metro…): mostrarlas con fmtCantidad.
   */
  entradas: number
  salidas: number
  existencia: number
  costo_promedio: number
  /**
   * false => el costo mostrado es el de la ficha del producto, no un promedio
   * calculado: ese producto no tiene entradas registradas en el libro.
   */
  costo_ponderado: boolean
  valor_inventario: number
}

export interface ValorInventarioTotales {
  productos: number
  existencia: number
  valor: number
}

export interface MovimientoRow {
  id: number
  product_id: number
  producto_nombre?: string | null
  sku?: string | null
  warehouse_id: number
  tipo_movimiento: 'AJUSTE' | 'VENTA' | 'COMPRA' | 'DEVOLUCION' | string
  referencia_tipo?: string | null
  referencia_id?: number | null
  /**
   * Con signo: positivo suma al stock, negativo resta. DECIMAL(12,3): llega
   * como texto ("-2.500"); parsear con aNumero y mostrar con fmtCantidad.
   */
  cantidad: number | string
  cantidad_anterior: number | string
  cantidad_nueva: number | string
  costo_unitario: number | string
  valor_movimiento: number | string
  created_at: string
  /** Solo en el kardex: el ajuste que lo originó. */
  ajuste_codigo?: string | null
  motivo?: MotivoAjuste | null
}

export interface Ajuste extends AjusteRow {
  lineas: MovimientoRow[]
}

export interface CrearAjusteLinea {
  product_id: number
  tipo: 'INCREMENTO' | 'DISMINUCION'
  /**
   * Siempre positiva: el signo lo decide `tipo`. Hasta 3 decimales, y solo si
   * la unidad del producto admite fracciones.
   */
  cantidad: number
  /** Valoriza el movimiento. Si se omite, usa el costo del producto. */
  costo_unitario?: number
}

export interface CrearAjusteInput {
  motivo: MotivoAjuste
  nota?: string
  warehouse_id?: number
  lineas: CrearAjusteLinea[]
}

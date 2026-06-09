// AUTO-GENERATED - no editar a mano. Regenerar con scripts/gen-schema.ps1.
// Origen: mtldtmte_new_gratexdb (1).sql (dump MariaDB del esquema gratexdb).
// Solo estructura: una interface por tabla con sus columnas tipadas.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Tabla api_tokens */
export interface ApiTokens {
  id: number // PK
  user_id: number
  token_hash: string
  created_at: string
  last_used: string | null
  is_active: boolean | null
}

/** Tabla clients */
export interface Clients {
  id: number // PK
  email: string
  rnc: string | null
  razon_social: string | null
  direccion: string | null
  municipio: string | null
  provincia: string | null
  client_name: string
  company_name: string
  phone_number: string | null
}

/** Tabla cotizaciones */
export interface Cotizaciones {
  id: number // PK
  code: string
  date: string | null
  client_id: number | null
  user_id: number
  total: number
  updated_at: string | null
}

/** Tabla cotizacion_items */
export interface CotizacionItems {
  id: number // PK
  cotizacion_id: number
  description: string
  amount: number
  quantity: number
  subtotal: number
}

/** Tabla emisor_config */
export interface EmisorConfig {
  id: number // PK
  rnc: string
  razon_social: string
  nombre_comercial: string | null
  sucursal: string | null
  direccion: string
  municipio: string | null
  provincia: string | null
  telefono: string | null
  correo: string | null
  website: string | null
  actividad_economica: string | null
  fecha_vencimiento_secuencia: string
}

/** Tabla facturas */
export interface Facturas {
  id: number // PK
  no_factura: string
  date: string | null
  client_id: number | null
  client_name: string
  user_id: number
  total: number
  NCF: string | null
  tipo_ecf: string | null
  e_ncf: string | null
  track_id: string | null
  estado_dgii: string
  codigo_seguridad: string | null
  fecha_emision_dgii: string | null
  ambiente_dgii: string | null
  xml_firmado: string | null
  respuesta_dgii: string | null
  rfce_xml: string | null
  rfce_track_id: string | null
  rfce_estado: string | null
  rfce_respuesta: string | null
  secuencia_utilizada: boolean | null
  ncf_modificado: string | null
  fecha_ncf_modificado: string | null
  codigo_modificacion: string | null
  razon_modificacion: string | null
}

/** Tabla factura_items */
export interface FacturaItems {
  id: number // PK
  factura_id: number
  description: string
  amount: number
  quantity: number
  subtotal: number
  indicador_facturacion: number
  indicador_bien_servicio: number
  itbis_amount: number
}

/** Tabla gang_runs */
export interface GangRuns {
  id: number // PK
  title: string
  status: string
  total_jobs: number
  combined_file_path: string | null
  scheduled_at: string | null
  completed_at: string | null
  approved_by: number | null
  created_at: string
  updated_at: string
}

/** Tabla landing_carousel */
export interface LandingCarousel {
  id: number // PK
  title: string
  subtitle: string | null
  image_path: string
  created_at: string | null
}

/** Tabla landing_services */
export interface LandingServices {
  id: number // PK
  title: string
  description: string | null
  image_path: string
  created_at: string | null
}

/** Tabla ncf_sequences */
export interface NcfSequences {
  id: number // PK
  type: string
  prefix: string
  current_value: number
  description: string | null
  created_at: string | null
  updated_at: string | null
  ambiente: string
}

/** Tabla print_jobs */
export interface PrintJobs {
  id: number // PK
  client_id: number
  gang_run_id: number | null
  file_path: string
  file_format: string
  status: string
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

/** Tabla queue_notifications */
export interface QueueNotifications {
  id: number // PK
  print_job_id: number
  client_id: number
  type: string
  channel: string
  message: string
  is_read: boolean
  sent_at: string | null
  created_at: string
}

/** Tabla users */
export interface Users {
  id: number // PK
  name: string
  last_name: string
  email: string
  username: string
  password: string
  role: string | null
}

/** Mapa de cada nombre de tabla a su interface de fila. */
export interface Database {
  api_tokens: ApiTokens
  clients: Clients
  cotizaciones: Cotizaciones
  cotizacion_items: CotizacionItems
  emisor_config: EmisorConfig
  facturas: Facturas
  factura_items: FacturaItems
  gang_runs: GangRuns
  landing_carousel: LandingCarousel
  landing_services: LandingServices
  ncf_sequences: NcfSequences
  print_jobs: PrintJobs
  queue_notifications: QueueNotifications
  users: Users
}

export type TableName = keyof Database
export type TableRow<T extends TableName> = Database[T]

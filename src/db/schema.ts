// AUTO-GENERATED - no editar a mano. Regenerar con scripts/gen-schema.ps1.
// Descripcion en runtime del esquema gratexdb: tablas, columnas, tipos y llaves.

import type { TableName } from '../types/database'

export type TsType = 'number' | 'string' | 'boolean' | 'Json'

export interface ColumnMeta {
  name: string
  sqlType: string
  tsType: TsType
  nullable: boolean
  primaryKey: boolean
  references: string | null
}

export interface TableMeta {
  name: string
  primaryKey: string | null
  columns: ColumnMeta[]
}

export const SCHEMA = {
  api_tokens: {
    name: 'api_tokens',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'user_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'users' },
      { name: 'token_hash', sqlType: 'varchar(64) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'last_used', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'is_active', sqlType: 'tinyint(1) DEFAULT \'1\'', tsType: 'boolean', nullable: true, primaryKey: false, references: null },
    ],
  },
  clients: {
    name: 'clients',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'email', sqlType: 'varchar(100) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'rnc', sqlType: 'varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'razon_social', sqlType: 'varchar(150) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'direccion', sqlType: 'varchar(100) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'municipio', sqlType: 'varchar(50) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'provincia', sqlType: 'varchar(50) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'client_name', sqlType: 'varchar(100) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'company_name', sqlType: 'varchar(100) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'phone_number', sqlType: 'varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
  cotizaciones: {
    name: 'cotizaciones',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'code', sqlType: 'varchar(50) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'date', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'client_id', sqlType: 'int DEFAULT NULL', tsType: 'number', nullable: true, primaryKey: false, references: null },
      { name: 'user_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'total', sqlType: 'decimal(10,2) NOT NULL DEFAULT \'0.00\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'updated_at', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
  cotizacion_items: {
    name: 'cotizacion_items',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'cotizacion_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'cotizaciones' },
      { name: 'description', sqlType: 'text NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'amount', sqlType: 'decimal(10,2) NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'quantity', sqlType: 'int NOT NULL DEFAULT \'1\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'subtotal', sqlType: 'decimal(10,2) NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
    ],
  },
  emisor_config: {
    name: 'emisor_config',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'rnc', sqlType: 'varchar(11) COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'razon_social', sqlType: 'varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'nombre_comercial', sqlType: 'varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'sucursal', sqlType: 'varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'direccion', sqlType: 'varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'municipio', sqlType: 'varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'provincia', sqlType: 'varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'telefono', sqlType: 'varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT \'Formato: 999-999-9999\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'correo', sqlType: 'varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'website', sqlType: 'varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'actividad_economica', sqlType: 'varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'fecha_vencimiento_secuencia', sqlType: 'date NOT NULL DEFAULT \'2030-12-31\' COMMENT \'Fecha de vencimiento de la secuencia autorizada por DGII\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
    ],
  },
  facturas: {
    name: 'facturas',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'no_factura', sqlType: 'varchar(50) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'date', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'client_id', sqlType: 'int DEFAULT NULL', tsType: 'number', nullable: true, primaryKey: false, references: null },
      { name: 'client_name', sqlType: 'varchar(100) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'user_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'total', sqlType: 'decimal(10,2) NOT NULL DEFAULT \'0.00\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'NCF', sqlType: 'varchar(50) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'tipo_ecf', sqlType: 'varchar(2) DEFAULT NULL COMMENT \'31, 32, 33, 34, 41, 43, 44, 45, 46, 47\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'e_ncf', sqlType: 'varchar(13) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'track_id', sqlType: 'varchar(60) DEFAULT NULL COMMENT \'TrackId que devuelve DGII al recibir el e-CF\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'estado_dgii', sqlType: 'varchar(20) NOT NULL DEFAULT \'PENDIENTE\' COMMENT \'PENDIENTE | ENVIADO | ACEPTADO | ACEPTADO_CONDICIONAL | RECHAZADO | ERROR\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'codigo_seguridad', sqlType: 'varchar(10) DEFAULT NULL COMMENT \'Codigo de seguridad para representacion impresa y QR\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'fecha_emision_dgii', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'ambiente_dgii', sqlType: 'varchar(20) DEFAULT NULL COMMENT \'testecf | certecf | ecf\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'xml_firmado', sqlType: 'mediumtext COMMENT \'XML firmado enviado a DGII\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'respuesta_dgii', sqlType: 'text COMMENT \'Ultima respuesta de DGII (JSON serializado)\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'rfce_xml', sqlType: 'mediumtext COMMENT \'XML firmado del RFCE enviado al servicio de resumenes\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'rfce_track_id', sqlType: 'varchar(60) DEFAULT NULL COMMENT \'TrackId devuelto por DGII al recibir el RFCE\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'rfce_estado', sqlType: 'varchar(30) DEFAULT NULL COMMENT \'PENDIENTE | ENVIADO | ACEPTADO | RECHAZADO | ERROR\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'rfce_respuesta', sqlType: 'text COMMENT \'Ultima respuesta de DGII al RFCE (JSON serializado)\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'secuencia_utilizada', sqlType: 'tinyint(1) DEFAULT NULL', tsType: 'boolean', nullable: true, primaryKey: false, references: null },
      { name: 'ncf_modificado', sqlType: 'varchar(19) DEFAULT NULL COMMENT \'e-NCF del comprobante que esta nota (E33/E34) modifica\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'fecha_ncf_modificado', sqlType: 'date DEFAULT NULL COMMENT \'Fecha de emision del NCF modificado\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'codigo_modificacion', sqlType: 'varchar(2) DEFAULT NULL COMMENT \'1=Anula | 2=Corrige texto | 3=Corrige montos | 4=Reemplazo contingencia | 5=Ref. Factura Consumo\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'razon_modificacion', sqlType: 'varchar(90) DEFAULT NULL COMMENT \'Motivo/descripcion de la modificacion (se muestra en la RI)\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
  factura_items: {
    name: 'factura_items',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'factura_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'facturas' },
      { name: 'description', sqlType: 'text NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'amount', sqlType: 'decimal(10,2) NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'quantity', sqlType: 'int NOT NULL DEFAULT \'1\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'subtotal', sqlType: 'decimal(10,2) NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'indicador_facturacion', sqlType: 'tinyint NOT NULL DEFAULT \'1\' COMMENT \'0=No facturable | 1=ITBIS 18% | 2=ITBIS 16% | 3=ITBIS 0% | 4=Exento\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'indicador_bien_servicio', sqlType: 'tinyint NOT NULL DEFAULT \'1\' COMMENT \'1=Bien | 2=Servicio\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'itbis_amount', sqlType: 'decimal(18,2) NOT NULL DEFAULT \'0.00\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
    ],
  },
  gang_runs: {
    name: 'gang_runs',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'title', sqlType: 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'status', sqlType: 'enum(\'assembling\',\'ready\',\'printing\',\'completed\') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT \'assembling\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'total_jobs', sqlType: 'int NOT NULL DEFAULT \'0\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'combined_file_path', sqlType: 'varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'scheduled_at', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'completed_at', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'approved_by', sqlType: 'int DEFAULT NULL', tsType: 'number', nullable: true, primaryKey: false, references: 'users' },
      { name: 'created_at', sqlType: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'updated_at', sqlType: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', tsType: 'string', nullable: false, primaryKey: false, references: null },
    ],
  },
  landing_carousel: {
    name: 'landing_carousel',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'title', sqlType: 'varchar(255) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'subtitle', sqlType: 'varchar(255) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'image_path', sqlType: 'varchar(500) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
  landing_services: {
    name: 'landing_services',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'title', sqlType: 'varchar(255) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'description', sqlType: 'text', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'image_path', sqlType: 'varchar(500) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
  ncf_sequences: {
    name: 'ncf_sequences',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'type', sqlType: 'varchar(10) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'prefix', sqlType: 'varchar(10) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'current_value', sqlType: 'int NOT NULL DEFAULT \'0\'', tsType: 'number', nullable: false, primaryKey: false, references: null },
      { name: 'description', sqlType: 'varchar(100) DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'updated_at', sqlType: 'datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'ambiente', sqlType: 'varchar(20) NOT NULL DEFAULT \'certecf\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
    ],
  },
  print_jobs: {
    name: 'print_jobs',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'client_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'clients' },
      { name: 'gang_run_id', sqlType: 'int DEFAULT NULL', tsType: 'number', nullable: true, primaryKey: false, references: 'gang_runs' },
      { name: 'file_path', sqlType: 'varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'file_format', sqlType: 'varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT \'pdf, ai, png, jpg, tiff\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'status', sqlType: 'enum(\'pending\',\'queued\',\'processing\',\'completed\',\'cancelled\',\'rejected\') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT \'pending\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'rejection_reason', sqlType: 'text COLLATE utf8mb4_unicode_ci COMMENT \'Motivo si status=rejected\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'updated_at', sqlType: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', tsType: 'string', nullable: false, primaryKey: false, references: null },
    ],
  },
  queue_notifications: {
    name: 'queue_notifications',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'print_job_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'print_jobs' },
      { name: 'client_id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: false, references: 'clients' },
      { name: 'type', sqlType: 'enum(\'queued\',\'assembled\',\'printing\',\'ready_pickup\',\'cancelled\',\'rejected\') COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'channel', sqlType: 'enum(\'email\',\'sms\',\'push\') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT \'email\'', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'message', sqlType: 'text COLLATE utf8mb4_unicode_ci NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'is_read', sqlType: 'tinyint(1) NOT NULL DEFAULT \'0\'', tsType: 'boolean', nullable: false, primaryKey: false, references: null },
      { name: 'sent_at', sqlType: 'datetime DEFAULT NULL', tsType: 'string', nullable: true, primaryKey: false, references: null },
      { name: 'created_at', sqlType: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP', tsType: 'string', nullable: false, primaryKey: false, references: null },
    ],
  },
  users: {
    name: 'users',
    primaryKey: 'id',
    columns: [
      { name: 'id', sqlType: 'int NOT NULL', tsType: 'number', nullable: false, primaryKey: true, references: null },
      { name: 'name', sqlType: 'varchar(70) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'last_name', sqlType: 'varchar(70) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'email', sqlType: 'varchar(300) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'username', sqlType: 'varchar(50) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'password', sqlType: 'varchar(255) NOT NULL', tsType: 'string', nullable: false, primaryKey: false, references: null },
      { name: 'role', sqlType: 'varchar(20) DEFAULT \'user\'', tsType: 'string', nullable: true, primaryKey: false, references: null },
    ],
  },
} satisfies Record<TableName, TableMeta>

export const TABLE_NAMES = Object.keys(SCHEMA) as TableName[]

export function getTable(name: TableName): TableMeta {
  return SCHEMA[name]
}

export function getColumns(name: TableName): ColumnMeta[] {
  return SCHEMA[name].columns
}

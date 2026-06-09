# FISCALO - Generador de tipos a partir del dump SQL.
# Lee mtldtmte_new_gratexdb (1).sql y produce:
#   src/types/database.ts  (una interface por tabla + mapa Database)
#   src/db/schema.ts       (metadatos en runtime: columnas, tipos, llaves)
#   public/db_schema.js    (window.SCHEMA para Diagrama BD.html)
# Solo estructura: ignora los INSERT/datos.
# Mantener este archivo en ASCII puro (PowerShell 5.1 lee .ps1 como ANSI).
$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$src       = Join-Path $root 'mtldtmte_new_gratexdb (1).sql'
$outTypes  = Join-Path $root 'src\types\database.ts'
$outSchema = Join-Path $root 'src\db\schema.ts'
$outPublic = Join-Path $root 'public\db_schema.js'

$lines = Get-Content -LiteralPath $src

function Map-Type([string]$def) {
  $d = $def.ToLower().Trim()
  $base = ($d -split '[\s(]')[0]
  switch -Regex ($base) {
    '^tinyint$'                                          { if ($d -match 'tinyint\(1\)') { 'boolean' } else { 'number' }; break }
    '^(int|integer|bigint|smallint|mediumint|year|bit)$' { 'number'; break }
    '^(decimal|numeric|float|double|real)$'              { 'number'; break }
    '^json$'                                             { 'Json'; break }
    default                                              { 'string' }
  }
}

function To-Pascal([string]$name) {
  ($name -split '[_]' | ForEach-Object { if ($_.Length -gt 0) { $_.Substring(0,1).ToUpper() + $_.Substring(1) } }) -join ''
}

# --- Primera pasada: CREATE TABLE -> columnas ---
$tables = New-Object System.Collections.Generic.List[object]
$seen = New-Object System.Collections.Generic.HashSet[string]
$current = $null

foreach ($line in $lines) {
  if ($line -match '^\s*CREATE TABLE\s+`([^`]+)`') {
    $name = $matches[1]
    if (-not $seen.Add($name)) { $current = $null; continue }  # ignora redefiniciones
    $current = [ordered]@{ Name = $name; Pk = $null; Columns = (New-Object System.Collections.Generic.List[object]) }
    $tables.Add($current)
    continue
  }
  if ($null -eq $current) { continue }

  if ($line -match '^\s*PRIMARY KEY\s*\(`([^`]+)`') { $current.Pk = $matches[1]; continue }
  if ($line -match '^\s*(KEY|UNIQUE KEY|CONSTRAINT|FULLTEXT|SPATIAL|PRIMARY KEY)\b') { continue }
  if ($line -match '^\s*\)') { $current = $null; continue }

  if ($line -match '^\s*`([^`]+)`\s+(.+?)\s*,?\s*$') {
    $colName = $matches[1]
    $colDef  = $matches[2]
    $notNull = $colDef -match '(?i)\bNOT NULL\b'
    $current.Columns.Add([ordered]@{
      Name = $colName
      Sql  = ($colDef -replace ',\s*$', '').Trim()
      Ts   = (Map-Type $colDef)
      Nullable = (-not $notNull)
      Pk   = $false
    })
  }
}

# --- Segunda pasada: PRIMARY KEY y FOREIGN KEY desde los bloques ALTER TABLE ---
$byName = @{}
foreach ($t in $tables) { $byName[$t.Name] = $t }
# Mapa "tabla.columna" -> tabla referenciada (para llaves foraneas).
$fkRefs = @{}
$alterTarget = $null
foreach ($line in $lines) {
  if ($line -match '^\s*ALTER TABLE\s+`([^`]+)`') { $alterTarget = $matches[1] }

  if ($line -match '^\s*ADD PRIMARY KEY\s*\(`([^`]+)`' -and $alterTarget) {
    if ($byName.ContainsKey($alterTarget)) { $byName[$alterTarget].Pk = $matches[1] }
  }
  if ($line -match 'FOREIGN KEY\s*\(`([^`]+)`\)\s*REFERENCES\s*`([^`]+)`' -and $alterTarget) {
    $fkRefs["$alterTarget.$($matches[1])"] = $matches[2]
  }

  if ($line -match ';\s*$') { $alterTarget = $null }
}

foreach ($t in $tables) {
  if ($t.Pk) { foreach ($c in $t.Columns) { if ($c.Name -eq $t.Pk) { $c.Pk = $true } } }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)

# ---------- database.ts ----------
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('// AUTO-GENERATED - no editar a mano. Regenerar con scripts/gen-schema.ps1.')
[void]$sb.AppendLine('// Origen: mtldtmte_new_gratexdb (1).sql (dump MariaDB del esquema gratexdb).')
[void]$sb.AppendLine('// Solo estructura: una interface por tabla con sus columnas tipadas.')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('export type Json =')
[void]$sb.AppendLine('  | string')
[void]$sb.AppendLine('  | number')
[void]$sb.AppendLine('  | boolean')
[void]$sb.AppendLine('  | null')
[void]$sb.AppendLine('  | { [key: string]: Json | undefined }')
[void]$sb.AppendLine('  | Json[]')
[void]$sb.AppendLine('')
foreach ($t in $tables) {
  $pascal = To-Pascal $t.Name
  [void]$sb.AppendLine('/** Tabla ' + $t.Name + ' */')
  [void]$sb.AppendLine("export interface $pascal {")
  foreach ($c in $t.Columns) {
    $ty = if ($c.Nullable) { "$($c.Ts) | null" } else { $c.Ts }
    $pk = if ($c.Pk) { ' // PK' } else { '' }
    [void]$sb.AppendLine("  $($c.Name): $ty$pk")
  }
  [void]$sb.AppendLine('}')
  [void]$sb.AppendLine('')
}
[void]$sb.AppendLine('/** Mapa de cada nombre de tabla a su interface de fila. */')
[void]$sb.AppendLine('export interface Database {')
foreach ($t in $tables) { [void]$sb.AppendLine("  $($t.Name): $(To-Pascal $t.Name)") }
[void]$sb.AppendLine('}')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('export type TableName = keyof Database')
[void]$sb.AppendLine('export type TableRow<T extends TableName> = Database[T]')
[System.IO.File]::WriteAllText($outTypes, $sb.ToString(), $utf8)

# ---------- db/schema.ts ----------
$sc = New-Object System.Text.StringBuilder
[void]$sc.AppendLine('// AUTO-GENERATED - no editar a mano. Regenerar con scripts/gen-schema.ps1.')
[void]$sc.AppendLine('// Descripcion en runtime del esquema gratexdb: tablas, columnas, tipos y llaves.')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('import type { TableName } from ''../types/database''')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export type TsType = ''number'' | ''string'' | ''boolean'' | ''Json''')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export interface ColumnMeta {')
[void]$sc.AppendLine('  name: string')
[void]$sc.AppendLine('  sqlType: string')
[void]$sc.AppendLine('  tsType: TsType')
[void]$sc.AppendLine('  nullable: boolean')
[void]$sc.AppendLine('  primaryKey: boolean')
[void]$sc.AppendLine('  references: string | null')
[void]$sc.AppendLine('}')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export interface TableMeta {')
[void]$sc.AppendLine('  name: string')
[void]$sc.AppendLine('  primaryKey: string | null')
[void]$sc.AppendLine('  columns: ColumnMeta[]')
[void]$sc.AppendLine('}')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export const SCHEMA = {')
foreach ($t in $tables) {
  $pkVal = if ($t.Pk) { "'$($t.Pk)'" } else { 'null' }
  [void]$sc.AppendLine("  $($t.Name): {")
  [void]$sc.AppendLine("    name: '$($t.Name)',")
  [void]$sc.AppendLine("    primaryKey: $pkVal,")
  [void]$sc.AppendLine('    columns: [')
  foreach ($c in $t.Columns) {
    $sqlEsc = $c.Sql -replace "'", "\'"
    $nul = if ($c.Nullable) { 'true' } else { 'false' }
    $pk  = if ($c.Pk) { 'true' } else { 'false' }
    $ref = $fkRefs["$($t.Name).$($c.Name)"]
    $refVal = if ($ref) { "'$ref'" } else { 'null' }
    [void]$sc.AppendLine("      { name: '$($c.Name)', sqlType: '$sqlEsc', tsType: '$($c.Ts)', nullable: $nul, primaryKey: $pk, references: $refVal },")
  }
  [void]$sc.AppendLine('    ],')
  [void]$sc.AppendLine('  },')
}
[void]$sc.AppendLine('} satisfies Record<TableName, TableMeta>')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export const TABLE_NAMES = Object.keys(SCHEMA) as TableName[]')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export function getTable(name: TableName): TableMeta {')
[void]$sc.AppendLine('  return SCHEMA[name]')
[void]$sc.AppendLine('}')
[void]$sc.AppendLine('')
[void]$sc.AppendLine('export function getColumns(name: TableName): ColumnMeta[] {')
[void]$sc.AppendLine('  return SCHEMA[name].columns')
[void]$sc.AppendLine('}')
[System.IO.File]::WriteAllText($outSchema, $sc.ToString(), $utf8)

# ---------- public/db_schema.js (window.SCHEMA para Diagrama BD.html) ----------
$moduleOrder = @('sistema', 'ventas', 'fiscal', 'produccion', 'web')
$moduleDefs = [ordered]@{
  sistema    = @{ label = 'Sistema / Usuarios';     color = '#2a6fdb' }
  ventas     = @{ label = 'Ventas / Facturacion';   color = '#1f8a5b' }
  fiscal     = @{ label = 'Fiscal / DGII';          color = '#8a4fcf' }
  produccion = @{ label = 'Produccion / Impresion'; color = '#c47f12' }
  web        = @{ label = 'Sitio web';              color = '#0e8a8a' }
}
$tableModule = @{
  users = 'sistema'; api_tokens = 'sistema'
  clients = 'ventas'; cotizaciones = 'ventas'; cotizacion_items = 'ventas'; facturas = 'ventas'; factura_items = 'ventas'
  emisor_config = 'fiscal'; ncf_sequences = 'fiscal'
  gang_runs = 'produccion'; print_jobs = 'produccion'; queue_notifications = 'produccion'
  landing_carousel = 'web'; landing_services = 'web'
}

# Layout automatico: una columna por modulo, tablas apiladas verticalmente.
$colX = 40; $colGap = 320; $rowH = 22; $headH = 46; $tableGap = 34
$pos = @{}
for ($mi = 0; $mi -lt $moduleOrder.Count; $mi++) {
  $mod = $moduleOrder[$mi]
  $x = $colX + ($mi * $colGap)
  $y = 60
  foreach ($t in $tables) {
    $tm = if ($tableModule.ContainsKey($t.Name)) { $tableModule[$t.Name] } else { 'sistema' }
    if ($tm -ne $mod) { continue }
    $pos[$t.Name] = @{ x = $x; y = $y; module = $mod }
    $y += $headH + ($t.Columns.Count * $rowH) + $tableGap
  }
}

$pb = New-Object System.Text.StringBuilder
[void]$pb.AppendLine('// AUTO-GENERATED desde mtldtmte_new_gratexdb (1).sql - solo tablas y columnas.')
[void]$pb.AppendLine('// Consumido por Diagrama BD.html (window.SCHEMA).')
[void]$pb.AppendLine('window.SCHEMA = {')
[void]$pb.AppendLine('  modules: {')
foreach ($k in $moduleDefs.Keys) {
  [void]$pb.AppendLine("    $($k): { label: ""$($moduleDefs[$k].label)"", color: ""$($moduleDefs[$k].color)"" },")
}
[void]$pb.AppendLine('  },')
[void]$pb.AppendLine('  tables: [')
foreach ($t in $tables) {
  $p = $pos[$t.Name]
  if ($null -eq $p) { $p = @{ x = 40; y = 60; module = 'sistema' } }
  [void]$pb.AppendLine("    { id: ""$($t.Name)"", module: ""$($p.module)"", x: $($p.x), y: $($p.y), cols: [")
  foreach ($c in $t.Columns) {
    $shortType = ($c.Sql -split '\s+')[0]
    $ref = $fkRefs["$($t.Name).$($c.Name)"]
    $isFk = [bool]$ref
    $k = if ($c.Pk -and $isFk) { 'pk,fk' } elseif ($c.Pk) { 'pk' } elseif ($isFk) { 'fk' } else { '' }
    $parts = @("n: ""$($c.Name)""", "t: ""$shortType""")
    if ($k)         { $parts += "k: ""$k""" }
    if ($ref)       { $parts += "ref: ""$ref""" }
    if ($c.Nullable) { $parts += 'nullable: true' }
    [void]$pb.AppendLine('      { ' + ($parts -join ', ') + ' },')
  }
  [void]$pb.AppendLine('    ] },')
}
[void]$pb.AppendLine('  ],')
[void]$pb.AppendLine('};')
[System.IO.File]::WriteAllText($outPublic, $pb.ToString(), $utf8)

Write-Output ("Tablas: " + $tables.Count)
Write-Output ("Columnas: " + (($tables | ForEach-Object { $_.Columns.Count }) | Measure-Object -Sum).Sum)
Write-Output ("Con PK: " + (($tables | Where-Object { $_.Pk }).Count))
Write-Output ("Llaves foraneas: " + $fkRefs.Count)

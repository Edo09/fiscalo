# Conduces de mercancía (Ferretería) — design

- **Date:** 2026-10-05 (revised 2026-10-06)
- **Repos:** `fiscalo` (React frontend) and `api-gratex` (PHP backend), branch `feat/conduces` in both.
- **Builds on:** the per-tenant cotización formats
  (`docs/superpowers/specs/2026-10-01-cotizacion-formatos-design.md`), already merged.
- **In production:** master 011 and tenant 026 and 027 are run on both tenant databases. Tenant 028
  (`estado_dgii` width) is on master too and must be run on both databases before this deploy (section 7).
- **Status:**
  - Design approved in chat, section by section.
  - Revised after an adversarial review against the code: 5 lenses, a skeptic per lens, 47 findings confirmed.
  - Revised again with the user's decisions: a sequence table, and soft delete for conduces only.
  - Pending the user's review of this document.

## 1. Goal

Ferretería (the tenant on the `ferreteria` cotización formato) needs a **conduce de mercancía**: a delivery
note that goes with the goods and that the customer signs ("Recibido por"). It looks exactly like their
cotización but shows **no prices**.

### Document flows (user decision)

```
Cotización ──► Conduce                          (new: "Conduce" button on a quote)
Cotización ──► Factura (e-CF / factura simple)  (exists today)
Conduce    ──► Factura (e-CF / factura simple)  (new)
```

Two things are **not** supported: conduce → cotización, and a conduce created from scratch.

### Success criteria

- **From a quote:** on a Ferretería quote, "Conduce" opens a conduce form pre-filled with the quote's client
  and lines.
  - The user can edit before saving: remove lines, change quantities or descriptions, add products or free
    lines, change the client or the date.
  - On save it gets its own number, `CON-000001`, linked to its quote.
  - A quote can produce any number of conduces.
- **Numbers:** a conduce number is **never reused**, not even after Eliminar.
- **Nothing is deleted from the database:**
  - Eliminar sets `activo = 0`.
  - Editing a conduce keeps its previous lines, set to `activo = 0`.
- **The Conduces page:** it has its own sidebar entry, visible only for tenants on the `ferreteria` formato.
  The page lists the active conduces with PDF, edit and Facturar ▾.
- **The conduce PDF:**
  - It has the cotización's look, titled **CONDUCE DE MERCANCÍA**.
  - Columns: **Cantidad | Unidad | Descripción**.
  - No prices and no totals.
  - "Recibido por" and the footer.
  - The source quote's code.
- **Facturar from a conduce** pre-fills the e-CF or factura-simple form with the conduce's lines, using each
  line's internal price, ITBIS rate, product and unit. Issuing moves inventory as usual. A line without a
  price cannot be issued.
- **Gratex does not change:**
  - no menu entry, no button;
  - no different response from any endpoint it uses;
  - `cotizaciones` and `cotizacion_items` are not modified;
  - the quote's validation messages and its PDF stay identical.

## 2. Decisions taken (brainstorming Q&A)

| Topic | Decision |
|---|---|
| Storage | **New tables** `conduces`, `conduce_items` and `conduce_secuencia`. The cotización tables are not touched. |
| What a conduce is | A saved document with its own number (`CON-000001`), linked to its source quote. |
| Created from | Only from a quote ("Conduce" button). There is no new conduce from scratch. |
| Editing | An editable copy: lines, quantities, descriptions, client and date, before saving and later. |
| Conduces per quote | Many, one per delivery. Delivered versus pending quantities are not tracked. |
| Converts to | Factura only (e-CF or factura simple). Never to a quote. |
| Where | Its **own page** and **sidebar entry** under Cotizaciones, under the same `cotizaciones` permission, visible only for the `ferreteria` formato. |
| Prices | Never shown or printed on a conduce. Each line keeps them internally for Facturar. |
| Numbers | **Never reused.** A sequence table holds the last number, and the UNIQUE key is the safety net. |
| Deleting | **Never physically.** Eliminar sets `conduces.activo = 0`. Editing sets the previous lines' `activo = 0` and inserts the new ones. Quotes keep their current delete (out of scope). |
| Formato | Only `ferreteria`. Gratex never sees conduces. |
| 0-price lines in Facturar | Blocked: the factura can't be issued or saved until every line from the conduce has a price (controller ruling, section 5.6). |
| Quote cargos | Not copied to the conduce. The new-conduce form says so (controller ruling, section 5.5). |

## 3. Data model: tenant migration `029_conduces.sql`

The migration runs on **each** tenant database, after 028. It does not depend on 027 or 028; 029 is simply the
next free number. It **only creates tables** (plus one seed row), so it is safe with the code running in
production today.

### 3.1 How it is written (phpMyAdmin rule)

It follows the rule in `db/migrations/README.md` and the layout of 028, **not** 026's layout.
- In production phpMyAdmin, a top-level SELECT on `information_schema` switches the current database.
  That is what broke 028 the first time.
- So:
  1. The first statement is `SET @db := DATABASE();`. `DATABASE()` appears nowhere else.
  2. Every `information_schema` filter uses `TABLE_SCHEMA = @db`.
  3. Facts go into variables:
     - `@tipo_cot_id` and `@tipo_product_id` (the `COLUMN_TYPE` of `cotizaciones.id` and `products.id`);
     - `@motores_innodb` (the count of `cotizaciones`/`products` with `ENGINE = 'InnoDB'`);
     - `@has_conduces`, `@has_conduce_items`, `@has_conduce_secuencia`.
  4. Every CREATE is guarded and qualified, for example:
     ```sql
     SET @crear_conduces := (@has_conduces = 0 AND @motores_innodb = 2
                             AND @tipo_cot_id IS NOT NULL AND @tipo_product_id IS NOT NULL);
     SET @sql_conduces := IF(@crear_conduces = 1,
       CONCAT('CREATE TABLE IF NOT EXISTS `', @db, '`.conduces (', ..., ') ENGINE=InnoDB ...'),
       'DO 0');
     PREPARE s FROM @sql_conduces; EXECUTE s; DEALLOCATE PREPARE s;
     ```
     References are qualified the same way: `` `@db`.cotizaciones ``, `` `@db`.products ``,
     `` `@db`.conduces ``. The seed row uses the same guarded, prepared form.
  5. **The only top-level SELECT is the last statement.** It shows:
     - `base` (`@db`);
     - both engines and both id types;
     - each table present;
     - the indexes;
     - the FKs with `DELETE_RULE` (from `information_schema.REFERENTIAL_CONSTRAINTS`);
     - the `conduce_secuencia` row.

     If the engines are not InnoDB, that SELECT shows it, and nothing was created.
- **Header:** POR QUÉ / QUÉ HACE / CÓMO CORRERLA (phpMyAdmin: paste the whole file with the tenant database
  selected) / ANTES DE CORRER / ORDEN, as 028 has.
  - ANTES DE CORRER says off-hours, because creating the FKs takes brief metadata locks on `cotizaciones` and
    `products`.
  - ORDEN says after 028, and before the code.
- **Idempotent:** a second run creates nothing and changes nothing.

### 3.2 Tables

The `<… type>` placeholders are copied from `information_schema`, signedness included.

```sql
CREATE TABLE IF NOT EXISTS conduces (
  id             INT(11)       NOT NULL AUTO_INCREMENT,
  numero         INT UNSIGNED  NOT NULL,
  code           VARCHAR(20)   NOT NULL COMMENT 'CON-000001',
  date           DATETIME      NOT NULL,
  cotizacion_id  <cotizaciones.id type> NULL COMMENT 'Cotizacion de origen; NULL si se elimino la cotizacion',
  client_id      INT(11)       NULL,
  client_name    VARCHAR(100)  NULL COMMENT 'Nombre guardado (el cliente se puede borrar)',
  user_id        INT(11)       NULL COMMENT 'master users.id (sin FK cross-DB)',
  activo         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = eliminado (nunca se borra la fila)',
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conduces_numero (numero),
  KEY idx_conduces_cotizacion (cotizacion_id),
  KEY idx_conduces_date (date),
  KEY idx_conduces_activo (activo),
  CONSTRAINT conduces_cotizacion_fk FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conduce_items (
  id                      INT(11)       NOT NULL AUTO_INCREMENT,
  conduce_id              INT(11)       NOT NULL,
  product_id              <products.id type> NULL COMMENT 'NULL = linea libre',
  description             TEXT          NOT NULL,
  quantity                DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unidad_medida           VARCHAR(10)   NOT NULL DEFAULT '43',
  amount                  DECIMAL(18,4) NOT NULL DEFAULT 0.0000 COMMENT 'Precio interno (sin ITBIS) para facturar; nunca se imprime',
  indicador_facturacion   TINYINT       NOT NULL DEFAULT 1,
  indicador_bien_servicio TINYINT       NOT NULL DEFAULT 1,
  activo                  TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = linea reemplazada por una edicion',
  PRIMARY KEY (id),
  KEY idx_conduce_items_conduce (conduce_id, activo),
  KEY idx_conduce_items_product (product_id),
  CONSTRAINT conduce_items_conduce_fk FOREIGN KEY (conduce_id) REFERENCES conduces (id) ON DELETE RESTRICT,
  CONSTRAINT conduce_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conduce_secuencia (
  id      TINYINT       NOT NULL COMMENT 'Siempre 1: una sola fila',
  ultimo  INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Ultimo numero de conduce asignado',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO conduce_secuencia (id, ultimo) VALUES (1, 0);
```

- **Delete rules:**
  - `conduce_items.conduce_id` is `ON DELETE RESTRICT`. Conduces are never deleted, and the database enforces it.
  - `conduces.cotizacion_id` is `ON DELETE SET NULL`. Quotes are still hard-deleted, and their conduces
    then show "cotización eliminada".
  - `conduce_items.product_id` is `ON DELETE SET NULL`, as in `factura_items`.

### 3.3 Snapshot, checkers, verification script, docs

- **Snapshot (`db/tenant_schema.sql`):**
  - the three tables and the seed `INSERT` go right after the "2d) Cotizaciones" block, which already sits
    after products;
  - the index and FK names are the same as in 029;
  - the header range becomes `012..029`.
- **`tools/check_tenant_schema_orden.php`:**
  1. **Header check:** it takes the highest `NNN` from `glob($raiz . '/db/migrations/[0-9][0-9][0-9]_*.sql')`
     instead of a hard-coded range.
  2. **`$columnas`** gets the end state:
     - `conduces`: `numero INT UNSIGNED NOT NULL`, `code VARCHAR(20) NOT NULL`, `date DATETIME NOT NULL`,
       `cotizacion_id`/`client_id`/`user_id INT(11) NULL`, `client_name VARCHAR(100) NULL`,
       `activo TINYINT(1) NOT NULL DEFAULT 1`;
     - `conduce_items`: `conduce_id INT(11) NOT NULL`, `product_id INT(11) NULL`, `description TEXT NOT NULL`,
       `quantity DECIMAL(12,3) NOT NULL DEFAULT 1.000`, `unidad_medida VARCHAR(10) NOT NULL DEFAULT '43'`,
       `amount DECIMAL(18,4) NOT NULL DEFAULT 0.0000`, `activo TINYINT(1) NOT NULL DEFAULT 1`;
     - `conduce_secuencia`: `id TINYINT NOT NULL`, `ultimo INT UNSIGNED NOT NULL DEFAULT 0`.
  3. **`$indices`** gets every key above, plus the three CONSTRAINT lines exactly as in the DDL.
  4. **The 029 lint.** The "names present / PREPARE-EXECUTE-DEALLOCATE / dynamic DDL expands and balances"
     block also runs over 029:
     - `$ejemplo` gains `'@db' => 'tenant'`, the `int(11)` id types and the boolean guards;
     - the whitelist is ``^CREATE TABLE IF NOT EXISTS `tenant`\.(conduces|conduce_items|conduce_secuencia) \(``
       plus the guarded seed INSERT;
     - it adds 028's rules: the first statement is `SET @db := DATABASE()`, `DATABASE()` appears once, the
       only top-level SELECT is last, and the number of `information_schema` uses equals the number of
       `TABLE_SCHEMA = @db`.
- **`tools/check_estado_dgii_ancho.php`:** lines 166 and 168 stop hard-coding 028. They take the highest `NNN`
  from the same glob and check `012–NNN` in the README and `012..NNN` in the snapshot. It must stay 30/30.
- **`tools/verificar_migraciones_tenant.sql`:**
  - gets a row `029` / `029_conduces.sql` / "tablas conduces, conduce_items y conduce_secuencia" (all three
    present);
  - its header range becomes "012 a 029";
  - 029 is listed among the migrations that are safe to re-run.
- **Docs, same commit as the migration:**
  - `db/migrations/README.md`: "hasta la 029 (012–029)", and 029 added to the phpMyAdmin examples;
  - `docs/architecture.md:121` and `docs/database/schema.md:316`: `012–029`;
  - `docs/database/schema.md`: table docs for the three tables.
- **Other branch.** `feat/ecf-write-ahead` also edits `check_estado_dgii_ancho.php`, and its
  `test_write_ahead_gate.php` expects the verifier rows to say APLICADA. Whichever branch merges second rebases
  those lines and applies 029 to the write-ahead scratch databases.

## 4. Backend (api-gratex)

### 4.1 Endpoint `/api/conduces`

- **New files:** `src/Controllers/conduceController.php`, `src/Models/conduceModel.php`,
  `src/Utils/Cotizacion/FerreteriaConduce.php` (the rules, the PDF loading and the formato gate).
- **Routing:** `src/Router.php` gets `case 'conduces'`. The sub-paths `/{id}/pdf` and `/preview` are parsed
  in the controller, as `cotizacionController` does.
- **Permission:** `config/permissions.php` maps the route to the **existing `cotizaciones` module**:
  `'conduces' => 'cotizaciones'`. There is no new RBAC module.
- **Conventions copied from `cotizacionController`:** CORS headers, the body decoded once with
  `InputSanitizer::jsonInput(false)`, the `{status, data|error}` envelope, and `AuditLogger`.
- **Order of checks:**
  1. `$auth->validateRequest()` runs first (401 as today; OPTIONS skips both). That call resolves the tenant.
  2. Right after it succeeds, before reading the body or touching the DB, the controller calls
     `FerreteriaConduce::errorDisponibilidad(): ?string`, built on `CotizacionFormatos::delTenant()`. A
     non-null result answers **422** "Los conduces no están disponibles para tu empresa." This covers Gratex,
     an unknown formato and a single-tenant install.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/conduces?page&pageSize&query` | search by code, stored client name, client name, client RNC; active rows only | `{data:[row], pagination}`, ordered `date DESC, id DESC` |
| GET | `/api/conduces?id=N` | | `{data:[row]}` (`[]` if missing or inactive) |
| POST | `/api/conduces` | `{cotizacion_id, client_id, date?, items:[…]}` | `{id, code, numero}` |
| PUT | `/api/conduces` | `{id, client_id, date?, items:[…]}` | `{id, code, numero}` |
| DELETE | `/api/conduces` | `{id}` | `'Conduce eliminado'`; sets `activo = 0`, deletes nothing |
| GET | `/api/conduces/{id}/pdf[?format=base64]` | | `Conduce_CON-000001.pdf` (attachment or base64 JSON); 404 if missing or inactive |
| POST | `/api/conduces/preview` | the POST body, or the PUT body with `id` | base64 PDF |

**Row shape:**
- the `conduces` columns, plus `cotizacion_code` (the source quote's code, NULL if that quote was deleted);
- from the `clients` LEFT JOIN: `client_name`, `company_name`, `rnc`;
- **`client_name_guardado`**: the stored `conduces.client_name`, kept for when the client is hard-deleted;
- `items`: the **active** `conduce_items` (`activo = 1`), ordered by id. DECIMALs come back as strings, as in
  cotizaciones.

**Item input** (one per line):
```json
{ "product_id": 55, "description": "FUNDAS CEMENTO GRIS", "quantity": 2,
  "unidad_medida": "43", "amount": 935, "indicador_facturacion": 1, "indicador_bien_servicio": 1 }
```
`amount` and the two indicators are internal: the form sends them but never shows them.

**Audit.** CREATE, UPDATE and DELETE all log module `'conduces'`, entity_type `'conduce'` and entity_id = the
conduce id.
- CREATE: `new_values` is the body.
- UPDATE: `old_values` is the row before; `new_values` is the body.
- DELETE: `old_values` is the row.

### 4.2 Numbering (never reused)

`conduceModel::crear`, inside **one transaction**:
1. `INSERT IGNORE INTO conduce_secuencia (id, ultimo) VALUES (1, 0)`, so the row exists even if the seed
   failed.
2. `SELECT ultimo FROM conduce_secuencia WHERE id = 1 FOR UPDATE`. The row lock serializes concurrent
   creates, so no `GET_LOCK` is needed.
3. `numero = GREATEST(ultimo, COALESCE((SELECT MAX(numero) FROM conduces), 0)) + 1`, then
   `UPDATE conduce_secuencia SET ultimo = numero WHERE id = 1`. `code = 'CON-' . str_pad(numero, 6, '0', STR_PAD_LEFT)`.
4. Insert the header and the lines, then commit.

- Rows are never deleted, so a number, once given, is never reused.
- **Retry:** a **1062** on `uk_conduces_numero` (the safety net) rolls back and retries **once** in a new
  transaction. A second one answers 500 "Otro conduce se guardó al mismo tiempo. Vuelve a guardar."
- **Errors not retried:**
  - **1452** naming `conduce_items_product_fk`: 422 "Un producto del conduce ya no existe en el catálogo (lo
    eliminaron mientras lo editabas). Búscalo de nuevo o quita la línea."
  - **1452** naming `conduces_cotizacion_fk` (POST only): 422 "La cotización de origen ya no existe; vuelve a
    Cotizaciones."
  - Anything else: 500 with the generic message.
- **Edits** never change `numero`, `code` or `cotizacion_id`.

### 4.3 Rules

**Shared line rules (`FerreteriaFormato.php`, no behavior change for quotes):**
- **`normalizarLinea`** becomes
  `public static function normalizarLinea(mixed $item, int $n, callable $problemaCantidad, callable $unidadValida, bool $precioCeroValido = false)`.
  - Every check keeps its current order and text: description → unit → quantity → price → ITBIS → bien/servicio
    → product id.
  - With `true`, only the price check changes: 0 passes, still at most 4 decimals, and a negative price
    answers "Línea N: el precio no puede ser negativo."
  - A missing or non-numeric price keeps "El precio de la línea N no es válido. Revísalo."
- **`aplicarCatalogoLineas`.** The per-line part of `aplicarCatalogo` (the product exists, its "…ya no existe
  en el catálogo…" message, and `indicador_bien_servicio` taken from the catalog) moves to
  `public static function aplicarCatalogoLineas(array $items, array $productos): array|string`.
  `aplicarCatalogo` and `FerreteriaConduce` both call it. The conduce therefore takes bien/servicio from the
  catalog too, which decides `tipoItem` and inventory on Facturar.
- **`normalizarFecha`, `leerNumero` and `leerEntero`** become `public static`, unchanged.
- **Lookups:** `cotizacionModel::getCliente` and `::getProductosInfo` (public, read-only, the file is not
  modified).

**Conduce header and body rules (`FerreteriaConduce`):**
- `client_id` must exist: 422 "Elige un cliente para el conduce." This also applies on PUT when the stored
  client was deleted.
- At least one line: "Agrega al menos una línea al conduce."
- `date`: `Y-m-d` or `Y-m-d H:i:s`, otherwise "La fecha no es válida." A date-only value gets the current
  Santo Domingo time.
- An `ajustes` key: 422 "Los conduces no llevan cargos ni abonos."
- `formato` and `tipo` keys are ignored.

**POST:**
- `cotizacion_id` is required. It must exist with `formato = 'ferreteria'`; otherwise 422 "Elige una
  cotización de Ferretería para crear el conduce."
- A missing date means now.

**PUT:**
- A missing or inactive row answers 404 "Este conduce ya no existe. Puede que lo hayan eliminado; vuelve al
  listado."
- `cotizacion_id` in the body is ignored.
- A missing or empty `date` keeps the stored date and time (`date = COALESCE(:date, date)`, as quotes do).
- In one transaction, the previous active lines get `activo = 0` and the new lines are inserted. Nothing is
  deleted.

**DELETE:**
- `UPDATE conduces SET activo = 0, updated_at = now WHERE id = ? AND activo = 1`.
- 0 affected rows answers 404 "Este conduce ya no existe…".
- The lines are left as they are, still linked to the inactive conduce.

**`client_name`** is stored on create and update with the chain the quote uses (`razon_social`, else
`company_name`, else `client_name`), trimmed and cut to 100 characters.

### 4.4 PDF: conduce mode of `FerreteriaCotizacionPdf`

The renderer stays **pure**: no Database, TenantResolver, BrandingResolver or unidadMedidaModel calls.

**Conduce-mode input:**
- `documento => 'conduce'`;
- `code` (`?string`; null prints `VISTA PREVIA`);
- `date`;
- `cotizacion_code` (`?string`; null leaves out the Cotización line);
- `items: [{description, quantity, unidad}]`, where `unidad` is **already the resolved name**;
- no `totales`.

The emisor, client and logo arguments are the same as for quotes.

**What `FerreteriaConduce::pdf/preview` passes in:**
- **Unit names:** it builds an `[id => descripcion]` map **once** from `(new unidadMedidaModel())->all()`. An
  inactive, unknown or unreadable unit prints its stored code. It never calls `descripcion()` per line.
- **The emisor:** `EmisorConfigModel::get()`.
- **The client:** if the client was deleted, the name comes from `client_name_guardado` and the RNC line is
  left out (the renderer already skips an empty RNC).
- **The logo:** `BrandingResolver::logoPath()`.
- **`cotizacion_code`:**
  - `pdf()` takes it from the row's JOIN;
  - `preview()` with an `id` uses that row (it must be active) and ignores the body's `cotizacion_id`;
  - `preview()` without an `id` validates the body's `cotizacion_id` as POST does, and reads that quote's code.
- **Preview date:** the body's date, else the stored date, else now.

**Layout in conduce mode:**
- **Title:** `CONDUCE DE MERCANCÍA`.
- **Left block:** the long date, the code, `Cotización: COT-000012` (when known), `NOMBRE O RAZÓN SOCIAL`,
  the client name and the RNC.
- **Columns:**
  - widths: Cantidad 24 mm (`ANCHO_CANTIDAD`), Unidad 30 mm (new `ANCHO_UNIDAD`), Descripción the rest;
  - alignment: C, C, L;
  - headers: `Cantidad`, `Unidad`, `Descripción mercancías`;
  - Unidad and Descripción wrap, and `renglones()` sets the row height.
- **Marker row:** `['', '', MARCA]`, so the text sits under Descripción.
- **No totals:** `filasTotales()` is skipped, and the closing block is `ESPACIO_TOTALES` + "Recibido por" +
  footer, never split.
- **Unchanged:** logo, address, RNC, fonts, blue bands, page breaks, the repeated header and
  "Página X de Y".

**Quote mode:** every code path is today's. The test in section 6 proves it.

### 4.5 What changes and what doesn't

- **Not modified:**
  - `cotizacionController.php`, `cotizacionModel.php`, `CotizacionPdfGenerator.php`, `GratexFormato.php`;
  - the `cotizaciones` and `cotizacion_items` tables.
- **`FerreteriaFormato.php`:** only the extractions in 4.3 (`normalizarLinea` public with its parameter,
  `aplicarCatalogoLineas`, and three helpers made public). Every quote message is byte-identical, and the quote
  harness stays green.
- **`FerreteriaCotizacionPdf.php`:** only the conduce branch in 4.4.

## 5. Frontend (fiscalo)

### 5.1 Navigation

**Views:**
- `ViewId` gains `'conduces'` (the list) and `'conduce-editar'` (the form).
- `SUBVISTA_DE['conduce-editar'] = 'conduces'`.
- `TITLES`: `conduces: 'Conduces'`, `'conduce-editar': 'Conduce'`.

**Payloads** (they join `NavPayload`, with guards `isConduceRef` and `isConduceDesdeCotizacion`):
- `ConduceRef { kind: 'conduce'; id: number }`;
- `ConduceDesdeCotizacion { kind: 'conduce-desde-cotizacion'; cotizacionId: number }`.

**`App.tsx`:**
- `VIEW_SIN_PAYLOAD['conduce-editar'] = 'conduces'`, so a reload, or a Back with a lost payload, goes to the
  list.
- `renderView` case `'conduce-editar'` renders
  ``<ConduceEditor key={ref ? `c-${ref.id}` : `q-${desde.cotizacionId}`} … />``.
- With neither payload, it renders nothing and calls `nav('conduces', null, { replace: true })`.

**`useHistoryNav.mismoDestino`** treats two `ConduceRef` with the same `id`, or two `ConduceDesdeCotizacion`
with the same `cotizacionId`, as the same destination.

**NAV item:** `{ id: 'conduces', label: 'Conduces', icon: 'truck', module: 'cotizaciones', formato: 'ferreteria' }`,
right after Cotizaciones (`'truck'` is already an `IconName` in `Icon.tsx`).

**The formato gate:**
- `NavItem.formato?: FormatoId` is new. A gated item shows only when the tenant's formato equals it.
- **`useFormatoTenant(): FormatoId | null`** is a new hook. It returns the formato only once branding has
  resolved: from its data, or `'gratex'` on the single-tenant 409. It returns **null** while loading or after a
  branding error.
  - It observes `['branding']` with `staleTime: Infinity` and `refetchOnWindowFocus: false`. Those options are
    added to `useApiQuery`.
  - Its options never cause a refetch on focus. The forms keep their own observers and freshness, and
    `BrandingSection` already invalidates `['branding']` after a change.
- **The new signatures:**
  - `puedeVerItem(user, it, formato?: FormatoId | null)`: a gated item is visible only when `formato === it.formato`,
    so null hides it.
  - `puedeVerVista(user, view, formato?)` resolves the gate through `SUBVISTA_DE` with a new
    `navFormatoFor(view)`, as `navModuleFor` does.
  - Existing callers that pass no formato behave exactly as today for every ungated item.
- **Where it is read:** once, in `AppShell`. It is passed to Sidebar and SearchPalette as a prop, and used by the
  App guard.
- **The App guard:**
  - It does **not** redirect a gated view while the formato is null (loading or branding error).
  - It redirects (`replace`, `forzar`) only when the formato is **known** and differs.
  - The module and admin rules apply immediately, as today.
  - The formato value joins the effect's dependencies.
- **`ConducesView` and `ConduceEditor`:**
  - They show `LoadingState` until the formato is known and equals `'ferreteria'`.
  - On a branding error they show `ErrorState`, with a retry that refetches `['branding']`.
  - They make no `/api/conduces` call before that: the queryFn returns `Promise.resolve(null)` until then,
    the existing pattern.
  - So a Gratex login over a saved `fiscalo.view = 'conduces'` goes to the dashboard without a 422.
- **Accepted cost:** one more `GET /api/branding` on app load for every tenant, Gratex included, and none on
  focus.

### 5.2 API layer

**`src/api/conduces.ts`:** `listConduces`, `getConduce`, `createConduce`, `updateConduce`, `deleteConduce`,
`getConducePdf`, `previewConduce`.

**Types in `src/api/types.ts`:**
- `ConduceRow` and `ConduceItemRow`: DECIMALs as `string | number`, and `client_name_guardado`.
- `ConduceInput`: `{ cotizacion_id?: number; client_id: number; date?: string; items: ConduceItemInput[] }`.
- `ConduceItemInput`: `product_id`, `description`, `quantity`, `unidad_medida`, `amount`,
  `indicador_facturacion`, `indicador_bien_servicio`.

**Display name, everywhere:** `client_name || client_name_guardado`. That covers the list's Cliente column, the
form's provisional client, and `clienteNombre` in both prefills.

**Cache:**
- keys `['conduces', 'list', …]` and `['conduces', 'detail', id]`;
- the conduce form invalidates `['conduces']` after create, update and delete;
- deleting a quote in the Ferretería quote form also invalidates `['conduces']`. That's one line, with no
  visible change to the quote.

### 5.3 Cotizaciones page

Unchanged, except for one button on quote rows.
- **When it shows:** when `formatoDeFila(c) === 'ferreteria'` **and** the tenant formato is known and equals
  `'ferreteria'`.
- **Where:** between PDF and Facturar ▾, outside the `puedeEcf || puedeSimple` condition, so a role without a
  factura module still sees it.
- **What it does:** `nav('conduce-editar', { kind: 'conduce-desde-cotizacion', cotizacionId: c.id })`.
- **Column width:** the Ferretería actions column widens from 210 px to fit three buttons, checked at mobile
  width. Gratex keeps its width and gets no button.

### 5.4 Conduces page (`src/features/conduces/ConducesView.tsx`)

- **Columns:** Número | Cliente | Fecha | Cotización.
  - Cliente uses the display name.
  - Cotización shows `cotizacion_code`, or "eliminada" when it is NULL.
- **Search and paging:** like `CotizacionesView`, over active conduces only.
- **Row actions:**
  - PDF;
  - **Facturar ▾**: "Factura electrónica (e-CF)" / "Factura simple", each gated by `puedeVerVista(…)` as on
    quotes;
  - clicking the row opens `nav('conduce-editar', { kind: 'conduce', id })`.
- There is **no "Nuevo" button**.
- **Empty state:** "Todavía no hay conduces. Crea uno desde una cotización con el botón Conduce."

### 5.5 Conduce form (`src/features/conduces/ConduceEditor.tsx` + `ConduceForm.tsx`)

**Reuse:**
- **Already shared, used as they are:** `ClientCombobox`, `NombreClienteLibre`, `NewClientModal`,
  `ProductoCombobox`, `UnidadMedidaSelect`/`useUnidadesMedida`/`problemaCantidad`, `useAvisoSalida`,
  `useAccionUnica`.
- **Moved out of `FerreteriaCotizacionForm.tsx`** into `src/features/cotizaciones/formatos/ferreteria/`, with no
  behavior change for the quote form:
  - `DescripcionLinea` → `DescripcionLinea.tsx`;
  - `lineaLibre`, `siguienteId`, `indicadorDe`, `lineasDeFila` (typed on the item columns shared with
    `conduce_items`), `clienteDeFila`, `formatearRnc`, and the Producto → line mapping of `addProducto` →
    `lineas.ts`;
  - the client block (combobox + free name + new-client modal + RNC caption + error) → `BloqueCliente.tsx`.

**`ConduceEditor` (loading):**
- **From a quote** (`ConduceDesdeCotizacion`): it loads the quote with `['cotizaciones', 'detail', cotizacionId]`,
  the cache shared with `CotizacionEditor`.
  - Loading: `LoadingState`.
  - Error: `ErrorState` with retry.
  - A null row: `EmptyState` "Esta cotización ya no existe", with a button to Cotizaciones (`replace`).
  - A row whose `formatoDeFila(row) !== 'ferreteria'`: `EmptyState` "Solo las cotizaciones de Ferretería
    generan conduces."
  - Otherwise it pre-fills client, date (today) and lines via `lineasDeFila`, including the internal `amount`
    and indicators.
  - If the quote has cargos (`avisosCargos(row)` is not empty), a notice says: "La cotización COT-… tenía cargos
    adicionales (…): no pasan al conduce ni a la factura que salga de él."
- **Existing** (`ConduceRef`): `getConduce` with `['conduces', 'detail', id]`, with the same states.
  - Missing or inactive: "Este conduce ya no existe", with a button to Conduces.
- **Missing client:** when the client is gone (`client_id` null, or `getClient` answers 404), the form opens
  with the lines and no client, and says "El cliente ya no existe: elige otro." This applies in both modes.

**`ConduceForm` (the paper look):**
- **Header:**
  - the logo and emisor;
  - **"Conduce de mercancía"**;
  - the number (`CON-…`, or "Se asigna al guardar");
  - "Desde la cotización COT-000012" (or "de una cotización eliminada").
- **Grid:** a new class **`fx-grid-conduce`**: gutter | Cant. | Unidad | Descripción. It stacks on mobile with
  the same `data-label` pattern as `fx-grid-cot-fer`.
  - There are no Precio, ITBIS or Valor total columns, no totals panel, and no "Cargos y abonos".
  - A catalog product stores its sale price and indicators internally.
  - "Línea libre" stores `amount 0`, indicator 1, unit 43, Bien.
- **Editing:** client and date are editable.
  - **Date rules** (the quote form's): create sends the full datetime; edit sends the date only when the day
    changed, and the server keeps the stored one otherwise.
- **Actions:**
  - Vista previa (with `id` when editing);
  - Guardar (POST, or PUT when editing);
  - **Eliminar**, with the inline confirmation "El conduce dejará de verse en la lista. Su número CON-… no se
    vuelve a usar.";
  - the leave-without-saving warning.

  After saving or deleting, the user goes back to the Conduces list, with a toast.
- **Validation:** a Zod schema with the quote form's per-line messages, and the conduce header messages
  (client required, at least one line).

### 5.6 Facturar from a conduce

**`src/features/conduces/conversion.ts`:**
- `conduceAFacturaPrefill(c): FacturaPrefill`: `precioConItbis: false`; lines with `prodId`, `unidadMedida`,
  `indFact`, `tipoItem`.
- `conduceAFacturaSimplePrefill(c): FacturaSimplePrefill`: the price folds in ITBIS, as for Ferretería quotes.

Both set `origen` to the conduce code, `clienteNombre` to the display name, and a new optional
**`origenTipo: 'conduce'`** (added to both prefill types).

**Texts when `origenTipo === 'conduce'`.** Without `origenTipo`, every string stays as it is today.
- **e-CF banner:** "Convertida desde el conduce ${origen} · los precios no incluyen ITBIS (se suma encima)".
- **Factura simple banner:** "Convertida desde el conduce ${origen} · cada precio ya incluye su ITBIS".
- **Client discount notice:** "Se aplicó el descuento fijo del cliente (N%) a los precios del conduce." There
  is no comparison to a total, because a conduce has none.
- **No cargos aviso.**

**0-price lines** (ruling: a guard, not just a warning):
- Today neither factura form nor the backend rejects a 0 price:
  - `factura.schema.ts:27` is `nonnegative`;
  - `SimpleInvoiceFormView` `esValida` ignores the price;
  - neither controller has a price rule;
  - and the DGII rejects `MontoItem` 0 **after** the e-NCF is reserved.
- So with `origenTipo === 'conduce`:
  - **e-CF:** `InvoiceFormView.validateForm` puts the error "Escribe el precio: en el conduce esta línea no
    tenía." on every line with price 0, and blocks Emitir.
  - **Factura simple:** `SimpleInvoiceFormView` does the same on Guardar.
  - The aviso "N línea(s) del conduce no tienen precio: escríbelo antes de emitir." is also shown.
- Without `origenTipo`, Gratex and the quote conversions behave exactly as today.

### 5.7 Audit log

- `features/audit/etiquetas.ts` `MODULOS` gains `conduces: 'Conduces'`.
- `features/audit/entidad.ts` `destinoEntidad` gains: `entity_type === 'conduce'` with a numeric id gives
  "Abrir conduce" → `nav('conduce-editar', { kind: 'conduce', id })`. DELETE entries offer nothing, as today.

## 6. Testing

### Backend
New sections in `tools/test_cotizacion_ferreteria.php`, or a new `tools/test_conduces.php` with the same assert
helpers.

- **Numbering:** its own fake connection that reacts to `INSERT INTO conduces`, `uk_conduces_numero` and the
  `conduce_secuencia` `SELECT … FOR UPDATE`. It checks:
  - `CON-000001` comes from the sequence;
  - after a soft delete, the next number does **not** reuse it;
  - a 1062 is retried once, and a second one gives the 500;
  - a 1452 maps to its 422;
  - `conduceModel` gets the fake through `ReflectionProperty('conduceModel', 'conexion')`.
- **Gate:** `errorDisponibilidad()` with Task 6's TenantResolver-reflection pattern: no tenant, gratex,
  ferreteria, and an unknown formato.
- **Rules:**
  - price 0 is allowed;
  - a negative price gives "no puede ser negativo";
  - `ajustes` is rejected;
  - `cotizacion_id` is required and must be on the ferreteria formato;
  - the client must exist on PUT;
  - a PUT without date keeps the stored one;
  - bien/servicio comes from the catalog.
- **Quote regression:**
  - every existing `validarForma`/`aplicarCatalogo` case returns a byte-identical message;
  - a line with an invalid price and an invalid ITBIS still reports the price first;
  - every existing quote fixture renders the same page text after the renderer change;
  - the existing sections stay green.
- **PDF:**
  - a conduce render contains `CONDUCE DE MERCANCÍA`, `Unidad` and `Cotización: COT-`;
  - it contains **none** of `Valor Unitario`, `Sub-total` or `TOTAL`;
  - the marker sits in the Descripción column;
  - a 60-line conduce paginates with the header repeated and "Página X de Y";
  - unit names are passed in already resolved;
  - samples go to `tools/out/` for a visual check.
- **Checkers:** `php tools/check_tenant_schema_orden.php` passes, including the 029 lint, and
  `php tools/check_estado_dgii_ancho.php` stays 30/30.
- **`php -l`** on every touched file.
- **Manual server checks** (`tests/test_conduces.http`):
  - create, list, edit (old lines become `activo = 0`), PDF, delete (`activo = 0`, the number is not reused);
  - the 401 before the 422 with an expired token;
  - the 422 cases;
  - five parallel creates giving distinct numbers;
  - Gratex unchanged.

### Frontend
- **Node scripts:**
  - the conduce → factura and factura-simple mapping (prices, indicators, `origenTipo`, the display name);
  - the conduce schema;
  - `useFormatoTenant`'s three states, if the pure part is factored out;
  - the existing scripts stay green: `parity-cotizacion-ferreteria.ts`, `test-conversion-ferreteria.ts`,
    `test-schema-cotizacion-ferreteria.ts`.
- **Gates:** `npm run typecheck`, `npx eslint src scripts`, `npm run build`.
- **Browser checks against the local mock only:**
  - the menu entry appears only for `ferreteria`;
  - a reload on Conduces stays on Conduces;
  - a Gratex login over a saved `conduces` view goes to the dashboard without the 422;
  - Conduce from a quote, including the cargos notice and the deleted-client notice;
  - edit, save, the list, PDF, delete (the confirmation text);
  - Facturar e-CF and simple: banners, discount text, and a 0-price line that **cannot** be issued or saved;
  - a quote prefill still behaves as today;
  - Gratex shows no change;
  - mobile layout (the three-button actions column, `fx-grid-conduce`).

## 7. Rollout

1. **Take a backup**, then run **029** in `smhynzte_002` (Ferretería) and `smhynzte_new_gratexdb` (Gratex).
   Paste the whole file in the database's SQL tab, then read the final SELECT: `base` = that database, the
   three tables present, the engines InnoDB, the sequence row `(1, 0)`.
2. **Re-run `tools/verificar_migraciones_tenant.sql`** in both databases. **027, 028 and 029 must all say
   APLICADA** before step 3, because this deploy also ships the code that needs 027 and 028, which is already
   on master. If one says FALTA, run it first, following the ORDEN note in its header.
3. **Deploy** api-gratex, then fiscalo.
4. **Smoke test as Ferretería:**
   - a conduce from a quote, its PDF, an edit, a delete (it disappears from the list);
   - Facturar without issuing, checking that the 0-price block works.

   As Gratex: nothing changed, and there is no menu entry.

No setting is needed: Ferretería already has `cotizacion_formato = 'ferreteria'`.

## 8. Out of scope

- Tracking delivered versus pending quantities.
- Merging several conduces into one factura.
- A conduce created from scratch.
- Conduce → cotización.
- Marking a conduce as "facturado", or linking the factura back to it.
- A separate RBAC permission for conduces.
- Conduces for Gratex or other formatos.
- Soft delete for quotes. Quotes keep their current delete (user decision, 2026-10-06).
- Restoring an inactive conduce from the UI. The row stays in the database, and support can set
  `activo = 1` by SQL.

## 9. Notes from planning (2026-10-07; they supersede earlier text)

- **Numbering (4.2).** The seed `INSERT IGNORE` into `conduce_secuencia` runs **right before** the transaction,
  not inside it. Inside the transaction, its shared lock on the existing row deadlocked parallel creates. On the
  real MySQL server (Task 6b), 4 of 5 parallel workers failed that way. The rest of 4.2 is unchanged: `FOR UPDATE`,
  `GREATEST(ultimo, MAX(numero)) + 1`, and one retry on a 1062.
- **029 lint (3.3).**
  - `information_schema.REFERENTIAL_CONSTRAINTS` has no `TABLE_SCHEMA` column, so its filter is
    `CONSTRAINT_SCHEMA = @db`. The rule counts either filter.
  - The dynamic-SQL whitelist also allows a guarded read of the sequence row into `@fila_secuencia`, because the
    final SELECT can't name a table that might not exist.
  - Each prepared statement has a unique name.
- **Id types (3.1, 7).** On MySQL 8.0.19+ (production is 8.0.46), `COLUMN_TYPE` prints `int`, not `int(11)`.
  The rollout docs say so.
- **Endpoint edges (4.1).**
  - PUT/DELETE without `id` answer 422 with a specific text.
  - An unknown sub-path or method answers 404 "Esta dirección de conduces no existe."
  - Read failures answer a generic 500.
- **Client block (5.5).** `NewClientModal` is rendered by each form **outside** `.fx-sheet`, because inside it
  would be clipped (overflow plus a transform). The shared client block takes callbacks to open it.
- **`useFormatoTenant` (5.1)** returns `{ formato, error, reintentar }`; `formato` is null while loading or after
  an error.
- **0-price block (5.6).** On the e-CF it also blocks Vista previa, because the block lives in `validateForm`. On
  factura simple it blocks only Guardar.
- **Screen texts (5.5).** The texts the spec didn't fix are chosen in Task 12 and checked verbatim in Task 14:
  the eyebrow, the branding-error title, the no-RNC caption, and "De una cotización eliminada".
- **Smoke test (7.4).** A real conduce created in production uses up a number. Task 7 documents a preview-only
  alternative, so the first real conduce can still be `CON-000001`.
- **Node test of `useFormatoTenant` (6).** It was not factored out; Task 14's browser checks cover the loading,
  error, 409 and Gratex states.
- **Rollout order (7), refined (final review, 2026-10-08).** Backup; the verifier (read-only) in both DBs; 027 then 028 wherever they say FALTA; 029 and its final row; the verifier again (027, 028 and 029 all APLICADA); then deploy and smoke tests. It follows 029's own ORDEN (after 028, before the code) and replaces the order of steps 1 and 2 in section 7, which ran 029 before the check for 027 and 028.
- **Migration renumbered 029 -> 031 (at merge time, 2026-10-08).** `origin/master` already carries
  `029_precios_4_decimales.sql` (`products.precio` .. `precio_4` become `DECIMAL(18,4)`) and `030_pos.sql` (the POS
  tables and four `facturas` columns). Both are pushed and may already be applied somewhere, so they keep their
  numbers and content, and the conduces migration became `031_conduces.sql` (029 = precios_4_decimales and
  030 = POS on master; an earlier merge-time step had made it 030 until the POS migration took that number).
  Every "029" for the conduces migration in this spec (the file name, "029 lint", the data-model sections, the
  header range `012..029`, the verifier row, the rollout steps) now means 031.
  In the rollout order, "027 then 028 wherever they say FALTA" now also covers `029_precios_4_decimales.sql` and
  `030_pos.sql`, before 031 runs; the final verifier check is 027 to 031 all APLICADA.

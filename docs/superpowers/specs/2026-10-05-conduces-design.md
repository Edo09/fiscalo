# Conduces de mercancía (Ferretería) — design

- **Date:** 2026-10-05
- **Repos:** `fiscalo` (React frontend) and `api-gratex` (PHP backend), branch `feat/conduces` in both.
- **Builds on:**
  - the per-tenant cotización formats (`docs/superpowers/specs/2026-10-01-cotizacion-formatos-design.md`);
  - in production: master 011 and tenant 026 and 027, run on both tenant databases. Tenant 028
    (`estado_dgii` width) is on master too and must be run on both databases before this deploy (section 7).
- **Status:** design approved in chat, section by section. This spec is pending the user's review.

## 1. Goal

Ferretería (tenant on the `ferreteria` cotización formato) needs a **conduce de mercancía**: a delivery note
that goes with the goods and that the customer signs ("Recibido por"). It looks exactly like their cotización
but shows **no prices**.

### Document flows (as decided by the user)

```
Cotización ──► Conduce          (new: "Conduce" button on a quote)
Cotización ──► Factura (e-CF / factura simple)   (exists today)
Conduce    ──► Factura (e-CF / factura simple)   (new)
```

Two directions are **not** supported: conduce → cotización, and a conduce created from scratch.

### Success criteria

- **From a quote:**
  - On a Ferretería quote, "Conduce" opens a conduce form pre-filled with the quote's client and lines.
  - The user can edit the conduce before saving: remove lines, change quantities or descriptions, add
    products or free lines, change the client or the date.
  - On save it gets its own number, `CON-000001`, linked to its quote.
  - A quote can produce any number of conduces.
- **The Conduces page:** it has its own sidebar entry, visible only for tenants on the `ferreteria` formato.
  The page lists the conduces and offers PDF, edit and Facturar ▾.
- **The conduce PDF:**
  - It has the cotización's look, titled **CONDUCE DE MERCANCÍA**.
  - Columns: **Cantidad | Unidad | Descripción**.
  - It shows no prices and no totals.
  - It has "Recibido por" and the footer.
  - It references its source quote.
- **Facturar from a conduce** pre-fills the e-CF or factura-simple form with the conduce's lines, using each
  line's internal price, ITBIS rate, product and unit. Issuing that factura moves inventory as usual.
- **Gratex does not change.** No menu entry, no button, no different response from any endpoint it uses.
  `cotizaciones` and `cotizacion_items` are not modified.

## 2. Decisions taken (brainstorming Q&A)

| Topic | Decision |
|---|---|
| Storage | **New tables** `conduces` and `conduce_items`; the cotización tables are not touched. |
| What a conduce is | A saved document with its own number (`CON-000001`), linked to its source quote. |
| Created from | Only from a quote ("Conduce" button). There is no new conduce from scratch. |
| Editing | An editable copy: lines, quantities, descriptions, client and date can change before saving and later. |
| Conduces per quote | Many, one per delivery. Delivered versus pending quantities are not tracked. |
| Converts to | Factura only (e-CF or factura simple). Never to a quote. |
| Where | Its **own page** with its **own sidebar entry** under Cotizaciones, under the same `cotizaciones` permission, visible only for the `ferreteria` formato. |
| Prices | Never shown or printed on a conduce. Each line keeps them internally for Facturar. |
| Formato | Only `ferreteria`. Gratex never sees conduces. |
| Number reuse | Same as quotes: deleting the most recent conduce frees its number (pending user confirmation). |

## 3. Data model: tenant migration `029_conduces.sql`

The migration is idempotent and guarded with `information_schema`, following 026. It runs on **each** tenant
database after 028; it does not depend on 027 or 028. It **only creates tables**, so it is safe with the code
running in production today. 027 and 028 already exist on master, so 029 is the next free number.

**Read-only step 0** (as in 026):
- `ENGINE` of `cotizaciones` and `products` must be InnoDB.
- The exact `COLUMN_TYPE` of `cotizaciones.id` and `products.id`: the FK columns copy them, signedness included.

```sql
CREATE TABLE IF NOT EXISTS conduces (
  id             INT(11)       NOT NULL AUTO_INCREMENT,
  numero         INT UNSIGNED  NOT NULL,
  code           VARCHAR(20)   NOT NULL COMMENT 'CON-000001',
  date           DATETIME      NOT NULL,
  cotizacion_id  <cotizaciones.id type> NULL COMMENT 'Cotizacion de origen; NULL si se elimino',
  client_id      INT(11)       NULL,
  client_name    VARCHAR(100)  NULL,
  user_id        INT(11)       NULL COMMENT 'master users.id (sin FK cross-DB)',
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conduces_numero (numero),
  KEY idx_conduces_cotizacion (cotizacion_id),
  KEY idx_conduces_date (date),
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
  PRIMARY KEY (id),
  KEY idx_conduce_items_conduce (conduce_id),
  KEY idx_conduce_items_product (product_id),
  CONSTRAINT conduce_items_conduce_fk FOREIGN KEY (conduce_id) REFERENCES conduces (id) ON DELETE CASCADE,
  CONSTRAINT conduce_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- **Building the DDL.** The migration reads the `<… type>` placeholders from `information_schema` and builds
  both CREATE statements dynamically (`PREPARE/EXECUTE`), as 026 does.
- **Snapshot (`db/tenant_schema.sql`):** gets both tables right after the "2d) Cotizaciones" block, which
  already sits after products. It uses the same index and FK names, and the header range becomes 012..029.
- **Checker (`tools/check_tenant_schema_orden.php`):**
  1. The header check takes the highest `NNN` from `glob('db/migrations/[0-9][0-9][0-9]_*.sql')` instead of a
     hard-coded range, so the next migration doesn't break it.
  2. `$columnas` gets the end state of both tables:
     - `conduces`: `numero INT UNSIGNED NOT NULL`, `code VARCHAR(20) NOT NULL`, `date DATETIME NOT NULL`,
       `cotizacion_id`/`client_id`/`user_id INT(11) NULL`, `client_name VARCHAR(100) NULL`;
     - `conduce_items`: `conduce_id INT(11) NOT NULL`, `product_id INT(11) NULL`, `description TEXT NOT NULL`,
       `quantity DECIMAL(12,3) NOT NULL DEFAULT 1.000`, `unidad_medida VARCHAR(10) NOT NULL DEFAULT '43'`,
       `amount DECIMAL(18,4) NOT NULL DEFAULT 0.0000`.
  3. `$indices` gets `uk_conduces_numero`, `idx_conduces_cotizacion`, `idx_conduces_date`,
     `idx_conduce_items_conduce`, `idx_conduce_items_product`, plus the three CONSTRAINT lines exactly as in the
     DDL.
  4. The "names present / PREPARE-EXECUTE-DEALLOCATE / dynamic DDL expands and balances" block also runs over
     029:
     - the whitelist is `^CREATE TABLE IF NOT EXISTS (conduces|conduce_items) \(`;
     - it reuses the example types (`int(11)`);
     - 029 must use the `SET @sql_x := IF(@has_tabla = 0, CONCAT(...), 'DO 0');` form the checker parses.
- **Docs:** `docs/database/schema.md`, and `db/migrations/README.md` (range "hasta la 029 (012–029)").
- **Verification script:** `tools/verificar_migraciones_tenant.sql` gets a row for 029 (`029_conduces.sql`), with its header range moved to 012 a 029 and 029 listed among the ones safe to re-run: tables `conduces` and
  `conduce_items`.

## 4. Backend (api-gratex)

### 4.1 Endpoint `/api/conduces`

- **New files:** `src/Controllers/conduceController.php`, `src/Models/conduceModel.php`, and
  `src/Utils/Cotizacion/FerreteriaConduce.php` (rules, see 4.3).
- **Routing:** `src/Router.php` gets `case 'conduces'`.
- **Permission:** `config/permissions.php` maps the route to the **existing `cotizaciones` module**:
  `'conduces' => 'cotizaciones'`. There is no new RBAC module.
- **Tenant check:** the controller follows `cotizacionController`'s conventions (CORS headers,
  `AuthMiddleware`, the `{status, data|error}` envelope, `AuditLogger` on every change). As its first check it
  requires `CotizacionFormatos::delTenant() === 'ferreteria'`. Any other tenant gets **422** "Los conduces no
  están disponibles para tu empresa.", including Gratex and a single-tenant install.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/conduces?page&pageSize&query` | search by code, client name, client RNC | `{data:[row], pagination}`, ordered `date DESC, id DESC` |
| GET | `/api/conduces?id=N` | | `{data:[row]}` (`[]` if missing) |
| POST | `/api/conduces` | `{cotizacion_id, client_id, date?, items:[…]}` | `{id, code, numero}` |
| PUT | `/api/conduces` | `{id, client_id, date?, items:[…]}` | `{id, code, numero}` |
| DELETE | `/api/conduces` | `{id}` | `'Conduce eliminado'` |
| GET | `/api/conduces/{id}/pdf[?format=base64]` | | PDF `Conduce_CON-000001.pdf` (attachment or base64 JSON) |
| POST | `/api/conduces/preview` | same body as POST (or PUT with `id`) | base64 PDF; the code prints as `VISTA PREVIA` without an id |

**Row shape.** Each row carries:
- the `conduces` columns;
- `cotizacion_code`, the source quote's code (NULL if that quote was deleted);
- `client_name`, `company_name` and `rnc` from `clients` (LEFT JOIN), and `client_name_guardado`, the stored
  `conduces.client_name`, so a hard-deleted client still prints;
- `items`: all `conduce_items` columns, ordered by id. DECIMALs come back as strings, as in cotizaciones.

**Item input** (one per line):
```json
{ "product_id": 55, "description": "FUNDAS CEMENTO GRIS", "quantity": 2,
  "unidad_medida": "43", "amount": 935, "indicador_facturacion": 1, "indicador_bien_servicio": 1 }
```
`amount`, `indicador_facturacion` and `indicador_bien_servicio` are internal fields: the form sends them but
never shows them.

### 4.2 Numbering

`conduceModel::crear` follows the same steps as `crearConFormato`:
1. `GET_LOCK(CONCAT(DATABASE(), ':conduce_seq'), 5)`, using private lock helpers.
2. Begin the transaction.
3. `numero = COALESCE(MAX(numero), 0) + 1 FROM conduces` and `code = 'CON-' . str_pad(numero, 6, '0', STR_PAD_LEFT)`.
4. Insert the header and the lines, then commit.
5. In `finally`, release the lock.

- **Retry:** if the insert fails with a 1062 on `uk_conduces_numero`, retry **once** in a new transaction.
  Any other error is not retried. A second 1062 answers 500 "Otro conduce se guardó al mismo tiempo. Vuelve a
  guardar."
- **Other insert errors, not retried:**
  - **1452** naming `conduce_items_product_fk`: 422 "Un producto del conduce ya no existe en el catálogo (lo
    eliminaron mientras lo editabas). Búscalo de nuevo o quita la línea."
  - **1452** naming `conduces_cotizacion_fk` (POST only): 422 "La cotización de origen ya no existe; vuelve a
    Cotizaciones."
  - anything else: 500 with the generic message.
- **Number reuse:** as with quotes, numbering is `MAX(numero)+1`. Deleting the **most recent** conduce frees its
  number, and the next one reuses it. The delete confirmation says so: "Si es el último conduce, su número
  CON-… se volverá a usar." (Decision to confirm with the user, see section 2.)
- **Edits** never change `numero`, `code` or `cotizacion_id`.

### 4.3 Rules (`FerreteriaConduce`, pure static plus DB checks)

- **Shared line rules.** The per-line rules of `FerreteriaFormato::validarForma` are extracted into a shared
  static that the conduce reuses:
  - `limpiarDescripcion`, not empty, at most 1000 characters;
  - quantity > 0 and allowed by the unit (`problemaCantidad` with the normalized unit);
  - `product_id`, when given, must exist;
  - the unit must be valid;
  - `indicador_facturacion` 1–4, `indicador_bien_servicio` 1–2.

  The quote's behavior and messages stay identical.
- **Where the conduce differs from a quote:**
  - **`amount` ≥ 0**, with at most 4 decimals. **0 is allowed** for a free line added in the conduce, which
    has no price.
  - There are no `ajustes`. The key is rejected with 422 if sent.
  - `formato`/`tipo` keys are ignored: the endpoint itself is the document type.
- **POST:**
  - `cotizacion_id` is required. It must exist in `cotizaciones` with `formato = 'ferreteria'`. Otherwise 422
    "Elige una cotización de Ferretería para crear el conduce."
  - `client_id` must exist (422 "Elige un cliente para el conduce.").
  - `date` follows the same rules as quotes: `Y-m-d` or `Y-m-d H:i:s`, with a date-only value getting the
    current Santo Domingo time; missing means now.
  - There must be at least one line.
- **PUT:**
  - A missing row answers 404 "Este conduce ya no existe. Puede que lo hayan eliminado; vuelve al listado."
  - `cotizacion_id` in the body is ignored, because it is fixed.
  - Lines are replaced in one transaction.
- **DELETE:** a hard delete; the lines cascade. Audit entry `module 'conduces'`, `action 'DELETE'`.
- **`client_name`:** stored on create and update with the same chain the quote uses (`razon_social`, else
  `company_name`, else `client_name`), trimmed and cut to 100 characters, the column's width.

### 4.4 PDF: conduce mode of `FerreteriaCotizacionPdf`

The renderer stays pure. Its `$cotizacion` input gains an optional `documento` key: `'cotizacion'` (the
default) or `'conduce'`. In conduce mode:

- **Unchanged:** logo, address, RNC, page geometry, fonts, blue bands, the end-of-list marker row,
  "Recibido por", the footer, page breaks and "Página X de Y".
- **Title:** `CONDUCE DE MERCANCÍA`, replacing `COTIZACIÓN MERCANCÍAS`.
- **Left block:** the long date, the `code` (or `VISTA PREVIA`), then a line **`Cotización: COT-000012`**,
  which is omitted when the quote was deleted, then `NOMBRE O RAZÓN SOCIAL`, the client name and the
  formatted RNC.
- **Table:** **Cantidad | Unidad | Descripción**.
  - Unidad is the unit's name from the master catalog (`unidadMedidaModel::descripcion`), falling back to the
    code.
  - Cantidad keeps the quote's 2 decimals.
  - Descripción takes the remaining width.
- **No** Valor Unitario or Valor Total columns and **no totals block**. "Recibido por" follows the marker
  row; the whole closing block is never split, as in the quote.
- **Data:** `FerreteriaConduce::pdf/preview` loads the emisor (`EmisorConfigModel::get()`), the client (with
  the stored `client_name` as fallback) and `BrandingResolver::logoPath()`, then passes them in, as the quote
  path does.

### 4.5 Gratex is untouched

- `cotizacionController.php`, `cotizacionModel.php`, `CotizacionPdfGenerator.php`, `GratexFormato.php` and
  the `cotizaciones` and `cotizacion_items` tables are not modified.
- `FerreteriaFormato.php` changes only by the line-rule extraction (4.3). The quote harness must stay green
  with the same totals (394 checks plus the new ones).

## 5. Frontend (fiscalo)

### 5.1 Navigation

- **New views:** `ViewId` gains `'conduces'` (the list) and `'conduce-editar'` (the form, new or existing).
  `SUBVISTA_DE['conduce-editar'] = 'conduces'`.
- **NAV item:** `{ id: 'conduces', label: 'Conduces', icon: 'truck', module: 'cotizaciones', formato:
  'ferreteria' }`, right after Cotizaciones.
  - Use the closest existing delivery icon in `IconName` if `truck` doesn't exist; check `Icon.tsx`.
- **`NavItem.formato?`.** A new optional field: the item shows only when the tenant's formato equals it.
  - `puedeVerItem` and `puedeVerVista` take the tenant formato as an extra optional argument.
  - Sidebar, SearchPalette and the App guard pass `useCotizacionFormato().formato`.
  - While branding is loading, formato-gated items stay hidden. The App guard does **not** redirect away while
    loading, so a reload on the Conduces page doesn't bounce to the dashboard.
  - A formato other than `ferreteria` hides the item, and visiting the view redirects to the dashboard, as
    any non-permitted view does.

### 5.2 API layer

`src/api/conduces.ts` gets `listConduces`, `getConduce`, `createConduce`, `updateConduce`, `deleteConduce`,
`getConducePdf` and `previewConduce`.

**Types in `src/api/types.ts`:**
- `ConduceRow` and `ConduceItemRow`: DECIMALs as `string | number`.
- `ConduceInput`: `{ cotizacion_id?: number; client_id: number; date?: string; items: ConduceItemInput[] }`.
- `ConduceItemInput`: `product_id`, `description`, `quantity`, `unidad_medida`, `amount`,
  `indicador_facturacion`, `indicador_bien_servicio`.

**Cache keys:** `['conduces', …]`, with a staleTime entry in `config/cache.ts` like cotizaciones.

### 5.3 Cotizaciones page

Unchanged, except that **Ferretería quote rows** gain a **"Conduce"** button next to PDF and Facturar ▾. It
navigates to `nav('conduce-editar', { kind: 'conduce-desde-cotizacion', cotizacionId })`. Gratex rows don't
show it.

### 5.4 Conduces page (`src/features/conduces/ConducesView.tsx`)

- **Columns:** Número | Cliente | Fecha | Cotización, where the last one shows `cotizacion_code`, or
  "eliminada" when it is NULL.
- **Search and paging:** like `CotizacionesView`.
- **Row actions:**
  - PDF;
  - **Facturar ▾**: "Factura electrónica (e-CF)" / "Factura simple", each gated by
    `puedeVerVista(…, 'factura-nueva' | 'factura-simple-nueva')` as on quotes;
  - clicking the row opens `nav('conduce-editar', { kind: 'conduce', id })`.
- There is **no "Nuevo" button**.
- **Empty state:** "Todavía no hay conduces. Crea uno desde una cotización con el botón Conduce."

### 5.5 Conduce form

**Location:** `src/features/conduces/ConduceForm.tsx`. It reuses the Ferretería quote form's pieces instead
of copying them:
- the client block (`ClientCombobox` + `NombreClienteLibre` + `NewClientModal`);
- `ProductoCombobox`;
- the unit select;
- `useAvisoSalida` and `useAccionUnica`.

Where those pieces live inside `FerreteriaCotizacionForm.tsx`, they are extracted into
`src/features/cotizaciones/formatos/ferreteria/` components first, with the quote form's behavior unchanged.

**A new conduce** (`kind: 'conduce-desde-cotizacion'`) loads the quote row and pre-fills:
- the client;
- the date (today);
- each line's product, description, quantity, unit, **and the internal price** (`amount`),
  `indicador_facturacion` and `indicador_bien_servicio`.

**An existing conduce** (`kind: 'conduce'`) loads it with `getConduce` (loading, error and "ya no existe"
states as in `CotizacionEditor`).

**Header:**
- the logo and emisor;
- the title **"Conduce de mercancía"**;
- the number (`CON-…`, or "Se asigna al guardar");
- **"Desde la cotización COT-000012"** ("de una cotización eliminada" when NULL).

**Lines grid:** **Cant. | Unidad | Descripción**. There is no Precio, ITBIS or Valor total column, no totals
panel and no "Cargos y abonos".
- Adding a catalog product stores its sale price and indicators internally.
- "Línea libre" stores `amount 0`, indicator 1, unit 43 and Bien.

**Editing:** client and date are editable. Date rules are the quote form's: send the full datetime on create,
and send it on edit only when the day changed.

**Actions:**
- Vista previa (`previewConduce`, with `id` when editing);
- Guardar (POST, or PUT when editing);
- Eliminar, with an inline confirmation;
- the leave-without-saving warning.

On save the user goes back to the Conduces list, with a toast showing the new code.

**Validation:** a Zod schema with the same per-line messages as the quote form: client required, at least one
line, description, quantity per unit.

### 5.6 Facturar from a conduce

`src/features/conduces/conversion.ts` maps a `ConduceRow` to the existing prefill shapes:
- `conduceAFacturaPrefill(c): FacturaPrefill`: `precioConItbis: false`; lines carry `prodId`, `unidadMedida`,
  `indFact` and `tipoItem`.
- `conduceAFacturaSimplePrefill(c): FacturaSimplePrefill`: the price folds in ITBIS, as for Ferretería
  quotes.

Both set `origen` to the conduce code and a new optional **`origenTipo: 'conduce'`**.

**Banner.** `InvoiceFormView` and `SimpleInvoiceFormView` read "Convertida desde el **conduce** CON-000001"
when `origenTipo === 'conduce'`. They keep today's "cotización" wording otherwise, so the Gratex and
Ferretería quote banners don't change.

**Avisos:**
- When a line has `amount` 0: "N línea(s) del conduce no tienen precio: escríbelo antes de emitir." The
  factura form's own validation blocks issuing a 0 price.
- The client's fixed discount applies, with today's notice.

### 5.7 Audit log

`features/audit/entidad.ts` labels entity type `conduce` as "Conduce". An entry with a numeric id opens
`nav('conduce-editar', { kind: 'conduce', id })`.

## 6. Testing

**Backend** (`tools/test_cotizacion_ferreteria.php` sections, or a new `tools/test_conduces.php` with the same
assert helpers):
- **Numbering:** with the fake PDO from the quote harness, `CON-000001` is assigned on its own sequence and
  lock, and the 1062 is retried once.
- **Rules:**
  - price 0 is allowed and a negative price rejected;
  - `ajustes` is rejected;
  - `cotizacion_id` is required, and must point to a quote whose formato is `ferreteria`;
  - the extracted shared line rules give identical messages for quotes. The existing quote sections stay
    green.
- **PDF:** a conduce render contains `CONDUCE DE MERCANCÍA`, `Unidad` and `Cotización: COT-`. It contains
  **none** of `Valor Unitario`, `Sub-total` or `TOTAL`. A 60-line conduce paginates, with the header repeated
  and "Página X de Y". Samples go to `tools/out/` for a visual check.
- **Snapshot:** `check_tenant_schema_orden.php` checks that both tables come after `cotizaciones` and
  `products`, plus the index and FK names.
- **Endpoint gate:** a non-`ferreteria` tenant answers 422, checked through the fake-model harness pattern of
  Task 6.
- `php -l` on every touched file.
- **Manual server checks** (`tests/test_conduces.http`): create, list, edit, PDF, delete, the 422 cases, five
  parallel creates giving distinct numbers, and Gratex unchanged.

**Frontend:**
- **Node scripts:** the conduce → factura and factura-simple mapping (prices, indicators, aviso for 0-price
  lines, `origenTipo`), and the conduce schema.
- **Gates:** `npm run typecheck`, `npx eslint src scripts`, `npm run build`.
- **Browser checks against the local mock only:**
  - the menu entry appears only for `ferreteria`;
  - Conduce from a quote, editing, saving, the list, PDF, Facturar e-CF and simple (banner, avisos);
  - Gratex shows no change;
  - mobile layout.

## 7. Rollout

1. Take a backup, then run **029** in `smhynzte_002` (Ferretería) and `smhynzte_new_gratexdb` (Gratex). Run
   step 0 first. It only creates tables.
2. Re-run `tools/verificar_migraciones_tenant.sql` in both databases. **027, 028 and 029 must all say APLICADA**
   before step 3: this deploy also ships the code that needs 027 and 028, which is already on master. If one says
   FALTA, run it first, following the ORDEN note in its header.
3. Deploy api-gratex, then fiscalo.
4. Smoke test as Ferretería: create a conduce from a quote, check its PDF, edit it, then Facturar without
   issuing. As Gratex: check that nothing changed and there is no menu entry.

No setting is needed: Ferretería already has `cotizacion_formato = 'ferreteria'`.

## 8. Out of scope

- Tracking delivered versus pending quantities.
- Merging several conduces into one factura.
- A conduce created from scratch.
- Conduce → cotización.
- Marking a conduce as "facturado" or linking the factura back to it.
- A separate RBAC permission for conduces.
- Conduces for Gratex or other formatos.

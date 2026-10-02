# Per-tenant cotización formats ("formatos de cotización") — design

- **Date:** 2026-10-01
- **Repos:** `fiscalo` (React frontend) and `api-gratex` (PHP backend)
- **Status:**
  - Design approved in chat, one section at a time.
  - This spec has been through an adversarial review against the code (5 lenses, a skeptic per lens, 61
    findings confirmed and folded in).
  - Next step: user review of this document.

## 1. Goal

Production has two tenants. The cotización module was built around tenant 1, **Gratex**. **Ferretería**
(FERREHERRAMIENTAS VENTURA, SRL, RNC 132-615123) uses the same factura flow but doesn't use cotizaciones:
both the form and the PDF are specific to Gratex.

We want:

1. A cotización for Ferretería that:
   - matches the Excel format they use today ("COTIZACION MERCANCIAS", `COTIZACION JUN Ta de cera.xlsx`);
   - works for a hardware store: lines are catalog products, the quote converts into a factura, and that
     factura moves inventory.
2. Gratex's cotización keeps behaving as it does today.
3. A mechanism where a future tenant gets its own format by **adding one formato**. Forking the module
   must not be necessary.

### Success criteria

- Once ops switches Ferretería's setting, its users can create, edit, preview, print and delete quotes in
  the new format.
- The PDF matches their sheet: the same blocks, the same 4 columns, the same totals rows, and "Recibido
  por" plus the footer.
- The totals match their sheets exactly:

  | Sub-total | ITBIS | TOTAL |
  |---|---|---|
  | 41,860.00 | 7,534.80 | 49,394.80 |
  | 27,278.00 | 4,910.04 | 32,188.04 |
  | 8,260.00 | 1,486.80 | 9,746.80 |

- "Facturar" opens the e-CF form or the factura-simple form pre-filled with the client and lines linked to
  products.
  - The amounts agree with the quote **before the client's fixed discount**, which the target form applies
    as it does today, with a notice.
  - The extra charges are not copied either (see 8.3).
- Gratex's request and response shapes, PDF, numbering, email and screens don't change.
  - `CotizacionPdfGenerator.php` and `CotizacionFormView.tsx` are not edited by this work.
  - The only deliberate Gratex differences are listed in 9.1.

## 2. Decisions taken (from the brainstorming Q&A)

| Topic | Decision |
|---|---|
| Lines | Linked to catalog products (`product_id`, unit, ITBIS indicator, bien/servicio). Free lines are also allowed. |
| Extra totals rows | Optional and editable. They count in the totals, and the PDF prints only rows that have a value. |
| Numbering | An automatic sequence per tenant, shown as `COT-000001`. Gratex keeps its random codes. |
| Facturar | Into the e-CF form **or** into factura simple. |
| Factura simple price | Each line's price includes its ITBIS, so the customer pays about the quoted TOTAL. |
| Client's fixed discount on conversion | **Applied**, as for Gratex today. The target form shows a notice that the factura differs from the quote. |
| Email | Hidden for Ferretería. Gratex's email behavior doesn't change. |
| Approach | **A**: a per-tenant `cotizacion_formato` setting, plus one coded formato module per format on each side. |
| Untaxed extras | Mano de obra and the bank charges are added after ITBIS and carry no ITBIS. |
| Retención | 5% of the Sub-total, which is the amount before ITBIS. |
| Prices | Product and line prices exclude ITBIS, as in the Excel. |
| Workspace | The other sessions' uncommitted work is committed first. Then branch `feat/cotizacion-formatos` in both repos. |

## 3. The source format (Ferretería's Excel)

The workbook has 3 sheets with the same layout: `cotizacion pintura`, `b150000049` and `CERAMICAS`. All
three are Letter portrait and use Times New Roman throughout. The item header and the totals values are
filled light blue (#BDD7EE).

From top to bottom:

1. The logo (`xl/media/image1.jpeg`), centered.
2. The address on two lines.
3. `RNC 132-615123`.
4. The title `COTIZACION MERCANCIAS`, bold and centered.
5. The date as `SEPTIEMBRE 2/2026.-`.
6. A number typed by hand, with no pattern: `NCM 12000056`, `NC 0902`, `NC 09028`.
7. `NOMBRE O RAZON SOCIAL`, the client's name, and the client's RNC (`401-51513-1`).
8. The table: `Cantidad | Descrpcion mercancias | Valor Unitario | Valor Total RD$`, with `D = A × C`.
9. The marker row `***********No hay mas productos debajo de la linea*****`.
10. The totals rows: Sub- total RD$, Restante (Adeudado), ITBIS 18% (`=Subtotal*0.18`), Abono realizado,
    Cargos bancarios, Manejos de operaciones bancarias, Costo mano de obra, Retencion Renta por Tercero 5%,
    Restante, TOTAL RD$ (`=Subtotal+ITBIS`). Every row except Sub-total, ITBIS and TOTAL is blank.
11. `Recibido por:` followed by a centered footer: legal name / email (blue, underlined) /
    `Teléfono 829-898-7798`.

The test fixtures copy every line of the 3 sheets (section 9.2).

## 4. Current state (what the code map found)

These are the facts the design depends on. File references point to the working tree on 2026-10-01; other
sessions are still changing several of these files.

- **Below the header, the PDF is Gratex's for every tenant.** The cotización PDF
  (`api-gratex/src/Utils/CotizacionPdfGenerator.php`) uses the per-tenant template only for
  `drawCompanyHeader(..., 'cotizacion')`. Everything else is hard-coded Gratex content:
  - the title, the disclaimer and the client band;
  - the columns;
  - the 60/40 terms;
  - **Gratex's bank account #790371603**, email and WhatsApp;
  - a flat 18% ITBIS, `Descuento 0.00`, and the signatures plus the seal.
- **Email (working tree).** `sendCotizacionPdfEmail` now goes through `src/Utils/TenantMail.php`, which
  another session is adding. A non-Gratex tenant sends from its own `emisor_config.correo` without copies
  to Gratex. Ferretería still won't get the email switch (decision 2); enabling it later is a small
  follow-up.
- **Drift between the snapshot and the code.**
  - The model INSERTs `cotizaciones.user_id`, and the UPDATE sets `updated_at`. Neither column is in
    `db/tenant_schema.sql`.
  - `client_name` there is NOT NULL with no default, and the code never writes it.
  - So a tenant database built from the snapshot, most likely Ferretería's, **can't save a cotización**.
- **Lines and codes.**
  - Lines are free text only: `description`, `amount`, `quantity`, `subtotal`.
  - `getCotizacionItems` names those 5 columns explicitly and returns `[]` on any PDOException
    (`cotizacionModel.php` ~346-356).
  - The code is random (3 letters + 3 digits) and has no UNIQUE index.
- **Conversion to factura.**
  - `toFacturaPrefill` only carries `nombre`, `cantidad` and `precio`.
  - `InvoiceFormView` hard-codes the prefilled lines to `indFact 1`, unit 43, `tipoItem 'Bien'` and no
    product. It starts with "precio con ITBIS" on (`useState(prefill != null)`, ~190).
  - Its banner always says "los precios ya traen ITBIS incluido" (~586-590).
  - It applies the client's fixed discount on purpose (~229-240).
  - There's no conversion to factura simple.
- **The frontend doesn't know its tenant.**
  - There's one bundle, and login and `/auth/me` carry no tenant.
  - The only per-tenant data on the client comes from `GET /api/branding` and `GET /api/emisor`.
  - `['branding']` is fetched only by the form and settings screens, not by `CotizacionesView`.
- **There is already a per-tenant PDF template mechanism**: `master.tenants.pdf_template`,
  `BrandingResolver`, `FacturaTemplateFactory`, the `custom:<name>` classes and
  `Custom/FerreventuraTemplate.php`.

## 5. Architecture

### 5.1 The setting

- **Master migration `011_add_tenant_cotizacion_formato.sql`.** It follows 008/010: idempotent, checked
  against `information_schema`, run with `PREPARE/EXECUTE`. It adds:
  ```sql
  ALTER TABLE tenants ADD COLUMN cotizacion_formato VARCHAR(40) NOT NULL DEFAULT 'gratex'
    COMMENT 'Formato de cotizacion: gratex | ferreteria (src/Utils/Cotizacion/)' AFTER pdf_accent_color;
  ```
  It is reflected in `db/master_schema.sql`.
- **Existing tenants.** They all stay `'gratex'`. Ferretería changes only when ops runs
  `UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <ferretería>;`.
- **Set only by SQL.** There's no settings screen and no `PUT /api/branding`. A formato is code built for
  one specific client.
- **How the backend reads it:** `TenantResolver::current()['cotizacion_formato'] ?? 'gratex'`. Every
  tenant lookup is `SELECT *`, so this also works before 011 has run.
- **How the frontend gets it:** `GET /api/branding` (`brandingController` `brCurrent`, readable by every
  role) adds `cotizacion_formato`. The branding PUT whitelist doesn't change.

### 5.2 Backend: formato modules

There's a new folder, `api-gratex/src/Utils/Cotizacion/`. The repo has no autoloader, so each file
`require_once`s what it uses.

```
CotizacionFormato.php        abstract base (contract below)
CotizacionFormatos.php       registry: para(?string $nombre): CotizacionFormato (unknown/NULL → Gratex)
GratexFormato.php            today's controller branches, moved verbatim
FerreteriaFormato.php        rules, numbering, totals for Ferretería; pure static helpers for tests
FerreteriaCotizacionPdf.php  pure FPDF renderer (section 7)
Redondeo.php                 version-independent rounding (6.4)
```

**The contract.** Every method returns `['success', $payload]` or `['error', string $msg, int $http]`.
`$body` is the `stdClass` the controller decodes once with `InputSanitizer::jsonInput(false)`; a null body
becomes `new stdClass`. Items stay objects.

| Method | Purpose |
|---|---|
| `nombre(): string` | `'gratex'` or `'ferreteria'` |
| `crear(object $body): array` | Validate, compute, number and persist. |
| `actualizar(array $row, object $body): array` | Same as `crear`, on an existing row. The number and code never change. |
| `preview(object $body, ?array $row): array` | Validate and compute without saving. The payload is the PDF bytes. |
| `pdf(array $cotizacion): array` | The payload is the PDF bytes. |
| `permiteCorreo(): bool` | Gratex `true`, Ferretería `false` |

**`GratexFormato`** moves today's controller branches over **verbatim**:
- the client_id, items and total checks, with the same `COT_*` messages and HTTP 200 `status:false`;
- then `cotValidarItems`, which answers 422. Preview does **not** call it, exactly as today.

It also keeps today's data unchanged:
- It passes `$body->user_id ?? null`, `$body->sent_email === true` and `$body->date ?? ''` to the
  untouched `cotizacionModel::saveCotizacion` and `::updateCotizacion`.
- The email stays inside those methods.
- Success data stays as it is: `{id, code, message}` on create and the model's string on update.
- Preview keeps its `clients` lookup for `client_name` and the code `'PREVIEW'`.
- `pdf()` wraps `new CotizacionPdfGenerator(...)->generatePdf()`.

`cotValidarItems` and the `COT_*` constants stay where they are, and GratexFormato calls them.

**`FerreteriaFormato`**:
- It uses `RequestContext::userId()`, the token's user, for `user_id`.
- It ignores `sent_email` and `total`.
- It exposes pure static functions `totales(array $lineas, array $ajustes): array` and
  `validarForma(object $body, callable $permiteDecimales): ?array`, which checks shape, ranges, decimals
  and ajuste keys. The CLI test calls them without a database.
- The DB checks (the client exists, each product exists, unit fractions through `unidadMedidaModel`) run
  separately inside `crear`, `actualizar` and `preview`.

**Choosing the formato, in `cotizacionController.php`.** The controller decodes the body, resolves the
formato, calls it, writes the `AuditLogger` entry on success as today, and wraps the envelope. Nothing
else stays in the switch except PUT's `id` check. RBAC and `AuthMiddleware` don't change, and there are no
new routes.

- **POST** resolves to the tenant setting.
- **PUT** first loads `$row = getCotizaciones($id)[0] ?? null`, then resolves to
  `$row['formato'] ?? 'gratex'`. A missing row resolves to Gratex, which returns today's "ya no existe".
- **POST /preview** resolves to the row's formato when the body has `id`, otherwise to the tenant setting.
- **GET /{id}/pdf** resolves to the row's formato.
- **Mismatch guard.** The Ferretería form sends `"formato": "ferreteria"` in every POST, PUT and preview
  body. The unchanged Gratex form sends nothing, which means `'gratex'`. If the body's formato differs
  from the resolved one, the server answers **409** with "La pantalla de cotizaciones está desactualizada
  (cambió el formato de tu empresa). Recarga la página." and saves nothing. This stops a stale tab or
  bundle from saving a Gratex body (prices with ITBIS included) through the Ferretería rules, which add
  ITBIS on top.
- **Email path.** It stays inside the Gratex legacy methods, so it always runs on the Gratex formato.

**Read paths in `cotizacionModel.php`:**
- The header queries already use `c.*`, so `formato`, `numero`, `subtotal` and `itbis` appear once 026 has
  run.
- `getCotizacionItems` changes from its explicit 5-column list to
  `SELECT * FROM cotizacion_items WHERE cotizacion_id = :cotizacion_id ORDER BY id ASC`. The new columns
  must **never** be named in a SELECT: the existing catch returns `[]`, which before 026 would silently
  empty every quote's lines, and an edit-save would then delete them.
- `getAjustes(int $id)` has its own try/catch: it logs the error and returns `[]`. It's called only for
  rows whose `formato` is set and isn't `'gratex'`. Gratex rows get an empty object without running a
  query, so a missing `cotizacion_ajustes` table can never empty the Gratex list, return 404 on a Gratex
  PDF, or make PUT say "ya no existe".
- `ajustes` is always JSON-encoded as an object (`(object)`).
- `getCotizacionesPaginated` orders by `c.date DESC, c.id DESC`. The tie-breaker only orders rows that
  share the same date.

**New model methods, used only by FerreteriaFormato:**
- `crearConFormato(array $cot, string $formato, ?int $userId)` and
  `actualizarConFormato(int $id, array $cot, ?int $userId)` write the header, the lines and the ajustes in
  one transaction.
- `siguienteNumero(): int` (see 6.3).
- Private copies of the lock helpers (6.3).

### 5.3 Frontend: formato registry

There's a new folder, `fiscalo/src/features/cotizaciones/formatos/`:

```
index.ts                     FORMATOS registry + useCotizacionFormato()
CotizacionEditor.tsx         picks the form (below)
ferreteria/FerreteriaCotizacionForm.tsx
ferreteria/totales.ts        totalesFerreteria(): pure, same math as PHP
ferreteria/schema.ts         Zod schema for form → API payload
ferreteria/conversion.ts     toFacturaPrefill / toFacturaSimplePrefill for Ferretería rows
```

- **`useCotizacionFormato()`**
  - It calls `useApiQuery(['branding'], getBranding)`, so it fetches when the cache is empty, and returns
    `{ formato, cargando, error }`.
  - `formato` is `data.cotizacion_formato` when that's a registry key. It's `'gratex'` only when branding
    **loaded** and the field is missing (backend not deployed yet) or unknown.
- **`CotizacionEditor`**
  - `App.tsx` renders `<CotizacionEditor key={cotizacionId ?? 'nueva'} nav={nav} cotizacionId={...} />`
    for `cotizacion-nueva`. The key remounts the editor cleanly when the user goes from one quote to a new
    one.
  - **For a new quote**, it shows `LoadingState` while `cargando`, and `ErrorState` with retry on `error`.
    It never mounts one form and then swaps it for another.
  - **For an existing quote**, it calls exactly `useApiQuery(['cotizaciones','detail',id], () =>
    getCotizacion(id))`. That's the same key and the same raw `CotizacionRow | null` as
    `CotizacionFormView`, and no mapping is allowed inside the queryFn, so the Gratex form gets its row
    from the cache.
    - Loading → `LoadingState`.
    - Error → `ErrorState`.
    - `null` → "Esta cotización ya no existe" with a link to the list.
    - Otherwise → `FORMATOS[row.formato ?? 'gratex']`, falling back to gratex for an unknown key.
- **`CotizacionesView`** stays shared.
  - It waits for both the list and branding before it chooses columns. If branding fails, it uses the
    Gratex columns; it's a read-only list.
  - The "Nueva cotización" button stays.
  - The row actions (open, PDF, Facturar) follow **that row's** formato.
- **API types.** New `CotizacionFerreteriaInput` and `AjustesFerreteria` types in `src/api/types.ts`, with
  `formato: 'ferreteria'` and no `total`. `createCotizacion`, `updateCotizacion` and `previewCotizacion`
  accept `CreateCotizacionInput | CotizacionFerreteriaInput`. `CotizacionRow` and `CotizacionItemRow` gain
  the optional new fields as DECIMAL strings, read with `aNumero`.
- **`ferreteria/totales.ts`**
  - It computes each line with `montosLinea(…, false)` and adds up with `r2`, both from
    `src/features/invoices/montosLinea.ts`.
  - It imports that module by **relative path with the `.ts` extension**. Anything from `@/…` is
    `import type` only, and it uses no enums or other syntax that can't be erased.
  - So `node` can load it for the parity script (9.2).
- **`indFactFromItbis`** moves from `InvoiceFormView.tsx` (module-private today) to `montosLinea.ts` and is
  exported. The Ferretería form and InvoiceFormView share one mapping.
- **Adding a future tenant:** one PHP formato class, one React folder, register both, and one
  `UPDATE tenants`. It needs no migration unless that format needs new data.

## 6. Data model and rules

### 6.1 Tenant migration `026_cotizaciones_formatos.sql`

It is idempotent: every change is guarded with `information_schema`, following 023/025.

- **Order:** run it on **each** tenant database **after 025**.
- **Header:** it carries the repo's POR QUÉ / QUÉ HACE / ANTES DE CORRER / ORDEN DE DESPLIEGUE header.
- **Off-hours:** adding the FK rebuilds `cotizacion_items` and blocks writes, the same warning 025 gives.

**Step 0 (read-only, as 025 does):**
- Show the `ENGINE` of `cotizaciones`, `cotizacion_items` and `products`. All three must be InnoDB.
- Show the exact `COLUMN_TYPE` of `cotizaciones.id` and `products.id`. The new FK columns copy those types,
  signedness included. The migration reads them from `information_schema` and builds the DDL dynamically.

**A. Fix the drift:**
- Add `cotizaciones.user_id INT(11) NULL` if it's missing.
- Add `cotizaciones.updated_at DATETIME NULL` if it's missing.
- If `client_name` is missing, add it as `VARCHAR(100) NULL`.
- If `client_name` is `NOT NULL` with no default, run a `MODIFY` built from `information_schema`
  (`COLUMN_TYPE`, `CHARACTER_SET_NAME`, `COLLATION_NAME`) so that **only nullability changes**. Width,
  charset and collation are kept.

**B. New columns on `cotizaciones`:**
- `formato VARCHAR(40) NULL`, where NULL means gratex.
- `numero INT UNSIGNED NULL` + `UNIQUE KEY uk_cotizaciones_numero (numero)`. Any number of NULLs is
  allowed.
- `subtotal DECIMAL(18,2) NULL`.
- `itbis DECIMAL(18,2) NULL`.

**C. New columns on `cotizacion_items`.** NULL means an old-style line (Gratex).
- In **one** guarded `ALTER`, as 023 does, so MySQL doesn't auto-create a duplicate index:
  - `product_id <products.id type> NULL`;
  - `KEY idx_cotizacion_items_product (product_id)`;
  - `CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL`.
- `unidad_medida VARCHAR(10) NULL`. It holds the DGII numeric unit code (= master `unidades_medida.id`,
  e.g. `'43'`), as in `factura_items`, never `codigo`.
- `indicador_facturacion TINYINT NULL` (1 = 18%, 2 = 16%, 3 = 0%, 4 = Exento).
- `indicador_bien_servicio TINYINT NULL` (1 = Bien, 2 = Servicio).
- `itbis_amount DECIMAL(18,2) NULL`.

**D. New table:**

```sql
CREATE TABLE IF NOT EXISTS cotizacion_ajustes (
  id            INT(11)       NOT NULL AUTO_INCREMENT,
  cotizacion_id <cotizaciones.id type> NOT NULL,
  concepto      VARCHAR(30)   NOT NULL COMMENT 'Clave definida por el formato (ej. mano_obra, abono)',
  monto         DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cotizacion_ajuste (cotizacion_id, concepto),
  CONSTRAINT cotizacion_ajustes_cot_fk FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Each formato declares which `concepto` keys it accepts. Only non-zero ajustes are stored.

**Snapshot (`db/tenant_schema.sql`).** The snapshot does not disable `FOREIGN_KEY_CHECKS`, so a referenced
table must be created first. Today `cotizacion_items` (line ~61) comes before `products` (~117).

- **Move the whole "2) Cotizaciones" block below "2c) Catálogo de productos".** The block holds
  `cotizaciones`, `cotizacion_items` and the new `cotizacion_ajustes`. Renumber its comment.
- **Write the end state:** `user_id`, `updated_at`, `client_name NULL`, every new column, and identical
  index and FK names.
- **Bump the ranges:** the header ("012..025" → "012..026") and `db/migrations/README.md` ("hasta la 025").
- **Update** `docs/database/schema.md`.

### 6.2 Ferretería totals

The server computes them and ignores any `total` the client sends. The frontend runs `totalesFerreteria()`
with the same rules. Every amount, including each sum, is rounded with `r2`: `Redondeo::r(x, 2)` in PHP,
`r2` from montosLinea in TS.

| Row | Rule |
|---|---|
| Line base (`subtotal`) | `r2(r2(quantity) × r4(amount))`. `amount` is the unit price **without** ITBIS. |
| Line ITBIS (`itbis_amount`) | `r2(base × tasa(indicador))`. `tasa` is 0.18 / 0.16 / 0 / 0 for 1 / 2 / 3 / 4. |
| **Sub-total RD$** (`cotizaciones.subtotal`) | `r2(Σ base)` |
| **ITBIS** (`cotizaciones.itbis`) | `r2(Σ line ITBIS)` |
| + Cargos bancarios (`cargos_bancarios`) | Typed amount, ≥ 0, at most 2 decimals, no ITBIS |
| + Manejos de operaciones bancarias (`manejo_bancario`) | Same rules |
| + Costo mano de obra (`mano_obra`) | Same rules |
| **TOTAL RD$** (`cotizaciones.total`) | `r2(Sub-total + ITBIS + cargos_bancarios + manejo_bancario + mano_obra)` |
| − Retención Renta por Tercero 5% (`retencion_isr`) | A checkbox in the request. When checked, the stored amount is `r2(Sub-total × 0.05)`, recomputed on every save. |
| Owed | `r2(TOTAL − retención)` |
| − Abono realizado (`abono`) | Typed amount, ≥ 0, at most 2 decimals, and `r2(abono) ≤ owed`. The comparison uses the rounded values. |
| **Restante (Adeudado)** | `r2(owed − abono)`. Computed, not stored. Shown on screen and in the PDF **only** when retención > 0 or abono > 0. |

- **ITBIS label.** `ITBIS 18%` when at least one line has ITBIS > 0 and all those lines are at 18%.
  Otherwise just `ITBIS`, which also covers a quote where every line is exempt.
- **Why these rules match the Excel.** The Excel takes 18% of the whole subtotal, while we add up the
  per-line ITBIS. With whole-peso prices, as in all 3 sheets, both give the same result. With prices in
  cents, they can differ by a cent. The per-line rule is chosen because it's what the e-CF does.

**Worked examples** (these are the test fixtures):

| Sheet | Sub-total | ITBIS | TOTAL | With retención | With abono 10,000.00 (on top of retención) |
|---|---|---|---|---|---|
| `cotizacion pintura` (7 lines, all 18%) | 41,860.00 | 7,534.80 | 49,394.80 | 2,093.00 | Restante 37,301.80 |
| `b150000049` (26 lines) | 27,278.00 | 4,910.04 | 32,188.04 | | |
| `CERAMICAS` (5 lines) | 8,260.00 | 1,486.80 | 9,746.80 | | |

- **Rounding edge case:** 1 × 84.75 at 18% gives ITBIS **15.26**, which matches PHP 8.3 and `montosLinea`.
- **Float edge case:** Sub-total 13.70 + ITBIS 2.47 gives TOTAL 16.17. With retención 0.69, an abono of
  exactly 15.48 is accepted and leaves Restante 0.00.

### 6.3 Numbering (Ferretería)

`crearConFormato`:

1. Take `GET_LOCK(CONCAT(DATABASE(), ':cotizacion_seq'), 5)` through **private copies** of
   `facturaModel`'s lock helpers, which are private there. If the lock is busy or fails, log it and
   continue without the lock, as facturas simples do.
2. `beginTransaction`.
3. `siguienteNumero()` = `SELECT COALESCE(MAX(numero), 0) + 1 FROM cotizaciones`. It doesn't lock
   anything itself. `code = 'COT-' . str_pad(numero, 6, '0', STR_PAD_LEFT)`.
4. Insert the header (`formato`, `numero`, `code`, `date`, `client_id`, `client_name`, `subtotal`, `itbis`,
   `total`, `user_id`), then the lines and the ajustes. Commit.
5. In `finally`, release the lock if it was taken.

- **Retry rule.**
  - If a `PDOException` has `errorInfo[1] === 1062` on `uk_cotizaciones_numero`: `rollBack`, then repeat
    steps 2–4 **once in a new transaction**, so that `MAX` is read again.
  - Any other error is not retried, including 1452, a product deleted in between. It maps to a clear
    Spanish message.
- **Updates** never change `numero` or `code`.
- **Search** over `code` already finds `COT-000123` and `000123`.

### 6.4 Rounding

`Redondeo::r(float $x, int $dec): float` copies `montosLinea.redondear` exactly:

```
$v = (float) sprintf('%.15h', abs($x) * 10 ** $dec);   // like Number(x.toPrecision(15))
$r = round($v) / 10 ** $dec;                            // integer round, half away from zero
return $x < 0 ? -$r : $r;
```

- **Same result on every PHP version.** It gives PHP 8.3 results on 8.3 and 8.5 alike, so a local test
  agrees with production.
- **Same result in every locale.** The format is `%h`, not `%g`: `h` is `g` with a fixed `.` decimal point
  (PHP 8.0+). `%g` takes its decimal point from `LC_NUMERIC`, while the `(float)` cast always reads `.`, so
  under a comma locale (`setlocale(LC_ALL, 'es_ES')`) `1525.5` would print as `1525,5`, the cast would read
  `1525`, and rounding would turn into truncation (84.75 × 0.18 → 15.25). JS `toPrecision` ignores the
  locale too, so `%h` is the faithful copy.
- **Where it's used.** FerreteriaFormato uses it for every amount. Gratex code doesn't use it and isn't
  changed.
- **Testing.** The CLI test compares it with fixed expectations such as 84.75 × 0.18 → 15.26, plus a
  sweep against the montosLinea algorithm.

### 6.5 API contract

The endpoints are the same. **Gratex's request and response shapes don't change.** Everything below is the
Ferretería formato.

**POST `/api/cotizaciones` and POST `/api/cotizaciones/preview`:**

```json
{
  "formato": "ferreteria",
  "client_id": 123,
  "date": "2026-09-02 10:15:00",
  "items": [
    { "product_id": 55, "description": "FUNDAS CEMENTO GRIS", "quantity": 2, "amount": 935,
      "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1 },
    { "product_id": null, "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 }
  ],
  "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 1500,
               "abono": 0, "retencion_isr": false }
}
```

- **Preview** also accepts an optional `id`. With it, preview uses that row's formato and prints the row's
  code. Without it, the code position prints `VISTA PREVIA`.
- **PUT `/api/cotizaciones`** takes the same body plus `id`.
- **Field rules and defaults:**
  - `date` is `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`, and must be a real date. Otherwise 422 "La fecha no es
    válida.".
  - A missing or empty `date` means now on POST, and keeps the stored datetime on PUT.
  - A missing `unidad_medida` is stored as `'43'`. Any value is normalized to `(string)(int)` and checked
    against the master unit catalog.
  - A missing `indicador_facturacion` is stored as 1.
  - A missing `indicador_bien_servicio` is stored as 1. When `product_id` is set, the server takes it from
    `products.indicador_bien_servicio`.
  - `quantity` decimals are checked with `problemaCantidad` using the normalized unit, never null.
- **Ajustes:**
  - The amount keys are `cargos_bancarios`, `manejo_bancario`, `mano_obra` and `abono`.
  - `retencion_isr` must be a boolean in the request. It isn't subject to the ≥ 0 rule, and any other type
    gets 422.
  - Unknown keys get 422.
  - A PUT **replaces the whole set**: a missing `ajustes` means none.

**Validation** returns HTTP 422 with a clear Spanish message that names the line when there is one:
- `client_id` must exist.
- There must be at least one line.
- `description` must not be empty and must be ≤ 1000 characters.
- `quantity` must be > 0 and allowed by the unit (at most 2 decimals).
- `amount` must be > 0 with at most 4 decimals.
- `product_id`, if given, must exist.
- `indicador_facturacion` must be 1–4.
- The ajustes rules from 6.2 apply.

A formato mismatch gets **409** (5.2).

**Server-side behavior:**
- `user_id` comes from the token.
- `sent_email` and `total` are ignored.

**Responses (Ferretería):**
- Create and PUT return `{status:true, data:{id, code, numero, total}}`.
- Preview returns `{status:true, data:{filename, content, mime_type}}`, as today.
- GET (list and `?id=`) returns rows that also carry:
  - `formato`, `numero` (int), and `subtotal` / `itbis` as DECIMAL strings or null;
  - `ajustes`, always a JSON object keyed by concepto, with DECIMAL-string amounts. `retencion_isr` is the
    stored amount, a missing key means 0, and Gratex rows have `{}`.
  - On each item: `product_id`, `unidad_medida`, `indicador_facturacion`, `indicador_bien_servicio` and
    `itbis_amount`. These are null on Gratex lines.

## 7. Ferretería PDF (`FerreteriaCotizacionPdf`)

**It's a pure renderer:**
- Constructor: `__construct(array $cotizacion, array $emisor, array $cliente, ?string $logoPath)`. The
  quote comes with its items, its totals as computed in 6.2, and its ajustes.
- It never touches `Database`, `TenantResolver` or `BrandingResolver`.
- It requires `Pdf/libs.php` for FPDF.

**What `FerreteriaFormato::pdf/preview` passes in:**
- `EmisorConfigModel::get()`;
- the client row (`razon_social`, `company_name`, `client_name`, `rnc`);
- `BrandingResolver::logoPath()`.

**Page and fonts:** FPDF, Letter portrait, in mm. The Times core font only, with text converted to
ISO-8859-1.

**From top to bottom:**

1. **Logo**, centered, in a box about 75×28 mm that keeps its aspect ratio. With no logo, `razon_social`
   is printed in bold 16.
2. **`direccion`**, centered, in Times 10. It wraps to at most 2 lines.
3. **`RNC <emisor rnc formatted>`**, aligned left.
4. **`COTIZACIÓN MERCANCÍAS`**, centered, in Times bold 14.
5. **Left block** in Times bold 10:
   - the date as `SEPTIEMBRE 2/2026.-`, with the month in Spanish capitals;
   - the `code`, or `VISTA PREVIA` in a preview without id;
   - `NOMBRE O RAZÓN SOCIAL`;
   - the client name: `razon_social`, else `company_name`, else `client_name`;
   - the client's RNC or cédula, formatted.
6. **Table:** `Cantidad | Descripción mercancías | Valor Unitario | Valor Total RD$`.
   - The header band is #BDD7EE with black text, and every cell has a thin border.
   - Each row is as tall as its tallest wrapped cell (the usual FPDF `NbLines` row).
   - Quantity shows 2 decimals.
   - **Valor Unitario** uses `EcfDocumento::textoPrecio`: 2 decimals, or up to 4 when the price has them,
     so 3 × 84.7458 prints as 84.7458 | 254.24.
   - Valor Total and every totals row use `number_format(x, 2)`.
7. **Marker row** `***********No hay más productos debajo de la línea*****` right after the last item. It
   always stays on the same page as the last item.
8. **Totals,** in the order of 6.2. Only rows with a value print. Sub-total, ITBIS and TOTAL always print,
   and Restante follows the rule in 6.2.
   - The label sits under the description column, in Times bold.
   - The value sits under the last column, filled #BDD7EE.
   - TOTAL is bold.
9. **`Recibido por:`** with a signature line.
10. **Footer**, centered, flowing after "Recibido por" (it is not FPDF's per-page `Footer()`):
    - `razon_social`, the legal name. The old mapping `razon_social => nombre_comercial` is not copied.
    - `correo`, in blue and underlined.
    - `Teléfono <telefono>`.
    - Each part prints only when it has a value.

**Page breaks:**
- Before a row is drawn, if it doesn't fit above the bottom margin, the PDF calls `AddPage()`. The table
  header repeats only on pages that continue item rows.
- The block made of totals + "Recibido por" + footer is never split. If it doesn't fit, it moves whole to
  a new page **without** a table header.
- `Página X de Y` (`AliasNbPages`) prints in the bottom margin from FPDF `Footer()`, only when the
  document has more than one page. Two passes: render, count the pages, render again.
- A description is at most 1000 characters (6.5), so a single row always fits on a page.

**What it doesn't print:** bank account, seal, signature pair, proforma disclaimer, ITBIS per line, unit.

**RNC formatting**, on digits only:
- 9 digits → `XXX-XXXXX-X` (`401-51513-1`);
- 11 digits → `XXX-XXXXXXX-X`;
- anything else as stored.

## 8. Frontend

### 8.1 `FerreteriaCotizacionForm`

It has the same paper look (`fx-sheet`) as the other document forms.

- **Header:**
  - the logo (`branding.logo_data_uri`) and the emisor;
  - the title "Cotización mercancías";
  - the number, or "Se asigna al guardar" before the first save.
- **Client:**
  - `ClientCombobox` + `NombreClienteLibre` (a typed name is saved as a client, as in factura simple) +
    the `+` button for `NewClientModal`.
  - The client's RNC shows under the name.
  - A client is required, because the API needs `client_id`.
- **Date:**
  - A date input that defaults to `hoyLocal()`.
  - **On create** it sends `` `${fecha} ${hora}` `` with the current local time from `ahoraLocal()`.
  - **On edit** the input loads `String(row.date).slice(0, 10)`. `date` is sent only if the user changed
    the day, and then with the current time. Otherwise it's left out, so the stored datetime is kept.
- **Lines grid** (new modifier `.fx-grid-cot-fer`):

  | Cant. | Unidad | Descripción | Precio | ITBIS | Valor total |
  |---|---|---|---|---|---|

  - **Product search on the server:** through `ProductoCombobox`, with a new prop to show the sale price.
    It shows Costo by default, which `GastoFormModal` keeps.
  - **Picking a product fills in** `product_id`, the description (the product name), the price without
    ITBIS (`p.precio`), the unit, the ITBIS indicator (`indFactFromItbis`, now shared) and bien/servicio
    (`p.tipo`).
  - **"Línea libre"** adds a line with no product: indicator 1, unit 43, Bien.
  - **Quantity:** the step and decimals follow the unit (`admiteDecimales` / `problemaCantidad`).
  - **Display:** prices use `fmtPrecio`, line totals use `fmt`.
- **Totals panel:** Sub-total, ITBIS, a collapsible **"Cargos y abonos"** group, TOTAL RD$, then Restante
  (rule in 6.2).
  - The group holds Cargos bancarios, Manejos de operaciones bancarias, Costo mano de obra, a ☐ Retención
    Renta 5% checkbox and Abono realizado.
  - The group opens automatically when it has values.
  - On edit the retención box is checked when `aNumero(ajustes.retencion_isr) > 0`. The form always sends
    a boolean.
- **Actions:**
  - Vista previa sends `id` when editing.
  - Guardar uses `useAccionUnica`.
  - Eliminar asks for an inline confirmation when editing.
  - There's **no email switch**.
  - `useAvisoSalida` warns before leaving with unsaved changes.
- **Validation:**
  - `ferreteria/schema.ts` (Zod), with per-line errors as in `factura.schema.ts`.
  - The server's 422 messages are shown as they come.
  - A 409 shows its message with a "Recargar" action.

### 8.2 List

- **Columns for a tenant on `ferreteria`:** Número (`code`) | Cliente | Fecha | Total.
- **Gratex columns:** unchanged.
- **Row actions on a `ferreteria` row:** PDF, and **Facturar ▾** with "Factura electrónica (e-CF)" /
  "Factura simple".
  - Each option shows only if `puedeVerVista(user, 'factura-nueva')` / `puedeVerVista(user,
    'factura-simple-nueva')` allows it. If neither does, the row has no Facturar control.
- **Row actions on a Gratex row:** the single "Facturar" button it has today.

### 8.3 Facturar (conversion)

**Shared rules for both targets:**
- **Client discount:** the client's fixed discount (`clients.descuento`) is **applied**, exactly as today.
  When `descuento > 0`, the target form adds this line to its banner: "Se aplicó el descuento fijo del
  cliente (X%): el total difiere del de la cotización."
- **Extra charges are not copied as lines.** When the quote has mano de obra or bank charges, the prefill
  adds this aviso: "La cotización COT-000012 tenía cargos adicionales: Costo mano de obra RD$ 1,500.00 —
  agrégalos como línea si corresponde."
- **Retención and abono are not copied.** Payment is recorded on the factura.

**`FacturaPrefill`** (`src/types/domain.ts`) gains optional fields:
- `precioConItbis?: boolean` and `avisos?: string[]` on the prefill;
- `prodId?: string`, `unidadMedida?: number`, `indFact?: number` and `tipoItem?: 'Bien' | 'Servicio'` on
  each line.

The Gratex prefill sends none of these.

**`InvoiceFormView`:**
- The switch starts as **`useState(prefill != null && (prefill.precioConItbis ?? true))`**:
  - a blank Nueva factura stays **off**, as today;
  - a Gratex prefill (field missing) starts on, as today;
  - a Ferretería prefill sends `false`.
- Prefilled lines use `prodId`, `unidadMedida`, `indFact` and `tipoItem` when present. Otherwise they use
  today's defaults (`''`, 43, 1, `'Bien'`).
- **Banner.** It keeps its exact text when `prefill.precioConItbis !== false`. Otherwise it reads
  "Convertida desde la cotización X · los precios no incluyen ITBIS (se suma encima)". Each entry of
  `prefill.avisos`, plus the discount line, renders as its own line under it.

**Ferretería → e-CF:**
- `precioConItbis: false`.
- Lines are linked to their product, so issuing the e-CF reduces inventory.
- Units, ITBIS indicators and bien/servicio are copied.
- The user picks the e-CF type among those the form offers today (31 Crédito Fiscal, 32 Consumo, …).
  Offering E45 Gubernamental is out of scope (section 11).

**Ferretería → factura simple:**
- New type in `src/types/domain.ts`:
  ```ts
  interface FacturaSimplePrefill {
    kind: 'factura-simple-prefill'
    clienteId: string; clienteNombre: string; origen: string
    avisos?: string[]
    lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
  }
  ```
  `isFacturaSimplePrefill` goes in `navigation.ts`, and the type joins the `NavPayload` union.
- **App** passes the prefill only to `factura-simple-nueva`.
- **`SimpleInvoiceFormView`** gets an optional `prefill` prop and uses it only when `facturaId == null`:
  - as the initial `lineas`;
  - as a placeholder `cliente`, filled in with the full client through
    `useApiQuery(['clients','detail',id])`, as InvoiceFormView does. That path applies the client's
    discount exactly the way `seleccionarCliente` does.
  - `original` stays null, so the edit-mode snapshot logic stays inactive.
  - A banner with `origen`, `avisos` and the discount line goes in the top row.
- **Prices:** each line's `precio = r4(amount × (1 + tasa))`. Example: 7 × 2,000 at 18% → 7 × 2,360.0000 =
  16,520.00. Unit strings coming from the API go through `Number()`.

## 9. Testing

### 9.1 Gratex must not regress

- **Files not edited by this work:** `CotizacionPdfGenerator.php`, `CotizacionFormView.tsx`, and the legacy
  `saveCotizacion` / `updateCotizacion` / `sendCotizacionPdfEmail`. This is checked with
  `git diff --stat` against the branch base.
- **Deliberate Gratex differences** (each one only adds something or fixes an edge case):
  - extra keys in the GET responses;
  - list ties ordered by id;
  - the editor shows a loading state before the form;
  - "Esta cotización ya no existe" for a deleted id, where today it showed an empty sheet;
  - a clean remount when going from one quote to a new one.
- **HTTP regression checks.** Run them against a local Gratex-shaped DB (XAMPP: build it from
  `tenant_schema.sql` plus sample rows), both before and after the change:
  1. **Reads:** diff the JSON of `GET /api/cotizaciones?page=1`, `GET ?id=<x>` and
     `GET /<x>/pdf?format=base64`. Only the additive keys may differ. Compare the PDFs after stripping
     `/CreationDate`.
  2. **Writes:** POST, PUT and preview with the exact bodies `CotizacionFormView` sends must return the
     same HTTP status, envelope and data, including the 200/`status:false` errors for header fields.
  3. **Before 026:** the same reads work with the new code against a DB **without** 026.
- **Facturas:**
  - a blank Nueva factura starts with the ITBIS switch **off**;
  - a Gratex Facturar starts with it **on**, showing the old banner text.

### 9.2 Backend (no test framework; repo practice)

- **`tools/test_cotizacion_ferreteria.php`** is a CLI script with no DB. It calls
  `BrandingResolver::sinMarcaGlobal()`, as `tools/ri_desde_xml.php` does. It asserts:
  - `FerreteriaFormato::totales` on the fixtures in 6.2: the 3 sheets, retención/abono, 84.75, and the
    float edge case;
  - `Redondeo` against the montosLinea algorithm;
  - the code format;
  - `validarForma`, with an injected `permiteDecimales` fixture map.
- **`--pdf [--grid]`** renders the 3 sheets with `FerreteriaCotizacionPdf`, plus a 60-line fixture to
  exercise page breaks.
- **Fixtures** in `tools/fixtures/`:
  - `cotizacion_ferreteria.json`: every line (cantidad, descripción, valor unitario) of the 3 sheets,
    copied from the workbook, plus the client and date shown on each, the expected totals, and fixture
    emisor and client arrays;
  - `ferreteria_logo.jpeg`, extracted from `xl/media/image1.jpeg`.
- **`php -l`** on every touched file.
- **Snapshot check:** apply `tenant_schema.sql` to an empty local DB, or run `tools/create_tenant.php`
  against local, and confirm that every table and FK exists.
- **Migration check:** run 026 twice on a DB built from the *old* snapshot. The second run must change
  nothing.
- **`tests/test_cotizaciones_ferreteria.http`** for checking the API by hand on the server.

### 9.3 Frontend

- **Gates:** `npm run typecheck`, `npm run lint`, `npm run build`.
- **Parity:** `scripts/parity-cotizacion-ferreteria.ts`, run with `node` (v25 strips types; it imports
  `totales.ts` by relative path with its extension). It runs `totalesFerreteria()` on a copy of the
  backend fixture JSON and checks the same expected values.
- **Browser check against a local mock API only, never production.** Run vite with `API_PROXY_TARGET`
  pointing at a small Node mock (`API_KEY=''`), with a seeded fake session and a ~1280px viewport. Check:
  - the Gratex list and form, unchanged;
  - Ferretería end to end: new quote → product and free lines → extras → preview → save → list → edit
    (date and number kept, retención box restored) → Facturar to e-CF (`precioConItbis` off, product
    links, avisos, discount line) and to simple (ITBIS-included prices, banner);
  - the 409 mismatch message;
  - the mobile layout.

### 9.4 Documentation (updated in the same change, per repo practice)

- **api-gratex:**
  - new `docs/api/cotizaciones.md`, covering every endpoint and both formatos' request and response
    shapes;
  - new `docs/modules/cotizaciones-formatos.md`, covering the architecture and how to add a formato for a
    new tenant, step by step;
  - `docs/database/schema.md`;
  - the `db/migrations/README.md` range;
  - the `docs/README.md` map;
  - the onboarding runbook (`docs/integrations/alta-tenant-runbook.md`): set `cotizacion_formato` and
    fill in `emisor_config.telefono` and `correo`.
- **fiscalo:**
  - `docs/plantillas-factura.md`, a short note that the cotización body now comes from the formato and not
    from the factura template.

## 10. Rollout

1. **The user confirms the production facts:**
   - `SHOW CREATE TABLE` for `cotizaciones`, `cotizacion_items` and `products` on both tenant databases:
     engine, `id` types, the `client_name` definition, and whether `user_id`/`updated_at` exist.
   - `SELECT COUNT(*) FROM cotizaciones` on Ferretería's DB (expected 0).
   - Ferretería's `tenants.id`, `pdf_template` and `logo_path`.
   - That 025 has been applied.
   - That Ferretería's roles include the `cotizaciones` module.
   - Ferretería's `emisor_config`: `telefono`, `correo`, `razon_social` = `FERREHERRAMIENTAS VENTURA, SRL`,
     and a `direccion` that fits in two lines.
2. **Prevent Gratex-format Ferretería quotes in the meantime.** Remove the `cotizaciones` module from
   Ferretería's roles before running 026, and restore it after step 5. Without that, 026 lets Ferretería
   save Gratex-format quotes, with Gratex's bank account, until the switch.
3. **Run the migrations off-hours:** master `011` once, then tenant `026` on each tenant DB. Each must be
   fully applied before the code goes up.
4. **Deploy api-gratex, then fiscalo.**
   - The backend defaults to `gratex`.
   - The frontend uses `gratex` when branding loaded without the field.
   - Tabs still open get the 409 until they reload.
5. **Switch Ferretería on:** `UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <id>;`.
6. **Smoke tests.**
   - (a) As Ferretería: create a quote, compare its PDF with the sheet, then Facturar into e-CF (without
     issuing) and into factura simple.
   - (b) As Gratex: list, open, edit and save, preview, PDF, and Facturar (prefill unchanged, switch on).
   - Then restore the module from step 2.

**Rollback:**
- **Setting the column back to `'gratex'`** makes new Ferretería quotes use the Gratex PDF (with Gratex's
  bank account), and those quotes stay that way. So whenever this rollback is used, also remove the
  `cotizaciones` module from Ferretería's roles until the formato is fixed. Quotes already saved keep
  `formato = 'ferreteria'`.
- **Rolling back the api-gratex code** is not supported once any `formato = 'ferreteria'` row exists. The
  old code would print those rows with the Gratex generator and strip their product links on edit. If it
  becomes unavoidable, remove the module from Ferretería's roles first.

## 11. Out of scope (separate tasks)

- **The Ferretería email switch.** The tenant-aware email (`TenantMail`) is being added by another session;
  enabling the switch for Ferretería afterwards is a small follow-up.
- **Offering E45 Gubernamental in InvoiceFormView** (it affects both tenants; the backend supports 45).
- A quote status ("facturada") or a link from the factura back to its quote.
- A settings screen for choosing the formato.
- A cotización preview in `/api/branding/preview` and `plantillas.php`.
- `custom:ferreventura` failing the `custom:tenant<id>` checks in `PUT /api/branding`.
- The N+1 queries in the cotización list.

## 12. Risks

- **The production DDL differs from the snapshot.** Covered by 026's step 0, the dynamic types and the
  `MODIFY` that keeps everything except nullability, and the user's check in rollout step 1.
- **Other sessions are editing these files right now:** `cotizacionModel.php`,
  `CotizacionPdfGenerator.php`, `navigation.ts` and `TenantMail.php`. Their work is committed before the
  branch is created, so this feature builds on a known base.
- **Rounding differs between PHP versions.** Covered by the `Redondeo` helper and the shared fixtures.
- **Factura-simple prices with ITBIS folded in** differ from the quote's TOTAL by a few cents. This is
  accepted.

## 13. Implementation notes (from planning, 2026-10-02)

These supersede the earlier text where they differ:

- **`validarForma` signature.** It is
  `FerreteriaFormato::validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array`.
  It returns `['ok' => true, 'cot' => …]` or `['ok' => false, 'error' => …]`. Production passes
  `unidadMedidaModel::problemaCantidad` and `::isValid`, and the CLI test passes fakes.
- **Descriptions.**
  - The Ferretería form already collapses line breaks.
  - `FerreteriaFormato::limpiarDescripcion()` also turns runs of control characters (and U+2028/U+2029) into
    one space, both in validation and in the PDF, so a row can no longer outgrow a page.
  - Characters outside ISO-8859-1 print as `?`, as in every other FPDF document in the repo.
- **Price input.** The Precio column in the Ferretería form is a numeric input. `fmtPrecio` is used where
  prices are displayed (catalog search, read-only totals).
- **Lint gate.** `npx eslint src scripts` replaces `npm run lint`, which already fails on the vendored
  `ds-bundle/`.
- **No local database (user decision).**
  - The §9.1 before/after HTTP checks on a local DB are replaced by an old-vs-new controller comparison over
    fake models (Task 6) and an offline snapshot-order checker (Task 2).
  - The migrations and `tests/test_cotizaciones_ferreteria.http` are run by the user on a server before
    go-live. That covers numbering under concurrency, 026 run twice on dumps of both tenant DBs, page breaks
    and the Gratex legacy save.
- **Client messages.** A missing, nonexistent or deleted client all answer 422 "Elige un cliente para la
  cotización.", including when an existing quote's client was deleted.
- **Known limits, accepted:**
  - When the retención rounds to 0.00 (Sub-total under RD$0.10), nothing is stored, so the box reloads
    unchecked.
  - A stored date that is NULL or zero, which only legacy rows have, makes the edit form ask for a date
    before saving.

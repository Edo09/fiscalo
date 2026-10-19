# Stock control on sales (facturas and facturas simples) — design

- **Date:** 2026-10-19
- **Repos:** `fiscalo` (React frontend, `main` at 5d5c9d0) and `api-gratex` (PHP backend, `master` at 1852035).
- **Builds on:** the e-CF write-ahead and the inventory ledger (`inventoryModel::aplicarMovimientos`), both already in production.
- **Status:**
  - Requirements agreed with the user in chat (see section 2). Facts in section 4 were verified in code by a 6-reader survey plus a critic that re-read the code.
  - Builder check done (an API reader and a front-end reader, 2026-10-19): their questions are folded in as C13–C20 below, and the one question left for the user is answered (section 9).
  - Approved by the user (2026-10-19) and **implemented** in two uncommitted worktrees, `feat/control-existencias` in both repos (`.claude/worktrees/control-existencias`). Verified by the no-DB suites, a 142-check suite against the scratch databases, a browser check against a local mock API, and an independent six-lens review whose confirmed findings were fixed.
  - Differences between this document and the build, all deliberate: the factura simple callback runs **before** the lines are inserted (so an unknown `product_id` gets the plain 422 instead of a foreign-key error); `aplicarMovimientos` locks the distinct products in ascending order up front but still writes the lines in their original order (so the kardex is unchanged); `verificarVentaEcf` rebuilds the lines as `product_id` + `cantidad` before checking; the product form still sends `stock` on edit and the API ignores it.
  - Not done on purpose: nothing is committed, pushed or merged, and nothing was written to production (migration 013 and the switch for tenant 02 wait for the user's go-ahead, section 9).
  - Two production facts are **not verified** because the production read was refused by the harness: that tenant id 2 is Ferretería (the docs say its DB is `smhynzte_002`), and how many of its products have no or zero stock. See section 9.

## 1. Goal

Today the system tolerates selling without stock: nothing compares the quantity sold with the stock, and the stock simply goes negative. The user wants the **system's stock number to be the truth**: when a company turns the rule on, a factura or factura simple that asks for more than the system says is available is refused, and the way out is the existing «Ajuste de Inventario».

### Success criteria

- **Switch on:** saving an e-CF factura or a factura simple is refused when any stocked product line asks for more than the system's stock. A stock of 0 refuses any quantity. Exactly equal passes.
- **The API decides:** the refusal happens in the API, so a raw API request cannot get around it. The forms warn earlier, but the API has the last word.
- **A clear message with a way out:** the refusal names each product, the quantity asked and the quantity available. It carries a button that opens «Ajuste de inventario» with the missing quantities already filled in.
- **Switch off:** everything behaves **exactly as today**: no check, no new refusal, the product form edits stock as before, negative stock is allowed. This is the default for every company.
- **Admins choose:** an admin turns the rule on or off in Configuración, for their own company.
- **Ferretería (tenant 02) is switched on** when this ships, after the user's go-ahead (section 9). Every other company stays off.
- **Stock stays consistent:** a sale moves stock the way it does today. Cancelling a factura simple and issuing a credit note put the stock back (already the case, section 4).
- **Look and feel:** same components, same classes, same Spanish tone as the rest of the app.

### Non-goals

- The **POS**: untouched. The user said to ignore it. It keeps its documented sell-at-zero behaviour.
- **Conduces and cotizaciones**: never move or check stock (the user named only facturación and facturación simple).
- **Purchases (gastos)** and supplier credit notes (E34 in `gastos`).
- **Per-warehouse balances**: stock is one number per product today. See 5.8.
- **Unit conversion**, an "absolute count" mode in Ajuste, blocking `DISMINUCION` below zero in Ajuste, reserving stock for e-CF rows still in flight, retry idempotency for `POST /api/facturas`.
- **Returning to the sale after adjusting** (rehydrating the invoice form): a follow-up.

### Anti-goals (failures even if the feature "works")

- A refusal after the e-NCF was dispensed, which can leave a gap in the fiscal sequence.
- Blocking «Reenviar a la DGII» for goods already sold.
- Any change in behaviour for a company with the switch off.
- A block that depends on stale browser data.

## 2. Decisions

### The user's decisions (in chat, 2026-10-19)

| Topic | Decision |
|---|---|
| Source of truth | The system's stock number rules over everything; physical count does not matter. |
| Which documents | Facturación (e-CF) and facturación simple only. POS, conduces and cotizaciones are out. |
| Returns | A cancelled invoice and a credit note put the products back into stock. |
| Warehouses | One today; build expecting more than one. |
| Configurable | Admins choose in Configuración whether to block or to sell no matter what. |
| Negative stock | With the rule off, stock may go below zero (as today). |
| Default | Off for new and existing companies. Only Ferretería (tenant 02) on now. |

### Calls made while writing this (the user can change any of them)

| # | Call | Why |
|---|---|---|
| C1 | The check is one read-only function called **before** any side effect (before the e-NCF is dispensed, before the factura simple is saved). The decrement stays where it is. | A rejection after the e-NCF is dispensed can burn a number (`ncfModel::rollbackECFSequence` is a conditional UPDATE). Keeps the write-ahead rules and the pinned tests intact. |
| C2 | For **facturas simples** with the rule on, the check and the decrement happen **atomically inside the invoice's own transaction**. For e-CF the pre-check is the only guard. | Simples have no external call, so atomicity is cheap and Ferretería uses them. For e-CF, the window between check and decrement is the DGII round trip (up to 30 s). That residual race is accepted and logged (5.3). |
| C3 | Stock `NULL` on a Bien counts as **0**. | Matches the ledger (`$prod['stock'] ?? 0`) and the user's "0 quantity". Consequence: a product with a blank Existencia cannot be sold until an Ajuste adds stock. |
| C4 | Services (`indicador_bien_servicio = 2`), lines without a product, and entries (E34, E41) are never checked. Check set = decrement set. | Parity with `registrarVenta`, so "blocks" and "decrements" cannot drift. |
| C5 | «Reenviar a la DGII» of a rejected e-CF is **exempt** from the check. | It is a fiscal obligation for goods already sold. |
| C6 | The setting is a column on `master.tenants`, read through `TenantResolver::current()`, written by an admin-only endpoint. | Same pattern as `pos_enabled`, `cotizacion_formato` and the branding PUT. No tenant-DB migration, so no deploy gate across tenants. |
| C7 | With the rule on, **typing** a stock number in the product form stops working: Existencia becomes read-only on edit and the API ignores `stock` on `PUT /api/products`; an opening quantity on `POST` goes through the ledger. Stock comes in through Ajuste, or through a registered purchase in Compras exactly as today (purchases are not touched). | The user's rule 2. Today the product form writes `products.stock` directly with no ledger row, which would make the block meaningless. |
| C8 | Ajuste gets two new motives, `ENTRADA` («Entrada de mercancía») and `INVENTARIO_INICIAL`. | Today the only motives that add stock are semantically wrong for a purchase or an opening balance. `motivo` is VARCHAR(20), no migration. |
| C9 | The quick link goes to Ajuste with the missing lines pre-filled. It does not return to the sale. The e-CF form gets a leave guard. | Smallest change that satisfies "quick navigation". Returning needs a form-state builder in two large forms. |
| C10 | The forms show existencia and an inline warning when a line exceeds it, but the submit button is **not** disabled by the client's number. | The browser's stock can be up to 3 minutes old. The API is the authority. |
| C11 | Who sees the link: anyone who can open the Ajuste view. Others see text asking an administrator. No override and no new permission module. | An override reintroduces overselling. |
| C12 | Blocked attempts are written to the audit log as a failed attempt under the existing vocabulary. Turning the switch on or off is audited too. | Measurable, cheap, `AuditLogger` never throws. |
| C13 | In a factura simple `PUT`, `solicitado` is the new total for the product, `disponible = stock + what the invoice already took` (its saved lines, the same quantities `revertirVenta` reverses today), and `faltante = solicitado − disponible`. | An edit that raises 3 to 5 with stock 1 is short by 1, not 4, so the Ajuste prefill is not overstated. The saved-lines credit has the same pre-existing limit as today's revert (an invoice that never moved stock still returns stock); not changed. |
| C14 | The new leave guard on `InvoiceFormView` is active **only when the rule is on**, and is released right after a successful emission. | A company with the rule off must see no change, and a good emit must not trigger «¿Salir sin guardar?». |
| C15 | E33 (nota de débito), E43 and E47 are checked like any other type that decrements today. The only types never checked are E34 and E41. | One simple rule, "check = decrement", with no exemption list. If a debit note is ever refused, the way out is an Ajuste. |
| C16 | After the pre-filled Ajuste is saved or cancelled, the app goes to the Ajustes list as it does today. The `ajuste-prefill` payload carries only the lines. | Smallest change; return-to-sale is the follow-up. |
| C17 | A product id that does not exist, and a quantity ≤ 0 on a product line, are refused with their own plain 422 message and **no** `faltantes`, never with `STOCK_INSUFICIENTE`. | They are not stock shortfalls, and the front builds an Ajuste prefill only from shortfall rows, which all name a real product. |
| C18 | With the rule on, a Bien with stock NULL shows as 0 and «Agotado» in the pickers and in Productos, where today it shows «N/A» and «Disponible». The settings count is a number only; a filter on Productos is deferred. | The screens must agree with what the block does. |
| C19 | Purchases in Gastos (E31/E41/E47 with product lines) keep adding stock as today, and a supplier E34 in Gastos keeps subtracting unchecked. Neither is touched. | Not a sale. The hole is known: such a return can push stock below zero and later sales are refused until an Ajuste. |
| C20 | The atomic path of C2 runs on the **same database connection** as the invoice's own transaction: `inventoryModel`'s constructor accepts an optional PDO (default unchanged) and `facturaModel`/`productModel` build the inventory model from their own connection. | Verified: `facturaSimpleController` builds `facturaModel` (line 33) before `validateRequest()`, whose tenant resolution resets the `Database` singleton, so a later `new inventoryModel()` opens a different connection. On that one `ownTransaction = false` means autocommit: the lock is released at once and a rolled-back invoice would not undo the decrement. |

## 3. How it works today (verified)

Paths are relative to each repo. All claims below were confirmed by reading the code.

- **Stock model.** `products.stock DECIMAL(15,3) NULL`, signed, no CHECK, one global balance per product (`db/tenant_schema.sql:120`). Each product has exactly one `warehouse_id`. There is no "tracks inventory" flag; Bien/Servicio is `indicador_bien_servicio` 1/2. The ledger is `inventory_movements` (signed quantity, before/after snapshot) with `inventory_adjustments` as headers.
- **The only ledger writer** is `inventoryModel::aplicarMovimientos` (`src/Models/inventoryModel.php:52-165`): `SELECT … FOR UPDATE` per product, delta computed in PHP, absolute `UPDATE`. It has **no floor**: negative stock is tolerated by documented decision (`:112-114`, `docs/modules/inventario.md:164-169`, `docs/specs/pos.md` decision 7).
- **e-CF factura** (`POST /api/facturas`): `emitirFacturaEcf` has no stock logic. Stock moves **after the DGII verdict** (`moverStockFacturaEcf`, `facturaController.php:709-726`), skipped for rows still in flight and for rejected rows, guarded by `yaMovioDocumento`. A row left in flight moves its stock the first time `GET /api/facturas/{id}/estado` sees it accepted. So an e-CF does **not** reduce stock "when it is saved"; it does it when the DGII answers.
- **Factura simple:** `createFacturaSimple` commits, then `registrarVenta` runs, unguarded (`facturaSimpleController.php:435-444`). `PUT` is revert plus register in three transactions. `DELETE` reverts.
- **Which e-CF types decrement** (`inventoryModel.php:192`): all except E34 and E41, which are entries. The e-CF form only offers 31/32/44/45/46 plus notes, but the API accepts 31/32/33/34/41/43/44/45/46/47.
- **Returns already work:** E34 (credit note) adds stock; factura simple `DELETE` reverts. e-CF has no `PUT`/`DELETE` (405). A credit note is not linked to the original invoice's lines, so any credit note adds whatever quantity its own lines carry. Not changed here.
- **The POS** reads no stock, merges repeated products, and decrements at delivery for any DGII outcome. Conduces and cotizaciones never touch stock; their conversions to a factura are front-end prefills that resend `product_id`.
- **Frontend:** no router; `nav(view, payload)` is in memory (`src/App.tsx`, `src/config/navigation.ts`). `ajuste-nuevo` receives only `nav`: no prefill, hard-coded return to `ajustes`. `ApiError.codigo` is never filled from the server; `ApiError.datos` (the response `data`) survives message replacement by the humanizer, so the form builds its own sentence from `datos`. Neither factura form invalidates the `['products']` cache (3 min) after a sale.
- **Settings:** `SettingsView.tsx` has a left menu (`todasSecs`). Per-company flags live on `master.tenants` and reach the front through `GET /api/branding` (`pos_enabled`); the branding `PUT` already writes `master.tenants` from the app (`MasterDatabase::updateTenantBranding`). The audit view is admin-only by role name (`auditLogController.php:26`).

## 4. Design

### 4.1 The setting

- **Storage:** `master.tenants.inventario_estricto TINYINT(1) NOT NULL DEFAULT 0`. New master migration (013 is reserved by the untracked ITBIS plan; take the next free number after a `git fetch`). Mirror in `db/master_schema.sql` and `tools/verificar_migraciones_master.sql`.
- **Read:** `(int) (TenantResolver::current()['inventario_estricto'] ?? 0) === 1`, only for tenants of type `app`. A missing column reads as off, so the API can be deployed before the migration without breaking anything.
- **API:**
  - `GET /api/inventario/configuracion` returns `{ bloquear_sin_existencia: bool, productos_sin_existencia: int }`. The count is bienes, active, with stock NULL or ≤ 0, so the admin sees the effect before switching on.
  - `PUT /api/inventario/configuracion` with `{ bloquear_sin_existencia: bool }`. **Admin only**: the same role test as the audit view, enforced even in shadow mode. Tenant from the token. Audited.
  - `GET /api/branding` also returns `inventario_estricto` (like `pos_enabled`), so the front reads it from a query it already runs. Single-tenant installs and `integracion` tenants never get the rule.
- **Front:** a new «Inventario» section in Configuración, shown to admins only. One switch, «Bloquear ventas sin existencia», with a sentence explaining what happens and the count of products without stock. A `useInventarioEstricto()` hook modelled on `usePosActivo`.

### 4.2 The check

One new public function in `inventoryModel`: `verificarDisponibilidad(array $items, ?string $tipoEcf): array`, on top of a pure static core that is testable without a database.

- Read-only. Accepts `quantity` or `cantidad`.
- Skips lines without `product_id`, entries (`esEntrada()` extracted from `registrarVenta` so both use the same test) and catalog services.
- **Sums per `product_id` before comparing** (the same product on two lines).
- Compares in **integer thousandths**, never floats. Stock `NULL` counts as 0.
- No credit option is needed for the factura simple `PUT`: its atomic path (4.3) first reverts the invoice's old lines inside the same transaction and then checks the new ones, so the balance already includes what the invoice held (C13).
- A `product_id` that does not exist or is not a product is refused with a clear plain 422 instead of the FK error that today surfaces as a generic 502. A quantity ≤ 0 on a product line is refused explicitly (C17).
- Returns success, or an error carrying the list of shortfalls sorted by `product_id`.
- The thousandths arithmetic and the "how much is available for product X" rule live in a few private helpers of `inventoryModel` (`milesimas`, `disponibleEnMilesimas`, `filaFaltante`), so per-warehouse balances later change those helpers, not the callers.
- `aplicarMovimientos` locks lines **sorted by `product_id`** (stable) to remove the lock-order deadlock that today is swallowed into "sale with no movement". This is behaviour-neutral when nothing deadlocks.

### 4.3 Where it is called

Only when the company's switch is on:

- **e-CF**: `facturaController::emitirFacturaEcf`, after quantity normalization and the totals guard, **before** the payload is built and before `->emitir(`. It runs even with `strict_input`. Skipped when it is a resend (`$reenvioDe !== null`) and for entry types. Keep exactly one `->emitir(` and leave `moverStockFacturaEcf` untouched (pinned by `tools/test_write_ahead_puro.php`).
- **Factura simple `POST`**: the check and the decrement run atomically **inside** `createFacturaSimple`'s transaction (callback hook, lazy so tests that build the model without a constructor still work), on the model's own connection (C20). If short, the invoice is not saved. The post-commit `registrarVenta` is skipped on this path so stock is not decremented twice.
- **Factura simple `PUT`** (only when `items` is present): same transaction: the invoice's saved lines are reverted first, then the new lines are checked and applied, so only the **net increase** can be refused. A `PUT` without items moves nothing. `DELETE` is unchanged.
- **Residual race on e-CF:** two sales of the last unit within the same DGII round trip can both pass. When a sale movement leaves stock below zero with the rule on, log `[inventario] SOBREVENTA` so the incidence is measurable. Holding stock at reservation time is deliberately deferred: it reverses the "rows in flight move nothing" rule, needs release hooks in five places and can burn an e-NCF.
- **In-flight e-CF rows** (pending or uncertain) hold no stock until the DGII answers, so a second sale cannot see them. Accepted and documented.

### 4.4 The error

For `/api/facturas` and `/api/facturas-simples`, HTTP **422** (409 means "screen out of date" in this app):

```json
{
  "status": false,
  "error": "No hay existencia suficiente de «Cemento gris»: pides 5 y hay 2.",
  "codigo": "STOCK_INSUFICIENTE",
  "data": { "faltantes": [
    { "product_id": 12, "nombre": "Cemento gris", "sku": "CEM-01", "unidad_medida": "Unidad",
      "solicitado": 5, "disponible": 2, "faltante": 3 } ] }
}
```

- All numbers are JSON numbers, not strings. `unidad_medida` is the code as stored in `products` (the front maps it to the name, and the Ajuste form needs the code to judge fractions). `disponible` is the balance **floored at 0** (the sentence never says «quedan -3»); `faltante = solicitado − (raw stock, NULL as 0, plus the credit of C13)`, so the Ajuste prefill brings the stock up to the sale quantity even when the balance is negative. Every row names a real product; the cases of C17 never appear in `faltantes`.
- A message for several products is one sentence per product, joined; the front ignores it and builds its own list from `faltantes`.
- The existing respond helpers cannot carry `data`; each sale controller gets one that does. `inventarioController` needs none: an Ajuste never refuses for stock.
- The front builds its own text from `data.faltantes` (the humanizer can replace the server sentence). `ApiError` starts reading `body.codigo` (the constructor already supports it).

### 4.5 Product form and Ajuste

- Rule on: `PUT /api/products` ignores `stock` silently (keeps the DB value; old front bundles keep working during an API-first deploy). `POST` with an opening quantity records it through `crearAjuste(..., false)` with motive `INVENTARIO_INICIAL`, in the same transaction. The product form shows Existencia read-only on edit with a hint pointing to Ajuste.
- Rule off: both unchanged.
- The offline `tools/import_productos_xlsx.php` and support SQL remain out-of-band ways to load stock. Documented, not changed.
- Ajuste: new motives `ENTRADA` and `INVENTARIO_INICIAL` in `inventoryModel::MOTIVOS` and `features/inventory/motivos.ts`.

### 4.6 App screens

- **Shared component** `AvisoExistencia` (card pattern of `EcfDashboardView`, `role="alert"`, danger-soft colours): lists each shortfall and a button «Ir a Ajuste de inventario». The button only shows when the user can open that view (`puedeVerVista`); otherwise a line says «Pide a un administrador que agregue existencia en Ajuste de inventario.»
- **Pure helper** module `features/inventory/existencia.ts`: reads the structured error, builds the text, and an advisory per-line check. Imports with relative `.ts` paths so Node can run its test.
- **Navigation:** a new `NavPayload` kind `ajuste-prefill` carrying `{ productId, cantidad }` lines. `AdjustmentFormView` seeds its lines from it (INCREMENTO, motive ENTRADA) by fetching each product with `getProduct`, and still goes to the Ajustes list when it ends (C16).
- **Both invoice forms:** catch the structured error before the generic toast, show `AvisoExistencia` above the totals, keep the form editable. Show existencia (and an «Agotado» badge) in the product pickers and an inline warning when a line exceeds it (rule on only). Invalidate `['products']` and `['inventario']` after a sale and after a refusal. Add `useAvisoSalida` to `InvoiceFormView`, active only when the rule is on and released right after a successful emission (C14), so following the link warns before discarding the lines. With the rule on, a Bien with stock NULL shows as 0 / «Agotado» in the pickers and in Productos (C18).
- **Style:** Spanish with accents, existing `Btn`, `Card`, `Badge`, `toast` (sonner).

## 5. Edge cases and how each is handled

| Case | Handling |
|---|---|
| Same product on several lines | Summed per product before comparing (per-line comparison would let 2 × 3 pass against 4). |
| Services, free-text lines, lines without `product_id` | Never checked. Documented limit: a raw API caller can omit `product_id` and sell without a check. |
| Bien with stock NULL (blank Existencia, «Guardar como producto» from an invoice line) | Counts as 0 (C3). The message and the prefill explain it. |
| Products already at 0 or negative in production | Unsellable on day one once the rule is on. The settings screen shows the count; ops reviews the list before enabling (section 9). |
| Decimal quantities (stock 3 decimals, lines 2–3) | Integer thousandths; exact equality passes. |
| Two cajas sell the last unit | Simples: atomic. e-CF: pre-check, residual window accepted, logged. |
| Lock-order deadlock | Lines locked in `product_id` order. |
| Reject after e-NCF dispensed | Prevented: the check runs before `->emitir(`. |
| Resend of a rejected e-CF | Exempt (C5). |
| Simple `PUT` that keeps or lowers a quantity | Net-increase check with the invoice's own quantity credited. |
| Entries and reversals (E34, E41, simple `DELETE`) | Never checked. |
| Raw API: `strict_input`, unknown product, quantity ≤ 0 | Check runs regardless of `strict_input`; clear messages. |
| Client stock stale | Client check is advisory (C10); the error carries the live `disponible`; caches invalidated. |
| User without the Ajuste permission | Text instead of button (C11). |
| Following the link loses the e-CF lines | Leave guard on `InvoiceFormView`; Ajuste is pre-filled; return-to-sale is a follow-up. |
| Company with the rule off, `integracion` tenants, unmigrated master | Off: no check, no change. `integracion` has no catalog. |
| POS sells the same product on a company with the rule on | POS may take stock to zero or below; facturas of that product are then refused until an Ajuste. Stated plainly in the setting's help text. |
| e-CF credit notes not linked to the original lines | Out of scope; noted in the docs. |

## 6. Deploy order

1. Master migration (adds the column with default 0; harmless alone).
2. API (inert until a company's flag is 1; reads degrade to off if the column is missing).
3. Front end.
4. Enable Ferretería (tenant 02) **last**, after reviewing its list of products without stock.

No tenant-DB migration is needed. Re-read `facturaModel.php`, `facturaSimpleController.php` and the simple-invoice form right before editing: the ITBIS-in-simples plan edits the same files and reserves migration numbers.

## 7. Testing and verification

- **No-DB PHP suite** `tools/test_inventario_stock.php` (fake PDO, like `test_write_ahead_puro.php` section 9): aggregation, thousandths, services, entries, `devuelve`, NULL, unknown product, ordering. Re-run `test_write_ahead_puro.php` and `check_tenant_schema_orden.php`.
- **Scratch-DB suite** (cloned from the POS and write-ahead suites): insufficient, exact, fractional, duplicate lines, simple `PUT` delta, a two-process race. Scratch DBs only, with the user's go-ahead; the credentials live in the `ecf-write-ahead` worktree's `tools/.env`, not in the main checkout. Never run `tools/test_facturas_simples.php`.
- **Front:** `npm run typecheck`, `npx eslint src scripts`, a Node test for `existencia.ts`, new cases in `scripts/check-errores.ts`.
- **Browser check** against a local mock API only (the dev proxy points at production).
- **Docs to change with the code** because they state the opposite today: `docs/modules/inventario.md`, `docs/api/inventario.md:115`, `docs/specs/pos.md` (decision 7, V3), `docs/integrations/pos-write-ahead.md`, the docblocks at `inventoryModel.php:112-114,179-181` and `productController.php:25-35`, the front comments in `ProductFormModal.tsx`, `AdjustmentFormView.tsx`, `InventoryValueView.tsx`, `CarritoPanel.tsx`.

## 8. Left to the builder

- The exact master migration number and file name.
- Naming of the helper functions and the callback shape in `createFacturaSimple`/`updateFacturaSimple`.
- Message wording within the examples above (Spanish, names in «», no "quedan -3", never the word DGII in the POS).
- Audit action names within the existing vocabulary.
- The order of the work, as long as the API lands before the front end.

## 9. Production steps and what is still unverified

- The user said production database changes are fine. The harness refused even a read-only run of the existing production tool, so nothing has been read or changed in production yet.
- **To verify, read-only:** that `tenants.id = 2` is Ferretería; how many Ferretería bienes have stock NULL or ≤ 0; whether catalog items such as shipping charges are flagged Bien instead of Servicio (they would be blocked).
- **Answered by the user (2026-10-19):** Ferretería's stock numbers are already loaded and correct. So no bulk-load or absolute-count work item is needed, and the plan has no opening-balance step. The read-only count above is still worth running before the switch, as a sanity check: a Bien that is NULL or 0 will be refused the moment the rule is on.
- **To change, only with the user's go-ahead at that moment, after backups:** the master migration, then `UPDATE tenants SET inventario_estricto = 1 WHERE id = 2 AND tipo = 'app'`.

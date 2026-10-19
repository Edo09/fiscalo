# Stock control on sales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company can turn on "Bloquear ventas sin existencia": a factura (e-CF) or factura simple that asks for more than the system's stock is refused by the API with a structured error, and the app shows it with a button to «Ajuste de inventario». Off by default; Ferretería (tenant 02) is switched on last.

**Architecture:** A per-company flag on `master.tenants` (admin-editable) gates one read-only check in `inventoryModel` that runs before the e-NCF is dispensed (e-CF) and a check-plus-decrement inside the invoice's own transaction (factura simple). The decrement code of every other path stays where it is. The front reads the flag from `GET /api/branding`, renders the structured error with a shared component and opens Ajuste pre-filled with the missing quantities.

**Tech Stack:** PHP 8.3 (no Composer, plain `tools/test_*.php` scripts), MySQL, React 18 + TypeScript + Vite + react-query + zod, Node-run `scripts/test-*.ts` scripts.

**Spec:** `docs/superpowers/specs/2026-10-19-control-existencias-ventas-design.md` (fiscalo). Section numbers and C-numbers below refer to it. Read it first.

**Repos and workspaces:** API `C:\Users\Signos\Documents\edwin\api-gratex` (branch from `master`), front `C:\Users\Signos\Documents\edwin\fiscalo` (branch from `main`). Work in a worktree `.claude/worktrees/control-existencias` on branch `feat/control-existencias` in each repo (see Task 0). Tasks 1–8 are API, 9–13 are front, 14 is the closing check. The two streams touch different repos, so they can run in parallel: the front only needs the contract in spec 4.4 and 4.1.

## Global Constraints

- PHP: 8.3 syntax only (production runs 8.3, local runs 8.5). No new Composer dependencies. Spanish messages, with accents, written for the person using the screen. Never put the word «DGII» in a stock message.
- Stock compares are done in **integer thousandths**: `(int) round($x * 1000)`. Stock column is `DECIMAL(15,3)`; MySQL returns it as text.
- With the company's switch **off**, behaviour is byte-identical to today: no check, post-commit decrement, product form writes stock, negative stock allowed. Every new branch is gated by `TenantResolver::inventarioEstricto()` (API) or `useInventarioEstricto()` (front).
- Error contract (spec 4.4): HTTP **422**, JSON `{status:false, error, codigo:'STOCK_INSUFICIENTE', data:{faltantes:[{product_id, nombre, sku, unidad_medida, solicitado, disponible, faltante}]}}`. Numbers are JSON numbers. `disponible` is floored at 0; `faltante = solicitado − raw stock` (NULL as 0). Never 409.
- Check set = decrement set: every e-CF type except E34 and E41, plus factura simple. Never checked: services (`indicador_bien_servicio = 2`), lines without `product_id`, E34/E41, resends (`$reenvioDe !== null`).
- Untouched: POS (`src/Pos/*`, `src/pos/*`), conduces, cotizaciones, gastos, `registrarCompra`, `devolverSaldoDeFactura`, the e-CF decrement in `moverStockFacturaEcf`, and the assertions pinned in `tools/test_write_ahead_puro.php`.
- Tests: front `node scripts/<name>.ts` (prints `N/N OK`, exit 1 on failure; relative `.ts` imports only, no `@/` value imports); API `php tools/<name>.php` (exit 1 on failure). Never run `tools/test_facturas_simples.php`. Never read or print a `.env` (Task 0 only copies the scratch one as an opaque file). DB-backed suites run only against the scratch databases.
- Nothing is committed, pushed or merged, and nothing is written to production, until the user says so. Each task ends with a checkpoint, not a commit.
- Re-read a file immediately before editing it: the ITBIS-in-simples work (`docs/superpowers/plans/2026-10-14-itbis-facturas-simples.md`) will edit `facturaModel.php`, `facturaSimpleController.php` and the simple-invoice form, and reserves master migration 013 and tenant 036. Take the next free master migration number after `git fetch` (013 today) and say so in the final handoff.
- Visual identity: reuse `Btn`, `Card`, `Badge`, `toast` (sonner) and existing CSS classes; Spanish with accents.

## Review Focus

Failure modes the spec implies that no task would otherwise pin; each has a named test in the owning task.

1. The same product on two lines of one document (summed before comparing) — Task 2, Task 8.
2. Decimal quantities: 0.1 + 0.2 against stock 0.3 passes, 0.3 against 0.299 is short by 0.001 — Task 2.
3. A company with the switch off: no refusal and the post-commit decrement path unchanged — Task 4, Task 5, Task 8.
4. A factura simple `PUT` that only re-saves (same or lower quantities) when stock is 0 must not be refused — Task 8.
5. Services, stock-NULL goods, entries (E34/E41) and a resend: services and entries never refused, NULL counts as 0, resend exempt — Task 2, Task 4.
6. A raw API request with an unknown `product_id` or quantity ≤ 0 gets a plain 422, never the stock error — Task 2.
7. Negative stored stock shows `disponible: 0` and never «quedan -3» — Task 2, Task 9.

---

### Task 0: Workspaces

**Files:** none tracked.

- [ ] **Step 1:** In each repo run `git fetch` then `git worktree add .claude/worktrees/control-existencias -b feat/control-existencias <master|main>`. Confirm `git -C <worktree> status --short` is empty.
- [ ] **Step 2:** Copy the spec and this plan from the fiscalo main checkout (`docs/superpowers/specs/2026-10-19-control-existencias-ventas-design.md` and `docs/superpowers/plans/2026-10-19-control-existencias-ventas.md`, both untracked there) into the fiscalo worktree at the same paths.
- [ ] **Step 3:** Front worktree has no `node_modules`: create a directory junction to the main checkout's (`New-Item -ItemType Junction -Path <worktree>\node_modules -Target <main>\node_modules`). Run `npm run typecheck` in the worktree: expect no errors.
- [ ] **Step 4:** For the scratch-DB suite (Task 8) copy `api-gratex\.claude\worktrees\ecf-write-ahead\tools\.env` to the API worktree's `tools\.env` with a plain file copy, without opening it.
- [ ] **Step 5:** Baseline, API worktree: `php tools/test_write_ahead_puro.php` (expect 301/301) and `php tools/check_tenant_schema_orden.php` (147/147). Front worktree: `for f in scripts/test-*.ts scripts/check-errores.ts; do node $f || echo FAIL $f; done` (all OK).

---

## API (api-gratex)

### Task 1: The setting — master migration, schema mirror, flag reader

**Files:**
- Create: `db/master_migrations/013_tenants_inventario_estricto.sql` (number: next free, see Global Constraints)
- Modify: `db/master_schema.sql` (column next to `pos_enabled`), `tools/verificar_migraciones_master.sql` (new check), `src/TenantResolver.php`, `src/MasterDatabase.php`
- Create/Test: `tools/test_inventario_stock.php` (the no-DB suite for the whole feature; later tasks add sections)

**Interfaces:**
- Produces: `TenantResolver::inventarioEstricto(): bool` — true only when the resolved tenant is type `app` and `(int)(current()['inventario_estricto'] ?? 0) === 1`; false for no tenant, missing column, 0, or `integracion`.
- Produces: `MasterDatabase::setInventarioEstricto(int $tenantId, bool $activo): void` — `UPDATE tenants SET inventario_estricto = :v WHERE id = :id AND tipo = 'app'`.
- Produces: column `master.tenants.inventario_estricto TINYINT(1) NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write the failing tests** in `tools/test_inventario_stock.php` (header comment in Spanish; helpers `chk(string $desc, bool $ok)` and a final line `"{$ok} de {$total} pruebas OK"` with exit 1 on failure). Section 1 tests, setting `TenantResolver::$current` through `ReflectionProperty`: `inventarioEstricto sin tenant es false`, `columna ausente es false`, `valor 0 es false`, `valor 1 tipo app es true`, `valor 1 tipo integracion es false`. Source pins: `db/master_schema.sql` contains `inventario_estricto` with `TINYINT(1) NOT NULL DEFAULT 0`; the migration file uses `@db`, is idempotent via `information_schema`, and contains no `UPDATE tenants`.
- [ ] **Step 2:** Run `php tools/test_inventario_stock.php`. Expect FAIL (method and file missing).
- [ ] **Step 3: Implement** the migration following `db/master_migrations/012_pos.sql` (header block in Spanish: POR QUÉ / QUÉ HACE / CÓMO CORRERLA / ORDEN; `SET @db := DATABASE();`, guard statement, add the column only if absent via `PREPARE`/`EXECUTE`, result `SELECT` last). It does **not** switch anyone on. Mirror the column in `master_schema.sql`, add its check to `verificar_migraciones_master.sql`, and implement the two methods.
- [ ] **Step 4:** Run the suite: expect PASS. Run `php tools/check_tenant_schema_orden.php`: expect unchanged (147/147).
- [ ] **Step 5: Checkpoint:** `git status --short` shows only this task's files.

### Task 2: The check — pure core, message, DB wrapper

**Files:**
- Modify: `src/Models/inventoryModel.php`; Test: `tools/test_inventario_stock.php` (section 2)

**Interfaces:**
- Produces: `inventoryModel::__construct(?PDO $conexion = null)` — uses the given PDO, else `Database::getInstance()->getConnection()` as today (C20).
- Produces: `public static function esEntrada(?string $tipoEcf): bool` — true for `'34'`, `'41'`; `registrarVenta` switches to it.
- Produces: `public static function calcularFaltantes(array $items, array $catalogo, ?string $tipoEcf): array` returning `['faltantes' => list<array{product_id,nombre,sku,unidad_medida,solicitado,disponible,faltante}>, 'no_existe' => list<int>, 'cantidad_invalida' => list<int>]`. `$items` accept `quantity` or `cantidad` and `product_id`; `$catalogo` is `array<int, array{nombre:string, sku:?string, unidad_medida:?string, stock:?float, servicio:bool}>`. Sums per product, compares in thousandths, skips lines without `product_id`, services and entries, sorts by `product_id`.
- Produces: `public static function mensajeFaltantes(array $faltantes): string` — one sentence per product, joined; names in «» and omitted when constant-like (reuse `nombreEnMensaje` rule); never prints a negative balance.
- Produces: `public function verificarDisponibilidad(array $items, ?string $tipoEcf): array` — loads the catalogue rows for the item ids, then `['success', []]` | `['error', string, 422]` (unknown product or quantity ≤ 0, plain) | `['error', string, 422, ['codigo' => 'STOCK_INSUFICIENTE', 'faltantes' => [...]]]`.
- Produces: `public static function respuestaExistencia(array $res): array` — the JSON-able body `['status'=>false,'error'=>…, 'codigo'=>…, 'data'=>['faltantes'=>…]]` (no `codigo`/`data` for the plain case).

- [ ] **Step 1: Write the failing tests** (section 2, pure ones call `calcularFaltantes`/`mensajeFaltantes` directly):
  - `suma lineas del mismo producto`: stock 4, two lines of 3 → one shortfall `solicitado 6, disponible 4, faltante 2`.
  - `milesimas`: stock 0.3 with lines 0.1 and 0.2 → no shortfall; stock 0.299 with 0.3 → `faltante 0.001`.
  - `igual pasa`, `stock 0 rechaza`, `stock NULL cuenta como 0` (`disponible 0, faltante` = solicitado), `stock negativo`: stock −3, request 5 → `disponible 0, faltante 8`.
  - `servicio no se revisa`, `linea sin product_id no se revisa`, `E34 y E41 no se revisan`, `E33 si se revisa`.
  - `producto inexistente` → id in `no_existe`; `cantidad cero o negativa` → id in `cantidad_invalida`; neither appears in `faltantes`.
  - `acepta quantity o cantidad`, `ordena por product_id`.
  - `mensaje`: contains `«Cemento gris»`, the requested quantity and the available one; for stock −3 contains no `-`; a constant-like name (`CABLE_THHN_12`) is omitted but the sentence still says `pides`; two products give both sentences.
  - `verificarDisponibilidad con PDO falso`: build the model with `ReflectionClass::newInstanceWithoutConstructor` or the new constructor argument and a fake PDO copied from the `WaS9Conexion` pattern in `tools/test_write_ahead_puro.php:764-832`; assert the `['error', msg, 422, ['codigo'=>'STOCK_INSUFICIENTE','faltantes'=>[…]]]` shape and `['success', []]` when covered.
  - `respuestaExistencia`: keys and shape for both cases.
- [ ] **Step 2:** Run the suite: expect FAIL.
- [ ] **Step 3: Implement** the functions above. The wrapper fetches `id, nombre, sku, unidad_medida, stock, indicador_bien_servicio` for the ids with one `IN (...)` query; the thousandths comparison lives only in `calcularFaltantes`; all "how much is available" logic stays in one place so per-warehouse stock can replace it later. Update the docblocks at `inventoryModel.php:112-114` and `:179-181` to say negative balance is tolerated only when the company's switch is off.
- [ ] **Step 4:** Run the suite: expect PASS; run `php tools/test_write_ahead_puro.php`: expect 301/301.
- [ ] **Step 5: Checkpoint.**

### Task 3: Ledger hardening, in-transaction sale, new motives

**Files:**
- Modify: `src/Models/inventoryModel.php`; Test: `tools/test_inventario_stock.php` (section 3)

**Interfaces:**
- Consumes: Task 2 (`verificarDisponibilidad`, constructor argument).
- Produces: `aplicarMovimientos` locks lines **sorted by `product_id`** (stable). New optional `$ctx['bloquear_sin_existencia'] = true`: when a line has `cantidad < 0` and the locked balance would end below 0, return `['error', mensaje, 422, ['codigo'=>'STOCK_INSUFICIENTE','faltantes'=>[one row]]]` without writing that line (the caller owns the rollback when `$ownTransaction` is false; with its own transaction it rolls back itself). Flag absent = today's behaviour.
- Produces: `public function moverVentaEnTransaccion(int $facturaId, array $itemsNuevos, ?int $userId, ?array $itemsViejos = null): array` — must run inside the caller's open transaction on the model's connection: reverts `$itemsViejos` (DEVOLUCION, +) when given, then `verificarDisponibilidad($itemsNuevos, null)`, then applies the new lines (VENTA, −, with the flag) using the same line filter as `moverPorDocumento` (extract it to a private `lineasQueMueve(array $items, int $signo, bool $costoDeLinea): array`). Returns `['success', int movimientos]` | the error arrays above. Never starts or commits a transaction.
- Produces: `MOTIVOS` gains `'ENTRADA'` and `'INVENTARIO_INICIAL'`.
- Produces: in `moverPorDocumento` (post-commit path), when `TenantResolver::inventarioEstricto()` and a VENTA movement leaves a balance below 0, `error_log('[inventario] SOBREVENTA factura <id> producto <pid> saldo <n>')`. Behaviour otherwise unchanged.

- [ ] **Step 1: Write the failing tests** (section 3, fake PDO that records SQL and parameters):
  - `bloquea en orden de product_id`: lines for products 9, 3, 5 produce `FOR UPDATE` selects in order 3, 5, 9.
  - `sin bandera sigue igual`: stock 2, delta −3 writes balance −1 (today's behaviour).
  - `con bandera rechaza`: same input returns the 422 error with `faltantes[0].faltante == 1` and issues no `UPDATE products`.
  - `con transaccion ajena no abre ni cierra`: with `$ownTransaction = false` the fake records no `beginTransaction`, `commit` or `rollBack`.
  - `MOTIVOS` contains `ENTRADA` and `INVENTARIO_INICIAL`; `ANULACION` is still refused on a user-created adjustment (existing rule).
  - `moverVentaEnTransaccion` rolls nothing back itself and, given old lines with stock 0 and new lines equal to the old ones, succeeds (the revert restores what the check needs).
- [ ] **Step 2:** Run the suite: expect FAIL.
- [ ] **Step 3: Implement** the changes. Keep `crearAjuste` validation untouched except that it accepts the two new motives (`inventory_adjustments.motivo` is VARCHAR(20): no migration). Add `ENTRADA` / `INVENTARIO_INICIAL` to `docs/api/inventario.md`'s motive list.
- [ ] **Step 4:** Suite PASS; `php tools/test_write_ahead_puro.php` 301/301.
- [ ] **Step 5: Checkpoint.**

### Task 4: e-CF entry point

**Files:**
- Modify: `src/Models/inventoryModel.php`, `src/Controllers/facturaController.php`; Test: `tools/test_inventario_stock.php` (section 4)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `inventoryModel::verificarVentaEcf(array $items, string $tipoEcf, ?int $reenvioDe): array` — `['success', []]` without any query when `TenantResolver::inventarioEstricto()` is false, when `$reenvioDe !== null`, or when `esEntrada($tipoEcf)`; otherwise `verificarDisponibilidad($items, $tipoEcf)`.
- Produces: in `facturaController.php`, `respondExistencia(array $res): void` — `http_response_code(422)` and `echo json_encode(inventoryModel::respuestaExistencia($res))`.

- [ ] **Step 1: Write the failing tests** (section 4): `verificarVentaEcf` returns success with a fake PDO that fails on any query when the rule is off; success for a resend; success for type 34 with rule on; the error shape for type 31 with a shortfall. Source pins on `src/Controllers/facturaController.php`: `->emitir(` still appears exactly once; `verificarVentaEcf(` appears exactly once, after the text `No se pudo calcular el total de la factura` and before `->emitir(`; `moverStockFacturaEcf(` body unchanged.
- [ ] **Step 2:** Run: expect FAIL.
- [ ] **Step 3: Implement.** In `emitirFacturaEcf`, right after the `monto_total` guard (before the payload is built, so before the e-NCF is dispensed), call `inventarioModelo()->verificarVentaEcf($items, $tipoEcf, $reenvioDe)` — `$items` as already normalised, which carry `product_id` and `cantidad`. It runs even when `strict_input`. On error: `AuditLogger::log` module `facturas`, action `EMIT`, `success => false`, `error_message` the text; then `respondExistencia($res)` and `return`. A thrown `Throwable` from the check must not block the sale: catch, `error_log('[inventario] ...')`, continue (the rule is a guard, not a fiscal dependency).
- [ ] **Step 4:** Suite PASS; `php tools/test_write_ahead_puro.php` 301/301 (its source pins must still hold).
- [ ] **Step 5: Checkpoint.**

### Task 5: Factura simple atomic path

**Files:**
- Modify: `src/Models/facturaModel.php`, `src/Controllers/facturaSimpleController.php`; Test: `tools/test_inventario_stock.php` (section 5)

**Interfaces:**
- Consumes: Task 3 (`moverVentaEnTransaccion`), constructor argument (C20).
- Produces: `facturaModel::createFacturaSimple(array $data, ?callable $enTransaccion = null): array` and `updateFacturaSimple(int $id, array $data, ?callable $enTransaccion = null): array`. The callback has signature `function (PDO $conexion, int $facturaId, array $items): ?array`, is called inside the transaction **before** `insertSimpleItems` (after `INSERT INTO facturas`, or after the old lines are deleted in an update; an unknown `product_id` must hit the plain 422, not the `factura_items` foreign key) and before `commit()` (in `updateFacturaSimple` only when the items are replaced), receives the normalized items as `insertSimpleItems` wrote them (`product_id`, `quantity`), and returns `null` or an `['error', mensaje, 422, datos]` array. On an error return the model rolls back and returns that array unchanged. Default `null` = today's code path.
- Produces: `fsRespondExistencia(array $res): void` in the controller (422 + `inventoryModel::respuestaExistencia`).

- [ ] **Step 1: Write the failing tests** (section 5, source pins): in `facturaSimpleController.php` the strict branch calls `moverVentaEnTransaccion(` with a closure built from `new inventoryModel($conexion)` (the connection the model passes, never `fsInventario()`), and the non-strict branch still contains the original post-commit `registrarVenta(` / `revertirVenta(` calls verbatim; `facturaModel.php` has `?callable $enTransaccion = null` on both methods and calls it before `commit()`.
- [ ] **Step 2:** Run: expect FAIL.
- [ ] **Step 3: Implement.** Controller POST: when `TenantResolver::inventarioEstricto()`, pass a callback that does `(new inventoryModel($conexion))->moverVentaEnTransaccion($facturaId, $items, $userId)` and skip the post-commit `registrarVenta`; on its error respond with `fsRespondExistencia` (plain 422 when the error has no data) and audit failure under `facturas-simples` / `CREATE` with `success => false`. PUT (only when `items` replaced): same with `$previa['items']` as `$itemsViejos` and skip the post-commit revert+register. DELETE unchanged. The `$facturaModel` object is built before `validateRequest()`; the callback must use the `PDO` the model hands it, which is the model's own connection and the one holding the open transaction.
- [ ] **Step 4:** Suite PASS; `php tools/test_write_ahead_puro.php` 301/301; `php -l` on both files.
- [ ] **Step 5: Checkpoint.** Real transaction behaviour is proved in Task 8.

### Task 6: Setting endpoint and branding field

**Files:**
- Modify: `src/Controllers/inventarioController.php` (route, methods header), `src/Controllers/brandingController.php`, `src/Models/inventoryModel.php`, `docs/api/inventario.md`, `docs/modules/auditoria.md`; Test: `tools/test_inventario_stock.php` (section 6)

**Interfaces:**
- Consumes: Task 1.
- Produces: `GET /api/inventario/configuracion` → `{status:true, data:{bloquear_sin_existencia:bool, productos_sin_existencia:int}}`; `PUT` body `{bloquear_sin_existencia:bool}` → same shape; `403` for non-admin; `409` when there is no tenant (single-tenant install); `422` for a non-boolean.
- Produces: `inventoryModel::rolPuedeConfigurar(?string $rol): bool` (case-insensitive `'admin'` only) and `inventoryModel::contarSinExistencia(): int` (active Bienes, `stock IS NULL OR stock <= 0`).
- Produces: `GET /api/branding` data gains `inventario_estricto: bool` (true only for type `app`).

- [ ] **Step 1: Write the failing tests** (section 6): `rolPuedeConfigurar('admin')`, `('ADMIN')` true; `('user')`, `('')`, `(null)` false; source pins: the controller header `Allow-Methods` includes `PUT`; the PUT branch checks the role via `rolPuedeConfigurar` before touching the database; `brandingController.php` returns `inventario_estricto`.
- [ ] **Step 2:** Run: expect FAIL.
- [ ] **Step 3: Implement.** In `inventarioController.php` add `$esConfiguracion` (path `#/inventario/configuracion#`) handled before the ajustes routes: token required (the existing block), `user_id` required, role from `$validation['role']`; `GET` open to any authenticated user, `PUT` admin only (denied attempts logged like `auditLogController.php:35-41` does via `AuditMiddleware::logAccessDenied` using module `inventario`). Tenant id from the token only. `PUT` calls `MasterDatabase::getInstance()->setInventarioEstricto(...)`, audits `module 'inventario'`, `action 'INVENTARIO_CONFIG'` with old/new values, and returns the same payload as `GET`. Add the action to the vocabulary in `docs/modules/auditoria.md`; document both endpoints and the 422 contract in `docs/api/inventario.md`.
- [ ] **Step 4:** Suite PASS; `php -l` on the touched files.
- [ ] **Step 5: Checkpoint.**

### Task 7: Product form and API with the switch on

**Files:**
- Modify: `src/Models/productModel.php`, `src/Controllers/productController.php`; Test: `tools/test_inventario_stock.php` (section 7)

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces: `productModel::existenciaInicialDelLibro(object $data, bool $estricto): ?float` — the quantity to record through the ledger on create: only when `$estricto`, `indicador_bien_servicio` is not 2 and the quantity is numeric and ≠ 0; else null.
- Produces: `productModel::existenciaAGuardarEnEdicion(bool $estricto, $enviada, ?float $actual): ?float` — `$actual` when `$estricto` (the field is ignored silently), else the sent value as today.

- [ ] **Step 1: Write the failing tests** (section 7): switch on, Bien, `stock 5` → `5.0`; `null`, `''`, `0` → null; service → null; switch off → null; edit with the switch on returns the current value whatever was sent; with it off returns the sent value; `null` sent with the switch off returns null as today.
- [ ] **Step 2:** Run: expect FAIL.
- [ ] **Step 3: Implement.** `saveProduct`: when the helper returns a quantity, insert with `stock NULL` inside a transaction and record it with `(new inventoryModel($this->conexion))->crearAjuste([... 'motivo' => 'INVENTARIO_INICIAL', 'lineas' => [['product_id' => $id, 'tipo' => 'INCREMENTO', 'cantidad' => $q]], 'user_id' => <token user>], false)`; commit; a ledger error rolls the product back and returns a plain error. `updateProduct`: bind `existenciaAGuardarEnEdicion(...)`. The controller passes the token's user id to `saveProduct`. Fix the stale comment at `productController.php:25-35`.
- [ ] **Step 4:** Suite PASS; `php -l`.
- [ ] **Step 5: Checkpoint.**

### Task 8: Scratch-database suite and API docs

**Files:**
- Create: `tools/test_inventario_stock_db.php`
- Modify: `docs/modules/inventario.md`, `docs/specs/pos.md` (note that decision 7 / V3 still hold for the POS and that the switch applies to facturas), `docs/integrations/pos-write-ahead.md`

**Interfaces:** consumes everything above. Clone the structure of `tools/test_write_ahead_api.php` (HTTP end to end through `wa_api()`/`wa_http`, helpers in `tools/write_ahead_test_lib.php`). Scratch databases only; apply the new master migration to the scratch master first.

- [ ] **Step 1: Write the suite** with these named scenarios, each seeding its own products (stock exact, 0, NULL, negative, fractional, a service) and each run with the switch off and on where it matters:
  - `off: vende sin existencia y deja negativo` (e-CF and simple; stock goes below 0, no refusal).
  - `on simple: rechaza 422 con faltantes y no guarda la factura ni mueve stock`; `on simple: exacto pasa`; `on simple: lineas repetidas se suman`; `on simple: decimales 0.1+0.2 contra 0.3`.
  - `on simple PUT: re-guardar con la misma cantidad y stock 0 pasa`; `on simple PUT: subir de 3 a 5 con stock 1 rechaza con faltante 1`; `on simple DELETE devuelve el stock`.
  - `on simple: dos procesos venden la ultima unidad, solo uno pasa` (barrier-file child processes as in `test_reservar_confirmar.php --hijo`).
  - `on e-CF: rechaza antes de reservar e-NCF (contador sin cambios)`; `on e-CF: reenvio no se revisa`; `on e-CF: nota de credito E34 suma sin revisar`; `on e-CF: servicio y linea libre pasan`.
  - `on: producto inexistente y cantidad <= 0 dan 422 llano sin codigo`.
  - `on: PUT /api/products ignora stock; POST con existencia crea un movimiento INVENTARIO_INICIAL; off: ambos como hoy`.
  - `config: GET para cualquier rol, PUT solo admin (403 para otro rol), cambia branding.inventario_estricto`.
  - `SOBREVENTA se registra cuando un e-CF deja saldo negativo con la regla activa`.
- [ ] **Step 2:** Run against the scratch DB (command and flags from `tools/test_write_ahead_api.php`'s header; add `-d extension=curl -d extension=openssl -d extension=pdo_mysql` as needed). Expect every scenario OK. If the harness refuses the connection, stop and report it; do not change credentials or use any other database.
- [ ] **Step 3:** Write the docs: `docs/modules/inventario.md` (the switch, the check, the e-CF timing — stock moves after the DGII verdict —, the atomic simple path, the accepted limits: lines without `product_id`, in-flight e-CF rows, supplier E34, credit notes unlinked to the original lines, per-product not per-warehouse stock), the POS notes in `docs/specs/pos.md` and `docs/integrations/pos-write-ahead.md`.
- [ ] **Step 4:** Re-run every no-DB suite: `test_inventario_stock.php`, `test_write_ahead_puro.php`, `check_tenant_schema_orden.php`, `test_conduces.php`, `test_notas_vinculadas.php`, `test_integracion_alcance.php`. Expect all OK.
- [ ] **Step 5: Checkpoint.**

---

## Front (fiscalo)

### Task 9: Error code, helpers, API client, flag hook

**Files:**
- Modify: `src/api/errores.ts` (+`http.ts:90-93` if needed), `src/api/types.ts` (`BrandingData`), `src/api/index.ts`, `src/api/inventario.ts`
- Create: `src/features/inventory/existencia.ts`, `src/features/inventory/useInventarioEstricto.ts`, `scripts/test-existencia.ts`; Modify `scripts/check-errores.ts`

**Interfaces:**
- Produces: `ApiError.codigo` filled from `body.codigo` (the constructor already supports it).
- Produces in `existencia.ts` (relative `.ts` imports only): `CODIGO_STOCK_INSUFICIENTE = 'STOCK_INSUFICIENTE'`; `interface FaltanteStock { productId: number; nombre: string; sku: string | null; unidadMedida: string | null; solicitado: number; disponible: number; faltante: number }`; `datosStockInsuficiente(e: unknown): FaltanteStock[] | null` (an `ApiError` with status 422 and `datos.faltantes`); `textoFaltante(f: FaltanteStock): string`; `consumoPorProducto(lineas: {productId: number | null; cantidad: number; esServicio?: boolean}[]): Map<number, number>`; `faltantesLocales(consumo: Map<number, number>, existencias: Map<number, {stock: number | null; nombre: string; esServicio: boolean}>, credito?: Map<number, number>): FaltanteStock[]` (`credito` = quantities a saved invoice already holds, added to the stock; used by Task 12); `lineasPrefillAjuste(f: FaltanteStock[]): {productId: number; cantidad: number}[]`.
- Produces: `getConfiguracionInventario(): Promise<ConfiguracionInventario>` and `updateConfiguracionInventario(bloquear: boolean): Promise<ConfiguracionInventario>` in `src/api/inventario.ts`, with `ConfiguracionInventario = { bloquear_sin_existencia: boolean; productos_sin_existencia: number }`; `BrandingData.inventario_estricto?: boolean`.
- Produces: `useInventarioEstricto(): boolean | null` modelled on `src/features/pos/usePosActivo.ts` (same `['branding']` query and options; `null` until known).

- [ ] **Step 1: Write the failing tests** in `scripts/test-existencia.ts` (Spanish header, `chk`, `N/N OK`): `datosStockInsuficiente` parses a 422 `ApiError` and returns null for 409, other `datos`, plain `Error`, `null`; `textoFaltante` for `solicitado 5, disponible 2` mentions the name, 5 and 2, and for `disponible 0` has no `-`; `consumoPorProducto` sums repeated ids, skips null ids and services; `faltantesLocales`: stock null counts as 0, service skipped, equal passes, 0.1+0.2 vs 0.3 passes, stock negative gives `disponible 0` and `faltante` = `solicitado − stock`; `lineasPrefillAjuste` returns one line per shortfall with `cantidad = faltante`. In `scripts/check-errores.ts` add: a body with `codigo` reaches `ApiError.codigo`; the clean sentence «No hay existencia suficiente de «Cemento gris»: pides 5 y hay 2.» passes the humanizer unchanged; with a constant-like name `datos.faltantes` still survives the replacement.
- [ ] **Step 2:** Run `node scripts/test-existencia.ts` and `node scripts/check-errores.ts`: expect FAIL.
- [ ] **Step 3: Implement** the modules; round with the project's 3-decimal helper (`redondear` in `montosLinea.ts`) and compare in thousandths.
- [ ] **Step 4:** Both scripts PASS; `npm run typecheck`; `npx eslint src scripts`.
- [ ] **Step 5: Checkpoint.**

### Task 10: Ajuste prefill and the shared warning

**Files:**
- Modify: `src/config/navigation.ts`, `src/App.tsx`, `src/features/inventory/AdjustmentFormView.tsx`, `src/features/inventory/motivos.ts`
- Create: `src/features/inventory/AvisoExistencia.tsx`, `scripts/test-nav-ajuste.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: `interface AjustePrefill { kind: 'ajuste-prefill'; lineas: { productId: number; cantidad: number }[] }` added to `NavPayload`; `isAjustePrefill(p: unknown): p is AjustePrefill`; `mismoDestino` treats two prefills as the same destination when their lines are equal.
- Produces: `AvisoExistencia({ faltantes, nav }: { faltantes: FaltanteStock[]; nav: Nav })` — card with `role="alert"` in the style of `EcfDashboardView.tsx:58-77` (danger-soft); one row per shortfall (name, solicitado, disponible); button «Ir a Ajuste de inventario» that calls `nav('ajuste-nuevo', { kind: 'ajuste-prefill', lineas: lineasPrefillAjuste(faltantes) })` only when `puedeVerVista(useSession().user, 'ajuste-nuevo')`, otherwise the line «Pide a un administrador que agregue existencia en Ajuste de inventario.»
- Produces: `AdjustmentFormView` seeds its lines from the payload (each product fetched with `getProduct`, tipo INCREMENTO, motive `ENTRADA`), keeps ending at the Ajustes list, and `motivos.ts` lists `ENTRADA` («Entrada de mercancía») and `INVENTARIO_INICIAL` («Inventario inicial»).

- [ ] **Step 1: Write the failing test** `scripts/test-nav-ajuste.ts` (pattern of `scripts/test-nav-formato.ts`): `isAjustePrefill` accepts a prefill and rejects null, a ref and a malformed payload; `mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', b)` true for equal lines, false for different; the motives file exports the two new motives.
- [ ] **Step 2:** Run: expect FAIL.
- [ ] **Step 3: Implement.** `App.tsx` passes the payload to `AdjustmentFormView` with a React `key` per prefill (like `claveFormularioFactura`). Reuse `Btn`, `Card`, `Icon`; no new CSS unless a class is missing.
- [ ] **Step 4:** Test PASS; `npm run typecheck`; `npx eslint src scripts`.
- [ ] **Step 5: Checkpoint.**

### Task 11: e-CF form

**Files:**
- Modify: `src/features/invoices/InvoiceFormView.tsx`

**Interfaces:** consumes Tasks 9–10.

- [ ] **Step 1: Test.** Logic is in the pure helpers (Task 9). Add to `scripts/test-existencia.ts` the two cases this form relies on: an e-CF type `34` (or a line without a product) produces no local shortfall, and a Bien without stock data (not loaded yet) is not flagged.
- [ ] **Step 2: Implement.**
  - In the `emitir` catch (before the generic toast, not the 502 en-vuelo branch): `datosStockInsuficiente(e)` → keep the form editable (`setEmitting(false)`), store the shortfalls in state, invalidate `['products']` and `['inventario']`, render `<AvisoExistencia>` above the totals.
  - Pickers: show existencia, and «Agotado» (danger `Badge`) for a Bien at 0, null or below when the switch is on (C18).
  - Advisory inline warning on a line whose quantity exceeds the known existencia (switch on, types other than 34, services and free lines skipped, quantities summed per product via `consumoPorProducto`/`faltantesLocales`). The submit button is **not** disabled by it (C10).
  - `useAvisoSalida(activo, mensaje)` only when `useInventarioEstricto() === true` and the form has lines; call `liberar()` before the `nav('factura-ver')` that follows a successful emission (C14).
  - Invalidate `['products']` and `['inventario']` after a successful emission.
- [ ] **Step 3:** `npm run typecheck`, `npx eslint src scripts`, `node scripts/test-existencia.ts`: all OK.
- [ ] **Step 4: Checkpoint.** Visual check is Task 14.

### Task 12: Factura simple form

**Files:**
- Modify: `src/features/invoices/SimpleInvoiceFormView.tsx`, `src/features/invoices/SimpleInvoiceListView.tsx`

**Interfaces:** consumes Tasks 9–10.

- [ ] **Step 1: Test.** Add to `scripts/test-existencia.ts`: editing a saved invoice that holds 3 of product X when the current stock is 1: advisory check with the new quantity 5 gives `disponible 4` (stock 1 + the 3 it already holds) and `faltante 1`; with quantity 3 or less gives no shortfall. (Pass the original quantities as the `credito` argument of `faltantesLocales`, defined in Task 9.)
- [ ] **Step 2: Implement.** Same as Task 11 on this form: catch near the existing `guardar` catch, `AvisoExistencia`, picker existencia/«Agotado», inline advisory using `original.lineas` as the credit when editing, `useAvisoSalida` already exists here (leave as is), invalidate `['products','inventario']` after save and after delete in the list view.
- [ ] **Step 3:** `npm run typecheck`, `npx eslint src scripts`, `node scripts/test-existencia.ts`: OK.
- [ ] **Step 4: Checkpoint.**

### Task 13: Settings section and product screens

**Files:**
- Create: `src/features/settings/InventarioSection.tsx`
- Modify: `src/features/settings/SettingsView.tsx`, `src/features/products/ProductFormModal.tsx`, `src/features/products/ProductsView.tsx`, `src/api/mappers.ts`

**Interfaces:** consumes Task 9.

- [ ] **Step 1: Test.** `scripts/test-existencia.ts`: the mapper rule — with the switch on, a Bien with stock null shows as 0 / «Agotado»; with it off it keeps today's «N/A» and «Disponible». Export the rule as a pure function from `existencia.ts` (`estadoExistencia(stock: number | null, esServicio: boolean, estricto: boolean)`) and test it.
- [ ] **Step 2: Implement.**
  - `InventarioSection`: a new «Inventario» entry in `todasSecs` (icon `package` or the closest existing icon), visible only when `user.role === 'admin'`. One switch «Bloquear ventas sin existencia» with the help text (what it blocks, that the POS is not affected, that stock must then be added in Ajuste or by registering a purchase) and the count «N productos sin existencia» from `getConfiguracionInventario`. Saving calls `updateConfiguracionInventario`, shows a `toast`, and invalidates `['branding']` and `['configuracion-inventario']`.
  - `ProductFormModal`: with the switch on, Existencia is read-only on edit with a hint and a link to Ajuste, and the edit payload still sends `stock` (the API ignores it, so a stale browser flag is harmless); create keeps the opening quantity field. Update the stale comment at `ProductFormModal.tsx:31-35`.
  - `ProductsView`/`mappers.ts`: use `estadoExistencia` with the flag (C18).
- [ ] **Step 3:** `npm run typecheck`, `npx eslint src scripts`, `node scripts/test-existencia.ts`: OK.
- [ ] **Step 4: Checkpoint.**

---

### Task 14: Closing verification

- [ ] **Step 1:** API worktree: run every no-DB suite from Task 8 Step 4 and, if the scratch DB is reachable, `tools/test_inventario_stock_db.php`; `php -l` on every changed PHP file.
- [ ] **Step 2:** Front worktree: `npm run typecheck`, `npx eslint src scripts`, and the full loop `for f in scripts/test-*.ts scripts/check-errores.ts scripts/parity-cotizacion-ferreteria.ts; do node $f || echo FAIL $f; done` — all OK.
- [ ] **Step 3:** Browser check against a **local mock API only** (the dev `.env` proxies to production: see the project memory «safe UI preview via mock proxy»; never use `preview_start` with an unknown name). With the mock serving `inventario_estricto: true` in `/api/branding` and a 422 `STOCK_INSUFICIENTE` for `POST /api/facturas` and `/api/facturas-simples`: check the warning, the button opening Ajuste pre-filled, the text-only variant for a user without the products module, the admin-only «Inventario» section, and a narrow viewport. Use ~1280px; the app goes mobile below ~1000px.
- [ ] **Step 4:** Compare the final diffs with the spec section by section (success criteria, C1–C20, the anti-goals) and list anything not done.
- [ ] **Step 5: Hand off** (no commit, no push, no production write): list branches and worktrees, the master migration number used, and the two production steps awaiting the user's go-ahead (apply the migration, then `UPDATE tenants SET inventario_estricto = 1 WHERE id = 2 AND tipo = 'app'` after the read-only checks in spec section 9).

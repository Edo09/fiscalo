# e-CF write-ahead (facturas), Release 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Release 1 of the write-ahead. The `facturas` row (e-NCF, signed XML, RFCE XML, `codigo_seguridad`, items) is committed **before** the e-CF goes to the DGII and updated with the answer afterwards. An unknown outcome leaves the row in `PENDIENTE_ENVIO`/`ENVIO_INCIERTO`. The user sees it through:
- a 502 carrying `data.factura_id`;
- the "Pendientes" filter;
- the "Sin confirmar" KPI and chip;
- the detail card.

Support resolves those rows by hand with the spec 10.2 procedure. The number is never reused while its row is unresolved, and nothing the app emits can be lost again.

**Architecture:**
- **Hook.** `ECFEmissionService::emitir(array $payload, ?callable $persistencia = null)` calls the hook in three phases:
  - `'reservar'` is the last statement of the rollback-protected try. It runs after build, sign, RFCE build+sign, the CR and token pre-flights and `autenticar`, and commits the row as `PENDIENTE_ENVIO`.
  - `'confirmar'` writes the DGII answer **before** `reclamarSecuenciaSiNoUtilizada`.
  - `'incierto'` marks `ENVIO_INCIERTO` when the send or the confirm throws. The service then throws `EcfEnvioInciertoException`.

  A static shutdown registry marks every row still in flight after a fatal. Without a hook (integration, gastos), the behaviour is unchanged.
- **Model.** `facturaModel` gains:
  - `reservarFacturaECF`: one transaction with `SELECT … FOR UPDATE`, a compare-and-set archive of a retryable prior row, the INSERT of the row and its items, and one retry on deadlock 1213;
  - `confirmarFacturaECF`, `marcarEnvioIncierto`, `existeFactura`, `metaEnvio` and `normalizarNotaReferencia`.

  `saveFacturaConECF` is removed.
- **States.** `EstadosEcf` (`REINTENTABLES`, `EN_VUELO`, `SIN_VEREDICTO`, `SIN_STOCK`) is the single source of the state lists. Its consumers are the service, `facturaModel`, `facturaController` and `ReporteVentasModel`.
- **Controller.**
  - It builds `$facturaInput` before `emitir`, passes a closure over the model, and adds a 422 guard for a non-numeric `monto_total`.
  - Its 502 "incierto" carries `data{factura_id, e_ncf, tipo_ecf, estado_dgii}` and takes the e-NCF from the row.
  - It moves stock once, only outside `SIN_STOCK`, at emission or on the first acceptance seen at consult.
  - `GET /estado` answers in-flight rows with a note and no DGII call, and the list accepts `?estado=pendiente`.
- **Reads.**
  - The money series of `GET /api/facturas/stats` and the ventas report exclude in-flight rows.
  - The row counts keep them.
  - The saldo of a new note and the linked notes include them.
- **Frontend.**
  - Labels and tones for the new states.
  - The "Pendientes" filter, the "Sin confirmar" KPI and chip, and that KPI on the e-CF dashboard.
  - The 502 toast with "Ver factura" and a locked form.
  - The detail card, its note and its footer.
  - Emission-only timeout and server-failure texts.

**Tech Stack:**
- PHP 8.3 in production (8.5.8 locally; no 8.4+ syntax), no Composer, classes loaded with `require_once` only.
- PDO MySQL with emulated prepares, MySQL/MariaDB InnoDB.
- React 18 + TypeScript + Vite, TanStack Query, sonner 2.0.7.
- Node v25 for the TypeScript test scripts.

**Spec:** `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead/docs/superpowers/specs/2026-10-05-ecf-write-ahead-design.md`. The plan implements sections 2 and 2.1, the Release 1 parts of 4, then 5, 6, 7.1–7.3, 8, 9.1, 10.2, the Release 1 rows of 11, the Release 1 parts of 12.0–12.4, 13.1 and 13.3.
  - The first two bullets of the 12.3.8 staging run (emission and forced failure) and the staging half of 12.0 step 1 are Task 29.
  - 13.1 (gate on every tenant, baseline, deploy order, read-only smoke, log watch) is Task 30, a handoff the user runs; the agent never touches production.
- Every `file:line` below is re-pinned on api-gratex `9f669ad` and fiscalo `a9bf56c`. The API worktree is at `9f669ad`; the FE worktree is at `0afde39` (`docs(spec): decision 7`), on `a9bf56c`.
- The spec's `facturaController.php` references shift by +3 after `:66`.
- `facturaModel.php` references are re-pinned in each task.

**Out of this plan (Release 2):**
- `EcfConsultaDgii`, `consultarTrackIds` and `reenviarFirmado`.
- `EcfReconciliador` and the full `GET /estado` branch with the 180 s rule. `POST /reenviar` is implemented in no release: it keeps answering 501 (decision 7).
- `anotarEnvioIncierto`, `getEnVuelo` and the R2 `getXmlFirmado`. The name `getXmlFirmado` is already taken by `facturaModel::getXmlFirmado(int $facturaId, string $type = 'ecf'): ?array` at `facturaModel.php:1329`, used by `facturaController.php:916`, so Release 2 must pick another name.
- `tools/ecf_en_vuelo.php`.
- Release 2: the "Verificar en la DGII" button. No "Reenviar a la DGII" button and no `reenviarFactura` in any release (decision 7).

**Repos:**
- **API** = `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`, branch `feat/ecf-write-ahead` at `9f669ad`.
- **FE** = `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`, branch `feat/ecf-write-ahead` at `0afde39`, on `a9bf56c`. This plan file is committed there by Task 21 Step 0.

## Global Constraints

Copied verbatim from the spec.

**Section 2, decisions taken:**

| # | Topic | Decision |
|---|---|---|
| 1 | Approach | **Write-ahead**: the row is committed before the DGII send and updated after it. We do not add a safety net that only reacts after a failure. |
| 2 | Scope | **Facturas only**: `ECFEmissionService` + `facturaController` + `facturaModel` + frontend. Gastos adopt the same pattern later, in a separate change (forward note in 14). Integration tenants (`integracionEcfController`, no tenant DB) are untouched: the hook is optional and absent there. |
| 3 | Schema | **No runtime schema fallback.** Out are: any schema probe (`EsquemaTenant`), cross-ambiente predicates, clamping of `estado_dgii`, an `esquema` block in `GET /api/facturas/stats` and an admin banner. Migrations **027 and 028 applied on every tenant DB are a release gate**, checked with `tools/verificar_migraciones_tenant.sql` before deploying. `eNcfYaUsado` keeps its per-ambiente predicate, and the reserve uses the same predicate. What happens if someone deploys without them anyway is stated in 6.2. The deploy-order rule goes into `API/CLAUDE.md` and `docs/integrations/alta-tenant-runbook.md` as part of the work. |
| 4 | Printing | **Printing stays exactly as today** ("stay as it is, do not show preview"). An in-flight row prints its PDF and receipt like any other row. There is no PREVIEW watermark, no blanking of `codigo_seguridad`, no hidden "Imprimir recibo" and no relabeled "Ver PDF". The trade-off is accepted (15.1). |
| 5 | Releases | **Two releases, each deployable on its own.** Release 1 is the core that guarantees no loss; Release 2 is recovery. Every component is assigned in section 11. |
| 6 | Testing | Local PHP has no `pdo_mysql`. DB tests run on a local MySQL scratch tenant or a staging tenant, **never production** (the frontend `.env` proxies to production). The DGII is mocked by a local PHP server (12.2). Production runs PHP 8.3. |
| 7 | No resend from the app | **Taken on 2026-10-05, after the approval; it overrides the spec where they conflict.** The user: "do not give the user the ability to send a ecf again if it fails". Resending is removed from the app, and unconfirmed invoices are resolved only by support. There is no "Reenviar a la DGII" button, no frontend `reenviarFactura()`, no `POST /api/facturas/{id}/reenviar` endpoint (the existing route keeps answering 501 as today, `handleReenviar` at `facturaController.php:795-798`; it is not implemented) and no `puede_reenviar` field in any API response (Release 1 or 2). Re-sending the stored signed XML exists **only** in the support CLI `tools/ecf_en_vuelo.php --reenviar` (Release 2), through `EcfReconciliador::reenviar()`, with the same duplicate guard, lock and ordering rules (10.3). The read-only lookup stays in the app: `GET /api/facturas/{id}/estado` (the Release 2 full branch with the DGII lookup) and the "Verificar en la DGII" button. Notes that offered a re-send now send the user to support, for example `'La DGII no tiene registro de este comprobante. Avisa a soporte con el número E310000000123: no lo emitas de nuevo.'`. **Unchanged:** a pre-send failure (nothing reached the DGII, number returned) still lets the cashier retry; a DGII rejection can still be corrected and emitted again; the 502 incierto still keeps the form locked with "Ver factura". |

Re-pin for row 7: `handleReenviar` is at `facturaController.php:798-801` on `9f669ad` (the spec's `:795-798` was pinned before it; see Task 18).

**Section 4.2, ordering rules and invariants:**

1. **Commit before send.** The reserve transaction commits before any DGII call. From the reserve's COMMIT to the end
   of the request no transaction is open. Every later write is a single autocommit statement.
2. **Row first, counter second.** `rollbackECFSequence` runs only after the row that owns the number reached its
   retryable state. That holds in the emitting request (confirm before reclamar), in the Release 2 reconciler and
   in the manual procedure. A concurrent dispense that lands on the number in between sees a `RECHAZADO` row, which
   is retryable, so it does not skip it.
3. **Read meta before overwrite.** `confirmarFacturaECF` overwrites `respuesta_dgii`. Any caller that needs the
   sequence meta (`rango_id`, `secuencia_valor`, `ambiente_secuencia`) reads it with `facturaModel::metaEnvio()`
   **before** the UPDATE.
4. **Stock once.** Inventory moves only after a DGII verdict outside `EstadosEcf::SIN_STOCK`, and only if
   `inventoryModel::yaMovioDocumento('factura', $id)` is false. It never moves for a row in flight.
5. **No XML in `respuesta_dgii` or the audit.** Only projected, capped arrays go there (4.4).
6. **No deletion.** No API or CLI path deletes an e-CF row; PUT and DELETE keep answering 405
   (`facturaController.php:126-140`).
7. **Occupied stays occupied.** Rows in flight occupy their number in `eNcfYaUsado` and in the reserve check, and are
   never archived automatically.

**Section 12.1, ground rules:**

- **No test framework.** Tests are one-off `php tools/*.php` scripts with the `check()` `[PASS]/[FAIL]` pattern of
  `tools/test_facturas_simples.php:9`, plus `.http` files under `tests/`.
- **No database locally:** local PHP has no `pdo_mysql`.
  - **DB-free scripts** run locally.
  - **DB scripts** run against a **local MySQL scratch tenant** built from `db/tenant_schema.sql` with
    `tools/create_tenant.php`, or against a **staging tenant**.
  - **Never production.** The frontend `.env` proxies to production, so every frontend check uses a local mock API
    (`API_PROXY_TARGET`).
- **PHP version.** Production runs PHP 8.3 and lint runs locally on 8.5. New code must not use 8.4+ features:
  property hooks, asymmetric visibility, `new Foo()->bar()` without parentheses, `array_find`/`array_any`/`array_all`.
  `readonly` properties and `catch (Throwable)` without a variable are fine (8.1/8.0).
- **`php -l`** on every touched file.

**Environment and conventions (binding):**
- **API commits** go on `feat/ecf-write-ahead` in the API worktree; **FE commits** on `feat/ecf-write-ahead` in the FE worktree.
- **Commit messages** are in Spanish, conventional style (`feat(ecf): …`, `fix(…)`, `docs(…)`, `test(…)`), and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **`git add` only the paths each task names**, never `-A`. The API worktree holds the untracked file `tools/reconstruir_e340000000001.sql`; never stage, edit or delete it.
- **Comments and messages:**
  - Code comments are in Spanish without accents (repo style).
  - User-facing strings are in Spanish with accents, exactly as the spec gives them.
  - Technical detail goes to `error_log`, not to the user.
- **Shared checkouts:** re-read every file right before editing it, and make targeted edits only.
- **Line endings (API):** the API files this plan edits are CRLF on disk (`git ls-files --eol` shows `w/crlf`): `src/Controllers/facturaController.php`, `src/Models/facturaModel.php` (also `i/crlf` in the index), `src/Utils/FacturacionElectronica/ECFEmissionService.php`, `src/Models/ncfModel.php`, the other touched `src/**/*.php`, `docs/**/*.md`, `CLAUDE.md` and `tools/*.php`.
  - The Edit tool keeps CRLF, so targeted edits are safe.
  - A script that edits one of them line by line must normalize first and restore the ending on write:
    `$orig = file_get_contents($ruta); $crlf = str_contains($orig, "\r\n"); $lineas = explode("\n", str_replace("\r\n", "\n", $orig));` … `file_put_contents($ruta, implode($crlf ? "\r\n" : "\n", $lineas));`.
    Without that, every exact comparison such as `$l === '    try {'` fails on the trailing `"\r"`.
- **Test commands:**
  - DB-free PHP tests run with plain `php`.
  - DB and HTTP tests run with `php -d extension=curl -d extension=openssl -d extension=pdo_mysql <script>`.
  - The local php.ini is never edited; the `-d` flags are enough, verified on 8.5.8.
- **FE gates:** `npm run typecheck`, `npx eslint src scripts`, `npm run build`. Node test scripts import only relative `.ts` paths at runtime (`import type` from `@/…` is fine, because Node strips it).

## Resolved decisions (re-pin discrepancies; where they differ from the spec, these win)

**Service**
1. **D1:** `$bearerToken`/`$ambiente` (`ECFEmissionService.php:371-372`) move inside the pre-send try, right after the token pre-flight. The `'reservar'` ctx `ambiente` is that `$ambiente`.
2. **D2:** the pre-send catch first rolls back any open transaction when `$persistencia !== null`, wrapped in its own try. Without this, a hook that throws mid-transaction would swallow the counter decrement.
3. **D3:** `ncfModel::rollbackECFSequence` gains an `error_log` in its silent PDO catch (`ncfModel.php:223-225`). The audit keeps the spec text `'rollback sin coincidencia'`.
4. **D4:** the hook's `'reservar'` return is validated (`is_array` and `(int) factura_id > 0`). Otherwise `$reserva = null` and `RuntimeException('persistencia no devolvio factura_id')` is thrown, which restores the counter.
5. **D5:** `$ctxConfirmar = null;` is set before the send try, and the catch tests `$ctxConfirmar !== null`, not `isset`.
6. **D9:** the token pre-flight is kept but is not purely defensive. `normalizeTokenResponse` accepts a whitespace-only token (`DgiiAuthService.php:505`). The comment says so.
7. **For an `e_ncf` override,** ctx `secuencia_valor` and `rango_id` are `null`, not 0.

**Model**
8. **JSON writes:** every new JSON write (`reservar`, `confirmar`, `marcar`) uses `json_encode($v, JSON_INVALID_UTF8_SUBSTITUTE)`. A `json_encode` that returns false can therefore never write `''`.
9. **`EstadosEcf`** gets one pure static helper, `sql(array $estados): string`, which returns the quoted inline list. It has no dependencies. Every inline SQL list of these states goes through it: the stats, the ventas report and `facturaModel`.
10. **`facturaModel::ESTADOS_NOTA_VIGENTE`** is derived: `['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', ...EstadosEcf::EN_VUELO]`. That one change moves the saldo (`sqlReferencia`) and the linked notes together. `tools/test_notas_vinculadas.php` changes in the same commit.
11. **Stats exclusions** keep NULL rows. They are written as `(estado_dgii IS NULL OR estado_dgii NOT IN (…))` or as `CASE WHEN estado_dgii IN (…) THEN 0 ELSE total END`, never as a bare `NOT IN`. `resumen.monto_neto` also excludes in-flight rows (2.1).
12. **The `'pendiente'` filter** uses named placeholders `:est0`…`:est5`, because the same params feed both `bindValue` and `execute($params)`. The ventas report exclusion is inlined from the constants, so its positional `?` params stay as they are.
13. **`inventoryModel::yaMovioDocumento`** lets `PDOException` propagate. The callers catch, log and do not move stock, which keeps "at most once".
14. **Deadlock retry:** on the first 1213, `reservarFacturaECF` logs `[ECF e-NCF=%s] reservar: deadlock (1213), reintento`. The 1062/1213 decision uses `$e->errorInfo[1]`, never SQLSTATE.
15. **`respuesta_dgii` assertions (12.3.3):** in-flight rows must decode to an array with the 6.3 keys. Confirmed rows hold NULL (RFCE) or valid JSON, below 65535 bytes, with no `signed_xml`, `rfce_xml` or `<`. A raw `ENVIADO` 2xx body is stored as a JSON string, as today.

**Controller**
16. **Inventory helpers:** one guarded loader, `inventarioModelo()`, and one gate, `moverStockFacturaEcf()`, serve both emission and consult.
17. **The consult-time stock move** needs all of these:
    - a real transition into an accepted state;
    - `updateECFEstado` returned true;
    - `!yaMovioDocumento`.

    Empty items (`getFacturaItems` returns `[]` on a DB error) are logged.
18. **The 7.3 body** passes `secuencia_utilizada` through `normalizeSecuenciaUtilizada` (`getECFData` returns `"0"`/`"1"`/null).

**Tests**
19. **Output format:**
    - PHP tests print `[OK  ]`/`[FALLO]` and end with `N de M pruebas OK`, exiting 1 on failure (house style of `tools/test_notas_vinculadas.php`).
    - TS scripts print `[OK  ]`/`[FALLA]` and end with `N/M OK`.

    Both styles already exist in the repo; this replaces 12.1's `[PASS]/[FAIL]`.
20. **Scratch DB.** The scratch base is built by `tools/write_ahead_test_lib.php --preparar`, not by `tools/create_tenant.php`, which needs the master DB. It also needs three tables taken from `db/master_schema.sql`, created only in the scratch:
    - single-tenant versions of `users` and `api_tokens`, because single-tenant login reads them from `DB_NAME`;
    - `dgii_provincia_municipio`, because `provinciaMunicipioModel` connects to the MASTER DB on every emission (`provinciaMunicipioModel.php:22-25`, `ECFEmissionService.php:112-127`).

    DB helpers refuse any base without the marker table `zz_write_ahead_scratch`.
21. **API scenarios:** `tools/test_write_ahead_api.php` automates the 12.3.5 scenarios against a local `php -S` API plus the mock. `tests/test_facturas_write_ahead.http` is the human copy of the same scenarios.

**Frontend**
22. **Labels and `isRechazo`:**
    - `isRechazo` moves unchanged; gastos uses it at `GastoDetailDrawer.tsx:83`.
    - New archived and truncated literals get the label "Rechazado" but stay out of the "Rechazados" KPI, as before.
    - `RE_ESTADO_DGII` only adds `PENDIENTE_ENVIO|ENVIO_INCIERTO`.
23. **Linked notes:**
    - `anuladaPor` counts only `ACEPTADO`/`ACEPTADO_CONDICIONAL` notes.
    - The note shown under the e-NCF is either an accepted annulment ("Anulada por …"), or else an in-flight code-1 credit note, or else `notas[0]`.
    - It gets the suffix ` (sin confirmar)` when `isEnVuelo(estadoDgii)`.
    - A code-1 note in `EN_PROCESO`/`ENVIADO` shows plain "Nota de crédito …".
    - The detail subtitle "Anulada por…" shows only for an accepted annulment.
24. **Locked form:** after a 502 incierto the form stays locked:
    - the Emitir button reads "Emisión sin confirmar";
    - a "Ver factura" button sits in the bar, because the endless toast can be dismissed.
25. **e-CF dashboard:** "Total e-CF" spans both columns, and the four buckets (Aceptados, En proceso, Rechazados, Sin confirmar) fill the 2x2 grid.

## Execution order

| Chain | Order | Notes |
|---|---|---|
| API | T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20 | T2 step 1 waits for the user's choice of database server. |
| FE | T21 → T22 → T23 → T24 → T25 → T26 → T27 | Runs in parallel with the API chain. |
| Both | T28 | Needs both chains. |
| Staging | T29 | After T28. Every deploy, restart and emission waits for the user's explicit yes. |
| Rollout | T30 | Last. A handoff the user runs on every tenant and in production; the agent runs nothing against production. |

## Review Focus

These are the failure modes most likely to bite users, each with the task that pins it with a test.

1. **The reserve under real InnoDB.** This covers the gap locks of `SELECT … FOR UPDATE` on a missing e-NCF, 1062 versus 1213 with one retry, FK 1452 not being "occupied", and the overflow when 028 is missing. The fake PDO only proves the control flow. **Pinned in Task 8** (`tools/test_reservar_confirmar.php`):
   - two child processes reserve the same number;
   - a crossed `FOR UPDATE` pair runs with `innodb_lock_wait_timeout = 1`;
   - FK 1452;
   - a strict `VARCHAR(20)` overflow on the broken copy.
2. **Counter versus row at every exit of `emitir()`.** The row comes first and the counter second, and nothing is reverted once a row owns the number. This includes a hook that throws with a transaction open (D2), a hook that returns garbage (D4), and a `CONFIRM_RACE` that skips the reclaim. **Pinned in Tasks 12 and 13** (`tools/test_write_ahead_ecf.php`, with a `FakeNcf` spy recording the order of `confirmar` and `rollbackECFSequence`).
3. **The shutdown registry after a real fatal.** It runs after `ErrorHandler::onShutdown`, needs a live PDO, and covers two service instances in one process. **Pinned in Task 14:** a child `php` dies of memory exhaustion after the second reserve, and both rows end `ENVIO_INCIERTO` with `fase_fallida = shutdown`.
4. **Stock moves at most once per factura.** That means:
   - the emission gate (`SIN_STOCK` plus `yaMovioDocumento`);
   - the first acceptance at consult, only on a real transition;
   - legacy accepted rows never moved by a later `GET /estado`;
   - a rejected-then-retried number.

   **Pinned in Tasks 17 and 18** (`tools/test_write_ahead_api.php`, counting `inventory_movements` per `factura_id`).
5. **The 502 "incierto" reaching the cashier.** `data` must survive from `http.ts` into `ApiError.datos`, `humanizar` must keep the server text, and the form must stay locked with "Ver factura". **Pinned in Task 24** (`scripts/test-en-vuelo.ts`, `scripts/check-errores.ts`) **and Task 28** (a browser check against the local mock API).

## File Structure

### API worktree (`C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`)

**Create**

| File | Task(s) | Responsibility |
|---|---|---|
| `src/Utils/FacturacionElectronica/EstadosEcf.php` | T4 | The four state lists of spec 4.6 plus the `PENDIENTE_ENVIO`/`ENVIO_INCIERTO` scalars and the pure `sql()` list helper. It has no dependencies. |
| `src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php` | T5 | "A row already owns this e-NCF": a user text plus a technical text naming the e-NCF, the ambiente and the cause. |
| `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php` | T5 | "Sent to the DGII without confirmation": readonly `eNcf`, `facturaId`, `ambiente`, `faseFallida`, `resultadoParcial`, `marcado`. |
| `tools/write_ahead_test_lib.php` | T1 (checks, args, child servers, HTTP, mock control), T2 (scratch guard/prepare/seed, test cert, API harness) | Shared test helpers. Nothing connects on include. |
| `tools/mock_dgii.php` | T1 | `php -S` router that fakes the DGII routes by mode, with a request log and a runtime mode switch (spec 12.2). |
| `tools/test_mock_dgii.php` | T1 | Proves the mock through the real `DgiiAuthService`/`DgiiReceptionService`. |
| `tools/test_write_ahead_gate.php` | T3 | 12.0 steps 1-2: the verifier on the scratch base says APLICADA and on the deliberately broken copy says FALTA. |
| `tools/test_write_ahead_puro.php` | T4 creates; T5-T11, T15-T19 add sections | DB-free checks: constants, exceptions, projections, model control flow with a fake PDO, SQL text, controller and docs text. |
| `tools/test_reservar_confirmar.php` | T8 creates; T9, T10 add cases | Model level on the scratch DB (12.3.4): reserve, confirm, mark, concurrency, deadlock, FK, strict overflow, dispense throw. |
| `tools/test_write_ahead_ecf.php` | T12 creates; T13, T14 add cases | Service level on the scratch DB with fakes (12.3.3): phase order, counter delta, rows, audit, shutdown. |
| `tools/test_write_ahead_api.php` | T17 creates; T18, T20 add scenarios | End-to-end through a local `php -S` API plus the mock (12.3.5, 12.0 steps 3-4). |
| `tests/test_facturas_write_ahead.http` | T20 | Human-runnable copy of the Release 1 HTTP scenarios. |

**Modify**

| File | Task(s) | Change |
|---|---|---|
| `src/Utils/FacturacionElectronica/ECFEmissionService.php` | T11, T12, T13, T14 | Constructor injection; projections; the `$persistencia` hook (reserve, confirm, incierto); shutdown registry; `factura_id` in the returns. |
| `src/Utils/FacturacionElectronica/DgiiReceptionService.php` | T10 | `assertSinCarriageReturn` becomes `public static`. |
| `src/Models/ncfModel.php` | T10 | `dispenseNextECF` throws `RuntimeException` on `PDOException`; `rollbackECFSequence` logs its PDO failure. |
| `src/Models/facturaModel.php` | T6, T7, T8, T9, T16, T17 | T6: `metaEnvio`, derived `ESTADOS_NOTA_VIGENTE`, `'pendiente'` filter. T7: `normalizarNotaReferencia`. T8: `reservarFacturaECF`. T9: `confirmarFacturaECF`, `marcarEnvioIncierto`, `existeFactura`. T16: stats exclusions. T17: `saveFacturaConECF` removed. |
| `src/Models/inventoryModel.php` | T15 | `yaMovioDocumento`. |
| `src/Models/ReporteVentasModel.php` | T16 | In-flight rows excluded from `fetchDocumentos`. |
| `src/Controllers/facturaController.php` | T17, T18 | T17: emission write-ahead, 502 incierto, 422 total guard, stock gate. T18: minimal in-flight `GET /estado`, first-acceptance stock move, `'pendiente'` filter. |
| `src/Utils/FacturaPdfGenerator.php` | T19 | Comment at `:466` reworded (no `saveFacturaConECF`). |
| `tools/check_estado_dgii_ancho.php` | T4 | Also checks `EstadosEcf::EN_VUELO` against the column width. |
| `tools/test_notas_vinculadas.php` | T6, T16 | Pinned literals updated to the derived state list and the new money SQL. |
| `CLAUDE.md`, `docs/integrations/alta-tenant-runbook.md`, `docs/integrations/dgii-ecf.md`, `docs/api/facturas.md`, `docs/modules/auditoria.md`, `docs/database/schema.md`, `docs/modules/reporte-ventas.md`, `docs/modules/inventario.md`, `docs/architecture.md`, `docs/modules/gastos.md` | T19 | Deploy-order rule, the 10.2 procedure, contracts, vocabulary, schema and module notes. |

### FE worktree (`C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`)

**Create**

| File | Task(s) | Responsibility |
|---|---|---|
| `src/api/estadosDgii.ts` | T21 | Dependency-free DGII state labels: `dgiiLabel`, `isRechazo` (moved unchanged), `isEnVuelo`, `ESTADOS_EN_VUELO`. |
| `src/features/invoices/enVuelo.ts` | T24 | Pure in-flight helpers: the "Sin confirmar" count, chip text, reading a 502 incierto, the `Factura` for "Ver factura", detail card text and footer. Relative `.ts` runtime imports only. |
| `scripts/check-errores.ts` | T21 creates (labels); T22 (error texts); T24 (card/footer texts) | Spec 12.4 assertions over `errores.ts`, `estadosDgii.ts` and `enVuelo.ts`. |
| `scripts/test-en-vuelo.ts` | T24 | Node tests of `enVuelo.ts`. |

**Modify**

| File | Task(s) | Change |
|---|---|---|
| `src/api/types.ts` | T21 | `EstadoDgii`, `FacturaEstadoFiltro`, `EstadoData`. |
| `src/api/mappers.ts` | T21 | Imports and re-exports the labels from `estadosDgii.ts`. |
| `src/api/index.ts` | T21 | Exports `isEnVuelo`. |
| `src/stores/facturasList.ts` | T21 | `FacturaEstadoUi` gains `'pendiente'`. |
| `src/components/ui/Badge.tsx` | T21 | Tones for "Por enviar" and "Sin confirmar". |
| `docs/database-structure.md`, `ecf-api-payloads.md` | T21 | `uk_e_ncf_amb`, `varchar(40)`, the state list, the `pendiente` filter. |
| `src/api/errores.ts` | T22 | Whitelist, `MSG_TARDO_EMISION`, emission server-failure text. |
| `src/features/invoices/notasVinculadas.ts` | T23 | `anuladaPor` counts accepted notes only; ` (sin confirmar)` suffix. |
| `scripts/test-notas-vinculadas.ts` | T23 | New cases for that rule. |
| `src/features/invoices/InvoiceListView.tsx` | T25 | "Pendientes" option, "Sin confirmar" KPI, header chip. |
| `src/features/ecf/EcfDashboardView.tsx` | T25 | "Sin confirmar" KPI; Total spans the row. |
| `src/features/invoices/InvoiceFormView.tsx` | T26 | 502 incierto: endless toast with "Ver factura", locked form, bar button. |
| `src/features/invoices/InvoiceDetailView.tsx` | T27 | In-flight card with the 7.3 note, a lone note, `estado.error` in the band, footer. |
| `src/config/cache.ts` | T27 | Comment at `:37-38` names the in-flight states. |

**Not committed**
- A Node mock API plus vite launcher in the session scratchpad (T28).
- A temporary `.claude/launch.json` entry, removed at the end of T28.

## Tasks

### Task 1: Mock DGII y ayudas comunes de prueba

**Files:**
- Create: `tools/write_ahead_test_lib.php`. It holds helpers only and no DB code; including it runs nothing.
- Create: `tools/mock_dgii.php`, a `php -S` router script.
- Create: `tools/test_mock_dgii.php`.
- Test: `tools/test_mock_dgii.php`. It needs no database and runs locally today.

All paths are relative to the API worktree `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`. Pins re-checked on `9f669ad`:

| What | Where |
|---|---|
| `DgiiAuthService::obtenerSemilla` | `:24-47` (endpoint `buildEndpoint` `:190-198`) |
| `validarSemillaFirmada` | `:57-79` |
| `consultarEndpointAutenticado` | `:112-153`. Throws at `:141-144`; returns the raw string as `data` at `:150` |
| `curlRequest` | `'HTTP request failed: '` at `:389-394` |
| `normalizeTokenResponse` | `:503-514` |
| `responseSummary` | 500-character cap at `:538-546` |
| `DgiiReceptionService::recibir` | `:29-63` |
| `recibirResumen` | `:70-103`, with the plain `getenv('DGII_FC_BASE_URL')` at `:74` |
| `consultarEstado` | `:154` path |
| `consultarResumenRFCE` | `:192` path |
| House output style | `tools/test_notas_vinculadas.php:24-35` and `:356-357` |

**Interfaces:**
- Consumes (existing, unchanged):
  - `DgiiAuthService::obtenerSemilla(array $options = []): array`
  - `DgiiAuthService::validarSemillaFirmada(string $signedXml, array $options = []): array`
  - `DgiiReceptionService::recibir(string $signedXml, string $bearerToken, array $options = []): array`
  - `DgiiReceptionService::recibirResumen(string $signedXml, string $bearerToken, array $options = []): array`
  - `DgiiReceptionService::consultarEstado(string $trackId, string $rnc, string $eNcf, string $bearerToken, array $options = []): array`
  - `DgiiReceptionService::consultarResumenRFCE(string $rnc, string $eNcf, string $codigoSeguridad, string $bearerToken, array $options = []): array`
  - Options used: `base_url`, `fc_base_url`, `environment`, `timeout`.
- Produces:

```php
// tools/write_ahead_test_lib.php
function wa_chk(string $desc, bool $ok, mixed $obtenido = null): void
function wa_fin(): never   // prints "\nN de M pruebas OK\n"; exit(1) if any check failed, else exit(0)
function wa_arg(string $nombre, ?string $defecto = null): ?string   // --nombre=valor; bare --nombre returns ''
function wa_php_flags(): array   // ['-d','extension=curl', ...] only for extensions a flag-less php does not load
function wa_puerto_abierto(int $puerto): bool   // helper
function wa_servidor(string $nombre, string $router, int $puerto, array $env = []): string   // 'http://127.0.0.1:<puerto>'
function wa_http(string $metodo, string $url, mixed $cuerpo = null, array $headers = [], int $timeout = 60): array   // ['status','body','json']
function wa_mock_modo(string $mockUrl, string $modo): void
function wa_mock_log(string $mockUrl, bool $limpiar = false): array   // [{hora, metodo, ruta, modo}]; limpiar returns, then empties
```

- Mock modes: `acepta`, `acepta_condicional`, `rechaza`, `rechaza_usada`, `cuelga`, `html500`, `raw200`, `trackids_vacio`, `trackids_uno`, `trackids_404`, `trackids_rechazado`.
- Mock env: `MOCK_DGII_MODE` (initial mode of a new server), `MOCK_DGII_CUELGA_SEG` (default 10).
- Mock trackId: `'track-' . $eNcf`, read from `<eNCF>(E[0-9]{12})</eNCF>` in the posted XML. RecepcionFC answers carry no `trackId`, as with the real RFCE.
- Mock reception status codes:
  - `rechaza` and `rechaza_usada` answer HTTP 400 with the JSON verdict, which `recibir()` tolerates;
  - `acepta`, `acepta_condicional` and `raw200` answer 200;
  - `html500` answers 500 HTML.
- Consult routes (Estado, consultarfce, TrackIds) answer Aceptado in every mode except the four `trackids_*` modes.

- [ ] **Step 1: Check the worktree and the PHP extensions**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git switch feat/ecf-write-ahead
git status --short
php -m | grep -i -E "^(curl|openssl|pdo_mysql|mbstring)$"
ls tools/write_ahead_test_lib.php tools/mock_dgii.php tools/test_mock_dgii.php 2>&1
```

Expected:
- `git status --short` prints only `?? tools/reconstruir_e340000000001.sql`. Never `git add -A`.
- `php -m` prints only `mbstring`: curl, openssl and pdo_mysql are not loaded (see Global Constraints, test commands).
- All three `ls` lines say `No such file or directory`.

- [ ] **Step 2: Write the failing test `tools/test_mock_dgii.php`**

```php
<?php
/**
 * test_mock_dgii.php — la DGII falsa (tools/mock_dgii.php) contestada por las
 * clases reales: DgiiAuthService (semilla) y DgiiReceptionService (recepcion
 * y consultas). Sin base de datos y sin red: todo en 127.0.0.1.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl tools/test_mock_dgii.php
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/DgiiReceptionService.php';

$mock = wa_servidor('mock_dgii', 'tools/mock_dgii.php', 8099, ['MOCK_DGII_CUELGA_SEG' => '5']);
// DgiiReceptionService lee DGII_FC_BASE_URL con getenv a secas.
putenv('DGII_FC_BASE_URL=' . $mock);
$opc = ['base_url' => $mock, 'fc_base_url' => $mock, 'environment' => 'certecf', 'timeout' => 3];
$auth = new DgiiAuthService();
$rec = new DgiiReceptionService($auth);
$xml = '<ECF><Encabezado><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF></IdDoc></Encabezado></ECF>';

wa_mock_modo($mock, 'acepta');
wa_mock_log($mock, true);

echo "1) Semilla y token\n";
$s = $auth->obtenerSemilla($opc);
wa_chk('semilla: trae fecha', ($s['fecha'] ?? null) !== null, $s);
$t = $auth->validarSemillaFirmada('<x/>', $opc);
wa_chk('validarsemilla: token tok-mock', ($t['token'] ?? null) === 'tok-mock', $t);

echo "2) Recepcion por modo\n";
/** recibir() en un modo: devuelve [resultado|null, excepcion|null, segundos]. */
$recibir = static function (string $modo) use ($mock, $rec, $xml, $opc): array {
    wa_mock_modo($mock, $modo);
    $t0 = microtime(true);
    try {
        return [$rec->recibir($xml, 'tok-mock', $opc), null, microtime(true) - $t0];
    } catch (Throwable $e) {
        return [null, $e, microtime(true) - $t0];
    }
};

[$r] = $recibir('acepta');
wa_chk('acepta: Aceptado con trackId track-E310000000001',
    ($r['status_code'] ?? 0) === 200 && ($r['data']['estado'] ?? null) === 'Aceptado'
    && ($r['data']['trackId'] ?? null) === 'track-E310000000001', $r);
[$r] = $recibir('acepta_condicional');
wa_chk('acepta_condicional: codigo 4', ($r['data']['codigo'] ?? null) === 4, $r);
[$r] = $recibir('rechaza');
wa_chk('rechaza: HTTP 400 con secuenciaUtilizada false',
    ($r['status_code'] ?? 0) === 400 && ($r['data']['secuenciaUtilizada'] ?? null) === false, $r);
[$r] = $recibir('rechaza_usada');
wa_chk('rechaza_usada: secuenciaUtilizada true', ($r['data']['secuenciaUtilizada'] ?? null) === true, $r);
[$r, $e, $seg] = $recibir('cuelga');
wa_chk("cuelga: RuntimeException 'HTTP request failed'",
    $e instanceof RuntimeException && str_contains($e->getMessage(), 'HTTP request failed'), $e?->getMessage() ?? $r);
wa_chk('cuelga: corta a los ~3 s del timeout', $seg >= 2.5 && $seg < 4.9, round($seg, 2));
[$r, $e] = $recibir('html500');
$prefijo = 'DGII authenticated request failed: ';
wa_chk('html500: RuntimeException de peticion autenticada fallida',
    $e instanceof RuntimeException && str_starts_with($e->getMessage(), $prefijo . 'HTTP 500'), $e?->getMessage() ?? $r);
wa_chk('html500: el resumen del cuerpo queda en 500 caracteres',
    $e !== null && strlen($e->getMessage()) <= strlen($prefijo . 'HTTP 500 - ') + 503, $e === null ? null : strlen($e->getMessage()));
[$r] = $recibir('raw200');
wa_chk("raw200: data es el texto 'Recibido'", ($r['data'] ?? null) === 'Recibido', $r);

echo "3) RFCE y consultas en acepta\n";
wa_mock_modo($mock, 'acepta');
$r = $rec->recibirResumen($xml, 'tok-mock', $opc);
wa_chk('recibirResumen: Aceptado', ($r['data']['estado'] ?? null) === 'Aceptado', $r);
$r = $rec->consultarEstado('track-E310000000001', '000000000', 'E310000000001', 'tok-mock', $opc);
wa_chk('ConsultaResultado: Aceptado', ($r['data']['estado'] ?? null) === 'Aceptado', $r);
$r = $rec->consultarResumenRFCE('000000000', 'E320000000001', 'ABC123', 'tok-mock', $opc);
wa_chk('consultarfce: Aceptado', ($r['data']['estado'] ?? null) === 'Aceptado', $r);

echo "4) Log de peticiones\n";
$log = wa_mock_log($mock);
$recep = '/certecf/Recepcion/api/FacturasElectronicas';
wa_chk('log: cada ruta DGII en orden', array_column($log, 'ruta') === [
    '/certecf/autenticacion/api/autenticacion/semilla',
    '/certecf/autenticacion/api/autenticacion/validarsemilla',
    $recep, $recep, $recep, $recep, $recep, $recep, $recep,
    '/certecf/RecepcionFC/api/recepcion/ecf',
    '/certecf/ConsultaResultado/api/Consultas/Estado',
    '/certecf/consultarfce/api/Consultas/Consulta',
], array_column($log, 'ruta'));
wa_chk('log: cada recepcion con su modo', array_slice(array_column($log, 'modo'), 2, 7)
    === ['acepta', 'acepta_condicional', 'rechaza', 'rechaza_usada', 'cuelga', 'html500', 'raw200'], array_column($log, 'modo'));

echo "5) TrackIds\n";
$tid = static fn(): array => wa_http('GET', $mock . '/certecf/consultatrackids/api/TrackIds/Consulta?RncEmisor=000000000&Encf=E310000000001');
$r = $tid();
wa_chk('TrackIds en acepta: un trackId Aceptado',
    ($r['json'][0]['trackId'] ?? null) === 'track-E310000000001' && ($r['json'][0]['estado'] ?? null) === 'Aceptado', $r);
wa_mock_modo($mock, 'trackids_vacio');
$r = $tid();
wa_chk('trackids_vacio: lista vacia', $r['status'] === 200 && $r['json'] === [], $r);
wa_mock_modo($mock, 'trackids_404');
$r = $tid();
wa_chk('trackids_404: HTTP 404', $r['status'] === 404, $r);
wa_mock_modo($mock, 'trackids_rechazado');
$r = $rec->consultarEstado('track-E310000000001', '000000000', 'E310000000001', 'tok-mock', $opc);
wa_chk('trackids_rechazado: Estado Rechazado sin consumir la secuencia',
    ($r['data']['estado'] ?? null) === 'Rechazado' && ($r['data']['secuenciaUtilizada'] ?? null) === false, $r);

echo "6) Control del mock\n";
$r = wa_http('GET', $mock . '/__mock/modo?valor=rechaza');
wa_chk('/__mock/modo?valor=rechaza lo cambia', ($r['json']['modo'] ?? null) === 'rechaza', $r);
$r = wa_http('GET', $mock . '/__mock/modo');
wa_chk('/__mock/modo lo lee', ($r['json']['modo'] ?? null) === 'rechaza', $r);
$r = wa_http('GET', $mock . '/__mock/modo?valor=no_existe');
wa_chk('/__mock/modo con un modo desconocido: 400', $r['status'] === 400, $r);
$r = wa_http('GET', $mock . '/certecf/no/existe');
wa_chk('ruta desconocida: 404', $r['status'] === 404, $r);

wa_mock_modo($mock, 'acepta');
wa_fin();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -d extension=curl -d extension=openssl tools/test_mock_dgii.php; echo "exit=$?"
```

Expected: `Warning: require_once(...tools/write_ahead_test_lib.php): Failed to open stream`, then `Fatal error: Uncaught Error: Failed opening required '...write_ahead_test_lib.php'`. The exit code is not 0.

- [ ] **Step 4: Write `tools/write_ahead_test_lib.php` (the half without a database)**

```php
<?php
/**
 * write_ahead_test_lib.php — ayudas comunes de las pruebas del write-ahead del
 * e-CF (spec docs/superpowers/specs/2026-10-05-ecf-write-ahead-design.md, 12).
 *
 * Incluirlo solo define funciones: no corre nada, no abre conexiones, no
 * arranca servidores.
 *
 * Como correr las pruebas que lo usan:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/<prueba>.php
 *   - Pon el -d solo de las extensiones que tu php.ini no carga (php -m las
 *     lista); si ya estan cargadas PHP avisa "already loaded" y sigue.
 *   - Nunca se edita el php.ini global. Los servidores hijos (php -S) reciben
 *     los mismos -d, calculados por wa_php_flags().
 *
 * Salida, igual que tools/test_notas_vinculadas.php: una linea "[OK  ] ..." o
 * "[FALLO] ..." por prueba, al final "N de M pruebas OK", y codigo de salida 1
 * si alguna fallo.
 */

/** Una prueba: imprime [OK  ]/[FALLO] y, si falla, lo obtenido (recortado). */
function wa_chk(string $desc, bool $ok, mixed $obtenido = null): void
{
    $GLOBALS['wa_total'] = ($GLOBALS['wa_total'] ?? 0) + 1;
    if (!$ok) {
        $GLOBALS['wa_fallos'] = ($GLOBALS['wa_fallos'] ?? 0) + 1;
    }
    printf("  [%s] %s\n", $ok ? 'OK  ' : 'FALLO', $desc);
    if (!$ok && $obtenido !== null) {
        $txt = (string) json_encode($obtenido, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        echo '         obtenido: ' . (strlen($txt) > 2000 ? substr($txt, 0, 2000) . '...' : $txt) . "\n";
    }
}

/** Resumen "N de M pruebas OK"; sale con 1 si alguna fallo, 0 si no. */
function wa_fin(): never
{
    $total = $GLOBALS['wa_total'] ?? 0;
    $fallos = $GLOBALS['wa_fallos'] ?? 0;
    echo "\n" . ($total - $fallos) . " de {$total} pruebas OK\n";
    exit($fallos > 0 ? 1 : 0);
}

/** Lee --nombre=valor de la linea de comandos. "--nombre" solo devuelve ''. */
function wa_arg(string $nombre, ?string $defecto = null): ?string
{
    foreach (array_slice($_SERVER['argv'] ?? [], 1) as $a) {
        if ($a === '--' . $nombre) {
            return '';
        }
        if (str_starts_with($a, '--' . $nombre . '=')) {
            return substr($a, strlen($nombre) + 3);
        }
    }
    return $defecto;
}

/**
 * Flags -d para un php hijo: solo las extensiones que el php.ini NO carga.
 * Se le pregunta a un php sin flags (lo que vera el hijo), no a este proceso:
 * este pudo arrancar con -d extension=... y el hijo no lo hereda.
 */
function wa_php_flags(): array
{
    static $flags = null;
    if ($flags !== null) {
        return $flags;
    }
    $cargadas = [];
    $proc = proc_open(
        [PHP_BINARY, '-r', 'echo implode(",", array_map("strtolower", get_loaded_extensions()));'],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes
    );
    if (is_resource($proc)) {
        $cargadas = explode(',', trim((string) stream_get_contents($pipes[1])));
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
    }
    $flags = [];
    foreach (['curl', 'openssl', 'pdo_mysql'] as $ext) {
        if (!in_array($ext, $cargadas, true)) {
            array_push($flags, '-d', 'extension=' . $ext);
        }
    }
    return $flags;
}

/** true si algo escucha en 127.0.0.1:$puerto. */
function wa_puerto_abierto(int $puerto): bool
{
    $f = @fsockopen('127.0.0.1', $puerto, $errno, $errstr, 0.2);
    if ($f === false) {
        return false;
    }
    fclose($f);
    return true;
}

/**
 * Arranca (o reutiliza) un "php -S 127.0.0.1:<puerto> <router>" con la raiz del
 * API como directorio de trabajo. El entorno del hijo es el de este proceso
 * mas $env, y corre con variables_order=EGPCS: Database y MasterDatabase leen
 * solo $_ENV. Su salida va a sys_get_temp_dir()/wa_<nombre>_<puerto>.log.
 * Se detiene solo al terminar este proceso.
 *
 * Un puerto ocupado se reutiliza solo si lo arranco un servidor del mismo
 * $nombre (queda anotado en wa_servidor_<puerto>.txt): asi una API vieja que
 * apunta a otra base nunca se confunde con la que se pidio.
 */
function wa_servidor(string $nombre, string $router, int $puerto, array $env = []): string
{
    $url = 'http://127.0.0.1:' . $puerto;
    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR;
    $anotado = $tmp . "wa_servidor_{$puerto}.txt";
    if (wa_puerto_abierto($puerto)) {
        $dueno = is_file($anotado) ? trim((string) file_get_contents($anotado)) : '';
        if ($dueno !== $nombre) {
            echo "[FALLO] el puerto {$puerto} ya lo usa otro proceso ('{$dueno}'), no '{$nombre}'. Detenlo y vuelve a correr.\n";
            exit(1);
        }
        return $url;
    }
    $log = $tmp . "wa_{$nombre}_{$puerto}.log";
    $cmd = array_merge([PHP_BINARY], wa_php_flags(), ['-d', 'variables_order=EGPCS', '-S', "127.0.0.1:{$puerto}", $router]);
    $entorno = array_merge(getenv(), array_map('strval', $env));
    $nulo = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    $proc = proc_open($cmd, [0 => ['file', $nulo, 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, dirname(__DIR__), $entorno);
    if (!is_resource($proc)) {
        echo "[FALLO] no se pudo lanzar php -S para {$nombre}\n";
        exit(1);
    }
    file_put_contents($anotado, $nombre);
    register_shutdown_function(static function () use ($proc, $anotado): void {
        if (is_resource($proc)) {
            proc_terminate($proc);
            proc_close($proc);
        }
        @unlink($anotado);
    });
    for ($i = 0; $i < 100; $i++) {
        if (wa_puerto_abierto($puerto)) {
            return $url;
        }
        usleep(100000);
    }
    echo "[FALLO] {$nombre} no arranco en 127.0.0.1:{$puerto} en 10 s (ver {$log})\n";
    exit(1);
}

/**
 * Peticion HTTP con curl. Un $cuerpo array va como JSON. Un fallo de red no
 * lanza: vuelve status 0 y el error de curl en body, para que la prueba lo
 * marque FALLO en vez de cortar todo el script.
 * @return array{status:int, body:string, json:?array}
 */
function wa_http(string $metodo, string $url, mixed $cuerpo = null, array $headers = [], int $timeout = 60): array
{
    if (!function_exists('curl_init')) {
        echo "[FALLO] wa_http necesita curl: corre con -d extension=curl\n";
        exit(1);
    }
    $body = null;
    if (is_array($cuerpo)) {
        $body = json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headers[] = 'Content-Type: application/json';
    } elseif ($cuerpo !== null) {
        $body = (string) $cuerpo;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => strtoupper($metodo),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $resp = curl_exec($ch);
    if ($resp === false) {
        return ['status' => 0, 'body' => 'curl: ' . curl_error($ch), 'json' => null];
    }
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $json = json_decode((string) $resp, true);
    return ['status' => $status, 'body' => (string) $resp, 'json' => is_array($json) ? $json : null];
}

/**
 * Cambia el modo del mock DGII. Tambien sincroniza: php -S atiende de a una
 * peticion, asi que esto espera a que termine un "cuelga" en curso.
 */
function wa_mock_modo(string $mockUrl, string $modo): void
{
    $r = wa_http('GET', rtrim($mockUrl, '/') . '/__mock/modo?valor=' . rawurlencode($modo), null, [], 60);
    if ($r['status'] !== 200 || ($r['json']['modo'] ?? null) !== $modo) {
        echo "[FALLO] no se pudo poner el mock en modo {$modo}: HTTP {$r['status']} " . substr($r['body'], 0, 300) . "\n";
        exit(1);
    }
}

/**
 * Peticiones DGII que recibio el mock, en orden: [{hora, metodo, ruta, modo}].
 * Con $limpiar las devuelve y vacia el log.
 */
function wa_mock_log(string $mockUrl, bool $limpiar = false): array
{
    $r = wa_http('GET', rtrim($mockUrl, '/') . '/__mock/log' . ($limpiar ? '?limpiar=1' : ''), null, [], 60);
    return is_array($r['json']) ? $r['json'] : [];
}
```

- [ ] **Step 5: Run the test again; now the mock router is missing**

```bash
php -d extension=curl -d extension=openssl tools/test_mock_dgii.php; echo "exit=$?"
```

Expected: `[FALLO] no se pudo poner el mock en modo acepta: HTTP 200 <br />...Failed opening required 'tools/mock_dgii.php'...`, then `exit=1`.

- [ ] **Step 6: Write `tools/mock_dgii.php`**

```php
<?php
/**
 * mock_dgii.php — DGII falsa para probar el write-ahead del e-CF sin salir de
 * la maquina (spec 12.2). Es un router de "php -S":
 *
 *   php -S 127.0.0.1:8099 tools/mock_dgii.php
 *
 * y la API apunta a ella con DGII_ECF_BASE_URL = DGII_FC_BASE_URL =
 * http://127.0.0.1:8099 y DGII_ECF_TIMEOUT=3. Nunca habla con la DGII real.
 *
 * Rutas DGII (despues de /testecf, /certecf o /ecf):
 *   GET  /autenticacion/api/autenticacion/semilla         siempre 200 (XML valor/fecha)
 *   POST /autenticacion/api/autenticacion/validarsemilla  siempre 200 (token tok-mock)
 *   POST /Recepcion/api/FacturasElectronicas              segun el modo
 *   POST /RecepcionFC/api/recepcion/ecf                   segun el modo
 *   GET  /ConsultaResultado/api/Consultas/Estado          Aceptado (salvo trackids_*)
 *   GET  /consultarfce/api/Consultas/Consulta             Aceptado (salvo trackids_*)
 *   GET  /consultatrackids/api/TrackIds/Consulta          un trackId Aceptado (salvo trackids_*)
 *
 * Modos (MOCK_DGII_MODE al arrancar, o GET /__mock/modo?valor=<modo>):
 *   acepta, acepta_condicional, rechaza, rechaza_usada, cuelga, html500,
 *   raw200, trackids_vacio, trackids_uno, trackids_404, trackids_rechazado.
 * En "cuelga" la recepcion duerme MOCK_DGII_CUELGA_SEG segundos (10 por
 * defecto) y despues responde {}. php -S atiende de a una peticion: la
 * siguiente espera a que termine, por eso wa_mock_modo() sincroniza.
 *
 * El trackId es 'track-' . <eNCF del XML recibido>, para que las pruebas lo
 * puedan predecir. Toda ruta DGII queda en el log ANTES de responder.
 *
 * Control: GET /__mock/modo[?valor=<modo>], GET /__mock/log[?limpiar=1].
 * Estado en sys_get_temp_dir(): mock_dgii_<puerto>_modo.txt ("<pid> <modo>")
 * y mock_dgii_<puerto>_log.jsonl. Un servidor nuevo (otro pid) arranca con el
 * modo de MOCK_DGII_MODE y el log vacio.
 */

const MD_MODOS = [
    'acepta', 'acepta_condicional', 'rechaza', 'rechaza_usada', 'cuelga', 'html500',
    'raw200', 'trackids_vacio', 'trackids_uno', 'trackids_404', 'trackids_rechazado',
];

$puerto = (int) ($_SERVER['SERVER_PORT'] ?? 0);
$tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mock_dgii_' . $puerto;
$archivoModo = $tmp . '_modo.txt';
$archivoLog = $tmp . '_log.jsonl';

// Mismo pid = mismo servidor (php -S es un solo proceso). Otro pid: el estado
// en disco es de una corrida anterior y se reinicia.
$guardado = is_file($archivoModo) ? explode(' ', trim((string) file_get_contents($archivoModo)), 2) : [];
if ((int) ($guardado[0] ?? 0) !== getmypid()) {
    $inicial = getenv('MOCK_DGII_MODE') ?: 'acepta';
    $guardado = [(string) getmypid(), in_array($inicial, MD_MODOS, true) ? $inicial : 'acepta'];
    file_put_contents($archivoModo, implode(' ', $guardado), LOCK_EX);
    file_put_contents($archivoLog, '', LOCK_EX);
}
$modo = $guardado[1] ?? 'acepta';

$metodo = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$ruta = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

/** Responde JSON y termina. */
function md_json(int $status, mixed $cuerpo, string $tipo = 'application/json'): never
{
    http_response_code($status);
    header('Content-Type: ' . $tipo . '; charset=utf-8');
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Cuerpo recibido. Un multipart llega en $_FILES: php://input viene vacio. */
function md_cuerpo(): string
{
    $partes = [(string) file_get_contents('php://input')];
    foreach ($_FILES as $f) {
        foreach ((array) ($f['tmp_name'] ?? []) as $tmp) {
            if (is_string($tmp) && $tmp !== '' && is_file($tmp)) {
                $partes[] = (string) file_get_contents($tmp);
            }
        }
    }
    foreach ($_POST as $v) {
        if (is_string($v)) {
            $partes[] = $v;
        }
    }
    return implode("\n", $partes);
}

/** e-NCF del XML recibido, o '' si no viene. */
function md_encf(string $cuerpo): string
{
    return preg_match('/<eNCF>\s*(E[0-9]{12})\s*<\/eNCF>/i', $cuerpo, $m) ? $m[1] : '';
}

// --- Control ---------------------------------------------------------------
if ($ruta === '/__mock/modo') {
    if (isset($_GET['valor'])) {
        $nuevo = (string) $_GET['valor'];
        if (!in_array($nuevo, MD_MODOS, true)) {
            md_json(400, ['error' => 'modo desconocido: ' . $nuevo, 'modos' => MD_MODOS]);
        }
        file_put_contents($archivoModo, getmypid() . ' ' . $nuevo, LOCK_EX);
        $modo = $nuevo;
    }
    md_json(200, ['modo' => $modo]);
}
if ($ruta === '/__mock/log') {
    $filas = [];
    foreach (file($archivoLog, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) {
        $fila = json_decode($l, true);
        if (is_array($fila)) {
            $filas[] = $fila;
        }
    }
    if (isset($_GET['limpiar'])) {
        file_put_contents($archivoLog, '', LOCK_EX);
    }
    md_json(200, $filas);
}

// --- Rutas DGII -------------------------------------------------------------
if (!preg_match('#^/(testecf|certecf|ecf)(/.*)$#i', $ruta, $m)) {
    md_json(404, ['error' => 'ruta desconocida del mock', 'ruta' => $ruta]);
}
$resto = strtolower($m[2]);
$conocidas = [
    '/autenticacion/api/autenticacion/semilla' => 'GET',
    '/autenticacion/api/autenticacion/validarsemilla' => 'POST',
    '/recepcion/api/facturaselectronicas' => 'POST',
    '/recepcionfc/api/recepcion/ecf' => 'POST',
    '/consultaresultado/api/consultas/estado' => 'GET',
    '/consultarfce/api/consultas/consulta' => 'GET',
    '/consultatrackids/api/trackids/consulta' => 'GET',
];
if (($conocidas[$resto] ?? null) !== $metodo) {
    md_json(404, ['error' => 'ruta desconocida del mock', 'ruta' => $ruta, 'metodo' => $metodo]);
}

// El log va ANTES de responder: si la peticion cuelga o el cliente corta, la
// prueba igual ve que la DGII "recibio" algo.
file_put_contents($archivoLog, json_encode([
    'hora' => date('Y-m-d H:i:s'), 'metodo' => $metodo, 'ruta' => $ruta, 'modo' => $modo,
], JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);

$ahora = new DateTimeImmutable();
$fechaRecepcion = $ahora->format('n/j/Y g:i:s A');   // ConsultaResultado: M/d/yyyy h:mm:ss tt
$mensajesOk = [['valor' => '', 'codigo' => 0]];
$rechazo = [['valor' => 'Rechazo de prueba del mock DGII', 'codigo' => 999]];

switch ($resto) {
    case '/autenticacion/api/autenticacion/semilla':
        http_response_code(200);
        header('Content-Type: text/xml; charset=utf-8');
        echo '<?xml version="1.0" encoding="utf-8"?>'
            . '<SemillaModel xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            . '<valor>' . bin2hex(random_bytes(16)) . '</valor>'
            . '<fecha>' . $ahora->format('Y-m-d\TH:i:s.vP') . '</fecha></SemillaModel>';
        exit;

    case '/autenticacion/api/autenticacion/validarsemilla':
        md_json(200, [
            'token' => 'tok-mock',
            'expira' => $ahora->modify('+1 hour')->format(DATE_ATOM),
            'expedido' => $ahora->format(DATE_ATOM),
        ]);

    case '/recepcion/api/facturaselectronicas':
    case '/recepcionfc/api/recepcion/ecf':
        $eNcf = md_encf(md_cuerpo());
        $esFc = $resto === '/recepcionfc/api/recepcion/ecf';
        // RecepcionFC (RFCE) no devuelve trackId; Recepcion si.
        $base = ($esFc ? [] : ['trackId' => 'track-' . $eNcf]) + ['encf' => $eNcf];
        switch ($modo) {
            case 'acepta_condicional':
                md_json(200, $base + ['codigo' => 4, 'estado' => 'Aceptado Condicional', 'secuenciaUtilizada' => true, 'mensajes' => $mensajesOk]);
            case 'rechaza':
                md_json(400, $base + ['codigo' => 2, 'estado' => 'Rechazado', 'secuenciaUtilizada' => false, 'mensajes' => $rechazo]);
            case 'rechaza_usada':
                md_json(400, $base + ['codigo' => 2, 'estado' => 'Rechazado', 'secuenciaUtilizada' => true, 'mensajes' => $rechazo]);
            case 'cuelga':
                sleep(max(1, (int) (getenv('MOCK_DGII_CUELGA_SEG') ?: 10)));
                md_json(200, new stdClass());
            case 'html500':
                http_response_code(500);
                header('Content-Type: text/html; charset=utf-8');
                echo '<html><head><title>500</title></head><body>'
                    . str_repeat('<p>Servicio de la DGII no disponible (mock).</p>', 4600)
                    . '</body></html>';
                exit;
            case 'raw200':
                http_response_code(200);
                header('Content-Type: text/plain; charset=utf-8');
                echo 'Recibido';
                exit;
            default:   // acepta y los trackids_*: la recepcion acepta
                md_json(200, $base + ['codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true, 'mensajes' => $mensajesOk]);
        }

    case '/consultaresultado/api/consultas/estado':
    case '/consultarfce/api/consultas/consulta':
        $eNcf = (string) ($_GET['encf'] ?? $_GET['ENCF'] ?? '');
        $base = ['trackId' => (string) ($_GET['trackId'] ?? ('track-' . $eNcf)), 'rnc' => (string) ($_GET['rnc'] ?? $_GET['RNC_Emisor'] ?? ''),
            'encf' => $eNcf, 'fechaRecepcion' => $fechaRecepcion];
        if ($modo === 'trackids_rechazado') {
            md_json(200, $base + ['codigo' => '2', 'estado' => 'Rechazado', 'secuenciaUtilizada' => false, 'mensajes' => $rechazo]);
        }
        if ($modo === 'trackids_vacio' || $modo === 'trackids_404') {
            md_json(200, $base + ['codigo' => '0', 'estado' => 'No Encontrado', 'secuenciaUtilizada' => false, 'mensajes' => $mensajesOk]);
        }
        md_json(200, $base + ['codigo' => '1', 'estado' => 'Aceptado', 'secuenciaUtilizada' => true, 'mensajes' => $mensajesOk]);

    case '/consultatrackids/api/trackids/consulta':
        $eNcf = (string) ($_GET['Encf'] ?? $_GET['encf'] ?? '');
        // Misma forma que la respuesta real guardada en tools/test_consultar_ecf_dgii.php:
        // lista de {trackId, estado, fechaRecepcion dd/MM/yyyy}.
        $uno = ['trackId' => 'track-' . $eNcf, 'estado' => 'Aceptado', 'fechaRecepcion' => $ahora->format('d/m/Y')];
        if ($modo === 'trackids_vacio') {
            md_json(200, []);
        }
        if ($modo === 'trackids_404') {
            md_json(404, ['type' => 'https://tools.ietf.org/html/rfc7231#section-6.5.4', 'title' => 'Not Found',
                'status' => 404, 'traceId' => '00-mock-00'], 'application/problem+json');
        }
        if ($modo === 'trackids_rechazado') {
            md_json(200, [['estado' => 'Rechazado'] + $uno]);
        }
        md_json(200, [$uno]);
}
md_json(404, ['error' => 'ruta desconocida del mock', 'ruta' => $ruta]);
```

- [ ] **Step 7: Run the test and see it pass**

```bash
php -d extension=curl -d extension=openssl tools/test_mock_dgii.php; echo "exit=$?"
```

Expected: 24 `[OK  ]` lines in the six sections, then `24 de 24 pruebas OK` and `exit=0`. The run takes about 6 seconds: the `cuelga` case waits 3 s on the client timeout and 2 more s for the mock to finish sleeping.

- [ ] **Step 8: Lint**

```bash
php -l tools/write_ahead_test_lib.php && php -l tools/mock_dgii.php && php -l tools/test_mock_dgii.php
```

Expected: `No syntax errors detected` three times.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add tools/write_ahead_test_lib.php tools/mock_dgii.php tools/test_mock_dgii.php
git commit -F - <<'EOF'
test(ecf): mock local de la DGII y ayudas de prueba del write-ahead

tools/mock_dgii.php es un router de php -S que imita la semilla, la
recepcion e-CF y RFCE y las tres consultas de la DGII. Los modos acepta,
rechaza, cuelga, html500, raw200 y trackids_* cubren cada salida del envio.
El trackId es track-<eNCF> y cada peticion queda en un log antes de
responder.

tools/write_ahead_test_lib.php trae las ayudas sin base de datos
(wa_chk/wa_fin, wa_servidor, wa_http, wa_mock_modo, wa_mock_log) y la
regla de ejecucion (-d extension=... solo para lo que no carga el php.ini).
tools/test_mock_dgii.php lo prueba con DgiiAuthService y
DgiiReceptionService reales: 24 de 24.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Base de prueba (scratch) y arnes de la API

**Files:**
- Modify: `tools/write_ahead_test_lib.php` (Task 1).
  - Insert the database half after `wa_mock_log()`, which ends the Task 1 file.
  - Append `wa_correr()`, `wa_autoprueba()` and the file's own CLI at the end.
- Credentials: `tools/.env`. The user creates it, it is never committed, and the `.env` rule at `.gitignore:3` already ignores it.
- Test: `php ... tools/write_ahead_test_lib.php --autoprueba --tenant-db=<base>`.

Facts re-pinned on `9f669ad` that the harness honors:

| Fact | Where |
|---|---|
| Single-tenant login reads and writes `users`/`api_tokens` in `DB_NAME` | `authModel.php:113-160`; tables only in `db/master_schema.sql:67-104` |
| `provinciaMunicipioModel` and `unidadMedidaModel` connect to the MASTER | `provinciaMunicipioModel.php:22-25`, `unidadMedidaModel.php:26-29`; DDL `db/master_schema.sql:276-284` |
| `Database` and `MasterDatabase` read `$_ENV` only | `Database.php:44-49`, `MasterDatabase.php:38-43` |
| `Database::setCredentials` | `Database.php:93-…` |
| `AuditLogModel` writes to the tenant DB when not multi-tenant | `AuditLogModel.php:20-25` |
| `RoleModel` in single-tenant reads `roles` in the tenant DB | `RoleModel.php:20-27`; fails open |
| `tenant_schema.sql` is loaded with a single `exec()` | as in `tools/create_tenant.php:503-511` |
| Login answers `{success:true, data:{token, user}}` | `authController.php:22-38` |

**Interfaces:**
- Consumes (Task 1): `wa_chk`, `wa_fin`, `wa_arg`, `wa_php_flags`, `wa_servidor`, `wa_http`, `wa_mock_modo`, `wa_mock_log`, `tools/mock_dgii.php`.
- Consumes (existing):
  - `Database::setCredentials(array $creds): void` (keys `host`, `port`, `name`, `user`, `pass`);
  - `Database::getInstance()->getConnection()`;
  - `POST /api/auth/login` `{emailOrUsername, password}` → `data.token`, sent as `X-API-KEY`.
- Produces:

```php
const WA_MARCA = 'zz_write_ahead_scratch';
function wa_es_base_de_prueba(PDO $pdo, string $base): bool
function wa_pdo(?string $base = null): PDO                 // $base ?? --tenant-db; exits 1 "[FALLO] <base> no es una base de prueba"
function wa_usar_base(string $base): PDO                   // this process's models -> the scratch base
function wa_preparar(string $base): void                   // only bases named wa_*; empty or already marked
function wa_sembrar(PDO $pdo): array                       // ['client_id'=>int,'product_id'=>int]; idempotent
function wa_limpiar(PDO $pdo): void
function wa_contador(PDO $pdo, string $tipo, string $ambiente = 'certecf'): int
function wa_filas(PDO $pdo, string $eNcf): array           // id,e_ncf,no_factura,estado_dgii,track_id,secuencia_utilizada,tiene_xml,tiene_rfce,respuesta_dgii,ambiente_dgii
function wa_movimientos(PDO $pdo, int $facturaId): int
function wa_cert_prueba(): array                           // ['path','password']; temp dir, random password, deleted at exit
function wa_api(string $base, array $env = [], int $puertoApi = 8098): array   // ['api','mock','token']
// helpers: wa_credenciales(), wa_conectar(?string $base), wa_nombre_base(), wa_exigir_marca(PDO),
//          wa_tabla_existe(PDO, string, string), wa_correr(array $cmd): array{codigo,salida}, wa_autoprueba(string): never
```

- Seed values:
  - `emisor_config` id 1: RNC `000000000`, `WA EMISOR DE PRUEBA SRL`;
  - `ncf_sequences` certecf E31–E34: `numero_desde` 1, `numero_hasta` 99999999, `fecha_vencimiento` +1 year;
  - warehouse `WA almacen`;
  - product `WA-PROD` / `WA producto` (bien, ITBIS 18 %, stock 1000);
  - client `wa-cliente@example.com` / `WA cliente` (RNC `000000001`).
- CLI:
  - `php <flags> tools/write_ahead_test_lib.php --preparar=<base>`
  - `php <flags> tools/write_ahead_test_lib.php --autoprueba --tenant-db=<base>`

- [ ] **Step 1 (blocking): Ask the user which MySQL/MariaDB the DB tests use**

Stop and ask in chat, then wait for the answer. Do not install or download anything without an explicit yes that names the file, the source and the size.

> The database tests of the e-CF write-ahead need a MySQL or MariaDB server that is not production (decision 6). Which one should they use?
> (a) A local server that you install (for example, MySQL 8 Community or MariaDB 11 for Windows). I will tell you the file, the source and the size before any download, and I will not install anything without your yes.
> (b) A staging tenant server.
>
> The harness creates and uses only the bases `wa_scratch`, `wa_scratch_sin_gate` and `wa_sin_marca`, and refuses any base without its marker table. The DB user needs `CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE` on `wa\_%`. Task 20 also needs `SYSTEM_VARIABLES_ADMIN` (or `SUPER`) only if `@@GLOBAL.sql_mode` is not already strict (MySQL 8 and MariaDB 10.2.4+ are strict by default).

- [ ] **Step 2: Credentials (the user writes them; never echo them)**

Ask the user to create `tools/.env` in the API worktree, or to set the same variables in the environment:

```
WA_DB_HOST=127.0.0.1
WA_DB_PORT=3306
WA_DB_USER=<usuario de la base de prueba>
WA_DB_PASS=<clave>
```

Then prove the file can never be committed:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git check-ignore -v tools/.env
```

Expected: `.gitignore:3:.env	tools/.env`. Do not `cat` the file.

- [ ] **Step 3: Append the self-test and the CLI first (failing test)**

Append to the end of `tools/write_ahead_test_lib.php`:

```php

/** Corre un comando (forma array, sin shell). @return array{codigo:int, salida:string} */
function wa_correr(array $cmd): array
{
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes, dirname(__DIR__));
    if (!is_resource($proc)) {
        return ['codigo' => -1, 'salida' => 'no se pudo lanzar el proceso'];
    }
    $salida = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    return ['codigo' => proc_close($proc), 'salida' => $salida];
}

/** Autoprueba de la mitad con base: --autoprueba --tenant-db=<base>. */
function wa_autoprueba(string $base): never
{
    echo "Autoprueba de write_ahead_test_lib sobre {$base}\n";
    $pdo = wa_pdo($base);
    $srv = wa_conectar();
    wa_chk("guarda: 'mysql' no es una base de prueba", wa_es_base_de_prueba($srv, 'mysql') === false);
    wa_chk("guarda: {$base} es una base de prueba", wa_es_base_de_prueba($srv, $base));

    // Una base con tablas y sin la marca (una base real, en miniatura) no se toca.
    $srv->exec('CREATE DATABASE IF NOT EXISTS `wa_sin_marca` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $srv->exec('CREATE TABLE IF NOT EXISTS `wa_sin_marca`.`t` (id INT PRIMARY KEY)');
    $r = wa_correr(array_merge([PHP_BINARY], wa_php_flags(), [__FILE__, '--preparar=wa_sin_marca']));
    wa_chk('--preparar sobre una base con tablas y sin marca sale con 1',
        $r['codigo'] === 1 && str_contains($r['salida'], 'no es una base de prueba'), $r);
    $st = $srv->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'wa_sin_marca'");
    wa_chk('--preparar no le agrego tablas', (int) $st->fetchColumn() === 1);

    $a = wa_sembrar($pdo);
    $b = wa_sembrar($pdo);
    wa_chk('wa_sembrar dos veces da los mismos ids', $a === $b && $a['client_id'] > 0 && $a['product_id'] > 0, [$a, $b]);

    $pdo->exec("INSERT INTO facturas (no_factura, client_name, total, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii)
                VALUES ('E319999999999', 'WA basura', 1.00, '31', 'E319999999999', 'ACEPTADO', 'certecf')");
    $pdo->exec("UPDATE ncf_sequences SET current_value = 5 WHERE type = 'E31' AND ambiente = 'certecf'");
    wa_limpiar($pdo);
    wa_chk('wa_contador E31 vuelve a 0 tras wa_limpiar', wa_contador($pdo, 'E31') === 0, wa_contador($pdo, 'E31'));
    wa_chk('facturas queda vacia tras wa_limpiar', (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn() === 0);

    $cert = wa_cert_prueba();
    $partes = [];
    $leido = openssl_pkcs12_read((string) file_get_contents($cert['path']), $partes, $cert['password']);
    wa_chk('wa_cert_prueba: el .p12 se lee con su clave', $leido && !empty($partes['cert']) && !empty($partes['pkey']));
    wa_chk('wa_cert_prueba: el .p12 vive fuera del repo',
        !str_starts_with(realpath($cert['path']) ?: '', (string) realpath(dirname(__DIR__))), $cert['path']);

    $srvApi = wa_api($base);
    wa_chk('wa_api: inicia sesion y devuelve un token', $srvApi['token'] !== '');
    wa_mock_log($srvApi['mock'], true);
    $h = ['X-API-KEY: ' . $srvApi['token']];
    $r = wa_http('GET', $srvApi['api'] . '/api/facturas/stats', null, $h);
    wa_chk('GET /api/facturas/stats: 200 con status true', $r['status'] === 200 && ($r['json']['status'] ?? null) === true, $r);
    $r = wa_http('GET', $srvApi['api'] . '/api/facturas?estado=aprobado', null, $h);
    wa_chk('GET /api/facturas?estado=aprobado: 200', $r['status'] === 200, $r);
    wa_chk('nada de eso llamo a la DGII', wa_mock_log($srvApi['mock']) === []);
    wa_fin();
}

// CLI propio: solo cuando se ejecuta este archivo, nunca al incluirlo.
//   php <flags> tools/write_ahead_test_lib.php --preparar=<base>
//   php <flags> tools/write_ahead_test_lib.php --autoprueba --tenant-db=<base>
if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    $preparar = (string) wa_arg('preparar', '');
    if ($preparar !== '') {
        wa_preparar($preparar);
        echo "Base de prueba {$preparar} lista.\n";
        exit(0);
    }
    if (wa_arg('autoprueba') !== null) {
        wa_autoprueba((string) wa_arg('tenant-db', ''));
    }
    echo "Uso: php tools/write_ahead_test_lib.php --preparar=<base> | --autoprueba --tenant-db=<base>\n";
    exit(2);
}
```

Run it:

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/write_ahead_test_lib.php --autoprueba --tenant-db=wa_scratch
```

Expected: `Autoprueba de write_ahead_test_lib sobre wa_scratch`, then `Fatal error: Uncaught Error: Call to undefined function wa_pdo()`.

- [ ] **Step 4: Insert the database half**

Insert this block right after the closing `}` of `wa_mock_log()`, before `/** Corre un comando`:

```php

// ===========================================================================
// Mitad con base de datos (Task 2). Decision 6 de la spec: las pruebas con
// base corren en una base de PRUEBA (MySQL/MariaDB local o de staging),
// nunca en produccion.
//
// Credenciales: entorno WA_DB_HOST, WA_DB_PORT, WA_DB_USER, WA_DB_PASS o el
// archivo tools/.env (KEY=VALUE), que la regla ".env" de .gitignore deja fuera
// del repo. Nunca se imprimen.
//
// Red de seguridad: toda funcion de esta mitad se niega a tocar una base sin
// la tabla marca zz_write_ahead_scratch, y --preparar solo crea o completa
// bases que empiezan con "wa_" y que estan vacias o ya tienen la marca.
//
// Lo que la base de prueba necesita, ademas de db/tenant_schema.sql:
//   - users y api_tokens en version single-tenant (sin tenant_id ni FK a
//     tenants): con MULTI_TENANT_ENABLED=false el login los lee y escribe en
//     la base del tenant (authModel::loginUser / validateToken).
//   - dgii_provincia_municipio: provinciaMunicipioModel (cada emision) y
//     unidadMedidaModel conectan a la MASTER, y aqui la master es esta misma
//     base (MASTER_DB_*). Puede quedar vacia: resolve() falla abierto.
//   - Database y MasterDatabase leen solo $_ENV: en este proceso se llenan
//     $_ENV y putenv; los php -S hijos corren con variables_order=EGPCS.
//   - PERMISSIONS_ENFORCE=false: PermissionGate solo anota en el log.
//   - Con MULTI_TENANT_ENABLED=false AuditLogger escribe en audit_logs de
//     esta base (AuditLogModel), asi que las pruebas lo pueden leer.
// ===========================================================================

const WA_MARCA = 'zz_write_ahead_scratch';

/** Credenciales de la base de prueba (entorno o tools/.env). Nunca se imprimen. */
function wa_credenciales(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $archivo = [];
    $ruta = __DIR__ . DIRECTORY_SEPARATOR . '.env';
    if (is_file($ruta)) {
        foreach (file($ruta, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) {
            $l = trim($l);
            if ($l === '' || $l[0] === '#' || !str_contains($l, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $l, 2);
            $archivo[trim($k)] = trim(trim($v), "\"'");
        }
    }
    $leer = static function (string $k, string $defecto = '') use ($archivo): string {
        $v = getenv($k);
        return $v !== false && $v !== '' ? $v : (string) ($archivo[$k] ?? $defecto);
    };
    $c = [
        'host' => $leer('WA_DB_HOST', '127.0.0.1'),
        'port' => $leer('WA_DB_PORT', '3306'),
        'user' => $leer('WA_DB_USER'),
        'pass' => $leer('WA_DB_PASS'),
    ];
    if ($c['user'] === '') {
        echo "[FALLO] faltan las credenciales de la base de prueba: WA_DB_USER/WA_DB_PASS en el entorno o en tools/.env\n";
        exit(1);
    }
    return $c;
}

/** Conexion al servidor de prueba, con o sin base seleccionada. */
function wa_conectar(?string $base = null): PDO
{
    $c = wa_credenciales();
    $dsn = "mysql:host={$c['host']};port={$c['port']};charset=utf8mb4" . ($base !== null ? ";dbname={$base}" : '');
    try {
        return new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        // El mensaje del driver puede traer usuario y host: solo el codigo.
        echo "[FALLO] no se pudo conectar a la base de prueba (codigo {$e->getCode()}). Revisa WA_DB_* y que corra con -d extension=pdo_mysql\n";
        exit(1);
    }
}

/** Nombre de base seguro para ir entre backticks. */
function wa_nombre_base(string $base): string
{
    if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $base)) {
        echo "[FALLO] nombre de base invalido: {$base}\n";
        exit(1);
    }
    return $base;
}

/** true cuando $base tiene la tabla marca zz_write_ahead_scratch. */
function wa_es_base_de_prueba(PDO $pdo, string $base): bool
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = :b AND TABLE_NAME = :t');
    $st->execute([':b' => $base, ':t' => WA_MARCA]);
    return $st->fetchColumn() !== false;
}

/** Corta el script si la conexion no esta sobre una base de prueba. */
function wa_exigir_marca(PDO $pdo): void
{
    $base = (string) $pdo->query('SELECT DATABASE()')->fetchColumn();
    if ($base === '' || !wa_es_base_de_prueba($pdo, $base)) {
        echo "[FALLO] {$base} no es una base de prueba\n";
        exit(1);
    }
}

/** Conexion a la base de prueba ($base o --tenant-db). Sin la marca: sale con 1. */
function wa_pdo(?string $base = null): PDO
{
    $base = $base ?? (string) wa_arg('tenant-db', '');
    if ($base === '') {
        echo "[FALLO] falta --tenant-db=<base de prueba>\n";
        exit(1);
    }
    wa_nombre_base($base);
    if (!wa_es_base_de_prueba(wa_conectar(), $base)) {
        echo "[FALLO] {$base} no es una base de prueba\n";
        exit(1);
    }
    return wa_conectar($base);
}

/**
 * Apunta los modelos de ESTE proceso a la base de prueba: Database (tenant) y,
 * por $_ENV/putenv, MasterDatabase y la configuracion que leen los modelos.
 */
function wa_usar_base(string $base): PDO
{
    wa_pdo($base);
    $c = wa_credenciales();
    $vars = [
        'MULTI_TENANT_ENABLED' => 'false', 'PERMISSIONS_ENFORCE' => 'false', 'DGII_ECF_ENVIRONMENT' => 'certecf',
        'DB_HOST' => $c['host'], 'DB_PORT' => $c['port'], 'DB_NAME' => $base, 'DB_USER' => $c['user'], 'DB_PASS' => $c['pass'],
        'MASTER_DB_HOST' => $c['host'], 'MASTER_DB_PORT' => $c['port'], 'MASTER_DB_NAME' => $base,
        'MASTER_DB_USER' => $c['user'], 'MASTER_DB_PASS' => $c['pass'],
    ];
    foreach ($vars as $k => $v) {
        $_ENV[$k] = $v;
        putenv("{$k}={$v}");
    }
    require_once dirname(__DIR__) . '/src/Database.php';
    Database::setCredentials(['host' => $c['host'], 'port' => $c['port'], 'name' => $base, 'user' => $c['user'], 'pass' => $c['pass']]);
    return Database::getInstance()->getConnection();
}

/** true si la tabla existe en la base. */
function wa_tabla_existe(PDO $pdo, string $base, string $tabla): bool
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = :b AND TABLE_NAME = :t');
    $st->execute([':b' => $base, ':t' => $tabla]);
    return $st->fetchColumn() !== false;
}

/**
 * Crea (o completa) una base de prueba: CREATE DATABASE, la marca, el esquema
 * de tenant y las tablas que la API necesita en modo single-tenant. Se niega a
 * tocar una base con tablas y sin la marca (protege una base real).
 */
function wa_preparar(string $base): void
{
    wa_nombre_base($base);
    if (!str_starts_with($base, 'wa_')) {
        echo "[FALLO] --preparar solo crea bases que empiezan con wa_ (pediste {$base})\n";
        exit(1);
    }
    $srv = wa_conectar();
    $st = $srv->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = :b');
    $st->execute([':b' => $base]);
    $tablas = (int) $st->fetchColumn();
    if ($tablas > 0 && !wa_es_base_de_prueba($srv, $base)) {
        echo "[FALLO] {$base} tiene {$tablas} tablas y no es una base de prueba: no se toca\n";
        exit(1);
    }
    $srv->exec("CREATE DATABASE IF NOT EXISTS `{$base}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo = wa_conectar($base);
    // La marca primero: si la carga del esquema falla a mitad, la base queda
    // marcada y --preparar la puede completar en la siguiente corrida.
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . WA_MARCA . " (
        creada DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        nota VARCHAR(200) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    if ((int) $pdo->query('SELECT COUNT(*) FROM ' . WA_MARCA)->fetchColumn() === 0) {
        $pdo->exec('INSERT INTO ' . WA_MARCA . " (nota) VALUES ('Base de prueba del write-ahead del e-CF. Nunca produccion.')");
    }
    // audit_logs es la ultima tabla de tenant_schema.sql: si existe, el esquema ya cargo.
    if (!wa_tabla_existe($srv, $base, 'audit_logs')) {
        // PDO_MYSQL ejecuta varias sentencias en un exec() (como tools/create_tenant.php).
        $pdo->exec((string) file_get_contents(dirname(__DIR__) . '/db/tenant_schema.sql'));
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(70) NOT NULL,
        last_name VARCHAR(70) NOT NULL,
        email VARCHAR(255) NOT NULL,
        username VARCHAR(50) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_users_email (email),
        UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS api_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL,
        last_used DATETIME DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        UNIQUE KEY uq_token_hash (token_hash),
        KEY idx_tokens_user (user_id),
        CONSTRAINT fk_wa_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS dgii_provincia_municipio (
        codigo CHAR(6) NOT NULL,
        provincia_codigo CHAR(2) NOT NULL,
        descripcion VARCHAR(120) NOT NULL,
        tipo ENUM('PROVINCIA','MUNICIPIO','DISTRITO') NOT NULL,
        PRIMARY KEY (codigo),
        KEY idx_provincia (provincia_codigo),
        KEY idx_tipo (tipo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $faltan = [];
    foreach (['clients', 'warehouses', 'products', 'facturas', 'factura_items', 'ncf_sequences', 'emisor_config',
        'inventory_movements', 'audit_logs', 'unidades_medida', 'users', 'api_tokens', 'dgii_provincia_municipio'] as $t) {
        if (!wa_tabla_existe($srv, $base, $t)) {
            $faltan[] = $t;
        }
    }
    if ($faltan !== []) {
        echo "[FALLO] {$base} quedo sin estas tablas: " . implode(', ', $faltan) . "\n";
        exit(1);
    }
}

/**
 * Datos fijos de las pruebas (idempotente): emisor id=1, rangos certecf
 * E31-E34, un almacen, el producto 'WA producto' (bien, stock 1000) y el
 * cliente 'WA cliente' con RNC. Los RNC son de mentira (solo ceros y un 1).
 * @return array{client_id:int, product_id:int}
 */
function wa_sembrar(PDO $pdo): array
{
    wa_exigir_marca($pdo);
    $venc = date('Y-m-d', strtotime('+1 year'));
    $pdo->prepare(
        "INSERT INTO emisor_config (id, rnc, razon_social, nombre_comercial, direccion, telefono, correo, fecha_vencimiento_secuencia)
         VALUES (1, '000000000', 'WA EMISOR DE PRUEBA SRL', 'WA Emisor', 'Calle de prueba 1', '809-000-0000', 'wa-emisor@example.com', :venc)
         ON DUPLICATE KEY UPDATE rnc = VALUES(rnc), razon_social = VALUES(razon_social), nombre_comercial = VALUES(nombre_comercial),
             direccion = VALUES(direccion), telefono = VALUES(telefono), correo = VALUES(correo),
             fecha_vencimiento_secuencia = VALUES(fecha_vencimiento_secuencia)"
    )->execute([':venc' => $venc]);
    $rango = $pdo->prepare(
        "INSERT INTO ncf_sequences (type, prefix, current_value, numero_desde, numero_hasta, fecha_vencimiento, description, ambiente)
         VALUES (:t, :p, 0, 1, 99999999, :venc, 'WA prueba', 'certecf')
         ON DUPLICATE KEY UPDATE numero_hasta = VALUES(numero_hasta), fecha_vencimiento = VALUES(fecha_vencimiento)"
    );
    foreach (['E31', 'E32', 'E33', 'E34'] as $tipo) {
        $rango->execute([':t' => $tipo, ':p' => $tipo, ':venc' => $venc]);
    }
    $id = static function (string $sql, array $p) use ($pdo): int {
        $st = $pdo->prepare($sql);
        $st->execute($p);
        return (int) $st->fetchColumn();
    };
    $almacen = $id('SELECT id FROM warehouses WHERE nombre = :n', [':n' => 'WA almacen']);
    if ($almacen === 0) {
        $pdo->prepare("INSERT INTO warehouses (nombre, descripcion) VALUES ('WA almacen', 'Almacen de las pruebas del write-ahead')")->execute();
        $almacen = (int) $pdo->lastInsertId();
    }
    $producto = $id('SELECT id FROM products WHERE sku = :s', [':s' => 'WA-PROD']);
    if ($producto === 0) {
        $pdo->prepare(
            "INSERT INTO products (sku, nombre, warehouse_id, indicador_bien_servicio, indicador_facturacion, precio, costo, unidad_medida, stock)
             VALUES ('WA-PROD', 'WA producto', :w, 1, 1, 1000.00, 400.00, '43', 1000.000)"
        )->execute([':w' => $almacen]);
        $producto = (int) $pdo->lastInsertId();
    }
    $cliente = $id('SELECT id FROM clients WHERE email = :e', [':e' => 'wa-cliente@example.com']);
    if ($cliente === 0) {
        $pdo->prepare(
            "INSERT INTO clients (email, client_name, company_name, rnc, razon_social, direccion, phone_number)
             VALUES ('wa-cliente@example.com', 'WA cliente', 'WA cliente', '000000001', 'WA CLIENTE DE PRUEBA SRL', 'Calle de prueba 2', '')"
        )->execute();
        $cliente = (int) $pdo->lastInsertId();
    }
    return ['client_id' => $cliente, 'product_id' => $producto];
}

/** Deja la base como recien sembrada: sin facturas, movimientos ni auditoria; contadores al inicio. */
function wa_limpiar(PDO $pdo): void
{
    wa_exigir_marca($pdo);
    $pdo->exec('DELETE FROM inventory_movements');
    $pdo->exec('DELETE FROM factura_items');
    $pdo->exec('DELETE FROM facturas');
    $pdo->exec('DELETE FROM audit_logs');
    $pdo->exec('UPDATE ncf_sequences SET current_value = numero_desde - 1');
    $pdo->exec("UPDATE products SET stock = 1000 WHERE sku = 'WA-PROD'");
}

/** current_value del primer rango de $tipo en $ambiente (0 si no hay). */
function wa_contador(PDO $pdo, string $tipo, string $ambiente = 'certecf'): int
{
    $st = $pdo->prepare('SELECT current_value FROM ncf_sequences WHERE type = :t AND ambiente = :a ORDER BY numero_desde LIMIT 1');
    $st->execute([':t' => $tipo, ':a' => $ambiente]);
    return (int) $st->fetchColumn();
}

/** Filas de facturas de un e-NCF (las archivadas se encuentran por no_factura). */
function wa_filas(PDO $pdo, string $eNcf): array
{
    $st = $pdo->prepare(
        'SELECT id, e_ncf, no_factura, estado_dgii, track_id, secuencia_utilizada,
                xml_firmado IS NOT NULL AS tiene_xml, rfce_xml IS NOT NULL AS tiene_rfce,
                respuesta_dgii, ambiente_dgii
         FROM facturas WHERE e_ncf = :x OR no_factura = :y ORDER BY id'
    );
    $st->execute([':x' => $eNcf, ':y' => $eNcf]);
    return $st->fetchAll(PDO::FETCH_ASSOC);
}

/** Movimientos de inventario de una factura. */
function wa_movimientos(PDO $pdo, int $facturaId): int
{
    $st = $pdo->prepare("SELECT COUNT(*) FROM inventory_movements WHERE referencia_tipo = 'factura' AND referencia_id = :id");
    $st->execute([':id' => $facturaId]);
    return (int) $st->fetchColumn();
}

/**
 * Certificado .p12 autofirmado para firmar en las pruebas, en el temp del
 * sistema (nunca en el repo) con una clave al azar que no se imprime. Se borra
 * al terminar el proceso. En Windows, si OPENSSL_CONF no esta, se usa el
 * extras/ssl/openssl.cnf del PHP (la misma perilla que OPENSSL_CONF de .env.example).
 * @return array{path:string, password:string}
 */
function wa_cert_prueba(): array
{
    static $cert = null;
    if ($cert !== null) {
        return $cert;
    }
    if (!extension_loaded('openssl')) {
        echo "[FALLO] wa_cert_prueba necesita openssl: corre con -d extension=openssl\n";
        exit(1);
    }
    $cfg = ['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'digest_alg' => 'sha256'];
    $cnf = getenv('OPENSSL_CONF') ?: '';
    $cnfPhp = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'extras' . DIRECTORY_SEPARATOR . 'ssl' . DIRECTORY_SEPARATOR . 'openssl.cnf';
    if ($cnf === '' && is_file($cnfPhp)) {
        $cnf = $cnfPhp;
    }
    if ($cnf !== '') {
        $cfg['config'] = $cnf;
    }
    $clave = bin2hex(random_bytes(12));
    $llave = openssl_pkey_new($cfg);
    $csr = $llave ? openssl_csr_new(['commonName' => 'WA PRUEBA WRITE-AHEAD', 'organizationName' => 'WA PRUEBA', 'countryName' => 'DO'], $llave, $cfg) : false;
    $x509 = ($csr && $llave) ? openssl_csr_sign($csr, null, $llave, 2, $cfg) : false;
    $p12 = '';
    if (!$x509 || !openssl_pkcs12_export($x509, $p12, $llave, $clave)) {
        echo '[FALLO] no se pudo crear el certificado de prueba: ' . (openssl_error_string() ?: 'sin detalle') . "\n";
        exit(1);
    }
    $ruta = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_cert_prueba_' . getmypid() . '.p12';
    file_put_contents($ruta, $p12);
    register_shutdown_function(static function () use ($ruta): void {
        @unlink($ruta);
    });
    return $cert = ['path' => $ruta, 'password' => $clave];
}

/**
 * La API real (php -S index.php) sobre la base de prueba, con la DGII falsa:
 * arranca (o reutiliza) el mock en 8099 y la API en $puertoApi, crea el
 * usuario wa_prueba (admin, clave al azar que no se imprime) e inicia sesion.
 * @return array{api:string, mock:string, token:string}
 */
function wa_api(string $base, array $env = [], int $puertoApi = 8098): array
{
    $pdo = wa_pdo($base);
    $c = wa_credenciales();
    $cert = wa_cert_prueba();
    $mock = wa_servidor('mock_dgii', 'tools/mock_dgii.php', 8099, ['MOCK_DGII_CUELGA_SEG' => '5']);
    $entorno = array_merge([
        'DB_HOST' => $c['host'], 'DB_PORT' => $c['port'], 'DB_NAME' => $base, 'DB_USER' => $c['user'], 'DB_PASS' => $c['pass'],
        'MASTER_DB_HOST' => $c['host'], 'MASTER_DB_PORT' => $c['port'], 'MASTER_DB_NAME' => $base,
        'MASTER_DB_USER' => $c['user'], 'MASTER_DB_PASS' => $c['pass'],
        'MULTI_TENANT_ENABLED' => 'false', 'PERMISSIONS_ENFORCE' => 'false', 'DGII_ECF_ENVIRONMENT' => 'certecf',
        'DGII_ECF_BASE_URL' => $mock, 'DGII_FC_BASE_URL' => $mock, 'DGII_ECF_TIMEOUT' => '3',
        'DGII_ECF_CERT_PATH' => $cert['path'], 'DGII_ECF_CERT_PASSWORD' => $cert['password'],
    ], $env);
    $api = wa_servidor('api_' . $base, 'index.php', $puertoApi, $entorno);

    $clave = bin2hex(random_bytes(16));
    $pdo->prepare(
        "INSERT INTO users (name, last_name, email, username, password, role)
         VALUES ('WA', 'Prueba', 'wa_prueba@example.com', 'wa_prueba', :p, 'admin')
         ON DUPLICATE KEY UPDATE password = VALUES(password), role = 'admin'"
    )->execute([':p' => password_hash($clave, PASSWORD_DEFAULT)]);
    $r = wa_http('POST', $api . '/api/auth/login', ['emailOrUsername' => 'wa_prueba', 'password' => $clave]);
    $token = (string) ($r['json']['data']['token'] ?? '');
    if ($token === '') {
        echo "[FALLO] no se pudo iniciar sesion como wa_prueba en {$api}: HTTP {$r['status']} " . substr($r['body'], 0, 300) . "\n";
        exit(1);
    }
    return ['api' => $api, 'mock' => $mock, 'token' => $token];
}
```

Then lint:

```bash
php -l tools/write_ahead_test_lib.php
```

Expected: `No syntax errors detected in tools/write_ahead_test_lib.php`.

- [ ] **Step 5: Prepare `wa_scratch` and run the self-test**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/write_ahead_test_lib.php --preparar=wa_scratch
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/write_ahead_test_lib.php --autoprueba --tenant-db=wa_scratch; echo "exit=$?"
```

Expected:
- `Base de prueba wa_scratch lista.`
- 13 `[OK  ]` lines, then `13 de 13 pruebas OK` and `exit=0`.

If key generation fails on Windows, set `OPENSSL_CONF` to PHP's `extras/ssl/openssl.cnf` and rerun.

- [ ] **Step 6: Prepare the copy that Task 3 breaks, and self-test it**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/write_ahead_test_lib.php --preparar=wa_scratch_sin_gate
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/write_ahead_test_lib.php --autoprueba --tenant-db=wa_scratch_sin_gate; echo "exit=$?"
```

Expected: `Base de prueba wa_scratch_sin_gate lista.`, then `13 de 13 pruebas OK` and `exit=0`.

- [ ] **Step 7: Check that Task 1 still passes**

```bash
php -d extension=curl -d extension=openssl tools/test_mock_dgii.php | tail -1
```

Expected: `24 de 24 pruebas OK`.

- [ ] **Step 8: Commit (the lib only; `tools/.env` stays ignored)**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
git add tools/write_ahead_test_lib.php
git commit -F - <<'EOF'
test(ecf): base de prueba y arnes de la API para el write-ahead

La mitad con base de write_ahead_test_lib.php: wa_preparar arma una base
wa_* con tenant_schema.sql, users/api_tokens single-tenant,
dgii_provincia_municipio y la tabla marca zz_write_ahead_scratch. Toda
ayuda se niega a tocar una base sin esa marca, y --preparar no toca una
base con tablas y sin ella.

wa_sembrar/wa_limpiar dejan emisor, rangos E31-E34, producto y cliente.
wa_cert_prueba hace un .p12 autofirmado en el temp. wa_api levanta
index.php con php -S contra la base y la DGII falsa, e inicia sesion con
un usuario de clave al azar. Las credenciales salen de WA_DB_* o
tools/.env (ignorado) y nunca se imprimen.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

`git status --short` must show only the lib modified, plus the untracked `tools/reconstruir_e340000000001.sql`. No `tools/.env` line appears.

---

### Task 3: Compuerta de despliegue 027/028 (12.0, pasos 1-2)

**Files:**
- Create: `tools/test_write_ahead_gate.php`.
- Reads: `tools/verificar_migraciones_tenant.sql`, a single `SELECT` at `:24-150` with `--` comment lines at `:1-23`. The 027 row is at `:133-137`; the 028 row at `:138-146` checks `facturas` **and** `gastos` for a width of 40 or more.
- Pins:
  - the `estado_dgii` COMMENT at `db/tenant_schema.sql:218-220`. The ALTER reads it from the column itself, so the text is identical;
  - `uk_e_ncf_amb` at `db/tenant_schema.sql:245`.
- Test: the same script.

**Interfaces:**
- Consumes (Tasks 1-2): `wa_chk`, `wa_fin`, `wa_arg`, `wa_pdo(?string $base)`.
- Produces:
  - the broken copy `wa_scratch_sin_gate`: `UNIQUE KEY uk_e_ncf (e_ncf)`, no `uk_e_ncf_amb`, and `facturas.estado_dgii VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'` with the same COMMENT;
  - the CLI `tools/test_write_ahead_gate.php --tenant-db=<base> --copia-db=<base>`, which can be run again.

- [ ] **Step 1: Write the assertions, without the ALTER step**

Create `tools/test_write_ahead_gate.php`:

```php
<?php
/**
 * test_write_ahead_gate.php — la compuerta de despliegue del write-ahead
 * (spec 6.1 y 12.0, pasos 1-2): tools/verificar_migraciones_tenant.sql dice
 * APLICADA en 027 y 028 sobre la base de prueba, y FALTA sobre una copia a la
 * que se le quitan las dos migraciones a proposito.
 *
 * La copia queda rota a proposito (indice global uk_e_ncf, estado_dgii
 * VARCHAR(20)): la usan tools/test_reservar_confirmar.php (desborde 6.2) y
 * tools/test_write_ahead_api.php (12.0, pasos 3-4). Sobre --tenant-db no se
 * escribe nada. Se puede correr las veces que haga falta.
 *
 * Uso:
 *   php -d extension=pdo_mysql tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate
 */

require_once __DIR__ . '/write_ahead_test_lib.php';

$base = (string) wa_arg('tenant-db', '');
$copia = (string) wa_arg('copia-db', '');
if ($base === '' || $copia === '' || $base === $copia) {
    echo "Uso: php tools/test_write_ahead_gate.php --tenant-db=<base> --copia-db=<otra base de prueba>\n";
    exit(2);
}

/** Corre el verificador (un solo SELECT) en la base de $pdo. @return array<string,array> por migracion */
function wa_verificar_migraciones(PDO $pdo): array
{
    $lineas = preg_split('/\R/', (string) file_get_contents(__DIR__ . '/verificar_migraciones_tenant.sql'));
    $sql = implode("\n", array_filter($lineas, static fn(string $l): bool => !str_starts_with(ltrim($l), '--')));
    $sql = rtrim(trim($sql), ';');
    $porMigracion = [];
    foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $f) {
        $porMigracion[(string) $f['migracion']] = $f;
    }
    return $porMigracion;
}

/** Ancho de facturas.estado_dgii y si existe el indice $indice, en la base de $pdo. */
function wa_facturas_esquema(PDO $pdo, string $base, string $indice): array
{
    $col = $pdo->prepare("SELECT CHARACTER_MAXIMUM_LENGTH, COLUMN_COMMENT FROM information_schema.COLUMNS
                          WHERE TABLE_SCHEMA = :b AND TABLE_NAME = 'facturas' AND COLUMN_NAME = 'estado_dgii'");
    $col->execute([':b' => $base]);
    $c = $col->fetch(PDO::FETCH_ASSOC) ?: [];
    $idx = $pdo->prepare("SELECT COUNT(*) FROM information_schema.STATISTICS
                          WHERE TABLE_SCHEMA = :b AND TABLE_NAME = 'facturas' AND INDEX_NAME = :i");
    $idx->execute([':b' => $base, ':i' => $indice]);
    return [
        'ancho' => (int) ($c['CHARACTER_MAXIMUM_LENGTH'] ?? 0),
        'comentario' => (string) ($c['COLUMN_COMMENT'] ?? ''),
        'indice' => (int) $idx->fetchColumn() > 0,
    ];
}

$pdoBase = wa_pdo($base);
$pdoCopia = wa_pdo($copia);

echo "Base de prueba ({$base})\n";
$v = wa_verificar_migraciones($pdoBase);
wa_chk("base: la columna base dice {$base} en todas las filas",
    $v !== [] && array_unique(array_column($v, 'base')) === [$base], array_unique(array_column($v, 'base')));
wa_chk('base: 027 APLICADA', ($v['027']['estado'] ?? null) === 'APLICADA', $v['027'] ?? null);
wa_chk('base: 028 APLICADA', ($v['028']['estado'] ?? null) === 'APLICADA', $v['028'] ?? null);

echo "Copia sin la compuerta ({$copia})\n";
$v = wa_verificar_migraciones($pdoCopia);
wa_chk("copia: la columna base dice {$copia} en todas las filas",
    $v !== [] && array_unique(array_column($v, 'base')) === [$copia], array_unique(array_column($v, 'base')));
wa_chk('copia: 027 FALTA', ($v['027']['estado'] ?? null) === 'FALTA', $v['027'] ?? null);
wa_chk('copia: 028 FALTA', ($v['028']['estado'] ?? null) === 'FALTA', $v['028'] ?? null);
$resto = array_diff_key($v, ['027' => 1, '028' => 1]);
wa_chk('copia: las demas migraciones siguen APLICADA',
    $resto !== [] && array_unique(array_column($resto, 'estado')) === ['APLICADA'], array_column($resto, 'estado', 'migracion'));

echo "La base de prueba no se toco\n";
$esq = wa_facturas_esquema($pdoBase, $base, 'uk_e_ncf_amb');
wa_chk('base: sigue con uk_e_ncf_amb', $esq['indice']);
wa_chk('base: estado_dgii sigue en 40', $esq['ancho'] === 40, $esq['ancho']);

wa_fin();
```

- [ ] **Step 2: Run it and watch the copy checks fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -d extension=pdo_mysql tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate; echo "exit=$?"
```

Expected: `[FALLO] copia: 027 FALTA` and `[FALLO] copia: 028 FALTA`, because the copy is still intact. Then `7 de 9 pruebas OK` and `exit=1`.

- [ ] **Step 3: Add the guarded ALTER step**

Insert this block right after `$pdoCopia = wa_pdo($copia);` and before `echo "Base de prueba ({$base})\n";`:

```php

// Romper la copia: deshacer 027 (vuelve la clave global uk_e_ncf) y 028
// (estado_dgii a VARCHAR(20)). Cada ALTER mira information_schema antes, para
// que el script se pueda repetir.
$esq = wa_facturas_esquema($pdoCopia, $copia, 'uk_e_ncf_amb');
if ($esq['indice']) {
    $pdoCopia->exec('ALTER TABLE facturas DROP INDEX uk_e_ncf_amb, ADD UNIQUE KEY uk_e_ncf (e_ncf)');
}
if ($esq['ancho'] > 20) {
    // Mismo COMMENT que db/tenant_schema.sql:218-220 (se lee de la propia columna).
    $pdoCopia->exec("ALTER TABLE facturas MODIFY estado_dgii VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT "
        . $pdoCopia->quote($esq['comentario']));
}
```

- [ ] **Step 4: Run it twice to show it passes and is idempotent**

```bash
php -d extension=pdo_mysql tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate; echo "exit=$?"
php -d extension=pdo_mysql tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate; echo "exit=$?"
php -l tools/test_write_ahead_gate.php
```

Expected: both runs end with `9 de 9 pruebas OK` and `exit=0`. The second run skips both ALTERs because the copy is already broken. The lint prints `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add tools/test_write_ahead_gate.php
git commit -F - <<'EOF'
test(ecf): compuerta 027/028 sobre la base de prueba

tools/test_write_ahead_gate.php corre verificar_migraciones_tenant.sql en
la base de prueba (027 y 028 APLICADA, columna base correcta). Despues lo
corre en una copia a la que le quita las dos migraciones: vuelve el indice
global uk_e_ncf y estado_dgii pasa a VARCHAR(20) con el mismo COMMENT. Ahi
027 y 028 deben decir FALTA (spec 12.0 pasos 1-2).

Los ALTER miran information_schema antes, asi que se puede repetir. La
copia queda rota a proposito para el desborde 6.2 y los pasos 3-4 de 12.0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: EstadosEcf

Run every command of this task from the API worktree root, in Git Bash:
`cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`. Line numbers are pinned on `9f669ad`
(Tasks 1-3 do not touch these files).

**Files:**
- Create: `src/Utils/FacturacionElectronica/EstadosEcf.php` (69 lines). It holds constants and one pure function, with no
  `require` and no `include`.
- Create: `tools/test_write_ahead_puro.php` (62 lines). This is the DB-free test file that every later backend task
  extends.
  - Its closing block is `:59-62`: a rule line, the comment `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`,
    another rule line, then `wa_fin();`.
  - Every later section goes **directly above that closing block** and ends with one blank line.
- Modify: `tools/check_estado_dgii_ancho.php` (171 lines). There are four insertions:
  - after `:19`, the end of the header list;
  - after `:55`, the line `$readme = $leer('db/migrations/README.md');`;
  - after `:85`, the line `$posibles = array_keys($posibles);`;
  - after `:111`, the end of the "defaults intactos" check.

  The regexes at `:71` and `:73` stay untouched.
- Test: `php tools/test_write_ahead_puro.php` (section 1) and `php tools/check_estado_dgii_ancho.php`.

**Interfaces:**
- Consumes (Task 1): `wa_chk(string $desc, bool $ok, mixed $obtenido = null): void` and `wa_fin(): never`, both from
  `tools/write_ahead_test_lib.php`.
- Produces:

```php
final class EstadosEcf {
    public const REINTENTABLES = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO'];
    public const PENDIENTE_ENVIO = 'PENDIENTE_ENVIO';
    public const ENVIO_INCIERTO = 'ENVIO_INCIERTO';
    public const EN_VUELO = [self::PENDIENTE_ENVIO, self::ENVIO_INCIERTO];
    public const SIN_VEREDICTO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'];
    public const SIN_STOCK = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO', 'ERROR', 'RFCE_ERROR'];
    /** EstadosEcf::sql(['A','B']) === "'A', 'B'"; InvalidArgumentException for [] or any value not matching /^[A-Z][A-Z_]*$/ */
    public static function sql(array $estados): string;
}
```

  - `tools/test_write_ahead_puro.php` and its closing-block convention.
  - `check_estado_dgii_ancho.php` grows from 30 to 32 checks.

- [ ] **Step 1: Write the failing test file**

Create `tools/test_write_ahead_puro.php` with exactly this content:

```php
<?php
/**
 * test_write_ahead_puro.php — Piezas del write-ahead del e-CF que se prueban
 * sin base de datos ni red (spec del write-ahead, 12.3.1).
 *
 * Donde hace falta una conexion se usa una falsa que anota el SQL y los
 * parametros: nunca toca MySQL. Cada tarea del plan agrega su seccion justo
 * encima del bloque de cierre (wa_fin), en orden.
 *
 * Uso:
 *   php tools/test_write_ahead_puro.php      (sale con 1 si algo falla)
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EstadosEcf.php';

// ---------------------------------------------------------------------------
// 1) EstadosEcf: las listas del spec 4.6
// ---------------------------------------------------------------------------
echo "\n== 1) EstadosEcf ==\n";
wa_chk('REINTENTABLES: las tres de hoy mas RFCE_NO_ENCONTRADO',
    EstadosEcf::REINTENTABLES === ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO'], EstadosEcf::REINTENTABLES);
wa_chk('PENDIENTE_ENVIO y ENVIO_INCIERTO',
    EstadosEcf::PENDIENTE_ENVIO === 'PENDIENTE_ENVIO' && EstadosEcf::ENVIO_INCIERTO === 'ENVIO_INCIERTO');
wa_chk('EN_VUELO: PENDIENTE_ENVIO y ENVIO_INCIERTO',
    EstadosEcf::EN_VUELO === ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'], EstadosEcf::EN_VUELO);
wa_chk('SIN_VEREDICTO: en vuelo + ENVIADO, EN_PROCESO y sus RFCE_',
    EstadosEcf::SIN_VEREDICTO === ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'],
    EstadosEcf::SIN_VEREDICTO);
wa_chk('SIN_STOCK: reintentables + ERROR y RFCE_ERROR',
    EstadosEcf::SIN_STOCK === ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO', 'ERROR', 'RFCE_ERROR'],
    EstadosEcf::SIN_STOCK);
foreach (['REINTENTABLES', 'EN_VUELO', 'SIN_VEREDICTO', 'SIN_STOCK'] as $lista) {
    $valores = constant('EstadosEcf::' . $lista);
    wa_chk("{$lista}: sin repetidos", count(array_unique($valores)) === count($valores), $valores);
}
wa_chk('EN_VUELO esta dentro de SIN_VEREDICTO', array_diff(EstadosEcf::EN_VUELO, EstadosEcf::SIN_VEREDICTO) === []);
wa_chk('REINTENTABLES esta dentro de SIN_STOCK', array_diff(EstadosEcf::REINTENTABLES, EstadosEcf::SIN_STOCK) === []);
wa_chk('una fila en vuelo nunca es reintentable', array_intersect(EstadosEcf::EN_VUELO, EstadosEcf::REINTENTABLES) === []);
wa_chk('una fila en vuelo no esta en SIN_STOCK (no es veredicto)', array_intersect(EstadosEcf::EN_VUELO, EstadosEcf::SIN_STOCK) === []);
wa_chk("sql(['A','B']) === \"'A', 'B'\"", EstadosEcf::sql(['A', 'B']) === "'A', 'B'", EstadosEcf::sql(['A', 'B']));
wa_chk('sql(EN_VUELO) para un IN (...)',
    EstadosEcf::sql(EstadosEcf::EN_VUELO) === "'PENDIENTE_ENVIO', 'ENVIO_INCIERTO'", EstadosEcf::sql(EstadosEcf::EN_VUELO));
$rechaza = static function (array $estados): bool {
    try {
        EstadosEcf::sql($estados);
        return false;
    } catch (InvalidArgumentException $e) {
        return true;
    }
};
wa_chk('sql() rechaza un valor con comilla', $rechaza(["ACEPTADO' OR '1'='1"]));
wa_chk('sql() rechaza la lista vacia (IN () no es SQL)', $rechaza([]));
$textoClase = (string) file_get_contents(__DIR__ . '/../src/Utils/FacturacionElectronica/EstadosEcf.php');
wa_chk('EstadosEcf no carga otros archivos (sin require ni include)',
    !preg_match('/\b(require|include)(_once)?\b/', $textoClase));
wa_chk('EstadosEcf es final', (new ReflectionClass(EstadosEcf::class))->isFinal());

// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega su seccion justo encima de este bloque.
// ---------------------------------------------------------------------------
wa_fin();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php`

Expected: exit code 255, with:

```
Warning: require_once(...\tools/../src/Utils/FacturacionElectronica/EstadosEcf.php): Failed to open stream: No such file or directory in ...\tools\test_write_ahead_puro.php on line 15

Fatal error: Uncaught Error: Failed opening required '...\tools/../src/Utils/FacturacionElectronica/EstadosEcf.php'
```

- [ ] **Step 3: Write `EstadosEcf`**

Create `src/Utils/FacturacionElectronica/EstadosEcf.php`:

```php
<?php

/**
 * Listas de estados del e-CF (columna facturas.estado_dgii) que comparten la
 * emision, los modelos y los reportes. Una sola copia de cada lista: antes la
 * de reintentables estaba repetida en ECFEmissionService y en facturaModel.
 *
 * Solo constantes y una funcion pura, sin dependencias: ECFEmissionService la
 * carga tambien en tenants de integracion, que no tienen DB de tenant, y
 * tools/check_estado_dgii_ancho.php la lee para revisar el ancho de la columna.
 *
 * Los estados en vuelo (PENDIENTE_ENVIO, ENVIO_INCIERTO) son del write-ahead:
 * la fila se guarda antes de enviar el e-CF a la DGII y se actualiza con la
 * respuesta (spec del write-ahead del e-CF, secciones 4.3 y 4.6).
 */
final class EstadosEcf
{
    /**
     * Veredictos que dejan reintentar el MISMO numero: la DGII no lo uso. La
     * reserva de un intento nuevo archiva la fila vieja (<estado>_ARCHIVADO,
     * e_ncf NULL) y eNcfYaUsado no salta el numero. RFCE_NO_ENCONTRADO entra
     * para que el flujo RFCE (E32 < 250k) se porte igual que el e-CF. ERROR y
     * RFCE_ERROR quedan fuera: ese numero se quema a proposito.
     */
    public const REINTENTABLES = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO'];

    /** Fila, XML firmado e items guardados; el envio no empezo o no termino. */
    public const PENDIENTE_ENVIO = 'PENDIENTE_ENVIO';

    /** Se envio (o se intento) y no se sabe si la DGII lo recibio. */
    public const ENVIO_INCIERTO = 'ENVIO_INCIERTO';

    /**
     * En vuelo: la fila ocupa su numero y la app no conoce un veredicto de la
     * DGII. Nunca se archiva sola, no es dinero (stats y reporte de ventas la
     * excluyen) y no mueve inventario.
     */
    public const EN_VUELO = [self::PENDIENTE_ENVIO, self::ENVIO_INCIERTO];

    /**
     * Filtro 'pendiente' del listado: todo estado sin veredicto de la DGII. Una
     * fila que termino en ENVIADO o EN_PROCESO tras perder la respuesta HTTP
     * aparece bajo el mismo filtro al que la manda el mensaje de timeout.
     */
    public const SIN_VEREDICTO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'];

    /** Veredictos que nunca mueven inventario: el comprobante no vale. */
    public const SIN_STOCK = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO', 'ERROR', 'RFCE_ERROR'];

    /**
     * Una lista de esta clase como lista SQL para IN (...): sql(['A', 'B'])
     * devuelve 'A', 'B'. El texto va pegado al SQL sin parametros, asi que solo
     * acepta codigos en mayusculas y guion bajo, como los de arriba.
     *
     * @throws InvalidArgumentException con la lista vacia o un valor que no es un codigo de estado
     */
    public static function sql(array $estados): string
    {
        if ($estados === []) {
            throw new InvalidArgumentException('EstadosEcf::sql: lista vacia');
        }
        foreach ($estados as $estado) {
            if (!is_string($estado) || !preg_match('/^[A-Z][A-Z_]*$/', $estado)) {
                throw new InvalidArgumentException('EstadosEcf::sql: estado no valido');
            }
        }
        return "'" . implode("', '", $estados) . "'";
    }
}
```

- [ ] **Step 4: Run the test and lint**

Run: `php -l src/Utils/FacturacionElectronica/EstadosEcf.php && php tools/test_write_ahead_puro.php`

Expected: `No syntax errors detected in src/Utils/FacturacionElectronica/EstadosEcf.php`, then 19 `[OK  ]` lines under
`== 1) EstadosEcf ==`, ending with:

```
19 de 19 pruebas OK
```

- [ ] **Step 5: Baseline of the width checker**

Run: `php tools/check_estado_dgii_ancho.php | tail -1`

Expected: `30/30 OK`.

- [ ] **Step 6: Make the checker read `EstadosEcf`**

In `tools/check_estado_dgii_ancho.php`, make four insertions.

(a) After `:19`, the header line ` *     el codigo realmente usa, y el mas largo cabe en el ancho del snapshot.`, insert:

```php
 *   - Los estados en vuelo del write-ahead (EstadosEcf::EN_VUELO) y cada
 *     reintentable archivado (EstadosEcf::REINTENTABLES + _ARCHIVADO) caben.
```

(b) After `:55`, `$readme = $leer('db/migrations/README.md');`, insert:

```php
// Las listas de EstadosEcf (en vuelo y reintentables). Es una clase de solo
// constantes: cargarla no toca la DB ni la red.
require_once $raiz . '/src/Utils/FacturacionElectronica/EstadosEcf.php';
```

(c) After `:85`, `$posibles = array_keys($posibles);`, before the `usort`, insert the line below. In-flight rows are
never archived (4.2.7), so their states take no prefix and no suffix.

```php
// En vuelo (write-ahead): sin prefijo ni sufijo. Una fila en vuelo nunca se
// archiva sola y PENDIENTE_ENVIO / ENVIO_INCIERTO no pasan por RFCE_.
$posibles = array_values(array_unique(array_merge($posibles, EstadosEcf::EN_VUELO)));
```

(d) After `:111`, the last line of the "defaults intactos" check
(`    ($snapF['default'] ?? '') === 'PENDIENTE' && ($snapG['default'] ?? '') === 'REGISTRADO');`), insert:

```php
$largoEnVuelo = max(array_map('strlen', EstadosEcf::EN_VUELO));
$chk("EstadosEcf: los estados en vuelo caben en facturas.estado_dgii ({$largoEnVuelo} <= {$anchoF})", $largoEnVuelo <= $anchoF);
$archivados = array_map(fn($e) => $e . '_ARCHIVADO', EstadosEcf::REINTENTABLES);
$largoArchivado = max(array_map('strlen', $archivados));
$chk("EstadosEcf: cada reintentable archivado cabe ({$largoArchivado} <= {$anchoF})", $largoArchivado <= $anchoF,
    implode(', ', $archivados));
```

- [ ] **Step 7: Run the checker and lint**

Run: `php -l tools/check_estado_dgii_ancho.php && php tools/check_estado_dgii_ancho.php`

Expected: the longest state is still `RFCE_ACEPTADO_CONDICIONAL_ARCHIVADO (35)`. Two new lines follow the defaults check:

```
  [OK  ] EstadosEcf: los estados en vuelo caben en facturas.estado_dgii (15 <= 40)
  [OK  ] EstadosEcf: cada reintentable archivado cabe (28 <= 40)
```

The run ends with `32/32 OK`, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add src/Utils/FacturacionElectronica/EstadosEcf.php tools/check_estado_dgii_ancho.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
feat(ecf): EstadosEcf con las listas de estados del e-CF

Una sola copia de REINTENTABLES (con RFCE_NO_ENCONTRADO), EN_VUELO,
SIN_VEREDICTO y SIN_STOCK, sin dependencias. check_estado_dgii_ancho revisa
que los estados en vuelo y los reintentables archivados quepan en la columna.
Nace tools/test_write_ahead_puro.php, la prueba sin base del write-ahead.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Excepciones EcfNumeroOcupado y EcfEnvioIncierto

Run every command from the API worktree root (see Task 4).

**Files:**
- Create: `src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php` (28 lines). It does
  `require_once __DIR__ . '/EcfUsuarioException.php'`; the parent is at `EcfUsuarioException.php:16-30`, with its
  constructor at `:20-24`.
- Create: `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php` (45 lines). It uses PHP 8.1 `readonly`
  properties and nothing from 8.4.
- Modify: `tools/test_write_ahead_puro.php`: insert section 2 directly above the closing block (`:59-62` after Task 4).
- Test: `php tools/test_write_ahead_puro.php`, section 2.

**Interfaces:**
- Consumes: `EcfUsuarioException::__construct(string $mensajeTecnico, string $mensajeUsuario, int $code = 0, ?Throwable $previous = null)`
  and `getMensajeUsuario(): string`, both existing.
- Produces:

```php
class EcfNumeroOcupadoException extends EcfUsuarioException {
    public const MENSAJE_USUARIO = 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.';
    public function __construct(string $eNcf, string $ambiente, string $causa, ?Throwable $previous = null);
    // getMessage() === sprintf('e-NCF %s ocupado en ambiente %s: %s', $eNcf, $ambiente, $causa)
}
class EcfEnvioInciertoException extends RuntimeException {
    public readonly string $eNcf;
    public readonly int $facturaId;
    public readonly string $ambiente;
    public readonly string $faseFallida;          // 'envio' | 'confirmar'
    public readonly ?array $resultadoParcial;     // proyectarResultado shape (8 keys) or null
    public readonly bool $marcado;                // true = 'incierto' stored ENVIO_INCIERTO
    public function __construct(string $eNcf, int $facturaId, string $ambiente, string $faseFallida, ?array $resultadoParcial, bool $marcado, ?Throwable $previous = null);
    // getMessage() === sprintf('Envio a la DGII sin confirmar: e-NCF %s, factura_id %d, fase %s', $eNcf, $facturaId, $faseFallida)
}
```

- [ ] **Step 1: Write the failing section 2**

In `tools/test_write_ahead_puro.php`, insert this block directly above the closing block, so that the rule line of
the closing block follows the block's trailing blank line:

```php
// ---------------------------------------------------------------------------
// 2) Excepciones: numero ocupado y envio incierto (spec 4.5)
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php';

echo "\n== 2) EcfNumeroOcupadoException y EcfEnvioInciertoException ==\n";
$causaPdo = new PDOException('Duplicate entry');
$ocupado = new EcfNumeroOcupadoException('E310000000123', 'ecf', 'fila 9 en ACEPTADO', $causaPdo);
wa_chk('Ocupado es EcfUsuarioException (el 502 de la app muestra su texto)', $ocupado instanceof EcfUsuarioException);
wa_chk('Ocupado: texto para el usuario exacto',
    $ocupado->getMensajeUsuario() === 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.', $ocupado->getMensajeUsuario());
wa_chk('Ocupado: MENSAJE_USUARIO es ese mismo texto', EcfNumeroOcupadoException::MENSAJE_USUARIO === $ocupado->getMensajeUsuario());
wa_chk('Ocupado: el texto tecnico trae e-NCF, ambiente y causa',
    $ocupado->getMessage() === 'e-NCF E310000000123 ocupado en ambiente ecf: fila 9 en ACEPTADO', $ocupado->getMessage());
wa_chk('Ocupado: conserva la excepcion anterior', $ocupado->getPrevious() === $causaPdo);
wa_chk('Ocupado sin excepcion anterior: getPrevious() null',
    (new EcfNumeroOcupadoException('E310000000124', 'ecf', 'archivo sin coincidencia'))->getPrevious() === null);

$causaRed = new RuntimeException('HTTP request failed: timeout');
$parcial = ['estado' => 'ACEPTADO', 'track_id' => 'track-E310000000123', 'dgii_status_code' => 200, 'dgii_response' => ['codigo' => 1],
    'rfce_estado' => null, 'rfce_track_id' => null, 'rfce_status_code' => null, 'secuencia_utilizada' => true];
$incierto = new EcfEnvioInciertoException('E310000000123', 41, 'ecf', 'envio', $parcial, true, $causaRed);
wa_chk('Incierto: mensaje del spec',
    $incierto->getMessage() === 'Envio a la DGII sin confirmar: e-NCF E310000000123, factura_id 41, fase envio', $incierto->getMessage());
wa_chk('Incierto: las propiedades guardan lo recibido',
    [$incierto->eNcf, $incierto->facturaId, $incierto->ambiente, $incierto->faseFallida, $incierto->resultadoParcial, $incierto->marcado]
    === ['E310000000123', 41, 'ecf', 'envio', $parcial, true]);
$sinParcial = new EcfEnvioInciertoException('E320000000007', 42, 'certecf', 'confirmar', null, false);
wa_chk('Incierto: resultadoParcial null y marcado false se aceptan',
    $sinParcial->resultadoParcial === null && $sinParcial->marcado === false && $sinParcial->getPrevious() === null);
$soloLectura = array_filter(
    ['eNcf', 'facturaId', 'ambiente', 'faseFallida', 'resultadoParcial', 'marcado'],
    static fn(string $p): bool => (new ReflectionProperty(EcfEnvioInciertoException::class, $p))->isReadOnly()
);
wa_chk('Incierto: las seis propiedades son readonly', count($soloLectura) === 6, array_values($soloLectura));
try {
    $incierto->marcado = false;
    $escribio = true;
} catch (Error $e) {
    $escribio = false;
}
wa_chk('Incierto: escribir marcado lanza Error', $escribio === false && $incierto->marcado === true);
wa_chk('Incierto: conserva la excepcion original', $incierto->getPrevious() === $causaRed);
wa_chk('Incierto: es RuntimeException y no EcfUsuarioException',
    $incierto instanceof RuntimeException && !($incierto instanceof EcfUsuarioException));

```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php`

Expected: section 1 still prints 19 `[OK  ]` lines. Then the run stops with
`Fatal error: Uncaught Error: Failed opening required '...\tools/../src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php'`,
exit code 255.

- [ ] **Step 3: Write `EcfNumeroOcupadoException`**

Create `src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php`. Save it as UTF-8, because the user text has
accents:

```php
<?php

require_once __DIR__ . '/EcfUsuarioException.php';

/**
 * El e-NCF que se iba a reservar ya tiene dueno en ese ambiente: una fila que
 * no es reintentable, una clave duplicada (1062) o un segundo deadlock (1213)
 * al reservar. Solo la lanza facturaModel::reservarFacturaECF, antes de enviar
 * nada a la DGII.
 *
 * Como una fila ocupa el numero, la emision NO devuelve el contador: es el
 * mismo efecto que el salto de eNcfYaUsado, y el siguiente intento toma el
 * numero que sigue. La app muestra getMensajeUsuario() en el 502.
 */
class EcfNumeroOcupadoException extends EcfUsuarioException
{
    public const MENSAJE_USUARIO = 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.';

    public function __construct(string $eNcf, string $ambiente, string $causa, ?Throwable $previous = null)
    {
        parent::__construct(
            sprintf('e-NCF %s ocupado en ambiente %s: %s', $eNcf, $ambiente, $causa),
            self::MENSAJE_USUARIO,
            0,
            $previous
        );
    }
}
```

- [ ] **Step 4: Write `EcfEnvioInciertoException`**

Create `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php`:

```php
<?php

/**
 * La fila del e-CF ya estaba guardada (PENDIENTE_ENVIO) y el envio a la DGII o
 * la confirmacion fallo: no se sabe si la DGII lo tiene. Solo la lanza
 * ECFEmissionService::emitir cuando hay hook de persistencia y una reserva;
 * integracion y gastos siguen recibiendo la excepcion original.
 *
 * El controller responde 502 con data.factura_id para llevar al usuario a la
 * fila. La app nunca reenvia el e-CF (decision 7): lo resuelve soporte.
 */
class EcfEnvioInciertoException extends RuntimeException
{
    public readonly string $eNcf;
    public readonly int $facturaId;
    public readonly string $ambiente;
    /** 'envio' (fallo el envio) o 'confirmar' (la DGII respondio y fallo el UPDATE). */
    public readonly string $faseFallida;
    /** Proyeccion sin XML de la respuesta (las 8 claves de proyectarResultado) o null. */
    public readonly ?array $resultadoParcial;
    /** true si 'incierto' dejo la fila en ENVIO_INCIERTO; false si quedo en PENDIENTE_ENVIO. */
    public readonly bool $marcado;

    public function __construct(
        string $eNcf,
        int $facturaId,
        string $ambiente,
        string $faseFallida,
        ?array $resultadoParcial,
        bool $marcado,
        ?Throwable $previous = null
    ) {
        $this->eNcf = $eNcf;
        $this->facturaId = $facturaId;
        $this->ambiente = $ambiente;
        $this->faseFallida = $faseFallida;
        $this->resultadoParcial = $resultadoParcial;
        $this->marcado = $marcado;
        parent::__construct(
            sprintf('Envio a la DGII sin confirmar: e-NCF %s, factura_id %d, fase %s', $eNcf, $facturaId, $faseFallida),
            0,
            $previous
        );
    }
}
```

- [ ] **Step 5: Lint and run**

Run: `php -l src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php && php -l src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php && php tools/test_write_ahead_puro.php`

Expected: two `No syntax errors detected` lines. Section 2 then prints 13 `[OK  ]` lines, and the run ends with:

```
32 de 32 pruebas OK
```

- [ ] **Step 6: Commit**

```bash
git add src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
feat(ecf): excepciones de numero ocupado y envio incierto

EcfNumeroOcupadoException (EcfUsuarioException) para un e-NCF que ya tiene
fila al reservar; EcfEnvioInciertoException con la fila guardada, la fase que
fallo, el resultado parcial y si quedo marcada ENVIO_INCIERTO.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: facturaModel: metaEnvio, notas en vuelo y filtro pendiente

Run every command from the API worktree root (see Task 4). `facturaModel.php` is still at `9f669ad`, so its line numbers
hold.

**Files:**
- Modify: `src/Models/facturaModel.php` (1699 lines):
  - requires `:2-5`: insert after `:5`;
  - `ESTADOS_NOTA_VIGENTE`: docblock `:31-37`, const `:38`;
  - `sqlEstadosNotaVigente()` `:1055-1059` (body `:1058`);
  - `applyEstadoTipoFilters`: docblock `:1098-1102`, body `:1103-1114` (the new branch goes after `:1108`);
  - `metaEnvio` goes directly above `getECFData` (`:1511`);
  - `sqlReferencia`: docblock `:1606-1610`, SQL comment `:1628-1630`.

  This one change to `ESTADOS_NOTA_VIGENTE` moves `adjuntarNotasVinculadas` (`:935`), `vincularNotas` (`:998-999`) and
  `sqlReferencia` (`:1631`) together.
- Modify: `tools/test_notas_vinculadas.php` (362 lines): header `:10-11`, section comment `:111`, state map `:113-117`
  (line `:116`), equality `:126-128` (line `:128`), notes SQL literal `:261-263` (line `:263`), `sqlReferencia` literal
  `:311-313` (line `:313`).
- Modify: `tools/test_write_ahead_puro.php`: insert section 3 above the closing block (`:106-109` after Task 5).
- Test:
  - `php tools/test_notas_vinculadas.php` goes from 60 to 62 checks;
  - `php tools/test_write_ahead_puro.php`, section 3;
  - `php tools/check_estado_dgii_ancho.php`.

**Interfaces:**
- Consumes (Task 4): `EstadosEcf::EN_VUELO`, `EstadosEcf::SIN_VEREDICTO` and `EstadosEcf::sql(array): string`.
- Produces:

```php
public const ESTADOS_NOTA_VIGENTE = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', ...EstadosEcf::EN_VUELO];
// = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO']
public static function metaEnvio(?string $respuestaDgii): array;   // [] for NULL, '', invalid JSON or the JSON of a string
// private applyEstadoTipoFilters(array &$conditions, array &$params, $estado, $tipoEcf): void
//   $estado === 'pendiente' => condition 'f.estado_dgii IN (:est0, :est1, :est2, :est3, :est4, :est5)',
//   params ':est0'..':est5' = EstadosEcf::SIN_VEREDICTO in order (named placeholders only)
```

  `facturaModel.php` now does `require_once` on `EstadosEcf.php`, so every later consumer of the model gets the class.

- [ ] **Step 1: Point `test_notas_vinculadas.php` at the six-state list**

Make six edits in `tools/test_notas_vinculadas.php`.

`:11`: replace

```php
 *                 aceptadas o en proceso), por id ascendente.
```

with

```php
 *                 aceptadas, en proceso o en vuelo), por id ascendente.
```

`:111`: replace

```php
// 4) Misma regla de estado que sqlReferencia: rechazadas y archivadas no cuentan
```

with

```php
// 4) Misma regla de estado que sqlReferencia: rechazadas y archivadas no
// cuentan; las en vuelo (PENDIENTE_ENVIO, ENVIO_INCIERTO) si
```

`:116`: replace

```php
    'RECHAZADO_ARCHIVADO' => false,
```

with

```php
    'RECHAZADO_ARCHIVADO' => false, 'PENDIENTE_ENVIO' => true, 'ENVIO_INCIERTO' => true,
```

`:128`: replace

```php
    && facturaModel::ESTADOS_NOTA_VIGENTE === ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO']);
```

with

```php
    && facturaModel::ESTADOS_NOTA_VIGENTE === ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO']);
```

`:263`: replace

```php
    && str_contains($qNotas['sql'], "estado_dgii IN ('ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO')"), $qNotas['sql'] ?? null);
```

with

```php
    && str_contains($qNotas['sql'], "estado_dgii IN ('ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO')"),
    $qNotas['sql'] ?? null);
```

`:313`: replace

```php
    str_contains($sqlRef, "estado_dgii IN ('ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO')"), $sqlRef);
```

with

```php
    str_contains($sqlRef, "estado_dgii IN ('ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO')"),
    $sqlRef);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_notas_vinculadas.php | grep -v '^  \[OK'; echo "exit=${PIPESTATUS[0]}"`

`PIPESTATUS[0]` is the test's own status; `$?` would be `grep`'s. Expected: these five failures, and the last line is `exit=1`:

```
  [FALLO] nota en PENDIENTE_ENVIO cuenta
  [FALLO] nota en ENVIO_INCIERTO cuenta
  [FALLO] la regla de estado es la de sqlReferencia
  [FALLO] consulta de notas: filtra tipo 33/34 y los estados de sqlReferencia
  [FALLO] sqlReferencia cuenta las notas con los mismos estados
```

Each failure is followed by its `obtenido:` line. The test's output ends with `57 de 62 pruebas OK`, then the shell prints `exit=1`.

- [ ] **Step 3: Write the failing section 3**

In `tools/test_write_ahead_puro.php`, insert directly above the closing block:

```php
// ---------------------------------------------------------------------------
// 3) facturaModel: metaEnvio, filtro 'pendiente' y notas en vuelo (spec 4.6, 2.1)
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/Models/facturaModel.php';

echo "\n== 3) facturaModel: metaEnvio, filtro pendiente, notas en vuelo ==\n";
wa_chk('metaEnvio(null) = []', facturaModel::metaEnvio(null) === []);
wa_chk('metaEnvio(\'"Recibido"\') = [] (fila ENVIADO vieja: JSON de un texto)', facturaModel::metaEnvio('"Recibido"') === []);
wa_chk("metaEnvio('{bad') = [] (JSON roto)", facturaModel::metaEnvio('{bad') === []);
$metaReserva = '{"fase":"PENDIENTE_ENVIO","desde":"2026-10-05 14:03:11","flujo":"ECF","ambiente_secuencia":"ecf",'
    . '"dispensado":true,"rango_id":7,"secuencia_valor":123}';
$meta = facturaModel::metaEnvio($metaReserva);
wa_chk('metaEnvio(JSON 6.3) trae rango_id 7 y secuencia_valor 123',
    ($meta['rango_id'] ?? null) === 7 && ($meta['secuencia_valor'] ?? null) === 123 && ($meta['fase'] ?? null) === 'PENDIENTE_ENVIO', $meta);

$filtros = static function ($estado, $tipoEcf): array {
    $modelo = (new ReflectionClass(facturaModel::class))->newInstanceWithoutConstructor();
    $condiciones = [];
    $params = [];
    $args = [&$condiciones, &$params, $estado, $tipoEcf];
    (new ReflectionMethod(facturaModel::class, 'applyEstadoTipoFilters'))->invokeArgs($modelo, $args);
    return [$condiciones, $params];
};
[$cond, $par] = $filtros('pendiente', null);
wa_chk("'pendiente': una condicion IN con marcadores con nombre",
    $cond === ['f.estado_dgii IN (:est0, :est1, :est2, :est3, :est4, :est5)'], $cond);
wa_chk("'pendiente': los parametros son SIN_VEREDICTO en orden",
    $par === array_combine([':est0', ':est1', ':est2', ':est3', ':est4', ':est5'], EstadosEcf::SIN_VEREDICTO), $par);
[$cond, $par] = $filtros('pendiente', '31');
wa_chk("'pendiente' + tipo 31: suma la condicion y :tipo_ecf",
    count($cond) === 2 && $cond[1] === 'f.tipo_ecf = :tipo_ecf' && ($par[':tipo_ecf'] ?? null) === '31' && count($par) === 7, [$cond, $par]);
wa_chk("'aprobado' sin cambios", $filtros('aprobado', null) === [["f.estado_dgii LIKE '%ACEPTADO%'"], []], $filtros('aprobado', null));
wa_chk("'rechazado' sin cambios", $filtros('rechazado', null) === [["f.estado_dgii LIKE '%RECHAZADO%'"], []], $filtros('rechazado', null));
wa_chk('sin estado: ninguna condicion', $filtros(null, null) === [[], []], $filtros(null, null));
wa_chk('ESTADOS_NOTA_VIGENTE termina con EstadosEcf::EN_VUELO (una sola lista)',
    array_slice(facturaModel::ESTADOS_NOTA_VIGENTE, -2) === EstadosEcf::EN_VUELO, facturaModel::ESTADOS_NOTA_VIGENTE);

```

- [ ] **Step 4: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php`

Expected: sections 1 and 2 pass, then the run stops with
`Fatal error: Uncaught Error: Call to undefined method facturaModel::metaEnvio()`, exit code 255.

- [ ] **Step 5: Change the model**

Make seven edits in `src/Models/facturaModel.php`.

(a) After `:5`, `require_once(__DIR__ . '/ncfModel.php');`, insert:

```php
require_once(__DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php');
```

(b) Replace the docblock and constant at `:31-38`:

```php
    /**
     * Estados en que una nota E33/E34 cuenta contra la factura que modifica:
     * los que la DGII tiene (aceptada o en proceso). Una en ERROR o
     * NO_ENCONTRADO (o su intento archivado) no llego a valer. Lo usan
     * sqlReferencia() (saldo para una nota nueva) y vincularNotas() (listado y
     * detalle), para que pantalla y emision cuenten las mismas notas.
     */
    public const ESTADOS_NOTA_VIGENTE = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO'];
```

with:

```php
    /**
     * Estados en que una nota E33/E34 cuenta contra la factura que modifica:
     * los que la DGII tiene (aceptada o en proceso) y los en vuelo
     * (EstadosEcf::EN_VUELO: guardada antes de enviar, sin respuesta todavia).
     * Una nota en vuelo reserva saldo, para que no salga una segunda nota sobre
     * el mismo monto mientras la primera no se resuelve, y sale vinculada en el
     * listado y el detalle; el frontend la marca "sin confirmar". Una en ERROR
     * o NO_ENCONTRADO (o su intento archivado) no llego a valer. Lo usan
     * sqlReferencia() (saldo para una nota nueva) y vincularNotas() (listado y
     * detalle), para que pantalla y emision cuenten las mismas notas.
     */
    public const ESTADOS_NOTA_VIGENTE = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO', ...EstadosEcf::EN_VUELO];
```

(c) In `sqlEstadosNotaVigente()`, replace `:1058`:

```php
        return "'" . implode("', '", self::ESTADOS_NOTA_VIGENTE) . "'";
```

with:

```php
        return EstadosEcf::sql(self::ESTADOS_NOTA_VIGENTE);
```

(d) Replace the docblock of `applyEstadoTipoFilters` (`:1098-1102`):

```php
    /**
     * Filtros compartidos del listado: estado ('aprobado'|'rechazado', ya
     * normalizado por el controller; 'aprobado' incluye ACEPTADO_CONDICIONAL y
     * los estados RFCE_*) y tipo_ecf ('31'..'47', sin la 'E').
     */
```

with:

```php
    /**
     * Filtros compartidos del listado: estado ('aprobado'|'rechazado'|'pendiente',
     * ya normalizado por el controller) y tipo_ecf ('31'..'47', sin la 'E').
     * 'aprobado' incluye ACEPTADO_CONDICIONAL y los estados RFCE_*. 'pendiente'
     * es EstadosEcf::SIN_VEREDICTO: todo lo que no tiene veredicto de la DGII,
     * las filas en vuelo incluidas.
     *
     * Solo marcadores con nombre (:est0, :tipo_ecf): los mismos $params van a
     * bindValue() en getFacturasPaginated y a execute() en getFacturasCount.
     */
```

(e) In its body, after `:1108`, `$conditions[] = "f.estado_dgii LIKE '%RECHAZADO%'";`, and before the closing `}` of the
`if`/`elseif` chain, insert the new branch. The chain then reads:

```php
        if ($estado === 'aprobado') {
            $conditions[] = "f.estado_dgii LIKE '%ACEPTADO%'";
        } elseif ($estado === 'rechazado') {
            $conditions[] = "f.estado_dgii LIKE '%RECHAZADO%'";
        } elseif ($estado === 'pendiente') {
            $marcas = [];
            foreach (EstadosEcf::SIN_VEREDICTO as $i => $estadoSinVeredicto) {
                $marcas[] = ":est{$i}";
                $params[":est{$i}"] = $estadoSinVeredicto;
            }
            $conditions[] = 'f.estado_dgii IN (' . implode(', ', $marcas) . ')';
        }
```

(f) Directly above `public function getECFData(int $facturaId): ?array` (`:1511`), insert:

```php
    /**
     * Meta del envio que respuesta_dgii guarda mientras la fila esta en vuelo
     * (spec 6.3): fase, desde, flujo, ambiente_secuencia, dispensado, rango_id,
     * secuencia_valor y, en ENVIO_INCIERTO, el fallo. [] si no hay meta: NULL,
     * JSON roto o el JSON de un texto (filas ENVIADO viejas, de una DGII que
     * respondio 2xx sin JSON). Quien lea rango_id, secuencia_valor o
     * ambiente_secuencia pasa por aqui, y antes de que la confirmacion pise la
     * columna con la respuesta de la DGII. Sin rango_id = rollback heredado por
     * tipo + ambiente (ncfModel::rollbackECFSequence).
     */
    public static function metaEnvio(?string $respuestaDgii): array
    {
        if ($respuestaDgii === null || $respuestaDgii === '') {
            return [];
        }
        $meta = json_decode($respuestaDgii, true);
        return is_array($meta) ? $meta : [];
    }

```

(g) Reword the two comments of `sqlReferencia`. Replace the docblock at `:1606-1610`:

```php
    /**
     * Factura + lo que ya le ajustaron las notas que la referencian. Solo
     * cuentan las notas aceptadas o en proceso en la DGII: una rechazada, en
     * ERROR o NO_ENCONTRADO no ajusto nada y el usuario debe poder reintentarla.
     */
```

with:

```php
    /**
     * Factura + lo que ya le ajustaron las notas que la referencian. Cuentan
     * las notas de ESTADOS_NOTA_VIGENTE: aceptadas, en proceso o en vuelo (una
     * en vuelo reserva saldo hasta que se resuelva). Una rechazada, en ERROR o
     * NO_ENCONTRADO no ajusto nada y el usuario debe poder reintentarla.
     */
```

Then replace the SQL comment at `:1628-1630`:

```php
                      -- Solo notas que la DGII tiene: aceptadas o en proceso. Una en ERROR o
                      -- NO_ENCONTRADO (o su intento archivado) no llego a valer, y contarla
                      -- bloquearia el reintento que el propio mensaje le pide al usuario.
```

with:

```php
                      -- Solo notas vigentes: aceptadas, en proceso o en vuelo (en vuelo
                      -- reserva saldo). Una en ERROR o NO_ENCONTRADO (o su intento archivado)
                      -- no llego a valer, y contarla bloquearia el reintento que el propio
                      -- mensaje le pide al usuario.
```

- [ ] **Step 6: Run everything and lint**

Run: `php -l src/Models/facturaModel.php && php tools/test_write_ahead_puro.php | tail -1 && php tools/test_notas_vinculadas.php | tail -1 && php tools/check_estado_dgii_ancho.php | tail -1`

Expected:

```
No syntax errors detected in src/Models/facturaModel.php
43 de 43 pruebas OK
62 de 62 pruebas OK
32/32 OK
```

Section 3 prints its 11 checks, all `[OK  ]`.

- [ ] **Step 7: Commit**

```bash
git add src/Models/facturaModel.php tools/test_notas_vinculadas.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
feat(facturas): metaEnvio, filtro pendiente y notas en vuelo en el saldo

ESTADOS_NOTA_VIGENTE suma EstadosEcf::EN_VUELO: una nota en vuelo reserva saldo
y sale vinculada. El listado acepta estado 'pendiente' (SIN_VEREDICTO, con
marcadores con nombre). metaEnvio lee la meta del envio de respuesta_dgii.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: facturaModel::normalizarNotaReferencia

Run every command from the API worktree root (see Task 4). Behavior does not change: the nota block of
`saveFacturaConECF` moves into a pure method, and `saveFacturaConECF` calls it until Task 17 removes it.

**Files:**
- Modify: `src/Models/facturaModel.php` (1737 lines after Task 6):
  - the docblock of `saveFacturaConECF` starts at `:1151` (`/**`, then ` * Save a factura together with its e-CF emission result.`);
    the new method goes directly above it;
  - the method itself is at `:1161`;
  - the nota block is `:1166-1187`;
  - the four nota bindings are `:1261-1264`.
- Modify: `tools/test_write_ahead_puro.php`: insert section 4 above the closing block (`:143-146` after Task 6).
- Test: `php tools/test_write_ahead_puro.php` (section 4) and `php tools/test_notas_vinculadas.php`.

**Interfaces:**
- Consumes: `facturaModel::TIPOS_NOTA` (`:29`, existing).
- Produces:

```php
/** @return array{ncf_modificado:?string, fecha_ncf_modificado:?string, codigo_modificacion:?string, razon_modificacion:?string} */
public static function normalizarNotaReferencia(array $factura, string $tipoEcf): array
// reads only $factura['informacion_referencia'] (array, or anything else = []); keys in that order
```

- [ ] **Step 1: Write the failing section 4**

In `tools/test_write_ahead_puro.php`, insert directly above the closing block:

```php
// ---------------------------------------------------------------------------
// 4) facturaModel::normalizarNotaReferencia (campos de la nota E33/E34)
// ---------------------------------------------------------------------------
echo "\n== 4) facturaModel::normalizarNotaReferencia ==\n";
$conRef = static fn(array $info): array => ['informacion_referencia' => $info];
$credito = facturaModel::normalizarNotaReferencia($conRef([
    'ncf_modificado' => 'E310000000020', 'fecha_ncf_modificado' => '05-10-2026',
    'codigo_modificacion' => '3', 'razon_modificacion' => '',
]), '34');
wa_chk('E34 con razon vacia: el default de credito',
    $credito['razon_modificacion'] === 'Nota de credito por ajuste de monto', $credito);
wa_chk("fecha '05-10-2026' (d-m-Y del payload) -> '2026-10-05' (DATE)", $credito['fecha_ncf_modificado'] === '2026-10-05', $credito);
wa_chk("codigo_modificacion '3' -> '3'", $credito['codigo_modificacion'] === '3', $credito);
wa_chk('ncf_modificado se guarda tal cual', $credito['ncf_modificado'] === 'E310000000020', $credito);
wa_chk('las cuatro claves, en el orden de las columnas',
    array_keys($credito) === ['ncf_modificado', 'fecha_ncf_modificado', 'codigo_modificacion', 'razon_modificacion'], array_keys($credito));
$debito = facturaModel::normalizarNotaReferencia($conRef(['ncf_modificado' => 'E310000000020', 'razon_modificacion' => '']), '33');
wa_chk('E33 con razon vacia: el default de debito', $debito['razon_modificacion'] === 'Nota de debito por ajuste de monto', $debito);
$vacio = ['ncf_modificado' => null, 'fecha_ncf_modificado' => null, 'codigo_modificacion' => null, 'razon_modificacion' => null];
wa_chk('E31 sin informacion_referencia: las cuatro en null', facturaModel::normalizarNotaReferencia([], '31') === $vacio,
    facturaModel::normalizarNotaReferencia([], '31'));
wa_chk('informacion_referencia que no es arreglo se ignora',
    facturaModel::normalizarNotaReferencia(['informacion_referencia' => 'x'], '31') === $vacio);
wa_chk('E31 con razon vacia: sin default (solo las notas lo llevan)',
    facturaModel::normalizarNotaReferencia($conRef(['razon_modificacion' => '']), '31')['razon_modificacion'] === null);
wa_chk("fecha '2026-10-05' (formato equivocado) -> null",
    facturaModel::normalizarNotaReferencia($conRef(['fecha_ncf_modificado' => '2026-10-05']), '34')['fecha_ncf_modificado'] === null);
wa_chk("ncf_modificado '' -> null",
    facturaModel::normalizarNotaReferencia($conRef(['ncf_modificado' => '']), '34')['ncf_modificado'] === null);
wa_chk('una razon explicita se conserva',
    facturaModel::normalizarNotaReferencia($conRef(['razon_modificacion' => 'Devolucion parcial']), '34')['razon_modificacion'] === 'Devolucion parcial');
$textoModelo = (string) file_get_contents(__DIR__ . '/../src/Models/facturaModel.php');
wa_chk("facturaModel usa TIPOS_NOTA: la lista ['33', '34'] aparece una sola vez (la constante)",
    substr_count($textoModelo, "['33', '34']") === 1, substr_count($textoModelo, "['33', '34']"));

```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php`

Expected: sections 1-3 pass, then the run stops with
`Fatal error: Uncaught Error: Call to undefined method facturaModel::normalizarNotaReferencia()`, exit code 255.

- [ ] **Step 3: Add the pure method**

In `src/Models/facturaModel.php`, directly above the docblock of `saveFacturaConECF` (`:1151`), insert:

```php
    /**
     * Campos de InformacionReferencia (notas E33/E34) tal como los guarda la
     * fila. Se persisten para mostrar el NCF modificado y el motivo en la
     * representacion impresa (norma DGII). Pura: no toca la DB.
     *
     * La razon se completa con un default si viene vacia, igual que
     * ECFXmlBuilder::normalizeNotaReferenceData(), para que el PDF y el XML
     * firmado muestren el mismo texto. El payload trae la fecha en d-m-Y y la
     * columna es DATE (Y-m-d); una fecha que no se puede leer queda null.
     *
     * @param array $factura lee solo 'informacion_referencia' (arreglo o ausente)
     * @return array{ncf_modificado:?string, fecha_ncf_modificado:?string, codigo_modificacion:?string, razon_modificacion:?string}
     */
    public static function normalizarNotaReferencia(array $factura, string $tipoEcf): array
    {
        $infoRef = is_array($factura['informacion_referencia'] ?? null) ? $factura['informacion_referencia'] : [];
        $razon = (string) ($infoRef['razon_modificacion'] ?? '');
        if ($razon === '' && in_array($tipoEcf, self::TIPOS_NOTA, true)) {
            $razon = $tipoEcf === '34'
                ? 'Nota de credito por ajuste de monto'
                : 'Nota de debito por ajuste de monto';
        }
        $fecha = null;
        if (($infoRef['fecha_ncf_modificado'] ?? '') !== '') {
            $dt = DateTime::createFromFormat('d-m-Y', (string) $infoRef['fecha_ncf_modificado']);
            $fecha = $dt ? $dt->format('Y-m-d') : null;
        }
        return [
            'ncf_modificado' => ($infoRef['ncf_modificado'] ?? '') !== '' ? (string) $infoRef['ncf_modificado'] : null,
            'fecha_ncf_modificado' => $fecha,
            'codigo_modificacion' => ($infoRef['codigo_modificacion'] ?? '') !== '' ? (string) $infoRef['codigo_modificacion'] : null,
            'razon_modificacion' => $razon !== '' ? $razon : null,
        ];
    }

```

- [ ] **Step 4: Make `saveFacturaConECF` use it**

Replace the nota block at `:1166-1187` (it sits right after `$this->conexion->beginTransaction();` and a blank line):

```php
            // InformacionReferencia (Notas E33/E34): se persiste para mostrar el
            // NCF Modificado y el Motivo en la Representacion Impresa (norma DGII).
            // La razon se completa con un default si viene vacia, igual que
            // ECFXmlBuilder::normalizeNotaReferenceData(), para que el PDF y el
            // XML firmado muestren el mismo texto.
            $infoRef = is_array($factura['informacion_referencia'] ?? null) ? $factura['informacion_referencia'] : [];
            $tipoEcfNota = (string) ($ecf['tipo_ecf'] ?? '');
            $ncfModificado = ($infoRef['ncf_modificado'] ?? '') !== '' ? (string) $infoRef['ncf_modificado'] : null;
            $codigoModificacion = ($infoRef['codigo_modificacion'] ?? '') !== '' ? (string) $infoRef['codigo_modificacion'] : null;
            $razonModificacion = (string) ($infoRef['razon_modificacion'] ?? '');
            if (in_array($tipoEcfNota, ['33', '34'], true) && $razonModificacion === '') {
                $razonModificacion = $tipoEcfNota === '34'
                    ? 'Nota de credito por ajuste de monto'
                    : 'Nota de debito por ajuste de monto';
            }
            $razonModificacion = $razonModificacion !== '' ? $razonModificacion : null;
            // El payload trae la fecha en formato d-m-Y; la columna es DATE (Y-m-d).
            $fechaNcfModificado = null;
            if (($infoRef['fecha_ncf_modificado'] ?? '') !== '') {
                $dt = DateTime::createFromFormat('d-m-Y', (string) $infoRef['fecha_ncf_modificado']);
                $fechaNcfModificado = $dt ? $dt->format('Y-m-d') : null;
            }
```

with:

```php
            // Campos de la nota (E33/E34): ver normalizarNotaReferencia().
            $nota = self::normalizarNotaReferencia($factura, (string) ($ecf['tipo_ecf'] ?? ''));
```

Then, in the same method's INSERT bindings (`:1261-1264` before this step, `:1276-1279` after the two edits above),
replace:

```php
                ':ncf_modificado' => $ncfModificado,
                ':fecha_ncf_modificado' => $fechaNcfModificado,
                ':codigo_modificacion' => $codigoModificacion,
                ':razon_modificacion' => $razonModificacion,
```

with:

```php
                ':ncf_modificado' => $nota['ncf_modificado'],
                ':fecha_ncf_modificado' => $nota['fecha_ncf_modificado'],
                ':codigo_modificacion' => $nota['codigo_modificacion'],
                ':razon_modificacion' => $nota['razon_modificacion'],
```

- [ ] **Step 5: Run and lint**

Run: `php -l src/Models/facturaModel.php && php tools/test_write_ahead_puro.php | tail -1 && php tools/test_notas_vinculadas.php | tail -1`

Expected:

```
No syntax errors detected in src/Models/facturaModel.php
56 de 56 pruebas OK
62 de 62 pruebas OK
```

Section 4 prints its 13 checks, all `[OK  ]`. The last one confirms that the literal `['33', '34']` now appears only
in `TIPOS_NOTA`.

- [ ] **Step 6: Commit**

```bash
git add src/Models/facturaModel.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
refactor(facturas): normalizarNotaReferencia sale de saveFacturaConECF

Funcion pura con los cuatro campos de la nota (E33/E34), con TIPOS_NOTA en vez
de la lista literal. saveFacturaConECF la usa sin cambio de comportamiento.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: facturaModel::reservarFacturaECF

Run every command from the API worktree root (see Task 4). The DB test needs the scratch bases of Tasks 2 and 3
(`wa_scratch`, and the broken copy `wa_scratch_sin_gate`) and the credentials those tasks set up. It never runs
against production.

**Files:**
- Modify: `src/Models/facturaModel.php` (1752 lines after Task 7):
  - requires `:2-6`: insert after `:6`;
  - `normalizarNotaReferencia` is `:1151-1184`, a blank line follows, and the docblock of `saveFacturaConECF` starts at
    `:1186`. Insert the new block (the method, two private static helpers and one private rollback helper) between
    them. After the require line it starts at `:1187`.
- Modify: `tools/test_write_ahead_puro.php`: insert section 5 above the closing block (`:178-181` after Task 7).
  Section 5 defines the scripted fake connection that sections 6 and later reuse.
- Create: `tools/test_reservar_confirmar.php` (355 lines). Its closing block is `:351-355`: a rule line, the comment
  `// Cierre. Cada tarea agrega sus casos justo encima de este bloque.`, another rule line, `wa_limpiar($pdo);` and
  `wa_fin();`. Tasks 9 and 10 insert their cases directly above it.
- Test:
  - `php tools/test_write_ahead_puro.php` (section 5);
  - `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`.
  - Pass a `-d extension=…` flag only for an extension your `php.ini` does not load (Task 1).

**Interfaces:**
- Consumes:
  - Task 4: `EstadosEcf::REINTENTABLES` and `EstadosEcf::PENDIENTE_ENVIO`.
  - Task 5: `EcfNumeroOcupadoException(string $eNcf, string $ambiente, string $causa, ?Throwable $previous = null)`.
  - Task 7: `facturaModel::normalizarNotaReferencia(array $factura, string $tipoEcf): array`.
  - Task 1: `wa_chk`, `wa_fin`, `wa_arg(string $nombre, ?string $defecto = null): ?string` and `wa_php_flags(): array`.
  - Task 2: `wa_usar_base(string $base): PDO`, `wa_sembrar(PDO $pdo): array` (`['client_id'=>int,'product_id'=>int]`),
    `wa_limpiar(PDO $pdo): void` and `wa_filas(PDO $pdo, string $eNcf): array`. `wa_filas` returns rows ordered by
    id, with the columns `id`, `e_ncf`, `no_factura`, `estado_dgii`, `track_id`, `secuencia_utilizada`, `tiene_xml`,
    `tiene_rfce`, `respuesta_dgii` and `ambiente_dgii`.
  - The bases: `wa_scratch` (Task 2) and `wa_scratch_sin_gate`, which has `estado_dgii VARCHAR(20)` and the global
    `uk_e_ncf` (Task 3).
- Produces:

```php
/**
 * @param array $factura {date, client_id, client_name, total, tipo_pago, user_id, informacion_referencia, items[]}  (controller $facturaInput, no 'no_factura')
 * @param array $ctx the 'reservar' ctx: tipo_ecf, e_ncf, ambiente, ambiente_secuencia, signed_xml, codigo_seguridad,
 *                   fecha_emision_dgii, flujo, rfce_xml, dispensado, rango_id, secuencia_valor, desde
 * @return array{factura_id:int, e_ncf:string, desde:string}
 * @throws EcfNumeroOcupadoException | PDOException | InvalidArgumentException
 */
public function reservarFacturaECF(array $factura, array $ctx): array
private static function metaEnVuelo(array $ctx): array   // ['desde','flujo','ambiente_secuencia','dispensado','rango_id','secuencia_valor'], missing = null
private static function json(mixed $valor): ?string      // null => null; json_encode($valor, JSON_INVALID_UTF8_SUBSTITUTE); false => null
private function deshacer(): void                        // rollBack if inTransaction(); a failing rollBack is only logged
```

  - **Stored reserve JSON:** `{"fase":"PENDIENTE_ENVIO","desde","flujo","ambiente_secuencia","dispensado","rango_id","secuencia_valor"}` (6.3).
  - **Log lines:**
    - `[ECF e-NCF=<x>] reservar: deadlock (1213), reintento`;
    - `[ECF e-NCF=<x>] reservar: ambiente del token <a> distinto del de la secuencia <b>`.
  - **Ocupado causes:**
    - `'fila <id> en <estado>'`;
    - `'archivo sin coincidencia'`;
    - `'clave duplicada (1062)'`;
    - `'deadlock (1213) dos veces'`.
  - **Exported by section 5 of `tools/test_write_ahead_puro.php`, for later sections:**
    - the classes `GuionConexion` and `GuionSentencia` (script rows, `rowCount` and errors by SQL fragment; `de()`,
      `sql()`, `params()`);
    - the functions `puro_pdo_error(int $codigo, string $sqlstate, string $texto): PDOException`,
      `puro_con_log(callable $fn): array` (`[resultado, excepcion, log]`) and
      `puro_modelo(object $conexion): facturaModel`;
    - `puro_ctx_reservar(array $cambios = []): array` (the 13 keys, `ambiente` `'ecf'`, e-NCF `E310000000123`) and
      `puro_factura(array $cambios = []): array`.

- [ ] **Step 1: Write the failing section 5**

In `tools/test_write_ahead_puro.php`, insert directly above the closing block:

```php
// ---------------------------------------------------------------------------
// 5) facturaModel::reservarFacturaECF: flujo de control con una conexion falsa
// ---------------------------------------------------------------------------

/** Sentencia de GuionConexion: anota execute() y responde segun el guion. */
final class GuionSentencia
{
    public function __construct(private GuionConexion $c, private string $sql)
    {
    }

    public function execute(?array $params = null): bool
    {
        $this->c->llamadas[] = ['execute', $this->sql, $params ?? []];
        $error = $this->c->tomarError($this->sql);
        if ($error !== null) {
            throw $error;
        }
        return true;
    }

    public function fetchAll(int $modo = PDO::FETCH_BOTH): array
    {
        return $this->c->filasPara($this->sql);
    }

    public function fetchColumn(int $columna = 0): mixed
    {
        $filas = $this->c->filasPara($this->sql);
        return $filas === [] ? false : array_values($filas[0])[$columna];
    }

    public function rowCount(): int
    {
        return $this->c->rowCountPara($this->sql);
    }
}

/**
 * Conexion falsa con guion: filas, rowCount y errores por fragmento de SQL, y
 * su propio estado de transaccion, como PDO. Anota cada llamada. Nunca toca MySQL.
 */
final class GuionConexion
{
    public array $llamadas = [];
    public bool $enTransaccion = false;
    /** @var array<int, array{0:string, 1:Throwable}> errores por consumir: el primero cuyo fragmento calce */
    public array $errores = [];
    /** @var array<string, array> fragmento de SQL => filas que devuelve */
    public array $filas = [];
    /** @var array<string, int> fragmento de SQL => rowCount (por defecto 1) */
    public array $rowCounts = [];
    public bool $prepareFalla = false;

    public function beginTransaction(): bool
    {
        $this->llamadas[] = ['beginTransaction'];
        $this->enTransaccion = true;
        return true;
    }

    public function commit(): bool
    {
        $this->llamadas[] = ['commit'];
        $this->enTransaccion = false;
        return true;
    }

    public function rollBack(): bool
    {
        $this->llamadas[] = ['rollBack'];
        $this->enTransaccion = false;
        return true;
    }

    public function inTransaction(): bool
    {
        return $this->enTransaccion;
    }

    public function lastInsertId(?string $nombre = null): string
    {
        return '41';
    }

    public function prepare(string $sql): GuionSentencia
    {
        if ($this->prepareFalla) {
            throw new PDOException('se cayo la conexion');
        }
        $this->llamadas[] = ['prepare', $sql];
        return new GuionSentencia($this, $sql);
    }

    public function tomarError(string $sql): ?Throwable
    {
        foreach ($this->errores as $i => [$fragmento, $error]) {
            if (str_contains($sql, $fragmento)) {
                unset($this->errores[$i]);
                return $error;
            }
        }
        return null;
    }

    public function filasPara(string $sql): array
    {
        foreach ($this->filas as $fragmento => $filas) {
            if (str_contains($sql, $fragmento)) {
                return $filas;
            }
        }
        return [];
    }

    public function rowCountPara(string $sql): int
    {
        foreach ($this->rowCounts as $fragmento => $n) {
            if (str_contains($sql, $fragmento)) {
                return $n;
            }
        }
        return 1;
    }

    /** Llamadas de un tipo: 'prepare', 'execute', 'beginTransaction', 'commit', 'rollBack'. */
    public function de(string $tipo): array
    {
        return array_values(array_filter($this->llamadas, static fn(array $l): bool => $l[0] === $tipo));
    }

    /** SQL (espacios colapsados) del primer prepare que contiene $fragmento, o null. */
    public function sql(string $fragmento): ?string
    {
        foreach ($this->de('prepare') as $l) {
            if (str_contains($l[1], $fragmento)) {
                return (string) preg_replace('/\s+/', ' ', $l[1]);
            }
        }
        return null;
    }

    /** Parametros del ultimo execute cuyo SQL contiene $fragmento, o null. */
    public function params(string $fragmento): ?array
    {
        $params = null;
        foreach ($this->de('execute') as $l) {
            if (str_contains($l[1], $fragmento)) {
                $params = $l[2];
            }
        }
        return $params;
    }
}

/** PDOException como la arma pdo_mysql: errorInfo[1] es el codigo del driver. */
function puro_pdo_error(int $codigo, string $sqlstate, string $texto): PDOException
{
    $e = new PDOException("SQLSTATE[{$sqlstate}]: {$texto}");
    $e->errorInfo = [$sqlstate, $codigo, $texto];
    return $e;
}

/** Corre $fn con error_log() a un archivo temporal: [resultado, excepcion o null, texto del log]. */
function puro_con_log(callable $fn): array
{
    $archivo = (string) tempnam(sys_get_temp_dir(), 'wa_puro_log_');
    $previo = ini_set('error_log', $archivo);
    $resultado = null;
    $error = null;
    try {
        $resultado = $fn();
    } catch (Throwable $e) {
        $error = $e;
    } finally {
        ini_set('error_log', $previo === false ? '' : $previo);
    }
    $log = (string) file_get_contents($archivo);
    @unlink($archivo);
    return [$resultado, $error, $log];
}

/** facturaModel sin constructor (sin DB) con la conexion dada. */
function puro_modelo(object $conexion): facturaModel
{
    $ref = new ReflectionClass(facturaModel::class);
    $modelo = $ref->newInstanceWithoutConstructor();
    $ref->getProperty('conexion')->setValue($modelo, $conexion);
    return $modelo;
}

/** El ctx 'reservar' de ECFEmissionService (sus 13 claves), con $cambios encima. */
function puro_ctx_reservar(array $cambios = []): array
{
    return $cambios + [
        'tipo_ecf' => '31', 'e_ncf' => 'E310000000123', 'ambiente' => 'ecf', 'ambiente_secuencia' => 'ecf',
        'signed_xml' => '<ECF><Encabezado><eNCF>E310000000123</eNCF></Encabezado></ECF>', 'codigo_seguridad' => 'Ab12Cd',
        'fecha_emision_dgii' => '2026-10-05 14:03:00', 'flujo' => 'ECF', 'rfce_xml' => null,
        'dispensado' => true, 'rango_id' => 7, 'secuencia_valor' => 123, 'desde' => '2026-10-05 14:03:11',
    ];
}

/** El $facturaInput del controller (sin no_factura), con una linea. */
function puro_factura(array $cambios = []): array
{
    return $cambios + [
        'date' => '2026-10-05 14:03:00', 'client_id' => 5, 'client_name' => 'Cliente prueba', 'total' => 118.0,
        'tipo_pago' => 1, 'user_id' => 3, 'informacion_referencia' => null,
        'items' => [[
            'product_id' => 9, 'description' => 'Producto', 'amount' => 100.0, 'quantity' => 1.0, 'subtotal' => 100.0,
            'descuento_monto' => 0.0, 'indicador_facturacion' => 1, 'indicador_bien_servicio' => 1,
            'unidad_medida' => '43', 'itbis_amount' => 18.0,
        ]],
    ];
}

echo "\n== 5) facturaModel::reservarFacturaECF (conexion falsa) ==\n";
$reservar = static fn(GuionConexion $c, array $ctx = [], array $factura = []): array => puro_con_log(
    static fn() => puro_modelo($c)->reservarFacturaECF(puro_factura($factura), puro_ctx_reservar($ctx))
);

$c = new GuionConexion();
[, $e] = $reservar($c, ['ambiente' => '  ']);
wa_chk('ambiente vacio: InvalidArgumentException antes de cualquier consulta',
    $e instanceof InvalidArgumentException && $c->llamadas === [], [$e?->getMessage(), $c->llamadas]);

$c = new GuionConexion();
[$r, $e] = $reservar($c);
wa_chk('camino feliz: devuelve factura_id, e_ncf y desde',
    $e === null && $r === ['factura_id' => 41, 'e_ncf' => 'E310000000123', 'desde' => '2026-10-05 14:03:11'], $e?->getMessage() ?? $r);
$select = (string) $c->sql('estado_dgii FROM facturas');
wa_chk('el SELECT bloquea (FOR UPDATE) con el predicado de eNcfYaUsado',
    str_contains($select, 'FOR UPDATE') && str_contains($select, '(ambiente_dgii = :amb OR ambiente_dgii IS NULL)'), $select);
wa_chk('el SELECT usa el e-NCF y el ambiente del token',
    $c->params('FOR UPDATE') === [':e' => 'E310000000123', ':amb' => 'ecf'], $c->params('FOR UPDATE'));
$fila = $c->params('INSERT INTO facturas') ?? [];
wa_chk('fila: PENDIENTE_ENVIO, no_factura = e-NCF, track_id y secuencia_utilizada NULL',
    ($fila[':estado_dgii'] ?? null) === 'PENDIENTE_ENVIO' && ($fila[':no_factura'] ?? null) === 'E310000000123'
    && array_key_exists(':track_id', $fila) && $fila[':track_id'] === null
    && array_key_exists(':secuencia_utilizada', $fila) && $fila[':secuencia_utilizada'] === null, $fila);
wa_chk('fila: XML firmado, codigo_seguridad, fecha y ambiente del ctx; sin respuesta RFCE',
    ($fila[':xml_firmado'] ?? null) === '<ECF><Encabezado><eNCF>E310000000123</eNCF></Encabezado></ECF>'
    && ($fila[':codigo_seguridad'] ?? null) === 'Ab12Cd' && ($fila[':fecha_emision_dgii'] ?? null) === '2026-10-05 14:03:00'
    && ($fila[':ambiente_dgii'] ?? null) === 'ecf' && ($fila[':tipo_ecf'] ?? null) === '31'
    && $fila[':rfce_track_id'] === null && $fila[':rfce_estado'] === null && $fila[':rfce_respuesta'] === null, $fila);
$meta = json_decode((string) ($fila[':respuesta_dgii'] ?? ''), true);
wa_chk('respuesta_dgii: las 7 claves de 6.3, en orden, con los valores del ctx',
    $meta === ['fase' => 'PENDIENTE_ENVIO', 'desde' => '2026-10-05 14:03:11', 'flujo' => 'ECF', 'ambiente_secuencia' => 'ecf',
        'dispensado' => true, 'rango_id' => 7, 'secuencia_valor' => 123], $meta);
wa_chk('respuesta_dgii: sin XML', !str_contains((string) ($fila[':respuesta_dgii'] ?? ''), '<')
    && !str_contains((string) ($fila[':respuesta_dgii'] ?? ''), 'signed_xml'));
wa_chk('una transaccion, el item con el id nuevo, commit y nada abierto',
    count($c->de('beginTransaction')) === 1 && count($c->de('commit')) === 1 && $c->de('rollBack') === []
    && ($c->params('INSERT INTO factura_items')[':factura_id'] ?? null) === 41 && !$c->inTransaction(), $c->llamadas);

$c = new GuionConexion();
[, $e] = $reservar($c, ['tipo_ecf' => '34', 'e_ncf' => 'E340000000002'],
    ['informacion_referencia' => ['ncf_modificado' => 'E310000000020', 'fecha_ncf_modificado' => '05-10-2026', 'codigo_modificacion' => '3']]);
$fila = $c->params('INSERT INTO facturas') ?? [];
wa_chk('nota E34: los campos de normalizarNotaReferencia van a la fila',
    $e === null && ($fila[':ncf_modificado'] ?? null) === 'E310000000020' && ($fila[':fecha_ncf_modificado'] ?? null) === '2026-10-05'
    && ($fila[':codigo_modificacion'] ?? null) === '3' && ($fila[':razon_modificacion'] ?? null) === 'Nota de credito por ajuste de monto', $fila);

$c = new GuionConexion();
[, $e] = $reservar($c, ['tipo_ecf' => '32', 'e_ncf' => 'E320000000007', 'flujo' => 'RFCE', 'rfce_xml' => '<RFCE><eNCF>E320000000007</eNCF></RFCE>']);
$fila = $c->params('INSERT INTO facturas') ?? [];
wa_chk('RFCE: el XML del resumen y flujo RFCE quedan en la reserva',
    $e === null && ($fila[':rfce_xml'] ?? null) === '<RFCE><eNCF>E320000000007</eNCF></RFCE>'
    && (json_decode((string) $fila[':respuesta_dgii'], true)['flujo'] ?? null) === 'RFCE', $fila);

$c = new GuionConexion();
$c->filas['FOR UPDATE'] = [['id' => '9', 'estado_dgii' => 'ACEPTADO']];
[, $e] = $reservar($c);
wa_chk('fila previa ACEPTADO: EcfNumeroOcupadoException con la causa',
    $e instanceof EcfNumeroOcupadoException && str_contains($e->getMessage(), 'fila 9 en ACEPTADO'), $e?->getMessage());
wa_chk('fila previa ACEPTADO: sin UPDATE ni INSERT, rollBack y sin commit',
    $c->sql('UPDATE facturas') === null && $c->sql('INSERT INTO') === null
    && count($c->de('rollBack')) === 1 && $c->de('commit') === [] && !$c->inTransaction(), $c->llamadas);

$c = new GuionConexion();
$c->filas['FOR UPDATE'] = [['id' => '9', 'estado_dgii' => 'RECHAZADO']];
[$r, $e] = $reservar($c);
$archivo = (string) $c->sql('_ARCHIVADO');
wa_chk("fila previa RECHAZADO: se archiva con CONCAT(estado_dgii, '_ARCHIVADO') y compare-and-set",
    str_contains($archivo, "SET e_ncf = NULL, estado_dgii = CONCAT(estado_dgii, '_ARCHIVADO')")
    && str_contains($archivo, 'WHERE id = :id AND estado_dgii = :visto'), $archivo);
wa_chk('archivo: :visto es el estado leido', $c->params('_ARCHIVADO') === [':id' => 9, ':visto' => 'RECHAZADO'], $c->params('_ARCHIVADO'));
wa_chk('archivo y fila nueva en la misma transaccion',
    $e === null && ($r['factura_id'] ?? null) === 41 && count($c->de('beginTransaction')) === 1 && count($c->de('commit')) === 1, $c->llamadas);

$c = new GuionConexion();
$c->filas['FOR UPDATE'] = [['id' => '9', 'estado_dgii' => 'RFCE_NO_ENCONTRADO']];
$c->rowCounts['_ARCHIVADO'] = 0;
[, $e] = $reservar($c);
wa_chk('archivo sin coincidencia (rowCount 0): ocupado, sin INSERT ni commit',
    $e instanceof EcfNumeroOcupadoException && str_contains($e->getMessage(), 'archivo sin coincidencia')
    && $c->sql('INSERT INTO') === null && $c->de('commit') === [] && !$c->inTransaction(), $e?->getMessage());

$c = new GuionConexion();
$duplicado = puro_pdo_error(1062, '23000', "Duplicate entry 'E310000000123-ecf' for key 'uk_e_ncf_amb'");
$c->errores[] = ['INSERT INTO facturas', $duplicado];
[, $e] = $reservar($c);
wa_chk('1062 al insertar: ocupado, con el PDOException como previa',
    $e instanceof EcfNumeroOcupadoException && $e->getPrevious() === $duplicado
    && str_contains($e->getMessage(), 'clave duplicada (1062)'), $e?->getMessage());
wa_chk('1062: rollBack y sin commit', count($c->de('rollBack')) === 1 && $c->de('commit') === [] && !$c->inTransaction());

$c = new GuionConexion();
$c->errores[] = ['INSERT INTO facturas', puro_pdo_error(1213, '40001', 'Deadlock found when trying to get lock')];
[$r, $e, $log] = $reservar($c);
wa_chk('1213 una vez: reintenta (dos BEGIN) y reserva',
    $e === null && ($r['factura_id'] ?? null) === 41 && count($c->de('beginTransaction')) === 2 && count($c->de('commit')) === 1,
    $e?->getMessage() ?? $c->llamadas);
wa_chk('1213 una vez: una sola linea de reintento en el log',
    substr_count($log, '[ECF e-NCF=E310000000123] reservar: deadlock (1213), reintento') === 1, $log);

$c = new GuionConexion();
$c->errores[] = ['INSERT INTO facturas', puro_pdo_error(1213, '40001', 'Deadlock found when trying to get lock')];
$c->errores[] = ['INSERT INTO facturas', puro_pdo_error(1213, '40001', 'Deadlock found when trying to get lock')];
[, $e] = $reservar($c);
wa_chk('1213 dos veces: ocupado, sin tercer intento',
    $e instanceof EcfNumeroOcupadoException && str_contains($e->getMessage(), 'deadlock (1213) dos veces')
    && count($c->de('beginTransaction')) === 2 && $c->de('commit') === [], $e?->getMessage());

$c = new GuionConexion();
$sinProducto = puro_pdo_error(1452, '23000', 'Cannot add or update a child row: a foreign key constraint fails');
$c->errores[] = ['INSERT INTO factura_items', $sinProducto];
[, $e] = $reservar($c);
wa_chk('1452 (producto borrado): el mismo PDOException, no ocupado', $e === $sinProducto, $e === null ? null : get_class($e));
wa_chk('1452: rollBack, sin commit y nada abierto',
    count($c->de('rollBack')) === 1 && $c->de('commit') === [] && !$c->inTransaction(), $c->llamadas);

$c = new GuionConexion();
$c->errores[] = ['INSERT INTO facturas', new RuntimeException('se lleno el disco')];
[, $e] = $reservar($c);
wa_chk('otra excepcion dentro de la transaccion: rollBack y se relanza la misma',
    $e instanceof RuntimeException && !($e instanceof EcfNumeroOcupadoException) && $e->getMessage() === 'se lleno el disco'
    && count($c->de('rollBack')) === 1 && $c->de('commit') === [] && !$c->inTransaction(), $e?->getMessage());

$c = new GuionConexion();
[, $e, $log] = $reservar($c, ['ambiente_secuencia' => 'certecf']);
wa_chk('ambiente del token distinto del de la secuencia: una linea de log y reserva igual',
    $e === null && substr_count($log, 'distinto del de la secuencia certecf') === 1, $log);

```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php | tail -3; echo "exit=${PIPESTATUS[0]}"`

Expected: `exit=1` (`PIPESTATUS[0]` is the test's status; `$?` would be `tail`'s). `puro_con_log` catches the `Error`, so the run does not stop. Every check of section 5 fails
except `respuesta_dgii: sin XML`, which holds vacuously. Their `obtenido:` lines name
`Call to undefined method facturaModel::reservarFacturaECF()` or show empty values. The output ends with:

```
57 de 82 pruebas OK
exit=1
```

- [ ] **Step 3: Write the scratch-DB test**

Create `tools/test_reservar_confirmar.php`:

```php
<?php
/**
 * test_reservar_confirmar.php — El modelo del write-ahead del e-CF (la reserva,
 * la confirmacion y la marca de envio incierto de facturaModel) contra una base
 * MySQL de prueba (spec del write-ahead, 12.3.4). Nunca produccion:
 * wa_usar_base() se niega a usar una base sin la tabla marca
 * zz_write_ahead_scratch.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php \
 *       --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate
 *   (un -d extension=... solo para lo que tu php.ini no carga; ver write_ahead_test_lib.php)
 *
 * --copia-db es la copia sin 027/028 que deja tools/test_write_ahead_gate.php.
 *
 * Modo hijo (lo lanza esta misma prueba; no se corre a mano). Imprime una
 * linea JSON {"resultado": "ok"|"ocupado"|"error", ...}:
 *   --hijo=reservar --tenant-db=<base> --encf=<e-NCF> --cliente=<id> --producto=<id> --listo=<archivo> --barrera=<archivo>
 *   --hijo=bloquear --tenant-db=<base> --encf=<e-NCF> --listo=<archivo> --barrera=<archivo>
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/../src/Models/facturaModel.php';

const RC_AMBIENTE = 'certecf';

/** $facturaInput del controller (sin no_factura), con una linea por producto. */
function rc_factura(int $clientId, array $productos): array
{
    $items = [];
    foreach ($productos as $productId) {
        $items[] = [
            'product_id' => $productId, 'description' => 'WA producto', 'amount' => 100.0, 'quantity' => 1.0,
            'subtotal' => 100.0, 'descuento_monto' => 0.0, 'indicador_facturacion' => 1,
            'indicador_bien_servicio' => 1, 'unidad_medida' => '43', 'itbis_amount' => 18.0,
        ];
    }
    return [
        'date' => date('Y-m-d H:i:s'), 'client_id' => $clientId, 'client_name' => 'WA cliente',
        'total' => 118.0 * count($items), 'tipo_pago' => 1, 'user_id' => null,
        'informacion_referencia' => null, 'items' => $items,
    ];
}

/** El ctx 'reservar' de ECFEmissionService (sus 13 claves) para $eNcf, con $cambios encima. */
function rc_ctx(string $eNcf, array $cambios = []): array
{
    return $cambios + [
        'tipo_ecf' => substr($eNcf, 1, 2), 'e_ncf' => $eNcf, 'ambiente' => RC_AMBIENTE, 'ambiente_secuencia' => RC_AMBIENTE,
        'signed_xml' => '<ECF><Encabezado><IdDoc><eNCF>' . $eNcf . '</eNCF></IdDoc></Encabezado></ECF>',
        'codigo_seguridad' => 'WaPr01', 'fecha_emision_dgii' => date('Y-m-d H:i:s'), 'flujo' => 'ECF',
        'rfce_xml' => null, 'dispensado' => true, 'rango_id' => 7, 'secuencia_valor' => (int) substr($eNcf, 3),
        'desde' => date('Y-m-d H:i:s'),
    ];
}

/** Una fila que ya tiene el numero (otra emision, otro ambiente...): devuelve su id. */
function rc_fila_previa(PDO $pdo, string $eNcf, string $estado, string $ambiente = RC_AMBIENTE): int
{
    $st = $pdo->prepare(
        "INSERT INTO facturas (no_factura, client_name, total, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii)
         VALUES (:nf, 'WA previa', 0, :tipo, :e, :estado, :amb)"
    );
    $st->execute([':nf' => $eNcf, ':tipo' => substr($eNcf, 1, 2), ':e' => $eNcf, ':estado' => $estado, ':amb' => $ambiente]);
    return (int) $pdo->lastInsertId();
}

/** Corre $fn con error_log() a un archivo temporal: [resultado, excepcion o null, texto del log]. */
function rc_con_log(callable $fn): array
{
    $archivo = (string) tempnam(sys_get_temp_dir(), 'wa_rc_log_');
    $previo = ini_set('error_log', $archivo);
    $resultado = null;
    $error = null;
    try {
        $resultado = $fn();
    } catch (Throwable $e) {
        $error = $e;
    } finally {
        ini_set('error_log', $previo === false ? '' : $previo);
    }
    $log = (string) file_get_contents($archivo);
    @unlink($archivo);
    return [$resultado, $error, $log];
}

/** Ruta temporal unica que todavia no existe (barreras y salidas de los hijos). */
function rc_tmp(string $nombre): string
{
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_rc_' . getmypid() . '_' . $nombre . '_' . bin2hex(random_bytes(4));
}

/** Espera a que exista $archivo (hasta $segundos). */
function rc_esperar(string $archivo, float $segundos = 15.0): bool
{
    $limite = microtime(true) + $segundos;
    while (!is_file($archivo)) {
        if (microtime(true) > $limite) {
            return false;
        }
        usleep(2000);
    }
    return true;
}

/** Lanza este mismo script en modo hijo; la salida va a un archivo temporal. @return array{0:resource,1:string} */
function rc_hijo(array $args): array
{
    $salida = rc_tmp('salida');
    $proc = proc_open(
        array_merge([PHP_BINARY], wa_php_flags(), [__FILE__], $args),
        [0 => ['pipe', 'r'], 1 => ['file', $salida, 'w'], 2 => ['file', $salida . '.err', 'w']],
        $pipes,
        dirname(__DIR__)
    );
    if (!is_resource($proc)) {
        throw new RuntimeException('no se pudo lanzar el hijo ' . implode(' ', $args));
    }
    fclose($pipes[0]);
    return [$proc, $salida];
}

/** Espera al hijo y devuelve su linea JSON (o lo que imprimio, si no es JSON). */
function rc_cerrar(array $hijo): array
{
    [$proc, $salida] = $hijo;
    proc_close($proc);
    $texto = trim((string) @file_get_contents($salida));
    $err = trim((string) @file_get_contents($salida . '.err'));
    @unlink($salida);
    @unlink($salida . '.err');
    $lineas = $texto === '' ? [''] : explode("\n", $texto);
    $json = json_decode((string) end($lineas), true);
    return is_array($json) ? $json : ['resultado' => 'sin_json', 'salida' => $texto, 'stderr' => $err];
}

// ---------------------------------------------------------------------------
// Modo hijo: dos reservas a la vez (barrera) y el lado pesado del deadlock.
// ---------------------------------------------------------------------------
$hijo = wa_arg('hijo');
if ($hijo !== null) {
    try {
        $pdoHijo = wa_usar_base((string) wa_arg('tenant-db'));
        $eNcf = (string) wa_arg('encf');
        if ($hijo === 'reservar') {
            $modelo = new facturaModel();
            $facturaHijo = rc_factura((int) wa_arg('cliente'), [(int) wa_arg('producto')]);
            touch((string) wa_arg('listo'));
            if (!rc_esperar((string) wa_arg('barrera'))) {
                throw new RuntimeException('la barrera no se abrio');
            }
            $r = $modelo->reservarFacturaECF($facturaHijo, rc_ctx($eNcf));
            echo json_encode(['resultado' => 'ok', 'factura_id' => $r['factura_id']]), "\n";
        } elseif ($hijo === 'bloquear') {
            // Toma el mismo gap lock que la reserva (SELECT ... FOR UPDATE de un
            // e-NCF que no existe), se hace pesada (20 filas escritas, para que
            // InnoDB elija al padre como victima) y, cuando el padre ya espera
            // en su INSERT, inserta el mismo e-NCF: deadlock cruzado.
            $pdoHijo->exec('SET SESSION innodb_lock_wait_timeout = 5');
            $pdoHijo->beginTransaction();
            $sel = $pdoHijo->prepare(
                'SELECT id FROM facturas WHERE e_ncf = :e AND (ambiente_dgii = :amb OR ambiente_dgii IS NULL) FOR UPDATE'
            );
            $sel->execute([':e' => $eNcf, ':amb' => RC_AMBIENTE]);
            $peso = $pdoHijo->prepare(
                "INSERT INTO audit_logs (module, action, description) VALUES ('wa_prueba', 'BLOQUEO', 'peso del deadlock')"
            );
            for ($i = 0; $i < 20; $i++) {
                $peso->execute();
            }
            touch((string) wa_arg('listo'));
            if (!rc_esperar((string) wa_arg('barrera'))) {
                throw new RuntimeException('la barrera no se abrio');
            }
            usleep(300000); // el padre ya esta esperando en su INSERT
            rc_fila_previa($pdoHijo, $eNcf, 'ACEPTADO');
            $pdoHijo->commit();
            echo json_encode(['resultado' => 'ok']), "\n";
        } else {
            throw new InvalidArgumentException('modo hijo desconocido: ' . $hijo);
        }
    } catch (EcfNumeroOcupadoException $e) {
        echo json_encode(['resultado' => 'ocupado', 'mensaje' => $e->getMessage()]), "\n";
    } catch (Throwable $e) {
        echo json_encode(['resultado' => 'error', 'clase' => get_class($e), 'mensaje' => $e->getMessage()]), "\n";
    }
    exit(0);
}

// ---------------------------------------------------------------------------
// Padre
// ---------------------------------------------------------------------------
$base = wa_arg('tenant-db');
$copia = wa_arg('copia-db');
if ($base === null || $copia === null) {
    fwrite(STDERR, "Uso: php <flags> tools/test_reservar_confirmar.php --tenant-db=<base> --copia-db=<base sin 027/028>\n");
    exit(1);
}
$pdo = wa_usar_base($base);
$sem = wa_sembrar($pdo);
$factura = rc_factura($sem['client_id'], [$sem['product_id']]);

echo "\n== reservarFacturaECF en {$base} ==\n";

// 1) Camino feliz, flujo RFCE (E32 < 250k): fila completa antes de enviar.
wa_limpiar($pdo);
$eNcf = 'E320000000101';
[$r, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF(
    rc_factura($sem['client_id'], [$sem['product_id'], $sem['product_id']]),
    rc_ctx($eNcf, ['flujo' => 'RFCE', 'rfce_xml' => '<RFCE><eNCF>' . $eNcf . '</eNCF></RFCE>'])
));
$filas = wa_filas($pdo, $eNcf);
$fila = $filas[0] ?? [];
wa_chk('feliz: devuelve el id de la unica fila con ese e-NCF',
    $e === null && count($filas) === 1 && ($r['factura_id'] ?? null) === (int) ($fila['id'] ?? 0) && ($r['e_ncf'] ?? null) === $eNcf,
    $e !== null ? get_class($e) . ': ' . $e->getMessage() : [$r, $filas]);
wa_chk('feliz: PENDIENTE_ENVIO, no_factura = e_ncf, XML y RFCE guardados, sin track_id ni secuencia_utilizada',
    ($fila['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO' && ($fila['no_factura'] ?? null) === $eNcf
    && (int) ($fila['tiene_xml'] ?? 0) === 1 && (int) ($fila['tiene_rfce'] ?? 0) === 1
    && array_key_exists('track_id', $fila) && $fila['track_id'] === null
    && array_key_exists('secuencia_utilizada', $fila) && $fila['secuencia_utilizada'] === null
    && ($fila['ambiente_dgii'] ?? null) === RC_AMBIENTE, $fila);
$extra = $pdo->query('SELECT codigo_seguridad, (SELECT COUNT(*) FROM factura_items WHERE factura_id = f.id) AS lineas
                      FROM facturas f WHERE id = ' . (int) ($fila['id'] ?? 0))->fetch(PDO::FETCH_ASSOC) ?: [];
$meta = facturaModel::metaEnvio($fila['respuesta_dgii'] ?? null);
wa_chk('feliz: codigo_seguridad, las 2 lineas y la meta 6.3 con flujo RFCE',
    ($extra['codigo_seguridad'] ?? null) === 'WaPr01' && (int) ($extra['lineas'] ?? 0) === 2
    && ($meta['fase'] ?? null) === 'PENDIENTE_ENVIO' && ($meta['flujo'] ?? null) === 'RFCE' && ($meta['rango_id'] ?? null) === 7,
    [$extra, $meta]);
wa_chk('feliz: sin transaccion abierta', !$pdo->inTransaction());

// 2) Fila previa ACEPTADO, mismo numero y ambiente: ocupado, nada cambia.
wa_limpiar($pdo);
$eNcf = 'E310000000201';
rc_fila_previa($pdo, $eNcf, 'ACEPTADO');
$antes = wa_filas($pdo, $eNcf);
[, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF($factura, rc_ctx($eNcf)));
wa_chk('previa ACEPTADO: EcfNumeroOcupadoException', $e instanceof EcfNumeroOcupadoException,
    $e === null ? null : get_class($e) . ': ' . $e->getMessage());
wa_chk('previa ACEPTADO: la fila previa intacta y ninguna nueva', wa_filas($pdo, $eNcf) === $antes, wa_filas($pdo, $eNcf));

// 3) Fila previa RECHAZADO: se archiva y la nueva entra en la misma transaccion.
wa_limpiar($pdo);
$eNcf = 'E310000000301';
$previa = rc_fila_previa($pdo, $eNcf, 'RECHAZADO');
[$r, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF($factura, rc_ctx($eNcf)));
$filas = wa_filas($pdo, $eNcf);
wa_chk('previa RECHAZADO: archivada (RECHAZADO_ARCHIVADO, e_ncf NULL, no_factura igual)',
    $e === null && count($filas) === 2 && (int) $filas[0]['id'] === $previa && $filas[0]['estado_dgii'] === 'RECHAZADO_ARCHIVADO'
    && $filas[0]['e_ncf'] === null && $filas[0]['no_factura'] === $eNcf, $e !== null ? $e->getMessage() : $filas);
wa_chk('previa RECHAZADO: la nueva en PENDIENTE_ENVIO con el e-NCF',
    ($filas[1]['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO' && ($filas[1]['e_ncf'] ?? null) === $eNcf
    && (int) ($filas[1]['id'] ?? 0) === ($r['factura_id'] ?? null), $filas);

// 4) El mismo numero en otro ambiente no ocupa este (uk_e_ncf_amb, migracion 027).
wa_limpiar($pdo);
$eNcf = 'E310000000401';
$otra = rc_fila_previa($pdo, $eNcf, 'ACEPTADO', 'ecf');
[, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF($factura, rc_ctx($eNcf)));
$filas = wa_filas($pdo, $eNcf);
wa_chk('mismo numero en ecf: la reserva en certecf entra', $e === null && count($filas) === 2,
    $e !== null ? get_class($e) . ': ' . $e->getMessage() : $filas);
wa_chk('mismo numero en ecf: esa fila queda ACEPTADO en ecf',
    (int) ($filas[0]['id'] ?? 0) === $otra && ($filas[0]['estado_dgii'] ?? null) === 'ACEPTADO'
    && ($filas[0]['ambiente_dgii'] ?? null) === 'ecf', $filas);

// 5) Producto que no existe (FK 1452): se relanza, no es "ocupado", no queda nada.
wa_limpiar($pdo);
$eNcf = 'E310000000501';
[, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF(rc_factura($sem['client_id'], [999999]), rc_ctx($eNcf)));
wa_chk('producto 999999: PDOException 1452, no EcfNumeroOcupadoException',
    $e instanceof PDOException && (int) ($e->errorInfo[1] ?? 0) === 1452,
    $e === null ? null : get_class($e) . ': ' . $e->getMessage());
wa_chk('producto 999999: ninguna fila con ese e-NCF y nada abierto', wa_filas($pdo, $eNcf) === [] && !$pdo->inTransaction(),
    wa_filas($pdo, $eNcf));

// 6) Dos procesos reservan el mismo numero a la vez (barrera).
wa_limpiar($pdo);
$eNcf = 'E319999990006';
$barrera = rc_tmp('barrera');
$hijos = [];
foreach (['a', 'b'] as $n) {
    $listo = rc_tmp('listo_' . $n);
    $hijos[$n] = [rc_hijo(['--hijo=reservar', '--tenant-db=' . $base, '--encf=' . $eNcf, '--cliente=' . $sem['client_id'],
        '--producto=' . $sem['product_id'], '--listo=' . $listo, '--barrera=' . $barrera]), $listo];
}
foreach ($hijos as [, $listo]) {
    rc_esperar($listo);
    @unlink($listo);
}
touch($barrera);
$resultados = [];
foreach ($hijos as $n => [$h]) {
    $resultados[$n] = rc_cerrar($h);
}
@unlink($barrera);
$tipos = array_column($resultados, 'resultado');
sort($tipos);
wa_chk('dos procesos, mismo numero: uno reserva y el otro queda ocupado', $tipos === ['ocupado', 'ok'], $resultados);
wa_chk('dos procesos: una sola fila con ese e-NCF', count(wa_filas($pdo, $eNcf)) === 1, wa_filas($pdo, $eNcf));

// 7) Deadlock cruzado: el padre es la victima, reintenta una vez y queda ocupado.
wa_limpiar($pdo);
$eNcf = 'E319999990007';
$barrera = rc_tmp('barrera');
$listo = rc_tmp('listo');
$bloqueador = rc_hijo(['--hijo=bloquear', '--tenant-db=' . $base, '--encf=' . $eNcf, '--listo=' . $listo, '--barrera=' . $barrera]);
rc_esperar($listo);
@unlink($listo);
$pdo->exec('SET SESSION innodb_lock_wait_timeout = 1');
touch($barrera);
[$r, $e, $log] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF($factura, rc_ctx($eNcf)));
$pdo->exec('SET SESSION innodb_lock_wait_timeout = 50');
$resBloqueo = rc_cerrar($bloqueador);
@unlink($barrera);
wa_chk('deadlock: el proceso que bloquea termina bien', ($resBloqueo['resultado'] ?? null) === 'ok', $resBloqueo);
wa_chk('deadlock: una sola linea de reintento en el log',
    substr_count($log, '[ECF e-NCF=' . $eNcf . '] reservar: deadlock (1213), reintento') === 1, $log);
wa_chk('deadlock: el reintento termina en EcfNumeroOcupadoException (no 1205 ni 1213 crudo)',
    $e instanceof EcfNumeroOcupadoException, $e === null ? $r : get_class($e) . ': ' . $e->getMessage()
    . ' (si es 1205, revisa que innodb_deadlock_detect este ON en la base de prueba)');
$filas = wa_filas($pdo, $eNcf);
wa_chk('deadlock: solo queda la fila del otro proceso y nada abierto',
    count($filas) === 1 && ($filas[0]['estado_dgii'] ?? null) === 'ACEPTADO' && !$pdo->inTransaction(), $filas);

// 8) Sin la 028 (copia con VARCHAR(20)), modo estricto: archivar NO_ENCONTRADO
//    no cabe (NO_ENCONTRADO_ARCHIVADO = 23). Falla antes de enviar (spec 6.2).
$pdoCopia = wa_usar_base($copia);
wa_limpiar($pdoCopia);
$semCopia = wa_sembrar($pdoCopia);
$eNcf = 'E310000000801';
$previa = rc_fila_previa($pdoCopia, $eNcf, 'NO_ENCONTRADO');
$pdoCopia->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES'");
[, $e] = rc_con_log(fn() => (new facturaModel())->reservarFacturaECF(
    rc_factura($semCopia['client_id'], [$semCopia['product_id']]), rc_ctx($eNcf)
));
$filas = wa_filas($pdoCopia, $eNcf);
wa_chk('copia sin 028: PDOException 1406 (SQLSTATE 22001), no ocupado',
    $e instanceof PDOException && (int) ($e->errorInfo[1] ?? 0) === 1406 && ($e->errorInfo[0] ?? '') === '22001',
    $e === null ? null : get_class($e) . ': ' . $e->getMessage());
wa_chk('copia sin 028: ninguna fila nueva y la previa sigue NO_ENCONTRADO con su e-NCF',
    count($filas) === 1 && (int) $filas[0]['id'] === $previa && $filas[0]['estado_dgii'] === 'NO_ENCONTRADO'
    && $filas[0]['e_ncf'] === $eNcf && !$pdoCopia->inTransaction(), $filas);
wa_limpiar($pdoCopia);

// De vuelta a la base de prueba para los casos que siguen.
$pdo = wa_usar_base($base);
$sem = wa_sembrar($pdo);
$factura = rc_factura($sem['client_id'], [$sem['product_id']]);

// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega sus casos justo encima de este bloque.
// ---------------------------------------------------------------------------
wa_limpiar($pdo);
wa_fin();
```

- [ ] **Step 4: Run it and watch it fail**

Run: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`

Expected: exit code 1. The failing checks print `obtenido: "Error: Call to undefined method facturaModel::reservarFacturaECF()"`.
The children print `{"resultado":"error",…}` lines, which show up as the `obtenido` of the "dos procesos" check. Only
the checks that hold when nothing is written pass, and the run ends with:

```
7 de 20 pruebas OK
```

- [ ] **Step 5: Require the exception in the model**

In `src/Models/facturaModel.php`, after `:6`, `require_once(__DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php');`,
insert:

```php
require_once(__DIR__ . '/../Utils/FacturacionElectronica/EcfNumeroOcupadoException.php');
```

- [ ] **Step 6: Write the reserve**

Directly above the docblock of `saveFacturaConECF` (`:1187` now, after the require of Step 5), insert this block. It
ends with one blank line.

```php
    /**
     * Write-ahead (spec 4.6): guarda la fila del e-CF ANTES de enviarlo a la
     * DGII, en PENDIENTE_ENVIO, con el XML firmado (y el RFCE), el
     * codigo_seguridad y los items. Es una sola transaccion y se confirma aqui
     * mismo: al volver, la fila ya ocupa el numero y no queda ninguna
     * transaccion abierta durante el envio.
     *
     * Otra fila del mismo ambiente (o sin ambiente) con el mismo e-NCF:
     *   - reintentable (EstadosEcf::REINTENTABLES): se archiva
     *     (<estado>_ARCHIVADO, e_ncf NULL) y se inserta la nueva;
     *   - cualquier otro estado: EcfNumeroOcupadoException, sin tocar nada.
     *
     * SELECT ... FOR UPDATE sobre un e-NCF que no existe toma gap locks que dos
     * sesiones pueden tener a la vez (REPEATABLE READ): el arbitro es la clave
     * unica uk_e_ncf_amb al insertar. 1062 es "ocupado"; 1213 (deadlock: InnoDB
     * ya deshizo la transaccion) se reintenta una vez y la segunda es "ocupado".
     * Cualquier otro PDOException (1048, 1452 de un producto borrado, 1205,
     * 1406 sin la migracion 028, la DB caida) se relanza: no queda fila, y la
     * emision devuelve el numero a la secuencia.
     *
     * @param array $factura {date, client_id, client_name, total, tipo_pago, user_id, informacion_referencia, items[]}
     *                       ($facturaInput del controller; sin 'no_factura', que toma el e-NCF)
     * @param array $ctx     ctx 'reservar' de ECFEmissionService::emitir: tipo_ecf, e_ncf, ambiente,
     *                       ambiente_secuencia, signed_xml, codigo_seguridad, fecha_emision_dgii, flujo,
     *                       rfce_xml, dispensado, rango_id, secuencia_valor, desde
     * @return array{factura_id:int, e_ncf:string, desde:string}
     * @throws EcfNumeroOcupadoException|PDOException|InvalidArgumentException
     */
    public function reservarFacturaECF(array $factura, array $ctx): array
    {
        // Con ambiente NULL la clave (e_ncf, ambiente_dgii) no protege la fila:
        // un indice unico deja repetir NULL.
        if (trim((string) ($ctx['ambiente'] ?? '')) === '') {
            throw new InvalidArgumentException('reservarFacturaECF: ambiente vacio; uk_e_ncf_amb no protegeria la fila');
        }
        $eNcf = (string) ($ctx['e_ncf'] ?? '');
        $ambiente = trim((string) $ctx['ambiente']);
        $ambienteSecuencia = (string) ($ctx['ambiente_secuencia'] ?? '');
        if ($ambiente !== $ambienteSecuencia) {
            // Riesgo 6 del spec: el numero salio de la secuencia de un ambiente
            // y la fila queda en el ambiente del token. Se avisa y se sigue.
            error_log(sprintf('[ECF e-NCF=%s] reservar: ambiente del token %s distinto del de la secuencia %s',
                $eNcf, $ambiente, $ambienteSecuencia));
        }
        $nota = self::normalizarNotaReferencia($factura, (string) ($ctx['tipo_ecf'] ?? ''));

        for ($intento = 1; ; $intento++) {
            try {
                $this->conexion->beginTransaction();

                $previas = $this->conexion->prepare(
                    'SELECT id, estado_dgii FROM facturas
                     WHERE e_ncf = :e AND (ambiente_dgii = :amb OR ambiente_dgii IS NULL) FOR UPDATE'
                );
                $previas->execute([':e' => $eNcf, ':amb' => $ambiente]);
                foreach ($previas->fetchAll(PDO::FETCH_ASSOC) as $previa) {
                    $estadoPrevio = (string) ($previa['estado_dgii'] ?? '');
                    if (!in_array($estadoPrevio, EstadosEcf::REINTENTABLES, true)) {
                        $this->deshacer();
                        throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'fila ' . (int) $previa['id'] . ' en ' . $estadoPrevio);
                    }
                    // Intento anterior que la DGII no uso: se archiva para guardar
                    // la historia, y e_ncf NULL libera la clave unica. El estado
                    // leido va en el WHERE (compare-and-set) aunque el FOR UPDATE
                    // ya lo proteja.
                    $archivo = $this->conexion->prepare(
                        "UPDATE facturas SET e_ncf = NULL, estado_dgii = CONCAT(estado_dgii, '_ARCHIVADO') WHERE id = :id AND estado_dgii = :visto"
                    );
                    $archivo->execute([':id' => (int) $previa['id'], ':visto' => $estadoPrevio]);
                    if ($archivo->rowCount() === 0) {
                        $this->deshacer();
                        throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'archivo sin coincidencia');
                    }
                }

                $stmt = $this->conexion->prepare('INSERT INTO facturas
                    (no_factura, date, client_id, client_name, total, tipo_pago, NCF, user_id,
                     tipo_ecf, e_ncf, track_id, estado_dgii, codigo_seguridad,
                     fecha_emision_dgii, ambiente_dgii, xml_firmado, respuesta_dgii,
                     rfce_xml, rfce_track_id, rfce_estado, rfce_respuesta, secuencia_utilizada,
                     ncf_modificado, fecha_ncf_modificado, codigo_modificacion, razon_modificacion)
                    VALUES
                    (:no_factura, :date, :client_id, :client_name, :total, :tipo_pago, NULL, :user_id,
                     :tipo_ecf, :e_ncf, :track_id, :estado_dgii, :codigo_seguridad,
                     :fecha_emision_dgii, :ambiente_dgii, :xml_firmado, :respuesta_dgii,
                     :rfce_xml, :rfce_track_id, :rfce_estado, :rfce_respuesta, :secuencia_utilizada,
                     :ncf_modificado, :fecha_ncf_modificado, :codigo_modificacion, :razon_modificacion)');
                $stmt->execute([
                    ':no_factura' => $eNcf,
                    ':date' => $factura['date'],
                    ':client_id' => $factura['client_id'],
                    ':client_name' => $factura['client_name'],
                    ':total' => $factura['total'],
                    ':tipo_pago' => (int) ($factura['tipo_pago'] ?? 1),
                    ':user_id' => $factura['user_id'] ?? null,
                    ':tipo_ecf' => (string) ($ctx['tipo_ecf'] ?? ''),
                    ':e_ncf' => $eNcf,
                    ':track_id' => null,
                    ':estado_dgii' => EstadosEcf::PENDIENTE_ENVIO,
                    ':codigo_seguridad' => $ctx['codigo_seguridad'] ?? null,
                    ':fecha_emision_dgii' => $ctx['fecha_emision_dgii'] ?? null,
                    ':ambiente_dgii' => $ambiente,
                    ':xml_firmado' => $ctx['signed_xml'] ?? null,
                    // Solo la meta del envio (spec 6.3), nunca XML.
                    ':respuesta_dgii' => self::json(['fase' => EstadosEcf::PENDIENTE_ENVIO] + self::metaEnVuelo($ctx)),
                    ':rfce_xml' => $ctx['rfce_xml'] ?? null,
                    ':rfce_track_id' => null,
                    ':rfce_estado' => null,
                    ':rfce_respuesta' => null,
                    ':secuencia_utilizada' => null,
                    ':ncf_modificado' => $nota['ncf_modificado'],
                    ':fecha_ncf_modificado' => $nota['fecha_ncf_modificado'],
                    ':codigo_modificacion' => $nota['codigo_modificacion'],
                    ':razon_modificacion' => $nota['razon_modificacion'],
                ]);
                $facturaId = (int) $this->conexion->lastInsertId();

                $itemSql = 'INSERT INTO factura_items
                    (factura_id, product_id, description, amount, quantity, subtotal, descuento_monto,
                     indicador_facturacion, indicador_bien_servicio, unidad_medida, itbis_amount)
                    VALUES
                    (:factura_id, :product_id, :description, :amount, :quantity, :subtotal, :descuento_monto,
                     :indicador_facturacion, :indicador_bien_servicio, :unidad_medida, :itbis_amount)';
                $itemStmt = $this->conexion->prepare($itemSql);
                foreach ($factura['items'] as $item) {
                    // Precio a 4 y cantidad a 3, lo que guardan amount DECIMAL(18,4) y
                    // quantity DECIMAL(12,3). La emision ya los manda normalizados
                    // (EcfItemMapper::normalizarCantidadPrecio: 4 y 2, lo del XML);
                    // esto solo deja explicito lo que queda en la base.
                    $amount = round((float) ($item['amount'] ?? 0), 4);
                    $quantity = round((float) ($item['quantity'] ?? 1), 3);
                    $subtotal = isset($item['subtotal']) ? (float) $item['subtotal'] : round($amount * $quantity, 2);
                    $itemStmt->execute([
                        ':factura_id' => $facturaId,
                        ':product_id' => $item['product_id'] ?? null,
                        ':description' => $item['description'] ?? '',
                        ':amount' => $amount,
                        ':quantity' => $quantity,
                        ':subtotal' => $subtotal,
                        ':descuento_monto' => (float) ($item['descuento_monto'] ?? 0),
                        ':indicador_facturacion' => (int) ($item['indicador_facturacion'] ?? 1),
                        ':indicador_bien_servicio' => (int) ($item['indicador_bien_servicio'] ?? 2),
                        ':unidad_medida' => (string) ($item['unidad_medida'] ?? '43'),
                        ':itbis_amount' => (float) ($item['itbis_amount'] ?? 0),
                    ]);
                }

                $this->conexion->commit();
                return ['factura_id' => $facturaId, 'e_ncf' => $eNcf, 'desde' => (string) ($ctx['desde'] ?? '')];
            } catch (PDOException $e) {
                $this->deshacer();
                // Codigo del driver, no el SQLSTATE: 23000 tambien cubre 1048 y 1452.
                $codigo = (int) ($e->errorInfo[1] ?? 0);
                if ($codigo === 1062) {
                    throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'clave duplicada (1062)', $e);
                }
                if ($codigo === 1213 && $intento === 1) {
                    error_log(sprintf('[ECF e-NCF=%s] reservar: deadlock (1213), reintento', $eNcf));
                    continue;
                }
                if ($codigo === 1213) {
                    throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'deadlock (1213) dos veces', $e);
                }
                throw $e;
            } catch (Throwable $e) {
                $this->deshacer();
                throw $e;
            }
        }
    }

    /** Meta del envio para respuesta_dgii (spec 6.3), sin XML. La lee metaEnvio(). */
    private static function metaEnVuelo(array $ctx): array
    {
        return [
            'desde' => $ctx['desde'] ?? null,
            'flujo' => $ctx['flujo'] ?? null,
            'ambiente_secuencia' => $ctx['ambiente_secuencia'] ?? null,
            'dispensado' => $ctx['dispensado'] ?? null,
            'rango_id' => $ctx['rango_id'] ?? null,
            'secuencia_valor' => $ctx['secuencia_valor'] ?? null,
        ];
    }

    /** JSON para respuesta_dgii / rfce_respuesta: null queda null; UTF-8 invalido se sustituye en vez de fallar. */
    private static function json(mixed $valor): ?string
    {
        if ($valor === null) {
            return null;
        }
        $json = json_encode($valor, JSON_INVALID_UTF8_SUBSTITUTE);
        return $json === false ? null : $json;
    }

    /** rollBack si hay transaccion abierta; un fallo del rollBack no tapa el error original. */
    private function deshacer(): void
    {
        try {
            if ($this->conexion->inTransaction()) {
                $this->conexion->rollBack();
            }
        } catch (Throwable $e) {
            error_log('[ECF] reservarFacturaECF: rollBack fallo: ' . $e->getMessage());
        }
    }

```

A few notes on this block:
- The archive UPDATE keeps the literal `CONCAT(estado_dgii, '_ARCHIVADO')`, which `check_estado_dgii_ancho.php:73`
  looks for. It now appears in the model twice; the copy inside `saveFacturaConECF` goes away in Task 17.
- The items INSERT is the one at `:1251-1279` of `9f669ad`, copied verbatim.
- When a 1213 retry happens, InnoDB has already rolled the transaction back. `deshacer()` still calls `rollBack()` to
  clear PDO's own flag.

- [ ] **Step 7: Run the DB-free tests and lint**

Run: `php -l src/Models/facturaModel.php && php tools/test_write_ahead_puro.php | tail -1 && php tools/test_notas_vinculadas.php | tail -1 && php tools/check_estado_dgii_ancho.php | tail -1`

Expected:

```
No syntax errors detected in src/Models/facturaModel.php
82 de 82 pruebas OK
62 de 62 pruebas OK
32/32 OK
```

Section 5 prints its 26 checks, all `[OK  ]`.

- [ ] **Step 8: Run the scratch-DB test**

Run: `php -l tools/test_reservar_confirmar.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`

Expected: 20 `[OK  ]` lines under `== reservarFacturaECF en wa_scratch ==`, ending with:

```
20 de 20 pruebas OK
```

Exit code 0, in about 2 s: the deadlock case waits about 300 ms.

If `deadlock: el reintento termina en EcfNumeroOcupadoException` fails with a 1205 instead, the scratch server has
`innodb_deadlock_detect = OFF`. Turn it on for the scratch server only, and never touch production.

- [ ] **Step 9: Commit**

```bash
git add src/Models/facturaModel.php tools/test_write_ahead_puro.php tools/test_reservar_confirmar.php
git commit -F - <<'EOF'
feat(facturas): reservarFacturaECF guarda la fila antes del envio

Una transaccion con SELECT ... FOR UPDATE por e-NCF y ambiente: archiva un
intento reintentable (compare-and-set), inserta la fila en PENDIENTE_ENVIO con
el XML firmado, el RFCE, el codigo y los items, y confirma. 1062 o un segundo
1213 son numero ocupado; cualquier otro PDOException se relanza.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: facturaModel: confirmarFacturaECF, marcarEnvioIncierto, existeFactura

Run every command from the API worktree root (see Task 4). This task uses the same scratch bases as Task 8.

**Files:**
- Modify: `src/Models/facturaModel.php` (1959 lines after Task 8):
  - the reserve block is `:1187-1391`, ending with `deshacer()` at `:1381-1391`;
  - the docblock of `saveFacturaConECF` starts at `:1393`;
  - insert the three methods between them. After this task they sit at `:1393-1484` (`confirmarFacturaECF` `:1414`,
    `marcarEnvioIncierto` `:1451`, `existeFactura` `:1479`), and `saveFacturaConECF` moves to `:1486-…`.
- Modify: `tools/test_write_ahead_puro.php`: insert section 6 above the closing block (`:522-525` after Task 8). After
  this task the closing block is `:651-654`.
- Modify: `tools/test_reservar_confirmar.php`: insert the confirm and mark cases above the closing block (`:351-355`
  after Task 8). After this task the closing block is `:434-438`.
- Test: `php tools/test_write_ahead_puro.php` (section 6) and `tools/test_reservar_confirmar.php` (new cases).

**Interfaces:**
- Consumes:
  - Task 8: `reservarFacturaECF`, `metaEnVuelo`, `json`, and the section 5 helpers (`GuionConexion`, `puro_modelo`,
    `puro_con_log`, `puro_pdo_error`, `puro_ctx_reservar`).
  - Task 4: `EstadosEcf::EN_VUELO`, `EstadosEcf::ENVIO_INCIERTO` and `EstadosEcf::sql`.
  - Task 2: the scratch helpers listed in Task 8.
- Produces:

```php
/** $ctx: estado, track_id, dgii_response, rfce_track_id, rfce_estado, rfce_response, secuencia_utilizada (?bool) */
public function confirmarFacturaECF(int $id, array $ctx): bool   // false = precondition did not match (another writer moved the row); PDOException propagates
/** $ctx: ctxSinXml(reservar ctx) + reserva + fase_fallida + clase + error + resultado_parcial? */
public function marcarEnvioIncierto(int $id, array $ctx): bool   // never throws; logs '[ECF e-NCF=<e_ncf> factura_id=<id>] marcarEnvioIncierto fallo: …'
public function existeFactura(int $id): bool                     // SELECT 1; PDOException propagates
```

  - **Confirm SQL:** `UPDATE facturas SET estado_dgii = :estado, track_id = :track_id, respuesta_dgii = :resp, secuencia_utilizada = :sec, rfce_track_id = :rtid, rfce_estado = :rest, rfce_respuesta = :rresp WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')`.
  - **Bindings:** a string `dgii_response` or `rfce_response` is cut to 4000 characters before `json()`, and `:sec` is
    `null`, `0` or `1`.
  - **Stored incierto JSON:** keys in this order: `fase, desde, flujo, ambiente_secuencia, dispensado, rango_id, secuencia_valor, fase_fallida, clase, error, resultado_parcial, intentos`.
    `error` is cut to 2000 characters, a missing `resultado_parcial` is stored as null, and `intentos` is 0.
  - **Exported by section 6 of `tools/test_write_ahead_puro.php`:** `puro_ctx_confirmar(array $cambios = []): array`
    and `puro_ctx_incierto(array $cambios = []): array`.

- [ ] **Step 1: Write the failing section 6**

In `tools/test_write_ahead_puro.php`, insert directly above the closing block:

```php
// ---------------------------------------------------------------------------
// 6) confirmarFacturaECF, marcarEnvioIncierto y existeFactura (conexion falsa)
// ---------------------------------------------------------------------------

/** El ctx 'confirmar' de ECFEmissionService (las 13 claves + reserva + respuesta), con $cambios encima. */
function puro_ctx_confirmar(array $cambios = []): array
{
    return $cambios + [
        'reserva' => ['factura_id' => 41, 'e_ncf' => 'E310000000123', 'desde' => '2026-10-05 14:03:11'],
        'estado' => 'ACEPTADO', 'track_id' => 'track-E310000000123',
        'dgii_response' => ['trackId' => 'track-E310000000123', 'codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true],
        'dgii_status_code' => 200, 'rfce_track_id' => null, 'rfce_estado' => null, 'rfce_response' => null,
        'rfce_status_code' => null, 'secuencia_utilizada' => true,
    ] + puro_ctx_reservar();
}

/**
 * El ctx 'incierto' (ctxSinXml + reserva + el fallo), con $cambios encima. A
 * proposito trae signed_xml, rfce_xml y xml_firmado: el modelo debe quitarlos.
 */
function puro_ctx_incierto(array $cambios = []): array
{
    return $cambios + [
        'reserva' => ['factura_id' => 41, 'e_ncf' => 'E310000000123', 'desde' => '2026-10-05 14:03:11'],
        'fase_fallida' => 'envio', 'clase' => 'RuntimeException', 'error' => 'HTTP request failed: timeout',
        'resultado_parcial' => null, 'xml_firmado' => '<ECF/>',
    ] + puro_ctx_reservar(['rfce_xml' => '<RFCE/>']);
}

echo "\n== 6) confirmarFacturaECF, marcarEnvioIncierto y existeFactura (conexion falsa) ==\n";
$confirmar = static fn(GuionConexion $c, array $cambios = []): bool
    => puro_modelo($c)->confirmarFacturaECF(41, puro_ctx_confirmar($cambios));
$es = static fn(array $p, string $clave, $valor): bool => array_key_exists($clave, $p) && $p[$clave] === $valor;

$c = new GuionConexion();
$ok = $confirmar($c);
$sql = (string) $c->sql('UPDATE facturas SET estado_dgii');
wa_chk('confirmar: un solo UPDATE, sin transaccion, con la precondicion de estado en vuelo',
    $ok === true && str_contains($sql, "WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')")
    && count($c->de('prepare')) === 1 && $c->de('beginTransaction') === [], [$sql, $c->llamadas]);
$p = $c->params('UPDATE facturas SET estado_dgii') ?? [];
wa_chk('confirmar: estado, track_id, la respuesta en JSON y el id',
    $es($p, ':estado', 'ACEPTADO') && $es($p, ':track_id', 'track-E310000000123')
    && $es($p, ':resp', json_encode(puro_ctx_confirmar()['dgii_response'])) && $es($p, ':rresp', null) && $es($p, ':id', 41), $p);
$secs = [];
foreach ([true, false, null] as $valor) {
    $c = new GuionConexion();
    $confirmar($c, ['secuencia_utilizada' => $valor]);
    $p = $c->params('UPDATE facturas SET estado_dgii') ?? [];
    $secs[] = array_key_exists(':sec', $p) ? $p[':sec'] : 'falta';
}
wa_chk("confirmar: :sec es 1, 0 o null (nunca '' con prepares emulados)", $secs === [1, 0, null], $secs);
$c = new GuionConexion();
$confirmar($c, ['dgii_response' => str_repeat('x', 200 * 1024), 'rfce_response' => str_repeat('y', 200 * 1024)]);
$p = $c->params('UPDATE facturas SET estado_dgii') ?? [];
wa_chk('confirmar: un cuerpo de texto de 200 KB se guarda recortado a 4000 (JSON <= 4002)',
    strlen((string) ($p[':resp'] ?? '')) <= 4002 && json_decode((string) ($p[':resp'] ?? '')) === str_repeat('x', 4000)
    && json_decode((string) ($p[':rresp'] ?? '')) === str_repeat('y', 4000),
    [strlen((string) ($p[':resp'] ?? '')), strlen((string) ($p[':rresp'] ?? ''))]);
$c = new GuionConexion();
$confirmar($c, ['estado' => 'RFCE_ACEPTADO', 'track_id' => null, 'dgii_response' => null,
    'rfce_track_id' => 'track-E320000000007', 'rfce_estado' => 'ACEPTADO', 'rfce_response' => ['codigo' => 1, 'estado' => 'Aceptado']]);
$p = $c->params('UPDATE facturas SET estado_dgii') ?? [];
wa_chk('confirmar RFCE: respuesta_dgii y track_id NULL; los rfce_* con la respuesta del resumen',
    $es($p, ':estado', 'RFCE_ACEPTADO') && $es($p, ':resp', null) && $es($p, ':track_id', null)
    && $es($p, ':rtid', 'track-E320000000007') && $es($p, ':rest', 'ACEPTADO')
    && $es($p, ':rresp', '{"codigo":1,"estado":"Aceptado"}'), $p);
$c = new GuionConexion();
$c->rowCounts['UPDATE facturas SET estado_dgii'] = 0;
wa_chk('confirmar: 0 filas (otra escritura movio la fila) -> false', $confirmar($c) === false);
$c = new GuionConexion();
$caida = puro_pdo_error(2006, 'HY000', 'MySQL server has gone away');
$c->errores[] = ['UPDATE facturas SET estado_dgii', $caida];
[, $e] = puro_con_log(static fn() => $confirmar($c));
wa_chk('confirmar: un PDOException se propaga tal cual', $e === $caida, $e === null ? null : get_class($e));

$marcar = static fn(GuionConexion $c, array $ctx): bool => puro_modelo($c)->marcarEnvioIncierto(41, $ctx);
$c = new GuionConexion();
$ok = $marcar($c, puro_ctx_incierto());
$sql = (string) $c->sql("estado_dgii = 'ENVIO_INCIERTO'");
$p = $c->params("estado_dgii = 'ENVIO_INCIERTO'") ?? [];
wa_chk('marcar: ENVIO_INCIERTO solo desde PENDIENTE_ENVIO, sin transaccion',
    $ok === true && str_contains($sql, "SET estado_dgii = 'ENVIO_INCIERTO', respuesta_dgii = :json")
    && str_contains($sql, "WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'") && $es($p, ':id', 41)
    && $c->de('beginTransaction') === [], $sql);
$json = (string) ($p[':json'] ?? '');
$meta = json_decode($json, true);
wa_chk('marcar: el JSON de 6.3 con las claves en orden',
    is_array($meta) && array_keys($meta) === ['fase', 'desde', 'flujo', 'ambiente_secuencia', 'dispensado', 'rango_id',
        'secuencia_valor', 'fase_fallida', 'clase', 'error', 'resultado_parcial', 'intentos'], $meta);
wa_chk('marcar: fase, meta de la secuencia, el fallo e intentos 0',
    is_array($meta) && $meta['fase'] === 'ENVIO_INCIERTO' && $meta['desde'] === '2026-10-05 14:03:11' && $meta['flujo'] === 'ECF'
    && $meta['ambiente_secuencia'] === 'ecf' && $meta['dispensado'] === true && $meta['rango_id'] === 7
    && $meta['secuencia_valor'] === 123 && $meta['fase_fallida'] === 'envio' && $meta['clase'] === 'RuntimeException'
    && $meta['error'] === 'HTTP request failed: timeout' && $meta['resultado_parcial'] === null && $meta['intentos'] === 0, $meta);
wa_chk('marcar: ni signed_xml, ni rfce_xml, ni xml_firmado, ni XML',
    $json !== '' && !preg_match('/signed_xml|rfce_xml|xml_firmado|</', $json), $json);
$parcial = ['estado' => 'ACEPTADO', 'track_id' => 'track-E310000000123', 'dgii_status_code' => 200, 'dgii_response' => ['codigo' => 1],
    'rfce_estado' => null, 'rfce_track_id' => null, 'rfce_status_code' => null, 'secuencia_utilizada' => true];
$c = new GuionConexion();
$marcar($c, puro_ctx_incierto(['fase_fallida' => 'confirmar', 'resultado_parcial' => $parcial]));
$meta = json_decode((string) (($c->params("estado_dgii = 'ENVIO_INCIERTO'") ?? [])[':json'] ?? ''), true);
wa_chk('marcar (fallo al confirmar): guarda resultado_parcial tal cual',
    is_array($meta) && $meta['fase_fallida'] === 'confirmar' && $meta['resultado_parcial'] === $parcial, $meta);
$cierre = puro_ctx_incierto(['fase_fallida' => 'shutdown', 'clase' => 'shutdown', 'error' => str_repeat('e', 3000)]);
unset($cierre['resultado_parcial']);
$c = new GuionConexion();
$marcar($c, $cierre);
$meta = json_decode((string) (($c->params("estado_dgii = 'ENVIO_INCIERTO'") ?? [])[':json'] ?? ''), true);
wa_chk('marcar (registro de cierre): sin resultado_parcial queda null y el error se recorta a 2000',
    is_array($meta) && array_key_exists('resultado_parcial', $meta) && $meta['resultado_parcial'] === null
    && $meta['fase_fallida'] === 'shutdown' && mb_strlen((string) $meta['error']) === 2000, $meta);
$c = new GuionConexion();
$c->rowCounts["estado_dgii = 'ENVIO_INCIERTO'"] = 0;
wa_chk('marcar: fila que ya no esta en PENDIENTE_ENVIO -> false', $marcar($c, puro_ctx_incierto()) === false);
$c = new GuionConexion();
$c->prepareFalla = true;
[$ok, $e, $log] = puro_con_log(static fn() => $marcar($c, puro_ctx_incierto()));
wa_chk('marcar: si la base falla devuelve false y no lanza', $ok === false && $e === null, $e?->getMessage());
wa_chk('marcar: el log nombra el e-NCF y la factura',
    str_contains($log, '[ECF e-NCF=E310000000123 factura_id=41] marcarEnvioIncierto fallo: se cayo la conexion'), $log);

$c = new GuionConexion();
$c->filas['SELECT 1 FROM facturas'] = [['1' => 1]];
$existe = puro_modelo($c)->existeFactura(41);
wa_chk('existeFactura: SELECT 1 por id; con fila -> true',
    $existe === true && $c->params('SELECT 1 FROM facturas') === [':id' => 41], $c->llamadas);
wa_chk('existeFactura: sin fila -> false', puro_modelo(new GuionConexion())->existeFactura(999999) === false);

```

- [ ] **Step 2: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php`

Expected: sections 1-5 pass (82 `[OK  ]` lines), then the run stops with
`Fatal error: Uncaught Error: Call to undefined method facturaModel::confirmarFacturaECF()`, exit code 255.

- [ ] **Step 3: Add the DB cases**

In `tools/test_reservar_confirmar.php`, insert directly above the closing block, after the `// De vuelta a la base de prueba…`
lines that end case 8:

```php
// ---------------------------------------------------------------------------
// confirmarFacturaECF, marcarEnvioIncierto y existeFactura
// ---------------------------------------------------------------------------

/** Lo que el modelo lee del ctx 'confirmar', con $cambios encima. */
function rc_confirmar(array $cambios = []): array
{
    return $cambios + [
        'estado' => 'ACEPTADO', 'track_id' => null, 'dgii_response' => null, 'rfce_track_id' => null,
        'rfce_estado' => null, 'rfce_response' => null, 'secuencia_utilizada' => null,
    ];
}

/** ctx 'incierto' de una reserva; trae signed_xml, rfce_xml y xml_firmado a proposito. */
function rc_incierto(string $eNcf, array $reserva): array
{
    return rc_ctx($eNcf, ['rfce_xml' => '<RFCE><eNCF>' . $eNcf . '</eNCF></RFCE>']) + [
        'xml_firmado' => '<ECF/>', 'reserva' => $reserva, 'fase_fallida' => 'envio', 'clase' => 'RuntimeException',
        'error' => 'HTTP request failed: Operation timed out after 3001 milliseconds', 'resultado_parcial' => null,
    ];
}

echo "\n== confirmarFacturaECF, marcarEnvioIncierto y existeFactura en {$base} ==\n";
wa_limpiar($pdo);
$modelo = new facturaModel();

// Confirmar una reserva: el estado, el track_id, la secuencia y la respuesta.
$eNcf = 'E310000000901';
$reserva = $modelo->reservarFacturaECF($factura, rc_ctx($eNcf));
$respuesta = ['trackId' => 'track-x', 'codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true];
$ok = $modelo->confirmarFacturaECF($reserva['factura_id'], rc_confirmar([
    'estado' => 'ACEPTADO', 'track_id' => 'track-x', 'dgii_response' => $respuesta, 'secuencia_utilizada' => true,
]));
$fila = wa_filas($pdo, $eNcf)[0] ?? [];
wa_chk('confirmar ACEPTADO sobre PENDIENTE_ENVIO: true', $ok === true);
wa_chk('confirmar: ACEPTADO, track-x, secuencia_utilizada 1 y respuesta_dgii = JSON de la respuesta',
    ($fila['estado_dgii'] ?? null) === 'ACEPTADO' && ($fila['track_id'] ?? null) === 'track-x'
    && ($fila['secuencia_utilizada'] ?? null) !== null && (int) $fila['secuencia_utilizada'] === 1
    && json_decode((string) ($fila['respuesta_dgii'] ?? ''), true) === $respuesta, $fila);
wa_chk('segundo confirmar sobre la misma fila: false (ya no esta en vuelo)',
    $modelo->confirmarFacturaECF($reserva['factura_id'], rc_confirmar(['estado' => 'RECHAZADO'])) === false);
$antes = wa_filas($pdo, $eNcf);
wa_chk('marcar incierto una fila confirmada: false y la fila no cambia',
    $modelo->marcarEnvioIncierto($reserva['factura_id'], rc_incierto($eNcf, $reserva)) === false
    && wa_filas($pdo, $eNcf) === $antes, wa_filas($pdo, $eNcf));

// Marcar incierto una reserva: el JSON de 6.3, sin XML.
$eNcf = 'E310000000902';
$reserva = $modelo->reservarFacturaECF($factura, rc_ctx($eNcf));
$ok = $modelo->marcarEnvioIncierto($reserva['factura_id'], rc_incierto($eNcf, $reserva));
$fila = wa_filas($pdo, $eNcf)[0] ?? [];
$json = (string) ($fila['respuesta_dgii'] ?? '');
$meta = json_decode($json, true);
wa_chk('marcar incierto desde PENDIENTE_ENVIO: true y la fila en ENVIO_INCIERTO',
    $ok === true && ($fila['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $fila);
wa_chk('marcar: respuesta_dgii es el JSON de 6.3 (claves en orden, intentos 0)',
    is_array($meta) && array_keys($meta) === ['fase', 'desde', 'flujo', 'ambiente_secuencia', 'dispensado', 'rango_id',
        'secuencia_valor', 'fase_fallida', 'clase', 'error', 'resultado_parcial', 'intentos']
    && $meta['fase'] === 'ENVIO_INCIERTO' && $meta['intentos'] === 0 && $meta['secuencia_valor'] === 902, $meta);
wa_chk('marcar: sin signed_xml, rfce_xml, xml_firmado ni XML, y cabe en TEXT (< 65535)',
    $json !== '' && !preg_match('/signed_xml|rfce_xml|xml_firmado|</', $json) && strlen($json) < 65535, $json);
wa_chk('confirmar tambien acepta una fila en ENVIO_INCIERTO',
    $modelo->confirmarFacturaECF($reserva['factura_id'], rc_confirmar(['estado' => 'ACEPTADO', 'track_id' => 'track-y'])) === true
    && (wa_filas($pdo, $eNcf)[0]['estado_dgii'] ?? null) === 'ACEPTADO');

// Modo estricto: secuencia_utilizada = false se guarda como 0 (no '').
$modoPrevio = (string) $pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
$pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES'");
$eNcf = 'E310000000903';
$reserva = $modelo->reservarFacturaECF($factura, rc_ctx($eNcf));
[$ok, $e] = rc_con_log(fn() => $modelo->confirmarFacturaECF($reserva['factura_id'], rc_confirmar([
    'estado' => 'RECHAZADO', 'dgii_response' => ['codigo' => 2, 'estado' => 'Rechazado', 'secuenciaUtilizada' => false],
    'secuencia_utilizada' => false,
])));
$fila = wa_filas($pdo, $eNcf)[0] ?? [];
$pdo->prepare('SET SESSION sql_mode = :modo')->execute([':modo' => $modoPrevio]);
wa_chk('modo estricto: confirmar con secuencia_utilizada false -> true y la columna guarda 0',
    $e === null && $ok === true && ($fila['secuencia_utilizada'] ?? null) !== null && (int) $fila['secuencia_utilizada'] === 0,
    $e !== null ? get_class($e) . ': ' . $e->getMessage() : $fila);

wa_chk('existeFactura: true para la reserva y false para 999999',
    $modelo->existeFactura($reserva['factura_id']) === true && $modelo->existeFactura(999999) === false);

```

- [ ] **Step 4: Run it and watch it fail**

Run: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`

Expected: the 20 checks of Task 8 pass. After the header `== confirmarFacturaECF, marcarEnvioIncierto y existeFactura en wa_scratch ==`,
the run stops with `Fatal error: Uncaught Error: Call to undefined method facturaModel::confirmarFacturaECF()`, exit
code 255. The next run's `wa_limpiar` removes the row it left behind.

- [ ] **Step 5: Write the three methods**

In `src/Models/facturaModel.php`, directly above the docblock of `saveFacturaConECF` (`:1393`), insert this block. It
ends with one blank line.

```php
    /**
     * Anota la respuesta de la DGII en una fila en vuelo (hook 'confirmar').
     * Un solo UPDATE en autocommit con la precondicion de estado: si otra
     * escritura ya movio la fila no la pisa y devuelve false (el servicio lo
     * registra como CONFIRM_RACE y no toca la secuencia). Reemplaza la meta de
     * respuesta_dgii por la respuesta: quien necesite rango_id o
     * secuencia_valor la lee antes con metaEnvio().
     *
     * Un cuerpo de texto (2xx sin JSON, un error en HTML) se recorta a 4000
     * caracteres antes de codificarlo: respuesta_dgii es TEXT. Una respuesta
     * NULL (el flujo RFCE no tiene respuesta del e-CF) queda NULL.
     * secuencia_utilizada va como entero o NULL: con prepares emulados un false
     * llegaria como '' y el modo estricto lo rechaza (1366); updateECFEstado
     * castea igual.
     *
     * Un PDOException se propaga: el servicio lo trata como fallo al confirmar.
     *
     * @param array $ctx lee estado, track_id, dgii_response, rfce_track_id, rfce_estado, rfce_response
     *                   y secuencia_utilizada (?bool); el resto del ctx 'confirmar' se ignora
     * @return bool false si la fila ya no estaba en vuelo
     */
    public function confirmarFacturaECF(int $id, array $ctx): bool
    {
        $recortar = static fn($cuerpo) => is_string($cuerpo) ? mb_substr($cuerpo, 0, 4000) : $cuerpo;
        $secuencia = $ctx['secuencia_utilizada'] ?? null;
        $stmt = $this->conexion->prepare(
            'UPDATE facturas SET estado_dgii = :estado, track_id = :track_id, respuesta_dgii = :resp,
                    secuencia_utilizada = :sec, rfce_track_id = :rtid, rfce_estado = :rest, rfce_respuesta = :rresp
              WHERE id = :id AND estado_dgii IN (' . EstadosEcf::sql(EstadosEcf::EN_VUELO) . ')'
        );
        $stmt->execute([
            ':estado' => (string) ($ctx['estado'] ?? ''),
            ':track_id' => $ctx['track_id'] ?? null,
            ':resp' => self::json($recortar($ctx['dgii_response'] ?? null)),
            ':sec' => $secuencia === null ? null : (int) $secuencia,
            ':rtid' => $ctx['rfce_track_id'] ?? null,
            ':rest' => $ctx['rfce_estado'] ?? null,
            ':rresp' => self::json($recortar($ctx['rfce_response'] ?? null)),
            ':id' => $id,
        ]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Deja la fila en ENVIO_INCIERTO (hook 'incierto'): el envio o la
     * confirmacion fallaron y no se sabe si la DGII tiene el e-CF. Solo desde
     * PENDIENTE_ENVIO. respuesta_dgii guarda la meta del envio y el fallo
     * (spec 6.3), nunca XML: signed_xml, rfce_xml y xml_firmado se quitan del
     * ctx por si acaso, y el error se recorta a 2000 caracteres.
     *
     * Nunca lanza: lo llaman el catch del envio y el registro de cierre
     * (shutdown), donde una excepcion taparia el fallo original. Si no puede
     * escribir deja una linea en el log con el e-NCF y devuelve false; la fila
     * queda en PENDIENTE_ENVIO.
     *
     * @param array $ctx ctxSinXml(ctx 'reservar') + reserva + fase_fallida + clase + error
     *                   + resultado_parcial (no viene desde el registro de cierre)
     */
    public function marcarEnvioIncierto(int $id, array $ctx): bool
    {
        try {
            unset($ctx['signed_xml'], $ctx['rfce_xml'], $ctx['xml_firmado']);
            $meta = ['fase' => EstadosEcf::ENVIO_INCIERTO] + self::metaEnVuelo($ctx) + [
                'fase_fallida' => $ctx['fase_fallida'] ?? null,
                'clase' => $ctx['clase'] ?? null,
                'error' => isset($ctx['error']) ? mb_substr((string) $ctx['error'], 0, 2000) : null,
                'resultado_parcial' => $ctx['resultado_parcial'] ?? null,
                'intentos' => 0,
            ];
            $stmt = $this->conexion->prepare(
                "UPDATE facturas SET estado_dgii = 'ENVIO_INCIERTO', respuesta_dgii = :json
                  WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'"
            );
            $stmt->execute([':json' => self::json($meta), ':id' => $id]);
            return $stmt->rowCount() > 0;
        } catch (Throwable $e) {
            error_log(sprintf('[ECF e-NCF=%s factura_id=%d] marcarEnvioIncierto fallo: %s',
                (string) ($ctx['e_ncf'] ?? ($ctx['reserva']['e_ncf'] ?? '?')), $id, $e->getMessage()));
            return false;
        }
    }

    /**
     * true si la fila existe. El catch de la emision lo usa para saber si una
     * reserva sobrevivio (spec 4.7). Un PDOException se propaga.
     */
    public function existeFactura(int $id): bool
    {
        $stmt = $this->conexion->prepare('SELECT 1 FROM facturas WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetchColumn() !== false;
    }

```

- [ ] **Step 6: Run the DB-free tests and lint**

Run: `php -l src/Models/facturaModel.php && php tools/test_write_ahead_puro.php | tail -1 && php tools/test_notas_vinculadas.php | tail -1 && php tools/check_estado_dgii_ancho.php | tail -1`

Expected:

```
No syntax errors detected in src/Models/facturaModel.php
100 de 100 pruebas OK
62 de 62 pruebas OK
32/32 OK
```

Section 6 prints its 18 checks, all `[OK  ]`.

- [ ] **Step 7: Run the scratch-DB test**

Run: `php -l tools/test_reservar_confirmar.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`

Expected: the Task 8 section passes, then 10 `[OK  ]` lines under the new header. The run ends with:

```
30 de 30 pruebas OK
```

- [ ] **Step 8: Commit**

```bash
git add src/Models/facturaModel.php tools/test_write_ahead_puro.php tools/test_reservar_confirmar.php
git commit -F - <<'EOF'
feat(facturas): confirmar y marcar envio incierto del e-CF

confirmarFacturaECF anota la respuesta de la DGII solo si la fila sigue en
vuelo (secuencia_utilizada como entero, cuerpos de texto recortados a 4000).
marcarEnvioIncierto guarda la meta y el fallo sin XML y nunca lanza.
existeFactura para el catch de la emision.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: ncfModel lanza al fallar ncf_sequences; guard CR estatico

All paths are relative to the API worktree `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead` (branch `feat/ecf-write-ahead`). Line numbers are those of `9f669ad`: Tasks 1-9 do not touch these two source files. Re-read each file right before editing it.

**Files:**
- Modify: `src/Models/ncfModel.php`
  - `dispenseNextECF` (`:117-168`): docblock `:104-116` (the `@return` is at `:114-115`), the `catch` at `:165-167`.
  - `rollbackECFSequence` (`:178-226`): the silent `catch` at `:223-225`.
- Modify: `src/Utils/FacturacionElectronica/DgiiReceptionService.php`: `assertSinCarriageReturn`, docblock `:256-264`, method `:265-275`. Its callers `:31` (`recibir`), `:72` (`recibirResumen`) and `:112` (`enviarAprobacionComercial`) stay as they are.
- Modify: `tools/test_write_ahead_puro.php`: add section 7 directly above its closing block (Task 4), after section 6 of Task 9.
- Modify: `tools/test_reservar_confirmar.php`: add the dispense block directly above its closing block (Task 8), after the cases of Task 9.
- Test: `php tools/test_write_ahead_puro.php` (DB-free) and `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate` (scratch DB).

**Interfaces:**
- Consumes:
  - Task 1: `wa_chk(string $desc, bool $ok, mixed $obtenido = null): void`, `wa_fin(): never`, `wa_arg(string $nombre, ?string $defecto = null): ?string`.
  - Task 2: `wa_usar_base(string $base): PDO` (checks the marker table, points `Database` at the base and returns its connection).
  - Existing: `ncfModel::__construct()` (connects through `Database::getInstance()`, `ncfModel.php:9-12`); `rollbackECFSequence(string $type, int $expectedValue, ?string $ambiente = null, ?int $rangoId = null): bool` (`:178`).
- Produces:

```php
// DgiiReceptionService
public static function assertSinCarriageReturn(string $signedXml): void
// throws RuntimeException on "\r", '&#13;', '&#xd;' (case-insensitive); same body as today

// ncfModel
public function dispenseNextECF(string $type, ?string $ambiente = null): ?array
// throws RuntimeException('ncf_sequences inaccesible: ' . $pdoMessage, 0, PDOException) on a DB error;
// null only for an invalid type (:120), no range with capacity (:135) or three lost races (:164)
public function rollbackECFSequence(string $type, int $expectedValue, ?string $ambiente = null, ?int $rangoId = null): bool
// unchanged contract; on PDOException it now writes error_log('[ECF] rollbackECFSequence fallo: ...') and returns false
```

- [ ] **Step 1: Check the tree**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "catch (PDOException \$e)" src/Models/ncfModel.php
grep -n "function assertSinCarriageReturn\|this->assertSinCarriageReturn" src/Utils/FacturacionElectronica/DgiiReceptionService.php
```

Expected:
- `git status --short` prints only `?? tools/reconstruir_e340000000001.sql` (never stage it).
- The `catch` lines include `165:` (`dispenseNextECF`) and `223:` (`rollbackECFSequence`).
- The second grep prints `265:    private function assertSinCarriageReturn(string $signedXml): void` and three callers at `31:`, `72:` and `112:`.

- [ ] **Step 2: Write the failing DB-free test (section 7)**

Insert this block in `tools/test_write_ahead_puro.php` directly above its closing block:

```php
// ---------------------------------------------------------------------------
// 7) Guard de CR publico y estatico; dispenseNextECF lanza (Task 10)
// ECFEmissionService corre el guard antes de reservar la fila: un CR tiene que
// fallar con el numero todavia devolvible, no dentro de recibir().
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/DgiiReceptionService.php';

echo "\n== 7) Guard de retornos de carro y dispenseNextECF ==\n";
$guardCr = new ReflectionMethod(DgiiReceptionService::class, 'assertSinCarriageReturn');
$guardEstatico = $guardCr->isPublic() && $guardCr->isStatic();
wa_chk('7: assertSinCarriageReturn es public static', $guardEstatico,
    ['public' => $guardCr->isPublic(), 'static' => $guardCr->isStatic()]);
// null = no se puede llamar asi (sigue privado); true = lanzo; false = lo dejo pasar.
$lanzaCr = static function (string $xml) use ($guardEstatico): ?bool {
    if (!$guardEstatico) {
        return null;
    }
    try {
        DgiiReceptionService::assertSinCarriageReturn($xml);
        return false;
    } catch (RuntimeException $e) {
        return str_contains($e->getMessage(), 'retornos de carro');
    }
};
wa_chk('7: lanza con un \r literal', $lanzaCr("<a>\r</a>") === true);
wa_chk('7: lanza con &#13;', $lanzaCr('<a>&#13;</a>') === true);
wa_chk('7: lanza con &#xD; (sin importar mayusculas)', $lanzaCr('<a>&#xD;</a>') === true);
wa_chk('7: deja pasar un \n', $lanzaCr("<a>\n</a>") === false);
$fuenteRecepcion = (string) file_get_contents(__DIR__ . '/../src/Utils/FacturacionElectronica/DgiiReceptionService.php');
wa_chk('7: recibir, recibirResumen y enviarAprobacionComercial lo siguen llamando (3 llamadas)',
    substr_count($fuenteRecepcion, '$this->assertSinCarriageReturn(') === 3,
    substr_count($fuenteRecepcion, '$this->assertSinCarriageReturn('));
// El caso con la tabla renombrada corre en tools/test_reservar_confirmar.php
// (necesita MySQL); aqui solo el texto, para tener senal sin base.
$fuenteNcf = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../src/Models/ncfModel.php'));
$cuerpoDispense = preg_match('/function dispenseNextECF\(.*?\n    \}\n/s', $fuenteNcf, $mDispense) ? $mDispense[0] : '';
wa_chk('7: dispenseNextECF convierte la PDOException en RuntimeException',
    str_contains($cuerpoDispense, "throw new RuntimeException('ncf_sequences inaccesible: ' . \$e->getMessage(), 0, \$e);"));
wa_chk('7: dispenseNextECF ya no devuelve null en el catch',
    !preg_match('/catch \(PDOException \$e\) \{\s*return null;/', $cuerpoDispense));
```

- [ ] **Step 3: Run it and watch section 7 fail**

```bash
php tools/test_write_ahead_puro.php
```

Expected: sections 1-6 stay OK. Section 7 passes 1 of its 8 checks:
- `[FALLO] 7: assertSinCarriageReturn es public static` with `obtenido: {"public":false,"static":false}`;
- `[FALLO]` on the four throw/pass lines and on both `dispenseNextECF` lines;
- `[OK  ]` only on the "3 llamadas" line.

Exit code 1.

- [ ] **Step 4: Write the failing DB test (dispense block)**

Insert this block in `tools/test_reservar_confirmar.php` directly above its closing block:

```php
// ---------------------------------------------------------------------------
// dispenseNextECF lanza si ncf_sequences falla; rollbackECFSequence deja rastro
// (Task 10). Se renombra la tabla en la base de prueba y se devuelve a su
// nombre en finally.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/Models/ncfModel.php';

echo "\n== ncf_sequences inaccesible ==\n";
// Otra vez la base de prueba principal: un caso anterior pudo dejar Database
// apuntando a la copia (--copia-db).
$conNcf = wa_usar_base((string) wa_arg('tenant-db'));
$hayTabla = static function (PDO $c, string $tabla): bool {
    $st = $c->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t');
    $st->execute([':t' => $tabla]);
    return (int) $st->fetchColumn() > 0;
};
// Una corrida anterior cortada a mitad pudo dejar la tabla renombrada.
if (!$hayTabla($conNcf, 'ncf_sequences') && $hayTabla($conNcf, 'ncf_sequences_wa_off')) {
    $conNcf->exec('RENAME TABLE ncf_sequences_wa_off TO ncf_sequences');
}
$ncfPrueba = new ncfModel();
$logNcf = (string) tempnam(sys_get_temp_dir(), 'wa_ncf_');
$logPrevio = ini_get('error_log');
$conNcf->exec('RENAME TABLE ncf_sequences TO ncf_sequences_wa_off');
try {
    $lanzada = null;
    try {
        $ncfPrueba->dispenseNextECF('E31', 'certecf');
    } catch (Throwable $e) {
        $lanzada = $e;
    }
    wa_chk('dispense con ncf_sequences renombrada: RuntimeException, no null',
        $lanzada instanceof RuntimeException, $lanzada ? get_class($lanzada) : 'no lanzo');
    wa_chk("dispense: el mensaje empieza con 'ncf_sequences inaccesible: '",
        $lanzada !== null && str_starts_with($lanzada->getMessage(), 'ncf_sequences inaccesible: '), $lanzada?->getMessage());
    wa_chk('dispense: la PDOException queda como getPrevious()', $lanzada?->getPrevious() instanceof PDOException);

    ini_set('error_log', $logNcf);
    $devuelto = $ncfPrueba->rollbackECFSequence('E31', 1, 'certecf', null);
    ini_set('error_log', $logPrevio === false ? '' : $logPrevio);
    $lineasNcf = (string) file_get_contents($logNcf);
    wa_chk('rollback con ncf_sequences renombrada: false', $devuelto === false);
    wa_chk("rollback: el error_log dice '[ECF] rollbackECFSequence fallo: '",
        str_contains($lineasNcf, '[ECF] rollbackECFSequence fallo: '), $lineasNcf);
} finally {
    ini_set('error_log', $logPrevio === false ? '' : $logPrevio);
    $conNcf->exec('RENAME TABLE ncf_sequences_wa_off TO ncf_sequences');
    @unlink($logNcf);
}
wa_chk('ncf_sequences volvio a su nombre', $hayTabla($conNcf, 'ncf_sequences') && !$hayTabla($conNcf, 'ncf_sequences_wa_off'));
// Un ambiente sin ninguna fila en ncf_sequences: db/tenant_schema.sql:311-350
// siembra E31-E47 en certecf, ecf y testecf (E45 en :325, :336 y :347) con numero_hasta y
// fecha_vencimiento NULL (sin limite), asi que ningun tipo de esos tres
// ambientes sirve para probar "no hay rango".
wa_chk('sin rango en ese ambiente, dispense sigue devolviendo null', $ncfPrueba->dispenseNextECF('E31', 'wa_sin_rango') === null);
```

- [ ] **Step 5: Run it and watch the dispense block fail**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate
```

Expected in the new block, 3 of 7 checks pass:
- `[FALLO] dispense con ncf_sequences renombrada: RuntimeException, no null` with `obtenido: "no lanzo"`;
- `[FALLO]` on the message line and the `getPrevious()` line;
- `[FALLO] rollback: el error_log dice '[ECF] rollbackECFSequence fallo: '` with `obtenido: ""`;
- `[OK  ]` on the other three: `rollback con ncf_sequences renombrada: false`, `ncf_sequences volvio a su nombre` and `sin rango en ese ambiente, dispense sigue devolviendo null`.

Exit code 1. The `finally` puts the table back: `SHOW TABLES LIKE 'ncf_sequences%'` on `wa_scratch` lists only `ncf_sequences`.

- [ ] **Step 6: Make `assertSinCarriageReturn` public static**

In `src/Utils/FacturacionElectronica/DgiiReceptionService.php`, replace the end of the docblock and the signature (`:262-265`):

```php
     * salte esa normalizacion, fallando local con un error accionable en
     * vez de un rechazo criptico de DGII.
     */
    private function assertSinCarriageReturn(string $signedXml): void
```

with:

```php
     * salte esa normalizacion, fallando local con un error accionable en
     * vez de un rechazo criptico de DGII.
     *
     * Publico y estatico: ECFEmissionService lo corre ANTES de reservar la fila
     * (pre-vuelo), cuando el numero todavia se puede devolver. Los tres envios
     * de esta clase lo siguen llamando con $this->, que en PHP 8 vale igual.
     */
    public static function assertSinCarriageReturn(string $signedXml): void
```

The body (`:266-275`) and the three `$this->assertSinCarriageReturn(...)` calls stay as they are.

- [ ] **Step 7: `dispenseNextECF` throws; `rollbackECFSequence` logs**

In `src/Models/ncfModel.php`, make three replacements.

The end of the `dispenseNextECF` docblock (`:114-116`):

```php
     * @return array|null ['e_ncf','valor','fecha_vencimiento','numero_hasta','restantes'] o null si
     *                    NO hay rango disponible (agotado/vencido: registrar uno nuevo).
     */
```

becomes:

```php
     * @return array|null ['e_ncf','valor','fecha_vencimiento','numero_hasta','restantes'] o null si
     *                    NO hay rango disponible (agotado/vencido: registrar uno nuevo).
     * @throws RuntimeException si ncf_sequences no se puede leer o actualizar
     *                    (base caida, tabla ausente). Antes devolvia null y el
     *                    usuario leia "Se acabaron los numeros..." con la base caida.
     */
```

The three-line `catch` blocks alone are not unique in `ncfModel.php`: the `return null;` form appears twice (`:38-40`, `:165-167`) and the `return false;` form three times (`:55-57`, `:67-69`, `:223-225`), so the Edit tool would reject them. Each `old_string` below starts one line earlier, with the `return` that ends the `try`; both are unique.

The end of the `try` and the `catch` of `dispenseNextECF` (`:164-167`):

```php
            return null;
        } catch (PDOException $e) {
            return null;
        }
```

becomes:

```php
            return null;
        } catch (PDOException $e) {
            // null significa "no hay rango"; una base que no responde es otra cosa
            // y sale como error generico (spec 4.8).
            throw new RuntimeException('ncf_sequences inaccesible: ' . $e->getMessage(), 0, $e);
        }
```

The end of the `try` and the `catch` of `rollbackECFSequence` (`:222-225`):

```php
            return false;
        } catch (PDOException $e) {
            return false;
        }
```

becomes:

```php
            return false;
        } catch (PDOException $e) {
            // Sigue devolviendo false (el llamador lo trata como "no se pudo
            // devolver"), pero con rastro: sin esto un fallo de la base se leia
            // igual que "rollback sin coincidencia".
            error_log('[ECF] rollbackECFSequence fallo: ' . $e->getMessage());
            return false;
        }
```

The three `return null;` at `:120`, `:135` and `:164` stay. The only caller of `dispenseNextECF` is `ECFEmissionService.php:223`. Its `null` branch ("Se acabaron...") is unchanged, and a `RuntimeException` now reaches the controller's generic 502.

- [ ] **Step 8: Run both tests and the checks**

```bash
php -l src/Models/ncfModel.php
php -l src/Utils/FacturacionElectronica/DgiiReceptionService.php
php tools/test_write_ahead_puro.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate
php tools/check_estado_dgii_ancho.php
```

Expected:
- `No syntax errors detected` twice.
- Section 7 prints 8 `[OK  ]` lines; the puro file ends with `N de N pruebas OK` and exit 0.
- The dispense block prints 7 `[OK  ]` lines; `test_reservar_confirmar.php` ends with `N de N pruebas OK` and exit 0.
- The checker still prints `32/32 OK` (the count Task 4 left).

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Models/ncfModel.php src/Utils/FacturacionElectronica/DgiiReceptionService.php tools/test_write_ahead_puro.php tools/test_reservar_confirmar.php
git commit -F - <<'EOF'
fix(ecf): dispenseNextECF lanza si ncf_sequences falla; guard CR estatico

- dispenseNextECF convierte la PDOException en RuntimeException('ncf_sequences
  inaccesible: ...'): con la base caida el usuario leia "Se acabaron los
  numeros". null queda solo para "no hay rango".
- rollbackECFSequence sigue devolviendo false ante una PDOException, ahora con
  error_log: ya no se confunde con "rollback sin coincidencia".
- DgiiReceptionService::assertSinCarriageReturn pasa a public static para que
  ECFEmissionService lo corra antes de reservar la fila.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: ECFEmissionService: inyeccion, proyecciones y REINTENTABLES

All paths are relative to the API worktree. `ECFEmissionService.php` is still at `9f669ad` here (Tasks 1-10 do not touch it), so the line numbers below hold. Re-read the file right before editing it.

**Files:**
- Modify: `src/Utils/FacturacionElectronica/ECFEmissionService.php`
  - requires `:3-14` (new line after `:9`);
  - constants after `RFCE_THRESHOLD` (`:27`);
  - constructor `:56-63` (props `:44-54` unchanged);
  - orphan docblock `:77-80` (moves onto `resolveUbicaciones`, `:112`);
  - `eNcfYaUsado` docblock `:81-90` and list `:99-101`;
  - `reclamarSecuenciaSiNoUtilizada` parse `:503-510` (`$esRechazo` at `:511` stays);
  - three new statics before the `consultarEstado` docblock (`:529`).
- Modify: `tools/test_write_ahead_puro.php`: add section 8 directly above its closing block (Task 4).
- Test: `php tools/test_write_ahead_puro.php`, `php tools/check_estado_dgii_ancho.php`.

**Interfaces:**
- Consumes:
  - Task 4: `EstadosEcf::REINTENTABLES` (`['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO']`).
  - Task 1: `wa_chk`, `wa_fin`.
  - Existing: `DgiiReceptionService::__construct(?DgiiAuthService $auth = null)` (`DgiiReceptionService.php:21-24`), `DgiiAuthService::__construct(?DgiiXmlSigner $signer = null)` (no I/O).
- Produces:

```php
public function __construct(?DgiiAuthService $auth = null, ?DgiiXmlSigner $signer = null, ?DgiiReceptionService $reception = null, ?ncfModel $ncf = null)
private const CLAVES_PROYECCION = ['estado', 'track_id', 'dgii_status_code', 'dgii_response', 'rfce_estado', 'rfce_track_id', 'rfce_status_code', 'secuencia_utilizada'];
private const MAX_RESPUESTA = 4000;
public static function ctxSinXml(array $ctx): array            // removes signed_xml and rfce_xml, keeps the rest in order
public static function proyectarResultado(array $ctx): array    // exactly the 8 keys, absent = null; non-array dgii_response cut with mb_substr(…, 0, 4000)
private static function parseSecuenciaUtilizada(array $data): ?bool   // key 'secuenciaUtilizada'; FILTER_VALIDATE_BOOLEAN + FILTER_NULL_ON_FAILURE
```

`eNcfYaUsado` now treats `RFCE_NO_ENCONTRADO` as retryable, as the reserve does (Task 8). Task 12 uses the constructor, `ctxSinXml` and `parseSecuenciaUtilizada`; Task 13 uses `proyectarResultado`.

- [ ] **Step 1: Write the failing test (section 8)**

Insert this block in `tools/test_write_ahead_puro.php` directly above its closing block (after section 7):

```php
// ---------------------------------------------------------------------------
// 8) ECFEmissionService: inyeccion, proyecciones sin XML y REINTENTABLES (Task 11)
// Nada de esto toca la base: el ncfModel inyectado se crea sin constructor.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/ECFEmissionService.php';

echo "\n== 8) ECFEmissionService: inyeccion y proyecciones ==\n";
$propDe = static fn(object $o, string $p): mixed => (new ReflectionProperty($o, $p))->getValue($o);
$authInyectado = new DgiiAuthService();
$signerInyectado = new DgiiXmlSigner();
$recepcionInyectada = new DgiiReceptionService($authInyectado);
$ncfInyectado = (new ReflectionClass(ncfModel::class))->newInstanceWithoutConstructor();
$svcInyectado = new ECFEmissionService($authInyectado, $signerInyectado, $recepcionInyectada, $ncfInyectado);
wa_chk('8: constructor usa el auth, el signer, la recepcion y el ncfModel inyectados',
    $propDe($svcInyectado, 'auth') === $authInyectado
    && $propDe($svcInyectado, 'signer') === $signerInyectado
    && $propDe($svcInyectado, 'reception') === $recepcionInyectada
    && $propDe($svcInyectado, 'ncfModel') === $ncfInyectado);
$svcSoloAuth = new ECFEmissionService($authInyectado);
wa_chk('8: con solo el auth, la recepcion por defecto usa ese mismo auth',
    $propDe($propDe($svcSoloAuth, 'reception'), 'auth') === $authInyectado);
$svcPorDefecto = new ECFEmissionService();
wa_chk('8: sin argumentos no toca la base (ncfModel sigue null)',
    $propDe($svcPorDefecto, 'ncfModel') === null
    && $propDe($svcPorDefecto, 'auth') instanceof DgiiAuthService
    && $propDe($svcPorDefecto, 'reception') instanceof DgiiReceptionService);

$fuenteServicio = (string) file_get_contents(__DIR__ . '/../src/Utils/FacturacionElectronica/ECFEmissionService.php');
wa_chk("8: sin la lista literal ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO']",
    !str_contains($fuenteServicio, "['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO']"));
wa_chk('8: eNcfYaUsado usa EstadosEcf::REINTENTABLES',
    str_contains($fuenteServicio, 'in_array((string) $estado, EstadosEcf::REINTENTABLES, true)'));
wa_chk('8: ya no nombra saveFacturaConECF', !str_contains($fuenteServicio, 'saveFacturaConECF'));
wa_chk("8: la reclamacion sigue probando ['RECHAZADO', 'NO_ENCONTRADO'] (el RFCE pasa el estado base)",
    str_contains($fuenteServicio, "\$esRechazo = in_array(\$estado, ['RECHAZADO', 'NO_ENCONTRADO'], true);"));
wa_chk('8: la reclamacion lee la bandera con parseSecuenciaUtilizada',
    str_contains($fuenteServicio, '$utilizada = self::parseSecuenciaUtilizada($receptionData);'));

$hayProyecciones = method_exists(ECFEmissionService::class, 'ctxSinXml')
    && method_exists(ECFEmissionService::class, 'proyectarResultado')
    && method_exists(ECFEmissionService::class, 'parseSecuenciaUtilizada');
wa_chk('8: existen ctxSinXml, proyectarResultado y parseSecuenciaUtilizada', $hayProyecciones);
if ($hayProyecciones) {
    $ctxPrueba = [
        'tipo_ecf' => '31', 'e_ncf' => 'E310000000123', 'signed_xml' => '<ECF>firmado</ECF>',
        'rfce_xml' => '<RFCE>firmado</RFCE>', 'codigo_seguridad' => 'QUJDRE', 'reserva' => ['factura_id' => 41],
    ];
    $sinXml = ECFEmissionService::ctxSinXml($ctxPrueba);
    wa_chk('8: ctxSinXml quita signed_xml y rfce_xml y deja lo demas, en orden',
        $sinXml === ['tipo_ecf' => '31', 'e_ncf' => 'E310000000123', 'codigo_seguridad' => 'QUJDRE', 'reserva' => ['factura_id' => 41]],
        $sinXml);

    $clavesProyeccion = ['estado', 'track_id', 'dgii_status_code', 'dgii_response', 'rfce_estado', 'rfce_track_id', 'rfce_status_code', 'secuencia_utilizada'];
    $proy = ECFEmissionService::proyectarResultado($ctxPrueba + ['estado' => 'ACEPTADO', 'track_id' => 't-1', 'secuencia_utilizada' => false]);
    wa_chk('8: proyectarResultado devuelve exactamente las 8 claves, en orden', array_keys($proy) === $clavesProyeccion, array_keys($proy));
    wa_chk('8: proyectarResultado deja null las ausentes, conserva false y descarta las extra (el XML tambien)',
        $proy['estado'] === 'ACEPTADO' && $proy['track_id'] === 't-1' && $proy['rfce_estado'] === null
        && $proy['secuencia_utilizada'] === false
        && !array_key_exists('signed_xml', $proy) && !array_key_exists('e_ncf', $proy) && !array_key_exists('reserva', $proy), $proy);
    $grande = str_repeat('á', 100 * 1024);   // 200 KB de texto (2 bytes por caracter)
    $proy = ECFEmissionService::proyectarResultado(['dgii_response' => $grande]);
    wa_chk('8: un dgii_response de texto de 200 KB queda en 4000 caracteres (mb_substr, UTF-8 valido)',
        is_string($proy['dgii_response']) && mb_strlen($proy['dgii_response']) === 4000 && mb_check_encoding($proy['dgii_response'], 'UTF-8'),
        mb_strlen((string) $proy['dgii_response']));
    $arreglo = ['trackId' => 't-2', 'codigo' => 1, 'estado' => 'Aceptado', 'mensajes' => [['valor' => 'ok']]];
    $proy = ECFEmissionService::proyectarResultado(['dgii_response' => $arreglo]);
    wa_chk('8: un dgii_response arreglo pasa intacto', $proy['dgii_response'] === $arreglo, $proy['dgii_response']);

    $parse = new ReflectionMethod(ECFEmissionService::class, 'parseSecuenciaUtilizada');
    wa_chk('8: parseSecuenciaUtilizada es private static', $parse->isPrivate() && $parse->isStatic());
    $casosParse = [
        'true' => [['secuenciaUtilizada' => true], true],
        'false' => [['secuenciaUtilizada' => false], false],
        '"true"' => [['secuenciaUtilizada' => 'true'], true],
        '"false"' => [['secuenciaUtilizada' => 'false'], false],
        'ausente' => [['codigo' => 2], null],
        '"abc"' => [['secuenciaUtilizada' => 'abc'], null],
    ];
    foreach ($casosParse as $nombre => [$datos, $esperado]) {
        $obtenido = $parse->invoke(null, $datos);
        wa_chk("8: parseSecuenciaUtilizada({$nombre}) === " . var_export($esperado, true), $obtenido === $esperado, $obtenido);
    }
}
```

- [ ] **Step 2: Run it and watch section 8 fail**

```bash
php tools/test_write_ahead_puro.php
```

Expected: section 8 runs 9 checks and fails 7 of them:
- the two constructor checks;
- the literal list;
- `eNcfYaUsado usa EstadosEcf::REINTENTABLES`;
- `saveFacturaConECF`;
- `parseSecuenciaUtilizada` in the reclaim;
- `existen ctxSinXml, proyectarResultado y parseSecuenciaUtilizada`.

Only `sin argumentos no toca la base` and `la reclamacion sigue probando ['RECHAZADO', 'NO_ENCONTRADO']` pass. Exit code 1.

- [ ] **Step 3: Require `EstadosEcf` and add the two constants**

In `src/Utils/FacturacionElectronica/ECFEmissionService.php`, after `require_once __DIR__ . '/EcfUsuarioException.php';` (`:9`) add:

```php
require_once __DIR__ . '/EstadosEcf.php';
```

After `    private const RFCE_THRESHOLD = 250000.00;` (`:27`) add these lines, with one blank line before and after:

```php
    /** Claves de proyectarResultado(), en este orden. */
    private const CLAVES_PROYECCION = ['estado', 'track_id', 'dgii_status_code', 'dgii_response', 'rfce_estado', 'rfce_track_id', 'rfce_status_code', 'secuencia_utilizada'];

    /** Tope de un dgii_response que llego como texto (cuerpo crudo, DgiiAuthService.php:150). */
    private const MAX_RESPUESTA = 4000;
```

- [ ] **Step 4: Constructor with injection**

Replace the constructor (`:56-63`):

```php
    public function __construct()
    {
        $this->auth = new DgiiAuthService();
        $this->signer = new DgiiXmlSigner();
        $this->reception = new DgiiReceptionService($this->auth);
        $this->builder = new ECFXmlBuilder();
        $this->rfceBuilder = new RFCEXmlBuilder();
    }
```

with:

```php
    /**
     * Las cuatro dependencias son opcionales: sin argumentos queda igual que
     * antes. Las pruebas inyectan dobles (tools/test_write_ahead_ecf.php). Un
     * ncfModel no inyectado sigue perezoso (ncfModel()).
     */
    public function __construct(
        ?DgiiAuthService $auth = null,
        ?DgiiXmlSigner $signer = null,
        ?DgiiReceptionService $reception = null,
        ?ncfModel $ncf = null
    ) {
        $this->auth = $auth ?? new DgiiAuthService();
        $this->signer = $signer ?? new DgiiXmlSigner();
        // La recepcion por defecto usa el MISMO auth, inyectado o no (como antes).
        $this->reception = $reception ?? new DgiiReceptionService($this->auth);
        $this->ncfModel = $ncf;
        $this->builder = new ECFXmlBuilder();
        $this->rfceBuilder = new RFCEXmlBuilder();
    }
```

The lazy `ncfModel()` (`:72-75`, `??=`) keeps working: it only builds a model when none was injected.

- [ ] **Step 5: `eNcfYaUsado` on `EstadosEcf::REINTENTABLES`; move the orphan docblock**

Replace the two stacked docblocks (`:77-90`):

```php
    /**
     * Resuelve municipio/provincia de emisor y comprador al código DGII de 6
     * dígitos usando el catálogo. Fail-open: valores sin match quedan intactos.
     */
    /**
     * true si el e-NCF ya lo ocupa, en ESTE ambiente, una factura que NO se
     * puede re-emitir. Certificacion y produccion numeran aparte (migracion
     * 027): contar los de prueba hacia saltar el rango que la DGII autoriza en
     * produccion. Una fila sin ambiente (anterior a la columna) cuenta como
     * ocupada: no se sabe de cual era.
     * Mismos estados reintentables que facturaModel::saveFacturaConECF, para que
     * los dos chequeos no puedan discrepar. Fail-open: ante un error de consulta
     * devuelve false y deja que el chequeo del modelo siga siendo la red.
     */
```

with:

```php
    /**
     * true si el e-NCF ya lo ocupa, en ESTE ambiente, una factura que NO se
     * puede re-emitir. Certificacion y produccion numeran aparte (migracion
     * 027): contar los de prueba hacia saltar el rango que la DGII autoriza en
     * produccion. Una fila sin ambiente (anterior a la columna) cuenta como
     * ocupada: no se sabe de cual era. Una fila en vuelo (PENDIENTE_ENVIO,
     * ENVIO_INCIERTO) tambien: no esta en REINTENTABLES.
     * Mismos estados reintentables (EstadosEcf::REINTENTABLES) que
     * facturaModel::reservarFacturaECF, para que los dos chequeos no puedan
     * discrepar. Fail-open: ante un error de consulta devuelve false; la
     * reserva (SELECT ... FOR UPDATE) y la clave unica uk_e_ncf_amb siguen
     * siendo la red.
     */
```

In the body, replace (`:99-101`):

```php
            $reintentables = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'];
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $estado) {
                if (!in_array((string) $estado, $reintentables, true)) {
```

with:

```php
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $estado) {
                if (!in_array((string) $estado, EstadosEcf::REINTENTABLES, true)) {
```

The predicate (`:95-96`) and the fail-open `catch` (`:106-109`) stay. Then put the moved docblock right above `    private function resolveUbicaciones(array &$xmlData): void` (`:112`):

```php
    /**
     * Resuelve municipio/provincia de emisor y comprador al código DGII de 6
     * dígitos usando el catálogo. Fail-open: valores sin match quedan intactos.
     */
```

- [ ] **Step 6: `parseSecuenciaUtilizada`, `ctxSinXml` and `proyectarResultado`**

In `reclamarSecuenciaSiNoUtilizada`, replace (`:503-510`):

```php
        $utilizada = null;
        if (array_key_exists('secuenciaUtilizada', $receptionData)) {
            $utilizada = filter_var(
                $receptionData['secuenciaUtilizada'],
                FILTER_VALIDATE_BOOLEAN,
                FILTER_NULL_ON_FAILURE
            );
        }
```

with:

```php
        $utilizada = self::parseSecuenciaUtilizada($receptionData);
```

`$esRechazo = in_array($estado, ['RECHAZADO', 'NO_ENCONTRADO'], true);` (`:511`) stays, because the RFCE flow passes the base state.

Then add the block below right after the closing `}` of `reclamarSecuenciaSiNoUtilizada`. It goes before the `consultarEstado` docblock, whose `/**` is at `:529` and whose next line starts with `* $rncEmisor permite consultar`.

```php
    /**
     * Bandera secuenciaUtilizada de una respuesta de recepcion: true/false, o
     * null si no vino o no se entiende. Una sola lectura para el ctx de
     * 'confirmar' y para reclamarSecuenciaSiNoUtilizada.
     */
    private static function parseSecuenciaUtilizada(array $data): ?bool
    {
        $utilizada = null;
        if (array_key_exists('secuenciaUtilizada', $data)) {
            $utilizada = filter_var(
                $data['secuenciaUtilizada'],
                FILTER_VALIDATE_BOOLEAN,
                FILTER_NULL_ON_FAILURE
            );
        }
        return $utilizada;
    }

    /**
     * Copia del ctx sin los XML firmados (MEDIUMTEXT). Es lo unico que llega a
     * respuesta_dgii (TEXT), a la bitacora y al registro de cierre.
     */
    public static function ctxSinXml(array $ctx): array
    {
        unset($ctx['signed_xml'], $ctx['rfce_xml']);
        return $ctx;
    }

    /**
     * Lo que se sabe de la respuesta de la DGII, sin XML y con tope: siempre las
     * 8 claves de CLAVES_PROYECCION (null si faltan). Un dgii_response de texto
     * (cuerpo crudo de un 2xx sin JSON) se corta a MAX_RESPUESTA caracteres para
     * que nunca desborde respuesta_dgii TEXT. mb_substr: mbstring ya es
     * obligatorio en la emision (ECFXmlBuilder lo usa en cada e-CF).
     */
    public static function proyectarResultado(array $ctx): array
    {
        $r = [];
        foreach (self::CLAVES_PROYECCION as $clave) {
            $r[$clave] = $ctx[$clave] ?? null;
        }
        if ($r['dgii_response'] !== null && !is_array($r['dgii_response'])) {
            $r['dgii_response'] = mb_substr((string) $r['dgii_response'], 0, self::MAX_RESPUESTA);
        }
        return $r;
    }

```

- [ ] **Step 7: Run the tests**

```bash
php -l src/Utils/FacturacionElectronica/ECFEmissionService.php
php tools/test_write_ahead_puro.php
php tools/check_estado_dgii_ancho.php
```

Expected:
- `No syntax errors detected`.
- Section 8 prints 21 `[OK  ]` lines, the six `parseSecuenciaUtilizada(...)` cases included.
- The puro file ends with `N de N pruebas OK`, exit 0.
- The checker prints `32/32 OK`: `mapEstado` and the RFCE literal at `:433` are untouched.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Utils/FacturacionElectronica/ECFEmissionService.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
refactor(ecf): ECFEmissionService con inyeccion y proyecciones sin XML

- El constructor acepta auth, signer, recepcion y ncfModel (opcionales, mismos
  defaults); la recepcion por defecto usa el auth inyectado.
- eNcfYaUsado usa EstadosEcf::REINTENTABLES: RFCE_NO_ENCONTRADO pasa a ser
  reintentable y desaparece la copia de la lista.
- ctxSinXml y proyectarResultado (8 claves, texto cortado a 4000) son lo unico
  que llegara a respuesta_dgii y a la bitacora; parseSecuenciaUtilizada es la
  lectura unica de la bandera.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: ECFEmissionService: reserva antes de enviar (hook 'reservar')

All paths are relative to the API worktree. Line numbers of `ECFEmissionService.php` are those **after Task 11**. Re-read the file right before editing it.

**Files:**
- Modify: `src/Utils/FacturacionElectronica/ECFEmissionService.php`
  - requires `:9-14` (after Task 11: `EstadosEcf` at `:10`, `InformacionReferencia` at `:11`, `CertResolver` at `:12`);
  - `emitir` docblock `:148-155` and signature `:156`;
  - `$integration` at `:165` (the guard goes right after it);
  - comment and `try {` at `:346-350`;
  - `try` tail plus `catch` at `:370-390` (from `$signedXml = $this->signer->sign(` to the `}` that closes the `catch`);
  - the block after the `catch` at `:391-432` (`$bearerToken` down to the RFCE `sign`), which moves into the `try`.
- Create: `tools/test_write_ahead_ecf.php`.
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch`.

Re-pin: `CertResolver::resolve()` is at `src/CertResolver.php:23-56`, and its env fallback is at `:44-55` (not `:74-85`). It reads `DGII_ECF_CERT_PATH`/`DGII_ECF_CERT_PASSWORD` with `getenv` or `$_ENV`. When `FakeSigner` is injected, a test only needs a readable file and a non-empty password.

**Interfaces:**
- Consumes:
  - Task 11: the constructor `(?DgiiAuthService, ?DgiiXmlSigner, ?DgiiReceptionService, ?ncfModel)`, `ctxSinXml`.
  - Task 10: `DgiiReceptionService::assertSinCarriageReturn(string): void` (static).
  - Task 5: `EcfNumeroOcupadoException(string $eNcf, string $ambiente, string $causa, ?Throwable $previous = null)`.
  - Tasks 8 and 9, through the spy hook: `facturaModel::reservarFacturaECF(array $factura, array $ctx): array`, `confirmarFacturaECF(int $id, array $ctx): bool`, `marcarEnvioIncierto(int $id, array $ctx): bool`.
  - Task 6: `facturaModel::metaEnvio(?string): array`.
  - Task 2: `wa_usar_base`, `wa_sembrar` (`['client_id'=>int,'product_id'=>int]`), `wa_limpiar`, `wa_contador(PDO, 'E31')`, `wa_filas(PDO, string $eNcf)`. `wa_filas` returns the columns `id, e_ncf, no_factura, estado_dgii, track_id, secuencia_utilizada, tiene_xml, tiene_rfce, respuesta_dgii, ambiente_dgii`.
  - Task 1: `wa_chk`, `wa_fin`, `wa_arg`.
  - Existing: `AuditLogger::log(array): void` (`src/AuditLogger.php:55-96`, never throws), `Database::getInstance()->getConnection()`, `EcfItemMapper::normalizarCantidadPrecio/map/totales`.
- Produces:

```php
public function emitir(array $payload, ?callable $persistencia = null): array
// hook: callable(string $fase, array $ctx): mixed ; 'reservar' must return array{factura_id:int,e_ncf:string,desde:string}
// 'reservar' ctx (exactly these 13 keys, in this order):
// ['tipo_ecf'=>string,'e_ncf'=>string,'ambiente'=>string /* $tokenInfo['ambiente'] */,'ambiente_secuencia'=>string /* $ambienteEarly */,
//  'signed_xml'=>string,'codigo_seguridad'=>string,'fecha_emision_dgii'=>'Y-m-d H:i:s','flujo'=>'ECF'|'RFCE','rfce_xml'=>?string,
//  'dispensado'=>bool,'rango_id'=>?int,'secuencia_valor'=>?int /* null for an e_ncf override */,'desde'=>date('Y-m-d H:i:s')]
```

- Exceptions:
  - `InvalidArgumentException('write-ahead no aplica a integracion (sin DB de tenant)')`;
  - `RuntimeException('persistencia no devolvio factura_id')`;
  - `RuntimeException('persistencia dejo una transaccion abierta')`;
  - `RuntimeException('DGII bearer token is required.')` (token pre-flight).
- Log lines:
  - `[ECF e-NCF=%s factura_id=%d] reservado, enviando`;
  - `[ECF e-NCF=%s factura_id=%d] fila reservada sin enviar`;
  - `[ECF] e-NCF %s ocupado al reservar: la secuencia queda avanzada`.
- Audit: `NCF_SEQUENCE_UPDATE` with module `ncf`, entity `ncf_sequence`/e-NCF, `success=0`, `error_message` `'rollback sin coincidencia'` and `new_values` `{e_ncf, tipo_ecf, rango_id, secuencia_valor, ambiente_secuencia, causa}`.
- Test fakes and helpers in `tools/test_write_ahead_ecf.php`, reused by Tasks 13 and 14:
  - `final class Orden { public static array $pasos; }`: the hook appends `'reservar'|'confirmar'|'incierto'`, and `FakeNcf` appends `'rollback'`.
  - `FakeAuth extends DgiiAuthService`: `public int $llamadas`; `autenticar(array $options = []): array` → `['token'=>'tok-prueba','ambiente'=>'certecf']`.
  - `FakeSigner extends DgiiXmlSigner`: `public bool $conCr`. `sign()` inserts `<Signature><SignatureValue>QUJDREVGR0g=</SignatureValue></Signature>` before the closing root tag, plus `"\r"` when `$conCr` is set, so `codigo_seguridad` is `'QUJDRE'`.
  - `FakeReception extends DgiiReceptionService`:
    - constructor `__construct(DgiiAuthService $auth, public string $modo = 'acepta')`;
    - `public array $llamadas` (`[{metodo, e_ncf}]`);
    - `public ?Closure $espia`, called with `($metodo, $xml, $eNcf)` before answering;
    - `public ?Closure $reentrada`, used by mode `reentrar`;
    - modes: `acepta`; `rechaza` (HTTP 400 + `secuenciaUtilizada:false`); `no_encontrado_sin_flag`; `raw200`; `cuelga` (throws `RuntimeException('HTTP request failed: timeout')`); `html500` (throws `'DGII authenticated request failed: HTTP 500 - …'`, tag-free like `responseSummary`); `reentrar`; `fatal`;
    - the trackId is `'track-' . $eNcf`.
  - `FakeNcf extends ncfModel`: `public bool $falloDispense`, `public bool $rollbackFalso`, `public int $dispensas`, `public array $rollbacks`; both methods spy and delegate to the parent.
  - Helper functions:
    - `function emision(PDO $pdo, array $ids, string $tipo): array` → `['payload'=>…, 'factura'=>…]`;
    - `function gancho(facturaModel $m, array $factura, array &$fases, array &$ctxs, array $trucos = []): Closure`;
    - `function logNuevo(): string`;
    - `function correr(PDO $pdo, array $ids, array $op = []): array`, which returns the keys `res, err, fases, ctxs, e_ncf, delta, filas, total_filas, movimientos, orden, log, tx_abierta, auth, rec, ncf`;
    - `function chkComun(string $n, array $r): void`;
    - `const CLAVES_RESERVAR`.

- [ ] **Step 1: Write the failing test**

Create `tools/test_write_ahead_ecf.php`:

```php
<?php
/**
 * test_write_ahead_ecf.php — ECFEmissionService::emitir con el gancho de
 * persistencia (write-ahead), contra la base de prueba.
 *
 * Arma la emision como facturaController (payload + facturaInput) y le inyecta
 * dobles al servicio: FakeAuth (token fijo), FakeSigner (firma falsa, sin .p12),
 * FakeReception (respuestas de la DGII por modo, sin red) y FakeNcf (espia del
 * contador que delega en ncfModel). El gancho es el closure del controlador
 * (spec 4.7) sobre un facturaModel real, con registro de fases.
 *
 * Despues de cada escenario revisa el contador (ncf_sequences), las filas del
 * e-NCF, que no quede una transaccion abierta, que el servicio no mueva
 * inventario y que la recepcion no se haya llamado cuando no debia.
 *
 * Nunca toca produccion: wa_usar_base() se niega a usar una base sin la tabla
 * marca zz_write_ahead_scratch (decision 6).
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
 *   (sale con 1 si algo falla)
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/ECFEmissionService.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfItemMapper.php';
require_once __DIR__ . '/../src/Models/facturaModel.php';

$base = (string) wa_arg('tenant-db', '');
if ($base === '') {
    fwrite(STDERR, "Uso: php <flags> tools/test_write_ahead_ecf.php --tenant-db=<base de prueba>\n");
    exit(1);
}

// error_log a un archivo propio: cada escenario lee sus lineas con logNuevo().
$GLOBALS['wa_ecf_log'] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_ecf_' . getmypid() . '.log';
@unlink($GLOBALS['wa_ecf_log']);
ini_set('log_errors', '1');
ini_set('error_log', $GLOBALS['wa_ecf_log']);

// CertResolver::resolve() es estatico y sigue corriendo (CertResolver.php:44-55):
// cualquier archivo legible con una password no vacia basta, porque FakeSigner
// no abre el .p12. Las URL de la DGII apuntan al puerto 9 (discard): si algo se
// saltara los dobles, falla en vez de salir a la red. DGII_FC_BASE_URL se lee
// con getenv a secas (DgiiReceptionService.php:74), por eso va con putenv.
foreach ([
    'DGII_ECF_CERT_PATH' => __FILE__,
    'DGII_ECF_CERT_PASSWORD' => 'prueba',
    'DGII_ECF_BASE_URL' => 'http://127.0.0.1:9',
    'DGII_FC_BASE_URL' => 'http://127.0.0.1:9',
] as $clave => $valor) {
    putenv("{$clave}={$valor}");
    $_ENV[$clave] = $valor;
}

const CLAVES_RESERVAR = [
    'tipo_ecf', 'e_ncf', 'ambiente', 'ambiente_secuencia', 'signed_xml', 'codigo_seguridad',
    'fecha_emision_dgii', 'flujo', 'rfce_xml', 'dispensado', 'rango_id', 'secuencia_valor', 'desde',
];

/** Orden global de los pasos: el gancho anota reservar/confirmar/incierto y FakeNcf anota rollback. */
final class Orden
{
    public static array $pasos = [];
}

/** Token fijo: no pide semilla ni firma nada. */
final class FakeAuth extends DgiiAuthService
{
    public int $llamadas = 0;

    public function autenticar(array $options = []): array
    {
        $this->llamadas++;
        return ['token' => 'tok-prueba', 'ambiente' => 'certecf'];
    }
}

/**
 * Firma falsa: mete un <Signature> antes de la etiqueta de cierre, asi
 * extractCodigoSeguridad saca 'QUJDRE'. $conCr agrega un retorno de carro.
 */
final class FakeSigner extends DgiiXmlSigner
{
    public bool $conCr = false;

    public function sign(string $certificateContent, string $password, string $xmlContent): string
    {
        $firma = '<Signature><SignatureValue>QUJDREVGR0g=</SignatureValue></Signature>' . ($this->conCr ? "\r" : '');
        $pos = strrpos($xmlContent, '</');
        return $pos === false ? $xmlContent . $firma : substr_replace($xmlContent, $firma, $pos, 0);
    }
}

/**
 * La DGII por modo, sin red. Anota cada llamada; $espia corre antes de
 * responder (lee la base a mitad del envio); $reentrada es la emision anidada
 * del modo 'reentrar'.
 */
final class FakeReception extends DgiiReceptionService
{
    /** @var list<array{metodo:string, e_ncf:?string}> */
    public array $llamadas = [];
    public ?Closure $espia = null;
    public ?Closure $reentrada = null;

    public function __construct(DgiiAuthService $auth, public string $modo = 'acepta')
    {
        parent::__construct($auth);
    }

    public function recibir(string $signedXml, string $bearerToken, array $options = []): array
    {
        return $this->responder('recibir', $signedXml);
    }

    public function recibirResumen(string $signedXml, string $bearerToken, array $options = []): array
    {
        return $this->responder('recibirResumen', $signedXml);
    }

    private function responder(string $metodo, string $xml): array
    {
        $eNcf = preg_match('/<eNCF>(E[0-9]{12})<\/eNCF>/', $xml, $m) ? $m[1] : null;
        $this->llamadas[] = ['metodo' => $metodo, 'e_ncf' => $eNcf];
        if ($this->espia !== null) {
            ($this->espia)($metodo, $xml, $eNcf);
        }
        $track = 'track-' . $eNcf;
        switch ($this->modo) {
            case 'acepta':
                return $this->json(200, ['trackId' => $track, 'codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true]);
            case 'rechaza':
                // La DGII rechaza con 4xx + cuerpo estructurado (DgiiReceptionService.php:45-47).
                return $this->json(400, ['trackId' => $track, 'codigo' => 2, 'estado' => 'Rechazado', 'secuenciaUtilizada' => false]);
            case 'no_encontrado_sin_flag':
                return $this->json(200, ['codigo' => 0, 'estado' => 'No encontrado']);
            case 'raw200':
                // 2xx sin JSON: data es el cuerpo crudo (DgiiAuthService.php:150).
                return ['status_code' => 200, 'data' => 'Recibido', 'raw_body' => 'Recibido', 'endpoint' => 'fake://' . $metodo];
            case 'cuelga':
                throw new RuntimeException('HTTP request failed: timeout');
            case 'html500':
                // Como responseSummary (DgiiAuthService.php:538-546): sin etiquetas y con tope de 500.
                throw new RuntimeException('DGII authenticated request failed: HTTP 500 - '
                    . substr(str_repeat('Internal Server Error ', 30), 0, 500) . '...');
            case 'reentrar':
                ($this->reentrada)();
                return $this->json(200, ['trackId' => $track, 'codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true]);
            case 'fatal':
                // Fatal real (memoria agotada): ni catch ni finally corren, solo
                // las funciones de cierre.
                ini_set('memory_limit', '64M');
                str_repeat('x', 256 * 1024 * 1024);
                return $this->json(200, []);
        }
        throw new LogicException('FakeReception: modo desconocido ' . $this->modo);
    }

    private function json(int $status, array $data): array
    {
        return ['status_code' => $status, 'data' => $data, 'raw_body' => (string) json_encode($data), 'endpoint' => 'fake://recepcion'];
    }
}

/**
 * ncfModel real (base de prueba) con espias. El constructor heredado conecta
 * por Database::getInstance(), que wa_usar_base() ya apunto a la base de prueba.
 */
final class FakeNcf extends ncfModel
{
    public bool $falloDispense = false;
    public bool $rollbackFalso = false;
    public int $dispensas = 0;
    public array $rollbacks = [];

    public function dispenseNextECF(string $type, ?string $ambiente = null): ?array
    {
        $this->dispensas++;
        if ($this->falloDispense) {
            throw new RuntimeException('ncf_sequences inaccesible: test');
        }
        return parent::dispenseNextECF($type, $ambiente);
    }

    public function rollbackECFSequence(string $type, int $expectedValue, ?string $ambiente = null, ?int $rangoId = null): bool
    {
        $this->rollbacks[] = ['type' => $type, 'valor' => $expectedValue, 'ambiente' => $ambiente, 'rango_id' => $rangoId];
        Orden::$pasos[] = 'rollback';
        if ($this->rollbackFalso) {
            return false;
        }
        return parent::rollbackECFSequence($type, $expectedValue, $ambiente, $rangoId);
    }
}

/**
 * Emision como la arma facturaController::handleEmisionECF: items por
 * EcfItemMapper, totales, comprador del cliente sembrado y el $facturaInput con
 * las lineas que se guardan (una del producto sembrado y una libre).
 * @return array{payload: array, factura: array}
 */
function emision(PDO $pdo, array $ids, string $tipo): array
{
    $st = $pdo->prepare('SELECT client_name, rnc, razon_social FROM clients WHERE id = :id');
    $st->execute([':id' => $ids['client_id']]);
    $cli = $st->fetch(PDO::FETCH_ASSOC) ?: ['client_name' => 'WA cliente', 'rnc' => null, 'razon_social' => null];
    $crudos = EcfItemMapper::normalizarCantidadPrecio([
        ['product_id' => $ids['product_id'], 'nombre_item' => 'WA producto', 'cantidad' => 2, 'precio_unitario' => 1000,
         'indicador_facturacion' => 1, 'indicador_bien_servicio' => 1, 'unidad_medida' => '43'],
        ['product_id' => null, 'nombre_item' => 'WA servicio', 'cantidad' => 1, 'precio_unitario' => 100,
         'indicador_facturacion' => 1, 'indicador_bien_servicio' => 2, 'unidad_medida' => '43'],
    ]);
    $items = EcfItemMapper::map($crudos);
    $totales = EcfItemMapper::totales($crudos);
    $payload = [
        'tipo_ecf' => $tipo,
        'e_ncf' => null,
        'fecha_emision' => date('d-m-Y'),
        'tipo_ingresos' => '01',
        'tipo_pago' => 1,
        'indicador_monto_gravado' => '0',
        'ambiente' => null,
        'strict_input' => false,
        'comprador' => [
            'rnc' => $cli['rnc'],
            'razon_social' => (string) ($cli['razon_social'] ?? '') !== '' ? $cli['razon_social'] : $cli['client_name'],
        ],
        'items' => $items,
        'totales' => $totales,
        'informacion_referencia' => null,
    ];
    $factura = [
        'date' => date('Y-m-d H:i:s'),
        'client_id' => $ids['client_id'],
        'client_name' => $cli['client_name'],
        'total' => $totales['monto_total'],
        'tipo_pago' => 1,
        'user_id' => null,
        'informacion_referencia' => null,
        'items' => array_map(static fn(array $i): array => [
            'description' => $i['descripcion'] !== '' ? $i['descripcion'] : $i['nombre_item'],
            'amount' => $i['precio_unitario'],
            'quantity' => $i['cantidad'],
            'product_id' => $i['product_id'],
            'subtotal' => $i['monto_item'],
            'descuento_monto' => $i['descuento_monto'] ?? 0,
            'indicador_facturacion' => $i['indicador_facturacion'],
            'indicador_bien_servicio' => $i['indicador_bien_servicio'],
            'unidad_medida' => $i['unidad_medida'] ?? '43',
            'itbis_amount' => $i['itbis_amount'],
        ], $items),
    ];
    return ['payload' => $payload, 'factura' => $factura];
}

/**
 * El closure de facturaController (spec 4.7) sobre un facturaModel real, con
 * registro de fases. $trucos[fase] reemplaza la llamada normal de esa fase:
 * fn(array $ctx, facturaModel $m, array $factura): mixed.
 */
function gancho(facturaModel $m, array $factura, array &$fases, array &$ctxs, array $trucos = []): Closure
{
    $reserva = null;
    return function (string $fase, array $ctx) use ($m, $factura, &$fases, &$ctxs, $trucos, &$reserva) {
        $fases[] = $fase;
        $ctxs[$fase] = $ctx;
        Orden::$pasos[] = $fase;
        if (isset($trucos[$fase])) {
            $r = $trucos[$fase]($ctx, $m, $factura);
            if ($fase === 'reservar') {
                $reserva = is_array($r) ? $r : null;
            }
            return $r;
        }
        switch ($fase) {
            case 'reservar':
                return $reserva = $m->reservarFacturaECF($factura, $ctx);
            case 'confirmar':
                return $m->confirmarFacturaECF((int) $reserva['factura_id'], $ctx);
            case 'incierto':
                return $m->marcarEnvioIncierto((int) $reserva['factura_id'], $ctx);
        }
        return null;
    };
}

/** Lineas nuevas del error_log desde la ultima llamada. */
function logNuevo(): string
{
    static $leido = 0;
    clearstatcache();
    $todo = (string) @file_get_contents($GLOBALS['wa_ecf_log']);
    $nuevo = (string) substr($todo, $leido);
    $leido = strlen($todo);
    return $nuevo;
}

/**
 * Una emision con dobles frescos. Opciones: tipo ('31'), modo (FakeReception),
 * espia, trucos (del gancho), sin_gancho, con_cr, fallo_dispense,
 * rollback_falso, payload (claves que pisan las del payload), limpiar (true).
 */
function correr(PDO $pdo, array $ids, array $op = []): array
{
    if ($op['limpiar'] ?? true) {
        wa_limpiar($pdo);
    }
    Orden::$pasos = [];
    logNuevo();
    $tipo = $op['tipo'] ?? '31';
    $antes = wa_contador($pdo, 'E' . $tipo);
    $em = emision($pdo, $ids, $tipo);
    $auth = new FakeAuth();
    $signer = new FakeSigner();
    $signer->conCr = (bool) ($op['con_cr'] ?? false);
    $rec = new FakeReception($auth, $op['modo'] ?? 'acepta');
    $rec->espia = $op['espia'] ?? null;
    $ncf = new FakeNcf();
    $ncf->falloDispense = (bool) ($op['fallo_dispense'] ?? false);
    $ncf->rollbackFalso = (bool) ($op['rollback_falso'] ?? false);
    $fases = [];
    $ctxs = [];
    $hook = !empty($op['sin_gancho']) ? null : gancho(new facturaModel(), $em['factura'], $fases, $ctxs, $op['trucos'] ?? []);
    $res = null;
    $err = null;
    try {
        $res = (new ECFEmissionService($auth, $signer, $rec, $ncf))->emitir(($op['payload'] ?? []) + $em['payload'], $hook);
    } catch (Throwable $e) {
        $err = $e;
    }
    // Primero la transaccion: si quedo abierta se anota y se cierra ANTES de
    // contar, para que el conteo vea lo que de verdad quedo commiteado.
    $txAbierta = $pdo->inTransaction();
    if ($txAbierta) {
        $pdo->rollBack();
    }
    $eNcf = sprintf('E%s%010d', $tipo, $antes + 1);
    return [
        'res' => $res,
        'err' => $err,
        'fases' => $fases,
        'ctxs' => $ctxs,
        'e_ncf' => $eNcf,
        'delta' => wa_contador($pdo, 'E' . $tipo) - $antes,
        'filas' => wa_filas($pdo, $eNcf),
        'total_filas' => (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn(),
        'movimientos' => (int) $pdo->query('SELECT COUNT(*) FROM inventory_movements')->fetchColumn(),
        'orden' => Orden::$pasos,
        'log' => logNuevo(),
        'tx_abierta' => $txAbierta,
        'auth' => $auth,
        'rec' => $rec,
        'ncf' => $ncf,
    ];
}

/** Lo que vale para todo escenario: sin transaccion abierta y sin mover inventario. */
function chkComun(string $n, array $r): void
{
    wa_chk("{$n}: sin transaccion abierta al terminar", $r['tx_abierta'] === false);
    wa_chk("{$n}: el servicio no mueve inventario", $r['movimientos'] === 0, $r['movimientos']);
}

$pdo = wa_usar_base($base);
$ids = wa_sembrar($pdo);

// Payload de un tenant de integracion: trae su emisor y su e-NCF.
$integracion = [
    'integration' => true,
    'e_ncf' => 'E310000009999',
    'ambiente' => 'certecf',
    'emisor' => ['rnc' => '131000001', 'razon_social' => 'WA EMISOR INTEGRACION', 'direccion' => 'Calle de prueba 1'],
];

// ---------------------------------------------------------------------------
// 1) Reserva antes del envio (Task 12)
// ---------------------------------------------------------------------------
echo "\n== 1) Reserva antes del envio ==\n";

// R1 E31: el ctx 'reservar' y la fila ya commiteada cuando sale el envio.
$visto = null;
$r = correr($pdo, $ids, ['espia' => function (string $metodo, string $xml, ?string $eNcf) use ($pdo, &$visto): void {
    $st = $pdo->prepare('SELECT estado_dgii, xml_firmado, codigo_seguridad, rfce_xml, respuesta_dgii FROM facturas WHERE e_ncf = :e');
    $st->execute([':e' => (string) $eNcf]);
    $visto = ['metodo' => $metodo, 'xml' => $xml, 'fila' => $st->fetch(PDO::FETCH_ASSOC) ?: null];
}]);
$ctx = $r['ctxs']['reservar'] ?? [];
wa_chk('R1: emitir termina sin excepcion', $r['err'] === null, $r['err']?->getMessage());
wa_chk('R1: la primera fase es reservar', ($r['fases'][0] ?? null) === 'reservar', $r['fases']);
wa_chk('R1: ctx reservar trae exactamente las 13 claves, en orden', array_keys($ctx) === CLAVES_RESERVAR, array_keys($ctx));
wa_chk('R1: ctx con ambiente del token, ambiente de la secuencia y flujo ECF',
    ($ctx['ambiente'] ?? null) === 'certecf' && ($ctx['ambiente_secuencia'] ?? null) === 'certecf'
    && ($ctx['flujo'] ?? null) === 'ECF' && array_key_exists('rfce_xml', $ctx) && $ctx['rfce_xml'] === null, $ctx);
wa_chk('R1: ctx dispensado, rango_id y secuencia_valor del dispensador',
    ($ctx['dispensado'] ?? null) === true && is_int($ctx['rango_id'] ?? null) && ($ctx['secuencia_valor'] ?? null) === 1, $ctx);
wa_chk('R1: ctx e_ncf, codigo_seguridad y fechas Y-m-d H:i:s',
    ($ctx['e_ncf'] ?? null) === $r['e_ncf'] && ($ctx['codigo_seguridad'] ?? null) === 'QUJDRE'
    && (bool) preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) ($ctx['desde'] ?? ''))
    && (bool) preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) ($ctx['fecha_emision_dgii'] ?? '')), $ctx);
wa_chk('R1: al enviar, la fila ya existe en PENDIENTE_ENVIO', ($visto['fila']['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO', $visto['fila'] ?? null);
wa_chk('R1: al enviar, xml_firmado es el XML firmado del ctx y el que sale',
    isset($ctx['signed_xml']) && ($visto['fila']['xml_firmado'] ?? null) === $ctx['signed_xml'] && ($visto['xml'] ?? null) === $ctx['signed_xml']);
wa_chk('R1: al enviar, codigo_seguridad ya esta guardado', ($visto['fila']['codigo_seguridad'] ?? null) === 'QUJDRE', $visto['fila']['codigo_seguridad'] ?? null);
wa_chk('R1: contador +1', $r['delta'] === 1, $r['delta']);
wa_chk("R1: log 'reservado, enviando'", str_contains($r['log'], "[ECF e-NCF={$r['e_ncf']} factura_id=") && str_contains($r['log'], '] reservado, enviando'));
chkComun('R1', $r);

// R2 E32 < 250k: el RFCE firmado ya esta en la fila cuando sale.
$visto = null;
$r = correr($pdo, $ids, ['tipo' => '32', 'espia' => function (string $metodo, string $xml, ?string $eNcf) use ($pdo, &$visto): void {
    $st = $pdo->prepare('SELECT estado_dgii, rfce_xml, respuesta_dgii FROM facturas WHERE e_ncf = :e');
    $st->execute([':e' => (string) $eNcf]);
    $visto = ['metodo' => $metodo, 'xml' => $xml, 'fila' => $st->fetch(PDO::FETCH_ASSOC) ?: null];
}]);
wa_chk('R2: se envia por recibirResumen', ($r['rec']->llamadas[0]['metodo'] ?? null) === 'recibirResumen', $r['rec']->llamadas);
wa_chk('R2: al enviar, la fila guarda el RFCE firmado que sale',
    ($visto['fila']['rfce_xml'] ?? null) === ($visto['xml'] ?? 'x') && str_contains((string) ($visto['xml'] ?? ''), '<RFCE>'));
wa_chk('R2: al enviar, la meta de la reserva dice flujo RFCE',
    (facturaModel::metaEnvio($visto['fila']['respuesta_dgii'] ?? null)['flujo'] ?? null) === 'RFCE', $visto['fila']['respuesta_dgii'] ?? null);
wa_chk('R2: tiene_rfce = 1', (int) ($r['filas'][0]['tiene_rfce'] ?? 0) === 1, $r['filas']);
wa_chk('R2: ctx reservar con flujo RFCE y rfce_xml',
    ($r['ctxs']['reservar']['flujo'] ?? null) === 'RFCE' && is_string($r['ctxs']['reservar']['rfce_xml'] ?? null));
chkComun('R2', $r);

// R3 el gancho lanza en 'reservar': nada se envio, el numero vuelve.
$falla = new RuntimeException('falla de prueba en reservar');
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function () use ($falla) {
    throw $falla;
}]]);
wa_chk('R3: sale la misma excepcion', $r['err'] === $falla, $r['err']?->getMessage());
wa_chk('R3: contador sin cambio (devuelto)', $r['delta'] === 0, $r['delta']);
wa_chk('R3: sin fila', $r['total_filas'] === 0, $r['filas']);
wa_chk('R3: la recepcion no se llamo', $r['rec']->llamadas === [], $r['rec']->llamadas);
chkComun('R3', $r);

// R4 el gancho dice "ocupado": otra fila es duena, el numero NO vuelve.
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx) {
    throw new EcfNumeroOcupadoException((string) $ctx['e_ncf'], (string) $ctx['ambiente'], 'prueba');
}]]);
wa_chk('R4: sale EcfNumeroOcupadoException', $r['err'] instanceof EcfNumeroOcupadoException, $r['err'] ? get_class($r['err']) : null);
wa_chk('R4: contador +1 (no se devuelve)', $r['delta'] === 1, $r['delta']);
wa_chk('R4: no se intento devolver el numero', $r['ncf']->rollbacks === [], $r['ncf']->rollbacks);
wa_chk('R4: sin fila', $r['total_filas'] === 0);
wa_chk('R4: la recepcion no se llamo', $r['rec']->llamadas === []);
wa_chk("R4: log 'ocupado al reservar'", str_contains($r['log'], "[ECF] e-NCF {$r['e_ncf']} ocupado al reservar: la secuencia queda avanzada"));
chkComun('R4', $r);

// R5 CR en el XML firmado: falla el pre-vuelo, antes de autenticar.
$r = correr($pdo, $ids, ['con_cr' => true]);
wa_chk('R5: RuntimeException del pre-vuelo de CR',
    $r['err'] instanceof RuntimeException && str_contains($r['err']->getMessage(), 'retornos de carro'), $r['err']?->getMessage());
wa_chk('R5: contador sin cambio', $r['delta'] === 0, $r['delta']);
wa_chk('R5: sin fila', $r['total_filas'] === 0);
wa_chk('R5: el gancho nunca se llamo', $r['fases'] === [], $r['fases']);
wa_chk('R5: no se autentico', $r['auth']->llamadas === 0);
wa_chk('R5: la recepcion no se llamo', $r['rec']->llamadas === []);
chkComun('R5', $r);

// R6 integracion con gancho: se rechaza antes de tocar nada.
$r = correr($pdo, $ids, ['payload' => $integracion]);
wa_chk('R6: InvalidArgumentException',
    $r['err'] instanceof InvalidArgumentException
    && $r['err']->getMessage() === 'write-ahead no aplica a integracion (sin DB de tenant)', $r['err']?->getMessage());
wa_chk('R6: FakeAuth no se llamo', $r['auth']->llamadas === 0);
wa_chk('R6: FakeNcf no se llamo', $r['ncf']->dispensas === 0 && $r['ncf']->rollbacks === []);
wa_chk('R6: el gancho no se llamo', $r['fases'] === []);
chkComun('R6', $r);

// R7 ncf_sequences inaccesible: la excepcion del dispensador sale tal cual.
$r = correr($pdo, $ids, ['fallo_dispense' => true]);
wa_chk('R7: sale RuntimeException(ncf_sequences inaccesible: test)',
    $r['err'] instanceof RuntimeException && $r['err']->getMessage() === 'ncf_sequences inaccesible: test', $r['err']?->getMessage());
wa_chk('R7: sin fila', $r['total_filas'] === 0);
wa_chk('R7: ni gancho ni recepcion', $r['fases'] === [] && $r['rec']->llamadas === []);
wa_chk('R7: contador sin cambio', $r['delta'] === 0, $r['delta']);
chkComun('R7', $r);

// R8 el gancho commitea la reserva y deja OTRA transaccion abierta.
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx, facturaModel $m, array $factura) use ($pdo) {
    $reserva = $m->reservarFacturaECF($factura, $ctx);
    $pdo->beginTransaction();
    return $reserva;
}]]);
wa_chk("R8: RuntimeException('persistencia dejo una transaccion abierta')",
    $r['err'] instanceof RuntimeException && $r['err']->getMessage() === 'persistencia dejo una transaccion abierta', $r['err']?->getMessage());
wa_chk('R8: la fila sigue en PENDIENTE_ENVIO', count($r['filas']) === 1 && ($r['filas'][0]['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO', $r['filas']);
wa_chk('R8: contador +1 (la fila es duena del numero)', $r['delta'] === 1, $r['delta']);
wa_chk("R8: log 'fila reservada sin enviar'", str_contains($r['log'], 'fila reservada sin enviar'));
wa_chk('R8: la recepcion no se llamo', $r['rec']->llamadas === []);
chkComun('R8', $r);

// R9 el gancho inserta sin commitear y devuelve ese id: el rollback lo borra.
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx) use ($pdo) {
    $pdo->beginTransaction();
    $st = $pdo->prepare("INSERT INTO facturas (no_factura, client_name, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii)
                         VALUES (:no, 'WA sin commit', :tipo, :e, 'PENDIENTE_ENVIO', :amb)");
    $st->execute([':no' => $ctx['e_ncf'], ':tipo' => $ctx['tipo_ecf'], ':e' => $ctx['e_ncf'], ':amb' => $ctx['ambiente']]);
    return ['factura_id' => (int) $pdo->lastInsertId(), 'e_ncf' => $ctx['e_ncf'], 'desde' => $ctx['desde']];
}]]);
wa_chk("R9: RuntimeException('persistencia dejo una transaccion abierta')",
    $r['err'] instanceof RuntimeException && $r['err']->getMessage() === 'persistencia dejo una transaccion abierta', $r['err']?->getMessage());
wa_chk('R9: sin fila', $r['total_filas'] === 0, $r['filas']);
wa_chk('R9: contador sin cambio (devuelto)', $r['delta'] === 0, $r['delta']);
wa_chk("R9: sin log 'fila reservada sin enviar'", !str_contains($r['log'], 'fila reservada sin enviar'));
chkComun('R9', $r);

// R10 el gancho devuelve algo sin factura_id.
$r = correr($pdo, $ids, ['trucos' => ['reservar' => fn() => ['x' => 1]]]);
wa_chk("R10: RuntimeException('persistencia no devolvio factura_id')",
    $r['err'] instanceof RuntimeException && $r['err']->getMessage() === 'persistencia no devolvio factura_id', $r['err']?->getMessage());
wa_chk('R10: contador sin cambio (devuelto)', $r['delta'] === 0, $r['delta']);
wa_chk('R10: sin fila ni envio', $r['total_filas'] === 0 && $r['rec']->llamadas === []);
chkComun('R10', $r);

// R11 el gancho abre transaccion, inserta y lanza: el catch la cierra
// ANTES de devolver el numero (si no, la devolucion se perderia con ella).
$falla = new RuntimeException('falla de prueba con la transaccion abierta');
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx) use ($pdo, $falla) {
    $pdo->beginTransaction();
    $st = $pdo->prepare("INSERT INTO facturas (no_factura, client_name, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii)
                         VALUES (:no, 'WA sin commit', :tipo, :e, 'PENDIENTE_ENVIO', :amb)");
    $st->execute([':no' => $ctx['e_ncf'], ':tipo' => $ctx['tipo_ecf'], ':e' => $ctx['e_ncf'], ':amb' => $ctx['ambiente']]);
    throw $falla;
}]]);
wa_chk('R11: sale la misma excepcion', $r['err'] === $falla, $r['err']?->getMessage());
wa_chk('R11: sin fila', $r['total_filas'] === 0, $r['filas']);
wa_chk('R11: contador sin cambio (la devolucion no quedo dentro de la transaccion)', $r['delta'] === 0, $r['delta']);
chkComun('R11', $r);

// R12 = R3 con un rollback del contador que no coincide: queda en la bitacora.
$r = correr($pdo, $ids, ['rollback_falso' => true, 'trucos' => ['reservar' => function () {
    throw new RuntimeException('falla de prueba en reservar');
}]]);
$auditoria = $pdo->query("SELECT module, entity_type, entity_id, success, error_message, description, new_values
                          FROM audit_logs WHERE action = 'NCF_SEQUENCE_UPDATE'")->fetchAll(PDO::FETCH_ASSOC);
$a = $auditoria[0] ?? [];
$nuevos = json_decode((string) ($a['new_values'] ?? ''), true);
wa_chk('R12: exactamente una fila NCF_SEQUENCE_UPDATE', count($auditoria) === 1, $auditoria);
wa_chk('R12: success 0, modulo ncf, entity_type ncf_sequence, entity_id = e-NCF',
    (int) ($a['success'] ?? 1) === 0 && ($a['module'] ?? null) === 'ncf'
    && ($a['entity_type'] ?? null) === 'ncf_sequence' && ($a['entity_id'] ?? null) === $r['e_ncf'], $a);
wa_chk("R12: error_message 'rollback sin coincidencia' y la descripcion del spec",
    ($a['error_message'] ?? null) === 'rollback sin coincidencia'
    && ($a['description'] ?? null) === 'e-NCF consumido sin fila: no se pudo devolver a la secuencia.', $a);
wa_chk('R12: new_values con e_ncf, tipo_ecf, rango_id, secuencia_valor, ambiente_secuencia y causa',
    is_array($nuevos) && array_keys($nuevos) === ['e_ncf', 'tipo_ecf', 'rango_id', 'secuencia_valor', 'ambiente_secuencia', 'causa']
    && $nuevos['e_ncf'] === $r['e_ncf'] && $nuevos['tipo_ecf'] === '31' && is_int($nuevos['rango_id'])
    && $nuevos['secuencia_valor'] === 1 && $nuevos['ambiente_secuencia'] === 'certecf' && $nuevos['causa'] === 'RuntimeException', $nuevos);
wa_chk('R12: contador +1 (no se pudo devolver)', $r['delta'] === 1, $r['delta']);
chkComun('R12', $r);

// R13 integracion sin gancho y DGII colgada: la misma RuntimeException de siempre.
$r = correr($pdo, $ids, ['sin_gancho' => true, 'modo' => 'cuelga', 'payload' => $integracion]);
wa_chk("R13: RuntimeException('HTTP request failed: timeout'), clase exacta",
    $r['err'] !== null && get_class($r['err']) === RuntimeException::class && $r['err']->getMessage() === 'HTTP request failed: timeout',
    $r['err'] ? get_class($r['err']) . ': ' . $r['err']->getMessage() : null);
wa_chk('R13: se envio una vez', count($r['rec']->llamadas) === 1, $r['rec']->llamadas);
wa_chk('R13: ninguna fila ni movimiento de contador', $r['total_filas'] === 0 && $r['delta'] === 0, [$r['total_filas'], $r['delta']]);
chkComun('R13', $r);

wa_fin();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
php -l tools/test_write_ahead_ecf.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
```

Expected: `No syntax errors detected`, then `49 de 89 pruebas OK` and exit 1. `emitir()` still has one parameter, so the hook is ignored:
- the first failure is `[FALLO] R1: la primera fase es reservar` (`obtenido: []`);
- R1 sees no row while sending;
- R3, R4 and R10 never see their exception;
- R5 sends the CR instead of failing before `autenticar`.

- [ ] **Step 3: Requires**

In `src/Utils/FacturacionElectronica/ECFEmissionService.php`, replace (`:10-12`):

```php
require_once __DIR__ . '/EstadosEcf.php';
require_once __DIR__ . '/InformacionReferencia.php';
require_once __DIR__ . '/../../CertResolver.php';
```

with:

```php
require_once __DIR__ . '/EstadosEcf.php';
require_once __DIR__ . '/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/EcfEnvioInciertoException.php';
require_once __DIR__ . '/InformacionReferencia.php';
require_once __DIR__ . '/../../AuditLogger.php';
require_once __DIR__ . '/../../CertResolver.php';
require_once __DIR__ . '/../../Database.php';
```

Today `AuditLogger` only arrives through `DgiiAuthService.php:5` and `Database` through `ncfModel.php:2`. There is no autoloader.

- [ ] **Step 4: Docblock and signature**

Replace the `emitir` docblock, signature and opening brace (`:148-157`) with the block below. The range runs from the `    /**` above `@param array $payload` down to the `{` after `public function emitir(array $payload): array`.

```php
    /**
     * @param array $payload Required keys:
     *   tipo_ecf, comprador (assoc), items (array of assoc), totales (assoc).
     * @param callable|null $persistencia Gancho write-ahead,
     *   fn(string $fase, array $ctx): mixed. Sin el (integracion, gastos) la
     *   emision queda como antes. Con el:
     *   - 'reservar': ultima sentencia del try protegido, despues de autenticar.
     *       ctx: tipo_ecf, e_ncf, ambiente (el del token: el que guarda la fila),
     *       ambiente_secuencia (el del dispensador), signed_xml, codigo_seguridad,
     *       fecha_emision_dgii (Y-m-d H:i:s), flujo (ECF|RFCE), rfce_xml (?string),
     *       dispensado (bool), rango_id (?int), secuencia_valor (?int; null con
     *       un e_ncf override), desde (Y-m-d H:i:s del servidor).
     *       Tiene que COMMITEAR la fila (XML e items) y devolver
     *       ['factura_id' => int, 'e_ncf' => string, 'desde' => string], sin
     *       dejar una transaccion abierta.
     *   - 'confirmar': despues de mapEstado/extractTrackId y ANTES de reclamar
     *       la secuencia. ctx: lo de 'reservar' + reserva, estado (con RFCE_ en
     *       el flujo RFCE), track_id, dgii_response, dgii_status_code,
     *       rfce_track_id, rfce_estado, rfce_response, rfce_status_code,
     *       secuencia_utilizada (?bool). Devuelve bool: false = otra escritura
     *       ya movio la fila (CONFIRM_RACE: la secuencia no se toca).
     *   - 'incierto': lanzo el envio, el mapeo o 'confirmar', o el proceso murio
     *       con la fila en vuelo (registro de cierre). ctx: ctxSinXml(lo de
     *       'reservar') + reserva, fase_fallida (envio|confirmar|shutdown),
     *       clase, error (<= 2000 caracteres), resultado_parcial
     *       (proyectarResultado o null; el cierre no la manda). Devuelve bool:
     *       true = la fila quedo ENVIO_INCIERTO.
     * @return array {
     *   e_ncf, tipo_ecf, signed_xml, codigo_seguridad, track_id, estado,
     *   ambiente, fecha_emision_dgii, dgii_response, dgii_status_code,
     *   flujo (ECF|RFCE), factura_id (?int: la fila reservada; null sin gancho);
     *   en el flujo RFCE ademas: monto_total, rfce_xml, rfce_track_id,
     *   rfce_estado, rfce_response, rfce_status_code, aviso
     * }
     * @throws InvalidArgumentException integracion con gancho (no hay DB de tenant)
     * @throws EcfNumeroOcupadoException otra fila ya es duena del e-NCF: el
     *   contador queda avanzado y el reintento toma el siguiente
     * @throws EcfEnvioInciertoException con fila reservada, el envio o su
     *   confirmacion fallaron: la DGII puede tener el e-CF
     */
    public function emitir(array $payload, ?callable $persistencia = null): array
    {
```

- [ ] **Step 5: Integration guard (step 1 of spec 4.4)**

Replace (`:165-166`):

```php
        $integration = !empty($payload['integration']);
        if ($integration) {
```

with:

```php
        $integration = !empty($payload['integration']);
        if ($integration && $persistencia !== null) {
            // Un tenant de integracion no tiene DB propia: no hay donde reservar.
            throw new InvalidArgumentException('write-ahead no aplica a integracion (sin DB de tenant)');
        }
        if ($integration) {
```

The guard runs before any DGII contact, any dispense and any `emisor_config` read.

- [ ] **Step 6: Variables before the `try` (step 2)**

The four comment lines about `<Municipio>/<Provincia>` (`:342-345`) stay. Replace the next five lines (`:346-350`):

```php
        // Hasta recibir() nada de este e-CF sale hacia la DGII (autenticar solo
        // firma la semilla). Si armar, firmar o autenticar falla, el e-NCF que
        // dispensamos no se uso: se devuelve para que el proximo intento lo
        // reutilice en vez de dejar un hueco en el rango.
        try {
```

with:

```php
        // Hasta recibir() nada de este e-CF sale hacia la DGII (autenticar solo
        // firma la semilla). Si armar, firmar o autenticar falla, el e-NCF que
        // dispensamos no se uso: se devuelve para que el proximo intento lo
        // reutilice en vez de dejar un hueco en el rango.
        // Con $persistencia, la ULTIMA sentencia de este try es la reserva
        // ('reservar'): commitea la fila (XML firmado, RFCE, codigo de seguridad
        // e items) antes de cualquier envio. Desde ese commit la fila es duena
        // del numero y el catch ya no lo devuelve.
        $reserva = null;
        $signedRfce = null;
        $ctxReservar = null;
        $montoTotal = (float) ($payload['totales']['monto_total'] ?? 0);
        $usaRFCE = $tipoEcf === '32' && $montoTotal < self::RFCE_THRESHOLD;
        try {
```

`$montoTotal`/`$usaRFCE` are the two lines that sat after the `catch` (`:394-395`); Step 8 deletes them there. Integration totals are already final before this point (`:185-195`), so moving the two lines changes nothing.

- [ ] **Step 7: RFCE, pre-flights, reserve and the new `catch` (steps 3, 4 and 5)**

Replace the end of the `try` and the whole `catch` (`:370-390`). The range starts at:

```php
            $signedXml = $this->signer->sign($certContent, $certPassword, $unsignedXml);
```

and ends at the `        }` that closes `catch (Throwable $e) { ... throw $e; }`. The new text is:

```php
            $signedXml = $this->signer->sign($certContent, $certPassword, $unsignedXml);
            $codigoSeguridad = $this->extractCodigoSeguridad($signedXml);

            // RFCE (E32 < 250k): se arma y firma aqui, antes de enviar nada. Fuera
            // del try un fallo dejaba el numero consumido sin documento, y la
            // reserva necesita este XML para guardarlo en la fila.
            if ($usaRFCE) {
                $rfceEmisorOverride = is_array($payload['rfce_emisor_override'] ?? null) ? $payload['rfce_emisor_override'] : [];
                $rfceCompradorOverride = is_array($payload['rfce_comprador_override'] ?? null) ? $payload['rfce_comprador_override'] : [];

                $rfceEmisor = array_merge(
                    [
                        'rnc' => $emisorMerged['rnc'],
                        'razon_social' => $emisorMerged['razon_social'],
                    ],
                    array_filter($rfceEmisorOverride, fn($v) => $v !== null && $v !== '')
                );
                $rfceComprador = array_merge(
                    [
                        'rnc' => $payload['comprador']['rnc'] ?? null,
                        'identificador_extranjero' => $payload['comprador']['identificador_extranjero'] ?? null,
                        'razon_social' => $payload['comprador']['razon_social'] ?? null,
                    ],
                    array_filter($rfceCompradorOverride, fn($v) => $v !== null && $v !== '')
                );

                $rfceXmlData = [
                    'tipo_ecf' => '32',
                    'e_ncf' => $eNcf,
                    'tipo_ingresos' => $xmlData['tipo_ingresos'],
                    'tipo_pago' => $xmlData['tipo_pago'],
                    'formas_pago' => $payload['formas_pago'] ?? [],
                    'emisor' => $rfceEmisor,
                    'fecha_emision' => $xmlData['fecha_emision'],
                    'comprador' => $rfceComprador,
                    'totales' => $payload['totales'] ?? [],
                    'codigo_seguridad_ecf' => $codigoSeguridad,
                ];

                $unsignedRfce = $this->rfceBuilder->build($rfceXmlData);
                $signedRfce = $this->signer->sign($certContent, $certPassword, $unsignedRfce);
            }

            // Pre-vuelo del guard de CR: recibir()/recibirResumen() lo repiten,
            // pero ahi ya habria fila reservada. Aqui el numero todavia vuelve a
            // la secuencia.
            DgiiReceptionService::assertSinCarriageReturn($signedXml);
            if ($signedRfce !== null) {
                DgiiReceptionService::assertSinCarriageReturn($signedRfce);
            }

            // El mismo cert firma la semilla de autenticacion DGII.
            $tokenInfo = $this->auth->autenticar([
                'environment' => $payload['ambiente'] ?? null,
                'certificate_content' => $certContent,
                'certificate_password' => $certPassword,
            ]);
            // Pre-vuelo del token. normalizeTokenResponse solo rechaza un token
            // empty(): uno de puros espacios pasaria y normalizeBearerToken lo
            // rechazaria DENTRO de recibir(), con la fila ya reservada (un envio
            // "incierto" que nunca salio). Mismo texto que normalizeBearerToken,
            // para que los integradores lean lo de siempre.
            if (trim((string) ($tokenInfo['token'] ?? '')) === '') {
                throw new RuntimeException('DGII bearer token is required.');
            }
            // Dentro del try: la reserva guarda $ambiente (el del token).
            $bearerToken = $tokenInfo['token'];
            $ambiente = $tokenInfo['ambiente'];

            if ($persistencia !== null) {
                $ctxReservar = [
                    'tipo_ecf' => $tipoEcf,
                    'e_ncf' => $eNcf,
                    'ambiente' => (string) $ambiente,
                    'ambiente_secuencia' => (string) $ambienteEarly,
                    'signed_xml' => $signedXml,
                    'codigo_seguridad' => $codigoSeguridad,
                    'fecha_emision_dgii' => $fechaEmisionDgii,
                    'flujo' => $usaRFCE ? 'RFCE' : 'ECF',
                    'rfce_xml' => $signedRfce,
                    'dispensado' => $dispensamosSecuencia,
                    'rango_id' => $secuenciaRangoId !== null ? (int) $secuenciaRangoId : null,
                    'secuencia_valor' => $dispensamosSecuencia ? $secuenciaValor : null,
                    'desde' => date('Y-m-d H:i:s'),
                ];
                $reserva = $persistencia('reservar', $ctxReservar);
                $idReserva = is_array($reserva) ? (int) ($reserva['factura_id'] ?? 0) : 0;
                if ($idReserva <= 0) {
                    // Sin id no hay fila de la que fiarse: el catch devuelve el numero.
                    $reserva = null;
                    throw new RuntimeException('persistencia no devolvio factura_id');
                }
                $conexion = Database::getInstance()->getConnection();
                if ($conexion->inTransaction()) {
                    // El gancho se porto mal: se cierra la transaccion y se mira si
                    // la fila sobrevivio. Si no, la transaccion abierta ERA la
                    // reserva: nadie es dueno del numero y el catch lo devuelve.
                    $conexion->rollBack();
                    $st = $conexion->prepare('SELECT 1 FROM facturas WHERE id = :id');
                    $st->execute([':id' => $idReserva]);
                    if ($st->fetchColumn() === false) {
                        $reserva = null;
                    }
                    throw new RuntimeException('persistencia dejo una transaccion abierta');
                }
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $idReserva));
            }
        } catch (Throwable $e) {
            // Un gancho que lanzo con su transaccion abierta: sin este rollBack el
            // UPDATE que devuelve el numero correria DENTRO de ella y se perderia
            // al terminar la peticion (numero quemado sin rastro).
            if ($persistencia !== null) {
                try {
                    $conexion = Database::getInstance()->getConnection();
                    if ($conexion->inTransaction()) {
                        $conexion->rollBack();
                    }
                } catch (Throwable) {
                }
            }
            if ($reserva !== null) {
                // La fila ya esta commiteada y es duena del numero: no se devuelve.
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] fila reservada sin enviar', $eNcf, (int) $reserva['factura_id']));
                throw $e;
            }
            if ($e instanceof EcfNumeroOcupadoException) {
                // Otra fila ya tiene el numero: devolverlo lo repartiria otra vez.
                error_log(sprintf('[ECF] e-NCF %s ocupado al reservar: la secuencia queda avanzada', $eNcf));
                throw $e;
            }
            if ($dispensamosSecuencia) {
                $devuelto = $this->ncfModel()->rollbackECFSequence(
                    $secuenciaType, $secuenciaValor, $ambienteEarly, $secuenciaRangoId
                );
                error_log(sprintf(
                    '[ECF] fallo antes de enviar a DGII (%s): e-NCF %s %s',
                    get_class($e), $eNcf, $devuelto ? 'devuelto a la secuencia' : 'no se pudo devolver (rollback sin coincidencia)'
                ));
                if (!$devuelto) {
                    // Numero consumido sin fila que lo explique: queda en la bitacora.
                    AuditLogger::log([
                        'module' => 'ncf',
                        'action' => 'NCF_SEQUENCE_UPDATE',
                        'entity_type' => 'ncf_sequence',
                        'entity_id' => $eNcf,
                        'success' => false,
                        'error_message' => 'rollback sin coincidencia',
                        'new_values' => [
                            'e_ncf' => $eNcf,
                            'tipo_ecf' => $tipoEcf,
                            'rango_id' => $secuenciaRangoId,
                            'secuencia_valor' => $secuenciaValor,
                            'ambiente_secuencia' => $ambienteEarly,
                            'causa' => get_class($e),
                        ],
                        'description' => 'e-NCF consumido sin fila: no se pudo devolver a la secuencia.',
                    ]);
                }
            }
            throw $e;
        }
```

What this block does, in order:
- The RFCE data/build/sign block is moved verbatim from the old `:397-431`. An RFCE build or sign failure now returns the number (section 5, row 6).
- The CR pre-flight runs on both signed XMLs.
- `autenticar` is unchanged; the token pre-flight follows it (D9). `normalizeTokenResponse` accepts a whitespace-only token (`DgiiAuthService.php:503-507`), which `normalizeBearerToken` would refuse inside `recibir` (`:221-234`).
- `$bearerToken`/`$ambiente` are set inside the `try` (D1), because the reserve needs the token's ambiente.
- The 13-key `'reservar'` ctx is built. Then come the D4 check on the returned `factura_id` and the open-transaction assertion keyed on that id.
- The `catch` handles four things:
  - the D2 rollback of a transaction the hook left open (only with a hook, since an integration tenant has no tenant DB);
  - "a row owns the number";
  - "occupied";
  - the `NCF_SEQUENCE_UPDATE success=0` audit when `rollbackECFSequence` returns false.

- [ ] **Step 8: Delete the code that moved into the `try`**

Right after the `catch` you just wrote, the file still has the old lines `:391-432`: from `        $bearerToken = $tokenInfo['token'];` down to `            $signedRfce = $this->signer->sign($certContent, $certPassword, $unsignedRfce);`, plus the blank line after it. Delete them but keep the `if ($usaRFCE) {` line, so the send code reads:

```php
            throw $e;
        }

        if ($usaRFCE) {
            $rfceReception = $this->reception->recibirResumen($signedRfce, $bearerToken, [
                'environment' => $ambiente,
            ]);
```

Everything from `$rfceReception` to the end of `emitir()` is unchanged in this task. The RFCE branch sends the `$signedRfce` built inside the `try`, and its return keeps `'rfce_xml' => $signedRfce` and the literal `'estado' => 'RFCE_' . $rfceEstado`.

- [ ] **Step 9: Run the tests**

```bash
php -l src/Utils/FacturacionElectronica/ECFEmissionService.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
php tools/test_write_ahead_puro.php
php tools/check_estado_dgii_ancho.php
```

Expected:
- `No syntax errors detected`;
- `89 de 89 pruebas OK`, exit 0;
- the puro file still ends with `N de N pruebas OK`;
- the checker still prints `32/32 OK`.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Utils/FacturacionElectronica/ECFEmissionService.php tools/test_write_ahead_ecf.php
git commit -F - <<'EOF'
feat(ecf): emitir reserva la fila antes de enviar a la DGII

- emitir(array $payload, ?callable $persistencia): con gancho, la ultima
  sentencia del try protegido es 'reservar', que commitea la fila (XML,
  RFCE, codigo de seguridad, items) antes de cualquier envio.
- El RFCE se arma y firma dentro del try; pre-vuelos de CR y de token antes
  de reservar: esos fallos devuelven el numero en vez de quemarlo.
- Se valida el factura_id devuelto y que el gancho no deje una transaccion
  abierta; el catch cierra una transaccion colgada antes de devolver el
  numero, no lo devuelve si una fila ya es duena u otra fila lo ocupa, y
  audita NCF_SEQUENCE_UPDATE success=0 si no pudo devolverlo.
- Integracion con gancho: InvalidArgumentException; sin gancho, todo igual.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: ECFEmissionService: confirmar o marcar incierto tras el envio

All paths are relative to the API worktree. Line numbers of `ECFEmissionService.php` are those **after Task 12**. Re-read the file right before editing it.

**Files:**
- Modify: `src/Utils/FacturacionElectronica/ECFEmissionService.php`: the send code at `:581-644`.
  - It runs from `        if ($usaRFCE) {` (the line after the pre-send `catch`) down to the `        ];` that closes the e-CF return. The next line, `    }`, closes `emitir()`.
  - RFCE part: send `:582-584`, map `:586-587`, reclaim `:589-594`, return `:596-615`.
  - e-CF part: send `:618-620`, map `:622-623`, reclaim `:625-630`, return `:632-644`.
- Modify: `tools/test_write_ahead_ecf.php`: add section 2 right before the final `wa_fin();`.
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch`.

**Interfaces:**
- Consumes:
  - Task 12: `$ctxReservar`, `$reserva`, `$ambiente`, `$persistencia`, `$signedRfce`, and the test helpers (`correr`, `chkComun`, `CLAVES_RESERVAR`, `Orden`, the fakes).
  - Task 11: `ctxSinXml`, `proyectarResultado`, `parseSecuenciaUtilizada`.
  - Task 5: `EcfEnvioInciertoException(string $eNcf, int $facturaId, string $ambiente, string $faseFallida, ?array $resultadoParcial, bool $marcado, ?Throwable $previous = null)`, with readonly `eNcf`, `facturaId`, `ambiente`, `faseFallida`, `resultadoParcial`, `marcado`.
  - Task 9, through the spy hook: `confirmarFacturaECF`, `marcarEnvioIncierto`.
  - Task 6: `facturaModel::metaEnvio`.
- Produces:
  - **'confirmar' ctx** = the 13 `'reservar'` keys plus, in this order:

    ```
    ['reserva'=>array{factura_id,e_ncf,desde},'estado'=>string,'track_id'=>?string,'dgii_response'=>mixed,'dgii_status_code'=>?int,
     'rfce_track_id'=>?string,'rfce_estado'=>?string,'rfce_response'=>mixed,'rfce_status_code'=>?int,'secuencia_utilizada'=>?bool]
    ```

    For RFCE, `estado` = `'RFCE_' . $rfceEstado` and `track_id`/`dgii_response`/`dgii_status_code` are null. For e-CF, the four `rfce_*` keys are null.
  - **'incierto' ctx** = `ctxSinXml(reservar ctx)` plus `['reserva'=>…,'fase_fallida'=>'envio'|'confirmar','clase'=>string,'error'=>string /* mb_substr ≤ 2000 */,'resultado_parcial'=>?array /* 8 keys */]`.
  - `emitir` throws `EcfEnvioInciertoException` only when a hook and a reserve exist. Otherwise it throws the original Throwable, so integration and gastos are unchanged.
  - The returns keep today's keys plus `'factura_id' => ?int` (`$reserva['factura_id'] ?? null`).
  - Log lines:
    - `[ECF e-NCF=%s factura_id=%d] ENVIO_INCIERTO fase=%s marcado=%s estado=%s track_id=%s %s: %s`;
    - `[ECF e-NCF=… factura_id=…] marcar incierto fallo: …`;
    - `[ECF e-NCF=%s factura_id=%d] CONFIRM_RACE: otra escritura movio la fila; no se toca la secuencia`.
  - Test helpers for Task 14: `function chkEnVuelo(string $n, array $f, string $faseFallida): void`, `const CLAVES_INCIERTO`, `const CLAVES_CONFIRMAR`, `const CLAVES_PROYECCION`.

- [ ] **Step 1: Write the failing scenarios (section 2)**

Insert the block below in `tools/test_write_ahead_ecf.php` right before its final `wa_fin();`. The `respuesta_dgii` assertions follow resolved decision 15:
- the 6.3 shape, the size limit and the no-XML rule apply to rows still in flight;
- a confirmed row holds what `confirmarFacturaECF` wrote: the JSON of the e-CF answer, `'"Recibido"'` for `raw200`, or NULL for RFCE.

```php
// ---------------------------------------------------------------------------
// 2) Confirmar o marcar incierto tras el envio (Task 13)
// respuesta_dgii: las filas en vuelo llevan la meta 6.3, sin XML y bajo
// 64 KB; una fila confirmada lleva lo que escribio confirmarFacturaECF: el
// JSON de la respuesta (e-CF), el JSON del texto crudo (raw200) o NULL (RFCE).
// ---------------------------------------------------------------------------
echo "\n== 2) Confirmar o marcar incierto ==\n";

const CLAVES_CONFIRMAR = [
    'reserva', 'estado', 'track_id', 'dgii_response', 'dgii_status_code',
    'rfce_track_id', 'rfce_estado', 'rfce_response', 'rfce_status_code', 'secuencia_utilizada',
];
const CLAVES_INCIERTO = [
    'fase', 'desde', 'flujo', 'ambiente_secuencia', 'dispensado', 'rango_id', 'secuencia_valor',
    'fase_fallida', 'clase', 'error', 'resultado_parcial', 'intentos',
];
const CLAVES_PROYECCION = [
    'estado', 'track_id', 'dgii_status_code', 'dgii_response', 'rfce_estado', 'rfce_track_id', 'rfce_status_code', 'secuencia_utilizada',
];

/** Una fila en vuelo: respuesta_dgii con la meta 6.3, sin XML y bajo TEXT. */
function chkEnVuelo(string $n, array $f, string $faseFallida): void
{
    $resp = (string) ($f['respuesta_dgii'] ?? '');
    $meta = json_decode($resp, true);
    wa_chk("{$n}: respuesta_dgii trae las claves de 6.3, en orden",
        is_array($meta) && array_keys($meta) === CLAVES_INCIERTO, is_array($meta) ? array_keys($meta) : $resp);
    wa_chk("{$n}: fase ENVIO_INCIERTO, fase_fallida {$faseFallida}, intentos 0",
        ($meta['fase'] ?? null) === 'ENVIO_INCIERTO' && ($meta['fase_fallida'] ?? null) === $faseFallida && ($meta['intentos'] ?? null) === 0, $meta);
    wa_chk("{$n}: respuesta_dgii bajo 65535 bytes", strlen($resp) < 65535, strlen($resp));
    wa_chk("{$n}: respuesta_dgii sin XML",
        !str_contains($resp, '<') && !str_contains($resp, 'signed_xml') && !str_contains($resp, 'rfce_xml') && !str_contains($resp, 'xml_firmado'));
}

// C1 acepta E31: fila final ANTES del contador, factura_id en la respuesta.
$r = correr($pdo, $ids);
$f = $r['filas'][0] ?? [];
wa_chk('C1: fases [reservar, confirmar]', $r['fases'] === ['reservar', 'confirmar'], $r['fases']);
wa_chk('C1: ctx confirmar = las 13 de reservar + reserva + las de confirmar, en orden',
    array_keys($r['ctxs']['confirmar'] ?? []) === array_merge(CLAVES_RESERVAR, CLAVES_CONFIRMAR), array_keys($r['ctxs']['confirmar'] ?? []));
wa_chk('C1: ctx confirmar con estado, track_id y secuencia_utilizada true',
    ($r['ctxs']['confirmar']['estado'] ?? null) === 'ACEPTADO' && ($r['ctxs']['confirmar']['track_id'] ?? null) === 'track-' . $r['e_ncf']
    && ($r['ctxs']['confirmar']['secuencia_utilizada'] ?? null) === true, $r['ctxs']['confirmar'] ?? null);
wa_chk('C1: una fila ACEPTADO con track_id', count($r['filas']) === 1 && ($f['estado_dgii'] ?? null) === 'ACEPTADO'
    && ($f['track_id'] ?? null) === 'track-' . $r['e_ncf'], $r['filas']);
wa_chk('C1: secuencia_utilizada = 1', (string) ($f['secuencia_utilizada'] ?? '') === '1', $f['secuencia_utilizada'] ?? null);
wa_chk('C1: respuesta_dgii es el JSON de la respuesta de la DGII',
    json_decode((string) ($f['respuesta_dgii'] ?? ''), true) === ['trackId' => 'track-' . $r['e_ncf'], 'codigo' => 1, 'estado' => 'Aceptado', 'secuenciaUtilizada' => true],
    $f['respuesta_dgii'] ?? null);
wa_chk('C1: contador +1', $r['delta'] === 1, $r['delta']);
wa_chk('C1: emitir devuelve factura_id = id de la fila', ($r['res']['factura_id'] ?? null) === (int) ($f['id'] ?? 0), $r['res']['factura_id'] ?? null);
chkComun('C1', $r);

// C2 rechaza: la fila queda RECHAZADO antes de devolver el numero; el reintento lo reusa.
$r = correr($pdo, $ids, ['modo' => 'rechaza']);
$iConfirmar = array_search('confirmar', $r['orden'], true);
$iRollback = array_search('rollback', $r['orden'], true);
wa_chk("C2: 'confirmar' antes que el rollback del contador",
    $iConfirmar !== false && $iRollback !== false && $iConfirmar < $iRollback, $r['orden']);
wa_chk('C2: fila RECHAZADO', count($r['filas']) === 1 && ($r['filas'][0]['estado_dgii'] ?? null) === 'RECHAZADO', $r['filas']);
wa_chk('C2: contador devuelto (delta 0)', $r['delta'] === 0, $r['delta']);
chkComun('C2', $r);
$primerId = (int) ($r['filas'][0]['id'] ?? 0);
$r2 = correr($pdo, $ids, ['limpiar' => false, 'modo' => 'acepta']);
$porId = array_column($r2['filas'], null, 'id');
wa_chk('C2: el reintento toma el mismo e-NCF', ($r2['ctxs']['reservar']['e_ncf'] ?? null) === $r['e_ncf'], $r2['ctxs']['reservar']['e_ncf'] ?? null);
wa_chk('C2: la primera fila queda RECHAZADO_ARCHIVADO con e_ncf NULL',
    ($porId[$primerId]['estado_dgii'] ?? null) === 'RECHAZADO_ARCHIVADO' && array_key_exists('e_ncf', $porId[$primerId] ?? [])
    && $porId[$primerId]['e_ncf'] === null, $r2['filas']);
wa_chk('C2: y hay una fila nueva ACEPTADO', count($r2['filas']) === 2 && (end($r2['filas'])['estado_dgii'] ?? null) === 'ACEPTADO', $r2['filas']);
chkComun('C2 reintento', $r2);

// C3 cuelga y html500: ENVIO_INCIERTO, contador intacto, excepcion con la fila.
foreach (['cuelga' => 'HTTP request failed: timeout', 'html500' => 'DGII authenticated request failed: HTTP 500'] as $modo => $prefijo) {
    $r = correr($pdo, $ids, ['modo' => $modo]);
    $e = $r['err'];
    $f = $r['filas'][0] ?? [];
    wa_chk("C3 {$modo}: sale EcfEnvioInciertoException", $e instanceof EcfEnvioInciertoException, $e ? get_class($e) . ': ' . $e->getMessage() : null);
    if ($e instanceof EcfEnvioInciertoException) {
        wa_chk("C3 {$modo}: facturaId = la fila, e-NCF y ambiente",
            $e->facturaId === (int) ($f['id'] ?? 0) && $e->eNcf === $r['e_ncf'] && $e->ambiente === 'certecf', [$e->facturaId, $e->eNcf, $e->ambiente]);
        wa_chk("C3 {$modo}: faseFallida envio, marcado true, resultadoParcial null",
            $e->faseFallida === 'envio' && $e->marcado === true && $e->resultadoParcial === null);
        wa_chk("C3 {$modo}: getPrevious es la excepcion original",
            $e->getPrevious() instanceof RuntimeException && str_starts_with($e->getPrevious()->getMessage(), $prefijo), $e->getPrevious()?->getMessage());
    }
    wa_chk("C3 {$modo}: fases [reservar, incierto]", $r['fases'] === ['reservar', 'incierto'], $r['fases']);
    wa_chk("C3 {$modo}: fila ENVIO_INCIERTO", count($r['filas']) === 1 && ($f['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $r['filas']);
    wa_chk("C3 {$modo}: contador +1 y sin rollback", $r['delta'] === 1 && !in_array('rollback', $r['orden'], true), [$r['delta'], $r['orden']]);
    wa_chk("C3 {$modo}: log ENVIO_INCIERTO", str_contains($r['log'], 'ENVIO_INCIERTO fase=envio marcado=si'));
    chkEnVuelo("C3 {$modo}", $f, 'envio');
    chkComun("C3 {$modo}", $r);
}

// C4 raw200: ENVIADO sin track_id; respuesta_dgii guarda el texto crudo como JSON.
$r = correr($pdo, $ids, ['modo' => 'raw200']);
$f = $r['filas'][0] ?? [];
wa_chk('C4: fila ENVIADO con track_id NULL', ($f['estado_dgii'] ?? null) === 'ENVIADO' && array_key_exists('track_id', $f) && $f['track_id'] === null, $f);
wa_chk('C4: respuesta_dgii = \'"Recibido"\'', ($f['respuesta_dgii'] ?? null) === '"Recibido"', $f['respuesta_dgii'] ?? null);
chkComun('C4', $r);

// C5 el gancho lanza en 'confirmar': la respuesta de la DGII queda en resultado_parcial.
$r = correr($pdo, $ids, ['trucos' => ['confirmar' => function () {
    throw new RuntimeException('base caida al confirmar');
}]]);
$e = $r['err'];
$f = $r['filas'][0] ?? [];
wa_chk('C5: EcfEnvioInciertoException con faseFallida confirmar',
    $e instanceof EcfEnvioInciertoException && $e->faseFallida === 'confirmar' && $e->marcado === true, $e?->getMessage());
wa_chk('C5: resultadoParcial con las 8 claves y el track_id de la DGII',
    $e instanceof EcfEnvioInciertoException && is_array($e->resultadoParcial) && array_keys($e->resultadoParcial) === CLAVES_PROYECCION
    && $e->resultadoParcial['track_id'] === 'track-' . $r['e_ncf'] && $e->resultadoParcial['estado'] === 'ACEPTADO',
    $e instanceof EcfEnvioInciertoException ? $e->resultadoParcial : null);
$meta = facturaModel::metaEnvio($f['respuesta_dgii'] ?? null);
wa_chk('C5: la fila guarda resultado_parcial.track_id', ($meta['resultado_parcial']['track_id'] ?? null) === 'track-' . $r['e_ncf'], $meta);
wa_chk('C5: contador +1 (sin reclamar)', $r['delta'] === 1 && !in_array('rollback', $r['orden'], true), $r['delta']);
chkEnVuelo('C5', $f, 'confirmar');
chkComun('C5', $r);

// C6 'confirmar' devuelve false (otra escritura movio la fila): no se reclama.
$r = correr($pdo, $ids, ['modo' => 'rechaza', 'trucos' => ['confirmar' => fn() => false]]);
wa_chk('C6: emitir termina sin excepcion', $r['err'] === null, $r['err']?->getMessage());
wa_chk("C6: log CONFIRM_RACE", str_contains($r['log'], "[ECF e-NCF={$r['e_ncf']} factura_id=") && str_contains($r['log'], 'CONFIRM_RACE: otra escritura movio la fila; no se toca la secuencia'));
wa_chk('C6: no se llamo rollbackECFSequence', $r['ncf']->rollbacks === [], $r['ncf']->rollbacks);
wa_chk('C6: contador +1', $r['delta'] === 1, $r['delta']);
chkComun('C6', $r);

// C7 'incierto' tambien falla: la fila queda PENDIENTE_ENVIO y marcado false.
$r = correr($pdo, $ids, ['modo' => 'cuelga', 'trucos' => ['incierto' => function () {
    throw new RuntimeException('base caida al marcar');
}]]);
$e = $r['err'];
wa_chk('C7: EcfEnvioInciertoException con marcado false', $e instanceof EcfEnvioInciertoException && $e->marcado === false, $e?->getMessage());
wa_chk('C7: la fila sigue PENDIENTE_ENVIO', ($r['filas'][0]['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO', $r['filas']);
wa_chk("C7: log 'marcar incierto fallo' y marcado=no",
    str_contains($r['log'], 'marcar incierto fallo: base caida al marcar') && str_contains($r['log'], 'marcado=no'));
chkComun('C7', $r);

// C8 E32 < 250k acepta: RFCE_ACEPTADO con rfce_track_id.
$r = correr($pdo, $ids, ['tipo' => '32']);
$f = $r['filas'][0] ?? [];
$st = $pdo->prepare('SELECT rfce_track_id, rfce_estado FROM facturas WHERE id = :id');
$st->execute([':id' => (int) ($f['id'] ?? 0)]);
$rfce = $st->fetch(PDO::FETCH_ASSOC) ?: [];
wa_chk('C8: fila RFCE_ACEPTADO', ($f['estado_dgii'] ?? null) === 'RFCE_ACEPTADO', $f);
wa_chk('C8: rfce_track_id y rfce_estado guardados',
    ($rfce['rfce_track_id'] ?? null) === 'track-' . $r['e_ncf'] && ($rfce['rfce_estado'] ?? null) === 'ACEPTADO', $rfce);
wa_chk('C8: respuesta_dgii NULL en el flujo RFCE', array_key_exists('respuesta_dgii', $f) && $f['respuesta_dgii'] === null, $f['respuesta_dgii'] ?? null);
wa_chk('C8: emitir devuelve estado RFCE_ACEPTADO y factura_id',
    ($r['res']['estado'] ?? null) === 'RFCE_ACEPTADO' && ($r['res']['factura_id'] ?? null) === (int) ($f['id'] ?? 0), $r['res'] ?? null);
chkComun('C8', $r);

// C9 E32 < 250k NO_ENCONTRADO sin bandera: reintentable (REINTENTABLES).
$r = correr($pdo, $ids, ['tipo' => '32', 'modo' => 'no_encontrado_sin_flag']);
$iConfirmar = array_search('confirmar', $r['orden'], true);
$iRollback = array_search('rollback', $r['orden'], true);
wa_chk('C9: fila RFCE_NO_ENCONTRADO', ($r['filas'][0]['estado_dgii'] ?? null) === 'RFCE_NO_ENCONTRADO', $r['filas']);
wa_chk("C9: 'confirmar' antes que el rollback", $iConfirmar !== false && $iRollback !== false && $iConfirmar < $iRollback, $r['orden']);
wa_chk('C9: contador devuelto (delta 0)', $r['delta'] === 0, $r['delta']);
chkComun('C9', $r);
$primerId = (int) ($r['filas'][0]['id'] ?? 0);
$r2 = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false]);
$porId = array_column($r2['filas'], null, 'id');
wa_chk('C9: el reintento archiva RFCE_NO_ENCONTRADO_ARCHIVADO con e_ncf NULL',
    ($porId[$primerId]['estado_dgii'] ?? null) === 'RFCE_NO_ENCONTRADO_ARCHIVADO' && array_key_exists('e_ncf', $porId[$primerId] ?? [])
    && $porId[$primerId]['e_ncf'] === null, $r2['filas']);
wa_chk('C9: y hay una fila nueva RFCE_ACEPTADO', count($r2['filas']) === 2 && (end($r2['filas'])['estado_dgii'] ?? null) === 'RFCE_ACEPTADO', $r2['filas']);
chkComun('C9 reintento', $r2);
```

- [ ] **Step 2: Run it and watch section 2 fail**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
```

Expected:
- Section 1 stays all `[OK  ]`.
- Section 2 starts with `[FALLO] C1: fases [reservar, confirmar]` and `obtenido: ["reservar"]`, and C1's row is still `PENDIENTE_ENVIO`.
- C3 gets the raw `RuntimeException`, not `EcfEnvioInciertoException`.
- The run ends with `127 de 171 pruebas OK` and exit 1. The total is 171 because C3's three conditional checks per mode do not run yet.

- [ ] **Step 3: Replace the send code (steps 6, 7 and 8 of spec 4.4)**

In `src/Utils/FacturacionElectronica/ECFEmissionService.php`, replace `:581-644` (from `        if ($usaRFCE) {` down to the `        ];` that closes the e-CF return) with:

```php
        // Envio. Desde aqui la DGII puede tener el e-CF: ningun fallo devuelve el
        // numero. Con fila reservada, un fallo del envio, del mapeo o de
        // 'confirmar' deja la fila en ENVIO_INCIERTO y sale como
        // EcfEnvioInciertoException (con factura_id, para llevar al usuario a ella).
        $ctxConfirmar = null;
        $ok = true;
        try {
            if ($usaRFCE) {
                $rfceReception = $this->reception->recibirResumen($signedRfce, $bearerToken, [
                    'environment' => $ambiente,
                ]);

                $rfceEstado = $this->mapEstado($rfceReception);
                $rfceTrackId = $this->extractTrackId($rfceReception);

                if ($ctxReservar !== null) {
                    $ctxConfirmar = $ctxReservar + [
                        'reserva' => $reserva,
                        'estado' => 'RFCE_' . $rfceEstado,
                        'track_id' => null,
                        'dgii_response' => null,
                        'dgii_status_code' => null,
                        'rfce_track_id' => $rfceTrackId,
                        'rfce_estado' => $rfceEstado,
                        'rfce_response' => $rfceReception['data'],
                        'rfce_status_code' => $rfceReception['status_code'],
                        'secuencia_utilizada' => self::parseSecuenciaUtilizada(
                            is_array($rfceReception['data'] ?? null) ? $rfceReception['data'] : []
                        ),
                    ];
                    // La fila queda final ANTES de tocar el contador (fila primero,
                    // contador despues).
                    $ok = (bool) $persistencia('confirmar', $ctxConfirmar);
                }
            } else {
                $reception = $this->reception->recibir($signedXml, $bearerToken, [
                    'environment' => $ambiente,
                ]);

                $estado = $this->mapEstado($reception);
                $trackId = $this->extractTrackId($reception);

                if ($ctxReservar !== null) {
                    $ctxConfirmar = $ctxReservar + [
                        'reserva' => $reserva,
                        'estado' => $estado,
                        'track_id' => $trackId,
                        'dgii_response' => $reception['data'],
                        'dgii_status_code' => $reception['status_code'],
                        'rfce_track_id' => null,
                        'rfce_estado' => null,
                        'rfce_response' => null,
                        'rfce_status_code' => null,
                        'secuencia_utilizada' => self::parseSecuenciaUtilizada(
                            is_array($reception['data'] ?? null) ? $reception['data'] : []
                        ),
                    ];
                    $ok = (bool) $persistencia('confirmar', $ctxConfirmar);
                }
            }
        } catch (Throwable $e) {
            if ($persistencia !== null && $reserva !== null) {
                $fase = $ctxConfirmar !== null ? 'confirmar' : 'envio';
                $parcial = $ctxConfirmar !== null ? self::proyectarResultado($ctxConfirmar) : null;
                $marcado = false;
                try {
                    $marcado = (bool) $persistencia('incierto', self::ctxSinXml($ctxReservar) + [
                        'reserva' => $reserva,
                        'fase_fallida' => $fase,
                        'clase' => get_class($e),
                        'error' => mb_substr($e->getMessage(), 0, 2000),
                        'resultado_parcial' => $parcial,
                    ]);
                } catch (Throwable $h) {
                    error_log('[ECF e-NCF=' . $eNcf . ' factura_id=' . $reserva['factura_id'] . '] marcar incierto fallo: ' . $h->getMessage());
                }
                // Si la DGII llego a contestar, estado y track_id quedan aqui aunque
                // la base este caida (soporte los lee en el log, 10.2).
                error_log(sprintf(
                    '[ECF e-NCF=%s factura_id=%d] ENVIO_INCIERTO fase=%s marcado=%s estado=%s track_id=%s %s: %s',
                    $eNcf, $reserva['factura_id'], $fase, $marcado ? 'si' : 'no',
                    $parcial['estado'] ?? '-', $parcial['track_id'] ?? '-', get_class($e), $e->getMessage()
                ));
                throw new EcfEnvioInciertoException($eNcf, (int) $reserva['factura_id'], (string) $ambiente, $fase, $parcial, $marcado, $e);
            }
            // Integracion y gastos (sin gancho): la excepcion original, como siempre.
            throw $e;
        }

        if (!$ok) {
            // Otra escritura (soporte, otra peticion) ya movio la fila: su estado
            // manda y la secuencia no se toca desde aqui.
            error_log(sprintf(
                '[ECF e-NCF=%s factura_id=%d] CONFIRM_RACE: otra escritura movio la fila; no se toca la secuencia',
                $eNcf, $reserva['factura_id']
            ));
        }

        if ($usaRFCE) {
            if ($ok) {
                $this->reclamarSecuenciaSiNoUtilizada(
                    $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                    is_array($rfceReception['data'] ?? null) ? $rfceReception['data'] : [],
                    $rfceEstado,
                    $secuenciaRangoId
                );
            }

            return [
                'e_ncf' => $eNcf,
                'tipo_ecf' => $tipoEcf,
                'signed_xml' => $signedXml,
                'codigo_seguridad' => $codigoSeguridad,
                'track_id' => null,
                'estado' => 'RFCE_' . $rfceEstado,
                'ambiente' => $ambiente,
                'fecha_emision_dgii' => $fechaEmisionDgii,
                'dgii_response' => null,
                'dgii_status_code' => null,
                'flujo' => 'RFCE',
                'monto_total' => $montoTotal,
                'rfce_xml' => $signedRfce,
                'rfce_track_id' => $rfceTrackId,
                'rfce_estado' => $rfceEstado,
                'rfce_response' => $rfceReception['data'],
                'rfce_status_code' => $rfceReception['status_code'],
                'aviso' => 'E32 con monto < 250,000: RFCE enviado a DGII. La factura integra debe cargarse manualmente al portal DGII.',
                'factura_id' => $reserva['factura_id'] ?? null,
            ];
        }

        if ($ok) {
            $this->reclamarSecuenciaSiNoUtilizada(
                $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                is_array($reception['data'] ?? null) ? $reception['data'] : [],
                $estado,
                $secuenciaRangoId
            );
        }

        return [
            'e_ncf' => $eNcf,
            'tipo_ecf' => $tipoEcf,
            'signed_xml' => $signedXml,
            'codigo_seguridad' => $codigoSeguridad,
            'track_id' => $trackId,
            'estado' => $estado,
            'ambiente' => $ambiente,
            'fecha_emision_dgii' => $fechaEmisionDgii,
            'dgii_response' => $reception['data'],
            'dgii_status_code' => $reception['status_code'],
            'flujo' => 'ECF',
            'factura_id' => $reserva['factura_id'] ?? null,
        ];
```

Notes on the block:
- D5: `$ctxConfirmar = null; $ok = true;` come before the `try`, and the `catch` tests `$ctxConfirmar !== null`.
- `confirmar` runs after `mapEstado`/`extractTrackId` and before the reclaim (row first, counter second). A `false` result logs `CONFIRM_RACE` and skips `reclamarSecuenciaSiNoUtilizada`.
- A failure of the send, the mapping or `'confirmar'` never rolls the counter back. With a hook and a reserve, the service:
  1. tries `'incierto'`; if that call itself fails, the failure is logged and `marcado` is `no`;
  2. logs the `ENVIO_INCIERTO` line, with the DGII `estado`/`track_id` when known;
  3. throws `EcfEnvioInciertoException`.
- Both returns keep every key and gain `factura_id`. The literal `'estado' => 'RFCE_' . $rfceEstado` stays, because `tools/check_estado_dgii_ancho.php:71` reads it.

- [ ] **Step 4: Run the tests**

```bash
php -l src/Utils/FacturacionElectronica/ECFEmissionService.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
php tools/check_estado_dgii_ancho.php
php tools/test_write_ahead_puro.php
```

Expected:
- `No syntax errors detected`;
- `177 de 177 pruebas OK`, exit 0;
- `32/32 OK`;
- the puro file still ends with `N de N pruebas OK`.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Utils/FacturacionElectronica/ECFEmissionService.php tools/test_write_ahead_ecf.php
git commit -F - <<'EOF'
feat(ecf): confirmar o marcar incierto despues del envio

- Tras mapEstado/extractTrackId el gancho 'confirmar' deja la fila final
  ANTES de reclamar la secuencia; si devuelve false (CONFIRM_RACE) la
  secuencia no se toca.
- Si el envio, el mapeo o 'confirmar' fallan con fila reservada: 'incierto'
  (ENVIO_INCIERTO con resultado_parcial sin XML) y EcfEnvioInciertoException
  con factura_id; el contador nunca se devuelve. Sin gancho sale la excepcion
  original, como siempre.
- Las respuestas de emitir traen factura_id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: ECFEmissionService: registro de cierre para e-CF en vuelo

All paths are relative to the API worktree. Line numbers of `ECFEmissionService.php` are those **after Task 13**. Re-read the file right before editing it.

**Files:**
- Modify: `src/Utils/FacturacionElectronica/ECFEmissionService.php`
  - static properties after `private ?ncfModel $ncfModel = null;` (`:65`);
  - arm call before the `reservado, enviando` log line (`:524`);
  - disarm at the top of the send `catch` (`:642`, inside `if ($persistencia !== null && $reserva !== null) {`);
  - disarm after the send `try` (after the `}` at `:668`, before `if (!$ok) {` at `:670`);
  - `armarEnVuelo`/`desarmarEnVuelo` before the `consultarEstado` docblock (`:828`).
- Modify: `tools/test_write_ahead_ecf.php`: add the child mode right after `$ids = wa_sembrar($pdo);`, and section 3 right before the final `wa_fin();`.
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch`.

Ordering: `index.php:9-10` calls `ErrorHandler::register()` before any controller runs (`ErrorHandler.php:21-30`, with `register_shutdown_function` at `:29`). PHP calls shutdown functions in registration order, so this registry runs after `ErrorHandler::onShutdown` (`:47-61`). CLI tests do not register `ErrorHandler`.

**Interfaces:**
- Consumes:
  - Task 11: `ctxSinXml`.
  - Tasks 12 and 13: the reserve (`$reserva`, `$ctxReservar`, `$persistencia`) and the send `try`/`catch`.
  - Test side:
    - Task 12's fakes (`FakeReception` modes `reentrar` and `fatal`, `FakeAuth`, `FakeSigner`, `FakeNcf`) and its helpers `emision`, `gancho`, `correr`;
    - Task 13's `chkEnVuelo`;
    - Task 1's `wa_php_flags(): array`, the same flags `wa_servidor` gives its child processes.
- Produces:

```php
private static array $enVuelo = [];             // factura_id => [callable $persistencia, array $reserva, array $ctxSinXml]
private static bool $shutdownRegistrado = false;
private static function armarEnVuelo(callable $persistencia, array $reserva, array $ctxReservar): void
private static function desarmarEnVuelo(int $facturaId): void
// shutdown 'incierto' ctx = ctxSinXml(reservar ctx) + ['reserva'=>…, 'fase_fallida'=>'shutdown', 'clase'=>'shutdown',
//                                                      'error'=>error_get_last()['message'] ?? 'shutdown sin respuesta']  (no 'resultado_parcial' key)
```

- Test: the CLI mode `tools/test_write_ahead_ecf.php --hijo=shutdown --tenant-db=<base>` (only the parent run uses it) and `function enVuelo(): ?array`.

- [ ] **Step 1: Add the child mode**

In `tools/test_write_ahead_ecf.php`, insert this block right after the line `$ids = wa_sembrar($pdo);`. It must come after the fake classes: they extend classes loaded at runtime, so PHP only declares them when execution reaches them.

```php

// Modo hijo del escenario S1 (seccion 3): dos emisiones anidadas en un proceso
// y un fatal real en la segunda. Ni catch ni finally corren: solo el registro
// de cierre puede marcar las dos filas. El padre revisa la base al terminar.
if (wa_arg('hijo') === 'shutdown') {
    $fases1 = $ctxs1 = $fases2 = $ctxs2 = [];
    $auth2 = new FakeAuth();
    $svc2 = new ECFEmissionService($auth2, new FakeSigner(), new FakeReception($auth2, 'fatal'), new FakeNcf());
    $em2 = emision($pdo, $ids, '31');
    $gancho2 = gancho(new facturaModel(), $em2['factura'], $fases2, $ctxs2);
    $auth1 = new FakeAuth();
    $rec1 = new FakeReception($auth1, 'reentrar');
    $rec1->reentrada = function () use ($svc2, $em2, $gancho2): void {
        $svc2->emitir($em2['payload'], $gancho2);
    };
    $svc1 = new ECFEmissionService($auth1, new FakeSigner(), $rec1, new FakeNcf());
    $em1 = emision($pdo, $ids, '31');
    $svc1->emitir($em1['payload'], gancho(new facturaModel(), $em1['factura'], $fases1, $ctxs1));
    echo "NO DEBIO LLEGAR AQUI\n";
    exit(3);
}
```

- [ ] **Step 2: Write the failing scenarios (section 3)**

Insert this block right before the final `wa_fin();`:

```php
// ---------------------------------------------------------------------------
// 3) Registro de cierre para e-CF en vuelo (Task 14)
// ---------------------------------------------------------------------------
echo "\n== 3) Registro de cierre ==\n";

/** ECFEmissionService::$enVuelo (privado y estatico); null si todavia no existe. */
function enVuelo(): ?array
{
    return property_exists(ECFEmissionService::class, 'enVuelo')
        ? (new ReflectionProperty(ECFEmissionService::class, 'enVuelo'))->getValue()
        : null;
}

// S1 un proceso hijo muere con un fatal real con dos filas en vuelo.
wa_limpiar($pdo);
$antesHijo = wa_contador($pdo, 'E31');
$salidaHijo = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_ecf_hijo_' . getmypid() . '.out';
$proceso = proc_open(
    array_merge([PHP_BINARY], wa_php_flags(), [__FILE__, '--hijo=shutdown', '--tenant-db=' . $base]),
    [1 => ['file', $salidaHijo, 'w'], 2 => ['file', $salidaHijo, 'a']],
    $tuberias,
    dirname(__DIR__)
);
$codigoHijo = is_resource($proceso) ? proc_close($proceso) : -1;
$salida = (string) @file_get_contents($salidaHijo);
@unlink($salidaHijo);
wa_chk('S1: el hijo murio con un fatal (codigo 255, no llego al final)',
    $codigoHijo === 255 && !str_contains($salida, 'NO DEBIO LLEGAR AQUI'), ['codigo' => $codigoHijo, 'salida' => mb_substr($salida, 0, 400)]);
$filasHijo = $pdo->query('SELECT id, e_ncf, estado_dgii, respuesta_dgii FROM facturas ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
wa_chk('S1: el hijo reservo E310000000001 y E310000000002',
    array_column($filasHijo, 'e_ncf') === ['E310000000001', 'E310000000002'], $filasHijo);
wa_chk('S1: contador +2', wa_contador($pdo, 'E31') - $antesHijo === 2);
foreach ($filasHijo as $f) {
    $meta = facturaModel::metaEnvio($f['respuesta_dgii']);
    wa_chk("S1 {$f['e_ncf']}: ENVIO_INCIERTO", $f['estado_dgii'] === 'ENVIO_INCIERTO', $f['estado_dgii']);
    wa_chk("S1 {$f['e_ncf']}: clase shutdown y el error del fatal",
        ($meta['clase'] ?? null) === 'shutdown' && str_contains((string) ($meta['error'] ?? ''), 'Allowed memory size'), $meta);
    wa_chk("S1 {$f['e_ncf']}: sin resultado_parcial (el cierre no lo manda)", array_key_exists('resultado_parcial', $meta) && $meta['resultado_parcial'] === null, $meta);
    chkEnVuelo("S1 {$f['e_ncf']}", $f, 'shutdown');
}

// S2-S5 en este proceso: el registro queda vacio en cada salida.
$r = correr($pdo, $ids);
wa_chk('S2: tras una emision aceptada el registro esta vacio', $r['err'] === null && enVuelo() === [], enVuelo());
$r = correr($pdo, $ids, ['modo' => 'cuelga']);
wa_chk('S3: tras EcfEnvioInciertoException el registro esta vacio',
    $r['err'] instanceof EcfEnvioInciertoException && enVuelo() === [], enVuelo());
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx) {
    throw new EcfNumeroOcupadoException((string) $ctx['e_ncf'], (string) $ctx['ambiente'], 'prueba');
}]]);
wa_chk('S4: tras un ocupado el registro esta vacio (nunca se armo)',
    $r['err'] instanceof EcfNumeroOcupadoException && enVuelo() === [], enVuelo());
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function (array $ctx, facturaModel $m, array $factura) use ($pdo) {
    $reserva = $m->reservarFacturaECF($factura, $ctx);
    $pdo->beginTransaction();
    return $reserva;
}]]);
wa_chk('S5: tras la transaccion abierta el registro esta vacio (nunca se armo)',
    $r['err'] instanceof RuntimeException && $r['err']->getMessage() === 'persistencia dejo una transaccion abierta' && enVuelo() === [], enVuelo());
```

- [ ] **Step 3: Run it and watch section 3 fail**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
```

Expected:
- Sections 1 and 2 stay all `[OK  ]`.
- In section 3 the child still dies with code 255 and reserves `E310000000001` and `E310000000002`, so those three lines pass.
- Both rows stay `PENDIENTE_ENVIO`: `[FALLO] S1 E310000000001: ENVIO_INCIERTO`, and the clase, resultado_parcial and 6.3 lines fail for each row.
- S2-S5 fail because `ECFEmissionService::$enVuelo` does not exist yet (`enVuelo()` returns null).
- The run ends with `184 de 198 pruebas OK`, exit 1.

- [ ] **Step 4: Static registry**

In `src/Utils/FacturacionElectronica/ECFEmissionService.php`, after `    private ?ncfModel $ncfModel = null;` (`:65`) add, with a blank line before:

```php
    /**
     * Filas reservadas cuyo envio sigue en curso en ESTE proceso:
     * factura_id => [callable $persistencia, array $reserva, array $ctxSinXml].
     * Estatico a proposito: cubre a cualquier instancia del servicio en la misma
     * peticion. El registro de cierre las marca ENVIO_INCIERTO si el proceso
     * muere (fatal, memoria, timeout) antes de 'confirmar'/'incierto'.
     */
    private static array $enVuelo = [];
    private static bool $shutdownRegistrado = false;
```

- [ ] **Step 5: Arm after the reserve, disarm on both exits of the send**

Replace (`:524`):

```php
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $idReserva));
```

with:

```php
                self::armarEnVuelo($persistencia, $reserva, $ctxReservar);
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $idReserva));
```

The arm call sits after the open-transaction assertion, so an `EcfNumeroOcupadoException`, a missing `factura_id` or an open transaction never arms an entry.

Replace (`:642-643`):

```php
            if ($persistencia !== null && $reserva !== null) {
                $fase = $ctxConfirmar !== null ? 'confirmar' : 'envio';
```

with:

```php
            if ($persistencia !== null && $reserva !== null) {
                self::desarmarEnVuelo((int) $reserva['factura_id']);
                $fase = $ctxConfirmar !== null ? 'confirmar' : 'envio';
```

Replace (`:666-670`):

```php
            // Integracion y gastos (sin gancho): la excepcion original, como siempre.
            throw $e;
        }

        if (!$ok) {
```

with:

```php
            // Integracion y gastos (sin gancho): la excepcion original, como siempre.
            throw $e;
        }
        if ($reserva !== null) {
            // 'confirmar' ya dejo la fila final (o CONFIRM_RACE): nada que marcar.
            self::desarmarEnVuelo((int) $reserva['factura_id']);
        }

        if (!$ok) {
```

- [ ] **Step 6: `armarEnVuelo` and `desarmarEnVuelo`**

Add the block below right after the closing `}` of `proyectarResultado`. It goes before the `consultarEstado` docblock, whose `/**` is at `:828` and whose next line starts with `* $rncEmisor permite consultar`.

```php
    /**
     * Anota una fila reservada como en vuelo y, una vez por proceso, registra la
     * funcion de cierre que la marca ENVIO_INCIERTO si el proceso muere antes de
     * 'confirmar'/'incierto' (spec 4.4 paso 9).
     *
     * Orden: index.php registra ErrorHandler (ErrorHandler.php:21-30) antes de
     * cualquier emision, y PHP llama las funciones de cierre en orden de
     * registro; esta corre DESPUES de ErrorHandler::onShutdown, que solo puede
     * registrar un error_id anonimo. Si a esa altura PDO ya no sirve, la fila
     * queda en PENDIENTE_ENVIO (resolucion manual, 10.2).
     */
    private static function armarEnVuelo(callable $persistencia, array $reserva, array $ctxReservar): void
    {
        self::$enVuelo[(int) $reserva['factura_id']] = [$persistencia, $reserva, self::ctxSinXml($ctxReservar)];
        if (self::$shutdownRegistrado) {
            return;
        }
        self::$shutdownRegistrado = true;
        register_shutdown_function(static function (): void {
            $err = error_get_last();
            foreach (self::$enVuelo as [$p, $r, $c]) {
                try {
                    $p('incierto', $c + [
                        'reserva' => $r,
                        'fase_fallida' => 'shutdown',
                        'clase' => 'shutdown',
                        'error' => (string) ($err['message'] ?? 'shutdown sin respuesta'),
                    ]);
                } catch (Throwable) {
                    // Cierre del proceso: no hay a quien avisar. La fila queda en
                    // PENDIENTE_ENVIO y se resuelve a mano (10.2).
                }
            }
            self::$enVuelo = [];
        });
    }

    /** La fila ya tiene destino ('confirmar' o 'incierto'): fuera del registro. */
    private static function desarmarEnVuelo(int $facturaId): void
    {
        unset(self::$enVuelo[$facturaId]);
    }

```

- [ ] **Step 7: Run the tests and the PHP 8.4 check**

```bash
php -l src/Utils/FacturacionElectronica/ECFEmissionService.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch
php tools/check_estado_dgii_ancho.php
php tools/test_write_ahead_puro.php
grep -nE "(public|protected|private)\(set\)|array_(find|any|all)\(|new [A-Za-z_]+\([^)]*\)->" src/Utils/FacturacionElectronica/ECFEmissionService.php tools/test_write_ahead_ecf.php
```

Expected:
- `No syntax errors detected`;
- `198 de 198 pruebas OK`, exit 0;
- `32/32 OK`;
- the puro file still ends with `N de N pruebas OK`;
- the `grep` prints nothing: no asymmetric visibility, no 8.4 array functions, no `new Foo()->bar()` without parentheses.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Utils/FacturacionElectronica/ECFEmissionService.php tools/test_write_ahead_ecf.php
git commit -F - <<'EOF'
feat(ecf): registro de cierre marca incierto el e-CF en vuelo

- Registro estatico de filas reservadas cuyo envio sigue en curso; se arma
  tras la reserva y se desarma al confirmar o marcar incierto.
- Una funcion de cierre (una por proceso, despues de ErrorHandler) llama
  'incierto' con fase_fallida shutdown si el proceso muere a mitad del
  envio: un fatal ya no deja la fila en PENDIENTE_ENVIO sin rastro.
- Prueba con un proceso hijo que muere por memoria con dos emisiones
  anidadas: las dos filas quedan ENVIO_INCIERTO.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: inventoryModel::yaMovioDocumento

**Files:**
- Modify: `src/Models/inventoryModel.php`. Add a public method right after `revertirVenta` (`:217-220`).
  - `registrarVenta` is at `:185-201`, with its docblock at `:167-184`.
  - The private `$conexion` is at `:17`.
  - The index `idx_referencia (referencia_tipo, referencia_id)` is at `db/tenant_schema.sql:666`.
- Modify: `tools/test_write_ahead_puro.php` (created in Task 4). Insert section 9 directly above its closing block (Task 4).
- Test: `php tools/test_write_ahead_puro.php`, section 9.

**Interfaces:**
- Consumes (Task 1): `wa_chk`, `wa_fin`.
- Produces:

```php
public function yaMovioDocumento(string $referenciaTipo, int $referenciaId): bool   // PDOException propagates
```

- [ ] **Step 1: Add section 9 (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above its closing block (Task 4):

```php
// ---------------------------------------------------------------------------
// 9) inventoryModel::yaMovioDocumento (Task 15): una conexion falsa puesta en
// la propiedad privada conexion; nunca toca MySQL.
// ---------------------------------------------------------------------------
echo "9) inventoryModel::yaMovioDocumento\n";
require_once __DIR__ . '/../src/Models/inventoryModel.php';

final class WaS9Sentencia
{
    public function __construct(private WaS9Conexion $c, private string $sql)
    {
    }

    public function execute(?array $params = null): bool
    {
        $this->c->consultas[] = ['sql' => $this->sql, 'params' => $params ?? []];
        return true;
    }

    public function fetchColumn(int $columna = 0): mixed
    {
        return $this->c->hayFila ? '1' : false;
    }
}

final class WaS9Conexion
{
    public array $consultas = [];

    public function __construct(public bool $hayFila, private bool $rota = false)
    {
    }

    public function prepare(string $sql): WaS9Sentencia
    {
        if ($this->rota) {
            throw new PDOException('se cayo la conexion');
        }
        return new WaS9Sentencia($this, $sql);
    }
}

$s9Inventario = static function (WaS9Conexion $c): inventoryModel {
    $ref = new ReflectionClass(inventoryModel::class);
    $m = $ref->newInstanceWithoutConstructor();
    $ref->getProperty('conexion')->setValue($m, $c);
    return $m;
};

if (!method_exists(inventoryModel::class, 'yaMovioDocumento')) {
    wa_chk('inventoryModel::yaMovioDocumento existe', false);
} else {
    $c = new WaS9Conexion(true);
    wa_chk('con un movimiento de la factura: true', $s9Inventario($c)->yaMovioDocumento('factura', 41) === true);
    $c = new WaS9Conexion(false);
    wa_chk('sin movimientos: false', $s9Inventario($c)->yaMovioDocumento('factura', 41) === false);
    $sql = preg_replace('/\s+/', ' ', $c->consultas[0]['sql'] ?? '');
    wa_chk('consulta por referencia_tipo y referencia_id con LIMIT 1 (idx_referencia)',
        str_contains($sql, 'FROM inventory_movements') && str_contains($sql, 'referencia_tipo = :t AND referencia_id = :id')
        && str_contains($sql, 'LIMIT 1'), $sql);
    wa_chk("parametros [':t' => 'factura', ':id' => 41]",
        ($c->consultas[0]['params'] ?? null) === [':t' => 'factura', ':id' => 41], $c->consultas[0]['params'] ?? null);
    $lanzo = null;
    try {
        $s9Inventario(new WaS9Conexion(false, true))->yaMovioDocumento('factura', 41);
    } catch (PDOException $e) {
        $lanzo = $e;
    }
    wa_chk('si la base falla, la PDOException sale (el que llama no mueve stock)', $lanzo instanceof PDOException);
}

```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | sed -n '/^9)/,$p'; echo "exit=${PIPESTATUS[0]}"
```

Expected: `9) inventoryModel::yaMovioDocumento`, then `[FALLO] inventoryModel::yaMovioDocumento existe` and `exit=1`.

- [ ] **Step 3: Implement the method**

In `src/Models/inventoryModel.php`, right after the closing `}` of `revertirVenta` (`:220`), insert:

```php

    /**
     * true si el documento ya tiene algun movimiento de inventario (por
     * ejemplo referencia_tipo 'factura' y su id). Lo usa la emision e-CF y la
     * consulta de estado para mover el stock de una factura UNA sola vez,
     * llegue primero quien llegue (spec 4.2.4 y 10.5).
     *
     * Quien llama lo pregunta ANTES de registrarVenta. registrarVenta no lo
     * revisa a proposito: la factura simple llama revertirVenta y despues
     * registrarVenta sobre el mismo id cuando reemplaza sus lineas, y eso
     * tiene que seguir moviendo.
     *
     * Una PDOException sale tal cual: el que llama la atrapa y NO mueve el
     * stock (mejor un movimiento de menos, que se corrige con un ajuste, que
     * uno repetido). Usa el indice idx_referencia.
     */
    public function yaMovioDocumento(string $referenciaTipo, int $referenciaId): bool
    {
        $stmt = $this->conexion->prepare(
            'SELECT 1 FROM inventory_movements WHERE referencia_tipo = :t AND referencia_id = :id LIMIT 1'
        );
        $stmt->execute([':t' => $referenciaTipo, ':id' => $referenciaId]);
        return $stmt->fetchColumn() !== false;
    }
```

- [ ] **Step 4: Run it and see it pass; lint**

```bash
php tools/test_write_ahead_puro.php | sed -n '/^9)/,$p'; echo "exit=${PIPESTATUS[0]}"
php -l src/Models/inventoryModel.php
```

Expected:
- The five section 9 checks print `[OK  ]`: true, false, the SQL, the params, and the PDOException.
- The summary reads `N de N pruebas OK`, where N counts every section so far, and `exit=0`.
- `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Models/inventoryModel.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
feat(inventario): yaMovioDocumento para mover stock una sola vez

inventoryModel::yaMovioDocumento('factura', id) dice si el documento ya
tiene movimientos (SELECT 1 ... LIMIT 1 sobre idx_referencia). Lo usaran
la emision e-CF y la consulta de estado para mover el stock de una
factura una sola vez. registrarVenta no lo revisa: la factura simple
revierte y vuelve a registrar sobre el mismo id. Una PDOException sale y
el que llama no mueve. Seccion 9 de test_write_ahead_puro.php.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: Stats y reporte de ventas sin filas en vuelo

**Files:**
- Modify: `src/Models/facturaModel.php`, `getECFStats`. At `9f669ad` it spans `:1353-1509`; Tasks 6-9 add lines above it, so re-pin with `grep -n "public function getECFStats" src/Models/facturaModel.php`. The edits match text, not line numbers.
  - `resumen` is `:1358-1373`, with the comment at `:1358-1362`;
  - `por_tipo` is `:1375-1386`;
  - `$notRechazado`, comment `:1396-1399`, value `:1400`;
  - `por_estado` `:1388-1394` and `secuencias` `:1446-1467` stay unchanged.
  - `EstadosEcf` is already required since Task 6.
- Modify: `src/Models/ReporteVentasModel.php`:
  - requires `:2-4`;
  - class docblock `:8-13`;
  - `fetchDocumentos` `:93-131`, with the filter at `:115-117` and positional params at `:119-130`.
- Modify: `tools/test_notas_vinculadas.php`, the two stats checks:
  - `'stats: monto_total sigue siendo la suma cruda'`;
  - `'stats: monto_neto resta la E34 y deja fuera los rechazados'`.

  They are at `:336-341` at `9f669ad`, a little lower after Task 6; find them by their description.
- Modify: `tools/test_write_ahead_puro.php`, section 10, directly above its closing block (Task 4).
- Test: `php tools/test_write_ahead_puro.php` (section 10) and `php tools/test_notas_vinculadas.php`.

**Interfaces:**
- Consumes (Task 4): `EstadosEcf::EN_VUELO`, `EstadosEcf::sql(array): string` (`"'PENDIENTE_ENVIO', 'ENVIO_INCIERTO'"`).
- Consumes (existing): `ncfModel::sqlSecuenciaActual(PDO $conexion, string $ambiente)` (`ncfModel.php:93-102`). It is typed `PDO`, so the test fake extends `PDO`.
- Produces:
  - `getECFStats` SQL: `monto_total` and `por_tipo.monto_total` = `COALESCE(SUM(CASE WHEN estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO') THEN 0 ELSE total END), 0)`;
  - `monto_neto` and `$notRechazado` keep NULL rows (resolved decision 11);
  - `ReporteVentasModel::fetchDocumentos` adds `AND f.estado_dgii NOT IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')`;
  - the response shape of `GET /api/facturas/stats` is unchanged.

- [ ] **Step 1: Add section 10 (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above its closing block (Task 4):

```php
// ---------------------------------------------------------------------------
// 10) Stats y reporte de ventas sin filas en vuelo (Task 16). getECFStats pasa
// su conexion a ncfModel::sqlSecuenciaActual(PDO ...), asi que la falsa es un
// PDO (sin conectar) que anota CADA consulta y devuelve sentencias vacias.
// ---------------------------------------------------------------------------
echo "10) Stats y reporte de ventas sin filas en vuelo\n";
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EstadosEcf.php';
require_once __DIR__ . '/../src/Models/facturaModel.php';
require_once __DIR__ . '/../src/Models/ReporteVentasModel.php';

final class WaS10Sentencia extends PDOStatement
{
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        return false;
    }

    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        return [];
    }
}

final class WaS10Grabadora extends PDO
{
    public array $consultas = [];

    public function __construct()
    {
        // Sin parent::__construct: nunca abre una conexion.
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $this->consultas[] = preg_replace('/\s+/', ' ', $query);
        return new WaS10Sentencia();
    }

    public function quote(string $string, int $type = PDO::PARAM_STR): string|false
    {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $string) . "'";
    }
}

putenv('MULTI_TENANT_ENABLED=false');
putenv('DGII_ECF_ENVIRONMENT=ecf');
$s10Ref = new ReflectionClass(facturaModel::class);
$s10Modelo = $s10Ref->newInstanceWithoutConstructor();
$s10Con = new WaS10Grabadora();
$s10Ref->getProperty('conexion')->setValue($s10Modelo, $s10Con);
$s10Modelo->getECFStats();
$s10Sql = static function (string $marca) use ($s10Con): string {
    foreach ($s10Con->consultas as $q) {
        if (str_contains($q, $marca)) {
            return $q;
        }
    }
    return '';
};
$enVuelo = "'PENDIENTE_ENVIO', 'ENVIO_INCIERTO'";
$montoSinVuelo = "COALESCE(SUM(CASE WHEN estado_dgii IN ({$enVuelo}) THEN 0 ELSE total END), 0) as monto_total";
$notRechazado = "AND (estado_dgii IS NULL OR (estado_dgii NOT LIKE '%RECHAZADO%' AND estado_dgii NOT IN ({$enVuelo})))";

wa_chk('stats: corre las 7 consultas', count($s10Con->consultas) === 7, $s10Con->consultas);
$q = $s10Sql('as total_ecf');
wa_chk('resumen: monto_total deja fuera las filas en vuelo', str_contains($q, $montoSinVuelo), $q);
wa_chk('resumen: total_ecf sigue contando todas las filas', str_contains($q, 'SELECT COUNT(*) as total_ecf,'), $q);
wa_chk('resumen: monto_neto deja fuera rechazados y filas en vuelo (NULL sigue contando)', str_contains($q,
    "COALESCE(SUM(CASE WHEN estado_dgii IS NULL OR (estado_dgii NOT LIKE '%RECHAZADO%' AND estado_dgii NOT IN ({$enVuelo})) "
    . "THEN CASE WHEN tipo_ecf = '34' THEN -total ELSE total END ELSE 0 END), 0) as monto_neto"), $q);
$q = $s10Sql('GROUP BY tipo_ecf ORDER BY tipo_ecf');
wa_chk('por_tipo: total sigue siendo COUNT(*) y monto_total sin filas en vuelo',
    str_contains($q, 'COUNT(*) as total, ' . $montoSinVuelo), $q);
foreach ([
    'por_mes' => "DATE_FORMAT(fecha_emision_dgii, '%Y-%m') as mes",
    'ventas_por_mes' => "DATE_FORMAT(date, '%Y-%m') as mes",
    'ventas_por_dia' => "DATE_FORMAT(date, '%Y-%m-%d') as dia",
] as $serie => $marca) {
    $q = $s10Sql($marca);
    wa_chk("{$serie}: sin rechazados ni filas en vuelo", str_contains($q, $notRechazado), $q);
}
$q = $s10Sql("COALESCE(estado_dgii, 'PENDIENTE') as estado");
wa_chk('por_estado: igual que antes (cada estado con su cubeta)', $q ===
    "SELECT COALESCE(estado_dgii, 'PENDIENTE') as estado, COUNT(*) as total, COALESCE(SUM(total), 0) as monto_total "
    . "FROM facturas WHERE tipo_ecf IS NOT NULL AND ambiente_dgii = 'ecf' GROUP BY estado_dgii ORDER BY total DESC", $q);
$q = $s10Sql('FROM ncf_sequences ns');
wa_chk('secuencias: total_emitidos sigue contando filas, en vuelo incluidas',
    str_contains($q, "SELECT CONCAT('E', tipo_ecf) as type, COUNT(*) as total_emitidos FROM facturas "
        . "WHERE tipo_ecf IS NOT NULL AND ambiente_dgii = 'ecf' GROUP BY tipo_ecf") && !str_contains($q, 'PENDIENTE_ENVIO'), $q);

// ReporteVentasModel::fetchDocumentos: la exclusion va en el SQL, con los
// mismos parametros ? de antes.
final class WaS10SentenciaReporte
{
    public function __construct(private WaS10Reporte $c, private string $sql)
    {
    }

    public function execute(?array $params = null): bool
    {
        $this->c->sql = $this->sql;
        $this->c->params = $params ?? [];
        return true;
    }

    public function fetchAll(int $modo = PDO::FETCH_DEFAULT): array
    {
        return [];
    }
}

final class WaS10Reporte
{
    public string $sql = '';
    public array $params = [];

    public function prepare(string $sql): WaS10SentenciaReporte
    {
        return new WaS10SentenciaReporte($this, $sql);
    }
}

$s10RefRep = new ReflectionClass(ReporteVentasModel::class);
$s10Rep = $s10RefRep->newInstanceWithoutConstructor();
$s10ConRep = new WaS10Reporte();
$s10RefRep->getProperty('conexion')->setValue($s10Rep, $s10ConRep);
$s10RefRep->getProperty('usuarios')->setValue($s10Rep, []);   // sin la consulta de usuarios
(new ReflectionMethod(ReporteVentasModel::class, 'fetchDocumentos'))->invoke($s10Rep, '2026-10-01', '2026-10-31');
$q = preg_replace('/\s+/', ' ', $s10ConRep->sql);
wa_chk('reporte de ventas: excluye las filas en vuelo',
    str_contains($q, "AND f.estado_dgii NOT LIKE '%RECHAZADO%' AND f.estado_dgii NOT IN ({$enVuelo})"), $q);
wa_chk('reporte de ventas: un ? por parametro', substr_count($q, '?') === count($s10ConRep->params), [$q, $s10ConRep->params]);
wa_chk('reporte de ventas: los mismos parametros de antes', $s10ConRep->params === [
    '2026-10-01 00:00:00', '2026-11-01 00:00:00', '31', '32', '44', '45', '46', '33', '34', 'ecf',
], $s10ConRep->params);

```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | sed -n '/^10)/,$p' | grep -E "^\s+\[|pruebas"
```

Expected: seven `[FALLO]` lines:
- `resumen: monto_total deja fuera las filas en vuelo`;
- `resumen: monto_neto deja fuera rechazados y filas en vuelo (NULL sigue contando)`;
- `por_tipo: total sigue siendo COUNT(*) y monto_total sin filas en vuelo`;
- `por_mes`, `ventas_por_mes` and `ventas_por_dia`: `sin rechazados ni filas en vuelo`;
- `reporte de ventas: excluye las filas en vuelo`.

The other six section 10 checks print `[OK  ]`.

- [ ] **Step 3: Update the two literals in `tools/test_notas_vinculadas.php` (still failing)**

Replace:

```php
$chk('stats: monto_total sigue siendo la suma cruda', str_contains($sqlResumen, 'COALESCE(SUM(total), 0) as monto_total'), $sqlResumen);
$chk('stats: monto_neto resta la E34 y deja fuera los rechazados',
    str_contains($sqlResumen,
        "COALESCE(SUM(CASE WHEN estado_dgii IS NULL OR estado_dgii NOT LIKE '%RECHAZADO%' "
        . "THEN CASE WHEN tipo_ecf = '34' THEN -total ELSE total END ELSE 0 END), 0) as monto_neto"),
    $sqlResumen);
```

with:

```php
$chk('stats: monto_total deja fuera las filas en vuelo',
    str_contains($sqlResumen,
        "COALESCE(SUM(CASE WHEN estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO') THEN 0 ELSE total END), 0) as monto_total"),
    $sqlResumen);
$chk('stats: monto_neto resta la E34 y deja fuera los rechazados y las filas en vuelo',
    str_contains($sqlResumen,
        "COALESCE(SUM(CASE WHEN estado_dgii IS NULL OR (estado_dgii NOT LIKE '%RECHAZADO%' "
        . "AND estado_dgii NOT IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')) "
        . "THEN CASE WHEN tipo_ecf = '34' THEN -total ELSE total END ELSE 0 END), 0) as monto_neto"),
    $sqlResumen);
```

Run:

```bash
php tools/test_notas_vinculadas.php | grep -E "FALLO|pruebas"
```

Expected: `[FALLO] stats: monto_total deja fuera las filas en vuelo`, `[FALLO] stats: monto_neto resta la E34 y deja fuera los rechazados y las filas en vuelo`, then `60 de 62 pruebas OK`.

- [ ] **Step 4: Exclude in-flight rows in `getECFStats`**

In `src/Models/facturaModel.php`, replace:

```php
            $ambiente = $this->resolveActiveAmbiente();
            $ambFilter = $ambiente !== null ? "AND ambiente_dgii = '{$ambiente}'" : '';

            // monto_neto: lo que de verdad se emitio. La nota de credito (E34)
            // resta y los rechazados no cuentan (cubre RECHAZADO,
            // RECHAZADO_ARCHIVADO y RFCE_RECHAZADO, como $notRechazado mas
            // abajo). monto_total sigue siendo la suma cruda.
            $resumen = $this->conexion->query(
                "SELECT COUNT(*) as total_ecf,
                        COALESCE(SUM(total), 0) as monto_total,
                        COALESCE(SUM(CASE WHEN estado_dgii IS NULL OR estado_dgii NOT LIKE '%RECHAZADO%'
                                          THEN CASE WHEN tipo_ecf = '34' THEN -total ELSE total END
                                          ELSE 0 END), 0) as monto_neto,
```

with:

```php
            $ambiente = $this->resolveActiveAmbiente();
            $ambFilter = $ambiente !== null ? "AND ambiente_dgii = '{$ambiente}'" : '';
            // Filas en vuelo (PENDIENTE_ENVIO, ENVIO_INCIERTO): la DGII aun no
            // dio veredicto, asi que no son dinero ni ventas. Se cuentan como
            // filas (total_ecf, por_tipo.total, por_estado, total_emitidos)
            // pero no suman en ningun monto ni serie de ventas.
            $enVuelo = EstadosEcf::sql(EstadosEcf::EN_VUELO);

            // monto_total: la suma de los e-CF, sin las filas en vuelo (la
            // nota de credito suma y los rechazados tambien, como siempre).
            // monto_neto: lo que de verdad se emitio. La nota de credito (E34)
            // resta; no cuentan los rechazados (RECHAZADO, RECHAZADO_ARCHIVADO,
            // RFCE_RECHAZADO, como $notRechazado mas abajo) ni las filas en
            // vuelo. "estado_dgii IS NULL OR (...)": NULL NOT IN (...) da NULL
            // y dejaria fuera una fila sin estado que hoy si cuenta.
            $resumen = $this->conexion->query(
                "SELECT COUNT(*) as total_ecf,
                        COALESCE(SUM(CASE WHEN estado_dgii IN ({$enVuelo}) THEN 0 ELSE total END), 0) as monto_total,
                        COALESCE(SUM(CASE WHEN estado_dgii IS NULL OR (estado_dgii NOT LIKE '%RECHAZADO%' AND estado_dgii NOT IN ({$enVuelo}))
                                          THEN CASE WHEN tipo_ecf = '34' THEN -total ELSE total END
                                          ELSE 0 END), 0) as monto_neto,
```

Replace (in `por_tipo`):

```php
                "SELECT tipo_ecf,
                        COUNT(*) as total,
                        COALESCE(SUM(total), 0) as monto_total,
```

with:

```php
                "SELECT tipo_ecf,
                        COUNT(*) as total,
                        COALESCE(SUM(CASE WHEN estado_dgii IN ({$enVuelo}) THEN 0 ELSE total END), 0) as monto_total,
```

Replace:

```php
            // e-CF emitidos por mes, de todos los tipos (compras E41/E43/E47
            // incluidas). Sin los rechazados: cubre RECHAZADO, RECHAZADO_ARCHIVADO
            // y RFCE_RECHAZADO; conserva NULL/PENDIENTE. NO son ventas: para eso
            // estan ventas_por_mes / ventas_por_dia.
            $notRechazado = "AND (estado_dgii IS NULL OR estado_dgii NOT LIKE '%RECHAZADO%')";
```

with:

```php
            // e-CF emitidos por mes, de todos los tipos (compras E41/E43/E47
            // incluidas). Sin los rechazados (RECHAZADO, RECHAZADO_ARCHIVADO,
            // RFCE_RECHAZADO) ni las filas en vuelo; conserva NULL/PENDIENTE.
            // NO son ventas: para eso estan ventas_por_mes / ventas_por_dia, que
            // usan este mismo filtro por $esVenta.
            $notRechazado = "AND (estado_dgii IS NULL OR (estado_dgii NOT LIKE '%RECHAZADO%' AND estado_dgii NOT IN ({$enVuelo})))";
```

`por_estado` and `secuencias` are not touched.

- [ ] **Step 5: Exclude in-flight rows from the ventas report**

In `src/Models/ReporteVentasModel.php`, replace:

```php
require_once __DIR__ . '/../AmbienteResolver.php';
```

with:

```php
require_once __DIR__ . '/../AmbienteResolver.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php';
```

Replace (class docblock):

```php
 * excluye por no ser comprobantes fiscales) y las facturas enviadas que aun no
 * tienen respuesta de la DGII: son ventas reales del negocio aunque el acuse
 * todavia no haya llegado. Para lo fiscal esta el 607, que si exige ACEPTADO.
```

with:

```php
 * excluye por no ser comprobantes fiscales) y las facturas enviadas que aun no
 * tienen respuesta de la DGII: son ventas reales del negocio aunque el acuse
 * todavia no haya llegado. Para lo fiscal esta el 607, que si exige ACEPTADO.
 * Las filas en vuelo (PENDIENTE_ENVIO, ENVIO_INCIERTO) NO entran: no se sabe si
 * la DGII las tiene, y una que nunca llego no fue una venta.
```

Replace (in `fetchDocumentos`):

```php
                  AND (f.tipo_ecf IS NULL OR f.tipo_ecf IN ({$marcas}))
                  AND f.estado_dgii NOT LIKE '%RECHAZADO%'";
```

with:

```php
                  AND (f.tipo_ecf IS NULL OR f.tipo_ecf IN ({$marcas}))
                  AND f.estado_dgii NOT LIKE '%RECHAZADO%'
                  AND f.estado_dgii NOT IN (" . EstadosEcf::sql(EstadosEcf::EN_VUELO) . ")";
```

The list is inlined from the constants, so the positional `?` params and their order are unchanged. The ambiente `?` is still the last one.

- [ ] **Step 6: Run everything and lint**

```bash
php tools/test_write_ahead_puro.php | sed -n '/^10)/,$p'; echo "exit=${PIPESTATUS[0]}"
php tools/test_notas_vinculadas.php | tail -1
php tools/check_estado_dgii_ancho.php | tail -1
php -l src/Models/facturaModel.php && php -l src/Models/ReporteVentasModel.php
```

Expected:
- the 13 section 10 checks are `[OK  ]`, the summary is `N de N pruebas OK`, and `exit=0`;
- `62 de 62 pruebas OK`;
- the checker prints its all-OK line (`32/32 OK` after Task 4);
- `No syntax errors detected` twice.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Models/facturaModel.php src/Models/ReporteVentasModel.php tools/test_notas_vinculadas.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
fix(facturas): las filas en vuelo no cuentan como dinero ni ventas

getECFStats deja fuera PENDIENTE_ENVIO y ENVIO_INCIERTO (EstadosEcf::
EN_VUELO) de resumen.monto_total, resumen.monto_neto, por_tipo.monto_total,
por_mes, ventas_por_mes y ventas_por_dia. Los conteos de filas (total_ecf,
por_tipo.total, por_estado, total_emitidos) las siguen contando. El filtro
conserva estado_dgii NULL (NULL NOT IN da NULL).

ReporteVentasModel::fetchDocumentos tambien las excluye, con la lista
inline para no mover los parametros ?. test_notas_vinculadas sigue 62/62
con los textos nuevos; seccion 10 de test_write_ahead_puro.php.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 17: facturaController: emision write-ahead y 502 incierto

**Files:**
- Modify: `src/Controllers/facturaController.php`. No earlier task touches it, so the `9f669ad` pins hold:

  | Spot | Where |
  |---|---|
  | requires | `:8-13` |
  | `FACTURA_EMISION_FALLO_GENERICO` | `:18` |
  | totals override | `:229-237` |
  | `$payload` | `:330-361` |
  | emission `try`/`catch` | `:363-383` |
  | `$facturaInput` | `:385-418` |
  | `saveFacturaConECF` call and failure branch | `:420-434` |
  | inventory | `:436-457` |
  | `$data` | `:459-467` |
  | `$estadoFinal` / `$rechazado` | `:474-475` |
  | 422 | `:476-491` |
  | 200 | `:493-502` |
  | end of `handleEmisionECF` | `:503` |
  | `dgiiMotivos` docblock | `:505` |
  | `respond()` (no `data` key) | `:1248-1255` |

- Modify: `src/Models/facturaModel.php`. Delete `saveFacturaConECF` and its docblock (`:1134-1303` at `9f669ad`; Tasks 6-9 moved it, so the script below finds it by text).
- Modify: `tools/test_write_ahead_puro.php`, section 11. The controller is read as a file, never required: its top runs the auth and the router (`:2-6`, `:25-34`).
- Create: `tools/test_write_ahead_api.php`.
- Test: section 11; `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch`.

**Interfaces:**
- Consumes:
  - `ECFEmissionService::emitir(array $payload, ?callable $persistencia = null): array` (Tasks 12-14). Its result carries `factura_id`, `e_ncf`, `track_id`, `estado`, `codigo_seguridad`, `tipo_ecf`, `ambiente`, `fecha_emision_dgii`, `dgii_response` / `rfce_response`.
  - `facturaModel::reservarFacturaECF(array $factura, array $ctx): array{factura_id,e_ncf,desde}` (Task 8).
  - `facturaModel::confirmarFacturaECF(int, array): bool`, `marcarEnvioIncierto(int, array): bool`, `existeFactura(int): bool` (Task 9).
  - `EcfEnvioInciertoException` readonly `eNcf`, `facturaId`, `faseFallida`, `resultadoParcial`, `marcado` (Task 5), and `EcfNumeroOcupadoException` (Task 5).
  - `EstadosEcf::SIN_STOCK`, `EstadosEcf::EN_VUELO` (Task 4).
  - `inventoryModel::yaMovioDocumento(string, int): bool` (Task 15) and `registrarVenta(int, array, ?string, ?int): int`.
  - `wa_*` (Tasks 1-2).
- Produces:

```php
const FACTURA_EMISION_INCIERTA = 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.';
function inventarioModelo(): inventoryModel   // guarded require_once; RuntimeException if the file is missing
function moverStockFacturaEcf(int $facturaId, array $items, string $tipoEcf, ?int $userId, string $estado, string $origen): void
// nothing for SIN_STOCK or EN_VUELO states or yaMovioDocumento; never throws ('[inventario] ...' error_log)
```

- `POST /api/facturas`:
  - 502 incierto: `{status:false, error:sprintf(FACTURA_EMISION_INCIERTA, e_ncf), data:{factura_id:int, e_ncf, tipo_ecf, estado_dgii:'ENVIO_INCIERTO'|'PENDIENTE_ENVIO'}}`;
  - 422 total guard: `'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.'`;
  - 200 and 422 keep the same 10 `data` keys.
- `facturaModel::saveFacturaConECF` no longer exists.
- Test helpers in `tools/test_write_ahead_api.php`, reused by Tasks 18 and 20:
  - functions `wa_linea`, `wa_factura`, `wa_emitir`, `wa_get`, `wa_reiniciar`, `wa_recepciones`, `wa_emit_fallidos`, `wa_claves`;
  - constants `T_EMISION_INCIERTA`, `T_FALLO_GENERICO`, `T_TOTAL_INVALIDO`, `T_NUMERO_OCUPADO`, `RUTA_RECEPCION`, `RUTA_RECEPCION_FC`;
  - the file ends with the two lines `wa_mock_modo($srv['mock'], 'acepta');` and `wa_fin();`. Later tasks insert before them.

- [ ] **Step 1: Check the prerequisites**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
grep -n "public function reservarFacturaECF\|public function confirmarFacturaECF\|public function marcarEnvioIncierto\|public function existeFactura" src/Models/facturaModel.php
grep -n "public function emitir(array \$payload, ?callable \$persistencia = null): array" src/Utils/FacturacionElectronica/ECFEmissionService.php
grep -n "public function yaMovioDocumento" src/Models/inventoryModel.php
ls src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php src/Utils/FacturacionElectronica/EstadosEcf.php
```

Expected: each grep finds its line and the three files exist. Otherwise stop: Tasks 4-15 come first.

- [ ] **Step 2: Add section 11 (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above its closing block (Task 4):

```php
// ---------------------------------------------------------------------------
// 11) facturaController: emision write-ahead (Task 17). El controlador se lee
// como texto: incluirlo manda headers, valida el token y corre el router.
// ---------------------------------------------------------------------------
echo "11) facturaController: emision write-ahead\n";
require_once __DIR__ . '/../src/Models/facturaModel.php';

/** Archivos .php/.md bajo $rutas (relativas a la raiz del API) que contienen $aguja. */
function wa_grep(array $rutas, string $aguja): array
{
    $raiz = dirname(__DIR__);
    $hallados = [];
    foreach ($rutas as $ruta) {
        $abs = $raiz . DIRECTORY_SEPARATOR . $ruta;
        $archivos = is_file($abs) ? [new SplFileInfo($abs)]
            : (is_dir($abs) ? new RecursiveIteratorIterator(new RecursiveDirectoryIterator($abs, FilesystemIterator::SKIP_DOTS)) : []);
        foreach ($archivos as $f) {
            if (in_array($f->getExtension(), ['php', 'md'], true)
                && str_contains((string) file_get_contents($f->getPathname()), $aguja)) {
                $hallados[] = str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($raiz) + 1));
            }
        }
    }
    return $hallados;
}

$s11Ctl = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../src/Controllers/facturaController.php'));
$s11Emision = preg_match('/\nfunction handleEmisionECF\(.*?\n\}\n/s', $s11Ctl, $m) ? $m[0] : '';
wa_chk('controlador: se encontro handleEmisionECF', $s11Emision !== '');
$s11Texto = preg_match("/\nconst FACTURA_EMISION_INCIERTA = '([^']*)';/", $s11Ctl, $m) ? $m[1] : null;
wa_chk('FACTURA_EMISION_INCIERTA es el texto de la spec 4.7, letra por letra', $s11Texto
    === 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. '
    . 'Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.', $s11Texto);
wa_chk('handleEmisionECF emite con el hook de persistencia',
    str_contains($s11Emision, '(new ECFEmissionService())->emitir($payload, $persistencia)'));
wa_chk('el 502 incierto lleva data con factura_id, e_ncf, tipo_ecf y estado_dgii',
    str_contains($s11Emision, "'error' => sprintf(FACTURA_EMISION_INCIERTA, \$eNcfFila)")
    && str_contains($s11Emision, "'factura_id' => \$filaId,"));
wa_chk('guarda del total: 422 antes de emitir',
    strpos($s11Emision, "!is_numeric(\$totales['monto_total'])") !== false
    && strpos($s11Emision, "!is_numeric(\$totales['monto_total'])") < strpos($s11Emision, '->emitir('));
$s11Estado = strpos($s11Emision, '$estadoFinal =');
$s11Stock = strpos($s11Emision, 'moverStockFacturaEcf(');
wa_chk('el stock se mueve despues de conocer $estadoFinal',
    $s11Estado !== false && $s11Stock !== false && $s11Stock > $s11Estado);
wa_chk('el codigo ya no llama ni define saveFacturaConECF',
    wa_grep(['src/Controllers', 'src/Models', 'src/Utils/FacturacionElectronica'], 'saveFacturaConECF') === [],
    wa_grep(['src/Controllers', 'src/Models', 'src/Utils/FacturacionElectronica'], 'saveFacturaConECF'));
wa_chk('facturaModel no tiene saveFacturaConECF', !method_exists(facturaModel::class, 'saveFacturaConECF'));

```

The grep covers the code folders only. The comment at `src/Utils/FacturaPdfGenerator.php:466` is reworded in Task 19, whose section 13 then checks all of `src`, `docs` and `CLAUDE.md`.

Run:

```bash
php tools/test_write_ahead_puro.php | sed -n '/^11)/,$p' | grep -E "^\s+\[|pruebas"
```

Expected:
- `[OK  ] controlador: se encontro handleEmisionECF`;
- seven `[FALLO]` lines: the constant, the hook, the 502 data, the guard, the stock order, the grep (`src/Controllers/facturaController.php`, `src/Models/facturaModel.php`) and `method_exists`.

- [ ] **Step 3: Create `tools/test_write_ahead_api.php` (failing API test)**

```php
<?php
/**
 * test_write_ahead_api.php — /api/facturas de punta a punta: la API real
 * (php -S index.php) sobre la base de prueba y la DGII falsa
 * (tools/mock_dgii.php). Nunca produccion (decision 6): wa_pdo() se niega a
 * usar una base sin la tabla marca.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch
 *
 * Cada escenario arranca con el mock en un modo conocido, wa_limpiar +
 * wa_sembrar y el log del mock vacio. Tras un "cuelga" el mock sigue
 * durmiendo unos segundos (php -S atiende de a uno): wa_mock_modo() espera.
 */

require_once __DIR__ . '/write_ahead_test_lib.php';

// Textos que ve el usuario, copiados letra por letra de facturaController.php
// (FACTURA_EMISION_INCIERTA, FACTURA_EMISION_FALLO_GENERICO, guarda del total)
// y de EcfNumeroOcupadoException::MENSAJE_USUARIO. Si cambian alla, aqui tambien.
const T_EMISION_INCIERTA = 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.';
const T_FALLO_GENERICO = 'No se pudo emitir la factura en la DGII. Espera unos minutos y vuelve a intentarlo; si sigue fallando, avisa a soporte.';
const T_TOTAL_INVALIDO = 'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.';
const T_NUMERO_OCUPADO = 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.';
const RUTA_RECEPCION = '/Recepcion/api/FacturasElectronicas';
const RUTA_RECEPCION_FC = '/RecepcionFC/api/recepcion/ecf';

/** Una linea del body de POST /api/facturas (bien, ITBIS 18%). */
function wa_linea(float $precio, float $cantidad = 1, ?int $productId = null): array
{
    return [
        'nombre_item' => $productId !== null ? 'WA producto' : 'WA linea libre',
        'indicador_facturacion' => 1,
        'indicador_bien_servicio' => 1,
        'cantidad' => $cantidad,
        'precio_unitario' => $precio,
    ] + ($productId !== null ? ['product_id' => $productId] : []);
}

/** Body de POST /api/facturas para el cliente sembrado. */
function wa_factura(string $tipo, array $ids, array $lineas, array $extra = []): array
{
    return $extra + ['tipo_ecf' => $tipo, 'client_id' => $ids['client_id'], 'tipo_pago' => 1, 'items' => $lineas];
}

/** POST /api/facturas con el token de wa_prueba. */
function wa_emitir(array $srv, array $cuerpo): array
{
    return wa_http('POST', $srv['api'] . '/api/facturas', $cuerpo, ['X-API-KEY: ' . $srv['token']], 60);
}

/** GET a la API con el token de wa_prueba. */
function wa_get(array $srv, string $ruta): array
{
    return wa_http('GET', $srv['api'] . $ruta, null, ['X-API-KEY: ' . $srv['token']], 60);
}

/** Escenario nuevo: mock en $modo (espera a un cuelga anterior), base limpia, log vacio. */
function wa_reiniciar(PDO $pdo, array $srv, string $modo = 'acepta'): array
{
    wa_mock_modo($srv['mock'], $modo);
    wa_limpiar($pdo);
    $ids = wa_sembrar($pdo);
    wa_mock_log($srv['mock'], true);
    return $ids;
}

/** Peticiones de recepcion (e-CF o RFCE) que vio el mock. */
function wa_recepciones(array $log): array
{
    return array_values(array_filter($log, static fn(array $e): bool
        => str_ends_with((string) $e['ruta'], RUTA_RECEPCION) || str_ends_with((string) $e['ruta'], RUTA_RECEPCION_FC)));
}

/** Filas EMIT con success=0 de audit_logs, con new_values decodificado. */
function wa_emit_fallidos(PDO $pdo): array
{
    $filas = $pdo->query("SELECT entity_id, new_values FROM audit_logs WHERE action = 'EMIT' AND success = 0 ORDER BY id")
        ->fetchAll(PDO::FETCH_ASSOC);
    return array_map(static fn(array $f): array => ['entity_id' => $f['entity_id'],
        'new_values' => json_decode((string) $f['new_values'], true)], $filas);
}

/** Las claves de un array, ordenadas (para comparar formas). */
function wa_claves(mixed $a): array
{
    $k = is_array($a) ? array_keys($a) : [];
    sort($k);
    return $k;
}

$base = (string) wa_arg('tenant-db', '');
$pdo = wa_pdo($base);
wa_limpiar($pdo);
wa_sembrar($pdo);
$srv = wa_api($base);

// ---------------------------------------------------------------------------
// E1) acepta, E31 con dos lineas de producto: 200, las 10 claves de siempre y
// el stock se mueve una vez por linea.
// ---------------------------------------------------------------------------
echo "E1) acepta: E31 con dos lineas de producto\n";
$ids = wa_reiniciar($pdo, $srv);
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id']), wa_linea(500, 1, $ids['product_id'])]));
$d = $r['json']['data'] ?? [];
wa_chk('200 con status true', $r['status'] === 200 && ($r['json']['status'] ?? null) === true, $r);
wa_chk('data trae exactamente las 10 claves de la spec 7.1', wa_claves($d) === wa_claves(array_flip([
    'factura_id', 'e_ncf', 'track_id', 'estado_dgii', 'codigo_seguridad', 'total', 'tipo_ecf', 'ambiente',
    'fecha_emision_dgii', 'dgii_response'])), wa_claves($d));
wa_chk('estado_dgii ACEPTADO', ($d['estado_dgii'] ?? null) === 'ACEPTADO', $d);
$fila = wa_filas($pdo, (string) ($d['e_ncf'] ?? ''))[0] ?? [];
wa_chk('la fila quedo ACEPTADO con track_id del mock y secuencia_utilizada 1',
    (int) ($fila['id'] ?? 0) === (int) ($d['factura_id'] ?? -1) && ($fila['estado_dgii'] ?? null) === 'ACEPTADO'
    && ($fila['track_id'] ?? null) === 'track-' . ($d['e_ncf'] ?? '') && (string) ($fila['secuencia_utilizada'] ?? '') === '1', $fila);
wa_chk('dos movimientos de inventario (una por linea)', wa_movimientos($pdo, (int) ($d['factura_id'] ?? 0)) === 2,
    wa_movimientos($pdo, (int) ($d['factura_id'] ?? 0)));

// ---------------------------------------------------------------------------
// E2) rechaza y reintento: 422 con data, sin stock, el numero vuelve; el
// reintento lo reusa, archiva la fila rechazada y mueve stock solo una vez.
// ---------------------------------------------------------------------------
echo "E2) rechaza, y reintento en acepta\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza');
$cuerpo = wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]);
$r = wa_emitir($srv, $cuerpo);
$d1 = $r['json']['data'] ?? [];
wa_chk('rechaza: 422 con data.factura_id', $r['status'] === 422 && is_int($d1['factura_id'] ?? null), $r);
wa_chk('rechaza: sin movimientos de inventario', wa_movimientos($pdo, (int) ($d1['factura_id'] ?? 0)) === 0);
wa_chk('rechaza: el contador de E31 vuelve a 0', wa_contador($pdo, 'E31') === 0, wa_contador($pdo, 'E31'));
wa_mock_modo($srv['mock'], 'acepta');
$r = wa_emitir($srv, $cuerpo);
$d2 = $r['json']['data'] ?? [];
wa_chk('reintento: 200 con el mismo e-NCF', $r['status'] === 200 && ($d2['e_ncf'] ?? null) === ($d1['e_ncf'] ?? '-'), [$d1, $d2]);
$filas = wa_filas($pdo, (string) ($d1['e_ncf'] ?? ''));
wa_chk('reintento: la fila rechazada queda RECHAZADO_ARCHIVADO sin e_ncf, y la nueva ACEPTADO',
    count($filas) === 2 && (int) $filas[0]['id'] === (int) ($d1['factura_id'] ?? 0)
    && $filas[0]['estado_dgii'] === 'RECHAZADO_ARCHIVADO' && $filas[0]['e_ncf'] === null
    && (int) $filas[1]['id'] === (int) ($d2['factura_id'] ?? 0) && $filas[1]['estado_dgii'] === 'ACEPTADO', $filas);
wa_chk('reintento: el stock se mueve solo para la fila nueva',
    wa_movimientos($pdo, (int) ($d1['factura_id'] ?? 0)) === 0 && wa_movimientos($pdo, (int) ($d2['factura_id'] ?? 0)) === 1);

// ---------------------------------------------------------------------------
// E3) cuelga (timeout de la DGII) en los tres flujos: 502 incierto con data,
// fila ENVIO_INCIERTO, sin stock, un EMIT fallido en auditoria y UNA recepcion.
// ---------------------------------------------------------------------------
foreach ([
    ['E31', '31', 1000.0, RUTA_RECEPCION],
    ['E32 >= 250k (e-CF)', '32', 300000.0, RUTA_RECEPCION],
    ['E32 < 250k (RFCE)', '32', 1000.0, RUTA_RECEPCION_FC],
] as [$nombre, $tipo, $precio, $rutaEsperada]) {
    echo "E3) cuelga: {$nombre}\n";
    $ids = wa_reiniciar($pdo, $srv, 'cuelga');
    $r = wa_emitir($srv, wa_factura($tipo, $ids, [wa_linea($precio, 1, $ids['product_id'])]));
    $d = $r['json']['data'] ?? [];
    $eNcf = (string) ($d['e_ncf'] ?? '');
    wa_chk("{$nombre}: 502 con el texto incierto y el e-NCF",
        $r['status'] === 502 && str_starts_with($eNcf, 'E' . $tipo)
        && ($r['json']['error'] ?? null) === sprintf(T_EMISION_INCIERTA, $eNcf), $r);
    wa_chk("{$nombre}: data = factura_id, e_ncf, tipo_ecf, estado_dgii ENVIO_INCIERTO",
        wa_claves($d) === ['e_ncf', 'estado_dgii', 'factura_id', 'tipo_ecf'] && is_int($d['factura_id'] ?? null)
        && ($d['tipo_ecf'] ?? null) === $tipo && ($d['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $d);
    $filas = wa_filas($pdo, $eNcf);
    wa_chk("{$nombre}: la fila esta guardada en ENVIO_INCIERTO",
        count($filas) === 1 && (int) $filas[0]['id'] === (int) ($d['factura_id'] ?? 0)
        && $filas[0]['estado_dgii'] === 'ENVIO_INCIERTO' && (string) $filas[0]['tiene_xml'] === '1', $filas);
    wa_chk("{$nombre}: sin movimientos de inventario", wa_movimientos($pdo, (int) ($d['factura_id'] ?? 0)) === 0);
    $audit = wa_emit_fallidos($pdo);
    wa_chk("{$nombre}: un EMIT success=0 con el factura_id de la fila",
        count($audit) === 1 && ($audit[0]['new_values']['factura_id'] ?? null) === ($d['factura_id'] ?? -1)
        && ($audit[0]['new_values']['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $audit);
    wa_chk("{$nombre}: el numero queda tomado (contador +1)", wa_contador($pdo, 'E' . $tipo) === 1, wa_contador($pdo, 'E' . $tipo));
    $recep = wa_recepciones(wa_mock_log($srv['mock']));   // espera a que el mock termine de dormir
    wa_chk("{$nombre}: una sola recepcion, por {$rutaEsperada}",
        count($recep) === 1 && str_ends_with((string) $recep[0]['ruta'], $rutaEsperada), $recep);
}

// ---------------------------------------------------------------------------
// E4) strict_input sin monto_total: 422 antes de tocar la DGII o la secuencia.
// Con strict_input el comprador sale SOLO del body (facturaController.php:263-266):
// sin `comprador`, ECFXmlBuilder::buildComprador lanza EcfUsuarioException para
// la E31 sin RNC antes de enviar, y el caso nunca llegaria al bug de la spec 4.7
// (un total NULL que se descubria al guardar, DESPUES de la respuesta de la DGII).
// ---------------------------------------------------------------------------
echo "E4) strict_input sin monto_total\n";
$ids = wa_reiniciar($pdo, $srv);
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000)], [
    'strict_input' => true,
    'totales' => ['monto_gravado_total' => 1000],
    'comprador' => ['rnc' => '000000001', 'razon_social' => 'WA CLIENTE DE PRUEBA SRL'],
]));
wa_chk('422 con el texto de la guarda del total', $r['status'] === 422 && ($r['json']['error'] ?? null) === T_TOTAL_INVALIDO, $r);
wa_chk('sin recepcion en la DGII', wa_recepciones(wa_mock_log($srv['mock'])) === []);
wa_chk('el contador de E31 no se movio', wa_contador($pdo, 'E31') === 0, wa_contador($pdo, 'E31'));

// ---------------------------------------------------------------------------
// E5) ncf_sequences ilegible: 502 generico, no "Se acabaron los numeros".
// ---------------------------------------------------------------------------
echo "E5) ncf_sequences ilegible\n";
$ids = wa_reiniciar($pdo, $srv);
try {
    $pdo->exec('RENAME TABLE ncf_sequences TO ncf_sequences_wa_off');
    $r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
} finally {
    $pdo->exec('RENAME TABLE ncf_sequences_wa_off TO ncf_sequences');
}
wa_chk('502 con el texto generico exacto', $r['status'] === 502 && ($r['json']['error'] ?? null) === T_FALLO_GENERICO, $r);
wa_chk('ninguna fila', (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn() === 0);
wa_chk('sin recepcion en la DGII', wa_recepciones(wa_mock_log($srv['mock'])) === []);

// ---------------------------------------------------------------------------
// E6) acepta_condicional: 200 y el stock se mueve una vez.
// ---------------------------------------------------------------------------
echo "E6) acepta_condicional\n";
$ids = wa_reiniciar($pdo, $srv, 'acepta_condicional');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d = $r['json']['data'] ?? [];
wa_chk('200 con estado_dgii ACEPTADO_CONDICIONAL', $r['status'] === 200 && ($d['estado_dgii'] ?? null) === 'ACEPTADO_CONDICIONAL', $r);
wa_chk('un movimiento de inventario', wa_movimientos($pdo, (int) ($d['factura_id'] ?? 0)) === 1);

wa_mock_modo($srv['mock'], 'acepta');
wa_fin();
```

Run it against today's controller:

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch; echo "exit=$?"
```

Expected failures:
- **E2:** `[FALLO] rechaza: sin movimientos de inventario`. Today `registrarVenta` runs before the verdict.
- **E3, each flow:** `[FALLO] ... 502 con el texto incierto` and `[FALLO] ... data = ...`. Today the timeout gives the generic 502 without `data`.
- **E4:** all three checks fail. Today the request (with its `comprador` override) reaches the mock, which accepts it, and then fails at the INSERT of a NULL `total` with a 500 and the "se envió a la DGII, pero no se pudo guardar" text:
  - `[FALLO] 422 con el texto de la guarda del total` (got 500);
  - `[FALLO] sin recepcion en la DGII` (one `Recepcion`);
  - `[FALLO] el contador de E31 no se movio` (`obtenido: 1`).
  Without the override the run would instead give a 502 "Este cliente no tiene RNC…" from `ECFXmlBuilder.php:298-302` before any send, which is why the override is there.

E1, E5 and E6 pass already. The run ends `exit=1`.

- [ ] **Step 4: Requires and the constant**

In `src/Controllers/facturaController.php`, replace:

```php
require_once __DIR__ . '/../Utils/FacturacionElectronica/InformacionReferencia.php';
```

with:

```php
require_once __DIR__ . '/../Utils/FacturacionElectronica/InformacionReferencia.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
```

Right after the line `const FACTURA_EMISION_FALLO_GENERICO = ...;` (`:18`), insert:

```php

// La DGII pudo haber recibido el e-CF pero no se sabe: la fila YA esta guardada
// (write-ahead) en ENVIO_INCIERTO o PENDIENTE_ENVIO. %s = el e-NCF de la fila.
// Texto fijado en la spec (4.7); el front lo muestra tal cual con "Ver factura".
const FACTURA_EMISION_INCIERTA = 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.';
```

- [ ] **Step 5: The total guard**

Replace:

```php
    if ($strictInput && $totalesOverride) {
        $totales = $totalesOverride;
    } elseif ($totalesOverride) {
        $totales = array_merge($totales, $totalesOverride);
    }
```

with:

```php
    if ($strictInput && $totalesOverride) {
        $totales = $totalesOverride;
    } elseif ($totalesOverride) {
        $totales = array_merge($totales, $totalesOverride);
    }
    // Sin un monto_total numerico (p.ej. strict_input con `totales` incompleto)
    // la fila no se puede guardar: facturas.total es NOT NULL. Antes eso se
    // descubria DESPUES de la respuesta de la DGII; ahora se corta aqui, antes
    // de reservar el e-NCF.
    if (!isset($totales['monto_total']) || !is_numeric($totales['monto_total'])) {
        respond(false, 'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.', 422);
        return;
    }
```

- [ ] **Step 6: Replace the emission block, from the `try` through the end of `handleEmisionECF`, and add the stock helpers**

Set the scratchpad path first. It is the scratchpad directory your system prompt lists; the value below was the planning session's:

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
```

Save this block with Write as `$S/emision_nueva.php` (with forward slashes, the same path the splice command below passes as `BLOQUE`):

```php
    // Write-ahead (spec 4.7): la fila se arma ANTES de emitir y el servicio la
    // guarda (hook 'reservar') antes de mandar nada a la DGII. Sin
    // 'no_factura': reservarFacturaECF lo llena con el e-NCF reservado.
    $facturaInput = [
        'date' => $input['date'] ?? date('Y-m-d H:i:s'),
        'client_id' => $clientId,
        'client_name' => $client['client_name'] ?? 'Consumidor Final',
        'total' => $totales['monto_total'],
        'tipo_pago' => (int) ($input['tipo_pago'] ?? 1),
        'user_id' => $input['user_id'] ?? null,
        // Para Notas E33/E34: se persiste para mostrar NCF Modificado + Motivo
        // en la Representacion Impresa (norma DGII).
        'informacion_referencia' => $payload['informacion_referencia'],
        'items' => array_map(function ($item) {
            // `descripcion` viene de mapItemsForXml como '' cuando el front solo
            // envia `nombre_item` (caso comun). `??` no cae con string vacio, asi
            // que se usa el nombre_item como respaldo explicito para no guardar ''.
            $descripcion = (string) ($item['descripcion'] ?? '');
            return [
                'description' => $descripcion !== '' ? $descripcion : (string) ($item['nombre_item'] ?? ''),
                'amount' => $item['precio_unitario'] ?? 0,
                'quantity' => $item['cantidad'] ?? 1,
                // Vinculo con el catalogo: sin esto la venta no puede descontar.
                'product_id' => $item['product_id'] ?? null,
                'subtotal' => $item['monto_item'] ?? 0,
                // monto_item ya viene neto; el descuento se guarda aparte para
                // que la Representacion Impresa y el detalle lo puedan mostrar.
                'descuento_monto' => $item['descuento_monto'] ?? 0,
                'indicador_facturacion' => $item['indicador_facturacion'] ?? 1,
                'indicador_bien_servicio' => $item['indicador_bien_servicio'] ?? 2,
                // Código DGII de unidad de medida (id del catálogo; 43 = Unidad).
                'unidad_medida' => $item['unidad_medida'] ?? '43',
                'itbis_amount' => $item['itbis_amount'] ?? 0,
            ];
        }, mapItemsForXml($items)),
    ];

    // Hook de persistencia (spec 4.4): 'reservar' guarda la fila (XML firmado,
    // codigo de seguridad y lineas) antes del envio; 'confirmar' le pone la
    // respuesta de la DGII; 'incierto' la deja en ENVIO_INCIERTO si el envio o
    // la confirmacion fallan. $reserva va por referencia: el catch la lee.
    $reserva = null;
    $persistencia = function (string $fase, array $ctx) use ($facturaModel, $facturaInput, &$reserva) {
        switch ($fase) {
            case 'reservar':  return $reserva = $facturaModel->reservarFacturaECF($facturaInput, $ctx);
            case 'confirmar': return $facturaModel->confirmarFacturaECF((int) $reserva['factura_id'], $ctx);
            case 'incierto':  return $facturaModel->marcarEnvioIncierto((int) $reserva['factura_id'], $ctx);
        }
        return null;
    };

    try {
        $result = (new ECFEmissionService())->emitir($payload, $persistencia);
    } catch (Throwable $e) {
        // ¿Quedo una fila guardada? Con EcfEnvioInciertoException el servicio
        // lo dice. Si no, la falla pudo llegar despues de la reserva (un hook
        // que dejo una transaccion abierta, spec 4.4 paso 4), y esa misma falla
        // pudo borrar la fila: se confirma en la base antes de nombrarla.
        $filaId = null;
        if ($e instanceof EcfEnvioInciertoException) {
            $filaId = $e->facturaId;
        } elseif ($reserva !== null) {
            try {
                $existe = $facturaModel->existeFactura((int) $reserva['factura_id']);
            } catch (Throwable $sinBase) {
                // Sin base no se puede confirmar la fila, y solo se nombra una
                // fila confirmada (spec 4.7; seccion 5 fila 18: nunca un
                // factura_id fantasma). Este camino es el paso 4 de 4.4: despues
                // de la reserva y antes del envio, asi que nada llego a la DGII y
                // el 502 generico de abajo es correcto. Si la fila existe, queda
                // en PENDIENTE_ENVIO y sale en el filtro Pendientes.
                error_log('[ECF] no se pudo confirmar la fila reservada factura_id='
                    . (int) $reserva['factura_id'] . ' e-NCF=' . (string) ($reserva['e_ncf'] ?? '')
                    . ': ' . $sinBase->getMessage());
                $existe = false;
            }
            if ($existe) {
                $filaId = (int) $reserva['factura_id'];
            }
        }

        if ($filaId !== null) {
            // El e-NCF sale de la fila, no del payload: $eNcf es el override del
            // body, que en el flujo normal (el servicio dispensa) es null.
            $eNcfFila = $e instanceof EcfEnvioInciertoException ? $e->eNcf : (string) $reserva['e_ncf'];
            // El estado que la fila tiene de verdad: 'incierto' puede fallar
            // (base caida) y un hook con la transaccion abierta nunca llega a el.
            $estadoFila = ($e instanceof EcfEnvioInciertoException && $e->marcado) ? 'ENVIO_INCIERTO' : 'PENDIENTE_ENVIO';
            $faseFila = $e instanceof EcfEnvioInciertoException ? $e->faseFallida : 'reservar';
            error_log(sprintf(
                '[ECF e-NCF=%s factura_id=%d] emision sin confirmar: estado=%s fase=%s %s: %s',
                $eNcfFila, $filaId, $estadoFila, $faseFila, get_class($e), $e->getMessage()
            ));
            AuditLogger::log([
                'module' => 'facturas', 'action' => 'EMIT', 'entity_type' => 'factura',
                'entity_id' => $eNcfFila,
                'new_values' => [
                    'factura_id' => $filaId, 'tipo_ecf' => $tipoEcf, 'client_id' => $clientId,
                    'estado_dgii' => $estadoFila, 'fase_fallida' => $faseFila,
                    'resultado_parcial' => $e instanceof EcfEnvioInciertoException ? $e->resultadoParcial : null,
                ],
                'success' => false, 'error_message' => ($e->getPrevious() ?? $e)->getMessage(),
                'description' => 'e-CF reservado y enviado sin confirmación de la DGII (envío incierto).',
            ]);
            // respond() no lleva `data`: el front necesita factura_id para "Ver factura".
            http_response_code(502);
            echo json_encode([
                'status' => false,
                'error' => sprintf(FACTURA_EMISION_INCIERTA, $eNcfFila),
                'data' => [
                    'factura_id' => $filaId,
                    'e_ncf' => $eNcfFila,
                    'tipo_ecf' => $tipoEcf,
                    'estado_dgii' => $estadoFila,
                ],
            ]);
            return;
        }

        // Sin fila: nada llego a la DGII (o la reserva no se pudo hacer). El
        // audit y el error_log guardan el texto tecnico, como siempre.
        error_log('[ECF] fallo en emision tipo=' . $tipoEcf . ': ' . get_class($e) . ': ' . $e->getMessage());
        AuditLogger::log([
            'module' => 'facturas', 'action' => 'EMIT', 'entity_type' => 'factura',
            'entity_id' => $input['e_ncf'] ?? null,
            'new_values' => ['tipo_ecf' => $tipoEcf, 'client_id' => $clientId],
            'success' => false, 'error_message' => $e->getMessage(),
            'description' => 'Fallo en emision e-CF a DGII.',
        ]);
        // Al cajero, solo lo que puede entender: los casos de negocio (rango
        // agotado, numero ocupado, emisor o certificado sin configurar...) traen
        // su propio texto; cualquier otra cosa es un fallo interno y va el generico.
        respond(false, $e instanceof EcfUsuarioException
            ? $e->getMensajeUsuario()
            : FACTURA_EMISION_FALLO_GENERICO, 502);
        return;
    }

    // La fila ya esta guardada y confirmada: emitir() devuelve su factura_id.
    $facturaId = (int) $result['factura_id'];

    // La respuesta de DGII puede venir en dgii_response (e-CF integro) o
    // rfce_response (RFCE E32 < 250k).
    $dgiiResp = $result['dgii_response'] ?? $result['rfce_response'] ?? null;
    // Las mismas 10 claves de siempre (spec 7.1).
    $data = [
        'factura_id' => $facturaId,
        'e_ncf' => $result['e_ncf'],
        'track_id' => $result['track_id'] ?? null,
        'estado_dgii' => $result['estado'],
        'codigo_seguridad' => $result['codigo_seguridad'],
        'total' => $totales['monto_total'],
        'tipo_ecf' => $result['tipo_ecf'],
        'ambiente' => $result['ambiente'],
        'fecha_emision_dgii' => $result['fecha_emision_dgii'],
        'dgii_response' => $dgiiResp,
    ];

    // DGII proceso el e-CF y lo RECHAZO (o no se encontro). El intento queda
    // persistido (historial) y, si la secuencia no se consumio
    // (secuenciaUtilizada=false), ya fue revertida para reutilizar el e-NCF.
    // Se responde como error para que la UI muestre el motivo del rechazo, pero
    // con `data` incluido para confirmar que se guardo y con que e-NCF.
    $estadoFinal = (string) ($result['estado'] ?? '');
    $rechazado = in_array($estadoFinal, ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'ERROR'], true);

    // Inventario: despues del veredicto. moverStockFacturaEcf no mueve nada en
    // un estado de EstadosEcf::SIN_STOCK (aqui no se usa $rechazado: le faltan
    // RFCE_NO_ENCONTRADO y RFCE_ERROR) ni dos veces la misma factura, y nunca
    // lanza: la factura ya existe y un problema de inventario se corrige con
    // un ajuste.
    moverStockFacturaEcf(
        $facturaId,
        $facturaInput['items'],
        $tipoEcf,
        isset($input['user_id']) ? (int) $input['user_id'] : null,
        $estadoFinal,
        'emision'
    );

    if ($rechazado) {
        AuditLogger::log([
            'module' => 'facturas', 'action' => 'EMIT', 'entity_type' => 'factura',
            'entity_id' => $result['e_ncf'] ?? null,
            'new_values' => $data, 'success' => false,
            'error_message' => dgiiMensajeRechazo($dgiiResp, $estadoFinal),
            'description' => 'e-CF ' . $estadoFinal . ' por DGII.',
        ]);
        http_response_code(422);
        echo json_encode([
            'status' => false,
            'error' => dgiiMensajeRechazoUsuario($dgiiResp, $estadoFinal),
            'data' => $data,
        ]);
        return;
    }

    AuditLogger::log([
        'module' => 'facturas', 'action' => 'EMIT', 'entity_type' => 'factura',
        'entity_id' => $result['e_ncf'] ?? null,
        'new_values' => $data,
        'description' => 'e-CF ' . ($result['tipo_ecf'] ?? '') . ' emitido (' . $estadoFinal . ').',
    ]);
    echo json_encode([
        'status' => true,
        'data' => $data,
    ]);
}

/**
 * inventoryModel con require_once guardado: is_file antes del require, porque
 * un require que falla es un fatal que ningun try/catch atrapa, y tumbaria la
 * respuesta de una factura que la DGII ya acepto. Asi baja a excepcion.
 * @throws RuntimeException si falta el archivo del modelo
 */
function inventarioModelo(): inventoryModel
{
    $ruta = __DIR__ . '/../Models/inventoryModel.php';
    if (!is_file($ruta)) {
        throw new RuntimeException('falta ' . $ruta);
    }
    require_once $ruta;
    return new inventoryModel();
}

/**
 * Mueve el stock de una factura e-CF UNA sola vez (spec 4.2.4 y 10.5), desde
 * la emision o desde la primera aceptacion que ve GET /estado ($origen solo
 * va al log). No mueve nada si $estado esta en EstadosEcf::SIN_STOCK o en
 * EstadosEcf::EN_VUELO (sin veredicto), ni si yaMovioDocumento('factura', id)
 * ya encuentra movimientos. Nunca lanza: anota en error_log '[inventario] ...'
 * y sigue (si no se puede saber si ya movio, no mueve).
 */
function moverStockFacturaEcf(int $facturaId, array $items, string $tipoEcf, ?int $userId, string $estado, string $origen): void
{
    if ($facturaId <= 0
        || in_array($estado, EstadosEcf::SIN_STOCK, true)
        || in_array($estado, EstadosEcf::EN_VUELO, true)) {
        return;
    }
    try {
        $inventario = inventarioModelo();
        if ($inventario->yaMovioDocumento('factura', $facturaId)) {
            return;
        }
        $inventario->registrarVenta($facturaId, $items, $tipoEcf, $userId);
    } catch (Throwable $e) {
        error_log('[inventario] no se pudo mover el stock de la factura ' . $facturaId
            . ' (' . $origen . ', ' . $estado . '): ' . $e->getMessage());
    }
}
```

Splice it in. The script replaces from the line `    try {` followed by `        $service = new ECFEmissionService();` (`:363` at `9f669ad`, `:379` after Steps 4-5) down to, but not including, the `/**` of `dgiiMotivos` (`:505` at `9f669ad`, `:521` now). `facturaController.php` is CRLF on disk (Global Constraints, line endings), so the script compares on `\n`-normalized lines and writes the file back with CRLF:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
BLOQUE="$S/emision_nueva.php" php <<'PHP'
<?php
// El controlador es CRLF en disco: se compara sobre lineas con \n y se escribe
// de vuelta con el final de linea original.
$ruta = 'src/Controllers/facturaController.php';
$orig = (string) file_get_contents($ruta);
$crlf = str_contains($orig, "\r\n");
$lineas = explode("\n", str_replace("\r\n", "\n", $orig));
$ini = null;
foreach ($lineas as $i => $l) {
    if ($l === '    try {' && ($lineas[$i + 1] ?? '') === '        $service = new ECFEmissionService();') { $ini = $i; break; }
}
$fin = null;
for ($i = (int) $ini; $ini !== null && $i < count($lineas); $i++) {
    if ($lineas[$i] === '/**' && str_starts_with($lineas[$i + 1] ?? '', ' * Motivos que da la DGII')) { $fin = $i; break; }
}
if ($ini === null || $fin === null) { fwrite(STDERR, "no se encontro el bloque\n"); exit(1); }
$nuevo = explode("\n", rtrim(str_replace("\r\n", "\n", (string) file_get_contents(getenv('BLOQUE'))), "\n"));
array_splice($lineas, $ini, $fin - $ini, array_merge($nuevo, ['']));
file_put_contents($ruta, implode($crlf ? "\r\n" : "\n", $lineas));
echo 'reemplazadas lineas ', $ini + 1, '-', $fin, "\n";
PHP
php -l src/Controllers/facturaController.php
git ls-files --eol src/Controllers/facturaController.php
```

Expected:
- `reemplazadas lineas 379-520`: the `9f669ad` block `:363-504`, 16 lines lower because Step 4 added 8 lines (3 requires, the blank line, 3 comment lines and the constant) and Step 5 added 8 (4 comment lines and the 4-line guard);
- `No syntax errors detected`;
- the `--eol` line still shows `w/crlf`.

- [ ] **Step 7: Delete `saveFacturaConECF` and its docblock**

`facturaModel.php` is CRLF on disk and in the index (`i/crlf w/crlf`). The script normalizes before comparing, bounds the search for the closing `    }`, and writes the file back with CRLF:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php <<'PHP'
<?php
// facturaModel.php es CRLF en disco: se compara sobre lineas con \n y se
// escribe de vuelta con el final de linea original.
$ruta = 'src/Models/facturaModel.php';
$orig = (string) file_get_contents($ruta);
$crlf = str_contains($orig, "\r\n");
$lineas = explode("\n", str_replace("\r\n", "\n", $orig));
$firma = null;
foreach ($lineas as $i => $l) {
    if (str_contains($l, 'public function saveFacturaConECF(')) { $firma = $i; break; }
}
if ($firma === null) { fwrite(STDERR, "saveFacturaConECF no esta\n"); exit(1); }
$inicio = $firma;
while ($inicio > 0 && trim($lineas[$inicio - 1]) !== '/**') { $inicio--; }
$inicio--;
$fin = $firma;
while ($fin < count($lineas) && $lineas[$fin] !== '    }') { $fin++; }
if ($fin >= count($lineas)) { fwrite(STDERR, "cierre de saveFacturaConECF no encontrado\n"); exit(1); }
if (trim($lineas[$fin + 1] ?? 'x') === '') { $fin++; }
echo 'borra lineas ', $inicio + 1, '-', $fin + 1, ': ', trim($lineas[$inicio + 1]), "\n";
array_splice($lineas, $inicio, $fin - $inicio + 1);
file_put_contents($ruta, implode($crlf ? "\r\n" : "\n", $lineas));
PHP
php -l src/Models/facturaModel.php
git ls-files --eol src/Models/facturaModel.php
grep -n "saveFacturaConECF" src/Controllers/facturaController.php src/Models/facturaModel.php src/Utils/FacturacionElectronica/*.php
```

Expected:
- `borra lineas 1486-1636: * Save a factura together with its e-CF emission result.` The method starts at the Task 9 pin `:1486` and is 151 lines with its trailing blank line (171 at `9f669ad`, `:1134-1304`, less the nota block Task 7 moved out). If the first number differs, an earlier task landed differently: check that the text after the colon matches and that the second number is the first plus 150;
- `No syntax errors detected`;
- the `--eol` line still shows `i/crlf w/crlf`;
- the grep prints nothing (Task 11 already reworded `ECFEmissionService.php:87`).

- [ ] **Step 8: Run the DB-free checks**

```bash
php tools/test_write_ahead_puro.php | sed -n '/^11)/,$p'; echo "exit=${PIPESTATUS[0]}"
php tools/test_notas_vinculadas.php | tail -1
php tools/check_estado_dgii_ancho.php | tail -1
```

Expected:
- the eight section 11 checks are `[OK  ]` and `exit=0`;
- `62 de 62 pruebas OK`;
- the checker prints its all-OK line.

- [ ] **Step 9: Run the API scenarios**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch; echo "exit=$?"
```

Expected: every line `[OK  ]` across E1-E6, `40 de 40 pruebas OK` and `exit=0`. The three `cuelga` flows take about 5 s each.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Controllers/facturaController.php src/Models/facturaModel.php tools/test_write_ahead_puro.php tools/test_write_ahead_api.php
git commit -F - <<'EOF'
feat(facturas): emision write-ahead con 502 incierto y datos de la fila

handleEmisionECF arma $facturaInput antes de emitir y pasa a emitir() el
hook $persistencia (reservar / confirmar / incierto). Si la DGII no
confirma, la fila ya esta guardada: responde 502 con
FACTURA_EMISION_INCIERTA (texto de la spec 4.7) y data {factura_id, e_ncf,
tipo_ecf, estado_dgii}, y deja un EMIT success=0 con fase_fallida y
resultado_parcial. Sin fila, el 502 de siempre.

Un monto_total no numerico da 422 antes de tomar el numero. El stock se
mueve despues del veredicto, una sola vez y nunca en SIN_STOCK ni en vuelo
(moverStockFacturaEcf + yaMovioDocumento). Se borra
facturaModel::saveFacturaConECF.

tools/test_write_ahead_api.php corre la API real con la DGII falsa: 40/40.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 18: facturaController: GET /estado en vuelo, stock al aceptar, filtro pendiente

**Files:**
- Modify: `src/Controllers/facturaController.php`. Pins at `9f669ad`, about 70 lines lower after Task 17; re-pin with `grep -n "^function handleConsultarEstado\|^function handleConsultarEstadoRFCE\|^function handleReenviar\|^function normalizeEstadoFilter" src/Controllers/facturaController.php`:

  | Spot | Where at `9f669ad` |
  |---|---|
  | `handleConsultarEstado` | `:642-713` (404 `:644-648`, RFCE route `:650-655`, `updateECFEstado` `:667`, audit `:669-677`, rollback `:679-694`) |
  | `handleConsultarEstadoRFCE` | `:720-796` (`updateECFEstado` `:746`, audit `:748-756`, rollback `:758-773`) |
  | `handleReenviar` | `:798-801`; keeps answering 501 (decision 7) |
  | `normalizeSecuenciaUtilizada` | `:1137-1143` |
  | `normalizeEstadoFilter` | `:1204-1226` |

- Modify: `tools/test_write_ahead_puro.php`, section 12, directly above its closing block (Task 4).
- Modify: `tools/test_write_ahead_api.php`, Task 18 block, before the final `wa_mock_modo($srv['mock'], 'acepta');` / `wa_fin();`.
- Test: section 12 and `tools/test_write_ahead_api.php`.

**Interfaces:**
- Consumes:
  - `moverStockFacturaEcf(int, array, string, ?int, string, string): void` (Task 17);
  - `applyEstadoTipoFilters($conditions, $params, 'pendiente', ...)` (Task 6);
  - `EstadosEcf::EN_VUELO` (Task 4);
  - `facturaModel::getECFData(int): ?array` (columns `id, no_factura, tipo_ecf, e_ncf, track_id, rfce_track_id, estado_dgii, secuencia_utilizada, codigo_seguridad, fecha_emision_dgii, ambiente_dgii, respuesta_dgii`);
  - `getFacturaItems($id): array`, `updateECFEstado(int, string, ?array): bool`, `RequestContext::userId(): ?int` (`RequestContext.php:67-70`), `normalizeSecuenciaUtilizada($v): ?bool`;
  - the Task 17 test helpers (`wa_reiniciar`, `wa_emitir`, `wa_get`, `wa_factura`, `wa_linea`, `wa_claves`).
- Produces:

```php
const FACTURA_NOTA_EN_VUELO = 'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.';
const FACTURA_NOTA_ENVIADO_SIN_TRACK = 'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.';
const FACTURA_ESTADOS_ACEPTADOS = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'RFCE_ACEPTADO_CONDICIONAL'];
function handleEstadoEnVuelo(int $facturaId, array $ecf): void
// 200 {status:true, data:{factura_id:int, e_ncf:string, tipo_ecf:string, track_id:?string, estado_dgii:string,
//      secuencia_utilizada:?bool, en_vuelo:bool, nota:string}}   (no puede_reenviar key: decision 7)
function moverStockPrimeraAceptacion(facturaModel $facturaModel, int $facturaId, array $ecf, string $estadoAnterior, string $estadoNuevo, bool $actualizado): void
function normalizeEstadoFilter($raw)   // now also returns 'pendiente'
```

Decision 7 overrides the skeleton: there is no `puede_reenviar` in this shape, and `POST /api/facturas/{id}/reenviar` keeps its 501.

- [ ] **Step 1: Add section 12 (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above its closing block (Task 4):

```php
// ---------------------------------------------------------------------------
// 12) facturaController: GET /estado en vuelo y filtro pendiente (Task 18).
// Texto del controlador, como en la seccion 11.
// ---------------------------------------------------------------------------
echo "12) facturaController: GET /estado en vuelo, filtro pendiente\n";
$s12Ctl = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../src/Controllers/facturaController.php'));
$s12Const = static fn(string $nombre): ?string
    => preg_match("/\nconst {$nombre} = '([^']*)';/", $s12Ctl, $m) ? $m[1] : null;
wa_chk('FACTURA_NOTA_EN_VUELO es la nota de la spec 7.3', $s12Const('FACTURA_NOTA_EN_VUELO')
    === 'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, '
    . 'avisa a soporte con el número %s.', $s12Const('FACTURA_NOTA_EN_VUELO'));
wa_chk('FACTURA_NOTA_ENVIADO_SIN_TRACK es la nota de la spec 7.3', $s12Const('FACTURA_NOTA_ENVIADO_SIN_TRACK')
    === 'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar '
    . 'su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.', $s12Const('FACTURA_NOTA_ENVIADO_SIN_TRACK'));
$s12Consulta = preg_match('/\nfunction handleConsultarEstado\(.*?\n\}\n/s', $s12Ctl, $m) ? $m[0] : '';
$s12Vuelo = strpos($s12Consulta, 'handleEstadoEnVuelo(');
$s12Rfce = strpos($s12Consulta, "str_starts_with((string) (\$ecf['estado_dgii']");
wa_chk('handleConsultarEstado atiende las filas en vuelo antes de la ruta RFCE',
    $s12Vuelo !== false && $s12Rfce !== false && $s12Vuelo < $s12Rfce);
$s12Filtro = preg_match('/\nfunction normalizeEstadoFilter\(.*?\n\}\n/s', $s12Ctl, $m) ? $m[0] : '';
wa_chk("normalizeEstadoFilter acepta 'pendiente'", str_contains($s12Filtro, "return 'pendiente';"), $s12Filtro);
wa_chk('ninguna respuesta lleva puede_reenviar (decision 7)', !str_contains($s12Ctl, 'puede_reenviar'));
wa_chk('POST /reenviar sigue respondiendo 501 (decision 7)',
    (bool) preg_match('/function handleReenviar\(.*?\n\{\n\s*respond\(false, [^\n]*, 501\);\n\}/s', $s12Ctl));

```

Run:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | sed -n '/^12)/,$p' | grep -E "^\s+\[|pruebas"
```

Expected: `[FALLO]` on both constants, on the order check and on `'pendiente'`; `[OK  ]` on `puede_reenviar` and on the 501.

- [ ] **Step 2: Add the Task 18 API scenarios (failing)**

In `tools/test_write_ahead_api.php`, insert this block immediately before the final two lines (`wa_mock_modo($srv['mock'], 'acepta');` and `wa_fin();`):

```php
// ===========================================================================
// Task 18: GET /estado de filas en vuelo, filtro pendiente y stock al aceptar.
// ===========================================================================

// Notas de facturaController.php (spec 7.3), letra por letra.
const T_NOTA_EN_VUELO = 'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.';
const T_NOTA_ENVIADO_SIN_TRACK = 'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.';

/** Una fila de facturas sembrada a mano en $estado, con $lineas lineas del producto. */
function wa_fila_sembrada(PDO $pdo, array $ids, string $eNcf, string $estado, ?string $trackId, int $lineas = 0): int
{
    $pdo->prepare(
        "INSERT INTO facturas (no_factura, date, client_id, client_name, total, tipo_pago, tipo_ecf, e_ncf, track_id,
                               estado_dgii, codigo_seguridad, fecha_emision_dgii, ambiente_dgii)
         VALUES (:nf, NOW(), :cid, 'WA cliente', 1180.00, 1, :tipo, :encf, :track, :estado, 'ABC123', NOW(), 'certecf')"
    )->execute([':nf' => $eNcf, ':cid' => $ids['client_id'], ':tipo' => substr($eNcf, 1, 2), ':encf' => $eNcf,
        ':track' => $trackId, ':estado' => $estado]);
    $id = (int) $pdo->lastInsertId();
    $item = $pdo->prepare(
        "INSERT INTO factura_items (factura_id, product_id, description, amount, quantity, subtotal, itbis_amount)
         VALUES (:f, :p, 'WA producto', 1000.0000, 1.000, 1000.00, 180.00)"
    );
    for ($i = 0; $i < $lineas; $i++) {
        $item->execute([':f' => $id, ':p' => $ids['product_id']]);
    }
    return $id;
}

echo "C1) GET /estado de una factura en vuelo\n";
$ids = wa_reiniciar($pdo, $srv, 'cuelga');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$id = (int) ($r['json']['data']['factura_id'] ?? 0);
$eNcf = (string) ($r['json']['data']['e_ncf'] ?? '');
wa_mock_log($srv['mock'], true);   // espera a que el mock termine de dormir y vacia el log
$r = wa_get($srv, "/api/facturas/{$id}/estado");
$d = $r['json']['data'] ?? [];
wa_chk('200 con status true', $r['status'] === 200 && ($r['json']['status'] ?? null) === true, $r);
wa_chk('data trae exactamente las claves de la spec 7.3 (Release 1)', wa_claves($d)
    === ['e_ncf', 'en_vuelo', 'estado_dgii', 'factura_id', 'nota', 'secuencia_utilizada', 'tipo_ecf', 'track_id'], wa_claves($d));
wa_chk('ENVIO_INCIERTO y en_vuelo, sin track_id ni secuencia_utilizada',
    ($d['factura_id'] ?? null) === $id && ($d['e_ncf'] ?? null) === $eNcf && ($d['tipo_ecf'] ?? null) === '31'
    && ($d['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && ($d['en_vuelo'] ?? null) === true
    && array_key_exists('track_id', $d) && $d['track_id'] === null
    && array_key_exists('secuencia_utilizada', $d) && $d['secuencia_utilizada'] === null, $d);
wa_chk('nota en vuelo con el e-NCF', ($d['nota'] ?? null) === sprintf(T_NOTA_EN_VUELO, $eNcf), $d['nota'] ?? null);
wa_chk('sin campo de reenvio (decision 7)', !array_key_exists('puede_reenviar', $d), $d);
wa_chk('no llamo a la DGII', wa_mock_log($srv['mock']) === []);

echo "C2) GET /estado de un ENVIADO sin track_id\n";
$ids = wa_reiniciar($pdo, $srv);
$id = wa_fila_sembrada($pdo, $ids, 'E310000000901', 'ENVIADO', null);
$r = wa_get($srv, "/api/facturas/{$id}/estado");
$d = $r['json']['data'] ?? [];
wa_chk('200, ENVIADO con en_vuelo false',
    $r['status'] === 200 && ($d['estado_dgii'] ?? null) === 'ENVIADO' && ($d['en_vuelo'] ?? null) === false, $r);
wa_chk('nota de ENVIADO sin numero de seguimiento', ($d['nota'] ?? null) === sprintf(T_NOTA_ENVIADO_SIN_TRACK, 'E310000000901'), $d);

echo "C3) GET /api/facturas?estado=pendiente\n";
$ids = wa_reiniciar($pdo, $srv, 'cuelga');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$eNcfVuelo = (string) ($r['json']['data']['e_ncf'] ?? '');
wa_mock_modo($srv['mock'], 'acepta');   // espera a que termine el cuelga
wa_fila_sembrada($pdo, $ids, 'E310000000901', 'ENVIADO', null);
wa_fila_sembrada($pdo, $ids, 'E310000000902', 'EN_PROCESO', 'track-E310000000902');
wa_fila_sembrada($pdo, $ids, 'E320000000903', 'RFCE_ENVIADO', null);
wa_fila_sembrada($pdo, $ids, 'E310000000904', 'ACEPTADO', 'track-E310000000904');
wa_fila_sembrada($pdo, $ids, 'E310000000905', 'RECHAZADO', 'track-E310000000905');
$r = wa_get($srv, '/api/facturas?estado=pendiente&pageSize=50');
$lista = array_column($r['json']['data'] ?? [], 'e_ncf');
sort($lista);
$esperada = [$eNcfVuelo, 'E310000000901', 'E310000000902', 'E320000000903'];
sort($esperada);
wa_chk('200', $r['status'] === 200, $r);
wa_chk('lista la fila en vuelo, ENVIADO, EN_PROCESO y RFCE_ENVIADO; no ACEPTADO ni RECHAZADO', $lista === $esperada, $lista);
wa_chk('pagination.total cuenta las mismas 4', ($r['json']['pagination']['total'] ?? null) === 4, $r['json']['pagination'] ?? null);
$r = wa_get($srv, '/api/facturas?estado=foo');
wa_chk('estado=foo sigue respondiendo 422', $r['status'] === 422, $r);

echo "C4) Stock al aceptar por la consulta (e-CF)\n";
$ids = wa_reiniciar($pdo, $srv, 'cuelga');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id']), wa_linea(500, 1, $ids['product_id'])]));
$id = (int) ($r['json']['data']['factura_id'] ?? 0);
$eNcf = (string) ($r['json']['data']['e_ncf'] ?? '');
wa_mock_modo($srv['mock'], 'acepta');
// Caso 1 del procedimiento 10.2: soporte le pone el trackId que da la DGII.
$st = $pdo->prepare("UPDATE facturas SET estado_dgii = 'ENVIADO', track_id = :T WHERE id = :id
                     AND (estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL))");
$st->execute([':T' => 'track-' . $eNcf, ':id' => $id]);
wa_chk('el UPDATE del caso 1 de 10.2 toma la fila, todavia sin movimientos',
    $st->rowCount() === 1 && wa_movimientos($pdo, $id) === 0, [$st->rowCount(), wa_movimientos($pdo, $id)]);
$r = wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('GET /estado: ACEPTADO', ($r['json']['data']['estado_dgii'] ?? null) === 'ACEPTADO', $r);
wa_chk('el stock se movio, una vez por linea', wa_movimientos($pdo, $id) === 2, wa_movimientos($pdo, $id));
wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('un segundo GET no mueve mas', wa_movimientos($pdo, $id) === 2, wa_movimientos($pdo, $id));

echo "C5) Stock al aceptar por la consulta (RFCE)\n";
$ids = wa_reiniciar($pdo, $srv, 'cuelga');
$r = wa_emitir($srv, wa_factura('32', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$id = (int) ($r['json']['data']['factura_id'] ?? 0);
wa_mock_modo($srv['mock'], 'acepta');
// Caso RFCE del procedimiento 10.2.
$st = $pdo->prepare("UPDATE facturas SET estado_dgii = 'RFCE_ENVIADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO')");
$st->execute([':id' => $id]);
wa_chk('el UPDATE del caso RFCE de 10.2 toma la fila, todavia sin movimientos',
    $st->rowCount() === 1 && wa_movimientos($pdo, $id) === 0, [$st->rowCount(), wa_movimientos($pdo, $id)]);
$r = wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('GET /estado: RFCE_ACEPTADO', ($r['json']['data']['estado_dgii'] ?? null) === 'RFCE_ACEPTADO', $r);
wa_chk('el stock se movio una vez', wa_movimientos($pdo, $id) === 1, wa_movimientos($pdo, $id));
wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('un segundo GET no mueve mas', wa_movimientos($pdo, $id) === 1, wa_movimientos($pdo, $id));

echo "C6) Una venta vieja ya ACEPTADO sin movimientos no mueve al consultarla\n";
$ids = wa_reiniciar($pdo, $srv);
$id = wa_fila_sembrada($pdo, $ids, 'E310000000906', 'ACEPTADO', 'track-E310000000906', 1);
$r = wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('GET /estado: sigue ACEPTADO', $r['status'] === 200 && ($r['json']['data']['estado_dgii'] ?? null) === 'ACEPTADO', $r);
wa_chk('sin transicion no hay movimiento', wa_movimientos($pdo, $id) === 0, wa_movimientos($pdo, $id));

echo "C7) NO_ENCONTRADO que la DGII acepta despues: mueve una vez\n";
$id = wa_fila_sembrada($pdo, $ids, 'E310000000907', 'NO_ENCONTRADO', 'track-E310000000907', 1);
$r = wa_get($srv, "/api/facturas/{$id}/estado");
wa_chk('GET /estado: ACEPTADO', ($r['json']['data']['estado_dgii'] ?? null) === 'ACEPTADO', $r);
wa_chk('el stock se movio una vez', wa_movimientos($pdo, $id) === 1, wa_movimientos($pdo, $id));

```

Run:

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch | sed -n '/^C1)/,$p'
```

Expected failures:
- **C1:** `[FALLO] 200 con status true`. The in-flight row gets 422 "Esta factura no se envió a la DGII…".
- **C2:** fails the same way.
- **C3:** `?estado=pendiente` gets 422 "Ese filtro de estado no es válido…".
- **C4, C5:** `[FALLO] el stock se movio`: the consult does not move stock yet.

C6 passes already. C7 fails on the stock check.

- [ ] **Step 3: Constants**

Right after the line `const FACTURA_EMISION_INCIERTA = ...;` (added in Task 17), insert:

```php

// Notas de GET /api/facturas/{id}/estado para una fila sin veredicto que la
// app no puede consultar (spec 7.3, Release 1). %s = el e-NCF. Decision 7: la
// app nunca reenvia un e-CF; la nota manda a soporte y pide no emitirlo de nuevo.
const FACTURA_NOTA_EN_VUELO = 'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.';
const FACTURA_NOTA_ENVIADO_SIN_TRACK = 'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.';

// Estados en que la DGII acepto el comprobante: el primer paso a uno de estos
// desde la consulta de estado mueve el stock (una sola vez).
const FACTURA_ESTADOS_ACEPTADOS = ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'RFCE_ACEPTADO_CONDICIONAL'];
```

- [ ] **Step 4: The in-flight branch in `handleConsultarEstado`**

Replace:

```php
        respond(false, 'No encontramos esta factura. Puede que ya no exista.', 404);
        return;
    }

    // E32 RFCE (< 250k): no genera trackId.
```

with:

```php
        respond(false, 'No encontramos esta factura. Puede que ya no exista.', 404);
        return;
    }

    // Sin veredicto y sin forma de consultarlo: en vuelo (PENDIENTE_ENVIO,
    // ENVIO_INCIERTO) o ENVIADO sin track_id. Nunca 422 para una fila que
    // existe (spec 7.3). Va antes de la ruta RFCE y de updateECFEstado.
    if (in_array($ecf['estado_dgii'], EstadosEcf::EN_VUELO, true)
        || ($ecf['estado_dgii'] === 'ENVIADO' && empty($ecf['track_id']) && !empty($ecf['e_ncf']))) {
        handleEstadoEnVuelo($facturaId, $ecf);
        return;
    }

    // E32 RFCE (< 250k): no genera trackId.
```

- [ ] **Step 5: Stock on the first acceptance (e-CF and RFCE)**

In `handleConsultarEstado`, replace:

```php
            $estadoAnterior = $ecf['estado_dgii'] ?? '';
            $facturaModel->updateECFEstado($facturaId, $estadoNuevo, $consulta['data']);
            $ecf['estado_dgii'] = $estadoNuevo;
            if ($estadoAnterior !== $estadoNuevo) {
                AuditLogger::log([
                    'module' => 'facturas', 'action' => 'STATUS_CHANGE', 'entity_type' => 'factura',
                    'entity_id' => $ecf['e_ncf'] ?? $facturaId,
                    'old_values' => ['estado_dgii' => $estadoAnterior],
                    'new_values' => ['estado_dgii' => $estadoNuevo],
                    'description' => 'Transicion de estado e-CF: ' . $estadoAnterior . ' -> ' . $estadoNuevo . '.',
                ]);
            }
```

with:

```php
            $estadoAnterior = $ecf['estado_dgii'] ?? '';
            $actualizado = $facturaModel->updateECFEstado($facturaId, $estadoNuevo, $consulta['data']);
            $ecf['estado_dgii'] = $estadoNuevo;
            if ($estadoAnterior !== $estadoNuevo) {
                AuditLogger::log([
                    'module' => 'facturas', 'action' => 'STATUS_CHANGE', 'entity_type' => 'factura',
                    'entity_id' => $ecf['e_ncf'] ?? $facturaId,
                    'old_values' => ['estado_dgii' => $estadoAnterior],
                    'new_values' => ['estado_dgii' => $estadoNuevo],
                    'description' => 'Transicion de estado e-CF: ' . $estadoAnterior . ' -> ' . $estadoNuevo . '.',
                ]);
            }
            moverStockPrimeraAceptacion($facturaModel, $facturaId, $ecf, $estadoAnterior, $estadoNuevo, $actualizado);
```

Do the same in `handleConsultarEstadoRFCE`. The block there is identical except for `'Transicion de estado RFCE: '`. Replace:

```php
            $estadoAnterior = $ecf['estado_dgii'] ?? '';
            $facturaModel->updateECFEstado($facturaId, $estadoNuevo, $consulta['data']);
            $ecf['estado_dgii'] = $estadoNuevo;
            if ($estadoAnterior !== $estadoNuevo) {
                AuditLogger::log([
                    'module' => 'facturas', 'action' => 'STATUS_CHANGE', 'entity_type' => 'factura',
                    'entity_id' => $ecf['e_ncf'] ?? $facturaId,
                    'old_values' => ['estado_dgii' => $estadoAnterior],
                    'new_values' => ['estado_dgii' => $estadoNuevo],
                    'description' => 'Transicion de estado RFCE: ' . $estadoAnterior . ' -> ' . $estadoNuevo . '.',
                ]);
            }
```

with:

```php
            $estadoAnterior = $ecf['estado_dgii'] ?? '';
            $actualizado = $facturaModel->updateECFEstado($facturaId, $estadoNuevo, $consulta['data']);
            $ecf['estado_dgii'] = $estadoNuevo;
            if ($estadoAnterior !== $estadoNuevo) {
                AuditLogger::log([
                    'module' => 'facturas', 'action' => 'STATUS_CHANGE', 'entity_type' => 'factura',
                    'entity_id' => $ecf['e_ncf'] ?? $facturaId,
                    'old_values' => ['estado_dgii' => $estadoAnterior],
                    'new_values' => ['estado_dgii' => $estadoNuevo],
                    'description' => 'Transicion de estado RFCE: ' . $estadoAnterior . ' -> ' . $estadoNuevo . '.',
                ]);
            }
            moverStockPrimeraAceptacion($facturaModel, $facturaId, $ecf, $estadoAnterior, $estadoNuevo, $actualizado);
```

The conditional rollbacks that follow both blocks are unchanged.

- [ ] **Step 6: `handleEstadoEnVuelo` and `moverStockPrimeraAceptacion`**

Insert right before the line `function handleReenviar(int $facturaId, facturaModel $facturaModel): void`:

```php
/**
 * GET /estado de una fila sin veredicto que no se puede consultar: en vuelo
 * (PENDIENTE_ENVIO, ENVIO_INCIERTO) o ENVIADO sin track_id. Release 1 no llama
 * a la DGII: devuelve el estado guardado y una nota que manda a soporte
 * (spec 7.3). No ofrece ningun reenvio: la app nunca reenvia (decision 7).
 */
function handleEstadoEnVuelo(int $facturaId, array $ecf): void
{
    $estado = (string) ($ecf['estado_dgii'] ?? '');
    $eNcf = (string) ($ecf['e_ncf'] ?? '');
    $enVuelo = in_array($estado, EstadosEcf::EN_VUELO, true);
    echo json_encode([
        'status' => true,
        'data' => [
            'factura_id' => $facturaId,
            'e_ncf' => $eNcf,
            'tipo_ecf' => (string) ($ecf['tipo_ecf'] ?? ''),
            'track_id' => ($ecf['track_id'] ?? '') !== '' ? (string) $ecf['track_id'] : null,
            'estado_dgii' => $estado,
            'secuencia_utilizada' => normalizeSecuenciaUtilizada($ecf['secuencia_utilizada'] ?? null),
            'en_vuelo' => $enVuelo,
            'nota' => sprintf($enVuelo ? FACTURA_NOTA_EN_VUELO : FACTURA_NOTA_ENVIADO_SIN_TRACK, $eNcf),
        ],
    ]);
}

/**
 * Primera aceptacion vista por la consulta de estado (e-CF o RFCE): mueve el
 * stock una sola vez (spec 4.7 y 10.5). Solo si el UPDATE de la consulta
 * cambio la fila y el estado pasa de uno no aceptado a uno aceptado: una fila
 * vieja que ya estaba ACEPTADO (ventas de antes del inventario) no mueve.
 * moverStockFacturaEcf revisa ademas yaMovioDocumento.
 */
function moverStockPrimeraAceptacion(facturaModel $facturaModel, int $facturaId, array $ecf, string $estadoAnterior, string $estadoNuevo, bool $actualizado): void
{
    if (!$actualizado
        || !in_array($estadoNuevo, FACTURA_ESTADOS_ACEPTADOS, true)
        || in_array($estadoAnterior, FACTURA_ESTADOS_ACEPTADOS, true)) {
        return;
    }
    $items = $facturaModel->getFacturaItems($facturaId);
    if ($items === []) {
        // getFacturaItems tambien da [] si la base fallo, y la proxima consulta
        // ya no vera la transicion: que quede en el log para un ajuste a mano.
        error_log(sprintf('[inventario] factura_id=%d %s aceptada sin lineas leidas: no se movio stock',
            $facturaId, (string) ($ecf['e_ncf'] ?? '')));
    }
    moverStockFacturaEcf($facturaId, $items, (string) ($ecf['tipo_ecf'] ?? ''), RequestContext::userId(), $estadoNuevo, 'consulta');
}

```

`handleReenviar` itself is not touched: it keeps `respond(false, ..., 501)`.

- [ ] **Step 7: `normalizeEstadoFilter` accepts `'pendiente'`**

Replace:

```php
/**
 * Normaliza el filtro `estado` del listado.
 * Acepta 'aprobado' (y la variante 'aprovado'), 'rechazado' y 'todos' en
 * cualquier capitalizacion. 'todos', vacio o ausente => null (sin filtro).
 * @return string|null|false null = sin filtro, false = valor invalido
 */
```

with:

```php
/**
 * Normaliza el filtro `estado` del listado.
 * Acepta 'aprobado' (y la variante 'aprovado'), 'rechazado', 'pendiente' y
 * 'todos' en cualquier capitalizacion. 'pendiente' = sin veredicto de la DGII
 * (EstadosEcf::SIN_VEREDICTO: en vuelo, ENVIADO, EN_PROCESO y sus RFCE_).
 * 'todos', vacio o ausente => null (sin filtro).
 * @return string|null|false null = sin filtro, false = valor invalido
 */
```

and replace:

```php
    if ($estado === 'rechazado') {
        return 'rechazado';
    }
    return false;
```

with:

```php
    if ($estado === 'rechazado') {
        return 'rechazado';
    }
    if ($estado === 'pendiente') {
        return 'pendiente';
    }
    return false;
```

The list route passes the value unchanged to `getFacturasPaginated` / `getFacturasCount`, which map it to `SIN_VEREDICTO` (Task 6).

- [ ] **Step 8: Lint and run everything**

```bash
php -l src/Controllers/facturaController.php
php tools/test_write_ahead_puro.php | sed -n '/^12)/,$p'; echo "exit=${PIPESTATUS[0]}"
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch | tail -1
```

Expected:
- `No syntax errors detected`;
- the six section 12 checks are `[OK  ]` and `exit=0`;
- `64 de 64 pruebas OK`: E1-E6 (40) and C1-C7 (24).

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Controllers/facturaController.php tools/test_write_ahead_puro.php tools/test_write_ahead_api.php
git commit -F - <<'EOF'
feat(facturas): estado de facturas en vuelo, filtro pendiente y stock al aceptar

GET /api/facturas/{id}/estado ya no responde 422 a una fila que existe.
Para PENDIENTE_ENVIO, ENVIO_INCIERTO y ENVIADO sin track_id devuelve 200
con el estado guardado, en_vuelo y una nota (spec 7.3) que manda a
soporte, sin consultar a la DGII. No hay campo de reenvio y POST
/reenviar sigue en 501 (decision 7).

La primera aceptacion que ve la consulta (e-CF o RFCE) mueve el stock una
sola vez; una venta vieja ya aceptada no mueve. El listado acepta
estado=pendiente. test_write_ahead_api: 64/64.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 19: Documentacion, regla de despliegue y procedimiento 10.2

**Files:**
- Modify: `CLAUDE.md` (English, like the rest of that file). Line 6 says "PHP 8+"; "Critical facts" is `:22-31`, and the last bullet ends at `:31`.
- Modify: `docs/integrations/alta-tenant-runbook.md`. Fase 5 is `:150-166`, with steps `:152-165`. The Troubleshooting table is `:197-207`, header `:195`.
- Modify: `docs/integrations/dgii-ecf.md`. The recovery section is `:115-140`; it ends `(migración 027 sin aplicar).` at `:140`, then `---` at `:142` and the next `##` at `:144`.
- Modify: `docs/api/facturas.md`:

  | Spot | Line |
  |---|---|
  | list `estado` | `:63` |
  | `notas` states | `:93-96` |
  | `/estado` values | `:188` |
  | RFCE note | `:200` |
  | stats rows | `:269-283` |
  | error codes | `:1040` |
  | error paragraph | `:1042-1047` |
  | front flow | `:1053` |
  | consult values | `:1067` |

- Modify: `docs/modules/auditoria.md`: the table at `:111-117` (last row `DGII_AUTH_OUT_FAILED`) and coverage at `:164-174`.
- Modify: `docs/database/schema.md`: `:184` `e_ncf` (stale `uk_e_ncf`), `:186` `estado_dgii`, `:191` `respuesta_dgii`.
- Modify: `docs/modules/reporte-ventas.md`: table `:41` and paragraph `:46-48`.
- Modify: `docs/modules/inventario.md`: new section before `## Compras` (`:62`).
- Modify: `docs/architecture.md:217`.
- Modify: `docs/modules/gastos.md:360-361`.
- Modify: `src/Utils/FacturaPdfGenerator.php:466` (comment only).
- Modify: `tools/test_write_ahead_puro.php`, section 13.
- Docs are in Spanish with accents. Migration 027's header and `HANDOFF_GASTOS.md` are history and stay as they are.

**Interfaces:**
- Consumes the texts and names of Tasks 4-18: `FACTURA_EMISION_INCIERTA`, the 7.3 notes, `EstadosEcf` lists, the 6.3 JSON keys, `yaMovioDocumento`, `metaEnvio`, and `wa_grep()` (section 11 of `test_write_ahead_puro.php`).
- Produces documentation only. Nothing in the code depends on it.

- [ ] **Step 1: Add section 13 (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above its closing block (Task 4):

```php
// ---------------------------------------------------------------------------
// 13) Documentacion del write-ahead (Task 19): anclas de texto en los docs.
// ---------------------------------------------------------------------------
echo "13) Documentacion del write-ahead\n";
$s13Leer = static fn(string $ruta): string
    => str_replace("\r\n", "\n", (string) @file_get_contents(dirname(__DIR__) . '/' . $ruta));
$s13Claude = $s13Leer('CLAUDE.md');
$s13Criticos = preg_match('/\n## Critical facts\n(.*?)\n## /s', $s13Claude, $m) ? $m[1] : '';
wa_chk('CLAUDE.md: "migraciones primero" con el verificador, dentro de Critical facts',
    str_contains($s13Criticos, 'tools/verificar_migraciones_tenant.sql'), $s13Criticos);
wa_chk('CLAUDE.md: produccion corre PHP 8.3', str_contains($s13Claude, 'PHP 8.3'));
$s13Runbook = $s13Leer('docs/integrations/alta-tenant-runbook.md');
wa_chk('runbook: Fase 5 corre el verificador de migraciones',
    (bool) preg_match('/## Fase 5.*verificar_migraciones_tenant\.sql.*## Fase 6/s', $s13Runbook));
wa_chk('runbook: troubleshooting de la 027', str_contains($s13Runbook, 'No se pudo asignar el número de comprobante'));
$s13Dgii = $s13Leer('docs/integrations/dgii-ecf.md');
wa_chk('dgii-ecf.md: listado de las filas sin confirmar', str_contains($s13Dgii, "estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO')"));
wa_chk('dgii-ecf.md: devolucion del numero con su condicion',
    str_contains($s13Dgii, 'current_value = current_value - 1 WHERE id = :rango_id AND current_value = :secuencia_valor'));
wa_chk('dgii-ecf.md: nunca un DELETE', str_contains($s13Dgii, 'Nunca un `DELETE`'));
$s13Api = $s13Leer('docs/api/facturas.md');
wa_chk('facturas.md: filtro pendiente, en_vuelo y el 502 con la factura guardada',
    str_contains($s13Api, '`pendiente`') && str_contains($s13Api, 'en_vuelo') && str_contains($s13Api, 'ya quedó guardada'));
wa_chk('facturas.md: ya no describe el 500 "se envió pero no se pudo guardar"',
    !str_contains($s13Api, '`500` la DGII recibió el e-CF pero no se pudo guardar'));
$s13Schema = $s13Leer('docs/database/schema.md');
wa_chk('schema.md: uk_e_ncf_amb y no el indice viejo',
    str_contains($s13Schema, 'uk_e_ncf_amb') && !str_contains($s13Schema, 'UNIQUE (`uk_e_ncf`)'));
wa_chk('auditoria.md: EMIT del envio incierto con fase_fallida', str_contains($s13Leer('docs/modules/auditoria.md'), 'fase_fallida'));
wa_chk('reporte-ventas.md: las filas en vuelo no son ventas', str_contains($s13Leer('docs/modules/reporte-ventas.md'), 'ENVIO_INCIERTO'));
wa_chk('inventario.md: una venta e-CF mueve stock fuera de SIN_STOCK', str_contains($s13Leer('docs/modules/inventario.md'), 'SIN_STOCK'));
wa_chk('architecture.md: ECFEmissionService reserva la fila antes de enviar',
    str_contains($s13Leer('docs/architecture.md'), 'build → firmar → reservar fila → enviar → confirmar; hook `$persistencia`'));
wa_chk('nada en src, docs ni CLAUDE.md nombra saveFacturaConECF',
    wa_grep(['src', 'docs', 'CLAUDE.md'], 'saveFacturaConECF') === [], wa_grep(['src', 'docs', 'CLAUDE.md'], 'saveFacturaConECF'));

```

Run:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | sed -n '/^13)/,$p' | grep -E "^\s+\[|pruebas"
```

Expected: all 15 section 13 checks are `[FALLO]`. The last one lists `docs/modules/gastos.md` and `src/Utils/FacturaPdfGenerator.php`.

- [ ] **Step 2: `CLAUDE.md`**

Replace `Stack: PHP 8+, MySQL, Apache.` with:

```
Stack: PHP 8.3 in production (local dev may run newer: no 8.4+ syntax), MySQL, Apache.
```

After the bullet that ends `— fix with \`tools/update_tenant_db.php\`` (`:31`), add:

```markdown
- **Tenant migrations go first.** Every `db/migrations` file a change depends on must run in
  **every** tenant DB before the code that needs it is deployed. Check each DB with
  `tools/verificar_migraciones_tenant.sql` (its `base` column must show that tenant's DB; the DB list
  comes from `tools/verificar_migraciones_master.sql`). 027 (`uk_e_ncf_amb`) and 028
  (`estado_dgii` VARCHAR(40)) are the release gate of the e-CF write-ahead: both must say `APLICADA`.
```

- [ ] **Step 3: `docs/integrations/alta-tenant-runbook.md`**

After Fase 5 step 4, which ends with `` `tests/test_cotizaciones_ferreteria.http`. `` (`:165`), add:

```markdown
5. **Migraciones:** en phpMyAdmin, entra a la base nueva y corre
   `tools/verificar_migraciones_tenant.sql`. La columna `base` debe mostrar la base
   del tenant (si dice `information_schema` u otra, selecciónala y córrelo otra vez)
   y **todas** las filas deben decir `APLICADA`. La 027 y la 028 son la compuerta de
   la emisión e-CF: sin ellas no se emite.
```

After the last Troubleshooting row (`| Al guardar una cotización: "La pantalla de cotizaciones está desactualizada…" (\`409\`) | … | Recargar la página |`), add:

```markdown
| Toda emisión responde "No se pudo asignar el número de comprobante. Inténtalo de nuevo." | Falta la migración 027 en la base del tenant: la clave vieja `uk_e_ncf` choca con el mismo número de otro ambiente y cada intento se salta un número | Correr `tools/verificar_migraciones_tenant.sql` en esa base y aplicar `db/migrations/027_e_ncf_unico_por_ambiente.sql` (se puede repetir) |
```

- [ ] **Step 4: `docs/integrations/dgii-ecf.md`, the 10.2 procedure**

Insert right after the line `(migración 027 sin aplicar).` (`:140`) and before the blank line and `---`:

````markdown

### Resolver una factura sin confirmar (write-ahead)

`POST /api/facturas` guarda la fila **antes** de enviar el e-CF a la DGII. Si el
envío o la confirmación fallan, la factura queda en `ENVIO_INCIERTO` (o en
`PENDIENTE_ENVIO` si el proceso murió) con su e-NCF, el XML firmado, el
`codigo_seguridad` y las líneas. La app nunca la reenvía: la resuelve soporte. El
procedimiento es un solo `UPDATE` que devuelve la fila al camino normal de
`GET /api/facturas/{id}/estado`, que ya aplica el veredicto, escribe
`STATUS_CHANGE`, devuelve la secuencia cuando la DGII no la usó y mueve el
inventario una sola vez.

1. **Listar** en la base del tenant:

   ```sql
   SELECT id, e_ncf, tipo_ecf, estado_dgii, track_id, ambiente_dgii, codigo_seguridad, respuesta_dgii
   FROM facturas
   WHERE estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO')
      OR (estado_dgii = 'ENVIADO' AND track_id IS NULL AND e_ncf IS NOT NULL);
   ```

   - No toques una fila cuyo `respuesta_dgii.desde` tenga menos de 5 minutos: su
     petición puede seguir corriendo.
   - `respuesta_dgii` guarda la meta del envío (JSON, sin XML): `flujo` (`ECF` o
     `RFCE`), `dispensado`, `rango_id` y `secuencia_valor` (para devolver el número)
     y, en `ENVIO_INCIERTO`, también `fase_fallida`, `error` y `resultado_parcial`.
   - **Hora:** el servidor (PHP y MySQL) corre en UTC-5, una hora detrás de la DGII
     (UTC-4). `desde` y `fecha_emision_dgii` están en hora del servidor; el portal de
     la DGII muestra la misma recepción una hora más tarde.

2. **Preguntar a la DGII:**

   ```bash
   php tools/consultar_ecf_dgii.php --tenant-id=<id> --encf=<e_ncf> --codigo-seguridad=<codigo_seguridad>
   ```

   (o el wrapper web de la sección anterior). `--codigo-seguridad` evita el 400
   "Cod_Seguridad" de ConsultaEstado. Cuando `respuesta_dgii.fase_fallida` es
   `confirmar`, la DGII ya había respondido y `resultado_parcial` trae su respuesta
   (`track_id`, `estado`): no hace falta consultar. Si la fila quedó en
   `PENDIENTE_ENVIO` porque la base se cayó, esa respuesta está en la auditoría
   (`EMIT` con `success=0`, `new_values.resultado_parcial`) y en la línea
   `ENVIO_INCIERTO ... track_id=...` del `error_log`.

3. **Aplicar un solo caso** y abrir la factura en la app (o
   `GET /api/facturas/{id}/estado`), que hace el resto:

   | Caso | SQL |
   |---|---|
   | e-CF, la DGII tiene un trackId `T` | `UPDATE facturas SET estado_dgii = 'ENVIADO', track_id = :T WHERE id = :id AND (estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL));` |
   | RFCE (`respuesta_dgii.flujo = 'RFCE'`) | `UPDATE facturas SET estado_dgii = 'RFCE_ENVIADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');` La consulta RFCE usa el `codigo_seguridad` guardado. |
   | La DGII no lo tiene (`ecf`/`testecf`: TrackIds sin resultados) | `UPDATE facturas SET estado_dgii = 'NO_ENCONTRADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');` y después, con `rango_id` y `secuencia_valor` de la meta leída en el paso 1: `UPDATE ncf_sequences SET current_value = current_value - 1 WHERE id = :rango_id AND current_value = :secuencia_valor;` Si afectó 1 fila, la próxima emisión de ese tipo reutiliza este e-NCF y archiva esta fila como `NO_ENCONTRADO_ARCHIVADO`; con 0 filas el número queda como hueco (igual que un "rollback sin coincidencia") y la próxima emisión toma uno nuevo. Soporte le pide al usuario que emita de nuevo. |
   | RFCE y soporte ya sabe que la DGII no tiene el RFCE (si no, el caso RFCE de arriba deja que la consulta decida) | `UPDATE facturas SET estado_dgii = 'RFCE_NO_ENCONTRADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');` y la misma devolución de `ncf_sequences`. El reintento la archiva como `RFCE_NO_ENCONTRADO_ARCHIVADO`. |
   | `certecf` (TrackIds responde 404 allí) | Decidir entre los casos de arriba con el portal de certificación de la DGII. Un error en `certecf` no tiene efecto fiscal. |

   - Con `respuesta_dgii.dispensado = false` (el e-NCF vino en el payload) no hay
     número que devolver: solo el `UPDATE` de `facturas`.
   - Nunca un `DELETE`: la fila es la prueba de que ese número se usó.
````

- [ ] **Step 5: `docs/api/facturas.md`**

Replace the `estado` row (`:63`) with:

```markdown
| `estado` | `todos` | `aprobado` (incluye `ACEPTADO`, `ACEPTADO_CONDICIONAL` y `RFCE_*` aceptados), `rechazado` (incluye `RFCE_RECHAZADO`), `pendiente` o `todos`. `pendiente` = sin veredicto de la DGII: `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO`, `RFCE_ENVIADO` y `RFCE_EN_PROCESO` (`EstadosEcf::SIN_VEREDICTO`). No incluye `NO_ENCONTRADO`, `RFCE_NO_ENCONTRADO` ni el `PENDIENTE` heredado, que el front también rotula "Pendiente": esos ya tienen respuesta. Cualquier otro valor → `422` |
```

Replace (`:93-96`):

```markdown
  mismo `ambiente_dgii` (NULL con NULL), y solo si la DGII las tiene: `estado_dgii`
  en `ACEPTADO`, `ACEPTADO_CONDICIONAL`, `EN_PROCESO` o `ENVIADO` (la misma regla
  que el saldo de `/api/facturas/modificables`). Una nota rechazada, en `ERROR`,
  `NO_ENCONTRADO` o archivada no aparece. Fila sin `e_ncf` → `[]`.
```

with:

```markdown
  mismo `ambiente_dgii` (NULL con NULL), y solo si la DGII las tiene o pudo
  recibirlas: `estado_dgii` en `ACEPTADO`, `ACEPTADO_CONDICIONAL`, `EN_PROCESO`,
  `ENVIADO`, `PENDIENTE_ENVIO` o `ENVIO_INCIERTO` (`facturaModel::ESTADOS_NOTA_VIGENTE`,
  la misma regla que el saldo de `/api/facturas/modificables`). Una nota en vuelo
  (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`) ya aparece y ya resta saldo: el front la
  rotula "(sin confirmar)" y no dice "Anulada por" hasta que la DGII la acepte.
  Una nota rechazada, en `ERROR`, `NO_ENCONTRADO` o archivada no aparece. Fila sin
  `e_ncf` → `[]`.
```

Replace the `Valores de \`estado_dgii\`` line (`:188`) with:

```markdown
Valores de `estado_dgii`: `PENDIENTE_ENVIO` · `ENVIO_INCIERTO` (en vuelo, ver abajo) · `ENVIADO` · `ACEPTADO` · `ACEPTADO_CONDICIONAL` · `EN_PROCESO` · `RECHAZADO` · `NO_ENCONTRADO` · `ERROR` · y variantes RFCE `RFCE_ENVIADO` / `RFCE_EN_PROCESO` / `RFCE_ACEPTADO` / `RFCE_ACEPTADO_CONDICIONAL` / `RFCE_RECHAZADO` / `RFCE_NO_ENCONTRADO` / `RFCE_ERROR`.
```

Right after the line `> RFCE (E32 <250k): se consulta por RNC + e-NCF + código de seguridad (no usa \`track_id\`). La respuesta trae los mismos campos.` (`:200`), insert:

````markdown

#### Filas sin veredicto que no se pueden consultar (`en_vuelo`)

Para una fila en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`) o en `ENVIADO` sin
`track_id`, `/estado` no llama a la DGII: responde `200` con el estado guardado y
una nota. Nunca responde `422` para una factura que existe.

```json
{
  "status": true,
  "data": {
    "factura_id": 41, "e_ncf": "E310000000123", "tipo_ecf": "31", "track_id": null,
    "estado_dgii": "ENVIO_INCIERTO", "secuencia_utilizada": null, "en_vuelo": true,
    "nota": "La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número E310000000123."
  }
}
```

- `en_vuelo: true` en `PENDIENTE_ENVIO`/`ENVIO_INCIERTO`. `en_vuelo: false` en
  `ENVIADO` sin `track_id`, con esta nota: "La DGII recibió este comprobante, pero no
  devolvió su número de seguimiento y por eso no se puede consultar su estado desde
  aquí. Si necesitas confirmarlo, avisa a soporte con el número E310000000123."
- No hay campo ni endpoint de reenvío: la app nunca reenvía un e-CF y
  `POST /api/facturas/{id}/reenviar` sigue respondiendo `501`. Soporte resuelve la
  fila ([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md), "Resolver una
  factura sin confirmar").
- Cuando la consulta normal pasa una factura a `ACEPTADO`/`ACEPTADO_CONDICIONAL` (o
  sus `RFCE_`) desde un estado sin aceptar, mueve el inventario de esa venta, una
  sola vez.
````

In the stats table, make these replacements.

`resumen.total_ecf`, from:

```markdown
| `resumen.total_ecf` | Total de e-CFs emitidos (todos los tipos) |
```

to:

```markdown
| `resumen.total_ecf` | Total de e-CFs emitidos (todos los tipos): cuenta filas, las en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`) incluidas |
```

`resumen.monto_total`, from:

```markdown
| `resumen.monto_total` | Suma de todos los montos emitidos (RD$), tal cual: la nota de crédito (E34) suma y los rechazados también |
```

to:

```markdown
| `resumen.monto_total` | Suma de los montos emitidos (RD$): la nota de crédito (E34) suma y los rechazados también. **No** suma las filas en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`): la DGII todavía no dio veredicto, así que no son dinero |
```

`resumen.monto_neto` (inside its row): change `**resta** y los rechazados (\`estado_dgii\` con \`RECHAZADO\`: \`RECHAZADO\`, \`RECHAZADO_ARCHIVADO\`, \`RFCE_RECHAZADO\`) no cuentan. Es el` to:

```markdown
**resta** y no cuentan los rechazados (`estado_dgii` con `RECHAZADO`: `RECHAZADO`, `RECHAZADO_ARCHIVADO`, `RFCE_RECHAZADO`) ni las filas en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`). Es el
```

`por_tipo[].total`, from `| \`por_tipo[].total\` | Total emitido de este tipo |` to:

```markdown
| `por_tipo[].total` | Total emitido de este tipo (filas, las en vuelo incluidas) |
| `por_tipo[].monto_total` | Monto de este tipo (RD$), sin las filas en vuelo |
```

`por_mes[].mes`: change `(incluye E41/E43/E47 de compras), sin rechazados, por \`fecha_emision_dgii\`. No son ventas |` to `(incluye E41/E43/E47 de compras), sin rechazados ni filas en vuelo, por \`fecha_emision_dgii\`. No son ventas |`.

`ventas_por_mes[]`: change `**resta** E34, no entran E41/E43/E47 ni los rechazados. Por \`date\`, como el reporte.` to `**resta** E34, no entran E41/E43/E47, los rechazados ni las filas en vuelo. Por \`date\`, como el reporte.`.

`secuencias[].total_emitidos`, from `| \`secuencias[].total_emitidos\` | Facturas guardadas en DB para ese tipo |` to:

```markdown
| `por_estado[]` | `estado`, `total` y `monto_total` por cada `estado_dgii`. Trae `PENDIENTE_ENVIO` y `ENVIO_INCIERTO` cuando hay filas en vuelo: el front suma esas dos cubetas para el KPI "Sin confirmar" |
| `secuencias[].total_emitidos` | Facturas guardadas en DB para ese tipo (filas: cuenta también las en vuelo) |
```

Replace the error-codes line (`:1040`) with:

```markdown
Códigos comunes: `400` JSON inválido · `422` validación (tipo_ecf, client_id, items, unidad de medida, cantidad de una línea, RNC faltante, datos de la nota E33/E34, total que no se pudo calcular, rechazo de la DGII) · `404` cliente no encontrado · `502` fallo en emisión DGII: sin `data` no se guardó nada; con `data` la factura quedó guardada sin confirmación (ver abajo) · `500` error interno no manejado (`error_id`, sin `data`).
```

Right after the paragraph ending `(\`/api/integracion/*\`) siguen recibiendo el texto técnico.` (`:1047`), insert:

````markdown

#### `502` con la factura guardada (envío sin confirmar)

La fila se guarda **antes** de enviar el e-CF a la DGII (write-ahead). Si el envío o
la confirmación fallan (timeout, la DGII responde HTML, la base se cae después de la
respuesta), la factura queda guardada en `ENVIO_INCIERTO`, o en `PENDIENTE_ENVIO` si ni
eso se pudo escribir, y la respuesta trae `data`:

```json
{
  "status": false,
  "error": "No se pudo confirmar si la DGII recibió la factura E310000000123. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.",
  "data": { "factura_id": 41, "e_ncf": "E310000000123", "tipo_ecf": "31", "estado_dgii": "ENVIO_INCIERTO" }
}
```

- `data.factura_id` es la fila guardada: el front abre su detalle ("Ver factura").
- Un `502` **sin** `data` es un fallo antes del envío: nada llegó a la DGII y se puede
  reintentar. Incluye `'No se pudo asignar el número de comprobante. Inténtalo de
  nuevo.'`: otra fila ya tiene ese e-NCF y el reintento toma el siguiente.
- `422` `'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de
  nuevo.'`: un `strict_input` cuyo `totales` no trae un `monto_total` numérico. Se
  corta antes de tomar el número.
- La app no reenvía un e-CF: `POST /api/facturas/{id}/reenviar` responde `501`. Las
  facturas sin confirmar las resuelve soporte
  ([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md)).
````

Replace front-flow step 1 (`:1053`):

```markdown
1. `POST /api/facturas` con el payload mínimo → recibe `factura_id`, `e_ncf`, `estado_dgii`.
```

with:

```markdown
1. `POST /api/facturas` con el payload mínimo → recibe `factura_id`, `e_ncf`, `estado_dgii`. Un `502` con `data.factura_id` es una factura guardada sin confirmar: no reintentar; mostrar el texto (pide no emitirla de nuevo) y ofrecer "Ver factura" con `data.factura_id`. Un timeout del lado del front se trata igual: revisar el filtro `pendiente` antes de volver a emitir.
```

Replace the consult values line (`:1067`) with:

```markdown
`estado_dgii` posibles valores: `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `ACEPTADO`, `ACEPTADO_CONDICIONAL`, `EN_PROCESO`, `RECHAZADO`, `NO_ENCONTRADO`, `ERROR`, y sus `RFCE_*`. La respuesta incluye `secuencia_utilizada` (ver "Manejo de RECHAZADO" arriba). Para una fila en vuelo, o `ENVIADO` sin `track_id`, no consulta a la DGII: responde el estado guardado con `en_vuelo` y `nota` (ver "Filas sin veredicto" arriba).
```

- [ ] **Step 6: `docs/modules/auditoria.md` and `docs/database/schema.md`**

In `auditoria.md`, after the table row that starts `| \`DGII_AUTH_OUT_FAILED\` | \`dgii-auth\` |`, add:

```markdown
| `EMIT` con `success=0` (envío sin confirmar) | `facturas` | La factura quedó guardada antes del envío (write-ahead) pero no se sabe si la DGII la recibió; la respuesta fue el `502` con `data`. `entity_id` = e-NCF. `new_values`: `factura_id`, `tipo_ecf`, `client_id`, `estado_dgii` (`ENVIO_INCIERTO`, o `PENDIENTE_ENVIO` si ni eso se pudo escribir), `fase_fallida` (`envio`, `confirmar` o `reservar`) y `resultado_parcial` (la respuesta de la DGII ya recortada y sin XML, cuando falló la confirmación). `error_message`: el error original. Soporte la usa para resolver la fila ([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md)). |
| `NCF_SEQUENCE_UPDATE` con `success=0` | `ncf` | Un e-NCF quedó consumido sin fila: la emisión falló antes del envío y no se pudo devolver el número a la secuencia (`error_message` `rollback sin coincidencia`). `entity_id` = e-NCF. `new_values`: `e_ncf`, `tipo_ecf`, `rango_id`, `secuencia_valor`, `ambiente_secuencia`, `causa` (la clase del error). |
```

In "Cobertura actual", replace `recepción (ligada al token DGII), emisión/aprobación por integración.` with:

```markdown
recepción (ligada al token DGII), emisión/aprobación por integración, emisión sin
confirmar de la DGII (`EMIT success=0` con la fila en `new_values`) y e-NCF consumidos
sin fila (`NCF_SEQUENCE_UPDATE success=0`).
```

In `schema.md`, replace three rows.

Row `:184`, from `| \`e_ncf\` | varchar(13) | UNIQUE (\`uk_e_ncf\`) |` to:

```markdown
| `e_ncf` | varchar(13) | UNIQUE con `ambiente_dgii`: `uk_e_ncf_amb (e_ncf, ambiente_dgii)` (migración 027; certificación y producción numeran aparte) |
```

Row `:186` (`estado_dgii`), to:

```markdown
| `estado_dgii` | varchar(40) | `PENDIENTE` (default heredado) · `PENDIENTE_ENVIO` (fila guardada, todavía sin enviar) · `ENVIO_INCIERTO` (enviada sin confirmación de la DGII) · `ENVIADO` · `EN_PROCESO` · `ACEPTADO` · `ACEPTADO_CONDICIONAL` · `RECHAZADO` · `NO_ENCONTRADO` · `ERROR`; `RFCE_` + estado (E32 < 250k); estado + `_ARCHIVADO` al reutilizar el número. 40 desde la migración 028. Las listas viven en `src/Utils/FacturacionElectronica/EstadosEcf.php` — INDEX |
```

Row `:191` (`respuesta_dgii`), to:

```markdown
| `respuesta_dgii` | text | última respuesta DGII (JSON). Mientras la fila está en vuelo guarda la meta del envío (nunca XML): `fase`, `desde`, `flujo`, `ambiente_secuencia`, `dispensado`, `rango_id`, `secuencia_valor` y, en `ENVIO_INCIERTO`, además `fase_fallida`, `clase`, `error`, `resultado_parcial`, `intentos`. Se lee con `facturaModel::metaEnvio()` |
```

- [ ] **Step 7: Ventas report, inventory, architecture, gastos and the PDF comment**

In `docs/modules/reporte-ventas.md`, replace `| Cualquiera con estado \`%RECHAZADO%\` | **no** | — |` with:

```markdown
| Cualquiera con estado `%RECHAZADO%` | **no** | — |
| Filas en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`) | **no** | — |
```

Then, after the line `no haya llegado. El 607 exige \`ACEPTADO\` porque es una declaración fiscal.`, add:

```markdown

Las filas **en vuelo** (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`: guardadas antes del envío y
sin confirmación de la DGII) no entran: no se sabe si la DGII las tiene. Entran cuando
soporte las resuelve a un estado de la DGII.
```

In `docs/modules/inventario.md`, insert right before `## Compras`:

```markdown
## Ventas e-CF

Una factura e-CF (`/api/facturas`) mueve existencias en las líneas con `product_id` que
el catálogo marca como bien: la venta sale como `VENTA` y la nota de crédito `E34` entra
como `DEVOLUCION`, con `referencia_tipo = 'factura'` (`inventoryModel::registrarVenta`).

- **Solo con un veredicto de la DGII.** La fila se guarda antes del envío (write-ahead) y
  no mueve nada mientras está en vuelo (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`). Tampoco
  mueve con un veredicto de `EstadosEcf::SIN_STOCK`: `RECHAZADO`, `RFCE_RECHAZADO`,
  `NO_ENCONTRADO`, `RFCE_NO_ENCONTRADO`, `ERROR`, `RFCE_ERROR`.
- **Una sola vez por factura.** Mueve la emisión, cuando la DGII responde otro estado, o
  `GET /api/facturas/{id}/estado` la primera vez que ve la factura pasar a
  `ACEPTADO`/`ACEPTADO_CONDICIONAL` (o sus `RFCE_`). Los dos preguntan antes
  `inventoryModel::yaMovioDocumento('factura', id)`: el que llega primero mueve.
- **Un rechazo posterior no lo revierte**: se corrige con un ajuste, igual que en compras.
- Una venta vieja que ya estaba aceptada sin movimientos (de antes del inventario) no
  mueve al consultarla: solo cuenta el paso a aceptado.

```

In `docs/architecture.md:217`, replace the row with:

```markdown
| `ECFEmissionService.php` | orquesta emisión e-CF (build → firmar → reservar fila → enviar → confirmar; hook `$persistencia`); flag `integration` |
```

In `docs/modules/gastos.md`, replace:

```markdown
encendido, llama `emitir()` **primero** y luego guarda con el resultado (igual que
`facturaController`/`saveFacturaConECF`). Si `emitir()` lanza, el gasto se guarda con
```

with:

```markdown
encendido, llama `emitir()` **primero** y luego guarda con el resultado. Las facturas
ya no lo hacen así: guardan la fila antes del envío (write-ahead, hook `$persistencia`
de `emitir()`); los gastos adoptarán el mismo patrón en un cambio aparte. Si `emitir()` lanza, el gasto se guarda con
```

In `src/Utils/FacturaPdfGenerator.php:466`, replace the comment line:

```php
        // facturaModel::saveFacturaConECF y la migracion 006). El NCF Modificado
```

with:

```php
        // facturaModel::reservarFacturaECF y la migracion 006). El NCF Modificado
```

- [ ] **Step 8: Run and lint**

```bash
php tools/test_write_ahead_puro.php | sed -n '/^13)/,$p'; echo "exit=${PIPESTATUS[0]}"
php -l src/Utils/FacturaPdfGenerator.php
git grep -n saveFacturaConECF -- src docs CLAUDE.md
```

Expected:
- the 15 section 13 checks are `[OK  ]`, the summary is `N de N pruebas OK`, and `exit=0`;
- `No syntax errors detected`;
- `git grep` prints nothing. Only `HANDOFF_GASTOS.md` and `db/migrations/027_...` still name it, on purpose.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add CLAUDE.md docs/integrations/alta-tenant-runbook.md docs/integrations/dgii-ecf.md docs/api/facturas.md docs/modules/auditoria.md docs/database/schema.md docs/modules/reporte-ventas.md docs/modules/inventario.md docs/architecture.md docs/modules/gastos.md src/Utils/FacturaPdfGenerator.php tools/test_write_ahead_puro.php
git commit -F - <<'EOF'
docs(ecf): write-ahead, regla de despliegue y resolucion manual

Regla de despliegue en CLAUDE.md y en el runbook de alta: las migraciones
de tenant van primero, verificadas con verificar_migraciones_tenant.sql;
027 y 028 son la compuerta del write-ahead. Tambien queda escrito que
produccion corre PHP 8.3.

dgii-ecf.md trae el procedimiento 10.2 para resolver a mano una factura
sin confirmar: listar, consultar, un solo UPDATE por caso, nunca DELETE.

facturas.md documenta el filtro pendiente, la forma en_vuelo de /estado,
el 502 con data y los stats sin filas en vuelo. Tambien se actualizan
auditoria, schema (uk_e_ncf_amb, estados), reporte de ventas, inventario
(stock solo con veredicto, una vez), architecture y gastos.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 20: Escenarios .http, reportes, impresion, saldo y compuerta 12.0 pasos 3-4

**Files:**
- Modify: `tools/test_write_ahead_api.php`. Add the Task 20 block before the final `wa_mock_modo($srv['mock'], 'acepta');` / `wa_fin();`, with the new option `--copia-db=<base>`.
- Create: `tests/test_facturas_write_ahead.http`, in the style of `tests/test_cotizaciones_ferreteria.http:1-30` (header block, `@` variables, `###` steps with their expectation).
- Pins:
  - report routes: `src/Router.php:261-277` (`/api/reportes/ventas`, `/api/reportes/607[/preview]`);
  - ventas JSON `data.filas[].documento` (`reporteVentasController.php:84-97`); 607 preview `data.registros[].ncf` (`Reporte607Controller.php:51-69`);
  - PDF base64 `data.content` (`facturaController.php` `handleFacturaPdf`, `$format === 'base64'`); XML download (`handleFacturaXml`);
  - the saldo text `'... solo le quedan RD$ … por acreditar …'` (`validarFacturaModificada`, `:605-613` at `9f669ad`).
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate`.

**Interfaces:**
- Consumes:
  - Tasks 1-3: `wa_*`, the mock, and the broken copy `wa_scratch_sin_gate`;
  - Task 17 test helpers: `wa_reiniciar`, `wa_emitir`, `wa_get`, `wa_factura`, `wa_linea`, `wa_recepciones`, `T_NUMERO_OCUPADO`;
  - Tasks 16-18 behavior: stats exclusions, the 502 incierto, and the saldo that counts in-flight notes (Task 6).
- Produces:
  - `tests/test_facturas_write_ahead.http`;
  - `tools/test_write_ahead_api.php --tenant-db=<base> [--copia-db=<base>]`, covering every Release 1 HTTP scenario: 91 checks with `--copia-db`, 83 without.

- [ ] **Step 1: Append the Task 20 block**

Insert in `tools/test_write_ahead_api.php`, immediately before the final two lines (`wa_mock_modo($srv['mock'], 'acepta');` / `wa_fin();`):

```php
// ===========================================================================
// Task 20: stats, reportes, impresion, saldo de una E34 en vuelo y la
// compuerta 12.0 pasos 3-4 sobre la copia rota (--copia-db).
// ===========================================================================

echo "R1) Stats con una factura aceptada (1180.00) y una en vuelo (2360.00)\n";
$ids = wa_reiniciar($pdo, $srv);
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000)]));
$aceptada = $r['json']['data'] ?? [];
wa_mock_modo($srv['mock'], 'cuelga');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(2000)]));
$enVuelo = $r['json']['data'] ?? [];
wa_mock_modo($srv['mock'], 'acepta');   // espera a que termine el cuelga
$r = wa_get($srv, '/api/facturas/stats');
$stats = $r['json']['data'] ?? [];
$tipo31 = array_values(array_filter($stats['por_tipo'] ?? [], static fn(array $t): bool => (string) ($t['tipo_ecf'] ?? '') === '31'))[0] ?? [];
$cerca = static fn(mixed $v, float $x): bool => is_numeric($v) && abs((float) $v - $x) < 0.005;
// [documentos, monto] de una serie: las filas de la prueba son las unicas de la base.
$suma = static fn(array $serie): array => [(int) array_sum(array_column($serie, 'total')), round((float) array_sum(array_column($serie, 'monto_total')), 2)];
wa_chk('precondicion: una ACEPTADO y una ENVIO_INCIERTO',
    ($aceptada['estado_dgii'] ?? null) === 'ACEPTADO' && ($enVuelo['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', [$aceptada, $enVuelo]);
wa_chk('resumen.total_ecf cuenta las dos filas', ($stats['resumen']['total_ecf'] ?? null) === 2, $stats['resumen'] ?? null);
wa_chk('resumen.monto_total suma solo la aceptada', $cerca($stats['resumen']['monto_total'] ?? null, 1180.0), $stats['resumen'] ?? null);
wa_chk('resumen.monto_neto suma solo la aceptada', $cerca($stats['resumen']['monto_neto'] ?? null, 1180.0), $stats['resumen'] ?? null);
wa_chk('por_tipo[31].total cuenta las dos filas', ($tipo31['total'] ?? null) === 2, $tipo31);
wa_chk('por_tipo[31].monto_total suma solo la aceptada', $cerca($tipo31['monto_total'] ?? null, 1180.0), $tipo31);
wa_chk('por_mes: solo la aceptada', $suma($stats['por_mes'] ?? []) === [1, 1180.0], $stats['por_mes'] ?? null);
wa_chk('ventas_por_mes: solo la aceptada', $suma($stats['ventas_por_mes'] ?? []) === [1, 1180.0], $stats['ventas_por_mes'] ?? null);
wa_chk('ventas_por_dia: solo la aceptada', $suma($stats['ventas_por_dia'] ?? []) === [1, 1180.0], $stats['ventas_por_dia'] ?? null);
$cubeta = array_values(array_filter($stats['por_estado'] ?? [], static fn(array $e): bool => ($e['estado'] ?? '') === 'ENVIO_INCIERTO'))[0] ?? [];
wa_chk('por_estado trae la cubeta ENVIO_INCIERTO con una fila', ($cubeta['total'] ?? null) === 1, $stats['por_estado'] ?? null);

echo "R2) Reportes de ventas y 607\n";
$desde = date('Y-m-d', strtotime('-1 day'));
$hasta = date('Y-m-d', strtotime('+1 day'));
$r = wa_get($srv, "/api/reportes/ventas?desde={$desde}&hasta={$hasta}");
$docs = array_column($r['json']['data']['filas'] ?? [], 'documento');
wa_chk('ventas: 200 con la aceptada', $r['status'] === 200 && in_array($aceptada['e_ncf'] ?? '-', $docs, true), $r);
wa_chk('ventas: sin la fila en vuelo', !in_array($enVuelo['e_ncf'] ?? '-', $docs, true), $docs);
$r = wa_get($srv, '/api/reportes/607/preview?periodo=' . date('Ym'));
$ncfs = array_column($r['json']['data']['registros'] ?? [], 'ncf');
wa_chk('607: 200 con la aceptada y sin la fila en vuelo', $r['status'] === 200
    && in_array($aceptada['e_ncf'] ?? '-', $ncfs, true) && !in_array($enVuelo['e_ncf'] ?? '-', $ncfs, true), [$r['status'], $ncfs]);

echo "R3) La fila en vuelo imprime como cualquier otra (decision 4)\n";
$idVuelo = (int) ($enVuelo['factura_id'] ?? 0);
$r = wa_get($srv, "/api/facturas/{$idVuelo}/pdf?format=base64");
wa_chk('PDF: 200 y el contenido es un PDF',
    $r['status'] === 200 && str_starts_with((string) base64_decode((string) ($r['json']['data']['content'] ?? '')), '%PDF'), $r['status']);
$r = wa_get($srv, "/api/facturas/{$idVuelo}/xml");
wa_chk('XML firmado: 200 con su e-NCF',
    $r['status'] === 200 && str_contains($r['body'], '<eNCF>' . ($enVuelo['e_ncf'] ?? '-') . '</eNCF>'), $r['status']);

echo "R4) Saldo: una nota de credito en vuelo ya resta\n";
$ids = wa_reiniciar($pdo, $srv);
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000)]));   // 1180.00
$original = $r['json']['data'] ?? [];
wa_chk('E31 original ACEPTADO', $r['status'] === 200 && ($original['estado_dgii'] ?? null) === 'ACEPTADO', $r);
$referencia = ['ncf_modificado' => (string) ($original['e_ncf'] ?? ''), 'fecha_ncf_modificado' => date('d-m-Y'),
    'codigo_modificacion' => '3', 'razon_modificacion' => 'Ajuste de prueba WA'];
wa_mock_modo($srv['mock'], 'cuelga');
$r = wa_emitir($srv, wa_factura('34', $ids, [wa_linea(500)], ['informacion_referencia' => $referencia]));   // 590.00
wa_chk('primera E34 (590.00) queda en vuelo: 502 incierto',
    $r['status'] === 502 && ($r['json']['data']['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $r);
wa_mock_modo($srv['mock'], 'acepta');
wa_mock_log($srv['mock'], true);
$r = wa_emitir($srv, wa_factura('34', $ids, [wa_linea(600)], ['informacion_referencia' => $referencia]));   // 708.00
wa_chk('segunda E34 (708.00) supera el saldo que deja la nota en vuelo: 422',
    $r['status'] === 422 && str_contains((string) ($r['json']['error'] ?? ''), 'solo le quedan RD$ 590.00'), $r);
wa_chk('la segunda E34 no llego a la DGII', wa_recepciones(wa_mock_log($srv['mock'])) === []);

$copia = (string) wa_arg('copia-db', '');
if ($copia === '') {
    echo "  (sin --copia-db: no se corren los pasos 3 y 4 de la compuerta 12.0)\n";
} else {
    echo "R5) 12.0 paso 3: sin la 027, el numero tomado en otro ambiente se rechaza antes del envio\n";
    $pdoCopia = wa_pdo($copia);
    $srvCopia = wa_api($copia, [], 8097);
    $idsCopia = wa_reiniciar($pdoCopia, $srvCopia);
    $pdoCopia->exec("INSERT INTO facturas (no_factura, client_name, total, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii)
                     VALUES ('E310000000001', 'WA otro ambiente', 100.00, '31', 'E310000000001', 'ACEPTADO', 'ecf')");
    $r = wa_emitir($srvCopia, wa_factura('31', $idsCopia, [wa_linea(1000)]));
    wa_chk('502 con el texto de numero ocupado y sin data',
        $r['status'] === 502 && ($r['json']['error'] ?? null) === T_NUMERO_OCUPADO && !isset($r['json']['data']), $r);
    wa_chk('el contador de E31 queda en 1: el numero se salta', wa_contador($pdoCopia, 'E31') === 1, wa_contador($pdoCopia, 'E31'));
    $filas = wa_filas($pdoCopia, 'E310000000001');
    wa_chk('ninguna fila nueva: solo la del otro ambiente', count($filas) === 1 && $filas[0]['ambiente_dgii'] === 'ecf', $filas);
    wa_chk('sin recepcion en la DGII', wa_recepciones(wa_mock_log($srvCopia['mock'])) === []);

    echo "R6) 12.0 paso 4: sin la 028 y en modo estricto, la confirmacion RFCE queda incierta\n";
    $modoPrevio = (string) $pdoCopia->query('SELECT @@GLOBAL.sql_mode')->fetchColumn();
    $estricto = str_contains($modoPrevio, 'STRICT_ALL_TABLES') || str_contains($modoPrevio, 'STRICT_TRANS_TABLES');
    $cambiado = false;
    try {
        if (!$estricto) {
            try {
                $pdoCopia->exec("SET GLOBAL sql_mode = 'STRICT_ALL_TABLES'");
                $cambiado = true;
                $estricto = true;
            } catch (PDOException $e) {
                echo "         (sin permiso para SET GLOBAL sql_mode: codigo {$e->getCode()})\n";
            }
        }
        wa_chk('el servidor de prueba corre en modo estricto', $estricto, $modoPrevio);
        $idsCopia = wa_reiniciar($pdoCopia, $srvCopia, 'acepta_condicional');
        $r = wa_emitir($srvCopia, wa_factura('32', $idsCopia, [wa_linea(1000)]));
        $d = $r['json']['data'] ?? [];
        wa_chk('502 incierto con data.estado_dgii ENVIO_INCIERTO',
            $r['status'] === 502 && ($d['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $r);
        $fila = wa_filas($pdoCopia, (string) ($d['e_ncf'] ?? ''))[0] ?? [];
        wa_chk('la fila quedo ENVIO_INCIERTO', ($fila['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $fila);
        $meta = json_decode((string) ($fila['respuesta_dgii'] ?? ''), true);
        wa_chk('resultado_parcial guarda la respuesta real: RFCE_ACEPTADO_CONDICIONAL',
            ($meta['resultado_parcial']['estado'] ?? null) === 'RFCE_ACEPTADO_CONDICIONAL', $meta);
    } finally {
        if ($cambiado) {
            $pdoCopia->exec('SET GLOBAL sql_mode = ' . $pdoCopia->quote($modoPrevio));
        }
    }
}

```

Update the header comment's `Uso:` line of the file to show the new option:

```php
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch [--copia-db=wa_scratch_sin_gate]
```

- [ ] **Step 2: Prove the new checks can fail (deliberately wrong expectations)**

The behavior already exists from Tasks 16-18, so first run with two expectations set to what the code did before them:
- in R1, change `$cerca($stats['resumen']['monto_total'] ?? null, 1180.0)` to `3540.0`, the old sum that included the in-flight row;
- in R4, change `'solo le quedan RD$ 590.00'` to `'solo le quedan RD$ 1,180.00'`, the old saldo that ignored the in-flight note.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | grep -E "FALLO|pruebas"
```

Expected: exactly `[FALLO] resumen.monto_total suma solo la aceptada` and `[FALLO] segunda E34 (708.00) supera el saldo que deja la nota en vuelo: 422`, then `89 de 91 pruebas OK`. Put both expectations back to `1180.0` and `'solo le quedan RD$ 590.00'`.

- [ ] **Step 3: Run the full API suite**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate; echo "exit=$?"
php -l tools/test_write_ahead_api.php
```

Expected:
- every check `[OK  ]` (E1-E6: 40, C1-C7: 24, R1-R6: 27), then `91 de 91 pruebas OK` and `exit=0`. R5 and R6 start a second API on port 8097 over the broken copy.
- If the test DB user cannot run `SET GLOBAL` and the server is not strict, `[FALLO] el servidor de prueba corre en modo estricto` names the cause. Ask the user for the privilege, or for a strict server; do not change anything else.
- `No syntax errors detected`.

- [ ] **Step 4: Create `tests/test_facturas_write_ahead.http`**

```http
### ============================================================================
### Facturas e-CF con write-ahead -> /api/facturas (spec 2026-10-05, Release 1)
### La fila se guarda ANTES de enviar a la DGII. Si el envio no se confirma, queda
### en ENVIO_INCIERTO y el POST responde 502 con data.factura_id.
###
### SOLO contra una API local o de staging apuntada a la DGII falsa
### (tools/mock_dgii.php). NUNCA contra produccion (decision 6 de la spec).
###
### Estos mismos escenarios, con asserts, los corre:
###   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate
### Para recorrerlos a mano, levanta el mock y la API con wa_api() de
### tools/write_ahead_test_lib.php desde un script de un solo uso que imprima api,
### mock, token y los ids de wa_sembrar() y se quede vivo (wa_api apaga los dos
### servidores al terminar). Llena las variables de abajo con eso.
### Despues de un "cuelga" el mock sigue durmiendo unos segundos: el siguiente
### cambio de modo espera a que termine. "(en la base)" = SQL en la base de prueba.
### ============================================================================

@base = http://127.0.0.1:8098
@mock = http://127.0.0.1:8099
@token = <token que imprime el lanzador (sesion de wa_prueba)>
@cliente = <client_id de 'WA cliente'>
@producto = <product_id de 'WA producto'>
@facturaId = <factura_id que devolvio el paso anterior>

### Login (solo con un usuario de prueba propio; el lanzador ya trae @token)
POST {{base}}/api/auth/login
Content-Type: application/json

{
  "emailOrUsername": "<usuario de prueba>",
  "password": "<clave de prueba>"
}

### ---------------------------------------------------------------------------
### Emision (Task 17)
### ---------------------------------------------------------------------------

### E1a Mock en acepta
GET {{mock}}/__mock/modo?valor=acepta

### E1b E31 con dos lineas de producto -> 200 con las 10 claves de siempre y estado_dgii ACEPTADO.
### (en la base) dos inventory_movements con referencia_tipo 'factura' y ese factura_id
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "31", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [
    { "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 },
    { "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 500 }
  ]
}

### E2a Mock en rechaza
GET {{mock}}/__mock/modo?valor=rechaza

### E2b E31 -> 422 con data (estado_dgii RECHAZADO); sin movimientos; ncf_sequences E31 vuelve atras
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "31", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [{ "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 }]
}

### E2c Mock en acepta
GET {{mock}}/__mock/modo?valor=acepta

### E2d El mismo body de E2b -> 200 con el MISMO e_ncf; la fila de E2b queda RECHAZADO_ARCHIVADO con e_ncf NULL
### y el stock se mueve solo para la fila nueva
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "31", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [{ "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 }]
}

### E3a Mock en cuelga (duerme MOCK_DGII_CUELGA_SEG; la API corta a los 3 s)
GET {{mock}}/__mock/modo?valor=cuelga

### E3b E31 -> 502 "No se pudo confirmar si la DGII recibió la factura E31... No la emitas de nuevo..." con
### data {factura_id, e_ncf, tipo_ecf "31", estado_dgii "ENVIO_INCIERTO"}. (en la base) la fila queda ENVIO_INCIERTO,
### sin movimientos, y audit_logs tiene un EMIT success=0 con new_values.factura_id
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "31", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [{ "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 }]
}

### E3c E32 >= 250k (flujo e-CF, Recepcion) -> igual que E3b con tipo_ecf "32"
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "32", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [{ "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 300000 }]
}

### E3d E32 < 250k (flujo RFCE, RecepcionFC) -> igual que E3b con tipo_ecf "32"
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "32", "client_id": {{cliente}}, "tipo_pago": 1,
  "items": [{ "nombre_item": "WA producto", "product_id": {{producto}}, "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 }]
}

### E3e Lo que vio el mock: UNA recepcion por cada POST de E3 (Recepcion, Recepcion, RecepcionFC); lo vacia
GET {{mock}}/__mock/log?limpiar=1

### E4a Mock en acepta
GET {{mock}}/__mock/modo?valor=acepta

### E4b strict_input con totales sin monto_total -> 422 "No se pudo calcular el total de la factura. Revisa las
### líneas e inténtalo de nuevo."; el log del mock no tiene recepcion; ncf_sequences no se mueve.
### Con strict_input el comprador sale solo del body: sin "comprador" la E31 se cae antes por falta de RNC.
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "31", "client_id": {{cliente}}, "tipo_pago": 1, "strict_input": true,
  "totales": { "monto_gravado_total": 1000 },
  "comprador": { "rnc": "000000001", "razon_social": "WA CLIENTE DE PRUEBA SRL" },
  "items": [{ "nombre_item": "WA linea libre", "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 1000 }]
}

### E5 (en la base) RENAME TABLE ncf_sequences TO ncf_sequences_wa_off; y repetir E2d -> 502 con exactamente
### "No se pudo emitir la factura en la DGII. Espera unos minutos..." (no "Se acabaron..."), ninguna fila nueva.
### Despues, siempre: RENAME TABLE ncf_sequences_wa_off TO ncf_sequences;

### E6 Mock en acepta_condicional y repetir E2d -> 200 con estado_dgii ACEPTADO_CONDICIONAL y un movimiento
GET {{mock}}/__mock/modo?valor=acepta_condicional

### ---------------------------------------------------------------------------
### Consulta de estado y filtro (Task 18)
### ---------------------------------------------------------------------------

### C1 Estado de la factura de E3b -> 200 {factura_id, e_ncf, tipo_ecf, track_id null, estado_dgii "ENVIO_INCIERTO",
### secuencia_utilizada null, en_vuelo true, nota "La DGII todavía no ha confirmado este comprobante. No lo emitas
### de nuevo; si sigue así en unos minutos, avisa a soporte con el número E31..."}; sin puede_reenviar;
### el mock no recibe ninguna consulta
GET {{base}}/api/facturas/{{facturaId}}/estado
X-API-KEY: {{token}}

### C2 (en la base) una fila ENVIADO con track_id NULL -> 200, en_vuelo false, nota "La DGII recibió este
### comprobante, pero no devolvió su número de seguimiento..."
GET {{base}}/api/facturas/{{facturaId}}/estado
X-API-KEY: {{token}}

### C3 Filtro Pendientes -> PENDIENTE_ENVIO, ENVIO_INCIERTO, ENVIADO, EN_PROCESO, RFCE_ENVIADO y RFCE_EN_PROCESO;
### nunca ACEPTADO ni RECHAZADO
GET {{base}}/api/facturas?estado=pendiente&pageSize=50
X-API-KEY: {{token}}

### C3b Un filtro que no existe sigue respondiendo 422
GET {{base}}/api/facturas?estado=foo
X-API-KEY: {{token}}

### C4 Stock al aceptar (e-CF). Con la fila de E3b en ENVIO_INCIERTO y el mock en acepta, (en la base):
###   UPDATE facturas SET estado_dgii = 'ENVIADO', track_id = 'track-<e_ncf>' WHERE id = <id>
###     AND (estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL));
### -> estado_dgii ACEPTADO y un movimiento por linea; una segunda consulta no agrega nada
GET {{base}}/api/facturas/{{facturaId}}/estado
X-API-KEY: {{token}}

### C5 Stock al aceptar (RFCE). Con la fila de E3d, (en la base):
###   UPDATE facturas SET estado_dgii = 'RFCE_ENVIADO' WHERE id = <id> AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');
### -> RFCE_ACEPTADO y un movimiento; una segunda consulta no agrega nada
GET {{base}}/api/facturas/{{facturaId}}/estado
X-API-KEY: {{token}}

### C6 (en la base) una venta vieja ACEPTADO con track_id y lineas, sin movimientos -> sigue ACEPTADO, 0 movimientos
### C7 (en la base) una fila NO_ENCONTRADO con track_id y lineas -> ACEPTADO y un movimiento
GET {{base}}/api/facturas/{{facturaId}}/estado
X-API-KEY: {{token}}

### ---------------------------------------------------------------------------
### Stats, reportes, impresion y saldo (Task 20)
### ---------------------------------------------------------------------------

### R1 Con una E31 aceptada (1180.00) y una en vuelo (2360.00): total_ecf y por_tipo[].total cuentan las dos;
### monto_total, monto_neto, por_tipo[].monto_total, por_mes, ventas_por_mes y ventas_por_dia solo la aceptada;
### por_estado trae la cubeta ENVIO_INCIERTO
GET {{base}}/api/facturas/stats
X-API-KEY: {{token}}

### R2a Reporte de ventas de ayer a mañana -> trae la aceptada, no la fila en vuelo
GET {{base}}/api/reportes/ventas?desde=<aaaa-mm-dd de ayer>&hasta=<aaaa-mm-dd de mañana>
X-API-KEY: {{token}}

### R2b 607 del mes -> trae la aceptada, no la fila en vuelo
GET {{base}}/api/reportes/607/preview?periodo=<aaaamm>
X-API-KEY: {{token}}

### R3a La fila en vuelo imprime como cualquier otra (decision 4) -> 200; data.content decodifica a %PDF
GET {{base}}/api/facturas/{{facturaId}}/pdf?format=base64
X-API-KEY: {{token}}

### R3b Su XML firmado -> 200 con su <eNCF>
GET {{base}}/api/facturas/{{facturaId}}/xml
X-API-KEY: {{token}}

### R4a Con una E31 aceptada de 1180.00 y el mock en cuelga: una E34 de 590.00 -> 502 incierto (queda en vuelo)
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "34", "client_id": {{cliente}}, "tipo_pago": 1,
  "informacion_referencia": { "ncf_modificado": "<e_ncf de la E31>", "fecha_ncf_modificado": "<dd-mm-aaaa de hoy>", "codigo_modificacion": "3", "razon_modificacion": "Ajuste de prueba WA" },
  "items": [{ "nombre_item": "WA linea libre", "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 500 }]
}

### R4b Mock en acepta y una segunda E34 de 708.00 -> 422 "...solo le quedan RD$ 590.00 por acreditar...":
### la nota en vuelo ya resta saldo; el mock no ve recepcion
POST {{base}}/api/facturas
X-API-KEY: {{token}}
Content-Type: application/json

{
  "tipo_ecf": "34", "client_id": {{cliente}}, "tipo_pago": 1,
  "informacion_referencia": { "ncf_modificado": "<e_ncf de la E31>", "fecha_ncf_modificado": "<dd-mm-aaaa de hoy>", "codigo_modificacion": "3", "razon_modificacion": "Ajuste de prueba WA" },
  "items": [{ "nombre_item": "WA linea libre", "indicador_facturacion": 1, "indicador_bien_servicio": 1, "cantidad": 1, "precio_unitario": 600 }]
}

### R5/R6 Compuerta 12.0 pasos 3-4: los corre tools/test_write_ahead_api.php con --copia-db=wa_scratch_sin_gate (una
### segunda API en 8097 sobre la copia sin 027/028). A mano: en la copia, una fila ACEPTADO con el siguiente e-NCF y
### ambiente_dgii 'ecf'; emitir en acepta -> 502 "No se pudo asignar el número de comprobante. Inténtalo de nuevo."
### sin fila nueva ni recepcion. Luego, con sql_mode estricto, una E32 < 250k en acepta_condicional -> 502 incierto y
### respuesta_dgii.resultado_parcial.estado = RFCE_ACEPTADO_CONDICIONAL.

### Decision 7: la app no reenvia -> POST /reenviar sigue respondiendo 501
POST {{base}}/api/facturas/{{facturaId}}/reenviar
X-API-KEY: {{token}}
```

- [ ] **Step 5: Walk through the `.http` once by hand (local API, mock DGII)**

Set the scratchpad path first. It is the scratchpad directory your system prompt lists; the value below was the planning session's:

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
```

Write a one-off launcher with Write at `$S/wa_lanzador.php`. It is never committed:

```php
<?php
// Lanzador de un solo uso (scratchpad, nunca en el repo): mock + API sobre
// wa_scratch para recorrer tests/test_facturas_write_ahead.http a mano.
require 'C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead/tools/write_ahead_test_lib.php';
$pdo = wa_pdo('wa_scratch');
wa_limpiar($pdo);
$ids = wa_sembrar($pdo);
$srv = wa_api('wa_scratch');
echo "@base = {$srv['api']}\n@mock = {$srv['mock']}\n@token = {$srv['token']}\n";
echo "@cliente = {$ids['client_id']}\n@producto = {$ids['product_id']}\n";
echo "Mock + API arriba por 30 minutos.\n";
sleep(1800);
```

Run it in the background:

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql "$S/wa_lanzador.php"
```

Fill the `.http` variables from its output. Run each request in order, with the REST client or the equivalent `curl` against `127.0.0.1` only, and do the "(en la base)" SQL steps on `wa_scratch`.

For each step, record in the task report the HTTP status and whether the response matched the `###` expectation. Stop the launcher at the end; this also stops both servers.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add tools/test_write_ahead_api.php tests/test_facturas_write_ahead.http
git commit -F - <<'EOF'
test(facturas): escenarios http del write-ahead

test_write_ahead_api.php suma los escenarios de 12.3.5 y 12.0:
- stats con una fila en vuelo: cuenta como fila, no como dinero ni venta;
- los reportes de ventas y 607 la excluyen;
- la fila en vuelo imprime PDF y XML como cualquier otra (decision 4);
- una E34 en vuelo ya resta saldo;
- sobre la copia sin 027/028: el numero de otro ambiente se rechaza antes
  del envio, y sin la 028 en modo estricto la confirmacion RFCE queda
  incierta con resultado_parcial.

91/91 con --copia-db. tests/test_facturas_write_ahead.http recorre lo
mismo a mano contra una API local o de staging con la DGII falsa.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 21: FE: estadosDgii.ts, tipos, filtro y tonos

**Files:**
- Create: `src/api/estadosDgii.ts`. It has zero imports, so `node` can load it as is.
- Create: `scripts/check-errores.ts`. This task writes its labels section; Tasks 22 and 24 add theirs.
- Modify: `src/api/mappers.ts`:
  - the imports at `:1-5`;
  - `DGII_LABEL` and `dgiiLabel` at `:19-36` (moved out);
  - `isRechazo` at `:46-49` (moved out);
  - `mapFacturaRow` keeps calling `dgiiLabel` at `:68`.
- Modify: `src/api/index.ts:81` (the `./mappers` export line).
- Modify: `src/api/types.ts`:
  - `EstadoDgii` at `:23-34`;
  - `FacturaEstadoFiltro` and its docblock at `:218-223`;
  - `EstadoData` at `:249-265`.
- Modify: `src/stores/facturasList.ts:6`. The default `estado: 'aprobado'` at `:26` does not change.
- Modify: `src/components/ui/Badge.tsx:20-27` (one line added after `:22`).
- Modify: `docs/database-structure.md:130` (`e_ncf`) and `:132` (`estado_dgii`).
- Modify: `ecf-api-payloads.md:61` (the `estado` row of the listing parameters).
- Test: `node scripts/check-errores.ts`, then `npm run typecheck`, `npx eslint src scripts` and `node scripts/test-notas-vinculadas.ts`.

**Interfaces:**
- Consumes: the backend state names of spec 4.3 (`EstadosEcf`, Task 4). Nothing in this task's code depends on the API chain, so it can run before Task 4 lands.
- Produces:

```ts
// src/api/estadosDgii.ts (no imports)
export const ESTADOS_EN_VUELO: readonly ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO']   // `as const`
export function dgiiLabel(raw?: string | null): string        // '—' for empty; the label; raw if unknown
export function isRechazo(raw?: string | null): boolean       // RECHAZADO | RECHAZADO_ARCHIVADO | RFCE_RECHAZADO (unchanged)
export function isEnVuelo(raw?: string | null): boolean       // PENDIENTE_ENVIO | ENVIO_INCIERTO
// src/api/types.ts
export type EstadoDgii = /* today's 10 */ | 'PENDIENTE_ENVIO' | 'ENVIO_INCIERTO'
export type FacturaEstadoFiltro = 'aprobado' | 'rechazado' | 'pendiente'
// EstadoData gains: tipo_ecf?: string; en_vuelo?: boolean; nota?: string
// src/stores/facturasList.ts
export type FacturaEstadoUi = 'aprobado' | 'rechazado' | 'pendiente' | 'todos'
```

- `@/api` exports `dgiiLabel`, `isRechazo` and `isEnVuelo`. `src/api/mappers.ts` re-exports all three, so every existing `import { dgiiLabel, isRechazo } from '@/api'` keeps working.
- **Decision 7 overrides the skeleton here.** `EstadoData` gets **no** `puede_reenviar` field. Nothing in the frontend reads or sends a re-send.

House rules for every frontend task (21-27):
- **Worktree:** `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`, branch `feat/ecf-write-ahead`. Each command block below first runs `cd` into it.
- **Line endings:** `core.autocrlf=true`, so the existing files are CRLF on disk. The Edit tool keeps CRLF. New files written with Write are LF, and git normalizes them.
- **Shared checkout:** other sessions may read this checkout. Re-read each file right before editing it, and make targeted edits only. Commit only the named paths (`git commit -F - -- <paths>`).
- **Imports a `node` script can load:** a runtime import goes by relative path with the `.ts` extension. `@/…` is allowed there only as `import type`, which Node strips (precedent: `src/features/cotizaciones/formatos/ferreteria/conversion.ts:11-17`).

- [ ] **Step 0: Commit this plan**

The plan file is untracked when execution starts (`?? docs/superpowers/plans/2026-10-05-ecf-write-ahead-release-1.md`), and every later FE step expects a clean status. Commit only this path:

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short -- docs/superpowers/plans/2026-10-05-ecf-write-ahead-release-1.md
git add docs/superpowers/plans/2026-10-05-ecf-write-ahead-release-1.md && git commit -F - -- docs/superpowers/plans/2026-10-05-ecf-write-ahead-release-1.md <<'EOF'
docs(plan): plan de la Release 1 del write-ahead del e-CF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: the first command prints the `??` line; the commit succeeds and the log shows `docs(plan): plan de la Release 1 del write-ahead del e-CF`. If the first command prints nothing, the plan is already committed: skip the commit.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git branch --show-current
git status --short
node --version
npm run typecheck && npx eslint src scripts && node scripts/test-notas-vinculadas.ts | tail -1
ls src/api/estadosDgii.ts scripts/check-errores.ts
grep -rn "puede_reenviar" src scripts
```

Expected:
- `feat/ecf-write-ahead`, and `git status --short` prints nothing (Step 0 committed the plan).
- `v25.2.1` (any v22.18 or newer strips the types).
- typecheck and eslint print no errors; the notes test prints `37/37 OK`.
- `ls` reports `No such file or directory` for both files.
- The `grep` prints nothing.

- [ ] **Step 2: Write the failing test (`scripts/check-errores.ts`, labels section)**

Create `scripts/check-errores.ts` with Write:

```ts
// Textos que ve el cajero alrededor de la emisión de un e-CF: las etiquetas de
// los estados DGII (src/api/estadosDgii.ts) y, en las secciones siguientes, los
// textos del servidor y del front que errores.ts debe dejar pasar o elegir.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/check-errores.ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves.
const ordenar = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
      : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

// --- Etiquetas de los estados DGII ------------------------------------------
console.log('dgiiLabel / isEnVuelo / isRechazo (src/api/estadosDgii.ts)')
// Todos los estados de facturas.estado_dgii (spec 4.3) y los literales que un
// VARCHAR(20) sin modo estricto cortó antes de la migración 028 (spec 9.1).
const ESTADOS = [
  'PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'ACEPTADO', 'ACEPTADO_CONDICIONAL',
  'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO', 'RFCE_ACEPTADO',
  'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_RECHAZADO', 'RFCE_NO_ENCONTRADO', 'RFCE_ERROR', 'RECHAZADO_ARCHIVADO',
  'NO_ENCONTRADO_ARCHIVADO', 'RFCE_RECHAZADO_ARCHIVADO', 'RFCE_NO_ENCONTRADO_ARCHIVADO',
  'RFCE_ACEPTADO_CONDIC', 'RFCE_RECHAZADO_ARCHI', 'NO_ENCONTRADO_ARCHIV', 'RFCE_NO_ENCONTRADO_A',
]
for (const e of ESTADOS) {
  const l = dgiiLabel(e)
  chk(`${e} -> "${l}" (una etiqueta, no el código)`, l !== e && l !== '—')
}
igual('en vuelo: Por enviar / Sin confirmar',
  [dgiiLabel('PENDIENTE_ENVIO'), dgiiLabel('ENVIO_INCIERTO')], ['Por enviar', 'Sin confirmar'])
igual('vacío o nulo -> "—"; desconocido -> el código tal cual',
  [dgiiLabel(null), dgiiLabel(undefined), dgiiLabel(''), dgiiLabel('OTRO_ESTADO')], ['—', '—', '—', 'OTRO_ESTADO'])
igual('isEnVuelo: solo PENDIENTE_ENVIO y ENVIO_INCIERTO',
  ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', null, ''].map(isEnVuelo), [true, true, false, false, false])
igual('isRechazo no cambia: RECHAZADO, RECHAZADO_ARCHIVADO y RFCE_RECHAZADO',
  ['RECHAZADO', 'RECHAZADO_ARCHIVADO', 'RFCE_RECHAZADO', 'ENVIO_INCIERTO', 'NO_ENCONTRADO_ARCHIVADO'].map(isRechazo),
  [true, true, true, false, false])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/check-errores.ts; echo "exit=$?"
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\src\api\estadosDgii.ts' imported from …\scripts\check-errores.ts`, then `exit=1`.

- [ ] **Step 4: Create `src/api/estadosDgii.ts`**

```ts
// Estados DGII de una factura e-CF (facturas.estado_dgii): la etiqueta corta que
// ve el usuario y las preguntas que hacen las pantallas (¿es un rechazo?, ¿está
// en vuelo?). Sin imports: scripts/check-errores.ts lo carga con `node` tal
// cual. El resto de la app lo usa desde '@/api' (mappers.ts lo re-exporta).

/** Etiqueta corta (reutiliza los tonos de EstadoBadge) para un estado DGII. */
const DGII_LABEL: Record<string, string> = {
  // Valor por defecto de la columna: ninguna emisión lo escribe (filas viejas).
  PENDIENTE: 'Pendiente',
  // En vuelo: la fila, el XML firmado y el e-NCF se guardaron antes de enviar a
  // la DGII y todavía no hay respuesta (EstadosEcf::EN_VUELO en la API).
  PENDIENTE_ENVIO: 'Por enviar',
  ENVIO_INCIERTO: 'Sin confirmar',
  ACEPTADO: 'Aceptado',
  RFCE_ACEPTADO: 'Aceptado',
  ACEPTADO_CONDICIONAL: 'Aceptado',
  RFCE_ACEPTADO_CONDICIONAL: 'Aceptado',
  ENVIADO: 'En proceso',
  EN_PROCESO: 'En proceso',
  RFCE_ENVIADO: 'En proceso',
  RFCE_EN_PROCESO: 'En proceso',
  RECHAZADO: 'Rechazado',
  RFCE_RECHAZADO: 'Rechazado',
  NO_ENCONTRADO: 'Pendiente',
  RFCE_NO_ENCONTRADO: 'Pendiente',
  ERROR: 'Error',
  RFCE_ERROR: 'Error',
  // Intentos archivados de un número que se volvió a emitir (e_ncf NULL).
  RECHAZADO_ARCHIVADO: 'Rechazado',
  NO_ENCONTRADO_ARCHIVADO: 'Rechazado',
  RFCE_RECHAZADO_ARCHIVADO: 'Rechazado',
  RFCE_NO_ENCONTRADO_ARCHIVADO: 'Rechazado',
  // Los mismos, cortados a 20 caracteres: un tenant sin modo estricto los pudo
  // guardar así antes de la migración 028 (VARCHAR(20) -> VARCHAR(40)).
  RFCE_ACEPTADO_CONDIC: 'Aceptado',
  RFCE_RECHAZADO_ARCHI: 'Rechazado',
  NO_ENCONTRADO_ARCHIV: 'Rechazado',
  RFCE_NO_ENCONTRADO_A: 'Rechazado',
}

/**
 * Estados de una factura guardada antes de enviarla a la DGII y todavía sin
 * respuesta: el número está ocupado y no se puede volver a emitir. Misma lista
 * que EstadosEcf::EN_VUELO en la API.
 */
export const ESTADOS_EN_VUELO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'] as const

/** Etiqueta del estado; '—' si no hay; el código tal cual si no se conoce. */
export function dgiiLabel(raw?: string | null): string {
  if (!raw) return '—'
  return DGII_LABEL[raw] ?? raw
}

/** ¿El estado DGII es un rechazo (incluido RFCE)? */
export function isRechazo(raw?: string | null): boolean {
  return raw === 'RECHAZADO' || raw === 'RECHAZADO_ARCHIVADO' || raw === 'RFCE_RECHAZADO'
}

/** ¿La factura está en vuelo (guardada y firmada, sin respuesta de la DGII)? */
export function isEnVuelo(raw?: string | null): boolean {
  return (ESTADOS_EN_VUELO as readonly string[]).includes(raw ?? '')
}
```

`isRechazo` keeps its three states on purpose:
- gastos use it too (`GastoDetailDrawer.tsx:83`);
- the list's "Rechazados" KPI and the detail's rejection card read it.

The archived and truncated states only get the "Rechazado" label.

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/check-errores.ts | tail -6; echo "exit=${PIPESTATUS[0]}"
```

Expected: the last check lines are `[OK  ]`, the summary is `29/29 OK`, and `exit=0`.

- [ ] **Step 6: `src/api/mappers.ts` imports and re-exports the module**

Replace the last import line (`:5`):

```ts
import { modificaDeFila, notasDeFila } from '@/features/invoices/notasVinculadas'
```

with:

```ts
import { modificaDeFila, notasDeFila } from '@/features/invoices/notasVinculadas'
import { dgiiLabel } from './estadosDgii'

// Etiquetas y preguntas sobre el estado DGII: viven en estadosDgii.ts (sin
// imports, para probarlas con node) y se re-exportan aquí, de donde la app
// siempre las importó.
export { dgiiLabel, isRechazo, isEnVuelo } from './estadosDgii'
```

The blank line that followed `:5` stays after the new block.

To delete `:19-36`, replace:

```ts
/** Etiqueta corta (reutiliza los tonos de EstadoBadge) para un estado DGII. */
const DGII_LABEL: Record<string, string> = {
  ACEPTADO: 'Aceptado',
  RFCE_ACEPTADO: 'Aceptado',
  ACEPTADO_CONDICIONAL: 'Aceptado',
  ENVIADO: 'En proceso',
  EN_PROCESO: 'En proceso',
  RECHAZADO: 'Rechazado',
  RECHAZADO_ARCHIVADO: 'Rechazado',
  RFCE_RECHAZADO: 'Rechazado',
  NO_ENCONTRADO: 'Pendiente',
  RFCE_NO_ENCONTRADO: 'Pendiente',
}

export function dgiiLabel(raw?: string | null): string {
  if (!raw) return '—'
  return DGII_LABEL[raw] ?? raw
}

/** `2026-05` -> `may` (abreviatura de mes en es-DO). */
```

with:

```ts
/** `2026-05` -> `may` (abreviatura de mes en es-DO). */
```

To delete `:46-49`, replace:

```ts
/** ¿El estado DGII es un rechazo (incluido RFCE)? */
export function isRechazo(raw?: string | null): boolean {
  return raw === 'RECHAZADO' || raw === 'RECHAZADO_ARCHIVADO' || raw === 'RFCE_RECHAZADO'
}

export function mapFacturaRow(r: FacturaRow): Factura {
```

with:

```ts
export function mapFacturaRow(r: FacturaRow): Factura {
```

`mapFacturaRow` still calls `dgiiLabel(r.estado_dgii)`, now from the import.

- [ ] **Step 7: `src/api/index.ts:81` exports `isEnVuelo`**

Replace:

```ts
export { formatApiDate, dgiiLabel, isRechazo, formatMonthKey,
```

with:

```ts
export { formatApiDate, dgiiLabel, isRechazo, isEnVuelo, formatMonthKey,
```

The rest of that line stays: `mapFacturaRow, mapClientRow, mapProductRow, mapProveedorRow, mapUserRow } from './mappers'`.

- [ ] **Step 8: `src/api/types.ts`: states, filter and `EstadoData`**

In `EstadoDgii` (`:24-34`), replace:

```ts
  | 'RFCE_ACEPTADO'
  | 'RFCE_RECHAZADO'
  | 'RFCE_NO_ENCONTRADO'
```

with:

```ts
  | 'RFCE_ACEPTADO'
  | 'RFCE_RECHAZADO'
  | 'RFCE_NO_ENCONTRADO'
  // En vuelo: guardada antes de enviar a la DGII, sin respuesta todavía.
  | 'PENDIENTE_ENVIO'
  | 'ENVIO_INCIERTO'
```

Replace `:218-223`:

```ts
/**
 * Filtro de estado DGII (server-side, `?estado=`). Minúsculas.
 * `aprobado` = ACEPTADO/ACEPTADO_CONDICIONAL/RFCE_* aceptados; `rechazado`
 * incluye RFCE_RECHAZADO. (Ver ecf-api-payloads.md.)
 */
export type FacturaEstadoFiltro = 'aprobado' | 'rechazado'
```

with:

```ts
/**
 * Filtro de estado DGII (server-side, `?estado=`). Minúsculas.
 * `aprobado` = ACEPTADO/ACEPTADO_CONDICIONAL/RFCE_* aceptados; `rechazado`
 * incluye RFCE_RECHAZADO; `pendiente` = sin veredicto de la DGII:
 * PENDIENTE_ENVIO, ENVIO_INCIERTO, ENVIADO, EN_PROCESO, RFCE_ENVIADO,
 * RFCE_EN_PROCESO. (Ver ecf-api-payloads.md.)
 */
export type FacturaEstadoFiltro = 'aprobado' | 'rechazado' | 'pendiente'
```

In `EstadoData` (`:249-265`), replace:

```ts
  estado_dgii: EstadoDgii
  secuencia_utilizada: boolean | null
  consulta?: {
```

with:

```ts
  estado_dgii: EstadoDgii
  secuencia_utilizada: boolean | null
  tipo_ecf?: string
  /**
   * true: la factura está en vuelo (PENDIENTE_ENVIO / ENVIO_INCIERTO). La API
   * responde con lo guardado, sin consultar a la DGII.
   */
  en_vuelo?: boolean
  /**
   * Texto para el usuario: en vuelo, o ENVIADO sin número de seguimiento (lo
   * resuelve soporte), o la consulta RFCE que no se pudo hacer.
   */
  nota?: string
  consulta?: {
```

- [ ] **Step 9: `src/stores/facturasList.ts:6` accepts `pendiente`**

Replace:

```ts
export type FacturaEstadoUi = 'aprobado' | 'rechazado' | 'todos'
```

with:

```ts
/** `pendiente` = sin veredicto de la DGII (ver FacturaEstadoFiltro). */
export type FacturaEstadoUi = 'aprobado' | 'rechazado' | 'pendiente' | 'todos'
```

The default `estado: 'aprobado'` at `:26` stays.

- [ ] **Step 10: `src/components/ui/Badge.tsx`: tones for the two new labels**

Replace `:22`:

```tsx
  Aceptado: 'success', 'En proceso': 'warning', Rechazado: 'danger', Pendiente: 'neutral', Anulado: 'neutral',
```

with:

```tsx
  Aceptado: 'success', 'En proceso': 'warning', Rechazado: 'danger', Pendiente: 'neutral', Anulado: 'neutral',
  // Factura e-CF en vuelo (guardada antes de enviarla a la DGII).
  'Por enviar': 'warning', 'Sin confirmar': 'danger',
```

`Error: 'danger'` already exists at `:26`.

- [ ] **Step 11: The two docs mirrors**

In `docs/database-structure.md`, replace `:130`:

```md
| `e_ncf` | varchar(13) | UNIQUE (`uk_e_ncf`) |
```

with:

```md
| `e_ncf` | varchar(13) | UNIQUE (`uk_e_ncf_amb`: `e_ncf` + `ambiente_dgii`, migration 027) |
```

and replace `:132`:

```md
| `estado_dgii` | varchar(20) | PENDIENTE/ENVIADO/ACEPTADO/ACEPTADO_CONDICIONAL/RECHAZADO/ERROR — INDEX |
```

with:

```md
| `estado_dgii` | varchar(40) | migration 028. PENDIENTE (DDL default, legacy); PENDIENTE_ENVIO/ENVIO_INCIERTO (in flight: saved before the DGII send, no answer yet); ENVIADO/EN_PROCESO/ACEPTADO/ACEPTADO_CONDICIONAL/RECHAZADO/NO_ENCONTRADO/ERROR; RFCE_ + any of those (E32 < 250k); `<estado>_ARCHIVADO` (superseded attempt of a re-emitted number, `e_ncf` NULL) — INDEX |
```

In `ecf-api-payloads.md`, replace `:61`:

```md
| `estado` | `todos` | `aprobado` (incluye `ACEPTADO`, `ACEPTADO_CONDICIONAL` y `RFCE_*` aceptados), `rechazado` (incluye `RFCE_RECHAZADO`) o `todos` |
```

with:

```md
| `estado` | `todos` | `aprobado` (incluye `ACEPTADO`, `ACEPTADO_CONDICIONAL` y `RFCE_*` aceptados), `rechazado` (incluye `RFCE_RECHAZADO`), `pendiente` (sin veredicto de la DGII: `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO`, `RFCE_ENVIADO`, `RFCE_EN_PROCESO`) o `todos` |
```

`src/db/schema.ts:111` is generated from a production dump (`scripts/gen-schema.ps1`), so do not edit it by hand.

- [ ] **Step 12: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
node scripts/check-errores.ts | tail -1
node scripts/test-notas-vinculadas.ts | tail -1
grep -n "DGII_LABEL\|function isRechazo\|function dgiiLabel" src/api/mappers.ts
grep -rn "puede_reenviar" src scripts
```

Expected:
- `tsc=0` and `eslint=0`, with no other output from either.
- `29/29 OK` and `37/37 OK`.
- Both `grep` commands print nothing:
  - the labels live only in `estadosDgii.ts`;
  - no `puede_reenviar` exists (decision 7).

- [ ] **Step 13: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/api/estadosDgii.ts src/api/mappers.ts src/api/index.ts src/api/types.ts src/stores/facturasList.ts src/components/ui/Badge.tsx docs/database-structure.md ecf-api-payloads.md scripts/check-errores.ts
git commit -F - -- src/api/estadosDgii.ts src/api/mappers.ts src/api/index.ts src/api/types.ts src/stores/facturasList.ts src/components/ui/Badge.tsx docs/database-structure.md ecf-api-payloads.md scripts/check-errores.ts <<'EOF'
feat(facturas): etiquetas de los estados en vuelo y del filtro pendiente

DGII_LABEL, dgiiLabel e isRechazo pasan a src/api/estadosDgii.ts, sin
imports, para probarlos con node (scripts/check-errores.ts); mappers.ts los
re-exporta. Nuevas etiquetas: Por enviar (PENDIENTE_ENVIO), Sin confirmar
(ENVIO_INCIERTO), los RFCE_*, ERROR, los archivados, los cortados a 20
caracteres y PENDIENTE. isEnVuelo y ESTADOS_EN_VUELO para las pantallas.
FacturaEstadoFiltro y FacturaEstadoUi aceptan 'pendiente'; EstadoData trae
tipo_ecf, en_vuelo y nota (sin puede_reenviar: la app no reenvia, decision 7).
Tonos del Badge y espejos de la estructura de la base.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 22: FE: errores.ts apunta al filtro Pendientes

**Files:**
- Modify: `src/api/errores.ts`. It has no imports and keeps none.
  - `MSG_TARDO_ESCRITURA` at `:80-84`: the new `MSG_TARDO_EMISION` goes right after it.
  - `RE_ESTADO_DGII` at `:151-154`.
  - `textoServidor` at `:271-284`; its emission text is at `:274-276`.
  - The 504 branch of `textoPorStatus` at `:303`.
  - `networkError` at `:437-443`; it picks the message at `:439`.
  - Unchanged: `MSG_TARDO_ESCRITURA` and `MSG_INESPERADO_ESCRITURA` (`:94-95`).
- Modify: `scripts/check-errores.ts` (from Task 21): one import line, and the errores section before the summary.
- Test: `node scripts/check-errores.ts`, `npm run typecheck`, `npx eslint src scripts`.

**Interfaces:**
- Consumes:
  - from `errores.ts` (existing, exported):
    - `humanizar(raw: string | null | undefined, status: number, ctx?: ContextoError): Humanizado` (`:354`);
    - `clasificar(texto: string): TipoTecnico | null` (`:224`);
    - `networkError(e: unknown, ctx?: ContextoError): ApiError` (`:437`);
  - from Task 21: `scripts/check-errores.ts` with its `chk`, `igual` and summary lines.
- Produces (behavior of `errores.ts`, no new exports):
  - a timeout or a 504 of `POST /api/facturas` gives `MSG_TARDO_EMISION`; every other write keeps `MSG_TARDO_ESCRITURA`;
  - a 5xx of `POST /api/facturas` without a usable server text gives the new `textoServidor` text, which sends the user to the Pendientes filter;
  - server texts that quote `PENDIENTE_ENVIO` or `ENVIO_INCIERTO` are no longer classified as `'interno'`.

The test holds verbatim copies of the server texts, each with a pointer to its PHP source. Tasks 5, 17 and 18 pin the same texts on the API side.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -1 -- src/api/estadosDgii.ts
node scripts/check-errores.ts | tail -1
grep -c "^import" src/api/errores.ts
```

Expected:
- `git status --short` prints nothing.
- The log shows Task 21's commit.
- `29/29 OK`.
- `0` imports.

- [ ] **Step 2: Add the errores section to `scripts/check-errores.ts` (the failing test)**

Replace the import line:

```ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'
```

with:

```ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
```

Then replace the summary line:

```ts
console.log(`\n${total - fallos}/${total} OK`)
```

with:

```ts
// --- Textos de la emisión (src/api/errores.ts) -------------------------------
// Copias LITERALES de textos del servidor. Si uno cambia allá, se cambia aquí:
//   - FACTURA_EMISION_INCIERTA, FACTURA_NOTA_EN_VUELO y FACTURA_NOTA_ENVIADO_SIN_TRACK:
//     api-gratex src/Controllers/facturaController.php (constantes globales);
//   - EcfNumeroOcupadoException::MENSAJE_USUARIO:
//     api-gratex src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php;
//   - la guarda del total: handleEmisionECF en facturaController.php (422).
const FACTURA_EMISION_INCIERTA =
  'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.'
const NUMERO_OCUPADO = 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'
const TOTAL_SIN_CALCULAR = 'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.'
const FACTURA_NOTA_EN_VUELO =
  'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.'
const FACTURA_NOTA_ENVIADO_SIN_TRACK =
  'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.'
// Textos propios del front (errores.ts no los exporta): se comparan literales.
const MSG_TARDO_EMISION =
  'El servidor tardó demasiado en responder. Puede que el comprobante sí se haya emitido: revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
const MSG_TARDO = 'El servidor tardó demasiado en responder. Inténtalo de nuevo.'
const TEXTO_SERVIDOR_EMISION =
  'No se pudo completar la emisión del e-CF. Revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'

const ENCF = 'E310000000123'
const conNcf = (texto: string): string => texto.replace('%s', ENCF)
const EMISION = { metodo: 'POST', path: '/api/facturas' }

console.log('humanizar: los textos del servidor sobre la emisión pasan tal cual')
igual('502 incierto (FACTURA_EMISION_INCIERTA)', humanizar(conNcf(FACTURA_EMISION_INCIERTA), 502, EMISION),
  { mensaje: conNcf(FACTURA_EMISION_INCIERTA), reemplazado: false })
igual('502 número ocupado', humanizar(NUMERO_OCUPADO, 502, EMISION), { mensaje: NUMERO_OCUPADO, reemplazado: false })
igual('422 total sin calcular', humanizar(TOTAL_SIN_CALCULAR, 422, EMISION), { mensaje: TOTAL_SIN_CALCULAR, reemplazado: false })

console.log('clasificar: textos que citan los estados en vuelo no son técnicos')
for (const [desc, texto] of [
  ['nota en vuelo (GET /estado)', conNcf(FACTURA_NOTA_EN_VUELO)],
  ['nota ENVIADO sin seguimiento (GET /estado)', conNcf(FACTURA_NOTA_ENVIADO_SIN_TRACK)],
  ['texto que cita ENVIO_INCIERTO', `La factura ${ENCF} está en estado ENVIO_INCIERTO.`],
  ['texto que cita PENDIENTE_ENVIO', `La factura ${ENCF} está en estado PENDIENTE_ENVIO.`],
] as const) {
  const tipo = clasificar(texto)
  chk(`${desc} -> null (dio ${tipo})`, tipo === null)
}

console.log('tiempos de espera y fallos del servidor en la emisión')
// networkError avisa por consola en cada llamada: se calla mientras corre.
const warn = console.warn
console.warn = () => {}
try {
  const timeout = () => new DOMException('', 'TimeoutError')
  igual('timeout de POST /api/facturas -> MSG_TARDO_EMISION', networkError(timeout(), EMISION).message, MSG_TARDO_EMISION)
  igual('timeout de otra escritura (POST /api/clients) -> MSG_TARDO_ESCRITURA de siempre',
    networkError(timeout(), { metodo: 'POST', path: '/api/clients' }).message, MSG_TARDO_ESCRITURA)
  igual('timeout de una lectura -> MSG_TARDO de siempre',
    networkError(timeout(), { metodo: 'GET', path: '/api/facturas' }).message, MSG_TARDO)
} finally {
  console.warn = warn
}
igual('504 de POST /api/facturas -> MSG_TARDO_EMISION', humanizar('', 504, EMISION).mensaje, MSG_TARDO_EMISION)
igual('504 de otra escritura -> MSG_TARDO_ESCRITURA de siempre',
  humanizar('', 504, { metodo: 'POST', path: '/api/clients' }).mensaje, MSG_TARDO_ESCRITURA)
const caido = humanizar('', 500, EMISION).mensaje
chk(`500 sin texto en POST /api/facturas -> manda al filtro Pendientes (dio "${caido}")`,
  caido.startsWith(TEXTO_SERVIDOR_EMISION))

console.log(`\n${total - fallos}/${total} OK`)
```

The final `if (fallos > 0) process.exit(1)` line stays where it is, after the summary.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/check-errores.ts | grep -E "FALLA|OK$"; echo "exit=${PIPESTATUS[0]}"
```

Expected: exactly these five `[FALLA]` lines (long values cut here), then `37/42 OK` and `exit=1`:

```
  [FALLA] texto que cita ENVIO_INCIERTO -> null (dio interno)
  [FALLA] texto que cita PENDIENTE_ENVIO -> null (dio interno)
  [FALLA] timeout de POST /api/facturas -> MSG_TARDO_EMISION: dio "El servidor tardó demasiado en responder. Puede que sí se haya guardado: …"
  [FALLA] 504 de POST /api/facturas -> MSG_TARDO_EMISION: dio "El servidor tardó demasiado en responder. Puede que sí se haya guardado: …"
  [FALLA] 500 sin texto en POST /api/facturas -> manda al filtro Pendientes (dio "No se pudo completar la emisión del e-CF. Revisa el listado de facturas antes de intentarlo otra vez.")
```

The three server texts and both 7.3 notes already pass, because `humanizar` passes them through unchanged today.

- [ ] **Step 4: `src/api/errores.ts`: the new constant (`:83-84`)**

Replace:

```ts
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
```

with:

```ts
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
// La emisión (POST /api/facturas) guarda la factura ANTES de enviarla a la
// DGII: si el navegador se rindió, la factura está en el filtro Pendientes con
// su e-NCF. Emitir otra vez gastaría otro número para la misma venta.
const MSG_TARDO_EMISION =
  'El servidor tardó demasiado en responder. Puede que el comprobante sí se haya emitido: revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'
```

- [ ] **Step 5: `src/api/errores.ts`: the whitelist (`:151-154`)**

Replace:

```ts
// …salvo los estados DGII de una factura, que las reglas de negocio citan
// ("ya existe una factura … en estado EN_PROCESO") y el usuario ve en la lista.
const RE_ESTADO_DGII =
  /\b(RFCE_)?(ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|ACEPTADO|RECHAZADO|ENVIADO)\b/g
```

with:

```ts
// …salvo los estados DGII de una factura, que las reglas de negocio citan
// ("ya existe una factura … en estado EN_PROCESO") y el usuario ve en la lista.
// Los dos primeros son los de una factura en vuelo (guardada antes de enviarla).
const RE_ESTADO_DGII =
  /\b(RFCE_)?(PENDIENTE_ENVIO|ENVIO_INCIERTO|ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|ACEPTADO|RECHAZADO|ENVIADO)\b/g
```

- [ ] **Step 6: `src/api/errores.ts`: the server-failure text (`:274-276`)**

Replace:

```ts
    // Un fallo a mitad de la emisión puede haber dejado el e-CF enviado: antes
    // de repetir hay que mirar el listado.
    return 'No se pudo completar la emisión del e-CF. Revisa el listado de facturas antes de intentarlo otra vez.'
```

with:

```ts
    // Un fallo a mitad de la emisión puede haber dejado el e-CF guardado y
    // enviado: antes de repetir hay que mirar el filtro Pendientes.
    return 'No se pudo completar la emisión del e-CF. Revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'
```

- [ ] **Step 7: `src/api/errores.ts`: the 504 branch (`:303`) and `networkError` (`:439`)**

Replace:

```ts
  if (status === 504 && esEscritura(ctx)) return MSG_TARDO_ESCRITURA
```

with:

```ts
  if (status === 504 && esEscritura(ctx)) return esEmisionEcf(ctx) ? MSG_TARDO_EMISION : MSG_TARDO_ESCRITURA
```

Replace:

```ts
  const mensaje = timeout ? (esEscritura(ctx) ? MSG_TARDO_ESCRITURA : MSG_TARDO) : MSG_SIN_CONEXION
```

with:

```ts
  const mensaje = timeout
    ? esEmisionEcf(ctx) ? MSG_TARDO_EMISION : esEscritura(ctx) ? MSG_TARDO_ESCRITURA : MSG_TARDO
    : MSG_SIN_CONEXION
```

`esEmisionEcf` (`:255`) is a module-private arrow function. Both call sites run after the module has loaded, so its position below the constants does not matter.

- [ ] **Step 8: Run the test and the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/check-errores.ts | tail -1; echo "exit=${PIPESTATUS[0]}"
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
grep -c "^import" src/api/errores.ts
node scripts/test-notas-vinculadas.ts | tail -1
```

Expected:
- `42/42 OK` and `exit=0`.
- `tsc=0` and `eslint=0`.
- `0` imports in `errores.ts`.
- `37/37 OK`.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/api/errores.ts scripts/check-errores.ts
git commit -F - -- src/api/errores.ts scripts/check-errores.ts <<'EOF'
feat(errores): textos de la emision apuntan al filtro Pendientes

La emision guarda la factura antes de enviarla a la DGII: un timeout o un 504
de POST /api/facturas dice ahora que el comprobante puede estar emitido y que
se revise el filtro Pendientes (MSG_TARDO_EMISION); las demas escrituras
siguen con MSG_TARDO_ESCRITURA. El texto propio de un 5xx de la emision
tambien manda a Pendientes. RE_ESTADO_DGII deja pasar PENDIENTE_ENVIO y
ENVIO_INCIERTO. scripts/check-errores.ts fija los textos del servidor
(502 incierto, numero ocupado, total sin calcular, notas de GET /estado).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 23: FE: una nota en vuelo no anula la factura

**Files:**
- Modify: `src/features/invoices/notasVinculadas.ts`:
  - the header comment and the `import type` lines at `:1-9`: they stay, and a runtime import is added after them;
  - the constants at `:11-14`;
  - `anuladaPor` at `:110-113`;
  - the `lineasVinculo` docblock at `:120-124` and its `else` branch at `:137-140`.
- Modify: `scripts/test-notas-vinculadas.ts`:
  - the helper `n()` at `:78-80`;
  - the new cases, right after the `anuladaPor` assert at `:109-111`.
- Unchanged: `InvoiceDetailView.tsx:277-279` already calls `anuladaPor`, so its "Anulada por la nota de crédito …" subtitle now shows only for an accepted annulment.
- Test: `node scripts/test-notas-vinculadas.ts`, `npm run typecheck`, `npx eslint src scripts`.

**Interfaces:**
- Consumes: Task 21's `isEnVuelo(raw?: string | null): boolean`, imported as `'../../api/estadosDgii.ts'`.
- Produces:

```ts
export function anuladaPor(notas: readonly NotaVinculada[] | null | undefined): NotaVinculada | null
// a code '1' credit note whose estadoDgii is ACEPTADO or ACEPTADO_CONDICIONAL; null otherwise
export function lineasVinculo(f: { notas?: readonly NotaVinculada[] | null; modifica?: ComprobanteModificado | null }): LineaVinculo[]
// no accepted annulment: names the first in-flight code-1 credit note, else notas[0];
// an in-flight named note reads 'Nota de crédito E340000000002 (sin confirmar)' (+ ' +N'), tone 'muted'
```

This follows spec 2.1 and resolved decision 23.
- The API lists in-flight notes as linked, because they reserve saldo.
- A note in `EN_PROCESO` or `ENVIADO` is not in flight, so it gets no suffix. It no longer annuls either.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "export function isEnVuelo" src/api/estadosDgii.ts
node scripts/test-notas-vinculadas.ts | tail -1
```

Expected:
- `git status --short` prints nothing.
- The grep finds the export from Task 21.
- `37/37 OK`.

- [ ] **Step 2: Write the failing cases in `scripts/test-notas-vinculadas.ts`**

Replace the helper (`:78-80`):

```ts
const n = (id: number, tipo: string, codigo: string | null, ncf: string, total = 100): N => ({
  id, ncf, tipo, codigoModificacion: codigo, total, estadoDgii: 'ACEPTADO', fecha: null,
})
```

with:

```ts
const n = (id: number, tipo: string, codigo: string | null, ncf: string, total = 100, estadoDgii = 'ACEPTADO'): N => ({
  id, ncf, tipo, codigoModificacion: codigo, total, estadoDgii, fecha: null,
})
```

Then replace (`:109-111`):

```ts
igual('anuladaPor: la nota de crédito código 1, o null',
  [anuladaPor([n(3, '33', '3', 'A'), n(9, '34', '1', 'B')])?.ncf ?? null, anuladaPor([n(4, '34', '3', 'C')])],
  ['B', null])
```

with:

```ts
igual('anuladaPor: la nota de crédito código 1, o null',
  [anuladaPor([n(3, '33', '3', 'A'), n(9, '34', '1', 'B')])?.ncf ?? null, anuladaPor([n(4, '34', '3', 'C')])],
  ['B', null])

console.log('notas sin veredicto de la DGII (solo una nota aceptada anula)')
const enVuelo = n(9, '34', '1', 'E340000000002', 100, 'ENVIO_INCIERTO')
igual('nota de crédito código 1 en ENVIO_INCIERTO: no anula todavía', anuladaPor([enVuelo]), null)
igual('…y se nombra "(sin confirmar)", tono muted',
  lineasVinculo({ notas: [enVuelo] }),
  [{ texto: 'Nota de crédito E340000000002 (sin confirmar)', tono: 'muted' }])
igual('igual en PENDIENTE_ENVIO',
  lineasVinculo({ notas: [n(9, '34', '1', 'E340000000002', 100, 'PENDIENTE_ENVIO')] }),
  [{ texto: 'Nota de crédito E340000000002 (sin confirmar)', tono: 'muted' }])
igual('código 1 en EN_PROCESO o ENVIADO: no anula, y sin "(sin confirmar)" (no está en vuelo)',
  [
    anuladaPor([n(9, '34', '1', 'E340000000002', 100, 'EN_PROCESO')]),
    anuladaPor([n(9, '34', '1', 'E340000000002', 100, 'ENVIADO')]),
    lineasVinculo({ notas: [n(9, '34', '1', 'E340000000002', 100, 'EN_PROCESO')] }),
  ],
  [null, null, [{ texto: 'Nota de crédito E340000000002', tono: 'muted' }]])
igual('código 1 en ACEPTADO_CONDICIONAL: sí anula',
  lineasVinculo({ notas: [n(9, '34', '1', 'E340000000002', 100, 'ACEPTADO_CONDICIONAL')] }),
  [{ texto: 'Anulada por E340000000002', tono: 'danger' }])
igual('sin anulación aceptada se nombra la anulación en vuelo, aunque no sea la primera',
  lineasVinculo({ notas: [n(4, '34', '3', 'E340000000001'), enVuelo] }),
  [{ texto: 'Nota de crédito E340000000002 (sin confirmar) +1', tono: 'muted' }])
igual('nota en vuelo que no anula (código 3), sola: también "(sin confirmar)"',
  lineasVinculo({ notas: [n(4, '34', '3', 'E340000000003', 100, 'ENVIO_INCIERTO')] }),
  [{ texto: 'Nota de crédito E340000000003 (sin confirmar)', tono: 'muted' }])
igual('una anulación aceptada gana a una en vuelo',
  lineasVinculo({ notas: [enVuelo, n(10, '34', '1', 'E340000000004')] }),
  [{ texto: 'Anulada por E340000000004 +1', tono: 'danger' }])
```

The 37 existing asserts do not change, because the helper's default state stays `'ACEPTADO'`.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-notas-vinculadas.ts | grep -E "FALLA|OK$"; echo "exit=${PIPESTATUS[0]}"
```

Expected: seven `[FALLA]` lines, then `38/45 OK` and `exit=1`. For example:
- `[FALLA] nota de crédito código 1 en ENVIO_INCIERTO: no anula todavía: dio {…"estadoDgii":"ENVIO_INCIERTO"…}, se esperaba null`;
- `[FALLA] …y se nombra "(sin confirmar)", tono muted: dio [{"texto":"Anulada por E340000000002","tono":"danger"}], …`;
- `[FALLA] una anulación aceptada gana a una en vuelo: dio [{"texto":"Anulada por E340000000002 +1","tono":"danger"}], …`.

Of the new cases, only `código 1 en ACEPTADO_CONDICIONAL: sí anula` passes.

- [ ] **Step 4: `notasVinculadas.ts`: the import and the accepted states**

Replace (`:7-14`):

```ts
// modifica). PDO manda los INT y los DECIMAL como texto: aquí se convierten.
import type { FacturaModificaRow, FacturaNotaRow } from '@/api'
import type { ComprobanteModificado, NotaVinculada } from '@/types/domain'

const NOTA_CREDITO = '34'
const NOTA_DEBITO = '33'
/** CodigoModificacion DGII que anula el comprobante. */
const CODIGO_ANULA = '1'
```

with:

```ts
// modifica). PDO manda los INT y los DECIMAL como texto: aquí se convierten.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { FacturaModificaRow, FacturaNotaRow } from '@/api'
import type { ComprobanteModificado, NotaVinculada } from '@/types/domain'
import { isEnVuelo } from '../../api/estadosDgii.ts'

const NOTA_CREDITO = '34'
const NOTA_DEBITO = '33'
/** CodigoModificacion DGII que anula el comprobante. */
const CODIGO_ANULA = '1'
/**
 * Estados en que la DGII ya aceptó la nota. La API manda también las notas en
 * proceso y en vuelo (cuentan para el saldo), pero solo una aceptada anula.
 */
const ESTADOS_ACEPTADA = ['ACEPTADO', 'ACEPTADO_CONDICIONAL']
```

- [ ] **Step 5: `notasVinculadas.ts`: `anuladaPor` counts accepted notes only**

Replace (`:110-113`):

```ts
/** La nota de crédito que anula el comprobante (código 1), o null. */
export function anuladaPor(notas: readonly NotaVinculada[] | null | undefined): NotaVinculada | null {
  return notas?.find((n) => esNotaCredito(n.tipo) && n.codigoModificacion === CODIGO_ANULA) ?? null
}
```

with:

```ts
/** ¿Es una nota de crédito con código 1 (la que anula el comprobante)? */
const esAnulacion = (n: NotaVinculada): boolean => esNotaCredito(n.tipo) && n.codigoModificacion === CODIGO_ANULA

/**
 * La nota de crédito ACEPTADA por la DGII que anula el comprobante (código 1),
 * o null. Una en proceso o en vuelo todavía no anula nada: la DGII puede
 * rechazarla o no tenerla.
 */
export function anuladaPor(notas: readonly NotaVinculada[] | null | undefined): NotaVinculada | null {
  return notas?.find((n) => esAnulacion(n) && ESTADOS_ACEPTADA.includes(n.estadoDgii)) ?? null
}
```

- [ ] **Step 6: `notasVinculadas.ts`: `lineasVinculo` names the in-flight note**

Replace the docblock (`:120-124`):

```ts
/**
 * Líneas cortas bajo el e-NCF en el listado. En una nota, primero el
 * comprobante que modifica; después, si la fila tiene notas, la que la anula
 * (en rojo) o la primera, con " +N" por las demás.
 */
```

with:

```ts
/**
 * Líneas cortas bajo el e-NCF en el listado. En una nota, primero el
 * comprobante que modifica; después, si la fila tiene notas, la que la anula
 * (en rojo, solo si la DGII la aceptó) o, si no, la anulación en vuelo o la
 * primera nota, con " +N" por las demás. Una nota en vuelo lleva
 * " (sin confirmar)": la DGII todavía no ha respondido.
 */
```

Replace the `else` branch (`:137-140`):

```ts
    } else {
      const primera = notas[0]
      lineas.push({ texto: `${tipoNotaLabel(primera.tipo) || 'Nota'} ${primera.ncf}${mas}`, tono: 'muted' })
    }
```

with:

```ts
    } else {
      const nota = notas.find((x) => esAnulacion(x) && isEnVuelo(x.estadoDgii)) ?? notas[0]
      const sinConfirmar = isEnVuelo(nota.estadoDgii) ? ' (sin confirmar)' : ''
      lineas.push({ texto: `${tipoNotaLabel(nota.tipo) || 'Nota'} ${nota.ncf}${sinConfirmar}${mas}`, tono: 'muted' })
    }
```

- [ ] **Step 7: Run the test and the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-notas-vinculadas.ts | tail -1; echo "exit=${PIPESTATUS[0]}"
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
node scripts/check-errores.ts | tail -1
```

Expected:
- `45/45 OK` and `exit=0`.
- `tsc=0` and `eslint=0`.
- `42/42 OK` from `check-errores.ts`.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/features/invoices/notasVinculadas.ts scripts/test-notas-vinculadas.ts
git commit -F - -- src/features/invoices/notasVinculadas.ts scripts/test-notas-vinculadas.ts <<'EOF'
fix(facturas): una nota en vuelo no anula la factura

La API lista como vinculadas las notas en vuelo (reservan saldo). anuladaPor
solo cuenta una nota de credito codigo 1 ACEPTADA o ACEPTADA_CONDICIONAL; sin
ella, la linea del listado nombra la anulacion en vuelo (o la primera nota)
con " (sin confirmar)" si la DGII aun no respondio. El subtitulo "Anulada por"
del detalle usa la misma funcion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 24: FE: ayudas puras para comprobantes sin confirmar

**Files:**
- Create: `src/features/invoices/enVuelo.ts`.
  - Its runtime imports are relative `.ts` paths only: `../../api/errores.ts` (`ApiError`) and `../../api/estadosDgii.ts` (`dgiiLabel`, `isEnVuelo`).
  - `import type { Factura } from '@/types/domain'`, which Node strips.
  - `errores.ts` resolves to the same module that `http.ts` uses and `@/api` re-exports, both in Vite and in Node. So `instanceof ApiError` holds for the errors of `createFactura`.
- Create: `scripts/test-en-vuelo.ts`.
- Modify: `scripts/check-errores.ts`: one import, and the card and footer section before the summary.
- Test: `node scripts/test-en-vuelo.ts`, `node scripts/check-errores.ts`, `npm run typecheck`, `npx eslint src scripts`.

**Interfaces:**
- Consumes:
  - from Task 21: `dgiiLabel(raw?: string | null): string` and `isEnVuelo(raw?: string | null): boolean`;
  - existing: `ApiError` (`src/api/errores.ts:40-59`; `status: number`, `datos: unknown`) and `Factura` (`src/types/domain.ts:75-107`);
  - the 502 incierto body of `POST /api/facturas` (spec 7.1, Task 17). `http.ts:90-93` turns it into `ApiError(status 502, datos = body.data)`.
- Produces:

```ts
export interface DatosEmisionIncierta { factura_id: number; e_ncf: string; tipo_ecf: string; estado_dgii: string }
export function contarSinConfirmar(porEstado: readonly { estado: string; total: number }[] | null | undefined): number
export function textoChipSinConfirmar(n: number): string
export function datosEmisionIncierta(e: unknown): DatosEmisionIncierta | null
export function facturaEmisionIncierta(
  d: DatosEmisionIncierta,
  form: Pick<Factura, 'cliente' | 'clienteId' | 'rnc' | 'subtotal' | 'itbis' | 'total' | 'metodo'>,
): Factura
export function textoTarjetaEnVuelo(eNcf: string): string
export const PIE_DOCUMENTO: string           // 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF'
export const PIE_DOCUMENTO_EN_VUELO: string  // 'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF'
export function textoPieDocumento(estadoRaw: string | null | undefined): string
```

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -3
ls src/features/invoices/enVuelo.ts scripts/test-en-vuelo.ts
```

Expected:
- `git status --short` prints nothing.
- The log shows the commits of Tasks 21-23.
- `ls` reports both files missing.

- [ ] **Step 2: Write the failing test `scripts/test-en-vuelo.ts`**

```ts
// Facturas e-CF en vuelo (guardadas antes de enviarlas a la DGII, sin respuesta
// todavía): el conteo y el chip del listado, los datos del 502 "incierto" con
// que el formulario abre la factura, y los textos de la tarjeta y del pie del
// detalle (src/features/invoices/enVuelo.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-en-vuelo.ts
import { ApiError } from '../src/api/errores.ts'
import {
  PIE_DOCUMENTO, PIE_DOCUMENTO_EN_VUELO, contarSinConfirmar, datosEmisionIncierta, facturaEmisionIncierta,
  textoChipSinConfirmar, textoPieDocumento, textoTarjetaEnVuelo,
} from '../src/features/invoices/enVuelo.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves.
const ordenar = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
      : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

console.log('contarSinConfirmar / textoChipSinConfirmar (listado y dashboard e-CF)')
igual('suma solo PENDIENTE_ENVIO y ENVIO_INCIERTO de por_estado', contarSinConfirmar([
  { estado: 'PENDIENTE_ENVIO', total: 1 },
  { estado: 'ENVIO_INCIERTO', total: 2 },
  { estado: 'ENVIADO', total: 5 },
  { estado: 'ACEPTADO', total: 9 },
]), 3)
igual('sin stats todavía -> 0', [contarSinConfirmar(null), contarSinConfirmar(undefined), contarSinConfirmar([])], [0, 0, 0])
igual('chip en singular y en plural',
  [textoChipSinConfirmar(1), textoChipSinConfirmar(3)],
  ['1 comprobante sin confirmar · Ver', '3 comprobantes sin confirmar · Ver'])

console.log('datosEmisionIncierta (catch del formulario)')
// Lo que http.ts arma con el 502 incierto de POST /api/facturas (spec 7.1):
// el texto del servidor como mensaje y su `data` en `datos`. PDO puede mandar
// el id como texto.
const MSG = 'No se pudo confirmar si la DGII recibió la factura E310000000123. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.'
const DATOS = { factura_id: '41', e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' }
igual('502 con data.factura_id -> datos normalizados (id en número)',
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: DATOS })),
  { factura_id: 41, e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' })
igual('PENDIENTE_ENVIO también vale', datosEmisionIncierta(new ApiError(MSG, 502, {
  datos: { factura_id: 42, e_ncf: 'E320000000007', tipo_ecf: '32', estado_dgii: 'PENDIENTE_ENVIO' },
}))?.estado_dgii, 'PENDIENTE_ENVIO')
igual('otro status (500) -> null', datosEmisionIncierta(new ApiError(MSG, 500, { datos: DATOS })), null)
igual('502 sin data (fallo antes de enviar: nada quedó guardado) -> null',
  datosEmisionIncierta(new ApiError('No se pudo emitir la factura en la DGII.', 502)), null)
igual('factura_id 0, negativo, decimal o ausente -> null', [
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: 0 } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: -3 } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: '4.5' } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { e_ncf: 'E310000000123' } })),
], [null, null, null, null])
igual('un Error que no es ApiError -> null', datosEmisionIncierta(new Error('x')), null)

console.log('facturaEmisionIncierta (la factura que abre "Ver factura")')
const f = facturaEmisionIncierta(
  { factura_id: 41, e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' },
  { cliente: 'Ferretería Ejemplo', clienteId: '7', rnc: '131234567', subtotal: 1000, itbis: 180, total: 1180, metodo: 'Efectivo' },
)
igual('id, e-NCF y estado de la fila guardada; montos y cliente del formulario', f, {
  id: '41', facturaId: 41, ncf: 'E310000000123', tipo: '31',
  cliente: 'Ferretería Ejemplo', clienteId: '7', rnc: '131234567',
  fecha: '—', vence: '—', subtotal: 1000, itbis: 180, total: 1180,
  estado: 'Emitida', dgii: 'Sin confirmar', metodo: 'Efectivo',
  trackId: null, codigoSeguridad: null, estadoDgiiRaw: 'ENVIO_INCIERTO',
})

console.log('tarjeta y pie del detalle')
igual('tarjeta en vuelo (spec 9.1)', textoTarjetaEnVuelo('E310000000123'),
  'Este comprobante quedó reservado con el e-NCF E310000000123, pero la DGII no ha confirmado su recepción.')
igual('pie de siempre', PIE_DOCUMENTO, 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF')
igual('pie en vuelo', PIE_DOCUMENTO_EN_VUELO,
  'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF')
igual('textoPieDocumento: en vuelo -> pie en vuelo; lo demás -> el de siempre',
  ['ENVIO_INCIERTO', 'PENDIENTE_ENVIO', 'ACEPTADO', 'ENVIADO', null, undefined].map(textoPieDocumento),
  [PIE_DOCUMENTO_EN_VUELO, PIE_DOCUMENTO_EN_VUELO, PIE_DOCUMENTO, PIE_DOCUMENTO, PIE_DOCUMENTO, PIE_DOCUMENTO])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

- [ ] **Step 3: Add the card and footer section to `scripts/check-errores.ts`**

Replace:

```ts
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
```

with:

```ts
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
import {
  PIE_DOCUMENTO_EN_VUELO, textoChipSinConfirmar, textoTarjetaEnVuelo,
} from '../src/features/invoices/enVuelo.ts'
```

Then replace the summary line:

```ts
console.log(`\n${total - fallos}/${total} OK`)
```

with:

```ts
// --- Textos del front para una factura en vuelo (enVuelo.ts) -----------------
// Pasan por clasificar como cualquier aviso: ninguno puede parecer técnico.
console.log('clasificar: tarjeta, pie y chip de una factura en vuelo')
for (const [desc, texto] of [
  ['tarjeta del detalle', textoTarjetaEnVuelo(ENCF)],
  ['pie del documento en vuelo', PIE_DOCUMENTO_EN_VUELO],
  ['chip del listado', textoChipSinConfirmar(2)],
] as const) {
  const tipo = clasificar(texto)
  chk(`${desc} -> null (dio ${tipo})`, tipo === null)
}

console.log(`\n${total - fallos}/${total} OK`)
```

`ENCF` is the constant that Task 22 declared earlier in the same file.

- [ ] **Step 4: Run both and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-en-vuelo.ts 2>&1 | grep -m1 ERR_MODULE_NOT_FOUND; echo "exit=${PIPESTATUS[0]}"
node scripts/check-errores.ts 2>&1 | grep -m1 ERR_MODULE_NOT_FOUND; echo "exit=${PIPESTATUS[0]}"
```

Expected, for each script: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\src\features\invoices\enVuelo.ts' imported from …`, then `exit=1`.

- [ ] **Step 5: Create `src/features/invoices/enVuelo.ts`**

```ts
// Factura e-CF en vuelo: guardada y firmada ANTES de enviarla a la DGII y
// todavía sin respuesta (PENDIENTE_ENVIO / ENVIO_INCIERTO). Su e-NCF está
// ocupado: no se emite otra vez; si no se confirma sola, la resuelve soporte.
// Aquí está lo que dicen de ella el listado, el formulario y el detalle. Sin
// React: scripts/test-en-vuelo.ts lo prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra. errores.ts es el
// mismo módulo que http.ts usa y '@/api' re-exporta: `instanceof ApiError`
// reconoce los errores de la API.
import type { Factura } from '@/types/domain'
import { ApiError } from '../../api/errores.ts'
import { dgiiLabel, isEnVuelo } from '../../api/estadosDgii.ts'

/** `data` del 502 "incierto" de POST /api/facturas: la fila que quedó guardada. */
export interface DatosEmisionIncierta {
  factura_id: number
  e_ncf: string
  tipo_ecf: string
  estado_dgii: string
}

/** Cuántas facturas están en vuelo, según `por_estado` de GET /api/facturas/stats. */
export function contarSinConfirmar(porEstado: readonly { estado: string; total: number }[] | null | undefined): number {
  return (porEstado ?? []).filter((e) => isEnVuelo(e.estado)).reduce((a, e) => a + (Number(e.total) || 0), 0)
}

/** Texto del chip del listado que lleva al filtro Pendientes. */
export function textoChipSinConfirmar(n: number): string {
  return n === 1 ? '1 comprobante sin confirmar · Ver' : `${n} comprobantes sin confirmar · Ver`
}

/**
 * Datos de un 502 "incierto": la factura quedó guardada pero no se sabe si la
 * DGII la recibió. null en cualquier otro error. Un 502 sin `data.factura_id`
 * es un fallo antes de enviar (nada quedó guardado) y se trata como siempre.
 */
export function datosEmisionIncierta(e: unknown): DatosEmisionIncierta | null {
  if (!(e instanceof ApiError) || e.status !== 502) return null
  if (e.datos == null || typeof e.datos !== 'object') return null
  const d = e.datos as Record<string, unknown>
  // PDO puede mandar el id como texto ("41").
  const id = Number(d.factura_id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    factura_id: id,
    e_ncf: String(d.e_ncf ?? ''),
    tipo_ecf: String(d.tipo_ecf ?? ''),
    estado_dgii: String(d.estado_dgii ?? ''),
  }
}

/**
 * La Factura con que "Ver factura" abre el detalle tras un 502 incierto: la
 * fila guardada (id, e-NCF, estado) y lo demás del formulario, como la que se
 * arma al emitir bien. Sin fecha (el detalle la trae) ni track ni código de
 * seguridad (la DGII no respondió).
 */
export function facturaEmisionIncierta(
  d: DatosEmisionIncierta,
  form: Pick<Factura, 'cliente' | 'clienteId' | 'rnc' | 'subtotal' | 'itbis' | 'total' | 'metodo'>,
): Factura {
  return {
    id: String(d.factura_id),
    facturaId: d.factura_id,
    ncf: d.e_ncf,
    tipo: d.tipo_ecf,
    cliente: form.cliente,
    clienteId: form.clienteId,
    rnc: form.rnc,
    fecha: '—',
    vence: '—',
    subtotal: form.subtotal,
    itbis: form.itbis,
    total: form.total,
    estado: 'Emitida',
    dgii: dgiiLabel(d.estado_dgii),
    metodo: form.metodo,
    trackId: null,
    codigoSeguridad: null,
    estadoDgiiRaw: d.estado_dgii,
  }
}

/** Primera línea de la tarjeta del detalle de una factura en vuelo. */
export function textoTarjetaEnVuelo(eNcf: string): string {
  return `Este comprobante quedó reservado con el e-NCF ${eNcf}, pero la DGII no ha confirmado su recepción.`
}

/** Pie del documento en el detalle. */
export const PIE_DOCUMENTO = 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF'
/** Pie de una factura en vuelo: firmada, pero sin la recepción de la DGII. */
export const PIE_DOCUMENTO_EN_VUELO =
  'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF'

export function textoPieDocumento(estadoRaw: string | null | undefined): string {
  return isEnVuelo(estadoRaw) ? PIE_DOCUMENTO_EN_VUELO : PIE_DOCUMENTO
}
```

`PIE_DOCUMENTO` matches today's footer at `InvoiceDetailView.tsx:435` character for character. Task 27 replaces that literal with `textoPieDocumento(estadoRaw)`.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-en-vuelo.ts | tail -1; echo "exit=${PIPESTATUS[0]}"
node scripts/check-errores.ts | tail -5; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `test-en-vuelo.ts`: `14/14 OK`, `exit=0`.
- `check-errores.ts`:
  - these three lines: `[OK  ] tarjeta del detalle -> null (dio null)`, `[OK  ] pie del documento en vuelo -> null (dio null)`, `[OK  ] chip del listado -> null (dio null)`;
  - then `45/45 OK` and `exit=0`.

- [ ] **Step 7: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
node scripts/test-notas-vinculadas.ts | tail -1
```

Expected: `tsc=0`, `eslint=0` and `45/45 OK`.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/features/invoices/enVuelo.ts scripts/test-en-vuelo.ts scripts/check-errores.ts
git commit -F - -- src/features/invoices/enVuelo.ts scripts/test-en-vuelo.ts scripts/check-errores.ts <<'EOF'
feat(facturas): ayudas puras para comprobantes sin confirmar

src/features/invoices/enVuelo.ts reune lo que listado, formulario y detalle
dicen de una factura en vuelo: el conteo y el chip "N comprobantes sin
confirmar · Ver" (de por_estado), los datos del 502 incierto de POST
/api/facturas y la Factura con que "Ver factura" abre el detalle, el texto de
la tarjeta y el pie del documento. Sin React ni alias en tiempo de ejecucion:
scripts/test-en-vuelo.ts lo prueba con node, y check-errores.ts confirma que
ningun texto parece tecnico.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 25: FE: Pendientes y Sin confirmar en el listado y el dashboard e-CF

**Files:**
- Modify: `src/features/invoices/InvoiceListView.tsx`:
  - the imports (`:8`);
  - `ESTADO_OPCIONES` (`:14-18`);
  - the stats block (`:66-79`): the count goes after `montoTotal` at `:79`;
  - the `PageHead` `actions` (`:99-104`);
  - the KPI grid (`:107-112`).
- Modify: `src/features/ecf/EcfDashboardView.tsx`:
  - the imports (`:6`);
  - the counts (`:15-18`);
  - the `estados` array (`:25-30`);
  - the KPI grid and its "2x2" comment (`:50-53`).
- Test: `npm run typecheck`, `npx eslint src scripts`, `npm run build`, and the node scripts. The browser check is in Task 28.

**Interfaces:**
- Consumes:
  - from Task 24: `contarSinConfirmar(porEstado): number` and `textoChipSinConfirmar(n): string`, imported from `./enVuelo` in the list and from `@/features/invoices/enVuelo` in the dashboard;
  - from Task 21:
    - `FacturaEstadoUi` with `'pendiente'`;
    - `FacturaEstadoFiltro` with `'pendiente'`, which `listFacturas` passes through as `?estado=pendiente`;
  - existing:
    - `IconName` `'alert-triangle'` (`Icon.tsx:45`);
    - `KPI` props `label`, `value`, `icon`, `iconBg` and `iconColor` (`KPI.tsx:7-17`);
    - `PageHead`, which takes only `title`, `sub`, `crumbs` and `actions` (`PageHead.tsx:9-14`);
    - the `filter-chip` class (precedent at `InvoiceListView.tsx:123`).
- Produces: UI wiring only.
  - The list's "Pendientes" option sends `estado=pendiente` to `GET /api/facturas` (spec 7.2). The API accepts it from Task 18 on, and the deploy order is API first (spec 13.1).
  - **Unchanged:** "Monto total" (`:76-79`, `montoTotalKpi`). It reads `resumen.monto_neto`, which the backend computes without in-flight rows (Task 16).

The two grids need no CSS:
- `.kpi-grid` is `repeat(auto-fit, minmax(180px, 1fr))` (`src/styles/styles.css:375`), so a fifth KPI fits.
- The e-CF dashboard grid has a fixed 2 columns (`EcfDashboardView.tsx:51`). Total spans the first row, and the four state buckets form the 2x2 below it.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "export function contarSinConfirmar\|export function textoChipSinConfirmar" src/features/invoices/enVuelo.ts
grep -c "value: 'pendiente'" src/features/invoices/InvoiceListView.tsx
grep -c "Sin confirmar" src/features/invoices/InvoiceListView.tsx src/features/ecf/EcfDashboardView.tsx
```

Expected:
- `git status --short` prints nothing.
- Both exports are found (Task 24).
- The counts are `0`, `…InvoiceListView.tsx:0` and `…EcfDashboardView.tsx:0`. These counts are the check that this task turns to 1.

- [ ] **Step 2: `InvoiceListView.tsx`: import, option and count**

Replace (`:8`):

```tsx
import { conSigno, lineasVinculo, montoTotalKpi, sumaConSigno } from './notasVinculadas'
```

with:

```tsx
import { conSigno, lineasVinculo, montoTotalKpi, sumaConSigno } from './notasVinculadas'
import { contarSinConfirmar, textoChipSinConfirmar } from './enVuelo'
```

Replace (`:16-17`):

```tsx
  { value: 'rechazado', label: 'Rechazados' },
  { value: 'todos', label: 'Todos' },
]
```

with:

```tsx
  { value: 'rechazado', label: 'Rechazados' },
  // Sin veredicto de la DGII: en vuelo, enviados y en proceso (spec 7.2).
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'todos', label: 'Todos' },
]
```

Replace (`:79`):

```tsx
  const montoTotal = montoTotalKpi(resumen, rechazadosBuckets.reduce((a, e) => a + Number(e.monto_total), 0))
```

with:

```tsx
  const montoTotal = montoTotalKpi(resumen, rechazadosBuckets.reduce((a, e) => a + Number(e.monto_total), 0))
  // Facturas en vuelo (guardadas antes de enviarlas, sin respuesta de la DGII).
  // El "Monto total" ya no las cuenta: el backend las saca de monto_neto.
  const sinConfirmar = contarSinConfirmar(porEstado)
```

- [ ] **Step 3: `InvoiceListView.tsx`: chip and KPI**

Replace (`:100-101`):

```tsx
          <>
            <RefreshButton onRefresh={() => Promise.all([reload(), stats.reload()])} />
```

with:

```tsx
          <>
            {sinConfirmar > 0 && (
              <button type="button" className="filter-chip" onClick={() => changeEstado('pendiente')}>
                {textoChipSinConfirmar(sinConfirmar)}
              </button>
            )}
            <RefreshButton onRefresh={() => Promise.all([reload(), stats.reload()])} />
```

Replace (`:111-112`):

```tsx
        <KPI label="Rechazados" value={rechazados} icon="x-circle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
      </div>
```

with:

```tsx
        <KPI label="Rechazados" value={rechazados} icon="x-circle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
        <KPI label="Sin confirmar" value={sinConfirmar} icon="alert-triangle" iconBg="var(--danger-soft)" iconColor="var(--danger)" />
      </div>
```

`changeEstado` is declared at `:90`, before the JSX that uses it.

- [ ] **Step 4: `EcfDashboardView.tsx`: the fifth KPI and the layout**

Replace (`:6`):

```tsx
import { RangosNcfModal } from './RangosNcfModal'
```

with:

```tsx
import { RangosNcfModal } from './RangosNcfModal'
import { contarSinConfirmar } from '@/features/invoices/enVuelo'
```

Replace (`:18`):

```tsx
  const totalEcf = d?.resumen.total_ecf ?? 0
```

with:

```tsx
  // En vuelo: "Total e-CF" las cuenta y ningún otro cuadro sí; sin este, los
  // cuadros no suman el total.
  const totalSinConfirmar = contarSinConfirmar(d?.por_estado)
  const totalEcf = d?.resumen.total_ecf ?? 0
```

Replace (`:29-30`):

```tsx
    { label: 'Rechazados', value: totalRechazados, color: 'var(--danger)', icon: 'x-circle', bg: 'var(--danger-soft)' },
  ]
```

with:

```tsx
    { label: 'Rechazados', value: totalRechazados, color: 'var(--danger)', icon: 'x-circle', bg: 'var(--danger-soft)' },
    { label: 'Sin confirmar', value: totalSinConfirmar, color: 'var(--danger)', icon: 'alert-triangle', bg: 'var(--danger-soft)' },
  ]
```

Replace (`:50-53`):

```tsx
            {/* KPIs compactos (2x2) al lado de Secuencias: sin franja vacía */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {estados.map((e, i) => (
                <div className="kpi" key={i} style={{ padding: '10px 14px' }}>
```

with:

```tsx
            {/* KPIs compactos al lado de Secuencias: el total ocupa la primera
                fila entera y los cuatro estados quedan en 2x2, sin hueco. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {estados.map((e, i) => (
                <div className="kpi" key={i} style={{ padding: '10px 14px', gridColumn: e.total ? '1 / -1' : undefined }}>
```

The `total: true` flag already marks the Total entry (`:26`), so no new field is needed.

- [ ] **Step 5: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build 2>&1 | tail -2; echo "build=${PIPESTATUS[0]}"
for f in scripts/check-errores.ts scripts/test-en-vuelo.ts scripts/test-notas-vinculadas.ts; do echo "$f :: $(node "$f" | tail -1)"; done
grep -c "value: 'pendiente'" src/features/invoices/InvoiceListView.tsx
grep -c "Sin confirmar" src/features/invoices/InvoiceListView.tsx src/features/ecf/EcfDashboardView.tsx
git status --short
```

Expected:
- `tsc=0`, `eslint=0` and `build=0`. The build ends with `✓ built in …`; its chunk-size warning was already there before this task.
- `45/45 OK`, `14/14 OK` and `45/45 OK`.
- The counts are `1`, `…InvoiceListView.tsx:1` and `…EcfDashboardView.tsx:1`.
- The status lists only the two modified views (`dist/` is ignored).

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/features/invoices/InvoiceListView.tsx src/features/ecf/EcfDashboardView.tsx
git commit -F - -- src/features/invoices/InvoiceListView.tsx src/features/ecf/EcfDashboardView.tsx <<'EOF'
feat(facturas): Pendientes y Sin confirmar en el listado y el dashboard

El listado gana el filtro Pendientes (?estado=pendiente: sin veredicto de la
DGII), el KPI "Sin confirmar" (facturas en vuelo, de por_estado) y, si hay
alguna, el chip "N comprobantes sin confirmar · Ver" que abre ese filtro. El
dashboard e-CF suma el cuadro "Sin confirmar"; Total ocupa la primera fila y
los cuatro estados quedan en 2x2. "Monto total" no cambia: el backend ya
saca las filas en vuelo de monto_neto.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 26: FE: formulario bloqueado con Ver factura tras un 502 incierto

**Files:**
- Modify: `src/features/invoices/InvoiceFormView.tsx`:
  - the imports (`:29`);
  - the state next to `emitting` (`:214`);
  - the guard (`:548`);
  - the `catch` of `emitir` (`:585-588`);
  - the action bar (`:1007-1014`): a "Ver factura" button before Emitir, and Emitir's label.
- Test: `npm run typecheck`, `npx eslint src scripts`, `npm run build`, and the node scripts. The browser check, which emits against the mock's 502 incierto, is in Task 28.

**Interfaces:**
- Consumes:
  - from Task 24: `datosEmisionIncierta(e: unknown): DatosEmisionIncierta | null` and `facturaEmisionIncierta(d, form): Factura`, imported from `./enVuelo`;
  - from sonner 2.0.7:
    - `toast.error(msg, { id, duration, action: { label, onClick } })` and `toast.dismiss()` (`node_modules/sonner/dist/index.d.ts:43`, `:60-62`);
    - a click on the toast action closes the toast;
    - `<Toaster … closeButton />` (`App.tsx:254`) lets the user close a toast that never expires;
  - from the form (existing): `cliente`, `subtotal`, `itbisTotal`, `total`, `metodo`, `queryClient`, `tid`, and `nav('factura-ver', Factura, { replace: true })`;
  - the 502 incierto of Task 17: `{status:false, error:sprintf(FACTURA_EMISION_INCIERTA, e_ncf), data:{factura_id, e_ncf, tipo_ecf, estado_dgii}}`.
- Produces: UI wiring. After a 502 incierto:
  - the toast shows the server text and a "Ver factura" action, and never expires;
  - the form stays locked: Emitir reads "Emisión sin confirmar" and stays disabled, and the bar shows "Ver factura";
  - `['facturas']` is invalidated, so the list, the stats and the next e-NCF refresh.

Every other error keeps today's two lines: the toast, then `setEmitting(false)`. A 502 without `data.factura_id` (a pre-send failure, or a gateway HTML page) counts as one of those other errors.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "export function datosEmisionIncierta\|export function facturaEmisionIncierta" src/features/invoices/enVuelo.ts
grep -c "facturaEnVuelo\|Emisión sin confirmar" src/features/invoices/InvoiceFormView.tsx
```

Expected:
- `git status --short` prints nothing.
- Both exports are found (Task 24).
- The count is `0`.

- [ ] **Step 2: Import and state**

Replace (`:29`):

```tsx
import { indFactFromItbis, montosLinea, totalesDocumento } from './montosLinea'
```

with:

```tsx
import { indFactFromItbis, montosLinea, totalesDocumento } from './montosLinea'
import { datosEmisionIncierta, facturaEmisionIncierta } from './enVuelo'
```

Replace (`:214`):

```tsx
  const [emitting, setEmitting] = useState(false)
```

with:

```tsx
  const [emitting, setEmitting] = useState(false)
  // Tras un 502 "incierto" la factura quedó guardada con su e-NCF, pero no se
  // sabe si la DGII la recibió. El formulario se queda bloqueado (emitirla otra
  // vez gastaría otro número para la misma venta) y ofrece abrirla.
  const [facturaEnVuelo, setFacturaEnVuelo] = useState<Factura | null>(null)
```

`Factura` is already imported as a type (`:24`).

- [ ] **Step 3: The guard**

Replace (`:548`):

```tsx
    if (emitting || sinNumeros) return
```

with:

```tsx
    // facturaEnVuelo: el bloqueo no depende de useAccionUnica, que se suelta al terminar.
    if (emitting || sinNumeros || facturaEnVuelo) return
```

`useAccionUnica` returns a new wrapper on each render (`useAccionUnica.ts:14-26`), so the guard reads the current state.

- [ ] **Step 4: The `catch` handles the 502 incierto first**

Replace (`:585-589`):

```tsx
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo emitir la factura.', { id: tid })
      setEmitting(false)
    }
  })
```

with:

```tsx
    } catch (e) {
      const incierta = datosEmisionIncierta(e)
      if (incierta) {
        // La factura existe (en vuelo): el listado y la secuencia cambiaron.
        void queryClient.invalidateQueries({ queryKey: ['facturas'] })
        const f = facturaEmisionIncierta(incierta, {
          cliente: cliente?.nombre ?? 'Consumidor final',
          clienteId: cliente?.id ?? '',
          rnc: cliente?.doc ?? '',
          subtotal,
          itbis: itbisTotal,
          total,
          metodo,
        })
        setFacturaEnVuelo(f)
        // Sin duración: el texto del servidor dice qué hacer y no debe irse solo
        // (el Toaster tiene botón de cerrar).
        toast.error((e as ApiError).message, {
          id: tid,
          duration: Infinity,
          action: { label: 'Ver factura', onClick: () => nav('factura-ver', f, { replace: true }) },
        })
        // Sin setEmitting(false): el formulario queda bloqueado.
        return
      }
      toast.error(e instanceof ApiError ? e.message : 'No se pudo emitir la factura.', { id: tid })
      setEmitting(false)
    }
  })
```

The cast is safe, because `datosEmisionIncierta` returns non-null only for an `ApiError`. The message is the server's `FACTURA_EMISION_INCIERTA` text, which `humanizar` passes through unchanged (Task 22's check).

- [ ] **Step 5: The action bar**

Replace (`:1012-1014`):

```tsx
          <Btn variant="primary" icon="send" onClick={emitir} disabled={emitting || sinNumeros != null} title={sinNumeros ?? undefined}>
            {emitting ? 'Emitiendo…' : 'Emitir e-CF'}
          </Btn>
```

with:

```tsx
          {facturaEnVuelo && (
            // El aviso sin duración no hace falta en el detalle: allí lo dice la tarjeta.
            <Btn variant="secondary" icon="eye" onClick={() => { toast.dismiss(); nav('factura-ver', facturaEnVuelo, { replace: true }) }}>
              Ver factura
            </Btn>
          )}
          <Btn variant="primary" icon="send" onClick={emitir} disabled={emitting || sinNumeros != null} title={sinNumeros ?? undefined}>
            {facturaEnVuelo ? 'Emisión sin confirmar' : emitting ? 'Emitiendo…' : 'Emitir e-CF'}
          </Btn>
```

Emitir stays disabled because `emitting` stays true. "Cancelar" (`:1008`) and "Vista previa" (`:1009-1011`) do not change.

- [ ] **Step 6: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build 2>&1 | tail -2; echo "build=${PIPESTATUS[0]}"
for f in scripts/check-errores.ts scripts/test-en-vuelo.ts scripts/test-notas-vinculadas.ts; do echo "$f :: $(node "$f" | tail -1)"; done
grep -c "facturaEnVuelo" src/features/invoices/InvoiceFormView.tsx
git status --short
```

Expected:
- `tsc=0`, `eslint=0` and `build=0`.
- `45/45 OK`, `14/14 OK` and `45/45 OK`.
- The count is `6`: the lines that name `facturaEnVuelo`.
- The status lists only `InvoiceFormView.tsx`.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/features/invoices/InvoiceFormView.tsx
git commit -F - -- src/features/invoices/InvoiceFormView.tsx <<'EOF'
feat(facturas): el formulario queda bloqueado con Ver factura tras un 502 incierto

Con el 502 incierto de POST /api/facturas (data.factura_id) la factura ya
esta guardada: se invalida ['facturas'], el aviso con el texto del servidor
no expira y trae la accion "Ver factura", y el formulario queda bloqueado
("Emision sin confirmar") con "Ver factura" en la barra. Emitir otra vez
gastaria otro numero para la misma venta. Los demas errores siguen igual.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 27: FE: tarjeta de comprobante en vuelo en el detalle

**Files:**
- Modify: `src/features/invoices/InvoiceDetailView.tsx`:
  - the imports (`:15`);
  - the in-flight card and the lone note, between the rejection card (`:236-251`) and the band comment (`:253`);
  - the band (`:254-268`): one line after `Cód. seguridad` (`:264`);
  - the footer (`:434-436`).
- Modify: `src/config/cache.ts:37-38` (comment only).
- Unchanged (decision 4): the print buttons "Ver PDF", "Imprimir recibo" and "XML firmado" (`:440-462`), and `lineasImpresas` (`:81`, `:128-131`).
- Test: `npm run typecheck`, `npx eslint src scripts`, `npm run build`, and the node scripts. The browser check is in Task 28.

**Interfaces:**
- Consumes:
  - from Task 24: `textoTarjetaEnVuelo(eNcf: string): string` and `textoPieDocumento(estadoRaw: string | null | undefined): string`, imported from `./enVuelo`;
  - from Task 21: `EstadoData.en_vuelo?: boolean` and `EstadoData.nota?: string`;
  - the 7.3 shape of `GET /api/facturas/{id}/estado` (Task 18):
    - for an in-flight row, `{factura_id, e_ncf, tipo_ecf, track_id:null, estado_dgii, secuencia_utilizada:null, en_vuelo:true, nota}`;
    - for `ENVIADO` without `track_id`, the same with `en_vuelo:false` and the other note;
    - the existing RFCE branch already sends a `nota` with no `en_vuelo` (`facturaController.php:733-737`, `:789-793`);
  - `useApiQuery`'s `error: string | null` (`useApiQuery.ts:25`, `:62`): the text that a failed `GET /estado` leaves.
- Produces: UI wiring only.
  - When `en_vuelo` is true: a `--warning-soft` card with the `alert-triangle` icon, then `textoTarjetaEnVuelo(e_ncf)` in `fw6 text-sm`, then the `nota`.
  - A `nota` without `en_vuelo` (an `ENVIADO` row without `track_id`, or an RFCE note) shows alone, as a muted line.
  - A failed consult: the band shows `estado.error` as a muted item, and keeps showing the stored state.
  - The footer reads `textoPieDocumento(estadoRaw)`.
  - There is no re-send control anywhere (decision 7). The "Actualizar" button stays as it is until Release 2.

The card text uses the normal text color, not `--warning`. `#b7791f` on `#f6edda` has a contrast of about 3:1, below the 4.5:1 that 13 px text needs. Only the icon is amber.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "export function textoTarjetaEnVuelo\|export function textoPieDocumento" src/features/invoices/enVuelo.ts
grep -c "en_vuelo\|estado.error\|textoPieDocumento" src/features/invoices/InvoiceDetailView.tsx
grep -c "Documento firmado y enviado a la DGII" src/features/invoices/InvoiceDetailView.tsx
```

Expected:
- `git status --short` prints nothing.
- Both exports are found.
- The counts are `0` and `1`.

- [ ] **Step 2: Import**

Replace (`:15`):

```tsx
import { anuladaPor, filasRelacionadas } from './notasVinculadas'
```

with:

```tsx
import { anuladaPor, filasRelacionadas } from './notasVinculadas'
import { textoPieDocumento, textoTarjetaEnVuelo } from './enVuelo'
```

- [ ] **Step 3: The in-flight card and the lone note**

Replace (`:253-254`):

```tsx
      {/* Estado DGII: metadato del documento, no parte del comprobante impreso. */}
      <div className="fx-estado-band fx-estado-band--fuera">
```

with:

```tsx
      {/* En vuelo: guardada y firmada antes de enviarla, sin respuesta de la
          DGII. La nota (GET /estado) dice que no se emita otra vez y que se
          avise a soporte con el e-NCF. */}
      {estadoData?.en_vuelo && (
        <div className="card card-pad" style={{ maxWidth: 1040, margin: '0 auto 14px', background: 'var(--warning-soft)', borderColor: 'transparent' }}>
          {/* El texto en el color normal: el ámbar sobre --warning-soft se lee mal. */}
          <div className="row gap-sm">
            <Icon name="alert-triangle" size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span className="fw6 text-sm">{textoTarjetaEnVuelo(estadoData.e_ncf || f.ncf)}</span>
          </div>
          {estadoData.nota && <div className="text-sm mt-sm">{estadoData.nota}</div>}
        </div>
      )}
      {/* Nota sin estar en vuelo: ENVIADO sin número de seguimiento, o la
          consulta RFCE que no se pudo hacer (se muestra lo guardado). */}
      {!estadoData?.en_vuelo && estadoData?.nota && (
        <div className="text-sm muted" style={{ maxWidth: 1040, margin: '0 auto 12px' }}>{estadoData.nota}</div>
      )}

      {/* Estado DGII: metadato del documento, no parte del comprobante impreso. */}
      <div className="fx-estado-band fx-estado-band--fuera">
```

`Icon` accepts `style` (`Icon.tsx:57-62`). The card copies the rejection card's container (`:237`). `mt-sm` is the class that card uses at `:245`.

- [ ] **Step 4: The consult error in the band**

Replace (`:264-265`):

```tsx
        {f.codigoSeguridad && <span className="fx-estado-dato">Cód. seguridad <b>{f.codigoSeguridad}</b></span>}
        <Btn variant="ghost" size="sm" icon="refresh-cw" onClick={estado.reload} aria-label="Actualizar estado">
```

with:

```tsx
        {f.codigoSeguridad && <span className="fx-estado-dato">Cód. seguridad <b>{f.codigoSeguridad}</b></span>}
        {/* Si la consulta falla se sigue viendo lo guardado; el motivo, en gris. */}
        {estado.error && <span className="fx-estado-dato muted">{estado.error}</span>}
        <Btn variant="ghost" size="sm" icon="refresh-cw" onClick={estado.reload} aria-label="Actualizar estado">
```

- [ ] **Step 5: The footer**

Replace (`:434-436`):

```tsx
        <footer className="fx-nota">
          Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF
        </footer>
```

with:

```tsx
        <footer className="fx-nota">
          {textoPieDocumento(estadoRaw)}
        </footer>
```

`estadoRaw` (`:154`) is the consult's state, or the row's state while the consult loads.

- [ ] **Step 6: `src/config/cache.ts:37-38`**

Replace:

```ts
  // El estado DGII de una factura pasa de ENVIADO a ACEPTADO/RECHAZADO de forma
  // asíncrona, sin que la app haga nada.
```

with:

```ts
  // El estado DGII de una factura pasa de ENVIADO a ACEPTADO/RECHAZADO de forma
  // asíncrona, sin que la app haga nada; una en vuelo (PENDIENTE_ENVIO /
  // ENVIO_INCIERTO) también llega a un veredicto por fuera (soporte).
```

- [ ] **Step 7: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build 2>&1 | tail -2; echo "build=${PIPESTATUS[0]}"
for f in scripts/check-errores.ts scripts/test-en-vuelo.ts scripts/test-notas-vinculadas.ts; do echo "$f :: $(node "$f" | tail -1)"; done
grep -c "Documento firmado y enviado a la DGII" src/features/invoices/InvoiceDetailView.tsx
grep -n "openDoc('pdf')\|openDoc('pdf', false, 'pos')\|XML firmado" src/features/invoices/InvoiceDetailView.tsx
grep -rn "puede_reenviar\|reenviarFactura\|/reenviar" src
git status --short
```

Expected:
- `tsc=0`, `eslint=0` and `build=0`.
- `45/45 OK`, `14/14 OK` and `45/45 OK`.
- The literal count is `0`: the footer text now lives only in `enVuelo.ts`.
- The print-button grep finds:
  - the three buttons unchanged at `:468`, `:472` and `:476` (they were at `:446`, `:450` and `:454`; 22 lines were added above them);
  - the comment at `:128`, which also says "XML firmado".
- The `puede_reenviar|reenviarFactura|/reenviar` grep prints nothing (decision 7). A case-insensitive `reenviar` grep is not used: it also matches `src/features/ecf/ApproveEcfView.tsx:122` (`{pendiente ? 'Revisar' : 'Reenviar'}`), the existing commercial-approval button, which is unrelated to the e-CF send.
- The status lists only `InvoiceDetailView.tsx` and `src/config/cache.ts`.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git add src/features/invoices/InvoiceDetailView.tsx src/config/cache.ts
git commit -F - -- src/features/invoices/InvoiceDetailView.tsx src/config/cache.ts <<'EOF'
feat(facturas): tarjeta de comprobante en vuelo en el detalle

Con en_vuelo (GET /estado, Release 1) el detalle muestra la tarjeta "Este
comprobante quedo reservado con el e-NCF ..." y la nota de la API, que manda
a soporte y pide no emitirlo otra vez. Una nota sin en_vuelo (ENVIADO sin
track, consulta RFCE fallida) va sola. La banda muestra el error de una
consulta fallida en vez de tragarlo, y el pie dice "pendiente de
confirmacion de la DGII" en vuelo. Los botones de impresion no cambian
(decision 4) y no hay reenvio (decision 7).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short
```

Expected: the log shows the new commit, and `git status --short` prints nothing.

---

### Task 28: Verificacion final (API + FE + navegador contra API falsa local)

**Files:**
- Create, in the session scratchpad only (never in a repo): `$S/dev-mock-write-ahead.mjs`.
  - `$S` is the scratchpad directory your system prompt lists.
  - For the planning session it was `C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad`.
- Modify temporarily: `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead/.claude/launch.json`.
  - One entry goes after `fiscalo-dev`.
  - The file is git-tracked, so Step 19 reverts the change.
- No other repo change.
  - A failure found here is fixed in the task that owns it, as its own commit in the repo it touches.
  - Then this task runs again from its first failing step.
- Test: every command below, plus the seven browser checks.

**Interfaces:**
- Consumes everything from Tasks 1-27, in particular:
  - API: `tools/write_ahead_test_lib.php` and the test scripts of Tasks 1-20. The scratch DB comes from `WA_DB_*` or the git-ignored `tools/.env` (Task 2);
  - FE: the labels of Task 21, the texts of Tasks 22 and 24, the list and dashboard of Task 25, the form of Task 26, and the detail of Task 27;
  - the HTTP shapes the mock imitates:
    - spec 7.1 (the 502 incierto);
    - spec 7.2 (`?estado=pendiente`);
    - spec 7.3 Release 1, with no `puede_reenviar` (decision 7);
    - the existing envelopes of `GET /api/facturas`, `?id=`, `/stats` and `/api/auth/me`.
- Produces a verification report:
  - every command with its exit code and its `N de M pruebas OK` / `N/M OK` line;
  - the browser screenshots;
  - a confirmation that no API request left `127.0.0.1` (the mock log and the page's resource list).

Production is never touched (decision 6).
- The fiscalo `.env` proxies to production, so vite only ever runs from the mock script, with `API_PROXY_TARGET` pointed at the mock and `API_KEY` empty.
- The worktree has no `.env` today, but the process environment would win anyway, because that is how Vite's `loadEnv` works.

- [ ] **Step 1: API: the commits are in and the tree is clean**

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git -C "$A" branch --show-current
git -C "$A" log --oneline --reverse 9f669ad..HEAD
git -C "$A" status --short
git -C "$A" check-ignore -q tools/.env && echo "tools/.env ignorado" || echo "sin tools/.env: usar WA_DB_* en el entorno"
```

Expected:
- `feat/ecf-write-ahead`.
- The log lists these commits in this order (fix commits may sit between them):
  - `test(ecf): mock local de la DGII y ayudas de prueba del write-ahead`
  - `test(ecf): base de prueba y arnes de la API para el write-ahead`
  - `test(ecf): compuerta 027/028 sobre la base de prueba`
  - `feat(ecf): EstadosEcf con las listas de estados del e-CF`
  - `feat(ecf): excepciones de numero ocupado y envio incierto`
  - `feat(facturas): metaEnvio, filtro pendiente y notas en vuelo en el saldo`
  - `refactor(facturas): normalizarNotaReferencia sale de saveFacturaConECF`
  - `feat(facturas): reservarFacturaECF guarda la fila antes del envio`
  - `feat(facturas): confirmar y marcar envio incierto del e-CF`
  - `fix(ecf): dispenseNextECF lanza si ncf_sequences falla; guard CR estatico`
  - `refactor(ecf): ECFEmissionService con inyeccion y proyecciones sin XML`
  - `feat(ecf): emitir reserva la fila antes de enviar a la DGII`
  - `feat(ecf): confirmar o marcar incierto despues del envio`
  - `feat(ecf): registro de cierre marca incierto el e-CF en vuelo`
  - `feat(inventario): yaMovioDocumento para mover stock una sola vez`
  - `fix(facturas): las filas en vuelo no cuentan como dinero ni ventas`
  - `feat(facturas): emision write-ahead con 502 incierto y datos de la fila`
  - `feat(facturas): estado de facturas en vuelo, filtro pendiente y stock al aceptar`
  - `docs(ecf): write-ahead, regla de despliegue y resolucion manual`
  - `test(facturas): escenarios http del write-ahead`
- The status shows only `?? tools/reconstruir_e340000000001.sql`.
- One of the two `.env` lines. Credentials are never printed.

**If a commit is missing, stop:** the task that owns it is not done.

- [ ] **Step 2: API: `php -l` on every changed PHP file**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git diff --name-only --diff-filter=d 9f669ad HEAD -- '*.php'
fallos=0; for f in $(git diff --name-only --diff-filter=d 9f669ad HEAD -- '*.php'); do php -l "$f" >/dev/null || { echo "FALLO $f"; fallos=1; }; done; echo "php -l fallos=$fallos"
```

Expected:
- The list includes at least:
  - `src/Utils/FacturacionElectronica/{EstadosEcf,EcfNumeroOcupadoException,EcfEnvioInciertoException,ECFEmissionService,DgiiReceptionService}.php`;
  - `src/Models/{facturaModel,ncfModel,inventoryModel,ReporteVentasModel}.php`;
  - `src/Controllers/facturaController.php` and `src/Utils/FacturaPdfGenerator.php`;
  - `tools/{write_ahead_test_lib,mock_dgii,test_mock_dgii,test_write_ahead_gate,test_write_ahead_puro,test_reservar_confirmar,test_write_ahead_ecf,test_write_ahead_api,check_estado_dgii_ancho,test_notas_vinculadas}.php`.
- `php -l fallos=0`.

- [ ] **Step 3: API: the DB-free scripts**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
for t in tools/test_write_ahead_puro.php tools/check_estado_dgii_ancho.php tools/test_consultar_ecf_dgii.php tools/test_notas_vinculadas.php; do out=$(php "$t" 2>&1); code=$?; echo "$t exit=$code :: $(printf '%s\n' "$out" | tail -1)"; done
```

Expected, each with `exit=0`:
- `tools/test_write_ahead_puro.php` ends with `N de N pruebas OK` (sections 1-13; both numbers equal);
- `tools/check_estado_dgii_ancho.php` ends with `32/32 OK`;
- `tools/test_consultar_ecf_dgii.php` ends with `73/73 OK`;
- `tools/test_notas_vinculadas.php` ends with `62 de 62 pruebas OK`.

- [ ] **Step 4: API: the scratch-DB and mock scripts**

These scripts need the scratch bases of Task 2 (`wa_scratch` and `wa_scratch_sin_gate`, never production), and ports 8097-8099 must be free.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
for t in \
  "tools/test_mock_dgii.php" \
  "tools/write_ahead_test_lib.php --autoprueba --tenant-db=wa_scratch" \
  "tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate" \
  "tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate" \
  "tools/test_write_ahead_ecf.php --tenant-db=wa_scratch" \
  "tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate"; do
  out=$(php $F $t 2>&1); code=$?; echo "$t exit=$code :: $(printf '%s\n' "$out" | tail -1)"
done
```

Expected: six lines, each `exit=0 :: N de N pruebas OK` (both numbers equal). Copy each line into the report.

Local PHP 8.5 loads none of the three extensions by default, so all three flags are needed (Global Constraints, test commands). Never edit the global `php.ini`.

- [ ] **Step 5: API: no PHP 8.4+ syntax (production runs 8.3)**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
FILES=$(git diff --name-only --diff-filter=d 9f669ad HEAD -- '*.php')
echo "hooks:";  grep -nE '\$[A-Za-z_][A-Za-z0-9_]*\s*\{\s*(get|set)\b' $FILES
echo "asym:";   grep -nE '\b(public|protected|private)\(set\)' $FILES
echo "new->:";  grep -nE '(^|[^(A-Za-z0-9_>])new\s+[A-Za-z_\\][A-Za-z0-9_\\]*\s*\([^()]*\)\s*->' $FILES
echo "funcs:";  grep -nE '\b(array_find|array_find_key|array_any|array_all|mb_trim|mb_ltrim|mb_rtrim|mb_ucfirst|mb_lcfirst)\s*\(' $FILES
echo "attr:";   grep -nE '#\[\\?Deprecated\b' $FILES
echo "fin"
```

Expected: no matches. Each label is followed directly by the next one, and the output ends with `fin`.

These patterns were checked against the current files, with no false positives:
- they catch `new Foo()->bar()`, `public private(set) string $x;` and `public string $y { get => 1; }`;
- they skip `(new Foo())->bar()`, which is valid in 8.3.

`php -l` on 8.5 cannot catch these, because they are valid there.

- [ ] **Step 6: API: leftovers and decision 7**

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git -C "$A" grep -n saveFacturaConECF -- src docs CLAUDE.md
git -C "$A" grep -n puede_reenviar -- src docs tools tests
git -C "$A" diff 9f669ad HEAD -- src/Controllers/facturaController.php | grep -nE '^[-+].*(handleReenviar|501)'
git -C "$A" status --short
```

Expected:
- The first three commands print nothing:
  - no `saveFacturaConECF` is left;
  - no `puede_reenviar` exists anywhere;
  - `handleReenviar` and its 501 are untouched (spec 7.4).
- The status still shows only `?? tools/reconstruir_e340000000001.sql`.

- [ ] **Step 7: FE: the commits, the gates and every node script**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git branch --show-current
git log --oneline --reverse a9bf56c..HEAD
git status --short
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build 2>&1 | tail -2; echo "build=${PIPESTATUS[0]}"
for f in scripts/*.ts; do out=$(node "$f" 2>&1); code=$?; echo "$f exit=$code :: $(printf '%s\n' "$out" | tail -1)"; done
grep -rn "puede_reenviar\|reenviarFactura" src scripts
git status --short
```

Expected:
- `feat/ecf-write-ahead`.
- The log ends with the Task 21-27 commits, after the spec and plan commits:
  - `feat(facturas): etiquetas de los estados en vuelo y del filtro pendiente`
  - `feat(errores): textos de la emision apuntan al filtro Pendientes`
  - `fix(facturas): una nota en vuelo no anula la factura`
  - `feat(facturas): ayudas puras para comprobantes sin confirmar`
  - `feat(facturas): Pendientes y Sin confirmar en el listado y el dashboard`
  - `feat(facturas): el formulario queda bloqueado con Ver factura tras un 502 incierto`
  - `feat(facturas): tarjeta de comprobante en vuelo en el detalle`
- `tsc=0`, `eslint=0` and `build=0`. The only build warning is the chunk-size one, which was already there.
- Every script ends with `exit=0`:
  - `scripts/check-errores.ts`: `45/45 OK`;
  - `scripts/parity-cotizacion-ferreteria.ts`: `100/100 OK`;
  - `scripts/test-conversion-ferreteria.ts`: `30/30 OK`;
  - `scripts/test-en-vuelo.ts`: `14/14 OK`;
  - `scripts/test-notas-vinculadas.ts`: `45/45 OK`;
  - `scripts/test-schema-cotizacion-ferreteria.ts`: `25/25 OK`.
- The `grep` prints nothing (decision 7).
- Both statuses print nothing (`dist/` is ignored).

- [ ] **Step 8: Write the mock API and launcher (`$S/dev-mock-write-ahead.mjs`)**

Set `S` first, then create the file with Write. While this plan was written, the script was run end to end against a copy of the Task 21-27 code.

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
```

```js
// API falsa para ver la Release 1 del write-ahead en el navegador SIN tocar
// producción (decisión 6): sirve /api/* en 127.0.0.1:8787 y arranca el vite del
// worktree de fiscalo con el proxy apuntando aquí (API_PROXY_TARGET); API_KEY
// vacío para que el proxy no mande ninguna llave.
//
// Uso: node dev-mock-write-ahead.mjs [--mock-port=8787] [--vite-port=5175] [--fe=<checkout de fiscalo>]
//      (también MOCK_PORT / VITE_PORT / FE_DIR en el entorno). Otros puertos solo
//      si estos están ocupados por otra sesión: nunca se mata un proceso ajeno.
// Control: GET http://127.0.0.1:<mock-port>/__mock/log           (lo que pidió el navegador)
//          GET http://127.0.0.1:<mock-port>/__mock/log?limpiar=1
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'

const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3)
const FE_DIR = arg('fe') || process.env.FE_DIR || 'C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead'
const PUERTO_MOCK = Number(arg('mock-port') || process.env.MOCK_PORT || 8787)
const PUERTO_VITE = Number(arg('vite-port') || process.env.VITE_PORT || 5175)

// Textos del servidor (api-gratex facturaController.php), literales.
const ENCF_INCIERTO = 'E310000000123'
const FACTURA_EMISION_INCIERTA = 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.'
const NOTA_EN_VUELO = 'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.'
const NOTA_ENVIADO_SIN_TRACK = 'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.'
const ESTADO_NO_DISPONIBLE = 'No se pudo consultar el estado en la DGII en este momento. Inténtalo de nuevo en unos minutos.'
const conNcf = (t, ncf) => t.replace('%s', ncf)

// EstadosEcf::SIN_VEREDICTO (filtro ?estado=pendiente) y EstadosEcf::EN_VUELO.
const SIN_VEREDICTO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO']
const EN_VUELO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO']

const fila = (id, eNcf, estado, total, extra = {}) => ({
  id, no_factura: eNcf, e_ncf: eNcf, tipo_ecf: eNcf.slice(1, 3), estado_dgii: estado,
  track_id: EN_VUELO.includes(estado) || estado === 'ENVIADO' ? null : `track-${id}`,
  codigo_seguridad: 'Ab12Cd', date: '2026-10-06 09:30:00', fecha_emision_dgii: '2026-10-06 09:30:00',
  client_id: 7, client_name: 'Cliente Mock', company_name: 'Cliente Mock SRL', description: 'Servicio de prueba',
  total: total.toFixed(2), monto_gravado: (total / 1.18).toFixed(2), monto_exento: '0.00',
  total_itbis: (total - total / 1.18).toFixed(2), notas: [], modifica: null, ...extra,
})
const FILAS = [
  fila(41, ENCF_INCIERTO, 'ENVIO_INCIERTO', 1180),
  fila(42, 'E320000000045', 'PENDIENTE_ENVIO', 590),
  // Factura aceptada con una nota de crédito que la anularía, todavía en vuelo.
  fila(43, 'E310000000120', 'ACEPTADO', 2360, {
    notas: [{ id: '47', e_ncf: 'E340000000009', tipo_ecf: '34', codigo_modificacion: '1', total: '2360.00',
      estado_dgii: 'ENVIO_INCIERTO', date: '2026-10-06 10:00:00' }],
  }),
  fila(44, 'E310000000121', 'RECHAZADO', 118),
  fila(45, 'E310000000122', 'ENVIADO', 236),
  fila(46, 'E310000000119', 'ACEPTADO', 354),
  fila(47, 'E340000000009', 'ENVIO_INCIERTO', 2360, {
    codigo_modificacion: '1', ncf_modificado: 'E310000000120',
    modifica: { id: '43', e_ncf: 'E310000000120', tipo_ecf: '31', total: '2360.00', date: '2026-10-06 09:30:00' },
  }),
]
// GET /estado de esta fila responde 502 (la consulta a la DGII falló).
const ID_ESTADO_FALLA = 46

const filtrar = (estado) => FILAS.filter((f) =>
  estado === 'pendiente' ? SIN_VEREDICTO.includes(f.estado_dgii)
    : estado === 'aprobado' ? f.estado_dgii.includes('ACEPTADO')
      : estado === 'rechazado' ? f.estado_dgii.includes('RECHAZADO')
        : true)

const detalle = (f) => ({
  ...f,
  xml_firmado: null,
  items: [{
    id: f.id * 10, product_id: null, description: 'Servicio de prueba', amount: (Number(f.total) / 1.18).toFixed(4),
    quantity: '1.000', subtotal: (Number(f.total) / 1.18).toFixed(2), descuento_monto: '0.00',
    itbis_amount: (Number(f.total) - Number(f.total) / 1.18).toFixed(2), indicador_facturacion: 1,
    indicador_bien_servicio: 2, unidad_medida: '43',
  }],
  cliente: { id: 7, client_name: 'Cliente Mock', razon_social: 'Cliente Mock SRL', rnc: '131234567' },
  emisor: { razon_social: 'Emisor Mock SRL', rnc: '101000001', direccion: 'Calle 1', municipio: 'Santo Domingo' },
})

const STATS = {
  resumen: {
    total_ecf: 10, monto_total: 9500, monto_neto: '7140.00', tipos_distintos: 3,
    primer_ecf: '2026-09-01 08:00:00', ultimo_ecf: '2026-10-06 10:00:00',
  },
  por_tipo: [
    { tipo_ecf: '31', nombre: 'Factura de Crédito Fiscal', total: 8, monto_total: 6000, aceptados: 5, rfce: 0, rechazados: 1, enviados: 1, ultimo_emitido: 'E310000000123' },
    { tipo_ecf: '32', nombre: 'Factura de Consumo', total: 1, monto_total: 0, aceptados: 0, rfce: 0, rechazados: 0, enviados: 0, ultimo_emitido: 'E320000000045' },
    { tipo_ecf: '34', nombre: 'Nota de Crédito', total: 1, monto_total: 0, aceptados: 0, rfce: 0, rechazados: 0, enviados: 0, ultimo_emitido: 'E340000000009' },
  ],
  por_estado: [
    { estado: 'PENDIENTE_ENVIO', total: 1, monto_total: 590 },
    { estado: 'ENVIO_INCIERTO', total: 2, monto_total: 3540 },
    { estado: 'ACEPTADO', total: 5, monto_total: 7140 },
    { estado: 'RECHAZADO', total: 1, monto_total: 118 },
    { estado: 'ENVIADO', total: 1, monto_total: 236 },
  ],
  por_mes: [{ mes: '2026-10', total: 6, monto_total: 7140 }],
  ventas_por_mes: [{ mes: '2026-10', total: 6, monto_total: 7140 }],
  ventas_por_dia: [{ dia: '2026-10-06', total: 6, monto_total: 7140 }],
  secuencias: [
    { type: 'E31', nombre: 'Factura de Crédito Fiscal', secuencia_actual: 123, total_emitidos: 8, restantes: 877, vencimiento: '2027-12-31' },
    { type: 'E32', nombre: 'Factura de Consumo', secuencia_actual: 45, total_emitidos: 1, restantes: 955, vencimiento: '2027-12-31' },
    { type: 'E34', nombre: 'Nota de Crédito', secuencia_actual: 9, total_emitidos: 1, restantes: 991, vencimiento: '2027-12-31' },
  ],
}

// GET /api/facturas/{id}/estado con la forma de la spec 7.3 (Release 1, sin puede_reenviar).
const estadoDe = (f) => {
  if (EN_VUELO.includes(f.estado_dgii)) {
    return {
      factura_id: f.id, e_ncf: f.e_ncf, tipo_ecf: f.tipo_ecf, track_id: null, estado_dgii: f.estado_dgii,
      secuencia_utilizada: null, en_vuelo: true, nota: conNcf(NOTA_EN_VUELO, f.e_ncf),
    }
  }
  if (f.estado_dgii === 'ENVIADO' && !f.track_id) {
    return {
      factura_id: f.id, e_ncf: f.e_ncf, tipo_ecf: f.tipo_ecf, track_id: null, estado_dgii: f.estado_dgii,
      secuencia_utilizada: null, en_vuelo: false, nota: conNcf(NOTA_ENVIADO_SIN_TRACK, f.e_ncf),
    }
  }
  return {
    factura_id: f.id, e_ncf: f.e_ncf, track_id: f.track_id, estado_dgii: f.estado_dgii,
    secuencia_utilizada: true, consulta: { estado: f.estado_dgii, mensajes: [] },
  }
}

const log = []
const responder = (res, http, cuerpo) => {
  res.writeHead(http, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(cuerpo))
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PUERTO_MOCK}`)
  const ruta = url.pathname
  if (ruta === '/__mock/log') {
    if (url.searchParams.get('limpiar') === '1') log.length = 0
    return responder(res, 200, log)
  }
  let cuerpo = ''
  req.on('data', (d) => { cuerpo += d })
  req.on('end', () => {
    log.push({ hora: new Date().toISOString(), metodo: req.method, ruta, query: url.search, cuerpo: cuerpo.slice(0, 200) })
    console.log(`${req.method} ${ruta}${url.search}`)
    const get = req.method === 'GET'
    const m = /^\/api\/facturas\/(\d+)\/estado$/.exec(ruta)
    if (get && m) {
      const f = FILAS.find((x) => x.id === Number(m[1]))
      if (!f) return responder(res, 404, { status: false, error: 'No encontramos esta factura. Puede que ya no exista.' })
      if (f.id === ID_ESTADO_FALLA) return responder(res, 502, { status: false, error: ESTADO_NO_DISPONIBLE })
      return responder(res, 200, { status: true, data: estadoDe(f) })
    }
    if (get && ruta === '/api/facturas/stats') return responder(res, 200, { status: true, data: STATS })
    if (get && ruta === '/api/facturas' && url.searchParams.has('id')) {
      const f = FILAS.find((x) => x.id === Number(url.searchParams.get('id')))
      return f
        ? responder(res, 200, { status: true, data: [detalle(f)] })
        : responder(res, 404, { status: false, error: 'No encontramos esta factura. Puede que ya no exista.' })
    }
    if (get && ruta === '/api/facturas') {
      const filas = filtrar(url.searchParams.get('estado') ?? '')
      return responder(res, 200, {
        status: true, data: filas, pagination: { total: filas.length, page: 1, pageSize: 10, totalPages: 1 },
      })
    }
    if (req.method === 'POST' && ruta === '/api/facturas') {
      // El 502 "incierto" (spec 7.1): la fila quedó guardada, la DGII no respondió.
      return responder(res, 502, {
        status: false, error: conNcf(FACTURA_EMISION_INCIERTA, ENCF_INCIERTO),
        data: { factura_id: 41, e_ncf: ENCF_INCIERTO, tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' },
      })
    }
    if (get && ruta === '/api/auth/me') {
      return responder(res, 200, {
        success: true,
        data: { user: { id: 1, email: 'mock@local', username: 'mock', name: 'Mock', role: 'admin', permissions: ['*'] } },
      })
    }
    if (get && (ruta === '/api/branding' || ruta === '/api/emisor')) return responder(res, 200, { status: true, data: {} })
    // Otros /stats (gastos, facturas simples): la forma vacía que el dashboard lee.
    if (get && ruta.endsWith('/stats')) {
      return responder(res, 200, { status: true, data: { resumen: {}, por_mes: [], por_dia: [], por_estado: [], por_tipo: [], por_categoria: [] } })
    }
    if (get) return responder(res, 200, { status: true, data: [] })
    return responder(res, 405, { status: false, error: 'El mock no atiende esta escritura.' })
  })
})

servidor.listen(PUERTO_MOCK, '127.0.0.1', () => {
  console.log(`mock API en http://127.0.0.1:${PUERTO_MOCK}`)
  const vite = spawn(process.execPath, [
    path.join(FE_DIR, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PUERTO_VITE), '--strictPort', '--no-open',
  ], {
    cwd: FE_DIR,
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${PUERTO_MOCK}`, API_KEY: '' },
    stdio: 'inherit',
  })
  const cerrar = () => { vite.kill(); servidor.close(); process.exit(0) }
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)
  vite.on('exit', (c) => { console.log(`vite salió (${c})`); servidor.close(); process.exit(c ?? 0) })
})
```

Notes on the mock:
- It runs vite through `node <FE>/node_modules/vite/bin/vite.js`, the same binary `npx vite` runs, so no shell is needed on Windows.
- The other `/stats` route matters. Without it, `DashboardView`, the app's first screen, crashes on `gastoStats.data?.por_mes.find`.
- `GET /estado` never carries `puede_reenviar` (decision 7).

```bash
node --check "$S/dev-mock-write-ahead.mjs" && echo "sintaxis ok"
```

Expected: `sintaxis ok`.

- [ ] **Step 9: Pick free ports and add the temporary launch entry**

```bash
netstat -ano | grep -E ':(8787|5175) .*LISTENING'
```

- **Nothing printed:** use 8787 for the mock and 5175 for vite.
- **A line printed:** another session holds that port. Do not stop that process.
  - Use `--mock-port=8797 --vite-port=5185` instead, and use 5185 wherever 5175 appears below.
  - While this plan was written, 8787 was held by a mock left over from an earlier run.

Re-read `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead/.claude/launch.json`, then replace:

```json
      "port": 5174
    }
  ]
}
```

with:

```json
      "port": 5174
    },
    {
      "name": "fiscalo-mock-write-ahead",
      "runtimeExecutable": "node",
      "runtimeArgs": ["C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad/dev-mock-write-ahead.mjs", "--mock-port=8787", "--vite-port=5175"],
      "port": 5175
    }
  ]
}
```

The path is the planning session's scratchpad. If your session's scratchpad differs, write that path instead, with forward slashes: it must point to the file created in Step 8. Use the ports chosen above.

- [ ] **Step 10: Start the preview, seed a fake session, set the viewport**

1. Call `preview_start` with `name: "fiscalo-mock-write-ahead"`. If it cannot start by name, use this fallback:
   1. Run `node "$S/dev-mock-write-ahead.mjs" --mock-port=8787 --vite-port=5175` with `run_in_background`.
   2. Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:5175/` prints `200`. Vite listens on `localhost` (IPv6), so `127.0.0.1:5175` does not answer.
   3. Call `preview_start` with `url: "http://localhost:5175"`.
2. Check that the proxy reaches the mock, not production:

   ```bash
   curl -s "http://localhost:5175/api/facturas/41/estado"
   curl -s "http://127.0.0.1:8787/__mock/log?limpiar=1"
   ```

   Expected:
   - the first prints `{"status":true,"data":{"factura_id":41,"e_ncf":"E310000000123",…,"en_vuelo":true,"nota":"La DGII todavía no ha confirmado este comprobante. …E310000000123."}}`;
   - the second prints `[]`.
3. Call `resize_window` with `width: 1280, height: 900`. Below about 1000 px the app switches to its mobile layout.
4. Run with `javascript_tool`:

   ```js
   localStorage.setItem('fiscalo.auth', JSON.stringify({ state: { token: 'mock', user: { id: 1, email: 'mock@local', username: 'mock', name: 'Mock', role: 'admin', permissions: ['*'] } }, version: 0 })); location.reload(); 'ok'
   ```

5. Wait 3 s and take a screenshot. Expected: the Dashboard with the sidebar, not the login and not "La pantalla no se pudo mostrar".

- [ ] **Step 11: Check 1 (list) and check 7 (linked note)**

1. `find` "Facturación" and click the sidebar item. The default filter is Aprobados.
2. Run with `javascript_tool`:

   ```js
   ({
     kpis: Object.fromEntries([...document.querySelectorAll('.kpi-grid .kpi')].map((k) => [k.querySelector('.kpi-label')?.textContent, k.querySelector('.kpi-value')?.textContent])),
     chip: [...document.querySelectorAll('button.filter-chip')].map((b) => b.textContent.trim()),
     opciones: [...document.querySelector('select[aria-label="Filtrar por estado DGII"]').options].map((o) => `${o.value}:${o.text}`),
     filaNota: [...document.querySelectorAll('tbody tr')].map((tr) => tr.innerText).find((t) => t.includes('E310000000120')),
     anulada: document.body.innerText.includes('Anulada por'),
   })
   ```

   Expected:
   - `kpis['Sin confirmar'] === '3'`, and `kpis['Monto total']` contains `7,140.00` (`monto_neto`).
   - `chip` contains `'3 comprobantes sin confirmar · Ver'`.
   - `opciones` is `['aprobado:Aprobados', 'rechazado:Rechazados', 'pendiente:Pendientes', 'todos:Todos']`.
   - **Check 7:** `filaNota` contains `Nota de crédito E340000000009 (sin confirmar)`, and `anulada` is `false`.

   Take a screenshot.
3. `find` "comprobantes sin confirmar" and click the chip. Then run:

   ```js
   ({
     filtro: document.querySelector('select[aria-label="Filtrar por estado DGII"]').value,
     filas: [...document.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.innerText.split('\n')[0]).filter(Boolean),
     badges: [...document.querySelectorAll('tbody .badge')].map((b) => b.textContent.trim()),
   })
   ```

   Expected:
   - `filtro === 'pendiente'`;
   - `filas` holds `E310000000123`, `E320000000045`, `E310000000122` and `E340000000009`;
   - `badges` includes `'Sin confirmar'`, `'Por enviar'` and `'En proceso'`.

   Take a screenshot.
4. In the shell:

   ```bash
   curl -s http://127.0.0.1:8787/__mock/log | grep -o '"query":"?page=1&pageSize=10&estado=pendiente"' | head -1
   ```

   Expected: `"query":"?page=1&pageSize=10&estado=pendiente"`.

- [ ] **Step 12: Check 2 (e-CF dashboard)**

`find` "Comprobantes e-CF" and click it. Then run:

```js
[...document.querySelectorAll('.kpi')].map((k) => [k.querySelector('.kpi-label')?.textContent, k.querySelector('.num')?.textContent, getComputedStyle(k).gridColumnStart + '/' + getComputedStyle(k).gridColumnEnd])
```

Expected:
- the result is `[['Total e-CF','10','1/-1'], ['Aceptados','5','auto/auto'], ['En proceso','1','auto/auto'], ['Rechazados','1','auto/auto'], ['Sin confirmar','3','auto/auto']]`;
- the four buckets sum to the total.

Take a screenshot. It shows Total across the first row, with a 2x2 grid below it.

- [ ] **Step 13: Check 3 (form, 502 incierto)**

1. Click the page's "Emitir e-CF" button (or "Nueva factura" on the list). The form opens with E32 Consumo, so no client is needed.
2. `find` "Descripción" and click the "Descripción" button, which adds a free line. Take a screenshot.
3. Fill the line:
   - click the line's name field (placeholder `Nombre del ítem (ej. Sticker Vinyl 2x2)`) and type `Servicio de prueba`;
   - triple-click the line's PRECIO cell and type `1000`.

   Expected: TOTAL reads `1,180.00`.
4. `find` "Emitir e-CF" and click it; it posts to the mock only. Wait 2 s, then run:

   ```js
   ({
     toast: document.querySelector('[data-sonner-toast]')?.innerText,
     accion: [...document.querySelectorAll('[data-sonner-toast] button')].map((b) => b.textContent.trim()).filter(Boolean),
     barra: [...document.querySelectorAll('.fx-bar button')].map((b) => [b.textContent.trim(), b.disabled]),
   })
   ```

   Expected:
   - `toast` contains `No se pudo confirmar si la DGII recibió la factura E310000000123. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.`;
   - `accion` is `['Ver factura']`;
   - `barra` is `[['Cancelar',false], ['Vista previa',false], ['Ver factura',false], ['Emisión sin confirmar',true]]`.

   Take a screenshot.
5. Wait 8 s, twice sonner's 4 s default, and run `document.querySelectorAll('[data-sonner-toast]').length`. Expected: `1`, because the toast stays up.
6. Click "Emisión sin confirmar" once. Expected: nothing happens, and the mock log still has one POST:

   ```bash
   curl -s http://127.0.0.1:8787/__mock/log | grep -o '"metodo":"POST","ruta":"/api/facturas"' | wc -l
   ```

   Expected: `1`.
7. Click "Ver factura" in the bar. The detail of factura 41 opens (check 4).

- [ ] **Step 14: Check 4 (detail of the in-flight row)**

Wait 2 s, then run:

```js
({
  tarjeta: document.body.innerText.includes('Este comprobante quedó reservado con el e-NCF E310000000123, pero la DGII no ha confirmado su recepción.'),
  nota: document.body.innerText.includes('La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número E310000000123.'),
  badge: document.querySelector('.fx-estado-band .badge')?.textContent.trim(),
  pie: document.querySelector('footer.fx-nota')?.textContent.trim(),
  botones: [...document.querySelectorAll('.fx-bar button')].map((b) => b.textContent.trim()),
  reenviar: /reenviar/i.test(document.body.innerText),
  toasts: document.querySelectorAll('[data-sonner-toast]').length,
})
```

Expected:
- `tarjeta: true`, `nota: true` and `badge: 'Sin confirmar'`.
- `pie: 'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF'`.
- `botones` is `['Ver PDF', 'Imprimir recibo 80 mm', 'XML firmado']`. These are unchanged (decision 4). The receipt width comes from the local printer setting, 80 by default.
- `reenviar: false` (decision 7).
- `toasts: 0`, because the bar button dismissed the toast.

Take a screenshot.

- [ ] **Step 15: Check 5 (`ENVIADO` without `track_id`)**

Click the "Facturación" button at the top of the detail; the filter is still Pendientes. `find` "E310000000122" and click it. Wait 2 s, then run:

```js
({
  nota: document.body.innerText.includes('La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número E310000000122.'),
  tarjeta: document.body.innerText.includes('quedó reservado con el e-NCF'),
  pie: document.querySelector('footer.fx-nota')?.textContent.trim(),
  reenviar: /reenviar/i.test(document.body.innerText),
})
```

Expected:
- `nota: true` and `tarjeta: false`.
- `pie: 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF'`.
- `reenviar: false`.

Take a screenshot.

- [ ] **Step 16: Check 6 (a failing consult)**

1. Go back to the list.
2. `find` the estado combobox (label "Pendientes") and set it to `aprobado` with `form_input`.
3. `find` "E310000000119" and click it.
4. Wait 3 s, which covers the one retry (`main.tsx:34`). Then run:

```js
({
  error: [...document.querySelectorAll('.fx-estado-dato.muted')].map((e) => e.textContent.trim()),
  badge: document.querySelector('.fx-estado-band .badge')?.textContent.trim(),
})
```

Expected:
- `error` is `['No se pudo consultar el estado en la DGII en este momento. Inténtalo de nuevo en unos minutos.']`;
- `badge: 'Aceptado'`: the stored state stays visible.

Take a screenshot.

- [ ] **Step 17: Check 7 in the detail (the related-documents card)**

Go back to the list (Aprobados). `find` "E310000000120" and click it. Wait 2 s, then run:

```js
({
  anulada: document.body.innerText.includes('Anulada por'),
  nota: [...document.querySelectorAll('tbody tr')].map((tr) => tr.innerText).find((t) => t.includes('E340000000009')),
})
```

Expected:
- `anulada: false`: there is no "Anulada por la nota de crédito …" subtitle;
- `nota` contains `E340000000009`, `Anula` and `Sin confirmar`.

Take a screenshot.

- [ ] **Step 18: No API request left the machine**

```js
({
  apiFuera: performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname.startsWith('/api/') && new URL(e.name).host !== location.host).map((e) => e.name),
  hosts: [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name).host))],
})
```

Expected:
- `apiFuera: []`.
- `hosts` is `localhost:5175`, plus `fonts.googleapis.com` and `fonts.gstatic.com`. Those two serve the app's web fonts; they are not API traffic.

```bash
curl -s http://127.0.0.1:8787/__mock/log | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log('peticiones', l.length, 'POST', l.filter(e=>e.metodo==='POST').length, 'rutas', [...new Set(l.map(e=>e.ruta))].length)})"
```

Expected: `peticiones N POST 1 rutas M`, with N > 0. The proxy has no other target, so every API call the app made reached the mock on `127.0.0.1`.

- [ ] **Step 19: Clean up**

1. Call `preview_list`, then `preview_stop` with the listed server id. If the script was started in the background instead, stop that task.
2. Stop a leftover vite from this run only, found by its command line:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*vite.js*--port 5175*' -or $_.CommandLine -like '*dev-mock-write-ahead.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
   ```

   Then run `netstat -ano | grep -E ':(8787|5175) .*LISTENING'`. It must print nothing for the ports this run used. Leave alone any process that was already there before Step 9.
3. Call `resize_window` with `preset: "desktop"`, then close the tab with `tabs_close`.
4. Revert the launch entry and confirm both trees:

   ```bash
   git -C C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead checkout -- .claude/launch.json
   git -C C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead status --short
   git -C C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead status --short
   ```

   Expected: the FE status prints nothing, and the API status shows only `?? tools/reconstruir_e340000000001.sql`.

- [ ] **Step 20: Report**

Give one line per check:
- **API, Steps 2-6:** each command with its exit code and last line (`N de M pruebas OK`, `32/32 OK`, `73/73 OK`, `62 de 62 pruebas OK`), and the greps that printed nothing.
- **FE, Step 7:** `tsc=0`, `eslint=0`, `build=0`, and the result line of every `scripts/*.ts`.
- **Browser checks 1-7 (Steps 11-17):** pass or fail, each with its screenshot.
- **Step 18:** the `apiFuera: []` result and the mock-log counts.
- **Ports:** the ports used, and whether a foreign process held 8787 or 5175.

This task commits nothing unless a check failed. A fix goes into the task that owns the code, as its own `fix(...)` commit in the repo it touches, and then the failing step runs again.

---

### Task 29: Staging (certecf, DGII real)

Spec: 12.0 step 1 on the staging tenant, the first two bullets of 12.3.8 (emission and forced failure), and 13.1 step 3. The Release 2 bullets of 12.3.8 (recovery through `GET /estado`, the CLI) do not apply: the forced-failure row is resolved with 10.2.

Ground rules for this task:
- **Staging only.** The tenant must be in `certecf`, where the real DGII answers without fiscal effect. Never production (decision 6).
- **Stop and ask** at every step marked so, and wait for a clear yes in chat. That covers the deploys, every change to the staging `.env`, every emission (each one is a real send to the DGII), and every write to the staging DB.
- **No credentials from the agent.** The user logs in to the staging app and runs the SQL in phpMyAdmin, unless they hand the agent a connection that is already set up. The agent never types, asks for or prints a password, token or key.

**Files:**
- No repo change, and nothing is committed.
- Reads:
  - `tools/verificar_migraciones_tenant.sql` (read-only; the `base` check is at `:21-24`);
  - the 10.2 procedure that Task 19 Step 4 added to `docs/integrations/dgii-ecf.md` ("Resolver una factura sin confirmar (write-ahead)").
- Test: the SQL and app checks below, on the staging tenant.

**Interfaces:**
- Consumes:
  - the API and FE branches `feat/ecf-write-ahead` after Task 28 passed;
  - Task 17: the 502 incierto `{status:false, error:sprintf(FACTURA_EMISION_INCIERTA, e_ncf), data:{factura_id, e_ncf, tipo_ecf, estado_dgii}}`;
  - Tasks 8-13: `respuesta_dgii` of an in-flight row, a JSON object with `flujo`, `dispensado`, `rango_id`, `secuencia_valor`, `fase_fallida`, `error` and `resultado_parcial` (spec 6.3);
  - Tasks 25-27: the "Pendientes" filter, the "Sin confirmar" KPI and chip, the locked form with "Ver factura", and the detail card;
  - `DGII_FC_BASE_URL`, read with `getenv` at `DgiiReceptionService.php:74` (RecepcionFC only); `DGII_ECF_BASE_URL` at `DgiiAuthService.php:164` (authentication) stays untouched. The API's `.env` reaches `getenv` through `Database::loadEnv()` (`Database.php:8-26`, `putenv` at `:23`).
- Produces a staging report:
  - the verifier rows;
  - the SELECT before and after the emissions;
  - the four emissions, each with its e-NCF, HTTP status and `estado_dgii`;
  - the forced failure: the 502 body, the row, and `respuesta_dgii.fase_fallida`;
  - the 10.2 resolution and the E32 counter before and after.

- [ ] **Step 1: Ask for the staging target (stop and ask)**

Ask in chat, then wait:

> Task 29 runs the staging part of Release 1: the migration gate on the staging tenant, four emissions against the real DGII in `certecf`, and one forced RFCE failure. Before I do anything, I need:
> - the staging API URL and the staging app URL;
> - the staging tenant's `db_name`, and confirmation that its ambiente is `certecf`;
> - who runs the SQL: you in phpMyAdmin, or me through a connection you already set up (I never type a password).
>
> I will not deploy, change the staging `.env`, emit, or write to the DB without your yes for that step.

Expected: the answers. If the tenant is not in `certecf`, stop: 12.3.8 is defined on `certecf`.

- [ ] **Step 2: Release gate on the staging tenant (12.0 step 1)**

In phpMyAdmin, select the staging tenant's DB and run the whole of `tools/verificar_migraciones_tenant.sql`. It is read-only.

Expected:
- every row's `base` column shows the staging `db_name`. If it shows `information_schema` or another DB, the rows are not valid: select the tenant DB and run it again (`verificar_migraciones_tenant.sql:21-24`);
- rows `027` and `028` say `APLICADA`.

If 027 or 028 says `FALTA`, **stop and ask** before applying `db/migrations/027_e_ncf_unico_por_ambiente.sql` or the phpMyAdmin-safe `db/migrations/028_estado_dgii_ancho.sql` (`6609d91`; its first statement is `SET @db := DATABASE();` at `:68`). Both can be re-run. Then run the verifier again. Report any other `FALTA` to the user; it does not block this task.

- [ ] **Step 3: Deploy to staging, API first, then the frontend (stop and ask)**

Record both heads:

```bash
git -C C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead log --oneline -1
git -C C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead log --oneline -1
```

Then ask:

> The gate says `APLICADA` on 027 and 028 in `<db_name>`. May I deploy to staging, in this order? Spec 13.3 requires the API first: the new frontend against the old API gets a 422 on `?estado=pendiente`.
> 1. the API, `feat/ecf-write-ahead` at `<API sha>`;
> 2. the frontend, `feat/ecf-write-ahead` at `<FE sha>`.

Neither repo documents a deploy procedure, so the user deploys with their usual one, or names the exact commands for the agent to run. Wait for both deploys to be confirmed.

Expected: the staging app loads, and Facturación shows the "Pendientes" option in its estado filter.

- [ ] **Step 4: Baseline SELECT, then four emissions against the real DGII (stop and ask before each emission)**

Run on the staging tenant DB:

```sql
SELECT id, e_ncf, estado_dgii, track_id, secuencia_utilizada, ambiente_dgii, LENGTH(xml_firmado), LENGTH(respuesta_dgii) FROM facturas ORDER BY id DESC LIMIT 5;
SELECT type, current_value FROM ncf_sequences WHERE ambiente = 'certecf' AND type IN ('E31','E32','E34') ORDER BY type, numero_desde;
```

Save both results in the report as "antes".

Then the user emits these in the staging app, one at a time, after a yes for each. Use a client with an RNC.

| # | Document | Lines | Flow | Expected |
|---|---|---|---|---|
| a | E31 | one line, price 1000 (total 1,180.00) | e-CF, `Recepcion` | 200; `estado_dgii` `ACEPTADO`, `ACEPTADO_CONDICIONAL` or `EN_PROCESO`; `track_id` set |
| b | E32 ≥ 250k | one line, price 300000 (total 354,000.00) | e-CF, `Recepcion` | 200; the same states; `track_id` set |
| c | E32 < 250k | one line, price 1000 (total 1,180.00) | RFCE, `RecepcionFC` | 200; `RFCE_ACEPTADO`, `RFCE_ACEPTADO_CONDICIONAL` or `RFCE_EN_PROCESO` |
| d | E34 for (a) | código de modificación 3, one line, price 100 | e-CF, `Recepcion` | 200; the states of (a) |

Before (d), open (a) in the app until its state is `ACEPTADO` or `ACEPTADO_CONDICIONAL`: the note needs an accepted E31. If (a) is still `EN_PROCESO`, opening the detail runs `GET /estado`.

A 422 means the DGII rejected the document. Record its reason and stop: a rejection here is a data or certificate problem, not the write-ahead.

Then run the first SELECT again and save it as "después".

Expected in "después":
- the four new rows are on top, with `ambiente_dgii = 'certecf'` and `LENGTH(xml_firmado) > 0`;
- none is in `PENDIENTE_ENVIO` or `ENVIO_INCIERTO`;
- `LENGTH(respuesta_dgii)` is NULL (RFCE) or below 65535 (D15);
- the "Pendientes" filter lists none of them, except while one is still `EN_PROCESO`/`RFCE_EN_PROCESO`. Opening it refreshes the state.

- [ ] **Step 5: Forced failure, E32 < 250k with RecepcionFC unreachable (stop and ask)**

Ask:

> May I add `DGII_FC_BASE_URL=https://127.0.0.1:9` to the staging API's `.env`, and then have you emit one E32 below 250k? Only RecepcionFC uses that base (`DgiiReceptionService.php:74`), while authentication still reaches the real DGII through `DGII_ECF_BASE_URL` (`DgiiAuthService.php:164`). The RFCE is signed, its row is saved, and the send fails. While the line is there, every RFCE on this staging API fails, so no one else should emit on it in the meantime. Changing `DGII_ECF_BASE_URL` instead would break the seed requests inside the rollback-protected try (spec 12.3.8): no row, and a generic 502.

After the yes:
1. Add the line. `Database::loadEnv()` reads `.env` on every request, so no restart is needed. If the server sets env vars elsewhere, for example with Apache `SetEnv`, restart it the way the user says.
2. The user emits an E32 with one line, price 1000.
3. In the browser's network tab, or from the toast, record the response.

Expected:
- **HTTP:** 502 with `error` = `No se pudo confirmar si la DGII recibió la factura E32…. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.`, and `data` = `{factura_id, e_ncf: "E32…", tipo_ecf: "32", estado_dgii: "ENVIO_INCIERTO"}`.
- **App:** the toast stays up with "Ver factura"; the form stays locked with "Emisión sin confirmar"; the "Sin confirmar" KPI and chip count the row; the detail card says "Este comprobante quedó reservado con el e-NCF E32…".
- **DB**, with that `factura_id`:

  ```sql
  SELECT id, e_ncf, estado_dgii, track_id, LENGTH(xml_firmado),
         JSON_UNQUOTE(JSON_EXTRACT(respuesta_dgii, '$.flujo')) AS flujo,
         JSON_UNQUOTE(JSON_EXTRACT(respuesta_dgii, '$.fase_fallida')) AS fase_fallida
  FROM facturas WHERE id = <factura_id>;
  ```

  Expected: `estado_dgii = 'ENVIO_INCIERTO'`, `flujo = 'RFCE'`, `fase_fallida = 'envio'`, `LENGTH(xml_firmado) > 0`.
- **Log:** the API `error_log` has an `ENVIO_INCIERTO` line with that e-NCF.

- [ ] **Step 6: Restore the URL (stop and ask)**

After a yes, remove the `DGII_FC_BASE_URL=https://127.0.0.1:9` line from the staging API's `.env`, and undo any restart setting from Step 5. The user confirms the file is back as before.

Expected: the `.env` no longer contains `127.0.0.1:9`. The user can check this without printing the other values, for example with `grep -c "127.0.0.1:9" .env`, which prints `0`.

- [ ] **Step 7: Resolve the forced-failure row with 10.2, RFCE case (stop and ask before the UPDATE)**

Follow `docs/integrations/dgii-ecf.md`, "Resolver una factura sin confirmar (write-ahead)":
1. Step 1 of the procedure: list the row and read its meta. Save `rango_id` and `secuencia_valor` from `respuesta_dgii`.
2. Record the counter: `SELECT id, current_value FROM ncf_sequences WHERE type = 'E32' AND ambiente = 'certecf' ORDER BY numero_desde;`.
3. After a yes, apply the RFCE case:

   ```sql
   UPDATE facturas SET estado_dgii = 'RFCE_ENVIADO' WHERE id = <factura_id> AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');
   ```

   Expected: 1 row affected.
4. Open the factura in the staging app. Its `GET /estado` runs the existing RFCE consult with the stored `codigo_seguridad`.
5. Run the SELECT of Step 5 and the counter query again.

Expected:
- the row leaves `RFCE_ENVIADO` with the DGII's answer. The RFCE never arrived, because the connection to `127.0.0.1:9` failed, so the expected answer is `RFCE_NO_ENCONTRADO`;
- the existing RFCE rollback (`facturaController.php:758-773` at `9f669ad`) returns the number when the DGII says it was not used and nothing was dispensed after it. Its `error_log` line says `revertido` or `rollback_sin_coincidencia`;
- the "Pendientes" filter no longer lists the row.

If the consult cannot decide (a 502 "No se pudo consultar el estado…"), leave the row in `RFCE_ENVIADO` and report it. The user then picks the 10.2 case "RFCE y soporte ya sabe que la DGII no tiene el RFCE".

- [ ] **Step 8: Report**

One line each:
- **Gate:** `base` = staging `db_name`; 027 and 028 `APLICADA`.
- **Deploys:** the API and FE shas, in that order.
- **SELECT antes/después and counters:** both result sets.
- **Emissions a-d:** e-NCF, HTTP status and `estado_dgii`.
- **Forced failure:** the 502 `data`, the row (`ENVIO_INCIERTO`, `flujo`, `fase_fallida = envio`), and the `.env` restored.
- **10.2:** the final state and the counter before and after.
- **12.3.5:** it ran locally in Tasks 17-20 (`tools/test_write_ahead_api.php`, `91 de 91 pruebas OK`). Repeating it on staging needs the staging API pointed at a `tools/mock_dgii.php` the server can reach, plus SQL writes on the staging DB. Do it only if the user asks for it.

---

### Task 30: Rollout Release 1 (13.1)

Spec 13.1, and 13.3 for the order. This task is a **handoff**: the user runs every step on the tenant DBs and in production.
- The agent prepares the queries, reads the results the user pastes, and keeps the checklist.
- The agent runs nothing against a production DB or server, even with a yes. A "yes" here means the user does that step.
- Decision 6: no synthetic emission in production.

**Files:**
- No repo change, and nothing is committed.
- Read by the user:
  - `tools/verificar_migraciones_master.sql`, whose last query (`:104`) lists the tenants;
  - `tools/verificar_migraciones_tenant.sql`;
  - `db/migrations/027_e_ncf_unico_por_ambiente.sql`;
  - `db/migrations/028_estado_dgii_ancho.sql`, the phpMyAdmin-safe version of `6609d91` (`SET @db := DATABASE();` at `:68`; `filas_truncadas_antes` at `:159`);
  - the 10.2 procedure in `docs/integrations/dgii-ecf.md`.
- Test: the checklist below, filled in by the user.

**Interfaces:**
- Consumes:
  - the Task 29 report, which must show the staging gate, the emissions and the resolved forced failure;
  - the API and FE heads recorded in Task 29 Step 3;
  - the deploy-order rule Task 19 wrote into `CLAUDE.md` and `docs/integrations/alta-tenant-runbook.md`.
- Produces the filled rollout checklist:
  - the gate result of every tenant;
  - the baseline counts;
  - the deploy times, API then FE;
  - the smoke result per tenant;
  - the log-watch findings and how each in-flight row was resolved.

- [ ] **Step 1: Hand over the checklist (stop and ask)**

Send the user Steps 2-8 of this task as their checklist, and say:

> Release 1 goes to production only through you. I prepared the queries and the order (spec 13.1). I will not run anything against production; paste me each result and I will check it against the expected values. Do not deploy until every tenant shows `APLICADA` on 027 and 028.

Expected: the user confirms who runs each step. If Task 29 is not complete, stop: staging comes first (13.1 step 3).

- [ ] **Step 2: Release gate on every tenant (13.1 step 1)**

1. In the master DB, run `tools/verificar_migraciones_master.sql`. Its last query (`:104`) is:

   ```sql
   SELECT id, nombre, rnc, tipo, db_name FROM tenants ORDER BY id;
   ```

   The `tipo = 'app'` rows are the tenant DBs to check; `integracion` tenants have no DB.
2. In **each** tenant DB, select it in phpMyAdmin and run the whole of `tools/verificar_migraciones_tenant.sql`.
   - Check the `base` column first: it must show that tenant's `db_name`.
   - If it shows `information_schema`, the rows are not valid: select the tenant DB and run it again (`verificar_migraciones_tenant.sql:21-24`).
3. Where 027 or 028 says `FALTA`:
   - apply `db/migrations/027_e_ncf_unico_por_ambiente.sql` and/or the phpMyAdmin-safe `db/migrations/028_estado_dgii_ancho.sql`. Both can be re-run (`verificar_migraciones_tenant.sql:13-15`);
   - run the verifier again.
4. For any tenant whose 028 result shows `filas_truncadas_antes` ≠ 0 (`028_estado_dgii_ancho.sql:159`), run:

   ```sql
   SELECT id, e_ncf, estado_dgii FROM facturas WHERE estado_dgii IN ('RFCE_ACEPTADO_CONDIC','RFCE_RECHAZADO_ARCHI','NO_ENCONTRADO_ARCHIV');
   ```

   Report those rows to the user.
5. Any other `FALTA` is reported to the user and fixed separately; it does not block this deploy.

Expected: a table of `db_name` → 027 `APLICADA`, 028 `APLICADA`. **Do not deploy until every tenant shows `APLICADA` on 027 and 028.**

- [ ] **Step 3: Baseline per tenant (13.1 step 2)**

In each tenant DB, for later comparison:

```sql
SELECT estado_dgii, COUNT(*) FROM facturas WHERE tipo_ecf IS NOT NULL GROUP BY 1;
SELECT COUNT(*) FROM facturas WHERE estado_dgii = 'ENVIADO' AND track_id IS NULL;
```

Expected: the user saves both results per tenant. The `ENVIADO` + NULL rows are legacy rows: after the deploy, `GET /estado` answers them with the 7.3 note instead of the old 422, and the "Pendientes" filter lists them. They are resolved with 10.2, first case.

- [ ] **Step 4: Staging passed (13.1 step 3)**

Check the Task 29 report:
- gate `APLICADA`;
- emissions a-d answered;
- the forced failure gave `ENVIO_INCIERTO` with `fase_fallida = envio` and was resolved with 10.2.

Expected: all three hold. Otherwise stop.

- [ ] **Step 5: Production deploy, API first, then the frontend (13.1 step 4, 13.3)**

The user deploys:
1. the API, at the head recorded in Task 29 Step 3;
2. after the API answers, the frontend.

This order is safe in between: the old frontend against the new API shows the 502 incierto text as a toast. The reverse would give the new frontend a 422 on `?estado=pendiente`.

Expected: the user reports both deploy times.

- [ ] **Step 6: Read-only smoke check per tenant (13.1 step 4)**

After each tenant's first real emission, which the cashier makes as part of normal work, never a synthetic one (decision 6):

```sql
SELECT id, e_ncf, estado_dgii, track_id, xml_firmado IS NOT NULL FROM facturas ORDER BY id DESC LIMIT 1;
```

Then open that factura in the app, so that `GET /estado` answers, and open Facturación with the "Pendientes" filter.

Expected:
- the row has a DGII state, not `PENDIENTE_ENVIO`/`ENVIO_INCIERTO`, and `xml_firmado IS NOT NULL` = 1;
- the detail opens;
- "Pendientes" is empty, apart from the legacy `ENVIADO` + NULL rows counted in Step 3.

- [ ] **Step 7: Watch the API `error_log` (13.1 step 5)**

The user watches the API's PHP `error_log` for these patterns, on the API server:

```bash
LOG="$(php -r 'echo ini_get("error_log");')"   # if the web server uses another php.ini, set LOG to the error_log that its phpinfo() shows
echo "LOG=$LOG"
grep -nE "ENVIO_INCIERTO|CONFIRM_RACE|fila reservada sin enviar|ocupado al reservar|rollback sin coincidencia" "$LOG"
```

Expected: no match, or each match is traced to its e-NCF. Every row in flight (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, or `ENVIADO` with a NULL `track_id`) is resolved with the 10.2 procedure in `docs/integrations/dgii-ecf.md`. `rollback sin coincidencia` also appears as an `NCF_SEQUENCE_UPDATE` audit row with `success = 0`: a number burned without a row.

- [ ] **Step 8: Rollback, only if needed (13.1, "Rollback of Release 1")**

The API can go back to the commit before Release 1: `9f669ad`, the base of `feat/ecf-write-ahead`. The spec names `db91ecf`, which was the head when the spec was written.
- The old `eNcfYaUsado` treats in-flight rows as occupied, which is correct.
- The old `GET /estado` answers 422 for them, and the old list shows their raw codes.
- Resolve every in-flight row with 10.2 before rolling back or right after.
- Nothing in the data needs undoing.

Expected: the user decides; nothing is reverted by the agent.

- [ ] **Step 9: Report**

The filled checklist:
- the gate table (Step 2) and the truncated rows, if any;
- the baselines (Step 3);
- the deploy times (Step 5);
- the smoke result per tenant (Step 6);
- the log matches and how each was resolved (Step 7).

This task commits nothing.

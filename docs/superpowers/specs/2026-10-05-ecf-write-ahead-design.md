# Write-ahead persistence for e-CF emission (facturas) — design

- **Date:** 2026-10-05
- **Repos:** `api-gratex` (PHP backend) and `fiscalo` (React frontend)
- **Status:**
  - Design rev. 2 approved in chat; an adversarial critique of it was folded in (its N1–N7 and FP items; N8
    belonged to `EsquemaTenant` and FP18 to the cross-ambiente archive, and both were dropped by decision 3).
  - The user then took six binding decisions (section 2). They remove the runtime schema fallback and every
    printing change, and split the work into two releases.
  - **Approved by the user on 2026-10-05**, including the two open proposals: `MSG_TARDO_EMISION` instead of
    rewording `MSG_TARDO_ESCRITURA` (section 2), and the "Pendientes" filter name and meaning (risk 11).
  - **Decision 7, taken by the user on 2026-10-05 after the approval:** "do not give the user the ability to send
    a ecf again if it fails". The app never re-sends an e-CF. Re-sending the stored signed XML exists only in the
    Release 2 support CLI, and unconfirmed invoices are resolved only by support (section 2, row 7). It overrides
    the spec where they conflict, and every section below was updated to match.
  - Location: branch `feat/ecf-write-ahead` of `fiscalo`, rebased on `main` `a9bf56c`. It reaches `main` through the
    branch merge, as `2026-10-01-cotizacion-formatos-design.md` did (merge `1de819b`).
  - Next step: an implementation plan per release, starting with Release 1. Section 2.1 lists what changed in the
    code base after this spec was written.
- **Code base:** every `file:line` below was re-read on `api-gratex` master `db91ecf` (worktree
  `.claude/worktrees/ecf-write-ahead`) and `fiscalo` main `492fc9b` (same worktree name). `API/` and `FE/` are
  those two roots. `API/src/` is identical to `d7f5f34`; `6609d91` reworked 028 and its checkers, and `db91ecf`
  reworked `tools/consultar_ecf_dgii.php` and `docs/integrations/dgii-ecf.md`.

## 1. Goal

On 2026-10-05 a tenant emitted two credit notes:

- **E340000000001**, which the DGII **accepted**;
- **E340000000002**, which the DGII **rejected**.

Neither was saved. `facturaModel::saveFacturaConECF` runs **after** the DGII answer, and its INSERT failed with
`Duplicate entry 'E340000000001' for key facturas.uk_e_ncf`. The tenant DB still had the old global key because
migration 027 had not been applied. Only an audit row survived.

The user's ask: nothing the app emits can be lost again. In their words, "save everything that is made into the app
in db".

Already done, and outside this spec:

- 027 is applied on every tenant DB.
- Commit `d5cc063` added the recovery tool `tools/consultar_ecf_dgii.php` and its web wrapper; `db91ecf` fixed its
  date parsing and its handling of a ConsultaEstado that demands the security code.
- Commit `d7f5f34` added migration 028, which widens `estado_dgii` to `VARCHAR(40)`. That version failed in
  phpMyAdmin (`#1109 Unknown table 'FACTURAS' in information_schema`); `6609d91` makes its first statement
  `SET @db := DATABASE();` (`db/migrations/028_estado_dgii_ancho.sql:46-52`, `:68`). The user applied 028 on every
  tenant on 2026-10-05, in the same phpMyAdmin-safe form (database named explicitly), before `6609d91` was committed.

We want:

1. **Write-ahead.** The `facturas` row is committed **before** the signed e-CF is sent to the DGII, and updated
   with the answer afterwards. The row holds the e-NCF, the signed XML, the `codigo_seguridad` and the items.
2. When the DGII outcome is unknown (transport failure, crash, DB failure after the answer):
   - the row stays in an explicit "in flight" state;
   - the user is told so and taken to that row;
   - the number is never reused while the row is unresolved.
3. Two releases, each deployable on its own:
   - **Release 1** guarantees that nothing is lost;
   - **Release 2** adds recovery: a read-only lookup in the DGII from the app, and a support CLI that alone can
     re-send the stored XML (decision 7).

### Success criteria

- **No send without a committed row.** No call to `recibir()`/`recibirResumen()` happens unless a committed
  `facturas` row owns the e-NCF and holds the signed XML (and the RFCE XML for E32 < 250k), the
  `codigo_seguridad` and the items. No transaction is open during the send.
- **Every outcome after the send has a row.** It is either a DGII state, `ENVIO_INCIERTO`, or (only when the tenant
  DB itself is down) `PENDIENTE_ENVIO`. No code path deletes an e-CF row.
- **The counter is never decremented while a row owns the number and is unresolved.** A revert happens only after
  the row is in a retryable state: the row first, the counter second.
- **Stock moves at most once per factura**, and only for a DGII verdict outside `EstadosEcf::SIN_STOCK` (4.6).
- **In-flight rows are not money.** The row counts (`total_ecf`, `por_tipo.total`, `secuencias.total_emitidos`)
  keep including in-flight rows; the money and sales series (`resumen.monto_total`, `por_tipo.monto_total`,
  `por_mes`, `ventas_por_*`, the ventas report) exclude them (section 8).
- **The user lands on the saved row.** A 502 "incierto" carries `data.factura_id`; the form stays locked and offers
  "Ver factura".
- **Unchanged behavior elsewhere:**
  - integration emission (`integracionEcfController`) sees the same exceptions and texts; gastos do too, except
    a tenant-DB outage at dispense, which now raises `RuntimeException('ncf_sequences inaccesible: …')` and yields
    the generic error instead of the misleading "Se acabaron los números…" text (4.8, risk 10);
  - the PDF and the receipt print exactly as today for every row.
- **Release 1 alone satisfies every criterion above.** Every state it can create has a reader and a documented
  manual resolution (10.2).
- **Release 2** resolves in-flight rows from the app with a read-only lookup (`GET /estado`) and from a support CLI,
  using the same ordering rules. Only the CLI re-sends the stored XML; the app never re-sends an e-CF (decision 7).

## 2. Decisions taken

| # | Topic | Decision |
|---|---|---|
| 1 | Approach | **Write-ahead**: the row is committed before the DGII send and updated after it. We do not add a safety net that only reacts after a failure. |
| 2 | Scope | **Facturas only**: `ECFEmissionService` + `facturaController` + `facturaModel` + frontend. Gastos adopt the same pattern later, in a separate change (forward note in 14). Integration tenants (`integracionEcfController`, no tenant DB) are untouched: the hook is optional and absent there. |
| 3 | Schema | **No runtime schema fallback.** Out are: any schema probe (`EsquemaTenant`), cross-ambiente predicates, clamping of `estado_dgii`, an `esquema` block in `GET /api/facturas/stats` and an admin banner. Migrations **027 and 028 applied on every tenant DB are a release gate**, checked with `tools/verificar_migraciones_tenant.sql` before deploying. `eNcfYaUsado` keeps its per-ambiente predicate, and the reserve uses the same predicate. What happens if someone deploys without them anyway is stated in 6.2. The deploy-order rule goes into `API/CLAUDE.md` and `docs/integrations/alta-tenant-runbook.md` as part of the work. |
| 4 | Printing | **Printing stays exactly as today** ("stay as it is, do not show preview"). An in-flight row prints its PDF and receipt like any other row. There is no PREVIEW watermark, no blanking of `codigo_seguridad`, no hidden "Imprimir recibo" and no relabeled "Ver PDF". The trade-off is accepted (15.1). |
| 5 | Releases | **Two releases, each deployable on its own.** Release 1 is the core that guarantees no loss; Release 2 is recovery. Every component is assigned in section 11. |
| 6 | Testing | Local PHP has no `pdo_mysql`. DB tests run on a local MySQL scratch tenant or a staging tenant, **never production** (the frontend `.env` proxies to production). The DGII is mocked by a local PHP server (12.2). Production runs PHP 8.3. |
| 7 | No resend from the app | **Taken on 2026-10-05, after the approval; it overrides the spec where they conflict.** The user: "do not give the user the ability to send a ecf again if it fails". Resending is removed from the app, and unconfirmed invoices are resolved only by support. There is no "Reenviar a la DGII" button, no frontend `reenviarFactura()`, no `POST /api/facturas/{id}/reenviar` endpoint (the existing route keeps answering 501 as today, `handleReenviar` at `facturaController.php:795-798`; it is not implemented) and no `puede_reenviar` field in any API response (Release 1 or 2). Re-sending the stored signed XML exists **only** in the support CLI `tools/ecf_en_vuelo.php --reenviar` (Release 2), through `EcfReconciliador::reenviar()`, with the same duplicate guard, lock and ordering rules (10.3). The read-only lookup stays in the app: `GET /api/facturas/{id}/estado` (the Release 2 full branch with the DGII lookup) and the "Verificar en la DGII" button. Notes that offered a re-send now send the user to support, for example `'La DGII no tiene registro de este comprobante. Avisa a soporte con el número E310000000123: no lo emitas de nuevo.'`. **Unchanged:** a pre-send failure (nothing reached the DGII, number returned) still lets the cashier retry; a DGII rejection can still be corrected and emitted again; the 502 incierto still keeps the form locked with "Ver factura". |

Decisions taken while writing this spec. All stay within the decisions above except the second, which needs the
user's confirmation:

- The state lists live in one constants-only class, `EstadosEcf` (4.6). The design put them on `facturaModel`.
  The service does not depend on `facturaModel` (tenant models stay lazy for integration tenants,
  `ECFEmissionService.php:49-55`), which is why `ECFEmissionService.php:99` duplicates `facturaModel.php:1009`
  today; a constants-only class removes the copy without adding that dependency, and `ReporteVentasModel` needs the
  lists too.
- **Needs user confirmation.** Decision 5 named `MSG_TARDO_ESCRITURA`. This spec keeps it unchanged, because every
  write uses it (`FE/src/api/errores.ts:303`, `:439`), and adds `MSG_TARDO_EMISION` for `POST /api/facturas` only
  (9.1).
- Release 1 shows the minimal-branch `nota` (7.3) inside the in-flight card. That is the "band showing en-vuelo
  state" of decision 5. The Release 2 "detail card nota" is the reconciler's `nota` (10.3).
- Stats gain no new field. The frontend derives the in-flight count from `por_estado`, which already carries every
  state.
- The stock guard `yaMovioDocumento` is applied by every caller, the emitting request included. Stock moves at most
  once per factura id whoever gets there first.
- The RFCE flow follows the same rules as the e-CF flow: `RFCE_NO_ENCONTRADO` becomes retryable, and the stock gate
  uses `EstadosEcf::SIN_STOCK` instead of the controller's `$rechazado` (4.6, 4.7). The HTTP codes of
  `facturaController.php:472` do not change (section 14).

### 2.1 Changes in the code base after this spec (linked notes, 2026-10-05)

The "notas vinculadas" change shipped after this spec was written: `api-gratex` `9f669ad` and `fiscalo` `a9bf56c`.
It touches files this spec changes, so its line references are stale there. The Release 1 plan re-pins every
`file:line` on those commits. What it added, and how Release 1 must treat it:

- **One list of valid notes.** `facturaModel::TIPOS_NOTA` and `facturaModel::ESTADOS_NOTA_VIGENTE`
  (`'ACEPTADO', 'ACEPTADO_CONDICIONAL', 'EN_PROCESO', 'ENVIADO'`) now drive both `sqlReferencia` (the saldo) and
  the new `notas` / `modifica` fields of the list and the detail (`adjuntarNotasVinculadas`, `vincularNotas`).
  Section 8 adds the in-flight states to the saldo subquery; Release 1 does that by deriving
  `ESTADOS_NOTA_VIGENTE` from `EstadosEcf` (4.6), so the saldo and the links cannot disagree. An in-flight credit
  note therefore shows as linked. The frontend labels must not call an invoice "Anulada por" a note that is still in
  flight: `anuladaPor` (`FE/src/features/invoices/notasVinculadas.ts`) only counts a note whose state is accepted or
  conditionally accepted; an in-flight note shows as "Nota de crédito … (sin confirmar)".
- **`resumen.monto_neto`** (`getECFStats`) is new money. Like `resumen.monto_total`, it excludes in-flight rows
  ("In-flight rows are not money", success criteria).
- **Frontend.** `InvoiceListView.tsx` and `InvoiceDetailView.tsx` already carry the linked-notes line, the signed
  totals and the "Comprobantes relacionados" card. The in-flight band, labels and buttons of 9.1 are added next to
  them; the card's state badge uses the same `dgiiLabel` labels as the rest of 9.1.

## 3. Current state (what the code map found)

- **Emission is send-then-save.**
  - `handleEmisionECF` calls `ECFEmissionService::emitir()` first (`API/src/Controllers/facturaController.php:360-362`).
    Only after the DGII answer does it build `$facturaInput` (`:382-415`) and call `saveFacturaConECF` (`:417`).
  - `saveFacturaConECF` (`API/src/Models/facturaModel.php:966-1125`) opens the only transaction of the emission
    path (`:969`). It archives a prior rejected row (`:1003-1028`), INSERTs the row (`:1030-1070`) and the items
    (`:1073-1101`), and commits (`:1103`).
  - It catches only `PDOException` (`:1112-1124`), returning "se envió a la DGII, pero no se pudo guardar". The
    controller then writes an EMIT audit row and answers 500 **without `data`** (`facturaController.php:418-431`).
  - Any other Throwable goes to `ErrorHandler` (`API/index.php:9-10`, `API/src/ErrorHandler.php:28-29`), which
    answers a JSON 500 with an `error_id` and no e-NCF.
- **What runs before the send.**
  - The rollback-protected `try` (`API/src/Utils/FacturacionElectronica/ECFEmissionService.php:330-358`) resolves
    locations, builds, loads the certificate, signs, extracts `codigo_seguridad` (`:351`) and authenticates
    (`:354-358`). The comment at `:326-329` states that nothing reaches the DGII until `recibir()`.
  - Its `catch` (`:359-370`) returns the dispensed number with `rollbackECFSequence` and rethrows.
  - **Outside** the try:
    - RFCE build and sign (`:410-411`);
    - the RFCE send `recibirResumen` (`:413-415`);
    - the e-CF send `recibir` (`:449-451`);
    - the carriage-return guard inside both sends (`DgiiReceptionService.php:31`, `:72`).

    An RFCE or CR failure therefore leaves the number consumed.
- **The counter.**
  - The dispense loop (`ECFEmissionService.php:214-252`) increments `ncf_sequences.current_value` in autocommit
    (`API/src/Models/ncfModel.php:117-168`).
  - It skips numbers that `eNcfYaUsado` (`ECFEmissionService.php:91-110`) finds occupied in the **same ambiente**.
    The predicate is `ambiente_dgii = :amb OR IS NULL` (`:96`), with the retryable list at `:99`.
  - `dispenseNextECF` turns any `PDOException` into `null` (`ncfModel.php:165-167`). The service then reports
    "Se acabaron o vencieron los números…" (`ECFEmissionService.php:229-231`), even when the DB is down.
  - After the answer, `reclamarSecuenciaSiNoUtilizada` (`:420-425` RFCE, `:456-461` e-CF, body `:491-527`) reverts
    the counter when `secuenciaUtilizada === false` (any state), or when it is absent and the state is
    `RECHAZADO`/`NO_ENCONTRADO` (`:511-512`). This happens **before any row exists**.
  - The RFCE call passes the base state (`$rfceEstado`, `:420-425`), while the row stores `'RFCE_' . $rfceEstado`
    (`:433`). An RFCE `NO_ENCONTRADO` therefore reverts the counter, but `RFCE_NO_ENCONTRADO` is not in the
    retryable list (`:99`): the next dispense lands on the number, finds it occupied and skips it. The same holds
    for `ERROR` with `secuenciaUtilizada === false`.
  - `rollbackECFSequence` is a conditional decrement: by `rango_id` (`ncfModel.php:188-193`) or by the legacy
    type+ambiente filter (`:194-200`). A mismatch is logged (`:218-221`) and returns false.
- **Transport outcomes.**
  - `curl_exec === false` throws `RuntimeException('HTTP request failed: …')`
    (`API/src/Utils/FacturacionElectronica/DgiiAuthService.php:389-393`). The default timeout is 30 s (`:12`,
    `:165`).
  - A 4xx/5xx without a JSON body throws (`:141-144`); the summary is capped at 500 characters (`:538-546`).
  - A 2xx with a non-JSON body returns the raw string as `data` (`:150`). `mapEstado` turns it into `ENVIADO`
    (`ECFEmissionService.php:665-666`) and `extractTrackId` into `null` (`:619-631`).
- **The stored row.**
  - `secuencia_utilizada` is never written at emission: it is not in the INSERT column list
    (`facturaModel.php:1030-1041`). Only `updateECFEstado` (`:1127-1149`) writes it.
  - `ambiente_dgii` is `$tokenInfo['ambiente']` (`facturaModel.php:1059`, `ECFEmissionService.php:372`).
  - The dispenser and `eNcfYaUsado` use `$ambienteEarly` (`:186`).
- **Inventory** moves for every saved row whatever the verdict: `registrarVenta` (`facturaController.php:433-454`)
  runs before `$rechazado` is computed (`:471-472`). That list lacks `RFCE_NO_ENCONTRADO` and `RFCE_ERROR`, which
  the RFCE flow can store (`ECFEmissionService.php:433`). Nothing reverses an e-CF movement; `revertirVenta`
  (`API/src/Models/inventoryModel.php:217-220`) serves factura simple only.
- **Consult and re-send.**
  - `GET /api/facturas/{id}/estado` answers 422 "Esta factura no se envió a la DGII…" for any non-RFCE row without
    a `track_id` (`facturaController.php:649-657`).
  - `POST /api/facturas/{id}/reenviar` answers 501 (`:795-798`). It keeps doing so in both releases (decision 7).
  - Consult-time rollbacks pass no `rango_id` (`:685`, `:764`).
- **Frontend.**
  - The emission `catch` only shows a toast and re-enables the form (`FE/src/features/invoices/InvoiceFormView.tsx:585-588`).
  - `http.ts` passes the response `data` into `ApiError.datos` (`FE/src/api/http.ts:92`, `FE/src/api/errores.ts:47`),
    and nothing in the form reads it.
  - The list defaults to `'aprobado'` (`FE/src/stores/facturasList.ts:26`), which the backend maps to
    `LIKE '%ACEPTADO%'` (`facturaModel.php:927-928`). Rows without a verdict are hidden by default.
  - The detail band never renders `estado.error` (`FE/src/features/invoices/InvoiceDetailView.tsx:213-227`). The
    footer always says "enviado a la DGII" (`:331-333`).
- **Schema** (`API/db/tenant_schema.sql`). `facturas` is at `:203-249`:
  - `no_factura` and `client_name` are NOT NULL without a default (`:205`, `:208`);
  - `estado_dgii` is `VARCHAR(40)` since 028 (`:218-220`);
  - `xml_firmado` is `MEDIUMTEXT` (`:225`) and `respuesta_dgii` is `TEXT` (`:226`);
  - `UNIQUE KEY uk_e_ncf_amb (e_ncf, ambiente_dgii)` is at `:245`.

  Both migrations state their deploy order:
  - 027: first the migration, then the code (`db/migrations/027_e_ncf_unico_por_ambiente.sql:23-25`);
  - 028: before write-ahead (`db/migrations/028_estado_dgii_ancho.sql:58-60`).

  Nothing records which migrations ran (`tools/verificar_migraciones_tenant.sql:4-7`).
- **Transactions and isolation.**
  - Every model shares the request's PDO singleton (`facturaModel.php:28-31`, `API/src/Database.php:85-91`):
    autocommit, `ERRMODE_EXCEPTION` (`Database.php:70`).
  - No code sets an isolation level (grep `isolation` over `src/` finds nothing), so the server default applies.
  - No controller or util opens a transaction (grep `beginTransaction` outside `src/Models/` finds nothing).
- **Integration and gastos.**
  - `integracionEcfController.php:97` calls `emitir($payload)`. Its catch answers 502 with `$e->getMessage()`
    (`:98-110`), so exception classes and texts are part of the integration contract.
  - An integration tenant has no tenant DB (`Database.php:60`), which is why the service builds tenant models
    lazily (`ECFEmissionService.php:49-55`, `:65-75`).
  - Gastos emit through `gastoModel::emitirGastoDgii` (`API/src/Models/gastoModel.php:708-733`) and persist
    afterwards (`:331-352`): the same loss class.
- **Audit.**
  - `AuditLogger::log` swallows its own failures (`API/src/AuditLogger.php:92`) and caps the JSON at
    100,000 bytes (`:137-138`).
  - Rows go to the master DB under multi-tenant (`API/src/Models/AuditLogModel.php:20-25`).
  - `NCF_SEQUENCE_UPDATE` is already in the vocabulary (`docs/modules/auditoria.md:105-109`,
    `src/Controllers/ncfController.php:146`).
- **Checkers that must keep passing.**
  - `php tools/check_estado_dgii_ancho.php` prints `30/30 OK` on `db91ecf` (the 028 checks of `6609d91`
    included). It requires:
    - the literal `'estado' => 'RFCE_' . $rfceEstado` in the service (`tools/check_estado_dgii_ancho.php:71`);
    - the literal `CONCAT(estado_dgii, '_ARCHIVADO')` in `facturaModel` (`:73`);
    - the same `estado_dgii` COMMENT in the snapshot and in 028 (`:143-144`).
  - `php tools/test_consultar_ecf_dgii.php` prints `73/73 OK` on `db91ecf`.
- **Environment.**
  - Local PHP is 8.5.8 with `PDO` and `mysqlnd` but no `pdo_mysql`; production runs PHP 8.3.
  - The frontend has no test runner (`FE/package.json:10` `typecheck`). Its scripts run with plain
    `node file.ts` (`FE/scripts/test-conversion-ferreteria.ts:7-8`).

## 4. Architecture

### 4.1 Overview

```
facturaController::handleEmisionECF
  validate, totals (+422 if monto_total is not numeric), comprador, notas
  $facturaInput built HERE (moved up), closure $persistencia over facturaModel
  ECFEmissionService::emitir($payload, $persistencia)
    dispense e-NCF (counter +1, autocommit)                         unchanged
    try {
      build, cert, sign, codigo, RFCE build+sign (moved in), CR + token pre-flights,
      autenticar (seed only)
      $persistencia('reservar')  -> facturaModel::reservarFacturaECF  COMMIT #1  (PENDIENTE_ENVIO)
      assert no open transaction; arm shutdown entry
    } catch -> counter -1 only if no row owns the number
    try {
      recibir / recibirResumen                                        DGII SEND
      mapEstado, extractTrackId
      $persistencia('confirmar') -> facturaModel::confirmarFacturaECF COMMIT #2  (DGII state)
    } catch -> $persistencia('incierto') -> marcarEnvioIncierto       (ENVIO_INCIERTO)
             -> throw EcfEnvioInciertoException
    disarm shutdown entry
    reclamarSecuenciaSiNoUtilizada (row already final)                counter -1 when DGII did not use it
  controller: inventory (outside SIN_STOCK, once), audit, 200 / 422 / 502 incierto with data
```

### 4.2 Ordering rules and invariants

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

### 4.3 State machine

Column `facturas.estado_dgii VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE'` (`tenant_schema.sql:218-220`). Rows in scope:
`tipo_ecf IS NOT NULL`. With 028 every value below fits; the longest are `RFCE_NO_ENCONTRADO_ARCHIVADO` (28) and
`RFCE_ACEPTADO_CONDICIONAL` (25).

| `estado_dgii` | Written by | Meaning |
|---|---|---|
| `PENDIENTE` | nobody (DDL default only) | legacy |
| **`PENDIENTE_ENVIO`** | `reservarFacturaECF` (hook `'reservar'`) | Row, signed XML, RFCE XML, e-NCF, `codigo_seguridad` and items committed. The send has not started, or the process died before `'confirmar'`/`'incierto'`. |
| **`ENVIO_INCIERTO`** | `marcarEnvioIncierto` (hook `'incierto'`: the send threw, `'confirmar'` threw, or the shutdown registry ran). Release 2 adds: `GET /estado` and the CLI (`--verificar`, `--reenviar`) for a `PENDIENTE_ENVIO` older than 180 s; the CLI `--reenviar` for an `ENVIADO` row without `track_id`, before its re-send; and the reconciler after a CLI re-send flagged as duplicate. The app never re-sends (decision 7). | The DGII state is unknown. |
| `ENVIADO` | `confirmarFacturaECF` (2xx without a verdict) | Received, no verdict. `track_id` may be NULL (2xx non-JSON). |
| `EN_PROCESO`, `ACEPTADO`, `ACEPTADO_CONDICIONAL`, `RECHAZADO`, `NO_ENCONTRADO` | `confirmarFacturaECF`; `updateECFEstado` from the consult (`facturaController.php:664`); Release 2 reconciler | DGII state |
| `ERROR` | `confirmarFacturaECF` (`mapEstado` fallback, `ECFEmissionService.php:668`) | Burned by design: not retryable (`:99`, `:511`). With `secuenciaUtilizada === false` the reclaim still reverts the counter (`:512`) and the next dispense skips the number. Unchanged. |
| `RFCE_<estado>` | `confirmarFacturaECF` (`'RFCE_' . $rfceEstado`, `:433`); `updateECFEstado` from the RFCE consult (`facturaController.php:743`) | E32 < 250k |
| `<estado>_ARCHIVADO` | `reservarFacturaECF` archive step | Superseded attempt of a retried number (`e_ncf` NULL) |

Transitions:

```
(no row) ──[reservarFacturaECF: BEGIN; SELECT .. FOR UPDATE; archive; INSERT row + items; COMMIT]──▶ PENDIENTE_ENVIO
PENDIENTE_ENVIO ──[confirmar, same request]──▶ ENVIADO | EN_PROCESO | ACEPTADO | ACEPTADO_CONDICIONAL
                                               | RECHAZADO | NO_ENCONTRADO | ERROR | RFCE_*
PENDIENTE_ENVIO ──[incierto: send threw, confirm threw, shutdown registry]──▶ ENVIO_INCIERTO
PENDIENTE_ENVIO ──[process dies and the shutdown write fails]──▶ stays PENDIENTE_ENVIO
PENDIENTE_ENVIO | ENVIO_INCIERTO ──[R1: support hand-off, 10.2]──▶ ENVIADO+track_id | RFCE_ENVIADO
                                                                 | NO_ENCONTRADO | RFCE_NO_ENCONTRADO
ENVIADO+track_id NULL ──[R1: support hand-off, 10.2 first case]──▶ ENVIADO+track_id
PENDIENTE_ENVIO (desde > 180 s) ──[R2: GET /estado, CLI --verificar / --reenviar]──▶ ENVIO_INCIERTO
ENVIADO+track_id NULL ──[R2: CLI --reenviar, before the re-send]──▶ ENVIO_INCIERTO
ENVIO_INCIERTO | ENVIADO+track_id NULL ──[R2: EcfReconciliador lookup (GET /estado, CLI) or CLI re-send]──▶ any DGII state
ENVIO_INCIERTO ──[R2: CLI re-send answered RECHAZADO + secuenciaUtilizada=true]──▶ ENVIO_INCIERTO (duplicado_en_dgii)
ENVIO_INCIERTO ──[R2: CLI --marcar NO_ENCONTRADO]──▶ NO_ENCONTRADO
ENVIADO | EN_PROCESO | RFCE_* ──[existing consult + guarded first-acceptance stock move]──▶ DGII state
RECHAZADO | RFCE_RECHAZADO | NO_ENCONTRADO | RFCE_NO_ENCONTRADO
          ──[reserve of a NEW row with the same e_ncf + ambiente]──▶ <estado>_ARCHIVADO
```

`updateECFEstado` is unchanged: in-flight rows never reach it, because `GET /estado` branches before
`facturaController.php:649`.

### 4.4 `ECFEmissionService`: the persistence hook

File `API/src/Utils/FacturacionElectronica/ECFEmissionService.php`. New signature:

```php
public function emitir(array $payload, ?callable $persistencia = null): array
```

**Hook contract:** `$persistencia(string $fase, array $ctx): mixed`.

| `fase` | When | `ctx` | Return |
|---|---|---|---|
| `'reservar'` | Last statement of the rollback-protected `try`, after `autenticar()` (`:354-358`) and before the `catch` (`:359`). | `tipo_ecf`, `e_ncf`, `ambiente` (= `$tokenInfo['ambiente']`, what the row stores today), `ambiente_secuencia` (= `$ambienteEarly`, `:186`), `signed_xml`, `codigo_seguridad`, `fecha_emision_dgii` (`'Y-m-d H:i:s'`, `:333`), `flujo` (`'ECF'`/`'RFCE'`), `rfce_xml` (string or null), `dispensado` (bool), `rango_id`, `secuencia_valor`, `desde` (server `'Y-m-d H:i:s'`) | `['factura_id' => int, 'e_ncf' => string, 'desde' => string]`, kept as `$reserva` and passed back as `ctx['reserva']` |
| `'confirmar'` | After `mapEstado`/`extractTrackId` (`:453-454` e-CF, `:417-418` RFCE) and **before** `reclamarSecuenciaSiNoUtilizada` (`:456`, `:420`). | the `'reservar'` keys + `reserva`, `estado` (final; `'RFCE_'`-prefixed for RFCE), `track_id`, `dgii_response`, `dgii_status_code`, `rfce_track_id`, `rfce_estado`, `rfce_response`, `rfce_status_code`, `secuencia_utilizada` (`?bool`, parsed exactly as `:503-510`) | `bool`: `false` means the precondition did not match (another writer moved the row) |
| `'incierto'` | From the new catch around send+map+confirm, and from the shutdown registry. | `ctxSinXml(reservar keys)` + `reserva`, `fase_fallida` (`'envio'`/`'confirmar'`/`'shutdown'`), `clase`, `error` (≤ 2000 chars), `resultado_parcial` (= `proyectarResultado($ctxConfirmar)` when `fase_fallida = 'confirmar'`, else `null`) | `bool` (`marcarEnvioIncierto`'s result). The catch keeps it as `EcfEnvioInciertoException::$marcado`; when the hook throws, the service swallows the exception with `error_log` and uses `false`. The shutdown registry ignores it. |

**Two public static projections** (pure; public so the DB-free test can call them):

- `ctxSinXml(array $ctx): array` — removes `signed_xml` and `rfce_xml`.
- `proyectarResultado(array $ctx): array` — keeps only these keys: `estado`, `track_id`, `dgii_status_code`,
  `dgii_response`, `rfce_estado`, `rfce_track_id`, `rfce_status_code` and `secuencia_utilizada`. A non-array
  `dgii_response` (the raw body of `DgiiAuthService.php:150`) is cut to 4000 characters with `mb_substr`.

These are the only shapes that reach `respuesta_dgii TEXT`, `EcfEnvioInciertoException::$resultadoParcial` or the
audit `new_values` (100,000-byte cap). MEDIUMTEXT-sized XML never reaches any of them.

A private static `parseSecuenciaUtilizada(array $data): ?bool` holds the parsing at `:503-510`. Both the confirm ctx
and `reclamarSecuenciaSiNoUtilizada` use it.

**Edits inside `emitir()`, in file order:**

1. **Integration guard.** After `$integration` (`:145`):
   `if ($integration && $persistencia !== null) throw new InvalidArgumentException('write-ahead no aplica a integracion (sin DB de tenant)');`.
   This happens before any DGII contact.
2. **Before the `try`** (`:330`): `$reserva = null; $signedRfce = null; $ctxReservar = null;`. Also move `$montoTotal`
   and `$usaRFCE` (`:374-375`) here, unchanged.
3. **Inside the `try`, after `$codigoSeguridad` (`:351`):**
   - **RFCE.** When `$usaRFCE`, the RFCE data, build and sign block (`:378-411`) moves here verbatim.
     `recibirResumen` stays outside the try.
   - **CR pre-flight.** Call `DgiiReceptionService::assertSinCarriageReturn($signedXml)`, and also on `$signedRfce`
     for RFCE. `DgiiReceptionService.php:265-275` changes from `private` to `public static` with the same body;
     `recibir`/`recibirResumen` keep calling it (`:31`, `:72`).
   - **Authentication.** `autenticar()` is unchanged (`:354-358`).
   - **Token pre-flight.**
     `if (trim((string) ($tokenInfo['token'] ?? '')) === '') throw new RuntimeException('DGII bearer token is required.');`.
     The text is the same as `DgiiAuthService.php:230`, so integration texts do not change. It is defensive only:
     `normalizeTokenResponse` already refuses an empty token (`DgiiAuthService.php:503-508`).
4. **Last statement of the `try`:**
   ```php
   if ($persistencia !== null) {
       $ctxReservar = [/* 'reservar' keys of the table above */];
       $reserva = $persistencia('reservar', $ctxReservar);
       $pdo = Database::getInstance()->getConnection();
       if ($pdo->inTransaction()) {                  // the hook misbehaved: make the state observable
           $pdo->rollBack();
           $st = $pdo->prepare('SELECT 1 FROM facturas WHERE id = :id');
           $st->execute([':id' => (int) ($reserva['factura_id'] ?? 0)]);
           if ($st->fetchColumn() === false) { $reserva = null; }   // the open tx WAS the reserve: no owner, catch restores
           throw new RuntimeException('persistencia dejo una transaccion abierta');
       }
       self::armarEnVuelo($persistencia, $reserva, $ctxReservar);
       error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $reserva['factura_id']));
   }
   ```
5. **`catch (Throwable $e)`** (`:359`):
   - **A row owns the number** (`$reserva !== null`, step 4 threw after a committed reserve): log
     `[ECF e-NCF=%s factura_id=%d] fila reservada sin enviar` and rethrow. The counter stays advanced.
   - **`EcfNumeroOcupadoException`:** log `[ECF] e-NCF %s ocupado al reservar: la secuencia queda avanzada` and
     rethrow. The counter stays advanced, because a row owns the number.
   - **Otherwise, when `$dispensamosSecuencia`:**
     - The existing rollback and log stay as they are (`:361-367`).
     - New: if `rollbackECFSequence` returns false, write
       `AuditLogger::log(['module'=>'ncf','action'=>'NCF_SEQUENCE_UPDATE','entity_type'=>'ncf_sequence','entity_id'=>$eNcf,'success'=>false,'error_message'=>'rollback sin coincidencia','new_values'=>['e_ncf'=>$eNcf,'tipo_ecf'=>$tipoEcf,'rango_id'=>$secuenciaRangoId,'secuencia_valor'=>$secuenciaValor,'ambiente_secuencia'=>$ambienteEarly,'causa'=>get_class($e)],'description'=>'e-NCF consumido sin fila: no se pudo devolver a la secuencia.'])`.
       This records a number burned without a row.
   - The rethrow is unchanged (`:369`).
6. **Send block.** Lines `:413-418` (RFCE) and `:449-454` (e-CF) go inside a new `try`. Inside it, after `mapEstado`/`extractTrackId`:
   ```php
   $ctxConfirmar = $ctxReservar === null ? null : $ctxReservar + ['reserva' => $reserva, /* confirm keys */];
   $ok = $persistencia !== null ? (bool) $persistencia('confirmar', $ctxConfirmar) : true;
   ```
   The `catch (Throwable $e)`:
   ```php
   if ($persistencia !== null && $reserva !== null) {
       self::desarmarEnVuelo((int) $reserva['factura_id']);
       $fase    = isset($ctxConfirmar) ? 'confirmar' : 'envio';
       $parcial = isset($ctxConfirmar) ? self::proyectarResultado($ctxConfirmar) : null;
       $marcado = false;
       try { $marcado = (bool) $persistencia('incierto', self::ctxSinXml($ctxReservar) + ['reserva' => $reserva, 'fase_fallida' => $fase,
                 'clase' => get_class($e), 'error' => mb_substr($e->getMessage(), 0, 2000), 'resultado_parcial' => $parcial]); }
       catch (Throwable $h) { error_log('[ECF e-NCF=' . $eNcf . ' factura_id=' . $reserva['factura_id'] . '] marcar incierto fallo: ' . $h->getMessage()); }
       error_log(sprintf('[ECF e-NCF=%s factura_id=%d] ENVIO_INCIERTO fase=%s marcado=%s estado=%s track_id=%s %s: %s', $eNcf,
           $reserva['factura_id'], $fase, $marcado ? 'si' : 'no', $parcial['estado'] ?? '-', $parcial['track_id'] ?? '-', get_class($e), $e->getMessage()));
       throw new EcfEnvioInciertoException($eNcf, (int) $reserva['factura_id'], $ambiente, $fase, $parcial, $marcado, $e);
   }
   throw $e;   // integration and gastos: the original exception, unchanged
   ```
   After the inner try: `if ($reserva !== null) self::desarmarEnVuelo((int) $reserva['factura_id']);`. This path
   never rolls the counter back, because the DGII may hold the number.
7. **Reclaim.** `if (!$ok) error_log(sprintf('[ECF e-NCF=%s factura_id=%d] CONFIRM_RACE: otra escritura movio la fila; no se toca la secuencia', $eNcf, $reserva['factura_id']));`.
   Otherwise `reclamarSecuenciaSiNoUtilizada(...)` runs as today; its body (`:491-527`) is unchanged.
8. **Return arrays** (`:427-446`, `:463-475`) keep every key and gain `'factura_id' => $reserva['factura_id'] ?? null`.
   The RFCE array keeps the literal `'estado' => 'RFCE_' . $rfceEstado`, which `check_estado_dgii_ancho.php:71`
   reads.
9. **Shutdown registry.** Two static properties: `private static array $enVuelo = []` (factura_id →
   `[callable, reserva, ctxSinXml]`) and `private static bool $shutdownRegistrado = false`.
   - `armarEnVuelo` stores the entry and, once per process, registers this function:
     `register_shutdown_function(static function () { $err = error_get_last(); foreach (self::$enVuelo as [$p, $r, $c]) { try { $p('incierto', $c + ['reserva' => $r, 'fase_fallida' => 'shutdown', 'clase' => 'shutdown', 'error' => (string) ($err['message'] ?? 'shutdown sin respuesta')]); } catch (Throwable) {} } self::$enVuelo = []; })`.
   - `desarmarEnVuelo(int $id)` removes the entry.
   - Because the registry is static, a second service instance in the same request is watched too.
   - It runs after `ErrorHandler::onShutdown` (`ErrorHandler.php:47-61`), which can only log an anonymous `error_id`.
     If PDO is unusable at that point, the row stays `PENDIENTE_ENVIO` (resolution: 10.2 in Release 1, the 180 s
     rule in Release 2).
10. **Constructor.** It becomes
    `__construct(?DgiiAuthService $auth = null, ?DgiiXmlSigner $signer = null, ?DgiiReceptionService $reception = null, ?ncfModel $ncf = null)`,
    with today's defaults (`:56-63`). It is a test seam with no change in meaning.
11. **Docblocks.** The `emitir()` docblock (`:128-135`) documents `$persistencia` and `factura_id`. The comment at
    `:326-329` is updated to say the reserve commits inside the try.

**Release 2 additions** (no dispensing, no reclaim, no builder or signer):

- `public function reenviarFirmado(string $xmlFirmado, string $ambiente, string $flujo): array`:
  - authenticates as `consultarEstado` does (`:547-552`), then calls `recibir()` or `recibirResumen()`, then
    `mapEstado`/`extractTrackId`;
  - returns the `proyectarResultado` keys plus `rfce_response`. `estado` is prefixed for RFCE;
  - its only caller is `EcfReconciliador::reenviar()`, which only the support CLI reaches (decision 7).
- `public function consultarTrackIds(string $eNcf, ?string $ambiente = null, ?string $rncEmisor = null): array`:
  - authenticates as `consultarEstado` does (`:534-560`);
  - delegates to `DgiiReceptionService::consultarTrackIds` and returns the normalized list.

### 4.5 New exceptions

Both live in `API/src/Utils/FacturacionElectronica/`.

**`EcfNumeroOcupadoException extends EcfUsuarioException`.** `EcfUsuarioException` is at
`EcfUsuarioException.php:16-29`.

- **Thrown by** `reservarFacturaECF` only, in three cases: a non-retryable row holds the e-NCF in that ambiente;
  the INSERT hits a duplicate key (driver code 1062); a second deadlock (1213, SQLSTATE 40001) (4.6). Other
  SQLSTATE 23000 errors (1048 column cannot be null, 1452 foreign key, for example an item whose product was
  deleted) are not "occupied": they are rethrown and the counter is restored.
- **User text:** `'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'`.
- **Technical text:** the e-NCF, the ambiente and the cause.
- **Meaning:** a row already owns the number, so the counter stays advanced. That is the same effect as the
  dispenser's skip at `ECFEmissionService.php:234-238`.
- **Response:** the existing 502 branch prints `getMensajeUsuario()` (`facturaController.php:376-378`).

**`EcfEnvioInciertoException extends RuntimeException`.**

- **Fields:** `public readonly string $eNcf; public readonly int $facturaId; public readonly string $ambiente;
  public readonly string $faseFallida; public readonly ?array $resultadoParcial; public readonly bool $marcado;`.
  `$resultadoParcial` always has the `proyectarResultado` shape. `$marcado` is true when `'incierto'` stored
  `ENVIO_INCIERTO`, and false when the row stayed `PENDIENTE_ENVIO` (the hook threw or returned false).
- **Message:** `sprintf('Envio a la DGII sin confirmar: e-NCF %s, factura_id %d, fase %s', $eNcf, $facturaId,
  $faseFallida)`. The previous Throwable is kept.
- **Thrown** only when `$persistencia !== null`. `integracionEcfController.php:97` and `gastoModel.php:732` keep
  receiving the original Throwable.

### 4.6 `EstadosEcf` and `facturaModel`

**New `API/src/Utils/FacturacionElectronica/EstadosEcf.php`** (constants only, no dependencies):

```php
final class EstadosEcf {
    // today ECFEmissionService.php:99 and facturaModel.php:1009, plus RFCE_NO_ENCONTRADO (section 3, "The counter")
    public const REINTENTABLES = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO'];
    public const EN_VUELO      = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'];
    // the 'pendiente' list filter: every state without a DGII verdict
    public const SIN_VEREDICTO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'];
    // verdicts that never move stock
    public const SIN_STOCK     = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO', 'ERROR', 'RFCE_ERROR'];
}
```

`ECFEmissionService` (`:99`), `facturaModel`, `facturaController` and `ReporteVentasModel` require it. The two
copies of the retryable list disappear.

Adding `RFCE_NO_ENCONTRADO` to `REINTENTABLES` makes an RFCE `NO_ENCONTRADO` behave like the e-CF one: the counter
reverts (`ECFEmissionService.php:511-512`), the retry dispenses the same number and the reserve archives the row as
`RFCE_NO_ENCONTRADO_ARCHIVADO` (28 characters, within `VARCHAR(40)`). `ERROR`/`RFCE_ERROR` stay non-retryable
(unchanged, section 14).

**`facturaModel` (`API/src/Models/facturaModel.php`), Release 1:**

- **`public static function metaEnvio(?string $respuestaDgii): array`.** It returns `json_decode($respuestaDgii, true)` when the
  result is an array, and `[]` otherwise: NULL, invalid JSON, or the JSON of a string. The last case is legacy
  `ENVIADO` rows, from `DgiiAuthService.php:150` through `facturaModel.php:1061`. Every reader of `rango_id`,
  `secuencia_valor`, `ambiente_secuencia`, `flujo` or `desde` goes through it. An absent `rango_id` means "legacy
  type+ambiente rollback" (`ncfModel.php:194-200`).
- **`public function reservarFacturaECF(array $factura, array $ctx): array`** returns
  `['factura_id', 'e_ncf', 'desde']`:
  ```
  assert non-empty $ctx['ambiente']        (a NULL ambiente would be unprotected by uk_e_ncf_amb)
  nota fields = normalizarNotaReferencia($factura, $ctx['tipo_ecf'])   (today's :976-992, extracted, pure)
  for ($intento = 1; ; $intento++) {
    try {
      beginTransaction()
      SELECT id, estado_dgii FROM facturas
       WHERE e_ncf = :e AND (ambiente_dgii = :amb OR ambiente_dgii IS NULL) FOR UPDATE   (:amb = $ctx['ambiente'], as :1008 today)
      foreach row:
        not in EstadosEcf::REINTENTABLES  -> rollBack(); throw EcfNumeroOcupadoException
        else UPDATE facturas SET e_ncf = NULL, estado_dgii = CONCAT(estado_dgii, '_ARCHIVADO')
               WHERE id = :id AND estado_dgii = :visto
             rowCount 0 -> rollBack(); throw EcfNumeroOcupadoException     (cannot happen under FOR UPDATE; belt and braces)
      INSERT facturas (column list of :1030-1041 plus secuencia_utilizada)
        no_factura = e_ncf, estado_dgii = 'PENDIENTE_ENVIO', track_id NULL, ambiente_dgii = $ctx['ambiente'],
        xml_firmado = signed_xml, rfce_xml, codigo_seguridad, fecha_emision_dgii,
        respuesta_dgii = json(meta, 6.3), rfce_track_id/rfce_estado/rfce_respuesta NULL, secuencia_utilizada NULL
      INSERT factura_items  (:1073-1101 verbatim)
      commit()
      return ['factura_id' => lastInsertId, 'e_ncf' => $ctx['e_ncf'], 'desde' => $ctx['desde']]
    } catch (PDOException $e) {
      rollBack() if inTransaction()
      $codigo = $e->errorInfo[1] ?? null     (driver code, not SQLSTATE: 23000 also covers 1048 and 1452)
      $codigo === 1062 (duplicate key)          -> throw EcfNumeroOcupadoException(previous: $e)
      $codigo === 1213 (deadlock, SQLSTATE 40001) and $intento === 1
                                                -> continue   (InnoDB already rolled the transaction back)
      $codigo === 1213                          -> throw EcfNumeroOcupadoException(previous: $e)
      otherwise (1048, 1452, 1205 lock wait, 1406 data too long, outage)
                                                -> rethrow    (the emission catch restores the counter)
    } catch (Throwable $e) { rollBack() if inTransaction(); rethrow }
  }
  ```
  - The literal `CONCAT(estado_dgii, '_ARCHIVADO')` stays: `check_estado_dgii_ancho.php:73` requires it.
  - **Isolation.** No code sets an isolation level, so MySQL's REPEATABLE READ applies. `SELECT … FOR UPDATE` on a
    **non-existent** `e_ncf` takes gap locks that two sessions can hold at once. The unique index at INSERT is then
    the arbiter, and the loser sees 1062 (duplicate key) or 1213 (deadlock); both mean "occupied", the deadlock
    after one retry.
  - **When two requests can carry the same e-NCF.** Only with the payload `e_ncf` override
    (`facturaController.php:329`), where `$dispensamosSecuencia` is false and the counter is not affected. In the
    normal flow `dispenseNextECF` hands out distinct numbers.
  - **Ambiente divergence.** When `$ctx['ambiente'] !== $ctx['ambiente_secuencia']`, the method logs one line.
- **`public function confirmarFacturaECF(int $id, array $ctx): bool`.** A single autocommit statement; a
  `PDOException` propagates:
  ```sql
  UPDATE facturas SET estado_dgii = :estado, track_id = :track_id, respuesta_dgii = :resp,
         secuencia_utilizada = :sec, rfce_track_id = :rtid, rfce_estado = :rest, rfce_respuesta = :rresp
   WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')
  ```
  - It returns `rowCount() > 0`.
  - `:resp` and `:rresp` are the JSON of the answer, as `:1061`/`:1065` write today. A string body is cut to
    4000 characters first, so `respuesta_dgii` can never exceed TEXT.
  - It **overwrites** the meta (rule 4.2.3).
  - It stores `secuencia_utilizada`, which is never written at emission today. The binding is
    `':sec' => $ctx['secuencia_utilizada'] === null ? null : (int) $ctx['secuencia_utilizada']`: the connection uses
    emulated prepares (`Database.php:65-73` sets no `ATTR_EMULATE_PREPARES`), so a bare `false` would reach the
    `TINYINT(1)` column (`tenant_schema.sql:231`) as `''`, which strict `sql_mode` rejects (1366). `updateECFEstado`
    casts the same way (`facturaModel.php:1134`).
- **`public function marcarEnvioIncierto(int $id, array $ctx): bool`:**
  - It runs `UPDATE facturas SET estado_dgii = 'ENVIO_INCIERTO', respuesta_dgii = :json WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'`,
    with the JSON of 6.3.
  - Before encoding, it also removes any `signed_xml`, `rfce_xml` or `xml_firmado` key, as a safeguard.
  - It never throws: it catches, writes `error_log` with the e-NCF and returns `false`.
- **`public function existeFactura(int $id): bool`** (`SELECT 1`). The controller uses it in its catch (4.7).
- **Items for a later stock move** come from the existing `getFacturaItems($factura_id)` (`facturaModel.php:93-103`).
  It already selects `product_id`, `quantity` and `indicador_bien_servicio`, the columns
  `inventoryModel::registrarVenta(int, array, ?string, ?int)` reads (`inventoryModel.php:182-185`). No new method.
- **`applyEstadoTipoFilters`** (`:925-936`): a new branch maps `'pendiente'` to
  `f.estado_dgii IN (EstadosEcf::SIN_VEREDICTO)`, bound as parameters. It means "sin veredicto de la DGII", so a row
  that completed as `ENVIADO`/`EN_PROCESO`/`RFCE_ENVIADO`/`RFCE_EN_PROCESO` after a lost HTTP response shows under
  the filter the timeout message points to.
- **`sqlReferencia`** (`:1445`): add `'PENDIENTE_ENVIO', 'ENVIO_INCIERTO'` to the IN list. An E34 in flight then
  reserves saldo, and a second E34 is refused at `facturaController.php:602` while the first is unresolved.
- **`getECFStats`:** see section 8.
- **Removed:** `saveFacturaConECF` (`:966-1125`; single caller `facturaController.php:417`) and its docblock
  (`:956-965`). The comments that name it are reworded: `ECFEmissionService.php:87`, `FacturaPdfGenerator.php:466`
  and `docs/modules/gastos.md:361`.

**`facturaModel`, Release 2:**

- `confirmarFacturaECF(int $id, array $ctx, bool $desdeReconciliacion = false)`. When true, the whole clause is
  `WHERE id = :id AND (estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL))`.
  The parentheses matter: without them the `OR` branch would match every `ENVIADO` row without `track_id`.
- `marcarEnvioIncierto(int $id, array $ctx, bool $desdeEnviadoSinTrack = false)`. When true, the precondition is
  `WHERE id = :id AND (estado_dgii = 'PENDIENTE_ENVIO' OR (estado_dgii = 'ENVIADO' AND track_id IS NULL))`. Only
  `EcfReconciliador::reenviar` step 1 passes true (10.3); its only caller is the support CLI (decision 7).
- `anotarEnvioIncierto(int $id, array $meta): bool`. It rewrites the JSON of an `ENVIO_INCIERTO` row: `intentos + 1`,
  `duplicado_en_dgii`, and the last error (≤ 2000 characters).
- `getXmlFirmado(int $id): array` returns `['xml_firmado' => ?string, 'rfce_xml' => ?string]`. `getECFData` does not
  select either column (`facturaModel.php:1326-1339`); `reenviar` reads them under its lock (10.3 step 2).
- `getEnVuelo(?string $ambiente, int $limit = 200): array`. It lists rows in `EstadosEcf::EN_VUELO` or
  `ENVIADO AND track_id IS NULL`, each with `meta = metaEnvio(respuesta_dgii)`.
- `getECFData` (`:1326-1339`) adds `rfce_estado`, `xml_firmado IS NOT NULL AS tiene_xml` and
  `rfce_xml IS NOT NULL AS tiene_rfce`. `rfce_estado` also fixes the always-null `rfce_estado` at
  `facturaController.php:726`.

### 4.7 `facturaController` (`API/src/Controllers/facturaController.php`)

**Release 1:**

- **New constant**, next to `FACTURA_EMISION_FALLO_GENERICO` (`:18`). The text is pinned verbatim (12.4):
  ```php
  const FACTURA_EMISION_INCIERTA = 'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.';
  ```
- **`handleEmisionECF`:**
  - **Total guard.** After the totals override (`:226-234`):
    `if (!isset($totales['monto_total']) || !is_numeric($totales['monto_total'])) { respond(false, 'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.', 422); return; }`.
    Today a strict-input `totales` without `monto_total` (`:230-231`) put NULL into `total NOT NULL`
    (`tenant_schema.sql:209`) after the DGII answer.
  - **`$facturaInput`** (`:382-415`) moves above the emission `try` (`:360`) without `'no_factura'`; the model fills it
    from the e-NCF. Its items keep `mapItemsForXml($items)` without `$strictInput` (`:414`).
  - **Closure:**
    ```php
    $reserva = null;
    $persistencia = function (string $fase, array $ctx) use ($facturaModel, $facturaInput, &$reserva) {
        switch ($fase) {
            case 'reservar':  return $reserva = $facturaModel->reservarFacturaECF($facturaInput, $ctx);
            case 'confirmar': return $facturaModel->confirmarFacturaECF((int) $reserva['factura_id'], $ctx);
            case 'incierto':  return $facturaModel->marcarEnvioIncierto((int) $reserva['factura_id'], $ctx);
        }
        return null;
    };
    $result = (new ECFEmissionService())->emitir($payload, $persistencia);
    ```
  - **`catch (Throwable $e)`:**
    - It finds the saved row:
      - for an `EcfEnvioInciertoException`, `$filaId = $e->facturaId`;
      - otherwise, when the closure's `$reserva` is set **and** `$facturaModel->existeFactura($reserva['factura_id'])`
        (the 4.4 step 4 re-check), `$filaId = $reserva['factura_id']`.
    - **When there is a row:**
      - The e-NCF comes from the row, not from the payload: `$eNcf` here is the cleaned payload override
        (`facturaController.php:279-281`), which is null in the normal flow where the service dispenses.
        ```php
        $eNcfFila   = $e instanceof EcfEnvioInciertoException ? $e->eNcf : (string) $reserva['e_ncf'];
        $estadoFila = ($e instanceof EcfEnvioInciertoException && $e->marcado) ? 'ENVIO_INCIERTO' : 'PENDIENTE_ENVIO';
        $faseFila   = $e instanceof EcfEnvioInciertoException ? $e->faseFallida : 'reservar';
        ```
        `$estadoFila` is the state the row really has: `'incierto'` can fail (row 30) and a hook that left a
        transaction open never reaches it (row 17).
      - `error_log` with `$eNcfFila` and `factura_id`.
      - Audit: `AuditLogger::log(['module'=>'facturas','action'=>'EMIT','entity_type'=>'factura','entity_id'=>$eNcfFila,'new_values'=>['factura_id'=>$filaId,'tipo_ecf'=>$tipoEcf,'client_id'=>$clientId,'estado_dgii'=>$estadoFila,'fase_fallida'=>$faseFila,'resultado_parcial'=>$e instanceof EcfEnvioInciertoException ? $e->resultadoParcial : null],'success'=>false,'error_message'=>($e->getPrevious() ?? $e)->getMessage(),'description'=>'e-CF reservado y enviado sin confirmación de la DGII (envío incierto).'])`.
        It goes to the master DB and survives a tenant outage.
      - Response: `http_response_code(502); echo json_encode(['status'=>false,'error'=>sprintf(FACTURA_EMISION_INCIERTA,$eNcfFila),'data'=>['factura_id'=>$filaId,'e_ncf'=>$eNcfFila,'tipo_ecf'=>$tipoEcf,'estado_dgii'=>$estadoFila]])`.
    - **Otherwise** the existing branch (`:363-380`) is unchanged, `EcfNumeroOcupadoException` included.
  - **Success:**
    - `$facturaId = (int) $result['factura_id']`.
    - `$data` keeps today's keys (`:456-464` with `saveFacturaConECF`'s payload): `factura_id`, `e_ncf`, `track_id`,
      `estado_dgii` (= `$result['estado']`), `codigo_seguridad`, `total` (= `$totales['monto_total']`), `tipo_ecf`,
      `ambiente`, `fecha_emision_dgii` and `dgii_response`.
    - The inventory block (`:437-454`) moves **after** `$rechazado` (`:471-472`) and runs only
      `if (!in_array($estadoFinal, EstadosEcf::SIN_STOCK, true) && !$inv->yaMovioDocumento('factura', $facturaId))`.
      `$rechazado` is not reused for this gate, because it lacks `RFCE_NO_ENCONTRADO` and `RFCE_ERROR`.
    - The rejection list at `:472` and the 422 and 200 responses are unchanged (section 14).
- **`handleConsultarEstado`** (`:639`):
  - **Minimal in-flight branch.** It is inserted after the 404 check (`:642-645`) and before the RFCE route (`:649`):
    `if (in_array($ecf['estado_dgii'], EstadosEcf::EN_VUELO, true) || ($ecf['estado_dgii'] === 'ENVIADO' && empty($ecf['track_id']) && !empty($ecf['e_ncf']))) { handleEstadoEnVuelo($facturaId, $ecf); return; }`.
    In Release 1, `handleEstadoEnVuelo` makes no DGII call and answers 200 with the stored state and a note (7.3).
  - **First acceptance moves stock.** In the legacy branch, after `updateECFEstado` (`:664`) and the
    `STATUS_CHANGE` audit (`:666-674`): when the transition lands on `ACEPTADO`/`ACEPTADO_CONDICIONAL` from a state
    that is not accepted and `!yaMovioDocumento('factura', $facturaId)`, call
    `registrarVenta($facturaId, $facturaModel->getFacturaItems($facturaId), $ecf['tipo_ecf'], RequestContext::userId())`,
    with a try/catch that only logs. The same block goes into `handleConsultarEstadoRFCE` after `:743`, for
    `RFCE_ACEPTADO`/`RFCE_ACEPTADO_CONDICIONAL`.
    - Today stock moved at emission whatever the verdict. Now a `NO_ENCONTRADO` row that is later accepted moves it
      exactly once.
    - `RequestContext::userId()` is at `API/src/RequestContext.php:67`.
  - The conditional rollbacks (`:676-691`, `:755-770`) are unchanged.
- **`normalizeEstadoFilter`** (`:1207-1223`) accepts `'pendiente'`.

**Release 2:**

- `handleEstadoEnVuelo` delegates to `EcfReconciliador::verificar()` (10.3).
- `handleReenviar` (`:795-798`) is **not** implemented: `POST /api/facturas/{id}/reenviar` keeps answering 501 as
  today (decision 7, 7.4). `EcfReconciliador::reenviar()` is reached only from the support CLI (10.4). Permissions
  are unchanged: module `facturas` (`API/config/permissions.php:90`).

### 4.8 Other backend changes

**Release 1:**

- **`ncfModel::dispenseNextECF`.** Its `catch (PDOException $e) { return null; }` (`ncfModel.php:165-167`) becomes
  `throw new RuntimeException('ncf_sequences inaccesible: ' . $e->getMessage(), 0, $e)`.
  - `return null` stays for a missing range (`:135`, `:164`).
  - Its only caller is `ECFEmissionService.php:223`; grep finds no other caller in `src/`, `tools/` or `public/`.
  - A tenant-DB outage then yields the generic 502 instead of "Se acabaron los números…". The gastos path gets an
    `ERROR` gasto through its existing catch (`gastoModel.php:316-330`), as for any other emission failure.
- **`inventoryModel::yaMovioDocumento(string $referenciaTipo, int $referenciaId): bool`** (additive):
  - `SELECT 1 FROM inventory_movements WHERE referencia_tipo = :t AND referencia_id = :id LIMIT 1`, served by
    `idx_referencia` (`tenant_schema.sql:666`).
  - Callers call it; `registrarVenta` (`inventoryModel.php:185-201`) does not. Factura simple calls
    `revertirVenta` and then `registrarVenta` on the same id, and must keep working.
- **`ReporteVentasModel::fetchDocumentos`** (`API/src/Models/ReporteVentasModel.php:116-117`) adds
  `AND f.estado_dgii NOT IN (EstadosEcf::EN_VUELO)`.
- **`DgiiReceptionService::assertSinCarriageReturn`** becomes `public static` (4.4 step 3).

**Release 2:**

- **`EcfConsultaDgii`** (new, `API/src/Utils/FacturacionElectronica/EcfConsultaDgii.php`). These pure functions of
  `tools/consultar_ecf_dgii.php` move there as public static methods, under these names:

  | Tool function (`db91ecf`) | Static method |
  |---|---|
  | `cecfRutaTrackIds` (`:55-58`) | `rutaTrackIds(string $rnc, string $encf): string` |
  | `cecfRutaEstado` (`:61`) | `rutaEstado(string $rnc, string $encf, string $rncComprador = '', string $codigo = ''): string` |
  | `cecfNormalizarTrackIds` (`:79-97`) | `normalizarTrackIds($data): array` |
  | `cecfNormalizarFecha` (`:110`) | `normalizarFecha(?string $valor, bool $conHora): ?string` |
  | `cecfMapEstado` (`:150-174`) | `mapEstado(?string $texto, $codigo): ?string` |
  | `cecfResumen` (`:183`) | `resumen(string $encf, array $trackIds, ?array $estado, array $resultados): array` |
  | `cecfUrlTimbre` (`:255`) | `urlTimbre(array $r, string $rncEmisor, string $ambiente): ?string` |

  The tool and `tools/test_consultar_ecf_dgii.php` `require_once` the class and keep their function names as thin
  wrappers.

  Two global functions of `facturaController.php` move there too, because `EcfReconciliador` (shared with the CLI)
  cannot require the controller: requiring it sends headers, runs the auth check and the router
  (`facturaController.php:2-6`, `:25-34`, `:36-141`).
  - `mapEstadoFromConsulta` (`:1099-1128`) → `mapEstadoConsulta(array $consulta): ?string`;
  - `normalizeSecuenciaUtilizada` (`:1134-1140`) → `normalizarSecuenciaUtilizada($v): ?bool`.

  The controller keeps both functions as one-line wrappers.
- **`DgiiReceptionService::consultarTrackIds(string $rnc, string $eNcf, string $bearerToken, array $options = []): array`.**
  - It calls `GET {env}/consultatrackids/api/TrackIds/Consulta?RncEmisor=..&Encf=..` through
    `consultarEndpointAutenticado` with `tolerate_http_errors`, as the tool does (`tools/consultar_ecf_dgii.php:427`,
    `:440`).
  - It returns `EcfConsultaDgii::normalizarTrackIds($data)`. A 404 ProblemDetails body means "no trackIds".
  - Its `fechaRecepcion` is a date without time (`dd/MM/yyyy`, `docs/integrations/dgii-ecf.md:122`); the
    ConsultaResultado `fechaRecepcion` has the time (`:123-124`).
  - The service exists only in `testecf` and `ecf`; in `certecf` it answers 404 (`tools/consultar_ecf_dgii.php:24-26`).
- `EcfReconciliador` and `tools/ecf_en_vuelo.php`: see 10.3 and 10.4.

### 4.9 Data flow and commit boundaries

`POST /api/facturas` (tenant of type app) uses one PDO singleton in autocommit (`Database.php:85-91`).

| # | Step | File:line today | DB / counter | Commit boundary |
|---|---|---|---|---|
| 1 | Validation, client, totals, **422 when `monto_total` is not numeric**, comprador, notas | `facturaController.php:145-325` | none | — |
| 2 | `$payload` (`:327-358`); **`$facturaInput` built here** (moved from `:382-415`) | | none | — |
| 3 | `emitir()`: emisor, `$ambienteEarly`, reference re-validation | `ECFEmissionService.php:176-199` | none | — |
| 4 | Dispense loop | `:214-252`; `ncfModel.php:117-168` | **counter +1 per iteration**; skipped numbers stay consumed (`ECFEmissionService.php:215-220`) | each UPDATE autocommits |
| 5 | `try {` locations, date, build, cert, sign, codigo, **RFCE build+sign**, **CR pre-flight**, `autenticar`, **token pre-flight** | `:330-358` | none | — |
| 6 | **`'reservar'` → `reservarFacturaECF`**; no-open-transaction assertion; arm the shutdown entry | new, at the end of the try | `BEGIN; SELECT … FOR UPDATE; [archive]; INSERT row; INSERT items; COMMIT` (one retry on a deadlock, 1213) | **commit #1, before any send** |
| 7 | `$bearerToken`, `$ambiente` | `:371-372` | none | no transaction open from here on |
| 8 | **Send** `recibirResumen` / `recibir` (in the new try) | `:413-415` / `:449-451` | none | — |
| 9 | `mapEstado`, `extractTrackId` | `:417-418` / `:453-454` | none | — |
| 10 | **`'confirmar'` → `confirmarFacturaECF`**; disarm | new, before `:420` / `:456` | single UPDATE with an estado precondition | **commit #2**: the row is final before the counter moves |
| 11 | `reclamarSecuenciaSiNoUtilizada` (skipped on `CONFIRM_RACE`) | `:420-425` / `:456-461` | counter −1 when `secuenciaUtilizada === false`, or when it is absent and the state is `RECHAZADO`/`NO_ENCONTRADO` | autocommit |
| 12 | Return arrays + `factura_id` | `:427-446` / `:463-475` | — | — |
| 13 | Controller: `$rechazado`; inventory only when the state is outside `EstadosEcf::SIN_STOCK` and stock was not moved yet | `:471-472`; block from `:437-454` | `aplicarMovimientos` opens its own short transaction (`inventoryModel.php:66`) | separate, after #1 and #2 |
| 14 | EMIT audit and response 200 / 422 | `:474-499` | — | — |

**The counter at each exit:**

- Steps 1–3 throw: untouched.
- Step 4 ends in an exception: the earlier iterations stay consumed (unchanged).
- Step 5 throws: −1, as today. That now includes RFCE and CR failures.
- Step 6 throws "occupied" (a non-retryable row, duplicate key 1062, or a second deadlock 1213): stays +1, because
  a row owns the number.
- Step 6 throws anything else (1048 and 1452 included): −1, and there is no row.
- Step 6 succeeds, then the assertion throws:
  - with the row present: stays +1, and the row is `PENDIENTE_ENVIO`;
  - with the row erased: −1, and there is no row.
- Steps 8–10 throw: stays +1, and the row is `ENVIO_INCIERTO`.
- Step 11 rollback mismatch: stays, logged as today.

## 5. Failure handling

"Pre-send" means the DGII has seen only the seed exchange. "502 generic" means `FACTURA_EMISION_FALLO_GENERICO`
(`facturaController.php:18`) or the `EcfUsuarioException` text. "502 incierto" means `FACTURA_EMISION_INCIERTA` plus
`data{factura_id, e_ncf, tipo_ecf, estado_dgii}`.

| # | Failure point | Row | Counter | User sees | Recovery |
|---|---|---|---|---|---|
| 1 | `resolveUbicaciones` (`ECFEmissionService.php:331`) | none | −1 | 502 generic | retry |
| 2 | `createFromFormat` returns false (`:333`) | none | −1 | 502 generic | fix the date |
| 3 | `ECFXmlBuilder::build` (`:335`) | none | −1 | 502 (user text if `EcfUsuarioException`) | fix the data |
| 4 | `CertResolver` / empty password (`:338-348`) | none | −1 | 502 configuration text | support |
| 5 | `DgiiXmlSigner::sign` (`:350`) | none | −1 | 502 generic | support |
| 6 | RFCE build or sign (moved into the try; was `:410-411` outside it) | none | **−1 (was: consumed)** | 502 generic | retry |
| 7 | CR in the signed XML (pre-flight; was `DgiiReceptionService.php:31`/`:72` outside the try) | none | **−1 (was: consumed)** | 502 generic | fix the builder; deterministic, so no orphan |
| 8 | `autenticar` (`:354-358`) | none | −1 | 502 generic | retry |
| 9 | Empty-token pre-flight | none | −1 | 502 generic | retry; unreachable in practice (`DgiiAuthService.php:503-508` already refuses an empty token) |
| 10 | `rollbackECFSequence` returns false in the pre-send catch (`ncfModel.php:201-222`) | none | **not restored** (pre-existing) | 502 | log (`ECFEmissionService.php:364-367`) **+ master audit `NCF_SEQUENCE_UPDATE success=0` with the e-NCF**; manual |
| 11 | Dispense loop ends in an exception after N iterations (`:222-249`) | none | N consumed (unchanged) | 502 "Se acabaron…" / "No se pudo asignar un número…" | sync the counter (unchanged) |
| 12 | Tenant DB down at `dispenseNextECF` | none | untouched | **502 generic** (was the misleading "Se acabaron los números…") | retry |
| 13 | `'reservar'`: a non-retryable row holds the e-NCF in that ambiente (race, override, or ambiente divergence `:186` vs `:372`) | none (rolled back) | **stays +1** | 502 `'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'` | retry dispenses the next number; pre-send |
| 14 | `'reservar'`: duplicate key, driver code 1062 (concurrent same number; or 027 missing, 6.2), or a deadlock (1213) twice | none | stays +1 | same as 13 | same as 13; a single deadlock is retried inside the model |
| 15 | `'reservar'`: any other `PDOException` (outage; NOT NULL 1048 and FK 1452, which share SQLSTATE 23000 with 1062; lock wait; commit; or "Data too long" without 028, 6.2) or a non-PDO Throwable | none (the model rolls back on any Throwable) | −1 | 502 generic | retry when the DB is back; for 1452, reload the product list. **The 2026-10-05 class becomes "refused before send".** |
| 16 | Process dies **inside** the reserve transaction before COMMIT | none (server-side rollback) | **+1, not restored**: the catch never runs | JSON 500 (`ErrorHandler.php:76-94`) | Same class as today's fatal inside the try. Visible only as a counter gap; documented exception to the invariant. |
| 17 | The hook left a transaction open and the row survived the forced rollback | `PENDIENTE_ENVIO` | stays +1 | 502 incierto | R1: 10.2; R2: the 180 s rule and `GET /estado`, then support (`tools/ecf_en_vuelo.php`, 10.4). It is a bug to fix. |
| 18 | The hook left a transaction open and the rollback erased the INSERT | none | −1 (`$reserva` reset, the catch restores) | 502 generic | bug fix; no phantom `factura_id` is ever returned |
| 19 | Reserve OK, process crash before `recibir()` | `PENDIENTE_ENVIO` (or `ENVIO_INCIERTO` through the shutdown registry) | +1 | JSON 500 | R1: 10.2 (the DGII has nothing → `NO_ENCONTRADO`); R2: 180 s rule and `GET /estado`, then support: CLI `--reenviar` or `--marcar NO_ENCONTRADO` (10.4) |
| 20 | `random_bytes` inside `recibir`/`recibirResumen` (`DgiiReceptionService.php:37`, `:79`) | `ENVIO_INCIERTO`, `fase_fallida = envio` (conservative) | +1 | 502 incierto | same as 19 |
| 21 | **`curl_exec === false`** (timeout, DNS, TLS; `DgiiAuthService.php:389-393`) | `ENVIO_INCIERTO`, `fase_fallida = envio` | +1 (the DGII may have consumed it) | 502 incierto; the form offers "Ver factura" | R1: 10.2 lookup; R2: `GET /estado` (TrackIds); without a record, support re-sends with the CLI `--reenviar` and its duplicate guard, or marks the row (10.4) |
| 22 | 4xx/5xx without JSON (`DgiiAuthService.php:141-144`) | `ENVIO_INCIERTO` (error text ≤ 2000 characters; the summary is already ≤ 500, `:538-546`) | +1 | 502 incierto | same as 21 |
| 23 | 2xx without JSON → `ENVIADO`, `track_id` NULL (`:150`, `ECFEmissionService.php:665-666`) | `ENVIADO` confirmed, `track_id` NULL | +1 | 200 "emitido (En proceso)" | `GET /estado` answers 200 with a note (R1), then support fills `track_id` (10.2); R2: TrackIds lookup |
| 24 | `mapEstado` → `ERROR` (`:668`) | `ERROR` confirmed | +1; −1 when `secuenciaUtilizada === false` (`:512`), and the next dispense skips the number because `ERROR` is not retryable (unchanged) | 422 + `data` (`RFCE_ERROR`: 200, pre-existing) | unchanged; **inventory no longer moves** (`SIN_STOCK`) |
| 25 | RFCE 2xx without JSON → `RFCE_ENVIADO` | `RFCE_ENVIADO` confirmed | +1 | 200 | the existing RFCE consult (`facturaController.php:649-652`); the frontend shows "En proceso" |
| 26 | DGII `RECHAZADO` / `NO_ENCONTRADO` | confirmed **before** reclaim | −1 when `secuenciaUtilizada === false`, or absent | 422 + `data` | retry → same number → archived in `'reservar'`; a `NO_ENCONTRADO` accepted later moves stock once |
| 26a | RFCE answered `NO_ENCONTRADO` | row `RFCE_NO_ENCONTRADO` confirmed **before** reclaim | −1 (the reclaim tests the base state, `:420-425`) | 200 (pre-existing, section 14) | retry → same number → archived as `RFCE_NO_ENCONTRADO_ARCHIVADO` (`REINTENTABLES`, 4.6); no stock (`SIN_STOCK`) |
| 27 | Reclaim rollback mismatch (`ECFEmissionService.php:517`) | final | stays (logged) | as 26 | unchanged |
| 28 | `'confirmar'` returns false (another writer moved the row) | that writer's state | not touched | 200/422 from `$result` | log `CONFIRM_RACE` |
| 29 | `'confirmar'` throws (DB dropped after the answer) | `ENVIO_INCIERTO` with the projected `resultado_parcial` | +1 (reclaim skipped) | 502 incierto | R1: 10.2 with `resultado_parcial.track_id`; R2: `GET /estado` |
| 30 | `'confirmar'` throws **and** `'incierto'` fails (tenant DB down) | `PENDIENTE_ENVIO` | +1 | 502 incierto with `data.estado_dgii = 'PENDIENTE_ENVIO'` (`$marcado = false`) | The DGII answer survives in the `ENVIO_INCIERTO … track_id=…` log line, in `EcfEnvioInciertoException::$resultadoParcial` and in the master audit `new_values`. R1: 10.2; the row has no `resultado_parcial`, so take it from the master audit `EMIT success=0` `new_values` or the log line. R2: the 180 s rule, then `GET /estado`. |
| 31 | Crash between the DGII answer and `'confirmar'` | `PENDIENTE_ENVIO`, or `ENVIO_INCIERTO` through the shutdown registry | +1 | JSON 500 | R1: 10.2 (the DGII has it: first case, or the RFCE case). R2: the 180 s rule, then `GET /estado` (TrackIds or the RFCE consult), then `aplicarVeredicto`. |
| 32 | `registrarVenta` throws or moves 0 lines | final row intact | — | 200/422 | `error_log` (unchanged); never runs for a state in `SIN_STOCK` now |
| 33 | HTTP response lost (frontend 90 s `FE/src/api/http.ts:22`, proxy 504) | the row in its true state | per outcome | **"…revisa el filtro Pendientes…"** (9.1) | visible under `pendiente` while there is no verdict, otherwise under its final state |
| 34 | R2 CLI `--reenviar`: the re-send answered `RECHAZADO` + `secuenciaUtilizada = true` | stays `ENVIO_INCIERTO`, `duplicado_en_dgii = true` | +1 | support only: the CLI prints `accion:'duplicado_en_dgii'` and its `nota`; the app shows that `nota` on the next `GET /estado` (10.3 step 6) | support links the TrackId |
| 35 | R2 CLI `--reenviar` transport failure | `ENVIO_INCIERTO`, `intentos + 1` | +1 | support only: the CLI prints `'No se pudo verificar con la DGII. Inténtalo en unos minutos.'` | support retries later |
| 36 | R2 lookup unavailable (`certecf` 404, transport) | unchanged | — | 200 `accion:'lookup_no_disponible'` + a note that sends the user to support (10.3) | support: the CLI re-send with the duplicate guard (10.4) |
| 37 | Gastos emission (`gastoModel.php:316-352`) | unchanged (no hook) | unchanged | unchanged | section 14 |
| 38 | Integration master backup (`integracionEcfController.php:112-126`) | unchanged | n/a | unchanged | unchanged |

**Invariant:** no path burns a number without a row owning it, except these:

- the pre-existing rollback-mismatch hole (row 10, now audited);
- the pre-dispense loop (row 11, unchanged);
- process death inside the reserve transaction (row 16);
- a deploy that skips the 027 gate (6.2): each emission that collides with a number of another ambiente skips it;
- ambiente divergence (row 13, risk 6): the skipped number has no row in the dispensing ambiente.

## 6. Data model

### 6.1 No DDL; migrations 027 and 028 are a release gate

**No migration is needed.**

- `PENDIENTE_ENVIO` (15) and `ENVIO_INCIERTO` (14) fit in `VARCHAR(40)`.
- `uk_e_ncf_amb` exists (`tenant_schema.sql:245`) and `idx_estado_dgii` serves the new values (`:247`).
- `respuesta_dgii TEXT` (`:226`) holds the meta, which is guaranteed free of XML and capped.

**Release gate.** Before Release 1 is deployed, every tenant DB must show `APLICADA` for these two rows of
`tools/verificar_migraciones_tenant.sql`:

- `027` (`:133-137`): index `uk_e_ncf_amb`;
- `028` (`:139-146`): `facturas.estado_dgii` and `gastos.estado_dgii` ≥ 40.

- **Which 028.** The gate depends on the phpMyAdmin-safe 028 of `6609d91`, whose first statement is
  `SET @db := DATABASE();` (`028_estado_dgii_ancho.sql:68`). The `d7f5f34` version failed in phpMyAdmin with
  `#1109 Unknown table 'FACTURAS' in information_schema` (`:46-52`) and must not be used.
- **Which base.** The verifier's `base` column (`verificar_migraciones_tenant.sql:21-24`) must show the tenant's
  `db_name`. If it shows `information_schema` or any other base, its rows are not valid: select the tenant DB and
  run it again.

The list of tenant DBs comes from `tools/verificar_migraciones_master.sql:104`. Section 13 lists the steps, and 12.0
tests the gate itself.

**The COMMENT does not change.** The COMMENT of `estado_dgii` in `tenant_schema.sql:220` stays as it is, because
`check_estado_dgii_ancho.php:143-144` requires it to equal the one 028 writes. The new states are documented in
`docs/database/schema.md` and in `EstadosEcf`.

### 6.2 What happens if the gate is skipped anyway

| Deployed without | What breaks | Where | Counter | User sees | Document lost? |
|---|---|---|---|---|---|
| **028** (column still `VARCHAR(20)`), strict `sql_mode` | Archiving `RFCE_RECHAZADO` → `RFCE_RECHAZADO_ARCHIVADO` (24), `NO_ENCONTRADO` → `NO_ENCONTRADO_ARCHIVADO` (23) or `RFCE_NO_ENCONTRADO` → `RFCE_NO_ENCONTRADO_ARCHIVADO` (28) raises `PDOException` 22001 "Data too long" (1406) **inside the reserve**, pre-send. | row 15 | compensated (−1) | 502 generic. Every retry dispenses the same number and fails the same way until 028 runs: loud and blocking for that type. | **No**: the DGII was never contacted. |
| **028**, strict `sql_mode` | `confirmarFacturaECF` writing `RFCE_ACEPTADO_CONDICIONAL` (25) raises 22001 after the answer. | row 29 | +1 | 502 incierto | **No**: the row becomes `ENVIO_INCIERTO`, and `resultado_parcial.estado` keeps the real answer. |
| **028**, non-strict `sql_mode` | MySQL truncates with a warning (`RFCE_ACEPTADO_CONDIC`, `RFCE_RECHAZADO_ARCHI`, `NO_ENCONTRADO_ARCHIV`, and `RFCE_NO_ENCONTRADO_A` for the new archive). Step 1 of 028 counts the first three (`:71-87`), shown as `filas_truncadas_antes` in its final result (`:159`); the frontend maps the truncated literals to labels (9.1). | — | as normal | as normal | No |
| **027** (old global `uk_e_ncf`) | The reserve's per-ambiente `SELECT` misses a row of the same number in another ambiente. The INSERT hits a duplicate key (1062) → `EcfNumeroOcupadoException`, pre-send. | row 14 | stays +1 (the number is skipped: the pre-027 "saltos" symptom described at `027_e_ncf_unico_por_ambiente.sql:10-14`) | 502 `'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'`; the retry takes the next number | **No**: the incident of 2026-10-05 becomes "refused before send". |

Neither case loses a document. Both are loud: an `error_log` line per attempt and a 502 to the user.

### 6.3 `respuesta_dgii` while a row is in flight

Written by `reservarFacturaECF`:

```json
{"fase":"PENDIENTE_ENVIO","desde":"2026-10-05 14:03:11","flujo":"ECF","ambiente_secuencia":"ecf",
 "dispensado":true,"rango_id":7,"secuencia_valor":123}
```

Written by `marcarEnvioIncierto` (and, in Release 2, rewritten by `anotarEnvioIncierto`):

```json
{"fase":"ENVIO_INCIERTO","desde":"2026-10-05 14:03:11","flujo":"ECF","ambiente_secuencia":"ecf",
 "dispensado":true,"rango_id":7,"secuencia_valor":123,
 "fase_fallida":"envio","clase":"RuntimeException","error":"HTTP request failed: Operation timed out after 30001 milliseconds",
 "resultado_parcial":null,"intentos":0}
```

- **`resultado_parcial`.** When `fase_fallida` is `confirmar`, it has the `proyectarResultado` shape:
  `{estado, track_id, dgii_status_code, dgii_response, rfce_estado, rfce_track_id, rfce_status_code, secuencia_utilizada}`.
- **Release 2 keys:** `duplicado_en_dgii` (bool) and the `intentos` counter.
- **Confirmed rows.** `confirmarFacturaECF` replaces the whole value with the DGII answer, exactly as the INSERT did
  before. Readers use `metaEnvio()`.

## 7. API contract

### 7.1 `POST /api/facturas`

The request does not change.

| Case | HTTP | Body |
|---|---|---|
| Accepted / in process / sent, RFCE included | 200 | `{status:true, data:{factura_id, e_ncf, track_id, estado_dgii, codigo_seguridad, total, tipo_ecf, ambiente, fecha_emision_dgii, dgii_response}}` (same keys as today) |
| DGII rejection (`RECHAZADO`, `RFCE_RECHAZADO`, `NO_ENCONTRADO`, `ERROR`) | 422 | as today: the rejection text + `data` |
| `monto_total` missing or not numeric | 422 | `'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.'` |
| Pre-send failure | 502 | as today: `FACTURA_EMISION_FALLO_GENERICO` or the `EcfUsuarioException` text (number occupied included) |
| **Saved row, outcome unknown** | **502** | `{status:false, error:sprintf(FACTURA_EMISION_INCIERTA, e_ncf), data:{factura_id, e_ncf, tipo_ecf, estado_dgii:'ENVIO_INCIERTO'\|'PENDIENTE_ENVIO'}}`, with the text pinned in 4.7 and `e_ncf` taken from the row |
| Fatal error | 500 | as today (`ErrorHandler`, `error_id`, no `data`) |

Tools that read the POST still work on 200 and 422; on a 502 incierto they also see `data.factura_id`. Those
tools are the `send_fase*.php` scripts, `download_xmls.php` and `tools/check_fase2_status.php`, which takes
`factura_id` from the saved POST results (`:63`) and `data.estado_dgii` from `GET /estado` (`:83`, `:90`); for an
in-flight row it now gets the 7.3 200 instead of a 422.

### 7.2 `GET /api/facturas?estado=pendiente`

The filter accepts `pendiente`, which lists `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO`,
`RFCE_ENVIADO` and `RFCE_EN_PROCESO` (`EstadosEcf::SIN_VEREDICTO`, 4.6). The other values are unchanged. `GET /api/facturas/stats` keeps its shape; the money and sales series exclude
in-flight rows (section 8).

### 7.3 `GET /api/facturas/{id}/estado` for in-flight rows

The branch runs for `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, and `ENVIADO` with `track_id` NULL and an e-NCF. It never
answers 422 for a row that exists.

**Release 1** (no DGII call):

```json
{"status":true,"data":{"factura_id":41,"e_ncf":"E310000000123","tipo_ecf":"31","track_id":null,
 "estado_dgii":"ENVIO_INCIERTO","secuencia_utilizada":null,"en_vuelo":true,
 "nota":"La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número E310000000123."}}
```

- `nota` for `PENDIENTE_ENVIO`/`ENVIO_INCIERTO` (`en_vuelo: true`):
  `'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número E310000000123.'`
- `nota` for `ENVIADO` without `track_id` (`en_vuelo: false`):
  `'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número E310000000123.'`

**Release 2:** the same shape, computed by `EcfReconciliador::verificar()`, plus `accion` and `consulta?`.
`nota` follows 10.3. No response carries a `puede_reenviar` field, in either release (decision 7).

### 7.4 `POST /api/facturas/{id}/reenviar`: not implemented (decision 7)

The route keeps answering 501 as today (`handleReenviar`, `facturaController.php:795-798`) in both releases. The
user decided that the app never re-sends an e-CF after a failure: an unconfirmed invoice is resolved only by
support. The only re-send of the stored signed XML is the support CLI `tools/ecf_en_vuelo.php --reenviar`
(Release 2, 10.4), which goes through `EcfReconciliador::reenviar()` with the duplicate guard, the lock and the
ordering rules of 10.3.

## 8. Consumers of `estado_dgii`

| Consumer | With in-flight rows | Action (release) |
|---|---|---|
| `eNcfYaUsado` `ECFEmissionService.php:91-110` | occupied (correct) | the list becomes `EstadosEcf::REINTENTABLES`; the predicate and fail-open (`:106-109`) are unchanged; the reserve plus the unique key are the net (R1) |
| Archive check `facturaModel.php:1003-1028` | moved into `reservarFacturaECF`, pre-send | 4.6 (R1) |
| `updateECFEstado` `:1127-1149` | never reached by in-flight rows | none |
| List `getFacturasPaginated`/`Count` + `applyEstadoTipoFilters` `:925-936`, `normalizeEstadoFilter` `facturaController.php:1207-1223` | hidden under `aprobado`/`rechazado` | add `'pendiente'` = `SIN_VEREDICTO` (R1) |
| `getECFStats.resumen` `:1181-1188` | counted in `total_ecf` and `monto_total` | `monto_total` = `SUM(CASE WHEN estado_dgii IN (EN_VUELO) THEN 0 ELSE total END)`; `total_ecf` keeps counting rows (R1) |
| `por_tipo` `:1190-1201` | in `total` (row count) and in `monto_total`, which the frontend shows as money (`FE/src/features/ecf/EcfDashboardView.tsx:83`, `FE/src/features/dashboard/DashboardView.tsx:167`, `:256`) | `total` keeps counting rows; `monto_total` = `COALESCE(SUM(CASE WHEN estado_dgii IN (EN_VUELO) THEN 0 ELSE total END), 0)` (R1) |
| `por_estado` `:1203-1209` | new keys appear | the frontend builds its "Sin confirmar" KPI from them (R1) |
| `por_mes` `:1215-1224`; `ventas_por_mes`/`ventas_por_dia` `:1232-1256` | counted (`fecha_emision_dgii` and `date` are set at reserve) | `$notRechazado` (`:1215`) also excludes `EN_VUELO` (R1) |
| `ReporteVentasModel::fetchDocumentos` `:116-117` | counted as sales | `NOT IN (EN_VUELO)` (R1); `docs/modules/reporte-ventas.md` |
| `secuencias.total_emitidos` `:1274-1277` | counted | none ("filas en la base"); documented in `docs/api/facturas.md` |
| `ESTADOS_MODIFICABLES` `:1342`, `validarFacturaModificada` `facturaController.php:588-593` | excluded; its message "todavía no ha aceptado" fits | none |
| `sqlReferencia` `:1445` | an in-flight nota does not reduce saldo | add `EN_VUELO` (R1) |
| `getReferenciaOriginal` `:1401-1419` | found, then refused downstream | none |
| `Reporte607Model` `:70-71` | excluded (`LIKE '%ACEPTADO%'`) | none |
| `aprobacionComercialModel::findFacturaIdByENcf` `:41` | links to the row | none |
| `handleConsultarEstado` `:649-657` | 422 today | in-flight branch (R1 minimal, R2 full); guarded stock move on first acceptance (R1) |
| Consult rollbacks `:676-691`, `:755-770` | unaffected | none |
| Controller rejection list `:471-472` | an in-flight state is never returned as `$result['estado']` | none |
| Inventory `:433-454` | would move pre-send if misplaced | after confirm, gated on `EstadosEcf::SIN_STOCK` and `yaMovioDocumento` (R1) |
| PDF `:943`, `format=datos`, `EcfDocumento::timbre` `Utils/Pdf/EcfDocumento.php:822` | prints like any row; the QR resolves once the DGII has the e-CF | **none** (decision 4) |
| XML download `:910` | downloadable | none |
| Detail `GET ?id=` `:67-84` | full row and XML | none |
| `tools/restore_facturas_e31_28_29.sql:52` | its `NOT EXISTS` skips an in-flight row | none |
| `tools/consultar_ecf_dgii.php` | standalone | R2: requires `EcfConsultaDgii`; stays the support tool for rows that were never written |
| `tools/check_estado_dgii_ancho.php` | does not know the new states | R1: also reads `EstadosEcf::EN_VUELO` and checks each against the column width |
| Master `audit_logs` (`AuditLogModel.php:20-25`) | — | new rows: `EMIT success=0` (incierto, projected `new_values`) and `NCF_SEQUENCE_UPDATE success=0` (burn without a row) in R1; `STATUS_CHANGE` from `GET /estado` and the CLI in R2; the vocabulary is unchanged |
| Gastos (`gastoModel.php:382-408`, `inventoryModel.php:244-246`) | untouched | section 14 |

## 9. Frontend

### 9.1 Release 1

- **Types** (`FE/src/api/types.ts`):
  - `EstadoDgii` (`:24-34`) adds `'PENDIENTE_ENVIO' | 'ENVIO_INCIERTO'`.
  - `EstadoData` (`:208`) adds `en_vuelo?: boolean` and `nota?: string`. There is no `puede_reenviar` (decision 7).
  - `FacturaEstadoFiltro` (`:182`) adds `'pendiente'`, and so does `FacturaEstadoUi` (`FE/src/stores/facturasList.ts:6`).
  - The default filter stays `'aprobado'` (`facturasList.ts:26`).
- **Labels.** `DGII_LABEL`, `dgiiLabel` and `isRechazo` (`FE/src/api/mappers.ts:19-35`, `:46-48`) move to a new
  dependency-free module, `FE/src/api/estadosDgii.ts`; `mappers.ts` re-exports them. The reason: `mappers.ts`
  imports `@/…` aliases (`:3-4`), which a plain `node` script cannot resolve. New entries:

  | Raw state | Label |
  |---|---|
  | `PENDIENTE_ENVIO` | `'Por enviar'` |
  | `ENVIO_INCIERTO` | `'Sin confirmar'` |
  | `RFCE_ENVIADO`, `RFCE_EN_PROCESO` | `'En proceso'` |
  | `RFCE_ACEPTADO_CONDICIONAL`, `RFCE_ACEPTADO_CONDIC` | `'Aceptado'` |
  | `ERROR`, `RFCE_ERROR` | `'Error'` |
  | `NO_ENCONTRADO_ARCHIVADO`, `RFCE_RECHAZADO_ARCHIVADO`, `RFCE_NO_ENCONTRADO_ARCHIVADO`, `RFCE_RECHAZADO_ARCHI`, `NO_ENCONTRADO_ARCHIV`, `RFCE_NO_ENCONTRADO_A` | `'Rechazado'` |
  | `PENDIENTE` (legacy DDL default, 4.3) | `'Pendiente'` |

  The truncated literals are the ones a tenant that ran without strict mode can hold: 028 counts the first three
  (`filas_truncadas_antes`, 6.2), and `RFCE_NO_ENCONTRADO_A` could only appear after a deploy that skipped the
  gate. Also new: `isEnVuelo(raw)`.
- **Badge** (`FE/src/components/ui/Badge.tsx:20-27`): add `'Por enviar': 'warning'` and `'Sin confirmar': 'danger'`.
  `Error: 'danger'` already exists (`:26`).
- **`FE/src/api/errores.ts`:**
  - **Whitelist.** `RE_ESTADO_DGII` (`:153-154`) adds `PENDIENTE_ENVIO|ENVIO_INCIERTO`. Without that,
    `RE_CONSTANTE` (`:150`) would swallow any message that quotes them.
  - **New emission-only constant.** Add
    `MSG_TARDO_EMISION = 'El servidor tardó demasiado en responder. Puede que el comprobante sí se haya emitido: revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'`
    and use it instead of `MSG_TARDO_ESCRITURA` when `esEmisionEcf(ctx)` (`:255`) holds: in the 504 branch (`:303`)
    and in `networkError` (`:439`). `MSG_TARDO_ESCRITURA` (`:83-84`) is unchanged for every other write.
  - **Server-failure text.** The emission branch of `textoServidor` (`:276`) becomes
    `'No se pudo completar la emisión del e-CF. Revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'`.
- **List** (`FE/src/features/invoices/InvoiceListView.tsx`):
  - `ESTADO_OPCIONES` (`:13-17`) adds `{ value: 'pendiente', label: 'Pendientes' }`.
  - New KPI "Sin confirmar": the sum of the `por_estado` buckets `PENDIENTE_ENVIO` and `ENVIO_INCIERTO` (next to
    `:70-76`, rendered with the KPIs at `:104-108`).
  - "Monto total" (`:76`) needs no change, because the backend already excludes in-flight rows from
    `resumen.monto_total`.
  - When that count is above 0, the header shows a chip "`N` comprobante(s) sin confirmar · Ver" that sets the filter
    to `pendiente`.
- **Form** (`FE/src/features/invoices/InvoiceFormView.tsx:585-588`). In the `catch`, when
  `e instanceof ApiError && e.status === 502 && (e.datos as { factura_id?: number } | undefined)?.factura_id`:
  - invalidate `['facturas']`;
  - call `toast.error(e.message, { id: tid, duration: Infinity, action: { label: 'Ver factura', onClick: () => nav('factura-ver', f, { replace: true }) } })`
    from `sonner`. `f` is a `Factura` built like `created` (`:560-579`) from `datos` and the form: `estadoDgiiRaw`
    = `datos.estado_dgii`, `dgii` = its label, `trackId` and `codigoSeguridad` null;
  - **do not** call `setEmitting(false)`, so the form stays locked.

  Every other error keeps today's behavior.
- **Detail** (`FE/src/features/invoices/InvoiceDetailView.tsx`):
  - When `estado.data?.en_vuelo`, render a card above the band (`:213`): `'Este comprobante quedó reservado con el e-NCF {e_ncf}, pero la DGII no ha confirmado su recepción.'`
    followed by `estado.data.nota`.
  - Render `nota` alone when it comes without `en_vuelo` (the `ENVIADO` case without `track_id`).
  - The band also renders `estado.error`, which it swallows today (`:213-227`), as a muted line.
  - The footer (`:331-333`) becomes `'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF'`
    when `isEnVuelo(estadoRaw)`, and keeps today's text otherwise.
  - The print buttons "Ver PDF", "Imprimir recibo" and "XML firmado" (`:337-357`) are **unchanged** (decision 4).
- **`FE/scripts/check-errores.ts`** (new, run with `node scripts/check-errores.ts`): see 12.4.
- **Comments and mirrors.**
  - The comment in `FE/src/config/cache.ts:37-38` also names the in-flight states.
  - `FE/docs/database-structure.md:130-132` is updated: `uk_e_ncf_amb`, `varchar(40)` and the full state list.
  - `FE/src/db/schema.ts:111` is generated from a production dump by `scripts/gen-schema.ps1` ("AUTO-GENERATED -
    no editar a mano", `:1`) and is not hand-edited.
- **Other frontend consumers of `estado_dgii`:**

  | Consumer | With in-flight rows | Action (release) |
  |---|---|---|
  | `FE/src/features/ecf/EcfDashboardView.tsx:15-29` (KPIs) | "Total e-CF" counts them (`resumen.total_ecf`), but none of the buckets "Aceptados", "En proceso", "Rechazados" does, so the buckets no longer add up | add a fifth KPI "Sin confirmar": the sum of the `por_estado` buckets `PENDIENTE_ENVIO` and `ENVIO_INCIERTO`, selected with `isEnVuelo` (R1) |
  | `FE/src/features/ecf/EcfDashboardView.tsx:83` (per-type "Monto") and `FE/src/features/dashboard/DashboardView.tsx:167`, `:256` (per-type bar) | `por_tipo.monto_total` | none in the frontend; the backend excludes in-flight rows (section 8) |
  | `FE/src/features/ecf/EcfTypeView.tsx:19-21` ("Emitidos", "Monto total", `:38-39`) | counted | unchanged: they count every listed row, rejected and in-flight included (pre-existing) |
  | `FE/src/features/invoices/InvoiceFormView.tsx:559-578` (success toast, `estado: 'Emitida'`) | never: a 200 never carries an in-flight state (7.1) | unchanged |
  | `FE/src/features/invoices/InvoiceDetailView.tsx:79`, `:125` (`lineasImpresas`) | parses the stored XML like any row | unchanged (decision 4) |
  | `FE/src/features/dashboard/DashboardView.tsx:76`, `:307` (recent list) | without new labels it would show the raw codes | gets the new labels through `mapFacturaRow` (`FE/src/api/mappers.ts:67`) and `dgiiLabel`; no edit |
  | `FE/src/types/database.ts:88` (`estado_dgii: string`) | — | unchanged |
  | `FE/src/config/gastos.ts:61-82` (`gastoEstadoLabel`) | gastos only | out of scope (section 14) |

### 9.2 Release 2

- **API.** `EstadoData` adds `accion?` and `consulta?`. `FE/src/api/facturas.ts` gets no `reenviarFactura()`, and
  nothing in the frontend calls `POST /api/facturas/{id}/reenviar` (decision 7).
- **Detail.**
  - For an in-flight row, or `ENVIADO` without `track_id`, the band button "Actualizar" (`:224-226`) reads
    "Verificar en la DGII". It only consults the state at the DGII; it never sends the e-CF.
  - There is no "Reenviar a la DGII" button (decision 7). When the DGII has no record of the row, or the lookup is
    unavailable, the reconciler `nota` tells the user to contact support and not to emit the invoice again.
  - The card shows the reconciler `nota` (10.3) in place of the Release 1 minimal-branch `nota` (7.3).
- **Script.** `scripts/check-errores.ts` adds the Release 2 notes of `verificar` (10.3).

## 10. Recovery and reconciliation

### 10.1 Reusing a rejected number

**In the rejecting request**, step 10 writes `RECHAZADO` (row first), then step 11 decrements the counter (counter
second). A concurrent dispense between the two sees a retryable row and does not skip it.

**In the retry:**

1. `dispenseNextECF` returns the same number, and `eNcfYaUsado` returns false.
2. `'reservar'` locks the prior row, archives it (`e_ncf = NULL`, `<estado>_ARCHIVADO`, compare-and-set on the state
   it read) and inserts the new row in the same transaction, pre-send.
3. The archived row keeps its `factura_items` and `no_factura`, so the list search (`facturaModel.php:855`) shows
   both attempts. This is history, and it is documented.
4. Rejected rows no longer move stock, so the retry's movement is the first for that number.

### 10.2 Release 1: manual resolution by support

**Every state Release 1 can create has a reader:**

- the list, with the "Pendientes" filter and the "Sin confirmar" KPI;
- `GET /estado`, which answers 200 with a note;
- the occupancy checks.

**And one resolution:** a single guarded UPDATE that hands the row back to the **existing** consult path. That path
already applies the verdict, writes `STATUS_CHANGE`, reverts the counter on `RECHAZADO`/`NO_ENCONTRADO` with
`secuenciaUtilizada = false` (`facturaController.php:676-691`, `:755-770`), and with this change moves stock once on
acceptance.

The procedure goes into `API/docs/integrations/dgii-ecf.md`, after the recovery section at `:115-141`.

1. **List the rows** in the tenant DB:
   `SELECT id, e_ncf, tipo_ecf, estado_dgii, track_id, ambiente_dgii, codigo_seguridad, respuesta_dgii FROM facturas WHERE estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL AND e_ncf IS NOT NULL);`.
   Leave alone any row whose `respuesta_dgii.desde` is less than 5 minutes old: its request may still be running.
2. **Ask the DGII:**
   `php tools/consultar_ecf_dgii.php --tenant-id=:tenant --encf=:e_ncf` (or the web wrapper,
   `public/consultar_ecf_dgii.php`).
   - When `respuesta_dgii.fase_fallida = 'confirmar'`, the `resultado_parcial` already holds the DGII answer
     (`track_id`, `estado`).
3. **Apply exactly one case**, then open the factura in the app; `GET /estado` does the rest:

   | Case | SQL |
   |---|---|
   | e-CF flow, the DGII has a trackId T | `UPDATE facturas SET estado_dgii = 'ENVIADO', track_id = :T WHERE id = :id AND (estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO') OR (estado_dgii = 'ENVIADO' AND track_id IS NULL));` |
   | RFCE flow (`respuesta_dgii.flujo = 'RFCE'`) | `UPDATE facturas SET estado_dgii = 'RFCE_ENVIADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');`. The RFCE consult uses the stored `codigo_seguridad` (`facturaController.php:719-738`). |
   | The DGII has no record (`ecf`/`testecf`: no trackIds) | `UPDATE facturas SET estado_dgii = 'NO_ENCONTRADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');`, then, with `rango_id` and `secuencia_valor` from the meta read in step 1, `UPDATE ncf_sequences SET current_value = current_value - 1 WHERE id = :rango_id AND current_value = :secuencia_valor;`. Support then tells the user to emit again: when the decrement affected 1 row, the next emission of that type reuses this e-NCF and the reserve archives this row as `NO_ENCONTRADO_ARCHIVADO` (10.1); with 0 rows affected the number stays a gap, as today's "rollback sin coincidencia", and the next emission takes a new number. |
   | RFCE flow, and support already knows the DGII has no record of the RFCE (otherwise the hand-off above lets the RFCE consult decide) | `UPDATE facturas SET estado_dgii = 'RFCE_NO_ENCONTRADO' WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO','ENVIO_INCIERTO');`, then the same guarded `ncf_sequences` decrement as the case above. The retry archives the row as `RFCE_NO_ENCONTRADO_ARCHIVADO` (`REINTENTABLES`, 4.6). |
   | `certecf` (ConsultaTrackIds answers 404 there) | Use the DGII certification portal to decide between the cases above. A wrong call in `certecf` has no fiscal effect. Release 2 adds the support CLI re-send with the duplicate guard (`tools/ecf_en_vuelo.php --reenviar`, 10.4); the app never re-sends (decision 7). |

   No `DELETE`, ever.

### 10.3 Release 2: `EcfReconciliador`

New file `API/src/Utils/FacturacionElectronica/EcfReconciliador.php`, shared by the controller and the CLI. The
controller calls only `verificar` (`GET /estado`). `reenviar` has a single caller, `tools/ecf_en_vuelo.php --reenviar`
(10.4): the app never re-sends (decision 7).

```php
public function __construct(facturaModel $model, ?ECFEmissionService $service = null, ?inventoryModel $inventario = null, int $graciaSegundos = 180)
public function verificar(int $facturaId): array   // read-only against the DGII; may UPDATE our row (and revert the counter) when the DGII has a verdict
public function reenviar(int $facturaId): array    // CLI only (decision 7): verificar() first, then a re-send of the stored XML with the duplicate guard
// both return ['accion' => 'en_curso'|'trackids'|'consulta_rfce'|'reenvio'|'duplicado_en_dgii'|'sin_registro'|'lookup_no_disponible',
//              'estado_dgii', 'track_id', 'en_vuelo' => bool, 'nota' => string, 'consulta' => ?array]
private function aplicarVeredicto(array $ecf, array $meta, array $result): void
```

**`aplicarVeredicto`** is the single "row first, counter second, stock once" routine. `$meta` is captured by the
caller **before** any UPDATE.

1. `confirmarFacturaECF($id, $result, true)`.
2. `STATUS_CHANGE` audit.
3. When the state is in {`RECHAZADO`, `NO_ENCONTRADO`, `RFCE_RECHAZADO`, `RFCE_NO_ENCONTRADO`} and
   `secuencia_utilizada === false` (normalized with `EcfConsultaDgii::normalizarSecuenciaUtilizada`): call
   `rollbackECFSequence('E' . tipo_ecf, $meta['secuencia_valor'] ?? (int) substr(e_ncf, 3), $meta['ambiente_secuencia'] ?? ambiente_dgii, $meta['rango_id'] ?? null)`.
   Legacy rows without meta fall back to the type+ambiente filter, exactly as `facturaController.php:676-691` does. A
   mismatch is logged and the number stays consumed.
4. When the final state is outside `EstadosEcf::SIN_STOCK` and `!yaMovioDocumento('factura', $id)`, call
   `registrarVenta($id, getFacturaItems($id), tipo_ecf, user)`.

**`verificar($id)`**, triggered by `GET /estado` (the detail view mounts it, `InvoiceDetailView.tsx:100`), by
"Verificar en la DGII" and by the CLI:

0. `$ecf = getECFData($id)`. Capture `$meta = facturaModel::metaEnvio($ecf['respuesta_dgii'])` now; legacy string
   JSON gives `[]`.
1. **Young `PENDIENTE_ENVIO`.** When `$meta['desde']` is younger than 180 s (6× the 30 s DGII timeout; server time;
   a row without `desde` counts as old), return
   `{accion:'en_curso', en_vuelo:true, nota:'El envío a la DGII está en curso. Vuelve a verificar en unos minutos.'}`
   without calling the DGII. When it is older, call
   `marcarEnvioIncierto($id, $meta + ['fase_fallida' => 'huerfano', 'clase' => 'huerfano', 'error' => 'sin respuesta tras 180 s', 'resultado_parcial' => null])`,
   so the stored JSON keeps every 6.3 key (`rango_id`, `secuencia_valor`, `ambiente_secuencia`, `flujo`, `desde`),
   then write a `STATUS_CHANGE` audit row and continue.
2. **RFCE row** (`$meta['flujo'] === 'RFCE'` or `tiene_rfce`). Call
   `consultarEstadoRFCE(e_ncf, codigo_seguridad, ambiente_dgii)` (`ECFEmissionService.php:569-595`), then
   `EcfConsultaDgii::mapEstadoConsulta` (moved from `facturaController.php:1099-1128`, 4.8).
   - A verdict other than `NO_ENCONTRADO`: `aplicarVeredicto` with `estado = 'RFCE_' . X`, then
     `{accion:'consulta_rfce', en_vuelo:false}`.
   - `NO_ENCONTRADO` or no verdict:
     `{accion:'sin_registro', nota:'La DGII no tiene registro de este comprobante. Avisa a soporte con el número {e_ncf}: no lo emitas de nuevo.'}`.
3. **e-CF row with `ambiente_dgii` in {`ecf`, `testecf`}.** Call `consultarTrackIds(e_ncf, ambiente)`.
   - **At least one trackId:** take the newest by `fechaRecepcion` and call
     `consultarEstado(trackId, e_ncf, ambiente)` (`ECFEmissionService.php:534-560`). TrackIds gives the date only
     (`dd/MM/yyyy`, 4.8); when several trackIds share the newest date, call `consultarEstado` for each and take the
     one with the newest ConsultaResultado `fechaRecepcion`, which has the time. The state is
     `EcfConsultaDgii::mapEstadoConsulta($consulta)`, or `EcfConsultaDgii::mapEstado($elegido['estado'], null)`
     when that gives nothing (`$elegido` is the trackId entry chosen above). Then `aplicarVeredicto`, which includes the conditional revert, and
     `{accion:'trackids', en_vuelo:false}`.
   - **No trackIds** (a 404 ProblemDetails included):
     `{accion:'sin_registro', nota:'La DGII no tiene registro de este comprobante. Avisa a soporte con el número {e_ncf}: no lo emitas de nuevo.'}`.
4. **e-CF row in `certecf`:**
   `{accion:'lookup_no_disponible', nota:'En certificación la DGII no permite buscar este comprobante por número. Avisa a soporte con el número {e_ncf}: no lo emitas de nuevo.'}`.
5. **Any Throwable in 2–3:** `anotarEnvioIncierto(intentos + 1, error)`, then
   `{accion:'lookup_no_disponible', nota:'No se pudo verificar en la DGII en este momento. No lo emitas de nuevo; vuelve a verificar en unos minutos y, si sigue así, avisa a soporte con el número {e_ncf}.'}`.
   Never a dead end: the user can verify again, and support resolves the row with the CLI (10.4), whose re-send
   carries the duplicate guard. The app offers no re-send (decision 7).
6. **Row flagged `duplicado_en_dgii`:**
   `{accion:'duplicado_en_dgii', nota:'La DGII ya tiene este comprobante; soporte debe vincular el número de seguimiento.'}`.

In these notes `{e_ncf}` is the row's e-NCF, as in the 9.1 card text. No result carries a `puede_reenviar` key
(decision 7).

**`reenviar($id)`** (support CLI `tools/ecf_en_vuelo.php --reenviar` only; decision 7). Each refusal below is a text
the CLI prints before it exits with a non-zero code; no HTTP endpoint returns it:

1. **Allowed rows:** `ENVIO_INCIERTO`; `PENDIENTE_ENVIO` only when `desde` is older than 180 s (flipped to
   `ENVIO_INCIERTO` first, as in `verificar` step 1); `ENVIADO AND track_id IS NULL` for a non-RFCE row, flipped to
   `ENVIO_INCIERTO` first with the compare-and-set
   `marcarEnvioIncierto($id, $meta + ['fase_fallida' => 'reenvio', 'clase' => 'reenvio', 'error' => 'reenvio de un ENVIADO sin track_id', 'resultado_parcial' => null], true)`
   (4.6), so that the duplicate guard of step 4 can store its flag on it. Anything else is refused with
   `'Esta factura ya tiene respuesta de la DGII; consulta su estado.'`.
2. **Lock:** `SELECT GET_LOCK(CONCAT(DATABASE(), ':ecf_reenvio_', :id), 5)`, following the precedent at
   `facturaModel.php:563-583`. When the result is 0 or NULL, refuse with
   `'Ya hay un reenvío en curso para esta factura. Espera un momento.'`. Re-read `$ecf` and `$meta` under the lock,
   before any UPDATE, and read the stored XML with `getXmlFirmado($id)` (4.6). Release the lock in `finally`.
3. **`verificar($id)` first.** This makes a repeated or concurrent CLI run safe once the DGII has the e-CF: a
   resolved row is returned as is, with no re-send.
4. **Re-send:** `reenviarFirmado($xml['xml_firmado'] or $xml['rfce_xml'], ambiente_dgii, flujo)` (`$xml` from
   step 2), then:
   - **Duplicate guard (unconditional).** A state in {`RECHAZADO`, `RFCE_RECHAZADO`} with
     `secuencia_utilizada === true` means the DGII already holds the first send. Call
     `anotarEnvioIncierto({duplicado_en_dgii: true, respuesta: projected})`; the row stays `ENVIO_INCIERTO`. Write a
     `STATUS_CHANGE` audit row with the description "duplicado en DGII" and answer `accion:'duplicado_en_dgii'`.
     Such a row is never confirmed as `RECHAZADO` and never re-sent again.
   - **Otherwise** `aplicarVeredicto($ecf, $meta, $result)`, then `{accion:'reenvio', en_vuelo:false, estado_dgii, track_id}`.
   - **Transport failure:** `anotarEnvioIncierto(intentos + 1, error)`, then refuse with
     `'No se pudo verificar con la DGII. Inténtalo en unos minutos.'`.

### 10.4 Release 2: `tools/ecf_en_vuelo.php`

The CLI bootstraps like `tools/consultar_ecf_dgii.php:41-46` and resolves the tenant as `cecfEjecutar` does
(`:334`, tenant at `:382`).

```
php tools/ecf_en_vuelo.php --tenant=<id|rnc> [--ambiente=] --listar
                           | --verificar [--id=N] | --reenviar --id=N
                           | --marcar --id=N --estado=NO_ENCONTRADO [--forzar]
                           | --desde-audit=YYYY-MM-DD
```

- **`--listar`** prints `getEnVuelo`; it shows `legacy` when `metaEnvio` is empty.
- **`--verificar` / `--reenviar`** go through `EcfReconciliador`. `--reenviar` is the only way to re-send a stored
  XML (decision 7). Support runs it after `--verificar` found no record (`sin_registro`) or could not look the
  number up (`lookup_no_disponible`, `certecf` included).
- **`--marcar NO_ENCONTRADO`:**
  - It needs a lookup in the same run that found 0 trackIds (`ecf`/`testecf`), or `--forzar` (`certecf`).
  - It reads the meta first, marks the row, then calls `rollbackECFSequence` with the meta (conditional; legacy
    fallback without `rango_id`).
  - It writes `STATUS_CHANGE` and `NCF_SEQUENCE_UPDATE` audit rows.
- **`--desde-audit`** scans the master `audit_logs` for two kinds of rows:
  - `action = 'EMIT' AND success = 0` with `new_values.estado_dgii` in {`ENVIO_INCIERTO`, `PENDIENTE_ENVIO`};
  - `action = 'NCF_SEQUENCE_UPDATE' AND success = 0` (4.4 step 5).

  It cross-checks each e-NCF in the tenant's `facturas`. For numbers without a row it prints the
  `tools/consultar_ecf_dgii.php --encf=` command.

### 10.5 Writers and stock

**Writers that move an in-flight row:**

- the emitting request (`'confirmar'`, `'incierto'`, the shutdown registry);
- the manual hand-off of 10.2 (R1);
- `GET /estado` and `tools/ecf_en_vuelo.php` (R2); only the CLI re-sends (decision 7).

**Stock moves** at most once per factura id, after a DGII answer outside `EstadosEcf::SIN_STOCK`. The places are
the emitting request, `handleConsultarEstado[RFCE]` and the R2 reconciler; all of them check `yaMovioDocumento`
first. A rejection discovered later by the consult still does not reverse stock (unchanged). `docs/modules/inventario.md`
documents both: an e-CF moves stock only after a verdict outside `SIN_STOCK`, once per factura, and a later
rejection does not reverse it.

## 11. Releases

| Component | Release |
|---|---|
| `EstadosEcf` (constants: `REINTENTABLES` with `RFCE_NO_ENCONTRADO`, `EN_VUELO`, `SIN_VEREDICTO`, `SIN_STOCK`) | 1 |
| `ECFEmissionService::emitir($payload, ?callable $persistencia)`: integration guard; RFCE build+sign and CR/token pre-flights inside the try; `'reservar'` + no-open-transaction assertion; catch changes + `NCF_SEQUENCE_UPDATE success=0` audit; send try with `'confirmar'`/`'incierto'`; `CONFIRM_RACE`; static shutdown registry; `ctxSinXml`/`proyectarResultado`/`parseSecuenciaUtilizada`; `factura_id` in the returns; constructor injection | 1 |
| `DgiiReceptionService::assertSinCarriageReturn` → `public static` | 1 |
| `EcfNumeroOcupadoException`, `EcfEnvioInciertoException` (with `$marcado`) | 1 |
| `facturaModel`: `metaEnvio`, `reservarFacturaECF` (+ `normalizarNotaReferencia`; "occupied" only on 1062 or a second 1213), `confirmarFacturaECF` (`secuencia_utilizada` bound as int), `marcarEnvioIncierto`, `existeFactura`, `'pendiente'` filter, `sqlReferencia`, `getECFStats` exclusions (`resumen.monto_total`, `por_tipo.monto_total`, `por_mes`, `ventas_por_*`); `saveFacturaConECF` removed. Stock items come from the existing `getFacturaItems`. | 1 |
| `facturaController`: `FACTURA_EMISION_INCIERTA`; 422 `monto_total` guard; `$facturaInput` before `emitir`; closure; 502 incierto **with `data`** (e-NCF and state from the row) + audit; success path; inventory only when the state is outside `SIN_STOCK` and stock was not moved yet; minimal in-flight branch of `GET /estado`; first-acceptance stock move in `handleConsultarEstado[RFCE]`; `normalizeEstadoFilter('pendiente')` | 1 |
| `inventoryModel::yaMovioDocumento` | 1 |
| `ncfModel::dispenseNextECF` throws on `PDOException` | 1 |
| `ReporteVentasModel` exclusion | 1 |
| `tools/check_estado_dgii_ancho.php` reads `EstadosEcf::EN_VUELO` | 1 |
| Docs: deploy-order rule in `API/CLAUDE.md` and `docs/integrations/alta-tenant-runbook.md`; the 10.2 procedure in `docs/integrations/dgii-ecf.md`; `docs/api/facturas.md`, `docs/modules/auditoria.md`, `docs/database/schema.md`, `docs/modules/reporte-ventas.md`; `docs/modules/inventario.md` (an e-CF moves stock only after a verdict outside `SIN_STOCK`, once per factura); `docs/architecture.md:217` (the `ECFEmissionService` row becomes "build → firmar → reservar fila → enviar → confirmar; hook `$persistencia`"); `docs/modules/gastos.md:361` (reword the `saveFacturaConECF` mention); docblocks | 1 |
| Frontend: `EstadoDgii`/`EstadoData`/filter types; `estadosDgii.ts` labels (incl. RFCE/`ERROR`/archived/truncated/legacy `PENDIENTE`); Badge tones; `errores.ts` whitelist + `MSG_TARDO_EMISION` + `textoServidor`; "Pendientes" filter, KPI and chip; "Sin confirmar" KPI on the e-CF dashboard; 502 toast with "Ver factura" and the locked form; detail card (with the 7.3 `nota`), `estado.error`, footer; `scripts/check-errores.ts`; `cache.ts` comment; `docs/database-structure.md` | 1 |
| Tests: release-gate check (12.0), `tools/test_write_ahead_puro.php`, `tools/mock_dgii.php`, `tools/test_write_ahead_ecf.php`, `tools/test_reservar_confirmar.php`, `tests/test_facturas_write_ahead.http` (R1 scenarios), the first two bullets of the staging run (12.3.8: emission and forced failure) | 1 |
| `EcfConsultaDgii` (pure functions moved under the names of 4.8, plus `mapEstadoConsulta` and `normalizarSecuenciaUtilizada` from `facturaController`; the tool and the controller keep wrappers) | 2 |
| `DgiiReceptionService::consultarTrackIds`; `ECFEmissionService::consultarTrackIds`, `reenviarFirmado` (reached only through the CLI, decision 7) | 2 |
| `EcfReconciliador` (`verificar`, `reenviar`, `aplicarVeredicto`); `reenviar` has the CLI as its only caller | 2 |
| `facturaModel`: `confirmarFacturaECF(..., $desdeReconciliacion)`, `marcarEnvioIncierto(..., $desdeEnviadoSinTrack)`, `anotarEnvioIncierto`, `getEnVuelo`, `getXmlFirmado`, `getECFData` columns | 2 |
| Full in-flight branch of `GET /estado` with the 180 s orphan rule. `POST /api/facturas/{id}/reenviar` is not implemented and keeps answering 501 (7.4, decision 7). | 2 |
| `tools/ecf_en_vuelo.php` (its `--reenviar` is the only re-send) | 2 |
| Frontend: "Verificar en la DGII" and the reconciler `nota`. No "Reenviar a la DGII" button and no `reenviarFactura` (decision 7). | 2 |
| Docs: `docs/api/facturas.md` (the endpoint table at `:51` states that `POST /api/facturas/{id}/reenviar` answers 501 and is not planned, decision 7; the 7.3 shapes in the section at `:116`); `docs/integrations/dgii-ecf.md` (`tools/ecf_en_vuelo.php` becomes the first resort and its `--reenviar` the only re-send; the 10.2 SQL stays as the fallback); `docs/modules/auditoria.md` (`STATUS_CHANGE` from `GET /estado` and the CLI) | 2 |
| Tests: reconciler scenarios and `--conciliar` mode (12.3.6), `.http` checks that `POST /reenviar` still answers 501 plus the CLI re-send (12.3.7), the Release 2 bullets of the staging run with the real DGII (12.3.8) | 2 |

**Release 1 stands on its own:**

| State Release 1 can create | Reader | Resolution |
|---|---|---|
| `PENDIENTE_ENVIO` | list (Pendientes, KPI, chip); `GET /estado` 200 + note; occupied for `eNcfYaUsado` and the reserve | shutdown registry → `ENVIO_INCIERTO`; 10.2 |
| `ENVIO_INCIERTO` | same | 10.2 (with `resultado_parcial` when present) |
| `ENVIADO` + `track_id` NULL | `GET /estado` 200 + note (was 422); Pendientes | 10.2, first case |
| `RFCE_ENVIADO` (row 25, the 10.2 RFCE case) | Pendientes; the existing RFCE consult | the existing consult |
| `RFCE_NO_ENCONTRADO` (row 26a, 10.2) | list, under "Todos" (label "Pendiente", risk 11) | retryable (4.6): when the counter was reverted, the next emission reuses the number and archives the row; otherwise the number stays a gap |
| DGII states, `*_ARCHIVADO` | unchanged | unchanged |

Release 2 does not change any table or any Release 1 response shape. It only adds keys (`accion`, `consulta`) to
`GET /estado`; neither release has a `puede_reenviar` key (decision 7).

## 12. Testing

### 12.0 Release gate (run before the tests of either release)

1. On the scratch tenant and on the staging tenant, run `tools/verificar_migraciones_tenant.sql`. The `base` column
   must show that tenant's DB, and rows `027` and `028` must say `APLICADA`; otherwise stop.
2. **Negative gate check**, on a scratch copy: drop `uk_e_ncf_amb` and recreate the old `UNIQUE KEY uk_e_ncf (e_ncf)`,
   then set `facturas.estado_dgii` back to `VARCHAR(20)`. The checker must report `FALTA` for both rows.
3. **Without 027** (6.2), on that copy: seed a non-rejected `facturas` row with the next e-NCF and `ambiente_dgii`
   set to another ambiente. Emit through the scratch API with the mock in `acepta`. Expect a 502 with
   `'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'`, the counter +1, no new row, and no
   `Recepcion`/`RecepcionFC` request in the mock log.
4. **Without 028, strict** (6.2), on the same copy under `SET GLOBAL sql_mode = 'STRICT_ALL_TABLES'`: emit an
   E32 < 250k with the mock in `acepta_condicional`. Expect a 502 incierto, the row in `ENVIO_INCIERTO`, and
   `respuesta_dgii.resultado_parcial.estado = 'RFCE_ACEPTADO_CONDICIONAL'`.

The archive overflow at reserve time without 028 is tested at model level (12.3.4, last row).

### 12.1 Ground rules

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

### 12.2 Mock DGII (`tools/mock_dgii.php`)

- **Start:** `php -S 127.0.0.1:8099 tools/mock_dgii.php`.
- **Point the API at it:** `DGII_ECF_BASE_URL=http://127.0.0.1:8099` (`DgiiAuthService.php:164`),
  `DGII_FC_BASE_URL=http://127.0.0.1:8099` (`DgiiReceptionService.php:74`, `:186`) and `DGII_ECF_TIMEOUT=3`
  (`DgiiAuthService.php:165`).
- **Routes:**
  - the seed and seed validation (a token shaped as `normalizeTokenResponse` expects, `DgiiAuthService.php:503-514`);
  - `POST {env}/Recepcion/api/FacturasElectronicas` and `POST {env}/RecepcionFC/api/recepcion/ecf`;
  - `GET {env}/ConsultaResultado/api/Consultas/Estado`, `GET {env}/consultarfce/api/Consultas/Consulta` and
    `GET {env}/consultatrackids/api/TrackIds/Consulta`.
- **Behavior by `MOCK_DGII_MODE`:**

  | Mode | The mock answers |
  |---|---|
  | `acepta` | accepted |
  | `acepta_condicional` | accepted with conditions (`{codigo:4, estado:'Aceptado Condicional'}`) |
  | `rechaza` | `{codigo:2, estado:'Rechazado', secuenciaUtilizada:false}` |
  | `rechaza_usada` | rejected with `secuenciaUtilizada:true` |
  | `cuelga` | sleeps 10 s |
  | `html500` | a 200 KB HTML body |
  | `raw200` | a 2xx with a non-JSON body |
  | `trackids_vacio`, `trackids_uno`, `trackids_404` | TrackIds with none, one, or a 404 |
  | `trackids_rechazado` | TrackIds + Estado = Rechazado with `secuenciaUtilizada:false` |

  The seed and seed-validation routes always succeed; `MOCK_DGII_MODE` applies only to `Recepcion`, `RecepcionFC`
  and the three consult routes. With `DGII_ECF_BASE_URL` on the mock, authentication hits it too
  (`DgiiAuthService.php:26-31`, `:57-68`), and a failing seed would end the emission before the send with a generic
  502 and no `data.factura_id`.
- **Request log:** the mock logs every request, so tests can assert that reception was never hit.

### 12.3 Backend

**Release 1:**

1. **`tools/test_write_ahead_puro.php`** (DB-free, runs locally):
   - `ctxSinXml` removes both XML keys.
   - `proyectarResultado` keeps exactly its 8 keys and cuts a 200 KB string to 4000 characters.
   - `parseSecuenciaUtilizada` matches the old parsing for `true`, `false`, `"true"`, `"false"`, absent and
     `"abc"`.
   - `facturaModel::metaEnvio` returns `[]` for `null`, `'"Recibido"'` and `'{bad'`, and an array for the 6.3 JSON.
   - `EstadosEcf` lists have no duplicates, `EN_VUELO ⊂ SIN_VEREDICTO` and `REINTENTABLES ⊂ SIN_STOCK`.
   - The text of `FACTURA_EMISION_INCIERTA` in `facturaController.php` equals the one pinned in 4.7. The controller
     file is read as text, not required, because requiring it runs its router.
2. **`php tools/check_estado_dgii_ancho.php`** (extended) and **`php tools/test_consultar_ecf_dgii.php`** stay
   all-OK: today `30/30 OK` and `73/73 OK` on `db91ecf`; the checker's total grows by the new `EN_VUELO` checks.
3. **`tools/test_write_ahead_ecf.php --tenant-db=`** (the scratch tenant's DB name).
   - **Setup:** it builds `$payload`/`$facturaInput` like the controller and injects stubs through the new
     constructor: `FakeAuth` (fixed token and ambiente), `FakeReception` (canned answers or
     `RuntimeException('HTTP request failed: timeout')`) and `FakeNcf` (spy on the rollback). A spy hook records the
     order of the phases. `CertResolver::resolve()` is static and still runs (`ECFEmissionService.php:338-348`,
     `CertResolver.php:45-55`): `DGII_ECF_CERT_PATH`/`DGII_ECF_CERT_PASSWORD` point at a test `.p12`, or a
     `FakeSigner` is injected and those variables point at any readable file with a non-empty password. The scratch
     DB is seeded with `emisor_config` id=1 and an `ncf_sequences` range for each tested type.
   - **After each scenario it asserts:**
     - the delta of `ncf_sequences.current_value`;
     - rows by `e_ncf`, with `estado_dgii`, `track_id`, `xml_firmado IS NOT NULL` and `secuencia_utilizada`;
     - that `respuesta_dgii` decodes to an array, has `LENGTH < 65535` and contains no `signed_xml`, `rfce_xml` or
       `<`;
     - that `inventory_movements` stays empty: the service never moves stock, the controller does (12.3.5);
     - `!$pdo->inTransaction()`.
   - **Scenarios:**

     | Scenario | Expected |
     |---|---|
     | `acepta` | phases `[reservar, confirmar]`, `ACEPTADO`, counter +1 |
     | `rechaza` | `confirmar` before `rollbackECFSequence`; row `RECHAZADO`; counter back. A second run archives (`RECHAZADO_ARCHIVADO`, `e_ncf` NULL) and inserts. |
     | `cuelga`, `html500` | phases `[reservar, incierto]`, `ENVIO_INCIERTO`, counter kept; the exception is `EcfEnvioInciertoException` with `facturaId` and a `resultadoParcial` without XML |
     | `raw200` | `ENVIADO`, `track_id` NULL |
     | Hook throws a plain `RuntimeException` in `reservar` | counter restored, no row, reception not called |
     | Hook throws `EcfNumeroOcupadoException` | counter kept |
     | Hook throws in `confirmar` | `incierto` with `resultado_parcial.track_id`; `respuesta_dgii` under 64 KB |
     | Hook returns false in `confirmar` | `CONFIRM_RACE` logged, no reclaim |
     | CR injected into the signed XML | counter compensated, no row |
     | E32 < 250k | `flujo RFCE`, `rfce_xml` set at the reserve |
     | E32 < 250k, `FakeReception` answers `NO_ENCONTRADO` without `secuenciaUtilizada` | row `RFCE_NO_ENCONTRADO` confirmed before the rollback; counter back. A second run archives `RFCE_NO_ENCONTRADO_ARCHIVADO` (`e_ncf` NULL) and inserts. |
     | `FakeNcf::dispenseNextECF` throws `RuntimeException('ncf_sequences inaccesible: test')` | the same exception leaves `emitir()`; no row; reception not called |
     | `integration = true` + hook | `InvalidArgumentException` before any DGII call |
     | Hook leaves a transaction open with a committed row | `PENDIENTE_ENVIO`, counter kept, exception |
     | Hook returns without committing its own INSERT | no row, counter restored, exception |
     | Two service instances in one child `php` process, fatal after the second reserve | both rows `ENVIO_INCIERTO` with `fase_fallida = shutdown` |
     | `FakeNcf::rollbackECFSequence` returns false in the pre-send catch | one master `audit_logs` row `NCF_SEQUENCE_UPDATE success=0` with the e-NCF |
     | `integration = true`, no hook, mock in `cuelga` | the same `RuntimeException` class and text as before the change |

4. **`tools/test_reservar_confirmar.php`** (model level, scratch DB):

   | Scenario | Expected |
   |---|---|
   | Happy path | reserve, then confirm |
   | Second `confirmarFacturaECF` call | `false` |
   | `marcarEnvioIncierto` on a confirmed row | no change |
   | `marcarEnvioIncierto` with a ctx that still carries `signed_xml` | the stored JSON lacks it |
   | Prior `ACEPTADO` row, same number, same ambiente | `EcfNumeroOcupadoException`, nothing archived |
   | Same number in another ambiente | allowed |
   | Two processes reserving the same number | one gets "occupied" |
   | A forced deadlock (crossed `FOR UPDATE` pair, `innodb_lock_wait_timeout = 1`) | the 1213 path retries once, then yields "occupied" |
   | An item whose `product_id` no longer exists in `products` (FK 1452, `tenant_schema.sql:275`) | `PDOException` rethrown, not `EcfNumeroOcupadoException`; nothing committed |
   | `confirmarFacturaECF` with `secuencia_utilizada = false` under `SET SESSION sql_mode = 'STRICT_ALL_TABLES'` | `true`; the column stores 0 |
   | `ncfModel::dispenseNextECF` on a scratch copy where `ncf_sequences` was renamed | `RuntimeException('ncf_sequences inaccesible: …')` with the `PDOException` as previous, not `null` |
   | `SET SESSION sql_mode = 'STRICT_ALL_TABLES'` on a scratch copy with `estado_dgii` back at `VARCHAR(20)` and a prior `NO_ENCONTRADO` row | `PDOException` 22001, no row, nothing committed: the 6.2 claim |

5. **`tests/test_facturas_write_ahead.http`** (scratch API against the mock):
   - **Emission:** log in; `POST /api/facturas` for E31, E32 ≥ 250k and E32 < 250k with the mock in `cuelga` → 502
     with `data.factura_id` and the e-NCF in `error`.
   - **List:** `GET /api/facturas?estado=pendiente` lists that row **and** seeded `ENVIADO`/`EN_PROCESO` and
     `RFCE_ENVIADO` rows.
   - **State:** `GET /{id}/estado` → 200 with `en_vuelo: true` and `nota`.
   - **Print** (decision 4: same as today, no PREVIEW text): `GET /{id}/pdf?format=base64` → 200, a normal PDF.
     `GET /{id}/xml` → 200.
   - **Stats and reports:** with an in-flight row present, `GET /api/facturas/stats` → `resumen.monto_total`,
     `por_tipo[].monto_total`, `por_mes`, `ventas_por_mes` and `ventas_por_dia` exclude it, while `total_ecf` and
     `por_tipo[].total` count it; the ventas report backed by `ReporteVentasModel::fetchDocumentos` and the 607
     report exclude it too.
   - **Total guard:** `strict_input` with `totales` lacking `monto_total` → 422.
   - **Stock at emission:** (a) mock in `acepta`, `POST` an E31 → exactly one set of `inventory_movements` for that
     `factura_id`; (b) mock in `rechaza` → 0 movements, then a retry with the mock in `acepta` reuses the number,
     archives the first row and moves stock once, for the new id.
   - **Stock at consult:** seed an `ENVIO_INCIERTO` row with items and no `inventory_movements`; apply the 10.2
     first-case UPDATE with the mock's trackId; `GET /{id}/estado` with the mock's Estado = Aceptado gives
     `ACEPTADO` and one set of `inventory_movements`; a second `GET` moves nothing. Repeat with an RFCE row handed
     off to `RFCE_ENVIADO` and the mock's consultarfce answering Aceptado: `RFCE_ACEPTADO`, one set of movements, a
     second `GET` moves nothing.
   - **Saldo of an in-flight E34:** with an in-flight E34 (mock in `cuelga`) against an accepted E31, a second E34
     for the same original whose amount exceeds the remaining saldo → 422 from the saldo check
     (`facturaController.php:602`, `sqlReferencia`).
   - **Tenant DB unreachable at dispense:** on a scratch copy where `ncf_sequences` was renamed, `POST` an E31 →
     502 with `FACTURA_EMISION_FALLO_GENERICO`, not "Se acabaron…".

**Release 2:**

6. **`tools/test_write_ahead_ecf.php --conciliar`.** Seed rows with stored XML:
   - `PENDIENTE_ENVIO`, fresh and older than 180 s;
   - `ENVIO_INCIERTO` and `ENVIADO` + NULL, plus a second `ENVIADO` + NULL row that no call targets;
   - one legacy `ENVIADO` + NULL row whose `respuesta_dgii` is `'"Recibido"'`;
   - one RFCE `ENVIO_INCIERTO` row (`flujo RFCE`).

   After every call, the untargeted `ENVIADO` + NULL row is unchanged (the 4.6 Release 2 `WHERE` keeps its
   parentheses).

   | Mock mode | Expected |
   |---|---|
   | any, fresh `PENDIENTE_ENVIO` | `accion:'en_curso'`; no request in the mock log; row unchanged |
   | any, `PENDIENTE_ENVIO` older than 180 s | flipped to `ENVIO_INCIERTO` with `fase_fallida:'huerfano'`, the 6.3 meta keys kept, and one `STATUS_CHANGE` audit row; then handled as `ENVIO_INCIERTO` |
   | RFCE row, consultarfce Aceptado | `accion:'consulta_rfce'`, `RFCE_ACEPTADO`, stock moved once |
   | RFCE row, consultarfce without a record | `accion:'sin_registro'` with its support `nota` (10.3 step 2); no `puede_reenviar` key |
   | `trackids_vacio` | `sin_registro` with its support `nota`; no `puede_reenviar` key |
   | `trackids_uno` | `trackids`, row confirmed, stock moved once |
   | `trackids_rechazado` | row `RECHAZADO`; `rollbackECFSequence` called after the UPDATE with the meta's `rango_id`, counter −1. On the legacy row: called with `rango_id = null` and type+ambiente. |
   | `trackids_404` | `lookup_no_disponible` |
   | `reenviar` + `rechaza_usada` | `duplicado_en_dgii`, the row stays `ENVIO_INCIERTO` |
   | `reenviar` of the `ENVIADO` + NULL row + `rechaza_usada` | flipped to `ENVIO_INCIERTO` before the re-send, then `duplicado_en_dgii` stored; a second `reenviar` sends nothing |
   | `reenviar` + `rechaza` | `RECHAZADO`, counter −1, the spy gets `secuencia_valor` from the meta read before the UPDATE |
   | `reenviar` + `acepta` | confirmed, exactly one inventory row |
   | Two concurrent `reenviar` calls | one refused with `'Ya hay un reenvío en curso para esta factura. Espera un momento.'` |
   | `--marcar NO_ENCONTRADO` without a lookup in the same run | refused |

   `reenviar` is called on the reconciler directly, as `tools/ecf_en_vuelo.php --reenviar` does; no app endpoint
   reaches it (decision 7). `tools/test_consultar_ecf_dgii.php` still passes after the move to `EcfConsultaDgii`.
7. **`tests/test_facturas_write_ahead.http`** and the CLI:
   - **No re-send from the app** (decision 7): `POST /{id}/reenviar` on an in-flight row → 501, as today; the row is
     unchanged and the mock log has no `Recepcion`/`RecepcionFC` request. `GET /{id}/estado` with the mock in
     `trackids_vacio` → 200 `accion:'sin_registro'` with the support `nota` and no `puede_reenviar` key.
   - **Support re-send:** switch the mock to `acepta`, then `php tools/ecf_en_vuelo.php --tenant= --reenviar --id=`
     → `ACEPTADO`. Repeat → refused with `'Esta factura ya tiene respuesta de la DGII; consulta su estado.'`.
8. **Staging tenant (`certecf`, the real DGII):**
   - Emit E31, E32 on both sides of 250k, and an E34 for an accepted E31. Run before and after:
     `SELECT id, e_ncf, estado_dgii, track_id, secuencia_utilizada, ambiente_dgii, LENGTH(xml_firmado), LENGTH(respuesta_dgii) FROM facturas ORDER BY id DESC LIMIT 5`.
   - **Forced failure:** emit an E32 < 250k with `DGII_FC_BASE_URL=https://127.0.0.1:9`. Only RecepcionFC uses that
     base (`DgiiReceptionService.php:74`); authentication still reaches the real DGII through `DGII_ECF_BASE_URL`
     (`DgiiAuthService.php:164`), so the result is `ENVIO_INCIERTO` with `fase_fallida = envio`. Changing
     `DGII_ECF_BASE_URL` instead would break the seed requests inside the rollback-protected try
     (`DgiiAuthService.php:26-27`, `:59-60`; `ECFEmissionService.php:354-358`): no row, a generic 502. Restore the URL.
   - **Recovery** (Release 2): `GET /estado` → the RFCE branch of 10.3 step 2 (`sin_registro`, since the RFCE never
     arrived; `lookup_no_disponible` if the RFCE consult itself fails); then support runs
     `php tools/ecf_en_vuelo.php --tenant= --reenviar --id=` → a real answer with the stored RFCE XML (the app
     offers no re-send, decision 7). This also tests whether the DGII tolerates a re-sent `FechaHoraFirma`.
   - **Field names:** the TrackIds and ConsultaResultado field names were already observed in production on
     2026-10-05 with the `db91ecf` tool (`docs/integrations/dgii-ecf.md:122-124`, `:133-134`), and
     `tools/test_consultar_ecf_dgii.php` holds those real answers. Recheck read-only on a `testecf` tenant only if
     `EcfConsultaDgii::normalizarTrackIds` changes.
   - **CLI:** at the end, `php tools/ecf_en_vuelo.php --tenant=` (the staging tenant) `--listar` prints nothing, and
     `--desde-audit` shows the forced-failure EMIT row.

### 12.4 Frontend

- **Gates:** `npm run typecheck`, `npx eslint src scripts` and `npm run build`.
- **`node scripts/check-errores.ts`** (Node 22.18+ strips the types). It imports `../src/api/errores.ts`, which has
  no imports, and `../src/api/estadosDgii.ts`. It asserts:
  - `humanizar(sprintf(FACTURA_EMISION_INCIERTA, 'E310000000123'), 502, { metodo: 'POST', path: '/api/facturas' })`
    returns that text with `reemplazado: false`. The script holds the text verbatim, with a comment pointing to
    `facturaController.php`.
  - The same holds for `'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'` and for
    `'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.'` (422).
  - `clasificar()` returns `null` for both 7.3 notes, the 9.1 card text and footer, and, in Release 2, every `nota`
    of `verificar` (10.3). The refusal texts of `reenviar` are CLI output only (decision 7) and are not checked
    there.
  - `networkError(new DOMException('', 'TimeoutError'), { metodo: 'POST', path: '/api/facturas' }).message ===`
    the `MSG_TARDO_EMISION` text, while the same call with `path: '/api/clients'` still gives the old
    `MSG_TARDO_ESCRITURA` text.
  - `dgiiLabel()` returns a label, never the raw code, for every state in 4.3 (legacy `PENDIENTE` included), and for
    the truncated literals of 9.1.
- **Browser check against a local mock API only** (vite with `API_PROXY_TARGET` pointed at a small Node mock,
  never production):
  - the "Pendientes" filter, KPI and chip, and the "Sin confirmar" KPI of the e-CF dashboard;
  - the 502 toast with "Ver factura" and the locked form;
  - the detail card, the note, the footer, and the unchanged print buttons;
  - Release 2: "Verificar en la DGII" and its support notes, and no "Reenviar a la DGII" button on any row,
    whatever the state (decision 7).

## 13. Rollout

### 13.1 Release 1

1. **Release gate.**
   - Run `tools/verificar_migraciones_master.sql` and take the tenant `db_name` list from its last query (`:104`).
   - In **each** tenant DB, run `tools/verificar_migraciones_tenant.sql`. Check first that the `base` column shows
     the tenant's `db_name`; if it shows `information_schema`, the rows are not valid: select the tenant DB and run it
     again (`verificar_migraciones_tenant.sql:21-24`).
   - Rows `027` and `028` must say `APLICADA` in every tenant DB; that is the gate. Any other `FALTA` is reported to
     the user and fixed separately; it does not block this deploy.
   - Apply 027, or the phpMyAdmin-safe 028 of `6609d91` (first statement `SET @db := DATABASE();`, 6.1), where they
     show `FALTA` (both can be re-run: `verificar_migraciones_tenant.sql:13-15`).
   - For any tenant whose 028 result shows `filas_truncadas_antes` ≠ 0 (`028_estado_dgii_ancho.sql:159`), run
     `SELECT id, e_ncf, estado_dgii FROM facturas WHERE estado_dgii IN ('RFCE_ACEPTADO_CONDIC','RFCE_RECHAZADO_ARCHI','NO_ENCONTRADO_ARCHIV')`
     and report the rows to the user.
   - **Do not deploy** until every tenant shows `APLICADA` on 027 and 028.
2. **Baseline** per tenant, for later comparison:
   `SELECT estado_dgii, COUNT(*) FROM facturas WHERE tipo_ecf IS NOT NULL GROUP BY 1;` and
   `SELECT COUNT(*) FROM facturas WHERE estado_dgii = 'ENVIADO' AND track_id IS NULL;`.
   These legacy rows now show the 7.3 note instead of the 422.
3. **Staging first:** run the gate check of 12.0, then deploy the API, then the frontend, to a staging tenant and
   run 12.3.5 against the mock and the first two bullets of 12.3.8 (emission and forced failure) against the real
   DGII. Its Release 2 bullets (recovery, CLI) do not apply; the forced-failure row is resolved with 10.2.
4. **Production:**
   - **Deploy the API, then the frontend.** The old frontend against the new API works: it shows the 502 incierto
     text as a toast. The new frontend against the old API would get a 422 on `?estado=pendiente`.
   - **Smoke check (read-only):** after each tenant's first real emission, run
     `SELECT id, e_ncf, estado_dgii, track_id, xml_firmado IS NOT NULL FROM facturas ORDER BY id DESC LIMIT 1`,
     open that factura (`GET /estado` answers), and confirm the "Pendientes" filter is empty. No synthetic emission
     in production (decision 6).
5. **Watch** `error_log` for `ENVIO_INCIERTO`, `CONFIRM_RACE`, `fila reservada sin enviar`, `ocupado al reservar`
   and `rollback sin coincidencia`. Each in-flight row is resolved with 10.2.

**Rollback of Release 1.** The API can go back to the commit before Release 1 (`db91ecf` at the time of writing).

- The old `eNcfYaUsado` treats in-flight rows as occupied, which is correct.
- Its `GET /estado` answers 422 for them, and its list shows their raw codes.
- Resolve every in-flight row with 10.2 before or right after rolling back.
- Nothing in the data needs undoing.

### 13.2 Release 2

1. **Deploy the API, then the frontend.** No DDL; the gate of 13.1 still holds.
2. **Smoke on staging:** one forced transport failure, made as in 12.3.8 (an E32 < 250k with
   `DGII_FC_BASE_URL=https://127.0.0.1:9`, so authentication still works), then `GET /estado` from the app and
   `php tools/ecf_en_vuelo.php --tenant= --reenviar --id=` by support. Confirm that `POST /api/facturas/{id}/reenviar`
   still answers 501 and that the detail view has no "Reenviar a la DGII" button (decision 7).
3. **Production:** run `php tools/ecf_en_vuelo.php --tenant= --listar` once per tenant and resolve what it lists.

**Rollback of Release 2:** go back to the Release 1 build. The rows are the same, and 10.2 applies again.

### 13.3 Deploy-order rule (part of Release 1)

- **`API/CLAUDE.md`, "Critical facts"** (`:22-31`). New bullet: tenant migrations go first. Run every
  `db/migrations` file that a change depends on in **every** tenant DB, checked with
  `tools/verificar_migraciones_tenant.sql`, **before** deploying the code. 027 and 028 are the release gate of the
  e-CF write-ahead.
- **`docs/integrations/alta-tenant-runbook.md`.**
  - Fase 5 (`:150-166`) gets a step: run `tools/verificar_migraciones_tenant.sql` on the new DB; every row must say
    `APLICADA`.
  - The Troubleshooting table (`:195`) gets a row: "No se pudo asignar el número de comprobante" on every emission
    → 027 is missing on that DB.

## 14. Out of scope

- **Gastos write-ahead.** It comes in a later, separate change, and gastos keep the emit-then-persist loss class
  until then. The same closure pattern applies to `gastoModel::emitirGastoDgii` (`gastoModel.php:708-733`):
  - `'reservar'` → `persistGasto` with `PENDIENTE_ENVIO`, the XML and the meta. Its archive step
    (`:382-408`, `CONCAT` at `:406`) becomes the archive-on-retry.
  - `'confirmar'` → a new `confirmarGastoECF`; `'incierto'` → `marcarGastoIncierto`.
  - The `ERROR` catch (`:316-330`) applies only without a reserve.
  - `registrarCompra` (`inventoryModel.php:244-246`) also skips the in-flight states.

  Two things to settle first: `uk_proveedor_ncf (rnc_proveedor, ncf)` is global (`tenant_schema.sql:570`), and
  `rnc_proveedor` is NOT NULL (`:545`).
- **Integration tenants.** No tenant DB: the hook is absent and the master backup is unchanged.
- **Runtime schema checks**, a schema banner or clamping (decision 3).
- **Any change to the PDF, the receipt or their buttons** (decision 4).
- **An idempotency key on the emission payload.** It would stop a deliberate second emission after a 502 incierto.
- **Refusing a forwarded `ambiente` that differs from the active one** (`facturaController.php:349`).
- **Reversing stock** when a rejection is discovered later by the consult.
- **`RFCE_NO_ENCONTRADO`/`RFCE_ERROR` answering 200** (`facturaController.php:472`): pre-existing.
- **Automatic cleanup of legacy rows**: `RECHAZADO`/`ERROR` rows that moved stock, and `PENDIENTE` defaults.
- **The incident rows E340000000001 and E340000000002.** The tool (`d5cc063`, `db91ecf`) recovered their DGII state
  and track ids; E340000000001 (a full annulment of E440000000001, re-issued as E440000000002) is rebuilt by a
  one-off SQL script outside this spec. Recovering its `codigo_seguridad` by re-signing a rebuilt XML (the
  signature is deterministic) is also outside this spec.
- **Regenerating `FE/src/db/schema.ts`.**

## 15. Risks

1. **An in-flight row prints a fiscal-looking document** (decision 4, accepted). The PDF and receipt of a
   `PENDIENTE_ENVIO`/`ENVIO_INCIERTO` row carry the e-NCF, the `codigo_seguridad` and a live QR. The QR resolves at
   the DGII only once the DGII has the e-CF. If the send never arrived, a customer may hold a document the DGII does
   not know until the row is resolved.
2. **Someone deploys without 027 or 028.** No document is lost (6.2), but emissions fail loudly or skip numbers.
   Mitigated by the gate in 13.1 and the rule in 13.3.
3. **The manual phase.** Release 1 resolves in-flight rows by hand (10.2). Volume is expected to be low (transport
   failures). The "Sin confirmar" KPI and the log lines make each one visible.
4. **ConsultaTrackIds (R2).** The route and the normalization come from the `d5cc063`/`db91ecf` tool and are
   unit-tested; TrackIds and ConsultaResultado answered in production on 2026-10-05
   (`docs/integrations/dgii-ecf.md:133-134`). By DGII design they answer 404 in `certecf`
   (`tools/consultar_ecf_dgii.php:24-26`), so certifying tenants recover only through support: the CLI re-send and
   its duplicate guard (10.4), or the certification portal (10.2). The app never re-sends (decision 7). TrackIds
   gives `fechaRecepcion` without the time (`dgii-ecf.md:122`), so "newest" falls back to ConsultaResultado when two
   trackIds share a date (10.3 step 3).
5. **Re-sending a stored XML later (R2, support CLI only, decision 7).** The DGII may reject on `FechaHoraFirma`
   plausibility. A rejection with `secuenciaUtilizada = false` frees the number correctly, but the user must emit
   again; correcting and emitting again after a DGII rejection stays allowed. Only support can trigger the re-send.
6. **Ambiente divergence.** `$ambienteEarly` (`ECFEmissionService.php:186`) can differ from the token ambiente
   (`:372`): through the forwarded `input.ambiente` (`facturaController.php:349`), or with nothing configured
   (`certecf` dispense vs `DgiiAuthService.php:10` `testecf`). The reserve logs it, and an "occupied" result costs
   one retry.
7. **The occupied path keeps the counter advanced** (rows 13–14). That is correct, because a row owns the number. The
   remaining burns without a row are those of the section 5 invariant: rows 10, 11 and 16, a deploy that skips the
   027 gate, and ambiente divergence.
8. **The shutdown registry needs PDO to still work after a fatal.** Otherwise the row stays `PENDIENTE_ENVIO`
   (Release 1: 10.2; Release 2: the 180 s rule).
   - The 180 s grace is an estimate (6× the DGII timeout). A slower original request would race the reconciler; the
     compare-and-set makes the outcome consistent (one `CONFIRM_RACE` line).
9. **Double emission after a 502 incierto** stays possible by deliberate action: the user leaves the locked form and
   emits again with a new number. The UX makes the first row visible. The app offers no re-send of that row
   (decision 7): its notes say not to emit it again and to contact support, who resolves it with the CLI.
10. **`dispenseNextECF` now throws.** On a DB outage, gastos get a generic error instead of the misleading "Se
    acabaron los números". The only caller is the service (grep).
11. **`'pendiente'` means "sin veredicto de la DGII"**: `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`,
    `EN_PROCESO`, `RFCE_ENVIADO` and `RFCE_EN_PROCESO`. The "Sin confirmar" KPI and chip count in-flight rows only.
    Rows labeled "Pendiente" (`NO_ENCONTRADO`, `RFCE_NO_ENCONTRADO`, legacy `PENDIENTE`; `FE/src/api/mappers.ts:28-29`)
    are not listed by the "Pendientes" filter. Confirm both points, and the label "Pendientes", with the product
    owner.
12. **`ERROR` rows stay burned**, and `RFCE_NO_ENCONTRADO`/`RFCE_ERROR` still answer 200. Both are pre-existing and
    documented.
13. **Legacy rows are not migrated** (`ENVIADO` + NULL with string JSON; `RECHAZADO`/`ERROR` with stock moved).
    `metaEnvio` tolerates them, and the Release 2 reconciler falls back to the type+ambiente revert.
14. **Unknown server settings.** The production `sql_mode` and isolation level were not observable from the code.
    6.2 covers both `sql_mode` cases, and the reserve handles both a duplicate key (1062) and a deadlock (1213).
15. **Server time zone.** Observed on 2026-10-05: the production server (PHP and MySQL) runs at UTC-5, one hour
    behind the DGII (UTC-4). E440000000001 has `fecha_emision_dgii` 14:31:54 and the DGII received it at 15:31:55;
    audit row 1133 says 09:10:38 for a DGII reception at 10:10:38. `FechaHoraFirma`, `desde` and the 180 s rule
    all use server time, so they stay consistent with each other. The DGII has accepted these signing times so far.
    Changing the server time zone is out of scope, but it affects how support reads times next to the DGII portal
    (10.2).

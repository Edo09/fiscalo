# POS y «Reenviar a la DGII» sobre el write-ahead: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Release 1 of the e-CF write-ahead with the latest `master`/`main`. Every factura, including POS sales and the reissue of a rejected one, is saved before it is sent to the DGII. A POS sale never stops for the DGII, the certificate or the sequence.

**Architecture:**
- **Merges.** Merge `origin/master` into the API branch and `origin/main` into the FE branch, following the binding resolution rules in Task 1 and Task 2.
- **POS sale.** `PosVenta::emitirEnTurno` uses the same write-ahead hook as the app (`reservar` / `confirmar` / `incierto`).
  - Every outcome after the reserve is delivered through one idempotent `entregarVenta`.
  - A failure before the reserve, or an expired certificate, falls back to a factura simple.
  - An exhausted sequence takes the next number and waits, unsent, until a registered range covers it.
- **POS resend.** The existing automatic resend chooses the flow by the stored XML and writes with compare-and-set. It skips live sales and sales that have no range yet.
- **Reenviar a la DGII.** Master's rejected-invoice reissue (`4007eea`) goes through the write-ahead emission with the same e-NCF.
- **Admin alerts.** Shown in the app only.
- **POS front.** Stripped of DGII wording.
- **POS tests.** The POS suites run on the existing scratch DBs.

**Tech Stack:**
- PHP 8.3 in production (8.5.8 locally; no 8.4+ syntax), no Composer, `require_once`.
- PDO MySQL (Percona 8.0.46).
- React 18 + TypeScript + Vite, TanStack Query, sonner.
- Node v25 for `scripts/*.ts`.

**Spec:** `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead/docs/superpowers/specs/2026-10-12-pos-y-reenvio-sobre-write-ahead-design.md`. Background: the Release 1 spec `2026-10-05-ecf-write-ahead-design.md` and plan `docs/superpowers/plans/2026-10-05-ecf-write-ahead-release-1.md`.

**Worktrees:**
- API: `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`, branch `feat/ecf-write-ahead`, at `c3dacd8`. Never touch its untracked `tools/reconstruir_e340000000001.sql`.
- FE: `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`, branch `feat/ecf-write-ahead`.

**How this plan was produced:**
- Seven drafters each wrote a task group.
- A verifier checked every anchor and signature of each group against the real code and fixed it.
- A whole-plan critic then reviewed it; its full report is in `.superpowers/sdd/2026-10-05-ecf-write-ahead-release-1/plan-pos-critique.md`.
- The critic's findings are folded into **Binding corrections** below. They override the task text wherever the two disagree.
- The verifiers' per-group notes are in `plan-pos-verifier-notes.md` in the same folder.

## Global Constraints

- Every factura row is saved (reserved) BEFORE any DGII send. No code path saves after sending. `facturaModel::saveFacturaConECF` stays deleted.
- POS:
  - A sale never stops for the DGII, the certificate or the sequence.
  - The cashier never sees DGII wording.
  - The receipt prints like a normal invoice.
  - Only cart validations (4xx) and an unavailable server or DB stop a sale.
- App invoices keep Release 1 behaviour: token before the reserve, synchronous send, unconfirmed rows go to support. There is no app auto-retry, no cron, no async sending and no new migration.
- A POS e-NCF never returns to the counter.
- «Reenviar a la DGII» reissues only rejected rows, with the SAME e-NCF (`e_ncf` override). Unconfirmed rows are never resent from the app (409).
- `src/Models/facturaModel.php` ends with LF line endings.
- Tests:
  - They run only on `smhynzte_wa_scratch` / `smhynzte_wa_scratch_sin_gate`. Never on `smhynzte_wa_sin_marca`, `smhynzte_conduces_scratch` or production.
  - DB suites run strictly serially.
  - Never print `tools/.env`, credentials or hostnames.
- FE: never run vite / `npm run dev`, because the `.env` proxies to production.
- Commits:
  - Spanish conventional messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - No push, no merge to `master`/`main`, and nothing on staging or production without the user's explicit yes.

## Review Focus

- **RF1:** two requests with the same clave while the first is still waiting on the DGII. Expect exactly one e-NCF, one cash movement and one stock move (Task 5 RF1, Task 14 §1).
- **RF2:** the server dies between `confirmar` and the cash movement. The retry with the same clave writes the missing cash movement exactly once (Task 5 RF2/RF2b, Task 14 §2).
- **RF3:** the resend runs while the original sale is still mid-send (`PENDIENTE_ENVIO` younger than 2 min). It is skipped and nothing is sent twice (Task 8 P3, Task 14 §3).
- **RF4:** the certificate fails mid-shift, then recovers.
  - Fallback sales are factura simple with their idempotency.
  - Later sales are e-CF again.
  - The alert counts only today's fallback sales.

  Tests: Task 6 S1, Task 10 AV2, Task 14 §4.
- **RF5:** E32 is exhausted while E31 still has a range.
  - Only E32 sales go `sin_rango`.
  - Registering a covering E32 range through `POST /api/ncf/rangos` lets the next resend send them.
  - `dispenseNextECF` never hands out a number already used.

  Tests: Task 4 P3/N7/N8, Task 7 S7, Task 8 P4/P5, Task 14 §5.

## Binding corrections (from the whole-plan review; apply in the owning task)

### Decisions taken while assembling the plan (2026-10-12)

**D-A. Migration 030 is mandatory on every tenant** (critique item 6, option A).
- After Task 3, the app's confirm and incierto UPDATEs reference `pos_idempotency_key` / `envio_pendiente`.
- Production's two tenants already have 012-031 applied (verified read-only on 2026-10-08).
- Task 15 changes `CLAUDE.md` from "027 and 028" to "027, 028 and 030", makes the runbook say 030 is mandatory on every tenant, and extends the puro pin.
- Task 3 deletes the docblock claim "un tenant sin la 030 sigue andando".
- Task 16's report mentions 030.

**D-B. An expired certificate falls back to factura simple** (critique item 7).
- Task 6 adds a payload option `validar_vigencia_certificado` (set only by `PosVenta`). Before the reserve, `ECFEmissionService::emitir` reads the cert with `openssl_pkcs12_read`. If `openssl_x509_parse(...)['validTo_time_t'] < time()`, it throws `EcfUsuarioException`, which is the pre-reserve path, so the sale becomes a factura simple.
- Add scenario S2b to `tools/test_pos_continuidad.php` with a generated expired `.p12`.

**D-C. Task 11 removes the POS supervisor band «La DGII rechazó una venta…»** (critique item 27), following the user's rule that the POS shows nothing about the DGII.
- Task 15's `docs/specs/pos.md` replacement drops the `- [ ]` item that promised that alert in the POS. Rejections surface only in the app.

**D-D. POS rows that end in `ERROR` / `NO_ENCONTRADO` keep `envio_pendiente = 0`** (critique item 16).
- `NO_ENCONTRADO` is reissued with «Reenviar a la DGII». `ERROR` is support's.
- Task 15 records this in `docs/integrations/pos-write-ahead.md`.

### Fixes the executor applies

1. **Task 6, `ventaComoFacturaSimple`: one audit, through `entregarVenta`.**
   - Call:
     ```php
     self::entregarVenta($pos, $facturaId, $facturas->getFacturaItems($facturaId), null, $userId, $cobro, [
         'accion' => 'POS_VENTA_FACTURA_SIMPLE',
         'entidad' => $numero,
         'valores' => $auditBase + ['factura_id' => $facturaId, 'tipo_ecf_pedido' => $tipoEcfPedido, 'causa' => get_class($causa)],
         'descripcion' => 'La venta del POS salió como factura simple: no se pudo generar el comprobante electrónico.',
     ]);
     ```
   - Delete the separate `self::audit('POS_VENTA_FACTURA_SIMPLE', …)` call and the "Contract of `$cobro` and `$auditCtx`" bullet.
2. **Task 6 Step 5 is written against Task 5's code, not master's.**
   - (b) Replace `self::servicioEmision()->emitir($payload, $persistencia);` with `self::emitirConReintento(self::servicioEmision(), $payload, $persistencia);`.
   - (c) Replace Task 5's whole `if ($fila === null) { … throw new PosError(…, 502, 'EMISION_FALLIDA'); }` block with:
     ```php
     return self::ventaComoFacturaSimple($pos, $empleado, $turno, $clave, $ancho, $userId, $cliente, $tipoEcf, $items, $cobro, $auditBase, $fallo ?? new RuntimeException('la emision termino sin guardar la venta'));
     ```
   - Rename the `$pago` parameter to `$cobro`, the array from `leerCobro`. Drop the `$cobro + [...]` merge, and never use the removed locals `$recibidoCentavos` / `$devueltaCentavos`.
   - Remove every "if Task 5 reflowed / find with grep" hedge.
   - Task 6 Step 6: the `ventaPorClave` SELECT is exactly `SELECT id, e_ncf, no_factura, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, user_id, respuesta_dgii, rfce_respuesta`.
3. **One file name per test suite.**
   - Task 5's in-process suite is `tools/test_pos_cobrar_wa.php`. Rename it in Task 5's Files, Steps 2-3, 7, 8, the commit and the Interfaces list.
   - `tools/test_pos_write_ahead.php` stays Task 14's HTTP suite.
   - Task 6 adds a step that rewrites S7 of `test_pos_cobrar_wa.php`, because certificate missing is now 201 with a factura simple, not 502 `EMISION_FALLIDA`.
4. **`docs/specs/pos.md` is edited only in Task 1 (Step 8) and Task 15.**
   - Task 5 Step 6 drops its `docs/specs/pos.md` entry and keeps only the optional `facturaModel` one; its expected hits are "none".
   - Task 15's first marker line becomes `e-CF, factura + movimiento de caja en una transacción (así salió el 10-08; el write-ahead lo reemplazó, ver \`docs/integrations/pos-write-ahead.md\`;`. Delete its sentence "the edit … removes that last mention".
5. **The 501 guard is rewritten only in Task 1 Step 9.**
   - Task 9 Step 1(a) keeps only the `puede_reenviar` relabel.
   - Task 9's new section adds the check `!preg_match('/respond\(false, [^\n]*, 501\)/', $t9Ctl)`.
   - Recompute Task 9's "+N" in Step 6.
6. **`registerRange` is Task 4's, and it is resolved.**
   - Delete the "Open dependency" callout in Task 8, the "Gap flagged" text in Task 14, and Task 16 Step 7 item (5).
   - Task 14 §5 registers the covering range through `POST /api/ncf/rangos` (admin Bearer, body `{"type":"E32","numero_desde":H+1,"numero_hasta":H+100,"fecha_vencimiento":"<hoy+1 año>"}`), not with an INSERT. Task 8 P4 may keep its INSERT.
   - Task 15 updates the "Validaciones" paragraph of `POST /api/ncf/rangos` in `docs/api/facturas.md`: `numero_desde` no longer has to exceed every used number.
7. **Test totals are relative.**
   - Replace every absolute "N de N" in Tasks 3, 4, 9 and 10 with "total before this task + k".
   - Reference points: after Task 1, puro 209 and ecf 253. After Task 3, puro 225. After Task 4, ecf 302.
   - Section labels must be unique per file: Task 1 = `14)` in puro and `4)` in ecf, Task 3 = `15)`, Task 4 = `5)` in ecf, Task 15 = `16)`.
8. **A factura simple's `venta.tipo_ecf` is `null` in both answers** (Task 6 fresh answer and Task 5 `respuestaDeVentaExistente`). Task 6 S1 «B repetida» adds `tipo_ecf === null`.
9. **Task 8 uses `self::servicioEmision()`,** not `new ECFEmissionService()`, in `reenviarPendientes`.
10. **Task 16's DGII-wording grep** over `src/pos` adds `--exclude=reporteCierre.ts`, which is shared with `app.*` and left on purpose by Task 11. The "four strings need a decision" list shrinks to the `reporteCierre.ts` headings.
11. **Task 16 Step 4 also runs the in-process POS suites,** serially, with `--tenant-db=wa_scratch`: `tools/test_pos_cobrar_wa.php`, `tools/test_pos_continuidad.php` and `tools/test_pos_reenvio.php`. They are added to the report list.
12. **A reissued rejected POS sale.**
    - Task 14 Step 6 changes `PosCierre::reporte` so that `_ARCHIVADO` states are neither `pendientes` nor `rechazadas` but still count as a sale.
    - Task 14 §6/§7 assert that `rechazadas` is empty after the reissue and that a repeat of the original clave returns 201 `repetida`.
    - Re-derive Task 14 Step 7's expected totals after this change.
13. **No conditional hedges.**
    - Task 9 Step 0: `$reenvioDe` only adds `reenvio_de` (Task 1); there are no other `if ($reenvioDe !== null)` blocks to delete.
    - Task 14 Step 1: list the exact failing checks instead of "most likely".
    - Task 14 Step 3: stop on any check other than the two named ones; if one fails, the owning task is wrong, not the expectation.
14. **Additions beyond the spec text, kept and recorded:**
    - Task 4 applies `dgii_timeout` to the token request too, and makes `registerRange` accept a range that starts inside numbers already used `sin_rango`.
    - Task 9 adds `vencimientoDeLaSecuencia` / `fecha_vencimiento_secuencia`, so a reissue does not repeat a code-145 rejection.
    - Task 13 adds `--enforce`, `--suites`, `--solo-preparar` and a second API on 8297 (needed for RF1/RF3).
    - Task 3 throws `InvalidArgumentException` for a `pos_idempotency_key` over 36 characters.

---

### Task 1: Merge de origin/master en la rama del API

Run every command from the API worktree root, in Git Bash: `cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`. Every edit is anchored on quoted text, never on line numbers, because the merged files shift. Never print or `cat` `tools/.env`. No Review Focus line (RF1-RF5) belongs to Tasks 1-2.

This task merges `origin/master` (`c594c10`, 10 commits past the merge base `dfc7289`, 42 files) into `feat/ecf-write-ahead` (`c3dacd8`). It follows the merge resolution rules of the plan. Git reports exactly four conflicted files:
- `src/Models/facturaModel.php` conflicts as a whole file. Our side is stored CRLF and master's is LF since `ee89b6d`. The fix is a three-way merge over a base normalised to LF.
- `src/Utils/FacturacionElectronica/ECFEmissionService.php`, 3 hunks.
- `src/Controllers/facturaController.php`, 2 hunks.
- `src/Models/inventoryModel.php`, 1 hunk.

Everything else from master merges cleanly and stays as master wrote it.

**Files:**
- Merge: all of `origin/master`. Resolve the four conflicted files above.
- Arrive from master with nothing to resolve, do not edit:
  - `src/Pos/PosVenta.php`, `PosCierre.php`, `PosCliente.php`, `PosAutorizacion.php`, `PosPin.php`
  - `src/Controllers/posController.php`, `posAdminController.php`, `src/Models/posModel.php`, `posMasterModel.php`
  - category and product controllers and models, `src/Utils/ProductImageStorage.php`
  - `db/migrations/032_producto_imagen.sql`, `033_facturas_dias_credito.sql`, `034_categorias_color.sql`, `db/tenant_schema.sql`, `tools/verificar_migraciones_tenant.sql`
  - `tools/mock_dgii_local.php`, `tools/test_pos_backend.php`, `tools/test_pos_venta.php`, `tools/test_pos_e31.php`, `tools/test_pos_cierre.php`, `tools/test_producto_imagen.php`
  - the docs
- Modify after the merge:
  - `src/Models/facturaModel.php`. Anchor: `reuso su e-NCF, saveFacturaConECF ya lo archivo y esto no hace nada.`
  - `src/Utils/FacturacionElectronica/ECFEmissionService.php`. Anchors: `// Envio. Desde aqui la DGII puede tener el e-CF: ningun fallo devuelve el`, `$rfceReception = $this->reception->recibirResumen($signedRfce, $bearerToken, [`, `$reception = $this->reception->recibir($signedXml, $bearerToken, [`.
  - `docs/specs/pos.md`. Anchor: ``en una transacción (`saveFacturaConECF` con gancho;``.
- Create: `tools/aplicar_migracion_scratch.php`. It applies migrations to the scratch DBs through `wa_pdo`, one statement at a time, and checks them with the verifier. Task 16 reuses it if master moves again.
- Test:
  - `tools/test_write_ahead_puro.php`: new section 14. Anchors for the two sections it adapts: `$s11Emision = preg_match('/\nfunction handleEmisionECF\(`, `wa_chk('POST /reenviar sigue respondiendo 501 (decision 7)',`.
  - `tools/test_write_ahead_ecf.php`: new section 4 and `FakeReception::$opciones`. Anchors: `public array $llamadas = [];`, `// Cierre. Cada tarea agrega sus casos justo encima de este bloque.`.

**Interfaces:**
- Consumes (Release 1, unchanged):
  - From `tools/write_ahead_test_lib.php`: `wa_chk(string $desc, bool $ok, mixed $obtenido = null): void`, `wa_fin(): never`, `wa_arg(string $nombre, ?string $defecto = null): ?string`, `wa_pdo(?string $base = null): PDO`, `wa_base_corta(string $base): string`, `wa_base_real(string $base): string`.
  - From `tools/test_write_ahead_puro.php`: `GuionConexion` (`filas`, `prepareFalla`, `sql()`, `params()`), `puro_modelo(object $conexion): facturaModel`, `puro_con_log(callable $fn): array`.
  - From `tools/test_write_ahead_ecf.php`: `correr(PDO $pdo, array $ids, array $op = []): array`, `emision()`, `chkComun()`, `descErr()`.
- Produces: the merged API that Tasks 3-16 anchor on.
  - `facturaModel::tomarLockReenvio(int $facturaId): bool` (`GET_LOCK` named `<db>:reenvio_ecf:<id>`, no wait).
  - `facturaModel::archivarRechazoReenviado(int $facturaId): void`.
  - `facturaModel::diasCreditoValido($valor): bool` (public static) and `const DIAS_CREDITO_MAX = 365`.
  - `createFacturaSimple` and `updateFacturaSimple` write `dias_credito`.
  - `inventoryModel::devolverSaldoDeFactura(int $facturaId, ?int $userId = null): int`.
  - `ECFEmissionService::reenviarRFCE(string $rfceXml, ?string $ambiente = null, ?int $timeout = null): array`, returning `{estado, response, status_code}`.
  - `ECFEmissionService::consultarTrackIds(string $eNcf, ?string $ambiente = null): ?array`.
  - `ECFEmissionService::reenviarECF(string $signedXml, ?string $ambiente = null, ?int $timeout = null): array`, returning `{estado, track_id, response}`.
  - Payload keys `formas_pago` (list of `{forma_pago, monto_pago}`, also in the e-CF XML when not `strict_input`) and `dgii_timeout` (int seconds).
  - In `emitir()`, `$opcionesEnvio = ['environment' => $ambiente]` (plus `'timeout'`) is built right before the comment `// Envio. Desde aqui la DGII puede tener el e-CF`, after the pre-send try/catch. It reads `$ambiente`, which is set inside that try (D1). Both `recibir` and `recibirResumen` take it. Task 4 moves it when it defers the token.
  - `facturaController.php`: `emitirFacturaEcf(array $input, facturaModel $facturaModel, clientModel $clientModel, ?int $reenvioDe = null): void`. It carries the whole write-ahead emission and reads `$input['e_ncf']` as the override. `handleEmisionECF` only reads the body and delegates.
  - `facturaController.php`: `handleReenviar(int $facturaId, facturaModel $facturaModel, clientModel $clientModel): void`, `armarInputReenvio(array $f, array $guardadas, ?int $userId): array` and `campoXmlReenvio(string $xml, string $tag): string`, all as master wrote them. `handleReenviar` already answers 409 to anything outside `RECHAZADO`, `RFCE_RECHAZADO` and `NO_ENCONTRADO`.
  - `tools/aplicar_migracion_scratch.php --tenant-db=<base> --migraciones=032,033,034` (exit 2 for bad arguments; exit 1 if a statement fails or a migration is not `APLICADA` afterwards).
  - `FakeReception::$opciones` (`list<array>`: the `$options` of each send, in order).

- [ ] **Step 1: Verify the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -1
git fetch origin
git rev-parse --short origin/master
git merge-base HEAD origin/master | cut -c1-7
```

Expected, in order:

```
?? tools/reconstruir_e340000000001.sql
c3dacd8 fix(write-ahead): el cierre sobrevive a ini_get/ini_set deshabilitados y docs del 10.2
c594c10
dfc7289
```

Never stage or delete the untracked `reconstruir` file. If `origin/master` is not `c594c10`, continue only if Step 4 reports exactly the same four conflicted files and Step 6's script finds the hunk counts it asserts. Otherwise stop and report, because master moved in the same zone.

- [ ] **Step 2: Write the failing tests (before the merge)**

(a) `tools/test_write_ahead_puro.php`: insert section 14 directly above the closing block. In the file the closing block is these two lines (followed by one more rule line and `wa_fin();`). Edit: replace this old text

```php
// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega su seccion justo encima de este bloque.
```

with the following section 14 followed by that same old text (section 14 ends with one blank line):

```php
// ---------------------------------------------------------------------------
// 14) Merge con origin/master (Task 1): lo que master aporto, lo que no entra y
// lo que el write-ahead conserva. Texto de los archivos, reflexion y las
// conexiones falsas de las secciones 5 y 6: nada toca la base.
// ---------------------------------------------------------------------------
echo "\n== 14) Merge con origin/master ==\n";
$s14Leer = static fn(string $ruta): string
    => str_replace("\r\n", "\n", (string) @file_get_contents(dirname(__DIR__) . '/' . $ruta));
$s14Servicio = $s14Leer('src/Utils/FacturacionElectronica/ECFEmissionService.php');
$s14Modelo = $s14Leer('src/Models/facturaModel.php');
$s14Ctl = $s14Leer('src/Controllers/facturaController.php');
$s14Inv = $s14Leer('src/Models/inventoryModel.php');
$s14Conflicto = static fn(string $texto): bool => (bool) preg_match('/^(<<<<<<<|=======|>>>>>>>)/m', $texto);

wa_chk('migraciones 032, 033 y 034 de master estan en db/migrations y en el verificador',
    is_file(dirname(__DIR__) . '/db/migrations/032_producto_imagen.sql')
    && is_file(dirname(__DIR__) . '/db/migrations/033_facturas_dias_credito.sql')
    && is_file(dirname(__DIR__) . '/db/migrations/034_categorias_color.sql')
    && str_contains($s14Leer('tools/verificar_migraciones_tenant.sql'), "SELECT '034', '034_categorias_color.sql'"));
wa_chk('el POS de master esta (PosVenta, PosCierre, mock local de la DGII)',
    is_file(dirname(__DIR__) . '/src/Pos/PosVenta.php') && is_file(dirname(__DIR__) . '/src/Pos/PosCierre.php')
    && is_file(dirname(__DIR__) . '/tools/mock_dgii_local.php'));
wa_chk('ninguno de los cuatro archivos conflictivos conserva marcas de conflicto',
    !$s14Conflicto($s14Servicio) && !$s14Conflicto($s14Modelo) && !$s14Conflicto($s14Ctl) && !$s14Conflicto($s14Inv));

// -- ECFEmissionService: flujo write-ahead + lo de master, sin tolerar_fallo_envio
wa_chk('servicio: sin tolerar_fallo_envio ni los estados RFCE_PENDIENTE / ENVIO_PENDIENTE',
    !str_contains($s14Servicio, 'tolerar_fallo_envio') && !str_contains($s14Servicio, 'RFCE_PENDIENTE')
    && !str_contains($s14Servicio, 'ENVIO_PENDIENTE'));
wa_chk('servicio: el e-CF firmado lleva formas_pago (no en strict_input)',
    str_contains($s14Servicio, "'formas_pago' => !\$strictInput && is_array(\$payload['formas_pago'] ?? null)"));
wa_chk("servicio: dgii_timeout entra como \$opcionesEnvio['timeout'] y lo usan recibir y recibirResumen",
    str_contains($s14Servicio, "\$opcionesEnvio['timeout'] = (int) \$payload['dgii_timeout'];")
    && substr_count($s14Servicio, '$bearerToken, $opcionesEnvio)') === 2, substr_count($s14Servicio, '$bearerToken, $opcionesEnvio)'));
$s14Firmas = [
    'reenviarRFCE' => ['rfceXml', 'ambiente', 'timeout'],
    'consultarTrackIds' => ['eNcf', 'ambiente'],
    'reenviarECF' => ['signedXml', 'ambiente', 'timeout'],
];
foreach ($s14Firmas as $metodo => $parametros) {
    $m = method_exists(ECFEmissionService::class, $metodo) ? new ReflectionMethod(ECFEmissionService::class, $metodo) : null;
    wa_chk("servicio: {$metodo} es publico, con los parametros de master",
        $m !== null && $m->isPublic() && !$m->isStatic()
        && array_map(static fn(ReflectionParameter $p): string => $p->getName(), $m->getParameters()) === $parametros);
}
wa_chk('servicio: emitir sigue recibiendo el gancho $persistencia (write-ahead)',
    (new ReflectionMethod(ECFEmissionService::class, 'emitir'))->getNumberOfParameters() === 2
    && str_contains($s14Servicio, "\$reserva = \$persistencia('reservar', \$ctxReservar);"));

// -- facturaModel: dias_credito, el candado del reenvio y el archivo de rechazos
wa_chk('facturaModel: tomarLockReenvio y archivarRechazoReenviado de master',
    method_exists(facturaModel::class, 'tomarLockReenvio') && method_exists(facturaModel::class, 'archivarRechazoReenviado'));
wa_chk('facturaModel: reservarFacturaECF sigue y saveFacturaConECF no vuelve',
    method_exists(facturaModel::class, 'reservarFacturaECF') && !method_exists(facturaModel::class, 'saveFacturaConECF'));
wa_chk('facturaModel: DIAS_CREDITO_MAX es 365',
    defined('facturaModel::DIAS_CREDITO_MAX') && constant('facturaModel::DIAS_CREDITO_MAX') === 365);
$s14Dias = [];
foreach ([null, '', '1', '30', 45, '365', '0', '366', 'abc', '45.5', -5] as $valor) {
    $s14Dias[] = method_exists(facturaModel::class, 'diasCreditoValido') ? facturaModel::diasCreditoValido($valor) : null;
}
wa_chk('facturaModel::diasCreditoValido: vacio y de 1 a 365 sirven; 0, 366, texto y decimales no',
    $s14Dias === [true, true, true, true, true, true, false, false, false, false, false], $s14Dias);
$s14DiasMetodo = method_exists(facturaModel::class, 'diasCredito') ? new ReflectionMethod(facturaModel::class, 'diasCredito') : null;
$s14DiasObtenidos = $s14DiasMetodo === null ? null : [
    $s14DiasMetodo->invoke(null, '45', 2), $s14DiasMetodo->invoke(null, '45', 1), $s14DiasMetodo->invoke(null, '', 2),
    $s14DiasMetodo->invoke(null, '999', 2), $s14DiasMetodo->invoke(null, null, 2),
];
wa_chk('facturaModel::diasCredito: guarda el plazo solo a credito y valido',
    $s14DiasObtenidos === [45, null, null, null, null], $s14DiasObtenidos);
wa_chk('facturaModel: la factura simple guarda dias_credito al crear y al editar',
    str_contains($s14Modelo, ':dias_credito, :NCF, NULL)') && str_contains($s14Modelo, 'dias_credito = :dias_credito, NCF = :NCF'));

$c = new GuionConexion();
$c->filas = ['GET_LOCK' => [[1]]];
$libre = method_exists(facturaModel::class, 'tomarLockReenvio') ? puro_modelo($c)->tomarLockReenvio(41) : null;
$sqlLock = (string) $c->sql('GET_LOCK');
wa_chk('tomarLockReenvio: candado libre da true, sin espera y por factura',
    $libre === true && str_contains($sqlLock, "GET_LOCK(CONCAT(DATABASE(), ':reenvio_ecf:', :id), 0)")
    && $c->params('GET_LOCK') === [':id' => 41], [$sqlLock, $c->params('GET_LOCK')]);
$c = new GuionConexion();
$c->filas = ['GET_LOCK' => [[0]]];
wa_chk('tomarLockReenvio: candado ocupado da false',
    method_exists(facturaModel::class, 'tomarLockReenvio') && puro_modelo($c)->tomarLockReenvio(41) === false);
$c = new GuionConexion();
$c->prepareFalla = true;
[$sinBase, $e, $log] = puro_con_log(static fn() => puro_modelo($c)->tomarLockReenvio(41));
wa_chk('tomarLockReenvio: con la base caida da false y lo deja en el log',
    $e === null && $sinBase === false && str_contains($log, '[facturas] no se pudo tomar el lock de reenvio 41'), [$e?->getMessage(), $log]);
$c = new GuionConexion();
[, $e] = puro_con_log(static fn() => puro_modelo($c)->archivarRechazoReenviado(41));
$sqlArchivo = (string) $c->sql('UPDATE facturas SET estado_dgii');
wa_chk('archivarRechazoReenviado: archiva solo si sigue en rechazo (un UPDATE con el estado en el WHERE)',
    $e === null && str_contains($sqlArchivo, "estado_dgii = CONCAT(estado_dgii, '_ARCHIVADO')")
    && str_contains($sqlArchivo, "estado_dgii IN ('RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO')")
    && $c->params('UPDATE facturas SET estado_dgii') === [':id' => 41], [$e?->getMessage(), $sqlArchivo]);

// -- facturaController: la emision de master (emitirFacturaEcf) con el flujo write-ahead
wa_chk('controlador: emitirFacturaEcf tiene la firma de master',
    str_contains($s14Ctl, 'function emitirFacturaEcf(array $input, facturaModel $facturaModel, clientModel $clientModel, ?int $reenvioDe = null): void'));
wa_chk('controlador: la ruta y handleReenviar llevan el clientModel de master',
    str_contains($s14Ctl, 'handleReenviar((int) $reenviarMatches[1], $facturaModel, $clientModel);')
    && str_contains($s14Ctl, 'function handleReenviar(int $facturaId, facturaModel $facturaModel, clientModel $clientModel): void'));
wa_chk('controlador: armarInputReenvio y campoXmlReenvio de master',
    str_contains($s14Ctl, 'function armarInputReenvio(array $f, array $guardadas, ?int $userId): array')
    && str_contains($s14Ctl, 'function campoXmlReenvio(string $xml, string $tag): string'));
wa_chk('controlador: la respuesta de un reenvio lleva reenvio_de', str_contains($s14Ctl, "\$data['reenvio_de'] = \$reenvioDe;"));
wa_chk('controlador: handleEstadoEnVuelo y moverStockPrimeraAceptacion siguen (el conflicto de handleReenviar)',
    str_contains($s14Ctl, 'function handleEstadoEnVuelo(int $facturaId, array $ecf): void')
    && str_contains($s14Ctl, 'function moverStockPrimeraAceptacion('));

// -- inventoryModel: los dos metodos
wa_chk('inventoryModel: yaMovioDocumento (write-ahead) y devolverSaldoDeFactura (master)',
    method_exists(inventoryModel::class, 'yaMovioDocumento') && method_exists(inventoryModel::class, 'devolverSaldoDeFactura'));

// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega su seccion justo encima de este bloque.
```

(b) `tools/test_write_ahead_ecf.php`: three edits.

Edit 1: record the options each send receives. Replace

```php
    /** @var list<array{metodo:string, e_ncf:?string}> */
    public array $llamadas = [];
    public ?Closure $espia = null;
```

with

```php
    /** @var list<array{metodo:string, e_ncf:?string}> */
    public array $llamadas = [];
    /** @var list<array> las opciones ($options) de cada envio, en orden */
    public array $opciones = [];
    public ?Closure $espia = null;
```

Edit 2: replace

```php
    public function recibir(string $signedXml, string $bearerToken, array $options = []): array
    {
        return $this->responder('recibir', $signedXml);
    }

    public function recibirResumen(string $signedXml, string $bearerToken, array $options = []): array
    {
        return $this->responder('recibirResumen', $signedXml);
    }
```

with

```php
    public function recibir(string $signedXml, string $bearerToken, array $options = []): array
    {
        $this->opciones[] = $options;
        return $this->responder('recibir', $signedXml);
    }

    public function recibirResumen(string $signedXml, string $bearerToken, array $options = []): array
    {
        $this->opciones[] = $options;
        return $this->responder('recibirResumen', $signedXml);
    }
```

Edit 3: add section 4 directly above the closing block. Replace

```php
// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega sus casos justo encima de este bloque.
```

with

```php
// ---------------------------------------------------------------------------
// 4) Opciones del envio que trae master (Task 1): dgii_timeout y formas_pago.
// El POS las manda en el payload; app.* no, y su emision queda como siempre.
// ---------------------------------------------------------------------------
echo "\n== 4) Opciones de master: dgii_timeout y formas_pago ==\n";
// El total real de la emision de prueba (la tabla de formas de pago lo repite).
$totalM = (float) emision($pdo, $ids, '31')['payload']['totales']['monto_total'];
$formasPago = [['forma_pago' => 1, 'monto_pago' => $totalM]];

// M1 sin dgii_timeout (o con uno que no es un entero positivo): solo el ambiente del token.
foreach ([[], ['dgii_timeout' => 0], ['dgii_timeout' => 'abc']] as $i => $payloadM1) {
    $r = correr($pdo, $ids, ['payload' => $payloadM1]);
    wa_chk('M1.' . ($i + 1) . ': el e-CF se envia con solo environment, como siempre',
        $r['err'] === null && ($r['rec']->opciones[0] ?? null) === ['environment' => 'certecf'], [descErr($r['err']), $r['rec']->opciones]);
    chkComun('M1.' . ($i + 1), $r);
}

// M2 e-CF completo con dgii_timeout y formas_pago.
$r = correr($pdo, $ids, ['payload' => ['dgii_timeout' => 5, 'formas_pago' => $formasPago]]);
wa_chk('M2: recibir lleva environment y timeout 5',
    $r['err'] === null && ($r['rec']->opciones[0] ?? null) === ['environment' => 'certecf', 'timeout' => 5]
    && ($r['rec']->llamadas[0]['metodo'] ?? null) === 'recibir', [descErr($r['err']), $r['rec']->opciones]);
$xmlM2 = (string) ($r['ctxs']['reservar']['signed_xml'] ?? '');
wa_chk('M2: el e-CF firmado que se guarda lleva TablaFormasPago con la forma de pago y el monto',
    str_contains($xmlM2, '<TablaFormasPago>') && str_contains($xmlM2, '<FormaPago>1</FormaPago>')
    && str_contains($xmlM2, '<MontoPago>' . number_format($totalM, 2, '.', '') . '</MontoPago>'), substr($xmlM2, 0, 800));
chkComun('M2', $r);

// M3 sin formas_pago el e-CF no lleva la tabla (app.*).
$r = correr($pdo, $ids);
wa_chk('M3: sin formas_pago el e-CF firmado no lleva TablaFormasPago',
    $r['err'] === null && !str_contains((string) ($r['ctxs']['reservar']['signed_xml'] ?? ''), 'TablaFormasPago'), descErr($r['err']));
chkComun('M3', $r);

// M4 E32 < 250k (RFCE): el resumen sale por recibirResumen con el mismo timeout.
$r = correr($pdo, $ids, ['tipo' => '32', 'payload' => ['dgii_timeout' => 5, 'formas_pago' => $formasPago]]);
wa_chk('M4: recibirResumen lleva environment y timeout 5',
    $r['err'] === null && ($r['rec']->llamadas[0]['metodo'] ?? null) === 'recibirResumen'
    && ($r['rec']->opciones[0] ?? null) === ['environment' => 'certecf', 'timeout' => 5], [descErr($r['err']), $r['rec']->opciones]);
chkComun('M4', $r);

// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega sus casos justo encima de este bloque.
```

- [ ] **Step 3: Run both and watch them fail (the tree is still unmerged)**

```bash
php -l tools/test_write_ahead_puro.php && php -l tools/test_write_ahead_ecf.php
php tools/test_write_ahead_puro.php | sed -n '/== 14)/,$p'
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_ecf.php --tenant-db=wa_scratch | tail -12
```

Expected from puro, exit 1. 21 of the 26 new checks fail, all under section 14. These five already pass: no conflict markers, no `tolerar_fallo_envio`, `emitir` keeps `$persistencia`, `reservarFacturaECF` stays, and `handleEstadoEnVuelo` stays.

```
== 14) Merge con origin/master ==
  [FALLO] migraciones 032, 033 y 034 de master estan en db/migrations y en el verificador
  [FALLO] el POS de master esta (PosVenta, PosCierre, mock local de la DGII)
  [OK  ] ninguno de los cuatro archivos conflictivos conserva marcas de conflicto
  [OK  ] servicio: sin tolerar_fallo_envio ni los estados RFCE_PENDIENTE / ENVIO_PENDIENTE
  [FALLO] servicio: el e-CF firmado lleva formas_pago (no en strict_input)
  [FALLO] servicio: dgii_timeout entra como $opcionesEnvio['timeout'] y lo usan recibir y recibirResumen
         obtenido: 0
  ...
187 de 208 pruebas OK
```

Expected from ecf. Section 4 is the only part that can fail: M2 (two checks) and M4 (one check), because `emitir()` still sends `['environment' => ...]` only and the e-CF carries no `TablaFormasPago`.

```
  [FALLO] M2: recibir lleva environment y timeout 5
  [FALLO] M2: el e-CF firmado que se guarda lleva TablaFormasPago con la forma de pago y el monto
  [FALLO] M4: recibirResumen lleva environment y timeout 5
250 de 253 pruebas OK
```

(If other `[FALLO]` lines appear in sections 1-3, such as `R1: contador +1` with obtained 2, or the "sin fila" checks of R2/R4, another session is using `wa_scratch` at the same time. This does happen: other agents run DB suites on the same base. Wait and rerun the whole suite; DB suites run strictly serially.)

- [ ] **Step 4: Start the merge and confirm the four conflicts**

The unstaged edits of Step 2 do not block the merge, because master did not touch those two files.

```bash
git merge --no-commit --no-ff origin/master 2>&1 | grep -E "CONFLICT|Automatic"
git status --short | grep -E '^(UU|AA|DU|UD)'
```

Expected:

```
CONFLICT (content): Merge conflict in src/Controllers/facturaController.php
CONFLICT (content): Merge conflict in src/Models/facturaModel.php
CONFLICT (content): Merge conflict in src/Models/inventoryModel.php
CONFLICT (content): Merge conflict in src/Utils/FacturacionElectronica/ECFEmissionService.php
Automatic merge failed; fix conflicts and then commit the result.
UU src/Controllers/facturaController.php
UU src/Models/facturaModel.php
UU src/Models/inventoryModel.php
UU src/Utils/FacturacionElectronica/ECFEmissionService.php
```

Any other `UU` or `AA` line means master moved: stop and report.

- [ ] **Step 5: `facturaModel.php`: three-way merge over a base normalised to LF, ours in the conflicts**

Our side deleted `saveFacturaConECF`, and all three conflicts are master's edits to that function. `--ours` therefore keeps it deleted, and everything else of master comes in: `dias_credito`, `tomarLockReenvio`, `archivarRechazoReenviado`.

```bash
T=$(mktemp -d) && f=src/Models/facturaModel.php
git show :1:$f | tr -d '\r' > "$T/base.php"
git show :2:$f | tr -d '\r' > "$T/ours.php"
git show :3:$f > "$T/theirs.php"
git merge-file -p --ours "$T/ours.php" "$T/base.php" "$T/theirs.php" > "$f"
echo "merge-file exit=$?"
rm -rf "$T"
php -l "$f"
grep -c '^<<<<<<<' "$f"
tr -cd '\r' < "$f" | wc -c
```

Expected: `merge-file exit=0`, `No syntax errors detected in src/Models/facturaModel.php`, `0` conflict lines and `0` carriage returns. The file is now LF, which is what the plan requires. (Git may print "LF will be replaced by CRLF the next time Git touches it" on `git add`. It is only a warning: the index keeps LF.)

- [ ] **Step 6: `facturaController.php`, `inventoryModel.php`, `ECFEmissionService.php`: resolve the hunks**

The script keeps each file's line ending and exits 1 if a hunk count differs from what it expects. Hunk by hunk:
- Controller 1: ours. Master archived the rejected row and moved inventory there. The write-ahead does that differently, and Task 9 adds it.
- Controller 2: our `handleEstadoEnVuelo` and `moverStockPrimeraAceptacion`, then master's docblock and the new `handleReenviar` signature.
- Inventory: `yaMovioDocumento` (ours) and `devolverSaldoDeFactura` (master), one after the other.
- Service 1 and 2: ours, meaning the write-ahead send and the confirm-before-reclaim order.
- Service 3: our static helpers plus master's `reenviarRFCE`, `consultarTrackIds` and `reenviarECF`.

```bash
php <<'PHP'
<?php
// Resuelve los conflictos de facturaController, inventoryModel y ECFEmissionService hunk por hunk.
// Corre desde la raiz del API. Conserva el fin de linea de cada archivo.
const MARCAS = '/^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n/ms';

/** @param list<callable(string,string):string> $decisiones una por hunk, en orden: recibe (lado nuestro, lado de master) */
function resolver(string $ruta, array $decisiones): void
{
    $orig = (string) file_get_contents($ruta);
    $crlf = str_contains($orig, "\r\n");
    $texto = str_replace("\r\n", "\n", $orig);
    $n = 0;
    $res = preg_replace_callback(MARCAS, static function (array $m) use (&$n, $decisiones, $ruta): string {
        if (!isset($decisiones[$n])) {
            fwrite(STDERR, "{$ruta}: hay mas hunks de los esperados\n");
            exit(1);
        }
        return $decisiones[$n++]($m[1], $m[2]);
    }, $texto);
    if ($n !== count($decisiones) || preg_match('/^(<<<<<<<|=======|>>>>>>>)/m', (string) $res)) {
        fwrite(STDERR, "{$ruta}: se esperaban " . count($decisiones) . " hunks y se resolvieron {$n}\n");
        exit(1);
    }
    file_put_contents($ruta, $crlf ? str_replace("\n", "\r\n", $res) : $res);
    echo "{$ruta}: {$n} hunks resueltos\n";
}

$nuestro = static fn(string $o, string $t): string => $o;
// Nuestro lado termina a mitad de un metodo, cuyo "}" esta despues de la marca: se lo cierra y el
// lado de master (el docblock y el metodo o metodos nuevos) entra a continuacion.
$ambos = static fn(string $o, string $t): string => $o . "    }\n\n    /**\n" . $t;

resolver('src/Controllers/facturaController.php', [
    // 1: master archivaba el rechazo y movia inventario aqui; el write-ahead lo hace de otra forma (Task 9).
    $nuestro,
    // 2: nuestras handleEstadoEnVuelo y moverStockPrimeraAceptacion + el docblock y la firma de master.
    static function (string $o, string $t): string {
        $firmaVieja = "function handleReenviar(int \$facturaId, facturaModel \$facturaModel): void\n";
        if (!str_ends_with($o, $firmaVieja)) {
            fwrite(STDERR, "facturaController: el hunk 2 ya no termina en la firma vieja de handleReenviar\n");
            exit(1);
        }
        return substr($o, 0, -strlen($firmaVieja)) . "/**\n" . $t;
    },
]);
resolver('src/Models/inventoryModel.php', [$ambos]);
resolver('src/Utils/FacturacionElectronica/ECFEmissionService.php', [$nuestro, $nuestro, $ambos]);
PHP
for f in src/Controllers/facturaController.php src/Models/inventoryModel.php src/Utils/FacturacionElectronica/ECFEmissionService.php; do php -l "$f"; done
```

Expected:

```
src/Controllers/facturaController.php: 2 hunks resueltos
src/Models/inventoryModel.php: 1 hunks resueltos
src/Utils/FacturacionElectronica/ECFEmissionService.php: 3 hunks resueltos
No syntax errors detected in src/Controllers/facturaController.php
No syntax errors detected in src/Models/inventoryModel.php
No syntax errors detected in src/Utils/FacturacionElectronica/ECFEmissionService.php
```

- [ ] **Step 7: `ECFEmissionService.php`: `dgii_timeout` as the send options**

Master's `$opcionesEnvio` sat inside the hunk that Step 6 resolved as ours, so it is added back here. `formas_pago` in the e-CF XML merged on its own.

Edit 1: replace

```php
        // Envio. Desde aqui la DGII puede tener el e-CF: ningun fallo devuelve el
        // numero. Con fila reservada, un fallo del envio, del mapeo o de
        // 'confirmar' deja la fila en ENVIO_INCIERTO y sale como
        // EcfEnvioInciertoException (con factura_id, para llevar al usuario a ella).
        $ctxConfirmar = null;
```

with

```php
        // Opciones del envio. 'dgii_timeout' (POS, docs/specs/pos.md F6): segundos
        // de espera al ENVIAR; el resto del sistema usa DGII_ECF_TIMEOUT (30 s) y
        // el token ya se pidio con ese timeout. Sin la opcion, todo como siempre.
        $opcionesEnvio = ['environment' => $ambiente];
        if ((int) ($payload['dgii_timeout'] ?? 0) > 0) {
            $opcionesEnvio['timeout'] = (int) $payload['dgii_timeout'];
        }

        // Envio. Desde aqui la DGII puede tener el e-CF: ningun fallo devuelve el
        // numero. Con fila reservada, un fallo del envio, del mapeo o de
        // 'confirmar' deja la fila en ENVIO_INCIERTO y sale como
        // EcfEnvioInciertoException (con factura_id, para llevar al usuario a ella).
        $ctxConfirmar = null;
```

Edit 2: replace

```php
                $rfceReception = $this->reception->recibirResumen($signedRfce, $bearerToken, [
                    'environment' => $ambiente,
                ]);
```

with

```php
                $rfceReception = $this->reception->recibirResumen($signedRfce, $bearerToken, $opcionesEnvio);
```

Edit 3: replace

```php
                $reception = $this->reception->recibir($signedXml, $bearerToken, [
                    'environment' => $ambiente,
                ]);
```

with

```php
                $reception = $this->reception->recibir($signedXml, $bearerToken, $opcionesEnvio);
```

- [ ] **Step 8: Reword the two stale mentions of the removed method**

Edit `src/Models/facturaModel.php`: replace

```php
     * reuso su e-NCF, saveFacturaConECF ya lo archivo y esto no hace nada.
```

with

```php
     * reuso su e-NCF, reservarFacturaECF ya lo archivo y esto no hace nada.
```

Edit `docs/specs/pos.md`: replace

```
en una transacción (`saveFacturaConECF` con gancho;
```

with

```
en una transacción (así salió el 10-08; el write-ahead lo reemplazó, ver `docs/integrations/pos-write-ahead.md`;
```

Task 15 rewrites that status paragraph. The reword only keeps the `src, docs, CLAUDE.md` guard of section 13 honest, so `src/Pos/PosVenta.php` is its only remaining hit.

- [ ] **Step 9: Adapt the two Release 1 guards the merge supersedes**

Edit `tools/test_write_ahead_puro.php`, section 11. Master moved the body of the emission into `emitirFacturaEcf`, so the checks that read the emission text must look there. Replace

```php
$s11Emision = preg_match('/\nfunction handleEmisionECF\(.*?\n\}\n/s', $s11Ctl, $m) ? $m[0] : '';
wa_chk('controlador: se encontro handleEmisionECF', $s11Emision !== '');
```

with

```php
// Desde el merge con master (4007eea) el cuerpo de la emision vive en
// emitirFacturaEcf; handleEmisionECF solo lee el body y delega.
$s11Emision = preg_match('/\nfunction emitirFacturaEcf\(.*?\n\}\n/s', $s11Ctl, $m) ? $m[0] : '';
wa_chk('controlador: se encontro emitirFacturaEcf', $s11Emision !== '');
$s11Delega = preg_match('/\nfunction handleEmisionECF\(.*?\n\}\n/s', $s11Ctl, $m) ? $m[0] : '';
wa_chk('handleEmisionECF lee el body y delega en emitirFacturaEcf',
    str_contains($s11Delega, 'emitirFacturaEcf($input, $facturaModel, $clientModel);'), $s11Delega);
```

and replace

```php
wa_chk('handleEmisionECF emite con el hook de persistencia',
```

with

```php
wa_chk('emitirFacturaEcf emite con el hook de persistencia',
```

Edit `tools/test_write_ahead_puro.php`, section 12. Decision 7 is redefined: the app never resends an unconfirmed invoice, but it may re-emit a rejected one. Master's `handleReenviar` already answers 409 to everything that is not a rejection. Replace

```php
wa_chk('POST /reenviar sigue respondiendo 501 (decision 7)',
    (bool) preg_match('/function handleReenviar\(.*?\n\{\n\s*respond\(false, [^\n]*, 501\);\n\}/s', $s12Ctl));
```

with

```php
// Decision 7 redefinida (spec 2026-10-12, U7): la app nunca reenvia una factura SIN
// CONFIRMAR (en vuelo, ENVIADO, EN_PROCESO); solo reemite una RECHAZADA. El
// handleReenviar de master (4007eea) solo deja pasar los rechazos y contesta
// 409 al resto; Task 9 lo prueba de punta a punta.
$s12Reenviar = preg_match('/\nfunction handleReenviar\(.*?\n\}\n/s', $s12Ctl, $m) ? $m[0] : '';
wa_chk('POST /reenviar solo deja pasar RECHAZADO, RFCE_RECHAZADO y NO_ENCONTRADO; todo lo demas da 409',
    str_contains($s12Reenviar, "if (!in_array(\$estado, ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'], true)) {\n"
        . "        respond(false, 'Solo se puede reenviar un comprobante que la DGII rechazó.', 409);"), $s12Reenviar);
```

- [ ] **Step 10: Run the DB-free tests: green except the known guard**

```bash
git add src/Controllers/facturaController.php src/Models/facturaModel.php src/Models/inventoryModel.php \
  src/Utils/FacturacionElectronica/ECFEmissionService.php docs/specs/pos.md \
  tools/test_write_ahead_puro.php tools/test_write_ahead_ecf.php
for f in $(git diff --cached --name-only HEAD | grep '\.php$'); do php -l "$f"; done | grep -v '^No syntax errors'
git diff --cached --ignore-cr-at-eol --shortstat HEAD -- src/Models/facturaModel.php
php tools/test_write_ahead_puro.php | grep -A1 -E "FALLO|pruebas OK"
```

Expected:
- The lint loop prints nothing (32 PHP files).
- `1 file changed, 77 insertions(+), 5 deletions(-)` for `facturaModel.php`.
- Exactly one failing check:

```
  [FALLO] nada en src, docs ni CLAUDE.md nombra saveFacturaConECF
         obtenido: ["src/Pos/PosVenta.php"]
208 de 209 pruebas OK
```

That check stays red on purpose until Task 5 removes `saveFacturaConECF` from `src/Pos/PosVenta.php`. Anything else red here is a mistake in Steps 5-9.

Then run the remaining DB-free Release 1 and master suites:

```bash
for t in check_estado_dgii_ancho check_tenant_schema_orden test_consultar_ecf_dgii test_notas_vinculadas \
         test_ecf_montos_descuento test_precios_itbis_incluido test_integracion_alcance test_integracion_xml \
         test_conduces test_cotizacion_ferreteria test_send_fase2_espera test_tenant_mail test_grupo_multiempresa; do
  printf '%s: ' "$t"
  php -d extension=curl -d extension=openssl -d extension=pdo_sqlite "tools/$t.php" 2>&1 | tail -1
done
WA_PUERTO_OFFSET=100 php -d extension=curl -d extension=openssl tools/test_mock_dgii.php | tail -1
```

Expected last lines, in order:

```
check_estado_dgii_ancho: 32/32 OK
check_tenant_schema_orden: 147/147 OK
test_consultar_ecf_dgii: 73/73 OK
test_notas_vinculadas: 62 de 62 pruebas OK
test_ecf_montos_descuento: 33 de 33 pruebas OK
test_precios_itbis_incluido: TODO OK (45 verificaciones)
test_integracion_alcance: 28 de 28 pruebas OK
test_integracion_xml: 6 de 6 pruebas OK
test_conduces: 413/413 OK
test_cotizacion_ferreteria: 474/474 OK
test_send_fase2_espera: 60 de 60 pruebas OK
test_tenant_mail: 35/35 OK
test_grupo_multiempresa: == TODO OK: 20 comprobaciones ==
24 de 24 pruebas OK
```

- [ ] **Step 11: Create the migration helper**

Create `tools/aplicar_migracion_scratch.php`. It runs each migration statement by statement. Do not use a single `$pdo->exec()` of the whole file: with several statements PDO does not raise an error when one of the later ones fails (checked on PHP 8.5.8: `exec("SELECT 1; SELECT * FROM no_existe; SELECT 2")` returns 0 without throwing), so a half-applied migration would go unnoticed until the verifier.

```php
<?php
/**
 * aplicar_migracion_scratch.php — aplica migraciones de db/migrations a una base
 * de PRUEBA del write-ahead y comprueba, con tools/verificar_migraciones_tenant.sql,
 * que quedaron APLICADA.
 *
 * Existe para los merges con master: cada migracion nueva de master tiene que
 * llegar a las dos bases de prueba (wa_scratch y wa_scratch_sin_gate) antes de
 * correr la compuerta y las suites. Las migraciones son idempotentes (cada paso
 * mira information_schema), asi que se puede repetir.
 *
 * Reglas:
 *  - Solo bases con la marca zz_write_ahead_scratch (wa_pdo sale con 1 si no).
 *  - 027 y 028 NUNCA se aplican a wa_scratch_sin_gate: esa copia esta rota a
 *    proposito (tools/test_write_ahead_gate.php) y tiene que seguir FALTA.
 *  - Solo migraciones de tres digitos que tengan fila en el verificador.
 *  - Sentencia por sentencia: un exec() con varias sentencias no avisa si falla
 *    una de las ultimas, y la migracion quedaria a medias sin que se note. Un
 *    fallo imprime la sentencia y solo SQLSTATE y errno (nunca el mensaje del
 *    driver, que trae usuario y host) y sale con 1.
 *
 * Uso:
 *   php -d extension=pdo_mysql tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch --migraciones=032,033,034
 *   php -d extension=pdo_mysql tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch_sin_gate --migraciones=032,033,034
 * Sale con 2 si los argumentos no valen y con 1 si una migracion no quedo APLICADA.
 */

require_once __DIR__ . '/write_ahead_test_lib.php';

$baseArg = (string) wa_arg('tenant-db', '');
$pedidas = array_values(array_filter(array_map('trim', explode(',', (string) wa_arg('migraciones', '')))));
if ($baseArg === '' || $pedidas === []) {
    echo "Uso: php tools/aplicar_migracion_scratch.php --tenant-db=<base de prueba> --migraciones=032,033,034\n";
    exit(2);
}
foreach ($pedidas as $m) {
    if (!preg_match('/^\d{3}$/', $m)) {
        echo "[FALLO] migracion invalida: {$m} (tres digitos, por ejemplo 032)\n";
        exit(2);
    }
}
$corta = wa_base_corta($baseArg);
if (str_ends_with($corta, 'wa_scratch_sin_gate') && array_intersect($pedidas, ['027', '028']) !== []) {
    echo "[FALLO] 027 y 028 no se aplican a wa_scratch_sin_gate: esa copia se queda sin la compuerta a proposito\n";
    exit(2);
}

/** Corre el verificador (un solo SELECT) en la base de $pdo. @return array<string,array> por migracion */
function wa_estado_migraciones(PDO $pdo): array
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

/** Parte un script SQL en sentencias: respeta '...' (con ''), `...` y los comentarios -- de linea. */
function wa_partir_sql(string $sql): array
{
    $sentencias = [];
    $actual = '';
    $comilla = null;
    $largo = strlen($sql);
    for ($i = 0; $i < $largo; $i++) {
        $c = $sql[$i];
        if ($comilla !== null) {
            $actual .= $c;
            if ($c === $comilla) {
                if ($comilla === "'" && $i + 1 < $largo && $sql[$i + 1] === "'") {
                    $actual .= $sql[++$i];   // '' dentro de una cadena
                } else {
                    $comilla = null;
                }
            }
            continue;
        }
        if ($c === "'" || $c === '`' || $c === '"') {
            $comilla = $c;
            $actual .= $c;
            continue;
        }
        if ($c === '-' && $i + 1 < $largo && $sql[$i + 1] === '-') {
            while ($i < $largo && $sql[$i] !== "\n") {
                $i++;
            }
            $actual .= "\n";
            continue;
        }
        if ($c === ';') {
            if (trim($actual) !== '') {
                $sentencias[] = trim($actual);
            }
            $actual = '';
            continue;
        }
        $actual .= $c;
    }
    if (trim($actual) !== '') {
        $sentencias[] = trim($actual);
    }
    return $sentencias;
}

/** Corre un script de migracion sentencia por sentencia. Un fallo imprime cual y sale con 1. */
function wa_correr_migracion(PDO $pdo, string $sql): void
{
    foreach (wa_partir_sql($sql) as $n => $sentencia) {
        try {
            $resultado = $pdo->query($sentencia);
            if ($resultado instanceof PDOStatement) {
                $resultado->closeCursor();
            }
        } catch (PDOException $e) {
            $info = (array) $e->errorInfo;
            echo '[FALLO] sentencia #' . ($n + 1) . ' (' . substr((string) preg_replace('/\s+/', ' ', $sentencia), 0, 70)
                . '...) SQLSTATE ' . ($info[0] ?? '?') . ' errno ' . ($info[1] ?? '?') . "\n";
            exit(1);
        }
    }
}

$pdo = wa_pdo($baseArg);
$antes = wa_estado_migraciones($pdo);
echo 'Base de prueba (' . wa_base_corta(wa_base_real($baseArg)) . ")\n";
foreach ($pedidas as $m) {
    if (!isset($antes[$m])) {
        wa_chk("{$m}: tiene fila en tools/verificar_migraciones_tenant.sql", false);
        continue;
    }
    $archivos = glob(dirname(__DIR__) . '/db/migrations/' . $m . '_*.sql') ?: [];
    if (count($archivos) !== 1) {
        wa_chk("{$m}: un solo archivo en db/migrations", false, array_map('basename', $archivos));
        continue;
    }
    if ($antes[$m]['estado'] !== 'APLICADA') {
        wa_correr_migracion($pdo, (string) file_get_contents($archivos[0]));
    }
    $despues = wa_estado_migraciones($pdo);
    wa_chk("{$m}: " . $antes[$m]['estado'] . ' -> ' . ($despues[$m]['estado'] ?? '?') . ' (' . basename($archivos[0]) . ')',
        ($despues[$m]['estado'] ?? null) === 'APLICADA', $despues[$m] ?? null);
}
wa_fin();
```

Check the guards. The first two need no database (a fake user keeps `wa_credenciales` from exiting). The third is a read-only smoke against a migration that is already `APLICADA` on both bases (031), so nothing is executed:

```bash
php -l tools/aplicar_migracion_scratch.php
WA_DB_USER=x WA_DB_PASS=x php -d extension=pdo_mysql tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch_sin_gate --migraciones=027,032; echo "exit=$?"
WA_DB_USER=x WA_DB_PASS=x php -d extension=pdo_mysql tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch --migraciones=32; echo "exit=$?"
php -d extension=pdo_mysql tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch --migraciones=031; echo "exit=$?"
```

Expected:

```
No syntax errors detected in tools/aplicar_migracion_scratch.php
[FALLO] 027 y 028 no se aplican a wa_scratch_sin_gate: esa copia se queda sin la compuerta a proposito
exit=2
[FALLO] migracion invalida: 32 (tres digitos, por ejemplo 032)
exit=2
Base de prueba (wa_scratch)
  [OK  ] 031: APLICADA -> APLICADA (031_conduces.sql)

1 de 1 pruebas OK
exit=0
```

- [ ] **Step 12: Apply 032-034 to both scratch databases, then the gate**

Before this step, both bases show 032, 033 and 034 as `FALTA` (checked read-only on 2026-10-12). `wa_scratch_sin_gate` also shows 027 and 028 as `FALTA`, on purpose, and that must stay.

```bash
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch --migraciones=032,033,034
php $F tools/aplicar_migracion_scratch.php --tenant-db=wa_scratch_sin_gate --migraciones=032,033,034
php $F tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -3
```

Expected, for each of the two apply runs (`APLICADA -> APLICADA` instead of `FALTA -> APLICADA` if someone applied it already):

```
Base de prueba (wa_scratch)
  [OK  ] 032: FALTA -> APLICADA (032_producto_imagen.sql)
  [OK  ] 033: FALTA -> APLICADA (033_facturas_dias_credito.sql)
  [OK  ] 034: FALTA -> APLICADA (034_categorias_color.sql)

3 de 3 pruebas OK
```

The second run prints `Base de prueba (wa_scratch_sin_gate)`. A failing statement prints `[FALLO] sentencia #N (...) SQLSTATE ... errno ...` and exits 1: fix the cause and repeat, the migrations are idempotent. The gate ends with `9 de 9 pruebas OK`. It still asserts that the copy has 027 and 028 as `FALTA` and every other migration, now including 032-034, as `APLICADA`.

- [ ] **Step 13: Run the Release 1 DB suites, strictly serially**

```bash
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/write_ahead_test_lib.php --autoprueba --tenant-db=wa_scratch | tail -1
php $F tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -1
php $F tools/test_write_ahead_ecf.php --tenant-db=wa_scratch | tail -1
WA_PUERTO_OFFSET=100 php $F tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -1
```

Expected last lines:

```
12 de 12 pruebas OK
37 de 37 pruebas OK
253 de 253 pruebas OK
91 de 91 pruebas OK
```

The ecf total is the old 234 plus the 19 checks of section 4 (M1 ×3 × 3, M2 ×4, M3 ×3, M4 ×3). If ports 8097-8099 are busy, prefix `WA_PUERTO_OFFSET=100` to the autoprueba too (any suite that starts servers takes it). Never `cat` the child logs in `%TEMP%`; PF-21 applies. If a suite shows rows you did not create, or a counter off by one, another session is using `wa_scratch`. Wait and rerun that suite.

- [ ] **Step 14: Commit the merge**

```bash
git add tools/aplicar_migracion_scratch.php
git status --short | grep -v -E '^[AMDR]  '
git diff --cached --name-only HEAD | wc -l
git ls-files --eol src/Models/facturaModel.php
```

Expected:
- Only `?? tools/reconstruir_e340000000001.sql` is not staged.
- `45` staged files: master's 42, `tools/test_write_ahead_puro.php`, `tools/test_write_ahead_ecf.php` and `tools/aplicar_migracion_scratch.php`.
- `i/lf    w/lf    attr/                 	src/Models/facturaModel.php`.

```bash
git commit -F - <<'EOF'
merge: trae origin/master (c594c10) a feat/ecf-write-ahead

Migraciones 032 (foto del producto), 033 (dias_credito) y 034 (color de
categoria); el POS (cobro, cierre, E31) con su mock local de la DGII; Reenviar
a la DGII para rechazadas (4007eea) y el plazo de credito de la factura simple.

Conflictos resueltos:
- facturaModel.php: nuestro, sin saveFacturaConECF y en LF (master pasa a LF
  desde ee89b6d); trae dias_credito, tomarLockReenvio y archivarRechazoReenviado
  con un merge a tres bandas sobre la base normalizada.
- ECFEmissionService.php: flujo write-ahead; trae formas_pago en el e-CF,
  dgii_timeout como opcion del envio y reenviarRFCE, consultarTrackIds y
  reenviarECF; sin tolerar_fallo_envio ni RFCE_PENDIENTE / ENVIO_PENDIENTE.
- facturaController.php: emision write-ahead dentro de emitirFacturaEcf (forma
  de master); handleReenviar, armarInputReenvio y campoXmlReenvio de master
  (la Task 9 los pasa al write-ahead).
- inventoryModel.php: yaMovioDocumento y devolverSaldoDeFactura.

Las guardas de la suite sin base se adaptan a emitirFacturaEcf y a la decision 7
redefinida (solo se reemite una rechazada). Nueva tools/aplicar_migracion_scratch.php
para llevar las migraciones de master a las bases de prueba.

PosVenta sigue llamando a saveFacturaConECF hasta la Task 5: no desplegar esta
rama antes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -2
git show -s --format='%h parents: %p' HEAD
git status --short
```

Expected: a merge commit with two parent hashes, `c3dacd8` and `c594c10`, and `git status --short` showing only `?? tools/reconstruir_e340000000001.sql`. Do not push.

**State this task leaves for Tasks 2-16:**
- Red on purpose: the puro guard `nada en src, docs ni CLAUDE.md nombra saveFacturaConECF` (obtained `["src/Pos/PosVenta.php"]`) until Task 5.
- `src/Pos/PosVenta.php` still calls the removed `facturaModel::saveFacturaConECF` (`$saved = $facturas->saveFacturaConECF(...)`). It also calls `emitir()` with no hook and still passes `tolerar_fallo_envio`, which the service now ignores. A POS sale would fatal, so the branch must not be deployed or pushed to master before Task 5.
- Master's POS suites (`tools/test_pos_venta.php`, `test_pos_e31.php`, `test_pos_cierre.php`, `test_pos_backend.php`) still expect `RFCE_PENDIENTE` and `ENVIO_PENDIENTE` and cannot run until Tasks 13-14.
- In `emitirFacturaEcf`, `$reenvioDe` only adds `reenvio_de` to the response. The archive of the rejected row and `inventoryModel::devolverSaldoDeFactura` for the old row are Task 9. The docblock of `emitirFacturaEcf` already describes them.
- Docs and human tests Tasks 9 and 15 own, because they now say something false:
  - `docs/api/facturas.md` says `POST /api/facturas/{id}/reenviar` answers `501` (two places).
  - `tests/test_facturas_write_ahead.http` has the `### Decision 7` request.
  - `docs/api/pos.md` and `docs/specs/pos.md` still name `RFCE_PENDIENTE` and `ENVIO_PENDIENTE`.

---

### Task 2: Merge de origin/main en la rama del front

Run every command from the FE worktree root, in Git Bash: `cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`. Never start `npm run dev` or `vite`, because the `.env` proxies to production. `npm run build` only compiles. The working copies of `src/**` are CRLF (`core.autocrlf=true`). The Edit tool matches the LF text below against them. After a conflicted merge those four files are mixed (CRLF everywhere except the conflict hunks, which git writes with LF), and the hunks match as written.

This task merges `origin/main` (`332996e`, 21 commits and 71 files past the merge base `ff94ae2`) into `feat/ecf-write-ahead` (`6d05ff9`). The resolution rules say `errores.ts` and `types.ts` are the union of both sides, `mappers.ts` is ours, and everything else is main's.
- Git reports four conflicted files, and one is not in the rules: `src/features/invoices/InvoiceListView.tsx`. Release 1 added the Pendientes filter, the "Sin confirmar" KPI and the header chip there. Main changed the same import line to show credit notes in red. Both survive, as the spec asks (section 4.5).
- Everything else main brought merges cleanly, including `InvoiceDetailView.tsx`. It now carries both main's `Reenviar a la DGII` button and our in-flight card.

**Files:**
- Merge: all of `origin/main`. Resolve four conflicted files: `src/api/errores.ts`, `src/api/types.ts`, `src/api/mappers.ts`, `src/features/invoices/InvoiceListView.tsx`.
- Arrive from main with nothing to resolve, do not edit:
  - the POS app under `src/pos/**` (`CobroModal.tsx`, `VentaView.tsx`, `VentasDiaModal.tsx`, `CierreModal.tsx`, `CajaModales.tsx`, `estados.ts`, `reporteCierre.ts`, `api.ts`, ...)
  - `src/features/pos/TurnosPanel.tsx`
  - `src/api/facturas.ts` (`reenviarFactura`), `src/api/products.ts`, `src/api/pos.ts`
  - `src/features/invoices/InvoiceDetailView.tsx`, `InvoiceFormView.tsx`, `SimpleInvoiceFormView.tsx`
  - `src/features/categories/**`, `src/features/products/**`, `src/lib/fotoProducto.ts`
  - four new scripts: `scripts/test-foto-producto.ts`, `test-pos-catalogo.ts`, `test-pos-cierre.ts`, `test-pos-ventas.ts`
- Test: `scripts/check-errores.ts`. Anchors: `import { clasificar, humanizar, networkError } from '../src/api/errores.ts'` and the closing two lines `console.log(`\n${total - fallos}/${total} OK`)` / `if (fallos > 0) process.exit(1)`.

**Interfaces:**
- Consumes (Release 1, unchanged):
  - From `src/api/estadosDgii.ts`: `dgiiLabel`, `isRechazo` and `isEnVuelo`.
  - From `src/features/invoices/enVuelo.ts`: `contarSinConfirmar`, `textoChipSinConfirmar`, `textoTarjetaEnVuelo`, `textoPieDocumento` and `PIE_DOCUMENTO_EN_VUELO`.
  - From `src/api/errores.ts`: `clasificar`, `humanizar` and `networkError`.
- Produces: the merged front that Tasks 11 and 12 anchor on.
  - `reenviarFactura(id: number): Promise<CreateFacturaResponse>` in `src/api/facturas.ts`, exported from `src/api/index.ts`.
  - The `Reenviar a la DGII` button in `InvoiceDetailView.tsx`, shown when `puedeReenviar = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'].includes(estadoRaw ?? '')`.
  - `EstadoDgii` in `src/api/types.ts` now includes the in-flight states `'PENDIENTE_ENVIO' | 'ENVIO_INCIERTO'` and, from main, `'RFCE_PENDIENTE' | 'ENVIO_PENDIENTE'`. The API stops producing the last two once Task 5 lands.
  - `RE_ESTADO_DGII` in `errores.ts` is one regex with both sets, and `esEmisionEcf` also matches `POST /api/facturas/{id}/reenviar`, so a timeout or network cut there gets the emission texts.
  - `src/api/mappers.ts` keeps ours, with `imagen: r.imagen_path || null` from main. The old `DGII_LABEL` map of main is gone: `dgiiLabel` lives in `estadosDgii.ts`. `ESTADO_DGII` in `src/pos/estados.ts` (the cashier-facing wording) is untouched until Task 11.
  - 15 scripts under `scripts/*.ts` (11 + main's 4).

- [ ] **Step 1: Verify the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -1
git fetch origin
git rev-parse --short origin/main
git merge-base HEAD origin/main | cut -c1-7
```

Expected: no output from `git status`, then:

```
6d05ff9 docs(write-ahead): el POS nunca se detiene (factura simple sin certificado, numero siguiente sin rango) y avisos al admin
332996e
ff94ae2
```

If `origin/main` is not `332996e`, continue only if Step 4 reports exactly the same four conflicted files. Otherwise stop and report.

- [ ] **Step 2: Write the failing test (before the merge)**

`scripts/check-errores.ts` is type-checked by `tsc`, because `tsconfig.json` includes `scripts`. Node strips the types at runtime.

Edit 1: replace

```ts
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
```

with

```ts
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
import type { EstadoDgii } from '../src/api/types.ts'
```

Edit 2: replace the closing lines

```ts
console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

with

```ts
// --- Merge con main (Task 2): estados y reenvío de las dos ramas -------------
// types.ts une los estados de las dos ramas. Lo comprueba tsc: scripts/ entra en
// el typecheck (el runtime de node borra el `satisfies`).
const ESTADOS_DE_LAS_DOS_RAMAS = [
  'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', // Release 1: en vuelo
  'RFCE_PENDIENTE', 'ENVIO_PENDIENTE', // main: ventas del POS sin respuesta (la API ya no los produce)
] as const satisfies readonly EstadoDgii[]
console.log('merge con main: estados y textos de las dos ramas')
chk(`EstadoDgii une los estados en vuelo y los del POS de main (${ESTADOS_DE_LAS_DOS_RAMAS.length})`,
  ESTADOS_DE_LAS_DOS_RAMAS.length === 4)
{
  // RE_ESTADO_DGII une los dos regex: citar un estado de main no parece técnico.
  const tipo = clasificar(`La venta ${ENCF} está en estado ENVIO_PENDIENTE.`)
  chk(`texto que cita ENVIO_PENDIENTE -> null (dio ${tipo})`, tipo === null)
}
// POST /api/facturas/{id}/reenviar emite un e-CF nuevo (main): un fallo a mitad
// pudo dejarlo ya enviado, así que usa los textos de la emisión y no los de una
// escritura cualquiera.
const REENVIO = { metodo: 'POST', path: '/api/facturas/41/reenviar' }
console.warn = () => {}
try {
  igual('timeout de POST /reenviar -> MSG_TARDO_EMISION',
    networkError(new DOMException('', 'TimeoutError'), REENVIO).message, MSG_TARDO_EMISION)
  igual('corte de red en POST /reenviar -> MSG_SIN_CONEXION_EMISION',
    networkError(new TypeError('Failed to fetch'), REENVIO).message, MSG_SIN_CONEXION_EMISION)
  igual('corte de red en GET /api/facturas/41/reenviar -> MSG_SIN_CONEXION de siempre',
    networkError(new TypeError('Failed to fetch'), { metodo: 'GET', path: '/api/facturas/41/reenviar' }).message, MSG_SIN_CONEXION)
} finally {
  console.warn = warn
}
igual('504 de POST /reenviar -> MSG_TARDO_EMISION', humanizar('', 504, REENVIO).mensaje, MSG_TARDO_EMISION)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

`warn` is the `console.warn` saved earlier in the same file, in the block that tests the timeouts.

- [ ] **Step 3: Run it and watch it fail (the tree is still unmerged)**

```bash
node scripts/check-errores.ts | sed -n '/merge con main/,$p'
npm run -s typecheck
```

Expected from `node`, exit 1:

```
merge con main: estados y textos de las dos ramas
  [OK  ] EstadoDgii une los estados en vuelo y los del POS de main (4)
  [FALLA] texto que cita ENVIO_PENDIENTE -> null (dio interno)
  [FALLA] timeout de POST /reenviar -> MSG_TARDO_EMISION: dio "El servidor tardó demasiado en responder. Puede que sí se haya guardado: ...
  [FALLA] corte de red en POST /reenviar -> MSG_SIN_CONEXION_EMISION: dio "No se pudo conectar con el servidor. ...
  [OK  ] corte de red en GET /api/facturas/41/reenviar -> MSG_SIN_CONEXION de siempre
  [FALLA] 504 de POST /reenviar -> MSG_TARDO_EMISION: dio "El servidor tardó demasiado en responder. Puede que sí se haya guardado: ...

53/57 OK
```

Expected from `typecheck`, exit 2. The two errors are the compile-time half of the same guard:

```
scripts/check-errores.ts(165,3): error TS2322: Type '"RFCE_PENDIENTE"' is not assignable to type 'EstadoDgii'.
scripts/check-errores.ts(165,21): error TS2322: Type '"ENVIO_PENDIENTE"' is not assignable to type 'EstadoDgii'.
```

- [ ] **Step 4: Start the merge and confirm the four conflicts**

```bash
git merge --no-commit --no-ff origin/main 2>&1 | grep -E "CONFLICT|Automatic"
git status --short | grep -E '^(UU|AA|DU|UD)'
```

Expected:

```
CONFLICT (content): Merge conflict in src/api/errores.ts
CONFLICT (content): Merge conflict in src/api/mappers.ts
CONFLICT (content): Merge conflict in src/api/types.ts
CONFLICT (content): Merge conflict in src/features/invoices/InvoiceListView.tsx
Automatic merge failed; fix conflicts and then commit the result.
UU src/api/errores.ts
UU src/api/mappers.ts
UU src/api/types.ts
UU src/features/invoices/InvoiceListView.tsx
```

- [ ] **Step 5: `errores.ts`: union of the two state regexes**

Replace

```
<<<<<<< HEAD
  /\b(RFCE_)?(PENDIENTE_ENVIO|ENVIO_INCIERTO|ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|ACEPTADO|RECHAZADO|ENVIADO)\b/g
=======
  /\b(RFCE_)?(ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|ENVIO_PENDIENTE|PENDIENTE|ACEPTADO|RECHAZADO|ENVIADO)\b/g
>>>>>>> origin/main
```

with

```
  /\b(RFCE_)?(PENDIENTE_ENVIO|ENVIO_INCIERTO|ENVIO_PENDIENTE|ACEPTADO_CONDICIONAL|RECHAZADO_ARCHIVADO|EN_PROCESO|NO_ENCONTRADO|PENDIENTE_EMISION|PENDIENTE|ACEPTADO|RECHAZADO|ENVIADO)\b/g
```

Main's other change in this file, `esEmisionEcf` with `(\/\d+\/reenviar)?`, merged on its own.

- [ ] **Step 6: `types.ts`: union of the state literals**

Replace

```
<<<<<<< HEAD
  // En vuelo: guardada antes de enviar a la DGII, sin respuesta todavía.
  | 'PENDIENTE_ENVIO'
  | 'ENVIO_INCIERTO'
=======
  | 'RFCE_PENDIENTE'
  | 'ENVIO_PENDIENTE'
>>>>>>> origin/main
```

with

```
  // En vuelo: guardada antes de enviar a la DGII, sin respuesta todavía.
  | 'PENDIENTE_ENVIO'
  | 'ENVIO_INCIERTO'
  // Estados del POS de main que la API ya no produce (los reemplaza ENVIO_INCIERTO);
  // siguen en el tipo mientras algún componente de main los compare.
  | 'RFCE_PENDIENTE'
  | 'ENVIO_PENDIENTE'
```

- [ ] **Step 7: `InvoiceListView.tsx`: both import lines**

Replace

```
<<<<<<< HEAD
import { conSigno, lineasVinculo, montoTotalKpi, sumaConSigno } from './notasVinculadas'
import { contarSinConfirmar, textoChipSinConfirmar } from './enVuelo'
=======
import { conSigno, esNotaCredito, lineasVinculo, montoTotalKpi, sumaConSigno } from './notasVinculadas'
>>>>>>> origin/main
```

with

```
import { conSigno, esNotaCredito, lineasVinculo, montoTotalKpi, sumaConSigno } from './notasVinculadas'
import { contarSinConfirmar, textoChipSinConfirmar } from './enVuelo'
```

- [ ] **Step 7b: `mappers.ts`: ours (drop main's `DGII_LABEL` block)**

In this file our side of the hunk is empty (Release 1 moved the labels to `estadosDgii.ts`) and main's side is the old `DGII_LABEL` map and `dgiiLabel`. The hunk is deleted, markers included. Main's one-line `imagen: r.imagen_path || null` in `mapProductRow` merged on its own and stays.

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs'
const f = 'src/api/mappers.ts'
const t = readFileSync(f, 'utf8')
const a = t.indexOf('<<<<<<< HEAD')
const m = t.indexOf('>>>>>>> origin/main')
if (a < 0 || m < 0 || t.indexOf('<<<<<<<', a + 1) >= 0) throw new Error('hunk inesperado')
writeFileSync(f, t.slice(0, a) + t.slice(t.indexOf('\n', m) + 1))
console.log('mappers.ts: hunk resuelto')
"
```

Expected: `mappers.ts: hunk resuelto`.

- [ ] **Step 8: Verify the resolution**

```bash
git add src/api/errores.ts src/api/mappers.ts src/api/types.ts src/features/invoices/InvoiceListView.tsx scripts/check-errores.ts
git grep -n -E "^(<<<<<<<|>>>>>>>) " -- src scripts | wc -l
git status --short | grep -v -E '^[AMDR]  '
git diff --cached --name-only HEAD | wc -l
grep -c "imagen: r.imagen_path" src/api/mappers.ts
grep -c "puedeReenviar" src/features/invoices/InvoiceDetailView.tsx
grep -c "textoTarjetaEnVuelo" src/features/invoices/InvoiceDetailView.tsx
grep -c "contarSinConfirmar" src/features/invoices/InvoiceListView.tsx
grep -c "esNotaCredito" src/features/invoices/InvoiceListView.tsx
```

Expected: `0` conflict markers and no unstaged or untracked paths. Then `72` staged files: the 71 files main changed plus `scripts/check-errores.ts`. Then `1`, `2`, `2`, `2`, `3`: main's product image, main's `Reenviar` button and Release 1's in-flight card side by side, and Release 1's chip next to main's red credit notes.

```bash
npm run -s typecheck; echo "typecheck exit=$?"
for s in scripts/*.ts; do printf '%s: ' "$s"; node "$s" 2>&1 | tail -1; done
npm run -s build; echo "build exit=$?"
npx eslint . --ignore-pattern ds-bundle; echo "eslint exit=$?"
```

Expected:

```
typecheck exit=0
scripts/check-errores.ts: 57/57 OK
scripts/parity-cotizacion-ferreteria.ts: 100/100 OK
scripts/test-conversion-conduce.ts: 50/50 OK
scripts/test-conversion-ferreteria.ts: 30/30 OK
scripts/test-en-vuelo.ts: 15/15 OK
scripts/test-foto-producto.ts: 20/20 OK
scripts/test-lineas-ferreteria.ts: 24/24 OK
scripts/test-nav-formato.ts: 86/86 OK
scripts/test-notas-vinculadas.ts: 45/45 OK
scripts/test-pos-catalogo.ts: 17/17 OK
scripts/test-pos-cierre.ts: 19/19 OK
scripts/test-pos-montos.ts: 65/65 OK
scripts/test-pos-ventas.ts: 26/26 ok
scripts/test-schema-conduce.ts: 49/49 OK
scripts/test-schema-cotizacion-ferreteria.ts: 25/25 OK
build exit=0
eslint exit=0
```

- The `build` prints `built in` plus the usual "chunks are larger than 500 kB" warning. That warning is not new.
- `eslint` prints nothing. Without `--ignore-pattern ds-bundle`, ESLint fails on `ds-bundle/_vendor/react.js`, tracked on main since `8ead2b2`. That is a separate fix.

- [ ] **Step 9: Commit the merge**

```bash
git commit -F - <<'EOF'
merge: trae origin/main (332996e) a feat/ecf-write-ahead

POS (cobro, cierre de turno, ventas del dia, E31 a credito, ventas abiertas),
Reenviar a la DGII para rechazados, fotos de producto y colores de categoria.

Conflictos resueltos:
- errores.ts: RE_ESTADO_DGII une los estados en vuelo con ENVIO_PENDIENTE y
  PENDIENTE de main; esEmisionEcf de main (el reenvio tambien emite) entra solo.
- types.ts: EstadoDgii une los estados en vuelo y los del POS de main.
- mappers.ts: el nuestro; dgiiLabel e isRechazo viven en estadosDgii.ts
  (de main entra la imagen del producto).
- InvoiceListView.tsx: nuestro filtro Pendientes y chip Sin confirmar, con las
  notas de credito en rojo de main.

scripts/check-errores.ts: guardas del merge (estados de las dos ramas y los
textos de emision del reenvio).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -2
git show -s --format='%h parents: %p' HEAD
git status --short
```

Expected: a merge commit with the parents `6d05ff9` and `332996e`, and an empty `git status`. Do not push.

**State this task leaves for Tasks 11 and 12:**
- The cashier-facing DGII wording of main is untouched until Task 11:
  - `src/pos/CobroModal.tsx` has "La DGII recibió la factura y la está validando" and "La DGII no respondió a tiempo. La venta quedó registrada y se reenviará sola."
  - `src/pos/VentaView.tsx` has the `sin confirmar DGII` chip and "La DGII rechazó …".
  - `src/pos/estados.ts` has `ESTADO_DGII` ("Sin confirmar DGII", "DGII validando", "Rechazada").
  - `src/pos/reporteCierre.ts` has "Pendientes de la DGII" and "Rechazadas por la DGII".
- The POS front still speaks main's old sale contract (422 `DGII_RECHAZO`, `envio_pendiente`, `RFCE_PENDIENTE`) until Tasks 5-8 change the API.
- `scripts/` now holds 15 scripts. Tasks 11 and 12 update them and re-run the full list above.


### Task 3: facturaModel para filas del POS y EstadosEcf::envioPendiente

Run every command from the API worktree root (`C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`). This task runs on the tree **after Task 1** (origin/master merged, `src/Models/facturaModel.php` with LF endings). Every edit is anchored on quoted text, not on line numbers, because Task 1 moved them. Each "Replace" block must match exactly once in its file; the Edit tool refuses a text that appears twice or not at all, and that refusal is the check. Re-read a file right before editing it. Line endings: `facturaModel.php` is LF after Task 1, and the other files this task touches may still be CRLF on disk (`core.autocrlf=true`); the Edit tool keeps each file's own ending, so the quoted anchors below match either way. The DB suites share the scratch database and `wa_limpiar` wipes every `facturas` row and every `ncf_sequences` counter: run them strictly one at a time.

**Why.** A POS sale is a `facturas` row like any other, plus four columns from migration 030 (`turno_id`, `pos_empleado_id`, `pos_idempotency_key` with the unique key `uk_facturas_pos_idem`, `envio_pendiente`). Master wrote them in `saveFacturaConECF`, which Release 1 deleted. This task moves them into the write-ahead reserve and keeps `envio_pendiente` in step with `estado_dgii` (spec 4.2.2 and 4.2.8):
- the reserve INSERT writes the four columns when `$factura['pos']` is an array, and only then;
- a 1062 on `uk_facturas_pos_idem` means "this sale already has an invoice", not "e-NCF taken";
- `confirmarFacturaECF` and `marcarEnvioIncierto` write `envio_pendiente` in the same UPDATE as `estado_dgii`, and only on rows that carry a `pos_idempotency_key`.

**Review Focus.** The model half of RF1 is pinned here, on real InnoDB: a second reserve with the same clave (different e-NCF) throws `EcfVentaRepetidaException` and leaves no row, so one clave can never own two e-NCF (checks `POS repetida ...` in `tools/test_reservar_confirmar.php`). The service and POS halves are Tasks 4 and 5.

**Deploy gate.** Those two UPDATEs now name `pos_idempotency_key` and `envio_pendiente` for every invoice, app invoices included, so migration 030 has to be applied on every tenant DB before this code is deployed (`tools/verificar_migraciones_tenant.sql` already checks it). On a tenant without it every confirm fails and the invoice ends "sin confirmar". Today `CLAUDE.md` names only 027 and 028 as the release gate of the write-ahead, and the onboarding runbook calls 030 mandatory only where the POS is used; Task 15 must add 030 to that gate sentence and fix the runbook line, because after this task every tenant needs it.

**Files:**
- Create: `src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php`.
- Modify: `src/Utils/FacturacionElectronica/EstadosEcf.php`. Anchor: the end of `sql()`, the line `return "'" . implode("', '", $estados) . "'";` and the `}` that closes the class.
- Modify: `src/Models/facturaModel.php`. Anchors, all quoted in Step 5: the `require_once` of `EcfNumeroOcupadoException.php`; the docblock and body of `reservarFacturaECF`; `confirmarFacturaECF`; `marcarEnvioIncierto`.
- Modify: `tools/test_write_ahead_puro.php`: new section 14 directly above the closing block (the two lines `// ---...---` and `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`).
- Modify: `tools/test_reservar_confirmar.php`: new cases directly above its closing block (`// Cierre. Cada tarea agrega sus casos justo encima de este bloque.`).
- Test: `php tools/test_write_ahead_puro.php` (section 14), `tools/test_reservar_confirmar.php` (new header `== reserva del POS en wa_scratch ==`), and `tools/test_write_ahead_ecf.php` as a regression (its real hook now runs the new UPDATEs).

**Interfaces:**
- Consumes (Release 1, unchanged names):
  - `facturaModel::reservarFacturaECF(array $factura, array $ctx): array`, `confirmarFacturaECF(int $id, array $ctx): bool`, `marcarEnvioIncierto(int $id, array $ctx): bool`;
  - `EstadosEcf::EN_VUELO`, `EstadosEcf::SIN_VEREDICTO`, `EstadosEcf::PENDIENTE_ENVIO`, `EstadosEcf::ENVIO_INCIERTO`, `EstadosEcf::sql()`;
  - `EcfNumeroOcupadoException(string $eNcf, string $ambiente, string $causa, ?Throwable $previous = null)`;
  - migration 030 on `facturas`: `turno_id INT NULL`, `pos_empleado_id INT NULL`, `pos_idempotency_key CHAR(36) NULL` (unique `uk_facturas_pos_idem`), `envio_pendiente TINYINT(1) NOT NULL DEFAULT 0`. The scratch bases already have them (`db/tenant_schema.sql`);
  - test helpers: from `tools/test_write_ahead_puro.php` sections 5 and 6 `GuionConexion`, `puro_modelo`, `puro_con_log`, `puro_pdo_error`, `puro_ctx_reservar`, `puro_ctx_confirmar`, `puro_ctx_incierto`, `puro_factura` and the closures `$reservar`, `$confirmar`, `$marcar`, `$es`; from `tools/test_reservar_confirmar.php` `rc_factura`, `rc_ctx`, `rc_fila_previa`, `rc_confirmar`, `rc_incierto`, `rc_con_log`, `rc_desc`; from `tools/write_ahead_test_lib.php` `wa_usar_base`, `wa_sembrar`, `wa_limpiar`, `wa_filas`, `wa_chk`.
- Produces:

```php
// src/Utils/FacturacionElectronica/EstadosEcf.php
public static function envioPendiente(string $estado): int   // 1 if $estado is in EN_VUELO or SIN_VEREDICTO, else 0

// src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php (new)
class EcfVentaRepetidaException extends RuntimeException
{
    public string $clave;
    public function __construct(string $clave, ?Throwable $previous = null);
}

// src/Models/facturaModel.php
// reservarFacturaECF(array $factura, array $ctx): array   (return shape unchanged: factura_id, e_ncf, desde)
//   $factura['pos'] = ['turno_id' => ?int, 'pos_empleado_id' => ?int, 'pos_idempotency_key' => string (1..36 chars)]
//   with 'pos': the INSERT also writes turno_id, pos_empleado_id, pos_idempotency_key and envio_pendiente = 1;
//   without it: the INSERT is exactly the Release 1 one (no POS column named).
//   A 1062 whose driver message names uk_facturas_pos_idem throws new EcfVentaRepetidaException($clave, $pdoException);
//   any other 1062 stays EcfNumeroOcupadoException. A 'pos' block without a usable key throws InvalidArgumentException
//   before any query. The whole transaction is rolled back, so the archive of a retryable row of the same e-NCF is undone too.
// confirmarFacturaECF / marcarEnvioIncierto: same signatures; the one UPDATE also sets
//   envio_pendiente = CASE WHEN pos_idempotency_key IS NOT NULL THEN :pend ELSE envio_pendiente END
//   with :pend = EstadosEcf::envioPendiente(<new estado>) (ENVIO_INCIERTO for marcarEnvioIncierto).
```
- The ctx that `ECFEmissionService` passes to the hook does not change: a POS hook closure keeps forwarding `$ctx` untouched, as `facturaController` does.

- [ ] **Step 1: Check the tree**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git switch feat/ecf-write-ahead
git status --short
git log --oneline -1
php tools/test_write_ahead_puro.php | grep -E "FALLO|pruebas OK"
```

Expected:
- `git status --short` prints only `?? tools/reconstruir_e340000000001.sql` (never `git add -A`; never stage it);
- `git log` shows the Task 1 merge commit on top;
- the `grep` prints the `[FALLO]` lines that Task 1 knowingly left, then the summary. With only the known guard that is `  [FALLO] nada en src, docs ni CLAUDE.md nombra saveFacturaConECF` (`src/Pos/PosVenta.php` from master still names it until Task 5) and `181 de 182 pruebas OK`. If the controller Task 1 merged carries master's real `handleReenviar`, `POST /reenviar sigue respondiendo 501 (decision 7)` is a second known `[FALLO]` (Task 9 rewrites it) and the summary reads `180 de 182`. Write down the `[FALLO]` lines and both numbers: below, the same `[FALLO]` lines must stay, and both numbers grow by exactly the checks the task adds. The run exits with code 1 while any `[FALLO]` stands. The counts quoted below assume the one-guard baseline.

- [ ] **Step 2: Write the failing section 14 (DB-free)**

In `tools/test_write_ahead_puro.php`, insert this block directly above the closing block (before the `// ---...---` line that precedes `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`):

```php
// ---------------------------------------------------------------------------
// 14) POS: EstadosEcf::envioPendiente, la reserva con las columnas del POS, la
// venta repetida y envio_pendiente sincronizado en confirmar/incierto
// (Task 3 del plan POS y reenvio). Conexion falsa: nada toca MySQL. Reusa
// GuionConexion, $reservar, $confirmar, $marcar y $es de las secciones 5 y 6.
// ---------------------------------------------------------------------------
echo "\n== 14) POS: envio_pendiente, columnas del POS en la reserva y venta repetida ==\n";

$envioPendienteEsperado = [
    // Sin veredicto de la DGII: el reenvio automatico del POS los busca.
    'PENDIENTE_ENVIO' => 1, 'ENVIO_INCIERTO' => 1, 'ENVIADO' => 1, 'EN_PROCESO' => 1, 'RFCE_ENVIADO' => 1, 'RFCE_EN_PROCESO' => 1,
    // Veredicto final, o un numero que no se reenvia solo (ERROR, NO_ENCONTRADO).
    'ACEPTADO' => 0, 'ACEPTADO_CONDICIONAL' => 0, 'RECHAZADO' => 0, 'NO_ENCONTRADO' => 0, 'ERROR' => 0,
    'RFCE_ACEPTADO' => 0, 'RFCE_RECHAZADO' => 0, 'RFCE_NO_ENCONTRADO' => 0, 'RFCE_ERROR' => 0,
    'RECHAZADO_ARCHIVADO' => 0, '' => 0,
];
$envioPendienteObtenido = [];
foreach ($envioPendienteEsperado as $estado => $_) {
    $envioPendienteObtenido[$estado] = EstadosEcf::envioPendiente((string) $estado);
}
wa_chk('14: EstadosEcf::envioPendiente es 1 solo para un estado sin veredicto', $envioPendienteObtenido === $envioPendienteEsperado,
    $envioPendienteObtenido);
$fueraDeLista = [];
foreach (array_merge(EstadosEcf::EN_VUELO, EstadosEcf::SIN_VEREDICTO) as $estado) {
    if (EstadosEcf::envioPendiente($estado) !== 1) {
        $fueraDeLista[] = $estado . '=0';
    }
}
foreach (EstadosEcf::SIN_STOCK as $estado) {
    if (EstadosEcf::envioPendiente($estado) !== 0) {
        $fueraDeLista[] = $estado . '=1';
    }
}
wa_chk('14: EstadosEcf::envioPendiente coincide con EN_VUELO, SIN_VEREDICTO y SIN_STOCK', $fueraDeLista === [], $fueraDeLista);

require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php';
$clavePos = '4f1c2d3e-0a1b-4c5d-8e9f-0123456789ab';
$repetida = new EcfVentaRepetidaException($clavePos, new RuntimeException('previa'));
wa_chk('14: EcfVentaRepetidaException es RuntimeException (no EcfUsuarioException) y lleva la clave',
    $repetida instanceof RuntimeException && !($repetida instanceof EcfUsuarioException) && $repetida->clave === $clavePos
    && str_contains($repetida->getMessage(), $clavePos) && $repetida->getPrevious()?->getMessage() === 'previa',
    [get_class($repetida), $repetida->getMessage()]);

$pos = ['turno_id' => 3, 'pos_empleado_id' => 4, 'pos_idempotency_key' => $clavePos];
$c = new GuionConexion();
[$r, $e] = $reservar($c, [], ['pos' => $pos]);
$insert = (string) $c->sql('INSERT INTO facturas');
$fila = $c->params('INSERT INTO facturas') ?? [];
wa_chk('14: reserva del POS: las 4 columnas de la migracion 030 van en el mismo INSERT',
    $e === null && str_contains($insert, 'razon_modificacion, turno_id, pos_empleado_id, pos_idempotency_key, envio_pendiente)')
    && str_contains($insert, ':razon_modificacion, :turno_id, :pos_empleado_id, :pos_idempotency_key, :envio_pendiente)'),
    $e?->getMessage() ?? $insert);
wa_chk('14: reserva del POS: turno, empleado, clave y envio_pendiente = 1 (nace sin veredicto)',
    $es($fila, ':turno_id', 3) && $es($fila, ':pos_empleado_id', 4) && $es($fila, ':pos_idempotency_key', $clavePos)
    && $es($fila, ':envio_pendiente', 1) && $es($fila, ':estado_dgii', 'PENDIENTE_ENVIO'), $fila);
wa_chk('14: reserva del POS: devuelve las mismas tres claves de siempre',
    $r === ['factura_id' => 41, 'e_ncf' => 'E310000000123', 'desde' => '2026-10-05 14:03:11'], $r);
wa_chk('14: reserva del POS: una transaccion, un commit y nada abierto',
    count($c->de('beginTransaction')) === 1 && count($c->de('commit')) === 1 && $c->de('rollBack') === [] && !$c->inTransaction(),
    $c->llamadas);

$c = new GuionConexion();
[, $e] = $reservar($c);
$insert = (string) $c->sql('INSERT INTO facturas');
$fila = $c->params('INSERT INTO facturas') ?? [];
wa_chk('14: reserva de la app (sin pos): el INSERT no nombra ninguna columna del POS (un tenant sin la 030 sigue andando)',
    $e === null && !str_contains($insert, 'turno_id') && !str_contains($insert, 'pos_empleado_id')
    && !str_contains($insert, 'pos_idempotency_key') && !str_contains($insert, 'envio_pendiente')
    && !array_key_exists(':turno_id', $fila) && !array_key_exists(':envio_pendiente', $fila), $e?->getMessage() ?? $insert);

$malos = [];
foreach ([
    'sin clave' => ['turno_id' => 3, 'pos_empleado_id' => 4],
    'clave en blanco' => ['turno_id' => 3, 'pos_empleado_id' => 4, 'pos_idempotency_key' => '  '],
    'clave de 37 caracteres' => ['turno_id' => 3, 'pos_empleado_id' => 4, 'pos_idempotency_key' => str_repeat('a', 37)],
] as $nombre => $posMalo) {
    $c = new GuionConexion();
    [, $e] = $reservar($c, [], ['pos' => $posMalo]);
    if (!($e instanceof InvalidArgumentException) || $c->llamadas !== []) {
        $malos[$nombre] = [$e === null ? null : get_class($e), count($c->llamadas)];
    }
}
wa_chk('14: pos sin clave valida: InvalidArgumentException antes de cualquier consulta', $malos === [], $malos);

$c = new GuionConexion();
$duplicadoPos = puro_pdo_error(1062, '23000', "Duplicate entry '{$clavePos}' for key 'facturas.uk_facturas_pos_idem'");
$c->errores[] = ['INSERT INTO facturas', $duplicadoPos];
[, $e] = $reservar($c, [], ['pos' => $pos]);
wa_chk('14: 1062 sobre uk_facturas_pos_idem: EcfVentaRepetidaException con la clave y el PDOException como previa',
    $e instanceof EcfVentaRepetidaException && $e->clave === $clavePos && $e->getPrevious() === $duplicadoPos,
    $e === null ? null : get_class($e));
wa_chk('14: venta repetida: rollBack, sin commit y nada abierto (el archivo de la fila previa tambien se deshace)',
    count($c->de('rollBack')) === 1 && $c->de('commit') === [] && !$c->inTransaction(), $c->llamadas);

$c = new GuionConexion();
$c->errores[] = ['INSERT INTO facturas', puro_pdo_error(1062, '23000', "Duplicate entry '{$clavePos}' for key 'uk_facturas_pos_idem'")];
[, $e] = $reservar($c, [], ['pos' => $pos]);
wa_chk('14: el mismo 1062 con el nombre de la clave sin prefijo de tabla (MariaDB, MySQL 5.7)',
    $e instanceof EcfVentaRepetidaException && $e->clave === $clavePos, $e === null ? null : get_class($e));

$c = new GuionConexion();
$c->errores[] = ['INSERT INTO facturas', puro_pdo_error(1062, '23000', "Duplicate entry 'E310000000123-ecf' for key 'facturas.uk_e_ncf_amb'")];
[, $e] = $reservar($c, [], ['pos' => $pos]);
wa_chk('14: 1062 sobre uk_e_ncf_amb en una reserva del POS: EcfNumeroOcupadoException, no venta repetida',
    $e instanceof EcfNumeroOcupadoException && !($e instanceof EcfVentaRepetidaException), $e === null ? null : get_class($e));

$c = new GuionConexion();
$confirmar($c);
$sql = (string) $c->sql('UPDATE facturas SET estado_dgii');
wa_chk('14: confirmar: envio_pendiente va en el MISMO UPDATE y solo cambia en filas con pos_idempotency_key',
    str_contains($sql, 'envio_pendiente = CASE WHEN pos_idempotency_key IS NOT NULL THEN :pend ELSE envio_pendiente END')
    && str_contains($sql, "WHERE id = :id AND estado_dgii IN ('PENDIENTE_ENVIO', 'ENVIO_INCIERTO')")
    && count($c->de('prepare')) === 1 && $c->de('beginTransaction') === [], $sql);
$pendEsperado = [
    'ACEPTADO' => 0, 'ACEPTADO_CONDICIONAL' => 0, 'ENVIADO' => 1, 'EN_PROCESO' => 1, 'RFCE_ENVIADO' => 1, 'RFCE_EN_PROCESO' => 1,
    'RFCE_ACEPTADO' => 0, 'RECHAZADO' => 0, 'RFCE_RECHAZADO' => 0, 'NO_ENCONTRADO' => 0, 'ERROR' => 0,
];
$pendObtenido = [];
foreach ($pendEsperado as $estado => $_) {
    $c = new GuionConexion();
    $confirmar($c, ['estado' => $estado]);
    $pendObtenido[$estado] = ($c->params('UPDATE facturas SET estado_dgii') ?? [])[':pend'] ?? 'falta';
}
wa_chk('14: confirmar: :pend es EstadosEcf::envioPendiente del estado nuevo (veredicto abierto = 1)',
    $pendObtenido === $pendEsperado, $pendObtenido);

$c = new GuionConexion();
$marcar($c, puro_ctx_incierto());
$sql = (string) $c->sql("estado_dgii = 'ENVIO_INCIERTO'");
$p = $c->params("estado_dgii = 'ENVIO_INCIERTO'") ?? [];
wa_chk('14: marcar incierto: envio_pendiente = 1 en el MISMO UPDATE y solo en filas del POS',
    str_contains($sql, 'envio_pendiente = CASE WHEN pos_idempotency_key IS NOT NULL THEN :pend ELSE envio_pendiente END')
    && str_contains($sql, "WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'")
    && $es($p, ':pend', 1) && $es($p, ':id', 41) && count($c->de('prepare')) === 1, [$sql, $p]);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `php tools/test_write_ahead_puro.php | tail -8`

Expected: sections 1-13 print as before (the same known `[FALLO]` lines), then the header `== 14) POS: envio_pendiente, columnas del POS en la reserva y venta repetida ==` and

```
Fatal error: Uncaught Error: Call to undefined method EstadosEcf::envioPendiente() in .../tools/test_write_ahead_puro.php:<line>
```

exit code 255.

- [ ] **Step 4: Write the failing DB cases**

In `tools/test_reservar_confirmar.php`, insert this block directly above the closing block (before the `// ---...---` line that precedes `// Cierre. Cada tarea agrega sus casos justo encima de este bloque.`). It reuses `rc_factura`, `rc_ctx`, `rc_fila_previa`, `rc_confirmar`, `rc_incierto`, `rc_con_log` and `rc_desc`, all defined earlier in the file:

```php
// ---------------------------------------------------------------------------
// Reserva del POS: las columnas de la 030, la venta repetida (1062 sobre
// uk_facturas_pos_idem) y envio_pendiente sincronizado en confirmar e incierto
// (Task 3 del plan POS y reenvio).
// ---------------------------------------------------------------------------
echo "\n== reserva del POS en {$base} ==\n";
$pdo = wa_usar_base($base);
$sem = wa_sembrar($pdo);
$factura = rc_factura($sem['client_id'], [$sem['product_id']]);
$modelo = new facturaModel();
wa_limpiar($pdo);

/** Clave de idempotencia de prueba: un UUID de 36 caracteres que cambia con $n. */
function rc_clave(int $n): string
{
    return sprintf('00000000-0000-4000-8000-%012d', $n);
}

/** Las columnas del POS de una factura (y su estado). */
function rc_pos_cols(PDO $pdo, int $id): array
{
    $st = $pdo->prepare(
        'SELECT turno_id, pos_empleado_id, pos_idempotency_key, envio_pendiente, estado_dgii FROM facturas WHERE id = :id'
    );
    $st->execute([':id' => $id]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: [];
}

/** El bloque 'pos' de $facturaInput para la venta numero $n. */
function rc_pos(int $n): array
{
    return ['turno_id' => 7, 'pos_empleado_id' => 8, 'pos_idempotency_key' => rc_clave($n)];
}

// POS 1: la reserva del POS guarda las cuatro columnas y nace con envio_pendiente = 1.
[$r, $e] = rc_con_log(fn() => $modelo->reservarFacturaECF($factura + ['pos' => rc_pos(1)], rc_ctx('E310000009101')));
$cols = rc_pos_cols($pdo, (int) ($r['factura_id'] ?? 0));
wa_chk('POS: la reserva guarda turno, empleado, clave y envio_pendiente = 1 en PENDIENTE_ENVIO',
    $e === null && (int) ($cols['turno_id'] ?? 0) === 7 && (int) ($cols['pos_empleado_id'] ?? 0) === 8
    && ($cols['pos_idempotency_key'] ?? null) === rc_clave(1) && (int) ($cols['envio_pendiente'] ?? 9) === 1
    && ($cols['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO', $e !== null ? rc_desc($e) : $cols);

// POS 2: la reserva de la app deja las columnas del POS como estaban (NULL y 0).
$r = $modelo->reservarFacturaECF($factura, rc_ctx('E310000009102'));
$cols = rc_pos_cols($pdo, $r['factura_id']);
wa_chk('app: la reserva sin pos deja turno, empleado y clave en NULL y envio_pendiente en 0',
    $cols['turno_id'] === null && $cols['pos_empleado_id'] === null && $cols['pos_idempotency_key'] === null
    && (int) $cols['envio_pendiente'] === 0, $cols);

// POS 3: la misma clave con otro numero es una venta repetida: ninguna fila nueva y nada abierto.
$filasAntes = (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn();
[, $e] = rc_con_log(fn() => $modelo->reservarFacturaECF($factura + ['pos' => rc_pos(1)], rc_ctx('E310000009103')));
wa_chk('POS repetida: EcfVentaRepetidaException con la clave y el PDOException 1062 como previa (no EcfNumeroOcupadoException)',
    $e instanceof EcfVentaRepetidaException && $e->clave === rc_clave(1) && $e->getPrevious() instanceof PDOException
    && (int) ($e->getPrevious()->errorInfo[1] ?? 0) === 1062, rc_desc($e));
wa_chk('POS repetida: ninguna fila nueva y nada abierto',
    (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn() === $filasAntes
    && wa_filas($pdo, 'E310000009103') === [] && !$pdo->inTransaction());

// POS 4: la repetida deshace tambien el archivo de la fila previa del numero nuevo.
$eNcf = 'E310000009104';
$previa = rc_fila_previa($pdo, $eNcf, 'RECHAZADO');
[, $e] = rc_con_log(fn() => $modelo->reservarFacturaECF($factura + ['pos' => rc_pos(1)], rc_ctx($eNcf)));
$filas = wa_filas($pdo, $eNcf);
wa_chk('POS repetida con una previa RECHAZADO del numero: la previa NO queda archivada',
    $e instanceof EcfVentaRepetidaException && count($filas) === 1 && (int) $filas[0]['id'] === $previa
    && $filas[0]['estado_dgii'] === 'RECHAZADO' && $filas[0]['e_ncf'] === $eNcf, $e !== null ? rc_desc($e) : $filas);

// POS 5: otra clave con el numero ocupado por una fila ACEPTADO: sigue siendo "ocupado".
$eNcf = 'E310000009105';
rc_fila_previa($pdo, $eNcf, 'ACEPTADO');
[, $e] = rc_con_log(fn() => $modelo->reservarFacturaECF($factura + ['pos' => rc_pos(5)], rc_ctx($eNcf)));
wa_chk('POS con el numero ocupado: EcfNumeroOcupadoException, no venta repetida',
    $e instanceof EcfNumeroOcupadoException && !($e instanceof EcfVentaRepetidaException), rc_desc($e));

// POS 6: confirmar escribe envio_pendiente en la misma sentencia que el estado, solo en filas del POS.
$numeroConfirmar = 9200;
$pendienteTras = static function (string $estado, bool $esPos) use ($pdo, $modelo, $factura, &$numeroConfirmar): int {
    $numeroConfirmar++;
    $reserva = $modelo->reservarFacturaECF(
        $esPos ? $factura + ['pos' => rc_pos($numeroConfirmar)] : $factura,
        rc_ctx('E31000000' . $numeroConfirmar)
    );
    $modelo->confirmarFacturaECF($reserva['factura_id'], rc_confirmar(['estado' => $estado]));
    return (int) rc_pos_cols($pdo, $reserva['factura_id'])['envio_pendiente'];
};
$obtenido = [];
foreach (['ACEPTADO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO', 'RECHAZADO', 'NO_ENCONTRADO', 'ERROR'] as $estado) {
    $obtenido[$estado] = $pendienteTras($estado, true);
}
wa_chk('POS: confirmar deja envio_pendiente en 1 solo si el veredicto sigue abierto (ENVIADO, EN_PROCESO, RFCE_*)',
    $obtenido === ['ACEPTADO' => 0, 'ENVIADO' => 1, 'EN_PROCESO' => 1, 'RFCE_ENVIADO' => 1, 'RFCE_EN_PROCESO' => 1,
        'RECHAZADO' => 0, 'NO_ENCONTRADO' => 0, 'ERROR' => 0], $obtenido);
wa_chk('app: confirmar nunca pone envio_pendiente (ENVIADO y EN_PROCESO sobre una fila sin clave del POS quedan en 0)',
    $pendienteTras('ENVIADO', false) === 0 && $pendienteTras('EN_PROCESO', false) === 0);

// POS 7: marcar incierto deja envio_pendiente en 1 en la misma sentencia; la app no lo toca.
$eNcf = 'E310000009301';
$reserva = $modelo->reservarFacturaECF($factura + ['pos' => rc_pos(9301)], rc_ctx($eNcf));
$pdo->prepare('UPDATE facturas SET envio_pendiente = 0 WHERE id = :id')->execute([':id' => $reserva['factura_id']]);
$ok = $modelo->marcarEnvioIncierto($reserva['factura_id'], rc_incierto($eNcf, $reserva));
$cols = rc_pos_cols($pdo, $reserva['factura_id']);
wa_chk('POS: marcar incierto deja ENVIO_INCIERTO con envio_pendiente = 1',
    $ok === true && ($cols['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && (int) ($cols['envio_pendiente'] ?? 9) === 1, $cols);
$eNcf = 'E310000009302';
$reserva = $modelo->reservarFacturaECF($factura, rc_ctx($eNcf));
$ok = $modelo->marcarEnvioIncierto($reserva['factura_id'], rc_incierto($eNcf, $reserva));
$cols = rc_pos_cols($pdo, $reserva['factura_id']);
wa_chk('app: marcar incierto deja ENVIO_INCIERTO y envio_pendiente en 0',
    $ok === true && ($cols['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && (int) ($cols['envio_pendiente'] ?? 9) === 0, $cols);
```

Run: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -16`

Expected: the 37 earlier checks pass; under `== reserva del POS en wa_scratch ==` 4 of the 10 new checks pass (`app: la reserva sin pos...`, `POS con el numero ocupado...`, `app: confirmar nunca pone envio_pendiente...`, `app: marcar incierto...`) and 6 print `[FALLO]` (the POS reserve, the two "POS repetida" checks, the "previa RECHAZADO" one, the confirm map and the POS mark). The last line is `41 de 47 pruebas OK`, exit code 1.

- [ ] **Step 5: Implement**

**5a. The exception.** Create `src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php`:

```php
<?php

/**
 * La clave de idempotencia de una venta del POS ya tiene factura: 1062 sobre
 * uk_facturas_pos_idem (migracion 030) al reservar. Solo la lanza
 * facturaModel::reservarFacturaECF, antes de enviar nada a la DGII.
 *
 * Es otra cosa que EcfNumeroOcupadoException: aqui el e-NCF recien dispensado
 * esta libre (ninguna fila lo ocupa) y el servicio lo devuelve a la secuencia;
 * lo que ya existe es la VENTA. PosVenta la relee por la clave y la responde
 * como repetida. No es EcfUsuarioException: nunca llega al cajero.
 */
class EcfVentaRepetidaException extends RuntimeException
{
    public string $clave;

    public function __construct(string $clave, ?Throwable $previous = null)
    {
        $this->clave = $clave;
        parent::__construct(sprintf('Venta repetida: la clave %s ya tiene factura', $clave), 0, $previous);
    }
}
```

**5b. `EstadosEcf::envioPendiente`.** In `src/Utils/FacturacionElectronica/EstadosEcf.php`:

Replace:

```php
        return "'" . implode("', '", $estados) . "'";
    }
}
```

with:

```php
        return "'" . implode("', '", $estados) . "'";
    }

    /**
     * Valor de facturas.envio_pendiente (migracion 030) de una venta del POS segun
     * su estado_dgii: 1 si la app todavia no conoce un veredicto final de la DGII
     * (en vuelo, o recibida sin veredicto: EN_VUELO y SIN_VEREDICTO), 0 en
     * cualquier otro. El reenvio automatico del POS busca las filas en 1. ERROR y
     * NO_ENCONTRADO dan 0: ese numero no se reenvia solo.
     */
    public static function envioPendiente(string $estado): int
    {
        return in_array($estado, self::EN_VUELO, true) || in_array($estado, self::SIN_VEREDICTO, true) ? 1 : 0;
    }
}
```

**5c. `facturaModel`.** In `src/Models/facturaModel.php`, apply these 14 replacements. They touch `reservarFacturaECF` (1-9), `confirmarFacturaECF` (10-12) and `marcarEnvioIncierto` (13-14); the INSERT is built by concatenating the POS suffixes only when `$pos !== null`, the same way master did, so an app invoice sends the Release 1 SQL byte for byte.

**1. Require the new exception next to `EcfNumeroOcupadoException` (top of the file)**

Replace:

```php
require_once(__DIR__ . '/../Utils/FacturacionElectronica/EcfNumeroOcupadoException.php');
```

with:

```php
require_once(__DIR__ . '/../Utils/FacturacionElectronica/EcfNumeroOcupadoException.php');
require_once(__DIR__ . '/../Utils/FacturacionElectronica/EcfVentaRepetidaException.php');
```

**2. Reserve docblock: what a 1062 on the POS key means**

Replace:

```php
     * 1406 sin la migracion 028, la DB caida) se relanza: no queda fila, y la
     * emision devuelve el numero a la secuencia.
     *
```

with:

```php
     * 1406 sin la migracion 028, la DB caida) se relanza: no queda fila, y la
     * emision devuelve el numero a la secuencia.
     *
     * Un 1062 sobre uk_facturas_pos_idem (la clave de idempotencia de la venta del
     * POS, migracion 030) no es "numero ocupado": esa venta ya tiene factura.
     * Sale EcfVentaRepetidaException con la clave; la transaccion se deshace
     * entera (tambien el archivo de una fila previa del numero) y la emision
     * devuelve el numero a la secuencia, porque ninguna fila lo ocupa.
     *
```

**3. Reserve docblock: the optional `pos` block**

Replace:

```php
     * @param array $factura {date, client_id, client_name, total, tipo_pago, user_id, informacion_referencia, items[]}
     *                       ($facturaInput del controller; sin 'no_factura', que toma el e-NCF)
```

with:

```php
     * @param array $factura {date, client_id, client_name, total, tipo_pago, user_id, informacion_referencia, items[],
     *                       pos?: {turno_id, pos_empleado_id, pos_idempotency_key}}
     *                       ($facturaInput del controller; sin 'no_factura', que toma el e-NCF). Con 'pos' la
     *                       fila es una venta del POS: el mismo INSERT guarda las columnas de la migracion 030
     *                       y envio_pendiente = 1 (nace sin veredicto; el reenvio del POS la busca). Sin 'pos'
     *                       el INSERT no nombra ninguna de ellas: un tenant sin la 030 sigue funcionando.
```

**4. Reserve docblock: the new exception**

Replace:

```php
     * @throws EcfNumeroOcupadoException|PDOException|InvalidArgumentException
```

with:

```php
     * @throws EcfNumeroOcupadoException|EcfVentaRepetidaException|PDOException|InvalidArgumentException
```

**5. Validate the `pos` block right after `$nota`, before any query**

Replace:

```php
        $nota = self::normalizarNotaReferencia($factura, (string) ($ctx['tipo_ecf'] ?? ''));
```

with:

```php
        $nota = self::normalizarNotaReferencia($factura, (string) ($ctx['tipo_ecf'] ?? ''));

        // Venta del POS: el bloque 'pos' agrega al INSERT las columnas de la migracion 030.
        // Sin clave de idempotencia no habria idempotencia ni 1062 que distinguir: se rechaza
        // antes de tocar la base (pos_idempotency_key es CHAR(36)).
        $pos = is_array($factura['pos'] ?? null) ? $factura['pos'] : null;
        $clavePos = null;
        if ($pos !== null) {
            $clavePos = trim((string) ($pos['pos_idempotency_key'] ?? ''));
            if ($clavePos === '' || strlen($clavePos) > 36) {
                throw new InvalidArgumentException('reservarFacturaECF: pos.pos_idempotency_key vacia o de mas de 36 caracteres');
            }
        }
```

**6. INSERT, column list: the POS columns only with `pos`**

Replace:

```php
                     ncf_modificado, fecha_ncf_modificado, codigo_modificacion, razon_modificacion)
                    VALUES
```

with:

```php
                     ncf_modificado, fecha_ncf_modificado, codigo_modificacion, razon_modificacion'
                    . ($pos !== null ? ', turno_id, pos_empleado_id, pos_idempotency_key, envio_pendiente' : '') . ')
                    VALUES
```

**7. INSERT, value list: the POS placeholders only with `pos`**

Replace:

```php
                     :ncf_modificado, :fecha_ncf_modificado, :codigo_modificacion, :razon_modificacion)');
```

with:

```php
                     :ncf_modificado, :fecha_ncf_modificado, :codigo_modificacion, :razon_modificacion'
                    . ($pos !== null ? ', :turno_id, :pos_empleado_id, :pos_idempotency_key, :envio_pendiente' : '') . ')');
```

**8. INSERT, parameters: the POS values only with `pos`**

Replace:

```php
                    ':razon_modificacion' => $nota['razon_modificacion'],
                ]);
```

with:

```php
                    ':razon_modificacion' => $nota['razon_modificacion'],
                ] + ($pos === null ? [] : [
                    ':turno_id' => isset($pos['turno_id']) ? (int) $pos['turno_id'] : null,
                    ':pos_empleado_id' => isset($pos['pos_empleado_id']) ? (int) $pos['pos_empleado_id'] : null,
                    ':pos_idempotency_key' => $clavePos,
                    // La venta nace sin veredicto: el reenvio automatico del POS la busca.
                    ':envio_pendiente' => EstadosEcf::envioPendiente(EstadosEcf::PENDIENTE_ENVIO),
                ]));
```

**9. The 1062 branch: sale already invoiced versus e-NCF taken**

Replace:

```php
                if ($codigo === 1062) {
                    throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'clave duplicada (1062)', $e);
                }
```

with:

```php
                if ($codigo === 1062) {
                    // La clave unica de la venta del POS no es "numero ocupado": esa venta
                    // ya tiene factura. MySQL 8 nombra la clave 'facturas.uk_facturas_pos_idem',
                    // MariaDB y MySQL 5.7 solo 'uk_facturas_pos_idem'.
                    if ($clavePos !== null && str_contains((string) ($e->errorInfo[2] ?? $e->getMessage()), 'uk_facturas_pos_idem')) {
                        throw new EcfVentaRepetidaException($clavePos, $e);
                    }
                    throw new EcfNumeroOcupadoException($eNcf, $ambiente, 'clave duplicada (1062)', $e);
                }
```

**10. Confirm docblock: `envio_pendiente` and the migration 030 gate**

Replace:

```php
     * Un PDOException se propaga: el servicio lo trata como fallo al confirmar.
     *
```

with:

```php
     * En el mismo UPDATE (nunca en otro) se escribe envio_pendiente, solo en filas
     * del POS (pos_idempotency_key NOT NULL; las de la app no lo tocan):
     * EstadosEcf::envioPendiente del estado nuevo, o sea 1 si el veredicto sigue
     * abierto (ENVIADO, EN_PROCESO, RFCE_ENVIADO, RFCE_EN_PROCESO) y 0 en
     * cualquier otro. Nombra pos_idempotency_key y envio_pendiente, asi que la
     * migracion 030 es parte de la compuerta de despliegue de este cambio.
     *
     * Un PDOException se propaga: el servicio lo trata como fallo al confirmar.
     *
```

**11. Confirm SQL: `envio_pendiente` in the same UPDATE**

Replace:

```php
        $secuencia = $ctx['secuencia_utilizada'] ?? null;
        $stmt = $this->conexion->prepare(
            'UPDATE facturas SET estado_dgii = :estado, track_id = :track_id, respuesta_dgii = :resp,
                    secuencia_utilizada = :sec, rfce_track_id = :rtid, rfce_estado = :rest, rfce_respuesta = :rresp
              WHERE id = :id AND estado_dgii IN (' . EstadosEcf::sql(EstadosEcf::EN_VUELO) . ')'
        );
        $stmt->execute([
            ':estado' => (string) ($ctx['estado'] ?? ''),
```

with:

```php
        $secuencia = $ctx['secuencia_utilizada'] ?? null;
        $estado = (string) ($ctx['estado'] ?? '');
        $stmt = $this->conexion->prepare(
            'UPDATE facturas SET estado_dgii = :estado, track_id = :track_id, respuesta_dgii = :resp,
                    secuencia_utilizada = :sec, rfce_track_id = :rtid, rfce_estado = :rest, rfce_respuesta = :rresp,
                    envio_pendiente = CASE WHEN pos_idempotency_key IS NOT NULL THEN :pend ELSE envio_pendiente END
              WHERE id = :id AND estado_dgii IN (' . EstadosEcf::sql(EstadosEcf::EN_VUELO) . ')'
        );
        $stmt->execute([
            ':estado' => $estado,
```

**12. Confirm parameters: `:pend`**

Replace:

```php
            ':rresp' => self::json($recortar($ctx['rfce_response'] ?? null)),
            ':id' => $id,
```

with:

```php
            ':rresp' => self::json($recortar($ctx['rfce_response'] ?? null)),
            ':pend' => EstadosEcf::envioPendiente($estado),
            ':id' => $id,
```

**13. Mark docblock: `envio_pendiente`**

Replace:

```php
     * Nunca lanza: lo llaman el catch del envio y el registro de cierre
```

with:

```php
     * En el mismo UPDATE deja envio_pendiente = 1 (EstadosEcf::envioPendiente de
     * ENVIO_INCIERTO), solo en filas del POS (pos_idempotency_key NOT NULL): el
     * reenvio automatico del POS consulta y reenvia esa venta.
     *
     * Nunca lanza: lo llaman el catch del envio y el registro de cierre
```

**14. Mark SQL and parameters: `envio_pendiente = 1` in the same UPDATE**

Replace:

```php
                "UPDATE facturas SET estado_dgii = 'ENVIO_INCIERTO', respuesta_dgii = :json
                  WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'"
            );
            $stmt->execute([':json' => self::json($meta), ':id' => $id]);
```

with:

```php
                "UPDATE facturas SET estado_dgii = 'ENVIO_INCIERTO', respuesta_dgii = :json,
                        envio_pendiente = CASE WHEN pos_idempotency_key IS NOT NULL THEN :pend ELSE envio_pendiente END
                  WHERE id = :id AND estado_dgii = 'PENDIENTE_ENVIO'"
            );
            $stmt->execute([
                ':json' => self::json($meta),
                ':pend' => EstadosEcf::envioPendiente(EstadosEcf::ENVIO_INCIERTO),
                ':id' => $id,
            ]);
```

- [ ] **Step 6: Run the DB-free tests and lint**

```bash
php -l src/Utils/FacturacionElectronica/EstadosEcf.php
php -l src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php
php -l src/Models/facturaModel.php
php tools/test_write_ahead_puro.php | grep -E "FALLO|pruebas OK"
php tools/test_notas_vinculadas.php | tail -1
php tools/check_estado_dgii_ancho.php | tail -1
```

Expected: three `No syntax errors detected`; the puro `grep` prints the same known `[FALLO]` lines and `197 de 198 pruebas OK` (section 14 adds 16 checks, all `[OK  ]`: both numbers grow by 16); then `62 de 62 pruebas OK` and `32/32 OK`.

- [ ] **Step 7: Run the scratch-DB suites**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -14
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_ecf.php --tenant-db=wa_scratch | tail -2
```

Expected: the first run ends with the 10 new `[OK  ]` lines and `47 de 47 pruebas OK` (on the MySQL 8 scratch server the 1062 of the real unique key reads `for key 'facturas.uk_facturas_pos_idem'`; MariaDB and MySQL 5.7 drop the table prefix; the model matches the key name, so either spelling works); the second, a regression of the emission with the real hook and the new UPDATEs, ends with `234 de 234 pruebas OK`. If a check fails because rows or counters vanished mid-run, another session was using `wa_scratch`: wait and rerun.

- [ ] **Step 8: Commit**

```bash
git add src/Utils/FacturacionElectronica/EstadosEcf.php src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php src/Models/facturaModel.php tools/test_write_ahead_puro.php tools/test_reservar_confirmar.php
git commit -F - <<'EOF'
feat(facturas): reserva del POS con clave y turno, venta repetida y envio_pendiente

reservarFacturaECF agrega turno_id, pos_empleado_id, pos_idempotency_key y
envio_pendiente = 1 al INSERT cuando la factura trae 'pos'; sin 'pos' el INSERT
es el de siempre. Un 1062 sobre uk_facturas_pos_idem es EcfVentaRepetidaException
(la venta ya tiene factura), no numero ocupado. confirmarFacturaECF y
marcarEnvioIncierto escriben envio_pendiente en el mismo UPDATE que el estado,
solo en filas del POS, con EstadosEcf::envioPendiente. Requiere la migracion 030
en todos los tenants.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: ECFEmissionService y ncfModel: opciones del POS

Run every command from the API worktree root. This task runs on the tree **after Tasks 1 and 3**. The anchors are quoted text, not line numbers; the edits to `ECFEmissionService.php` are quoted from the Release 1 flow, which Task 1 kept ("OURS flow"). Master's `dgii_timeout` block (`$opcionesEnvio['timeout']`, merged by Task 1) is not touched, and no anchor below includes it: Task 1 may have put it before the send `try` or inside the pre-send `try`, and both placements work. The block only needs `$ambiente`, which both token modes assign before it. Same DB rules as Task 3: one suite at a time. Line endings: as in Task 3, the Edit tool keeps each file's own ending.

**Why.** The POS never stops for the DGII or the sequence (spec 4.2.3 and 4.2.6). `emitir()` gets three payload options, all off by default, so the app, integrations and gastos keep today's behaviour:
- `reclamar_secuencia` (default true): `false` never returns the number to the counter after the verdict, because it is already printed. A failure **before** the reserve still returns it: it was never used.
- `autenticar_despues_de_reservar`: the DGII token is requested after the row is saved. The reserve needs the environment before it has a token, so `DgiiAuthService::ambienteEfectivo()` returns the one `autenticar()` would use, without any call. A token failure after the reserve is an unconfirmed send: the row becomes `ENVIO_INCIERTO` with `fase_fallida = 'autenticar'` and the service throws `EcfEnvioInciertoException`. The POS also uses its `dgii_timeout` for the token, so it never waits 30 s for it. That is an addition to spec 4.2.3, which gives `dgii_timeout` only for the send: without it a DGII that hangs on the seed request would keep the cashier waiting up to 2 x 30 s (seed, then validation) for a sale that is already saved.
- `numerar_sin_rango`: when no range has free numbers, the next number after the last one used (`ncfModel::dispenseSinRango`), the row is reserved with `sin_rango` in its meta and `emitir()` returns **without any DGII call, token included**: the DGII rejects numbers outside an authorized range. The shutdown registry is not armed.

Both "after the reserve" options need the hook; without it they are ignored (integration and gastos have no row to protect).

**Why `registerRange` changes (RF5).** A number handed out by `dispenseSinRango` pushes the last range's `current_value` past its `numero_hasta`. `registerRange` takes `max(current_value, numero_hasta)` of every range as its floor, so the admin could not register the range the DGII authorizes next (it starts at `numero_hasta + 1`, right on top of the numbers already used): the sales would wait forever. The floor becomes the `numero_hasta` when the range has one; the new range starts **after** the last number used inside it, so `dispenseNextECF` never hands out a used number again; the old range goes back to its `numero_hasta`. Numbers below the new range's start stay uncovered (they remain in the admin alert of Task 10). A range with no overshoot registers exactly as before.

**Review Focus.** The Task 4 half of RF5 is pinned here: `P3/RF5` in `tools/test_write_ahead_ecf.php` (E32 exhausted while E31 keeps its range: only E32 goes `sin_rango`, E31 is sent and accepted as usual) and `N7`/`N8` in `tools/test_reservar_confirmar.php` (registering the range that covers the used numbers, after which `dispenseNextECF` never hands out a used number). Task 8 pins the resend half.

**Files:**
- Modify: `src/Utils/FacturacionElectronica/DgiiAuthService.php`. Anchor: the line `private function buildConfig(array $options): array` and its `{`.
- Modify: `src/Models/ncfModel.php`. Anchors: the docblock `Lista los rangos e-NCF del ambiente con uso/restantes/estado calculados.` (the new methods go above it) and, inside `registerRange`, its docblock, the `$tope = max(...)` line, the comment `// Cerrar la fila legacy sin limite en su consumo actual.`, `':cv' => $numeroDesde - 1,` and `'restantes' => $numeroHasta - ($numeroDesde - 1),`.
- Modify: `src/Models/facturaModel.php`. Anchors: `metaEnVuelo` and the docblock of `metaEnvio`.
- Modify: `src/Utils/FacturacionElectronica/ECFEmissionService.php`. Anchors quoted in Steps 7 and 8.
- Modify: `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php` (docblock only).
- Modify: `tools/test_write_ahead_puro.php` (section 15), `tools/test_write_ahead_ecf.php` (`FakeAuth`, `correr`, new section 4), `tools/test_reservar_confirmar.php` (new `ncfModel` block).
- Test: the three scripts above.

**Interfaces:**
- Consumes:
  - Task 1: `dgii_timeout` read from the payload as `$opcionesEnvio['timeout']` for `recibir`/`recibirResumen`;
  - Task 3: `EcfVentaRepetidaException(string $clave, ?Throwable $previous = null)` with `public string $clave` (the service just lets it through; scenario P4 proves the number returns), `facturaModel::reservarFacturaECF` for the real hook of the ecf suite;
  - Release 1: `ncfModel::dispenseNextECF`, `rollbackECFSequence`, `registerRange`, `listRanges`; `EstadosEcf::PENDIENTE_ENVIO`; `facturaModel::metaEnvio`; the ecf harness (`Orden`, `FakeAuth`, `FakeSigner`, `FakeReception`, `FakeNcf`, `emision`, `gancho`, `correr`, `chkComun`, `chkEnVuelo`, `enVuelo`, `CLAVES_RESERVAR`, `$integracion`).
- Produces:

```php
// src/Utils/FacturacionElectronica/DgiiAuthService.php
public function ambienteEfectivo(array $options = []): string
// 'testecf' | 'certecf' | 'ecf': what autenticar($options) would use (override, tenant, .env; aliases normalized). No DGII call.

// src/Models/ncfModel.php
public function dispenseSinRango(string $type, string $ambiente): ?array
// Increments (atomically, no numero_hasta bound) the current_value of the type/ambiente range with the highest numero_desde.
// Same keys as dispenseNextECF, plus: ['e_ncf', 'valor', 'rango_id' => null, 'fecha_vencimiento' => <last range's>,
//   'numero_hasta' => <last range's>, 'restantes' => 0, 'sin_rango' => true]
// null for a type that is not E##, or when the type has no row in that ambiente. RuntimeException('ncf_sequences inaccesible: ...') on a DB error.
public function rangoCubre(string $type, string $ambiente, int $valor): bool
// A registered range of type/ambiente with numero_desde <= $valor <= numero_hasta (or numero_hasta NULL) and not expired.
// false for a bad type, $valor < 1 or a DB error (when in doubt, do not send).
// registerRange(...): a range that starts after the numero_hasta of the last one registers even when that range's
//   current_value overshoots it; see "Why registerRange changes".

// src/Utils/FacturacionElectronica/ECFEmissionService.php
public function emitir(array $payload, ?callable $persistencia = null): array
// New optional payload keys: reclamar_secuencia (bool, default true), autenticar_despues_de_reservar (bool), numerar_sin_rango (bool).
// 'reservar' ctx: the 13 Release 1 keys; plus 'sin_rango' => true (last key) only when the number came from dispenseSinRango (rango_id null).
// facturaModel meta (respuesta_dgii while in flight) gets 'sin_rango' => true after 'secuencia_valor', only then.
// Return for a sin_rango number (no DGII call, no token, hook phases: only 'reservar'):
//   ['e_ncf', 'tipo_ecf', 'signed_xml', 'codigo_seguridad', 'track_id' => null, 'estado' => 'PENDIENTE_ENVIO', 'ambiente',
//    'fecha_emision_dgii', 'dgii_response' => null, 'dgii_status_code' => null, 'flujo' => 'ECF'|'RFCE', 'factura_id' => int, 'sin_rango' => true]
//   and, in the RFCE flow, also 'monto_total', 'rfce_xml', 'rfce_track_id' => null, 'rfce_estado' => null, 'rfce_response' => null, 'rfce_status_code' => null.
// EcfEnvioInciertoException::faseFallida may now be 'autenticar' (token failed after the reserve; nothing reached the DGII).
```

- [ ] **Step 1: Check the tree**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -1
php tools/test_write_ahead_puro.php | grep -E "FALLO|pruebas OK"
grep -n "dgii_timeout" src/Utils/FacturacionElectronica/ECFEmissionService.php
```

Expected: only `?? tools/reconstruir_e340000000001.sql`; the Task 3 commit on top; the puro `grep` prints the same known `[FALLO]` lines as in Task 3 Step 1 and `197 de 198 pruebas OK` (`181 de 182` plus the 16 checks of Task 3); the second `grep` shows master's `dgii_timeout` block that Task 1 kept.

- [ ] **Step 2: Write the failing section 15 (DB-free)**

In `tools/test_write_ahead_puro.php`, insert this block directly above the closing block:

```php
// ---------------------------------------------------------------------------
// 15) POS: DgiiAuthService::ambienteEfectivo, la meta sin_rango y las firmas de
// ncfModel (Task 4 del plan POS y reenvio). Conexion falsa: nada toca MySQL.
// Reusa $reservar, $marcar y puro_ctx_incierto de las secciones 5 y 6.
// ---------------------------------------------------------------------------
echo "\n== 15) POS: ambienteEfectivo, meta sin_rango y firmas de ncfModel ==\n";

$authPuro = new DgiiAuthService();
$refAmbiente = new ReflectionMethod(DgiiAuthService::class, 'ambienteEfectivo');
wa_chk('15: DgiiAuthService::ambienteEfectivo(array $options = []): string es publico',
    $refAmbiente->isPublic() && !$refAmbiente->isStatic() && (string) $refAmbiente->getReturnType() === 'string'
    && $refAmbiente->getNumberOfParameters() === 1 && $refAmbiente->getParameters()[0]->isOptional());
$ambientesObtenidos = [
    'cert' => $authPuro->ambienteEfectivo(['environment' => 'cert']),
    'Certificacion con espacio' => $authPuro->ambienteEfectivo(['environment' => 'Certificacion ']),
    'produccion' => $authPuro->ambienteEfectivo(['environment' => 'produccion']),
    'prod' => $authPuro->ambienteEfectivo(['environment' => 'prod']),
    'test' => $authPuro->ambienteEfectivo(['environment' => 'test']),
    'ambiente testing' => $authPuro->ambienteEfectivo(['ambiente' => 'testing']),
    'environment null, ambiente certecf' => $authPuro->ambienteEfectivo(['environment' => null, 'ambiente' => 'certecf']),
    'ecf' => $authPuro->ambienteEfectivo(['environment' => 'ecf']),
];
wa_chk('15: ambienteEfectivo normaliza los alias igual que autenticar() (sin llamar a la DGII)',
    $ambientesObtenidos === [
        'cert' => 'certecf', 'Certificacion con espacio' => 'certecf', 'produccion' => 'ecf', 'prod' => 'ecf', 'test' => 'testecf',
        'ambiente testing' => 'testecf', 'environment null, ambiente certecf' => 'certecf', 'ecf' => 'ecf',
    ], $ambientesObtenidos);

$refSinRango = new ReflectionMethod(ncfModel::class, 'dispenseSinRango');
$refCubre = new ReflectionMethod(ncfModel::class, 'rangoCubre');
$firma = static fn(ReflectionMethod $m): string => implode(', ', array_map(
    static fn(ReflectionParameter $p): string => $p->getType() . ' $' . $p->getName(), $m->getParameters()
)) . ' -> ' . $m->getReturnType();
wa_chk('15: ncfModel::dispenseSinRango(string $type, string $ambiente): ?array es publico',
    $refSinRango->isPublic() && !$refSinRango->isStatic() && $firma($refSinRango) === 'string $type, string $ambiente -> ?array',
    $firma($refSinRango));
wa_chk('15: ncfModel::rangoCubre(string $type, string $ambiente, int $valor): bool es publico',
    $refCubre->isPublic() && !$refCubre->isStatic() && $firma($refCubre) === 'string $type, string $ambiente, int $valor -> bool',
    $firma($refCubre));

$c = new GuionConexion();
[, $e] = $reservar($c, ['sin_rango' => true, 'rango_id' => null]);
$meta = json_decode((string) (($c->params('INSERT INTO facturas') ?? [])[':respuesta_dgii'] ?? ''), true);
wa_chk('15: reserva con sin_rango: la meta lo guarda al final (despues de secuencia_valor), con rango_id null',
    $e === null && $meta === ['fase' => 'PENDIENTE_ENVIO', 'desde' => '2026-10-05 14:03:11', 'flujo' => 'ECF',
        'ambiente_secuencia' => 'ecf', 'dispensado' => true, 'rango_id' => null, 'secuencia_valor' => 123, 'sin_rango' => true],
    $e?->getMessage() ?? $meta);
$c = new GuionConexion();
[, $e] = $reservar($c, ['sin_rango' => false]);
$meta = json_decode((string) (($c->params('INSERT INTO facturas') ?? [])[':respuesta_dgii'] ?? ''), true);
wa_chk('15: sin_rango false (o ausente): la meta es la de siempre, 7 claves y ninguna sin_rango',
    $e === null && is_array($meta) && count($meta) === 7 && !array_key_exists('sin_rango', $meta), $meta);
$c = new GuionConexion();
$marcar($c, puro_ctx_incierto(['sin_rango' => true, 'rango_id' => null]));
$meta = json_decode((string) (($c->params("estado_dgii = 'ENVIO_INCIERTO'") ?? [])[':json'] ?? ''), true);
wa_chk('15: marcar incierto de una venta fuera de rango conserva sin_rango en la meta',
    is_array($meta) && array_keys($meta) === ['fase', 'desde', 'flujo', 'ambiente_secuencia', 'dispensado', 'rango_id',
        'secuencia_valor', 'sin_rango', 'fase_fallida', 'clase', 'error', 'resultado_parcial', 'intentos']
    && $meta['sin_rango'] === true && $meta['rango_id'] === null, $meta);
```

Run: `php tools/test_write_ahead_puro.php | tail -6`

Expected: sections 1-14 as before, then the header `== 15) POS: ambienteEfectivo, meta sin_rango y firmas de ncfModel ==` and `Fatal error: Uncaught ReflectionException: Method DgiiAuthService::ambienteEfectivo() does not exist`, exit code 255.

- [ ] **Step 3: Extend the ecf harness and write the failing section 4**

In `tools/test_write_ahead_ecf.php`, make these four replacements (they only add: nothing the Release 1 scenarios read changes, and `FakeAuth` stays out of `Orden::$pasos` unless a scenario asks):

**1. Require the new exception (top of the file)**

Replace:

```php
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
```

with:

```php
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php';
```

**2. `FakeAuth`: options of each call, optional entry in `Orden`, a spy and a failure**

Replace:

```php
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
```

with:

```php
/**
 * Token fijo: no pide semilla ni firma nada. Los escenarios del POS (seccion 4)
 * le piden ademas: las opciones de cada llamada, anotarse en Orden::$pasos, correr
 * un espia al llamarlo o fallar.
 */
final class FakeAuth extends DgiiAuthService
{
    public int $llamadas = 0;
    /** @var list<array> opciones de cada llamada a autenticar (el POS pasa timeout) */
    public array $opciones = [];
    /** true: la llamada se anota como 'autenticar' en Orden::$pasos. */
    public bool $anotarOrden = false;
    /** Corre al llamarlo, antes de responder (lee la base a esa altura). */
    public ?Closure $alLlamar = null;
    /** Si no es null, autenticar lanza lo que devuelva: fn(): Throwable. */
    public ?Closure $falla = null;

    public function autenticar(array $options = []): array
    {
        $this->llamadas++;
        $this->opciones[] = $options;
        if ($this->anotarOrden) {
            Orden::$pasos[] = 'autenticar';
        }
        if ($this->alLlamar !== null) {
            ($this->alLlamar)();
        }
        if ($this->falla !== null) {
            throw ($this->falla)();
        }
        return ['token' => 'tok-prueba', 'ambiente' => 'certecf'];
    }
}
```

**3. `correr()` docblock: the new `auth` option**

Replace:

```php
 * rollback_falso, payload (claves que pisan las del payload), limpiar (true).
```

with:

```php
 * rollback_falso, payload (claves que pisan las del payload), limpiar (true),
 * auth (fn(FakeAuth): void que configura el FakeAuth antes de emitir).
```

**4. `correr()` body: configure the `FakeAuth` before emitting**

Replace:

```php
    $auth = new FakeAuth();
    $signer = new FakeSigner();
```

with:

```php
    $auth = new FakeAuth();
    if (isset($op['auth'])) {
        ($op['auth'])($auth);
    }
    $signer = new FakeSigner();
```

Then insert this block directly above the closing block (before the `// ---...---` line that precedes `// Cierre. Cada tarea agrega sus casos justo encima de este bloque.`). It uses the scratch E32 and E31 ranges (set to `numero_hasta = 5, current_value = 5` inside a `try`, restored in `finally`) and never leaves them exhausted:

```php
// ---------------------------------------------------------------------------
// 4) Opciones del POS en emitir (Task 4 del plan POS y reenvio):
// reclamar_secuencia, autenticar_despues_de_reservar y numerar_sin_rango.
// Sin ellas todo es como antes (las secciones 1 a 3 lo prueban).
// ---------------------------------------------------------------------------
echo "\n== 4) Opciones del POS: reclamar_secuencia, autenticar_despues_de_reservar, numerar_sin_rango ==\n";

/** Configura el FakeAuth de un escenario para anotar su llamada en Orden::$pasos. */
$anotarAuth = static function (FakeAuth $a): void {
    $a->anotarOrden = true;
};

// P1 reclamar_secuencia: con false el numero NO vuelve al contador tras el veredicto.
$r = correr($pdo, $ids, ['modo' => 'rechaza', 'payload' => ['reclamar_secuencia' => true]]);
wa_chk('P1: reclamar_secuencia true (el default): un rechazo devuelve el numero (contador sin cambio, un rollback)',
    $r['err'] === null && $r['delta'] === 0 && count($r['ncf']->rollbacks) === 1, ['delta' => $r['delta'], 'rollbacks' => $r['ncf']->rollbacks]);
$r = correr($pdo, $ids, ['modo' => 'rechaza', 'payload' => ['reclamar_secuencia' => false]]);
wa_chk('P1: reclamar_secuencia false: el rechazo queda RECHAZADO y el numero NO vuelve (contador +1, ningun rollback)',
    $r['err'] === null && ($r['res']['estado'] ?? null) === 'RECHAZADO' && ($r['filas'][0]['estado_dgii'] ?? null) === 'RECHAZADO'
    && $r['delta'] === 1 && $r['ncf']->rollbacks === [], ['err' => descErr($r['err']), 'delta' => $r['delta'], 'rollbacks' => $r['ncf']->rollbacks]);
wa_chk("P1: reclamar_secuencia false: ni siquiera se anota 'reclamar secuencia' en el log", !str_contains($r['log'], '[ECF] reclamar secuencia'), $r['log']);
chkComun('P1', $r);
$r = correr($pdo, $ids, ['tipo' => '32', 'modo' => 'rechaza', 'payload' => ['reclamar_secuencia' => false]]);
wa_chk('P1: reclamar_secuencia false en el flujo RFCE (E32 < 250k): RFCE_RECHAZADO y el numero NO vuelve',
    $r['err'] === null && ($r['res']['estado'] ?? null) === 'RFCE_RECHAZADO' && $r['delta'] === 1 && $r['ncf']->rollbacks === [],
    ['err' => descErr($r['err']), 'estado' => $r['res']['estado'] ?? null, 'delta' => $r['delta']]);
$r = correr($pdo, $ids, ['con_cr' => true, 'payload' => ['reclamar_secuencia' => false]]);
wa_chk('P1: un fallo ANTES de reservar sigue devolviendo el numero aunque reclamar_secuencia sea false (no se uso)',
    $r['err'] instanceof RuntimeException && $r['delta'] === 0 && count($r['ncf']->rollbacks) === 1, ['delta' => $r['delta'], 'rollbacks' => $r['ncf']->rollbacks]);

// P2 autenticar_despues_de_reservar: el token se pide despues de guardar.
$r = correr($pdo, $ids, ['auth' => $anotarAuth]);
wa_chk('P2: sin la opcion el token se pide ANTES de reservar (la app no cambia)',
    $r['orden'] === ['autenticar', 'reservar', 'confirmar'], $r['orden']);
$r = correr($pdo, $ids, ['auth' => $anotarAuth, 'payload' => ['autenticar_despues_de_reservar' => true]]);
wa_chk('P2: con la opcion el token se pide DESPUES de reservar y antes de confirmar',
    $r['err'] === null && $r['orden'] === ['reservar', 'autenticar', 'confirmar'] && $r['auth']->llamadas === 1
    && ($r['res']['estado'] ?? null) === 'ACEPTADO' && ($r['filas'][0]['estado_dgii'] ?? null) === 'ACEPTADO',
    ['err' => descErr($r['err']), 'orden' => $r['orden']]);
wa_chk('P2: el ctx reservar lleva el ambiente efectivo (el que tendria el token) y las mismas 13 claves',
    ($r['ctxs']['reservar']['ambiente'] ?? null) === 'certecf' && array_keys($r['ctxs']['reservar'] ?? []) === CLAVES_RESERVAR,
    $r['ctxs']['reservar'] ?? null);
chkComun('P2', $r);

// La fila ya esta guardada cuando se pide el token (con la opcion) y todavia no (sin ella).
$filasAlPedirToken = [];
foreach (['con' => true, 'sin' => false] as $nombre => $conOpcion) {
    $r = correr($pdo, $ids, [
        'payload' => $conOpcion ? ['autenticar_despues_de_reservar' => true] : [],
        'auth' => static function (FakeAuth $a) use ($pdo, $nombre, &$filasAlPedirToken): void {
            $a->alLlamar = static function () use ($pdo, $nombre, &$filasAlPedirToken): void {
                $filasAlPedirToken[$nombre] = (int) $pdo->query("SELECT COUNT(*) FROM facturas WHERE estado_dgii = 'PENDIENTE_ENVIO'")->fetchColumn();
            };
        },
    ]);
}
wa_chk('P2: cuando se pide el token la fila ya esta en PENDIENTE_ENVIO con la opcion, y todavia no existe sin ella',
    $filasAlPedirToken === ['con' => 1, 'sin' => 0], $filasAlPedirToken);

// Las opciones con las que se pidio el token, sin el certificado (no se imprime ni la clave).
$opcionesDelToken = static fn(FakeAuth $a): array => array_map(
    static fn(array $o): array => array_diff_key($o, ['certificate_content' => 1, 'certificate_password' => 1]),
    $a->opciones
);
$r = correr($pdo, $ids, ['payload' => ['dgii_timeout' => 5, 'autenticar_despues_de_reservar' => true]]);
wa_chk('P2: con dgii_timeout el token tambien se pide con esa espera (el POS no espera 30 s por un token)',
    $r['auth']->llamadas === 1 && ($r['auth']->opciones[0]['timeout'] ?? null) === 5
    && array_key_exists('certificate_content', $r['auth']->opciones[0]) && array_key_exists('certificate_password', $r['auth']->opciones[0]),
    $opcionesDelToken($r['auth']));
$r = correr($pdo, $ids, ['payload' => ['dgii_timeout' => 5]]);
wa_chk('P2: sin la opcion el token se pide con la espera normal (dgii_timeout solo acorta el envio)',
    $r['auth']->llamadas === 1 && !array_key_exists('timeout', $r['auth']->opciones[0]), $opcionesDelToken($r['auth']));

// P2b el token falla despues de reservar: la fila queda ENVIO_INCIERTO, el numero no vuelve.
$r = correr($pdo, $ids, [
    'payload' => ['autenticar_despues_de_reservar' => true],
    'auth' => static function (FakeAuth $a): void {
        $a->anotarOrden = true;
        $a->falla = static fn(): Throwable => new RuntimeException('HTTP request failed: timeout al pedir la semilla');
    },
]);
$e = $r['err'];
wa_chk('P2b: el token falla: EcfEnvioInciertoException, fase_fallida autenticar, marcado, sin resultado parcial',
    $e instanceof EcfEnvioInciertoException && $e->faseFallida === 'autenticar' && $e->marcado === true
    && $e->resultadoParcial === null && $e->facturaId > 0 && $e->eNcf === $r['e_ncf'], descErr($e));
wa_chk('P2b: la fila queda ENVIO_INCIERTO y el numero NO vuelve (contador +1, ningun rollback)',
    ($r['filas'][0]['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && $r['delta'] === 1 && $r['ncf']->rollbacks === [],
    ['filas' => $r['filas'], 'delta' => $r['delta']]);
wa_chk('P2b: orden reservar, autenticar, incierto; la DGII nunca recibio nada',
    $r['orden'] === ['reservar', 'autenticar', 'incierto'] && $r['rec']->llamadas === [], ['orden' => $r['orden'], 'rec' => $r['rec']->llamadas]);
chkEnVuelo('P2b', $r['filas'][0] ?? [], 'autenticar');
wa_chk('P2b: el registro de cierre queda vacio al salir', enVuelo() === [], enVuelo());
chkComun('P2b', $r);

// P2c un fallo antes de reservar no pide el token y devuelve el numero.
$r = correr($pdo, $ids, ['con_cr' => true, 'payload' => ['autenticar_despues_de_reservar' => true]]);
wa_chk('P2c: CR en el XML con la opcion: no se autentico, el numero vuelve y no hay fila',
    $r['err'] instanceof RuntimeException && $r['auth']->llamadas === 0 && $r['delta'] === 0 && $r['total_filas'] === 0,
    ['auth' => $r['auth']->llamadas, 'delta' => $r['delta']]);
// P2d sin gancho (integracion, gastos) las opciones del POS no hacen nada.
$r = correr($pdo, $ids, ['sin_gancho' => true, 'payload' => $integracion + ['autenticar_despues_de_reservar' => true, 'numerar_sin_rango' => true]]);
wa_chk('P2d: sin gancho se ignoran: el token se pide y el e-CF se envia como siempre',
    $r['err'] === null && ($r['res']['estado'] ?? null) === 'ACEPTADO' && $r['auth']->llamadas === 1 && count($r['rec']->llamadas) === 1
    && array_key_exists('factura_id', $r['res']) && $r['res']['factura_id'] === null && !array_key_exists('sin_rango', $r['res']),
    ['err' => descErr($r['err']), 'res' => $r['res']['estado'] ?? null]);
// P2e ambienteEfectivo: lo que la reserva guarda cuando el token se pide despues.
$auth = new FakeAuth();
wa_chk('P2e: ambienteEfectivo sin opciones es el del tenant o del .env (certecf) y respeta el override y los alias',
    $auth->ambienteEfectivo() === 'certecf' && $auth->ambienteEfectivo(['environment' => 'prod']) === 'ecf'
    && $auth->ambienteEfectivo(['environment' => null, 'ambiente' => 'test']) === 'testecf', $auth->ambienteEfectivo());

// P3 numerar_sin_rango: sin rango con numeros libres, el numero siguiente; la fila se guarda y NO se envia.
/** Deja el rango certecf de $tipo agotado en $hasta (current_value = numero_hasta). */
$agotar = static function (PDO $c, string $tipo, int $hasta): void {
    $c->prepare("UPDATE ncf_sequences SET numero_hasta = :h, current_value = :h WHERE type = :t AND ambiente = 'certecf'")
        ->execute([':h' => $hasta, ':t' => $tipo]);
};
/** Devuelve el rango certecf de $tipo a su numero_hasta de la siembra. */
$restaurar = static function (PDO $c, string $tipo): void {
    $c->prepare("UPDATE ncf_sequences SET numero_hasta = 99999999 WHERE type = :t AND ambiente = 'certecf'")->execute([':t' => $tipo]);
};
$opcionesPos = ['numerar_sin_rango' => true, 'autenticar_despues_de_reservar' => true];
try {
    wa_limpiar($pdo);
    $agotar($pdo, 'E32', 5);

    $r = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false, 'auth' => $anotarAuth, 'payload' => $opcionesPos]);
    $res = $r['res'] ?? [];
    $fila = $r['filas'][0] ?? [];
    $meta = facturaModel::metaEnvio($fila['respuesta_dgii'] ?? null);
    $rango = $pdo->query("SELECT current_value, numero_hasta FROM ncf_sequences WHERE type = 'E32' AND ambiente = 'certecf'")->fetch(PDO::FETCH_ASSOC);
    wa_chk('P3: E32 agotado: emitir devuelve PENDIENTE_ENVIO con sin_rango y el numero SIGUIENTE al ultimo (E320000000006)',
        $r['err'] === null && ($res['estado'] ?? null) === 'PENDIENTE_ENVIO' && ($res['sin_rango'] ?? null) === true
        && ($res['e_ncf'] ?? null) === 'E320000000006' && (int) ($res['factura_id'] ?? 0) > 0 && ($res['flujo'] ?? null) === 'RFCE',
        ['err' => descErr($r['err']), 'res' => array_diff_key($res, ['signed_xml' => 1, 'rfce_xml' => 1])]);
    wa_chk('P3: trae el XML firmado, el RFCE y el codigo de seguridad para imprimir',
        is_string($res['signed_xml'] ?? null) && str_contains((string) $res['signed_xml'], '<SignatureValue>')
        && is_string($res['rfce_xml'] ?? null) && ($res['codigo_seguridad'] ?? null) === 'QUJDRE'
        && array_key_exists('track_id', $res) && $res['track_id'] === null && ($res['ambiente'] ?? null) === 'certecf', array_keys($res));
    wa_chk('P3/spec 4.2.6: el XML del E32 fuera de rango no lleva FechaVencimientoSecuencia (ese tipo no la lleva)',
        is_string($res['signed_xml'] ?? null) && !str_contains((string) $res['signed_xml'], 'FechaVencimientoSecuencia'), array_keys($res));
    wa_chk('P3: ninguna llamada a la DGII, ni siquiera para el token',
        $r['rec']->llamadas === [] && $r['auth']->llamadas === 0 && $r['fases'] === ['reservar'] && $r['orden'] === ['reservar'],
        ['rec' => $r['rec']->llamadas, 'auth' => $r['auth']->llamadas, 'fases' => $r['fases']]);
    wa_chk('P3: la fila queda PENDIENTE_ENVIO con el XML y el RFCE guardados',
        count($r['filas']) === 1 && ($fila['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO' && (int) ($fila['tiene_xml'] ?? 0) === 1
        && (int) ($fila['tiene_rfce'] ?? 0) === 1, $r['filas']);
    wa_chk('P3: la meta de la fila: sin_rango true, rango_id null, dispensado y el numero usado',
        array_keys($meta) === ['fase', 'desde', 'flujo', 'ambiente_secuencia', 'dispensado', 'rango_id', 'secuencia_valor', 'sin_rango']
        && $meta['sin_rango'] === true && $meta['rango_id'] === null && $meta['dispensado'] === true
        && $meta['secuencia_valor'] === 6 && $meta['ambiente_secuencia'] === 'certecf' && $meta['flujo'] === 'RFCE', $meta);
    wa_chk('P3: el ctx reservar suma sin_rango a las 13 claves, con rango_id null',
        array_keys($r['ctxs']['reservar'] ?? []) === array_merge(CLAVES_RESERVAR, ['sin_rango'])
        && ($r['ctxs']['reservar']['sin_rango'] ?? null) === true
        && array_key_exists('rango_id', $r['ctxs']['reservar'] ?? []) && $r['ctxs']['reservar']['rango_id'] === null,
        $r['ctxs']['reservar'] ?? null);
    wa_chk('P3: el contador pasa de numero_hasta (6 de 5) y el rango sigue autorizado hasta 5',
        $r['delta'] === 1 && (int) $rango['current_value'] === 6 && (int) $rango['numero_hasta'] === 5 && $r['ncf']->rollbacks === [], [$rango, $r['delta']]);
    wa_chk('P3: el registro de cierre no se armo (no hay envio que se quede a medias)', enVuelo() === [], enVuelo());
    chkComun('P3', $r);

    $r = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false, 'payload' => $opcionesPos]);
    wa_chk('P3: la segunda venta toma el 7 (cada una su numero)',
        ($r['res']['e_ncf'] ?? null) === 'E320000000007' && ($r['res']['sin_rango'] ?? null) === true && $r['delta'] === 1
        && $r['total_filas'] === 2, ['res' => $r['res']['e_ncf'] ?? null, 'filas' => $r['total_filas']]);

    // RF5, la mitad del servicio: con E32 agotado, E31 (que sigue teniendo rango) sale normal.
    $r = correr($pdo, $ids, ['tipo' => '31', 'limpiar' => false, 'payload' => $opcionesPos]);
    wa_chk('P3/RF5: E31 con rango sigue su camino normal: ACEPTADO, sin sin_rango, una llamada a la DGII',
        $r['err'] === null && ($r['res']['estado'] ?? null) === 'ACEPTADO' && !array_key_exists('sin_rango', $r['res'] ?? [])
        && count($r['rec']->llamadas) === 1 && array_keys($r['ctxs']['reservar'] ?? []) === CLAVES_RESERVAR,
        ['err' => descErr($r['err']), 'estado' => $r['res']['estado'] ?? null]);

    // Spec 4.2.6: el XML de un E31 fuera de rango lleva la fecha de vencimiento del ULTIMO rango conocido.
    $agotar($pdo, 'E31', 5);
    $r = correr($pdo, $ids, ['tipo' => '31', 'limpiar' => false, 'payload' => $opcionesPos]);
    $vencRango = (string) $pdo->query("SELECT fecha_vencimiento FROM ncf_sequences WHERE type = 'E31' AND ambiente = 'certecf'")->fetchColumn();
    $vencEnXml = DateTime::createFromFormat('Y-m-d', $vencRango)->format('d-m-Y');
    wa_chk('P3/spec 4.2.6: E31 agotado: sin_rango, el numero 6 y el XML lleva la fecha de vencimiento del ultimo rango',
        $r['err'] === null && ($r['res']['sin_rango'] ?? null) === true && ($r['res']['e_ncf'] ?? null) === 'E310000000006'
        && str_contains((string) ($r['res']['signed_xml'] ?? ''), '<FechaVencimientoSecuencia>' . $vencEnXml . '</FechaVencimientoSecuencia>')
        && $r['rec']->llamadas === [], ['err' => descErr($r['err']), 'esperada' => $vencEnXml, 'e_ncf' => $r['res']['e_ncf'] ?? null]);

    // Sin la opcion el agotado sigue deteniendo la emision (la app no cambia).
    $r = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false]);
    wa_chk('P3: sin numerar_sin_rango el rango agotado sigue siendo EcfUsuarioException, sin fila ni avance del contador',
        $r['err'] instanceof EcfUsuarioException && str_contains($r['err']->getMessage(), 'Sin rango e-NCF disponible para E32')
        && $r['delta'] === 0 && $r['fases'] === [], ['err' => descErr($r['err']), 'delta' => $r['delta']]);

    // Un fallo antes de reservar con un numero fuera de rango: el numero vuelve (rango_id null).
    $r = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false, 'con_cr' => true, 'payload' => $opcionesPos]);
    wa_chk('P3: el CR en el XML con un numero fuera de rango: el numero 8 vuelve al contador (rollback con rango_id null)',
        $r['err'] instanceof RuntimeException && $r['delta'] === 0
        && $r['ncf']->rollbacks === [['type' => 'E32', 'valor' => 8, 'ambiente' => 'certecf', 'rango_id' => null]],
        ['delta' => $r['delta'], 'rollbacks' => $r['ncf']->rollbacks]);

    // Sin ninguna fila de rango para el tipo y ambiente tampoco hay numero que dar.
    $filasAntes = (int) $pdo->query('SELECT COUNT(*) FROM facturas')->fetchColumn();
    $pdo->exec("UPDATE ncf_sequences SET ambiente = 'wa_fuera' WHERE type = 'E32' AND ambiente = 'certecf'");
    try {
        $r = correr($pdo, $ids, ['tipo' => '32', 'limpiar' => false, 'payload' => $opcionesPos]);
    } finally {
        $pdo->exec("UPDATE ncf_sequences SET ambiente = 'certecf' WHERE type = 'E32' AND ambiente = 'wa_fuera'");
    }
    wa_chk('P3: sin ninguna fila de rango la emision se detiene con la excepcion de siempre (el POS cae a factura simple)',
        $r['err'] instanceof EcfUsuarioException && str_contains($r['err']->getMessage(), 'Sin rango e-NCF disponible para E32')
        && $r['fases'] === [] && $r['total_filas'] === $filasAntes, ['err' => descErr($r['err']), 'filas' => $r['total_filas']]);
} finally {
    $restaurar($pdo, 'E32');
    $restaurar($pdo, 'E31');
    wa_limpiar($pdo);
}

// P4 el gancho dice "venta repetida" (1062 sobre la clave del POS): el numero esta libre y vuelve.
$r = correr($pdo, $ids, ['trucos' => ['reservar' => function () {
    throw new EcfVentaRepetidaException('4f1c2d3e-0a1b-4c5d-8e9f-0123456789ab');
}]]);
wa_chk('P4: EcfVentaRepetidaException sale tal cual y el numero vuelve a la secuencia (ninguna fila lo ocupa)',
    $r['err'] instanceof EcfVentaRepetidaException && $r['err']->clave === '4f1c2d3e-0a1b-4c5d-8e9f-0123456789ab'
    && $r['delta'] === 0 && count($r['ncf']->rollbacks) === 1 && $r['total_filas'] === 0, ['err' => descErr($r['err']), 'delta' => $r['delta']]);
wa_chk('P4: la recepcion no se llamo', $r['rec']->llamadas === []);
chkComun('P4', $r);
```

Run: `php -l tools/test_write_ahead_ecf.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_ecf.php --tenant-db=wa_scratch | tail -30`

Expected: `No syntax errors detected`; sections 1-3 pass (234 `[OK  ]`). Section 4 prints `[FALLO]` for the three `reclamar_secuencia false` checks of P1 (`obtenido` shows `delta: 0` and one rollback), for three P2 checks of the deferred token (the order is still `["autenticar","reservar","confirmar"]`, the row does not exist yet when the token is requested, no `timeout` reaches `autenticar`), and for the P2b group (`obtenido: "HTTP request failed: timeout al pedir la semilla"`: the exception escapes untranslated, no row, order `["autenticar","rollback"]`), and the run stops at P2e with `[FALLO] excepcion sin atrapar: Error (...): Call to undefined method FakeAuth::ambienteEfectivo()`, exit code 1.

- [ ] **Step 4: Write the failing `ncfModel` cases**

In `tools/test_reservar_confirmar.php`, insert this block directly above the closing block, after the Task 3 block:

```php
// ---------------------------------------------------------------------------
// ncfModel fuera de rango: dispenseSinRango, rangoCubre y registerRange sobre
// numeros ya usados (Task 4 del plan POS y reenvio). Todo en un ambiente propio
// (wa_sr_t4) que se borra antes y despues: no toca los rangos sembrados.
// ---------------------------------------------------------------------------
echo "\n== ncfModel fuera de rango en {$base} ==\n";
$pdo = wa_usar_base($base);
$ncf = new ncfModel();
$ambSr = 'wa_sr_t4';
$vencSr = date('Y-m-d', strtotime('+1 year'));
// Vencido hace 3 dias, no ayer: CURDATE() es la fecha del servidor MySQL, que otra zona horaria
// puede dejar un dia delante o detras de la de PHP durante unas horas; con "ayer" el rango
// seguiria vigente en esas horas.
$vencidoSr = date('Y-m-d', strtotime('-3 days'));
$limpiarSr = static fn() => $pdo->prepare('DELETE FROM ncf_sequences WHERE ambiente = :a')->execute([':a' => $ambSr]);
/** Un rango de prueba en $ambSr; devuelve su id. */
$rangoSr = static function (string $tipo, int $desde, ?int $hasta, int $actual, ?string $venc) use ($pdo, $ambSr): int {
    $pdo->prepare(
        "INSERT INTO ncf_sequences (type, prefix, current_value, numero_desde, numero_hasta, fecha_vencimiento, description, ambiente)
         VALUES (:t, :t2, :cv, :d, :h, :v, 'WA fuera de rango', :a)"
    )->execute([':t' => $tipo, ':t2' => $tipo, ':cv' => $actual, ':d' => $desde, ':h' => $hasta, ':v' => $venc, ':a' => $ambSr]);
    return (int) $pdo->lastInsertId();
};
/** [current_value, numero_hasta] de una fila. */
$filaSr = static function (int $id) use ($pdo): array {
    $st = $pdo->prepare('SELECT current_value, numero_hasta FROM ncf_sequences WHERE id = :id');
    $st->execute([':id' => $id]);
    $f = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    return [(int) ($f['current_value'] ?? -1), isset($f['numero_hasta']) ? (int) $f['numero_hasta'] : null];
};
$limpiarSr();
try {
    // N1 dispenseSinRango: el numero siguiente de un rango agotado, sin el tope numero_hasta.
    $e32 = $rangoSr('E32', 1, 5, 5, $vencSr);
    wa_chk('N1: el rango 1-5 con current_value 5 esta agotado para dispenseNextECF', $ncf->dispenseNextECF('E32', $ambSr) === null);
    $a = $ncf->dispenseSinRango('E32', $ambSr);
    wa_chk('N1: dispenseSinRango da E320000000006 con las claves de dispenseNextECF mas sin_rango',
        array_keys($a ?? []) === ['e_ncf', 'valor', 'rango_id', 'fecha_vencimiento', 'numero_hasta', 'restantes', 'sin_rango']
        && ($a['e_ncf'] ?? null) === 'E320000000006' && ($a['valor'] ?? null) === 6 && $a['rango_id'] === null
        && $a['sin_rango'] === true && $a['numero_hasta'] === 5 && $a['restantes'] === 0 && $a['fecha_vencimiento'] === $vencSr, $a);
    wa_chk('N1: el contador del rango paso de su numero_hasta (6 de 5) y numero_hasta no se toco', $filaSr($e32) === [6, 5], $filaSr($e32));
    $vistos = [$a['valor']];
    for ($i = 0; $i < 20; $i++) {
        $vistos[] = $ncf->dispenseSinRango('E32', $ambSr)['valor'];
    }
    wa_chk('N2: 21 llamadas seguidas dan 6..26, cada numero una sola vez', $vistos === range(6, 26), $vistos);
    wa_chk('N2: el contador queda en 26', $filaSr($e32) === [26, 5], $filaSr($e32));

    // N3 sin filas para el tipo o con un tipo que no es e-CF: null (no hay de donde seguir).
    wa_chk('N3: un tipo sin ninguna fila en ese ambiente da null', $ncf->dispenseSinRango('E33', $ambSr) === null);
    wa_chk('N3: un tipo que no es E## da null', $ncf->dispenseSinRango('B01', $ambSr) === null && $ncf->dispenseSinRango('E3', $ambSr) === null);
    wa_chk('N3: el mismo tipo en OTRO ambiente da null', $ncf->dispenseSinRango('E32', 'wa_sr_otro') === null);

    // N4 con dos rangos agotados sigue el de mayor numero_desde; el otro no se toca.
    $primero = $rangoSr('E34', 1, 10, 10, $vencSr);
    $segundo = $rangoSr('E34', 11, 20, 20, $vencSr);
    $n4 = [];
    for ($i = 0; $i < 4; $i++) {
        $n4[] = $ncf->dispenseSinRango('E34', $ambSr)['e_ncf'];
    }
    wa_chk('N4: con dos rangos agotados toma el de mayor numero_desde (E340000000021..24)',
        $n4 === ['E340000000021', 'E340000000022', 'E340000000023', 'E340000000024'] && $filaSr($segundo) === [24, 20] && $filaSr($primero) === [10, 10],
        [$n4, $filaSr($primero), $filaSr($segundo)]);

    // N5 rango vencido: dispenseNextECF no da numero; dispenseSinRango sigue y trae el vencimiento del ultimo rango.
    $vencido = $rangoSr('E41', 1, 100, 40, $vencidoSr);
    $v = $ncf->dispenseSinRango('E41', $ambSr);
    wa_chk('N5: rango vencido (current_value 40 de 100): dispenseNextECF null y dispenseSinRango da el 41 con el vencimiento del rango',
        $ncf->dispenseNextECF('E41', $ambSr) === null && ($v['valor'] ?? null) === 41 && ($v['fecha_vencimiento'] ?? null) === $vencidoSr
        && ($v['numero_hasta'] ?? null) === 100, $v);

    // N6 rangoCubre.
    $sinLimite = $rangoSr('E43', 1, null, 0, null);
    $cubre = [
        'E32 5 (el ultimo del rango)' => $ncf->rangoCubre('E32', $ambSr, 5),
        'E32 6 (fuera)' => $ncf->rangoCubre('E32', $ambSr, 6),
        'E32 1 (el primero)' => $ncf->rangoCubre('E32', $ambSr, 1),
        'E32 0' => $ncf->rangoCubre('E32', $ambSr, 0),
        'E34 10 y 11 (dos rangos)' => $ncf->rangoCubre('E34', $ambSr, 10) && $ncf->rangoCubre('E34', $ambSr, 11),
        'E34 20' => $ncf->rangoCubre('E34', $ambSr, 20),
        'E34 21 (fuera)' => $ncf->rangoCubre('E34', $ambSr, 21),
        'E41 41 (vencido)' => $ncf->rangoCubre('E41', $ambSr, 41),
        'E43 99999 (sin limite)' => $ncf->rangoCubre('E43', $ambSr, 99999),
        'E31 (sin filas)' => $ncf->rangoCubre('E31', $ambSr, 1),
        'E32 en otro ambiente' => $ncf->rangoCubre('E32', 'wa_sr_otro', 3),
        'B01' => $ncf->rangoCubre('B01', $ambSr, 1),
    ];
    wa_chk('N6: rangoCubre es true solo dentro de un rango registrado y vigente (hasta NULL = sin limite)',
        $cubre === [
            'E32 5 (el ultimo del rango)' => true, 'E32 6 (fuera)' => false, 'E32 1 (el primero)' => true, 'E32 0' => false,
            'E34 10 y 11 (dos rangos)' => true, 'E34 20' => true, 'E34 21 (fuera)' => false, 'E41 41 (vencido)' => false,
            'E43 99999 (sin limite)' => true, 'E31 (sin filas)' => false, 'E32 en otro ambiente' => false, 'B01' => false,
        ], $cubre);

    // N7 registrar un rango que cubre los numeros ya usados: antes lo bloqueaba el current_value pasado del tope.
    $res = $ncf->registerRange('E32', 6, 100, $vencSr, null, null, $ambSr);
    $nuevo = (int) ($res[1]['id'] ?? 0);
    wa_chk('N7: registerRange 6-100 sobre un rango 1-5 con current_value 26 se registra, con 74 restantes (100 - 26)',
        ($res[0] ?? null) === 'success' && ($res[1]['restantes'] ?? null) === 74, $res);
    wa_chk('N7: el rango viejo vuelve a su numero_hasta (5 de 5) y el nuevo arranca en 26 (lo usado dentro de el)',
        $filaSr($e32) === [5, 5] && $nuevo > 0 && $filaSr($nuevo) === [26, 100], [$filaSr($e32), $filaSr($nuevo)]);
    $sig = $ncf->dispenseNextECF('E32', $ambSr);
    wa_chk('N7: dispenseNextECF da el 27: nunca reparte un numero ya usado (6..26)',
        ($sig['valor'] ?? null) === 27 && ($sig['rango_id'] ?? null) === $nuevo, $sig);
    wa_chk('N7: rangoCubre ya es true para 6, 26 y 100, y false para 101',
        $ncf->rangoCubre('E32', $ambSr, 6) && $ncf->rangoCubre('E32', $ambSr, 26) && $ncf->rangoCubre('E32', $ambSr, 100)
        && !$ncf->rangoCubre('E32', $ambSr, 101));
    $solapa = $ncf->registerRange('E32', 90, 200, $vencSr, null, null, $ambSr);
    wa_chk('N7: un rango que empieza dentro del autorizado sigue rechazado (el tope es el numero_hasta, 100)',
        ($solapa[0] ?? null) === 'error' && str_contains((string) ($solapa[1] ?? ''), 'debe ser mayor que 100'), $solapa);

    // N8 cobertura parcial: el rango nuevo empieza despues de algunos numeros usados fuera de rango.
    $parcial = $ncf->registerRange('E34', 23, 50, $vencSr, null, null, $ambSr);
    $nuevoParcial = (int) ($parcial[1]['id'] ?? 0);
    wa_chk('N8: E34 usado hasta el 24 (21..24 fuera de rango): el rango 23-50 se registra con current_value 24 (26 restantes)',
        ($parcial[0] ?? null) === 'success' && ($parcial[1]['restantes'] ?? null) === 26 && $filaSr($nuevoParcial) === [24, 50]
        && $filaSr($segundo) === [20, 20], [$parcial, $filaSr($segundo)]);
    wa_chk('N8: 21 y 22 quedan sin cubrir (soporte), 23 y 24 cubiertos, y el siguiente es el 25',
        !$ncf->rangoCubre('E34', $ambSr, 21) && !$ncf->rangoCubre('E34', $ambSr, 22) && $ncf->rangoCubre('E34', $ambSr, 23)
        && $ncf->rangoCubre('E34', $ambSr, 24) && ($ncf->dispenseNextECF('E34', $ambSr)['valor'] ?? null) === 25);

    // N9 sin numeros fuera de rango registerRange se porta como siempre.
    $r1 = $ncf->registerRange('E31', 1, 10, $vencSr, null, null, $ambSr);
    $r2 = $ncf->registerRange('E31', 11, 20, $vencSr, null, null, $ambSr);
    $r3 = $ncf->registerRange('E31', 5, 30, $vencSr, null, null, $ambSr);
    wa_chk('N9: sin sobrepaso: 1-10 y 11-20 se registran con current_value en desde - 1, y 5-30 se rechaza',
        ($r1[0] ?? null) === 'success' && ($r1[1]['restantes'] ?? null) === 10 && ($r2[0] ?? null) === 'success'
        && ($r2[1]['restantes'] ?? null) === 10 && $filaSr((int) $r2[1]['id']) === [10, 20]
        && ($r3[0] ?? null) === 'error' && str_contains((string) ($r3[1] ?? ''), 'debe ser mayor que 20'), [$r1, $r2, $r3]);
} finally {
    $limpiarSr();
}
wa_chk('N: el ambiente de prueba quedo vacio',
    (int) $pdo->query("SELECT COUNT(*) FROM ncf_sequences WHERE ambiente = '{$ambSr}'")->fetchColumn() === 0);
```

Run: `php -l tools/test_reservar_confirmar.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -4`

Expected: the 47 earlier checks pass; under `== ncfModel fuera de rango en wa_scratch ==` the first line is `[OK  ] N1: el rango 1-5 con current_value 5 esta agotado para dispenseNextECF`, then `[FALLO] excepcion sin atrapar: Error (test_reservar_confirmar.php:<line>): Call to undefined method ncfModel::dispenseSinRango()`, exit code 1.

- [ ] **Step 5: `DgiiAuthService::ambienteEfectivo`, the exception docblock and the meta mark**

**5a.** In `src/Utils/FacturacionElectronica/DgiiAuthService.php`:

Replace:

```php
    private function buildConfig(array $options): array
    {
```

with:

```php
    /**
     * Ambiente (testecf | certecf | ecf) con el que autenticar() pediria el token
     * con estas mismas $options, SIN llamar a la DGII: el override de $options, el
     * del tenant (AmbienteResolver) o el global del .env, con los alias ya
     * normalizados. Lo usa quien necesita el ambiente antes de tener el token
     * (la reserva del write-ahead del POS, que pide el token despues de guardar).
     */
    public function ambienteEfectivo(array $options = []): string
    {
        return $this->buildConfig($options)['environment'];
    }

    private function buildConfig(array $options): array
    {
```

`buildConfig` is the very function `autenticar()` runs through `obtenerSemilla`, so the answer cannot drift from the token's environment.

**5b.** In `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php`:

Replace:

```php
    /** 'envio' (fallo el envio) o 'confirmar' (la DGII respondio y fallo el UPDATE). */
```

with:

```php
    /**
     * 'envio' (fallo el envio), 'confirmar' (la DGII respondio y fallo el UPDATE)
     * o 'autenticar' (solo el POS, que pide el token DESPUES de reservar: fallo el
     * token y nada salio hacia la DGII).
     */
```

**5c.** In `src/Models/facturaModel.php`, the in-flight meta learns `sin_rango`. It is added only when true, so every other row keeps the exact Release 1 meta (the existing `ENVIO_INCIERTO` checks of the puro, reservar/confirmar and ecf suites pin its 12 keys in order, and section 15 pins the 7 keys of the reserve meta):

**1. `metaEnVuelo`: `sin_rango` only when true**

Replace:

```php
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
```

with:

```php
    private static function metaEnVuelo(array $ctx): array
    {
        $meta = [
            'desde' => $ctx['desde'] ?? null,
            'flujo' => $ctx['flujo'] ?? null,
            'ambiente_secuencia' => $ctx['ambiente_secuencia'] ?? null,
            'dispensado' => $ctx['dispensado'] ?? null,
            'rango_id' => $ctx['rango_id'] ?? null,
            'secuencia_valor' => $ctx['secuencia_valor'] ?? null,
        ];
        // Venta del POS numerada fuera de rango (ncfModel::dispenseSinRango): la marca solo
        // existe cuando es true, asi el resto de las filas guarda la meta de siempre.
        if (!empty($ctx['sin_rango'])) {
            $meta['sin_rango'] = true;
        }
        return $meta;
    }
```

**2. `metaEnvio` docblock**

Replace:

```php
     * secuencia_valor y, en ENVIO_INCIERTO, el fallo. [] si no hay meta: NULL,
```

with:

```php
     * secuencia_valor, sin_rango (solo cuando es true: venta del POS numerada
     * fuera de rango, sin enviar) y, en ENVIO_INCIERTO, el fallo. [] si no hay
     * meta: NULL,
```

- [ ] **Step 6: `ncfModel`: `dispenseSinRango`, `rangoCubre` and `registerRange`**

In `src/Models/ncfModel.php`, apply these six replacements. The number comes from `UPDATE ... SET current_value = LAST_INSERT_ID(current_value + 1)` and `PDO::lastInsertId()`: the new value travels in the same statement and connection, so two sales at once can never read the same number (`dispenseNextECF`'s UPDATE-then-SELECT can).

**1. Add `dispenseSinRango` and `rangoCubre` above `listRanges`**

Replace:

```php
    /**
     * Lista los rangos e-NCF del ambiente con uso/restantes/estado calculados.
```

with:

```php
    /**
     * Numero SIGUIENTE al ultimo usado de un tipo y ambiente cuando ningun rango
     * vigente tiene numeros libres (dispenseNextECF devolvio null): el POS no se
     * detiene por la secuencia (spec 4.2.6). Incrementa de forma atomica el
     * current_value del rango de mayor numero_desde SIN el tope numero_hasta, asi
     * que el contador pasa del final autorizado. La DGII rechaza los numeros
     * fuera de un rango autorizado: quien lo use guarda la venta con la meta
     * sin_rango y NO la envia hasta que rangoCubre() sea true.
     *
     * Mismas claves que dispenseNextECF mas 'sin_rango' => true. rango_id es null
     * (ningun rango autorizado es dueno del numero), numero_hasta y
     * fecha_vencimiento son los del ultimo rango y restantes es 0. El valor se
     * lee con LAST_INSERT_ID(expr) en la misma sentencia y conexion: dos ventas a
     * la vez nunca reciben el mismo numero.
     *
     * @return array|null null si el tipo no es E\d\d o el tipo no tiene ninguna
     *                    fila de rango en ese ambiente (no hay de donde seguir)
     * @throws RuntimeException si ncf_sequences no se puede leer o actualizar
     */
    public function dispenseSinRango(string $type, string $ambiente): ?array
    {
        if (!preg_match('/^E\d{2}$/', $type)) {
            return null;
        }
        try {
            $sel = $this->conexion->prepare(
                'SELECT id, numero_hasta, fecha_vencimiento FROM ncf_sequences
                 WHERE type = :type AND ambiente = :ambiente
                 ORDER BY numero_desde DESC LIMIT 1'
            );
            $sel->execute([':type' => $type, ':ambiente' => $ambiente]);
            $rango = $sel->fetch(PDO::FETCH_ASSOC);
            if (!$rango) {
                return null;
            }
            $upd = $this->conexion->prepare(
                'UPDATE ncf_sequences SET current_value = LAST_INSERT_ID(current_value + 1) WHERE id = :id'
            );
            $upd->execute([':id' => $rango['id']]);
            $current = (int) $this->conexion->lastInsertId();
            if ($current < 1) {
                throw new RuntimeException('el contador no devolvio el numero nuevo');
            }
            return [
                'e_ncf' => $type . str_pad((string) $current, 10, '0', STR_PAD_LEFT),
                'valor' => $current,
                'rango_id' => null,
                'fecha_vencimiento' => $rango['fecha_vencimiento'] ?: null,
                'numero_hasta' => $rango['numero_hasta'] !== null ? (int) $rango['numero_hasta'] : null,
                'restantes' => 0,
                'sin_rango' => true,
            ];
        } catch (PDOException $e) {
            throw new RuntimeException('ncf_sequences inaccesible: ' . $e->getMessage(), 0, $e);
        }
    }

    /**
     * true si el numero $valor de un tipo y ambiente cae dentro de un rango
     * autorizado registrado y vigente: numero_desde <= valor <= numero_hasta
     * (numero_hasta NULL = sin limite) y sin vencer. Decide si una venta guardada
     * fuera de rango (meta sin_rango) ya se puede enviar a la DGII (spec 4.3.5).
     * Ante un fallo de la base devuelve false: con la duda no se envia.
     */
    public function rangoCubre(string $type, string $ambiente, int $valor): bool
    {
        if (!preg_match('/^E\d{2}$/', $type) || $valor < 1) {
            return false;
        }
        try {
            $st = $this->conexion->prepare(
                'SELECT 1 FROM ncf_sequences
                 WHERE type = :type AND ambiente = :ambiente
                   AND numero_desde <= :desde AND (numero_hasta IS NULL OR numero_hasta >= :hasta)
                   AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
                 LIMIT 1'
            );
            $st->execute([':type' => $type, ':ambiente' => $ambiente, ':desde' => $valor, ':hasta' => $valor]);
            return $st->fetchColumn() !== false;
        } catch (PDOException $e) {
            error_log('[NCF] rangoCubre fallo: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Lista los rangos e-NCF del ambiente con uso/restantes/estado calculados.
```

**2. `registerRange` docblock**

Replace:

```php
     * "sin limite" (legacy, numero_hasta NULL) se CIERRA en su consumo actual
     * para que el nuevo rango pase a dispensar.
     *
```

with:

```php
     * "sin limite" (legacy, numero_hasta NULL) se CIERRA en su consumo actual
     * para que el nuevo rango pase a dispensar.
     *
     * Numeros usados fuera de rango (dispenseSinRango, venta del POS con el rango
     * agotado): el contador del ultimo rango paso de su numero_hasta. Eso no
     * cuenta como tope: el rango nuevo puede cubrirlos, arranca DESPUES del
     * ultimo que cae dentro de el (para que dispenseNextECF no reparta un numero
     * ya usado) y el rango viejo vuelve a su numero_hasta.
     *
```

**3. `registerRange`: the floor is `numero_hasta`, not an overshoot of `current_value`**

Replace:

```php
                $tope = max($tope, (int) $e['current_value'], (int) ($e['numero_hasta'] ?? 0));
```

with:

```php
                // Con numero_hasta manda el final autorizado: un current_value MAYOR son
                // numeros usados fuera de rango, que el rango nuevo puede cubrir. Sin
                // numero_hasta (legacy) manda el consumo.
                $tope = max($tope, $e['numero_hasta'] !== null ? (int) $e['numero_hasta'] : (int) $e['current_value']);
```

**4. `registerRange`: compute where the new range starts and bring the old rows back to their `numero_hasta`**

Replace:

```php
            // Cerrar la fila legacy sin limite en su consumo actual.
```

with:

```php
            // Numeros usados fuera de rango: el rango nuevo arranca despues del ultimo que
            // cae dentro de el y los rangos viejos vuelven a su numero_hasta.
            $sobrepaso = 0;
            foreach ($existentes as $e) {
                if ($e['numero_hasta'] !== null && (int) $e['current_value'] > (int) $e['numero_hasta']) {
                    $sobrepaso = max($sobrepaso, (int) $e['current_value']);
                }
            }
            $cvNuevo = max($numeroDesde - 1, min($sobrepaso, $numeroHasta));
            if ($sobrepaso > 0) {
                $this->conexion->prepare(
                    'UPDATE ncf_sequences SET current_value = numero_hasta
                      WHERE type = :type AND ambiente = :amb AND numero_hasta IS NOT NULL AND current_value > numero_hasta'
                )->execute([':type' => $type, ':amb' => $amb]);
            }

            // Cerrar la fila legacy sin limite en su consumo actual.
```

**5. `registerRange`: the new row starts at `$cvNuevo`**

Replace:

```php
                ':cv' => $numeroDesde - 1, // ultimo dispensado = ninguno aun
```

with:

```php
                ':cv' => $cvNuevo, // ultimo dispensado: ninguno aun, o el ultimo numero fuera de rango que cae aqui
```

**6. `registerRange`: `restantes` from `$cvNuevo`**

Replace:

```php
                'restantes' => $numeroHasta - ($numeroDesde - 1),
```

with:

```php
                'restantes' => $numeroHasta - $cvNuevo,
```

- [ ] **Step 7: `ECFEmissionService`: docblock, options and dispense**

In `src/Utils/FacturacionElectronica/ECFEmissionService.php`, apply these seven replacements. 1-3 are docblock text, 4-5 declare the options and the `$sinRango` flag, 6-7 are the dispense loop (a number that comes out of range is just another number for the `eNcfYaUsado` skip loop: it stays inside the same `do { ... } while`).

**1. Docblock: the three POS options**

Replace:

```php
     *   tipo_ecf, comprador (assoc), items (array of assoc), totales (assoc).
```

with:

```php
     *   tipo_ecf, comprador (assoc), items (array of assoc), totales (assoc).
     *   Opciones del POS (todas opcionales; sin ellas la emision es la de siempre):
     *   - dgii_timeout (segundos): espera al ENVIAR a la DGII; con
     *       autenticar_despues_de_reservar tambien al pedir el token.
     *   - reclamar_secuencia (bool, true): con false el numero NUNCA vuelve al
     *       contador despues del veredicto (reclamarSecuenciaSiNoUtilizada): ya
     *       esta impreso. Un fallo ANTES de reservar si lo devuelve: no se uso.
     *   - autenticar_despues_de_reservar (bool; solo con gancho): el token de la
     *       DGII se pide DESPUES de 'reservar'; la reserva usa el ambiente de
     *       DgiiAuthService::ambienteEfectivo. Si pedir el token falla, la fila
     *       queda ENVIO_INCIERTO (fase_fallida 'autenticar') y sale
     *       EcfEnvioInciertoException.
     *   - numerar_sin_rango (bool; solo con gancho): sin rango con numeros libres
     *       se toma el numero siguiente al ultimo (ncfModel::dispenseSinRango); la
     *       fila se reserva con la meta sin_rango y emitir() vuelve SIN llamar a
     *       la DGII (ni para el token) con estado PENDIENTE_ENVIO y sin_rango true.
```

**2. Docblock: `sin_rango` in the `reservar` ctx**

Replace:

```php
     *       un e_ncf override), desde (Y-m-d H:i:s del servidor).
```

with:

```php
     *       un e_ncf override), desde (Y-m-d H:i:s del servidor); mas sin_rango
     *       (true) solo cuando el numero salio de dispenseSinRango (rango_id null).
```

**3. Docblock: `autenticar` as a `fase_fallida`**

Replace:

```php
     *       'reservar') + reserva, fase_fallida (envio|confirmar|shutdown),
```

with:

```php
     *       'reservar') + reserva, fase_fallida (autenticar|envio|confirmar|shutdown),
```

**4. Parse the options right after the integration guard**

Replace:

```php
        if ($integration && $persistencia !== null) {
            // Un tenant de integracion no tiene DB propia: no hay donde reservar.
            throw new InvalidArgumentException('write-ahead no aplica a integracion (sin DB de tenant)');
        }
```

with:

```php
        if ($integration && $persistencia !== null) {
            // Un tenant de integracion no tiene DB propia: no hay donde reservar.
            throw new InvalidArgumentException('write-ahead no aplica a integracion (sin DB de tenant)');
        }
        // Opciones del POS (ver el docblock). Las dos de "despues de reservar" necesitan el
        // gancho: sin fila reservada no hay nada que proteger ni que dejar pendiente.
        $reclamarSecuencia = ($payload['reclamar_secuencia'] ?? true) !== false;
        $autenticarDespues = $persistencia !== null && !empty($payload['autenticar_despues_de_reservar']);
        $numerarSinRango = $persistencia !== null && !empty($payload['numerar_sin_rango']);
```

**5. Declare `$sinRango` next to `$rangoVencimiento`**

Replace:

```php
        $rangoVencimiento = null; // vencimiento del rango autorizado que dispensa
```

with:

```php
        $rangoVencimiento = null; // vencimiento del rango autorizado que dispensa
        $sinRango = false; // true: el numero salio de dispenseSinRango (fuera de rango)
```

**6. Dispense loop: no free number and `numerar_sin_rango` -> `dispenseSinRango`**

Replace:

```php
                $disp = $this->ncfModel()->dispenseNextECF('E' . $tipoEcf, $ambienteEarly);
                if ($disp === null) {
                    throw new EcfUsuarioException(
```

with:

```php
                $disp = $this->ncfModel()->dispenseNextECF('E' . $tipoEcf, $ambienteEarly);
                if ($disp === null && $numerarSinRango) {
                    // El POS no se detiene por la secuencia (spec 4.2.6): el numero siguiente al
                    // ultimo usado. Esa venta se guarda y se imprime, pero NO se envia hasta que
                    // un rango autorizado registrado la cubra (ncfModel::rangoCubre).
                    $disp = $this->ncfModel()->dispenseSinRango('E' . $tipoEcf, (string) $ambienteEarly);
                }
                if ($disp === null) {
                    throw new EcfUsuarioException(
```

**7. Dispense loop: remember that the number is out of range**

Replace:

```php
            $rangoVencimiento = $disp['fecha_vencimiento'] ?? null;
```

with:

```php
            $rangoVencimiento = $disp['fecha_vencimiento'] ?? null;
            $sinRango = !empty($disp['sin_rango']);
```

- [ ] **Step 8: `ECFEmissionService`: token, reserve, send and reclaim**

In the same file, apply these eight replacements, in this order:
- **1-2** make the token call a ternary: with the token deferred, `$tokenInfo` carries only the environment (no DGII call) and the existing token pre-flight is skipped; otherwise the existing `autenticar()` runs as today, before the reserve;
- **3-4** add `sin_rango` to the reserve ctx and return before arming the shutdown registry;
- **5-6** request the token inside the send `try` (so a failure goes through the existing catch: `ENVIO_INCIERTO`, number kept) and report `autenticar` as the failed phase;
- **7-8** skip `reclamarSecuenciaSiNoUtilizada` when `reclamar_secuencia` is false.

**1. Token call: deferred (`ambienteEfectivo`, no DGII call) or as today**

Replace:

```php
            // El mismo cert firma la semilla de autenticacion DGII.
            $tokenInfo = $this->auth->autenticar([
                'environment' => $payload['ambiente'] ?? null,
                'certificate_content' => $certContent,
                'certificate_password' => $certPassword,
            ]);
```

with:

```php
            // El token se pide DESPUES de reservar con autenticar_despues_de_reservar (POS) y con un
            // numero fuera de rango, que nunca se envia: la reserva usa el ambiente que el token
            // tendria (ambienteEfectivo) y el token se pide mas abajo, dentro del envio. Asi una DGII
            // caida no detiene la venta: queda guardada y sin confirmar. Para la app todo sigue igual:
            // sin token no se crea la factura y el numero vuelve a la secuencia.
            $tokenDespues = $autenticarDespues || $sinRango;
            // El mismo cert firma la semilla de autenticacion DGII.
            $tokenInfo = $tokenDespues
                ? ['token' => null, 'ambiente' => $this->auth->ambienteEfectivo(['environment' => $payload['ambiente'] ?? null])]
                : $this->auth->autenticar([
                    'environment' => $payload['ambiente'] ?? null,
                    'certificate_content' => $certContent,
                    'certificate_password' => $certPassword,
                ]);
```

**2. Token pre-flight: only when the token was requested here**

Replace:

```php
            // para que los integradores lean lo de siempre.
            if (trim((string) ($tokenInfo['token'] ?? '')) === '') {
```

with:

```php
            // para que los integradores lean lo de siempre. Con el token diferido no hay token todavia.
            if (!$tokenDespues && trim((string) ($tokenInfo['token'] ?? '')) === '') {
```

**3. `reservar` ctx: `sin_rango` only when true**

Replace:

```php
                    'secuencia_valor' => $dispensamosSecuencia ? $secuenciaValor : null,
                    'desde' => date('Y-m-d H:i:s'),
                ];
                $reserva = $persistencia('reservar', $ctxReservar);
```

with:

```php
                    'secuencia_valor' => $dispensamosSecuencia ? $secuenciaValor : null,
                    'desde' => date('Y-m-d H:i:s'),
                ];
                if ($sinRango) {
                    // Solo cuando es true: la fila lo guarda en su meta y el reenvio del POS la
                    // salta hasta que un rango autorizado cubra el numero.
                    $ctxReservar['sin_rango'] = true;
                }
                $reserva = $persistencia('reservar', $ctxReservar);
```

**4. After a valid reserve: a `sin_rango` number returns without any DGII call and without arming the shutdown registry**

Replace:

```php
                self::armarEnVuelo($persistencia, $reserva, $ctxReservar);
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $idReserva));
```

with:

```php
                if ($sinRango) {
                    // Fila guardada (PENDIENTE_ENVIO, meta sin_rango) y NINGUNA llamada a la DGII:
                    // rechaza los numeros fuera de un rango autorizado. No se arma el registro de
                    // cierre: no hay envio que se pueda quedar a medias.
                    error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado fuera de rango, sin enviar', $eNcf, $idReserva));
                    return [
                        'e_ncf' => $eNcf,
                        'tipo_ecf' => $tipoEcf,
                        'signed_xml' => $signedXml,
                        'codigo_seguridad' => $codigoSeguridad,
                        'track_id' => null,
                        'estado' => EstadosEcf::PENDIENTE_ENVIO,
                        'ambiente' => $ambiente,
                        'fecha_emision_dgii' => $fechaEmisionDgii,
                        'dgii_response' => null,
                        'dgii_status_code' => null,
                        'flujo' => $usaRFCE ? 'RFCE' : 'ECF',
                        'factura_id' => $idReserva,
                        'sin_rango' => true,
                    ] + ($usaRFCE ? [
                        'monto_total' => $montoTotal,
                        'rfce_xml' => $signedRfce,
                        'rfce_track_id' => null,
                        'rfce_estado' => null,
                        'rfce_response' => null,
                        'rfce_status_code' => null,
                    ] : []);
                }
                self::armarEnVuelo($persistencia, $reserva, $ctxReservar);
                error_log(sprintf('[ECF e-NCF=%s factura_id=%d] reservado, enviando', $eNcf, $idReserva));
```

**5. Send `try`: request the token here when it was deferred**

The anchor is the two lines that open the send `try` (`try {` and `if ($usaRFCE) {`), which appear together once in the file. It does not include the lines above (`$ctxConfirmar = null;`, `$ok = true;`), because Task 1 may have put master's `$opcionesEnvio` block there.

Replace:

```php
        try {
            if ($usaRFCE) {
```

with:

```php
        $faseEnvio = 'envio';
        try {
            if ($tokenDespues) {
                // Token pedido despues de reservar. Cualquier fallo (la DGII no contesta, el
                // token viene vacio) cae al catch de abajo: la fila ya existe y queda
                // ENVIO_INCIERTO con fase_fallida 'autenticar'; el numero no se devuelve. El
                // POS pide el token con el mismo dgii_timeout que usa para enviar.
                $faseEnvio = 'autenticar';
                $opcionesToken = [
                    'environment' => $payload['ambiente'] ?? null,
                    'certificate_content' => $certContent,
                    'certificate_password' => $certPassword,
                ];
                if ((int) ($payload['dgii_timeout'] ?? 0) > 0) {
                    $opcionesToken['timeout'] = (int) $payload['dgii_timeout'];
                }
                $tokenInfo = $this->auth->autenticar($opcionesToken);
                if (trim((string) ($tokenInfo['token'] ?? '')) === '') {
                    throw new RuntimeException('DGII bearer token is required.');
                }
                $bearerToken = $tokenInfo['token'];
                $faseEnvio = 'envio';
            }
            if ($usaRFCE) {
```

**6. Catch of the send: report `autenticar` as the failed phase**

Replace:

```php
                $fase = $ctxConfirmar !== null ? 'confirmar' : 'envio';
```

with:

```php
                $fase = $ctxConfirmar !== null ? 'confirmar' : $faseEnvio;
```

**7. RFCE reclaim: only with `reclamar_secuencia`**

Replace:

```php
            if ($ok) {
                $this->reclamarSecuenciaSiNoUtilizada(
                    $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                    is_array($rfceReception['data'] ?? null) ? $rfceReception['data'] : [],
```

with:

```php
            if ($ok && $reclamarSecuencia) {
                $this->reclamarSecuenciaSiNoUtilizada(
                    $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                    is_array($rfceReception['data'] ?? null) ? $rfceReception['data'] : [],
```

**8. e-CF reclaim: only with `reclamar_secuencia`**

Replace:

```php
        if ($ok) {
            $this->reclamarSecuenciaSiNoUtilizada(
                $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                is_array($reception['data'] ?? null) ? $reception['data'] : [],
```

with:

```php
        if ($ok && $reclamarSecuencia) {
            $this->reclamarSecuenciaSiNoUtilizada(
                $dispensamosSecuencia, $secuenciaType, $secuenciaValor, $ambienteEarly,
                is_array($reception['data'] ?? null) ? $reception['data'] : [],
```

- [ ] **Step 9: Run everything**

```bash
php -l src/Utils/FacturacionElectronica/ECFEmissionService.php
php -l src/Utils/FacturacionElectronica/DgiiAuthService.php
php -l src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php
php -l src/Models/ncfModel.php
php -l src/Models/facturaModel.php
php tools/test_write_ahead_puro.php | grep -E "FALLO|pruebas OK"
php tools/test_notas_vinculadas.php | tail -1
php tools/check_estado_dgii_ancho.php | tail -1
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -3
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_ecf.php --tenant-db=wa_scratch | tail -3
WA_PUERTO_OFFSET=100 php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -3
```

Expected: five `No syntax errors detected`; puro: section 15's 7 checks `[OK  ]`, the same known `[FALLO]` lines (Task 5 clears the first, Task 9 the second) and `204 de 205 pruebas OK` (both numbers grow by 7); `62 de 62 pruebas OK`; `32/32 OK`; reservar/confirmar: `67 de 67 pruebas OK` (the 20 new `N1`-`N9` checks included); ecf: `283 de 283 pruebas OK` (the 49 new `P1`-`P4` checks included); API: `N de N pruebas OK` with the same N that Task 1 recorded for this suite (91 on the pre-merge tree). The API suite is the HTTP regression of the whole write-ahead (real controller hook, the new `confirmar` and `incierto` UPDATEs, and the strict-mode scenarios on the `wa_scratch_sin_gate` copy): it must stay green after Tasks 3 and 4. It starts its own `php -S` servers, so `WA_PUERTO_OFFSET=100` avoids a busy 8099. If rows or counters vanish mid-run, another session used `wa_scratch`: rerun.

- [ ] **Step 10: Commit**

```bash
git add src/Utils/FacturacionElectronica/DgiiAuthService.php src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php src/Utils/FacturacionElectronica/ECFEmissionService.php src/Models/ncfModel.php src/Models/facturaModel.php tools/test_write_ahead_puro.php tools/test_write_ahead_ecf.php tools/test_reservar_confirmar.php
git commit -F - <<'EOF'
feat(ecf): opciones del POS en emitir y numeracion fuera de rango

emitir acepta reclamar_secuencia (false: el numero impreso nunca vuelve al
contador), autenticar_despues_de_reservar (el token se pide despues de guardar;
si falla la fila queda ENVIO_INCIERTO con fase_fallida autenticar) y
numerar_sin_rango (sin rango con numeros libres toma el siguiente al ultimo,
guarda la fila con meta sin_rango y vuelve sin llamar a la DGII).
DgiiAuthService::ambienteEfectivo da el ambiente sin pedir el token.
ncfModel::dispenseSinRango y rangoCubre; registerRange acepta un rango que cubre
los numeros ya usados fuera de rango y arranca despues del ultimo usado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


### Task 5: La venta del POS sobre el write-ahead

`PosVenta::cobrar` stops saving after the send. The factura is reserved (committed) before any DGII call, and every outcome after that is delivered to the cashier as a normal sale.

What `cobrar` answers after this task:

| Outcome | Answer | `venta.estado_dgii` | `venta.envio_pendiente` | Cash, stock, receipt |
|---|---|---|---|---|
| DGII accepts | 201, `repetida:false` | `RFCE_ACEPTADO` (E32) or `ACEPTADO` (E31) | false | yes |
| DGII rejects at sale time | 201 (no more 422 `DGII_RECHAZO`) | `RFCE_RECHAZADO` or `RECHAZADO` | false. The number is NOT returned to the counter | yes |
| DGII answers "in process", "not found", an error, or 2xx without a verdict | 201 | `RFCE_EN_PROCESO`, `RFCE_NO_ENCONTRADO`, `RFCE_ERROR`, `RFCE_ENVIADO` (E31 without the prefix) | `EstadosEcf::envioPendiente`: true for "in process" and `ENVIADO`; false for "not found" and error | yes |
| No answer, DGII token down, any other failure after the reserve | 201 | `ENVIO_INCIERTO` (or `PENDIENTE_ENVIO` if even the mark failed) | true | yes |
| Same clave again, any state | 201, `repetida:true` | the row's own | the row's own | completes whatever was left undone |
| Failure before the reserve | 502 `EMISION_FALLIDA` (transitional: Task 6 replaces it with the factura simple) | none | none | none. The number returns to the counter |

Until Task 8 the automatic resend (`reenviarPendientes`) still picks its flow by the `RFCE_` prefix and writes without compare-and-set. Do not deploy between this task and Task 8.

**Files:**
- Create: `tools/test_pos_write_ahead.php` (75 checks, in-process, against `wa_scratch`).
- Modify: `src/Pos/PosVenta.php`, with one patch script (Step 5) and these anchors:
  - `require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfUsuarioException.php';` (gains two requires);
  - the header rules ` *  - Factura, movimiento de caja y salida de inventario van juntos; si la DGII` through ` *    (decision 17; el contador lo valida en Q1).`;
  - `private const ACEPTADOS = [...]` (removed, with its comment) and `private const RECHAZADOS = [...]` (kept; gains `public static ?Closure $fabricaServicio`);
  - `return self::respuestaDeVentaExistente($pos, $previa, $ancho);` (gains `$body`);
  - `emitirEnTurno`, from `// --- Forma de pago (P1-P3) ---` up to the docblock line ` * Lineas para EcfItemMapper desde el catalogo, y el total en centavos.`;
  - `respuestaDeVentaExistente`, from `/** La venta ya existe con esa clave: se devuelve tal cual (nunca otro e-NCF). */` up to `private static function cobro(int $forma, int $total, ?int $recibido, ?int $devuelta): array`.
- Modify: `src/Models/posModel.php`, `ventaPorClave`: the select list `SELECT id, e_ncf, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, respuesta_dgii, rfce_respuesta` gains `user_id,` (Step 4).
- Modify: `docs/specs/pos.md`, the text `factura + movimiento de caja en una transacción (`saveFacturaConECF` con gancho;`. It is the only doc that still names `saveFacturaConECF`; Task 15 rewrites the paragraph.
- Modify (only if the merge left it): `src/Models/facturaModel.php`, the docblock of `archivarRechazoReenviado`: `reuso su e-NCF, saveFacturaConECF ya lo archivo y esto no hace nada.`
- Test: `tools/test_pos_write_ahead.php` and `tools/test_write_ahead_puro.php` (its last guard, "nada en src, docs ni CLAUDE.md nombra saveFacturaConECF", passes again).

**Interfaces:**
- Consumes:
  - `facturaModel::reservarFacturaECF(array $factura, array $ctx): array` (Task 3). With `$factura['pos'] = ['turno_id' => int, 'pos_empleado_id' => int, 'pos_idempotency_key' => string]` it writes those three columns and `envio_pendiente = 1`. A 1062 on `uk_facturas_pos_idem` throws `EcfVentaRepetidaException(string $clave)`.
  - `facturaModel::confirmarFacturaECF(int, array): bool` and `marcarEnvioIncierto(int, array): bool` (Task 3 keeps `envio_pendiente` in the same UPDATE for rows with `pos_idempotency_key IS NOT NULL`, through `EstadosEcf::envioPendiente(string $estado): int`).
  - `ECFEmissionService::emitir(array $payload, ?callable $persistencia): array` with the options `reclamar_secuencia`, `autenticar_despues_de_reservar` (Task 4) and `dgii_timeout`, `formas_pago` (Task 1). An auth failure after the reserve throws `EcfEnvioInciertoException`.
  - `DgiiAuthService::ambienteEfectivo(array $options = []): string` (Task 4; the test's `FakeAuth` overrides it).
  - `posModel::ventaPorClave`, `movimientoDeFactura`, `registrarMovimiento`, `bloquearClave`, `bloquearTurno`, `abrirTurno`; `inventoryModel::yaMovioDocumento`, `registrarVenta`; `facturaModel::getFacturaItems`; `RepresentacionImpresa::datosRecibo` (via `PosVenta::recibo`).
  - `wa_*` from `tools/write_ahead_test_lib.php`.
- Produces (new `PosVenta` members, signatures exact):

```php
public static ?Closure $fabricaServicio = null;   // test seam; production leaves it null
private static function servicioEmision(): ECFEmissionService
private static function leerCobro(array $body, int $totalCentavos, int $turnoId): array
//   {turno_id, forma_pago, total_centavos, recibido_centavos, devuelta_centavos, iniciada_at}; PosError 422 FORMA_PAGO_INVALIDA | RECIBIDO_INSUFICIENTE
private static function cobroDeMovimiento(array $mov, int $turnoId, int $totalCentavos): array   // same shape, from an existing movement
private static function entregarVenta(posModel $pos, int $facturaId, array $items, ?string $tipoEcf, int $userId, array $cobro, array $auditCtx): void
//   $items: rows with product_id and quantity; $cobro: the leerCobro shape
//   $auditCtx: {accion: string, entidad: ?string, valores: array, descripcion: string}
//   caja only if posModel has no movement for the factura; stock only if yaMovioDocumento('factura', id) is false;
//   audit $auditCtx only if this call wrote the caja. Task 6 passes accion 'POS_VENTA_FACTURA_SIMPLE'.
private static function respuestaDeVentaExistente(posModel $pos, array $venta, int $ancho, array $body): array
//   always 201-shape with repetida:true; calls entregarVenta, so a missing caja/stock is completed
```

  - `posModel::ventaPorClave` now also returns `user_id`.
  - `venta.tipo_ecf` is `null` in the repeat answer when the row's `tipo_ecf` is NULL (a factura simple, Task 6). Task 11 types it as `'31' | '32' | null`.
  - Task 6 replaces the block that starts at `if ($fila === null) {` inside `emitirEnTurno` (the transitional `EMISION_FALLIDA`) and rewrites scenario S7 of the test.
  - Task 8 uses `self::servicioEmision()` inside `reenviarPendientes` to test the resend in-process.
  - `tools/test_pos_write_ahead.php` helpers reused by Tasks 6, 7, 8 and 14: `FakeAuth`, `FakeReception` (modes `acepta`, `rechaza`, `en_proceso`, `no_encontrado`, `error`, `cuelga`), `fixture`, `reiniciar`, `cuerpoVenta`, `venta`, `filaPorClave`, `cajaDe`, `acciones`, `stockDe`, `totalFacturas`, `totalCaja`, `descErr`. The file ends with the two lines `PosVenta::$fabricaServicio = null;` and `wa_fin();`, and later tasks insert before them.

- [ ] **Step 1: Check the prerequisites**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
git log --oneline -1
ls src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php
grep -n "EcfVentaRepetidaException" src/Models/facturaModel.php
grep -n "pos_idempotency_key" src/Models/facturaModel.php
grep -n "public static function envioPendiente" src/Utils/FacturacionElectronica/EstadosEcf.php
grep -n "reclamar_secuencia\|autenticar_despues_de_reservar" src/Utils/FacturacionElectronica/ECFEmissionService.php
grep -n "public function ambienteEfectivo(array \$options = \[\]): string" src/Utils/FacturacionElectronica/DgiiAuthService.php
grep -n "saveFacturaConECF" src/Pos/PosVenta.php
php -d extension=pdo_mysql <<'PHP'
<?php
require 'tools/write_ahead_test_lib.php';
$pdo = wa_pdo('wa_scratch');
$real = wa_base_real('wa_scratch');
foreach (['pos_cajas', 'pos_empleados', 'pos_turnos', 'pos_caja_movimientos'] as $t) {
    echo $t, ' ', wa_tabla_existe($pdo, $real, $t) ? 'si' : 'NO', "\n";
}
echo 'facturas.pos_idempotency_key ', $pdo->query("SHOW COLUMNS FROM facturas LIKE 'pos_idempotency_key'")->fetch() ? 'si' : 'NO', "\n";
PHP
```

Expected:
- `git status --short` shows nothing but the untracked `tools/reconstruir_e340000000001.sql`; the last commit is Task 4's or a later one.
- Every `grep` finds its line.
- The last `grep` prints exactly one line, the `$saved = $facturas->saveFacturaConECF(...)` call inherited from `master`.
- The PHP block prints `si` five times.

If anything is missing, stop: Tasks 1, 3 and 4 come first.

- [ ] **Step 2: Create `tools/test_pos_write_ahead.php` (failing test)**

It covers Review Focus RF1 (two processes, same clave, first one still waiting on the DGII) and RF2 (the server dies between `confirmar` and the cash movement).

```php
<?php
/**
 * test_pos_write_ahead.php — la venta del POS sobre el write-ahead
 * (PosVenta::cobrar), contra la base de prueba.
 *
 * Llama a PosVenta::cobrar en este mismo proceso con una caja, un empleado y un
 * turno abiertos en la base de prueba, y con una DGII falsa que se inyecta por
 * PosVenta::$fabricaServicio: token fijo, firma real con un certificado de
 * prueba, respuestas por modo y sin red. Despues de cada escenario revisa lo que
 * quedo en facturas, pos_caja_movimientos, inventory_movements, audit_logs y el
 * contador de e-NCF.
 *
 * Primero van unas comprobaciones sobre el texto de PosVenta.php (sin base).
 *
 * RF1 (dos peticiones con la misma clave mientras la primera espera a la DGII)
 * lanza un proceso hijo con esta misma prueba (--hijo-cobrar).
 *
 * Nunca toca produccion: wa_usar_base() se niega a usar una base sin la tabla
 * marca zz_write_ahead_scratch.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_pos_write_ahead.php --tenant-db=wa_scratch
 *   (sale con 1 si algo falla)
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/../src/Pos/PosVenta.php';

$base = (string) wa_arg('tenant-db', '');
if ($base === '') {
    fwrite(STDERR, "Uso: php <flags> tools/test_pos_write_ahead.php --tenant-db=<base de prueba>\n");
    exit(1);
}

/**
 * Hijo de RF1: una segunda peticion de la MISMA venta, en otro proceso y con
 * otra conexion. Anota la marca justo antes de cobrar (para que el padre sepa
 * que ya casi esta esperando el candado de la clave) y deja una linea
 * RESULTADO=<json>. Nunca imprime getMessage() de una excepcion (PF-24).
 */
function hijoCobrar(string $base): never
{
    if (function_exists('ini_set')) {
        ini_set('error_log', sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_hijo_' . getmypid() . '.log');
    }
    wa_usar_base($base);
    $salida = [];
    try {
        $cuerpo = json_decode((string) base64_decode((string) wa_arg('cuerpo', '')), true);
        $pos = new posModel();
        file_put_contents((string) wa_arg('marca', ''), '1');
        $r = PosVenta::cobrar(
            $pos,
            ['habilitado_por' => 1],
            ['id' => (int) wa_arg('empleado', '0'), 'nombre' => 'WA cajero'],
            ['id' => (int) wa_arg('caja', '0')],
            is_array($cuerpo) ? $cuerpo : []
        );
        $salida = ['repetida' => $r['repetida'], 'factura_id' => $r['venta']['factura_id'], 'estado' => $r['venta']['estado_dgii']];
    } catch (PosError $e) {
        $salida = ['error' => $e->codigo()];
    } catch (Throwable $e) {
        $salida = ['error' => get_class($e)];
    }
    echo 'RESULTADO=' . json_encode($salida) . "\n";
    exit(0);
}
if (wa_arg('hijo-cobrar') !== null) {
    hijoCobrar($base);
}

// error_log a un archivo propio: no ensucia la salida de la prueba.
$GLOBALS['pw_log'] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_' . getmypid() . '.log';
@unlink($GLOBALS['pw_log']);
ini_set('log_errors', '1');
ini_set('error_log', $GLOBALS['pw_log']);
register_shutdown_function(static function (): void {
    @unlink($GLOBALS['pw_log']);
});

// Certificado de prueba para la firma real. Las URL de la DGII apuntan al puerto
// 9 (discard): si algo se saltara los dobles, falla en vez de salir a la red.
$cert = wa_cert_prueba();
foreach ([
    'DGII_ECF_CERT_PATH' => $cert['path'],
    'DGII_ECF_CERT_PASSWORD' => $cert['password'],
    'DGII_ECF_BASE_URL' => 'http://127.0.0.1:9',
    'DGII_FC_BASE_URL' => 'http://127.0.0.1:9',
] as $clave => $valor) {
    putenv("{$clave}={$valor}");
    $_ENV[$clave] = $valor;
}

/** Token fijo: no pide semilla ni firma nada. */
final class FakeAuth extends DgiiAuthService
{
    public bool $falla = false;

    public function autenticar(array $options = []): array
    {
        if ($this->falla) {
            throw new RuntimeException('DGII auth: caida simulada');
        }
        return ['token' => 'tok-prueba', 'ambiente' => 'certecf'];
    }

    public function ambienteEfectivo(array $options = []): string
    {
        return 'certecf';
    }
}

/**
 * La DGII por modo, sin red: 'acepta', 'rechaza' (con secuenciaUtilizada
 * false, que sin reclamar_secuencia=false devolveria el numero), 'en_proceso',
 * 'no_encontrado', 'error' (4xx sin veredicto) o 'cuelga' (timeout). Anota cada
 * llamada; $espia corre antes de responder.
 */
final class FakeReception extends DgiiReceptionService
{
    /** @var list<array{metodo:string, e_ncf:?string}> */
    public array $llamadas = [];
    public ?Closure $espia = null;

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
                return $this->json(400, ['trackId' => $track, 'codigo' => 2, 'estado' => 'Rechazado', 'secuenciaUtilizada' => false]);
            case 'en_proceso':
                return $this->json(200, ['trackId' => $track, 'codigo' => 3, 'estado' => 'En Proceso']);
            case 'no_encontrado':
                return $this->json(200, ['codigo' => 0, 'estado' => 'No encontrado']);
            case 'error':
                return $this->json(400, ['mensajes' => [['valor' => 'Error de prueba', 'codigo' => 1]]]);
            case 'cuelga':
                throw new RuntimeException('HTTP request failed: timeout');
        }
        throw new LogicException('FakeReception: modo desconocido ' . $this->modo);
    }

    private function json(int $status, array $data): array
    {
        return ['status_code' => $status, 'data' => $data, 'raw_body' => (string) json_encode($data), 'endpoint' => 'fake://recepcion'];
    }
}

/** posModel cuyo servidor "muere" al registrar la caja: la venta ya esta guardada y confirmada (RF2). */
final class PosQueMuereAlCobrar extends posModel
{
    public function registrarMovimiento(
        int $turnoId, int $facturaId, string $tipo, int $formaPago, float $monto,
        ?float $recibido, ?float $devuelta, ?string $iniciadaAt
    ): void {
        throw new RuntimeException('el servidor murio antes de registrar la caja');
    }
}

/** posModel que no ve la venta la primera vez que la busca por clave: la carrera de dos peticiones sin candado (S8). */
final class PosQueNoVeLaVenta extends posModel
{
    public int $lecturas = 0;

    public function ventaPorClave(string $clave): ?array
    {
        return ++$this->lecturas === 1 ? null : parent::ventaPorClave($clave);
    }
}

/** UUID v4 en minusculas: la clave de idempotencia que PosVenta exige. */
function nuevaClave(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

/**
 * Caja, empleado y turno abierto de las pruebas (idempotente: borra los turnos
 * y sus movimientos y abre uno nuevo). El producto sembrado cuesta RD$ 1,000 mas
 * ITBIS: una unidad son 118000 centavos.
 * @return array{equipo: array, empleado: array, caja: array, turno: array, product_id: int, client_id: int}
 */
function fixture(PDO $pdo, array $ids): array
{
    $pdo->exec('DELETE FROM pos_caja_movimientos');
    $pdo->exec('DELETE FROM pos_turnos');
    $pdo->exec("INSERT INTO pos_cajas (nombre) VALUES ('WA caja POS') ON DUPLICATE KEY UPDATE activa = 1");
    $pdo->prepare("INSERT INTO pos_empleados (nombre, rol, pin_hmac) VALUES ('WA cajero', 'cajero', :h) ON DUPLICATE KEY UPDATE activo = 1")
        ->execute([':h' => hash('sha256', 'wa-pos-cajero')]);
    $caja = (int) $pdo->query("SELECT id FROM pos_cajas WHERE nombre = 'WA caja POS'")->fetchColumn();
    $st = $pdo->prepare('SELECT id FROM pos_empleados WHERE pin_hmac = :h');
    $st->execute([':h' => hash('sha256', 'wa-pos-cajero')]);
    $empleado = (int) $st->fetchColumn();
    $turno = (new posModel())->abrirTurno($caja, $empleado, 0.0);
    return [
        'equipo' => ['habilitado_por' => 1],
        'empleado' => ['id' => $empleado, 'nombre' => 'WA cajero'],
        'caja' => ['id' => $caja],
        'turno' => $turno,
        'product_id' => $ids['product_id'],
        'client_id' => $ids['client_id'],
    ];
}

/** Base limpia entre escenarios: sin facturas, movimientos, auditoria ni contadores; el turno sigue abierto. */
function reiniciar(PDO $pdo): void
{
    $pdo->exec('DELETE FROM pos_caja_movimientos');
    wa_limpiar($pdo);
}

/** Cuerpo de POST /api/pos/ventas: una unidad del producto sembrado, en efectivo con RD$ 1,500. */
function cuerpoVenta(array $f, array $op = []): array
{
    $tipo = (string) ($op['tipo'] ?? '32');
    return [
        'clave' => $op['clave'] ?? nuevaClave(),
        'tipo_ecf' => $tipo,
        'client_id' => $tipo === '31' ? $f['client_id'] : null,
        'lineas' => [['product_id' => $f['product_id'], 'cantidad' => 1]],
        'total_centavos' => 118000,
        'forma_pago' => 1,
        'recibido_centavos' => 150000,
        'ancho' => 80,
        'iniciada_ms' => null,
    ];
}

/**
 * Un cobro con dobles frescos. Opciones: modo (FakeReception), espia,
 * auth_falla, tipo, cuerpo (el cuerpo completo, para repetir una clave) y pos
 * (el posModel). Devuelve la respuesta o la excepcion, el espia de la DGII y si
 * quedo una transaccion abierta (se cierra antes de contar).
 */
function venta(PDO $pdo, array $f, array $op = []): array
{
    $auth = new FakeAuth();
    $auth->falla = (bool) ($op['auth_falla'] ?? false);
    $rec = new FakeReception($auth, (string) ($op['modo'] ?? 'acepta'));
    $rec->espia = $op['espia'] ?? null;
    PosVenta::$fabricaServicio = static fn(): ECFEmissionService => new ECFEmissionService($auth, new DgiiXmlSigner(), $rec);
    $cuerpo = $op['cuerpo'] ?? cuerpoVenta($f, $op);
    $res = null;
    $err = null;
    try {
        $res = PosVenta::cobrar($op['pos'] ?? new posModel(), $f['equipo'], $f['empleado'], $f['caja'], $cuerpo);
    } catch (Throwable $e) {
        $err = $e;
    }
    $txAbierta = $pdo->inTransaction();
    if ($txAbierta) {
        $pdo->rollBack();
    }
    return ['res' => $res, 'err' => $err, 'rec' => $rec, 'cuerpo' => $cuerpo, 'tx_abierta' => $txAbierta];
}

/**
 * La excepcion de un escenario como detalle de un chequeo fallido. El mensaje de
 * una PDOException trae texto del driver: de esa solo se describen la clase, el
 * SQLSTATE y el errno, nunca getMessage().
 */
function descErr(?Throwable $e): ?string
{
    if ($e === null) {
        return null;
    }
    if ($e instanceof PDOException) {
        $info = (array) $e->errorInfo;
        return get_class($e) . ' codigo ' . $e->getCode() . ' errno ' . ($info[1] ?? '?');
    }
    return get_class($e) . ': ' . $e->getMessage();
}

/** La fila de facturas de una clave de idempotencia, o null. */
function filaPorClave(PDO $pdo, string $clave): ?array
{
    $st = $pdo->prepare(
        'SELECT id, e_ncf, tipo_ecf, estado_dgii, envio_pendiente, turno_id, pos_empleado_id, pos_idempotency_key,
                client_id, track_id, secuencia_utilizada, xml_firmado IS NOT NULL AS tiene_xml
         FROM facturas WHERE pos_idempotency_key = :k'
    );
    $st->execute([':k' => $clave]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** Movimientos de caja de tipo VENTA de una factura: cantidad, monto, recibido, devuelta y forma de pago. */
function cajaDe(PDO $pdo, int $facturaId): array
{
    $st = $pdo->prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(monto), 0) AS monto, MAX(monto_recibido) AS recibido, MAX(devuelta) AS devuelta, MAX(forma_pago) AS forma
         FROM pos_caja_movimientos WHERE factura_id = :f AND tipo = 'VENTA'"
    );
    $st->execute([':f' => $facturaId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return [
        'n' => (int) $r['n'],
        'monto' => (float) $r['monto'],
        'recibido' => $r['recibido'] === null ? null : (float) $r['recibido'],
        'devuelta' => $r['devuelta'] === null ? null : (float) $r['devuelta'],
        'forma' => $r['forma'] === null ? null : (int) $r['forma'],
    ];
}

/** Acciones del modulo pos en la bitacora: accion => veces. */
function acciones(PDO $pdo): array
{
    return array_count_values($pdo->query("SELECT action FROM audit_logs WHERE module = 'pos'")->fetchAll(PDO::FETCH_COLUMN));
}

/** products.stock del producto sembrado. */
function stockDe(PDO $pdo, int $productId): float
{
    $st = $pdo->prepare('SELECT stock FROM products WHERE id = :id');
    $st->execute([':id' => $productId]);
    return (float) $st->fetchColumn();
}

/** Facturas del tipo dado (una por e-NCF tomado). */
function totalFacturas(PDO $pdo, string $tipo): int
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM facturas WHERE tipo_ecf = :t');
    $st->execute([':t' => $tipo]);
    return (int) $st->fetchColumn();
}

/** Total de movimientos de caja de cualquier factura. */
function totalCaja(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM pos_caja_movimientos')->fetchColumn();
}

// ---------------------------------------------------------------------------
// 0) El texto de PosVenta.php (sin base): emite con el gancho, ya no guarda
// despues de enviar y no nombra lo que se borro.
// ---------------------------------------------------------------------------
echo "0) PosVenta.php: la venta se guarda antes de enviar\n";
$fuente = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../src/Pos/PosVenta.php'));
wa_chk('PosVenta emite con el gancho de persistencia', str_contains($fuente, '->emitir($payload, $persistencia)'));
wa_chk('PosVenta ya no pasa tolerar_fallo_envio', !str_contains($fuente, 'tolerar_fallo_envio'));
wa_chk('PosVenta pasa reclamar_secuencia=false y autenticar_despues_de_reservar=true',
    str_contains($fuente, "'reclamar_secuencia' => false") && str_contains($fuente, "'autenticar_despues_de_reservar' => true"));
wa_chk('PosVenta no nombra saveFacturaConECF', !str_contains($fuente, 'saveFacturaConECF'));
wa_chk('PosVenta ya no responde DGII_RECHAZO ni GUARDADO_FALLIDO', !str_contains($fuente, 'DGII_RECHAZO') && !str_contains($fuente, 'GUARDADO_FALLIDO'));

$pdo = wa_usar_base($base);
$ids = wa_sembrar($pdo);
$f = fixture($pdo, $ids);
$turnoId = (int) $f['turno']['id'];
$empleadoId = (int) $f['empleado']['id'];

// ---------------------------------------------------------------------------
// S1) E32 aceptada: se guarda antes de enviar y se entrega completa.
// ---------------------------------------------------------------------------
echo "S1) E32 aceptada: la venta queda guardada y entregada\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$r = venta($pdo, $f);
$v = $r['res'];
wa_chk('S1: cobrar no lanza', $r['err'] === null, descErr($r['err']));
$claveS1 = $r['cuerpo']['clave'];
$idS1 = (int) ($v['venta']['factura_id'] ?? 0);
$filaS1 = filaPorClave($pdo, $claveS1) ?? [];
wa_chk('S1: una venta nueva con el primer e-NCF del contador',
    ($v['repetida'] ?? null) === false && ($v['venta']['e_ncf'] ?? null) === sprintf('E32%010d', $antes + 1), $v['venta'] ?? null);
wa_chk('S1: la DGII acepto (RFCE_ACEPTADO) y la fila lo dice',
    ($v['venta']['estado_dgii'] ?? null) === 'RFCE_ACEPTADO' && ($filaS1['estado_dgii'] ?? null) === 'RFCE_ACEPTADO', [$v['venta'] ?? null, $filaS1]);
wa_chk('S1: la fila lleva la clave, el turno y el empleado del POS',
    ($filaS1['pos_idempotency_key'] ?? null) === $claveS1 && (int) ($filaS1['turno_id'] ?? 0) === $turnoId
    && (int) ($filaS1['pos_empleado_id'] ?? 0) === $empleadoId && (int) ($filaS1['tiene_xml'] ?? 0) === 1, $filaS1);
wa_chk('S1: envio_pendiente 0, en la columna y en la respuesta',
    (int) ($filaS1['envio_pendiente'] ?? -1) === 0 && ($v['venta']['envio_pendiente'] ?? null) === false, [$filaS1, $v['venta'] ?? null]);
wa_chk('S1: la DGII recibio el resumen una sola vez',
    count($r['rec']->llamadas) === 1 && $r['rec']->llamadas[0]['metodo'] === 'recibirResumen', $r['rec']->llamadas);
$cajaS1 = cajaDe($pdo, $idS1);
wa_chk('S1: un movimiento de caja de RD$ 1,180 en efectivo, recibido 1,500 y devuelta 320',
    $cajaS1 === ['n' => 1, 'monto' => 1180.0, 'recibido' => 1500.0, 'devuelta' => 320.0, 'forma' => 1], $cajaS1);
wa_chk('S1: un movimiento de inventario y el stock baja a 999',
    wa_movimientos($pdo, $idS1) === 1 && abs(stockDe($pdo, $f['product_id']) - 999.0) < 0.0005, [wa_movimientos($pdo, $idS1), stockDe($pdo, $f['product_id'])]);
wa_chk('S1: el contador avanzo una vez', wa_contador($pdo, 'E32') - $antes === 1);
wa_chk('S1: bitacora POS_VENTA una vez', (acciones($pdo)['POS_VENTA'] ?? 0) === 1, acciones($pdo));
wa_chk('S1: la respuesta trae el recibo', is_array($v['recibo'] ?? null));
wa_chk('S1: sin transaccion abierta al terminar', $r['tx_abierta'] === false);
$reciboS1 = $v['recibo'] ?? null;

// S2) La misma clave otra vez: la misma venta, sin tocar nada.
echo "S2) La misma clave otra vez devuelve la misma venta\n";
$r = venta($pdo, $f, ['cuerpo' => $r['cuerpo']]);
$v2 = $r['res'];
wa_chk('S2: no lanza y responde como venta repetida de la misma factura',
    $r['err'] === null && ($v2['repetida'] ?? null) === true && (int) ($v2['venta']['factura_id'] ?? 0) === $idS1, descErr($r['err']));
wa_chk('S2: la DGII no recibio nada', $r['rec']->llamadas === []);
wa_chk('S2: sigue un solo e-NCF, una caja y un movimiento de inventario',
    wa_contador($pdo, 'E32') - $antes === 1 && cajaDe($pdo, $idS1)['n'] === 1 && wa_movimientos($pdo, $idS1) === 1);
wa_chk('S2: la bitacora no repite POS_VENTA', (acciones($pdo)['POS_VENTA'] ?? 0) === 1, acciones($pdo));
wa_chk('S2: el cobro de la respuesta es el que se registro',
    ($v2['cobro']['forma_pago'] ?? null) === 1 && ($v2['cobro']['recibido_centavos'] ?? null) === 150000
    && ($v2['cobro']['devuelta_centavos'] ?? null) === 32000, $v2['cobro'] ?? null);

// S3) El recibo no depende del estado de la DGII.
echo "S3) El recibo es el mismo sea cual sea el estado del envio\n";
$pdo->prepare("UPDATE facturas SET estado_dgii = 'ENVIO_INCIERTO', envio_pendiente = 1 WHERE id = :id")->execute([':id' => $idS1]);
$reimpreso = PosVenta::recibo($idS1, 80);
wa_chk('S3: el recibo de una venta sin confirmar es igual al de la aceptada',
    is_array($reciboS1) && $reimpreso === $reciboS1, ['antes' => is_array($reciboS1), 'ahora' => is_array($reimpreso)]);

// S4) La DGII rechaza al cobrar: la venta se entrega y el numero no vuelve.
echo "S4) Rechazo de la DGII al cobrar: 201, caja e inventario, y el numero no vuelve\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$r = venta($pdo, $f, ['modo' => 'rechaza']);
$v = $r['res'];
$claveS4 = $r['cuerpo']['clave'];
$idS4 = (int) ($v['venta']['factura_id'] ?? 0);
$filaS4 = filaPorClave($pdo, $claveS4) ?? [];
wa_chk('S4: cobrar no lanza y entrega la venta', $r['err'] === null && ($v['repetida'] ?? null) === false && $idS4 > 0, descErr($r['err']));
wa_chk('S4: la fila queda RFCE_RECHAZADO sin envio pendiente',
    ($filaS4['estado_dgii'] ?? null) === 'RFCE_RECHAZADO' && (int) ($filaS4['envio_pendiente'] ?? -1) === 0, $filaS4);
wa_chk('S4: caja e inventario quedan', cajaDe($pdo, $idS4)['n'] === 1 && wa_movimientos($pdo, $idS4) === 1);
wa_chk('S4: el numero NO vuelve al contador (la DGII dijo secuenciaUtilizada=false)',
    wa_contador($pdo, 'E32') - $antes === 1 && (int) ($filaS4['secuencia_utilizada'] ?? -1) === 0,
    [wa_contador($pdo, 'E32') - $antes, $filaS4['secuencia_utilizada'] ?? null]);
wa_chk('S4: bitacora POS_VENTA y POS_VENTA_RECHAZADA',
    (acciones($pdo)['POS_VENTA'] ?? 0) === 1 && (acciones($pdo)['POS_VENTA_RECHAZADA'] ?? 0) === 1, acciones($pdo));
$r = venta($pdo, $f, ['cuerpo' => $r['cuerpo'], 'modo' => 'rechaza']);
wa_chk('S4: repetir la venta rechazada responde 201 repetida (no 422), sin otra caja',
    $r['err'] === null && ($r['res']['repetida'] ?? null) === true && (int) ($r['res']['venta']['factura_id'] ?? 0) === $idS4
    && cajaDe($pdo, $idS4)['n'] === 1 && $r['rec']->llamadas === [], descErr($r['err']));

// S5) Sin respuesta de la DGII: la venta se entrega, sin confirmar.
echo "S5) La DGII no responde: la venta se entrega y queda sin confirmar\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$r = venta($pdo, $f, ['modo' => 'cuelga']);
$v = $r['res'];
$claveS5 = $r['cuerpo']['clave'];
$idS5 = (int) ($v['venta']['factura_id'] ?? 0);
$filaS5 = filaPorClave($pdo, $claveS5) ?? [];
wa_chk('S5: cobrar no lanza y responde una venta nueva', $r['err'] === null && ($v['repetida'] ?? null) === false && $idS5 > 0, descErr($r['err']));
wa_chk('S5: la fila queda ENVIO_INCIERTO con envio_pendiente 1 (columna y respuesta)',
    ($filaS5['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && (int) ($filaS5['envio_pendiente'] ?? -1) === 1
    && ($v['venta']['envio_pendiente'] ?? null) === true, [$filaS5, $v['venta'] ?? null]);
wa_chk('S5: caja, inventario y recibo', cajaDe($pdo, $idS5)['n'] === 1 && wa_movimientos($pdo, $idS5) === 1 && is_array($v['recibo'] ?? null));
wa_chk('S5: el numero sigue ocupado por la fila', wa_contador($pdo, 'E32') - $antes === 1 && (int) ($filaS5['tiene_xml'] ?? 0) === 1);
$r = venta($pdo, $f, ['cuerpo' => $r['cuerpo']]);
wa_chk('S5: repetir la venta sin confirmar responde 201 repetida con el mismo estado',
    $r['err'] === null && ($r['res']['repetida'] ?? null) === true && ($r['res']['venta']['estado_dgii'] ?? null) === 'ENVIO_INCIERTO'
    && ($r['res']['venta']['envio_pendiente'] ?? null) === true && $r['rec']->llamadas === [], descErr($r['err']));

// S5b) El resto de los resultados despues de guardar tambien se entregan: la DGII
// la tiene en proceso, dice que no la encuentra o contesta con un error.
echo "S5b) En proceso, no encontrada y con error: la venta se entrega igual\n";
foreach ([
    ['modo' => 'en_proceso', 'estado' => 'RFCE_EN_PROCESO', 'pendiente' => 1],
    ['modo' => 'no_encontrado', 'estado' => 'RFCE_NO_ENCONTRADO', 'pendiente' => 0],
    ['modo' => 'error', 'estado' => 'RFCE_ERROR', 'pendiente' => 0],
] as $caso) {
    reiniciar($pdo);
    $antes = wa_contador($pdo, 'E32');
    $r = venta($pdo, $f, ['modo' => $caso['modo']]);
    $v = $r['res'];
    $idX = (int) ($v['venta']['factura_id'] ?? 0);
    $filaX = filaPorClave($pdo, $r['cuerpo']['clave']) ?? [];
    wa_chk("S5b {$caso['modo']}: cobrar no lanza y la fila queda {$caso['estado']}",
        $r['err'] === null && $idX > 0 && ($v['repetida'] ?? null) === false
        && ($filaX['estado_dgii'] ?? null) === $caso['estado'] && ($v['venta']['estado_dgii'] ?? null) === $caso['estado'], [descErr($r['err']), $filaX]);
    wa_chk("S5b {$caso['modo']}: envio_pendiente {$caso['pendiente']} en la columna y en la respuesta",
        (int) ($filaX['envio_pendiente'] ?? -1) === $caso['pendiente'] && ($v['venta']['envio_pendiente'] ?? null) === ($caso['pendiente'] === 1),
        [$filaX, $v['venta'] ?? null]);
    wa_chk("S5b {$caso['modo']}: caja, inventario y recibo, y el numero no vuelve",
        cajaDe($pdo, $idX)['n'] === 1 && wa_movimientos($pdo, $idX) === 1 && is_array($v['recibo'] ?? null)
        && wa_contador($pdo, 'E32') - $antes === 1);
}

// S6) El token de la DGII falla despues de guardar: la venta se entrega sin confirmar.
echo "S6) El token de la DGII falla: la venta ya esta guardada y se entrega\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$r = venta($pdo, $f, ['auth_falla' => true]);
$v = $r['res'];
$idS6 = (int) ($v['venta']['factura_id'] ?? 0);
$filaS6 = filaPorClave($pdo, $r['cuerpo']['clave']) ?? [];
wa_chk('S6: cobrar no lanza y entrega la venta', $r['err'] === null && $idS6 > 0, descErr($r['err']));
wa_chk('S6: la fila queda ENVIO_INCIERTO con envio_pendiente 1 y su XML guardado',
    ($filaS6['estado_dgii'] ?? null) === 'ENVIO_INCIERTO' && (int) ($filaS6['envio_pendiente'] ?? -1) === 1
    && (int) ($filaS6['tiene_xml'] ?? 0) === 1, $filaS6);
wa_chk('S6: nada llego a la DGII', $r['rec']->llamadas === []);
wa_chk('S6: caja e inventario quedan', cajaDe($pdo, $idS6)['n'] === 1 && wa_movimientos($pdo, $idS6) === 1);

// S7) Falla antes de guardar: sin fila, sin caja, sin inventario, y el numero vuelve.
echo "S7) Falla antes de guardar (certificado): nada queda y el numero vuelve\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$certOk = (string) $_ENV['DGII_ECF_CERT_PATH'];
putenv('DGII_ECF_CERT_PATH=' . $certOk . '.no-existe');
$_ENV['DGII_ECF_CERT_PATH'] = $certOk . '.no-existe';
$r = venta($pdo, $f);
putenv('DGII_ECF_CERT_PATH=' . $certOk);
$_ENV['DGII_ECF_CERT_PATH'] = $certOk;
wa_chk('S7: cobrar responde EMISION_FALLIDA',
    $r['err'] instanceof PosError && $r['err']->codigo() === 'EMISION_FALLIDA' && $r['err']->http() === 502, descErr($r['err']));
wa_chk('S7: el texto al cajero no menciona a la DGII',
    $r['err'] instanceof PosError && stripos($r['err']->getMessage(), 'dgii') === false, descErr($r['err']));
wa_chk('S7: no queda fila de esa clave', filaPorClave($pdo, $r['cuerpo']['clave']) === null);
wa_chk('S7: el numero volvio al contador', wa_contador($pdo, 'E32') === $antes, wa_contador($pdo, 'E32') - $antes);
wa_chk('S7: sin caja y sin inventario', totalCaja($pdo) === 0 && (int) $pdo->query('SELECT COUNT(*) FROM inventory_movements')->fetchColumn() === 0);
wa_chk('S7: nada llego a la DGII y la bitacora anota POS_VENTA_FALLIDA',
    $r['rec']->llamadas === [] && (acciones($pdo)['POS_VENTA_FALLIDA'] ?? 0) === 1, acciones($pdo));

// S8) Otra peticion ya guardo la clave (carrera sin candado): se responde como repetida y el numero vuelve.
echo "S8) La clave ya estaba guardada por otra peticion: venta repetida, sin otro e-NCF\n";
reiniciar($pdo);
$r0 = venta($pdo, $f);
$idS8 = (int) ($r0['res']['venta']['factura_id'] ?? 0);
$despues = wa_contador($pdo, 'E32');
$r = venta($pdo, $f, ['cuerpo' => $r0['cuerpo'], 'pos' => new PosQueNoVeLaVenta()]);
wa_chk('S8: no lanza y responde la misma venta como repetida',
    $r['err'] === null && ($r['res']['repetida'] ?? null) === true && (int) ($r['res']['venta']['factura_id'] ?? 0) === $idS8 && $idS8 > 0, descErr($r['err']));
wa_chk('S8: el numero que tomo la segunda peticion volvio al contador', wa_contador($pdo, 'E32') === $despues, wa_contador($pdo, 'E32') - $despues);
wa_chk('S8: sigue una sola factura, una caja y un movimiento de inventario, y la DGII no recibio nada',
    totalFacturas($pdo, '32') === 1 && cajaDe($pdo, $idS8)['n'] === 1 && wa_movimientos($pdo, $idS8) === 1 && $r['rec']->llamadas === []);

// S9) E31 con cliente: el e-CF completo por el mismo camino.
echo "S9) E31 con cliente: guardado antes de enviar y entregado\n";
reiniciar($pdo);
$antes31 = wa_contador($pdo, 'E31');
$r = venta($pdo, $f, ['tipo' => '31']);
$v = $r['res'];
$idS9 = (int) ($v['venta']['factura_id'] ?? 0);
$filaS9 = filaPorClave($pdo, $r['cuerpo']['clave']) ?? [];
wa_chk('S9: cobrar no lanza y entrega un E31 ACEPTADO',
    $r['err'] === null && ($v['venta']['tipo_ecf'] ?? null) === '31' && ($v['venta']['estado_dgii'] ?? null) === 'ACEPTADO'
    && ($v['venta']['e_ncf'] ?? null) === sprintf('E31%010d', $antes31 + 1), [descErr($r['err']), $v['venta'] ?? null]);
wa_chk('S9: la fila lleva el cliente, el trackId y el XML',
    (int) ($filaS9['client_id'] ?? 0) === $f['client_id'] && (string) ($filaS9['track_id'] ?? '') !== '' && (int) ($filaS9['tiene_xml'] ?? 0) === 1, $filaS9);
wa_chk('S9: la DGII recibio el e-CF completo una vez', count($r['rec']->llamadas) === 1 && $r['rec']->llamadas[0]['metodo'] === 'recibir', $r['rec']->llamadas);
wa_chk('S9: caja e inventario', cajaDe($pdo, $idS9)['n'] === 1 && wa_movimientos($pdo, $idS9) === 1);

// RF1) Dos peticiones con la misma clave mientras la primera espera a la DGII.
echo "RF1) Misma clave en dos procesos mientras la primera espera a la DGII\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$cuerpoRf1 = cuerpoVenta($f);
$marca = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_marca_' . getmypid() . '.txt';
$salidaHijo = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_hijo_' . getmypid() . '.out';
@unlink($marca);
$hijo = null;
$pidHijo = 0;
$espiaRf1 = static function () use (&$hijo, &$pidHijo, $base, $f, $cuerpoRf1, $marca, $salidaHijo): void {
    if ($hijo !== null) {
        return;
    }
    $hijo = proc_open(
        array_merge([PHP_BINARY], wa_php_flags(), [
            __FILE__, '--hijo-cobrar', '--tenant-db=' . $base, '--cuerpo=' . base64_encode((string) json_encode($cuerpoRf1)),
            '--empleado=' . $f['empleado']['id'], '--caja=' . $f['caja']['id'], '--marca=' . $marca,
        ]),
        [1 => ['file', $salidaHijo, 'w'], 2 => ['redirect', 1]],
        $tuberias,
        dirname(__DIR__)
    );
    // El pid se lee ahora, con el hijo vivo: proc_close devuelve -1 si antes se
    // pregunto el estado de un proceso que ya habia terminado.
    $pidHijo = is_resource($hijo) ? (int) (proc_get_status($hijo)['pid'] ?? 0) : 0;
    // Espera a que el hijo arranque y conecte, y le deja un margen para que
    // llegue al candado de la clave, que el padre tiene tomado mientras envia.
    for ($i = 0; $i < 200 && !is_file($marca); $i++) {
        usleep(100000);
    }
    usleep(2000000);
};
$r = venta($pdo, $f, ['cuerpo' => $cuerpoRf1, 'espia' => $espiaRf1]);
$codigoHijo = is_resource($hijo) ? proc_close($hijo) : -1;
$textoHijo = (string) @file_get_contents($salidaHijo);
@unlink($salidaHijo);
@unlink($marca);
if ($pidHijo > 0) {
    @unlink(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_hijo_' . $pidHijo . '.log');
}
// De la salida del hijo (stdout y stderr juntos) solo se lee la linea RESULTADO: lo demas no se imprime.
$hijoRes = preg_match('/^RESULTADO=(.*)$/m', $textoHijo, $m) ? json_decode($m[1], true) : null;
$idRf1 = (int) ($r['res']['venta']['factura_id'] ?? 0);
wa_chk('RF1: el padre vende y el hijo termina bien',
    $r['err'] === null && $idRf1 > 0 && $codigoHijo === 0 && is_array($hijoRes), [descErr($r['err']), $codigoHijo, $hijoRes]);
wa_chk('RF1: el hijo recibe la misma venta como repetida',
    is_array($hijoRes) && ($hijoRes['repetida'] ?? null) === true && ($hijoRes['factura_id'] ?? 0) === $idRf1, $hijoRes);
wa_chk('RF1: el hijo espero el candado y vio el veredicto final, no la fila en vuelo',
    is_array($hijoRes) && ($hijoRes['estado'] ?? null) === 'RFCE_ACEPTADO', $hijoRes);
wa_chk('RF1: exactamente un e-NCF', wa_contador($pdo, 'E32') - $antes === 1 && totalFacturas($pdo, '32') === 1);
wa_chk('RF1: un movimiento de caja, un movimiento de inventario y un solo envio a la DGII',
    cajaDe($pdo, $idRf1)['n'] === 1 && wa_movimientos($pdo, $idRf1) === 1 && count($r['rec']->llamadas) === 1);

// RF2) El servidor muere entre 'confirmar' y el movimiento de caja.
echo "RF2) El servidor muere antes de registrar la caja: el reintento la completa una sola vez\n";
reiniciar($pdo);
$antes = wa_contador($pdo, 'E32');
$r = venta($pdo, $f, ['pos' => new PosQueMuereAlCobrar()]);
$claveRf2 = $r['cuerpo']['clave'];
$filaRf2 = filaPorClave($pdo, $claveRf2) ?? [];
$idRf2 = (int) ($filaRf2['id'] ?? 0);
wa_chk('RF2: el cobro se corta con la excepcion de la caja', $r['err'] instanceof RuntimeException, descErr($r['err']));
wa_chk('RF2: la venta quedo guardada y confirmada antes de la caida',
    $idRf2 > 0 && ($filaRf2['estado_dgii'] ?? null) === 'RFCE_ACEPTADO', $filaRf2);
wa_chk('RF2: sin movimiento de caja ni de inventario todavia', cajaDe($pdo, $idRf2)['n'] === 0 && wa_movimientos($pdo, $idRf2) === 0);
$r2 = venta($pdo, $f, ['cuerpo' => $r['cuerpo']]);
wa_chk('RF2: el reintento con la misma clave responde la misma venta como repetida',
    $r2['err'] === null && ($r2['res']['repetida'] ?? null) === true && (int) ($r2['res']['venta']['factura_id'] ?? 0) === $idRf2, descErr($r2['err']));
wa_chk('RF2: el reintento escribe la caja que faltaba, con lo del cuerpo (efectivo 1,500, devuelta 320)',
    cajaDe($pdo, $idRf2) === ['n' => 1, 'monto' => 1180.0, 'recibido' => 1500.0, 'devuelta' => 320.0, 'forma' => 1], cajaDe($pdo, $idRf2));
$usuarioInv = $pdo->prepare("SELECT user_id FROM inventory_movements WHERE referencia_tipo = 'factura' AND referencia_id = :id");
$usuarioInv->execute([':id' => $idRf2]);
wa_chk('RF2: el inventario se mueve una vez, a nombre de quien habilito la caja',
    wa_movimientos($pdo, $idRf2) === 1 && (int) $usuarioInv->fetchColumn() === 1);
wa_chk('RF2: el reintento no vuelve a la DGII ni toma otro numero', $r2['rec']->llamadas === [] && wa_contador($pdo, 'E32') - $antes === 1);
$r3 = venta($pdo, $f, ['cuerpo' => $r['cuerpo']]);
wa_chk('RF2: un segundo reintento no duplica caja, inventario ni bitacora',
    $r3['err'] === null && cajaDe($pdo, $idRf2)['n'] === 1 && wa_movimientos($pdo, $idRf2) === 1 && (acciones($pdo)['POS_VENTA'] ?? 0) === 1, acciones($pdo));

// RF2b) Sin la forma de pago en el reintento, y con la caja sin registrar, no se inventa el cobro.
echo "RF2b) Reintento sin forma de pago valida cuando falta la caja\n";
reiniciar($pdo);
$r = venta($pdo, $f, ['pos' => new PosQueMuereAlCobrar()]);
$idRf2b = (int) (filaPorClave($pdo, $r['cuerpo']['clave'])['id'] ?? 0);
$cuerpoSinPago = $r['cuerpo'];
unset($cuerpoSinPago['forma_pago']);
$r2 = venta($pdo, $f, ['cuerpo' => $cuerpoSinPago]);
wa_chk('RF2b: responde 422 FORMA_PAGO_INVALIDA y no escribe la caja',
    $r2['err'] instanceof PosError && $r2['err']->codigo() === 'FORMA_PAGO_INVALIDA' && cajaDe($pdo, $idRf2b)['n'] === 0, descErr($r2['err']));
$r3 = venta($pdo, $f, ['cuerpo' => $r['cuerpo']]);
wa_chk('RF2b: con el cuerpo completo el reintento la completa',
    $r3['err'] === null && cajaDe($pdo, $idRf2b)['n'] === 1 && wa_movimientos($pdo, $idRf2b) === 1, descErr($r3['err']));

PosVenta::$fabricaServicio = null;
wa_fin();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -l tools/test_pos_write_ahead.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_pos_write_ahead.php --tenant-db=wa_scratch; echo "exit=$?"
```

Expected:
- `No syntax errors detected`.
- Under `0)` the five checks print `[FALLO]`, because `PosVenta.php` still names `tolerar_fallo_envio`, `saveFacturaConECF` and `DGII_RECHAZO`, and emits without the hook.
- The run stops at the first sale with `[FALLO] excepcion sin atrapar: Error (test_pos_write_ahead.php:NNN): Access to undeclared static property PosVenta::$fabricaServicio` and `exit=1`. The line number varies.

- [ ] **Step 4: `posModel::ventaPorClave` also returns `user_id`**

`user_id` is the admin who enabled the register. The retry that completes a missing delivery needs it for the inventory movement. The script changes one piece of text with no line break, so the file's line ending (LF or CRLF) is untouched:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php <<'PHP'
<?php
$ruta = 'src/Models/posModel.php';
$src = (string) file_get_contents($ruta);
$viejo = 'SELECT id, e_ncf, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, respuesta_dgii, rfce_respuesta';
$nuevo = 'SELECT id, e_ncf, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, user_id, respuesta_dgii, rfce_respuesta';
if (str_contains($src, $nuevo)) {
    echo "posModel.php ya estaba parchado\n";
    exit(0);
}
if (substr_count($src, $viejo) !== 1) {
    fwrite(STDERR, "ancla ausente o repetida en posModel.php\n");
    exit(1);
}
file_put_contents($ruta, str_replace($viejo, $nuevo, $src));
echo "posModel.php parchado\n";
PHP
php -l src/Models/posModel.php
git diff --stat -- src/Models/posModel.php
```

Expected: `posModel.php parchado`, `No syntax errors detected`, and a diff of 1 insertion and 1 deletion. If it prints `ancla ausente o repetida`, `posModel.php` is not the `master` file the plan assumes: stop and report.

- [ ] **Step 5: Patch `PosVenta.php`**

The script works on text with `\n`, restores the file's own line ending, aborts if any anchor is missing or repeated (it writes nothing in that case), and does nothing on a second run:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git ls-files --eol src/Pos/PosVenta.php
php <<'PHP'
<?php
// PosVenta.php puede ser CRLF en disco (autocrlf): se compara sobre texto con \n y
// se escribe de vuelta con el final de linea original.
$ruta = 'src/Pos/PosVenta.php';
$orig = (string) file_get_contents($ruta);
$crlf = str_contains($orig, "\r\n");
$src = str_replace("\r\n", "\n", $orig);
if (str_contains($src, 'fabricaServicio')) {
    echo "PosVenta.php ya estaba parchado\n";
    exit(0);
}

/** Reemplaza un texto que tiene que aparecer exactamente una vez. */
$unico = static function (string $viejo, string $nuevo) use (&$src): void {
    if (substr_count($src, $viejo) !== 1) {
        fwrite(STDERR, 'ancla ausente o repetida: ' . strtok($viejo, "\n") . "\n");
        exit(1);
    }
    $src = str_replace($viejo, $nuevo, $src);
};

/** Reemplaza desde el texto $desde hasta (sin incluir) el texto $hasta; los dos aparecen una sola vez. */
$tramo = static function (string $desde, string $hasta, string $nuevo) use (&$src): void {
    if (substr_count($src, $desde) !== 1 || substr_count($src, $hasta) !== 1) {
        fwrite(STDERR, 'limites ausentes o repetidos: ' . strtok($desde, "\n") . ' ... ' . strtok($hasta, "\n") . "\n");
        exit(1);
    }
    $ini = strpos($src, $desde);
    $fin = strpos($src, $hasta);
    if ($fin <= $ini) {
        fwrite(STDERR, "limites en desorden\n");
        exit(1);
    }
    $src = substr($src, 0, $ini) . $nuevo . substr($src, $fin);
};

// 1) Requires: la excepcion del envio incierto (se nombra abajo) y la de la clave repetida.
$unico(<<<'VIEJO'
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfUsuarioException.php';
VIEJO, <<<'NUEVO'
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfUsuarioException.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfVentaRepetidaException.php';
NUEVO);

// 2) Reglas de la cabecera.
$unico(<<<'VIEJO'
 *  - Factura, movimiento de caja y salida de inventario van juntos; si la DGII
 *    rechaza, la factura queda como historial pero sin dinero ni inventario.
 *  - Sin respuesta de la DGII en POS_DGII_TIMEOUT segundos: la venta queda
 *    firmada y guardada con envio pendiente, se imprime y se reenvia sola
 *    (decision 17; el contador lo valida en Q1).
 */
VIEJO, <<<'NUEVO'
 *  - La factura se guarda ANTES de enviarse (gancho write-ahead de emitir). Desde
 *    ahi la venta existe y se entrega (caja, inventario y recibo) pase lo que
 *    pase con el envio: aceptada, rechazada o sin respuesta. El cajero no espera
 *    a la DGII ni la ve; lo que quede abierto lo cierra reenviarPendientes.
 *  - Entregar es una sola funcion idempotente (entregarVenta): repetir la clave
 *    devuelve la misma venta y completa lo que haya quedado sin hacer.
 */
NUEVO);

// 3) Constantes y la fabrica del servicio (solo las pruebas la cambian).
$unico(<<<'VIEJO'
    // Veredictos de la DGII: RFCE (E32 < 250k) y e-CF completo (E31). Lo demas
    // (sin respuesta, ENVIADO / EN_PROCESO esperando veredicto) queda pendiente.
    private const ACEPTADOS = ['RFCE_ACEPTADO', 'RFCE_ACEPTADO_CONDICIONAL', 'ACEPTADO', 'ACEPTADO_CONDICIONAL'];
    private const RECHAZADOS = ['RFCE_RECHAZADO', 'RECHAZADO'];
VIEJO, <<<'NUEVO'
    // Rechazos de la DGII: RFCE (E32 < 250k) y e-CF completo (E31). Solo sirven
    // para la bitacora: una venta rechazada se entrega igual.
    private const RECHAZADOS = ['RFCE_RECHAZADO', 'RECHAZADO'];

    /**
     * Fabrica del servicio de emision. Solo las pruebas (tools/test_pos_write_ahead.php)
     * la cambian, para inyectarle una DGII falsa; en produccion es null y se usa
     * el servicio de verdad.
     */
    public static ?Closure $fabricaServicio = null;
NUEVO);

// 4) La venta repetida necesita el cuerpo del reintento (forma de pago y efectivo).
$unico(<<<'VIEJO'
                return self::respuestaDeVentaExistente($pos, $previa, $ancho);
VIEJO, <<<'NUEVO'
                return self::respuestaDeVentaExistente($pos, $previa, $ancho, $body);
NUEVO);

// 5) emitirEnTurno: de la forma de pago hasta el final de la funcion, mas las ayudas de la entrega.
$tramo(<<<'VIEJO'
        // --- Forma de pago (P1-P3) ---------------------------------------------
VIEJO, <<<'VIEJO'
    /**
     * Lineas para EcfItemMapper desde el catalogo, y el total en centavos.
VIEJO, <<<'NUEVO'
        // --- Forma de pago (P1-P3) ---------------------------------------------
        $cobro = self::leerCobro($body, $totalCentavos, (int) $turno['id']);
        $formaPago = $cobro['forma_pago'];
        $total = $totalCentavos / 100;

        // --- Emision -----------------------------------------------------------
        $itemsXml = EcfItemMapper::map($items, false, true);
        $totales = EcfItemMapper::totales($items, true);
        if ((int) round(((float) ($totales['monto_total'] ?? 0)) * 100) !== $totalCentavos) {
            // No deberia pasar nunca (mismo redondeo): si pasa, no se emite algo
            // distinto de lo que se cobra.
            error_log('[pos] descuadre total: carrito=' . $totalCentavos . ' mapper=' . json_encode($totales));
            throw new PosError('No se pudo cuadrar el total de la venta. Avisa a soporte.', 500, 'DESCUADRE');
        }
        $payload = [
            'tipo_ecf' => $tipoEcf,
            'fecha_emision' => date('d-m-Y'),
            'tipo_ingresos' => '01',
            'tipo_pago' => 1,
            'indicador_monto_gravado' => '1',
            'comprador' => $cliente !== null ? PosCliente::comprador($cliente) : [],
            'items' => $itemsXml,
            'totales' => $totales,
            'formas_pago' => [['forma_pago' => $formaPago, 'monto_pago' => $total]],
            'informacion_referencia' => null,
            'strict_input' => false,
            'dgii_timeout' => self::timeoutDgii(),
            // Opciones de la emision solo para el POS (la app no las pasa y se porta
            // como siempre). El numero de una venta ya sale impreso, asi que NUNCA
            // vuelve al contador, ni aunque la DGII lo rechace. Y el token de la DGII
            // se pide DESPUES de guardar: si la DGII no contesta, la venta queda
            // guardada y sin confirmar en vez de fallar.
            'reclamar_secuencia' => false,
            'autenticar_despues_de_reservar' => true,
        ];

        $auditBase = [
            'pos_empleado_id' => $empleado['id'], 'empleado' => $empleado['nombre'],
            'caja_id' => $caja['id'], 'turno_id' => $turno['id'], 'total' => $total, 'forma_pago' => $formaPago,
        ];

        // Write-ahead: la factura se arma ANTES de emitir y el servicio la guarda
        // (gancho 'reservar') antes de mandar nada a la DGII. Sin 'no_factura': la
        // reserva lo llena con el e-NCF. 'pos' trae las columnas del POS: la reserva
        // las escribe y deja envio_pendiente = 1.
        $facturaInput = [
            'date' => date('Y-m-d H:i:s'),
            'client_id' => $cliente !== null ? (int) $cliente['id'] : null,
            'client_name' => $cliente !== null ? (string) ($cliente['client_name'] ?: PosCliente::forma($cliente)['nombre']) : 'Consumidor Final',
            'total' => $total,
            'tipo_pago' => 1,
            'user_id' => $userId,
            'informacion_referencia' => null,
            'items' => array_map(static function (array $it): array {
                return [
                    'description' => (string) ($it['nombre_item'] ?? ''),
                    'amount' => $it['precio_unitario'] ?? 0,
                    'quantity' => $it['cantidad'] ?? 1,
                    'product_id' => $it['product_id'] ?? null,
                    // Base sin ITBIS (reportes y 607); la RI la vuelve a juntar.
                    'subtotal' => $it['monto_neto'] ?? 0,
                    'descuento_monto' => $it['descuento_monto'] ?? 0,
                    'indicador_facturacion' => $it['indicador_facturacion'] ?? 1,
                    'indicador_bien_servicio' => $it['indicador_bien_servicio'] ?? 1,
                    'unidad_medida' => $it['unidad_medida'] ?? '43',
                    'itbis_amount' => $it['itbis_amount'] ?? 0,
                ];
            }, $itemsXml),
            'pos' => [
                'turno_id' => $turno['id'],
                'pos_empleado_id' => $empleado['id'],
                'pos_idempotency_key' => $clave,
            ],
        ];

        // Mismo gancho que facturaController::emitirFacturaEcf: 'reservar' guarda la
        // fila, 'confirmar' le pone la respuesta de la DGII e 'incierto' la deja
        // ENVIO_INCIERTO si el envio o la confirmacion fallan.
        $facturas = new facturaModel();
        $reserva = null;
        $persistencia = static function (string $fase, array $ctx) use ($facturas, $facturaInput, &$reserva) {
            switch ($fase) {
                case 'reservar':  return $reserva = $facturas->reservarFacturaECF($facturaInput, $ctx);
                case 'confirmar': return $facturas->confirmarFacturaECF((int) $reserva['factura_id'], $ctx);
                case 'incierto':  return $facturas->marcarEnvioIncierto((int) $reserva['factura_id'], $ctx);
            }
            return null;
        };

        $repetida = false;
        $fallo = null;
        try {
            self::servicioEmision()->emitir($payload, $persistencia);
        } catch (EcfVentaRepetidaException $e) {
            // Otra peticion con esta clave ya guardo la venta (el candado de la clave
            // lo hace muy raro). El servicio ya devolvio el numero que habia tomado.
            $repetida = true;
        } catch (Throwable $e) {
            $fallo = $e;
        }

        // Quien dice si la venta existe es la base, no la excepcion: una falla despues
        // de guardar (envio sin respuesta, un gancho que dejo la transaccion abierta)
        // deja la fila en pie, y esa venta se entrega.
        $fila = $pos->ventaPorClave($clave);
        if ($fila === null) {
            // Nada quedo guardado: la venta no se emitio y el numero volvio al contador.
            $causa = $fallo ?? new RuntimeException('la emision termino sin guardar la venta');
            error_log('[pos] fallo antes de guardar la venta: ' . get_class($causa) . ': ' . $causa->getMessage());
            self::audit('POS_VENTA_FALLIDA', null, $auditBase, 'No se pudo emitir la venta del POS: ' . $causa->getMessage(), false);
            throw new PosError('No se pudo registrar la venta. Inténtalo de nuevo en un momento; si sigue fallando, avisa a soporte.',
                502, 'EMISION_FALLIDA');
        }
        if ($repetida) {
            return self::respuestaDeVentaExistente($pos, $fila, $ancho, $body);
        }
        if ($fallo !== null && !($fallo instanceof EcfEnvioInciertoException)) {
            error_log('[pos] falla despues de guardar la venta ' . (int) $fila['id'] . ', se entrega igual: '
                . get_class($fallo) . ': ' . $fallo->getMessage());
        }

        $facturaId = (int) $fila['id'];
        $estado = (string) $fila['estado_dgii'];
        $pendiente = (int) $fila['envio_pendiente'] === 1;
        $eNcf = $fila['e_ncf'];
        self::entregarVenta($pos, $facturaId, $facturaInput['items'], $tipoEcf, $userId, $cobro, [
            'accion' => 'POS_VENTA',
            'entidad' => $eNcf,
            'valores' => $auditBase + [
                'factura_id' => $facturaId, 'estado_dgii' => $estado, 'envio_pendiente' => $pendiente,
                'recibido' => $cobro['recibido_centavos'] !== null ? $cobro['recibido_centavos'] / 100 : null,
            ],
            'descripcion' => $pendiente ? 'Venta del POS entregada; el envío sigue pendiente y se completa solo.' : 'Venta del POS entregada.',
        ]);
        if (in_array($estado, self::RECHAZADOS, true)) {
            $resp = json_decode((string) ($fila['rfce_respuesta'] ?? $fila['respuesta_dgii'] ?? ''), true);
            self::audit('POS_VENTA_RECHAZADA', $eNcf, $auditBase + ['factura_id' => $facturaId, 'motivo' => self::motivoRechazo($resp)],
                'La DGII rechazó la venta del POS al cobrar; la venta ya estaba entregada.', false);
        }

        return [
            'venta' => [
                'factura_id' => $facturaId,
                'e_ncf' => $eNcf,
                'tipo_ecf' => $tipoEcf,
                'estado_dgii' => $estado,
                'envio_pendiente' => $pendiente,
                'total_centavos' => $totalCentavos,
                'cliente' => $cliente !== null ? PosCliente::forma($cliente) : null,
            ],
            'cobro' => self::cobro($formaPago, $totalCentavos, $cobro['recibido_centavos'], $cobro['devuelta_centavos']),
            'recibo' => self::recibo($facturaId, $ancho),
            'repetida' => false,
        ];
    }

    /** El servicio de emision: el de verdad, o el que inyecta una prueba (PosVenta::$fabricaServicio). */
    private static function servicioEmision(): ECFEmissionService
    {
        return self::$fabricaServicio !== null ? (self::$fabricaServicio)() : new ECFEmissionService();
    }

    /**
     * Forma de pago y efectivo recibido (P1-P3), validados contra el total: lo
     * que se va a registrar en la caja. Lo usa la venta nueva y el reintento que
     * tiene que completar un cobro que quedo sin registrar.
     *
     * @return array{turno_id: int, forma_pago: int, total_centavos: int, recibido_centavos: ?int, devuelta_centavos: ?int, iniciada_at: ?string}
     * @throws PosError FORMA_PAGO_INVALIDA | RECIBIDO_INSUFICIENTE
     */
    private static function leerCobro(array $body, int $totalCentavos, int $turnoId): array
    {
        $formaPago = (int) ($body['forma_pago'] ?? 0);
        if (!isset(self::FORMAS_PAGO[$formaPago])) {
            throw new PosError('Elige la forma de pago.', 422, 'FORMA_PAGO_INVALIDA');
        }
        $recibidoCentavos = null;
        $devueltaCentavos = null;
        if ($formaPago === 1) {
            $recibidoCentavos = $body['recibido_centavos'] ?? null;
            if (!is_int($recibidoCentavos) || $recibidoCentavos < $totalCentavos || $recibidoCentavos > 100000000) {
                throw new PosError('El efectivo recibido no alcanza para el total.', 422, 'RECIBIDO_INSUFICIENTE');
            }
            $devueltaCentavos = $recibidoCentavos - $totalCentavos;
        }
        return [
            'turno_id' => $turnoId,
            'forma_pago' => $formaPago,
            'total_centavos' => $totalCentavos,
            'recibido_centavos' => $recibidoCentavos,
            'devuelta_centavos' => $devueltaCentavos,
            'iniciada_at' => self::iniciadaAt($body['iniciada_ms'] ?? null),
        ];
    }

    /**
     * El cobro de una venta cuyo movimiento de caja ya existe, con la misma
     * forma que leerCobro. No se vuelve a escribir: solo arma la respuesta.
     *
     * @param array $mov fila de posModel::movimientoDeFactura
     */
    private static function cobroDeMovimiento(array $mov, int $turnoId, int $totalCentavos): array
    {
        return [
            'turno_id' => $turnoId,
            'forma_pago' => (int) ($mov['forma_pago'] ?? 1),
            'total_centavos' => $totalCentavos,
            'recibido_centavos' => isset($mov['monto_recibido']) ? (int) round(((float) $mov['monto_recibido']) * 100) : null,
            'devuelta_centavos' => isset($mov['devuelta']) ? (int) round(((float) $mov['devuelta']) * 100) : null,
            'iniciada_at' => null,
        ];
    }

    /**
     * Entrega una venta ya guardada: movimiento de caja, salida de inventario y
     * bitacora. Es idempotente. La llaman la venta nueva y el reintento de una
     * venta que ya existe, siempre con el candado de la clave tomado, y cada parte
     * se hace solo si falta: una caida a medias se completa en el reintento sin
     * duplicar nada.
     *  1. Caja, solo si la factura no tiene movimiento. Va primero: es el dinero.
     *     Si falla, el error sube y el reintento con la misma clave lo completa.
     *  2. Inventario, solo si yaMovioDocumento('factura', id) es false. Un fallo
     *     aqui no tumba una venta que ya existe: queda en el log para un ajuste.
     *  3. Bitacora, solo si esta llamada registro la caja (la primera entrega).
     *
     * @param array $items  lineas de la factura (product_id, quantity)
     * @param array $cobro  forma de leerCobro (turno_id, forma_pago, total_centavos, recibido_centavos, devuelta_centavos, iniciada_at)
     * @param array $auditCtx {accion: string, entidad: ?string, valores: array, descripcion: string}
     */
    private static function entregarVenta(posModel $pos, int $facturaId, array $items, ?string $tipoEcf, int $userId, array $cobro, array $auditCtx): void
    {
        $registroCaja = false;
        if ($pos->movimientoDeFactura($facturaId) === null) {
            $pos->registrarMovimiento(
                (int) $cobro['turno_id'], $facturaId, 'VENTA', (int) $cobro['forma_pago'], $cobro['total_centavos'] / 100,
                $cobro['recibido_centavos'] !== null ? $cobro['recibido_centavos'] / 100 : null,
                $cobro['devuelta_centavos'] !== null ? $cobro['devuelta_centavos'] / 100 : null,
                $cobro['iniciada_at']
            );
            $registroCaja = true;
        }

        try {
            require_once __DIR__ . '/../Models/inventoryModel.php';
            $inventario = new inventoryModel();
            if (!$inventario->yaMovioDocumento('factura', $facturaId)) {
                $inventario->registrarVenta($facturaId, $items, $tipoEcf, $userId > 0 ? $userId : null);
            }
        } catch (Throwable $e) {
            error_log('[pos] inventario de la factura ' . $facturaId . ': ' . $e->getMessage());
        }

        if ($registroCaja) {
            self::audit($auditCtx['accion'], $auditCtx['entidad'], $auditCtx['valores'], $auditCtx['descripcion']);
        }
    }


NUEVO);

// 6) La venta que ya existe: siempre 201 repetida, sea cual sea el estado de su envio, y completa la entrega.
$tramo(<<<'VIEJO'
    /** La venta ya existe con esa clave: se devuelve tal cual (nunca otro e-NCF). */
VIEJO, <<<'VIEJO'
    private static function cobro(int $forma, int $total, ?int $recibido, ?int $devuelta): array
VIEJO, <<<'NUEVO'
    /**
     * La venta ya existe con esa clave: se devuelve la misma (nunca otro e-NCF),
     * este como este su envio (aceptada, rechazada, sin confirmar). Siempre
     * responde como venta repetida y completa lo que le falte a la entrega.
     *
     * Sin movimiento de caja, el servidor cayo (o fallo la base) entre guardar la
     * venta y registrar el cobro. El reintento trae el mismo cuerpo, y de ahi salen
     * la forma de pago y el efectivo recibido; si ese cuerpo no los trae validos
     * responde 422 como una venta nueva. El movimiento queda en el turno de la
     * venta, aunque ese turno ya se haya cerrado.
     */
    private static function respuestaDeVentaExistente(posModel $pos, array $venta, int $ancho, array $body): array
    {
        $facturaId = (int) $venta['id'];
        $turnoId = (int) ($venta['turno_id'] ?? 0);
        $totalCentavos = (int) round(((float) $venta['total']) * 100);
        $mov = $pos->movimientoDeFactura($facturaId);
        $cobro = $mov !== null
            ? self::cobroDeMovimiento($mov, $turnoId, $totalCentavos)
            : self::leerCobro($body, $totalCentavos, $turnoId);
        $tipoEcf = $venta['tipo_ecf'] !== null ? (string) $venta['tipo_ecf'] : null;
        self::entregarVenta($pos, $facturaId, (new facturaModel())->getFacturaItems($facturaId), $tipoEcf, (int) ($venta['user_id'] ?? 0), $cobro, [
            'accion' => 'POS_VENTA',
            'entidad' => $venta['e_ncf'] ?? null,
            'valores' => [
                'factura_id' => $facturaId, 'turno_id' => $turnoId, 'estado_dgii' => (string) $venta['estado_dgii'],
                'envio_pendiente' => (int) $venta['envio_pendiente'] === 1, 'completada_en_reintento' => true,
            ],
            'descripcion' => 'Venta del POS completada en un reintento: faltaba registrar el cobro.',
        ]);
        return [
            'venta' => [
                'factura_id' => $facturaId,
                'e_ncf' => $venta['e_ncf'],
                'tipo_ecf' => $tipoEcf,
                'estado_dgii' => (string) $venta['estado_dgii'],
                'envio_pendiente' => (int) $venta['envio_pendiente'] === 1,
                'total_centavos' => $totalCentavos,
                'cliente' => !empty($venta['client_id']) && ($c = $pos->clientePorId((int) $venta['client_id'])) !== null
                    ? PosCliente::forma($c) : null,
            ],
            'cobro' => self::cobro($cobro['forma_pago'], $totalCentavos, $cobro['recibido_centavos'], $cobro['devuelta_centavos']),
            'recibo' => self::recibo($facturaId, $ancho),
            'repetida' => true,
        ];
    }


NUEVO);

file_put_contents($ruta, $crlf ? str_replace("\n", "\r\n", $src) : $src);
echo "PosVenta.php parchado\n";
PHP
php -l src/Pos/PosVenta.php
git ls-files --eol src/Pos/PosVenta.php
grep -c "saveFacturaConECF\|tolerar_fallo_envio\|DGII_RECHAZO\|GUARDADO_FALLIDO\|ACEPTADOS" src/Pos/PosVenta.php
```

Expected:
- `PosVenta.php parchado`. If it prints `ancla ausente o repetida: ...` or `limites ausentes...`, `src/Pos/PosVenta.php` is not the `master` file the plan assumes. Nothing was written. Stop and report; do not improvise.
- `No syntax errors detected`.
- The `--eol` line is the same as before the script (the `w/` column does not change).
- The last `grep -c` prints `0`.

- [ ] **Step 6: Remove the last `saveFacturaConECF` mentions**

The Release 1 guard `wa_grep(['src', 'docs', 'CLAUDE.md'], 'saveFacturaConECF') === []` also reads `docs/`.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git grep -n "saveFacturaConECF" -- src docs CLAUDE.md
```

Expected hits: `docs/specs/pos.md` (the "Cobro (2026-10-08)" paragraph) and, unless Task 1 already reworded it, the docblock of `archivarRechazoReenviado` in `src/Models/facturaModel.php`.

The script changes one line of text in each file, with no line break in the replaced text, so each file keeps its own line ending. The `facturaModel.php` change is skipped when Task 1 already reworded it:

```bash
php <<'PHP'
<?php
$cambios = [
    // [archivo, texto viejo, texto nuevo, opcional]
    ['docs/specs/pos.md',
     'factura + movimiento de caja en una transacción (`saveFacturaConECF` con gancho;',
     'factura guardada antes de enviarla y movimiento de caja al entregar la venta (gancho write-ahead;', false],
    ['src/Models/facturaModel.php',
     'reuso su e-NCF, saveFacturaConECF ya lo archivo y esto no hace nada.',
     'reuso su e-NCF, la reserva ya lo archivo y esto no hace nada.', true],
];
foreach ($cambios as [$ruta, $viejo, $nuevo, $opcional]) {
    $src = (string) file_get_contents($ruta);
    $n = substr_count($src, $viejo);
    if ($n === 0 && $opcional) {
        echo $ruta, ": ya no nombra saveFacturaConECF\n";
        continue;
    }
    if ($n !== 1) {
        fwrite(STDERR, $ruta . ': ancla ausente o repetida (' . $n . ")\n");
        exit(1);
    }
    file_put_contents($ruta, str_replace($viejo, $nuevo, $src));
    echo $ruta, ": cambiado\n";
}
PHP
php -l src/Models/facturaModel.php
git grep -n "saveFacturaConECF" -- src docs CLAUDE.md
```

Expected: one line per file (`cambiado` or `ya no nombra saveFacturaConECF`), `No syntax errors detected`, and the last `git grep` prints nothing. Any other hit is a leftover of Task 1's merge resolution: stop and report it instead of guessing.

- [ ] **Step 7: Run everything**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -l src/Pos/PosVenta.php && php -l src/Models/posModel.php && php -l src/Models/facturaModel.php && php -l tools/test_pos_write_ahead.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_pos_write_ahead.php --tenant-db=wa_scratch; echo "exit=$?"
php tools/test_write_ahead_puro.php | tail -3; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- Four `No syntax errors detected`.
- Every line of the new test is `[OK  ]`, it ends with `75 de 75 pruebas OK` and `exit=0`. It takes one to two minutes: RF1 waits at least 2 s for the child.
- `test_write_ahead_puro.php` prints no `[FALLO]` line, its last line is `N de N pruebas OK` and `exit=0`. The `saveFacturaConECF` guard that Task 1 left red is now green.

If a check fails, read what it points at:
- S4 and S5b ("the number does not come back") depend on Task 4's `reclamar_secuencia`.
- S5, S5b and S6 depend on the `incierto` and auth-after-reserve paths of Tasks 3 and 4, and on `EstadosEcf::envioPendiente`.
- S8 depends on Task 3's `EcfVentaRepetidaException` (the 1062 on `uk_facturas_pos_idem` must not become `EcfNumeroOcupadoException`).

A failure there is a defect of that task, not a reason to loosen this test.

DB suites run strictly serially: this test wipes `facturas`, `pos_turnos`, `pos_caja_movimientos` and `audit_logs` in `wa_scratch`. Do not run another suite on `wa_scratch` at the same time. The master POS suites (`tools/test_pos_*.php`) are not run here: their expectations change in Task 14 and they need the Task 13 environment.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Pos/PosVenta.php src/Models/posModel.php src/Models/facturaModel.php docs/specs/pos.md tools/test_pos_write_ahead.php
git commit -F - <<'EOF'
feat(pos): la venta del POS se guarda antes de enviarse (write-ahead)

PosVenta::cobrar emite con el gancho reservar/confirmar/incierto: la
factura, con la clave, el turno y el empleado del POS, queda guardada antes
de mandar nada a la DGII. Cualquier resultado despues de guardar
(aceptada, rechazada, en proceso, sin respuesta, token caido) se entrega
con 201 y recibo. El numero nunca vuelve al contador
(reclamar_secuencia=false) y el token se pide despues de guardar
(autenticar_despues_de_reservar).

entregarVenta es idempotente: caja si falta, inventario una sola vez con
yaMovioDocumento y bitacora la primera vez. La repite el reintento con la
misma clave, asi que si el servidor cae entre guardar y registrar la caja,
el reintento la completa una sola vez. Repetir una venta rechazada o sin
confirmar responde 201 repetida (ya no 422). Un 1062 sobre la clave del
POS se trata como venta repetida. Un fallo antes de guardar sigue siendo
EMISION_FALLIDA (la factura simple llega en la Task 6).

Ya no se llama a la funcion que guardaba despues de enviar. ventaPorClave
devuelve tambien user_id. tools/test_pos_write_ahead.php: 75/75 en
wa_scratch, con RF1 (dos procesos, misma clave) y RF2 (caida entre
confirmar y la caja).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


### Task 6: POS: la venta sin e-CF sale como factura simple

Run every command from the API worktree root `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead` (branch `feat/ecf-write-ahead`, Tasks 1-5 applied). Every edit is anchored by quoted text, because the line numbers move with the merge and with Task 5. Re-read each file right before editing it. The DB test runs on `wa_scratch` only, strictly alone (no other DB suite at the same time).

Spec 4.2.5 (U8, U9): when the e-CF cannot be generated, the POS sale does not stop. It is saved as a **factura simple** (`tipo_ecf` NULL, no e-NCF, no ITBIS, never sent to the DGII) with the same lines, the same total and the POS columns, so the idempotency key keeps working. Delivery (cash, stock, audit) is Task 5's `entregarVenta`. The cashier sees a normal sale and a normal receipt.

"Cannot be generated" means `emitir` threw **before** the reserve: certificate file missing or with another password, signing failure, incomplete `emisor_config`, no range (Task 7, S10), or an e-NCF collision that repeats after one retry. A sale that already has a row (`EcfEnvioInciertoException`, `EcfVentaRepetidaException`) is never duplicated as a simple invoice. Cart validations (`PosError` 4xx raised before `emitir`) are untouched. The only thing that still stops a sale is the database being unavailable.

Out of scope here: the sales lists and the closing report. Task 14 (Step 6) makes them show the factura simple with its number and count it as `Simple`, and its "exactly two checks fail" step depends on this task not touching them. Until then a simple sale appears in those lists with `e_ncf` null.

Review focus RF4 (Tasks 6 and 10): S1 is the Task 6 half. The certificate fails in the middle of a shift and then recovers; the sales of the bad stretch are simple invoices with their cash, stock and idempotency, and the sales before and after are e-CF again. The alert that counts today's fallback sales is Task 10; it reads `tipo_ecf IS NULL AND pos_idempotency_key IS NOT NULL`, which `crearFacturaSimplePos` guarantees.

**Files:**
- Create: `tools/test_pos_continuidad.php`. It calls `PosVenta::cobrar` in this process (no HTTP) with the real emission: the self-signed test certificate (`wa_cert_prueba`) and the fake DGII (`tools/mock_dgii.php`). Task 6 writes S0-S6 (33 checks); Task 7 adds S7-S10 (17 checks) directly above the closing comment `// Deja la base como la espera la siguiente suite`.
- Modify: `src/Models/facturaModel.php` (LF since Task 1): insert `crearFacturaSimplePos` directly above the line `    /** Nombre del candado, por base de datos: un tenant no serializa a otro. */` (it sits right after `createFacturaSimple`).
- Modify: `src/Pos/PosVenta.php`, six anchored edits:
  - the require line `require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfUsuarioException.php';`;
  - the call text `(new ECFEmissionService())->emitir(` in `emitirEnTurno`;
  - the tail of the generic `catch (Throwable $e)` of that call: `self::audit('POS_VENTA_FALLIDA', ...)` plus `throw new PosError(... 502, 'EMISION_FALLIDA');`;
  - the line `'e_ncf' => $venta['e_ncf'],` in `respuestaDeVentaExistente`;
  - two lines of `recibo()`: `$nombre = 'Factura_' . ($factura['e_ncf'] ?? $facturaId) . RepresentacionImpresa::sufijo($ancho);` and `return RepresentacionImpresa::datosRecibo($factura, $cliente, false, $ancho, $nombre);`;
  - three new private static methods inserted directly above `    public static function ancho($valor): int`.
- Modify: `src/Models/posModel.php`: only the SELECT of `ventaPorClave` (add `no_factura`).
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch` (33 checks).

**Interfaces:**
- Consumes:
  - Task 3: `EcfVentaRepetidaException(string $clave, ?Throwable $previous = null)` with `public string $clave` (`src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php`, required at the top of `facturaModel.php`); the unique key `uk_facturas_pos_idem` on `facturas.pos_idempotency_key` (already in `db/tenant_schema.sql` and migration 030; `wa_scratch` has it).
  - Task 4: a failure before the reserve still returns the dispensed number to the counter (`rollbackECFSequence`); `reclamar_secuencia = false` only affects what happens after the verdict.
  - Task 5:
    - `private static function entregarVenta(posModel $pos, int $facturaId, array $items, ?string $tipoEcf, int $userId, array $cobro, array $auditCtx): void`, idempotent under the clave lock (cash movement only if none, stock once, audit `POS_VENTA`). The `?string $tipoEcf` is `null` for a simple invoice.
    - **Contract of `$cobro` and `$auditCtx` as Task 6 builds them** (Step 1 checks it against Task 5's code, and S1 fails on any key Task 5 reads that Task 6 does not provide):
      - `$cobro` = `PosVenta::cobro($forma, $totalCentavos, $recibidoCentavos, $devueltaCentavos)` (`forma_pago`, `forma_pago_nombre`, `total_centavos`, `recibido_centavos`, `devuelta_centavos`) plus `turno_id` (int) and `iniciada_at` (?string);
      - `$auditCtx` = master's `$auditBase` (`pos_empleado_id`, `empleado`, `caja_id`, `turno_id`, `total`, `forma_pago`) plus `e_ncf`, `estado_dgii`, `envio_pendiente`, `factura_simple` and `recibido` (pesos).
    - In `emitirEnTurno`, the call `(new ECFEmissionService())->emitir($payload, <hook>)` sits in a `try` whose typed catches (`EcfEnvioInciertoException`, `EcfVentaRepetidaException`) come first; the generic `catch (Throwable $e)` keeps master's tail (audit `POS_VENTA_FALLIDA` + `PosError(..., 502, 'EMISION_FALLIDA')`). `respuestaDeVentaExistente` answers a row with `tipo_ecf` NULL like any other (201, `repetida: true`).
  - Existing: `facturaModel::normalizeSimpleItems`, `insertSimpleItems`, `sumSimpleTotal`, `tomarLockSecuenciaSimple`, `soltarLockSecuenciaSimple`, `nextSimpleFacturaNumber`, `getFacturaSimple`, `getFacturaItems`; `PosVenta::cobro`, `recibo`, `audit`, `iniciadaAt`; `RepresentacionImpresa::datosRecibo(array $factura, array $cliente, bool $noElectronica, int $anchoPos, string $nombre): array`; `PosCliente::forma`; the lib helpers `wa_usar_base`, `wa_sembrar`, `wa_limpiar`, `wa_exigir_marca`, `wa_cert_prueba`, `wa_servidor`, `wa_mock_modo`, `wa_mock_log`, `wa_contador`, `wa_movimientos`, `wa_chk`, `wa_fin`.
- Produces:

```php
// src/Models/facturaModel.php
/**
 * @param array $input {date, client_id, client_name, total, user_id, items[], pos: {turno_id, pos_empleado_id, pos_idempotency_key}}
 * @return int id de la factura simple (tipo_ecf NULL, envio_pendiente 0, estado_dgii con su default 'PENDIENTE')
 * @throws EcfVentaRepetidaException la clave ya tiene factura (1062 en uk_facturas_pos_idem)
 * @throws InvalidArgumentException sin lineas o sin los datos del POS
 * @throws RuntimeException la base no pudo guardarla
 */
public function crearFacturaSimplePos(array $input): int

// src/Pos/PosVenta.php (private static)
private static function emitirConReintento(ECFEmissionService $servicio, array $payload, ?callable $persistencia = null): array
private static function ventaComoFacturaSimple(
    posModel $pos, array $empleado, array $turno, string $clave, int $ancho, int $userId, ?array $cliente,
    string $tipoEcfPedido, array $items, array $pago, array $auditBase, Throwable $causa
): array   // 201 {venta, cobro, recibo, repetida:false}; $pago = {forma_pago, total_centavos, recibido_centavos, devuelta_centavos, iniciada_at}
private static function numeroDeVenta(array $fila): string   // e_ncf, o no_factura en una factura simple
```

  - **Response of a simple sale:** `venta` = `{factura_id, e_ncf: <numero interno>, tipo_ecf: '', estado_dgii: 'PENDIENTE', envio_pendiente: false, total_centavos, cliente}`. `'PENDIENTE'` is the column default every factura simple has (not a DGII state: the POS front end must not show it, Task 11). The repeat answers the same values (`respuestaDeVentaExistente` uses `numeroDeVenta`).
  - **Receipt:** a row with `tipo_ecf` NULL prints as a factura simple: title `FACTURA`, `Factura No.` with its internal number, no `timbre`. This also covers the reprint endpoint, which goes through `PosVenta::recibo`.
  - **Audit:** `POS_VENTA_FACTURA_SIMPLE` (module `pos`, `success` false, entity = the invoice number, `new_values` = `$auditBase` + `factura_id`, `tipo_ecf_pedido`, `causa` = the failure class, never its message). A failure to save the simple invoice itself is `POS_VENTA_FALLIDA` plus `PosError(500, 'VENTA_NO_GUARDADA')`.
  - **Errors the POS front end already treats as "retry with the same key"** (they are not in the `SIN_VENTA` set of `CobroModal.tsx`): `PosError(409, 'VENTA_EN_PROCESO')` (a row with this key appeared meanwhile) and `PosError(500, 'VENTA_NO_GUARDADA')`.
  - **Test helpers defined by `tools/test_pos_continuidad.php`:** `pc_uuid`, `pc_cert(string $estado)` (`'buena'`, `'mala'` or `'ausente'`), `pc_vaciar(PDO $pdo): array`, `pc_reiniciar(PDO $pdo, string $mock, string $modo = 'acepta'): array`, `pc_cuerpo(array $esc, int $cantidad = 2, string $tipo = '32'): array`, `pc_datos_simple`, `pc_cobrar(array $esc, array $cuerpo): array`, `pc_ok(array $r): bool`, `pc_fila`, `pc_n`, `pc_caja`, `pc_stock`, `pc_recepciones(string $mock): int`, `pc_audit`, `pc_log_pos`, `pc_log_desde`, `pc_sin_definir`.

- [ ] **Step 1: Check what Tasks 3-5 left**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "function entregarVenta" src/Pos/PosVenta.php
grep -n "(new ECFEmissionService())->emitir(" src/Pos/PosVenta.php
grep -n "'EMISION_FALLIDA'" src/Pos/PosVenta.php
grep -n "self::audit('POS_VENTA_FALLIDA'" src/Pos/PosVenta.php
grep -n "'e_ncf' => \$venta\['e_ncf'\]," src/Pos/PosVenta.php
grep -n "EcfVentaRepetidaException.php" src/Models/facturaModel.php src/Pos/PosVenta.php
ls src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php
grep -c "function crearFacturaSimplePos" src/Models/facturaModel.php
sed -n '/private static function entregarVenta/,/^    }$/p' src/Pos/PosVenta.php | grep -o "\$\(cobro\|auditCtx\)\['[a-z_]*'\]" | sort -u
```

Expected:
- `git status --short` prints only `?? tools/reconstruir_e340000000001.sql` (never stage it).
- The `entregarVenta` grep prints its declaration. The next four greps print one line each: the call, the `'EMISION_FALLIDA'` throw, the `POS_VENTA_FALLIDA` audit and the `'e_ncf'` line of `respuestaDeVentaExistente`. If one prints more than one line, the one that matters is inside the generic `catch (Throwable $e)` that follows the typed catches. If Task 5 changed the wording of a line, find its equivalent and edit that.
- The `EcfVentaRepetidaException.php` grep prints the require line in `facturaModel.php` (Task 3 added it); `PosVenta.php` may or may not have it yet. The `ls` finds the file. The count of `crearFacturaSimplePos` prints `0`.
- The last command lists the keys Task 5 reads. They must be among the ones Task 6 provides: `$cobro['forma_pago']`, `['total_centavos']`, `['recibido_centavos']`, `['devuelta_centavos']`, `['turno_id']`, `['iniciada_at']` and, for `$auditCtx`, `['e_ncf']`, `['estado_dgii']`, `['envio_pendiente']`, `['recibido']` plus the `$auditBase` keys. If Task 5 reads a key Task 6 does not provide, add it to the two arrays built in `ventaComoFacturaSimple` (Step 5, block f) and nowhere else.
- If `facturaModel.php` has no `EcfVentaRepetidaException.php` require, add `require_once(__DIR__ . '/../Utils/FacturacionElectronica/EcfVentaRepetidaException.php');` right under its `EcfNumeroOcupadoException.php` require.

- [ ] **Step 2: Write the failing test**

Create `tools/test_pos_continuidad.php`:

```php
<?php
/**
 * test_pos_continuidad.php — el POS nunca se detiene (spec 2026-10-12, 4.2.5 y
 * 4.2.6): si el e-CF no se puede generar, la venta sale como factura simple;
 * si la secuencia se agota o vence, toma el numero siguiente y no se envia.
 *
 * Llama a PosVenta::cobrar EN ESTE PROCESO, sin HTTP (lo que se prueba es la
 * venta, no la autenticacion del equipo), con la emision de verdad: el
 * certificado de prueba autofirmado de wa_cert_prueba() y la DGII falsa
 * tools/mock_dgii.php. El "certificado que falla" es su clave cambiada o su
 * archivo ausente en el entorno (CertResolver lo lee en cada firma).
 *
 * Nunca toca produccion: wa_pdo() se niega a usar una base sin la tabla marca
 * zz_write_ahead_scratch. Cada escenario vacia la base de prueba (facturas, caja
 * y turnos del POS) y la vuelve a sembrar, y al final la deja asi. Las suites de
 * base van de a una.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch
 *   (si el puerto 8099 esta ocupado: WA_PUERTO_OFFSET=100; sale con 1 si algo falla)
 */

require_once __DIR__ . '/write_ahead_test_lib.php';

const PC_RUTA_RECEPCION = '/Recepcion/api/FacturasElectronicas';
const PC_RUTA_RECEPCION_FC = '/RecepcionFC/api/recepcion/ecf';
const PC_PASSWORD_MALA = 'esta-no-es-la-clave-del-certificado';

$base = (string) wa_arg('tenant-db', '');
if ($base === '') {
    fwrite(STDERR, "Uso: php <flags> tools/test_pos_continuidad.php --tenant-db=<base de prueba>\n");
    exit(1);
}
$pdo = wa_pdo($base);
$real = wa_base_real($base);
foreach (['pos_cajas', 'pos_empleados', 'pos_sesiones', 'pos_turnos', 'pos_caja_movimientos'] as $tabla) {
    if (!wa_tabla_existe($pdo, $real, $tabla)) {
        echo '[FALLO] a ' . wa_base_corta($real) . " le falta la tabla {$tabla} (migracion 030_pos.sql): aplicala a la base de prueba\n";
        exit(1);
    }
}

// Los modelos de este proceso apuntan a la base de prueba; la DGII es el mock y
// el certificado el de prueba. DGII_FC_BASE_URL se lee con getenv a secas
// (DgiiReceptionService), por eso todo va con putenv Y en $_ENV.
wa_usar_base($base);
$cert = wa_cert_prueba();
$mock = wa_servidor('mock_dgii', 'tools/mock_dgii.php', 8099, ['MOCK_DGII_CUELGA_SEG' => '5']);
foreach ([
    'DGII_ECF_BASE_URL' => $mock, 'DGII_FC_BASE_URL' => $mock, 'DGII_ECF_TIMEOUT' => '3', 'POS_DGII_TIMEOUT' => '5',
] as $clave => $valor) {
    putenv("{$clave}={$valor}");
    $_ENV[$clave] = $valor;
}

// error_log a un archivo propio: los avisos de PHP (clave sin definir, etc.) se
// leen desde ahi. Despues de wa_usar_base, que cambia error_log un momento.
$GLOBALS['pc_log'] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_' . getmypid() . '.log';
@unlink($GLOBALS['pc_log']);
error_reporting(E_ALL);
ini_set('log_errors', '1');
ini_set('display_errors', '0');
ini_set('error_log', $GLOBALS['pc_log']);

require_once __DIR__ . '/../src/Pos/PosVenta.php';
require_once __DIR__ . '/../src/Models/facturaModel.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
require_once __DIR__ . '/../src/Utils/FacturacionElectronica/EcfVentaRepetidaException.php';

/** emitir() de mentira: responde lo que se le anota, en orden (excepciones se lanzan). */
final class EmisionFalsa extends ECFEmissionService
{
    public int $llamadas = 0;

    /** @param list<Throwable|array> $respuestas */
    public function __construct(private array $respuestas)
    {
    }

    public function emitir(array $payload, ?callable $persistencia = null): array
    {
        $this->llamadas++;
        $r = array_shift($this->respuestas);
        if ($r instanceof Throwable) {
            throw $r;
        }
        return $r ?? [];
    }
}

function pc_uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/**
 * Estado del certificado en el entorno (CertResolver lo lee en cada firma):
 * 'buena' (el de prueba), 'mala' (una clave que no abre el .p12) o 'ausente'
 * (una ruta que no existe).
 */
function pc_cert(string $estado): void
{
    $cert = wa_cert_prueba();
    $ruta = $estado === 'ausente' ? sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_cert_que_no_existe.p12' : $cert['path'];
    $clave = $estado === 'mala' ? PC_PASSWORD_MALA : $cert['password'];
    foreach (['DGII_ECF_CERT_PATH' => $ruta, 'DGII_ECF_CERT_PASSWORD' => $clave] as $k => $v) {
        putenv("{$k}={$v}");
        $_ENV[$k] = $v;
    }
}

/** Tamano actual del log de PHP, para leer despues solo lo nuevo. */
function pc_log_pos(): int
{
    clearstatcache();
    return is_file($GLOBALS['pc_log']) ? (int) filesize($GLOBALS['pc_log']) : 0;
}

/** Lo escrito en el log de PHP desde la posicion $desde. */
function pc_log_desde(int $desde): string
{
    return substr((string) @file_get_contents($GLOBALS['pc_log']), $desde);
}

/**
 * Las lineas "Undefined array key / variable / property" que cayeron en el log
 * desde $desde: una clave que el codigo lee y quien lo llama no armo. Solo esas:
 * los "Deprecated" de las librerias de QR y PDF salen en cada recibo e-CF.
 */
function pc_sin_definir(int $desde): array
{
    preg_match_all('/^.*(?:Undefined (?:array key|variable|property)|Attempt to read property).*$/m', pc_log_desde($desde), $m);
    return $m[0];
}

/**
 * Deja la base como la espera cualquier suite: sin ventas, caja ni turnos, con
 * los rangos y el emisor sembrados. Devuelve los ids de wa_sembrar.
 */
function pc_vaciar(PDO $pdo): array
{
    wa_exigir_marca($pdo);
    foreach (['pos_caja_movimientos', 'pos_turnos', 'pos_sesiones', 'pos_empleados', 'pos_cajas'] as $tabla) {
        $pdo->exec("DELETE FROM {$tabla}");
    }
    wa_limpiar($pdo);
    return wa_sembrar($pdo);
}

/**
 * Escenario nuevo: DGII en $modo, certificado bueno, base vacia y sembrada, y
 * una caja con su cajero y su turno abierto. Devuelve lo que usan las pruebas.
 */
function pc_reiniciar(PDO $pdo, string $mock, string $modo = 'acepta'): array
{
    wa_mock_modo($mock, $modo);
    pc_cert('buena');
    $ids = pc_vaciar($pdo);
    wa_mock_log($mock, true);
    $pdo->prepare(
        "INSERT INTO users (name, last_name, email, username, password, role)
         VALUES ('WA', 'Prueba', 'wa_prueba@example.com', 'wa_prueba', :p, 'admin')
         ON DUPLICATE KEY UPDATE role = 'admin'"
    )->execute([':p' => password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT)]);
    $userId = (int) $pdo->query("SELECT id FROM users WHERE username = 'wa_prueba'")->fetchColumn();
    $pos = new posModel();
    $caja = $pos->crearCaja('WA caja');
    $empleado = $pos->crearEmpleado('WA cajero', 'cajero', static fn(): array => ['1234', hash('sha256', random_bytes(8))])['empleado'];
    $turno = $pos->abrirTurno((int) $caja['id'], (int) $empleado['id'], 0.0);
    $precio = (string) $pdo->query('SELECT precio FROM products WHERE id = ' . (int) $ids['product_id'])->fetchColumn();
    return [
        'pdo' => $pdo, 'mock' => $mock, 'pos' => $pos, 'equipo' => ['habilitado_por' => $userId], 'empleado' => $empleado,
        'caja' => $caja, 'turno' => $turno, 'ids' => $ids, 'precio' => $precio, 'user_id' => $userId,
    ];
}

/**
 * Cuerpo de POST /api/pos/ventas: $cantidad unidades del producto sembrado
 * (RD$1,180.00 con ITBIS cada una), efectivo con RD$140.00 de devuelta. El tipo
 * '31' lleva el cliente sembrado.
 */
function pc_cuerpo(array $esc, int $cantidad = 2, string $tipo = '32'): array
{
    $total = PosPrecio::finalCentavos($esc['precio'], 1) * $cantidad;
    $cuerpo = [
        'clave' => pc_uuid(), 'tipo_ecf' => $tipo,
        'lineas' => [['product_id' => (int) $esc['ids']['product_id'], 'cantidad' => $cantidad]],
        'total_centavos' => $total, 'forma_pago' => 1, 'recibido_centavos' => $total + 14000, 'ancho' => 80,
    ];
    return $tipo === '31' ? $cuerpo + ['client_id' => (int) $esc['ids']['client_id']] : $cuerpo;
}

/** Entrada de facturaModel::crearFacturaSimplePos: 2 unidades del producto sembrado (RD$1,180.00 con ITBIS cada una). */
function pc_datos_simple(array $esc, string $clave): array
{
    return [
        'date' => date('Y-m-d H:i:s'), 'client_id' => null, 'client_name' => 'Consumidor Final', 'total' => 2360.00,
        'user_id' => $esc['user_id'],
        'items' => [[
            'product_id' => (int) $esc['ids']['product_id'], 'description' => 'WA producto', 'amount' => 1180.00, 'quantity' => 2,
            'indicador_bien_servicio' => 1, 'unidad_medida' => '43',
        ]],
        'pos' => ['turno_id' => (int) $esc['turno']['id'], 'pos_empleado_id' => (int) $esc['empleado']['id'], 'pos_idempotency_key' => $clave],
    ];
}

/**
 * PosVenta::cobrar sin cortar la prueba: un PosError vuelve como ['_error' =>
 * {codigo, http}] y cualquier otra cosa como ['_excepcion' => clase y lugar]
 * (nunca el mensaje: el de un PDOException trae host y usuario).
 */
function pc_cobrar(array $esc, array $cuerpo): array
{
    try {
        return PosVenta::cobrar($esc['pos'], $esc['equipo'], $esc['empleado'], $esc['caja'], $cuerpo);
    } catch (PosError $e) {
        return ['_error' => ['codigo' => $e->codigo(), 'http' => $e->http()]];
    } catch (Throwable $e) {
        return ['_excepcion' => get_class($e) . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')'];
    }
}

/** La venta se entrego: respuesta con venta y sin error. */
function pc_ok(array $r): bool
{
    return isset($r['venta']) && !isset($r['_error']) && !isset($r['_excepcion']);
}

function pc_fila(PDO $pdo, string $clave): array
{
    $st = $pdo->prepare('SELECT * FROM facturas WHERE pos_idempotency_key = :k');
    $st->execute([':k' => $clave]);
    return $st->fetch() ?: [];
}

function pc_n(PDO $pdo, string $sql, array $params = []): int
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return (int) $st->fetchColumn();
}

/** Movimientos de caja de una factura. */
function pc_caja(PDO $pdo, int $facturaId): array
{
    $st = $pdo->prepare('SELECT tipo, forma_pago, monto, monto_recibido, devuelta FROM pos_caja_movimientos WHERE factura_id = :f ORDER BY id');
    $st->execute([':f' => $facturaId]);
    return $st->fetchAll();
}

function pc_stock(PDO $pdo, int $productoId): float
{
    return (float) $pdo->query('SELECT stock FROM products WHERE id = ' . $productoId)->fetchColumn();
}

/** Peticiones de recepcion (e-CF o RFCE) que vio el mock. */
function pc_recepciones(string $mock): int
{
    $n = 0;
    foreach (wa_mock_log($mock) as $e) {
        $ruta = (string) ($e['ruta'] ?? '');
        if (str_ends_with($ruta, PC_RUTA_RECEPCION) || str_ends_with($ruta, PC_RUTA_RECEPCION_FC)) {
            $n++;
        }
    }
    return $n;
}

/** Filas de auditoria del POS con esa accion, con new_values decodificado. */
function pc_audit(PDO $pdo, string $accion): array
{
    $st = $pdo->prepare("SELECT entity_id, success, new_values FROM audit_logs WHERE module = 'pos' AND action = :a ORDER BY id");
    $st->execute([':a' => $accion]);
    return array_map(static fn(array $f): array => [
        'entity_id' => $f['entity_id'], 'success' => (int) $f['success'], 'new_values' => json_decode((string) $f['new_values'], true) ?? [],
    ], $st->fetchAll());
}

// ---------------------------------------------------------------------------
// S0) facturaModel::crearFacturaSimplePos: factura simple con las columnas del
// POS en el mismo INSERT; la clave repetida no crea otra.
// ---------------------------------------------------------------------------
echo "S0) facturaModel::crearFacturaSimplePos\n";
$esc = pc_reiniciar($pdo, $mock);
$facturas = new facturaModel();
$clave = pc_uuid();
$datos = pc_datos_simple($esc, $clave);
$id = $facturas->crearFacturaSimplePos($datos);
$f = pc_fila($pdo, $clave);
wa_chk('crea la factura con tipo_ecf y e_ncf NULL, sin envio pendiente y con turno, empleado, usuario y total',
    (int) ($f['id'] ?? 0) === $id && $f['tipo_ecf'] === null && $f['e_ncf'] === null && (int) $f['envio_pendiente'] === 0
    && (int) $f['turno_id'] === (int) $esc['turno']['id'] && (int) $f['pos_empleado_id'] === (int) $esc['empleado']['id']
    && (int) $f['user_id'] === $esc['user_id'] && (float) $f['total'] === 2360.0, $f);
wa_chk('el numero es el de las facturas simples: secuencia-ddmmaa',
    preg_match('/^\d{4,}-\d{6}$/', (string) ($f['no_factura'] ?? '')) === 1, $f['no_factura'] ?? null);
$st = $pdo->prepare('SELECT COUNT(*) AS n, SUM(subtotal) AS subtotal, SUM(itbis_amount) AS itbis FROM factura_items WHERE factura_id = :f');
$st->execute([':f' => $id]);
$it = $st->fetch();
wa_chk('una linea con el subtotal de la venta y sin ITBIS (la factura simple no lo desglosa)',
    (int) $it['n'] === 1 && (float) $it['subtotal'] === 2360.0 && (float) $it['itbis'] === 0.0, $it);
try {
    $facturas->crearFacturaSimplePos($datos);
    $rep = null;
} catch (Throwable $e) {
    $rep = $e;
}
wa_chk('la misma clave lanza EcfVentaRepetidaException con la clave y no crea otra fila',
    $rep instanceof EcfVentaRepetidaException && $rep->clave === $clave
    && pc_n($pdo, 'SELECT COUNT(*) FROM facturas WHERE pos_idempotency_key = :k', [':k' => $clave]) === 1,
    $rep === null ? null : get_class($rep));
$invalidos = [];
foreach (['sin lineas' => ['items' => []] + $datos, 'sin clave' => ['pos' => ['turno_id' => 1, 'pos_empleado_id' => 1]] + $datos] as $nombre => $malo) {
    try {
        $facturas->crearFacturaSimplePos($malo);
        $invalidos[$nombre] = 'no lanzo';
    } catch (InvalidArgumentException $e) {
        $invalidos[$nombre] = 'InvalidArgumentException';
    }
}
wa_chk('sin lineas o sin clave lanza InvalidArgumentException',
    $invalidos === ['sin lineas' => 'InvalidArgumentException', 'sin clave' => 'InvalidArgumentException'], $invalidos);

// ---------------------------------------------------------------------------
// S1) El certificado falla a mitad del turno y se recupera (RF4): las ventas
// del tramo malo son facturas simples con su caja, su inventario y su clave;
// las de antes y de despues son e-CF.
// ---------------------------------------------------------------------------
echo "S1) el certificado falla a mitad del turno y despues se recupera\n";
$esc = pc_reiniciar($pdo, $mock);
$prodId = (int) $esc['ids']['product_id'];
$stock0 = pc_stock($pdo, $prodId);
$cuerpoA = pc_cuerpo($esc);
$a = pc_cobrar($esc, $cuerpoA);
$fa = pc_fila($pdo, $cuerpoA['clave']);
wa_chk('A (certificado bueno): e-CF E32 aceptado, entregado',
    pc_ok($a) && ($a['repetida'] ?? null) === false && $fa['tipo_ecf'] === '32' && str_ends_with((string) $fa['estado_dgii'], 'ACEPTADO')
    && str_starts_with((string) $fa['e_ncf'], 'E32'), [$a, $fa['estado_dgii'] ?? null]);
$contadorA = wa_contador($pdo, 'E32');
$recepcionesA = pc_recepciones($mock);
wa_chk('A: el contador de E32 esta en 1 y la DGII recibio 1 comprobante', $contadorA === 1 && $recepcionesA === 1, [$contadorA, $recepcionesA]);

pc_cert('mala');
$logAntes = pc_log_pos();
$cuerpoB = pc_cuerpo($esc);
$b = pc_cobrar($esc, $cuerpoB);
$fb = pc_fila($pdo, $cuerpoB['clave']);
$idB = (int) ($fb['id'] ?? 0);
wa_chk('B (certificado que falla): la venta se entrega, 201 sin error y no es repetida',
    pc_ok($b) && ($b['repetida'] ?? null) === false, $b);
wa_chk('B: factura simple (tipo_ecf y e_ncf NULL, sin envio pendiente) con su numero interno y la clave del POS',
    $fb !== [] && $fb['tipo_ecf'] === null && $fb['e_ncf'] === null && (int) $fb['envio_pendiente'] === 0
    && preg_match('/^\d{4,}-\d{6}$/', (string) $fb['no_factura']) === 1, $fb);
wa_chk('B: turno, empleado, usuario que habilito la caja y total de la venta',
    (int) $fb['turno_id'] === (int) $esc['turno']['id'] && (int) $fb['pos_empleado_id'] === (int) $esc['empleado']['id']
    && (int) $fb['user_id'] === $esc['user_id'] && (float) $fb['total'] === 2360.0, $fb);
$st = $pdo->prepare('SELECT COUNT(*) AS n, SUM(subtotal) AS subtotal, SUM(itbis_amount) AS itbis FROM factura_items WHERE factura_id = :f');
$st->execute([':f' => $idB]);
$it = $st->fetch();
wa_chk('B: las mismas lineas y el mismo total (una linea de RD$2,360.00, sin ITBIS)',
    (int) $it['n'] === 1 && (float) $it['subtotal'] === 2360.0 && (float) $it['itbis'] === 0.0, $it);
$caja = pc_caja($pdo, $idB);
wa_chk('B: un movimiento de caja VENTA en efectivo de 2360.00, recibido 2500.00 y devuelta 140.00',
    count($caja) === 1 && $caja[0]['tipo'] === 'VENTA' && (int) $caja[0]['forma_pago'] === 1 && (float) $caja[0]['monto'] === 2360.0
    && (float) $caja[0]['monto_recibido'] === 2500.0 && (float) $caja[0]['devuelta'] === 140.0, $caja);
wa_chk('B: el inventario se movio una vez (un movimiento) y el stock bajo 4 en total (A y B)',
    wa_movimientos($pdo, $idB) === 1 && pc_stock($pdo, $prodId) === $stock0 - 4, [wa_movimientos($pdo, $idB), pc_stock($pdo, $prodId)]);
wa_chk('B: la respuesta lleva el numero interno, sin tipo de e-CF ni envio pendiente, y el total y la devuelta',
    ($b['venta']['factura_id'] ?? null) === $idB && ($b['venta']['e_ncf'] ?? null) === $fb['no_factura']
    && ($b['venta']['tipo_ecf'] ?? null) === '' && ($b['venta']['envio_pendiente'] ?? null) === false
    && ($b['venta']['total_centavos'] ?? null) === 236000 && ($b['cobro']['devuelta_centavos'] ?? null) === 14000, $b['venta'] ?? $b);
$recibo = $b['recibo'] ?? null;
wa_chk('B: el recibo sale como factura simple (titulo FACTURA, "Factura No." con su numero, sin timbre)',
    is_array($recibo) && ($recibo['titulo'] ?? null) === 'FACTURA' && array_key_exists('timbre', $recibo) && $recibo['timbre'] === null
    && ($recibo['identificacion'][0] ?? null) === ['Factura No.', $fb['no_factura']], $recibo);
wa_chk('B: el numero de E32 volvio al contador y la DGII no recibio nada mas',
    wa_contador($pdo, 'E32') === $contadorA && pc_recepciones($mock) === $recepcionesA, [wa_contador($pdo, 'E32'), pc_recepciones($mock)]);
$aud = pc_audit($pdo, 'POS_VENTA_FACTURA_SIMPLE');
// serialize y no json_encode: json_encode duplica las barras de una ruta de Windows y la busqueda nunca la hallaria.
$crudo = serialize($aud);
wa_chk('B: un evento POS_VENTA_FACTURA_SIMPLE con la clase del fallo, sin la clave ni la ruta del certificado',
    count($aud) === 1 && ($aud[0]['new_values']['causa'] ?? null) === 'EcfUsuarioException' && (int) $aud[0]['new_values']['factura_id'] === $idB
    && !str_contains($crudo, PC_PASSWORD_MALA) && !str_contains($crudo, $cert['password']) && !str_contains($crudo, $cert['path']), $aud);
$sinDefinir = pc_sin_definir($logAntes);
wa_chk('B: la entrega, el audit y el recibo no leyeron claves sin definir (log de PHP limpio)', $sinDefinir === [], $sinDefinir);

$b2 = pc_cobrar($esc, $cuerpoB);
wa_chk('B repetida (mismo cuerpo y clave): 201 repetida con la misma factura y el mismo numero',
    pc_ok($b2) && ($b2['repetida'] ?? null) === true && ($b2['venta']['factura_id'] ?? null) === $idB
    && ($b2['venta']['e_ncf'] ?? null) === $fb['no_factura'], $b2);
wa_chk('B repetida: una sola factura con la clave, un movimiento de caja y un movimiento de inventario',
    pc_n($pdo, 'SELECT COUNT(*) FROM facturas WHERE pos_idempotency_key = :k', [':k' => $cuerpoB['clave']]) === 1
    && count(pc_caja($pdo, $idB)) === 1 && wa_movimientos($pdo, $idB) === 1,
    [count(pc_caja($pdo, $idB)), wa_movimientos($pdo, $idB)]);

pc_cert('buena');
$cuerpoC = pc_cuerpo($esc);
$c = pc_cobrar($esc, $cuerpoC);
$fc = pc_fila($pdo, $cuerpoC['clave']);
wa_chk('C (certificado recuperado): vuelve a ser e-CF aceptado y toma el numero que B devolvio',
    pc_ok($c) && $fc['tipo_ecf'] === '32' && str_ends_with((string) $fc['estado_dgii'], 'ACEPTADO') && $fc['e_ncf'] === 'E320000000002'
    && (int) $fc['envio_pendiente'] === 0 && pc_recepciones($mock) === $recepcionesA + 1, [$fc['e_ncf'] ?? null, $fc['estado_dgii'] ?? null]);
// El efectivo de la venta simple cuenta en la caja del turno igual que el de un e-CF (el cierre suma pos_caja_movimientos).
wa_chk('el turno tiene las tres ventas en caja: A, B (simple) y C, 7080.00 en efectivo',
    pc_n($pdo, "SELECT COUNT(*) FROM pos_caja_movimientos WHERE turno_id = :t AND tipo = 'VENTA'", [':t' => (int) $esc['turno']['id']]) === 3
    && (float) $pdo->query("SELECT SUM(monto) FROM pos_caja_movimientos WHERE turno_id = " . (int) $esc['turno']['id'] . " AND tipo = 'VENTA' AND forma_pago = 1")->fetchColumn() === 7080.0);

// ---------------------------------------------------------------------------
// S2) Datos fiscales del emisor ausentes o archivo del certificado ausente:
// tampoco detienen la venta.
// ---------------------------------------------------------------------------
echo "S2) emisor_config ausente y certificado ausente: factura simple\n";
$esc = pc_reiniciar($pdo, $mock);
$pdo->exec('DELETE FROM emisor_config');
$cuerpo = pc_cuerpo($esc);
$r = pc_cobrar($esc, $cuerpo);
$f = pc_fila($pdo, $cuerpo['clave']);
wa_chk('sin emisor_config la venta sale como factura simple, con caja y sin tocar la secuencia',
    pc_ok($r) && $f !== [] && $f['tipo_ecf'] === null && count(pc_caja($pdo, (int) $f['id'])) === 1 && wa_contador($pdo, 'E32') === 0,
    [$r, wa_contador($pdo, 'E32')]);
$esc = pc_reiniciar($pdo, $mock);
pc_cert('ausente');
$cuerpo = pc_cuerpo($esc);
$r = pc_cobrar($esc, $cuerpo);
$f = pc_fila($pdo, $cuerpo['clave']);
wa_chk('con el archivo del certificado ausente la venta sale como factura simple, con caja, sin llamar a la DGII y con el numero devuelto',
    pc_ok($r) && $f !== [] && $f['tipo_ecf'] === null && count(pc_caja($pdo, (int) $f['id'])) === 1
    && wa_contador($pdo, 'E32') === 0 && pc_recepciones($mock) === 0, [$r, wa_contador($pdo, 'E32'), pc_recepciones($mock)]);

// ---------------------------------------------------------------------------
// S3) Las validaciones de captura siguen respondiendo 4xx aunque el
// certificado falle: no son un fallo de la emision.
// ---------------------------------------------------------------------------
echo "S3) validaciones del carrito con el certificado roto\n";
$esc = pc_reiniciar($pdo, $mock);
pc_cert('mala');
$antes = pc_n($pdo, 'SELECT COUNT(*) FROM facturas');
$totalMal = pc_cuerpo($esc);
$totalMal['total_centavos'] += 100;
$pocoEfectivo = pc_cuerpo($esc);
$pocoEfectivo['recibido_centavos'] = $pocoEfectivo['total_centavos'] - 1;
$sinCliente = pc_cuerpo($esc, 1, '31');
unset($sinCliente['client_id']);
$obtenido = [
    'total' => pc_cobrar($esc, $totalMal)['_error'] ?? null,
    'efectivo' => pc_cobrar($esc, $pocoEfectivo)['_error'] ?? null,
    'cliente' => pc_cobrar($esc, $sinCliente)['_error'] ?? null,
];
wa_chk('total distinto 409, efectivo insuficiente 422 y credito fiscal sin cliente 422',
    $obtenido === [
        'total' => ['codigo' => 'TOTAL_DISTINTO', 'http' => 409],
        'efectivo' => ['codigo' => 'RECIBIDO_INSUFICIENTE', 'http' => 422],
        'cliente' => ['codigo' => 'CLIENTE_REQUERIDO', 'http' => 422],
    ], $obtenido);
wa_chk('ninguna de esas ventas creo una factura', pc_n($pdo, 'SELECT COUNT(*) FROM facturas') === $antes);

// ---------------------------------------------------------------------------
// S4) Credito fiscal (E31) con el certificado roto: factura simple con el
// cliente.
// ---------------------------------------------------------------------------
echo "S4) E31 con el certificado roto: factura simple con el cliente\n";
$esc = pc_reiniciar($pdo, $mock);
pc_cert('mala');
$cuerpo = pc_cuerpo($esc, 1, '31');
$r = pc_cobrar($esc, $cuerpo);
$f = pc_fila($pdo, $cuerpo['clave']);
wa_chk('la venta E31 sale como factura simple con el cliente y se entrega',
    pc_ok($r) && $f !== [] && $f['tipo_ecf'] === null && (int) $f['client_id'] === (int) $esc['ids']['client_id']
    && (int) ($r['venta']['cliente']['id'] ?? 0) === (int) $esc['ids']['client_id']
    && count(pc_caja($pdo, (int) $f['id'])) === 1 && wa_movimientos($pdo, (int) $f['id']) === 1, [$r, $f['client_id'] ?? null]);

// ---------------------------------------------------------------------------
// S5) Numero ocupado al reservar: un reintento; el segundo choque sale.
// ---------------------------------------------------------------------------
echo "S5) emitirConReintento\n";
$choque = static fn(): EcfNumeroOcupadoException => new EcfNumeroOcupadoException('E320000000009', 'certecf', 'fila 1 en ACEPTADO');
$reintento = new ReflectionMethod('PosVenta', 'emitirConReintento');
$falso = new EmisionFalsa([$choque(), ['e_ncf' => 'E320000000010']]);
$r = $reintento->invoke(null, $falso, [], null);
wa_chk('un choque y luego exito: devuelve el resultado del segundo intento (2 llamadas)',
    ($r['e_ncf'] ?? null) === 'E320000000010' && $falso->llamadas === 2, [$r, $falso->llamadas]);
$falso = new EmisionFalsa([$choque(), $choque(), ['e_ncf' => 'E320000000011']]);
try {
    $reintento->invoke(null, $falso, [], null);
    $lanzo = null;
} catch (Throwable $e) {
    $lanzo = $e;
}
wa_chk('dos choques seguidos: sale la excepcion y no hay un tercer intento (2 llamadas)',
    $lanzo instanceof EcfNumeroOcupadoException && $falso->llamadas === 2, [$lanzo === null ? null : get_class($lanzo), $falso->llamadas]);
$falso = new EmisionFalsa([new RuntimeException('otra cosa'), ['e_ncf' => 'E320000000012']]);
try {
    $reintento->invoke(null, $falso, [], null);
    $lanzo = null;
} catch (Throwable $e) {
    $lanzo = $e;
}
wa_chk('cualquier otra excepcion sale sin reintentar (1 llamada)',
    $lanzo instanceof RuntimeException && $falso->llamadas === 1, [$lanzo === null ? null : get_class($lanzo), $falso->llamadas]);

// ---------------------------------------------------------------------------
// S6) Nunca se crea una segunda factura para una venta que ya tiene fila: con
// EcfEnvioInciertoException o EcfVentaRepetidaException la factura simple no se
// arma, y si la clave aparece mientras se guarda, el cajero reintenta con ella.
// ---------------------------------------------------------------------------
echo "S6) una venta que ya tiene fila no se duplica como factura simple\n";
$esc = pc_reiniciar($pdo, $mock);
$simple = new ReflectionMethod('PosVenta', 'ventaComoFacturaSimple');
$clave = pc_uuid();
$pago = ['forma_pago' => 1, 'total_centavos' => 236000, 'recibido_centavos' => 250000, 'devuelta_centavos' => 14000, 'iniciada_at' => null];
$resultados = [];
foreach ([
    'incierto' => new EcfEnvioInciertoException('E320000000001', 1, 'certecf', 'envio', null, true, new RuntimeException('timeout')),
    'repetida' => new EcfVentaRepetidaException($clave),
] as $nombre => $causa) {
    try {
        $simple->invoke(null, $esc['pos'], $esc['empleado'], $esc['turno'], $clave, 80, $esc['user_id'], null, '32', [], $pago, [], $causa);
        $resultados[$nombre] = 'creo una factura';
    } catch (Throwable $e) {
        $resultados[$nombre] = $e === $causa ? 'relanzada' : get_class($e);
    }
}
wa_chk('las dos excepciones se relanzan tal cual y no hay ninguna factura',
    $resultados === ['incierto' => 'relanzada', 'repetida' => 'relanzada'] && pc_n($pdo, 'SELECT COUNT(*) FROM facturas') === 0, $resultados);

// Una fila con esta clave aparecio entre el fallo del e-CF y el guardado de la factura simple.
$lineas = [[
    'product_id' => (int) $esc['ids']['product_id'], 'nombre_item' => 'WA producto', 'cantidad' => 2, 'precio_unitario' => 1180.0,
    'indicador_bien_servicio' => 1, 'unidad_medida' => '43',
]];
$ocupada = pc_uuid();
$facturas = new facturaModel();
$facturas->crearFacturaSimplePos(pc_datos_simple($esc, $ocupada));
try {
    $simple->invoke(null, $esc['pos'], $esc['empleado'], $esc['turno'], $ocupada, 80, $esc['user_id'], null, '32', $lineas, $pago, [], new RuntimeException('el e-CF no se pudo generar'));
    $r = 'no lanzo';
} catch (PosError $e) {
    $r = ['codigo' => $e->codigo(), 'http' => $e->http()];
} catch (Throwable $e) {
    $r = get_class($e);
}
wa_chk('si la clave ya tiene factura: 409 VENTA_EN_PROCESO (el cajero reintenta con la clave), sin segunda factura ni aviso de factura simple',
    $r === ['codigo' => 'VENTA_EN_PROCESO', 'http' => 409]
    && pc_n($pdo, 'SELECT COUNT(*) FROM facturas WHERE pos_idempotency_key = :k', [':k' => $ocupada]) === 1
    && pc_audit($pdo, 'POS_VENTA_FACTURA_SIMPLE') === [], $r);

// Cualquier fallo al guardar la factura simple (aqui, una venta sin lineas) es lo unico que detiene la venta.
try {
    $simple->invoke(null, $esc['pos'], $esc['empleado'], $esc['turno'], pc_uuid(), 80, $esc['user_id'], null, '32', [], $pago, [], new RuntimeException('el e-CF no se pudo generar'));
    $r = 'no lanzo';
} catch (PosError $e) {
    $r = ['codigo' => $e->codigo(), 'http' => $e->http()];
} catch (Throwable $e) {
    $r = get_class($e);
}
wa_chk('si la factura simple no se puede guardar: 500 VENTA_NO_GUARDADA (el POS reintenta con la misma clave), auditado y sin factura nueva',
    $r === ['codigo' => 'VENTA_NO_GUARDADA', 'http' => 500] && count(pc_audit($pdo, 'POS_VENTA_FALLIDA')) === 1
    && pc_n($pdo, 'SELECT COUNT(*) FROM facturas') === 1, $r);

// Deja la base como la espera la siguiente suite: sin ventas, caja ni turnos, con los rangos y el emisor sembrados.
pc_vaciar($pdo);

wa_fin();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
php -l tools/test_pos_continuidad.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch
```

Expected: the lint passes, the run prints `S0) facturaModel::crearFacturaSimplePos` and stops with exit code 1:

```
[FALLO] excepcion sin atrapar: Error (test_pos_continuidad.php:<line>): Call to undefined method facturaModel::crearFacturaSimplePos()
```

(`wa_scratch` already has the POS tables and columns. If it stops earlier with `[FALLO] a wa_scratch le falta la tabla ...`, apply `db/migrations/030_pos.sql` to the scratch base through `wa_pdo`, as Task 1 did for 032-034, and run it again.)

- [ ] **Step 4: Implement `facturaModel::crearFacturaSimplePos`**

In `src/Models/facturaModel.php`, insert this block directly above the line `    /** Nombre del candado, por base de datos: un tenant no serializa a otro. */` (keep that line right after it). The file stays LF.

```php
    /**
     * Factura simple de una venta del POS cuyo e-CF no se pudo generar (spec
     * 2026-10-12, 4.2.5): la misma factura interna de createFacturaSimple
     * (tipo_ecf NULL, sin e-NCF, sin ITBIS, sin DGII) con las columnas del POS
     * (turno, empleado y la clave de idempotencia) escritas en el MISMO INSERT.
     * Una venta repetida con esa clave nunca crea una segunda factura, y factura
     * y lineas van en una transaccion: no puede quedar una fila a medias.
     *
     * @param array $input {date, client_id, client_name, total, user_id, items[],
     *                      pos: {turno_id, pos_empleado_id, pos_idempotency_key}}.
     *                     items: description, amount (el precio FINAL, con ITBIS:
     *                     la factura simple no desglosa impuestos), quantity,
     *                     descuento_monto, product_id, unidad_medida,
     *                     indicador_bien_servicio.
     * @return int id de la factura
     * @throws EcfVentaRepetidaException la clave ya tiene factura (1062 en uk_facturas_pos_idem)
     * @throws InvalidArgumentException sin lineas o sin los datos del POS
     * @throws RuntimeException la base no pudo guardarla (el detalle va a error_log)
     */
    public function crearFacturaSimplePos(array $input): int
    {
        $pos = is_array($input['pos'] ?? null) ? $input['pos'] : [];
        $clave = (string) ($pos['pos_idempotency_key'] ?? '');
        if ($clave === '' || empty($pos['turno_id']) || empty($pos['pos_empleado_id'])) {
            throw new InvalidArgumentException('crearFacturaSimplePos: faltan turno_id, pos_empleado_id o pos_idempotency_key');
        }
        $items = $this->normalizeSimpleItems($input['items'] ?? []);
        if ($items === []) {
            throw new InvalidArgumentException('crearFacturaSimplePos: la venta no tiene lineas');
        }
        $total = isset($input['total']) && $input['total'] !== ''
            ? round((float) $input['total'], 2)
            : $this->sumSimpleTotal($items);

        $lock = $this->tomarLockSecuenciaSimple();
        try {
            $this->conexion->beginTransaction();
            $stmt = $this->conexion->prepare(
                'INSERT INTO facturas
                    (no_factura, date, client_id, client_name, user_id, total, tipo_pago, NCF, tipo_ecf,
                     turno_id, pos_empleado_id, pos_idempotency_key, envio_pendiente)
                 VALUES
                    (:no_factura, :date, :client_id, :client_name, :user_id, :total, 1, NULL, NULL,
                     :turno_id, :pos_empleado_id, :pos_idempotency_key, 0)'
            );
            $stmt->execute([
                // Dentro del candado Y de la transaccion, como createFacturaSimple.
                ':no_factura' => $this->nextSimpleFacturaNumber(),
                ':date' => ($input['date'] ?? '') !== '' ? $input['date'] : date('Y-m-d H:i:s'),
                ':client_id' => $input['client_id'] ?? null,
                // facturas.client_name es VARCHAR(100): una razon social larga no puede tumbar la venta.
                ':client_name' => mb_substr((string) ($input['client_name'] ?? ''), 0, 100),
                ':user_id' => $input['user_id'] ?? null,
                ':total' => $total,
                ':turno_id' => (int) $pos['turno_id'],
                ':pos_empleado_id' => (int) $pos['pos_empleado_id'],
                ':pos_idempotency_key' => $clave,
            ]);
            $facturaId = (int) $this->conexion->lastInsertId();
            $this->insertSimpleItems($facturaId, $items);
            $this->conexion->commit();
            return $facturaId;
        } catch (PDOException $e) {
            if ($this->conexion->inTransaction()) {
                $this->conexion->rollBack();
            }
            // Codigo del driver, no el SQLSTATE: 23000 cubre tambien otras claves.
            if ((int) ($e->errorInfo[1] ?? 0) === 1062 && str_contains($e->getMessage(), 'uk_facturas_pos_idem')) {
                throw new EcfVentaRepetidaException($clave);
            }
            // El texto de PDO (SQL, tablas) solo al log.
            error_log('[facturas] no se pudo crear la factura simple del POS: ' . $e->getMessage());
            throw new RuntimeException('No se pudo guardar la venta como factura simple.', 0, $e);
        } finally {
            if ($lock) {
                $this->soltarLockSecuenciaSimple();
            }
        }
    }

```

Run the test again: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch`

Expected:
- The 5 checks of S0 print `[OK  ]`.
- S1: the A checks pass; the B checks show `[FALLO]` (the sale still answers `EMISION_FALLIDA` 502, so B has no row).
- S2 and S4 show `[FALLO]`. S3 passes (validations never reach `emitir`).
- The run ends in S5 with `[FALLO] excepcion sin atrapar: ReflectionException (test_pos_continuidad.php:<line>)`, because `PosVenta::emitirConReintento` does not exist yet. Exit code 1.

- [ ] **Step 5: Implement the fallback in `PosVenta`**

Six edits in `src/Pos/PosVenta.php`, each anchored by the quoted text. Re-read the file first: Task 5 changed this region.

**a) Requires.** After the line

```php
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfUsuarioException.php';
```

add the three lines below, skipping any that Task 5 already added:

```php
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfNumeroOcupadoException.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfEnvioInciertoException.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EcfVentaRepetidaException.php';
```

**b) One retry on an e-NCF collision.** In `emitirEnTurno`, replace only the text `(new ECFEmissionService())->emitir(` with `self::emitirConReintento(new ECFEmissionService(), `. The arguments stay as Task 5 wrote them. For example the statement

```php
$result = (new ECFEmissionService())->emitir($payload, $persistencia);
```

becomes

```php
$result = self::emitirConReintento(new ECFEmissionService(), $payload, $persistencia);
```

**c) A failure before the reserve is a simple invoice, not a 502.** In the generic `catch (Throwable $e)` that follows that call, replace this tail (the `error_log('[pos] fallo en emision: ' ...)` line above it stays):

```php
            self::audit('POS_VENTA_FALLIDA', null, $auditBase, 'No se pudo emitir la venta del POS: ' . $e->getMessage(), false);
            throw new PosError($e instanceof EcfUsuarioException
                ? $e->getMensajeUsuario()
                : 'No se pudo emitir en la DGII. Inténtalo de nuevo en un momento; si sigue fallando, usa el procedimiento de contingencia.',
                502, 'EMISION_FALLIDA');
```

with:

```php
            // Nada llego a la base ni a la DGII (el contador ya recupero su numero): la venta no
            // se detiene (spec 2026-10-12, 4.2.5). Sale como factura simple y se entrega igual.
            return self::ventaComoFacturaSimple($pos, $empleado, $turno, $clave, $ancho, $userId, $cliente, $tipoEcf, $items, [
                'forma_pago' => $formaPago, 'total_centavos' => $totalCentavos, 'recibido_centavos' => $recibidoCentavos,
                'devuelta_centavos' => $devueltaCentavos, 'iniciada_at' => self::iniciadaAt($body['iniciada_ms'] ?? null),
            ], $auditBase, $e);
```

If Task 5 reflowed those lines, find them with `grep -n "EMISION_FALLIDA" src/Pos/PosVenta.php` and replace the whole `audit('POS_VENTA_FALLIDA'...)` plus `throw new PosError(... 'EMISION_FALLIDA')` pair. `$empleado`, `$turno`, `$clave`, `$ancho`, `$userId`, `$cliente`, `$tipoEcf`, `$items`, `$formaPago`, `$totalCentavos`, `$recibidoCentavos`, `$devueltaCentavos`, `$body` and `$auditBase` are the locals of `emitirEnTurno`.

**d) A repeat shows the same number.** In `respuestaDeVentaExistente`, replace the line

```php
                'e_ncf' => $venta['e_ncf'],
```

with

```php
                'e_ncf' => self::numeroDeVenta($venta),
```

If Task 5 rewrote that line, make the `e_ncf` of the `venta` array of the repeat answer use `self::numeroDeVenta($venta)`.

**e) The receipt of a simple sale prints as a simple invoice.** In `recibo()`, replace the line

```php
            $nombre = 'Factura_' . ($factura['e_ncf'] ?? $facturaId) . RepresentacionImpresa::sufijo($ancho);
```

with

```php
            // Factura simple (tipo_ecf NULL): se imprime como cualquier factura, con su numero interno y sin timbre.
            $simple = ($factura['tipo_ecf'] ?? null) === null;
            $nombre = 'Factura_' . ($simple ? ($factura['no_factura'] ?? $facturaId) : ($factura['e_ncf'] ?? $facturaId)) . RepresentacionImpresa::sufijo($ancho);
```

and the line

```php
            return RepresentacionImpresa::datosRecibo($factura, $cliente, false, $ancho, $nombre);
```

with

```php
            return RepresentacionImpresa::datosRecibo($factura, $cliente, $simple, $ancho, $nombre);
```

**f) The three methods.** Insert this block directly above the line `    public static function ancho($valor): int` (keep that line right after it):

```php
    /**
     * emitir con UN reintento cuando otra fila ya tenia el numero
     * (EcfNumeroOcupadoException): el contador ya avanzo, asi que el segundo
     * intento toma el siguiente. Un segundo choque sale tal cual y la venta
     * sigue como factura simple (ventaComoFacturaSimple). Cualquier otra
     * excepcion sale sin reintentar: repetir un envio incierto duplicaria la venta.
     */
    private static function emitirConReintento(ECFEmissionService $servicio, array $payload, ?callable $persistencia = null): array
    {
        try {
            return $servicio->emitir($payload, $persistencia);
        } catch (EcfNumeroOcupadoException $e) {
            error_log('[pos] e-NCF ocupado al reservar; se reintenta con el siguiente: ' . $e->getMessage());
            return $servicio->emitir($payload, $persistencia);
        }
    }

    /**
     * El e-CF no se pudo generar (certificado ausente, vencido o con otra clave,
     * fallo de firma, datos del emisor incompletos, sin rango...): nada llego a
     * la DGII y el contador ya recupero su numero. La venta NO se detiene (spec
     * 2026-10-12, 4.2.5; U8/U9): sale como factura simple, sin e-NCF, sin ITBIS y
     * sin envio, con las mismas lineas, el mismo total y las columnas del POS, asi
     * que la clave de idempotencia sigue valiendo. La entrega (caja, inventario,
     * auditoria) es la de cualquier venta (entregarVenta) y el cajero no ve nada
     * distinto: 201 con su recibo.
     *
     * Nunca arma una segunda factura para una venta que ya tiene fila: con
     * EcfEnvioInciertoException o EcfVentaRepetidaException hay un e-CF guardado
     * con esta clave y la excepcion se relanza.
     *
     * @param array $items lineas de armarLineas (nombre_item, cantidad, precio_unitario final...)
     * @param array $pago  {forma_pago, total_centavos, recibido_centavos, devuelta_centavos, iniciada_at}
     */
    private static function ventaComoFacturaSimple(
        posModel $pos, array $empleado, array $turno, string $clave, int $ancho, int $userId, ?array $cliente,
        string $tipoEcfPedido, array $items, array $pago, array $auditBase, Throwable $causa
    ): array {
        if ($causa instanceof EcfEnvioInciertoException || $causa instanceof EcfVentaRepetidaException) {
            throw $causa;
        }
        // El texto del fallo ya quedo en el log (lo escribio quien llama).
        error_log('[pos] la venta sale como factura simple: ' . get_class($causa));

        $facturas = new facturaModel();
        try {
            $facturaId = $facturas->crearFacturaSimplePos([
                'date' => date('Y-m-d H:i:s'),
                'client_id' => $cliente !== null ? (int) $cliente['id'] : null,
                'client_name' => $cliente !== null ? (string) ($cliente['client_name'] ?: PosCliente::forma($cliente)['nombre']) : 'Consumidor Final',
                'total' => $pago['total_centavos'] / 100,
                'user_id' => $userId,
                // El precio final (con ITBIS) de cada linea: la factura simple no desglosa impuestos.
                'items' => array_map(static function (array $it): array {
                    return [
                        'product_id' => $it['product_id'] ?? null,
                        'description' => (string) ($it['nombre_item'] ?? ''),
                        'amount' => $it['precio_unitario'] ?? 0,
                        'quantity' => $it['cantidad'] ?? 1,
                        'descuento_monto' => $it['descuento_monto'] ?? 0,
                        'indicador_bien_servicio' => $it['indicador_bien_servicio'] ?? 1,
                        'unidad_medida' => $it['unidad_medida'] ?? '43',
                    ];
                }, $items),
                'pos' => ['turno_id' => $turno['id'], 'pos_empleado_id' => $empleado['id'], 'pos_idempotency_key' => $clave],
            ]);
        } catch (EcfVentaRepetidaException $e) {
            // Otra peticion dejo una fila con esta clave entre tanto: el reintento
            // del cajero (misma clave) la encuentra y la entrega, sin duplicarla.
            throw new PosError('Esta venta todavía se está procesando. Espera un momento y vuelve a intentarlo.', 409, 'VENTA_EN_PROCESO');
        } catch (Throwable $e) {
            // Sin base no hay donde guardar la venta: lo unico que detiene el POS.
            error_log('[pos] factura simple de la venta: ' . get_class($e) . ': ' . $e->getMessage());
            self::audit('POS_VENTA_FALLIDA', null, $auditBase + ['causa' => get_class($causa)], 'No se pudo guardar la venta del POS.', false);
            throw new PosError('No se pudo guardar la venta en este momento.', 500, 'VENTA_NO_GUARDADA');
        }

        $guardada = $facturas->getFacturaSimple($facturaId) ?? [];
        $numero = (string) ($guardada['no_factura'] ?? '');
        // Solo la clase del fallo: el mensaje puede traer rutas del servidor.
        self::audit('POS_VENTA_FACTURA_SIMPLE', $numero, $auditBase + [
            'factura_id' => $facturaId, 'tipo_ecf_pedido' => $tipoEcfPedido, 'causa' => get_class($causa),
        ], 'La venta del POS salió como factura simple: no se pudo generar el comprobante electrónico.', false);

        $cobro = self::cobro($pago['forma_pago'], $pago['total_centavos'], $pago['recibido_centavos'], $pago['devuelta_centavos']);
        self::entregarVenta($pos, $facturaId, $facturas->getFacturaItems($facturaId), null, $userId,
            $cobro + ['turno_id' => $turno['id'], 'iniciada_at' => $pago['iniciada_at']],
            $auditBase + [
                'e_ncf' => $numero, 'estado_dgii' => null, 'envio_pendiente' => false, 'factura_simple' => true,
                'recibido' => $pago['recibido_centavos'] !== null ? $pago['recibido_centavos'] / 100 : null,
            ]);

        return [
            'venta' => [
                'factura_id' => $facturaId,
                'e_ncf' => $numero,
                'tipo_ecf' => '',
                'estado_dgii' => (string) ($guardada['estado_dgii'] ?? ''),
                'envio_pendiente' => false,
                'total_centavos' => $pago['total_centavos'],
                'cliente' => $cliente !== null ? PosCliente::forma($cliente) : null,
            ],
            'cobro' => $cobro,
            'recibo' => self::recibo($facturaId, $ancho),
            'repetida' => false,
        ];
    }

    /** Numero que imprime la venta: el e-NCF o, en una factura simple, su numero interno. */
    private static function numeroDeVenta(array $fila): string
    {
        $eNcf = trim((string) ($fila['e_ncf'] ?? ''));
        return $eNcf !== '' ? $eNcf : trim((string) ($fila['no_factura'] ?? ''));
    }

```

- [ ] **Step 6: The lookup by key returns the number of a simple sale**

In `src/Models/posModel.php`, in `ventaPorClave`, replace the text `SELECT id, e_ncf, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, respuesta_dgii, rfce_respuesta` with `SELECT id, e_ncf, no_factura, tipo_ecf, estado_dgii, total, envio_pendiente, turno_id, client_id, respuesta_dgii, rfce_respuesta`. If Task 5 already changed that SELECT, just add `no_factura` to it. Do not touch `ventasCobradasDelTurno`, `ventasDelEmpleadoEnCaja` or `PosCierre`: Task 14 (Step 6) owns them.

- [ ] **Step 7: Run the test**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch
```

Expected: S0-S6 all `[OK  ]` and the last line

```
33 de 33 pruebas OK
```

The script leaves the scratch base emptied and re-seeded (`pc_vaciar`). If a run dies halfway the base keeps its rows (no cleanup is needed: every scenario starts with `pc_reiniciar`). With port 8099 busy, run it with `WA_PUERTO_OFFSET=100` in the environment.

- [ ] **Step 8: Lint and run the suites this task touches**

```bash
php -l src/Models/facturaModel.php && php -l src/Pos/PosVenta.php && php -l src/Models/posModel.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_puro.php | tail -1
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -1
```

Expected: three `No syntax errors detected in ...`, then `N de N pruebas OK` twice (the Release 1 counts after Task 1's merge and Tasks 3-5; nothing in this task changes them). A flag whose extension is already loaded only prints a warning. Run the DB suite alone, after Step 7 has finished.

- [ ] **Step 9: Commit**

```bash
git add src/Models/facturaModel.php src/Pos/PosVenta.php src/Models/posModel.php tools/test_pos_continuidad.php
git commit -F - <<'EOF'
feat(pos): la venta sin e-CF sale como factura simple

Si el e-CF no se puede generar antes de guardarlo (certificado, firma,
emisor, rango...), la venta del POS no se detiene: se guarda como factura
simple con las columnas del POS (la clave de idempotencia sigue valiendo),
se entrega como cualquier venta (caja, inventario, auditoria) y deja un
evento POS_VENTA_FACTURA_SIMPLE para el aviso del admin. Un choque de e-NCF
al reservar se reintenta una vez. El recibo y la repeticion de la venta
muestran el numero interno de esas ventas. Con una fila ya guardada para la
clave nunca se arma una segunda factura.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: POS: sin rango la venta toma el numero siguiente y no se envia

Run every command from the API worktree root `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead` (Tasks 1-6 applied). The DB test runs on `wa_scratch` only, strictly alone.

Spec 4.2.6 (U10): when no current range has free numbers (exhausted or expired), a POS sale takes the number **after the last one used** for that type and environment, is signed, saved and printed like any sale, and is **not sent**: the DGII rejects numbers outside an authorized range. The automatic resend of Task 8 sends it once a registered range covers the number. This task only turns the option on in the POS and proves the behaviour end to end. The mechanism (`numerar_sin_rango`, `ncfModel::dispenseSinRango`, the early return after the reserve, `sin_rango` in the row meta) is Task 4. The delivery of the sale is Task 5, so a `PENDIENTE_ENVIO` result is delivered like every other outcome after the reserve.

Where there is no range at all for the type, `dispenseSinRango` finds nothing to follow and returns null: `emitir` keeps throwing its usual "Sin rango" `EcfUsuarioException` before the reserve and Task 6's fallback saves a factura simple (S10 proves it).

**Files:**
- Modify: `src/Pos/PosVenta.php`: one array key (with its comment) inside the `$payload` of `emitirEnTurno`, directly after `'autenticar_despues_de_reservar' => true,` (the option Task 5 added).
- Modify: `tools/test_pos_continuidad.php` (Task 6): add S7-S10 directly above the comment line `// Deja la base como la espera la siguiente suite` (the `pc_vaciar($pdo);` and `wa_fin();` that follow it stay). After this task the run has 50 checks.
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch`.

**Interfaces:**
- Consumes:
  - Task 4:
    - the payload option `'numerar_sin_rango' => true` of `ECFEmissionService::emitir`. When `ncfModel::dispenseNextECF` returns null it calls `ncfModel::dispenseSinRango(string $type, string $ambiente): ?array`, which increments, without the `numero_hasta` bound, the `current_value` of the type/ambiente range with the highest `numero_desde` (the last range). It returns the keys of `dispenseNextECF` plus `'sin_rango' => true`, with `fecha_vencimiento` of that last range, or null when the type has no range in that ambiente; `emitir` then throws its usual "Sin rango" `EcfUsuarioException`;
    - after the `'reservar'` hook `emitir` returns **without any DGII call, token included** an array with `'estado' => 'PENDIENTE_ENVIO'`, `'sin_rango' => true`, `'factura_id'` and the usual `e_ncf`, `tipo_ecf`, `signed_xml`, `codigo_seguridad` keys. The row meta (`respuesta_dgii`) gets `'sin_rango' => true`. The shutdown registry is not armed.
  - Task 5: `emitirEnTurno` passes the write-ahead hook and delivers every outcome after the reserve (`entregarVenta`: cash movement, stock once, audit), with `venta.envio_pendiente` read from the column (the reserve wrote 1).
  - Task 6: `tools/test_pos_continuidad.php` and its helpers (`pc_reiniciar`, `pc_cuerpo`, `pc_cobrar`, `pc_ok`, `pc_fila`, `pc_caja`, `pc_stock`, `pc_recepciones`, `pc_log_pos`, `pc_sin_definir`, `pc_vaciar`), and the fallback for a failure before the reserve.
  - Existing: `facturaModel::metaEnvio(?string $respuestaDgii): array`, `wa_contador(PDO $pdo, string $tipo, string $ambiente = 'certecf'): int`, `wa_movimientos`, `wa_sembrar` (it re-inserts the ranges and resets `numero_hasta` and `fecha_vencimiento`).
- Produces: no new function. The contract of a POS sale with no range:
  - the sale answers 201 `{venta, cobro, recibo, repetida:false}` with `venta.e_ncf` = the next number, `venta.estado_dgii` = `'PENDIENTE_ENVIO'` and `venta.envio_pendiente` = `true`; the receipt prints like any e-CF;
  - the row is `PENDIENTE_ENVIO`, `envio_pendiente` 1, with `sin_rango` true in its meta, and nothing was sent at sale time;
  - the type's counter keeps advancing past `numero_hasta`, so two such sales never share a number;
  - E31 and E32 are independent: an exhausted E32 does not affect E31 sales (RF5, POS side). The other half of RF5 (a new range covering the used numbers, the resend and `dispenseNextECF` skipping used numbers) is tested in Tasks 4 and 8.

- [ ] **Step 1: Check what Tasks 4-6 left**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
grep -c "function dispenseSinRango" src/Models/ncfModel.php
grep -c "numerar_sin_rango" src/Utils/FacturacionElectronica/ECFEmissionService.php
grep -c "'autenticar_despues_de_reservar' => true," src/Pos/PosVenta.php
grep -c "numerar_sin_rango" src/Pos/PosVenta.php
grep -c "function ventaComoFacturaSimple" src/Pos/PosVenta.php
grep -c "Deja la base como la espera la siguiente suite" tools/test_pos_continuidad.php
```

Expected: `git status --short` prints only `?? tools/reconstruir_e340000000001.sql`; the six counts print `1`, a number greater than `0`, `1`, `0`, `1` and `1`.

- [ ] **Step 2: Write the failing scenarios**

In `tools/test_pos_continuidad.php`, insert the block below directly above the comment line `// Deja la base como la espera la siguiente suite: sin ventas, caja ni turnos, con los rangos y el emisor sembrados.` (keep that line, `pc_vaciar($pdo);` and `wa_fin();` after it):

```php
// ---------------------------------------------------------------------------
// S7) E32 agotada con E31 vigente (RF5, parte del POS): solo las ventas E32
// toman el numero siguiente, se guardan y se imprimen, y no se envian.
// ---------------------------------------------------------------------------
echo "S7) secuencia E32 agotada: numero siguiente, guardada y sin enviar\n";
$esc = pc_reiniciar($pdo, $mock);
$prodId = (int) $esc['ids']['product_id'];
$stock0 = pc_stock($pdo, $prodId);
$cuerpoA = pc_cuerpo($esc);
$a = pc_cobrar($esc, $cuerpoA);
wa_chk('A: el primer E32 sale normal (numero 1, aceptado) y la DGII lo recibe',
    pc_ok($a) && ($a['venta']['e_ncf'] ?? null) === 'E320000000001' && pc_recepciones($mock) === 1, $a['venta'] ?? $a);
// El rango de E32 se agota: current_value llega a numero_hasta.
$pdo->exec("UPDATE ncf_sequences SET numero_hasta = current_value WHERE type = 'E32' AND ambiente = 'certecf'");
$logAntes = pc_log_pos();
$cuerpoB = pc_cuerpo($esc);
$b = pc_cobrar($esc, $cuerpoB);
$fb = pc_fila($pdo, $cuerpoB['clave']);
$idB = (int) ($fb['id'] ?? 0);
$metaB = facturaModel::metaEnvio($fb['respuesta_dgii'] ?? null);
wa_chk('B (E32 agotada): la venta se entrega y toma el numero siguiente al ultimo (E320000000002)',
    pc_ok($b) && ($b['repetida'] ?? null) === false && ($fb['e_ncf'] ?? null) === 'E320000000002' && ($fb['tipo_ecf'] ?? null) === '32', [$b, $fb['e_ncf'] ?? null]);
wa_chk('B: queda guardada PENDIENTE_ENVIO con envio_pendiente 1 y la marca sin_rango en su meta',
    ($fb['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO' && (int) ($fb['envio_pendiente'] ?? 0) === 1 && ($metaB['sin_rango'] ?? null) === true
    && !empty($fb['xml_firmado']) && !empty($fb['rfce_xml']) && !empty($fb['codigo_seguridad']), [$fb['estado_dgii'] ?? null, $metaB]);
wa_chk('B: no se envia al momento de vender (la DGII no recibio nada mas)', pc_recepciones($mock) === 1, pc_recepciones($mock));
wa_chk('B: el XML de una E32 no lleva fecha de vencimiento de secuencia',
    !str_contains((string) ($fb['xml_firmado'] ?? ''), 'FechaVencimientoSecuencia'));
wa_chk('B: caja e inventario se entregaron una vez (un movimiento de caja, un movimiento de inventario, stock -4 con A)',
    count(pc_caja($pdo, $idB)) === 1 && wa_movimientos($pdo, $idB) === 1 && pc_stock($pdo, $prodId) === $stock0 - 4,
    [count(pc_caja($pdo, $idB)), wa_movimientos($pdo, $idB), pc_stock($pdo, $prodId)]);
wa_chk('B: la respuesta dice que quedo pendiente de envio y trae el numero',
    ($b['venta']['e_ncf'] ?? null) === 'E320000000002' && ($b['venta']['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO'
    && ($b['venta']['envio_pendiente'] ?? null) === true && ($b['venta']['tipo_ecf'] ?? null) === '32', $b['venta'] ?? $b);
$recibo = $b['recibo'] ?? null;
wa_chk('B: el recibo se imprime como un e-CF normal (con su timbre), sin enterarse de que falta enviarlo',
    is_array($recibo) && str_contains((string) ($recibo['titulo'] ?? ''), 'FACTURA DE CONSUMO') && !empty($recibo['timbre']), $recibo['titulo'] ?? $recibo);
wa_chk('B: el contador de E32 avanzo al 2, mas alla del rango agotado', wa_contador($pdo, 'E32') === 2, wa_contador($pdo, 'E32'));
$sinDefinir = pc_sin_definir($logAntes);
wa_chk('B: el codigo no leyo claves que la venta sin rango no trae (sin "Undefined" en el log de PHP)', $sinDefinir === [], $sinDefinir);

$cuerpoC = pc_cuerpo($esc, 1, '31');
$c = pc_cobrar($esc, $cuerpoC);
$fc = pc_fila($pdo, $cuerpoC['clave']);
wa_chk('C (E31 con rango vigente): sigue siendo e-CF, se envia y queda aceptado',
    pc_ok($c) && ($fc['e_ncf'] ?? null) === 'E310000000001' && ($fc['estado_dgii'] ?? null) === 'ACEPTADO' && (int) ($fc['envio_pendiente'] ?? 1) === 0
    && pc_recepciones($mock) === 2, [$fc['e_ncf'] ?? null, $fc['estado_dgii'] ?? null, pc_recepciones($mock)]);

$cuerpoD = pc_cuerpo($esc);
$d = pc_cobrar($esc, $cuerpoD);
$fd = pc_fila($pdo, $cuerpoD['clave']);
wa_chk('D (otra E32): toma el numero que sigue (E320000000003), tambien PENDIENTE_ENVIO y sin enviar',
    pc_ok($d) && ($fd['e_ncf'] ?? null) === 'E320000000003' && ($fd['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO'
    && (int) ($fd['envio_pendiente'] ?? 0) === 1 && pc_recepciones($mock) === 2 && wa_contador($pdo, 'E32') === 3,
    [$fd['e_ncf'] ?? null, $fd['estado_dgii'] ?? null, pc_recepciones($mock), wa_contador($pdo, 'E32')]);

$b2 = pc_cobrar($esc, $cuerpoB);
wa_chk('B repetida: 201 repetida con la misma factura, una sola caja y un solo movimiento, y sigue sin enviarse',
    pc_ok($b2) && ($b2['repetida'] ?? null) === true && ($b2['venta']['factura_id'] ?? null) === $idB
    && count(pc_caja($pdo, $idB)) === 1 && wa_movimientos($pdo, $idB) === 1 && pc_recepciones($mock) === 2
    && ($b2['venta']['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO', $b2['venta'] ?? $b2);

// ---------------------------------------------------------------------------
// S8) E31 agotada: el XML lleva la fecha de vencimiento del ultimo rango.
// ---------------------------------------------------------------------------
echo "S8) secuencia E31 agotada: el XML lleva la fecha del ultimo rango\n";
$esc = pc_reiniciar($pdo, $mock);
pc_cobrar($esc, pc_cuerpo($esc, 1, '31'));
$pdo->exec("UPDATE ncf_sequences SET numero_hasta = current_value WHERE type = 'E31' AND ambiente = 'certecf'");
$vence = (string) $pdo->query("SELECT fecha_vencimiento FROM ncf_sequences WHERE type = 'E31' AND ambiente = 'certecf' ORDER BY numero_desde DESC LIMIT 1")->fetchColumn();
$cuerpoB = pc_cuerpo($esc, 1, '31');
$b = pc_cobrar($esc, $cuerpoB);
$fb = pc_fila($pdo, $cuerpoB['clave']);
wa_chk('la E31 toma el numero siguiente (E310000000002), queda PENDIENTE_ENVIO y no se envia',
    pc_ok($b) && ($fb['e_ncf'] ?? null) === 'E310000000002' && ($fb['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO'
    && (int) ($fb['envio_pendiente'] ?? 0) === 1 && pc_recepciones($mock) === 1, [$fb['e_ncf'] ?? null, $fb['estado_dgii'] ?? null, pc_recepciones($mock)]);
wa_chk('el XML trae la fecha de vencimiento del ultimo rango conocido',
    $vence !== '' && str_contains((string) ($fb['xml_firmado'] ?? ''),
        '<FechaVencimientoSecuencia>' . date('d-m-Y', strtotime($vence)) . '</FechaVencimientoSecuencia>'), $vence);

// ---------------------------------------------------------------------------
// S9) Rango vencido (no agotado): el numero tambien es el siguiente, sin enviar.
// ---------------------------------------------------------------------------
echo "S9) rango E32 vencido: numero siguiente y sin enviar\n";
$esc = pc_reiniciar($pdo, $mock);
$pdo->exec("UPDATE ncf_sequences SET fecha_vencimiento = CURDATE() - INTERVAL 1 DAY WHERE type = 'E32' AND ambiente = 'certecf'");
$cuerpo = pc_cuerpo($esc);
$r = pc_cobrar($esc, $cuerpo);
$f = pc_fila($pdo, $cuerpo['clave']);
wa_chk('con el unico rango vencido la venta toma el numero 1, queda PENDIENTE_ENVIO y no se envia',
    pc_ok($r) && ($f['e_ncf'] ?? null) === 'E320000000001' && ($f['estado_dgii'] ?? null) === 'PENDIENTE_ENVIO'
    && (int) ($f['envio_pendiente'] ?? 0) === 1 && pc_recepciones($mock) === 0, [$f['e_ncf'] ?? null, $f['estado_dgii'] ?? null, pc_recepciones($mock)]);

// ---------------------------------------------------------------------------
// S10) Ningun rango registrado para el tipo: no hay a que numero seguir, asi
// que la venta sale como factura simple (la venta no se detiene).
// ---------------------------------------------------------------------------
echo "S10) sin ningun rango de E32: factura simple\n";
$esc = pc_reiniciar($pdo, $mock);
$pdo->exec("DELETE FROM ncf_sequences WHERE type = 'E32' AND ambiente = 'certecf'");
$cuerpo = pc_cuerpo($esc);
$r = pc_cobrar($esc, $cuerpo);
$f = pc_fila($pdo, $cuerpo['clave']);
wa_chk('sin rango alguno la venta sale como factura simple, con caja, y no se envia',
    pc_ok($r) && $f !== [] && $f['tipo_ecf'] === null && (int) $f['envio_pendiente'] === 0 && count(pc_caja($pdo, (int) $f['id'])) === 1
    && pc_recepciones($mock) === 0, [$r, pc_recepciones($mock)]);

```

- [ ] **Step 3: Run it and watch S7-S9 fail**

```bash
php -l tools/test_pos_continuidad.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch
```

Expected: S0-S6 still `[OK  ]`. Without the option the POS does not ask for a number outside a range, so the exhausted E32 fails before the reserve and Task 6's fallback saves a factura simple:
- S7: `[FALLO] B (E32 agotada): la venta se entrega y toma el numero siguiente al ultimo (E320000000002)` with `obtenido` showing `e_ncf` null, plus `[FALLO]` on the `PENDIENTE_ENVIO` and `sin_rango` checks and on the D and repeat checks;
- S8 and S9: `[FALLO]` on their first check;
- S10: `[OK  ]` (no range at all is a simple invoice already). The run ends `N de 50 pruebas OK` with N below 50 and exit code 1.

- [ ] **Step 4: Turn the option on**

In `src/Pos/PosVenta.php`, in the `$payload` array of `emitirEnTurno`, replace the line

```php
            'autenticar_despues_de_reservar' => true,
```

with

```php
            'autenticar_despues_de_reservar' => true,
            // Rango agotado o vencido: la venta toma el numero siguiente al ultimo, se guarda y se
            // imprime, y NO se envia (la DGII rechaza numeros fuera de un rango autorizado). La envia
            // el reenvio automatico cuando un rango registrado lo cubre (spec 2026-10-12, 4.2.6).
            'numerar_sin_rango' => true,
```

If Task 5 wrote the option with other spacing, find it with `grep -n "autenticar_despues_de_reservar" src/Pos/PosVenta.php` and add the new key right after it.

- [ ] **Step 5: Run the test**

```bash
php -l src/Pos/PosVenta.php && php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_continuidad.php --tenant-db=wa_scratch
```

Expected: `No syntax errors detected in src/Pos/PosVenta.php`, every check `[OK  ]`, and the last line

```
50 de 50 pruebas OK
```

S7 prints an e-CF receipt with its QR, which needs GD: if `php -m` does not list `gd`, add `-d extension=gd` to the command.

- [ ] **Step 6: Run the DB-free Release 1 guards**

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_puro.php | tail -1
```

Expected: `N de N pruebas OK` (the Release 1 count after Tasks 1 and 5; this task adds one array key and changes no guard). The test script ends with `pc_vaciar($pdo)`, so the scratch base is left emptied and re-seeded (ranges and emisor included), ready for the next DB suite.

- [ ] **Step 7: Commit**

```bash
git add src/Pos/PosVenta.php tools/test_pos_continuidad.php
git commit -F - <<'EOF'
feat(pos): sin rango la venta toma el numero siguiente y no se envia

Cuando ningun rango vigente tiene numeros libres (agotado o vencido), la
venta del POS usa el numero siguiente al ultimo del tipo y ambiente, se
guarda, se entrega y se imprime como cualquier venta, y no se envia a la
DGII: queda PENDIENTE_ENVIO con sin_rango en su meta hasta que el reenvio
automatico la manda con un rango registrado que la cubra. Sin ningun rango
registrado sigue saliendo como factura simple. Pruebas: E32 agotada con E31
vigente, E31 con la fecha del ultimo rango en el XML, rango vencido.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


### Task 8: Reenvío automático del POS sobre el write-ahead

Run every command from the API worktree root, in Git Bash: `cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`. Tasks 1-7 are done. Every edit below is anchored on text, never on line numbers: `src/Pos/PosVenta.php` and `src/Models/posModel.php` are `origin/master`'s files (Task 1, "as is"), and Tasks 5-7 rewrote only `cobrar` and what it calls. This task replaces the resend side (`reenviarPendientes`, `revisarRFCE`, `revisarECF` and four `posModel` methods) and leaves `cobrar` alone.

**Before every DB run in this task.** `wa_scratch` is shared with the other suites and with other workers. Two suites running on it at once delete and re-seed each other's rows. A vanished fixture, a foreign `E319999990006` row, or `estado` coming back `null` for a row the test just inserted are overlap artifacts, not bugs. Check right before each run, not once per session:

```powershell
Get-CimInstance Win32_Process -Filter "Name='php.exe'" | Where-Object { $_.CommandLine -match 'tools' } | Select-Object ProcessId, CommandLine
```

Expected: no rows. If a suite is listed, wait for it (`Wait-Process -Id <ProcessId>`) and only then run. If a run fails with vanished rows or foreign e-NCFs, assume an overlap and re-run alone before debugging.

> **Open dependency, for whoever integrates the plan (not fixed here).** `ncfModel::registerRange` rejects a range whose `numero_desde` is not above `$tope = max(current_value, numero_hasta)` over the type's rows ("El número inicial debe ser mayor que {tope}"). `ncfModel::dispenseSinRango` (Task 4) pushes `current_value` of the last range past its `numero_hasta`: after three out-of-range sales on an E32 range closed at 100 the tope is 103, so the admin cannot register the range 101-200 that the DGII authorizes, and RF5 ("a new range covering the used numbers is registered") cannot happen through `POST /api/ncf/rangos`. Task 4 (or a new task) must make `registerRange` ignore consumption beyond `numero_hasta`: for a row that has a `numero_hasta`, the top it protects is `numero_hasta`, not `current_value`. Without that, spec 4.2.6 is not reachable from the app. This task does not depend on the answer: P4 registers the covering range with a direct `INSERT` of exactly the row `registerRange` would create (`current_value = numero_desde - 1`).

**Files:**
- Create: `tools/test_pos_reenvio.php` (36 checks). A DB test in the write-ahead harness (`tools/write_ahead_test_lib.php`): it runs `PosVenta::reenviarPendientes` and `posModel` inside its own process (`wa_usar_base`) against `wa_scratch` and the mock DGII (`wa_api`), with POS sales seeded by hand. It covers RF3 (P3) and RF5 (P4, P5).
- Modify: `src/Models/posModel.php`:
  - one `require_once` after `require_once __DIR__ . '/../Pos/PosError.php';`;
  - the four contiguous methods `ventasPendientes`, `contarPendientes`, `marcarEnvio`, `marcarEnvioECF`: from the docblock `/** Ventas con envio pendiente a la DGII (F7), las mas viejas primero. */` through the closing brace of `marcarEnvioECF`, which is followed by the section comment `// Clientes del POS (credito fiscal, F2)`. The block also adds the constant `SQL_SIN_RANGO`.
- Modify: `src/Pos/PosVenta.php`:
  - two `require_once` after `require_once __DIR__ . '/PosCliente.php';`;
  - the three contiguous methods `reenviarPendientes`, `revisarRFCE`, `revisarECF`: from the docblock `Reenvia hasta $max ventas pendientes.` through the closing brace of `revisarECF`, which is followed by the docblock `Estado de una consulta DGII ({estado: "Aceptado"} o {codigo: 1})`. The block also adds the constants `REENVIO_ESPERA_SEG` and `REENVIO_CANDIDATAS` and the private `pendientesAReenviar`. Untouched: `estadoDeConsulta`, `motivoRechazo`, `timeoutDgii`, `audit`, and everything in `cobrar`.
- Test: `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_reenvio.php --tenant-db=wa_scratch` (prefix with `WA_PUERTO_OFFSET=100` if 8098 or 8099 are busy).

**Interfaces:**
- Consumes:
  - Task 1 (merge, `origin/master` as is): `posModel` (`bloquearClave`, `movimientoDeFactura`, and the four methods this task replaces) and `PosVenta`; `ECFEmissionService::consultarEstadoRFCE(string $eNcf, string $codigoSeguridad, ?string $ambiente = null, ?string $rncEmisor = null): array`, `reenviarRFCE(string $rfceXml, ?string $ambiente = null, ?int $timeout = null): array`, `consultarTrackIds(string $eNcf, ?string $ambiente = null): ?array`, `reenviarECF(string $signedXml, ?string $ambiente = null, ?int $timeout = null): array` and `consultarEstado(string $trackId, string $eNcf, ?string $ambiente = null, ?string $rncEmisor = null): array`.
  - Task 3: `EstadosEcf::envioPendiente(string $estado): int` (1 for `EN_VUELO` or `SIN_VEREDICTO`, else 0), and `envio_pendiente = 1` on every POS row written by the reserve, `confirmar` and `incierto`.
  - Task 4: `ncfModel::rangoCubre(string $type, string $ambiente, int $valor): bool`. It is called on an instance here (`(new ncfModel())->rangoCubre(...)`), which works whether Task 4 declares it static or not. It must be scoped to the given ambiente and must not count an expired range as covering. Also the meta of a row numbered out of range: `respuesta_dgii` = `json_encode` with `"sin_rango":true` (a JSON boolean; `posModel::SQL_SIN_RANGO` matches the text `"sin_rango":true`) and `ambiente_secuencia`, estado `PENDIENTE_ENVIO`.
  - Release 1: `EstadosEcf::PENDIENTE_ENVIO`, `facturaModel::metaEnvio(?string $respuestaDgii): array` (meta `desde`, `ambiente_secuencia`).
  - Unchanged private helpers of `PosVenta`: `estadoDeConsulta`, `motivoRechazo`, `timeoutDgii`, `audit`.
- Produces (all names exact):

```php
// PosVenta (same public signature as today; the response shape does not change)
public const REENVIO_ESPERA_SEG = 120;     // a PENDIENTE_ENVIO younger than this is still being sent by its own request
public const REENVIO_CANDIDATAS = 60;      // candidates read per group per pass
public static function reenviarPendientes(posModel $pos, int $max = 5): array;   // {revisadas, aceptadas, rechazadas, pendientes}
// posModel
public function ventasPendientes(int $limite, bool $sinRango = false): array;
public function contarPendientes(): int;
public function marcarEnvio(int $facturaId, string $leido, string $estado, $respuesta): bool;                       // RFCE
public function marcarEnvioECF(int $facturaId, string $leido, string $estado, $respuesta, ?string $trackId): bool;  // e-CF
```

  Behavior, in one table:

  | Rule | Where | How |
  |---|---|---|
  | Flow by the stored XML | `reenviarPendientes` | `rfce_xml IS NOT NULL` is RFCE (consult by e-NCF + security code, resend the stored RFCE); else e-CF (trackId → result; no trackId → `ConsultaTrackIds`, resend the stored XML only if the DGII does not have it). Never re-signs. |
  | Selection | `posModel::ventasPendientes` | `pos_idempotency_key IS NOT NULL AND tipo_ecf IS NOT NULL AND envio_pendiente = 1`, oldest first. Two reads: the rows that can be sent now, and the `sin_rango` ones (`PENDIENTE_ENVIO` + `"sin_rango":true` in the meta), so a wall of waiting `sin_rango` rows cannot starve the rest. |
  | Skip: sale still mid-send (RF3) | `pendientesAReenviar` | `PENDIENTE_ENVIO` whose meta `desde` is less than `REENVIO_ESPERA_SEG` seconds old. No `desde` means unknown age: it is reviewed. `ENVIO_INCIERTO` and the rest are never skipped: their send already ended. |
  | Skip: no range yet (RF5) | `pendientesAReenviar` | a `sin_rango` row waits until `ncfModel::rangoCubre('E' . tipo_ecf, meta.ambiente_secuencia ?? ambiente_dgii, number)` is true (registered, covering, not expired). Then it is sent like any other. |
  | Compare-and-set | `posModel::marcarEnvio*` | `UPDATE ... WHERE id = :id AND estado_dgii = :leido`, with `envio_pendiente = EstadosEcf::envioPendiente(:estado)` in the same statement; `false` when another process already moved the row (nothing written, nothing audited). A match always changes the row (the new estado differs from `leido`, or an `ENVIADO` without trackId becomes `ENVIADO` with one), so `rowCount()`, which counts changed rows (`src/Database.php` does not set `MYSQL_ATTR_FOUND_ROWS`), tells whether it was written. |
  | Numbers | whole resend | never returned to the counter, even on a late rejection: a POS e-NCF is already printed. |

- [ ] **Step 0: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "function ventasPendientes\|function contarPendientes\|function marcarEnvio\|function marcarEnvioECF" src/Models/posModel.php
grep -n "function reenviarPendientes\|function revisarRFCE\|function revisarECF\|function estadoDeConsulta\|saveFacturaConECF" src/Pos/PosVenta.php
grep -n "function envioPendiente" src/Utils/FacturacionElectronica/EstadosEcf.php
grep -n "function rangoCubre" src/Models/ncfModel.php
grep -n "function reenviarRFCE\|function reenviarECF\|function consultarTrackIds" src/Utils/FacturacionElectronica/ECFEmissionService.php
```

Expected:
- `git status --short` lists only the untracked `tools/reconstruir_e340000000001.sql` (never stage it);
- the four `posModel` methods, with `ventasPendientes(int $limite)` still on master's one-parameter signature;
- `reenviarPendientes`, `revisarRFCE`, `revisarECF` and `estadoDeConsulta` in `PosVenta.php`, and no `saveFacturaConECF` anywhere in it (Task 5 removed the last use);
- one line each for `envioPendiente`, `rangoCubre`, `reenviarRFCE`, `reenviarECF`, `consultarTrackIds`.

If a `grep` for a function of Tasks 1, 3 or 4 prints nothing, that task is incomplete: stop and report it. Do not write the missing piece here.

- [ ] **Step 1: Write the failing test**

Create `tools/test_pos_reenvio.php` with exactly this content:

```php
<?php
/**
 * test_pos_reenvio.php — El reenvio automatico del POS (PosVenta::reenviarPendientes) y las escrituras de
 * posModel sobre el write-ahead (spec 2026-10-12, 4.3), contra la base de prueba y la DGII falsa
 * (tools/mock_dgii.php). Nunca produccion: wa_pdo() se niega a usar una base sin la tabla marca y las URL de la
 * DGII tienen que ser locales.
 *
 * PosVenta y posModel corren dentro de este proceso (wa_usar_base). Las ventas se siembran a mano en facturas con
 * las columnas del POS, y el mock responde por modo:
 *   trackids_vacio      la DGII no tiene el comprobante (consulta: "No Encontrado") y lo recibe y acepta
 *   trackids_rechazado  la DGII ya lo tiene y lo rechazo
 *   acepta              la DGII ya lo tiene aceptado
 * La API real (wa_api) solo se usa en P5.
 *
 * Uso:
 *   php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_reenvio.php --tenant-db=wa_scratch
 *   (WA_PUERTO_OFFSET=100 si 8098 u 8099 estan ocupados; sale con 1 si algo falla)
 */

require_once __DIR__ . '/write_ahead_test_lib.php';

$base = (string) wa_arg('tenant-db', '');
$pdo = wa_pdo($base);
wa_usar_base($base);       // Database y MasterDatabase de este proceso apuntan a la base de prueba
$srv = wa_api($base);      // mock DGII, API real y el token de wa_prueba (solo para P5)
$cert = wa_cert_prueba();
foreach ([
    'DGII_ECF_BASE_URL' => $srv['mock'], 'DGII_FC_BASE_URL' => $srv['mock'], 'DGII_ECF_TIMEOUT' => '3',
    'DGII_ECF_CERT_PATH' => $cert['path'], 'DGII_ECF_CERT_PASSWORD' => $cert['password'], 'POS_DGII_TIMEOUT' => '3',
] as $clave => $valor) {
    putenv("{$clave}={$valor}");
    $_ENV[$clave] = $valor;
}
if (preg_match('#^http://127\.0\.0\.1:\d+$#', $srv['mock']) !== 1) {
    echo "[FALLO] el mock de la DGII no es local: esta prueba envia comprobantes\n";
    exit(1);
}
require_once __DIR__ . '/../src/AuditLogger.php';
require_once __DIR__ . '/../src/Pos/PosVenta.php';
require_once __DIR__ . '/../src/Models/posModel.php';
require_once __DIR__ . '/../src/Models/ncfModel.php';

/** UUID v4 para pos_idempotency_key. */
function pr_uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/** Meta de respuesta_dgii de una fila en vuelo (spec 6.3). 'desde' por defecto es de hace 10 minutos. */
function pr_meta(array $extra = []): array
{
    return $extra + [
        'fase' => 'PENDIENTE_ENVIO', 'desde' => date('Y-m-d H:i:s', time() - 600), 'flujo' => 'ECF',
        'ambiente_secuencia' => 'certecf', 'dispensado' => true, 'rango_id' => null, 'secuencia_valor' => null,
    ];
}

/**
 * Una venta del POS sembrada a mano. $o: meta (array para respuesta_dgii), track, pos (false = sin
 * pos_idempotency_key), pendiente (envio_pendiente, 1), rfce (con rfce_xml; por defecto las E32).
 */
function pr_venta(PDO $pdo, string $eNcf, string $estado, array $o = []): int
{
    $tipo = substr($eNcf, 1, 2);
    $xml = static fn(string $raiz): string => "<{$raiz}><Encabezado><IdDoc><eNCF>{$eNcf}</eNCF></IdDoc></Encabezado></{$raiz}>";
    $pdo->prepare(
        "INSERT INTO facturas (no_factura, date, client_name, total, tipo_pago, tipo_ecf, e_ncf, track_id, estado_dgii,
                               codigo_seguridad, fecha_emision_dgii, ambiente_dgii, xml_firmado, respuesta_dgii, rfce_xml,
                               user_id, pos_idempotency_key, envio_pendiente)
         VALUES (:nf, NOW(), 'Consumidor Final', 1180.00, 1, :tipo, :encf, :track, :estado,
                 'ABC123', NOW(), 'certecf', :xml, :resp, :rfce, 1, :clave, :pend)"
    )->execute([
        ':nf' => $eNcf, ':tipo' => $tipo, ':encf' => $eNcf, ':track' => $o['track'] ?? null, ':estado' => $estado,
        ':xml' => $xml('ECF'), ':resp' => isset($o['meta']) ? json_encode($o['meta']) : null,
        ':rfce' => ($o['rfce'] ?? $tipo === '32') ? $xml('RFCE') : null,
        ':clave' => ($o['pos'] ?? true) ? pr_uuid() : null, ':pend' => $o['pendiente'] ?? 1,
    ]);
    return (int) $pdo->lastInsertId();
}

/** Lo que importa de una fila: estado, envio_pendiente, track_id y rfce_estado. */
function pr_fila(PDO $pdo, int $id): array
{
    $st = $pdo->prepare('SELECT estado_dgii, envio_pendiente, track_id, rfce_estado FROM facturas WHERE id = :id');
    $st->execute([':id' => $id]);
    $f = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    return [
        'estado' => $f['estado_dgii'] ?? null, 'pendiente' => isset($f['envio_pendiente']) ? (int) $f['envio_pendiente'] : null,
        'track' => $f['track_id'] ?? null, 'rfce' => $f['rfce_estado'] ?? null,
    ];
}

/** Escenario nuevo: mock en $modo, base limpia y sembrada, sin rangos de prueba, log del mock vacio. */
function pr_reiniciar(PDO $pdo, array $srv, string $modo): array
{
    wa_mock_modo($srv['mock'], $modo);
    $pdo->exec('DELETE FROM pos_caja_movimientos');
    wa_limpiar($pdo);
    $pdo->exec("DELETE FROM ncf_sequences WHERE type LIKE 'E%' AND numero_desde <> 1");
    $ids = wa_sembrar($pdo);
    wa_mock_log($srv['mock'], true);
    return $ids;
}

/** Llamadas de negocio que recibio el mock desde la ultima vez (sin la autenticacion), en orden. */
function pr_tags(string $mockUrl): array
{
    $tags = [];
    foreach (wa_mock_log($mockUrl, true) as $e) {
        $ruta = strtolower((string) $e['ruta']);
        $tag = match (true) {
            str_contains($ruta, '/consultarfce/') => 'rfce:consulta',
            str_contains($ruta, '/recepcionfc/') => 'rfce:recepcion',
            str_contains($ruta, '/consultatrackids/') => 'ecf:trackids',
            str_contains($ruta, '/consultaresultado/') => 'ecf:resultado',
            str_contains($ruta, '/recepcion/') => 'ecf:recepcion',
            default => null,
        };
        if ($tag !== null) {
            $tags[] = $tag;
        }
    }
    return $tags;
}

/** Contadores de los rangos E32 de certecf (numero_desde => current_value), para ver que el reenvio no los toca. */
function pr_contadores(PDO $pdo): array
{
    return array_map('intval', $pdo->query("SELECT numero_desde, current_value FROM ncf_sequences WHERE type = 'E32' AND ambiente = 'certecf' ORDER BY numero_desde")
        ->fetchAll(PDO::FETCH_KEY_PAIR));
}

/** Filas de audit_logs con esa accion. */
function pr_auditorias(PDO $pdo, string $accion): int
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM audit_logs WHERE action = :a');
    $st->execute([':a' => $accion]);
    return (int) $st->fetchColumn();
}

// ---------------------------------------------------------------------------
// P0) La base de prueba tiene las columnas del POS.
// ---------------------------------------------------------------------------
echo "P0) la base tiene lo del POS\n";
$tieneColumnas = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'facturas' AND COLUMN_NAME IN ('pos_idempotency_key', 'envio_pendiente')")->fetchColumn();
$tieneTabla = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pos_caja_movimientos'")->fetchColumn();
wa_chk('facturas tiene pos_idempotency_key y envio_pendiente, y existe pos_caja_movimientos (migracion 030)',
    $tieneColumnas === 2 && $tieneTabla === 1, [$tieneColumnas, $tieneTabla]);
if ($tieneColumnas !== 2 || $tieneTabla !== 1) {
    wa_fin();
}

// ---------------------------------------------------------------------------
// P1) El flujo lo decide el XML guardado, no el prefijo del estado.
// ---------------------------------------------------------------------------
echo "P1) el flujo lo decide el XML guardado (RFCE si hay rfce_xml, e-CF si no)\n";
pr_reiniciar($pdo, $srv, 'trackids_vacio');
$e32 = pr_venta($pdo, 'E320000000901', 'PENDIENTE_ENVIO', ['meta' => pr_meta(['flujo' => 'RFCE'])]);
$e31 = pr_venta($pdo, 'E310000000902', 'ENVIO_INCIERTO', ['meta' => pr_meta(['fase' => 'ENVIO_INCIERTO'])]);
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('revisa 2, acepta 2, sin rechazadas ni pendientes',
    $r === ['revisadas' => 2, 'aceptadas' => 2, 'rechazadas' => [], 'pendientes' => 0], $r);
$tags = pr_tags($srv['mock']);
wa_chk('la E32 (PENDIENTE_ENVIO) consulta y recibe por RFCE; la E31 (ENVIO_INCIERTO) por trackIds y Recepcion',
    $tags === ['rfce:consulta', 'rfce:recepcion', 'ecf:trackids', 'ecf:recepcion'], $tags);
wa_chk('E32: RFCE_ACEPTADO, rfce_estado ACEPTADO y envio_pendiente 0',
    pr_fila($pdo, $e32) === ['estado' => 'RFCE_ACEPTADO', 'pendiente' => 0, 'track' => null, 'rfce' => 'ACEPTADO'], pr_fila($pdo, $e32));
wa_chk('E31: ACEPTADO con el track_id de la DGII y envio_pendiente 0',
    pr_fila($pdo, $e31) === ['estado' => 'ACEPTADO', 'pendiente' => 0, 'track' => 'track-E310000000902', 'rfce' => null], pr_fila($pdo, $e31));
wa_chk('la auditoria dejo POS_VENTA_ENVIADA por cada una', pr_auditorias($pdo, 'POS_VENTA_ENVIADA') === 2, pr_auditorias($pdo, 'POS_VENTA_ENVIADA'));

// ---------------------------------------------------------------------------
// P2) Solo las ventas del POS con envio_pendiente = 1.
// ---------------------------------------------------------------------------
echo "P2) solo las ventas del POS con envio_pendiente = 1\n";
pr_reiniciar($pdo, $srv, 'acepta');
$final = pr_venta($pdo, 'E310000000911', 'ACEPTADO', ['track' => 'track-E310000000911', 'pendiente' => 0]);
$ajena = pr_venta($pdo, 'E310000000912', 'ENVIADO', ['track' => 'track-E310000000912', 'pos' => false]);
$venta = pr_venta($pdo, 'E310000000913', 'ENVIADO', ['track' => 'track-E310000000913']);
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('revisa solo la venta del POS pendiente; la que no es del POS no cuenta como pendiente',
    $r['revisadas'] === 1 && $r['aceptadas'] === 1 && $r['pendientes'] === 0, $r);
$tags = pr_tags($srv['mock']);
wa_chk('con trackId consulta el resultado y no reenvia nada', $tags === ['ecf:resultado'], $tags);
wa_chk('la venta quedo ACEPTADO con envio_pendiente 0',
    pr_fila($pdo, $venta)['estado'] === 'ACEPTADO' && pr_fila($pdo, $venta)['pendiente'] === 0, pr_fila($pdo, $venta));
wa_chk('la fila final y la que no es del POS no se tocaron',
    pr_fila($pdo, $final)['estado'] === 'ACEPTADO' && pr_fila($pdo, $ajena)['estado'] === 'ENVIADO' && pr_fila($pdo, $ajena)['pendiente'] === 1,
    [pr_fila($pdo, $final), pr_fila($pdo, $ajena)]);

// ---------------------------------------------------------------------------
// P3) RF3: una venta PENDIENTE_ENVIO reciente sigue en curso.
// ---------------------------------------------------------------------------
echo "P3) RF3: el reenvio no toca una PENDIENTE_ENVIO de menos de 2 minutos\n";
pr_reiniciar($pdo, $srv, 'trackids_vacio');
$reciente = date('Y-m-d H:i:s', time() - 30);
$joven = pr_venta($pdo, 'E310000000921', 'PENDIENTE_ENVIO', ['meta' => pr_meta(['desde' => $reciente])]);
$incierto = pr_venta($pdo, 'E310000000922', 'ENVIO_INCIERTO', ['meta' => pr_meta(['fase' => 'ENVIO_INCIERTO', 'desde' => $reciente])]);
$r = PosVenta::reenviarPendientes(new posModel());
$tags = pr_tags($srv['mock']);
wa_chk('revisa solo la ENVIO_INCIERTO (su envio ya termino); la reciente sigue contando como pendiente',
    $r['revisadas'] === 1 && $r['aceptadas'] === 1 && $r['pendientes'] === 1, $r);
wa_chk('la DGII recibio una sola vez: la de la ENVIO_INCIERTO', $tags === ['ecf:trackids', 'ecf:recepcion'], $tags);
wa_chk('la PENDIENTE_ENVIO reciente sigue igual',
    pr_fila($pdo, $joven) === ['estado' => 'PENDIENTE_ENVIO', 'pendiente' => 1, 'track' => null, 'rfce' => null], pr_fila($pdo, $joven));
$pdo->prepare('UPDATE facturas SET respuesta_dgii = :m WHERE id = :id')->execute([
    ':m' => json_encode(pr_meta(['desde' => date('Y-m-d H:i:s', time() - (PosVenta::REENVIO_ESPERA_SEG + 1))])), ':id' => $joven,
]);
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('pasados los 2 minutos la toma y la acepta',
    $r['revisadas'] === 1 && $r['aceptadas'] === 1 && pr_fila($pdo, $joven)['estado'] === 'ACEPTADO', [$r, pr_fila($pdo, $joven)]);
$sinMeta = pr_venta($pdo, 'E310000000923', 'PENDIENTE_ENVIO');
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('sin desde en la meta no hay como saber que es reciente: se revisa',
    $r['revisadas'] === 1 && pr_fila($pdo, $sinMeta)['estado'] === 'ACEPTADO', [$r, pr_fila($pdo, $sinMeta)]);

// ---------------------------------------------------------------------------
// P4) RF5: las ventas sin_rango esperan un rango autorizado, vigente, que las cubra.
// ---------------------------------------------------------------------------
echo "P4) RF5: las ventas sin_rango esperan un rango que las cubra\n";
$ids = pr_reiniciar($pdo, $srv, 'trackids_vacio');
// E32 agotado: el rango 1..100 y tres ventas numeradas despues (101, 102 y 103).
$pdo->exec("UPDATE ncf_sequences SET numero_hasta = 100, current_value = 103 WHERE type = 'E32' AND ambiente = 'certecf'");
$sinRango = static fn(int $n): array => ['meta' => pr_meta(['flujo' => 'RFCE', 'sin_rango' => true, 'secuencia_valor' => $n])];
$cubiertas = [];
foreach ([101, 102, 103] as $n) {
    $cubiertas[$n] = pr_venta($pdo, 'E32' . str_pad((string) $n, 10, '0', STR_PAD_LEFT), 'PENDIENTE_ENVIO', $sinRango($n));
}
// Mas sin_rango que lo que cabe en una pasada, fuera de lo que cubrira el rango nuevo: no pueden dejar sin
// turno a las demas ventas pendientes.
$fuera = PosVenta::REENVIO_CANDIDATAS + 2;
for ($n = 201; $n < 201 + $fuera; $n++) {
    pr_venta($pdo, 'E32' . str_pad((string) $n, 10, '0', STR_PAD_LEFT), 'PENDIENTE_ENVIO', $sinRango($n));
}
$e31 = pr_venta($pdo, 'E310000000930', 'ENVIO_INCIERTO', ['meta' => pr_meta(['fase' => 'ENVIO_INCIERTO'])]);
$r = PosVenta::reenviarPendientes(new posModel());
$tags = pr_tags($srv['mock']);
wa_chk('revisa solo la E31 (tiene rango): las E32 sin_rango se saltan y la DGII no recibe ninguna E32',
    $r['revisadas'] === 1 && $r['aceptadas'] === 1 && pr_fila($pdo, $e31)['estado'] === 'ACEPTADO' && $tags === ['ecf:trackids', 'ecf:recepcion'],
    [$r, $tags]);
wa_chk('las sin_rango siguen PENDIENTE_ENVIO con envio_pendiente 1 y cuentan como pendientes',
    $r['pendientes'] === 3 + $fuera && pr_fila($pdo, $cubiertas[101]) === ['estado' => 'PENDIENTE_ENVIO', 'pendiente' => 1, 'track' => null, 'rfce' => null],
    [$r['pendientes'], pr_fila($pdo, $cubiertas[101])]);
// El rango nuevo cubre 101..200 pero ya vencio: no cuenta.
$pdo->prepare("INSERT INTO ncf_sequences (type, prefix, current_value, numero_desde, numero_hasta, fecha_vencimiento, description, ambiente)
               VALUES ('E32', 'E32', 100, 101, 200, :v, 'WA rango nuevo', 'certecf')")->execute([':v' => date('Y-m-d', strtotime('-1 day'))]);
$contadores = pr_contadores($pdo);
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('con el rango nuevo vencido tampoco se envian', $r['revisadas'] === 0 && pr_tags($srv['mock']) === [], $r);
// El admin lo deja vigente.
$pdo->exec("UPDATE ncf_sequences SET fecha_vencimiento = DATE_ADD(CURDATE(), INTERVAL 1 YEAR) WHERE type = 'E32' AND numero_desde = 101");
$r = PosVenta::reenviarPendientes(new posModel());
$tags = pr_tags($srv['mock']);
wa_chk('con el rango vigente envia las tres que cubre y ninguna de las de afuera',
    $r['revisadas'] === 3 && $r['aceptadas'] === 3 && $r['pendientes'] === $fuera
    && $tags === ['rfce:consulta', 'rfce:recepcion', 'rfce:consulta', 'rfce:recepcion', 'rfce:consulta', 'rfce:recepcion'], [$r, $tags]);
wa_chk('las tres quedan RFCE_ACEPTADO con envio_pendiente 0',
    array_map(static fn(int $id): array => pr_fila($pdo, $id), array_values($cubiertas))
    === array_fill(0, 3, ['estado' => 'RFCE_ACEPTADO', 'pendiente' => 0, 'track' => null, 'rfce' => 'ACEPTADO']),
    array_map(static fn(int $id): array => pr_fila($pdo, $id), array_values($cubiertas)));
wa_chk('el reenvio no movio ningun contador de E32', pr_contadores($pdo) === $contadores, [pr_contadores($pdo), $contadores]);

// ---------------------------------------------------------------------------
// P5) RF5, segunda mitad: con el rango registrado, un comprobante nuevo no recibe un numero ya usado.
// Sigue en el estado de P4: rango 101..200 con el contador en 100 y 101-103 ya ocupados.
// ---------------------------------------------------------------------------
echo "P5) RF5: el siguiente comprobante salta los numeros usados fuera de rango\n";
wa_mock_modo($srv['mock'], 'acepta');
$r = wa_http('POST', $srv['api'] . '/api/facturas', ['tipo_ecf' => '32', 'client_id' => $ids['client_id'], 'tipo_pago' => 1, 'items' => [[
    'nombre_item' => 'WA linea libre', 'indicador_facturacion' => 1, 'indicador_bien_servicio' => 1, 'cantidad' => 1, 'precio_unitario' => 1000,
]]], ['X-API-KEY: ' . $srv['token']], 60);
wa_chk('200 y el numero es el primero libre del rango nuevo: 101 a 103 ya estan usados',
    $r['status'] === 200 && ($r['json']['data']['e_ncf'] ?? null) === 'E320000000104', $r);
wa_chk('el contador del rango nuevo quedo en 104', (pr_contadores($pdo)[101] ?? null) === 104, pr_contadores($pdo));

// ---------------------------------------------------------------------------
// P6) Un rechazo que llega tarde no devuelve el numero.
// ---------------------------------------------------------------------------
echo "P6) un rechazo tardio no devuelve el numero\n";
pr_reiniciar($pdo, $srv, 'trackids_rechazado');
$pdo->exec("UPDATE ncf_sequences SET current_value = 5 WHERE type = 'E31' AND ambiente = 'certecf'");
$rech = pr_venta($pdo, 'E310000000005', 'ENVIO_INCIERTO', ['meta' => pr_meta(['fase' => 'ENVIO_INCIERTO', 'secuencia_valor' => 5])]);
$r = PosVenta::reenviarPendientes(new posModel());
wa_chk('rechazadas trae factura_id, e_ncf y el motivo de la DGII',
    $r['revisadas'] === 1 && $r['aceptadas'] === 0 && $r['pendientes'] === 0
    && $r['rechazadas'] === [['factura_id' => $rech, 'e_ncf' => 'E310000000005', 'motivo' => 'Rechazo de prueba del mock DGII.']], $r);
wa_chk('RECHAZADO con el trackId de la DGII y envio_pendiente 0',
    pr_fila($pdo, $rech) === ['estado' => 'RECHAZADO', 'pendiente' => 0, 'track' => 'track-E310000000005', 'rfce' => null], pr_fila($pdo, $rech));
wa_chk('el contador de E31 sigue en 5: el numero no vuelve', wa_contador($pdo, 'E31') === 5, wa_contador($pdo, 'E31'));
wa_chk('la auditoria dejo POS_VENTA_RECHAZADA', pr_auditorias($pdo, 'POS_VENTA_RECHAZADA') === 1, pr_auditorias($pdo, 'POS_VENTA_RECHAZADA'));

// ---------------------------------------------------------------------------
// P7) posModel: compare-and-set, con envio_pendiente en la misma sentencia.
// ---------------------------------------------------------------------------
echo "P7) posModel: escrituras compare-and-set\n";
pr_reiniciar($pdo, $srv, 'acepta');
$pos = new posModel();
$a = pr_venta($pdo, 'E310000000941', 'ENVIO_INCIERTO', ['meta' => pr_meta(['fase' => 'ENVIO_INCIERTO'])]);
wa_chk('con otro estado leido no escribe y devuelve false',
    $pos->marcarEnvioECF($a, 'PENDIENTE_ENVIO', 'ACEPTADO', ['codigo' => 1], 'T1') === false
    && pr_fila($pdo, $a) === ['estado' => 'ENVIO_INCIERTO', 'pendiente' => 1, 'track' => null, 'rfce' => null], pr_fila($pdo, $a));
wa_chk('veredicto abierto (ENVIADO): escribe, deja envio_pendiente en 1 y guarda el trackId',
    $pos->marcarEnvioECF($a, 'ENVIO_INCIERTO', 'ENVIADO', null, 'T1') === true
    && pr_fila($pdo, $a) === ['estado' => 'ENVIADO', 'pendiente' => 1, 'track' => 'T1', 'rfce' => null], pr_fila($pdo, $a));
wa_chk('veredicto final: envio_pendiente 0 en la misma sentencia y el trackId se conserva',
    $pos->marcarEnvioECF($a, 'ENVIADO', 'ACEPTADO', ['codigo' => 1], null) === true
    && pr_fila($pdo, $a) === ['estado' => 'ACEPTADO', 'pendiente' => 0, 'track' => 'T1', 'rfce' => null], pr_fila($pdo, $a));
wa_chk('un estado final no se pisa: este reenvio llegaba tarde',
    $pos->marcarEnvioECF($a, 'ENVIADO', 'RECHAZADO', ['codigo' => 2], null) === false && pr_fila($pdo, $a)['estado'] === 'ACEPTADO', pr_fila($pdo, $a));
$b = pr_venta($pdo, 'E320000000942', 'PENDIENTE_ENVIO', ['meta' => pr_meta(['flujo' => 'RFCE'])]);
wa_chk('RFCE: con otro estado leido no escribe',
    $pos->marcarEnvio($b, 'ENVIO_INCIERTO', 'RFCE_RECHAZADO', ['mensajes' => []]) === false && pr_fila($pdo, $b)['estado'] === 'PENDIENTE_ENVIO', pr_fila($pdo, $b));
wa_chk('RFCE: un rechazo escribe el estado, rfce_estado sin prefijo y envio_pendiente 0',
    $pos->marcarEnvio($b, 'PENDIENTE_ENVIO', 'RFCE_RECHAZADO', ['mensajes' => []]) === true
    && pr_fila($pdo, $b) === ['estado' => 'RFCE_RECHAZADO', 'pendiente' => 0, 'track' => null, 'rfce' => 'RECHAZADO'], pr_fila($pdo, $b));

// ---------------------------------------------------------------------------
// P8) El texto del codigo: sin prefijo de estado, sin escrituras sin compare-and-set, sin devolver numeros.
// ---------------------------------------------------------------------------
echo "P8) el codigo del reenvio\n";
$leer = static fn(string $ruta): string => str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../' . $ruta));
$pv = $leer('src/Pos/PosVenta.php');
$pm = $leer('src/Models/posModel.php');
$region = (string) preg_replace('/^.*?public static function reenviarPendientes\(/s', '', $pv);
$region = (string) preg_replace('/private static function estadoDeConsulta\(.*$/s', '', $region);
wa_chk('PosVenta decide RFCE por rfce_xml y no por el prefijo del estado',
    str_contains($region, '$esRfce = !empty($v[\'rfce_xml\']);') && !str_contains($region, "str_starts_with((string) \$v['estado_dgii'], 'RFCE_')"));
wa_chk('el reenvio no devuelve numeros al contador', !str_contains($region, 'rollbackECFSequence') && !str_contains($region, 'reclamarSecuencia'));
wa_chk('posModel: los dos UPDATE del reenvio llevan AND estado_dgii = :leido y envio_pendiente = :p',
    substr_count($pm, 'AND estado_dgii = :leido') === 2 && substr_count($pm, 'envio_pendiente = :p') === 2);

// Deja la base como recien sembrada (sin los rangos de prueba).
pr_reiniciar($pdo, $srv, 'acepta');
wa_fin();
```

- [ ] **Step 2: Run it and watch it fail**

Check that no other suite is running (the PowerShell command above), then:

```bash
php -l tools/test_pos_reenvio.php
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_reenvio.php --tenant-db=wa_scratch
```

Expected: `No syntax errors detected`; then P0 passes, P1 prints two `[FALLO]` lines, P2 three, P3 three, and the run ends in `[FALLO] excepcion sin atrapar: Error (test_pos_reenvio.php:...): Undefined constant PosVenta::REENVIO_ESPERA_SEG` with exit code 1 and no `N de N` line. The failures that matter, with what the old code obtains:
- P1 `la E32 (PENDIENTE_ENVIO) consulta y recibe por RFCE...`: obtained `["ecf:trackids","ecf:recepcion","ecf:trackids","ecf:recepcion"]` (the E32 goes through the e-CF flow because its estado has no `RFCE_` prefix);
- P1 `E32: RFCE_ACEPTADO...`: obtained `{"estado":"ACEPTADO","pendiente":0,"track":"track-E320000000901","rfce":null}`;
- P2 `revisa solo la venta del POS pendiente...`: obtained `revisadas` 2 (the row that is not from the POS is revised too);
- P3 `revisa solo la ENVIO_INCIERTO...`: obtained `revisadas` 2 (the young `PENDIENTE_ENVIO` is sent a second time).

- [ ] **Step 3: Save the method-replacement script**

Both files are replaced method by method by name, not by line number, so Tasks 5-7 moving code around cannot break the anchors. Create the folder `$TEMP/pos_reenvio_t8` (`mkdir -p "$TEMP/pos_reenvio_t8"`; `$TEMP` is the Windows temp folder, `C:/Users/<you>/AppData/Local/Temp` for the Write tool) and save this script in it, outside the repo, as `reemplazar_metodos.php`:

```php
<?php
/**
 * Reemplaza metodos de una clase por el codigo de un archivo, buscandolos por
 * nombre (con el docblock que los precede), sin depender de numeros de linea.
 *
 * Uso: php reemplazar_metodos.php <archivo.php> <bloque.php> <metodo1,metodo2,...>
 *
 * - <bloque.php> es codigo de clase sin "<?php" (metodos, constantes), con su
 *   sangria de 4 espacios.
 * - Los metodos nombrados tienen que ser contiguos: la region va desde el
 *   docblock del primero hasta la llave que cierra el ultimo. Si entre medio
 *   hay otro metodo que no esta en la lista, no toca nada y sale con 1.
 * - El archivo puede ser CRLF: se compara en LF y se escribe con su final de
 *   linea original.
 */
[$ruta, $archivoBloque, $lista] = [$argv[1] ?? '', $argv[2] ?? '', $argv[3] ?? ''];
$nombres = array_values(array_filter(array_map('trim', explode(',', $lista))));
if ($ruta === '' || $archivoBloque === '' || $nombres === []) {
    fwrite(STDERR, "uso: php reemplazar_metodos.php <archivo.php> <bloque.php> <metodo,metodo,...>\n");
    exit(1);
}
$orig = (string) file_get_contents($ruta);
$crlf = str_contains($orig, "\r\n");
$src = str_replace("\r\n", "\n", $orig);

// Tokens con su posicion en el texto.
$toks = [];
$pos = 0;
foreach (token_get_all($src) as $t) {
    $txt = is_array($t) ? $t[1] : $t;
    $toks[] = ['id' => is_array($t) ? $t[0] : null, 'txt' => $txt, 'pos' => $pos];
    $pos += strlen($txt);
}
$n = count($toks);
/** Indice del siguiente token que no es espacio, yendo $paso (+1 o -1) desde $i. */
function saltar(array $toks, int $i, int $paso): int
{
    $i += $paso;
    while (isset($toks[$i]) && $toks[$i]['id'] === T_WHITESPACE) {
        $i += $paso;
    }
    return $i;
}

// Metodos de la clase: nombre => [inicio, fin) en bytes. Un closure no tiene nombre y se ignora.
$metodos = [];
for ($i = 0; $i < $n; $i++) {
    if ($toks[$i]['id'] !== T_FUNCTION) {
        continue;
    }
    $j = saltar($toks, $i, 1);
    if (($toks[$j]['id'] ?? null) !== T_STRING) {
        continue;
    }
    $nombre = $toks[$j]['txt'];
    // Hacia atras: modificadores y, si lo precede, su docblock.
    $ini = $i;
    $k = saltar($toks, $i, -1);
    while (isset($toks[$k]) && in_array($toks[$k]['id'], [T_PUBLIC, T_PRIVATE, T_PROTECTED, T_STATIC, T_FINAL, T_ABSTRACT], true)) {
        $ini = $k;
        $k = saltar($toks, $k, -1);
    }
    if (isset($toks[$k]) && $toks[$k]['id'] === T_DOC_COMMENT) {
        $ini = $k;
    }
    // Hacia adelante: hasta la llave que cierra el cuerpo.
    $m = $j;
    while ($m < $n && $toks[$m]['txt'] !== '{' && $toks[$m]['txt'] !== ';') {
        $m++;
    }
    if (($toks[$m]['txt'] ?? '') !== '{') {
        continue;
    }
    $prof = 0;
    for (; $m < $n; $m++) {
        if (in_array($toks[$m]['id'], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true) || $toks[$m]['txt'] === '{') {
            $prof++;
        } elseif ($toks[$m]['txt'] === '}') {
            $prof--;
            if ($prof === 0) {
                break;
            }
        }
    }
    $metodos[$nombre] = [$toks[$ini]['pos'], $toks[$m]['pos'] + 1];
}

foreach ($nombres as $nombre) {
    if (!isset($metodos[$nombre])) {
        fwrite(STDERR, "no se encontro el metodo {$nombre} en {$ruta}\n");
        exit(1);
    }
}
$desde = min(array_map(static fn(string $x): int => $metodos[$x][0], $nombres));
$hasta = max(array_map(static fn(string $x): int => $metodos[$x][1], $nombres));
// Contiguos: ningun otro metodo cae dentro de la region.
foreach ($metodos as $nombre => [$a, $b]) {
    if (!in_array($nombre, $nombres, true) && $a < $hasta && $b > $desde) {
        fwrite(STDERR, "el metodo {$nombre} queda dentro de la region a reemplazar: no se toca nada\n");
        exit(1);
    }
}
$desde = (int) strrpos(substr($src, 0, $desde), "\n") + 1;   // al inicio de la linea (con su sangria)
$bloque = rtrim(str_replace("\r\n", "\n", (string) file_get_contents($archivoBloque)));
$nuevo = substr($src, 0, $desde) . $bloque . substr($src, $hasta);
file_put_contents($ruta, $crlf ? str_replace("\n", "\r\n", $nuevo) : $nuevo);
printf("reemplazados %d metodos (%s), lineas %d-%d del archivo original\n",
    count($nombres), implode(', ', $nombres), substr_count($src, "\n", 0, $desde) + 1, substr_count($src, "\n", 0, $hasta) + 1);
```

- [ ] **Step 4: `posModel`: compare-and-set writes and a POS-only selection**

(a) Add the `require_once`. In `src/Models/posModel.php`, replace

```php
require_once __DIR__ . '/../Pos/PosError.php';
```

with

```php
require_once __DIR__ . '/../Pos/PosError.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php';
```

(b) Save this block in `$TEMP/pos_reenvio_t8` as `posmodel_bloque.php`. It is class code without `<?php`, indented 4 spaces:

```php
    /**
     * Una venta numerada fuera de rango (ncfModel::dispenseSinRango) guarda 'sin_rango' en la meta de
     * respuesta_dgii (json_encode: "sin_rango":true) y sigue en PENDIENTE_ENVIO hasta que un rango autorizado la
     * cubra. Se reconoce con el texto del JSON porque la columna es TEXT: JSON_EXTRACT fallaria con una
     * respuesta que no es JSON (HTML de un 500 de la DGII).
     */
    private const SQL_SIN_RANGO = "(estado_dgii = 'PENDIENTE_ENVIO' AND COALESCE(respuesta_dgii, '') LIKE '%\"sin_rango\":true%')";

    /**
     * Ventas del POS con envio pendiente a la DGII (F7), las mas viejas primero: filas con
     * pos_idempotency_key, e-NCF y envio_pendiente = 1 (la marca que escriben la reserva, 'confirmar' e
     * 'incierto' con EstadosEcf::envioPendiente). $sinRango = false trae las que se pueden mandar ya;
     * true, las numeradas fuera de rango, que PosVenta solo manda cuando un rango registrado las cubre.
     * Incluye respuesta_dgii: de ahi sale la meta (desde, ambiente_secuencia).
     */
    public function ventasPendientes(int $limite, bool $sinRango = false): array
    {
        $stmt = $this->conexion->prepare(
            'SELECT id, e_ncf, tipo_ecf, estado_dgii, codigo_seguridad, ambiente_dgii, rfce_xml, track_id, xml_firmado, respuesta_dgii
             FROM facturas
             WHERE pos_idempotency_key IS NOT NULL AND tipo_ecf IS NOT NULL AND envio_pendiente = 1
               AND ' . ($sinRango ? '' : 'NOT ') . self::SQL_SIN_RANGO . '
             ORDER BY id LIMIT ' . max(1, min(100, $limite))
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /** Ventas del POS que siguen con envio pendiente (incluye las sin_rango). */
    public function contarPendientes(): int
    {
        return (int) $this->conexion->query(
            'SELECT COUNT(*) FROM facturas WHERE pos_idempotency_key IS NOT NULL AND tipo_ecf IS NOT NULL AND envio_pendiente = 1'
        )->fetchColumn();
    }

    /**
     * Resultado de un reenvio o consulta de un RFCE (E32 < 250k), compare-and-set: solo escribe si la fila
     * sigue en $leido, el estado con que la leyo el reenvio. Asi nunca pisa un estado que otro proceso ya fijo
     * (la peticion de la venta, otra caja, GET /estado). envio_pendiente va en la MISMA sentencia que
     * estado_dgii (EstadosEcf::envioPendiente del estado nuevo). Una coincidencia siempre cambia la fila
     * ($estado es distinto de $leido), asi que rowCount(), que cuenta filas cambiadas y no encontradas, sirve
     * para saber si se escribio.
     *
     * @return bool false si otro proceso ya movio la fila: no se escribio nada
     */
    public function marcarEnvio(int $facturaId, string $leido, string $estado, $respuesta): bool
    {
        $stmt = $this->conexion->prepare(
            'UPDATE facturas SET estado_dgii = :e, rfce_estado = :re, rfce_respuesta = :r, envio_pendiente = :p
             WHERE id = :id AND estado_dgii = :leido'
        );
        $stmt->execute([
            ':e' => $estado,
            ':re' => preg_replace('/^RFCE_/', '', $estado),
            ':r' => $respuesta !== null ? json_encode($respuesta, JSON_UNESCAPED_UNICODE) : null,
            ':p' => EstadosEcf::envioPendiente($estado),
            ':id' => $facturaId,
            ':leido' => $leido,
        ]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Resultado de un e-CF completo (E31 y E32 desde 250k): estado, respuesta y trackId. Mismas reglas que
     * marcarEnvio: compare-and-set sobre $leido y envio_pendiente en la misma sentencia. El trackId nuevo no
     * borra el que ya habia (COALESCE). Una coincidencia siempre cambia la fila: $estado es distinto de $leido,
     * o es un ENVIADO sin trackId que pasa a ENVIADO con trackId.
     *
     * @return bool false si otro proceso ya movio la fila: no se escribio nada
     */
    public function marcarEnvioECF(int $facturaId, string $leido, string $estado, $respuesta, ?string $trackId): bool
    {
        $stmt = $this->conexion->prepare(
            'UPDATE facturas SET estado_dgii = :e, respuesta_dgii = :r, track_id = COALESCE(:t, track_id), envio_pendiente = :p
             WHERE id = :id AND estado_dgii = :leido'
        );
        $stmt->execute([
            ':e' => $estado,
            ':r' => $respuesta !== null ? json_encode($respuesta, JSON_UNESCAPED_UNICODE) : null,
            ':t' => $trackId,
            ':p' => EstadosEcf::envioPendiente($estado),
            ':id' => $facturaId,
            ':leido' => $leido,
        ]);
        return $stmt->rowCount() > 0;
    }
```

(c) Replace the four methods and lint:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S="$TEMP/pos_reenvio_t8"
php "$S/reemplazar_metodos.php" src/Models/posModel.php "$S/posmodel_bloque.php" ventasPendientes,contarPendientes,marcarEnvio,marcarEnvioECF
php -l src/Models/posModel.php
git ls-files --eol src/Models/posModel.php
```

Expected: `reemplazados 4 metodos (ventasPendientes, contarPendientes, marcarEnvio, marcarEnvioECF), lineas N-M del archivo original` (N-M is about `649-694`, counted on the file after step (a)'s extra line; only the count of methods matters); `No syntax errors detected`; the `--eol` line unchanged from before (the script keeps the file's line endings). If the script says `el metodo X queda dentro de la region`, another task put a method between these four: move it out of the way and run again.

- [ ] **Step 5: `PosVenta`: flow by XML, skips and compare-and-set**

(a) Add the requires. In `src/Pos/PosVenta.php`, replace

```php
require_once __DIR__ . '/PosCliente.php';
```

with

```php
require_once __DIR__ . '/PosCliente.php';
require_once __DIR__ . '/../Utils/FacturacionElectronica/EstadosEcf.php';
require_once __DIR__ . '/../Models/ncfModel.php';
```

(b) Save this block in `$TEMP/pos_reenvio_t8` as `posventa_bloque.php`:

```php
    /**
     * Una venta PENDIENTE_ENVIO mas nueva que esto sigue en curso: la peticion que la guardo todavia esta
     * enviando (el envio dura como mucho POS_DGII_TIMEOUT segundos). El reenvio no la toca, o mandaria dos
     * veces el mismo comprobante.
     */
    public const REENVIO_ESPERA_SEG = 120;

    /**
     * Candidatas que se leen por pasada y por grupo. El reenvio salta las que todavia no le toca (en curso, o
     * sin_rango sin rango que las cubra) y no puede quedarse sin ver las que si: por eso las sin_rango se leen
     * aparte y no entran en el LIMIT de las demas.
     */
    public const REENVIO_CANDIDATAS = 60;

    /**
     * Reenvia hasta $max ventas pendientes. Antes de reenviar CONSULTA a la DGII por e-NCF + codigo de
     * seguridad (RFCE) o por e-NCF (e-CF): si ya la tenia (el timeout fue de la respuesta, no del envio), solo
     * se actualiza el estado. Una que siga sin respuesta queda pendiente para la proxima vuelta.
     *
     * Reglas (spec 4.3):
     *  - El flujo lo decide el XML guardado: RFCE si rfce_xml no es nulo, e-CF completo si no. PENDIENTE_ENVIO
     *    y ENVIO_INCIERTO no llevan el prefijo RFCE_ del estado.
     *  - Nunca re-firma ni devuelve numeros al contador: el numero de una venta del POS ya esta impreso.
     *  - Cada escritura es compare-and-set sobre el estado que se leyo (posModel::marcarEnvio*) y pone
     *    envio_pendiente en la misma sentencia: si otro proceso ya movio la fila, no se pisa.
     *
     * @return array{revisadas: int, aceptadas: int, rechazadas: array, pendientes: int}
     */
    public static function reenviarPendientes(posModel $pos, int $max = 5): array
    {
        $aceptadas = 0;
        $rechazadas = [];
        $revisadas = 0;
        foreach (self::pendientesAReenviar($pos, $max) as $v) {
            $revisadas++;
            $id = (int) $v['id'];
            if (empty($v['e_ncf'])) {
                error_log('[pos] pendiente ' . $id . ' sin e-NCF: no se puede reenviar');
                continue;
            }
            $esRfce = !empty($v['rfce_xml']);
            try {
                $servicio = new ECFEmissionService();
                [$estado, $respuesta, $trackId] = $esRfce
                    ? self::revisarRFCE($servicio, $v)
                    : self::revisarECF($pos, $servicio, $v);
                $prefijo = $esRfce ? 'RFCE_' : '';
                // El estado que la fila tiene de verdad: revisarECF actualiza $v['estado_dgii'] cuando deja la
                // fila en ENVIADO antes de consultar, y el compare-and-set del veredicto espera ese.
                $leido = (string) $v['estado_dgii'];
                $marcar = static function (string $final) use ($pos, $id, $esRfce, $leido, $respuesta, $trackId): bool {
                    $escrito = $esRfce
                        ? $pos->marcarEnvio($id, $leido, $final, $respuesta)
                        : $pos->marcarEnvioECF($id, $leido, $final, $respuesta, $trackId);
                    if (!$escrito) {
                        error_log('[pos] pendiente ' . $id . ': otro proceso ya cambio su estado; no se pisa con ' . $final);
                    }
                    return $escrito;
                };
                if (in_array($estado, ['ACEPTADO', 'ACEPTADO_CONDICIONAL'], true)) {
                    if ($marcar($prefijo . $estado)) {
                        $aceptadas++;
                        self::audit('POS_VENTA_ENVIADA', $v['e_ncf'], ['factura_id' => $id, 'estado_dgii' => $prefijo . $estado],
                            'Venta pendiente del POS aceptada por la DGII.');
                    }
                } elseif ($estado === 'RECHAZADO') {
                    if ($marcar($prefijo . 'RECHAZADO')) {
                        $motivo = self::motivoRechazo($respuesta);
                        $rechazadas[] = ['factura_id' => $id, 'e_ncf' => $v['e_ncf'], 'motivo' => $motivo];
                        self::audit('POS_VENTA_RECHAZADA', $v['e_ncf'], ['factura_id' => $id, 'motivo' => $motivo],
                            'La DGII rechazó una venta del POS que ya se había entregado (estaba pendiente).', false);
                    }
                }
                // EN_PROCESO, sin veredicto o sin saber si llego: sigue pendiente.
            } catch (Throwable $e) {
                error_log('[pos] reenvio de la pendiente ' . $id . ': ' . get_class($e) . ': ' . $e->getMessage());
            }
        }
        return [
            'revisadas' => $revisadas,
            'aceptadas' => $aceptadas,
            'rechazadas' => $rechazadas,
            'pendientes' => $pos->contarPendientes(),
        ];
    }

    /**
     * Las ventas que el reenvio puede tocar ahora, las mas viejas primero, hasta $max. Salta:
     *  - PENDIENTE_ENVIO con menos de REENVIO_ESPERA_SEG segundos desde su reserva (meta 'desde'): la peticion
     *    que la guardo sigue enviando. Sin 'desde' en la meta no hay como saber que es reciente: se revisa.
     *    ENVIO_INCIERTO y los demas estados no se saltan: su envio ya termino.
     *  - sin_rango (numero fuera de rango autorizado) mientras ningun rango registrado y vigente cubra su
     *    numero (ncfModel::rangoCubre): la DGII lo rechazaria. La meta dice con que ambiente se numero.
     *
     * @return list<array>
     */
    private static function pendientesAReenviar(posModel $pos, int $max): array
    {
        $ahora = time();
        $elegibles = [];
        foreach ($pos->ventasPendientes(self::REENVIO_CANDIDATAS, false) as $v) {
            if ((string) $v['estado_dgii'] === EstadosEcf::PENDIENTE_ENVIO) {
                $desde = strtotime((string) (facturaModel::metaEnvio($v['respuesta_dgii'] ?? null)['desde'] ?? ''));
                if ($desde !== false && $ahora - $desde < self::REENVIO_ESPERA_SEG) {
                    continue;
                }
            }
            $elegibles[] = $v;
        }
        $ncf = null;
        foreach ($pos->ventasPendientes(self::REENVIO_CANDIDATAS, true) as $v) {
            $meta = facturaModel::metaEnvio($v['respuesta_dgii'] ?? null);
            $ambiente = (string) ($meta['ambiente_secuencia'] ?? $v['ambiente_dgii'] ?? '');
            $ncf ??= new ncfModel();
            if ($ambiente !== '' && $ncf->rangoCubre('E' . $v['tipo_ecf'], $ambiente, (int) substr((string) $v['e_ncf'], 3))) {
                $elegibles[] = $v;
            }
        }
        usort($elegibles, static fn(array $a, array $b): int => (int) $a['id'] <=> (int) $b['id']);
        return array_slice($elegibles, 0, max(1, $max));
    }

    /**
     * RFCE pendiente: consulta por e-NCF + codigo de seguridad; si la DGII no lo tiene, reenvia el RFCE firmado
     * que se guardo.
     * @return array{0: ?string, 1: mixed, 2: null} [estado sin prefijo, respuesta, trackId]
     */
    private static function revisarRFCE(ECFEmissionService $servicio, array $v): array
    {
        if (empty($v['codigo_seguridad'])) {
            error_log('[pos] pendiente ' . $v['id'] . ' sin codigo de seguridad: no se puede consultar');
            return [null, null, null];
        }
        $consulta = $servicio->consultarEstadoRFCE((string) $v['e_ncf'], (string) $v['codigo_seguridad'], $v['ambiente_dgii'] ?? null);
        $estado = self::estadoDeConsulta($consulta['data'] ?? null);
        $respuesta = $consulta['data'] ?? null;
        if ($estado === 'NO_ENCONTRADO') {
            if (empty($v['rfce_xml'])) {
                error_log('[pos] pendiente ' . $v['id'] . ' sin RFCE firmado guardado: no se puede reenviar');
                return [null, null, null];
            }
            $envio = $servicio->reenviarRFCE((string) $v['rfce_xml'], $v['ambiente_dgii'] ?? null, self::timeoutDgii());
            return [preg_replace('/^RFCE_/', '', (string) $envio['estado']), $envio['response'], null];
        }
        return [$estado, $respuesta, null];
    }

    /**
     * e-CF completo (E31, o E32 desde 250k) pendiente. Con trackId: se pregunta el resultado
     * (ConsultaResultado). Sin trackId (no hubo respuesta al enviar): primero ConsultaTrackIds; si la DGII lo
     * tiene, se toma su trackId; si responde que no, se reenvia el XML firmado. Si no se puede saber, no se
     * reenvia. Cuando deja la fila en ENVIADO (esperando su veredicto) actualiza $v['estado_dgii'], que es el
     * estado que el compare-and-set del veredicto tiene que esperar.
     *
     * @return array{0: ?string, 1: mixed, 2: ?string} [estado, respuesta, trackId]
     */
    private static function revisarECF(posModel $pos, ECFEmissionService $servicio, array &$v): array
    {
        $ambiente = $v['ambiente_dgii'] ?? null;
        $trackId = !empty($v['track_id']) ? (string) $v['track_id'] : null;
        if ($trackId === null) {
            $tracks = $servicio->consultarTrackIds((string) $v['e_ncf'], $ambiente);
            if ($tracks === null) {
                return [null, null, null];
            }
            if ($tracks === []) {
                if (empty($v['xml_firmado'])) {
                    error_log('[pos] pendiente ' . $v['id'] . ' sin XML firmado guardado: no se puede reenviar');
                    return [null, null, null];
                }
                $envio = $servicio->reenviarECF((string) $v['xml_firmado'], $ambiente, self::timeoutDgii());
                $trackId = $envio['track_id'];
                if (in_array($envio['estado'], ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RECHAZADO'], true) || $trackId === null) {
                    return [$envio['estado'], $envio['response'], $trackId];
                }
            } else {
                $trackId = $tracks[count($tracks) - 1]['trackId'];
            }
            // Ya esta en la DGII: queda esperando su veredicto, con su trackId. Compare-and-set: si otro
            // proceso ya movio la fila, no se sigue con ella.
            if (!$pos->marcarEnvioECF((int) $v['id'], (string) $v['estado_dgii'], 'ENVIADO', null, $trackId)) {
                error_log('[pos] pendiente ' . $v['id'] . ': otro proceso ya cambio su estado; no se pisa con ENVIADO');
                return [null, null, null];
            }
            $v['estado_dgii'] = 'ENVIADO';
        }
        $consulta = $servicio->consultarEstado($trackId, (string) $v['e_ncf'], $ambiente);
        return [self::estadoDeConsulta($consulta['data'] ?? null), $consulta['data'] ?? null, $trackId];
    }
```

(c) Replace the three methods and lint:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S="$TEMP/pos_reenvio_t8"
php "$S/reemplazar_metodos.php" src/Pos/PosVenta.php "$S/posventa_bloque.php" reenviarPendientes,revisarRFCE,revisarECF
php -l src/Pos/PosVenta.php
grep -n "ventasPendientes\|contarPendientes\|marcarEnvio" src/Pos/*.php src/Controllers/posController.php
```

Expected: `reemplazados 3 metodos (reenviarPendientes, revisarRFCE, revisarECF), lineas N-M del archivo original` (N-M is about `472-588`, counted on the file after step (a)'s two extra lines); `No syntax errors detected`; the `grep` matches only inside `src/Pos/PosVenta.php`, all in the code of this block (`ventasPendientes(self::REENVIO_CANDIDATAS, false)`, `ventasPendientes(self::REENVIO_CANDIDATAS, true)`, `contarPendientes()` and the `marcarEnvio` / `marcarEnvioECF` calls with their new argument lists). `posController.php` calls `PosVenta::reenviarPendientes($pos)`, whose signature did not change. If the `grep` finds another caller of the old four-argument `marcarEnvio` / `marcarEnvioECF` (for example in `PosCierre.php`), stop and report it: the plan expects none.

- [ ] **Step 6: Run the test, lint and the DB-free suite**

Check that no other suite is running, then:

```bash
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_reenvio.php --tenant-db=wa_scratch
php tools/test_write_ahead_puro.php | tail -3
```

Expected: the first run ends with

```
36 de 36 pruebas OK
```

(P4 inserts 65 rows, so it takes a while; the run re-seeds the base at the end, so a second run starts clean). The second prints the same `N de N pruebas OK` as before this task: nothing here touches what that suite reads.

- [ ] **Step 7: Commit**

```bash
git add src/Models/posModel.php src/Pos/PosVenta.php tools/test_pos_reenvio.php
git commit -F - <<'EOF'
feat(pos): el reenvio automatico del POS sobre el write-ahead

El flujo (RFCE o e-CF) lo decide el XML guardado y no el prefijo del estado:
PENDIENTE_ENVIO y ENVIO_INCIERTO no lo llevan. Se revisan las ventas del POS
con envio_pendiente = 1; se saltan las PENDIENTE_ENVIO de menos de 2 minutos
(su peticion sigue enviando) y las sin_rango hasta que un rango vigente las
cubre (ncfModel::rangoCubre), leidas aparte para que no dejen sin turno a las
demas. Cada escritura es compare-and-set sobre el estado leido y pone
envio_pendiente en la misma sentencia (EstadosEcf::envioPendiente); nunca
devuelve numeros al contador. La respuesta no cambia. Nace
tools/test_pos_reenvio.php.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: «Reenviar a la DGII» de una rechazada sobre el write-ahead

Run every command from the API worktree root, in Git Bash: `cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`. Tasks 1-8 are done. The edits are anchored on text that exists on both sides of the merge (our `HEAD` and `origin/master`); line numbers are not used. The DB check of the PowerShell command in Task 8 ("Before every DB run") applies to every DB run here.

Decision 7 of Release 1 is redefined (spec 2026-10-12, U6-U7): the app **never** resends a comprobante that is *without confirmation* (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO` and their `RFCE_` twins), because the DGII may already have it; it **does** re-emit a *rejected* one. After Task 1 the controller has master's `handleReenviar`, `armarInputReenvio` and `campoXmlReenvio`: they already go through `emitirFacturaEcf`, so the row is saved before the send, but they re-dispense a number that the counter gave back and they treat every non-rejected state the same. This task adapts them: same e-NCF through the `'e_ncf'` override, and a specific 409 for anything unconfirmed.

Why the override and not a new dispense: a POS number never goes back to the counter (`reclamar_secuencia = false`), and an app number goes back only when the DGII says it did not use it; the same e-NCF is the only number that is safe in both cases. The reserve (`reservarFacturaECF`, Release 1 Task 8) finds the rejected row by that e-NCF, it is in `EstadosEcf::REINTENTABLES`, and archives it (`<estado>_ARCHIVADO`, `e_ncf` NULL) in the same transaction that inserts the new row.

Two consequences that this task has to handle, both proven by scenarios below:
- With an `e_ncf` override `ECFEmissionService::emitir` dispenses nothing, so the XML's `FechaVencimientoSecuencia` no longer comes from the range that would have dispensed the number but from `emisor_config`. The reason the user asked for this button (a rejection for the sequence's date, code 145) would repeat. The input therefore carries `fecha_vencimiento_secuencia` of the range that covers the number (RV5).
- `devolverSaldoDeFactura` for the old row is what keeps stock right for POS sales and pre-Release-1 rows (RV4).

**Files:**
- Modify: `src/Controllers/facturaController.php`. Eleven text edits (Step 4): the new constant `FACTURA_REENVIO_SIN_CONFIRMAR`; two Release 1 comments; three edits in `handleReenviar` (its docblock, the unconfirmed check, and the final call, which also adds the new function `vencimientoDeLaSecuencia`); `armarInputReenvio` (adds `'e_ncf'`); the new function `cerrarReenvioRechazado`; and three insertions in `emitirFacturaEcf` (the `502` incierto branch, the normal path after `$facturaId = (int) $result['factura_id'];`, and `$data['reenvio_de']`).
- Modify: `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php`: one comment line.
- Modify: `tools/test_write_ahead_puro.php`: the two decision-7 guards of the section "12) facturaController: GET /estado en vuelo y filtro pendiente" (quoted in Step 1), plus a new section directly above the closing block `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`.
- Modify: `tools/test_write_ahead_api.php`: the label of `'sin campo de reenvio (decision 7)'`, plus scenarios RV1-RV8 directly above the closing `wa_mock_modo($srv['mock'], 'acepta');` / `wa_fin();`.
- Modify: `tests/test_facturas_write_ahead.http`: the "Decision 7" scenario at the end becomes two scenarios.
- Docs (`docs/api/facturas.md`, `docs/integrations/dgii-ecf.md`, `docs/integrations/pos-write-ahead.md`) are rewritten by Task 15, not here.
- Test: `php tools/test_write_ahead_puro.php` and `php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate` (prefix with `WA_PUERTO_OFFSET=100` if the ports are busy).

**Interfaces:**
- Consumes:
  - Task 1 (merged tree): `emitirFacturaEcf(array $input, facturaModel $facturaModel, clientModel $clientModel, ?int $reenvioDe = null): void` and `handleEmisionECF` calling it; master's `handleReenviar(int $facturaId, facturaModel $facturaModel, clientModel $clientModel): void`, `armarInputReenvio(array $f, array $guardadas, ?int $userId): array`, `campoXmlReenvio(string $xml, string $tag): string`; `facturaModel::tomarLockReenvio(int $facturaId): bool` and `facturaModel::archivarRechazoReenviado(int $facturaId): void`; `inventoryModel::devolverSaldoDeFactura(int $facturaId, ?int $userId = null): int`.
  - Release 1: `inventarioModelo(): inventoryModel` (controller), `EstadosEcf::SIN_VEREDICTO`, `facturaModel::reservarFacturaECF` (archives a `REINTENTABLES` row with the same e-NCF), `ncfModel::listRanges(?string $ambiente = null, ?string $type = null): array` (rows with `numero_desde`, `numero_hasta`, `fecha_vencimiento`, `estado`).
- Produces:
  - `const FACTURA_REENVIO_SIN_CONFIRMAR` (`%s` = the e-NCF), `function vencimientoDeLaSecuencia(string $eNcf, string $ambiente): ?string`, `function cerrarReenvioRechazado(int $reenvioDe, int $userId, facturaModel $facturaModel): void`.
  - The HTTP contract of `POST /api/facturas/{id}/reenviar` (Task 12 builds the front on it):

    | Case | Answer |
    |---|---|
    | candado de reenvio tomado | `409` `Este comprobante ya se está reenviando. Espera unos segundos y actualiza.` |
    | no existe | `404` |
    | no es e-CF (`tipo_ecf` vacío) | `422` `Solo se pueden reenviar comprobantes electrónicos.` |
    | ya archivada (`..._ARCHIVADO`) | `409` `Este comprobante ya se reenvió. Búscalo en el listado de facturas.` |
    | **sin confirmar** (`EstadosEcf::SIN_VEREDICTO`, `PENDIENTE_ENVIO` and `ENVIO_INCIERTO` included) | `409` `FACTURA_REENVIO_SIN_CONFIRMAR`, nothing sent to the DGII, nothing written |
    | no es `RECHAZADO`, `RFCE_RECHAZADO` ni `NO_ENCONTRADO` (por ejemplo `ACEPTADO`) | `409` `Solo se puede reenviar un comprobante que la DGII rechazó.` |
    | `secuencia_utilizada = 1` | `409` `La DGII consumió el e-NCF...` |
    | otro ambiente | `409` |
    | sin líneas guardadas | `422` `No se encontraron las líneas de esta factura, así que no se puede reenviar. Avisa a soporte.` |
    | sin e-NCF guardado (new) | `422` `No se encontró el número de comprobante (e-NCF) de esta factura, así que no se puede reenviar. Avisa a soporte.` |
    | todo en orden | the answers of `POST /api/facturas`: `200 {status:true, data:{...the 10 keys..., reenvio_de}}`; `422 {status:false, error, data}` if the DGII rejects again; `502 {status:false, error, data:{factura_id, e_ncf, tipo_ecf, estado_dgii}}` if it stays unconfirmed (the new row exists, the old one is already archived). |

- [ ] **Step 0: Check the merged state**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
grep -n "^function handleReenviar\|^function armarInputReenvio\|^function campoXmlReenvio\|^function emitirFacturaEcf\|^function inventarioModelo\|^function cerrarReenvioRechazado\|^function vencimientoDeLaSecuencia" src/Controllers/facturaController.php
grep -n "reenvioDe\|reenvio_de\|handleReenviar(" src/Controllers/facturaController.php
grep -n "function tomarLockReenvio\|function archivarRechazoReenviado" src/Models/facturaModel.php
grep -n "function devolverSaldoDeFactura\|function yaMovioDocumento" src/Models/inventoryModel.php
grep -rn "saveFacturaConECF" src
```

Expected:
- `git status --short`: only the untracked `tools/reconstruir_e340000000001.sql`;
- the first `grep`: `handleReenviar`, `armarInputReenvio`, `campoXmlReenvio`, `emitirFacturaEcf` and `inventarioModelo`; **not** `cerrarReenvioRechazado` or `vencimientoDeLaSecuencia`;
- the second `grep`: exactly four lines: the `@param ?int $reenvioDe` line of the `emitirFacturaEcf` docblock, its signature, the router call `handleReenviar((int) $reenviarMatches[1], $facturaModel, $clientModel);` and the `function handleReenviar(` definition. If it also lists `if ($reenvioDe !== null) {` blocks inside `emitirFacturaEcf` (calls to `archivarRechazoReenviado` or `devolverSaldoDeFactura`, or `$data['reenvio_de'] = ...`), Task 1 ported master's post-save code: delete exactly those blocks now; Step 4 puts the final ones in;
- the model `grep`s: both `facturaModel` methods and both `inventoryModel` methods;
- the last `grep` (only `src`: the docs that still name it are rewritten by Task 15) prints nothing. If it prints the docblock of `archivarRechazoReenviado` (master's comment names `saveFacturaConECF`), reword it to `...cuando el envio nuevo reuso su e-NCF, la reserva ya lo archivo y esto no hace nada.`

If a function of the first or third list is missing, Task 1 is incomplete: stop and report it.

- [ ] **Step 1: Write the failing DB-free tests (puro)**

(a) In `tools/test_write_ahead_puro.php`, rewrite the two decision-7 guards of the section `12) facturaController: GET /estado en vuelo y filtro pendiente`. Replace

```php
wa_chk('ninguna respuesta lleva puede_reenviar (decision 7)', !str_contains($s12Ctl, 'puede_reenviar'));
wa_chk('POST /reenviar sigue respondiendo 501 (decision 7)',
    (bool) preg_match('/function handleReenviar\(.*?\n\{\n\s*respond\(false, [^\n]*, 501\);\n\}/s', $s12Ctl));
```

with

```php
wa_chk('ninguna respuesta lleva puede_reenviar: el boton lo decide el front por el estado (decision 7, 10-12)', !str_contains($s12Ctl, 'puede_reenviar'));
wa_chk('POST /reenviar ya no es un stub 501: reemite una rechazada y nunca una sin confirmar (decision 7, 10-12)',
    !preg_match('/respond\(false, [^\n]*, 501\)/', $s12Ctl));
```

Same number of checks as before. If Task 1 already changed the extraction of these sections so that the text differs, keep its extraction and only change the two labels and the second condition as above.

(b) Insert this section directly above the closing block of the file (the line `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.` and the rule line above it), followed by one blank line:

```php
// ---------------------------------------------------------------------------
// Reenviar a la DGII sobre el write-ahead (Task 9). Texto del controlador, como en las secciones 11 y 12:
// una rechazada se reemite con su mismo e-NCF y nunca se reenvia una sin confirmar (decision 7, 10-12).
// ---------------------------------------------------------------------------
echo "\n== Reenviar a la DGII sobre el write-ahead ==\n";
$t9Ctl = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../src/Controllers/facturaController.php'));
$t9Fn = static fn(string $nombre): string
    => preg_match('/\nfunction ' . $nombre . '\(.*?\n\}\n/s', $t9Ctl, $m) ? $m[0] : '';
$t9Reenviar = $t9Fn('handleReenviar');
$t9Emitir = $t9Fn('emitirFacturaEcf');
$t9Armar = $t9Fn('armarInputReenvio');
$t9Cerrar = $t9Fn('cerrarReenvioRechazado');
wa_chk('FACTURA_REENVIO_SIN_CONFIRMAR es el texto del 409, letra por letra',
    preg_match("/\nconst FACTURA_REENVIO_SIN_CONFIRMAR = '([^']*)';/", $t9Ctl, $m) === 1
    && $m[1] === 'Este comprobante todavía no tiene respuesta de la DGII, así que no se puede reenviar desde aquí. '
        . 'No lo emitas de nuevo; avisa a soporte con el número %s.', $m[1] ?? null);
wa_chk('handleReenviar toma el candado antes de leer la factura',
    str_contains($t9Reenviar, 'function handleReenviar(int $facturaId, facturaModel $facturaModel, clientModel $clientModel): void')
    && strpos($t9Reenviar, 'tomarLockReenvio(') !== false && strpos($t9Reenviar, 'tomarLockReenvio(') < strpos($t9Reenviar, 'getFacturas('));
wa_chk('handleReenviar conserva las condiciones de master: solo e-CF, rechazada sin archivar, secuencia no consumida, mismo ambiente, con lineas',
    str_contains($t9Reenviar, "empty(\$f['tipo_ecf'])") && str_contains($t9Reenviar, "str_ends_with(\$estado, '_ARCHIVADO')")
    && str_contains($t9Reenviar, "['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO']") && str_contains($t9Reenviar, "'secuencia_utilizada'")
    && str_contains($t9Reenviar, 'AmbienteResolver::active()') && str_contains($t9Reenviar, 'getFacturaItems('));
wa_chk('un comprobante sin confirmar se rechaza (409) antes de emitir: EstadosEcf::SIN_VEREDICTO va antes de emitirFacturaEcf',
    strpos($t9Reenviar, 'EstadosEcf::SIN_VEREDICTO') !== false
    && strpos($t9Reenviar, 'EstadosEcf::SIN_VEREDICTO') < strpos($t9Reenviar, 'emitirFacturaEcf(')
    && str_contains($t9Reenviar, 'sprintf(FACTURA_REENVIO_SIN_CONFIRMAR'));
wa_chk('handleReenviar reemite por emitirFacturaEcf con $facturaId como reenvioDe',
    str_contains($t9Reenviar, 'emitirFacturaEcf($input, $facturaModel, $clientModel, $facturaId);'));
wa_chk('el input lleva el e-NCF de la rechazada y el vencimiento del rango que lo cubre',
    str_contains($t9Armar, "'e_ncf' => (string) \$f['e_ncf'],")
    && str_contains($t9Reenviar, 'vencimientoDeLaSecuencia((string) $f[\'e_ncf\']')
    && str_contains($t9Reenviar, "\$input['fecha_vencimiento_secuencia'] = \$vence;")
    && str_contains($t9Fn('vencimientoDeLaSecuencia'), '->listRanges('));
wa_chk('ya no hay un stub 501 en ningun lugar del controlador', !preg_match('/respond\(false, [^\n]*, 501\)/', $t9Ctl));
wa_chk('emitirFacturaEcf cierra el reenvio con la fila nueva guardada, en el camino normal y en el 502 incierto',
    substr_count($t9Emitir, 'cerrarReenvioRechazado($reenvioDe, $userId, $facturaModel);') === 2
    && str_contains($t9Emitir, "\$data['reenvio_de'] = \$reenvioDe;"));
wa_chk('archivarRechazoReenviado y devolverSaldoDeFactura solo se llaman desde cerrarReenvioRechazado',
    substr_count($t9Ctl, '->archivarRechazoReenviado(') === 1 && substr_count($t9Ctl, '->devolverSaldoDeFactura(') === 1
    && str_contains($t9Cerrar, '->archivarRechazoReenviado($reenvioDe)') && str_contains($t9Cerrar, '->devolverSaldoDeFactura($reenvioDe, $userId)'));
wa_chk('el controlador sigue sin saveFacturaConECF', !str_contains($t9Ctl, 'saveFacturaConECF'));
wa_chk('emitirFacturaEcf emite una sola vez: el reenvio no reintenta por su cuenta', substr_count($t9Emitir, '->emitir(') === 1);
```

- [ ] **Step 2: Write the failing API scenarios**

(a) In `tools/test_write_ahead_api.php`, rename the label of the existing check (same condition):

```php
wa_chk('sin campo de reenvio (decision 7)', !array_key_exists('puede_reenviar', $d), $d);
```

to

```php
wa_chk('sin campo puede_reenviar: el boton lo decide el front por el estado', !array_key_exists('puede_reenviar', $d), $d);
```

(b) Insert this block directly above the closing lines of the file:

```php
wa_mock_modo($srv['mock'], 'acepta');
wa_fin();
```

It uses `wa_reiniciar`, `wa_emitir`, `wa_factura`, `wa_linea`, `wa_filas`, `wa_movimientos`, `wa_contador`, `wa_recepciones` and `wa_fila_sembrada`, all defined earlier in the same file or in the lib, and the `$base`, `$pdo` and `$srv` of its header:

```php
// ===========================================================================
// Task 9: POST /api/facturas/{id}/reenviar sobre el write-ahead. Una RECHAZADA se
// reemite con el mismo e-NCF; una factura sin confirmar nunca se reenvia (decision 7,
// redefinida el 10-12).
// ===========================================================================

// Textos de facturaController.php, letra por letra (FACTURA_REENVIO_SIN_CONFIRMAR y los de handleReenviar).
const T_REENVIO_SIN_CONFIRMAR = 'Este comprobante todavía no tiene respuesta de la DGII, así que no se puede reenviar desde aquí. No lo emitas de nuevo; avisa a soporte con el número %s.';
const T_REENVIO_SOLO_RECHAZADO = 'Solo se puede reenviar un comprobante que la DGII rechazó.';
const T_REENVIO_YA_REENVIADO = 'Este comprobante ya se reenvió. Búscalo en el listado de facturas.';
const T_REENVIO_CONSUMIDO = 'La DGII consumió el e-NCF de este comprobante, así que no se puede reenviar con el mismo número. Emítelo de nuevo desde Nueva factura.';
const T_REENVIO_EN_CURSO = 'Este comprobante ya se está reenviando. Espera unos segundos y actualiza.';
const T_REENVIO_SIN_NUMERO = 'No se encontró el número de comprobante (e-NCF) de esta factura, así que no se puede reenviar. Avisa a soporte.';
const T_REENVIO_SIN_LINEAS = 'No se encontraron las líneas de esta factura, así que no se puede reenviar. Avisa a soporte.';

/** POST /api/facturas/{id}/reenviar con el token de wa_prueba. */
function wa_reenviar_factura(array $srv, int $id): array
{
    return wa_http('POST', $srv['api'] . "/api/facturas/{$id}/reenviar", [], ['X-API-KEY: ' . $srv['token']], 60);
}

/** Suma de cantidades de los movimientos de inventario de una factura: 0 = nada movido, o ya devuelto. */
function wa_saldo_inventario(PDO $pdo, int $facturaId): float
{
    $st = $pdo->prepare("SELECT COALESCE(SUM(cantidad), 0) FROM inventory_movements WHERE referencia_tipo = 'factura' AND referencia_id = :id");
    $st->execute([':id' => $facturaId]);
    return round((float) $st->fetchColumn(), 3);
}

echo "RV1) Reenviar una E31 rechazada: mismo e-NCF, la rechazada se archiva\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza');
$cuerpo = wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]);
$r = wa_emitir($srv, $cuerpo);
$d1 = $r['json']['data'] ?? [];
$eNcf = (string) ($d1['e_ncf'] ?? '');
$idRechazada = (int) ($d1['factura_id'] ?? 0);
wa_chk('precondicion: 422, fila RECHAZADO y el numero vuelve al contador',
    $r['status'] === 422 && (wa_filas($pdo, $eNcf)[0]['estado_dgii'] ?? null) === 'RECHAZADO' && wa_contador($pdo, 'E31') === 0, $r);
wa_mock_modo($srv['mock'], 'acepta');
wa_mock_log($srv['mock'], true);
$r = wa_reenviar_factura($srv, $idRechazada);
$d2 = $r['json']['data'] ?? [];
wa_chk('200 con status true', $r['status'] === 200 && ($r['json']['status'] ?? null) === true, $r);
wa_chk('mismo e-NCF y reenvio_de = la rechazada', ($d2['e_ncf'] ?? null) === $eNcf && ($d2['reenvio_de'] ?? null) === $idRechazada
    && ($d2['factura_id'] ?? $idRechazada) !== $idRechazada, [$d1, $d2]);
wa_chk('ACEPTADO con el track_id del mock', ($d2['estado_dgii'] ?? null) === 'ACEPTADO' && ($d2['track_id'] ?? null) === 'track-' . $eNcf, $d2);
$filas = wa_filas($pdo, $eNcf);
wa_chk('la rechazada queda RECHAZADO_ARCHIVADO sin e_ncf y la nueva ACEPTADO',
    count($filas) === 2 && (int) $filas[0]['id'] === $idRechazada && $filas[0]['estado_dgii'] === 'RECHAZADO_ARCHIVADO'
    && $filas[0]['e_ncf'] === null && (int) $filas[1]['id'] === (int) ($d2['factura_id'] ?? 0) && $filas[1]['estado_dgii'] === 'ACEPTADO', $filas);
wa_chk('el stock lo mueve solo la fila nueva',
    wa_movimientos($pdo, $idRechazada) === 0 && wa_movimientos($pdo, (int) ($d2['factura_id'] ?? 0)) === 1);
wa_chk('una sola recepcion en la DGII', count(wa_recepciones(wa_mock_log($srv['mock']))) === 1);
wa_chk('el contador no se movio: el numero reenviado no sale del contador', wa_contador($pdo, 'E31') === 0, wa_contador($pdo, 'E31'));
$r = wa_emitir($srv, $cuerpo);
wa_chk('el siguiente comprobante salta el numero ocupado', $r['status'] === 200 && ($r['json']['data']['e_ncf'] ?? null) === 'E310000000002', $r);
$r = wa_reenviar_factura($srv, $idRechazada);
wa_chk('reenviar la ya archivada: 409', $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_YA_REENVIADO, $r);
$r = wa_reenviar_factura($srv, (int) ($d2['factura_id'] ?? 0));
wa_chk('reenviar la ACEPTADO: 409', $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_SOLO_RECHAZADO, $r);

echo "RV2) Una factura sin confirmar nunca se reenvia desde la app\n";
$ids = wa_reiniciar($pdo, $srv, 'cuelga');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d = $r['json']['data'] ?? [];
$eNcf = (string) ($d['e_ncf'] ?? '');
wa_chk('precondicion: 502 incierto, fila ENVIO_INCIERTO', $r['status'] === 502 && ($d['estado_dgii'] ?? null) === 'ENVIO_INCIERTO', $r);
wa_mock_modo($srv['mock'], 'acepta');   // espera a que termine el cuelga
wa_mock_log($srv['mock'], true);
$antes = [wa_filas($pdo, $eNcf), wa_contador($pdo, 'E31')];
$r = wa_reenviar_factura($srv, (int) ($d['factura_id'] ?? 0));
wa_chk('ENVIO_INCIERTO: 409 con el texto de sin confirmar',
    $r['status'] === 409 && ($r['json']['error'] ?? null) === sprintf(T_REENVIO_SIN_CONFIRMAR, $eNcf), $r);
wa_chk('la fila y el contador no cambiaron', [wa_filas($pdo, $eNcf), wa_contador($pdo, 'E31')] === $antes);
$sembradas = [
    ['PENDIENTE_ENVIO', 'E310000000921', null], ['ENVIADO', 'E310000000922', null], ['ENVIADO', 'E310000000923', 'track-E310000000923'],
    ['EN_PROCESO', 'E310000000924', 'track-E310000000924'], ['RFCE_ENVIADO', 'E320000000925', null], ['RFCE_EN_PROCESO', 'E320000000926', null],
];
$obtenidos = [];
foreach ($sembradas as [$estado, $encfSembrado, $track]) {
    $idSembrada = wa_fila_sembrada($pdo, $ids, $encfSembrado, $estado, $track, 1);
    $rr = wa_reenviar_factura($srv, $idSembrada);
    $obtenidos[$estado . ' ' . $encfSembrado] = [$rr['status'], $rr['json']['error'] ?? null];
}
$esperados = [];
foreach ($sembradas as [$estado, $encfSembrado]) {
    $esperados[$estado . ' ' . $encfSembrado] = [409, sprintf(T_REENVIO_SIN_CONFIRMAR, $encfSembrado)];
}
wa_chk('PENDIENTE_ENVIO, ENVIADO (con y sin track), EN_PROCESO, RFCE_ENVIADO y RFCE_EN_PROCESO: todas 409 con el mismo texto', $obtenidos === $esperados, $obtenidos);
$idAceptada = wa_fila_sembrada($pdo, $ids, 'E310000000927', 'ACEPTADO', 'track-E310000000927', 1);
$r = wa_reenviar_factura($srv, $idAceptada);
wa_chk('una ACEPTADO tampoco: 409 con el texto de solo rechazadas', $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_SOLO_RECHAZADO, $r);
wa_chk('ninguna de las ocho llego a la DGII', wa_mock_log($srv['mock']) === []);

echo "RV3) Una rechazada cuyo numero la DGII consumio no se reenvia\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza_usada');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d = $r['json']['data'] ?? [];
wa_chk('precondicion: 422 con la fila RECHAZADO y secuencia_utilizada 1',
    $r['status'] === 422 && (string) (wa_filas($pdo, (string) ($d['e_ncf'] ?? ''))[0]['secuencia_utilizada'] ?? '') === '1', $r);
$r = wa_reenviar_factura($srv, (int) ($d['factura_id'] ?? 0));
wa_chk('409 "La DGII consumió el e-NCF"', $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_CONSUMIDO, $r);

echo "RV4) El saldo de inventario de la rechazada se devuelve\n";
$ids = wa_reiniciar($pdo, $srv, 'acepta');
// Una rechazada que ya habia movido mercancia (una venta del POS, o una fila anterior a Release 1).
$idVieja = wa_fila_sembrada($pdo, $ids, 'E310000000930', 'RECHAZADO', 'track-E310000000930', 1);
$almacen = (int) $pdo->query('SELECT warehouse_id FROM products WHERE id = ' . (int) $ids['product_id'])->fetchColumn();
$pdo->prepare("INSERT INTO inventory_movements (product_id, warehouse_id, tipo_movimiento, referencia_tipo, referencia_id, cantidad, cantidad_anterior, cantidad_nueva)
               VALUES (:p, :w, 'VENTA', 'factura', :f, -1.000, 1000.000, 999.000)")
    ->execute([':p' => $ids['product_id'], ':w' => $almacen, ':f' => $idVieja]);
$r = wa_reenviar_factura($srv, $idVieja);
$d = $r['json']['data'] ?? [];
wa_chk('200 con el mismo e-NCF y reenvio_de', $r['status'] === 200 && ($d['e_ncf'] ?? null) === 'E310000000930' && ($d['reenvio_de'] ?? null) === $idVieja, $r);
wa_chk('el saldo de la vieja queda en 0 y la nueva descuenta una vez',
    wa_saldo_inventario($pdo, $idVieja) === 0.0 && wa_saldo_inventario($pdo, (int) ($d['factura_id'] ?? 0)) === -1.0,
    [wa_saldo_inventario($pdo, $idVieja), wa_saldo_inventario($pdo, (int) ($d['factura_id'] ?? 0))]);
wa_chk('la vieja quedo RECHAZADO_ARCHIVADO', (wa_filas($pdo, 'E310000000930')[0]['estado_dgii'] ?? null) === 'RECHAZADO_ARCHIVADO', wa_filas($pdo, 'E310000000930'));

echo "RV5) El XML lleva el vencimiento del rango, no el de emisor_config\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d = $r['json']['data'] ?? [];
$xmlDe = static function (int $id) use ($pdo): string {
    $st = $pdo->prepare('SELECT xml_firmado FROM facturas WHERE id = :id');
    $st->execute([':id' => $id]);
    return (string) $st->fetchColumn();
};
$etiqueta = static fn(string $fecha): string => '<FechaVencimientoSecuencia>' . $fecha . '</FechaVencimientoSecuencia>';
wa_chk('precondicion: la rechazada llevo el vencimiento que sembro wa_sembrar (dentro de un ano)',
    str_contains($xmlDe((int) ($d['factura_id'] ?? 0)), $etiqueta(date('d-m-Y', strtotime('+1 year')))));
// El admin corrige la fecha del rango.
$pdo->prepare("UPDATE ncf_sequences SET fecha_vencimiento = :v WHERE type = 'E31' AND ambiente = 'certecf'")
    ->execute([':v' => date('Y-m-d', strtotime('+2 years'))]);
wa_mock_modo($srv['mock'], 'acepta');
$r = wa_reenviar_factura($srv, (int) ($d['factura_id'] ?? 0));
wa_chk('200', $r['status'] === 200, $r);
wa_chk('el XML de la fila nueva lleva el vencimiento corregido del rango',
    str_contains($xmlDe((int) ($r['json']['data']['factura_id'] ?? 0)), $etiqueta(date('d-m-Y', strtotime('+2 years')))));

echo "RV6) Las condiciones de master: candado, 404, otro ambiente, solo e-CF, e-NCF y lineas guardadas\n";
$ids = wa_reiniciar($pdo, $srv, 'acepta');
$idLock = wa_fila_sembrada($pdo, $ids, 'E310000000940', 'RECHAZADO', 'track-E310000000940', 1);
$otraConexion = wa_pdo($base);
$st = $otraConexion->prepare("SELECT GET_LOCK(CONCAT(DATABASE(), ':reenvio_ecf:', :id), 0)");
$st->execute([':id' => $idLock]);
$r = wa_reenviar_factura($srv, $idLock);
wa_chk('con el candado de reenvio tomado por otra conexion: 409 y la DGII no recibe nada',
    $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_EN_CURSO && wa_mock_log($srv['mock']) === [], $r);
$otraConexion->prepare("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':reenvio_ecf:', :id))")->execute([':id' => $idLock]);
$r = wa_reenviar_factura($srv, $idLock);
wa_chk('soltado el candado la misma factura se reenvia: 200', $r['status'] === 200 && ($r['json']['data']['e_ncf'] ?? null) === 'E310000000940', $r);
$r = wa_reenviar_factura($srv, 999999);
wa_chk('una factura que no existe: 404', $r['status'] === 404, $r);
$idOtroAmbiente = wa_fila_sembrada($pdo, $ids, 'E310000000941', 'RECHAZADO', 'track-E310000000941', 1);
$pdo->prepare("UPDATE facturas SET ambiente_dgii = 'ecf' WHERE id = :id")->execute([':id' => $idOtroAmbiente]);
$r = wa_reenviar_factura($srv, $idOtroAmbiente);
wa_chk('rechazada en otro ambiente: 409', $r['status'] === 409 && str_contains((string) ($r['json']['error'] ?? ''), 'otro ambiente'), $r);
$idSinNumero = wa_fila_sembrada($pdo, $ids, 'E310000000942', 'RECHAZADO', 'track-E310000000942', 1);
$pdo->prepare('UPDATE facturas SET e_ncf = NULL WHERE id = :id')->execute([':id' => $idSinNumero]);
wa_mock_log($srv['mock'], true);
$r = wa_reenviar_factura($srv, $idSinNumero);
wa_chk('una rechazada sin e-NCF guardado: 422, no dispensa otro numero y no llega a la DGII',
    $r['status'] === 422 && ($r['json']['error'] ?? null) === T_REENVIO_SIN_NUMERO && wa_contador($pdo, 'E31') === 0 && wa_mock_log($srv['mock']) === [],
    [$r, wa_contador($pdo, 'E31')]);
$idSinLineas = wa_fila_sembrada($pdo, $ids, 'E310000000943', 'RECHAZADO', 'track-E310000000943');
$r = wa_reenviar_factura($srv, $idSinLineas);
wa_chk('una rechazada sin lineas guardadas: 422, sigue RECHAZADO y no llega a la DGII',
    $r['status'] === 422 && ($r['json']['error'] ?? null) === T_REENVIO_SIN_LINEAS
    && (wa_filas($pdo, 'E310000000943')[0]['estado_dgii'] ?? null) === 'RECHAZADO' && wa_mock_log($srv['mock']) === [], $r);
$pdo->exec("INSERT INTO facturas (no_factura, date, client_name, total, tipo_pago, estado_dgii) VALUES ('FS-WA-0001', NOW(), 'WA cliente', 100.00, 1, 'PENDIENTE')");
$r = wa_reenviar_factura($srv, (int) $pdo->lastInsertId());
wa_chk('una factura simple (sin tipo_ecf): 422', $r['status'] === 422 && ($r['json']['error'] ?? null) === 'Solo se pueden reenviar comprobantes electrónicos.', $r);

echo "RV7) Si el reenvio queda sin confirmar, la rechazada ya esta archivada\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza');
$r = wa_emitir($srv, wa_factura('31', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d1 = $r['json']['data'] ?? [];
$eNcf = (string) ($d1['e_ncf'] ?? '');
wa_mock_modo($srv['mock'], 'cuelga');
$r = wa_reenviar_factura($srv, (int) ($d1['factura_id'] ?? 0));
$d2 = $r['json']['data'] ?? [];
wa_chk('502 incierto con la fila nueva y el mismo e-NCF',
    $r['status'] === 502 && ($d2['e_ncf'] ?? null) === $eNcf && ($d2['estado_dgii'] ?? null) === 'ENVIO_INCIERTO'
    && is_int($d2['factura_id'] ?? null) && $d2['factura_id'] !== $d1['factura_id'], $r);
$filas = wa_filas($pdo, $eNcf);
wa_chk('la rechazada quedo RECHAZADO_ARCHIVADO y la nueva ENVIO_INCIERTO',
    count($filas) === 2 && $filas[0]['estado_dgii'] === 'RECHAZADO_ARCHIVADO' && $filas[1]['estado_dgii'] === 'ENVIO_INCIERTO', $filas);
wa_mock_modo($srv['mock'], 'acepta');   // espera a que termine el cuelga
$r = wa_reenviar_factura($srv, (int) ($d1['factura_id'] ?? 0));
$r2 = wa_reenviar_factura($srv, (int) ($d2['factura_id'] ?? 0));
wa_chk('ni la archivada ni la sin confirmar se reenvian otra vez: 409 las dos',
    $r['status'] === 409 && ($r['json']['error'] ?? null) === T_REENVIO_YA_REENVIADO
    && $r2['status'] === 409 && ($r2['json']['error'] ?? null) === sprintf(T_REENVIO_SIN_CONFIRMAR, $eNcf), [$r, $r2]);

echo "RV8) El flujo RFCE: una E32 menor de 250k rechazada se reenvia con su mismo e-NCF\n";
$ids = wa_reiniciar($pdo, $srv, 'rechaza');
$r = wa_emitir($srv, wa_factura('32', $ids, [wa_linea(1000, 1, $ids['product_id'])]));
$d1 = $r['json']['data'] ?? [];
wa_chk('precondicion: 422 con la fila RFCE_RECHAZADO', $r['status'] === 422 && ($d1['estado_dgii'] ?? null) === 'RFCE_RECHAZADO', $r);
wa_mock_modo($srv['mock'], 'acepta');
$r = wa_reenviar_factura($srv, (int) ($d1['factura_id'] ?? 0));
$d2 = $r['json']['data'] ?? [];
wa_chk('200: RFCE_ACEPTADO con el mismo e-NCF, reenvio_de y la rechazada archivada',
    $r['status'] === 200 && ($d2['e_ncf'] ?? null) === ($d1['e_ncf'] ?? '-') && ($d2['estado_dgii'] ?? null) === 'RFCE_ACEPTADO'
    && ($d2['reenvio_de'] ?? null) === ($d1['factura_id'] ?? 0)
    && (wa_filas($pdo, (string) ($d1['e_ncf'] ?? ''))[0]['estado_dgii'] ?? null) === 'RFCE_RECHAZADO_ARCHIVADO', [$r, wa_filas($pdo, (string) ($d1['e_ncf'] ?? ''))]);
```

- [ ] **Step 3: Run both and watch them fail**

```bash
php -l tools/test_write_ahead_puro.php && php -l tools/test_write_ahead_api.php
php tools/test_write_ahead_puro.php | sed -n '/== Reenviar a la DGII/,$p'
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | grep -E "FALLO|RV[0-9]\)|pruebas OK"
```

Expected:
- puro: in the new section exactly six `[FALLO]` lines: `FACTURA_REENVIO_SIN_CONFIRMAR es el texto...`, `un comprobante sin confirmar se rechaza (409)...`, `handleReenviar reemite por emitirFacturaEcf con $facturaId...`, `el input lleva el e-NCF de la rechazada...`, `emitirFacturaEcf cierra el reenvio...` and `archivarRechazoReenviado y devolverSaldoDeFactura solo se llaman desde...`; the other five checks of the section pass, and so do the two rewritten guards of section 12. (Other `[FALLO]` lines can show up above the new section, in sections 11 and 13: section 11 if the Task 1 merge left its extractor reading `handleEmisionECF` instead of `emitirFacturaEcf`, section 13 for the `saveFacturaConECF` guard until Task 15 rewrites the docs that still name it. They are not caused by this task.)
- API: with master's `handleReenviar` as merged (it re-dispenses instead of using the override and knows nothing of unconfirmed rows) these fail, among others: RV1 `mismo e-NCF y reenvio_de = la rechazada` and `el contador no se movio...` (the counter is 1: the number was re-dispensed); RV2 `ENVIO_INCIERTO: 409 con el texto de sin confirmar` (the answer is `Solo se puede reenviar un comprobante que la DGII rechazó.`) and the six-state check; RV4 all three (no `reenvio_de`, saldo `[-1,-1]`, the old row not archived because the new number was another one); RV6 `soltado el candado la misma factura se reenvia: 200` (the e-NCF is `E310000000001`, not `E310000000940`) and `una rechazada sin e-NCF guardado...` (it answers 200 with a new number); RV7 `ni la archivada ni la sin confirmar...`; RV8 `200: RFCE_ACEPTADO con el mismo e-NCF, reenvio_de...` (no `reenvio_de` in the answer) unless Task 1 already ported that key. RV3 and RV5 can pass before the change: RV5 only fails once the override is in and the vencimiento lookup is missing, which is why Step 4 adds both together.

- [ ] **Step 4: Implement the controller changes**

Apply these edits to `src/Controllers/facturaController.php` with the Edit tool, one after the other. Each `old` text must be found exactly once; if it is not, re-read the file around the anchor (Task 1 may have moved a comment) and keep the `new` text. The file may be CRLF on disk: the Edit tool keeps it.

**Edit 1: new constant, before the comment of `FACTURA_ESTADOS_ACEPTADOS`.** Replace

```php
// Estados en que la DGII acepto el comprobante: el primer paso a uno de estos
// desde la consulta de estado mueve el stock (una sola vez).
```

with

```php
// POST /api/facturas/{id}/reenviar sobre un comprobante SIN confirmar (PENDIENTE_ENVIO, ENVIO_INCIERTO,
// ENVIADO, EN_PROCESO y sus RFCE_). Decision 7, redefinida el 10-12: la app nunca reenvia uno sin confirmar,
// porque la DGII pudo haberlo recibido; solo reemite uno RECHAZADO. %s = el e-NCF.
const FACTURA_REENVIO_SIN_CONFIRMAR = 'Este comprobante todavía no tiene respuesta de la DGII, así que no se puede reenviar desde aquí. No lo emitas de nuevo; avisa a soporte con el número %s.';

// Estados en que la DGII acepto el comprobante: el primer paso a uno de estos
// desde la consulta de estado mueve el stock (una sola vez).
```

**Edit 2: Release 1 comment of the e-NCF notes: the decision-7 wording.** Replace

```php
// app no puede consultar (spec 7.3, Release 1). %s = el e-NCF. Decision 7: la
// app nunca reenvia un e-CF; la nota manda a soporte y pide no emitirlo de nuevo.
```

with

```php
// app no puede consultar (spec 7.3, Release 1). %s = el e-NCF. Decision 7: la
// app nunca reenvia un comprobante sin confirmar; la nota manda a soporte y pide
// no emitirlo de nuevo.
```

**Edit 3: Release 1 docblock of `handleEstadoEnVuelo`: the decision-7 wording.** Replace

```php
 * (spec 7.3). No ofrece ningun reenvio: la app nunca reenvia (decision 7).
```

with

```php
 * (spec 7.3). No ofrece ningun reenvio: la app nunca reenvia un comprobante sin
 * confirmar (decision 7).
```

**Edit 4: docblock of `handleReenviar`.** Replace

```php
/**
 * POST /api/facturas/{id}/reenviar — vuelve a enviar a la DGII un e-CF que
 * rechazo SIN consumir la secuencia (p.ej. cod. 145, fecha de vencimiento de
 * la secuencia invalida): corregido el dato, el comprobante sale otra vez con
 * el mismo e-NCF, que ECFEmissionService ya habia devuelto al contador.
 *
 * Arma el mismo body que manda el front al emitir y lo pasa por
 * emitirFacturaEcf: mismas validaciones, mismo guardado. Las lineas salen del
 * XML firmado (nombre, descripcion, cantidad, precio y descuento tal como se
 * enviaron) completadas con lo que el XML no trae y la base si (producto,
 * unidad, indicadores). Cliente y emisor se leen de nuevo: si el rechazo era
 * por un dato del cliente, la correccion ya entra.
 */
```

with

```php
/**
 * POST /api/facturas/{id}/reenviar — vuelve a emitir un e-CF que la DGII RECHAZO
 * (p.ej. cod. 145, fecha de vencimiento de la secuencia invalida): corregido el
 * dato, el comprobante sale otra vez con el MISMO e-NCF. Nunca reenvia uno sin
 * confirmar (decision 7, redefinida el 10-12): la DGII pudo haberlo recibido, y
 * esos los resuelve soporte.
 *
 * Arma el mismo body que manda el front al emitir, con 'e_ncf' = el de la
 * rechazada, y lo pasa por emitirFacturaEcf: mismas validaciones y el mismo
 * write-ahead (guardar, enviar, anotar). La reserva archiva la rechazada con la
 * regla de reintentables de reservarFacturaECF. Las lineas salen del XML firmado
 * (nombre, descripcion, cantidad, precio y descuento tal como se enviaron)
 * completadas con lo que el XML no trae y la base si (producto, unidad,
 * indicadores). Cliente y emisor se leen de nuevo: si el rechazo era por un dato
 * del cliente, la correccion ya entra.
 */
```

**Edit 5: `handleReenviar`: an unconfirmed comprobante is never resent.** Replace

```php
    if (!in_array($estado, ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'], true)) {
        respond(false, 'Solo se puede reenviar un comprobante que la DGII rechazó.', 409);
        return;
    }
```

with

```php
    // Decision 7: un comprobante sin confirmar nunca se reenvia desde la app.
    if (in_array($estado, EstadosEcf::SIN_VEREDICTO, true)) {
        respond(false, sprintf(FACTURA_REENVIO_SIN_CONFIRMAR, (string) ($f['e_ncf'] ?? '')), 409);
        return;
    }
    if (!in_array($estado, ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'], true)) {
        respond(false, 'Solo se puede reenviar un comprobante que la DGII rechazó.', 409);
        return;
    }
```

**Edit 6: `handleReenviar`: same e-NCF and the vencimiento of its range; new function `vencimientoDeLaSecuencia`.** Replace

```php
    emitirFacturaEcf(
        armarInputReenvio($f, $guardadas, RequestContext::userId()),
        $facturaModel,
        $clientModel,
        $facturaId
    );
}
```

with

```php
    // Mismo numero: una rechazada sin archivar siempre lo tiene.
    if (trim((string) ($f['e_ncf'] ?? '')) === '') {
        respond(false, 'No se encontró el número de comprobante (e-NCF) de esta factura, así que no se puede reenviar. Avisa a soporte.', 422);
        return;
    }
    $input = armarInputReenvio($f, $guardadas, RequestContext::userId());
    // Con el e-NCF dado, emitir() no dispensa un numero y por eso tampoco toma el vencimiento del rango que lo
    // dispensaria: se toma aqui del rango vigente que cubre el numero. Sin esto el XML llevaria el de
    // emisor_config y una rechazada por la fecha de la secuencia (cod. 145) saldria rechazada otra vez.
    $vence = vencimientoDeLaSecuencia((string) $f['e_ncf'], (string) ($f['ambiente_dgii'] ?? ''));
    if ($vence !== null) {
        $input['fecha_vencimiento_secuencia'] = $vence;
    }
    emitirFacturaEcf($input, $facturaModel, $clientModel, $facturaId);
}

/**
 * Vencimiento (Y-m-d) del rango autorizado y vigente que cubre un e-NCF, o null si ninguno lo cubre, el rango
 * no tiene vencimiento o ncf_sequences no se pudo leer (listRanges devuelve [] en ese caso): el XML usa entonces
 * el vencimiento de emisor_config, como siempre.
 */
function vencimientoDeLaSecuencia(string $eNcf, string $ambiente): ?string
{
    if ($ambiente === '' || !preg_match('/^(E\d{2})(\d{10})$/', $eNcf, $m)) {
        return null;
    }
    require_once __DIR__ . '/../Models/ncfModel.php';
    $valor = (int) $m[2];
    foreach ((new ncfModel())->listRanges($ambiente, $m[1]) as $rango) {
        $hasta = $rango['numero_hasta'] !== null ? (int) $rango['numero_hasta'] : null;
        if ((int) $rango['numero_desde'] <= $valor && ($hasta === null || $valor <= $hasta)
            && $rango['estado'] !== 'vencido' && !empty($rango['fecha_vencimiento'])) {
            return (string) $rango['fecha_vencimiento'];
        }
    }
    return null;
}
```

**Edit 7: `armarInputReenvio` carries the e-NCF.** Replace

```php
    $input = [
        'tipo_ecf' => (string) $f['tipo_ecf'],
        'client_id' => $f['client_id'] ?: null,
```

with

```php
    $input = [
        'tipo_ecf' => (string) $f['tipo_ecf'],
        // El mismo e-NCF de la rechazada: emitir() no dispensa uno nuevo y la reserva archiva la fila vieja.
        'e_ncf' => (string) $f['e_ncf'],
        'client_id' => $f['client_id'] ?: null,
```

**Edit 8: new function `cerrarReenvioRechazado`, before the docblock of `notaDeConsumoSinCliente`.** Replace

```php
/**
 * true si la nota apunta a una factura de consumo (E32) de esta base emitida
```

with

```php
/**
 * Cierra el reenvio de una rechazada (Reenviar a la DGII) cuando la fila nueva ya esta guardada: la vieja no debe
 * volver a ofrecerse ni dejar mercancia movida.
 *  - Archivo: la reserva ya archivo la rechazada (mismo e-NCF, regla REINTENTABLES de reservarFacturaECF);
 *    archivarRechazoReenviado es el respaldo y solo actua si sigue en rechazo.
 *  - Inventario: devolverSaldoDeFactura deshace lo que la rechazada haya movido (una venta del POS o una fila
 *    anterior a Release 1; la app no mueve stock en un rechazo, asi que suele ser 0). Repetirlo no duplica.
 * Nunca lanza: la fila nueva ya existe y un problema de inventario se corrige con un ajuste.
 */
function cerrarReenvioRechazado(int $reenvioDe, int $userId, facturaModel $facturaModel): void
{
    $facturaModel->archivarRechazoReenviado($reenvioDe);
    try {
        inventarioModelo()->devolverSaldoDeFactura($reenvioDe, $userId);
    } catch (Throwable $e) {
        error_log('[inventario] no se pudo devolver el saldo de la factura reenviada ' . $reenvioDe . ': ' . $e->getMessage());
    }
}

/**
 * true si la nota apunta a una factura de consumo (E32) de esta base emitida
```

**Edit 9: `emitirFacturaEcf`, 502 incierto branch (the new row already exists).** Replace

```php
            // respond() no lleva `data`: el front necesita factura_id para "Ver factura".
```

with

```php
            // Reenvio de una rechazada: la fila nueva ya esta guardada aunque el envio quede sin confirmar.
            if ($reenvioDe !== null) {
                cerrarReenvioRechazado($reenvioDe, $userId, $facturaModel);
            }
            // respond() no lleva `data`: el front necesita factura_id para "Ver factura".
```

**Edit 10: `emitirFacturaEcf`, normal path (the row is saved and confirmed).** Replace

```php
    // La fila ya esta guardada y confirmada: emitir() devuelve su factura_id.
    $facturaId = (int) $result['factura_id'];
```

with

```php
    // La fila ya esta guardada y confirmada: emitir() devuelve su factura_id.
    $facturaId = (int) $result['factura_id'];

    // Reenvio de una rechazada: la reserva ya archivo la vieja; falta devolverle su saldo de inventario.
    if ($reenvioDe !== null) {
        cerrarReenvioRechazado($reenvioDe, $userId, $facturaModel);
    }
```

**Edit 11: `emitirFacturaEcf`: the answer says whom it replaces.** Replace

```php
        'fecha_emision_dgii' => $result['fecha_emision_dgii'],
        'dgii_response' => $dgiiResp,
    ];
```

with

```php
        'fecha_emision_dgii' => $result['fecha_emision_dgii'],
        'dgii_response' => $dgiiResp,
    ];
    if ($reenvioDe !== null) {
        $data['reenvio_de'] = $reenvioDe;
    }
```

**Edit 12, in `src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php`: the Release 1 comment.** Replace

```php
 * fila. La app nunca reenvia el e-CF (decision 7): lo resuelve soporte.
```

with

```php
 * fila. La app nunca reenvia un comprobante sin confirmar (decision 7): lo resuelve soporte.
```

Then lint:

```bash
php -l src/Controllers/facturaController.php && php -l src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php
git ls-files --eol src/Controllers/facturaController.php
```

Expected: `No syntax errors detected` twice; the `--eol` line unchanged from before the edits.

- [ ] **Step 5: Update the `.http` scenarios**

In `tests/test_facturas_write_ahead.http` (CRLF on disk; the Edit tool keeps it):

(a) Replace

```
@facturaId = <factura_id que devolvio el paso anterior>
```

with

```
@facturaId = <factura_id que devolvio el paso anterior>
@facturaRechazada = <factura_id del 422 de un rechazo (mock en rechaza)>
```

(b) Replace the last scenario

```
### Decision 7: la app no reenvia -> POST /reenviar sigue respondiendo 501
POST {{base}}/api/facturas/{{facturaId}}/reenviar
X-API-KEY: {{token}}
```

with

```
### Reenviar (Task 9). Una factura SIN CONFIRMAR nunca se reenvia desde la app. {{facturaId}} = la de E3b
### (ENVIO_INCIERTO) -> 409 "Este comprobante todavía no tiene respuesta de la DGII, así que no se puede
### reenviar desde aquí. No lo emitas de nuevo; avisa a soporte con el número E31...". El mock no recibe nada.
POST {{base}}/api/facturas/{{facturaId}}/reenviar
X-API-KEY: {{token}}

### Reenviar una RECHAZADA (mock en rechaza y luego en acepta; {{facturaRechazada}} = factura_id del 422) -> 200,
### data.e_ncf igual al de la rechazada, data.reenvio_de = esa factura, estado_dgii ACEPTADO. En la base la
### rechazada queda RECHAZADO_ARCHIVADO con e_ncf NULL y la nueva ACEPTADO con ese e-NCF.
POST {{base}}/api/facturas/{{facturaRechazada}}/reenviar
X-API-KEY: {{token}}
```

- [ ] **Step 6: Run the tests until green**

Check that no other suite is running, then:

```bash
php tools/test_write_ahead_puro.php | sed -n '/== Reenviar a la DGII/,$p'
php tools/test_write_ahead_puro.php | tail -3
php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | grep -E "FALLO|RV[0-9]\)|pruebas OK"
```

Expected (run them one after the other, never in parallel):
- puro: the new section prints 11 `[OK  ]` lines and no `[FALLO]`, and section 12 prints none. The total is `N de N pruebas OK`, where `N` is the total before this task plus 11 (the two rewritten guards keep their count). If the total still shows `[FALLO]` lines, they must be the ones named in Step 3 (section 11 extractor from Task 1, section 13 docs guard until Task 15), not this task's.
- API: no `[FALLO]` line and `N de N pruebas OK` where `N` is the total before this task plus 37 (RV1 11, RV2 6, RV3 2, RV4 3, RV5 3, RV6 7, RV7 3, RV8 2); the `RV1)` ... `RV8)` headings appear in order.

- [ ] **Step 7: Commit**

```bash
git add src/Controllers/facturaController.php src/Utils/FacturacionElectronica/EcfEnvioInciertoException.php tools/test_write_ahead_puro.php tools/test_write_ahead_api.php tests/test_facturas_write_ahead.http
git commit -F - <<'EOF'
feat(facturas): Reenviar a la DGII reemite la rechazada con su mismo e-NCF

POST /api/facturas/{id}/reenviar conserva las condiciones de master (solo e-CF,
RECHAZADO/RFCE_RECHAZADO/NO_ENCONTRADO sin archivar, secuencia no consumida,
mismo ambiente, con lineas, un candado por factura) y reemite por la emision
write-ahead con 'e_ncf' = el de la rechazada: la reserva archiva la fila vieja,
el input lleva el vencimiento del rango que cubre el numero y
cerrarReenvioRechazado devuelve el saldo de inventario de la vieja. Una factura
sin confirmar (PENDIENTE_ENVIO, ENVIO_INCIERTO, ENVIADO, EN_PROCESO y sus RFCE_)
nunca se reenvia desde la app: 409. Las guardas de Release 1 que exigian 501 pasan
a exigir eso, y el escenario .http se actualiza.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


### Task 10: Avisos al admin en la API: GET /api/facturas/avisos

**Files:**
- Modify: `src/Models/facturaModel.php`. Add the constant `AVISO_SECUENCIA_POCOS`, the pure `clasificarSecuencias` and `getAvisosEcf`. Insert them directly above the one-line docblock `    /** Estados en que la DGII acepto el e-CF: los unicos que una nota puede modificar. */`, which sits just before `public const ESTADOS_MODIFICABLES`. The anchor is text, not a line number: after Task 1 the file is LF and the neighbouring lines have moved. The anchor exists on both sides of the merge.
- Modify: `src/Controllers/facturaController.php`. Three anchors, all present on both sides of the merge:
  - the line `$isModificablesRequest = preg_match('/\/api\/facturas\/modificables\/?$/', $endpoint);` (add `$isAvisosRequest` below it);
  - the single line `        if ($isModificablesRequest) {` inside the `case 'GET':` block. It appears once, because the assignment above does not start with `if`. Add the avisos dispatch directly above it;
  - the line `function handleECFStats(facturaModel $facturaModel): void` (add `handleAvisosEcf` above it).
- Test: `tools/test_write_ahead_puro.php`. New section `AV`, directly above the closing block `// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`
- Test: `tools/test_write_ahead_api.php`. New scenarios `AV1`–`AV4`, directly above the last two lines of the file: `wa_mock_modo($srv['mock'], 'acepta');` and `wa_fin();`. The first line occurs many times in the file, so anchor on the two lines together.
- The API worktree holds the untracked `tools/reconstruir_e340000000001.sql`. Never stage it.
- Line endings: `facturaController.php` and `test_write_ahead_api.php` are CRLF on disk, `test_write_ahead_puro.php` is LF, and `facturaModel.php` is LF after Task 1. Targeted `Edit` calls keep each file's line endings (Release 1 plan convention).

**Interfaces:**
- Consumes (Task 3): the POS columns `facturas.pos_idempotency_key` and `facturas.envio_pendiente`. They already exist in the schema via migration 030.
- Consumes (Task 4): a row reserved without a range stays `PENDIENTE_ENVIO` and carries `"sin_rango": true` in the meta JSON of `respuesta_dgii`. `ncfModel::dispenseSinRango` pushes `ncf_sequences.current_value` above `numero_hasta`.
- Consumes (Task 6): a POS sale that falls back to a factura simple is a `facturas` row with `tipo_ecf IS NULL` and `pos_idempotency_key IS NOT NULL`. Its `date` is written by PHP (`date('Y-m-d H:i:s')`, as `createFacturaSimple` does).
- Consumes (existing):
  - `facturaModel::metaEnvio(?string $respuestaDgii): array`;
  - the private `facturaModel::resolveActiveAmbiente(): ?string`;
  - `EstadosEcf::PENDIENTE_ENVIO`;
  - the controller's `respond(bool, string, int)`.
- Produces:
  - `facturaModel::AVISO_SECUENCIA_POCOS` (`50`).
  - `public static function clasificarSecuencias(array $rangos, string $ambiente, string $hoy, int $umbral = self::AVISO_SECUENCIA_POCOS): array`. It is pure.
    - Input rows: `type`, `numero_desde`, `numero_hasta`, `current_value`, `fecha_vencimiento`.
    - Output: a list of `{tipo, ambiente, restantes, estado}`, ordered by `tipo`.
  - `public function getAvisosEcf(): array` and `function handleAvisosEcf(facturaModel $facturaModel): void`.
  - `GET /api/facturas/avisos`, with the same authentication as the other facturas routes:
    - body: `{status:true, data:{certificado_fallo:{ventas_hoy:int}, secuencias:[{tipo:'E31', ambiente:'certecf', restantes:int|null, estado:'pocos'|'agotada'}], sin_rango:{ventas:int}}}`;
    - a DB failure answers 500 with `{status:false, error:'No se pudieron cargar los avisos del e-CF. Inténtalo de nuevo.'}`.
- Rules the code implements, per the spec (4.6) and the skeleton:
  - `ventas_hoy` counts rows with `tipo_ecf IS NULL AND pos_idempotency_key IS NOT NULL` whose `date` is today. "Today" is the PHP day, the same clock that writes `facturas.date`.
  - `sin_rango.ventas` counts POS rows that are `PENDIENTE_ENVIO`, in the active ambiente, with `sin_rango === true` in their meta. When the resend sends them, they stop counting.
  - `secuencias` works per type, over the active ambiente:
    - `restantes` is the sum of `numero_hasta - current_value` over the non-expired ranges that have a limit. It is the same figure as `restantes` in `GET /api/facturas/stats`, and a queued range counts.
    - A type with a non-expired range without a limit never raises an alert.
    - `pocos` means `1..50` left.
    - `agotada` means 0 left and at least one number already used. A type that was never used, such as a registered range that expired unused, raises nothing.
    - "Expired" is `fecha_vencimiento < hoy`, the same predicate as `dispenseNextECF` and `/stats` (`>= CURDATE()` means valid). A range that expires today still counts. `getAvisosEcf` passes the database's `CURDATE()` as `$hoy`, not PHP's date, so the alert and the dispenser agree even when the two clocks differ. The scratch MySQL clock runs about an hour away from PHP's.
- RF4 (counting half, the one assigned to this task): the alert counts only today's fallback sales, and not the POS e-CF sales that follow once the certificate works again. Scenario `AV2` pins it. The POS half (fallback sales are simple invoices with their idempotency key, later sales are e-CF) is in Tasks 6 and 14.

- [ ] **Step 1: Add section AV to the DB-free suite (failing test)**

Insert into `tools/test_write_ahead_puro.php`, directly above the closing block (`// Cierre. Cada tarea agrega su seccion justo encima de este bloque.`):

```php
// ---------------------------------------------------------------------------
// AV) Avisos al admin (Task 10, spec 4.6). La clasificacion de las secuencias
// es pura (sin base ni red) y el cableado de GET /api/facturas/avisos se prueba
// sobre el texto del controller. La parte con base de datos esta en
// tools/test_write_ahead_api.php (escenarios AV1-AV4).
// ---------------------------------------------------------------------------
echo "\n== AV) Avisos al admin ==\n";
require_once __DIR__ . '/../src/Models/facturaModel.php';

wa_chk('umbral de "quedan pocos": 50 numeros',
    defined('facturaModel::AVISO_SECUENCIA_POCOS') && facturaModel::AVISO_SECUENCIA_POCOS === 50);
$avTiene = method_exists(facturaModel::class, 'clasificarSecuencias');
wa_chk('facturaModel::clasificarSecuencias existe', $avTiene);
wa_chk('facturaModel::getAvisosEcf existe', method_exists(facturaModel::class, 'getAvisosEcf'));
if ($avTiene) {
    $avRango = static fn(string $tipo, int $desde, ?int $hasta, int $actual, ?string $vence = '2099-12-31'): array => [
        'type' => $tipo, 'numero_desde' => $desde, 'numero_hasta' => $hasta,
        'current_value' => $actual, 'fecha_vencimiento' => $vence,
    ];
    $avAviso = static fn(string $tipo, int $restantes, string $estado): array
        => ['tipo' => $tipo, 'ambiente' => 'certecf', 'restantes' => $restantes, 'estado' => $estado];
    $avClasificar = static fn(array $rangos): array => facturaModel::clasificarSecuencias($rangos, 'certecf', '2026-10-12');

    wa_chk('50 libres: pocos; 51 libres: sin aviso',
        $avClasificar([$avRango('E31', 1, 100, 50)]) === [$avAviso('E31', 50, 'pocos')]
        && $avClasificar([$avRango('E31', 1, 100, 49)]) === []);
    wa_chk('un solo numero libre: pocos con 1',
        $avClasificar([$avRango('E31', 1, 100, 99)]) === [$avAviso('E31', 1, 'pocos')]);
    wa_chk('rango consumido: agotada con 0 libres',
        $avClasificar([$avRango('E32', 1, 100, 100)]) === [$avAviso('E32', 0, 'agotada')]);
    wa_chk('numeros usados fuera de rango (current_value > numero_hasta): agotada, nunca negativo',
        $avClasificar([$avRango('E32', 1, 100, 103)]) === [$avAviso('E32', 0, 'agotada')]);
    wa_chk('rango sin limite (legacy, numero_hasta NULL): nunca avisa',
        $avClasificar([$avRango('E33', 1, null, 5000)]) === []);
    wa_chk('rango vencido que se uso: agotada',
        $avClasificar([$avRango('E41', 1, 100, 10, '2026-10-11')]) === [$avAviso('E41', 0, 'agotada')]);
    wa_chk('rango vencido que nunca se uso: sin aviso (el tipo no se usa)',
        $avClasificar([$avRango('E43', 1, 100, 0, '2026-10-11')]) === []);
    wa_chk('vence hoy: todavia dispensa (igual que dispenseNextECF)',
        $avClasificar([$avRango('E44', 1, 100, 60, '2026-10-12')]) === [$avAviso('E44', 40, 'pocos')]);
    wa_chk('sin fecha de vencimiento (NULL): no vence',
        $avClasificar([$avRango('E44', 1, 100, 60, null)]) === [$avAviso('E44', 40, 'pocos')]);
    wa_chk('dos rangos: los libres se suman (100 libres: sin aviso)',
        $avClasificar([$avRango('E45', 1, 100, 100), $avRango('E45', 101, 200, 100)]) === []);
    wa_chk('dos rangos, el siguiente casi vacio: pocos con la suma',
        $avClasificar([$avRango('E45', 1, 100, 100), $avRango('E45', 101, 130, 100)]) === [$avAviso('E45', 30, 'pocos')]);
    wa_chk('un rango sin limite junto a uno agotado: sin aviso',
        $avClasificar([$avRango('E46', 1, 100, 100), $avRango('E46', 101, null, 100)]) === []);
    wa_chk('salen ordenados por tipo',
        $avClasificar([$avRango('E34', 1, 100, 90), $avRango('E31', 1, 100, 90)])
            === [$avAviso('E31', 10, 'pocos'), $avAviso('E34', 10, 'pocos')]);
    wa_chk('sin rangos: sin avisos', $avClasificar([]) === []);
}

$avCtl = (string) file_get_contents(__DIR__ . '/../src/Controllers/facturaController.php');
wa_chk('facturaController: ruta $isAvisosRequest, manejador handleAvisosEcf y su 500',
    str_contains($avCtl, '$isAvisosRequest = preg_match(')
    && str_contains($avCtl, 'function handleAvisosEcf(facturaModel $facturaModel): void')
    && str_contains($avCtl, 'No se pudieron cargar los avisos del e-CF. Inténtalo de nuevo.'));
$avPosDespacho = strpos($avCtl, 'handleAvisosEcf($facturaModel);');
$avPosListado = strpos($avCtl, "isset(\$_GET['id'])");
wa_chk('facturaController: GET avisos se despacha antes del listado',
    $avPosDespacho !== false && $avPosListado !== false && $avPosDespacho < $avPosListado, [$avPosDespacho, $avPosListado]);

```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | sed -n '/== AV)/,$p'; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `[FALLO] umbral de "quedan pocos": 50 numeros`;
- `[FALLO] facturaModel::clasificarSecuencias existe`;
- `[FALLO] facturaModel::getAvisosEcf existe`;
- `[FALLO] facturaController: ruta $isAvisosRequest, manejador handleAvisosEcf y su 500`;
- `[FALLO] facturaController: GET avisos se despacha antes del listado`;
- the summary `N de M pruebas OK` with `N < M`, and `exit=1`.

- [ ] **Step 3: Implement the model methods**

In `src/Models/facturaModel.php`, insert this block directly above the line `    /** Estados en que la DGII acepto el e-CF: los unicos que una nota puede modificar. */`:

```php
    /** Umbral de "quedan pocos numeros" de un tipo de e-CF (spec 4.6). */
    public const AVISO_SECUENCIA_POCOS = 50;

    /**
     * Avisos para quien administra el e-CF (spec 4.6, GET /api/facturas/avisos).
     * Solo lectura: no cambia nada ni llama a la DGII.
     *
     *  - certificado_fallo.ventas_hoy: ventas del POS de hoy que salieron como
     *    factura simple porque el e-CF no se pudo generar (tipo_ecf NULL con la
     *    clave de idempotencia del POS). "Hoy" es el dia de este servidor PHP,
     *    el mismo reloj que escribe facturas.date (date('Y-m-d H:i:s')).
     *  - secuencias: tipos del ambiente activo con pocos numeros o agotados
     *    (clasificarSecuencias). El vencimiento de un rango se compara con
     *    CURDATE() de la base, como dispenseNextECF y GET /api/facturas/stats.
     *  - sin_rango.ventas: ventas del POS que usaron el numero siguiente al
     *    ultimo de su rango y esperan un rango autorizado: PENDIENTE_ENVIO con
     *    'sin_rango' en la meta de respuesta_dgii, en el ambiente activo. La
     *    meta se decodifica en PHP (respuesta_dgii es TEXT); el LIKE solo
     *    descarta de antemano las filas que no la traen.
     *
     * @return array{certificado_fallo: array{ventas_hoy: int}, secuencias: array, sin_rango: array{ventas: int}}
     * @throws PDOException si la base no responde: el controller responde 500 y la
     *                      pantalla simplemente no muestra avisos.
     */
    public function getAvisosEcf(): array
    {
        $ambiente = $this->resolveActiveAmbiente() ?? 'certecf';

        $simples = $this->conexion->prepare(
            'SELECT COUNT(*) FROM facturas
              WHERE tipo_ecf IS NULL AND pos_idempotency_key IS NOT NULL AND date >= :desde'
        );
        $simples->execute([':desde' => date('Y-m-d') . ' 00:00:00']);
        $ventasHoy = (int) $simples->fetchColumn();

        $enEspera = $this->conexion->prepare(
            "SELECT respuesta_dgii FROM facturas
              WHERE pos_idempotency_key IS NOT NULL AND tipo_ecf IS NOT NULL
                AND estado_dgii = :estado AND ambiente_dgii = :amb
                AND respuesta_dgii LIKE '%sin_rango%'"
        );
        $enEspera->execute([':estado' => EstadosEcf::PENDIENTE_ENVIO, ':amb' => $ambiente]);
        $sinRango = 0;
        foreach ($enEspera->fetchAll(PDO::FETCH_COLUMN) as $respuesta) {
            $meta = self::metaEnvio($respuesta === null ? null : (string) $respuesta);
            if (($meta['sin_rango'] ?? null) === true) {
                $sinRango++;
            }
        }

        $rangos = $this->conexion->prepare(
            "SELECT type, numero_desde, numero_hasta, current_value, fecha_vencimiento FROM ncf_sequences
              WHERE type LIKE 'E%' AND ambiente = :amb ORDER BY type, numero_desde"
        );
        $rangos->execute([':amb' => $ambiente]);
        $hoyBase = (string) $this->conexion->query('SELECT CURDATE()')->fetchColumn();

        return [
            'certificado_fallo' => ['ventas_hoy' => $ventasHoy],
            'secuencias' => self::clasificarSecuencias($rangos->fetchAll(PDO::FETCH_ASSOC), $ambiente, $hoyBase),
            'sin_rango' => ['ventas' => $sinRango],
        ];
    }

    /**
     * Que tipos de e-CF avisan por su secuencia (spec 4.6). Pura: no toca la base.
     *
     * Por tipo se suman los numeros libres de los rangos NO vencidos que tienen
     * limite (el mismo "restantes" de GET /api/facturas/stats), asi que un rango
     * en cola cuenta. Un rango vigente sin limite (numero_hasta NULL) significa
     * que nunca se agota y el tipo no avisa. "Vencido" es fecha_vencimiento < hoy,
     * el mismo criterio de ncfModel::dispenseNextECF.
     *  - 1..$umbral libres: 'pocos'.
     *  - 0 libres: 'agotada', pero solo si el tipo ya uso algun numero. Un rango
     *    registrado y vencido sin usar no avisa: ese tipo no se usa.
     *
     * Un current_value por encima de numero_hasta (ventas del POS que tomaron el
     * numero siguiente al ultimo) no resta: los libres nunca son negativos.
     *
     * @param array  $rangos filas de ncf_sequences: type, numero_desde, numero_hasta, current_value, fecha_vencimiento
     * @param string $hoy    'Y-m-d'
     * @return array lista de ['tipo' => 'E31', 'ambiente' => ..., 'restantes' => int, 'estado' => 'pocos'|'agotada'], por tipo
     */
    public static function clasificarSecuencias(array $rangos, string $ambiente, string $hoy, int $umbral = self::AVISO_SECUENCIA_POCOS): array
    {
        $porTipo = [];
        foreach ($rangos as $r) {
            $porTipo[(string) $r['type']][] = $r;
        }
        ksort($porTipo);

        $avisos = [];
        foreach ($porTipo as $tipo => $filas) {
            $restantes = 0;
            $usados = 0;
            $sinLimite = false;
            foreach ($filas as $r) {
                $actual = (int) $r['current_value'];
                $usados += max(0, $actual - ((int) $r['numero_desde'] - 1));
                $vence = $r['fecha_vencimiento'] ?? null;
                if ($vence !== null && (string) $vence < $hoy) {
                    continue;
                }
                if ($r['numero_hasta'] === null) {
                    $sinLimite = true;
                    continue;
                }
                $restantes += max(0, (int) $r['numero_hasta'] - $actual);
            }
            if ($sinLimite) {
                continue;
            }
            if ($restantes === 0 && $usados > 0) {
                $avisos[] = ['tipo' => (string) $tipo, 'ambiente' => $ambiente, 'restantes' => 0, 'estado' => 'agotada'];
            } elseif ($restantes > 0 && $restantes <= $umbral) {
                $avisos[] = ['tipo' => (string) $tipo, 'ambiente' => $ambiente, 'restantes' => $restantes, 'estado' => 'pocos'];
            }
        }
        return $avisos;
    }

```

- [ ] **Step 4: Run the DB-free section: the classification passes, the wiring still fails**

```bash
php -l src/Models/facturaModel.php
php tools/test_write_ahead_puro.php | sed -n '/== AV)/,$p'; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `No syntax errors detected`;
- every classification check, and the two existence checks, are `[OK  ]`;
- exactly the two `facturaController` checks are still `[FALLO]`;
- `exit=1`.

- [ ] **Step 5: Add scenarios AV1-AV4 to the API suite (failing test)**

Insert into `tools/test_write_ahead_api.php`, directly above its last two lines (`wa_mock_modo($srv['mock'], 'acepta');` and `wa_fin();`):

```php
// ===========================================================================
// Task 10: GET /api/facturas/avisos (avisos al admin, spec 4.6). Las filas del
// POS se siembran a mano: la venta real por el POS (certificado que falla,
// secuencia agotada) la prueban las Tasks 6, 7 y 14; aqui se prueba lo que el
// panel cuenta.
// ===========================================================================

/**
 * Una fila del POS sembrada a mano. $tipo null = factura simple de respaldo
 * (sin e-NCF ni ambiente, estado PENDIENTE como createFacturaSimple); con $tipo
 * es un e-CF del POS. $n distingue la clave de idempotencia y el e-NCF.
 */
function wa_aviso_fila(PDO $pdo, int $n, ?string $tipo, string $estado, string $fecha, ?string $respuesta = null, string $ambiente = 'certecf'): int
{
    $eNcf = $tipo === null ? null : sprintf('E%s%010d', $tipo, 900000 + $n);
    $pdo->prepare(
        "INSERT INTO facturas (no_factura, date, client_name, total, tipo_pago, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii,
                               respuesta_dgii, pos_idempotency_key, envio_pendiente)
         VALUES (:nf, :fecha, 'Consumidor Final', 118.00, 1, :tipo, :encf, :estado, :amb, :resp, :clave, :pend)"
    )->execute([
        ':nf' => $eNcf ?? sprintf('%04d-%s', $n, date('dmy')), ':fecha' => $fecha, ':tipo' => $tipo, ':encf' => $eNcf,
        ':estado' => $estado, ':amb' => $tipo === null ? null : $ambiente, ':resp' => $respuesta,
        ':clave' => sprintf('00000000-0000-4000-8000-%012d', $n), ':pend' => $estado === 'PENDIENTE_ENVIO' ? 1 : 0,
    ]);
    return (int) $pdo->lastInsertId();
}

echo "AV1) Sin avisos en una base limpia\n";
$ids = wa_reiniciar($pdo, $srv);
$r = wa_get($srv, '/api/facturas/avisos');
$d = $r['json']['data'] ?? [];
wa_chk('200 con status true', $r['status'] === 200 && ($r['json']['status'] ?? null) === true, $r);
wa_chk('data trae exactamente certificado_fallo, secuencias y sin_rango',
    wa_claves($d) === ['certificado_fallo', 'secuencias', 'sin_rango'], wa_claves($d));
wa_chk('todo en cero y sin secuencias que avisen (los rangos de prueba llegan a 99999999)',
    ($d['certificado_fallo'] ?? null) === ['ventas_hoy' => 0] && ($d['secuencias'] ?? null) === []
    && ($d['sin_rango'] ?? null) === ['ventas' => 0], $d);
$sinToken = wa_http('GET', $srv['api'] . '/api/facturas/avisos');
wa_chk('sin token: 401, como el resto de /api/facturas', $sinToken['status'] === 401, $sinToken);

echo "AV2) Certificado: solo cuentan las facturas simples del POS de hoy (RF4)\n";
$ids = wa_reiniciar($pdo, $srv);
$avHoy = date('Y-m-d H:i:s');
$avAyer = date('Y-m-d 12:00:00', strtotime('-1 day'));
wa_aviso_fila($pdo, 1, null, 'PENDIENTE', $avHoy);          // respaldo de hoy
wa_aviso_fila($pdo, 2, null, 'PENDIENTE', $avHoy);          // respaldo de hoy
wa_aviso_fila($pdo, 3, null, 'PENDIENTE', $avAyer);         // respaldo de ayer: no cuenta
wa_aviso_fila($pdo, 4, '32', 'RFCE_ACEPTADO', $avHoy);      // el certificado volvio: e-CF normal, no cuenta
$pdo->prepare("INSERT INTO facturas (no_factura, date, client_name, total, tipo_pago) VALUES ('0001-WA', :f, 'WA simple de la app', 100.00, 1)")
    ->execute([':f' => $avHoy]);                            // simple de la app (sin clave del POS): no cuenta
$r = wa_get($srv, '/api/facturas/avisos');
$d = $r['json']['data'] ?? [];
wa_chk('ventas_hoy = 2: las del POS de hoy, sin ayer, sin e-CF y sin las simples de la app',
    ($d['certificado_fallo'] ?? null) === ['ventas_hoy' => 2], $d);
wa_chk('las otras dos secciones siguen en cero',
    ($d['secuencias'] ?? null) === [] && ($d['sin_rango'] ?? null) === ['ventas' => 0], $d);

echo "AV3) Secuencias: pocos numeros y agotadas\n";
$ids = wa_reiniciar($pdo, $srv);
// Vencido hace 3 dias: el vencimiento lo decide el CURDATE() de la base, y su reloj
// no es exactamente el de PHP; con 3 dias de margen la prueba no depende de la hora.
$avVencido = date('Y-m-d', strtotime('-3 days'));
$pdo->exec("UPDATE ncf_sequences SET numero_hasta = 100, current_value = 60 WHERE type = 'E31' AND ambiente = 'certecf'");   // 40 libres
$pdo->exec("UPDATE ncf_sequences SET numero_hasta = 100, current_value = 103 WHERE type = 'E32' AND ambiente = 'certecf'");  // 3 numeros usados fuera de rango
$pdo->prepare("UPDATE ncf_sequences SET current_value = 10, fecha_vencimiento = :v WHERE type = 'E33' AND ambiente = 'certecf'")
    ->execute([':v' => $avVencido]);                                                                                          // vencido y usado
$r = wa_get($srv, '/api/facturas/avisos');
wa_chk('E31 pocos (40), E32 y E33 agotadas; E34, con su rango amplio, no avisa',
    ($r['json']['data']['secuencias'] ?? null) === [
        ['tipo' => 'E31', 'ambiente' => 'certecf', 'restantes' => 40, 'estado' => 'pocos'],
        ['tipo' => 'E32', 'ambiente' => 'certecf', 'restantes' => 0, 'estado' => 'agotada'],
        ['tipo' => 'E33', 'ambiente' => 'certecf', 'restantes' => 0, 'estado' => 'agotada'],
    ], $r['json']['data']['secuencias'] ?? null);
wa_sembrar($pdo);   // devuelve numero_hasta y vencimiento de E31-E34
wa_limpiar($pdo);   // y los contadores al inicio
$r = wa_get($srv, '/api/facturas/avisos');
wa_chk('con los rangos restaurados no hay avisos de secuencia', ($r['json']['data']['secuencias'] ?? null) === [], $r['json']['data'] ?? null);

echo "AV4) Ventas esperando un rango autorizado (sin_rango)\n";
$ids = wa_reiniciar($pdo, $srv);
$avHoy = date('Y-m-d H:i:s');
$avSinRango = json_encode(['fase' => 'PENDIENTE_ENVIO', 'sin_rango' => true]);
$avIdEspera = wa_aviso_fila($pdo, 11, '32', 'PENDIENTE_ENVIO', $avHoy, $avSinRango);                                        // cuenta
wa_aviso_fila($pdo, 12, '32', 'PENDIENTE_ENVIO', $avHoy, json_encode(['fase' => 'PENDIENTE_ENVIO']));                        // venta en curso, con rango: no
wa_aviso_fila($pdo, 13, '32', 'RFCE_ACEPTADO', $avHoy, $avSinRango);                                                         // ya enviada: no
wa_aviso_fila($pdo, 14, '32', 'PENDIENTE_ENVIO', $avHoy, $avSinRango, 'ecf');                                                // otro ambiente: no
$pdo->prepare(
    "INSERT INTO facturas (no_factura, date, client_name, total, tipo_pago, tipo_ecf, e_ncf, estado_dgii, ambiente_dgii, respuesta_dgii)
     VALUES ('E320000000777', :f, 'WA factura de la app', 100.00, 1, '32', 'E320000000777', 'PENDIENTE_ENVIO', 'certecf', :m)"
)->execute([':f' => $avHoy, ':m' => $avSinRango]);                                                                           // sin clave del POS: no
$r = wa_get($srv, '/api/facturas/avisos');
$d = $r['json']['data'] ?? [];
wa_chk('sin_rango.ventas = 1: solo la PENDIENTE_ENVIO del POS, del ambiente activo y con sin_rango en su meta',
    ($d['sin_rango'] ?? null) === ['ventas' => 1], $d);
wa_chk('certificado_fallo sigue en cero', ($d['certificado_fallo'] ?? null) === ['ventas_hoy' => 0], $d);
$pdo->prepare("UPDATE facturas SET estado_dgii = 'ENVIADO', envio_pendiente = 1 WHERE id = :id")->execute([':id' => $avIdEspera]);
$r = wa_get($srv, '/api/facturas/avisos');
wa_chk('cuando el reenvio la envia (sale de PENDIENTE_ENVIO) deja de esperar',
    ($r['json']['data']['sin_rango'] ?? null) === ['ventas' => 0], $r['json']['data'] ?? null);
wa_limpiar($pdo);

```

- [ ] **Step 6: Run the API suite and watch the new scenarios fail**

`GET /api/facturas/avisos` still falls through to the invoice listing, so `data` is a list and not the avisos object.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | sed -n '/^AV1)/,$p'
```

If port 8099 is busy, prefix the command with `WA_PUERTO_OFFSET=100`. DB suites run strictly serially: never run this while another suite is using `wa_scratch` (its `wa_limpiar` deletes every `facturas` row).

Expected:
- AV1: `200 con status true` and `sin token: 401` are `[OK  ]`. `data trae exactamente certificado_fallo, secuencias y sin_rango` and `todo en cero...` are `[FALLO]`.
- AV2, AV3, AV4: every check on the new shape is `[FALLO]`.
- The last line is `N de M pruebas OK` with `N < M`.

- [ ] **Step 7: Wire the route in the controller**

In `src/Controllers/facturaController.php` make three edits. They are targeted `Edit` calls, which keep the file's line endings.

1) Below the line `$isModificablesRequest = preg_match('/\/api\/facturas\/modificables\/?$/', $endpoint);` add:

```php
$isAvisosRequest = preg_match('/\/api\/facturas\/avisos\/?$/', $endpoint);
```

2) Directly above the single line `        if ($isModificablesRequest) {` (inside `case 'GET':`) add:

```php
        if ($isAvisosRequest) {
            handleAvisosEcf($facturaModel);
            break;
        }
```

3) Directly above the line `function handleECFStats(facturaModel $facturaModel): void` add:

```php
/**
 * GET /api/facturas/avisos: los avisos del e-CF para quien administra (spec 4.6).
 * Solo lectura. {certificado_fallo:{ventas_hoy}, secuencias:[{tipo, ambiente,
 * restantes, estado}], sin_rango:{ventas}}: ver facturaModel::getAvisosEcf. Si
 * la base no responde, 500 con un texto claro; la pantalla simplemente no
 * muestra avisos y el panel sigue funcionando.
 */
function handleAvisosEcf(facturaModel $facturaModel): void
{
    try {
        $avisos = $facturaModel->getAvisosEcf();
    } catch (Throwable $e) {
        error_log('[facturas] avisos del e-CF: ' . get_class($e) . ': ' . $e->getMessage());
        respond(false, 'No se pudieron cargar los avisos del e-CF. Inténtalo de nuevo.', 500);
        return;
    }
    echo json_encode(['status' => true, 'data' => $avisos]);
}

```

- [ ] **Step 8: Run both suites**

```bash
php -l src/Controllers/facturaController.php
php tools/test_write_ahead_puro.php | sed -n '/== AV)/,$p'; echo "exit=${PIPESTATUS[0]}"
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_write_ahead_api.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | sed -n '/^AV1)/,$p'
```

Expected:
- `No syntax errors detected`;
- the whole puro `AV` section is `[OK  ]`, the summary reads `N de N pruebas OK`, and `exit=0`;
- every AV1-AV4 line is `[OK  ]`, and the last line of the API run reads `N de N pruebas OK`.

- [ ] **Step 9: Regression on the suites that read `facturaModel`**

```bash
php tools/test_write_ahead_puro.php | tail -1
php tools/test_notas_vinculadas.php | tail -1
php -d extension=curl -d extension=openssl -d extension=pdo_mysql -d extension=pdo_sqlite tools/test_reservar_confirmar.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -1
```

Expected: each prints `N de N pruebas OK`.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git add src/Models/facturaModel.php src/Controllers/facturaController.php tools/test_write_ahead_puro.php tools/test_write_ahead_api.php
git commit -F - <<'EOF'
feat(facturas): GET /api/facturas/avisos con los avisos del e-CF para el admin

Tres avisos de solo lectura para el panel e-CF de la app (spec 4.6): ventas
del POS de hoy que salieron como factura simple (certificado), tipos con 50
numeros o menos o agotados (secuencias) y ventas del POS en PENDIENTE_ENVIO con
sin_rango en la meta (esperando un rango autorizado).

facturaModel::clasificarSecuencias es pura y se prueba sin base (seccion AV de
test_write_ahead_puro.php). Los escenarios AV1-AV4 de test_write_ahead_api.php
cubren la ruta sobre la base de prueba, incluido que solo cuentan las ventas de
hoy (RF4) y que una venta enviada deja de esperar el rango.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: FE POS: la caja no muestra nada de la DGII

**Files:**
- Everything is in the FE worktree `C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead`, on the tree merged in Task 2. `src/pos/*` comes from `main` as is, so the anchors below quote `main`'s text. All 23 text anchors below were checked against a trial merge of `origin/main` into this branch: each one matches exactly once.
- Modify: `src/pos/estados.ts`. Remove `ESTADO_DGII` and `estadoDgii`. Add `numeroVenta` and `tituloVenta`. `horaDe` and `diaLargo` stay.
- Modify: `src/pos/api.ts`. `e_ncf` and `tipo_ecf` can be `null` in `VentaRespuesta.venta` and `VentaTurno`; two stale comments are corrected.
- Modify: `src/pos/CobroModal.tsx`. Remove the "La DGII recibió… / La DGII no respondió…" notice, and use `tituloVenta`.
- Modify: `src/pos/VentaView.tsx`. Remove the "N sin confirmar DGII" chip and the rejection banner; the silent 2-minute resend stays.
- Modify: `src/pos/VentasDiaModal.tsx` and `src/pos/CajaModales.tsx` (the turn list). They show no DGII state.
- Modify: `src/pos/reporteCierre.ts` and `src/pos/CierreModal.tsx`. The closing receipt that the register prints leaves out the two DGII lists.
- Modify: `src/pos/ClienteRncModal.tsx`. Reword the warning that names the DGII.
- Test: `scripts/test-pos-cierre.ts` (add checks) and `scripts/test-pos-sin-dgii.ts` (create). `tsconfig.json` includes `scripts`, so `npm run typecheck` also type-checks both.
- `src/pos/pos.css` is not touched. Its `.pos-pendientes` rules become unused and harmless.

**Interfaces:**
- Consumes (Tasks 5, 6, 8):
  - `POST /api/pos/ventas` answers 201 `{venta, cobro, recibo, repetida}` with the same shape as today. `venta.estado_dgii` and `venta.envio_pendiente` keep arriving; the screen just no longer shows them.
  - For a sale that went out as a factura simple (Task 6), `venta.tipo_ecf` and `venta.e_ncf` are `null` (the row's own columns), and `recibo` is built in the simple-invoice format. `reciboHtml` already prints `timbre: null` (no QR, no security code), so the FE needs no extra branch. If Task 6 fills `e_ncf` with the simple invoice's number instead, the code below keeps working.
  - `POST /api/pos/pendientes/reenviar` keeps its response shape `{revisadas, aceptadas, rechazadas, pendientes}`.
- Produces:
  - In `src/pos/estados.ts`: `numeroVenta(v: { e_ncf: string | null; factura_id: number }): string` and `tituloVenta(tipoEcf: string | null): string`.
  - `reporteCierreHtml(r, opts: { empresa?: string | null; anchoMm: number; mostrarDgii?: boolean })`. It defaults to `true`, which is what the admin's reprint in `app.*` (`TurnosPanel`) keeps using. The register passes `false`.
  - `scripts/test-pos-sin-dgii.ts`. It scans `src/pos` for the word "DGII" in code, outside comments. The only exception is `reporteCierre.ts`, shared with `app.*`. Identifiers such as `estado_dgii` and `'DGII_RECHAZO'` do not match (`\bDGII\b` is case-sensitive and `_` is a word character).
- Decision to review: the red banner "La DGII rechazó una venta que ya se había entregado… Avisa al supervisor" goes away together with the chip. It names the DGII (U3), and spec 4.2.10 moves the handling of a rejected delivered sale to the app. There the sale appears as "Rechazada" with "Reenviar a la DGII", and `TurnosPanel` still lists it. If the user wants a neutral supervisor alert on the register, that is a separate change. This task adds none.

- [ ] **Step 1: Write the failing checks**

Create `scripts/test-pos-sin-dgii.ts`:

```ts
// El cajero no ve nada de la DGII (decisión U3 de la spec del POS sobre el
// write-ahead): ni textos, ni el estado de la venta en las listas, ni las
// listas del reporte de cierre que imprime la caja. Esta prueba lee el código
// de src/pos y busca la palabra, y prueba los textos de las ventas que salen
// como factura simple (sin e-NCF).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-sin-dgii.ts
import { readdirSync, readFileSync } from 'node:fs'
import type { ReciboDatos } from '../src/api/types.ts'
import { reciboHtml } from '../src/features/invoices/reciboHtml.ts'
import { numeroVenta, tituloVenta } from '../src/pos/estados.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

/**
 * El código sin comentarios, con las mismas líneas (para citar la línea). Un
 * // pegado a ':' es de una URL, no un comentario.
 */
const sinComentarios = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// El reporte de cierre se comparte con app.* (reimpresión del administrador): ahí
// la DGII sí se nombra. La caja lo imprime con mostrarDgii: false
// (scripts/test-pos-cierre.ts lo prueba).
const COMPARTIDOS_CON_LA_APP = new Set(['reporteCierre.ts'])

const dir = new URL('../src/pos/', import.meta.url)
const archivos = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))
console.log(`Textos de la caja (${archivos.length} archivos de src/pos)`)
const ofensores: string[] = []
for (const f of archivos) {
  if (COMPARTIDOS_CON_LA_APP.has(f)) continue
  sinComentarios(readFileSync(new URL(f, dir), 'utf8')).split('\n').forEach((linea, i) => {
    if (/\bDGII\b/.test(linea)) ofensores.push(`${f}:${i + 1} ${linea.trim().slice(0, 90)}`)
  })
}
chk('ningún texto de src/pos nombra la DGII (comentarios aparte)', ofensores.length === 0, ofensores)

console.log('Número y título de la venta, también si salió como factura simple')
chk('con e-NCF: el e-NCF', numeroVenta({ e_ncf: 'E320000000020', factura_id: 9 }) === 'E320000000020')
chk('sin e-NCF (factura simple): "Factura 9" y nunca "null"',
  numeroVenta({ e_ncf: null, factura_id: 9 }) === 'Factura 9' && numeroVenta({ e_ncf: '', factura_id: 9 }) === 'Factura 9')
chk('título: crédito fiscal, consumo y factura simple (tipo null o vacío)',
  tituloVenta('31') === 'Factura de crédito fiscal' && tituloVenta('32') === 'Factura de consumo'
  && tituloVenta(null) === 'Factura' && tituloVenta('') === 'Factura')

console.log('Recibo de una factura simple (U4: se imprime como cualquier otra)')
const recibo = (timbre: ReciboDatos['timbre']): ReciboDatos => ({
  nombre: 'Factura_0017-121026_POS80',
  papel: { opcion: 80, ancho_mm: 72, margen_mm: 2 },
  fuente: 'Arial',
  logo: null,
  emisor: { razon_social: 'GRATEX EIRL', rnc: '131256432', direccion: 'Calle 1', contacto: '809-000-0000' },
  titulo: timbre ? 'Factura de Consumo Electrónica' : 'Factura',
  identificacion: [['Número', '0017-121026']],
  receptor: null,
  lineas: [{ descripcion: 'Producto', cantidad_precio: '1 x 118.00', itbis: '18%', valor: '118.00' }],
  motivo: '',
  totales: [{ etiqueta: 'Total', valor: '118.00', total: true }],
  timbre,
  leyenda_qr: '',
  gracias: 'Gracias por su compra',
})
const simple = reciboHtml(recibo(null))
chk('sin timbre: imprime el número, el total y el pie, sin código de seguridad ni QR',
  simple.includes('0017-121026') && simple.includes('118.00') && simple.includes('Gracias por su compra')
  && !simple.includes('Código de Seguridad') && !simple.includes('class="qr"'))
const ecf = reciboHtml(recibo({ qr: null, aviso_preview: '', codigo_seguridad: 'AbC123', fecha_firma: '12-10-2026 10:00:00' }))
chk('con timbre (e-CF, aceptado o sin confirmar): código de seguridad y fecha de firma',
  ecf.includes('Código de Seguridad') && ecf.includes('AbC123') && ecf.includes('12-10-2026 10:00:00'))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

In `scripts/test-pos-cierre.ts`, directly after these two lines:

```ts
const propio = reporteCierreHtml({ ...reporte, cerrado_por: { id: 3, nombre: 'Ana', rol: 'cajero' } }, { anchoMm: 72 })
chk('cierre propio: sin "Cerró" ni segunda firma', !propio.includes('Cerró') && (propio.match(/class="firma"/g) ?? []).length === 1)
```

add:

```ts
// La caja no muestra nada de la DGII (U3); la reimpresión del administrador en app.* sí lleva las listas.
const conDgiiRechazada = { ...reporte, rechazadas: [{ e_ncf: 'E320000000021', total_centavos: 1200 }] }
const deCaja = reporteCierreHtml(conDgiiRechazada, { anchoMm: 72, mostrarDgii: false })
chk('caja (mostrarDgii: false): sin las listas de la DGII ni sus e-NCF',
  !deCaja.includes('DGII') && !deCaja.includes('E320000000020') && !deCaja.includes('E320000000021'))
chk('caja: el resto del reporte no cambia (ventas, efectivo y diferencia)',
  deCaja.includes('VENTAS (4)') && deCaja.includes('1,729.50') && deCaja.includes('Faltan RD$ 0.25'))
const deAdmin = reporteCierreHtml(conDgiiRechazada, { anchoMm: 72 })
chk('app (por defecto): sigue con las pendientes y las rechazadas',
  deAdmin.includes('Pendientes de la DGII (1)') && deAdmin.includes('E320000000020')
  && deAdmin.includes('Rechazadas por la DGII (1)') && deAdmin.includes('E320000000021'))
```

- [ ] **Step 2: Run both and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-pos-sin-dgii.ts; echo "exit=$?"
node scripts/test-pos-cierre.ts | grep -E "FALLA|OK$"; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `test-pos-sin-dgii.ts` stops with `SyntaxError: The requested module '../src/pos/estados.ts' does not provide an export named 'numeroVenta'`, and the exit code is not 0.
- `test-pos-cierre.ts` prints exactly one `[FALLA] caja (mostrarDgii: false): sin las listas de la DGII ni sus e-NCF`, because the option does not exist yet and the lists are still printed. It ends with `N/M OK` where `N < M` (on the Task 2 tree: `21/22 OK`). Every older check stays `[OK  ]`.

- [ ] **Step 3: Replace the DGII states with the sale helpers, and let the types carry `null`**

In `src/pos/estados.ts`, replace the first block:

```ts
// Estado DGII de una venta del POS en palabras del cajero (ventas del turno y
// del día). Lo que no está aquí se muestra tal cual.
export const ESTADO_DGII: Record<string, string> = {
  RFCE_ACEPTADO: 'Aceptada', ACEPTADO: 'Aceptada', RFCE_ACEPTADO_CONDICIONAL: 'Aceptada', ACEPTADO_CONDICIONAL: 'Aceptada',
  RFCE_PENDIENTE: 'Sin confirmar DGII', ENVIO_PENDIENTE: 'Sin confirmar DGII', ENVIADO: 'DGII validando', EN_PROCESO: 'DGII validando',
  RFCE_RECHAZADO: 'Rechazada', RECHAZADO: 'Rechazada',
}

export function estadoDgii(estado: string): string {
  return ESTADO_DGII[estado] ?? estado
}
```

with:

```ts
// Textos de la caja sobre una venta (pantalla de cobro y listas de ventas del
// turno y del día). La pantalla del cajero no muestra nada de la DGII (decisión
// U3 de la spec del POS sobre el write-ahead): ni el estado de la venta ni si se
// envió. Lo vigila scripts/test-pos-sin-dgii.ts.

/**
 * Número de una venta para el cajero: el e-NCF o, si la venta salió como
 * factura simple (sin e-NCF), "Factura <id>".
 */
export function numeroVenta(v: { e_ncf: string | null; factura_id: number }): string {
  return v.e_ncf ? v.e_ncf : `Factura ${v.factura_id}`
}

/** Título de la venta cobrada por tipo de comprobante; una factura simple (tipo null) es solo "Factura". */
export function tituloVenta(tipoEcf: string | null): string {
  if (tipoEcf === '31') return 'Factura de crédito fiscal'
  if (tipoEcf === '32') return 'Factura de consumo'
  return 'Factura'
}
```

In `src/pos/api.ts`, replace:

```ts
  venta: {
    factura_id: number
    e_ncf: string
    tipo_ecf: string
    estado_dgii: string
    /**
     * Sin veredicto de la DGII todavía: no respondió a tiempo (RFCE_PENDIENTE /
     * ENVIO_PENDIENTE) o, en un E31, recibió el e-CF y lo está validando
     * (ENVIADO / EN_PROCESO). Se imprimió y se confirma solo (F6, F7).
     */
    envio_pendiente: boolean
```

with:

```ts
  venta: {
    factura_id: number
    /** null si la venta salió como factura simple (sin e-NCF). */
    e_ncf: string | null
    /** null si la venta salió como factura simple. */
    tipo_ecf: string | null
    /** El POS no lo muestra: la pantalla del cajero no sabe nada de la DGII. */
    estado_dgii: string
    /** Sin veredicto todavía: el servidor lo confirma solo (reenvío automático). El POS no lo muestra. */
    envio_pendiente: boolean
```

and replace:

```ts
export interface VentaTurno {
  factura_id: number
  e_ncf: string
  tipo_ecf: string
```

with:

```ts
export interface VentaTurno {
  factura_id: number
  /** null si la venta salió como factura simple (sin e-NCF). */
  e_ncf: string | null
  tipo_ecf: string | null
```

- [ ] **Step 4: The closing receipt of the register leaves out the DGII lists**

In `src/pos/reporteCierre.ts`, replace:

```ts
export function reporteCierreHtml(r: ReporteCierre, opts: { empresa?: string | null; anchoMm: number }): string {
```

with:

```ts
/**
 * mostrarDgii (por defecto sí): las listas "Pendientes de la DGII" y "Rechazadas
 * por la DGII". La reimpresión del administrador en app.* las lleva; la caja
 * imprime con mostrarDgii: false, porque el cajero no ve nada de la DGII (U3).
 */
export function reporteCierreHtml(
  r: ReporteCierre,
  opts: { empresa?: string | null; anchoMm: number; mostrarDgii?: boolean },
): string {
```

Below the line `  const cerroOtro = r.cerrado_por.id !== r.empleado.id` add:

```ts
  const mostrarDgii = opts.mostrarDgii !== false
```

Replace:

```ts
  ${lista('Pendientes de la DGII', r.pendientes)}
  ${lista('Rechazadas por la DGII', r.rechazadas)}
```

with:

```ts
  ${mostrarDgii ? lista('Pendientes de la DGII', r.pendientes) + lista('Rechazadas por la DGII', r.rechazadas) : ''}
```

In `src/pos/CierreModal.tsx`, replace:

```tsx
      await printHtml(reporteCierreHtml(reporte, { empresa, anchoMm: mm }), { anchoMm: mm, selector: SELECTOR_REPORTE })
```

with:

```tsx
      await printHtml(reporteCierreHtml(reporte, { empresa, anchoMm: mm, mostrarDgii: false }), { anchoMm: mm, selector: SELECTOR_REPORTE })
```

- [ ] **Step 5: CobroModal: no DGII notice, and a title that works for a simple invoice**

In `src/pos/CobroModal.tsx`:

1) Below the line `import { TecladoMonto } from './TecladoMonto'` add:

```tsx
import { tituloVenta } from './estados'
```

2) Replace:

```tsx
            {fase.r.venta.tipo_ecf === '31' ? 'Factura de crédito fiscal' : 'Factura de consumo'} {fase.r.venta.e_ncf}
```

with:

```tsx
            {tituloVenta(fase.r.venta.tipo_ecf)} {fase.r.venta.e_ncf ?? ''}
```

3) Delete this whole block (it sits between the `fase.r.repetida` notice and the `fase.impresion === 'error'` notice):

```tsx
          {fase.r.venta.envio_pendiente && (fase.r.venta.estado_dgii === 'ENVIADO' || fase.r.venta.estado_dgii === 'EN_PROCESO' ? (
            // E31: la DGII lo recibió y da el veredicto después (normal en crédito fiscal).
            <div className="pos-info" style={{ margin: 0 }}>
              <Icon name="info" size={16} />
              <span>La DGII recibió la factura y la está validando. El resultado se confirma solo.</span>
            </div>
          ) : (
            <div className="pos-aviso" style={{ margin: 0 }}>
              <Icon name="clock" size={16} />
              <span>La DGII no respondió a tiempo. La venta quedó registrada y se reenviará sola.</span>
            </div>
          ))}
```

The `SIN_VENTA` set and the `GUARDADO_FALLIDO` branch stay as they are. The server no longer sends `DGII_RECHAZO`, `EMISION_FALLIDA` or `GUARDADO_FALLIDO` (Tasks 5 and 6), and an unknown code falls to the retry flow, which is idempotent. The scan in `test-pos-sin-dgii.ts` does not flag them: `'DGII_RECHAZO'` is a code, not a word.

- [ ] **Step 6: VentaView: no chip, no banner, the silent resend stays**

In `src/pos/VentaView.tsx`:

1) In the header comment, replace:

```tsx
// - Envíos pendientes (F7): se reintentan cada 2 minutos, también con la
//   pantalla en uso. Si la DGII rechaza una venta ya entregada, queda una
//   alerta hasta que alguien la lea.
```

with:

```tsx
// - Envíos pendientes (F7): se reintentan solos cada 2 minutos, también con la
//   pantalla en uso y sin mostrar nada: el POS no se detiene ni avisa por la
//   DGII (decisión U3). Lo que haya que revisar lo ve el administrador en la app.
```

2) Replace the import:

```tsx
import { posApi, PosApiError, type EstadoPos, type FormaPago, type Reenvio, type TurnoCaja } from './api'
```

with:

```tsx
import { posApi, PosApiError, type EstadoPos, type FormaPago, type TurnoCaja } from './api'
```

3) Delete these two lines:

```tsx
  const [pendientes, setPendientes] = useState(0)
  const [rechazadas, setRechazadas] = useState<Reenvio['rechazadas']>([])
```

4) Replace the whole `reenviar` callback:

```tsx
  // Envíos pendientes (F7): al entrar y cada 2 minutos.
  const reenviar = useCallback(async () => {
    try {
      const r = await posApi.reenviarPendientes(equipo.token)
      if (!vivoRef.current) return
      setPendientes(r.pendientes)
      if (r.rechazadas.length > 0) {
        setRechazadas((prev) => [...prev, ...r.rechazadas.filter((x) => !prev.some((p) => p.factura_id === x.factura_id))])
      }
    } catch {
      // Sin red: se intenta en la próxima vuelta.
    }
  }, [equipo.token])
```

with:

```tsx
  // Envíos pendientes (F7): al entrar, cada 2 minutos y tras cada venta, en
  // silencio. La respuesta no se muestra: el cajero no ve nada de la DGII.
  const reenviar = useCallback(async () => {
    try {
      await posApi.reenviarPendientes(equipo.token)
    } catch {
      // Sin red: se intenta en la próxima vuelta.
    }
  }, [equipo.token])
```

5) Delete the chip:

```tsx
        {pendientes > 0 && (
          <span key={pendientes} className="pos-pendientes" title="Ventas que la DGII todavía no confirmó: se reenvían solas">
            <Icon name="clock" size={15} />{pendientes} <span className="ocultable">sin confirmar DGII</span>
          </span>
        )}
```

6) Delete the banner:

```tsx
      {rechazadas.length > 0 && (
        <div className="pos-alerta" role="alert">
          <Icon name="alert-triangle" size={18} />
          <span>
            <b>La DGII rechazó {rechazadas.length === 1 ? 'una venta que ya se había entregado' : `${rechazadas.length} ventas que ya se habían entregado`}:</b>{' '}
            {rechazadas.map((r) => `${r.e_ncf} (${r.motivo})`).join(' · ')} Avisa al supervisor.
          </span>
          <Btn size="sm" onClick={() => setRechazadas([])}>Entendido</Btn>
        </div>
      )}
```

- [ ] **Step 7: Sales lists without a DGII state**

In `src/pos/VentasDiaModal.tsx`:

1) Replace:

```tsx
import { diaLargo, estadoDgii, horaDe } from './estados'
```

with:

```tsx
import { diaLargo, horaDe, numeroVenta } from './estados'
```

2) Replace:

```tsx
                  <b>{v.e_ncf}{v.tipo_ecf === '31' && <span className="pos-etiqueta-cf">Crédito fiscal</span>}</b>
                  {v.cliente && <small className="pos-venta-cliente">{v.cliente}</small>}
                  <small>{horaDe(v.fecha)} · {v.forma_pago_nombre} · {estadoDgii(v.estado_dgii)}</small>
```

with:

```tsx
                  <b>{numeroVenta(v)}{v.tipo_ecf === '31' && <span className="pos-etiqueta-cf">Crédito fiscal</span>}</b>
                  {v.cliente && <small className="pos-venta-cliente">{v.cliente}</small>}
                  <small>{horaDe(v.fecha)} · {v.forma_pago_nombre}</small>
```

3) Replace:

```tsx
aria-label={`Reimprimir ${v.e_ncf}`}>
```

with:

```tsx
aria-label={`Reimprimir ${numeroVenta(v)}`}>
```

(That fragment is the tail of the line `<Btn size="sm" icon="printer" disabled={imprimiendo !== null} onClick={() => void reimprimir(v.factura_id)} aria-label={`Reimprimir ${v.e_ncf}`}>`; it occurs once in the file.)

In `src/pos/CajaModales.tsx` (the turn modal):

1) Replace:

```tsx
import { estadoDgii } from './estados'
```

with:

```tsx
import { numeroVenta } from './estados'
```

2) Replace:

```tsx
                <b>{v.e_ncf}</b>
                <small>{fechaHora(v.fecha).split(' ').slice(1).join(' ')} · {v.forma_pago_nombre} · {estadoDgii(v.estado_dgii)}</small>
```

with:

```tsx
                <b>{numeroVenta(v)}</b>
                <small>{fechaHora(v.fecha).split(' ').slice(1).join(' ')} · {v.forma_pago_nombre}</small>
```

3) Replace:

```tsx
aria-label={`Reimprimir ${v.e_ncf}`}>
```

with:

```tsx
aria-label={`Reimprimir ${numeroVenta(v)}`}>
```

(The tail of the line `<Btn size="sm" icon="printer" disabled={imprimiendo !== null} onClick={() => void reimprimir(v)} aria-label={`Reimprimir ${v.e_ncf}`}>`; it occurs once in this file.)

- [ ] **Step 8: Reword the RNC warning that names the DGII**

In `src/pos/ClienteRncModal.tsx`, replace:

```tsx
              <span>El registro dice que este contribuyente está <b>{fase.estado.toLowerCase()}</b>: la DGII podría rechazar el crédito fiscal.</span>
```

with:

```tsx
              <span>El registro dice que este contribuyente está <b>{fase.estado.toLowerCase()}</b>: puede que el crédito fiscal no le sirva. Confírmalo con el cliente.</span>
```

- [ ] **Step 9: Run the checks**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-pos-sin-dgii.ts | tail -1
node scripts/test-pos-cierre.ts | tail -1
node scripts/test-pos-ventas.ts | tail -1
node scripts/test-pos-montos.ts | tail -1
npm run -s typecheck
npx eslint . --ignore-pattern ds-bundle
npm run -s build
```

Expected:
- `test-pos-sin-dgii.ts`, `test-pos-cierre.ts` and `test-pos-montos.ts` end with `N/N OK`. `test-pos-ventas.ts` ends with `N/N ok` in lowercase;
- `typecheck`, `eslint` and `build` print no errors and exit 0. `build` may print chunk-size notices. `typecheck` also proves that no leftover use of `estadoDgii` remains in `src/pos`, and that the new scripts type-check.

Do not start `vite` or `npm run dev` (the `.env` proxies to production). The browser check against a local mock API is part of Task 16.

- [ ] **Step 10: Commit**

```bash
git add src/pos/estados.ts src/pos/api.ts src/pos/CobroModal.tsx src/pos/VentaView.tsx src/pos/VentasDiaModal.tsx src/pos/CajaModales.tsx src/pos/CierreModal.tsx src/pos/ClienteRncModal.tsx src/pos/reporteCierre.ts scripts/test-pos-cierre.ts scripts/test-pos-sin-dgii.ts
git commit -F - <<'EOF'
feat(pos): la caja ya no muestra nada de la DGII

Decision U3: el cajero no ve nada de la DGII. Fuera el aviso del cobro ("la
DGII no respondio..."), el contador "N sin confirmar DGII" y la alerta de
rechazo de la barra (el rechazo se atiende desde la app con "Reenviar a la
DGII"). Las listas de ventas del turno y del dia ya no muestran el estado. El
reporte de cierre que imprime la caja sale sin las listas de pendientes y
rechazadas (mostrarDgii: false); la reimpresion del administrador en la app
las conserva. El reenvio automatico cada 2 minutos sigue, en silencio.

Una venta que salio como factura simple no tiene e-NCF: numeroVenta y
tituloVenta la nombran sin "null", y su recibo (timbre null) se imprime como
cualquier otro. scripts/test-pos-sin-dgii.ts vigila que ningun texto de
src/pos nombre la DGII.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: FE app: avisos en el panel e-CF y Reenviar solo para rechazadas

**Files:**
- Everything is in the FE worktree, on the tree merged in Task 2. All 12 text anchors below were checked against a trial merge of `origin/main` into this branch: each one matches exactly once.
- Modify: `src/api/types.ts`. Add `AvisoSecuencia` and `AvisosEcf` below `StatsData`. The anchor is the line `  secuencias: StatsSecuencia[]` and its closing `}`.
- Modify: `src/api/stats.ts`. Add `getAvisosEcf`.
- Modify: `src/api/index.ts`. Change the line `export { getStats } from './stats'`.
- Create: `src/features/ecf/avisosEcf.ts`. Pure: the texts of the three alerts and their order.
- Modify: `src/features/ecf/EcfDashboardView.tsx`. The query, plus the banner above `<div className="dash-grid">`.
- Modify: `src/features/ecf/RangosNcfModal.tsx`. Registering a range also refreshes the banner. Anchor: the line `void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })`.
- Modify: `src/api/estadosDgii.ts`. Add `ESTADOS_REENVIABLES` and `puedeReenviarEstado`.
- Modify: `src/features/invoices/InvoiceDetailView.tsx`. The "Reenviar a la DGII" button reads `puedeReenviarEstado`. Anchor: the comment `// Mismas condiciones que el backend (handleReenviar)` and the `const puedeReenviar = [...]` statement.
- Test: `scripts/test-avisos-ecf.ts` (create) and `scripts/check-errores.ts` (add a section). `tsconfig.json` includes `scripts`, so `npm run typecheck` also type-checks both.

**Interfaces:**
- Consumes (Task 10): `GET /api/facturas/avisos` returns `{certificado_fallo:{ventas_hoy}, secuencias:[{tipo, ambiente, restantes, estado}], sin_rango:{ventas}}` inside the usual `{status:true, data}` envelope.
- Consumes (existing):
  - `getJson` (`src/api/http.ts`);
  - `useApiQuery` (a `['facturas', …]` key gets the volatile 20 s freshness from `src/config/cache.ts`; it returns `data: T | null` and an `error` string, with no global toast);
  - `ECF_TIPOS` (`src/config/ecf.ts`);
  - `RangosNcfModal` and `setRangosOpen` in the dashboard;
  - `reenviarFactura` and the "Reenviar a la DGII" button from `main`, which Task 2 merged (the detail view auto-merges with both sides kept).
- Produces:
  - `getAvisosEcf(): Promise<AvisosEcf>`, exported from `@/api`.
  - Types `AvisoSecuencia` and `AvisosEcf` in `src/api/types.ts`.
  - `listarAvisos(a: Partial<AvisosEcf> | null | undefined): AvisoEcf[]` and the constants `TEXTO_CERTIFICADO`, `TEXTO_AGOTADA` and `TEXTO_SIN_RANGO` in `src/features/ecf/avisosEcf.ts`. `listarAvisos` tolerates a backend that does not have the route yet.
  - `ESTADOS_REENVIABLES` and `puedeReenviarEstado(raw?: string | null): boolean` in `src/api/estadosDgii.ts`. The guard "an unconfirmed invoice is never resent from the app" is now a tested function.
- The banner copy is for the administrator in the app, so it may name the DGII. The cashier-facing copy is Task 11.
- The three alerts, in this order:
  - certificate: danger tone;
  - sequences, in the order the API sends them: `agotada` is danger, `pocos` is warning;
  - sales waiting for a range: warning tone.

  The sequence and waiting-sale alerts carry a button that opens "Rangos".

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-avisos-ecf.ts`:

```ts
// Avisos del e-CF para quien administra (src/features/ecf/avisosEcf.ts): lo que
// dice cada aviso del panel e-CF según GET /api/facturas/avisos. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-avisos-ecf.ts
import type { AvisosEcf } from '../src/api/types.ts'
import {
  listarAvisos, TEXTO_AGOTADA, TEXTO_CERTIFICADO, TEXTO_SIN_RANGO,
} from '../src/features/ecf/avisosEcf.ts'

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

const SIN_AVISOS: AvisosEcf = { certificado_fallo: { ventas_hoy: 0 }, secuencias: [], sin_rango: { ventas: 0 } }

console.log('Sin avisos')
igual('todo en cero: ninguno', listarAvisos(SIN_AVISOS), [])
igual('sin datos, o una API anterior que contesta otra cosa (una lista): ninguno',
  [listarAvisos(null), listarAvisos(undefined), listarAvisos([] as unknown as AvisosEcf)], [[], [], []])

console.log('Certificado')
igual('1 venta', listarAvisos({ ...SIN_AVISOS, certificado_fallo: { ventas_hoy: 1 } }), [{
  clave: 'certificado', tono: 'danger', icono: 'alert-triangle',
  titulo: 'El certificado falló: 1 venta del POS salió como factura simple',
  detalle: TEXTO_CERTIFICADO, accionRangos: false,
}])
igual('3 ventas: plural',
  listarAvisos({ ...SIN_AVISOS, certificado_fallo: { ventas_hoy: 3 } })[0]?.titulo,
  'El certificado falló: 3 ventas del POS salieron como factura simple')

console.log('Secuencias')
igual('pocos: E31 con 40', listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E31', ambiente: 'certecf', restantes: 40, estado: 'pocos' }] }), [{
  clave: 'secuencia-E31', tono: 'warning', icono: 'alert-triangle',
  titulo: 'Quedan pocos números de E31 · Factura de Crédito Fiscal',
  detalle: 'Quedan 40 en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.',
  accionRangos: true,
}])
igual('pocos con 1: "Queda 1"',
  listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E31', ambiente: 'certecf', restantes: 1, estado: 'pocos' }] })[0]?.detalle,
  'Queda 1 en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.')
igual('agotada: E32', listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E32', ambiente: 'certecf', restantes: 0, estado: 'agotada' }] }), [{
  clave: 'secuencia-E32', tono: 'danger', icono: 'alert-circle',
  titulo: 'Secuencia agotada: E32 · Factura de Consumo',
  detalle: TEXTO_AGOTADA, accionRangos: true,
}])
igual('un tipo fuera del catálogo se nombra solo con su código',
  listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E99', ambiente: 'certecf', restantes: 0, estado: 'agotada' }] })[0]?.titulo,
  'Secuencia agotada: E99')

console.log('Ventas esperando un rango')
igual('1 venta', listarAvisos({ ...SIN_AVISOS, sin_rango: { ventas: 1 } }), [{
  clave: 'sin-rango', tono: 'warning', icono: 'clock',
  titulo: '1 venta esperando un rango autorizado',
  detalle: TEXTO_SIN_RANGO, accionRangos: true,
}])
igual('4 ventas: plural',
  listarAvisos({ ...SIN_AVISOS, sin_rango: { ventas: 4 } })[0]?.titulo, '4 ventas esperando un rango autorizado')

console.log('Orden')
igual('certificado, luego las secuencias en el orden de la API, luego las ventas sin rango',
  listarAvisos({
    certificado_fallo: { ventas_hoy: 2 },
    secuencias: [
      { tipo: 'E32', ambiente: 'certecf', restantes: 0, estado: 'agotada' },
      { tipo: 'E31', ambiente: 'certecf', restantes: 12, estado: 'pocos' },
    ],
    sin_rango: { ventas: 4 },
  }).map((a) => a.clave),
  ['certificado', 'secuencia-E32', 'secuencia-E31', 'sin-rango'])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
```

In `scripts/check-errores.ts`, replace the import:

```ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'
```

with:

```ts
import { ESTADOS_EN_VUELO, dgiiLabel, isEnVuelo, isRechazo, puedeReenviarEstado } from '../src/api/estadosDgii.ts'
```

and, directly after the existing three-line statement that ends the estados section:

```ts
igual('isRechazo no cambia: RECHAZADO, RECHAZADO_ARCHIVADO y RFCE_RECHAZADO',
  ['RECHAZADO', 'RECHAZADO_ARCHIVADO', 'RFCE_RECHAZADO', 'ENVIO_INCIERTO', 'NO_ENCONTRADO_ARCHIVADO'].map(isRechazo),
  [true, true, true, false, false])
```

add this block (before the `// --- Textos de la emisión` section):

```ts

// Reenviar a la DGII (decisión U7): solo un comprobante RECHAZADO o NO_ENCONTRADO,
// sin archivar. Uno sin confirmar (en vuelo, ENVIADO, EN_PROCESO) NUNCA se
// reenvía desde la app: lo resuelve soporte o, en el POS, el reenvío automático.
igual('puedeReenviarEstado: solo RECHAZADO, RFCE_RECHAZADO y NO_ENCONTRADO',
  [
    'RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO',
    'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO',
    'ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'ERROR', 'RECHAZADO_ARCHIVADO', 'NO_ENCONTRADO_ARCHIVADO',
    null, undefined, '',
  ].map(puedeReenviarEstado),
  [true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false])
chk('un comprobante en vuelo nunca se reenvía desde la app', ESTADOS_EN_VUELO.every((e) => !puedeReenviarEstado(e)))
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
node scripts/test-avisos-ecf.ts; echo "exit=$?"
node scripts/check-errores.ts; echo "exit=$?"
```

Expected:
- `test-avisos-ecf.ts` stops with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/features/ecf/avisosEcf.ts'`, and the exit code is not 0.
- `check-errores.ts` stops with `SyntaxError: The requested module '../src/api/estadosDgii.ts' does not provide an export named 'puedeReenviarEstado'`, and the exit code is not 0.

- [ ] **Step 3: API types and call**

In `src/api/types.ts`, directly below

```ts
  secuencias: StatsSecuencia[]
}
```

(the end of `StatsData`) add:

```ts

// ---------------------------------------------------------------------------
// Avisos del e-CF para quien administra — GET /api/facturas/avisos
// ---------------------------------------------------------------------------

export interface AvisoSecuencia {
  /** 'E31'. */
  tipo: string
  ambiente: string
  /** Números libres en los rangos vigentes; 0 si está agotada. */
  restantes: number | null
  /** pocos: 50 o menos libres. agotada: ya no hay. */
  estado: 'pocos' | 'agotada'
}

export interface AvisosEcf {
  /** Ventas del POS de hoy que salieron como factura simple porque el e-CF no se pudo generar. */
  certificado_fallo: { ventas_hoy: number }
  secuencias: AvisoSecuencia[]
  /** Ventas del POS con el número siguiente al último de su rango, sin enviar: esperan un rango autorizado. */
  sin_rango: { ventas: number }
}
```

Replace the whole content of `src/api/stats.ts` with:

```ts
// Servicio: estadísticas y avisos e-CF.
import { getJson } from './http'
import type { AvisosEcf, StatsData } from './types'

export function getStats(): Promise<StatsData> {
  return getJson<StatsData>('/api/facturas/stats')
}

/** Avisos para el administrador (certificado, secuencias, ventas sin rango): solo lectura. */
export function getAvisosEcf(): Promise<AvisosEcf> {
  return getJson<AvisosEcf>('/api/facturas/avisos')
}
```

In `src/api/index.ts`, replace:

```ts
export { getStats } from './stats'
```

with:

```ts
export { getStats, getAvisosEcf } from './stats'
```

- [ ] **Step 4: The pure module that says what each alert says**

Create `src/features/ecf/avisosEcf.ts`:

```ts
// Avisos para quien administra el e-CF (GET /api/facturas/avisos; spec del POS y
// "Reenviar a la DGII" sobre el write-ahead, 4.6). Salen en el panel de e-CF de
// la app y nunca en la caja. Aquí está lo que dice cada uno. Sin React:
// scripts/test-avisos-ecf.ts lo prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { AvisosEcf } from '@/api'
import { ECF_TIPOS } from '../../config/ecf.ts'

export interface AvisoEcf {
  /** Estable: clave de React y de las pruebas. */
  clave: string
  tono: 'warning' | 'danger'
  icono: 'alert-triangle' | 'alert-circle' | 'clock'
  titulo: string
  detalle: string
  /** true = lleva el botón que abre Rangos (registrar un rango autorizado). */
  accionRangos: boolean
}

export const TEXTO_CERTIFICADO =
  'Esas ventas no son comprobantes fiscales: no tienen e-NCF, no llevan ITBIS y no se enviaron a la DGII. Revisa el certificado digital; cuando funcione, las ventas nuevas vuelven a salir como e-CF. Consulta con tu contador cómo regularizarlas.'
export const TEXTO_AGOTADA =
  'No quedan números libres en un rango autorizado. Registra el nuevo rango para poder emitir este tipo de comprobante.'
export const TEXTO_SIN_RANGO =
  'Se imprimieron con el número siguiente al último de su rango y todavía no se enviaron a la DGII. Se envían solas cuando registres un rango autorizado que incluya esos números.'

/** "E31 · Factura de Crédito Fiscal"; solo el código si el tipo no está en el catálogo. */
function etiquetaTipo(tipo: string): string {
  const nombre = ECF_TIPOS.find((t) => t.code === tipo.replace(/^E/i, ''))?.nombre
  return nombre ? `${tipo} · ${nombre}` : tipo
}

/** Entero >= 0; lo que no es un número (o llega vacío) cuenta como 0. */
function entero(v: unknown): number {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Los avisos que hay que mostrar, en este orden: certificado, secuencias (en el
 * orden de la API) y ventas esperando un rango. Tolera datos que faltan o una
 * API anterior que no tiene la ruta (contesta otra cosa): sin avisos.
 */
export function listarAvisos(a: Partial<AvisosEcf> | null | undefined): AvisoEcf[] {
  const avisos: AvisoEcf[] = []

  const simples = entero(a?.certificado_fallo?.ventas_hoy)
  if (simples > 0) {
    avisos.push({
      clave: 'certificado',
      tono: 'danger',
      icono: 'alert-triangle',
      titulo: simples === 1
        ? 'El certificado falló: 1 venta del POS salió como factura simple'
        : `El certificado falló: ${simples} ventas del POS salieron como factura simple`,
      detalle: TEXTO_CERTIFICADO,
      accionRangos: false,
    })
  }

  for (const s of a?.secuencias ?? []) {
    const etiqueta = etiquetaTipo(String(s.tipo ?? ''))
    if (s.estado === 'agotada') {
      avisos.push({
        clave: `secuencia-${s.tipo}`,
        tono: 'danger',
        icono: 'alert-circle',
        titulo: `Secuencia agotada: ${etiqueta}`,
        detalle: TEXTO_AGOTADA,
        accionRangos: true,
      })
    } else if (s.estado === 'pocos') {
      const n = entero(s.restantes)
      const cuantos = n === 1 ? 'Queda 1' : n > 1 ? `Quedan ${n}` : 'Quedan pocos'
      avisos.push({
        clave: `secuencia-${s.tipo}`,
        tono: 'warning',
        icono: 'alert-triangle',
        titulo: `Quedan pocos números de ${etiqueta}`,
        detalle: `${cuantos} en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.`,
        accionRangos: true,
      })
    }
  }

  const sinRango = entero(a?.sin_rango?.ventas)
  if (sinRango > 0) {
    avisos.push({
      clave: 'sin-rango',
      tono: 'warning',
      icono: 'clock',
      titulo: sinRango === 1
        ? '1 venta esperando un rango autorizado'
        : `${sinRango} ventas esperando un rango autorizado`,
      detalle: TEXTO_SIN_RANGO,
      accionRangos: true,
    })
  }

  return avisos
}
```

- [ ] **Step 5: Who may use "Reenviar a la DGII"**

In `src/api/estadosDgii.ts`, directly after

```ts
export function isEnVuelo(raw?: string | null): boolean {
  return (ESTADOS_EN_VUELO as readonly string[]).includes(raw ?? '')
}
```

add:

```ts

/**
 * Estados desde los que la app deja usar "Reenviar a la DGII" (POST
 * /api/facturas/{id}/reenviar): solo un comprobante que la DGII rechazó o no
 * encontró. Uno sin confirmar (en vuelo, ENVIADO, EN_PROCESO) NUNCA se reenvía
 * desde la app: lo resuelve soporte o, en el POS, el reenvío automático. Mismos
 * estados que handleReenviar en la API.
 */
export const ESTADOS_REENVIABLES = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'] as const

/** ¿Se puede ofrecer "Reenviar a la DGII" para este estado? */
export function puedeReenviarEstado(raw?: string | null): boolean {
  return (ESTADOS_REENVIABLES as readonly string[]).includes(raw ?? '')
}
```

In `src/features/invoices/InvoiceDetailView.tsx`:

1) Below the line `import { textoPieDocumento, textoTarjetaEnVuelo } from './enVuelo'` add:

```tsx
import { puedeReenviarEstado } from '@/api/estadosDgii'
```

2) Replace:

```tsx
  // Mismas condiciones que el backend (handleReenviar): rechazado sin archivar y
  // con la secuencia sin consumir (o sin la bandera, que se trata igual).
  const puedeReenviar = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'].includes(estadoRaw ?? '')
    && estadoData?.secuencia_utilizada !== true
```

with:

```tsx
  // Mismas condiciones que el backend (handleReenviar): solo un comprobante que
  // la DGII rechazó, sin archivar y con la secuencia sin consumir (o sin la
  // bandera, que se trata igual). Uno sin confirmar nunca se reenvía desde la app.
  const puedeReenviar = puedeReenviarEstado(estadoRaw) && estadoData?.secuencia_utilizada !== true
```

- [ ] **Step 6: Run the pure tests**

```bash
node scripts/test-avisos-ecf.ts | tail -1
node scripts/check-errores.ts | tail -1
node scripts/test-en-vuelo.ts | tail -1
```

Expected: each ends with `N/N OK`.

- [ ] **Step 7: The banner on the e-CF dashboard**

In `src/features/ecf/EcfDashboardView.tsx`:

1) Replace:

```tsx
import { getStats, formatApiDate } from '@/api'
```

with:

```tsx
import { getStats, getAvisosEcf, formatApiDate } from '@/api'
```

2) Below the line `import { contarSinConfirmar } from '@/features/invoices/enVuelo'` add:

```tsx
import { listarAvisos } from './avisosEcf'
```

3) Replace:

```tsx
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const d = stats.data
  const [rangosOpen, setRangosOpen] = useState(false)
```

with:

```tsx
  const stats = useApiQuery(['facturas', 'stats'], () => getStats())
  const d = stats.data
  const [rangosOpen, setRangosOpen] = useState(false)
  // Avisos para el administrador (certificado, secuencias, ventas sin rango). Si
  // la consulta falla, simplemente no hay banner: no estorba al resto del panel.
  const avisos = useApiQuery(['facturas', 'avisos'], () => getAvisosEcf())
  const listaAvisos = listarAvisos(avisos.data)
```

4) Directly above the line `          <div className="dash-grid">` (10 spaces of indentation) add:

```tsx
          {listaAvisos.length > 0 && (
            <div className="col gap-sm" style={{ marginBottom: 14 }}>
              {listaAvisos.map((a) => (
                <div key={a.clave} role="alert" className="card card-pad row gap-sm between"
                  style={{ background: a.tono === 'danger' ? 'var(--danger-soft)' : 'var(--warning-soft)', borderColor: 'transparent' }}>
                  <div className="row gap-sm" style={{ alignItems: 'flex-start' }}>
                    <Icon name={a.icono} size={16}
                      style={{ color: a.tono === 'danger' ? 'var(--danger)' : 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div className="fw6 text-sm">{a.titulo}</div>
                      <div className="text-sm mt-sm">{a.detalle}</div>
                    </div>
                  </div>
                  {a.accionRangos && (
                    <Btn variant="secondary" size="sm" icon="hash" onClick={() => setRangosOpen(true)}>Rangos</Btn>
                  )}
                </div>
              ))}
            </div>
          )}
```

In `src/features/ecf/RangosNcfModal.tsx`, below the line `      void queryClient.invalidateQueries({ queryKey: ['facturas', 'stats'] })` add:

```tsx
      void queryClient.invalidateQueries({ queryKey: ['facturas', 'avisos'] })
```

- [ ] **Step 8: Run all the checks**

```bash
node scripts/test-avisos-ecf.ts | tail -1
node scripts/check-errores.ts | tail -1
node scripts/test-en-vuelo.ts | tail -1
node scripts/test-notas-vinculadas.ts | tail -1
npm run -s typecheck
npx eslint . --ignore-pattern ds-bundle
npm run -s build
```

Expected:
- every script ends with `N/N OK`;
- `typecheck`, `eslint` and `build` exit 0 with no errors.

Do not start `vite` or `npm run dev`. The banner is checked in the browser against the local mock API in Task 16.

- [ ] **Step 9: Commit**

```bash
git add src/api/types.ts src/api/stats.ts src/api/index.ts src/api/estadosDgii.ts src/features/ecf/avisosEcf.ts src/features/ecf/EcfDashboardView.tsx src/features/ecf/RangosNcfModal.tsx src/features/invoices/InvoiceDetailView.tsx scripts/test-avisos-ecf.ts scripts/check-errores.ts
git commit -F - <<'EOF'
feat(ecf): avisos del e-CF en el panel y Reenviar a la DGII solo para rechazadas

El panel de e-CF muestra tres avisos para quien administra (GET
/api/facturas/avisos, spec 4.6): el certificado fallo y N ventas del POS
salieron como factura simple, quedan pocos numeros o se agoto la secuencia de
un tipo, y N ventas esperan un rango autorizado. Los de secuencia y rango traen
el boton Rangos; registrar un rango refresca el aviso. listarAvisos es pura y
tolera una API que aun no tiene la ruta (scripts/test-avisos-ecf.ts).

"Reenviar a la DGII" queda solo para RECHAZADO, RFCE_RECHAZADO y NO_ENCONTRADO:
puedeReenviarEstado es la unica regla (la usa el detalle de la factura) y
check-errores.ts exige que un comprobante sin confirmar nunca se reenvie desde
la app.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


### Task 13: Entorno de pruebas del POS sobre las bases scratch

**Files:**
- Create: `tools/pos_scratch_guard.php` (the guard), `tools/pos_scratch_prepare.php` (idempotent preparation of the master, two tenants, users and testecf ranges) and `tools/test_pos_scratch.php` (the runner: mock DGII, two API instances, the suites in series, no secrets on screen).
- Create: `tools/test_pos_scratch_puro.php`: DB-free checks of the guard, the derived secrets, the environments, the API root check and the output filter.
- Modify: `tools/write_ahead_test_lib.php`: `wa_servidor` gains a last optional parameter `string $raiz = ''` so the runner can serve another checkout (Step 6).
- Create, in the session scratchpad only: `$S/aplicar_lib.php` (exact-match editor, also used by Tasks 14 and 15) and `$S/aplicar_servidor.php`.
- Test: the DB-free test, then a BASELINE run of the four suites of `origin/master` against pristine `origin/master` code. The baseline is also the test of the preparation and the runner.

`$S` is the scratchpad directory your system prompt lists. Paths are relative to the API worktree `C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead`, on the tree after Task 1 (merge with `origin/master`).

Facts this task rests on (read-only checks of 2026-10-12, repeated by the verifier with read-only queries; none is a credential):
- The four suites delete and create data on purpose. Their environment (`POS_TEST_BASE`, `POS_TEST_ADMIN_A/B`, `POS_TEST_USER_A`, `POS_TEST_PASS`, `MASTER_DB_*`, `POS_TEST_DGII_MOCK_DIR`, `DGII_ECF_BASE_URL`, `DGII_FC_BASE_URL`, `RNC_CONSULTA_URL`, `POS_DGII_TIMEOUT`) is in the headers of `test_pos_venta.php` and `test_pos_e31.php`. They hardcode `ambiente = 'testecf'`, so both tenants are `testecf`.
- The master tables the POS needs (`tenants`, `pos_equipos`, `pos_handoff_codes`) are in `db/master_schema.sql`. An admin login returns its permissions, so the master also needs `roles` and `role_permissions` rows per tenant (`config/permissions.php` `'defaults'`: `admin => ['*']`, `user => $USER_MODULES`); the skeleton's list of master tables does not name them. `TenantResolver::encrypt/decrypt` are public static; `tools/create_tenant.php:364` binds `db_pass_encrypted` with `PDO::PARAM_LOB` (PDO adds the `_binary` prefix, checked against the scratch server).
- Scratch state: `wa_scratch` has `estado_dgii` VARCHAR(40) and `uk_e_ncf_amb`; `wa_scratch_sin_gate` has VARCHAR(20) and `uk_e_ncf` (no 027/028). Both have the POS columns and tables, `roles`/`role_permissions` (tenant 0 rows), `audit_logs` and `dgii_provincia_municipio` from the tenant schema, 62 `unidades_medida` rows, and a `testecf` range for E31/E32 (`numero_hasta` NULL). Their `users`/`api_tokens` are the single-tenant versions and `unidades_medida` lacks `permite_decimales`. Neither has `tenants`, `pos_equipos` or `pos_handoff_codes`. The test user has no `CREATE DATABASE` grant: the scratch bases cannot be copied or recreated.
- `Database::loadEnv()` and `MasterDatabase::loadEnv()` read `<raiz>/.env` and fill every key not already in `$_ENV`: an API root with a `.env` could send a request without tenant to the database that file names. The worktree and a `git archive` have none; the runner refuses a root that has one (Step 7).

Design decisions: (1) the master role is `wa_scratch_sin_gate`, tenant A is `wa_scratch` (rows only) and tenant B is `wa_scratch_sin_gate` itself; its 027/028 gate is never touched. (2) `tenant_id` is added NULL-able and without a foreign key to `users` and `api_tokens`, because the single-tenant Release 1 suites also use that copy. (3) The secrets are derived from `WA_DB_PASS`: no new file to protect, nothing to print. (4) Two API instances on the same base (`8299` and `8297`, plus `WA_PUERTO_OFFSET`): `php -S` serves one request at a time and Windows has no `PHP_CLI_SERVER_WORKERS`, so Task 14's concurrency scenarios need two processes; the second runs with `POS_DGII_TIMEOUT=30` to outlast the mock's 8 s `lento` mode.

**Interfaces:**
- Consumes: the Task 1 tree (the four suites, `tools/mock_dgii_local.php`, `db/master_schema.sql`, `config/permissions.php`, `src/TenantResolver.php`) and from `tools/write_ahead_test_lib.php`: `wa_chk`, `wa_fin`, `wa_arg`, `wa_php_flags`, `wa_servidor`, `wa_credenciales`, `wa_base_real`, `wa_pdo`, `wa_sembrar`, `wa_cert_prueba`.
- Produces:

```php
// tools/pos_scratch_guard.php (autonomous: the suites require it; it opens no connection)
const POS_SCRATCH_MARCA = 'zz_write_ahead_scratch';
const POS_SCRATCH_PATRON_BASE = '/(^|_)wa_scratch(_sin_gate)?$/';
function pos_scratch_es_loopback(string $host): bool
function pos_scratch_decidir(string $host, array $bases): array     // ['ok' => bool, 'motivo' => string]; $bases = real name => has the mark
function pos_scratch_exigir(PDO $pdo, string $host, array $nombres): void   // exit(2) with a [FALLO] line if it refuses

// tools/pos_scratch_prepare.php (library + CLI)
function pos_scratch_secretos(string $base): array        // ['clave_maestra' (64 hex), 'pepper' (64 hex), 'clave_usuarios' (32 hex)]
function pos_scratch_tiene_columna(PDO $pdo, string $real, string $tabla, string $columna): bool
function pos_scratch_ddl_master(string $tabla): string    // the CREATE TABLE block of db/master_schema.sql
function pos_scratch_preparar(): array                    // ['master' => real name, 'dbA', 'dbB', 'tenantA' => id, 'tenantB' => id, 'cred' => array]

// tools/test_pos_scratch.php (library + CLI)
function pos_scratch_env_api(array $cred, string $master, array $secretos, string $mockUrl, array $cert, bool $enforce): array
function pos_scratch_env_suites(array $cred, string $master, array $secretos, string $api, string $api2, string $mockUrl, string $mockDir): array
function pos_scratch_revisar_raiz(string $raiz): string   // '' if the root can be tested; else the reason (no index.php or simulator, or a .env)
function pos_scratch_resumen(string $salida): ?array      // ['total' => int, 'fallos' => int] | null
function pos_scratch_enmascarar(string $texto, array $secretos): string
function pos_scratch_filtrar(string $salida, array $secretos): string
function pos_scratch_correr_suite(string $ruta, string $raiz, array $env): array   // ['codigo' => int, 'salida' => string]

// tools/write_ahead_test_lib.php
function wa_servidor(string $nombre, string $router, int $puerto, array $env = [], string $raiz = ''): string
```

The suites receive `POS_TEST_BASE` and `POS_TEST_BASE_2` (both with `/api`), the users `admin_pos_a`, `admin_pos_b` and `user_pos_a` with a derived password, `MASTER_DB_*` pointing at `wa_scratch_sin_gate`, `POS_TEST_DGII_MOCK_DIR` and the local DGII and RNC URLs.

- [ ] **Step 1: Check the tree and the PHP extensions**

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
cd "$A"
git status --short
ls tools/test_pos_backend.php tools/test_pos_venta.php tools/test_pos_cierre.php tools/test_pos_e31.php tools/mock_dgii_local.php db/master_schema.sql config/permissions.php tools/write_ahead_test_lib.php
git check-ignore -q tools/.env && echo "tools/.env ignorado" || echo "sin tools/.env: usar WA_DB_* en el entorno"
php -m | grep -i -E "^(curl|openssl|pdo_mysql|mbstring)$"
```

Expected: the status shows only `?? tools/reconstruir_e340000000001.sql` (never `git add -A`); the eight paths print with no `No such file` (otherwise Task 1 is not done: stop); one of the two `.env` lines (`tools/.env` is never opened or printed); `php -m` prints only `mbstring`, so curl, openssl and pdo_mysql need the `-d` flags.

- [ ] **Step 2: Write the failing test `tools/test_pos_scratch_puro.php`**

```php
<?php
/**
 * test_pos_scratch_puro.php — lo del entorno de pruebas del POS que no necesita base de datos: la
 * guarda de las bases, los secretos derivados, el entorno de la API y las suites, la revision de la
 * raiz a probar y el filtro de lo que se imprime de una suite.   Uso:  php tools/test_pos_scratch_puro.php
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/pos_scratch_guard.php';
require_once __DIR__ . '/pos_scratch_prepare.php';
require_once __DIR__ . '/test_pos_scratch.php';

echo "1) Guarda de las bases\n";
$remoto = static fn(array $bases): bool => pos_scratch_decidir('db.example.com', $bases)['ok'];
wa_chk('servidor local: pasa aunque la base no tenga marca ni el nombre', pos_scratch_decidir('127.0.0.1', ['gratex_master' => false])['ok'] === true);
wa_chk('local son localhost, LOCALHOST, ::1 y [::1]; no 127.0.0.2, localhost.example.com ni vacio',
    pos_scratch_es_loopback('localhost') && pos_scratch_es_loopback('LOCALHOST') && pos_scratch_es_loopback('::1') && pos_scratch_es_loopback('[::1]')
    && !pos_scratch_es_loopback('127.0.0.2') && !pos_scratch_es_loopback('localhost.example.com') && !pos_scratch_es_loopback(''));
wa_chk('remoto con la master y el tenant marcados y bien nombrados: pasa', $remoto(['smhynzte_wa_scratch' => true, 'smhynzte_wa_scratch_sin_gate' => true]));
$sinMarca = pos_scratch_decidir('db.example.com', ['smhynzte_wa_scratch' => true, 'smhynzte_wa_scratch_sin_gate' => false]);
wa_chk('remoto con una base sin la marca: se niega y nombra la base', $sinMarca['ok'] === false
    && str_contains($sinMarca['motivo'], 'smhynzte_wa_scratch_sin_gate') && str_contains($sinMarca['motivo'], POS_SCRATCH_MARCA), $sinMarca);
wa_chk('remoto con otro nombre se niega aunque tenga la marca: wa_sin_marca, la de produccion, zzwa_scratch, wa_scratch_sin_gate_viejo',
    !$remoto(['smhynzte_wa_sin_marca' => true]) && !$remoto(['smhynzte_new_gratexdb' => true]) && !$remoto(['zzwa_scratch' => true])
    && !$remoto(['smhynzte_wa_scratch_sin_gate_viejo' => true]) && $remoto(['wa_scratch' => true]));
wa_chk('remoto sin ninguna base que comprobar: se niega', !$remoto([]));

echo "2) Secretos derivados de la clave de la base\n";
$s = pos_scratch_secretos('clave-de-prueba');
wa_chk('clave maestra y pepper de 64 hex, clave de usuarios de 32 hex',
    preg_match('/^[0-9a-f]{64}$/', $s['clave_maestra']) === 1 && preg_match('/^[0-9a-f]{64}$/', $s['pepper']) === 1
    && preg_match('/^[0-9a-f]{32}$/', $s['clave_usuarios']) === 1);
wa_chk('estables, distintos entre si y de la clave de la base', $s === pos_scratch_secretos('clave-de-prueba') && count(array_unique($s)) === 3
    && !in_array('clave-de-prueba', $s, true) && $s !== pos_scratch_secretos('otra-clave'));

echo "3) Entorno de la API y de las suites\n";
$cred = ['host' => 'db.example.com', 'port' => '3306', 'user' => 'u_prueba', 'pass' => 'clave-de-prueba'];
$cert = ['path' => '/tmp/cert.p12', 'password' => 'clave-del-cert'];
$envApi = pos_scratch_env_api($cred, 'smhynzte_wa_scratch_sin_gate', $s, 'http://127.0.0.1:8298', $cert, false);
wa_chk('API: multi-tenant, master de prueba, DGII y RNC simulados, sin DB_*, con la clave maestra y el pepper de prueba',
    $envApi['MULTI_TENANT_ENABLED'] === 'true' && $envApi['MASTER_DB_NAME'] === 'smhynzte_wa_scratch_sin_gate'
    && $envApi['DGII_ECF_BASE_URL'] === 'http://127.0.0.1:8298' && $envApi['RNC_CONSULTA_URL'] === 'http://127.0.0.1:8298/rnc/consulta'
    && !array_key_exists('DB_NAME', $envApi) && $envApi['MASTER_ENCRYPTION_KEY'] === $s['clave_maestra'] && $envApi['POS_PIN_PEPPER'] === $s['pepper']
    && $envApi['PERMISSIONS_ENFORCE'] === 'false' && pos_scratch_env_api($cred, 'x', $s, 'http://127.0.0.1:8298', $cert, true)['PERMISSIONS_ENFORCE'] === 'true');
$envSuites = pos_scratch_env_suites($cred, 'smhynzte_wa_scratch_sin_gate', $s, 'http://127.0.0.1:8299', 'http://127.0.0.1:8297', 'http://127.0.0.1:8298', '/tmp/mock');
wa_chk('suites: las dos APIs con /api, los tres usuarios, la clave y la carpeta del mock; nada apunta a produccion',
    $envSuites['POS_TEST_BASE'] === 'http://127.0.0.1:8299/api' && $envSuites['POS_TEST_BASE_2'] === 'http://127.0.0.1:8297/api'
    && $envSuites['POS_TEST_ADMIN_A'] === 'admin_pos_a' && $envSuites['POS_TEST_USER_A'] === 'user_pos_a' && $envSuites['POS_TEST_PASS'] === $s['clave_usuarios']
    && $envSuites['POS_TEST_DGII_MOCK_DIR'] === '/tmp/mock'
    && array_filter(array_merge($envApi, $envSuites), static fn($v) => preg_match('#gratex\.net|fiscalpoint\.com\.do#', (string) $v) === 1) === []);
$raizTmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_raiz_' . getmypid();
mkdir($raizTmp . DIRECTORY_SEPARATOR . 'tools', 0777, true);
$sinNada = pos_scratch_revisar_raiz($raizTmp);
file_put_contents($raizTmp . '/index.php', '<?php');
file_put_contents($raizTmp . '/tools/mock_dgii_local.php', '<?php');
$buena = pos_scratch_revisar_raiz($raizTmp);
file_put_contents($raizTmp . '/.env', 'DB_NAME=otra');
$conEnv = pos_scratch_revisar_raiz($raizTmp);
foreach (['/.env', '/index.php', '/tools/mock_dgii_local.php'] as $f) {
    @unlink($raizTmp . $f);
}
@rmdir($raizTmp . '/tools');
@rmdir($raizTmp);
wa_chk('raiz a probar: sin index.php o sin el simulador no sirve; con los dos si; con un .env tampoco (Database lo cargaria)',
    $sinNada !== '' && $buena === '' && str_contains($conEnv, '.env'), [$sinNada, $buena, $conEnv]);

echo "4) Resumen de una suite\n";
wa_chk('"TODO OK (48 verificaciones)", "3 de 48 FALLARON" y "12 de 14 pruebas OK", tambien con fin de linea de Windows',
    pos_scratch_resumen("...\nTODO OK (48 verificaciones)\n") === ['total' => 48, 'fallos' => 0]
    && pos_scratch_resumen("x\n3 de 48 FALLARON\n") === ['total' => 48, 'fallos' => 3]
    && pos_scratch_resumen("\n12 de 14 pruebas OK\n") === ['total' => 14, 'fallos' => 2]
    && pos_scratch_resumen("a\r\nTODO OK (5 verificaciones)\r\n") === ['total' => 5, 'fallos' => 0]);
wa_chk('sin resumen: null', pos_scratch_resumen("PHP Fatal error: algo\n") === null);

echo "5) Lo que se imprime de una suite\n";
$ocultos = ['clave-de-prueba', 'db.example.com', $s['clave_usuarios']];
$token = str_repeat('ab', 32);
$f = pos_scratch_filtrar("1. Turno\n  [OK  ] abre\n  [FALLO] el cobro de {$s['clave_usuarios']}\n         obtenido: {\"token\":\"{$token}\",\"h\":\"db.example.com\"}\n  [OK  ] otra\n\n2 de 9 FALLARON\n", $ocultos);
wa_chk('deja el FALLO, su "obtenido:" y el resumen; quita los OK y los titulos; tapa la clave, el host y el token de 64 hex',
    str_contains($f, '[FALLO] el cobro') && str_contains($f, 'obtenido:') && str_contains($f, '2 de 9 FALLARON') && !str_contains($f, '[OK  ]')
    && !str_contains($f, '1. Turno') && !str_contains($f, $s['clave_usuarios']) && !str_contains($f, 'db.example.com') && !str_contains($f, $token), $f);
$f = pos_scratch_filtrar("PHP Fatal error:  Uncaught PDOException: SQLSTATE[HY000] [2002] getaddrinfo for db.example.com failed in /x/y.php:12\nStack trace:\n#0 usuario@db.example.com\n", $ocultos);
wa_chk('una excepcion sin atrapar sale solo con su clase: ni host ni mensaje', $f === '[FALLO] excepcion sin atrapar: PDOException', $f);
$f = pos_scratch_filtrar("PHP Fatal error:  Call to undefined method Foo::bar() in /x/y.php:7\n", $ocultos);
wa_chk('un error fatal de motor conserva su texto, sin archivo ni linea', $f === '[FALLO] PHP Fatal error:  Call to undefined method Foo::bar()', $f);

echo "6) Lo que la preparacion lee del repo\n";
$ddl = array_map('pos_scratch_ddl_master', ['tenants', 'pos_handoff_codes', 'pos_equipos']);
wa_chk('las tres tablas del master salen de db/master_schema.sql, cada una con su CREATE TABLE IF NOT EXISTS',
    preg_match('/^CREATE TABLE IF NOT EXISTS tenants \(/', $ddl[0]) === 1 && str_contains($ddl[1], 'fk_pos_handoff_tenant')
    && str_contains($ddl[2], 'uq_pos_equipo_token') && substr_count(implode('', $ddl), 'CREATE TABLE') === 3);
$defaults = (require dirname(__DIR__) . '/config/permissions.php')['defaults'];
wa_chk('config/permissions.php: el admin tiene "*" y el user tiene facturas pero no pos',
    $defaults['admin'] === ['*'] && in_array('facturas', $defaults['user'], true) && !in_array('pos', $defaults['user'], true));

wa_fin();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_pos_scratch_puro.php; echo "exit=$?"
```

Expected: `Warning: require_once(...tools/pos_scratch_guard.php): Failed to open stream: No such file or directory`, then `Fatal error: Uncaught Error: Failed opening required`. The exit code is not 0 (255).

- [ ] **Step 4: Write the guard `tools/pos_scratch_guard.php`**

```php
<?php
/**
 * pos_scratch_guard.php — guarda de las suites del POS (tools/test_pos_*.php), que borran y
 * crean datos a proposito. Corren solo si el MySQL es local (127.0.0.1, localhost, ::1) o si
 * TODA base que tocan tiene la tabla marca zz_write_ahead_scratch y un nombre que termina en
 * wa_scratch o wa_scratch_sin_gate. Autonoma (la usan las suites) y sin conexiones al incluirla.
 */

const POS_SCRATCH_MARCA = 'zz_write_ahead_scratch';
const POS_SCRATCH_PATRON_BASE = '/(^|_)wa_scratch(_sin_gate)?$/';

function pos_scratch_es_loopback(string $host): bool
{
    return in_array(strtolower(trim($host)), ['127.0.0.1', 'localhost', '::1', '[::1]'], true);
}

/**
 * Pura. @param array<string,bool> $bases nombre real de cada base => si tiene la tabla marca
 * @return array{ok: bool, motivo: string}
 */
function pos_scratch_decidir(string $host, array $bases): array
{
    if (pos_scratch_es_loopback($host)) {
        return ['ok' => true, 'motivo' => 'servidor local'];
    }
    if ($bases === []) {
        return ['ok' => false, 'motivo' => 'no hay ninguna base que comprobar'];
    }
    $rechazadas = [];
    foreach ($bases as $nombre => $tieneMarca) {
        if (preg_match(POS_SCRATCH_PATRON_BASE, (string) $nombre) !== 1) {
            $rechazadas[] = $nombre . ' (su nombre no termina en wa_scratch ni en wa_scratch_sin_gate)';
        } elseif ($tieneMarca !== true) {
            $rechazadas[] = $nombre . ' (no tiene la tabla ' . POS_SCRATCH_MARCA . ')';
        }
    }
    return $rechazadas === []
        ? ['ok' => true, 'motivo' => 'bases de prueba marcadas']
        : ['ok' => false, 'motivo' => 'servidor remoto y ' . implode('; ', $rechazadas)];
}

/** Corta con codigo 2 si las bases $nombres (nombres reales) no pasan la guarda. Sin credenciales ni host. */
function pos_scratch_exigir(PDO $pdo, string $host, array $nombres): void
{
    $bases = [];
    foreach (array_values(array_unique(array_map('strval', $nombres))) as $nombre) {
        $st = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = :b AND TABLE_NAME = :t');
        $st->execute([':b' => $nombre, ':t' => POS_SCRATCH_MARCA]);
        $bases[$nombre] = $st->fetchColumn() !== false;
    }
    $d = pos_scratch_decidir($host, $bases);
    if (!$d['ok']) {
        fwrite(STDERR, '[FALLO] las pruebas del POS borran y crean datos: ' . $d['motivo'] . ". Solo corren sobre bases wa_scratch / wa_scratch_sin_gate marcadas o sobre un MySQL local.\n");
        exit(2);
    }
}
```

- [ ] **Step 5: Write the preparation `tools/pos_scratch_prepare.php`**

```php
<?php
/**
 * pos_scratch_prepare.php — deja listas las bases scratch para las suites del POS, que necesitan un
 * master multi-tenant. Idempotente. Rol master: wa_scratch_sin_gate (tenants, pos_equipos,
 * pos_handoff_codes, tenant_id NULL-able en users y api_tokens porque las pruebas de un solo tenant
 * tambien la usan, permite_decimales). Tenant A: wa_scratch (solo filas). Tenant B: la misma
 * wa_scratch_sin_gate, que sigue SIN 027/028. Los secretos se derivan de WA_DB_PASS y no se imprimen.
 *
 * Uso:  php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/pos_scratch_prepare.php
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/pos_scratch_guard.php';

const POS_SCRATCH_BASE_MASTER = 'wa_scratch_sin_gate';
const POS_SCRATCH_BASE_A = 'wa_scratch';
const POS_SCRATCH_BASE_B = 'wa_scratch_sin_gate';
const POS_SCRATCH_TENANTS = [
    'A' => ['nombre' => 'POS Prueba A', 'rnc' => '000000010', 'base' => POS_SCRATCH_BASE_A],
    'B' => ['nombre' => 'POS Prueba B', 'rnc' => '000000011', 'base' => POS_SCRATCH_BASE_B],
];
const POS_SCRATCH_USUARIOS = [
    ['username' => 'admin_pos_a', 'tenant' => 'A', 'rol' => 'admin'],
    ['username' => 'admin_pos_b', 'tenant' => 'B', 'rol' => 'admin'],
    ['username' => 'user_pos_a', 'tenant' => 'A', 'rol' => 'user'],
];

/** @return array{clave_maestra:string, pepper:string, clave_usuarios:string} derivados de $base (WA_DB_PASS) */
function pos_scratch_secretos(string $base): array
{
    $d = static fn(string $uso, int $largo): string => substr(hash('sha256', 'wa_pos_scratch|' . $uso . '|' . $base), 0, $largo);
    return ['clave_maestra' => $d('clave-maestra', 64), 'pepper' => $d('pin-pepper', 64), 'clave_usuarios' => $d('usuarios', 32)];
}

function pos_scratch_tiene_columna(PDO $pdo, string $real, string $tabla, string $columna): bool
{
    $st = $pdo->prepare('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :b AND TABLE_NAME = :t AND COLUMN_NAME = :c');
    $st->execute([':b' => $real, ':t' => $tabla, ':c' => $columna]);
    return $st->fetchColumn() !== false;
}

/** El CREATE TABLE IF NOT EXISTS de una tabla del master, tal como lo trae db/master_schema.sql. */
function pos_scratch_ddl_master(string $tabla): string
{
    $sql = (string) file_get_contents(dirname(__DIR__) . '/db/master_schema.sql');
    if (preg_match('/CREATE TABLE IF NOT EXISTS ' . preg_quote($tabla, '/') . ' \(.*?\) ENGINE=InnoDB[^;]*;/s', $sql, $m) !== 1) {
        echo "[FALLO] db/master_schema.sql no trae la tabla {$tabla}\n";
        exit(1);
    }
    return $m[0];
}

/** Prepara las bases; se niega (pos_scratch_exigir) si alguna no es de prueba. */
function pos_scratch_preparar(): array
{
    $cred = wa_credenciales();
    $secretos = pos_scratch_secretos($cred['pass']);
    $master = wa_pdo(POS_SCRATCH_BASE_MASTER);
    $realMaster = wa_base_real(POS_SCRATCH_BASE_MASTER);
    $realA = wa_base_real(POS_SCRATCH_BASE_A);
    $realB = wa_base_real(POS_SCRATCH_BASE_B);
    pos_scratch_exigir($master, $cred['host'], [$realMaster, $realA, $realB]);

    // Master: tablas y columnas que el codigo del POS lee.
    foreach (['tenants', 'pos_handoff_codes', 'pos_equipos'] as $tabla) {
        $master->exec(pos_scratch_ddl_master($tabla));
    }
    foreach (['users', 'api_tokens'] as $tabla) {
        if (!pos_scratch_tiene_columna($master, $realMaster, $tabla, 'tenant_id')) {
            $master->exec("ALTER TABLE {$tabla} ADD COLUMN tenant_id INT NULL");
        }
    }
    if (!pos_scratch_tiene_columna($master, $realMaster, 'unidades_medida', 'permite_decimales')) {
        $master->exec('ALTER TABLE unidades_medida ADD COLUMN permite_decimales TINYINT(1) NOT NULL DEFAULT 0 AFTER descripcion');
    }
    $master->exec('UPDATE unidades_medida SET permite_decimales = (id IN (21, 24))'); // KG y LITRO; UND (43) no

    // Master: tenants, con la clave de su base cifrada con la clave maestra de prueba.
    putenv('MASTER_ENCRYPTION_KEY=' . $secretos['clave_maestra']);
    $_ENV['MASTER_ENCRYPTION_KEY'] = $secretos['clave_maestra'];
    require_once dirname(__DIR__) . '/src/TenantResolver.php';
    $ids = [];
    $upsert = $master->prepare(
        "INSERT INTO tenants (nombre, rnc, api_key, api_secret_hash, tipo, db_host, db_port, db_name, db_user, db_pass_encrypted,
                              cert_path, cert_pass_encrypted, ambiente, pos_enabled, activo)
         VALUES (:n, :r, :k, :s, 'app', :h, :p, :d, :u, :e, NULL, NULL, 'testecf', 1, 1)
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), api_key = VALUES(api_key), api_secret_hash = VALUES(api_secret_hash),
             tipo = 'app', db_host = VALUES(db_host), db_port = VALUES(db_port), db_name = VALUES(db_name), db_user = VALUES(db_user),
             db_pass_encrypted = VALUES(db_pass_encrypted), cert_path = NULL, cert_pass_encrypted = NULL,
             ambiente = 'testecf', pos_enabled = 1, activo = 1"
    );
    foreach (POS_SCRATCH_TENANTS as $clave => $t) {
        foreach ([
            ':n' => $t['nombre'], ':r' => $t['rnc'],
            ':k' => hash('sha256', 'wa_pos_scratch|api_key|' . $clave . '|' . $cred['pass']),
            ':s' => hash('sha256', 'wa_pos_scratch|api_secret|' . $clave . '|' . $cred['pass']),
            ':h' => $cred['host'], ':p' => $cred['port'], ':d' => wa_base_real($t['base']), ':u' => $cred['user'],
        ] as $marca => $valor) {
            $upsert->bindValue($marca, $valor);
        }
        $upsert->bindValue(':e', TenantResolver::encrypt($cred['pass']), PDO::PARAM_LOB); // binario, como create_tenant.php
        $upsert->execute();
        $st = $master->prepare('SELECT id FROM tenants WHERE rnc = :r');
        $st->execute([':r' => $t['rnc']]);
        $ids[$clave] = (int) $st->fetchColumn();
    }

    // Master: roles de cada tenant (admin con "*", user sin el modulo pos) y usuarios de app.*.
    $defaults = (require dirname(__DIR__) . '/config/permissions.php')['defaults'];
    foreach ($ids as $tenantId) {
        foreach ($defaults as $rol => $permisos) {
            $master->prepare("INSERT INTO roles (tenant_id, name, description, is_system) VALUES (:t, :n, 'Rol de prueba del POS', 1)
                              ON DUPLICATE KEY UPDATE is_system = 1")->execute([':t' => $tenantId, ':n' => $rol]);
            $st = $master->prepare('SELECT id FROM roles WHERE tenant_id = :t AND name = :n');
            $st->execute([':t' => $tenantId, ':n' => $rol]);
            $rolId = (int) $st->fetchColumn();
            $master->prepare('DELETE FROM role_permissions WHERE role_id = :r')->execute([':r' => $rolId]);
            foreach ($permisos as $permiso) {
                $master->prepare('INSERT INTO role_permissions (role_id, permission) VALUES (:r, :p)')->execute([':r' => $rolId, ':p' => $permiso]);
            }
        }
    }
    $hash = password_hash($secretos['clave_usuarios'], PASSWORD_DEFAULT);
    $usuario = $master->prepare(
        "INSERT INTO users (tenant_id, name, last_name, email, username, password, role) VALUES (:t, 'POS', 'Prueba', :e, :u, :p, :r)
         ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), password = VALUES(password), role = VALUES(role)"
    );
    foreach (POS_SCRATCH_USUARIOS as $u) {
        $usuario->execute([':t' => $ids[$u['tenant']], ':e' => $u['username'] . '@example.com', ':u' => $u['username'], ':p' => $hash, ':r' => $u['rol']]);
    }

    // Tenant A (solo filas): emisor, almacen y rangos testecf E31/E32 sin limite y vigentes.
    $pdoA = wa_pdo(POS_SCRATCH_BASE_A);
    wa_sembrar($pdoA);
    $pdoA->exec("DELETE FROM ncf_sequences WHERE ambiente = 'testecf' AND type IN ('E31', 'E32') AND numero_desde > 1");
    $rango = $pdoA->prepare(
        "INSERT INTO ncf_sequences (type, prefix, current_value, numero_desde, numero_hasta, fecha_vencimiento, description, ambiente)
         VALUES (:t, :t2, 0, 1, NULL, :v, 'POS prueba', 'testecf')
         ON DUPLICATE KEY UPDATE numero_hasta = NULL, fecha_vencimiento = VALUES(fecha_vencimiento)"
    );
    foreach (['E31', 'E32'] as $tipo) {
        $rango->execute([':t' => $tipo, ':t2' => $tipo, ':v' => date('Y-m-d', strtotime('+1 year'))]);
    }

    return ['master' => $realMaster, 'dbA' => $realA, 'dbB' => $realB, 'tenantA' => $ids['A'], 'tenantB' => $ids['B'], 'cred' => $cred];
}

if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    $info = pos_scratch_preparar();
    echo "Entorno del POS listo: tenant A = {$info['tenantA']}, tenant B = {$info['tenantB']}.\n";
    exit(0);
}
```

- [ ] **Step 6: `wa_servidor` takes the root of the API to serve**

`tools/write_ahead_test_lib.php` has CRLF line endings, and a multi-line edit through the Edit tool can leave mixed endings. Use an exact-match script instead: it keeps the file's line endings and writes nothing unless every marker appears exactly once. Create `$S/aplicar_lib.php` (Tasks 14 and 15 use it too) and `$S/aplicar_servidor.php` with the Write tool.

```php
<?php
/**
 * Ayuda de los scripts aplicar_*.php (solo en el scratchpad). aplicar($ruta, $cambios)
 * edita un archivo con cambios EXACTOS: si un marcador no aparece una sola vez no se
 * escribe nada y sale con 1. Respeta el fin de linea del archivo (CRLF o LF).
 *   ['texto', 'nuevo']             sustituye ese texto
 *   ['inicio', 'fin', 'nuevo', 1]  sustituye todo desde 'inicio' hasta 'fin', ambos incluidos
 */
function aplicar(string $ruta, array $cambios): void
{
    $orig = (string) file_get_contents($ruta);
    $crlf = str_contains($orig, "\r\n");
    $t = str_replace("\r\n", "\n", $orig);
    foreach ($cambios as $i => $c) {
        $n = $i + 1;
        $marcas = count($c) === 4 ? [$c[0], $c[1]] : [$c[0]];
        foreach ($marcas as $m) {
            if (substr_count($t, $m) !== 1) {
                fwrite(STDERR, '[FALLO] ' . basename($ruta) . ": cambio #{$n}: el marcador aparece " . substr_count($t, $m) . " veces:\n" . substr($m, 0, 120) . "\n");
                exit(1);
            }
        }
        if (count($c) === 4) {
            $pi = strpos($t, $c[0]);
            $pf = strpos($t, $c[1], $pi);
            if ($pf === false) {
                fwrite(STDERR, '[FALLO] ' . basename($ruta) . ": cambio #{$n}: el fin va antes del inicio\n");
                exit(1);
            }
            $t = substr($t, 0, $pi) . $c[2] . substr($t, $pf + strlen($c[1]));
        } else {
            $t = str_replace($c[0], $c[1], $t);
        }
    }
    file_put_contents($ruta, $crlf ? str_replace("\n", "\r\n", $t) : $t);
    echo basename($ruta) . ': ' . count($cambios) . " cambios\n";
}

function raiz_del_api(array $argv): string
{
    $raiz = rtrim((string) ($argv[1] ?? ''), '/\\');
    if ($raiz === '' || !is_dir($raiz . '/tools')) {
        fwrite(STDERR, "Uso: php <script> <raiz del API>\n");
        exit(2);
    }
    return $raiz;
}
```

```php
<?php
/**
 * wa_servidor acepta la raiz del API a servir (tools/test_pos_scratch.php --api-root).
 * Uso:  php aplicar_servidor.php <raiz del API>
 */

require __DIR__ . '/aplicar_lib.php';
$raiz = raiz_del_api($argv);

aplicar($raiz . '/tools/write_ahead_test_lib.php', [
    [<<<'T'
 * 8199). Quien llama debe usar la URL que devuelve, nunca armar el puerto.
 */
function wa_servidor(string $nombre, string $router, int $puerto, array $env = []): string
T, <<<'T'
 * 8199). Quien llama debe usar la URL que devuelve, nunca armar el puerto.
 *
 * $raiz es el directorio de trabajo del servidor y de donde se lee $router: por
 * defecto la raiz de este API; tools/test_pos_scratch.php --api-root pasa la de
 * otro checkout (la linea base de origin/master).
 */
function wa_servidor(string $nombre, string $router, int $puerto, array $env = [], string $raiz = ''): string
T],
    [<<<'T'
$pipes, dirname(__DIR__), $entorno);
    if (!is_resource($proc)) {
        echo "[FALLO] no se pudo lanzar php -S para {$nombre}\n";
T, <<<'T'
$pipes, $raiz !== '' ? $raiz : dirname(__DIR__), $entorno);
    if (!is_resource($proc)) {
        echo "[FALLO] no se pudo lanzar php -S para {$nombre}\n";
T],
]);
echo "listo\n";
```

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
php "$S/aplicar_servidor.php" "$A"
cd "$A"
php -l tools/write_ahead_test_lib.php
file tools/write_ahead_test_lib.php
git diff --stat -- tools/write_ahead_test_lib.php
```

Expected: `write_ahead_test_lib.php: 2 cambios`, `listo`, `No syntax errors detected`, `file` still says `with CRLF line terminators`, and the stat reports 1 file changed, 6 insertions(+), 2 deletions(-). Every other caller of `wa_servidor` passes four arguments and keeps its behaviour. If a marker fails, the script names it and writes nothing: the file differs from what this step was written against, so fix the marker.

- [ ] **Step 7: Write the runner `tools/test_pos_scratch.php`**

```php
<?php
/**
 * test_pos_scratch.php — corre las suites del POS (tools/test_pos_*.php) sobre las bases scratch:
 * prepara las bases, levanta la DGII simulada (puerto 8298) y dos APIs multi-tenant (8299 y 8297, la
 * segunda con POS_DGII_TIMEOUT=30 para las pruebas de concurrencia; WA_PUERTO_OFFSET se suma) y corre
 * cada suite en serie como proceso aparte. Solo muestra el resumen y lo que fallo, con host, usuario,
 * claves y todo hex de 32+ caracteres tapados.
 *
 * Uso:  php -d extension=curl -d extension=openssl -d extension=pdo_mysql tools/test_pos_scratch.php
 *   [--api-root=<raiz>]   codigo y suites de OTRA raiz (la linea base: un git archive de origin/master)
 *   [--suites=a,b,...]    [--enforce] PERMISSIONS_ENFORCE=true (por defecto, sombra)   [--solo-preparar]
 * Sale con 1 si alguna suite falla.
 */

require_once __DIR__ . '/pos_scratch_prepare.php';

/** Suites por defecto, en orden. Las que no existan en la raiz probada se omiten. */
const POS_SCRATCH_SUITES = ['test_pos_backend', 'test_pos_venta', 'test_pos_cierre', 'test_pos_e31', 'test_pos_write_ahead'];

/**
 * Entorno de la API (multi-tenant). La master es la base de prueba; los tenants
 * traen sus credenciales cifradas en la tabla tenants. Sin DB_*: con varios
 * tenants la base sale de la tabla, y una API sin tenant debe fallar, no caer
 * en otra base.
 */
function pos_scratch_env_api(array $cred, string $master, array $secretos, string $mockUrl, array $cert, bool $enforce): array
{
    return [
        'MULTI_TENANT_ENABLED' => 'true',
        'PERMISSIONS_ENFORCE' => $enforce ? 'true' : 'false',
        'AUDIT_LOG_ENABLED' => 'true',
        'MASTER_DB_HOST' => $cred['host'], 'MASTER_DB_PORT' => $cred['port'], 'MASTER_DB_NAME' => $master,
        'MASTER_DB_USER' => $cred['user'], 'MASTER_DB_PASS' => $cred['pass'],
        'MASTER_ENCRYPTION_KEY' => $secretos['clave_maestra'],
        'POS_PIN_PEPPER' => $secretos['pepper'],
        'POS_DGII_TIMEOUT' => '5',
        'DGII_ECF_ENVIRONMENT' => 'testecf',
        'DGII_ECF_BASE_URL' => $mockUrl, 'DGII_FC_BASE_URL' => $mockUrl,
        'DGII_ECF_CERT_PATH' => $cert['path'], 'DGII_ECF_CERT_PASSWORD' => $cert['password'],
        'RNC_CONSULTA_URL' => $mockUrl . '/rnc/consulta',
    ];
}

/** Entorno de las suites: a quien llaman y como entran (los nombres de la cabecera de test_pos_venta.php). */
function pos_scratch_env_suites(array $cred, string $master, array $secretos, string $api, string $api2, string $mockUrl, string $mockDir): array
{
    return [
        'POS_TEST_BASE' => $api . '/api', 'POS_TEST_BASE_2' => $api2 . '/api',
        'POS_TEST_ADMIN_A' => 'admin_pos_a', 'POS_TEST_ADMIN_B' => 'admin_pos_b', 'POS_TEST_USER_A' => 'user_pos_a',
        'POS_TEST_PASS' => $secretos['clave_usuarios'],
        'MASTER_DB_HOST' => $cred['host'], 'MASTER_DB_PORT' => $cred['port'], 'MASTER_DB_NAME' => $master,
        'MASTER_DB_USER' => $cred['user'], 'MASTER_DB_PASS' => $cred['pass'],
        'POS_TEST_DGII_MOCK_DIR' => $mockDir,
        'DGII_ECF_BASE_URL' => $mockUrl, 'DGII_FC_BASE_URL' => $mockUrl,
        'RNC_CONSULTA_URL' => $mockUrl . '/rnc/consulta',
        'POS_DGII_TIMEOUT' => '5',
    ];
}

/**
 * '' si $raiz sirve para probar (index.php, el simulador y NINGUN .env); si no, el motivo. Un .env
 * en la raiz lo carga Database al arrancar: una peticion sin tenant podria caer en la base que
 * diga ese archivo.
 */
function pos_scratch_revisar_raiz(string $raiz): string
{
    if (!is_file($raiz . '/index.php') || !is_file($raiz . '/tools/mock_dgii_local.php')) {
        return 'no es la raiz de un API con index.php y tools/mock_dgii_local.php';
    }
    if (is_file($raiz . '/.env')) {
        return 'tiene un .env: Database lo cargaria y una peticion sin tenant podria caer en la base de ese archivo';
    }
    return '';
}

/**
 * Resumen que imprime una suite: "TODO OK (N verificaciones)", "F de N FALLARON"
 * (suites de master) o "N de M pruebas OK" (arnes del write-ahead).
 * @return array{total:int, fallos:int}|null null si no hay resumen
 */
function pos_scratch_resumen(string $salida): ?array
{
    if (preg_match('/^(\d+) de (\d+) FALLARON/m', $salida, $m) === 1) {
        return ['total' => (int) $m[2], 'fallos' => (int) $m[1]];
    }
    if (preg_match('/^(\d+) de (\d+) pruebas OK/m', $salida, $m) === 1) {
        return ['total' => (int) $m[2], 'fallos' => (int) $m[2] - (int) $m[1]];
    }
    if (preg_match('/^TODO OK \((\d+) verificaciones\)/m', $salida, $m) === 1) {
        return ['total' => (int) $m[1], 'fallos' => 0];
    }
    return null;
}

/** Tapa los secretos conocidos y todo hex de 32 o mas caracteres (tokens, claves, hashes). */
function pos_scratch_enmascarar(string $texto, array $secretos): string
{
    foreach ($secretos as $s) {
        if ((string) $s !== '') {
            $texto = str_replace((string) $s, '***', $texto);
        }
    }
    return (string) preg_replace('/\b[0-9a-fA-F]{32,}\b/', '<hex>', $texto);
}

/**
 * De lo que imprimio una suite, solo: cada [FALLO] con su linea "obtenido:", el
 * resumen y, si murio, la clase del error (nunca su mensaje: el de una
 * PDOException trae usuario y host). Todo enmascarado y cortado a 400 caracteres.
 */
function pos_scratch_filtrar(string $salida, array $secretos): string
{
    $out = [];
    $anteriorFallo = false;
    foreach (preg_split('/\R/', $salida) ?: [] as $l) {
        $esFallo = str_contains($l, '[FALLO]');
        $esDetalle = $anteriorFallo && preg_match('/^\s+obtenido:/', $l) === 1;
        $esResumen = preg_match('/^(TODO OK \(|\d+ de \d+ (FALLARON|pruebas OK))/', $l) === 1;
        if ($esFallo || $esDetalle || $esResumen) {
            $out[] = pos_scratch_enmascarar(mb_substr($l, 0, 400), $secretos);
        } elseif (preg_match('/(Fatal error|Parse error|Uncaught)/', $l) === 1) {
            $out[] = preg_match('/Uncaught\s+([A-Za-z_\\\\]+)/', $l, $m) === 1
                ? '[FALLO] excepcion sin atrapar: ' . $m[1]
                : '[FALLO] ' . pos_scratch_enmascarar(mb_substr((string) preg_replace('/ in \S+:\d+.*$/', '', $l), 0, 160), $secretos);
        }
        $anteriorFallo = $esFallo;
    }
    return implode("\n", $out);
}

/** Corre una suite (proceso aparte, cwd = raiz del API probada). @return array{codigo:int, salida:string} */
function pos_scratch_correr_suite(string $ruta, string $raiz, array $env): array
{
    $nulo = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    $proc = proc_open(array_merge([PHP_BINARY], wa_php_flags(), [$ruta]), [0 => ['file', $nulo, 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]],
        $pipes, $raiz, array_merge(getenv(), array_map('strval', $env)));
    if (!is_resource($proc)) {
        return ['codigo' => -1, 'salida' => ''];
    }
    $salida = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    return ['codigo' => proc_close($proc), 'salida' => $salida];
}

function pos_scratch_main(): never
{
    $info = pos_scratch_preparar();
    if (wa_arg('solo-preparar') !== null) {
        echo "Bases del POS listas.\n";
        exit(0);
    }
    $cred = $info['cred'];
    $secretos = pos_scratch_secretos($cred['pass']);
    $pedida = (string) wa_arg('api-root', '');
    $raiz = $pedida !== '' ? (string) realpath($pedida) : dirname(__DIR__);
    $problema = $raiz === '' ? 'la ruta de --api-root no existe' : pos_scratch_revisar_raiz($raiz);
    if ($problema !== '') {
        echo "[FALLO] la raiz del API a probar no sirve: {$problema}\n";
        exit(1);
    }
    // El nombre del servidor lleva la raiz: un servidor viejo de otra raiz en el
    // mismo puerto se rechaza en vez de reutilizarse con el codigo equivocado.
    $etiqueta = substr(md5($raiz), 0, 6);
    $cert = wa_cert_prueba();
    $dirMock = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wa_pos_mock_state';
    if (!is_dir($dirMock)) {
        mkdir($dirMock);
    }
    foreach (['log.txt', 'recibidos.txt', 'recibidos_ecf.json'] as $f) {
        @unlink($dirMock . DIRECTORY_SEPARATOR . $f);
    }
    file_put_contents($dirMock . DIRECTORY_SEPARATOR . 'modo.txt', 'acepta');

    $mock = wa_servidor('pos_mock_' . $etiqueta, 'tools/mock_dgii_local.php', 8298, ['MOCK_DGII_STATE' => $dirMock], $raiz);
    $envApi = pos_scratch_env_api($cred, $info['master'], $secretos, $mock, $cert, wa_arg('enforce') !== null);
    $api = wa_servidor('pos_api_' . $etiqueta, 'index.php', 8299, $envApi, $raiz);
    $api2 = wa_servidor('pos_api2_' . $etiqueta, 'index.php', 8297, array_merge($envApi, ['POS_DGII_TIMEOUT' => '30']), $raiz);
    $envSuites = pos_scratch_env_suites($cred, $info['master'], $secretos, $api, $api2, $mock, $dirMock);
    $ocultos = [$cred['pass'], $cred['user'], $cred['host'], $secretos['clave_usuarios'], $secretos['clave_maestra'], $secretos['pepper'], $cert['password']];

    $suites = array_values(array_filter(array_map('trim', explode(',', (string) wa_arg('suites', implode(',', POS_SCRATCH_SUITES))))));
    echo 'API ' . ($pedida !== '' ? 'de ' . basename($raiz) : 'de esta rama') . " en {$api}; DGII simulada en {$mock}\n";
    $corridas = 0;
    $verdes = 0;
    foreach ($suites as $suite) {
        $ruta = $raiz . '/tools/' . $suite . '.php';
        if (!is_file($ruta)) {
            echo "== {$suite}: no existe en esta raiz, se omite\n";
            continue;
        }
        $corridas++;
        $r = pos_scratch_correr_suite($ruta, $raiz, $envSuites);
        $resumen = pos_scratch_resumen($r['salida']);
        $ok = $r['codigo'] === 0 && $resumen !== null && $resumen['fallos'] === 0;
        $verdes += $ok ? 1 : 0;
        echo '== ' . $suite . ': ' . ($ok ? "OK ({$resumen['total']} verificaciones)" : 'FALLO (codigo ' . $r['codigo'] . ($resumen === null ? ', sin resumen' : '') . ')') . "\n";
        if (!$ok) {
            $detalle = pos_scratch_filtrar($r['salida'], $ocultos);
            echo ($detalle !== '' ? $detalle : '(la suite no imprimio nada util)') . "\n";
        }
    }
    echo "\nsuites OK: {$verdes} de {$corridas}\n";
    exit($corridas > 0 && $verdes === $corridas ? 0 : 1);
}

// CLI propio: solo cuando se ejecuta este archivo, nunca al incluirlo.
if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    pos_scratch_main();
}
```

- [ ] **Step 8: Run the DB-free test and commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
for f in tools/pos_scratch_guard.php tools/pos_scratch_prepare.php tools/test_pos_scratch.php tools/test_pos_scratch_puro.php tools/write_ahead_test_lib.php; do php -l "$f" | grep -v "^No syntax errors"; done
php tools/test_pos_scratch_puro.php; echo "exit=$?"
git status --short
git add tools/pos_scratch_guard.php tools/pos_scratch_prepare.php tools/test_pos_scratch.php tools/test_pos_scratch_puro.php tools/write_ahead_test_lib.php
git commit -m "test(pos): entorno de pruebas del POS sobre las bases scratch

Guarda que niega correr fuera de las bases wa_scratch marcadas, preparacion
idempotente del master multi-tenant (tenants, usuarios, roles, rangos testecf) y
corredor de las suites sin imprimir secretos. wa_servidor acepta la raiz del API
a probar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: no `php -l` output, `18 de 18 pruebas OK` and `exit=0`; the status lists the five paths plus the usual untracked file, which is never staged.

- [ ] **Step 9: Baseline run against pristine `origin/master`**

The baseline proves the environment: the four suites of `origin/master`, served by `origin/master`'s own code, must pass here before any of our code is blamed for a failure. `git archive` extracts the tree without touching a repository (`vendor/` and the XSDs are tracked, so the archive is complete). The first run also prepares the scratch bases (it creates `tenants`, `pos_equipos` and `pos_handoff_codes` in `smhynzte_wa_scratch_sin_gate` and adds `tenant_id` to its `users` and `api_tokens`; nothing else of the schema).

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
rm -rf "$S/api-master-base" && mkdir -p "$S/api-master-base"
git -C "$A" archive origin/master | tar -x -C "$S/api-master-base"
cd "$A"
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php --api-root="$S/api-master-base"; echo "exit=$?"
```

Put `WA_PUERTO_OFFSET=100` in front of `php` if ports 8297-8299 are busy. The run takes several minutes against the remote scratch server: if it does not fit the 10-minute limit, run one suite per command (`--suites=test_pos_backend`, then `test_pos_venta`, `test_pos_cierre`, `test_pos_e31`). Expected:

```
== test_pos_backend: OK (100 verificaciones)
== test_pos_venta: OK (48 verificaciones)
== test_pos_cierre: OK (50 verificaciones)
== test_pos_e31: OK (35 verificaciones)
== test_pos_write_ahead: no existe en esta raiz, se omite

suites OK: 4 de 4
```

and `exit=0`. A statement that fails prints only the class and the SQL codes (`1142`/`1044`: the scratch user lacks `CREATE`/`ALTER`; stop and report the code, never grant anything). If a suite fails, the environment is at fault, not our code: debug the failing check with `systematic-debugging` and fix `tools/pos_scratch_prepare.php` or the runner in a new commit, never the suites of `origin/master`. Usual suspects: a master table or column, a `testecf` range, the certificate, `POS_PIN_PEPPER` (32 characters or more), a missing migration 032-034 on a scratch base (Task 1 Step applies them) and a stale `php -S` on the same port (the runner refuses to reuse a server of another root). The API logs in the system temp folder (`wa_pos_*.log`) hold `user@host` after a DB failure: read them only through `grep -v "@"`, never raw. Delete `$S/api-master-base` when done.

- [ ] **Step 10: Run the old suites on the integrated branch (the input of Task 14)**

Nothing is committed here.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php --suites=test_pos_backend,test_pos_venta,test_pos_cierre,test_pos_e31; echo "exit=$?"
```

Expected: `test_pos_backend: OK (100 verificaciones)`, `exit=1`, and `FALLO` lines in the other three suites that are exactly the checks Task 14 Step 1 lists. A failing check that is not on that list is a defect of Tasks 3-10: fix it in the task that owns it.

---

### Task 14: Suites del POS actualizadas a la spec

**Files:**
- Modify: `tools/test_pos_venta.php`, `tools/test_pos_cierre.php`, `tools/test_pos_e31.php` (the expectations the spec changes, plus the guard) and `tools/test_pos_backend.php` (only the guard).
- Create: `tools/test_pos_write_ahead.php`, the new scenarios (30 checks).
- Modify: `src/Pos/PosCierre.php`, `src/Models/posModel.php`: the closing report and the sales lists identify a sale that came out as a factura simple.
- Create, in the session scratchpad only: `$S/aplicar_suites.php`, `$S/aplicar_cierre.php`. They use `$S/aplicar_lib.php` from Task 13 Step 6 (create it again from there if the scratchpad is new). Every marker must match exactly once or nothing is written; each file keeps its line endings.
- Test: all five suites through `tools/test_pos_scratch.php`.

`$S` is the scratchpad directory your system prompt lists. Paths are relative to the API worktree.

What the spec changes in the old suites (spec 4.2 and 5.3):

| Old expectation | New expectation |
|---|---|
| A rejection at sale time answers `422 DGII_RECHAZO`: no cash, no stock, the e-NCF goes back to the counter | `201`, delivered: cash and stock stay, the number never goes back (`reclamar_secuencia = false`), the next sale takes the next number, the rejected row is not archived; repeating its clave answers `201 repetida` |
| A timeout leaves `RFCE_PENDIENTE` (E32) or `ENVIO_PENDIENTE` (E31) | `ENVIO_INCIERTO`, still `201` with `envio_pendiente: true` |
| The closing report and the lists leave the rejected sale out | They include it (it has cash), under `rechazadas` in the report; expected cash rises by its amount |
| `POS_VENTA_RECHAZADA` is audited at sale time | A rejected sale is a `POS_VENTA`; `POS_VENTA_RECHAZADA` is the resend's audit of a later rejection (the E31 suite still sees it) |

Counts after this task: backend 100, venta 49 (section 5 goes from 4 checks to 5; the audit loop trades `POS_VENTA_RECHAZADA` for one new check), cierre 50, e31 36 (the 422 check becomes two), write_ahead 30.

**Gap flagged for the plan's author (not resolved here).** `ncfModel::registerRange` refuses a `numero_desde` not greater than `max(current_value, numero_hasta)` (`$numeroDesde <= $tope`). After a `sin_rango` sale `current_value` is above `numero_hasta`, so an admin cannot register the range the DGII authorizes when it covers those numbers (spec 4.2.6 and section 6), and the skeleton has no task for it. RF5 registers the covering range with an `INSERT`, the row such a registration would leave; if Task 4 or 8 changes `registerRange`, switch that step to `POST /api/ncf/rangos`. The service already skips numbers used by a row (`eNcfYaUsado`), so such a range never hands out a used number.

**Interfaces:**
- Consumes: Task 13 (runner, `pos_scratch_exigir`, the two API instances); Task 3 (`reservarFacturaECF` with the POS columns, `EcfVentaRepetidaException`, `envio_pendiente` in the same `UPDATE`); Task 4 (`reclamar_secuencia`, `autenticar_despues_de_reservar`, `numerar_sin_rango`, `ncfModel::dispenseSinRango`, `ncfModel::rangoCubre`); Tasks 5-7 (`PosVenta::entregarVenta`, delivery of every outcome, the factura simple fallback with the audit `POS_VENTA_FACTURA_SIMPLE`, the simple receipt with title `FACTURA` and no `timbre` (`EcfDocumento::titulo()` and `timbre()` with `noElectronica = true`), an audit `POS_VENTA` whose `new_values` carry the `factura_id`, as master's does, and `sin_rango` in the row meta `respuesta_dgii`); Task 8 (the resend skips `PENDIENTE_ENVIO` younger than 2 minutes, by `respuesta_dgii.desde`, and `sin_rango` rows until `rangoCubre`); Task 9 (`POST /api/facturas/{id}/reenviar`); Task 10 (`GET /api/facturas/avisos`).
- Produces: `tools/test_pos_write_ahead.php` (run by the runner; needs `POS_TEST_BASE_2`). In `src/Pos/PosCierre.php`: `private static function numero(array $v): string` (the e-NCF or, for a factura simple, `no_factura`); the report counts a sale without `tipo_ecf` as `Simple`; `ventasDelTurno`, `ventasDelDia` and the report's `pendientes`/`rechazadas` use `numero()`. In `src/Models/posModel.php`: `ventasCobradasDelTurno` and `ventasDelEmpleadoEnCaja` also select `f.no_factura`.

- [ ] **Step 1: Run the old suites and record what is red**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git status --short
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php --suites=test_pos_backend,test_pos_venta,test_pos_cierre,test_pos_e31; echo "exit=$?"
```

Expected: `test_pos_backend: OK (100 verificaciones)` and a `FALLO` in the other three, only in checks that Step 4 rewrites:
- `test_pos_venta`: `422 DGII_RECHAZO con el motivo de la DGII`; `queda como historial (RFCE_RECHAZADO)...`; `el e-NCF rechazado sin usar vuelve a la secuencia`; `la venta siguiente reutiliza ese e-NCF...`; `a los ~5 s responde 201 con envio pendiente (RFCE_PENDIENTE)...`; most likely `bitacora: POS_VENTA_RECHAZADA`.
- `test_pos_cierre`: the sale list (`... una rechazada`), `ventas del turno (K9)`, `esperado = 1,500 ...`, `ventas por forma`, `4 facturas E32 ...`, `en la base: cerrado ...`, the three "ventas del dia" checks, `detalle: el mismo reporte ...` and whatever else depends on the rejected sale having no cash.
- `test_pos_e31`: `rechazado al recibir: 422 DGII_RECHAZO ...`, `caida: 201, ENVIO_PENDIENTE ...`, `sigue caida ...`, `lenta: 201 pendiente sin trackId`.

Any other `FALLO` is a defect of Tasks 3-10 (the resend, the audit): stop and fix it there, not by editing an expectation here.

- [ ] **Step 2: Write the failing scenarios `tools/test_pos_write_ahead.php`**

```php
<?php
/**
 * test_pos_write_ahead.php — la venta del POS sobre el write-ahead (spec 2026-10-12, 4.2 a 4.4 y 5.2)
 * de punta a punta: API multi-tenant real, DGII simulada y bases scratch.
 *   1 RF1 misma clave con la primera esperando a la DGII · 2 RF2 corte entre guardar y la caja ·
 *   3 RF3 el reenvio no toca una venta en curso · 4 RF4 el certificado falla y se recupera ·
 *   5 RF5 E32 agotada y su salida al registrar un rango · 6 Reenviar a la DGII · 7 el cierre.
 * Necesita DOS APIs contra la misma base (php -S atiende de a una peticion): POS_TEST_BASE y
 * POS_TEST_BASE_2 (esta con POS_DGII_TIMEOUT=30). Las arma tools/test_pos_scratch.php.
 */

require_once __DIR__ . '/write_ahead_test_lib.php';
require_once __DIR__ . '/pos_scratch_guard.php';

$base1 = rtrim((string) getenv('POS_TEST_BASE'), '/');
$base2 = rtrim((string) getenv('POS_TEST_BASE_2'), '/');
foreach (['POS_TEST_BASE', 'POS_TEST_BASE_2', 'POS_TEST_ADMIN_A', 'POS_TEST_PASS', 'MASTER_DB_HOST', 'POS_TEST_DGII_MOCK_DIR'] as $var) {
    if ((string) getenv($var) === '') {
        fwrite(STDERR, "Falta la variable {$var}. Esta prueba la corre tools/test_pos_scratch.php.\n");
        exit(2);
    }
}
foreach (['DGII_ECF_BASE_URL', 'DGII_FC_BASE_URL'] as $var) {
    if (!preg_match('#^http://(127\.0\.0\.1|localhost)(:\d+)?$#', (string) getenv($var))) {
        fwrite(STDERR, "{$var} no apunta a la DGII simulada local. Esta prueba EMITE: nunca contra la DGII real.\n");
        exit(2);
    }
}
if (preg_match('#gratex\.net|fiscalpoint\.com\.do#', $base1 . $base2)) {
    fwrite(STDERR, "POS_TEST_BASE apunta a produccion. Solo local.\n");
    exit(2);
}
$mock = rtrim((string) getenv('POS_TEST_DGII_MOCK_DIR'), '/\\');
$modo = fn(string $m) => file_put_contents($mock . '/modo.txt', $m);
$logMock = fn(): array => is_file($mock . '/log.txt') ? (file($mock . '/log.txt', FILE_IGNORE_NEW_LINES) ?: []) : [];
/** Cuantas veces el simulador RECIBIO el e-NCF (RFCE o e-CF completo) y cuantas se PREGUNTO por el. */
$recepciones = fn(string $encf): int => count(array_filter($logMock(), static fn($l) => str_contains($l, "rfce {$encf} ") || str_contains($l, "ecf {$encf} ")));
$consultas = fn(string $encf): int => count(array_filter($logMock(), static fn($l) => str_contains($l, "consulta {$encf} ") || str_contains($l, "trackids {$encf} ")));

$api = function (string $metodo, string $ruta, ?array $body = null, array $headers = []) use ($base1): array {
    $h = [];
    foreach ($headers as $k => $v) {
        $h[] = "{$k}: {$v}";
    }
    $r = wa_http($metodo, $base1 . $ruta, $body, $h, 90);
    return [$r['status'], $r['json'] ?? ['_crudo' => substr($r['body'], 0, 400)]];
};
$uuid = static function (): string {
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
};

$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;charset=utf8mb4', getenv('MASTER_DB_HOST'), getenv('MASTER_DB_PORT') ?: '3306'),
    getenv('MASTER_DB_USER'), getenv('MASTER_DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$master = getenv('MASTER_DB_NAME') ?: 'gratex_master';
$f = $pdo->query("SELECT t.id, t.db_name FROM `{$master}`.users u JOIN `{$master}`.tenants t ON t.id = u.tenant_id WHERE u.username = "
    . $pdo->quote((string) getenv('POS_TEST_ADMIN_A')))->fetch();
[$tenantA, $dbA] = [(int) $f['id'], $f['db_name']];
pos_scratch_exigir($pdo, (string) getenv('MASTER_DB_HOST'), [$master, $dbA]);
$pdo->exec("UPDATE `{$master}`.tenants SET pos_enabled = 1 WHERE id = {$tenantA}");
$adminId = (int) $pdo->query("SELECT id FROM `{$master}`.users WHERE username = " . $pdo->quote((string) getenv('POS_TEST_ADMIN_A')))->fetchColumn();

/** Lo que una prueba cambia a proposito y se deja como estaba, aunque la corrida se corte. */
$restaurar = static function () use ($pdo, $master, $dbA, $tenantA, $modo): void {
    $modo('acepta');
    $pdo->exec("UPDATE `{$master}`.tenants SET cert_path = NULL WHERE id = {$tenantA}");
    $pdo->exec("DELETE FROM `{$dbA}`.ncf_sequences WHERE ambiente = 'testecf' AND type IN ('E31', 'E32') AND numero_desde > 1");
    $pdo->exec("UPDATE `{$dbA}`.ncf_sequences SET numero_hasta = NULL WHERE ambiente = 'testecf' AND type IN ('E31', 'E32') AND numero_desde = 1");
};
register_shutdown_function($restaurar);

// --- Estado limpio ---------------------------------------------------------------------------
$pdo->exec("DELETE FROM `{$dbA}`.pos_caja_movimientos");
$pdo->exec("DELETE FROM `{$dbA}`.facturas WHERE pos_empleado_id IS NOT NULL OR user_id = {$adminId}");
foreach (['pos_turnos', 'pos_sesiones', 'pos_empleados', 'pos_cajas'] as $tabla) {
    $pdo->exec("DELETE FROM `{$dbA}`.{$tabla}");
}
$pdo->exec("DELETE FROM `{$master}`.pos_equipos WHERE tenant_id = {$tenantA}");
$pdo->exec("DELETE FROM `{$dbA}`.inventory_movements WHERE product_id IN (SELECT id FROM `{$dbA}`.products WHERE sku LIKE 'WATEST-%')");
$pdo->exec("DELETE FROM `{$dbA}`.products WHERE sku LIKE 'WATEST-%'");
$pdo->exec("DELETE FROM `{$dbA}`.clients WHERE client_name = 'WATEST cliente'");
foreach (['log.txt', 'recibidos.txt', 'recibidos_ecf.json'] as $archivo) {
    @unlink($mock . '/' . $archivo);
}
$restaurar();
$pdo->exec("INSERT IGNORE INTO `{$master}`.unidades_medida (id, codigo, descripcion, permite_decimales) VALUES (43, 'UND', 'Unidad', 0)");
$almacen = (int) $pdo->query("SELECT id FROM `{$dbA}`.warehouses ORDER BY id LIMIT 1")->fetchColumn();
$pdo->prepare("INSERT INTO `{$dbA}`.products (sku, nombre, warehouse_id, indicador_facturacion, indicador_bien_servicio, precio, unidad_medida, stock, activo)
               VALUES ('WATEST-1', 'Agua 500 ml', ?, 1, 1, '21.1864', '43', '100', 1)")->execute([$almacen]);
$agua = (int) $pdo->lastInsertId(); // 25.00 con ITBIS
$pdo->prepare("INSERT INTO `{$dbA}`.clients (email, client_name, company_name, phone_number, rnc, razon_social, descuento)
               VALUES ('', 'WATEST cliente', 'WATEST cliente', '', '101010101', 'WATEST CLIENTE SRL', 0)")->execute();
$cliente = (int) $pdo->lastInsertId();

// --- Ayudas ---------------------------------------------------------------------------------------
$stock = fn(int $id) => (float) $pdo->query("SELECT stock FROM `{$dbA}`.products WHERE id = {$id}")->fetchColumn();
$filaPorClave = function (string $clave) use ($pdo, $dbA) {
    $st = $pdo->prepare("SELECT id, e_ncf, no_factura, tipo_ecf, estado_dgii, envio_pendiente, turno_id, pos_empleado_id, respuesta_dgii
                         FROM `{$dbA}`.facturas WHERE pos_idempotency_key = ?");
    $st->execute([$clave]);
    return $st->fetch();
};
$movCaja = fn(int $id) => (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$id}")->fetchColumn();
$movInv = fn(int $id) => (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.inventory_movements WHERE referencia_tipo = 'factura' AND referencia_id = {$id}")->fetchColumn();
$contador = fn(string $tipo) => (int) $pdo->query("SELECT current_value FROM `{$dbA}`.ncf_sequences WHERE type = '{$tipo}' AND ambiente = 'testecf' AND numero_desde = 1")->fetchColumn();
$encfDe = fn(int $n) => 'E32' . str_pad((string) $n, 10, '0', STR_PAD_LEFT);
$venta = fn(array $lineas, int $total, int $forma = 1, ?int $recibido = null, ?string $clave = null, array $extra = []) => [
    'clave' => $clave ?? $uuid(), 'lineas' => $lineas, 'total_centavos' => $total, 'forma_pago' => $forma,
    'recibido_centavos' => $recibido, 'ancho' => 80, 'iniciada_ms' => (int) (microtime(true) * 1000) - 20000,
] + $extra;
$aguas = fn(int $n) => [['product_id' => $agua, 'cantidad' => $n]];

// --- Caja, empleado, equipo, sesion y turno ---------------------------------------------------------
[, $r] = $api('POST', '/auth/login', ['emailOrUsername' => getenv('POS_TEST_ADMIN_A'), 'password' => getenv('POS_TEST_PASS')]);
$admin = ['Authorization' => 'Bearer ' . ($r['data']['token'] ?? '')];
[, $r] = $api('POST', '/pos-admin/cajas', ['nombre' => 'Caja WA'], $admin);
$caja = $r['data']['caja']['id'];
[, $r] = $api('POST', '/pos-admin/empleados', ['nombre' => 'Ana WA', 'rol' => 'cajero'], $admin);
$pin = $r['data']['pin'];
[, $r] = $api('POST', '/pos-admin/equipos', ['caja_id' => $caja], $admin);
$eq = ['X-POS-EQUIPO' => $r['data']['token']];
[, $r] = $api('POST', '/pos/sesion', ['pin' => $pin], $eq);
$ses = $eq + ['X-POS-SESION' => (string) ($r['data']['token'] ?? '')];
[, $r] = $api('POST', '/pos/turno', ['fondo_centavos' => 0], $ses);
$turno = (int) ($r['data']['turno_caja']['id'] ?? 0);
wa_chk('preparacion: login del admin, caja, equipo, sesion y turno abierto', isset($admin['Authorization']) && $turno > 0 && $ses['X-POS-SESION'] !== '', $r);

// --- Peticiones en vuelo a la vez (curl_multi) -------------------------------------------------------
$mh = null;
$iniciar = function (string $baseUrl, array $headers, array $body) use (&$mh): CurlHandle {
    $mh ??= curl_multi_init();
    $h = ['Content-Type: application/json'];
    foreach ($headers as $k => $v) {
        $h[] = "{$k}: {$v}";
    }
    $ch = curl_init($baseUrl . '/pos/ventas');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90, CURLOPT_HTTPHEADER => $h,
        CURLOPT_POSTFIELDS => json_encode($body)]);
    curl_multi_add_handle($mh, $ch);
    return $ch;
};
/** Mueve las peticiones en vuelo hasta que $cond() sea cierta (o pasen $max segundos). */
$avanzar = function (callable $cond, int $max = 30) use (&$mh): bool {
    $corriendo = 0;
    $t0 = microtime(true);
    do {
        curl_multi_exec($mh, $corriendo);
        if ($cond()) {
            return true;
        }
        curl_multi_select($mh, 0.1);
    } while (microtime(true) - $t0 < $max);
    return (bool) $cond();
};
/** Espera a las que quedan y devuelve [http, json] de cada una. */
$terminar = function (array $handles) use (&$mh): array {
    $corriendo = 0;
    do {
        curl_multi_exec($mh, $corriendo);
        curl_multi_select($mh, 0.1);
    } while ($corriendo > 0);
    $out = [];
    foreach ($handles as $ch) {
        $out[] = [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), json_decode((string) curl_multi_getcontent($ch), true)];
        curl_multi_remove_handle($mh, $ch);
    }
    curl_multi_close($mh);
    $mh = null;
    return $out;
};

// ---------------------------------------------------------------------------------------------------
echo "1. RF1: la misma clave mientras la primera espera a la DGII\n";
$modo('lento'); // el simulador la recibe y contesta a los 8 s; la API 2 espera hasta 30 s
$clave1 = $uuid();
$cuerpo1 = $venta($aguas(3), 7500, 1, 10000, $clave1);
$stock1 = $stock($agua);
$a = $iniciar($base2, $ses, $cuerpo1);
$guardada = $avanzar(static fn() => $filaPorClave($clave1) !== false);
$enVuelo = $filaPorClave($clave1);
wa_chk('write-ahead: la fila ya esta guardada, PENDIENTE_ENVIO, mientras la DGII no ha contestado',
    $guardada && $enVuelo && $enVuelo['estado_dgii'] === 'PENDIENTE_ENVIO' && $enVuelo['tipo_ecf'] === '32', $enVuelo);
$b = $iniciar($base1, $ses, $cuerpo1); // misma clave, otra instancia de la API
[$ra, $rb] = $terminar([$a, $b]);
$encf1 = (string) ($ra[1]['data']['venta']['e_ncf'] ?? '');
$fila1 = $filaPorClave($clave1);
wa_chk('las dos responden 201 con la MISMA venta (la segunda, repetida); un solo e-NCF, recibido una vez, aceptado',
    $ra[0] === 201 && $rb[0] === 201 && ($ra[1]['data']['repetida'] ?? null) === false && ($rb[1]['data']['repetida'] ?? null) === true
    && $encf1 !== '' && $encf1 === ($rb[1]['data']['venta']['e_ncf'] ?? null) && $recepciones($encf1) === 1
    && $fila1['estado_dgii'] === 'RFCE_ACEPTADO' && (int) $fila1['envio_pendiente'] === 0, [$ra, $rb]);
wa_chk('un solo movimiento de caja (efectivo recibido 100.00)', $movCaja((int) $fila1['id']) === 1
    && (float) $pdo->query("SELECT monto_recibido FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$fila1['id']}")->fetchColumn() === 100.0);
wa_chk('una sola salida de inventario: 3 aguas', $movInv((int) $fila1['id']) === 1 && $stock($agua) === $stock1 - 3, [$stock1, $stock($agua)]);

// ---------------------------------------------------------------------------------------------------
echo "\n2. RF2: el servidor cae entre guardar la respuesta y la caja\n";
$modo('acepta');
$clave2 = $uuid();
$cuerpo2 = $venta($aguas(2), 5000, 1, 6000, $clave2);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpo2, $ses);
$fila2 = $filaPorClave($clave2);
wa_chk('la venta se cobra normal: 201, caja e inventario', $h === 201 && $fila2 && $movCaja((int) $fila2['id']) === 1 && $movInv((int) $fila2['id']) === 1, [$h, $r]);
// El estado que deja un corte entre 'confirmar' y la entrega: veredicto en la fila, sin caja ni inventario.
$pdo->exec("DELETE FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$fila2['id']}");
$pdo->exec("DELETE FROM `{$dbA}`.inventory_movements WHERE referencia_tipo = 'factura' AND referencia_id = {$fila2['id']}");
$pdo->exec("UPDATE `{$dbA}`.products SET stock = stock + 2 WHERE id = {$agua}");
$stock2 = $stock($agua);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpo2, $ses);
$mov = $pdo->query("SELECT monto, monto_recibido, devuelta FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$fila2['id']}")->fetchAll();
wa_chk('el reintento con la misma clave: 201 repetida, sin otro e-NCF ni otro envio',
    $h === 201 && ($r['data']['repetida'] ?? null) === true && ($r['data']['venta']['e_ncf'] ?? '') === $fila2['e_ncf'] && $recepciones((string) $fila2['e_ncf']) === 1, [$h, $r]);
wa_chk('escribio la caja que faltaba, una vez y con lo del reintento (recibido 60.00, devuelta 10.00), y devolvio la salida de inventario, una vez',
    count($mov) === 1 && (float) $mov[0]['monto_recibido'] === 60.0 && (float) $mov[0]['devuelta'] === 10.0
    && $movInv((int) $fila2['id']) === 1 && $stock($agua) === $stock2 - 2, [$mov, $stock2, $stock($agua)]);
[$h] = $api('POST', '/pos/ventas', $cuerpo2, $ses);
wa_chk('otro reintento no repite nada', $h === 201 && $movCaja((int) $fila2['id']) === 1 && $movInv((int) $fila2['id']) === 1 && $stock($agua) === $stock2 - 2, [$h]);

// ---------------------------------------------------------------------------------------------------
echo "\n3. RF3: el reenvio automatico no toca una venta que todavia se esta enviando\n";
$modo('lento');
$clave3 = $uuid();
$a = $iniciar($base2, $ses, $venta($aguas(1), 2500, 3, null, $clave3));
$avanzar(static fn() => $filaPorClave($clave3) !== false);
[$h, $r] = $api('POST', '/pos/pendientes/reenviar', [], $eq); // API 1, mientras la API 2 sigue esperando a la DGII
wa_chk('el reenvio la salta (PENDIENTE_ENVIO con menos de 2 minutos): no acepta ni rechaza nada y la fila sigue PENDIENTE_ENVIO',
    $h === 200 && ($r['data']['aceptadas'] ?? -1) === 0 && ($r['data']['rechazadas'] ?? null) === []
    && $filaPorClave($clave3)['estado_dgii'] === 'PENDIENTE_ENVIO', [$h, $r, $filaPorClave($clave3)]);
[$rc] = $terminar([$a]);
$encf3 = (string) ($rc[1]['data']['venta']['e_ncf'] ?? '');
wa_chk('la venta original termina aceptada; la DGII la recibio una sola vez y nadie la consulto',
    $rc[0] === 201 && $filaPorClave($clave3)['estado_dgii'] === 'RFCE_ACEPTADO' && $encf3 !== '' && $recepciones($encf3) === 1 && $consultas($encf3) === 0, [$rc, $recepciones($encf3)]);
$modo('acepta');

// ---------------------------------------------------------------------------------------------------
echo "\n4. RF4: el certificado falla a mitad del turno y se recupera\n";
$cont4 = $contador('E32');
$recibidos4 = count($logMock());
$pdo->exec("UPDATE `{$master}`.tenants SET cert_path = 'no_existe_wa_cert.p12' WHERE id = {$tenantA}");
$claveS1 = $uuid();
$cuerpoS1 = $venta($aguas(2), 5000, 1, 5000, $claveS1);
$stock4 = $stock($agua);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpoS1, $ses);
$filaS1 = $filaPorClave($claveS1);
wa_chk('con el certificado roto la venta sale igual: 201 con recibo', $h === 201 && is_array($r['data']['recibo'] ?? null) && $filaS1, [$h, $r]);
wa_chk('quedo como factura simple (sin tipo de e-CF ni e-NCF) con su clave, turno y empleado, caja e inventario, sin gastar numero ni salir a la DGII',
    $filaS1 && $filaS1['tipo_ecf'] === null && $filaS1['e_ncf'] === null && (int) $filaS1['turno_id'] === $turno && (int) $filaS1['pos_empleado_id'] > 0
    && (int) $filaS1['envio_pendiente'] === 0 && $movCaja((int) $filaS1['id']) === 1 && $movInv((int) $filaS1['id']) === 1 && $stock($agua) === $stock4 - 2
    && $contador('E32') === $cont4 && count($logMock()) === $recibidos4, [$filaS1, $cont4, $contador('E32')]);
$recibo = $r['data']['recibo'] ?? [];
wa_chk('el recibo sale en formato de factura simple: titulo FACTURA y sin timbre', ($recibo['titulo'] ?? '') === 'FACTURA'
    && array_key_exists('timbre', $recibo) && $recibo['timbre'] === null, $recibo['titulo'] ?? $r);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpoS1, $ses);
wa_chk('repetir la clave: la misma factura simple, sin otra ni otro movimiento', $h === 201 && ($r['data']['repetida'] ?? null) === true
    && (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.facturas WHERE pos_idempotency_key = " . $pdo->quote($claveS1))->fetchColumn() === 1
    && $movCaja((int) $filaS1['id']) === 1, [$h, $r]);
$claveS2 = $uuid();
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(1), 2500, 2, null, $claveS2), $ses);
$filaS2 = $filaPorClave($claveS2);
$pdo->exec("UPDATE `{$dbA}`.facturas SET date = DATE_SUB(date, INTERVAL 1 DAY) WHERE id = {$filaS1['id']}"); // la primera "es de ayer"
[$ha, $ra] = $api('GET', '/facturas/avisos', null, $admin);
wa_chk('otra venta con el certificado roto tambien es factura simple, y el aviso al admin cuenta solo las de hoy (1 de 2)',
    $h === 201 && $filaS2 && $filaS2['tipo_ecf'] === null && $ha === 200 && ($ra['data']['certificado_fallo']['ventas_hoy'] ?? -1) === 1, [$h, $ha, $ra]);
$pdo->exec("UPDATE `{$master}`.tenants SET cert_path = NULL WHERE id = {$tenantA}"); // el certificado se recupera
$claveE = $uuid();
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(1), 2500, 1, 2500, $claveE), $ses);
$filaE = $filaPorClave($claveE);
[$ha, $ra] = $api('GET', '/facturas/avisos', null, $admin);
wa_chk('recuperado el certificado la venta vuelve a ser e-CF (E32 aceptada) y el aviso del dia no se borra',
    $h === 201 && $filaE && preg_match('/^E32\d{10}$/', (string) $filaE['e_ncf']) === 1 && $filaE['estado_dgii'] === 'RFCE_ACEPTADO'
    && ($ra['data']['certificado_fallo']['ventas_hoy'] ?? -1) === 1, [$h, $filaE, $ra]);

// ---------------------------------------------------------------------------------------------------
echo "\n5. RF5: E32 agotada con E31 vigente, y su salida al registrar un rango que las cubre\n";
$ultimo = $contador('E32'); // H: el ultimo E32 que dio el rango
$pdo->exec("UPDATE `{$dbA}`.ncf_sequences SET numero_hasta = current_value WHERE type = 'E32' AND ambiente = 'testecf' AND numero_desde = 1");
$claveR1 = $uuid();
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(2), 5000, 1, 5000, $claveR1), $ses);
$filaR1 = $filaPorClave($claveR1);
$encfR1 = (string) ($r['data']['venta']['e_ncf'] ?? '');
$metaR1 = json_decode((string) ($filaR1['respuesta_dgii'] ?? ''), true);
wa_chk('E32 agotada: la venta usa el numero siguiente (H+1), queda PENDIENTE_ENVIO con envio pendiente, marcada sin_rango, y no se envia',
    $h === 201 && $encfR1 === $encfDe($ultimo + 1) && $filaR1['estado_dgii'] === 'PENDIENTE_ENVIO' && (int) $filaR1['envio_pendiente'] === 1
    && ($metaR1['sin_rango'] ?? false) === true && $recepciones($encfR1) === 0, [$h, $encfR1, $filaR1]);
$claveR2 = $uuid();
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(1), 2500, 1, 2500, $claveR2), $ses);
$encfR2 = (string) ($r['data']['venta']['e_ncf'] ?? '');
wa_chk('la segunda toma H+2 y tampoco se envia', $h === 201 && $encfR2 === $encfDe($ultimo + 2) && $recepciones($encfR2) === 0, [$h, $encfR2]);
$claveC = $uuid();
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(1), 2500, 1, 2500, $claveC, ['tipo_ecf' => '31', 'client_id' => $cliente]), $ses);
$encfC = (string) ($r['data']['venta']['e_ncf'] ?? '');
wa_chk('E31 sigue con su rango: sale a la DGII como siempre y no es sin_rango', $h === 201 && preg_match('/^E31\d{10}$/', $encfC) === 1 && $recepciones($encfC) === 1
    && !isset((json_decode((string) ($filaPorClave($claveC)['respuesta_dgii'] ?? ''), true) ?? [])['sin_rango']), [$h, $encfC]);
[$h, $r] = $api('GET', '/facturas/avisos', null, $admin);
$sec32 = array_values(array_filter($r['data']['secuencias'] ?? [], static fn($s) => str_ends_with((string) ($s['tipo'] ?? ''), '32')));
wa_chk('aviso al admin: la secuencia E32 esta agotada y hay 2 ventas esperando un rango',
    $h === 200 && $sec32 !== [] && $sec32[0]['estado'] === 'agotada' && ($r['data']['sin_rango']['ventas'] ?? -1) === 2, [$h, $r['data'] ?? $r]);
[$h, $r] = $api('POST', '/pos/pendientes/reenviar', [], $eq);
wa_chk('mientras ningun rango registrado las cubra, el reenvio las salta: siguen sin enviarse ni consultarse',
    $h === 200 && $recepciones($encfR1) === 0 && $consultas($encfR1) === 0 && $filaPorClave($claveR1)['estado_dgii'] === 'PENDIENTE_ENVIO', [$h, $r]);
// La DGII autoriza un rango que incluye esos numeros. POST /api/ncf/rangos exige un numero inicial mayor que todo lo ya
// usado, asi que se registra con la fila que dejaria esa autorizacion.
$pdo->prepare("INSERT INTO `{$dbA}`.ncf_sequences (type, prefix, current_value, numero_desde, numero_hasta, fecha_vencimiento, description, ambiente)
               VALUES ('E32', 'E32', ?, ?, ?, ?, 'rango de prueba que cubre los usados', 'testecf')")
    ->execute([$ultimo, $ultimo + 1, $ultimo + 100, date('Y-m-d', strtotime('+1 year'))]);
// Pasaron 10 minutos desde que se guardaron: ya no cuentan como "todavia se estan enviando" (RF3). La hora la pone PHP,
// como la puso la API (date('Y-m-d H:i:s')): no la de MySQL, que puede estar en otra zona horaria.
$pdo->prepare('UPDATE `' . $dbA . '`.facturas SET respuesta_dgii = JSON_SET(respuesta_dgii, \'$.desde\', ?) WHERE id IN (?, ?)')
    ->execute([date('Y-m-d H:i:s', time() - 600), (int) $filaR1['id'], (int) $filaPorClave($claveR2)['id']]);
[$h, $r] = $api('POST', '/pos/pendientes/reenviar', [], $eq);
$filaR1c = $filaPorClave($claveR1);
wa_chk('con el rango registrado, el reenvio las manda: la DGII las recibe una vez y quedan aceptadas',
    $h === 200 && $recepciones($encfR1) === 1 && $recepciones($encfR2) === 1 && $filaR1c['estado_dgii'] === 'RFCE_ACEPTADO'
    && $filaPorClave($claveR2)['estado_dgii'] === 'RFCE_ACEPTADO' && (int) $filaR1c['envio_pendiente'] === 0, [$h, $r, $filaR1c]);
[$h, $r] = $api('GET', '/facturas/avisos', null, $admin);
[$h2, $r2] = $api('POST', '/pos/ventas', $venta($aguas(1), 2500, 1, 2500), $ses);
$encfSig = (string) ($r2['data']['venta']['e_ncf'] ?? '');
wa_chk('el aviso de ventas esperando un rango se apaga y la venta siguiente no repite un numero usado: salta H+1 y H+2 y toma H+3',
    $h === 200 && ($r['data']['sin_rango']['ventas'] ?? -1) === 0 && $h2 === 201 && $encfSig === $encfDe($ultimo + 3), [$r['data'] ?? $r, $encfSig]);
$restaurar();

// ---------------------------------------------------------------------------------------------------
echo "\n6. «Reenviar a la DGII» sobre una venta rechazada del POS (spec 4.4)\n";
$modo('rechaza');
[$h, $r] = $api('POST', '/pos/ventas', $venta($aguas(2), 5000, 1, 5000), $ses);
$encfX = (string) ($r['data']['venta']['e_ncf'] ?? '');
$idX = (int) ($r['data']['venta']['factura_id'] ?? 0);
wa_chk('la venta rechazada se entrego: 201, RFCE_RECHAZADO', $h === 201 && $encfX !== '' && ($r['data']['venta']['estado_dgii'] ?? '') === 'RFCE_RECHAZADO', [$h, $r]);
$modo('acepta');
$contX = $contador('E32');
$stockX = $stock($agua);
[$h, $r] = $api('POST', "/facturas/{$idX}/reenviar", [], $admin);
$filasX = $pdo->query("SELECT id, estado_dgii FROM `{$dbA}`.facturas WHERE e_ncf = " . $pdo->quote($encfX) . ' OR no_factura = ' . $pdo->quote($encfX) . ' ORDER BY id')->fetchAll();
wa_chk('reenviar emite con el mismo numero (200/201); la rechazada queda archivada y la nueva aceptada',
    in_array($h, [200, 201], true) && ($r['data']['e_ncf'] ?? '') === $encfX && count($filasX) === 2
    && $filasX[0]['estado_dgii'] === 'RFCE_RECHAZADO_ARCHIVADO' && $filasX[1]['estado_dgii'] === 'RFCE_ACEPTADO', [$h, $r, $filasX]);
wa_chk('el numero no toca el contador, la DGII lo recibio dos veces (rechazo y reemision) y el inventario sale una sola vez',
    $contador('E32') === $contX && $recepciones($encfX) === 2 && $stock($agua) === $stockX, [$contX, $contador('E32'), $recepciones($encfX), $stockX, $stock($agua)]);

// ---------------------------------------------------------------------------------------------------
echo "\n7. El cierre cuenta las facturas simples y las lista con su numero\n";
[$h, $r] = $api('GET', '/pos/ventas', null, $ses);
$simple = array_values(array_filter($r['data']['ventas'] ?? [], static fn($v) => (int) $v['factura_id'] === (int) $filaS2['id']))[0] ?? null;
$noFactura = (string) $pdo->query("SELECT no_factura FROM `{$dbA}`.facturas WHERE id = {$filaS2['id']}")->fetchColumn();
wa_chk('ventas del turno: la factura simple sale con el numero de su factura (no vacia)', $h === 200 && $simple !== null && $noFactura !== '' && $simple['e_ncf'] === $noFactura, [$h, $simple]);
$efectivo = (float) $pdo->query("SELECT COALESCE(SUM(monto), 0) FROM `{$dbA}`.pos_caja_movimientos WHERE turno_id = {$turno} AND tipo = 'VENTA' AND forma_pago = 1")->fetchColumn();
[$h, $r] = $api('POST', '/pos/turno/cerrar', ['turno_id' => $turno, 'conteo' => ['1000' => 1, 'otros_centavos' => 0]], $ses);
$rep = $r['data']['reporte'] ?? [];
wa_chk('el reporte cuenta las 2 facturas simples como "Simple", sin una clave "E" vacia', $h === 200 && ($rep['comprobantes']['Simple'] ?? 0) === 2
    && !array_key_exists('E', $rep['comprobantes'] ?? []), [$h, $rep['comprobantes'] ?? $r]);
wa_chk('el esperado suma el efectivo de todas las ventas, tambien el de las facturas simples', ($rep['esperado_centavos'] ?? -1) === (int) round($efectivo * 100), [$rep['esperado_centavos'] ?? null, $efectivo]);

$restaurar();
$api('POST', '/auth/signout', [], $admin);
wa_fin();
```

- [ ] **Step 3: Run it and watch exactly two checks fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -l tools/test_pos_write_ahead.php
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php --suites=test_pos_write_ahead; echo "exit=$?"
```

Expected: `== test_pos_write_ahead: FALLO (codigo 1)`, exactly two `[FALLO]` lines, both in section 7 (`ventas del turno: la factura simple sale con el numero de su factura`: today `e_ncf` is `null`; `el reporte cuenta las 2 facturas simples como "Simple"`: today `'E' . null` is the key `E`), and the last line `28 de 30 pruebas OK`. The other 28 checks are the end-to-end proof of RF1 to RF5 on Tasks 3-10; any other `FALLO` is a defect in the task that owns that behaviour (the runner prints its `obtenido` line).

- [ ] **Step 4: Apply the new expectations to the four suites**

`$S/aplicar_lib.php` comes from Task 13 Step 6. Create `$S/aplicar_suites.php` with the Write tool:

```php
<?php
/**
 * Aplica a las suites del POS (las de master, tal como llegan del merge) los cambios que pide
 * la spec 2026-10-12. Uso:  php aplicar_suites.php <raiz del API>
 */

require __DIR__ . '/aplicar_lib.php';
$raiz = raiz_del_api($argv);

// La guarda va justo despues de saber que tenant y que bases se van a borrar.
$guardaA = <<<'T'
[$tenantA, $dbA] = [(int) $f['id'], $f['db_name']];
$pdo->exec("UPDATE `{$master}`.tenants SET pos_enabled = 1 WHERE id = {$tenantA}");
T;
$guardaANuevo = <<<'T'
[$tenantA, $dbA] = [(int) $f['id'], $f['db_name']];
require_once __DIR__ . '/pos_scratch_guard.php';
pos_scratch_exigir($pdo, (string) getenv('MASTER_DB_HOST'), [$master, $dbA]);
$pdo->exec("UPDATE `{$master}`.tenants SET pos_enabled = 1 WHERE id = {$tenantA}");
T;

// ---------------------------------------------------------------------------
aplicar($raiz . '/tools/test_pos_backend.php', [
    [<<<'T'
[$tenantA, $dbA] = $dbDe(getenv('POS_TEST_ADMIN_A'));
[$tenantB, $dbB] = $dbDe(getenv('POS_TEST_ADMIN_B'));
T, <<<'T'
[$tenantA, $dbA] = $dbDe(getenv('POS_TEST_ADMIN_A'));
[$tenantB, $dbB] = $dbDe(getenv('POS_TEST_ADMIN_B'));
require_once __DIR__ . '/pos_scratch_guard.php';
pos_scratch_exigir($pdo, (string) getenv('MASTER_DB_HOST'), [$master, $dbA, $dbB]);
T],
]);

// ---------------------------------------------------------------------------
aplicar($raiz . '/tools/test_pos_venta.php', [
    [$guardaA, $guardaANuevo],
    // 5. Un rechazo al cobrar ya no detiene la venta: se entrega.
    [<<<'T'
echo "\n5. Rechazo de la DGII (F6)\n";
T, <<<'T'
=== 'RFCE_RECHAZADO_ARCHIVADO', [$h, $r]);
T, <<<'T'
echo "\n5. Rechazo de la DGII al cobrar: la venta se entrega igual (F6, spec 2026-10-12)\n";
$modo('rechaza');
$stockAgua = $stock($agua);
$secAntes = (int) $pdo->query("SELECT current_value FROM `{$dbA}`.ncf_sequences WHERE type = 'E32' AND ambiente = 'testecf'")->fetchColumn();
$cuerpoRech = $venta([['product_id' => $agua, 'cantidad' => 2]], 5000, 1, 5000);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpoRech, $ana);
$vr = $r['data']['venta'] ?? [];
$encfRech = (string) ($vr['e_ncf'] ?? '');
$chk('201: se entrega aunque la DGII la rechace, con recibo y sin envio pendiente', $h === 201 && preg_match('/^E32\d{10}$/', $encfRech) === 1
    && ($vr['estado_dgii'] ?? '') === 'RFCE_RECHAZADO' && ($vr['envio_pendiente'] ?? null) === false && is_array($r['data']['recibo'] ?? null)
    && ($r['data']['cobro']['devuelta_centavos'] ?? -1) === 0, [$h, $r]);
$filaR = $pdo->query("SELECT id, estado_dgii, rfce_respuesta FROM `{$dbA}`.facturas WHERE e_ncf = " . $pdo->quote($encfRech))->fetch();
$chk('la factura queda RFCE_RECHAZADO con el motivo de la DGII guardado, el dinero en caja y la salida de inventario', $filaR && $filaR['estado_dgii'] === 'RFCE_RECHAZADO'
    && str_contains((string) $filaR['rfce_respuesta'], 'El MontoTotal no corresponde')
    && (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$filaR['id']}")->fetchColumn() === 1
    && $stock($agua) === $stockAgua - 2, [$filaR, $stockAgua, $stock($agua)]);
$secDespues = (int) $pdo->query("SELECT current_value FROM `{$dbA}`.ncf_sequences WHERE type = 'E32' AND ambiente = 'testecf'")->fetchColumn();
$chk('el numero de una venta del POS nunca vuelve a la secuencia: ya esta impreso', $secDespues === $secAntes + 1, [$secAntes, $secDespues]);
$modo('acepta');
[$h, $r] = $api('POST', '/pos/ventas', $venta([['product_id' => $agua, 'cantidad' => 2]], 5000, 1, 5000), $ana);
$chk('la venta siguiente toma el numero que sigue y la rechazada se queda como esta (no se archiva)', $h === 201 && ($r['data']['venta']['e_ncf'] ?? '') !== $encfRech
    && $pdo->query("SELECT estado_dgii FROM `{$dbA}`.facturas WHERE id = {$filaR['id']}")->fetchColumn() === 'RFCE_RECHAZADO', [$h, $r]);
[$h, $r] = $api('POST', '/pos/ventas', $cuerpoRech, $ana);
$chk('repetir la clave de la rechazada: 201 repetida con la misma venta, sin otro envio ni otro movimiento de caja', $h === 201
    && ($r['data']['repetida'] ?? false) === true && ($r['data']['venta']['e_ncf'] ?? '') === $encfRech && $rfceRecibidos($encfRech) === 1
    && (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$filaR['id']}")->fetchColumn() === 1,
    [$h, $r, $rfceRecibidos($encfRech)]);
T, 1],
    // 6. Sin respuesta a tiempo: ya no hay un estado "pendiente" propio del POS.
    [<<<'T'
$chk('a los ~5 s responde 201 con envio pendiente (RFCE_PENDIENTE), recibo y devuelta', $h === 201 && $dur < 7.5
    && ($r['data']['venta']['estado_dgii'] ?? '') === 'RFCE_PENDIENTE' && $r['data']['venta']['envio_pendiente'] === true
T, <<<'T'
$chk('a los ~5 s responde 201 con envio pendiente (ENVIO_INCIERTO), recibo y devuelta', $h === 201 && $dur < 7.5
    && ($r['data']['venta']['estado_dgii'] ?? '') === 'ENVIO_INCIERTO' && $r['data']['venta']['envio_pendiente'] === true
T],
    // 8. Bitacora: la rechazada al cobrar es una POS_VENTA; POS_VENTA_RECHAZADA es de un rechazo tardio.
    [<<<'T'
foreach (['POS_TURNO_ABIERTO', 'POS_VENTA', 'POS_VENTA_RECHAZADA', 'POS_VENTA_ENVIADA'] as $a) {
    $chk("bitacora: {$a}", ($acciones[$a] ?? 0) > 0, $acciones);
}
T, <<<'T'
foreach (['POS_TURNO_ABIERTO', 'POS_VENTA', 'POS_VENTA_ENVIADA'] as $a) {
    $chk("bitacora: {$a}", ($acciones[$a] ?? 0) > 0, $acciones);
}
$chk('bitacora: la venta rechazada al cobrar quedo como POS_VENTA (de su factura), no como una venta fallida',
    count(array_filter($filasAudit, fn($f) => $f['action'] === 'POS_VENTA' && str_contains((string) $f['new_values'], '"factura_id":' . $filaR['id']))) > 0, $acciones);
T],
]);

// ---------------------------------------------------------------------------
aplicar($raiz . '/tools/test_pos_cierre.php', [
    [$guardaA, $guardaANuevo],
    // La rechazada por la DGII se entrega: su efectivo entra a la caja (100.00 mas).
    [<<<'T'
$cuentaAna = $conteo(['1000' => 1, '500' => 1, '200' => 1, '20' => 1, '5' => 1, '1' => 4], 25); // 1,729.25
T, <<<'T'
$cuentaAna = $conteo(['1000' => 1, '500' => 1, '200' => 1, '100' => 1, '20' => 1, '5' => 1, '1' => 4], 25); // 1,829.25
T],
    [<<<'T'
$chk('ventas: efectivo 179.50, tarjeta 25.00, transferencia 38.00, efectivo 50.00 pendiente; una rechazada',
    [$h1, $h2, $h3, $h4, $h5] === [201, 201, 201, 201, 422] && ($r4['data']['venta']['envio_pendiente'] ?? false) === true
    && ($r5['codigo'] ?? '') === 'DGII_RECHAZO', [$h1, $h2, $h3, $h4, $h5, $r5]);
T, <<<'T'
$encfRech = (string) ($r5['data']['venta']['e_ncf'] ?? '');
$chk('ventas: efectivo 179.50, tarjeta 25.00, transferencia 38.00, efectivo 50.00 pendiente; efectivo 100.00 rechazada por la DGII y entregada igual',
    [$h1, $h2, $h3, $h4, $h5] === [201, 201, 201, 201, 201] && ($r4['data']['venta']['envio_pendiente'] ?? false) === true
    && ($r5['data']['venta']['estado_dgii'] ?? '') === 'RFCE_RECHAZADO' && $encfRech !== '', [$h1, $h2, $h3, $h4, $h5, $r5]);
T],
    [<<<'T'
$chk('ventas del turno (K9): las 4 cobradas, sin la rechazada, la mas nueva primero y la pendiente marcada',
    $h === 200 && count($ventas) === 4 && $ventas[0]['e_ncf'] === $encfPendiente && $ventas[0]['envio_pendiente'] === true
    && array_column($ventas, 'forma_pago') === [1, 2, 3, 1], [$h, $ventas]);
T, <<<'T'
$chk('ventas del turno (K9): las 5 cobradas, la rechazada incluida porque se entrego, la mas nueva primero y la pendiente marcada',
    $h === 200 && count($ventas) === 5 && $ventas[0]['e_ncf'] === $encfRech && $ventas[1]['e_ncf'] === $encfPendiente
    && $ventas[1]['envio_pendiente'] === true && array_column($ventas, 'forma_pago') === [1, 1, 2, 3, 1], [$h, $ventas]);
T],
    [<<<'T'
$chk('esperado = 1,500 de fondo + 179.50 + 50.00 en efectivo (la pendiente cuenta) = 1,729.50; contado 1,729.25; faltan 0.25',
    $h === 200 && ($rep['esperado_centavos'] ?? 0) === 172950 && $rep['contado_centavos'] === 172925 && $rep['diferencia_centavos'] === -25, [$h, $r]);
T, <<<'T'
$chk('esperado = 1,500 de fondo + 179.50 + 50.00 (pendiente) + 100.00 (rechazada y entregada) en efectivo = 1,829.50; contado 1,829.25; faltan 0.25',
    $h === 200 && ($rep['esperado_centavos'] ?? 0) === 182950 && $rep['contado_centavos'] === 182925 && $rep['diferencia_centavos'] === -25, [$h, $r]);
T],
    [<<<'T'
$chk('ventas por forma: efectivo 2 / 229.50, transferencia 1 / 38.00, tarjeta 1 / 25.00; 4 en total',
    ($rep['ventas']['cantidad'] ?? 0) === 4 && ($porForma[1]['cantidad'] ?? 0) === 2 && $porForma[1]['monto_centavos'] === 22950
T, <<<'T'
$chk('ventas por forma: efectivo 3 / 329.50, transferencia 1 / 38.00, tarjeta 1 / 25.00; 5 en total',
    ($rep['ventas']['cantidad'] ?? 0) === 5 && ($porForma[1]['cantidad'] ?? 0) === 3 && $porForma[1]['monto_centavos'] === 32950
T],
    [<<<'T'
$chk('4 facturas E32; 1 cancelada (45.00) y 2 lineas quitadas (50.00); la pendiente listada, ninguna rechazada cobrada',
    ($rep['comprobantes'] ?? []) === ['E32' => 4] && $rep['canceladas'] === ['cantidad' => 1, 'monto_centavos' => 4500]
    && $rep['lineas_quitadas'] === ['cantidad' => 2, 'monto_centavos' => 5000]
    && array_column($rep['pendientes'], 'e_ncf') === [$encfPendiente] && $rep['rechazadas'] === [], $rep);
T, <<<'T'
$chk('5 facturas E32; 1 cancelada (45.00) y 2 lineas quitadas (50.00); la pendiente listada y la rechazada listada como rechazada',
    ($rep['comprobantes'] ?? []) === ['E32' => 5] && $rep['canceladas'] === ['cantidad' => 1, 'monto_centavos' => 4500]
    && $rep['lineas_quitadas'] === ['cantidad' => 2, 'monto_centavos' => 5000]
    && array_column($rep['pendientes'], 'e_ncf') === [$encfPendiente]
    && $rep['rechazadas'] === [['e_ncf' => $encfRech, 'total_centavos' => 10000]], $rep);
T],
    [<<<'T'
    $fila['abierto'] === null && (int) $fila['cerrado_por'] === $luisId && (float) $fila['efectivo_contado'] === 1729.25
    && (float) $fila['efectivo_esperado'] === 1729.5 && (float) $fila['diferencia'] === -0.25 && (int) $fila['c'] === 1 && (int) $fila['t'] === 1, $fila);
T, <<<'T'
    $fila['abierto'] === null && (int) $fila['cerrado_por'] === $luisId && (float) $fila['efectivo_contado'] === 1829.25
    && (float) $fila['efectivo_esperado'] === 1829.5 && (float) $fila['diferencia'] === -0.25 && (int) $fila['c'] === 1 && (int) $fila['t'] === 1, $fila);
T],
    [<<<'T'
$chk('Ana: sus 4 ventas de hoy aunque el turno ya se cerro, la mas nueva primero, sin la rechazada', $h === 200
    && count($d['ventas'] ?? []) === 4 && $d['ventas'][0]['e_ncf'] === $encfPendiente && $d['fecha'] === date('Y-m-d')
T, <<<'T'
$chk('Ana: sus 5 ventas de hoy aunque el turno ya se cerro, la mas nueva primero, con la rechazada que se entrego', $h === 200
    && count($d['ventas'] ?? []) === 5 && $d['ventas'][0]['e_ncf'] === $encfRech && $d['fecha'] === date('Y-m-d')
T],
    [<<<'T'
$chk('resumen: 4 ventas por 292.50; efectivo 2 (229.50), transferencia 1 (38.00), tarjeta 1 (25.00)',
    ($d['resumen'] ?? null) === ['cantidad' => 4, 'total_centavos' => 29250, 'por_forma' => [
        ['forma_pago' => 1, 'nombre' => 'Efectivo', 'cantidad' => 2, 'total_centavos' => 22950],
T, <<<'T'
$chk('resumen: 5 ventas por 392.50; efectivo 3 (329.50), transferencia 1 (38.00), tarjeta 1 (25.00)',
    ($d['resumen'] ?? null) === ['cantidad' => 5, 'total_centavos' => 39250, 'por_forma' => [
        ['forma_pago' => 1, 'nombre' => 'Efectivo', 'cantidad' => 3, 'total_centavos' => 32950],
T],
    [<<<'T'
$ayer = (int) ($d['ventas'][3]['factura_id'] ?? 0);
T, <<<'T'
$ayer = (int) ($d['ventas'][4]['factura_id'] ?? 0);
T],
    [<<<'T'
$chk('una venta de ayer no sale', $h === 200 && count($r['data']['ventas'] ?? []) === 3
T, <<<'T'
$chk('una venta de ayer no sale', $h === 200 && count($r['data']['ventas'] ?? []) === 4
T],
    [<<<'T'
$chk('detalle: el mismo reporte que se imprimio al cerrar, con la nota', $h === 200 && ($r['data']['reporte']['contado_centavos'] ?? 0) === 172925
T, <<<'T'
$chk('detalle: el mismo reporte que se imprimio al cerrar, con la nota', $h === 200 && ($r['data']['reporte']['contado_centavos'] ?? 0) === 182925
T],
]);

// ---------------------------------------------------------------------------
aplicar($raiz . '/tools/test_pos_e31.php', [
    [$guardaA, $guardaANuevo],
    [<<<'T'
$chk('rechazado al recibir: 422 DGII_RECHAZO con el motivo, sin cobrar', $h === 422 && ($r['codigo'] ?? '') === 'DGII_RECHAZO'
    && str_contains((string) ($r['error'] ?? ''), 'RNCComprador no valido'), [$h, $r]);
T, <<<'T'
$encfRech = (string) ($r['data']['venta']['e_ncf'] ?? '');
$chk('rechazado al recibir: 201, se entrega igual como RECHAZADO y sin envio pendiente', $h === 201 && preg_match('/^E31\d{10}$/', $encfRech) === 1
    && ($r['data']['venta']['estado_dgii'] ?? '') === 'RECHAZADO' && ($r['data']['venta']['envio_pendiente'] ?? null) === false, [$h, $r]);
$filaRech = $factura($encfRech);
$chk('la factura queda RECHAZADA con el motivo de la DGII guardado y el dinero en caja', $filaRech && $filaRech['estado_dgii'] === 'RECHAZADO'
    && str_contains((string) $filaRech['respuesta_dgii'], 'RNCComprador no valido')
    && (int) $pdo->query("SELECT COUNT(*) FROM `{$dbA}`.pos_caja_movimientos WHERE factura_id = {$filaRech['id']}")->fetchColumn() === 1, $filaRech);
T],
    [<<<'T'
$chk('caida: 201, ENVIO_PENDIENTE, sin trackId, con el XML firmado guardado', $h === 201 && ($r['data']['venta']['estado_dgii'] ?? '') === 'ENVIO_PENDIENTE'
T, <<<'T'
$chk('caida: 201, ENVIO_INCIERTO, sin trackId, con el XML firmado guardado', $h === 201 && ($r['data']['venta']['estado_dgii'] ?? '') === 'ENVIO_INCIERTO'
T],
    [<<<'T'
    && $factura($encfCaido)['estado_dgii'] === 'ENVIO_PENDIENTE', [$h, $r]);
T, <<<'T'
    && $factura($encfCaido)['estado_dgii'] === 'ENVIO_INCIERTO', [$h, $r]);
T],
    [<<<'T'
$chk('lenta: 201 pendiente sin trackId', $h === 201 && ($r['data']['venta']['estado_dgii'] ?? '') === 'ENVIO_PENDIENTE', [$h, $r]);
T, <<<'T'
$chk('lenta: 201 pendiente sin trackId', $h === 201 && ($r['data']['venta']['estado_dgii'] ?? '') === 'ENVIO_INCIERTO', [$h, $r]);
T],
]);

echo "listo\n";
```

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
php "$S/aplicar_suites.php" "$A"
cd "$A"
for f in tools/test_pos_backend.php tools/test_pos_venta.php tools/test_pos_cierre.php tools/test_pos_e31.php; do php -l "$f"; done
```

Expected: `test_pos_backend.php: 1 cambios`, `test_pos_venta.php: 4 cambios`, `test_pos_cierre.php: 13 cambios`, `test_pos_e31.php: 5 cambios`, `listo` and four `No syntax errors`. If a marker fails the script says which and writes nothing: the suite differs from `origin/master`, so fix the marker, not the suite.

- [ ] **Step 5: Run the four suites with their new expectations, then commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php --suites=test_pos_backend,test_pos_venta,test_pos_cierre,test_pos_e31; echo "exit=$?"
```

Expected: `OK (100 verificaciones)`, `OK (49 verificaciones)`, `OK (50 verificaciones)`, `OK (36 verificaciones)`, `suites OK: 4 de 4` and `exit=0`. A failure here is a defect in the task that owns the behaviour (3-10), not an expectation to relax. Then:

```bash
git status --short
git add tools/test_pos_backend.php tools/test_pos_venta.php tools/test_pos_cierre.php tools/test_pos_e31.php
git commit -m "test(pos): las suites de master siguen la spec del write-ahead y no corren fuera de las bases scratch

Un rechazo al cobrar se entrega (201) sin devolver el numero; un envio sin
respuesta es ENVIO_INCIERTO; el cierre cuenta la rechazada entregada. Las cuatro
suites se niegan a correr salvo sobre bases wa_scratch marcadas o un MySQL local.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: The closing report and the lists identify a factura simple**

Create `$S/aplicar_cierre.php` with the Write tool:

```php
<?php
/**
 * Facturas simples en el cierre y en las listas del POS: la venta que salio como factura simple
 * no tiene e-NCF ni tipo_ecf. Uso:  php aplicar_cierre.php <raiz del API>
 */

require __DIR__ . '/aplicar_lib.php';
$raiz = raiz_del_api($argv);

aplicar($raiz . '/src/Models/posModel.php', [
    [<<<'T'
            "SELECT f.id, f.e_ncf, f.tipo_ecf, f.estado_dgii, f.envio_pendiente, f.total, f.date, m.forma_pago
             FROM pos_caja_movimientos m JOIN facturas f ON f.id = m.factura_id
T, <<<'T'
            "SELECT f.id, f.e_ncf, f.no_factura, f.tipo_ecf, f.estado_dgii, f.envio_pendiente, f.total, f.date, m.forma_pago
             FROM pos_caja_movimientos m JOIN facturas f ON f.id = m.factura_id
T],
    [<<<'T'
            "SELECT f.id, f.e_ncf, f.tipo_ecf, f.estado_dgii, f.envio_pendiente, f.total, f.date, m.forma_pago, m.turno_id,
T, <<<'T'
            "SELECT f.id, f.e_ncf, f.no_factura, f.tipo_ecf, f.estado_dgii, f.envio_pendiente, f.total, f.date, m.forma_pago, m.turno_id,
T],
]);

aplicar($raiz . '/src/Pos/PosCierre.php', [
    // El reporte: la factura simple se cuenta como "Simple", no como una clave "E" vacia.
    [<<<'T'
            $tipo = 'E' . $v['tipo_ecf'];
            $comprobantes[$tipo] = ($comprobantes[$tipo] ?? 0) + 1;
            $item = ['e_ncf' => $v['e_ncf'], 'total_centavos' => $centavos($v['total'])];
T, <<<'T'
            $tipo = ($v['tipo_ecf'] ?? '') === '' ? 'Simple' : 'E' . $v['tipo_ecf'];
            $comprobantes[$tipo] = ($comprobantes[$tipo] ?? 0) + 1;
            $item = ['e_ncf' => self::numero($v), 'total_centavos' => $centavos($v['total'])];
T],
    // Ventas del turno (K9).
    [<<<'T'
            'factura_id' => (int) $v['id'],
            'e_ncf' => $v['e_ncf'],
            'tipo_ecf' => (string) $v['tipo_ecf'],
            'fecha' => $v['date'],
            'total_centavos' => (int) round(((float) $v['total']) * 100),
T, <<<'T'
            'factura_id' => (int) $v['id'],
            'e_ncf' => self::numero($v),
            'tipo_ecf' => (string) $v['tipo_ecf'],
            'fecha' => $v['date'],
            'total_centavos' => (int) round(((float) $v['total']) * 100),
T],
    // Ventas del dia.
    [<<<'T'
                'factura_id' => (int) $v['id'],
                'e_ncf' => $v['e_ncf'],
                'tipo_ecf' => (string) $v['tipo_ecf'],
                'fecha' => $v['date'],
                'turno_id' => (int) $v['turno_id'],
T, <<<'T'
                'factura_id' => (int) $v['id'],
                'e_ncf' => self::numero($v),
                'tipo_ecf' => (string) $v['tipo_ecf'],
                'fecha' => $v['date'],
                'turno_id' => (int) $v['turno_id'],
T],
    // El ayudante, justo antes de las ventas del turno.
    [<<<'T'
    /** Ventas cobradas del turno abierto de la caja (K9), las mas nuevas primero. */
T, <<<'T'
    /**
     * Con que numero se identifica una venta: su e-NCF o, si salio como factura
     * simple (sin e-NCF, sin tipo_ecf), el numero de su factura.
     */
    private static function numero(array $v): string
    {
        return (string) (($v['e_ncf'] ?? '') !== '' ? $v['e_ncf'] : ($v['no_factura'] ?? ''));
    }

    /** Ventas cobradas del turno abierto de la caja (K9), las mas nuevas primero. */
T],
]);
echo "listo\n";
```

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
php "$S/aplicar_cierre.php" "$A"
cd "$A"
php -l src/Pos/PosCierre.php; php -l src/Models/posModel.php
```

Expected: `posModel.php: 2 cambios`, `PosCierre.php: 4 cambios`, `listo` and two `No syntax errors`. A factura simple now prints as `Simple` in the report and with its `no_factura` in the lists; an e-CF sale is unchanged (`numero()` returns the e-NCF).

- [ ] **Step 7: Run all five suites green, then commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
F="-d extension=curl -d extension=openssl -d extension=pdo_mysql"
php $F tools/test_pos_scratch.php; echo "exit=$?"
php $F tools/test_pos_scratch.php --suites=test_pos_backend --enforce | grep -E '^(==|suites)'
```

Expected: `suites OK: 5 de 5` (backend 100, venta 49, cierre 50, e31 36, write_ahead 30) with `exit=0`; and the `--enforce` run (central permission gate on; the backend header says it passes in `enforce` and in shadow) prints `== test_pos_backend: OK (100 verificaciones)` and `suites OK: 1 de 1`. Then:

```bash
git status --short
git add tools/test_pos_write_ahead.php src/Pos/PosCierre.php src/Models/posModel.php
git commit -m "feat(pos): escenarios de la venta sobre el write-ahead y el cierre con facturas simples

RF1 a RF5 de punta a punta (misma clave en vuelo, corte antes de la caja, reenvio
que no toca una venta en curso, certificado que falla y se recupera, secuencia
agotada), Reenviar a la DGII sobre una venta rechazada y el cierre. El reporte
cuenta la factura simple como Simple y las listas la identifican con su numero.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Documentación

**Files:**
- Modify: `docs/api/pos.md` (8 edits), `docs/specs/pos.md` (11), `docs/integrations/dgii-ecf.md` (2) and `docs/api/facturas.md` (3). Both POS docs come from `origin/master` as merged; the other two are ours (CRLF on disk, which the script keeps).
- Replace: `docs/integrations/pos-write-ahead.md`. Since `0a4de41` it is the note "lo que la venta del POS tiene que respetar"; it becomes the as-built description.
- Modify: `tools/test_write_ahead_puro.php`: a new section 14 of 13 checks that pins the new text and bans the old vocabulary.
- Create, in the session scratchpad only: `$S/aplicar_docs.php` (needs `$S/aplicar_lib.php` from Task 13 Step 6; create it again from there if the scratchpad is new).
- `CLAUDE.md`: no edit; Step 5 proves it states nothing that became false.

`$S` is the scratchpad directory your system prompt lists. Paths are relative to the API worktree. Every marker below was checked to match once on `origin/master`'s POS docs and on this branch's `dgii-ecf.md` and `facturas.md`; the script was run against those copies and the 13 pins of Step 1 passed on the result.

**Interfaces:**
- Consumes: the behaviour of Tasks 3-10 as the spec fixes it. The docs describe the finished feature; Step 4 checks each claim against the code, and where they differ the code is fixed or the doc line is (never left apart).
- Produces: the docs and the puro section 14. It also closes a known red: the Release 1 puro check `nada en src, docs ni CLAUDE.md nombra saveFacturaConECF` stays red after Task 5 because `docs/specs/pos.md` (from `master`) names it in its progress log; the edit "Bitácora de avance" below removes that last mention.

- [ ] **Step 1: Write the failing pins (section 14 of the puro test)**

In `tools/test_write_ahead_puro.php` (LF on disk) insert the section just before the closing block. Old text (the file's last four lines):

```php
// ---------------------------------------------------------------------------
// Cierre. Cada tarea agrega su seccion justo encima de este bloque.
// ---------------------------------------------------------------------------
wa_fin();
```

New text: the section below, then that same block unchanged.

```php
// ---------------------------------------------------------------------------
// 14) Documentacion de la venta del POS y de «Reenviar a la DGII» (Task 15).
// ---------------------------------------------------------------------------
echo "\n== 14) Documentacion del POS y de Reenviar a la DGII ==\n";
$s14Leer = static fn(string $ruta): string
    => str_replace("\r\n", "\n", (string) @file_get_contents(dirname(__DIR__) . '/' . $ruta));
$s14Pos = $s14Leer('docs/integrations/pos-write-ahead.md');
wa_chk('pos-write-ahead.md: describe lo que hace el codigo (entrega, factura simple, sin_rango, opciones del POS, reenvio)',
    str_contains($s14Pos, 'entregarVenta') && str_contains($s14Pos, '## 4. Fallo antes de guardar: factura simple')
    && str_contains($s14Pos, '`sin_rango`') && str_contains($s14Pos, '`reclamar_secuencia`') && str_contains($s14Pos, 'compare-and-set')
    && str_contains($s14Pos, 'GET /api/facturas/avisos') && str_contains($s14Pos, '«Reenviar a la DGII»'));
wa_chk('pos-write-ahead.md: ya no es la nota "lo que tiene que respetar"',
    !str_contains($s14Pos, 'tiene que respetar') && !str_contains($s14Pos, 'Hoy `reservarFacturaECF` no escribe'));
$s14ApiPos = $s14Leer('docs/api/pos.md');
wa_chk('api/pos.md: la venta ya no tiene DGII_RECHAZO, EMISION_FALLIDA ni GUARDADO_FALLIDO en la tabla de errores',
    !str_contains($s14ApiPos, '| `DGII_RECHAZO` |') && !str_contains($s14ApiPos, '| `EMISION_FALLIDA` |') && !str_contains($s14ApiPos, '| `GUARDADO_FALLIDO` |')
    && str_contains($s14ApiPos, '| `VENTA_EN_PROCESO` |'));
wa_chk('api/pos.md: ENVIO_INCIERTO, sin_rango, el reenvio con compare-and-set y la auditoria de la factura simple',
    str_contains($s14ApiPos, 'estado_dgii: ENVIO_INCIERTO') && str_contains($s14ApiPos, '`sin_rango`')
    && str_contains($s14ApiPos, 'compare-and-set') && str_contains($s14ApiPos, 'POS_VENTA_FACTURA_SIMPLE'));
wa_chk('api/pos.md: el corredor de pruebas scratch y la suite nueva',
    str_contains($s14ApiPos, 'tools/test_pos_scratch.php') && str_contains($s14ApiPos, 'tools/test_pos_write_ahead.php'));
$s14SpecPos = $s14Leer('docs/specs/pos.md');
wa_chk('specs/pos.md: decisiones 38 y 39, F6 sin "rechazada -> no hay recibo" y la entrega idempotente en 9.5',
    str_contains($s14SpecPos, '| 38 | La venta no se detiene |') && str_contains($s14SpecPos, '| 39 | Secuencia agotada |')
    && !str_contains($s14SpecPos, 'Respuesta **rechazada** → no hay recibo') && str_contains($s14SpecPos, 'PosVenta::entregarVenta'));
$s14Dgii = $s14Leer('docs/integrations/dgii-ecf.md');
wa_chk('dgii-ecf.md: la app nunca reenvia una factura sin confirmar y si reemite una rechazada',
    str_contains($s14Dgii, 'nunca reenvía una factura sin confirmar') && str_contains($s14Dgii, '### Reenviar a la DGII una factura rechazada')
    && str_contains($s14Dgii, 'tomarLockReenvio') && str_contains($s14Dgii, 'devolverSaldoDeFactura'));
$s14Fact = $s14Leer('docs/api/facturas.md');
wa_chk('facturas.md: GET /avisos y POST /reenviar documentados, con el 409 de las facturas sin confirmar',
    str_contains($s14Fact, '### Avisos del e-CF — `GET /api/facturas/avisos`')
    && str_contains($s14Fact, '### Reenviar a la DGII — `POST /api/facturas/{id}/reenviar`') && str_contains($s14Fact, 'incluida toda factura sin confirmar'));
wa_chk('facturas.md: ya no dice que /reenviar responde 501',
    !str_contains($s14Fact, 'sigue respondiendo `501`') && !str_contains($s14Fact, 'responde `501`'));
foreach (['RFCE_PENDIENTE', 'ENVIO_PENDIENTE', 'tolerar_fallo_envio'] as $s14Viejo) {
    wa_chk("nada en src ni docs nombra {$s14Viejo}", wa_grep(['src', 'docs'], $s14Viejo) === [], wa_grep(['src', 'docs'], $s14Viejo));
}
wa_chk('CLAUDE.md no afirma nada falso sobre el reenvio (sin 501 ni "no se reenv")',
    !str_contains($s14Leer('CLAUDE.md'), '501') && !str_contains($s14Leer('CLAUDE.md'), 'no se reenv'));
```

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php -l tools/test_write_ahead_puro.php
php tools/test_write_ahead_puro.php | tail -32; echo "exit=${PIPESTATUS[0]}"
```

Expected: section 14 prints 13 checks, 11 of them `[FALLO]` (the two that already pass are the `tolerar_fallo_envio` grep and the `CLAUDE.md` check), with `obtenido: ["docs/api/pos.md","docs/specs/pos.md"]` on the `RFCE_PENDIENTE` and `ENVIO_PENDIENTE` lines. The older `saveFacturaConECF` check also fails (the known red). Exit code 1.

- [ ] **Step 2: Apply the edits to the four docs**

Create `$S/aplicar_docs.php` with the Write tool (four backticks outside because the text it carries has fences of its own):

````php
<?php
/**
 * Documentacion de la entrega (spec 2026-10-12). Uso:  php aplicar_docs.php <raiz del API>
 * Los archivos CRLF se leen y se escriben con su fin de linea (ver aplicar_lib.php).
 */

require __DIR__ . '/aplicar_lib.php';
$raiz = raiz_del_api($argv);

aplicar($raiz . '/docs/api/pos.md', [
    // La venta ya no responde estos tres codigos.
    [<<<'T'
| `DGII_RECHAZO` | 422 |
T, <<<'T'
avisar a soporte con el `e_ncf` |
T, <<<'T'
| `VENTA_EN_PROCESO` | 409 | Otra petición con la misma clave está emitiendo: reintentar con la MISMA clave |
T, 1],
    [<<<'T'
Con `PERMISSIONS_ENFORCE=true` el gate central responde un 403 propio, sin `codigo`,
T, <<<'T'
`POST /api/pos/ventas` ya no responde `DGII_RECHAZO`, `EMISION_FALLIDA` ni `GUARDADO_FALLIDO` (spec
2026-10-12): una venta no se detiene por la DGII, el certificado ni la secuencia. La frenan las
validaciones del carrito (los `4xx` de la tabla) y que el servidor o la base no estén disponibles.

Con `PERMISSIONS_ENFORCE=true` el gate central responde un 403 propio, sin `codigo`,
T],
    [<<<'T'
Factura, movimiento de caja y salida de inventario van juntos.
T, <<<'T'
La factura se guarda antes de enviarla; la caja y el inventario se entregan después, una sola vez.
T],
    [<<<'T'
- **DGII lenta o caída** (sin respuesta en `POS_DGII_TIMEOUT` s, 5 por defecto): `201`
T, <<<'T'
  (alerta en el POS).
T, <<<'T'
- **La factura se guarda antes de enviarla** (write-ahead, ver
  [../integrations/pos-write-ahead.md](../integrations/pos-write-ahead.md)) y cualquier resultado
  después de guardar se entrega: `201` con el recibo, haya respondido la DGII o no.
  - **Aceptada:** `RFCE_ACEPTADO` (E32) o `ACEPTADO` (E31), `envio_pendiente: false`.
  - **DGII lenta o caída** (sin respuesta en `POS_DGII_TIMEOUT` s, 5 por defecto, o fallo de
    transporte): `estado_dgii: ENVIO_INCIERTO` y `envio_pendiente: true`. Se imprime igual
    (decisión 17) y el reenvío automático (abajo) la resuelve.
  - **E31 recibido:** la DGII da el veredicto después: `ENVIADO` (o `EN_PROCESO`) con
    `envio_pendiente: true`; el reenvío lo confirma.
  - **Rechazada** (al cobrar o más tarde): se entrega igual. La caja y el inventario quedan, el
    número no vuelve al contador (ya está impreso), el cierre la lista en `rechazadas` y en app.\*
    aparece «Rechazada» con «Reenviar a la DGII».
- **Sin certificado, o cualquier fallo antes de guardar el e-CF** (certificado ausente, vencido o con
  clave incorrecta, fallo de firma, emisor sin configurar): la venta sale como **factura simple** (sin
  e-NCF, sin ITBIS, sin envío), con la misma clave de idempotencia, turno, caja e inventario, y un
  recibo en formato de factura simple. El cajero no ve nada distinto; el admin ve el aviso «El
  certificado falló…» en app.\* (`GET /api/facturas/avisos`) y queda `POS_VENTA_FACTURA_SIMPLE` en la
  bitácora.
- **Secuencia agotada o vencida:** la venta toma el **número siguiente al último** de ese tipo y
  ambiente, se guarda y se imprime normal, pero **no se envía** (`PENDIENTE_ENVIO`,
  `envio_pendiente: true`, `sin_rango` en la meta). La envía el reenvío automático cuando un rango
  autorizado registrado incluya su número. Solo el tipo agotado se afecta: con E32 agotada, las E31
  siguen su curso.
- **Entregar es una sola función idempotente:** caja (si la factura aún no tiene movimiento),
  inventario (una sola vez) y auditoría `POS_VENTA`. Repetir la clave devuelve la misma venta
  (`repetida: true`, siempre `201`) y completa lo que falte, con la `forma_pago` y el
  `recibido_centavos` del reintento.
T, 1],
    [<<<'T'
recibo. Sin las rechazadas al emitir (no tienen cobro).
T, <<<'T'
recibo. Incluye las que la DGII rechazó (se entregaron) y las facturas simples (con el número de su
factura en `e_ncf`).
T],
    [<<<'T'
**`POST /api/pos/pendientes/reenviar`** (solo `X-POS-EQUIPO`) — revisa hasta 5 ventas con
T, <<<'T'
cron confirmado, Q4).
T, <<<'T'
**`POST /api/pos/pendientes/reenviar`** (solo `X-POS-EQUIPO`) — el reenvío automático: revisa hasta 5
ventas del POS con `envio_pendiente = 1`; nunca re-firma ni devuelve números.

- **Consulta primero** y reenvía solo lo que la DGII no tiene. El XML guardado decide el flujo: con
  `rfce_xml` (E32 < RD$250,000) es el RFCE (`ConsultaRFCE` por e-NCF + código de seguridad; si no lo
  encuentra, reenvía el RFCE firmado); si no, el e-CF completo (E31: con `trackId`,
  `ConsultaResultado`; sin él, `ConsultaTrackIds`: si la DGII ya lo tiene toma su `trackId`, si no
  reenvía el XML firmado; si la consulta no responde, espera a la próxima vuelta).
- **Salta** las `PENDIENTE_ENVIO` de menos de 2 minutos (la petición original todavía las envía) y
  las `sin_rango` hasta que un rango registrado incluya su número.
- **Escribe con compare-and-set** (`UPDATE ... WHERE id = :id AND estado_dgii = :leido`) y cambia
  `envio_pendiente` en la misma sentencia: nunca pisa un estado final escrito por otro proceso.
- Responde `{revisadas, aceptadas, rechazadas: [{factura_id, e_ncf, motivo}], pendientes}`. El POS lo
  llama al entrar, cada 2 minutos y tras cada venta, en silencio (no hay cron confirmado, Q4).
T, 1],
    [<<<'T'
`POS_PIN_FALLIDO`, `POS_EQUIPO_BLOQUEADO`, `POS_TURNO_ABIERTO`, `POS_VENTA`,
T, <<<'T'
`POS_TURNO_CERRADO`, `POS_AUTORIZACION` / `_FALLIDA`, `POS_VENTA_CANCELADA`, `POS_LINEA_QUITADA`,
T, <<<'T'
`POS_PIN_FALLIDO`, `POS_EQUIPO_BLOQUEADO`, `POS_TURNO_ABIERTO`, `POS_VENTA` (toda venta entregada:
aceptada, rechazada o sin respuesta), `POS_VENTA_FACTURA_SIMPLE` (con la clase del fallo, sin
secretos), `POS_VENTA_ENVIADA` y `POS_VENTA_RECHAZADA` (el reenvío la confirmó, o la DGII la rechazó
después), `POS_TURNO_CERRADO`, `POS_AUTORIZACION` / `_FALLIDA`, `POS_VENTA_CANCELADA`, `POS_LINEA_QUITADA`,
T, 1],
    [<<<'T'
`tools/test_pos_venta.php`: 48 verificaciones del cobro (turno, validaciones sin gastar
T, <<<'T'
`DGII_ECF_BASE_URL` / `DGII_FC_BASE_URL` no son locales.
T, <<<'T'
`tools/test_pos_venta.php`: 49 verificaciones del cobro (turno, validaciones sin gastar
e-NCF, venta en efectivo, idempotencia y candado, rechazo entregado igual, DGII lenta y caída con
su reenvío, recibo, bitácora). `tools/test_pos_cierre.php`: 50 verificaciones del cierre
(esperado y diferencia, permiso de supervisor, PIN de cajero, conteo inválido, nota, ventas
del turno y del día, eventos V4, candado, lista de app.\*). `tools/test_pos_e31.php`: 36
verificaciones del crédito fiscal (cliente nuevo, existente, no inscrito y consulta caída;
validaciones; E31 aceptado por `ConsultaResultado`; descuento del cliente; rechazo al
recibir y después; DGII lenta y caída sin duplicar el envío; necesita además
`RNC_CONSULTA_URL` local). Las tres emiten de verdad, así que corren contra la DGII simulada
`tools/mock_dgii_local.php` con un certificado autofirmado y se niegan a correr si
`DGII_ECF_BASE_URL` / `DGII_FC_BASE_URL` no son locales.

`tools/test_pos_write_ahead.php`: 30 verificaciones de la venta sobre el write-ahead (la misma clave
con la primera esperando a la DGII, el corte entre guardar y la caja, el reenvío que no toca una venta
en curso, el certificado que falla y se recupera, la secuencia agotada y su salida al registrar un
rango, «Reenviar a la DGII» y el cierre con facturas simples); necesita dos instancias de la API.

Las cinco suites corren sobre las bases scratch con `php -d extension=curl -d extension=openssl -d
extension=pdo_mysql tools/test_pos_scratch.php` (prepara el master multi-tenant, levanta la DGII
simulada y las APIs, las corre en serie y no imprime secretos; `--api-root` prueba otra raíz, por
ejemplo un `git archive` de `origin/master`). Todas se niegan a correr contra una base que no sea
`*wa_scratch` / `*wa_scratch_sin_gate` marcada, salvo un MySQL local (`tools/pos_scratch_guard.php`).
T, 1],
]);

// ---------------------------------------------------------------------------------------------
aplicar($raiz . '/docs/specs/pos.md', [
    [<<<'T'
Sin respuesta al enviar → `ENVIO_PENDIENTE` con el XML firmado guardado; el reenvío pregunta primero
T, <<<'T'
Sin respuesta al enviar → `ENVIO_INCIERTO` (la fila ya estaba guardada con el XML firmado); el reenvío pregunta primero
T],
    [<<<'T'
- [x] Respuesta **aceptada** → recibo.
T, <<<'T'
se imprime el recibo y el envío se reintenta solo (F7).
T, <<<'T'
- [x] La factura se **guarda antes** de enviarla (write-ahead): la DGII nunca decide si hay venta (spec `2026-10-12-pos-y-reenvio-sobre-write-ahead-design.md`, U3 y U8).
- [x] Respuesta **aceptada**, **rechazada**, de error o **sin respuesta en 5 s** → la venta se entrega igual: caja, inventario y recibo, como una factura normal. Lo no confirmado queda como *envío pendiente* (`ENVIO_INCIERTO`) y el reenvío automático lo resuelve (F7). El cajero no ve nada de la DGII.
- [x] Un **rechazo** no devuelve el número al contador (ya está impreso): el cierre la lista como rechazada y en app.\* aparece «Rechazada» con «Reenviar a la DGII».
- [x] **Sin certificado** (o cualquier fallo antes de guardar el e-CF) → la venta sale como **factura simple**, con su clave, turno, caja e inventario, y el admin ve un aviso en app.\* (decisión 38).
- [x] **Secuencia agotada o vencida** → número siguiente al último: se guarda y se imprime, y **no se envía** hasta que un rango autorizado registrado lo incluya (decisión 39).
T, 1],
    [<<<'T'
- [x] Un proceso reenvía las ventas con *envío pendiente* hasta tener respuesta
T, <<<'T'
en app.\* falta.*
T, <<<'T'
- [x] Un proceso reenvía las ventas con *envío pendiente* hasta tener respuesta: cron de cPanel, o el propio POS cuando está libre si no hay cron (Q4). *Hoy lo dispara el POS: al abrir, cada 2 minutos y tras cada venta.*
- [x] Consulta primero, reenvía el XML guardado (nunca re-firma) y no devuelve números. Salta las `PENDIENTE_ENVIO` de menos de 2 minutos y las `sin_rango` hasta que un rango autorizado las cubra; escribe con compare-and-set.
- [ ] Si después llega un **rechazo**, se muestra una alerta persistente en el POS (al supervisor) y en app.\*, con la venta y el motivo. *En el POS ya sale (franja roja hasta "Entendido"); en app.\* sale «Rechazada» con «Reenviar a la DGII» en el detalle de la factura.*
T, 1],
    [<<<'T'
| 17 | DGII lenta | Esperar ~5 s; después imprimir y reintentar solo |
T, <<<'T'
| 17 | DGII lenta | Esperar ~5 s; después imprimir y reintentar solo. Desde 2026-10-12 la venta se guarda antes de enviar y se entrega pase lo que pase con la DGII (decisiones 38 y 39) |
T],
    [<<<'T'
| 37 | Piloto | Gratex, térmica de 80 mm, menos de 500 productos, 4 semanas |
T, <<<'T'
| 37 | Piloto | Gratex, térmica de 80 mm, menos de 500 productos, 4 semanas |
| 38 | La venta no se detiene | Si falla el certificado, o cualquier cosa impide generar el e-CF, la venta sale como factura simple: sin e-NCF, sin ITBIS y sin envío a la DGII. El cajero no ve nada; el admin ve un aviso en app.\* (2026-10-12) |
| 39 | Secuencia agotada | Número siguiente al último: se guarda y se imprime, y no se envía hasta que un rango autorizado registrado lo incluya. La app avisa cuando quedan pocos números y cuando se agotan (2026-10-12) |
T],
    [<<<'T'
6. Llama a `ECFEmissionService::emitir` con un timeout de DGII de 5 s.
T, <<<'T'
y escribe la auditoría.
T, <<<'T'
6. Llama a `ECFEmissionService::emitir` con el gancho write-ahead (`reservar` / `confirmar` / `incierto`), un timeout de DGII de 5 s y las opciones del POS: `reclamar_secuencia = false` (el número impreso nunca vuelve al contador), `autenticar_despues_de_reservar = true` y `numerar_sin_rango = true`. La factura se guarda **antes** de enviarla, con `pos_idempotency_key`, `turno_id`, `pos_empleado_id`, `indicador_monto_gravado = 1` y `envio_pendiente = 1`; una reserva con la misma clave es una venta repetida.
7. **Entrega** (`PosVenta::entregarVenta`, idempotente bajo el candado de la clave): el movimiento de caja si la factura aún no tiene uno, la salida de inventario una sola vez y la auditoría `POS_VENTA`, tras cualquier resultado guardado (aceptada, rechazada o sin respuesta). Si el e-CF no se pudo generar antes de guardar, la misma entrega sobre una factura simple.
T, 1],
    [<<<'T'
- Si no: el POS llama a `/api/pos/pendientes/reenviar` cada 2 min mientras está abierto y sin venta en curso.
T, <<<'T'
- Si no: el POS llama a `/api/pos/pendientes/reenviar` al abrir, cada 2 min mientras está abierto y tras cada venta (es lo que hay hoy).
T],
    [<<<'T'
- Usa `consultarEstadoRFCE` / `consultarEstado`, que ya existen, antes de reenviar, para no duplicar un envío que sí llegó.
T, <<<'T'
- Usa `consultarEstadoRFCE` / `consultarEstado` / `consultarTrackIds`, que ya existen, antes de reenviar, para no duplicar un envío que sí llegó, y reenvía el XML ya firmado: el RFCE si hay `rfce_xml`, el e-CF completo si no.
- Elige las ventas del POS con `envio_pendiente = 1`, salta las `PENDIENTE_ENVIO` de menos de 2 minutos y las `sin_rango` sin un rango que las cubra, y escribe con compare-and-set (detalle en `docs/integrations/pos-write-ahead.md` del API).
T],
    // Bitacora de avance (§12): el vocabulario que ya no existe.
    [<<<'T'
e-CF, factura + movimiento de caja en una transacción (`saveFacturaConECF` con gancho;
las columnas POS solo se escriben en ventas POS, app.\* intacto), venta a nombre del admin
T, <<<'T'
e-CF, factura reservada antes de enviarla (`reservarFacturaECF` con el gancho write-ahead;
las columnas POS solo se escriben en ventas POS, app.\* intacto) y caja entregada de forma
idempotente, venta a nombre del admin
T],
    [<<<'T'
`POS_DGII_TIMEOUT` → `RFCE_PENDIENTE` impreso y reenviado por
T, <<<'T'
`POS_DGII_TIMEOUT` → `ENVIO_INCIERTO` impreso y reenviado por
T],
    [<<<'T'
emisión completa ahora tolera la DGII lenta como el RFCE (`ENVIO_PENDIENTE` con el XML
firmado) y el reenvío distingue
T, <<<'T'
emisión completa también tolera la DGII lenta (`ENVIO_INCIERTO`, con el XML ya
firmado y guardado) y el reenvío distingue
T],
]);

// ---------------------------------------------------------------------------------------------
aplicar($raiz . '/docs/integrations/dgii-ecf.md', [
    [<<<'T'
La app nunca la reenvía: la resuelve soporte.
T, <<<'T'
La app **nunca reenvía una factura sin confirmar**: la resuelve soporte. (Una **rechazada** sí se
reemite desde la app: ver «Reenviar a la DGII una factura rechazada».)
T],
    [<<<'T'
## Bugs críticos resueltos en certificación
T, <<<'T'
### Reenviar a la DGII una factura rechazada

Decisión 7 de Release 1, redefinida el 2026-10-12: la app **nunca** reenvía una factura *sin confirmar*
(`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO` sin veredicto, `EN_PROCESO`): eso lo resuelve soporte
(procedimiento de arriba) y, en las ventas del POS, el reenvío automático
(`docs/integrations/pos-write-ahead.md`). Una **rechazada** sí se reemite con **«Reenviar a la DGII»**
(`POST /api/facturas/{id}/reenviar`): se pidió porque una factura se rechazó por una fecha mal escrita.

- **Cuándo:** solo e-CF en `RECHAZADO`, `RFCE_RECHAZADO` o `NO_ENCONTRADO`, no archivados, con
  `secuencia_utilizada` distinto de `1`, del mismo ambiente que el activo y con líneas guardadas. Un
  candado por factura (`tomarLockReenvio`) corta el doble clic.
- **Cómo:** sale por la misma emisión write-ahead de la app (guardar, enviar, anotar) con `e_ncf` = el
  de la rechazada: el mismo número. La reserva archiva la rechazada (regla de los estados
  reintentables, `..._ARCHIVADO`); `archivarRechazoReenviado` queda como respaldo.
- **Inventario:** la nueva se descuenta según las reglas de Release 1 y `devolverSaldoDeFactura`
  devuelve lo que la vieja haya movido (una venta del POS rechazada sí lo había descontado).
- **Sobre una factura sin confirmar responde `409`:** si la DGII ya la tiene, reenviar duplicaría el
  comprobante.
- **QR de una reemisión del POS:** el papel original tiene el código de seguridad de la primera firma y
  no validará en la DGII; si el cliente necesita el comprobante válido, se reimprime desde la app.

---

## Bugs críticos resueltos en certificación
T],
]);

// ---------------------------------------------------------------------------------------------
aplicar($raiz . '/docs/api/facturas.md', [
    [<<<'T'
- No hay campo ni endpoint de reenvío: la app nunca reenvía un e-CF y
T, <<<'T'
factura sin confirmar").
T, <<<'T'
- Ninguna respuesta trae un campo que diga si se puede reenviar: el front decide por `estado_dgii`.
  La app **nunca reenvía una factura sin confirmar**: `POST /api/facturas/{id}/reenviar` responde
  `409` sobre `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO`, `RFCE_ENVIADO` y
  `RFCE_EN_PROCESO`; solo una **rechazada** se reemite (sección «Reenviar a la DGII»). Soporte
  resuelve la fila ([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md), "Resolver una
  factura sin confirmar").
T, 1],
    [<<<'T'
- La app no reenvía un e-CF: `POST /api/facturas/{id}/reenviar` responde `501`. Las
T, <<<'T'
([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md)).
T, <<<'T'
- La app no reenvía una factura sin confirmar: `POST /api/facturas/{id}/reenviar` responde
  `409`. Las facturas sin confirmar las resuelve soporte
  ([../integrations/dgii-ecf.md](../integrations/dgii-ecf.md)).
T, 1],
    [<<<'T'
### Facturas que una nota puede modificar — `GET /api/facturas/modificables`
T, <<<'T'
### Avisos del e-CF — `GET /api/facturas/avisos`

Lo que el admin ve en el panel de e-CF de app.\* (nunca en la caja del POS), autenticado como el resto
de `/api/facturas`.

```json
{ "status": true, "data": {
    "certificado_fallo": { "ventas_hoy": 3 },
    "secuencias": [ { "tipo": "E32", "ambiente": "certecf", "restantes": 12, "estado": "pocos" } ],
    "sin_rango": { "ventas": 2 } } }
```

- `certificado_fallo.ventas_hoy`: ventas del POS que **hoy** salieron como factura simple porque no se
  pudo generar el e-CF («El certificado falló: N ventas del POS salieron como factura simple»).
- `secuencias[]`: un renglón por tipo con **50 o menos** números libres en el rango vigente
  (`estado: "pocos"`) o sin ninguno (`"agotada"`). `restantes` es un entero, o `null` sin límite.
- `sin_rango.ventas`: ventas del POS con un número fuera de rango que siguen sin enviarse; salen solas
  al registrar un rango autorizado que las incluya.

### Reenviar a la DGII — `POST /api/facturas/{id}/reenviar`

Reemite una factura **rechazada** con el mismo e-NCF y los datos de la rechazada (por ejemplo, tras
corregir un dato del cliente). Sin cuerpo. Sale por la misma emisión write-ahead que
`POST /api/facturas` y responde igual: `200` con `data`, `422` si la DGII la rechaza otra vez, `502`
con `data.factura_id` si queda sin confirmar. Otros códigos: `404` (no existe); `409` (ya se está
reenviando, ya se reenvió, no está rechazada, **incluida toda factura sin confirmar**, la DGII consumió
el e-NCF o se envió en otro ambiente); `422` (no es electrónica o no tiene líneas). La rechazada queda
archivada (`..._ARCHIVADO`), su inventario se devuelve y el número no vuelve al contador.

### Facturas que una nota puede modificar — `GET /api/facturas/modificables`
T],
]);
echo "listo\n";
````

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
php "$S/aplicar_docs.php" "$A"
```

Expected: `pos.md: 8 cambios`, `pos.md: 11 cambios`, `dgii-ecf.md: 2 cambios`, `facturas.md: 3 cambios`, `listo`. If a marker fails the script says which and writes nothing: the doc differs from what this task was written against, so adjust that one marker.

- [ ] **Step 3: Replace `docs/integrations/pos-write-ahead.md` with the as-built description**

Write the whole file with the Write tool (re-read the old one first):

````markdown
# La venta del POS sobre el write-ahead del e-CF

Cómo quedó construido `POST /api/pos/ventas` sobre el write-ahead (rama `feat/ecf-write-ahead`).
La intención está en la spec `docs/superpowers/specs/2026-10-12-pos-y-reenvio-sobre-write-ahead-design.md`
(repo del front `fiscalo`); el comportamiento, en el código y en las pruebas de la sección 9.

Dos garantías:

- **Toda factura se guarda antes de enviarse a la DGII.** Ningún camino guarda después de enviar
  (así se perdió la E34 del 2026-10-05).
- **Una venta del POS no se detiene por la DGII, el certificado ni la secuencia.** Solo la frenan las
  validaciones del carrito (los `4xx` de `docs/api/pos.md`) y que el servidor o la base no estén
  disponibles, porque entonces no hay dónde guardarla.

## 1. La venta (`PosVenta::cobrar`)

1. **Validaciones, clave e idempotencia** (sin cambios): candado de la clave, búsqueda por
   `pos_idempotency_key`, candado del turno, líneas armadas en el servidor y total comparado.
2. **Emisión con el gancho** `reservar` / `confirmar` / `incierto`, igual que `handleEmisionECF`.
   `reservarFacturaECF` guarda la fila en `PENDIENTE_ENVIO` **antes** de llamar a la DGII y, si la
   factura trae `pos`, escribe en el mismo `INSERT` `pos_idempotency_key`, `turno_id`,
   `pos_empleado_id` y `envio_pendiente = 1`. Un `1062` sobre `uk_facturas_pos_idem` es una venta
   repetida (`EcfVentaRepetidaException`): se relee por clave. Un `1062` sobre el e-NCF sigue siendo
   `EcfNumeroOcupadoException`.
3. **Cualquier resultado después de guardar se entrega** (`201` con el recibo): aceptada, rechazada,
   `ERROR`, `NO_ENCONTRADO`, en proceso o sin respuesta (`EcfEnvioInciertoException`).
4. **Fallo antes de guardar:** factura simple (sección 4). **Sin rango libre:** número siguiente
   sin enviar (sección 5).

Opciones del payload solo para el POS (la app y las integraciones conservan el valor de siempre):

| Opción | En el POS | Efecto |
|---|---|---|
| `dgii_timeout` | `POS_DGII_TIMEOUT` (5 s) | Espera máxima al enviar |
| `formas_pago` | la elegida | `TablaFormasPago` del RFCE y del e-CF |
| `reclamar_secuencia` | `false` | El número de una venta del POS nunca vuelve al contador: ya está impreso |
| `autenticar_despues_de_reservar` | `true` | El token se pide después de guardar; si la DGII no responde, la venta queda `ENVIO_INCIERTO` (fase `autenticar`) |
| `numerar_sin_rango` | `true` | Sin rango libre se usa el número siguiente al último (sección 5) |

## 2. `envio_pendiente`

Se escribe en la **misma sentencia** que `estado_dgii` y solo en filas del POS, con
`EstadosEcf::envioPendiente`: `1` en la reserva, `1` en `confirmar` si el veredicto sigue abierto
(`ENVIADO`, `EN_PROCESO`, `RFCE_ENVIADO`, `RFCE_EN_PROCESO`), `0` en cualquier otro estado y `1` en
`incierto`. El POS ya no tiene estados «pendientes» propios: un envío sin respuesta es
`ENVIO_INCIERTO` y una venta sin enviar es `PENDIENTE_ENVIO`, como en la app.

## 3. Entrega (`PosVenta::entregarVenta`)

Una sola función idempotente, bajo el candado de la clave, tras cualquier resultado guardado y en
una venta repetida que encuentre algo sin hacer: el movimiento de caja (si `posModel` no tiene uno
para la factura), el inventario una sola vez (`yaMovioDocumento('factura', id)` y `registrarVenta`) y
la auditoría `POS_VENTA`. Repetir la clave devuelve la misma venta (`repetida: true`, siempre `201`,
también si la DGII la rechazó) y completa lo que falte con la `forma_pago` y el `recibido_centavos` del
reintento: por ejemplo, si el servidor cayó entre guardar la respuesta y registrar la caja. El recibo
usa `RepresentacionImpresa::datosRecibo`, que no lee `estado_dgii`.

Una venta rechazada, al cobrar o más tarde, conserva su caja y su inventario, no devuelve el número,
el cierre la lista como rechazada y en app.\* aparece «Rechazada» con «Reenviar a la DGII».

## 4. Fallo antes de guardar: factura simple

Si el e-CF no se puede generar (certificado ausente, vencido o con clave incorrecta, fallo de firma,
`emisor_config` incompleto, número ocupado tras un reintento o cualquier excepción antes de la reserva,
que ya devuelve el número al contador), la venta se guarda como **factura simple** (`tipo_ecf` nulo, sin
e-NCF, sin ITBIS, sin envío) con las mismas líneas, el mismo total y las columnas del POS: la
idempotencia no cambia.

- La entrega es la misma (sección 3) y la respuesta es `201` con el recibo de factura simple (título
  «Factura», sin timbre). Queda `POS_VENTA_FACTURA_SIMPLE` en la bitácora, con la clase del fallo y sin
  secretos: de ahí sale el aviso al admin (sección 8).
- El cierre y las listas identifican la venta con el número de su factura (`no_factura`), y el reporte
  la cuenta como `Simple`.
- Las validaciones del carrito siguen respondiendo `4xx`: son errores de captura, no de emisión.

La factura simple no es un comprobante fiscal: no lleva ITBIS ni entra en el 607. Falta confirmar con
el contador cómo regularizar las que salgan así.

## 5. Secuencia agotada o vencida: `sin_rango`

Solo en el POS, cuando `ncfModel::dispenseNextECF` devuelve `null`:

- `ncfModel::dispenseSinRango` toma el **número siguiente al último usado** y avanza el contador del
  rango con el `numero_desde` más alto **sin** el tope de `numero_hasta`.
- La venta se firma, se guarda y se imprime normal, marcada `sin_rango` en la meta de la fila
  (`respuesta_dgii`), y **no se envía**: la DGII rechaza los números fuera de un rango autorizado.
  Queda `PENDIENTE_ENVIO` con `envio_pendiente = 1`.
- Solo el tipo agotado se ve afectado: con E32 agotada, las E31 siguen su curso.
- **E32:** el XML no lleva fecha de vencimiento de la secuencia, así que queda listo para enviarse.
  **E31:** lleva la fecha del último rango conocido; si la DGII la rechaza, se reemite con «Reenviar a
  la DGII» (sección 7).
- La envía el reenvío automático cuando `ncfModel::rangoCubre(tipo, ambiente, número)` es cierto: hay
  un rango registrado con `numero_desde <= número <= numero_hasta` (o sin `numero_hasta`) y no vencido.
  Si la DGII autoriza un rango que **no** incluye esos números, esas ventas no salen solas: quedan en el
  aviso de la sección 8 para soporte.
- La emisión normal salta los números que ya usa una fila (`eNcfYaUsado`): un rango registrado después
  nunca reparte dos veces un número ya usado.

## 6. Reenvío automático (`PosVenta::reenviarPendientes`)

`POST /api/pos/pendientes/reenviar` (solo `X-POS-EQUIPO`), disparado por la pantalla del POS al abrir,
cada 2 minutos y tras cada venta, en silencio. Consulta primero, reenvía el XML guardado, no re-firma y
no devuelve números.

- **Flujo por XML guardado:** RFCE si `rfce_xml` no es nulo; e-CF completo si no.
- **Selección:** filas del POS con `envio_pendiente = 1`, salvo las `PENDIENTE_ENVIO` de menos de 2
  minutos (la petición original todavía las está enviando) y las `sin_rango` mientras `rangoCubre` sea falso.
- **Escrituras con compare-and-set** (`UPDATE ... WHERE id = :id AND estado_dgii = :leido`), con
  `envio_pendiente` en la misma sentencia: nunca pisa un estado final escrito por otro proceso.
- **Respuesta:** `{revisadas, aceptadas, rechazadas, pendientes}`. Bitácora: `POS_VENTA_ENVIADA` y
  `POS_VENTA_RECHAZADA`.
- En `certecf` no existe `ConsultaTrackIds`: una E31 sin `trackId` queda pendiente para soporte. Las RFCE sí
  se consultan.

## 7. «Reenviar a la DGII» (rechazadas)

`POST /api/facturas/{id}/reenviar` (`handleReenviar`): solo e-CF en `RECHAZADO`, `RFCE_RECHAZADO` o
`NO_ENCONTRADO`, no archivado, con `secuencia_utilizada` distinto de `1`, del mismo ambiente, con líneas
y un candado por factura (`tomarLockReenvio`). Reemite por `emitirFacturaEcf` con `$input['e_ncf']` = el
e-NCF de la rechazada y `$reenvioDe` = su id: la reserva archiva la rechazada, `archivarRechazoReenviado`
queda de respaldo y `devolverSaldoDeFactura` devuelve el inventario que la vieja haya movido.

Una factura sin confirmar (`PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO`, `EN_PROCESO`) responde `409`:
la app nunca la reenvía. En una venta del POS reemitida con el mismo número, el QR del papel original
tiene el código de seguridad de la primera firma y no validará en la DGII; si el cliente necesita el
comprobante válido, se reimprime desde la app.

## 8. Avisos al admin (solo en la app, nunca en la caja)

`GET /api/facturas/avisos` (ver `docs/api/facturas.md`) alimenta el panel e-CF de app.\*: **«El certificado
falló: N ventas del POS salieron como factura simple»** (las de hoy), **«Quedan pocos números»** (50 o menos
en el rango vigente) o **«Secuencia agotada»**, y **«N ventas esperando un rango autorizado»**.

## 9. Pruebas

`tools/test_pos_scratch.php` prepara el master multi-tenant de las bases scratch, levanta la DGII
simulada y dos instancias de la API y corre en serie `test_pos_backend.php`, `test_pos_venta.php`,
`test_pos_cierre.php`, `test_pos_e31.php` y `test_pos_write_ahead.php` (RF1 a RF5, factura simple, sin rango,
«Reenviar a la DGII» y el cierre). `tools/pos_scratch_guard.php` las niega contra cualquier base que no sea
`*wa_scratch` / `*wa_scratch_sin_gate` marcada, salvo un MySQL local. Las de Release 1 siguen en
`tools/test_write_ahead_*.php`.

Referencias: la spec de esta entrega y la del write-ahead (`2026-10-05-ecf-write-ahead-design.md`), en
`fiscalo`; `docs/integrations/dgii-ecf.md` (procedimiento 10.2 y «Reenviar a la DGII una factura
rechazada»); `docs/api/pos.md`; `docs/specs/pos.md`; `EstadosEcf.php`.
````

- [ ] **Step 4: Check every claim of the docs against the code**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git grep -n "POS_VENTA_FACTURA_SIMPLE" -- src
git grep -n -E "reclamar_secuencia|autenticar_despues_de_reservar|numerar_sin_rango" -- src/Pos
git grep -n -E "function (entregarVenta|rangoCubre|dispenseSinRango|tomarLockReenvio|archivarRechazoReenviado|devolverSaldoDeFactura|envioPendiente|reenviarPendientes)" -- src
grep -c -E "DGII_RECHAZO|EMISION_FALLIDA|GUARDADO_FALLIDO" src/Pos/PosVenta.php
git grep -n -E "POS_VENTA_FALLIDA|POS_VENTA_SIN_GUARDAR" -- src docs
git grep -n "avisos" -- src config
```

Expected: (1) `src/Pos/PosVenta.php` (Task 6); (2) the three option names in `src/Pos/PosVenta.php` (Tasks 5 and 7); (3) eight definitions, one each; (4) `0`: the sale no longer answers those three codes (if it prints more, remove the leftover branch in `PosVenta`, or put its row back in `docs/api/pos.md` and drop the code from that sentence); (5) nothing: the two old audit actions are gone from code and docs (if the code still emits one, add it to the bitácora paragraph of `docs/api/pos.md`); (6) the `avisos` route (Task 10).

- [ ] **Step 5: `CLAUDE.md` states nothing false**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git grep -n -i -E "501|reenv|saveFacturaConECF|RFCE_PENDIENTE|ENVIO_PENDIENTE|tolerar_fallo" -- CLAUDE.md
git diff --quiet -- CLAUDE.md && echo "CLAUDE.md sin cambios"
```

Expected: nothing, then `CLAUDE.md sin cambios` (YAGNI: its 027/028 gate text is still true). If the first command prints a line that is now false, fix exactly that line.

- [ ] **Step 6: Run the puro test green and commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
php tools/test_write_ahead_puro.php | tail -20; echo "exit=${PIPESTATUS[0]}"
git status --short
git add docs/api/pos.md docs/specs/pos.md docs/integrations/dgii-ecf.md docs/api/facturas.md docs/integrations/pos-write-ahead.md tools/test_write_ahead_puro.php
git commit -m "docs(pos): la venta del POS y Reenviar a la DGII sobre el write-ahead

La venta se guarda antes de enviar y se entrega pase lo que pase con la DGII:
factura simple si falla el certificado, numero siguiente sin enviar si se agota
la secuencia. La app nunca reenvia una factura sin confirmar y si reemite una
rechazada; GET /api/facturas/avisos y los pines de texto en el puro.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the 13 checks of section 14 are `[OK  ]`, the last line is `N de N pruebas OK` (equal numbers) and the exit code is 0. This is the first run in which the whole Release 1 puro file is green after the merge (the `saveFacturaConECF` check passes now). If section 12's old guards (`POST /reenviar sigue respondiendo 501`, `puede_reenviar`) are still red, Task 9 did not rewrite them: fix them there, not here. The status lists the four edited docs, the replaced `pos-write-ahead.md` and the puro file, plus the usual untracked file.

---

### Task 16: Verificación final

**Files:**
- No file is created or modified in either repo. A failure found here is fixed in the task that owns it, as its own commit in the repo it touches, and this task runs again from its first failing step.
- Test: every command below.

**Interfaces:**
- Consumes everything from Tasks 1-15 in both repos (the scratch bases and the runner come from Tasks 1 and 13).
- Produces a verification report: every command with its exit code and its `N de N pruebas OK` / `OK (N verificaciones)` / `N/N OK` line, the integration check, and the confirmation that nothing was pushed, deployed or run against production.

Production is never touched: the scratch bases and `127.0.0.1` are the only places anything runs. The front's `.env` proxies to production, so `vite` and `npm run dev` are never started.

- [ ] **Step 1: Did `origin` move? (merge again if it did)**

```bash
A=C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
F=C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git -C "$A" fetch origin master && git -C "$A" rev-parse --short origin/master
git -C "$A" merge-base --is-ancestor origin/master HEAD && echo "API: master ya esta integrada" || echo "API: master se movio"
git -C "$F" fetch origin main && git -C "$F" rev-parse --short origin/main
git -C "$F" merge-base --is-ancestor origin/main HEAD && echo "FE: main ya esta integrada" || echo "FE: main se movio"
```

Expected: both `... ya esta integrada` (the SHAs merged by Tasks 1 and 2: `c594c10` and `332996e` on 2026-10-12, unless the other developer pushed since). If one says `se movio`: (1) repeat Task 1 (API) or Task 2 (FE) with the plan's resolution rules; (2) apply every migration newer than `034` that came with it (`git diff --name-only <merge-base> origin/master -- db/migrations db/master_migrations`) to `smhynzte_wa_scratch` and `smhynzte_wa_scratch_sin_gate` through `wa_pdo`, never 027/028 to the copy; (3) re-read `src/Pos/*`, `src/Models/posModel.php` and `src/Controllers/posController.php` for changes in what Tasks 5-8 and 14 rewrote; then start this task again.

- [ ] **Step 2: API: tree, commits, syntax and PHP 8.3**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git branch --show-current; git status --short; git log --oneline -20
git branch -vv --list feat/ecf-write-ahead | cut -c1-140
git check-ignore -q tools/.env && echo "tools/.env ignorado" || echo "sin tools/.env: usar WA_DB_* en el entorno"
git ls-files --eol src/Models/facturaModel.php
BASE=$(git merge-base HEAD origin/master)
FILES=$(git diff --name-only --diff-filter=d "$BASE" HEAD -- '*.php')
fallos=0; for f in $FILES; do php -l "$f" >/dev/null || { echo "FALLO $f"; fallos=1; }; done; echo "php -l fallos=$fallos"
echo "hooks:";  grep -nE '\$[A-Za-z_][A-Za-z0-9_]*\s*\{\s*(get|set)\b' $FILES
echo "hooks (varias lineas):"; grep -lPz '\$\w+\s*\{\s*(&\s*)?(get|set)\b' $FILES
echo "asym:";   grep -nE '\b(public|protected|private)\(set\)' $FILES
echo "new->:";  grep -nE '(^|[^(A-Za-z0-9_>])new\s+[^ (]+\s*\([^()]*\)\s*->' $FILES
echo "funcs:";  grep -nE '\b(array_find|array_find_key|array_any|array_all|array_first|array_last|mb_trim|mb_ltrim|mb_rtrim|mb_ucfirst|mb_lcfirst)\s*\(' $FILES
echo "attr:";   grep -nE '#\[.?(Deprecated|NoDiscard)\b' $FILES
echo "pipe:";   grep -nF '|>' $FILES
echo "fin"
```

Expected: `feat/ecf-write-ahead`; the status shows only `?? tools/reconstruir_e340000000001.sql`; the log's newest commits are Tasks 15, 14 (two) and 13 and the earlier tasks (a missing commit means its task is not done: stop); the `branch -vv` line shows no `origin/feat/ecf-write-ahead` tracking (nothing was pushed from this session; if it shows one, the user pushed earlier: say so in the report); one `.env` line; `facturaModel.php` reports `i/lf    w/lf`; `php -l fallos=0`; no matches under the seven scan labels and the output ends with `fin` (production runs PHP 8.3; `php -l` on 8.5 cannot catch 8.4 or 8.5 syntax). The patterns were checked: they catch `new Foo()->bar()`, `public private(set) int $z`, `public string $x { get => 1; }` (also over several lines), `array_find`/`array_first`, `#[\Deprecated]` and `|>`, they skip `(new Foo())->bar()` (valid in 8.3), and they gave no false positive on the Release 1 diff. They avoid a double backslash on purpose: this harness's shell collapses `\\`.

- [ ] **Step 3: API: the DB-free scripts**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
for t in tools/test_write_ahead_puro.php tools/test_pos_scratch_puro.php tools/check_estado_dgii_ancho.php tools/test_consultar_ecf_dgii.php tools/test_notas_vinculadas.php tools/test_ecf_montos_descuento.php tools/test_precios_itbis_incluido.php tools/test_conduces.php; do out=$(php "$t" 2>&1); code=$?; echo "$t exit=$code :: $(printf '%s\n' "$out" | tail -1)"; done
```

Expected: each `exit=0` with a last line whose two numbers are equal (`N de N pruebas OK`, `N/N OK` or `TODO OK (N verificaciones)`). On the Release 1 branch before the merge they printed `182 de 182` (puro; it grows with sections 14 and the later tasks), `32/32`, `73/73`, `62 de 62`, `33 de 33`, `TODO OK (45 verificaciones)` and `413/413`; `test_pos_scratch_puro.php` ends with `18 de 18 pruebas OK`. (`tools/test_facturas_simples.php` needs a database: it is not in this list.)

- [ ] **Step 4: API: the Release 1 suites and the POS suites on the scratch bases (serially)**

Never two at once: they share the scratch databases. Put `WA_PUERTO_OFFSET=100` in front of `php` if another application holds port 8099.

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/6c2872aa-8b17-4946-b269-f8e811ce52b9/scratchpad   # your session scratchpad
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
php $F tools/test_pos_scratch.php | tee "$S/pos_scratch_salida.txt"; echo "exit=${PIPESTATUS[0]}"
php $F tools/test_pos_scratch.php --suites=test_pos_backend --enforce | grep -E '^(==|suites)'
grep -c -E "@|WA_DB|password" "$S/pos_scratch_salida.txt"
php $F tools/test_write_ahead_gate.php --tenant-db=wa_scratch --copia-db=wa_scratch_sin_gate | tail -1
```

Expected: the six Release 1 lines each `exit=0 :: N de N pruebas OK` (equal numbers); then the runner's `OK (100 verificaciones)`, `OK (49 ...)`, `OK (50 ...)`, `OK (36 ...)`, `OK (30 ...)`, `suites OK: 5 de 5` and `exit=0`; the `--enforce` run prints `== test_pos_backend: OK (100 verificaciones)` and `suites OK: 1 de 1`; `grep -c` prints `0` (no `user@host`, no credential variable name, no password on screen; delete `$S/pos_scratch_salida.txt` afterwards); and the last gate run ends with `N de N pruebas OK`: the POS preparation left the copy still without 027/028. The step takes several minutes; if it does not fit the 10-minute limit, run it in pieces.

- [ ] **Step 5: API: leftovers and the decisions that must hold**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex/.claude/worktrees/ecf-write-ahead
git grep -n -E "saveFacturaConECF|tolerar_fallo_envio|RFCE_PENDIENTE|ENVIO_PENDIENTE|puede_reenviar" -- src docs CLAUDE.md
git grep -n -E "DGII_RECHAZO|EMISION_FALLIDA|GUARDADO_FALLIDO" -- src/Pos
git grep -n -E "gratex\.net|fiscalpoint\.com\.do" -- tools/pos_scratch_guard.php tools/pos_scratch_prepare.php tools/test_pos_scratch.php tools/test_pos_write_ahead.php
git status --short
```

Expected: the first two print nothing (no pre-merge vocabulary and no `puede_reenviar`; the hits in `tools/` and `tests/` are absence checks and stay; the sale answers none of the three old codes); the third prints only the refusal in `tools/test_pos_write_ahead.php` (`POS_TEST_BASE apunta a produccion`); the status still shows only the usual untracked file.

- [ ] **Step 6: FE: tree, gates, scripts and the cashier's screen**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo/.claude/worktrees/ecf-write-ahead
git branch --show-current; git status --short; git log --oneline -20
git branch -vv --list feat/ecf-write-ahead | cut -c1-140
npm run -s typecheck; echo "tsc=$?"
npm run -s build 2>&1 | tail -3; echo "build=${PIPESTATUS[0]}"
npx eslint . --ignore-pattern ds-bundle; echo "eslint=$?"
for f in scripts/*.ts; do out=$(node "$f" 2>&1); code=$?; echo "$f exit=$code :: $(printf '%s\n' "$out" | tail -1)"; done
grep -rn "puede_reenviar" src scripts
grep -rnP "(?<![A-Z_])DGII(?![A-Z_])" src/pos --include=*.ts --include=*.tsx | grep -vP '^[^:]+:\d+:\s*(//|\*|/\*)'
grep -rn -i -E "sin confirmar|rechazad" src/pos --include=*.ts --include=*.tsx | grep -vP '^[^:]+:\d+:\s*(//|\*|/\*)'
```

Expected: `feat/ecf-write-ahead`; an empty status; the newest commits are the front tasks 2, 11 and 12 and the merge with `origin/main`; no `origin/feat/ecf-write-ahead` tracking on the `branch -vv` line (or say the user pushed it earlier); `tsc=0`, `build=0` (the chunk-size warning was already there) and `eslint=0` (`ds-bundle` already fails on `main` and is fixed apart); every script `exit=0` with equal numbers (`N/N OK`): the 11 of Release 1 (`check-errores`, `test-en-vuelo`, `test-notas-vinculadas`, ...), the three POS ones that arrive with `origin/main` (`test-pos-catalogo`, `test-pos-cierre`, `test-pos-ventas`) and whatever Task 12 added; the first `grep` prints nothing (the app's «Reenviar a la DGII» button decides by `estado`, not by an API field). The last two commands must show no string a cashier can read: a hit inside a string literal or JSX text (a toast, a label, a modal paragraph, the closing sheet in `reporteCierre.ts`, the state labels of `estados.ts`) is a defect of Task 11, fixed there. Hits on identifiers such as `rechazadas` in types and mappers are fine: read each one and confirm it is data, not copy. Four strings of `origin/main` need an explicit decision recorded in Task 11's report, because the skeleton says no cashier-facing string may mention the DGII: `ClienteRncModal.tsx` ("la DGII podría rechazar el crédito fiscal", about the buyer's RNC status), the red band in `VentaView.tsx` about a sale the DGII rejected later, the `reporteCierre.ts` headings «Pendientes de la DGII» / «Rechazadas por la DGII», and the labels of `estados.ts`. If any is left, name it in the report.

- [ ] **Step 7: Report**

Write the report in your reply (no file): (1) the two `origin` SHAs of Step 1 and `integradas`, or what was merged again; (2) one line per command of Steps 2 to 5 (the command, its exit code and its last line, copied from the terminal); (3) one line per command of Step 6; (4) not done on purpose: nothing was pushed, deployed, run against staging or run against production. Integration into `master`/`main`, the staging run and the rollout need the user's explicit yes, in that order; the API is deployed before the front, and migrations 027 to 034 must already be on every tenant database (027/028 are the release gate); (5) open items the spec keeps open, copied and not resolved: Q1 to the accountant (delivering the receipt before the DGII's verdict, due 2026-10-21), how to regularise the sales that came out as a factura simple, and the `registerRange` gap flagged in Task 14.

Task 16 ends the plan.


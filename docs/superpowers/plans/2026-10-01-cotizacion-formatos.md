# Per-tenant cotización formats (Ferretería) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Ferretería tenant a cotización that matches its Excel "COTIZACION MERCANCIAS". Its lines are linked to products, it converts into e-CF or factura simple, and the formato is chosen per tenant. Gratex's cotización does not change.

**Architecture:**
- **The setting.** A new `master.tenants.cotizacion_formato` setting picks a coded formato module on each side: `src/Utils/Cotizacion/*` in api-gratex and `src/features/cotizaciones/formatos/*` in fiscalo.
- **Gratex.** Its formato wraps today's code unchanged.
- **Ferretería.** Its formato adds:
  - server-computed totals with version-independent rounding;
  - a COT-000001 sequence;
  - product-linked lines;
  - an ajustes table;
  - a pure FPDF renderer;
  - a new form, a list and conversion paths.

**Tech Stack:**
- PHP 8.3 (prod; 8.5 local), no composer, FPDF, MySQL/MariaDB.
- React 18 + TypeScript + Vite, TanStack Query, Zod v4.
- Node v25 for the TS parity scripts.

**Spec:** `docs/superpowers/specs/2026-10-01-cotizacion-formatos-design.md`. Section 13 holds the implementation notes, which supersede earlier text.

## Global Constraints

- **Repos:**
  - FE = `C:/Users/Signos/Documents/edwin/fiscalo`.
  - BE = `C:/Users/Signos/Documents/edwin/api-gratex`.
  - Both on branch `feat/cotizacion-formatos`.
- **Gratex must not change.** Do NOT edit:
  - `src/Utils/CotizacionPdfGenerator.php`;
  - `src/features/cotizaciones/CotizacionFormView.tsx`;
  - the bodies of the legacy `saveCotizacion` / `updateCotizacion` / `sendCotizacionPdfEmail`.
- **No local MySQL.** DB behavior is verified by offline checks plus the manual server checks in Task 8's `.http` file.
- **Never hit production from a browser or script.** The fiscalo `.env` proxies `/api` to production, so every vite run sets `API_PROXY_TARGET` to the local mock and `API_KEY=''` (Task 16).
- **PHP style:**
  - Spanish comments that explain why;
  - friendly Spanish user messages, with technical detail sent to `error_log`;
  - PDO prepared statements;
  - FPDF core fonts only, with text converted through `mb_convert_encoding(..., 'ISO-8859-1', 'UTF-8')`.
- **Rounding:** `Redondeo::r` (PHP) and `montosLinea.redondear` (TS) must agree. Production is PHP 8.3; do not "fix" either to PHP 8.4+ semantics.
- **FE gates:** `npm run typecheck`, `npx eslint src scripts`, `npm run build`. (`npm run lint` already fails on the vendored `ds-bundle/`.)
- **BE gates:**
  - `php -l` on every touched file;
  - `php tools/test_cotizacion_ferreteria.php` (exit 0);
  - `php tools/check_tenant_schema_orden.php` once Task 2 exists.
- **Shared checkouts:** re-read every file right before editing it. Targeted edits only. Path-limited `git add`.
- **Commits:** Spanish conventional style (`feat(cotizaciones): …`). Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Execution order

The two repos form two chains that can run in parallel.

| Chain | Order | Notes |
|---|---|---|
| BE (api-gratex) | **T3** → T1 → T2 → T4 → T5 → T6 → T7 → **T7b** → T8 | T3 goes first because its Step 9 commits one doc row in fiscalo. Start the FE chain only after T3 has committed, so the FE tasks always see a clean fiscalo tree. |
| FE (fiscalo) | T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 | T10 copies the fixture JSON that T1 creates in BE, so T1 must be committed before T10. T16 checks that T3's fiscalo commit is in. |

The tasks below are grouped by the part that planned them (A–I). Each part starts with notes its tasks depend on. **Read your part's notes before your task.**

## Review Focus

These are the failure modes most likely to bite users that no automated test here fully exercises. Each line names the task that pins it.

1. **Numbering under real MySQL concurrency** (a busy `GET_LOCK`, the 1062 retry on `uk_cotizaciones_numero`, releasing the lock in `finally`). Only tested with a fake PDO. **Pinned in Task 8's `.http`:** run five parallel POSTs on the server and assert five distinct, consecutive `numero` values.
2. **Migration 026 on production-shaped DDL** (BIGINT or UNSIGNED ids, a `client_name` with its own comment or collation, columns already added by hand). Only text-linted in Task 2. **Pinned in Task 8's `.http` M-checks:** run 026 twice on schema-only dumps of both tenant DBs.
3. **Descriptions from API callers with line breaks or control characters.** **Pinned in Task 7b** (validation + PDF + page-count test). Non-Latin-1 characters print `?`, an accepted limit.
4. **PHP 8.3 in production versus 8.5 locally.** The harness has only run on 8.5. **Pinned:** run `php tools/test_cotizacion_ferreteria.php` under PHP 8.3 on the server (or with a local 8.3 binary) before go-live (Task 8 M-checks).
5. **Editing quotes with unusual stored data** (date NULL/zero, deleted client, deleted product, retención that rounds to 0.00). **Pinned in Task 16** (mock rows) and **Task 8** (`.http`). Accepted limits are in spec §13.

## Shared contract (interfaces, fixtures, resolved deviations)

Every task's interfaces come from this contract. Where a part's notes and the contract differ, the "Resolved deviations" section at the end wins.

### Shared contract for the plan "Per-tenant cotización formats"

Spec (source of truth): C:/Users/Signos/Documents/edwin/fiscalo/docs/superpowers/specs/2026-10-01-cotizacion-formatos-design.md
Repos: FE = C:/Users/Signos/Documents/edwin/fiscalo (branch feat/cotizacion-formatos), BE = C:/Users/Signos/Documents/edwin/api-gratex (branch feat/cotizacion-formatos).
No local MySQL exists; PHP 8.5 CLI is local (production PHP 8.3); Node v25 (strips TS types natively). No PHP or JS test framework in either repo:
backend tests = CLI scripts under tools/ with a tiny inline assert helper (see tools/test_tenant_mail.php for the house style: "[OK  ] ..." lines and "N/M OK" summary, exit code 1 on failure);
frontend tests = `npm run typecheck`, `npx eslint src`, `npm run build`, plus node scripts under scripts/.

#### Task list (owner group in brackets) — task numbers are FINAL, use them in cross-references

Backend (BE):
- T1 [A] Redondeo helper + CLI test harness `tools/test_cotizacion_ferreteria.php` + fixtures `tools/fixtures/cotizacion_ferreteria.json` + `tools/fixtures/ferreteria_logo.jpeg`.
- T2 [B] Tenant migration `db/migrations/026_cotizaciones_formatos.sql` + snapshot `db/tenant_schema.sql` (move "2) Cotizaciones" block below 2c products; end state) + `db/migrations/README.md` range + `docs/database/schema.md`.
- T3 [B] Master migration `db/master_migrations/011_add_tenant_cotizacion_formato.sql` + `db/master_schema.sql` + `brandingController` GET exposes `cotizacion_formato`.
- T4 [A] `FerreteriaFormato` pure static functions (totales, tasa, validarForma, errorAbono, codigo, formatearRnc, fechaLarga) TDD'd in the CLI script.
- T5 [C] `FerreteriaCotizacionPdf` pure renderer + CLI `--pdf [--grid]` rendering of fixtures (+60-line page-break fixture).
- T6 [D] `CotizacionFormato` (abstract), `CotizacionFormatos` (registry), `GratexFormato` (verbatim move of controller branches) + `cotizacionController.php` refactor (dispatch, PUT row-first, preview by id, 409 mismatch guard).
- T7 [E] `cotizacionModel` read paths (SELECT * items ORDER BY id, getAjustes isolated, ajustes object, ORDER BY c.date DESC, c.id DESC) + new methods (getCliente, getProductosInfo, crearConFormato, actualizarConFormato, siguienteNumero, lock helpers) + `FerreteriaFormato` instance methods crear/actualizar/preview/pdf.
- T8 [E] Backend docs: new `docs/api/cotizaciones.md`, new `docs/modules/cotizaciones-formatos.md`, `docs/README.md` map, `docs/integrations/alta-tenant-runbook.md`, new `tests/test_cotizaciones_ferreteria.http`.

Frontend (FE):
- T9  [F] API types + api functions + BrandingData.cotizacion_formato + move `indFactFromItbis` into montosLinea.ts (exported) + `FacturaPrefill` extension + `FacturaSimplePrefill` type + `isFacturaSimplePrefill` + NavPayload union.
- T10 [F] `src/features/cotizaciones/formatos/ferreteria/totales.ts` + `scripts/parity-cotizacion-ferreteria.ts` + `scripts/fixtures/cotizacion_ferreteria.json` (copy of BE fixture).
- T11 [G] Registry `formatos/index.ts` (FORMATOS, esFormato, useCotizacionFormato) + `formatos/CotizacionEditor.tsx` + `App.tsx` routing (`<CotizacionEditor key=...>`).
- T12 [G] `formatos/ferreteria/FerreteriaCotizacionForm.tsx` + `formatos/ferreteria/schema.ts` + `.fx-grid-cot-fer` CSS + `ProductoCombobox` `mostrarPrecio` prop.
- T13 [H] `formatos/ferreteria/conversion.ts` + `CotizacionesView.tsx` per-formato columns and row actions (Facturar ▾ gated by puedeVerVista).
- T14 [H] `InvoiceFormView.tsx` prefill changes (switch init expression, line fields, banner text, avisos, discount notice line).
- T15 [H] `SimpleInvoiceFormView.tsx` optional `prefill` prop + `App.tsx` passes it to 'factura-simple-nueva' + banner/avisos/discount notice.
- T16 [I] FE docs (`docs/plantillas-factura.md` note) + browser verification against a LOCAL mock API (scratchpad Node mock; never the production proxy) — Gratex unchanged + Ferretería end-to-end + 409 + mobile.

Execution order/dependencies: BE: T1→T4→T5; T2,T3 independent; T6 needs T1 (Redondeo not needed) but needs nothing else; T7 needs T4,T5,T6,T2; T8 last. FE: T9→T10→T11→T12→T13→T14→T15→T16. BE and FE chains run in parallel.

#### Backend interfaces (PHP, no autoloader: every file require_once's its deps with __DIR__ paths)

```php
// src/Utils/Cotizacion/Redondeo.php   (T1)
final class Redondeo {
    /** Copia exacta de montosLinea.redondear (fiscalo): pre-redondeo a 15 cifras + round, signo aparte. */
    public static function r(float $x, int $dec): float;
    public static function r2(float $x): float;   // r($x, 2)
    public static function r4(float $x): float;   // r($x, 4)
}

// src/Utils/Cotizacion/CotizacionFormato.php   (T6)
abstract class CotizacionFormato {
    abstract public function nombre(): string;
    /** @return array ['success', mixed $data] | ['error', string $msg, int $http] */
    abstract public function crear(object $body): array;
    abstract public function actualizar(array $row, object $body): array;
    /** payload = PDF bytes (string) */
    abstract public function preview(object $body, ?array $row): array;
    /** payload = PDF bytes (string); $cotizacion = row from getCotizaciones() incl. items */
    abstract public function pdf(array $cotizacion): array;
    public function permiteCorreo(): bool { return false; }
}

// src/Utils/Cotizacion/CotizacionFormatos.php   (T6)
final class CotizacionFormatos {
    public const DEFAULT = 'gratex';
    /** @var array<string,class-string> nombre => clase; T7 registers 'ferreteria' => FerreteriaFormato */
    public static function existe(?string $nombre): bool;
    /** null/unknown => GratexFormato. Never throws. */
    public static function para(?string $nombre, cotizacionModel $modelo): CotizacionFormato;
    /** TenantResolver::current()['cotizacion_formato'] ?? 'gratex', validated with existe(); unknown => 'gratex'. */
    public static function delTenant(): string;
    /** Formato a body claims: $body->formato if string, else 'gratex'. */
    public static function delCuerpo(object $body): string;
}

// src/Utils/Cotizacion/GratexFormato.php   (T6) — constructor(cotizacionModel $modelo); nombre()='gratex'; permiteCorreo()=true.
//   Moves today's controller branches verbatim (header checks 200/status:false with COT_* consts, cotValidarItems 422, body->user_id,
//   body->sent_email===true, body->date ?? '', success data unchanged; preview: same 3 checks, NO cotValidarItems, clients lookup, code 'PREVIEW').
//   cotValidarItems() and COT_* stay defined in cotizacionController.php (globals) and GratexFormato calls them at runtime.

// src/Utils/Cotizacion/FerreteriaFormato.php   (T4 static parts, T7 instance parts)
final class FerreteriaFormato extends CotizacionFormato {
    public const NOMBRE = 'ferreteria';
    public const AJUSTES_MONTO = ['cargos_bancarios', 'manejo_bancario', 'mano_obra', 'abono'];
    public const RETENCION = 'retencion_isr';
    public const TASA_RETENCION = 0.05;
    public const MAX_DESCRIPCION = 1000;
    public const UNIDAD_DEFAULT = '43';
    public function __construct(cotizacionModel $modelo);           // T7 (T4 may declare it storing ?cotizacionModel)
    public static function tasa(int $indicador): float;              // 1=>0.18, 2=>0.16, 3,4=>0.0
    /**
     * @param array<int,array{quantity:float,amount:float,indicador_facturacion:int}> $lineas
     * @param array{cargos_bancarios:float,manejo_bancario:float,mano_obra:float,abono:float,retencion_isr:bool} $ajustes
     * @return array{lineas: array<int,array{base:float,itbis:float}>, subtotal:float, itbis:float,
     *   cargos_bancarios:float, manejo_bancario:float, mano_obra:float, total:float, retencion_isr:float,
     *   adeudado:float, abono:float, restante:float, etiqueta_itbis:string, mostrar_restante:bool}
     * (adeudado = r2(total - retencion_isr); restante = r2(adeudado - abono);
     *  mostrar_restante = retencion_isr > 0 || abono > 0; etiqueta_itbis 'ITBIS 18%' | 'ITBIS')
     */
    public static function totales(array $lineas, array $ajustes): array;
    /** null if ok, else Spanish message 'El abono (RD$ X) no puede ser mayor que lo adeudado (RD$ Y).' */
    public static function errorAbono(array $totales): ?string;
    /**
     * Shape/range validation + normalization of a request body (no DB).
     * @param callable(float $cantidad, string $unidad, int $maxDec): ?string $problemaCantidad  (prod: [new unidadMedidaModel(), 'problemaCantidad'])
     * @param callable(string $unidad): bool $unidadValida                                      (prod: [new unidadMedidaModel(), 'isValid'])
     * @return array{ok:true, cot:array{date:?string, client_id:int, items:array<int,array{product_id:?int,description:string,
     *   quantity:float,amount:float,unidad_medida:string,indicador_facturacion:int,indicador_bien_servicio:int}>,
     *   ajustes:array{cargos_bancarios:float,manejo_bancario:float,mano_obra:float,abono:float,retencion_isr:bool}}}
     *   | array{ok:false, error:string}
     * date: 'Y-m-d H:i:s' (date-only input gets the CURRENT America/Santo_Domingo time appended) or null when missing/empty.
     */
    public static function validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array;
    public static function codigo(int $numero): string;              // 'COT-' . str_pad($numero, 6, '0', STR_PAD_LEFT)
    public static function formatearRnc(?string $rnc): string;       // digits: 9 => XXX-XXXXX-X, 11 => XXX-XXXXXXX-X, else as stored ('' for null)
    public static function fechaLarga(string $fecha): string;        // '2026-09-02 10:15:00' => 'SEPTIEMBRE 2/2026.-'
    // T7 instance methods implement the abstract contract above.
}

// src/Utils/Cotizacion/FerreteriaCotizacionPdf.php   (T5) — pure, never touches Database/TenantResolver/BrandingResolver.
final class FerreteriaCotizacionPdf {
    /**
     * @param array{code:?string (null => 'VISTA PREVIA'), date:string, items:array<int,array{description:string,quantity:float,amount:float}>,
     *              totales:array (exact output of FerreteriaFormato::totales)} $cotizacion
     * @param array $emisor   emisor_config row keys: rnc, razon_social, nombre_comercial, direccion, telefono, correo
     * @param array $cliente  keys: razon_social, company_name, client_name, rnc
     */
    public function __construct(array $cotizacion, array $emisor, array $cliente, ?string $logoPath);
    public function render(): string;   // PDF bytes (FPDF Output('S')), two-pass for 'Página X de Y'
}
// T5 may use FerreteriaFormato::formatearRnc / fechaLarga (T4) and EcfDocumento::textoPrecio (static, existing).

// cotizacionModel additions (T7):
//   public function getCliente(int $id): ?array                      // client_name, company_name, razon_social, rnc, email
//   public function getProductosInfo(array $ids): array               // [product_id(int) => ['indicador_bien_servicio'=>int]]
//   public function getAjustes(int $id): array                        // [concepto => monto(string)]; own try/catch => [] + error_log
//   public function crearConFormato(array $cot, array $tot, string $formato, ?int $userId, string $clientName): array
//        // ['success', ['id'=>int,'code'=>string,'numero'=>int,'total'=>float]] | ['error', string]
//   public function actualizarConFormato(int $id, array $cot, array $tot, ?int $userId, string $clientName): array
//        // same success shape; $cot['date'] === null keeps stored date; replaces items and ajustes
//   private function siguienteNumero(): int; private function tomarLockSecuencia(): bool; private function soltarLockSecuencia(): void
//   getCotizacionItems => SELECT * ... ORDER BY id ASC (never name new columns). getCotizaciones/getCotizacionesPaginated add
//   'ajustes' => (object) getAjustes() only when formato is set and !== 'gratex', else (object) [].
```

#### Frontend interfaces (TS)

```ts
// src/api/types.ts (T9)
export interface AjustesFerreteria { cargos_bancarios?: number; manejo_bancario?: number; mano_obra?: number; abono?: number; retencion_isr: boolean }
export interface CotizacionFerreteriaItemInput { product_id: number | null; description: string; quantity: number; amount: number;
  unidad_medida: string; indicador_facturacion: number; indicador_bien_servicio: number }
export interface CotizacionFerreteriaInput { formato: 'ferreteria'; client_id: number; date?: string; items: CotizacionFerreteriaItemInput[]; ajustes: AjustesFerreteria }
// CotizacionRow gains: formato?: string | null; numero?: number | null; subtotal?: string | number | null; itbis?: string | number | null;
//                      ajustes?: Record<string, string | number>
// CotizacionItemRow gains: product_id?: number | null; unidad_medida?: string | null; indicador_facturacion?: number | null;
//                          indicador_bien_servicio?: number | null; itbis_amount?: string | number | null
// BrandingData gains: cotizacion_formato?: string
// src/api/cotizaciones.ts (T9): createCotizacion(input: CreateCotizacionInput | CotizacionFerreteriaInput): Promise<{ id: number; code: string; message?: string; numero?: number; total?: number }>
//   updateCotizacion(input: (CreateCotizacionInput | CotizacionFerreteriaInput) & { id: number | string }): Promise<unknown>
//   previewCotizacion(input: Omit<CreateCotizacionInput, 'user_id' | 'sent_email'> | (CotizacionFerreteriaInput & { id?: number })): Promise<DocBase64>

// src/features/invoices/montosLinea.ts (T9): export function indFactFromItbis(itbis: number): IndicadorFacturacion  (moved from InvoiceFormView, same body)

// src/types/domain.ts (T9)
export interface FacturaPrefill {
  kind: 'factura-prefill'; clienteId: string; clienteNombre: string; origen?: string
  precioConItbis?: boolean; avisos?: string[]
  lineas: { nombre: string; cantidad: number; precio: number; prodId?: string; unidadMedida?: number; indFact?: number; tipoItem?: 'Bien' | 'Servicio' }[]
}
export interface FacturaSimplePrefill {
  kind: 'factura-simple-prefill'; clienteId: string; clienteNombre: string; origen: string; avisos?: string[]
  lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
}
// src/config/navigation.ts (T9): export function isFacturaSimplePrefill(p: unknown): p is FacturaSimplePrefill; NavPayload union includes FacturaSimplePrefill

// src/features/cotizaciones/formatos/ferreteria/totales.ts (T10) — value imports ONLY by relative path with .ts extension; '@/…' only `import type`
export interface LineaFerreteria { cantidad: number; precio: number; indFact: number }
export interface AjustesFerreteriaForm { cargosBancarios: number; manejoBancario: number; manoObra: number; abono: number; retencion: boolean }
export interface TotalesFerreteria { lineas: { base: number; itbis: number }[]; subtotal: number; itbis: number; cargosBancarios: number;
  manejoBancario: number; manoObra: number; total: number; retencion: number; adeudado: number; abono: number; restante: number;
  etiquetaItbis: 'ITBIS 18%' | 'ITBIS'; mostrarRestante: boolean }
export function totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria  // uses montosLinea(…, false) + r2

// src/features/cotizaciones/formatos/index.ts (T11)
export type FormatoId = 'gratex' | 'ferreteria'
export interface CotizacionFormatoUI { id: FormatoId; Form: ComponentType<{ nav: Nav; cotizacionId: number | null }> }
export const FORMATOS: Record<FormatoId, CotizacionFormatoUI>   // gratex.Form = existing CotizacionFormView (UNCHANGED file)
export function esFormato(x: unknown): x is FormatoId
export function formatoDeFila(row: { formato?: string | null } | null | undefined): FormatoId   // unknown/null => 'gratex'
export function useCotizacionFormato(): { formato: FormatoId; cargando: boolean; error: unknown }
// src/features/cotizaciones/formatos/CotizacionEditor.tsx (T11): export function CotizacionEditor({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null })

// src/features/cotizaciones/formatos/ferreteria/conversion.ts (T13)
export function ferreteriaAFacturaPrefill(c: CotizacionRow): FacturaPrefill        // precioConItbis:false, avisos for cargos
export function ferreteriaAFacturaSimplePrefill(c: CotizacionRow): FacturaSimplePrefill  // precio = redondear(amount*(1+tasa),4)
export function avisosCargos(c: CotizacionRow): string[]

// src/features/products/ProductoCombobox.tsx (T12): new optional prop `mostrarPrecio?: boolean` (default false => shows Costo as today)
```

#### Rules every task follows
- Re-read files right before editing; targeted edits only (other sessions may touch the same checkouts).
- Gratex must not change: do NOT edit `src/Utils/CotizacionPdfGenerator.php`, `src/features/cotizaciones/CotizacionFormView.tsx`, nor the legacy `saveCotizacion` / `updateCotizacion` / `sendCotizacionPdfEmail` bodies.
- PHP: Spanish comments explaining WHY, friendly Spanish user messages, technical detail to error_log, PDO prepared statements, FPDF text via mb_convert_encoding to ISO-8859-1, core fonts only.
- Commit messages: Spanish conventional style like the repo (`feat(cotizaciones): ...`), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit on branch feat/cotizacion-formatos in the right repo.
- Browser checks: never hit production. The fiscalo `.env` proxies /api to production; any vite run must set API_PROXY_TARGET to a local mock and API_KEY=''.

#### Fixture file `tools/fixtures/cotizacion_ferreteria.json` (T1 creates; T4, T5, T10 consume; FE copy at `scripts/fixtures/cotizacion_ferreteria.json`)

Shape (all amounts as JSON numbers):
```json
{
  "emisor": { "rnc": "132615123", "razon_social": "FERREHERRAMIENTAS VENTURA, SRL", "nombre_comercial": "Ferreherramientas Ventura",
              "direccion": "CALLE NICOLAS CASIMIRO NO.78, ENS. ESPAILLAT, SANTO DOMINGO NORTE", "telefono": "829-898-7798",
              "correo": "yaironventura0201@hotmail.com" },
  "casos": [
    { "id": "pintura", "hoja": "cotizacion pintura", "code": "COT-000001", "date": "2026-05-14 09:00:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO",
                   "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [ { "quantity": 7, "description": "GALONES DE PINTURA BLNACA SEMIGLOSS", "amount": 2000, "indicador_facturacion": 1 } ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": { "subtotal": 41860, "itbis": 7534.8, "total": 49394.8, "retencion_isr": 0, "adeudado": 49394.8, "abono": 0,
                    "restante": 49394.8, "etiqueta_itbis": "ITBIS 18%", "mostrar_restante": false } }
  ]
}
```
Cases (id: lines as (quantity, amount, indicador) + description; ajustes; expected):
- `pintura` (sheet "cotizacion pintura", date 2026-05-14): (7,2000,1) GALONES DE PINTURA BLNACA SEMIGLOSS; (2,970,1) LLAVES DE LAVAMANOS PICO LARGO; (2,275,1) MANGUERAS DE LAVAMANOS; (2,160,1) BROCHAS No.4; (2,935,1) FUNDAS CEMENTO GRIS; (1,2380,1) FUNDA CEMENTO BLANCO; (2,10400,1) CUBETA DE PINTURA SEMIGLOSS 966. Ajustes none. Expect subtotal 41860, itbis 7534.8, total 49394.8, retencion 0, adeudado 49394.8, restante 49394.8, 'ITBIS 18%', mostrar_restante false.
- `pintura_retencion_abono`: same lines as pintura; ajustes retencion_isr true, abono 10000. Expect retencion 2093, adeudado 47301.8, restante 37301.8, total 49394.8, mostrar_restante true.
- `pintura_mano_obra`: same lines; mano_obra 1500, cargos_bancarios 100, manejo_bancario 50. Expect total 51044.8 (49394.8+1650), mostrar_restante false.
- `b150000049` (sheet "b150000049", date 2026-09-02, code COT-000002, same client): (1,350,1) T  3"; (2,325,1) CODO 3X2; (1,310,1) T  3 A 2; (1,305,1) REDUCCION DE 3 A 2; (1,240,1) SIFON DE 2"; (3,135,1) CODO DE 2; (1,175,1) REDUCCION DE 2 A 1/2; (1,675,1) PVC AZUL LANCON 8OZ.; (1,725,1) TUBO PVC DE 2 SEMIPRESION; (1,11500,1) INODORO; (1,7000,1) LAVA MANOS CON PEDESTAL; (1,210,1) ARANDELA DE INODORO 4 A3; (1,225,1) JUNTA DE CERA; (1,138,1) JUEGO DE TORNILLOS DE VASINETA; (2,325,1) LLAVES ANGULAR DE 1/2X3/8; (2,160,1) NIPLES HG 1/2X3/8; (1,210,1) MANGUERA DE INODORO; (1,210,1) MANGUERA LAVA MANOS; (1,30,1) T PVC 1/2; (2,35,1) ADAPTADORES MACHO 1/2; (4,90,1) CODO DE 2/1 HG; (1,1080,1) TUBO PVC DE 3 SEMIPRESION; (1,90,1) ROLLO TEFLON AMARILLO; (1,750,1) LLAVE LAVA MANOS; (1,225,1) SIFON SENCILLO DE LAVA MANOS; (1,375,1) BOQUILLA LAVA MANOS. Expect subtotal 27278, itbis 4910.04, total 32188.04.
- `ceramicas` (sheet "CERAMICAS", date 2026-09-02, code COT-000003): (3,1650,1) METROS DE CERAMICAS 60X60; (2,625,1) FUNDAS DE PAGATOX; (1,960,1) FUNDA CEMENTOS GRIS; (2,300,1) FUNDA ARENA; (5,100,1) LIBRAS CEMENTO BLANCO. Expect subtotal 8260, itbis 1486.8, total 9746.8.
- `redondeo_8475`: (1,84.75,1) PRUEBA REDONDEO. Expect subtotal 84.75, itbis 15.26, total 100.01.
- `flotante`: (1,13.70,1) PRUEBA FLOTANTE; retencion_isr true, abono 15.48. Expect subtotal 13.7, itbis 2.47, total 16.17, retencion 0.69, adeudado 15.48, restante 0, mostrar_restante true; errorAbono(...) === null.
- `mixto`: (1,100,1) A; (2,50,4) B EXENTO; (1,200,2) C 16%. Expect subtotal 400, itbis 50, total 450, etiqueta 'ITBIS'.
- `exento`: (3,10,4) TODO EXENTO. Expect subtotal 30, itbis 0, total 30, etiqueta 'ITBIS'.
- `largo_60` (PDF page-break fixture only, no expected totals needed beyond being computed): 60 lines (1, 100+i, 1) "ARTICULO DE PRUEBA NUMERO i CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA" for i=1..60.
Abono-too-big check (in T4 test, not a fixture): pintura lines + abono 50000 => errorAbono returns non-null.

#### Resolved deviations (consistency review, binding for every part file)

Where a part file and the sections above differ, these resolutions win, and every part file has been aligned to them:
- **FerreteriaFormato inheritance.** T4 declares `final class FerreteriaFormato` with NO `extends`, no constructor and no
  stubs (CotizacionFormato.php doesn't exist until T6). T7 adds `extends CotizacionFormato`, the requires,
  `private cotizacionModel $modelo`, `__construct(cotizacionModel $modelo)`, `nombre()`, `crear`, `actualizar`, `preview`,
  `pdf`. `CotizacionFormato` has no constructor and no properties.
- **validarForma** is `validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array` returning
  `['ok'=>true,'cot'=>…] | ['ok'=>false,'error'=>string]` (the spec's older `callable $permiteDecimales): ?array` form is
  superseded). It only checks `client_id > 0`; client/product existence and `indicador_bien_servicio` from the product are
  T7's `aplicarCatalogo`.
- **Model write errors** may carry a third element: `['error', msg, 422]` (FK 1452 on the product) or `['error', msg, 404]`
  (row gone before `FOR UPDATE`). FerreteriaFormato maps a missing third element to 500, so every formato error reaching
  the controller is `['error', msg, http]` and `cotError()` applies `http` unless it is 200.
- **409 text** lives in `CotizacionFormatos::MSG_DESACTUALIZADA` (T6, additive). The FE shows it in the sticky bar with
  "Recargar" (T12).
- **Harness insertion rule** (`tools/test_cotizacion_ferreteria.php`): every later section (T4, T5, T6, T7 A/B/C) goes
  directly ABOVE T1's 3-line marker block (`// ---…---` / `// Las tareas siguientes agregan sus secciones AQUÍ, encima
  del resumen.` / `// ---…---`), followed by one blank line; the marker, the summary `printf` and the `exit` stay last.
  Order: T1, T4, T5, T6, T7A, T7B, T7C. Final count with everything as planned: `378/378 OK`.
- **brandingController** returns `(string) ($tenant['cotizacion_formato'] ?? 'gratex')` from the master row it already
  loads (T3); unknown strings pass through and both sides map them to gratex (`existe` / `esFormato`).
- **useCotizacionFormato().error** is `string | null` (useApiQuery's type; the contract's `unknown` narrowed). It is
  non-null only when branding failed and nothing is cached.
- **FE lint gate** is `npx eslint src scripts`: `npm run lint` (`eslint .`) is already red on `ds-bundle/`. `tsconfig.json`
  includes `scripts` (T10), so `npm run typecheck` checks the node scripts too.
- **FE node test scripts** (house style `  [OK  ]` / `  [FALLA]`, `N/M OK`, exit 1): `scripts/parity-cotizacion-ferreteria.ts`
  (T10, 100/100), `scripts/test-schema-cotizacion-ferreteria.ts` (T12, 25/25), `scripts/test-conversion-ferreteria.ts`
  (T13, 30/30). The BE checker `tools/check_tenant_schema_orden.php` (T2) prints `[FALLO]` like `tools/test_tenant_mail.php`.
- **Cross-chain waits:** FE T10 Step 1 waits for BE T1's fixture commit; FE T16 Step 27 waits for BE T3 Step 9's
  `docs/plantillas-factura.md` commit (T3 owns line 39 of that file, T16 never touches it).
- **Ferretería form labels** T16 relies on (T12 final code): `Crear cotización` / `Guardar cambios`, `+ Cargos y abonos`,
  `Retención Renta 5%`, `Eliminar` → `Sí, eliminar`, `Recargar`, totals `Total RD$`, catalog box placeholder
  `Agregar del catálogo: nombre, SKU o categoría…`; editor empty state `Esta cotización ya no existe` + `Ir a cotizaciones`.
  Only the Gratex form has `Enviar por correo al guardar`; only the Ferretería form has `Cotización mercancías`.

---

## Part A: Tasks 1 and 4

<!-- Group A: Task 1 and Task 4 (backend, api-gratex). Every code block below was run on PHP 8.5.8 before it went into this plan:
     the finished harness gives 244/244 OK, and the staged runs give exactly the failures and counts quoted in the steps. -->

### Notes for Tasks 1 and 4 (read before starting)

- **Repo and shell.**
  - Every command runs in **Git Bash** (the Bash tool) from `C:/Users/Signos/Documents/edwin/api-gratex`, on branch
    `feat/cotizacion-formatos`, unless a step says otherwise.
  - Code blocks start at column 0: copy them exactly, including the heredoc `EOF` lines.
  - Both repos have `core.autocrlf=true`. Git may warn "LF will be replaced by CRLF". That's harmless: the committed
    blobs are LF.
- **No DB anywhere in these two tasks.** `tools/test_cotizacion_ferreteria.php` never opens a connection.
  `unidadMedidaModel` is only `require`d for its static `decimalesDe()`, which doesn't touch `MasterDatabase`.
- **The harness API that later tasks (T5, T7) append to.** Task 1 creates it:
  - `$chk(string $desc, bool $ok)` prints `  [OK  ] desc` or `  [FALLA] desc` and counts into `$total` / `$fallos`.
  - `$igual($a, $b): bool` compares numbers exactly after a `(float)` cast. JSON brings `41860` as an int.
  - `$fixture` is the decoded fixture (assoc arrays). `$casos` is `id => caso`.
  - `BrandingResolver::sinMarcaGlobal()` has already been called at the top.
  - The summary `printf("\n%d/%d OK\n", $total - $fallos, $total);` and `exit($fallos === 0 ? 0 : 1);` stay the last
    two lines. Any failure exits 1, and a fatal error exits 255.
  - New sections go **directly above this marker block** (lines 169-171 when Task 1 creates the file), separated from it
    by one blank line. The marker stays the last thing before the summary:

```php
// ---------------------------------------------------------------------------
// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.
// ---------------------------------------------------------------------------
```

- **The class in Task 4 deliberately has no `extends`.** Task 4 creates `final class FerreteriaFormato` with only the
  constants and static functions. It has no `extends CotizacionFormato`, no constructor and no stubs.
  - The reason: in numeric order Task 4 runs before Task 6, and `src/Utils/Cotizacion/CotizacionFormato.php` may not
    exist yet. An `extends` on a missing class is a fatal error when the file loads, and that would break the CLI
    harness.
  - **Task 7** changes line 21 `final class FerreteriaFormato` to
    `final class FerreteriaFormato extends CotizacionFormato`.
  - Task 7 adds `require_once __DIR__ . '/CotizacionFormato.php';` and its other requires next to the two at
    lines 2-3.
  - Task 7 adds `__construct(cotizacionModel $modelo)`, `nombre()`, `crear()`, `actualizar()`, `preview()` and `pdf()`.
  - The private names Task 4 already uses are `ETIQUETAS_AJUSTE`, `MESES`, `normalizarLinea`, `normalizarAjustes`,
    `normalizarFecha`, `leerNumero` and `leerEntero`. Task 7 must not redeclare them.

---

### Task 1: Redondeo, CLI harness and Ferretería fixtures

**Files:**
- Create: `src/Utils/Cotizacion/Redondeo.php` (new folder `src/Utils/Cotizacion/`)
- Create: `tools/test_cotizacion_ferreteria.php`
- Create: `tools/fixtures/cotizacion_ferreteria.json` (new folder `tools/fixtures/`)
- Create: `tools/fixtures/ferreteria_logo.jpeg` (a binary copy of the workbook's `xl/media/image1.jpeg`)
- Test: `tools/test_cotizacion_ferreteria.php` (sections "Fixtures" and "Redondeo")

**Interfaces:**
- Consumes (existing code, unchanged):
  - `BrandingResolver::sinMarcaGlobal(bool $v = true): void` (`src/Utils/Pdf/BrandingResolver.php:40-43`).
  - The house style for the harness: `tools/test_tenant_mail.php:23-31` (the `$chk` helper) and `:137-138` (summary
    and exit).
  - The algorithm being copied: `redondear(x, dec)` in fiscalo `src/features/invoices/montosLinea.ts:32-36`.
- Produces, from the contract:

```php
// src/Utils/Cotizacion/Redondeo.php
final class Redondeo {
    /** Copia exacta de montosLinea.redondear (fiscalo): pre-redondeo a 15 cifras + round, signo aparte. */
    public static function r(float $x, int $dec): float;
    public static function r2(float $x): float;   // r($x, 2)
    public static function r4(float $x): float;   // r($x, 4)
}
```

- Also produces `tools/fixtures/cotizacion_ferreteria.json`, in the contract's shape. T4, T5 and T10 consume it, and
  T10 copies it byte for byte to fiscalo `scripts/fixtures/`.
  - Every case carries `id`, `hoja` (`null` for the synthetic cases), `code`, `date`, `cliente`, `lineas`, `ajustes`
    and `esperado`.
  - `esperado` always has the 9 keys of the contract example. `pintura_mano_obra` adds `cargos_bancarios`,
    `manejo_bancario` and `mano_obra`.
  - `redondeo_8475`, `flotante`, `mixto` and `exento` add `lineas: [{base, itbis}]`, and `flotante` adds
    `error_abono: null`. These are the keys T10's parity script understands.
  - `largo_60` has code `COT-000060` and computed totals (7830 / 1409.4 / 9239.4).
- Also produces the harness API described in the notes above.

- [ ] **Step 1: Check the branch and the working tree**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git switch feat/cotizacion-formatos
git status --short
ls src/Utils/Cotizacion tools/fixtures 2>&1 | head -5
```

Expected:
- `git status --short` prints nothing. If other sessions left uncommitted work, don't touch it and only add this task's
  files.
- Both `ls` lines say `No such file or directory`, unless Task 6 already created `src/Utils/Cotizacion/`. Existing files
  there are fine; don't touch them.

- [ ] **Step 2: Extract the logo fixture**

The logo is `xl/media/image1.jpeg` from Ferretería's workbook (JPEG, 330×360 px, 50,976 bytes). This session already
unzipped it into the scratchpad. If that copy is gone, the command takes it straight from the workbook in Downloads.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
mkdir -p tools/fixtures
SRC="C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/xl/xl/media/image1.jpeg"
if [ -f "$SRC" ]; then cp "$SRC" tools/fixtures/ferreteria_logo.jpeg; else unzip -p "C:/Users/Signos/Downloads/COTIZACION JUN Ta de cera.xlsx" xl/media/image1.jpeg > tools/fixtures/ferreteria_logo.jpeg; fi
md5sum tools/fixtures/ferreteria_logo.jpeg; wc -c < tools/fixtures/ferreteria_logo.jpeg
```

Expected: `f04fb509c1e5b3c7ceaec0a2bb61251d *tools/fixtures/ferreteria_logo.jpeg` and `50976`.

- [ ] **Step 3: Write the fixture file**

Create `tools/fixtures/cotizacion_ferreteria.json` with exactly this content (LF, 2-space indent, trailing newline):

```json
{
  "emisor": { "rnc": "132615123", "razon_social": "FERREHERRAMIENTAS VENTURA, SRL", "nombre_comercial": "Ferreherramientas Ventura", "direccion": "CALLE NICOLAS CASIMIRO NO.78, ENS. ESPAILLAT, SANTO DOMINGO NORTE", "telefono": "829-898-7798", "correo": "yaironventura0201@hotmail.com" },
  "casos": [
    {
      "id": "pintura",
      "hoja": "cotizacion pintura",
      "code": "COT-000001",
      "date": "2026-05-14 09:00:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 7, "description": "GALONES DE PINTURA BLNACA SEMIGLOSS", "amount": 2000, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "LLAVES DE LAVAMANOS PICO LARGO", "amount": 970, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "MANGUERAS DE LAVAMANOS", "amount": 275, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "BROCHAS No.4", "amount": 160, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "FUNDAS CEMENTO GRIS", "amount": 935, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "FUNDA CEMENTO BLANCO", "amount": 2380, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "CUBETA DE PINTURA SEMIGLOSS 966", "amount": 10400, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 41860,
        "itbis": 7534.8,
        "total": 49394.8,
        "retencion_isr": 0,
        "adeudado": 49394.8,
        "abono": 0,
        "restante": 49394.8,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false
      }
    },
    {
      "id": "pintura_retencion_abono",
      "hoja": "cotizacion pintura",
      "code": "COT-000001",
      "date": "2026-05-14 09:00:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 7, "description": "GALONES DE PINTURA BLNACA SEMIGLOSS", "amount": 2000, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "LLAVES DE LAVAMANOS PICO LARGO", "amount": 970, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "MANGUERAS DE LAVAMANOS", "amount": 275, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "BROCHAS No.4", "amount": 160, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "FUNDAS CEMENTO GRIS", "amount": 935, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "FUNDA CEMENTO BLANCO", "amount": 2380, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "CUBETA DE PINTURA SEMIGLOSS 966", "amount": 10400, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 10000, "retencion_isr": true },
      "esperado": {
        "subtotal": 41860,
        "itbis": 7534.8,
        "total": 49394.8,
        "retencion_isr": 2093,
        "adeudado": 47301.8,
        "abono": 10000,
        "restante": 37301.8,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": true
      }
    },
    {
      "id": "pintura_mano_obra",
      "hoja": "cotizacion pintura",
      "code": "COT-000001",
      "date": "2026-05-14 09:00:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 7, "description": "GALONES DE PINTURA BLNACA SEMIGLOSS", "amount": 2000, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "LLAVES DE LAVAMANOS PICO LARGO", "amount": 970, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "MANGUERAS DE LAVAMANOS", "amount": 275, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "BROCHAS No.4", "amount": 160, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "FUNDAS CEMENTO GRIS", "amount": 935, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "FUNDA CEMENTO BLANCO", "amount": 2380, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "CUBETA DE PINTURA SEMIGLOSS 966", "amount": 10400, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 100, "manejo_bancario": 50, "mano_obra": 1500, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 41860,
        "itbis": 7534.8,
        "total": 51044.8,
        "retencion_isr": 0,
        "adeudado": 51044.8,
        "abono": 0,
        "restante": 51044.8,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false,
        "cargos_bancarios": 100,
        "manejo_bancario": 50,
        "mano_obra": 1500
      }
    },
    {
      "id": "b150000049",
      "hoja": "b150000049",
      "code": "COT-000002",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 1, "description": "T  3\"", "amount": 350, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "CODO 3X2", "amount": 325, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "T  3 A 2", "amount": 310, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "REDUCCION DE 3 A 2", "amount": 305, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "SIFON DE 2\"", "amount": 240, "indicador_facturacion": 1 },
        { "quantity": 3, "description": "CODO DE 2", "amount": 135, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "REDUCCION DE 2 A 1/2", "amount": 175, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "PVC AZUL LANCON 8OZ.", "amount": 675, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "TUBO PVC DE 2 SEMIPRESION", "amount": 725, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "INODORO", "amount": 11500, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "LAVA MANOS CON PEDESTAL", "amount": 7000, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARANDELA DE INODORO 4 A3", "amount": 210, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "JUNTA DE CERA", "amount": 225, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "JUEGO DE TORNILLOS DE VASINETA", "amount": 138, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "LLAVES ANGULAR DE 1/2X3/8", "amount": 325, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "NIPLES HG 1/2X3/8", "amount": 160, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "MANGUERA DE INODORO", "amount": 210, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "MANGUERA LAVA MANOS", "amount": 210, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "T PVC 1/2", "amount": 30, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "ADAPTADORES MACHO 1/2", "amount": 35, "indicador_facturacion": 1 },
        { "quantity": 4, "description": "CODO DE 2/1 HG", "amount": 90, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "TUBO PVC DE 3 SEMIPRESION", "amount": 1080, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ROLLO TEFLON AMARILLO", "amount": 90, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "LLAVE LAVA MANOS", "amount": 750, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "SIFON SENCILLO DE LAVA MANOS", "amount": 225, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "BOQUILLA LAVA MANOS", "amount": 375, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 27278,
        "itbis": 4910.04,
        "total": 32188.04,
        "retencion_isr": 0,
        "adeudado": 32188.04,
        "abono": 0,
        "restante": 32188.04,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false
      }
    },
    {
      "id": "ceramicas",
      "hoja": "CERAMICAS",
      "code": "COT-000003",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 3, "description": "METROS DE CERAMICAS 60X60", "amount": 1650, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "FUNDAS DE PAGATOX", "amount": 625, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "FUNDA CEMENTOS GRIS", "amount": 960, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "FUNDA ARENA", "amount": 300, "indicador_facturacion": 1 },
        { "quantity": 5, "description": "LIBRAS CEMENTO BLANCO", "amount": 100, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 8260,
        "itbis": 1486.8,
        "total": 9746.8,
        "retencion_isr": 0,
        "adeudado": 9746.8,
        "abono": 0,
        "restante": 9746.8,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false
      }
    },
    {
      "id": "redondeo_8475",
      "hoja": null,
      "code": "COT-000004",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 1, "description": "PRUEBA REDONDEO", "amount": 84.75, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 84.75,
        "itbis": 15.26,
        "total": 100.01,
        "retencion_isr": 0,
        "adeudado": 100.01,
        "abono": 0,
        "restante": 100.01,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false,
        "lineas": [
          { "base": 84.75, "itbis": 15.26 }
        ]
      }
    },
    {
      "id": "flotante",
      "hoja": null,
      "code": "COT-000005",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 1, "description": "PRUEBA FLOTANTE", "amount": 13.7, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 15.48, "retencion_isr": true },
      "esperado": {
        "subtotal": 13.7,
        "itbis": 2.47,
        "total": 16.17,
        "retencion_isr": 0.69,
        "adeudado": 15.48,
        "abono": 15.48,
        "restante": 0,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": true,
        "lineas": [
          { "base": 13.7, "itbis": 2.47 }
        ],
        "error_abono": null
      }
    },
    {
      "id": "mixto",
      "hoja": null,
      "code": "COT-000006",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 1, "description": "A", "amount": 100, "indicador_facturacion": 1 },
        { "quantity": 2, "description": "B EXENTO", "amount": 50, "indicador_facturacion": 4 },
        { "quantity": 1, "description": "C 16%", "amount": 200, "indicador_facturacion": 2 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 400,
        "itbis": 50,
        "total": 450,
        "retencion_isr": 0,
        "adeudado": 450,
        "abono": 0,
        "restante": 450,
        "etiqueta_itbis": "ITBIS",
        "mostrar_restante": false,
        "lineas": [
          { "base": 100, "itbis": 18 },
          { "base": 100, "itbis": 0 },
          { "base": 200, "itbis": 32 }
        ]
      }
    },
    {
      "id": "exento",
      "hoja": null,
      "code": "COT-000007",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 3, "description": "TODO EXENTO", "amount": 10, "indicador_facturacion": 4 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 30,
        "itbis": 0,
        "total": 30,
        "retencion_isr": 0,
        "adeudado": 30,
        "abono": 0,
        "restante": 30,
        "etiqueta_itbis": "ITBIS",
        "mostrar_restante": false,
        "lineas": [
          { "base": 30, "itbis": 0 }
        ]
      }
    },
    {
      "id": "largo_60",
      "hoja": null,
      "code": "COT-000060",
      "date": "2026-09-02 10:15:00",
      "cliente": { "razon_social": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "client_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131" },
      "lineas": [
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 1 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 101, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 2 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 102, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 3 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 103, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 4 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 104, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 5 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 105, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 6 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 106, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 7 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 107, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 8 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 108, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 9 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 109, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 10 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 110, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 11 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 111, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 12 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 112, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 13 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 113, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 14 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 114, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 15 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 115, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 16 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 116, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 17 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 117, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 18 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 118, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 19 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 119, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 20 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 120, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 21 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 121, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 22 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 122, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 23 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 123, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 24 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 124, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 25 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 125, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 26 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 126, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 27 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 127, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 28 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 128, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 29 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 129, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 30 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 130, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 31 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 131, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 32 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 132, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 33 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 133, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 34 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 134, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 35 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 135, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 36 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 136, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 37 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 137, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 38 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 138, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 39 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 139, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 40 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 140, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 41 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 141, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 42 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 142, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 43 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 143, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 44 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 144, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 45 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 145, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 46 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 146, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 47 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 147, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 48 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 148, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 49 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 149, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 50 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 150, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 51 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 151, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 52 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 152, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 53 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 153, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 54 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 154, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 55 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 155, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 56 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 156, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 57 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 157, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 58 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 158, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 59 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 159, "indicador_facturacion": 1 },
        { "quantity": 1, "description": "ARTICULO DE PRUEBA NUMERO 60 CON UNA DESCRIPCION LARGA PARA FORZAR VARIAS LINEAS EN LA CELDA", "amount": 160, "indicador_facturacion": 1 }
      ],
      "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 0, "abono": 0, "retencion_isr": false },
      "esperado": {
        "subtotal": 7830,
        "itbis": 1409.4,
        "total": 9239.4,
        "retencion_isr": 0,
        "adeudado": 9239.4,
        "abono": 0,
        "restante": 9239.4,
        "etiqueta_itbis": "ITBIS 18%",
        "mostrar_restante": false
      }
    }
  ]
}
```

Check it:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -r '$f = json_decode(file_get_contents("tools/fixtures/cotizacion_ferreteria.json"), true); echo json_last_error_msg(), " ", count($f["casos"]), "\n";'
md5sum tools/fixtures/cotizacion_ferreteria.json
```

Expected: `No error 10` and `76da471dddcb54715fc05010df3ebe86` (25,924 bytes, LF). If the md5 differs only because the
editor wrote CRLF, that's fine: Step 10 re-checks the md5 from the committed blob.

- [ ] **Step 4: Write the harness (the test) before the code**

Create `tools/test_cotizacion_ferreteria.php`. It is 174 lines, with the marker block at lines 169-171.

```php
<?php
/**
 * test_cotizacion_ferreteria.php — Formato de cotización de Ferretería, sin DB.
 *
 * Ferretería cotiza con su hoja de Excel "COTIZACION MERCANCIAS". El servidor
 * calcula los totales (FerreteriaFormato) y la pantalla los repite antes de
 * guardar (fiscalo totalesFerreteria()): los dos tienen que dar lo mismo al
 * centavo, y lo mismo que las hojas. Este script lo prueba por CLI, sin base
 * de datos ni servidor, sección por sección (cada tarea agrega la suya encima
 * del resumen).
 *
 * Los casos viven en tools/fixtures/cotizacion_ferreteria.json: las 3 hojas
 * del Excel línea por línea, más casos de borde. El front corre una copia de
 * ese archivo (fiscalo scripts/fixtures/) con su script de paridad, así que
 * un cambio aquí se copia allá.
 *
 * Uso:
 *   php tools/test_cotizacion_ferreteria.php
 */

require_once __DIR__ . '/../src/Utils/Pdf/BrandingResolver.php';
require_once __DIR__ . '/../src/Utils/Cotizacion/Redondeo.php';

// Sin marca global, como tools/ri_desde_xml.php: sin tenant resuelto, el logo
// y el sello del repo (los de Gratex) son el fallback de las plantillas, y no
// pueden salir en nada que este script dibuje para Ferretería.
BrandingResolver::sinMarcaGlobal();

$fallos = 0;
$total = 0;
$chk = function (string $desc, bool $ok) use (&$fallos, &$total) {
    $total++;
    if (!$ok) {
        $fallos++;
    }
    printf("  [%s] %s\n", $ok ? 'OK  ' : 'FALLA', $desc);
};

// Los montos salen de Redondeo y se comparan EXACTOS: r2 da el double más
// cercano al decimal, el mismo que lee json_decode. (float) porque el JSON
// trae 41860 como entero.
$igual = static fn($a, $b): bool => is_numeric($a) && is_numeric($b) && (float) $a === (float) $b;

$fixture = json_decode((string) file_get_contents(__DIR__ . '/fixtures/cotizacion_ferreteria.json'), true);
if (!is_array($fixture) || !isset($fixture['casos'], $fixture['emisor'])) {
    fwrite(STDERR, "No se pudo leer tools/fixtures/cotizacion_ferreteria.json\n");
    exit(1);
}
/** @var array<string,array> $casos id => caso */
$casos = array_column($fixture['casos'], null, 'id');

echo "== Fixtures ==\n";
$chk('el fixture trae los 10 casos', array_keys($casos) === [
    'pintura', 'pintura_retencion_abono', 'pintura_mano_obra', 'b150000049', 'ceramicas',
    'redondeo_8475', 'flotante', 'mixto', 'exento', 'largo_60',
]);
// D = A × C y Sub-total = SUM(D): la cuenta de la hoja, sin Redondeo, para
// que un error al copiar una línea no se esconda detrás del código probado.
$sumaHoja = static fn(array $caso): float => array_sum(array_map(
    static fn(array $l): float => (float) $l['quantity'] * (float) $l['amount'],
    $caso['lineas']
));
foreach ([['pintura', 7, 41860], ['b150000049', 26, 27278], ['ceramicas', 5, 8260]] as [$id, $n, $subtotal]) {
    $chk("{$id}: {$n} líneas, como la hoja", count($casos[$id]['lineas']) === $n);
    $chk("{$id}: Σ cantidad × valor unitario = {$subtotal}, el Sub-total de la hoja", $sumaHoja($casos[$id]) === (float) $subtotal);
}
$chk('pintura_retencion_abono y pintura_mano_obra usan las líneas de pintura',
    $casos['pintura_retencion_abono']['lineas'] === $casos['pintura']['lineas']
    && $casos['pintura_mano_obra']['lineas'] === $casos['pintura']['lineas']);
$chk('largo_60: 60 líneas de 1 × (100 + i)', count($casos['largo_60']['lineas']) === 60
    && $casos['largo_60']['lineas'][59]['amount'] === 160
    && str_starts_with($casos['largo_60']['lineas'][59]['description'], 'ARTICULO DE PRUEBA NUMERO 60 '));
$completo = true;
foreach ($casos as $caso) {
    $completo = $completo && isset($caso['code'], $caso['date'], $caso['cliente'], $caso['lineas'], $caso['ajustes'], $caso['esperado'])
        && array_key_exists('hoja', $caso);
}
$chk('cada caso trae hoja, code, date, cliente, lineas, ajustes y esperado', $completo);
$chk('emisor de Ferretería con las 6 claves de emisor_config', array_keys($fixture['emisor']) === [
    'rnc', 'razon_social', 'nombre_comercial', 'direccion', 'telefono', 'correo',
]);
$logo = __DIR__ . '/fixtures/ferreteria_logo.jpeg';
$infoLogo = is_file($logo) ? getimagesize($logo) : false;
$chk('ferreteria_logo.jpeg: el JPEG de 330×360 del Excel (xl/media/image1.jpeg)',
    $infoLogo !== false && $infoLogo['mime'] === 'image/jpeg' && $infoLogo[0] === 330 && $infoLogo[1] === 360);

echo "\n== Redondeo (copia de montosLinea.redondear) ==\n";
// Esperados de redondear() en fiscalo (corrido con node), que es lo que da
// PHP 8.3 en producción. Los de x.xx5 son los que el binario deja justo por
// debajo de la mitad.
$fijos = [
    ['84.75 × 0.18', 84.75 * 0.18, 2, 15.26],
    ['-84.75 × 0.18', -84.75 * 0.18, 2, -15.26],
    ['1.005', 1.005, 2, 1.01],
    ['-1.005', -1.005, 2, -1.01],
    ['2.675', 2.675, 2, 2.68],
    ['1.255', 1.255, 2, 1.26],
    ['0.285', 0.285, 2, 0.29],
    ['8.345', 8.345, 2, 8.35],
    ['5.015', 5.015, 2, 5.02],
    ['1.125', 1.125, 2, 1.13],
    ['13.70 × 0.18', 13.70 * 0.18, 2, 2.47],
    ['13.70 × 0.05', 13.70 * 0.05, 2, 0.69],
    ['41860 × 0.05', 41860 * 0.05, 2, 2093.0],
    ['16.17 - 0.69', 16.17 - 0.69, 2, 15.48],
    ['0.1 + 0.2', 0.1 + 0.2, 2, 0.3],
    ['1234567.125', 1234567.125, 2, 1234567.13],
    ['0', 0.0, 2, 0.0],
    ['84.74575', 84.74575, 4, 84.7458],
    ['1.00005', 1.00005, 4, 1.0001],
    ['100 / 1.18', 100 / 1.18, 4, 84.7458],
    ['2360 / 1.18', 2360 / 1.18, 4, 2000.0],
    ['2.5', 2.5, 0, 3.0],
    ['-2.5', -2.5, 0, -3.0],
];
foreach ($fijos as [$desc, $x, $dec, $esperado]) {
    $r = Redondeo::r($x, $dec);
    $chk(sprintf('r(%s, %d) = %s (dio %s)', $desc, $dec, var_export($esperado, true), var_export($r, true)), $r === $esperado);
}
$chk('r2(x) = r(x, 2)', Redondeo::r2(84.75 * 0.18) === 15.26);
$chk('r4(x) = r(x, 4)', Redondeo::r4(100 / 1.18) === 84.7458);
$chk('devuelve float también cuando el resultado es entero', is_float(Redondeo::r2(41860 * 0.05)));
printf("     (PHP %s: round(84.75 * 0.18, 2) a secas da %s; Redondeo::r2 da %s)\n",
    PHP_VERSION, var_export(round(84.75 * 0.18, 2), true), var_export(Redondeo::r2(84.75 * 0.18), true));

// Barrido contra montosLinea.redondear portado operación por operación, con
// Math.round como floor(v + 0.5) (v >= 0) en vez del round() de PHP: si un
// round() de otra versión se cuela en Redondeo, aquí no cuadra.
$redondearJs = static function (float $x, int $dec): float {
    $f = 10 ** $dec;                                // const f = 10 ** dec
    $v = (float) sprintf('%.14e', abs($x) * $f);    // Number((Math.abs(x) * f).toPrecision(15))
    $signo = $x > 0 ? 1 : ($x < 0 ? -1 : 0);        // Math.sign(x)
    return ($signo * floor($v + 0.5)) / $f;         // (Math.sign(x) * Math.round(v)) / f
};
$barridos = 0;
$distintos = [];
$roundDistinto = 0;
$comparar = function (float $x, int $dec) use ($redondearJs, &$barridos, &$distintos, &$roundDistinto) {
    $barridos++;
    $r = Redondeo::r($x, $dec);
    if ($r !== $redondearJs($x, $dec) && count($distintos) < 5) {
        $distintos[] = sprintf('r(%.17g, %d) = %.17g, montosLinea = %.17g', $x, $dec, $r, $redondearJs($x, $dec));
    }
    if (round($x, $dec) !== $r) {
        $roundDistinto++;
    }
};
for ($c = 1; $c <= 100000; $c++) {           // cada centavo de 0.01 a 1,000.00…
    $monto = $c / 100;
    $comparar($monto * 0.18, 2);             // …por ITBIS 18%
    $comparar($monto * 0.16, 2);             // …por ITBIS 16%
    $comparar($monto * 0.05, 2);             // …por la retención del 5%
    $comparar(-$monto * 0.18, 2);            // …y en negativo
}
for ($k = 1; $k <= 100000; $k++) {           // precios de 4 decimales con el ITBIS sumado (factura simple)
    $comparar($k / 10000 * 1.18, 4);
}
foreach ([84.7458, 2.675, 1.005, 13.7, 999.9999, 0.0001] as $precio) {
    for ($q = 1; $q <= 1000; $q++) {         // cantidades 0.01..10.00 × precios con medio centavo
        $comparar($q / 100 * $precio, 2);
    }
}
$chk("barrido: {$barridos} valores, Redondeo = montosLinea.redondear en todos", $distintos === []);
foreach ($distintos as $d) {
    echo "     {$d}\n";
}
printf("     (en %d de esos valores round() a secas de este PHP %s da otro resultado)\n", $roundDistinto, PHP_VERSION);

// ---------------------------------------------------------------------------
// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.
// ---------------------------------------------------------------------------

printf("\n%d/%d OK\n", $total - $fallos, $total);
exit($fallos === 0 ? 0 : 1);
```

- [ ] **Step 5: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: it stops before the first check, with `exit=255`:
- `Warning: require_once(...\tools/../src/Utils/Cotizacion/Redondeo.php): Failed to open stream: No such file or directory`
- `Fatal error: Uncaught Error: Failed opening required '...src/Utils/Cotizacion/Redondeo.php'`

- [ ] **Step 6: Implement `Redondeo`**

Create `src/Utils/Cotizacion/Redondeo.php`:

```php
<?php
/**
 * Redondeo de los montos de las cotizaciones por formato, igual en cualquier
 * versión de PHP.
 *
 * round() cambió en PHP 8.4: ya no "pre-redondea" a 15 cifras, así que
 * 84.75 × 18% (15.254999… en binario) da 15.25 desde 8.4 y 15.26 en 8.3.
 * Producción corre PHP 8.3 y la pantalla (fiscalo
 * src/features/invoices/montosLinea.ts, redondear) copia ese 15.26 a
 * propósito. Con round() a secas, una prueba en un PHP local 8.4+ daría otros
 * centavos que los que guarda producción.
 *
 * COPIA EXACTA de montosLinea.redondear: sprintf('%.15g') es el
 * Number(x.toPrecision(15)) de JS, y el round() que queda trabaja sobre un
 * valor ya limpio, donde 8.3 y 8.5 coinciden. El signo va aparte (-15.255 da
 * -15.26), como Math.sign(x) * Math.round(|x|).
 *
 * Solo lo usan los formatos nuevos (src/Utils/Cotizacion/): Gratex y la
 * facturación siguen con su round() de siempre. Un cambio aquí va en
 * montosLinea.ts en el mismo cambio; tools/test_cotizacion_ferreteria.php lo
 * compara con el algoritmo de allá.
 */
final class Redondeo
{
    /** $x a $dec decimales, la mitad lejos del cero, sobre el valor DECIMAL. */
    public static function r(float $x, int $dec): float
    {
        $f = 10 ** $dec;
        $v = (float) sprintf('%.15g', abs($x) * $f);
        $r = round($v) / $f;
        return $x < 0 ? -$r : $r;
    }

    /** Montos en RD$: 2 decimales. */
    public static function r2(float $x): float
    {
        return self::r($x, 2);
    }

    /** Precios unitarios: 4 decimales, lo que admite PrecioUnitarioItem del e-CF. */
    public static function r4(float $x): float
    {
        return self::r($x, 4);
    }
}
```

- [ ] **Step 7: Run the harness and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected:
- It takes about 1 s. There are 12 `[OK  ]` lines under `== Fixtures ==`, 27 under
  `== Redondeo (copia de montosLinea.redondear) ==`, and no `[FALLA]`.
- Two informational lines read
  `     (PHP 8.5.8: round(84.75 * 0.18, 2) a secas da 15.25; Redondeo::r2 da 15.26)` and
  `     (en 1804 de esos valores round() a secas de este PHP 8.5.8 da otro resultado)`. The count differs on another PHP.
- The output ends with `39/39 OK` and `exit=0`.
- If the logo check fails, Step 2 didn't produce the 330×360 JPEG.

- [ ] **Step 8: Cross-check once against the real `montosLinea.ts` with node (nothing is committed)**

This proves the PHP copy and the JS original give bit-identical results on the 506,000 sweep values, so you don't have
to trust the port. It runs in a throw-away temp folder:

```bash
T=$(mktemp -d)
cat > "$T/cross.mjs" <<'EOF'
// Comprobación de una sola vez (no se commitea): redondear() de fiscalo sobre los mismos 506,000 valores del barrido.
import { createHash } from 'node:crypto'
import { redondear } from 'file:///C:/Users/Signos/Documents/edwin/fiscalo/src/features/invoices/montosLinea.ts'

const out = []
const push = (x, d) => out.push(redondear(x, d))
for (let c = 1; c <= 100000; c++) { const m = c / 100; push(m * 0.18, 2); push(m * 0.16, 2); push(m * 0.05, 2); push(-m * 0.18, 2) }
for (let k = 1; k <= 100000; k++) push(k / 10000 * 1.18, 4)
for (const p of [84.7458, 2.675, 1.005, 13.7, 999.9999, 0.0001]) for (let q = 1; q <= 1000; q++) push(q / 100 * p, 2)
const buf = Buffer.alloc(out.length * 8)
out.forEach((v, i) => buf.writeDoubleLE(v === 0 ? 0 : v, i * 8))   // -0 y 0 cuentan igual
console.log(out.length, createHash('md5').update(buf).digest('hex'))
EOF
cat > "$T/cross.php" <<'EOF'
<?php
// Comprobación de una sola vez (no se commitea): Redondeo::r sobre los mismos 506,000 valores, mismo hash que node.
require 'C:/Users/Signos/Documents/edwin/api-gratex/src/Utils/Cotizacion/Redondeo.php';

$out = '';
$n = 0;
$push = function (float $x, int $d) use (&$out, &$n) {
    $v = Redondeo::r($x, $d);
    $out .= pack('e', $v == 0 ? 0.0 : $v);   // double little-endian, como writeDoubleLE
    $n++;
};
for ($c = 1; $c <= 100000; $c++) { $m = $c / 100; $push($m * 0.18, 2); $push($m * 0.16, 2); $push($m * 0.05, 2); $push(-$m * 0.18, 2); }
for ($k = 1; $k <= 100000; $k++) { $push($k / 10000 * 1.18, 4); }
foreach ([84.7458, 2.675, 1.005, 13.7, 999.9999, 0.0001] as $p) { for ($q = 1; $q <= 1000; $q++) { $push($q / 100 * $p, 2); } }
echo $n, ' ', md5($out), "\n";
EOF
node "$T/cross.mjs"; php "$T/cross.php"; rm -rf "$T"
```

Expected: both lines print `506000 a1132aa0508114c2a00af20c919a90a6`. Node v25 strips the `import type` from
`montosLinea.ts` by itself.

- [ ] **Step 9: Lint the new PHP files**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Utils/Cotizacion/Redondeo.php && php -l tools/test_cotizacion_ferreteria.php
```

Expected: `No syntax errors detected in ...` twice.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add src/Utils/Cotizacion/Redondeo.php tools/test_cotizacion_ferreteria.php tools/fixtures/cotizacion_ferreteria.json tools/fixtures/ferreteria_logo.jpeg
git commit -F - <<'EOF'
feat(cotizaciones): Redondeo igual en PHP 8.3 y 8.5, arnes CLI y fixtures de Ferreteria

Redondeo::r copia montosLinea.redondear (pre-redondeo a 15 cifras): 84.75 x 18%
da 15.26 en produccion (PHP 8.3) y en local (8.5), donde round() a secas da 15.25.
tools/test_cotizacion_ferreteria.php prueba sin DB; el barrido compara 506,000
valores contra el algoritmo de montosLinea. Los fixtures traen las 3 hojas del
Excel de Ferreteria linea por linea, casos de borde y el logo del libro.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git show HEAD:tools/fixtures/cotizacion_ferreteria.json | md5sum
git log --oneline -1
```

Expected: one new commit on `feat/cotizacion-formatos` with 4 files, and the blob md5
`76da471dddcb54715fc05010df3ebe86`. T10 copies this exact blob to fiscalo `scripts/fixtures/`.

---

### Task 4: `FerreteriaFormato`, the pure static rules

**Files:**
- Create: `src/Utils/Cotizacion/FerreteriaFormato.php`, built in three TDD rounds.
  - Round A creates the file (120 lines).
  - Round B edits it at `:33-35` (constants) and `:118-120` (end of the class).
  - Round C edits the round-B file at `:33-35`, `:123-126` and `:162-164`. The finished file has 417 lines.
- Modify: `tools/test_cotizacion_ferreteria.php:169-171`, the marker block from Task 1.
  - Each round inserts its section directly above the marker, separated from it by one blank line.
  - After round A the marker is at `:249-251`, and after round B it's at `:285-287`.
  - The summary (`printf` + `exit`, `:173-174` in Task 1) stays last.
- Test: `tools/test_cotizacion_ferreteria.php`, sections `FerreteriaFormato::tasa`, `::totales (fixtures)`,
  `::errorAbono`, `::codigo / formatearRnc / fechaLarga` and `::validarForma`.

**Interfaces:**
- Consumes:
  - `Redondeo::r2` and `Redondeo::r4` (Task 1).
  - `unidadMedidaModel::decimalesDe(float $n): int` (`src/Models/unidadMedidaModel.php:133-144`; static, no DB). It's
    the same "how many decimals" criterion as the front.
  - The texts of `unidadMedidaModel::problemaCantidad` (`:106-126`). The injected test double copies them.
  - The line messages of `cotValidarItems` (`src/Controllers/cotizacionController.php:18-43`) and of
    `assertUnidadesMedida` (`src/Controllers/facturaController.php:1035-1055`), reused word for word.
  - The harness: `$chk`, `$igual` and `$casos`.
- Produces, from the contract (the instance parts arrive in Task 7):

```php
final class FerreteriaFormato /* T7 adds: extends CotizacionFormato */ {
    public const NOMBRE = 'ferreteria';
    public const AJUSTES_MONTO = ['cargos_bancarios', 'manejo_bancario', 'mano_obra', 'abono'];
    public const RETENCION = 'retencion_isr';
    public const TASA_RETENCION = 0.05;
    public const MAX_DESCRIPCION = 1000;
    public const UNIDAD_DEFAULT = '43';
    public static function tasa(int $indicador): float;              // 1=>0.18, 2=>0.16, 3,4=>0.0
    /** @return array{lineas: array<int,array{base:float,itbis:float}>, subtotal:float, itbis:float,
     *   cargos_bancarios:float, manejo_bancario:float, mano_obra:float, total:float, retencion_isr:float,
     *   adeudado:float, abono:float, restante:float, etiqueta_itbis:string, mostrar_restante:bool} */
    public static function totales(array $lineas, array $ajustes): array;
    /** null if ok, else 'El abono (RD$ X) no puede ser mayor que lo adeudado (RD$ Y).' */
    public static function errorAbono(array $totales): ?string;
    /** ['ok'=>true,'cot'=>['date'=>?string,'client_id'=>int,'items'=>[7 keys],'ajustes'=>[5 keys]]] | ['ok'=>false,'error'=>string] */
    public static function validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array;
    public static function codigo(int $numero): string;              // 'COT-' . str_pad($numero, 6, '0', STR_PAD_LEFT)
    public static function formatearRnc(?string $rnc): string;       // 9 => XXX-XXXXX-X, 11 => XXX-XXXXXXX-X, else as stored ('' for null)
    public static function fechaLarga(string $fecha): string;        // '2026-09-02 10:15:00' => 'SEPTIEMBRE 2/2026.-'
}
```

- Behavior details other tasks rely on:
  - **`totales()`** reads only `quantity`, `amount` and `indicador_facturacion` (default 1) from each line, so extra keys
    are fine. A missing ajuste key counts as 0 / false, so `totales($lineas, [])` works. Each sum adds the unrounded
    line values and applies `r2` once at the end, like `totalesDocumento` in `montosLinea.ts`.
  - **`validarForma()`** checks the client, then the date, then the items, then the ajustes, and returns the first
    error.
    - It never looks at `$body->formato`, `id`, `total`, `sent_email` or `user_id`; the controller and Task 7 handle
      those.
    - It checks `client_id > 0` and returns `'Elige un cliente para la cotización.'`. Whether the client exists is
      Task 7's DB check.
  - **`problemaCantidad` and `unidadValida`.** `problemaCantidad` is called only when quantity > 0, with the normalized
    unit (never null) and `maxDec` 2. `unidadValida` gets the normalized unit string, which is `'43'` when the unit is
    missing or empty.
  - **`fechaLarga()`** prints today in America/Santo_Domingo for an empty, zero or unreadable date, never 1969.

- [ ] **Step 1: Write round-A tests (tasa, totales on every fixture, errorAbono)**

In `tools/test_cotizacion_ferreteria.php`, insert this block directly above the marker block (line 169), followed by one
blank line:

```php
// ---------------------------------------------------------------------------
// FerreteriaFormato: reglas puras (Task 4)
// ---------------------------------------------------------------------------

require_once __DIR__ . '/../src/Utils/Cotizacion/FerreteriaFormato.php';

echo "\n== FerreteriaFormato::tasa ==\n";
$chk('1 = 18%, 2 = 16%, 3 = 0%, 4 = exento',
    FerreteriaFormato::tasa(1) === 0.18 && FerreteriaFormato::tasa(2) === 0.16
    && FerreteriaFormato::tasa(3) === 0.0 && FerreteriaFormato::tasa(4) === 0.0);

echo "\n== FerreteriaFormato::totales (fixtures) ==\n";
// Las líneas como las arma el formato tras validarForma: quantity, amount, indicador.
$lineasDe = static fn(array $caso): array => array_map(static fn(array $l): array => [
    'quantity' => (float) $l['quantity'],
    'amount' => (float) $l['amount'],
    'indicador_facturacion' => (int) $l['indicador_facturacion'],
], $caso['lineas']);
$totalesDe = static fn(array $caso): array => FerreteriaFormato::totales($lineasDe($caso), $caso['ajustes']);

foreach ($casos as $id => $caso) {
    $t = $totalesDe($caso);
    $chk("{$id}: una base y un ITBIS por línea (" . count($caso['lineas']) . ')', count($t['lineas']) === count($caso['lineas']));
    foreach ($caso['esperado'] as $clave => $esperado) {
        if ($clave === 'lineas') {
            $ok = count($t['lineas']) === count($esperado);
            foreach ($esperado as $i => $e) {
                $ok = $ok && $igual($t['lineas'][$i]['base'] ?? null, $e['base']) && $igual($t['lineas'][$i]['itbis'] ?? null, $e['itbis']);
            }
            $chk("{$id}: base e ITBIS de cada línea", $ok);
        } elseif ($clave === 'error_abono') {
            $msg = FerreteriaFormato::errorAbono($t);
            $chk("{$id}: errorAbono " . ($esperado === null ? 'null' : 'con mensaje') . ' (dio ' . var_export($msg, true) . ')',
                $esperado === null ? $msg === null : $msg !== null);
        } else {
            $obtenido = $t[$clave] ?? '(falta)';
            $ok = (is_bool($esperado) || is_string($esperado)) ? $obtenido === $esperado : $igual($obtenido, $esperado);
            $chk(sprintf('%s: %s = %s (dio %s)', $id, $clave, json_encode($esperado, JSON_UNESCAPED_UNICODE),
                json_encode($obtenido, JSON_UNESCAPED_UNICODE)), $ok);
        }
    }
}

$t = $totalesDe($casos['pintura']);
$chk('las claves de totales(), en el orden del contrato', array_keys($t) === [
    'lineas', 'subtotal', 'itbis', 'cargos_bancarios', 'manejo_bancario', 'mano_obra', 'total',
    'retencion_isr', 'adeudado', 'abono', 'restante', 'etiqueta_itbis', 'mostrar_restante',
]);
$soloMontos = array_diff_key($t, array_flip(['lineas', 'etiqueta_itbis', 'mostrar_restante']));
$chk('cada monto es float', array_filter($soloMontos, 'is_float') === $soloMontos);
$t = FerreteriaFormato::totales($lineasDe($casos['pintura']), []);
$chk('ajustes vacíos: cargos 0, sin retención, sin abono, sin Restante',
    $t['total'] === 49394.8 && $t['retencion_isr'] === 0.0 && $t['abono'] === 0.0 && $t['mostrar_restante'] === false);
$t = FerreteriaFormato::totales($lineasDe($casos['pintura']), ['retencion_isr' => true] + $casos['pintura']['ajustes']);
$chk('solo retención (sin abono): Restante 47,301.80 y se muestra', $t['restante'] === 47301.8 && $t['mostrar_restante'] === true);
$t = FerreteriaFormato::totales([
    ['quantity' => 1.0, 'amount' => 100.0, 'indicador_facturacion' => 1],
    ['quantity' => 1.0, 'amount' => 0.02, 'indicador_facturacion' => 2],   // 16% de 0.02 = 0.0032 -> 0.00
], []);
$chk('una línea al 16% cuyo ITBIS redondea a 0 no quita el "ITBIS 18%"', $t['etiqueta_itbis'] === 'ITBIS 18%' && $t['itbis'] === 18.0);
$t = FerreteriaFormato::totales([['quantity' => 3.0, 'amount' => 84.7458, 'indicador_facturacion' => 1]], []);
$chk('3 × 84.7458 = 254.24 (precio de 4 decimales, base a 2)', $t['subtotal'] === 254.24 && $t['itbis'] === 45.76);
$t = FerreteriaFormato::totales([['quantity' => 1.005, 'amount' => 100.0, 'indicador_facturacion' => 1]], []);
$chk('la cantidad se lleva a 2 decimales antes de multiplicar (1.005 -> 1.01)', $t['subtotal'] === 101.0);

echo "\n== FerreteriaFormato::errorAbono ==\n";
$conAbono = static fn(float $abono, bool $retencion = false): array => FerreteriaFormato::totales(
    $lineasDe($casos['pintura']),
    ['abono' => $abono, 'retencion_isr' => $retencion] + $casos['pintura']['ajustes']
);
$chk('abono igual a lo adeudado (49,394.80): sin error', FerreteriaFormato::errorAbono($conAbono(49394.8)) === null);
$msg = FerreteriaFormato::errorAbono($conAbono(50000));
$chk('abono 50,000.00 sobre 49,394.80: "' . $msg . '"',
    $msg === 'El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80).');
$chk('un centavo de más ya es error (49,394.81)', FerreteriaFormato::errorAbono($conAbono(49394.81)) !== null);
$msg = FerreteriaFormato::errorAbono($conAbono(47301.81, true));
$chk('con retención lo adeudado es TOTAL − retención (47,301.80)',
    $msg === 'El abono (RD$ 47,301.81) no puede ser mayor que lo adeudado (RD$ 47,301.80).'
    && FerreteriaFormato::errorAbono($conAbono(47301.8, true)) === null);
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: the 39 Task 1 checks pass, then the script stops with `exit=255`:
- `Warning: require_once(...\tools/../src/Utils/Cotizacion/FerreteriaFormato.php): Failed to open stream: No such file or directory`
- `Fatal error: Uncaught Error: Failed opening required '...src/Utils/Cotizacion/FerreteriaFormato.php'`

- [ ] **Step 3: Create the class with the round-A rules**

Create `src/Utils/Cotizacion/FerreteriaFormato.php`:

```php
<?php
require_once __DIR__ . '/Redondeo.php';
require_once __DIR__ . '/../../Models/unidadMedidaModel.php';

/**
 * Formato de cotización de Ferretería (FERREHERRAMIENTAS VENTURA, SRL): su
 * hoja de Excel "COTIZACION MERCANCIAS", con líneas del catálogo, cargos sin
 * ITBIS, retención y abono.
 *
 * Las funciones estáticas son las reglas puras: la forma del cuerpo, los
 * totales, el número y los textos del PDF. No tocan la base de datos, para que
 * tools/test_cotizacion_ferreteria.php las pruebe por CLI. Lo que necesita la
 * DB (que el cliente y los productos existan, guardar, el PDF) va en los
 * métodos de instancia.
 *
 * Todo monto se redondea con Redondeo (la copia de montosLinea.redondear), no
 * con round(): la pantalla calcula lo mismo con totalesFerreteria() (fiscalo
 * src/features/cotizaciones/formatos/ferreteria/totales.ts) y tiene que dar
 * igual al centavo. Un cambio de regla va en los dos lados en el mismo cambio.
 */
final class FerreteriaFormato
{
    public const NOMBRE = 'ferreteria';
    /** Ajustes con monto que acepta este formato (cotizacion_ajustes.concepto). */
    public const AJUSTES_MONTO = ['cargos_bancarios', 'manejo_bancario', 'mano_obra', 'abono'];
    /** La retención llega como casilla (bool) y se guarda como monto. */
    public const RETENCION = 'retencion_isr';
    /** Retención Renta por Tercero: 5% del Sub-total, el monto antes del ITBIS. */
    public const TASA_RETENCION = 0.05;
    /** Tope de la descripción de una línea: así una fila siempre cabe en una página del PDF. */
    public const MAX_DESCRIPCION = 1000;
    /** Código DGII de "Unidad" (id del catálogo de master): el de una línea sin unidad. */
    public const UNIDAD_DEFAULT = '43';

    /** Tasa de ITBIS según indicador_facturacion: 1 = 18%, 2 = 16%, 3 y 4 = 0%. Igual que itbisRate del front. */
    public static function tasa(int $indicador): float
    {
        return $indicador === 1 ? 0.18 : ($indicador === 2 ? 0.16 : 0.0);
    }

    /**
     * Totales de la cotización (spec 6.2), con las reglas de línea del e-CF:
     * base = r2(r2(cantidad) × r4(precio sin ITBIS)) e ITBIS por línea sobre
     * esa base. Sin descuento: el fijo del cliente lo aplica la factura al
     * convertir, no la cotización.
     *
     * Las sumas se redondean al final, como totalesDocumento del front. Los
     * cargos y la mano de obra van después del ITBIS y no lo llevan; la
     * retención y el abono no cambian el TOTAL, solo lo que queda por pagar.
     *
     * @param array<int,array{quantity:float,amount:float,indicador_facturacion:int}> $lineas
     * @param array{cargos_bancarios:float,manejo_bancario:float,mano_obra:float,abono:float,retencion_isr:bool} $ajustes
     */
    public static function totales(array $lineas, array $ajustes): array
    {
        $porLinea = [];
        $sumaBase = 0.0;
        $sumaItbis = 0.0;
        $gravadas = 0;
        $todasAl18 = true;
        foreach (array_values($lineas) as $l) {
            $indicador = (int) ($l['indicador_facturacion'] ?? 1);
            $base = Redondeo::r2(Redondeo::r2((float) $l['quantity']) * Redondeo::r4((float) $l['amount']));
            $itbis = Redondeo::r2($base * self::tasa($indicador));
            $porLinea[] = ['base' => $base, 'itbis' => $itbis];
            $sumaBase += $base;
            $sumaItbis += $itbis;
            if ($itbis > 0) {
                $gravadas++;
                $todasAl18 = $todasAl18 && $indicador === 1;
            }
        }
        $subtotal = Redondeo::r2($sumaBase);
        $itbis = Redondeo::r2($sumaItbis);
        $cargos = Redondeo::r2((float) ($ajustes['cargos_bancarios'] ?? 0));
        $manejo = Redondeo::r2((float) ($ajustes['manejo_bancario'] ?? 0));
        $manoObra = Redondeo::r2((float) ($ajustes['mano_obra'] ?? 0));
        $total = Redondeo::r2($subtotal + $itbis + $cargos + $manejo + $manoObra);
        $retencion = !empty($ajustes[self::RETENCION]) ? Redondeo::r2($subtotal * self::TASA_RETENCION) : 0.0;
        $adeudado = Redondeo::r2($total - $retencion);
        $abono = Redondeo::r2((float) ($ajustes['abono'] ?? 0));
        return [
            'lineas' => $porLinea,
            'subtotal' => $subtotal,
            'itbis' => $itbis,
            'cargos_bancarios' => $cargos,
            'manejo_bancario' => $manejo,
            'mano_obra' => $manoObra,
            'total' => $total,
            'retencion_isr' => $retencion,
            'adeudado' => $adeudado,
            'abono' => $abono,
            'restante' => Redondeo::r2($adeudado - $abono),
            // "ITBIS 18%" solo si todo lo que lleva ITBIS va al 18%: con una
            // línea al 16%, o sin nada gravado, el rótulo no puede prometer una tasa.
            'etiqueta_itbis' => $gravadas > 0 && $todasAl18 ? 'ITBIS 18%' : 'ITBIS',
            // Restante (Adeudado) solo dice algo distinto del TOTAL si hubo
            // retención o abono; si no, la hoja lo deja en blanco.
            'mostrar_restante' => $retencion > 0 || $abono > 0,
        ];
    }

    /**
     * El abono no puede pasar de lo adeudado (TOTAL − retención). Se comparan
     * los montos ya redondeados de totales(): 15.48 contra 16.17 − 0.69 cuadra
     * justo y no da error por un resto binario.
     *
     * @return string|null el mensaje para el usuario, o null si está bien
     */
    public static function errorAbono(array $totales): ?string
    {
        $abono = (float) ($totales['abono'] ?? 0);
        $adeudado = (float) ($totales['adeudado'] ?? 0);
        if ($abono <= $adeudado) {
            return null;
        }
        return 'El abono (RD$ ' . number_format($abono, 2) . ') no puede ser mayor que lo adeudado (RD$ '
            . number_format($adeudado, 2) . ').';
    }
}
```

- [ ] **Step 4: Run and watch round A pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: no `[FALLA]`, then `159/159 OK` and `exit=0`. Among the lines:
- `pintura: total = 49394.8 (dio 49394.8)`
- `b150000049: itbis = 4910.04 (dio 4910.04)`
- `redondeo_8475: itbis = 15.26 (dio 15.26)`
- `flotante: errorAbono null (dio NULL)`
- `abono 50,000.00 sobre 49,394.80: "El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80)."`

If another task's section is already in the file, the totals are higher, but they must still read N/N.

- [ ] **Step 5: Write round-B tests (codigo, formatearRnc, fechaLarga)**

Insert this block directly above the marker block (now at line 249), followed by one blank line:

```php
echo "\n== FerreteriaFormato::codigo / formatearRnc / fechaLarga ==\n";
$chk('codigo(1) = COT-000001', FerreteriaFormato::codigo(1) === 'COT-000001');
$chk('codigo(123) = COT-000123', FerreteriaFormato::codigo(123) === 'COT-000123');
$chk('codigo(999999) = COT-999999', FerreteriaFormato::codigo(999999) === 'COT-999999');
$chk('codigo(1234567) = COT-1234567 (no se corta)', FerreteriaFormato::codigo(1234567) === 'COT-1234567');
foreach ([
    ['401515131', '401-51513-1'],
    ['132615123', '132-61512-3'],
    ['401-51513-1', '401-51513-1'],
    [' 401515131 ', '401-51513-1'],
    ['00112345678', '001-1234567-8'],
    ['001-1234567-8', '001-1234567-8'],
    ['AB123456', 'AB123456'],
    ['12345', '12345'],
    ['', ''],
    [null, ''],
] as [$rnc, $esperado]) {
    $chk(sprintf('formatearRnc(%s) = %s', var_export($rnc, true), var_export($esperado, true)), FerreteriaFormato::formatearRnc($rnc) === $esperado);
}
foreach ([
    ['2026-09-02 10:15:00', 'SEPTIEMBRE 2/2026.-'],
    ['2026-05-14 09:00:00', 'MAYO 14/2026.-'],
    ['2026-01-31', 'ENERO 31/2026.-'],
    ['2026-12-01 00:00:00', 'DICIEMBRE 1/2026.-'],
] as [$fecha, $esperado]) {
    $chk("fechaLarga('{$fecha}') = '{$esperado}'", FerreteriaFormato::fechaLarga($fecha) === $esperado);
}
$hoyRd = static function (): string {
    $d = new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo'));
    $meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    return $meses[(int) $d->format('n') - 1] . ' ' . $d->format('j') . '/' . $d->format('Y') . '.-';
};
foreach (['', '0000-00-00 00:00:00', 'basura', '2026-02-30'] as $fecha) {
    $chk("fechaLarga('{$fecha}') = hoy en RD, nunca 1969", FerreteriaFormato::fechaLarga($fecha) === $hoyRd());
}
```

- [ ] **Step 6: Run them and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: the earlier sections pass, then `Fatal error: Uncaught Error: Call to undefined method FerreteriaFormato::codigo()`
and `exit=255`.

- [ ] **Step 7: Add the month names, `codigo`, `formatearRnc` and `fechaLarga`**

Make two edits to `src/Utils/Cotizacion/FerreteriaFormato.php`.

Edit 1 (lines 33-35). Replace this exact text:

```php
    public const UNIDAD_DEFAULT = '43';

    /** Tasa de ITBIS según indicador_facturacion: 1 = 18%, 2 = 16%, 3 y 4 = 0%. Igual que itbisRate del front. */
```

with:

```php
    public const UNIDAD_DEFAULT = '43';

    private const MESES = [
        'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    ];

    /** Tasa de ITBIS según indicador_facturacion: 1 = 18%, 2 = 16%, 3 y 4 = 0%. Igual que itbisRate del front. */
```

Edit 2 (lines 118-120, the end of `errorAbono` and of the class). Replace:

```php
            . number_format($adeudado, 2) . ').';
    }
}
```

with:

```php
            . number_format($adeudado, 2) . ').';
    }

    /** 'COT-000123': el número de la secuencia del tenant, a 6 cifras. */
    public static function codigo(int $numero): string
    {
        return 'COT-' . str_pad((string) $numero, 6, '0', STR_PAD_LEFT);
    }

    /**
     * RNC (9 dígitos: 401-51513-1) o cédula (11: 001-1234567-8) con guiones,
     * contando solo los dígitos. Cualquier otra cosa (pasaporte, vacío) se
     * imprime tal como está guardada.
     */
    public static function formatearRnc(?string $rnc): string
    {
        $tal = trim((string) $rnc);
        $d = (string) preg_replace('/\D/', '', $tal);
        if (strlen($d) === 9) {
            return substr($d, 0, 3) . '-' . substr($d, 3, 5) . '-' . substr($d, 8, 1);
        }
        if (strlen($d) === 11) {
            return substr($d, 0, 3) . '-' . substr($d, 3, 7) . '-' . substr($d, 10, 1);
        }
        return $tal;
    }

    /**
     * La fecha como la escribe la hoja: 'SEPTIEMBRE 2/2026.-'. Vacía, en ceros
     * o ilegible se usa hoy en hora de RD (la app no fija zona horaria), nunca
     * el 31/12/1969 de un strtotime fallido.
     */
    public static function fechaLarga(string $fecha): string
    {
        $ymd = substr(trim($fecha), 0, 10);
        $dia = DateTimeImmutable::createFromFormat('!Y-m-d', $ymd);
        if ($dia === false || $dia->format('Y-m-d') !== $ymd) {
            $dia = new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo'));
        }
        return self::MESES[(int) $dia->format('n') - 1] . ' ' . $dia->format('j') . '/' . $dia->format('Y') . '.-';
    }
}
```

- [ ] **Step 8: Run and watch round B pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: no `[FALLA]`, then `181/181 OK` and `exit=0`. The lines include:
- `codigo(1) = COT-000001`
- `formatearRnc('401515131') = '401-51513-1'`
- `fechaLarga('2026-09-02 10:15:00') = 'SEPTIEMBRE 2/2026.-'`

- [ ] **Step 9: Write round-C tests (validarForma: the happy path, the normalization and every 422 rule)**

Insert this block directly above the marker block (now at line 285), followed by one blank line.

The quantity rule is injected as `$problemaCantidadFx`. It copies `unidadMedidaModel::problemaCantidad` over a 3-unit
fixture catalog and records its calls:
- `43` Unidad is integer-only.
- `26` Metro and `21` Kilogramo take decimals.

```php
echo "\n== FerreteriaFormato::validarForma ==\n";
require_once __DIR__ . '/../src/Models/unidadMedidaModel.php';   // solo decimalesDe (estático, sin DB)
// Catálogo de unidades de prueba: [código DGII => [descripción, admite decimales]].
$unidadesFx = ['43' => ['Unidad', false], '26' => ['Metro', true], '21' => ['Kilogramo', true]];
$llamadasCantidad = [];
// Mismas reglas y textos que unidadMedidaModel::problemaCantidad, con el catálogo de arriba en vez de master.
$problemaCantidadFx = function (float $cantidad, string $unidad, int $maxDec) use ($unidadesFx, &$llamadasCantidad): ?string {
    $llamadasCantidad[] = [$cantidad, $unidad, $maxDec];
    if (!($cantidad > 0) || !(round($cantidad, $maxDec) > 0)) {
        return 'La cantidad debe ser mayor que 0.';
    }
    $dec = unidadMedidaModel::decimalesDe($cantidad);
    if ($dec === 0) {
        return null;
    }
    [$nombre, $permite] = $unidadesFx[$unidad] ?? ['', true];
    if (!$permite) {
        return 'La unidad «' . ($nombre !== '' ? $nombre : 'Unidad') . '» no admite fracciones: usa una cantidad entera o cambia la unidad.';
    }
    if ($dec > $maxDec) {
        return 'La cantidad admite hasta ' . $maxDec . ' decimales.';
    }
    return null;
};
$unidadValidaFx = static fn(string $unidad): bool => isset($unidadesFx[$unidad]);

// El ejemplo de la spec (6.5): una línea de producto y una libre sin unidad ni indicadores.
$ejemplo = <<<'JSON'
{ "formato": "ferreteria", "client_id": 123, "date": "2026-09-02 10:15:00",
  "items": [
    { "product_id": 55, "description": "FUNDAS CEMENTO GRIS", "quantity": 2, "amount": 935,
      "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1 },
    { "product_id": null, "description": "  CORTE DE TUBO ", "quantity": 1, "amount": 150 }
  ],
  "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 1500, "abono": 0, "retencion_isr": false } }
JSON;
// Cada prueba parte de una copia nueva del ejemplo, decodificada como en el
// controller (objetos, no arreglos), y le cambia una sola cosa.
$cuerpo = static function (?callable $cambiar = null) use ($ejemplo): object {
    $b = json_decode($ejemplo);
    if ($cambiar !== null) {
        $cambiar($b);
    }
    return $b;
};
$validar = static fn(object $b): array => FerreteriaFormato::validarForma($b, $problemaCantidadFx, $unidadValidaFx);
$rechaza = function (string $desc, object $b, string $mensaje) use ($validar, $chk) {
    $r = $validar($b);
    $ok = ($r['ok'] ?? null) === false && ($r['error'] ?? null) === $mensaje;
    $chk($desc . ' -> "' . $mensaje . '"' . ($ok ? '' : ' (dio ' . json_encode($r, JSON_UNESCAPED_UNICODE) . ')'), $ok);
};

$llamadasCantidad = [];
$r = $validar($cuerpo());
$chk('el ejemplo de la spec pasa', ($r['ok'] ?? null) === true);
$cot = $r['cot'] ?? [];
$chk('cot trae date, client_id, items y ajustes, en ese orden', array_keys($cot) === ['date', 'client_id', 'items', 'ajustes']);
$chk('client_id 123 y la fecha tal cual', ($cot['client_id'] ?? null) === 123 && ($cot['date'] ?? null) === '2026-09-02 10:15:00');
$chk('línea de producto normalizada', ($cot['items'][0] ?? null) === [
    'product_id' => 55, 'description' => 'FUNDAS CEMENTO GRIS', 'quantity' => 2.0, 'amount' => 935.0,
    'unidad_medida' => '43', 'indicador_facturacion' => 1, 'indicador_bien_servicio' => 1,
]);
$chk("línea libre: sin producto, descripción recortada, unidad '43', indicador 1, bien", ($cot['items'][1] ?? null) === [
    'product_id' => null, 'description' => 'CORTE DE TUBO', 'quantity' => 1.0, 'amount' => 150.0,
    'unidad_medida' => '43', 'indicador_facturacion' => 1, 'indicador_bien_servicio' => 1,
]);
$chk('ajustes: los 4 montos como float y la casilla como bool', ($cot['ajustes'] ?? null) === [
    'cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 1500.0, 'abono' => 0.0, 'retencion_isr' => false,
]);
$chk("problemaCantidad recibe la unidad normalizada ('43', nunca null) y 2 decimales",
    $llamadasCantidad === [[2.0, '43', 2], [1.0, '43', 2]]);
$t = FerreteriaFormato::totales($cot['items'] ?? [], $cot['ajustes'] ?? []);
$chk('lo validado entra directo a totales(): 2,020.00 + 363.60 + mano de obra 1,500.00 = 3,883.60',
    $t['subtotal'] === 2020.0 && $t['itbis'] === 363.6 && $t['total'] === 3883.6);

$r = $validar($cuerpo(function (object $b) { unset($b->ajustes); }));
$chk('sin ajustes = ninguno (montos 0, sin retención)', ($r['cot']['ajustes'] ?? null) === [
    'cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 0.0, 'abono' => 0.0, 'retencion_isr' => false,
]);
$r = $validar($cuerpo(function (object $b) { $b->ajustes = (object) ['retencion_isr' => true, 'abono' => 10.5, 'mano_obra' => null]; }));
$chk('retención marcada, abono 10.50 y un monto vacío (null = 0)', ($r['cot']['ajustes'] ?? null) === [
    'cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 0.0, 'abono' => 10.5, 'retencion_isr' => true,
]);
$r = $validar($cuerpo(function (object $b) { unset($b->date); }));
$chk('sin fecha: date null (POST = ahora, PUT = la guardada)', ($r['ok'] ?? null) === true && $r['cot']['date'] === null);
$r = $validar($cuerpo(function (object $b) { $b->date = ''; }));
$chk('fecha vacía: date null', ($r['ok'] ?? null) === true && $r['cot']['date'] === null);
$antes = (new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo')))->format('H:i');
$r = $validar($cuerpo(function (object $b) { $b->date = '2026-09-02'; }));
$despues = (new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo')))->format('H:i');
$fecha = (string) ($r['cot']['date'] ?? '');
$chk("solo el día: se le pone la hora de ahora en RD ({$fecha})",
    preg_match('/^2026-09-02 \d{2}:\d{2}:\d{2}$/', $fecha) === 1 && in_array(substr($fecha, 11, 5), [$antes, $despues], true));
$r = $validar($cuerpo(function (object $b) { $b->items[0]->unidad_medida = 43; $b->items[1]->unidad_medida = '026'; $b->items[1]->quantity = 1.5; }));
$chk("unidad 43 (número) -> '43'; '026' -> '26' y 1.5 m pasa",
    ($r['ok'] ?? null) === true && $r['cot']['items'][0]['unidad_medida'] === '43'
    && $r['cot']['items'][1]['unidad_medida'] === '26' && $r['cot']['items'][1]['quantity'] === 1.5);
$r = $validar($cuerpo(function (object $b) { $b->items[0]->unidad_medida = ''; $b->items[0]->indicador_facturacion = '2'; }));
$chk("unidad '' -> '43'; indicador \"2\" -> 2", ($r['ok'] ?? null) === true
    && $r['cot']['items'][0]['unidad_medida'] === '43' && $r['cot']['items'][0]['indicador_facturacion'] === 2);
$r = $validar($cuerpo(function (object $b) { $b->items[1]->description = str_repeat('Ñ', 1000); $b->items[1]->amount = 84.7458; }));
$chk('descripción de 1000 caracteres (multibyte) y precio de 4 decimales pasan', ($r['ok'] ?? null) === true);
$r = $validar($cuerpo(function (object $b) { $b->formato = 'gratex'; $b->total = 1; $b->sent_email = true; $b->user_id = 9; }));
$chk('formato, total, sent_email y user_id del cuerpo no son asunto de validarForma', ($r['ok'] ?? null) === true);

// --- cada regla 422 ---
$rechaza('sin client_id', $cuerpo(function (object $b) { unset($b->client_id); }), 'Elige un cliente para la cotización.');
$rechaza('client_id 0', $cuerpo(function (object $b) { $b->client_id = 0; }), 'Elige un cliente para la cotización.');
$rechaza('client_id "abc"', $cuerpo(function (object $b) { $b->client_id = 'abc'; }), 'Elige un cliente para la cotización.');
$rechaza('fecha 2026-02-30', $cuerpo(function (object $b) { $b->date = '2026-02-30'; }), 'La fecha no es válida.');
$rechaza('fecha 2026-13-01 10:00:00', $cuerpo(function (object $b) { $b->date = '2026-13-01 10:00:00'; }), 'La fecha no es válida.');
$rechaza('fecha 2026-09-02 25:00:00', $cuerpo(function (object $b) { $b->date = '2026-09-02 25:00:00'; }), 'La fecha no es válida.');
$rechaza('fecha 02/09/2026', $cuerpo(function (object $b) { $b->date = '02/09/2026'; }), 'La fecha no es válida.');
$rechaza('fecha numérica', $cuerpo(function (object $b) { $b->date = 20260902; }), 'La fecha no es válida.');
$rechaza('items vacío', $cuerpo(function (object $b) { $b->items = []; }), 'Agrega al menos una línea a la cotización.');
$rechaza('sin items', $cuerpo(function (object $b) { unset($b->items); }), 'Agrega al menos una línea a la cotización.');
$rechaza('una línea que no es objeto', $cuerpo(function (object $b) { $b->items[0] = 'FUNDAS'; }),
    'La línea 1 no es válida. Quítala y vuelve a agregarla.');
$rechaza('descripción en blanco (línea 2)', $cuerpo(function (object $b) { $b->items[1]->description = '   '; }),
    'La línea 2 no tiene descripción. Escríbela o quita esa línea.');
$rechaza('sin descripción', $cuerpo(function (object $b) { unset($b->items[0]->description); }),
    'La línea 1 no tiene descripción. Escríbela o quita esa línea.');
$rechaza('descripción de 1001 caracteres', $cuerpo(function (object $b) { $b->items[0]->description = str_repeat('Ñ', 1001); }),
    'La descripción de la línea 1 es muy larga: admite hasta 1000 caracteres.');
$rechaza('unidad que no está en el catálogo', $cuerpo(function (object $b) { $b->items[0]->unidad_medida = '999'; }),
    'La unidad de medida de la línea 1 no es válida. Elige otra unidad en esa línea.');
$rechaza('unidad "abc"', $cuerpo(function (object $b) { $b->items[0]->unidad_medida = 'abc'; }),
    'La unidad de medida de la línea 1 no es válida. Elige otra unidad en esa línea.');
$rechaza('cantidad 0', $cuerpo(function (object $b) { $b->items[0]->quantity = 0; }), 'Línea 1: la cantidad debe ser mayor que 0.');
$rechaza('cantidad negativa', $cuerpo(function (object $b) { $b->items[0]->quantity = -2; }), 'Línea 1: la cantidad debe ser mayor que 0.');
$rechaza('sin cantidad', $cuerpo(function (object $b) { unset($b->items[1]->quantity); }), 'Línea 2: la cantidad debe ser mayor que 0.');
$rechaza('cantidad "dos"', $cuerpo(function (object $b) { $b->items[0]->quantity = 'dos'; }), 'Línea 1: la cantidad debe ser mayor que 0.');
$rechaza('1.5 en Unidad (problemaCantidad inyectado)', $cuerpo(function (object $b) { $b->items[0]->quantity = 1.5; }),
    'Línea 1: la unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.');
$rechaza('1.5 sin unidad: se juzga como Unidad (43)', $cuerpo(function (object $b) { $b->items[1]->quantity = 1.5; }),
    'Línea 2: la unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.');
$rechaza('1.125 m (3 decimales)', $cuerpo(function (object $b) { $b->items[0]->unidad_medida = '26'; $b->items[0]->quantity = 1.125; }),
    'Línea 1: la cantidad admite hasta 2 decimales.');
$rechaza('precio 0', $cuerpo(function (object $b) { $b->items[0]->amount = 0; }), 'Línea 1: el precio debe ser mayor que 0.');
$rechaza('precio negativo', $cuerpo(function (object $b) { $b->items[0]->amount = -935; }), 'Línea 1: el precio debe ser mayor que 0.');
$rechaza('precio con 5 decimales', $cuerpo(function (object $b) { $b->items[0]->amount = 84.74581; }), 'Línea 1: el precio admite hasta 4 decimales.');
$rechaza('precio "caro"', $cuerpo(function (object $b) { $b->items[0]->amount = 'caro'; }), 'El precio de la línea 1 no es válido. Revísalo.');
$rechaza('sin precio', $cuerpo(function (object $b) { unset($b->items[1]->amount); }), 'El precio de la línea 2 no es válido. Revísalo.');
foreach ([5, 0, 1.5, 'x', true] as $malo) {
    $rechaza('indicador_facturacion ' . var_export($malo, true), $cuerpo(function (object $b) use ($malo) { $b->items[0]->indicador_facturacion = $malo; }),
        'Línea 1: el tipo de ITBIS no es válido. Elige 18%, 16%, 0% o exento.');
}
$rechaza('indicador_bien_servicio 3', $cuerpo(function (object $b) { $b->items[0]->indicador_bien_servicio = 3; }),
    'Línea 1: elige si es un bien o un servicio.');
$rechaza('product_id "x"', $cuerpo(function (object $b) { $b->items[0]->product_id = 'x'; }),
    'Línea 1: el producto no es válido. Búscalo de nuevo o déjala como línea libre.');
$rechaza('product_id -3', $cuerpo(function (object $b) { $b->items[0]->product_id = -3; }),
    'Línea 1: el producto no es válido. Búscalo de nuevo o déjala como línea libre.');
$rechaza('ajustes que no son objeto', $cuerpo(function (object $b) { $b->ajustes = 'mucho'; }),
    'Los cargos y abonos de la cotización no son válidos. Revísalos.');
$rechaza('concepto desconocido', $cuerpo(function (object $b) { $b->ajustes->descuento = 10; }),
    'Los cargos y abonos traen un concepto que este formato no conoce («descuento»).');
$rechaza('mano de obra negativa', $cuerpo(function (object $b) { $b->ajustes->mano_obra = -1; }),
    '«Costo mano de obra» no puede ser negativo.');
$rechaza('abono con 3 decimales', $cuerpo(function (object $b) { $b->ajustes->abono = 10.555; }),
    '«Abono realizado» admite hasta 2 decimales.');
$rechaza('cargos bancarios "mucho"', $cuerpo(function (object $b) { $b->ajustes->cargos_bancarios = 'mucho'; }),
    '«Cargos bancarios» no es un monto válido. Revísalo.');
$rechaza('manejo bancario con 3 decimales', $cuerpo(function (object $b) { $b->ajustes->manejo_bancario = 0.001; }),
    '«Manejos de operaciones bancarias» admite hasta 2 decimales.');
foreach ([1, 'true', null, 0] as $malo) {
    $rechaza('retencion_isr ' . var_export($malo, true), $cuerpo(function (object $b) use ($malo) { $b->ajustes->retencion_isr = $malo; }),
        'La casilla «Retención Renta por Tercero 5%» no es válida: tiene que ser sí o no.');
}
```

- [ ] **Step 10: Run them and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: the earlier sections pass, then
`Fatal error: Uncaught Error: Call to undefined method FerreteriaFormato::validarForma()` and `exit=255`.

- [ ] **Step 11: Add `validarForma` and its private helpers**

Make three edits to `src/Utils/Cotizacion/FerreteriaFormato.php`.

Edit 1 (lines 33-35, the constants). Replace:

```php
    public const UNIDAD_DEFAULT = '43';

    private const MESES = [
```

with:

```php
    public const UNIDAD_DEFAULT = '43';

    /** Nombre de cada ajuste en la pantalla y el PDF, para los mensajes. */
    private const ETIQUETAS_AJUSTE = [
        'cargos_bancarios' => 'Cargos bancarios',
        'manejo_bancario' => 'Manejos de operaciones bancarias',
        'mano_obra' => 'Costo mano de obra',
        'abono' => 'Abono realizado',
    ];

    private const MESES = [
```

Edit 2 (lines 123-126, between `errorAbono` and `codigo`). Replace:

```php
            . number_format($adeudado, 2) . ').';
    }

    /** 'COT-000123': el número de la secuencia del tenant, a 6 cifras. */
```

with:

```php
            . number_format($adeudado, 2) . ').';
    }

    /**
     * Forma y rangos del cuerpo de crear, actualizar y vista previa, sin DB,
     * con sus defaults ya puestos. Que el cliente y los productos existan se
     * revisa aparte, contra la DB.
     *
     * Las reglas de unidades vienen inyectadas para que el CLI las pruebe sin
     * el catálogo de master; en producción son unidadMedidaModel::problemaCantidad
     * e ::isValid (fail-open: un catálogo ilegible no bloquea la cotización).
     *
     * @param callable(float $cantidad, string $unidad, int $maxDec): ?string $problemaCantidad
     * @param callable(string $unidad): bool $unidadValida
     * @return array{ok:true, cot:array}|array{ok:false, error:string}
     */
    public static function validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array
    {
        $clientId = self::leerEntero($body->client_id ?? null);
        if ($clientId === null || $clientId <= 0) {
            return ['ok' => false, 'error' => 'Elige un cliente para la cotización.'];
        }
        $fecha = self::normalizarFecha($body->date ?? null);
        if ($fecha === false) {
            return ['ok' => false, 'error' => 'La fecha no es válida.'];
        }
        $items = $body->items ?? null;
        if (!is_array($items) || $items === []) {
            return ['ok' => false, 'error' => 'Agrega al menos una línea a la cotización.'];
        }
        $lineas = [];
        foreach (array_values($items) as $i => $item) {
            // Las líneas se numeran desde 1, como las ve el usuario en el formulario.
            $linea = self::normalizarLinea($item, $i + 1, $problemaCantidad, $unidadValida);
            if (is_string($linea)) {
                return ['ok' => false, 'error' => $linea];
            }
            $lineas[] = $linea;
        }
        $ajustes = self::normalizarAjustes($body->ajustes ?? null);
        if (is_string($ajustes)) {
            return ['ok' => false, 'error' => $ajustes];
        }
        return ['ok' => true, 'cot' => [
            'date' => $fecha,
            'client_id' => $clientId,
            'items' => $lineas,
            'ajustes' => $ajustes,
        ]];
    }

    /** 'COT-000123': el número de la secuencia del tenant, a 6 cifras. */
```

Edit 3 (lines 162-164, the end of `fechaLarga` and of the class). Replace:

```php
        return self::MESES[(int) $dia->format('n') - 1] . ' ' . $dia->format('j') . '/' . $dia->format('Y') . '.-';
    }
}
```

with:

```php
        return self::MESES[(int) $dia->format('n') - 1] . ' ' . $dia->format('j') . '/' . $dia->format('Y') . '.-';
    }

    /**
     * Una línea del cuerpo revisada y con sus defaults, o el mensaje para el
     * usuario. $n es el número de la línea como la ve el usuario.
     */
    private static function normalizarLinea(mixed $item, int $n, callable $problemaCantidad, callable $unidadValida): array|string
    {
        if (is_array($item)) {
            $item = (object) $item;
        }
        if (!is_object($item)) {
            return 'La línea ' . $n . ' no es válida. Quítala y vuelve a agregarla.';
        }

        $descripcion = is_string($item->description ?? null) ? trim($item->description) : '';
        if ($descripcion === '') {
            return 'La línea ' . $n . ' no tiene descripción. Escríbela o quita esa línea.';
        }
        if (mb_strlen($descripcion) > self::MAX_DESCRIPCION) {
            return 'La descripción de la línea ' . $n . ' es muy larga: admite hasta '
                . self::MAX_DESCRIPCION . ' caracteres.';
        }

        // Sin unidad = Unidad (43), como una línea libre. Se guarda el código
        // DGII normalizado ('043' y 43 son '43'), el mismo de factura_items, y
        // con ese se juzgan las fracciones: nunca con null, que no bloquea nada.
        $crudo = $item->unidad_medida ?? null;
        if ($crudo === null || $crudo === '') {
            $unidad = self::UNIDAD_DEFAULT;
        } else {
            $unidad = (is_int($crudo) || is_float($crudo) || is_string($crudo)) ? (string) (int) $crudo : '0';
        }
        if (!$unidadValida($unidad)) {
            return 'La unidad de medida de la línea ' . $n . ' no es válida. Elige otra unidad en esa línea.';
        }

        // Sin cantidad, o una que no es número, cuenta como 0 (mayor que 0),
        // igual que en Gratex. 2 decimales y no 3: la cotización se convierte
        // en e-CF, cuyo CantidadItem admite 2.
        $cantidad = self::leerNumero($item->quantity ?? null) ?? 0.0;
        $problema = $cantidad > 0 ? $problemaCantidad($cantidad, $unidad, 2) : 'La cantidad debe ser mayor que 0.';
        if ($problema !== null) {
            return 'Línea ' . $n . ': ' . mb_strtolower(mb_substr($problema, 0, 1)) . mb_substr($problema, 1);
        }

        // Precio SIN ITBIS, con los 4 decimales que admite PrecioUnitarioItem.
        $precio = self::leerNumero($item->amount ?? null);
        if ($precio === null) {
            return 'El precio de la línea ' . $n . ' no es válido. Revísalo.';
        }
        if (!($precio > 0)) {
            return 'Línea ' . $n . ': el precio debe ser mayor que 0.';
        }
        if (unidadMedidaModel::decimalesDe($precio) > 4) {
            return 'Línea ' . $n . ': el precio admite hasta 4 decimales.';
        }

        $indicador = ($item->indicador_facturacion ?? null) === null ? 1 : self::leerEntero($item->indicador_facturacion);
        if (!in_array($indicador, [1, 2, 3, 4], true)) {
            return 'Línea ' . $n . ': el tipo de ITBIS no es válido. Elige 18%, 16%, 0% o exento.';
        }
        // Con producto, el servidor lo reemplaza por el del catálogo; esto vale para las líneas libres.
        $bienServicio = ($item->indicador_bien_servicio ?? null) === null ? 1 : self::leerEntero($item->indicador_bien_servicio);
        if (!in_array($bienServicio, [1, 2], true)) {
            return 'Línea ' . $n . ': elige si es un bien o un servicio.';
        }
        $productId = null;
        if (($item->product_id ?? null) !== null) {
            $productId = self::leerEntero($item->product_id);
            if ($productId === null || $productId <= 0) {
                return 'Línea ' . $n . ': el producto no es válido. Búscalo de nuevo o déjala como línea libre.';
            }
        }

        return [
            'product_id' => $productId,
            'description' => $descripcion,
            'quantity' => $cantidad,
            'amount' => $precio,
            'unidad_medida' => $unidad,
            'indicador_facturacion' => $indicador,
            'indicador_bien_servicio' => $bienServicio,
        ];
    }

    /**
     * Los cuatro montos y la casilla de retención, o el mensaje para el
     * usuario. Sin ajustes = ninguno: un PUT reemplaza el set completo.
     */
    private static function normalizarAjustes(mixed $ajustes): array|string
    {
        $out = [
            'cargos_bancarios' => 0.0,
            'manejo_bancario' => 0.0,
            'mano_obra' => 0.0,
            'abono' => 0.0,
            self::RETENCION => false,
        ];
        if ($ajustes === null) {
            return $out;
        }
        if (is_object($ajustes)) {
            $ajustes = get_object_vars($ajustes);
        }
        if (!is_array($ajustes)) {
            return 'Los cargos y abonos de la cotización no son válidos. Revísalos.';
        }
        foreach ($ajustes as $clave => $valor) {
            $clave = (string) $clave;
            if ($clave === self::RETENCION) {
                // Una casilla: "0", 1 o null no se adivinan, se rechazan.
                if (!is_bool($valor)) {
                    return 'La casilla «Retención Renta por Tercero 5%» no es válida: tiene que ser sí o no.';
                }
                $out[self::RETENCION] = $valor;
                continue;
            }
            if (!in_array($clave, self::AJUSTES_MONTO, true)) {
                return 'Los cargos y abonos traen un concepto que este formato no conoce («' . mb_substr($clave, 0, 40) . '»).';
            }
            if ($valor === null) {
                continue;   // campo vacío = 0
            }
            $etiqueta = self::ETIQUETAS_AJUSTE[$clave];
            $monto = self::leerNumero($valor);
            if ($monto === null) {
                return '«' . $etiqueta . '» no es un monto válido. Revísalo.';
            }
            if ($monto < 0) {
                return '«' . $etiqueta . '» no puede ser negativo.';
            }
            if (unidadMedidaModel::decimalesDe($monto) > 2) {
                return '«' . $etiqueta . '» admite hasta 2 decimales.';
            }
            $out[$clave] = $monto;
        }
        return $out;
    }

    /**
     * 'Y-m-d H:i:s' tal cual; 'Y-m-d' con la hora de ahora en RD (la app no
     * fija zona horaria y la del servidor no es la de RD); null si no vino.
     * false si no es una fecha real (2026-02-30, 25:00:00, 02/09/2026).
     */
    private static function normalizarFecha(mixed $crudo): string|false|null
    {
        if ($crudo === null || (is_string($crudo) && trim($crudo) === '')) {
            return null;
        }
        if (!is_string($crudo)) {
            return false;
        }
        $crudo = trim($crudo);
        $soloDia = preg_match('/^\d{4}-\d{2}-\d{2}$/', $crudo) === 1;
        $formato = $soloDia ? '!Y-m-d' : '!Y-m-d H:i:s';
        $dt = DateTimeImmutable::createFromFormat($formato, $crudo);
        // Ida y vuelta: createFromFormat acepta el 30 de febrero (lo pasa a
        // marzo); si al formatear no sale lo mismo, la fecha no existe. El año
        // mínimo es el de un DATETIME de MySQL.
        if ($dt === false || $dt->format(ltrim($formato, '!')) !== $crudo || (int) $dt->format('Y') < 1000) {
            return false;
        }
        if (!$soloDia) {
            return $crudo;
        }
        return $crudo . ' ' . (new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo')))->format('H:i:s');
    }

    /** Un número finito del JSON (int, float o texto numérico); null si no lo es. */
    private static function leerNumero(mixed $v): ?float
    {
        if (is_string($v)) {
            $v = trim($v);
            if (!is_numeric($v)) {
                return null;
            }
        } elseif (!is_int($v) && !is_float($v)) {
            return null;
        }
        $n = (float) $v;
        return is_finite($n) ? $n : null;
    }

    /** Un entero del JSON (5, 5.0 o "5"); null si no lo es (5.5, true, "x"). */
    private static function leerEntero(mixed $v): ?int
    {
        if (is_int($v)) {
            return $v;
        }
        if (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) < 1e15) {
            return (int) $v;
        }
        if (is_string($v) && preg_match('/^\s*-?\d{1,15}\s*$/', $v) === 1) {
            return (int) trim($v);
        }
        return null;
    }
}
```

- [ ] **Step 12: Run and watch everything pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
wc -l src/Utils/Cotizacion/FerreteriaFormato.php
md5sum src/Utils/Cotizacion/FerreteriaFormato.php
```

Expected:
- No `[FALLA]`, then `244/244 OK` and `exit=0`.
- `417 src/Utils/Cotizacion/FerreteriaFormato.php` and md5 `85cea675342560be5e40828f3244acf6` (LF).
- The validarForma lines include:
  - `el ejemplo de la spec pasa`
  - `problemaCantidad recibe la unidad normalizada ('43', nunca null) y 2 decimales`
  - `solo el día: se le pone la hora de ahora en RD (2026-09-02 HH:MM:SS)`
  - one `-> "<mensaje>"` line per 422 rule, ending with the 4 `retencion_isr` cases

- [ ] **Step 13: Lint, and check the working tree**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Utils/Cotizacion/FerreteriaFormato.php && php -l tools/test_cotizacion_ferreteria.php
git status --short
```

Expected:
- `No syntax errors detected` twice.
- `git status --short` lists `?? src/Utils/Cotizacion/FerreteriaFormato.php` and ` M tools/test_cotizacion_ferreteria.php`,
  plus any files other sessions left, which you don't touch.

- [ ] **Step 14: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add src/Utils/Cotizacion/FerreteriaFormato.php tools/test_cotizacion_ferreteria.php
git commit -F - <<'EOF'
feat(cotizaciones): reglas puras del formato Ferreteria (totales, validacion, numero)

FerreteriaFormato::totales, errorAbono, validarForma, codigo, formatearRnc y
fechaLarga, sin DB: el CLI las prueba contra las 3 hojas del Excel (41,860.00 /
27,278.00 / 8,260.00), la retencion, el abono, el 84.75 y cada regla 422. La
clase aun no extiende CotizacionFormato: crear/actualizar/preview/pdf llegan
con la parte que usa el modelo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit with 2 files.

**Manual server check:** none from this task. Everything here is pure and covered by the CLI.
- The DB rules belong to Task 7: the client exists, each product exists, and `unidadMedidaModel` reads the real
  catalog.
- Task 8 lists them in `tests/test_cotizaciones_ferreteria.http`.

---

## Part B: Tasks 2 and 3


Both tasks are backend-only (repo `C:/Users/Signos/Documents/edwin/api-gratex`, branch `feat/cotizacion-formatos`) plus one FE doc line in Task 3. They do not depend on T1, on each other, or on any other task. T7 needs T2 done. T6 and T9/T11 consume what T3 produces.

**Validated before writing (sandbox, not in the repos).** The checker, the 026 SQL, the snapshot edits and the move script below were run against copies of the real files in the session scratchpad. The expected outputs quoted in the steps are the observed ones: 18/50, 44/67, 45/67, 68/69 and 69/69. The move script's result is byte-identical to the hand-edited target. The T3 one-liner check and `php -l` of the edited controller also passed in the sandbox.

**House rules for both tasks:**
- Use the Bash tool (Git Bash) for every command below. Use `git -C <repo>` rather than `cd`.
- The working tree has `core.autocrlf=true`. `db/tenant_schema.sql`, `db/master_schema.sql`, `db/migrations/README.md`, the docs and `brandingController.php` are CRLF on disk. The Edit tool keeps CRLF. New files written with Write are LF, and git normalizes them.
- Other sessions may edit the same checkout, so re-read each file right before you edit it. Commits name their paths explicitly (`git commit -- <paths>`) so they never pick up someone else's staged work.
- No MySQL exists locally. SQL is verified by `tools/check_tenant_schema_orden.php` and by the manual server checks listed at the end of each task. T8 copies those checks into `tests/test_cotizaciones_ferreteria.http` and the runbook.

---

### Task 2: Tenant migration `026_cotizaciones_formatos.sql` + `tenant_schema.sql` end state + docs

**Files:**
- Create: `C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php`
- Create: `C:/Users/Signos/Documents/edwin/api-gratex/db/migrations/026_cotizaciones_formatos.sql`
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/db/tenant_schema.sql`
  - :8 (header range `012..025`)
  - :17-19 (ORDEN comment)
  - :48-71 (the "2) Cotizaciones" block: rewritten in place in Step 7, then moved in Step 8)
  - :75 (2b comment)
  - :112-113 (2c comment)
  - :151-154 (insertion point: after the `products` `) ENGINE…;` on 151, before the `-- 3) Facturas` header on 153-154)
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/db/migrations/README.md:6-8` and `:13-17`
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/docs/database/schema.md` lines :68, :73, :124-126, :275-280, :292 and :294
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/docs/architecture.md:121`
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/docs/setup.md:68`
- Test: `php tools/check_tenant_schema_orden.php` (from `C:/Users/Signos/Documents/edwin/api-gratex`)

**Interfaces:**
- **Consumes:** nothing. The task is independent and reads only the current snapshot and 023/025 for style.
- **Produces:** the DDL contract that T7's `cotizacionModel` reads and writes. The names below are FINAL.
  - **`cotizaciones` gains:**
    - `formato VARCHAR(40) NULL` (NULL = gratex)
    - `numero INT UNSIGNED NULL` + `UNIQUE KEY uk_cotizaciones_numero (numero)`
    - `subtotal DECIMAL(18,2) NULL`
    - `itbis DECIMAL(18,2) NULL`
    - `user_id INT(11) NULL`
    - `updated_at DATETIME NULL`
    - `client_name` becomes NULL (it keeps its type, charset and collation)
  - **`cotizacion_items` gains:**
    - `product_id <products.id type> NULL` + `KEY idx_cotizacion_items_product (product_id)` + `CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL`
    - `unidad_medida VARCHAR(10) NULL`
    - `indicador_facturacion TINYINT NULL`
    - `indicador_bien_servicio TINYINT NULL`
    - `itbis_amount DECIMAL(18,2) NULL`
  - **New table `cotizacion_ajustes`:**
    - columns: `id INT(11) AI`, `cotizacion_id <cotizaciones.id type> NOT NULL`, `concepto VARCHAR(30) NOT NULL`, `monto DECIMAL(18,2) NOT NULL DEFAULT 0.00`
    - `UNIQUE KEY uk_cotizacion_ajuste (cotizacion_id, concepto)`
    - `CONSTRAINT cotizacion_ajustes_cot_fk … REFERENCES cotizaciones (id) ON DELETE CASCADE`
- **Contract reminder for T7** (copied from the contract):
  - `getCotizacionItems => SELECT * ... ORDER BY id ASC (never name new columns)`.
  - `getAjustes(int $id): array // [concepto => monto(string)]; own try/catch => [] + error_log`.
  - This migration is what makes those columns exist.

- [ ] **Step 1: Preflight (read-only)**

  Run:
  ```bash
  git -C C:/Users/Signos/Documents/edwin/api-gratex branch --show-current
  git -C C:/Users/Signos/Documents/edwin/api-gratex status --short -- db tools/check_tenant_schema_orden.php docs/database/schema.md docs/architecture.md docs/setup.md
  ls C:/Users/Signos/Documents/edwin/api-gratex/db/migrations/026_cotizaciones_formatos.sql
  sed -n '48,51p;151,154p' C:/Users/Signos/Documents/edwin/api-gratex/db/tenant_schema.sql
  ```

  Expected:
  - `feat/cotizacion-formatos`;
  - empty status;
  - `ls: cannot access ... No such file or directory`;
  - lines 48-51 show the `-- 2) Cotizaciones` header and `CREATE TABLE IF NOT EXISTS cotizaciones (`;
  - lines 151-154 show the end of `products` and the `-- 3) Facturas` header.

  If the lines moved because someone edited the file, locate the same text with `grep -n "2) Cotizaciones\|3) Facturas" db/tenant_schema.sql` and continue. The Edit steps match on text, not on line numbers.

- [ ] **Step 2: Write the failing checker `tools/check_tenant_schema_orden.php`**

  Create `C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php` with exactly:

  ```php
  <?php
  /**
   * check_tenant_schema_orden.php — Que db/tenant_schema.sql se pueda aplicar tal
   * cual a una DB vacia, sin tener MySQL a mano.
   *
   * El snapshot NO desactiva FOREIGN_KEY_CHECKS (tools/create_tenant.php lo corre
   * en un solo exec), asi que una FK hacia una tabla que se crea MAS ABAJO hace
   * fallar el alta de un tenant nuevo, y eso solo se descubriria en el server.
   * Este script lo revisa leyendo el texto:
   *
   *   - Cada REFERENCES apunta a una tabla creada ANTES (o a la misma tabla).
   *   - Ninguna tabla se crea dos veces.
   *   - El bloque de cotizaciones trae el estado final de la migracion 026
   *     (columnas, nulabilidad, indices y FKs con los mismos nombres).
   *   - La 026 nombra esos mismos indices y FKs, cada PREPARE tiene su EXECUTE y
   *     su DEALLOCATE PREPARE, y su SQL dinamico, armado con tipos de ejemplo, es
   *     un ALTER/CREATE con parentesis y comillas balanceados.
   *
   * No reemplaza aplicar el snapshot y la 026 a una DB de verdad; solo atrapa en
   * local lo que mas facil se rompe al mover bloques o al escribir SQL dinamico.
   *
   * Uso:
   *   php tools/check_tenant_schema_orden.php            (sale con 1 si algo falla)
   *   php tools/check_tenant_schema_orden.php --mostrar  (ademas imprime el SQL dinamico de la 026)
   */

  $raiz = dirname(__DIR__);
  $rutaSnapshot = $raiz . '/db/tenant_schema.sql';
  $rutaMigracion = $raiz . '/db/migrations/026_cotizaciones_formatos.sql';

  $fallos = 0;
  $total = 0;
  $chk = function (string $desc, bool $ok) use (&$fallos, &$total) {
      $total++;
      if (!$ok) {
          $fallos++;
      }
      printf("  [%s] %s\n", $ok ? 'OK  ' : 'FALLO', $desc);
  };

  /**
   * Quita los comentarios de linea completa (-- ...), para que un REFERENCES o un
   * nombre citado en un comentario no cuente. El snapshot no tiene "--" despues
   * de codigo en la misma linea ni comentarios de bloque.
   */
  function sinComentarios(string $sql): string
  {
      $sql = str_replace("\r\n", "\n", $sql);
      return (string) preg_replace('/^[ \t]*--.*$/m', '', $sql);
  }

  /**
   * Parte el cuerpo de un CREATE TABLE en sus elementos (columnas, KEY,
   * CONSTRAINT...) por las comas de nivel 0: las de DECIMAL(18,2) o las de un
   * COMMENT '...' no cortan. Cada elemento sale con espacios colapsados.
   * @return string[]
   */
  function elementos(string $cuerpo): array
  {
      $partes = [];
      $actual = '';
      $nivel = 0;
      $enComilla = false;
      $largo = strlen($cuerpo);
      for ($i = 0; $i < $largo; $i++) {
          $c = $cuerpo[$i];
          if ($enComilla) {
              $actual .= $c;
              if ($c === "'") {
                  // '' dentro de un literal es una comilla escapada, no el cierre.
                  if ($i + 1 < $largo && $cuerpo[$i + 1] === "'") {
                      $actual .= "'";
                      $i++;
                  } else {
                      $enComilla = false;
                  }
              }
              continue;
          }
          if ($c === "'") {
              $enComilla = true;
          } elseif ($c === '(') {
              $nivel++;
          } elseif ($c === ')') {
              $nivel--;
          } elseif ($c === ',' && $nivel === 0) {
              $partes[] = $actual;
              $actual = '';
              continue;
          }
          $actual .= $c;
      }
      $partes[] = $actual;
      $limpias = [];
      foreach ($partes as $p) {
          $p = trim((string) preg_replace('/\s+/', ' ', str_replace('`', '', $p)));
          if ($p !== '') {
              $limpias[] = $p;
          }
      }
      return $limpias;
  }

  /**
   * Tablas del snapshot en el orden en que se crean.
   * @return array<int,array{nombre:string, elementos:string[]}>
   */
  function tablas(string $sql): array
  {
      preg_match_all(
          '/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\((.*?)\)\s*ENGINE\s*=/is',
          $sql,
          $m,
          PREG_SET_ORDER
      );
      $out = [];
      foreach ($m as $t) {
          $out[] = ['nombre' => strtolower($t[1]), 'elementos' => elementos($t[2])];
      }
      return $out;
  }

  /** Definicion de una columna sin su nombre ("VARCHAR(100) NULL ..."), o null si no esta. */
  function definicion(array $elementos, string $columna): ?string
  {
      foreach ($elementos as $e) {
          $primera = strtolower(strtok($e, ' '));
          if ($primera === strtolower($columna)) {
              return trim(substr($e, strlen($columna)));
          }
      }
      return null;
  }

  /** El elemento (KEY, CONSTRAINT...) esta, comparando sin mayusculas ni espacios de mas. */
  function tieneElemento(array $elementos, string $esperado): bool
  {
      $esperado = strtoupper((string) preg_replace('/\s+/', ' ', trim($esperado)));
      foreach ($elementos as $e) {
          if (strtoupper($e) === $esperado) {
              return true;
          }
      }
      return false;
  }

  if (!is_file($rutaSnapshot)) {
      fwrite(STDERR, "No existe {$rutaSnapshot}\n");
      exit(1);
  }
  $crudo = (string) file_get_contents($rutaSnapshot);
  $sql = sinComentarios($crudo);
  $lista = tablas($sql);

  echo "== Orden de creacion (cada FK apunta a una tabla creada antes) ==\n";
  $posicion = [];
  foreach ($lista as $i => $t) {
      // Si se repite, se queda la primera: es la que vale al aplicar el snapshot.
      if (!isset($posicion[$t['nombre']])) {
          $posicion[$t['nombre']] = $i;
      }
  }
  $fksVistas = 0;
  foreach ($lista as $i => $t) {
      foreach ($t['elementos'] as $e) {
          if (!preg_match('/^(?:CONSTRAINT\s+(\w+)\s+)?FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+(\w+)/i', $e, $fk)) {
              continue;
          }
          $fksVistas++;
          $nombreFk = $fk[1] !== '' ? $fk[1] : '(sin nombre)';
          $destino = strtolower($fk[2]);
          $ok = $destino === $t['nombre'] || (isset($posicion[$destino]) && $posicion[$destino] < $i);
          $chk(
              "FK {$nombreFk}: {$t['nombre']} -> {$destino}"
                  . ($ok ? '' : (isset($posicion[$destino]) ? ' (se crea DESPUES)' : ' (no se crea en el snapshot)')),
              $ok
          );
      }
  }
  // Un REFERENCES fuera de un CREATE TABLE (ej. un ALTER TABLE ... ADD CONSTRAINT)
  // no lo revisa este script: avisar en vez de darlo por bueno.
  $chk(
      'todo REFERENCES esta dentro de un CREATE TABLE',
      preg_match_all('/\bREFERENCES\s+`?\w+`?\s*\(/i', $sql) === $fksVistas
  );

  echo "\n== Tablas unicas ==\n";
  $conteo = array_count_values(array_column($lista, 'nombre'));
  $repetidas = array_keys(array_filter($conteo, fn($n) => $n > 1));
  $chk('ninguna tabla se crea dos veces' . ($repetidas ? ' (repetidas: ' . implode(', ', $repetidas) . ')' : ''), $repetidas === []);

  echo "\n== Cotizaciones: estado final de la migracion 026 ==\n";
  $chk('cabecera: rango de migraciones 012..026', (bool) preg_match('/012\.\.026/', $crudo));

  $porNombre = [];
  foreach ($lista as $t) {
      $porNombre[$t['nombre']] ??= $t['elementos'];
  }
  // Tipo + nulabilidad que debe quedar en cada columna (despues de colapsar espacios).
  $columnas = [
      'cotizaciones' => [
          'client_name' => '/^VARCHAR\(100\) NULL\b/i',
          'user_id'     => '/^INT\(11\) NULL\b/i',
          'updated_at'  => '/^DATETIME NULL\b/i',
          'formato'     => '/^VARCHAR\(40\) NULL\b/i',
          'numero'      => '/^INT UNSIGNED NULL\b/i',
          'subtotal'    => '/^DECIMAL\(18,2\) NULL\b/i',
          'itbis'       => '/^DECIMAL\(18,2\) NULL\b/i',
      ],
      'cotizacion_items' => [
          'product_id'              => '/^INT\(11\) NULL\b/i',
          'unidad_medida'           => '/^VARCHAR\(10\) NULL\b/i',
          'indicador_facturacion'   => '/^TINYINT NULL\b/i',
          'indicador_bien_servicio' => '/^TINYINT NULL\b/i',
          'itbis_amount'            => '/^DECIMAL\(18,2\) NULL\b/i',
      ],
      'cotizacion_ajustes' => [
          'id'            => '/^INT\(11\) NOT NULL AUTO_INCREMENT\b/i',
          'cotizacion_id' => '/^INT\(11\) NOT NULL\b/i',
          'concepto'      => '/^VARCHAR\(30\) NOT NULL\b/i',
          'monto'         => '/^DECIMAL\(18,2\) NOT NULL DEFAULT 0\.00\b/i',
      ],
  ];
  foreach ($columnas as $tabla => $cols) {
      $chk("tabla {$tabla} existe", isset($porNombre[$tabla]));
      foreach ($cols as $col => $patron) {
          $def = definicion($porNombre[$tabla] ?? [], $col);
          $chk("{$tabla}.{$col}" . ($def === null ? ' (falta)' : " = {$def}"), $def !== null && preg_match($patron, $def) === 1);
      }
  }
  $indices = [
      'cotizaciones' => [
          'UNIQUE KEY uk_cotizaciones_numero (numero)',
      ],
      'cotizacion_items' => [
          'KEY idx_cotizacion_items_product (product_id)',
          'CONSTRAINT cotizacion_items_ibfk_1 FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE',
          'CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL',
      ],
      'cotizacion_ajustes' => [
          'UNIQUE KEY uk_cotizacion_ajuste (cotizacion_id, concepto)',
          'CONSTRAINT cotizacion_ajustes_cot_fk FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE',
      ],
  ];
  foreach ($indices as $tabla => $lst) {
      foreach ($lst as $esperado) {
          $chk("{$tabla}: {$esperado}", tieneElemento($porNombre[$tabla] ?? [], $esperado));
      }
  }

  echo "\n== Migracion 026 ==\n";
  $hayMigracion = is_file($rutaMigracion);
  $chk('existe db/migrations/026_cotizaciones_formatos.sql', $hayMigracion);
  $mig = $hayMigracion ? sinComentarios((string) file_get_contents($rutaMigracion)) : '';
  // Mismos nombres que el snapshot: si difieren, un tenant nuevo y uno migrado
  // quedan con indices distintos y la proxima migracion no sabe cual buscar.
  foreach (['uk_cotizaciones_numero', 'idx_cotizacion_items_product', 'cotizacion_items_product_fk',
            'uk_cotizacion_ajuste', 'cotizacion_ajustes_cot_fk', 'cotizacion_ajustes'] as $nombre) {
      $chk("026 nombra {$nombre}", $mig !== '' && preg_match('/\b' . $nombre . '\b/', $mig) === 1);
  }
  preg_match_all('/^\s*PREPARE\s+(\w+)\s+FROM\s+(@\w+)\s*;/mi', $mig, $prep);
  preg_match_all('/^\s*EXECUTE\s+(\w+)\s*;/mi', $mig, $exec);
  preg_match_all('/^\s*DEALLOCATE\s+PREPARE\s+(\w+)\s*;/mi', $mig, $deal);
  $chk('026: cada PREPARE tiene su EXECUTE y su DEALLOCATE (' . count($prep[1]) . ' sentencias)',
      $prep[1] !== [] && $prep[1] === $exec[1] && $prep[1] === $deal[1]);
  $chk('026: ningun nombre de sentencia preparada se repite', count($prep[1]) === count(array_unique($prep[1])));

  // Sin MySQL no se puede preparar el SQL dinamico, pero si armarlo: cada
  // SET @sql_x := IF(cond, <sql>, 'DO 0') se expande con tipos de ejemplo (los
  // que daria una DB creada desde el repo) y se revisa que sea un ALTER/CREATE
  // de las tablas de cotizaciones con parentesis y comillas balanceados. Para
  // leerlo entero: php tools/check_tenant_schema_orden.php --mostrar
  $ejemplo = [
      '@tipo_product_id' => 'int(11)',
      '@tipo_cot_id'     => 'int(11)',
      '@cn_definicion'   => 'varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL',
  ];
  preg_match_all("/SET\s+(@sql_\w+)\s*:=\s*IF\(@\w+\s*=\s*[01],(.*?),\s*'DO 0'\);/s", $mig, $dinamicos, PREG_SET_ORDER);
  $chk('026: cada @sql_* se prepara una vez (' . count($dinamicos) . ' sentencias dinamicas)',
      $dinamicos !== [] && array_column($dinamicos, 1) === $prep[2]);
  foreach ($dinamicos as [, $variable, $expresion]) {
      // Tokens de la expresion: literales '...' ('' = comilla escapada) o @variables.
      preg_match_all("/'((?:[^']|'')*)'|(@\w+)/", $expresion, $tokens, PREG_SET_ORDER);
      $ddl = '';
      $desconocida = null;
      foreach ($tokens as $tok) {
          if (isset($tok[2]) && $tok[2] !== '') {
              $desconocida = isset($ejemplo[$tok[2]]) ? $desconocida : $tok[2];
              $ddl .= $ejemplo[$tok[2]] ?? '';
          } else {
              $ddl .= str_replace("''", "'", $tok[1]);
          }
      }
      $sinLiterales = (string) preg_replace("/'(?:[^']|'')*'/", "''", $ddl);
      $ok = $desconocida === null
          && preg_match('/^(ALTER TABLE (cotizaciones|cotizacion_items) |CREATE TABLE IF NOT EXISTS cotizacion_ajustes \()/', $ddl) === 1
          && substr_count($ddl, "'") % 2 === 0
          && substr_count($sinLiterales, '(') === substr_count($sinLiterales, ')');
      $chk("026: {$variable} arma un DDL valido" . ($desconocida !== null ? " (variable sin ejemplo: {$desconocida})" : ''), $ok);
      if (in_array('--mostrar', $argv, true)) {
          echo "         {$ddl}\n";
      }
  }

  printf("\n%d/%d OK\n", $total - $fallos, $total);
  exit($fallos === 0 ? 0 : 1);
  ```

- [ ] **Step 3: Run the checker against the current snapshot (must fail)**

  Run:
  ```bash
  php -l C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php; echo "exit=$?"
  ```

  Expected:
  - `No syntax errors detected`;
  - every `FK ...` line is `[OK  ]` (12 FKs, including `cotizacion_items_ibfk_1`), because nothing references a later table yet;
  - then these `[FALLO]` lines:
    - `cabecera: rango de migraciones 012..026`
    - `cotizaciones.client_name = VARCHAR(100) NOT NULL`
    - `cotizaciones.user_id (falta)`, and the same `(falta)` for `updated_at`, `formato`, `numero`, `subtotal` and `itbis`
    - the 5 `cotizacion_items.* (falta)` lines
    - `tabla cotizacion_ajustes existe` and its 4 column lines
    - the 5 missing KEY/CONSTRAINT lines
    - `existe db/migrations/026_cotizaciones_formatos.sql`, the 6 `026 nombra ...` lines, `... (0 sentencias)` and `... (0 sentencias dinamicas)`
  - last lines `18/50 OK` and `exit=1`.

- [ ] **Step 4: Write `db/migrations/026_cotizaciones_formatos.sql`**

  Create `C:/Users/Signos/Documents/edwin/api-gratex/db/migrations/026_cotizaciones_formatos.sql` with exactly:

  ```sql
  -- ============================================================================
  -- 026_cotizaciones_formatos.sql — Formatos de cotizacion por tenant (lineas del
  -- catalogo, numeracion, cargos y abonos) + desfase entre snapshot y codigo.
  -- ============================================================================
  -- Para DBs de tenant YA desplegados: correr en la base de CADA empresa,
  -- DESPUES de la 025. Los tenants nuevos lo reciben via db/tenant_schema.sql
  -- (mismas columnas y mismos nombres de indices y FKs).
  --
  -- POR QUE:
  --   1) La cotizacion era la de Gratex para todos los tenants: lineas de texto
  --      libre, codigo aleatorio y el PDF de Gratex (con su cuenta de banco).
  --      Ferreteria cotiza distinto ("COTIZACION MERCANCIAS"): lineas del
  --      catalogo que al facturar mueven inventario, ITBIS por linea, numero
  --      COT-000001 y cargos/abonos que no llevan ITBIS. Cada tenant elige su
  --      formato en master.tenants.cotizacion_formato (migracion master 011) y
  --      cada formato es codigo en src/Utils/Cotizacion/.
  --   2) El snapshot se habia quedado atras del codigo: el modelo escribe
  --      cotizaciones.user_id y updated_at, que el snapshot no tenia, y
  --      client_name era NOT NULL sin default aunque el codigo nunca lo llena.
  --      Una DB creada desde el snapshot (lo mas probable, la de Ferreteria) no
  --      podia guardar ni una cotizacion.
  --
  -- QUE HACE (cada paso mira information_schema; no borra ni reescribe datos):
  --   A) Desfase: agrega user_id y updated_at si faltan; agrega client_name si
  --      falta y, si es NOT NULL sin default, lo vuelve NULL con un MODIFY que
  --      copia tipo, charset, collation y comentario actuales (solo cambia la
  --      nulabilidad).
  --   B) cotizaciones: formato (NULL = gratex), numero (+ UNIQUE; los NULL no
  --      chocan entre si), subtotal e itbis.
  --   C) cotizacion_items: product_id (+ indice + FK a products ON DELETE SET
  --      NULL, en UN solo ALTER como la 023, para que MySQL no cree un indice
  --      duplicado), unidad_medida, indicador_facturacion,
  --      indicador_bien_servicio e itbis_amount. NULL = linea al estilo Gratex.
  --   D) Tabla nueva cotizacion_ajustes: cargos, mano de obra, abono y retencion
  --      de cada cotizacion, una fila por concepto (solo los que no son cero).
  --   Los tipos de cotizacion_items.product_id y cotizacion_ajustes.cotizacion_id
  --   se COPIAN de products.id y cotizaciones.id (signo incluido): la FK no se
  --   crea si los tipos difieren, y la DDL de produccion puede no ser la del repo.
  --
  -- ANTES DE CORRER:
  --   - Hazlo fuera de horario: agregar la FK reconstruye cotizacion_items y
  --     bloquea escrituras mientras corre (segundos en tablas chicas); los demas
  --     ALTER son igual de cortos.
  --   - Corre las consultas del paso 0 y revisa que den lo esperado. Si alguna
  --     tabla NO sale InnoDB, para y avisa: MyISAM ignora las FK en silencio.
  --   - Quita el modulo `cotizaciones` de los roles de Ferreteria hasta activar
  --     su formato: con esta migracion su DB ya puede guardar cotizaciones, y
  --     mientras el tenant siga en 'gratex' saldrian con el formato de Gratex.
  --
  -- ORDEN DE DESPLIEGUE: correr la master 011 y esta 026 en CADA tenant, completas,
  -- ANTES de subir el codigo nuevo (api-gratex y despues fiscalo). Las
  -- cotizaciones de Gratex no dependen de estas columnas (el codigo las lee con
  -- SELECT * y solo el formato ferreteria las nombra), pero un tenant solo se pasa
  -- a 'ferreteria' cuando su DB ya tiene la 026.
  --
  -- Se puede correr dos veces: si el cambio ya esta, el paso ejecuta DO 0 y no
  -- toca nada.
  -- ============================================================================

  -- ----------------------------------------------------------------------------
  -- 0) Comprobaciones previas (solo lectura).
  -- ----------------------------------------------------------------------------
  -- 0a) Motor: las tres deben salir InnoDB.
  SELECT TABLE_NAME, ENGINE
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME IN ('cotizaciones', 'cotizacion_items', 'products')
  ORDER BY TABLE_NAME;

  -- 0b) Tipos exactos que copian las FK nuevas (cotizaciones.id, products.id) y
  --     como estan hoy las columnas del desfase. En una DB creada desde el repo:
  --     los dos id = int(11), client_name varchar(100) IS_NULLABLE = NO, y quiza
  --     sin fila para user_id / updated_at (se agregan en A).
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
         CHARACTER_SET_NAME, COLLATION_NAME
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND (
         (TABLE_NAME = 'cotizaciones' AND COLUMN_NAME IN ('id', 'client_name', 'user_id', 'updated_at'))
      OR (TABLE_NAME = 'products'     AND COLUMN_NAME = 'id')
    )
  ORDER BY TABLE_NAME, COLUMN_NAME;

  -- 0c) Cuantas cotizaciones hay (en la DB de Ferreteria se espera 0).
  SELECT COUNT(*) AS cotizaciones FROM cotizaciones;

  -- 0d) Opcional: ver la definicion real (produccion puede tener columnas que el
  --     esquema del repo no lista; esta migracion solo toca las nombradas abajo).
  --   SHOW CREATE TABLE cotizaciones;
  --   SHOW CREATE TABLE cotizacion_items;
  --   SHOW CREATE TABLE products;

  -- ----------------------------------------------------------------------------
  -- A) Desfase entre el snapshot y el codigo.
  -- ----------------------------------------------------------------------------
  -- A1) user_id: el modelo lo escribe al crear y al editar. Referencia a
  --     gratex_master.users.id, sin FK cross-DB (igual que facturas.user_id).
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'user_id'
  );
  SET @sql_user_id := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN user_id INT(11) NULL DEFAULT NULL COMMENT ''Referencia a gratex_master.users.id (sin FK cross-DB)'' AFTER total',
    'DO 0');
  PREPARE s_user_id FROM @sql_user_id;
  EXECUTE s_user_id;
  DEALLOCATE PREPARE s_user_id;

  -- A2) updated_at: lo escribe la edicion.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'updated_at'
  );
  SET @sql_updated_at := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN updated_at DATETIME NULL DEFAULT NULL AFTER user_id',
    'DO 0');
  PREPARE s_updated_at FROM @sql_updated_at;
  EXECUTE s_updated_at;
  DEALLOCATE PREPARE s_updated_at;

  -- A3) client_name, si no existe (las lecturas la toman de clients por JOIN; el
  --     formato ferreteria la llena con el nombre del cliente).
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'client_name'
  );
  SET @sql_client_name_add := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN client_name VARCHAR(100) NULL DEFAULT NULL AFTER client_id',
    'DO 0');
  PREPARE s_client_name_add FROM @sql_client_name_add;
  EXECUTE s_client_name_add;
  DEALLOCATE PREPARE s_client_name_add;

  -- A4) client_name NOT NULL sin default: el INSERT de Gratex no la nombra, asi
  --     que en modo estricto la cotizacion no se guarda. El MODIFY se arma con la
  --     definicion actual (tipo, charset, collation, comentario) para que SOLO
  --     cambie la nulabilidad; el ancho y la collation de produccion se respetan.
  SET @cn_arreglar := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'client_name'
      AND IS_NULLABLE = 'NO'
      AND COLUMN_DEFAULT IS NULL
  );
  SET @cn_definicion := (
    SELECT CONCAT(
             COLUMN_TYPE,
             IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME)),
             IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE ', COLLATION_NAME)),
             ' NULL DEFAULT NULL',
             IF(COLUMN_COMMENT = '', '', CONCAT(' COMMENT ', QUOTE(COLUMN_COMMENT)))
           )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'client_name'
  );
  SET @sql_client_name_null := IF(@cn_arreglar = 1,
    CONCAT('ALTER TABLE cotizaciones MODIFY client_name ', @cn_definicion),
    'DO 0');
  PREPARE s_client_name_null FROM @sql_client_name_null;
  EXECUTE s_client_name_null;
  DEALLOCATE PREPARE s_client_name_null;

  -- ----------------------------------------------------------------------------
  -- B) cotizaciones: columnas del formato.
  -- ----------------------------------------------------------------------------
  -- B1) formato: NULL = gratex (todas las cotizaciones que ya existen).
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'formato'
  );
  SET @sql_formato := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN formato VARCHAR(40) NULL DEFAULT NULL COMMENT ''Formato de cotizacion (src/Utils/Cotizacion/), NULL = gratex'' AFTER code',
    'DO 0');
  PREPARE s_formato FROM @sql_formato;
  EXECUTE s_formato;
  DEALLOCATE PREPARE s_formato;

  -- B2) numero: consecutivo del tenant (COT-000001). Columna + UNIQUE en el mismo
  --     ALTER; el UNIQUE admite cualquier cantidad de NULL (las de Gratex).
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'numero'
  );
  SET @sql_numero := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN numero INT UNSIGNED NULL DEFAULT NULL COMMENT ''Consecutivo del tenant (COT-000001), NULL = codigo aleatorio de Gratex'' AFTER formato, ADD UNIQUE KEY uk_cotizaciones_numero (numero)',
    'DO 0');
  PREPARE s_numero FROM @sql_numero;
  EXECUTE s_numero;
  DEALLOCATE PREPARE s_numero;

  -- B2b) Si numero ya existia sin su UNIQUE (cambio hecho a mano), completarlo.
  SET @has_idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND INDEX_NAME = 'uk_cotizaciones_numero'
  );
  SET @sql_numero_uk := IF(@has_idx = 0,
    'ALTER TABLE cotizaciones ADD UNIQUE KEY uk_cotizaciones_numero (numero)',
    'DO 0');
  PREPARE s_numero_uk FROM @sql_numero_uk;
  EXECUTE s_numero_uk;
  DEALLOCATE PREPARE s_numero_uk;

  -- B3) subtotal (antes de ITBIS) e itbis: los guarda el formato; Gratex no.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'subtotal'
  );
  SET @sql_subtotal := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN subtotal DECIMAL(18,2) NULL DEFAULT NULL COMMENT ''Antes de ITBIS, NULL en cotizaciones de Gratex'' AFTER client_name',
    'DO 0');
  PREPARE s_subtotal FROM @sql_subtotal;
  EXECUTE s_subtotal;
  DEALLOCATE PREPARE s_subtotal;

  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'itbis'
  );
  SET @sql_itbis := IF(@has_col = 0,
    'ALTER TABLE cotizaciones ADD COLUMN itbis DECIMAL(18,2) NULL DEFAULT NULL COMMENT ''Suma del ITBIS de las lineas, NULL en cotizaciones de Gratex'' AFTER subtotal',
    'DO 0');
  PREPARE s_itbis FROM @sql_itbis;
  EXECUTE s_itbis;
  DEALLOCATE PREPARE s_itbis;

  -- ----------------------------------------------------------------------------
  -- C) cotizacion_items: la linea sabe que producto es (como factura_items, 023).
  --    NULL = linea libre o linea de Gratex. ON DELETE SET NULL: borrar un
  --    producto no rompe cotizaciones guardadas; la linea conserva su texto.
  -- ----------------------------------------------------------------------------
  -- C1) product_id + indice + FK en UN ALTER. El tipo se copia de products.id.
  --     Si products no existe (falta la 012) este paso falla al preparar: es lo
  --     correcto, no hay a que apuntar.
  SET @tipo_product_id := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'id'
  );
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND COLUMN_NAME = 'product_id'
  );
  SET @sql_product := IF(@has_col = 0,
    CONCAT(
      'ALTER TABLE cotizacion_items ',
      'ADD COLUMN product_id ', @tipo_product_id, ' NULL DEFAULT NULL ',
        'COMMENT ''FK al catalogo, NULL = linea libre o de Gratex'' AFTER cotizacion_id, ',
      'ADD KEY idx_cotizacion_items_product (product_id), ',
      'ADD CONSTRAINT cotizacion_items_product_fk ',
        'FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL'),
    'DO 0');
  PREPARE s_product FROM @sql_product;
  EXECUTE s_product;
  DEALLOCATE PREPARE s_product;

  -- C1b) Si product_id ya existia sin su indice o sin su FK (cambio hecho a
  --      mano), completarlos. Primero el indice: asi la FK lo usa y MySQL no
  --      crea otro con el nombre de la FK.
  SET @has_idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND INDEX_NAME = 'idx_cotizacion_items_product'
  );
  SET @sql_product_idx := IF(@has_idx = 0,
    'ALTER TABLE cotizacion_items ADD KEY idx_cotizacion_items_product (product_id)',
    'DO 0');
  PREPARE s_product_idx FROM @sql_product_idx;
  EXECUTE s_product_idx;
  DEALLOCATE PREPARE s_product_idx;

  SET @has_fk := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND CONSTRAINT_NAME = 'cotizacion_items_product_fk'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  );
  SET @sql_product_fk := IF(@has_fk = 0,
    'ALTER TABLE cotizacion_items ADD CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL',
    'DO 0');
  PREPARE s_product_fk FROM @sql_product_fk;
  EXECUTE s_product_fk;
  DEALLOCATE PREPARE s_product_fk;

  -- C2) unidad_medida: codigo DGII de la unidad (= master unidades_medida.id,
  --     ej. '43'), igual que factura_items; nunca el `codigo` abreviado.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND COLUMN_NAME = 'unidad_medida'
  );
  SET @sql_unidad := IF(@has_col = 0,
    'ALTER TABLE cotizacion_items ADD COLUMN unidad_medida VARCHAR(10) NULL DEFAULT NULL COMMENT ''Codigo de unidad DGII (ej. 43 = Unidad), NULL = linea de Gratex'' AFTER subtotal',
    'DO 0');
  PREPARE s_unidad FROM @sql_unidad;
  EXECUTE s_unidad;
  DEALLOCATE PREPARE s_unidad;

  -- C3) indicador_facturacion: tasa de ITBIS de la linea.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND COLUMN_NAME = 'indicador_facturacion'
  );
  SET @sql_ind_fact := IF(@has_col = 0,
    'ALTER TABLE cotizacion_items ADD COLUMN indicador_facturacion TINYINT NULL DEFAULT NULL COMMENT ''1=ITBIS 18% | 2=ITBIS 16% | 3=ITBIS 0% | 4=Exento, NULL = linea de Gratex'' AFTER unidad_medida',
    'DO 0');
  PREPARE s_ind_fact FROM @sql_ind_fact;
  EXECUTE s_ind_fact;
  DEALLOCATE PREPARE s_ind_fact;

  -- C4) indicador_bien_servicio: lo pide el e-CF al convertir en factura.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND COLUMN_NAME = 'indicador_bien_servicio'
  );
  SET @sql_ind_bs := IF(@has_col = 0,
    'ALTER TABLE cotizacion_items ADD COLUMN indicador_bien_servicio TINYINT NULL DEFAULT NULL COMMENT ''1=Bien | 2=Servicio, NULL = linea de Gratex'' AFTER indicador_facturacion',
    'DO 0');
  PREPARE s_ind_bs FROM @sql_ind_bs;
  EXECUTE s_ind_bs;
  DEALLOCATE PREPARE s_ind_bs;

  -- C5) itbis_amount: ITBIS calculado de la linea.
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_items'
      AND COLUMN_NAME = 'itbis_amount'
  );
  SET @sql_itbis_linea := IF(@has_col = 0,
    'ALTER TABLE cotizacion_items ADD COLUMN itbis_amount DECIMAL(18,2) NULL DEFAULT NULL COMMENT ''ITBIS de la linea, NULL = linea de Gratex'' AFTER indicador_bien_servicio',
    'DO 0');
  PREPARE s_itbis_linea FROM @sql_itbis_linea;
  EXECUTE s_itbis_linea;
  DEALLOCATE PREPARE s_itbis_linea;

  -- ----------------------------------------------------------------------------
  -- D) cotizacion_ajustes: montos fuera de las lineas (cargos bancarios, mano de
  --    obra, abono, retencion...). Cada formato declara que conceptos acepta y
  --    solo guarda los que no son cero. El tipo de cotizacion_id se copia de
  --    cotizaciones.id. El UNIQUE (cotizacion_id, concepto) sirve de indice a la
  --    FK, asi que no hace falta otro.
  -- ----------------------------------------------------------------------------
  SET @tipo_cot_id := (
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizaciones'
      AND COLUMN_NAME = 'id'
  );
  SET @has_tabla := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cotizacion_ajustes'
  );
  SET @sql_ajustes := IF(@has_tabla = 0,
    CONCAT(
      'CREATE TABLE IF NOT EXISTS cotizacion_ajustes (',
        'id INT(11) NOT NULL AUTO_INCREMENT, ',
        'cotizacion_id ', @tipo_cot_id, ' NOT NULL, ',
        'concepto VARCHAR(30) NOT NULL COMMENT ''Clave definida por el formato (ej. mano_obra, abono)'', ',
        'monto DECIMAL(18,2) NOT NULL DEFAULT 0.00, ',
        'PRIMARY KEY (id), ',
        'UNIQUE KEY uk_cotizacion_ajuste (cotizacion_id, concepto), ',
        'CONSTRAINT cotizacion_ajustes_cot_fk FOREIGN KEY (cotizacion_id) ',
          'REFERENCES cotizaciones (id) ON DELETE CASCADE',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'),
    'DO 0');
  PREPARE s_ajustes FROM @sql_ajustes;
  EXECUTE s_ajustes;
  DEALLOCATE PREPARE s_ajustes;

  -- ----------------------------------------------------------------------------
  -- E) Verificacion.
  -- ----------------------------------------------------------------------------
  -- E1) 16 filas: las 7 de cotizaciones, las 5 de cotizacion_items y las 4 de
  --     cotizacion_ajustes. client_name y todas las nuevas de cotizaciones y
  --     cotizacion_items con IS_NULLABLE = YES; product_id y
  --     cotizacion_ajustes.cotizacion_id con el mismo COLUMN_TYPE que salio en 0b.
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND (
         (TABLE_NAME = 'cotizaciones'       AND COLUMN_NAME IN ('client_name', 'user_id', 'updated_at', 'formato', 'numero', 'subtotal', 'itbis'))
      OR (TABLE_NAME = 'cotizacion_items'   AND COLUMN_NAME IN ('product_id', 'unidad_medida', 'indicador_facturacion', 'indicador_bien_servicio', 'itbis_amount'))
      OR (TABLE_NAME = 'cotizacion_ajustes' AND COLUMN_NAME IN ('id', 'cotizacion_id', 'concepto', 'monto'))
    )
  ORDER BY TABLE_NAME, ORDINAL_POSITION;

  -- E2) 3 indices: uk_cotizaciones_numero (NON_UNIQUE 0),
  --     idx_cotizacion_items_product (1) y uk_cotizacion_ajuste (0).
  SELECT DISTINCT TABLE_NAME, INDEX_NAME, NON_UNIQUE
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND INDEX_NAME IN ('uk_cotizaciones_numero', 'idx_cotizacion_items_product', 'uk_cotizacion_ajuste')
  ORDER BY TABLE_NAME, INDEX_NAME;

  -- E3) 2 FKs: cotizacion_items_product_fk -> products (SET NULL) y
  --     cotizacion_ajustes_cot_fk -> cotizaciones (CASCADE).
  SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND CONSTRAINT_NAME IN ('cotizacion_items_product_fk', 'cotizacion_ajustes_cot_fk')
  ORDER BY CONSTRAINT_NAME;
  ```

  Notes for the reviewer:
  - **Dynamic SQL avoids `;`.** Comment strings inside it use `,` instead, so no client statement-splitter can be confused.
  - **Every comment is ASCII.** That matches 008/010.

- [ ] **Step 5: Run the checker (migration section must pass, snapshot still fails)**

  Run:
  ```bash
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php; echo "exit=$?"
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php --mostrar | sed -n '/== Migracion 026 ==/,$p'
  ```

  Expected, first run:
  - every line under `== Migracion 026 ==` is `[OK  ]`. That covers 17 prepared statements, 17 dynamic statements and 17 `... arma un DDL valido` lines;
  - the snapshot lines from Step 3 still fail;
  - `44/67 OK`, `exit=1`.

  The `--mostrar` output prints each expanded DDL under its line. Read them once. For example:
  - `ALTER TABLE cotizacion_items ADD COLUMN product_id int(11) NULL DEFAULT NULL COMMENT 'FK al catalogo, NULL = linea libre o de Gratex' AFTER cotizacion_id, ADD KEY idx_cotizacion_items_product (product_id), ADD CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL`
  - `ALTER TABLE cotizaciones MODIFY client_name varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL`

- [ ] **Step 6: Snapshot header: range and ORDEN comment**

  Re-read `db/tenant_schema.sql` lines 1-25, then make two Edits.

  Edit 1, old:
  ```
  --   - 012..025  en db/migrations/ (activas solo para DBs de tenant ya desplegados).
  ```
  new:
  ```
  --   - 012..026  en db/migrations/ (activas solo para DBs de tenant ya desplegados).
  ```

  Edit 2, old:
  ```
  -- por una FK se crea ANTES que quien la referencia. Por eso el catalogo
  -- (categories, warehouses, products) va antes de facturas, gastos e inventario.
  ```
  new:
  ```
  -- por una FK se crea ANTES que quien la referencia. Por eso el catalogo
  -- (categories, warehouses, products) va antes de cotizaciones, facturas, gastos
  -- e inventario. tools/check_tenant_schema_orden.php lo revisa sin MySQL.
  ```

  Run `php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php | tail -1`. Expected: `45/67 OK`.

- [ ] **Step 7: Write the end-state cotizaciones block IN PLACE (the FK ordering test must now fail)**

  Re-read `db/tenant_schema.sql` lines 46-73.

  Edit, old (current lines 48-71):
  ```sql
  -- ----------------------------------------------------------------------------
  -- 2) Cotizaciones
  -- ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS cotizaciones (
    id           INT(11)        NOT NULL AUTO_INCREMENT,
    code         VARCHAR(50)    NOT NULL,
    date         DATETIME       DEFAULT CURRENT_TIMESTAMP,
    client_id    INT(11)        DEFAULT NULL,
    client_name  VARCHAR(100)   NOT NULL,
    total        DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE TABLE IF NOT EXISTS cotizacion_items (
    id             INT(11)        NOT NULL AUTO_INCREMENT,
    cotizacion_id  INT(11)        NOT NULL,
    description    TEXT           NOT NULL,
    amount         DECIMAL(18,4)  NOT NULL,
    quantity       DECIMAL(12,3)  NOT NULL DEFAULT 1.000,
    subtotal       DECIMAL(18,2)  NOT NULL,
    PRIMARY KEY (id),
    KEY cotizacion_id (cotizacion_id),
    CONSTRAINT cotizacion_items_ibfk_1 FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ```
  new (the final block; Step 8 moves it unchanged):
  ```sql
  -- ----------------------------------------------------------------------------
  -- 2d) Cotizaciones. Van despues del catalogo: cotizacion_items.product_id es FK
  --     a products. formato NULL = Gratex (lineas de texto libre y codigo
  --     aleatorio); los demas formatos (src/Utils/Cotizacion/) numeran con
  --     `numero`, guardan subtotal/itbis, los datos fiscales de cada linea y sus
  --     cargos y abonos en cotizacion_ajustes.
  --     Ver db/migrations/025_decimales_cantidades_precios.sql y
  --     026_cotizaciones_formatos.sql.
  -- ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS cotizaciones (
    id           INT(11)        NOT NULL AUTO_INCREMENT,
    code         VARCHAR(50)    NOT NULL,
    formato      VARCHAR(40)    NULL DEFAULT NULL
                   COMMENT 'Formato de cotizacion (src/Utils/Cotizacion/), NULL = gratex',
    numero       INT UNSIGNED   NULL DEFAULT NULL
                   COMMENT 'Consecutivo del tenant (COT-000001), NULL = codigo aleatorio de Gratex',
    date         DATETIME       DEFAULT CURRENT_TIMESTAMP,
    client_id    INT(11)        DEFAULT NULL,
    client_name  VARCHAR(100)   NULL DEFAULT NULL,
    subtotal     DECIMAL(18,2)  NULL DEFAULT NULL
                   COMMENT 'Antes de ITBIS, NULL en cotizaciones de Gratex',
    itbis        DECIMAL(18,2)  NULL DEFAULT NULL
                   COMMENT 'Suma del ITBIS de las lineas, NULL en cotizaciones de Gratex',
    total        DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
    user_id      INT(11)        NULL DEFAULT NULL
                   COMMENT 'Referencia a gratex_master.users.id (sin FK cross-DB)',
    updated_at   DATETIME       NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_cotizaciones_numero (numero)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE TABLE IF NOT EXISTS cotizacion_items (
    id             INT(11)        NOT NULL AUTO_INCREMENT,
    cotizacion_id  INT(11)        NOT NULL,
    product_id     INT(11)        NULL DEFAULT NULL
                     COMMENT 'FK al catalogo, NULL = linea libre o de Gratex',
    description    TEXT           NOT NULL,
    amount         DECIMAL(18,4)  NOT NULL,
    quantity       DECIMAL(12,3)  NOT NULL DEFAULT 1.000,
    subtotal       DECIMAL(18,2)  NOT NULL,
    unidad_medida  VARCHAR(10)    NULL DEFAULT NULL
                     COMMENT 'Codigo de unidad DGII (ej. 43 = Unidad), NULL = linea de Gratex',
    indicador_facturacion TINYINT NULL DEFAULT NULL
                     COMMENT '1=ITBIS 18% | 2=ITBIS 16% | 3=ITBIS 0% | 4=Exento, NULL = linea de Gratex',
    indicador_bien_servicio TINYINT NULL DEFAULT NULL
                     COMMENT '1=Bien | 2=Servicio, NULL = linea de Gratex',
    itbis_amount   DECIMAL(18,2)  NULL DEFAULT NULL
                     COMMENT 'ITBIS de la linea, NULL = linea de Gratex',
    PRIMARY KEY (id),
    KEY cotizacion_id (cotizacion_id),
    KEY idx_cotizacion_items_product (product_id),
    CONSTRAINT cotizacion_items_ibfk_1 FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE,
    CONSTRAINT cotizacion_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  -- Montos fuera de las lineas (cargos bancarios, mano de obra, abono,
  -- retencion...): una fila por concepto, solo los distintos de cero. Cada
  -- formato declara que conceptos acepta.
  CREATE TABLE IF NOT EXISTS cotizacion_ajustes (
    id             INT(11)        NOT NULL AUTO_INCREMENT,
    cotizacion_id  INT(11)        NOT NULL,
    concepto       VARCHAR(30)    NOT NULL
                     COMMENT 'Clave definida por el formato (ej. mano_obra, abono)',
    monto          DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id),
    UNIQUE KEY uk_cotizacion_ajuste (cotizacion_id, concepto),
    CONSTRAINT cotizacion_ajustes_cot_fk FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ```

  Run:
  ```bash
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php | grep -E "FALLO|^[0-9]+/[0-9]+ OK"; echo "exit=${PIPESTATUS[0]}"
  ```

  Expected, exactly:
  ```
    [FALLO] FK cotizacion_items_product_fk: cotizacion_items -> products (se crea DESPUES)
  68/69 OK
  exit=1
  ```
  This is the failing test the move fixes. `tools/create_tenant.php` would die on this FK, because `products` is created ~80 lines later.

- [ ] **Step 8: Move the block below "2c) Catalogo de productos" and update the 2b/2c comments**

  Move the block with this script. It is deterministic, keeps the file's CRLF, and refuses to touch the file if a marker is missing:
  ```bash
  php -r '
  $f = "C:/Users/Signos/Documents/edwin/api-gratex/db/tenant_schema.sql";
  $t = file_get_contents($f);
  $eol = str_contains($t, "\r\n") ? "\r\n" : "\n";
  $t = str_replace("\r\n", "\n", $t);
  $sep = "-- ----------------------------------------------------------------------------\n";
  $ini = strpos($t, $sep . "-- 2d) Cotizaciones.");
  $fin = strpos($t, $sep . "-- 2b) Inventario:");
  $ancla = strpos($t, $sep . "-- 3) Facturas (");
  if ($ini === false || $fin === false || $ancla === false || !($ini < $fin && $fin < $ancla)) {
      fwrite(STDERR, "No se encontraron los marcadores en el orden esperado; no se toco nada.\n");
      exit(1);
  }
  $bloque = substr($t, $ini, $fin - $ini);
  $t = substr($t, 0, $ini) . substr($t, $fin);
  $ancla = strpos($t, $sep . "-- 3) Facturas (");
  $t = substr($t, 0, $ancla) . $bloque . substr($t, $ancla);
  file_put_contents($f, str_replace("\n", $eol, $t));
  echo "Bloque 2d movido (", substr_count($bloque, "\n"), " lineas) antes de 3) Facturas\n";'
  ```
  Expected: `Bloque 2d movido (69 lineas) antes de 3) Facturas`.

  Then re-read the 2b and 2c headers (now around lines 49-52 and 84-92) and make two Edits.

  Edit C, old:
  ```
  --     Van antes de products (sus FKs), y products antes de facturas/gastos.
  ```
  new:
  ```
  --     Van antes de products (sus FKs), y products antes de cotizaciones/facturas/gastos.
  ```

  Edit D, old:
  ```
  --     Lo referencian por FK factura_items, gasto_items e inventory_movements: por
  --     eso se crea antes que ellas.
  ```
  new:
  ```
  --     Lo referencian por FK cotizacion_items, factura_items, gasto_items e
  --     inventory_movements: por eso se crea antes que ellas.
  ```

  Run:
  ```bash
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php; echo "exit=$?"
  grep -n "^-- 2b)\|^-- 2c)\|^-- 2d)\|^-- 3) Facturas\|^CREATE TABLE IF NOT EXISTS \(products\|cotizacion\)" C:/Users/Signos/Documents/edwin/api-gratex/db/tenant_schema.sql
  git -C C:/Users/Signos/Documents/edwin/api-gratex diff --stat -- db/tenant_schema.sql
  ```

  Expected:
  - every line is `[OK  ]`. The FK list starts `fk_products_category`, `fk_products_warehouse`, `cotizacion_items_ibfk_1`, `cotizacion_items_product_fk`, `cotizacion_ajustes_cot_fk`, ...;
  - `69/69 OK`, `exit=0`;
  - grep order: 2b (~50), 2c (~85), `products` (~93), 2d (~130), `cotizaciones` (~138), `cotizacion_items` (~160), `cotizacion_ajustes` (~187), `3) Facturas` (~199);
  - diffstat `1 file changed, 75 insertions(+), 30 deletions(-)`.

- [ ] **Step 9: `db/migrations/README.md`: range, FK-order note, idempotent-migration rule**

  Re-read the file (23 lines), then make two Edits.

  Edit 1, old:
  ```
    migraciones ya incluidas, hasta la 025). Las migraciones sueltas activas (012–025)
  ```
  new:
  ```
    migraciones ya incluidas, hasta la 026). Las migraciones sueltas activas (012–026)
  ```

  Edit 2, old:
  ```
       (p. ej. `products` va antes de `factura_items` y `gasto_items`).
  - Cambios al **master** (`gratex_master`): `db/master_migrations/` (+ reflejar
  ```
  new:
  ```
       (p. ej. `products` va antes de `cotizacion_items`, `factura_items` y
       `gasto_items`). `php tools/check_tenant_schema_orden.php` lo revisa sin
       MySQL.
  - Si la DDL de producción puede no ser la del repo, la migración se escribe
    idempotente: cada cambio se condiciona a `information_schema` y se ejecuta con
    `PREPARE/EXECUTE` (ver 018 y 026; en el master, 008, 010 y 011).
  - Cambios al **master** (`gratex_master`): `db/master_migrations/` (+ reflejar
  ```

- [ ] **Step 10: `docs/database/schema.md`, `docs/architecture.md`, `docs/setup.md`**

  Re-read `docs/database/schema.md`. If Task 3 already ran, its tenants row sits after line 56 and everything below shifts by 1; the Edits match on text. Make five Edits.

  Edit 1 (line 68), old:
  ```
  Fuente: `db/tenant_schema.sql` (snapshot consolidado, base + migraciones 001–016).
  ```
  new:
  ```
  Fuente: `db/tenant_schema.sql` (snapshot consolidado, base + migraciones 001–026).
  ```

  Edit 2 (line 73), old:
  ```
  | `cotizaciones` / `cotizacion_items` | Cotizaciones |
  ```
  new:
  ```
  | `cotizaciones` / `cotizacion_items` / `cotizacion_ajustes` | Cotizaciones; el formato del tenant decide qué columnas usa (migración 026) |
  ```

  Edit 3 (lines 124-126), old:
  ```
  ### `cotizaciones` / `cotizacion_items`
  `cotizaciones`: `id`, `code`, `date`, `client_id` (nullable), `client_name`, `total`.
  `cotizacion_items`: `id`, `cotizacion_id` (FK CASCADE), `description`, `amount` decimal(18,4), `quantity` decimal(12,3), `subtotal` decimal(18,2) (025).
  ```
  new:
  ```
  ### `cotizaciones` / `cotizacion_items` / `cotizacion_ajustes` (025 + 026)
  Cada tenant tiene un **formato de cotización** (`master.tenants.cotizacion_formato`,
  master_migration 011; código en `src/Utils/Cotizacion/`). Las filas del formato original
  (Gratex) dejan en `NULL` todas las columnas que agregó la 026.

  `cotizaciones`: `id`, `code`, `formato` (varchar(40), `NULL` = gratex), `numero` (int unsigned,
  UNIQUE `uk_cotizaciones_numero`: consecutivo `COT-000001`, `NULL` en Gratex), `date`,
  `client_id` (nullable), `client_name` (nullable desde la 026), `subtotal` / `itbis`
  (decimal(18,2): antes de ITBIS y suma del ITBIS de las líneas), `total` decimal(18,2) (025),
  `user_id` (referencia a `master.users.id`, sin FK cross-DB), `updated_at`.

  `cotizacion_items`: `id`, `cotizacion_id` (FK CASCADE), `product_id` (FK `products` `ON DELETE SET
  NULL`, índice `idx_cotizacion_items_product`; `NULL` = línea libre), `description`, `amount`
  decimal(18,4), `quantity` decimal(12,3), `subtotal` decimal(18,2) (025), `unidad_medida` (código
  DGII, ej. `43`), `indicador_facturacion` (1=ITBIS18 2=ITBIS16 3=ITBIS0 4=Exento),
  `indicador_bien_servicio` (1=Bien 2=Servicio), `itbis_amount` decimal(18,2).

  `cotizacion_ajustes` (026): `id`, `cotizacion_id` (FK `cotizaciones` CASCADE), `concepto`
  varchar(30) (clave del formato; Ferretería: `cargos_bancarios`, `manejo_bancario`, `mano_obra`,
  `abono`, `retencion_isr`), `monto` decimal(18,2). UNIQUE `uk_cotizacion_ajuste (cotizacion_id,
  concepto)`; solo se guardan los montos distintos de cero. Detalle:
  [../modules/cotizaciones-formatos.md](../modules/cotizaciones-formatos.md).
  ```

  Edit 4 (lines 276-280, inside the ``` relations block), old:
  ```
  cotizaciones 1───* cotizacion_items               (FK CASCADE)
  facturas     1───* factura_items                  (FK CASCADE)
  facturas     1───* aprobaciones_comerciales        (factura_id, soft link por e_ncf)
  gastos       1───* gasto_items                     (FK CASCADE)
  ncf_sequences / emisor_config / ecf_recibidos / proveedores / products — standalone
  ```
  new:
  ```
  cotizaciones 1───* cotizacion_items               (FK CASCADE)
  cotizaciones 1───* cotizacion_ajustes             (FK CASCADE, 026)
  facturas     1───* factura_items                  (FK CASCADE)
  facturas     1───* aprobaciones_comerciales        (factura_id, soft link por e_ncf)
  gastos       1───* gasto_items                     (FK CASCADE)
  products     1───* cotizacion_items / factura_items / gasto_items  (product_id, SET NULL)
  ncf_sequences / emisor_config / ecf_recibidos / proveedores — standalone
  ```

  Edit 5 (lines 292 and 294), two separate Edits.
  - Old: `| `db/tenant_schema.sql` | Snapshot consolidado de la DB de tenant (base + 001–016).` New: `| `db/tenant_schema.sql` | Snapshot consolidado de la DB de tenant (base + 001–026).`
  - Old: `Cambios incrementales para DBs de tenant **ya desplegados** (Gratex). Activas: 012–016 |` New: `Cambios incrementales para DBs de tenant **ya desplegados** (Gratex). Activas: 012–026 |`

  `docs/architecture.md:121`, old: `(tenant, activas 012–016; 001–011 en `deprecated/`),`. New: `(tenant, activas 012–026; 001–011 en `deprecated/`),`.

  `docs/setup.md:68`, old: `Crear la DB y aplicar el esquema del tenant (incluye base + migraciones 001–016):`. New: `Crear la DB y aplicar el esquema del tenant (incluye base + migraciones 001–026):`.

  The link to `docs/modules/cotizaciones-formatos.md` is created by T8. Until then it is a dangling link, which is accepted inside this branch.

- [ ] **Step 11: Final verification**

  Run:
  ```bash
  php -l C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php
  php C:/Users/Signos/Documents/edwin/api-gratex/tools/check_tenant_schema_orden.php | tail -1
  grep -rn "012\.\.025\|hasta la 025\|012–025\|001–016\|012–016" C:/Users/Signos/Documents/edwin/api-gratex/db C:/Users/Signos/Documents/edwin/api-gratex/docs --include=*.md --include=*.sql | grep -v "/migrations/025_"
  git -C C:/Users/Signos/Documents/edwin/api-gratex diff --check -- db docs tools
  git -C C:/Users/Signos/Documents/edwin/api-gratex status --short
  ```

  Expected:
  - `No syntax errors detected`;
  - `69/69 OK`;
  - grep prints nothing;
  - `diff --check` prints nothing;
  - status lists exactly: `M db/migrations/README.md`, `M db/tenant_schema.sql`, `M docs/architecture.md`, `M docs/database/schema.md`, `M docs/setup.md`, `?? db/migrations/026_cotizaciones_formatos.sql`, `?? tools/check_tenant_schema_orden.php`. Other sessions' files may also appear; leave them alone.

- [ ] **Step 12: Commit (path-limited)**

  ```bash
  git -C C:/Users/Signos/Documents/edwin/api-gratex add tools/check_tenant_schema_orden.php db/migrations/026_cotizaciones_formatos.sql
  git -C C:/Users/Signos/Documents/edwin/api-gratex commit -F - -- tools/check_tenant_schema_orden.php db/migrations/026_cotizaciones_formatos.sql db/tenant_schema.sql db/migrations/README.md docs/database/schema.md docs/architecture.md docs/setup.md <<'EOF'
  feat(db): migracion 026 de formatos de cotizacion y snapshot en su estado final

  - 026 idempotente (information_schema + PREPARE/EXECUTE): arregla el desfase
    del snapshot (user_id, updated_at, client_name NULL conservando tipo y
    collation), agrega formato/numero/subtotal/itbis, product_id + datos
    fiscales en cada linea y la tabla cotizacion_ajustes. Los tipos de las FK
    se copian de products.id y cotizaciones.id.
  - tenant_schema.sql: el bloque de cotizaciones pasa debajo de products (su
    FK nueva lo exige) con el estado final y los mismos nombres de indices/FKs.
  - tools/check_tenant_schema_orden.php revisa sin MySQL el orden de las FK,
    el estado final y el SQL dinamico de la 026.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git -C C:/Users/Signos/Documents/edwin/api-gratex show --stat --oneline HEAD
  ```
  Expected: one commit with the 7 files.

**Manual server checks.** These can't run locally. T8 lists them in `tests/test_cotizaciones_ferreteria.http` and the runbook:
1. **Old snapshot, run twice.** On a scratch DB built from the OLD snapshot (`git show HEAD~1:db/tenant_schema.sql`), run 026 twice.
   - First run: step 0 shows InnoDB×3 and `int(11)` ids. E1 has 16 rows, with `client_name` `YES`. E2 has 3 indexes and E3 has 2 FKs (SET NULL, CASCADE).
   - Second run: every step executes `DO 0`. `SHOW CREATE TABLE cotizacion_items` is identical before and after it, with no duplicate index.
2. **New snapshot.** Apply the NEW snapshot to an empty DB (or run `php tools/create_tenant.php` against a local test master). It must finish without errno 150/1824, and `SHOW TABLES` must include `cotizacion_ajustes`.
3. **Gratex DB, before deploying code.** On a copy of the Gratex DB, run 026, then the legacy Gratex save path (POST /api/cotizaciones with the CotizacionFormView body). It must still return `{id, code, message}`.

---

### Task 3: Master migration 011 + `master_schema.sql` + `GET /api/branding` exposes `cotizacion_formato`

**Files:**
- Create: `C:/Users/Signos/Documents/edwin/api-gratex/db/master_migrations/011_add_tenant_cotizacion_formato.sql`
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/db/master_schema.sql:52-54`. Insert 2 lines after 53, after `pdf_accent_color`'s COMMENT and before `ambiente`.
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/src/Controllers/brandingController.php`
  - :5 (route comment)
  - :83-84 (the `brCurrent()` return array: add a key after `'available_templates'`, before `];`)
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/docs/modules/branding-plantillas.md:45` (GET row)
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/docs/database/schema.md:56` (insert the `cotizacion_formato` row after `pdf_accent_color`)
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/tests/test_branding.http:8`
- Modify (FE repo): `C:/Users/Signos/Documents/edwin/fiscalo/docs/plantillas-factura.md:39` (GET row)
- Test: `php -l` + a `php -r` assertion one-liner. No DB, and the controller runs code on include, so it can't be unit-loaded. Server checks are below.

**Interfaces:**
- **Consumes:** nothing.
  - `brCurrent(int $tenantId)` already loads `$tenant = MasterDatabase::getInstance()->getTenantById($tenantId)`. That is `SELECT * FROM tenants WHERE id = :id AND activo = 1`, the same row `TenantResolver::resolveById()` stores and `TenantResolver::current()` returns.
- **Produces:**
  - Column `master.tenants.cotizacion_formato VARCHAR(40) NOT NULL DEFAULT 'gratex'`, `AFTER pdf_accent_color`.
  - `GET /api/branding` → `data.cotizacion_formato: string`. It is `(string) ($tenant['cotizacion_formato'] ?? 'gratex')`, so it is `'gratex'` before 011 runs.
  - The value is raw, not validated. Both sides map unknown values to gratex: the FE through `esFormato` (T11) and the BE through `CotizacionFormatos::existe`/`delTenant` (T6).
  - The PUT whitelist is unchanged (`MasterDatabase::updateTenantBranding` `$allowed`). A PUT body with `cotizacion_formato` is ignored.
- **Contract lines this satisfies** (copied):
  - `BrandingData gains: cotizacion_formato?: string` (T9).
  - `CotizacionFormatos::delTenant(): string // TenantResolver::current()['cotizacion_formato'] ?? 'gratex', validated with existe(); unknown => 'gratex'` (T6).

- [ ] **Step 1: Preflight + failing check**

  Run:
  ```bash
  git -C C:/Users/Signos/Documents/edwin/api-gratex branch --show-current
  git -C C:/Users/Signos/Documents/edwin/api-gratex status --short -- db/master_schema.sql db/master_migrations src/Controllers/brandingController.php docs/modules/branding-plantillas.md docs/database/schema.md tests/test_branding.http
  php -r '$r = "C:/Users/Signos/Documents/edwin/api-gratex/"; $s = file_get_contents($r . "db/master_schema.sql"); $f = $r . "db/master_migrations/011_add_tenant_cotizacion_formato.sql"; $m = is_file($f) ? file_get_contents($f) : ""; $a = preg_match("/^\s+cotizacion_formato\s+VARCHAR\(40\)\s+NOT NULL DEFAULT \x27gratex\x27\s*$/m", $s); $b = preg_match("/ADD COLUMN cotizacion_formato VARCHAR\(40\) NOT NULL DEFAULT \x27\x27gratex\x27\x27 .* AFTER pdf_accent_color\x27,/", $m) && substr_count($m, "PREPARE s_col FROM @sql_col;") === 1 && substr_count($m, "EXECUTE s_col;") === 1 && substr_count($m, "DEALLOCATE PREPARE s_col;") === 1; echo "master_schema:", $a ? "OK" : "FALLO", " 011:", $b ? "OK" : "FALLO", "\n"; exit($a && $b ? 0 : 1);'; echo "exit=$?"
  ```
  Expected: `feat/cotizacion-formatos`, an empty status, `master_schema:FALLO 011:FALLO` and `exit=1`.

- [ ] **Step 2: Write `db/master_migrations/011_add_tenant_cotizacion_formato.sql`**

  Create it with exactly:
  ```sql
  -- =============================================================================
  -- Master Migration 011: formato de cotizacion por tenant.
  --
  -- Ejecutar contra la base MASTER, UNA vez. Idempotente: se puede correr dos
  -- veces sin error, y la segunda no toca nada.
  -- Reflejado en db/master_schema.sql (instalaciones nuevas).
  --
  -- NOTA: el nombre de la master DB cambia por entorno (gratex_master en local,
  -- mtldtmte_master_gratex en el server). Selecciona la base ANTES de correr esto
  -- (en phpMyAdmin basta con entrar a la base; por CLI usa `USE <tu_master>;`).
  --
  -- PARA QUE: la cotizacion (pantalla, reglas, numeracion y PDF) era la de Gratex
  -- para todos los tenants. Ahora cada tenant tiene un formato de cotizacion: un
  -- modulo de codigo en src/Utils/Cotizacion/ (api) y otro en
  -- src/features/cotizaciones/formatos/ (fiscalo). Esta columna dice cual usa: la
  -- API la lee de TenantResolver::current() para elegir el formato al guardar, y
  -- GET /api/branding la devuelve para que el front elija la pantalla.
  --
  -- Default 'gratex': todos los tenants actuales quedan exactamente como hoy.
  -- Se cambia SOLO por SQL (no hay pantalla ni PUT /api/branding para esto): un
  -- formato es codigo hecho para un cliente concreto.
  --
  -- ORDEN DE DESPLIEGUE: correr ESTA migracion y la 026 de cada tenant ANTES de
  -- subir el codigo nuevo. El codigo tolera que la columna no exista (sin ella
  -- todo tenant es 'gratex'), pero un tenant solo se pasa a otro formato cuando
  -- su DB ya tiene la 026.
  -- =============================================================================

  -- 1) Columna ('gratex' = el formato de siempre).
  SET @has_col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenants'
      AND COLUMN_NAME = 'cotizacion_formato'
  );
  SET @sql_col := IF(@has_col = 0,
    'ALTER TABLE tenants ADD COLUMN cotizacion_formato VARCHAR(40) NOT NULL DEFAULT ''gratex'' COMMENT ''Formato de cotizacion: gratex | ferreteria (src/Utils/Cotizacion/)'' AFTER pdf_accent_color',
    'DO 0');
  PREPARE s_col FROM @sql_col;
  EXECUTE s_col;
  DEALLOCATE PREPARE s_col;

  -- 2) Verificacion: en la primera corrida todos los tenants salen en 'gratex'.
  SELECT id, nombre, rnc, cotizacion_formato FROM tenants ORDER BY id;

  -- =============================================================================
  -- Como pasar un tenant a otro formato (ej. Ferreteria).
  --
  --   0. Antes: su DB de tenant ya tiene la migracion 026, su emisor_config tiene
  --      telefono y correo (salen en el pie del PDF), y sus roles incluyen el
  --      modulo `cotizaciones`.
  --
  --   1. UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <id>;
  --
  --   2. Verificar:
  --      SELECT id, nombre, cotizacion_formato FROM tenants WHERE id = <id>;
  --
  -- Volver al de Gratex: UPDATE tenants SET cotizacion_formato = 'gratex' WHERE id = <id>;
  --   OJO: las cotizaciones NUEVAS de ese tenant saldrian con el PDF de Gratex
  --   (con la cuenta de banco de Gratex). Quita el modulo `cotizaciones` de sus
  --   roles hasta corregir el formato. Las ya guardadas conservan su formato.
  --   Ver docs/modules/cotizaciones-formatos.md.
  -- =============================================================================
  ```

- [ ] **Step 3: Reflect the column in `db/master_schema.sql`**

  Re-read lines 48-58.

  Edit, old (lines 52-54):
  ```
    pdf_accent_color    CHAR(7)        NULL
                          COMMENT 'Color de acento hex #RRGGBB (NULL = colores por defecto de la plantilla)',
    ambiente            VARCHAR(20)    NOT NULL DEFAULT 'ecf',
  ```
  new:
  ```
    pdf_accent_color    CHAR(7)        NULL
                          COMMENT 'Color de acento hex #RRGGBB (NULL = colores por defecto de la plantilla)',
    cotizacion_formato  VARCHAR(40)    NOT NULL DEFAULT 'gratex'
                          COMMENT 'Formato de cotizacion: gratex | ferreteria (src/Utils/Cotizacion/). Se cambia solo por SQL. Ver master_migrations/011',
    ambiente            VARCHAR(20)    NOT NULL DEFAULT 'ecf',
  ```

- [ ] **Step 4: Re-run the check (must pass)**

  Run the same `php -r '...'` one-liner from Step 1.

  Expected: `master_schema:OK 011:OK`, `exit=0`.

- [ ] **Step 5: Failing check for the endpoint**

  Run:
  ```bash
  grep -c "'cotizacion_formato'" C:/Users/Signos/Documents/edwin/api-gratex/src/Controllers/brandingController.php; echo "exit=$?"
  ```
  Expected: `0`, `exit=1`.

- [ ] **Step 6: `brandingController.php`: expose the value in `brCurrent()`**

  Re-read lines 1-20 and 65-85, then make two Edits.

  Edit 1 (line 5), old:
  ```php
  //   GET    /api/branding          -> branding actual + plantillas disponibles
  ```
  new:
  ```php
  //   GET    /api/branding          -> branding actual + plantillas disponibles
  //                                    + cotizacion_formato (solo lectura)
  ```

  Edit 2 (lines 83-85), old:
  ```php
          'available_templates' => BrandingResolver::availableTemplates($tenantId),
      ];
  }
  ```
  new:
  ```php
          'available_templates' => BrandingResolver::availableTemplates($tenantId),
          // Formato de cotizacion del tenant (master.tenants.cotizacion_formato,
          // migracion master 011): con esto el front elige la pantalla de
          // cotizacion. Sale de la misma fila que TenantResolver::current(), de
          // donde el backend elige el formato al guardar, asi que los dos lados
          // ven el mismo valor. Solo lectura: se cambia por SQL y el PUT no lo
          // acepta. Sin la columna (011 sin correr) todo tenant es 'gratex'.
          'cotizacion_formato'  => (string) ($tenant['cotizacion_formato'] ?? 'gratex'),
      ];
  }
  ```

  Why `$tenant` and not `TenantResolver::current()`:
  - **Same data.** `brCurrent` already holds the fresh master row for the same tenant (`getTenantById`, the same query `TenantResolver::resolveById` applied).
  - **Stays correct after a PUT.** It is also right inside the PUT branch, which calls `brCurrent()` after `updateTenantBranding`. There `TenantResolver::$current` is stale, as the existing comment at :268-269 warns.
  - **No new dependency.** The controller needs no new `require_once`.

  Run:
  ```bash
  php -l C:/Users/Signos/Documents/edwin/api-gratex/src/Controllers/brandingController.php
  grep -n "'cotizacion_formato'" C:/Users/Signos/Documents/edwin/api-gratex/src/Controllers/brandingController.php
  ```
  Expected:
  - `No syntax errors detected in ...brandingController.php`;
  - exactly one hit, line 91: `'cotizacion_formato'  => (string) ($tenant['cotizacion_formato'] ?? 'gratex'),`.

- [ ] **Step 7: Backend docs and the branding .http**

  **`docs/modules/branding-plantillas.md:45`.** Re-read lines 41-50, then edit the GET row.

  Old:
  ```
  | GET | `/api/branding` | — | `{template, accent_color, logo_path, has_custom_logo, logo_data_uri, available_templates}`. `logo_data_uri` es el logo listo para `<img src>`: `logos/` no esta bajo `/api/public/`, asi que el `.htaccess` manda cualquier URL directa a `index.php`, y un `<img>` no puede mandar `X-API-KEY`. Null si el tenant no tiene logo |
  ```
  New:
  ```
  | GET | `/api/branding` | — | `{template, accent_color, logo_path, has_custom_logo, logo_data_uri, available_templates, cotizacion_formato}`. `logo_data_uri` es el logo listo para `<img src>`: `logos/` no esta bajo `/api/public/`, asi que el `.htaccess` manda cualquier URL directa a `index.php`, y un `<img>` no puede mandar `X-API-KEY`. Null si el tenant no tiene logo. `cotizacion_formato` (`gratex` \| `ferreteria`, master_migration 011) es el formato de cotización del tenant: con él el front elige la pantalla. Solo lectura (se cambia por SQL; el PUT no lo acepta). Ver [cotizaciones-formatos.md](cotizaciones-formatos.md) |
  ```

  **`docs/database/schema.md:56`.** Re-read lines 41-61, then edit.

  Old:
  ```
  | `pdf_accent_color` | varchar(7) | `#RRGGBB` opcional |
  ```
  New:
  ```
  | `pdf_accent_color` | varchar(7) | `#RRGGBB` opcional |
  | `cotizacion_formato` | varchar(40) | `gratex` (default) \| `ferreteria`: formato de cotización (master_migration 011). Solo por SQL; lo devuelve `GET /api/branding` |
  ```

  **`tests/test_branding.http:8`.**

  Old:
  ```
  ### Branding actual + plantillas disponibles
  ```
  New:
  ```
  ### Branding actual + plantillas disponibles + cotizacion_formato (gratex | ferreteria)
  ```

- [ ] **Step 8: Commit the backend (path-limited)**

  ```bash
  git -C C:/Users/Signos/Documents/edwin/api-gratex add db/master_migrations/011_add_tenant_cotizacion_formato.sql
  git -C C:/Users/Signos/Documents/edwin/api-gratex commit -F - -- db/master_migrations/011_add_tenant_cotizacion_formato.sql db/master_schema.sql src/Controllers/brandingController.php docs/modules/branding-plantillas.md docs/database/schema.md tests/test_branding.http <<'EOF'
  feat(branding): formato de cotizacion por tenant en master y en GET /api/branding

  - Master 011 (idempotente): tenants.cotizacion_formato VARCHAR(40) NOT NULL
    DEFAULT 'gratex'; todos los tenants actuales quedan como hoy. Se cambia
    solo por SQL. Reflejado en master_schema.sql.
  - GET /api/branding devuelve cotizacion_formato (de la misma fila del
    tenant; 'gratex' si la columna aun no existe) para que el front elija la
    pantalla de cotizacion. El PUT no lo acepta.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git -C C:/Users/Signos/Documents/edwin/api-gratex show --stat --oneline HEAD
  ```
  Expected: one commit with the 6 files.

  If Task 2's uncommitted `docs/database/schema.md` edits are in the working tree, the path-limited commit includes them too. Finish Task 2's commit (Step 12) before this one, or commit both tasks' docs together and mention both in the message.

- [ ] **Step 9: Frontend doc row + commit in fiscalo (path-limited)**

  **`C:/Users/Signos/Documents/edwin/fiscalo/docs/plantillas-factura.md:39`.** Re-read lines 35-44, then edit.

  Old:
  ```
  | GET | `/api/branding` | — | `{template, accent_color, logo_path, has_custom_logo, available_templates}` |
  ```
  New:
  ```
  | GET | `/api/branding` | — | `{template, accent_color, logo_path, has_custom_logo, logo_data_uri, available_templates, cotizacion_formato}`. `cotizacion_formato` (`gratex` \| `ferreteria`) elige la pantalla de cotización (`src/features/cotizaciones/formatos/`); solo lectura, se cambia por SQL en `master.tenants` |
  ```

  Commit only that path. The FE chain may have unrelated staged work, so don't `git add` anything else:
  ```bash
  git -C C:/Users/Signos/Documents/edwin/fiscalo branch --show-current
  git -C C:/Users/Signos/Documents/edwin/fiscalo commit -F - -- docs/plantillas-factura.md <<'EOF'
  docs(branding): GET /api/branding devuelve cotizacion_formato

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git -C C:/Users/Signos/Documents/edwin/fiscalo show --stat --oneline HEAD
  ```
  Expected: branch `feat/cotizacion-formatos` and one commit touching only `docs/plantillas-factura.md`. T16 later adds its formato note to the same file in other lines; it must not revert this row.

**Manual server checks.** These can't run locally. T8 lists them in `tests/test_cotizaciones_ferreteria.http` and the runbook:
1. Run 011 twice on the master. The second run executes `DO 0`, and the final SELECT lists every tenant with `gratex`.
2. `GET /api/branding` with a Gratex token returns `"cotizacion_formato": "gratex"`. After `UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <ferretería>`, a Ferretería token returns `"ferreteria"`. Do this only after its 026, per the 011 footer.
3. `PUT /api/branding {"cotizacion_formato":"gratex"}` returns 422 "No hay cambios para guardar." (the field is ignored), and the column is unchanged.
4. **Before 011:** deploy to a master without the column. `GET /api/branding` still answers 200 with `"cotizacion_formato": "gratex"`, since the lookup is `SELECT *` and `?? 'gratex'`.

---

## Part C: Task 5

### Task 5: `FerreteriaCotizacionPdf` (pure FPDF renderer) + CLI `--pdf [--grid]`

**Files:**
- Create: `C:/Users/Signos/Documents/edwin/api-gratex/src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`. Holds the contract's class plus a small FPDF subclass, `FerreteriaCotizacionHoja`, in the same file.
- Modify: `C:/Users/Signos/Documents/edwin/api-gratex/tools/test_cotizacion_ferreteria.php`. T1 creates this file and T4 adds to it, so it has no line numbers yet.
  - Insert the T5 section **directly above T1's 3-line marker block** (`// ---…---` / `// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.` / `// ---…---`), followed by one blank line. The marker stays the last thing before the summary `printf("\n%d/%d OK\n", $total - $fallos, $total);` and `exit($fallos === 0 ? 0 : 1);` (plan A, "The harness API").
  - That puts it after T4's section.
  - T6 and T7 later add their own sections the same way, after this one.
- Test: the same script.
  - Plain run: the T5 assertions.
  - `--pdf`: also writes `tools/out/cotizacion_ferreteria_{pintura,b150000049,ceramicas,largo_60,pintura_retencion_abono,vista_previa}.pdf`.
  - `--grid`: the same files with the 10 mm calibration grid. `--grid` implies `--pdf`.
- Read only; these files are the patterns T5 copies. Do NOT edit any of them:
  - `src/Utils/Pdf/libs.php:12-21`: loads FPDF from `vendor/fpdf/fpdf.php` (FPDF 1.86, tracked in git).
  - `src/Utils/FacturaPdfGenerator.php`:
    - `:223-273` `NbLines`. Copied as `FerreteriaCotizacionHoja::renglones`.
    - `:183-215` `Row` and `CheckPageBreak`. These are the wrapped-row idea. T5 measures the row first and decides the break itself.
    - `:294-307` `Footer`, which prints `'Página ' . PageNo() . ' de {nb}'`.
    - `:316-341` `drawDebugGrid`.
  - `src/Utils/Pdf/FacturaTemplate.php`:
    - `:106-110` `enc()`.
    - `:118-137` `drawLogo`, the box-fit math.
    - `:149-162` `drawLogoOrNombre`, which prints the name when there is no logo.
  - `src/Utils/Pdf/Custom/FerreventuraTemplate.php`:
    - `:39-47` uses Times.
    - `:62-69` and `:171-183` center the logo using `anchoLogo`.
    - `:25` is its #BCD6ED blue. The spec uses #BDD7EE = `[189, 215, 238]`.
  - `src/Utils/Pdf/EcfDocumento.php:648-661`: `public static function textoPrecio($valor): string`.
  - `vendor/fpdf/fpdf.php`:
    - `:198-204` `SetAutoPageBreak`.
    - `:219-226` `SetCompression`.
    - `:258-262` `AliasNbPages`.
    - `:580-600` `Cell` auto-break.
    - `:1497-1511` `_putstreamobject` (`gzcompress` + `/Filter /FlateDecode`).
    - `:1536-1564` `_putpage`. It writes `<</Type /Page` and replaces `{nb}`.
- Not modified: `C:/Users/Signos/Documents/edwin/api-gratex/.gitignore` (lines 1-8). The repo has no ignore pattern for generated tool outputs:
  - lines 1-6 cover secrets and certificates;
  - lines 7-8 `tools/xml_integracion/` cover clients' signed fiscal XMLs, ignored for privacy;
  - generated PDFs such as `tools/test_ri_norma.pdf` are tracked.

  So `tools/out/` is **not** gitignored. It stays untracked, and the commit step stages explicit paths only.
- Not touched (Gratex must not change): `src/Utils/CotizacionPdfGenerator.php`, `src/Utils/Pdf/*`, `src/Utils/FacturaPdfGenerator.php`.

**Interfaces:**
- Consumes:
  - T4 (contract): `FerreteriaFormato::totales(array $lineas, array $ajustes): array` (used by the test only), `FerreteriaFormato::formatearRnc(?string $rnc): string` and `FerreteriaFormato::fechaLarga(string $fecha): string`.
  - T1 (contract): `Redondeo::r2(float $x): float` and `Redondeo::r4(float $x): float`. They're used only by the defensive line-total fallback.
  - Existing: `EcfDocumento::textoPrecio($valor): string`.
  - Existing: FPDF through `src/Utils/Pdf/libs.php`.
  - From the T1 harness: the `$chk(string $desc, bool $ok)` closure, which counts into `$fallos`/`$total` and prints `[OK  ] ...` / `[FALLA] ...`.
  - From T1's fixtures: `tools/fixtures/cotizacion_ferreteria.json` (cases `pintura`, `pintura_retencion_abono`, `pintura_mano_obra`, `b150000049`, `ceramicas`, `mixto`, `largo_60`; lines `{quantity, description, amount, indicador_facturacion}`) and `tools/fixtures/ferreteria_logo.jpeg`.
- Produces (contract, unchanged):
  ```php
  final class FerreteriaCotizacionPdf {
      /**
       * @param array{code:?string (null => 'VISTA PREVIA'), date:string, items:array<int,array{description:string,quantity:float,amount:float}>,
       *              totales:array (exact output of FerreteriaFormato::totales)} $cotizacion
       * @param array $emisor   emisor_config row keys: rnc, razon_social, nombre_comercial, direccion, telefono, correo
       * @param array $cliente  keys: razon_social, company_name, client_name, rnc
       */
      public function __construct(array $cotizacion, array $emisor, array $cliente, ?string $logoPath);
      public function render(): string;   // PDF bytes (FPDF Output('S')), two-pass for 'Página X de Y'
  }
  ```
- Produces (additive, outside the contract):
  - `public function setDebugGrid(bool $v = true): void`. Only the CLI calls it; production never does.
  - `final class FerreteriaCotizacionHoja extends FPDF`, an internal helper in the same file: `public bool $paginar`, `public bool $grilla`, `Footer()`, `cabe(float $alto): bool`, `renglones(float $w, string $txt): int`.

**Design decisions (keep them, they are tested):**
- **Page geometry.**
  - Letter portrait in mm, with margins of 15 left/right, 10 top and 15 bottom.
  - Columns: Cantidad 24 | Descripción, the remaining 102.9 | Valor Unitario 29 | Valor Total RD$ 30.
  - Times only.
  - Rows use a 4.5 mm line height. The header band is 7 mm.
- **Page breaks are decided by the renderer.** `SetAutoPageBreak(false, 15)`, because FPDF's own break would split a row's cells across pages. `cabe($alto)` compares against `PageBreakTrigger`. The rules:
  - An item row is drawn only if it fits.
  - The last item also needs room for the marker row, so the marker never sits alone on a page.
  - A pending table header needs room for itself plus the next row. So the header only appears on pages that continue rows, and it never sits alone at the bottom of a page.
  - The closing block (totals + "Recibido por" + footer) is measured whole. If it doesn't fit, it moves to a new page **without** a table header.
  - Page 1 alone carries the logo, address, RNC, title and the left block. `Header()` is not overridden.
- **"Página X de Y" uses two passes.**
  - Pass 1 draws with `paginar = false` and reads `PageNo()`.
  - Pass 2 draws again with `paginar = ($paginas > 1)` and `AliasNbPages()`.
  - `Footer()` prints at `SetY(-11)`, inside the bottom margin, so printing it never moves content. Both passes paginate the same way.
- **Compression is left on; the test inflates the streams.**
  - FPDF compresses page streams with `gzcompress`, and the renderer gets **no** test-only flag and no `SetCompression(false)`.
  - The CLI takes the first N `stream ... endstream` bodies, where N = the number of `/Type /Page\b` matches. FPDF writes the page contents first, in order, and the resources (the JPEG logo) after them.
  - It runs `gzuncompress` on each and searches for the ISO-8859-1 text inside `(...) Tj`.
  - So the test checks the same bytes the user downloads.
- **Logo.**
  - It fits a 75×28 mm box, keeps its aspect ratio and is centered on the page width (same math as `FacturaTemplate::drawLogo`).
  - A missing file, a non-image, or an image FPDF cannot read (for example an interlaced PNG, which throws) never breaks the PDF. The renderer prints `razon_social` in Times bold 16 instead, and `error_log`s the reason.
- **Footer** = `razon_social` (the legal name, never `nombre_comercial`), then the email in blue (#0563C1), underlined and linked with `mailto:` (the link rectangle is only as wide as the text), then `Teléfono <tel>`. Each part prints only when it has a value.
- **Known limit.** A row taller than a whole page can only come from a pathological newline-only description, since the 1000-character cap applies. Such a row goes to a fresh page and overflows there; the renderer never loops.

- [ ] **Step 1: Pre-flight: T1 and T4 are in, the branch is right, and the tree is clean**

Run (Git Bash):
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && git branch --show-current && git status --short \
  && ls src/Utils/Cotizacion/Redondeo.php src/Utils/Cotizacion/FerreteriaFormato.php tools/fixtures/cotizacion_ferreteria.json tools/fixtures/ferreteria_logo.jpeg \
  && php tools/test_cotizacion_ferreteria.php | tail -1
```
Expected:
- `feat/cotizacion-formatos`;
- no `git status` lines touching the T5 files;
- the 4 paths listed;
- a last line `N/N OK`, where N is T1's and T4's count.

If T4 isn't in yet, stop: T5 depends on it.

- [ ] **Step 2: Write the failing test. Append the T5 section to the harness**

Open `tools/test_cotizacion_ferreteria.php` and re-read it first. Then paste the block below **between the end of T4's section and T1's marker block**: with the Edit tool, use the 3 marker lines as `old_string` and, as `new_string`, the block below, one blank line, and the same 3 marker lines. The marker and the final `printf`/`exit` stay last. The block assumes only `$chk`, `$argv` and the fixture files. Every variable it defines is specific to this section (`*Pdf` / `$casosPdf` / `$largoPdf`...), so it can't clobber the T1/T4/T7 sections.

```php
// ===========================================================================
// T5 — PDF de Ferreteria (FerreteriaCotizacionPdf)
// ===========================================================================
// Las aserciones corren siempre (sin BD, ~0.5 s). Con --pdf ademas escribe los
// PDF en tools/out/ para compararlos a ojo con la hoja de Excel; --grid (que
// implica --pdf) les superpone la rejilla de calibracion de 10 mm.
//
// FPDF comprime el contenido de cada pagina (FlateDecode). No se apaga la
// compresion ni se agrega un modo "de prueba" al renderizador: el script infla
// los streams con gzuncompress y busca el texto ahi, asi se prueba el mismo
// PDF que recibe el usuario.

require_once __DIR__ . '/../src/Utils/Cotizacion/FerreteriaCotizacionPdf.php';

echo "\n== T5: PDF de Ferreteria (FerreteriaCotizacionPdf) ==\n";

$argsPdf = array_slice($argv ?? [], 1);
$conGrillaPdf = in_array('--grid', $argsPdf, true);
$escribirPdf = $conGrillaPdf || in_array('--pdf', $argsPdf, true);

$fxPdf = json_decode((string) file_get_contents(__DIR__ . '/fixtures/cotizacion_ferreteria.json'), true);
$casosPdf = [];
foreach ($fxPdf['casos'] as $casoFx) {
    $casosPdf[$casoFx['id']] = $casoFx;
}
$logoPdf = is_file(__DIR__ . '/fixtures/ferreteria_logo.jpeg') ? __DIR__ . '/fixtures/ferreteria_logo.jpeg' : null;
$chk('fixture: tools/fixtures/ferreteria_logo.jpeg existe', $logoPdf !== null);

// Lo mismo que le pasara FerreteriaFormato::pdf()/preview(): items + totales ya
// calculados por totales(). Los casos sin fecha, cliente o ajustes propios
// (largo_60, mixto) usan los de pintura.
$armarPdf = static function (array $caso, ?string $code, ?string $logo, bool $grilla = false) use ($fxPdf, $casosPdf): FerreteriaCotizacionPdf {
    $sinAjustes = ['cargos_bancarios' => 0, 'manejo_bancario' => 0, 'mano_obra' => 0, 'abono' => 0, 'retencion_isr' => false];
    $lineas = array_map(static fn(array $l): array => [
        'quantity' => (float) $l['quantity'],
        'amount' => (float) $l['amount'],
        'indicador_facturacion' => (int) $l['indicador_facturacion'],
    ], $caso['lineas']);
    $cotizacion = [
        'code' => $code,
        'date' => $caso['date'] ?? $casosPdf['pintura']['date'],
        'items' => array_map(static fn(array $l): array => [
            'description' => (string) $l['description'],
            'quantity' => (float) $l['quantity'],
            'amount' => (float) $l['amount'],
        ], $caso['lineas']),
        'totales' => FerreteriaFormato::totales($lineas, $caso['ajustes'] ?? $sinAjustes),
    ];
    $pdf = new FerreteriaCotizacionPdf($cotizacion, $fxPdf['emisor'], $caso['cliente'] ?? $casosPdf['pintura']['cliente'], $logo);
    $pdf->setDebugGrid($grilla);
    return $pdf;
};

// Paginas = objetos "/Type /Page" (el \b deja fuera el "/Type /Pages" del arbol).
$contarPaginas = static fn(string $bytes): int => (int) preg_match_all('#/Type /Page\b#', $bytes);
// FPDF escribe primero el contenido de las paginas, en orden, y despues los
// recursos (el logo): los N primeros streams son las N paginas.
$paginasPdf = static function (string $bytes) use ($contarPaginas): array {
    preg_match_all('/stream\n(.*?)\nendstream/s', $bytes, $m);
    $paginas = [];
    foreach (array_slice($m[1], 0, $contarPaginas($bytes)) as $s) {
        $plano = @gzuncompress($s);
        $paginas[] = $plano === false ? $s : $plano;
    }
    return $paginas;
};
// El texto va en ISO-8859-1 dentro de "(...) Tj": se busca igual.
$iso = static fn(string $s): string => mb_convert_encoding($s, 'ISO-8859-1', 'UTF-8');

// --- el renderizador es puro (spec 7): ni BD ni tenant ni branding ---
$codigoPdf = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../src/Utils/Cotizacion/FerreteriaCotizacionPdf.php')) as $tok) {
    if (is_array($tok) && in_array($tok[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $codigoPdf .= is_array($tok) ? $tok[1] : $tok;
}
$chk('puro: no usa Database, TenantResolver, BrandingResolver ni EmisorConfigModel',
    !preg_match('/\b(Database|TenantResolver|BrandingResolver|EmisorConfigModel)\b/', $codigoPdf));

// --- pintura: 1 pagina, numero, totales de su hoja ---
$bytesPintura = $armarPdf($casosPdf['pintura'], $casosPdf['pintura']['code'], $logoPdf)->render();
$txtPintura = implode("\n", $paginasPdf($bytesPintura));
$chk('pintura: render() devuelve un PDF (%PDF)', str_starts_with($bytesPintura, '%PDF'));
$chk('pintura: exactamente 1 pagina', $contarPaginas($bytesPintura) === 1);
$chk('pintura: una sola pagina no lleva "Pagina X de Y"', !str_contains($txtPintura, $iso('Página 1 de')));
$chk('pintura: imprime su numero COT-000001', str_contains($txtPintura, '(COT-000001)'));
$chk('pintura: titulo, fecha larga y rotulo del cliente',
    str_contains($txtPintura, $iso('(COTIZACIÓN MERCANCÍAS)'))
    && str_contains($txtPintura, '(MAYO 14/2026.-)')
    && str_contains($txtPintura, $iso('(NOMBRE O RAZÓN SOCIAL)')));
$chk('pintura: RNC del emisor y del cliente formateados',
    str_contains($txtPintura, '(RNC 132-61512-3)') && str_contains($txtPintura, '(401-51513-1)'));
$chk('pintura: cabecera de las 4 columnas',
    str_contains($txtPintura, '(Cantidad)') && str_contains($txtPintura, $iso('(Descripción mercancías)'))
    && str_contains($txtPintura, '(Valor Unitario)') && str_contains($txtPintura, '(Valor Total RD$)'));
$chk('pintura: linea 7.00 x 2,000.00 = 14,000.00',
    str_contains($txtPintura, '(7.00)') && str_contains($txtPintura, '(2,000.00)') && str_contains($txtPintura, '(14,000.00)'));
$chk('pintura: marca "No hay mas productos"', str_contains($txtPintura, $iso('No hay más productos debajo de la línea')));
$chk('pintura: Sub-total 41,860.00 / ITBIS 18% 7,534.80 / TOTAL 49,394.80',
    str_contains($txtPintura, '(41,860.00)') && str_contains($txtPintura, '(ITBIS 18%)')
    && str_contains($txtPintura, '(7,534.80)') && str_contains($txtPintura, '(49,394.80)'));
$chk('pintura: sin cargos, retencion, abono ni restante (no tienen valor)',
    !str_contains($txtPintura, 'Cargos bancarios') && !str_contains($txtPintura, 'Costo mano de obra')
    && !str_contains($txtPintura, 'Tercero 5%') && !str_contains($txtPintura, 'Abono') && !str_contains($txtPintura, 'Restante'));
$chk('pintura: Recibido por + pie (razon social, correo, telefono)',
    str_contains($txtPintura, '(Recibido por:)') && str_contains($txtPintura, '(FERREHERRAMIENTAS VENTURA, SRL)')
    && str_contains($txtPintura, '(yaironventura0201@hotmail.com)') && str_contains($txtPintura, $iso('(Teléfono 829-898-7798)')));
$chk('pintura: el correo del pie es un enlace mailto', str_contains($bytesPintura, '/URI (mailto:yaironventura0201@hotmail.com)'));
$chk('pintura: no imprime cuenta bancaria ni sello de Gratex', !str_contains($txtPintura, '790371603') && !str_contains($txtPintura, 'Cuenta'));

// --- vista previa: sin numero ---
$txtPrevia = implode("\n", $paginasPdf($armarPdf($casosPdf['pintura'], null, $logoPdf)->render()));
$chk('vista previa (code null): imprime VISTA PREVIA', str_contains($txtPrevia, '(VISTA PREVIA)'));
$chk('vista previa: no inventa un numero COT-', !str_contains($txtPrevia, 'COT-'));

// --- filas de ajustes: solo las que tienen valor ---
$txtRet = implode("\n", $paginasPdf($armarPdf($casosPdf['pintura_retencion_abono'], 'COT-000001', $logoPdf)->render()));
$chk('retencion+abono: Retencion 2,093.00, Abono 10,000.00, Restante (Adeudado) 37,301.80',
    str_contains($txtRet, $iso('(Retención Renta por Tercero 5%)')) && str_contains($txtRet, '(2,093.00)')
    && str_contains($txtRet, '(Abono realizado)') && str_contains($txtRet, '(10,000.00)')
    // FPDF escapa los parentesis del texto: "(Restante \(Adeudado\))".
    && str_contains($txtRet, '(Restante \(Adeudado\))') && str_contains($txtRet, '(37,301.80)'));
$txtMano = implode("\n", $paginasPdf($armarPdf($casosPdf['pintura_mano_obra'], 'COT-000001', $logoPdf)->render()));
$chk('mano de obra: Cargos 100.00, Manejos 50.00, Mano de obra 1,500.00, TOTAL 51,044.80',
    str_contains($txtMano, '(Cargos bancarios)') && str_contains($txtMano, '(100.00)')
    && str_contains($txtMano, '(Manejos de operaciones bancarias)') && str_contains($txtMano, '(50.00)')
    && str_contains($txtMano, '(Costo mano de obra)') && str_contains($txtMano, '(1,500.00)')
    && str_contains($txtMano, '(51,044.80)'));
$chk('mano de obra: sin Restante (no hay retencion ni abono)', !str_contains($txtMano, 'Restante'));

// --- etiqueta ITBIS y precio con 4 decimales ---
$txtMixto = implode("\n", $paginasPdf($armarPdf($casosPdf['mixto'], 'COT-000009', $logoPdf)->render()));
$chk('mixto: rotulo "ITBIS" a secas (no todo es 18%)', str_contains($txtMixto, '(ITBIS)') && !str_contains($txtMixto, 'ITBIS 18%'));
$caso4Dec = ['lineas' => [['quantity' => 3, 'amount' => 84.7458, 'indicador_facturacion' => 1, 'description' => 'PRUEBA PRECIO 4 DECIMALES']]]
    + $casosPdf['pintura'];
$txt4Dec = implode("\n", $paginasPdf($armarPdf($caso4Dec, 'COT-000010', $logoPdf)->render()));
$chk('precio 84.7458: Valor Unitario 84.7458 y Valor Total 254.24 (textoPrecio)',
    str_contains($txt4Dec, '(3.00)') && str_contains($txt4Dec, '(84.7458)') && str_contains($txt4Dec, '(254.24)'));

// --- logo: presente, ausente, inexistente, ilegible ---
if ($logoPdf !== null) {
    $chk('con logo: incrusta la imagen', str_contains($bytesPintura, '/Subtype /Image'));
    $chk('con logo: la razon social sale solo en el pie', substr_count($txtPintura, '(FERREHERRAMIENTAS VENTURA, SRL)') === 1);
}
$bytesSinLogo = $armarPdf($casosPdf['pintura'], 'COT-000001', null)->render();
$chk('sin logo: no incrusta imagen', !str_contains($bytesSinLogo, '/Subtype /Image'));
$chk('sin logo: razon social arriba (en su lugar) y en el pie',
    substr_count(implode("\n", $paginasPdf($bytesSinLogo)), '(FERREHERRAMIENTAS VENTURA, SRL)') === 2);
$bytesNoExiste = $armarPdf($casosPdf['pintura'], 'COT-000001', __DIR__ . '/fixtures/no_existe.png')->render();
$chk('logo inexistente: el PDF sale igual, sin imagen', str_starts_with($bytesNoExiste, '%PDF') && !str_contains($bytesNoExiste, '/Subtype /Image'));
$bytesNoImagen = $armarPdf($casosPdf['pintura'], 'COT-000001', __DIR__ . '/fixtures/cotizacion_ferreteria.json')->render();
$chk('logo que no es imagen: el PDF sale igual, sin imagen', str_starts_with($bytesNoImagen, '%PDF') && !str_contains($bytesNoImagen, '/Subtype /Image'));
if (function_exists('imagecreatetruecolor')) {
    // PNG entrelazado: getimagesize lo acepta pero FPDF lanza al leerlo.
    $pngEntrelazado = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cotizacion_ferreteria_' . getmypid() . '.png';
    $imgPdf = imagecreatetruecolor(40, 20);
    imageinterlace($imgPdf, true);
    imagepng($imgPdf, $pngEntrelazado);
    echo "     (se espera un aviso \"logo ilegible\" en stderr)\n";
    $bytesEntrelazado = $armarPdf($casosPdf['pintura'], 'COT-000001', $pngEntrelazado)->render();
    @unlink($pngEntrelazado);
    $chk('logo que FPDF no soporta (PNG entrelazado): sale con la razon social',
        str_starts_with($bytesEntrelazado, '%PDF') && !str_contains($bytesEntrelazado, '/Subtype /Image')
        && substr_count(implode("\n", $paginasPdf($bytesEntrelazado)), '(FERREHERRAMIENTAS VENTURA, SRL)') === 2);
}

// --- largo_60: saltos de pagina ---
$largoPdf = $casosPdf['largo_60'];
$bytesLargo = $armarPdf($largoPdf, 'COT-000060', $logoPdf)->render();
$nLargo = $contarPaginas($bytesLargo);
$pagsLargo = $paginasPdf($bytesLargo);
$chk("largo_60: mas de una pagina ({$nLargo})", $nLargo > 1);
$chk('largo_60: un stream de contenido por pagina', count($pagsLargo) === $nLargo);
$numeradas = true;
foreach ($pagsLargo as $kPag => $pPag) {
    $numeradas = $numeradas && str_contains($pPag, $iso('(Página ' . ($kPag + 1) . ' de ' . $nLargo . ')'));
}
$chk("largo_60: cada pagina dice \"Pagina X de {$nLargo}\"", $numeradas);
$chk('largo_60: las 60 filas impresas', str_contains(implode("\n", $pagsLargo), 'NUMERO 60 CON') && str_contains($pagsLargo[0], 'NUMERO 1 CON'));

// Las reglas de corte de la spec 7 para cada largo de 1 a 60 lineas: asi el
// corte cae en todos los puntos posibles de la pagina, no solo en uno.
$marcaSuelta = [];
$cierrePartido = [];
$cabeceraMal = [];
$cierreSolo = 0;
for ($nFilas = 1; $nFilas <= count($largoPdf['lineas']); $nFilas++) {
    $subPdf = ['lineas' => array_slice($largoPdf['lineas'], 0, $nFilas)] + $largoPdf;
    $pags = $paginasPdf($armarPdf($subPdf, 'COT-000060', $logoPdf)->render());
    $ultimaPag = count($pags) - 1;
    $donde = static function (string $aguja) use ($pags): array {
        return array_keys(array_filter($pags, static fn(string $p): bool => str_contains($p, $aguja)));
    };
    // 1) la marca en la misma pagina que la ultima fila
    $pagFila = $donde('NUMERO ' . $nFilas . ' CON');
    if ($pagFila === [] || $pagFila !== $donde('No hay m')) {
        $marcaSuelta[] = $nFilas;
    }
    // 2) totales + Recibido por + pie, todos en la ultima pagina
    foreach (['(Sub-total RD$)', '(TOTAL RD$)', '(Recibido por:)', $iso('(Teléfono 829-898-7798)')] as $aguja) {
        if ($donde($aguja) !== [$ultimaPag]) {
            $cierrePartido[] = $nFilas;
            break;
        }
    }
    // 3) cabecera de tabla en cada pagina con filas, y en ninguna otra
    foreach ($pags as $kPag => $pPag) {
        if (str_contains($pPag, 'ARTICULO DE PRUEBA') !== str_contains($pPag, '(Valor Unitario)')) {
            $cabeceraMal[] = $nFilas . '/p' . ($kPag + 1);
        }
    }
    if (!str_contains($pags[$ultimaPag], 'ARTICULO DE PRUEBA')) {
        $cierreSolo++;
    }
}
$chk('cortes 1..60: la marca siempre en la pagina de la ultima fila'
    . ($marcaSuelta ? ' (fallan n=' . implode(',', $marcaSuelta) . ')' : ''), $marcaSuelta === []);
$chk('cortes 1..60: el bloque de cierre nunca se parte y va en la ultima pagina'
    . ($cierrePartido ? ' (fallan n=' . implode(',', $cierrePartido) . ')' : ''), $cierrePartido === []);
$chk('cortes 1..60: cabecera de tabla solo en paginas con filas'
    . ($cabeceraMal ? ' (fallan ' . implode(',', $cabeceraMal) . ')' : ''), $cabeceraMal === []);
$chk("cortes 1..60: algun largo empuja el cierre solo a una pagina nueva ({$cierreSolo} casos)", $cierreSolo > 0);

// --- --pdf [--grid]: archivos para la comparacion visual con el Excel ---
if ($escribirPdf) {
    $dirOut = __DIR__ . '/out';
    if (!is_dir($dirOut)) {
        mkdir($dirOut, 0775, true);
    }
    $salidasPdf = [
        'pintura' => [$casosPdf['pintura'], $casosPdf['pintura']['code'] ?? 'COT-000001'],
        'b150000049' => [$casosPdf['b150000049'], $casosPdf['b150000049']['code'] ?? 'COT-000002'],
        'ceramicas' => [$casosPdf['ceramicas'], $casosPdf['ceramicas']['code'] ?? 'COT-000003'],
        'largo_60' => [$largoPdf, $largoPdf['code'] ?? 'COT-000060'],
        // Extras: las filas opcionales de totales y la vista previa sin numero.
        'pintura_retencion_abono' => [$casosPdf['pintura_retencion_abono'], $casosPdf['pintura_retencion_abono']['code'] ?? 'COT-000001'],
        'vista_previa' => [$casosPdf['pintura'], null],
    ];
    foreach ($salidasPdf as $idPdf => [$casoPdf, $codePdf]) {
        $rutaPdf = $dirOut . '/cotizacion_ferreteria_' . $idPdf . '.pdf';
        $okPdf = file_put_contents($rutaPdf, $armarPdf($casoPdf, $codePdf, $logoPdf, $conGrillaPdf)->render()) !== false;
        $chk('--pdf: tools/out/' . basename($rutaPdf) . ($conGrillaPdf ? ' (con rejilla)' : ''), $okPdf);
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```
Expected:
- T1's and T4's `[OK  ]` lines;
- then `Fatal error: Uncaught Error: Failed opening required 'C:\Users\Signos\Documents\edwin\api-gratex\tools/../src/Utils/Cotizacion/FerreteriaCotizacionPdf.php' (include_path=...)`. The prefix may be `PHP Fatal error:` depending on `display_errors`/`log_errors`. It points at the section's `require_once` line;
- `exit=255`.

The failure is the missing class file, which is the point. No T5 `[OK  ]` line prints.

- [ ] **Step 4: Implement `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`**

Create the file with exactly this content:

```php
<?php
require_once __DIR__ . '/../Pdf/libs.php';
require_once __DIR__ . '/../Pdf/EcfDocumento.php';
// FerreteriaFormato tambien incluye este archivo (para pdf()/preview()):
// require_once corta el ciclo, y ninguno de los dos usa al otro al cargarse,
// solo dentro de sus metodos.
require_once __DIR__ . '/FerreteriaFormato.php';
require_once __DIR__ . '/Redondeo.php';

/**
 * Hoja FPDF de la cotizacion de Ferreteria.
 *
 * Solo agrega a FPDF lo que el renderizador necesita y FPDF no expone: el pie
 * con "Pagina X de Y", la rejilla de calibracion, cuantos renglones ocupa una
 * celda y si un bloque cabe antes del margen inferior. QUE se imprime lo
 * decide FerreteriaCotizacionPdf.
 */
final class FerreteriaCotizacionHoja extends FPDF
{
    /** "Pagina X de Y" en el pie. Solo cuando el documento tiene mas de una pagina. */
    public bool $paginar = false;

    /** Rejilla de calibracion cada 10 mm (tools/test_cotizacion_ferreteria.php --pdf --grid). */
    public bool $grilla = false;

    public function Footer(): void
    {
        if ($this->paginar) {
            // Cae en el margen inferior, fuera de la zona que miden los saltos
            // de pagina: imprimirlo o no nunca mueve el contenido.
            $this->SetY(-11);
            $this->SetFont('Times', '', 8);
            $this->SetTextColor(0, 0, 0);
            $this->Cell(0, 4, mb_convert_encoding('Página ' . $this->PageNo() . ' de {nb}', 'ISO-8859-1', 'UTF-8'), 0, 0, 'C');
        }
        if ($this->grilla) {
            $this->dibujarGrilla();
        }
    }

    /** Si un bloque de $alto mm cabe entre la Y actual y el margen inferior. */
    public function cabe(float $alto): bool
    {
        return $this->GetY() + $alto <= $this->PageBreakTrigger;
    }

    /**
     * Renglones que ocupa $txt (ya en ISO-8859-1) en una celda de $w mm con la
     * fuente actual. Mismo algoritmo que MultiCell (FacturaPdfGenerator::NbLines):
     * el alto de la fila tiene que coincidir con lo que MultiCell dibuja.
     */
    public function renglones(float $w, string $txt): int
    {
        $cw = &$this->CurrentFont['cw'];
        $wmax = ($w - 2 * $this->cMargin) * 1000 / $this->FontSize;
        $s = str_replace("\r", '', $txt);
        $nb = strlen($s);
        if ($nb > 0 && $s[$nb - 1] === "\n") {
            $nb--;
        }
        $sep = -1;
        $i = 0;
        $j = 0;
        $l = 0;
        $nl = 1;
        while ($i < $nb) {
            $c = $s[$i];
            if ($c === "\n") {
                $i++;
                $sep = -1;
                $j = $i;
                $l = 0;
                $nl++;
                continue;
            }
            if ($c === ' ') {
                $sep = $i;
            }
            $l += $cw[$c] ?? 0;
            if ($l > $wmax) {
                if ($sep === -1) {
                    if ($i === $j) {
                        $i++;
                    }
                } else {
                    $i = $sep + 1;
                }
                $sep = -1;
                $j = $i;
                $l = 0;
                $nl++;
            } else {
                $i++;
            }
        }
        return $nl;
    }

    /**
     * Rejilla cada 10 mm con etiquetas en cm, encima de todo (misma que
     * FacturaPdfGenerator::drawDebugGrid). Sirve para medir el PDF contra la
     * hoja de Excel del cliente; jamas se activa fuera del script de prueba.
     */
    private function dibujarGrilla(): void
    {
        $w = $this->GetPageWidth();
        $h = $this->GetPageHeight();
        for ($x = 0; $x <= $w; $x += 10) {
            $this->SetDrawColor(($x % 50 === 0) ? 150 : 205, 205, 235);
            $this->Line($x, 0, $x, $h);
        }
        for ($y = 0; $y <= $h; $y += 10) {
            $this->SetDrawColor(($y % 50 === 0) ? 150 : 205, 205, 235);
            $this->Line(0, $y, $w, $y);
        }
        $this->SetFont('Times', '', 5);
        $this->SetTextColor(120, 130, 170);
        for ($x = 10; $x < $w; $x += 10) {
            $this->Text($x + 0.4, 3, (string) ((int) ($x / 10)));
        }
        for ($y = 10; $y < $h; $y += 10) {
            $this->Text(0.5, $y - 0.6, (string) ((int) ($y / 10)));
        }
        $this->SetDrawColor(0, 0, 0);
        $this->SetTextColor(0, 0, 0);
    }
}

/**
 * PDF de la cotizacion en el formato de Ferreteria ("COTIZACION MERCANCIAS"),
 * calcado de la hoja de Excel que el cliente ya usaba (spec 2026-10-01, 7).
 *
 * Renderizador puro: recibe la cotizacion con sus totales ya calculados
 * (FerreteriaFormato::totales), el emisor, el cliente y la ruta del logo, y
 * devuelve los bytes. No toca Database, TenantResolver ni BrandingResolver:
 * el script de prueba lo corre sin BD y el mismo dibujo sirve para el PDF
 * guardado y para la vista previa.
 *
 * Los saltos de pagina los decide esta clase, no FPDF: una fila nunca se
 * parte, la marca "No hay mas productos" queda con la ultima fila, y totales +
 * "Recibido por" + pie pasan enteros a otra pagina si no caben.
 */
final class FerreteriaCotizacionPdf
{
    /** Margen izquierdo/derecho (mm). Arriba van 10. */
    private const MARGEN = 15.0;

    /** Margen inferior (mm): ahi cae "Pagina X de Y" y nada mas. */
    private const MARGEN_INF = 15.0;

    /** Columnas fijas (mm); Descripcion se queda con el resto del ancho util. */
    private const ANCHO_CANTIDAD = 24.0;
    private const ANCHO_UNITARIO = 29.0;
    private const ANCHO_TOTAL = 30.0;

    /** Caja maxima del logo (mm); se respeta su proporcion. */
    private const LOGO_MAX_W = 75.0;
    private const LOGO_MAX_H = 28.0;

    private const ALTO_BLOQUE = 4.5;
    private const ALTO_CABECERA = 7.0;
    private const ALTO_RENGLON = 4.5;
    private const ALTO_TOTAL = 5.5;
    private const ESPACIO_TOTALES = 1.5;
    private const ESPACIO_RECIBIDO = 6.0;
    private const ALTO_RECIBIDO = 6.0;
    private const ESPACIO_PIE = 3.0;
    private const ALTO_PIE = 4.5;

    /** Azul de la banda de la tabla y de los valores de totales en su Excel (#BDD7EE). */
    private const AZUL = [189, 215, 238];

    /** Azul de hipervinculo de Excel para el correo (#0563C1). */
    private const AZUL_CORREO = [5, 99, 193];

    private const MARCA = '***********No hay más productos debajo de la línea*****';

    private array $cotizacion;
    private array $emisor;
    private array $cliente;
    private ?string $logoPath;
    private bool $grilla = false;

    /** Un logo que FPDF no pudo leer en la primera pasada no se reintenta en la segunda. */
    private bool $logoFallo = false;

    /**
     * @param array $cotizacion code (?string; null => 'VISTA PREVIA'), date, items
     *                          [{description, quantity, amount}] y totales (salida
     *                          exacta de FerreteriaFormato::totales).
     * @param array $emisor     Fila de emisor_config: rnc, razon_social, direccion, telefono, correo.
     * @param array $cliente    razon_social, company_name, client_name, rnc.
     * @param ?string $logoPath Ruta absoluta del logo; null o ilegible => razon social en texto.
     */
    public function __construct(array $cotizacion, array $emisor, array $cliente, ?string $logoPath)
    {
        $this->cotizacion = $cotizacion;
        $this->emisor = $emisor;
        $this->cliente = $cliente;
        $this->logoPath = $logoPath;
    }

    /** Rejilla de calibracion (solo para comparar contra el Excel desde el script de prueba). */
    public function setDebugGrid(bool $v = true): void
    {
        $this->grilla = $v;
    }

    /** Bytes del PDF. */
    public function render(): string
    {
        // "Pagina X de Y" solo va si hay mas de una pagina, y eso no se sabe
        // hasta terminar de dibujar: la primera pasada cuenta, la segunda
        // imprime. Las dos dibujan exactamente lo mismo (el pie cae en el
        // margen inferior), asi que el conteo no cambia entre una y otra.
        $paginas = $this->dibujar(false)->PageNo();
        return $this->dibujar($paginas > 1)->Output('S');
    }

    private function dibujar(bool $paginar): FerreteriaCotizacionHoja
    {
        $pdf = new FerreteriaCotizacionHoja('P', 'mm', 'Letter');
        $pdf->paginar = $paginar;
        $pdf->grilla = $this->grilla;
        $pdf->AliasNbPages();
        $pdf->SetMargins(self::MARGEN, 10, self::MARGEN);
        // Sin salto automatico: FPDF cortaria una celda a la mitad. El margen
        // igual se pasa porque fija el limite que mide cabe().
        $pdf->SetAutoPageBreak(false, self::MARGEN_INF);
        $pdf->AddPage();
        $pdf->SetTextColor(0, 0, 0);
        $pdf->SetDrawColor(0, 0, 0);

        $this->encabezado($pdf);
        $this->tabla($pdf);
        $this->cierre($pdf);
        return $pdf;
    }

    /** Logo, direccion, RNC, titulo y el bloque de fecha/numero/cliente (solo en la primera pagina). */
    private function encabezado(FerreteriaCotizacionHoja $pdf): void
    {
        $util = $this->anchoUtil($pdf);

        $y = $pdf->GetY();
        $logo = $this->medidasLogo();
        if ($logo !== null && $this->ponerLogo($pdf, $logo, ($pdf->GetPageWidth() - $logo['w']) / 2, $y)) {
            $pdf->SetY($y + $logo['h'] + 1.5);
        } else {
            // Sin logo el documento igual tiene que decir quien lo emite.
            $nombre = $this->texto($this->emisor['razon_social'] ?? '');
            if ($nombre !== '') {
                $pdf->SetFont('Times', 'B', 16);
                $pdf->MultiCell($util, 7, $this->enc($nombre), 0, 'C');
                $pdf->Ln(1);
            }
        }

        // En su hoja la direccion ocupa dos renglones; una mas larga se recorta
        // para que el encabezado no empuje la tabla.
        $direccion = (string) preg_replace('/\s+/', ' ', $this->texto($this->emisor['direccion'] ?? ''));
        if ($direccion !== '') {
            $pdf->SetFont('Times', '', 10);
            $pdf->MultiCell($util, 4.5, $this->recortar($pdf, $this->enc($direccion), $util, 2), 0, 'C');
        }

        $rnc = $this->rnc($this->emisor['rnc'] ?? null);
        if ($rnc !== '') {
            $pdf->Ln(1);
            $pdf->SetFont('Times', 'B', 10);
            $pdf->Cell($util, 5, $this->enc('RNC ' . $rnc), 0, 1, 'L');
        }

        $pdf->Ln(1.5);
        $pdf->SetFont('Times', 'B', 14);
        $pdf->Cell($util, 7, $this->enc('COTIZACIÓN MERCANCÍAS'), 0, 1, 'C');
        $pdf->Ln(1.5);

        // Bloque izquierdo, como en su hoja: fecha, numero, rotulo y cliente.
        $pdf->SetFont('Times', 'B', 10);
        $fecha = $this->texto($this->cotizacion['date'] ?? '');
        if ($fecha !== '') {
            $pdf->Cell($util, self::ALTO_BLOQUE, $this->enc(FerreteriaFormato::fechaLarga($fecha)), 0, 1, 'L');
        }
        $pdf->Cell($util, self::ALTO_BLOQUE, $this->enc($this->codigo()), 0, 1, 'L');
        $pdf->Cell($util, self::ALTO_BLOQUE, $this->enc('NOMBRE O RAZÓN SOCIAL'), 0, 1, 'L');
        $nombreCliente = $this->nombreCliente();
        if ($nombreCliente !== '') {
            $pdf->MultiCell($util, self::ALTO_BLOQUE, $this->enc($nombreCliente), 0, 'L');
        }
        $rncCliente = $this->rnc($this->cliente['rnc'] ?? null);
        if ($rncCliente !== '') {
            $pdf->Cell($util, self::ALTO_BLOQUE, $this->enc($rncCliente), 0, 1, 'L');
        }
        $pdf->Ln(3);
    }

    /** Filas de items + la marca "No hay mas productos", con sus saltos de pagina. */
    private function tabla(FerreteriaCotizacionHoja $pdf): void
    {
        $anchos = $this->anchos($pdf);
        $items = array_values($this->cotizacion['items'] ?? []);
        $ultima = count($items) - 1;

        $pdf->SetFont('Times', '', 10);
        $marca = ['', $this->enc(self::MARCA), '', ''];
        $altoMarca = $this->altoFila($pdf, $anchos, $marca);

        // La cabecera se dibuja junto con la fila que la sigue: asi nunca queda
        // sola al pie de una pagina y solo se repite donde continuan filas.
        $cabeceraPendiente = true;
        foreach ($items as $i => $item) {
            $celdas = [
                number_format((float) ($item['quantity'] ?? 0), 2),
                $this->enc($this->texto($item['description'] ?? '')),
                // Hasta 4 decimales si los trae: con 2 fijos, 3 x 84.7458
                // se leeria "3 x 84.75 = 254.24" y la linea no sumaria.
                EcfDocumento::textoPrecio($item['amount'] ?? 0),
                number_format($this->valorLinea($i, $item), 2),
            ];
            $alto = $this->altoFila($pdf, $anchos, $celdas);
            // La marca va pegada a la ultima fila: si no caben las dos, pasan juntas.
            $necesario = $alto
                + ($i === $ultima ? $altoMarca : 0.0)
                + ($cabeceraPendiente ? self::ALTO_CABECERA : 0.0);
            if (!$pdf->cabe($necesario)) {
                $pdf->AddPage();
                $cabeceraPendiente = true;
            }
            if ($cabeceraPendiente) {
                $this->cabeceraTabla($pdf, $anchos);
                $cabeceraPendiente = false;
            }
            $this->fila($pdf, $anchos, $celdas, ['C', 'L', 'R', 'R'], $alto);
        }

        // Sin items (la validacion lo impide, pero el PDF no debe romperse) la
        // cabecera y la marca caben de sobra en la primera pagina.
        if ($cabeceraPendiente) {
            $this->cabeceraTabla($pdf, $anchos);
        }
        $this->fila($pdf, $anchos, $marca, ['C', 'L', 'C', 'C'], $altoMarca);
    }

    /** Totales + "Recibido por" + pie: un solo bloque que nunca se parte. */
    private function cierre(FerreteriaCotizacionHoja $pdf): void
    {
        $filas = $this->filasTotales();
        $pie = $this->lineasPie();
        $alto = self::ESPACIO_TOTALES + count($filas) * self::ALTO_TOTAL
            + self::ESPACIO_RECIBIDO + self::ALTO_RECIBIDO
            + self::ESPACIO_PIE + count($pie) * self::ALTO_PIE;
        // Si no cabe pasa entero a una pagina nueva, sin cabecera de tabla:
        // ahi no continuan filas.
        if (!$pdf->cabe($alto)) {
            $pdf->AddPage();
        }
        $pdf->Ln(self::ESPACIO_TOTALES);

        // Rotulo bajo la columna Descripcion y valor bajo la ultima, como en su hoja.
        $anchos = $this->anchos($pdf);
        $xRotulo = self::MARGEN + $anchos[0];
        $xValor = $xRotulo + $anchos[1] + $anchos[2];
        $pdf->SetFillColor(self::AZUL[0], self::AZUL[1], self::AZUL[2]);
        foreach ($filas as [$rotulo, $valor, $esTotal]) {
            $y = $pdf->GetY();
            $pdf->SetXY($xRotulo, $y);
            $pdf->SetFont('Times', 'B', 10);
            $pdf->Cell($anchos[1], self::ALTO_TOTAL, $this->enc($rotulo), 0, 0, 'L');
            $pdf->SetXY($xValor, $y);
            $pdf->SetFont('Times', $esTotal ? 'B' : '', 10);
            $pdf->Cell($anchos[3], self::ALTO_TOTAL, number_format($valor, 2), 1, 1, 'R', true);
        }

        $pdf->Ln(self::ESPACIO_RECIBIDO);
        $y = $pdf->GetY();
        $pdf->SetFont('Times', 'B', 10);
        $pdf->Cell(26, self::ALTO_RECIBIDO, $this->enc('Recibido por:'), 0, 0, 'L');
        $pdf->Line(self::MARGEN + 26, $y + self::ALTO_RECIBIDO - 1, self::MARGEN + 110, $y + self::ALTO_RECIBIDO - 1);
        $pdf->SetXY(self::MARGEN, $y + self::ALTO_RECIBIDO);

        // Pie centrado que sigue al "Recibido por" (no es el Footer() de FPDF,
        // que se repetiria en cada pagina).
        $pdf->Ln(self::ESPACIO_PIE);
        $util = $this->anchoUtil($pdf);
        foreach ($pie as [$texto, $estilo, $esCorreo]) {
            $pdf->SetFont('Times', $estilo, 10);
            if (!$esCorreo) {
                $pdf->Cell($util, self::ALTO_PIE, $this->enc($texto), 0, 1, 'C');
                continue;
            }
            // El correo va azul, subrayado y como enlace mailto, igual que el
            // hipervinculo de su hoja. La celda mide lo que el texto para que
            // el enlace no ocupe todo el ancho del renglon.
            $ancho = min($util, $pdf->GetStringWidth($this->enc($texto)) + 2);
            $pdf->SetX(self::MARGEN + ($util - $ancho) / 2);
            $pdf->SetTextColor(self::AZUL_CORREO[0], self::AZUL_CORREO[1], self::AZUL_CORREO[2]);
            $pdf->Cell($ancho, self::ALTO_PIE, $this->enc($texto), 0, 1, 'C', false, 'mailto:' . $texto);
            $pdf->SetTextColor(0, 0, 0);
        }
    }

    /**
     * Filas de totales en el orden de la spec 6.2. Sub-total, ITBIS y TOTAL
     * siempre; cargos, retencion y abono solo con valor; Restante solo con
     * retencion o abono. Lo adeudado (TOTAL - retencion) no lleva fila propia:
     * Restante ya es TOTAL - retencion - abono.
     *
     * @return array<int,array{0:string,1:float,2:bool}> [rotulo, valor, esTotal]
     */
    private function filasTotales(): array
    {
        $t = $this->cotizacion['totales'] ?? [];
        $monto = static fn(string $k): float => (float) ($t[$k] ?? 0);

        $filas = [
            ['Sub-total RD$', $monto('subtotal'), false],
            [(string) ($t['etiqueta_itbis'] ?? 'ITBIS'), $monto('itbis'), false],
        ];
        $cargos = [
            'cargos_bancarios' => 'Cargos bancarios',
            'manejo_bancario'  => 'Manejos de operaciones bancarias',
            'mano_obra'        => 'Costo mano de obra',
        ];
        foreach ($cargos as $clave => $rotulo) {
            if ($monto($clave) > 0) {
                $filas[] = [$rotulo, $monto($clave), false];
            }
        }
        $filas[] = ['TOTAL RD$', $monto('total'), true];
        if ($monto('retencion_isr') > 0) {
            $filas[] = ['Retención Renta por Tercero 5%', $monto('retencion_isr'), false];
        }
        if ($monto('abono') > 0) {
            $filas[] = ['Abono realizado', $monto('abono'), false];
        }
        if (!empty($t['mostrar_restante'])) {
            $filas[] = ['Restante (Adeudado)', $monto('restante'), false];
        }
        return $filas;
    }

    /**
     * Pie: razon social (la legal, no nombre_comercial), correo y telefono;
     * cada parte solo si tiene valor.
     *
     * @return array<int,array{0:string,1:string,2:bool}> [texto, estilo FPDF, esCorreo]
     */
    private function lineasPie(): array
    {
        $lineas = [];
        $razon = $this->texto($this->emisor['razon_social'] ?? '');
        if ($razon !== '') {
            $lineas[] = [$razon, 'B', false];
        }
        $correo = $this->texto($this->emisor['correo'] ?? '');
        if ($correo !== '') {
            $lineas[] = [$correo, 'U', true];
        }
        $telefono = $this->texto($this->emisor['telefono'] ?? '');
        if ($telefono !== '') {
            $lineas[] = ['Teléfono ' . $telefono, '', false];
        }
        return $lineas;
    }

    private function cabeceraTabla(FerreteriaCotizacionHoja $pdf, array $anchos): void
    {
        $pdf->SetFont('Times', 'B', 10);
        $pdf->SetFillColor(self::AZUL[0], self::AZUL[1], self::AZUL[2]);
        $pdf->SetTextColor(0, 0, 0);
        $titulos = ['Cantidad', 'Descripción mercancías', 'Valor Unitario', 'Valor Total RD$'];
        foreach ($titulos as $k => $titulo) {
            $pdf->Cell($anchos[$k], self::ALTO_CABECERA, $this->enc($titulo), 1, 0, 'C', true);
        }
        $pdf->Ln(self::ALTO_CABECERA);
        $pdf->SetFont('Times', '', 10);
    }

    /** Fila con borde en cada celda, tan alta como su celda mas envuelta. */
    private function fila(FerreteriaCotizacionHoja $pdf, array $anchos, array $celdas, array $alineacion, float $alto): void
    {
        $x = self::MARGEN;
        $y = $pdf->GetY();
        foreach ($celdas as $k => $txt) {
            $pdf->Rect($x, $y, $anchos[$k], $alto);
            // Centrado vertical: el precio de una descripcion de tres renglones
            // queda a media fila y no pegado arriba.
            $usado = $pdf->renglones($anchos[$k], $txt) * self::ALTO_RENGLON;
            $pdf->SetXY($x, $y + max(0.0, ($alto - $usado) / 2));
            $pdf->MultiCell($anchos[$k], self::ALTO_RENGLON, $txt, 0, $alineacion[$k]);
            $x += $anchos[$k];
        }
        $pdf->SetXY(self::MARGEN, $y + $alto);
    }

    private function altoFila(FerreteriaCotizacionHoja $pdf, array $anchos, array $celdas): float
    {
        $renglones = 1;
        foreach ($celdas as $k => $txt) {
            $renglones = max($renglones, $pdf->renglones($anchos[$k], $txt));
        }
        return $renglones * self::ALTO_RENGLON;
    }

    /** @return float[] Cantidad | Descripcion | Valor Unitario | Valor Total */
    private function anchos(FerreteriaCotizacionHoja $pdf): array
    {
        $descripcion = $this->anchoUtil($pdf) - self::ANCHO_CANTIDAD - self::ANCHO_UNITARIO - self::ANCHO_TOTAL;
        return [self::ANCHO_CANTIDAD, $descripcion, self::ANCHO_UNITARIO, self::ANCHO_TOTAL];
    }

    private function anchoUtil(FerreteriaCotizacionHoja $pdf): float
    {
        return $pdf->GetPageWidth() - 2 * self::MARGEN;
    }

    /** Base de la linea tal como la calculo totales(); sin ella, la misma regla (spec 6.2). */
    private function valorLinea(int $i, array $item): float
    {
        $base = $this->cotizacion['totales']['lineas'][$i]['base'] ?? null;
        if ($base !== null) {
            return (float) $base;
        }
        return Redondeo::r2(Redondeo::r2((float) ($item['quantity'] ?? 0)) * Redondeo::r4((float) ($item['amount'] ?? 0)));
    }

    /**
     * Tamano del logo dentro de su caja, respetando la proporcion (misma
     * matematica que FacturaTemplate::drawLogo). Null si no hay archivo o no es
     * una imagen que FPDF sepa leer: entonces se imprime la razon social.
     *
     * @return array{w:float,h:float,tipo:string}|null
     */
    private function medidasLogo(): ?array
    {
        if ($this->logoFallo || $this->logoPath === null || !is_file($this->logoPath)) {
            return null;
        }
        $info = @getimagesize($this->logoPath);
        if (!$info || (int) $info[0] <= 0 || (int) $info[1] <= 0) {
            return null;
        }
        $tipos = [IMAGETYPE_JPEG => 'JPG', IMAGETYPE_PNG => 'PNG', IMAGETYPE_GIF => 'GIF'];
        $tipo = $tipos[$info[2]] ?? null;
        if ($tipo === null) {
            return null;
        }
        $ratio = $info[1] / $info[0];
        $w = self::LOGO_MAX_W;
        $h = $w * $ratio;
        if ($h > self::LOGO_MAX_H) {
            $h = self::LOGO_MAX_H;
            $w = $h / $ratio;
        }
        return ['w' => $w, 'h' => $h, 'tipo' => $tipo];
    }

    /**
     * Dibuja el logo. FPDF lanza con imagenes que no soporta (p.ej. PNG
     * entrelazado): un logo raro no puede tumbar la cotizacion, sale con la
     * razon social en su lugar.
     */
    private function ponerLogo(FerreteriaCotizacionHoja $pdf, array $logo, float $x, float $y): bool
    {
        try {
            $pdf->Image((string) $this->logoPath, $x, $y, $logo['w'], $logo['h'], $logo['tipo']);
            return true;
        } catch (\Throwable $e) {
            error_log('[FerreteriaCotizacionPdf] logo ilegible (' . $this->logoPath . '): ' . $e->getMessage());
            $this->logoFallo = true;
            return false;
        }
    }

    /** Recorta $texto (ISO-8859-1) con "..." para que ocupe a lo sumo $max renglones de $ancho mm. */
    private function recortar(FerreteriaCotizacionHoja $pdf, string $texto, float $ancho, int $max): string
    {
        if ($pdf->renglones($ancho, $texto) <= $max) {
            return $texto;
        }
        $palabras = explode(' ', $texto);
        while (count($palabras) > 1) {
            array_pop($palabras);
            $corto = rtrim(implode(' ', $palabras), ' ,.;-') . '...';
            if ($pdf->renglones($ancho, $corto) <= $max) {
                return $corto;
            }
        }
        // Una sola "palabra" enorme: se corta por caracteres.
        $corto = $palabras[0];
        while (strlen($corto) > 1 && $pdf->renglones($ancho, $corto . '...') > $max) {
            $corto = substr($corto, 0, -1);
        }
        return $corto . '...';
    }

    private function codigo(): string
    {
        $code = $this->texto($this->cotizacion['code'] ?? '');
        return $code === '' ? 'VISTA PREVIA' : $code;
    }

    /** razon_social, si no company_name, si no client_name (el primero con texto). */
    private function nombreCliente(): string
    {
        foreach (['razon_social', 'company_name', 'client_name'] as $campo) {
            $valor = $this->texto($this->cliente[$campo] ?? '');
            if ($valor !== '') {
                return $valor;
            }
        }
        return '';
    }

    private function rnc($valor): string
    {
        return FerreteriaFormato::formatearRnc(is_scalar($valor) ? (string) $valor : null);
    }

    private function texto($valor): string
    {
        return is_scalar($valor) ? trim((string) $valor) : '';
    }

    /** UTF-8 -> ISO-8859-1 (fuentes core de FPDF). */
    private function enc(string $s): string
    {
        return mb_convert_encoding($s, 'ISO-8859-1', 'UTF-8');
    }
}
```

- [ ] **Step 5: Lint both files and run the harness (expect every check to pass)**

Run:
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && php -l src/Utils/Cotizacion/FerreteriaCotizacionPdf.php && php -l tools/test_cotizacion_ferreteria.php \
  && php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```
Expected:
- `No syntax errors detected` twice.
- The T1 and T4 lines unchanged.
- Then this exact T5 block (38 checks), with `largo_60` at 3 pages and the cut sweep reporting 10 cases:
```
== T5: PDF de Ferreteria (FerreteriaCotizacionPdf) ==
  [OK  ] fixture: tools/fixtures/ferreteria_logo.jpeg existe
  [OK  ] puro: no usa Database, TenantResolver, BrandingResolver ni EmisorConfigModel
  [OK  ] pintura: render() devuelve un PDF (%PDF)
  [OK  ] pintura: exactamente 1 pagina
  [OK  ] pintura: una sola pagina no lleva "Pagina X de Y"
  [OK  ] pintura: imprime su numero COT-000001
  [OK  ] pintura: titulo, fecha larga y rotulo del cliente
  [OK  ] pintura: RNC del emisor y del cliente formateados
  [OK  ] pintura: cabecera de las 4 columnas
  [OK  ] pintura: linea 7.00 x 2,000.00 = 14,000.00
  [OK  ] pintura: marca "No hay mas productos"
  [OK  ] pintura: Sub-total 41,860.00 / ITBIS 18% 7,534.80 / TOTAL 49,394.80
  [OK  ] pintura: sin cargos, retencion, abono ni restante (no tienen valor)
  [OK  ] pintura: Recibido por + pie (razon social, correo, telefono)
  [OK  ] pintura: el correo del pie es un enlace mailto
  [OK  ] pintura: no imprime cuenta bancaria ni sello de Gratex
  [OK  ] vista previa (code null): imprime VISTA PREVIA
  [OK  ] vista previa: no inventa un numero COT-
  [OK  ] retencion+abono: Retencion 2,093.00, Abono 10,000.00, Restante (Adeudado) 37,301.80
  [OK  ] mano de obra: Cargos 100.00, Manejos 50.00, Mano de obra 1,500.00, TOTAL 51,044.80
  [OK  ] mano de obra: sin Restante (no hay retencion ni abono)
  [OK  ] mixto: rotulo "ITBIS" a secas (no todo es 18%)
  [OK  ] precio 84.7458: Valor Unitario 84.7458 y Valor Total 254.24 (textoPrecio)
  [OK  ] con logo: incrusta la imagen
  [OK  ] con logo: la razon social sale solo en el pie
  [OK  ] sin logo: no incrusta imagen
  [OK  ] sin logo: razon social arriba (en su lugar) y en el pie
  [OK  ] logo inexistente: el PDF sale igual, sin imagen
  [OK  ] logo que no es imagen: el PDF sale igual, sin imagen
     (se espera un aviso "logo ilegible" en stderr)
[FerreteriaCotizacionPdf] logo ilegible (...cotizacion_ferreteria_<pid>.png): FPDF error: Interlacing not supported: ...
  [OK  ] logo que FPDF no soporta (PNG entrelazado): sale con la razon social
  [OK  ] largo_60: mas de una pagina (3)
  [OK  ] largo_60: un stream de contenido por pagina
  [OK  ] largo_60: cada pagina dice "Pagina X de 3"
  [OK  ] largo_60: las 60 filas impresas
  [OK  ] cortes 1..60: la marca siempre en la pagina de la ultima fila
  [OK  ] cortes 1..60: el bloque de cierre nunca se parte y va en la ultima pagina
  [OK  ] cortes 1..60: cabecera de tabla solo en paginas con filas
  [OK  ] cortes 1..60: algun largo empuja el cierre solo a una pagina nueva (10 casos)
```
- Then `M/M OK` and `exit=0`.

The whole script runs in about 0.5 s. The `logo ilegible` line on stderr is expected.

The interlaced-PNG check runs only when the GD extension is loaded (`function_exists('imagecreatetruecolor')`). Without
GD the block has 37 checks, not 38, and every later "N/N" total (Tasks 6 and 7, `378/378`) is one lower. Check with
`php -m | grep -i '^gd$'`; prefer enabling GD so the check runs.

If a `cortes 1..60` check fails, its label lists the failing `n` values. Debug with that `n`: run `php tools/test_cotizacion_ferreteria.php --pdf` after temporarily changing `$largoPdf`. Don't loosen the assertion.

- [ ] **Step 6: Write the PDFs for the visual check (`--pdf`, then `--pdf --grid`)**

Run:
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && php tools/test_cotizacion_ferreteria.php --pdf | tail -8 && ls -la tools/out \
  && php tools/test_cotizacion_ferreteria.php --pdf --grid | grep -- '--pdf' && git status --short
```
Expected:
- Six `[OK  ] --pdf: tools/out/cotizacion_ferreteria_<id>.pdf` lines, for pintura, b150000049, ceramicas, largo_60, pintura_retencion_abono and vista_previa.
- Then `M/M OK` (M = previous count + 6).
- `ls` shows 6 PDFs of about 50-60 KB each, since every file embeds the logo.
- The `--grid` run prints the same six lines with ` (con rejilla)` and overwrites the files.
- `git status --short` shows only `?? src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`, ` M tools/test_cotizacion_ferreteria.php` and `?? tools/out/`. Don't stage `tools/out/`.

Rerun `php tools/test_cotizacion_ferreteria.php --pdf` without `--grid` afterwards if you want clean copies.

- [ ] **Step 7: Manual visual compare against the Excel (spec section 3)**

Open the `--grid` PDFs side by side with Ferretería's workbook `COTIZACION JUN Ta de cera.xlsx`, sheets `cotizacion pintura`, `b150000049` and `CERAMICAS`. If the workbook isn't at hand, ask the user for it, or use the sheet description in spec section 3.

To open the PDFs (PowerShell): `Start-Process C:/Users/Signos/Documents/edwin/api-gratex/tools/out/cotizacion_ferreteria_pintura.pdf`. Repeat for `b150000049`, `ceramicas`, `largo_60` and `pintura_retencion_abono`.

Tick each item, top to bottom:
1. Letter portrait, Times throughout. The logo is centered at the top and is at most 75 mm wide and 28 mm tall (read the size off the grid).
2. The address is centered under the logo, in Times 10, on at most 2 lines.
3. `RNC 132-61512-3`, aligned left.
4. `COTIZACIÓN MERCANCÍAS`, bold, centered and larger (14).
5. The left block is bold. It reads:
   - the date: `MAYO 14/2026.-` (pintura) or `SEPTIEMBRE 2/2026.-` (b150000049, CERAMICAS);
   - the number `COT-00000N`;
   - `NOMBRE O RAZÓN SOCIAL`;
   - `HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO`;
   - `401-51513-1`.
6. The table:
   - The header band is light blue #BDD7EE with black text and the 4 headers.
   - Thin borders on every cell.
   - Each row's Cantidad × Valor Unitario = Valor Total, and the values match the sheet row by row (7 / 26 / 5 rows).
   - Quantities have 2 decimals.
7. The marker row `***********No hay más productos debajo de la línea*****` comes right after the last item.
8. The totals:
   - The label is bold, under the Descripción column. The value is in the last column, filled light blue, and TOTAL is bold.
   - The values are 41,860.00 / 7,534.80 / 49,394.80, 27,278.00 / 4,910.04 / 32,188.04 and 8,260.00 / 1,486.80 / 9,746.80.
   - `pintura_retencion_abono` adds Retención 2,093.00, Abono 10,000.00 and Restante (Adeudado) 37,301.80.
9. `Recibido por:` with a signature line. Then the centered footer: the legal name in bold, the email in blue and underlined (clicking it opens mail), and `Teléfono 829-898-7798`.
10. `largo_60`:
    - Pages 2 and 3 start with the table header and have no logo block.
    - The marker, totals and footer sit together on page 3.
    - Every page shows `Página X de 3` bottom-center.
    - pintura shows no page number.

**Deliberate differences from the Excel. Don't "fix" them:**
- The number is `COT-000001`, not the hand-typed `NCM 12000056` / `NC 0902` / `NC 09028`.
- The RNC prints as `132-61512-3` (spec 7's 9-digit rule), not `132-615123`.
- Accents: `COTIZACIÓN MERCANCÍAS`, `Descripción mercancías` (the Excel has "Descrpcion"), `NOMBRE O RAZÓN SOCIAL`.
- The label reads `Sub-total RD$`, not `Sub- total RD$`.
- Only the totals rows that have a value print. The Excel shows all 10 rows, most of them blank (decision 2, "Extra totals rows").

Any other difference, such as spacing, the logo's size or the blue's tone, can be tuned only through the class constants: `MARGEN`, the `ALTO_*` heights, `ANCHO_*`, `LOGO_MAX_*` and `AZUL`. Re-run Step 5 after any change.

- [ ] **Step 8: Confirm Gratex is untouched, then commit**

Run (Git Bash):
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && git diff --stat -- src/Utils/CotizacionPdfGenerator.php src/Utils/FacturaPdfGenerator.php src/Utils/Pdf .gitignore
```
Expected: no output. Then:
```bash
cd C:/Users/Signos/Documents/edwin/api-gratex && git add src/Utils/Cotizacion/FerreteriaCotizacionPdf.php tools/test_cotizacion_ferreteria.php && git commit -F - <<'EOF'
feat(cotizaciones): PDF de la cotizacion de Ferreteria (FerreteriaCotizacionPdf)

- Renderizador puro (sin BD, tenant ni branding) que calca su hoja de Excel
  "COTIZACION MERCANCIAS": logo centrado, direccion, RNC, titulo, bloque de
  fecha/numero/cliente, tabla de 4 columnas con banda #BDD7EE, marca "No hay
  mas productos", solo las filas de totales con valor, "Recibido por" y pie.
- Saltos de pagina propios: una fila nunca se parte, la marca va con la
  ultima fila, totales + "Recibido por" + pie pasan enteros a otra pagina y
  la cabecera de la tabla solo se repite donde siguen filas.
- "Pagina X de Y" solo con mas de una pagina (dos pasadas: contar y dibujar).
- tools/test_cotizacion_ferreteria.php: aserciones sobre el PDF (texto de los
  streams inflados, conteo de paginas, cortes de 1 a 60 lineas) y modo
  --pdf [--grid] que escribe tools/out/ para compararlo con el Excel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git status --short
```
Expected: one commit on `feat/cotizacion-formatos`. `git status --short` then shows only `?? tools/out/`, which stays untracked on purpose.

**Manual server checks T8 must add to `tests/test_cotizaciones_ferreteria.http`.** There's no local MySQL, so the PDF can only be checked through the API on the server, once T7 is in:
1. `GET /api/cotizaciones/{id}/pdf?format=base64` for a `formato = 'ferreteria'` row. Decode `content` and confirm:
   - a 1-page PDF;
   - `COT-00000N` and the same totals as the row;
   - no `Página` line.
2. `POST /api/cotizaciones/preview` with a Ferretería body and **no** `id` → the PDF prints `VISTA PREVIA` where the number goes. With `id` → it prints that row's code.
3. A quote with 30+ lines (or the 60 lines of `largo_60`) → the same cut rules as Step 7, item 10.
4. If Ferretería's tenant had no logo: `razon_social` in bold at the top. It must never show the Gratex logo; `BrandingResolver::logoPath()` already returns null for a resolved tenant without a logo.

---

## Part D: Task 6

<!-- Group D: Task 6 (backend, api-gratex). Every code block below was run on PHP 8.5.8 before it went into this plan,
     in a scratch copy of src/:
     - the T6 section of the harness gives 23/23 OK;
     - the HTTP equivalence run gives 33 IGUAL + 4 FALLA with the old controller (Step 8) and 37 OK with the new one
       (Step 10);
     - the verbatim diff prints exactly the hunks quoted in Step 11.
     A mutation run (422 -> 400 and 'PREVIEW' -> 'PREVIEW2' in GratexFormato) made the equivalence run report 7 DISTINTO,
     so it does catch a changed move. -->

### Notes for Task 6 (read before starting)

- **Repo and shell.**
  - Every command runs in **Git Bash** (the Bash tool) from `C:/Users/Signos/Documents/edwin/api-gratex`, on branch
    `feat/cotizacion-formatos`, unless a step says otherwise. Code blocks start at column 0: copy them exactly,
    including the heredoc delimiter lines.
  - Shell variables don't survive between Bash tool calls, so the steps use literal paths, such as
    `/tmp/equivalencia_t06.sh`.
  - The repo has `core.autocrlf=true`: the checkout of `cotizacionController.php` is CRLF, the blob is LF. Git may warn
    "LF will be replaced by CRLF"; that's harmless. The check scripts strip `\r` before comparing.
- **No DB anywhere in this task.**
  - The CLI section builds `cotizacionModel` with `ReflectionClass::newInstanceWithoutConstructor()`, so the constructor
    (the only place that opens a connection, `cotizacionModel.php:9-12`) never runs.
  - The Gratex regression run (Steps 8 and 10) serves the old and the new controller with `php -S` on
    `127.0.0.1:18761/18762`, from a temp folder, with fake models. It never touches a database, the production proxy
    or the network.
  - Anything that needs the real DB goes to the manual server list in Step 14, for `tests/test_cotizaciones_ferreteria.http`
    (Task 8).
- **Who picks the formato** (the controller after this task):

  | Request | Formato | 409 guard |
  |---|---|---|
  | `POST /api/cotizaciones` | `CotizacionFormatos::delTenant()` | yes |
  | `POST /api/cotizaciones/preview` with `id` of an existing row | that row's `formato` (NULL → gratex) | yes |
  | `POST /api/cotizaciones/preview` without `id`, with an `id` that is `== null` (0, `''`, `false`) or not scalar, or with one that no longer exists | `delTenant()` | yes |
  | `PUT /api/cotizaciones` (after today's `id` check) | the row's `formato`; a missing row → gratex, which answers today's "ya no existe" | yes |
  | `GET /api/cotizaciones/{id}/pdf` (after today's 404) | the row's `formato` | no |
  | `GET` list / `?id=`, `DELETE` | no formato: unchanged | no |

  The guard compares `CotizacionFormatos::delCuerpo($body)` with `$formato->nombre()` of the formato `para()` returned.
  On a mismatch: HTTP 409, `{"status":false,"error":"La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página."}`
  (`CotizacionFormatos::MSG_DESACTUALIZADA`), one `error_log` line, and nothing written.
- **What "verbatim" means for `GratexFormato`.** The validation chains, messages, HTTP codes, model calls and arguments
  are the old lines. The only mechanical changes, which Step 11 proves with `sed` + `diff`:
  - `$_POST` / `$_PUT` → `$body`, and `$cotizacionModel->` → `$this->modelo->` (`$cotizacionData` → `$cotizacion` in `pdf()`);
  - `$respuesta = ['status' => false, 'error' => X];` → `return ['error', X, 200];`, `http_response_code(422)` + `$respuesta`
    → `return ['error', X, 422];`, and `$respuesta = ['status' => true, ...]` → `return ['success', $result[1]];`;
  - the relative `require_once` paths, one folder deeper.
- **What stays in the controller:** PUT's `id` check, the GET-pdf 404, the `{status, data|error}` envelope, the
  `http_response_code` (only when the formato says something other than 200), both `AuditLogger::log` calls with the
  same fields and at the same point (after the success response is built, before the `echo`), the base64/download
  output with its headers, and the filenames `Cotizacion_<code>.pdf` / `Cotizacion_Preview.pdf`. `cotValidarItems()` and
  the `COT_*` constants stay defined there (globals); `GratexFormato` calls them at run time.
- **Deliberate, invisible-to-Gratex differences** (Step 10 shows Gratex's responses, writes and audit rows are identical):
  1. The body is decoded **once**, before the `switch`. A missing, invalid or non-object JSON body becomes `new stdClass`;
     every `isset()` answers as it did with `null`. `DELETE` uses the same `$body`.
  2. PUT reads the row **before** validating, so a PUT that fails validation now costs one extra `SELECT`. The audit
     `old_values` is that same row.
  3. `cotFila()` skips the lookup when the id is not scalar or `== null` (0, `''`, `false`): `getCotizaciones()` would
     return **all** rows (`cotizacionModel.php:42`), and the first one is some other quote with some other formato. Any
     other id is looked up with the same raw value the model's `updateCotizacion` gets (`WHERE id = :id`), so the formato
     always comes from the row the model will touch. For Gratex the model call is unchanged; at most, the audit
     `old_values` of such a nonsense id is `null` instead of an unrelated first row.
  4. Unknown formato names are logged: `[cotizaciones] formato desconocido "x": se usa gratex` (from `para()`) and
     `[cotizaciones] tenants.cotizacion_formato = "x" no es un formato conocido: se usa gratex` (from `delTenant()`).
- **For Task 7.** Registering Ferretería is one line in `CotizacionFormatos::FORMATOS` (`CotizacionFormatos.php:32`).
  `para()` loads `__DIR__ . '/<Clase>.php'` lazily, so the file must be named like the class, and a Gratex request
  never loads Ferretería's formato or FPDF. The section added here leaves `$modeloSinDb`, `$firmasDe`,
  `$contratoFormato`, `$conTenant` and `$tenantResuelto` defined for T7's own section (Step 14 of this task lists what
  T7 asserts). It doesn't leave `$leerLogFormatos` usable: its temp log is deleted at the end of the section.

---

### Task 6: `CotizacionFormato`, `CotizacionFormatos`, `GratexFormato` and the dispatching controller

**Files:**
- Create: `src/Utils/Cotizacion/CotizacionFormato.php` (65 lines). The folder already exists from Task 1.
- Create: `src/Utils/Cotizacion/GratexFormato.php` (157 lines).
- Create: `src/Utils/Cotizacion/CotizacionFormatos.php` (82 lines).
- Modify: `src/Controllers/cotizacionController.php` (280 → 292 lines; written whole in Step 9, guarded by the blob hash
  `094e70ea22881b72c6b6135455665536b6dd71c4`, so only these ranges change):
  - `:8` → add the `require_once` of `CotizacionFormatos.php` after it;
  - `:47-48` → add the helpers `cotFila`, `cotFormatoCoincide` and `cotError` after the `COT_*` constants;
  - between `:62` and `:63` → add the single body decode, right before the `switch`;
  - `:79-84` (GET pdf generation) → `CotizacionFormatos::para($row formato)->pdf(...)`;
  - `:134-221` (POST: preview `:136-186`, create `:188-221`) → resolve, guard, call `preview()` / `crear()`; the
    preview envelope, the CREATE audit and the `echo` stay;
  - `:223-258` (PUT) → today's `id` check, then row first, guard, `actualizar()`; the UPDATE audit stays;
  - `:261-262`, `:265-266`, `:271` (DELETE) → `$_DELETE` becomes `$body`; nothing else.
  - Unchanged: `:1-8`, `:9-48` (`cotValidarItems`, `COT_*`), `:49-62`, `:63-78`, `:85-136` (download/base64 output and
    the GET list).
- Modify: `tools/test_cotizacion_ferreteria.php` (created by Task 1, extended by Tasks 4 and 5). Insert the T6 section
  directly above Task 1's 3-line marker block (`// ---…---` / `// Las tareas siguientes agregan sus secciones AQUÍ,
  encima del resumen.` / `// ---…---`), after the last existing section (T5's when Tasks 1-5 ran in order; T6 itself
  only needs Task 1). The marker, then the summary `printf("\n%d/%d OK\n", $total - $fallos, $total);` and the `exit`,
  stay last.
- Test: `tools/test_cotizacion_ferreteria.php` (section "Registro de formatos (CotizacionFormatos)"), plus the throwaway
  checks of Steps 8, 10, 11 and 12 (nothing from them is committed).
- Not touched (Gratex must not change): `src/Utils/CotizacionPdfGenerator.php`, `src/Models/cotizacionModel.php`,
  `src/Router.php`, `src/PermissionGate.php`, `src/Middleware/*`.

**Interfaces:**
- Consumes (existing code, unchanged):
  - `cotizacionModel` (`src/Models/cotizacionModel.php`): `__construct()` `:9`, `getCotizaciones($id = null)` `:39-62`
    (rows with `description` and `items`; `[]` on PDOException), `saveCotizacion($client_id, $date, $items, $total,
    $user_id = null, $send_email = false)` `:127`, `updateCotizacion($id, $client_id, $date, $items, $total,
    $user_id = null, $send_email = false)` `:227` ("Esta cotización ya no existe..." at `:232`),
    `deleteCotizacion($id)` `:314`, `getCotizacionItems($cotizacion_id)` `:343`.
  - `clientModel::getClients($id = null)` (`src/Models/clientModel.php:31`).
  - `CotizacionPdfGenerator` (`src/Utils/CotizacionPdfGenerator.php`): `new CotizacionPdfGenerator('P', 'mm', 'Letter')`,
    `setCotizacion($cotizacion)` `:158`, `generatePdf()` `:426` (returns the bytes).
  - `InputSanitizer::jsonInput(bool $assoc = true)` (`src/Utils/InputSanitizer.php:59-66`; loaded by `src/Router.php:21`).
  - `TenantResolver::current(): ?array` (`src/TenantResolver.php:21`, over `private static ?array $current` `:18`).
  - `AuditLogger::log(array $event): void` (`src/AuditLogger.php:55`; loaded by `src/Router.php:103`).
  - `cotValidarItems(array $items): ?string` and `COT_SIN_CLIENTE` / `COT_SIN_LINEAS` / `COT_TOTAL_INVALIDO`
    (`src/Controllers/cotizacionController.php:18-47`).
  - From Task 1's harness: `$chk(string $desc, bool $ok)`, `$total`, `$fallos`, and the summary
    `printf("\n%d/%d OK\n", $total - $fallos, $total);` + `exit($fallos === 0 ? 0 : 1);` as the last two lines.
- Produces, from the contract:

```php
// src/Utils/Cotizacion/CotizacionFormato.php   (T6)
abstract class CotizacionFormato {
    abstract public function nombre(): string;
    /** @return array ['success', mixed $data] | ['error', string $msg, int $http] */
    abstract public function crear(object $body): array;
    abstract public function actualizar(array $row, object $body): array;
    /** payload = PDF bytes (string) */
    abstract public function preview(object $body, ?array $row): array;
    /** payload = PDF bytes (string); $cotizacion = row from getCotizaciones() incl. items */
    abstract public function pdf(array $cotizacion): array;
    public function permiteCorreo(): bool { return false; }
}

// src/Utils/Cotizacion/CotizacionFormatos.php   (T6)
final class CotizacionFormatos {
    public const DEFAULT = 'gratex';
    /** @var array<string,class-string> nombre => clase; T7 registers 'ferreteria' => FerreteriaFormato */
    public static function existe(?string $nombre): bool;
    /** null/unknown => GratexFormato. Never throws. */
    public static function para(?string $nombre, cotizacionModel $modelo): CotizacionFormato;
    /** TenantResolver::current()['cotizacion_formato'] ?? 'gratex', validated with existe(); unknown => 'gratex'. */
    public static function delTenant(): string;
    /** Formato a body claims: $body->formato if string, else 'gratex'. */
    public static function delCuerpo(object $body): string;
}

// src/Utils/Cotizacion/GratexFormato.php   (T6) — constructor(cotizacionModel $modelo); nombre()='gratex'; permiteCorreo()=true.
```

- Also produces, for T7/T8/T12:
  - `CotizacionFormatos::MSG_DESACTUALIZADA` (public const, additive to the contract): the 409 text, word for word from
    the spec. The FE "Recargar" action (Task 12) gets HTTP 409 with
    `{"status":false,"error":"La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página."}`.
  - `actualizar(array $row, ...)` gets `getCotizaciones($id)[0]`, or `[]` only when the row no longer exists (always
    Gratex). `preview(..., ?array $row)` gets the saved row when the body has an `id` that `cotFila()` finds, else
    `null`. `pdf(array $cotizacion)` gets `getCotizaciones($id)[0]` with `items` replaced by
    `getCotizacionItems($id)`, exactly as today.
  - Success payloads go out as `{status:true, data: <payload>}`; for create, `data['id']` is the audit `entity_id`.
    An error's `$http` is applied with `http_response_code()` unless it is 200.
  - Controller globals: `cotFila(cotizacionModel $modelo, $id): ?array`,
    `cotFormatoCoincide(object $body, CotizacionFormato $formato): bool`, `cotError(array $resultado): array`.

- [ ] **Step 1: Check the starting point**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git branch --show-current
git rev-parse HEAD:src/Controllers/cotizacionController.php
git diff --quiet HEAD -- src/Controllers/cotizacionController.php && echo "controller sin cambios locales"
ls src/Utils/Cotizacion/
grep -nF 'printf("\n%d/%d OK\n", $total - $fallos, $total);' tools/test_cotizacion_ferreteria.php
php tools/test_cotizacion_ferreteria.php | tail -1; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `feat/cotizacion-formatos`.
- `094e70ea22881b72c6b6135455665536b6dd71c4`: the controller blob this plan was written against (last changed in
  `f20aeba`; Tasks 1-5 don't touch it). If it differs, **stop**: someone changed the controller, and Steps 9, 11 and 12
  must be re-derived from the new version.
- `controller sin cambios locales`.
- `ls` shows `Redondeo.php` (Task 1), plus `FerreteriaFormato.php` and `FerreteriaCotizacionPdf.php` if Tasks 4-5 ran,
  and none of `CotizacionFormato.php`, `CotizacionFormatos.php`, `GratexFormato.php`.
- `grep` prints exactly one line: the second-to-last line of the file.
- The harness ends with `N/N OK` and `exit=0`. N is whatever the earlier tasks left (Task 4 alone ends at 244). Write
  N down: Steps 7 and 10 refer to it.

- [ ] **Step 2: Write the failing test (the T6 section of the harness)**

Re-read `tools/test_cotizacion_ferreteria.php`. With the Edit tool, use as `old_string` Task 1's 3-line marker block:

```php
// ---------------------------------------------------------------------------
// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.
// ---------------------------------------------------------------------------
```

and as `new_string` the block below, one blank line, and those same 3 marker lines. The block lands after the last
existing section, and the file still ends with the marker, the summary and the `exit(...)`.

```php
// ---------------------------------------------------------------------------
// Registro de formatos y contrato CotizacionFormato (Task 6)
// ---------------------------------------------------------------------------

require_once __DIR__ . '/../src/Utils/Cotizacion/CotizacionFormatos.php';

echo "\n== Registro de formatos (CotizacionFormatos) ==\n";

// Un cotizacionModel sin pasar por el constructor, que es el que abre la
// conexión: aquí nada llega a la DB (para() solo construye el formato).
$modeloSinDb = (new ReflectionClass('cotizacionModel'))->newInstanceWithoutConstructor();

// para() y delTenant() avisan en el error_log de un formato desconocido. Mientras
// corre la sección el log va a un archivo temporal: se comprueba el aviso y la
// salida queda limpia.
$logFormatos = (string) tempnam(sys_get_temp_dir(), 'cotfmt');
$logAnteriorFormatos = ini_set('error_log', $logFormatos);
$leerLogFormatos = function () use ($logFormatos): string {
    clearstatcache();
    $txt = (string) file_get_contents($logFormatos);
    file_put_contents($logFormatos, '');
    return $txt;
};

// La firma de cada método, para fijar el contrato que implementa cada formato.
$firmaFormato = static function (string $clase, string $metodo): string {
    $m = new ReflectionMethod($clase, $metodo);
    $params = array_map(static fn(ReflectionParameter $p) => $p->getType() . ' $' . $p->getName(), $m->getParameters());
    return $metodo . '(' . implode(', ', $params) . '): ' . $m->getReturnType();
};
$contratoFormato = [
    'nombre(): string',
    'crear(object $body): array',
    'actualizar(array $row, object $body): array',
    'preview(object $body, ?array $row): array',
    'pdf(array $cotizacion): array',
    'permiteCorreo(): bool',
];
$firmasDe = static fn(string $clase): array => array_map(
    static fn(string $f) => $firmaFormato($clase, strstr($f, '(', true)),
    $contratoFormato
);
$chk('CotizacionFormato: abstracta, con los 6 métodos del contrato',
    (new ReflectionClass('CotizacionFormato'))->isAbstract() && $firmasDe('CotizacionFormato') === $contratoFormato);
$formatoMinimo = new class extends CotizacionFormato {
    public function nombre(): string { return 'minimo'; }
    public function crear(object $body): array { return ['error', 'no', 422]; }
    public function actualizar(array $row, object $body): array { return ['error', 'no', 422]; }
    public function preview(object $body, ?array $row): array { return ['error', 'no', 422]; }
    public function pdf(array $cotizacion): array { return ['error', 'no', 422]; }
};
$chk('un formato nuevo no ofrece correo salvo que lo diga (permiteCorreo() = false)', $formatoMinimo->permiteCorreo() === false);

$chk("DEFAULT = 'gratex'", CotizacionFormatos::DEFAULT === 'gratex');
$chk("existe('gratex')", CotizacionFormatos::existe('gratex'));
$chk('existe(null), existe(\'\') y existe(\'x\') = false',
    !CotizacionFormatos::existe(null) && !CotizacionFormatos::existe('') && !CotizacionFormatos::existe('x'));
$chk("existe('GRATEX') = false: la clave es exacta", !CotizacionFormatos::existe('GRATEX'));

$formatoGratex = CotizacionFormatos::para('gratex', $modeloSinDb);
$chk("para('gratex') = GratexFormato", get_class($formatoGratex) === 'GratexFormato' && $formatoGratex instanceof CotizacionFormato);
$chk("GratexFormato: nombre() = 'gratex', permiteCorreo() = true", $formatoGratex->nombre() === 'gratex' && $formatoGratex->permiteCorreo() === true);
$chk('GratexFormato cumple el contrato (mismas firmas)', $firmasDe('GratexFormato') === $contratoFormato);
$chk('el modelo que recibe para() es el que usa el formato',
    (fn() => $this->modelo)->call($formatoGratex) === $modeloSinDb);
$chk("para('gratex') no avisa nada", $leerLogFormatos() === '');
$chk('para(null) = GratexFormato, sin aviso (NULL = cotización de antes de los formatos)',
    get_class(CotizacionFormatos::para(null, $modeloSinDb)) === 'GratexFormato' && $leerLogFormatos() === '');
$chk("para('x') = GratexFormato y lo avisa en el error_log",
    get_class(CotizacionFormatos::para('x', $modeloSinDb)) === 'GratexFormato'
    && str_contains($leerLogFormatos(), 'formato desconocido "x"'));

// delTenant() lee TenantResolver::current(): se le pone el tenant a mano (es
// privado; Reflection basta para un CLI) y se deja como estaba, sin tenant.
$tenantResuelto = new ReflectionProperty('TenantResolver', 'current');
$conTenant = function (?array $tenant) use ($tenantResuelto): string {
    $tenantResuelto->setValue(null, $tenant);
    return CotizacionFormatos::delTenant();
};
$chk('delTenant() sin tenant resuelto = gratex', $conTenant(null) === 'gratex' && $leerLogFormatos() === '');
$chk('delTenant(): tenant sin la columna (master sin la 011) = gratex, sin aviso',
    $conTenant(['id' => 1, 'rnc' => '101000000', 'tipo' => 'app']) === 'gratex' && $leerLogFormatos() === '');
$chk("delTenant(): cotizacion_formato 'gratex' = gratex",
    $conTenant(['id' => 1, 'cotizacion_formato' => 'gratex']) === 'gratex' && $leerLogFormatos() === '');
$chk("delTenant(): 'Ferreteria' (mal escrito en el UPDATE) = gratex, y lo avisa",
    $conTenant(['id' => 5, 'cotizacion_formato' => 'Ferreteria']) === 'gratex'
    && str_contains($leerLogFormatos(), '"Ferreteria" no es un formato conocido'));
$tenantResuelto->setValue(null, null);

$chk('delCuerpo(cuerpo vacío) = gratex', CotizacionFormatos::delCuerpo(new stdClass()) === 'gratex');
$chk('delCuerpo(): el cuerpo de CotizacionFormView (sin "formato") = gratex', CotizacionFormatos::delCuerpo((object) [
    'client_id' => 5, 'date' => '2026-09-02 10:15:00', 'total' => 236, 'user_id' => 3, 'sent_email' => false,
    'items' => [(object) ['description' => 'TUBO', 'amount' => 200, 'quantity' => 1, 'subtotal' => 200]],
]) === 'gratex');
$chk("delCuerpo(): formato 'ferreteria' y 'gratex' se devuelven tal cual",
    CotizacionFormatos::delCuerpo((object) ['formato' => 'ferreteria']) === 'ferreteria'
    && CotizacionFormatos::delCuerpo((object) ['formato' => 'gratex']) === 'gratex');
$chk('delCuerpo(): formato null o que no es texto (5, true, []) = gratex',
    CotizacionFormatos::delCuerpo((object) ['formato' => null]) === 'gratex'
    && CotizacionFormatos::delCuerpo((object) ['formato' => 5]) === 'gratex'
    && CotizacionFormatos::delCuerpo((object) ['formato' => true]) === 'gratex'
    && CotizacionFormatos::delCuerpo((object) ['formato' => []]) === 'gratex');
$chk("delCuerpo(): formato '' es texto y se devuelve tal cual (409 en cualquier tenant)",
    CotizacionFormatos::delCuerpo((object) ['formato' => '']) === '');

$chk('MSG_DESACTUALIZADA (el 409) = el mensaje de la spec', CotizacionFormatos::MSG_DESACTUALIZADA
    === 'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.');

ini_set('error_log', $logAnteriorFormatos === false ? '' : $logAnteriorFormatos);
@unlink($logFormatos);
```

What it pins:
- The contract itself, by Reflection: `CotizacionFormato` is abstract and its 6 methods have exactly the contract's
  signatures (types **and** parameter names); `GratexFormato` has the same ones; a formato that doesn't override
  `permiteCorreo()` hides the email.
- The registry: `existe()` is exact (`'GRATEX'` is not `'gratex'`), `para(null|'x'|'gratex')` all give
  `GratexFormato` (the `'gratex'` one built with the model passed in), and only the unknown name logs.
- `delTenant()`: no tenant, a tenant row without the column (master before 011), `'gratex'`, and a typo
  (`'Ferreteria'`), which falls back to Gratex **and logs**.
- `delCuerpo()`: the exact body `CotizacionFormView` sends today is `'gratex'`; a string is returned as is (`''`
  included, so it gets the 409 everywhere); anything else is `'gratex'`.
- The 409 text, word for word from the spec.

It deliberately asserts nothing about Ferretería being **registered** (`existe('ferreteria')` is false until Task 7):
Task 7 registers it and adds those checks. Every check here stays true after Task 7. The controller's behavior is
tested over HTTP in Step 8.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected:
- The lines of the earlier sections (Tasks 1, 4, 5), unchanged.
- Then `Warning: require_once(C:\Users\Signos\Documents\edwin\api-gratex\tools/../src/Utils/Cotizacion/CotizacionFormatos.php): Failed to open stream: No such file or directory`
  and `Fatal error: Uncaught Error: Failed opening required '...tools/../src/Utils/Cotizacion/CotizacionFormatos.php'`
  (the prefix may be `PHP Warning:` / `PHP Fatal error:` depending on `display_errors`/`log_errors`).
- No `== Registro de formatos (CotizacionFormatos) ==` header, and `exit=255`.

- [ ] **Step 4: Create the contract, `src/Utils/Cotizacion/CotizacionFormato.php`**

Create the file with exactly this content:

```php
<?php
/**
 * Contrato de un formato de cotización (Gratex, Ferretería...).
 *
 * El módulo de cotizaciones nació con las reglas y el PDF de Gratex metidos en
 * el controller, y un tenant con otra hoja no tenía dónde poner las suyas. Cada
 * formato es ahora una clase de esta carpeta que valida, calcula, numera, guarda
 * y dibuja a su manera; cotizacionController.php solo decide cuál toca
 * (CotizacionFormatos), lo llama y envuelve la respuesta como siempre.
 *
 * Todos los métodos devuelven:
 *   ['success', $payload]                 -> el controller responde status:true
 *   ['error', string $mensaje, int $http] -> status:false con ese código HTTP.
 *     El mensaje lo lee el usuario (español claro); el detalle técnico va al
 *     error_log. $http puede ser 200: los errores de cabecera de Gratex
 *     responden 200 con status:false desde siempre y así se quedan.
 *
 * $body es el stdClass que el controller decodifica una sola vez con
 * InputSanitizer::jsonInput(false) (un cuerpo vacío o que no es objeto llega
 * como new stdClass). Las líneas siguen siendo objetos.
 *
 * Para agregar un formato: docs/modules/cotizaciones-formatos.md.
 */
abstract class CotizacionFormato
{
    /** Clave del formato en tenants.cotizacion_formato y cotizaciones.formato. */
    abstract public function nombre(): string;

    /**
     * POST /api/cotizaciones: validar, calcular, numerar y guardar.
     * @return array ['success', mixed $data] | ['error', string $msg, int $http]
     */
    abstract public function crear(object $body): array;

    /**
     * PUT /api/cotizaciones sobre una cotización existente. El número y el
     * código nunca cambian.
     * @param array $row La fila actual (getCotizaciones($id)[0]). [] solo cuando
     *                   ya no existe: ese caso siempre resuelve a Gratex, que
     *                   responde su "ya no existe" de siempre.
     * @return array ['success', mixed $data] | ['error', string $msg, int $http]
     */
    abstract public function actualizar(array $row, object $body): array;

    /**
     * POST /api/cotizaciones/preview: validar y calcular sin guardar.
     * @param array|null $row La fila cuando el cuerpo trae un id que existe
     *                        (la vista previa imprime su código); si no, null.
     * @return array ['success', string $pdfBytes] | ['error', string $msg, int $http]
     */
    abstract public function preview(object $body, ?array $row): array;

    /**
     * GET /api/cotizaciones/{id}/pdf.
     * @param array $cotizacion Fila de getCotizaciones() con sus items.
     * @return array ['success', string $pdfBytes] | ['error', string $msg, int $http]
     */
    abstract public function pdf(array $cotizacion): array;

    /** Si el formulario de este formato ofrece "Enviar por correo". */
    public function permiteCorreo(): bool
    {
        return false;
    }
}
```

`docs/modules/cotizaciones-formatos.md` is created by Task 8.

- [ ] **Step 5: Move Gratex, `src/Utils/Cotizacion/GratexFormato.php`**

Create the file with exactly this content. Each method body is the old controller branch (old lines in brackets),
with only the substitutions listed in the notes; Step 11 proves it line by line.
- `crear()` `:45-70` ← POST create `cotizacionController.php:190-219`, minus the CREATE audit `:209-214`, which stays in
  the controller.
- `actualizar()` `:76-100` ← PUT `:227-256`, minus the `id` check `:225-226`, the `$oldCotizacion` read `:242` and the
  UPDATE audit `:246-251`, which stay in the controller.
- `preview()` `:107-145` ← preview `:138-185`, minus the JSON envelope `:172-185`, which stays in the controller.
  Still no `cotValidarItems`, still no `count()` on `items`, still the `clients` lookup and the code `'PREVIEW'`.
- `pdf()` `:147-156` ← GET pdf `:79-84`.

```php
<?php
require_once __DIR__ . '/CotizacionFormato.php';
require_once __DIR__ . '/../../Models/cotizacionModel.php';

/**
 * Formato de cotización de Gratex: el de siempre, y el de todo tenant cuyo
 * tenants.cotizacion_formato no diga otra cosa.
 *
 * Es el código de las ramas POST, POST /preview, PUT y GET /{id}/pdf de
 * cotizacionController.php MOVIDO TAL CUAL: mismas validaciones en el mismo
 * orden, mismos mensajes, mismos códigos HTTP (los errores de cabecera y los
 * del modelo responden 200 con status:false; los de línea, 422) y las mismas
 * llamadas al modelo con los mismos argumentos. Solo cambió de dónde sale el
 * cuerpo ($body, que el controller decodifica una vez) y que se devuelve
 * ['success'|'error', ...] en vez de armar $respuesta: el controller la
 * envuelve y escribe la auditoría igual que antes. Un cambio de reglas de
 * Gratex va aquí, no en el controller.
 *
 * cotValidarItems() y las constantes COT_* siguen definidas en
 * cotizacionController.php (globales). Esta clase solo se usa desde ese
 * controller, así que ya existen cuando estos métodos corren.
 *
 * El correo sigue dentro de cotizacionModel::saveCotizacion/updateCotizacion,
 * sin tocar: por eso este es el formato que permite enviar por correo.
 */
final class GratexFormato extends CotizacionFormato
{
    private cotizacionModel $modelo;

    public function __construct(cotizacionModel $modelo)
    {
        $this->modelo = $modelo;
    }

    public function nombre(): string
    {
        return 'gratex';
    }

    public function permiteCorreo(): bool
    {
        return true;
    }

    public function crear(object $body): array
    {
        if (!isset($body->client_id) || is_null($body->client_id)) {
            return ['error', COT_SIN_CLIENTE, 200];
        } else if (!isset($body->items) || !is_array($body->items) || count($body->items) == 0) {
            return ['error', COT_SIN_LINEAS, 200];
        } else if (!isset($body->total) || !is_numeric($body->total)) {
            return ['error', COT_TOTAL_INVALIDO, 200];
        } else {
            $itemError = cotValidarItems($body->items);
            if ($itemError !== null) {
                // 422 como las demas validaciones de lineas (facturas, gastos).
                return ['error', $itemError, 422];
            } else {
                $date = isset($body->date) ? $body->date : '';
                $user_id = isset($body->user_id) ? $body->user_id : null;
                $send_email = isset($body->sent_email) && $body->sent_email === true;
                $result = $this->modelo->saveCotizacion($body->client_id, $date, $body->items, $body->total, $user_id, $send_email);
                if ($result[0] === 'success') {
                    return ['success', $result[1]];
                } else {
                    return ['error', $result[1], 200];
                }
            }
        }
    }

    /**
     * Gratex no lee $row: updateCotizacion vuelve a buscar la fila por id y,
     * si ya no existe, responde su "ya no existe" de siempre.
     */
    public function actualizar(array $row, object $body): array
    {
        if (!isset($body->client_id) || is_null($body->client_id)) {
            return ['error', COT_SIN_CLIENTE, 200];
        } else if (!isset($body->items) || !is_array($body->items) || count($body->items) == 0) {
            return ['error', COT_SIN_LINEAS, 200];
        } else if (!isset($body->total) || !is_numeric($body->total)) {
            return ['error', COT_TOTAL_INVALIDO, 200];
        } else {
            $itemError = cotValidarItems($body->items);
            if ($itemError !== null) {
                return ['error', $itemError, 422];
            } else {
                $date = isset($body->date) ? $body->date : '';
                $user_id = isset($body->user_id) ? $body->user_id : null;
                $send_email = isset($body->sent_email) && $body->sent_email === true;
                $result = $this->modelo->updateCotizacion($body->id, $body->client_id, $date, $body->items, $body->total, $user_id, $send_email);
                if ($result[0] === 'success') {
                    return ['success', $result[1]];
                } else {
                    return ['error', $result[1], 200];
                }
            }
        }
    }

    /**
     * La vista previa de siempre: las mismas 3 comprobaciones de cabecera y
     * NINGUNA de líneas (cotValidarItems no corre aquí, como antes), código
     * 'PREVIEW'. Gratex no lee $row: no imprime el código de la guardada.
     */
    public function preview(object $body, ?array $row): array
    {
        // Validate required fields
        if (!isset($body->client_id) || is_null($body->client_id)) {
            return ['error', COT_SIN_CLIENTE, 200];
        } else if (!isset($body->items) || !is_array($body->items)) {
            return ['error', COT_SIN_LINEAS, 200];
        } else if (!isset($body->total) || !is_numeric($body->total)) {
            return ['error', COT_TOTAL_INVALIDO, 200];
        } else {
            // Convert items to associative arrays
            $items = array_map(function ($item) {
                return (array)$item;
            }, $body->items);
            // Look up client_name from clients table
            require_once(__DIR__ . '/../../Models/clientModel.php');
            $clientModelInstance = new clientModel();
            $clientData = $clientModelInstance->getClients($body->client_id);
            $client_name = (!empty($clientData) && isset($clientData[0]['client_name'])) ? $clientData[0]['client_name'] : '';
            // Prepare a fake cotizacion array (as in getCotizaciones)
            $cotizacion = [[
                'id' => null,
                'code' => 'PREVIEW',
                'date' => isset($body->date) ? $body->date : '',
                'client_id' => $body->client_id,
                'client_name' => $client_name,
                'total' => $body->total,
                'items' => $items,
                'description' => '',
            ]];
            // Generate PDF
            require_once(__DIR__ . '/../CotizacionPdfGenerator.php');
            $pdf = new CotizacionPdfGenerator('P', 'mm', 'Letter');
            $pdf->setCotizacion($cotizacion[0]);
            $pdfContent = $pdf->generatePdf();

            return ['success', $pdfContent];
        }
    }

    public function pdf(array $cotizacion): array
    {
        // Include PDF generator
        require_once(__DIR__ . '/../CotizacionPdfGenerator.php');
        // Generate and output PDF
        $pdf = new CotizacionPdfGenerator('P', 'mm', 'Letter');
        $pdf->setCotizacion($cotizacion);
        $pdfContent = $pdf->generatePdf();
        return ['success', $pdfContent];
    }
}
```

- [ ] **Step 6: Create the registry, `src/Utils/Cotizacion/CotizacionFormatos.php`**

Create the file with exactly this content:

```php
<?php
require_once __DIR__ . '/CotizacionFormato.php';
require_once __DIR__ . '/../../Models/cotizacionModel.php';
require_once __DIR__ . '/../../TenantResolver.php';

/**
 * Registro de formatos de cotización: qué clase atiende cada nombre.
 *
 * Quién decide el formato (cotizacionController.php):
 *   - una cotización nueva, el de la empresa: tenants.cotizacion_formato
 *     (delTenant);
 *   - una que ya existe, el suyo: cotizaciones.formato (NULL = gratex). Así
 *     cambiar el ajuste del tenant no reinterpreta las cotizaciones guardadas.
 *
 * Un nombre desconocido o NULL cae en Gratex: es lo que tenían todos los
 * tenants antes de que hubiera formatos, y lo que espera un tenant sin la
 * migración master 011.
 *
 * Agregar un formato es UNA línea en FORMATOS: el archivo de la clase se llama
 * igual que ella y vive en esta carpeta, y se carga solo cuando se usa (una
 * petición de Gratex no carga el formato ni el PDF de otro tenant).
 */
final class CotizacionFormatos
{
    public const DEFAULT = 'gratex';

    /** Respuesta 409 de cotizacionController cuando el cuerpo trae otro formato que el elegido. */
    public const MSG_DESACTUALIZADA = 'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.';

    /** @var array<string,class-string<CotizacionFormato>> nombre => clase */
    private const FORMATOS = [
        'gratex' => GratexFormato::class,
    ];

    public static function existe(?string $nombre): bool
    {
        return $nombre !== null && isset(self::FORMATOS[$nombre]);
    }

    /** El formato $nombre; null o desconocido => Gratex. No lanza. */
    public static function para(?string $nombre, cotizacionModel $modelo): CotizacionFormato
    {
        if ($nombre !== null && !self::existe($nombre)) {
            // Una fila o un tenant con un formato que este código no conoce
            // (un error de tipeo en el UPDATE, o código viejo): se dibuja como
            // Gratex, y ops tiene que poder verlo.
            error_log('[cotizaciones] formato desconocido "' . $nombre . '": se usa ' . self::DEFAULT);
        }
        $clase = self::FORMATOS[self::existe($nombre) ? $nombre : self::DEFAULT];
        require_once __DIR__ . '/' . $clase . '.php';
        return new $clase($modelo);
    }

    /**
     * El formato de la empresa de la petición: tenants.cotizacion_formato. Sin
     * tenant resuelto (instalación de un solo tenant) o sin la columna (master
     * sin la 011; TenantResolver lee los tenants con SELECT *) es Gratex.
     */
    public static function delTenant(): string
    {
        $nombre = TenantResolver::current()['cotizacion_formato'] ?? null;
        if ($nombre === null) {
            return self::DEFAULT;
        }
        if (is_string($nombre) && self::existe($nombre)) {
            return $nombre;
        }
        error_log('[cotizaciones] tenants.cotizacion_formato = "' . print_r($nombre, true) . '" no es un formato conocido: se usa ' . self::DEFAULT);
        return self::DEFAULT;
    }

    /**
     * El formato que dice el cuerpo de la petición. El formulario de Gratex no
     * manda "formato" (es gratex); los demás lo mandan siempre, para que el
     * controller detecte una pestaña o un bundle viejo (409) en vez de guardar
     * un cuerpo de un formato con las reglas de otro.
     */
    public static function delCuerpo(object $body): string
    {
        return isset($body->formato) && is_string($body->formato) ? $body->formato : self::DEFAULT;
    }
}
```

Task 7 registers Ferretería by adding **one line** after `:32`, nothing else in this file:

```php
    private const FORMATOS = [
        'gratex' => GratexFormato::class,
        'ferreteria' => FerreteriaFormato::class,
    ];
```

- [ ] **Step 7: Lint and run the harness: the T6 section passes**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
for f in src/Utils/Cotizacion/CotizacionFormato.php src/Utils/Cotizacion/GratexFormato.php src/Utils/Cotizacion/CotizacionFormatos.php tools/test_cotizacion_ferreteria.php; do php -l "$f"; done
php tools/test_cotizacion_ferreteria.php | sed -n '/== Registro de formatos/,$p'; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- `No syntax errors detected in ...` four times.
- Under `== Registro de formatos (CotizacionFormatos) ==`, 23 `[OK  ]` lines and no `[FALLA]`.
- No stray `[cotizaciones] ...` lines in the output: the section sends `error_log` to a temp file.
- The summary reads `(N+23)/(N+23) OK` with the N from Step 1, and `exit=0`.

- [ ] **Step 8: Write the controller's failing test (HTTP equivalence, old vs new) and watch the guard cases fail**

Spec 9.1 asks for an HTTP before/after comparison against a local Gratex-shaped DB. There is no local MySQL, so this
script replaces the DB with fakes and compares the **controllers**:
- It builds two minimal trees in a temp folder: the old controller (the pinned blob `094e70e`, never `HEAD`) and the
  working tree's controller plus the 3 new classes.
- Both get the same fakes: a `cotizacionModel` with row 7 (no `formato` key, like a row before 026), recorded writes,
  and the real error strings; `clientModel`; `AuthMiddleware` that always passes; `TenantResolver` fed by the
  `X-Tenant-Formato` header; `CotizacionPdfGenerator` that returns its constructor args and input as fake PDF bytes;
  `AuditLogger` that records events. The real `InputSanitizer` and the real `unidadMedidaModel` rules are used (without
  their connection: with no unit the rule never reads the DB).
- A router wraps each response in a JSON envelope: the HTTP code, every header, the raw body, the recorded writes and
  the audit events. Reads aren't compared, because the new PUT reads first.
- The 33 Gratex cases must be byte-identical between the two servers. The 4 guard cases run only on the new one.
- It needs ports 18761 and 18762 free, and `php`, `curl` and `cygpath` (Git Bash has them). The servers are killed and
  the temp folder deleted on exit.

Write it to `/tmp/equivalencia_t06.sh` (outside the repo; Step 13 deletes it) and run it now, while the working tree
still has the old controller:

```bash
cat > /tmp/equivalencia_t06.sh <<'GUION_T6'
#!/usr/bin/env bash
# Equivalencia HTTP del controller de cotizaciones: el de antes (blob 094e70e) contra el refactor (T6), con modelos falsos y sin DB.
# Nada de esto se commitea: todo vive en una carpeta temporal que se borra al final.
set -u
REPO=C:/Users/Signos/Documents/edwin/api-gratex
NUEVO=${NUEVO:-$REPO}          # raiz de donde se leen los archivos nuevos (el working tree)
T=$(cygpath -m "$(mktemp -d)")   # ruta de Windows: php.exe no entiende /tmp/...
P1=; P2=
trap '[ -n "$P1$P2" ] && kill $P1 $P2 2>/dev/null; rm -rf "$T"' EXIT

# --- dos arboles minimos: viejo (blob 094e70e) y nuevo (working tree) ---
for lado in viejo nuevo; do
  mkdir -p "$T/$lado/src/Controllers" "$T/$lado/src/Models" "$T/$lado/src/Middleware" "$T/$lado/src/Utils/Cotizacion"
  cp "$REPO/src/Utils/InputSanitizer.php" "$T/$lado/src/Utils/"
  # unidadMedidaModel real, sin conexion: con unidad null la regla nunca lee la DB.
  sed -e "s#^require_once __DIR__ . '/../MasterDatabase.php';##" \
      -e 's#\$this->conexion = MasterDatabase::getInstance()->getConnection();##' \
      "$REPO/src/Models/unidadMedidaModel.php" > "$T/$lado/src/Models/unidadMedidaModel.php"
done
git -C "$REPO" cat-file -p 094e70ea22881b72c6b6135455665536b6dd71c4 > "$T/viejo/src/Controllers/cotizacionController.php"
cp "$NUEVO/src/Controllers/cotizacionController.php" "$T/nuevo/src/Controllers/"
cp "$NUEVO"/src/Utils/Cotizacion/{CotizacionFormato,CotizacionFormatos,GratexFormato}.php "$T/nuevo/src/Utils/Cotizacion/"

cat > "$T/falsos.php" <<'EOF'
<?php
// FALSOS: sin DB ni FPDF. Las escrituras y la auditoria se anotan para compararlas.
class cotizacionModel
{
    public static function fila(): array
    {
        return ['id' => 7, 'code' => 'ABC123', 'date' => '2026-09-02 10:15:00', 'client_id' => 5, 'total' => '236.00',
            'user_id' => 3, 'client_name' => 'CLIENTE PRUEBA', 'company_name' => 'CLIENTE SRL', 'rnc' => '401515131',
            'description' => 'TUBO', 'items' => self::items()];
    }
    public static function items(): array
    {
        return [['id' => 1, 'description' => 'TUBO', 'amount' => '200.0000', 'quantity' => '1.000', 'subtotal' => '200.00']];
    }
    public function getCotizaciones($id = null) { return ($id == null || (string) $id === '7') ? [self::fila()] : []; }
    public function getCotizacionItems($id) { return (string) $id === '7' ? self::items() : []; }
    public function getCotizacionesPaginated($offset, $limit, $query = null) { return [self::fila()]; }
    public function getCotizacionesCount($query = null) { return 1; }
    public function saveCotizacion($client_id, $date, $items, $total, $user_id = null, $send_email = false)
    {
        $GLOBALS['__escrituras'][] = ['saveCotizacion', func_get_args()];
        return (string) $client_id === '666'
            ? ['error', 'No se pudo guardar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.']
            : ['success', ['id' => 99, 'code' => 'XYZ789', 'message' => 'Cotization saved']];
    }
    public function updateCotizacion($id, $client_id, $date, $items, $total, $user_id = null, $send_email = false)
    {
        $GLOBALS['__escrituras'][] = ['updateCotizacion', func_get_args()];
        return (string) $id === '7' ? ['success', 'Cotization updated']
            : ['error', 'Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado.'];
    }
    public function deleteCotizacion($id)
    {
        $GLOBALS['__escrituras'][] = ['deleteCotizacion', func_get_args()];
        return (string) $id === '7' ? ['success', 'Cotization deleted']
            : ['error', 'Esta cotización ya no existe. Puede que otra persona la haya eliminado; actualiza el listado.'];
    }
}
class clientModel
{
    public function getClients($id = null) { return (string) $id === '5' ? [['id' => 5, 'client_name' => 'CLIENTE PRUEBA']] : []; }
}
class AuthMiddleware
{
    public function validateRequest() { return ['valid' => true]; }
    public function sendUnauthorized($m) { http_response_code(401); echo json_encode(['status' => false, 'error' => $m]); exit; }
}
class TenantResolver
{
    // El formato del tenant llega en la cabecera X-Tenant-Formato; sin ella, no hay tenant resuelto.
    public static function current(): ?array
    {
        $f = $_SERVER['HTTP_X_TENANT_FORMATO'] ?? null;
        return $f === null ? null : ['id' => 1, 'cotizacion_formato' => $f];
    }
}
class CotizacionPdfGenerator
{
    private $args;
    private $c;
    public function __construct(...$args) { $this->args = $args; }
    public function setCotizacion($c) { $this->c = $c; }
    public function generatePdf() { return '%PDF-falso ' . json_encode([$this->args, $this->c], JSON_UNESCAPED_UNICODE); }
}
class AuditLogger
{
    public static function log(array $e): void { $GLOBALS['__auditoria'][] = $e; }
}
EOF
for lado in viejo nuevo; do
  for f in Models/cotizacionModel.php Models/clientModel.php Middleware/AuthMiddleware.php TenantResolver.php Utils/CotizacionPdfGenerator.php; do
    printf '<?php\nrequire_once %s;\n' "'$T/falsos.php'" > "$T/$lado/src/$f"
  done
  cat > "$T/$lado/router.php" <<'EOF'
<?php
// Todo lo que el controller hizo, en un sobre JSON: codigo, cabeceras, cuerpo, escrituras y auditoria.
$GLOBALS['__escrituras'] = [];
$GLOBALS['__auditoria'] = [];
require __DIR__ . '/src/Middleware/AuthMiddleware.php';
require __DIR__ . '/src/Utils/InputSanitizer.php';
ob_start();
register_shutdown_function(function () {
    $cuerpo = ob_get_clean();
    $sobre = [
        'http' => http_response_code(),
        'cabeceras' => array_values(array_filter(headers_list(), fn($h) => stripos($h, 'X-Powered-By') !== 0)),
        'cuerpo' => $cuerpo,
        'escrituras' => $GLOBALS['__escrituras'],
        'auditoria' => $GLOBALS['__auditoria'],
    ];
    header_remove();
    http_response_code(200);
    echo json_encode($sobre, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
});
require __DIR__ . '/src/Controllers/cotizacionController.php';
EOF
done

php -S 127.0.0.1:18761 -t "$T/viejo" "$T/viejo/router.php" > "$T/viejo.log" 2>&1 & P1=$!
php -S 127.0.0.1:18762 -t "$T/nuevo" "$T/nuevo/router.php" > "$T/nuevo.log" 2>&1 & P2=$!
for p in 18761 18762; do curl -s -o /dev/null --retry 30 --retry-connrefused --retry-delay 1 "http://127.0.0.1:$p/api/cotizaciones?page=1"; done

pedir() { # puerto metodo ruta cuerpo [cabecera]
  local extra=(); [ -n "${5:-}" ] && extra=(-H "$5")
  if [ "$4" = "-" ]; then curl -s -X "$2" "${extra[@]}" "http://127.0.0.1:$1$3"
  else curl -s -X "$2" -H 'Content-Type: application/json' "${extra[@]}" --data-binary "$4" "http://127.0.0.1:$1$3"; fi
}
iguales=0; distintos=0
igual() { # nombre metodo ruta cuerpo [cabecera]: viejo y nuevo tienen que responder EXACTAMENTE lo mismo
  pedir 18761 "$2" "$3" "$4" "${5:-}" > "$T/v.json"; pedir 18762 "$2" "$3" "$4" "${5:-}" > "$T/n.json"
  if cmp -s "$T/v.json" "$T/n.json" && grep -q '"http"' "$T/v.json"; then iguales=$((iguales+1)); echo "  [IGUAL] $1"
  else distintos=$((distintos+1)); echo "  [DISTINTO] $1"; diff "$T/v.json" "$T/n.json" | head -40; fi
}
nuevo() { # nombre metodo ruta cuerpo cabecera patron...: solo el nuevo; cada patron (grep -F) tiene que aparecer
  local n=$1 m=$2 r=$3 c=$4 h=$5; shift 5
  pedir 18762 "$m" "$r" "$c" "$h" > "$T/n.json"
  local ok=1; for pat in "$@"; do grep -qF -- "$pat" "$T/n.json" || { ok=0; echo "     falta: $pat"; }; done
  if [ $ok = 1 ]; then iguales=$((iguales+1)); echo "  [OK    ] $n"; else distintos=$((distintos+1)); echo "  [FALLA ] $n"; cat "$T/n.json"; echo; fi
}

L='{"description":"TUBO","amount":200,"quantity":1,"subtotal":200}'
G='"client_id":5,"date":"2026-09-02 10:15:00","items":['$L'],"total":236,"user_id":3,"sent_email":false'
echo "== Gratex: viejo y nuevo responden lo mismo =="
igual 'GET lista paginada'                  GET    '/api/cotizaciones?page=1'               -
igual 'GET ?id=7'                           GET    '/api/cotizaciones?id=7'                 -
igual 'GET /7/pdf?format=base64'            GET    '/api/cotizaciones/7/pdf?format=base64'  -
igual 'GET /7/pdf (descarga)'               GET    '/api/cotizaciones/7/pdf'                -
igual 'GET /404/pdf -> 404'                 GET    '/api/cotizaciones/404/pdf'              -
igual 'POST crear'                          POST   '/api/cotizaciones'                      "{$G}"
igual 'POST crear con sent_email true'      POST   '/api/cotizaciones'                      "{${G/false/true}}"
igual 'POST sin client_id'                  POST   '/api/cotizaciones'                      '{"items":['$L'],"total":236}'
igual 'POST items vacio'                    POST   '/api/cotizaciones'                      '{"client_id":5,"items":[],"total":236}'
igual 'POST total invalido'                 POST   '/api/cotizaciones'                      '{"client_id":5,"items":['$L'],"total":"x"}'
igual 'POST linea sin descripcion -> 422'   POST   '/api/cotizaciones'                      '{"client_id":5,"items":[{"amount":1,"quantity":1}],"total":1}'
igual 'POST cantidad 0.001 -> 422'          POST   '/api/cotizaciones'                      '{"client_id":5,"items":[{"description":"A","amount":1,"quantity":0.001}],"total":1}'
igual 'POST error del modelo (200)'         POST   '/api/cotizaciones'                      '{"client_id":666,"items":['$L'],"total":236}'
igual 'POST sin cuerpo'                     POST   '/api/cotizaciones'                      -
igual 'POST JSON invalido'                  POST   '/api/cotizaciones'                      '{no es json'
igual 'POST cuerpo que es un arreglo'       POST   '/api/cotizaciones'                      '[1,2]'
igual 'POST formato "gratex" explicito'     POST   '/api/cotizaciones'                      "{$G,\"formato\":\"gratex\"}"
igual 'preview'                             POST   '/api/cotizaciones/preview'              '{"client_id":5,"date":"","items":['$L'],"total":236}'
igual 'preview sin total'                   POST   '/api/cotizaciones/preview'              '{"client_id":5,"items":['$L']}'
igual 'preview items vacio (pasa, como antes)' POST '/api/cotizaciones/preview'             '{"client_id":5,"items":[],"total":0}'
igual 'preview linea mala (pasa, como antes)'  POST '/api/cotizaciones/preview'             '{"client_id":9,"items":[{"amount":"x"}],"total":0}'
igual 'preview con id 7'                    POST   '/api/cotizaciones/preview'              '{"id":7,"client_id":5,"items":['$L'],"total":236}'
igual 'PUT sin id'                          PUT    '/api/cotizaciones'                      "{$G}"
igual 'PUT id 7'                            PUT    '/api/cotizaciones'                      "{\"id\":7,$G}"
igual 'PUT id "7" (string)'                 PUT    '/api/cotizaciones'                      "{\"id\":\"7\",$G}"
igual 'PUT id que ya no existe'             PUT    '/api/cotizaciones'                      "{\"id\":404,$G}"
igual 'PUT id 0'                            PUT    '/api/cotizaciones'                      "{\"id\":0,$G}"
igual 'PUT sin client_id'                   PUT    '/api/cotizaciones'                      '{"id":7,"items":['$L'],"total":236}'
igual 'PUT linea mala -> 422'               PUT    '/api/cotizaciones'                      '{"id":7,"client_id":5,"items":[{"description":"","amount":1,"quantity":1}],"total":1}'
igual 'DELETE id 7'                         DELETE '/api/cotizaciones'                      '{"id":7}'
igual 'DELETE sin id'                       DELETE '/api/cotizaciones'                      '{}'
igual 'DELETE id que ya no existe'          DELETE '/api/cotizaciones'                      '{"id":404}'
igual 'tenant con formato desconocido: Gratex' POST '/api/cotizaciones'                     "{$G}" 'X-Tenant-Formato: Ferreteria'

# Solo la parte ASCII: el cuerpo sale de json_encode, que escapa los acentos (como siempre).
M='desactualizada (cambi'; M2='el formato de tu empresa). Recarga la p'
echo "== Solo el nuevo: guardia de formato (409, sin escribir nada) =="
nuevo 'POST cuerpo ferreteria en tenant gratex -> 409' POST '/api/cotizaciones' "{$G,\"formato\":\"ferreteria\"}" '' '"http": 409' "$M" "$M2" '"escrituras": []' '"auditoria": []'
nuevo 'PUT cuerpo ferreteria sobre fila gratex -> 409' PUT '/api/cotizaciones' "{\"id\":7,$G,\"formato\":\"ferreteria\"}" '' '"http": 409' "$M" "$M2" '"escrituras": []'
nuevo 'preview cuerpo ferreteria en tenant gratex -> 409' POST '/api/cotizaciones/preview' '{"formato":"ferreteria","client_id":5,"items":[]}' '' '"http": 409' "$M"
nuevo 'PUT fila que ya no existe + cuerpo ferreteria -> 409' PUT '/api/cotizaciones' '{"id":404,"formato":"ferreteria"}' '' '"http": 409' '"escrituras": []'

kill $P1 $P2 2>/dev/null; wait $P1 $P2 2>/dev/null
echo "== error_log del nuevo =="
grep -F '[cotizaciones]' "$T/nuevo.log" | sed 's/^.*\[cotizaciones\]/  [cotizaciones]/'
echo "== avisos de PHP (tiene que salir vacio) =="
grep -iE 'warning|notice|deprecated|fatal' "$T/viejo.log" "$T/nuevo.log"
printf '\n%d iguales/OK, %d distintos/fallas\n' "$iguales" "$distintos"
[ "$distintos" -eq 0 ]
GUION_T6
timeout 300 bash /tmp/equivalencia_t06.sh > /tmp/equivalencia_t06.out; echo "exit=$?"
grep -oE '^  \[(IGUAL|DISTINTO|OK    |FALLA )\]' /tmp/equivalencia_t06.out | sort | uniq -c
grep -E '^  \[FALLA \]|iguales' /tmp/equivalencia_t06.out
```

Expected: `exit=1`, then these counts and lines:

```text
      4   [FALLA ]
     33   [IGUAL]
  [FALLA ] POST cuerpo ferreteria en tenant gratex -> 409
  [FALLA ] PUT cuerpo ferreteria sobre fila gratex -> 409
  [FALLA ] preview cuerpo ferreteria en tenant gratex -> 409
  [FALLA ] PUT fila que ya no existe + cuerpo ferreteria -> 409
33 iguales/OK, 4 distintos/fallas
```

In `/tmp/equivalencia_t06.out`, each `[FALLA ]` is followed by its envelope: HTTP 200, and for the first two a
recorded `saveCotizacion` / `updateCotizacion` write plus a CREATE / UPDATE audit event. That is the bug the guard
closes: today's controller saves a body that claims another formato.

- [ ] **Step 9: Refactor `src/Controllers/cotizacionController.php`**

Re-read the file and run the guard again; write the file only if it prints `ok, se puede escribir`:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
[ "$(git rev-parse HEAD:src/Controllers/cotizacionController.php)" = 094e70ea22881b72c6b6135455665536b6dd71c4 ] \
  && git diff --quiet HEAD -- src/Controllers/cotizacionController.php && echo "ok, se puede escribir"
```

The file is identical to the blob this plan was written against, so writing it whole changes only the ranges listed
under **Files** (Step 12 checks the hunks). Replace its whole content with:

```php
<?php
header('Access-Control-Allow-Origin: *');
header("Access-Control-Allow-Headers: X-API-KEY, Authorization, Origin, X-Requested-With, Content-Type, Accept, Access-Control-Request-Method");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE");
header("Allow: GET, POST, OPTIONS, PUT, DELETE");
header('content-type: application/json; charset=utf-8');
require_once(__DIR__ . '/../Models/cotizacionModel.php');
require_once(__DIR__ . '/../Middleware/AuthMiddleware.php');
require_once(__DIR__ . '/../Utils/Cotizacion/CotizacionFormatos.php');

$cotizacionModel = new cotizacionModel();
$auth = new AuthMiddleware();

/**
 * Valida las lineas de una cotizacion (crear y editar usan la misma regla).
 * Devuelve el mensaje para el usuario, o null si todas estan bien. Las lineas
 * se numeran desde 1, como las ve el usuario en el formulario.
 */
function cotValidarItems(array $items): ?string
{
    require_once __DIR__ . '/../Models/unidadMedidaModel.php';
    $unidades = new unidadMedidaModel();
    foreach (array_values($items) as $index => $item) {
        $linea = $index + 1;
        if (!isset($item->description) || empty(trim($item->description))) {
            return 'La línea ' . $linea . ' no tiene descripción. Escríbela o quita esa línea.';
        }
        if (!isset($item->amount) || !is_numeric($item->amount)) {
            return 'El precio de la línea ' . $linea . ' no es válido. Revísalo.';
        }
        // Mayor que 0 y hasta 2 decimales. Antes se exigia un entero de 1 o mas
        // (cotizacion_items.quantity era INT): 0.5 m no se podia cotizar y 1.5
        // se guardaba como 2. Dos decimales y no tres porque la cotizacion se
        // convierte en e-CF, cuyo CantidadItem admite 2. Las lineas de una
        // cotizacion no llevan unidad de medida: no hay regla de fracciones.
        // Sin cantidad, o una que no es numero, cuenta como 0 (mayor que 0).
        $cantidad = isset($item->quantity) && is_numeric($item->quantity) ? (float) $item->quantity : 0.0;
        $problema = $unidades->problemaCantidad($cantidad, null, 2);
        if ($problema !== null) {
            return 'Línea ' . $linea . ': ' . mb_strtolower(mb_substr($problema, 0, 1)) . mb_substr($problema, 1);
        }
    }
    return null;
}

const COT_SIN_CLIENTE = 'Elige un cliente para la cotización.';
const COT_SIN_LINEAS = 'Agrega al menos una línea a la cotización.';
const COT_TOTAL_INVALIDO = 'El total de la cotización no es válido. Revisa los precios y las cantidades.';

/**
 * La cotizacion $id como la lee getCotizaciones(), con el mismo valor que
 * recibira el modelo (la misma fila que va a tocar), o null si no existe. Con
 * un $id == null (0, '', false) getCotizaciones() devuelve TODAS las filas, y
 * la primera seria otra cotizacion, con otro formato: ahi no hay fila.
 */
function cotFila(cotizacionModel $modelo, $id): ?array
{
    if (!is_scalar($id) || $id == null) {
        return null;
    }
    return $modelo->getCotizaciones($id)[0] ?? null;
}

/**
 * El formato que dice el cuerpo tiene que ser el que eligio el servidor. Si no,
 * la pantalla es de antes del cambio de formato (pestaña abierta, bundle viejo)
 * y guardarla con las reglas del otro formato cambiaria los montos: Gratex
 * manda precios con ITBIS y Ferreteria se lo suma encima. 409 y no se guarda
 * nada. Devuelve false si ya respondio.
 */
function cotFormatoCoincide(object $body, CotizacionFormato $formato): bool
{
    $delCuerpo = CotizacionFormatos::delCuerpo($body);
    if ($delCuerpo === $formato->nombre()) {
        return true;
    }
    error_log('[cotizaciones] el cuerpo dice formato "' . $delCuerpo . '" y toca "' . $formato->nombre() . '": 409');
    http_response_code(409);
    echo json_encode(['status' => false, 'error' => CotizacionFormatos::MSG_DESACTUALIZADA]);
    return false;
}

/**
 * Respuesta de un ['error', $mensaje, $http] de un formato. El codigo solo se
 * fija si no es 200: los errores de cabecera de Gratex responden 200 con
 * status:false, como siempre.
 */
function cotError(array $resultado): array
{
    if ($resultado[2] !== 200) {
        http_response_code($resultado[2]);
    }
    return ['status' => false, 'error' => $resultado[1]];
}

// Validate token for all requests except OPTIONS
if ($_SERVER['REQUEST_METHOD'] !== 'OPTIONS') {
    $validation = $auth->validateRequest();
    if (!$validation['valid']) {
        $auth->sendUnauthorized($validation['message']);
    }
}

// Check if this is a PDF request
$endpoint = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$isPdfRequest = preg_match('/\/api\/cotizaciones\/(\d+)\/pdf/', $endpoint, $pdfMatches);
// Preview PDF endpoint
$isPreviewRequest = preg_match('/\/api\/cotizaciones\/preview$/', $endpoint);

// El cuerpo se decodifica una sola vez. Vacio o que no es un objeto JSON queda
// como objeto vacio: los formatos reciben siempre un objeto, y cada isset()
// responde lo mismo que antes con null.
$body = InputSanitizer::jsonInput(false);
if (!is_object($body)) {
    $body = new stdClass();
}

switch ($_SERVER['REQUEST_METHOD']) {
    case 'GET':
        // Handle PDF generation request
        if ($isPdfRequest) {
            $cotizacionId = $pdfMatches[1];
            $cotizaciones = $cotizacionModel->getCotizaciones($cotizacionId);
            if (empty($cotizaciones)) {
                // El codigo antes del echo: despues de enviar el cuerpo ya no se
                // puede cambiar si no hay buffer de salida.
                http_response_code(404);
                header('content-type: application/json; charset=utf-8');
                echo json_encode(['status' => false, 'error' => 'No encontramos esta cotización. Puede que la hayan eliminado; actualiza el listado.']);
                break;
            }
            $cotizacionData = $cotizaciones[0];
            $cotizacionData['items'] = $cotizacionModel->getCotizacionItems($cotizacionId);
            // El PDF lo dibuja el formato de la fila (sin formato = Gratex), no
            // el que tenga hoy la empresa.
            $resultado = CotizacionFormatos::para($cotizacionData['formato'] ?? null, $cotizacionModel)->pdf($cotizacionData);
            if ($resultado[0] !== 'success') {
                $respuesta = cotError($resultado);
                header('content-type: application/json; charset=utf-8');
                echo json_encode($respuesta);
                break;
            }
            $pdfContent = $resultado[1];
            // Check if user wants base64 or download
            $format = isset($_GET['format']) ? $_GET['format'] : 'download';
            if ($format === 'base64') {
                header('content-type: application/json; charset=utf-8');
                echo json_encode([
                    'status' => true,
                    'data' => [
                        'filename' => 'Cotizacion_' . $cotizacionData['code'] . '.pdf',
                        'content' => base64_encode($pdfContent),
                        'mime_type' => 'application/pdf'
                    ]
                ]);
            } else {
                // Output as PDF download
                header('Content-Type: application/pdf');
                header('Content-Disposition: attachment; filename="Cotizacion_' . $cotizacionData['code'] . '.pdf"');
                header('Content-Length: ' . strlen($pdfContent));
                echo $pdfContent;
            }
            break;
        }
        if (isset($_GET['id'])) {
            $cotizaciones = $cotizacionModel->getCotizaciones($_GET['id']);
            $respuesta = [
                'status' => true,
                'data' => $cotizaciones
            ];
        } else {
            // Pagination logic
            $page = isset($_GET['page']) && is_numeric($_GET['page']) && $_GET['page'] > 0 ? (int) $_GET['page'] : 1;
            $pageSize = isset($_GET['pageSize']) && is_numeric($_GET['pageSize']) && $_GET['pageSize'] > 0 ? (int) $_GET['pageSize'] : 10;
            $query = isset($_GET['query']) ? $_GET['query'] : null;
            $offset = ($page - 1) * $pageSize;
            $cotizaciones = $cotizacionModel->getCotizacionesPaginated($offset, $pageSize, $query);
            $total = $cotizacionModel->getCotizacionesCount($query);
            $respuesta = [
                'status' => true,
                'data' => $cotizaciones,
                'pagination' => [
                    'page' => $page,
                    'pageSize' => $pageSize,
                    'total' => $total,
                    'totalPages' => ceil($total / $pageSize)
                ]
            ];
        }
        echo json_encode($respuesta);
        break;

    case 'POST':
        // PDF preview endpoint
        if ($isPreviewRequest) {
            // Con id (vista previa de una cotizacion guardada), el formato de
            // esa fila; sin id, o si ya no existe, el de la empresa.
            $row = isset($body->id) ? cotFila($cotizacionModel, $body->id) : null;
            $nombre = $row !== null ? ($row['formato'] ?? null) : CotizacionFormatos::delTenant();
            $formato = CotizacionFormatos::para($nombre, $cotizacionModel);
            if (!cotFormatoCoincide($body, $formato)) {
                return;
            }
            $resultado = $formato->preview($body, $row);
            if ($resultado[0] === 'success') {
                // Return as base64 JSON (same as open cotizacion)
                header('content-type: application/json; charset=utf-8');
                echo json_encode([
                    'status' => true,
                    'data' => [
                        'filename' => 'Cotizacion_Preview.pdf',
                        'content' => base64_encode($resultado[1]),
                        'mime_type' => 'application/pdf'
                    ]
                ]);
                return;
            }
            $respuesta = cotError($resultado);
            echo json_encode($respuesta);
            return;
        }

        // Standard Create Cotizacion: el formato de la empresa.
        $formato = CotizacionFormatos::para(CotizacionFormatos::delTenant(), $cotizacionModel);
        if (!cotFormatoCoincide($body, $formato)) {
            break;
        }
        $result = $formato->crear($body);
        if ($result[0] === 'success') {
            $respuesta = ['status' => true, 'data' => $result[1]];
            AuditLogger::log([
                'module' => 'cotizaciones', 'action' => 'CREATE',
                'entity_type' => 'cotizacion',
                'entity_id' => is_array($result[1]) ? ($result[1]['id'] ?? null) : null,
                'new_values' => $body, 'description' => 'Cotizacion creada.',
            ]);
        } else {
            $respuesta = cotError($result);
        }
        echo json_encode($respuesta);
        break;

    case 'PUT':
        if (!isset($body->id) || is_null($body->id)) {
            $respuesta = ['status' => false, 'error' => 'No se pudo identificar la cotización que quieres modificar. Ábrela de nuevo desde el listado.'];
            echo json_encode($respuesta);
            break;
        }
        // La fila primero: la valida y la guarda el formato con el que se
        // creo, no el que tenga hoy la empresa. Si ya no existe, Gratex, que
        // responde su "ya no existe" de siempre. Es tambien el old_values de
        // la auditoria.
        $oldCotizacion = cotFila($cotizacionModel, $body->id);
        $formato = CotizacionFormatos::para($oldCotizacion['formato'] ?? null, $cotizacionModel);
        if (!cotFormatoCoincide($body, $formato)) {
            break;
        }
        $result = $formato->actualizar($oldCotizacion ?? [], $body);
        if ($result[0] === 'success') {
            $respuesta = ['status' => true, 'data' => $result[1]];
            AuditLogger::log([
                'module' => 'cotizaciones', 'action' => 'UPDATE',
                'entity_type' => 'cotizacion', 'entity_id' => $body->id,
                'old_values' => $oldCotizacion, 'new_values' => $body,
                'description' => 'Cotizacion actualizada.',
            ]);
        } else {
            $respuesta = cotError($result);
        }
        echo json_encode($respuesta);
        break;

    case 'DELETE':
        if (!isset($body->id) || is_null($body->id)) {
            $respuesta = ['status' => false, 'error' => 'No se pudo identificar la cotización que quieres eliminar. Actualiza el listado e inténtalo de nuevo.'];
        } else {
            $oldCotizacion = $cotizacionModel->getCotizaciones($body->id)[0] ?? null;
            $result = $cotizacionModel->deleteCotizacion($body->id);
            if ($result[0] === 'success') {
                $respuesta = ['status' => true, 'data' => $result[1]];
                AuditLogger::log([
                    'module' => 'cotizaciones', 'action' => 'DELETE',
                    'entity_type' => 'cotizacion', 'entity_id' => $body->id,
                    'old_values' => $oldCotizacion, 'description' => 'Cotizacion eliminada.',
                ]);
            } else {
                $respuesta = ['status' => false, 'error' => $result[1]];
            }
        }
        echo json_encode($respuesta);
        break;
}
```

- [ ] **Step 10: Lint, run the harness and the equivalence again: everything passes**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Controllers/cotizacionController.php
php tools/test_cotizacion_ferreteria.php | tail -1; echo "exit=${PIPESTATUS[0]}"
timeout 300 bash /tmp/equivalencia_t06.sh; echo "exit=$?"
```

Expected:
- `No syntax errors detected in src/Controllers/cotizacionController.php`.
- The harness still ends with `(N+23)/(N+23) OK` and `exit=0`.
- The equivalence prints exactly this, then `exit=0`:

```text
== Gratex: viejo y nuevo responden lo mismo ==
  [IGUAL] GET lista paginada
  [IGUAL] GET ?id=7
  [IGUAL] GET /7/pdf?format=base64
  [IGUAL] GET /7/pdf (descarga)
  [IGUAL] GET /404/pdf -> 404
  [IGUAL] POST crear
  [IGUAL] POST crear con sent_email true
  [IGUAL] POST sin client_id
  [IGUAL] POST items vacio
  [IGUAL] POST total invalido
  [IGUAL] POST linea sin descripcion -> 422
  [IGUAL] POST cantidad 0.001 -> 422
  [IGUAL] POST error del modelo (200)
  [IGUAL] POST sin cuerpo
  [IGUAL] POST JSON invalido
  [IGUAL] POST cuerpo que es un arreglo
  [IGUAL] POST formato "gratex" explicito
  [IGUAL] preview
  [IGUAL] preview sin total
  [IGUAL] preview items vacio (pasa, como antes)
  [IGUAL] preview linea mala (pasa, como antes)
  [IGUAL] preview con id 7
  [IGUAL] PUT sin id
  [IGUAL] PUT id 7
  [IGUAL] PUT id "7" (string)
  [IGUAL] PUT id que ya no existe
  [IGUAL] PUT id 0
  [IGUAL] PUT sin client_id
  [IGUAL] PUT linea mala -> 422
  [IGUAL] DELETE id 7
  [IGUAL] DELETE sin id
  [IGUAL] DELETE id que ya no existe
  [IGUAL] tenant con formato desconocido: Gratex
== Solo el nuevo: guardia de formato (409, sin escribir nada) ==
  [OK    ] POST cuerpo ferreteria en tenant gratex -> 409
  [OK    ] PUT cuerpo ferreteria sobre fila gratex -> 409
  [OK    ] preview cuerpo ferreteria en tenant gratex -> 409
  [OK    ] PUT fila que ya no existe + cuerpo ferreteria -> 409
== error_log del nuevo ==
  [cotizaciones] tenants.cotizacion_formato = "Ferreteria" no es un formato conocido: se usa gratex
  [cotizaciones] el cuerpo dice formato "ferreteria" y toca "gratex": 409
  [cotizaciones] el cuerpo dice formato "ferreteria" y toca "gratex": 409
  [cotizaciones] el cuerpo dice formato "ferreteria" y toca "gratex": 409
  [cotizaciones] el cuerpo dice formato "ferreteria" y toca "gratex": 409
== avisos de PHP (tiene que salir vacio) ==

37 iguales/OK, 0 distintos/fallas
```

A `[DISTINTO]` prints the diff of the two envelopes under it. Fix the new code, not the case: each case is a request
`CotizacionFormView` or a stale tab can send.

- [ ] **Step 11: Gratex regression check A (manual): the branches moved verbatim**

This side-by-side diff takes each old branch from the pinned blob, applies only the mechanical substitutions from the
notes, and compares it with the `GratexFormato` method. It is read-only and cleans up after itself:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
NUEVO=${NUEVO:-.}
T=$(mktemp -d)
cat > "$T/norm.sed" <<'EOF'
# Lo unico que cambia al mover el codigo: de donde salen el cuerpo y el modelo,
# $respuesta pasa a ser el return del formato, y las rutas relativas.
s/\$_POST/$body/g
s/\$_PUT/$body/g
s/\$cotizacionModel->/$this->modelo->/g
s/\$cotizacionData/$cotizacion/g
s/\$respuesta = \['status' => false, 'error' => \(.*\)\];$/return ['error', \1, 200];/
s/\$respuesta = \['status' => true, 'data' => \$result\[1\]\];$/return ['success', $result[1]];/
s#/\.\./Models/#/../../Models/#
s#/\.\./Utils/CotizacionPdfGenerator\.php#/../CotizacionPdfGenerator.php#
EOF
viejo() { git cat-file -p 094e70ea22881b72c6b6135455665536b6dd71c4 | tr -d '\r' | sed -n "$1" | sed -f "$T/norm.sed" | sed "$2"; }
nuevo() { tr -d '\r' < "$NUEVO/src/Utils/Cotizacion/GratexFormato.php" | sed -n "$1"; }
echo "=== crear: controller 094e70e:190-219 vs GratexFormato:47-69 ==="
diff <(viejo 190,219p 's/^//') <(nuevo 47,69p)
echo "=== actualizar: controller 094e70e:227-256 vs GratexFormato:78-99 ==="
diff <(viejo 227,256p '1s/^        } else if/        if/') <(nuevo 78,99p)
echo "=== preview: controller 094e70e:138-185 vs GratexFormato:109-144 ==="
diff <(viejo 138,185p 's/^    //') <(nuevo 109,144p)
echo "=== pdf: controller 094e70e:79-84 vs GratexFormato:149-155 ==="
diff <(viejo 79,84p 's/^    //') <(nuevo 149,155p)
rm -rf "$T"
```

Expected output, exactly. The only differences left are the return values, and what stayed in the controller: the
CREATE/UPDATE audit, the `$oldCotizacion` read and the preview's JSON envelope.

```text
=== crear: controller 094e70e:190-219 vs GratexFormato:47-69 ===
11,12c11
<                 http_response_code(422);
<                 return ['error', $itemError, 200];
---
>                 return ['error', $itemError, 422];
20,25d18
<                     AuditLogger::log([
<                         'module' => 'cotizaciones', 'action' => 'CREATE',
<                         'entity_type' => 'cotizacion',
<                         'entity_id' => is_array($result[1]) ? ($result[1]['id'] ?? null) : null,
<                         'new_values' => $body, 'description' => 'Cotizacion creada.',
<                     ]);
=== actualizar: controller 094e70e:227-256 vs GratexFormato:78-99 ===
10,11c10
<                 http_response_code(422);
<                 return ['error', $itemError, 200];
---
>                 return ['error', $itemError, 422];
16d14
<                 $oldCotizacion = $this->modelo->getCotizaciones($body->id)[0] ?? null;
20,25d17
<                     AuditLogger::log([
<                         'module' => 'cotizaciones', 'action' => 'UPDATE',
<                         'entity_type' => 'cotizacion', 'entity_id' => $body->id,
<                         'old_values' => $oldCotizacion, 'new_values' => $body,
<                         'description' => 'Cotizacion actualizada.',
<                     ]);
=== preview: controller 094e70e:138-185 vs GratexFormato:109-144 ===
35,45c35
<             // Return as base64 JSON (same as open cotizacion)
<             header('content-type: application/json; charset=utf-8');
<             echo json_encode([
<                 'status' => true,
<                 'data' => [
<                     'filename' => 'Cotizacion_Preview.pdf',
<                     'content' => base64_encode($pdfContent),
<                     'mime_type' => 'application/pdf'
<                 ]
<             ]);
<             return;
---
>             return ['success', $pdfContent];
47,48d36
<         echo json_encode($respuesta);
<         return;
=== pdf: controller 094e70e:79-84 vs GratexFormato:149-155 ===
6a7
>         return ['success', $pdfContent];
```

Any other hunk means something besides the listed substitutions changed in the move: fix `GratexFormato.php`, don't
loosen the check. To eyeball a branch side by side without the substitutions, for example the POST create:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
diff -y -W 200 <(git cat-file -p 094e70ea22881b72c6b6135455665536b6dd71c4 | tr -d '\r' | sed -n 189,219p) \
  <(tr -d '\r' < src/Utils/Cotizacion/GratexFormato.php | sed -n 45,70p) | less -S
```

- [ ] **Step 12: Gratex regression check B (manual): the controller kept its envelope and its audit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
viejoN() { git cat-file -p 094e70ea22881b72c6b6135455665536b6dd71c4 | tr -d '\r' | sed 's/\$_POST/$body/g; s/\$_PUT/$body/g; s/\$_DELETE/$body/g'; }
nuevoC() { tr -d '\r' < src/Controllers/cotizacionController.php; }
D=$(mktemp); diff -w <(viejoN) <(nuevoC) > "$D"
echo "quitadas: $(grep -c '^<' "$D")  agregadas: $(grep -c '^>' "$D")"
echo "de auditoria entre las quitadas: $(grep '^<' "$D" | grep -cE "AuditLogger|'module' =>|'old_values' =>|'new_values' =>|Cotizacion (creada|actualizada|eliminada)")"
rm -f "$D"
git diff -U0 HEAD -- src/Controllers/cotizacionController.php | grep -o '^@@ [^@]* @@' | tr '\n' ' '; echo
git diff --stat HEAD -- src/Controllers/cotizacionController.php | tail -1
git diff --quiet HEAD -- src/Utils/CotizacionPdfGenerator.php src/Models/cotizacionModel.php src/Router.php src/PermissionGate.php src/Middleware \
  && echo "intactos: CotizacionPdfGenerator, cotizacionModel, Router, PermissionGate, Middleware"
```

Expected:
- `quitadas: 86  agregadas: 98`. Whitespace is ignored, so the audit blocks, which only lost indentation, count as kept.
- `de auditoria entre las quitadas: 0`: all three `AuditLogger::log` calls survive with the same fields.
- The hunks, all inside the ranges listed under **Files** (none touches `cotValidarItems` at `:13-43`, the
  download/base64 output at `:85-104` or the list at `:106-132`):
  `@@ -8,0 +9 @@ @@ -48,0 +50,46 @@ @@ -62,0 +110,8 @@ @@ -79,6 +134,10 @@ @@ -137,35 +196,10 @@ @@ -178 +212 @@ @@ -183,0 +218 @@ @@ -188,8 +223,14 @@ @@ -197,22 +238 @@ @@ -224,2 +244 @@ @@ -227,6 +246,21 @@ @@ -234,22 +268 @@ @@ -261,2 +274 @@ @@ -265,2 +277,2 @@ @@ -271 +283 @@`
- `1 file changed, 119 insertions(+), 107 deletions(-)`.
- `intactos: CotizacionPdfGenerator, cotizacionModel, Router, PermissionGate, Middleware`.

- [ ] **Step 13: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
rm -f /tmp/equivalencia_t06.sh /tmp/equivalencia_t06.out
git add src/Utils/Cotizacion/CotizacionFormato.php src/Utils/Cotizacion/CotizacionFormatos.php src/Utils/Cotizacion/GratexFormato.php src/Controllers/cotizacionController.php tools/test_cotizacion_ferreteria.php
git diff --cached --stat | tail -1
git commit -F - <<'EOF'
feat(cotizaciones): formatos de cotizacion por tenant; Gratex movido tal cual a GratexFormato

El controller ya no tiene reglas de Gratex: decodifica el cuerpo una vez, elige
el formato (POST y vista previa sin id: el del tenant; PUT, vista previa con id
y PDF: el de la fila, NULL = gratex), lo llama y envuelve la respuesta y la
auditoria igual que antes. GratexFormato trae las ramas POST, preview, PUT y PDF
tal cual: mismos mensajes, codigos HTTP y llamadas al modelo.

Si el cuerpo dice otro formato que el elegido responde 409 sin guardar nada: una
pestana o un bundle viejo no puede guardar precios con ITBIS incluido con las
reglas de otro formato. CotizacionFormatos solo conoce 'gratex'; Ferreteria se
registra con una linea.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git status --short -- src tools/test_cotizacion_ferreteria.php
```

Expected: `5 files changed, 534 insertions(+), 107 deletions(-)` (the controller 119/107, the three new files 65 + 157
+ 82, the harness 111 with its blank line), one new commit on `feat/cotizacion-formatos`, and no `git status` line for
these paths.

- [ ] **Step 14: Manual server checks (no local DB): hand these to Task 8's `tests/test_cotizaciones_ferreteria.http`**

These need a real tenant DB, so they run by hand on the server after deploying, as a Gratex user, and are recorded as
requests in `tests/test_cotizaciones_ferreteria.http` (Task 8):
1. `GET /api/cotizaciones?page=1`, `GET /api/cotizaciones?id=<x>` and `GET /api/cotizaciones/<x>/pdf?format=base64`
   answer as before the deploy (the PDF is the same Gratex PDF; compare after stripping `/CreationDate`).
2. `POST /api/cotizaciones` with the exact body `CotizacionFormView` sends (no `formato`) → `{status:true,
   data:{id, code, message:"Cotization saved"}}`. The same body without `client_id` → HTTP 200,
   `{status:false, error:"Elige un cliente para la cotización."}`.
3. `PUT /api/cotizaciones` on that row → `{status:true, data:"Cotization updated"}`; one with an empty `description`
   → HTTP 422 `La línea 1 no tiene descripción. Escríbela o quita esa línea.`.
4. `POST /api/cotizaciones/preview` (no `id`) → `{status:true, data:{filename:"Cotizacion_Preview.pdf", ...}}`.
5. The guard: the body of 2 plus `"formato":"ferreteria"` → **HTTP 409** with the message above; the list's total
   doesn't change; the server `error_log` gets
   `[cotizaciones] el cuerpo dice formato "ferreteria" y toca "gratex": 409`. Same for `PUT` on a Gratex row.
6. `DELETE` the quote created in 2 → `{status:true, data:"Cotization deleted"}`, and the audit log shows the CREATE,
   UPDATE and DELETE rows with the same fields as before.

Task 7's section of the harness, which goes after this one, adds the Ferretería registry checks this task leaves out:
`existe('ferreteria')`; `get_class(CotizacionFormatos::para('ferreteria', $modeloSinDb)) === 'FerreteriaFormato'` with
`nombre() === 'ferreteria'` and `permiteCorreo() === false`; `$firmasDe('FerreteriaFormato') === $contratoFormato`;
and `$conTenant(['id' => 5, 'cotizacion_formato' => 'ferreteria']) === 'ferreteria'`, followed by
`$tenantResuelto->setValue(null, null);`.

---

## Part E: Tasks 7, 7b and 8

<!-- Group E: Task 7 and Task 8 (backend, api-gratex). Every code block in Task 7 was run on PHP 8.5.8 before it went into
     this plan, on a scratchpad copy of api-gratex rebuilt from plans A (T1/T4, byte-identical: FerreteriaFormato.php md5
     85cea675342560be5e40828f3244acf6), C (T5) and D (T6, final): each round fails and passes exactly as quoted below. crear/actualizar/preview/pdf were also smoke-run end to end (stubbed unit/emisor models, fake PDO) and the
     resulting PDF read back. Every .http body below parses as JSON, and every relative link in the docs resolves. -->

### Notes for Tasks 7 and 8 (read before starting)

- **Repo and shell.** Every command runs in **Git Bash** (the Bash tool) from `C:/Users/Signos/Documents/edwin/api-gratex`,
  on branch `feat/cotizacion-formatos`. Code blocks start at column 0; copy them exactly.
- **Line endings.** The working-tree files in this repo are **CRLF** (`core.autocrlf=true`). Make every change with the
  Edit tool, which matches and keeps CRLF; never rewrite a whole existing file. After each edit,
  `git diff --stat` must show only the lines the step adds or removes (the numbers are quoted in the steps), never the
  whole file.
- **What T7 builds on** (all must be committed first; the Step 1 preflight checks them):
  - T2: the 026 names used in SQL here: `cotizaciones.formato`, `numero` (`uk_cotizaciones_numero`), `subtotal`, `itbis`,
    `user_id`, `updated_at`; `cotizacion_items.product_id` (`cotizacion_items_product_fk`), `unidad_medida`,
    `indicador_facturacion`, `indicador_bien_servicio`, `itbis_amount`; `cotizacion_ajustes (cotizacion_id, concepto, monto)`.
  - T4: `src/Utils/Cotizacion/FerreteriaFormato.php`, 417 lines, **no** `extends`, no constructor (plan A, note "The class in
    Task 4 deliberately has no extends"). Its private names `ETIQUETAS_AJUSTE`, `MESES`, `normalizarLinea`,
    `normalizarAjustes`, `normalizarFecha`, `leerNumero`, `leerEntero` are not redeclared here.
  - T5: `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php` (it already `require_once`s `FerreteriaFormato.php`; the cycle is
    fine, neither file uses the other at load time).
  - T6: `CotizacionFormato` (abstract, no constructor, no properties), `CotizacionFormatos` with
    `private const FORMATOS = [ 'gratex' => GratexFormato::class, ];` at `:31-33` and `para()` that does
    `require_once __DIR__ . '/' . $clase . '.php'; return new $clase($modelo);`, `GratexFormato`, and the controller whose
    `cotError()` applies the `$http` of `['error', $msg, $http]` (unless it's 200). T6's PUT reads the row first and a
    missing row resolves to Gratex, so a Ferretería body on a deleted row gets the 409 guard; `FerreteriaFormato`'s own 404
    is only the race where the row vanishes between that read and the save.
  - T6's harness section leaves `$modeloSinDb`, `$firmasDe`, `$contratoFormato`, `$conTenant` and `$tenantResuelto`
    defined; round C uses them for the registry checks T6 hands to this task (plan D, Step 14).
- **The harness** (`tools/test_cotizacion_ferreteria.php`, created by T1): `$chk(string $desc, bool $ok)` and `$casos`
  (fixture `id => caso`) are in scope. T7 adds three sections, each pasted **immediately above Task 1's 3-line marker
  block** (`// ---…---` / `// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.` / `// ---…---`; with
  the Edit tool: `old_string` = those 3 lines, `new_string` = the section, one blank line, the same 3 lines), so they land
  after T5's and T6's sections, in order A, B, C. The marker, the summary
  `printf("\n%d/%d OK\n", $total - $fallos, $total);` and the `exit` stay last. Every T7 name ends in `T7` where it
  could collide.
- **No database, ever, in the CLI.** T7's sections build `cotizacionModel` with
  `ReflectionClass::newInstanceWithoutConstructor()` and put a fake connection (`ConexionFalsaT7`) in its private untyped
  `$conexion`. They never construct `Database`, `MasterDatabase`, `unidadMedidaModel` or `EmisorConfigModel`, and never
  call `FerreteriaFormato::crear/actualizar/preview/pdf` (those read the master unit catalog and `emisor_config`). Those four
  are checked on a server with Task 8's `tests/test_cotizaciones_ferreteria.http`.
- **Counts.** The totals printed by the harness depend on how many checks T5 and T6 ended up with. The steps therefore quote
  the T7 lines exactly and say by how much the total grows: round A **+13**, round B **+25**, round C **+35** (73 in all).
  With T1 + T4 (244), T5 (38) and T6 (23) as planned, `N` is 305 and the end is `378/378 OK`.
- **Fatal-error prefix.** A fatal error may print as `Fatal error:` or `PHP Fatal error:` depending on
  `display_errors`/`log_errors`; the path after `in` is the local one. `exit=255` either way.

---

### Task 7: `cotizacionModel` read paths and numbered saves + `FerreteriaFormato` instance methods + registration

**Files:**
- Modify: `src/Models/cotizacionModel.php` (405 lines today → 777; `git diff --stat`: 374 insertions, 2 deletions)
  - `:53-57` `getCotizaciones` loop: add `ajustes`.
  - `:85` `getCotizacionesPaginated` SQL: `ORDER BY c.date DESC, c.id DESC`.
  - `:96-104` `getCotizacionesPaginated` loop (anchored on the `getCotizacionesCount` signature at `:104`): add `ajustes`.
  - `:346` `getCotizacionItems` SQL: `SELECT * ... ORDER BY id ASC`.
  - Insert two blocks right above `:355-356` (the docblock that opens `sendCotizacionPdfEmail`, "Envia la cotizacion al
    cliente con la identidad del tenant"): the read helpers (round A), then the numbered saves (round B).
  - Not touched: `filaItem`, `saveCotizacion` (`:127-225`), `updateCotizacion` (`:227-312`), `deleteCotizacion`,
    `sendCotizacionPdfEmail` (`:363-405`).
- Modify: `src/Utils/Cotizacion/FerreteriaFormato.php` (T4's 417 lines → 699; 283 insertions, 1 deletion)
  - `:1-3` requires; `:21-22` `final class FerreteriaFormato` + `{`; `:45-48` end of `MESES` up to the `tasa()` docblock
    (+ the property, constructor and `nombre()`); `:218-222` end of `fechaLarga()` up to the `normalizarLinea` docblock
    (+ the contract methods and the pure helpers, before T4's private helpers).
- Modify: `src/Utils/Cotizacion/CotizacionFormatos.php:31-33` — the `FORMATOS` const T6 wrote: one line after `:32`.
- Modify/Test: `tools/test_cotizacion_ferreteria.php` — three sections, each right above Task 1's marker block (which
  stays just before the summary `printf`).

**Interfaces:**
- Consumes (exact):
  - T4 `FerreteriaFormato`: `NOMBRE`, `AJUSTES_MONTO`, `RETENCION`, `totales(array $lineas, array $ajustes): array`,
    `errorAbono(array $totales): ?string`, `validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array`,
    `codigo(int $numero): string`.
  - T5 `new FerreteriaCotizacionPdf(array $cotizacion, array $emisor, array $cliente, ?string $logoPath)` + `render(): string`.
  - T6 `abstract class CotizacionFormato` (`nombre`, `crear`, `actualizar`, `preview`, `pdf`, `permiteCorreo(): bool { return false; }`),
    `CotizacionFormatos::para(?string $nombre, cotizacionModel $modelo)`, `::existe(?string $nombre)`.
  - Existing: `unidadMedidaModel::problemaCantidad(float $cantidad, $unidad, int $maxDecimales): ?string` and `::isValid($code): bool`
    (`src/Models/unidadMedidaModel.php:106-126`, `:172-190`); `EmisorConfigModel::get(): ?array`
    (`src/Models/EmisorConfigModel.php:13-19`); `BrandingResolver::logoPath(): ?string` (`src/Utils/Pdf/BrandingResolver.php:111-147`);
    `RequestContext::userId(): ?int` (`src/RequestContext.php:67-70`); the lock helpers copied from
    `src/Models/facturaModel.php:547-585` (`LOCK_SECUENCIA_SIMPLE`, `tomarLockSecuenciaSimple`, `soltarLockSecuenciaSimple`).
- Produces (contract, exact):
  ```php
  // cotizacionModel
  public function getCliente(int $id): ?array                      // client_name, company_name, razon_social, rnc, email
  public function getProductosInfo(array $ids): array               // [product_id(int) => ['indicador_bien_servicio'=>int]]
  public function getAjustes(int $id): array                        // [concepto => monto(string)]; own try/catch => [] + error_log
  public function crearConFormato(array $cot, array $tot, string $formato, ?int $userId, string $clientName): array
       // ['success', ['id'=>int,'code'=>string,'numero'=>int,'total'=>float]] | ['error', string]
  public function actualizarConFormato(int $id, array $cot, array $tot, ?int $userId, string $clientName): array
       // same success shape; $cot['date'] === null keeps stored date; replaces items and ajustes
  private function siguienteNumero(): int; private function tomarLockSecuencia(): bool; private function soltarLockSecuencia(): void
  // getCotizacionItems => SELECT * ... ORDER BY id ASC. getCotizaciones/getCotizacionesPaginated add
  // 'ajustes' => (object) getAjustes() only when formato is set and !== 'gratex', else (object) [].

  // FerreteriaFormato
  final class FerreteriaFormato extends CotizacionFormato
  public function __construct(cotizacionModel $modelo);
  public function nombre(): string;                                 // 'ferreteria'
  public function crear(object $body): array;                       // ['success', {id, code, numero, total}] | ['error', msg, 422|500]
  public function actualizar(array $row, object $body): array;      // same; 404 if the row vanishes while saving
  public function preview(object $body, ?array $row): array;        // ['success', string $pdfBytes] | ['error', msg, 422|500]
  public function pdf(array $cotizacion): array;                    // ['success', string $pdfBytes] | ['error', msg, 500]
  // permiteCorreo() is inherited: false.
  ```
- Produces (additive, outside the contract — pure, CLI-tested):
  ```php
  public static function aplicarCatalogo(array $cot, ?array $cliente, array $productos): array  // ['ok', $cot, $tot] | ['error', msg, 422]
  public static function nombreCliente(array $cliente): string        // razon_social ?: company_name ?: client_name, trimmed, mb_substr(…, 0, 100)
  public static function lineasDesdeFilas(array $items): array        // [{quantity:float, amount:float, indicador_facturacion:int (?? 1)}]
  public static function ajustesDesdeFilas(array|object $filas): array // the 4 amounts as float (missing = 0.0) + retencion_isr = stored > 0
  public static function itemsPdf(array $items): array                // [{description:string, quantity:float, amount:float}]
  ```
- Behavior other tasks rely on:
  - Model write errors may carry a third element: `['error', msg, 422]` (a product deleted between the check and the
    INSERT, FK 1452) and `['error', msg, 404]` (the row vanished before `actualizarConFormato`). Without it,
    `FerreteriaFormato` answers `500`.
  - `getCliente` and `getProductosInfo` do **not** catch `PDOException`: `FerreteriaFormato` catches it and answers `500`
    "No se pudo revisar la cotización…", so a DB outage is never reported as "client does not exist".
  - `crearConFormato` with `$cot['date'] === null` stores "now" in America/Santo_Domingo (same clock T4's
    `normalizarFecha` uses for a date-only input). `updated_at` of formato rows uses the same clock.
  - Only non-zero ajustes are stored; `retencion_isr` is stored as its amount.

- [ ] **Step 1: Preflight — T2, T4, T5 and T6 are in, and the harness is green**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git branch --show-current
git status --short
wc -l src/Utils/Cotizacion/FerreteriaFormato.php src/Models/cotizacionModel.php
grep -n "^final class FerreteriaFormato" src/Utils/Cotizacion/FerreteriaFormato.php
grep -n "__construct\|\$modelo" src/Utils/Cotizacion/CotizacionFormato.php
grep -n "private const FORMATOS\|'gratex' => GratexFormato::class," src/Utils/Cotizacion/CotizacionFormatos.php
grep -c "uk_cotizaciones_numero\|cotizacion_items_product_fk\|cotizacion_ajustes" db/migrations/026_cotizaciones_formatos.sql
grep -cE '^\$(modeloSinDb|contratoFormato|firmasDe|tenantResuelto|conTenant) = ' tools/test_cotizacion_ferreteria.php
grep -n "existe('ferreteria')" tools/test_cotizacion_ferreteria.php
php tools/test_cotizacion_ferreteria.php > /dev/null; echo "exit=$?"
php tools/test_cotizacion_ferreteria.php | tail -1
```

Expected:
- `feat/cotizacion-formatos`, and no `git status` line for the four files this task edits.
- `417 src/Utils/Cotizacion/FerreteriaFormato.php` and `405 src/Models/cotizacionModel.php`.
- `21:final class FerreteriaFormato` (no `extends` yet).
- The `CotizacionFormato.php` grep prints **nothing** (no constructor and no `$modelo` property to collide with the one
  added here).
- Two lines from the `CotizacionFormatos.php` grep: `private const FORMATOS = [` and `'gratex' => GratexFormato::class,`.
- A count above 0 from the migration grep.
- `5` from the T6-variables grep (`$modeloSinDb`, `$contratoFormato`, `$firmasDe`, `$tenantResuelto`, `$conTenant`).
- The `existe('ferreteria')` grep prints **nothing** (T6 deliberately asserts nothing about Ferretería).
- `exit=0` and a last line `N/N OK`. Write `N` down: the steps below say how much it grows.

If T4, T5 or T6 isn't in, stop: this task depends on all three.

- [ ] **Step 2: Round A test — the model's read paths**

Paste this block right above Task 1's 3-line marker block of `tools/test_cotizacion_ferreteria.php` (the marker stays
just before the summary `printf("\n%d/%d OK\n", $total - $fallos, $total);`), followed by one blank line:

```php
// ===========================================================================
// T7 — cotizacionModel y FerreteriaFormato sin MySQL (Task 7)
// ===========================================================================
// El modelo se crea sin constructor (no conecta) y con una conexion falsa que
// registra cada SQL y contesta lo minimo que el modelo lee: $conexion no tiene
// tipo, asi que basta con los mismos metodos que PDO. Nada de esta seccion
// abre una base de datos ni instancia Database/MasterDatabase: crear(),
// actualizar(), preview() y pdf() de FerreteriaFormato si lo harian, y se
// prueban en el servidor (tests/test_cotizaciones_ferreteria.http).

require_once __DIR__ . '/../src/Models/cotizacionModel.php';
require_once __DIR__ . '/../src/Utils/Cotizacion/CotizacionFormatos.php';

/** Conexion falsa: registra SQL y parametros y contesta lo minimo que lee el modelo. */
final class ConexionFalsaT7
{
    /** @var array<int,array{0:string,1:array}> cada execute(), en orden */
    public array $ejecutados = [];
    /** @var string[] cada SQL preparado o consultado, en orden */
    public array $consultas = [];
    /** Filas de "SELECT c.* ..." (getCotizaciones / getCotizacionesPaginated). */
    public array $cabeceras = [];
    /** Filas de "SELECT * FROM cotizacion_items". */
    public array $lineas = [];
    /** [concepto => monto] de cotizacion_ajustes (lo que da FETCH_KEY_PAIR). */
    public array $ajustes = [];
    /** Fila de "SELECT * FROM clients" (false = no existe). */
    public array|false $cliente = false;
    public int $maxNumero = 6;
    /** Cuantos INSERT de cabecera chocan con uk_cotizaciones_numero antes de pasar. */
    public int $choquesNumero = 0;
    /** Lo que devuelve el SELECT ... FOR UPDATE de actualizarConFormato (false = la borraron). */
    public array|false $filaActual = ['code' => 'COT-000004', 'numero' => 4];
    public bool $lockLibre = true;
    /** true = todo prepare() lanza (DB caida o tabla inexistente). */
    public bool $fallarTodo = false;
    public int $commits = 0;
    public int $rollbacks = 0;
    public int $locksTomados = 0;
    public int $locksSoltados = 0;
    private bool $enTransaccion = false;

    public static function error(int $codigo, string $detalle): PDOException
    {
        $e = new PDOException("SQLSTATE[23000]: {$codigo} {$detalle}");
        $e->errorInfo = ['23000', $codigo, $detalle];
        return $e;
    }

    public function query(string $sql): SentenciaFalsaT7
    {
        $this->consultas[] = $sql;
        if (str_contains($sql, 'GET_LOCK')) {
            $this->locksTomados++;
            return new SentenciaFalsaT7($this, $sql, $this->lockLibre ? 1 : 0);
        }
        if (str_contains($sql, 'RELEASE_LOCK')) {
            $this->locksSoltados++;
            return new SentenciaFalsaT7($this, $sql, 1);
        }
        if (str_contains($sql, 'MAX(numero)')) {
            return new SentenciaFalsaT7($this, $sql, $this->maxNumero + 1);
        }
        return new SentenciaFalsaT7($this, $sql);
    }

    public function prepare(string $sql): SentenciaFalsaT7
    {
        $this->consultas[] = $sql;
        if ($this->fallarTodo) {
            throw self::error(1146, "Table 'tenant.cotizacion_ajustes' doesn't exist");
        }
        return new SentenciaFalsaT7($this, $sql);
    }

    public function beginTransaction(): bool { $this->enTransaccion = true; return true; }
    public function commit(): bool { $this->enTransaccion = false; $this->commits++; return true; }
    public function rollBack(): bool { $this->enTransaccion = false; $this->rollbacks++; return true; }
    public function inTransaction(): bool { return $this->enTransaccion; }
    public function lastInsertId(): string { return '77'; }

    /** Parametros de cada execute() cuyo SQL empieza con $inicio. */
    public function paramsDe(string $inicio): array
    {
        $out = [];
        foreach ($this->ejecutados as [$sql, $params]) {
            if (str_starts_with(ltrim($sql), $inicio)) {
                $out[] = $params;
            }
        }
        return $out;
    }

    /** ¿Algun SQL registrado contiene $texto? */
    public function huboSql(string $texto): bool
    {
        foreach ($this->consultas as $sql) {
            if (str_contains($sql, $texto)) {
                return true;
            }
        }
        return false;
    }
}

final class SentenciaFalsaT7
{
    public function __construct(private ConexionFalsaT7 $c, private string $sql, private mixed $columna = null) {}

    public function bindValue($clave, $valor, $tipo = null): bool { return true; }

    public function execute(?array $params = null): bool
    {
        $this->c->ejecutados[] = [$this->sql, $params ?? []];
        if (str_starts_with(ltrim($this->sql), 'INSERT INTO cotizaciones') && $this->c->choquesNumero > 0) {
            $this->c->choquesNumero--;
            $this->c->maxNumero++; // otra caja grabo ese numero mientras tanto
            throw ConexionFalsaT7::error(1062, "Duplicate entry '" . $this->c->maxNumero . "' for key 'cotizaciones.uk_cotizaciones_numero'");
        }
        return true;
    }

    public function fetchColumn() { return $this->columna; }

    public function fetch()
    {
        if (str_contains($this->sql, 'FOR UPDATE')) {
            return $this->c->filaActual;
        }
        if (str_contains($this->sql, 'FROM clients')) {
            return $this->c->cliente;
        }
        return false;
    }

    public function fetchAll($modo = null): array
    {
        if (str_starts_with($this->sql, 'SELECT c.*')) {
            return $this->c->cabeceras;
        }
        if (str_starts_with($this->sql, 'SELECT * FROM cotizacion_items')) {
            return $this->c->lineas;
        }
        if (str_contains($this->sql, 'FROM cotizacion_ajustes')) {
            return $modo === PDO::FETCH_KEY_PAIR ? $this->c->ajustes : [];
        }
        return [];
    }
}

/** Modelo sin constructor (no conecta) con la conexion falsa puesta. */
$modeloT7 = static function (ConexionFalsaT7 $c): cotizacionModel {
    $m = (new ReflectionClass('cotizacionModel'))->newInstanceWithoutConstructor();
    (new ReflectionProperty('cotizacionModel', 'conexion'))->setValue($m, $c);
    return $m;
};
/** Llama un metodo privado del modelo (PHP >= 8.1 no pide setAccessible). */
$privadoT7 = static fn(?cotizacionModel $m, string $metodo, ...$args) => (new ReflectionMethod('cotizacionModel', $metodo))->invoke($m, ...$args);

// Filas como las devuelve PDO: los DECIMAL como texto con los ceros de la columna.
$comoFilasT7 = static fn(array $lineas): array => array_map(static fn(array $l): array => [
    'id' => 1, 'cotizacion_id' => 1, 'product_id' => null,
    'description' => $l['description'],
    'amount' => number_format((float) $l['amount'], 4, '.', ''),
    'quantity' => number_format((float) $l['quantity'], 3, '.', ''),
    'subtotal' => '0.00', 'unidad_medida' => '43',
    'indicador_facturacion' => (int) $l['indicador_facturacion'],
    'indicador_bien_servicio' => 1, 'itbis_amount' => '0.00',
], $lineas);

// Los error_log del modelo (esperados en estos casos) van a un archivo y no
// ensucian la salida; se restaura al final de este bloque.
$logPrevioT7 = ini_set('error_log', sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'test_cotizacion_ferreteria_t7.log');

echo "\n== T7: lecturas de cotizacionModel ==\n";
$c = new ConexionFalsaT7();
$modeloT7($c)->getCotizacionItems(5);
$sqlItemsT7 = (string) end($c->consultas);
$chk('lineas: SELECT * ... ORDER BY id ASC', $sqlItemsT7 === 'SELECT * FROM cotizacion_items WHERE cotizacion_id = :cotizacion_id ORDER BY id ASC');
$chk('lineas: no nombra columnas de la 026 (sin 026 no vaciaria las lineas)',
    stripos($sqlItemsT7, 'product_id') === false && stripos($sqlItemsT7, 'itbis_amount') === false);

$c = new ConexionFalsaT7();
$c->cabeceras = [
    ['id' => 3, 'code' => 'ABC123', 'formato' => null, 'client_id' => 1, 'total' => '100.00'],
    ['id' => 9, 'code' => 'COT-000004', 'formato' => 'ferreteria', 'numero' => 4, 'client_id' => 15, 'total' => '49394.80'],
];
$c->lineas = $comoFilasT7($casos['pintura']['lineas']);
$c->ajustes = ['abono' => '10000.00', 'retencion_isr' => '2093.00'];
$filasT7 = $modeloT7($c)->getCotizaciones(9);
$jsonT7 = json_decode((string) json_encode($filasT7), true);
$chk('getCotizaciones: fila Gratex con "ajustes": {} (objeto, no [])', str_contains((string) json_encode($filasT7[0]), '"ajustes":{}'));
$chk('getCotizaciones: fila Ferreteria con sus ajustes como objeto',
    ($jsonT7[1]['ajustes'] ?? null) === ['abono' => '10000.00', 'retencion_isr' => '2093.00']
    && str_contains((string) json_encode($filasT7[1]), '"ajustes":{"abono"'));
$idsAjustesT7 = array_column($c->paramsDe('SELECT concepto, monto FROM cotizacion_ajustes'), ':id');
$chk('getCotizaciones: cotizacion_ajustes solo se consulta para la fila Ferreteria', $idsAjustesT7 === [9]);
$chk('getCotizaciones: items de SELECT * (traen las columnas de la 026)', count($filasT7[1]['items']) === 7
    && array_key_exists('indicador_facturacion', $filasT7[1]['items'][0]));

$c = new ConexionFalsaT7();
$c->cabeceras = [['id' => 3, 'code' => 'ABC123', 'client_id' => 1, 'total' => '100.00']];   // base sin la 026: no hay columna formato
$filasT7 = $modeloT7($c)->getCotizacionesPaginated(0, 10);
$chk('listado: empate de fecha ordenado por id', str_contains($c->consultas[0] ?? '', 'ORDER BY c.date DESC, c.id DESC LIMIT'));
$chk('listado: fila sin columna formato (antes de la 026) = {} sin consultar cotizacion_ajustes',
    json_encode($filasT7[0]['ajustes'] ?? null) === '{}' && !$c->huboSql('cotizacion_ajustes'));
$c = new ConexionFalsaT7();
$aj = $privadoT7($modeloT7($c), 'ajustesDeFila', ['id' => 9, 'formato' => 'gratex']);
$chk("ajustesDeFila: formato 'gratex' = {} sin consultar", json_encode($aj) === '{}' && $c->consultas === []);
$c = new ConexionFalsaT7();
$c->fallarTodo = true;
$chk('getAjustes: tabla inexistente => [] sin lanzar', $modeloT7($c)->getAjustes(9) === []);

$c = new ConexionFalsaT7();
$chk('getProductosInfo: sin ids validos => [] sin consultar', $modeloT7($c)->getProductosInfo([null, 0, '', '0']) === [] && $c->consultas === []);
$chk('getCliente: id inexistente => null', $modeloT7($c)->getCliente(123456) === null);
$c->cliente = ['id' => 15, 'email' => 'a@b.do', 'client_name' => 'Juan', 'company_name' => 'HOSPITAL', 'rnc' => '401515131',
    'razon_social' => 'HOSPITAL DOCENTE', 'direccion' => 'X', 'descuento' => '0.00', 'phone_number' => '809'];
$chk('getCliente: las 5 claves del contrato', $modeloT7($c)->getCliente(15) === [
    'client_name' => 'Juan', 'company_name' => 'HOSPITAL', 'razon_social' => 'HOSPITAL DOCENTE', 'rnc' => '401515131', 'email' => 'a@b.do',
]);

ini_set('error_log', (string) $logPrevioT7);
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: every earlier section unchanged, then exactly:

```
== T7: lecturas de cotizacionModel ==
  [FALLA] lineas: SELECT * ... ORDER BY id ASC
  [OK  ] lineas: no nombra columnas de la 026 (sin 026 no vaciaria las lineas)
  [FALLA] getCotizaciones: fila Gratex con "ajustes": {} (objeto, no [])
  [FALLA] getCotizaciones: fila Ferreteria con sus ajustes como objeto
  [FALLA] getCotizaciones: cotizacion_ajustes solo se consulta para la fila Ferreteria
  [FALLA] getCotizaciones: items de SELECT * (traen las columnas de la 026)
  [FALLA] listado: empate de fecha ordenado por id
  [FALLA] listado: fila sin columna formato (antes de la 026) = {} sin consultar cotizacion_ajustes

Fatal error: Uncaught ReflectionException: Method cotizacionModel::ajustesDeFila() does not exist in ...tools\test_cotizacion_ferreteria.php:<line>
```

and `exit=255`.

- [ ] **Step 4: Implement the read paths in `cotizacionModel`**

Re-read `src/Models/cotizacionModel.php` first. Five Edits. The line numbers are the file's before the first Edit (each
Edit adds lines below the previous one, so apply them in this order); every Edit matches on its text.

Edit 1 (`:53-57`, the loop of `getCotizaciones`). old_string:

```php
            // Add concatenated description for each cotizacion
            foreach ($cotizaciones as &$cotizacion) {
                $cotizacion['description'] = $this->getCotizacionItemsDescription($cotizacion['id']);
                $cotizacion['items'] = $this->getCotizacionItems($cotizacion['id']);
            }
```

new_string:

```php
            // Add concatenated description for each cotizacion
            foreach ($cotizaciones as &$cotizacion) {
                $cotizacion['description'] = $this->getCotizacionItemsDescription($cotizacion['id']);
                $cotizacion['items'] = $this->getCotizacionItems($cotizacion['id']);
                $cotizacion['ajustes'] = $this->ajustesDeFila($cotizacion);
            }
```

Edit 2 (`:85`, the SQL of `getCotizacionesPaginated`). old_string:

```php
            $sql = "SELECT c.*, cl.client_name,cl.company_name,cl.rnc FROM cotizaciones c LEFT JOIN clients cl ON c.client_id = cl.id {$whereClause} ORDER BY c.date DESC LIMIT :limit OFFSET :offset";
```

new_string:

```php
            // c.id DESC desempata las cotizaciones con la misma fecha: sin el, el
            // orden entre ellas lo elegia MySQL y podia cambiar de una pagina a otra.
            $sql = "SELECT c.*, cl.client_name,cl.company_name,cl.rnc FROM cotizaciones c LEFT JOIN clients cl ON c.client_id = cl.id {$whereClause} ORDER BY c.date DESC, c.id DESC LIMIT :limit OFFSET :offset";
```

Edit 3 (`:96-104`, the loop of `getCotizacionesPaginated`; the `getCotizacionesCount` line makes it unique). old_string:

```php
                $cotizacion['items'] = $this->getCotizacionItems($cotizacion['id']);
            }
            return $cotizaciones;
        } catch (PDOException $e) {
            return [];
        }
    }

    public function getCotizacionesCount($query = null)
```

new_string:

```php
                $cotizacion['items'] = $this->getCotizacionItems($cotizacion['id']);
                $cotizacion['ajustes'] = $this->ajustesDeFila($cotizacion);
            }
            return $cotizaciones;
        } catch (PDOException $e) {
            return [];
        }
    }

    public function getCotizacionesCount($query = null)
```

Edit 4 (`:346`, the SQL of `getCotizacionItems`). old_string:

```php
            $sql = "SELECT id, description, amount, quantity, subtotal FROM cotizacion_items WHERE cotizacion_id = :cotizacion_id";
```

new_string:

```php
            // SELECT * a proposito, sin nombrar columnas: las de la 026
            // (product_id, unidad_medida, indicadores, itbis_amount) salen cuando
            // existen. Nombrarlas en una base sin la 026 haria fallar la consulta,
            // el catch de abajo devolveria [] y la cotizacion se veria sin lineas;
            // guardarla asi borraria las de verdad. ORDER BY id: el orden en que
            // se escribieron, que es el de la pantalla y el del PDF.
            $sql = "SELECT * FROM cotizacion_items WHERE cotizacion_id = :cotizacion_id ORDER BY id ASC";
```

Edit 5 (`:355-356`, insert the read helpers above `sendCotizacionPdfEmail`). old_string (the two lines that open its
docblock):

```php
    /**
     * Envia la cotizacion al cliente con la identidad del tenant (TenantMail):
```

new_string: the block below, then **one empty line**, then those same two lines unchanged:

```php
    // ------------------------------------------------------------------------
    // Formatos de cotizacion por tenant (src/Utils/Cotizacion/). Lo de abajo lo
    // usa solo un formato con numeracion propia (hoy FerreteriaFormato); Gratex
    // sigue por saveCotizacion/updateCotizacion, que no cambian.
    // ------------------------------------------------------------------------

    /**
     * Ajustes de la fila para la respuesta del GET, siempre como objeto
     * (json_encode de un arreglo vacio daria [] y el front espera {}).
     *
     * Una fila de Gratex (formato NULL o 'gratex') recibe {} SIN consultar: una
     * base sin cotizacion_ajustes (026 sin correr) nunca puede vaciar el
     * listado de Gratex, dar 404 a su PDF ni hacer que el PUT diga "ya no
     * existe".
     */
    private function ajustesDeFila(array $cotizacion): object
    {
        $formato = $cotizacion['formato'] ?? null;
        if ($formato === null || $formato === '' || $formato === 'gratex') {
            return (object) [];
        }
        return (object) $this->getAjustes((int) $cotizacion['id']);
    }

    /**
     * [concepto => monto] de una cotizacion (montos DECIMAL como texto, como
     * llegan de PDO). Su propio try/catch: un fallo aqui deja la cotizacion
     * sin ajustes en la respuesta, nunca sin lineas ni fuera del listado.
     */
    public function getAjustes(int $id): array
    {
        try {
            $stmt = $this->conexion->prepare('SELECT concepto, monto FROM cotizacion_ajustes WHERE cotizacion_id = :id ORDER BY id ASC');
            $stmt->execute([':id' => $id]);
            return $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        } catch (PDOException $e) {
            error_log('[cotizaciones] no se pudieron leer los ajustes de la cotizacion ' . $id . ': ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Datos del cliente que necesita un formato: el nombre que se guarda en
     * client_name y lo que imprime el PDF. null si el id no existe.
     *
     * SELECT * y no una lista: si a una base vieja le faltara una columna, se
     * lee como null en vez de impedir cotizar. Sin try/catch a proposito: un
     * fallo de la DB no puede leerse como "el cliente no existe" (el usuario
     * buscaria un cliente que si esta); quien llama lo atrapa y responde el
     * error generico.
     *
     * @return array{client_name:?string, company_name:?string, razon_social:?string, rnc:?string, email:?string}|null
     */
    public function getCliente(int $id): ?array
    {
        $stmt = $this->conexion->prepare('SELECT * FROM clients WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $fila = $stmt->fetch();
        if (!$fila) {
            return null;
        }
        return [
            'client_name' => $fila['client_name'] ?? null,
            'company_name' => $fila['company_name'] ?? null,
            'razon_social' => $fila['razon_social'] ?? null,
            'rnc' => $fila['rnc'] ?? null,
            'email' => $fila['email'] ?? null,
        ];
    }

    /**
     * [product_id => ['indicador_bien_servicio' => int]] de los productos que
     * existen entre $ids; un id que no sale en el resultado no esta en el
     * catalogo. No filtra por `activo`: una cotizacion con un producto que
     * despues se desactivo se tiene que poder seguir editando (la FK tampoco
     * mira activo). Sin try/catch, por lo mismo que getCliente.
     */
    public function getProductosInfo(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn($id) => $id > 0)));
        if (!$ids) {
            return [];
        }
        $marcas = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->conexion->prepare("SELECT id, indicador_bien_servicio FROM products WHERE id IN ({$marcas})");
        $stmt->execute($ids);
        $mapa = [];
        foreach ($stmt->fetchAll() as $p) {
            $mapa[(int) $p['id']] = ['indicador_bien_servicio' => (int) $p['indicador_bien_servicio']];
        }
        return $mapa;
    }
```

- [ ] **Step 5: Run and watch round A pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Models/cotizacionModel.php && php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: `No syntax errors detected in src/Models/cotizacionModel.php`, the 13 round-A lines all `[OK  ]` (same labels as
Step 3), no `[FALLA]`, a last line `(N+13)/(N+13) OK`, and `exit=0`.

- [ ] **Step 6: Round B test — numbered saves (`crearConFormato` / `actualizarConFormato`)**

Paste this block right above Task 1's marker block (so after round A's block), followed by one blank line:

```php
// --- T7, ronda B: escrituras con formato (crearConFormato / actualizarConFormato) ---
// Los error_log del modelo (esperados en estos casos) van a un archivo y no
// ensucian la salida; se restaura al final de este bloque.
$logPrevioT7 = ini_set('error_log', sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'test_cotizacion_ferreteria_t7.log');

/** 'cot' como lo dejan validarForma + aplicarCatalogo, armado desde un caso del fixture. */
$cotT7 = static fn(array $caso, ?string $fecha): array => [
    'date' => $fecha,
    'client_id' => 15,
    'items' => array_map(static fn(array $l): array => [
        'product_id' => null,
        'description' => $l['description'],
        'quantity' => (float) $l['quantity'],
        'amount' => (float) $l['amount'],
        'unidad_medida' => '43',
        'indicador_facturacion' => (int) $l['indicador_facturacion'],
        'indicador_bien_servicio' => 1,
    ], $caso['lineas']),
    'ajustes' => [
        'cargos_bancarios' => (float) $caso['ajustes']['cargos_bancarios'],
        'manejo_bancario' => (float) $caso['ajustes']['manejo_bancario'],
        'mano_obra' => (float) $caso['ajustes']['mano_obra'],
        'abono' => (float) $caso['ajustes']['abono'],
        'retencion_isr' => (bool) $caso['ajustes']['retencion_isr'],
    ],
];
// Totales como los deja aplicarCatalogo (mismas lineas, mismas reglas).
$totDeT7 = static fn(array $cot): array => FerreteriaFormato::totales(array_map(static fn(array $it): array => [
    'quantity' => $it['quantity'], 'amount' => $it['amount'], 'indicador_facturacion' => $it['indicador_facturacion'],
], $cot['items']), $cot['ajustes']);

echo "\n== T7: crearConFormato / actualizarConFormato (conexion falsa) ==\n";
$cot = $cotT7($casos['pintura_retencion_abono'], '2026-05-14 09:00:00');
$tot = $totDeT7($cot);

$c = new ConexionFalsaT7();
$r = $modeloT7($c)->crearConFormato($cot, $tot, 'ferreteria', 5, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO');
$chk('crear: success con id, code, numero y total', $r === ['success', ['id' => 77, 'code' => 'COT-000007', 'numero' => 7, 'total' => 49394.8]]);
$cab = $c->paramsDe('INSERT INTO cotizaciones')[0] ?? [];
$chk('crear: cabecera con formato, numero, code y client_name', ($cab[':formato'] ?? null) === 'ferreteria' && ($cab[':numero'] ?? null) === 7
    && ($cab[':code'] ?? null) === 'COT-000007' && ($cab[':client_name'] ?? null) === 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO');
$chk('crear: subtotal, itbis y total de totales()', ($cab[':subtotal'] ?? null) === 41860.0 && ($cab[':itbis'] ?? null) === 7534.8
    && ($cab[':total'] ?? null) === 49394.8);
$chk('crear: user_id del parametro y fecha del cuerpo', ($cab[':user_id'] ?? null) === 5 && ($cab[':date'] ?? null) === '2026-05-14 09:00:00');
$lin = $c->paramsDe('INSERT INTO cotizacion_items');
$chk('crear: 7 lineas', count($lin) === 7);
$chk('crear: linea 1 con base e ITBIS de totales()', ($lin[0][':subtotal'] ?? null) === 14000.0 && ($lin[0][':itbis_amount'] ?? null) === 2520.0
    && array_key_exists(':product_id', $lin[0]) && $lin[0][':product_id'] === null
    && ($lin[0][':unidad_medida'] ?? null) === '43' && ($lin[0][':indicador_facturacion'] ?? null) === 1);
$aju = $c->paramsDe('INSERT INTO cotizacion_ajustes');
$chk('crear: solo ajustes no cero (abono y la retencion como monto)', array_column($aju, ':monto', ':concepto') === ['abono' => 10000.0, 'retencion_isr' => 2093.0]);
$chk('crear: 1 commit, 0 rollback, candado tomado y soltado', $c->commits === 1 && $c->rollbacks === 0 && $c->locksTomados === 1 && $c->locksSoltados === 1);

$c = new ConexionFalsaT7();
$cotSinFecha = $cotT7($casos['pintura'], null);
$modeloT7($c)->crearConFormato($cotSinFecha, $totDeT7($cotSinFecha), 'ferreteria', null, 'X');
$cab = $c->paramsDe('INSERT INTO cotizaciones')[0] ?? [];
$chk('crear: sin fecha => ahora (Y-m-d H:i:s)', preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) ($cab[':date'] ?? '')) === 1);
$chk('crear: sin ajustes => ningun INSERT de ajustes', $c->paramsDe('INSERT INTO cotizacion_ajustes') === []);

$c = new ConexionFalsaT7();
$c->choquesNumero = 1;
$r = $modeloT7($c)->crearConFormato($cot, $tot, 'ferreteria', 5, 'X');
$chk('1062 una vez: reintenta en otra transaccion y toma el siguiente numero', ($r[0] ?? '') === 'success'
    && ($r[1]['numero'] ?? null) === 8 && ($r[1]['code'] ?? null) === 'COT-000008');
$chk('1062 una vez: 1 rollback, 1 commit, 2 lecturas del MAX, candado soltado una vez', $c->rollbacks === 1 && $c->commits === 1
    && count(array_filter($c->consultas, static fn(string $s): bool => str_contains($s, 'MAX(numero)'))) === 2 && $c->locksSoltados === 1);

$c = new ConexionFalsaT7();
$c->choquesNumero = 2;
$r = $modeloT7($c)->crearConFormato($cot, $tot, 'ferreteria', 5, 'X');
$chk('1062 dos veces: no hay tercer intento', count($c->paramsDe('INSERT INTO cotizaciones')) === 2);
$chk('1062 dos veces: mensaje claro, sin commit, candado soltado', $r === ['error', 'Otra cotización se guardó al mismo tiempo. Vuelve a guardar.']
    && $c->commits === 0 && $c->rollbacks === 2 && $c->locksSoltados === 1);

$c = new ConexionFalsaT7();
$c->lockLibre = false;
$r = $modeloT7($c)->crearConFormato($cot, $tot, 'ferreteria', 5, 'X');
$chk('candado ocupado: guarda igual y no suelta lo que no tomo', ($r[0] ?? '') === 'success' && $c->locksSoltados === 0);

$fkT7 = ConexionFalsaT7::error(1452, 'Cannot add or update a child row: a foreign key constraint fails (`t`.`cotizacion_items`, CONSTRAINT `cotizacion_items_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL)');
$r = $privadoT7(null, 'errorConFormato', $fkT7, 'GENERICO');
$chk('1452 del producto (lo borraron) => 422 que se entiende, sin reintento', ($r[0] ?? '') === 'error' && ($r[2] ?? null) === 422
    && str_contains($r[1] ?? '', 'ya no existe en el catálogo'));
$chk('otro error => el generico, sin HTTP propio', $privadoT7(null, 'errorConFormato', ConexionFalsaT7::error(1205, 'Lock wait timeout exceeded'), 'GENERICO') === ['error', 'GENERICO']);
$chk('esNumeroRepetido: solo 1062 en uk_cotizaciones_numero',
    $privadoT7(null, 'esNumeroRepetido', ConexionFalsaT7::error(1062, "Duplicate entry '7' for key 'uk_cotizaciones_numero'"))
    && !$privadoT7(null, 'esNumeroRepetido', ConexionFalsaT7::error(1062, "Duplicate entry '1-abono' for key 'uk_cotizacion_ajuste'")));

$c = new ConexionFalsaT7();
$c->filaActual = false;
$r = $modeloT7($c)->actualizarConFormato(4, $cot, $tot, 5, 'X');
$chk('actualizar: fila borrada => 404 y nada escrito', ($r[0] ?? '') === 'error' && ($r[2] ?? null) === 404
    && $c->paramsDe('UPDATE cotizaciones') === [] && $c->rollbacks === 1);

$c = new ConexionFalsaT7();
$r = $modeloT7($c)->actualizarConFormato(4, $cotSinFecha, $totDeT7($cotSinFecha), 5, 'NUEVO NOMBRE');
$chk('actualizar: numero y code de la fila, nunca nuevos', $r === ['success', ['id' => 4, 'code' => 'COT-000004', 'numero' => 4, 'total' => 49394.8]]);
$upd = $c->paramsDe('UPDATE cotizaciones')[0] ?? [];
$chk('actualizar: date null => conserva la guardada (COALESCE)', array_key_exists(':date', $upd) && $upd[':date'] === null
    && $c->huboSql('date = COALESCE(:date, date)'));
$chk('actualizar: client_name nuevo', ($upd[':client_name'] ?? null) === 'NUEVO NOMBRE');
$chk('actualizar: reemplaza lineas y ajustes', count($c->paramsDe('DELETE FROM cotizacion_items')) === 1
    && count($c->paramsDe('DELETE FROM cotizacion_ajustes')) === 1 && count($c->paramsDe('INSERT INTO cotizacion_items')) === 7
    && $c->paramsDe('INSERT INTO cotizacion_ajustes') === []);
$chk('actualizar: no toca la secuencia', $c->locksTomados === 0 && !$c->huboSql('MAX(numero)'));
$chk('actualizar: 1 commit', $c->commits === 1 && $c->rollbacks === 0);

ini_set('error_log', (string) $logPrevioT7);
```

- [ ] **Step 7: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: round A still all `[OK  ]`, then:

```
== T7: crearConFormato / actualizarConFormato (conexion falsa) ==

Fatal error: Uncaught Error: Call to undefined method cotizacionModel::crearConFormato() in ...tools\test_cotizacion_ferreteria.php:<line>
```

and `exit=255`.

- [ ] **Step 8: Implement the numbered saves**

Re-read `src/Models/cotizacionModel.php`. One Edit: the same two-line anchor as Step 4 Edit 5 (it now sits right after
`getProductosInfo()`). old_string:

```php
    /**
     * Envia la cotizacion al cliente con la identidad del tenant (TenantMail):
```

new_string: the block below, then **one empty line**, then those same two lines unchanged:

```php
    /**
     * Crea una cotizacion con numeracion propia: cabecera, lineas y ajustes en
     * una sola transaccion (spec 6.3).
     *
     * El candado con nombre serializa a dos cajas que guardan a la vez, y el
     * MAX+1 se lee DENTRO de la transaccion. Si aun asi el numero choca con
     * uk_cotizaciones_numero (el candado estaba ocupado y se siguio sin el),
     * se deshace y se repite UNA vez en una transaccion nueva, que vuelve a
     * leer el MAX. Cualquier otro error no se reintenta.
     *
     * @param array $cot 'cot' de FerreteriaFormato::validarForma, ya con el catalogo aplicado.
     *                   date null = ahora.
     * @param array $tot FerreteriaFormato::totales de esas lineas y ajustes
     * @return array ['success', ['id'=>int,'code'=>string,'numero'=>int,'total'=>float]]
     *             | ['error', string] | ['error', string, int $http]
     */
    public function crearConFormato(array $cot, array $tot, string $formato, ?int $userId, string $clientName): array
    {
        // El codigo visible (COT-000123) lo define FerreteriaFormato::codigo,
        // el que prueba el CLI. Se carga aqui y no arriba: Gratex no lo usa.
        require_once __DIR__ . '/../Utils/Cotizacion/FerreteriaFormato.php';
        $fecha = $cot['date'] ?? self::ahoraRd();
        $lock = $this->tomarLockSecuencia();
        try {
            $intento = 0;
            while (true) {
                $intento++;
                $numero = null;
                try {
                    $this->conexion->beginTransaction();
                    $numero = $this->siguienteNumero();
                    $code = FerreteriaFormato::codigo($numero);
                    $stmt = $this->conexion->prepare(
                        'INSERT INTO cotizaciones
                            (formato, numero, code, date, client_id, client_name, subtotal, itbis, total, user_id)
                         VALUES
                            (:formato, :numero, :code, :date, :client_id, :client_name, :subtotal, :itbis, :total, :user_id)'
                    );
                    $stmt->execute([
                        ':formato' => $formato,
                        ':numero' => $numero,
                        ':code' => $code,
                        ':date' => $fecha,
                        ':client_id' => (int) $cot['client_id'],
                        ':client_name' => $clientName,
                        ':subtotal' => $tot['subtotal'],
                        ':itbis' => $tot['itbis'],
                        ':total' => $tot['total'],
                        ':user_id' => $userId,
                    ]);
                    $id = (int) $this->conexion->lastInsertId();
                    $this->insertarDetalle($id, $cot, $tot);
                    $this->conexion->commit();
                    return ['success', ['id' => $id, 'code' => $code, 'numero' => $numero, 'total' => (float) $tot['total']]];
                } catch (PDOException $e) {
                    if ($this->conexion->inTransaction()) {
                        $this->conexion->rollBack();
                    }
                    if ($intento === 1 && self::esNumeroRepetido($e)) {
                        error_log('[cotizaciones] el numero ' . $numero . ' ya estaba tomado (uk_cotizaciones_numero): se reintenta una vez');
                        continue;
                    }
                    error_log('[cotizaciones] no se pudo guardar la cotizacion (' . $formato . '): ' . $e->getMessage());
                    return self::errorConFormato($e, 'No se pudo guardar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.');
                }
            }
        } finally {
            // Se suelta pase lo que pase: con el candado puesto, la siguiente
            // cotizacion de esta conexion esperaria los 5 segundos completos.
            if ($lock) {
                $this->soltarLockSecuencia();
            }
        }
    }

    /**
     * Reescribe una cotizacion con numeracion propia: la cabecera, y reemplaza
     * lineas y ajustes (un PUT sin ajustes los deja en ninguno). numero y code
     * no cambian nunca; $cot['date'] null conserva la fecha guardada.
     *
     * @return array mismo formato que crearConFormato; ['error', string, 404] si ya no existe
     */
    public function actualizarConFormato(int $id, array $cot, array $tot, ?int $userId, string $clientName): array
    {
        try {
            $this->conexion->beginTransaction();
            // FOR UPDATE: si otra persona la borra entre la carga del
            // controller y este guardado, se sabe aqui y no se escriben lineas
            // huerfanas. De paso trae numero y code para la respuesta.
            $stmt = $this->conexion->prepare('SELECT code, numero FROM cotizaciones WHERE id = :id FOR UPDATE');
            $stmt->execute([':id' => $id]);
            $actual = $stmt->fetch();
            if (!$actual) {
                $this->conexion->rollBack();
                return ['error', 'Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado.', 404];
            }
            $stmt = $this->conexion->prepare(
                'UPDATE cotizaciones
                    SET client_id = :client_id, client_name = :client_name, date = COALESCE(:date, date),
                        subtotal = :subtotal, itbis = :itbis, total = :total,
                        user_id = :user_id, updated_at = :updated_at
                  WHERE id = :id'
            );
            $stmt->execute([
                ':id' => $id,
                ':client_id' => (int) $cot['client_id'],
                ':client_name' => $clientName,
                ':date' => $cot['date'],
                ':subtotal' => $tot['subtotal'],
                ':itbis' => $tot['itbis'],
                ':total' => $tot['total'],
                ':user_id' => $userId,
                ':updated_at' => self::ahoraRd(),
            ]);
            $this->conexion->prepare('DELETE FROM cotizacion_items WHERE cotizacion_id = :id')->execute([':id' => $id]);
            $this->conexion->prepare('DELETE FROM cotizacion_ajustes WHERE cotizacion_id = :id')->execute([':id' => $id]);
            $this->insertarDetalle($id, $cot, $tot);
            $this->conexion->commit();
            return ['success', [
                'id' => $id,
                'code' => (string) $actual['code'],
                'numero' => (int) $actual['numero'],
                'total' => (float) $tot['total'],
            ]];
        } catch (PDOException $e) {
            if ($this->conexion->inTransaction()) {
                $this->conexion->rollBack();
            }
            error_log('[cotizaciones] no se pudo actualizar la cotizacion ' . $id . ' (con formato): ' . $e->getMessage());
            return self::errorConFormato($e, 'No se pudieron guardar los cambios de la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.');
        }
    }

    /**
     * Lineas (con producto, unidad, indicadores e ITBIS) y ajustes de una
     * cotizacion. Corre dentro de la transaccion de quien llama. subtotal e
     * itbis_amount de cada linea son los de totales(): lo guardado y lo
     * impreso salen de la misma cuenta. El round() de cantidad y precio solo
     * limpia el ruido binario: validarForma ya rechazo lo que tuviera mas
     * decimales, asi que no cambia ningun valor (en 8.3 ni en 8.5).
     */
    private function insertarDetalle(int $cotizacionId, array $cot, array $tot): void
    {
        $stmt = $this->conexion->prepare(
            'INSERT INTO cotizacion_items
                (cotizacion_id, product_id, description, amount, quantity, subtotal,
                 unidad_medida, indicador_facturacion, indicador_bien_servicio, itbis_amount)
             VALUES
                (:cotizacion_id, :product_id, :description, :amount, :quantity, :subtotal,
                 :unidad_medida, :indicador_facturacion, :indicador_bien_servicio, :itbis_amount)'
        );
        foreach (array_values($cot['items']) as $i => $item) {
            $stmt->execute([
                ':cotizacion_id' => $cotizacionId,
                ':product_id' => !empty($item['product_id']) ? (int) $item['product_id'] : null,
                ':description' => (string) $item['description'],
                ':amount' => round((float) $item['amount'], 4),
                ':quantity' => round((float) $item['quantity'], 2),
                ':subtotal' => $tot['lineas'][$i]['base'],
                ':unidad_medida' => (string) $item['unidad_medida'],
                ':indicador_facturacion' => (int) $item['indicador_facturacion'],
                ':indicador_bien_servicio' => (int) $item['indicador_bien_servicio'],
                ':itbis_amount' => $tot['lineas'][$i]['itbis'],
            ]);
        }
        $ajustes = self::ajustesAGuardar($cot, $tot);
        if (!$ajustes) {
            return;
        }
        $stmt = $this->conexion->prepare('INSERT INTO cotizacion_ajustes (cotizacion_id, concepto, monto) VALUES (:cotizacion_id, :concepto, :monto)');
        foreach ($ajustes as $concepto => $monto) {
            $stmt->execute([':cotizacion_id' => $cotizacionId, ':concepto' => $concepto, ':monto' => $monto]);
        }
    }

    /**
     * [concepto => monto] que se guardan: cada concepto que el formato
     * declaro en $cot['ajustes'], con el monto que calculo totales() bajo la
     * misma clave (redondeado; para retencion_isr, el monto de la retencion y
     * no la casilla). Solo los que no son cero (spec 6.1 D).
     */
    private static function ajustesAGuardar(array $cot, array $tot): array
    {
        $out = [];
        foreach (array_keys($cot['ajustes']) as $concepto) {
            $monto = (float) ($tot[$concepto] ?? 0);
            if ($monto > 0) {
                $out[$concepto] = $monto;
            }
        }
        return $out;
    }

    /** Siguiente numero de la secuencia. No bloquea nada: lo serializa el candado de quien llama. */
    private function siguienteNumero(): int
    {
        return (int) $this->conexion->query('SELECT COALESCE(MAX(numero), 0) + 1 FROM cotizaciones')->fetchColumn();
    }

    /** ¿El error es el numero repetido (uk_cotizaciones_numero)? Es el unico que se reintenta. */
    private static function esNumeroRepetido(PDOException $e): bool
    {
        return (int) ($e->errorInfo[1] ?? 0) === 1062
            && stripos((string) ($e->errorInfo[2] ?? $e->getMessage()), 'uk_cotizaciones_numero') !== false;
    }

    /**
     * Mensaje para el usuario de un fallo al guardar con formato. El detalle
     * tecnico ya fue al log; aqui solo se distingue lo que el usuario puede
     * arreglar. El tercer elemento, cuando esta, es el HTTP (si falta, 500).
     */
    private static function errorConFormato(PDOException $e, string $generico): array
    {
        $codigo = (int) ($e->errorInfo[1] ?? 0);
        $detalle = (string) ($e->errorInfo[2] ?? $e->getMessage());
        // 1452 en la FK del producto: lo borraron del catalogo entre la
        // revision (getProductosInfo) y el INSERT.
        if ($codigo === 1452 && stripos($detalle, 'cotizacion_items_product_fk') !== false) {
            return ['error', 'Un producto de la cotización ya no existe en el catálogo (lo eliminaron mientras la editabas). Búscalo de nuevo o quita la línea.', 422];
        }
        // Segundo choque seguido con el numero: dos cajas guardando a la vez.
        if (self::esNumeroRepetido($e)) {
            return ['error', 'Otra cotización se guardó al mismo tiempo. Vuelve a guardar.'];
        }
        return ['error', $generico];
    }

    /** Nombre del candado, por base de datos: un tenant no serializa a otro. */
    private const LOCK_SECUENCIA = "CONCAT(DATABASE(), ':cotizacion_seq')";

    /**
     * Copia de facturaModel::tomarLockSecuenciaSimple (alli es privado): lock
     * de MySQL a nivel de CONEXION, no de tabla. Espera hasta 5 segundos; si no
     * lo consigue NO aborta: se numera sin serializar y el indice unico mas el
     * reintento cubren el choque.
     *
     * @return bool true si hay que soltarlo despues.
     */
    private function tomarLockSecuencia(): bool
    {
        try {
            $stmt = $this->conexion->query('SELECT GET_LOCK(' . self::LOCK_SECUENCIA . ', 5)');
            // 1 = tomado; 0 = expiro la espera; NULL = error del servidor.
            if ((int) $stmt->fetchColumn() === 1) {
                return true;
            }
            error_log('[cotizaciones] lock de numeracion ocupado: se numera sin serializar');
            return false;
        } catch (PDOException $e) {
            error_log('[cotizaciones] no se pudo tomar el lock de numeracion: ' . $e->getMessage());
            return false;
        }
    }

    private function soltarLockSecuencia(): void
    {
        try {
            $this->conexion->query('SELECT RELEASE_LOCK(' . self::LOCK_SECUENCIA . ')');
        } catch (PDOException $e) {
            error_log('[cotizaciones] no se pudo soltar el lock de numeracion: ' . $e->getMessage());
        }
    }

    /** Ahora en Santo Domingo, como lo guarda un DATETIME (el server puede estar en otra zona). */
    private static function ahoraRd(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo')))->format('Y-m-d H:i:s');
    }
```

- [ ] **Step 9: Run and watch round B pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Models/cotizacionModel.php && php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
php tools/test_cotizacion_ferreteria.php | sed -n '/== T7: crearConFormato/,/== /p'
```

Expected: no `[FALLA]`, `(N+38)/(N+38) OK`, `exit=0`, and the round-B lines:

```
== T7: crearConFormato / actualizarConFormato (conexion falsa) ==
  [OK  ] crear: success con id, code, numero y total
  [OK  ] crear: cabecera con formato, numero, code y client_name
  [OK  ] crear: subtotal, itbis y total de totales()
  [OK  ] crear: user_id del parametro y fecha del cuerpo
  [OK  ] crear: 7 lineas
  [OK  ] crear: linea 1 con base e ITBIS de totales()
  [OK  ] crear: solo ajustes no cero (abono y la retencion como monto)
  [OK  ] crear: 1 commit, 0 rollback, candado tomado y soltado
  [OK  ] crear: sin fecha => ahora (Y-m-d H:i:s)
  [OK  ] crear: sin ajustes => ningun INSERT de ajustes
  [OK  ] 1062 una vez: reintenta en otra transaccion y toma el siguiente numero
  [OK  ] 1062 una vez: 1 rollback, 1 commit, 2 lecturas del MAX, candado soltado una vez
  [OK  ] 1062 dos veces: no hay tercer intento
  [OK  ] 1062 dos veces: mensaje claro, sin commit, candado soltado
  [OK  ] candado ocupado: guarda igual y no suelta lo que no tomo
  [OK  ] 1452 del producto (lo borraron) => 422 que se entiende, sin reintento
  [OK  ] otro error => el generico, sin HTTP propio
  [OK  ] esNumeroRepetido: solo 1062 en uk_cotizaciones_numero
  [OK  ] actualizar: fila borrada => 404 y nada escrito
  [OK  ] actualizar: numero y code de la fila, nunca nuevos
  [OK  ] actualizar: date null => conserva la guardada (COALESCE)
  [OK  ] actualizar: client_name nuevo
  [OK  ] actualizar: reemplaza lineas y ajustes
  [OK  ] actualizar: no toca la secuencia
  [OK  ] actualizar: 1 commit
```

The model's own `error_log` lines for these cases go to `%TEMP%/test_cotizacion_ferreteria_t7.log`, not to the console.

- [ ] **Step 10: Check that Gratex's legacy code is untouched, then commit the model**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git diff --stat -- src/Models/cotizacionModel.php
git diff -U0 -- src/Models/cotizacionModel.php | grep '^-' | grep -v '^---'
```

Expected: `1 file changed, 374 insertions(+), 2 deletions(-)`, and exactly two removed lines: the old
`ORDER BY c.date DESC LIMIT` SQL and the old `SELECT id, description, amount, quantity, subtotal FROM cotizacion_items` SQL.
Nothing inside `saveCotizacion`, `updateCotizacion` or `sendCotizacionPdfEmail` changed.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add src/Models/cotizacionModel.php tools/test_cotizacion_ferreteria.php
git commit -F - <<'EOF'
feat(cotizaciones): lecturas seguras y guardado con numeracion propia en cotizacionModel

- getCotizacionItems con SELECT * ... ORDER BY id: las columnas de la 026 salen
  cuando existen, sin nombrarlas (una base sin la 026 no vacia las lineas).
- ajustes siempre como objeto en el GET; solo se consultan para filas con un
  formato distinto de gratex, asi Gratex no depende de cotizacion_ajustes.
- Listado ordenado por date DESC, id DESC.
- crearConFormato / actualizarConFormato: cabecera, lineas y ajustes en una
  transaccion; numero = MAX + 1 bajo GET_LOCK, con un reintento en una
  transaccion nueva si choca con uk_cotizaciones_numero. getCliente y
  getProductosInfo para el formato de Ferreteria.
- El CLI lo prueba con una conexion falsa, sin MySQL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit with 2 files.

- [ ] **Step 11: Round C test — `FerreteriaFormato`'s pure pieces and its registration**

Paste this block right above Task 1's marker block (so after round B's block), followed by one blank line:

```php
// --- T7, ronda C: FerreteriaFormato (piezas puras) y su registro ---
echo "\n== T7: pdf() reconstruye los totales desde lo guardado ==\n";
$lineasT7 = FerreteriaFormato::lineasDesdeFilas($comoFilasT7($casos['pintura']['lineas']));
$chk('lineasDesdeFilas: 7 lineas como numeros', count($lineasT7) === 7
    && $lineasT7[0] === ['quantity' => 7.0, 'amount' => 2000.0, 'indicador_facturacion' => 1]);
$t = FerreteriaFormato::totales($lineasT7, FerreteriaFormato::ajustesDesdeFilas([]));
$chk('pintura desde filas: 41,860.00 / 7,534.80 / 49,394.80', $t['subtotal'] === 41860.0 && $t['itbis'] === 7534.8 && $t['total'] === 49394.8);
$viejasT7 = FerreteriaFormato::lineasDesdeFilas([['quantity' => '2.000', 'amount' => '50.0000'],
    (object) ['quantity' => '1.000', 'amount' => '10.0000', 'indicador_facturacion' => null]]);
$chk('fila sin indicador (o NULL) cuenta como 18%', $viejasT7[0]['indicador_facturacion'] === 1 && $viejasT7[1]['indicador_facturacion'] === 1);
$aj = FerreteriaFormato::ajustesDesdeFilas((object) ['abono' => '10000.00', 'retencion_isr' => '2093.00']);
$chk('ajustesDesdeFilas: montos a float y la retencion a casilla', $aj === [
    'cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 0.0, 'abono' => 10000.0, 'retencion_isr' => true,
]);
$chk('ajustesDesdeFilas({}) = todo en cero, sin retencion', FerreteriaFormato::ajustesDesdeFilas((object) []) === [
    'cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 0.0, 'abono' => 0.0, 'retencion_isr' => false,
]);
$chk("ajustesDesdeFilas: retencion '0.00' = casilla apagada", FerreteriaFormato::ajustesDesdeFilas(['retencion_isr' => '0.00'])['retencion_isr'] === false);

// Ida y vuelta por cada caso del fixture: lo que crearConFormato escribe
// (lineas y ajustes), leido de vuelta como texto DECIMAL, da los mismos totales.
foreach ($casos as $idT7 => $casoT7) {
    $cotRt = $cotT7($casoT7, null);
    $totRt = $totDeT7($cotRt);
    $c = new ConexionFalsaT7();
    $modeloT7($c)->crearConFormato($cotRt, $totRt, 'ferreteria', null, 'X');
    $filasRt = array_map(static fn(array $p): array => [
        'description' => $p[':description'],
        'amount' => number_format($p[':amount'], 4, '.', ''),
        'quantity' => number_format($p[':quantity'], 3, '.', ''),
        'indicador_facturacion' => $p[':indicador_facturacion'],
    ], $c->paramsDe('INSERT INTO cotizacion_items'));
    $ajustesRt = array_map(static fn(float $m): string => number_format($m, 2, '.', ''),
        array_column($c->paramsDe('INSERT INTO cotizacion_ajustes'), ':monto', ':concepto'));
    $chk("ida y vuelta ({$idT7}): pdf() recalcula los mismos totales que se guardaron",
        FerreteriaFormato::totales(FerreteriaFormato::lineasDesdeFilas($filasRt), FerreteriaFormato::ajustesDesdeFilas($ajustesRt)) === $totRt);
}
$pdfItemsT7 = FerreteriaFormato::itemsPdf($comoFilasT7($casos['pintura']['lineas']));
$chk('itemsPdf: descripcion, cantidad y precio como numeros',
    $pdfItemsT7[0] === ['description' => 'GALONES DE PINTURA BLNACA SEMIGLOSS', 'quantity' => 7.0, 'amount' => 2000.0]);

echo "\n== T7: client_name y reglas de catalogo (aplicarCatalogo) ==\n";
$cliT7 = $casos['pintura']['cliente'];
$chk('nombreCliente: razon_social primero', FerreteriaFormato::nombreCliente($cliT7) === 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO');
$chk('nombreCliente: sin razon_social => company_name',
    FerreteriaFormato::nombreCliente(['razon_social' => '  ', 'company_name' => 'ACME SRL', 'client_name' => 'Juan']) === 'ACME SRL');
$chk('nombreCliente: solo client_name', FerreteriaFormato::nombreCliente(['razon_social' => null, 'company_name' => '', 'client_name' => 'Juan Perez']) === 'Juan Perez');
$chk('nombreCliente: nada => vacio', FerreteriaFormato::nombreCliente([]) === '');
$chk('nombreCliente: recorta a 100, el ancho de la columna (multibyte)', mb_strlen(FerreteriaFormato::nombreCliente(['razon_social' => str_repeat('Ñ', 150)])) === 100);

$cot = $cotT7($casos['pintura'], null);
$chk('aplicarCatalogo: cliente que no existe => 422', FerreteriaFormato::aplicarCatalogo($cot, null, []) === ['error', 'Elige un cliente para la cotización.', 422]);
$cot['items'][1]['product_id'] = 55;   // existe, es servicio
$cot['items'][2]['product_id'] = 99;   // no existe
$r = FerreteriaFormato::aplicarCatalogo($cot, $cliT7, [55 => ['indicador_bien_servicio' => 2]]);
$chk('aplicarCatalogo: producto que no existe => 422 que nombra la linea 3', $r === [
    'error', 'Línea 3: el producto ya no existe en el catálogo. Búscalo de nuevo o déjala como línea libre.', 422,
]);
$cot['items'][2]['product_id'] = null;
$r = FerreteriaFormato::aplicarCatalogo($cot, $cliT7, [55 => ['indicador_bien_servicio' => 2]]);
$chk('aplicarCatalogo: ok', ($r[0] ?? '') === 'ok');
$chk('aplicarCatalogo: bien/servicio sale del producto', ($r[1]['items'][1]['indicador_bien_servicio'] ?? null) === 2);
$chk('aplicarCatalogo: la linea libre conserva lo del cuerpo', ($r[1]['items'][0]['indicador_bien_servicio'] ?? null) === 1);
$chk('aplicarCatalogo: totales de la hoja pintura', ($r[2]['total'] ?? null) === 49394.8 && count($r[2]['lineas'] ?? []) === 7);
$cot = $cotT7($casos['pintura'], null);
$cot['ajustes']['abono'] = 50000.0;
$r = FerreteriaFormato::aplicarCatalogo($cot, $cliT7, []);
$chk('aplicarCatalogo: abono mayor que lo adeudado => 422 con el texto de errorAbono', ($r[0] ?? '') === 'error' && ($r[2] ?? null) === 422
    && $r[1] === 'El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80).');

echo "\n== T7: registro de formatos ==\n";
// $modeloSinDb, $firmasDe, $contratoFormato, $conTenant y $tenantResuelto los
// deja definidos la seccion de Task 6 (registro y contrato).
$fT7 = CotizacionFormatos::para('ferreteria', $modeloSinDb);
$chk("registro: existe('ferreteria')", CotizacionFormatos::existe('ferreteria'));
$chk("registro: para('ferreteria') = FerreteriaFormato, nombre() 'ferreteria', sin correo",
    get_class($fT7) === 'FerreteriaFormato' && $fT7->nombre() === 'ferreteria' && $fT7->permiteCorreo() === false);
$chk('FerreteriaFormato cumple el contrato (mismas firmas)', $firmasDe('FerreteriaFormato') === $contratoFormato);
$chk('el modelo que recibe para() es el que usa el formato', (fn() => $this->modelo)->call($fT7) === $modeloSinDb);
$chk("delTenant(): cotizacion_formato 'ferreteria' = ferreteria", $conTenant(['id' => 5, 'cotizacion_formato' => 'ferreteria']) === 'ferreteria');
$tenantResuelto->setValue(null, null);
$chk('registro: para(null) sigue siendo Gratex', get_class(CotizacionFormatos::para(null, $modeloSinDb)) === 'GratexFormato');
```

- [ ] **Step 12: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: rounds A and B all `[OK  ]`, then:

```
== T7: pdf() reconstruye los totales desde lo guardado ==

Fatal error: Uncaught Error: Call to undefined method FerreteriaFormato::lineasDesdeFilas() in ...tools\test_cotizacion_ferreteria.php:<line>
```

and `exit=255`.

- [ ] **Step 13: Make `FerreteriaFormato` a `CotizacionFormato`: requires, `extends`, constructor and `nombre()`**

Re-read `src/Utils/Cotizacion/FerreteriaFormato.php` (T4's 417 lines). Three Edits, in this order; the line numbers are
T4's, before the first Edit, and every Edit matches on its text.

Edit 1 (`:1-3`). old_string:

```php
<?php
require_once __DIR__ . '/Redondeo.php';
require_once __DIR__ . '/../../Models/unidadMedidaModel.php';
```

new_string:

```php
<?php
require_once __DIR__ . '/Redondeo.php';
require_once __DIR__ . '/../../Models/unidadMedidaModel.php';
require_once __DIR__ . '/CotizacionFormato.php';
// FerreteriaCotizacionPdf.php tambien incluye este archivo: require_once corta
// el ciclo, y ninguno de los dos usa al otro al cargarse, solo en sus metodos.
require_once __DIR__ . '/FerreteriaCotizacionPdf.php';
require_once __DIR__ . '/../Pdf/BrandingResolver.php';
require_once __DIR__ . '/../../Models/cotizacionModel.php';
require_once __DIR__ . '/../../Models/EmisorConfigModel.php';
require_once __DIR__ . '/../../RequestContext.php';
```

Edit 2 (`:21-22`). old_string:

```php
final class FerreteriaFormato
{
```

new_string:

```php
final class FerreteriaFormato extends CotizacionFormato
{
```

Edit 3 (`:45-48`, the end of `MESES`, the empty line and the `tasa()` docblock line). old_string:

```php
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    ];

    /** Tasa de ITBIS según indicador_facturacion: 1 = 18%, 2 = 16%, 3 y 4 = 0%. Igual que itbisRate del front. */
```

new_string:

```php
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    ];

    /** El modelo de cotizaciones de la peticion: lo pasa CotizacionFormatos::para(). */
    private cotizacionModel $modelo;

    public function __construct(cotizacionModel $modelo)
    {
        $this->modelo = $modelo;
    }

    public function nombre(): string
    {
        return self::NOMBRE;
    }

    /** Tasa de ITBIS según indicador_facturacion: 1 = 18%, 2 = 16%, 3 y 4 = 0%. Igual que itbisRate del front. */
```

- [ ] **Step 14: Add the contract methods and the pure helpers**

One Edit, right after `fechaLarga()`: its `return`, its closing brace, the empty line, and the first two lines of T4's
`normalizarLinea` docblock (T4's `:218-222`; after Step 13's 21 new lines they are at `:239-243`). old_string:

```php
        return self::MESES[(int) $dia->format('n') - 1] . ' ' . $dia->format('j') . '/' . $dia->format('Y') . '.-';
    }

    /**
     * Una línea del cuerpo revisada y con sus defaults, o el mensaje para el
```

new_string: the first two lines of old_string (the `return` and `}`), **one empty line**, the block below, **one empty
line**, then the last two lines of old_string (`    /**` and `     * Una línea del cuerpo revisada…`) unchanged:

```php
    // ------------------------------------------------------------------------
    // Contrato de CotizacionFormato: crear, actualizar, vista previa y PDF.
    // Tocan la DB (cliente, productos, guardar, emisor); las reglas que
    // dependen de lo que la DB contesta van en las funciones puras de abajo
    // (aplicarCatalogo, nombreCliente, lineasDesdeFilas, ajustesDesdeFilas,
    // itemsPdf), que el CLI prueba sin base de datos.
    // ------------------------------------------------------------------------

    public function crear(object $body): array
    {
        $datos = $this->prepararDatos($body);
        if ($datos[0] !== 'ok') {
            return $datos;
        }
        [, $cot, $tot, $cliente] = $datos;
        // user_id sale del token, nunca del cuerpo: un cuerpo puede traer
        // cualquier id. sent_email y total del cuerpo se ignoran (spec 6.5).
        // Sin fecha, el modelo pone la de ahora.
        $r = $this->modelo->crearConFormato($cot, $tot, self::NOMBRE, RequestContext::userId(), self::nombreCliente($cliente));
        return $r[0] === 'success' ? $r : ['error', $r[1], $r[2] ?? 500];
    }

    public function actualizar(array $row, object $body): array
    {
        if (empty($row['id'])) {
            return ['error', 'Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado.', 404];
        }
        $datos = $this->prepararDatos($body);
        if ($datos[0] !== 'ok') {
            return $datos;
        }
        [, $cot, $tot, $cliente] = $datos;
        // numero y code no cambian nunca; date null conserva la guardada.
        $r = $this->modelo->actualizarConFormato((int) $row['id'], $cot, $tot, RequestContext::userId(), self::nombreCliente($cliente));
        return $r[0] === 'success' ? $r : ['error', $r[1], $r[2] ?? 500];
    }

    public function preview(object $body, ?array $row): array
    {
        $datos = $this->prepararDatos($body);
        if ($datos[0] !== 'ok') {
            return $datos;
        }
        [, $cot, $tot, $cliente] = $datos;
        return $this->renderizar([
            // Sin id todavia no hay numero: el PDF imprime VISTA PREVIA.
            'code' => $row !== null ? (string) $row['code'] : null,
            // La fecha que se guardaria: la del cuerpo; si no viene, la
            // guardada (un PUT sin fecha la conserva); si no hay, hoy.
            'date' => $cot['date'] ?? (string) ($row['date'] ?? self::ahoraRd()),
            'items' => self::itemsPdf($cot['items']),
            'totales' => $tot,
        ], $cliente);
    }

    public function pdf(array $cotizacion): array
    {
        // Los totales se recalculan desde lo guardado con las reglas del
        // guardado: las lineas y los ajustes son la fuente, y la retencion
        // sale otra vez del Sub-total, que es el mismo que se guardo.
        $tot = self::totales(
            self::lineasDesdeFilas($cotizacion['items'] ?? []),
            self::ajustesDesdeFilas($cotizacion['ajustes'] ?? [])
        );
        $cliente = null;
        if (!empty($cotizacion['client_id'])) {
            try {
                $cliente = $this->modelo->getCliente((int) $cotizacion['client_id']);
            } catch (Throwable $e) {
                error_log('[cotizaciones] cliente del PDF de la cotizacion ' . ($cotizacion['id'] ?? '?') . ': ' . $e->getMessage());
            }
        }
        // Cliente borrado (cotizaciones.client_id no tiene FK) o lectura
        // fallida: lo que trajo el JOIN de getCotizaciones, y el PDF sale igual.
        $cliente ??= [
            'razon_social' => null,
            'company_name' => $cotizacion['company_name'] ?? null,
            'client_name' => $cotizacion['client_name'] ?? null,
            'rnc' => $cotizacion['rnc'] ?? null,
        ];
        return $this->renderizar([
            'code' => (string) ($cotizacion['code'] ?? ''),
            'date' => (string) ($cotizacion['date'] ?? self::ahoraRd()),
            'items' => self::itemsPdf($cotizacion['items'] ?? []),
            'totales' => $tot,
        ], $cliente);
    }

    /**
     * Lo comun de crear, actualizar y vista previa: la forma del cuerpo
     * (validarForma, sin DB), lo que solo sabe la DB (el cliente y los
     * productos) y las reglas que dependen de eso (aplicarCatalogo).
     *
     * Las unidades son el catalogo de master: problemaCantidad e isValid son
     * fail-open, una lectura fallida del catalogo no bloquea la cotizacion.
     *
     * @return array ['ok', array $cot, array $tot, array $cliente] | ['error', string, int]
     */
    private function prepararDatos(object $body): array
    {
        try {
            $unidades = new unidadMedidaModel();
            $forma = self::validarForma($body, [$unidades, 'problemaCantidad'], [$unidades, 'isValid']);
            if (!$forma['ok']) {
                return ['error', $forma['error'], 422];
            }
            $cot = $forma['cot'];
            $cliente = $this->modelo->getCliente($cot['client_id']);
            $productos = $this->modelo->getProductosInfo(array_column($cot['items'], 'product_id'));
        } catch (Throwable $e) {
            // getCliente y getProductosInfo no atrapan a proposito: una DB
            // caida no puede contestarse "el cliente no existe".
            error_log('[cotizaciones] ferreteria: no se pudo revisar la cotizacion contra la DB: ' . $e->getMessage());
            return ['error', 'No se pudo revisar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.', 500];
        }
        $r = self::aplicarCatalogo($cot, $cliente, $productos);
        if ($r[0] !== 'ok') {
            return $r;
        }
        return ['ok', $r[1], $r[2], $cliente];
    }

    /**
     * El PDF con los datos del tenant. El renderizador es puro; aqui se junta
     * lo que vive en la DB del tenant (emisor_config) y en master (el logo).
     *
     * @return array ['success', string $pdf] | ['error', string, int]
     */
    private function renderizar(array $cotizacion, array $cliente): array
    {
        try {
            $emisor = (new EmisorConfigModel())->get() ?? [];
            $pdf = new FerreteriaCotizacionPdf($cotizacion, $emisor, $cliente, BrandingResolver::logoPath());
            return ['success', $pdf->render()];
        } catch (Throwable $e) {
            error_log('[cotizaciones] no se pudo generar el PDF de Ferreteria (' . ($cotizacion['code'] ?? 'vista previa') . '): ' . $e->getMessage());
            return ['error', 'No se pudo generar el PDF de la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.', 500];
        }
    }

    /**
     * Reglas que dependen de la DB, ya con lo que la DB contesto: el cliente
     * existe, cada producto existe y de el sale bien/servicio; luego los
     * totales y el tope del abono. Pura: el CLI la prueba sin base de datos.
     *
     * @param array      $cot       'cot' de validarForma
     * @param array|null $cliente   getCliente() (null = no existe)
     * @param array      $productos getProductosInfo()
     * @return array ['ok', array $cot, array $tot] | ['error', string, int]
     */
    public static function aplicarCatalogo(array $cot, ?array $cliente, array $productos): array
    {
        if ($cliente === null) {
            return ['error', 'Elige un cliente para la cotización.', 422];
        }
        $cot['items'] = array_values($cot['items']);
        foreach ($cot['items'] as $i => $item) {
            if (empty($item['product_id'])) {
                continue;
            }
            $info = $productos[(int) $item['product_id']] ?? null;
            if ($info === null) {
                return ['error', 'Línea ' . ($i + 1) . ': el producto ya no existe en el catálogo. Búscalo de nuevo o déjala como línea libre.', 422];
            }
            // Bien o servicio lo dice el catalogo, no la pantalla: es lo que
            // la factura copiara al convertir (y lo que decide si mueve inventario).
            $cot['items'][$i]['indicador_bien_servicio'] = (int) $info['indicador_bien_servicio'];
        }
        $tot = self::totales(self::lineasDesdeFilas($cot['items']), $cot['ajustes']);
        $error = self::errorAbono($tot);
        if ($error !== null) {
            return ['error', $error, 422];
        }
        return ['ok', $cot, $tot];
    }

    /**
     * Nombre que se guarda en cotizaciones.client_name: el mismo orden que el
     * PDF (razon_social, si no company_name, si no client_name). Recortado a
     * 100, el ancho de la columna: razon_social admite 150 y en modo estricto
     * MySQL rechazaria la fila entera por un nombre largo.
     */
    public static function nombreCliente(array $cliente): string
    {
        foreach (['razon_social', 'company_name', 'client_name'] as $campo) {
            $v = trim((string) ($cliente[$campo] ?? ''));
            if ($v !== '') {
                return mb_substr($v, 0, 100);
            }
        }
        return '';
    }

    /**
     * Lineas para totales() desde las filas guardadas (cotizacion_items, con
     * los DECIMAL como texto) o desde las ya validadas. Sin indicador (fila
     * vieja o NULL) cuenta como 18%, el mismo default que al guardar.
     *
     * @param array<int,array|object> $items
     * @return array<int,array{quantity:float,amount:float,indicador_facturacion:int}>
     */
    public static function lineasDesdeFilas(array $items): array
    {
        $lineas = [];
        foreach (array_values($items) as $fila) {
            $fila = (array) $fila;
            $ind = $fila['indicador_facturacion'] ?? null;
            $lineas[] = [
                'quantity' => (float) ($fila['quantity'] ?? 0),
                'amount' => (float) ($fila['amount'] ?? 0),
                'indicador_facturacion' => ($ind === null || $ind === '') ? 1 : (int) $ind,
            ];
        }
        return $lineas;
    }

    /**
     * Ajustes para totales() desde lo guardado ([concepto => monto], como lo
     * devuelve getAjustes, o el objeto `ajustes` de la fila del GET). La
     * retencion se guarda como monto; aqui vuelve a ser la casilla (marcada si
     * el monto es > 0) y totales() la recalcula desde el Sub-total.
     */
    public static function ajustesDesdeFilas(array|object $filas): array
    {
        $guardados = (array) $filas;
        $out = [];
        foreach (self::AJUSTES_MONTO as $concepto) {
            $v = $guardados[$concepto] ?? 0;
            $out[$concepto] = is_numeric($v) ? (float) $v : 0.0;
        }
        $ret = $guardados[self::RETENCION] ?? 0;
        $out[self::RETENCION] = is_numeric($ret) && (float) $ret > 0;
        return $out;
    }

    /**
     * Lineas en la forma de FerreteriaCotizacionPdf. Sirve igual para las del
     * cuerpo ya validado (vista previa) que para las filas guardadas (PDF).
     *
     * @return array<int,array{description:string,quantity:float,amount:float}>
     */
    public static function itemsPdf(array $items): array
    {
        $out = [];
        foreach (array_values($items) as $item) {
            $item = (array) $item;
            $out[] = [
                'description' => (string) ($item['description'] ?? ''),
                'quantity' => (float) ($item['quantity'] ?? 0),
                'amount' => (float) ($item['amount'] ?? 0),
            ];
        }
        return $out;
    }

    /** Fecha y hora de ahora en Santo Domingo, como la guarda un DATETIME. */
    private static function ahoraRd(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('America/Santo_Domingo')))->format('Y-m-d H:i:s');
    }
```

Run:

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
php -l src/Utils/Cotizacion/FerreteriaFormato.php && php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```

Expected: `No syntax errors detected`, every earlier line unchanged, all round-C lines `[OK  ]` except three registry ones:

```
== T7: registro de formatos ==
  [FALLA] registro: existe('ferreteria')
  [FALLA] registro: para('ferreteria') = FerreteriaFormato, nombre() 'ferreteria', sin correo
  [OK  ] FerreteriaFormato cumple el contrato (mismas firmas)
  [OK  ] el modelo que recibe para() es el que usa el formato
  [FALLA] delTenant(): cotizacion_formato 'ferreteria' = ferreteria
  [OK  ] registro: para(null) sigue siendo Gratex
```

a last line `(N+70)/(N+73) OK`, `exit=1`, and on stderr `[cotizaciones] formato desconocido "ferreteria": se usa gratex`
and `[cotizaciones] tenants.cotizacion_formato = "ferreteria" no es un formato conocido: se usa gratex` (the registry
doesn't know the name yet). The contract-signature check already passes: the class is complete, just not registered.

- [ ] **Step 15: Register `'ferreteria'`**

Re-read `src/Utils/Cotizacion/CotizacionFormatos.php`. One Edit in the `FORMATOS` const. old_string:

```php
        'gratex' => GratexFormato::class,
    ];
```

new_string:

```php
        'gratex' => GratexFormato::class,
        'ferreteria' => FerreteriaFormato::class,
    ];
```

No `require_once` is needed: `FerreteriaFormato::class` in a const doesn't load the class, and `para()` loads
`FerreteriaFormato.php` by name only when the formato is used, so a Gratex request never loads Ferretería's code or PDF.

- [ ] **Step 16: Run everything and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
for f in src/Models/cotizacionModel.php src/Utils/Cotizacion/FerreteriaFormato.php src/Utils/Cotizacion/CotizacionFormatos.php tools/test_cotizacion_ferreteria.php; do php -l "$f"; done
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
wc -l src/Utils/Cotizacion/FerreteriaFormato.php src/Models/cotizacionModel.php
```

Expected:
- `No syntax errors detected` four times.
- No `[FALLA]`; a last line `(N+73)/(N+73) OK` (`378/378 OK` with the planned T5/T6); `exit=0`. Stderr only carries T5's
  expected `[FerreteriaCotizacionPdf] logo ilegible (...)` line (T6 and T7 send their expected log lines to temp files).
- The round-C lines:

```
== T7: pdf() reconstruye los totales desde lo guardado ==
  [OK  ] lineasDesdeFilas: 7 lineas como numeros
  [OK  ] pintura desde filas: 41,860.00 / 7,534.80 / 49,394.80
  [OK  ] fila sin indicador (o NULL) cuenta como 18%
  [OK  ] ajustesDesdeFilas: montos a float y la retencion a casilla
  [OK  ] ajustesDesdeFilas({}) = todo en cero, sin retencion
  [OK  ] ajustesDesdeFilas: retencion '0.00' = casilla apagada
  [OK  ] ida y vuelta (pintura): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (pintura_retencion_abono): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (pintura_mano_obra): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (b150000049): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (ceramicas): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (redondeo_8475): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (flotante): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (mixto): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (exento): pdf() recalcula los mismos totales que se guardaron
  [OK  ] ida y vuelta (largo_60): pdf() recalcula los mismos totales que se guardaron
  [OK  ] itemsPdf: descripcion, cantidad y precio como numeros

== T7: client_name y reglas de catalogo (aplicarCatalogo) ==
  [OK  ] nombreCliente: razon_social primero
  [OK  ] nombreCliente: sin razon_social => company_name
  [OK  ] nombreCliente: solo client_name
  [OK  ] nombreCliente: nada => vacio
  [OK  ] nombreCliente: recorta a 100, el ancho de la columna (multibyte)
  [OK  ] aplicarCatalogo: cliente que no existe => 422
  [OK  ] aplicarCatalogo: producto que no existe => 422 que nombra la linea 3
  [OK  ] aplicarCatalogo: ok
  [OK  ] aplicarCatalogo: bien/servicio sale del producto
  [OK  ] aplicarCatalogo: la linea libre conserva lo del cuerpo
  [OK  ] aplicarCatalogo: totales de la hoja pintura
  [OK  ] aplicarCatalogo: abono mayor que lo adeudado => 422 con el texto de errorAbono

== T7: registro de formatos ==
  [OK  ] registro: existe('ferreteria')
  [OK  ] registro: para('ferreteria') = FerreteriaFormato, nombre() 'ferreteria', sin correo
  [OK  ] FerreteriaFormato cumple el contrato (mismas firmas)
  [OK  ] el modelo que recibe para() es el que usa el formato
  [OK  ] delTenant(): cotizacion_formato 'ferreteria' = ferreteria
  [OK  ] registro: para(null) sigue siendo Gratex
```

- `699 src/Utils/Cotizacion/FerreteriaFormato.php` and `777 src/Models/cotizacionModel.php`.

Also run `php tools/test_cotizacion_ferreteria.php --pdf` once: T5's PDFs are still written to `tools/out/` (don't commit
them).

- [ ] **Step 17: Gratex untouched, then commit the formato**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git diff --stat -- src/Utils/Cotizacion/FerreteriaFormato.php src/Utils/Cotizacion/CotizacionFormatos.php
git diff --stat "$(git merge-base main HEAD)" -- src/Utils/CotizacionPdfGenerator.php
git status --short
```

Expected: `FerreteriaFormato.php | 284 ++++-` (283 insertions, 1 deletion: the class line) and `CotizacionFormatos.php | 1 +`;
the `CotizacionPdfGenerator.php` diff prints nothing; `git status` lists only those two files, the harness, and the untracked
`tools/out/`.

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add src/Utils/Cotizacion/FerreteriaFormato.php src/Utils/Cotizacion/CotizacionFormatos.php tools/test_cotizacion_ferreteria.php
git commit -F - <<'EOF'
feat(cotizaciones): formato Ferreteria completo (crear, editar, vista previa y PDF) y registrado

FerreteriaFormato extiende CotizacionFormato: valida el cuerpo (validarForma),
revisa contra la DB que el cliente y cada producto existan (bien/servicio sale
del producto), calcula los totales, rechaza un abono mayor que lo adeudado y
guarda con crearConFormato/actualizarConFormato. user_id sale del token; total
y sent_email del cuerpo se ignoran. preview y pdf arman el emisor, el cliente y
el logo para FerreteriaCotizacionPdf; pdf recalcula los totales desde las
lineas y los ajustes guardados. 'ferreteria' queda en CotizacionFormatos.
Las piezas puras (aplicarCatalogo, nombreCliente, lineasDesdeFilas,
ajustesDesdeFilas, itemsPdf) las prueba el CLI, con una ida y vuelta por cada
caso del fixture.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -2
```

Expected: one new commit with 3 files, on top of Step 10's.

**Manual server checks for Task 7** (no local MySQL; run them with Task 8's `tests/test_cotizaciones_ferreteria.http`
on a server with master 011 and tenant 026 applied):
- F1/F2 create, then in the tenant DB:
  `SELECT formato, numero, code, client_name, subtotal, itbis, total, user_id FROM cotizaciones WHERE id = <id>;`
  → `ferreteria`, consecutive `numero`, `COT-00000N`, the client's razón social, `2020.00 / 363.60 / 3883.60`, the logged-in
  user's id. `SELECT product_id, unidad_medida, indicador_facturacion, indicador_bien_servicio, subtotal, itbis_amount FROM cotizacion_items WHERE cotizacion_id = <id> ORDER BY id;`
  → the product line with its `products.indicador_bien_servicio`, the free line `NULL / '43' / 1 / 1`, `1870.00 / 336.60`
  and `150.00 / 27.00`. `SELECT concepto, monto FROM cotizacion_ajustes WHERE cotizacion_id = <id>;` → only
  `mano_obra 1500.00` (F2: `abono 10000.00`, `retencion_isr 2093.00`).
- Numbering under concurrency: run five creates at once and check five distinct consecutive numbers (then delete them):

```bash
BASE=http://localhost:8000; TOKEN='<token de Ferreteria>'; CLIENTE=<id de cliente>
for i in 1 2 3 4 5; do
  curl -s -X POST "$BASE/api/cotizaciones" -H "X-API-KEY: $TOKEN" -H "Content-Type: application/json" \
    -d '{"formato":"ferreteria","client_id":'"$CLIENTE"',"items":[{"description":"PRUEBA CONCURRENCIA '"$i"'","quantity":1,"amount":10}]}' &
done; wait; echo
```

  Expected: five `{"status":true,"data":{...}}` with five different `numero` values in a row; no error.
- F6/F7 edit keeps `numero`/`code`; without `date` the stored datetime is unchanged; without `ajustes` the rows in
  `cotizacion_ajustes` are gone.
- F10 PDF matches the Excel sheet; D1 delete removes its `cotizacion_items` and `cotizacion_ajustes` rows.
- Gratex block G1-G13 returns exactly what it returned before the deploy, and G4/G5/G6 also work against a tenant DB
  **without** 026 (items not empty, `ajustes: {}`).

---


### Task 7b: Clean line descriptions (control characters) in validation and in the PDF

**Why.** The Ferretería form already collapses line breaks in the description field (Task 12's auto-growing
textarea replaces `\r`/`\n` runs with one space). A direct API caller can still send descriptions with
`\r\n`, tabs or other control characters, though:
- `FerreteriaFormato::validarForma` only trims the ends.
- `FerreteriaCotizacionPdf::texto` only trims too.

Such a description makes one PDF row much taller than expected: MultiCell breaks on every `\n`. In the worst
case the row overflows a page, which Task 5 lists as its "known limit". This task removes that limit at both
entry points with a single helper.

Characters outside ISO-8859-1 (emoji, `—`, `€`) still print as `?`. That is the same behavior as every other
FPDF document in the repo (facturas, recibos), and it is accepted.

**Files:**
- Modify: `src/Utils/Cotizacion/FerreteriaFormato.php`: add `limpiarDescripcion()`, and use it where
  `validarForma` reads `$item->description` (the line written by Task 4, `$descripcion = is_string($item->description ?? null) ? trim($item->description) : '';`).
- Modify: `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`: `texto()` (Task 5, `return is_scalar($valor) ? trim((string) $valor) : '';`).
- Test: `tools/test_cotizacion_ferreteria.php`, with a new section directly above the marker block, as every
  section is added (see the Task 1 notes).

**Interfaces:**
- Consumes: `FerreteriaFormato::validarForma(object $body, callable $problemaCantidad, callable $unidadValida): array` (Task 4) and `FerreteriaCotizacionPdf` (Task 5).
- Produces: `public static function limpiarDescripcion(string $s): string` on `FerreteriaFormato`.
  - Every run of control characters (`\p{Cc}`, which includes `\r`, `\n` and `\t`) and of the Unicode
    line/paragraph separators U+2028/U+2029 becomes ONE space, then the result is trimmed.
  - Runs of ordinary spaces are kept as typed: their sheets have descriptions like `T  3"`.

- [ ] **Step 1: Write the failing test.** Re-read `tools/test_cotizacion_ferreteria.php`, then insert this section
  directly above the 3-line marker block (`// ----…` / `// Las tareas siguientes agregan sus secciones AQUÍ, encima del resumen.` / `// ----…`), separated from it by one blank line:

```php
// ---------------------------------------------------------------------------
// T7b: descripciones limpias (saltos de linea y controles -> un espacio)
// ---------------------------------------------------------------------------
echo "\n== T7b: descripciones limpias ==\n";
$chk('limpiarDescripcion: \r\n y \t -> un espacio',
    FerreteriaFormato::limpiarDescripcion("LINEA UNO\r\nLINEA DOS\tTRES") === 'LINEA UNO LINEA DOS TRES');
$chk('limpiarDescripcion: corrida de controles -> UN espacio',
    FerreteriaFormato::limpiarDescripcion("A\n\n\r\n\x0B\x0CB") === 'A B');
$chk('limpiarDescripcion: separadores Unicode U+2028/U+2029',
    FerreteriaFormato::limpiarDescripcion("A\u{2028}B\u{2029}C") === 'A B C');
$chk('limpiarDescripcion: respeta espacios dobles escritos (T  3")',
    FerreteriaFormato::limpiarDescripcion('T  3"') === 'T  3"');
$chk('limpiarDescripcion: recorta extremos (tambien controles en los extremos)',
    FerreteriaFormato::limpiarDescripcion("\n  CODO DE 2 \t\r\n") === 'CODO DE 2');
$chk('limpiarDescripcion: solo controles -> vacia',
    FerreteriaFormato::limpiarDescripcion("\r\n\t") === '');

// validarForma usa la descripcion limpia (y una de puros saltos cuenta como vacia).
$t7bCuerpo = static function (string $descripcion): object {
    return json_decode(json_encode([
        'formato' => 'ferreteria', 'client_id' => 1, 'date' => '2026-09-02 10:15:00',
        'items' => [['product_id' => null, 'description' => $descripcion, 'quantity' => 1, 'amount' => 100]],
        'ajustes' => ['cargos_bancarios' => 0, 'manejo_bancario' => 0, 'mano_obra' => 0, 'abono' => 0, 'retencion_isr' => false],
    ]));
};
$t7bProblema = static fn(float $c, string $u, int $d): ?string => null;
$t7bUnidad = static fn(string $u): bool => true;
$t7bR = FerreteriaFormato::validarForma($t7bCuerpo("FUNDA\r\nCEMENTO\tGRIS"), $t7bProblema, $t7bUnidad);
$chk('validarForma guarda la descripcion limpia',
    ($t7bR['ok'] ?? null) === true && ($t7bR['cot']['items'][0]['description'] ?? null) === 'FUNDA CEMENTO GRIS');
$t7bR = FerreteriaFormato::validarForma($t7bCuerpo("\r\n\t"), $t7bProblema, $t7bUnidad);
$chk('validarForma: descripcion de puros saltos = sin descripcion',
    ($t7bR['ok'] ?? null) === false
    && ($t7bR['error'] ?? null) === 'La línea 1 no tiene descripción. Escríbela o quita esa línea.');

// El PDF tambien limpia (filas viejas o datos que no pasaron por validarForma):
// 40 lineas con 30 saltos cada una caben en las mismas paginas que sin saltos.
$t7bTot = FerreteriaFormato::totales(
    array_fill(0, 40, ['quantity' => 1.0, 'amount' => 10.0, 'indicador_facturacion' => 1]),
    ['cargos_bancarios' => 0.0, 'manejo_bancario' => 0.0, 'mano_obra' => 0.0, 'abono' => 0.0, 'retencion_isr' => false]
);
$t7bPdf = static function (string $desc) use ($fixture, $t7bTot): string {
    $items = array_fill(0, 40, ['description' => $desc, 'quantity' => 1.0, 'amount' => 10.0]);
    $cot = ['code' => 'COT-000099', 'date' => '2026-09-02 10:15:00', 'items' => $items, 'totales' => $t7bTot];
    $cliente = $fixture['casos'][0]['cliente'];
    return (new FerreteriaCotizacionPdf($cot, $fixture['emisor'], $cliente, null))->render();
};
$t7bPaginas = static fn(string $pdf): int => preg_match_all('#/Type /Page[^s]#', $pdf);
$t7bLimpio = $t7bPaginas($t7bPdf('ARTICULO DE PRUEBA'));
$t7bSucio = $t7bPaginas($t7bPdf('ARTICULO' . str_repeat("\r\n", 30) . 'DE PRUEBA'));
$chk('PDF: descripciones con saltos no agregan paginas (' . $t7bSucio . ' vs ' . $t7bLimpio . ')',
    $t7bLimpio > 0 && $t7bSucio === $t7bLimpio);
```

  Notes:
  - `$chk` and `$fixture` come from Task 1's harness. The section defines its own body, stubs and PDF
    builder, so it doesn't depend on Task 4's local variables.
  - The page counter matches `/Type /Page` not followed by `s`, so it doesn't count the `/Type /Pages` node.
    If Task 5's section already defines a page counter with another regex, keep this one local, as written.

- [ ] **Step 2: Run it and watch it fail.**

Run (from `C:/Users/Signos/Documents/edwin/api-gratex`): `php tools/test_cotizacion_ferreteria.php; echo "exit=$?"`
Expected: `Fatal error: Uncaught Error: Call to undefined method FerreteriaFormato::limpiarDescripcion()` and `exit=255`.

- [ ] **Step 3: Add the helper to `FerreteriaFormato`.** Re-read `src/Utils/Cotizacion/FerreteriaFormato.php`. Put this
  public static method right after `formatearRnc()`, with a blank line on each side:

```php
    /**
     * Descripcion de una linea lista para guardar e imprimir: cada corrida de
     * caracteres de control (saltos de linea, tabuladores...) o de separadores
     * Unicode de linea/parrafo pasa a UN espacio, y se recortan los extremos.
     * El formulario ya junta los saltos, pero la API acepta lo que le manden, y
     * en el PDF un "\n" es un renglon nuevo dentro de la celda: una descripcion
     * llena de saltos estiraba la fila hasta salirse de la pagina. Los espacios
     * normales se respetan: en sus hojas hay descripciones como 'T  3"'.
     */
    public static function limpiarDescripcion(string $s): string
    {
        $limpia = preg_replace('/[\p{Cc}\x{2028}\x{2029}]+/u', ' ', $s);
        // preg_replace devuelve null con UTF-8 invalido: en ese caso se quitan los
        // controles ASCII byte a byte (la conversion a ISO-8859-1 del PDF ya
        // cambia lo demas por '?').
        if ($limpia === null) {
            $limpia = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $s) ?? $s;
        }
        return trim($limpia);
    }
```

- [ ] **Step 4: Use it in `validarForma`.** In the same file, replace exactly:

```php
        $descripcion = is_string($item->description ?? null) ? trim($item->description) : '';
```

  with:

```php
        $descripcion = is_string($item->description ?? null) ? self::limpiarDescripcion($item->description) : '';
```

  Nothing else in `validarForma` changes. The empty check and the 1000-character check run on the cleaned
  text, which is what gets stored.

- [ ] **Step 5: Use it in the renderer.** Re-read `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`. It already
  `require_once`s `FerreteriaFormato.php` (Task 5). Replace exactly the body of `texto()`:

```php
        return is_scalar($valor) ? trim((string) $valor) : '';
```

  with:

```php
        // Mismo criterio que validarForma: un salto de linea en una fila vieja o
        // en un dato del emisor no debe estirar la celda (ver limpiarDescripcion).
        return is_scalar($valor) ? FerreteriaFormato::limpiarDescripcion((string) $valor) : '';
```

- [ ] **Step 6: Run the harness and the linters.**

Run:
```bash
php -l src/Utils/Cotizacion/FerreteriaFormato.php
php -l src/Utils/Cotizacion/FerreteriaCotizacionPdf.php
php tools/test_cotizacion_ferreteria.php; echo "exit=$?"
```
Expected:
- both files print `No syntax errors detected`;
- the T7b section prints 9 `[OK  ]` lines;
- the summary is `(previous total + 9)/(previous total + 9) OK` (`387/387 OK` if the earlier sections match the
  plan's 378), and `exit=0`.

If any earlier section now fails, the cleanup changed something it shouldn't have. Stop and compare: only
descriptions that contain control characters may change.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add src/Utils/Cotizacion/FerreteriaFormato.php src/Utils/Cotizacion/FerreteriaCotizacionPdf.php tools/test_cotizacion_ferreteria.php
git commit -F - <<'EOF'
fix(cotizaciones): limpiar saltos de linea y controles en las descripciones (Ferreteria)

validarForma y el PDF solo recortaban los extremos: una descripcion enviada
directo a la API con \r\n o tabuladores estiraba la fila del PDF hasta salirse
de la pagina. limpiarDescripcion() deja un espacio por cada corrida de
controles y respeta los espacios escritos.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git show --stat --oneline HEAD
```
Expected: one commit touching exactly those 3 files.

---

### Task 8: Backend docs and the `.http` checks

**Files:**
- Create: `docs/api/cotizaciones.md`
- Create: `docs/modules/cotizaciones-formatos.md` (T2's `docs/database/schema.md` already links to it)
- Modify: `docs/README.md:28` (api table, after the facturas-simples row) and `:48` (modules table, after the
  branding-plantillas row)
- Modify: `docs/integrations/alta-tenant-runbook.md:130-131` (Fase 4, after "Logo"), `:145-146` (Fase 5, item 3),
  `:186` (Troubleshooting, last row), `:198` (Referencia rápida, Logo row)
- Create: `tests/test_cotizaciones_ferreteria.http`
- Test: the link check in Step 7; the `.http` itself is the manual server check.

**Interfaces:**
- Consumes (documents them; nothing in code changes):
  - The endpoints and behavior of T3 (`GET /api/branding` → `cotizacion_formato`), T6 (formato resolution, 409 guard,
    preview by id, `Cotizacion_Preview.pdf`, `Cotizacion_<code>.pdf`) and T7 (Ferretería rules, numbering, ajustes,
    read paths, HTTP codes 404/422/500).
  - The exact messages of T4 (`validarForma`, `errorAbono`), T7 (`aplicarCatalogo`, model errors) and the legacy Gratex
    code (`COT_*`, `cotValidarItems`, `updateCotizacion`, `deleteCotizacion`, the PDF 404).
  - The exact bodies fiscalo `src/features/cotizaciones/CotizacionFormView.tsx` sends (`construir()` at `:179-191`,
    `guardar` at `:195-220`, `vistaPrevia` at `:222-235`): create `{client_id, items:[{description, amount, quantity,
    subtotal}], total, date, user_id, sent_email}`, edit `{id, ...}`, preview `{client_id, items, total}`.
- Produces: the five files above.

- [ ] **Step 1: Preflight — pin the behaviors the docs quote**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git log --oneline -4
grep -n "está desactualizada" src/Utils/Cotizacion/CotizacionFormatos.php
grep -n "Cotizacion_Preview.pdf\|'Cotizacion_' \." src/Controllers/cotizacionController.php
grep -nF 'para($oldCotizacion' src/Controllers/cotizacionController.php
grep -c "http_response_code(404)" src/Controllers/cotizacionController.php
grep -n "'ferreteria' => FerreteriaFormato::class" src/Utils/Cotizacion/CotizacionFormatos.php
```

Expected:
- Task 7's two commits on top.
- `MSG_DESACTUALIZADA` = `La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.`
- `Cotizacion_Preview.pdf` and the `'Cotizacion_' . ... '.pdf'` filenames in the controller.
- One hit for the PUT resolution from the row (`para($oldCotizacion['formato'] ?? null, ...)`): a missing row resolves to
  Gratex, so a Ferretería body on a deleted quote gets the **409**, which is what the docs and D3 below say.
- `1`: the only literal `http_response_code(404)` is the PDF of a missing id; every other code comes from the formato.
- The registration line from Task 7.

If any of these differs, the docs below describe something the code doesn't do: fix the docs to match the code (never
the code, in this task) and say so in the commit message.

- [ ] **Step 2: Write `docs/api/cotizaciones.md`**

Create it with exactly this content:

````markdown
# API — Cotizaciones

Cotizaciones (presupuestos) del tenant: crear, editar, listar, vista previa en PDF,
PDF guardado y eliminar. Las rutas son las mismas para todos los tenants; lo que
cambia es el **formato** de cotización de cada uno (`gratex` o `ferreteria`), que
decide qué cuerpo se acepta, cómo se calculan los totales, cómo se numera y cómo se
ve el PDF.

> **De dónde sale el formato.** Una cotización nueva toma el de la empresa
> (`master.tenants.cotizacion_formato`, master_migration 011, default `gratex`). Una
> que ya existe usa siempre el suyo (`cotizaciones.formato`, tenant migration 026;
> `NULL` = gratex), aunque la empresa cambie de formato después. Arquitectura y cómo
> agregar un formato: [../modules/cotizaciones-formatos.md](../modules/cotizaciones-formatos.md).

Controlador: `src/Controllers/cotizacionController.php` (decide el formato y envuelve
la respuesta) · formatos: `src/Utils/Cotizacion/` · modelo: `src/Models/cotizacionModel.php`.
Base URL (local): `http://localhost:8000`

### Autenticación y permisos

Todas las rutas requieren el header `X-API-KEY` (token de sesión) o
`Authorization: Bearer <token>`, y el módulo **`cotizaciones`** en el rol del usuario
(`config/permissions.php`). Sin credenciales válidas → `401`.

```
X-API-KEY: <tu_api_key>
```

### Forma de las respuestas

| Caso | Forma |
|------|-------|
| Éxito (recurso) | `{ "status": true, "data": ... }` |
| Éxito (lista) | `{ "status": true, "data": [ ... ], "pagination": { ... } }` |
| Error | `{ "status": false, "error": "mensaje" }` |

`error` es siempre un texto para el usuario, en español. El detalle técnico (SQL,
excepciones) va solo al log del servidor.

---

### Endpoints

| Método | Ruta | Descripción | Formato que la atiende |
|--------|------|-------------|------------------------|
| GET | `/api/cotizaciones` | Lista paginada (`?page`, `?pageSize`, `?query`) | — (lectura común) |
| GET | `/api/cotizaciones?id={id}` | Una cotización con sus líneas y ajustes | — (lectura común) |
| GET | `/api/cotizaciones/{id}/pdf` | PDF guardado (`?format=base64` o descarga) | el de la fila |
| POST | `/api/cotizaciones` | Crear | el de la empresa |
| POST | `/api/cotizaciones/preview` | **PDF sin guardar** | el de la fila si el cuerpo trae `id` de una que existe; si no, el de la empresa |
| PUT | `/api/cotizaciones` | Editar (`id` en el cuerpo) | el de la fila |
| DELETE | `/api/cotizaciones` | Eliminar (`id` en el cuerpo) | — (común) |

### Guardia de formato (`409`)

Cada cuerpo de POST, PUT y preview dice con qué formato se armó: el formulario de
Ferretería manda `"formato": "ferreteria"` siempre, y el de Gratex no manda nada
(= `gratex`). Si no coincide con el formato que resolvió el servidor, responde
**`409`** y no guarda nada:

```json
{ "status": false, "error": "La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página." }
```

Pasa con una pestaña abierta desde antes de que ops cambiara el formato de la
empresa, o con un bundle viejo del front. Sin esta guardia, un cuerpo de Gratex
(precios con ITBIS incluido) se guardaría con las reglas de Ferretería, que suman el
ITBIS encima.

---

### Lecturas (todos los formatos)

### GET `/api/cotizaciones` — Listar (paginado)

| Param | Default | Notas |
|-------|---------|-------|
| `page` | `1` | Página (1-based) |
| `pageSize` | `10` | Filas por página |
| `query` | — | Busca en `code` (`COT-000123` y `000123` encuentran la misma), y en `client_name`, `rnc`, `company_name`, `phone_number` y `email` del cliente |

Orden: `date DESC, id DESC` (las de la misma fecha, la más nueva primero).

**Respuesta `200`** (una fila de Gratex y una de Ferretería):

```json
{
  "status": true,
  "data": [
    {
      "id": 512, "code": "QWE481", "formato": null, "numero": null,
      "date": "2026-09-30 16:02:11", "client_id": 3511,
      "client_name": "Roselin SRL", "company_name": "Roselin SRL", "rnc": "131234567",
      "subtotal": null, "itbis": null, "total": "3245.75",
      "user_id": 4, "updated_at": null,
      "description": "Banner 3x2 full color\nInstalacion",
      "items": [
        { "id": 9001, "cotizacion_id": 512, "product_id": null, "description": "Banner 3x2 full color",
          "amount": "2360.0000", "quantity": "1.000", "subtotal": "2360.00",
          "unidad_medida": null, "indicador_facturacion": null, "indicador_bien_servicio": null, "itbis_amount": null }
      ],
      "ajustes": {}
    },
    {
      "id": 513, "code": "COT-000001", "formato": "ferreteria", "numero": 1,
      "date": "2026-09-02 10:15:00", "client_id": 123,
      "client_name": "Hospital Moscoso Puello", "company_name": "HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO", "rnc": "401515131",
      "subtotal": "2020.00", "itbis": "363.60", "total": "3883.60",
      "user_id": 7, "updated_at": null,
      "description": "FUNDAS CEMENTO GRIS\nCORTE DE TUBO",
      "items": [
        { "id": 9002, "cotizacion_id": 513, "product_id": 55, "description": "FUNDAS CEMENTO GRIS",
          "amount": "935.0000", "quantity": "2.000", "subtotal": "1870.00",
          "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1, "itbis_amount": "336.60" },
        { "id": 9003, "cotizacion_id": 513, "product_id": null, "description": "CORTE DE TUBO",
          "amount": "150.0000", "quantity": "1.000", "subtotal": "150.00",
          "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1, "itbis_amount": "27.00" }
      ],
      "ajustes": { "mano_obra": "1500.00" }
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "total": 2, "totalPages": 1 }
}
```

Cómo leer la fila:

- **Columnas de la 026** (`formato`, `numero`, `subtotal`, `itbis` y, en cada línea,
  `product_id`, `unidad_medida`, `indicador_facturacion`, `indicador_bien_servicio`,
  `itbis_amount`) aparecen solo cuando la base del tenant ya tiene la migración 026.
  En las filas y líneas de Gratex valen `null`. Un front tiene que tratar "no viene"
  igual que `null`.
- **Montos** (`total`, `subtotal`, `itbis`, `amount`, `quantity`, `itbis_amount`,
  los de `ajustes`): texto DECIMAL, como los entrega MySQL. Convertirlos a número
  antes de operar. Los enteros (`id`, `numero`, `client_id`, indicadores) llegan
  como número.
- **`ajustes`** es **siempre un objeto JSON** con clave = concepto y monto DECIMAL.
  Un concepto que no viene vale 0. Las filas de Gratex traen `{}` sin consultar la
  tabla (una base sin la 026 nunca vacía el listado de Gratex). En Ferretería,
  `retencion_isr` es el **monto** de la retención guardada (no la casilla).
- **`client_name`, `company_name`, `rnc`** vienen del cliente (`LEFT JOIN clients`):
  el `client_name` que se guardó en `cotizaciones` queda tapado por el del JOIN.
- `description`: las descripciones de las líneas unidas con `\n`, para la lista.

### GET `/api/cotizaciones?id={id}` — Obtener una

Mismas claves que el listado. `data` es un **arreglo** con la cotización, o vacío si
el id no existe (sigue siendo `status: true`):

```json
{ "status": true, "data": [ { "id": 513, "code": "COT-000001", "formato": "ferreteria", "...": "..." } ] }
```

### GET `/api/cotizaciones/{id}/pdf` — PDF guardado

- `?format=base64` → `{ "status": true, "data": { "filename": "Cotizacion_<code>.pdf", "content": "<base64>", "mime_type": "application/pdf" } }`.
- Sin `format` (o cualquier otro valor) → el PDF crudo como descarga
  (`Content-Disposition: attachment; filename="Cotizacion_<code>.pdf"`).
- Se imprime con **el formato de la fila**: una de Gratex sale con el PDF de Gratex
  aunque la empresa ya sea `ferreteria`.
- **`404`** si no existe: `"No encontramos esta cotización. Puede que la hayan eliminado; actualiza el listado."`
- **`500`** (solo Ferretería) si el PDF no se pudo generar:
  `"No se pudo generar el PDF de la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte."`

---

### Formato `gratex`

Es el comportamiento de siempre, sin cambios: mismos cuerpos, mismas respuestas,
mismos mensajes, mismo PDF (`src/Utils/CotizacionPdfGenerator.php`) y mismo envío
por correo. El código vive en `src/Utils/Cotizacion/GratexFormato.php`.

### POST `/api/cotizaciones` — Crear

El cuerpo exacto que manda el formulario de Gratex (fiscalo
`CotizacionFormView.tsx`):

```json
{
  "client_id": 3511,
  "items": [
    { "description": "Banner 3x2 full color", "amount": 2360, "quantity": 1, "subtotal": 2360 },
    { "description": "Instalacion", "amount": 590.5, "quantity": 1.5, "subtotal": 885.75 }
  ],
  "total": 3245.75,
  "date": "2026-10-01 10:15:00",
  "user_id": 4,
  "sent_email": false
}
```

| Campo | Req. | Notas |
|-------|------|-------|
| `client_id` | ✅ | Id del cliente |
| `items` | ✅ | ≥ 1 línea: `description` (no vacía), `amount` (precio **con ITBIS incluido**; se guarda redondeado a 4 decimales), `quantity` (> 0, hasta 2 decimales), `subtotal` (opcional; si falta, `amount × quantity` a 2 decimales) |
| `total` | ✅ | Numérico. Se guarda tal cual |
| `date` | ❌ | `''` o ausente = ahora (hora del servidor) |
| `user_id` | ❌ | Se guarda tal cual |
| `sent_email` | ❌ | `true` = genera el PDF y lo envía al correo del cliente (`TenantMail`) |
| `formato` | ❌ | No se manda (= `gratex`). Cualquier otro valor → `409` |

El código es aleatorio (3 letras + 3 dígitos, p. ej. `QWE481`).

**Respuesta `200`:** `{ "status": true, "data": { "id": "512", "code": "QWE481", "message": "Cotization saved" } }`.
Con `sent_email: true`, `message` es `"Cotization saved and emailed"` o el aviso de por
qué no se envió (la cotización ya quedó guardada), p. ej. `"La cotización se guardó,
pero no se envió por correo: el cliente no tiene un correo válido registrado."`.

**Errores** (los de cabecera responden **`200`** con `status: false`, como siempre):

| HTTP | `error` | Cuándo |
|------|---------|--------|
| 200 | `Elige un cliente para la cotización.` | Sin `client_id` o `null` |
| 200 | `Agrega al menos una línea a la cotización.` | Sin `items`, no es arreglo, o vacío |
| 200 | `El total de la cotización no es válido. Revisa los precios y las cantidades.` | Sin `total` o no numérico |
| 422 | `La línea N no tiene descripción. Escríbela o quita esa línea.` | Línea sin descripción |
| 422 | `El precio de la línea N no es válido. Revísalo.` | `amount` ausente o no numérico |
| 422 | `Línea N: la cantidad debe ser mayor que 0.` / `Línea N: la cantidad admite hasta 2 decimales.` | Cantidad |
| 200 | `No se pudo guardar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.` | Fallo de la base |
| 409 | (guardia de formato) | El cuerpo trae `formato` distinto de `gratex`, o la empresa es `ferreteria` |

### PUT `/api/cotizaciones` — Editar

El mismo cuerpo con `id` primero (`{ "id": 512, "client_id": ..., "items": [...], "total": ..., "date": ..., "user_id": ..., "sent_email": false }`).
Reemplaza la cabecera y todas las líneas. `date` vacío conserva la guardada.

- **`200`** `{ "status": true, "data": "Cotization updated" }` (o `"Cotization updated and emailed"` / el aviso del correo).
- **`200`** `status: false`:
  - sin `id`: `"No se pudo identificar la cotización que quieres modificar. Ábrela de nuevo desde el listado."`;
  - no existe: `"Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado."`;
  - fallo de la base: `"No se pudieron guardar los cambios de la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte."`.
- Mismos `200`/`422` de cabecera y de líneas que el POST.
- **`409`** si la fila es de otro formato (una cotización de Ferretería editada con el formulario de Gratex).

### POST `/api/cotizaciones/preview` — PDF sin guardar

Cuerpo del formulario: `{ "client_id": 3511, "items": [...], "total": 3245.75 }` (sin
`date`: imprime la fecha de hoy). Solo las 3 comprobaciones de cabecera (mismos
textos, `200`); las líneas **no** se validan, como siempre. El PDF lleva el código
`PREVIEW`.

**Respuesta `200`:** `{ "status": true, "data": { "filename": "Cotizacion_Preview.pdf", "content": "<base64>", "mime_type": "application/pdf" } }`.

---

### Formato `ferreteria`

La hoja "COTIZACION MERCANCIAS" de Ferretería (FERREHERRAMIENTAS VENTURA, SRL):
líneas del catálogo (o libres), precios **sin ITBIS** (el ITBIS se suma encima, por
línea), cargos sin ITBIS, retención y abono, numeración propia `COT-000001`. El
código vive en `src/Utils/Cotizacion/FerreteriaFormato.php`; el PDF, en
`src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`. No hay envío por correo.

### POST `/api/cotizaciones` — Crear

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

| Campo | Req. | Reglas y default |
|-------|------|------------------|
| `formato` | ✅ | `"ferreteria"`. Otro valor o ausente → `409` |
| `client_id` | ✅ | Entero > 0 de un cliente que exista |
| `date` | ❌ | `YYYY-MM-DD HH:MM:SS` o `YYYY-MM-DD` (se le pone la hora actual de RD), fecha real. Ausente o `""`: ahora en POST, la guardada en PUT |
| `items` | ✅ | ≥ 1 línea (abajo) |
| `ajustes` | ❌ | Objeto (abajo). Ausente = ninguno |
| `total`, `sent_email`, `user_id` | — | **Se ignoran**: el total lo calcula el servidor y `user_id` sale del token |

**Línea (`items[]`)**

| Campo | Req. | Reglas y default |
|-------|------|------------------|
| `description` | ✅ | No vacía (se recorta), ≤ 1000 caracteres |
| `quantity` | ✅ | > 0, hasta 2 decimales, y entera si la unidad no admite fracciones |
| `amount` | ✅ | Precio unitario **sin ITBIS**, > 0, hasta 4 decimales |
| `product_id` | ❌ | `null` = línea libre. Si viene, el producto tiene que existir (no importa si está inactivo) |
| `unidad_medida` | ❌ | Código DGII (`"43"` = Unidad). Ausente o `""` = `"43"`. Se normaliza (`43`, `"043"` → `"43"`) y se valida contra el catálogo de master |
| `indicador_facturacion` | ❌ | 1 = ITBIS 18%, 2 = 16%, 3 = 0%, 4 = exento. Ausente = 1 |
| `indicador_bien_servicio` | ❌ | 1 = bien, 2 = servicio. Ausente = 1. **Con `product_id` se toma del producto** |

**Ajustes (`ajustes`)** — montos fuera de las líneas:

| Clave | Regla | En los totales |
|-------|-------|----------------|
| `cargos_bancarios` | ≥ 0, hasta 2 decimales, `null` = 0 | Se suma al TOTAL, sin ITBIS |
| `manejo_bancario` | Igual | Se suma al TOTAL, sin ITBIS |
| `mano_obra` | Igual | Se suma al TOTAL, sin ITBIS |
| `abono` | Igual, y no puede pasar de lo adeudado | Resta de lo adeudado |
| `retencion_isr` | **Booleano** (`true`/`false`; otro tipo → `422`) | `true` = 5% del Sub-total, restado de lo adeudado |

Cualquier otra clave → `422`. Solo se guardan los montos distintos de cero; la
retención se guarda como monto (`r2(Sub-total × 0.05)`) y se recalcula en cada
guardado.

**Lo que calcula el servidor** (todo redondeado a 2 decimales con
`Redondeo::r2`, igual que la pantalla):

| Monto | Regla |
|-------|-------|
| Base de la línea (`subtotal`) | `r2(r2(quantity) × r4(amount))` |
| ITBIS de la línea (`itbis_amount`) | `r2(base × tasa)`, tasa 0.18 / 0.16 / 0 / 0 |
| Sub-total RD$ (`cotizaciones.subtotal`) | Suma de las bases |
| ITBIS (`cotizaciones.itbis`) | Suma de los ITBIS de las líneas |
| TOTAL RD$ (`cotizaciones.total`) | Sub-total + ITBIS + cargos bancarios + manejo bancario + mano de obra |
| Adeudado | TOTAL − retención |
| Restante (Adeudado) | Adeudado − abono. No se guarda; el PDF lo imprime solo si hay retención o abono |

Numeración: `numero` = el mayor + 1 de la base del tenant, `code` =
`COT-` + 6 cifras (`COT-000123`). Nunca cambian al editar.

**Respuesta `200`:**

```json
{ "status": true, "data": { "id": 513, "code": "COT-000001", "numero": 1, "total": 3883.6 } }
```

### PUT `/api/cotizaciones` — Editar

El mismo cuerpo más `"id"`. Reemplaza cabecera, líneas y **todo el set de
ajustes** (sin `ajustes` = ninguno). `numero` y `code` no cambian. Sin `date` (o
`""`) conserva la fecha y hora guardadas. Responde lo mismo que el POST, con el
`code` y el `numero` de siempre.

- **`409`** si la fila es de otro formato (una de Gratex editada con el formulario de Ferretería), y también si la
  cotización ya no existe: sin fila no hay formato guardado, el servidor resuelve `gratex` y la guardia responde. Al
  recargar, la cotización ya no está en el listado.
- **`404`** `"Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado."` solo si la borran en el
  instante entre la lectura de la fila y el guardado.

### POST `/api/cotizaciones/preview` — PDF sin guardar

El mismo cuerpo que el POST, con las **mismas validaciones** (incluido el tope del
abono). Opcional `"id"`: con el id de una cotización guardada usa el formato de esa
fila e imprime su código; sin `id`, en la posición del número imprime
`VISTA PREVIA`. La fecha que imprime es la del cuerpo; si no viene, la guardada; si
tampoco, hoy.

**Respuesta `200`:** `{ "status": true, "data": { "filename": "Cotizacion_Preview.pdf", "content": "<base64>", "mime_type": "application/pdf" } }`.

### PDF (`GET /{id}/pdf` y preview)

Carta vertical, Times: logo, dirección, RNC del emisor, `COTIZACIÓN MERCANCÍAS`,
fecha (`SEPTIEMBRE 2/2026.-`), número, cliente (razón social, si no nombre de la
empresa, si no nombre) y su RNC con guiones, tabla `Cantidad | Descripción
mercancías | Valor Unitario | Valor Total RD$`, la marca "No hay más productos
debajo de la línea", los totales (solo las filas con valor; Sub-total, ITBIS y TOTAL
siempre), "Recibido por:" y el pie con la razón social, el correo y el teléfono de
`emisor_config`. Detalle en
[../modules/cotizaciones-formatos.md](../modules/cotizaciones-formatos.md#el-pdf-de-ferretería).

El PDF guardado recalcula los totales desde las líneas y los ajustes guardados, con
las mismas reglas: lo impreso coincide con lo que se guardó.

### Errores de Ferretería

Todos con `status: false`. `N` es el número de la línea como la ve el usuario (desde 1).

| HTTP | `error` |
|------|---------|
| 422 | `Elige un cliente para la cotización.` (sin `client_id`, no es entero > 0, o el cliente no existe) |
| 422 | `La fecha no es válida.` |
| 422 | `Agrega al menos una línea a la cotización.` |
| 422 | `La línea N no es válida. Quítala y vuelve a agregarla.` |
| 422 | `La línea N no tiene descripción. Escríbela o quita esa línea.` |
| 422 | `La descripción de la línea N es muy larga: admite hasta 1000 caracteres.` |
| 422 | `La unidad de medida de la línea N no es válida. Elige otra unidad en esa línea.` |
| 422 | `Línea N: la cantidad debe ser mayor que 0.` |
| 422 | `Línea N: la unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.` |
| 422 | `Línea N: la cantidad admite hasta 2 decimales.` |
| 422 | `El precio de la línea N no es válido. Revísalo.` |
| 422 | `Línea N: el precio debe ser mayor que 0.` |
| 422 | `Línea N: el precio admite hasta 4 decimales.` |
| 422 | `Línea N: el tipo de ITBIS no es válido. Elige 18%, 16%, 0% o exento.` |
| 422 | `Línea N: elige si es un bien o un servicio.` |
| 422 | `Línea N: el producto no es válido. Búscalo de nuevo o déjala como línea libre.` (`product_id` no es entero > 0) |
| 422 | `Línea N: el producto ya no existe en el catálogo. Búscalo de nuevo o déjala como línea libre.` |
| 422 | `Un producto de la cotización ya no existe en el catálogo (lo eliminaron mientras la editabas). Búscalo de nuevo o quita la línea.` (lo borraron entre la revisión y el guardado) |
| 422 | `Los cargos y abonos de la cotización no son válidos. Revísalos.` (`ajustes` no es objeto) |
| 422 | `Los cargos y abonos traen un concepto que este formato no conoce («descuento»).` |
| 422 | `«Costo mano de obra» no es un monto válido. Revísalo.` / `… no puede ser negativo.` / `… admite hasta 2 decimales.` (lo mismo para «Cargos bancarios», «Manejos de operaciones bancarias» y «Abono realizado») |
| 422 | `La casilla «Retención Renta por Tercero 5%» no es válida: tiene que ser sí o no.` |
| 422 | `El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80).` |
| 404 | `Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado.` (PUT, si la borran mientras se guarda) |
| 409 | `La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.` |
| 500 | `No se pudo revisar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.` (no se pudo leer el cliente o los productos) |
| 500 | `No se pudo guardar la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.` / `No se pudieron guardar los cambios de la cotización. …` |
| 500 | `Otra cotización se guardó al mismo tiempo. Vuelve a guardar.` (el número chocó dos veces seguidas) |
| 500 | `No se pudo generar el PDF de la cotización. Inténtalo de nuevo y, si sigue pasando, avisa a soporte.` |

---

### DELETE `/api/cotizaciones` — Eliminar (todos los formatos)

Body: `{ "id": 513 }`. Borra la cotización; sus líneas y sus ajustes se van con ella
(`ON DELETE CASCADE`). La numeración de Ferretería es el mayor + 1: si se borra la de
número más alto, la siguiente vuelve a usar ese número; una borrada del medio deja
el hueco.

- **`200`** `{ "status": true, "data": "Cotization deleted" }`.
- **`200`** `status: false`:
  - sin `id`: `"No se pudo identificar la cotización que quieres eliminar. Actualiza el listado e inténtalo de nuevo."`;
  - no existe: `"Esta cotización ya no existe. Puede que otra persona la haya eliminado; actualiza el listado."`.

---

### Resumen de códigos HTTP

| HTTP | Significado |
|------|-------------|
| `200` `status: true` | Éxito |
| `200` `status: false` | Gratex: errores de cabecera (cliente, líneas, total), "ya no existe" y fallos del modelo; PUT/DELETE sin `id`; DELETE de una que no existe |
| `401` | Sin token o token inválido |
| `404` | PDF de un id que no existe; PUT de Ferretería si la cotización se borra mientras se guarda |
| `409` | Guardia de formato: la pantalla está desactualizada (también un PUT con cuerpo de Ferretería sobre una cotización que ya no existe) |
| `422` | Validación: líneas de Gratex; todo el cuerpo de Ferretería |
| `500` | Ferretería: fallo al leer el cliente o los productos, al guardar o al generar el PDF |

Pruebas a mano: [../../tests/test_cotizaciones_ferreteria.http](../../tests/test_cotizaciones_ferreteria.http)
(Ferretería, los 422, el 409 y la regresión de Gratex).
````

- [ ] **Step 3: Write `docs/modules/cotizaciones-formatos.md`**

Create it with exactly this content:

````markdown
# Formatos de cotización por tenant

El módulo de cotizaciones nació con las reglas y el PDF de Gratex metidos en el
controller: cualquier tenant que cotizaba lo hacía con el formulario, los totales,
la numeración aleatoria y el PDF de Gratex (incluida su cuenta bancaria). Ferretería
(FERREHERRAMIENTAS VENTURA, SRL) cotiza con otra hoja: productos del catálogo,
precios sin ITBIS, cargos, retención, abono y un consecutivo.

La solución es un **formato de cotización por tenant**: un ajuste en
`master.tenants` y, en cada lado, un módulo de código por formato. Un tenant nuevo
con su propia hoja es **un formato más**, no una copia del módulo.

Formatos de hoy:

| Clave | Tenant | Qué es |
|-------|--------|--------|
| `gratex` | Gratex y todo tenant sin otro ajuste (default) | El comportamiento de siempre, sin cambios |
| `ferreteria` | Ferretería | Hoja "COTIZACION MERCANCIAS": líneas del catálogo, ITBIS por línea, cargos, retención 5%, abono, `COT-000001` |

Referencia de la API (cuerpos, respuestas, errores): [../api/cotizaciones.md](../api/cotizaciones.md).

---

### Piezas

### Backend (`api-gratex`)

| Archivo | Qué hace |
|---------|----------|
| `src/Controllers/cotizacionController.php` | Decodifica el cuerpo una vez, elige el formato, aplica la guardia `409`, llama al formato, escribe la auditoría y envuelve la respuesta. No tiene reglas de ningún formato |
| `src/Utils/Cotizacion/CotizacionFormato.php` | Clase abstracta: el contrato de un formato |
| `src/Utils/Cotizacion/CotizacionFormatos.php` | Registro `FORMATOS` (clave → clase), `para()`, `delTenant()`, `delCuerpo()` |
| `src/Utils/Cotizacion/GratexFormato.php` | Las ramas de siempre del controller, movidas tal cual |
| `src/Utils/Cotizacion/FerreteriaFormato.php` | Reglas puras (totales, validación, número, RNC, fecha) + crear/editar/vista previa/PDF |
| `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php` | Renderizador FPDF puro de la hoja de Ferretería |
| `src/Utils/Cotizacion/Redondeo.php` | Redondeo igual en PHP 8.3 y 8.5 (copia de `montosLinea.redondear` del front) |
| `src/Models/cotizacionModel.php` | Lecturas comunes + `crearConFormato` / `actualizarConFormato` (numeración, cabecera, líneas y ajustes en una transacción) |
| `tools/test_cotizacion_ferreteria.php` | Pruebas por CLI, sin DB (`--pdf [--grid]` escribe los PDF de muestra) |
| `tools/fixtures/cotizacion_ferreteria.json` | Las 3 hojas del Excel línea por línea, casos de borde y totales esperados |
| `tests/test_cotizaciones_ferreteria.http` | Pruebas a mano contra un servidor |

No hay autoloader: cada archivo hace `require_once` de lo que usa, y
`CotizacionFormatos::para()` carga la clase del formato solo cuando se usa (una
petición de Gratex no carga el código ni el PDF de Ferretería).

### Frontend (`fiscalo`)

| Archivo | Qué hace |
|---------|----------|
| `src/features/cotizaciones/formatos/index.ts` | Registro `FORMATOS`, `esFormato`, `formatoDeFila`, `useCotizacionFormato()` (lee `cotizacion_formato` de `GET /api/branding`) |
| `src/features/cotizaciones/formatos/CotizacionEditor.tsx` | Elige el formulario: el de la empresa para una nueva, el de la fila para una existente |
| `src/features/cotizaciones/CotizacionFormView.tsx` | El formulario de Gratex (sin cambios) |
| `src/features/cotizaciones/formatos/ferreteria/` | `FerreteriaCotizacionForm.tsx`, `totales.ts` (misma cuenta que el PHP), `schema.ts` (Zod), `conversion.ts` (Facturar) |
| `scripts/parity-cotizacion-ferreteria.ts` | Corre `totalesFerreteria()` sobre la copia del fixture del backend |

### Datos

- **`master.tenants.cotizacion_formato`** (master_migration 011): `VARCHAR(40) NOT NULL
  DEFAULT 'gratex'`. Se cambia solo por SQL; `GET /api/branding` lo devuelve (solo
  lectura). Sin la columna (011 sin correr) todo tenant es `gratex`, porque
  `TenantResolver` lee los tenants con `SELECT *`.
- **Tenant migration 026** (`db/migrations/026_cotizaciones_formatos.sql`):
  - `cotizaciones`: `formato` (`NULL` = gratex), `numero` (`UNIQUE
    uk_cotizaciones_numero`, `NULL` en Gratex), `subtotal`, `itbis`; además corrige
    la deriva del snapshot (`user_id`, `updated_at`, `client_name` nullable).
  - `cotizacion_items`: `product_id` (FK `cotizacion_items_product_fk` a `products`,
    `ON DELETE SET NULL`), `unidad_medida`, `indicador_facturacion`,
    `indicador_bien_servicio`, `itbis_amount`. `NULL` = línea al estilo Gratex.
  - `cotizacion_ajustes` (`cotizacion_id`, `concepto`, `monto`; `UNIQUE (cotizacion_id,
    concepto)`; `ON DELETE CASCADE`): los montos fuera de las líneas. **Cada formato
    declara qué conceptos acepta**; solo se guardan los distintos de cero.

Esquema completo: [../database/schema.md](../database/schema.md).

---

### Cómo se elige el formato

| Petición | Formato | Por qué |
|----------|---------|---------|
| `POST /api/cotizaciones` | El de la empresa (`CotizacionFormatos::delTenant()`) | Una cotización nueva nace con el formato actual |
| `PUT /api/cotizaciones` | El de la fila (`cotizaciones.formato`, `NULL` = gratex). La fila se lee primero; si ya no existe, `gratex` (que responde su "ya no existe"; un cuerpo de otro formato recibe el `409`) | Cambiar el ajuste de la empresa no reinterpreta las guardadas |
| `POST /api/cotizaciones/preview` | El de la fila si el cuerpo trae `id` de una que existe; si no, el de la empresa | La vista previa de una guardada imprime su código |
| `GET /api/cotizaciones/{id}/pdf` | El de la fila | Una de Gratex sale siempre con el PDF de Gratex |
| `GET` (lista y `?id=`), `DELETE` | Ninguno: código común del modelo | — |

Un nombre desconocido o `NULL` (en la fila o en el tenant) cae en `gratex` y deja una
línea en el log (`[cotizaciones] formato desconocido ...`).

**Guardia `409`.** Cada formulario manda el formato con que se armó el cuerpo
(Ferretería: `"formato": "ferreteria"`; Gratex: nada, que es `gratex`). Si no coincide
con el que resolvió el servidor, el controller responde `409` ("La pantalla de
cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la
página.") y no guarda nada. Sin ella, una pestaña abierta antes del cambio guardaría
precios con ITBIS incluido (Gratex) con reglas que le suman el ITBIS encima
(Ferretería). El front muestra el mensaje con un botón "Recargar".

---

### El contrato `CotizacionFormato`

Todos los métodos devuelven `['success', $payload]` o `['error', string $mensaje, int $http]`.
El mensaje lo lee el usuario; el detalle técnico va al `error_log`. `$body` es el
`stdClass` del cuerpo (las líneas siguen siendo objetos).

| Método | Qué hace | `$payload` |
|--------|----------|------------|
| `nombre(): string` | La clave (`'gratex'`, `'ferreteria'`) | — |
| `crear(object $body)` | Validar, calcular, numerar y guardar | Lo que va en `data` |
| `actualizar(array $row, object $body)` | Lo mismo sobre la fila existente; número y código no cambian | Lo que va en `data` |
| `preview(object $body, ?array $row)` | Validar y calcular sin guardar | Los bytes del PDF |
| `pdf(array $cotizacion)` | El PDF de la fila de `getCotizaciones()` (con `items` y `ajustes`) | Los bytes del PDF |
| `permiteCorreo(): bool` | Si el formulario ofrece "Enviar por correo" (default `false`) | — |

`$http` es el código de la respuesta: Gratex usa `200` en sus errores de cabecera y
de guardado (su pantalla lo espera así) y `422` en los de línea; Ferretería usa `422`
para validación, `404` cuando la cotización desaparece mientras se guarda y `500` para
fallos de la base o del PDF. El controller aplica `$http` con `http_response_code()`
salvo cuando es `200`.

### Lecturas que no rompen a Gratex

- **Líneas con `SELECT *`.** `getCotizacionItems` no nombra columnas
  (`SELECT * FROM cotizacion_items WHERE cotizacion_id = :cotizacion_id ORDER BY id ASC`):
  las de la 026 salen cuando existen. Nombrarlas en una base sin la 026 haría fallar
  la consulta, el `catch` devolvería `[]` y una cotización se vería sin líneas;
  guardarla así borraría las de verdad.
- **Ajustes solo para formatos que los usan.** `getAjustes()` tiene su propio
  `try/catch` (loguea y devuelve `[]`) y solo corre para filas con `formato` distinto
  de `NULL`/`gratex`. Las de Gratex reciben `{}` sin consulta: una base sin
  `cotizacion_ajustes` nunca vacía el listado de Gratex, ni da `404` a su PDF, ni hace
  que el PUT diga "ya no existe".
- **`ajustes` siempre es un objeto** en el JSON (`(object)`): `{}` y no `[]`.
- **Orden del listado:** `date DESC, id DESC`.

---

### Gratex

`GratexFormato` es el código que tenían las ramas POST, preview, PUT y PDF del
controller, **movido tal cual**: mismas validaciones en el mismo orden, mismos textos
(`COT_*` y `cotValidarItems()` siguen en el controller), mismos códigos, las mismas
llamadas a `cotizacionModel::saveCotizacion` / `updateCotizacion` (sin tocar, con el
envío por correo adentro) y el mismo `CotizacionPdfGenerator`. Código aleatorio de 3
letras + 3 dígitos. No usa `Redondeo`. Es el único formato con correo
(`permiteCorreo() = true`).

### Ferretería

### Totales

El servidor los calcula e ignora cualquier `total` del cuerpo; la pantalla corre la
misma cuenta (`totalesFerreteria()` en `ferreteria/totales.ts`) y las dos dan lo mismo
al centavo. Todo monto, cada suma incluida, va con `Redondeo::r2`.

| Fila | Regla |
|------|-------|
| Base de la línea | `r2(r2(cantidad) × r4(precio sin ITBIS))` |
| ITBIS de la línea | `r2(base × tasa)`; tasa 0.18 / 0.16 / 0 / 0 para el indicador 1 / 2 / 3 / 4 |
| **Sub-total RD$** | `r2(Σ bases)` |
| **ITBIS** | `r2(Σ ITBIS de las líneas)`. Rótulo `ITBIS 18%` si todo lo gravado va al 18%; si no, `ITBIS` |
| + Cargos bancarios, + Manejos de operaciones bancarias, + Costo mano de obra | Montos tecleados, ≥ 0, sin ITBIS |
| **TOTAL RD$** | `r2(Sub-total + ITBIS + cargos + manejo + mano de obra)` |
| − Retención Renta por Tercero 5% | Casilla; si está marcada, `r2(Sub-total × 0.05)`, recalculada en cada guardado |
| Adeudado | `r2(TOTAL − retención)` |
| − Abono realizado | Tecleado, ≥ 0, y `abono ≤ adeudado` (comparando los redondeados) |
| **Restante (Adeudado)** | `r2(adeudado − abono)`. No se guarda; se muestra solo si hay retención o abono |

Con precios en pesos enteros (las 3 hojas del Excel) la suma del ITBIS por línea da
lo mismo que el 18% del Sub-total de la hoja: 41,860.00 / 7,534.80 / 49,394.80,
27,278.00 / 4,910.04 / 32,188.04 y 8,260.00 / 1,486.80 / 9,746.80. Con centavos
puede diferir en uno; se eligió por línea porque es lo que hace el e-CF.

### Validación

`FerreteriaFormato::validarForma()` revisa la forma y los rangos del cuerpo sin DB
(las reglas de unidades llegan inyectadas). Después, `aplicarCatalogo()` aplica lo que
contestó la base: que el cliente exista, que cada producto exista (bien/servicio sale
del producto, no de la pantalla), los totales y el tope del abono. Ambas son puras y
las prueba el CLI. Los textos de cada `422` están en
[../api/cotizaciones.md](../api/cotizaciones.md#errores-de-ferretería).

### Numeración

`cotizacionModel::crearConFormato()`:

1. Toma `GET_LOCK(CONCAT(DATABASE(), ':cotizacion_seq'), 5)` (copia privada de los
   helpers de `facturaModel`). Si está ocupado o falla, lo loguea y sigue sin candado,
   como las facturas simples.
2. `beginTransaction`, y dentro `SELECT COALESCE(MAX(numero), 0) + 1`;
   `code = FerreteriaFormato::codigo(numero)` (`COT-000123`).
3. Inserta la cabecera (`formato`, `numero`, `code`, `date`, `client_id`,
   `client_name`, `subtotal`, `itbis`, `total`, `user_id`), las líneas y los ajustes,
   y hace commit.
4. Si el número choca con `uk_cotizaciones_numero` (`1062`): `rollBack` y **un**
   reintento en una transacción nueva, que vuelve a leer el `MAX`. Cualquier otro
   error no se reintenta (`1452`, un producto borrado entretanto, responde un `422`
   que se entiende).
5. En `finally`, suelta el candado si lo tomó.

Editar nunca cambia `numero` ni `code`. `client_name` guarda la razón social del
cliente (si no, el nombre de la empresa, si no, el nombre), recortada a 100.
`user_id` sale del token (`RequestContext::userId()`), nunca del cuerpo.

### Ajustes

Conceptos de Ferretería: `cargos_bancarios`, `manejo_bancario`, `mano_obra`, `abono`
(montos) y `retencion_isr` (casilla en el cuerpo, monto en la base). Un PUT reemplaza
el set completo. En el GET, `ajustes.retencion_isr` es el monto guardado; el
formulario marca la casilla si es > 0.

### El PDF de Ferretería

`FerreteriaCotizacionPdf` es puro: recibe la cotización con sus totales ya calculados,
el emisor (`EmisorConfigModel::get()`), el cliente y la ruta del logo
(`BrandingResolver::logoPath()`), y devuelve los bytes. No toca la base ni el tenant.

- Carta vertical, Times (núcleo de FPDF), texto en ISO-8859-1.
- De arriba abajo: logo centrado (caja de ~75×28 mm; sin logo, la razón social en
  negrita 16), dirección, `RNC <rnc con guiones>`, `COTIZACIÓN MERCANCÍAS`, fecha
  (`SEPTIEMBRE 2/2026.-`), el código o `VISTA PREVIA`, `NOMBRE O RAZÓN SOCIAL`, el
  cliente y su RNC/cédula con guiones.
- Tabla `Cantidad | Descripción mercancías | Valor Unitario | Valor Total RD$`, banda
  #BDD7EE, precio con `EcfDocumento::textoPrecio` (2 decimales, o hasta 4).
- La marca `***********No hay más productos debajo de la línea*****` justo después de
  la última línea, siempre en su misma página.
- Los totales en el orden de arriba; solo las filas con valor (Sub-total, ITBIS y
  TOTAL siempre).
- `Recibido por:` y el pie: razón social, correo (azul, subrayado) y
  `Teléfono <telefono>` de `emisor_config`. Cada parte solo si tiene valor.
- Saltos de página: la cabecera de la tabla se repite solo en páginas con filas; el
  bloque de totales + "Recibido por" + pie nunca se parte. `Página X de Y` solo si hay
  más de una página.
- No imprime cuenta bancaria, sello, firmas, ITBIS por línea ni unidad.

El PDF guardado (`pdf()`) recalcula los totales desde las líneas y los ajustes
guardados, con las mismas reglas (`lineasDesdeFilas`, `ajustesDesdeFilas`): el CLI
comprueba, caso por caso del fixture, que lo que se guarda y lo que se imprime dan lo
mismo.

### Facturar (en el front)

"Facturar ▾" abre la factura e-CF o la factura simple prellenada con el cliente y las
líneas ligadas a sus productos (así la factura mueve inventario). El descuento fijo
del cliente se aplica como siempre, con un aviso. Los cargos no se copian como líneas
(sale un aviso) y la retención y el abono tampoco (el pago se registra en la factura).
En factura simple, cada precio lleva su ITBIS dentro.

### Redondeo

`Redondeo::r($x, $dec)` copia `montosLinea.redondear` del front: pre-redondeo a 15
cifras (`sprintf('%.15g')`) y `round` sobre ese valor, con el signo aparte. Da lo mismo
en PHP 8.3 (producción) y 8.5: con `round()` a secas, 84.75 × 18% da 15.25 desde 8.4 y
15.26 en 8.3. Solo lo usan los formatos de `src/Utils/Cotizacion/`; Gratex y la
facturación siguen con su `round()`.

---

### Pruebas

| Qué | Cómo |
|-----|------|
| Reglas, totales contra las hojas, validación, número, PDF, modelo con una conexión falsa, registro | `php tools/test_cotizacion_ferreteria.php` (desde `api-gratex`, sin DB; termina en `N/N OK` y sale con 1 si algo falla) |
| PDF para comparar con el Excel | `php tools/test_cotizacion_ferreteria.php --pdf` (o `--grid`, con la rejilla de 10 mm) → `tools/out/` |
| Orden de las FK del snapshot y SQL dinámico de la 026, sin MySQL | `php tools/check_tenant_schema_orden.php` (`--mostrar` imprime el SQL armado) |
| Paridad del front | `node scripts/parity-cotizacion-ferreteria.ts` (desde `fiscalo`) |
| API real (crear, editar, vista previa, PDF, borrar, cada `422`, el `409`, la regresión de Gratex) | `tests/test_cotizaciones_ferreteria.http` contra un servidor con las migraciones |

El CLI nunca abre una base: el modelo se crea sin constructor y con una conexión
falsa. `crear()`, `actualizar()`, `preview()` y `pdf()` de un formato sí leen la base
(unidades, cliente, emisor), y se prueban con el `.http`.

---

### Agregar un formato para un tenant nuevo

Ejemplo: el tenant "Acme" quiere su propia hoja. La clave será `acme`.

1. **Reúne la hoja.** El archivo que usan hoy (Excel/PDF), con 2 o 3 ejemplos reales
   llenos: las líneas, los totales y cada fila extra. De ahí salen las reglas y el
   fixture.
2. **Decide si hacen falta datos nuevos.** Las líneas (`cotizacion_items`, con
   producto, unidad e indicadores) y los montos extra (`cotizacion_ajustes`, con los
   conceptos que tú declares) ya cubren la mayoría. Solo si falta algo, escribe una
   migración de tenant nueva (idempotente, como la 026) y refléjala en
   `db/tenant_schema.sql` y [../database/schema.md](../database/schema.md).
3. **Fixture.** `tools/fixtures/cotizacion_acme.json` con cada línea de los ejemplos
   y los totales esperados. El front usa una copia byte por byte.
4. **Reglas puras primero (TDD).** Crea `src/Utils/Cotizacion/AcmeFormato.php` con
   las funciones estáticas (totales, validación del cuerpo, textos del PDF) y pruébalas
   en un script CLI sin DB (`tools/test_cotizacion_acme.php`, con el mismo estilo
   `[OK  ]` / `[FALLA]` y `exit 1`). Usa `Redondeo` para todo monto.
5. **El PDF.** `src/Utils/Cotizacion/AcmeCotizacionPdf.php`, puro como
   `FerreteriaCotizacionPdf`: recibe la cotización, el emisor, el cliente y el logo, y
   devuelve los bytes. Agrega al CLI un `--pdf` para compararlo con la hoja.
6. **El contrato.** En `AcmeFormato`: `final class AcmeFormato extends
   CotizacionFormato`, `__construct(cotizacionModel $modelo)`, `nombre()` devuelve
   `'acme'`, y `crear` / `actualizar` / `preview` / `pdf` devuelven las tuplas del
   contrato. Para numerar y guardar usa `cotizacionModel::crearConFormato()` /
   `actualizarConFormato()` (pásales `'acme'` como formato y declara tus conceptos en
   `$cot['ajustes']`, con su monto bajo la misma clave en los totales). Hoy el código
   visible sale de `FerreteriaFormato::codigo()` (`COT-000001`); si Acme necesita
   otro, agrega ese parámetro al modelo en el mismo cambio. Si el formato manda
   correo, sobreescribe `permiteCorreo()`.
7. **Regístralo.** Una línea en `CotizacionFormatos::FORMATOS`:
   `'acme' => AcmeFormato::class,`. El archivo se tiene que llamar como la clase
   (`AcmeFormato.php`): `para()` lo carga por ese nombre.
8. **Frontend.** Una carpeta `src/features/cotizaciones/formatos/acme/` con su
   formulario (que mande `"formato": "acme"` en cada POST, PUT y vista previa), su
   `totales.ts` si la pantalla calcula (misma cuenta que el PHP, con
   `scripts/parity-cotizacion-acme.ts` sobre la copia del fixture) y su conversión si
   se factura. Agrega `'acme'` a `FormatoId` y a `FORMATOS` en
   `formatos/index.ts`, y sus columnas y acciones en `CotizacionesView`.
9. **Docs.** Una sección en [../api/cotizaciones.md](../api/cotizaciones.md) y una
   fila en las tablas de este documento.
10. **Despliegue.**
    1. Si hay migración: quita el módulo `cotizaciones` de los roles de Acme antes de
       correrla (si no, Acme podría guardar cotizaciones de Gratex entretanto) y córrela
       fuera de horario.
    2. Sube `api-gratex`, después `fiscalo`.
    3. Activa: `UPDATE tenants SET cotizacion_formato = 'acme' WHERE id = <id de Acme>;`
       (en el master).
    4. Prueba como Acme (crear, PDF contra la hoja, editar, Facturar si aplica) y como
       Gratex (que nada cambió). Devuelve el módulo a los roles de Acme.

### Despliegue inicial (Ferretería)

El orden importa: sin él, Ferretería podría guardar cotizaciones con el formato (y la cuenta bancaria) de Gratex.

1. **Confirmar en producción**, antes de nada:
   - `SHOW CREATE TABLE` de `cotizaciones`, `cotizacion_items` y `products` en las dos DBs de tenant: motor, tipo de
     `id`, definición de `client_name`, si existen `user_id` / `updated_at` (el paso 0 de la 026 lo muestra igual);
   - `SELECT COUNT(*) FROM cotizaciones` en la DB de Ferretería (se espera 0);
   - `id`, `pdf_template` y `logo_path` de Ferretería en `master.tenants`;
   - que la 025 está aplicada y que los roles de Ferretería tienen el módulo `cotizaciones`;
   - el `emisor_config` de Ferretería: `telefono`, `correo`, `razon_social` = `FERREHERRAMIENTAS VENTURA, SRL` y una
     `direccion` que quepa en dos líneas.
2. **Quitar el módulo `cotizaciones` de los roles de Ferretería** antes de correr la 026 (se devuelve en el paso 6).
3. **Migraciones, fuera de horario:** la master `011` una vez y la tenant `026` en cada DB de tenant, completas, antes
   de subir el código (comprobaciones M1-M5 de `tests/test_cotizaciones_ferreteria.http`).
4. **Subir `api-gratex` y después `fiscalo`.** El backend asume `gratex` y el front también si branding llega sin el
   campo; las pestañas abiertas reciben el `409` hasta que recarguen.
5. **Activar Ferretería:** `UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <id>;` en el master.
6. **Pruebas de humo:**
   - como Ferretería: crear una cotización, comparar su PDF con la hoja de Excel y Facturar a e-CF (sin emitir) y a
     factura simple;
   - como Gratex: listar, abrir, editar y guardar, vista previa, PDF y Facturar (borrador igual que antes, interruptor
     de ITBIS encendido);
   - devolver el módulo `cotizaciones` a los roles de Ferretería.

Volver atrás: ver la sección siguiente (volver a `gratex` y bajar el código).

### Cambiar el formato de un tenant (ops)

- Es solo SQL en el master: `UPDATE tenants SET cotizacion_formato = '<clave>' WHERE id = <id>;`.
  No hay pantalla para elegirlo: un formato es código hecho para un cliente.
- Las cotizaciones ya guardadas conservan su formato. Las pestañas abiertas reciben
  el `409` hasta que recarguen.
- **Volver a `gratex`** hace que las cotizaciones nuevas salgan con el PDF de Gratex
  (con su cuenta bancaria). Si hace falta, quita también el módulo `cotizaciones` de
  los roles de ese tenant hasta arreglar su formato.
- **Bajar el código de `api-gratex`** a una versión sin formatos no está soportado
  una vez que existe alguna fila con `formato = 'ferreteria'`: el código viejo las
  imprimiría con el PDF de Gratex y les quitaría los productos al editarlas.

### Fuera de alcance (pendientes)

- El envío por correo para Ferretería (el correo por tenant ya existe en `TenantMail`).
- Ofrecer E45 Gubernamental en la factura e-CF.
- Un estado "facturada" o un enlace de la factura a su cotización.
- Una pantalla para elegir el formato.
- La vista previa de cotización en `/api/branding/preview` y `plantillas.php`.
- `custom:ferreventura` falla los chequeos `custom:tenant<id>` de `PUT /api/branding`.
- Las consultas N+1 del listado de cotizaciones.
````

- [ ] **Step 4: `docs/README.md` — add both docs to the map**

Re-read lines 22-53. Two Edits, in this order (line numbers before the first one; each matches on its text).

Edit 1 (`:28`, api table). old_string:

```
| [api/facturas-simples.md](api/facturas-simples.md) | Facturas NO electrónicas (sin e-CF) |
```

new_string:

```
| [api/facturas-simples.md](api/facturas-simples.md) | Facturas NO electrónicas (sin e-CF) |
| [api/cotizaciones.md](api/cotizaciones.md) | Cotizaciones: endpoints y los dos formatos (Gratex, Ferretería): cuerpos, totales, numeración y errores 200/404/409/422 |
```

Edit 2 (`:48`, modules table). old_string:

```
| [modules/branding-plantillas.md](modules/branding-plantillas.md) | Plantillas de Representación Impresa por tenant, branding, logo, diseños a la medida |
```

new_string:

```
| [modules/branding-plantillas.md](modules/branding-plantillas.md) | Plantillas de Representación Impresa por tenant, branding, logo, diseños a la medida |
| [modules/cotizaciones-formatos.md](modules/cotizaciones-formatos.md) | Formato de cotización por tenant (`tenants.cotizacion_formato`): cómo se elige, contrato, Ferretería (totales, numeración, PDF) y cómo agregar un formato para un tenant nuevo |
```

- [ ] **Step 5: `docs/integrations/alta-tenant-runbook.md` — the formato in onboarding**

Re-read lines 110-199. Four Edits, in this order (line numbers before the first one; each matches on its text).

Edit 1 (`:130-131`, Fase 4, after "Logo"). old_string:

```
**Logo:** súbelo por `public/upload_logo.php` (su token es const dentro del archivo,
hay que editarlo en el server). Sin logo propio, el PDF usa el de Gratex.
```

new_string:

````
**Logo:** súbelo por `public/upload_logo.php` (su token es const dentro del archivo,
hay que editarlo en el server). Sin logo propio, el PDF usa el de Gratex.

**Formato de cotización:** todo tenant nuevo cotiza con el formato `gratex`: el
formulario y el PDF de Gratex, con su cuenta bancaria impresa. Si el cliente tiene un
formato propio ya programado (`src/Utils/Cotizacion/`; hoy `ferreteria`), actívalo en
el master después de desplegar el código y de correr la migración 026 en su DB:

```bash
UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <tenant_id>;
```

El PDF de Ferretería imprime en el pie la `razon_social`, el `correo` y el `telefono`
de `emisor_config`, y la `direccion` en dos líneas como máximo: el `UPDATE` de
`emisor_config` de esta fase tiene que estar hecho. Si el cliente no tiene formato
propio y no debe cotizar con el de Gratex, quita el módulo `cotizaciones` de sus roles.
Cómo se agrega un formato: [../modules/cotizaciones-formatos.md](../modules/cotizaciones-formatos.md).
````

Edit 2 (`:145-146`, Fase 5). old_string:

```
3. **Emisión:** crear una factura de prueba y confirmar que el PDF trae los datos del
   cliente (no los de Gratex) y que DGII la acepta.
```

new_string:

```
3. **Emisión:** crear una factura de prueba y confirmar que el PDF trae los datos del
   cliente (no los de Gratex) y que DGII la acepta.
4. **Cotización:** `GET /api/branding` devuelve el `cotizacion_formato` esperado.
   Crear una cotización de prueba, abrir su PDF (logo, datos y pie del tenant; con un
   formato propio, sin la cuenta bancaria de Gratex) y borrarla. Pasos listos en
   `tests/test_cotizaciones_ferreteria.http`.
```

Edit 3 (`:186`, last Troubleshooting row). old_string:

```
| Clientes de prueba DGII duplicados | El schema se aplicó dos veces sobre la misma DB | `DELETE FROM clients WHERE rnc IN ('131880681','533445861');` y dejar una corrida limpia |
```

new_string:

```
| Clientes de prueba DGII duplicados | El schema se aplicó dos veces sobre la misma DB | `DELETE FROM clients WHERE rnc IN ('131880681','533445861');` y dejar una corrida limpia |
| La cotización sale con la cuenta bancaria y los textos de Gratex | El tenant sigue en `cotizacion_formato = 'gratex'` (el default) | Activar su formato (Fase 4) o quitar el módulo `cotizaciones` de sus roles |
| Al guardar una cotización: "La pantalla de cotizaciones está desactualizada…" (`409`) | Se cambió `cotizacion_formato` con la pantalla abierta, o el navegador tiene el front de antes | Recargar la página |
```

Edit 4 (`:198`, Referencia rápida). old_string:

```
| Logo | `logos/<tenant_id>.<ext>` + `tenants.logo_path` |
```

new_string:

```
| Logo | `logos/<tenant_id>.<ext>` + `tenants.logo_path` |
| Formato de cotización | `tenants.cotizacion_formato` (master; `gratex` por defecto) |
```

- [ ] **Step 6: Write `tests/test_cotizaciones_ferreteria.http`**

House style of `tests/*.http` (`###` titles with the expected result, `X-API-KEY`, one request per block; `@variables`
like `tests/test_landing.http`). Create it with exactly this content:

```http
### ============================================================================
### Cotizaciones por formato -> /api/cotizaciones
### Formato "ferreteria" (Ferreteria) y regresion del formato "gratex" (Gratex).
### Ver docs/api/cotizaciones.md y docs/modules/cotizaciones-formatos.md.
###
### Correr contra un servidor con la master 011 y la tenant 026 aplicadas (local o
### staging; en produccion solo los pasos del smoke test del despliegue). Antes:
###   - el tenant de Ferreteria con cotizacion_formato = 'ferreteria' en el master;
###   - llenar las variables de abajo (tokens del login de cada tenant, ids reales).
### Los ids de las cotizaciones salen de las respuestas de "Crear".
### ============================================================================

@base = http://localhost:8000
@tokenFerreteria = <token de sesion de un usuario de Ferreteria con el modulo cotizaciones>
@tokenGratex = <token de sesion de un usuario de Gratex con el modulo cotizaciones>
@clienteFerreteria = <id de un cliente de la DB de Ferreteria>
@productoFerreteria = <id de un producto de la DB de Ferreteria>
@clienteGratex = <id de un cliente de la DB de Gratex>
@cotFerreteria = <id que devolvio "F1 Crear">
@cotGratex = <id que devolvio "G1 Crear">

### Step 1: Login (una vez por tenant; el token va en X-API-KEY)
POST {{base}}/api/auth/login
Content-Type: application/json

{
  "emailOrUsername": "<usuario>",
  "password": "<password>"
}

###

### F0 Branding de Ferreteria -> data.cotizacion_formato = "ferreteria"
GET {{base}}/api/branding
X-API-KEY: {{tokenFerreteria}}

### F0b PUT de branding con solo cotizacion_formato (usuario que pueda editar el branding) -> 422
### "No hay cambios para guardar.": el PUT no acepta el campo, se cambia solo por SQL. F0 sigue diciendo "ferreteria".
PUT {{base}}/api/branding
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "cotizacion_formato": "gratex"
}

### ============================================================================
### Comprobaciones de servidor que no son peticiones (Tasks 2, 3, 5 y 6; anotar el resultado de cada una)
### M1 Migracion 026, DOS veces, en una DB armada con el snapshot de ANTES de la 026
###    (git show <commit de la 026>~1:db/tenant_schema.sql). 1a corrida: el paso 0 da InnoDB en las 3 tablas e id
###    int(11); E1 da 16 filas (client_name con IS_NULLABLE YES), E2 3 indices y E3 2 FKs (SET NULL y CASCADE).
###    2a corrida: cada paso ejecuta DO 0 y SHOW CREATE TABLE cotizacion_items queda igual (sin indice duplicado).
### M2 Snapshot nuevo: db/tenant_schema.sql sobre una DB vacia (o php tools/create_tenant.php contra un master de
###    prueba) termina sin errno 150/1824, y SHOW TABLES incluye cotizacion_ajustes.
### M3 Master 011 DOS veces: la 2a ejecuta DO 0; SELECT id, nombre, cotizacion_formato FROM tenants -> todos 'gratex'
###    hasta el UPDATE de Ferreteria.
### M4 Antes de la 011 (master sin la columna): G0 responde 200 con "cotizacion_formato": "gratex".
### M5 Copia de la DB de Gratex con la 026 y todavia el codigo viejo: G1 sigue devolviendo {id, code, message}.
### M6 PDF largo: una cotizacion de Ferreteria de 30+ lineas (o las 60 de largo_60 del fixture) -> la cabecera de la
###    tabla se repite solo en paginas que siguen con filas, la marca "No hay mas productos" queda en la pagina de la
###    ultima fila, totales + "Recibido por" + pie no se parten, y cada pagina dice "Pagina X de Y". Con 1 pagina no
###    sale "Pagina".
### M7 Tenant de Ferreteria sin logo (tenants.logo_path NULL): el PDF imprime la razon social en negrita arriba y
###    nunca el logo de Gratex.
### M8 Auditoria: despues de G1, G2 y G13, audit_logs tiene las filas CREATE, UPDATE y DELETE del modulo cotizaciones
###    con los mismos campos que antes del despliegue (entity_id, old_values, new_values, description).
### ============================================================================

### ============================================================================
### FERRETERIA: el camino feliz
### ============================================================================

### F1 Crear (ejemplo de la spec) -> 200 {id, code "COT-000001" (o el siguiente), numero, total 3883.6}
### Una linea de producto (bien/servicio sale del producto) y una libre sin unidad
### ni indicadores (se guarda 43, ITBIS 18%, bien). Mano de obra sin ITBIS.
### 935 x 2 = 1,870.00 + 150.00 = Sub-total 2,020.00; ITBIS 363.60; TOTAL 3,883.60.
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "date": "2026-09-02 10:15:00",
  "items": [
    { "product_id": {{productoFerreteria}}, "description": "FUNDAS CEMENTO GRIS", "quantity": 2, "amount": 935,
      "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1 },
    { "product_id": null, "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 }
  ],
  "ajustes": { "cargos_bancarios": 0, "manejo_bancario": 0, "mano_obra": 1500, "abono": 0, "retencion_isr": false }
}

### F2 Crear la hoja "cotizacion pintura" con retencion y abono -> 200, total 49394.8
### Sub-total 41,860.00 / ITBIS 7,534.80 / TOTAL 49,394.80; retencion 2,093.00;
### abono 10,000.00 -> Restante (Adeudado) 37,301.80 en el PDF. total, sent_email y
### user_id del cuerpo se ignoran (el total lo calcula el servidor).
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "date": "2026-05-14",
  "total": 1,
  "sent_email": true,
  "user_id": 999,
  "items": [
    { "product_id": null, "description": "GALONES DE PINTURA BLNACA SEMIGLOSS", "quantity": 7, "amount": 2000 },
    { "product_id": null, "description": "LLAVES DE LAVAMANOS PICO LARGO", "quantity": 2, "amount": 970 },
    { "product_id": null, "description": "MANGUERAS DE LAVAMANOS", "quantity": 2, "amount": 275 },
    { "product_id": null, "description": "BROCHAS No.4", "quantity": 2, "amount": 160 },
    { "product_id": null, "description": "FUNDAS CEMENTO GRIS", "quantity": 2, "amount": 935 },
    { "product_id": null, "description": "FUNDA CEMENTO BLANCO", "quantity": 1, "amount": 2380 },
    { "product_id": null, "description": "CUBETA DE PINTURA SEMIGLOSS 966", "quantity": 2, "amount": 10400 }
  ],
  "ajustes": { "abono": 10000, "retencion_isr": true }
}

### F3 Obtener una -> formato "ferreteria", numero (entero), subtotal "2020.00",
### itbis "363.60", total "3883.60", ajustes {"mano_obra":"1500.00"} (objeto),
### items con product_id / unidad_medida "43" / indicadores / itbis_amount "336.60" y "27.00".
GET {{base}}/api/cotizaciones?id={{cotFerreteria}}
X-API-KEY: {{tokenFerreteria}}

### F4 Listado -> orden date DESC, id DESC; cada fila con "ajustes" como objeto
GET {{base}}/api/cotizaciones?page=1&pageSize=10
X-API-KEY: {{tokenFerreteria}}

### F5 Buscar por codigo: "COT-000001" y "000001" encuentran la misma
GET {{base}}/api/cotizaciones?page=1&pageSize=10&query=000001
X-API-KEY: {{tokenFerreteria}}

### F6 Editar SIN date -> 200 con el mismo code y numero; la fecha guardada no cambia
### (repetir F3: date sigue "2026-09-02 10:15:00"). Sin "ajustes" = ninguno: la mano
### de obra desaparece (F3: ajustes {}), total 2383.6.
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "id": {{cotFerreteria}},
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [
    { "product_id": {{productoFerreteria}}, "description": "FUNDAS CEMENTO GRIS", "quantity": 2, "amount": 935,
      "unidad_medida": "43", "indicador_facturacion": 1, "indicador_bien_servicio": 1 },
    { "product_id": null, "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 }
  ]
}

### F7 Editar con fecha de solo dia -> la fecha pasa a 2026-09-03 con la hora actual de RD
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "id": {{cotFerreteria}},
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "date": "2026-09-03",
  "items": [
    { "product_id": null, "description": "CORTE DE TUBO", "quantity": 3, "amount": 150, "indicador_facturacion": 4 }
  ],
  "ajustes": { "cargos_bancarios": 100, "manejo_bancario": 50 }
}

### F8 Vista previa SIN id -> 200 base64 (Cotizacion_Preview.pdf); en el numero dice VISTA PREVIA
POST {{base}}/api/cotizaciones/preview
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [
    { "product_id": null, "description": "PRUEBA PRECIO 4 DECIMALES", "quantity": 3, "amount": 84.7458 }
  ],
  "ajustes": { "mano_obra": 500, "retencion_isr": true }
}

### F9 Vista previa CON id -> imprime el code de esa cotizacion y su fecha guardada
POST {{base}}/api/cotizaciones/preview
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "id": {{cotFerreteria}},
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [
    { "product_id": null, "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 }
  ]
}

### F10 PDF guardado en base64 -> filename "Cotizacion_COT-00000X.pdf"; abrirlo y
### compararlo con la hoja de Excel (bloques, 4 columnas, filas de totales, pie)
GET {{base}}/api/cotizaciones/{{cotFerreteria}}/pdf?format=base64
X-API-KEY: {{tokenFerreteria}}

### F11 PDF guardado como descarga directa
GET {{base}}/api/cotizaciones/{{cotFerreteria}}/pdf
X-API-KEY: {{tokenFerreteria}}

### ============================================================================
### FERRETERIA: 422 (status:false con el texto para el usuario)
### ============================================================================

### E1 Sin client_id -> 422 "Elige un cliente para la cotización."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### E2 Cliente que no existe -> 422 "Elige un cliente para la cotización."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": 999999999,
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### E3 Sin lineas -> 422 "Agrega al menos una línea a la cotización."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": []
}

### E4 Fecha que no existe -> 422 "La fecha no es válida."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "date": "2026-02-30",
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### E5 Producto que no existe -> 422 "Línea 1: el producto ya no existe en el catálogo. Búscalo de nuevo o déjala como línea libre."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "product_id": 999999999, "description": "NO EXISTE", "quantity": 1, "amount": 150 } ]
}

### E6 Unidad que no esta en el catalogo -> 422 "La unidad de medida de la línea 1 no es válida. Elige otra unidad en esa línea."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150, "unidad_medida": "999" } ]
}

### E7 Fraccion en "Unidad" (43) -> 422 "Línea 1: la unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad."
### (con la master 010 aplicada; sin ella la regla no bloquea)
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "FUNDAS CEMENTO GRIS", "quantity": 1.5, "amount": 935, "unidad_medida": "43" } ]
}

### E8 Precio con 5 decimales -> 422 "Línea 1: el precio admite hasta 4 decimales."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 84.74581 } ]
}

### E9 Indicador de ITBIS fuera de 1-4 -> 422 "Línea 1: el tipo de ITBIS no es válido. Elige 18%, 16%, 0% o exento."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150, "indicador_facturacion": 5 } ]
}

### E10 Concepto de ajuste desconocido -> 422 "Los cargos y abonos traen un concepto que este formato no conoce («descuento»)."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ],
  "ajustes": { "descuento": 10 }
}

### E11 Retencion que no es booleano -> 422 "La casilla «Retención Renta por Tercero 5%» no es válida: tiene que ser sí o no."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ],
  "ajustes": { "retencion_isr": 1 }
}

### E12 Mano de obra negativa -> 422 "«Costo mano de obra» no puede ser negativo."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ],
  "ajustes": { "mano_obra": -1 }
}

### E13 Abono mayor que lo adeudado -> 422 "El abono (RD$ 200.00) no puede ser mayor que lo adeudado (RD$ 177.00)."
### (150.00 + ITBIS 27.00 = 177.00). La vista previa responde el mismo 422.
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ],
  "ajustes": { "abono": 200 }
}

### E14 Abono exacto al centavo (13.70 + 2.47 = 16.17; retencion 0.69; abono 15.48) -> 200, Restante 0.00
POST {{base}}/api/cotizaciones/preview
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "PRUEBA FLOTANTE", "quantity": 1, "amount": 13.70 } ],
  "ajustes": { "abono": 15.48, "retencion_isr": true }
}

### ============================================================================
### 409: guardia de formato (no guarda nada)
### "La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página."
### ============================================================================

### X1 Ferreteria con un cuerpo de Gratex (sin "formato") -> 409
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "amount": 177, "quantity": 1, "subtotal": 177 } ],
  "total": 177,
  "date": "2026-10-01 10:15:00",
  "sent_email": false
}

### X2 Vista previa de Ferreteria con un cuerpo de Gratex -> 409
POST {{base}}/api/cotizaciones/preview
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "amount": 177, "quantity": 1, "subtotal": 177 } ],
  "total": 177
}

### X3 Gratex con un cuerpo de Ferreteria -> 409
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "formato": "ferreteria",
  "client_id": {{clienteGratex}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### X4 Editar una cotizacion de Gratex con un cuerpo de Ferreteria -> 409 (la fila manda)
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "id": {{cotGratex}},
  "formato": "ferreteria",
  "client_id": {{clienteGratex}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### ============================================================================
### FERRETERIA: borrar (al final, sobre las cotizaciones de prueba)
### ============================================================================

### D1 Eliminar -> 200 "Cotization deleted"; sus lineas y ajustes se van con ella
DELETE {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "id": {{cotFerreteria}}
}

### D2 PDF de la borrada -> 404 "No encontramos esta cotización. Puede que la hayan eliminado; actualiza el listado."
GET {{base}}/api/cotizaciones/{{cotFerreteria}}/pdf?format=base64
X-API-KEY: {{tokenFerreteria}}

### D3 Editar la borrada con el cuerpo de Ferreteria -> 409 (sin fila no hay formato guardado: el servidor
### resuelve gratex y la guardia responde; nada se guarda)
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenFerreteria}}
Content-Type: application/json

{
  "id": {{cotFerreteria}},
  "formato": "ferreteria",
  "client_id": {{clienteFerreteria}},
  "items": [ { "description": "CORTE DE TUBO", "quantity": 1, "amount": 150 } ]
}

### ============================================================================
### GRATEX: regresion (mismo status, sobre y data que antes del cambio)
### Los cuerpos son EXACTAMENTE los que manda fiscalo CotizacionFormView.tsx:
### crear = {client_id, items[{description, amount, quantity, subtotal}], total,
### date, user_id, sent_email}; editar = {id, ...lo mismo}; vista previa =
### {client_id, items, total} (sin date). Correr cada uno antes y despues del
### despliegue y comparar; solo pueden cambiar las claves nuevas del GET.
### ============================================================================

### G0 Branding de Gratex -> data.cotizacion_formato = "gratex"
GET {{base}}/api/branding
X-API-KEY: {{tokenGratex}}

### G1 Crear -> 200 {id, code (3 letras + 3 digitos), message "Cotization saved"}
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [
    { "description": "Banner 3x2 full color", "amount": 2360, "quantity": 1, "subtotal": 2360 },
    { "description": "Instalacion", "amount": 590.5, "quantity": 1.5, "subtotal": 885.75 }
  ],
  "total": 3245.75,
  "date": "2026-10-01 10:15:00",
  "user_id": 4,
  "sent_email": false
}

### G2 Editar -> 200 "Cotization updated"
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "id": {{cotGratex}},
  "client_id": {{clienteGratex}},
  "items": [
    { "description": "Banner 3x2 full color", "amount": 2360, "quantity": 2, "subtotal": 4720 },
    { "description": "Instalacion", "amount": 590.5, "quantity": 1.5, "subtotal": 885.75 }
  ],
  "total": 5605.75,
  "date": "2026-10-01 11:00:00",
  "user_id": 4,
  "sent_email": false
}

### G3 Vista previa -> 200 base64 Cotizacion_Preview.pdf con el codigo PREVIEW (PDF de Gratex)
POST {{base}}/api/cotizaciones/preview
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [
    { "description": "Banner 3x2 full color", "amount": 2360, "quantity": 1, "subtotal": 2360 }
  ],
  "total": 2360
}

### G4 Obtener una -> mismas claves de siempre + formato/numero/subtotal/itbis en null,
### "ajustes": {} y, en cada linea, las columnas nuevas en null
GET {{base}}/api/cotizaciones?id={{cotGratex}}
X-API-KEY: {{tokenGratex}}

### G5 Listado -> igual que antes salvo las claves nuevas y el desempate por id
GET {{base}}/api/cotizaciones?page=1&pageSize=10
X-API-KEY: {{tokenGratex}}

### G6 PDF guardado -> el de Gratex de siempre (comparar sin /CreationDate)
GET {{base}}/api/cotizaciones/{{cotGratex}}/pdf?format=base64
X-API-KEY: {{tokenGratex}}

### G7 Sin cliente -> 200 status:false "Elige un cliente para la cotización."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "items": [ { "description": "Banner", "amount": 100, "quantity": 1, "subtotal": 100 } ],
  "total": 100
}

### G8 Sin lineas -> 200 status:false "Agrega al menos una línea a la cotización."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [],
  "total": 0
}

### G9 Total no numerico -> 200 status:false "El total de la cotización no es válido. Revisa los precios y las cantidades."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [ { "description": "Banner", "amount": 100, "quantity": 1, "subtotal": 100 } ],
  "total": "abc"
}

### G10 Linea sin descripcion -> 422 "La línea 1 no tiene descripción. Escríbela o quita esa línea."
POST {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [ { "description": " ", "amount": 100, "quantity": 1, "subtotal": 100 } ],
  "total": 100
}

### G11 Editar sin id -> 200 status:false "No se pudo identificar la cotización que quieres modificar. Ábrela de nuevo desde el listado."
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "client_id": {{clienteGratex}},
  "items": [ { "description": "Banner", "amount": 100, "quantity": 1, "subtotal": 100 } ],
  "total": 100
}

### G12 Editar una que no existe -> 200 status:false "Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado."
PUT {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "id": 999999999,
  "client_id": {{clienteGratex}},
  "items": [ { "description": "Banner", "amount": 100, "quantity": 1, "subtotal": 100 } ],
  "total": 100,
  "date": "2026-10-01 11:00:00",
  "user_id": 4,
  "sent_email": false
}

### G13 Eliminar la de prueba -> 200 "Cotization deleted"
DELETE {{base}}/api/cotizaciones
X-API-KEY: {{tokenGratex}}
Content-Type: application/json

{
  "id": {{cotGratex}}
}
```

- [ ] **Step 7: Check the links, the anchors and the `.http` bodies**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
for f in docs/api/cotizaciones.md docs/modules/cotizaciones-formatos.md docs/README.md docs/integrations/alta-tenant-runbook.md docs/database/schema.md; do
  d=$(dirname "$f")
  grep -oE '\]\([^)#]+' "$f" | sed 's/^](//' | grep -v '^http' | while read -r l; do [ -e "$d/$l" ] || echo "ROTO: $f -> $l"; done
done; echo "links revisados"
grep -n "^### Errores de Ferretería" docs/api/cotizaciones.md
grep -n "^### El PDF de Ferretería" docs/modules/cotizaciones-formatos.md
python - <<'PY'
import re, json, pathlib
txt = pathlib.Path("tests/test_cotizaciones_ferreteria.http").read_text(encoding="utf-8")
vars_ = {k: "7" for k in re.findall(r"^@(\w+) =", txt, re.M)}
n = ok = 0
for b in re.split(r"^###.*$", txt, flags=re.M):
    lineas = b.strip("\n").split("\n")
    if not re.match(r"^(GET|POST|PUT|DELETE) ", lineas[0]):
        continue
    n += 1
    cuerpo = "\n".join(lineas[lineas.index("") + 1:]).strip() if "" in lineas else ""
    if cuerpo:
        json.loads(re.sub(r"\{\{(\w+)\}\}", lambda m: vars_[m.group(1)], cuerpo)); ok += 1
usadas, declaradas = set(re.findall(r"\{\{(\w+)\}\}", txt)), set(re.findall(r"^@(\w+) =", txt, re.M))
print(n, "peticiones,", ok, "cuerpos JSON validos; sin declarar:", usadas - declaradas or "-", "; sin usar:", declaradas - usadas or "-")
PY
```

Expected: no `ROTO:` line, then `links revisados`; one hit for each heading (they back the `#errores-de-ferretería` and
`#el-pdf-de-ferretería` anchors); `49 peticiones, 38 cuerpos JSON validos; sin declarar: - ; sin usar: -` (the 48
requests of the planner's run plus F0b; the M1-M8 server checks are `###` comment lines and add no request).

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/api-gratex
git add docs/api/cotizaciones.md docs/modules/cotizaciones-formatos.md docs/README.md docs/integrations/alta-tenant-runbook.md tests/test_cotizaciones_ferreteria.http
git diff --cached --stat
git commit -F - <<'EOF'
docs(cotizaciones): API de cotizaciones, formatos por tenant y pruebas .http de Ferreteria

- docs/api/cotizaciones.md: cada endpoint, que formato atiende cada uno, la
  guardia 409, los cuerpos y respuestas de gratex y ferreteria, y cada mensaje
  de error (200/404/409/422/500).
- docs/modules/cotizaciones-formatos.md: arquitectura (registro, contrato,
  lecturas seguras, numeracion, PDF, redondeo) y el paso a paso para agregar
  el formato de un tenant nuevo.
- docs/README.md y el runbook de alta: el mapa y como activar
  tenants.cotizacion_formato.
- tests/test_cotizaciones_ferreteria.http: Ferreteria de punta a punta, cada
  422, el 409 y la regresion de Gratex con los cuerpos exactos de
  CotizacionFormView.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: `git diff --cached --stat` lists the 5 files (`docs/README.md | 2 +`, `docs/integrations/alta-tenant-runbook.md | 22 +`,
and the three new files with no deletions anywhere); one new commit.

- [ ] **Step 9: Manual server check (once the backend is deployed somewhere with 011 and 026)**

Open `tests/test_cotizaciones_ferreteria.http` in VS Code REST Client (or any `.http` runner), fill the `@` variables, and
run it top to bottom against a local or staging server (in production, only the rollout smoke test of spec section 10.6).
Each block's title says the expected status and message. Record anything that differs; it's a bug in Task 6 or 7, not in
the `.http`. Together with Task 7's manual checks, this is the evidence for spec 9.1 (Gratex unchanged) and 9.2
(`tests/test_cotizaciones_ferreteria.http`).

---

## Part F: Tasks 9 and 10


Repo: FE = `C:/Users/Signos/Documents/edwin/fiscalo`, branch `feat/cotizacion-formatos`. Every command below runs from
that directory unless it says otherwise.

What the planner verified on 2026-10-01, on a scratch copy of the fiscalo tree (src, scripts, configs, with
`node_modules` linked) after applying exactly the edits below:
- `npx tsc --noEmit` passes, and with `"scripts"` in `include` it type-checks the parity script too. An injected type
  error in the script made it fail with TS2322.
- `npx eslint src scripts` passes with the **unchanged** `eslint.config.js`. Its `**/*.{ts,tsx}` block already lints
  `scripts/*.ts`, and typescript-eslint's recommended set turns `no-undef` off for TS files, so `process` needs no
  `globals.node`. The type of `process` comes from `@types/node`, which tsconfig sees because it sets no `types`.
  Decision: no ESLint change.
- `node scripts/parity-cotizacion-ferreteria.ts` (Node v25.2.1) prints `100/100 OK` and exits 0. Node strips the types
  in `totales.ts` and `montosLinea.ts`; the `import type … from '@/api'` lines are erased, so the alias is never
  resolved. Changing `TASA_RETENCION` to 0.06 made the script fail 7 checks and exit 1.
- `vite build` bundles a `.ts`-extension relative import (`./…/totales.ts`) without any config change.
- The fixture copied from Group A's Task 1 text has md5 `76da471dddcb54715fc05010df3ebe86` (25,924 bytes, LF,
  10 cases).

Things to know before starting:
- **`npm run lint` is already red on this branch, before any of this work.** It runs `eslint .`, which reaches
  `ds-bundle/_vendor/react.js` and `ds-bundle/components/general/Spinner/Spinner.d.ts` (33 errors, 27 warnings). The
  gate for these tasks is `npx eslint src scripts`. Don't "fix" ds-bundle here.
- **Line endings:** both repos have `core.autocrlf=true`. `src/api/types.ts` and `src/features/invoices/montosLinea.ts`
  are LF in the working tree; `cotizaciones.ts`, `domain.ts`, `navigation.ts`, `InvoiceFormView.tsx`, `tsconfig.json`
  and `eslint.config.js` are CRLF. Use the Edit tool with the exact text shown (it keeps each file's endings), never a
  whole-file rewrite of an existing file.
- Re-read each file right before editing it: other sessions share this checkout.
- Gratex must not change. `src/features/cotizaciones/CotizacionFormView.tsx` is never edited, and every new field is
  optional, so its calls still type-check.

---

### Task 9: API types, cotización API functions, shared `indFactFromItbis`, prefill types

**Files:**
- Modify: `src/features/invoices/montosLinea.ts` — insert after line 14 (end of `itbisRate`, lines 11-14).
- Modify: `src/features/invoices/InvoiceFormView.tsx` — line 29 (the `./montosLinea` import); delete lines 142-146
  (the module-private `indFactFromItbis` with its doc comment and the blank line after it).
- Modify: `src/api/types.ts` — `CotizacionItemRow` lines 552-559, `CotizacionRow` lines 561-572, insert after
  `CreateCotizacionInput` (lines 584-592), `BrandingData` lines 989-997.
- Modify: `src/api/cotizaciones.ts` — import lines 3-5, `createCotizacion` lines 19-21, `updateCotizacion` line 23,
  `previewCotizacion` lines 44-47.
- Modify: `src/types/domain.ts` — `FacturaPrefill` lines 142-151 (the `lineas` line is 150).
- Modify: `src/config/navigation.ts` — import line 3, `NavPayload` line 51, insert after `isFacturaPrefill`
  (lines 53-56).
- Test: a `node -e` check of the moved helper (Steps 2 and 5), then `npm run typecheck` and `npx eslint src`.

**Interfaces:**
- Consumes (existing, unchanged):
  - `IndicadorFacturacion` (`src/api/schemas/factura.ts:122`, re-exported by `src/api/types.ts:11-21` and
    `src/api/index.ts:2`), already imported by `montosLinea.ts:9` with `import type`.
  - `postJson<T>(path: string, payload: unknown): Promise<T>` and `request(...)` from `src/api/http.ts` (line 214).
- Produces (from the contract):

```ts
// src/api/types.ts
export interface AjustesFerreteria { cargos_bancarios?: number; manejo_bancario?: number; mano_obra?: number; abono?: number; retencion_isr: boolean }
export interface CotizacionFerreteriaItemInput { product_id: number | null; description: string; quantity: number; amount: number;
  unidad_medida: string; indicador_facturacion: number; indicador_bien_servicio: number }
export interface CotizacionFerreteriaInput { formato: 'ferreteria'; client_id: number; date?: string; items: CotizacionFerreteriaItemInput[]; ajustes: AjustesFerreteria }
// CotizacionRow gains: formato?: string | null; numero?: number | null; subtotal?: string | number | null; itbis?: string | number | null;
//                      ajustes?: Record<string, string | number>
// CotizacionItemRow gains: product_id?: number | null; unidad_medida?: string | null; indicador_facturacion?: number | null;
//                          indicador_bien_servicio?: number | null; itbis_amount?: string | number | null
// BrandingData gains: cotizacion_formato?: string

// src/api/cotizaciones.ts
createCotizacion(input: CreateCotizacionInput | CotizacionFerreteriaInput): Promise<{ id: number; code: string; message?: string; numero?: number; total?: number }>
updateCotizacion(input: (CreateCotizacionInput | CotizacionFerreteriaInput) & { id: number | string }): Promise<unknown>
previewCotizacion(input: Omit<CreateCotizacionInput, 'user_id' | 'sent_email'> | (CotizacionFerreteriaInput & { id?: number })): Promise<DocBase64>

// src/features/invoices/montosLinea.ts
export function indFactFromItbis(itbis: number): IndicadorFacturacion   // moved from InvoiceFormView, same body

// src/types/domain.ts
export interface FacturaPrefill {
  kind: 'factura-prefill'; clienteId: string; clienteNombre: string; origen?: string
  precioConItbis?: boolean; avisos?: string[]
  lineas: { nombre: string; cantidad: number; precio: number; prodId?: string; unidadMedida?: number; indFact?: number; tipoItem?: 'Bien' | 'Servicio' }[]
}
export interface FacturaSimplePrefill {
  kind: 'factura-simple-prefill'; clienteId: string; clienteNombre: string; origen: string; avisos?: string[]
  lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
}

// src/config/navigation.ts
export function isFacturaSimplePrefill(p: unknown): p is FacturaSimplePrefill
// NavPayload union includes FacturaSimplePrefill
```

- [ ] **Step 1: Check the branch and the working tree**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
grep -rn "function indFactFromItbis" src
```

Expected:
- `git status --short` prints nothing. If another session left uncommitted work, leave it alone and stage only this
  task's files.
- grep prints exactly `src/features/invoices/InvoiceFormView.tsx:143:function indFactFromItbis(itbis: number): IndicadorFacturacion {`.
  If the line number moved, use the new one in Step 4.

- [ ] **Step 2: Write the failing check for the shared helper**

Node loads `montosLinea.ts` directly: its only `@/` import is `import type`, which type stripping erases.

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node -e "import('./src/features/invoices/montosLinea.ts').then((m) => { if (typeof m.indFactFromItbis !== 'function') { console.log('[FALLA] montosLinea no exporta indFactFromItbis'); process.exit(1) } const r = [18, 16, 0, 8].map((t) => m.indFactFromItbis(t)).join(' '); console.log(r === '1 2 4 4' ? '[OK  ]' : '[FALLA]', 'indFactFromItbis(18, 16, 0, 8) =', r); process.exit(r === '1 2 4 4' ? 0 : 1) })"; echo "exit=$?"
```

Expected: `[FALLA] montosLinea no exporta indFactFromItbis` and `exit=1`.

- [ ] **Step 3: Export `indFactFromItbis` from `montosLinea.ts`**

In `src/features/invoices/montosLinea.ts`, find (lines 12-14):

```ts
export function itbisRate(ind: IndicadorFacturacion): number {
  return ind === 1 ? 0.18 : ind === 2 ? 0.16 : 0
}
```

and replace it with:

```ts
export function itbisRate(ind: IndicadorFacturacion): number {
  return ind === 1 ? 0.18 : ind === 2 ? 0.16 : 0
}

/**
 * Deriva el indicador desde la tasa de ITBIS del producto (18→1, 16→2, resto→exento).
 * Compartido: la factura y la cotización de Ferretería eligen el mismo
 * indicador para el mismo producto.
 */
export function indFactFromItbis(itbis: number): IndicadorFacturacion {
  return itbis === 18 ? 1 : itbis === 16 ? 2 : 4
}
```

The body is the same as in InvoiceFormView. `IndicadorFacturacion` is already imported at line 9.

- [ ] **Step 4: Make `InvoiceFormView.tsx` import it instead of defining it**

In `src/features/invoices/InvoiceFormView.tsx`, delete lines 142-146. That's this block plus the blank line after it,
so the closing `}` of the component above (line 140) is followed by one blank line and then the `nextENcf` doc comment:

```tsx
/** Deriva el indicador desde la tasa de ITBIS del producto (18→1, 16→2, resto→exento). */
function indFactFromItbis(itbis: number): IndicadorFacturacion {
  return itbis === 18 ? 1 : itbis === 16 ? 2 : 4
}

```

Then change line 29 from:

```tsx
import { montosLinea, totalesDocumento } from './montosLinea'
```

to:

```tsx
import { indFactFromItbis, montosLinea, totalesDocumento } from './montosLinea'
```

Keep the `IndicadorFacturacion` type import at lines 9-11: the file still uses it at lines 43, 58, 359 and 873.
The call site at line 326 (`indFact: indFactFromItbis(p.itbis)`) doesn't change.

- [ ] **Step 5: Run the check again**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node -e "import('./src/features/invoices/montosLinea.ts').then((m) => { if (typeof m.indFactFromItbis !== 'function') { console.log('[FALLA] montosLinea no exporta indFactFromItbis'); process.exit(1) } const r = [18, 16, 0, 8].map((t) => m.indFactFromItbis(t)).join(' '); console.log(r === '1 2 4 4' ? '[OK  ]' : '[FALLA]', 'indFactFromItbis(18, 16, 0, 8) =', r); process.exit(r === '1 2 4 4' ? 0 : 1) })"; echo "exit=$?"
grep -rn "function indFactFromItbis" src
```

Expected:
- `[OK  ] indFactFromItbis(18, 16, 0, 8) = 1 2 4 4` and `exit=0`.
- grep prints only `src/features/invoices/montosLinea.ts:21:export function indFactFromItbis(itbis: number): IndicadorFacturacion {`.

- [ ] **Step 6: Add the new columns to `CotizacionItemRow` and `CotizacionRow` (`src/api/types.ts`)**

Find (lines 557-572):

```ts
  quantity?: number | string | null
  subtotal?: number | string | null
}

export interface CotizacionRow {
  id: number
  /** Código único generado por el backend (ej. 48213AB). */
  code?: string | null
  date?: string | null
  client_id?: number | null
  client_name?: string | null
  total?: number | string | null
  /** Resumen: descripciones de los ítems unidas (lo arma el backend). */
  description?: string | null
  items?: CotizacionItemRow[]
}
```

and replace it with:

```ts
  quantity?: number | string | null
  subtotal?: number | string | null
  // Columnas de la migración 026 (formatos con catálogo, ej. Ferretería).
  // null en las líneas de Gratex y ausentes antes de la 026.
  product_id?: number | null
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida?: string | null
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion?: number | null
  /** 1 = Bien, 2 = Servicio. */
  indicador_bien_servicio?: number | null
  /** DECIMAL como string: leer con aNumero. */
  itbis_amount?: string | number | null
}

export interface CotizacionRow {
  id: number
  /** Código único generado por el backend (Gratex: ej. 48213AB; Ferretería: COT-000123). */
  code?: string | null
  date?: string | null
  client_id?: number | null
  client_name?: string | null
  total?: number | string | null
  /** Resumen: descripciones de los ítems unidas (lo arma el backend). */
  description?: string | null
  items?: CotizacionItemRow[]
  /** Formato con que se guardó. null o ausente = gratex (filas de antes de la 026). */
  formato?: string | null
  /** Consecutivo del formato Ferretería (el de `code`); null en Gratex. */
  numero?: number | null
  /** DECIMAL como string (leer con aNumero); null en Gratex. */
  subtotal?: string | number | null
  itbis?: string | number | null
  /**
   * Ajustes por concepto (cargos_bancarios, manejo_bancario, mano_obra, abono,
   * retencion_isr), montos DECIMAL como string. Siempre objeto: `{}` en Gratex;
   * una clave ausente es 0. `retencion_isr` es el monto guardado, no la casilla.
   */
  ajustes?: Record<string, string | number>
}
```

- [ ] **Step 7: Add the Ferretería input types and `BrandingData.cotizacion_formato` (`src/api/types.ts`)**

Find the end of `CreateCotizacionInput` (lines 590-592; with Step 6 applied they sit 24 lines lower):

```ts
  /** true => el backend envía la cotización por correo al cliente. */
  sent_email?: boolean
}
```

and replace it with:

```ts
  /** true => el backend envía la cotización por correo al cliente. */
  sent_email?: boolean
}

/**
 * Cargos y abonos del formato Ferretería (debajo del ITBIS). Montos ≥ 0 con
 * hasta 2 decimales; una clave ausente es 0. Cargos y mano de obra se suman al
 * TOTAL sin ITBIS; retención y abono solo bajan lo adeudado.
 */
export interface AjustesFerreteria {
  cargos_bancarios?: number
  manejo_bancario?: number
  mano_obra?: number
  abono?: number
  /** Casilla "Retención Renta 5%": el backend calcula el 5% del Sub-total en cada guardado. */
  retencion_isr: boolean
}

/** Línea del formato Ferretería: de un producto del catálogo o libre (`product_id` null). */
export interface CotizacionFerreteriaItemInput {
  product_id: number | null
  description: string
  /** Hasta 2 decimales, y solo si la unidad admite fracciones. */
  quantity: number
  /** Precio unitario SIN ITBIS (el backend suma el ITBIS encima), hasta 4 decimales. */
  amount: number
  /** Código DGII de la unidad (= unidades_medida.id), ej. '43'. */
  unidad_medida: string
  /** 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indicador_facturacion: number
  /** 1 = Bien, 2 = Servicio. Con `product_id`, el backend usa el del producto. */
  indicador_bien_servicio: number
}

/**
 * Cuerpo de POST / PUT / preview del formato Ferretería. Sin `total` ni
 * `user_id`: el backend calcula los totales y toma el usuario del token.
 * `formato` va siempre: si no es el del tenant (pantalla vieja) el backend
 * responde 409 sin guardar.
 */
export interface CotizacionFerreteriaInput {
  formato: 'ferreteria'
  client_id: number
  /** 'YYYY-MM-DD HH:MM:SS'. Ausente en PUT = se conserva la fecha guardada. */
  date?: string
  items: CotizacionFerreteriaItemInput[]
  /** Un PUT reemplaza el juego completo. */
  ajustes: AjustesFerreteria
}
```

`sent_email?: boolean` appears only once in the file (line 591 before Step 6).

Then, in `BrandingData` (originally lines 989-997, about 70 lines lower now), find:

```ts
  logo_data_uri: string | null
  available_templates: string[]
}
```

and replace it with:

```ts
  logo_data_uri: string | null
  available_templates: string[]
  /**
   * Formato de cotización del tenant ('gratex' | 'ferreteria'; master
   * tenants.cotizacion_formato). Ausente si el backend todavía no lo expone:
   * el front lo trata como 'gratex'.
   */
  cotizacion_formato?: string
}
```

`src/api/index.ts:2` already has `export * from './types'`, so the new types reach `@/api` with no other edit.

- [ ] **Step 8: Let the API functions take the Ferretería body (`src/api/cotizaciones.ts`)**

Find the import (lines 3-5):

```ts
import type {
  CotizacionRow, CreateCotizacionInput, DocBase64, ListParams, ListResult,
} from './types'
```

and replace it with:

```ts
import type {
  CotizacionFerreteriaInput, CotizacionRow, CreateCotizacionInput, DocBase64, ListParams, ListResult,
} from './types'
```

Find `createCotizacion` and the first line of `updateCotizacion` (lines 19-23):

```ts
export function createCotizacion(input: CreateCotizacionInput): Promise<{ id: number; code: string; message: string }> {
  return postJson('/api/cotizaciones', input)
}

export function updateCotizacion(input: CreateCotizacionInput & { id: number | string }): Promise<unknown> {
```

and replace it with:

```ts
/**
 * Crea una cotización en el formato del cuerpo. Gratex responde `message`;
 * Ferretería, `numero` y el `total` que calculó el backend.
 */
export function createCotizacion(
  input: CreateCotizacionInput | CotizacionFerreteriaInput,
): Promise<{ id: number; code: string; message?: string; numero?: number; total?: number }> {
  return postJson('/api/cotizaciones', input)
}

export function updateCotizacion(
  input: (CreateCotizacionInput | CotizacionFerreteriaInput) & { id: number | string },
): Promise<unknown> {
```

Find `previewCotizacion` (lines 44-47):

```ts
/** Vista previa del PDF SIN guardar la cotización. */
export function previewCotizacion(input: Omit<CreateCotizacionInput, 'user_id' | 'sent_email'>): Promise<DocBase64> {
  return postJson<DocBase64>('/api/cotizaciones/preview', input)
}
```

and replace it with:

```ts
/**
 * Vista previa del PDF SIN guardar la cotización. En Ferretería, `id` (al
 * editar) hace que el PDF salga con el formato y el código de esa fila.
 */
export function previewCotizacion(
  input: Omit<CreateCotizacionInput, 'user_id' | 'sent_email'> | (CotizacionFerreteriaInput & { id?: number }),
): Promise<DocBase64> {
  return postJson<DocBase64>('/api/cotizaciones/preview', input)
}
```

`CotizacionFormView.tsx` (lines 207, 210 and 228) keeps compiling unchanged. Its bodies have no `formato`, so they match
the `CreateCotizacionInput` member of each union, and it only reads `res.code`.

- [ ] **Step 9: Extend `FacturaPrefill` and add `FacturaSimplePrefill` (`src/types/domain.ts`)**

Find (lines 148-151):

```ts
  /** Código del documento de origen (ej. cotización) — informativo. */
  origen?: string
  lineas: { nombre: string; cantidad: number; precio: number }[]
}
```

and replace it with:

```ts
  /** Código del documento de origen (ej. cotización) — informativo. */
  origen?: string
  /**
   * Estado inicial del interruptor "Los precios incluyen ITBIS". Ausente = true
   * (cotización Gratex, precios con ITBIS); Ferretería manda false.
   */
  precioConItbis?: boolean
  /** Avisos bajo el banner de conversión (ej. cargos de la cotización que no se copiaron). */
  avisos?: string[]
  /**
   * Los campos opcionales ligan la línea al catálogo. Ausentes = línea libre
   * como hasta ahora: sin producto, unidad 43, indicador 1, 'Bien'.
   */
  lineas: {
    nombre: string
    cantidad: number
    precio: number
    prodId?: string
    /** Código DGII de la unidad (= unidades_medida.id). */
    unidadMedida?: number
    /** indicador_facturacion: 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
    indFact?: number
    tipoItem?: 'Bien' | 'Servicio'
  }[]
}

/** Borrador para precargar la factura simple (convertir una cotización de Ferretería). */
export interface FacturaSimplePrefill {
  kind: 'factura-simple-prefill'
  /** Vacío si el documento de origen no tenía cliente. */
  clienteId: string
  clienteNombre: string
  /** Código del documento de origen (ej. COT-000012), para el banner. */
  origen: string
  /** Avisos bajo el banner de conversión. */
  avisos?: string[]
  /** `precio` YA incluye el ITBIS: la factura simple cobra precios finales. */
  lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
}
```

Leave `indFact` as `number`, as in the contract: `domain.ts` imports nothing from `@/api`, and Task 14 narrows it with
`as IndicadorFacturacion` when it builds the line. The Gratex `toFacturaPrefill` (`CotizacionesView.tsx:15`) still
compiles because every new field is optional.

- [ ] **Step 10: Add `isFacturaSimplePrefill` and widen `NavPayload` (`src/config/navigation.ts`)**

Change line 3 from:

```ts
import type { Factura, EcfTipo, FacturaPrefill } from '@/types/domain'
```

to:

```ts
import type { Factura, EcfTipo, FacturaPrefill, FacturaSimplePrefill } from '@/types/domain'
```

Find (lines 51-56):

```ts
export type NavPayload = Factura | EcfTipo | FacturaPrefill | NuevoSignal | FacturaSimpleRef | CotizacionRef | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
}
```

and replace it with:

```ts
export type NavPayload =
  | Factura | EcfTipo | FacturaPrefill | FacturaSimplePrefill | NuevoSignal | FacturaSimpleRef | CotizacionRef | null

/** ¿El payload es un borrador de factura (conversión de cotización)? */
export function isFacturaPrefill(p: NavPayload): p is FacturaPrefill {
  return p != null && (p as FacturaPrefill).kind === 'factura-prefill'
}

/** ¿El payload es un borrador de factura simple (conversión de cotización de Ferretería)? */
export function isFacturaSimplePrefill(p: unknown): p is FacturaSimplePrefill {
  return p != null && (p as FacturaSimplePrefill).kind === 'factura-simple-prefill'
}
```

The parameter is `unknown`, as the contract says (the sibling guards take `NavPayload`). It still narrows a `NavPayload`
argument in `App.tsx`. Nothing else switches over `NavPayload`: `useHistoryNav.ts:75-81` (`mismoDestino`) only compares
refs, so a new member needs no other edit there.

- [ ] **Step 11: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src; echo "eslint=$?"
git status --short
git diff --quiet -- src/features/cotizaciones/CotizacionFormView.tsx && echo "CotizacionFormView intacto"
```

Expected:
- `tsc=0` with no diagnostics, and `eslint=0` with no output.
- `git status --short` lists exactly these 6 files as ` M`: `src/api/cotizaciones.ts`, `src/api/types.ts`,
  `src/config/navigation.ts`, `src/features/invoices/InvoiceFormView.tsx`, `src/features/invoices/montosLinea.ts`,
  `src/types/domain.ts`.
- `CotizacionFormView intacto`.

If tsc reports `'IndicadorFacturacion' is declared but never used` in InvoiceFormView, an edit removed more than
lines 142-146. Restore it from `git diff` rather than dropping the type import.

- [ ] **Step 12: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add src/api/types.ts src/api/cotizaciones.ts src/features/invoices/montosLinea.ts src/features/invoices/InvoiceFormView.tsx src/types/domain.ts src/config/navigation.ts
git commit -F - <<'EOF'
feat(cotizaciones): tipos y API del formato Ferreteria

types.ts suma AjustesFerreteria y CotizacionFerreteriaInput (+ItemInput), las
columnas de la 026 en CotizacionRow/CotizacionItemRow y
BrandingData.cotizacion_formato. create/update/previewCotizacion aceptan el
cuerpo de Ferreteria. indFactFromItbis pasa de InvoiceFormView a montosLinea
(exportado) para que la factura y la cotizacion compartan el mapeo.
FacturaPrefill gana precioConItbis, avisos y lineas ligadas al catalogo;
nuevo FacturaSimplePrefill con isFacturaSimplePrefill en la navegacion.

Gratex no cambia: todo lo nuevo es opcional.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit on `feat/cotizacion-formatos`; `git status --short` shows nothing from this task.

---

### Task 10: `totalesFerreteria` and the parity script against the backend fixture

**Files:**
- Create: `scripts/fixtures/cotizacion_ferreteria.json`, a byte copy of api-gratex
  `tools/fixtures/cotizacion_ferreteria.json` (from BE Task 1).
- Create: `scripts/parity-cotizacion-ferreteria.ts`.
- Create: `src/features/cotizaciones/formatos/ferreteria/totales.ts` (the new folders `formatos/` and
  `formatos/ferreteria/`).
- Modify: `tsconfig.json` line 29 (`"include"`), so `npm run typecheck` also checks `scripts/`.
- Test: `node scripts/parity-cotizacion-ferreteria.ts`.

**Interfaces:**
- Consumes:
  - `montosLinea(l: LineaMontable, precioConItbis: boolean): MontosLinea` (`src/features/invoices/montosLinea.ts:74`,
    line 83 after Task 9). `LineaMontable` is `{ cant: number; precio: number; desc: number; indFact: IndicadorFacturacion }`;
    `MontosLinea.base` / `.itbis` are already rounded with r2.
  - `r2(x: number): number` (`montosLinea.ts:38`, line 47 after Task 9).
  - `IndicadorFacturacion` from `@/api`, as a type only.
  - The BE fixture from Task 1. Each case has `id`, `lineas[{quantity, description, amount, indicador_facturacion}]`,
    `ajustes{cargos_bancarios, manejo_bancario, mano_obra, abono, retencion_isr}` and `esperado`.
    - `esperado` always has `subtotal, itbis, total, retencion_isr, adeudado, abono, restante, etiqueta_itbis,
      mostrar_restante`.
    - Some cases add `cargos_bancarios, manejo_bancario, mano_obra`, `lineas[{base, itbis}]` and `error_abono` (null).
- Produces (from the contract):

```ts
// src/features/cotizaciones/formatos/ferreteria/totales.ts — value imports ONLY by relative path with .ts extension; '@/…' only `import type`
export interface LineaFerreteria { cantidad: number; precio: number; indFact: number }
export interface AjustesFerreteriaForm { cargosBancarios: number; manejoBancario: number; manoObra: number; abono: number; retencion: boolean }
export interface TotalesFerreteria { lineas: { base: number; itbis: number }[]; subtotal: number; itbis: number; cargosBancarios: number;
  manejoBancario: number; manoObra: number; total: number; retencion: number; adeudado: number; abono: number; restante: number;
  etiquetaItbis: 'ITBIS 18%' | 'ITBIS'; mostrarRestante: boolean }
export function totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria  // uses montosLinea(…, false) + r2
```

It mirrors `FerreteriaFormato::totales` (BE Task 4) operation for operation:
- per line `base = r2(r2(q) × r4(p))` and `itbis = r2(base × tasa)`;
- plain sums, rounded once at the end;
- `cargos`, `manejo` and `mano_obra` each go through r2;
- `total = r2(subtotal + itbis + cargos + manejo + manoObra)`;
- `retencion = retencion ? r2(subtotal × 0.05) : 0`;
- `adeudado = r2(total − retencion)`, `abono = r2(abono)`, `restante = r2(adeudado − abono)`;
- the label is `'ITBIS 18%'` only when at least one line has ITBIS > 0 and every such line has indicator 1;
- `mostrarRestante = retencion > 0 || abono > 0`.

- [ ] **Step 1: Check the prerequisites (Task 9 and BE Task 1 are committed)**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
git log --oneline -1 -- src/features/invoices/montosLinea.ts
grep -n "export function indFactFromItbis" src/features/invoices/montosLinea.ts
git -C C:/Users/Signos/Documents/edwin/api-gratex log --oneline -1 feat/cotizacion-formatos -- tools/fixtures/cotizacion_ferreteria.json
git -C C:/Users/Signos/Documents/edwin/api-gratex status --short -- tools/fixtures/cotizacion_ferreteria.json
node --version
```

Expected:
- fiscalo's status is clean, the last `montosLinea.ts` commit is Task 9's, and grep finds the export (line 21).
- The api-gratex `log` prints BE Task 1's commit (`… Redondeo …`).
  - **If it prints nothing, stop.** BE Task 1 hasn't landed yet and this task needs its fixture. Wait for it. Don't
    hand-write the JSON: it must be the same bytes the PHP harness tests.
- The api-gratex `status` prints nothing (the BE working copy matches what was committed).
- `node --version` is v22.18 or newer; this machine has v25.2.1. Earlier versions need `--experimental-strip-types`.

- [ ] **Step 2: Copy the backend fixture byte for byte**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
mkdir -p scripts/fixtures
cp C:/Users/Signos/Documents/edwin/api-gratex/tools/fixtures/cotizacion_ferreteria.json scripts/fixtures/cotizacion_ferreteria.json
cmp C:/Users/Signos/Documents/edwin/api-gratex/tools/fixtures/cotizacion_ferreteria.json scripts/fixtures/cotizacion_ferreteria.json && echo "copia identica"
node -e "const f = JSON.parse(require('fs').readFileSync('scripts/fixtures/cotizacion_ferreteria.json', 'utf8')); console.log(f.casos.length, f.casos.map((c) => c.id).join(','))"
```

Expected:
- `copia identica`.
- `10 pintura,pintura_retencion_abono,pintura_mano_obra,b150000049,ceramicas,redondeo_8475,flotante,mixto,exento,largo_60`.

The working copy may be CRLF if api-gratex was checked out again after Task 1. That's fine: `JSON.parse` doesn't care,
and with `autocrlf=true` git stores LF in both repos. Step 10 checks that the two committed blobs are the same object.

- [ ] **Step 3: Write the parity script (the test) before the code**

Create `scripts/parity-cotizacion-ferreteria.ts`:

```ts
// Paridad de los totales de la cotización de Ferretería: el front
// (totalesFerreteria) contra los casos que prueba el backend en
// api-gratex tools/test_cotizacion_ferreteria.php.
//
// scripts/fixtures/cotizacion_ferreteria.json es copia BYTE A BYTE de
// api-gratex tools/fixtures/cotizacion_ferreteria.json (las 3 hojas del Excel
// de Ferretería y los bordes de redondeo). Si una regla cambia de un lado y no
// del otro, este script o el del backend deja de cuadrar. Al cambiar el
// fixture se cambia allá y se vuelve a copiar.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/parity-cotizacion-ferreteria.ts
import { readFileSync } from 'node:fs'
import { totalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import type { TotalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'

interface LineaFixture { quantity: number; description: string; amount: number; indicador_facturacion: number }
interface AjustesFixture { cargos_bancarios: number; manejo_bancario: number; mano_obra: number; abono: number; retencion_isr: boolean }
interface CasoFixture { id: string; lineas: LineaFixture[]; ajustes: AjustesFixture; esperado: Record<string, unknown> }

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/cotizacion_ferreteria.json', import.meta.url), 'utf8'),
) as { casos: CasoFixture[] }

// Clave de `esperado` (snake_case, la de FerreteriaFormato::totales) → campo de TotalesFerreteria.
const CAMPOS = new Map<string, keyof TotalesFerreteria>([
  ['lineas', 'lineas'],
  ['subtotal', 'subtotal'],
  ['itbis', 'itbis'],
  ['cargos_bancarios', 'cargosBancarios'],
  ['manejo_bancario', 'manejoBancario'],
  ['mano_obra', 'manoObra'],
  ['total', 'total'],
  ['retencion_isr', 'retencion'],
  ['adeudado', 'adeudado'],
  ['abono', 'abono'],
  ['restante', 'restante'],
  ['etiqueta_itbis', 'etiquetaItbis'],
  ['mostrar_restante', 'mostrarRestante'],
])

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const calcular = (lineas: LineaFixture[], a: AjustesFixture): TotalesFerreteria =>
  totalesFerreteria(
    lineas.map((l) => ({ cantidad: l.quantity, precio: l.amount, indFact: l.indicador_facturacion })),
    {
      cargosBancarios: a.cargos_bancarios,
      manejoBancario: a.manejo_bancario,
      manoObra: a.mano_obra,
      abono: a.abono,
      retencion: a.retencion_isr,
    },
  )

// Los mismos 10 casos que el backend: un fixture vacío o a medias no pasa en silencio.
const ids = fixture.casos.map((c) => c.id).join(',')
chk(`el fixture trae los 10 casos (${ids})`, ids === [
  'pintura', 'pintura_retencion_abono', 'pintura_mano_obra', 'b150000049', 'ceramicas',
  'redondeo_8475', 'flotante', 'mixto', 'exento', 'largo_60',
].join(','))

for (const caso of fixture.casos) {
  const t = calcular(caso.lineas, caso.ajustes)
  for (const [clave, esperado] of Object.entries(caso.esperado)) {
    if (clave === 'error_abono') {
      // Mismo criterio que FerreteriaFormato::errorAbono: null = el abono no pasa de lo adeudado.
      const aceptado = t.abono <= t.adeudado
      chk(`${caso.id}: abono ${t.abono} ${esperado === null ? 'aceptado' : 'rechazado'} (adeudado ${t.adeudado})`,
        aceptado === (esperado === null))
      continue
    }
    const campo = CAMPOS.get(clave)
    if (campo === undefined) {
      chk(`${caso.id}: clave desconocida en esperado: ${clave}`, false)
      continue
    }
    // JSON compara números, textos, booleanos y las líneas {base, itbis} igual que el
    // === del backend: un centavo de diferencia (o 15.254999… contra 15.26) falla.
    const obtenido = JSON.stringify(t[campo])
    chk(`${caso.id}: ${clave} = ${JSON.stringify(esperado)} (dio ${obtenido})`, obtenido === JSON.stringify(esperado))
  }
}

// Abono mayor que lo adeudado (el mismo caso que tools/test_cotizacion_ferreteria.php, fuera del fixture).
const pintura = fixture.casos.find((c) => c.id === 'pintura')
if (pintura) {
  const t = calcular(pintura.lineas, { ...pintura.ajustes, abono: 50000 })
  chk(`pintura + abono 50000: rechazado (adeudado ${t.adeudado})`, t.abono > t.adeudado)
}

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
```

Why it's built this way:
- The output follows the BE harness style (`  [OK  ] …`, `  [FALLA] …`, `N/M OK`, exit 1 on any failure).
- An unknown `esperado` key fails, so a key the backend adds to the fixture can't be skipped in silence.
- `JSON.stringify` equality is exact, like PHP's `===`. Every value is a `redondear` result (an integer divided by
  10^dec), which is the same double as the JSON literal.

- [ ] **Step 4: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/parity-cotizacion-ferreteria.ts; echo "exit=$?"
```

Expected:
- `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Signos\Documents\edwin\fiscalo\src\features\cotizaciones\formatos\ferreteria\totales.ts' imported from C:\Users\Signos\Documents\edwin\fiscalo\scripts\parity-cotizacion-ferreteria.ts`
- `exit=1`.

- [ ] **Step 5: Implement `totales.ts`**

Create `src/features/cotizaciones/formatos/ferreteria/totales.ts`:

```ts
// Totales de la cotización de Ferretería (spec 6.2): las MISMAS reglas y
// redondeos que FerreteriaFormato::totales (api-gratex
// src/Utils/Cotizacion/FerreteriaFormato.php). La pantalla muestra esto y el
// servidor recalcula lo mismo al guardar, sin mirar lo que mande el front: si
// los dos lados no dan igual al centavo, el usuario guarda un TOTAL y el PDF
// imprime otro. Un cambio de regla va en los dos lados en el mismo cambio, y
// scripts/parity-cotizacion-ferreteria.ts corre los casos del backend.
//
// Imports de valor SOLO por ruta relativa con .ts: así `node` carga este
// archivo tal cual para el script de paridad (Node quita los tipos pero no
// resuelve el alias '@/'). Lo de '@/…' va solo como `import type`, que se
// borra; nada de enums ni otra sintaxis que no se pueda borrar.
import type { IndicadorFacturacion } from '@/api'
import { montosLinea, r2 } from '../../../invoices/montosLinea.ts'

/** Lo que importa de una línea para sus montos. */
export interface LineaFerreteria {
  cantidad: number
  /** Precio unitario SIN ITBIS, como en la hoja de Excel. */
  precio: number
  /** indicador_facturacion: 1 = 18%, 2 = 16%, 3 = 0%, 4 = exento. */
  indFact: number
}

/** Grupo "Cargos y abonos" del formulario. */
export interface AjustesFerreteriaForm {
  cargosBancarios: number
  manejoBancario: number
  manoObra: number
  abono: number
  /** Casilla "Retención Renta 5%". */
  retencion: boolean
}

export interface TotalesFerreteria {
  lineas: { base: number; itbis: number }[]
  subtotal: number
  itbis: number
  cargosBancarios: number
  manejoBancario: number
  manoObra: number
  total: number
  retencion: number
  /** TOTAL − retención: lo que el abono no puede pasar. */
  adeudado: number
  abono: number
  restante: number
  etiquetaItbis: 'ITBIS 18%' | 'ITBIS'
  /** Restante (Adeudado) solo se muestra si hubo retención o abono. */
  mostrarRestante: boolean
}

/** Retención Renta por Tercero: 5% del Sub-total, el monto antes del ITBIS. */
const TASA_RETENCION = 0.05

/**
 * Cada línea con las reglas del e-CF (montosLinea con precio SIN ITBIS y sin
 * descuento: base = r2(r2(cantidad) × r4(precio)), ITBIS por línea sobre esa
 * base) y las sumas redondeadas al final, como totalesDocumento. El descuento
 * fijo del cliente no va aquí: lo aplica la factura al convertir.
 *
 * Cargos y mano de obra se suman después del ITBIS y no lo llevan; retención
 * y abono no cambian el TOTAL, solo lo que queda por pagar.
 */
export function totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria {
  const montos = lineas.map((l) =>
    montosLinea({ cant: l.cantidad, precio: l.precio, desc: 0, indFact: l.indFact as IndicadorFacturacion }, false))
  const subtotal = r2(montos.reduce((a, m) => a + m.base, 0))
  const itbis = r2(montos.reduce((a, m) => a + m.itbis, 0))
  const cargosBancarios = r2(ajustes.cargosBancarios)
  const manejoBancario = r2(ajustes.manejoBancario)
  const manoObra = r2(ajustes.manoObra)
  const total = r2(subtotal + itbis + cargosBancarios + manejoBancario + manoObra)
  const retencion = ajustes.retencion ? r2(subtotal * TASA_RETENCION) : 0
  const adeudado = r2(total - retencion)
  const abono = r2(ajustes.abono)
  // "ITBIS 18%" solo si todo lo que lleva ITBIS va al 18%: con una línea al
  // 16%, o sin nada gravado, el rótulo no puede prometer una tasa.
  const gravadas = lineas.filter((_, i) => montos[i].itbis > 0)
  const etiquetaItbis = gravadas.length > 0 && gravadas.every((l) => l.indFact === 1) ? 'ITBIS 18%' : 'ITBIS'
  return {
    lineas: montos.map((m) => ({ base: m.base, itbis: m.itbis })),
    subtotal,
    itbis,
    cargosBancarios,
    manejoBancario,
    manoObra,
    total,
    retencion,
    adeudado,
    abono,
    restante: r2(adeudado - abono),
    etiquetaItbis,
    mostrarRestante: retencion > 0 || abono > 0,
  }
}
```

The relative path climbs `ferreteria` → `formatos` → `cotizaciones` → `features`, then goes down to
`invoices/montosLinea.ts`. App code that imports this module from inside `src` (Tasks 11-13) may write `'./totales'` or
`'@/features/cotizaciones/formatos/ferreteria/totales'`. Only files that `node` has to load need the `.ts` relative form.

- [ ] **Step 6: Run the parity script and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/parity-cotizacion-ferreteria.ts; echo "exit=$?"
```

Expected: 100 lines starting with `  [OK  ]`, for example:

```
  [OK  ] el fixture trae los 10 casos (pintura,pintura_retencion_abono,pintura_mano_obra,b150000049,ceramicas,redondeo_8475,flotante,mixto,exento,largo_60)
  [OK  ] pintura: subtotal = 41860 (dio 41860)
  [OK  ] pintura: itbis = 7534.8 (dio 7534.8)
  [OK  ] pintura: total = 49394.8 (dio 49394.8)
  ...
  [OK  ] pintura_retencion_abono: retencion_isr = 2093 (dio 2093)
  [OK  ] pintura_retencion_abono: restante = 37301.8 (dio 37301.8)
  [OK  ] pintura_mano_obra: total = 51044.8 (dio 51044.8)
  [OK  ] b150000049: itbis = 4910.04 (dio 4910.04)
  [OK  ] ceramicas: total = 9746.8 (dio 9746.8)
  [OK  ] redondeo_8475: lineas = [{"base":84.75,"itbis":15.26}] (dio [{"base":84.75,"itbis":15.26}])
  [OK  ] flotante: restante = 0 (dio 0)
  [OK  ] flotante: abono 15.48 aceptado (adeudado 15.48)
  [OK  ] mixto: etiqueta_itbis = "ITBIS" (dio "ITBIS")
  [OK  ] mixto: lineas = [{"base":100,"itbis":18},{"base":100,"itbis":0},{"base":200,"itbis":32}] (dio [{"base":100,"itbis":18},{"base":100,"itbis":0},{"base":200,"itbis":32}])
  [OK  ] exento: etiqueta_itbis = "ITBIS" (dio "ITBIS")
  [OK  ] largo_60: total = 9239.4 (dio 9239.4)
  [OK  ] pintura + abono 50000: rechazado (adeudado 49394.8)

100/100 OK
exit=0
```

If the count isn't 100, the fixture differs from Task 1's planned text (it has more or fewer `esperado` keys). That's
fine as long as there's no `[FALLA]` and the exit code is 0.

- [ ] **Step 7: Confirm the script catches a rule change, then restore it**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
F=src/features/cotizaciones/formatos/ferreteria/totales.ts
sed -i 's/const TASA_RETENCION = 0.05/const TASA_RETENCION = 0.06/' "$F"
node scripts/parity-cotizacion-ferreteria.ts | grep -E "FALLA|/[0-9]+ OK"; echo "exit=${PIPESTATUS[0]}"
sed -i 's/const TASA_RETENCION = 0.06/const TASA_RETENCION = 0.05/' "$F"
grep -c "const TASA_RETENCION = 0.05" "$F"
node scripts/parity-cotizacion-ferreteria.ts | tail -1
```

Expected:
- 7 lines starting with `  [FALLA]`: `pintura_retencion_abono` retencion_isr / adeudado / restante, `flotante`
  retencion_isr / adeudado / restante, and `flotante: abono 15.48 rechazado…`.
- `93/100 OK` and `exit=1`.
- After the restore: `1`, then `100/100 OK`.

- [ ] **Step 8: Let `npm run typecheck` check `scripts/` too**

In `tsconfig.json`, change line 29 from:

```json
  "include": ["src", "vite.config.ts"]
```

to:

```json
  "include": ["src", "scripts", "vite.config.ts"]
```

This is safe:
- `@types/node` is already a devDependency, and tsconfig sets no `types`, so `node:fs`, `process` and `import.meta.url`
  resolve.
- `allowImportingTsExtensions` is already on.
- `scripts/gen-schema.ps1` and the JSON fixture aren't TS, so tsc ignores them.

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npx tsc --noEmit --listFilesOnly | grep -E "parity-cotizacion-ferreteria|ferreteria/totales"
```

Expected: two paths, `…/fiscalo/src/features/cotizaciones/formatos/ferreteria/totales.ts` and
`…/fiscalo/scripts/parity-cotizacion-ferreteria.ts`.

**ESLint needs no change.** `eslint.config.js` already applies its `**/*.{ts,tsx}` block to `scripts/`, and
typescript-eslint's recommended set turns `no-undef` off for TS, so `process` isn't flagged under `globals.browser`.
The planner checked this with `npx eslint src scripts`, which exits 0 on the unchanged config.

- [ ] **Step 9: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
git status --short
```

Expected:
- `tsc=0` and `eslint=0`, with no diagnostics.
- `build=0`. The only warning is the existing `(!) Some chunks are larger than 500 kB after minification`. Nothing
  imports `totales.ts` yet; Task 12 adds the first app import, and Vite resolves the `.ts` relative import fine.
- `git status --short`:

```
 M tsconfig.json
?? scripts/fixtures/
?? scripts/parity-cotizacion-ferreteria.ts
?? src/features/cotizaciones/formatos/
```

Don't run `npm run lint` as the gate: `eslint .` fails today on `ds-bundle/` (see the note at the top).

- [ ] **Step 10: Commit, and confirm both repos hold the same fixture blob**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add tsconfig.json scripts/fixtures/cotizacion_ferreteria.json scripts/parity-cotizacion-ferreteria.ts src/features/cotizaciones/formatos/ferreteria/totales.ts
git commit -F - <<'EOF'
feat(cotizaciones): totales de Ferreteria y paridad con el backend

totalesFerreteria() calcula Sub-total, ITBIS, cargos, TOTAL, retencion, abono
y restante con montosLinea(..., false) y r2, con las mismas reglas que
FerreteriaFormato::totales. scripts/parity-cotizacion-ferreteria.ts corre con
node los casos del backend (copia byte a byte de
api-gratex tools/fixtures/cotizacion_ferreteria.json) y falla si un centavo no
cuadra. tsconfig incluye scripts/ para que typecheck tambien los revise.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
echo "FE $(git rev-parse HEAD:scripts/fixtures/cotizacion_ferreteria.json)"
echo "BE $(git -C C:/Users/Signos/Documents/edwin/api-gratex rev-parse feat/cotizacion-formatos:tools/fixtures/cotizacion_ferreteria.json)"
git show HEAD:scripts/fixtures/cotizacion_ferreteria.json | md5sum
```

Expected:
- One new commit.
- The `FE` and `BE` blob ids are identical.
- The md5 matches what BE Task 1 Step 10 printed for its committed blob: `76da471dddcb54715fc05010df3ebe86` if Task 1
  wrote the fixture exactly as planned.

A git warning like `LF will be replaced by CRLF` is normal with `autocrlf=true`.

---

## Part G: Tasks 11 and 12


Repo: FE = `C:/Users/Signos/Documents/edwin/fiscalo`, branch `feat/cotizacion-formatos`. Every command below runs from
that directory.

What the planner verified on 2026-10-02, on a scratch copy of the fiscalo tree (`src`, `scripts`, configs, `index.html`,
`node_modules` linked) with Group F's Task 9 and Task 10 edits applied first, then exactly the code below:
- After Task 11: `npx tsc --noEmit` exit 0, `npx eslint src` exit 0 with no output, `npm run build` exit 0 (only the
  existing "chunks are larger than 500 kB" warning). With `App.tsx` edited and the new files missing, `tsc` printed the
  TS2307 line quoted in Task 11 Step 3.
- After Task 12: `tsc` 0, `npx eslint src scripts` 0 with no output, build 0, `node scripts/test-schema-cotizacion-ferreteria.ts`
  printed `25/25 OK`. Changing `>` to `>=` in the abono rule made it fail exactly 2 checks.
- A Vite SSR render of the real modules: `FORMATOS` has both keys with function components; `formatoDeFila(null)`,
  `({formato:'xyz'})` → `gratex`; `esFormato('toString')` → false; the editor shows the skeleton while branding loads,
  the Gratex form ("Enviar por correo") when branding lacks the field, the Ferretería form when it says `ferreteria`,
  "Esta cotización ya no existe" for a `null` row.
- A static harness page (seeded TanStack cache, no API; scratch only) in the Browser pane: an existing Ferretería row
  loads its lines, number `COT-000005`, client with `RNC 401-51513-1`, retención box checked from `'2093.00'`, abono
  10000, totals 15,870.00 / 2,856.60 / 18,726.60 / −793.50 / −10,000.00 / Restante 7,933.10. Adding catalog products,
  a free line, mano de obra and abono gave the expected totals. The bodies sent were exactly `CotizacionFerreteriaInput`
  (create with `date` = day + current time; preview on edit with `id` and without `date`; PUT with `date` only after the
  day changed). A 409 replaced Save/Preview with the server message and "Recargar"; a 422 showed the server text in a
  toast. At 375 px there is no horizontal overflow.

Things to know before starting:
- **Line endings.** `src/App.tsx` is CRLF; `src/features/products/ProductoCombobox.tsx` and `src/styles/factura-doc.css`
  are LF. Use the Edit tool with the exact text shown (it keeps each file's endings). New files are written LF; with
  `core.autocrlf=true` git warns `LF will be replaced by CRLF`, which is normal.
- **Gates.** `npm run typecheck`, `npx eslint src scripts`, `npm run build`. Don't use `npm run lint` as the gate: it runs
  `eslint .` and is already red on this branch because of `ds-bundle/` (see Group F). Task 10 added `scripts` to
  tsconfig's `include`, so `npm run typecheck` also checks Task 12's test script.
- **Line numbers** are today's (`git show HEAD:<file>` on `feat/cotizacion-formatos`). Tasks 9 and 10 don't touch
  `App.tsx`, `ProductoCombobox.tsx` or `factura-doc.css`. Group H's Task 15 edits `App.tsx` lines 44 and 157-159, which
  Task 11 doesn't move.
- Re-read each file right before editing it: other sessions share this checkout.
- **Gratex must not change.** `src/features/cotizaciones/CotizacionFormView.tsx` is never edited: the registry imports
  it as is. `GastoFormModal` keeps the combobox's Costo label because the new prop defaults to false.
- **Never against production.** Browser checks belong to Task 16, against the local mock. Each task ends with the list
  Task 16 must check.

---

### Task 11: Formato registry, `CotizacionEditor` and the `App.tsx` route

**Files:**
- Create: `src/features/cotizaciones/formatos/index.ts`
- Create: `src/features/cotizaciones/formatos/CotizacionEditor.tsx`
- Create: `src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx` (provisional: it gives the
  registry a component so this task compiles on its own; Task 12 replaces the whole file)
- Modify: `src/App.tsx`, line 20 (the `CotizacionFormView` import) and lines 166-167 (the `'cotizacion-nueva'` case)
- Test: `npm run typecheck` (red, then green), `npx eslint src scripts`, `npm run build`; browser checks in Task 16.

**Interfaces:**
- Consumes:
  - From Task 9: `BrandingData.cotizacion_formato?: string` and `CotizacionRow.formato?: string | null`
    (`src/api/types.ts`).
  - Existing: `getBranding(): Promise<BrandingData>` (`src/api/branding.ts:12`), `getCotizacion(id): Promise<CotizacionRow | null>`
    (`src/api/cotizaciones.ts:13`), `useApiQuery(key, fn): { data, error: string | null, loading, fetching, reload }`
    (`src/hooks/useApiQuery.ts:35`), `CotizacionFormView({ nav, cotizacionId?: number | null })`
    (`src/features/cotizaciones/CotizacionFormView.tsx:51`, unchanged), `isCotizacionRef` (`src/config/navigation.ts:64`),
    `LoadingState`, `ErrorState`, `EmptyState`, `PageHead`, `Card`, `Btn` (`@/components/ui`).
- Produces (contract):

```ts
// src/features/cotizaciones/formatos/index.ts
export type FormatoId = 'gratex' | 'ferreteria'
export interface CotizacionFormatoUI { id: FormatoId; Form: ComponentType<{ nav: Nav; cotizacionId: number | null }> }
export const FORMATOS: Record<FormatoId, CotizacionFormatoUI>   // gratex.Form = CotizacionFormView (unchanged file)
export function esFormato(x: unknown): x is FormatoId
export function formatoDeFila(row: { formato?: string | null } | null | undefined): FormatoId   // unknown/null => 'gratex'
export function useCotizacionFormato(): { formato: FormatoId; cargando: boolean; error: string | null }
//   error is the contract's `unknown` narrowed to useApiQuery's string | null; it is non-null only when branding
//   failed AND nothing is cached (a failed background refetch with data in cache still knows the formato).
// src/features/cotizaciones/formatos/CotizacionEditor.tsx
export function CotizacionEditor({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null })
```

Behavior (spec 5.3):
- New quote: `LoadingState` while `cargando`, `ErrorState` + "Reintentar" (refetches `['branding']`) on `error`, then
  `FORMATOS[formato].Form` with `cotizacionId={null}`.
- Existing quote: exactly `useApiQuery(['cotizaciones', 'detail', id], () => getCotizacion(id))` (the same key and raw
  row as `CotizacionFormView:86-89`, nothing mapped in the queryFn). Loading → `LoadingState`; error → `ErrorState`;
  `null` → "Esta cotización ya no existe" with "Ir a cotizaciones"; otherwise `FORMATOS[formatoDeFila(row)].Form`.
- The first form chosen stays chosen: a later refetch (window focus) that fails or brings another formato doesn't swap
  the form and lose what the user typed. A real formato change is caught by the backend's 409 on save.
- `App.tsx` mounts `<CotizacionEditor key={id ?? 'nueva'} …>`, so going from quote A to "Nueva › Cotización" remounts.

- [ ] **Step 1: Check the prerequisites (Tasks 9 and 10 are committed)**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
grep -n "cotizacion_formato?: string" src/api/types.ts
grep -n "formato?: string | null" src/api/types.ts
grep -n "export function indFactFromItbis" src/features/invoices/montosLinea.ts
ls src/features/cotizaciones/formatos/ferreteria/
grep -n '"include"' tsconfig.json
grep -n "CotizacionFormView\|case 'cotizacion-nueva'" src/App.tsx
```

Expected:
- `git status --short` prints nothing. If another session left uncommitted work, leave it alone and stage only this
  task's files.
- Each `types.ts` grep prints one line, and `montosLinea.ts` prints line 21.
- `ls` prints `totales.ts` only.
- tsconfig: `  "include": ["src", "scripts", "vite.config.ts"]`.
- `App.tsx`: `20:import { CotizacionFormView } from '@/features/cotizaciones/CotizacionFormView'`,
  `166:      case 'cotizacion-nueva':` and `167:        return <CotizacionFormView nav={nav} cotizacionId={isCotizacionRef(payload) ? payload.id : null} />`.
- **If a Task 9/10 line is missing, stop**: this task needs those exact names.

- [ ] **Step 2: Point `App.tsx` at the editor (this is the failing change)**

In `src/App.tsx`, change line 20 from:

```tsx
import { CotizacionFormView } from '@/features/cotizaciones/CotizacionFormView'
```

to:

```tsx
import { CotizacionEditor } from '@/features/cotizaciones/formatos/CotizacionEditor'
```

Then find (lines 166-167):

```tsx
      case 'cotizacion-nueva':
        return <CotizacionFormView nav={nav} cotizacionId={isCotizacionRef(payload) ? payload.id : null} />
```

and replace it with:

```tsx
      // El editor elige el formulario del formato (Gratex, Ferretería…). Con
      // key: pasar de una cotización a otra, o a una nueva, monta un editor
      // limpio en vez de heredar las líneas y el aviso de salida del anterior.
      case 'cotizacion-nueva': {
        const id = isCotizacionRef(payload) ? payload.id : null
        return <CotizacionEditor key={id ?? 'nueva'} nav={nav} cotizacionId={id} />
      }
```

`'cotizacion-nueva'` stays in `VIEW_SIN_PAYLOAD` (line 69): a reload still lands on the list.

- [ ] **Step 3: Run the typecheck and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
```

Expected, exactly one diagnostic, and `tsc=2`:

```
src/App.tsx(20,34): error TS2307: Cannot find module '@/features/cotizaciones/formatos/CotizacionEditor' or its corresponding type declarations.
```

- [ ] **Step 4: Create the registry `src/features/cotizaciones/formatos/index.ts`**

It is a `.ts` file, so `react-refresh/only-export-components` (it only scans `.jsx`/`.tsx`) doesn't apply to its
hook and constants.

```ts
// Formatos de cotización por tenant (spec 2026-10-01 "formatos de
// cotización"). Cada empresa cotiza con su propio papel y sus propias reglas:
// Gratex con precios que ya traen ITBIS y su PDF de siempre; Ferretería con
// artículos del catálogo, ITBIS encima y cargos y abonos debajo del total.
//
// El formato del tenant lo decide el backend (master tenants.cotizacion_formato,
// expuesto en GET /api/branding) y el de una cotización guardada, su columna
// `formato`. Este registro solo dice qué formulario va con cada uno.
//
// Un formato nuevo: su carpeta aquí, una entrada en FORMATOS y su clase en
// api-gratex src/Utils/Cotizacion/ (CotizacionFormatos). Las pantallas
// compartidas (editor, listado) no cambian.
import type { ComponentType } from 'react'
import { getBranding } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { CotizacionFormView } from '../CotizacionFormView'
import { FerreteriaCotizacionForm } from './ferreteria/FerreteriaCotizacionForm'

export type FormatoId = 'gratex' | 'ferreteria'

export interface CotizacionFormatoUI {
  id: FormatoId
  /** Formulario de alta y edición. `cotizacionId` null = cotización nueva. */
  Form: ComponentType<{ nav: Nav; cotizacionId: number | null }>
}

export const FORMATOS: Record<FormatoId, CotizacionFormatoUI> = {
  // El formulario de siempre, sin tocar: Gratex no cambia con este registro.
  gratex: { id: 'gratex', Form: CotizacionFormView },
  ferreteria: { id: 'ferreteria', Form: FerreteriaCotizacionForm },
}

/** ¿Es un formato que esta versión del front sabe mostrar? */
export function esFormato(x: unknown): x is FormatoId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(FORMATOS, x)
}

/**
 * Formato de una cotización guardada. Las filas de antes de la migración 026
 * no traen `formato` (o lo traen en null): son de Gratex. Uno desconocido
 * (un backend más nuevo que este front) también cae en Gratex.
 */
export function formatoDeFila(row: { formato?: string | null } | null | undefined): FormatoId {
  const f = row?.formato
  return esFormato(f) ? f : 'gratex'
}

/**
 * Formato de cotización del tenant, para una cotización NUEVA y para elegir
 * las columnas del listado. Misma clave de caché que el resto de la app
 * (['branding']): si ya se pidió, no se vuelve a pedir.
 *
 * - `cargando`: todavía no hay dato. Quien llama espera; no supone Gratex,
 *   porque montar un formulario y cambiarlo por otro al llegar el dato
 *   perdería lo escrito.
 * - `formato`: 'gratex' solo si branding llegó sin el campo (backend sin
 *   desplegar) o con uno que este front no conoce.
 * - `error`: no se pudo saber el formato (branding falló y no hay nada en
 *   caché). Un refresco fallido con el dato ya en caché no cuenta: el formato
 *   se sigue sabiendo.
 */
export function useCotizacionFormato(): { formato: FormatoId; cargando: boolean; error: string | null } {
  const { data, loading, error } = useApiQuery(['branding'], getBranding)
  const crudo = data?.cotizacion_formato
  return {
    formato: esFormato(crudo) ? crudo : 'gratex',
    cargando: loading,
    error: data != null ? null : error,
  }
}
```

- [ ] **Step 5: Create the provisional `src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx`**

It only exists so the registry compiles in this commit. No tenant has `cotizacion_formato = 'ferreteria'` until ops runs
the SQL (spec 10 step 5), and Task 12 replaces the file whole right after.

```tsx
import { Btn, Card, EmptyState, PageHead } from '@/components/ui'
import type { Nav } from '@/config/navigation'

/* FISCALO — Cotización con el formato de Ferretería (spec 8.1).
   Provisional: ocupa su lugar en el registro de formatos mientras se arma el
   formulario. Ningún tenant tiene este formato activo todavía (se activa por
   SQL en master.tenants.cotizacion_formato). */
export function FerreteriaCotizacionForm({ nav }: { nav: Nav; cotizacionId: number | null }) {
  return (
    <div className="page">
      <PageHead title="Cotización" crumbs={[{ label: 'Cotizaciones', onClick: () => nav('cotizaciones') }]} />
      <Card>
        <EmptyState
          icon="file-plus"
          title="Formato de cotización en preparación"
          action={<Btn variant="secondary" icon="arrow-left" onClick={() => nav('cotizaciones')}>Ir a cotizaciones</Btn>}
        >
          El formulario de este formato todavía no está disponible.
        </EmptyState>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Create `src/features/cotizaciones/formatos/CotizacionEditor.tsx`**

```tsx
import { useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Btn, Card, EmptyState, ErrorState, LoadingState, PageHead } from '@/components/ui'
import { getCotizacion } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { FORMATOS, formatoDeFila, useCotizacionFormato, type FormatoId } from './index'

/* FISCALO — Editor de cotizaciones: elige el formulario del formato.

   Una cotización nueva se arma con el formato del tenant; una guardada, con el
   suyo (su columna `formato`), aunque el tenant haya cambiado después. Hasta
   saberlo se muestra un estado de carga: montar un formulario y cambiarlo por
   otro al llegar el dato perdería lo que el usuario ya escribió. Por lo mismo,
   una vez elegido, el formulario se queda aunque un refresco posterior falle o
   traiga otra cosa (si el formato del tenant cambió, el backend responde 409
   al guardar y el formulario pide recargar). */
export function CotizacionEditor({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null }) {
  return cotizacionId == null
    ? <EditorNueva nav={nav} />
    : <EditorExistente nav={nav} cotizacionId={cotizacionId} />
}

/** Marco de los estados previos al formulario (cargando, error, no existe). */
function Marco({ nav, children }: { nav: Nav; children: ReactNode }) {
  return (
    <div className="page">
      <PageHead title="Cotización" crumbs={[{ label: 'Cotizaciones', onClick: () => nav('cotizaciones') }]} />
      <Card>{children}</Card>
    </div>
  )
}

function EditorNueva({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const { formato, cargando, error } = useCotizacionFormato()
  // Primera decisión, y la única (ver arriba).
  const elegido = useRef<FormatoId | null>(null)
  if (elegido.current == null && !cargando && error == null) elegido.current = formato

  if (elegido.current != null) {
    const { Form } = FORMATOS[elegido.current]
    return <Form nav={nav} cotizacionId={null} />
  }
  if (cargando) return <Marco nav={nav}><LoadingState rows={6} /></Marco>
  return (
    <Marco nav={nav}>
      <ErrorState
        title="No se pudo preparar la cotización"
        onRetry={() => void queryClient.refetchQueries({ queryKey: ['branding'] })}
      >
        {error}
      </ErrorState>
    </Marco>
  )
}

function EditorExistente({ nav, cotizacionId }: { nav: Nav; cotizacionId: number }) {
  // Misma clave y el mismo dato crudo (CotizacionRow | null) que
  // CotizacionFormView: el formulario de Gratex encuentra la fila en la caché y
  // no la vuelve a pedir. Por eso aquí no se transforma nada en el queryFn.
  const detalle = useApiQuery(['cotizaciones', 'detail', cotizacionId], () => getCotizacion(cotizacionId))
  const elegido = useRef<FormatoId | null>(null)
  if (elegido.current == null && detalle.data != null) elegido.current = formatoDeFila(detalle.data)

  if (elegido.current != null) {
    const { Form } = FORMATOS[elegido.current]
    return <Form nav={nav} cotizacionId={cotizacionId} />
  }
  if (detalle.loading) return <Marco nav={nav}><LoadingState rows={6} /></Marco>
  if (detalle.error != null) {
    return (
      <Marco nav={nav}>
        <ErrorState title="No se pudo cargar la cotización" onRetry={() => void detalle.reload()}>
          {detalle.error}
        </ErrorState>
      </Marco>
    )
  }
  // El backend respondió sin fila: la borraron (otro usuario, otra pestaña) o
  // el enlace es viejo. Antes se abría una hoja en blanco que parecía lista
  // para guardar.
  return (
    <Marco nav={nav}>
      <EmptyState
        icon="file-plus"
        title="Esta cotización ya no existe"
        action={
          <Btn variant="secondary" icon="arrow-left" onClick={() => nav('cotizaciones', null, { replace: true })}>
            Ir a cotizaciones
          </Btn>
        }
      >
        Puede que alguien la haya eliminado.
      </EmptyState>
    </Marco>
  )
}
```

Notes:
- The `elegido` refs are written during render only from `null` to a value, the lazy-initialization pattern React
  allows; StrictMode's double render computes the same value.
- `EditorNueva` / `EditorExistente` are separate components so each calls only its own query: a new quote never fires
  `GET /api/cotizaciones?id=`, and an existing one never waits for branding.

- [ ] **Step 7: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
grep -rn "CotizacionFormView" src --include=*.ts --include=*.tsx | grep -v "^src/features/cotizaciones/CotizacionFormView.tsx"
git diff --quiet -- src/features/cotizaciones/CotizacionFormView.tsx && echo "CotizacionFormView intacto"
git status --short
```

Expected:
- `tsc=0` and `eslint=0`, with no diagnostics.
- `build=0`. The only warning is the existing `(!) Some chunks are larger than 500 kB after minification`.
- grep prints exactly three lines, and none is `src/App.tsx` (App no longer imports the Gratex form directly):

```
src/features/cotizaciones/formatos/CotizacionEditor.tsx:60:  // CotizacionFormView: el formulario de Gratex encuentra la fila en la caché y
src/features/cotizaciones/formatos/index.ts:17:import { CotizacionFormView } from '../CotizacionFormView'
src/features/cotizaciones/formatos/index.ts:30:  gratex: { id: 'gratex', Form: CotizacionFormView },
```
- `CotizacionFormView intacto`.
- `git status --short`:

```
 M src/App.tsx
?? src/features/cotizaciones/formatos/CotizacionEditor.tsx
?? src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
?? src/features/cotizaciones/formatos/index.ts
```

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add src/App.tsx src/features/cotizaciones/formatos/index.ts src/features/cotizaciones/formatos/CotizacionEditor.tsx src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
git commit -F - <<'EOF'
feat(cotizaciones): registro de formatos y editor que elige el formulario

formatos/index.ts registra los formatos (gratex = CotizacionFormView sin
tocar, ferreteria) con esFormato, formatoDeFila y useCotizacionFormato, que
lee el formato del tenant de GET /api/branding. CotizacionEditor arma una
cotizacion nueva con el formato del tenant y una guardada con el suyo:
espera con LoadingState, muestra ErrorState con reintento, "ya no existe"
para una fila borrada, y no cambia de formulario una vez elegido. App monta
el editor con key para que pasar de una cotizacion a otra lo limpie.

El formulario de Ferreteria es provisional; llega completo en el siguiente
commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit on `feat/cotizacion-formatos`; `git status --short` shows nothing from this task.

**For Task 16 (browser, local mock only):**
- Gratex tenant (`GET /api/branding` without `cotizacion_formato`): "Nueva cotización" shows the skeleton, then the
  unchanged Gratex form (title "Cotización", "Enviar por correo al guardar"). It never shows the Ferretería form first.
- Opening a Gratex row from the list makes one `GET /api/cotizaciones?id=<x>` (the Gratex form reuses the cached row)
  and shows today's form with its lines.
- An id the mock answers with `data: []` shows "Esta cotización ya no existe" and "Ir a cotizaciones" returns to the list.
- `GET /api/branding` answering 500 on "Nueva cotización" shows "No se pudo preparar la cotización" with "Reintentar";
  after the mock recovers, "Reintentar" opens the form.
- With quote A open, Navbar "Nueva › Cotización" shows a blank form (no lines of A, number pending).

---

### Task 12: `FerreteriaCotizacionForm`, its Zod schema, the `.fx-grid-cot-fer` CSS and `ProductoCombobox mostrarPrecio`

**Files:**
- Create: `scripts/test-schema-cotizacion-ferreteria.ts`
- Create: `src/features/cotizaciones/formatos/ferreteria/schema.ts`
- Modify (replace the whole file): `src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx`
  (Task 11's provisional version)
- Modify: `src/features/products/ProductoCombobox.tsx`, line 10 (format import), lines 13-18 (props interface), lines
  20-24 (signature), lines 95-97 (the Costo label)
- Modify: `src/styles/factura-doc.css`, after lines 878-880 (`.fx-grid-ecf.fx-grid-cot`) and after line 967 (inside
  `@media (max-width: 900px)`, lines 963-983)
- Test: `node scripts/test-schema-cotizacion-ferreteria.ts`, then the gates; browser checks in Task 16.

**Interfaces:**
- Consumes:
  - From Task 9: `CotizacionFerreteriaInput`, `CotizacionRow.ajustes?`, `CotizacionItemRow.product_id?`, `unidad_medida?`,
    `indicador_facturacion?`, `indicador_bien_servicio?` (`src/api/types.ts`); `createCotizacion`, `updateCotizacion`,
    `previewCotizacion` accepting the Ferretería body (`src/api/cotizaciones.ts`); `indFactFromItbis(itbis: number): IndicadorFacturacion`
    (`src/features/invoices/montosLinea.ts:21`).
  - From Task 10: `totalesFerreteria(lineas: LineaFerreteria[], ajustes: AjustesFerreteriaForm): TotalesFerreteria`
    and `AjustesFerreteriaForm` (`src/features/cotizaciones/formatos/ferreteria/totales.ts`).
  - From Task 11: the registry entry `ferreteria: { id: 'ferreteria', Form: FerreteriaCotizacionForm }` and props
    `{ nav: Nav; cotizacionId: number | null }`.
  - Existing: `problemaCantidad`, `unidadValida`, `admiteDecimales`, `MSG_UNIDAD`, `useUnidadesMedida`
    (`src/components/unidadesMedida.ts`); `UnidadMedidaSelect` (`src/components/UnidadMedidaSelect.tsx:13`);
    `ClientCombobox` (`value`, `onChange`, `onBusquedaChange`, `invalido`), `NombreClienteLibre` (`value`, `onChange`,
    `onGuardado`), `NewClientModal` (`nombreInicial`, `onClose`, `onCreated`); `useAccionUnica`, `useAvisoSalida`
    (`activo, mensaje, ocupado` → `{ liberar }`); `presentDocument`; `hoyLocal`, `ahoraLocal`, `isoLocal`
    (`src/lib/date.ts`); `aNumero`, `fmt`, `fmtPrecio`, `decimalesDe` (`src/lib/format.ts`); `redondear`, `r2`
    (`montosLinea.ts`); `ApiError.status` (`src/api/errores.ts:41`).
- Produces:

```ts
// src/features/products/ProductoCombobox.tsx (contract)
// new optional prop `mostrarPrecio?: boolean` (default false => shows "Costo" as today; true => "Precio" with fmtPrecio)

// src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
export function FerreteriaCotizacionForm({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null })

// src/features/cotizaciones/formatos/ferreteria/schema.ts — value imports by relative path with .ts; '@/…' only `import type`
export const MAX_DESCRIPCION = 1000
export interface LineaFerreteriaForm { id: number; prodId: string; descripcion: string; cantidad: number; precio: number;
  indFact: IndicadorFacturacion; unidadMedida: number; tipoItem: 'Bien' | 'Servicio' }
export interface FormFerreteria { cliente: Cliente | null; clienteEscrito: { buscador: string; libre: string };
  fecha: string; lineas: LineaFerreteriaForm[]; ajustes: AjustesFerreteriaForm }
export interface ReglasUnidad { problemaCantidad: (cantidad: number, unidad: number) => string | null;
  problemaUnidad: (unidad: number) => string | null }
export const lineaEnBlanco: (l: LineaFerreteriaForm) => boolean
export function ferreteriaFormSchema(reglas: ReglasUnidad): ZodObject<…>        // safeParse(FormFerreteria)
export interface ErroresFerreteria { cliente?: string; fecha?: string; form?: string;
  lineas: Record<number, ErroresLineaFerreteria>; ajustes: Partial<Record<keyof AjustesFerreteriaForm, string>> }
export const sinErrores: () => ErroresFerreteria
export function mapearErrores(error: z.ZodError, lineas: { id: number }[]): ErroresFerreteria
export function cuerpoFerreteria(datos: { clienteId: number; lineas: LineaFerreteriaForm[];
  ajustes: AjustesFerreteriaForm; date?: string }): CotizacionFerreteriaInput
```

What the form sends (spec 6.5 and 8.1), all through `cuerpoFerreteria`:
- `formato: 'ferreteria'` always; `client_id` of the chosen client (a client is required; a typed free name must be saved
  as a client first, with `NombreClienteLibre`'s "Guardar").
- `date`: on create `` `${fecha} ${ahoraLocal().slice(11)}` ``; on edit only when the day differs from
  `String(row.date).slice(0, 10)`, again with the current time; otherwise absent, so the backend keeps the stored datetime.
- `items`: only the rows that aren't blank (`lineaEnBlanco`), each with `product_id` (number or `null`), trimmed
  `description`, `quantity` to 2 decimals, `amount` to 4, `unidad_medida` as a string, `indicador_facturacion` 1-4 and
  `indicador_bien_servicio` 1/2.
- `ajustes`: the 4 amounts to cents and `retencion_isr` as a boolean, every time (a PUT replaces the whole set).
- Preview adds `id` when editing. PUT goes as `{ id, ...cuerpo }`.
- 422 and other errors: the server text in a toast, unchanged. 409: the text in the sticky action bar with "Recargar"
  (`window.location.reload()`), and Save / Preview are gone because nothing can be saved from that screen.

- [ ] **Step 1: Check the prerequisites (Task 11 is committed)**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
git log --oneline -1 -- src/features/cotizaciones/formatos/index.ts
grep -n "Provisional" src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
grep -n "Costo <Money value={p.costo} cur={false} />" src/features/products/ProductoCombobox.tsx
sed -n '878,880p;967p' src/styles/factura-doc.css
node --version
```

Expected:
- Clean status; the log line is Task 11's commit (`feat(cotizaciones): registro de formatos …`).
- The provisional comment is found (line 5).
- `96:                  Costo <Money value={p.costo} cur={false} />`.
- `sed` prints `.fx-grid-ecf.fx-grid-cot {`, `  grid-template-columns: 22px minmax(0, 1fr) 70px 120px 130px;`, `}` and
  `  .fx-grid-ecf.fx-grid-cot { grid-template-columns: 1fr auto; }`. If the CSS moved, use the new line numbers; the
  find texts below are the same.
- `node --version` is v22.18 or newer (this machine: v25.2.1).

- [ ] **Step 2: Write the schema test before the schema**

Create `scripts/test-schema-cotizacion-ferreteria.ts`:

```ts
// Validación y cuerpo de la cotización de Ferretería (spec 6.5 y 8.1): lo que
// el formulario deja pasar y lo que manda al API. Las reglas de la unidad se
// inyectan como en el formulario, aquí con un catálogo de prueba (43 = Unidad,
// entera; 47 = Metro, admite fracciones; 99 no existe).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-schema-cotizacion-ferreteria.ts
import {
  cuerpoFerreteria, ferreteriaFormSchema, lineaEnBlanco, mapearErrores,
} from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import type { FormFerreteria, LineaFerreteriaForm } from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import type { Cliente } from '../src/types/domain.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const esquema = ferreteriaFormSchema({
  problemaCantidad: (cantidad, unidad) => {
    if (!(cantidad > 0)) return 'La cantidad debe ser mayor que 0.'
    if (unidad === 43 && !Number.isInteger(cantidad)) return 'La unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.'
    if (Math.round(cantidad * 100) !== cantidad * 100) return 'La cantidad admite hasta 2 decimales.'
    return null
  },
  problemaUnidad: (unidad) => ([43, 47].includes(unidad) ? null : 'Elige la unidad de medida de esta línea.'),
})

const cliente: Cliente = {
  id: '7', nombre: 'HOSPITAL DOCENTE', contacto: '', empresa: '', tipo: 'RNC', doc: '401515131', email: '', tel: '',
  ciudad: '', balance: 0, facturas: 0, estado: '', desde: '', descuento: 0, permiteCredito: false,
}
const linea = (id: number, cambio: Partial<LineaFerreteriaForm> = {}): LineaFerreteriaForm => ({
  id, prodId: '', descripcion: `ARTICULO ${id}`, cantidad: 1, precio: 100, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
  ...cambio,
})
const SIN_AJUSTES = { cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false }
const form = (cambio: Partial<FormFerreteria> = {}): FormFerreteria => ({
  cliente, clienteEscrito: { buscador: '', libre: '' }, fecha: '2026-09-02', lineas: [linea(1)], ajustes: SIN_AJUSTES,
  ...cambio,
})
/** Errores ya mapeados, o null si el formulario pasa. */
const errores = (f: FormFerreteria) => {
  const r = esquema.safeParse(f)
  return r.success ? null : mapearErrores(r.error, f.lineas)
}

// --- Lo que pasa y el cuerpo que viaja --------------------------------------
chk('un formulario completo pasa', errores(form()) === null)

const cuerpo = cuerpoFerreteria({
  clienteId: 7,
  lineas: [
    linea(1, { prodId: '55', descripcion: '  FUNDAS CEMENTO GRIS ', cantidad: 2, precio: 935 }),
    linea(2, { descripcion: 'CORTE DE TUBO', cantidad: 1.5, precio: 84.74583, unidadMedida: 47, indFact: 4, tipoItem: 'Servicio' }),
  ],
  ajustes: { cargosBancarios: 100.004, manejoBancario: 0, manoObra: 1500, abono: 0, retencion: true },
  date: '2026-09-02 10:15:00',
})
chk('cuerpo: formato, cliente, fecha, líneas y ajustes como los espera el API', JSON.stringify(cuerpo) === JSON.stringify({
  formato: 'ferreteria',
  client_id: 7,
  date: '2026-09-02 10:15:00',
  items: [
    { product_id: 55, description: 'FUNDAS CEMENTO GRIS', quantity: 2, amount: 935, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1 },
    { product_id: null, description: 'CORTE DE TUBO', quantity: 1.5, amount: 84.7458, unidad_medida: '47', indicador_facturacion: 4, indicador_bien_servicio: 2 },
  ],
  ajustes: { cargos_bancarios: 100, manejo_bancario: 0, mano_obra: 1500, abono: 0, retencion_isr: true },
}))
const sinFecha = cuerpoFerreteria({ clienteId: 7, lineas: [linea(1)], ajustes: SIN_AJUSTES })
chk('cuerpo sin fecha: no lleva `date` (el PUT conserva la guardada)', !('date' in sinFecha))
chk('cuerpo: retencion_isr es booleano también sin retención', sinFecha.ajustes.retencion_isr === false)

// --- Cliente -----------------------------------------------------------------
chk('sin cliente', errores(form({ cliente: null }))?.cliente === 'Elige un cliente de la lista o créalo con el botón +.')
chk('texto en el buscador sin elegir', errores(form({ cliente: null, clienteEscrito: { buscador: 'Juan', libre: '' } }))?.cliente
  === '«Juan» no está elegido: elígelo de la lista o créalo con el botón +.')
chk('nombre libre sin guardar', (errores(form({ cliente: null, clienteEscrito: { buscador: '', libre: 'Pedro Pérez' } }))?.cliente ?? '')
  .startsWith('«Pedro Pérez» todavía no es un cliente'))

// --- Fecha -------------------------------------------------------------------
chk('fecha vacía', errores(form({ fecha: '' }))?.fecha === 'Pon la fecha de la cotización.')
chk('fecha que no existe (30 de febrero)', errores(form({ fecha: '2026-02-30' }))?.fecha === 'La fecha no es válida.')

// --- Líneas ------------------------------------------------------------------
chk('sin líneas: error del formulario', (errores(form({ lineas: [] }))?.form ?? '').startsWith('Agrega al menos una línea'))
chk('lineaEnBlanco: fila vacía sí, con precio no, con producto no',
  lineaEnBlanco(linea(1, { descripcion: ' ', precio: 0 }))
  && !lineaEnBlanco(linea(1, { descripcion: '', precio: 5 }))
  && !lineaEnBlanco(linea(1, { descripcion: '', precio: 0, prodId: '9' })))
const malas = errores(form({
  lineas: [
    linea(10),
    linea(20, { descripcion: '  ', precio: 0 }),
    linea(30, { descripcion: 'X'.repeat(1001), precio: 1.23456, cantidad: 1.5 }),
    linea(40, { unidadMedida: 99, cantidad: 0 }),
  ],
}))
chk('línea sin descripción: el error va a su id (20)', malas?.lineas[20]?.descripcion === 'Escribe la descripción.')
chk('precio 0', malas?.lineas[20]?.precio === 'El precio debe ser mayor que 0.')
chk('descripción de 1001 caracteres', malas?.lineas[30]?.descripcion === 'La descripción admite hasta 1000 caracteres.')
chk('precio con 5 decimales', malas?.lineas[30]?.precio === 'El precio admite hasta 4 decimales.')
chk('fracción en una unidad entera', (malas?.lineas[30]?.cantidad ?? '').includes('no admite fracciones'))
chk('unidad fuera del catálogo', malas?.lineas[40]?.unidadMedida === 'Elige la unidad de medida de esta línea.')
chk('cantidad 0', malas?.lineas[40]?.cantidad === 'La cantidad debe ser mayor que 0.')
chk('la línea correcta (10) no lleva errores', malas?.lineas[10] === undefined)
chk('1.5 metros sí se acepta', errores(form({ lineas: [linea(1, { unidadMedida: 47, cantidad: 1.5 })] })) === null)

// --- Cargos y abonos ---------------------------------------------------------
const negativos = errores(form({ ajustes: { ...SIN_AJUSTES, cargosBancarios: -1, manoObra: 10.005 } }))
chk('cargo negativo', negativos?.ajustes.cargosBancarios === 'El monto de «Cargos bancarios» no puede ser negativo.')
chk('mano de obra con 3 decimales', negativos?.ajustes.manoObra === 'El monto de «Costo mano de obra» admite hasta 2 decimales.')
// Hoja "cotizacion pintura" (TOTAL 49,394.80): un abono de 50,000 pasa de lo adeudado.
const pintura: LineaFerreteriaForm[] = [
  [7, 2000], [2, 970], [2, 275], [2, 160], [2, 935], [1, 2380], [2, 10400],
].map(([cantidad, precio], i) => linea(i + 1, { cantidad, precio }))
chk('abono mayor que lo adeudado', errores(form({ lineas: pintura, ajustes: { ...SIN_AJUSTES, abono: 50000 } }))?.ajustes.abono
  === 'El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80).')
chk('abono igual a lo adeudado con retención (pintura: 47,301.80)',
  errores(form({ lineas: pintura, ajustes: { ...SIN_AJUSTES, retencion: true, abono: 47301.8 } })) === null)
// Borde de coma flotante (spec 6.2): 13.70 + 2.47 = 16.17, retención 0.69, abono 15.48 justo.
chk('abono justo de 15.48 sobre 13.70 con retención',
  errores(form({ lineas: [linea(1, { precio: 13.7 })], ajustes: { ...SIN_AJUSTES, retencion: true, abono: 15.48 } })) === null)

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
```

Why it's built this way:
- Same output style as the parity script (`  [OK  ] …`, `  [FALLA] …`, `N/M OK`, exit 1 on any failure).
- The unit rules are injected with a fixture catalog, as the form injects `problemaCantidad` / `unidadValida` with the
  real one. Node can't load `components/unidadesMedida.ts` (it imports `@/api`), and the schema doesn't need to.
- The amounts come from the spec's worked examples (pintura TOTAL 49,394.80, retención 2,093.00; the 13.70 float edge).

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/test-schema-cotizacion-ferreteria.ts; echo "exit=$?"
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Signos\Documents\edwin\fiscalo\src\features\cotizaciones\formatos\ferreteria\schema.ts' imported from C:\Users\Signos\Documents\edwin\fiscalo\scripts\test-schema-cotizacion-ferreteria.ts`
and `exit=1`. (`npm run typecheck` also fails now: TS2307 on the two `schema.ts` imports of the script, plus TS7006
for the three callback parameters that lose their type with it. Expected until Step 4.)

- [ ] **Step 4: Implement `src/features/cotizaciones/formatos/ferreteria/schema.ts`**

```ts
// Validación del formulario de cotización de Ferretería y armado del cuerpo
// que espera el API (CotizacionFerreteriaInput, spec 6.5). Mismo enfoque que
// invoices/factura.schema.ts: se valida el estado de la PANTALLA (líneas,
// cliente elegido, casillas) y los errores salen con rutas que la pantalla
// sabe pintar junto a cada campo y cada línea.
//
// Las reglas son las del backend (FerreteriaFormato::validarForma): si aquí
// pasa, allá también, salvo lo que solo sabe la base (que el cliente y el
// producto existan). Lo que el servidor rechace igual se muestra tal cual.
//
// Imports de valor SOLO por ruta relativa con .ts y '@/…' solo como
// `import type`: así `node` carga este archivo para
// scripts/test-schema-cotizacion-ferreteria.ts sin compilar nada. Por eso las
// reglas de la unidad (que necesitan el catálogo DGII, pedido al API) llegan
// como funciones: el formulario pasa las de components/unidadesMedida.
import { z } from 'zod'
import type { CotizacionFerreteriaInput, IndicadorFacturacion } from '@/api'
import type { Cliente } from '@/types/domain'
import { decimalesDe, fmt } from '../../../../lib/format.ts'
import { isoLocal } from '../../../../lib/date.ts'
import { r2, redondear } from '../../../invoices/montosLinea.ts'
import { totalesFerreteria } from './totales.ts'
import type { AjustesFerreteriaForm } from './totales.ts'

/** Tope de la descripción: el mismo que FerreteriaFormato::MAX_DESCRIPCION. */
export const MAX_DESCRIPCION = 1000

/** Una línea tal como la edita el formulario. */
export interface LineaFerreteriaForm {
  id: number
  /** Producto del catálogo de donde salió ('' = línea libre). */
  prodId: string
  descripcion: string
  cantidad: number
  /** Precio unitario SIN ITBIS: el impuesto se suma encima, como en la hoja de Excel. */
  precio: number
  indFact: IndicadorFacturacion
  /** Código DGII de la unidad (= unidades_medida.id; 43 = Unidad). */
  unidadMedida: number
  tipoItem: 'Bien' | 'Servicio'
}

/** Todo lo que se valida antes de guardar o pedir la vista previa. */
export interface FormFerreteria {
  cliente: Cliente | null
  /**
   * Lo escrito sin elegir un cliente: en el buscador, o como nombre libre que
   * todavía no se guardó. Se ve como un cliente puesto pero no lo es, y la
   * cotización exige `client_id`: el mensaje lo dice con ese mismo texto.
   */
  clienteEscrito: { buscador: string; libre: string }
  /** 'YYYY-MM-DD' del input de fecha. */
  fecha: string
  /** Solo las líneas con contenido (ver lineaEnBlanco). */
  lineas: LineaFerreteriaForm[]
  ajustes: AjustesFerreteriaForm
}

/**
 * Lo que el backend juzga con el catálogo de unidades. Cada función devuelve
 * el texto del problema o null. El formulario pasa problemaCantidad /
 * unidadValida de components/unidadesMedida con el catálogo ya cargado.
 */
export interface ReglasUnidad {
  problemaCantidad: (cantidad: number, unidad: number) => string | null
  problemaUnidad: (unidad: number) => string | null
}

/**
 * Fila sin nada que cotizar: sin producto, sin descripción y sin precio. Se
 * descarta sin avisar. La cantidad no cuenta: vaciar ese campo da 0, y pedir
 * que se arregle una fila que por lo demás está vacía no tendría sentido.
 */
export const lineaEnBlanco = (l: LineaFerreteriaForm): boolean =>
  l.prodId === '' && l.descripcion.trim() === '' && l.precio === 0

/** ¿Una fecha 'YYYY-MM-DD' que existe? (2026-02-30 no.) */
function fechaReal(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T12:00:00`)
  return !Number.isNaN(d.getTime()) && isoLocal(d) === f
}

/**
 * Un número con UN solo mensaje. Zod 4 corre todas las reglas de un campo, y
 * con .positive() + .refine() un mismo precio podía contar como dos errores.
 */
const numero = (problema: (n: number) => string | null) =>
  z.number().superRefine((n, ctx) => {
    const msg = problema(n)
    if (msg) ctx.addIssue({ code: 'custom', message: msg })
  })

/** Cargos y abono: ≥ 0 y con centavos como mucho (DECIMAL(18,2) en cotizacion_ajustes). */
const monto = (que: string) =>
  numero((n) => (n < 0
    ? `El monto de «${que}» no puede ser negativo.`
    : decimalesDe(n) > 2 ? `El monto de «${que}» admite hasta 2 decimales.` : null))

const ajustesSchema = z.object({
  cargosBancarios: monto('Cargos bancarios'),
  manejoBancario: monto('Manejos de operaciones bancarias'),
  manoObra: monto('Costo mano de obra'),
  abono: monto('Abono realizado'),
  retencion: z.boolean(),
})

/** Esquema del formulario con las reglas de unidad del catálogo cargado. */
export function ferreteriaFormSchema(reglas: ReglasUnidad) {
  const linea = z
    .object({
      id: z.number(),
      prodId: z.string(),
      descripcion: z.string().superRefine((d, ctx) => {
        const t = d.trim()
        const msg = t === ''
          ? 'Escribe la descripción.'
          : t.length > MAX_DESCRIPCION ? `La descripción admite hasta ${MAX_DESCRIPCION} caracteres.` : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      cantidad: z.number(),
      // amount del API: > 0 y hasta 4 decimales, como el precio del e-CF.
      precio: numero((n) => (!(n > 0)
        ? 'El precio debe ser mayor que 0.'
        : decimalesDe(n) > 4 ? 'El precio admite hasta 4 decimales.' : null)),
      indFact: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      unidadMedida: z.number(),
      tipoItem: z.enum(['Bien', 'Servicio']),
    })
    .superRefine((l, ctx) => {
      // La unidad decide si la cantidad admite fracciones (metro sí, unidad
      // no) y el tope es de 2 decimales: lo que viaja al e-CF al facturar.
      const unidad = reglas.problemaUnidad(l.unidadMedida)
      if (unidad) ctx.addIssue({ code: 'custom', path: ['unidadMedida'], message: unidad })
      const cantidad = reglas.problemaCantidad(l.cantidad, l.unidadMedida)
      if (cantidad) ctx.addIssue({ code: 'custom', path: ['cantidad'], message: cantidad })
    })

  return z
    .object({
      cliente: z.custom<Cliente | null>(),
      clienteEscrito: z.object({ buscador: z.string(), libre: z.string() }),
      fecha: z.string().superRefine((f, ctx) => {
        const msg = f === '' ? 'Pon la fecha de la cotización.' : !fechaReal(f) ? 'La fecha no es válida.' : null
        if (msg) ctx.addIssue({ code: 'custom', message: msg })
      }),
      lineas: z.array(linea).min(1, 'Agrega al menos una línea: un producto del catálogo o una línea libre.'),
      ajustes: ajustesSchema,
    })
    .superRefine((val, ctx) => {
      if (!val.cliente) {
        const { buscador, libre } = val.clienteEscrito
        ctx.addIssue({
          code: 'custom',
          path: ['cliente'],
          message: libre
            ? `«${libre}» todavía no es un cliente: pulsa «Guardar» en el campo para registrarlo, o elígelo de la lista.`
            : buscador
              ? `«${buscador}» no está elegido: elígelo de la lista o créalo con el botón +.`
              : 'Elige un cliente de la lista o créalo con el botón +.',
        })
      }
      // El abono no puede pasar de lo adeudado (TOTAL − retención), comparando
      // los montos ya redondeados, con el mismo texto que
      // FerreteriaFormato::errorAbono.
      const t = totalesFerreteria(
        val.lineas.map((l) => ({ cantidad: l.cantidad, precio: l.precio, indFact: l.indFact })),
        val.ajustes,
      )
      if (t.abono > t.adeudado) {
        ctx.addIssue({
          code: 'custom',
          path: ['ajustes', 'abono'],
          message: `El abono (RD$ ${fmt(t.abono)}) no puede ser mayor que lo adeudado (RD$ ${fmt(t.adeudado)}).`,
        })
      }
    })
}

export interface ErroresLineaFerreteria {
  descripcion?: string
  cantidad?: string
  precio?: string
  unidadMedida?: string
}

/** Errores por campo, listos para pintar. `lineas` se indexa por `LineaFerreteriaForm.id`. */
export interface ErroresFerreteria {
  cliente?: string
  fecha?: string
  /** Error del formulario entero (sin líneas). */
  form?: string
  lineas: Record<number, ErroresLineaFerreteria>
  ajustes: Partial<Record<keyof AjustesFerreteriaForm, string>>
}

export const sinErrores = (): ErroresFerreteria => ({ lineas: {}, ajustes: {} })

/**
 * Traduce las incidencias de Zod a ErroresFerreteria. Las rutas de línea
 * llegan como ['lineas', i, campo]; `i` se resuelve al id de la línea de
 * `lineas`, que debe ser la misma lista que se validó.
 */
export function mapearErrores(error: z.ZodError, lineas: { id: number }[]): ErroresFerreteria {
  const out = sinErrores()
  for (const issue of error.issues) {
    const [head, a, b] = issue.path
    if (head === 'cliente') {
      out.cliente ??= issue.message
    } else if (head === 'fecha') {
      out.fecha ??= issue.message
    } else if (head === 'ajustes') {
      if (typeof a === 'string') out.ajustes[a as keyof AjustesFerreteriaForm] ??= issue.message
    } else if (head === 'lineas') {
      if (typeof a === 'number' && typeof b === 'string') {
        const id = lineas[a]?.id
        if (id != null) {
          const bucket = (out.lineas[id] ??= {})
          bucket[b as keyof ErroresLineaFerreteria] ??= issue.message
        }
      } else {
        // ['lineas'] sin índice: no hay ninguna.
        out.form ??= issue.message
      }
    }
  }
  return out
}

/**
 * Cuerpo de POST / PUT / preview (sin `id`: lo agrega quien llama). Las
 * cantidades y los precios viajan con el redondeo con que la pantalla calculó
 * los totales (2 y 4 decimales), y los cargos y el abono, a centavos.
 * `retencion_isr` va siempre como booleano: el backend calcula el 5%.
 * `date` ausente = el backend usa ahora (POST) o conserva la guardada (PUT).
 */
export function cuerpoFerreteria(datos: {
  clienteId: number
  lineas: LineaFerreteriaForm[]
  ajustes: AjustesFerreteriaForm
  date?: string
}): CotizacionFerreteriaInput {
  const a = datos.ajustes
  return {
    // Siempre: si el formato del tenant ya no es este (pantalla vieja), el
    // backend responde 409 en vez de guardar con reglas de otro formato.
    formato: 'ferreteria',
    client_id: datos.clienteId,
    ...(datos.date ? { date: datos.date } : {}),
    items: datos.lineas.map((l) => ({
      product_id: l.prodId ? Number(l.prodId) : null,
      description: l.descripcion.trim(),
      quantity: redondear(l.cantidad, 2),
      amount: redondear(l.precio, 4),
      unidad_medida: String(l.unidadMedida),
      indicador_facturacion: l.indFact,
      indicador_bien_servicio: l.tipoItem === 'Servicio' ? 2 : 1,
    })),
    ajustes: {
      cargos_bancarios: r2(a.cargosBancarios),
      manejo_bancario: r2(a.manejoBancario),
      mano_obra: r2(a.manoObra),
      abono: r2(a.abono),
      retencion_isr: a.retencion,
    },
  }
}
```

Notes:
- Zod 4.4.3 (`package.json`) runs object and array `superRefine`s even when a nested field already failed (checked on
  this version), so one Save reports the client, the date, every line and the ajustes at once, like `factura.schema.ts`.
- `numero()` and the string `superRefine`s give one message per field; with `.positive().refine(…)` Zod 4 would report
  two issues for one bad price and the toast count would be wrong.
- `abono > adeudado` compares the r2-rounded values from `totalesFerreteria`, the same rule and wording as
  `FerreteriaFormato::errorAbono` (contract), so 15.48 over 13.70 + retención passes on both sides.

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/test-schema-cotizacion-ferreteria.ts; echo "exit=$?"
```

Expected: 25 lines starting with `  [OK  ]`, ending with:

```
  [OK  ] abono mayor que lo adeudado
  [OK  ] abono igual a lo adeudado con retención (pintura: 47,301.80)
  [OK  ] abono justo de 15.48 sobre 13.70 con retención

25/25 OK
exit=0
```

- [ ] **Step 6: Confirm the test catches a rule change, then restore it**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
F=src/features/cotizaciones/formatos/ferreteria/schema.ts
sed -i 's/if (t.abono > t.adeudado) {/if (t.abono >= t.adeudado) {/' "$F"
node scripts/test-schema-cotizacion-ferreteria.ts | grep -E "FALLA|/[0-9]+ OK"; echo "exit=${PIPESTATUS[0]}"
sed -i 's/if (t.abono >= t.adeudado) {/if (t.abono > t.adeudado) {/' "$F"
grep -c "if (t.abono > t.adeudado) {" "$F"
node scripts/test-schema-cotizacion-ferreteria.ts | tail -1
```

Expected:

```
  [FALLA] abono igual a lo adeudado con retención (pintura: 47,301.80)
  [FALLA] abono justo de 15.48 sobre 13.70 con retención
23/25 OK
exit=1
1
25/25 OK
```

- [ ] **Step 7: `ProductoCombobox`: the `mostrarPrecio` prop**

In `src/features/products/ProductoCombobox.tsx`, change line 10 from:

```tsx
import { fmtCantidad } from '@/lib/format'
```

to:

```tsx
import { fmtCantidad, fmtPrecio } from '@/lib/format'
```

Find (lines 16-18):

```tsx
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
}
```

and replace it with:

```tsx
  /** ms de espera tras la última tecla antes de consultar la API. */
  debounceMs?: number
  /**
   * Muestra el precio de venta en vez del costo. Un gasto se piensa en lo que
   * cuesta el artículo; una cotización, en lo que paga el cliente.
   */
  mostrarPrecio?: boolean
}
```

Find (lines 23-24):

```tsx
  debounceMs = 250,
}: ProductoComboboxProps) {
```

and replace it with:

```tsx
  debounceMs = 250,
  mostrarPrecio = false,
}: ProductoComboboxProps) {
```

Find (lines 95-97):

```tsx
                <span className="text-xs muted" style={{ whiteSpace: 'nowrap' }}>
                  Costo <Money value={p.costo} cur={false} />
                </span>
```

and replace it with:

```tsx
                <span className="text-xs muted" style={{ whiteSpace: 'nowrap' }}>
                  {/* El precio con sus decimales (hasta 4): es el que se copia a la línea. */}
                  {mostrarPrecio
                    ? <>Precio <span className="num">{fmtPrecio(p.precio)}</span></>
                    : <>Costo <Money value={p.costo} cur={false} /></>}
                </span>
```

`GastoFormModal.tsx:401` passes no `mostrarPrecio`, so it keeps "Costo".

- [ ] **Step 8: CSS: `.fx-grid-cot-fer` and the totals group (`src/styles/factura-doc.css`)**

Find (lines 878-880):

```css
.fx-grid-ecf.fx-grid-cot {
  grid-template-columns: 22px minmax(0, 1fr) 70px 120px 130px;
}
```

and replace it with:

```css
.fx-grid-ecf.fx-grid-cot {
  grid-template-columns: 22px minmax(0, 1fr) 70px 120px 130px;
}

/* ---------- Cotizacion de Ferreteria (formatos/ferreteria) ---------- */
/* Rejilla de lineas: como la hoja de Excel de la tienda, empieza por la
   cantidad, y cada linea lleva su unidad y su ITBIS (el precio va SIN ITBIS y
   el impuesto se suma encima). Hereda lo del e-CF igual que .fx-grid-cot. */
.fx-grid-ecf.fx-grid-cot-fer {
  grid-template-columns: 22px 70px 86px minmax(0, 1fr) 110px 86px 120px;
}

/* Buscador del catalogo en la fila de "agregar", junto a "Linea libre". */
.fx-buscar-prod { flex: 1 1 280px; max-width: 460px; }
/* El papel recorta lo que sobresale (overflow: hidden, por el filete de
   arriba): el desplegable se acorta para caber en lo que queda de hoja
   debajo (totales y pie) aunque la cotizacion tenga pocas lineas. */
.fx-buscar-prod .combobox-menu { max-height: 240px; }

/* Totales: el grupo de cargos y abonos lleva campos con su rotulo, que no
   caben en los 320px del cuadro de la factura. */
.fx-totales-box--fer { width: min(400px, 100%); }

.fx-ajustes {
  margin: 2px 0;
  padding: 2px 0;
  border-top: 1px dashed var(--border);
  border-bottom: 1px dashed var(--border);
}

.fx-ajustes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px 2px;
}

/* Mas especifico que .fx-detalle-toggle, que se define despues con padding 0. */
.fx-ajustes .fx-ajustes-abrir { padding: 6px 12px; }

/* El subrayado se queda visible: sin el, el 0 del campo se lee como un total
   calculado y no como algo que se puede escribir. */
.fx-ajuste-monto { width: 120px; flex: 0 0 auto; border-bottom-color: var(--border-strong); }
.fx-ajuste-err { justify-content: flex-end; padding: 0 12px; }

.fx-ajuste-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13.5px;
  color: var(--text-2);
  cursor: pointer;
}

.fx-total-linea--restante,
.fx-total-linea--restante > span:last-child {
  font-weight: 600;
  color: var(--text);
}

/* La pantalla quedo vieja (409: cambio el formato de la empresa): el aviso va
   en la barra, junto a Recargar, en rojo y no en tono de pista. */
.fx-motivo--alerta { color: var(--danger); }
```

Then, inside `@media (max-width: 900px)`, find (line 967):

```css
  .fx-grid-ecf.fx-grid-cot { grid-template-columns: 1fr auto; }
```

and replace it with:

```css
  .fx-grid-ecf.fx-grid-cot { grid-template-columns: 1fr auto; }
  /* Ferreteria: lo mismo, y en el telefono la descripcion va primero (a lo
     ancho) y el valor total a la derecha, como en el e-CF. */
  .fx-grid-ecf.fx-grid-cot-fer { grid-template-columns: 1fr auto; }
  .fx-grid-cot-fer > .fx-gutter { order: -2; }
  .fx-grid-cot-fer > .fx-desc { order: -1; }
  .fx-grid-cot-fer > .fx-importe { grid-column: 2; }
```

Why these rules:
- `.fx-grid-ecf.fx-grid-cot-fer` has two classes, so, like `.fx-grid-cot`, its collapse to `1fr auto` must be repeated
  inside the 900 px media query; everything else (hidden header, `data-label` captions, visible ✕) comes from
  `.fx-grid-ecf`.
- On a phone the DOM order (Cant. first, as on the sheet) would put the quantity next to the ✕; `order` brings the
  description up and `grid-column: 2` keeps Valor total on the right, as in the e-CF form. Tab order stays the DOM order.
- `.fx-sheet` has `overflow: hidden` (line 27). Under the add row there are only the totals and the footer (~300 px), so
  the catalog menu (`.combobox-menu`, max 320 px in `styles.css:1022`) is capped at 240 px to stay inside the paper.

- [ ] **Step 9: Write the complete form**

Read `src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx` (Task 11's provisional version) and
replace its whole content with:

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Spinner } from '@/components/ui'
import {
  ApiError, createCotizacion, updateCotizacion, deleteCotizacion, previewCotizacion,
  getCotizacion, getClient, getBranding, getEmisor, mapClientRow,
} from '@/api'
import type { CotizacionRow, IndicadorFacturacion } from '@/api'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { NombreClienteLibre } from '@/features/clients/NombreClienteLibre'
import { ProductoCombobox } from '@/features/products/ProductoCombobox'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import {
  MSG_UNIDAD, admiteDecimales, problemaCantidad, unidadValida, useUnidadesMedida,
} from '@/components/unidadesMedida'
import { indFactFromItbis } from '@/features/invoices/montosLinea'
import { presentDocument } from '@/lib/file'
import { ahoraLocal, hoyLocal } from '@/lib/date'
import { aNumero } from '@/lib/format'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { useAvisoSalida } from '@/hooks/useAvisoSalida'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto } from '@/types/domain'
import { totalesFerreteria, type AjustesFerreteriaForm } from './totales'
import {
  MAX_DESCRIPCION, cuerpoFerreteria, ferreteriaFormSchema, lineaEnBlanco, mapearErrores, sinErrores,
  type ErroresFerreteria, type LineaFerreteriaForm,
} from './schema'
import '@/styles/factura-doc.css'

/* FISCALO — Cotización con el formato de Ferretería (spec 8.1).

   El mismo papel que la factura, con lo que pide la hoja de Excel de la
   tienda ("COTIZACION MERCANCIAS"): cantidad, descripción, valor unitario y
   valor total; Sub-total, ITBIS y TOTAL; y debajo los cargos y abonos que la
   hoja deja en blanco hasta que hacen falta.

   A diferencia de la de Gratex, cada línea es un artículo del catálogo (o una
   línea libre) con su unidad y su ITBIS, y el precio va SIN ITBIS: el impuesto
   se suma encima, como en la hoja. Así la cotización se convierte en factura
   con las líneas ligadas a sus productos y la venta descuenta inventario.

   Los totales de la pantalla salen de totalesFerreteria(), las mismas cuentas
   que hace el servidor al guardar (que ignora cualquier total que se le mande).
   No hay envío por correo: para este formato todavía no existe. */

/** Opciones del indicador de facturación DGII (tasa de ITBIS de la línea). */
const IND_FACT_OPCIONES: { value: IndicadorFacturacion; label: string }[] = [
  { value: 1, label: '18%' },
  { value: 2, label: '16%' },
  { value: 3, label: 'Tasa 0%' },
  { value: 4, label: 'Exento' },
]

const SIN_AJUSTES: AjustesFerreteriaForm = { cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false }

const siguienteId = (ls: LineaFerreteriaForm[]) => Math.max(0, ...ls.map((l) => l.id)) + 1

/** Línea escrita a mano: gravada al 18%, por unidad y como bien, igual que en la factura. */
const lineaLibre = (id: number): LineaFerreteriaForm => ({
  id, prodId: '', descripcion: '', cantidad: 1, precio: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
})

/** Indicador guardado (TINYINT, null en una línea sin él) → uno válido; 1 por defecto, como el backend. */
const indicadorDe = (v: unknown): IndicadorFacturacion => {
  const n = Number(v)
  return n === 2 || n === 3 || n === 4 ? n : 1
}

/** Líneas de una cotización guardada. Cantidad y precio llegan como texto DECIMAL ("2.000", "935.0000"). */
function lineasDeFila(row: CotizacionRow): LineaFerreteriaForm[] {
  return (row.items ?? []).map((it, i) => ({
    id: i + 1,
    prodId: it.product_id ? String(it.product_id) : '',
    descripcion: it.description ?? '',
    cantidad: aNumero(it.quantity ?? 1),
    precio: aNumero(it.amount),
    indFact: indicadorDe(it.indicador_facturacion),
    unidadMedida: Number(it.unidad_medida ?? 43) || 43,
    tipoItem: Number(it.indicador_bien_servicio ?? 1) === 2 ? 'Servicio' : 'Bien',
  }))
}

/** Cargos y abonos guardados: montos DECIMAL como texto; una clave ausente es 0. */
function ajustesDeFila(row: CotizacionRow): AjustesFerreteriaForm {
  const a = row.ajustes ?? {}
  return {
    cargosBancarios: aNumero(a.cargos_bancarios),
    manejoBancario: aNumero(a.manejo_bancario),
    manoObra: aNumero(a.mano_obra),
    abono: aNumero(a.abono),
    // Se guarda el MONTO de la retención; la casilla solo dice si la hay. Al
    // guardar, el backend la vuelve a calcular sobre el Sub-total de ese momento.
    retencion: aNumero(a.retencion_isr) > 0,
  }
}

/**
 * Ficha provisional con lo que trae la fila (id y nombre), mientras llega el
 * cliente completo. Con ella el client_id ya está puesto: si la ficha no
 * llegara, guardar sigue funcionando.
 */
function clienteDeFila(row: CotizacionRow): Cliente | null {
  if (!row.client_id) return null
  return {
    id: String(row.client_id), nombre: row.client_name || `Cliente #${row.client_id}`,
    contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
    balance: 0, facturas: 0, estado: '', desde: '', descuento: 0, permiteCredito: false,
  }
}

/** RNC o cédula con guiones, como lo imprime el PDF (FerreteriaFormato::formatearRnc). */
function formatearRnc(rnc: string | null | undefined): string {
  const tal = (rnc ?? '').trim()
  const d = tal.replace(/\D/g, '')
  if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return tal
}

/**
 * Lo que cuenta como "cambio" al editar, en una sola cadena: se compara con la
 * foto que se toma al cargar. Si el usuario devuelve un campo a como estaba,
 * deja de contar.
 */
function huella(
  clienteId: string | null, libre: string, fecha: string, lineas: LineaFerreteriaForm[], ajustes: AjustesFerreteriaForm,
): string {
  return JSON.stringify([
    clienteId, libre.trim(), fecha, ajustes,
    lineas.map((l) => [l.prodId, l.descripcion, l.cantidad, l.precio, l.indFact, l.unidadMedida, l.tipoItem]),
  ])
}

/** 409: el formato del tenant ya no es este (pantalla vieja). Nada de lo que se haga aquí se puede guardar. */
const esDesactualizada = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 409

/**
 * Descripción que crece con el texto: el PDF la imprime entera (hasta 1000
 * caracteres) y en pantalla tampoco se corta. Sin saltos de línea: en el PDF y
 * al facturar la descripción es un solo párrafo, así que Enter no hace nada y
 * un texto pegado con saltos queda en una sola línea.
 */
function DescripcionLinea({
  value, onValue, ...rest
}: {
  value: string
  onValue: (v: string) => void
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onValue(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
    />
  )
}

/** Un monto del grupo "Cargos y abonos": etiqueta a la izquierda y el campo donde va la cifra. */
function CampoAjuste({
  id, label, value, error, onValue,
}: {
  id: string
  label: string
  value: number
  error?: string
  onValue: (v: number) => void
}) {
  return (
    <>
      <div className="fx-total-linea">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          className={'fx-field fx-num fx-ajuste-monto' + (error ? ' fx-field--err' : '')}
          type="number" min={0} step="0.01" inputMode="decimal"
          value={value}
          onChange={(e) => onValue(+e.target.value || 0)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && <span className="fx-err fx-ajuste-err"><Icon name="alert-circle" size={12} />{error}</span>}
    </>
  )
}

export function FerreteriaCotizacionForm({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null }) {
  const queryClient = useQueryClient()
  const editando = cotizacionId != null

  const [cliente, setCliente] = useState<Cliente | null>(null)
  /** false mientras el cliente es la ficha provisional de la fila (todavía sin su RNC). */
  const [clienteCompleto, setClienteCompleto] = useState(true)
  /** Nombre escrito a mano (NombreClienteLibre) que todavía no se guardó como cliente. */
  const [clienteLibre, setClienteLibre] = useState('')
  /** Lo escrito en el buscador de clientes sin elegir un resultado (ver ClientCombobox). */
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [fecha, setFecha] = useState(hoyLocal)
  /** Día con que se cargó ('YYYY-MM-DD'). Si no se cambia, el PUT no manda fecha y se conserva la hora. */
  const [fechaGuardada, setFechaGuardada] = useState('')
  const [lineas, setLineas] = useState<LineaFerreteriaForm[]>([])
  const [ajustes, setAjustes] = useState<AjustesFerreteriaForm>(SIN_AJUSTES)
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [errores, setErrores] = useState<ErroresFerreteria>(sinErrores)
  const [guardando, setGuardando] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [borrando, setBorrando] = useState(false)
  /** Texto del 409. Con él la pantalla ya no guarda: solo ofrece recargar. */
  const [desactualizada, setDesactualizada] = useState<string | null>(null)
  /** Al editar: ya se volcó la fila en el formulario. */
  const [listo, setListo] = useState(!editando)
  /** Foto del documento tal como se cargó (ver huella); null = nueva o sin cargar. */
  const [original, setOriginal] = useState<string | null>(null)

  // --- Emisor: el membrete del papel, igual que en la factura ---
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contactoEmisor = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')
  // Qué unidades admiten fracciones (metro, kilo) y cuáles se cuentan enteras.
  const unidades = useUnidadesMedida()

  // --- Carga al editar ---
  // Misma clave que CotizacionEditor: la fila ya está en la caché.
  const detalle = useApiQuery(
    ['cotizaciones', 'detail', cotizacionId],
    () => (cotizacionId != null ? getCotizacion(cotizacionId) : Promise.resolve(null)),
  )
  const cargada = useRef(false)
  useEffect(() => {
    const row = detalle.data
    if (cargada.current || !row) return
    cargada.current = true
    const ls = lineasDeFila(row)
    const aj = ajustesDeFila(row)
    const dia = String(row.date ?? '').slice(0, 10)
    const cli = clienteDeFila(row)
    setCodigo(row.code || `#${row.id}`)
    setLineas(ls)
    setAjustes(aj)
    setFecha(dia || hoyLocal())
    setFechaGuardada(dia)
    setCliente(cli)
    setClienteCompleto(cli == null)
    setOriginal(huella(cli?.id ?? null, '', dia || hoyLocal(), ls, aj))
    setListo(true)
  }, [detalle.data])

  // La fila solo trae id y nombre del cliente: se busca la ficha completa para
  // mostrar su RNC (va impreso en el PDF). Si el usuario ya eligió otro, se respeta.
  const clienteId = detalle.data?.client_id ?? null
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', clienteId],
    () => (clienteId ? getClient(clienteId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    if (!row || clienteCompleto) return
    setCliente((c) => (c && c.id === String(row.id) ? mapClientRow(row) : c))
    setClienteCompleto(true)
  }, [clienteDetalle.data, clienteCompleto])

  // --- Totales: las mismas cuentas que el servidor (spec 6.2) ---
  const t = useMemo(
    () => totalesFerreteria(lineas.map((l) => ({ cantidad: l.cantidad, precio: l.precio, indFact: l.indFact })), ajustes),
    [lineas, ajustes],
  )
  /** Las líneas que se guardan: las filas vacías se descartan sin avisar (ver lineaEnBlanco). */
  const enUso = lineas.filter((l) => !lineaEnBlanco(l))
  // Un negativo también cuenta: el grupo no se puede cerrar con el error dentro.
  const hayAjustes = ajustes.cargosBancarios !== 0 || ajustes.manejoBancario !== 0 || ajustes.manoObra !== 0
    || ajustes.abono !== 0 || ajustes.retencion
  // Abierto si el usuario lo abrió o si ya tiene algo: con valores no se puede
  // esconder, porque cambian el TOTAL.
  const ajustesVisibles = ajustesAbiertos || hayAjustes

  // --- Salir sin guardar ---
  // Una nueva avisa en cuanto tiene algo escrito; una existente, cuando se tocó algo.
  const hayCambios = original != null && huella(cliente?.id ?? null, clienteLibre, fecha, lineas, ajustes) !== original
  const hayAlgoEscrito = cliente != null || clienteLibre.trim() !== '' || enUso.length > 0 || hayAjustes
  const salida = useAvisoSalida(
    editando ? hayCambios : hayAlgoEscrito,
    editando
      ? `Los cambios de la cotización ${codigo} no se han guardado. Si sales ahora, se pierden.`
      : 'Esta cotización no se ha guardado: no tiene número y no aparecerá en el listado. Si sales ahora, se pierde.',
    // Mientras se guarda o se borra no se pregunta: la navegación espera.
    guardando || borrando,
  )

  // --- Cliente ---
  const quitarErrCliente = () => setErrores((e) => (e.cliente ? { ...e, cliente: undefined } : e))
  const seleccionarCliente = (c: Cliente | null) => {
    setCliente(c)
    setClienteCompleto(true)
    // El nombre libre ya no aplica: o se eligió un cliente, o se va a buscar otro.
    setClienteLibre('')
    quitarErrCliente()
  }

  // --- Líneas ---
  const quitarErrLinea = (id: number) =>
    setErrores((e) => {
      if (!(id in e.lineas)) return e
      const ls = { ...e.lineas }
      delete ls[id]
      return { ...e, lineas: ls }
    })
  const quitarErrForm = () => setErrores((e) => (e.form ? { ...e, form: undefined } : e))
  const updLinea = (id: number, cambio: Partial<LineaFerreteriaForm>) => {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambio } : l)))
    quitarErrLinea(id)
  }
  const delLinea = (id: number) => {
    setLineas((ls) => ls.filter((l) => l.id !== id))
    quitarErrLinea(id)
  }
  const addLineaLibre = () => {
    setLineas((ls) => [...ls, lineaLibre(siguienteId(ls))])
    quitarErrForm()
  }
  /**
   * Artículo del catálogo: trae su nombre, su precio SIN ITBIS, su unidad, su
   * tasa y si es bien o servicio. Si la última fila sigue vacía se reemplaza,
   * para no dejar huecos.
   */
  const addProducto = (p: Producto) => {
    const desde = (id: number): LineaFerreteriaForm => ({
      id,
      prodId: p.id,
      descripcion: p.nombre,
      cantidad: 1,
      precio: p.precio,
      indFact: indFactFromItbis(p.itbis),
      unidadMedida: p.unidadMedida || 43,
      tipoItem: p.tipo === 'Servicio' ? 'Servicio' : 'Bien',
    })
    setLineas((ls) => {
      const ultima = ls[ls.length - 1]
      return ultima && lineaEnBlanco(ultima)
        ? [...ls.slice(0, -1), desde(ultima.id)]
        : [...ls, desde(siguienteId(ls))]
    })
    quitarErrForm()
  }

  // --- Cargos y abonos ---
  const updAjuste = <K extends keyof AjustesFerreteriaForm>(k: K, v: AjustesFerreteriaForm[K]) => {
    setAjustes((a) => ({ ...a, [k]: v }))
    // El abono se juzga contra el TOTAL: cualquier ajuste puede resolverlo.
    setErrores((e) => (Object.keys(e.ajustes).length > 0 ? { ...e, ajustes: {} } : e))
  }

  /**
   * Valida con ferreteriaFormSchema y arma el cuerpo del API. Pinta los errores
   * junto a cada campo y resume cuántos hay. null = hay algo que corregir.
   */
  const validar = () => {
    const res = ferreteriaFormSchema({
      problemaCantidad: (c, u) => problemaCantidad(c, { unidadId: u, catalogo: unidades, maxDecimales: 2 }),
      problemaUnidad: (u) => (unidadValida(u, unidades) ? null : MSG_UNIDAD),
    }).safeParse({
      cliente,
      clienteEscrito: { buscador: cliente ? '' : busquedaCliente, libre: cliente ? '' : clienteLibre.trim() },
      fecha,
      lineas: enUso,
      ajustes,
    })
    if (!res.success) {
      setErrores(mapearErrores(res.error, enUso))
      const n = res.error.issues.length
      toast.error(n === 1 ? 'Revisa 1 campo de la cotización.' : `Revisa ${n} campos de la cotización.`)
      return null
    }
    if (!cliente) return null
    setErrores(sinErrores())
    // Nueva: el día elegido con la hora de ahora. Editando, la fecha solo
    // viaja si se cambió el día; si no, el backend conserva la fecha y la hora.
    const date = editando && fecha === fechaGuardada ? undefined : `${fecha} ${ahoraLocal().slice(11)}`
    return cuerpoFerreteria({ clienteId: Number(cliente.id), lineas: enUso, ajustes, date })
  }

  // Acción única: un doble clic crearía la misma cotización dos veces (y gastaría dos números).
  const guardar = useAccionUnica(async () => {
    if (desactualizada) return
    const cuerpo = validar()
    if (!cuerpo) return
    setGuardando(true)
    try {
      if (cotizacionId != null) {
        await updateCotizacion({ id: cotizacionId, ...cuerpo })
        toast.success(`Cotización ${codigo} actualizada.`)
      } else {
        const res = await createCotizacion(cuerpo)
        toast.success(`Cotización ${res.code} creada.`)
      }
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      salida.liberar()
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      // Los 422 del servidor dicen qué línea o qué monto falla: se muestran tal cual.
      if (esDesactualizada(e)) setDesactualizada(e.message)
      else toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la cotización.')
      setGuardando(false)
    }
  })

  const vistaPrevia = async () => {
    if (desactualizada) return
    const cuerpo = validar()
    if (!cuerpo) return
    setPreviewing(true)
    const tid = toast.loading('Generando vista previa…')
    try {
      // Editando viaja el id: el PDF sale con el formato y el número de esa cotización.
      presentDocument(await previewCotizacion(cotizacionId != null ? { ...cuerpo, id: cotizacionId } : cuerpo))
      toast.success('Vista previa generada.', { id: tid })
    } catch (e) {
      if (esDesactualizada(e)) {
        toast.dismiss(tid)
        setDesactualizada(e.message)
      } else {
        toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.', { id: tid })
      }
    } finally {
      setPreviewing(false)
    }
  }

  const borrar = useAccionUnica(async () => {
    if (cotizacionId == null) return
    setBorrando(true)
    try {
      await deleteCotizacion(cotizacionId)
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      toast.success(`Cotización ${codigo} eliminada.`)
      salida.liberar()
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo eliminar la cotización.')
      setBorrando(false)
    }
  })

  // Lo escrito no se puede guardar en esta pantalla (el formato cambió): el
  // usuario ya decidió recargar, así que no se le vuelve a preguntar.
  const recargar = () => {
    salida.liberar()
    window.location.reload()
  }

  return (
    <div className="page fx-desk">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('cotizaciones')}>Cotizaciones</Btn>
        {editando && confirmDel ? (
          <span className="row gap-sm" style={{ alignItems: 'center' }}>
            <span className="text-sm muted">¿Eliminar esta cotización?</span>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
            <Btn variant="danger" size="sm" onClick={() => void borrar()} disabled={borrando}>
              {borrando ? 'Eliminando…' : 'Sí, eliminar'}
            </Btn>
          </span>
        ) : editando ? (
          <Btn variant="ghost" size="sm" icon="trash-2" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
            Eliminar
          </Btn>
        ) : null}
      </div>

      <article className="fx-sheet fx-sheet--ancha">
        {/* --- Emisor + identificación del documento --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisorNombre || 'Tu empresa'}</div>
            {emisor?.direccion && <div className="fx-emisor-line">{emisor.direccion}</div>}
            {contactoEmisor && <div className="fx-emisor-line">{contactoEmisor}</div>}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {formatearRnc(emisor.rnc)}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Propuesta comercial</span>
            <div className="fx-tipo-fijo">Cotización mercancías</div>
            <span className={'fx-numero' + (codigo ? '' : ' fx-numero-pend')}>
              {codigo || 'Se asigna al guardar'}
            </span>
            <label className="fx-eyebrow" htmlFor="fx-cot-fecha">Fecha</label>
            <input
              id="fx-cot-fecha"
              className={'fx-field' + (errores.fecha ? ' fx-field--err' : '')}
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value)
                if (errores.fecha) setErrores((er) => ({ ...er, fecha: undefined }))
              }}
              style={{ textAlign: 'right', width: 'auto' }}
              aria-invalid={errores.fecha ? true : undefined}
            />
            {errores.fecha && <span className="fx-err"><Icon name="alert-circle" size={12} />{errores.fecha}</span>}
          </div>
        </header>

        <div className="fx-rule" />

        {/* --- Cliente: el mismo rótulo que la hoja impresa --- */}
        <section className="fx-a-quien">
          <span className="fx-eyebrow">Nombre o razón social <span className="req">*</span></span>
          <div className="fx-cliente-row">
            <div className="fx-cliente">
              <ClientCombobox
                value={cliente}
                onChange={seleccionarCliente}
                onBusquedaChange={(texto) => { setBusquedaCliente(texto); quitarErrCliente() }}
                invalido={errores.cliente != null}
              />
            </div>
            <button
              type="button"
              className="fx-cliente-add"
              onClick={() => setNuevoCliente(true)}
              title="Nuevo cliente"
              aria-label="Crear un cliente nuevo"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {/* Un nombre escrito se guarda como cliente con su botón "Guardar",
              como en la factura simple: la cotización necesita un client_id. */}
          {!cliente && (
            <NombreClienteLibre
              value={clienteLibre}
              onChange={(v) => { setClienteLibre(v); quitarErrCliente() }}
              onGuardado={seleccionarCliente}
            />
          )}
          {cliente && clienteCompleto && (
            <span className="text-xs muted-3 mono" style={{ display: 'block', marginTop: 4 }}>
              {cliente.doc
                ? `${cliente.doc.replace(/\D/g, '').length === 11 ? 'Cédula' : 'RNC'} ${formatearRnc(cliente.doc)}`
                : 'Este cliente no tiene RNC ni cédula: la cotización sale sin ese dato.'}
            </span>
          )}
          {errores.cliente && <span className="fx-err"><Icon name="alert-circle" size={12} />{errores.cliente}</span>}
        </section>

        {/* --- Líneas: las columnas de la hoja, más unidad e ITBIS --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ecf fx-grid-cot-fer fx-items-head">
            <span />
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span>Unidad</span>
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span>ITBIS</span>
            <span style={{ textAlign: 'right' }}>Valor total</span>
          </div>

          {!listo ? (
            <div className="state" style={{ padding: 26 }}><Spinner /></div>
          ) : (
            lineas.map((l, i) => {
              const le = errores.lineas[l.id]
              const m = t.lineas[i]
              // Paso y teclado según la unidad: metros o kilos admiten
              // fracciones; unidades o cajas se cuentan enteras.
              const enteras = !admiteDecimales(l.unidadMedida, unidades)
              return (
                <div className={'fx-grid-ecf fx-grid-cot-fer fx-row' + (le ? ' fx-row-incompleta' : '')} key={l.id}>
                  <button
                    type="button"
                    className="fx-gutter"
                    onClick={() => delLinea(l.id)}
                    aria-label={`Quitar línea ${i + 1}`}
                    title="Quitar línea"
                  >
                    <Icon name="x" size={14} />
                  </button>

                  <div className="fx-cell" data-label="Cant.">
                    <input
                      className={'fx-field fx-num' + (le?.cantidad ? ' fx-field--err' : '')}
                      type="number" min={0}
                      step={enteras ? 1 : 'any'}
                      inputMode={enteras ? 'numeric' : 'decimal'}
                      value={l.cantidad}
                      onChange={(e) => updLinea(l.id, { cantidad: +e.target.value || 0 })}
                      aria-label={`Cantidad de la línea ${i + 1}`}
                      aria-invalid={le?.cantidad ? true : undefined}
                    />
                    {le?.cantidad && <span className="fx-err">{le.cantidad}</span>}
                  </div>

                  <div className="fx-cell" data-label="Unidad">
                    <UnidadMedidaSelect
                      className={'fx-tasa' + (le?.unidadMedida ? ' fx-tasa--err' : '')}
                      value={l.unidadMedida}
                      onChange={(v) => updLinea(l.id, { unidadMedida: v })}
                    />
                    {le?.unidadMedida && <span className="fx-err">{le.unidadMedida}</span>}
                  </div>

                  <div className="fx-desc">
                    <DescripcionLinea
                      className={'fx-field fx-desc' + (le?.descripcion ? ' fx-field--err' : '')}
                      value={l.descripcion}
                      onValue={(v) => updLinea(l.id, { descripcion: v })}
                      placeholder="Artículo o trabajo (ej. Fundas de cemento gris)"
                      aria-label={`Descripción de la línea ${i + 1}`}
                      aria-invalid={le?.descripcion ? true : undefined}
                    />
                    {le?.descripcion && <span className="fx-err"><Icon name="alert-circle" size={12} />{le.descripcion}</span>}
                    <div className="fx-linea-pie">
                      {/* Ligada al catálogo = al facturarla descuenta inventario. */}
                      {l.prodId ? (
                        <span className="fx-contador">Del catálogo · {l.tipoItem}</span>
                      ) : (
                        <>
                          <span className="fx-contador">Línea libre ·</span>
                          <button
                            type="button"
                            className="fx-detalle-toggle fx-detalle-toggle--sec"
                            onClick={() => updLinea(l.id, { tipoItem: l.tipoItem === 'Bien' ? 'Servicio' : 'Bien' })}
                            title="Cambiar entre bien y servicio (cuenta al facturarla)"
                          >
                            {l.tipoItem}
                          </button>
                        </>
                      )}
                      {l.descripcion.trim().length > MAX_DESCRIPCION - 100 && (
                        <span className={'fx-contador' + (l.descripcion.trim().length > MAX_DESCRIPCION ? ' fx-contador--tope' : '')}>
                          {l.descripcion.trim().length}/{MAX_DESCRIPCION}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="fx-cell" data-label="Precio">
                    <input
                      className={'fx-field fx-num' + (le?.precio ? ' fx-field--err' : '')}
                      type="number" min={0} step="any" inputMode="decimal"
                      value={l.precio}
                      onChange={(e) => updLinea(l.id, { precio: +e.target.value || 0 })}
                      aria-label={`Precio sin ITBIS de la línea ${i + 1}`}
                      aria-invalid={le?.precio ? true : undefined}
                    />
                    {le?.precio && <span className="fx-err">{le.precio}</span>}
                  </div>

                  <select
                    className="fx-tasa fx-cell" data-label="ITBIS"
                    value={l.indFact}
                    onChange={(e) => updLinea(l.id, { indFact: Number(e.target.value) as IndicadorFacturacion })}
                    aria-label={`ITBIS de la línea ${i + 1}`}
                  >
                    {IND_FACT_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  {/* Valor total = cantidad × precio, sin ITBIS (la columna D de la hoja). */}
                  <span className="fx-importe fx-cell" data-label="Valor total">
                    <Money value={m?.base ?? 0} cur={false} />
                    <span className="fx-contador" style={{ display: 'block' }}>ITBIS <Money value={m?.itbis ?? 0} cur={false} /></span>
                  </span>
                </div>
              )
            })
          )}

          {listo && lineas.length === 0 && (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm" style={{ color: errores.form ? 'var(--danger)' : 'var(--text-2)' }}>
                {errores.form ?? 'Sin líneas. Busca un artículo del catálogo o agrega una línea libre.'}
              </span>
            </div>
          )}

          <div className="fx-add-row">
            <div className="fx-buscar-prod">
              <ProductoCombobox
                onSelect={addProducto}
                mostrarPrecio
                placeholder="Agregar del catálogo: nombre, SKU o categoría…"
              />
            </div>
            <button type="button" className="fx-add" onClick={addLineaLibre}>
              <Icon name="plus" size={14} />Línea libre
            </button>
          </div>

          {errores.form && lineas.length > 0 && (
            <span className="fx-err" style={{ marginTop: 10 }}>
              <Icon name="alert-circle" size={12} />{errores.form}
            </span>
          )}
        </section>

        {/* --- Totales, en el orden de la hoja --- */}
        <section className="fx-cierre">
          <div />
          <div className="fx-totales-box fx-totales-box--fer">
            <div className="fx-total-linea">
              <span>Sub-total</span><span><Money value={t.subtotal} cur={false} /></span>
            </div>
            <div className="fx-total-linea">
              <span>{t.etiquetaItbis}</span><span><Money value={t.itbis} cur={false} /></span>
            </div>

            {/* Cargos y abonos: la hoja los deja en blanco y el PDF solo imprime
                los que tienen valor. Cargos y mano de obra se suman al TOTAL sin
                ITBIS; retención y abono solo bajan lo que queda por pagar. */}
            <div className="fx-ajustes">
              {ajustesVisibles ? (
                <>
                  <div className="fx-ajustes-head">
                    <span className="fx-eyebrow">Cargos y abonos</span>
                    {!hayAjustes && (
                      <button type="button" className="fx-detalle-toggle" onClick={() => setAjustesAbiertos(false)} aria-expanded>
                        − Ocultar
                      </button>
                    )}
                  </div>
                  <CampoAjuste
                    id="fx-aj-cargos" label="Cargos bancarios" value={ajustes.cargosBancarios}
                    error={errores.ajustes.cargosBancarios} onValue={(v) => updAjuste('cargosBancarios', v)}
                  />
                  <CampoAjuste
                    id="fx-aj-manejo" label="Manejos de operaciones bancarias" value={ajustes.manejoBancario}
                    error={errores.ajustes.manejoBancario} onValue={(v) => updAjuste('manejoBancario', v)}
                  />
                  <CampoAjuste
                    id="fx-aj-mano" label="Costo mano de obra" value={ajustes.manoObra}
                    error={errores.ajustes.manoObra} onValue={(v) => updAjuste('manoObra', v)}
                  />
                  <label className="fx-ajuste-check">
                    <input
                      type="checkbox"
                      checked={ajustes.retencion}
                      onChange={(e) => updAjuste('retencion', e.target.checked)}
                    />
                    Retención Renta 5%
                  </label>
                  <CampoAjuste
                    id="fx-aj-abono" label="Abono realizado" value={ajustes.abono}
                    error={errores.ajustes.abono} onValue={(v) => updAjuste('abono', v)}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="fx-detalle-toggle fx-ajustes-abrir"
                  onClick={() => setAjustesAbiertos(true)}
                  aria-expanded={false}
                >
                  + Cargos y abonos
                </button>
              )}
            </div>

            <div className="fx-total-final">
              <span>Total RD$</span><span><Money value={t.total} cur={false} /></span>
            </div>
            {t.retencion > 0 && (
              <div className="fx-total-linea">
                <span>Retención Renta por Tercero 5%</span><span>−<Money value={t.retencion} cur={false} /></span>
              </div>
            )}
            {t.abono > 0 && (
              <div className="fx-total-linea">
                <span>Abono realizado</span><span>−<Money value={t.abono} cur={false} /></span>
              </div>
            )}
            {/* Solo con retención o abono, igual que en el PDF: sin ellos sería el TOTAL repetido. */}
            {t.mostrarRestante && (
              <div className="fx-total-linea fx-total-linea--restante">
                <span>Restante (Adeudado)</span><span><Money value={t.restante} cur={false} /></span>
              </div>
            )}
          </div>
        </section>

        <footer className="fx-nota">
          Los precios no incluyen ITBIS: se suma encima · el número lo asigna el sistema al guardar ·
          convertir la cotización en factura no la modifica
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar fx-bar--ancha">
        <div className="fx-bar-total">
          {editando && hayCambios ? (
            <span className="fx-cambios">Cambios sin guardar</span>
          ) : (
            <span className="text-sm muted">
              {enUso.length === 0 ? 'Sin líneas todavía' : `${enUso.length} ${enUso.length === 1 ? 'línea' : 'líneas'}`}
            </span>
          )}
          <b><Money value={t.total} cur={false} /></b>
        </div>
        <div className="row gap-sm fx-acciones">
          {desactualizada ? (
            // 409: el formato de la empresa cambió y esta pantalla ya no sirve
            // para guardar. Se dice en la barra, que siempre está a la vista.
            <>
              <span className="fx-motivo fx-motivo--alerta" role="alert">{desactualizada}</span>
              <Btn variant="primary" icon="refresh-cw" onClick={recargar}>Recargar</Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={() => nav('cotizaciones')}>Cancelar</Btn>
              <Btn variant="secondary" icon="eye" onClick={() => void vistaPrevia()} disabled={previewing || !listo}>
                {previewing ? 'Generando…' : 'Vista previa'}
              </Btn>
              <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={guardando || borrando || !listo}>
                {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cotización'}
              </Btn>
            </>
          )}
        </div>
      </div>

      {nuevoCliente && (
        <NewClientModal
          // Lo que ya escribió (como nombre libre o en el buscador) no se vuelve a teclear.
          nombreInicial={clienteLibre.trim() || busquedaCliente}
          onClose={() => setNuevoCliente(false)}
          onCreated={seleccionarCliente}
        />
      )}
    </div>
  )
}
```

How it meets spec 8.1, for the reviewer:
- Header: logo, emisor, RNC formatted like the PDF, "Cotización mercancías", the number or "Se asigna al guardar", and
  the date input (`hoyLocal()` by default).
- Client: `ClientCombobox` + `NombreClienteLibre` + `+` (`NewClientModal`); the RNC/cédula line under it appears once the
  full client is known (on edit, after `['clients','detail',id]` replaces the provisional card).
- Lines: `.fx-grid-cot-fer` with Cant. | Unidad | Descripción | Precio | ITBIS | Valor total. A catalog pick fills
  `product_id`, name, `p.precio` (without ITBIS), unit, `indFactFromItbis(p.itbis)` and Bien/Servicio; "Línea libre" is
  18% / unit 43 / Bien (its Bien/Servicio can be switched in the line footer). Quantity step and keyboard follow
  `admiteDecimales`; `problemaCantidad` validates. Line totals use `Money` (`fmt`); the catalog price uses `fmtPrecio`.
  The Precio column is an editable number input, shown raw like in `InvoiceFormView`.
- Totals: Sub-total, ITBIS label from `etiquetaItbis`, the "Cargos y abonos" group (opens by itself and can't be hidden
  while it has a value), `Total RD$`, then the retención and abono deductions and "Restante (Adeudado)" only when
  `mostrarRestante`. On edit the box is checked when `aNumero(ajustes.retencion_isr) > 0`.
- Actions: Vista previa (with `id` when editing), Guardar through `useAccionUnica`, inline delete confirmation, no email
  switch, `useAvisoSalida` (new: anything typed; edit: any difference from the loaded snapshot).

- [ ] **Step 10: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
node scripts/test-schema-cotizacion-ferreteria.ts | tail -1
git diff --quiet -- src/features/cotizaciones/CotizacionFormView.tsx && echo "CotizacionFormView intacto"
git diff -U0 -- src/features/expenses/GastoFormModal.tsx | wc -l
git status --short
```

Expected:
- `tsc=0` and `eslint=0`, with no diagnostics (no `react-hooks/exhaustive-deps` warnings either).
- `build=0`. The only warning is the existing `(!) Some chunks are larger than 500 kB after minification`.
- `25/25 OK`, `CotizacionFormView intacto`, and `0` (GastoFormModal untouched).
- `git status --short`:

```
 M src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
 M src/features/products/ProductoCombobox.tsx
 M src/styles/factura-doc.css
?? scripts/test-schema-cotizacion-ferreteria.ts
?? src/features/cotizaciones/formatos/ferreteria/schema.ts
```

- [ ] **Step 11: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add scripts/test-schema-cotizacion-ferreteria.ts src/features/cotizaciones/formatos/ferreteria/schema.ts src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx src/features/products/ProductoCombobox.tsx src/styles/factura-doc.css
git commit -F - <<'EOF'
feat(cotizaciones): formulario de cotizacion de Ferreteria

FerreteriaCotizacionForm arma la cotizacion como la hoja de Excel de la
tienda: lineas del catalogo (o libres) con unidad e ITBIS y precio sin
ITBIS, Sub-total / ITBIS / TOTAL con totalesFerreteria, y el grupo de
cargos y abonos (cargos bancarios, manejos, mano de obra, retencion 5% y
abono) con Restante solo si hay retencion o abono. Manda siempre
formato:'ferreteria', la fecha solo si cambio el dia al editar, el id en
la vista previa al editar y la retencion como booleano; un 409 pide
recargar. schema.ts (Zod) valida con errores por linea y arma el cuerpo
del API; scripts/test-schema-cotizacion-ferreteria.ts lo prueba con node.
ProductoCombobox gana mostrarPrecio (por defecto sigue mostrando el
costo) y factura-doc.css la rejilla .fx-grid-cot-fer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit; `git status --short` shows nothing from this task.

**For Task 16 (browser, local mock only; tenant branding `cotizacion_formato: 'ferreteria'`):**
- "Nueva cotización" opens "Cotización mercancías" with "Se asigna al guardar", today's date, "Nombre o razón social *".
- Save with nothing: toast "Revisa 2 campos de la cotización.", the client box in red with "Elige un cliente de la lista
  o créalo con el botón +." and "Agrega al menos una línea: …" in the empty lines area.
- The catalog search lists "Precio 935.00" / "Precio 84.7458" (GastoFormModal still shows "Costo"). Picking a product by
  metre (`permite_decimales: true`) allows 1.5; one by unit marks 1.5 with "no admite fracciones".
- A free line with "CORTE DE TUBO" pasted with a line break is saved as one line; its footer toggles Bien/Servicio.
- Pintura lines (spec 6.2) give 41,860.00 / ITBIS 18% 7,534.80 / TOTAL 49,394.80; ticking retención and abono 10,000
  shows −2,093.00, −10,000.00 and Restante 37,301.80; abono 50,000 is rejected with "El abono (RD$ 50,000.00) no puede
  ser mayor que lo adeudado (RD$ 49,394.80)."
- The mock's logged POST body is exactly `CotizacionFerreteriaInput` (no `total`, no `user_id`, no `sent_email`), with
  `date` = chosen day + current time. The list then shows the new `COT-…`.
- Editing it: number and date kept, retención box restored, "Vista previa" body has `id` and no `date`; changing only
  the day sends `date`; "Cambios sin guardar" appears and disappears when the value is put back; leaving with changes
  asks "¿Salir sin guardar?".
- Delete asks "¿Eliminar esta cotización?" inline and returns to the list.
- Mock answering 409 to POST: the bar shows "La pantalla de cotizaciones está desactualizada (cambió el formato de tu
  empresa). Recarga la página." with "Recargar", which reloads without a second "leave" prompt (and lands on the list).
- 375 px: no horizontal scroll; each line stacks description, Cant. | Unidad, Precio | ITBIS, Valor total on the right.

---

## Part H: Tasks 13, 14 and 15


Repo: FE = `C:/Users/Signos/Documents/edwin/fiscalo`, branch `feat/cotizacion-formatos`. Every command below runs from
that directory.

Verification status: the planner's run log for this group was not returned, so the outputs quoted in the "Expected"
blocks below are the planner's predictions, cross-checked by the consistency review against the contract and the final
plans of Tasks 9-12 (names, types, labels, file paths) and by recomputing every amount with `montosLinea.redondear`
(e.g. 2.5 × 16.166 = 40.415 → 40.42; 15,064.25 + 2,686.17 = 17,750.42). If a step prints something else, stop and
reconcile it with the owning task before moving on; never loosen an assertion to make it pass.

Things to know before starting:
- **Line endings.** `CotizacionesView.tsx`, `InvoiceFormView.tsx` and `App.tsx` are CRLF; `SimpleInvoiceFormView.tsx`
  is LF. Use the Edit tool with the exact text shown (it keeps each file's endings). New files are written LF; with
  `core.autocrlf=true` git warns `LF will be replaced by CRLF`, which is normal.
- **Gates.** `npm run typecheck`, `npx eslint src scripts`, `npm run build`. Don't use `npm run lint` as a gate: it runs
  `eslint .` and is already red on this branch because of `ds-bundle/` (see Group F). Task 10 already added `scripts`
  to tsconfig's `include`, so `npm run typecheck` also checks the script of Task 13.
- **Line numbers.**
  - `CotizacionesView.tsx` and `SimpleInvoiceFormView.tsx`: no earlier task edits them, so the numbers are today's.
  - `InvoiceFormView.tsx`: Task 9 changes line 29 in place and deletes lines 142-146, so everything after line 146 is
    5 lines higher when Task 14 runs. Numbers are given after Task 9, with today's in parentheses.
  - `App.tsx`: Task 11 edits only the cotización import (line 20) and the `'cotizacion-nueva'` case (lines 166-167).
    Task 15 uses line 44 and lines 157-159; confirm them with the grep in Task 15 Step 1.
- Re-read each file right before editing it: other sessions share this checkout.
- Gratex must not change: `CotizacionFormView.tsx` is never edited, the Gratex `toFacturaPrefill` stays as it is, and a
  Gratex row keeps its single "Facturar" button.
- **Never against production.** Browser checks belong to Task 16, against the local mock. Each task ends with the exact
  list Task 16 must check.

---

### Task 13: Ferretería conversion helpers and the per-formato cotizaciones list

**Files:**
- Create: `src/features/cotizaciones/formatos/ferreteria/conversion.ts`
- Create: `scripts/test-conversion-ferreteria.ts`
- Modify: `src/features/cotizaciones/CotizacionesView.tsx`
  - imports, lines 3-10;
  - component state, after line 38 (`const [pdfBusy, ...]`);
  - the loading branch, line 87;
  - the table header, line 99;
  - the Descripción cell, line 105;
  - the Facturar button, lines 113-116.
- Test: `node scripts/test-conversion-ferreteria.ts`, then the gates.

**Interfaces:**
- Consumes:
  - From Task 9 (`src/types/domain.ts`): `FacturaPrefill` (with `precioConItbis?`, `avisos?`, and `prodId?`, `unidadMedida?`,
    `indFact?`, `tipoItem?` on each line) and `FacturaSimplePrefill`.
  - From Task 9 (`src/api/types.ts`): `CotizacionRow.ajustes?: Record<string, string | number>`, `CotizacionRow.formato?`, and
    `CotizacionItemRow.product_id?`, `unidad_medida?`, `indicador_facturacion?`, `indicador_bien_servicio?`.
  - From Task 9 (`src/config/navigation.ts`): `NavPayload` includes `FacturaSimplePrefill`.
  - From Task 11 (`src/features/cotizaciones/formatos/index.ts`):
    ```ts
    export type FormatoId = 'gratex' | 'ferreteria'
    export function formatoDeFila(row: { formato?: string | null } | null | undefined): FormatoId   // unknown/null => 'gratex'
    export function useCotizacionFormato(): { formato: FormatoId; cargando: boolean; error: string | null }
    // error is non-null only when branding failed AND nothing is cached (G_T11_T12.md, Task 11 Step 4)
    ```
  - Existing: `itbisRate(ind: IndicadorFacturacion): number` and `redondear(x: number, dec: number): number`
    (`src/features/invoices/montosLinea.ts:12` and `:41` after Task 9); `aNumero(v: unknown): number` and
    `fmt(n: number): string` (`src/lib/format.ts:30` and `:12`); `puedeVerVista(user, view)` (`src/config/navigation.ts:239`);
    `useSession()` (`src/stores/auth.ts:58`); `Dropdown` and `MenuItem` (`src/components/ui/Dropdown.tsx:26` and `:132`).
- Produces (contract):
  ```ts
  // src/features/cotizaciones/formatos/ferreteria/conversion.ts
  export function ferreteriaAFacturaPrefill(c: CotizacionRow): FacturaPrefill        // precioConItbis:false, avisos for cargos
  export function ferreteriaAFacturaSimplePrefill(c: CotizacionRow): FacturaSimplePrefill  // precio = redondear(amount*(1+tasa),4)
  export function avisosCargos(c: CotizacionRow): string[]
  ```

Rules the helpers implement (spec 8.3):
- Client and origin as in the Gratex conversion: `clienteId = String(client_id)` or `''`, `clienteNombre = client_name || ''`,
  `origen = code || '#id'`. Lines with a blank description are dropped, as in the Gratex conversion.
- e-CF: `precioConItbis: false`. Each line copies its product (`prodId`, only when `product_id > 0`), unit (`Number()` of
  the API string, 43 when missing), indicator (1-4, else 1) and bien/servicio (`2` → `'Servicio'`, else `'Bien'`). The
  price is the quote's `amount`, without ITBIS.
- Factura simple: `precio = redondear(amount × (1 + tasa), 4)`, with `tasa = itbisRate(indicador)`. The unit is copied
  when present, else `null` (the form doesn't send it).
- `avisosCargos`: one aviso when `cargos_bancarios`, `manejo_bancario` or `mano_obra` is > 0, listing them in the PDF's
  order with `RD$ fmt(x)`. Retención and abono are not copied and get no aviso. A Gratex row (`ajustes` = `{}`) gets none.
- Discount: the helpers set none. The target form applies the client's fixed discount when the client loads (Tasks 14
  and 15).

- [ ] **Step 1: Check the prerequisites (Tasks 9 to 12 are committed)**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
grep -n "export function isFacturaSimplePrefill" src/config/navigation.ts
grep -n "precioConItbis?: boolean" src/types/domain.ts
grep -n "ajustes?: Record<string, string | number>" src/api/types.ts
grep -nE "export (type FormatoId|function formatoDeFila|function useCotizacionFormato)" src/features/cotizaciones/formatos/index.ts
ls src/features/cotizaciones/formatos/ferreteria/
```

Expected:
- `git status --short` prints nothing. If another session left uncommitted work, leave it alone and stage only this
  task's files.
- Each grep prints one line. The last one prints three: `FormatoId`, `formatoDeFila` and `useCotizacionFormato`.
  - **If one is missing, stop.** Tasks 9 and 11 haven't landed, and this task needs their exact names.
- `ls` shows Task 10's `totales.ts` and Task 12's files (`FerreteriaCotizacionForm.tsx`, `schema.ts`), and no
  `conversion.ts` yet.

- [ ] **Step 2: Write the test script before the code**

Create `scripts/test-conversion-ferreteria.ts`:

```ts
// Conversión de una cotización de Ferretería en factura (spec 8.3): los
// borradores con que se abren la factura e-CF y la factura simple, y el aviso
// de los cargos que no se copian. Las filas son como las de
// GET /api/cotizaciones: los DECIMAL llegan como texto y las columnas INT
// como número.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-conversion-ferreteria.ts
import type { CotizacionRow } from '../src/api/types.ts'
import { r2 } from '../src/features/invoices/montosLinea.ts'
import {
  avisosCargos, ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill,
} from '../src/features/cotizaciones/formatos/ferreteria/conversion.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves. Una clave con undefined
// cuenta como ausente: JSON.stringify la omite igual.
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

const CLIENTE = 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO'
const fila: CotizacionRow = {
  id: 12,
  code: 'COT-000012',
  date: '2026-09-02 10:15:00',
  client_id: 7,
  client_name: CLIENTE,
  formato: 'ferreteria',
  numero: 12,
  subtotal: '15064.25',
  itbis: '2686.17',
  // 15,064.25 + 2,686.17 + cargos 100.00 + mano de obra 1,500.00 (the same row as Task 16's mock COT-000012).
  total: '19350.42',
  // Retención y abono no son cargos: no pasan a la factura ni generan aviso.
  ajustes: { cargos_bancarios: '100.00', mano_obra: '1500.00', abono: '1000.00', retencion_isr: '753.21' },
  items: [
    { id: 1, cotizacion_id: 12, description: 'GALONES DE PINTURA BLNACA SEMIGLOSS', quantity: '7.000', amount: '2000.0000',
      subtotal: '14000.00', product_id: 55, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1,
      itbis_amount: '2520.00' },
    { id: 2, cotizacion_id: 12, description: 'INSTALACION DE LAVAMANOS', quantity: '1.000', amount: '1000.0000',
      subtotal: '1000.00', product_id: 56, unidad_medida: '43', indicador_facturacion: 2, indicador_bien_servicio: 2,
      itbis_amount: '160.00' },
    // Línea libre (sin producto), con otra unidad y espacios alrededor del texto.
    { id: 3, cotizacion_id: 12, description: '  CORTE DE TUBO ', quantity: '2.500', amount: '13.7000',
      subtotal: '34.25', product_id: null, unidad_medida: '47', indicador_facturacion: 1, indicador_bien_servicio: 1,
      itbis_amount: '6.17' },
    { id: 4, cotizacion_id: 12, description: 'TODO EXENTO', quantity: '3.000', amount: '10.0000',
      subtotal: '30.00', product_id: 57, unidad_medida: '43', indicador_facturacion: 4, indicador_bien_servicio: 1,
      itbis_amount: '0.00' },
    // Sin descripción no hay qué facturar: se descarta, como en la conversión de Gratex.
    { id: 5, cotizacion_id: 12, description: '   ', quantity: '1.000', amount: '5.0000' },
  ],
}
const AVISO = 'La cotización COT-000012 tenía cargos adicionales: Cargos bancarios RD$ 100.00, '
  + 'Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.'

// --- Factura e-CF ----------------------------------------------------------
const ecf = ferreteriaAFacturaPrefill(fila)
igual('e-CF: kind factura-prefill', ecf.kind, 'factura-prefill')
igual('e-CF: cliente de la cotización', [ecf.clienteId, ecf.clienteNombre], ['7', CLIENTE])
igual('e-CF: origen = code', ecf.origen, 'COT-000012')
igual('e-CF: precioConItbis false (los precios de Ferretería no traen ITBIS)', ecf.precioConItbis, false)
igual('e-CF: aviso de los cargos (no de retención ni abono)', ecf.avisos, [AVISO])
igual('e-CF: 4 líneas (la de descripción en blanco se descarta)', ecf.lineas.length, 4)
igual('e-CF: producto al 18%, ligado al catálogo', ecf.lineas[0], {
  nombre: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2000, prodId: '55', unidadMedida: 43, indFact: 1,
  tipoItem: 'Bien',
})
igual('e-CF: servicio al 16%', ecf.lineas[1], {
  nombre: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1000, prodId: '56', unidadMedida: 43, indFact: 2,
  tipoItem: 'Servicio',
})
igual('e-CF: línea libre sin prodId, con su unidad y el texto recortado', ecf.lineas[2], {
  nombre: 'CORTE DE TUBO', cantidad: 2.5, precio: 13.7, unidadMedida: 47, indFact: 1, tipoItem: 'Bien',
})
igual('e-CF: exento', ecf.lineas[3], {
  nombre: 'TODO EXENTO', cantidad: 3, precio: 10, prodId: '57', unidadMedida: 43, indFact: 4, tipoItem: 'Bien',
})

// --- Factura simple --------------------------------------------------------
const simple = ferreteriaAFacturaSimplePrefill(fila)
igual('simple: kind factura-simple-prefill', simple.kind, 'factura-simple-prefill')
igual('simple: cliente y origen', [simple.clienteId, simple.clienteNombre, simple.origen], ['7', CLIENTE, 'COT-000012'])
igual('simple: el mismo aviso de cargos', simple.avisos, [AVISO])
igual('simple: 4 líneas', simple.lineas.length, 4)
igual('simple: 2,000 al 18% → 2,360 con ITBIS', simple.lineas[0], {
  prodId: '55', descripcion: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2360, unidadMedida: 43,
})
igual('simple: 1,000 al 16% → 1,160', simple.lineas[1], {
  prodId: '56', descripcion: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1160, unidadMedida: 43,
})
igual('simple: 13.70 al 18% → 16.166 (r4, sin el ruido binario de 16.165999…)', simple.lineas[2], {
  descripcion: 'CORTE DE TUBO', cantidad: 2.5, precio: 16.166, unidadMedida: 47,
})
igual('simple: exento, el precio no cambia', simple.lineas[3], {
  prodId: '57', descripcion: 'TODO EXENTO', cantidad: 3, precio: 10, unidadMedida: 43,
})
igual('simple: 7 × 2,360.0000 = 16,520.00 (ejemplo del spec)', r2(simple.lineas[0].cantidad * simple.lineas[0].precio), 16520)

// --- avisosCargos ----------------------------------------------------------
igual('avisos: fila de Gratex (ajustes {}) → ninguno', avisosCargos({ id: 1, ajustes: {} }), [])
igual('avisos: sin ajustes → ninguno', avisosCargos({ id: 1 }), [])
igual('avisos: solo retención y abono → ninguno',
  avisosCargos({ ...fila, ajustes: { abono: '1000.00', retencion_isr: '753.21' } }), [])
igual('avisos: un cargo, el texto del spec', avisosCargos({ ...fila, ajustes: { mano_obra: '1500.00' } }), [
  'La cotización COT-000012 tenía cargos adicionales: Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.',
])
igual('avisos: los tres cargos, en el orden del PDF',
  avisosCargos({ ...fila, ajustes: { mano_obra: '1500.00', manejo_bancario: '50.00', cargos_bancarios: '100.00' } }), [
    'La cotización COT-000012 tenía cargos adicionales: Cargos bancarios RD$ 100.00, Manejos de operaciones bancarias '
    + 'RD$ 50.00, Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.',
  ])
igual('avisos: un cargo en 0.00 no cuenta', avisosCargos({ ...fila, ajustes: { mano_obra: '0.00' } }), [])

// --- Fila sin code, sin cliente y sin las columnas de la 026 ----------------
const vieja: CotizacionRow = {
  id: 12,
  client_id: null,
  client_name: null,
  items: [{ description: 'SIN DATOS DEL CATALOGO', quantity: '1.000', amount: '100.0000' }],
}
const ecfVieja = ferreteriaAFacturaPrefill(vieja)
igual('sin code: el origen es #id', ecfVieja.origen, '#12')
igual('sin cliente: clienteId y nombre vacíos', [ecfVieja.clienteId, ecfVieja.clienteNombre], ['', ''])
igual('e-CF sin columnas de la 026: los defaults de una línea libre', ecfVieja.lineas, [
  { nombre: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 100, unidadMedida: 43, indFact: 1, tipoItem: 'Bien' },
])
igual('simple sin columnas de la 026: 18% por defecto y sin unidad', ferreteriaAFacturaSimplePrefill(vieja).lineas, [
  { descripcion: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 118, unidadMedida: null },
])
igual('sin code: el aviso nombra #id', avisosCargos({ ...vieja, ajustes: { cargos_bancarios: '25.50' } }), [
  'La cotización #12 tenía cargos adicionales: Cargos bancarios RD$ 25.50 — agrégalos como línea si corresponde.',
])

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
```

Why it's built this way:
- The output follows the house style (`  [OK  ] …`, `  [FALLA] …`, `N/M OK`, exit 1 on any failure), like Task 10's
  parity script.
- The row has the shapes the API really sends after Tasks 7 and 9: DECIMAL columns as strings, INT columns as numbers,
  `product_id: null` on a free line. The conversion reads every field with `aNumero`, so a string `product_id` would
  work too.
- `ordenar` makes the comparison exact but independent of key order, so the test doesn't depend on how the object
  literals are written.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/test-conversion-ferreteria.ts; echo "exit=$?"
```

Expected:
- `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Signos\Documents\edwin\fiscalo\src\features\cotizaciones\formatos\ferreteria\conversion.ts' imported from C:\Users\Signos\Documents\edwin\fiscalo\scripts\test-conversion-ferreteria.ts`
- `exit=1`.

- [ ] **Step 4: Implement `conversion.ts`**

Create `src/features/cotizaciones/formatos/ferreteria/conversion.ts`:

```ts
// Facturar una cotización de Ferretería (spec 8.3): arma el borrador con que
// se abre la factura e-CF (InvoiceFormView) o la factura simple
// (SimpleInvoiceFormView). Solo datos: los dos formularios siguen editables y
// aplican el descuento fijo del cliente al cargarlo, igual que al elegirlo a
// mano.
//
// Lo que NO se copia: los cargos adicionales (cargos bancarios, manejo, mano
// de obra) van como aviso, porque el usuario decide si los cobra en la
// factura; retención y abono tampoco, porque el cobro se registra en la factura.
//
// Imports de valor SOLO por ruta relativa con .ts (como totales.ts): así
// scripts/test-conversion-ferreteria.ts carga este archivo con `node` tal cual.
// Lo de '@/…' va solo como `import type`, que Node borra.
import type { CotizacionItemRow, CotizacionRow, IndicadorFacturacion } from '@/api'
import type { FacturaPrefill, FacturaSimplePrefill } from '@/types/domain'
import { itbisRate, redondear } from '../../../invoices/montosLinea.ts'
import { aNumero, fmt } from '../../../../lib/format.ts'

/** Ajustes que suben el TOTAL de la cotización (sin ITBIS), en el orden del PDF. */
const CARGOS: { clave: string; etiqueta: string }[] = [
  { clave: 'cargos_bancarios', etiqueta: 'Cargos bancarios' },
  { clave: 'manejo_bancario', etiqueta: 'Manejos de operaciones bancarias' },
  { clave: 'mano_obra', etiqueta: 'Costo mano de obra' },
]

/** Cómo la nombra el banner de la factura: su código, o el id (mismo criterio que la conversión de Gratex). */
const origenDe = (c: CotizacionRow): string => c.code || `#${c.id}`

const clienteDe = (c: CotizacionRow) => ({
  clienteId: c.client_id != null ? String(c.client_id) : '',
  clienteNombre: c.client_name || '',
})

/**
 * Aviso de los cargos que la factura no trae, con sus montos. Vacío si la
 * cotización no tenía ninguno (una de Gratex llega con `ajustes` = {}).
 */
export function avisosCargos(c: CotizacionRow): string[] {
  const cargos = CARGOS
    .map(({ clave, etiqueta }) => ({ etiqueta, monto: aNumero(c.ajustes?.[clave]) }))
    .filter((x) => x.monto > 0)
  if (cargos.length === 0) return []
  const lista = cargos.map((x) => `${x.etiqueta} RD$ ${fmt(x.monto)}`).join(', ')
  return [`La cotización ${origenDe(c)} tenía cargos adicionales: ${lista} — agrégalos como línea si corresponde.`]
}

/** Las líneas con texto: una sin descripción no tiene qué facturar. */
const conTexto = (c: CotizacionRow): CotizacionItemRow[] =>
  (c.items ?? []).filter((it) => (it.description ?? '').trim() !== '')

/** indicador_facturacion de la línea. Ausente o fuera de 1-4: 1 (18%), lo que el backend guarda por defecto. */
function indicadorDe(it: CotizacionItemRow): IndicadorFacturacion {
  const n = aNumero(it.indicador_facturacion)
  return n === 2 || n === 3 || n === 4 ? n : 1
}

/** El producto ligado, como el id de texto de los formularios. Línea libre: nada. */
function productoDe(it: CotizacionItemRow): { prodId?: string } {
  const id = aNumero(it.product_id)
  return id > 0 ? { prodId: String(id) } : {}
}

/** Código DGII de la unidad (la API lo manda como texto, ej. '43'). 0 = no vino. */
const unidadDe = (it: CotizacionItemRow): number => aNumero(it.unidad_medida)

/**
 * Borrador de la factura e-CF. Precios SIN ITBIS, como en la cotización (la
 * factura lo suma encima), y cada línea con su producto, unidad, indicador y
 * bien/servicio: emitir el e-CF descuenta inventario como cualquier venta.
 */
export function ferreteriaAFacturaPrefill(c: CotizacionRow): FacturaPrefill {
  return {
    kind: 'factura-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    precioConItbis: false,
    avisos: avisosCargos(c),
    lineas: conTexto(c).map((it) => ({
      nombre: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: aNumero(it.amount),
      ...productoDe(it),
      unidadMedida: unidadDe(it) || 43,
      indFact: indicadorDe(it),
      tipoItem: aNumero(it.indicador_bien_servicio) === 2 ? 'Servicio' : 'Bien',
    })),
  }
}

/**
 * Borrador de la factura simple. La factura simple no desglosa ITBIS, así que
 * cada precio lo trae incluido, r4(precio × (1 + tasa)), y el cliente paga
 * casi el TOTAL cotizado (unos centavos de diferencia por redondear cada
 * precio; el spec lo acepta). La unidad viaja solo si la cotización la tenía.
 */
export function ferreteriaAFacturaSimplePrefill(c: CotizacionRow): FacturaSimplePrefill {
  return {
    kind: 'factura-simple-prefill',
    ...clienteDe(c),
    origen: origenDe(c),
    avisos: avisosCargos(c),
    lineas: conTexto(c).map((it) => ({
      ...productoDe(it),
      descripcion: (it.description ?? '').trim(),
      cantidad: aNumero(it.quantity ?? 1),
      precio: redondear(aNumero(it.amount) * (1 + itbisRate(indicadorDe(it))), 4),
      unidadMedida: unidadDe(it) || null,
    })),
  }
}
```

Notes:
- The relative paths climb `ferreteria` → `formatos` → `cotizaciones` → `features` (`../../../`), the same as
  `totales.ts`; `lib/format.ts` is one level more (`../../../../`). `lib/format.ts` imports nothing, and
  `montosLinea.ts` only has an `import type`, so Node loads both as they are.
- `n === 2 || n === 3 || n === 4 ? n : 1` narrows `n` to `2 | 3 | 4`, so the result is an `IndicadorFacturacion`
  without a cast.

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node scripts/test-conversion-ferreteria.ts; echo "exit=$?"
```

Expected: 30 lines starting with `  [OK  ]`, then `30/30 OK` and `exit=0`. For example:

```
  [OK  ] e-CF: kind factura-prefill
  [OK  ] e-CF: precioConItbis false (los precios de Ferretería no traen ITBIS)
  [OK  ] e-CF: aviso de los cargos (no de retención ni abono)
  ...
  [OK  ] simple: 13.70 al 18% → 16.166 (r4, sin el ruido binario de 16.165999…)
  [OK  ] simple: 7 × 2,360.0000 = 16,520.00 (ejemplo del spec)
  ...
  [OK  ] sin code: el aviso nombra #id

30/30 OK
exit=0
```

- [ ] **Step 6: Confirm the test catches a broken rule, then restore it**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
F=src/features/cotizaciones/formatos/ferreteria/conversion.ts
sed -i 's/precioConItbis: false,/precioConItbis: true,/' "$F"
node scripts/test-conversion-ferreteria.ts | grep -E "FALLA|/[0-9]+ OK"; echo "exit=${PIPESTATUS[0]}"
sed -i 's/precioConItbis: true,/precioConItbis: false,/' "$F"
grep -c "precioConItbis: false," "$F"
node scripts/test-conversion-ferreteria.ts | tail -1
```

Expected:
- One `  [FALLA] e-CF: precioConItbis false (los precios de Ferretería no traen ITBIS): dio true, se esperaba false`.
- `29/30 OK` and `exit=1`.
- After the restore: `1`, then `30/30 OK`.

- [ ] **Step 7: `CotizacionesView.tsx`: imports**

In `src/features/cotizaciones/CotizacionesView.tsx`, find (lines 3-10):

```tsx
import { Icon, Btn, RefreshButton, Money, Avatar, Card, PageHead, EmptyState, LoadingState, ErrorState } from '@/components/ui'
import { ApiError, listCotizaciones, getCotizacionPdf, formatApiDate } from '@/api'
import type { CotizacionRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import { aNumero } from '@/lib/format'
import type { Nav } from '@/config/navigation'
import type { FacturaPrefill } from '@/types/domain'
```

and replace it with:

```tsx
import {
  Icon, Btn, RefreshButton, Money, Avatar, Card, PageHead, EmptyState, LoadingState, ErrorState, Dropdown, MenuItem,
} from '@/components/ui'
import { ApiError, listCotizaciones, getCotizacionPdf, formatApiDate } from '@/api'
import type { CotizacionRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'
import { aNumero } from '@/lib/format'
import { useSession } from '@/stores/auth'
import { puedeVerVista, type Nav } from '@/config/navigation'
import type { FacturaPrefill } from '@/types/domain'
import { formatoDeFila, useCotizacionFormato, type FormatoId } from './formatos'
import { ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill } from './formatos/ferreteria/conversion'
```

The Gratex `toFacturaPrefill` (lines 14-31) stays exactly as it is.

- [ ] **Step 8: `CotizacionesView.tsx`: the tenant's formato and the permissions**

Find (lines 35-38):

```tsx
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)
```

and replace it with:

```tsx
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)
  const { user } = useSession()

  // Las columnas siguen el formato del tenant; las acciones, el de cada fila
  // (una cotización guardada con otro formato se factura con sus reglas). Si
  // branding falla se usan las columnas de Gratex: es un listado de solo
  // lectura y no hay nada que se pueda guardar mal.
  const formatoTenant = useCotizacionFormato()
  const columnas: FormatoId = formatoTenant.error != null ? 'gratex' : formatoTenant.formato
  // Facturar ofrece solo los destinos que el rol puede abrir (mismo criterio que el sidebar).
  const puedeEcf = puedeVerVista(user, 'factura-nueva')
  const puedeSimple = puedeVerVista(user, 'factura-simple-nueva')
```

- [ ] **Step 9: `CotizacionesView.tsx`: wait for branding, then the columns**

Find (line 87):

```tsx
        {loading ? (
```

and replace it with:

```tsx
        {/* Espera también al formato: sin él no se sabe qué columnas van, y
            montar unas para cambiarlas al momento se ve como un salto. */}
        {loading || formatoTenant.cargando ? (
```

Find (line 99):

```tsx
              <thead><tr><th>Código</th><th>Cliente</th><th>Descripción</th><th>Fecha</th><th className="num">Total</th><th style={{ width: 190 }}></th></tr></thead>
```

and replace it with:

```tsx
              {/* Ferretería: Número | Cliente | Fecha | Total (su hoja no tiene
                  resumen de descripciones). Gratex, como siempre. */}
              <thead>
                <tr>
                  <th>{columnas === 'gratex' ? 'Código' : 'Número'}</th>
                  <th>Cliente</th>
                  {columnas === 'gratex' && <th>Descripción</th>}
                  <th>Fecha</th>
                  <th className="num">Total</th>
                  <th style={{ width: columnas === 'gratex' ? 190 : 210 }}></th>
                </tr>
              </thead>
```

Find (line 105):

```tsx
                    <td className="text-sm muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
```

and replace it with:

```tsx
                    {columnas === 'gratex' && (
                      <td className="text-sm muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
                    )}
```

Line 103 (the code cell) doesn't change: it already shows `c.code || '#id'`, which is the Número column for
Ferretería.

- [ ] **Step 10: `CotizacionesView.tsx`: Facturar ▾ on Ferretería rows**

Find (lines 113-116):

```tsx
                        <Btn variant="secondary" size="sm" icon="file-text" title="Convertir a factura e-CF"
                          onClick={() => nav('factura-nueva', toFacturaPrefill(c))}>
                          Facturar
                        </Btn>
```

and replace it with:

```tsx
                        {formatoDeFila(c) === 'ferreteria' ? (
                          // Ferretería factura a e-CF o a factura simple. Cada destino
                          // sale solo si el rol puede abrirlo; sin ninguno, no hay botón.
                          (puedeEcf || puedeSimple) && (
                            <Dropdown
                              align="right"
                              width={220}
                              trigger={
                                <Btn variant="secondary" size="sm" icon="file-text" iconRight="chevron-down" title="Convertir en factura">
                                  Facturar
                                </Btn>
                              }
                            >
                              {puedeEcf && (
                                <MenuItem icon="file-text" onClick={() => nav('factura-nueva', ferreteriaAFacturaPrefill(c))}>
                                  Factura electrónica (e-CF)
                                </MenuItem>
                              )}
                              {puedeSimple && (
                                <MenuItem icon="file" onClick={() => nav('factura-simple-nueva', ferreteriaAFacturaSimplePrefill(c))}>
                                  Factura simple
                                </MenuItem>
                              )}
                            </Dropdown>
                          )
                        ) : (
                          <Btn variant="secondary" size="sm" icon="file-text" title="Convertir a factura e-CF"
                            onClick={() => nav('factura-nueva', toFacturaPrefill(c))}>
                            Facturar
                          </Btn>
                        )}
```

Why this works inside the clickable row:
- The cell at line 108 already stops the click (`onClick={(e) => e.stopPropagation()}`), so opening the menu doesn't
  open the editor.
- `Dropdown` renders its menu in a portal on `document.body`, but React events bubble through the React tree, so a
  click on a `MenuItem` also stops at that cell.
- The Gratex branch is the old button, byte for byte.

- [ ] **Step 11: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
node scripts/test-conversion-ferreteria.ts | tail -1
git diff --quiet -- src/features/cotizaciones/CotizacionFormView.tsx && echo "CotizacionFormView intacto"
git diff -U0 src/features/cotizaciones/CotizacionesView.tsx | grep -n "toFacturaPrefill(c: CotizacionRow)" || echo "toFacturaPrefill de Gratex intacto"
git status --short
```

Expected:
- `tsc=0` and `eslint=0`, with no diagnostics.
- `build=0`. The only warning is the existing `(!) Some chunks are larger than 500 kB after minification`.
- `30/30 OK`, `CotizacionFormView intacto` and `toFacturaPrefill de Gratex intacto`.
- `git status --short`:

```
 M src/features/cotizaciones/CotizacionesView.tsx
?? scripts/test-conversion-ferreteria.ts
?? src/features/cotizaciones/formatos/ferreteria/conversion.ts
```

- [ ] **Step 12: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add scripts/test-conversion-ferreteria.ts src/features/cotizaciones/formatos/ferreteria/conversion.ts src/features/cotizaciones/CotizacionesView.tsx
git commit -F - <<'EOF'
feat(cotizaciones): facturar una cotizacion de Ferreteria a e-CF o factura simple

conversion.ts arma los borradores: a e-CF con precios sin ITBIS y cada linea
ligada a su producto (unidad, indicador, bien/servicio); a factura simple con
el ITBIS dentro del precio (r4). Los cargos adicionales no se copian: van
como aviso con sus montos. scripts/test-conversion-ferreteria.ts lo prueba
con node.

El listado toma las columnas del formato del tenant (Ferreteria: Numero,
Cliente, Fecha, Total) y las acciones del de cada fila: Facturar con menu
(e-CF / factura simple) segun lo que el rol puede abrir. Las filas de Gratex
no cambian.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: one new commit on `feat/cotizacion-formatos`; `git status --short` shows nothing from this task.

**What Task 16 must check in the browser (local mock only):**

Task 16 runs these checks against its own mock datasets (I_T16.md: COT-000012, COT-000013 and the new COT-000014, with the amounts in its tables); where a row, id or amount here differs from I_T16.md, I_T16.md's is the binding one. The behaviors listed here must all be covered there.

The mock needs: `GET /api/branding` with and without `cotizacion_formato`, a list page with Ferretería rows (the `fila`
of Step 2 is a ready-made row: `formato`, `ajustes`, items with `product_id`, `unidad_medida`, indicators) and at least
one row with `formato: null`, and sessions with different `permissions`.

1. Gratex tenant (branding without `cotizacion_formato`, or `'gratex'`):
   - The columns are exactly Código | Cliente | Descripción | Fecha | Total, as before.
   - Each row shows PDF and the single "Facturar" button (tooltip "Convertir a factura e-CF"), with no chevron.
2. Ferretería tenant (`cotizacion_formato: 'ferreteria'`):
   - The columns are Número | Cliente | Fecha | Total; there is no Descripción column, and Número shows `COT-000012`.
   - A row with `formato: 'ferreteria'` shows PDF and "Facturar ▾".
   - Clicking "Facturar ▾" opens a menu with "Factura electrónica (e-CF)" and "Factura simple", and does **not** open
     the cotización editor. Clicking elsewhere on the row still opens the editor.
   - Keyboard: Tab to "Facturar", Enter opens the menu with focus on the first item, ↓/↑ move, Escape closes and
     returns focus to the button.
   - "Factura electrónica (e-CF)" opens Nueva factura prefilled (checks in Task 14). "Factura simple" opens Nueva
     factura simple prefilled (checks in Task 15).
   - A row with `formato: null` in the same list shows the old single "Facturar" button.
3. Permissions (Ferretería rows):
   - `permissions: ['cotizaciones', 'facturas']` → the menu only has "Factura electrónica (e-CF)".
   - `['cotizaciones', 'facturas-simples']` → only "Factura simple".
   - `['cotizaciones']` → no Facturar control at all, only PDF.
   - `['*']`, or a session without `permissions` (fail-open) → both options.
   - On a Gratex row the single button stays ungated, as today.
4. Loading and errors:
   - While `/api/branding` is pending, the card shows the loading skeleton, never a flash of the other columns.
   - With `/api/branding` answering 500, the list shows the Gratex columns once the list loads; it doesn't stay
     loading.
5. Mobile (375 px): the table scrolls sideways inside its card (no page-wide horizontal scroll), and the Facturar menu
   opens inside the viewport (upwards on the last rows).

---

### Task 14: `InvoiceFormView` takes the Ferretería prefill

**Files:**
- Modify: `src/features/invoices/InvoiceFormView.tsx`
  - the "precio con ITBIS" switch and the prefilled lines: lines 181-192 (186-197 before Task 9);
  - the discount and avisos for the banner: after lines 289-291 (294-296), the `descuentoCliente` block;
  - the banner: lines 581-586 (586-591).
- Test: `grep` checks of the exact expressions, then the gates. The behavior is checked in the browser by Task 16.

**Interfaces:**
- Consumes (Task 9, `src/types/domain.ts`):
  ```ts
  export interface FacturaPrefill {
    kind: 'factura-prefill'; clienteId: string; clienteNombre: string; origen?: string
    precioConItbis?: boolean; avisos?: string[]
    lineas: { nombre: string; cantidad: number; precio: number; prodId?: string; unidadMedida?: number; indFact?: number; tipoItem?: 'Bien' | 'Servicio' }[]
  }
  ```
  Also the existing `Linea` (lines 32-47), `IndicadorFacturacion` (still imported at lines 9-11), and `descuentoCliente`
  (line 291 after Task 9): `cliente?.descuento ?? 0`.
- Produces: no new exports. The behavior of spec 8.3:
  - the switch starts as `useState(prefill != null && (prefill.precioConItbis ?? true))`;
  - prefilled lines use `prodId`, `unidadMedida`, `indFact` and `tipoItem` when present, otherwise `''`, 43, 1, `'Bien'`;
  - the banner keeps its exact text when `prefill.precioConItbis !== false`; otherwise it reads
    `Convertida desde la cotización X · los precios no incluyen ITBIS (se suma encima)`;
  - under it, one line per `prefill.avisos` entry, plus
    `Se aplicó el descuento fijo del cliente (X%): el total difiere del de la cotización.` when `prefill?.origen` is set
    and the loaded client's `descuento > 0`.

On the discount line:
- "The loaded client" is `cliente`, read as `descuentoCliente`. While the client is the placeholder built from the
  prefill, its `descuento` is 0, so the line only appears once the effect at lines 216-240 has loaded the real client
  and applied its discount to the lines.
- If the user then picks another client, `seleccionarCliente` applies that client's discount, and the line follows it.
  The percentage shown is always the one applied.
- It applies to any conversion with `origen`, Gratex included, as the spec's shared rule says. A Gratex conversion of a
  client without a discount looks exactly as today.

- [ ] **Step 1: Check the prerequisites and the lines to edit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git status --short
grep -n "precioConItbis?: boolean" src/types/domain.ts
grep -n "import { indFactFromItbis, montosLinea, totalesDocumento } from './montosLinea'" src/features/invoices/InvoiceFormView.tsx
grep -n "const \[precioConItbis, setPrecioConItbis\]\|const descuentoCliente\|Convertida desde la cotización" src/features/invoices/InvoiceFormView.tsx
```

Expected:
- Nothing from `git status --short`.
- The `domain.ts` grep prints one line (Task 9 is in), and the import grep prints line 29.
- The last grep prints:
  ```
  185:  const [precioConItbis, setPrecioConItbis] = useState(prefill != null)
  291:  const descuentoCliente = cliente?.descuento ?? 0
  584:            Convertida desde la cotización {prefill.origen} · los precios ya traen ITBIS incluido
  ```
  If the numbers moved, use the grep's numbers in the steps below; the find texts don't depend on them.

- [ ] **Step 2: Write the failing checks**

The switch, the lines and the banner are UI state with no pure function to call, so the test is a check of the exact
expressions the spec fixes:

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
F=src/features/invoices/InvoiceFormView.tsx
grep -cF 'useState(prefill != null && (prefill.precioConItbis ?? true))' "$F"
grep -cF "prodId: l.prodId ?? ''" "$F"
grep -cF 'los precios no incluyen ITBIS (se suma encima)' "$F"
grep -cF 'Se aplicó el descuento fijo del cliente (${descuentoCliente}%): el total difiere del de la cotización.' "$F"
```

Expected: `0` four times (the last ones also exit 1).

- [ ] **Step 3: The switch and the prefilled lines**

In `src/features/invoices/InvoiceFormView.tsx`, find (lines 181-192; 186-197 before Task 9):

```tsx
  // ¿Los precios de las líneas YA incluyen ITBIS? Las cotizaciones se cotizan
  // con impuesto incluido, así que al convertir arranca en true (editable).
  // Solo cambia cómo se leen los precios escritos: a la DGII siempre viajan
  // sin ITBIS (ver montosLinea).
  const [precioConItbis, setPrecioConItbis] = useState(prefill != null)
  const [lineas, setLineas] = useState<Linea[]>(() =>
    (prefill?.lineas ?? []).map((l, i) => ({
      id: i + 1, prodId: '', nombre: l.nombre, descripcion: '', cant: l.cantidad, precio: l.precio,
      // La cotización no distingue ITBIS ni unidad: default gravado 18% / Unidad (43).
      desc: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
    })),
  )
```

and replace it with:

```tsx
  // ¿Los precios de las líneas YA incluyen ITBIS? Una cotización de Gratex se
  // cotiza con impuesto incluido, así que al convertirla arranca en true; la de
  // Ferretería trae precios sin ITBIS y lo dice con precioConItbis: false. Una
  // factura en blanco arranca apagado. Siempre editable.
  // Solo cambia cómo se leen los precios escritos: a la DGII siempre viajan
  // sin ITBIS (ver montosLinea).
  const [precioConItbis, setPrecioConItbis] = useState(prefill != null && (prefill.precioConItbis ?? true))
  const [lineas, setLineas] = useState<Linea[]>(() =>
    (prefill?.lineas ?? []).map((l, i) => ({
      id: i + 1, prodId: l.prodId ?? '', nombre: l.nombre, descripcion: '', cant: l.cantidad, precio: l.precio,
      // Lo que el origen no trae sale con los defaults de una línea libre:
      // gravado 18%, Unidad (43), Bien (la cotización de Gratex no trae nada de
      // eso). La de Ferretería trae su producto, unidad, indicador y tipo: con
      // el producto ligado, emitir descuenta inventario.
      desc: 0, indFact: (l.indFact ?? 1) as IndicadorFacturacion, unidadMedida: l.unidadMedida ?? 43,
      tipoItem: l.tipoItem ?? 'Bien',
    })),
  )
```

`indFact` is `number` in `FacturaPrefill` (domain.ts imports nothing from `@/api`), so it's narrowed here with
`as IndicadorFacturacion`, as Task 9 planned. The Ferretería conversion only sends 1-4 (Task 13, `indicadorDe`).

- [ ] **Step 4: The avisos under the banner**

Find (lines 289-291; 294-296 before Task 9):

```tsx
  // Descuento por defecto de las líneas: el que tenga el cliente elegido. El
  // usuario puede cambiarlo línea por línea después; esto solo lo precarga.
  const descuentoCliente = cliente?.descuento ?? 0
```

and replace it with:

```tsx
  // Descuento por defecto de las líneas: el que tenga el cliente elegido. El
  // usuario puede cambiarlo línea por línea después; esto solo lo precarga.
  const descuentoCliente = cliente?.descuento ?? 0

  // Avisos bajo el banner de una conversión: lo que el origen no copió (los
  // cargos de una cotización de Ferretería) y, ya con el cliente cargado, su
  // descuento fijo. La factura lo aplica igual que al elegirlo a mano, así que
  // su total ya no es el de la cotización; mejor decirlo antes de emitir.
  const avisosConversion = prefill?.origen
    ? [
        ...(prefill.avisos ?? []),
        ...(descuentoCliente > 0
          ? [`Se aplicó el descuento fijo del cliente (${descuentoCliente}%): el total difiere del de la cotización.`]
          : []),
      ]
    : []
```

- [ ] **Step 5: The banner**

Find (lines 581-586; 586-591 before Task 9):

```tsx
        {prefill?.origen && (
          <span className="row gap-sm text-sm" style={{ color: 'var(--info)' }}>
            <Icon name="file-plus" size={15} />
            Convertida desde la cotización {prefill.origen} · los precios ya traen ITBIS incluido
          </span>
        )}
```

and replace it with:

```tsx
        {prefill?.origen && (
          <div className="col" style={{ alignItems: 'flex-end', textAlign: 'right', gap: 4, minWidth: 0 }}>
            {/* El texto de siempre mientras los precios traigan ITBIS (Gratex);
                la de Ferretería los manda sin ITBIS y el banner lo dice. */}
            <span className="row gap-sm text-sm" style={{ color: 'var(--info)' }}>
              <Icon name="file-plus" size={15} />
              {prefill.precioConItbis !== false
                ? `Convertida desde la cotización ${prefill.origen} · los precios ya traen ITBIS incluido`
                : `Convertida desde la cotización ${prefill.origen} · los precios no incluyen ITBIS (se suma encima)`}
            </span>
            {avisosConversion.map((a, i) => (
              <span key={i} className="row gap-sm text-xs" style={{ color: 'var(--warning)' }}>
                <Icon name="alert-triangle" size={13} />
                {a}
              </span>
            ))}
          </div>
        )}
```

- The first line renders exactly the old text for a Gratex prefill (`precioConItbis` absent): the template literal
  gives the same characters as the old JSX text.
- `minWidth: 0` lets the column wrap next to the back button instead of pushing it on a narrow screen.
- `.col`, `.row`, `.gap-sm`, `.text-sm` and `.text-xs` already exist (`styles.css:772-780`), and `--warning` is the color
  of the other inline warnings (`RncConsultaField.tsx:157`). No new CSS.

- [ ] **Step 6: Run the checks and the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
F=src/features/invoices/InvoiceFormView.tsx
grep -cF 'useState(prefill != null && (prefill.precioConItbis ?? true))' "$F"
grep -cF "prodId: l.prodId ?? ''" "$F"
grep -cF 'los precios no incluyen ITBIS (se suma encima)' "$F"
grep -cF 'Se aplicó el descuento fijo del cliente (${descuentoCliente}%): el total difiere del de la cotización.' "$F"
grep -cF '· los precios ya traen ITBIS incluido`' "$F"
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
git status --short
```

Expected:
- `1` five times (the last one is the unchanged Gratex text).
- `tsc=0`, `eslint=0`, `build=0` (only the existing chunk-size warning).
- `git status --short` lists only ` M src/features/invoices/InvoiceFormView.tsx`.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add src/features/invoices/InvoiceFormView.tsx
git commit -F - <<'EOF'
feat(facturas): la factura e-CF acepta el borrador de una cotizacion de Ferreteria

El interruptor "precios incluyen ITBIS" arranca con prefill.precioConItbis
(ausente = true, como la conversion de Gratex; una factura en blanco sigue
apagada). Las lineas precargadas usan producto, unidad, indicador y tipo
cuando vienen, y si no los defaults de siempre. El banner dice cuando los
precios no traen ITBIS y muestra debajo los avisos de la conversion y el
descuento fijo del cliente, que cambia el total respecto a la cotizacion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

**What Task 16 must check in the browser (local mock only; never click Emitir against anything but the mock):**

Task 16 runs these checks against its own mock datasets (I_T16.md: COT-000012, COT-000013 and the new COT-000014, with the amounts in its tables); where a row, id or amount here differs from I_T16.md, I_T16.md's is the binding one. The behaviors listed here must all be covered there.

The mock needs `GET /api/clients?id=7` for a client with `descuento` 0 and another with `descuento` 10 (and
`permite_credito` both ways), plus the stats, products and units endpoints the form already calls.

1. Blank Nueva factura (navbar "Nueva" → Factura): the "Los precios incluyen ITBIS" switch is **off**, with no banner.
2. Gratex Facturar (a row with `formato: null`):
   - The switch is **on**.
   - The banner reads exactly `Convertida desde la cotización <code> · los precios ya traen ITBIS incluido`.
   - With a client whose `descuento` is 0 there's no other line: it looks as it did before this work.
   - Each line is free: it shows "Guardar como producto", Unidad, ITBIS 18%.
3. Ferretería → "Factura electrónica (e-CF)" with the Task 13 row and a client with `descuento` 0:
   - The switch is **off**.
   - The banner reads `Convertida desde la cotización COT-000012 · los precios no incluyen ITBIS (se suma encima)`.
   - Under it, the aviso in the warning color: `La cotización COT-000012 tenía cargos adicionales: Cargos bancarios RD$ 100.00, Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.`
   - 4 lines, the blank one dropped.
     - The product lines show their tipo chip ("Bien", "Servicio") instead of "Guardar como producto".
     - The ITBIS selects read 18%, 16%, 18% and Exento.
     - The units match the quote (the free line has unit 47 if the mock's catalog has it, otherwise the form marks it
       with the unit error, which is the expected guard).
   - The totals equal the quote's Sub-total and ITBIS, and Total = Sub-total + ITBIS, without the cargos.
     - With the Step 2 row: Subtotal 15,064.25 / ITBIS 2,686.17 / Total 17,750.42.
     - That is the quote's TOTAL 19,350.42 minus the cargos it doesn't copy (100.00 + 1,500.00 = 1,600.00).
4. Same conversion with a client whose `descuento` is 10:
   - Once the client loads, every line's Desc% is 10.
   - A new banner line reads `Se aplicó el descuento fijo del cliente (10%): el total difiere del de la cotización.`
   - Pick a client with `descuento` 0 in the combobox: the line disappears and Desc% goes back to 0.
5. Vista previa (mock `POST /api/facturas/preview`): the request body has `product_id` 55, 56 and 57 on the product
   lines, none on the free line, `indicador_facturacion` 1/2/1/4, `indicador_bien_servicio` 2 on the service line, and
   `precio_unitario` 2000 / 1000 / 13.7 / 10 (without ITBIS, because the switch is off).
6. Mobile (375 px): the banner and its aviso lines wrap to the right of (or below) the "Facturación" button, with no
   horizontal page scroll.

---

### Task 15: `SimpleInvoiceFormView` takes the Ferretería prefill

**Files:**
- Modify: `src/App.tsx`
  - the navigation import, line 44;
  - the `'factura-simple-nueva'` case, lines 157-159.
- Modify: `src/features/invoices/SimpleInvoiceFormView.tsx`
  - the domain type import, line 24;
  - the doc comment, signature and `cliente` state, lines 110-122;
  - the `lineas` state, line 138;
  - after the edit-load effect, lines 246-247 (insert the client enrichment);
  - before the `return`, lines 607-608 (the avisos);
  - the top row, lines 612-616 (the banner).
- Test: the typecheck fails first (App passes a prop the form doesn't have yet), then the gates. The behavior is
  checked in the browser by Task 16.

**Interfaces:**
- Consumes:
  - From Task 9: `FacturaSimplePrefill` (`src/types/domain.ts`), shown below, and
    `isFacturaSimplePrefill(p: unknown): p is FacturaSimplePrefill` (`src/config/navigation.ts`).
    ```ts
    export interface FacturaSimplePrefill {
      kind: 'factura-simple-prefill'; clienteId: string; clienteNombre: string; origen: string; avisos?: string[]
      lineas: { prodId?: string; descripcion: string; cantidad: number; precio: number; unidadMedida?: number | null }[]
    }
    ```
  - From Task 13: `ferreteriaAFacturaSimplePrefill` already sends this payload from the list.
  - Existing in `SimpleInvoiceFormView.tsx`: `getClient` and `mapClientRow` (imported at lines 6-7), `useApiQuery`
    (line 13), `Linea` (lines 66-81), `lineaVacia` (lines 83-85), `esMetodoCredito` (line 108), `seleccionarCliente`
    (lines 257-262).
- Produces:
  ```ts
  export function SimpleInvoiceFormView({ nav, facturaId, prefill }:
    { nav: Nav; facturaId: number | null; prefill?: FacturaSimplePrefill | null })
  ```
  The prefill is used only when `facturaId == null`:
  - its lines become the initial `lineas`;
  - its client becomes a placeholder `cliente`, filled in through `useApiQuery(['clients','detail',id])`, which applies
    the client's discount and credit rule the same way `seleccionarCliente` does;
  - `original` stays null, so the edit-mode change markers stay off;
  - a banner with `origen`, the `avisos` and the discount line goes in the top row.

- [ ] **Step 1: Check the prerequisites and the lines to edit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git status --short
git log --oneline -3
grep -n "export function isFacturaSimplePrefill" src/config/navigation.ts
grep -n "export function ferreteriaAFacturaSimplePrefill" src/features/cotizaciones/formatos/ferreteria/conversion.ts
grep -n "from '@/config/navigation'\|case 'factura-simple-nueva'" src/App.tsx
grep -n "^export function SimpleInvoiceFormView\|useState<Cliente | null>(null)\|useState<Linea\[\]>(\[lineaVacia(1)\])\|}, \[facturaId\])\|<div className=\"row\" style={{ marginBottom: 14 }}>" src/features/invoices/SimpleInvoiceFormView.tsx
```

Expected:
- Nothing from `git status --short`; the log shows Task 14's commit on top.
- The `navigation.ts` and `conversion.ts` greps print one line each.
- `App.tsx`: `44:import { isCotizacionRef, isFacturaPrefill, isFacturaSimpleRef, isNuevoSignal, navTopFor, puedeVerVista, type ViewId } from '@/config/navigation'`
  and `159:      case 'factura-simple-nueva': return <SimpleInvoiceFormView key="nueva" nav={nav} facturaId={null} />`.
  If Task 11 moved them, use the new numbers; the find texts are the same.
- `SimpleInvoiceFormView.tsx`: lines 114, 122, 138, 247 and 612.

- [ ] **Step 2: Make `App.tsx` pass the prefill (the failing test)**

In `src/App.tsx`, change line 44 from:

```tsx
import { isCotizacionRef, isFacturaPrefill, isFacturaSimpleRef, isNuevoSignal, navTopFor, puedeVerVista, type ViewId } from '@/config/navigation'
```

to:

```tsx
import {
  isCotizacionRef, isFacturaPrefill, isFacturaSimplePrefill, isFacturaSimpleRef, isNuevoSignal, navTopFor, puedeVerVista,
  type ViewId,
} from '@/config/navigation'
```

Then find (lines 157-159; 159-161 now that the import takes three lines):

```tsx
      // Con key: pasar de una factura a otra (o de nueva a editar) monta un
      // formulario limpio en vez de heredar el cliente y el aviso de salida del anterior.
      case 'factura-simple-nueva': return <SimpleInvoiceFormView key="nueva" nav={nav} facturaId={null} />
```

and replace it with:

```tsx
      // Con key: pasar de una factura a otra (o de nueva a editar) monta un
      // formulario limpio en vez de heredar el cliente y el aviso de salida del anterior.
      // El borrador de una cotización convertida solo llega a la factura NUEVA,
      // con su propia key: no se mezcla con una nueva en blanco ni con otra conversión.
      case 'factura-simple-nueva': {
        const prefill = isFacturaSimplePrefill(payload) ? payload : null
        return (
          <SimpleInvoiceFormView
            key={prefill ? `cotizacion-${prefill.origen}` : 'nueva'} nav={nav} facturaId={null} prefill={prefill}
          />
        )
      }
```

`'factura-simple-editar'` (the next case) doesn't change: an existing factura never gets a prefill.

- [ ] **Step 3: Run the typecheck and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
```

Expected: `tsc=2` and one error, in `App.tsx` on the `key=` line of the new case (about line 166):

```
src/App.tsx(166,82): error TS2322: Type '{ key: string; nav: Nav; facturaId: null; prefill: FacturaSimplePrefill | null; }' is not assignable to type 'IntrinsicAttributes & { nav: Nav; facturaId: number | null; }'.
  Property 'prefill' does not exist on type 'IntrinsicAttributes & { nav: Nav; facturaId: number | null; }'.
```

The line and column depend on Task 11's edits; the message must be this one.

- [ ] **Step 4: The prop, the client placeholder and the type import**

In `src/features/invoices/SimpleInvoiceFormView.tsx`, change line 24 from:

```tsx
import type { Cliente, Producto } from '@/types/domain'
```

to:

```tsx
import type { Cliente, FacturaSimplePrefill, Producto } from '@/types/domain'
```

Find (lines 113-122):

```tsx
   Documento interno: no se envía a la DGII, no lleva e-NCF ni NCF fiscal. */
export function SimpleInvoiceFormView({ nav, facturaId }: { nav: Nav; facturaId: number | null }) {
  const queryClient = useQueryClient()
  const editando = facturaId != null

  const [cargando, setCargando] = useState(editando)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [numero, setNumero] = useState<string | null>(null)

  const [cliente, setCliente] = useState<Cliente | null>(null)
```

and replace it with:

```tsx
   Documento interno: no se envía a la DGII, no lleva e-NCF ni NCF fiscal.
   `prefill` llega al convertir una cotización (Ferretería): la factura nueva
   arranca con su cliente y sus líneas, y todo sigue editable. */
export function SimpleInvoiceFormView({
  nav, facturaId, prefill = null,
}: { nav: Nav; facturaId: number | null; prefill?: FacturaSimplePrefill | null }) {
  const queryClient = useQueryClient()
  const editando = facturaId != null
  // Al editar manda la factura guardada: un borrador nunca la pisa.
  const borrador = editando ? null : prefill

  const [cargando, setCargando] = useState(editando)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [numero, setNumero] = useState<string | null>(null)

  // Con borrador arranca con el cliente de la cotización. Es un placeholder
  // con id y nombre (igual que en la factura e-CF): el efecto de más abajo trae
  // la ficha completa y con ella sus condiciones (descuento y crédito).
  const [cliente, setCliente] = useState<Cliente | null>(() =>
    borrador && borrador.clienteId
      ? {
          id: borrador.clienteId, nombre: borrador.clienteNombre || `Cliente #${borrador.clienteId}`,
          contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
          balance: 0, facturas: 0, estado: '', desde: '',
          descuento: 0, permiteCredito: false,
        }
      : null,
  )
```

- [ ] **Step 5: The initial lines**

Find (line 138; 156 after Step 4):

```tsx
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia(1)])
```

and replace it with:

```tsx
  // Con borrador, sus líneas: el precio ya trae el ITBIS (ver conversion.ts de
  // Ferretería) y el descuento lo pone el cliente al cargar. Sin fila vacía al
  // final, como al abrir una factura guardada: "Descripción" agrega otra.
  const [lineas, setLineas] = useState<Linea[]>(() =>
    borrador && borrador.lineas.length > 0
      ? borrador.lineas.map((l, i) => ({
          id: i + 1, prodId: l.prodId ?? '', descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio,
          desc: 0, unidadMedida: l.unidadMedida ?? null,
        }))
      : [lineaVacia(1)],
  )
```

`original` (line 150; 175 after this step) is not touched: it stays `null` for a new factura, so `hayCambios` and the
`fx-mod` markers stay off. With the placeholder client, `hayAlgoEscrito` is true, so leaving the prefilled form asks
for confirmation (`useAvisoSalida`), which is what an unsaved factura should do.

- [ ] **Step 6: Fill in the client with its conditions**

Find the end of the edit-load effect (lines 246-247; 279-280 after Steps 4-5):

```tsx
    return () => { vivo = false }
  }, [facturaId])
```

and replace it with:

```tsx
    return () => { vivo = false }
  }, [facturaId])

  // Borrador de una cotización: el cliente llegó como placeholder. Se trae su
  // ficha con la misma consulta que la factura e-CF y se aplican sus
  // condiciones como al elegirlo a mano (seleccionarCliente): su descuento pasa
  // a las líneas y, sin crédito, el pago queda de contado.
  const borradorClienteId = borrador?.clienteId ? Number(borrador.clienteId) : null
  const clienteEnriquecido = useRef(false)
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', borradorClienteId],
    () => (borradorClienteId ? getClient(borradorClienteId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    // Una sola vez, y solo si sigue siendo ese cliente: si el usuario ya
    // eligió otro, valen las condiciones del que eligió.
    if (!clienteEnriquecido.current && row && cliente && String(row.id) === cliente.id) {
      clienteEnriquecido.current = true
      const completo = mapClientRow(row)
      setCliente(completo)
      // Las líneas del borrador arrancan en 0%: con descuento queda igual que
      // seleccionarCliente, y sin él no pisa uno escrito mientras cargaba.
      if (completo.descuento > 0) setLineas((ls) => ls.map((l) => ({ ...l, desc: completo.descuento })))
      if (!completo.permiteCredito) setMetodo((m) => (esMetodoCredito(m) ? 'Efectivo' : m))
    }
  }, [clienteDetalle.data, cliente])
```

- These hooks sit above the `if (cargando || errorCarga) return …` at line 594, so the hook order never changes.
- In edit mode and in a blank factura `borradorClienteId` is null, and the query resolves `null` without a request, as
  it does in `InvoiceFormView` (same key, same cache).

- [ ] **Step 7: The banner in the top row**

Find (lines 607-616; about 664-673 after Steps 4-6):

```tsx
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contacto = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')

  return (
    <div className="page fx-desk">
      <div className="row" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('facturas-simples')}>
          Facturas simples
        </Btn>
      </div>
```

and replace it with:

```tsx
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contacto = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')

  // Avisos bajo el banner de la conversión: lo que la cotización no copió y,
  // ya con el cliente cargado, su descuento fijo, que hace que el total no sea
  // el de la cotización.
  const pctCliente = cliente?.descuento ?? 0
  const avisosConversion = borrador
    ? [
        ...(borrador.avisos ?? []),
        ...(pctCliente > 0
          ? [`Se aplicó el descuento fijo del cliente (${pctCliente}%): el total difiere del de la cotización.`]
          : []),
      ]
    : []

  return (
    <div className="page fx-desk">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('facturas-simples')}>
          Facturas simples
        </Btn>
        {borrador && (
          <div className="col" style={{ alignItems: 'flex-end', textAlign: 'right', gap: 4, minWidth: 0 }}>
            <span className="row gap-sm text-sm" style={{ color: 'var(--info)' }}>
              <Icon name="file-plus" size={15} />
              Convertida desde la cotización {borrador.origen} · cada precio ya incluye su ITBIS
            </span>
            {avisosConversion.map((a, i) => (
              <span key={i} className="row gap-sm text-xs" style={{ color: 'var(--warning)' }}>
                <Icon name="alert-triangle" size={13} />
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
```

- `between` with only the back button (a blank or edited factura) leaves the button where it was.
- The banner uses the same markup as Task 14's, so both forms announce a conversion the same way.

- [ ] **Step 8: Run the gates**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
node scripts/test-conversion-ferreteria.ts | tail -1
git status --short
```

Expected:
- `tsc=0` (the Step 3 error is gone), `eslint=0` (no `react-hooks/exhaustive-deps` warning: the effect reads
  `clienteDetalle.data` and `cliente`, and the rest are state setters, a ref and a module function), and `build=0`
  (only the existing chunk-size warning).
- `30/30 OK`.
- `git status --short` lists exactly ` M src/App.tsx` and ` M src/features/invoices/SimpleInvoiceFormView.tsx`.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git add src/App.tsx src/features/invoices/SimpleInvoiceFormView.tsx
git commit -F - <<'EOF'
feat(facturas-simples): la factura simple acepta el borrador de una cotizacion

SimpleInvoiceFormView gana la prop opcional prefill (FacturaSimplePrefill),
que solo cuenta en una factura nueva: arranca con las lineas de la
cotizacion (precio con ITBIS) y su cliente como placeholder. La ficha llega
por useApiQuery(['clients','detail',id]) y se aplican sus condiciones como
en seleccionarCliente (descuento a las lineas, contado si no tiene credito).
El banner de arriba dice de que cotizacion viene, los cargos que no se
copiaron y el descuento aplicado. App pasa el borrador solo a
factura-simple-nueva, con su propia key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

**What Task 16 must check in the browser (local mock only; never save against anything but the mock):**

Task 16 runs these checks against its own mock datasets (I_T16.md: COT-000012, COT-000013 and the new COT-000014, with the amounts in its tables); where a row, id or amount here differs from I_T16.md, I_T16.md's is the binding one. The behaviors listed here must all be covered there.

The mock needs the Task 13 row, `GET /api/clients?id=7` (with `descuento` 0 and 10, and `permite_credito` both
ways), `POST /api/facturas-simples` (just echo an `id` and `no_factura`), plus the products and units endpoints the form
already calls.

1. Ferretería → "Factura simple" with a client whose `descuento` is 0:
   - The top row shows the "Facturas simples" button on the left and, on the right,
     `Convertida desde la cotización COT-000012 · cada precio ya incluye su ITBIS`, then the cargos aviso (the same
     text as in Task 14) in the warning color.
   - The client box shows the client's name.
   - 4 lines, the blank one dropped, and no empty line at the end:
     - GALONES… 7 × 2360, Importe 16,520.00;
     - INSTALACION… 1 × 1160;
     - CORTE DE TUBO 2.5 × 16.166, Importe 40.42;
     - TODO EXENTO 3 × 10.
   - Subtotal = Total = 17,750.42: the quote's TOTAL 19,350.42 minus the 1,600.00 of cargos that weren't copied, with a
     0-cent rounding difference on these prices (16,520.00 + 1,160.00 + 40.42 + 30.00).
   - No line or field is marked as modified (`fx-mod`), and the bar shows "4 líneas", not "Cambios sin guardar".
2. Same conversion with a client whose `descuento` is 10:
   - Once the client loads, each line's Desc.% is 10 and the importes drop.
   - The banner gets `Se aplicó el descuento fijo del cliente (10%): el total difiere del de la cotización.`
3. A client without credit: "Credito 30 dias" is disabled in Pago, and the payment stays Efectivo.
4. Leaving the prefilled form (sidebar or back button) asks for confirmation.
5. "Solo guardar" (mock): the `POST /api/facturas-simples` body has `client_id: 7`, and items with `product_id` 55/56/57
   (none on the free line), `amount` 2360 / 1160 / 16.166 / 10, and `unidad_medida` '43' / '43' / '47' / '43'.
6. Unchanged:
   - "Nueva factura simple" from the facturas-simples list shows one empty line, no banner, and the button where it was.
   - Opening an existing factura simple works as before, with no banner and the change markers working.
7. Reloading the page on the prefilled form opens a blank Nueva factura simple: the payload isn't persisted, as with
   factura-nueva.
8. Mobile (375 px): the banner lines wrap next to (or under) the back button, with no horizontal page scroll.

---

## Part I: Task 16


Repos: FE = `C:/Users/Signos/Documents/edwin/fiscalo` (branch `feat/cotizacion-formatos`). This task commits only the docs
note. Everything else it writes lives in the session scratchpad, outside both repos:

```
S = C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
```

Read this before starting:
- **Never production.** fiscalo's `.env` sends `/api` to production (gratex.net). In this task:
  - every vite run goes through `$S/vite-mock.mjs`, which forces `API_PROXY_TARGET=http://127.0.0.1:8791` and
    `API_KEY=''`, refuses any non-local target, and refuses to start if the resolved proxy is not the mock;
  - never `preview_start` the existing `fiscalo-dev` entry;
  - never log in: the session is a fake one seeded in `localStorage` (Step 10), and the mock accepts any Bearer;
  - before seeding, `GET /api/__mock/ping` through vite must answer `{"mock":true}` (Step 10). If it doesn't, stop the
    server at once.
- **The mock computes nothing.** It echoes what the screens send, plus `id`/`code`/`numero`, and keeps it in memory. A
  quote created in the browser therefore has `total: null` (the list shows `0.00`), and a stored "retención" is the
  marker `'0.01'`. The totals themselves are covered by Task 10's parity script and the backend CLI. Here the browser
  checks what the screens compute and send.
- **Two datasets, like two tenant databases.** `gratex` has XKD482 and PLM107. `ferreteria` has QWE901 (formato NULL),
  COT-000012, COT-000013 and the factura simple FS-000900. The tenant's formato (`cotizacion_formato` in
  `GET /api/branding`) is a separate switch, so it can change while a tab is open (the 409 case).
- **Clicks.** The pane emulates 1280x900. When the pane is narrower, it scales the page, and a `computer` click by `ref`
  can land on the wrong button (seen while preparing this plan). So:
  - click buttons, menu items and comboboxes with the page helpers (`__clic`, `__elegir`, `__menu`, `__casilla`);
  - type with `find` + `form_input`, which drives React's controlled inputs correctly;
  - always confirm each action by its effect (mock log, toast, view). If a `computer` click misfires, take a screenshot
    and click by that screenshot's coordinate frame.
  These helpers are inspection tools. They don't change the app, and they click real elements.
- **Labels of the Ferretería form.** The checks use the exact texts of Task 12's final code (G_T11_T12.md, Task 12
  Step 9) and of Tasks 11, 13-15. The ones `__clic` (exact text match) and `find` depend on:
  - save: `Crear cotización` on a new quote, `Guardar cambios` when editing (the Gratex form uses the same two words);
  - the totals group opener: `+ Cargos y abonos` (a button; once the group has values it can't be closed);
  - delete: `Eliminar`, then the inline `Sí, eliminar` (or `No`);
  - catalog search box placeholder: `Agregar del catálogo: nombre, SKU o categoría…`;
  - totals panel (`.fx-cierre`): `Sub-total`, `ITBIS 18%`/`ITBIS`, `Total RD$`, then `Retención Renta por Tercero 5%`
    `−x`, `Abono realizado` `−x` and `Restante (Adeudado)`. The cargos amounts are `<input>` fields, so they're read
    from the fields, not from the panel text;
  - the 409: the message in the action bar plus a `Recargar` button; `Vista previa` and `Crear cotización`/`Guardar
    cambios` disappear from that bar;
  - telling the forms apart: only the Gratex form has `Enviar por correo al guardar`; only the Ferretería form has
    `Cotización mercancías`. Both show the eyebrow `Propuesta comercial`, so never use it to tell them apart;
  - the editor's deleted-quote state: `Esta cotización ya no existe` with an `Ir a cotizaciones` button (Task 11).
  If the code a previous task actually committed words a control differently, use its text and record it. A missing
  behavior is a failure, though, not a wording difference.
- **When a check fails:**
  1. Stop and record what you expected and what you saw.
  2. Fix it in the owning task's files: T11 registry/editor, T12 Ferretería form, T13 list/conversion, T14
     InvoiceFormView, T15 SimpleInvoiceFormView. Never edit `CotizacionFormView.tsx` or the legacy Gratex code.
  3. Re-run the gates of Step 1 and commit `fix(cotizaciones): ...` with the Co-Authored-By line.
  4. Repeat the failed check.
- **Shared checkouts.** Re-read `.claude/launch.json` and `docs/plantillas-factura.md` right before editing them, and make
  targeted edits only. Task 3 already changed line 39 of `docs/plantillas-factura.md` (the `GET /api/branding` row), and
  this task must not touch that row.

---

### Task 16: FE docs note + browser verification against a local mock (Gratex unchanged, Ferretería end to end, 409, mobile)

**Files:**
- Create, in the scratchpad (not in a repo):
  - `$S/mock-selftest.mjs`: the mock's test, written first;
  - `$S/mock-api.mjs`: the mock API (no dependencies; port 8791);
  - `$S/vite-mock.mjs`: runs fiscalo's vite in-process, with `/api` pointing to the mock;
  - `$S/ayudas.js`: the page inspection helpers, pasted with `javascript_tool`;
  - `$S/fiscalo-base/`: a `git archive` of the branch base, for the Gratex before/after comparison, with
    `node_modules` as a junction;
  - `$S/vite-cache-base/`: the base snapshot's own vite cacheDir.
- Modify, temporarily, reverted in Step 28: `C:/Users/Signos/Documents/edwin/fiscalo/.claude/launch.json:8-10`. Three
  entries go after `fiscalo-dev`.
- Modify: `C:/Users/Signos/Documents/edwin/fiscalo/docs/plantillas-factura.md`:
  - `:3-5`, the intro;
  - a new section inserted before `:49` (``## Diseños a la medida (`custom:*`)``);
  - `:58-59`, the `drawCompanyHeader` bullet.
  - Line `:39` is not touched: it is Task 3's row.
- Test:
  - `node $S/mock-selftest.mjs`;
  - the gates `npm run typecheck`, `npx eslint src scripts`, `npm run build`, and the node scripts under `scripts/`;
  - the browser checklist (Steps 10-26).

**Interfaces:**
- Consumes (contract, exact names):
  - T9: `BrandingData.cotizacion_formato?: string`; `CotizacionRow` + `formato`, `numero`, `subtotal`, `itbis`,
    `ajustes`; `CotizacionItemRow` + `product_id`, `unidad_medida`, `indicador_facturacion`, `indicador_bien_servicio`,
    `itbis_amount`; `CotizacionFerreteriaInput` (`formato: 'ferreteria'`, no `total`); `FacturaPrefill` with
    `precioConItbis?`/`avisos?` and per-line `prodId?`/`unidadMedida?`/`indFact?`/`tipoItem?`; `FacturaSimplePrefill`;
    `isFacturaSimplePrefill`.
  - T11: `FORMATOS`, `formatoDeFila(row)`, `useCotizacionFormato(): { formato, cargando, error }`,
    `CotizacionEditor({ nav, cotizacionId })` (`App.tsx` renders it keyed by `cotizacionId ?? 'nueva'`).
  - T12: `FerreteriaCotizacionForm`, `.fx-grid-cot-fer`, `ProductoCombobox` `mostrarPrecio?: boolean`.
  - T13: `ferreteriaAFacturaPrefill(c)`, `ferreteriaAFacturaSimplePrefill(c)`, `avisosCargos(c)`. The list puts Número |
    Cliente | Fecha | Total on a Ferretería tenant. Facturar ▾ has title `Convertir en factura` and the items
    `Factura electrónica (e-CF)` / `Factura simple`, each gated by `puedeVerVista`. The Gratex button has title
    `Convertir a factura e-CF`.
  - T14: switch `useState(prefill != null && (prefill.precioConItbis ?? true))`; the banner `… · los precios no incluyen
    ITBIS (se suma encima)`; the aviso lines; `Se aplicó el descuento fijo del cliente (X%): el total difiere del de la
    cotización.`
  - T15: `SimpleInvoiceFormView({ nav, facturaId, prefill })`; the banner `Convertida desde la cotización X · cada precio
    ya incluye su ITBIS`.
  - The HTTP shapes the mock imitates (spec 6.5, D_T06):
    - list = `{status, data:[rows with items + ajustes], pagination}`; `?id=` = `{data:[row]}`;
    - Ferretería POST/PUT = `{id, code, numero, total}`;
    - Gratex POST = `{id, code, message:'Cotization saved'}`; Gratex PUT = `'Cotization updated'`;
    - preview and pdf = `{filename, content, mime_type}`;
    - 409 = `{status:false, error:'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.'}`.
- Produces:
  - no code in the repos besides the docs note;
  - in the scratchpad: `node mock-api.mjs [--port=8791] [--formato=gratex|ferreteria|none|error] [--datos=gratex|ferreteria] [--409=N]`
    (env `MOCK_PORT`/`MOCK_FORMATO`/`MOCK_DATOS`/`MOCK_409_NEXT`), its control routes `/__mock/{ping,estado,arm-409,log,reset,captura,capturas}`
    (also under `/api/__mock/…` through the proxy), `node vite-mock.mjs [--port] [--dir] [--api] [--cache]`, and the
    page helpers `__clic`, `__elegir`, `__menu`, `__casilla`, `__fila`, `__filas`, `__texto`, `__opciones`, `__toasts`,
    `__pdf`, `__ultimas`, `__mock`, `__huella`, `__escrituras`, `__sinScrollHorizontal`, `__esperar`.

Expected values used below. They come from `montosLinea.redondear` (the same rule as `Redondeo` and
`totalesFerreteria`) and were computed with it.

| Document | Sub-total | ITBIS | Extras | TOTAL | Retención | Abono | Restante |
|---|---|---|---|---|---|---|---|
| New COT-000014 (lines below), no extras | 15,263.75 | 2,727.48 (`ITBIS`: 18% and 16% mixed) | — | 17,991.23 | — | — | not shown |
| … + Costo mano de obra 1,500.00 | 15,263.75 | 2,727.48 | 1,500.00 | 19,491.23 | — | — | not shown |
| … + Retención checked | | | | 19,491.23 | 763.19 | 0 | 18,728.04 |
| … + Abono 5,000.00 | | | | 19,491.23 | 763.19 | 5,000.00 | 13,728.04 |
| … with PRUEBA REDONDEO 1 × 84.75 added (no extras) | 15,348.50 | 2,742.74 (+15.26) | — | 18,091.24 | | | |
| Seeded COT-000012 | 15,064.25 | 2,686.17 (`ITBIS`) | 100.00 + 1,500.00 | 19,350.42 | 753.21 | 1,000.00 | 17,597.21 |
| Seeded COT-000013 | 8,260.00 | 1,486.80 (`ITBIS 18%`) | — | 9,746.80 | — | — | not shown |

New COT-000014 lines, in the order they are added:
1. product 55 GALONES DE PINTURA BLNACA SEMIGLOSS: 7 × 2,000.00, 18%, Unidad;
2. product 56 INSTALACION DE LAVAMANOS: 1 × 1,000.00, 16%, Servicio;
3. free line CORTE DE TUBO: 1 × 150.00, 18%, Unidad;
4. product 59 CABLE ELECTRICO #12: 2.5 × 45.50, 18%, Metro.

Their bases are 14,000.00 / 1,000.00 / 150.00 / 113.75.

| Conversion | Lines (price) | Subtotal | ITBIS | Total |
|---|---|---|---|---|
| COT-000014 → e-CF (client 7, 0%) | 2000 / 1000 / 150 / 45.5, without ITBIS | 15,263.75 | 2,727.48 | 17,991.23 |
| COT-000014 → simple | 2,360.00 / 1,160.00 / 177.00 / 53.69; importes 16,520.00 / 1,160.00 / 177.00 / 134.23 | | | 17,991.23 |
| COT-000012 → e-CF (client 7, 0%) | 2000 / 1000 / 13.7 / 10 | 15,064.25 | 2,686.17 | 17,750.42 |
| COT-000013 → e-CF (client 8, 10%) | 1650 / 625 / 960 / 300 / 100, Desc 10% | 7,434.00 | 1,338.12 | 8,772.12 |
| COT-000013 → simple (client 8, 10%) | 1,947.00 / 737.50 / 1,132.80 / 354.00 / 118.00; importes 5,256.90 / 1,327.50 / 1,019.52 / 637.20 / 531.00 | | | 8,772.12 |

- [ ] **Step 1: Prerequisites and the gates (Tasks 9-15 are in)**

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git switch feat/cotizacion-formatos
git status --short
git log --oneline -15
grep -n "cotizacion_formato?: string" src/api/types.ts
grep -nE "export (type FormatoId|function formatoDeFila|function useCotizacionFormato)" src/features/cotizaciones/formatos/index.ts
grep -n "export function CotizacionEditor" src/features/cotizaciones/formatos/CotizacionEditor.tsx
grep -n "export function FerreteriaCotizacionForm" src/features/cotizaciones/formatos/ferreteria/FerreteriaCotizacionForm.tsx
grep -nE "export function (ferreteriaAFacturaPrefill|ferreteriaAFacturaSimplePrefill|avisosCargos)" src/features/cotizaciones/formatos/ferreteria/conversion.ts
grep -n "prefill.precioConItbis ?? true" src/features/invoices/InvoiceFormView.tsx
grep -n "prefill?: FacturaSimplePrefill | null" src/features/invoices/SimpleInvoiceFormView.tsx
grep -rln "mostrarPrecio" src
BASE=$(git merge-base main HEAD); echo "base=$BASE"
git diff --stat "$BASE" HEAD -- src/features/cotizaciones/CotizacionFormView.tsx
npm run typecheck; echo "tsc=$?"
npx eslint src scripts; echo "eslint=$?"
npm run build; echo "build=$?"
for f in scripts/*.ts; do out=$(node "$f" 2>&1); code=$?; echo "$f exit=$code :: $(printf '%s\n' "$out" | tail -1)"; done
git status --short
```

Expected:
- `git status --short` prints nothing, before and after. `dist/` is ignored.
- Each grep prints at least one line, and the `formatos/index.ts` grep prints three.
- `mostrarPrecio` appears only in `src/features/products/ProductoCombobox.tsx` and the Ferretería form file:
  `GastoFormModal` keeps showing Costo.
- `base=315075e43baa9e90b001574a247f24b98be3df82`, unless `main` moved; any merge-base works.
  - The `git diff --stat` of `CotizacionFormView.tsx` prints nothing (spec 9.1).
- `tsc=0`, `eslint=0`, `build=0`. The only warning is the existing chunk-size one.
- Every `scripts/*.ts` ends `exit=0 :: N/N OK`:
  - `parity-cotizacion-ferreteria.ts` (Task 10);
  - `test-schema-cotizacion-ferreteria.ts` (Task 12), `25/25 OK`;
  - `test-conversion-ferreteria.ts` (Task 13), `30/30 OK`.
- **If anything is red, stop:** the task that owns it isn't done.

- [ ] **Step 2: Write the mock's self-test first (`$S/mock-selftest.mjs`)**

Create the folder, then the test with the Write tool:

```bash
mkdir -p C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
```

`$S/mock-selftest.mjs`:

```js
// Prueba del mock (mock-api.mjs) ANTES de ponerle el navegador delante: lo
// arranca en un puerto aparte, le pide lo que piden las pantallas y revisa las
// formas y las reglas que la revisión del Task 16 da por buenas.
//
// Uso: node mock-selftest.mjs   (desde la carpeta del mock)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const PUERTO = 8799
const BASE = `http://127.0.0.1:${PUERTO}`
const MSG_409 = 'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.'

let fallos = 0
let total = 0
const chk = (desc, ok, detalle = '') => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || !detalle ? '' : ` -> ${detalle}`}`)
}
const pedir = async (metodo, ruta, cuerpo, headers = {}) => {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { Accept: 'application/json', Authorization: 'Bearer mock-token-t16', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const texto = await r.text()
  return { http: r.status, json: texto ? JSON.parse(texto) : null }
}

const hijo = spawn(process.execPath, [path.join(AQUI, 'mock-api.mjs'), `--port=${PUERTO}`, '--formato=ferreteria'], { stdio: ['ignore', 'pipe', 'inherit'] })
let salida = ''
hijo.stdout.on('data', (d) => { salida += d })

try {
  // Espera a que escuche (máx. 5 s).
  let listo = false
  for (let i = 0; i < 50 && !listo; i++) {
    try { listo = (await fetch(`${BASE}/__mock/ping`)).ok } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  chk('el mock escucha en 127.0.0.1:8799', listo)
  if (!listo) throw new Error('el mock no arrancó')
  let local = false
  try { local = (await fetch(`http://localhost:${PUERTO}/__mock/ping`)).ok } catch { /* sin respuesta */ }
  chk(`http://localhost:${PUERTO} también responde (preview_start abre localhost)`, local)

  const ping = await pedir('GET', '/api/__mock/ping')
  chk('ping por /api/__mock (la ruta que usa el proxy de vite)', ping.json?.data?.mock === true && ping.json.data.datos === 'ferreteria')

  // --- branding ---
  let b = await pedir('GET', '/api/branding')
  chk('branding: cotizacion_formato = ferreteria', b.json?.data?.cotizacion_formato === 'ferreteria')
  chk('branding: logo_data_uri es un data URI', String(b.json?.data?.logo_data_uri).startsWith('data:image/svg+xml;base64,'))
  await pedir('GET', '/__mock/estado?formato=none')
  b = await pedir('GET', '/api/branding')
  chk('formato=none: branding SIN la clave cotizacion_formato', b.http === 200 && !('cotizacion_formato' in b.json.data))
  await pedir('GET', '/__mock/estado?formato=error')
  b = await pedir('GET', '/api/branding')
  chk('formato=error: branding responde 500 status:false', b.http === 500 && b.json?.status === false)
  await pedir('GET', '/__mock/estado?formato=ferreteria&delay=300')
  const t0 = Date.now()
  await pedir('GET', '/api/branding')
  chk('delay=300: branding tarda >= 300 ms', Date.now() - t0 >= 290)
  await pedir('GET', '/__mock/estado?delay=0')

  // --- auth ---
  const sinToken = await pedir('GET', '/api/auth/me', null, { Authorization: '' })
  chk('auth/me sin Bearer -> 401 { success:false }', sinToken.http === 401 && sinToken.json?.success === false)
  let me = await pedir('GET', '/api/auth/me')
  chk("auth/me -> { success, data:{ user } } con permissions ['*']", me.json?.success === true && me.json.data.user.permissions?.[0] === '*')
  await pedir('GET', '/__mock/estado?permisos=cotizaciones,facturas')
  me = await pedir('GET', '/api/auth/me')
  chk('permisos=cotizaciones,facturas llega en auth/me', JSON.stringify(me.json.data.user.permissions) === '["cotizaciones","facturas"]')
  await pedir('GET', '/__mock/estado?permisos=ausente')
  me = await pedir('GET', '/api/auth/me')
  chk('permisos=ausente: el usuario no trae permissions (fail-open)', !('permissions' in me.json.data.user))
  await pedir('GET', '/__mock/estado?permisos=*')

  // --- listado y detalle ---
  const lista = await pedir('GET', '/api/cotizaciones?page=1&pageSize=15')
  chk('listado: 3 filas, de la más nueva a la más vieja (13, 12, 9)', lista.json?.data?.map((c) => c.id).join(',') === '13,12,9')
  chk('listado: pagination.total = 3', lista.json?.pagination?.total === 3)
  chk('listado: cada fila trae items y ajustes (objeto)', lista.json.data.every((c) => Array.isArray(c.items) && c.ajustes && !Array.isArray(c.ajustes)))
  const det = await pedir('GET', '/api/cotizaciones?id=12')
  const c12 = det.json?.data?.[0]
  chk('detalle ?id=12 -> data:[fila] con formato ferreteria y numero 12', c12?.formato === 'ferreteria' && c12.numero === 12)
  chk('detalle: DECIMAL como texto (quantity "7.000", amount "2000.0000")', c12?.items?.[0]?.quantity === '7.000' && c12.items[0].amount === '2000.0000')
  chk('detalle: ajustes de COT-000012 (cargos 100.00, mano de obra 1500.00)', c12?.ajustes?.cargos_bancarios === '100.00' && c12.ajustes.mano_obra === '1500.00')
  const c9 = (await pedir('GET', '/api/cotizaciones?id=9')).json.data[0]
  chk('fila de Gratex: formato null, ajustes {}', c9.formato === null && Object.keys(c9.ajustes).length === 0)
  const buscar = await pedir('GET', '/api/cotizaciones?page=1&pageSize=15&query=000013')
  chk('búsqueda por número: query=000013 -> COT-000013', buscar.json.data.length === 1 && buscar.json.data[0].code === 'COT-000013')

  // --- crear (Ferretería) ---
  const cuerpo = {
    formato: 'ferreteria', client_id: 7, date: '2026-10-02',
    items: [
      { product_id: 55, description: 'GALONES DE PINTURA BLNACA SEMIGLOSS', quantity: 7, amount: 2000, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1 },
      { product_id: null, description: 'CORTE DE TUBO', quantity: 1, amount: 150, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1 },
    ],
    ajustes: { cargos_bancarios: 0, manejo_bancario: 0, mano_obra: 1500, abono: 5000, retencion_isr: true },
  }
  const creada = await pedir('POST', '/api/cotizaciones', cuerpo)
  chk('POST ferreteria -> {id:14, code:COT-000014, numero:14}', creada.json?.data?.id === 14 && creada.json.data.code === 'COT-000014' && creada.json.data.numero === 14)
  const c14 = (await pedir('GET', '/api/cotizaciones?id=14')).json.data[0]
  chk("fecha solo-día recibe la hora actual ('2026-10-02 HH:MM:SS')", /^2026-10-02 \d{2}:\d{2}:\d{2}$/.test(c14.date))
  chk('ajustes guardados: solo != 0, en texto, retención con marcador > 0',
    JSON.stringify(c14.ajustes) === JSON.stringify({ mano_obra: '1500.00', abono: '5000.00', retencion_isr: '0.01' }))
  chk('el mock no calcula: total/subtotal/itbis null', c14.total === null && c14.subtotal === null && c14.itbis === null)
  chk('client_name sale del cliente 7', c14.client_name.startsWith('HOSPITAL DOCENTE'))

  // --- actualizar (Ferretería) ---
  const fechaAntes = c14.date
  const put = await pedir('PUT', '/api/cotizaciones', { id: 14, ...cuerpo, date: undefined, ajustes: { cargos_bancarios: 0, manejo_bancario: 0, mano_obra: 0, abono: 0, retencion_isr: false } })
  chk('PUT sin date -> conserva la fecha, mismo code/numero', put.json?.data?.code === 'COT-000014' && (await pedir('GET', '/api/cotizaciones?id=14')).json.data[0].date === fechaAntes)
  chk('PUT reemplaza los ajustes (todos en 0 -> {})', Object.keys((await pedir('GET', '/api/cotizaciones?id=14')).json.data[0].ajustes).length === 0)

  // --- guardia de formato (409) ---
  const gratexBody = { client_id: 7, items: [{ description: 'X', amount: 10, quantity: 1, subtotal: 10 }], total: 10, date: '2026-10-02 10:00:00' }
  let r = await pedir('POST', '/api/cotizaciones', gratexBody)
  chk('POST sin formato (Gratex) en tenant ferreteria -> 409 con el texto del spec', r.http === 409 && r.json?.error === MSG_409)
  r = await pedir('PUT', '/api/cotizaciones', { id: 9, ...cuerpo })
  chk('PUT cuerpo ferreteria sobre fila Gratex (9) -> 409', r.http === 409)
  r = await pedir('PUT', '/api/cotizaciones', { id: 9, ...gratexBody })
  chk("PUT cuerpo Gratex sobre fila Gratex -> 'Cotization updated'", r.http === 200 && r.json?.data === 'Cotization updated')
  r = await pedir('PUT', '/api/cotizaciones', { id: 404, ...gratexBody })
  chk('PUT de una fila que no existe (Gratex) -> 200 status:false "ya no existe"', r.http === 200 && r.json?.status === false && /ya no existe/.test(r.json.error))
  await pedir('GET', '/__mock/arm-409')
  r = await pedir('POST', '/api/cotizaciones', cuerpo)
  chk('arm-409: el próximo POST válido da 409', r.http === 409)
  r = await pedir('POST', '/api/cotizaciones', cuerpo)
  chk('arm-409 es de un solo uso: el siguiente POST crea COT-000015', r.http === 200 && r.json.data.code === 'COT-000015')
  r = await pedir('POST', '/api/cotizaciones?mock409=1', cuerpo)
  chk('?mock409=1 -> 409 solo esa vez', r.http === 409)
  chk('los 409 no crearon filas (sigue habiendo 5)', (await pedir('GET', '/api/cotizaciones?page=1&pageSize=15')).json.pagination.total === 5)

  // --- PDFs ---
  const prev = await pedir('POST', '/api/cotizaciones/preview', cuerpo)
  const bytes = Buffer.from(prev.json?.data?.content ?? '', 'base64').toString('latin1')
  chk('preview -> {filename, content, mime_type} con un PDF', prev.json?.data?.mime_type === 'application/pdf' && bytes.startsWith('%PDF-1.4') && bytes.trimEnd().endsWith('%%EOF'))
  const xref = Number(/startxref\n(\d+)/.exec(bytes)?.[1])
  const offsets = [...bytes.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
  chk('el xref del PDF apunta a "xref" y a cada "N 0 obj"', bytes.slice(xref, xref + 4) === 'xref' && offsets.every((o, i) => bytes.startsWith(`${i + 1} 0 obj`, o)))
  r = await pedir('POST', '/api/cotizaciones/preview', { ...cuerpo, id: 12 })
  chk('preview con id: imprime el code de la fila', Buffer.from(r.json.data.content, 'base64').toString('latin1').includes('codigo: COT-000012'))
  r = await pedir('POST', '/api/cotizaciones/preview', { ...gratexBody, id: 9 })
  chk('preview con id de fila Gratex y cuerpo Gratex -> 200', r.http === 200)
  r = await pedir('GET', '/api/cotizaciones/12/pdf?format=base64')
  chk('GET /12/pdf -> Cotizacion_COT-000012.pdf', r.json?.data?.filename === 'Cotizacion_COT-000012.pdf')
  r = await pedir('GET', '/api/cotizaciones/404/pdf?format=base64')
  chk('GET /404/pdf -> 404', r.http === 404)

  // --- borrar ---
  r = await pedir('DELETE', '/api/cotizaciones', { id: 14 })
  chk('DELETE id 14 -> Cotization deleted', r.json?.data === 'Cotization deleted')
  chk('?id=14 ya no existe -> data: []', (await pedir('GET', '/api/cotizaciones?id=14')).json.data.length === 0)

  // --- catálogos y clientes ---
  const un = (await pedir('GET', '/api/unidades-medida')).json.data
  chk('unidades: 62, Metro (26) admite decimales, Unidad (43) no', un.length === 62 && un.find((u) => u.id === 26).permite_decimales === true && un.find((u) => u.id === 43).permite_decimales === false)
  const pr = await pedir('GET', '/api/products?query=cable&pageSize=8')
  chk('productos: query=cable -> CABLE ELECTRICO #12 (59), con paginación', pr.json.data.length === 1 && pr.json.data[0].id === 59 && pr.json.pagination.total === 1)
  const fer = await pedir('GET', '/api/products?query=ferreteria&pageSize=50')
  chk("búsqueda sin acentos: 'ferreteria' encuentra la categoría 'Ferretería' (6 productos)", fer.json?.pagination?.total === 6)
  const cl8 = await pedir('GET', '/api/clients?id=8')
  chk("cliente 8: descuento '10.00', sin crédito", cl8.json?.data?.descuento === '10.00' && cl8.json.data.permitir_credito === 0)
  const nuevo = await pedir('POST', '/api/clients', { client_name: 'Juan Mostrador', company_name: 'Juan Mostrador' })
  chk('POST /api/clients -> data con el registro y su id', nuevo.json?.data?.id === 9 && nuevo.json.data.client_name === 'Juan Mostrador')
  r = await pedir('POST', '/api/facturas', { tipo_ecf: '31', items: [] })
  chk('POST /api/facturas (emitir) -> 422: el mock nunca emite', r.http === 422 && /deshabilitado/.test(r.json.error))
  const stats = (await pedir('GET', '/api/facturas/stats')).json.data
  chk('facturas/stats trae secuencias (E31 y E32)', stats.secuencias.some((s) => s.type === 'E31') && stats.secuencias.some((s) => s.type === 'E32'))
  const fs = await pedir('POST', '/api/facturas-simples', { client_id: 7, date: '2026-10-02', tipo_pago: 1, items: [{ product_id: 55, description: 'G', quantity: 7, amount: 2360, unidad_medida: '43' }] })
  chk('POST facturas-simples -> {id, no_factura}', fs.json?.data?.id === 901 && fs.json.data.no_factura === 'FS-000901')

  // --- huellas (comparación base/head de Gratex) ---
  await pedir('POST', '/api/__mock/captura', { clave: 'lista', lado: 'base', sha: 'abc', largo: 10, texto: 'T' })
  await pedir('POST', '/api/__mock/captura', { clave: 'lista', lado: 'head', sha: 'abc', largo: 10, texto: 'T' })
  await pedir('POST', '/api/__mock/captura', { clave: 'form', lado: 'base', sha: 'x1', largo: 5, texto: 'A' })
  await pedir('POST', '/api/__mock/captura', { clave: 'form', lado: 'head', sha: 'x2', largo: 5, texto: 'A' })
  const caps = (await pedir('GET', '/__mock/capturas')).json.data
  chk('capturas: lista igual en html y texto; form solo en texto',
    caps.find((c) => c.clave === 'lista')?.htmlIgual === true && caps.find((c) => c.clave === 'form')?.htmlIgual === false && caps.find((c) => c.clave === 'form')?.textoIgual === true)
  const unaCap = (await pedir('GET', '/__mock/capturas?clave=form')).json.data
  chk('capturas?clave=form trae los dos textos para el diff', unaCap.length === 1 && unaCap[0].textoBase === 'A' && unaCap[0].textoHead === 'A')

  // --- log y reset ---
  const log = (await pedir('GET', '/__mock/log?n=100')).json.data
  chk('el log guarda cada escritura con su cuerpo', log.some((e) => e.metodo === 'POST' && e.ruta === '/api/cotizaciones' && e.cuerpo?.formato === 'ferreteria'))
  chk('stdout imprime el cuerpo de los POST', salida.includes('[cuerpo] {"formato":"ferreteria"'))
  await pedir('GET', '/__mock/reset?datos=gratex&formato=gratex')
  const g = await pedir('GET', '/api/cotizaciones?page=1&pageSize=15')
  chk('reset?datos=gratex: solo XKD482 y PLM107 (más nueva primero)', g.json.data.map((c) => c.code).join(',') === 'PLM107,XKD482')
  r = await pedir('POST', '/api/cotizaciones', gratexBody)
  chk("tenant gratex: POST Gratex -> {id:6, code:'MCK101', message}", r.json?.data?.id === 6 && r.json.data.code === 'MCK101' && r.json.data.message === 'Cotization saved')
  r = await pedir('POST', '/api/cotizaciones', cuerpo)
  chk('tenant gratex: POST con formato ferreteria -> 409', r.http === 409)
  chk('el reset no borra las huellas', (await pedir('GET', '/__mock/capturas')).json.data.length === 2)
} catch (e) {
  chk(`sin excepciones (${e.message})`, false)
} finally {
  hijo.kill()
}
console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
```

What it pins down, on port 8799, apart from the browser port:
- the routes and shapes every screen reads;
- formatos `none` and `error`;
- the 409 guard, natural and armed;
- the kept date on PUT and the numbering;
- valid PDFs, with an exact xref;
- a mock that never emits;
- the captures used for the Gratex comparison.

- [ ] **Step 3: Run it and watch it fail**

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
node "$S/mock-selftest.mjs"; echo "exit=$?"
```

Expected, after about 5 s:
- Node's `Error: Cannot find module 'C:\Users\Signos\AppData\Local\Temp\claude\…\scratchpad\mock\mock-api.mjs'` (from the
  child process);
- then:
  ```
    [FALLA] el mock escucha en 127.0.0.1:8799
    [FALLA] sin excepciones (el mock no arrancó)

  0/2 OK
  exit=1
  ```

Don't pipe it into `head`: a closed pipe kills the test before its `finally` and leaves the child mock running.

- [ ] **Step 4: Write the mock (`$S/mock-api.mjs`)**

```js
// Mock local del API de api-gratex para revisar en el navegador las pantallas
// de cotización (plan "formatos de cotización por tenant", Task 16).
//
// POR QUÉ existe: el .env de fiscalo manda /api a PRODUCCIÓN. Con este mock y
// vite arrancado por vite-mock.mjs (API_PROXY_TARGET=http://127.0.0.1:<puerto>,
// API_KEY='') nada sale de la máquina: ni datos reales ni un e-CF.
//
// QUÉ HACE: responde con datos fijos lo que piden el listado y los formularios
// de cotización, la factura e-CF y la factura simple. Guarda en memoria lo que
// se crea y devuelve lo que recibió más id/code/numero. NO calcula totales:
// eso lo prueban los scripts de paridad (fiscalo) y la CLI del backend. Lo único
// que imita del servidor es la forma de los datos (DECIMAL como texto, ajustes
// como objeto) y las reglas que la pantalla tiene que ver pasar: numeración,
// fecha conservada en el PUT y la guardia de formato (409).
//
// Dos juegos de datos, como dos bases de tenant: 'gratex' y 'ferreteria'. El
// formato del tenant (GET /api/branding -> cotizacion_formato) es aparte, para
// poder cambiarlo con una pestaña abierta (el caso del 409).
//
// Uso:
//   node mock-api.mjs [--port=8791] [--formato=gratex|ferreteria|none|error]
//                     [--datos=gratex|ferreteria] [--409=N]
//   También MOCK_PORT / MOCK_FORMATO / MOCK_DATOS / MOCK_409_NEXT; el argumento gana.
//   formato 'none' = branding sin cotizacion_formato (backend sin desplegar);
//   'error' = GET /api/branding responde 500.
//
// Control en caliente (por el proxy de vite: /api/__mock/...; directo: /__mock/...):
//   GET /__mock/ping                       -> {mock:true,...}: prueba que el proxy llega AQUÍ
//   GET /__mock/estado[?formato=..&permisos=a,b|*|ausente&delay=ms&409=N]
//   GET /__mock/arm-409[?n=1]              -> los próximos N POST/PUT/preview de cotizaciones dan 409
//   GET /__mock/log[?n=20][&limpiar=1]     -> últimas escrituras (método, ruta, cuerpo, respuesta)
//   GET /__mock/reset[?datos=..&formato=..] -> vuelve a los datos sembrados (las huellas se quedan)
//   POST /__mock/captura {clave, lado:'base'|'head', sha, largo, texto} -> guarda la huella de una pantalla
//   GET /__mock/capturas[?clave=x]         -> compara base y head por clave
//   ?mock409=1 en una escritura de /api/cotizaciones -> 409 solo para esa petición
import http from 'node:http'

// ---------------------------------------------------------------------------
// Arranque: argumento > variable de entorno > valor por defecto
// ---------------------------------------------------------------------------
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true']
  }),
)
const FORMATOS_MOCK = ['gratex', 'ferreteria', 'none', 'error']
const DATOS_MOCK = ['gratex', 'ferreteria']
const PUERTO = Number(argv.port ?? process.env.MOCK_PORT ?? 8791)
const ARRANQUE = {
  formato: argv.formato ?? process.env.MOCK_FORMATO ?? 'gratex',
  datos: argv.datos ?? process.env.MOCK_DATOS ?? null,
  arm409: Number(argv['409'] ?? process.env.MOCK_409_NEXT ?? 0) || 0,
}
if (!FORMATOS_MOCK.includes(ARRANQUE.formato)) {
  console.error(`[mock] formato "${ARRANQUE.formato}" no vale: usa ${FORMATOS_MOCK.join(' | ')}`)
  process.exit(2)
}
// Sin --datos, los datos van con el formato (un tenant Ferretería tiene su base).
ARRANQUE.datos ??= ARRANQUE.formato === 'ferreteria' ? 'ferreteria' : 'gratex'
if (!DATOS_MOCK.includes(ARRANQUE.datos)) {
  console.error(`[mock] datos "${ARRANQUE.datos}" no vale: usa ${DATOS_MOCK.join(' | ')}`)
  process.exit(2)
}

// Textos del servidor real (cotizacionController / cotizacionModel / CotizacionFormatos).
const MSG_409 = 'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.'
const MSG_YA_NO_EXISTE_PUT = 'Esta cotización ya no existe. Puede que la hayan eliminado; vuelve al listado.'
const MSG_YA_NO_EXISTE_DEL = 'Esta cotización ya no existe. Puede que otra persona la haya eliminado; actualiza el listado.'
const MSG_PDF_404 = 'No encontramos esta cotización. Puede que la hayan eliminado; actualiza el listado.'
// La retención la calcula el servidor real (5% del Sub-total). El mock no
// calcula: guarda este marcador > 0 para que la edición marque la casilla.
const MARCADOR_RETENCION = '0.01'

// ---------------------------------------------------------------------------
// Datos sembrados (forma de las filas reales: DECIMAL como texto, INT como número)
// ---------------------------------------------------------------------------
const LOGO = (texto) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="110" viewBox="0 0 300 110">` +
      `<rect width="300" height="110" rx="12" fill="#1f4e79"/>` +
      `<text x="150" y="64" font-family="Arial" font-size="26" fill="#fff" text-anchor="middle">${texto}</text></svg>`,
  ).toString('base64')

const cliente = (id, nombre, empresa, rnc, descuento, credito, extra = {}) => ({
  id, email: `cliente${id}@mock.test`, client_name: nombre, company_name: empresa, rnc,
  razon_social: empresa, direccion: 'CALLE PRUEBA NO.1', municipio: 'SANTO DOMINGO NORTE', provincia: 'SANTO DOMINGO',
  descuento, permitir_credito: credito, phone_number: `809-555-01${String(id).padStart(2, '0')}`, ...extra,
})

const producto = (id, sku, nombre, precio, costo, ind, tipo, unidad, stock) => ({
  id, sku, nombre, descripcion: null, category_id: 1, warehouse_id: 1,
  indicador_bien_servicio: tipo, indicador_facturacion: ind,
  precio, precio_2: null, precio_3: null, precio_4: null, costo, unidad_medida: unidad,
  stock, stock_minimo: stock === null ? null : '5.000', activo: 1,
  created_at: '2026-08-01 08:00:00', updated_at: '2026-08-01 08:00:00',
  categoria_nombre: tipo === 2 ? 'Servicios' : 'Ferretería', almacen_nombre: 'Almacén Principal',
})

// Línea de una cotización de Gratex: sin las columnas de la 026 (NULL).
const lineaGratex = (id, cotizacionId, description, quantity, amount, subtotal) => ({
  id, cotizacion_id: cotizacionId, description, amount, quantity, subtotal,
  product_id: null, unidad_medida: null, indicador_facturacion: null, indicador_bien_servicio: null, itbis_amount: null,
})

// Línea de Ferretería, con los montos ya escritos (son datos sembrados, no cuentas del mock).
const lineaFer = (id, cotizacionId, description, quantity, amount, subtotal, productId, unidad, ind, tipo, itbis) => ({
  id, cotizacion_id: cotizacionId, description, amount, quantity, subtotal,
  product_id: productId, unidad_medida: unidad, indicador_facturacion: ind, indicador_bien_servicio: tipo, itbis_amount: itbis,
})

const cabecera = (id, code, date, clientId, clientName, total, extra = {}) => ({
  id, code, date, client_id: clientId, client_name: clientName, total, user_id: 1, updated_at: null,
  formato: null, numero: null, subtotal: null, itbis: null, ajustes: {}, ...extra,
})

const UNIDADES_DECIMALES = new Set([8, 12, 15, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 29, 30, 33, 37, 39, 41, 42, 51, 52, 53, 55, 58, 59, 60, 61, 62])
const UNIDADES = [
  [1, 'BARR', 'Barril'], [2, 'BOL', 'Bolsa'], [3, 'BOT', 'Bote'], [4, 'BULTO', 'Bultos'], [5, 'BOTELLA', 'Botella'],
  [6, 'CAJ', 'Caja/Cajón'], [7, 'CAJETILLA', 'Cajetilla'], [8, 'CM', 'Centímetro'], [9, 'CIL', 'Cilindro'],
  [10, 'CONJ', 'Conjunto'], [11, 'CONT', 'Contenedor'], [12, 'DÍA', 'Día'], [13, 'DOC', 'Docena'], [14, 'FARD', 'Fardo'],
  [15, 'GL', 'Galones'], [16, 'GRAD', 'Grado'], [17, 'GR', 'Gramo'], [18, 'GRAN', 'Granel'], [19, 'HOR', 'Hora'],
  [20, 'HUAC', 'Huacal'], [21, 'KG', 'Kilogramo'], [22, 'kWh', 'Kilovatio Hora'], [23, 'LB', 'Libra'], [24, 'LITRO', 'Litro'],
  [25, 'LOT', 'Lote'], [26, 'M', 'Metro'], [27, 'M2', 'Metro Cuadrado'], [28, 'M3', 'Metro Cúbico'],
  [29, 'MMBTU', 'Millones de Unidades Térmicas'], [30, 'MIN', 'Minuto'], [31, 'PAQ', 'Paquete'], [32, 'PAR', 'Par'],
  [33, 'PIE', 'Pie'], [34, 'PZA', 'Pieza'], [35, 'ROL', 'Rollo'], [36, 'SOBR', 'Sobre'], [37, 'SEG', 'Segundo'],
  [38, 'TANQUE', 'Tanque'], [39, 'TONE', 'Tonelada'], [40, 'TUB', 'Tubo'], [41, 'YD', 'Yarda'], [42, 'YD2', 'Yarda cuadrada'],
  [43, 'UND', 'Unidad'], [44, 'EA', 'Elemento'], [45, 'MILLAR', 'Millar'], [46, 'SAC', 'Saco'], [47, 'LAT', 'Lata'],
  [48, 'DIS', 'Display'], [49, 'BID', 'Bidón'], [50, 'RAC', 'Ración'], [51, 'Q', 'Quintal'],
  [52, 'GRT', 'Toneladas de registro bruto'], [53, 'P2', 'Pie Cuadrado'], [54, 'PAX', 'Pasajero'], [55, 'PULG', 'Pulgadas'],
  [56, 'STAY', 'Parqueo Barcos En Muelle'], [57, 'BDJ', 'Bandeja'], [58, 'HA', 'Hectárea'], [59, 'ML', 'Mililitro'],
  [60, 'MG', 'Miligramo'], [61, 'OZ', 'Onzas'], [62, 'OZT', 'Onzas Troy'],
].map(([id, codigo, descripcion]) => ({ id, codigo, descripcion, permite_decimales: UNIDADES_DECIMALES.has(id) }))

const SECUENCIAS = [
  ['E31', 'Crédito Fiscal'], ['E32', 'Consumo'], ['E33', 'Nota de Débito'], ['E34', 'Nota de Crédito'],
  ['E44', 'Regímenes Especiales'], ['E45', 'Gubernamental'],
].map(([type, nombre]) => ({ type, nombre, secuencia_actual: 0, total_emitidos: 0, restantes: 100, vencimiento: '2027-12-31' }))

function semilla(datos) {
  if (datos === 'gratex') {
    return {
      emisor: {
        rnc: '101010101', razon_social: 'GRATEX MOCK, EIRL', nombre_comercial: 'Gratex (mock)', sucursal: null,
        direccion: 'AV. PRUEBA 123, SANTO DOMINGO', municipio: 'SANTO DOMINGO DE GUZMAN', provincia: 'DISTRITO NACIONAL',
        telefono: '809-555-0000', correo: 'ventas@gratex-mock.test', website: null, actividad_economica: 'IMPRESION',
        fecha_vencimiento_secuencia: '2027-12-31', ambiente: 'TesteCF', fuente: 'emisor_config',
      },
      logo: LOGO('GRATEX (mock)'),
      clients: [
        cliente(3, 'IMPRESOS DEL CARIBE', 'IMPRESOS DEL CARIBE, SRL', '101000013', '0.00', 1),
        cliente(7, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', '401515131', '0.00', 1),
      ],
      products: [
        producto(70, 'STK-022', 'STICKER VINYL 2X2', '15.00', '6.00', 1, 1, '43', '1000.000'),
        producto(71, 'BAN-036', 'BANNER 3X6 FULL COLOR', '2900.00', '1200.00', 1, 1, '43', '50.000'),
        producto(72, 'TAR-001', 'TARJETAS DE PRESENTACION (MILLAR)', '1180.00', '400.00', 1, 1, '45', '20.000'),
      ],
      cotizaciones: [
        cabecera(3, 'XKD482', '2026-09-28 11:20:00', 3, 'IMPRESOS DEL CARIBE', '5900.00', {
          items: [
            lineaGratex(301, 3, 'STICKER VINYL 2X2', '200.000', '15.0000', '3000.00'),
            lineaGratex(302, 3, 'BANNER 3X6 FULL COLOR', '1.000', '2900.0000', '2900.00'),
          ],
        }),
        cabecera(5, 'PLM107', '2026-09-30 15:45:00', 7, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', '1180.00', {
          items: [lineaGratex(501, 5, 'TARJETAS DE PRESENTACION (MILLAR)', '1.000', '1180.0000', '1180.00')],
        }),
      ],
      facturasSimples: [],
    }
  }
  return {
    emisor: {
      rnc: '132615123', razon_social: 'FERREHERRAMIENTAS VENTURA, SRL', nombre_comercial: 'Ferreherramientas Ventura', sucursal: null,
      direccion: 'CALLE NICOLAS CASIMIRO NO.78, ENS. ESPAILLAT, SANTO DOMINGO NORTE', municipio: 'SANTO DOMINGO NORTE',
      provincia: 'SANTO DOMINGO', telefono: '829-898-7798', correo: 'yaironventura0201@hotmail.com', website: null,
      actividad_economica: 'FERRETERIA', fecha_vencimiento_secuencia: '2027-12-31', ambiente: 'TesteCF', fuente: 'emisor_config',
    },
    logo: LOGO('FERREVENTURA (mock)'),
    clients: [
      cliente(7, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', '401515131', '0.00', 1),
      cliente(8, 'CONSTRUCTORA MOCK', 'CONSTRUCTORA MOCK, SRL', '130000018', '10.00', 0),
    ],
    products: [
      producto(55, 'PIN-001', 'GALONES DE PINTURA BLNACA SEMIGLOSS', '2000.00', '1500.00', 1, 1, '43', '40.000'),
      producto(56, 'SER-001', 'INSTALACION DE LAVAMANOS', '1000.00', '0.00', 2, 2, '43', null),
      producto(57, 'ARE-001', 'ARENA LAVADA (EXENTO)', '10.00', '6.00', 4, 1, '43', '500.000'),
      producto(58, 'PVC-002', 'TUBO PVC DE 2 SEMIPRESION', '725.00', '510.00', 1, 1, '43', '25.000'),
      producto(59, 'ELE-012', 'CABLE ELECTRICO #12', '45.50', '30.00', 1, 1, '26', '300.000'),
      producto(60, 'CEM-001', 'FUNDA CEMENTO GRIS', '935.00', '760.00', 1, 1, '46', '80.000'),
      producto(61, 'TST-001', 'PRUEBA REDONDEO', '84.75', '50.00', 1, 1, '43', '10.000'),
    ],
    cotizaciones: [
      // Guardada antes del cambio de formato (formato NULL = gratex): sigue con su Facturar de siempre.
      cabecera(9, 'QWE901', '2026-08-30 08:00:00', 7, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', '236.00', {
        items: [lineaGratex(901, 9, 'TUBO PVC DE 2 SEMIPRESION', '1.000', '236.0000', '236.00')],
      }),
      cabecera(12, 'COT-000012', '2026-09-02 10:15:00', 7, 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', '19350.42', {
        formato: 'ferreteria', numero: 12, subtotal: '15064.25', itbis: '2686.17',
        ajustes: { cargos_bancarios: '100.00', mano_obra: '1500.00', abono: '1000.00', retencion_isr: '753.21' },
        items: [
          lineaFer(1201, 12, 'GALONES DE PINTURA BLNACA SEMIGLOSS', '7.000', '2000.0000', '14000.00', 55, '43', 1, 1, '2520.00'),
          lineaFer(1202, 12, 'INSTALACION DE LAVAMANOS', '1.000', '1000.0000', '1000.00', 56, '43', 2, 2, '160.00'),
          lineaFer(1203, 12, 'CORTE DE TUBO', '2.500', '13.7000', '34.25', null, '26', 1, 1, '6.17'),
          lineaFer(1204, 12, 'ARENA LAVADA (EXENTO)', '3.000', '10.0000', '30.00', 57, '43', 4, 1, '0.00'),
        ],
      }),
      cabecera(13, 'COT-000013', '2026-09-03 09:00:00', 8, 'CONSTRUCTORA MOCK', '9746.80', {
        formato: 'ferreteria', numero: 13, subtotal: '8260.00', itbis: '1486.80',
        items: [
          lineaFer(1301, 13, 'METROS DE CERAMICAS 60X60', '3.000', '1650.0000', '4950.00', null, '43', 1, 1, '891.00'),
          lineaFer(1302, 13, 'FUNDAS DE PAGATOX', '2.000', '625.0000', '1250.00', null, '43', 1, 1, '225.00'),
          lineaFer(1303, 13, 'FUNDA CEMENTO GRIS', '1.000', '960.0000', '960.00', 60, '46', 1, 1, '172.80'),
          lineaFer(1304, 13, 'FUNDA ARENA', '2.000', '300.0000', '600.00', null, '43', 1, 1, '108.00'),
          lineaFer(1305, 13, 'LIBRAS CEMENTO BLANCO', '5.000', '100.0000', '500.00', null, '23', 1, 1, '90.00'),
        ],
      }),
    ],
    facturasSimples: [
      {
        id: 900, no_factura: 'FS-000900', date: '2026-09-20 12:00:00', client_id: 7,
        client_name: 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO', company_name: 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO',
        total: '725.00', tipo_pago: 1, description: 'TUBO PVC DE 2 SEMIPRESION', client_email: 'cliente7@mock.test',
        items: [{ id: 9001, product_id: 58, description: 'TUBO PVC DE 2 SEMIPRESION', quantity: '1.000', amount: '725.0000', subtotal: '725.00', descuento_monto: '0.00', unidad_medida: '43' }],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------
let estado
function reiniciar(datos = ARRANQUE.datos, formato = ARRANQUE.formato) {
  const s = semilla(datos)
  const maxId = (filas) => filas.reduce((m, f) => Math.max(m, f.id), 0)
  estado = {
    datos, formato, permisos: ['*'], brandingDelayMs: 0, arm409: ARRANQUE.arm409, ...s,
    sigCotizacion: maxId(s.cotizaciones) + 1,
    sigItem: 5000,
    sigCliente: maxId(s.clients) + 1,
    sigFacturaSimple: Math.max(maxId(s.facturasSimples), 900) + 1,
    sigCodigoGratex: 101,
    log: [],
    sigLog: 1,
  }
}
reiniciar()

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const ahora = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date())
const hora = () => ahora().slice(11)
const dec = (v, n) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v).toFixed(n))
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const contiene = (campos, q) => campos.some((c) => sinAcentos(c).includes(sinAcentos(q)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fecha que guarda el servidor: 'Y-m-d' recibe la hora actual; vacía = la anterior o ahora. */
function fechaGuardada(valor, anterior) {
  if (typeof valor !== 'string' || valor.trim() === '') return anterior ?? ahora()
  const v = valor.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v} ${hora()}` : v
}

function paginar(filas, q) {
  const page = Math.max(1, Number(q.get('page')) || 1)
  const pageSize = Math.max(1, Number(q.get('pageSize')) || 10)
  const total = filas.length
  return {
    status: true,
    data: filas.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  }
}
const conPaginacion = (q) => q.has('page') || q.has('pageSize') || q.has('query')

/** PDF de una página, válido (offsets del xref exactos), con el texto dado. */
function pdfBase64(lineas) {
  const limpio = (s) =>
    String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => '\\' + c).slice(0, 95)
  const texto = lineas.map((t, i) => `BT /F1 ${i === 0 ? 16 : 10} Tf 50 ${740 - i * 20} Td (${limpio(t)}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objetos.map((o, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1').toString('base64')
}
const docPdf = (filename, lineas) => ({ filename, content: pdfBase64(lineas), mime_type: 'application/pdf' })

// ---------------------------------------------------------------------------
// Cotizaciones
// ---------------------------------------------------------------------------
/** Formato que el servidor real eligiría: el del tenant (none/error => gratex). */
const formatoTenant = () => (estado.formato === 'ferreteria' ? 'ferreteria' : 'gratex')
/** Lo que el cuerpo dice ser (CotizacionFormatos::delCuerpo): texto tal cual, si no 'gratex'. */
const formatoCuerpo = (body) => (typeof body?.formato === 'string' ? body.formato : 'gratex')
const buscarCot = (id) => estado.cotizaciones.find((c) => String(c.id) === String(id)) ?? null

/** La fila como la arma getCotizaciones(): c.* + datos del cliente + description + items + ajustes. */
function vistaCot(c) {
  const cl = estado.clients.find((x) => x.id === c.client_id)
  const { items, ajustes, ...cab } = c
  return {
    ...cab,
    client_name: cl?.client_name ?? c.client_name,
    company_name: cl?.company_name ?? null,
    rnc: cl?.rnc ?? null,
    description: items.map((i) => i.description).join('\n'),
    items: items.map((i) => ({ ...i })),
    ajustes: { ...ajustes },
  }
}

/** Ajustes como los devuelve el GET: solo los distintos de 0, en texto DECIMAL. */
function ajustesGuardados(a) {
  const out = {}
  for (const k of ['cargos_bancarios', 'manejo_bancario', 'mano_obra', 'abono']) {
    if (Number(a?.[k]) > 0) out[k] = dec(a[k], 2)
  }
  if (a?.retencion_isr === true) out.retencion_isr = MARCADOR_RETENCION
  return out
}

function lineasDe(body, cotizacionId, ferreteria) {
  return (Array.isArray(body?.items) ? body.items : []).map((it) => {
    const base = {
      id: estado.sigItem++, cotizacion_id: cotizacionId,
      description: String(it?.description ?? ''),
      amount: dec(it?.amount, 4), quantity: dec(it?.quantity ?? 1, 3),
    }
    return ferreteria
      ? {
          ...base, subtotal: null,
          product_id: it?.product_id ?? null,
          unidad_medida: it?.unidad_medida != null && it.unidad_medida !== '' ? String(parseInt(it.unidad_medida, 10)) : '43',
          indicador_facturacion: it?.indicador_facturacion ?? 1,
          indicador_bien_servicio: it?.indicador_bien_servicio ?? 1,
          itbis_amount: null,
        }
      : { ...base, subtotal: dec(it?.subtotal, 2), product_id: null, unidad_medida: null, indicador_facturacion: null, indicador_bien_servicio: null, itbis_amount: null }
  })
}

const nombreCliente = (id) => estado.clients.find((x) => x.id === Number(id))?.client_name ?? ''

function crearCot(body) {
  const id = estado.sigCotizacion++
  const ferreteria = formatoCuerpo(body) === 'ferreteria'
  if (ferreteria) {
    const numero = estado.cotizaciones.reduce((m, c) => Math.max(m, c.numero ?? 0), 0) + 1
    const code = `COT-${String(numero).padStart(6, '0')}`
    estado.cotizaciones.push(cabecera(id, code, fechaGuardada(body.date), Number(body.client_id), nombreCliente(body.client_id), null, {
      formato: 'ferreteria', numero, ajustes: ajustesGuardados(body.ajustes), items: lineasDe(body, id, true),
    }))
    return { id, code, numero, total: null }
  }
  const code = `MCK${String(estado.sigCodigoGratex++).padStart(3, '0')}`
  estado.cotizaciones.push(cabecera(id, code, fechaGuardada(body.date), Number(body.client_id), nombreCliente(body.client_id), dec(body.total, 2), {
    user_id: body.user_id ?? null, items: lineasDe(body, id, false),
  }))
  return { id, code, message: 'Cotization saved' }
}

function actualizarCot(c, body) {
  c.client_id = Number(body.client_id)
  c.client_name = nombreCliente(body.client_id)
  c.updated_at = ahora()
  // Sin `date` se conserva la guardada (spec 6.5): la pantalla de Ferretería la omite si no cambió el día.
  c.date = fechaGuardada(body.date, c.date)
  if (c.formato === 'ferreteria') {
    c.items = lineasDe(body, c.id, true)
    // El PUT reemplaza el juego completo: sin `ajustes` no queda ninguno.
    c.ajustes = ajustesGuardados(body.ajustes)
    return { id: c.id, code: c.code, numero: c.numero, total: null }
  }
  c.items = lineasDe(body, c.id, false)
  c.total = dec(body.total, 2)
  return 'Cotization updated'
}

/** POST/PUT/preview: 409 armado, o la guardia de formato del controlador. null = sigue. */
function guardia(q, resuelto, body) {
  if (q.get('mock409') === '1') return [409, { status: false, error: MSG_409 }]
  if (estado.arm409 > 0) {
    estado.arm409--
    return [409, { status: false, error: MSG_409 }]
  }
  if (formatoCuerpo(body) !== resuelto) return [409, { status: false, error: MSG_409 }]
  return null
}

function rutaCotizaciones(metodo, ruta, q, body) {
  const pdf = /^\/api\/cotizaciones\/(\d+)\/pdf$/.exec(ruta)
  if (metodo === 'GET' && pdf) {
    const c = buscarCot(pdf[1])
    if (!c) return [404, { status: false, error: MSG_PDF_404 }]
    return [200, { status: true, data: docPdf(`Cotizacion_${c.code}.pdf`, [
      `MOCK - PDF de la cotizacion ${c.code}`, `formato: ${c.formato ?? 'gratex (NULL)'}`, `cliente: ${nombreCliente(c.client_id)}`,
      `${c.items.length} lineas`, ...c.items.map((i) => `${i.quantity} x ${i.description} @ ${i.amount}`),
    ]) }]
  }
  if (metodo === 'POST' && ruta === '/api/cotizaciones/preview') {
    const fila = body?.id != null && body.id !== '' && body.id !== 0 ? buscarCot(body.id) : null
    const resuelto = fila ? (fila.formato ?? 'gratex') : formatoTenant()
    const no = guardia(q, resuelto, body)
    if (no) return no
    return [200, { status: true, data: docPdf('Cotizacion_Preview.pdf', [
      `MOCK - VISTA PREVIA (${resuelto})`, `codigo: ${fila ? fila.code : resuelto === 'ferreteria' ? 'VISTA PREVIA' : 'PREVIEW'}`,
      `client_id: ${body?.client_id}`, `${(body?.items ?? []).length} lineas`,
      ...(body?.items ?? []).map((i) => `${i.quantity} x ${i.description} @ ${i.amount}`),
      `ajustes: ${JSON.stringify(body?.ajustes ?? {})}`,
    ]) }]
  }
  if (ruta !== '/api/cotizaciones') return null
  if (metodo === 'GET') {
    if (q.has('id')) {
      const c = buscarCot(q.get('id'))
      return [200, { status: true, data: c ? [vistaCot(c)] : [] }]
    }
    const busca = q.get('query') ?? ''
    const filas = estado.cotizaciones
      .map(vistaCot)
      .filter((c) => !busca || contiene([c.code, c.client_name, c.company_name, c.rnc], busca))
      // ORDER BY c.date DESC, c.id DESC
      .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
    return [200, paginar(filas, q)]
  }
  if (metodo === 'POST') {
    const no = guardia(q, formatoTenant(), body)
    if (no) return no
    return [200, { status: true, data: crearCot(body) }]
  }
  if (metodo === 'PUT') {
    if (body?.id == null || body.id === '') return [200, { status: false, error: 'Falta el id de la cotización.' }]
    const c = buscarCot(body.id)
    const no = guardia(q, c ? (c.formato ?? 'gratex') : 'gratex', body)
    if (no) return no
    if (!c) return [200, { status: false, error: MSG_YA_NO_EXISTE_PUT }]
    return [200, { status: true, data: actualizarCot(c, body) }]
  }
  if (metodo === 'DELETE') {
    const i = estado.cotizaciones.findIndex((c) => String(c.id) === String(body?.id))
    if (i < 0) return [200, { status: false, error: MSG_YA_NO_EXISTE_DEL }]
    estado.cotizaciones.splice(i, 1)
    return [200, { status: true, data: 'Cotization deleted' }]
  }
  return null
}

// ---------------------------------------------------------------------------
// Resto del API que tocan esas pantallas
// ---------------------------------------------------------------------------
function usuario() {
  const u = { id: 1, email: 'mock@fiscalo.test', username: 'mock', name: 'Usuario Mock', role: 'admin' }
  return estado.permisos === null ? u : { ...u, permissions: [...estado.permisos] }
}

async function rutaApi(metodo, ruta, q, body, req) {
  // --- auth (sobre { success, data }) ---
  if (ruta === '/api/auth/me' && metodo === 'GET') {
    if (!/^Bearer\s+\S+/.test(req.headers.authorization ?? '')) return [401, { success: false, error: 'Unauthorized' }]
    return [200, { success: true, data: { user: usuario() } }]
  }
  if (ruta === '/api/auth/login' && metodo === 'POST') return [200, { success: true, data: { token: 'mock-token-t16', user: usuario() } }]
  if (ruta === '/api/auth/signout' && metodo === 'POST') return [200, { success: true, data: null }]

  // --- tenant ---
  if (ruta === '/api/branding' && metodo === 'GET') {
    if (estado.brandingDelayMs > 0) await sleep(estado.brandingDelayMs)
    if (estado.formato === 'error') return [500, { status: false, error: 'MOCK: /api/branding falla a propósito (formato=error).' }]
    return [200, { status: true, data: {
      template: 'clasico', accent_color: null, logo_path: `logos/${estado.datos}.svg`, has_custom_logo: true,
      logo_data_uri: estado.logo, available_templates: ['clasico', 'moderno', 'compacto'],
      ...(estado.formato === 'none' ? {} : { cotizacion_formato: estado.formato }),
    } }]
  }
  if (ruta === '/api/emisor' && metodo === 'GET') return [200, { status: true, data: estado.emisor }]
  if (ruta === '/api/unidades-medida' && metodo === 'GET') return [200, { status: true, data: UNIDADES }]
  if (ruta === '/api/rnc/consulta') return [404, { status: false, error: 'MOCK: la consulta de RNC no está simulada.' }]
  if (['/api/provincias-municipios', '/api/tipos-bienes-servicios'].includes(ruta)) return [200, { status: true, data: [] }]
  if (ruta === '/api/categories' && metodo === 'GET') {
    return [200, { status: true, data: [{ id: 1, nombre: 'Ferretería', descripcion: null }, { id: 2, nombre: 'Servicios', descripcion: null }] }]
  }
  if (ruta === '/api/warehouses' && metodo === 'GET') return [200, { status: true, data: [{ id: 1, nombre: 'Almacén Principal', activo: 1 }] }]

  // --- clientes ---
  if (ruta === '/api/clients') {
    if (metodo === 'GET') {
      if (q.has('id')) {
        const c = estado.clients.find((x) => String(x.id) === q.get('id'))
        return c ? [200, { status: true, data: c }] : [404, { status: false, error: 'No encontramos este cliente. Puede que lo hayan eliminado.' }]
      }
      const busca = q.get('query') ?? ''
      const filas = estado.clients
        .filter((c) => !busca || contiene([c.client_name, c.company_name, c.razon_social, c.rnc, c.email, c.phone_number], busca))
        .sort((a, b) => b.id - a.id)
      return [200, conPaginacion(q) ? paginar(filas, q) : { status: true, data: filas }]
    }
    if (metodo === 'POST') {
      const c = cliente(estado.sigCliente++, String(body?.client_name ?? ''), String(body?.company_name ?? ''),
        body?.rnc ? String(body.rnc).replace(/\D/g, '') : null, dec(body?.descuento ?? 0, 2), body?.permitir_credito ? 1 : 0,
        { email: body?.email ?? '', phone_number: body?.phone_number ?? '', razon_social: body?.razon_social ?? body?.company_name ?? null })
      estado.clients.push(c)
      return [200, { status: true, data: c }]
    }
  }

  // --- productos ---
  if (ruta === '/api/products' && metodo === 'GET') {
    if (q.has('id')) {
      const p = estado.products.find((x) => String(x.id) === q.get('id'))
      return p ? [200, { status: true, data: p }] : [404, { status: false, error: 'Este producto no existe.' }]
    }
    const busca = q.get('query') ?? ''
    const cat = Number(q.get('category_id')) || null
    const filas = estado.products
      .filter((p) => (!busca || contiene([p.nombre, p.sku, p.descripcion, p.categoria_nombre], busca)) && (!cat || p.category_id === cat))
      .sort((a, b) => b.id - a.id)
    return [200, conPaginacion(q) || q.has('category_id') ? paginar(filas, q) : { status: true, data: filas }]
  }

  // --- facturas e-CF: solo lo que abre el formulario. Emitir NO se simula. ---
  if (ruta === '/api/facturas/stats' && metodo === 'GET') {
    return [200, { status: true, data: {
      resumen: { total_ecf: 0, monto_total: 0, tipos_distintos: 0, primer_ecf: null, ultimo_ecf: null },
      por_tipo: [], por_estado: [], por_mes: [], ventas_por_mes: [], ventas_por_dia: [], secuencias: SECUENCIAS,
    } }]
  }
  if (ruta === '/api/facturas/preview' && metodo === 'POST') {
    return [200, { status: true, data: docPdf('Factura_Preview.pdf', [
      `MOCK - VISTA PREVIA e-CF E${body?.tipo_ecf ?? '?'}`, `client_id: ${body?.client_id ?? '-'}`,
      ...(body?.items ?? []).map((i) => `${i.cantidad} x ${i.nombre_item} @ ${i.precio_unitario} (ind ${i.indicador_facturacion}, prod ${i.product_id ?? '-'})`),
    ]) }]
  }
  if (ruta === '/api/facturas' && metodo === 'POST') {
    // 422 para que la pantalla muestre el texto tal cual: aquí nunca se emite nada.
    return [422, { status: false, error: 'MOCK: emitir e-CF está deshabilitado en el mock. Usa Vista previa.' }]
  }

  // --- facturas simples ---
  if (ruta === '/api/facturas-simples/stats' && metodo === 'GET') {
    return [200, { status: true, data: { resumen: { total: estado.facturasSimples.length, monto_total: 0 }, por_mes: [], por_dia: [] } }]
  }
  if (ruta === '/api/facturas-simples/preview' && metodo === 'POST') {
    if (body?.format === 'datos') return [422, { status: false, error: 'MOCK: el recibo (tirilla) no está simulado. Usa Hoja carta.' }]
    return [200, { status: true, data: docPdf('FacturaSimple_Preview.pdf', [
      'MOCK - VISTA PREVIA factura simple', ...(body?.items ?? []).map((i) => `${i.quantity} x ${i.description} @ ${i.amount}`),
    ]) }]
  }
  const fs = /^\/api\/facturas-simples(?:\/(\d+))?(\/pdf)?$/.exec(ruta)
  if (fs) {
    const [, id, esPdf] = fs
    const f = id ? estado.facturasSimples.find((x) => String(x.id) === id) : null
    if (id && !f) return [404, { status: false, error: 'No encontramos esta factura. Puede que la hayan eliminado.' }]
    if (esPdf && metodo === 'GET') {
      if (q.get('format') === 'datos') return [422, { status: false, error: 'MOCK: el recibo (tirilla) no está simulado. Usa Hoja carta.' }]
      return [200, { status: true, data: docPdf(`FacturaSimple_${f.no_factura}.pdf`, [`MOCK - factura simple ${f.no_factura}`]) }]
    }
    if (metodo === 'GET') {
      if (f) return [200, { status: true, data: f }]
      const filas = [...estado.facturasSimples].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
      return [200, paginar(filas, q)]
    }
    if (metodo === 'POST' && !id) {
      const nuevoId = estado.sigFacturaSimple++
      const nueva = {
        id: nuevoId, no_factura: `FS-${String(nuevoId).padStart(6, '0')}`, date: fechaGuardada(body?.date),
        client_id: body?.client_id ?? null, client_name: body?.client_id ? nombreCliente(body.client_id) : body?.client_name ?? null,
        company_name: null, total: null, tipo_pago: body?.tipo_pago ?? 1,
        description: (body?.items ?? []).map((i) => i.description).join('\n'),
        items: (body?.items ?? []).map((i) => ({
          id: estado.sigItem++, product_id: i.product_id ?? null, description: i.description, quantity: dec(i.quantity, 3),
          amount: dec(i.amount, 4), subtotal: null, descuento_monto: dec(i.descuento_monto ?? 0, 2), unidad_medida: i.unidad_medida ?? null,
        })),
      }
      estado.facturasSimples.push(nueva)
      return [200, { status: true, data: nueva }]
    }
    if (metodo === 'DELETE' && f) {
      estado.facturasSimples = estado.facturasSimples.filter((x) => x !== f)
      return [200, { status: true, data: 'Factura eliminada' }]
    }
  }

  // --- listados que no importan aquí: vacíos, con su paginación ---
  if (metodo === 'GET') {
    console.log(`  [mock] SIN HANDLER: GET ${ruta} -> lista vacía`)
    return [200, { status: true, data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }]
  }
  return null
}

// ---------------------------------------------------------------------------
// Control del mock
// ---------------------------------------------------------------------------
function resumen() {
  return {
    mock: true, puerto: PUERTO, datos: estado.datos, formato: estado.formato,
    permisos: estado.permisos, brandingDelayMs: estado.brandingDelayMs, arm409: estado.arm409,
    cotizaciones: estado.cotizaciones.map((c) => `${c.id}:${c.code}:${c.formato ?? 'null'}`),
    escrituras: estado.log.length,
  }
}

// Huellas de pantalla de la comparación de Gratex (base = antes de la rama,
// head = la rama). Viven fuera de `estado`: un reset entre las dos corridas no las borra.
const capturas = new Map()

function rutaControl(sub, q, body) {
  if (sub === 'ping') return [200, { status: true, data: resumen() }]
  if (sub === 'captura') {
    const { clave, lado, sha, largo, texto } = body ?? {}
    if (!clave || !['base', 'head'].includes(lado)) return [400, { status: false, error: "captura: hace falta clave y lado 'base' | 'head'" }]
    capturas.set(clave, { ...(capturas.get(clave) ?? {}), [lado]: { sha, largo, texto, hora: hora() } })
    return [200, { status: true, data: { clave, lado, sha } }]
  }
  if (sub === 'capturas') {
    const filas = [...capturas.entries()]
      .filter(([clave]) => !q.has('clave') || clave === q.get('clave'))
      .map(([clave, { base, head }]) => ({
        clave,
        base: base ? { sha: base.sha, largo: base.largo } : null,
        head: head ? { sha: head.sha, largo: head.largo } : null,
        htmlIgual: !!base && !!head && base.sha === head.sha,
        textoIgual: !!base && !!head && base.texto === head.texto,
        ...(q.has('clave') ? { textoBase: base?.texto ?? null, textoHead: head?.texto ?? null } : {}),
      }))
    return [200, { status: true, data: filas }]
  }
  if (sub === 'estado') {
    if (q.has('formato')) {
      if (!FORMATOS_MOCK.includes(q.get('formato'))) return [400, { status: false, error: `formato: ${FORMATOS_MOCK.join(' | ')}` }]
      estado.formato = q.get('formato')
    }
    if (q.has('permisos')) {
      const p = q.get('permisos')
      estado.permisos = p === 'ausente' ? null : p === '*' ? ['*'] : p.split(',').map((x) => x.trim()).filter(Boolean)
    }
    if (q.has('delay')) estado.brandingDelayMs = Math.max(0, Number(q.get('delay')) || 0)
    if (q.has('409')) estado.arm409 = Math.max(0, Number(q.get('409')) || 0)
    return [200, { status: true, data: resumen() }]
  }
  if (sub === 'arm-409') {
    estado.arm409 = Math.max(1, Number(q.get('n')) || 1)
    return [200, { status: true, data: resumen() }]
  }
  if (sub === 'log') {
    const n = Math.max(1, Number(q.get('n')) || 20)
    const ultimas = estado.log.slice(-n)
    if (q.get('limpiar') === '1') estado.log = []
    return [200, { status: true, data: ultimas }]
  }
  if (sub === 'reset') {
    const datos = q.get('datos') ?? ARRANQUE.datos
    const formato = q.get('formato') ?? ARRANQUE.formato
    if (!DATOS_MOCK.includes(datos) || !FORMATOS_MOCK.includes(formato)) return [400, { status: false, error: 'datos o formato inválido' }]
    reiniciar(datos, formato)
    return [200, { status: true, data: resumen() }]
  }
  return [404, { status: false, error: `control desconocido: ${sub}` }]
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
function leerCuerpo(req) {
  return new Promise((resolve) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

async function atender(req, res) {
  const t0 = Date.now()
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const ruta = url.pathname.replace(/\/+$/, '') || '/'
  const metodo = req.method ?? 'GET'
  const crudo = metodo === 'GET' || metodo === 'HEAD' ? '' : await leerCuerpo(req)
  let body = null
  if (crudo) {
    try { body = JSON.parse(crudo) } catch { body = { _noJson: crudo.slice(0, 200) } }
  }

  let status = 200
  let payload
  try {
    const control = /^(?:\/api)?\/__mock\/([a-z0-9-]+)$/.exec(ruta)
    if (metodo === 'OPTIONS') {
      status = 204
    } else if (control) {
      ;[status, payload] = rutaControl(control[1], url.searchParams, body)
    } else if (ruta === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>Mock API</title><body style="font-family:sans-serif">` +
        `<h1>Mock API de fiscalo (no es la app)</h1><p>Puerto ${PUERTO} · datos <b>${estado.datos}</b> · formato <b>${estado.formato}</b></p>` +
        `<p>La app corre en el puerto de vite (5175/5176). Control: <code>/__mock/estado</code>, <code>/__mock/log</code>.</p></body>`)
      console.log(`${hora()} GET / -> 200 (página del mock)`)
      return
    } else {
      const r = rutaCotizaciones(metodo, ruta, url.searchParams, body) ?? (await rutaApi(metodo, ruta, url.searchParams, body, req))
      if (r) [status, payload] = r
      else [status, payload] = [404, { status: false, error: `MOCK: ruta no simulada (${metodo} ${ruta})` }]
    }
  } catch (e) {
    console.error('  [mock] ERROR', e)
    ;[status, payload] = [500, { status: false, error: `MOCK: excepción (${e?.message ?? e})` }]
  }

  const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(metodo) && !ruta.includes('/__mock/')
  if (escritura) {
    estado.log.push({ n: estado.sigLog++, hora: hora(), metodo, ruta: ruta + url.search, cuerpo: body, http: status, respuesta: payload })
    if (estado.log.length > 200) estado.log.shift()
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
  res.end(status === 204 ? '' : JSON.stringify(payload ?? null))
  console.log(`${hora()} ${metodo} ${ruta}${url.search} -> ${status} (${Date.now() - t0} ms)`)
  if (escritura) {
    console.log(`  [cuerpo] ${JSON.stringify(body)}`)
    console.log(`  [respuesta] ${JSON.stringify(payload).slice(0, 400)}`)
  }
}

// Solo loopback, nunca la red. IPv4 es el que usa el proxy de vite
// (http://127.0.0.1:<puerto>); ::1 es para quien pruebe http://localhost:<puerto>
// (Windows resuelve localhost a ::1 primero) y puede faltar sin problema.
for (const host of ['127.0.0.1', '::1']) {
  const servidor = http.createServer(atender)
  servidor.on('error', (e) => {
    if (host === '::1') return console.log(`[mock] sin IPv6 (${e.code}): solo 127.0.0.1`)
    console.error(`[mock] no pude escuchar en ${host}:${PUERTO}: ${e.message}`)
    process.exit(1)
  })
  servidor.listen(PUERTO, host, () => {
    if (host === '127.0.0.1') {
      console.log(`[mock] API de fiscalo en http://127.0.0.1:${PUERTO} · datos=${estado.datos} · formato=${estado.formato} · arm409=${estado.arm409}`)
    }
  })
}
```

Notes:
- **Datasets.**
  - Seeded rows have the real post-026 shape. Gratex rows have `formato: null`, the new item columns `null` and
    `ajustes: {}`.
  - `client_name` comes from the client row, like the JOIN in `getCotizaciones()`.
  - The list is ordered `date DESC, id DESC`.
- **Guard (`guardia`).** It mirrors the controller table in D_T06:
  - POST resolves to the tenant setting;
  - PUT resolves to the row's formato, and a missing row resolves to gratex;
  - preview resolves to the row's formato when `id` exists, otherwise to the tenant setting.
  - `none` and `error` count as gratex, which is the backend default.
- **The unit catalog** is the master's 62 units, with `permite_decimales` from master migration 010's rules (Metro 26
  yes, Unidad 43 no, Saco 46 no, Libra 23 yes).
- **`POST /api/facturas` (emit) answers 422.** This flow never emits anything, not even against the mock.
- **It listens on `127.0.0.1` and `::1` only.** IPv4 is what the proxy uses; `::1` is there because `preview_start`
  opens `localhost`, which Windows resolves to `::1` first.

- [ ] **Step 5: Run the self-test and watch it pass**

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
node "$S/mock-selftest.mjs"; echo "exit=$?"
node --check "$S/mock-api.mjs" && echo "sintaxis ok"
```

Expected: 59 lines `  [OK  ] …`, then `59/59 OK`, `exit=0` and `sintaxis ok`. For example:

```
  [OK  ] el mock escucha en 127.0.0.1:8799
  [OK  ] http://localhost:8799 también responde (preview_start abre localhost)
  [OK  ] ping por /api/__mock (la ruta que usa el proxy de vite)
  ...
  [OK  ] POST sin formato (Gratex) en tenant ferreteria -> 409 con el texto del spec
  ...
  [OK  ] el xref del PDF apunta a "xref" y a cada "N 0 obj"
  ...
  [OK  ] el reset no borra las huellas

59/59 OK
exit=0
```

- [ ] **Step 6: Write the vite launcher (`$S/vite-mock.mjs`)**

```js
// Arranca el vite de fiscalo para la revisión en el navegador con /api
// apuntando al mock local (mock-api.mjs) y NUNCA al backend del .env, que es
// producción. Vite corre en este mismo proceso (API createServer): al parar la
// entrada de launch.json no queda un vite huérfano ocupando el puerto.
//
// Uso:
//   node vite-mock.mjs [--port=5175] [--dir=C:/Users/Signos/Documents/edwin/fiscalo]
//                      [--api=http://127.0.0.1:8791] [--cache=<carpeta>]
//   --cache: cacheDir propio. Obligatorio con una copia del repo (la base de la
//   comparación de Gratex): con otra raíz, vite re-optimizaría node_modules/.vite,
//   que comparte con el vite de otras sesiones.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = (k, def) => {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${k}=`))
  return a ? a.slice(k.length + 3) : def
}
const dir = path.resolve(arg('dir', 'C:/Users/Signos/Documents/edwin/fiscalo'))
const port = Number(arg('port', '5175'))
const cache = arg('cache', null) ? path.resolve(arg('cache')) : null

// Solo un destino de esta máquina. Se toma del argumento, nunca del entorno: un
// API_PROXY_TARGET heredado del shell podría ser el de producción.
const destino = new URL(arg('api', 'http://127.0.0.1:8791'))
if (!['127.0.0.1', 'localhost', '[::1]'].includes(destino.hostname)) {
  console.error(`[vite-mock] ${destino.origin} no es local: este arranque solo apunta a un mock en esta máquina.`)
  process.exit(1)
}
const entradaVite = path.join(dir, 'node_modules', 'vite', 'dist', 'node', 'index.js')
if (!fs.existsSync(entradaVite)) {
  console.error(`[vite-mock] no encuentro ${entradaVite} (¿falta node_modules en ${dir}?)`)
  process.exit(1)
}

// vite.config.ts lee con loadEnv(mode, process.cwd(), ''), y ahí el entorno del
// proceso gana al .env: esto pisa el API_PROXY_TARGET de producción. API_KEY
// vacía => el proxy no inyecta X-API-KEY.
process.env.API_PROXY_TARGET = destino.origin
process.env.API_KEY = ''
// Con estas el bundle llamaría directo a otro host, sin pasar por el proxy.
delete process.env.VITE_API_BASE_URL
delete process.env.VITE_API_KEY
process.chdir(dir)

const { createServer } = await import(pathToFileURL(entradaVite).href)
const server = await createServer({
  root: dir,
  configFile: path.join(dir, 'vite.config.ts'),
  // 'runner' carga el config en memoria: 'bundle' escribe un temporal en node_modules/.vite-temp.
  configLoader: 'runner',
  clearScreen: false,
  ...(cache ? { cacheDir: cache } : {}),
  server: {
    port,
    strictPort: true,
    open: false,
    // Una copia con node_modules enlazado (junction) sirve archivos de fuera de su raíz.
    fs: { allow: [dir, fs.realpathSync(path.join(dir, 'node_modules')), ...(cache ? [cache] : [])] },
  },
})

// Segunda barrera: el proxy que quedó resuelto tiene que ser el mock, y sin X-API-KEY.
const proxy = server.config.server.proxy?.['/api']
const objetivo = typeof proxy === 'string' ? proxy : proxy?.target
if (objetivo !== destino.origin || (typeof proxy === 'object' && proxy.configure)) {
  console.error(`[vite-mock] el proxy /api quedó en ${objetivo ?? '(ninguno)'} y no en ${destino.origin}: no arranco.`)
  await server.close()
  process.exit(1)
}
await server.listen()
server.printUrls()
console.log(`[vite-mock] raíz ${dir} · /api -> ${objetivo}${cache ? ` · cacheDir ${cache}` : ''}`)
```

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
node --check "$S/vite-mock.mjs" && echo "sintaxis ok"
node "$S/vite-mock.mjs" --api=https://gratex.net; echo "exit=$?"
```

Expected:
- `sintaxis ok`;
- then `[vite-mock] https://gratex.net no es local: este arranque solo apunta a un mock en esta máquina.` and `exit=1`.
  The guard works without starting anything.

Why it is built this way:
- `createServer` runs in the same process. On Windows, stopping a wrapper doesn't kill a spawned child, so a child
  `vite` would keep the port and `--strictPort` would fail on the next start.
- `configLoader: 'runner'` loads `vite.config.ts` in memory. The default `bundle` writes a temporary file into
  `node_modules/.vite-temp` of the shared checkout.
- `vite.config.ts` reads `loadEnv(mode, process.cwd(), '')`, where process env beats `.env`. That is checked in Vite
  6.4.3's `loadEnv`, the loop over `process.env` after the parsed files. So setting `process.env.API_PROXY_TARGET`
  before `createServer` replaces the production target.
- After `createServer` it reads back `server.config.server.proxy['/api'].target`. It refuses to listen unless that is
  the mock and `configure` (the `X-API-KEY` injector) is unset.
- `--cache` and `server.fs.allow` exist for the base snapshot:
  - Its root differs, so with the shared `node_modules/.vite` vite would re-optimize deps under the dev server another
    session may be running.
  - Its `node_modules` is a junction, and the dependency files resolve outside its root.

- [ ] **Step 7: Write the page helpers (`$S/ayudas.js`)**

```js
// Ayudas de INSPECCIÓN para la revisión del Task 16 (no cambian la pantalla).
// Se pegan con javascript_tool después de cada recarga: una recarga las borra.
window.__esperar = async (fn, ms = 6000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try { if (fn()) return true } catch { /* todavía no */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}
// presentDocument abre el PDF con window.open: se guarda la URL del blob en vez
// de abrir otra pestaña, y __pdf() comprueba que es un PDF de verdad.
window.__abiertos = []
window.open = (u) => { window.__abiertos.push(String(u)); return null }
window.__pdf = async () => {
  const u = window.__abiertos.at(-1)
  if (!u) return null
  const b = await fetch(u).then((r) => r.blob())
  return { abiertos: window.__abiertos.length, tipo: b.type, bytes: b.size, cabeza: await b.slice(0, 8).text() }
}
// Clic por el texto exacto del botón. Con el viewport emulado a 1280 en un panel
// más angosto, el clic por coordenadas (computer + ref) puede caer en otro botón:
// este no depende de la escala. `raiz` acota la búsqueda (p. ej. __fila('COT-000014')).
window.__clic = (texto, raiz = document, sel = 'button, [role="menuitem"], a, label, summary') => {
  const visibles = [...raiz.querySelectorAll(sel)]
    .filter((e) => e.offsetParent !== null && e.innerText.replace(/\s+/g, ' ').trim() === texto)
  if (visibles.length !== 1) throw new Error(`__clic("${texto}"): ${visibles.length} elementos visibles con ese texto`)
  if (visibles[0].disabled) throw new Error(`__clic("${texto}"): está deshabilitado`)
  visibles[0].click()
  return texto
}
window.__fila = (txt) => [...document.querySelectorAll('.content tbody tr')].find((tr) => tr.innerText.includes(txt)) ?? null
// Casilla (input checkbox, Checkbox o Switch de components/ui) junto a un texto:
// devuelve si está marcada; con clic=true la pulsa primero.
window.__casilla = (texto, clic = false) => {
  const CAJA = 'input[type="checkbox"], .checkbox, .switch, [role="checkbox"], [role="switch"]'
  const cont = [...document.querySelectorAll('.content label, .content div, .content span')]
    .filter((e) => e.offsetParent !== null && e.innerText?.replace(/\s+/g, ' ').trim().startsWith(texto))
    .sort((a, b) => a.innerText.length - b.innerText.length)[0]
  const caja = cont?.querySelector(CAJA) ?? cont?.parentElement?.querySelector(CAJA)
  if (!caja) throw new Error(`__casilla("${texto}"): no encontré la casilla`)
  if (clic) caja.click()
  const marcada = (c) => (c.matches('input') ? c.checked : c.classList.contains('on') || c.getAttribute('aria-checked') === 'true')
  return marcada(caja)
}
// Resultados abiertos de ClientCombobox / ProductoCombobox, y elegir uno por su nombre.
window.__opciones = () => [...document.querySelectorAll('.combobox-item')].map((e) => e.innerText.replace(/\s+/g, ' ').trim())
window.__elegir = (nombre) => {
  const it = [...document.querySelectorAll('.combobox-item')].filter((e) => e.querySelector('.cell-main')?.innerText.trim() === nombre)
  if (it.length !== 1) throw new Error(`__elegir("${nombre}"): ${it.length} resultados`)
  it[0].click()
  return nombre
}
// Item del menú lateral por su etiqueta (funciona también con el menú móvil cerrado).
window.__menu = (etiqueta) => {
  const it = [...document.querySelectorAll('.sidebar .nav-item')].find((e) => e.querySelector('span')?.innerText.trim() === etiqueta)
  if (!it) throw new Error(`__menu("${etiqueta}"): no está en el menú`)
  it.click()
  return etiqueta
}
window.__toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.replace(/\s+/g, ' ').trim())
window.__ultimas = async (n = 1) => (await fetch(`/api/__mock/log?n=${n}`).then((r) => r.json())).data
window.__mock = async (q) => (await fetch(`/api/__mock/${q}`).then((r) => r.json())).data
window.__sinScrollHorizontal = () => ({
  ancho: window.innerWidth, pagina: document.documentElement.scrollWidth,
  ok: document.documentElement.scrollWidth <= window.innerWidth,
})
// Líneas de un formulario: valores de sus campos (un select da su texto) y el texto de la fila.
window.__filas = (sel = '.content .fx-row') => [...document.querySelectorAll(sel)].map((r) => ({
  valores: [...r.querySelectorAll('input, select, textarea')].map((i) =>
    i.tagName === 'SELECT' ? (i.options[i.selectedIndex]?.text ?? '') : i.type === 'checkbox' ? String(i.checked) : i.value),
  texto: r.innerText.replace(/\s+/g, ' ').trim(),
}))
window.__texto = (sel = '.content') => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? null
// Huella de la pantalla para comparar la base con la rama: HTML de .content sin
// lo que cambia solo (ids de React) + texto + valores de los campos. Se guarda en el mock.
window.__huella = async (clave, lado) => {
  const root = document.querySelector('.content')
  const c = root.cloneNode(true)
  c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
  c.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      if (/^(for|aria-(controls|labelledby|describedby|activedescendant|owns))$/.test(a.name)) n.removeAttribute(a.name)
    }
  })
  const html = c.outerHTML.replace(/:r[0-9a-z]+:/g, ':r:')
  const valores = [...root.querySelectorAll('input, textarea, select')].map((i) => (i.type === 'checkbox' ? String(i.checked) : i.value))
  const texto = `${root.innerText.replace(/\s+/g, ' ').trim()} || ${valores.join(' | ')}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const sha = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  await fetch('/api/__mock/captura', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave, lado, sha, largo: html.length, texto }),
  })
  return { clave, lado, sha, largo: html.length }
}
// Escrituras que recibió el mock desde la última llamada (y vacía el log). La
// hora de `date` cambia entre corridas: solo cuenta el día.
window.__escrituras = async (clave, lado) => {
  const log = await fetch('/api/__mock/log?n=50&limpiar=1').then((r) => r.json())
  const normal = log.data.map((e) => ({
    metodo: e.metodo, ruta: e.ruta, http: e.http,
    cuerpo: e.cuerpo && typeof e.cuerpo.date === 'string' ? { ...e.cuerpo, date: e.cuerpo.date.slice(0, 10) } : e.cuerpo,
  }))
  const texto = JSON.stringify(normal)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  const sha = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  await fetch('/api/__mock/captura', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave, lado, sha, largo: texto.length, texto }),
  })
  return normal
}
'ayudas instaladas'
```

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
cp "$S/ayudas.js" "$S/ayudas-check.mjs" && node --check "$S/ayudas-check.mjs" && echo "sintaxis ok"; rm -f "$S/ayudas-check.mjs"
```

Expected: `sintaxis ok`.

- **How to install them.** Read `$S/ayudas.js` and paste its whole text as the `text` of one
  `mcp__Claude_Browser__javascript_tool` call; the last expression returns `'ayudas instaladas'`.
- **Reinstall them after every full page load.** That means `navigate`, `location.reload()`, a viewport preset change
  followed by a reload, and "Recargar". Navigation inside the app (sidebar, buttons) keeps them.

- [ ] **Step 8: Build the base snapshot for the Gratex comparison**

```bash
S=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock
cd C:/Users/Signos/Documents/edwin/fiscalo
BASE=$(git merge-base main HEAD); echo "base=$BASE"
mkdir -p "$S/fiscalo-base"
git archive --format=tar "$BASE" | tar -x -C "$S/fiscalo-base"
ls "$S/fiscalo-base"
git status --short
```

Then link the dependencies with PowerShell (a junction, so no copy and no admin rights):

```powershell
$S = 'C:\Users\Signos\AppData\Local\Temp\claude\C--Users-Signos-Documents-edwin-fiscalo\e0ceea13-cf38-42da-855e-76dc67dbf4f4\scratchpad\mock'
New-Item -ItemType Junction -Path "$S\fiscalo-base\node_modules" -Target 'C:\Users\Signos\Documents\edwin\fiscalo\node_modules' | Out-Null
(Get-Item "$S\fiscalo-base\node_modules").LinkType
```

Expected:
- `ls` shows `index.html`, `package.json`, `src`, `vite.config.ts`, etc.;
- `git status --short` prints nothing (`git archive` only reads);
- `Junction`.

**Never delete `$S/fiscalo-base` with `rm -rf` or `Remove-Item -Recurse` while the junction exists.** Both can follow it
and wipe the repo's `node_modules`. Step 28 removes the junction first, with `cmd /c rmdir`.

- [ ] **Step 9: Add the temporary launch entries**

Re-read `C:/Users/Signos/Documents/edwin/fiscalo/.claude/launch.json` (git-tracked, LF). Today it is 11 lines.

With the Edit tool, find (lines 8-10):

```json
      "port": 5174
    }
  ]
```

and replace it with:

```json
      "port": 5174
    },
    {
      "name": "t16-mock-api",
      "runtimeExecutable": "node",
      "runtimeArgs": ["C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock/mock-api.mjs", "--port=8791", "--datos=gratex", "--formato=gratex"],
      "port": 8791
    },
    {
      "name": "t16-fiscalo-mock",
      "runtimeExecutable": "node",
      "runtimeArgs": ["C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock/vite-mock.mjs", "--port=5175", "--api=http://127.0.0.1:8791"],
      "env": { "API_PROXY_TARGET": "http://127.0.0.1:8791", "API_KEY": "" },
      "port": 5175
    },
    {
      "name": "t16-fiscalo-base-mock",
      "runtimeExecutable": "node",
      "runtimeArgs": ["C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock/vite-mock.mjs", "--port=5176", "--dir=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock/fiscalo-base", "--cache=C:/Users/Signos/AppData/Local/Temp/claude/C--Users-Signos-Documents-edwin-fiscalo/e0ceea13-cf38-42da-855e-76dc67dbf4f4/scratchpad/mock/vite-cache-base", "--api=http://127.0.0.1:8791"],
      "env": { "API_PROXY_TARGET": "http://127.0.0.1:8791", "API_KEY": "" },
      "port": 5176
    }
  ]
```

Then:

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
node -e "const c=require('./.claude/launch.json');console.log(c.configurations.map(x=>x.name).join(', '))"
git diff --stat -- .claude/launch.json
```

Expected: `fiscalo-dev, t16-mock-api, t16-fiscalo-mock, t16-fiscalo-base-mock` and `1 file changed, 21 insertions(+), 1 deletion(-)`.

If a port is already taken (another session's server on 8791, 5175 or 5176), `--strictPort` and the mock refuse to
start. Pick free ports, and change them consistently in these three entries, in `--api=` and in the URLs below.

On the `env` blocks:
- The two vite entries carry `API_PROXY_TARGET=http://127.0.0.1:8791` and `API_KEY=''` as asked, but `vite-mock.mjs`
  sets both itself from `--api`. It never trusts the environment.
- If `preview_start` rejects the `env` key, delete the two `env` lines and retry. Nothing else changes.
- This file is shared: if another session added entries meanwhile, keep them.

- [ ] **Step 10: Start the mock and the BASE app, prove the proxy, seed the session**

1. `mcp__Claude_Browser__preview_start` with `name: "t16-mock-api"` → note its serverId as MOCK_ID. The pane opens
   `http://localhost:8791`, the mock's page: "Mock API de fiscalo (no es la app) · Puerto 8791 · datos gratex · formato
   gratex".
2. `preview_start` with `name: "t16-fiscalo-base-mock"` → BASE_ID. The pane opens `http://localhost:5176` on the login
   screen, because there's no session on that origin yet.
3. `preview_logs` BASE_ID:
   - expected: a line `[vite-mock] raíz …\scratchpad\mock\fiscalo-base · /api -> http://127.0.0.1:8791 · cacheDir …\vite-cache-base`;
   - and nothing that mentions `gratex.net`.
4. **Safety gate.** Run `javascript_tool` on the 5176 tab:
   ```js
   await fetch('/api/__mock/ping').then((r) => r.json())
   ```
   - Expected: `{"status":true,"data":{"mock":true,"puerto":8791,"datos":"gratex","formato":"gratex",…}}`.
   - Anything else, an HTML page, a 401 or a network error, means the proxy isn't on the mock. `preview_stop` BASE_ID
     immediately, and go back to Steps 6 and 9.
5. `mcp__Claude_Browser__resize_window` `{width: 1280, height: 900}`. The app switches to its mobile layout below
   ~1000 px.
6. Seed the fake session (the zustand persist shape of `src/stores/auth.ts`, key `fiscalo.auth`) with `javascript_tool`:
   ```js
   localStorage.setItem('fiscalo.auth', JSON.stringify({ state: { token: 'mock-token-t16', user: { id: 1, email: 'mock@fiscalo.test', username: 'mock', name: 'Usuario Mock', role: 'admin', permissions: ['*'] } }, version: 0 }))
   localStorage.setItem('fiscalo.view', 'cotizaciones')
   localStorage.setItem('fiscalo.theme', 'light')
   location.reload()
   'sesión sembrada'
   ```
   `localStorage` is per origin, so this never touches the session of the real dev server on 5174.
7. Wait about 3 s, install `$S/ayudas.js` (Step 7), then run:
   ```js
   await __esperar(() => __fila('XKD482')); ({ vista: localStorage.getItem('fiscalo.view'), empresa: document.querySelector('.co-switch .nm')?.innerText, usuario: document.querySelector('.navbar')?.innerText.includes('Usuario Mock') })
   ```
   Expected: `{ vista: 'cotizaciones', empresa: 'Gratex (mock)', usuario: true }`.
8. `preview_logs` MOCK_ID with `search: "GET /api/"`. Expected lines include:
   - `GET /api/auth/me -> 200`
   - `GET /api/branding -> 200`
   - `GET /api/emisor -> 200`
   - `GET /api/cotizaciones?page=1&pageSize=15 -> 200`

   This proves the app talks only to the mock. `App.tsx` calls `me()` at mount, and the mock answers with the seeded
   user.

- [ ] **Step 11: Gratex BEFORE: captures on the base snapshot (5176)**

Run each item with `javascript_tool` on the 5176 tab. Each `__huella(clave, 'base')` stores its fingerprint in the mock:
the `.content` HTML without React ids, its text and the field values. Also take a `computer` screenshot at each
capture, for the visual side by side in Step 12.

1. **List.**
   ```js
   await __esperar(() => __fila('PLM107') && __fila('XKD482')); ({ h: await __huella('lista', 'base'), thead: __texto('.content thead'), filas: __filas('.content tbody tr').map((f) => f.texto) })
   ```
   Expected:
   - `thead` = `CÓDIGO CLIENTE DESCRIPCIÓN FECHA TOTAL`;
   - two rows, PLM107 (HOSPITAL DOCENTE…, TARJETAS…, `30 sept … 2026`, 1,180.00, `PDF Facturar`) and XKD482
     (IMPRESOS DEL CARIBE, `28 sept … 2026`, 5,900.00, `PDF Facturar`).
2. **Edit XKD482.**
   ```js
   __fila('XKD482').click(); await __esperar(() => __filas().length === 2); await new Promise((r) => setTimeout(r, 800)); ({ h: await __huella('editar-XKD482', 'base'), filas: __filas().map((f) => f.valores) })
   ```
   Expected `filas`: `[["STICKER VINYL 2X2","200","15"],["BANNER 3X6 FULL COLOR","1","2900"]]`.
3. **Preview, then save a change.**
   ```js
   __clic('Vista previa'); await __esperar(() => __abiertos.length === 1); await __pdf()
   ```
   - Expected: `{ abiertos: 1, tipo: 'application/pdf', cabeza: '%PDF-1.4', … }`.
   - Then `find` "Cantidad de la línea 1" → `form_input` `250`.
   - Then:
     ```js
     __clic('Guardar cambios'); await __esperar(() => localStorage.getItem('fiscalo.view') === 'cotizaciones' && __fila('XKD482')); __toasts()
     ```
     Expected: it contains `Cotización XKD482 actualizada.`
4. **New Gratex quote.**
   ```js
   __clic('Nueva cotización'); await __esperar(() => document.querySelector('input[placeholder="Buscar cliente por nombre, RNC o correo…"]')); await new Promise((r) => setTimeout(r, 500)); await __huella('nueva', 'base')
   ```
   Then:
   - `find` "Buscar cliente por nombre" → `form_input` `impresos`;
   - `await __esperar(() => __opciones().length > 0); __elegir('IMPRESOS DEL CARIBE')`;
   - `__clic('Descripción')` (adds a free line);
   - `find` "Descripción de la línea 1" → `form_input` `PRUEBA BASE`; "Cantidad de la línea 1" → `2`; "Precio de la
     línea 1" → `100`;
   - then:
     ```js
     __clic('Vista previa'); await __esperar(() => __abiertos.length === 2); __clic('Crear cotización'); await __esperar(() => localStorage.getItem('fiscalo.view') === 'cotizaciones' && __fila('MCK101')); ({ toasts: __toasts(), escrituras: await __escrituras('escrituras', 'base'), h: await __huella('lista-despues', 'base') })
     ```
   Expected:
   - toasts include `Cotización MCK101 creada.`;
   - `escrituras` = 4 entries, all `http: 200`:
     1. POST `/api/cotizaciones/preview`, body `{client_id:3, items:[STICKER 200×15 subtotal 3000, BANNER 1×2900], total:5900}`;
     2. PUT `/api/cotizaciones`, `{id:3, client_id:3, items:[STICKER 250×15 subtotal 3750, BANNER …], total:6650, date:'<today>', user_id:1, sent_email:false}`;
     3. POST preview, `{client_id:3, items:[PRUEBA BASE 2×100 subtotal 200], total:200}`;
     4. POST `/api/cotizaciones`, the same plus `date`, `user_id:1`, `sent_email:false`.
5. **Blank Nueva factura** (navbar):
   ```js
   __clic('Nueva'); await __esperar(() => document.querySelector('[role="menu"]')); __clic('Factura'); await __esperar(() => document.querySelector('.fx-cond-item .switch')); await new Promise((r) => setTimeout(r, 800)); ({ switchOn: document.querySelector('.fx-cond-item .switch').classList.contains('on'), h: await __huella('factura-en-blanco', 'base') })
   ```
   Expected: `switchOn: false`.
6. **Gratex Facturar.**
   ```js
   __menu('Cotizaciones'); await __esperar(() => __fila('PLM107')); __clic('Facturar', __fila('PLM107')); await __esperar(() => __filas().length === 1 && __texto()?.includes('Convertida desde')); await new Promise((r) => setTimeout(r, 1000)); ({ switchOn: document.querySelector('.fx-cond-item .switch').classList.contains('on'), banner: [...document.querySelectorAll('.content span')].map((s) => s.innerText).find((t) => t.startsWith('Convertida desde')), filas: __filas().map((f) => f.valores), totales: __texto('.fx-cierre'), h: await __huella('factura-desde-PLM107', 'base') })
   ```
   Expected:
   - `switchOn: true`;
   - `banner: 'Convertida desde la cotización PLM107 · los precios ya traen ITBIS incluido'`;
   - the line `TARJETAS DE PRESENTACION (MILLAR)`, `1`, `1180`;
   - `totales` = `… Subtotal 1,000.00 ITBIS 180.00 TOTAL 1,180.00`.
7. `preview_stop` BASE_ID. Then reset the mock's data, which keeps the captures:
   `navigate` to `http://localhost:8791/__mock/reset?datos=gratex&formato=gratex`.
   - Expected JSON: `cotizaciones: ["3:XKD482:null","5:PLM107:null"]`, `escrituras: 0`.

- [ ] **Step 12: Gratex AFTER: the same captures on the branch (5175), then compare**

1. `preview_start` `t16-fiscalo-mock` → HEAD_ID.
2. Repeat Step 10 items 3-7 on `http://localhost:5175`:
   - the logs must show `/api -> http://127.0.0.1:8791` and no cacheDir;
   - the ping gate;
   - the viewport;
   - the seed;
   - the helpers.
3. Repeat Step 11 items 1-6 **verbatim**, with `'head'` instead of `'base'` in every `__huella` / `__escrituras` call.
   Use the same texts (`PRUEBA BASE`, `250`) so the bodies match. Take the same screenshots.
4. Compare:
   ```js
   await __mock('capturas')
   ```

Expected:

| clave | htmlIgual | textoIgual | Note |
|---|---|---|---|
| `lista` | true | true | Gratex columns and actions unchanged (T13). |
| `editar-XKD482` | true | true | `CotizacionEditor` mounts the untouched `CotizacionFormView` (T11). |
| `nueva` | true | true | Gratex tenant → Gratex form. |
| `escrituras` | true | true | The same 4 bodies: the Gratex request shapes don't change. |
| `lista-despues` | true | true | Same response handling, MCK101 at the top. |
| `factura-en-blanco` | true | true | A blank factura is unchanged (switch off, no banner). |
| `factura-desde-PLM107` | **may be false** | true | Deliberate: Task 14 wraps the banner in a `div.col` for the aviso lines. Text and switch are unchanged. |

For any other `false`:
- run `await __mock('capturas?clave=<clave>')`, which returns `textoBase` / `textoHead`, and diff them;
- compare the two screenshots;
- it's a regression unless it is one of the deliberate differences of spec 9.1.

Also check the cache is shared, so the Gratex form doesn't fetch its row twice:
- `preview_logs` MOCK_ID with `search: "cotizaciones?id=3"`;
- each run opened XKD482 once, so expect exactly one `GET /api/cotizaciones?id=3 -> 200` per run: two lines in total.

- [ ] **Step 13: Gratex on the branch: the deliberate differences and spec 9.1's factura checks**

On 5175, still with the Gratex dataset:

1. **No Facturar menu on Gratex rows:**
   ```js
   __menu('Cotizaciones'); await __esperar(() => __fila('XKD482')); ({ botones: [...__fila('XKD482').querySelectorAll('button')].map((b) => [b.innerText.trim(), b.title]) })
   ```
   Expected: `[["PDF",""],["Facturar","Convertir a factura e-CF"]]`.
2. **The PDF button:**
   ```js
   __clic('PDF', __fila('XKD482')); await __esperar(() => __abiertos.length > 0); await __pdf()
   ```
   Expected: `%PDF-1.4`, `application/pdf`.
3. **"Esta cotización ya no existe".** Delete PLM107 behind the list's back and open it. Its detail was never cached in
   this run.
   ```js
   const fila = __fila('PLM107'); await fetch('/api/cotizaciones', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 5 }) }); fila.click(); await __esperar(() => __texto()?.includes('ya no existe')); __texto()
   ```
   - Expected: `Esta cotización ya no existe` and a button `Ir a cotizaciones` (Task 11's `CotizacionEditor`).
   - Then `__clic('Ir a cotizaciones')`. Expected: the list (`localStorage.getItem('fiscalo.view') === 'cotizaciones'`).
   - Before this work, the base showed an empty sheet here (spec 9.1).
4. **Clean remount** (key `cotizacionId ?? 'nueva'`):
   - Open XKD482 (`__fila('XKD482').click()`, then wait for `__filas().length === 2`).
   - Then:
     ```js
     __clic('Nueva'); await __esperar(() => document.querySelector('[role="menu"]')); __clic('Cotización'); await __esperar(() => __filas().length === 0); ({ tieneCodigo: __texto().includes('XKD482'), filas: __filas().length, buscador: document.querySelector('input[placeholder="Buscar cliente por nombre, RNC o correo…"]')?.value, modal: !!document.querySelector('.modal') })
     ```
   - Expected: `{ tieneCodigo: false, filas: 0, buscador: '', modal: false }`. Nothing was edited, so there's no
     "¿Salir sin guardar?".
5. Step 12 already proved the factura checks: `factura-en-blanco` switch off, and Gratex Facturar with the switch on and
   the exact old banner. Confirm the Gratex conversion has no aviso lines either:
   ```js
   __menu('Cotizaciones'); await __esperar(() => __fila('XKD482')); __clic('Facturar', __fila('XKD482')); await __esperar(() => __texto()?.includes('Convertida desde')); await new Promise((r) => setTimeout(r, 1000)); document.querySelectorAll('.content span[style*="--warning"]').length
   ```
   - Expected: `0`. Client 3 has `descuento '0.00'`, and a Gratex row has `ajustes {}`.
   - Leave with `__menu('Cotizaciones')`. If "¿Salir sin guardar?" appears, `__clic('Salir sin guardar')`.
6. `read_console_messages` `{onlyErrors: true}` → expected `No console logs.`

- [ ] **Step 14: Ferretería: the list**

1. Switch the mock to the Ferretería tenant:
   - `await __mock('reset?datos=ferreteria&formato=ferreteria')`, then `location.reload()`;
   - wait 3 s, then reinstall the helpers.
2. Run:
   ```js
   await __esperar(() => __fila('COT-000012')); ({ empresa: document.querySelector('.co-switch .nm')?.innerText, thead: __texto('.content thead'), filas: __filas('.content tbody tr').map((f) => f.texto), titulos: ['COT-000013', 'COT-000012', 'QWE901'].map((c) => [c, [...__fila(c).querySelectorAll('button')].map((b) => b.title || b.innerText.trim())]) })
   ```
   Expected:
   - `empresa: 'Ferreherramientas Ventura'`;
   - `thead: 'NÚMERO CLIENTE FECHA TOTAL'`, with no DESCRIPCIÓN column;
   - rows in order COT-000013 (CONSTRUCTORA MOCK, `03 sept … 2026`, 9,746.80), COT-000012 (HOSPITAL…, `02 sept …`,
     19,350.42), QWE901 (HOSPITAL…, `30 ago …`, 236.00);
   - `titulos`: COT-000013 and COT-000012 → `["PDF","Convertir en factura"]`; QWE901 (formato NULL) →
     `["PDF","Convertir a factura e-CF"]`.
3. **The Facturar ▾ menu doesn't open the editor:**
   ```js
   __clic('Facturar', __fila('COT-000012')); await __esperar(() => document.querySelector('[role="menu"]')); ({ items: [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => e.innerText.trim()), vista: localStorage.getItem('fiscalo.view') })
   ```
   - Expected: `items: ["Factura electrónica (e-CF)","Factura simple"]` and `vista: 'cotizaciones'`.
   - Close it with `computer` `key` `Escape`.
4. **Keyboard** (H's Task 13 list):
   - Focus the trigger: `__fila('COT-000012').querySelector('button[title="Convertir en factura"]').focus()`.
   - `computer key Return`, then:
     ```js
     document.activeElement?.innerText.trim()
     ```
     Expected: `Factura electrónica (e-CF)`.
   - `computer key Down`, then the same read → `Factura simple`.
   - `computer key Escape`, then `document.activeElement?.title` → `Convertir en factura`, and no `[role="menu"]` is
     left.
5. **The row PDF:**
   ```js
   __clic('PDF', __fila('COT-000012')); await __esperar(() => __abiertos.length > 0); await __pdf()
   ```
   - Expected: `%PDF-1.4`.
   - `preview_logs` MOCK_ID `search: "/12/pdf"` → `GET /api/cotizaciones/12/pdf?format=base64 -> 200`.
6. **Search by number** (spec 6.3):
   - `find` "Buscar por código o cliente" → `form_input` `000013`;
   - `__clic('Buscar')`;
   - `await __esperar(() => __filas('.content tbody tr').length === 1); __filas('.content tbody tr')[0].texto` →
     contains `COT-000013`;
   - `__clic('Limpiar')`.

- [ ] **Step 15: Ferretería: loading and error states of the tenant formato**

1. **Branding slow.** Run `await __mock('estado?delay=4000')`, then `location.reload()`. About 1 s later (no helpers yet):
   ```js
   await new Promise((r) => setTimeout(r, 800)); ({ skel: document.querySelectorAll('.content .skel').length, thead: !!document.querySelector('.content thead') })
   ```
   - Expected: `skel > 0`, `thead: false`. The skeleton shows while branding is pending, never a flash of the other
     columns.
   - About 5 s later, `document.querySelector('.content thead')?.innerText.replace(/\s+/g, ' ')` =
     `NÚMERO CLIENTE FECHA TOTAL`. The helpers aren't installed yet after this reload.
2. **Branding fails.**
   - Run `await __mock('estado?delay=0&formato=error')`, `location.reload()`, wait 4 s (the `retry: 1` of the query
     client), reinstall the helpers.
   - Expected for the list: `thead` = `CÓDIGO CLIENTE DESCRIPCIÓN FECHA TOTAL` (the Gratex columns), not stuck loading.
     COT rows keep `Convertir en factura`, because row actions follow each row's formato.
   - Then:
     ```js
     __clic('Nueva cotización'); await __esperar(() => __texto()?.includes('No se pudo preparar la cotización'), 8000); __texto()
     ```
     Expected: the ErrorState with `Reintentar`, and no form mounted.
   - Then `await __mock('estado?formato=ferreteria')` and `__clic('Reintentar')`:
     ```js
     await __esperar(() => /Cotizaci[oó]n mercanc[ií]as/i.test(__texto())); __texto().slice(0, 300)
     ```
     Expected: the Ferretería form header (`Cotización mercancías`, `Se asigna al guardar`).
   - Leave: `__menu('Cotizaciones')`.
3. **Backend without the field.**
   - Run `await __mock('estado?formato=none')`, `location.reload()`, wait 3 s, reinstall the helpers.
   - Expected for the list: `thead` = `CÓDIGO CLIENTE DESCRIPCIÓN FECHA TOTAL`.
   - `__clic('Nueva cotización')` → the Gratex form: `__texto()` includes `Enviar por correo al guardar` and does **not**
     include `Cotización mercancías`. `formato` is `'gratex'` only because branding **loaded** without the key.
   - Leave with `__menu('Cotizaciones')`.
4. Restore: `await __mock('estado?formato=ferreteria')`, `location.reload()`, reinstall the helpers.

- [ ] **Step 16: Ferretería: open the seeded quotes (load, totals, retención, cargos group)**

1. **COT-000012.**
   ```js
   __fila('COT-000012').querySelector('td').click(); await __esperar(() => __filas().length === 4); await new Promise((r) => setTimeout(r, 800)); ({ logo: document.querySelector('.content img')?.src.slice(0, 26), cabecera: __texto().slice(0, 400), fecha: document.querySelector('.content input[type="date"]')?.value, filas: __filas().map((f) => f.valores.concat(f.texto)), totales: __texto('.fx-cierre') })
   ```
   Expected:
   - **Header:** `logo: 'data:image/svg+xml;base64,'` (`branding.logo_data_uri`), and `cabecera` has `Cotización
     mercancías`, number `COT-000012`, and client `HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO` with its RNC
     (`401515131`, or formatted `401-51513-1`).
   - **Date:** `fecha: '2026-09-02'`.
   - **4 lines:**
     - GALONES… `7`, Unidad, `2000`, 18%, 14,000.00;
     - INSTALACION… `1`, Unidad, `1000`, 16%, 1,000.00;
     - CORTE DE TUBO `2.5`, Metro, `13.7`, 18%, 34.25;
     - ARENA LAVADA (EXENTO) `3`, Unidad, `10`, Exento, 30.00.
   - **Totals** (`totales`, the `.fx-cierre` text): Sub-total 15,064.25 · ITBIS (label `ITBIS`, mixed rates) 2,686.17 ·
     Total RD$ 19,350.42 · Retención Renta por Tercero 5% −753.21 · Abono realizado −1,000.00 · Restante (Adeudado)
     17,597.21. The screen and the stored TOTAL agree. Cargos bancarios 100.00 and Costo mano de obra 1,500.00 are in
     their input fields (next item), so they don't appear in that text.
   - **"Cargos y abonos":** the group is **open**, because it has values.
     - `__casilla('Retención')` → `true`: `ajustes.retencion_isr` is `'753.21'`, and `aNumero > 0`.
     - Cargos bancarios 100, Costo mano de obra 1500 and Abono 1000 are in their fields.
2. Leave with `__menu('Cotizaciones')`. Nothing changed, so no prompt.
3. **COT-000013.**
   - Open it the same way, then wait for `__filas().length === 5`.
   - **Totals:** Sub-total 8,260.00 · **`ITBIS 18%`** 1,486.80 · Total RD$ 9,746.80. There is **no** Restante line.
   - **"Cargos y abonos" is closed:** no values, only the `+ Cargos y abonos` button. Open it with
     `__clic('+ Cargos y abonos')`, then `__casilla('Retención')` → `false`.
   - **Units:** line 3 FUNDA CEMENTO GRIS is linked to product 60, unit Saco; line 5 LIBRAS CEMENTO BLANCO is in Libra.
   - Leave with `__menu('Cotizaciones')`.

- [ ] **Step 17: Ferretería: new quote, part 1 (client, product lines, free line, units, totals)**

1. Run:
   ```js
   __clic('Nueva cotización'); await __esperar(() => /Cotizaci[oó]n mercanc[ií]as/i.test(__texto() ?? '')); ({ texto: __texto().slice(0, 300), fecha: document.querySelector('.content input[type="date"]')?.value })
   ```
   - Expected: the header with the emisor (`Ferreherramientas Ventura` or `FERREHERRAMIENTAS VENTURA, SRL`), `RNC
     132615123` (or `132-61512-3`) and `Se asigna al guardar`.
   - Expected: `fecha` is today (`2026-10-02` on the day this plan was written; use `hoyLocal()`).
2. **Client.**
   - `find` "Buscar cliente por nombre" → `form_input` `hospital`;
   - `await __esperar(() => __opciones().length > 0); __elegir('HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO')`.
   - Expected: the client's name, with `401515131` (or its formatted form) under it.
3. **Product search shows the sale price** (`mostrarPrecio`):
   - `find` "Agregar del catálogo" (the catalog box's placeholder in Task 12) → `form_input` `pintura`;
   - `await __esperar(() => __opciones().length > 0); __opciones()`.
   - Expected: one option with `GALONES DE PINTURA BLNACA SEMIGLOSS`, showing **`Precio 2,000.00`**, and **not**
     `Costo 1,500.00`.
   - Every later "Search `…`" in this step types into that same `Agregar del catálogo` box.
   - Then `__elegir('GALONES DE PINTURA BLNACA SEMIGLOSS')`.
4. **Line 1 is filled from the product.**
   - `__filas()[0]` → description `GALONES DE PINTURA BLNACA SEMIGLOSS`, unit `Unidad`, price `2000` (no ITBIS), ITBIS
     18%, quantity `1`.
   - Set the quantity: `find` "Cantidad" (line 1) → `form_input` `7` → Valor total 14,000.00.
5. **Line 2, a service at 16%.**
   - Search `instalacion` → `__elegir('INSTALACION DE LAVAMANOS')`.
   - Expected: price `1000`, ITBIS 16%, Servicio. The quantity stays `1`.
6. **Line 3, a free line.**
   - `__clic('Línea libre')`.
   - Expected: a new row with no product, ITBIS 18%, unit Unidad (43), Bien.
   - `form_input`: Descripción `CORTE DE TUBO`, Cantidad `1`, Precio `150`.
7. **Line 4, decimals allowed by the unit.**
   - Search `cable` → `__elegir('CABLE ELECTRICO #12')`.
   - Expected: unit `Metro`, price `45.5`.
   - Quantity `2.5` → Valor total 113.75, with no quantity error.
8. **Decimals refused by the unit.**
   - Set line 1's quantity to `2.5`, then `__clic('Crear cotización')` (Task 12's schema validates on save).
   - Expected: the toast `Revisa 1 campo de la cotización.` and, under line 1's quantity, the unit's error from
     `problemaCantidad` ("Unidad" can't take fractions; the text comes from `components/unidadesMedida`). Nothing is
     sent: `(await __ultimas(5)).length` → `0`.
   - Set it back to `7`. The error goes away (editing a line clears its errors).
9. **Totals with no extras:**
   ```js
   __texto('.fx-cierre') ?? __texto()
   ```
   Expected: Sub-total 15,263.75 · ITBIS (label exactly `ITBIS`, not `ITBIS 18%`, because one line is at 16%) 2,727.48 ·
   Total RD$ 17,991.23. There is **no** Restante line.
10. **Rounding edge** (spec 6.2):
    - Search `redondeo` → `__elegir('PRUEBA REDONDEO')`, quantity 1.
    - Expected: Sub-total 15,348.50 · ITBIS 2,742.74 (+15.26 for 84.75 × 18%) · Total RD$ 18,091.24.
    - Remove that line with its delete control.
    - Expected: back to 15,263.75 / 2,727.48 / 17,991.23.
11. Run `(await __ultimas(5)).length` → `0`. Nothing was sent yet; product search is a GET.

- [ ] **Step 18: Ferretería: new quote, part 2 (Cargos y abonos, retención, abono rule)**

1. Open the group: `__clic('+ Cargos y abonos')` (Task 12's opener button).
   - Expected: the heading `Cargos y abonos`, the fields Cargos bancarios, Manejos de operaciones bancarias, Costo mano
     de obra, Abono realizado, and the box `Retención Renta 5%`. All amounts are 0 and the box is unchecked.
2. **Costo mano de obra.** `find` "Costo mano de obra" → `form_input` `1500`.
   - Expected: Total RD$ 19,491.23. Restante is still hidden.
3. **Retención.** `__casilla('Retención', true)` → `true`.
   - Expected: a `Retención Renta por Tercero 5%` line of −763.19, and **Restante (Adeudado) 18,728.04** appears (spec
     6.2: shown when retención > 0).
4. **Abono too big.** `find` "Abono realizado" → `form_input` `20000`. Then `__clic('Crear cotización')`.
   - Expected: the error `El abono (RD$ 20,000.00) no puede ser mayor que lo adeudado (RD$ 18,728.04).` next to the abono,
     and the toast `Revisa 1 campo de la cotización.`
   - Expected: `(await __ultimas(5)).length` is still `0`. Nothing is sent when the form is invalid.
5. **Abono allowed.** Abono `5000`.
   - Expected: the error goes away (any change in the group clears it). Restante (Adeudado) 13,728.04, Total RD$
     19,491.23 unchanged, Retención −763.19.
6. **The negative and 3-decimal guards** (Task 12's schema validates on save, so click save after each value):
   - Cargos bancarios `-5`, then `__clic('Crear cotización')` → the field error
     `El monto de «Cargos bancarios» no puede ser negativo.`;
   - Cargos bancarios `1.555`, then `__clic('Crear cotización')` → `El monto de «Cargos bancarios» admite hasta 2 decimales.`;
   - `(await __ultimas(5)).length` is still `0`;
   - then set it back to `0`.

- [ ] **Step 19: Ferretería: Vista previa and Guardar (the POST body)**

1. **Vista previa** (the form shows no id yet):
   ```js
   __clic('Vista previa'); await __esperar(() => __abiertos.length > 0); ({ pdf: await __pdf(), cuerpo: (await __ultimas(1))[0] })
   ```
   Expected:
   - `pdf.cabeza: '%PDF-1.4'`;
   - `cuerpo.ruta: '/api/cotizaciones/preview'` and `http: 200`;
   - `cuerpo.cuerpo`:
     - `formato: 'ferreteria'`, `client_id: 7`, **no `id`**, no `total`. `date` may be present; it isn't checked for a
       preview;
     - `ajustes: {cargos_bancarios:0, manejo_bancario:0, mano_obra:1500, abono:5000, retencion_isr:true}`;
     - `items` exactly:
       ```json
       [{"product_id":55,"description":"GALONES DE PINTURA BLNACA SEMIGLOSS","quantity":7,"amount":2000,"unidad_medida":"43","indicador_facturacion":1,"indicador_bien_servicio":1},
        {"product_id":56,"description":"INSTALACION DE LAVAMANOS","quantity":1,"amount":1000,"unidad_medida":"43","indicador_facturacion":2,"indicador_bien_servicio":2},
        {"product_id":null,"description":"CORTE DE TUBO","quantity":1,"amount":150,"unidad_medida":"43","indicador_facturacion":1,"indicador_bien_servicio":1},
        {"product_id":59,"description":"CABLE ELECTRICO #12","quantity":2.5,"amount":45.5,"unidad_medida":"26","indicador_facturacion":1,"indicador_bien_servicio":1}]
       ```
2. **Guardar:**
   ```js
   __clic('Crear cotización'); await __esperar(() => __toasts().some((t) => t.includes('COT-000014')), 8000); ({ toasts: __toasts(), cuerpo: (await __ultimas(1))[0], vista: localStorage.getItem('fiscalo.view') })
   ```
   Expected:
   - **The POST:** `cuerpo.ruta: '/api/cotizaciones'`, `metodo: 'POST'`, `http: 200`.
     - The body is the preview's plus **`date` = today with the current time**, matching
       `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` (spec 8.1: `` `${fecha} ${hora}` ``).
     - No `user_id`, `sent_email` or `total`.
   - **The response:** `{id:14, code:'COT-000014', numero:14, total:null}` (the mock's numbering).
   - **The toast** names `COT-000014`.
   - **The view.** Task 12 either goes back to the list, as the Gratex form does, or stays on the saved quote. Either is
     fine if the code shown is `COT-000014`.
3. **The list.** Use `__menu('Cotizaciones')` if needed. The top row is COT-000014, today's date, the HOSPITAL… client,
   and Total **0.00**. The 0.00 is a mock artifact: the mock stores `total: null`, while the real server stores
   19,491.23. Each row keeps Facturar ▾.

- [ ] **Step 20: Ferretería: edit COT-000014 (number and date kept, retención restored, PUT bodies)**

1. From the list (`__menu('Cotizaciones')` first if Task 12 stayed on the form), run:
   ```js
   __fila('COT-000014').querySelector('td').click(); await __esperar(() => __filas().length === 4); await new Promise((r) => setTimeout(r, 800)); ({ texto: __texto().slice(0, 300), fecha: document.querySelector('.content input[type="date"]')?.value, retencion: __casilla('Retención'), totales: __texto('.fx-cierre') })
   ```
   Expected:
   - number `COT-000014`; `fecha` is today;
   - `retencion: true`: the stored marker `'0.01'` is > 0, and the form always sends a boolean;
   - the group is open, with Costo mano de obra 1500 and Abono 5000;
   - totals recomputed: 15,263.75 / 2,727.48 / 19,491.23, Retención 763.19, Restante 13,728.04.
2. **Vista previa sends `id`.** `__clic('Vista previa')`, then `(await __ultimas(1))[0].cuerpo.id` → `14`. The preview
   resolves to the row's formato.
3. **Save without touching the day.**
   - Change line 4's quantity from `2.5` to `3`, then `__clic('Guardar cambios')`.
   - `(await __ultimas(1))[0]` → `metodo: 'PUT'`, `http: 200`, `cuerpo.id: 14`, `cuerpo.formato: 'ferreteria'`, and
     **no `date` key**: `'date' in cuerpo` is false, so the stored datetime is kept.
   - `cuerpo.items[3].quantity` is `3`, and the response keeps `code: 'COT-000014'`, `numero: 14`.
4. **Save after changing the day.**
   - Open COT-000014 again. `find` the date input → `form_input` with the day before today (`2026-10-01` if today is
     2026-10-02). Then `__clic('Guardar cambios')`.
   - `(await __ultimas(1))[0].cuerpo.date` → that day plus ` HH:MM:SS`, with the current time.
   - The list then shows COT-000014 with that day, and the same code.
   - `(await fetch('/api/cotizaciones?id=14').then((r) => r.json())).data[0]` → `numero: 14`, `code: 'COT-000014'`, and
     the date starts with that day.
5. **The PUT replaces the ajustes.**
   - Open it again. Uncheck Retención (`__casilla('Retención', true)` → `false`), set Abono `0`, then `__clic('Guardar cambios')`.
   - `(await __ultimas(1))[0].cuerpo.ajustes` → `{cargos_bancarios:0, manejo_bancario:0, mano_obra:1500, abono:0, retencion_isr:false}`.
   - Opening it again shows the box unchecked and no Restante line. The totals with line 4 at 3 are Sub-total
     15,286.50, ITBIS 2,731.57 and Total RD$ 19,518.07, mano de obra included.
6. **Back to the state Steps 21-22 expect.**
   - With COT-000014 still open from item 5's check: line 4's quantity `2.5`, Retención checked
     (`__casilla('Retención', true)` → `true`), Abono `5000`, then `__clic('Guardar cambios')`.
   - `(await __ultimas(1))[0].cuerpo` → `items[3].quantity: 2.5`, and `ajustes` with `mano_obra:1500, abono:5000, retencion_isr:true`.
   - On screen, after reopening: 15,263.75 / 2,727.48 / 19,491.23, Retención 763.19, Restante 13,728.04.

- [ ] **Step 21: Ferretería: Facturar to e-CF (precioConItbis off, product links, avisos, discount line)**

1. **COT-000014, client 7 with 0% discount.**
   ```js
   __menu('Cotizaciones'); await __esperar(() => __fila('COT-000014')); __clic('Facturar', __fila('COT-000014')); await __esperar(() => document.querySelector('[role="menu"]')); __clic('Factura electrónica (e-CF)'); await __esperar(() => __filas().length === 4 && __texto()?.includes('Convertida desde')); await new Promise((r) => setTimeout(r, 1200)); ({ switchOn: document.querySelector('.fx-cond-item .switch').classList.contains('on'), banner: [...document.querySelectorAll('.content span')].map((s) => s.innerText.trim()).filter((t) => t.startsWith('Convertida desde') || t.startsWith('La cotización') || t.startsWith('Se aplicó')), filas: __filas().map((f) => f.valores.concat(f.texto)), totales: __texto('.fx-cierre') })
   ```
   Expected:
   - `switchOn: false`;
   - `banner`:
     ```
     Convertida desde la cotización COT-000014 · los precios no incluyen ITBIS (se suma encima)
     La cotización COT-000014 tenía cargos adicionales: Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.
     ```
     No `Se aplicó…` line: client 7 has no discount.
   - **4 lines:**
     - GALONES… `7`, Unidad, `2000`, ITBIS 18%, with the `Bien` chip;
     - INSTALACION… `1`, Unidad, `1000`, 16%, `Servicio`;
     - CORTE DE TUBO `1`, Unidad, `150`, 18%, **`Guardar como producto`** (free line);
     - CABLE ELECTRICO #12 `2.5`, Metro, `45.5`, 18%, `Bien`.
     - Desc% 0 on all of them.
   - `totales`: Subtotal 15,263.75, ITBIS 2,727.48, TOTAL 17,991.23. These are the quote's Sub-total and ITBIS without
     the 1,500.00 of mano de obra, which wasn't copied.
2. **Vista previa** (never Emitir):
   ```js
   __clic('Vista previa'); await __esperar(() => __abiertos.length > 0); ({ pdf: (await __pdf())?.cabeza, items: (await __ultimas(1))[0].cuerpo.items.map((i) => [i.product_id ?? '-', i.nombre_item, i.cantidad, i.unidad_medida, i.precio_unitario, i.indicador_facturacion, i.indicador_bien_servicio]) })
   ```
   Expected:
   - `pdf: '%PDF-1.4'`;
   - `items`:
     ```
     [55, GALONES…, 7, '43', 2000, 1, 1]
     [56, INSTALACION…, 1, '43', 1000, 2, 2]
     ['-', CORTE DE TUBO, 1, '43', 150, 1, 1]
     [59, CABLE ELECTRICO #12, 2.5, '26', 45.5, 1, 1]
     ```
     Prices go without ITBIS because the switch is off, and the products are linked, so inventory moves on emit.
   - Don't click `Emitir e-CF`. If it is ever clicked, the mock answers 422 `MOCK: emitir e-CF está deshabilitado…`
     and nothing is emitted.
3. **COT-000013, client 8 with a 10% discount and no credit.**
   - Leave the form (`__menu('Cotizaciones')`, then `__clic('Salir sin guardar')` if asked), and convert COT-000013 to
     e-CF the same way.
   - Wait for `__filas().length === 5` and for the client to load: Desc% at 10.
   - Expected:
     - `banner`:
       ```
       Convertida desde la cotización COT-000013 · los precios no incluyen ITBIS (se suma encima)
       Se aplicó el descuento fijo del cliente (10%): el total difiere del de la cotización.
       ```
       No cargos aviso: `ajustes {}`.
     - Desc% `10` on all 5 lines.
     - Units Unidad / Unidad / Saco / Unidad / Libra. Line 3 is linked; the others are free.
     - `totales`: Subtotal 7,434.00, ITBIS 1,338.12, TOTAL 8,772.12.
     - The Pago block shows `Este cliente no tiene crédito habilitado`, and the method is Efectivo.
4. **Picking another client.** In the client box, pick HOSPITAL… (`find` its search box → `form_input` `hospital` →
   `__elegir(…)`).
   - Expected: the `Se aplicó…` line disappears, and Desc% goes back to 0. Totals: 8,260.00 / 1,486.80 / 9,746.80.

- [ ] **Step 22: Ferretería: Facturar to factura simple (ITBIS-included prices, banner, save)**

1. **COT-000014.** Leave (confirm "Salir sin guardar" if asked).
   ```js
   __menu('Cotizaciones'); await __esperar(() => __fila('COT-000014')); __clic('Facturar', __fila('COT-000014')); await __esperar(() => document.querySelector('[role="menu"]')); __clic('Factura simple'); await __esperar(() => __filas().length === 4 && __texto()?.includes('Convertida desde')); await new Promise((r) => setTimeout(r, 1200)); ({ vista: localStorage.getItem('fiscalo.view'), banner: [...document.querySelectorAll('.content span')].map((s) => s.innerText.trim()).filter((t) => t.startsWith('Convertida desde') || t.startsWith('La cotización') || t.startsWith('Se aplicó')), filas: __filas().map((f) => f.valores.concat(f.texto)), totales: __texto('.fx-totales-box'), marcas: document.querySelectorAll('.content .fx-mod').length, barra: __texto('.fx-bar') })
   ```
   Expected:
   - `vista: 'factura-simple-nueva'`;
   - `banner`: `Convertida desde la cotización COT-000014 · cada precio ya incluye su ITBIS`, then the same mano de obra
     aviso;
   - the lines, with no empty one at the end:
     - GALONES… `7` × `2360`, Importe 16,520.00;
     - INSTALACION… `1` × `1160`, 1,160.00;
     - CORTE DE TUBO `1` × `177`, 177.00;
     - CABLE ELECTRICO #12 `2.5` × `53.69`, 134.23.
   - `totales`: Subtotal = TOTAL = 17,991.23, the same as the e-CF total of Step 21. The customer pays the quoted
     Sub-total + ITBIS (spec 8.3).
   - `marcas: 0`, and the bar doesn't say "Cambios sin guardar".
2. **Leaving asks first.** `__menu('Cotizaciones')` → the `¿Salir sin guardar?` modal appears. `__clic('Seguir editando')`.
3. **Solo guardar.** The menu trigger is an icon-only button, so `__clic` (which matches text) can't find it:
   ```js
   document.querySelector('button[aria-label="Otras formas de guardar"]').click(); await __esperar(() => document.querySelector('[role="menu"]')); __clic('Solo guardar'); await __esperar(() => localStorage.getItem('fiscalo.view') === 'facturas-simples'); ({ toasts: __toasts(), cuerpo: (await __ultimas(1))[0].cuerpo })
   ```
   Expected:
   - the toast `Factura simple FS-000901 creada.`;
   - `cuerpo`: `client_id: 7`, `tipo_pago: 1`, `date` = today;
   - `items`:
     ```
     {product_id:55, description:'GALONES…', quantity:7, amount:2360, unidad_medida:'43'}
     {product_id:56, …, quantity:1, amount:1160, unidad_medida:'43'}
     {description:'CORTE DE TUBO', quantity:1, amount:177, unidad_medida:'43'}   (no product_id)
     {product_id:59, …, quantity:2.5, amount:53.69, unidad_medida:'26'}
     ```
     There is no `descuento_monto`, or it is 0.
   - The facturas-simples list shows FS-000901 (Total 0.00, a mock artifact) and FS-000900.
4. **COT-000013 → Factura simple** (client 8):
   - The 5 prices are 1,947.00 / 737.50 / 1,132.80 / 354.00 / 118.00.
   - Once the client loads, Desc.% is 10 everywhere. The importes are 5,256.90 / 1,327.50 / 1,019.52 / 637.20 / 531.00,
     and the TOTAL is 8,772.12.
   - The banner gets `Se aplicó el descuento fijo del cliente (10%): el total difiere del de la cotización.`
   - In Pago, `Credito 30 dias` is disabled and the method is Efectivo.
   - Leave with "Salir sin guardar".
5. **Unchanged factura simple paths:**
   - From the facturas-simples list, `__clic('Nueva factura simple')`. Expected: one empty line, no banner, and the back
     button where it was.
   - Then open FS-000900. Expected: no banner, line `TUBO PVC DE 2 SEMIPRESION 1 × 725`, and editing a field marks it
     (`fx-mod`). Leave without saving.
6. **Reload drops the payload.**
   - Convert COT-000012 → Factura simple, then `location.reload()`. Confirm the browser's leave prompt if one appears,
     or use `navigate` with `force: true`.
   - Expected after the reload: a blank **Nueva factura simple**, with one empty line and no banner, and never the
     prefilled lines. `factura-simple-nueva` isn't in `VIEW_SIN_PAYLOAD`, so the view comes back without its payload.
   - Reinstall the helpers.

- [ ] **Step 23: Ferretería: Facturar ▾ follows the role's views**

For each value below, run:
1. `await __mock('estado?permisos=<valor>')`;
2. `location.reload()`, then wait 3 s: `App.tsx` calls `me()` at mount and stores the new permissions;
3. reinstall the helpers;
4. then:
   ```js
   await __esperar(() => __fila('COT-000012')); const t = __fila('COT-000012').querySelector('button[title="Convertir en factura"]'); if (t) { t.click(); await __esperar(() => document.querySelector('[role="menu"]')) } ({ trigger: !!t, items: [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => e.innerText.trim()), gratex: !!__fila('QWE901').querySelector('button[title="Convertir a factura e-CF"]') })
   ```
5. close any open menu with `computer key Escape`.

| `permisos=` | Expected |
|---|---|
| `cotizaciones,facturas` | `trigger: true`, `items: ["Factura electrónica (e-CF)"]`, `gratex: true` |
| `cotizaciones,facturas-simples` | `trigger: true`, `items: ["Factura simple"]`, `gratex: true` |
| `cotizaciones` | `trigger: false`, `items: []` (only PDF on COT rows), `gratex: true` (the Gratex button stays ungated, as today) |
| `ausente` (no `permissions` key, fail-open) | both items |
| `*` | both items; leave it here |

- [ ] **Step 24: The 409 mismatch, a Gratex row inside the Ferretería tenant, and Eliminar**

1. **Natural 409** (ops switched the formato while the tab was open).
   - Run `__clic('Nueva cotización')`, then pick client HOSPITAL…, `__clic('Línea libre')`, and set the description
     `PRUEBA 409`, quantity 1, price 10.
   - Then `await __mock('estado?formato=gratex')`. The open form stays Ferretería: the editor fixed its formato.
   - Then (Task 12 replaces Vista previa and the save button with the message and `Recargar` after the first 409, so
     the POST goes first here and the preview 409 is checked in item 3):
     ```js
     __clic('Crear cotización'); await __esperar(() => __texto('.fx-bar')?.includes('está desactualizada')); ({ post: [(await __ultimas(1))[0].ruta, (await __ultimas(1))[0].http], mensaje: __texto('.fx-bar')?.match(/La pantalla de cotizaciones[^.]*\.[^.]*\./)?.[0], barra: [...document.querySelectorAll('.fx-bar button')].map((b) => b.innerText.trim()), filas: (await __mock('ping')).cotizaciones })
     ```
   Expected:
   - `post: ['/api/cotizaciones', 409]`;
   - `mensaje: 'La pantalla de cotizaciones está desactualizada (cambió el formato de tu empresa). Recarga la página.'`;
   - `barra: ['Recargar']` (spec 8.1): nothing can be saved from that screen any more;
   - `filas` without any new id: the mock saved nothing.
2. **Recargar.**
   - `__clic('Recargar')`.
   - If a "Leave site?" dialog blocks it, record it for Task 12 (Recargar should release `useAvisoSalida` first), and
     continue with `navigate` `{url: 'http://localhost:5175/', force: true}`.
   - After the reload (the tenant is gratex now): the list has the Gratex columns, and `__clic('Nueva cotización')`
     opens the Gratex form (`Enviar por correo al guardar`, no `Cotización mercancías`).
   - Then `await __mock('estado?formato=ferreteria')`, reload, and reinstall the helpers.
3. **Armed 409 on preview, then on PUT.**
   - Open COT-000014, run `await __mock('arm-409')`, then `__clic('Vista previa')`.
   - Expected: `(await __ultimas(1))[0]` → `POST /api/cotizaciones/preview`, `http: 409`; the bar shows the same message
     and only `Recargar` (`[...document.querySelectorAll('.fx-bar button')].map((b) => b.innerText.trim())` →
     `['Recargar']`); no PDF opened (`__abiertos` didn't grow).
   - `__clic('Recargar')`, wait 3 s and reinstall the helpers (the tenant is still ferreteria, so the list comes back
     with the Ferretería columns).
   - Open COT-000014 again, set line 1's quantity to `8`, run `await __mock('arm-409')`, then `__clic('Guardar cambios')`.
   - Expected: the same message and `Recargar`.
   - `(await __ultimas(1))[0]` → `PUT`, `http: 409`.
   - `(await fetch('/api/cotizaciones?id=14').then((r) => r.json())).data[0].items[0].quantity` → still `'7.000'`.
   - Leave without saving: `__menu('Cotizaciones')`, then `__clic('Salir sin guardar')` in the `¿Salir sin guardar?`
     modal.
4. **A Gratex-format row in the Ferretería tenant** (QWE901, formato NULL).
   - Run `__fila('QWE901').querySelector('td').click()`.
   - Expected: the **Gratex** form (`__texto()` includes `Enviar por correo al guardar` and not `Cotización
     mercancías`), with the line `TUBO PVC DE 2 SEMIPRESION 1 × 236`.
   - Set its quantity to 2, then `__clic('Guardar cambios')`.
   - Expected: the toast `Cotización QWE901 actualizada.`
   - `(await __ultimas(1))[0]` → `PUT`, `http: 200`, and a body **without** `formato`. The row's formato is gratex, so
     there's no 409.
5. **Eliminar with inline confirmation.**
   - Open COT-000014 and `__clic('Eliminar')`.
   - Expected: an inline confirmation in the page, `¿Eliminar esta cotización?` with `No` and `Sí, eliminar` (no browser
     `confirm()` dialog, no modal, as in the Gratex form). Confirm it with `__clic('Sí, eliminar')`.
   - Expected: `(await __ultimas(1))[0]` → `DELETE`, `cuerpo: {id: 14}`, `http: 200`, `respuesta.data: 'Cotization deleted'`.
   - Expected: the list without COT-000014, and the toast `Cotización COT-000014 eliminada.`
6. `read_console_messages` `{onlyErrors: true}` → `No console logs.` A 409 is an `ApiError`, not a console error.

- [ ] **Step 25: Mobile layout (375 px)**

Run `mcp__Claude_Browser__resize_window` `{preset: 'mobile'}`, then `location.reload()` (the device gates run at load),
wait 3 s, and reinstall the helpers. Take a `computer` screenshot (scale 0.5) of each screen.

1. **List.**
   ```js
   await __esperar(() => __fila('COT-000012')); ({ ...__sinScrollHorizontal(), tabla: (() => { const t = document.querySelector('.tbl-wrap'); return { client: t.clientWidth, scroll: t.scrollWidth, overflowX: getComputedStyle(t).overflowX } })() })
   ```
   - Expected: `ok: true` (the page width is 375), and the table scrolls inside its card (`scroll > client`,
     `overflowX: 'auto'`).
   - Then open Facturar ▾ on the **last** Ferretería row:
     ```js
     __clic('Facturar', __fila('COT-000012')); await __esperar(() => document.querySelector('[role="menu"]')); const r = document.querySelector('[role="menu"]').getBoundingClientRect(); ({ izq: r.left, der: r.right, arriba: r.top, abajo: r.bottom, ancho: innerWidth, alto: innerHeight })
     ```
     Expected: `izq >= 0`, `der <= ancho`, `arriba >= 0`, `abajo <= alto`. The menu stays inside the viewport. Then
     press `Escape`.
2. **New Ferretería form.** `__clic('Nueva cotización')`, wait for the header, then `__clic('Línea libre')`.
   - Expected: `__sinScrollHorizontal().ok === true`.
   - The line stacks as labeled cells (`data-label`). The totals panel and the action bar are reachable by scrolling;
     scroll with `computer scroll` and take screenshots.
   - Type a quantity with `form_input` and check that its Valor total updates.
   - Leave with "Salir sin guardar".
3. **COT-000012 open.** `ok: true`, all 4 lines readable, the totals panel complete. Leave.
4. **COT-000012 → e-CF.** Use `__clic('Facturar', __fila('COT-000012'))` then `__clic('Factura electrónica (e-CF)')`.
   - Expected: the banner and its aviso wrap next to or under the back button, and `__sinScrollHorizontal().ok === true`.
   - Leave with "Salir sin guardar".
5. **COT-000012 → Factura simple.** Same checks for its banner. Leave.
6. `mcp__Claude_Browser__resize_window` `{preset: 'desktop'}`.

- [ ] **Step 26: Console and mock-log review**

- `read_console_messages` `{onlyErrors: true, limit: 50}` → expected `No console logs.`
  - If there is an error, open it, reproduce the step that caused it, and treat it as a failed check.
  - `[API] respuesta que no es JSON` would mean an unmocked HTML page went through the proxy.
- `preview_logs` MOCK_ID `{search: 'SIN HANDLER'}` → expected nothing.
  - If a screen used an endpoint the mock answers only with the empty fallback, write it down.
  - If that endpoint mattered to a check, add a handler to `$S/mock-api.mjs` (plus an assertion in
    `$S/mock-selftest.mjs`) and repeat the check.
- `preview_logs` MOCK_ID `{search: 'ERROR'}` and `{level: 'error'}` → nothing.
- `preview_logs` MOCK_ID `{search: 'gratex.net'}` and `preview_logs` HEAD_ID `{search: 'gratex.net'}` → nothing.
  Nothing was proxied anywhere else.

- [ ] **Step 27: FE docs: the cotización body comes from the formato, not from the factura template**

Re-read `C:/Users/Signos/Documents/edwin/fiscalo/docs/plantillas-factura.md` (CRLF). Task 3 changed line 39 (the
`GET /api/branding` row) earlier in this branch. Leave that row exactly as it is.

The BE and FE chains run in parallel, so first confirm Task 3's fiscalo commit is already in (otherwise this task's
`git add` would sweep its uncommitted row into this commit):

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git log --oneline -1 -- docs/plantillas-factura.md
git status --short -- docs/plantillas-factura.md
grep -c "cotizacion_formato" docs/plantillas-factura.md
```

Expected: the log line is `docs(branding): GET /api/branding devuelve cotizacion_formato` (Task 3 Step 9), the status
is empty and the count is `1`. If the log shows an older commit or the status shows ` M`, Task 3 Step 9 hasn't landed:
wait for it, don't commit its row here.

**Edit 1: the intro, lines 3-5.** Find:

```
Cada tenant elige cómo se ve su factura PDF (y su cotización): una plantilla
predefinida + un color de acento + su logo. Para clientes que pidan un diseño
totalmente a la medida existe la vía `custom:*` (sección final).
```

and replace it with:

```
Cada tenant elige cómo se ve su factura PDF: una plantilla predefinida + un
color de acento + su logo. Para clientes que pidan un diseño totalmente a la
medida existe la vía `custom:*` (sección final). La cotización no sigue esta
plantilla: la arma el formato de cotización del tenant (sección
"Cotizaciones: las define el formato, no la plantilla").
```

**Edit 2: a new section before ``## Diseños a la medida (`custom:*`)`` (line 49).** Find:

```
### Diseños a la medida (`custom:*`)
```

and replace it with:

```
### Cotizaciones: las define el formato, no la plantilla

El cuerpo de la cotización (título, columnas, totales, pie) y su formulario los
define el **formato de cotización** del tenant: `master.tenants.cotizacion_formato`,
`gratex` por defecto y `ferreteria` para FERREHERRAMIENTAS VENTURA. La plantilla
de factura no cambia ese cuerpo:

- **`gratex`:** `CotizacionPdfGenerator.php`, como siempre. De la plantilla del
  tenant solo toma el membrete (`drawCompanyHeader(..., 'cotizacion')`).
- **`ferreteria`:** `FerreteriaCotizacionPdf.php`, con el formato de su hoja de
  Excel. Del branding usa solo el logo (`BrandingResolver::logoPath()`): cambiar
  `pdf_template` o `pdf_accent_color` no la cambia.
- Una cotización guardada conserva su formato (`cotizaciones.formato`; NULL =
  gratex) aunque el tenant cambie de formato después.
- **Frontend:** `src/features/cotizaciones/formatos/` (registro `FORMATOS`). Para
  una cotización nueva, `useCotizacionFormato()` lee `cotizacion_formato` de
  `GET /api/branding`; una guardada se abre con el formulario de su formato.
- **Se cambia solo por SQL** (no hay pantalla ni `PUT /api/branding` para esto):
  `UPDATE tenants SET cotizacion_formato = 'ferreteria' WHERE id = <id>;`
- Arquitectura y cómo agregar el formato de otro tenant:
  `api-gratex/docs/modules/cotizaciones-formatos.md`. Contrato del API:
  `api-gratex/docs/api/cotizaciones.md`.

### Diseños a la medida (`custom:*`)
```

**Edit 3: the `drawCompanyHeader` bullet.** It was lines 58-59 before Edit 2 and is about 24 lines lower after it. Find:

```
   - `drawCompanyHeader($pdf, $emisor, $logoPath, $variant)` — identidad del
     emisor (corre en cada página; `$variant` es `factura` o `cotizacion`).
```

and replace it with:

```
   - `drawCompanyHeader($pdf, $emisor, $logoPath, $variant)` — identidad del
     emisor (corre en cada página; `$variant` es `factura` o `cotizacion`; la
     variante `cotizacion` solo la usa el formato `gratex`).
```

Check and commit:

```bash
cd C:/Users/Signos/Documents/edwin/fiscalo
git diff --stat -- docs/plantillas-factura.md
git diff -- docs/plantillas-factura.md | grep -c "^-| GET | \`/api/branding\`"
file docs/plantillas-factura.md
git add docs/plantillas-factura.md
git commit -F - <<'EOF'
docs(plantillas): la cotizacion la define su formato, no la plantilla de factura

La plantilla de factura solo llega al membrete de la cotizacion de Gratex.
El cuerpo y el formulario los decide tenants.cotizacion_formato (gratex |
ferreteria) y una cotizacion guardada conserva el suyo. Se apunta a los
documentos del backend para agregar el formato de otro tenant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
git show --stat --oneline HEAD
```

Expected:
- `1 file changed, 30 insertions(+), 4 deletions(-)`: Edit 1 is −3 +5, Edit 2 is +23 and Edit 3 is −1 +2. A count off
  by one is fine if `git diff` shows only these three hunks.
- `0`: Task 3's `GET /api/branding` row isn't removed.
- `file` still says `with CRLF line terminators`.
- One commit touching only `docs/plantillas-factura.md`. If `.claude/launch.json` shows up as modified, that's expected
  at this point: it is never staged, and Step 28 reverts it.

- [ ] **Step 28: Teardown: stop the servers, remove the launch entries and the junction, confirm a clean tree**

1. `mcp__Claude_Browser__preview_stop` HEAD_ID and MOCK_ID (BASE_ID was stopped in Step 11). If the pane still has a
   viewport emulation, use `resize_window` `{preset: 'desktop'}`.
2. Re-read `.claude/launch.json`, then reverse Step 9's Edit:
   - `old_string` = Step 9's replacement block, from `      "port": 5174` through the `  ]` after `t16-fiscalo-base-mock`;
   - `new_string` = Step 9's original three lines:
     ```json
           "port": 5174
         }
       ]
     ```
   - If another session added its own entries in the meantime, remove only the three `t16-*` objects and keep theirs.
3. Remove the junction **first**, then the snapshot (PowerShell):
   ```powershell
   $S = 'C:\Users\Signos\AppData\Local\Temp\claude\C--Users-Signos-Documents-edwin-fiscalo\e0ceea13-cf38-42da-855e-76dc67dbf4f4\scratchpad\mock'
   if (Test-Path "$S\fiscalo-base\node_modules") { cmd /c rmdir "$S\fiscalo-base\node_modules" }
   "junction: $(Test-Path "$S\fiscalo-base\node_modules")"
   "node_modules del repo intacto: $(Test-Path 'C:\Users\Signos\Documents\edwin\fiscalo\node_modules\vite\package.json')"
   Remove-Item -Recurse -Force "$S\fiscalo-base", "$S\vite-cache-base"
   Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8791, 5175, 5176 } | Measure-Object | Select-Object -ExpandProperty Count
   ```
   Expected: `junction: False`, `node_modules del repo intacto: True`, then `0` listeners. `mock-api.mjs`,
   `mock-selftest.mjs`, `vite-mock.mjs` and `ayudas.js` stay in `$S` for reuse.
4. Run:
   ```bash
   cd C:/Users/Signos/Documents/edwin/fiscalo
   git diff --exit-code -- .claude/launch.json && echo "launch.json restaurado"
   git status --short
   git log --oneline -3
   BASE=$(git merge-base main HEAD); git diff --stat "$BASE" HEAD -- src/features/cotizaciones/CotizacionFormView.tsx
   cd C:/Users/Signos/Documents/edwin/api-gratex && git status --short
   ```
   Expected:
   - `launch.json restaurado`;
   - `git status --short` prints nothing in fiscalo: the only intended change, the docs, is committed;
   - the log shows the Step 27 commit on top, plus any `fix(...)` commits the checks forced;
   - the `CotizacionFormView.tsx` diff is empty;
   - api-gratex is untouched by this task (empty, or only the BE chain's own work).

---

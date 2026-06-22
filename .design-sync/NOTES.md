# design-sync notes — Fiscalo

Repo is a React+Vite **app** (not a standalone DS). Synced surface = the shared UI
primitives in `src/components/ui/`. claude.ai/design project: **Fiscalo Design System**
(`8c5e78b1-cd75-48c7-80bf-7326f65365fb`).

## ⚠️ Toolchain on this machine is hostile to Node — READ FIRST
Security/AV software on this box **deletes `node.exe` binaries shortly after they run.**
Observed every node we used (Codex-bundled node, `ms-playwright-go` node) execute once or
twice, then vanish (`Test-Path` → False); `C:\Program Files\nodejs` has npm but **no
node.exe** (so `npm` dies with "Could not determine Node.js install directory"); npm
package extraction leaves **empty/partial dirs** (playwright-core had no package.json).
There is **no stable `node`/`npm` on PATH** in the Bash or PowerShell tool.

Consequences for this run:
- The converter build + `tsc` declaration emit **did** complete (during brief working
  windows) — `ds-bundle/` is complete and final.
- The **render check never ran** (couldn't keep a working node + a playwright install
  alive). Uploaded without machine render verification; cards verified visually in
  claude.ai/design instead (user's choice).
- Could not rebuild to embed the conventions header, so it was **hand-prepended** to
  `ds-bundle/README.md` before upload (see below).

For a future sync: if node is needed, find a currently-live `node.exe`
(`Get-ChildItem $env:LOCALAPPDATA -Filter node.exe -Recurse -Depth 4`), use it by
**absolute path immediately**, and expect it to disappear — batch work into single calls.
A clean playwright install failed repeatedly; to run the render check, reuse an on-disk
`ms-playwright-go/<ver>/package` (it IS a complete `playwright-core`) via a junction into
`.ds-sync/node_modules/playwright` + `playwright-core`, and set
`DS_CHROMIUM_PATH` to system Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`,
v149 — newer than the pinned 143 but launches) so no 200 MB browser download is needed.

## Build setup
- **No dist library build.** Package shape bundles the UI barrel directly:
  `--entry ./src/components/ui/index.tsx` (the barrel `export *`s every primitive).
- **Prop extraction needs real `.d.ts`** (the converter reads `**/*.d.ts`, never `.tsx`).
  The app uses `tsc --noEmit`, so we emit declarations first via
  `cfg.buildCmd` = `npx tsc -p .design-sync/tsconfig.dts.json` → `dist/types/` (gitignored),
  which `findTypesRoot` picks up. Re-run this before the converter on every sync.
- `@/` alias (`@/* -> ./src/*`) via `cfg.tsconfig: tsconfig.json`. Four ui components import
  `@/lib/format` (pure util). Icons: `lucide-react`, bundled (no separate icon package).
- **`dts.mjs` fork** (`.design-sync/overrides/dts.mjs`, declared in `cfg.libOverrides`):
  allows the short all-caps acronym `KPI` past the all-caps-constant filter. Without it KPI
  is dropped (27 instead of 28).
- **`cfg.dtsPropsFor`** hand-writes props for 9 components whose props interface isn't named
  `<Name>Props` or is inline/anonymous: KPI (`KpiProps`), Checkbox (uses `SwitchProps`),
  EstadoBadge, LoadingState, Spinner (none), Donut, Progress, Sparkline, Image. Keep these
  in sync if those component signatures change.

## Styling
- Global-CSS DS (no CSS modules / CSS-in-JS). Look comes from `src/styles/styles.css`
  (tokens + components) + `src/styles/bold.css` (display typography, KPIs). Cascade order:
  styles.css first.
- `cfg.cssEntry` = `.design-sync/ds-styles.css`, a **derived concat** of styles.css + bold.css
  (the converter copies cssEntry verbatim into `_ds_bundle.css`; it does NOT follow `@import`).
- `responsive.css` (app-shell media queries) and `styles-v2.css` (unused alt theme w/ remote
  Newsreader font) are intentionally excluded.

## Fonts
- `--font-sans`/`--font-mono` are system stacks. `--font-display` = "Space Grotesk" but the
  app ships no `@font-face` for it → falls back to Helvetica Neue. Faithful = system fallback;
  no fonts shipped. (To honor brand intent, could add a Google Fonts `@import` for Space Grotesk.)

## Conventions header
- `.design-sync/conventions.md`, wired via `cfg.readmeHeader`. Names only verified utility
  classes/tokens/props. **This run hand-prepended it to `ds-bundle/README.md`** because a
  rebuild was impossible. When node works again, a normal rebuild will regenerate the README
  with the header and you can drop the manual step.

## Re-sync risks
- **Node may be unavailable** (see toolchain section) — the biggest risk; the whole pipeline
  needs node.
- **`.design-sync/ds-styles.css` is generated** — regenerate when source CSS changes:
  `cat src/styles/styles.css src/styles/bold.css > .design-sync/ds-styles.css`.
- **`_ds_sync.json` anchor was computed before the README hand-edit** → its `auxSha` won't
  match the uploaded README. Next sync will re-upload README + anchor once (harmless).
- **Render check is unverified** — previews are floor cards (unauthored). Authoring rich
  `.design-sync/previews/<Name>.tsx` is the standing follow-up once the toolchain cooperates.
- Component list is hand-pinned in `componentSrcMap`; new primitives in `src/components/ui/`
  won't sync until added there.

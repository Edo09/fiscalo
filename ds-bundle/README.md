# Fiscalo design system — how to build with it

Fiscalo is a Spanish-language electronic-invoicing UI (Dominican Republic e-CF / DGII).
Build screens in **Spanish**, format money as **RD$**, and keep the look clean and
dense (Linear/Vercel-style, blue accent). All 28 components are the real upstream code at
`window.Fiscalo.*`.

## Setup — no provider needed

There is **no context/provider wrapper**. Load the stylesheet + React once, then use the
components directly:

```html
<link rel="stylesheet" href="styles.css">  <!-- tokens + component + utility CSS -->
<script src="_ds_bundle.js"></script>        <!-- window.Fiscalo.* -->
```

- **Theme:** light by default. For dark mode set `data-theme="dark"` on a container element
  (the tokens cascade from there) — do not restyle components by hand.

## Styling idiom — two layers, don't invent classes

1. **Style components through their props, never by adding classes to them.** Each component
   carries its own internal classes. You change appearance with the documented props:
   `<Btn variant="primary" size="sm" icon="plus">`, `<Badge tone="success" dot>`,
   `<KPI money delta="+12%" deltaDir="up">`. Read each `components/general/<Name>/<Name>.d.ts`
   for the exact prop union types.

2. **For your own layout glue around components, use the DS's real utility classes** (these
   exist in `_ds_bundle.css` — use them instead of Tailwind or invented names):
   - Layout: `row`, `col`, `between` (space-between row), `wrap`
   - Grid: `grid-2`, `grid-3`
   - Spacing: `gap-sm|md|lg`, `mt-sm|md|lg`, `mb-sm|md|lg`
   - Text: `text-sm`, `text-xs`, `muted` (secondary text), `muted-3` (faint), `num` (tabular figures)
   - Page scaffold: `page`, `page-title`, `page-sub`, `page-actions`
   - Forms: `field`, `input`, `textarea`

3. **For anything custom, use the design tokens** (CSS custom properties, declared in
   `_ds_bundle.css`): color `var(--accent)`, `--surface`, `--surface-2`, `--text`, `--text-2`,
   `--text-3`, `--border`; semantic `--success`, `--warning`, `--danger`, `--info` (+ each
   `*-soft`); fonts `--font-sans`, `--font-mono`, `--font-display`; accent `--accent-hover`,
   `--accent-soft`. Never hardcode hex — reference the token.

## Where the truth lives

- `_ds_bundle.css` — the one compiled stylesheet: every token, component class, and utility.
  Read it before styling.
- `components/general/<Name>/<Name>.prompt.md` + `<Name>.d.ts` — per-component usage + API.

## Idiomatic example

```jsx
const { Card, KPI, Btn, Badge, Money } = window.Fiscalo;

<div className="page">
  <div className="row between mb-md">
    <h1 className="page-title">Facturas</h1>
    <Btn variant="primary" icon="plus">Nueva factura</Btn>
  </div>

  <div className="grid-3 gap-md mb-lg">
    <KPI label="Ventas del mes" value={1284500} money icon="trending-up" delta="+12%" deltaDir="up" />
    <KPI label="Por cobrar" value={342000} money icon="wallet" />
    <KPI label="e-CF emitidos" value={487} icon="file-text" />
  </div>

  <Card title="Últimas facturas" sub="Período actual">
    <div className="row between">
      <span>B0100000123 · Cliente Demo SRL</span>
      <Badge tone="success" dot>Pagada</Badge>
      <Money value={45200} />
    </div>
  </Card>
</div>
```

Icons are referenced by kebab name via the `Icon` component (`<Icon name="file-text" />`) or the
`icon=` prop on Btn/KPI/etc. — the set is Lucide (e.g. `plus`, `trending-up`, `wallet`,
`file-text`, `users`, `receipt`).

---

# Fiscalo (fiscalo@1.0.0)

This design system is the published fiscalo React library, bundled as a single
browser global. All 28 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.Fiscalo`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.Fiscalo.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Avatar } = window.Fiscalo;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Avatar />);
```

## Tokens

54 CSS custom properties from fiscalo. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (10): `--surface`, `--surface-2`, `--surface-hover`, …
- **typography** (3): `--font-sans`, `--font-mono`, `--font-display`
- **other** (41): `--accent`, `--accent-hover`, `--accent-active`, …

## Components

### general
- `Avatar`
- `Badge`
- `BarChart`
- `Btn`
- `Card`
- `Checkbox`
- `Donut`
- `Drawer`
- `Dropdown`
- `EmptyState`
- `ErrorState`
- `EstadoBadge`
- `Icon`
- `Image`
- `KPI`
- `LoadingState`
- `MenuItem`
- `Modal`
- `Money`
- `PageHead`
- `Pagination`
- `Progress`
- `RefreshButton`
- `Seg`
- `Sparkline`
- `Spinner`
- `Switch`
- `Tabs`

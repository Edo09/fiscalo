# Fiscalo — Facturación Electrónica RD

Prototipo de interfaz (UI/UX) de un sistema de facturación electrónica para
República Dominicana, con módulo de Comprobantes Fiscales Electrónicos (e-CF / DGII).

Construido con **React 18 + TypeScript + Vite** y **lucide-react** para los iconos.

## Requisitos

- Node.js 18 o superior

## Instalación y ejecución

```bash
npm install
npm run dev
```

Se abrirá en <http://localhost:5173>.

```bash
npm run build      # type-check (tsc -b) + build de producción a /dist
npm run typecheck  # solo verificación de tipos
npm run preview    # sirve el build localmente
npm run lint       # ESLint
```

## Estructura del proyecto

```
src/
  main.tsx                      # punto de entrada (monta <App/>, importa CSS)
  App.tsx                       # shell: sidebar, navbar, ruteo, tema claro/oscuro
  vite-env.d.ts
  app/
    navigation.ts               # NAV, títulos, tipos ViewId / Nav
  lib/
    format.ts                   # fmt, fmt0, colorFor
  components/
    ui/index.tsx                # primitivas: Icon, Btn, Card, KPI, Modal, Drawer…
    layout/
      Sidebar.tsx
      Navbar.tsx
      NotifPopover.tsx
      SearchPalette.tsx
  features/                     # una carpeta por dominio funcional
    dashboard/DashboardView.tsx
    invoices/                   # listado, detalle, formulario, recurrentes
    ecf/                        # dashboard e-CF, tipo e-CF, bandeja DGII
    clients/ · products/ · expenses/ · purchases/ · suppliers/
    reports/ · treasury/ · users/ · settings/ · notifications/
  data/
    mockData.ts                 # datos de ejemplo tipados (clientes, facturas…)
  types/
    domain.ts                   # tipos de dominio de la UI
    database.ts                 # AUTO-GENERADO: tipos del esquema SQL
  db/
    schema.ts                   # AUTO-GENERADO: metadatos del esquema en runtime
  styles/
    styles.css                  # sistema de diseño (tokens, componentes, claro/oscuro)
    styles-v2.css               # tema alterno "Editorial / Esmeralda" (opcional)
```

## Modelo de base de datos

Los tipos del esquema de base de datos se **generan automáticamente** desde el
dump `mtldtmte_new_gratexdb (1).sql` (solo estructura: tablas y columnas, se
ignoran los datos):

```bash
pwsh scripts/gen-schema.ps1     # o powershell.exe en Windows
```

Esto produce:

- `src/types/database.ts` — una `interface` por tabla y un mapa `Database`.
- `src/db/schema.ts` — metadatos en runtime (`SCHEMA`, `TABLE_NAMES`, helpers).
- `public/db_schema.js` — nombres de columnas por tabla, para el diagrama
  interactivo `public/Diagrama BD.html`.

## Cambiar de tema visual

Por defecto usa la **v1 "Núcleo"** (azul). Para la **v2 "Editorial / Esmeralda"**
(marfil + serif + verde), descomenta en `src/main.tsx`:

```ts
import './styles/styles-v2.css'
```

## Notas

- Es un **prototipo de interfaz**: los datos de la UI son simulados
  (`src/data/mockData.ts`) y no hay backend ni envío real a la DGII.
- El cambio de tema claro/oscuro está en la barra superior y persiste en `localStorage`.

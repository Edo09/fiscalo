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

Organización por capas + una carpeta por dominio funcional (`features/`).
Flujo de datos: `api/` (servicios HTTP) → `api/mappers.ts` (fila API → tipo de UI)
→ `features/*` (vistas) con caché de TanStack Query (`hooks/useApiQuery`).

```
src/
  main.tsx                      # punto de entrada: QueryClientProvider + <App/>
  App.tsx                       # puerta de auth (login vs shell) + sidebar/navbar/ruteo
  vite-env.d.ts                 # tipos de las variables VITE_* del .env

  api/                          # ÚNICA capa de acceso a la API (un servicio por recurso)
    config.ts                   # API_BASE_URL, TENANT_ID, DEFAULT_USER_ID (del .env)
    http.ts                     # cliente fetch: Bearer token, timeouts, ApiError, 401→logout
    auth.ts                     # login / logout (envoltorio {success,data})
    clients.ts · products.ts · facturas.ts · gastos.ts · stats.ts · users.ts
    types.ts                    # DTOs de la API (requests/responses), colocados con la capa
    mappers.ts                  # conversión fila de API → tipos de dominio de la UI
    index.ts                    # barrel: import { ... } from '@/api'

  stores/
    auth.ts                     # store Zustand de sesión (token+user, persistido) + useSession

  hooks/
    useApiQuery.ts              # useQuery con caché compartida ({data,error,loading,reload})

  config/
    navigation.ts               # NAV del sidebar, títulos, tipos ViewId / Nav
    ecf.ts                      # catálogo de tipos e-CF (códigos, nombres, descripciones)
    gastos.ts                   # etiquetas/helpers del módulo de gastos

  components/
    ui/                         # primitivas, un archivo por componente + barrel index.tsx
                                #   Icon, Btn, Money, Badge, Avatar, Card, KPI, Switch,
                                #   Tabs, Modal, Drawer, Dropdown, states, charts, PageHead
    layout/                     # Sidebar, Navbar, SearchPalette, NotifPopover

  features/                     # una carpeta por dominio funcional (vistas + sus modales)
    auth/                       # LoginView
    dashboard/ · invoices/ · ecf/ · clients/ · products/ · expenses/
    purchases/ · suppliers/ · reports/ · treasury/ · users/ · settings/ · notifications/

  types/
    domain.ts                   # tipos de dominio de la UI (Cliente, Producto, Factura…)
    database.ts                 # AUTO-GENERADO: tipos del esquema SQL

  db/
    schema.ts                   # AUTO-GENERADO: metadatos del esquema en runtime
  styles/
    styles.css                  # sistema de diseño (tokens, componentes, claro/oscuro)
    styles-v2.css               # tema alterno "Editorial / Esmeralda" (opcional)
```

Convenciones:

- **Una vista nunca llama `fetch` directo**: importa su servicio desde `@/api` y
  lo consume con `useApiQuery` (clave de caché por recurso, ej. `['products','list']`).
- **DTOs vs tipos de UI**: lo que devuelve la API vive en `api/types.ts`; lo que
  renderizan los componentes vive en `types/domain.ts`; `api/mappers.ts` traduce.
- **Mutaciones**: tras crear/editar/borrar se invalida la clave del recurso
  (`queryClient.invalidateQueries({ queryKey: ['products'] })`).

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

- La app se conecta al backend **api-gratex** (login multi-tenant, clientes,
  productos, facturas e-CF, gastos, stats). Configura `.env.local` a partir de
  `.env.example` (proxy de Vite + `VITE_TENANT_ID`).
- Tesorería, recurrentes y notificaciones aún no tienen endpoint: muestran un
  estado vacío hasta que el backend los exponga.
- El cambio de tema claro/oscuro está en la barra superior y persiste en `localStorage`.

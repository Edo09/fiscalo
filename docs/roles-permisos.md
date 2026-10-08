# Roles y Permisos (RBAC)

Control de acceso por rol. **DB-driven per-tenant** (cada tenant define sus roles), aplicado
por un **gate central** en el Router, con despliegue en **sombra** antes de bloquear.

> Antes solo había autenticación: cualquier token válido = acceso total. Ahora el rol del
> usuario decide a **qué módulos** puede acceder (ver/usar). El permiso es acceso a módulo,
> no acciones read/write separadas.

## Modelo

- **`master.roles`** (`id`, `tenant_id`, `name`, `description`, `is_system`) +
  **`master.role_permissions`** (`role_id`, `permission`). En single-tenant
  (`MULTI_TENANT_ENABLED=false`) viven en la DB del tenant con `tenant_id=0`.
- **`users.role`** guarda el **nombre** del rol (string). Se resuelve a permisos por
  `(tenant_id, name)` — backward-compatible: los `'user'`/`'admin'` existentes siguen funcionando.
- Cada tenant se siembra con dos **roles de sistema** (`is_system=1`, no borrables):
  - `admin` → permiso `*` (todos los módulos).
  - `user` → módulos operativos, sin los de administración (`emisor`, `branding`,
    `landing`, `users`, `roles`).

## Permisos = acceso a módulo

El permiso es el **nombre del módulo** (`facturas`, `gastos`, `clients`, ...) o `*` (todos).
Un rol = la lista de módulos que puede ver/usar. **No** hay read/write separados: tener el
módulo = acceso completo a ese módulo; no tenerlo = no se ve.

- El **catálogo** de módulos válidos y el **mapa ruta→módulo** son **estáticos** en
  [`config/permissions.php`](../../config/permissions.php) (iguales para todos los tenants: un
  tenant no inventa rutas, solo combina módulos del catálogo en sus roles).
- Qué módulos tiene cada rol es **per-tenant** (en la DB).

Módulos del rol `user` por defecto (operativos): `facturas`, `facturas-simples`, `gastos`,
`clients`, `products`, `proveedores`, `cotizaciones`, `aprobaciones`, `reportes`, `ncf`,
`unidades`. **Solo admin** (excluidos de `user`): `emisor`, `branding`, `landing`, `users`,
`roles`. (Si un `user` necesita un módulo admin, crear/ajustar un rol con `/api/roles`.)

> `conduces` **no es un módulo**: `/api/conduces` (los conduces de mercancía de Ferretería) usa
> el módulo `cotizaciones` (`'conduces' => 'cotizaciones'` en `routes` del backend), porque un
> conduce sale de una cotización (o se crea sin ella, pero es del mismo trabajo). Quien tiene `cotizaciones` ve y usa los conduces; sin él, 403
> como en cualquier módulo. Aparte del rol, el backend responde 422 a las empresas que no están
> en el formato de cotización `ferreteria` (`api-gratex/docs/api/conduces.md`). En el front la
> página además depende del formato: ver "Vistas de un formato de cotización" más abajo.

## Aplicación — `PermissionGate` (Router)

[`src/PermissionGate.php`](../../src/PermissionGate.php) corre en
[`src/Router.php`](../../src/Router.php) **antes** de incluir el controller. Clasifica por el
valor del mapa de rutas:

| Valor en `routes` | Significado |
|---|---|
| `'public'` | sin auth (login, docs) |
| `'dgii'` / `'integration'` | principal externo (firma / `X-API-SECRET`); resuelve tenant, el controller valida |
| `'<módulo>'` (o por método) | ruta de usuario-app: exige token válido + acceso a ese módulo |

Reglas:
- **Ruta de app sin el módulo (o sin rol):** → 403 en `enforce` (en sombra solo se registra).
- **Ruta sin entrada en el mapa:** el gate la registra (`[PermissionGate] ruta sin mapeo`) y la
  **deja pasar** — el controller hace su propia validación de token igual. Toda ruta real de la
  app ya está en el mapa; un hueco se ve en el log.
- El rol se lee **server-side** del usuario del token (`authModel::validateToken` lo trae con un
  JOIN a `users`), **nunca** del request.
- Los controllers conservan su propio `validateRequest()` (defensa en profundidad). El gate
  también puede usarse fino con `AuthMiddleware::requirePermission('facturas')`.

### Despliegue en sombra — `PERMISSIONS_ENFORCE`
Flag en `.env` (patrón de `MULTI_TENANT_ENABLED`):
- `false` (default) — **sombra**: no bloquea, solo registra en `error_log` lo que se denegaría
  (`[PermissionGate][SHADOW] ...`). Sirve para descubrir gaps con tráfico real.
- `true` — aplica de verdad (401/403).

**Excepción:** la gestión de roles (`/api/roles`) se exige **siempre** (admin), aun en sombra —
es un vector de escalada de privilegios.

## API — `/api/roles` (módulo `roles`; admin via `*`)

| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/roles` | listar roles del tenant (con permisos) |
| GET | `/api/roles/{id}` | un rol |
| POST | `/api/roles` | crear rol `{name, description?, permissions[]}` |
| PUT | `/api/roles/{id}` | actualizar `{description?, permissions?}` (no roles de sistema) |
| DELETE | `/api/roles/{id}` | borrar (no sistema; ningún usuario debe tenerlo) |
| PUT | `/api/roles/assign` | asignar rol a usuario `{user_id, role}` |

Permisos validados contra el catálogo. `assignUserRole` valida que el rol pertenezca al tenant
del usuario (no se puede referenciar un rol de otro tenant).

## API — `/api/users` (módulo `users`; admin via `*`)

Gestión de usuarios **del tenant del que está logueado el admin** (el `tenant_id` sale del
token, nunca del body — no se pueden crear usuarios en otro tenant). Hard-gated por el módulo
`users` (como `/api/roles`).

| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/users` | listar usuarios del tenant (sin password) |
| GET | `/api/users/{id}` | un usuario |
| POST | `/api/users` | crear `{email, password, name, username, role?}` (rol validado contra los roles del tenant; default `user`) |
| PUT | `/api/users/{id}` | actualizar `{name?, last_name?, email?, username?, role?, password?}` |
| DELETE | `/api/users/{id}` | borrar (no puedes borrar tu propio usuario) |

Crear reusa `authModel::registerUser` (email único global, username único por tenant, hash bcrypt).

> Quitados: `POST /api/auth/register` (no pasaba `tenant_id`, roto en multi-tenant) y el viejo
> `userController`/`userModel` legacy (pre-multitenant, sin rol/tenant). La alta por
> herramienta admin sigue disponible en `public/create_user.php`.

## Frontend — menú y páginas

El front decide qué páginas/menú mostrar con la **lista de módulos** del usuario:

- `POST /api/auth/login` devuelve `data.user.permissions` = los módulos del rol
  (ej. `["facturas","gastos","reportes",...]` o `["*"]` para admin).
- `GET /api/auth/me` (cualquier usuario autenticado, sobre sí mismo) devuelve
  `data.user` con `role` + `permissions`. Úsalo para **refrescar** los módulos sin
  re-login cuando un admin cambia el rol (el backend lee el rol vivo en cada request).

El front muestra/oculta por módulo: `perms.includes('*') || perms.includes('facturas')`.

Si los ids de vista del front no coinciden con los nombres de módulo (ej. `clientes`→`clients`,
`productos`→`products`, `compras`→`gastos`, `ecf`→`facturas`, `aprobar-ecf`→`aprobaciones`,
`conduces`→`cotizaciones`), mantener un mapa `vista → módulo(s)` y mostrar con *any-of*. Vistas
sin API (dashboard, tesorería) no se gatean (no hay 403 que dar).

### Vistas de un formato de cotización (Conduces)

Además del módulo, un item del menú puede exigir el **formato de cotización** del tenant
(`NavItem.formato` en `src/config/navigation.ts`). Hoy solo lo usa **Conduces**
(`{ id: 'conduces', module: 'cotizaciones', formato: 'ferreteria' }`). Su formulario
`conduce-editar` hereda el módulo y el formato por `SUBVISTA_DE`.

- **De dónde sale el formato:** `useFormatoTenant()` lee `cotizacion_formato` de
  `GET /api/branding`, sin volver a pedirlo al regresar a la pestaña. `AppShell` lo lee una vez
  y se lo pasa al sidebar, al buscador de páginas y a la redirección de `App`. El 409 de
  single-tenant cuenta como `gratex`.
- **Mientras no se sabe** (branding cargando o con error), el formato es `null`: el item no se
  ve, pero `App` no saca de la vista (`debeSalirDeVista`). Recargar sobre Conduces se queda en
  Conduces, que muestra "cargando" o el error con "Reintentar".
- **Con el formato sabido y distinto** (Gratex), `App` lleva al dashboard sin apilar historial.
  Conduces y su formulario no llaman a `/api/conduces` hasta saber que el formato es
  `ferreteria`, así que Gratex nunca ve el 422 "Los conduces no están disponibles para tu
  empresa.".
- `puedeVerItem(user, it, formato?)` y `puedeVerVista(user, view, formato?)`: un item con
  `formato` se ve solo cuando el del tenant es ese (`null` lo esconde). Los items sin `formato`
  dan lo mismo que antes, se pase o no el tercer argumento.
- **Bitácora:** los eventos de los conduces llevan el módulo `conduces` (etiqueta "Conduces"; es
  un módulo de la bitácora, no un permiso) y la entidad `conduce`, que se abre con "Abrir
  conduce". Una eliminación no ofrece nada, como en el resto.

> El front-gating es solo UX. El **backend igual aplica** (PermissionGate): aunque el
> front muestre la página, la API responde 403 si el rol no tiene el módulo.

## Onboarding / usuarios

- [`tools/create_tenant.php`](../../tools/create_tenant.php) siembra `admin`+`user` al crear cada
  tenant (desde `config/permissions.php['defaults']`). El usuario admin queda con `role='admin'`.
- [`public/create_user.php`](../../public/create_user.php) permite elegir `user`/`admin` al alta.
  Para roles personalizados, asignar luego con `PUT /api/roles/assign`.

## Rollout

1. **Esquema + seed** — correr `db/master_migrations/003_add_roles_permissions.sql` (tenants
   existentes; idempotente). Tenants nuevos lo reciben en `db/master_schema.sql`.
2. **Sombra** — código desplegado con `PERMISSIONS_ENFORCE=false`; revisar `error_log`.
3. **Roles** — crear/ajustar roles por tenant vía `/api/roles` si hace falta.
4. **Enforce** — con los logs limpios, `PERMISSIONS_ENFORCE=true`.

## Archivos

`db/master_migrations/003_add_roles_permissions.sql`, `config/permissions.php`,
`src/PermissionGate.php`, `src/Models/RoleModel.php`, `src/Controllers/roleController.php`,
`src/Router.php` (gate + `case 'roles'`), `src/Middleware/AuthMiddleware.php` (`role` +
`requirePermission`), `src/Models/authModel.php` (`validateToken` trae role; `registerUser` role),
`tools/create_tenant.php` (seed), `db/master_schema.sql` + `db/tenant_schema.sql` (tablas).

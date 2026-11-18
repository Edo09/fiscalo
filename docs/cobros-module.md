# Módulo de Cobros (web)

Pantalla de **Cobros** (cuentas por cobrar por cliente) de Fiscalpoint. El contrato de la API, las
reglas de negocio y los valores por defecto están en el repo de la API:
`api-gratex/docs/modules/cobros.md`. Este archivo es el mapa del lado web.

Vista `cobros` (`ViewId`), item **Cobros** en el grupo *Ventas* (módulo RBAC `cobros`), acceso
**Nueva › Cobro** en el navbar y botón **Cobros** en la ficha del cliente (abre el panel de ese cliente).

Hay una **segunda pantalla con el mismo cuerpo**, **Cobros de tenants** (vista `cobros-tenants`, solo cuentas de soporte): lo que
la *plataforma* le cobra a las empresas que usan Fiscalpoint. Ver "Cobros de tenants" más abajo.

## Mapa de archivos

| Capa | Archivo | Qué hace |
|---|---|---|
| Tipos y esquemas | `src/api/schemas/cobros.ts` | Esquemas **Zod** de las respuestas (los tipos se infieren de ellos), reglas de los formularios (monto, fecha, saldo, hora) y el dinero en centavos |
| Servicio | `src/api/cobros.ts`, `src/api/rutas-cobros.ts`, `src/api/qs.ts` | `crearApiCobros(base)` devuelve una función por endpoint; hay dos instancias, `apiCobros` (`/api/cobros`) y `apiCobrosTenants` (`/api/cobros-tenants`), y las funciones sueltas de siempre (`listCobros`…) son las del ámbito de empresa. Cada respuesta se valida con su esquema (si no encaja, un `ApiError` claro). Las rutas salen de `rutas-cobros.ts` (sin dependencias: se prueba con Node) |
| Datos | `src/features/cobros/hooks.ts`, `claves.ts` | **TanStack Query**: consultas con caché y mutaciones. Leen el servicio y las claves del **ámbito** de la pantalla (`useAmbitoCobros`): las claves cuelgan de una raíz por ámbito (`['cobros']` o `['cobros-tenants']`) y toda mutación invalida la raíz de **su** ámbito **al terminar, salga bien o mal** (`onSettled`). También `useRelojServidor` y `useBuscarTenants` |
| Interfaz | `src/features/cobros/store.ts` | **Zustand, solo estado de interfaz**: pestaña, filtros, página, panel del cliente abierto (y con qué pestaña), ventana de los recordatorios y modal abierto. **Un store por ámbito** (`cobrosUiEmpresa` y `cobrosUiTenants`, de `crearCobrosUi()`); `useCobrosUi(selector)` lee el del ámbito en que se pinta. Los modales guardan ids, nunca copias de un cobro. Los dos se reinician al cambiar de sesión (los ids son de una empresa) |
| Ámbito | `src/features/cobros/ambito.ts`, `ambitos.ts` | El contexto (`AmbitoCobrosContext`, `useAmbitoCobros`) y los dos ámbitos armados (`AMBITO_EMPRESA`, `AMBITO_TENANTS`): servicio, claves, store de interfaz y los pocos textos que cambian (`TextosAmbito`) |
| Pantalla | `src/features/cobros/CobrosView.tsx` | `CobrosView` (empresa) y `CobrosTenantsView` (plataforma) ponen su ámbito en el contexto y pintan el mismo cuerpo: dashboard, pestañas (Cobros / Recordatorios), panel y modales; al salir de la vista cierra el modal y el panel |
| Componentes | `src/features/cobros/components/` | `DashboardCobros`, `ListadoCobros` (`FiltrosCobros` + `TablaCobros`), `ClientePanel` (`HistorialCobros`, `ConfigClienteForm`), `RecordatoriosSection`, `CobroFormModal`, `PagoFormModal`, `MotivoModals` (cancelar y anular pago), `RecordatorioFormModal`, `ElegirClienteModal`, `SelectorCliente` y `TenantCombobox` (el buscador del ámbito), `EstadoCobroBadge`, `ModalesCobros` |
| Utilidades | `format.ts`, `clave.ts`, `reloj.ts` | Textos, tonos y la regla del vencimiento (sin React); clave de idempotencia (UUID); la hora de RD a partir de la que manda el servidor |
| Estilos | `src/styles/cobros.css` | Lo que `styles.css` no trae (barras de antigüedad, listas, método de pago, avisos, capa de los modales sobre el panel) |

Los **clientes** se reutilizan: en una empresa, `ClientCombobox` (el buscador de siempre, a través de `SelectorCliente`) elige el
cliente en el formulario de cobro, en el filtro de la tabla y en "Cobro mensual de un cliente". No hay un módulo de clientes nuevo.

Se tocaron tres componentes compartidos, siempre con una prop opcional que no cambia nada para quien no la pasa:
`Modal` (`bloqueado`: no se cierra mientras se guarda; la X lleva `aria-label`), `Drawer` (`cerrarConEscape`) y
`Tabs` (`role="tablist"`/`tab`, se opera con el teclado).

## Decisiones de la pantalla

- **El estado de un cobro no se calcula aquí**: lo manda la API (derivado del saldo, el vencimiento y la fecha de
  hoy en hora de RD). La web solo le pone color (`TONO_ESTADO`): azul pendiente, ámbar parcial, rojo vencido,
  verde pagado, gris cancelado. Un vencido con abonos sigue "Vencido" y lleva además una pastilla "Parcial"
  (`EstadoCobroBadge`); el filtro **Parcial** lista todo lo que tiene abonos y todavía debe, venza o no.
- **Dinero en centavos** (`centavosDeTexto`, `aCentavos`): nada de sumar floats. El campo de monto acepta
  `1500`, `1,500.50`, `RD$ 1,500`; más de 2 decimales no pasan.
- **Pago**: el formulario lee el cobro de ahora (saldo real), no una copia vieja; el monto no pasa del saldo ni la
  fecha es de mañana. Genera **una clave de idempotencia por apertura del formulario**: si la respuesta se
  pierde y se repite con los mismos datos, la API devuelve el mismo pago en vez de registrar otro. Si la API dice
  que esa clave ya es de otra operación (otro monto, un pago que se anuló, otro cobro), el formulario cambia de
  clave: lo que se mande después es un pago distinto.
- **Al completarse un cobro** el aviso dice qué pasó con el del mes siguiente (`siguiente_motivo`): se generó (y, si
  nació vencido, que ya está vencido), el cliente no tiene cobro mensual, lo tiene apagado, o ya existía
  (`textoSiguiente`).
- **Un guardado en curso no se interrumpe**: los modales usan `bloqueado` mientras guardan (ni la X, ni Escape, ni
  tocar fuera, ni Cancelar), y un formulario solo cierra **su** modal (`cerrarModal(modal)`), no otro que se abrió
  después. Cerrar y reabrir a medio guardar creaba otra clave y podía duplicar un pago parcial.
- **Los formularios no se desmontan por un refetch fallido**: solo un error **sin dato** impide abrir un cobro.
  Con dato (la red se cayó al refrescar) el formulario sigue, con un aviso de que los datos pueden estar viejos;
  desmontarlo borraba lo escrito. Las mutaciones invalidan la caché también al fallar (un 409 o un tiempo agotado
  dejan datos viejos en pantalla).
- **Un formulario espera el primer dato fresco al abrirse** (`useDetalleParaFormulario`): toma su estado inicial al
  montarse (el monto por defecto de un pago, los campos de una edición) y, con el dato viejo de la caché (de antes de
  cancelar o reabrir el cobro, del pago de otro usuario), arrancaba con valores que ya no valen: al pagar un cobro recién
  reabierto el monto salía en RD$ 0.00, y guardar una edición habría pisado el cambio de otro.
- **Hora de RD, no la del navegador**: el dashboard trae `hoy` y `ahora` del servidor; `useRelojServidor` los lee de
  la caché y les suma el tiempo transcurrido. La fecha de un pago y la hora de un recordatorio salen de ahí: un
  usuario de soporte en otra zona horaria ya no ve su fecha "de mañana" rechazada.
- **Vencimiento sugerido** al crear un cobro: la API manda el periodo, el monto y el vencimiento sugeridos de la
  configuración del cliente (`sugerido` del panel); lo que la persona toca ya no se pisa, y el vencimiento sin
  tocar sale del día del cliente y del periodo que hay en el formulario. `vencimientoDe` repite la regla del
  servidor (día 31 → último día del mes corto) solo para mostrar la fecha antes de guardar.
- **Dentro del panel del cliente** (un `Drawer`, z-index 101) no se usa el menú desplegable (z-index 90 quedaría
  detrás): las acciones son botones de ícono, y los modales abiertos desde el panel van dentro de
  `.cobros-capa-modal` para quedar encima. Con un modal abierto el panel no responde a Escape (`cerrarConEscape`).
- **"Cobro mensual de un cliente"** abre el panel del cliente en la pestaña *Cobro mensual*; el panel avisa cuando el
  cobro mensual está activo pero el cliente no tiene ningún cobro abierto (nada se generará solo).
- **Recordatorios por cliente**: una fila por cliente (lo que debe vencido y por vencer, su último recordatorio, si
  toca otro). *Anotar* lo registra en su cobro más urgente, pero cuenta para el cliente entero. Solo un registro: la
  pantalla lo dice, Fiscalpoint no envía WhatsApp ni correos. La ventana (7, 15 o 30 días) vive en el store: la usan la
  sección y el contador de la pestaña. Si la API corta la lista (`truncado`), la pantalla lo avisa.
- **Filtros**: lo que se escribe (nombre, periodo, fechas) queda en el campo y solo un valor completo y válido llega al
  servidor; una fecha a medias no dispara una consulta que fallaría. "Limpiar filtros" también borra la búsqueda.
- **Navegación**: "Nueva › Cobro" manda un objeto nuevo en cada clic (`CobrosView` actúa sobre la señal, no sobre un
  booleano), así que el alta se abre también la segunda vez.
- **Accesibilidad**: el interruptor de "generar el cobro del mes siguiente" es un botón `role="switch"`, los pagos de
  un cobro se abren con un botón (`aria-expanded`), las pestañas se operan con el teclado y los avisos llevan el
  texto en el color del tema (el color semántico solo en el fondo, el filo y el ícono: 4.5:1 de contraste o más).

## Cobros de tenants (la pantalla de soporte)

Segunda pantalla con el **mismo cuerpo** que Cobros, para lo que **la plataforma** le cobra a las empresas que usan Fiscalpoint
(`api-gratex/docs/modules/cobros.md`, "Cobros de tenants"). Vista `cobros-tenants`, item **Cobros de tenants** en *Administración*
(justo después de la Bitácora), solo para cuentas de soporte (`acceso_global`).

- **Un ámbito, no dos copias.** `CobrosView` y `CobrosTenantsView` ponen su ámbito (`AMBITO_EMPRESA` / `AMBITO_TENANTS`) en un contexto y
  todo lo de abajo (hooks, filtros, panel, formularios) lo lee. Cambia el servicio (`/api/cobros` o `/api/cobros-tenants`), la raíz de las
  claves de caché, el store de interfaz y unos pocos textos (`TextosAmbito`); el resto de la pantalla habla de "cliente" en las dos.
- **Nada se mezcla.** El id de un cliente de una empresa y el de un tenant son ids de tablas distintas: por eso cada ámbito tiene su store
  (filtros, panel, modal), sus claves de caché y su frescura (`'cobros-tenants'` es volátil, como `'cobros'`). Los dos stores se reinician al
  cambiar de sesión.
- **El buscador de tenants** (`TenantCombobox`, vía `SelectorCliente`) reemplaza al de Clientes en el formulario de cobro, en el filtro de la
  tabla y en "Cobro mensual de una empresa": consulta `GET /api/cobros-tenants/clientes?query=&limite=`, trae a todas (las activas primero) con una
  línea de detalle (`detalleTenant`: RNC, si es de integración, el ambiente si no es producción, si está inactiva y si ya tiene cobro mensual).
- **Solo soporte, sin fail-open.** `NavItem.soloAccesoGlobal` (`navSoloAccesoGlobal`, `puedeVerItem`, `debeSalirDeVista`): sin
  `acceso_global: true` en la sesión no se muestra el item (ni a un admin, ni con todos los módulos), y quien llegue por otro camino (la vista
  guardada en el navegador) es sacado al dashboard. Es solo comodidad: el servidor responde 403 a quien no tiene el acceso global. El acceso
  global **no** da el módulo `cobros` de las empresas (son cuentas por cobrar distintas).
- **Orden de despliegue**: la migración master 021 y la API van antes que la web; sin ellas la pantalla muestra el error de la API.

## Pruebas

```bash
node scripts/test-cobros.ts          # contrato, formularios, formato, reloj, store y navegación (sin navegador)
node scripts/test-cobros-tenants.ts  # el ámbito de tenants: contrato, rutas, claves, un store por ámbito y navegación solo para soporte
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src scripts
npm run build
```

`scripts/test-cobros.ts` valida las **respuestas reales del modelo de la API** (`scripts/fixtures/cobros/*.json`)
contra los esquemas Zod: si la API cambia de forma y el esquema no, falla ahí. Para regenerar los fixtures, en
`api-gratex` (con `pdo_sqlite`):

```bash
php -d extension=php_pdo_sqlite.dll tools/test_cobros.php --fixtures=<ruta de fiscalo-react>/scripts/fixtures/cobros
php -d extension=php_pdo_sqlite.dll tools/test_cobros_tenants.php --fixtures=<ruta de fiscalo-react>/scripts/fixtures/cobros-tenants
```

Los tenants de `scripts/fixtures/cobros-tenants/` son inventados (nombres y RNC de mentira): el repo es público.

> `npm run lint` (`eslint .`) también revisa `ds-bundle/` (el bundle del sistema de diseño), que ya fallaba antes
> de Cobros; `eslint src scripts` es lo que cubre el código de la app.

> **Orden de despliegue**: los esquemas exigen los campos nuevos de la API (`siguiente_motivo`, `ahora`, `clientes`,
> `truncado`). Se sube primero la API (con las migraciones aplicadas) y después la web; con la web primero, las
> pantallas de Cobros mostrarían "una respuesta que no entendemos" hasta que se suba la API.

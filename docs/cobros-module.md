# Módulo de Cobros (web)

Pantalla de **Cobros** (cuentas por cobrar por cliente) de Fiscalpoint. El contrato de la API, las
reglas de negocio y los valores por defecto están en el repo de la API:
`api-gratex/docs/modules/cobros.md`. Este archivo es el mapa del lado web.

Vista `cobros` (`ViewId`), item **Cobros** en el grupo *Ventas* (módulo RBAC `cobros`), acceso
**Nueva › Cobro** en el navbar y botón **Cobros** en la ficha del cliente (abre el panel de ese cliente).

## Mapa de archivos

| Capa | Archivo | Qué hace |
|---|---|---|
| Tipos y esquemas | `src/api/schemas/cobros.ts` | Esquemas **Zod** de las respuestas (los tipos se infieren de ellos), reglas de los formularios (monto, fecha, saldo, hora) y el dinero en centavos |
| Servicio | `src/api/cobros.ts` | Una función por endpoint de `/api/cobros`; cada respuesta se valida con su esquema (si no encaja, un `ApiError` claro) |
| Datos | `src/features/cobros/hooks.ts` | **TanStack Query**: consultas con caché (`cobrosKeys`) y mutaciones; toda mutación invalida `['cobros']` **al terminar, salga bien o mal** (`onSettled`); `useRelojServidor` |
| Interfaz | `src/features/cobros/store.ts` | **Zustand, solo estado de interfaz**: pestaña, filtros, página, panel del cliente abierto (y con qué pestaña), ventana de los recordatorios y modal abierto. Los modales guardan ids, nunca copias de un cobro. Se reinicia al cambiar de sesión (los ids son de una empresa) |
| Pantalla | `src/features/cobros/CobrosView.tsx` | Compone dashboard, pestañas (Cobros / Recordatorios), panel y modales; al salir de la vista cierra el modal y el panel |
| Componentes | `src/features/cobros/components/` | `DashboardCobros`, `ListadoCobros` (`FiltrosCobros` + `TablaCobros`), `ClientePanel` (`HistorialCobros`, `ConfigClienteForm`), `RecordatoriosSection`, `CobroFormModal`, `PagoFormModal`, `MotivoModals` (cancelar y anular pago), `RecordatorioFormModal`, `ElegirClienteModal`, `EstadoCobroBadge`, `ModalesCobros` |
| Utilidades | `format.ts`, `clave.ts`, `reloj.ts` | Textos, tonos y la regla del vencimiento (sin React); clave de idempotencia (UUID); la hora de RD a partir de la que manda el servidor |
| Estilos | `src/styles/cobros.css` | Lo que `styles.css` no trae (barras de antigüedad, listas, método de pago, avisos, capa de los modales sobre el panel) |

Los **clientes** se reutilizan: `ClientCombobox` (el buscador de siempre) elige el cliente en el formulario de
cobro, en el filtro de la tabla y en "Cobro mensual de un cliente". No hay un módulo de clientes nuevo.

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

## Pruebas

```bash
node scripts/test-cobros.ts          # contrato, formularios, formato, reloj, store y navegación (sin navegador)
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src scripts
npm run build
```

`scripts/test-cobros.ts` valida las **respuestas reales del modelo de la API** (`scripts/fixtures/cobros/*.json`)
contra los esquemas Zod: si la API cambia de forma y el esquema no, falla ahí. Para regenerar los fixtures, en
`api-gratex` (con `pdo_sqlite`):

```bash
php -d extension=php_pdo_sqlite.dll tools/test_cobros.php --fixtures=<ruta de fiscalo-react>/scripts/fixtures/cobros
```

> `npm run lint` (`eslint .`) también revisa `ds-bundle/` (el bundle del sistema de diseño), que ya fallaba antes
> de Cobros; `eslint src scripts` es lo que cubre el código de la app.

> **Orden de despliegue**: los esquemas exigen los campos nuevos de la API (`siguiente_motivo`, `ahora`, `clientes`,
> `truncado`). Se sube primero la API (con las migraciones aplicadas) y después la web; con la web primero, las
> pantallas de Cobros mostrarían "una respuesta que no entendemos" hasta que se suba la API.

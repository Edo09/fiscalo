# Actualización automática del frontend

Fecha: 2026-09-28 · Estado: diseño aprobado en conversación, pendiente de revisar este documento.

## Problema

Después de cada despliegue hay que pedirles a los usuarios que recarguen la
página. Cuando nadie avisa, siguen trabajando con el frontend viejo, a veces
durante días: la pestaña de caja queda abierta y nunca se recarga.

Recargar sí trae la versión nueva. El frontend se despliega en Vercel desde
GitHub, es un solo bundle, no tiene service worker y `vercel.json` no cachea
`index.html`. Lo que falta es que la app **sepa** que salió una versión nueva y
se recargue sola sin que nadie pierda trabajo.

## Objetivo y criterios de éxito

- Cero avisos manuales después de desplegar.
- Nadie pierde una factura a medio escribir ni una impresión en curso por una
  recarga automática.
- Un usuario activo queda en la versión nueva en minutos, no en días. Si no
  hubo ningún momento seguro, a los 10 minutos ve un aviso para actualizar.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| Qué hacer al detectar una versión nueva | Recargar sola en el primer **momento seguro**; si no llega ninguno, mostrar un aviso a los 10 min. |
| Actualizaciones urgentes (bloquear la pantalla) | **No** por ahora: todas siguen la misma regla. |
| Cómo detectar la versión | **`version.json` generado en el build + consulta periódica.** Se descartan comparar `index.html` (frágil), service worker (agrega una caché propia que es causa típica de "no se actualiza") y que el backend anuncie la versión (obligaría a tocar el PHP en cada despliegue). |

## Diseño

### 1. Detección

**En el build** (`vite.config.ts`), un plugin `versionPlugin`:
- Toma el identificador de versión: `process.env.VERCEL_GIT_COMMIT_SHA`, o si
  no existe, la hora del build (`new Date().toISOString()`, en Node, al
  configurar).
- Lo inyecta en el código como la constante global `__APP_VERSION__` (vía
  `define`). En desarrollo vale `'dev'`.
- Solo en `vite build`: emite el asset `version.json` en la raíz de `dist/` con
  el contenido `{ "version": "<id>" }`.

**En Vercel** (`vercel.json`): una regla `headers` para `/version.json` con
`Cache-Control: no-store`. La regla catch-all que manda todo a `/index.html` no
lo afecta, porque Vercel sirve primero los archivos que existen.

**En la app**, `src/lib/actualizacion.ts` consulta
`fetch('/version.json?t=<ms>', { cache: 'no-store' })`:
- al arrancar la app;
- cada 5 minutos mientras `document.visibilityState === 'visible'`;
- en `visibilitychange` cuando la pestaña vuelve a estar visible;
- en el evento `online`.

Una respuesta solo se acepta si es JSON, es un objeto y trae un `version` de
tipo string no vacío. Cualquier otra respuesta se ignora en silencio: sin
conexión, error HTTP, o el `index.html` que la regla de Vercel devuelve con
200 si el archivo faltara.

Si `version !== __APP_VERSION__`, queda una **actualización pendiente**
`{ version, desde }`, donde `desde` es el momento en que se detectó por primera
vez. Una detección posterior de la misma versión no mueve `desde`.

Con `__APP_VERSION__ === 'dev'` (`npm run dev`) no se consulta nada.

### 2. Cuándo se aplica

La app recarga sola (`location.reload()`) cuando hay una actualización
pendiente **y** el momento es seguro. Es seguro cuando se cumplen las tres
condiciones:

1. Nada sin guardar: `!haySinGuardar() && !guardandoAhora()`, de
   `hooks/useAvisoSalida`.
2. No se está imprimiendo: `!imprimiendo()`, de `imprimirRecibo`.
3. No se recargó ya por esta misma versión (ver *Protección anti-bucle*).

Disparadores (se evalúa el momento seguro en cada uno):

1. **Cambio de pantalla hacia una vista que se reabre tal cual**: `nav(v, p)`
   con `p == null` y sin `replace`. En vez de cambiar de vista sin recargar, el
   shell guarda `fiscalo.view = v` en `localStorage` (la clave que ya lee
   `restoreView`) y recarga, así que la app abre directamente en `v`.
   - No aplica con payload (abrir una factura concreta): tras recargar, esas
     vistas caen a su listado y el usuario perdería el clic.
   - No aplica con `replace` (redirecciones programáticas, como tras guardar):
     suelen venir seguidas de más trabajo. Por ejemplo, "Crear e imprimir"
     navega al listado y *después* imprime.
2. **Pestaña oculta 30 segundos seguidos** (`visibilitychange` a `hidden` más
   un temporizador que se cancela si vuelve a estar visible). Se espera 30 s y
   no se recarga al instante porque abrir un PDF o el recibo en otra pestaña
   (`window.open` de un blob) oculta esta. Recargar enseguida invalidaría el
   blob antes de que la pestaña nueva lo cargue.
3. **10 minutos sin interacción** (sin `pointerdown`, `keydown` ni `wheel`)
   con la pestaña visible. Se revisa una vez por minuto.

Justo antes de una recarga automática se escribe
`sessionStorage['fiscalo.recargaPara'] = version`.

### 3. Aviso

Componente `AvisoActualizacion`: una barra delgada arriba del contenido,
dentro del shell autenticado. No bloquea nada ni tiene botón de cerrar.

- Texto: *"Hay una versión nueva de FiscalPoint."* Botón: *"Actualizar ahora"*.
- Se muestra cuando la actualización lleva **10 minutos** pendiente, o de
  inmediato si la protección anti-bucle impidió la recarga automática.
- El botón llama `confirmarSalida(() => location.reload())`, el mismo de
  cerrar sesión. Con algo sin guardar pregunta primero; durante un guardado se
  ignora. La recarga manual no está sujeta a la protección anti-bucle.

En la pantalla de login no hay aviso. Los disparadores sí aplican ahí: no hay
nada que perder.

### 4. Protección anti-bucle

Si después de recargar por la versión `X` la app vuelve a detectar `X` como
pendiente (`sessionStorage['fiscalo.recargaPara'] === X`), no recarga sola otra
vez: solo muestra el aviso. Esto cubre el caso en que la CDN todavía sirve el
bundle viejo mientras `version.json` ya es el nuevo. `sessionStorage` es por
pestaña y se borra al cerrarla.

### Piezas e interfaces

| Pieza | Responsabilidad |
|---|---|
| `vite.config.ts` → `versionPlugin()` | `define: { __APP_VERSION__ }` y emitir `version.json` en build. |
| `src/vite-env.d.ts` | `declare const __APP_VERSION__: string` |
| `vercel.json` | Header `Cache-Control: no-store` para `/version.json`. |
| `src/lib/actualizacion.ts` | Estado de la actualización pendiente, la consulta, los disparadores de pestaña oculta e inactividad, y la protección anti-bucle. Exporta: `iniciarActualizacion()` (arranca consultas y disparadores; devuelve una función para detenerlos), `puedeRecargar(): boolean` (hay una actualización pendiente y el momento es seguro; solo decide), `recargar()` (anota `fiscalo.recargaPara` y llama `location.reload()`) y `useActualizacion()` (para el aviso: `{ mostrarAviso }`, que se vuelve a evaluar solo con el paso del tiempo). |
| `decidirRecarga(estado)` (pura, en el mismo módulo) | `({ pendiente, sinGuardar, guardando, imprimiendo, recargadoPara }) → boolean` |
| `leerVersion(json)` (pura) | Valida la respuesta; devuelve `string \| null`. |
| `src/features/invoices/imprimirRecibo.ts` | Contador de impresiones en curso: se incrementa al empezar `imprimirRecibo` y se decrementa en `finally`. Exporta `imprimiendo()`. |
| `src/hooks/useHistoryNav.ts` | Nueva opción `antesDeNavegar?: (v, p, opts) => boolean`. Se evalúa en `nav()` después del aviso de salida; si devuelve `true`, `nav` no navega (lo hace la recarga). |
| `src/components/layout/AvisoActualizacion.tsx` | La barra. |
| `src/App.tsx` | Llama `iniciarActualizacion()` en `App` (cubre también el login), pasa `antesDeNavegar` a `useHistoryNav` (con `p == null`, sin `replace` y `puedeRecargar()`: guarda `fiscalo.view = v`, llama `recargar()` y devuelve `true`) y renderiza el aviso en el shell. |

Las condiciones de "sin guardar" e "imprimiendo" se leen de los módulos que ya
las tienen. `actualizacion.ts` no conoce facturas ni formularios.

## Errores y bordes

- Sin conexión, 404, 500 o JSON inválido: se ignora y se reintenta en la próxima consulta.
- Varias pestañas: cada una detecta y recarga por su cuenta.
- La recarga nunca ocurre con algo sin guardar, durante un guardado ni durante
  una impresión. Si nunca llega un momento seguro, queda el aviso.
- `vite preview` y los builds locales sin `VERCEL_GIT_COMMIT_SHA` usan la hora
  del build, así que cada build es una versión distinta.

## Pruebas

- Se agrega **Vitest** como dependencia de desarrollo, con el script `npm test`.
  No entra al bundle.
- Pruebas unitarias de `decidirRecarga` (cada condición por separado y
  combinadas), `leerVersion` (JSON válido, HTML, objeto sin `version`, `null`)
  y la protección anti-bucle.
- Prueba manual con `npm run build` y `npx vite preview`, en la pantalla de
  login (no hace falta iniciar sesión ni tocar el backend de producción):
  editar `dist/version.json` y comprobar la recarga al ocultar la pestaña más
  de 30 s, la recarga por inactividad (con el tiempo acortado para la prueba) y
  que no recarga en bucle si el bundle no cambia. El aviso y el disparador por
  cambio de pantalla requieren sesión: los prueba el usuario, o se verifican
  con las pruebas unitarias y leyendo el código.

## Fuera de alcance

- Marcar actualizaciones como urgentes o bloquear la pantalla.
- Compatibilidad entre versiones de frontend y backend (versión mínima exigida por la API).
- Service worker, modo offline o notas de "qué hay de nuevo".

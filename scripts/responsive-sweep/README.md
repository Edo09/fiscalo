# Barrido responsive

Herramienta de desarrollo; no es parte de la app. Abre cada pantalla en varios
tamaños de ventana y mide cuánto scroll vertical pide, si algo se sale por el
lado, si hay texto recortado, si los diálogos caben y qué tan chicos quedan los
controles. Guarda los números y los compara entre dos versiones del código.

Sirve para comprobar de una vez, en todas las pantallas, un cambio de estilos o de
maquetación (ver [`docs/responsive-densidad.md`](../../docs/responsive-densidad.md)):
que un portátil pida menos scroll, que la ventana grande no cambie ni un píxel y
que no aparezca ningún desborde.

**Nunca toca producción.** La API es falsa (`mock-api.mjs`, con datos de prueba) y el
lanzador (`vite-mock.mjs`) se niega a arrancar si la API que le das no es local.

## Piezas

| Archivo | Qué hace |
|---|---|
| `mock-api.mjs` | API falsa en `127.0.0.1:8795`: sesión, clientes, productos, facturas, gastos, reportes, bitácora, POS (PIN 1234)… con datos creíbles de `fixtures.mjs`. También recibe y guarda los resultados. |
| `vite-mock.mjs` | El servidor de desarrollo de Vite apuntando a esa API falsa (`127.0.0.1:5184`). Sirve además la página del barrido en `/__sweep.html`. |
| `sweep.html` | La página que mide: carga la app en un iframe, lo redimensiona y mide. |
| `analizar.mjs` | Lee los resultados y los resume o compara. |

## Uso

Hace falta haber corrido `npm ci` (el lanzador usa el Vite del repo) y Node 18 o más.

1. `node scripts/responsive-sweep/mock-api.mjs`  (con `--vacio`, las listas salen sin filas, como una empresa nueva)
2. `node scripts/responsive-sweep/vite-mock.mjs`
3. Abre `http://127.0.0.1:5184/__sweep.html` en Chrome (o en el panel del navegador de la app) y **déjala a la vista**: en una pestaña en segundo plano los temporizadores se frenan y el barrido se arrastra.
4. En la consola de esa página: `sweep.start({ label: 'despues' })`. Tarda unos 6 minutos (61 pantallas y estados × 9 tamaños). El avance sale en la barra negra de arriba, o con `sweep.status()`.
5. `node scripts/responsive-sweep/analizar.mjs balance antes despues`

Los resultados quedan en `<carpeta temporal>/fiscalo-sweep/<label>/`. Para cambiar la
carpeta, `--out=<carpeta>` (en el mock y en el analizador) o la variable `SWEEP_OUT`.

### Comparar con el código de antes

Un cambio se mide contra el mismo código sin el cambio, con el mismo mock y el mismo
arnés:

1. `git worktree add --detach ../fiscalo-base <commit>`
2. `node scripts/responsive-sweep/vite-mock.mjs --repo=../fiscalo-base --port=5185`
3. Abre `http://127.0.0.1:5185/__sweep.html` y corre `sweep.start({ label: 'antes' })`.
4. Haz lo mismo en el 5184 (tu código) con `label: 'despues'` y compara con `analizar.mjs`.

El «antes» se puede reutilizar mientras ese commit no cambie. Un worktree sin
`node_modules` propio puede usar uno enlazado (en Windows, un *junction*); en ese caso
pasa `--allow=<carpeta real con node_modules>`. Antes de borrar el worktree, quita el
enlace sin recorrerlo (`cmd /c rmdir <ruta>\node_modules`).

## Qué se mide

Por cada pantalla y tamaño (1920×1080, 1536×864, 1440×900, 1366×720, 1366×620,
1280×720, 1024×768, 768×1024, 390×844):

- **Scroll vertical**: cuánto más alto es el contenido que la ventana.
- **Banderas**: `H` algo se sale por el lado y no lo contiene un scroll propio · `C` texto recortado sin «…» · `M` el diálogo o cajón no cabe en la ventana (o su pie queda fuera) · `X` la pantalla se cayó (ErrorBoundary) · `N` no terminó de cargar.
- **Controles y letra**: el control más bajo (la guía WCAG 2.2 pide al menos 24 px), cuántos quedan debajo, y la letra más chica.
- **Diálogos y cajones**: alto, y scroll dentro del cuerpo.
- **Rectángulos** de cada elemento (solo en 1920×1080, 768×1024 y 390×844): con `identico` se comprueba que un cambio de estilos no movió nada donde no debía.

## Comandos de `analizar.mjs`

| Comando | Para qué |
|---|---|
| `balance A B` | Totales por tamaño: scroll vertical, pantallas con problemas, controles. Es el resumen. |
| `comparar A B` | Scroll de cada pantalla, A → B, y las banderas que cambian. |
| `identico A B [tamaño]` | Compara cada rectángulo de cada elemento (por defecto en 1920×1080). Si ningún cambio debía verse ahí, no puede cambiar ninguno. |
| `resumen A` | Scroll y banderas de cada pantalla. |
| `problemas A [tamaño]` | Los desbordes, recortes y diálogos que no caben, uno por uno, con el elemento. |
| `modales A B` | Scroll interno y encaje de cada diálogo y cajón. |
| `muestras A pantalla` | Medidas (barra, filas, campos…) en cada tamaño. |

## Agregar o cambiar lo que se mide

- **Una pantalla o un estado** (un diálogo abierto, un formulario con líneas): se añade en `standard()`, dentro de `sweep.html`, como datos. Los pasos son clics en orden: `{ click: 'button', text: 'Nuevo cliente', wait: 350 }` (selector CSS y expresión regular del texto). `after` espera a que aparezca un selector; `noAuth: true` mide sin sesión (el login); `url`, `ls` y `ready` sirven para otra página (así está hecho el POS, en `posScreens()`).
- **Una pantalla que se cae o no carga** (`X` / `N`): casi siempre falta un endpoint o una forma de dato en `mock-api.mjs` / `fixtures.mjs`. Lo que el mock no conoce responde una lista vacía.
- **Un tamaño nuevo**: en `SIZES` de `sweep.html` y en `ORDEN` de `analizar.mjs`.
- Solo algunas pantallas o tamaños: `sweep.start({ label: 'x', only: ['facturas', 'm-producto'], sizes: ['1366x720'] })`. Con tema oscuro: `theme: 'dark'`.

## Límites

- Los datos son de prueba y pocos (hasta ~60 filas por lista): los números sirven para comparar dos versiones, no como valores absolutos de producción.
- Mide geometría, no el aspecto. Después de un cambio grande hay que mirar las pantallas (el panel del navegador, con `resize_window`, sirve).
- Cada pantalla se mide en un iframe del mismo origen: lo que dependa de la ventana del navegador y no del iframe (diálogos del sistema, impresión) queda fuera.

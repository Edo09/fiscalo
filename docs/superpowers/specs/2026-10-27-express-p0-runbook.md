# Runbook de P0 de Fiscalpoint Express: pasos del dueño

Fecha: 2026-10-27. Complementa el plan `2026-10-27-express-01-p0-baselines-ci-spikes.md`. Cada sección marcada **(owner-run)** necesita tus cuentas o credenciales (hosting, Vercel, DGII); nadie más las ejecuta. Cada salida que dé un comando se pega tal cual en el archivo de resultados (`docs/superpowers/specs/2026-10-27-express-p0-results.md`), nunca el token.

## Ids de los spikes

El brief de diseño numera los spikes S0 a S6; este plan los reparte con otros ids. Esta tabla es el puente:

| Nombre en el brief | Id en este plan | Qué mide | Sección |
|---|---|---|---|
| S0 | `S0` | Un proyecto Vercel de `express/` con las opciones de despliegue previstas | R3 |
| S1 | `S1` | `ConsultaTrackIds` por e-NCF devuelve el `trackId` de la fila de la app | R4 |
| S2 | `S2a` | Límites del hosting (`max_execution_time`, `disable_functions`) y qué pasa si el cliente se desconecta | R1 y R2 |
| S3 | `S2b` | Zonas horarias de PHP y de MySQL | R1 y R2 |
| S4 | `S3a` | E34 con un comprador distinto al de la factura original | R5 |
| S5 | `S3b` | E34 rechazada y el saldo de la factura original | R5 |
| S6 | `S2c` | Latencia hacia la DGII: `latencia` desde el host (R2) y emisión completa (R6) | R2 y R6 |

Orden de las secciones: **R1, R2, R3, R4, R5, R6, R7**. R3 necesita R1 y R2 hechos primero (usa el token de la sonda). Las tareas siguientes de P0 agregan R3 a R7 en ese orden, no en el orden de las tareas.

## R1. Preparar y subir la sonda del host (owner-run)

La sonda `express_probe.php` es temporal. La plantilla vive en `api-gratex/tools/express_p0/` y nunca se pone en `public/` del repo. Con `preparar_probe.php` se arma una copia que lleva solo el hash del token y una hora de vencimiento: la sonda caduca sola (responde 403 pasado el vencimiento aunque el archivo siga en el host) y no hace falta tocar el `.env` del servidor.

1. Desde el checkout del API que trae la rama `feat/express-backend`:

   ```bash
   php tools/express_p0/preparar_probe.php --horas=3
   ```

   Imprime la ruta de la copia (`sys_get_temp_dir()/express_probe.php`), el vencimiento y un **token nuevo, que se muestra una sola vez** y no se guarda en ningún archivo. Cópialo a una variable de tu terminal (`T=...`); no lo pegues en el chat, en commits ni en el archivo de resultados. Si lo pierdes o vence, vuelve a correr el comando y vuelve a subir la copia nueva.

2. Sube la copia a mano (cPanel File Manager) a la carpeta `public/` del API en el hosting, con el nombre `express_probe.php`. La ruta del servidor está en `api-gratex/CLAUDE.md`: el API vive en `/home1/smhynzte/public_html/api/`, así que el archivo queda en `/home1/smhynzte/public_html/api/public/express_probe.php`. Tiene que ir en `public/` (no en otra carpeta): para la hora de MySQL lee `../src/MasterDatabase.php`.

3. Comprueba que quedó puesta y cerrada. Sin token debe responder 403 con el cuerpo `{"error":"no autorizado"}` (si el cuerpo es otro, o es un 404, el 403 no viene de la sonda: la ruta o el hosting están mal):

   ```bash
   P=https://<API host>/api/public/express_probe.php
   curl -s -w '\n%{http_code}\n' "$P?paso=info"
   ```

   `<API host>` es el origen (esquema y dominio, sin ruta) que aparece en `vercel.json` línea 5, el `destination` del rewrite de `/api/`.

4. Comprueba que la cabecera llega a PHP. Con el token (`T=<token impreso>`), la misma llamada debe responder 200 con el JSON de `info`:

   ```bash
   curl -s -w '\n%{http_code}\n' -H "X-Probe-Token: $T" "$P?paso=info"
   ```

   Esta primera llamada con token prueba tres cosas que no se pueden comprobar fuera del hosting: que `public/` sirve el archivo en esa ruta, que el hosting entrega `X-Probe-Token` a PHP (la sonda la lee de `$_SERVER` y, si no está ahí, de `getallheaders()`) y que el directorio temporal sirve para el latido (`temp_writable`, ver R2). Si responde 403 con el token recién impreso y la sonda no ha vencido, la cabecera no está llegando o el token se copió mal: reintenta con el token copiado de nuevo y, si sigue igual, avisa antes de seguir (no se pasa el token por la URL).

La sonda se borra del hosting al terminar el spike (R7).

## R2. Correr la sonda (owner-run)

Con `P` y `T` definidos como en R1 (`P=https://<API host>/api/public/express_probe.php`, `T=<token impreso>`). El token va siempre en la cabecera `X-Probe-Token`, nunca en la URL. Pega la salida de cada comando en el archivo de resultados.

Pasos que entiende la sonda (`?paso=`): `info`, `dormir&seg=N` (GET o POST, de 1 a 130), `limite`, `desconexion`, `leer` y `latencia`. Esta sección usa cinco de ellos.

**Cómo leer el latido (importante).** `limite` y `desconexion` van escribiendo una línea por segundo en un archivo del directorio temporal del hosting (`sys_get_temp_dir()`), y `leer` lo lee. Si el hosting no deja escribir ahí (por ejemplo por `open_basedir` o un temporal sin permiso), el archivo nunca existe, y un `existe:false` se parecería a "el proceso murió cuando el cliente se fue", que es justo la conclusión que este spike no puede equivocar. Por eso la sonda lo dice de tres maneras: `info` trae `temp_dir`, `temp_writable` y `open_basedir`; las respuestas de `limite` y `desconexion` traen `heartbeat_inicio_ok` y `heartbeat_writes_failed`; y `leer` trae la ruta resuelta (`archivo`), `temp_writable` e `inconclusivo`. Regla: **`existe:false` con `temp_writable:false` (o `inconclusivo:true`) no prueba nada; esa corrida no cuenta y se anota como inconclusa.**

1. **Límites y zonas horarias (S2a, S2b).**

   ```bash
   curl -s -H "X-Probe-Token: $T" "$P?paso=info"
   ```

   S2a: mira `max_execution_time`, `disable_functions` y `functions` (`set_time_limit`, `ignore_user_abort`, `ini_set`, `curl_init`, `openssl_pkcs12_read`), más `memory_limit`. Mira también `open_basedir`, `temp_dir` y `temp_writable`: si `temp_writable` es `false`, el latido de los pasos 2 y 3 no se puede escribir y `leer` no sirve como prueba (ver arriba); pega el `info` igual y avisa antes de interpretar esos pasos. S2b: compara `php_default_timezone`, `ini_date_timezone` y `php_date_c` con `mysql.mysql_now`, `mysql.mysql_utc`, `mysql.global_time_zone`, `mysql.session_time_zone` y `mysql.system_time_zone`. Si `mysql` trae solo `error` (la clase de la excepción), pega eso y mide la zona de MySQL en phpMyAdmin con `SELECT NOW(), UTC_TIMESTAMP(), @@global.time_zone, @@session.time_zone, @@system_time_zone;`.

2. **Tope de una petición larga (S2a).** Tarda unos 130 s y responde `reached_seconds`:

   ```bash
   curl -s -H "X-Probe-Token: $T" "$P?paso=limite&seg=130&id=aaaa0001"
   ```

   Esta respuesta es también el control del latido: `heartbeat_inicio_ok:true` y `heartbeat_writes_failed:0` dicen que el hosting sí dejó escribir el latido; con `false` o con fallos, el latido de esta y de las demás corridas es inconcluso.

   Si el hosting corta antes (502, 504 o respuesta vacía), anota el tiempo que tardó y corre `curl -s -H "X-Probe-Token: $T" "$P?paso=leer&id=aaaa0001"`: el latido (una línea por segundo) dice hasta qué segundo siguió vivo el proceso.

3. **El cliente se va y el proceso sigue (S2a).** El cliente se desconecta a los 3 s (`curl` sale con código 28, es lo esperado); la sonda sigue 40 s en silencio:

   ```bash
   curl -s --max-time 3 -H "X-Probe-Token: $T" "$P?paso=desconexion&seg=40&id=aaaa0002&ignorar=0"
   ```

   Espera 45 s y lee el latido:

   ```bash
   curl -s -H "X-Probe-Token: $T" "$P?paso=leer&id=aaaa0002"
   ```

   Una línea `FIN` quiere decir que el proceso sobrevivió a que el cliente se fuera. Un archivo con `INICIO` y algunos `t=N` pero sin `FIN` quiere decir que el proceso murió cuando el cliente se fue (resultado válido). **`existe:false` con `temp_writable:false` es inconcluso, no "murió":** el latido no se pudo escribir (revisa `open_basedir` y `temp_dir` en `info`); solo vale como "el proceso no llegó a arrancar" si `leer` trae `temp_writable:true`, el `info` del paso 1 también y la respuesta del paso 2 trae `heartbeat_inicio_ok:true`. En el paso con `curl --max-time 3` la respuesta de la sonda no la ve nadie (el cliente ya se fue), por eso `leer` repite `temp_writable`. Repite con `ignore_user_abort` activado, que usa el id `aaaa0003`:

   ```bash
   curl -s --max-time 3 -H "X-Probe-Token: $T" "$P?paso=desconexion&seg=40&id=aaaa0003&ignorar=1"
   ```

   Espera 45 s y lee:

   ```bash
   curl -s -H "X-Probe-Token: $T" "$P?paso=leer&id=aaaa0003"
   ```

   Pega las dos lecturas completas, con `FIN` o sin él, incluidos `archivo`, `temp_writable` e `inconclusivo`.

4. **Latencia del host a la DGII (S2c).** Cinco GET a la semilla de certificación; reporta segundos de conexión, segundos totales y código HTTP de cada uno:

   ```bash
   curl -s -H "X-Probe-Token: $T" "$P?paso=latencia"
   ```

   Es la línea base host a DGII; la emisión completa se mide en R6. Esta es la primera vez que esa rama corre de verdad contra la DGII (las pruebas del repo no salen a internet): si un intento trae `curl_errno` distinto de 0, el `curl_error` dice por qué (resolución de nombres, conexión o tiempo agotado) y también es un dato del spike; pégalo tal cual.

## R3. S0: un proyecto Vercel de `express/` con las opciones previstas (owner-run)

Qué mide: si Vercel construye y sirve `express/` como un proyecto aparte del mismo repo con las opciones de despliegue previstas (diseño 13.1) y si los rewrites de `express/vercel.json` hacen lo que Express necesita: dar 404 a `/api/public/*`, entregar el shell de la SPA en cualquier otra ruta, llevar `/sonda` (con su cadena de consulta) a un origen externo y sostener ahí un POST de hasta 60 s. **Va después de R1 y R2**: el origen lento es la sonda (`paso=dormir`), así que tiene que seguir subida y sin vencer; si venció, repite R1 (copia nueva y token nuevo) y usa ese token aquí (`T`).

El stub vive en `docs/superpowers/spikes/express-p0-s0/` de la rama `feat/express-frontend`: la carpeta `express/` (cinco archivos: `index.html`, `package.json`, `vite.config.ts`, `vercel.json` y `src/main.ts`) y `probar.mjs`. `main.ts` importa `redondear` de `src/features/invoices/montosLinea.ts` por ruta relativa (`../../src/...`): eso prueba que Vercel trae los archivos de fuera del Root Directory. El stub no se fusiona nunca: va a una rama desechable que sale de `main`, nunca de `feat/express-frontend`.

1. **Rama desechable.** Corre esto en tu checkout del front. `S0` es la carpeta del stub en el checkout que tenga `feat/express-frontend` (hoy `.claude/worktrees/express-frontend/docs/superpowers/spikes/express-p0-s0`). `API_HOST` es solo el dominio del API, sin `https://` y sin ruta (el de `destination` en `vercel.json` línea 5, el mismo de R1): el stub ya trae el `https://` delante. Hazlo antes de que `main` tenga su propia carpeta `express/` (plan 06); después, la copia la pisaría.

   ```bash
   S0=<carpeta del stub>
   API_HOST=<dominio del API>
   git switch -c spike/express-s0 main
   cp -r "$S0/express" express
   sed -i "s#<API host>#$API_HOST#g" express/vercel.json
   grep -c '<API host>' express/vercel.json
   git add express
   git commit -m "spike(express): stub S0 de Vercel"
   git push -u origin spike/express-s0
   ```

   El `grep -c` tiene que imprimir `0`: si imprime otro número, quedó un `<API host>` sin reemplazar y el rewrite de `/sonda` o el de `/api/` apuntaría a un dominio inventado. Si prefieres no mover la rama de tu checkout, crea un worktree (`git worktree add ../express-s0 -b spike/express-s0 main`), entra a esa carpeta y corre ahí los comandos sin el `git switch`.

2. **Proyecto desechable en Vercel.** Add New → Project, importa el mismo repositorio de GitHub y ponle un nombre distinto al del proyecto real (por ejemplo `fiscalpoint-express-s0`). Fija estos ajustes **antes de desplegar** y anota cada uno que hayas tenido que cambiar respecto a lo que Vercel proponía:

   | Ajuste | Valor |
   |---|---|
   | Root Directory | `express/`, con "Include source files outside of the Root Directory in the Build Step" activado |
   | Framework Preset | el que detecte Vercel (Vite) u Other; anota cuál quedó |
   | Install Command (Override) | `cd .. && npm ci` |
   | Build Command (Override) | `cd .. && npx vite build --config express/vite.config.ts` |
   | Output Directory (Override) | `dist` |
   | Node.js Version | 22.x |
   | Environment Variables | ninguna |

   - Para que `https://<proyecto>.vercel.app` sirva la rama del spike, pon `spike/express-s0` como Production Branch (Settings → Git) y despliega esa rama.
   - El asistente de importación lee la rama por defecto (`main`), que no tiene `express/`. Si no te deja elegir `express/` como Root Directory, termina la importación con lo que proponga, escribe `express` en Settings → General → Root Directory y anótalo. El primer despliegue (el de `main`) fallará o construirá otra cosa: no cuenta.
   - Si al abrir la URL ves un inicio de sesión de Vercel (401), la protección de despliegues está tapando la prueba: desactiva Vercel Authentication solo en este proyecto desechable y anótalo.

3. **Revisa el registro del build.** Tiene que mostrar que `npm ci` corrió en la raíz del repo (no en `express/`), que `vite build` terminó con `built in` y que el despliegue quedó `Ready`. Anota cualquier aviso (por ejemplo, sobre el rango abierto de `engines.node` o sobre la versión de Node elegida).

4. **Corre las comprobaciones.** `T` es el token de R1 (`T=<token impreso>`) y la sonda sigue subida:

   ```bash
   node "$S0/probar.mjs" --base=https://<proyecto>.vercel.app --token=$T
   ```

   Tarda unos 150 s: las cuatro esperas son reales (15, 30, 45 y 60 s). El token solo viaja en la cabecera `X-Probe-Token` y no se imprime. Cada comprobación sale en una línea `OK` o `FALLA` con el estado HTTP, los segundos y un extracto del cuerpo (en un `FALLA`, el motivo va en la misma línea); termina con código 0 si todo pasó y 1 si algo falló. Pega la salida tal cual en el archivo de resultados.

   | Línea | Qué prueba |
   |---|---|
   | `GET /` | 200 y trae `<title>Express S0</title>`: el build salió y se sirve el stub |
   | `cabecera x-express-s0 en /` | el bloque `headers` de `express/vercel.json` se aplica |
   | `GET /api/public/x` | 404 y no el shell: el rewrite a `/__no_existe__` bloquea. Trae también `server` y `x-vercel-error`: dicen si el 404 lo dio Vercel o el origen del API |
   | `GET /facturas` | 200 con el shell: el comodín de la SPA |
   | `GET /sonda?paso=info` | el JSON de la sonda: el rewrite externo y la cadena de consulta llegan al origen |
   | `POST /sonda?paso=dormir&seg=N` (N = 15, 30, 45 y 60) | 200 y unos N segundos (entre N − 1 y N + 10): un POST largo sobrevive al rewrite externo. Se detiene en la primera que falla y dice cuál fue |

   Si una espera falla, anota N: la fila S0 del archivo de resultados dice qué se acorta (`DGII_TIMEOUT_SEG` del plan 03 y el tiempo límite del cliente del plan 07).

5. **`server.fs.allow` en desarrollo (local, no necesita Vercel).** Desde la raíz del checkout que tiene `feat/express-frontend`, antes del plan 06 (después, `express/` tiene archivos con esos mismos nombres y la copia los pisaría):

   ```bash
   mkdir -p express && cp -r "$S0/express/." express/
   npx vite --config express/vite.config.ts --port 5191 --strictPort
   ```

   En otra terminal, **justo después de arrancar y antes de abrir nada en el navegador**, pide un archivo de `src/` por la ruta `@fs` (en Git Bash de Windows, `pwd -W` da la ruta con letra de unidad):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:5191/@fs/$(pwd -W)/src/features/invoices/montosLinea.ts"
   ```

   Sin `S0_FS_ALLOW` tiene que dar `403`. Detén el servidor (Ctrl+C), arráncalo de nuevo con `S0_FS_ALLOW=1 npx vite --config express/vite.config.ts --port 5191 --strictPort` y repite el `curl` justo después de arrancar: tiene que dar `200`. Usa `localhost`, no `127.0.0.1`: Vite escucha en `localhost`, que en algunos equipos es solo `::1`, y `127.0.0.1` no responde (así pasó al preparar el stub). Esta prueba no usa el `.env` de la raíz ni llega a ninguna API: la config del stub tiene `root` y `envDir` en `express/` y no define proxy.

   El orden importa: Vite da por seguro cualquier módulo que otro módulo ya servido importa (`config.safeModulePaths`), así que en cuanto el navegador, o una petición, carga `/src/main.ts`, el mismo `@fs` responde `200` aunque no haya `S0_FS_ALLOW`. Medido al preparar el stub (2026-10-27, Vite 6.4.3, Windows, servidor recién arrancado en cada caso): sin `S0_FS_ALLOW`, `403` en la primera petición y también después de pedir solo `/`, pero `200` después de pedir `/src/main.ts`; con `S0_FS_ALLOW=1`, `200` siempre. Anota el estado de tu primera petición con y sin la variable.

   Al terminar, quita lo copiado (Vite también deja `express/node_modules/.vite`):

   ```bash
   rm -rf express/index.html express/package.json express/vite.config.ts express/vercel.json express/src express/node_modules express/dist
   ```

6. **Anota y limpia.** En la fila S0 del archivo de resultados: cada ajuste que hubo que cambiar (valor propuesto y valor final), la salida completa de `probar.mjs`, los dos estados de `@fs` y la fecha. **PASA** si el build sale con los ajustes de la tabla y encuentra los archivos de fuera de `express/`, las nueve líneas de `probar.mjs` dicen `OK` y el `@fs` en frío da 403 sin `S0_FS_ALLOW` y 200 con `S0_FS_ALLOW=1`. Después borra el proyecto Vercel desechable (Settings → General → Delete Project) y la rama (`git switch main`, `git branch -D spike/express-s0`, `git push origin --delete spike/express-s0`); R7 lo repite al cerrar el spike.

## R4. S1: el e-NCF devuelve el trackId de la fila (owner-run)

Qué mide: si `ConsultaTrackIds` con el e-NCF devuelve el `trackId` que la app guardó en su fila. Es lo que permitiría reconciliar un comprobante que quedó sin respuesta (el POS ya lo hace con `ECFEmissionService::consultarTrackIds`, ver `PosVenta::revisarECF`).

**Solo existe en `testecf` y `ecf`.** Los servicios de consulta por e-NCF no existen en `certecf` (`ECFEmissionService.php` líneas 1160 y 1161; cabecera de `tools/consultar_ecf_dgii.php`): allí responden 404 y una lista vacía, y eso hace la prueba **INVÁLIDA, nunca FALLA**. Por eso la fila que se consulta tiene que ser de `testecf` o `ecf`, y la consulta se hace en ese mismo ambiente. En `ecf` es una consulta de solo lectura: no se emite nada.

1. **Busca una fila de la app (cero emisiones).** En phpMyAdmin, sobre la base del tenant, esta consulta solo lee:

   ```sql
   SELECT id, e_ncf, track_id, estado_dgii, ambiente_dgii FROM facturas WHERE tipo_ecf IN ('31','45') AND estado_dgii = 'ACEPTADO' AND ambiente_dgii IN ('testecf','ecf') ORDER BY id DESC LIMIT 3
   ```

   Si no sale ninguna fila, emite una E31 en `testecf` primero, con R6 (con el tenant en `testecf`), y vuelve a correr la consulta. Las cinco emisiones de R6 sirven.

2. **Pregunta a la DGII por esa fila.** El token del servidor (`CERT_RUN_TOKEN`, está en el `.env` del servidor) va en el cuerpo del POST, no en la URL, y se guarda solo en una variable de tu terminal:

   ```bash
   CERT_RUN_TOKEN=<valor de CERT_RUN_TOKEN en el .env del servidor>
   curl -s -X POST "https://<API host>/api/public/consultar_ecf_dgii.php" --data-urlencode "token=$CERT_RUN_TOKEN" --data-urlencode "tenant_id=<id>" --data-urlencode "ambiente=<ambiente_dgii de la fila>" --data-urlencode "encf=<e-NCF>" --data-urlencode "formato=json"
   ```

   El wrapper usa el ambiente del propio tenant salvo que le pases `ambiente=`; pásalo siempre, con el `ambiente_dgii` de la fila. El POST funciona porque el wrapper lee `$_REQUEST`. Del JSON que devuelve miras dos sitios: `resumen.<e-NCF>.track_ids` y `crudo.<e-NCF>.trackids` (con su `status_code`).

3. **PASA** si la lista trae al menos un `trackId` y uno de ellos es igual al `track_id` de la fila. **FALLA** si la consulta se hizo en el ambiente de la fila (`testecf` o `ecf`) y la lista viene vacía o ningún `trackId` coincide. **INVÁLIDA** si el ambiente consultado fue `certecf` o no era el de la fila. Un `FALLO` de la consulta (token, red, DGII caída) no es veredicto: repítela.

4. **Un número que nunca se usó.** Repite el `curl` con un e-NCF que ese tenant no haya emitido, por ejemplo uno muy por encima de su rango autorizado como `E319999999999`, con el mismo `ambiente=`. Se espera una lista vacía (`track_ids` vacío y `status_code` 404 en `crudo`): es la forma de distinguir "la DGII no lo tiene" de "la consulta falló". Si trae algún `trackId`, es FALLA.

Pega las dos salidas tal cual en el archivo de resultados (no llevan el token). Las E32 de menos de RD$250,000 van por RFCE y no tienen `trackId` (el POS las consulta por código de seguridad, `PosVenta::revisarRFCE`): quedan fuera de este spike.

## R5. S3: notas de crédito E34 contra la DGII, comprador distinto y rechazo (owner-run)

Necesita un tenant en `certecf` con rangos E31 y E34 registrados; gasta unos ocho números en total (S3a: dos E31 y dos E34; S3b: una E31 y una o dos E34). Todo se hace con `tools/express_p0/spike_e34_certecf.php`, desde el checkout del API en la rama `feat/express-backend`. El script lee el ambiente activo del tenant (`GET /api/facturas/stats`, `data.ambiente_activo`) antes de emitir y se niega, con código de salida 2, si no es `certecf` o `testecf`. El token se toma solo de la variable de entorno `EXPRESS_P0_TOKEN`: nunca se pasa como argumento y nunca se imprime. Cada comando acepta `--seco`, que imprime los payloads y no envía nada (ni pide token); úsalo antes de la primera emisión.

Preparación:

1. En la app completa, crea **dos clientes de prueba** (cliente 1 y cliente 2), cada uno con un RNC válido, la `Razón social` llena y el mismo texto en `Nombre`.
2. En tu terminal (el token es el de la app de ese tenant, el mismo que la app manda en `X-API-KEY`; no lo pegues en el chat, en commits ni en el archivo de resultados):

   ```bash
   export EXPRESS_P0_TOKEN=<token de la app de ese tenant>
   S="php -d extension=curl tools/express_p0/spike_e34_certecf.php --api=https://<API host>/api"
   ```

Cada línea que imprime el script es JSON: `ambiente`, `saldo`, `emision`, `consulta_estado` y `resultado`. Llevan el `estado_dgii` y los mensajes de rechazo del servidor tal cual (`error` y `dgii_response` en la emisión, `consulta` en la consulta de estado). Pégalas todas en el archivo de resultados.

**S3a: comprador distinto en la nota.** El nombre del comprador que se manda a la DGII es el primero que no esté vacío entre `razon_social`, `company_name` y `client_name` (`facturaController.php` líneas 358 a 370); `Nombre` solo alimenta el Contacto. Por eso la variante 1 cambia solo la `Razón social` y la variante 2 solo el RNC.

1. Variante 1 (solo la `Razón social`), con el cliente 1:

   ```bash
   $S --client-id=<id del cliente 1> --fase=original
   ```

   Espera a que la línea final diga que la original está lista (la DGII la acepta; el script consulta su estado cada 15 s hasta 10 min) y anota el e-NCF que imprime. En la app cambia **solo** la `Razón social` del cliente 1 (otro texto), sin tocar nada más. Luego:

   ```bash
   $S --client-id=<id del cliente 1> --fase=nota --original=<e-NCF de la original del cliente 1>
   ```

2. Variante 2 (solo el RNC), con el cliente 2:

   ```bash
   $S --client-id=<id del cliente 2> --fase=original
   ```

   En la app cambia **solo** el RNC del cliente 2 (a otro RNC válido). Luego el mismo comando de nota con su e-NCF:

   ```bash
   $S --client-id=<id del cliente 2> --fase=nota --original=<e-NCF de la original del cliente 2>
   ```

3. **Antes de juzgar cada variante**, comprueba en phpMyAdmin que el cambio sí llegó al XML. La E34 tiene que llevar el comprador nuevo y la original el viejo; la consulta solo lee (el e-NCF de la E34 sale en la línea `emision` de la fase `nota`):

   ```sql
   SELECT id, e_ncf, SUBSTRING(xml_firmado, LOCATE('<RazonSocialComprador>', xml_firmado), 120) AS razon_social_comprador, SUBSTRING(xml_firmado, LOCATE('<RNCComprador>', xml_firmado), 40) AS rnc_comprador FROM facturas WHERE e_ncf IN ('<e-NCF de la original>', '<e-NCF de la E34>')
   ```

   Variante 1: cambia `RazonSocialComprador`. Variante 2: cambia `RNCComprador`. Si los dos XML dicen lo mismo, la corrida es **inválida** (el cambio no llegó al XML) y no se juzga: repítela.

4. Anota por variante el `estado_dgii` final, los mensajes de rechazo y las lecturas de saldo (`antes` y `despues`). ACEPTADO y RECHAZADO son los dos resultados válidos de S3a: el spike mide lo que hace la DGII, no tiene un lado correcto. Al terminar, restaura o borra los dos clientes de prueba.

**S3b: nota rechazada y saldo de la original.** Usa un cliente de prueba con sus datos sin tocar (el cliente 1, ya restaurado, sirve): el comprador de la original y el de las notas tiene que ser el mismo.

```bash
$S --client-id=<id del cliente> --fase=original
$S --client-id=<id del cliente> --fase=reintento --original=<e-NCF de la original>
```

`reintento` manda primero una E34 con la fecha de vencimiento de la secuencia en `31-12-2000` para que la DGII la rechace y, **solo si la DGII la RECHAZA**, manda una segunda E34 normal por el monto completo. Imprime tres lecturas del saldo de la original, `GET /api/facturas/modificables?client_id=<id>&query=<e-NCF>&limit=1`: `antes`, `entre` (con el rechazo ya resuelto) y `despues`.

- **PASA** si el saldo `entre` es igual al de `antes` (la nota rechazada no resta nada) y la segunda E34 queda ACEPTADA (el saldo `despues` baja a 0).
- Si la nota de la secuencia vencida no queda RECHAZADA, el script no manda la segunda E34 y sale con código 3. Lo que imprime depende del estado y hay que leerlo bien, porque cada caso se anota distinto. Lee `estado_dgii_forzada` en la línea `resultado` (el mismo estado sale en la línea `emision` de esa nota) antes de escribir el motivo:
  - **`INCONCLUSO: la DGII acepto la secuencia de 2000`** (`estado_dgii_forzada` = `ACEPTADO`): la DGII aceptó la nota de la secuencia vencida, la original ya quedó acreditada por completo y una segunda E34 la habría rechazado el propio API (`validarFacturaModificada`, `facturaController.php` línea 881). Se anota como **NO EJECUTADA (la DGII aceptó la nota de la secuencia de 2000)**, nunca como PASA. Para volver a intentarlo hace falta una original nueva (otra `--fase=original`).
  - **`SIN VEREDICTO: ... estado_dgii=<estado>`** (cualquier otro estado): la DGII no aceptó nada que se sepa; la nota no llegó a un RECHAZADO y no se puede juzgar el saldo. Se anota como **NO EJECUTADA (la nota de 2000 quedó en `<estado>`)**, con el estado tal cual, nunca como PASA ni como "la DGII aceptó". Qué sigue según el estado:
    - `ERROR`: esa nota no cuenta en el saldo (la regla `ESTADOS_NOTA_VIGENTE`, `facturaModel.php` línea 60, deja fuera ERROR), así que la original conserva su saldo si la lectura `entre` es igual a `antes`; en ese caso puedes repetir `--fase=reintento` con la misma original.
    - `EN_PROCESO` o `ENVIADO` tras los 10 minutos de espera: la nota reserva saldo mientras no se resuelva; no repitas `reintento` con esa original, revisa Facturación (filtro Pendientes) y, si no se resuelve, usa una original nueva.
    - `ACEPTADO_CONDICIONAL`: cuenta en el saldo como una aceptada, así que la original ya no sirve para repetir; usa una original nueva.

Anota por corrida el `estado_dgii`, los mensajes de rechazo y las tres lecturas de saldo.

## R6. S2c: latencia de una emisión completa (owner-run)

Mide cuánto tarda `POST /api/facturas` de punta a punta (tu terminal, el API, la DGII y la respuesta). Va con un tenant en `testecf` o `certecf`. Corre desde el checkout del API en la rama `feat/express-backend` (usa `tools/express_p0/e31_minimo.json`).

1. Define las variables y mira el ambiente activo. **Si `ambiente_activo` dice `ecf`, detente:** estas emisiones serían facturas fiscales reales.

   ```bash
   TOKEN=<token de la app del tenant>
   CLIENT_ID=<id de un cliente con RNC válido; el cliente de prueba de R5 sirve>
   curl -s -H "X-API-KEY: $TOKEN" https://<API host>/api/facturas/stats
   ```

2. Cinco emisiones, una tras otra (cada una usa un número del rango E31 del ambiente):

   ```bash
   for i in 1 2 3 4 5; do
     curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -X POST https://<API host>/api/facturas -H "X-API-KEY: $TOKEN" -H 'Content-Type: application/json' --data "$(sed "s/__CLIENT_ID__/$CLIENT_ID/" tools/express_p0/e31_minimo.json)"
   done
   ```

   Cada línea es `<código HTTP> <segundos>`. Pega las cinco y anota el **mínimo, la mediana y el máximo** de los segundos. Si alguna no responde 200, anótalo y repite esa para tener cinco emisiones completas (con `-o /dev/null` no se ve el cuerpo; quítalo para ver el error).

Esta medición incluye tu red hasta el API; la latencia del host a la DGII sola es la de R2, paso 4.

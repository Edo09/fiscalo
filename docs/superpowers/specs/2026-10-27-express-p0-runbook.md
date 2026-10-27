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

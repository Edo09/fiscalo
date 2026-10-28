# Resultados de P0 de Fiscalpoint Express

Fecha de la plantilla: 2026-10-28. Es el único sitio donde se anotan los resultados de los spikes de P0: el runbook (`2026-10-27-express-p0-runbook.md`, secciones R1 a R7) dice cómo correrlos y los planes de Express leen de aquí si pueden empezar (la columna `Bloquea` dice cuáles). Los ids de la tabla (S0, S1, S2a, S2b, S2c, S3a y S3b) son los de la tabla "Ids de los spikes" del runbook.

## Cómo se llena

- `Resultado` empieza en `PENDIENTE` y pasa a `PASA`, `FALLA` o `NO EJECUTADA (motivo)`.
- Una corrida inválida no es un veredicto: la consulta de S1 hecha en `certecf`, el cambio de comprador de S3a que no llegó al XML, un latido de S2a que el hosting no pudo escribir. Se repite, la fila sigue en `PENDIENTE` y el motivo va en su `Detalle`.
- Un spike que no puedes correr dice `NO EJECUTADA (motivo)` y su compuerta (la columna `Bloquea`) sigue cerrada.
- S1 tiene que decir `PASA` o `FALLA`, nunca `PENDIENTE`, antes de que el plan 08 pueda empezar.
- `Fecha y quien`: `AAAA-MM-DD, nombre`.
- Pega cada salida tal cual en el `Detalle` de su spike y nunca un token (ni el de la sonda, ni `CERT_RUN_TOKEN`, ni `EXPRESS_P0_TOKEN`, ni el de la app).
- Las respuestas D1 a D8 van en su sección y tu firma va al final. Con la tabla sin `PENDIENTE` y la firma puesta se cumple lo que el chequeo de salida de P0 pide de este archivo; los planes 02 y 06 no empiezan antes de que ese chequeo pase.

## Tabla de spikes

| Spike | Pregunta | Criterio de paso | Resultado | Fecha y quien | Bloquea | Si falla (diseño 14) |
|---|---|---|---|---|---|---|
| S0 | ¿Vercel construye y sirve `express/` como proyecto aparte, con las opciones previstas y los rewrites de `express/vercel.json`, y sostiene un POST de 60 s por el rewrite externo? | El build sale con Root Directory `express/` y encuentra los archivos de fuera de esa raíz; `/` sirve el título de S0; `/api/public/x` da 404; `/facturas` sirve el shell; la cabecera propia (`x-express-s0`) está presente; un POST de 60 s por el rewrite externo da 200; en desarrollo, en la primera petición en frío a un servidor recién arrancado, `@fs` da 403 sin `S0_FS_ALLOW` y 200 con ella | PENDIENTE |  | planes 06 y 07 | F1 (los mismos ajustes desde la raíz del repo, con el shell emitido como `app.html`) solo con un bloque `headers` acotado al host en el `vercel.json` de la raíz y con aprobación del dueño. Si el POST de 60 s muere: acortar `DGII_TIMEOUT_SEG` (plan 03) y el tiempo límite del cliente (plan 07); si no basta, llamar directo al origen del API y ampliar `connect-src` del CSP a ese único origen |
| S1 | ¿`ConsultaTrackIds` por e-NCF devuelve el `trackId` que la app guardó en su fila, y una lista vacía para un número que nunca se usó? | `ConsultaTrackIds` por e-NCF devuelve un `trackId` igual al `track_id` de la fila de la app; un número sin usar devuelve una lista vacía | PENDIENTE |  | plan 08 | El plan 08 no se ejecuta; las filas sin confirmar se resuelven con el runbook de soporte y el portal de la DGII; el piloto sigue en `testecf`; `capacidades.reconciliador` queda en false; salir a producción solo con el runbook lo decide el dueño |
| S2a | ¿Qué límites de tiempo tiene el hosting (`max_execution_time`, `disable_functions`) y sigue vivo el proceso PHP cuando el cliente se desconecta? | `set_time_limit` funciona (no está en `disable_functions`), una petición de 130 s termina, y el proceso llega hasta el final cuando el cliente se va a los 3 s (hay línea `FIN`) con `ignorar=0` y con `ignorar=1` | PENDIENTE |  | planes 03, 04 y 08 | Dimensionar `DGII_TIMEOUT_SEG` por debajo del límite del hosting; aceptar más envíos sin confirmar; subir la prioridad del plan 08 |
| S2b | ¿En qué zona horaria trabajan PHP y MySQL en el hosting y cuánto se alejan de `America/Santo_Domingo`? | Las zonas de PHP y de MySQL quedan anotadas con su desfase respecto de `America/Santo_Domingo` (UTC-4) | PENDIENTE |  | plan 03 (alineación del reloj) | Fijar la zona explícitamente para los tenants restringidos y registrar la zona usada |
| S2c | ¿Cuánto tarda una emisión completa contra la DGII, de punta a punta? | Cinco emisiones anotadas con el mínimo, la mediana y el máximo en segundos | PENDIENTE |  | planes 03 (`DGII_TIMEOUT_SEG`) y 07 (tiempo límite del cliente) | Mantener 15 s solo si el peor caso queda bien por debajo; si no, subirlo y revisar de nuevo con S0 el presupuesto del POST de 60 s |
| S3a | ¿Acepta o rechaza la DGII una E34 cuyo comprador difiere del de la factura original? | Veredicto anotado para la variante de solo la `Razón social` y para la de solo el RNC, cada una con el comprador cambiado visible en el XML guardado, y los mensajes de la DGII | PENDIENTE |  | plan 07 (Anular) | Mantener la guarda como bloqueo (lo seguro) y volver a derivar la regla del saldo con el resultado de certecf antes de P4 (diseño 14). El archivo de contratos dice en cambio que la guarda "se vuelve un aviso": ese conflicto lo resuelve el dueño (ver "Contract changes" del plan 01); mientras tanto el bloqueo se queda |
| S3b | ¿Una E34 rechazada queda fuera del saldo de la original, y se puede emitir después otra por el monto completo? | Tras una E34 rechazada la lectura del saldo no cambia y una segunda E34 por el monto completo queda ACEPTADA; una corrida `INCONCLUSO` (salida 3: la DGII aceptó la nota de rechazo forzado) se anota como `NO EJECUTADA (motivo)`, nunca como `PASA` | PENDIENTE |  | plan 07 (Anular) | Volver a derivar la regla del saldo y quitar "Reintentar anulación" |

## Detalle

Una subsección por spike, con lo que hay que pegar de R1 a R6. Cada línea dice qué anotar: escribe la respuesta debajo de ella y pega las salidas de los comandos, tal cual, en los bloques vacíos.

### S0: proyecto Vercel de `express/` (R3)

Ajustes que hubo que cambiar respecto de lo que Vercel proponía (valor propuesto y valor final) y Framework Preset que quedó:

Registro del build (`npm ci` en la raíz del repo, `vite build` con `built in`, despliegue `Ready`) y los avisos que hayan salido, por ejemplo sobre `engines.node`:

Salida completa de `probar.mjs` (las nueve comprobaciones y el resumen); si una espera falló, cuál fue (N):

```text
```

Estado de `@fs` en la primera petición en frío (servidor recién arrancado, antes de abrir nada en el navegador):

- Sin `S0_FS_ALLOW`:
- Con `S0_FS_ALLOW=1`:

Nota sobre `@fs`: un import estático de `src/` hecho desde un módulo que el servidor ya sirvió funciona en desarrollo aun sin `fs.allow` (Vite lo da por seguro en `config.safeModulePaths`; comprobado con Vite 6.4.3: después de servir `/src/main.ts` del stub, el mismo `/@fs/` pasa de 403 a 200 sin `S0_FS_ALLOW`), así que esta parte de S0 no prueba que el ajuste haga falta. El plan 06 conserva `fs.allow: ['..']` sea cual sea el resultado.

### S1: `ConsultaTrackIds` por e-NCF (R4)

Fila de la app que se consultó (`id`, `e_ncf`, `track_id`, `estado_dgii`, `ambiente_dgii`):

Ambiente en el que se hizo la consulta (`testecf` o `ecf`, el mismo de la fila; en `certecf` la prueba es INVÁLIDA, no FALLA):

Salida de la consulta por el e-NCF de la fila (`resumen.<e-NCF>.track_ids` y `crudo.<e-NCF>.trackids` con su `status_code`):

```text
```

Salida de la consulta por un número que nunca se usó (se espera `track_ids` vacío y `status_code` 404 en `crudo`):

```text
```

### S2a: límites del hosting y desconexión del cliente (R1 y R2)

`info` de la sonda (`max_execution_time`, `disable_functions`, `functions`, `memory_limit`, `open_basedir`, `temp_dir`, `temp_writable`):

```text
```

Petición de 130 s (`limite&seg=130&id=aaaa0001`): respuesta completa (`reached_seconds`, `heartbeat_inicio_ok`, `heartbeat_writes_failed`) y segundos que tardó. Si el hosting la cortó antes, el tiempo que tardó y la lectura del latido (`leer&id=aaaa0001`):

```text
```

El cliente se va a los 3 s con `ignorar=0` (`aaaa0002`): lectura completa de `leer`, con `FIN` o sin él, incluidos `archivo`, `temp_writable` e `inconclusivo`:

```text
```

El cliente se va a los 3 s con `ignorar=1` (`aaaa0003`): lectura completa de `leer`:

```text
```

Cierre (R7): salida de `curl -s -w '\n%{http_code}\n' "$P?paso=info"` después de borrar la sonda:

```text
```

### S2b: zonas horarias de PHP y MySQL (R1 y R2)

Zona de PHP (`php_default_timezone`, `ini_date_timezone`, `php_date_c`):

Zona de MySQL (`mysql.mysql_now`, `mysql.mysql_utc`, `mysql.global_time_zone`, `mysql.session_time_zone`, `mysql.system_time_zone`; si `mysql` trajo solo `error`, el resultado de la consulta de phpMyAdmin de R2):

Desfase de cada una respecto de `America/Santo_Domingo` (UTC-4):

### S2c: latencia hacia la DGII (R2 paso 4 y R6)

Latencia del host a la DGII (R2, paso 4: los cinco GET con segundos de conexión, segundos totales y código HTTP; si algún intento trae `curl_errno` distinto de 0, con su `curl_error`):

```text
```

`ambiente_activo` del tenant y las cinco emisiones de R6 (`<código HTTP> <segundos>`, una por línea):

```text
```

Mínimo, mediana y máximo en segundos:

### S3a: E34 con un comprador distinto (R5)

Variante 1 (solo la `Razón social`, cliente 1): e-NCF de la original y de la E34, y las líneas JSON que imprimió el script (`ambiente`, `saldo`, `emision`, `consulta_estado`, `resultado`):

```text
```

Variante 1: consulta del XML guardado (`RazonSocialComprador` de la original y de la E34; si dicen lo mismo, la corrida es inválida y se repite):

```text
```

Variante 1: `estado_dgii` final, mensajes de rechazo de la DGII y lecturas de saldo (`antes` y `despues`):

Variante 2 (solo el RNC, cliente 2): e-NCF de la original y de la E34, y las líneas JSON que imprimió el script:

```text
```

Variante 2: consulta del XML guardado (`RNCComprador` de la original y de la E34; si dicen lo mismo, la corrida es inválida y se repite):

```text
```

Variante 2: `estado_dgii` final, mensajes de rechazo de la DGII y lecturas de saldo (`antes` y `despues`):

Veredicto por variante (ACEPTADO y RECHAZADO son los dos resultados válidos: el spike mide lo que hace la DGII):

### S3b: E34 rechazada y saldo de la original (R5)

Salida de `--fase=original` (e-NCF de la original) y de `--fase=reintento` (líneas `emision`, `consulta_estado` y `resultado`):

```text
```

Lecturas del saldo de la original (`antes`, `entre` y `despues`):

`estado_dgii_forzada` (la nota con la secuencia de 2000), `estado_dgii` de la segunda E34 y código de salida del script (0 o 3):

Si salió con código 3, el motivo tal cual (`INCONCLUSO` o `SIN VEREDICTO`, con su estado), que es el que va en la fila como `NO EJECUTADA (motivo)`:

## Respuestas del dueño

Una línea por decisión de la sección 17 del diseño (D1 a D8). Cada línea trae el supuesto con el que están escritos los planes (contratos, sección 1) y qué plan cambia si tu respuesta es otra. Escribe tu respuesta en lugar de `(sin respuesta)`; mientras la línea lo diga, el supuesto sigue valiendo. Las que cambian código tienen que estar anotadas antes de que arranque el plan que cambian: D8 y D1 antes del plan 02, D6 antes del plan 03 y D2 antes del plan 07.

D1: (sin respuesta) Comprobantes de Express. Supuesto: ventas E31, E32 y E45; E34 derivada para anular; E33 opcional por tenant, sin pantalla; E41, E43, E44, E46 y E47 fuera (si un tenant objetivo necesita alguno de ellos, Express no es su edición). Cambia los planes 02, 03 y 07. Solo se puede responder cuando el tenant del piloto tiene nombre (D8).
D2: (sin respuesta) Precios. Supuesto: neto con ITBIS encima, rotulado "+ ITBIS" (la E45 no admite precios con ITBIS incluido). Con precios finales hay que diseñar antes un interruptor por tenant. Cambia los planes 03, 07 y 09.
D3: (sin respuesta) Seguridad antes de un piloto público. Supuesto: estos planes solo cubren la parte (a), que alcanza a los tenants Express (vence a los 30 días sin uso y se revocan los tokens al cambiar la contraseña; planes 02 y 05); el límite de intentos del login y el cierre de `/api/public` (partes b y c) son PRs aparte y no cambian estos planes.
D4: (sin respuesta) Certificación DGII de cada emisor nuevo. Supuesto: se certifica como `completa` en `certecf` con la herramienta existente y después se convierte; los datos de `certecf` nunca bloquean la conversión. Quién la corre y cuándo condiciona P8, no estos planes.
D5: (sin respuesta) Lo que solo tú puedes dar: un cron de cPanel, un host estable del API, el proyecto Vercel y el DNS, y un número de WhatsApp de soporte (sin él se ocultan las filas de soporte). Cambia los planes 06 y 08 y P8.
D6: (sin respuesta) Orden de compra del comprador E45 y notas de crédito parciales. Supuesto: las dos diferidas. Cambia los planes 03 y 07 (ver "Preguntas al dueño").
D7: (sin respuesta) Respuestas del contador. Supuesto: bloquean la disponibilidad general, no el piloto. No cambia ningún plan.
D8: (sin respuesta) Tenant del piloto. Supuesto: un tenant NUEVO; la conversión de uno `completa` existente es la última tarea, opcional, del plan 02. Si es uno existente, esa tarea pasa a ser obligatoria y va antes de cualquier despliegue. Cambia el plan 02 y P8.

## Preguntas al dueño

Para D6 (cambia los planes 03 y 07, así que hace falta antes de que arranque el 03): pregunta a un cliente real de E45 si el "orden de compra" del comprador tiene que salir en el documento y si necesita notas de crédito parciales. Lo primero exige un cambio en el backend (claves nuevas en la lista blanca de `sanearEntrada` del plan 03 y en el payload del plan 07); lo segundo cuesta unos 3 días más en el plan 07. Las dos quedan diferidas mientras no haya respuesta. Anota lo que conteste en la línea D6 de arriba.

## Cierre de P0

Esta línea cierra el archivo: nombre y fecha al firmar, una vez que R1 a R7 estén hechos, la tabla no tenga ninguna fila en `PENDIENTE` y las respuestas D1 a D8 estén anotadas.

Firma del dueño:

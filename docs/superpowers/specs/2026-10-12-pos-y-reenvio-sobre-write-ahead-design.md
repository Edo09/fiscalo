# POS y «Reenviar a la DGII» sobre el write-ahead: diseño

Fecha: 2026-10-12. Complementa `2026-10-05-ecf-write-ahead-design.md` (Release 1, terminado en la rama `feat/ecf-write-ahead` de ambos repos y aún sin integrar). Las decisiones de este documento prevalecen sobre esa spec donde no coincidan.

## 1. Objetivo

Integrar Release 1 con lo último de `master` (API) y `main` (front) sin perder su garantía: **toda factura se guarda en la base antes de enviarse a la DGII**.

`master` agregó dos cosas que todavía guardan *después* de enviar:
- la venta del POS (`src/Pos/PosVenta.php`);
- el reenvío de facturas rechazadas (commit `4007eea`).

Además, `PosVenta.php` llama a `facturaModel::saveFacturaConECF`, que Release 1 elimina. Si se integra sin adaptar, la venta del POS falla con un error fatal.

## 2. Alcance

**Dentro:**
- el merge de `master`/`main` en las dos ramas;
- la venta del POS sobre el gancho write-ahead, que nunca se detiene: factura simple si falla el certificado, número siguiente si se agota la secuencia;
- los avisos al admin en la app;
- tres arreglos al reenvío automático que ya trae el POS;
- «Reenviar a la DGII» para rechazadas, sobre el write-ahead;
- los cambios mínimos de front;
- las pruebas.

**Fuera:**
- envío en segundo plano, cron, reconciliador (Release 2) y migraciones nuevas;
- reintento automático para facturas de la app;
- comprobantes de Gastos (E41/E43/E47);
- integraciones (`/api/integracion`), que siguen síncronas y sin base propia.

## 3. Decisiones del usuario

| # | Fecha | Decisión |
|---|-------|----------|
| U1 | 10-12 | Solo se pide que la factura se guarde primero en la base y luego se envíe a la DGII. Se descartan el envío asíncrono, el cron, Release 2 y la migración 035. |
| U2 | 10-12 | Facturas de la app: quedan como Release 1. Se guardan, se envían en la misma petición y se anota la respuesta. Si la DGII no contesta, la factura queda «sin confirmar» y la resuelve soporte (procedimiento 10.2). |
| U3 | 10-12 | El POS nunca se detiene por la DGII y el cajero no ve nada de la DGII. Reemplaza la decisión del 10-09 que trataba `ERROR`/`NO_ENCONTRADO` al vender como venta no emitida. |
| U4 | 10-12 | El recibo del POS se imprime igual que una factura normal, haya respondido la DGII o no. |
| U5 | 10-08 / 10-12 | Las ventas del POS sin confirmar las termina el reenvío automático del POS: consulta primero, reenvía el XML guardado y nunca re-firma. No hay botón para el cajero. |
| U6 | 10-12 | Se mantiene «Reenviar a la DGII» para rechazadas (commit `4007eea`). Se pidió porque una factura fue rechazada por una fecha mal escrita, y reemitir con los datos de la rechazada es más fácil que esperar a un desarrollador. |
| U7 | 10-12 | La decisión 7 de Release 1 queda así: la app **nunca** reenvía una factura *sin confirmar*. **Sí** puede reemitir una *rechazada*. |
| U8 | 10-12 | Una venta del POS no se detiene por nada: ni por falta de certificado ni por secuencia agotada. El certificado no decide si hay venta o no. |
| U9 | 10-12 | Si el certificado falla, o cualquier otra cosa impide generar el e-CF, la venta sale **automáticamente** como **factura simple**: la factura interna que ya existe, sin e-NCF, sin ITBIS y sin envío a la DGII. El cajero no ve nada; el admin ve un aviso en la app. |
| U10 | 10-12 | Si la secuencia se agota (o vence), la venta usa el **número siguiente al último**, se guarda como e-CF y se imprime. **No se envía** hasta que exista un rango autorizado registrado que incluya ese número; en ese momento la manda el reenvío automático del POS. La app avisa cuando quedan pocos números y cuando se agotan. |

## 4. Diseño

### 4.1 Merge

**API**, contra `origin/master` (al 10-12: `c594c10`):
- `facturaModel.php`:
  - Se queda nuestra versión, sin `saveFacturaConECF`, con fin de línea **LF** (como `master` desde `ee89b6d`).
  - Se traen los cambios reales de `master`: `dias_credito` (migración 033), `tomarLockReenvio` y `archivarRechazoReenviado`.
  - Las columnas del POS entran en la reserva (4.2).
- `ECFEmissionService.php`:
  - Queda el flujo write-ahead.
  - Se traen de `master` `formas_pago` en el XML, `dgii_timeout` como opción del envío, `reenviarRFCE`, `consultarTrackIds` y `reenviarECF`.
  - Se elimina `tolerar_fallo_envio` con sus estados `RFCE_PENDIENTE`/`ENVIO_PENDIENTE`. En producción no hay ninguna fila con esos estados (verificado el 10-09).
- `facturaController.php`: se queda nuestro flujo de emisión, con el `$reenvioDe` de `master` (4.4).
- `inventoryModel.php`: se traen `devolverSaldoDeFactura` (de `master`) y `yaMovioDocumento` (nuestro).
- Migraciones: las 033/034 de `master` entran tal cual. Esta entrega no agrega ninguna.

**Front**, contra `origin/main`:
- `errores.ts` y `types.ts`: unión de ambos lados.
- `mappers.ts`: se queda el nuestro, porque `dgiiLabel`/`isRechazo` viven en `estadosDgii.ts`.

**Momento del merge:** se hace al empezar la implementación y se repite justo antes de integrar.

### 4.2 Venta del POS (`PosVenta::cobrar`)

1. **Validaciones, clave e idempotencia sin cambios:** candado de la clave, búsqueda por `pos_idempotency_key` antes de emitir, candado del turno y totales.
2. **Emisión con el gancho** `reservar`/`confirmar`/`incierto`, igual que `handleEmisionECF`.
   - `reservarFacturaECF` agrega al INSERT `pos_idempotency_key`, `turno_id`, `pos_empleado_id` y `envio_pendiente = 1`. Lo hace solo cuando `$factura['pos']` viene, como `master`.
   - Un 1062 sobre `uk_facturas_pos_idem` es una venta repetida: se relee por clave y se responde como repetida. Un 1062 sobre el e-NCF sigue siendo `EcfNumeroOcupadoException`.
3. **Opciones del payload solo para el POS:**
   - `dgii_timeout` = `POS_DGII_TIMEOUT` (5 s);
   - `formas_pago`;
   - `reclamar_secuencia = false`: el número de una venta del POS nunca vuelve al contador, porque ya está impreso;
   - `autenticar_despues_de_reservar = true`: el token de la DGII se pide después de guardar. Si la DGII no responde al pedirlo, la venta queda guardada «sin confirmar» en vez de fallar (U3).
   - `numerar_sin_rango = true`: si ningún rango vigente tiene números libres, se usa el siguiente al último y la venta no se envía (punto 6).

   Para la app nada cambia: el token se sigue pidiendo antes de guardar. Así, con la DGII caída, la factura no se crea y se reintenta después, sin dejar trabajo a soporte.
4. **Cualquier resultado después de guardar se entrega** (U3, U4): aceptada, rechazada, `ERROR`, `NO_ENCONTRADO`, en proceso o sin respuesta (`EcfEnvioInciertoException`). La respuesta es 201 con el recibo.
5. **Fallo antes de guardar: factura simple automática** (U8, U9).
   - **Cuándo aplica:** si el e-CF no se puede generar. Ejemplos: certificado ausente, vencido o con clave incorrecta; fallo de firma; `emisor_config` incompleto; cualquier excepción antes de la reserva, que ya devuelve el número al contador.
   - **Qué hace:** la venta se guarda como **factura simple** (`tipo_ecf` nulo) con las mismas líneas y el mismo total, y con las columnas del POS (clave, turno, empleado), así que la idempotencia sigue igual. La entrega es la misma (punto 7: caja, inventario, auditoría) y la respuesta es 201 con el recibo de factura simple.
   - **Aviso:** se registra un evento de auditoría para el aviso del admin (4.6). El cajero no ve nada distinto.
   - **Excepciones:** las validaciones de la venta (total distinto, cliente E31 sin RNC, efectivo insuficiente…) siguen respondiendo 4xx, porque son errores de captura, no de emisión.
   - **Lo único que todavía detiene una venta** es que el servidor o la base de datos no estén disponibles, porque no hay dónde guardarla. Vender sin conexión queda fuera de alcance.
6. **Secuencia agotada o vencida** (U10).
   - **Cuándo aplica:** solo en el POS, cuando ningún rango vigente tiene números libres.
   - **Qué hace:** la venta toma el **número siguiente al último usado** de ese tipo y ambiente, y el contador sigue avanzando. Se firma, se guarda y se imprime normal, marcada en su meta como `sin_rango`, y **no se envía**: la DGII rechaza los números fuera de un rango autorizado.
   - **E32:** el XML no lleva fecha de vencimiento de la secuencia, así que queda listo para enviarse tal cual.
   - **E31:** el XML lleva la fecha del último rango conocido. Si la DGII la rechaza al enviarla, se reemite con «Reenviar a la DGII» (4.4).
7. **Entregar es una sola función idempotente** (`entregarVenta`), que se ejecuta bajo el candado de la clave:
   - el movimiento de caja, si la factura aún no tiene uno;
   - el inventario una sola vez (`yaMovioDocumento('factura', id)` + `registrarVenta`);
   - la auditoría `POS_VENTA`.

   Una venta repetida con la misma clave devuelve la misma venta y completa lo que falte, por ejemplo si el servidor cayó entre guardar y registrar la caja.
8. **`envio_pendiente`** se escribe en la **misma sentencia** que `estado_dgii`, y solo en filas del POS (`pos_idempotency_key IS NOT NULL`):
   - en la reserva: `1`;
   - en `confirmar`: `1` si el veredicto sigue abierto (`ENVIADO`, `EN_PROCESO`, `RFCE_ENVIADO`, `RFCE_EN_PROCESO`); `0` en cualquier otro caso;
   - en `incierto`: `1`.
9. **El recibo** usa `RepresentacionImpresa::datosRecibo`, que no lee `estado_dgii`. Regla: el recibo nunca depende del estado de la DGII.
10. **Rechazo de una venta ya entregada**, al cobrar o más tarde:
   - la caja y el inventario quedan;
   - el número no vuelve al contador;
   - el cierre la lista como rechazada;
   - en la app aparece «Rechazada» con «Reenviar a la DGII» (4.4).

### 4.3 Reenvío automático del POS (`PosVenta::reenviarPendientes`)

Se conserva tal como está en `master`: lo dispara la pantalla del POS al abrir, cada 2 minutos y tras cada venta; consulta primero, reenvía el XML guardado, no re-firma y no devuelve números. Recibe cuatro arreglos:
1. **Flujo por XML guardado:** RFCE si `rfce_xml` no es nulo, e-CF completo si no. Hoy se decide por el prefijo `RFCE_` del estado, y las filas `PENDIENTE_ENVIO`/`ENVIO_INCIERTO` no lo tienen.
2. **Selección:** filas del POS con `envio_pendiente = 1`, que incluye las de 4.2.8. Se excluyen las `PENDIENTE_ENVIO` de menos de 2 minutos, porque la venta todavía está en curso.
3. **Escrituras con compare-and-set:** `UPDATE ... WHERE id = :id AND estado_dgii = :leido`, con `envio_pendiente` en la misma sentencia. Nunca pisa un estado final escrito por otro proceso.
4. **Sin cambios en la respuesta** (`revisadas`, `aceptadas`, `rechazadas`, `pendientes`): el front del POS la usa.
5. **Ventas `sin_rango` (4.2.6):** se saltan hasta que exista un rango autorizado registrado que incluya su número. A partir de ahí se envían como cualquier otra pendiente.

### 4.4 «Reenviar a la DGII» para rechazadas (`handleReenviar`, de `4007eea`)

- **Mismas condiciones que `master`:**
  - solo e-CF;
  - estado `RECHAZADO`, `RFCE_RECHAZADO` o `NO_ENCONTRADO`, no archivado;
  - `secuencia_utilizada` distinta de 1;
  - mismo ambiente;
  - con líneas guardadas;
  - un candado por factura (`tomarLockReenvio`).
- **Sale por la emisión write-ahead de la app** (`handleEmisionECF` con `$reenvioDe`): guardar, enviar, anotar.
- **Mismo número:** se pasa `e_ncf` = el e-NCF de la rechazada. La reserva archiva la rechazada del mismo número (la regla de reintentables de Release 1). `archivarRechazoReenviado` queda como respaldo.
- **Inventario:** se descuenta la nueva según las reglas de Release 1, y `devolverSaldoDeFactura` devuelve lo que la vieja haya movido. En Release 1 una rechazada no mueve inventario, así que para la app eso suele ser 0. Sí aplica a ventas del POS y a filas anteriores.
- **Guardas de Release 1 que se ajustan:** las pruebas y documentos que exigían «`POST /reenviar` responde 501» y «no hay botón Reenviar» pasan a exigir que **una factura sin confirmar nunca se reenvía desde la app**. `POST /reenviar` sobre `PENDIENTE_ENVIO`, `ENVIO_INCIERTO`, `ENVIADO` o `EN_PROCESO` responde 409.

### 4.5 Front

- **POS** (U3): sin rastro de la DGII para el cajero.
  - Se quita el aviso de `CobroModal` («la DGII no respondió a tiempo…»).
  - Se quita el contador «N sin confirmar DGII» de `VentaView`.
  - Las listas del POS (ventas del día, turno, cierre) no muestran estados de la DGII.
  - La llamada a `/pos/pendientes/reenviar` cada 2 minutos sigue, en silencio.
- **App:** se mantiene el botón «Reenviar a la DGII» de `main` en el detalle de una rechazada, junto con lo que agregó Release 1 (filtro Pendientes, indicador Sin confirmar, tarjeta en vuelo).
- **Recibo de factura simple:** el POS imprime el formato de factura simple cuando la venta salió así (4.2.5).

### 4.6 Avisos al admin (solo en la app, nunca en la caja)

Un aviso en el panel de e-CF de la app, visible para quien administra:
- **«El certificado falló: N ventas del POS salieron como factura simple»**, desde la primera venta de hoy que salió así.
- **«Quedan pocos números»** para un tipo de e-CF, cuando el rango vigente tiene 50 o menos libres; y **«Secuencia agotada»** cuando ya no tiene.
- **«N ventas esperando un rango autorizado»**: las ventas `sin_rango`. Se enviarán solas al registrar el rango.

## 5. Pruebas

1. **Suites de Release 1** (puro, reservar/confirmar, e-CF, API, compuerta, mock) en verde después del merge, con las guardas de 4.4 ajustadas.
2. **Casos nuevos en el arnés del write-ahead:**
   - la reserva con columnas del POS;
   - `envio_pendiente` sincronizado en reserva, `confirmar` e `incierto`;
   - `reclamar_secuencia = false` no devuelve el número;
   - `autenticar_despues_de_reservar` con la DGII caída deja la venta guardada y sin confirmar;
   - el 1062 de la clave del POS se trata como venta repetida;
   - la reemisión con el mismo e-NCF archiva la rechazada;
   - el recibo de una venta sin confirmar es igual al de una aceptada;
   - con el certificado fallando, la venta sale como factura simple, con caja, inventario y clave de idempotencia;
   - con la secuencia agotada, la venta usa el número siguiente, queda `sin_rango` y no se envía;
   - el reenvío del POS salta las `sin_rango` hasta que se registra un rango que las cubre, y entonces las envía;
   - los datos de los avisos de 4.6.
3. **Suites del POS de `master`** (backend 100, venta 48, cierre 50, e31 35) en las bases scratch existentes:
   - **Distribución de bases:** el rol master va en `smhynzte_wa_scratch_sin_gate`, con las tablas master mínimas (`tenants`, `pos_equipos`, `pos_handoff_codes`, `tenant_id` en `users`/`api_tokens`, `permite_decimales`). El tenant A es `smhynzte_wa_scratch` y el tenant B es `sin_gate`.
   - **Preparación:** un script idempotente con guarda: solo corre sobre bases marcadas y con nombre `*_scratch`. La copia `sin_gate` conserva su estado sin 027/028.
   - **Línea base:** primero una corrida contra `master` sin tocar, para probar el entorno. Después, la corrida contra la rama integrada, con las expectativas actualizadas a esta spec. Las expectativas cambian así:
     - el estado tras un timeout pasa a ser `ENVIO_INCIERTO` en lugar de `RFCE_PENDIENTE`/`ENVIO_PENDIENTE`;
     - un rechazo al cobrar responde 201 y entrega, en lugar de 422.
4. **Front:** typecheck, build y los scripts en verde. Lint, salvo el `ds-bundle` que ya falla en `main`; se arregla aparte.

## 6. Riesgos y pendientes

- **Entrega antes del veredicto:** entregar una venta del POS antes de que la DGII la valide es la pregunta Q1 al contador de la spec del POS, con fecha 21-10. Este diseño no la cambia.
- **QR de una reemisión:** si una venta del POS se reemite con el mismo número, el QR del papel original tiene el código de seguridad de la primera firma y no validará en la DGII. Es aceptable, porque los rechazos son raros. Si el cliente necesita el comprobante válido, se le reimprime desde la app.
- **Ambiente `certecf`:** ahí no hay `ConsultaTrackIds`. Una E31 del POS sin trackId no se puede confirmar sola y queda pendiente para soporte. Las RFCE (E32 < 250k) sí se consultan.
- **DGII caída:** con la DGII caída, la app no puede crear facturas (como hoy), mientras el POS sigue vendiendo.
- **Factura simple:** no es un comprobante fiscal. Las ventas que salen así por un fallo del certificado no llevan ITBIS ni entran en el 607. Conviene confirmar con el contador cómo regularizarlas.
- **Números fuera de rango:**
  - Si la DGII autoriza un rango nuevo que **no** incluye los números ya usados fuera de rango, esas ventas nunca se envían solas. Quedan en el aviso de 4.6 para soporte.
  - Una E31 fuera de rango lleva en el XML la fecha del último rango, y puede necesitar «Reenviar a la DGII».
- **Sin servidor o sin base:** lo único que aún detiene una venta del POS es que el servidor o la base no estén disponibles.
- **Merges futuros:** `master` sigue cambiando en la misma zona, así que el merge se repite antes de integrar.

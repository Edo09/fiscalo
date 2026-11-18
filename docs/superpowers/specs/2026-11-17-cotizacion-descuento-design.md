# Descuento en la cotización de Ferretería

Fecha: 2026-11-17. Estado: el front y el API están hechos. **El API se despliega a mano y primero**: hasta que
`api-gratex` con este cambio esté en producción, el front no muestra la fila (no lee `cotizacion_descuento` en
`GET /api/branding`) y todo sigue igual.

## Qué se pidió y por qué

"En cotizaciones necesito un renglón para agregar descuentos." El panel de totales de la cotización de Ferretería
(`Sub-total`, `ITBIS 18%`, `Cargos y abonos`, `TOTAL RD$`) no tenía dónde poner un descuento, así que se rebajaba
tocando precios a mano, lo que cambia lo que se cotiza línea por línea y no deja rastro.

## Qué hace

Una fila **Descuento** bajo el Sub-total, siempre visible (con el API nuevo), con dos campos: el monto en RD$ (lo
único que se guarda) y un porcentaje (una forma de escribirlo y de leerlo).

```
Sub-total                              59,400.00
Descuento      [ 10 ] %  −  [ 5,940.00 ]
ITBIS 18%                               9,622.80   ← 18% de 53,460.00
+ Cargos y abonos
TOTAL RD$                              63,082.80
```

Reglas (las mismas en el front, `totales.ts` + `descuento.ts`, y las que debe aplicar el API):

| Cosa | Regla |
|------|-------|
| Descuento aplicado | `D = min(r2(descuento), Sub-total)`, nunca negativo |
| Sub-total neto | `r2(Sub-total − D)` |
| Reparto entre líneas | método del acumulado: a la línea i le toca `r2(D × acumulado_i / Sub-total) − lo ya repartido`; la suma de las partes es exactamente `D` |
| ITBIS | `r2(Σ r2( r2(base_i − parte_i) × tasa_i ))`: cada línea paga su tasa sobre lo que le queda |
| Retención 5% | `r2(Sub-total neto × 0.05)` |
| TOTAL | `r2(Sub-total neto + ITBIS + cargos + manejo + mano de obra)` |
| Validación | `D ≤ Sub-total` (se compara el monto escrito, no el acotado): *"El descuento (RD$ X) no puede ser mayor que el sub-total (RD$ Y)."* |

Sin descuento nada cambia: las 100 comprobaciones de paridad con las hojas de Excel siguen iguales.

## Decisiones (y por qué)

- **Antes del ITBIS, no después.** Un descuento comercial baja la base gravable; el ITBIS que se cobra es el de lo que
  de verdad se vende. Los cargos y abonos siguen después del ITBIS, como hoy.
- **La retención se calcula sobre el Sub-total neto.** Es el monto que de verdad se paga antes del ITBIS. Es la
  única regla que toca a la vez dos funciones opcionales (descuento + casilla de retención): si el negocio la quiere
  sobre el Sub-total bruto, es una línea en cada lado (`totales.ts` y `FerreteriaFormato::totales`).
- **Se guarda el monto en RD$, no el porcentaje.** El API no guarda un porcentaje; un "10%" que se recalculara solo
  al editar las líneas se perdería al recargar. El % de la pantalla calcula el monto de ese momento y después solo
  muestra qué parte del Sub-total es (si luego cambian las líneas, el monto se queda y el % cambia).
- **Reparto proporcional al centavo.** Con tasas mezcladas (18% / 16% / exento) el descuento tiene que bajar la base
  de cada tasa en proporción; y la factura guarda el descuento por línea. Así la cotización y la factura e-CF dan el
  mismo ITBIS y el mismo TOTAL al centavo (2,000 casos al azar en `scripts/test-descuento-factura.ts`).
- **Fuera de "Cargos y abonos".** Es un renglón propio bajo el Sub-total (el grupo se puede esconder; un descuento no).
- **Solo Ferretería.** La cotización de Gratex tiene un único "Total" (precios con ITBIS incluido, sin Sub-total ni
  ITBIS) y no se toca.
- **La fila no sale si el API no la sabe guardar.** El front se entera por `GET /api/branding`
  (`cotizacion_descuento: true`). Un API viejo rechaza el concepto desconocido con 422, así que ofrecer la fila
  haría fallar el guardado. Una cotización que ya trae descuento muestra la fila siempre.
- **El descuento solo viaja si hay uno** (`ajustes.descuento` ausente con 0): las cotizaciones sin descuento se
  guardan igual con un API viejo.

## Descuentos que ya existían (sin choque ni doble cuenta)

- **"Descuento por defecto (%)" del cliente.** La cotización nunca lo aplicó: lo aplicaba la factura al convertir.
  Sigue igual para una cotización SIN descuento (con su aviso "el total difiere del de la cotización"). Si la
  cotización trae descuento propio, ese pasa a las líneas de la factura (`desc` por línea) y el del cliente **no se
  suma** (`descuentoOrigen` en `FacturaPrefill` / `FacturaSimplePrefill`), ni se avisa de él.
- **Descuento por línea de las facturas** (`desc` %, `descuento_monto` al API): es donde llega el de la cotización.
  Cada línea recibe el % que hace que `montosLinea` dé justo su parte (hasta 8 decimales; por eso a veces es
  "5.6748" y no un número redondo).

## Qué pasa en cada flujo

| Flujo | Resultado |
|-------|-----------|
| Guardar y recargar | `ajustes.descuento` viaja en el cuerpo (si hay) y se lee de `ajustes.descuento` de la fila |
| Lista y detalle | la lista muestra `total` (ya neto); el detalle es el editor |
| Editar | la fila se marca como los demás campos tocados y avisa "Cambios sin guardar" |
| PDF / vista previa | **API:** fila "Descuento" con el monto en negativo entre Sub-total e ITBIS |
| Factura e-CF | el descuento va repartido en `desc` por línea: mismo Sub-total, ITBIS y TOTAL; el aviso lo dice |
| Factura simple | igual, con precios con ITBIS incluido: se desvía unos centavos, como ya pasaba sin descuento (≤ 1 centavo por línea más) |
| Conduce | un conduce no lleva montos ni descuentos: el aviso al abrirlo lo dice, junto al de los cargos |

## Contrato con el API

Cuerpo de `POST` / `PUT` / `POST /preview` (solo el campo nuevo): `ajustes.descuento` = RD$, ≥ 0, hasta 2 decimales,
solo si > 0. `GET /api/cotizaciones`: `ajustes.descuento` como DECIMAL en texto, igual que los demás conceptos
(`subtotal` es la suma de las líneas SIN descuento; `itbis` y `total` ya lo llevan). `GET /api/branding`:
`cotizacion_descuento: true`.

## El cambio en `api-gratex` (sin migración: `cotizacion_ajustes.concepto` es `VARCHAR(30)`, `descuento` cabe)

Hecho en el commit `feat(cotizaciones): descuento en la cotizacion de Ferreteria (totales, validacion, PDF y senal en
branding)` de `api-gratex`:

1. `src/Utils/Cotizacion/FerreteriaFormato.php`
   - `AJUSTES_MONTO` += `'descuento'`; `ETIQUETAS_AJUSTE['descuento'] = 'Descuento'`; el `$out` inicial de
     `normalizarAjustes()` += `'descuento' => 0.0` (el resto de la validación ya sirve: ≥ 0 y 2 decimales).
   - `totales()`: las reglas de la tabla de arriba (`descuentoAplicable`, `repartirDescuento`, ITBIS sobre las bases
     rebajadas, retención y TOTAL sobre el neto) y dos claves nuevas en lo que devuelve: `descuento` y
     `subtotal_neto`. `lineas` sigue siendo el valor de cada línea sin descuento.
   - `errorDescuento()` (el texto de arriba, 422), llamado en `aplicarCatalogo()` antes de `errorAbono()`, con el monto
     PEDIDO, porque `totales()` lo acota.
2. `src/Utils/Cotizacion/FerreteriaCotizacionPdf.php`: en `filasTotales()`, con descuento > 0, una fila
   `['Descuento', -descuento]` entre Sub-total e ITBIS (se imprime `-5,940.00`).
3. `src/Controllers/brandingController.php` (junto a `cotizacion_formato`): `'cotizacion_descuento' => true`.
4. `cotizacionModel.php` **no cambió**: `ajustesAGuardar` recorre las claves de `$cot['ajustes']` y toma el monto de
   `$tot[$concepto]`; guarda `descuento` solo si > 0. La cabecera guarda `subtotal` bruto, `itbis` y `total` netos; las
   líneas guardan su base e ITBIS sin descuento.
5. Pruebas y documentación: seis casos con descuento en `tools/fixtures/cotizacion_ferreteria.json` (el front corre la
   misma copia byte a byte con `scripts/parity-cotizacion-ferreteria.ts`: 167 comprobaciones), `tools/test_cotizacion_ferreteria.php`
   (595, con 1,500 casos al azar contra una referencia en enteros) y `tools/test_conduces.php` (425; sus huellas de los diez
   casos de antes no se movieron: lo que ya se imprimía sigue idéntico), `tests/test_cotizaciones_ferreteria.http`,
   `docs/api/cotizaciones.md`, `docs/modules/cotizaciones-formatos.md`, `docs/modules/branding-plantillas.md` y
   `docs/database/schema.md`, y la línea base de CI recapturada (`tools/express_golden/baseline_suites.json`).

Despliegue: **el API primero, a mano; después el front** (sin migración). Mientras el API no lo sepa, el front no
muestra la fila y todo sigue igual. Bajar el API después de guardar cotizaciones con descuento no está soportado: el
PDF viejo ignoraría el concepto y el TOTAL impreso no cuadraría con el guardado. Para comprobarlo ya desplegado:
`GET /api/branding` debe traer `cotizacion_descuento: true` y el bloque F12 de `tests/test_cotizaciones_ferreteria.http`
(crear con descuento, obtener, PDF, editar sin descuento) da lo que dice cada comentario.

## Cómo se verificó

Todo se corre con `node` (22.18+ quita los tipos solo), desde la raíz del front:

```bash
node scripts/test-descuento-cotizacion.ts   # cuentas, reparto y 1,500 casos al azar contra una referencia en enteros
node scripts/test-descuento-factura.ts      # la factura e-CF cuadra al centavo con la cotización (2,000 casos)
node scripts/test-schema-cotizacion-ferreteria.ts && node scripts/test-conversion-ferreteria.ts
node scripts/test-schema-conduce.ts && node scripts/parity-cotizacion-ferreteria.ts
```

Del lado del API (`php tools/test_cotizacion_ferreteria.php`, `php tools/test_conduces.php` y
`php tools/express_baseline.php --comparar`, que es lo que corre el CI): las mismas cuentas en PHP, con el
`Redondeo` real, dan lo mismo que el front en el fixture y en 4,000 casos al azar (0 diferencias), y el contenido
del PDF (la fila `Descuento`, su orden y sus montos) se comprueba inflando los streams del PDF.

La pantalla se probó contra un mock local cuya cuenta es aparte (en enteros): guardar, recargar, editar, quitar el
descuento, error por pasarse del Sub-total, API viejo sin la señal, convertir a e-CF y factura simple, el aviso del
conduce; claro, oscuro y 375 px. **No se vio el PDF impreso a ojo** (no hay visor de PDF en la máquina de desarrollo):
conviene abrir en producción el PDF de una cotización con descuento después de desplegar el API.

## Fuera de alcance (ideas)

- Un botón "Aplicar descuento fijo del cliente (10%)" en la fila, que llene el monto con el % del cliente elegido.
- Un descuento por línea en la cotización (hoy el API no lo guarda y el PDF no tiene la columna).
- Un porcentaje guardado y recalculado por el API (haría falta otro concepto y su regla).

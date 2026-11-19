# Responsive: densidad según el tamaño de la ventana

Cómo se adapta la app a pantallas chicas (de un portátil de 1366×768 hacia abajo)
sin cambiar su diseño: mismos colores, tipografía y componentes; solo se
reparte distinto el espacio.

## La idea

- Las medidas de espacio (barra superior, relleno de la página, tarjetas, tablas,
  campos, botones, diálogos, la hoja del documento) son **variables CSS**. Viven
  en `src/styles/styles.css`, bloque `:root`, sección «Densidad».
- Sus valores por defecto son **los de siempre**. Con la ventana grande (más de
  1440 px de ancho y de 840 px de alto) cada elemento queda en el mismo píxel que
  antes.
- `src/styles/responsive.css` las **reasigna por tramos**. Las reglas de los
  componentes solo leen las variables, así que una pantalla nueva se adapta sola
  sin escribir su propio `@media`.

## Los tramos

Dos ejes independientes: el **alto** de la ventana manda en las medidas verticales
y el **ancho** en las horizontales.

| Eje | Tramo | Condición | Qué cambia |
|---|---|---|---|
| Alto | cómodo | más de 840 px | nada: valores de siempre (barra 56, relleno de página 24/64, celdas de tabla 11, título 25) |
| Alto | portátil | ≤ 840 px | barra 50, relleno de página 18/44, celdas de tabla 9, título 23, diálogos al 92 % del alto |
| Alto | compacto | ≤ 760 px | barra 46, relleno 14/32, celdas de tabla 7, título 22, diálogos al 96 % del alto |
| Ancho | amplio | más de 1440 px | nada |
| Ancho | portátil | ≤ 1440 px | sidebar 228, relleno lateral 24, celdas de tabla 12 |
| Ancho | angosto | ≤ 1180 px | sidebar 212, relleno lateral 22, celdas de tabla 10 |
| Ancho | tableta / teléfono | ≤ 1024 / 860 / 560 px | reglas de siempre (drawer, una columna, controles grandes) |

Una ventana de 1366×720 cae en «compacto» de alto y «portátil» de ancho. Un
navegador común sobre una pantalla de 768 px de alto mide ~620 px útiles: también
«compacto».

Los **controles** (botones, campos, chips, iconos, ítems del menú) solo se achican
con puntero fino (`pointer: fine`). Con el dedo se quedan del tamaño de siempre,
porque ahí el blanco de toque importa más que el espacio.

El relleno de arriba y de abajo de `.page` usa `min()` entre el tramo de alto y el
de ancho: un tramo nunca agranda lo que el otro ya tenía más ajustado.

## Cómo escribir una pantalla nueva

- Usa las clases del sistema (`.page`, `.page-head`, `.card`, `.card-pad`, `.tbl`,
  `.field`, `.modal`, `.fx-*` para la hoja del documento). Ya leen las variables.
- Para separar bloques usa los utilitarios `.mt-sm/.mt-md/.mt-lg` y
  `.mb-sm/.mb-md/.mb-lg`, o en línea `var(--sp-sm|md|lg)`. Un `marginBottom: 24`
  escrito a mano no se adapta.
- Rejillas con `minmax(0, 1fr)`, nunca `1fr` a secas: una tabla ancha empuja la
  pista y desborda la página.
- Una tabla va dentro de `.tbl-wrap` (hace scroll dentro de su tarjeta).
- Un grupo de botones que pueda no caber en un teléfono: ya envuelve solo
  (`.row` con botones, fuera de tablas); en la barra de acciones de un documento,
  `.fx-bar > .row`.
- Una medida nueva que deba cambiar con el tamaño: ponle variable en `:root` con
  su valor actual, y asígnale el valor de cada tramo en `responsive.css`.
- El texto no se achica: el cuerpo se queda en 13 px o más y la letra chica
  existente no baja de lo que ya era.

## El POS

El POS (`src/pos/pos.css`) escala todo con `zoom` (control de tamaño del cajero), y
`@media` no ve ese zoom: por eso sus quiebres de ancho usan `@container`. Lo único
que se añadió es una regla de poca altura (`max-height: 700px`) para la pantalla del
PIN, que pedía ~640 px.

## Cómo se comprobó

Un barrido en el navegador abre cada pantalla (50+, con modales y cajones) en 9
tamaños (1920×1080 a 390×844) y mide: scroll vertical, desborde horizontal, texto
recortado, modales que no caben y tamaño de los controles. Con la ventana grande se
compara cada rectángulo de cada elemento contra el código anterior: no debe cambiar
ninguno.

La herramienta vive en [`scripts/responsive-sweep/`](../scripts/responsive-sweep/README.md):
córrela otra vez después de cualquier cambio de estilos o de maquetación.

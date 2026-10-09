# Integración de Electron Forge con Vite

## ¿Qué integración oficial encaja con React, TypeScript y Vite?

### Takeaway

La ruta oficial mejor alineada es Electron Forge con `@electron-forge/plugin-vite`; Forge 8.0.1 figura como su versión estable más reciente consultada el 9 de octubre de 2026, y sus notas indican que el plugin Vite dejó el estado experimental y pasó a Vite 8. Para un proyecto que ya es React + TypeScript + Vite, el plugin aporta el esqueleto de Electron y sus builds; React se conecta en el Vite config del renderer mediante el plugin oficial de React. ([Forge 8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1), [Vite plugin de Forge](https://www.electronforge.io/config/plugins/vite), [plugin React de Vite](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react))

### Cited Findings

- Forge publicó v8.0.1 el 29 de septiembre de 2026 y lo marca como `Latest`. Sus notas incluyen el ascenso del plugin Vite fuera de experimental y la actualización del plugin a Vite 8. ([Release Forge 8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1))
- Forge 8 unificó las plantillas JavaScript y TypeScript; el PR fusionado describe `--typescript` como opción para generar el lenguaje y establece Node.js 22.13 o superior como requisito para el mecanismo de plantillas. ([PR de unificación de plantillas](https://github.com/electron/forge/pull/4229))
- La documentación web de Forge consultada aún enseña `--template=vite-typescript` como paquete separado y conserva una nota de que el plugin es experimental desde Forge 7.5.0. Esto contradice el estado y las plantillas de Forge 8 descritos por el release y el PR; hay que seguir la versión instalada y sus opciones actuales, no copiar esas instrucciones antiguas sin verificar. ([Documentación de Vite + TypeScript](https://www.electronforge.io/templates/vite-+-typescript), [release Forge 8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1), [PR de unificación](https://github.com/electron/forge/pull/4229))
- El plugin Forge Vite compila targets separados para main, preload y renderer; `build` acepta varios entries y `renderer` acepta una lista de configs. El campo `main` del `package.json` apunta al bundle de Electron, normalmente `.vite/build/main.js`. ([Configuración del plugin Vite](https://www.electronforge.io/config/plugins/vite), [API de configuración Forge 8.0.1](https://github.com/electron/forge/blob/v8.0.1/packages/plugin/vite/src/Config.ts))
- El plugin oficial `@vitejs/plugin-react` habilita React Fast Refresh y el runtime JSX automático; su configuración documentada es añadir `react()` a `plugins` del Vite config. Sus filtros predeterminados incluyen `.js`, `.jsx`, `.ts` y `.tsx`. ([README oficial de plugin-react](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react))
- La guía de Forge titulada React con TypeScript está escrita para la plantilla Webpack y dice haber sido probada con React 18, TypeScript 4.3 y Webpack 5. No es la guía adecuada para explicar la integración actual con un renderer Vite. ([React con TypeScript en Forge](https://www.electronforge.io/guides/framework-integration/react-with-typescript))

### Inferences

- Para adaptar una app Vite existente, la opción de menor fricción parece conservar el renderer y sus rutas, añadir la estructura Electron (main + preload) que espera Forge, y registrar `@vitejs/plugin-react` en el config Vite del renderer. Esta recomendación combina la separación de targets de Forge con la configuración oficial React de Vite. ([Configuración del plugin Vite](https://www.electronforge.io/config/plugins/vite), [plugin React de Vite](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react))
- Si se crea un scaffold auxiliar con Forge 8, la forma actual se basa en el template `vite` más la opción `--typescript`; el nombre separado `vite-typescript` de la documentación web refleja el esquema anterior. Confirmar la sintaxis exacta con el CLI 8.x usado para el proyecto, porque la documentación del sitio aún no refleja la unificación. ([PR de unificación de plantillas](https://github.com/electron/forge/pull/4229), [documentación de plantillas](https://www.electronforge.io/templates/vite-+-typescript))
- La documentación del plugin `@vitejs/plugin-react` debe usarse para añadir React al renderer; no hay una plantilla Forge de primera parte que el material consultado identifique como una combinación ya preintegrada de React + Vite + Electron. ([Plantillas Forge](https://www.electronforge.io/), [plugin React de Vite](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react))

### Gaps

- La documentación del sitio de Electron Forge sigue mostrando estados y nombres de plantilla anteriores a Forge 8. No encontré una guía oficial ya actualizada que documente paso a paso la migración de una aplicación Vite React existente a Forge 8.
- El comando exacto de scaffold con `--typescript` está descrito en el PR fusionado; la guía de plantillas pública consultada todavía no lo refleja. Verificarlo con `npx create-electron-app --help` o la ayuda de la versión 8 antes de basar automatización en esa sintaxis.

## ¿Cómo funciona el desarrollo y HMR?

### Takeaway

El renderer corre sobre el servidor de desarrollo Vite y obtiene HMR; el plugin React añade Fast Refresh para TSX. Los cambios del proceso main no son HMR de renderer: en Forge 8 se puede activar `hotRestart` para reiniciar Electron después de reconstruir main, y está desactivado por defecto. ([Forge Vite plugin API](https://js.electronforge.io/interfaces/_electron_forge_plugin-vite..VitePluginConfig.html), [PR de hot restart](https://github.com/electron/forge/pull/4346), [Vite HMR](https://vite.dev/guide/features.html#hot-module-replacement))

### Cited Findings

- Forge Vite proporciona HMR al renderer. Para cargar la app, el proceso main usa las constantes generadas por Forge: `*_VITE_DEV_SERVER_URL` durante desarrollo y `*_VITE_NAME` para localizar el HTML estático al empaquetar. ([Configuración y HMR de Forge Vite](https://www.electronforge.io/config/plugins/vite))
- Vite ofrece HMR sobre ESM; el plugin oficial React implementa Fast Refresh y los templates `create-vite` lo configuran previamente. ([HMR en Vite](https://vite.dev/guide/features.html#hot-module-replacement), [plugin React de Vite](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react))
- El plugin Forge no reinicia el proceso main por defecto cuando cambia el bundle. Forge 8 permite `hotRestart: true`; el cambio de main reinicia la app durante `electron-forge start`, no aplica al empaquetado. ([PR de hot restart en Forge](https://github.com/electron/forge/pull/4346), [tipo VitePluginConfig](https://js.electronforge.io/interfaces/_electron_forge_plugin-vite..VitePluginConfig.html))
- Vite transpila TypeScript, pero no hace type-checking. La guía de Vite recomienda ejecutar `tsc --noEmit` en producción y, para feedback continuo en desarrollo, un proceso `tsc --noEmit --watch` aparte o una integración como `vite-plugin-checker`. ([TypeScript en Vite](https://vite.dev/guide/features.html#typescript))

### Inferences

- Mantener un proceso paralelo de type-checking es necesario si el flujo actual se apoya en errores de TypeScript visibles durante compilación; el build Vite por sí solo no valida el grafo de tipos. ([TypeScript en Vite](https://vite.dev/guide/features.html#typescript))
- React Fast Refresh aplica al renderer cargado desde el servidor Vite; main y preload son targets distintos y requieren reconstrucción, con reinicio de la app para reflejar cambios de main. ([Configuración del plugin Forge Vite](https://www.electronforge.io/config/plugins/vite), [PR hot restart](https://github.com/electron/forge/pull/4346))

### Gaps

- La guía del plugin Forge Vite del sitio no explica con el mismo detalle el nuevo `hotRestart` de Forge 8; el PR fusionado y la API tipada son las fuentes actuales consultadas.
- No encontré una afirmación oficial que garantice React Fast Refresh para cada patrón de configuración personalizado de Vite; dependerá de que el renderer siga cargando las transformaciones de Vite y `@vitejs/plugin-react`.

## ¿Qué produce el empaquetado y cómo se distribuye?

### Takeaway

Forge separa el empaquetado de la creación de instaladores: `package` genera el bundle ejecutable en `out/`; `make` ejecuta los Makers configurados y genera artefactos distribuibles en `out/make/`. La publicación es un tercer paso opcional. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle), [CLI Forge](https://www.electronforge.io/cli))

### Cited Findings

- Forge organiza el flujo como `package` → `make` → publicación: `package` crea el bundle de app para el sistema objetivo; `make` convierte ese bundle en instaladores o archivos comprimidos definidos por Makers; la publicación sube los artefactos mediante Publishers y es opcional. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle))
- `make` usa por defecto los Makers del sistema y arquitectura de la máquina. Para compilar targets de otros sistemas hay limitaciones; Forge recomienda pipelines CI con runners de cada plataforma. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle), [CLI Forge](https://www.electronforge.io/cli))
- El plugin Vite ejecuta builds de Vite para cada target. En Forge v7.9+ se puede limitar concurrencia con `concurrent` para evitar presión de memoria; la interfaz VitePluginConfig sigue documentando esta opción. ([Plugin Vite Forge](https://www.electronforge.io/config/plugins/vite), [API VitePluginConfig](https://js.electronforge.io/interfaces/_electron-forge_plugin-vite..VitePluginConfig.html))
- Forge indica que `package` reconstruye add-ons nativos para la versión de Electron de la app y realiza pasos asociados como íconos y firma/notarización en macOS. Si hay dependencias Node nativas, la guía del plugin recomienda marcarlas como externas en el build main para reducir fallos. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle), [plugin Vite Forge](https://www.electronforge.io/config/plugins/vite))
- En Forge 8 el comando de carga fue renombrado de `publish` a `release`; la página CLI pública aún muestra `publish`, otra discrepancia de actualización que conviene resolver contra el CLI instalado. ([Release Forge 8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1), [CLI Forge](https://www.electronforge.io/cli))

### Inferences

- Para obtener un instalador que se pueda entregar al usuario final, el comando habitual es `make`, no solo `package`; la configuración de Makers determina si el resultado es, por ejemplo, un `.msi`, `.dmg`, `.deb` o `.zip`. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle))
- En CI conviene planear builds por sistema operativo, arquitectura, firma y notarización como parte del trabajo de release; Forge no promete portabilidad de la compilación cruzada sin limitaciones. ([Ciclo de build Forge](https://www.electronforge.io/core-concepts/build-lifecycle))

### Gaps

- El empaquetado final depende de los Makers y del sistema destino que se elijan para este producto; todavía no se fija aquí si el primer entregable es Windows, macOS, Linux o varios.
- El CLI público del sitio no refleja en todos los lugares el cambio de `publish` a `release` de Forge 8; confirmar el nombre del script en la versión fijada.

## ¿Qué tan bien encaja Vite multipágina con Electron Forge?

### Takeaway

Vite soporta aplicaciones multipágina de forma nativa: rutas HTML múltiples en desarrollo y varios HTML como inputs al construir. Forge, a su vez, soporta varios renderer targets (por ejemplo, ventanas Electron independientes); eso no equivale automáticamente a multipágina dentro de un único renderer. No encontré un ejemplo oficial que una explícitamente ambos casos bajo Electron y `file://`, así que la compatibilidad de la arquitectura multipágina concreta requiere una prueba de empaquetado. ([MPA de Vite](https://vite.dev/guide/build#multi-page-app), [plugin Vite Forge](https://www.electronforge.io/config/plugins/vite))

### Cited Findings

- Vite documenta que durante desarrollo se puede navegar a una ruta como `/nested/`, y que en producción se declaran varios archivos `.html` como entradas para generar cada página. ([MPA de Vite](https://vite.dev/guide/build#multi-page-app))
- En la configuración actual de Vite, se recomienda declarar `input` en el nivel superior para que se use tanto en desarrollo como en build; `build.rolldownOptions.input` sigue disponible, pero lo reemplaza solo para la build. ([Build options de Vite](https://vite.dev/config/build-options.html))
- Forge modela una lista de configs `renderer`, cada una con un `name` propio y un Vite config; documentación/API describen builds y servidores separados para cada renderer. Esto sirve para ventanas o procesos renderer distintos. ([Plugin Vite Forge](https://www.electronforge.io/config/plugins/vite), [API VitePluginRendererConfig](https://js.electronforge.io/interfaces/_electron-forge_plugin-vite..VitePluginRendererConfig.html))
- Forge fija `base: './'` en renderer de producción porque las páginas se abren desde una URL local `file://`; los assets deben conservar rutas relativas. La guía advierte que URLs raíz como `/my-logo.png` pueden funcionar en desarrollo y fallar al empaquetar, y recomienda `import.meta.env.BASE_URL` o rutas HTML relativas. ([Renderer base path Forge](https://www.electronforge.io/config/plugins/vite))
- Vite genera los HTML en ubicaciones consistentes con las rutas de origen; ignora el alias textual de una entrada HTML y respeta la ubicación resuelta del archivo. ([Build multipágina Vite](https://vite.dev/guide/build#multi-page-app))

### Inferences

- Si “multipágina” significa varias rutas de navegación dentro de un solo producto React, una sola config de renderer puede declarar varios HTML con Vite y cargar en cada `BrowserWindow` el HTML correspondiente; al empaquetar, main debe apuntar al archivo estático específico de cada ventana, y en desarrollo a la URL correspondiente del servidor. Es una inferencia de los dos mecanismos documentados, no un flujo Electron multipágina oficial ya garantizado. ([MPA de Vite](https://vite.dev/guide/build#multi-page-app), [carga del renderer Forge](https://www.electronforge.io/config/plugins/vite))
- Si cada página abre en una ventana o necesita un proceso renderer/config distinto, la lista `renderer` de Forge coincide más directamente con ese modelo. Si las páginas son rutas de una SPA de React, la MPA de Vite podría no ser necesaria. ([Configuración del plugin Forge Vite](https://www.electronforge.io/config/plugins/vite), [MPA de Vite](https://vite.dev/guide/build#multi-page-app))
- El ajuste `base: './'` y la prueba del HTML de cada ventana son los puntos críticos para evitar rutas absolutas que dejan de resolver al pasar del servidor Vite a `file://`. ([Renderer base path Forge](https://www.electronforge.io/config/plugins/vite))

### Gaps

- Las fuentes oficiales consultadas no especifican cómo se resuelven todas las combinaciones de MPA Vite, `BrowserWindow.loadFile`, rutas anidadas, navegación React y assets con `file://` en Forge. Validar el caso real con una build `make` y probar cada ventana/ruta desde el paquete generado.
- La documentación Forge presenta múltiples renderer configs, pero no aclara si recomienda una config multipágina por renderer o una config por cada HTML. Esa distinción debe quedar definida según si las páginas son documentos, ventanas o rutas SPA.

# Tauri v2 frente a Electron para Fiscalo — 9 de octubre de 2026

## Reutilización de React, TypeScript y Vite

### Takeaway
Fiscalo puede conservar la mayor parte de su UI y lógica web con cualquiera de los dos contenedores; no hace falta reescribir React. La adaptación está en el build de las dos páginas y en una capa pequeña para ventanas, archivos, impresión y almacenamiento seguro.

### Cited Findings
- Tauri se puede añadir a un frontend existente; su guía muestra Vite como servidor de desarrollo y `dist` como `frontendDist`, e indica que admite SPA y MPA estáticas, pero no renderizado SSR propio. [Crear un proyecto Tauri e integrarlo a uno existente](https://v2.tauri.app/start/create-project/); [configuración de frontends](https://v2.tauri.app/start/frontend/); [guía Vite de Tauri](https://v2.tauri.app/start/frontend/vite/)
- La guía de Electron describe el renderer como interfaz de tecnologías web. Electron Forge ofrece un plugin para compilar con Vite las entradas de main, preload y cada renderer, pero su documentación todavía marca el soporte Vite como experimental. [Modelo de procesos de Electron](https://www.electronjs.org/docs/latest/tutorial/process-model); [plugin Vite de Electron Forge](https://www.electronforge.io/config/plugins/vite)
- El repo usa React 18, TypeScript 5.6 y Vite 6. Su build de Vite genera dos entradas HTML (`index.html` y `pos.html`); un plugin propio elimina `index.html` del resultado y lo emite como `app.html` para el routing por host en Vercel. [package.json en el commit 5c5feb2](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/package.json); [vite.config.ts en el mismo commit](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/vite.config.ts)
- Tauri configura `frontendDist` con un directorio de assets y busca `index.html` como entrada por defecto; permite configurar ventanas con una URL o ruta local. [Configuración Tauri: frontendDist y ventanas](https://v2.tauri.app/reference/config/)

### Inferences
- Las vistas React, estilos, servicios `fetch`, modelos, mappers, React Query y Zustand pueden seguir compartidos. El código desktop sería un shell: Rust y plugins/capabilities para Tauri, o main/preload y una API IPC acotada para Electron. Esto se infiere del frontend web existente y de las dos arquitecturas documentadas. [package.json](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/package.json); [Tauri: proyecto existente](https://v2.tauri.app/start/create-project/); [Electron: modelo de procesos](https://www.electronjs.org/docs/latest/tutorial/process-model)
- Fiscalo requerirá una ruta de build desktop distinta o una configuración explícita de ventanas para `app.html` y `pos.html`: el build actual no deja el `index.html` que Tauri busca por defecto. Para Electron también hay que modelar las dos entradas/renderers o cargar las dos páginas empaquetadas. No conviene cambiar la salida Vercel sin probar ambos despliegues. [vite.config.ts del repo](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/vite.config.ts); [Tauri config](https://v2.tauri.app/reference/config/); [Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)
- La guía Vite de Tauri indica ignorar `src-tauri` en el watcher y muestra el uso del servidor de desarrollo existente; el repo ya fija el puerto 5173, pero tiene `open: true`. Habría que ajustar el watcher y confirmar que el modo desktop no abre además el navegador del sistema. [Guía Vite de Tauri](https://v2.tauri.app/start/frontend/vite/); [vite.config.ts del repo](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/vite.config.ts)

### Gaps
- No se ha construido una prueba con las versiones concretas del repo para confirmar compatibilidad de Vite 6 con la versión actual de `@electron-forge/plugin-vite`, ni se han resuelto las entradas HTML de app y POS en una configuración real. La documentación oficial consultada no ofrece un preset exacto para esta combinación.

## Arquitectura, seguridad y API

### Takeaway
Tauri expone capacidades nativas mediante comandos/plugins Rust con permisos por ventana; Electron entrega APIs del sistema desde main/preload. Ambos permiten mantener el renderer React local, pero el límite de seguridad debe diseñarse explícitamente.

### Cited Findings
- Tauri agrupa permisos en capabilities asociadas a ventanas/webviews, y las scopes limitan qué paths permiten las APIs de archivos. La guía de seguridad advierte que capabilities combinadas amplían permisos y que permisos sin scope no conceden acceso a rutas. [Capabilities de Tauri](https://v2.tauri.app/security/capabilities/); [permisos del plugin de archivos](https://v2.tauri.app/plugin/file-system/)
- Electron recomienda desactivar Node integration para contenido remoto, activar context isolation y sandbox, restringir navegación y validar el emisor de cada mensaje IPC; su modelo separa main y renderer. [Seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security/); [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation); [modelo de procesos](https://www.electronjs.org/docs/latest/tutorial/process-model)
- El token de sesión de Fiscalo se persiste en `localStorage`; el cliente API usa `fetch` y la configuración frontend lee `VITE_API_BASE_URL` y `VITE_API_KEY`. [auth store del repo](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/stores/auth.ts); [config API del repo](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/api/config.ts)
- Vite expone las variables con prefijo `VITE_` en el código cliente y advierte que no deben usarse para secretos porque quedan dentro del bundle. [Variables de entorno Vite](https://vite.dev/guide/env-and-mode)
- Electron dispone de `safeStorage` en main para cifrar datos con servicios del sistema operativo; en Linux el backend depende del entorno y puede caer a `basic_text` si no hay almacén de secretos. Tauri publica Stronghold como almacenamiento cifrado, con inicialización de vault y contraseña/hash. [safeStorage de Electron](https://www.electronjs.org/docs/latest/api/safe-storage); [Stronghold de Tauri](https://v2.tauri.app/plugin/stronghold/)

### Inferences
- Para reducir riesgo, conviene cargar solo assets empaquetados localmente y llamar la API remota por HTTPS. En Electron, no habilitar Node en React; exponer por preload solo operaciones puntuales. En Tauri, no otorgar `fs` ni shell a la UI si no se requieren y dejar scopes mínimos.
- Empaquetar el frontend no vuelve secreto un `VITE_API_KEY`; no incluir una credencial compartida de servidor en el renderer desktop. La autenticación de usuarios puede continuar en el backend, pero el token existente en `localStorage` seguirá siendo dato local legible por el renderer; si la política exige protección en reposo, evaluar almacenamiento protegido con semántica y fallback propios de cada SO.
- El repo describe y usa un backend remoto `api-gratex`; el origen y CORS que aceptará la app desktop no están aquí. Cualquiera de los dos wrappers necesita una prueba real de login/refresh/requests desde su origen de producción; si no se puede configurar CORS, habría que decidir un cliente HTTP nativo/proxy y su diseño de seguridad. [README del repo](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/README.md); [HTTP client plugin Tauri](https://v2.tauri.app/plugin/http-client/)

### Gaps
- No se inspeccionó el backend ni sus reglas CORS, política de expiración/revocación del token, ni requisitos formales de protección de tokens/API keys. Tampoco se sabe si hay una API key de producción configurada; solo consta que el código la admite.

## Archivos, impresoras y POS

### Takeaway
Ambos pueden cubrir selección y escritura de archivos. Para impresión, Electron ofrece una API documentada con más controles de dispositivo y página; Tauri puede usar `window.print()`, pero su documentación pública consultada no confirma una opción equivalente y uniforme para impresora térmica, así que imprimir un recibo real es la prueba decisiva.

### Cited Findings
- El plugin Dialog de Tauri muestra diálogos nativos para abrir/guardar y devuelve paths; el plugin FS requiere permisos y scopes explícitos por ruta. [Dialog Tauri](https://v2.tauri.app/plugin/dialog/); [File System Tauri](https://v2.tauri.app/plugin/file-system/)
- En Electron, `dialog` es API de main para diálogos nativos; el ejemplo oficial comunica la selección de archivo al renderer mediante IPC. [Dialog Electron](https://www.electronjs.org/docs/latest/api/dialog); [IPC de Electron](https://www.electronjs.org/docs/latest/tutorial/ipc)
- Electron `webContents.print` documenta `silent`, `deviceName`, `pageSize`, márgenes y callback de éxito/error. [webContents.print de Electron](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback)
- Tauri documenta que el método nativo `WebviewWindow.print()` abre el diálogo, pero actualmente solo está soportado por Wry en macOS; la misma referencia especifica que `window.print()` funciona en todas las plataformas. [WebviewWindow de Tauri, API Rust](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)
- El repo ya construye PDFs/HTML para impresión usando iframes, Blob URLs, `window.print()` y CSS `@page`; el comentario de `printDocument` incluye un fallback porque algunos navegadores no imprimen PDFs en iframe. La configuración de impresora guarda ancho de papel en localStorage; no se encontró control actual de nombre de dispositivo. [file.ts](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/lib/file.ts); [printHtml.ts](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/lib/printHtml.ts); [store de impresora](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/stores/impresora.ts)
- El botón POS solicita un código de handoff al backend y abre una ventana con `pos.html#code=...` solo en desarrollo; en producción abre la URL `r.url` del POS separado. Tauri soporta ventanas web con rutas locales configurables. [Navbar](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/components/layout/Navbar.tsx); [auth POS](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/api/auth.ts); [WebviewWindow Tauri](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/)
- Tauri requiere WebView del sistema; la versión del motor varía: WebView2 en Windows, WebKit en macOS y WebKitGTK en Linux. [Versiones de WebView Tauri](https://v2.tauri.app/reference/webview-versions/); [prerrequisitos Tauri](https://v2.tauri.app/start/prerequisites/)

### Inferences
- Las subidas actuales con `File`, los blobs y enlaces de descarga son APIs web que pueden permanecer en el renderer. Cuando una función requiera elegir ubicación, leer/escribir rutas locales o automatizar un dispositivo, añadir un adaptador Tauri (dialog/fs con scope) o un IPC de Electron; no dejar acceso irrestricto al filesystem al frontend.
- Si la impresión puede quedarse en el diálogo del sistema, mantener la implementación web y probar el recibo en Tauri puede bastar. Si el requisito es imprimir en silencio o escoger una impresora térmica por nombre/tamaño sin diálogo, Electron tiene un camino de API oficial más claro; en Tauri habría que validar sus APIs/plugin disponibles por plataforma o implementar integración nativa propia.
- El flujo POS de navegador no debe asumirse idéntico en desktop: hoy deriva a dominio remoto en producción. La app empaquetada deberá abrir un segundo renderer local para `pos.html` (o elegir deliberadamente mantener POS como web remota) y pasar el código de un solo uso de forma compatible con el endpoint de canje. [Navbar](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/components/layout/Navbar.tsx); [canje POS](https://github.com/Edo09/fiscalo/blob/5c5feb2b0258ccc4b33038499cb69f9177c5e947/src/pos/api.ts)

### Gaps
- No está indicado el modelo de impresora, conexión (USB/red/Bluetooth), sistema operativo de caja, ni si imprimir en silencio es requisito. Las fuentes oficiales consultadas tampoco bastan para afirmar soporte común de impresión térmica ESC/POS o selección de impresora en Tauri entre Windows/macOS/Linux.

## Requisitos de desarrollo, instalación y límites multiplataforma

### Takeaway
Tauri reduce la dependencia de un runtime web empaquetado, pero exige toolchain Rust y compila contra el WebView de cada sistema. Electron requiere distribuir Electron/Chromium/Node, y su ruta de producción debe mantener las actualizaciones y protecciones del framework; ambos necesitan builds y firma por plataforma según el canal de distribución.

### Cited Findings
- Para desarrollar Tauri se necesita Rust y dependencias de la plataforma: C++ Build Tools y WebView2 en Windows; Xcode/Command Line Tools en macOS; WebKitGTK y paquetes del sistema en Linux. El runtime de WebView2 viene normalmente preinstalado en Windows 10 desde 1803. [Prerequisites Tauri](https://v2.tauri.app/start/prerequisites/)
- Electron empaqueta la app con su runtime y recomienda Electron Forge para generar instaladores; Forge produce artefactos específicos por sistema. [Packaging Electron](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging); [makers de Forge](https://www.electronforge.io/config/makers)
- Tauri ofrece MSI o NSIS para Windows; MSI solo se genera en Windows y el cross-build NSIS desde macOS/Linux lleva caveats. Tauri ofrece AppImage, deb, Snap, Flatpak, RPM/AUR para Linux y app/DMG para macOS. [Instalador Windows Tauri](https://v2.tauri.app/distribute/windows-installer/); [distribución Tauri](https://v2.tauri.app/distribute/)
- Electron Forge por defecto construye para el sistema operativo en el que corre; algunos makers tienen condiciones adicionales. Distribuir Electron en macOS y Windows requiere firma recomendada, y macOS fuera de App Store también requiere notarización. [Build lifecycle Forge](https://www.electronforge.io/core-concepts/build-lifecycle); [code signing Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- Tauri sirve builds para Windows en WebView2, y para macOS/Linux en WebKit. La guía Vite también configura targets de build distintos para Chromium y WebKit. [Versiones de WebView Tauri](https://v2.tauri.app/reference/webview-versions/); [guía Vite Tauri](https://v2.tauri.app/start/frontend/vite/)

### Inferences
- Para un primer despliegue Windows-only, Tauri encaja con el Vite existente y puede probarse sin convertir la aplicación en una app de navegador propia; aun así, obliga a instalar Rust/C++ Build Tools en el entorno de desarrollo/CI. En máquinas de usuario hay que probar la instalación y disponibilidad de WebView2.
- Si Fiscalo se publicará para macOS y Linux, habrá que probar formato de recibo, PDFs, tipografías, diálogos y ventanas en cada motor. Esto es especialmente importante porque el POS usa un recibo medido en CSS y la API de impresión del navegador; Electron da más uniformidad de Chromium pero sigue necesitando pruebas de impresora/SO.
- La producción real debe planificarse como pipeline con runners por plataforma y firma/notarización; no asumir que un único build local da todos los instaladores.

### Gaps
- No se especificó qué sistemas operativos usan los comercios, arquitectura CPU a soportar, canal (descarga directa/Store), mecanismo de actualización ni presupuesto de firma. Estas respuestas cambian la recomendación de instalador y matriz de builds.



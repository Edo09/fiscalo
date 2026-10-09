# PWA instalable para Fiscalo

## ¿Qué aporta instalar Fiscalo como PWA de escritorio y qué compatibilidad tiene?

### Takeaway
Al 9 de octubre de 2026, una PWA es la opción de menor fricción para dar a Fiscalo una ventana propia e icono de aplicación sin rehacer React/TypeScript ni producir instaladores por sistema operativo. Para instalación web con manifiesto, Chromium es la ruta más consistente en Windows, macOS y Linux; Safari añade “Add to Dock” desde macOS Sonoma, mientras que Firefox no ofrece instalación PWA de escritorio por manifiesto.

### Cited Findings
- Un manifiesto web permite declarar nombre, iconos, URL inicial y modo de presentación; Chromium requiere name o short_name, iconos de 192 y 512 px, start_url y display/display_override; la instalación promocionada requiere HTTPS (o localhost durante desarrollo). [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Una PWA instalada puede tener icono del sistema y abrirse en una ventana standalone; Chromium admite instalación de PWAs con manifiesto en los sistemas de escritorio que soporta. [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Safari permite añadir cualquier sitio al Dock en macOS Sonoma (Safari 17) y abrirlo en su propia ventana; Apple documenta integración con Stage Manager, Screen Time, Notificaciones y Focus. [Apple: Safari 17 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes)
- Firefox de escritorio no ofrece instalación PWA mediante manifiesto según la tabla de compatibilidad actual de MDN; el navegador todavía puede abrir el sitio como web normal. [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Edge integra la PWA instalada con Inicio, barra de tareas, Alt+Tab y notificaciones en Windows; usuarios pueden configurar el inicio automático al iniciar sesión. [Microsoft Learn: Use PWAs in Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps-chromium/ux)
- Chrome y Edge ofrecen inicio al iniciar sesión en Windows, Linux y macOS, pero la opción la activa el usuario desde el navegador; la web no puede activarla por sí misma. [Chrome for Developers: Automatically start PWAs on OS Login](https://developer.chrome.com/blog/run-on-login?hl=en)
- Una PWA instalada sigue ejecutándose en el navegador que la instaló; instalaciones en navegadores distintos son instancias separadas y no comparten datos del sitio. [MDN: Installing and uninstalling web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)
- Una PWA se distribuye como web y puede instalarse sin compilar un binario por sistema operativo; empacarla en una tienda es opcional y requiere el proceso de esa tienda. [MDN: What is a progressive web app?](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)

### Inferences
- Fiscalo ya usa React + TypeScript + Vite; la conversión inicial a PWA puede conservar la aplicación y el deploy web existente. [Repositorio: package.json](../../package.json)
- El build tiene dos HTML de entrada: index.html para la app y pos.html para el POS; deberán agregarse metadatos/manifiesto e iconos apropiados para cada experiencia. [Repositorio: vite.config.ts](../../vite.config.ts)
- vite.config.ts documenta que la app administrativa se sirve bajo app.fiscalpoint.com.do y POS bajo pos.fiscalpoint.com.do. Como son hosts distintos, conviene tratarlos como dos identidades/orígenes PWA y validar la instalación/apertura del POS por separado; una instalación de la app no convierte automáticamente el sitio POS en una ventana de la misma app. [Repositorio: vite.config.ts](../../vite.config.ts)
- La PWA es una mejora de entrega y presentación de la web, no un binario aislado ni un runtime independiente del navegador. Es adecuada como primer paso si el objetivo principal es que los usuarios lancen Fiscalo desde Inicio/Dock y trabajen en su propia ventana.

### Gaps
- La política comercial de soporte no está definida: falta decidir qué navegadores y versiones mínimas Fiscalo dará soporte oficialmente. La instalación PWA no está disponible de forma uniforme en todos los navegadores.
- No se validó el flujo de instalación en los equipos reales de clientes ni si se requiere publicar además en Microsoft Store.

## ¿Qué límites presenta para POS, cambio de ventana e impresión térmica?

### Takeaway
La PWA conserva capacidades web y la impresión estándar, pero no concede acceso irrestricto a periféricos ni elimina el diálogo de impresión. El flujo actual de POS puede seguir usando su página/host; la impresión silenciosa o ESC/POS directa depende de navegador, modelo de impresora, conexión y configuración administrada, así que debe decidirse con un piloto de hardware real.

### Cited Findings
- window.print() abre el diálogo de impresión del documento; MDN la marca ampliamente disponible. [MDN: Window.print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- Fiscalo genera/recibe documentos y llama print() sobre una ventana de PDF en un iframe; si no funciona, su utilidad abre el documento en pestaña. Por tanto, la ruta existente es compatible con el modelo web de impresión interactiva, no acredita impresión silenciosa ni acceso ESC/POS. [Repositorio: src/lib/file.ts](../../src/lib/file.ts)
- En Chrome de escritorio, la política empresarial SilentPrintingEnabled puede cerrar la vista previa e imprimir a la impresora predeterminada con las opciones predeterminadas; la documentación actual indica Chrome en Windows, Mac y Linux desde la versión 144. Requiere gestión/política del navegador y no selecciona arbitrariamente una impresora por ticket. [Chrome Enterprise: Silent Printing Enabled](https://chromeenterprise.google/intl/es-419_ALL/policies/silent-printing-enabled/)
- Web Serial permite leer/escribir dispositivos que exponen puerto serial, incluidos periféricos USB o Bluetooth que emulan un puerto; requiere contexto seguro y MDN la clasifica como disponibilidad limitada. [MDN: Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- Chrome documenta Web Serial en todas sus plataformas de escritorio: ChromeOS, Linux, macOS y Windows. [Chrome Developers: Web Serial](https://developer.chrome.com/docs/capabilities/serial)
- Firefox añadió Web Serial en escritorio desde la versión 151; sus notas indican que el sitio requiere un complemento de permisos de sitio generado para usar la API. [Mozilla: Firefox 151 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/151)
- La tabla de compatibilidad de MDN registra Web Serial desde Chrome 89 y Firefox 151, y no en Safari; la página también documenta la selección de puerto iniciada por el usuario. [MDN Browser Compatibility Data: Serial](https://github.com/mdn/browser-compat-data/blob/main/api/Serial.json)
- WebUSB tiene disponibilidad limitada y carácter experimental; opera en contextos HTTPS y solo puede acceder a dispositivos/interfaces compatibles que el sistema no tenga reclamados por un controlador. [MDN: WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)
- En Windows, acceder a ciertos dispositivos WebUSB puede requerir asociación con WinUSB; por tanto, “USB” en la ficha de la impresora no basta para asumir compatibilidad. [Chrome Developers: WebUSB platform considerations](https://developer.chrome.com/docs/capabilities/build-for-webusb)
- Chrome exige una interacción explícita del usuario para solicitar acceso WebUSB; se presenta una selección/permiso de dispositivo. [Chrome Developers: Access USB Devices on the Web](https://developer.chrome.com/docs/capabilities/usb)
- La instalación no elimina restricciones de ventanas emergentes. En el repo, el botón abre primero una pestaña vacía durante el clic y luego la navega al URL de POS devuelto por la API para evitar que el navegador la bloquee. [Repositorio: src/components/layout/Navbar.tsx](../../src/components/layout/Navbar.tsx)

### Inferences
- La configuración confirma que administración y POS se publican en subdominios distintos; conviene validar en cada navegador si el handoff se abre en la ventana PWA, otra ventana PWA ya instalada o el navegador. [Repositorio: vite.config.ts](../../vite.config.ts)
- El botón actual abre una pestaña durante el clic y la navega al URL de POS recibido del servidor. Debe probarse este flujo con las dos instalaciones y navegadores soportados. [Repositorio: src/components/layout/Navbar.tsx](../../src/components/layout/Navbar.tsx)
- La impresión de recibos existente solicita un PDF o HTML y abre el diálogo del SO/navegador. Si “imprimir recibo con un clic y sin diálogo” es requisito, primero conviene probar una PWA en Chrome administrado con política de impresión silenciosa usando las térmicas exactas; si las opciones por caja o ESC/POS son más complejas, evaluar agente local o wrapper nativo.
- Web Serial puede servir para algunas térmicas con interfaz serial compatible, pero no es equivalente a soportar cualquier impresora térmica ni sustituye una matriz de compatibilidad por fabricante/modelo.

### Gaps
- No se encontró inventario de marcas/modelos, interfaces (USB, puerto serial, Ethernet, Bluetooth), controladores ni comandos ESC/POS de las impresoras objetivo. Sin eso no se puede afirmar compatibilidad directa.
- Debe verificarse el comportamiento de ventanas para el handoff real entre los dominios app.* y pos.*, especialmente cuando solo una de las dos apps está instalada.

## ¿Qué logra offline y cómo cambia la seguridad y persistencia de datos?

### Takeaway
Un service worker puede hacer que el shell (HTML, JS, CSS, fuentes e iconos) cargue y ofrecer pantallas/datos cacheados; eso no vuelve local una API remota. Para una facturación confiable sin conexión se necesita un diseño explícito de datos, cola, reintentos idempotentes y reconciliación con el servidor. La PWA tampoco cambia automáticamente dónde guarda Fiscalo sus tokens: en el código actual la sesión del usuario y el identificador de equipo POS se persisten en localStorage.

### Cited Findings
- Un service worker puede cachear recursos de la app e interceptar fetch para ofrecer recursos cacheados o una pantalla alternativa sin conexión. Las estrategias cache-first pueden devolver datos obsoletos; un service worker no debe tratarse como el backend de negocio. [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- Background Sync permite programar trabajo para cuando vuelva la conexión, pero el navegador puede detener el service worker y los reintentos son limitados; una operación interrumpida puede empezar desde el principio cuando se intente de nuevo. [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- El almacenamiento web usa cuotas; una escritura que excede cuota puede fallar y el navegador puede desalojar datos por presión de almacenamiento. Los datos de un origen pueden borrarse juntos. [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- MDN recomienda cookies de sesión con Secure y HttpOnly cuando la arquitectura lo permita; HttpOnly evita que JavaScript lea directamente el identificador de sesión. Si se usan cookies, también hay que implementar defensas CSRF; SameSite es parte de la defensa, no una solución completa. [MDN: Session management](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Session_management)
- En el repo, Zustand persiste el token y perfil de sesión en localStorage bajo fiscalo.auth. [Repositorio: src/stores/auth.ts](../../src/stores/auth.ts)
- El cliente HTTP agrega el token de sesión a las solicitudes como Bearer. [Repositorio: src/api/http.ts](../../src/api/http.ts)
- En el POS, el token de equipo se persiste en localStorage bajo fiscalpoint.pos.equipo y la sesión del empleado solo permanece en memoria. [Repositorio: src/pos/store.ts](../../src/pos/store.ts)
- La configuración local de impresora/ancho de recibo se guarda en localStorage bajo fiscalo.impresora. [Repositorio: src/stores/impresora.ts](../../src/stores/impresora.ts)
- La sesión/caché de una instalación web está vinculada al navegador/origen de instalación y no se comparte automáticamente entre instalaciones hechas desde navegadores distintos. [MDN: Installing and uninstalling web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)

### Inferences
- El cliente de Fiscalo centraliza llamadas HTTP al backend y agrega el token Bearer de la sesión. [Repositorio: src/api/http.ts](../../src/api/http.ts)
- Dado que Fiscalo depende de una API remota, cachear los bundles solo ayuda al arranque de interfaz. Para ventas offline habría que persistir borradores/datos mínimos y encolar operaciones; el servidor debe aceptar reintentos de forma idempotente y resolver números fiscales, duplicados y conflictos antes de confirmar una factura. La arquitectura frontend revisada no demuestra soporte para eso. [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- Instalar la web como PWA no la mueve a una bóveda nativa ni elimina el riesgo de exposición de un token a JavaScript/XSS: el token se queda bajo el almacenamiento web. Conviene revisar el modelo de sesión y no guardar secretos de larga duración allí. Migrar de Bearer en localStorage a cookie HttpOnly implicaría coordinación con el backend y protección CSRF; es una mejora de arquitectura de autenticación, no una consecuencia automática de PWA.
- El POS ya distingue persistencia por equipo de sesión por empleado. La identidad de instalación/browser debe formar parte de los pasos operativos de soporte: cambiar de navegador/perfil, borrar datos del sitio o cambiar origen puede exigir volver a habilitar el equipo o iniciar sesión.

### Gaps
- No se revisó el backend API ni las reglas de secuencias/autorizaciones de comprobantes electrónicos de Fiscalo; falta confirmar qué operaciones podrían almacenarse como borradores offline y cuáles deben completarse en línea antes de asignar/emitir el e-CF.
- Deben especificarse los límites de cacheo de datos contables y fiscales, su expiración, borrado al cerrar sesión, cifrado local requerido y tratamiento de colas pendientes.

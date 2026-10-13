# Puente local para impresión en Fiscalo

Investigación enfocada en impresión e integración con periféricos, al 9 de octubre de 2026. La evidencia del repositorio se enlaza junto a la fuente; las recomendaciones se identifican como inferencias.

## ¿Qué permiten la impresión web y las APIs directas del navegador?

### Takeaway

Fiscalo ya usa el camino web más interoperable: prepara una página de recibo y abre el diálogo de impresión del navegador. WebUSB y Web Serial solo convienen después de validar una impresora y un navegador concretos; no dan una solución universal para POS. La nueva Web Printing API anunciada por Chromium apunta a Isolated Web Apps (IWA), no a una PWA web corriente.

### Cited Findings

- La impresión actual de tirillas crea un `iframe`, mide el contenido, agrega un `@page` de ancho y alto adecuados y llama a `window.print()`; si no puede imprimir el `iframe`, abre otra pestaña para que el usuario imprima. [Código: `src/lib/printHtml.ts`](../../src/lib/printHtml.ts) y [MDN: `Window.print()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/print). MDN define `print()` como apertura del diálogo y señala que bloquea mientras está abierto.
- El flujo POS pide los datos del recibo al API (`posApi.recibo(...)`) y luego reutiliza `reciboHtml(...)` y `printHtml(...)` al cobrar y al reimprimir. El cierre de caja también tiene una prueba de impresión. [Cobro POS](../../src/pos/CobroModal.tsx), [configuración y prueba de impresora](../../src/pos/CajaModales.tsx), [HTML de recibo](../../src/features/invoices/reciboHtml.ts).
- El ancho 80 mm es la selección por defecto; 76 y 72 mm también están configurados. El ancho y el modo web/PDF se persisten localmente en `localStorage`. [Configuración de impresora](../../src/features/settings/ImpresoraSection.tsx), [store local](../../src/stores/impresora.ts).
- WebUSB está marcado por MDN como de disponibilidad limitada, no Baseline y restringido a contextos seguros (HTTPS). Su propósito es exponer servicios de dispositivos USB no estandarizados. [MDN: WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API).
- En Chromium, `navigator.usb.requestDevice()` requiere gesto del usuario y presenta un selector de dispositivo; el permiso se concede por dispositivo. Las interfaces USB protegidas o reclamadas por drivers del sistema no están disponibles a través del WebUSB normal. [Chromium: Access USB devices on the web](https://developer.chrome.com/docs/capabilities/usb), [explicación de interfaces protegidas](https://github.com/whatwg/usb/blob/main/unrestricted-usb-explainer.md).
- Web Serial está disponible solo en contextos seguros y tampoco es Baseline. Sirve para puertos seriales o dispositivos USB/Bluetooth que el sistema expone como puerto serial; si el sitio no tiene permiso debe pedirlo con activación del usuario. [MDN: Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
- El anuncio de Intent to Ship de Web Printing API (11-feb-2026) la restringe explícitamente a Isolated Web Apps. La API propuesta puede enumerar impresoras, enviar trabajos y consultar estado. [Chromium Blink: Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/6MmqQj3mzcY), [explicación de la API](https://github.com/WICG/web-printing/blob/main/docs/explainer.md).
- La documentación de IWA dice que la salida inicial de IWAs y las APIs de alto privilegio está disponible solo para dispositivos ChromeOS administrados por Chrome Enterprise y socios selectos; los recursos deben empaquetarse en un Web Bundle firmado, no servirse como una web ordinaria. [Chrome for Developers: IWA](https://developer.chrome.com/docs/iwa/introduction).

### Inferences

- Si el requisito es “imprimir y confirmar en el diálogo”, conviene conservar `window.print()` como camino predeterminado: ya existe, soporta el HTML de recibo y evita instalar un runtime o acoplarse a un único navegador. La selección de impresora, escala y tamaño seguirá siendo una preferencia del navegador/OS, no una preferencia controlable por esta API web.
- Si el requisito es impresión automática/silenciosa, las APIs directas no son el primer camino para un parque de impresoras heterogéneo: requieren soporte concreto de interfaz y navegador, selección/permisos por usuario, y posiblemente renunciar al driver del OS. Probar Web Serial solo si el modelo expone COM/USB-serial; probar WebUSB solo si el vendor/protocolo y los drivers permiten abrir la interfaz.
- Web Printing API no es una alternativa de implementación inmediata para la app web actual. Evaluarla tendría sentido si Fiscalo decidiera controlar un entorno Chrome Enterprise/ChromeOS y aceptar el empaquetado/IWA. No debe asumirse disponibilidad general desde una PWA de Windows.

### Gaps

- No consta en el código la marca/modelo de las térmicas desplegadas, conexión (USB, serial, Ethernet), driver instalado, ni si todas hablan ESC/POS; sin eso no se puede elegir WebUSB/Serial ni validar salida raw.
- No está fijado si el usuario necesita impresión silenciosa, selección de impresora desde Fiscalo, reporte de estado/reintentos del spooler, o si el diálogo actual es suficiente.
- La API web de impresión/IWA sigue sujeta a disponibilidad y condiciones de Chromium; antes de cualquier decisión sobre IWA hay que confirmar la elegibilidad de los equipos concretos con Chrome Enterprise.

## ¿Qué puente local encaja con Fiscalo y qué implica?

### Takeaway

Si el dolor real es evitar el diálogo para las tirillas, mantendría React y las dos páginas web actuales, agregaría un adaptador opcional hacia un servicio local y conservaría el diálogo como fallback. QZ Tray es el primer candidato para una prueba corta porque ya ofrece impresión HTML/PDF y raw ESC/POS desde navegador; un agente propio tiene sentido si la flota es controlada y hace falta lógica/UX específica.

### Cited Findings

- QZ Tray instala una aplicación local que recibe llamadas JavaScript por WebSocket en `localhost`; su guía muestra enumerar impresoras del sistema y enviar jobs raw. La documentación lo describe como multiplataforma y compatible con navegadores mediante su cliente JavaScript. [QZ Tray: Getting Started](https://qz.io/docs/getting-started), [QZ Tray: Using QZ Tray](https://qz.io/docs/using-qz-tray).
- QZ soporta HTML, PDF y varios lenguajes de impresión raw, incluido ESC/POS. Sin embargo, QZ advierte que raw requiere driver compatible o uno genérico de texto, que ese driver genérico no imprime HTML/PDF/imágenes y que las órdenes dependen de la guía del fabricante. [QZ Tray: Raw printing](https://qz.io/docs/raw).
- La impresión silenciosa de QZ exige firmar cada llamada privilegiada. Su documentación recomienda la firma en servidor y dice que las claves/certificados comerciales para quitar los avisos se generan para clientes Premium Support, Company Branded o Premium Sponsored. La clave privada va en el backend, no en el bundle cliente. [QZ Tray: Signing](https://qz.io/docs/signing).
- La guía de QZ explica instalación/certificado local para conexiones HTTPS/WebSocket y que la integración desde Firefox requiere pasos adicionales. [QZ Tray: Using QZ Tray](https://qz.io/docs/using-qz-tray).
- Chrome 142 añadió permiso de Local Network Access para solicitudes de un sitio público hacia loopback/red local, con el objetivo expreso de reducir CSRF contra servicios/dispositivos locales. En el artículo de lanzamiento, Chromium anota que WebSockets aún no estaban cubiertos por ese permiso; esa nota corresponde al estado documentado en 2025 y hay que verificar el comportamiento de las versiones de navegador usadas en octubre de 2026. [Chrome for Developers: LNA](https://developer.chrome.com/blog/local-network-access).
- El repo compila una entrada `app.html` y otra `pos.html`; los comentarios identifican `app.fiscalpoint.com.do` y `pos.fiscalpoint.com.do` como páginas/orígenes separados. El POS sigue usando API remoto y el handoff de app a POS se canjea en el backend. [Vite config](../../vite.config.ts), [cliente API POS](../../src/pos/api.ts), [canje del handoff](../../src/pos/PosApp.tsx).
- La respuesta de recibo del API se renderiza en HTML en el cliente antes de imprimir. En producción, el cliente HTTP usa `VITE_API_BASE_URL` para llegar al backend, de modo que el agente de impresión puede limitarse a recibir un trabajo ya preparado; no necesita sustituir el backend. [API config](../../src/api/config.ts), [render del recibo](../../src/features/invoices/reciboHtml.ts), [uso en caja](../../src/pos/CobroModal.tsx).

### Inferences

- Arquitectura propuesta: conservar `app.fiscalpoint.com.do` y `pos.fiscalpoint.com.do`; centralizar una interfaz `ImpresoraLocal` en el frontend; implementarla primero con QZ Tray y usar el `printHtml()` actual si su salida HTML queda igual de bien en las impresoras probadas. Si no logra corte/QR/avance consistentes, pasar a ESC/POS raw solo para modelos validados. Con la impresora local no disponible, devolver al usuario al flujo actual del diálogo.
- QZ Tray es la prueba inicial de menor trabajo propio, pero tiene una decisión comercial: eliminar avisos y habilitar impresión silenciosa requiere firma/certificado según el proveedor; el contrato y precio actuales deben confirmarse antes de elegirlo. Para una prueba con confirmación manual se puede evaluar primero el modo con diálogo de autorización.
- Si QZ no cubre la flota o el producto necesita controlar la UX de instalación/configuración, un agente ligero propio (por ejemplo, un tray app/servicio Windows) puede usar el spooler de Windows, un SDK del fabricante o ESC/POS. Esto evita envolver toda la interfaz, pero Fiscalo se hace cargo del instalador, autoarranque, actualizaciones, compatibilidad de drivers/protocolos, firma/certificados, soporte y telemetría de fallos.
- Tratar el puente como un endpoint privilegiado de la máquina: bind solo a loopback; permitir únicamente los orígenes concretos de la app y POS; exigir pairing/credencial de corto alcance para el dispositivo; validar esquema/tamaño del trabajo; aceptar solo operaciones de impresión previstas; no permitir comandos arbitrarios, acceso a archivos o URLs arbitrarias. No pasarle el Bearer, token de equipo, token del cajero ni API key de Fiscalo. Esta recomendación se deriva del riesgo CSRF que describe Chromium y del hecho de que QZ firma operaciones privilegiadas; CORS por sí solo no autoriza una solicitud.
- La integración debe incluir las dos páginas/orígenes, ya que el flujo POS es una web aparte. La configuración local existente guarda ancho y modo, pero un destino de impresora seleccionado por nombre debería quedar en el agente/OS o en una configuración explícita del equipo; no asumir que `localStorage` se comparte entre ambos orígenes.
- Una secuencia de implementación evaluable sería: (1) mantener el diálogo como opción predeterminada y registrar modelos/driver; (2) prototipar QZ Tray con el recibo de prueba de la caja y un cobro/reimpresión real de ensayo; (3) medir ancho/alto, margen, QR, avance/corte, idioma/caracteres, reconexión y estado de job; (4) solo si QZ/contrato no encajan, hacer spike del agente propio. No hay que reescribir el dominio ni mover la emisión de e-CF al agente.

### Gaps

- Hace falta un inventario de modelos de impresora, interfaces, sistemas operativos y versiones de Chrome/Edge/Firefox, además de comprobar permisos para instalar un cliente local en cada caja.
- No se puede determinar el costo de QZ para Fiscalo solo con el repo; la documentación vincula firma silenciosa y emisión de certificado a paquetes de soporte/personalización. Cotizar y revisar términos/licencia vigentes.
- No se encontró en el repo una firma de mensajes para impresión. Si se usa QZ en producción con silencio, habrá que diseñar una ruta de firma en el backend remoto y mantener su clave privada en servidor. No se puede poner esa clave en `VITE_*` ni en React.
- La política concreta de Local Network Access / WebSocket en el navegador desplegado cambia con versiones; validar QZ y cualquier agente HTTP local bajo las versiones de Chrome/Edge administradas, incluido el permiso/denegación por el usuario.
- Si la impresora es de red y no está conectada al PC de la caja, no se sabe si debe conectarse directamente a la impresora o a un servidor LAN compartido. Esa topología cambiaría el diseño de identidad, permisos y fallos.

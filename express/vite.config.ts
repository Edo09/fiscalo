import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { objetivoProxy } from './dev/loopback.mjs'
import { budget, compilacionActual, forbiddenModuleGuard, versionJson } from './dev/plugins.mjs'

/**
 * Express es una app aparte: la raíz de Vite es esta carpeta (`express/`), no `fiscalo/`.
 * Este archivo no carga variables de entorno por su cuenta y `envDir` es esta carpeta, así que el `.env` de la raíz (cuyo proxy
 * apunta a producción) nunca se lee. El proxy de /api va solo adonde diga `objetivoProxy` (dev/loopback.mjs): el mock local, o un
 * destino loopback que se pida con EXPRESS_API_TARGET; cualquier otro lo rechaza.
 *
 * Se invoca desde `fiscalo/`: `vite build --config express/vite.config.ts`. El servidor de desarrollo se arranca con
 * `node express/dev/run.mjs`, que levanta también el mock.
 */
const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url))

// Una sola vez: `define.__BUILD_ID__` (el BUILD_ID de la app) y version.json llevan el mismo valor, y la app los compara.
const compilacion = compilacionActual()

export default defineConfig(({ command }) => ({
  root: aqui('.'),
  envDir: aqui('.'),
  // La guardia falla el build si entra un módulo prohibido de fiscalo/src (anexo 3.3); budget mide el peso del build (avisa, y rompe el
  // build si zod cae en el arranque); versionJson escribe version.json.
  plugins: [react(), forbiddenModuleGuard(), budget(), versionJson(compilacion)],
  resolve: {
    alias: {
      '@': aqui('../src'), // fiscalo/src, solo por las rutas exactas permitidas
      '~': aqui('./src'), // express/src
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(compilacion.version),
    // Definidas vacías a propósito: sin esto, una VITE_API_BASE_URL, VITE_API_KEY o VITE_TENANT_ID exportada en el shell llegaría a
    // import.meta.env (src/api/config.ts las lee) y redirigiría la página de desarrollo o quedaría escrita en el bundle.
    'import.meta.env.VITE_API_BASE_URL': '""',
    'import.meta.env.VITE_API_KEY': '""',
    'import.meta.env.VITE_TENANT_ID': '""',
    // Express se anuncia ante la API en cada petición (cabecera X-Fiscalpoint-Edicion, src/api/config.ts): una empresa que usa la app completa
    // y Express recibe los límites y el bloque de Express solo en estas peticiones, y la app completa (que no define esto) queda como siempre.
    'import.meta.env.VITE_EDICION_CLIENTE': '"express"',
  },
  build: {
    // Piso de navegadores: Chrome y WebView 90, Safari e iOS 14.5.
    target: ['chrome90', 'safari14'],
    cssTarget: ['chrome90', 'safari14'],
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    open: false,
    // Los imports `@/...` salen de la raíz de Vite (express/) hacia fiscalo/src.
    fs: { allow: ['..'] },
    // Solo en `serve`: un build no tiene proxy y no debe fallar por un EXPRESS_API_TARGET que no le importa. En `serve`, un destino que no
    // sea loopback hace fallar la carga de esta configuración, también si se arranca `vite` sin pasar por run.mjs.
    proxy: command === 'serve' ? { '/api': { target: objetivoProxy(process.env) } } : undefined,
  },
}))

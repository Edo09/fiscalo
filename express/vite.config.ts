import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { budget, compilacionActual, forbiddenModuleGuard, versionJson } from './dev/plugins.mjs'

/**
 * Express es una app aparte: la raíz de Vite es esta carpeta (`express/`), no `fiscalo/`.
 * No se usa `loadEnv` y `envDir` es esta carpeta, así que el `.env` de la raíz (cuyo proxy
 * apunta a producción) nunca se lee.
 *
 * Se invoca desde `fiscalo/`: `vite build --config express/vite.config.ts`.
 */
const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url))

// Una sola vez: `define.__BUILD_ID__` (el BUILD_ID de la app) y version.json llevan el mismo valor, y la app los compara.
const compilacion = compilacionActual()

export default defineConfig({
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
  },
})

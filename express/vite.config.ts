import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { forbiddenModuleGuard } from './dev/plugins.mjs'

/**
 * Express es una app aparte: la raíz de Vite es esta carpeta (`express/`), no `fiscalo/`.
 * No se usa `loadEnv` y `envDir` es esta carpeta, así que el `.env` de la raíz (cuyo proxy
 * apunta a producción) nunca se lee.
 *
 * Se invoca desde `fiscalo/`: `vite build --config express/vite.config.ts`.
 */
const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url))

export default defineConfig({
  root: aqui('.'),
  envDir: aqui('.'),
  plugins: [react(), forbiddenModuleGuard()], // la guardia falla el build si entra a un módulo prohibido de fiscalo/src (anexo 3.3)
  resolve: {
    alias: {
      '@': aqui('../src'), // fiscalo/src, solo por las rutas exactas permitidas
      '~': aqui('./src'), // express/src
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify('dev'),
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

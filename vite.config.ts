import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Carga TODAS las variables (incluidas las sin prefijo VITE_), que solo
  // viven en el proceso de Node (no se exponen al navegador).
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      open: true,
      // Dev-proxy: el navegador llama a /api (mismo origen) y Vite reenvía
      // al backend real inyectando la clave. Así X-API-KEY no llega al cliente.
      proxy: proxyTarget
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
              headers: env.API_KEY ? { 'X-API-KEY': env.API_KEY } : undefined,
            },
          }
        : undefined,
    },
  }
})

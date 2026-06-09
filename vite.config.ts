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
      // Dev-proxy: el navegador llama a /api (mismo origen) y Vite lo reenvía al
      // backend real. Reenvía tal cual las cabeceras del cliente, incluido el
      // `Authorization: Bearer <token>` de la sesión (POST /api/auth/login).
      //
      // NO se inyecta X-API-KEY: el backend prioriza X-API-KEY sobre el Bearer,
      // así que un X-API-KEY fijo del proxy anularía el login por usuario. Si se
      // define API_KEY se manda solo como respaldo cuando el cliente no envía
      // Authorization (p. ej. integración o pruebas sin sesión).
      proxy: proxyTarget
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
              configure: env.API_KEY
                ? (proxy) => {
                    proxy.on('proxyReq', (proxyReq) => {
                      if (!proxyReq.getHeader('authorization')) {
                        proxyReq.setHeader('X-API-KEY', env.API_KEY)
                      }
                    })
                  }
                : undefined,
            },
          }
        : undefined,
    },
  }
})

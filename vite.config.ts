import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * En el build, la página de la app sale como `app.html` y no como `index.html`.
 *
 * Vercel sirve primero el archivo que exista y SOLO después aplica los
 * `rewrites` de vercel.json. Con un `index.html` en la raíz, `/` siempre
 * entregaba la app, también en pos.fiscalpoint.com.do (la regla de host no se
 * llegaba a mirar). Sin archivo en `/`, cada host cae en su regla: pos.* →
 * /pos.html y el resto → /app.html.
 *
 * En desarrollo no cambia nada: Vite sigue sirviendo index.html en `/`.
 */
function appHtmlSinIndex(): Plugin {
  return {
    name: 'fiscalpoint:app-html-sin-index',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opciones, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') {
        this.error('No salió index.html del build: revisa build.rollupOptions.input.')
      }
      delete bundle['index.html']
      this.emitFile({ type: 'asset', fileName: 'app.html', source: html.source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Carga TODAS las variables (incluidas las sin prefijo VITE_), que solo
  // viven en el proceso de Node (no se exponen al navegador).
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET

  return {
    plugins: [react(), appHtmlSinIndex()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Dos paginas: la app (app.fiscalpoint.com.do -> index.html, que en el build
    // sale como app.html; ver appHtmlSinIndex) y el POS (pos.fiscalpoint.com.do ->
    // pos.html, por la regla de host de vercel.json).
    // El POS no importa App.tsx: su bundle solo trae lo que usa. En desarrollo
    // se abre en http://localhost:5173/pos.html.
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          pos: fileURLToPath(new URL('./pos.html', import.meta.url)),
        },
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

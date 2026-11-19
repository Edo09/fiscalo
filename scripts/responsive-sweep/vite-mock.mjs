// Arranca el Vite del repo apuntando a la API falsa (mock-api.mjs); jamas a produccion.
// Uso: node scripts/responsive-sweep/vite-mock.mjs [--api=http://127.0.0.1:8795] [--port=5184]
//        [--repo=<carpeta del codigo a medir>] [--allow=<carpeta con node_modules>] [--cache=<carpeta>]
// Sirve ademas la pagina del barrido en /__sweep.html (el sweep.html de esta carpeta, no el del --repo).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const api = String(args.api || 'http://127.0.0.1:8795')
const port = Number(args.port || 5184)
// Por defecto, el repo donde vive esta carpeta. Con --repo se mide otro (p. ej. un worktree del commit anterior).
const repo = path.resolve(String(args.repo || path.join(here, '..', '..')))
const cache = path.resolve(String(args.cache || path.join(os.tmpdir(), 'fiscalo-sweep', 'vite-cache-' + port)))
// Un worktree con node_modules enlazado (junction) necesita permiso para servir archivos de la carpeta real.
const allow = args.allow ? String(args.allow).split(',').map((p) => path.resolve(p)) : []

const host = new URL(api).hostname
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
  console.error('Rechazado: el destino de la API no es local:', api)
  process.exit(2)
}

// Las variables del proceso ganan sobre .env (loadEnv con prefijo '').
process.env.API_PROXY_TARGET = api
process.env.API_KEY = ''
process.env.VITE_API_BASE_URL = ''

const sweepFile = path.join(here, 'sweep.html')
const sweepPlugin = {
  name: 'sweep-harness',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.split('?')[0] === '/__sweep.html') {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(fs.readFileSync(sweepFile))
        return
      }
      next()
    })
  },
}

const vite = await import(pathToFileURL(path.join(repo, 'node_modules/vite/dist/node/index.js')).href)
const server = await vite.createServer({
  root: repo,
  cacheDir: cache,
  plugins: [sweepPlugin],
  server: { port, strictPort: true, open: false, host: '127.0.0.1', fs: { allow: [repo, ...allow] } },
})
await server.listen()
console.log('vite-mock up on', port, '->', api, 'repo:', repo)

/**
 * Config de Vite del stub S0 de Express (spike descartable, ver el runbook R3).
 *
 * La config vive en express/ y se invoca desde la raiz del repo:
 *   npx vite build --config express/vite.config.ts
 * Por eso `root` apunta a su propia carpeta (sin esto, Vite tomaria la raiz del
 * repo y buscaria su index.html). `envDir` tambien: el .env de la raiz del repo,
 * que en desarrollo apunta a PRODUCCION, nunca se lee.
 *
 * `server.fs.allow` mide el desarrollo local, no Vercel: con `root` = express/,
 * Vite solo sirve por su cuenta archivos de esa carpeta, y main.ts importa de ../../src.
 * Se mide pidiendo montosLinea.ts por la ruta /@fs/ EN FRIO (primera peticion de un
 * servidor recien arrancado): sin S0_FS_ALLOW=1 da 403; con S0_FS_ALLOW=1 da 200.
 * El orden importa: Vite da por seguro el modulo que otro modulo ya servido importa
 * (config.safeModulePaths), asi que despues de servir /src/main.ts ese mismo /@fs/
 * da 200 aun sin S0_FS_ALLOW=1. Lo que mide el spike es la peticion directa en frio.
 */
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const carpeta = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: carpeta,
  envDir: carpeta,
  build: { outDir: 'dist' },
  server: process.env.S0_FS_ALLOW === '1' ? { fs: { allow: ['..'] } } : {},
})

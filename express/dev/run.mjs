// Arranca Express en desarrollo: el mock de la API y el servidor de Vite, juntos y solo en loopback.
//
// Uso: node express/dev/run.mjs     (desde fiscalo/)
//      npm run dev                  (dentro de express/)
//
// Express se desarrolla únicamente contra el mock. El .env de la raíz proxia a PRODUCCIÓN y aquí no se lee (el `envDir` de
// vite.config.ts es express/), y el destino del proxy pasa por objetivoProxy, que rechaza todo lo que no sea loopback. Por eso Express se
// arranca con este archivo (la entrada `express-dev` de .claude/launch.json lo corre), y no con un `vite` suelto desde fiscalo/ ni con
// otra entrada del launch.json: esos usan la configuración de la app completa, cuyo proxy apunta a producción.
//
// Orden: 1. se comprueba el destino del proxy y, si no es loopback, se sale con 1 sin haber arrancado nada; 2. se arranca el mock como
// proceso hijo y se espera a que acepte conexiones; 3. se arranca Vite con express/vite.config.ts; 4. al salir se cierra todo.
//
// Variable opcional: EXPRESS_API_TARGET, un destino loopback para el proxy de /api (por omisión, el mock). El mock se arranca siempre.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { OBJETIVO_MOCK, objetivoProxy } from './loopback.mjs'

// Las rutas salen de este archivo y no del directorio de trabajo: `node express/dev/run.mjs` desde fiscalo/ y `npm run dev` dentro de
// express/ valen igual.
const RUTA_MOCK = fileURLToPath(new URL('./mock-api.mjs', import.meta.url))
const RAIZ_VITE = fileURLToPath(new URL('../', import.meta.url))
const CONFIG_VITE = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

const { hostname: HOST_MOCK, port: PUERTO_MOCK } = new URL(OBJETIVO_MOCK)
const ESPERA_MOCK_MS = 5000

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** ¿Acepta alguien conexiones en `host:puerto`? */
function aceptaConexiones(host, puerto) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: puerto })
    const terminar = (acepta) => {
      socket.destroy()
      resolve(acepta)
    }
    socket.setTimeout(500, () => terminar(false))
    socket.once('connect', () => terminar(true))
    socket.on('error', () => terminar(false)) // `on` y no `once`: un error después de destruir el socket no puede quedar sin oyente
  })
}

let mock = null // el proceso hijo del mock
let vite = null // el servidor de Vite
let cerrando = false

/**
 * Mata el mock y cierra Vite; la primera llamada manda. El proceso termina por sí solo con `codigo` cuando ya no queda nada abierto (así lo
 * que se escribió en stderr llega entero), y a los 3 s a la fuerza si algo se queda abierto.
 */
async function cerrar(codigo) {
  if (cerrando) return
  cerrando = true
  process.exitCode = codigo
  setTimeout(() => process.exit(codigo), 3000).unref()
  mock?.kill()
  await vite?.close().catch(() => {})
}

for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(senal, () => void cerrar(0))
process.on('exit', () => {
  mock?.kill() // salga como salga el proceso, el mock no se queda suelto
})

async function main() {
  let destino
  try {
    destino = objetivoProxy(process.env)
  } catch (error) {
    console.error(`[express] ${error.message}`)
    process.exitCode = 1
    return
  }

  // Algo ya escucha ahí (otro run.mjs, o un mock que quedó suelto): se rechaza en vez de hablar con un proceso que no es este mock.
  if (await aceptaConexiones(HOST_MOCK, Number(PUERTO_MOCK))) {
    console.error(`[express] Ya hay algo escuchando en ${OBJETIVO_MOCK}: otro \`node express/dev/run.mjs\` o un mock suelto. Ciérralo y vuelve a intentarlo.`)
    process.exitCode = 1
    return
  }

  let cayo = false
  const caido = (motivo) => {
    cayo = true
    if (cerrando) return
    console.error(`[express] ${motivo}; cierro Express.`)
    void cerrar(1)
  }
  mock = spawn(process.execPath, [RUTA_MOCK, `--host=${HOST_MOCK}`, `--port=${PUERTO_MOCK}`], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
  mock.once('error', (error) => caido(`No se pudo arrancar el mock: ${error.message}`))
  mock.once('exit', (codigo, senal) => caido(`El mock de la API se detuvo (${senal ?? `código ${codigo}`})`))

  const limite = Date.now() + ESPERA_MOCK_MS
  let listo = false
  while (!cayo && !listo && Date.now() < limite) {
    listo = await aceptaConexiones(HOST_MOCK, Number(PUERTO_MOCK))
    if (!listo) await esperar(100)
  }
  if (cayo) return // el aviso ya salió y el cierre está en marcha
  if (!listo) {
    console.error(`[express] El mock no respondió en ${OBJETIVO_MOCK} en ${ESPERA_MOCK_MS / 1000} s; cierro Express.`)
    return cerrar(1)
  }

  try {
    vite = await createServer({ configFile: CONFIG_VITE, root: RAIZ_VITE, clearScreen: false })
    await vite.listen()
  } catch (error) {
    console.error(`[express] No se pudo arrancar Vite: ${error.message}`)
    return cerrar(1)
  }
  console.log(`[express] el proxy de /api va a ${destino}`)
  vite.printUrls()
}

main().catch((error) => {
  console.error(`[express] ${error?.stack ?? error}`)
  void cerrar(1)
})

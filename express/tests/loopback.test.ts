// El runner de desarrollo de Express solo habla con el mock en loopback. Esta prueba cubre la regla (esLoopback y objetivoProxy), el
// programa (run.mjs la aplica antes de arrancar nada) y lo que vite.config.ts hace con ella: el proxy de /api y las tres variables de
// VITE_ que no deben llegar ni a la página de desarrollo ni al bundle. Los archivos se leen desde la ubicación de esta prueba, no
// desde el directorio de trabajo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { esLoopback, objetivoProxy } from '../dev/loopback.mjs'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/
const RUN = fileURLToPath(new URL('../dev/run.mjs', import.meta.url))
const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

// La clave de `define` de una variable de VITE_. Se arma por partes a propósito: hooks.mjs sustituye el texto `import.meta.env` en todo
// .ts que carga el corredor, también dentro de un string o de una plantilla, y escrito de corrido esta prueba buscaría otra cosa.
const claveEnv = (variable: string): string => ['import', 'meta', 'env', variable].join('.')
const VARIABLES_VACIAS = ['VITE_API_BASE_URL', 'VITE_API_KEY', 'VITE_TENANT_ID']

test('esLoopback', () => {
  for (const u of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) assert.equal(esLoopback(u), true, u)
  for (const u of ['https://smh.ynz.temporary.site', 'http://127.0.0.1.evil.com', 'http://evil.com/@127.0.0.1', 'http://user:pw@evil.com',
    'http://0.0.0.0:8787', 'ftp://127.0.0.1', '', 'not a url']) assert.equal(esLoopback(u), false, u)
})

test('objetivoProxy', () => {
  assert.equal(objetivoProxy({}), 'http://127.0.0.1:8787')
  assert.throws(() => objetivoProxy({ EXPRESS_API_TARGET: 'https://api.example.com' }))
  assert.throws(() => objetivoProxy({ EXPRESS_ALLOW_PROD: '1', EXPRESS_API_TARGET: 'https://api.example.com' }))   // el override no existe: se ignora
})

test('vite.config no lee el .env de la raiz', () => {
  const t = leer('express/vite.config.ts')
  assert.ok(!/loadEnv|API_PROXY_TARGET/.test(t))
  assert.ok(t.includes('objetivoProxy'))
  for (const k of VARIABLES_VACIAS) assert.ok(t.includes(claveEnv(k)), k)   // definidas vacias: una variable del shell no llega al bundle
})

// --- Destinos loopback que no son el mock, y el texto del rechazo -------------------------------------------------------------

test('objetivoProxy: un destino loopback se respeta (sin espacios) y uno vacío cae al mock', () => {
  for (const destino of ['http://127.0.0.1:9000', 'http://localhost:8787', 'http://[::1]:8787', 'https://127.0.0.1:8443']) {
    assert.equal(objetivoProxy({ EXPRESS_API_TARGET: destino }), destino)
  }
  assert.equal(objetivoProxy({ EXPRESS_API_TARGET: '  http://localhost:9000 \n' }), 'http://localhost:9000')
  for (const vacio of ['', '   ', undefined]) assert.equal(objetivoProxy({ EXPRESS_API_TARGET: vacio }), 'http://127.0.0.1:8787', `valor: ${JSON.stringify(vacio)}`)
})

test('objetivoProxy: el rechazo es un Error en español que nombra la regla y no repite credenciales', () => {
  const rechazados = [
    'https://api.example.com',
    'https://usuario:secreto@api.example.com/api?clave=abc123',
    'http://0.0.0.0:8787',
    'ftp://127.0.0.1',
    'sk-secreto-sin-forma-de-url',
  ]
  for (const destino of rechazados) {
    assert.throws(
      () => objetivoProxy({ EXPRESS_API_TARGET: destino, EXPRESS_ALLOW_PROD: '1' }),
      (error: unknown) => {
        assert.ok(error instanceof Error, destino)
        assert.match(error.message, /EXPRESS_API_TARGET/, destino)
        assert.match(error.message, /127\.0\.0\.1, localhost o \[::1\]/, destino) // la regla: solo loopback
        assert.match(error.message, /No hay ninguna variable que levante esta regla/, destino) // y no hay forma de saltarla
        assert.doesNotMatch(error.message, /secreto|abc123/, destino) // el valor recibido no se repite: puede llevar credenciales
        return true
      },
      destino,
    )
  }
  // Lo que sí dice es adónde apuntaba, sin usuario, ruta ni query.
  assert.throws(() => objetivoProxy({ EXPRESS_API_TARGET: 'https://usuario:secreto@api.example.com/api?clave=abc123' }), /apunta a https:\/\/api\.example\.com[,.]/)
})

// --- run.mjs como programa ----------------------------------------------------------------------------------------------------

test('run.mjs: con un destino que no es loopback sale con 1, dice la regla y no arranca nada', () => {
  // Si la guardia no corriera antes de arrancar, run.mjs levantaría el mock y Vite y esta llamada agotaría el tiempo (status null).
  // El directorio de trabajo es otro a propósito: las rutas de run.mjs salen de su propio archivo.
  const r = spawnSync(process.execPath, [RUN], {
    cwd: tmpdir(),
    env: { ...process.env, EXPRESS_API_TARGET: 'https://example.com', EXPRESS_ALLOW_PROD: '1' },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(r.status, 1, `${r.error ?? ''}${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /^\[express\] EXPRESS_API_TARGET apunta a https:\/\/example\.com,/)
  assert.match(r.stderr, /127\.0\.0\.1, localhost o \[::1\]/)
  assert.equal(r.stdout, '', 'ni el mock ni Vite llegaron a escribir nada')
})

// --- vite.config.ts, leído por el cargador de configuración de Vite ----------------------------------------------------------
// No se importa con `import()`: hooks.mjs sustituye `import.meta.env` en todo archivo .ts que carga Node, también dentro de un string,
// y las claves de `define` saldrían cambiadas. Vite carga su configuración por su cuenta, que es lo que corre en el build y en `run.mjs`.

test('vite.config: el proxy /api solo existe en serve y solo hacia loopback; las tres variables de VITE_ salen vacías', async () => {
  const { resolveConfig } = await import('vite')
  const resolver = (comando: 'serve' | 'build'): Promise<any> => resolveConfig({ configFile: CONFIG, logLevel: 'silent' }, comando)
  const objetivo = (config: any): unknown => config.server.proxy?.['/api']?.target

  const entorno = { EXPRESS_API_TARGET: process.env.EXPRESS_API_TARGET, NODE_ENV: process.env.NODE_ENV }
  const restaurar = (clave: 'EXPRESS_API_TARGET' | 'NODE_ENV'): void => {
    if (entorno[clave] === undefined) delete process.env[clave]
    else process.env[clave] = entorno[clave]
  }
  try {
    delete process.env.EXPRESS_API_TARGET
    const porOmision = await resolver('serve')
    assert.deepEqual(Object.keys(porOmision.server.proxy), ['/api'])
    assert.equal(objetivo(porOmision), 'http://127.0.0.1:8787')
    for (const k of VARIABLES_VACIAS) assert.equal(porOmision.define[claveEnv(k)], '""', k)

    process.env.EXPRESS_API_TARGET = 'http://localhost:9000'
    assert.equal(objetivo(await resolver('serve')), 'http://localhost:9000')

    process.env.EXPRESS_API_TARGET = 'https://api.example.com'
    await assert.rejects(resolver('serve'), /EXPRESS_API_TARGET apunta a https:\/\/api\.example\.com/)

    // El build no tiene proxy: ahí el destino no cuenta y un EXPRESS_API_TARGET ajeno, que a nadie le sirve en un build, no lo rompe.
    const build = await resolver('build')
    assert.equal(build.server.proxy, undefined)
    for (const k of VARIABLES_VACIAS) assert.equal(build.define[claveEnv(k)], '""', k)
  } finally {
    restaurar('EXPRESS_API_TARGET')
    restaurar('NODE_ENV') // Vite lo fija si no estaba puesto
  }
})

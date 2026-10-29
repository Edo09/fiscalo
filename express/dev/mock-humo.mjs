// Humo del mock de Express: entra con cada una de las diez personas contra un mock que YA está corriendo y comprueba lo mínimo para
// saber que sirve: que todas entran, que las dos sin bloque salen sin `user.entitlements`, que admin.e32 solo tiene los tipos 32 y 34
// y que la lista de admin.e45 responde 200 con una página de 15 filas.
//
// Uso: node express/dev/mock-humo.mjs [--host=127.0.0.1] [--port=8787]     (con el mock en marcha: node express/dev/mock-api.mjs)
//
// Escribe una línea por persona (estado del login, si trae bloque y sus tipos) y sale con 0 si todo está bien, con 1 si una
// comprobación falla o no hay mock escuchando, y con 2 si los argumentos no valen. Solo habla con 127.0.0.1, ni siquiera con
// localhost: el mock es de este equipo y sus datos son de prueba. No imprime contraseñas ni tokens. Como el resto de las herramientas
// de Express termina fijando `process.exitCode` y no con `process.exit`, para que lo que se escribió llegue entero.
import { PERSONAS } from './mock-api.mjs'

const USO = 'Uso: node express/dev/mock-humo.mjs [--host=127.0.0.1] [--port=8787]'
const HOST_UNICO = '127.0.0.1'
const ESPERA_MS = 15000 // la persona `slow` tarda 2 s en entrar

/** @returns {{ error: string } | { host: string, puerto: number }} */
function leerArgumentos(/** @type {string[]} */ args) {
  let host = HOST_UNICO
  let puerto = 8787
  for (const a of args) {
    const m = /^--(host|port)=(.*)$/.exec(a)
    if (!m) return { error: `Argumento desconocido: "${a}". ${USO}` }
    if (m[1] === 'host') host = m[2]
    else if (/^\d{1,5}$/.test(m[2]) && Number(m[2]) <= 65535) puerto = Number(m[2])
    else return { error: `El puerto "${m[2]}" no es válido. ${USO}` }
  }
  if (host !== HOST_UNICO) return { error: `El humo solo habla con ${HOST_UNICO}, no con "${host}": el mock es de este equipo y sus datos son de prueba.` }
  return { host, puerto }
}

/** Una petición al mock; devuelve el estado HTTP y el JSON (null si el cuerpo no lo era). */
async function pedir(/** @type {string} */ base, /** @type {string} */ ruta, /** @type {{ metodo?: string, token?: string, cuerpo?: unknown }} */ { metodo = 'GET', token, cuerpo } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(ESPERA_MS),
  })
  return { http: respuesta.status, json: await respuesta.json().catch(() => null) }
}

async function main(/** @type {string[]} */ args) {
  const leidos = leerArgumentos(args)
  if ('error' in leidos) {
    console.error(leidos.error)
    process.exitCode = 2
    return
  }
  const base = `http://${leidos.host}:${leidos.puerto}`
  const fallos = []
  let tokenAdminE45 = null // solo en memoria, para pedir la lista; nunca se imprime

  try {
    for (const nombre of Object.keys(PERSONAS)) {
      const r = await pedir(base, '/api/auth/login', { metodo: 'POST', cuerpo: { emailOrUsername: nombre, password: `mock-${nombre}` } })
      const usuario = r.json?.data?.user ?? null
      const bloque = usuario?.entitlements ?? null
      const tipos = Array.isArray(bloque?.tipos_ecf) ? bloque.tipos_ecf.join(',') : '-'
      console.log(`${nombre.padEnd(18)} login ${r.http}  bloque ${bloque ? 'sí' : 'no'}  tipos ${tipos}`)

      if (r.http !== 200 || !r.json?.data?.token) {
        fallos.push(`${nombre}: el login no contestó 200 con un token`)
        continue
      }
      if (nombre === 'admin.e45') tokenAdminE45 = r.json.data.token
      if ((nombre === 'admin.sinbloque' || nombre === 'admin.completa') && usuario !== null && 'entitlements' in usuario) fallos.push(`${nombre}: no debería traer user.entitlements`)
      if (nombre === 'admin.e32' && tipos !== '32,34') fallos.push(`${nombre}: sus tipos deberían ser solo 32 y 34 y son ${tipos}`)
    }

    if (tokenAdminE45 !== null) {
      const lista = await pedir(base, '/api/facturas?page=1&pageSize=15&lean=1&archivadas=0', { token: tokenAdminE45 })
      const filas = Array.isArray(lista.json?.data) ? lista.json.data.length : null
      console.log(`lista de admin.e45: ${lista.http}, ${filas ?? 'sin'} filas`)
      if (lista.http !== 200 || filas !== 15) fallos.push(`admin.e45: la lista debería contestar 200 con 15 filas y contestó ${lista.http} con ${filas ?? 'ninguna'}`)
    }
  } catch (error) {
    const causa = /** @type {any} */ (error)?.cause?.code ?? /** @type {any} */ (error)?.message ?? String(error)
    console.error(`No pude hablar con el mock en ${base} (${causa}). ¿Está corriendo \`node express/dev/mock-api.mjs\`?`)
    process.exitCode = 1
    return
  }

  if (fallos.length > 0) {
    for (const f of fallos) console.error(`FALLA: ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`Humo del mock: bien (${Object.keys(PERSONAS).length} personas).`)
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`[humo] ${error?.stack ?? error}`)
  process.exitCode = 1
})

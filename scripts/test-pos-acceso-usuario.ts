// Qué le toca a un usuario de FiscalPoint que llega al POS (src/pos/accesoUsuario.ts):
// crear su PIN, escribir el que tiene o saber por qué no entra; y qué se hace con cada
// error al crear el PIN.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-acceso-usuario.ts
import { destinoTrasAcceso, salidaAlFallarCrearPin, type DestinoAcceso, type SalidaAlFallarCrearPin } from '../src/pos/accesoUsuario.ts'
import type { MiAcceso } from '../src/pos/api.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

const acceso = (p: Partial<MiAcceso>): MiAcceso => ({
  elegible: true, motivo: null, mensaje: null, tiene_pin: false,
  empleado: { id: 7, nombre: 'Ana Pérez', rol: 'cajero' },
  ...p,
})

console.log('Qué le toca tras identificarse')
let d: DestinoAcceso = destinoTrasAcceso(acceso({}), true)
chk('elegible y sin PIN: crea su PIN, y se le saluda con su nombre', d.destino === 'crear-pin' && d.nombre === 'Ana Pérez', d)

d = destinoTrasAcceso(acceso({ tiene_pin: true }), true)
chk('elegible con PIN: al teclado del PIN, con un saludo', d.destino === 'pin' && d.aviso?.tono === 'info' && d.aviso.texto.startsWith('Hola, Ana Pérez. Ya tienes PIN: escríbelo para entrar.'), d)
chk('...y le dice que, si lo olvidó, lo restablece un administrador (no se crea otro por esta vía)', d.destino === 'pin' && /administrador puede restablecerlo/.test(d.aviso?.texto ?? ''), d)

d = destinoTrasAcceso(acceso({ tiene_pin: true }), false)
chk('el saludo sale aunque no se pida avisar (es un aviso de que entra, no de que no entra)', d.destino === 'pin' && d.aviso?.tono === 'info', d)

const otraEmpresa = acceso({ elegible: false, motivo: 'OTRA_EMPRESA', mensaje: 'Tu usuario es de otra empresa.', empleado: null })
d = destinoTrasAcceso(otraEmpresa, true)
chk('de otra empresa y lo pidió él: al PIN con el motivo', d.destino === 'pin' && d.aviso?.tono === 'aviso' && d.aviso.texto === 'Tu usuario es de otra empresa.', d)
d = destinoTrasAcceso(otraEmpresa, false)
chk('de otra empresa y solo habilitó el equipo (soporte): al PIN sin aviso', d.destino === 'pin' && d.aviso === null, d)

const desactivado = acceso({ elegible: false, motivo: 'DESACTIVADO', mensaje: 'Un administrador desactivó tu acceso al POS.', empleado: { id: 9, nombre: 'Luis', rol: 'cajero' }, tiene_pin: true })
d = destinoTrasAcceso(desactivado, true)
chk('desactivado: no entra aunque tenga PIN, y se le dice', d.destino === 'pin' && d.aviso?.tono === 'aviso' && d.aviso.texto === 'Un administrador desactivó tu acceso al POS.', d)

d = destinoTrasAcceso(acceso({ elegible: false, mensaje: null, empleado: null }), true)
chk('no elegible y sin mensaje: al PIN sin recuadro vacío', d.destino === 'pin' && d.aviso === null, d)

d = destinoTrasAcceso(acceso({ elegible: true, empleado: null }), true)
chk('elegible pero sin empleado (no debería pasar): no se queda colgado en crear un PIN sin nombre', d.destino === 'pin', d)

console.log('Qué hacer cuando no se pudo crear el PIN')
const salida = (codigo: string, mensaje = 'texto del servidor'): SalidaAlFallarCrearPin => salidaAlFallarCrearPin(codigo, mensaje)
for (const c of ['PIN_FORMATO', 'PIN_OBVIO', 'PIN_NO_DISPONIBLE', 'PIN_DEMASIADOS_INTENTOS', 'SIN_CONEXION', 'ERROR']) {
  chk(`${c}: se queda en la pantalla de crear el PIN`, salida(c).salida === 'reintentar')
}
chk('un código que no conocemos tampoco deja a la persona sin salida: reintenta (y ahí está "Ahora no")', salida('CODIGO_NUEVO_DEL_FUTURO').salida === 'reintentar')
chk('EQUIPO_NO_HABILITADO: a habilitar el equipo', salida('EQUIPO_NO_HABILITADO').salida === 'equipo-invalido')
chk('POS_INACTIVO: aviso de POS no disponible', salida('POS_INACTIVO').salida === 'sin-pos')
chk('EMPRESA_INACTIVA: aviso de POS no disponible', salida('EMPRESA_INACTIVA').salida === 'sin-pos')

let s = salida('USUARIO_NO_AUTENTICADO')
chk('sesión de FiscalPoint vencida: a entrar otra vez con su usuario, con aviso', s.salida === 'usuario' && /venció/.test(s.aviso), s)
chk('401 sin código del servidor (NO_AUTORIZADO) es lo mismo', salida('NO_AUTORIZADO').salida === 'usuario')

s = salida('PIN_YA_CREADO')
chk('ya tenía PIN: al teclado del PIN, con aviso informativo (no es un error suyo)',
  s.salida === 'pin' && s.aviso.tono === 'info' && /restablezca/.test(s.aviso.texto), s)

for (const c of ['ACCESO_DESACTIVADO', 'USUARIO_OTRA_EMPRESA', 'EQUIPO_OTRA_EMPRESA']) {
  s = salida(c, `mensaje de ${c}`)
  chk(`${c}: al teclado del PIN, con el texto del servidor tal cual`, s.salida === 'pin' && s.aviso.tono === 'aviso' && s.aviso.texto === `mensaje de ${c}`, s)
}

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)

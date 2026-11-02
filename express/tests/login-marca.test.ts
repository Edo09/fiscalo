// La marca del Login (Login.css): el panel es azul tinta en los dos temas y sus colores viven en la hoja de la pantalla, no en tokens.css (donde
// tokens.test.ts los vigilaría). Esta prueba hace por ellos lo que aquella hace por los tokens: los textos de la marca dan 4.5:1 (WCAG 1.4.3) sobre
// el tramo más claro del fondo, y el logo que dibuja el Login existe.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ruta = (relativa: string): string => fileURLToPath(new URL(relativa, import.meta.url))
const css = readFileSync(ruta('../src/screens/Login.css'), 'utf8')
const tsx = readFileSync(ruta('../src/screens/Login.tsx'), 'utf8')

/** El valor hexadecimal de una variable `--marca-*` declarada en Login.css. */
function marca(nombre: string): string {
  const coincidencia = new RegExp(`--marca-${nombre}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css)
  assert.ok(coincidencia, `Login.css no declara --marca-${nombre} como #rrggbb`)
  return coincidencia[1].toLowerCase()
}

const canal = (valor: number): number => {
  const c = valor / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminancia = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
}
const contraste = (a: string, b: string): number => {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (oscuro + 0.05)
}

/** Los colores del degradado lineal de la franja (`.login__marca`), de los que el más claro es el primero. */
function fondosDeLaMarca(): string[] {
  const bloque = /\.login__marca\s*\{[^}]*\}/.exec(css)
  assert.ok(bloque, 'Login.css no tiene la regla .login__marca')
  const linea = /linear-gradient\([^)]*\)/.exec(bloque[0])
  assert.ok(linea, '.login__marca no tiene un linear-gradient')
  const colores = [...linea[0].matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase())
  assert.ok(colores.length >= 2, 'el degradado de la marca no nombra sus colores en #rrggbb')
  return colores
}

test('los textos de la marca dan 4.5:1 sobre el tramo más claro del fondo (el resplandor) y sobre todos los del degradado', () => {
  const fondos = [marca('brillo'), ...fondosDeLaMarca()]
  for (const texto of ['texto', 'texto-2', 'texto-3', 'cian']) {
    for (const fondo of fondos) {
      const razon = contraste(marca(texto), fondo)
      assert.ok(razon >= 4.5, `--marca-${texto} (${marca(texto)}) sobre ${fondo}: ${razon.toFixed(2)}:1, pide 4.5:1`)
    }
  }
})

test('el contraste calculado es el de WCAG: blanco sobre negro es 21:1 y un color sobre sí mismo, 1:1', () => {
  assert.equal(Math.round(contraste('#ffffff', '#000000')), 21)
  assert.equal(contraste('#2a6fdb', '#2a6fdb'), 1)
})

test('el Login dibuja el logo de icons/mark.svg, que existe y es un SVG', () => {
  assert.match(tsx, /src="\/icons\/mark\.svg"/)
  const archivo = ruta('../public/icons/mark.svg')
  assert.ok(existsSync(archivo), 'falta express/public/icons/mark.svg')
  assert.match(readFileSync(archivo, 'utf8'), /^<svg[\s>]/)
})

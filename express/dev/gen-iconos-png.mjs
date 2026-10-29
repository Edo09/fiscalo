// Genera los PNG provisionales del icono (color liso #2a6fdb), sin dependencias.
// Uso, desde fiscalo/: node express/dev/gen-iconos-png.mjs
// El arte final los reemplaza en P7; mientras tanto el manifiesto y el apple-touch-icon no apuntan a nada roto.
// `crc32` de node:zlib existe desde Node 22.2, y el proyecto exige 22.18.
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const COLOR = [0x2a, 0x6f, 0xdb]
const CARPETA = new URL('../public/icons/', import.meta.url)

// [archivo, lado en píxeles]. El maskable es liso a sangre completa, así que su zona segura queda cubierta.
const ICONOS = [
  ['express-192.png', 192],
  ['express-512.png', 512],
  ['express-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Un trozo PNG: largo, tipo, datos y el CRC del tipo más los datos. */
function trozo(tipo, datos) {
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([largo, cuerpo, crc])
}

/** PNG cuadrado de color liso: RGB de 8 bits, sin entrelazado. */
function png(lado) {
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(lado, 0) // ancho
  cabecera.writeUInt32BE(lado, 4) // alto
  cabecera[8] = 8 // bits por canal
  cabecera[9] = 2 // color verdadero RGB; compresión, filtro y entrelazado quedan en 0
  const fila = Buffer.alloc(1 + lado * 3) // el primer byte es el filtro 0
  for (let x = 0; x < lado; x++) fila.set(COLOR, 1 + x * 3)
  const crudo = Buffer.concat(Array.from({ length: lado }, () => fila))
  return Buffer.concat([
    FIRMA,
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(CARPETA, { recursive: true })
for (const [archivo, lado] of ICONOS) {
  const bytes = png(lado)
  writeFileSync(new URL(archivo, CARPETA), bytes)
  console.log(`${archivo}: ${lado}x${lado}, ${bytes.length} bytes`)
}

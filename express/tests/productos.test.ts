// lib/productos: el precio escrito, el ITBIS, el formulario, el alta de seis claves y, sobre todo, la edición que NO pierde lo que Express no muestra (el PUT del servidor es un UPDATE de la fila completa:
// lo que no viaja se pisa). La fila fresca es de mentira, con todo lo que trae un producto de la app completa y como la manda MySQL (los números en texto).
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '@/api/errores'
import type { UnidadMedida } from '@/api/types'
import { normalizarProducto } from '~/lib/filas'
import {
  cambiosProducto,
  chipsItbisForm,
  consultaProducto,
  etiquetaItbis,
  formDesdeProducto,
  formNuevoProducto,
  FUSION_COLUMNAS,
  fusionarProducto,
  guardarEdicion,
  leerPrecio,
  mensajeGuardarProducto,
  nombreDeUnidad,
  opcionesUnidad,
  payloadCrear,
  precioConItbis,
  productoYaCreado,
  validarFormProducto,
} from '~/lib/productos'
import type { FormProducto } from '~/lib/productos'
import { UNIDAD_POR_DEFECTO } from '~/lib/unidades'

const FRESCO = {
  id: 7,
  sku: 'CEM-42',
  nombre: 'Cemento gris 42 kg',
  descripcion: 'Saco',
  category_id: 3,
  warehouse_id: 2,
  indicador_bien_servicio: 1,
  indicador_facturacion: 2,
  precio: '640.0000',
  precio_2: '600.0000',
  precio_3: null,
  precio_4: null,
  costo: '410.5000',
  unidad_medida: '43',
  stock: 12.5,
  stock_minimo: 2,
  activo: 1,
  imagen_path: 'p/7.jpg',
  categoria_nombre: 'Obra',
  almacen_nombre: 'Almacén Principal',
}
const vista = normalizarProducto(FRESCO)
const form = (o: Partial<FormProducto> = {}): FormProducto => ({ nombre: 'Cemento gris 42 kg', precio: '640', indicador: 2, tipo: 1, unidad: '43', activo: true, ...o })
const CAT: UnidadMedida[] = [
  { id: 43, codigo: '43', descripcion: 'Unidad', permite_decimales: false },
  { id: 12, codigo: '12', descripcion: 'Metro', permite_decimales: true },
]

test('fusionar: solo cambia lo editado; nada oculto se pierde, se anula ni vuelve 0', () => {
  assert.deepEqual(fusionarProducto(FRESCO, { precio: 700 }), {
    id: 7,
    sku: 'CEM-42',
    nombre: 'Cemento gris 42 kg',
    descripcion: 'Saco',
    category_id: 3,
    warehouse_id: 2,
    indicador_bien_servicio: 1,
    indicador_facturacion: 2,
    precio: 700,
    precio_2: 600,
    precio_3: null,
    precio_4: null,
    costo: 410.5,
    unidad_medida: '43',
    stock: 12.5,
    stock_minimo: 2,
    activo: 1,
  })
})

test('fusionar sin cambios: manda las 16 columnas, el precio queda número y no viajan la foto ni los nombres de categoría y almacén', () => {
  const p = fusionarProducto(FRESCO, {})
  assert.equal(p.precio, 640)
  for (const k of FUSION_COLUMNAS) assert.equal(k in p, true, k)
  assert.equal(FUSION_COLUMNAS.length, 16)
  for (const k of ['imagen_path', 'categoria_nombre', 'almacen_nombre']) assert.equal(k in p, false, k)
})

test('fusionar: un NULL sigue siendo NULL (nunca 0), y un producto sin stock ni precios opcionales no los inventa', () => {
  const p = fusionarProducto({ id: '9', nombre: 'Asesoria', precio: '5000.0000', costo: '0.0000', activo: '0', indicador_facturacion: '4' }, { nombre: 'Asesoria tecnica' })
  assert.deepEqual([p.id, p.sku, p.descripcion, p.category_id, p.warehouse_id, p.precio_2, p.stock, p.stock_minimo], [9, null, null, null, null, null, null, null])
  assert.deepEqual([p.nombre, p.precio, p.costo, p.activo, p.indicador_facturacion, p.indicador_bien_servicio, p.unidad_medida], ['Asesoria tecnica', 5000, 0, 0, 4, 1, '43'])
})

test('guardarEdicion lee ANTES de escribir y manda la fila fresca con el cambio', async () => {
  const log: string[] = []
  let cuerpo: Record<string, unknown> | null = null
  await guardarEdicion(
    {
      leer: async () => {
        log.push('leer')
        return { ...FRESCO, sku: 'OTRO' }
      },
      enviar: async (c) => {
        log.push('enviar')
        cuerpo = c
      },
    },
    7,
    { precio: 700 },
  )
  assert.deepEqual(log, ['leer', 'enviar'])
  assert.deepEqual([cuerpo!.sku, cuerpo!.precio, cuerpo!.id], ['OTRO', 700, 7])
})

test('si la lectura falla no se escribe a ciegas', async () => {
  let envios = 0
  await assert.rejects(
    guardarEdicion(
      {
        leer: async () => {
          throw new ApiError('x', 0)
        },
        enviar: async () => {
          envios++
        },
      },
      7,
      { precio: 700 },
    ),
  )
  assert.equal(envios, 0)
})

test('cambiosProducto: solo lo que cambió; el indicador 2 guardado se conserva', () => {
  assert.deepEqual(cambiosProducto(vista, form()), {})
  assert.deepEqual(cambiosProducto(vista, form({ precio: '700' })), { precio: 700 })
  assert.deepEqual(cambiosProducto(vista, form({ activo: false })), { activo: 0 })
  assert.deepEqual(cambiosProducto(vista, form({ nombre: 'Cemento 50 kg', indicador: 4 })), { nombre: 'Cemento 50 kg', indicador_facturacion: 4 })
  assert.deepEqual(cambiosProducto(vista, form({ tipo: 2, unidad: '12' })), { indicador_bien_servicio: 2, unidad_medida: '12' })
  assert.deepEqual(cambiosProducto(vista, formDesdeProducto(vista)), {}) // abrir y guardar sin tocar nada no cambia nada
})

test('un nombre guardado de 120 caracteres no bloquea una edición solo de precio, pero uno nuevo de 81 sí', () => {
  const v = normalizarProducto({ ...FRESCO, nombre: 'N'.repeat(120) })
  const f = form({ nombre: 'N'.repeat(120), precio: '700' })
  assert.deepEqual(validarFormProducto(f, CAT, v), {})
  assert.deepEqual(cambiosProducto(v, f), { precio: 700 })
  assert.equal(validarFormProducto(form({ nombre: 'N'.repeat(81) }), CAT, vista).nombre, 'El nombre no puede pasar de 80 caracteres.')
  assert.equal(validarFormProducto(form({ nombre: 'N'.repeat(81) }), CAT).nombre, 'El nombre no puede pasar de 80 caracteres.')
})

test('precioConItbis con el redondeo de PHP 8.3', () => {
  assert.deepEqual(
    [
      [5000, 1],
      [640, 4],
      [0, 1],
      [84.75, 1],
      [1000, 2],
    ].map(([p, i]) => precioConItbis(p, i)),
    [5900, 640, 0, 100.01, 1160],
  )
})

test('etiquetaItbis y chipsItbisForm', () => {
  assert.deepEqual([1, 2, 3, 4, 0].map(etiquetaItbis), ['+ ITBIS 18%', '+ ITBIS 16%', 'ITBIS 0% (tasa cero)', 'Exento', 'No facturable'])
  assert.deepEqual(chipsItbisForm(1).map((c) => c.valor), [1, 4])
  assert.deepEqual(chipsItbisForm(null).map((c) => c.preservado), [false, false])
  assert.deepEqual(chipsItbisForm(2)[2], { valor: 2, etiqueta: '16%', preservado: true })
  assert.equal(chipsItbisForm(3)[2].etiqueta, '0%')
  assert.equal(chipsItbisForm(0)[2].etiqueta, 'No facturable')
})

test('leerPrecio: la coma de miles solo con tres dígitos exactos; una sola coma es el decimal', () => {
  const casos: [string, number | null][] = [
    ['5000', 5000],
    ['5000,5', 5000.5],
    ['1,25', 1.25],
    ['1,250', 1250],
    ['12,345', 12345],
    ['1,250,000', 1250000],
    ['0,500', 0.5],
    ['1,2500', 1.25],
    ['1,250.50', 1250.5],
    ['.5', 0.5],
    ['', 0],
    ['  ', 0],
    ['-1', -1],
    ['abc', null],
    ['1,2,3', null],
    ['RD$ 5', null],
  ]
  for (const [t, esperado] of casos) assert.equal(leerPrecio(t), esperado, t)
})

test('validarFormProducto', () => {
  const e = (o: Partial<FormProducto>) => validarFormProducto(form(o), CAT)
  assert.equal(e({ nombre: '  ' }).nombre, 'Escribe el nombre del producto o servicio.')
  assert.equal(e({ nombre: 'a'.repeat(81) }).nombre, 'El nombre no puede pasar de 80 caracteres.')
  assert.equal(e({ precio: '-1' }).precio, 'El precio no puede ser negativo.')
  assert.equal(e({ precio: '1.23456' }).precio, 'El precio admite hasta 4 decimales.')
  assert.equal(e({ precio: 'abc' }).precio, 'El precio tiene que ser un número.')
  assert.deepEqual(e({ precio: '' }), {}) // precio abierto
  assert.deepEqual(e({ precio: '1.2345' }), {})
  assert.equal(e({ unidad: '999' }).unidad, 'Elige la unidad de medida: la que tenía no está en el catálogo de la DGII.')
  assert.deepEqual(validarFormProducto(form({ unidad: '999' }), CAT, { ...vista, unidad: '999' }), {}) // la unidad original se respeta
  assert.deepEqual(validarFormProducto(form({ unidad: '999' }), [], vista), {}) // catálogo sin cargar: no se bloquea
})

test('payloadCrear: seis claves, la unidad por omisión es la 43 y nunca almacén ni existencia', () => {
  const p = payloadCrear(form({ nombre: ' Asesoria tecnica ', precio: '5000', indicador: 1, tipo: 2 }))
  assert.deepEqual(p, { nombre: 'Asesoria tecnica', precio: 5000, indicador_facturacion: 1, indicador_bien_servicio: 2, unidad_medida: '43', activo: 1 })
  assert.equal(Object.keys(p).length, 6)
  for (const prohibida of ['warehouse_id', 'stock', 'costo', 'sku']) assert.equal(prohibida in p, false, prohibida)
  assert.equal(formNuevoProducto().unidad, UNIDAD_POR_DEFECTO)
  assert.equal(UNIDAD_POR_DEFECTO, '43')
  assert.deepEqual(payloadCrear(formNuevoProducto('Tubo')), { nombre: 'Tubo', precio: 0, indicador_facturacion: 1, indicador_bien_servicio: 1, unidad_medida: '43', activo: 1 })
})

test('respuesta perdida al crear: el producto ya está', () => {
  const env = payloadCrear(form({ nombre: 'Asesoria tecnica', precio: '5000', indicador: 1, tipo: 2 }))
  const fila = { id: 9, nombre: 'ASESORIA TECNICA', precio: '5000.0000', indicador_facturacion: 1, indicador_bien_servicio: 2, unidad_medida: '43' }
  assert.equal(productoYaCreado([fila], env)?.id, 9)
  assert.equal(productoYaCreado([{ ...fila, id: 12 }, fila], env)?.id, 12) // el más nuevo
  assert.equal(productoYaCreado([{ ...fila, precio: '4000.0000' }], env), null)
  assert.equal(productoYaCreado([], env), null)
})

test('mensajeGuardarProducto: el texto de almacén sin configurar es de soporte; el resto del servidor, tal cual', () => {
  assert.equal(
    mensajeGuardarProducto(new ApiError('Elige el almacén del producto. Si no tienes ninguno, créalo primero en Almacenes.', 200)),
    'Tu cuenta no está lista para guardar productos. Contacta a soporte',
  )
  assert.equal(mensajeGuardarProducto(new ApiError('El precio no puede ser negativo.', 422)), 'El precio no puede ser negativo.')
  assert.equal(mensajeGuardarProducto(new TypeError('x')), 'No se pudo guardar el producto. Inténtalo de nuevo.')
})

test('opcionesUnidad: sin catálogo solo Unidad; con catálogo las fracciones siguen a admiteDecimales', () => {
  assert.deepEqual(opcionesUnidad([]), [{ id: '43', descripcion: 'Unidad', fracciones: false }])
  assert.deepEqual(opcionesUnidad(CAT), [
    { id: '43', descripcion: 'Unidad', fracciones: false },
    { id: '12', descripcion: 'Metro', fracciones: true },
  ])
})

test('nombreDeUnidad y consultaProducto', () => {
  assert.deepEqual([nombreDeUnidad(CAT, '12'), nombreDeUnidad(CAT, '999'), nombreDeUnidad([], '43'), nombreDeUnidad([], '12')], ['Metro', 'Unidad 999', 'Unidad', ''])
  assert.deepEqual(['  cem ', 'a', ''].map(consultaProducto), ['cem', '', ''])
})

test('normalizarProducto lee la fila de MySQL: unidad por omisión 43, ITBIS 18 % y activo cuando la columna falta', () => {
  const v = normalizarProducto({ id: '3', nombre: 'Tubo', precio: '150.0000' })
  assert.deepEqual([v.id, v.precio, v.unidad, v.indicadorFacturacion, v.indicadorBienServicio, v.activo], [3, 150, '43', 1, 1, true])
  assert.equal(normalizarProducto({ id: 1, nombre: 'x', activo: '0' }).activo, false)
  assert.equal(normalizarProducto({ id: 1, nombre: 'x', indicador_facturacion: '0' }).indicadorFacturacion, 0)
})

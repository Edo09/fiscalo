// Ventas abiertas del POS (src/pos/carrito.ts): pestañas por empleado, guardadas
// en el equipo, máximo 5, cobro en duda congelado, precios al día en todas, la
// lista de precio de cada línea y la lista por defecto del cliente (src/pos/listas.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-ventas.ts
import type { ProductoPos } from '../src/pos/api.ts'
import { centavosDeLista, decisionPos, lineasCambiables, lineasParaCobro, opcionesPos } from '../src/pos/listas.ts'

// localStorage del equipo, en memoria (Node no lo trae).
const datos = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => datos.get(k) ?? null,
  setItem: (k: string, v: string) => { datos.set(k, v) },
  removeItem: (k: string) => { datos.delete(k) },
  key: (i: number) => [...datos.keys()][i] ?? null,
  get length() { return datos.size },
}

type Store = typeof import('../src/pos/carrito.ts')
/** Un módulo nuevo = la página recién cargada (memoria vacía, mismo equipo). */
const cargar = (n: number): Promise<Store> => import(`../src/pos/carrito.ts?carga=${n}`) as Promise<Store>

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (ok) console.log(`  ok  ${desc}`)
  else { fallos++; console.log(`  FALLA  ${desc}${obtenido !== undefined ? ` -> ${JSON.stringify(obtenido)}` : ''}`) }
}

const prod = (id: number, precio: number) => ({
  id, nombre: `Producto ${id}`, sku: `P${id}`, category_id: null, precio_centavos: precio, tasa: 0.18,
  indicador_facturacion: 1, stock: 10, stock_minimo: null, unidad_medida: '43', decimales: false, imagen: null,
})
const cliente = { id: 7, nombre: 'GRATEX EIRL', rnc: '131256432', descuento: 0 }
const cuerpo = {
  tipo_ecf: '32' as const, client_id: null, clave: 'clave-1', lineas: [{ product_id: 2, cantidad: 1 }],
  total_centavos: 500, forma_pago: 1 as const, recibido_centavos: null, ancho: 80, iniciada_ms: null,
}

const { useCarritoStore: s1, MAX_VENTAS, nombreVenta } = await cargar(1)
const st = () => s1.getState()

console.log('Entrar y vender')
st().abrirVentasDe(1, 10)
chk('el empleado arranca con una venta vacía', st().ventas.length === 1 && st().lineas.length === 0 && st().dueno === '1.10')
st().agregar(prod(1, 1000) as never)
chk('agregar va a la venta activa', st().lineas.length === 1 && st().ventas[0].lineas.length === 1)
chk('se guarda en el equipo', datos.has('fiscalpoint.pos.ventas.1.10'))

console.log('Ventas en espera')
const v1 = st().activaId
chk('nueva venta', st().nuevaVenta() === true && st().ventas.length === 2)
chk('la nueva es la activa y está vacía', st().activaId !== v1 && st().lineas.length === 0)
chk('se llama Venta 2', nombreVenta(st().ventas[1]) === 'Venta 2')
st().agregar(prod(2, 500) as never)
st().ponerCliente(cliente)
chk('con cliente, la pestaña toma su nombre', nombreVenta(st().ventas[1]) === 'GRATEX EIRL')
const v2 = st().activaId
st().cambiarA(v1)
chk('volver a la primera: su carrito, sin cliente', st().lineas[0]?.productoId === 1 && st().cliente === null)
st().cambiarA(v2)
chk('y la segunda conserva el suyo', st().lineas[0]?.productoId === 2 && st().cliente?.id === 7)

console.log(`Máximo ${MAX_VENTAS}`)
while (st().ventas.length < MAX_VENTAS) st().nuevaVenta()
chk(`no pasa de ${MAX_VENTAS}`, st().nuevaVenta() === false && st().ventas.length === MAX_VENTAS)

console.log('Cobro en duda')
st().cambiarA(v2)
st().marcarCobroEnDuda(cuerpo as never)
st().agregar(prod(3, 300) as never)
chk('con cobro en duda no se agrega', st().lineas.length === 1)
st().cerrarVenta(v2)
chk('ni se cierra', st().ventas.some((v) => v.id === v2))

console.log('Catálogo nuevo')
st().guardarCatalogo({ productos: [prod(1, 1200), prod(2, 999)], categorias: [], generado_at: '' } as never)
const venta1 = st().ventas.find((v) => v.id === v1)
const venta2 = st().ventas.find((v) => v.id === v2)
chk('precio nuevo en una venta en espera', venta1?.lineas[0].precioCentavos === 1200, venta1?.lineas[0].precioCentavos)
chk('la venta en duda no cambia', venta2?.lineas[0].precioCentavos === 500, venta2?.lineas[0].precioCentavos)

console.log('Otro empleado en la misma caja')
st().abrirVentasDe(1, 20)
chk('ve solo las suyas (una vacía)', st().ventas.length === 1 && st().lineas.length === 0 && st().dueno === '1.20')
st().abrirVentasDe(1, 10)
chk('el primero recupera sus ventas', st().ventas.length === MAX_VENTAS)
chk('con el cobro en duda y su clave', st().ventas.find((v) => v.id === v2)?.cobroEnDuda?.clave === 'clave-1')

console.log('Recargar la página')
const { useCarritoStore: s2 } = await cargar(2)
chk('memoria nueva: nada', s2.getState().ventas.length === 1 && s2.getState().dueno === null)
s2.getState().abrirVentasDe(1, 10)
chk('al entrar con el PIN, las ventas siguen', s2.getState().ventas.length === MAX_VENTAS)
chk('la activa es la misma de antes', s2.getState().activaId === st().activaId)
chk('el cobro en duda sigue congelado', s2.getState().ventas.find((v) => v.id === v2)?.cobroEnDuda?.clave === 'clave-1')

console.log('Cobrar y cerrar')
const a = s2.getState()
a.cambiarA(v1)
const antes = a.ventas.length
s2.getState().terminarActiva()
chk('cobrada con otras abiertas: se cierra su pestaña', s2.getState().ventas.length === antes - 1 && !s2.getState().ventas.some((v) => v.id === v1))
const libres = s2.getState().ventas.map((v) => v.numero)
s2.getState().nuevaVenta()
const nueva = s2.getState().ventas[s2.getState().ventas.length - 1]
chk('la nueva toma el número libre', nueva.numero === 1 && !libres.includes(1), nueva.numero)

console.log('La última venta')
const { useCarritoStore: s3 } = await cargar(3)
s3.getState().abrirVentasDe(2, 30)
s3.getState().agregar(prod(1, 1000) as never)
s3.getState().terminarActiva()
chk('si es la única, queda vacía (no desaparece)', s3.getState().ventas.length === 1 && s3.getState().lineas.length === 0)
chk('vacía no deja nada guardado', !datos.has('fiscalpoint.pos.ventas.2.30'))

console.log('Olvidar el equipo')
s2.getState().olvidarTodo()
chk('no queda ninguna venta guardada', ![...datos.keys()].some((k) => k.startsWith('fiscalpoint.pos.ventas.')), [...datos.keys()])

console.log('Listas de precio')
const cemento: ProductoPos = { ...prod(9, 2500), listas: [{ lista: 2, precio_centavos: 2242 }, { lista: 4, precio_centavos: 1000 }] }
st().abrirVentasDe(1, 12)
st().agregar(cemento, 2)
chk('agregar en la lista 2: la línea queda en la 2, con su precio', st().lineas[0]?.lista === 2 && st().lineas[0]?.precioCentavos === 2242, st().lineas[0])
st().agregar(cemento)
chk('otro toque al mismo producto: una unidad más y sigue en su lista',
  st().lineas.length === 1 && st().lineas[0].cantidad === 2 && st().lineas[0].lista === 2 && st().lineas[0].precioCentavos === 2242)
st().agregar(prod(10, 500) as never)
chk('sin lista: la 1, con el precio del catálogo', st().lineas[1]?.lista === 1 && st().lineas[1]?.precioCentavos === 500)
st().guardarCatalogo({ productos: [{ ...cemento, listas: [{ lista: 2, precio_centavos: 2300 }] }, prod(10, 500)], categorias: [], generado_at: '' } as never)
chk('catálogo nuevo: la línea toma el precio nuevo de SU lista', st().lineas[0].lista === 2 && st().lineas[0].precioCentavos === 2300)
st().guardarCatalogo({ productos: [{ ...cemento, listas: [] }, prod(10, 500)], categorias: [], generado_at: '' } as never)
chk('la lista ya no existe: vuelve al precio 1 y dice cuál se perdió',
  st().lineas[0].lista === 1 && st().lineas[0].precioCentavos === 2500 && st().lineas[0].listaPerdida === 2, st().lineas[0])

st().nuevaVenta()
st().agregar(cemento, 4)
st().marcarCobroEnDuda(cuerpo)
st().guardarCatalogo({ productos: [{ ...cemento, listas: [] }], categorias: [], generado_at: '' } as never)
chk('una venta con cobro en duda no se vuelve a calcular', st().lineas[0].lista === 4 && st().lineas[0].precioCentavos === 1000)

datos.set('fiscalpoint.pos.ventas.1.13', JSON.stringify({ ventas: [{ id: 'v-viejo', numero: 1, iniciadaMs: null, cliente: null, cobroEnDuda: null,
  lineas: [{ productoId: 1, nombre: 'Viejo', sku: null, precioCentavos: 1000, tasa: 0.18, cantidad: 1, decimales: false, stock: 5 }] }], activaId: 'v-viejo' }))
st().abrirVentasDe(1, 13)
chk('un carrito guardado antes de las listas se abre en la lista 1', st().lineas[0]?.lista === 1)

chk('opcionesPos: la 1 y las de listas, en orden', JSON.stringify(opcionesPos(cemento)) === JSON.stringify([
  { lista: 1, precioCentavos: 2500 }, { lista: 2, precioCentavos: 2242 }, { lista: 4, precioCentavos: 1000 }]))
chk('opcionesPos: precio 1 en 0 y una lista: solo esa', JSON.stringify(opcionesPos({ precio_centavos: 0, listas: [{ lista: 3, precio_centavos: 480 }] }))
  === JSON.stringify([{ lista: 3, precioCentavos: 480 }]))
chk('centavosDeLista: la 1, una que existe y una que no', centavosDeLista(cemento, 1) === 2500 && centavosDeLista(cemento, 2) === 2242 && centavosDeLista(cemento, 3) === null)
chk('decisionPos: dos o más precios → elegir; uno → directo en esa lista; ninguno → directo en la 1',
  decisionPos(cemento).tipo === 'elegir' && JSON.stringify(decisionPos(prod(10, 500))) === JSON.stringify({ tipo: 'directo', lista: 1 })
  && JSON.stringify(decisionPos({ precio_centavos: 0, listas: [{ lista: 3, precio_centavos: 480 }] })) === JSON.stringify({ tipo: 'directo', lista: 3 })
  && JSON.stringify(decisionPos({ precio_centavos: 0, listas: [] })) === JSON.stringify({ tipo: 'directo', lista: 1 }))
chk('lineasParaCobro: lista solo cuando es mayor que 1', JSON.stringify(lineasParaCobro([
  { productoId: 1, cantidad: 2, lista: 1 }, { productoId: 2, cantidad: 1, lista: 2 }])) === JSON.stringify([
  { product_id: 1, cantidad: 2 }, { product_id: 2, cantidad: 1, lista: 2 }]))

console.log('Lista del cliente')
chk('el cliente tiene la 2 y el producto la ofrece: directo en la 2', JSON.stringify(decisionPos(cemento, 2)) === JSON.stringify({ tipo: 'directo', lista: 2 }))
chk('el cliente tiene la 1: directo en la 1', JSON.stringify(decisionPos(cemento, 1)) === JSON.stringify({ tipo: 'directo', lista: 1 }))
chk('el producto no ofrece la 3 del cliente: se pregunta', decisionPos(cemento, 3).tipo === 'elegir')
chk('producto de un solo precio con cliente en la 2: directo en la 1', JSON.stringify(decisionPos(prod(10, 500), 2)) === JSON.stringify({ tipo: 'directo', lista: 1 }))

st().abrirVentasDe(1, 14)
const catalogoL = { productos: [cemento, prod(10, 500)], categorias: [], generado_at: '' } as never
st().guardarCatalogo(catalogoL)
st().agregar(cemento)                       // lista 1
st().agregar(prod(10, 500) as never)
chk('lineasCambiables: solo el producto que ofrece la 2', lineasCambiables(st().lineas, [cemento, prod(10, 500)], 2).map((l) => l.productoId).join() === '9')
chk('aplicarLista(2): cambia solo esa línea y dice cuántas', st().aplicarLista(2) === 1 && st().lineas[0].lista === 2 && st().lineas[0].precioCentavos === 2242
  && st().lineas[1].lista === 1)
chk('aplicarLista(2) otra vez: no queda nada por cambiar', st().aplicarLista(2) === 0)
st().cambiarLista(9, 4)
chk('cambiarLista(9, 4): la línea pasa a la 4 con su precio y sin aviso de lista perdida', st().lineas[0].lista === 4 && st().lineas[0].precioCentavos === 1000 && st().lineas[0].listaPerdida === undefined)
st().cambiarLista(9, 3)
chk('cambiarLista a una lista que el producto no ofrece: no cambia', st().lineas[0].lista === 4)
st().marcarCobroEnDuda(cuerpo)
chk('con cobro en duda ni aplicarLista ni cambiarLista tocan la venta', st().aplicarLista(1) === 0 && (st().cambiarLista(9, 2), st().lineas[0].lista === 4))

console.log('Lista del cliente: casos límite')
const sinPrecio1 = { precio_centavos: 0, listas: [{ lista: 2 as const, precio_centavos: 480 }, { lista: 3 as const, precio_centavos: 450 }] }
chk('decisionPos: sin lista de cliente (null o ausente) se pregunta como antes', decisionPos(cemento, null).tipo === 'elegir' && decisionPos(cemento, undefined).tipo === 'elegir')
chk('decisionPos: la 4 del cliente, que el producto ofrece: directo en la 4', JSON.stringify(decisionPos(cemento, 4)) === JSON.stringify({ tipo: 'directo', lista: 4 }))
chk('decisionPos: la 1 con precio 0 no se ofrece, no cuenta como la del cliente',
  decisionPos(sinPrecio1, 1).tipo === 'elegir' && JSON.stringify(decisionPos(sinPrecio1, 3)) === JSON.stringify({ tipo: 'directo', lista: 3 })
  && JSON.stringify(decisionPos({ precio_centavos: 0, listas: [{ lista: 3, precio_centavos: 480 }] }, 1)) === JSON.stringify({ tipo: 'directo', lista: 3 }))
const lineasEj = [{ productoId: 9, lista: 2 as const, etiqueta: 'a' }, { productoId: 10, lista: 1 as const, etiqueta: 'b' }, { productoId: 99, lista: 1 as const, etiqueta: 'c' }]
chk('lineasCambiables: ya en la lista, que el producto no ofrece o que ya no está en el catálogo: ninguna',
  lineasCambiables(lineasEj, [cemento, prod(10, 500)], 2).length === 0 && lineasCambiables([], [cemento], 2).length === 0)
chk('lineasCambiables: devuelve las mismas líneas, con todo lo que traen', lineasCambiables(lineasEj, [cemento, prod(10, 500)], 1)[0] === lineasEj[0]
  && lineasCambiables(lineasEj, [cemento, prod(10, 500)], 1).length === 1)
chk('lineasCambiables: la 1 de un producto con precio 0 no se ofrece',
  lineasCambiables([{ productoId: 5, lista: 3 as const }], [{ ...prod(5, 0), listas: [{ lista: 3, precio_centavos: 480 }] }], 1).length === 0)

const idFrenada = st().activaId             // la venta con el cobro en duda de arriba
st().nuevaVenta()                           // otra en espera, sin cobro en duda y con el mismo producto
const idEnEspera = st().activaId
st().agregar(cemento)
st().nuevaVenta()                           // la activa
st().agregar(cemento)
st().agregar(prod(10, 500) as never)
chk('aplicarLista solo toca la venta activa: ni la del cobro en duda ni otra en espera',
  st().aplicarLista(2) === 1 && st().lineas[0].lista === 2 && st().ventas.find((v) => v.id === idFrenada)?.lineas[0].lista === 4
  && st().ventas.find((v) => v.id === idEnEspera)?.lineas[0].lista === 1)
chk('la venta activa y su espejo dicen lo mismo, y queda guardada en el equipo',
  JSON.stringify(st().ventas.find((v) => v.id === st().activaId)?.lineas) === JSON.stringify(st().lineas)
  && JSON.parse(datos.get('fiscalpoint.pos.ventas.1.14') ?? '{}').ventas?.find((v: { id: string }) => v.id === st().activaId)?.lineas[0].lista === 2)
st().guardarCatalogo({ productos: [{ ...cemento, listas: [{ lista: 4, precio_centavos: 1000 }] }, prod(10, 500)], categorias: [], generado_at: '' } as never)
chk('(previo) la 2 ya no se ofrece: la línea vuelve a la 1 con aviso', st().lineas[0].lista === 1 && st().lineas[0].listaPerdida === 2)
st().cambiarLista(9, 4)
chk('cambiarLista quita el aviso de lista perdida', st().lineas[0].lista === 4 && st().lineas[0].precioCentavos === 1000 && !('listaPerdida' in st().lineas[0]))
st().guardarCatalogo({ productos: [{ ...cemento, listas: [{ lista: 3, precio_centavos: 2000 }] }, prod(10, 500)], categorias: [], generado_at: '' } as never)
chk('(previo) la 4 ya no se ofrece: la línea vuelve a la 1 con aviso', st().lineas[0].lista === 1 && st().lineas[0].listaPerdida === 4)
chk('aplicarLista quita el aviso de lista perdida', st().aplicarLista(3) === 1 && st().lineas[0].lista === 3 && st().lineas[0].precioCentavos === 2000 && !('listaPerdida' in st().lineas[0]))
st().agregar(cemento, 2)
chk('agregar un producto que ya está sigue sumando una unidad sin tocar su lista', st().lineas[0].cantidad === 2 && st().lineas[0].lista === 3 && st().lineas[0].precioCentavos === 2000)
const ladrillo: ProductoPos = { ...prod(11, 450), listas: [{ lista: 2, precio_centavos: 400 }, { lista: 3, precio_centavos: 380 }] }
st().guardarCatalogo({ productos: [{ ...cemento, listas: [{ lista: 2, precio_centavos: 2242 }, { lista: 3, precio_centavos: 2000 }] }, ladrillo, prod(10, 500)], categorias: [], generado_at: '' } as never)
st().agregar(ladrillo)
const de = (id: number) => st().lineas.find((l) => l.productoId === id)
st().cambiarLista(11, 2)
chk('cambiarLista cambia solo la línea de ese producto, aunque otras también se puedan cambiar',
  de(11)?.lista === 2 && de(11)?.precioCentavos === 400 && de(9)?.lista === 3 && de(10)?.lista === 1)
chk('aplicarLista cuenta solo las que cambia: no la que ya está en esa lista ni la que no la ofrece',
  st().aplicarLista(2) === 1 && de(9)?.lista === 2 && de(9)?.precioCentavos === 2242 && de(11)?.lista === 2 && de(10)?.lista === 1)
let avisos = 0
const darDeBaja = s1.subscribe(() => { avisos++ })
st().aplicarLista(2)                        // ya está todo en la 2 o no la ofrece
st().cambiarLista(10, 2)                    // el producto no la ofrece
st().cambiarLista(9, 2)                     // la línea ya está en ella
darDeBaja()
chk('lo que no cambia nada no avisa a nadie (ni se vuelve a guardar)', avisos === 0, avisos)
const { useCarritoStore: s4 } = await cargar(4)
s4.getState().abrirVentasDe(3, 40)
s4.getState().agregar(cemento)
chk('sin catálogo cargado no hay de dónde sacar el precio: no se cambia ninguna lista',
  s4.getState().catalogo === null && s4.getState().aplicarLista(2) === 0 && (s4.getState().cambiarLista(9, 2), s4.getState().lineas[0].lista === 1))

console.log('Lista de una línea: volver a elegir el precio que ya se cobra')
// Una línea cuya lista deja de ofrecerse cae al precio 1 con un aviso. Si el cajero abre el selector de la línea (cambiarLista) y elige otra
// vez ese precio 1, la línea no cambia de lista ni de precio: solo pierde el aviso, porque ya sabe cuál se le cobra.
const { useCarritoStore: s5 } = await cargar(5)
const sb = () => s5.getState()
const enB = (id: number) => sb().lineas.find((l) => l.productoId === id)
sb().abrirVentasDe(4, 50)
const tornillo: ProductoPos = { ...prod(20, 800), listas: [{ lista: 2, precio_centavos: 750 }, { lista: 3, precio_centavos: 700 }] }
const tornilloSin2: ProductoPos = { ...tornillo, listas: [{ lista: 3, precio_centavos: 700 }] }
sb().guardarCatalogo({ productos: [tornillo], categorias: [], generado_at: '' } as never)
sb().agregar(tornillo, 2)
sb().guardarCatalogo({ productos: [tornilloSin2], categorias: [], generado_at: '' } as never)
chk('(previo) la 2 ya no se ofrece: la línea vuelve a la 1 con aviso, y el producto sigue ofreciendo la 1',
  enB(20)?.lista === 1 && enB(20)?.precioCentavos === 800 && enB(20)?.listaPerdida === 2 && opcionesPos(tornilloSin2).some((o) => o.lista === 1), enB(20))
sb().marcarCobroEnDuda(cuerpo)
sb().cambiarLista(20, 1)
chk('con el cobro en duda, volver a elegir la 1 no quita el aviso', enB(20)?.listaPerdida === 2, enB(20))
sb().marcarCobroEnDuda(null)
chk('aplicarLista(1) no toca la línea que ya está en la 1: no la cuenta y no le quita el aviso', sb().aplicarLista(1) === 0 && enB(20)?.listaPerdida === 2, enB(20))
sb().cambiarLista(20, 1)
chk('cambiarLista a la lista en que la línea ya está: quita el aviso y deja la lista y el precio como están',
  enB(20)?.lista === 1 && enB(20)?.precioCentavos === 800 && !('listaPerdida' in sb().lineas[0]), enB(20))
const antes5 = sb()
let avisos5 = 0
const darDeBaja5 = s5.subscribe(() => { avisos5++ })
sb().cambiarLista(20, 1)                    // ya sin aviso: no hay nada que quitar
darDeBaja5()
chk('sin aviso que quitar, cambiarLista a la lista en que ya está no cambia nada ni avisa a nadie', sb() === antes5 && avisos5 === 0, avisos5)

// Una lista que el catálogo no ofrece no se "vuelve a elegir": con el precio 1 en 0 la 1 no se ofrece, y el aviso se queda.
const clavo: ProductoPos = { ...prod(23, 0), listas: [{ lista: 2, precio_centavos: 480 }, { lista: 3, precio_centavos: 450 }] }
const clavoSin2: ProductoPos = { ...clavo, listas: [{ lista: 3, precio_centavos: 450 }] }
sb().nuevaVenta()
sb().guardarCatalogo({ productos: [tornillo, clavo], categorias: [], generado_at: '' } as never)
sb().agregar(clavo, 2)
sb().guardarCatalogo({ productos: [tornillo, clavoSin2], categorias: [], generado_at: '' } as never)
chk('(previo) la 2 ya no se ofrece: la línea vuelve a la 1 con aviso, y el producto no ofrece la 1',
  enB(23)?.lista === 1 && enB(23)?.listaPerdida === 2 && !opcionesPos(clavoSin2).some((o) => o.lista === 1), enB(23))
sb().cambiarLista(23, 1)
chk('si el producto no ofrece esa lista, cambiarLista no quita el aviso', enB(23)?.lista === 1 && enB(23)?.listaPerdida === 2, enB(23))
sb().guardarCatalogo({ productos: [tornillo], categorias: [], generado_at: '' } as never)
sb().cambiarLista(23, 1)
chk('ni cuando el producto ya no está en el catálogo', enB(23)?.listaPerdida === 2, enB(23))
datos.set('fiscalpoint.pos.ventas.4.51', JSON.stringify({ ventas: [{ id: 'v-aviso', numero: 1, iniciadaMs: null, cliente: null, cobroEnDuda: null,
  lineas: [{ productoId: 20, nombre: 'Tornillo', sku: null, precioCentavos: 800, lista: 1, listaPerdida: 2, tasa: 0.18, cantidad: 1, decimales: false, stock: 5 }] }], activaId: 'v-aviso' }))
const { useCarritoStore: s6 } = await cargar(6)
s6.getState().abrirVentasDe(4, 51)
s6.getState().cambiarLista(20, 1)
chk('recién recargada la página, sin catálogo, no hay con qué saber si la lista se ofrece: el aviso se queda',
  s6.getState().catalogo === null && s6.getState().lineas[0].listaPerdida === 2, s6.getState().lineas[0])

console.log('Lista 1 como destino de aplicarLista y cambiarLista')
// La 1 es la única lista que se ofrece según el precio del producto (mayor que 0) y no según `listas`: ahí opcionesPos y centavosDeLista
// responden distinto (con el precio 1 en 0 la 1 no se ofrece, aunque centavosDeLista dé 0). Por eso se prueba aparte de las demás listas.
const arena: ProductoPos = { ...prod(21, 900), listas: [{ lista: 3, precio_centavos: 650 }] }
const flete: ProductoPos = { ...prod(22, 0), listas: [{ lista: 3, precio_centavos: 480 }, { lista: 4, precio_centavos: 450 }] }
sb().nuevaVenta()
sb().guardarCatalogo({ productos: [arena, flete], categorias: [], generado_at: '' } as never)
sb().agregar(arena, 3)
sb().agregar(flete, 3)
chk('(previo) las dos líneas entran en la 3, con su precio', enB(21)?.lista === 3 && enB(21)?.precioCentavos === 650 && enB(22)?.lista === 3 && enB(22)?.precioCentavos === 480, sb().lineas)
chk('aplicarLista(1): la línea en la 3 de un producto con precio 1 mayor que 0 pasa a la 1, a ese precio',
  sb().aplicarLista(1) === 1 && enB(21)?.lista === 1 && enB(21)?.precioCentavos === 900, enB(21))
chk('aplicarLista(1): la de un producto con precio 1 en 0, ofrecido en la 3 y la 4, no se mueve', enB(22)?.lista === 3 && enB(22)?.precioCentavos === 480, enB(22))
sb().cambiarLista(21, 3)
chk('(previo) la línea de arena vuelve a la 3', enB(21)?.lista === 3 && enB(21)?.precioCentavos === 650, enB(21))
sb().cambiarLista(21, 1)
chk('cambiarLista(id, 1): la línea en la 3 de un producto con precio 1 mayor que 0 pasa a la 1, a ese precio', enB(21)?.lista === 1 && enB(21)?.precioCentavos === 900, enB(21))
sb().cambiarLista(22, 1)
chk('cambiarLista(id, 1): la de un producto con precio 1 en 0 no se mueve', enB(22)?.lista === 3 && enB(22)?.precioCentavos === 480, enB(22))

console.log(`\n${total - fallos}/${total} ok`)
if (fallos > 0) process.exit(1)

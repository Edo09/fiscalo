// Datos de prueba creibles para la API falsa (mock-api.mjs): solo para medir la interfaz, nada es real.
const pad = (n, w = 2) => String(n).padStart(w, '0')
const pick = (a, i) => a[i % a.length]

const EMPRESAS = [
  'Ferretería Ventura SRL', 'Distribuidora Caribe SRL', 'Colmado La Esperanza', 'Supermercado Nacional del Este',
  'Constructora Mejía & Asociados', 'Farmacia San Rafael', 'Auto Repuestos Tavárez', 'Inversiones del Cibao SA',
  'Panadería Doña Rosa', 'Clínica Dental Sonrisas', 'Transporte Rápido del Este', 'Librería El Estudiante',
  'Textiles Dominicanos SA', 'Hotel Playa Dorada', 'Agroindustrial Yaque SRL', 'Eléctricos del Caribe SRL',
  'Muebles Santiago EIRL', 'Imprenta Moderna SRL', 'Grupo Hermanos Peña SRL', 'Servicios Médicos Integrales',
]
const PERSONAS = [
  'Juan Pérez', 'María Rodríguez', 'Carlos Martínez', 'Ana Santos', 'Luis Fernández', 'Rosa Almonte', 'Pedro Díaz',
  'Carmen Reyes', 'Miguel Ángel Cabrera', 'Yudelka Batista', 'José Luis Ramírez', 'Altagracia Féliz',
]
const CIUDADES = [['Santo Domingo Este', 'Santo Domingo'], ['Santiago', 'Santiago'], ['La Vega', 'La Vega'], ['San Pedro de Macorís', 'San Pedro de Macorís'], ['Higüey', 'La Altagracia']]
const PRODUCTOS = [
  ['Cemento gris Portland 42.5 kg', 'Materiales', 1], ['Varilla corrugada 3/8" x 6 m', 'Acero', 1], ['Block 6" estándar', 'Materiales', 1],
  ['Pintura acrílica blanca 1 galón', 'Pinturas', 1], ['Tubo PVC 1/2" SDR 13.5 x 6 m', 'Plomería', 1], ['Cable THHN #12 (rollo 100 m)', 'Eléctricos', 1],
  ['Interruptor sencillo blanco', 'Eléctricos', 1], ['Taladro percutor 1/2" 750 W', 'Herramientas', 1], ['Martillo de uña 16 oz', 'Herramientas', 1],
  ['Brocha profesional 4"', 'Pinturas', 1], ['Llave de paso 1/2" bronce', 'Plomería', 1], ['Instalación eléctrica (por punto)', 'Servicios', 2],
  ['Mano de obra de albañilería (día)', 'Servicios', 2], ['Flete dentro del Gran Santo Domingo', 'Servicios', 2],
]

export function clients() {
  return Array.from({ length: 48 }, (_, i) => {
    const emp = pick(EMPRESAS, i * 3)
    const [mun, prov] = pick(CIUDADES, i)
    return {
      id: 200 - i, client_name: pick(PERSONAS, i * 5), company_name: i % 5 === 4 ? '' : emp, razon_social: emp.toUpperCase(),
      rnc: i % 7 === 3 ? '0010' + pad(4000000 + i * 137, 7) : '1' + pad(30000000 + i * 977, 8),
      email: 'compras' + i + '@' + emp.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) + '.com.do', phone_number: '809-555-' + pad(1000 + i * 7, 4),
      direccion: 'Calle Principal #' + (10 + i) + ', Sector Centro', municipio: mun, provincia: prov,
      descuento: i % 6 === 0 ? '10.00' : '0.00', permitir_credito: i % 3 === 0 ? 1 : 0, lista_precio: i % 4 === 0 ? 2 : null,
    }
  })
}

export function categories() {
  return ['Materiales', 'Acero', 'Pinturas', 'Plomería', 'Eléctricos', 'Herramientas', 'Servicios'].map((n, i) => ({
    id: i + 1, nombre: n, descripcion: 'Productos de ' + n.toLowerCase(), color: null, estado: 1,
  }))
}
export function warehouses() {
  return [['Almacén Principal', 'Local de la Av. Duarte'], ['Almacén Santiago', 'Sucursal Santiago']].map(([n, d], i) => ({ id: i + 1, nombre: n, descripcion: d, estado: 1 }))
}

export function products() {
  const cats = categories()
  return Array.from({ length: 60 }, (_, i) => {
    const [nombre, cat, bs] = pick(PRODUCTOS, i)
    const c = cats.find((x) => x.nombre === cat)
    return {
      id: 500 - i, sku: 'SKU-' + pad(1000 + i, 4), nombre: nombre + (i >= PRODUCTOS.length ? ' · lote ' + Math.floor(i / PRODUCTOS.length + 1) : ''),
      descripcion: 'Descripción de ' + nombre, categoria: cat, category_id: c.id, warehouse_id: 1 + (i % 2), categoria_nombre: cat, almacen_nombre: i % 2 ? 'Almacén Santiago' : 'Almacén Principal',
      indicador_bien_servicio: bs, indicador_facturacion: i % 9 === 8 ? 4 : 1, precio: (250 + i * 37.5).toFixed(2), precio_2: i % 4 === 0 ? (230 + i * 35).toFixed(2) : null,
      costo: (180 + i * 28).toFixed(2), unidad_medida: '43', stock: bs === 2 ? null : (i % 11 === 0 ? '0.000' : (5 + i * 3.25).toFixed(3)), stock_minimo: bs === 2 ? null : '10.000',
      imagen_path: null, activo: i % 13 === 12 ? 0 : 1,
    }
  })
}

const ESTADOS = ['ACEPTADO', 'ACEPTADO', 'ACEPTADO', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ACEPTADO', 'EN_PROCESO']
export function facturas() {
  const cl = clients()
  return Array.from({ length: 60 }, (_, i) => {
    const c = cl[i % cl.length]
    const tipo = pick(['E31', 'E32', 'E31', 'E45', 'E31', 'E34'], i)
    const gravado = 1800 + i * 431.25
    return {
      id: 900 - i, no_factura: 'F-' + pad(900 - i, 6), date: '2026-11-' + pad(19 - (i % 19), 2), client_id: c.id, client_name: c.client_name, user_id: 1,
      total: (gravado * 1.18).toFixed(2), NCF: null, tipo_ecf: tipo, e_ncf: tipo + pad(1000 + (900 - i), 10), track_id: 'trk-' + i, estado_dgii: pick(ESTADOS, i),
      codigo_seguridad: 'A1B2C3', fecha_emision_dgii: '2026-11-' + pad(19 - (i % 19), 2) + ' 10:' + pad(i % 60, 2) + ':00', secuencia_utilizada: true, tipo_pago: i % 4 === 0 ? 2 : 1,
      company_name: c.company_name, description: 'Venta de materiales de construcción y herramientas', monto_gravado: gravado.toFixed(2), monto_exento: '0.00', total_itbis: (gravado * 0.18).toFixed(2), notas: [], modifica: null,
    }
  })
}

const meses = () => Array.from({ length: 12 }, (_, i) => {
  const d = new Date(2025, 11 + i, 1)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1)
})
const dias = () => Array.from({ length: 31 }, (_, i) => '2026-' + (i < 19 ? '11-' + pad(i + 1) : '10-' + pad(i + 13)))

export function stats() {
  return {
    resumen: { total_ecf: 184, monto_total: 3865420.5, monto_neto: 3721000.25, tipos_distintos: 4, primer_ecf: '2026-01-05', ultimo_ecf: '2026-11-19' },
    por_tipo: [
      { tipo_ecf: 'E31', nombre: 'Crédito Fiscal', total: 96, monto_total: 2410000, aceptados: 90, rfce: 0, rechazados: 3, enviados: 3, ultimo_emitido: '2026-11-19 09:30:00' },
      { tipo_ecf: 'E32', nombre: 'Consumo', total: 62, monto_total: 980000, aceptados: 60, rfce: 2, rechazados: 0, enviados: 0, ultimo_emitido: '2026-11-19 11:02:00' },
      { tipo_ecf: 'E34', nombre: 'Nota de Crédito', total: 8, monto_total: 94420.5, aceptados: 8, rfce: 0, rechazados: 0, enviados: 0, ultimo_emitido: '2026-11-12 15:40:00' },
      { tipo_ecf: 'E45', nombre: 'Gubernamental', total: 18, monto_total: 381000, aceptados: 15, rfce: 0, rechazados: 1, enviados: 2, ultimo_emitido: '2026-11-18 16:10:00' },
    ],
    por_estado: [
      { estado: 'ACEPTADO', total: 160, monto_total: 3400000 }, { estado: 'ENVIADO', total: 12, monto_total: 260000 }, { estado: 'RECHAZADO', total: 4, monto_total: 80420.5 }, { estado: 'EN_PROCESO', total: 8, monto_total: 125000 },
    ],
    por_mes: meses().map((m, i) => ({ mes: m, total: 10 + i * 2, monto_total: 150000 + i * 21000 })),
    ventas_por_mes: meses().map((m, i) => ({ mes: m, total: 10 + i * 2, monto_total: 150000 + i * 21000 })),
    ventas_por_dia: dias().map((d, i) => ({ dia: d, total: 2 + (i % 5), monto_total: 12000 + i * 1830 })),
    secuencias: [
      { type: 'E31', nombre: 'Crédito Fiscal', secuencia_actual: 96, total_emitidos: 96, restantes: 904, vencimiento: '2027-06-30' },
      { type: 'E32', nombre: 'Consumo', secuencia_actual: 62, total_emitidos: 62, restantes: 38, vencimiento: '2027-06-30' },
      { type: 'E45', nombre: 'Gubernamental', secuencia_actual: 18, total_emitidos: 18, restantes: 982, vencimiento: '2027-06-30' },
    ],
  }
}

export function gastos() {
  return Array.from({ length: 40 }, (_, i) => {
    const sub = 900 + i * 215.5
    return {
      id: 300 - i, categoria: i % 3 === 0 ? 'gastos_menores' : 'facturas_proveedores', tipo_gasto: i % 3 === 0 ? 'E43' : 'E41', tipo_bienes_servicios: '02',
      ncf: 'B01' + pad(12345 + i, 8), rnc_proveedor: '1' + pad(30000000 + i * 311, 8), nombre_proveedor: pick(EMPRESAS, i * 2), fecha: '2026-11-' + pad(19 - (i % 19), 2),
      subtotal: sub.toFixed(2), itbis: (sub * 0.18).toFixed(2), total: (sub * 1.18).toFixed(2), es_auto_emision: i % 3 === 0 ? 1 : 0, estado_dgii: pick(ESTADOS, i), track_id: null, codigo_seguridad: null, ambiente: 'ecf', user_id: 1,
    }
  })
}
export function gastosStats() {
  return {
    resumen: { total_gastos: 118, monto_total: 1450200.4, subtotal_total: 1228983, itbis_total: 221217.4, tipos_distintos: 2, primer_gasto: '2026-01-10', ultimo_gasto: '2026-11-19' },
    por_tipo: [
      { tipo_gasto: 'E41', total: 80, monto_total: 1100000, subtotal_total: 932203, itbis_total: 167797, auto_emitidos: 0, recibidos: 80, nombre: 'Compras' },
      { tipo_gasto: 'E43', total: 38, monto_total: 350200.4, subtotal_total: 296780, itbis_total: 53420.4, auto_emitidos: 38, recibidos: 0, nombre: 'Gastos menores' },
    ],
    por_categoria: [
      { categoria: 'facturas_proveedores', total: 80, monto_total: 1100000, itbis_total: 167797, nombre: 'Facturas de proveedores' },
      { categoria: 'gastos_menores', total: 38, monto_total: 350200.4, itbis_total: 53420.4, nombre: 'Gastos menores' },
    ],
    por_mes: meses().map((m, i) => ({ mes: m, total: 5 + i, monto_total: 70000 + i * 9000 })),
    secuencias: [{ type: 'E43', secuencia_actual: 38, total_emitidos: 38, nombre: 'Gastos menores', restantes: 962, vencimiento: '2027-06-30' }],
    ambiente_activo: 'ecf',
  }
}

export function users() {
  return Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: pick(PERSONAS, i).split(' ')[0], last_name: pick(PERSONAS, i).split(' ').slice(1).join(' '), email: 'usuario' + i + '@empresa.com.do', username: 'usuario' + i, role: i === 0 ? 'admin' : pick(['user', 'cajero', 'contador'], i) }))
}
export function roles() {
  return [
    { id: 1, name: 'admin', description: 'Acceso total', is_system: 1, permissions: ['*'] },
    { id: 2, name: 'user', description: 'Usuario estándar', is_system: 1, permissions: ['facturas', 'clientes', 'productos'] },
    { id: 3, name: 'cajero', description: 'Punto de venta y cobros', is_system: 0, permissions: ['facturas', 'pos', 'cobros', 'clientes'] },
    { id: 4, name: 'contador', description: 'Reportes y gastos', is_system: 0, permissions: ['gastos', 'compras', 'reportes', 'tesoreria', 'proveedores'] },
  ]
}
export function proveedores() {
  return Array.from({ length: 25 }, (_, i) => ({ id: i + 1, rnc: '1' + pad(30000000 + i * 421, 8), nombre: pick(EMPRESAS, i * 7), contacto: pick(PERSONAS, i), telefono: '809-555-' + pad(2000 + i * 3, 4), correo: 'ventas' + i + '@proveedor.com.do', direccion: 'Av. Industrial #' + (100 + i), notas: '', activo: 1, compras: (i * 3) % 17 }))
}

export function facturasSimples() {
  const cl = clients()
  return Array.from({ length: 30 }, (_, i) => ({ id: 70 - i, no_factura: 'FS-' + pad(900 - i, 6), date: '2026-11-' + pad(19 - (i % 19), 2), client_id: cl[i].id, client_name: cl[i].client_name, company_name: cl[i].company_name, total: (2400 + i * 310.5).toFixed(2), tipo_pago: i % 3 === 0 ? 2 : 1, dias_credito: null, description: 'Cemento, varillas y block para obra', pos_idempotency_key: null }))
}
export function facturasSimplesStats() {
  return { resumen: { total: 120, monto_total: 410000 }, por_mes: meses().map((m, i) => ({ mes: m, total: 5 + i, monto_total: 20000 + i * 2500 })), por_dia: dias().map((d, i) => ({ dia: d, total: 1 + (i % 3), monto_total: 4000 + i * 150 })) }
}

export function valorInventario() {
  const rows = products().filter((p) => p.indicador_bien_servicio === 1).map((p, i) => ({ id: p.id, sku: p.sku, nombre: p.nombre, categoria: p.categoria_nombre, almacen: p.almacen_nombre, activo: true, entradas: 80 + i, salidas: 20 + (i % 9), existencia: Number(p.stock), costo_promedio: Number(p.costo), costo_ponderado: i % 4 !== 0, valor_inventario: Number(p.stock) * Number(p.costo) }))
  return { rows, totales: { productos: rows.length, existencia: rows.reduce((a, r) => a + r.existencia, 0), valor: rows.reduce((a, r) => a + r.valor_inventario, 0) } }
}

export function auditLogs() {
  return Array.from({ length: 40 }, (_, i) => ({ id: 1000 - i, tenant_id: 1, user_id: 1 + (i % 3), username: 'usuario' + (i % 3), email: 'usuario' + (i % 3) + '@empresa.com.do', module: pick(['facturas', 'auth', 'clientes', 'productos', 'gastos'], i), entity_type: 'factura', entity_id: String(900 - i), action: pick(['CREATE', 'UPDATE', 'EMIT', 'LOGIN_SUCCESS', 'DELETE'], i), http_method: 'POST', endpoint: '/api/facturas', ip_address: '190.167.1.' + (10 + i), user_agent: 'Mozilla/5.0', browser: 'Chrome', os: 'Windows', device_type: 'desktop', old_values: null, new_values: { total: 1234.5 }, description: 'Operación registrada en la bitácora', success: i % 9 !== 8, error_message: null, created_at: '2026-11-19 ' + pad(8 + (i % 10), 2) + ':' + pad(i % 60, 2) + ':00' }))
}
export function ncfRangos() {
  return ['E31', 'E32', 'E34', 'E45'].map((t, i) => ({ id: i + 1, type: t, ambiente: 'ecf', current_value: 96 - i * 12, numero_desde: 1, numero_hasta: 1000, fecha_vencimiento: '2027-06-30', no_solicitud: 'S-' + (1000 + i), no_autorizacion: 'A-' + (2000 + i), usados: 96 - i * 12, restantes: 904 + i * 12, estado: 'activo' }))
}
export function ajustes() {
  return Array.from({ length: 15 }, (_, i) => ({ id: 40 - i, codigo: 'AJ-' + pad(40 - i, 5), fecha: '2026-11-' + pad(19 - i, 2), motivo: pick(['CONTEO_FISICO', 'ENTRADA', 'MERMA', 'DANO'], i), nota: null, warehouse_id: 1, almacen_nombre: 'Almacén Principal', total_lineas: 3 + i, total_valor: (1200 + i * 90).toFixed(2), anulado_por_id: null, anula_a_id: null }))
}

export function cotizaciones() {
  const cl = clients()
  return Array.from({ length: 24 }, (_, i) => ({ id: 80 - i, code: 'COT-' + pad(120 - i, 6), date: '2026-11-' + pad(19 - (i % 19), 2), client_id: cl[i].id, client_name: cl[i].client_name, total: (5200 + i * 740.25).toFixed(2), description: 'Cemento, varillas y block para obra civil', formato: null, numero: 120 - i, subtotal: null, itbis: null, ajustes: {} }))
}
export function ecfRecibidos() {
  return Array.from({ length: 25 }, (_, i) => ({ track_id: 'rec-' + i, tipo_ecf: pick(['E31', 'E41', 'E43', 'E32'], i), e_ncf: 'E31' + pad(5000 + i, 10), rnc_emisor: '1' + pad(30000000 + i * 211, 8), razon_social_emisor: pick(EMPRESAS, i * 3), rnc_comprador: '131880681', monto_total: (3000 + i * 515.4).toFixed(2), fecha_emision: '2026-11-' + pad(19 - (i % 19), 2) + ' 09:15:00', estado: 'ACEPTADO', ambiente: 'ecf', aprobacion_comercial: i % 3 === 0 ? 'ACEPTADO' : null }))
}
const f606 = () => Array.from({ length: 30 }, (_, i) => ({ razon_social: pick(EMPRESAS, i * 3), origen: i % 2 ? 'gasto' : 'ecf_recibido', tipo_comprobante: pick(['E31', 'E41', 'E43'], i), rnc: '1' + pad(30000000 + i * 211, 8), tipo_id: '1', tipo_bienes_serv: '02', ncf: 'E31' + pad(5000 + i, 10), ncf_modificado: '', fecha_comprobante: '202611' + pad(1 + (i % 19), 2), fecha_pago: '202611' + pad(1 + (i % 19), 2), monto_servicios: 0, monto_bienes: 1000 + i * 100, total_facturado: 1180 + i * 118, itbis_facturado: 180 + i * 18, itbis_retenido: 0, itbis_proporcionalidad: 0, itbis_costo: 0, itbis_adelantar: 180 + i * 18, itbis_percibido: 0, tipo_retencion_isr: '', retencion_renta: 0, isr_percibido: 0, isc: 0, otros_impuestos: 0, propina_legal: 0, forma_pago: '01' }))
export function reporte606() {
  const r = f606()
  return { periodo: '202611', rnc_emisor: '131880681', cantidad: r.length, totales: { monto_servicios: 0, monto_bienes: 54000, total_facturado: 63720, itbis_facturado: 9720, itbis_retenido: 0, retencion_renta: 0 }, advertencias: ['2 comprobantes sin tipo de bienes y servicios'], registros: r }
}
export function reporte607() {
  const r = Array.from({ length: 30 }, (_, i) => ({ razon_social: pick(EMPRESAS, i * 3), tipo_comprobante: pick(['E31', 'E32', 'E34'], i), estado_dgii: 'ACEPTADO', rnc: '1' + pad(30000000 + i * 211, 8), tipo_id: '1', ncf: 'E31' + pad(1000 + i, 10), ncf_modificado: '', tipo_ingreso: '01', fecha_comprobante: '202611' + pad(1 + (i % 19), 2), fecha_retencion: '', monto_facturado: 2000 + i * 150, itbis_facturado: 360 + i * 27, itbis_retenido: 0, itbis_percibido: 0, retencion_renta: 0, isr_percibido: 0, isc: 0, otros_impuestos: 0, propina_legal: 0, efectivo: 1000, cheque_transf: 1000, tarjeta: 0, credito: 0, bonos: 0, permuta: 0, otras: 0 }))
  return { periodo: '202611', rnc_emisor: '131880681', cantidad: r.length, totales: { monto_facturado: 111000, itbis_facturado: 19980, itbis_retenido: 0, retencion_renta: 0 }, advertencias: [], registros: r }
}
export function reporteVentas(agrupar) {
  const cl = clients()
  const filas = agrupar === 'documento'
    ? Array.from({ length: 35 }, (_, i) => ({ id: 900 - i, fecha: '2026-11-' + pad(19 - (i % 19), 2), documento: 'E31' + pad(1000 + i, 10), tipo: 'E31', estado: 'ACEPTADO', client_id: cl[i].id, cliente: cl[i].client_name, cliente_rnc: cl[i].rnc, tipo_pago: 1, forma_pago: 'Efectivo', user_id: 1, usuario: 'usuario0', es_devolucion: false, sin_lineas: false, base: 2000 + i * 100, itbis: 360 + i * 18, total: 2360 + i * 118 }))
    : Array.from({ length: 15 }, (_, i) => ({ clave: i + 1, etiqueta: cl[i].client_name, cantidad: 3 + i, cliente_rnc: cl[i].rnc, base: 9000 + i * 400, itbis: 1620 + i * 72, total: 10620 + i * 472 }))
  return { desde: '2026-11-01', hasta: '2026-11-19', agrupar, totales: { cantidad: filas.length, base: 98000, itbis: 17640, total: 115640 }, advertencias: [], filas }
}

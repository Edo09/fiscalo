// FISCALO — Datos de ejemplo (República Dominicana).
// RNC/Cédula en formato · ITBIS 18% · RD$ (DOP). Solo para el prototipo.
import { fmt, fmt0, colorFor } from '@/lib/format'
import type {
  Empresa, EmpresaItem, Usuario, Cliente, Producto, Factura, FacturaLinea,
  EcfTipo, DgiiColaItem, Gasto, Proveedor, Actividad, Notificacion, VentaMes,
  TopCliente, Kpis, UsuarioRow, Rol,
} from '@/types/domain'

const empresa: Empresa = {
  nombre: 'Distribuidora Caribe, SRL',
  rnc: '1-31-45678-9',
  direccion: 'Av. 27 de Febrero #245, Ens. Naco, Santo Domingo',
  telefono: '(809) 412-7800',
  email: 'facturacion@distcaribe.do',
  sucursal: 'Sucursal Principal',
  moneda: 'DOP',
}

const empresas: EmpresaItem[] = [
  { id: 'c1', nombre: 'Distribuidora Caribe, SRL', rnc: '1-31-45678-9', logo: 'DC' },
  { id: 'c2', nombre: 'Ferretería La Nacional', rnc: '1-30-11223-4', logo: 'FN' },
  { id: 'c3', nombre: 'Servicios Quisqueya EIRL', rnc: '1-32-99001-2', logo: 'SQ' },
]

const usuario: Usuario = {
  nombre: 'Ana Reyes', rol: 'Administradora', iniciales: 'AR', color: '#2a6fdb', email: 'ana.reyes@distcaribe.do',
}

const clientes: Cliente[] = [
  { id: 'cl1', nombre: 'Supermercado Bravo', contacto: 'Luis Bravo', tipo: 'RNC', doc: '1-01-55892-3', email: 'compras@bravo.com.do', tel: '(809) 565-1200', ciudad: 'Santo Domingo', balance: 184500.0, facturas: 42, estado: 'Al día', desde: 'Mar 2021' },
  { id: 'cl2', nombre: 'Hotel Costa Azul', contacto: 'María Fernández', tipo: 'RNC', doc: '1-30-77231-8', email: 'admin@costaazul.do', tel: '(809) 221-4500', ciudad: 'Punta Cana', balance: 0, facturas: 28, estado: 'Al día', desde: 'Ene 2020' },
  { id: 'cl3', nombre: 'Constructora Del Este', contacto: 'Pedro Jiménez', tipo: 'RNC', doc: '1-31-02914-7', email: 'pjimenez@cdeleste.do', tel: '(809) 333-9090', ciudad: 'La Romana', balance: 562300.0, facturas: 67, estado: 'Vencido', desde: 'Jun 2019' },
  { id: 'cl4', nombre: 'Farmacia Carol', contacto: 'Carolina Mota', tipo: 'RNC', doc: '1-22-44519-0', email: 'carol@farmaciacarol.do', tel: '(809) 472-1100', ciudad: 'Santiago', balance: 38900.0, facturas: 91, estado: 'Al día', desde: 'Sep 2018' },
  { id: 'cl5', nombre: 'Juan Carlos Peña', contacto: 'Juan Carlos Peña', tipo: 'Cédula', doc: '001-1845672-9', email: 'jcpena@gmail.com', tel: '(829) 760-3321', ciudad: 'Santo Domingo', balance: 12400.0, facturas: 6, estado: 'Al día', desde: 'Feb 2024' },
  { id: 'cl6', nombre: 'Importadora Tropical', contacto: 'Sandra Luna', tipo: 'RNC', doc: '1-30-66120-5', email: 'sluna@tropical.do', tel: '(809) 540-7788', ciudad: 'Santo Domingo', balance: 96750.0, facturas: 34, estado: 'Por vencer', desde: 'Nov 2022' },
  { id: 'cl7', nombre: 'Colmado El Buen Precio', contacto: 'Rafael Tavárez', tipo: 'RNC', doc: '1-23-90817-6', email: 'elbuenprecio@hotmail.com', tel: '(829) 401-2245', ciudad: 'San Cristóbal', balance: 7320.0, facturas: 19, estado: 'Al día', desde: 'May 2023' },
  { id: 'cl8', nombre: 'Restaurante La Cazuela', contacto: 'Gloria Méndez', tipo: 'RNC', doc: '1-31-55440-2', email: 'info@lacazuela.do', tel: '(809) 689-3344', ciudad: 'Santo Domingo', balance: 0, facturas: 23, estado: 'Al día', desde: 'Ago 2021' },
  { id: 'cl9', nombre: 'Auto Repuestos García', contacto: 'Manuel García', tipo: 'RNC', doc: '1-30-12876-4', email: 'ventas@argarcia.do', tel: '(809) 274-5566', ciudad: 'Santiago', balance: 145600.0, facturas: 52, estado: 'Vencido', desde: 'Abr 2020' },
  { id: 'cl10', nombre: 'Clínica Dental Sonrisa', contacto: 'Dra. Patricia Vargas', tipo: 'RNC', doc: '1-32-30019-1', email: 'citas@sonrisa.do', tel: '(829) 855-9012', ciudad: 'Santo Domingo', balance: 0, facturas: 15, estado: 'Al día', desde: 'Oct 2023' },
]

const productos: Producto[] = [
  { id: 'p1', sku: 'ALM-0451', nombre: 'Aceite Vegetal 1 Gal', cat: 'Alimentos', tipo: 'Producto', precio: 485.0, costo: 360.0, stock: 240, min: 50, itbis: 18, estado: 'Disponible' },
  { id: 'p2', sku: 'ALM-0892', nombre: 'Arroz Selecto 25 lb', cat: 'Alimentos', tipo: 'Producto', precio: 1250.0, costo: 980.0, stock: 18, min: 40, itbis: 0, estado: 'Bajo' },
  { id: 'p3', sku: 'LIM-1120', nombre: 'Detergente Industrial 5 Gal', cat: 'Limpieza', tipo: 'Producto', precio: 1890.0, costo: 1420.0, stock: 76, min: 20, itbis: 18, estado: 'Disponible' },
  { id: 'p4', sku: 'BEB-0310', nombre: 'Agua Purificada 5 Gal', cat: 'Bebidas', tipo: 'Producto', precio: 95.0, costo: 55.0, stock: 0, min: 100, itbis: 18, estado: 'Agotado' },
  { id: 'p5', sku: 'SRV-2001', nombre: 'Servicio de Entrega a Domicilio', cat: 'Servicios', tipo: 'Servicio', precio: 350.0, costo: 0, stock: null, min: null, itbis: 18, estado: 'Disponible' },
  { id: 'p6', sku: 'PAP-0540', nombre: 'Papel Higiénico x12', cat: 'Hogar', tipo: 'Producto', precio: 420.0, costo: 310.0, stock: 156, min: 60, itbis: 18, estado: 'Disponible' },
  { id: 'p7', sku: 'BEB-0455', nombre: 'Café Molido 1 lb', cat: 'Bebidas', tipo: 'Producto', precio: 580.0, costo: 430.0, stock: 34, min: 50, itbis: 18, estado: 'Bajo' },
  { id: 'p8', sku: 'SRV-2014', nombre: 'Mantenimiento de Equipos', cat: 'Servicios', tipo: 'Servicio', precio: 2500.0, costo: 0, stock: null, min: null, itbis: 18, estado: 'Disponible' },
]

const facturas: Factura[] = [
  { id: 'f1', ncf: 'E310000000148', tipo: '31', cliente: 'Constructora Del Este', clienteId: 'cl3', rnc: '1-31-02914-7', fecha: '28 May 2026', vence: '27 Jun 2026', subtotal: 476525.42, itbis: 85774.58, total: 562300.0, estado: 'Emitida', dgii: 'Aceptado', metodo: 'Crédito 30 días' },
  { id: 'f2', ncf: 'E320000000931', tipo: '32', cliente: 'Supermercado Bravo', clienteId: 'cl1', rnc: '1-01-55892-3', fecha: '28 May 2026', vence: '28 May 2026', subtotal: 156355.93, itbis: 28144.07, total: 184500.0, estado: 'Emitida', dgii: 'Aceptado', metodo: 'Efectivo' },
  { id: 'f3', ncf: 'E310000000147', tipo: '31', cliente: 'Hotel Costa Azul', clienteId: 'cl2', rnc: '1-30-77231-8', fecha: '27 May 2026', vence: '26 Jun 2026', subtotal: 89200.0, itbis: 16056.0, total: 105256.0, estado: 'Pagada', dgii: 'Aceptado', metodo: 'Transferencia' },
  { id: 'f4', ncf: '—', tipo: '32', cliente: 'Farmacia Carol', clienteId: 'cl4', rnc: '1-22-44519-0', fecha: '27 May 2026', vence: '26 Jun 2026', subtotal: 32966.1, itbis: 5933.9, total: 38900.0, estado: 'Borrador', dgii: '—', metodo: 'Crédito 30 días' },
  { id: 'f5', ncf: 'E310000000146', tipo: '31', cliente: 'Auto Repuestos García', clienteId: 'cl9', rnc: '1-30-12876-4', fecha: '10 May 2026', vence: '09 Jun 2026', subtotal: 123389.83, itbis: 22210.17, total: 145600.0, estado: 'Vencida', dgii: 'Aceptado', metodo: 'Crédito 30 días' },
  { id: 'f6', ncf: 'E320000000930', tipo: '32', cliente: 'Importadora Tropical', clienteId: 'cl6', rnc: '1-30-66120-5', fecha: '26 May 2026', vence: '25 Jun 2026', subtotal: 81991.53, itbis: 14758.47, total: 96750.0, estado: 'Emitida', dgii: 'En proceso', metodo: 'Crédito 15 días' },
  { id: 'f7', ncf: 'E320000000929', tipo: '32', cliente: 'Restaurante La Cazuela', clienteId: 'cl8', rnc: '1-31-55440-2', fecha: '25 May 2026', vence: '25 May 2026', subtotal: 18983.05, itbis: 3416.95, total: 22400.0, estado: 'Pagada', dgii: 'Aceptado', metodo: 'Tarjeta' },
  { id: 'f8', ncf: 'E340000000012', tipo: '34', cliente: 'Supermercado Bravo', clienteId: 'cl1', rnc: '1-01-55892-3', fecha: '24 May 2026', vence: '—', subtotal: -8474.58, itbis: -1525.42, total: -10000.0, estado: 'Emitida', dgii: 'Aceptado', metodo: 'Nota de crédito' },
  { id: 'f9', ncf: 'E320000000928', tipo: '32', cliente: 'Colmado El Buen Precio', clienteId: 'cl7', rnc: '1-23-90817-6', fecha: '23 May 2026', vence: '22 Jun 2026', subtotal: 6203.39, itbis: 1116.61, total: 7320.0, estado: 'Emitida', dgii: 'Rechazado', metodo: 'Efectivo' },
  { id: 'f10', ncf: 'E310000000145', tipo: '31', cliente: 'Clínica Dental Sonrisa', clienteId: 'cl10', rnc: '1-32-30019-1', fecha: '22 May 2026', vence: '21 Jun 2026', subtotal: 42372.88, itbis: 7627.12, total: 50000.0, estado: 'Anulada', dgii: 'Anulado', metodo: 'Transferencia' },
  { id: 'f11', ncf: 'E320000000927', tipo: '32', cliente: 'Juan Carlos Peña', clienteId: 'cl5', rnc: '001-1845672-9', fecha: '21 May 2026', vence: '21 May 2026', subtotal: 10508.47, itbis: 1891.53, total: 12400.0, estado: 'Pagada', dgii: 'Aceptado', metodo: 'Efectivo' },
  { id: 'f12', ncf: 'E310000000144', tipo: '31', cliente: 'Hotel Costa Azul', clienteId: 'cl2', rnc: '1-30-77231-8', fecha: '20 May 2026', vence: '19 Jun 2026', subtotal: 67796.61, itbis: 12203.39, total: 80000.0, estado: 'Emitida', dgii: 'Aceptado', metodo: 'Transferencia' },
]

const facturaDetalle: FacturaLinea[] = [
  { prod: 'Aceite Vegetal 1 Gal', sku: 'ALM-0451', cant: 120, precio: 485.0, desc: 0, itbis: 18 },
  { prod: 'Detergente Industrial 5 Gal', sku: 'LIM-1120', cant: 40, precio: 1890.0, desc: 5, itbis: 18 },
  { prod: 'Papel Higiénico x12', sku: 'PAP-0540', cant: 80, precio: 420.0, desc: 0, itbis: 18 },
  { prod: 'Servicio de Entrega a Domicilio', sku: 'SRV-2001', cant: 1, precio: 350.0, desc: 0, itbis: 18 },
]

const ecfTipos: EcfTipo[] = [
  { code: '31', nombre: 'Factura de Crédito Fiscal Electrónica', emitidos: 1284, mes: 142, desc: 'Para contribuyentes que necesitan crédito fiscal de ITBIS.' },
  { code: '32', nombre: 'Factura de Consumo Electrónica', emitidos: 8930, mes: 951, desc: 'Consumidor final, sin crédito fiscal.' },
  { code: '33', nombre: 'Nota de Débito Electrónica', emitidos: 47, mes: 4, desc: 'Aumenta el valor de un comprobante ya emitido.' },
  { code: '34', nombre: 'Nota de Crédito Electrónica', emitidos: 162, mes: 18, desc: 'Disminuye o anula un comprobante emitido.' },
  { code: '41', nombre: 'Comprobante Electrónico de Compras', emitidos: 318, mes: 29, desc: 'Compras a personas no registradas.' },
  { code: '43', nombre: 'Comprobante Electrónico para Gastos Menores', emitidos: 204, mes: 22, desc: 'Gastos menores del personal.' },
  { code: '44', nombre: 'Comprobante para Regímenes Especiales', emitidos: 12, mes: 1, desc: 'Ventas a zonas francas y regímenes especiales.' },
  { code: '45', nombre: 'Comprobante Electrónico Gubernamental', emitidos: 56, mes: 7, desc: 'Ventas al Estado dominicano.' },
  { code: '46', nombre: 'Comprobante para Exportaciones', emitidos: 38, mes: 3, desc: 'Operaciones de exportación.' },
  { code: '47', nombre: 'Comprobante para Pagos al Exterior', emitidos: 9, mes: 0, desc: 'Pagos a beneficiarios del exterior.' },
]

const dgiiCola: DgiiColaItem[] = [
  { id: 'E310000000148', tipo: '31', cliente: 'Constructora Del Este', monto: 562300.0, hora: '10:42 a.m.', estado: 'Aceptado', track: 'TR-2026-0089412' },
  { id: 'E320000000931', tipo: '32', cliente: 'Supermercado Bravo', monto: 184500.0, hora: '10:38 a.m.', estado: 'Aceptado', track: 'TR-2026-0089411' },
  { id: 'E320000000930', tipo: '32', cliente: 'Importadora Tropical', monto: 96750.0, hora: '10:31 a.m.', estado: 'En proceso', track: 'TR-2026-0089410' },
  { id: 'E320000000928', tipo: '32', cliente: 'Colmado El Buen Precio', monto: 7320.0, hora: '09:58 a.m.', estado: 'Rechazado', track: 'TR-2026-0089408', motivo: 'RNC del comprador no válido' },
  { id: 'E310000000147', tipo: '31', cliente: 'Hotel Costa Azul', monto: 105256.0, hora: '09:44 a.m.', estado: 'Aceptado', track: 'TR-2026-0089407' },
  { id: 'E340000000012', tipo: '34', cliente: 'Supermercado Bravo', monto: 10000.0, hora: '09:20 a.m.', estado: 'Aceptado', track: 'TR-2026-0089405' },
  { id: 'E310000000146', tipo: '31', cliente: 'Auto Repuestos García', monto: 145600.0, hora: '08:55 a.m.', estado: 'Pendiente', track: '—' },
]

const gastos: Gasto[] = [
  { id: 'g1', concepto: 'Combustible flota de reparto', proveedor: 'Estación Sunix', cat: 'Transporte', fecha: '27 May 2026', ncf: 'B0100004521', subtotal: 18644.07, itbis: 3355.93, total: 22000.0, estado: 'Pagado' },
  { id: 'g2', concepto: 'Alquiler de almacén', proveedor: 'Inmobiliaria Naco', cat: 'Alquiler', fecha: '25 May 2026', ncf: 'B0100000891', subtotal: 95000.0, itbis: 0, total: 95000.0, estado: 'Pagado' },
  { id: 'g3', concepto: 'Energía eléctrica', proveedor: 'EDESUR', cat: 'Servicios', fecha: '24 May 2026', ncf: 'B0100119283', subtotal: 38983.05, itbis: 7016.95, total: 46000.0, estado: 'Pendiente' },
  { id: 'g4', concepto: 'Mercancía para reventa', proveedor: 'Distribuidora Nacional', cat: 'Inventario', fecha: '22 May 2026', ncf: 'B0100087712', subtotal: 312711.86, itbis: 56288.14, total: 369000.0, estado: 'Pagado' },
  { id: 'g5', concepto: 'Servicio de contabilidad', proveedor: 'Consultores RD', cat: 'Profesional', fecha: '20 May 2026', ncf: 'B0100004410', subtotal: 25423.73, itbis: 4576.27, total: 30000.0, estado: 'Pendiente' },
  { id: 'g6', concepto: 'Mantenimiento de vehículos', proveedor: 'Taller Mecánico Pérez', cat: 'Transporte', fecha: '18 May 2026', ncf: 'B0100002201', subtotal: 14406.78, itbis: 2593.22, total: 17000.0, estado: 'Pagado' },
]

const proveedores: Proveedor[] = [
  { id: 'pv1', nombre: 'Distribuidora Nacional', rnc: '1-30-88012-3', contacto: 'Roberto Sánchez', tel: '(809) 540-1122', balance: 369000.0, compras: 48 },
  { id: 'pv2', nombre: 'EDESUR Dominicana', rnc: '1-01-00000-1', contacto: 'Servicio al cliente', tel: '(809) 683-9292', balance: 46000.0, compras: 24 },
  { id: 'pv3', nombre: 'Estación Sunix', rnc: '1-31-22019-4', contacto: 'Pedro Núñez', tel: '(809) 412-3030', balance: 0, compras: 60 },
  { id: 'pv4', nombre: 'Inmobiliaria Naco', rnc: '1-30-44521-9', contacto: 'Laura Castro', tel: '(809) 565-7474', balance: 0, compras: 12 },
  { id: 'pv5', nombre: 'Consultores RD', rnc: '1-32-10293-8', contacto: 'Lic. José Martí', tel: '(829) 720-5050', balance: 30000.0, compras: 8 },
]

const actividad: Actividad[] = [
  { tipo: 'factura', txt: '<b>Ana Reyes</b> emitió la factura <b>E310000000148</b> a Constructora Del Este', monto: 'RD$ 562,300.00', hora: 'Hace 12 min', ic: 'file-text', color: 'var(--accent)' },
  { tipo: 'dgii', txt: 'DGII <b>aceptó</b> el e-CF <b>E320000000931</b>', monto: null, hora: 'Hace 24 min', ic: 'check-circle', color: 'var(--success)' },
  { tipo: 'pago', txt: '<b>Hotel Costa Azul</b> registró un pago de factura', monto: 'RD$ 105,256.00', hora: 'Hace 1 h', ic: 'banknote', color: 'var(--success)' },
  { tipo: 'dgii', txt: 'DGII <b>rechazó</b> el e-CF <b>E320000000928</b> — RNC no válido', monto: null, hora: 'Hace 2 h', ic: 'alert-circle', color: 'var(--danger)' },
  { tipo: 'cliente', txt: '<b>Carlos Disla</b> agregó al cliente <b>Clínica Dental Sonrisa</b>', monto: null, hora: 'Hace 3 h', ic: 'user-plus', color: 'var(--accent)' },
  { tipo: 'gasto', txt: '<b>Ana Reyes</b> registró un gasto de combustible', monto: 'RD$ 22,000.00', hora: 'Ayer, 4:20 p.m.', ic: 'receipt', color: 'var(--warning)' },
]

const notificaciones: Notificacion[] = [
  { id: 'n1', tipo: 'danger', ic: 'alert-triangle', titulo: '3 facturas vencidas', txt: 'Constructora Del Este, Auto Repuestos García y 1 más suman RD$ 707,900.00.', hora: 'Hace 1 h', leida: false },
  { id: 'n2', tipo: 'danger', ic: 'x-circle', titulo: 'e-CF rechazado por DGII', txt: 'E320000000928 — el RNC del comprador no es válido.', hora: 'Hace 2 h', leida: false },
  { id: 'n3', tipo: 'warning', ic: 'package', titulo: 'Inventario bajo', txt: '3 productos por debajo del mínimo: Arroz Selecto, Agua Purificada y Café Molido.', hora: 'Hace 5 h', leida: false },
  { id: 'n4', tipo: 'info', ic: 'clock', titulo: 'Certificado digital', txt: 'Tu certificado DGII vence en 47 días. Recuerda renovarlo.', hora: 'Ayer', leida: true },
  { id: 'n5', tipo: 'success', ic: 'check-circle', titulo: 'Secuencia e-CF aprobada', txt: 'La DGII aprobó 5,000 nuevos comprobantes tipo 32.', hora: 'Hace 2 días', leida: true },
]

const ventasMes: VentaMes[] = [
  { mes: 'Jun', ventas: 1820, gastos: 1120 },
  { mes: 'Jul', ventas: 2010, gastos: 1240 },
  { mes: 'Ago', ventas: 1760, gastos: 1080 },
  { mes: 'Sep', ventas: 2240, gastos: 1390 },
  { mes: 'Oct', ventas: 2680, gastos: 1510 },
  { mes: 'Nov', ventas: 2410, gastos: 1420 },
  { mes: 'Dic', ventas: 3120, gastos: 1780 },
  { mes: 'Ene', ventas: 2280, gastos: 1340 },
  { mes: 'Feb', ventas: 2540, gastos: 1460 },
  { mes: 'Mar', ventas: 2890, gastos: 1620 },
  { mes: 'Abr', ventas: 3010, gastos: 1690 },
  { mes: 'May', ventas: 3340, gastos: 1820 },
]

const topClientes: TopCliente[] = [
  { nombre: 'Constructora Del Este', monto: 562300, pct: 100 },
  { nombre: 'Supermercado Bravo', monto: 184500, pct: 33 },
  { nombre: 'Auto Repuestos García', monto: 145600, pct: 26 },
  { nombre: 'Hotel Costa Azul', monto: 105256, pct: 19 },
  { nombre: 'Importadora Tropical', monto: 96750, pct: 17 },
]

const kpis: Kpis = {
  ventasDia: 746800.0,
  ventasMes: 3340000.0,
  facturasEmitidas: 142,
  facturasPendientes: 23,
  gastosMes: 1820000.0,
  itbisCobrado: 601200.0,
  itbisPorPagar: 327600.0,
  cxc: 1048270.0,
  cxp: 445000.0,
  utilidad: 1520000.0,
}

const usuarios: UsuarioRow[] = [
  { id: 'u1', nombre: 'Ana Reyes', email: 'ana.reyes@distcaribe.do', rol: 'Administradora', estado: 'Activo', ultimo: 'Ahora', color: '#2a6fdb' },
  { id: 'u2', nombre: 'Carlos Disla', email: 'carlos.disla@distcaribe.do', rol: 'Contabilidad', estado: 'Activo', ultimo: 'Hace 30 min', color: '#1f8a5b' },
  { id: 'u3', nombre: 'Yokasta Pérez', email: 'yokasta.perez@distcaribe.do', rol: 'Ventas', estado: 'Activo', ultimo: 'Hace 2 h', color: '#c47f12' },
  { id: 'u4', nombre: 'Miguel Santos', email: 'miguel.santos@distcaribe.do', rol: 'Gerencia', estado: 'Activo', ultimo: 'Ayer', color: '#8a4fcf' },
  { id: 'u5', nombre: 'Rosa Cabrera', email: 'rosa.cabrera@distcaribe.do', rol: 'Auditor', estado: 'Inactivo', ultimo: 'Hace 8 días', color: '#0e8a8a' },
]

const roles: Rol[] = [
  { nombre: 'Administrador', desc: 'Acceso total al sistema y configuración.', usuarios: 1, permisos: 'Todos' },
  { nombre: 'Contabilidad', desc: 'Facturación, gastos, e-CF y reportes.', usuarios: 1, permisos: '18 de 24' },
  { nombre: 'Ventas', desc: 'Crear facturas y gestionar clientes.', usuarios: 1, permisos: '9 de 24' },
  { nombre: 'Gerencia', desc: 'Dashboards y reportes, solo lectura.', usuarios: 1, permisos: '11 de 24' },
  { nombre: 'Auditor', desc: 'Acceso de solo lectura a registros fiscales.', usuarios: 1, permisos: '6 de 24' },
]

export const DATA = {
  fmt, fmt0, colorFor,
  empresa, empresas, usuario, clientes, productos, facturas, facturaDetalle,
  ecfTipos, dgiiCola, gastos, proveedores, actividad, notificaciones,
  ventasMes, topClientes, kpis, usuarios, roles,
}

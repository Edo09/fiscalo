// Los dos ámbitos de Cobros, armados: su servicio, sus claves, su store de interfaz y sus textos. La pantalla de
// cada uno (CobrosView / CobrosTenantsView) los pone en el contexto (ambito.ts) y todo lo de abajo los lee de allí.
import { apiCobros, apiCobrosTenants } from '@/api'
import type { AmbitoCobros } from './ambito'
import { cobrosKeys, cobrosTenantsKeys } from './claves'
import { cobrosUiEmpresa, cobrosUiTenants } from './store'

/** Cada empresa le cobra a SUS clientes (/api/cobros): los clientes son los de la sección Clientes. */
export const AMBITO_EMPRESA: AmbitoCobros = {
  id: 'empresa',
  api: apiCobros,
  keys: cobrosKeys,
  ui: cobrosUiEmpresa,
  textos: {
    titulo: 'Cobros',
    subtitulo: 'Cuentas por cobrar por cliente · montos en RD$',
    botonConfigurar: 'Cobro mensual de un cliente',
    elegirTitulo: 'Cobro mensual de un cliente',
    elegirSub: 'Elige el cliente para configurar su cobro o ver su historial',
    filtrarTitulo: 'Filtrar por cliente',
    filtrarSub: 'Solo los cobros de ese cliente',
    elegirNota: 'Los clientes son los de la sección Clientes: si falta uno, créalo allí primero.',
    buscarPlaceholder: 'Buscar cliente por nombre, RNC o correo…',
    placeholderFiltro: 'Buscar por nombre del cliente…',
    chipCliente: 'Cliente',
    filtroSinNombre: (id) => `Cliente ${id}`,
  },
}

/** La plataforma le cobra a sus tenants, las empresas que usan Fiscalpoint (/api/cobros-tenants): solo cuentas de soporte. */
export const AMBITO_TENANTS: AmbitoCobros = {
  id: 'tenants',
  api: apiCobrosTenants,
  keys: cobrosTenantsKeys,
  ui: cobrosUiTenants,
  textos: {
    titulo: 'Cobros de tenants',
    subtitulo: 'Lo que la plataforma le cobra a las empresas que la usan · montos en RD$',
    botonConfigurar: 'Cobro mensual de una empresa',
    elegirTitulo: 'Cobro mensual de una empresa',
    elegirSub: 'Elige la empresa para configurar su cobro o ver su historial',
    filtrarTitulo: 'Filtrar por empresa',
    filtrarSub: 'Solo los cobros de esa empresa',
    elegirNota: 'Son las empresas registradas en la plataforma (los tenants), activas o no.',
    buscarPlaceholder: 'Buscar empresa por nombre o RNC…',
    placeholderFiltro: 'Buscar por nombre o RNC de la empresa…',
    chipCliente: 'Empresa',
    filtroSinNombre: (id) => `Empresa ${id}`,
  },
}

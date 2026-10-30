// El relleno de las rutas cuya pantalla todavía no existe. Cada plan lo reemplaza entrada por entrada: una pantalla del arranque en screens/registro.ts y una perezosa
// con su cargador en CARGADORES de screens/precarga.ts. El 06 pone Facturas y el Detalle, el 07 el asistente y Anular, el 09 Clientes, Productos, Mi empresa y
// Numeración. Cuando todas tengan pantalla, este archivo se borra.

export default function Pendiente(): JSX.Element {
  return (
    <div className="pantalla">
      <p style={{ margin: 0, padding: 'var(--sp-6) var(--sp-4)', color: 'var(--text-2)', textAlign: 'center' }}>Esta sección llega pronto</p>
    </div>
  )
}

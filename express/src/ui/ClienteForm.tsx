// El formulario de un cliente nuevo (anexo 6.4 y 6.9), uno solo para el asistente de venta («Cliente nuevo», en una hoja) y para Clientes (`#/clientes/nuevo`, a pantalla completa).
//  - `modo="rapido"`: RNC o cédula y nombre. `modo="completo"`: además contacto, teléfono, correo y dirección.
//  - La consulta a la DGII corre sola con 9 u 11 dígitos (con 9 espera un momento por si el número sigue hasta la cédula de 11) y llena el nombre si está vacío o si lo último que
//    puso fue ella; si ya hay otro nombre escrito, lo ofrece con «Usar este nombre». Una respuesta tardía nunca pisa a una más nueva (`contadorTurno`) y ninguna respuesta de la
//    DGII (no inscrito, sin servicio, un estado que no es ACTIVO) impide guardar. Con un comprobante que exige comprador (`tipoEcf` E31 o E45) el RNC es obligatorio y, si no
//    se pudo verificar, se avisa que la DGII puede rechazar la factura.
//  - Con el RNC completo se buscan también los clientes que ya lo tienen (el RNC no es único en el servidor y Express no crea duplicados en silencio): con `onUsarExistente` el botón
//    principal pasa a «Usar este cliente» y queda «Guardar como cliente nuevo» debajo.
//  - Guardar es POST /api/clients (net/clientes `crearCliente`): nunca manda descuento ni crédito (el servidor pone sus valores por omisión), no se repite solo, y si la respuesta
//    se perdió busca al cliente antes de dejar reintentar. Un rechazo se dice con el texto del servidor; si lo causa un cliente que ya existe (mismo correo, contacto y teléfono) se
//    ofrece usarlo.
//
// Además del contrato (`ClienteFormProps` de CONTEXTO.md) acepta dos propiedades opcionales: `anclarAccion` pone el botón en la barra de acción fija sobre el teclado (para una pantalla
// completa; en una hoja el botón va al final del formulario) y `onSucio(true|false)` avisa si hay algo escrito, para que una hoja pregunte «¿Descartar?» antes de cerrarse.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientRow } from '@/api/types'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import {
  capitalizar,
  construirAltaCliente,
  contadorTurno,
  errorFormCliente,
  esRncOCedula,
  formInicial,
  MSG_RNC_NO_VERIFICADO,
  resultadoConsultaRnc,
} from '~/lib/clientes'
import type { FormCliente, ResultadoRnc } from '~/lib/clientes'
import { exigeComprador } from '~/lib/tiposEcf'
import { useEnLinea } from '~/net/enLinea'
import { clientesPorRnc, consultarRncExpress, crearCliente } from '~/net/clientes'
import { Banner } from './Banner'
import { Button } from './Button'
import { StickyActionBar } from './StickyActionBar'
import { NumericField, TextField } from './TextField'
import './ClienteForm.css'

export interface ClienteFormProps {
  modo: 'rapido' | 'completo'
  /** El nombre (un texto) o los campos que ya se saben: un RNC de 9 u 11 dígitos dispara la consulta al abrirse. */
  inicial?: string | Partial<FormCliente>
  /** El rótulo del botón principal; «Guardar» por omisión. */
  etiquetaGuardar?: string
  /** El comprobante para el que se crea: con E31 o E45 el RNC es obligatorio. */
  tipoEcf?: string
  onGuardado(c: ClientRow): void
  onUsarExistente?(c: ClientRow): void
  onCancelar(): void
  /** El botón principal en la barra fija sobre el teclado (pantalla completa). Por omisión va al final del formulario. */
  anclarAccion?: boolean
  /** Avisa cada vez que cambia si hay algo escrito distinto de lo inicial. */
  onSucio?(sucio: boolean): void
}

/** Con 9 dígitos todavía puede seguir hasta una cédula de 11: se espera este rato antes de preguntar a la DGII (con 11 se pregunta en el acto). */
const ESPERA_NUEVE_DIGITOS_MS = 450

type Consulta = ResultadoRnc | 'consultando' | null

/** Lo que dice la consulta a la DGII, debajo del RNC. Cada desenlace es un aviso con su tono y su icono; ninguno impide guardar. */
function EstadoRnc(p: {
  consulta: Consulta
  nombre: string
  exigeVerificar: boolean
  onUsarNombre(nombre: string): void
  onReintentar(): void
}): JSX.Element | null {
  const { consulta, nombre, exigeVerificar, onUsarNombre, onReintentar } = p
  if (consulta === null) return null
  if (consulta === 'consultando') return <Banner tono="info">Buscando en la DGII...</Banner>
  switch (consulta.kind) {
    case 'encontrado': {
      const razon = consulta.razonSocial
      const accion = razon !== '' && nombre.trim() !== razon ? { etiqueta: 'Usar este nombre', onClick: () => onUsarNombre(razon) } : undefined
      if (consulta.activo) {
        return (
          <Banner tono="ok" titulo="Datos de la DGII (Activo)" accion={accion}>
            {razon}
          </Banner>
        )
      }
      const estado = consulta.estado === '' ? 'Estado desconocido en la DGII' : `${capitalizar(consulta.estado)} en la DGII`
      return (
        <Banner tono="warning" titulo={estado} accion={accion}>
          {razon !== '' && `${razon}. `}El crédito fiscal puede no servirle. Confírmalo.
        </Banner>
      )
    }
    case 'noInscrito':
      return (
        <Banner tono="warning">
          No inscrito en la DGII. Revisa el número o escribe el nombre y guarda igual.
          {exigeVerificar && ` ${MSG_RNC_NO_VERIFICADO}.`}
        </Banner>
      )
    case 'noDisponible':
      return (
        <Banner tono="info" accion={{ etiqueta: 'Consultar de nuevo', onClick: onReintentar }}>
          Consulta no disponible. Escribe el nombre y guarda: el RNC queda anotado.
          {exigeVerificar && ` ${MSG_RNC_NO_VERIFICADO}.`}
        </Banner>
      )
    case 'invalido':
      return <Banner tono="warning">{consulta.mensaje}</Banner>
  }
}

export function ClienteForm(p: ClienteFormProps): JSX.Element {
  const { modo, inicial, etiquetaGuardar = 'Guardar', tipoEcf, onGuardado, onUsarExistente, onCancelar, anclarAccion = false, onSucio } = p
  const completo = modo === 'completo'
  const exigeRnc = tipoEcf !== undefined && exigeComprador(tipoEcf, 0)
  const exigeVerificar = tipoEcf === '31' || tipoEcf === '45'
  const enLinea = useEnLinea()

  const [f, setF] = useState(() => formInicial(inicial))
  const [intentos, setIntentos] = useState(0)
  const [consulta, setConsulta] = useState<Consulta>(null)
  const [reintento, setReintento] = useState(0)
  const [existentes, setExistentes] = useState<ClientRow[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ mensaje: string; existente: ClientRow | null } | null>(null)
  const [turnos] = useState(contadorTurno)
  const raiz = useRef<HTMLDivElement>(null)
  const nombreDeLaDgii = useRef<string | null>(null) // lo último que la consulta puso en el nombre: mientras siga igual, un RNC nuevo lo puede cambiar
  const ultimo = useRef(f) // el formulario de ahora, para leerlo desde una respuesta que llega después
  useEffect(() => {
    ultimo.current = f
  })

  const digitos = f.rnc
  const poner = (campo: keyof FormCliente, valor: string): void => setF((a) => ({ ...a, [campo]: valor }))

  /** La razón social de la DGII al nombre, si está vacío o si lo puso la consulta anterior; si no, el usuario ya escribió el suyo y se le ofrece. */
  const rellenarNombre = useCallback((razon: string) => {
    const actual = ultimo.current.nombre
    if (razon === '' || (actual.trim() !== '' && actual !== nombreDeLaDgii.current)) return
    nombreDeLaDgii.current = razon
    setF((a) => ({ ...a, nombre: razon }))
  }, [])

  // La consulta: cada cambio del RNC es un turno nuevo y deja sin valor las respuestas de los anteriores.
  useEffect(() => {
    const turno = turnos.siguiente()
    setExistentes([])
    if (!esRncOCedula(digitos)) {
      setConsulta(null)
      return
    }
    setConsulta('consultando')
    const espera = window.setTimeout(
      () => {
        void consultarRncExpress(digitos)
          .then(
            (ok) => resultadoConsultaRnc({ ok }),
            (e: unknown) => resultadoConsultaRnc({ error: e }),
          )
          .then((r) => {
            if (!turnos.vigente(turno)) return
            setConsulta(r)
            if (r.kind === 'encontrado') rellenarNombre(r.razonSocial)
          })
        void clientesPorRnc(digitos).then((filas) => {
          if (turnos.vigente(turno)) setExistentes(filas)
        })
      },
      digitos.length === 9 ? ESPERA_NUEVE_DIGITOS_MS : 0,
    )
    return () => window.clearTimeout(espera)
  }, [digitos, reintento, turnos, rellenarNombre])
  useEffect(() => () => void turnos.siguiente(), [turnos]) // al cerrarse nada llega a un formulario que ya no está

  // ¿Hay algo escrito distinto de lo inicial? Una hoja lo usa para preguntar «¿Descartar?».
  const [base] = useState(() => JSON.stringify(f))
  const sucio = JSON.stringify(f) !== base
  const avisarSucio = useRef(onSucio)
  useEffect(() => {
    avisarSucio.current = onSucio
  })
  useEffect(() => {
    avisarSucio.current?.(sucio)
  }, [sucio])

  // Los errores de cada campo, tras el primer intento de guardar; antes solo el de un nombre que no cabe (la razón social larga de la DGII), que no se corta en silencio.
  const todos = errorFormCliente(f, { exigeRnc })
  const errores: typeof todos = intentos > 0 ? todos : todos.nombre !== undefined && f.nombre.trim() !== '' ? { nombre: todos.nombre } : {}
  useEffect(() => {
    if (intentos > 0) raiz.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() // el primer campo con error, a la vista
  }, [intentos])

  const guardar = useAccionUnica(async () => {
    setIntentos((n) => n + 1)
    if (Object.keys(errorFormCliente(f, { exigeRnc })).length > 0) return
    setError(null)
    setGuardando(true)
    try {
      const r = await crearCliente(construirAltaCliente(f))
      if (r.kind === 'creado') {
        onGuardado(r.fila)
        return
      }
      setError({ mensaje: r.mensaje, existente: r.kind === 'rechazado' ? r.existente : null })
    } finally {
      setGuardando(false)
    }
  })

  const usarExistente = existentes.length > 0 && onUsarExistente !== undefined
  // Si el servidor rechazó el alta por un cliente que ya existe, el aviso de error ofrece usarlo.
  const delRechazo = error?.existente ?? null
  const accionDelRechazo = delRechazo !== null && onUsarExistente !== undefined ? { etiqueta: 'Usar este cliente', onClick: () => onUsarExistente(delRechazo) } : undefined
  const botones = (
    <>
      {usarExistente ? (
        <Button bloque onClick={() => onUsarExistente(existentes[0])}>
          Usar este cliente
        </Button>
      ) : (
        <Button bloque cargando={guardando} disabled={!enLinea} razon="Sin conexión: no puedes guardar ahora." onClick={() => void guardar()}>
          {etiquetaGuardar}
        </Button>
      )}
      {usarExistente && (
        <Button variante="texto" bloque cargando={guardando} disabled={!enLinea} razon="Sin conexión: no puedes guardar ahora." onClick={() => void guardar()}>
          Guardar como cliente nuevo
        </Button>
      )}
      {!anclarAccion && (
        <Button variante="texto" bloque onClick={onCancelar}>
          Cancelar
        </Button>
      )}
    </>
  )

  return (
    <>
      <div className="cliente-form" ref={raiz}>
        <NumericField
          etiqueta={exigeRnc ? 'RNC o cédula' : 'RNC o cédula (opcional)'}
          valor={f.rnc}
          onCambio={(v) => poner('rnc', v)}
          maxLength={11}
          enterkeyhint="next"
          autoComplete="off"
          error={errores.rnc}
        />
        <EstadoRnc
          consulta={consulta}
          nombre={f.nombre}
          exigeVerificar={exigeVerificar}
          onUsarNombre={(n) => {
            nombreDeLaDgii.current = n
            poner('nombre', n)
          }}
          onReintentar={() => setReintento((n) => n + 1)}
        />
        {existentes.length > 0 && (
          <Banner tono="warning">
            Ya es tu cliente: {existentes[0].company_name || existentes[0].client_name || existentes[0].razon_social}
            {existentes.length > 1 && ` (y ${existentes.length - 1} más con este RNC)`}
          </Banner>
        )}
        <TextField
          etiqueta="Nombre o razón social *"
          valor={f.nombre}
          onCambio={(v) => poner('nombre', v)}
          autoCapitalize="words"
          autoComplete="off"
          enterkeyhint={completo ? 'next' : 'done'}
          onEnter={completo ? undefined : () => void guardar()}
          error={errores.nombre}
        />
        {completo && (
          <>
            <TextField
              etiqueta="Persona de contacto (opcional)"
              valor={f.contacto}
              onCambio={(v) => poner('contacto', v)}
              autoCapitalize="words"
              autoComplete="off"
              enterkeyhint="next"
              error={errores.contacto}
            />
            <TextField
              etiqueta="Teléfono (opcional)"
              valor={f.telefono}
              onCambio={(v) => poner('telefono', v)}
              tipo="tel"
              modoInput="tel"
              autoComplete="tel"
              enterkeyhint="next"
              error={errores.telefono}
            />
            <TextField
              etiqueta="Correo (opcional)"
              valor={f.correo}
              onCambio={(v) => poner('correo', v)}
              tipo="email"
              modoInput="email"
              autoComplete="email"
              autoCapitalize="none"
              enterkeyhint="next"
              error={errores.correo}
            />
            <TextField
              etiqueta="Dirección (opcional)"
              valor={f.direccion}
              onCambio={(v) => poner('direccion', v)}
              autoCapitalize="sentences"
              autoComplete="street-address"
              enterkeyhint="done"
              onEnter={() => void guardar()}
              error={errores.direccion}
            />
          </>
        )}
        {intentos > 0 && Object.keys(todos).length > 0 && <Banner tono="danger">Revisa los datos marcados en rojo.</Banner>}
        {error !== null && (
          <Banner tono="danger" accion={accionDelRechazo}>
            {error.mensaje}
          </Banner>
        )}
        {!anclarAccion && <div className="cliente-form__acciones">{botones}</div>}
      </div>
      {anclarAccion && <StickyActionBar>{botones}</StickyActionBar>}
    </>
  )
}

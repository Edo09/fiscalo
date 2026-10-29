// lib/reloj: el «hoy» de la app. Solo la barra de desarrollo lo cambia (reloj simulado), y solo en DEV: el cargador define el entorno
// en globalThis.__VITE_ENV__ (ver _loader.mjs) y estas pruebas lo mutan.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ahora, hoy, setRelojSimulado } from '~/lib/reloj'

const env = (globalThis as any).__VITE_ENV__ as { DEV: boolean }
const real = (): boolean => Math.abs(ahora().getTime() - Date.now()) < 1000

/** Corre `fn` con DEV encendido y deja el reloj real y DEV apagado (como los deja _loader.mjs) pase lo que pase. */
function enDev(fn: () => void): void {
  env.DEV = true
  try {
    fn()
  } finally {
    setRelojSimulado(null)
    env.DEV = false
  }
}

/**
 * Corre `fn` con la zona horaria del proceso puesta en `zona` y la devuelve a la de antes pase lo que pase. Se restaura con el nombre de
 * la zona y no con `delete process.env.TZ`: en Windows, Node se queda con la última zona puesta aunque se borre la variable.
 */
function conZona(zona: string, fn: () => void): void {
  const antes = Intl.DateTimeFormat().resolvedOptions().timeZone
  process.env.TZ = zona
  try {
    fn()
  } finally {
    process.env.TZ = antes
  }
}

test('reloj simulado solo en DEV', () => {
  enDev(() => {
    setRelojSimulado('2026-10-27T23:30:00')
    assert.equal(hoy(), '2026-10-27')
    assert.equal(ahora().getHours(), 23)
    env.DEV = false
    assert.ok(real()) // fuera de DEV la simulación se ignora
    env.DEV = true
    setRelojSimulado(null)
    assert.ok(real())
  })
})

test('sin simulación el reloj es el real', () => {
  assert.ok(real())
  assert.equal(env.DEV, false)
  assert.match(hoy(), /^\d{4}-\d{2}-\d{2}$/)
})

test('fuera de DEV setRelojSimulado no guarda nada: al volver a DEV el reloj sigue siendo el real', () => {
  env.DEV = false
  setRelojSimulado('2026-10-27T23:30:00')
  enDev(() => assert.ok(real()))
})

test('apagar la simulación fuera de DEV también la quita', () => {
  enDev(() => {
    setRelojSimulado('2026-10-27T23:30:00')
    env.DEV = false
    setRelojSimulado(null)
    env.DEV = true
    assert.ok(real())
  })
})

test('hoy() es el día local en cualquier zona, nunca el día UTC', () => {
  // Review Focus 5. La zona de la máquina puede ser UTC (la de CI lo es), y ahí `toISOString` y la hora local dan lo mismo: se prueba
  // en una zona detrás de UTC (RD, UTC-4) y otra delante (UTC+14), a las 23:30 y a las 00:30, cuando el día UTC difiere del local.
  enDev(() => {
    for (const zona of ['America/Santo_Domingo', 'Pacific/Kiritimati', 'UTC']) {
      conZona(zona, () => {
        for (const hora of ['23:30:00', '00:30:00']) {
          setRelojSimulado(`2026-10-27T${hora}`)
          assert.equal(hoy(), '2026-10-27', `${zona} a las ${hora}`)
          assert.equal(ahora().getHours(), Number(hora.slice(0, 2)), `${zona} a las ${hora}`)
        }
      })
    }
  })
})

test('el reloj simulado corre como el del teléfono: pasada la medianoche hoy() cambia de día', () => {
  const ahoraReal = Date.now
  let t = ahoraReal()
  Date.now = () => t
  try {
    enDev(() => {
      setRelojSimulado('2026-10-27T23:30:00')
      assert.equal(hoy(), '2026-10-27')
      t += 29 * 60_000
      assert.equal(hoy(), '2026-10-27') // 23:59
      t += 2 * 60_000
      assert.equal(hoy(), '2026-10-28') // 00:01
      assert.equal(ahora().getHours(), 0)
    })
  } finally {
    Date.now = ahoraReal
  }
})

test('ahora() entrega una fecha nueva cada vez: cambiarla no mueve el reloj', () => {
  enDev(() => {
    setRelojSimulado('2026-10-27T23:30:00')
    const d = ahora()
    d.setFullYear(1999)
    assert.equal(hoy(), '2026-10-27')
  })
})

test('una fecha sin hora es la medianoche local, no la UTC', () => {
  // `new Date('2026-10-27')` es la medianoche UTC: en RD sería la tarde del 26.
  enDev(() => {
    conZona('America/Santo_Domingo', () => {
      setRelojSimulado('2026-10-27')
      assert.equal(hoy(), '2026-10-27')
      assert.equal(ahora().getHours(), 0)
    })
  })
})

test('un texto que no es una fecha (el campo vacío de la barra) deja el reloj real', () => {
  enDev(() => {
    setRelojSimulado('2026-10-27T23:30:00')
    assert.equal(hoy(), '2026-10-27')
    for (const texto of ['', 'no es una fecha', '2026-13-45T99:99']) {
      setRelojSimulado('2026-10-27T23:30:00')
      setRelojSimulado(texto)
      assert.ok(real(), JSON.stringify(texto))
    }
  })
})

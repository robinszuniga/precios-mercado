import { describe, expect, it } from 'vitest'
import type { Observacion, PrecioActual } from '../src/esquema.ts'
import { aplicarObservaciones } from '../src/observaciones.ts'
import { precioEfectivo, VIGENCIAS_POR_DEFECTO as V } from '../src/precioEfectivo.ts'
import { actual, AHORA, haceDias } from './ayudas.ts'

function obs(o: Partial<Observacion>): Observacion {
  return {
    obs_id: 'o1', presentacion_id: 'p1', tienda: 'EXITO', origen: 'online', fuente: 'auto', precio: 4500,
    precio_lista: 5000, disponible: true, region: 'RIOHACHA', fecha_observado: haceDias(1), compra_id: '', ...o,
  }
}

describe('aplicarObservaciones', () => {
  it('la primera observación crea el actual y una fila de histórico', () => {
    const r = aplicarObservaciones(new Map(), [obs({})])
    expect(r.actuales).toHaveLength(1)
    expect(r.historial).toHaveLength(1)
    expect(r.actuales[0]).toMatchObject({ clave: 'p1|online', precio: 4500, fecha_verificado: haceDias(1) })
  })

  it('si el precio no cambió solo mueve fecha_verificado (el histórico no crece)', () => {
    const previo = aplicarObservaciones(new Map(), [obs({})]).actuales[0]
    const r = aplicarObservaciones(new Map([[previo.clave, previo]]), [obs({ obs_id: 'o2', fecha_observado: AHORA })])
    expect(r.historial).toHaveLength(0)
    expect(r.actuales[0].fecha_verificado).toBe(AHORA)
    expect(r.actuales[0].fecha_observado).toBe(haceDias(1))
  })

  it('si cambió, actualiza y agrega histórico', () => {
    const previo = aplicarObservaciones(new Map(), [obs({})]).actuales[0]
    const r = aplicarObservaciones(new Map([[previo.clave, previo]]), [obs({ obs_id: 'o2', precio: 4800, fecha_observado: AHORA })])
    expect(r.historial).toHaveLength(1)
    expect(r.actuales[0].precio).toBe(4800)
  })

  it('ignora una observación más vieja que la última verificación', () => {
    const previo = aplicarObservaciones(new Map(), [obs({ fecha_observado: AHORA })]).actuales[0]
    const r = aplicarObservaciones(new Map([[previo.clave, previo]]), [obs({ obs_id: 'vieja', precio: 1, fecha_observado: haceDias(5) })])
    expect(r.actuales).toHaveLength(0)
    expect(r.sinEfecto).toEqual(['vieja'])
  })

  it('agotado conserva el último precio válido', () => {
    const previo = aplicarObservaciones(new Map(), [obs({})]).actuales[0]
    const r = aplicarObservaciones(new Map([[previo.clave, previo]]), [obs({ obs_id: 'o2', precio: null, disponible: false, fecha_observado: AHORA })])
    expect(r.actuales[0]).toMatchObject({ precio: 4500, disponible: false })
    expect(r.historial[0]).toMatchObject({ precio: 4500, disponible: false })
  })

  it('es idempotente: aplicar dos veces lo mismo no cambia nada', () => {
    const primera = aplicarObservaciones(new Map(), [obs({})])
    const mapa = new Map(primera.actuales.map((a) => [a.clave, a]))
    const ids = new Set(primera.historial.map((h) => h.precio_id))
    const segunda = aplicarObservaciones(mapa, [obs({})], ids)
    expect(segunda.actuales).toHaveLength(0)
    expect(segunda.historial).toHaveLength(0)
    // Aun sin la lista de ids del histórico, la fecha igual la deja sin efecto.
    expect(aplicarObservaciones(mapa, [obs({})]).actuales).toHaveLength(0)
  })

  it('descarta precios en cero cuando dice estar disponible', () => {
    expect(aplicarObservaciones(new Map(), [obs({ precio: 0 })]).actuales).toHaveLength(0)
  })

  it('aplica en orden de fecha dentro del mismo lote', () => {
    const r = aplicarObservaciones(new Map(), [
      obs({ obs_id: 'b', precio: 5000, fecha_observado: AHORA }),
      obs({ obs_id: 'a', precio: 4000, fecha_observado: haceDias(2) }),
    ])
    expect(r.actuales[0].precio).toBe(5000)
    expect(r.historial.map((h) => h.precio_id)).toEqual(['a', 'b'])
  })
})

describe('precioEfectivo: el de tienda manda', () => {
  const ev = (xs: PrecioActual[]) => precioEfectivo(xs, V, AHORA)

  it('tienda vigente gana aunque el online sea más barato', () => {
    const r = ev([actual('p', 'EXITO', 'tienda', 5000, 10), actual('p', 'EXITO', 'online', 4000, 0)])
    expect(r.efectivo).toMatchObject({ precio: 5000, distintivo: 'tienda', estado: 'vigente' })
  })

  it('30 días exactos todavía es vigente; 31 pasa a amarillo si no hay online', () => {
    expect(ev([actual('p', 'D1', 'tienda', 5000, 30)]).efectivo?.estado).toBe('vigente')
    expect(ev([actual('p', 'D1', 'tienda', 5000, 31)]).efectivo?.estado).toBe('amarillo')
  })

  it('tienda vieja pierde contra online vigente', () => {
    const r = ev([actual('p', 'EXITO', 'tienda', 5000, 40), actual('p', 'EXITO', 'online', 5200, 1)])
    expect(r.efectivo).toMatchObject({ precio: 5200, distintivo: 'online' })
  })

  it('online de 3 días vale, de 4 no', () => {
    expect(ev([actual('p', 'EXITO', 'online', 5200, 3)]).efectivo?.precio).toBe(5200)
    expect(ev([actual('p', 'EXITO', 'online', 5200, 4)]).efectivo).toBeNull()
  })

  it('más de 60 días sale de la recomendación pero queda como último conocido', () => {
    const r = ev([actual('p', 'ARA', 'tienda', 5000, 61)])
    expect(r.efectivo).toBeNull()
    expect(r.ultimo?.precio).toBe(5000)
  })

  it('precio nacional lleva distintivo online_nac', () => {
    const r = ev([actual('p', 'EXITO', 'online', 5200, 0, { region: 'DEFAULT' })])
    expect(r.efectivo?.distintivo).toBe('online_nac')
  })

  it('agotado online no cuenta', () => {
    const r = ev([actual('p', 'EXITO', 'online', 5200, 0, { disponible: false })])
    expect(r.efectivo).toBeNull()
    expect(r.agotadoOnline).toBe(true)
  })

  it('fecha futura (reloj desfasado) cuenta como edad 0', () => {
    const r = ev([actual('p', 'EXITO', 'tienda', 5000, -2)])
    expect(r.efectivo?.edadDias).toBe(0)
  })

  it('marca oferta cuando el precio está por debajo del de lista', () => {
    const r = ev([actual('p', 'EXITO', 'online', 4500, 0, { precio_lista: 5000 })])
    expect(r.efectivo?.oferta).toBe(true)
  })
})

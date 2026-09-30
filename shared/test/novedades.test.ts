import { describe, expect, it } from 'vitest'
import { detectarCambio, resumirCambios, teTocaComprar, type CambioPrecio } from '../src/novedades.ts'

const DIA = 86_400_000
const AHORA = Date.parse('2026-09-30T12:00:00.000-05:00')

describe('detectarCambio', () => {
  it('solo un precio distinto y más nuevo cuenta', () => {
    const viejo = { precio: 10000, fecha_observado: '2026-09-29T06:00:00.000-05:00' }
    expect(detectarCambio(viejo, { precio: 8200, fecha_observado: '2026-09-30T06:00:00.000-05:00' })).toEqual({ antes: 10000, despues: 8200 })
    expect(detectarCambio(viejo, { precio: 10000, fecha_observado: '2026-09-30T06:00:00.000-05:00' })).toBeNull()
    expect(detectarCambio(viejo, { precio: 8200, fecha_observado: viejo.fecha_observado })).toBeNull()
    expect(detectarCambio(undefined, { precio: 8200, fecha_observado: '2026-09-30T06:00:00.000-05:00' })).toBeNull()
    expect(detectarCambio({ ...viejo, precio: null }, { precio: 8200, fecha_observado: '2026-09-30T06:00:00.000-05:00' })).toBeNull()
  })
})

describe('resumirCambios (origen)', () => {
  it('el precio de internet y el de la góndola de la misma presentación no se mezclan', () => {
    const c = (origen: 'online' | 'tienda', antes: number, despues: number): CambioPrecio => ({ presentacion_id: 'p', tienda: 'OLIMPICA', origen, antes, despues, fecha: AHORA - 1000 })
    const r = resumirCambios([c('online', 1000, 1100), c('tienda', 1300, 900)], AHORA)
    expect(r.subidas.map((m) => [m.origen, Math.round(m.variacion * 100)])).toEqual([['online', 10]])
    expect(r.bajas.map((m) => [m.origen, Math.round(m.variacion * 100)])).toEqual([['tienda', -31]])
  })
})

describe('resumirCambios', () => {
  const c = (id: string, antes: number, despues: number, haceDias: number): CambioPrecio => ({ presentacion_id: id, tienda: 'OLIMPICA', antes, despues, fecha: AHORA - haceDias * DIA })

  it('bajas y subidas de al menos 5 %, del cambio más grande al más chico, sin lo viejo', () => {
    const r = resumirCambios([c('aceite', 12900, 10500, 1), c('cafe', 20000, 21600, 0), c('sal', 2000, 2040, 0), c('viejo', 5000, 1000, 9)], AHORA)
    expect(r.bajas.map((m) => [m.presentacion_id, Math.round(m.variacion * 100)])).toEqual([['aceite', -19]])
    expect(r.subidas.map((m) => m.presentacion_id)).toEqual(['cafe'])
  })

  it('varios cambios seguidos cuentan desde el primero: bajó y volvió a subir = nada', () => {
    const r = resumirCambios([c('leche', 4000, 3500, 2), c('leche', 3500, 4000, 1)], AHORA)
    expect(r.bajas).toEqual([])
    expect(r.subidas).toEqual([])
  })
})

describe('teTocaComprar', () => {
  const compra = (id: string, dia: string) => ({ compra_id: id, estado: 'cerrada', fecha_cierre: `${dia}T19:30:00.000-05:00` })
  const d = (compra_id: string, producto_id: string, estado = 'en_carrito') => ({ compra_id, producto_id, estado })

  it('detergente cada ~15 días, la última hace 16: toca; café cada 7 y hace 2: no', () => {
    const compras = [compra('a', '2026-08-30'), compra('b', '2026-09-14'), compra('c', '2026-09-23'), compra('d', '2026-09-28')]
    const detalles = [d('a', 'detergente'), d('b', 'detergente'), d('c', 'cafe'), d('b', 'cafe'), d('d', 'cafe'), d('c', 'pan', 'no_encontrado'), d('d', 'pan')]
    const r = teTocaComprar(compras, detalles, '2026-09-30T08:00:00.000-05:00')
    expect(r).toEqual([{ producto_id: 'detergente', cadaDias: 15, haceDias: 16 }])
  })

  it('una sola compra, o comprado a diario, no dice nada; las compras sin cerrar no cuentan', () => {
    const compras = [compra('a', '2026-09-28'), compra('b', '2026-09-29'), { ...compra('c', '2026-09-01'), estado: 'en_curso' }]
    expect(teTocaComprar(compras, [d('a', 'pan'), d('b', 'pan'), d('c', 'sal'), d('a', 'sal')], '2026-09-30T08:00:00.000-05:00')).toEqual([])
  })

  it('la mediana de una cantidad par de saltos es el promedio de los dos del medio (0, 3 y 33 → cada ~17 días)', () => {
    const compras = [compra('a', '2026-08-01'), compra('b', '2026-08-04'), compra('c', '2026-09-03')]
    const detalles = [d('a', 'sal'), d('b', 'sal'), d('c', 'sal')]
    expect(teTocaComprar(compras, detalles, '2026-09-30T08:00:00.000-05:00')).toEqual([{ producto_id: 'sal', cadaDias: 17, haceDias: 27 }])
  })
})

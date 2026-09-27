import { describe, expect, it } from 'vitest'
import { aBase64, deBase64 } from '../src/base64.ts'
import { formatoCop, formatoNumero } from '../src/dinero.ts'
import { diaBogota, diasEntre, isoBogota } from '../src/fechas.ts'
import { escaparFormula, validarFila } from '../src/seguridad.ts'
import { ganaRemoto, enLotes } from '../src/sync.ts'
import { etiquetaPorUnidad, formatoContenido, precioPorUnidad } from '../src/unidades.ts'
import { leerConfig } from '../src/config.ts'

describe('fechas', () => {
  it('isoBogota usa -05:00 y milisegundos', () => {
    expect(isoBogota(Date.UTC(2026, 8, 27, 3, 0, 0))).toBe('2026-09-26T22:00:00.000-05:00')
  })
  it('el día es el de Bogotá, no el UTC', () => {
    expect(diaBogota('2026-09-27T03:00:00.000Z')).toBe('2026-09-26')
  })
  it('una fecha futura cuenta como 0 días', () => {
    expect(diasEntre('2026-09-28T00:00:00.000-05:00', '2026-09-27T00:00:00.000-05:00')).toBe(0)
  })
  it('cuenta días completos', () => {
    expect(diasEntre('2026-09-24T10:00:00.000-05:00', '2026-09-27T09:59:00.000-05:00')).toBe(2)
    expect(diasEntre('2026-09-24T10:00:00.000-05:00', '2026-09-27T10:00:00.000-05:00')).toBe(3)
  })
})

describe('base64', () => {
  it('ida y vuelta con tildes y ñ', () => {
    const t = '{"regionId":"v2.ABC","nombre":"Olímpica Riohacha ñ €"}'
    expect(deBase64(aBase64(t))).toBe(t)
  })
  it('coincide con Buffer', () => {
    for (const t of ['a', 'ab', 'abc', 'SW#exitocol;exitocol041', 'Éxito']) {
      expect(aBase64(t)).toBe(Buffer.from(t, 'utf8').toString('base64'))
    }
  })
})

describe('dinero y unidades', () => {
  it('formato COP', () => {
    expect(formatoCop(1234567)).toBe('$\u00a01.234.567')
    expect(formatoCop(-500)).toBe('-$\u00a0500')
    expect(formatoNumero(1.1)).toBe('1,1')
    expect(formatoNumero(2500)).toBe('2.500')
    expect(formatoNumero(0.6)).toBe('0,6')
    expect(formatoContenido(1100, 'ml')).toBe('1,1\u00a0L')
    expect(formatoContenido(500, 'g')).toBe('500\u00a0g')
    expect(formatoContenido(2500, 'g')).toBe('2,5\u00a0kg')
    expect(formatoContenido(30, 'unidad')).toBe('30\u00a0und')
    expect(formatoCop(null)).toBe('—')
  })
  it('precio por kg, L y unidad', () => {
    expect(precioPorUnidad(4500, 1000, 'g')).toBe(4500)
    expect(precioPorUnidad(2500, 500, 'g')).toBe(5000)
    expect(precioPorUnidad(3000, 1500, 'ml')).toBe(2000)
    expect(precioPorUnidad(15000, 30, 'unidad')).toBe(500)
    expect(precioPorUnidad(4500, null, 'g')).toBeNull()
    expect(precioPorUnidad(0, 1000, 'g')).toBeNull()
    expect(etiquetaPorUnidad('ml')).toBe('$/L')
  })
})

describe('seguridad', () => {
  it('escapa textos que serían fórmula', () => {
    expect(escaparFormula('=IMPORTXML("x")')).toBe(`'=IMPORTXML("x")`)
    expect(escaparFormula('+57')).toBe(`'+57`)
    expect(escaparFormula('Arroz')).toBe('Arroz')
  })
  it('valida y tipa una fila de cliente', () => {
    const r = validarFila('Productos', {
      producto_id: 'p1', nombre: '=HACK()', unidad_base: 'g', recurrente: 'TRUE', cantidad_habitual: '2',
      activo: true, updated_at: '2026-09-27T10:00:00.000-05:00', _srv: 'x', inventada: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fila).toMatchObject({ nombre: `'=HACK()`, recurrente: true, cantidad_habitual: 2 })
      expect(r.fila).not.toHaveProperty('_srv')
      expect(r.fila).not.toHaveProperty('inventada')
    }
  })
  it('rechaza tablas del servidor, ids vacíos y fechas malas', () => {
    expect(validarFila('Precios', { precio_id: 'x' }).ok).toBe(false)
    expect(validarFila('Productos', { nombre: 'x', updated_at: '2026-09-27T10:00:00.000-05:00' }).ok).toBe(false)
    expect(validarFila('Productos', { producto_id: 'x', updated_at: 'ayer' }).ok).toBe(false)
    expect(validarFila('Productos', { producto_id: 'x', cantidad_habitual: 'dos', updated_at: '2026-09-27T10:00:00.000-05:00' }).ok).toBe(false)
  })
})

describe('sync y config', () => {
  it('LWW: gana el updated_at mayor y en empate el remoto', () => {
    const a = { updated_at: '2026-09-27T10:00:00.000-05:00' }
    const b = { updated_at: '2026-09-27T10:00:01.000-05:00' }
    expect(ganaRemoto(a, b)).toBe(true)
    expect(ganaRemoto(b, a)).toBe(false)
    expect(ganaRemoto(a, { ...a })).toBe(true)
    expect(ganaRemoto(undefined, a)).toBe(true)
  })
  it('lotes', () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('config con valores por defecto y regiones', () => {
    const c = leerConfig([
      { clave: 'alerta_presupuesto', valor: '0.9' },
      { clave: 'region.EXITO', valor: '{"regionId":"v2.X","channel":"1","sellers":["a"],"localizada":true,"fecha":"x"}' },
      { clave: 'tienda_auto.D1', valor: 'si' },
      { clave: 'vigencia_auto_dias', valor: 'basura' },
    ])
    expect(c.alertaPresupuesto).toBe(0.9)
    expect(c.vigencias.auto).toBe(3)
    expect(c.regiones.EXITO?.localizada).toBe(true)
    expect(c.autoD1).toBe(true)
    expect(c.ubicacion.cp).toBe('440001')
  })
})

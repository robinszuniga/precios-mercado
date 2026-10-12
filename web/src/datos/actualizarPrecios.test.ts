import { describe, expect, it } from 'vitest'
import type { PrecioActual } from '@shared/esquema.ts'
import { FRESCO_MS, presentacionesPorActualizar } from './actualizarPrecios.ts'
import { nuevaPresentacion, nuevoProducto } from './escritura.ts'

const AHORA = Date.parse('2026-10-12T12:00:00-05:00')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()
const precio = (presentacion_id: string, ms: number, origen: PrecioActual['origen'] = 'online'): PrecioActual => ({
  clave: `${presentacion_id}|${origen}`, presentacion_id, tienda: 'EXITO', origen, fuente: 'auto', precio: 1000, precio_lista: null,
  disponible: true, region: 'RIOHACHA', fecha_verificado: hace(ms), confirmaciones: 1, version: 1,
}) as unknown as PrecioActual

describe('presentacionesPorActualizar', () => {
  const vivo = nuevoProducto({ nombre: 'Arroz' })
  const pres = (id: string, extra = {}) => ({ ...nuevaPresentacion({ producto_id: vivo.producto_id, tienda: 'EXITO', sku_id: '1', auto: true, ...extra }), presentacion_id: id })

  it('empieza por las más atrasadas: las que nunca se consultaron, luego las de precio online más viejo', () => {
    const a = pres('a'); const b = pres('b'); const c = pres('c')
    const r = presentacionesPorActualizar([a, b, c], [vivo], [precio('a', 3600_000), precio('c', 2 * 3600_000)], AHORA)
    expect(r.map((p) => p.presentacion_id)).toEqual(['b', 'c', 'a'])
  })

  it('no repite las consultadas hace menos de 10 minutos, así una segunda vuelta sigue por las que faltan', () => {
    const a = pres('a'); const b = pres('b')
    const r = presentacionesPorActualizar([a, b], [vivo], [precio('a', FRESCO_MS - 1000)], AHORA)
    expect(r.map((p) => p.presentacion_id)).toEqual(['b'])
    expect(presentacionesPorActualizar([a], [vivo], [precio('a', FRESCO_MS + 1000)], AHORA)).toHaveLength(1)
  })

  it('las que la tienda no encontró la última vez van al final: no se quedan siempre al frente gastando la cuota', () => {
    const muerta = pres('muerta', { ultimo_error: '2026-10-12 producto no encontrado' })
    const a = pres('a'); const b = pres('b')
    const r = presentacionesPorActualizar([muerta, a, b], [vivo], [precio('a', 3600_000), precio('b', 7200_000)], AHORA)
    expect(r.map((p) => p.presentacion_id)).toEqual(['b', 'a', 'muerta'])
  })

  it('un precio anotado en la tienda no cuenta como consulta de internet', () => {
    const a = pres('a')
    expect(presentacionesPorActualizar([a], [vivo], [precio('a', 1000, 'tienda')], AHORA)).toHaveLength(1)
  })

  it('salta los productos archivados o eliminados y las presentaciones sin vínculo o apagadas', () => {
    const archivado = nuevoProducto({ nombre: 'Viejo', activo: false })
    const eliminado = { ...nuevoProducto({ nombre: '' }), borrado: true }
    const r = presentacionesPorActualizar([
      pres('ok'),
      { ...pres('archivado'), producto_id: archivado.producto_id },
      { ...pres('eliminado'), producto_id: eliminado.producto_id },
      pres('sin_sku', { sku_id: '', ean: '' }),
      pres('manual', { auto: false }),
      pres('apagada', { activo: false }),
      pres('ara', { tienda: 'ARA' }),
    ], [vivo, archivado, eliminado], [], AHORA)
    expect(r.map((p) => p.presentacion_id)).toEqual(['ok'])
  })
})

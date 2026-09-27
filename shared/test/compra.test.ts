import { describe, expect, it } from 'vitest'
import type { Detalle, PrecioActual } from '../src/esquema.ts'
import { VIGENCIAS_POR_DEFECTO as V } from '../src/precioEfectivo.ts'
import { estadoPresupuesto } from '../src/presupuesto.ts'
import { costoEnTienda, opcionesProducto, planCompra, type ItemPlan } from '../src/recomendacion.ts'
import { resumenCierre } from '../src/resumen.ts'
import type { Tienda } from '../src/tiendas.ts'
import { actual, AHORA, pres, producto } from './ayudas.ts'

function mapa(xs: PrecioActual[]): Map<string, PrecioActual[]> {
  const m = new Map<string, PrecioActual[]>()
  for (const a of xs) m.set(a.presentacion_id, [...(m.get(a.presentacion_id) ?? []), a])
  return m
}

describe('opcionesProducto', () => {
  const presentaciones = [
    pres('exito-1kg', 'EXITO', 1000),
    pres('exito-500', 'EXITO', 500),
    pres('d1-1kg', 'D1', 1000),
    pres('ara-sin', 'ARA', null),
  ]
  const actuales = mapa([
    actual('exito-1kg', 'EXITO', 'online', 5000, 0),
    actual('exito-500', 'EXITO', 'online', 2400, 0), // 4.800/kg: la mejor de Éxito
    actual('d1-1kg', 'D1', 'tienda', 4600, 5),
    actual('ara-sin', 'ARA', 'tienda', 3000, 1),
  ])

  it('elige por precio por kg, no por precio de paquete', () => {
    const r = opcionesProducto(presentaciones, actuales, 'g', V, AHORA)
    expect(r.porTienda.EXITO?.presentacion.presentacion_id).toBe('exito-500')
    expect(r.porTienda.EXITO?.precioUnidad).toBe(4800)
    expect(r.mejor?.tienda).toBe('D1')
  })

  it('una presentación sin contenido no puede ganar la comparación por unidad', () => {
    const r = opcionesProducto(presentaciones, actuales, 'g', V, AHORA)
    expect(r.porTienda.ARA?.precioUnidad).toBeNull()
    expect(r.mejor?.tienda).not.toBe('ARA')
  })

  it('respeta el filtro de tiendas', () => {
    const r = opcionesProducto(presentaciones, actuales, 'g', V, AHORA, ['EXITO'])
    expect(Object.keys(r.porTienda)).toEqual(['EXITO'])
    expect(r.mejor?.tienda).toBe('EXITO')
  })

  it('las inactivas no cuentan y lo vencido queda aparte', () => {
    const r = opcionesProducto(
      [pres('x', 'OLIMPICA', 1000), pres('y', 'EXITO', 1000, { activo: false })],
      mapa([actual('x', 'OLIMPICA', 'tienda', 4000, 90), actual('y', 'EXITO', 'tienda', 1, 0)]),
      'g', V, AHORA,
    )
    expect(r.porTienda).toEqual({})
    expect(r.sinVigente.OLIMPICA?.ultimo?.precio).toBe(4000)
    expect(r.mejor).toBeNull()
  })
})

describe('costoEnTienda', () => {
  it('redondea a paquetes enteros y compara por equivalente', () => {
    const ops = opcionesProducto([pres('a', 'EXITO', 500)], mapa([actual('a', 'EXITO', 'tienda', 2500, 0)]), 'g', V, AHORA)
    const c = costoEnTienda(ops.porTienda.EXITO!, 2, 'g') // 2 kg con bolsas de 500 g
    expect(c.paquetes).toBe(4)
    expect(c.costoReal).toBe(10000)
    expect(c.costoEquivalente).toBe(10000)
  })
  it('granel: la cantidad va en kg sin redondear', () => {
    const ops = opcionesProducto([pres('t', 'OLIMPICA', 1000, { granel: true })], mapa([actual('t', 'OLIMPICA', 'tienda', 3000, 0)]), 'g', V, AHORA)
    const c = costoEnTienda(ops.porTienda.OLIMPICA!, 1.37, 'g')
    expect(c.paquetes).toBe(1.37)
    expect(c.costoReal).toBeCloseTo(4110)
  })
  it('siempre al menos un paquete', () => {
    const ops = opcionesProducto([pres('a', 'EXITO', 1000)], mapa([actual('a', 'EXITO', 'tienda', 5000, 0)]), 'g', V, AHORA)
    expect(costoEnTienda(ops.porTienda.EXITO!, 0.2, 'g').paquetes).toBe(1)
  })
})

function item(id: string, costos: Partial<Record<Tienda, number>>, fijo?: Tienda): ItemPlan {
  const c: ItemPlan['costos'] = {}
  for (const [t, v] of Object.entries(costos) as [Tienda, number][]) {
    c[t] = { opcion: {} as never, paquetes: 1, costoReal: v, costoEquivalente: v }
  }
  return { id, costos: c, fijo }
}

describe('planCompra', () => {
  it('reparte entre tiendas cuando el ahorro supera el costo del viaje extra', () => {
    const items = [item('a', { EXITO: 10000, D1: 6000 }), item('b', { EXITO: 5000, D1: 9000 })]
    const p = planCompra(items, ['EXITO', 'D1'], 3000)
    // Todo en Éxito: 15.000; todo en D1: 15.000; repartir: 11.000 + 3.000 de viaje = 14.000 → conviene repartir.
    expect(p.tiendas.sort()).toEqual(['D1', 'EXITO'])
    expect(p.total).toBe(11000)
    expect(p.ahorro).toBe(4000)
  })

  it('no reparte si el ahorro no alcanza para el viaje', () => {
    const items = [item('a', { EXITO: 10000, D1: 9000 }), item('b', { EXITO: 5000, D1: 7000 })]
    const p = planCompra(items, ['EXITO', 'D1'], 3000)
    expect(p.tiendas).toEqual(['EXITO'])
    expect(p.total).toBe(15000)
  })

  it('prefiere cubrir todo aunque cueste más', () => {
    const items = [item('a', { EXITO: 10000, D1: 5000 }), item('b', { EXITO: 5000 })]
    const p = planCompra(items, ['EXITO', 'D1'], 100000)
    expect(p.sinPrecio).toEqual([])
    expect(p.tiendas).toEqual(['EXITO'])
  })

  it('respeta la tienda fijada por el usuario', () => {
    const items = [item('a', { EXITO: 10000, D1: 5000 }, 'EXITO'), item('b', { EXITO: 5000, D1: 4000 })]
    const p = planCompra(items, ['EXITO', 'D1'], 3000)
    expect(p.grupos.find((g) => g.tienda === 'EXITO')?.items.map((i) => i.id)).toContain('a')
  })

  it('lo que no tiene precio en ninguna tienda va a sinPrecio y no hay ahorro calculable', () => {
    const p = planCompra([item('a', { EXITO: 1000 }), item('b', {})], ['EXITO'], 3000)
    expect(p.sinPrecio).toEqual(['b'])
    expect(p.ahorro).toBeNull()
    expect(p.todoEn[0]).toMatchObject({ tienda: 'EXITO', items: 1, de: 2 })
  })

  it('explica cada ítem con la siguiente tienda más barata', () => {
    const p = planCompra([item('a', { EXITO: 10000, D1: 9400, OLIMPICA: 9800 })], ['EXITO', 'D1', 'OLIMPICA'], 3000)
    expect(p.grupos[0].items[0].alternativa).toEqual({ tienda: 'OLIMPICA', costoReal: 9800, diferencia: 400 })
  })

  it('dice qué le falta a cada tienda y cuánto cuesta el plan en esos mismos ítems', () => {
    const p = planCompra([item('a', { EXITO: 1000, D1: 800 }), item('b', { EXITO: 500 })], ['EXITO', 'D1'], 0)
    const d1 = p.todoEn.find((x) => x.tienda === 'D1')!
    expect(d1.faltan).toEqual(['b'])
    expect(d1.planMismosItems).toBe(800)
  })

  it('ordena los grupos como las tiendas de hoy', () => {
    const p = planCompra([item('a', { EXITO: 1000 }), item('b', { D1: 500 })], ['D1', 'EXITO'], 0)
    expect(p.grupos.map((g) => g.tienda)).toEqual(['D1', 'EXITO'])
  })

  it('solo considera las tiendas de hoy', () => {
    const p = planCompra([item('a', { EXITO: 9000, ARA: 1000 })], ['EXITO'], 0)
    expect(p.tiendas).toEqual(['EXITO'])
  })
})

describe('estadoPresupuesto', () => {
  const d = (precio: number, estado: Detalle['estado'] = 'en_carrito') => ({ estado, cantidad: 1, precio_unitario: precio, borrado: false })
  it('verde, amarillo en 85 % exacto, amarillo en 100 %, rojo al pasarse', () => {
    expect(estadoPresupuesto([d(84000)], 100000, 0.85).color).toBe('verde')
    expect(estadoPresupuesto([d(85000)], 100000, 0.85).color).toBe('amarillo')
    expect(estadoPresupuesto([d(100000)], 100000, 0.85).color).toBe('amarillo')
    expect(estadoPresupuesto([d(100001)], 100000, 0.85).color).toBe('rojo')
  })
  it('solo suma lo que está en el carrito', () => {
    const r = estadoPresupuesto([d(1000), d(5000, 'pendiente'), d(7000, 'no_encontrado'), { ...d(9000), borrado: true }], 10000, 0.85, 5000)
    expect(r.gastado).toBe(1000)
    expect(r.restante).toBe(9000)
    expect(r.proyectado).toBe(6000)
  })
  it('avisa en amarillo si con lo que falta se pasaría, aunque lo gastado vaya bien', () => {
    const r = estadoPresupuesto([d(30000)], 100000, 0.85, 80000)
    expect(r).toMatchObject({ color: 'amarillo', motivo: 'pasaria', alTerminar: -10000 })
    expect(estadoPresupuesto([d(30000)], 100000, 0.85, 40000)).toMatchObject({ color: 'verde', motivo: 'ok', alTerminar: 30000 })
  })

  it('sin presupuesto no hay color', () => {
    expect(estadoPresupuesto([d(1000)], null, 0.85).color).toBeNull()
    expect(estadoPresupuesto([d(1000)], 0, 0.85).color).toBeNull()
  })
  it('cantidad decimal (granel) redondea a pesos', () => {
    expect(estadoPresupuesto([{ estado: 'en_carrito', cantidad: 1.37, precio_unitario: 3001, borrado: false }], null, 0.85).gastado).toBe(4111)
  })
})

describe('resumenCierre', () => {
  const productos = new Map([
    ['arroz', producto()],
    ['aceite', producto({ producto_id: 'aceite', nombre: 'Aceite', unidad_base: 'ml' })],
  ])
  const presentaciones = [
    pres('arroz-exito', 'EXITO', 1000),
    pres('arroz-d1', 'D1', 1000),
    pres('aceite-exito', 'EXITO', 1000, { producto_id: 'aceite' }),
  ]
  function det(id: string, producto_id: string, presentacion_id: string, cantidad: number, precio: number, extra: Partial<Detalle> = {}): Detalle {
    return {
      detalle_id: id, compra_id: 'c1', producto_id, nombre_libre: '', necesidad: null, presentacion_id, tienda: 'D1',
      cantidad, precio_unitario: precio, subtotal: Math.round(cantidad * precio), estado: 'en_carrito', orden: 0,
      updated_at: AHORA, borrado: false, ...extra,
    }
  }

  it('compara contra la tienda más barata que tiene todo', () => {
    const r = resumenCierre({
      compraId: 'c1',
      detalles: [det('1', 'arroz', 'arroz-d1', 2, 4000), det('2', 'aceite', 'aceite-exito', 1, 9000, { tienda: 'EXITO' })],
      productos,
      presentaciones,
      actualesPorPresentacion: mapa([
        actual('arroz-d1', 'D1', 'tienda', 4000, 0),
        actual('arroz-exito', 'EXITO', 'online', 5000, 0),
        actual('aceite-exito', 'EXITO', 'tienda', 9000, 0),
      ]),
      vigencias: V,
      ahora: AHORA,
    })
    expect(r.totalFinal).toBe(17000)
    // Solo Éxito tiene los dos: 2 kg × 5.000 + 1 L × 9.000 = 19.000.
    expect(r.referencia).toMatchObject({ tienda: 'EXITO', total: 19000, gastado: 17000, ahorro: 2000, completa: true })
    expect(r.filas.find((f) => f.tienda === 'D1')).toMatchObject({ items_con_precio: 1, items_total: 2, completo: false })
  })

  it('sin tienda completa usa la de mayor cobertura y compara solo lo que cubre', () => {
    const r = resumenCierre({
      compraId: 'c1',
      detalles: [det('1', 'arroz', 'arroz-d1', 1, 4000), det('2', 'aceite', 'aceite-exito', 1, 9000)],
      productos,
      presentaciones,
      actualesPorPresentacion: mapa([actual('arroz-d1', 'D1', 'tienda', 4000, 0), actual('aceite-exito', 'EXITO', 'tienda', 9000, 0)]),
      vigencias: V,
      ahora: AHORA,
    })
    expect(r.referencia?.completa).toBe(false)
    expect(r.referencia?.itemsComparados).toBe(1)
  })

  it('ahorro negativo cuando se gastó más', () => {
    const r = resumenCierre({
      compraId: 'c1',
      detalles: [det('1', 'arroz', 'arroz-d1', 1, 6000)],
      productos,
      presentaciones,
      actualesPorPresentacion: mapa([actual('arroz-d1', 'D1', 'tienda', 6000, 0), actual('arroz-exito', 'EXITO', 'online', 5000, 0)]),
      vigencias: V,
      ahora: AHORA,
    })
    expect(r.referencia).toMatchObject({ tienda: 'EXITO', ahorro: -1000 })
  })

  it('ítems libres y no encontrados no entran a la comparación', () => {
    const r = resumenCierre({
      compraId: 'c1',
      detalles: [
        det('1', 'arroz', 'arroz-d1', 1, 4000),
        det('2', '', '', 1, 2000, { nombre_libre: 'Chicles' }),
        det('3', 'aceite', 'aceite-exito', 1, 9000, { estado: 'no_encontrado' }),
      ],
      productos,
      presentaciones,
      actualesPorPresentacion: mapa([actual('arroz-d1', 'D1', 'tienda', 4000, 0)]),
      vigencias: V,
      ahora: AHORA,
    })
    expect(r.totalFinal).toBe(6000)
    expect(r.noComparables).toBe(1)
    expect(r.referencia?.itemsTotal).toBe(1)
  })
})

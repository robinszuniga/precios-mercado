import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarMeta } from './db.ts'
import { agregarALaCompra, asegurarCompra, guardar, nuevoProducto, quitarDeLaCompra, restaurarDetalle } from './escritura.ts'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: '', token: '' })
})

const vivos = async () => (await db.detalle.toArray()).filter((d) => !d.borrado)

describe('doble toque no duplica', () => {
  it('"Armar compra" dos veces seguidas deja una sola compra abierta', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz', recurrente: true }))
    const [a, b] = await Promise.all([asegurarCompra([]), asegurarCompra([])])
    expect(a.compra_id).toBe(b.compra_id)
    expect(await db.compras.count()).toBe(1)
    expect(await vivos()).toHaveLength(1)
  })

  it('"+ Agregar" dos veces (o dos productos sin compra abierta) no crea dos compras ni dos líneas', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    const [sal] = await guardar('Productos', nuevoProducto({ nombre: 'Sal' }))
    await Promise.all([agregarALaCompra(arroz, []), agregarALaCompra(arroz, []), agregarALaCompra(sal, [])])
    expect(await db.compras.count()).toBe(1)
    expect((await vivos()).map((d) => d.producto_id).sort()).toEqual([arroz.producto_id, sal.producto_id].sort())
  })

  it('Deshacer no duplica si el producto ya se volvió a agregar', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await agregarALaCompra(arroz, [])
    const quitado = (await quitarDeLaCompra(arroz.producto_id))!
    await agregarALaCompra(arroz, [])
    await restaurarDetalle(quitado)
    expect(await vivos()).toHaveLength(1)
  })
})

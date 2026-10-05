import { beforeEach, describe, expect, it } from 'vitest'
import { productoEliminado } from '@shared/esquema.ts'
import { cargarCatalogo } from './consultas.ts'
import { db } from './db.ts'
import { agregarALaCompra, asegurarCompra, eliminarProductos, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from './escritura.ts'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** Arroz con una marca, un precio, una compra ya cerrada y otra abierta; y Sal, que no se toca. */
async function sembrar() {
  const [arroz, sal] = await guardar('Productos', [nuevoProducto({ nombre: 'Arroz', marca: 'Diana' }), nuevoProducto({ nombre: 'Sal' })])
  const [pa, ps] = await guardar('Presentaciones', [
    nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', contenido: 1000 }),
    nuevaPresentacion({ producto_id: sal.producto_id, tienda: 'D1', contenido: 500 }),
  ])
  await registrarPrecioManual(pa, 4500)
  await registrarPrecioManual(ps, 1500)
  // Una compra cerrada con arroz y sal.
  const cerrada = await asegurarCompra(['D1'])
  const dArroz = await agregarALaCompra(arroz, ['D1'])
  const dSal = await agregarALaCompra(sal, ['D1'])
  await guardar('Compras', { ...cerrada, estado: 'cerrada', fecha_cierre: '2026-09-20T10:00:00.000-05:00' })
  // Una compra abierta con arroz.
  const abierta = await asegurarCompra(['D1'])
  const dAbierta = await agregarALaCompra(arroz, ['D1'])
  return { arroz, sal, pa, ps, cerrada, abierta, dArroz, dSal, dAbierta }
}

describe('eliminar productos para siempre', () => {
  it('queda solo la marca de eliminado y se va todo lo que dependía del producto, sin tocar lo de los demás', async () => {
    const s = await sembrar()
    expect(await eliminarProductos([s.arroz.producto_id])).toBe(1)

    const fila = (await db.productos.get(s.arroz.producto_id))!
    expect(fila).toMatchObject({ borrado: true, activo: false, recurrente: false, nombre: '', marca: '', notas: '' })
    expect(productoEliminado(fila)).toBe(true)
    // Sus marcas y tamaños, su precio y su historial ya no están…
    expect(await db.presentaciones.get(s.pa.presentacion_id)).toBeUndefined()
    expect(await db.preciosActuales.where('presentacion_id').equals(s.pa.presentacion_id).count()).toBe(0)
    expect(await db.historial.where('presentacion_id').equals(s.pa.presentacion_id).count()).toBe(0)
    // …y lo de Sal sigue.
    expect(await db.presentaciones.get(s.ps.presentacion_id)).toBeTruthy()
    expect(await db.preciosActuales.where('presentacion_id').equals(s.ps.presentacion_id).count()).toBe(1)
    expect((await db.productos.get(s.sal.producto_id))?.nombre).toBe('Sal')
  })

  it('la compra ya cerrada conserva la línea con el nombre como texto; en la compra abierta, el producto sale', async () => {
    const s = await sembrar()
    await eliminarProductos([s.arroz.producto_id])
    expect(await db.detalle.get(s.dArroz.detalle_id)).toMatchObject({ producto_id: '', nombre_libre: 'Arroz', borrado: false })
    expect(await db.detalle.get(s.dAbierta.detalle_id)).toMatchObject({ borrado: true })
    // Lo de otro producto en la compra cerrada no se toca.
    expect(await db.detalle.get(s.dSal.detalle_id)).toMatchObject({ producto_id: s.sal.producto_id })
  })

  it('todo viaja a la nube: la marca de eliminado y las líneas cambiadas quedan en la cola de envío', async () => {
    const s = await sembrar()
    await db.outbox.clear()
    await eliminarProductos([s.arroz.producto_id])
    const cambios = (await db.outbox.toArray()).flatMap((e) => (e.payload.cambios ?? []) as { tabla: string; fila: Record<string, unknown> }[])
    expect(cambios.find((c) => c.tabla === 'Productos')?.fila).toMatchObject({ producto_id: s.arroz.producto_id, borrado: true, nombre: '', activo: false })
    expect(cambios.filter((c) => c.tabla === 'Compras_detalle')).toHaveLength(2) // la cerrada (texto) y la abierta (sale)
  })

  it('no aparece en ninguna parte: ni en el catálogo ni en sus presentaciones; y repetirlo no hace nada', async () => {
    const s = await sembrar()
    expect(await eliminarProductos([s.arroz.producto_id, s.arroz.producto_id])).toBe(1)
    const cat = await cargarCatalogo()
    expect(cat.productos.map((p) => p.nombre)).toEqual(['Sal'])
    expect(cat.producto.has(s.arroz.producto_id)).toBe(false)
    expect(await eliminarProductos([s.arroz.producto_id])).toBe(0)
    expect(await eliminarProductos(['no-existe'])).toBe(0)
  })

  it('varios a la vez, también los que estaban archivados', async () => {
    const [a, b, c] = await guardar('Productos', [nuevoProducto({ nombre: 'A', activo: false }), nuevoProducto({ nombre: 'B', activo: false }), nuevoProducto({ nombre: 'C' })])
    expect(await eliminarProductos([a.producto_id, b.producto_id])).toBe(2)
    expect((await cargarCatalogo()).productos.map((p) => p.nombre)).toEqual(['C'])
    expect((await db.productos.get(c.producto_id))?.borrado).toBeFalsy()
  })

  it('una fila vacía que dejó un script viejo al eliminar también cuenta como eliminada', () => {
    expect(productoEliminado({ nombre: '' })).toBe(true)
    expect(productoEliminado({ nombre: '  ', borrado: false })).toBe(true)
    expect(productoEliminado({ nombre: 'Arroz' })).toBe(false)
    expect(productoEliminado({ nombre: 'Arroz', borrado: true })).toBe(true)
  })
})

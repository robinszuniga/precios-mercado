import { beforeEach, describe, expect, it } from 'vitest'
import { productoEliminado } from '@shared/esquema.ts'
import { cargarCatalogo } from './consultas.ts'
import { db } from './db.ts'
import { lineasVisibles } from './lineas.ts'
import { agregarALaCompra, archivarProductos, asegurarCompra, crearCategoria, deshacerReemplazo, empezarDeCero, eliminarProductos, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from './escritura.ts'

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
  const lineas = [await agregarALaCompra(arroz, ['D1']), await agregarALaCompra(sal, ['D1'])]
  // Lo que se compró (en el carrito) y se cierra, como pasa de verdad.
  const [dArroz, dSal] = await guardar('Compras_detalle', lineas.map((d) => ({ ...d, estado: 'en_carrito' as const, cantidad: 1, precio_unitario: 4600, subtotal: 4600 })))
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

  it('lo comprado se conserva como texto con el nombre; lo pendiente de la compra abierta no aparece; y nunca se marca nada como borrado', async () => {
    const s = await sembrar()
    await eliminarProductos([s.arroz.producto_id])
    expect(await db.detalle.get(s.dArroz.detalle_id)).toMatchObject({ producto_id: '', nombre_libre: 'Arroz', borrado: false })
    // La línea pendiente de la compra abierta no se reescribe (no se toca nada que signifique «la quité yo»): al mostrar, no aparece.
    const pendiente = (await db.detalle.get(s.dAbierta.detalle_id))!
    expect(pendiente).toMatchObject({ producto_id: s.arroz.producto_id, borrado: false })
    const cat = await cargarCatalogo()
    expect(lineasVisibles([pendiente], (id) => cat.producto.has(id))).toEqual([])
    // Lo de otro producto en la compra cerrada no se toca.
    expect(await db.detalle.get(s.dSal.detalle_id)).toMatchObject({ producto_id: s.sal.producto_id })
  })

  it('todo viaja a la nube: la marca de eliminado y las líneas cambiadas quedan en la cola de envío', async () => {
    const s = await sembrar()
    await db.outbox.clear()
    await eliminarProductos([s.arroz.producto_id])
    const cambios = (await db.outbox.toArray()).flatMap((e) => (e.payload.cambios ?? []) as { tabla: string; fila: Record<string, unknown> }[])
    expect(cambios.find((c) => c.tabla === 'Productos')?.fila).toMatchObject({ producto_id: s.arroz.producto_id, borrado: true, nombre: '', activo: false })
    expect(cambios.filter((c) => c.tabla === 'Compras_detalle')).toHaveLength(1) // solo la comprada (queda como texto)
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

describe('archivar varios a la vez', () => {
  it('los archiva, saca de la compra abierta lo pendiente (no lo del carrito ni las compras cerradas) y se puede deshacer', async () => {
    const { arroz, sal, dAbierta, dArroz } = await sembrar()
    const enCarrito = { ...(await db.detalle.get(dAbierta.detalle_id))!, estado: 'en_carrito' as const }
    // Una segunda línea de la compra abierta: la de Sal queda pendiente; la de Arroz, en el carrito.
    const dSalAbierta = await agregarALaCompra(sal, ['D1'])
    await guardar('Compras_detalle', enCarrito)

    const { archivados, quitados } = await archivarProductos([arroz.producto_id, sal.producto_id, arroz.producto_id])
    expect(archivados.map((p) => p.nombre).sort()).toEqual(['Arroz', 'Sal'])
    expect((await db.productos.get(arroz.producto_id))?.activo).toBe(false)
    expect((await db.productos.get(sal.producto_id))?.activo).toBe(false)
    expect((await db.productos.get(arroz.producto_id))?.borrado).toBeFalsy() // archivar no es eliminar
    // Lo pendiente sale de la compra abierta; lo que ya está en el carrito y las compras cerradas se quedan.
    expect(quitados.map((d) => d.detalle_id)).toEqual([dSalAbierta.detalle_id])
    expect((await db.detalle.get(dSalAbierta.detalle_id))?.borrado).toBe(true)
    expect((await db.detalle.get(dAbierta.detalle_id))?.borrado).toBeFalsy()
    expect((await db.detalle.get(dArroz.detalle_id))?.borrado).toBeFalsy()
    // Conservan sus precios: se pueden recuperar.
    expect(await db.presentaciones.where('producto_id').equals(arroz.producto_id).count()).toBe(1)

    await deshacerReemplazo(archivados, quitados)
    expect((await db.productos.get(arroz.producto_id))?.activo).toBe(true)
    expect((await db.productos.get(sal.producto_id))?.activo).toBe(true)
    expect((await db.detalle.get(dSalAbierta.detalle_id))?.borrado).toBe(false)
  })

  it('lo que ya estaba archivado o eliminado no cuenta, y sin nada que archivar no hace nada', async () => {
    const { arroz, sal } = await sembrar()
    await archivarProductos([sal.producto_id])
    const antes = await db.outbox.count()
    expect((await archivarProductos([sal.producto_id, 'no-existe'])).archivados).toEqual([])
    expect(await db.outbox.count()).toBe(antes)
    await eliminarProductos([arroz.producto_id])
    expect((await archivarProductos([arroz.producto_id])).archivados).toEqual([])
    expect(await archivarProductos([])).toEqual({ archivados: [], quitados: [] })
  })
})

describe('empezar de cero', () => {
  it('elimina todos los productos (activos y archivados) y los pasillos; las compras pasadas se quedan con los nombres', async () => {
    const { arroz, sal, cerrada, dArroz } = await sembrar()
    const [leche] = await guardar('Productos', nuevoProducto({ nombre: 'Leche', activo: false })) // archivada
    await crearCategoria('Granos')
    await crearCategoria('Lácteos')

    expect(await empezarDeCero()).toEqual({ productos: 3, pasillos: 2 })
    const cat = await cargarCatalogo()
    expect(cat.productos).toEqual([])
    expect(cat.categorias).toEqual([])
    for (const p of [arroz, sal, leche]) {
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: true, nombre: '', activo: false })
    }
    expect(await db.presentaciones.count()).toBe(0)
    expect(await db.preciosActuales.count()).toBe(0)
    // La compra cerrada se conserva, con el nombre como texto.
    expect((await db.compras.get(cerrada.compra_id))?.estado).toBe('cerrada')
    expect(await db.detalle.get(dArroz.detalle_id)).toMatchObject({ producto_id: '', nombre_libre: 'Arroz' })
    // Todo viaja a la nube como cambios normales.
    const enCola = (await db.outbox.toArray()).map((e) => JSON.stringify(e.payload))
    expect(enCola.some((x) => x.includes('"tabla":"Categorias"') && x.includes('"borrado":true'))).toBe(true)
    // Una segunda vez no hay nada que borrar.
    expect(await empezarDeCero()).toEqual({ productos: 0, pasillos: 0 })
  })

  it('después se puede armar la lista propia desde cero', async () => {
    await sembrar()
    await crearCategoria('Granos')
    await empezarDeCero()
    const { crearDesdeLista } = await import('./escritura.ts')
    await crearDesdeLista([{ nombre: 'Arroz', cantidad: 5, unidad_base: 'g', pasillo: 'Granos', existente: null }], { recurrentes: true, aLaCompra: false, tiendasHoy: [] })
    const cat = await cargarCatalogo()
    expect(cat.productos.map((p) => p.nombre)).toEqual(['Arroz'])
    expect(cat.categorias.map((c) => c.nombre)).toEqual(['Granos']) // el pasillo se vuelve a crear, no se reusa el borrado
  })
})


import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { compraAbierta, crearCategoria, crearDesdeLista, eliminarProductos, guardar, nuevoProducto } from '../datos/escritura.ts'
import { PegarLista } from './PegarLista.tsx'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: '', token: '' })
})

async function detallesAbiertos() {
  const c = await compraAbierta()
  return c ? (await db.detalle.where('compra_id').equals(c.compra_id).toArray()).filter((d) => !d.borrado) : []
}

describe('crearDesdeLista', () => {
  it('crea pasillos en orden, productos ★ y los mete en la compra con su cantidad', async () => {
    await crearCategoria('Carnes')
    const r = await crearDesdeLista([
      { nombre: 'Arroz', cantidad: 5, unidad_base: 'g', pasillo: 'Granos', existente: null },
      { nombre: 'Pollo', cantidad: 2, unidad_base: 'g', pasillo: 'carnes', existente: null },
      { nombre: 'Leche', cantidad: 6, unidad_base: 'ml', pasillo: 'Lácteos', existente: null },
    ], { recurrentes: true, aLaCompra: true, tiendasHoy: ['D1'] })
    expect(r).toMatchObject({ creados: 3, actualizados: 0, pasillos: 2, archivados: [] })

    const cats = (await db.categorias.toArray()).sort((a, b) => a.orden - b.orden).map((c) => c.nombre)
    expect(cats).toEqual(['Carnes', 'Granos', 'Lácteos'])
    const prods = await db.productos.toArray()
    expect(prods.every((p) => p.recurrente)).toBe(true)
    const pollo = prods.find((p) => p.nombre === 'Pollo')!
    expect((await db.categorias.get(pollo.categoria_id))?.nombre).toBe('Carnes')

    const ds = await detallesAbiertos()
    expect(ds).toHaveLength(3)
    expect(ds.find((d) => d.producto_id === pollo.producto_id)?.necesidad).toBe(2)
  })

  it('un producto que ya existía se actualiza, no se duplica, ni en el catálogo ni en la compra', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', cantidad_habitual: 1, recurrente: true }))
    await crearDesdeLista([{ nombre: 'Arroz', cantidad: 1, unidad_base: 'g', pasillo: '', existente: arroz }], { recurrentes: true, aLaCompra: true, tiendasHoy: [] })
    await crearDesdeLista([{ nombre: 'arroz', cantidad: 5, unidad_base: 'g', pasillo: '', existente: arroz }], { recurrentes: true, aLaCompra: true, tiendasHoy: [] })
    expect(await db.productos.count()).toBe(1)
    expect((await db.productos.get(arroz.producto_id))?.cantidad_habitual).toBe(5)
    const ds = await detallesAbiertos()
    expect(ds).toHaveLength(1)
    expect(ds[0].necesidad).toBe(5)
  })

  it('sin "agregar a la compra" no abre compra', async () => {
    await crearDesdeLista([{ nombre: 'Sal', cantidad: 1, unidad_base: 'g', pasillo: '', existente: null }], { recurrentes: false, aLaCompra: false, tiendasHoy: [] })
    expect(await compraAbierta()).toBeUndefined()
    expect((await db.productos.toArray())[0].recurrente).toBe(false)
  })
})

describe('PegarLista', () => {
  it('pegar → revisar → guardar', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Huevos', unidad_base: 'unidad', cantidad_habitual: 15 }))
    let listo = false
    render(<PegarLista onListo={() => { listo = true }} />)
    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'Granos:\nArroz 5 kg\nhuevo 30\nSal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))

    expect(await screen.findByText(/Encontré/)).toHaveTextContent('Encontré 3 productos (1 ya los tenías)')
    expect(screen.getByText('Ya lo tienes: se actualiza')).toBeInTheDocument()
    expect(screen.getByText(/No dice cuánto/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cantidad de Arroz')).toHaveValue('5')

    fireEvent.change(screen.getByLabelText('Cantidad de Sal'), { target: { value: '0,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 3 productos' }))
    await waitFor(() => expect(listo).toBe(true))

    const prods = await db.productos.toArray()
    expect(prods).toHaveLength(3)
    expect(prods.find((p) => p.nombre === 'Sal')?.cantidad_habitual).toBe(0.5)
    expect(prods.find((p) => p.nombre === 'Huevos')?.cantidad_habitual).toBe(30)
    expect(await detallesAbiertos()).toHaveLength(3)
  })

  it('no deja guardar una cantidad vacía', async () => {
    render(<PegarLista onListo={() => {}} />)
    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'Arroz 5 kg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    fireEvent.change(await screen.findByLabelText('Cantidad de Arroz'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Guardar 1 producto' })).toBeDisabled()
  })
})

describe('Reemplazar mi lista', () => {
  it('archiva lo que no está en la lista nueva, lo saca de la compra (salvo lo ya en el carrito) y se puede deshacer', async () => {
    const { agregarALaCompra, deshacerReemplazo } = await import('../datos/escritura.ts')
    const [arroz, sal, cafe] = await guardar('Productos', [nuevoProducto({ nombre: 'Arroz' }), nuevoProducto({ nombre: 'Sal' }), nuevoProducto({ nombre: 'Café' })])
    await agregarALaCompra(sal, [])
    const dCafe = await agregarALaCompra(cafe, [])
    await guardar('Compras_detalle', { ...dCafe, estado: 'en_carrito' })

    const r = await crearDesdeLista([
      { nombre: 'Arroz', cantidad: 5, unidad_base: 'g', pasillo: '', existente: arroz },
      { nombre: 'Leche', cantidad: 6, unidad_base: 'ml', pasillo: '', existente: null },
    ], { recurrentes: true, aLaCompra: true, tiendasHoy: [], reemplazar: true })

    expect(r.archivados.map((p) => p.nombre).sort()).toEqual(['Café', 'Sal'])
    const activos = (await db.productos.toArray()).filter((p) => p.activo).map((p) => p.nombre).sort()
    expect(activos).toEqual(['Arroz', 'Leche'])
    const enCompra = (await detallesAbiertos()).map((d) => d.producto_id)
    expect(enCompra).not.toContain(sal.producto_id) // pendiente: sale
    expect(enCompra).toContain(cafe.producto_id) // ya en el carrito: se queda

    await deshacerReemplazo(r.archivados, r.quitados)
    expect((await db.productos.toArray()).filter((p) => p.activo)).toHaveLength(4)
    expect((await detallesAbiertos()).map((d) => d.producto_id)).toContain(sal.producto_id)
  })

  it('un producto eliminado para siempre no revive: vuelve a salir como producto nuevo', async () => {
    const [sal] = await guardar('Productos', nuevoProducto({ nombre: 'Sal', activo: false }))
    await eliminarProductos([sal.producto_id])
    render(<PegarLista onListo={() => {}} />)
    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'Sal 1 kg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(await screen.findByText(/Encontré/)).toHaveTextContent('Encontré 1 producto')
    expect(screen.queryByText('Ya lo tienes: se actualiza')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 producto' }))
    await waitFor(async () => expect((await db.productos.toArray()).filter((p) => !p.borrado && p.nombre === 'Sal')).toHaveLength(1))
    expect((await db.productos.get(sal.producto_id))?.borrado).toBe(true)
  })

  it('un producto archivado revive si vuelve en una lista (con sus precios)', async () => {
    const [sal] = await guardar('Productos', nuevoProducto({ nombre: 'Sal', activo: false }))
    render(<PegarLista onListo={() => {}} />)
    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'Sal 1 kg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(await screen.findByText('Ya lo tienes: se actualiza')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 producto' }))
    await waitFor(async () => expect((await db.productos.get(sal.producto_id))?.activo).toBe(true))
  })

  it('la casilla dice cuántos y cuáles se archivarían', async () => {
    await guardar('Productos', [nuevoProducto({ nombre: 'Arroz' }), nuevoProducto({ nombre: 'Sal' })])
    render(<PegarLista onListo={() => {}} />)
    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'Arroz 5 kg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    fireEvent.click(await screen.findByLabelText('Reemplazar mi lista: archivar los 1 productos que no están en esta'))
    expect(screen.getByText(/Se archivan: Sal\./)).toBeInTheDocument()
  })
})

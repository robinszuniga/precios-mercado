import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { compraAbierta, crearCategoria, crearDesdeLista, guardar, nuevoProducto } from '../datos/escritura.ts'
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
    expect(r).toEqual({ creados: 3, actualizados: 0, pasillos: 2 })

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

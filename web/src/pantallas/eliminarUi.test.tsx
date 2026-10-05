import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../datos/db.ts'
import { guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from '../datos/escritura.ts'
import { Ajustes } from './Ajustes.tsx'
import { DetalleProducto } from './Producto.tsx'

const ESPERA = 10_000

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = ''
})

async function conPrecio(nombre: string, activo = true) {
  const [p] = await guardar('Productos', nuevoProducto({ nombre, activo }))
  const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
  await registrarPrecioManual(pres, 4500)
  return { p, pres }
}

describe('eliminar para siempre · pantallas', () => {
  it('Ajustes: un archivado se elimina con su botón y la confirmación; "No, conservar" no borra nada', async () => {
    const { p, pres } = await conPrecio('Lentejas', false)
    render(<Ajustes />)
    fireEvent.click(await screen.findByText(/Productos archivados \(1\)/, {}, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Lentejas para siempre' }))
    expect(await screen.findByRole('dialog', { name: 'Eliminar para siempre' })).toHaveTextContent('Lentejas')
    fireEvent.click(screen.getByRole('button', { name: 'No, conservar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await db.productos.get(p.producto_id))?.borrado).toBeFalsy()
    expect(await db.presentaciones.get(pres.presentacion_id)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Lentejas para siempre' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, eliminar para siempre' }))
    await waitFor(async () => expect((await db.productos.get(p.producto_id))?.borrado).toBe(true))
    expect(await db.presentaciones.get(pres.presentacion_id)).toBeUndefined()
    await waitFor(() => expect(screen.queryByText(/Productos archivados/)).toBeNull())
  }, ESPERA * 2)

  it('Ajustes: "Eliminar todos los archivados" aparece con más de uno y elimina a todos', async () => {
    const a = await conPrecio('Lentejas', false)
    const b = await conPrecio('Garbanzos', false)
    render(<Ajustes />)
    fireEvent.click(await screen.findByText(/Productos archivados \(2\)/, {}, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('button', { name: /Eliminar todos los archivados/ }))
    expect(await screen.findByRole('dialog', { name: 'Eliminar 2 productos para siempre' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar para siempre' }))
    await waitFor(async () => {
      expect((await db.productos.get(a.p.producto_id))?.borrado).toBe(true)
      expect((await db.productos.get(b.p.producto_id))?.borrado).toBe(true)
    })
  }, ESPERA * 2)

  it('Producto: Editar → Eliminar para siempre… → confirmar elimina y vuelve a la lista', async () => {
    const { p } = await conPrecio('Arroz')
    render(<DetalleProducto id={p.producto_id} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }, { timeout: ESPERA }))
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar para siempre/ }))
    // La confirmación se abre un instante después de que se cierra Editar.
    const confirmar = await screen.findByRole('button', { name: 'Sí, eliminar para siempre' }, { timeout: 3000 })
    expect(screen.queryByRole('dialog', { name: 'Editar producto' })).toBeNull()
    fireEvent.click(confirmar)
    await waitFor(async () => expect((await db.productos.get(p.producto_id))?.borrado).toBe(true))
    await waitFor(() => expect(location.hash).toContain('lista'))
  }, ESPERA * 2)
})

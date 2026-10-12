import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Categoria, Producto } from '@shared/esquema.ts'
import { db, guardarMeta } from '../datos/db.ts'
import { crearCategoria, guardar, nuevoProducto } from '../datos/escritura.ts'
import { FormProducto } from './FormProducto.tsx'

const ESPERA = 10_000

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function pasillos(...nombres: string[]): Promise<Categoria[]> {
  const xs: Categoria[] = []
  for (const n of nombres) xs.push(await crearCategoria(n))
  return xs
}

const ficha = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre })

describe('FormProducto · pasillo', () => {
  it('muestra los pasillos como fichas; sin elegir uno no deja guardar, y al tocar uno sí', async () => {
    const cats = await pasillos('Granos', 'Lácteos', 'Aseo')
    render(<FormProducto categorias={cats} onListo={() => {}} />)
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'false')
    expect(ficha('Lácteos')).toBeInTheDocument()
    expect(ficha('+ Nuevo pasillo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Arroz' } })
    expect(screen.getByRole('button', { name: 'Crear producto' })).toBeDisabled()
    expect(screen.getByText('Toca uno para poder guardar.')).toBeInTheDocument()
    fireEvent.click(ficha('Granos'))
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Crear producto' })).toBeEnabled()
    expect(screen.queryByText('Toca uno para poder guardar.')).toBeNull()
    // Elegir otro cambia la selección (es de una sola).
    fireEvent.click(ficha('Aseo'))
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'false')
    expect(ficha('Aseo')).toHaveAttribute('aria-pressed', 'true')
  })

  it('guarda el producto en el pasillo elegido y el siguiente formulario trae ese pasillo puesto', async () => {
    const cats = await pasillos('Granos', 'Lácteos')
    let creado: Producto | null = null
    const { unmount } = render(<FormProducto categorias={cats} onListo={(p) => { creado = p }} />)
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Leche' } })
    fireEvent.click(ficha('Lácteos'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(creado).not.toBeNull())
    expect(creado!.categoria_id).toBe(cats[1].categoria_id)
    expect((await db.productos.get(creado!.producto_id))?.categoria_id).toBe(cats[1].categoria_id)
    unmount()

    render(<FormProducto categorias={cats} onListo={() => {}} />)
    await waitFor(() => expect(ficha('Lácteos')).toHaveAttribute('aria-pressed', 'true'), { timeout: ESPERA })
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Queso' } })
    expect(screen.getByRole('button', { name: 'Crear producto' })).toBeEnabled()
  })

  it('si la persona ya eligió otro pasillo, lo recordado no lo pisa; y si el recordado ya no existe, no se pone', async () => {
    const cats = await pasillos('Granos', 'Lácteos')
    await guardarMeta('ultimoPasillo', cats[0].categoria_id)
    render(<FormProducto categorias={cats} onListo={() => {}} />)
    fireEvent.click(ficha('Lácteos')) // antes de que llegue lo recordado
    await new Promise((r) => setTimeout(r, 200))
    expect(ficha('Lácteos')).toHaveAttribute('aria-pressed', 'true')
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'false')
  })

  it('un pasillo recordado que ya no existe no se pone', async () => {
    const cats = await pasillos('Granos', 'Lácteos')
    await guardarMeta('ultimoPasillo', 'ya-no-existe')
    render(<FormProducto categorias={cats} onListo={() => {}} />)
    await new Promise((r) => setTimeout(r, 200))
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'false')
    expect(ficha('Lácteos')).toHaveAttribute('aria-pressed', 'false')
  })

  it('con un solo pasillo viene elegido', async () => {
    const cats = await pasillos('Despensa')
    render(<FormProducto categorias={cats} onListo={() => {}} />)
    await waitFor(() => expect(ficha('Despensa')).toHaveAttribute('aria-pressed', 'true'), { timeout: ESPERA })
  })

  it('"+ Nuevo pasillo" pide el nombre y crea el pasillo junto con el producto', async () => {
    const cats = await pasillos('Granos')
    let creado: Producto | null = null
    render(<FormProducto categorias={cats} onListo={(p) => { creado = p }} />)
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Pollo' } })
    fireEvent.click(ficha('+ Nuevo pasillo'))
    fireEvent.change(await screen.findByLabelText('Nombre del pasillo'), { target: { value: 'Carnes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(creado).not.toBeNull())
    const todas = (await db.categorias.toArray()).filter((c) => !c.borrado)
    expect(todas.map((c) => c.nombre).sort()).toEqual(['Carnes', 'Granos'])
    expect(todas.find((c) => c.nombre === 'Carnes')!.categoria_id).toBe(creado!.categoria_id)
  })

  it('un pasillo nuevo con el nombre de uno que ya hay (sin importar mayúsculas ni tildes) se reutiliza', async () => {
    const cats = await pasillos('Lácteos y huevos')
    let creado: Producto | null = null
    render(<FormProducto categorias={cats} onListo={(p) => { creado = p }} />)
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Huevos' } })
    fireEvent.click(ficha('+ Nuevo pasillo'))
    fireEvent.change(await screen.findByLabelText('Nombre del pasillo'), { target: { value: 'lacteos Y HUEVOS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(creado).not.toBeNull())
    expect(creado!.categoria_id).toBe(cats[0].categoria_id)
    expect((await db.categorias.toArray()).filter((c) => !c.borrado)).toHaveLength(1)
  })

  it('sin ningún pasillo (por ejemplo tras "Empezar de cero") ya viene "+ Nuevo pasillo" con "General", y se puede guardar', async () => {
    let creado: Producto | null = null
    render(<FormProducto categorias={[]} onListo={(p) => { creado = p }} />)
    expect(ficha('+ Nuevo pasillo')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Nombre del pasillo')).toHaveValue('General')
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Arroz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(creado).not.toBeNull())
    expect((await db.categorias.toArray()).map((c) => c.nombre)).toEqual(['General'])
  })

  it('al editar: se ve el pasillo actual y se puede cambiar; un producto sin pasillo puede seguir sin él', async () => {
    const cats = await pasillos('Granos', 'Lácteos')
    const [conPasillo] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', categoria_id: cats[0].categoria_id }))
    const [sinPasillo] = await guardar('Productos', nuevoProducto({ nombre: 'Sal' }))

    const { unmount } = render(<FormProducto inicial={conPasillo} categorias={cats} onListo={() => {}} />)
    expect(ficha('Granos')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Sin pasillo' })).toBeNull()
    fireEvent.click(ficha('Lácteos'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(async () => expect((await db.productos.get(conPasillo.producto_id))?.categoria_id).toBe(cats[1].categoria_id))
    unmount()

    render(<FormProducto inicial={sinPasillo} categorias={cats} onListo={() => {}} />)
    expect(ficha('Sin pasillo')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    // Editar no le cambia el pasillo recordado a quien está arreglando un producto viejo.
    await new Promise((r) => setTimeout(r, 150))
    expect(ficha('Sin pasillo')).toHaveAttribute('aria-pressed', 'true')
  })
})

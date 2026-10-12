import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { confirmarIrreversible } from '../componentes/pruebasConfirmar.ts'
import { Avisos } from '../componentes/ui.tsx'
import { db } from '../datos/db.ts'
import { crearCategoria, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from '../datos/escritura.ts'
import { Lista } from './Lista.tsx'
import { DetalleProducto } from './Producto.tsx'

const ESPERA = 10_000

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = '#/lista'
})

async function conDosProductos() {
  const granos = await crearCategoria('Granos')
  const [arroz, frijol] = await guardar('Productos', [
    nuevoProducto({ nombre: 'Arroz', categoria_id: granos.categoria_id }),
    nuevoProducto({ nombre: 'Fríjol', categoria_id: granos.categoria_id }),
  ])
  return { arroz, frijol }
}

const montar = () => render(<><Lista /><Avisos /></>)

describe('confirmar algo irreversible', () => {
  it('Eliminar: la hoja enfoca «No, conservar»; un toque inmediato no borra y el botón se activa tras una pausa', async () => {
    const { arroz } = await conDosProductos()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Arroz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar (1)…' }))
    const destructivo = await screen.findByRole('button', { name: 'Sí, eliminar para siempre' })
    // Foco en la salida segura (un lector de pantalla o el teclado no caen sobre el botón peligroso).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No, conservar' }))
    // El segundo toque del doble toque cae encima: no hace nada.
    expect(destructivo).toBeDisabled()
    fireEvent.click(destructivo)
    expect((await db.productos.get(arroz.producto_id))?.borrado).toBeFalsy()
    await waitFor(() => expect(destructivo).toBeEnabled(), { timeout: 3000 })
    // La salida segura va antes en el orden de lectura.
    const botones = screen.getAllByRole('button').filter((b) => /No, conservar|Sí, eliminar/.test(b.textContent ?? ''))
    expect(botones.map((b) => b.textContent)).toEqual(['No, conservar', 'Sí, eliminar para siempre'])
  })

  it('al confirmar desde la barra de selección el foco queda en «Seleccionar», no en el <body>', async () => {
    const { arroz } = await conDosProductos()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Arroz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar (1)…' }))
    await confirmarIrreversible('Sí, eliminar para siempre')
    await waitFor(async () => expect((await db.productos.get(arroz.producto_id))?.borrado).toBe(true))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Seleccionar' })))
  })

  it('«Empezar de cero»: foco en «No, conservar» y el botón de borrar espera su pausa', async () => {
    await conDosProductos()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Empezar de cero…/ }, { timeout: ESPERA }))
    const destructivo = await screen.findByRole('button', { name: 'Sí, borrar todo y empezar de cero' }, { timeout: ESPERA })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No, conservar' }))
    expect(destructivo).toBeDisabled()
    await waitFor(() => expect(destructivo).toBeEnabled(), { timeout: 3000 })
  })

  it('«Eliminar…» sin nada marcado se ve apagado, como «Archivar»', async () => {
    await conDosProductos()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    const eliminar = screen.getByRole('button', { name: /^Eliminar/ })
    expect(eliminar).toBeDisabled()
    expect(eliminar.className).toMatch(/disabled:bg-stone-100/)
    expect(eliminar.className).toMatch(/disabled:text-stone-500/)
  })
})

describe('Producto: Atrás tras eliminar', () => {
  it('no vuelve a «Ese producto no existe»: la entrada del producto se reemplaza por la lista', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
    await registrarPrecioManual(pres, 4500)
    location.hash = `#/producto/${encodeURIComponent(p.producto_id)}`
    render(<DetalleProducto id={p.producto_id} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }, { timeout: ESPERA }))
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar para siempre/ }))
    await confirmarIrreversible('Sí, eliminar para siempre')
    await waitFor(() => expect(location.hash).toBe('#/lista'), { timeout: 5000 })
    // Atrás: la entrada anterior es la lista de antes de abrir el producto, nunca el producto ya borrado.
    history.back()
    await new Promise((r) => setTimeout(r, 300))
    expect(location.hash).not.toContain('producto')
  }, ESPERA * 2)
})

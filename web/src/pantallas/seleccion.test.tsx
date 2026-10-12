import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { cargarCatalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, asegurarCompra, crearCategoria, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from '../datos/escritura.ts'
import { confirmarIrreversible } from '../componentes/pruebasConfirmar.ts'
import { Avisos } from '../componentes/ui.tsx'
import { Ajustes } from './Ajustes.tsx'
import { Lista } from './Lista.tsx'

const ESPERA = 10_000

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = '#/lista'
})

/** Dos pasillos (Granos: Arroz, Fríjol; Lácteos: Leche) y Arroz en la compra abierta. */
async function conLista() {
  const granos = await crearCategoria('Granos')
  const lacteos = await crearCategoria('Lácteos')
  const [arroz, frijol, leche] = await guardar('Productos', [
    nuevoProducto({ nombre: 'Arroz', categoria_id: granos.categoria_id }),
    nuevoProducto({ nombre: 'Fríjol', categoria_id: granos.categoria_id }),
    nuevoProducto({ nombre: 'Leche', categoria_id: lacteos.categoria_id }),
  ])
  const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', contenido: 1000 }))
  await registrarPrecioManual(pres, 4500)
  await asegurarCompra(['D1'])
  await agregarALaCompra(arroz, ['D1'])
  return { arroz, frijol, leche, granos, lacteos }
}

const montar = () => render(<><Lista /><Avisos /></>)
const filas = () => screen.getAllByRole('checkbox')

describe('Productos · seleccionar varios', () => {
  it('"Seleccionar" cambia las filas a casillas (sin estrella ni "+ Agregar") y "Cancelar" vuelve a la lista normal', async () => {
    await conLista()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    expect(filas()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Agregar Arroz a la compra|Arroz está en la compra/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).toBeNull() // el + flotante se esconde
    expect(screen.getByText('Nada marcado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Archivar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Eliminar/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument()
  })

  it('se marcan de a uno, por pasillo y todos; el contador y los botones siguen lo marcado', async () => {
    await conLista()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Leche/ }))
    expect(screen.getByText('1 marcado')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Leche/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Archivar (1)' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos los de Granos' }))
    expect(screen.getByText('3 marcados')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar las marcas de Granos' }))
    expect(screen.getByText('1 marcado')).toBeInTheDocument()
    // "Marcar todos" de la barra marca lo que se ve; con una búsqueda, solo eso.
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos' }))
    expect(screen.getByRole('checkbox', { name: /Fríjol/ })).toBeChecked()
    expect(screen.getByText('2 marcados')).toBeInTheDocument() // Leche (ya marcada, oculta) + Fríjol
  })

  it('Archivar: salen de la lista y de la compra, no se borran, y "Deshacer" los devuelve', async () => {
    const { arroz, frijol } = await conLista()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Arroz/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Fríjol/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Archivar/ }))
    await waitFor(async () => expect((await db.productos.get(arroz.producto_id))?.activo).toBe(false))
    expect((await db.productos.get(frijol.producto_id))?.activo).toBe(false)
    expect((await db.productos.get(arroz.producto_id))?.borrado).toBeFalsy()
    expect(await db.presentaciones.where('producto_id').equals(arroz.producto_id).count()).toBe(1) // conserva sus precios
    expect(await screen.findByText('2 productos archivados')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull() // salió del modo selección
    expect(screen.queryByText('Arroz')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer' }))
    await waitFor(async () => expect((await db.productos.get(arroz.producto_id))?.activo).toBe(true))
    expect((await db.productos.get(frijol.producto_id))?.activo).toBe(true)
  })

  it('Eliminar…: pide confirmación (con los nombres), "No, conservar" no borra, y al confirmar se eliminan para siempre', async () => {
    const { arroz, frijol, leche } = await conLista()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Arroz/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Fríjol/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Eliminar/ }))
    const hoja = await screen.findByRole('dialog', { name: 'Eliminar 2 productos para siempre' })
    expect(hoja).toHaveTextContent('Arroz')
    expect(hoja).toHaveTextContent('Fríjol')
    fireEvent.click(screen.getByRole('button', { name: 'No, conservar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await db.productos.get(arroz.producto_id))?.borrado).toBeFalsy()
    expect(filas()).toHaveLength(3) // sigue en modo selección, con lo marcado

    fireEvent.click(screen.getByRole('button', { name: /^Eliminar/ }))
    await confirmarIrreversible('Sí, eliminar para siempre')
    await waitFor(async () => expect((await db.productos.get(arroz.producto_id))?.borrado).toBe(true))
    expect((await db.productos.get(frijol.producto_id))?.borrado).toBe(true)
    expect((await db.productos.get(leche.producto_id))?.borrado).toBeFalsy()
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull())
    expect((await cargarCatalogo()).productos.map((p) => p.nombre)).toEqual(['Leche'])
  })
})

describe('Empezar de cero', () => {
  it('desde Productos: dice cuántos son y qué se conserva; "No, conservar" no borra; confirmar deja la pantalla de primer uso', async () => {
    const { arroz } = await conLista()
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Empezar de cero…/ }, { timeout: ESPERA }))
    const hoja = await screen.findByRole('dialog', { name: 'Empezar de cero' })
    // La hoja cuenta primero: hasta entonces no dice cantidades ni «ya estás de cero».
    await waitFor(() => expect(hoja).toHaveTextContent('3 productos'), { timeout: ESPERA })
    expect(hoja).toHaveTextContent('2 pasillos')
    expect(hoja).toHaveTextContent('No se puede deshacer')
    fireEvent.click(screen.getByRole('button', { name: 'No, conservar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await db.productos.get(arroz.producto_id))?.borrado).toBeFalsy()

    fireEvent.click(screen.getByRole('button', { name: /Empezar de cero…/ }))
    await confirmarIrreversible('Sí, borrar todo y empezar de cero')
    expect(await screen.findByText('Empieza aquí')).toBeInTheDocument()
    // El botón que se tocó ya no existe: el foco va al título de la pantalla, no al <body>.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })))
    await waitFor(async () => {
      const cat = await cargarCatalogo()
      expect(cat.productos).toEqual([])
      expect(cat.categorias).toEqual([])
    }, { timeout: ESPERA })
  })

  it('desde Ajustes: la tarjeta abre la misma confirmación; sin nada que borrar lo dice', async () => {
    await conLista()
    render(<Ajustes />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar de cero…' }, { timeout: ESPERA }))
    const hoja = await screen.findByRole('dialog', { name: 'Empezar de cero' })
    await waitFor(() => expect(hoja).toHaveTextContent('3 productos'), { timeout: ESPERA })
    await confirmarIrreversible('Sí, borrar todo y empezar de cero')
    await waitFor(async () => {
      const cat = await cargarCatalogo()
      expect(cat.productos).toEqual([])
      expect(cat.categorias).toEqual([])
    }, { timeout: ESPERA })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: ESPERA })
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar de cero…' }))
    expect(await screen.findByText(/ya estás de cero/, {}, { timeout: ESPERA })).toBeInTheDocument()
  })
})

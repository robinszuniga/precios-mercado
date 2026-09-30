import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { compraAbierta, guardar, nuevaPresentacion, nuevoProducto } from '../datos/escritura.ts'
import { Novedades } from './Novedades.tsx'

const DIA = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: '', token: '' })
})

describe('Novedades', () => {
  it('cuenta lo que bajó y lo que te toca comprar, y lo agrega a la compra con un toque', async () => {
    const [aceite, detergente] = await guardar('Productos', [nuevoProducto({ nombre: 'Aceite' }), nuevoProducto({ nombre: 'Detergente' })])
    await guardar('Presentaciones', nuevaPresentacion({ presentacion_id: 'pa', producto_id: aceite.producto_id, tienda: 'OLIMPICA' }))
    await db.cambios.add({ presentacion_id: 'pa', tienda: 'OLIMPICA', antes: 12900, despues: 10500, fecha: Date.now() - 3600_000 })
    const hace = (dias: number) => iso(Date.now() - dias * DIA)
    await db.compras.bulkPut([
      { compra_id: 'c1', estado: 'cerrada', fecha_cierre: hace(34), updated_at: hace(34) },
      { compra_id: 'c2', estado: 'cerrada', fecha_cierre: hace(19), updated_at: hace(19) },
    ] as never[])
    await db.detalle.bulkPut([
      { detalle_id: 'd1', compra_id: 'c1', producto_id: detergente.producto_id, estado: 'en_carrito' },
      { detalle_id: 'd2', compra_id: 'c2', producto_id: detergente.producto_id, estado: 'en_carrito' },
    ] as never[])

    render(<Novedades />)
    expect(await screen.findByText(/bajó 19 % en Olímpica/)).toBeInTheDocument()
    expect(screen.getByText(/cada ~15 días; la última vez hace 19/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Detergente a la compra' }))
    await waitFor(async () => {
      const c = await compraAbierta()
      expect((await db.detalle.where('compra_id').equals(c!.compra_id).toArray()).map((d) => d.producto_id)).toContain(detergente.producto_id)
    })
    await waitFor(() => expect(screen.queryByText('Detergente')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }))
    await waitFor(() => expect(screen.queryByText('Novedades')).toBeNull())
  })

  it('sin nada nuevo no ocupa espacio', async () => {
    const { container } = render(<Novedades />)
    await new Promise((r) => setTimeout(r, 200))
    expect(container.textContent).toBe('')
  })
})

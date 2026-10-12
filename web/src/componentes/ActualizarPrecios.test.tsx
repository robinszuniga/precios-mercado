import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../datos/db.ts'
import { guardar, nuevaPresentacion, nuevoProducto } from '../datos/escritura.ts'

const h = vi.hoisted(() => ({ llamadas: [] as { id: string }[][], respuestas: [] as unknown[] }))

vi.mock('../datos/apiVtex.ts', () => ({
  llamarVtex: async (_accion: string, cuerpo: { presentaciones: { presentacion_id: string }[] }) => {
    h.llamadas.push(cuerpo.presentaciones.map((p) => ({ id: p.presentacion_id })))
    const respuesta = h.respuestas.shift()
    if (typeof respuesta === 'function') return respuesta(cuerpo)
    return respuesta
  },
}))

import { ActualizarPrecios } from './ActualizarPrecios.tsx'

const ESPERA = 10_000
const bien = (cuerpo: { presentaciones: { presentacion_id: string; tienda: string }[] }) => ({
  tipo: 'ok',
  data: {
    resultados: cuerpo.presentaciones.map((p) => ({
      presentacion_id: p.presentacion_id, tienda: p.tienda, region: 'RIOHACHA', precio: 5000, precio_lista: null, disponible: true,
      ean: '', sku_id: '1', vtex_product_id: '9', fecha_observado: new Date().toISOString(),
    })),
  },
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  h.llamadas = []
  h.respuestas = []
})

async function sembrar(n: number) {
  const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
  await guardar('Presentaciones', Array.from({ length: n }, (_, i) => ({
    ...nuevaPresentacion({ producto_id: p.producto_id, tienda: 'EXITO', sku_id: String(i + 1), auto: true }), presentacion_id: `p${String(i).padStart(2, '0')}`,
  })))
}

describe('Traer precios', () => {
  it('si el servidor pide esperar a mitad de camino, dice cuántas faltan (no las cuenta como errores) y la segunda vuelta sigue por ellas', async () => {
    await sembrar(20)
    h.respuestas = [bien, { tipo: 'error', codigo: 'rate_limit', mensaje: 'Espera un minuto' }]
    render(<ActualizarPrecios />)
    const boton = await screen.findByRole('button', { name: /Traer precios/ }, { timeout: ESPERA })
    await vi.waitFor(() => expect(boton).toBeEnabled(), { timeout: ESPERA })
    fireEvent.click(boton)
    expect(await screen.findByText(/Se consultaron 8; faltan 12\./, {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).not.toMatch(/no se pudieron/)
    expect(h.llamadas.map((l) => l.length)).toEqual([8, 8])

    // Segunda vuelta: las 8 ya consultadas no se piden otra vez; se sigue por las que faltaban.
    const primeras = new Set(h.llamadas[0].map((x) => x.id))
    h.llamadas = []
    h.respuestas = [bien, bien]
    fireEvent.click(screen.getByRole('button', { name: /Traer precios/ }))
    expect(await screen.findByText(/Listo: 12 precios consultados\./, {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(h.llamadas.flat().some((x) => primeras.has(x.id))).toBe(false)
  })

  it('«ya están al día» solo si de verdad había algo que consultar y estaba fresco; con todo archivado no lo dice', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Viejo', activo: false }))
    await guardar('Presentaciones', { ...nuevaPresentacion({ producto_id: p.producto_id, tienda: 'EXITO', sku_id: '1', auto: true }), presentacion_id: 'x1' })
    render(<ActualizarPrecios />)
    const boton = await screen.findByRole('button', { name: /Traer precios/ }, { timeout: ESPERA })
    await vi.waitFor(() => expect(boton).toBeEnabled(), { timeout: ESPERA })
    fireEvent.click(boton)
    expect(await screen.findByText('No hay presentaciones online para actualizar todavía.', {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(screen.queryByText(/ya están al día/)).toBeNull()
  })
})

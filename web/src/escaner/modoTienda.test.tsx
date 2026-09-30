import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { guardar, nuevaPresentacion, nuevoProducto } from '../datos/escritura.ts'
import { asignarCodigo, ordenarPorParecido, resolverCodigo } from '../datos/modoTienda.ts'
import { ModoTienda } from './ModoTienda.tsx'

const EAN = '7702511000014'

function candidato(tienda: string) {
  return {
    tienda, productId: 'p1', skuId: `${tienda}-1`, ean: EAN, nombre: 'Arroz Diana 1000 g', marca: 'Diana', url: '', sellerId: '1',
    precio: 5200, precioLista: 5200, disponible: true, oferta: false, region: 'RIOHACHA',
    contenido: { valor: 1000, unidad: 'g', fuente: 'nombre', confianza: 'alta' },
  }
}

function servidor() {
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body))
    const data = c.a === 'buscarEnTienda' ? { candidatos: c.ean === EAN ? [candidato('OLIMPICA'), candidato('D1')] : [], errores: [] } : { tablas: {}, cursor: 'x', resultados: [] }
    return new Response(JSON.stringify({ ok: true, data, error: null, v: 1 }))
  }))
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: 'https://script.google.com/macros/s/x/exec', token: 't' })
})
afterEach(() => vi.unstubAllGlobals())

describe('modo tienda', () => {
  it('un código que ya tienes en Olímpica se reconoce en D1 y se copia con su tamaño (una sola vez)', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'OLIMPICA', ean: EAN, nombre_en_tienda: 'Arroz Diana 1000 g', marca: 'Diana', contenido: 1000, sku_id: 's1' }))
    const r = await resolverCodigo(EAN, 'D1')
    expect(r).toMatchObject({ tipo: 'conocido', producto: { nombre: 'Arroz' }, presentacion: { tienda: 'D1', contenido: 1000, ean: EAN, sku_id: '' } })
    await resolverCodigo(EAN, 'D1')
    expect((await db.presentaciones.toArray()).filter((p) => p.tienda === 'D1')).toHaveLength(1)
  })

  it('un código nuevo: internet dice qué es; al elegir tu producto queda su tamaño en D1 y el precio online de Olímpica', async () => {
    servidor()
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    const r = await resolverCodigo(EAN, 'D1')
    expect(r.tipo).toBe('elegir')
    if (r.tipo !== 'elegir') return
    expect(r.sugerencia?.nombre).toBe('Arroz Diana 1000 g')
    const pres = await asignarCodigo(arroz, 'D1', r.ean, r.sugerencia)
    expect(pres).toMatchObject({ tienda: 'D1', contenido: 1000, ean: EAN })
    const todas = await db.presentaciones.toArray()
    expect(todas.map((p) => p.tienda).sort()).toEqual(['D1', 'OLIMPICA'])
    expect(await db.preciosActuales.count()).toBe(1) // el de Olímpica; el de D1 lo escribes tú
  })

  it('ordena tus productos por parecido con lo escaneado', () => {
    const ps = ['Leche', 'Arroz', 'Aceite'].map((nombre) => nuevoProducto({ nombre }))
    expect(ordenarPorParecido(ps, 'Arroz Diana 1000 g')[0].nombre).toBe('Arroz')
  })

  it('en pantalla: escribes el código, eliges el producto y anotas el precio de D1', async () => {
    servidor()
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    render(<ModoTienda onListo={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Escanear código de barras/ }))
    fireEvent.change(await screen.findByLabelText('O escribe el código'), { target: { value: EAN } })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(await screen.findByText(/¿Cuál de tus productos es\?/)).toHaveTextContent('Arroz Diana 1000 g')
    fireEvent.click(screen.getByRole('button', { name: /^Arroz/ }))
    fireEvent.change(await screen.findByLabelText('Precio del paquete'), { target: { value: '4.900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }))
    await waitFor(async () => {
      const d1 = (await db.presentaciones.toArray()).find((p) => p.tienda === 'D1')!
      expect((await db.preciosActuales.where('presentacion_id').equals(d1.presentacion_id).first())?.precio).toBe(4900)
    })
    // Vuelve a la cámara para el siguiente producto.
    expect(await screen.findByLabelText('O escribe el código')).toBeInTheDocument()
  })

  it('un código nuevo con otra marca ya anotada en esa tienda: no pisa el precio de la otra y recuerda el código', async () => {
    await guardarMeta('conexion', { url: '', token: '' }) // sin internet: no hay sugerencia
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    const [diana] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', marca: 'Diana', contenido: 1000 }))
    const { registrarPrecioManual } = await import('../datos/escritura.ts')
    await registrarPrecioManual(diana, 4900)
    render(<ModoTienda onListo={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Escanear código de barras/ }))
    fireEvent.change(await screen.findByLabelText('O escribe el código'), { target: { value: '7702511000021' } })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Arroz/ }))
    // Empieza en "otra marca o tamaño", no sobre Diana.
    expect(await screen.findByLabelText('Marca y tamaño')).toHaveValue('__nueva')
    fireEvent.change(screen.getByLabelText('Marca', { exact: true }), { target: { value: 'Roa' } })
    fireEvent.change(screen.getByLabelText('Tamaño del paquete'), { target: { value: '500 g' } })
    fireEvent.change(screen.getByLabelText('Precio del paquete'), { target: { value: '3.500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }))
    await waitFor(async () => expect((await db.presentaciones.toArray()).find((p) => p.marca === 'Roa')?.ean).toBe('7702511000021'))
    expect((await db.preciosActuales.where('presentacion_id').equals(diana.presentacion_id).first())?.precio).toBe(4900)
  })

  it('si internet tarda se puede seguir sin esperar, y la respuesta tardía no cambia la pantalla', async () => {
    let soltar: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body))
      if (c.a === 'buscarEnTienda') await new Promise<void>((r) => { soltar = r })
      return new Response(JSON.stringify({ ok: true, data: { candidatos: [candidato('OLIMPICA')], tablas: {}, cursor: 'x', resultados: [] }, error: null, v: 1 }))
    }))
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    render(<ModoTienda onListo={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Escanear código de barras/ }))
    fireEvent.change(await screen.findByLabelText('O escribe el código'), { target: { value: EAN } })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(await screen.findByText(/Buscando el código/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /No esperar/ }))
    expect(await screen.findByText(/No conozco el código/)).toBeInTheDocument()
    soltar()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getByText(/No conozco el código/)).toBeInTheDocument()
  })

  it('el mismo código dos veces en una tienda (dos SKU) crea un solo vínculo online', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    const a = candidato('OLIMPICA')
    const b = { ...candidato('OLIMPICA'), skuId: 'OTRO-SKU' }
    await asignarCodigo(arroz, 'D1', EAN, { nombre: a.nombre, marca: 'Diana', candidatos: [a, b] as never })
    expect((await db.presentaciones.toArray()).filter((p) => p.tienda === 'OLIMPICA' && p.sku_id)).toHaveLength(1)
  })

  it('al ordenar por parecido la marca de internet no cuenta: Arroz antes que Aceite Diana', () => {
    const ps = [nuevoProducto({ nombre: 'Aceite Diana' }), nuevoProducto({ nombre: 'Arroz' })]
    expect(ordenarPorParecido(ps, 'Arroz Diana 1000 g', 'Diana')[0].nombre).toBe('Arroz')
  })
})


import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VincularTodos } from '../componentes/VincularTodos.tsx'
import { db, guardarMeta } from './db.ts'
import { guardar, nuevoProducto } from './escritura.ts'
import { autoVincular, productosSinVincular } from './vincularLote.ts'

type Item = { id: string; q?: string; ean?: string; unidad: string }

function opcion(tienda: string, nombre: string, precio: number, valor: number, unidad: string, seguro: boolean, ean = '') {
  return {
    tienda, productId: `p-${nombre}`, skuId: `${tienda}-${nombre}`, ean, nombre, marca: '', url: '', sellerId: '1', precio, precioLista: precio,
    disponible: true, oferta: false, contenido: { valor, unidad, fuente: 'nombre', confianza: 'alta' }, region: tienda === 'OLIMPICA' ? 'RIOHACHA' : 'DEFAULT',
    puntaje: seguro ? 120 : 60, precioUnidad: precio, seguro,
  }
}

/** Backend simulado: Arroz es seguro en Olímpica (y por su código aparece en Éxito); Leche es dudosa; Tornillo no existe. */
function servidor() {
  const llamadas: { items: Item[]; tiendas: string[] }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body))
    if (c.a !== 'buscarVarios') return new Response(JSON.stringify({ ok: true, data: { resultados: [], tablas: {}, cursor: 'x' }, error: null, v: 1 }))
    llamadas.push(c)
    const resultados = (c.items as Item[]).map((it) => {
      if (it.ean === '770') return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [opcion('EXITO', 'Arroz Diana 1000 g', 5400, 1000, 'g', true, '770')] } }
      if (it.q === 'Arroz') return { id: it.id, porTienda: { OLIMPICA: [opcion('OLIMPICA', 'Arroz Diana 1000 g', 5200, 1000, 'g', true, '770')], EXITO: [] } }
      if (it.q === 'Leche') return { id: it.id, porTienda: { OLIMPICA: [opcion('OLIMPICA', 'Leche deslactosada 1000 ml', 4500, 1000, 'ml', false), opcion('OLIMPICA', 'Leche de almendras 1000 ml', 9900, 1000, 'ml', false)], EXITO: [] } }
      return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [] } }
    })
    return new Response(JSON.stringify({ ok: true, data: { resultados, errores: [] }, error: null, v: 1 }))
  }))
  return llamadas
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: 'https://script.google.com/macros/s/x/exec', token: 't' })
  await guardar('Productos', [
    nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }),
    nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' }),
    nuevoProducto({ nombre: 'Tornillo', unidad_base: 'unidad' }),
  ])
})
afterEach(() => vi.unstubAllGlobals())

describe('vincular automático', () => {
  it('vincula solo lo seguro, completa la otra tienda por código de barras y guarda el precio', async () => {
    const llamadas = servidor()
    const r = await autoVincular()
    expect(r).toEqual({ vinculados: 1, dudosos: 1, sinResultado: 1 })
    const pres = await db.presentaciones.toArray()
    expect(pres.map((p) => p.tienda).sort()).toEqual(['EXITO', 'OLIMPICA'])
    expect(pres.every((p) => p.contenido === 1000 && p.auto)).toBe(true)
    expect(await db.preciosActuales.count()).toBe(2)
    expect(llamadas[1].items).toEqual([expect.objectContaining({ ean: '770' })])
    expect((await productosSinVincular()).map((p) => p.nombre).sort()).toEqual(['Leche', 'Tornillo'])
  })

  it('no se repite en el mismo día; con "forzar" sí, y lo revisado no se busca solo por unos días', async () => {
    const llamadas = servidor()
    await autoVincular()
    expect(await autoVincular()).toBeNull()
    expect(llamadas).toHaveLength(2)
    await autoVincular({ forzar: true })
    expect(llamadas).toHaveLength(3)
    await guardarMeta('autoVinculo', { ...(await db.meta.get('autoVinculo'))!.valor as object, ultimo: 0 })
    expect(await autoVincular()).toEqual({ vinculados: 0, dudosos: 0, sinResultado: 0 })
  })

  it('sin copia en Google no hace nada', async () => {
    await guardarMeta('conexion', { url: '', token: '' })
    expect(await autoVincular()).toBeNull()
  })
})

describe('VincularTodos', () => {
  it('vincula lo seguro, deja elegida la mejor opción de lo dudoso y dice qué no encontró', async () => {
    servidor()
    let listo = false
    render(createElement(VincularTodos, { onListo: () => { listo = true } }))
    expect(await screen.findByText('✔ 1 producto quedó con precio de internet, solos.')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Opciones para Leche' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Leche deslactosada/ })).toBeChecked()
    expect(screen.getByText(/No encontré en internet/)).toHaveTextContent('Tornillo')

    fireEvent.click(screen.getByRole('radio', { name: /Leche de almendras/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Vincular 1 producto' }))
    await waitFor(() => expect(listo).toBe(true))
    const leche = (await db.productos.toArray()).find((p) => p.nombre === 'Leche')!
    expect((await db.presentaciones.toArray()).find((p) => p.producto_id === leche.producto_id)?.nombre_en_tienda).toBe('Leche de almendras 1000 ml')
  })

  it('"Ninguno" no vincula', async () => {
    servidor()
    render(createElement(VincularTodos, { onListo: () => {} }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Ninguno de estos' }))
    expect(screen.getByRole('button', { name: 'Nada que vincular' })).toBeDisabled()
  })
})

describe('con el script de Google viejo', () => {
  it('no se cae y dice que hay que actualizarlo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, data: null, error: { codigo: 'accion_desconocida', mensaje: 'Acción desconocida: buscarVarios' }, v: 1 }))))
    expect(await autoVincular()).toEqual({ vinculados: 0, dudosos: 0, sinResultado: 0 })
    render(createElement(VincularTodos, { onListo: () => {} }))
    expect(await screen.findByRole('alert')).toHaveTextContent('script de Google está desactualizado')
  })

  it('una respuesta rara (sin resultados) no rompe nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {}, error: null, v: 1 }))))
    expect(await autoVincular()).toEqual({ vinculados: 0, dudosos: 0, sinResultado: 0 })
  })
})

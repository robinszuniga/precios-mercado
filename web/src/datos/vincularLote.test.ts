import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// El servicio de precios (función VTEX de Supabase) se simula: estos tests no tocan la red.
const h = vi.hoisted(() => ({ manejar: null as null | ((accion: string, params: Record<string, unknown>) => unknown) }))
vi.mock('./apiVtex.ts', () => ({
  llamarVtex: async (accion: string, params: Record<string, unknown>) => h.manejar?.(accion, params) ?? { tipo: 'desconocido', motivo: 'sin servicio' },
}))

import { VincularTodos } from '../componentes/VincularTodos.tsx'
import { db, guardarMeta } from './db.ts'
import { compraAbierta, guardar, nuevaPresentacion, nuevoProducto } from './escritura.ts'
import { autoVincular, crearDesdeCandidato, productosSinTienda, productosSinVincular } from './vincularLote.ts'

type Item = { id: string; q?: string; ean?: string; unidad: string }

function opcion(tienda: string, nombre: string, precio: number, valor: number, unidad: string, seguro: boolean, ean = '') {
  return {
    tienda, productId: `p-${nombre}`, skuId: `${tienda}-${nombre}`, ean, nombre, marca: '', url: '', sellerId: '1', precio, precioLista: precio,
    disponible: true, oferta: false, contenido: { valor, unidad, fuente: 'nombre', confianza: 'alta' }, region: tienda === 'OLIMPICA' ? 'RIOHACHA' : 'DEFAULT',
    puntaje: seguro ? 120 : 60, precioUnidad: precio, seguro,
  }
}

/** Servicio simulado: Arroz es seguro en Olímpica (y por su código aparece en Éxito); Leche es dudosa; Tornillo no existe. */
function servidor() {
  const llamadas: { items: Item[]; tiendas: string[] }[] = []
  h.manejar = (accion, params) => {
    if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
    llamadas.push(params as { items: Item[]; tiendas: string[] })
    const resultados = (params.items as Item[]).map((it) => {
      if (it.ean === '770') return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [opcion('EXITO', 'Arroz Diana 1000 g', 5400, 1000, 'g', true, '770')] } }
      if (it.q === 'Arroz') return { id: it.id, porTienda: { OLIMPICA: [opcion('OLIMPICA', 'Arroz Diana 1000 g', 5200, 1000, 'g', true, '770')], EXITO: [] } }
      if (it.q === 'Leche') return { id: it.id, porTienda: { OLIMPICA: [opcion('OLIMPICA', 'Leche deslactosada 1000 ml', 4500, 1000, 'ml', false), opcion('OLIMPICA', 'Leche de almendras 1000 ml', 9900, 1000, 'ml', false)], EXITO: [] } }
      return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [] } }
    })
    return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
  }
  return llamadas
}

beforeEach(async () => {
  h.manejar = null
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardar('Productos', [
    nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }),
    nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' }),
    nuevoProducto({ nombre: 'Tornillo', unidad_base: 'unidad' }),
  ])
})

describe('D1 también se busca (con precio nacional)', () => {
  it('se pide a las tres tiendas; lo que sale de D1 se vincula por código de barras y su precio queda marcado como nacional', async () => {
    const llamadas: { items: Item[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      llamadas.push(params as { items: Item[]; tiendas: string[] })
      const resultados = (params.items as Item[]).map((it) => {
        if (it.ean === '770') return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [], D1: [opcion('D1', 'Arroz Diana 1000 g', 5100, 1000, 'g', true, '770')] } }
        if (it.q === 'Arroz') return { id: it.id, porTienda: { OLIMPICA: [opcion('OLIMPICA', 'Arroz Diana 1000 g', 5200, 1000, 'g', true, '770')], EXITO: [], D1: [] } }
        return { id: it.id, porTienda: { OLIMPICA: [], EXITO: [], D1: [] } }
      })
      return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
    }
    const r = await autoVincular()
    expect(r?.vinculados).toBe(1)
    expect(llamadas[0].tiendas).toEqual(['OLIMPICA', 'EXITO', 'D1'])
    const pres = await db.presentaciones.toArray()
    expect(pres.map((p) => p.tienda).sort()).toEqual(['D1', 'OLIMPICA'])
    const d1 = pres.find((p) => p.tienda === 'D1')!
    expect(d1).toMatchObject({ auto: true, activo: true, sku_id: 'D1-Arroz Diana 1000 g', contenido: 1000 })
    const precio = await db.preciosActuales.where('presentacion_id').equals(d1.presentacion_id).first()
    expect(precio).toMatchObject({ origen: 'online', precio: 5100, region: 'DEFAULT' })
    // Y la app lo muestra como "precio nacional", no como un precio de Riohacha.
    const { precioEfectivo } = await import('@shared/precioEfectivo.ts')
    expect(precioEfectivo([precio!], { auto: 3, tiendaAmarillo: 30, tiendaMax: 60 }, precio!.fecha_verificado).efectivo?.distintivo).toBe('online_nac')
  })

  it('el precio del estante manda sobre el nacional de internet', async () => {
    const { precioEfectivo } = await import('@shared/precioEfectivo.ts')
    const ahora = new Date().toISOString()
    const base = { presentacion_id: 'x', tienda: 'D1' as const, precio_lista: null, disponible: true, fecha_observado: ahora, fecha_verificado: ahora }
    const efectivo = precioEfectivo([
      { ...base, clave: 'x|online', origen: 'online', fuente: 'auto', precio: 5100, region: 'DEFAULT' },
      { ...base, clave: 'x|tienda', origen: 'tienda', fuente: 'manual', precio: 4900, region: '' },
    ], { auto: 3, tiendaAmarillo: 30, tiendaMax: 60 }, ahora).efectivo
    expect(efectivo).toMatchObject({ precio: 4900, distintivo: 'tienda' })
  })
})

describe('vincular automático', () => {
  it('vincula solo lo seguro, completa la otra tienda por código de barras y guarda el precio', async () => {
    const llamadas = servidor()
    const r = await autoVincular()
    expect(r).toMatchObject({ vinculados: 1, dudosos: 1, sinResultado: 1, sinBuscar: 0 })
    const pres = await db.presentaciones.toArray()
    expect(pres.map((p) => p.tienda).sort()).toEqual(['EXITO', 'OLIMPICA'])
    expect(pres.every((p) => p.contenido === 1000 && p.auto)).toBe(true)
    expect(await db.preciosActuales.count()).toBe(2)
    expect(llamadas[1].items).toEqual([expect.objectContaining({ ean: '770' })])
    expect((await productosSinVincular()).map((p) => p.nombre).sort()).toEqual(['Leche', 'Tornillo'])
  })

  it('no se repite en el mismo día; con "forzar" la búsqueda principal sí, pero lo ya revisado en D1 no se vuelve a preguntar', async () => {
    const llamadas = servidor()
    // Las búsquedas de las tres tiendas (la principal y la de completar por código) y las que solo completan D1.
    const principales = () => llamadas.filter((l) => l.tiendas.length > 1)
    const soloD1 = () => llamadas.filter((l) => l.tiendas.length === 1 && l.tiendas[0] === 'D1')
    await autoVincular()
    expect(await autoVincular()).toBeNull()
    expect(principales()).toHaveLength(2)
    expect(soloD1()).toHaveLength(1) // Arroz quedó vinculado en Olímpica y Éxito: se completa D1
    await autoVincular({ forzar: true })
    expect(principales()).toHaveLength(3)
    // Forzar salta el límite de «una vez al día», no la memoria de lo ya revisado en D1 (cada pregunta gasta cuota).
    expect(soloD1()).toHaveLength(1)
    await guardarMeta('autoVinculo', { ...(await db.meta.get('autoVinculo'))!.valor as object, ultimo: 0 })
    expect(await autoVincular()).toMatchObject({ vinculados: 0, dudosos: 0, sinResultado: 0 })
    expect(soloD1()).toHaveLength(1) // y sin forzar tampoco
  })
})

describe('completar D1 en lo que ya estaba vinculado', () => {
  it('un producto ya vinculado en Olímpica y Éxito se busca en D1 por su código de barras; una vez, sin repetir ni pisar lo quitado', async () => {
    const [arroz] = await db.productos.filter((p) => p.nombre === 'Arroz').toArray()
    await guardar('Presentaciones', [
      nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'OLIMPICA', sku_id: 'o1', ean: '770', contenido: 1000, auto: true, nombre_en_tienda: 'Arroz Diana 1000 g' }),
    ])
    const pedidos: { items: Item[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      pedidos.push(params as { items: Item[]; tiendas: string[] })
      const resultados = (params.items as Item[]).map((it) => ({
        id: it.id,
        porTienda: { D1: it.ean === '770' ? [opcion('D1', 'Arroz Diana 1000 g', 5100, 1000, 'g', true, '770')] : [], OLIMPICA: [], EXITO: [] },
      }))
      return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
    }
    await autoVincular({ forzar: true })
    const d1 = pedidos.find((p) => p.tiendas.length === 1 && p.tiendas[0] === 'D1')!
    expect(d1.items.find((i) => i.id === arroz.producto_id)).toMatchObject({ ean: '770' }) // por código de barras
    const pres = (await db.presentaciones.toArray()).filter((p) => p.producto_id === arroz.producto_id)
    expect(pres.map((p) => p.tienda).sort()).toEqual(['D1', 'OLIMPICA'])
    const nueva = pres.find((p) => p.tienda === 'D1')!
    expect(nueva).toMatchObject({ auto: true, activo: true, ean: '770', contenido: 1000 })
    expect((await db.preciosActuales.where('presentacion_id').equals(nueva.presentacion_id).first())?.region).toBe('DEFAULT')

    // Una segunda vuelta no repite la búsqueda ni duplica la presentación.
    const antes = pedidos.length
    await autoVincular({ forzar: true })
    expect((await db.presentaciones.toArray()).filter((p) => p.producto_id === arroz.producto_id && p.tienda === 'D1')).toHaveLength(1)
    expect(pedidos.slice(antes).filter((p) => p.tiendas.length === 1 && p.tiendas[0] === 'D1' && p.items.some((i) => i.id === arroz.producto_id))).toHaveLength(0)

    // Si la persona quita ese vínculo, no se vuelve a poner solo.
    await guardar('Presentaciones', { ...nueva, activo: false })
    await autoVincular({ forzar: true })
    expect((await db.presentaciones.toArray()).filter((p) => p.tienda === 'D1' && p.activo)).toHaveLength(0)
  })

  it('sin código de barras se busca por nombre y solo se acepta lo seguro; sin señal no se marca nada como revisado', async () => {
    const [arroz] = await db.productos.filter((p) => p.nombre === 'Arroz').toArray()
    await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'EXITO', sku_id: 'e1', ean: '', contenido: 1000, auto: true }))
    h.manejar = (accion) => (accion === 'buscarVarios' ? { tipo: 'desconocido', motivo: 'sin servicio' } : { tipo: 'ok', data: {} })
    await autoVincular({ forzar: true })
    expect((await db.meta.get('completarTiendas'))?.valor ?? {}).toEqual({}) // no se marcó nada
    const pedidos: { items: Item[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      pedidos.push(params as { items: Item[]; tiendas: string[] })
      const resultados = (params.items as Item[]).map((it) => ({ id: it.id, porTienda: { D1: it.q === 'Arroz' ? [opcion('D1', 'Arroz Roa 1000 g', 4800, 1000, 'g', false)] : [], OLIMPICA: [], EXITO: [] } }))
      return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
    }
    await autoVincular({ forzar: true })
    const d1 = pedidos.find((p) => p.tiendas.length === 1 && p.tiendas[0] === 'D1')!
    expect(d1.items.find((i) => i.id === arroz.producto_id)).toMatchObject({ q: 'Arroz' })
    expect((await db.presentaciones.toArray()).filter((p) => p.tienda === 'D1')).toHaveLength(0) // dudoso: no se vincula solo
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

describe('cuando el servicio de precios falla', () => {
  it('no se cae y dice por qué se detuvo', async () => {
    h.manejar = () => ({ tipo: 'error', codigo: 'rate_limit', mensaje: 'Espera un minuto antes de volver a consultar precios.' })
    expect(await autoVincular()).toMatchObject({ vinculados: 0, dudosos: 0, sinResultado: 0 })
    render(createElement(VincularTodos, { onListo: () => {} }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Espera un minuto antes de volver a consultar precios.')
  })

  it('una respuesta rara (sin resultados) no rompe nada', async () => {
    h.manejar = () => ({ tipo: 'ok', data: {} })
    expect(await autoVincular()).toMatchObject({ vinculados: 0, dudosos: 0, sinResultado: 0 })
  })
})

describe('sin duplicados ni sorpresas', () => {
  it('la búsqueda automática y "Buscar precios" a la vez no vinculan dos veces lo mismo', async () => {
    servidor()
    render(createElement(VincularTodos, { onListo: () => {} }))
    await autoVincular({ forzar: true })
    await screen.findByRole('radiogroup', { name: 'Opciones para Leche' })
    const pres = await db.presentaciones.toArray()
    expect(pres.map((p) => `${p.tienda}:${p.sku_id}`).sort()).toEqual(['EXITO:EXITO-Arroz Diana 1000 g', 'OLIMPICA:OLIMPICA-Arroz Diana 1000 g'])
  })

  it('un vínculo automático que quitaste no vuelve solo', async () => {
    servidor()
    await autoVincular()
    const pres = await db.presentaciones.toArray()
    await guardar('Presentaciones', pres.map((p) => ({ ...p, activo: false })))
    expect((await productosSinVincular()).map((p) => p.nombre)).not.toContain('Arroz')
    await autoVincular({ forzar: true })
    expect((await db.presentaciones.toArray()).every((p) => !p.activo)).toBe(true)
  })

  it('no corre sola en plena compra (sí si se fuerza al pegar la lista)', async () => {
    const llamadas = servidor()
    const arroz = (await db.productos.toArray()).find((p) => p.nombre === 'Arroz')!
    const { agregarALaCompra } = await import('./escritura.ts')
    await agregarALaCompra(arroz, [])
    await guardar('Compras', { ...(await compraAbierta())!, estado: 'en_curso' })
    expect(await autoVincular()).toBeNull()
    expect(llamadas).toHaveLength(0)
    expect(await autoVincular({ forzar: true })).not.toBeNull()
  })

  it('tras un fallo espera antes de reintentar solo', async () => {
    h.manejar = () => ({ tipo: 'desconocido', motivo: 'Failed to fetch' })
    await autoVincular()
    const llamadas = servidor()
    expect(await autoVincular()).toBeNull()
    expect(llamadas).toHaveLength(0)
  })
})

describe('marca preferida', () => {
  let soportaMarcas = true
  beforeEach(() => { soportaMarcas = true })

  function servidorMarcas() {
    const llamadas: Item[][] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      llamadas.push(params.items as Item[])
      const resultados = (params.items as (Item & { marca?: string })[]).map((it) => {
        const roa = { ...opcion('OLIMPICA', 'Arroz Roa 1000 g', 4800, 1000, 'g', true), marca: 'Roa' }
        const diana = { ...opcion('OLIMPICA', 'Arroz Diana 1000 g', 5200, 1000, 'g', true), marca: 'Diana' }
        // Un servicio que no confirma marcas marca como segura la primera que coincida (Roa).
        return { id: it.id, porTienda: { OLIMPICA: it.marca === 'Diana' ? [diana, { ...roa, seguro: false }] : [roa], EXITO: [] } }
      })
      return { tipo: 'ok', data: { resultados, errores: [], marcas: soportaMarcas } }
    }
    return llamadas
  }

  it('la búsqueda automática manda la marca y nunca vincula otra marca, aunque el servicio diga que es segura', async () => {
    const llamadas = servidorMarcas()
    await db.productos.clear()
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', marca: 'Supremo' }))
    const r = await autoVincular()
    expect(llamadas[0][0]).toMatchObject({ q: 'Arroz', marca: 'Supremo' })
    expect(r?.vinculados).toBe(0)
    expect(await db.presentaciones.count()).toBe(0)
  })

  it('al elegir marca cambia el vínculo de esa tienda a tu marca y quita el de la otra', async () => {
    servidorMarcas()
    await db.productos.clear()
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    await autoVincular()
    expect((await db.presentaciones.toArray()).map((p) => p.nombre_en_tienda)).toEqual(['Arroz Roa 1000 g'])

    const { vincularMarca } = await import('./vincularLote.ts')
    const [conMarca] = await guardar('Productos', { ...arroz, marca: 'Diana' })
    expect(await vincularMarca(conMarca)).toEqual({ tipo: 'ok', con: ['OLIMPICA'], sin: ['EXITO', 'D1'] })
    const activas = (await db.presentaciones.toArray()).filter((p) => p.activo).map((p) => p.nombre_en_tienda)
    expect(activas).toEqual(['Arroz Diana 1000 g'])
  })

  it('si el servicio no confirma las marcas no vincula nada por marca y queda pendiente para reintentar', async () => {
    servidorMarcas()
    await db.productos.clear()
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', marca: 'Diana' }))
    soportaMarcas = false
    const { vincularMarca } = await import('./vincularLote.ts')
    expect(await vincularMarca(arroz)).toEqual({ tipo: 'fallo', motivo: 'El servicio de precios no pudo confirmar las marcas.' })
    expect(await db.presentaciones.count()).toBe(0)
    expect((await db.meta.get('marcasPendientes'))?.valor).toEqual([arroz.producto_id])

    // Cuando el servicio vuelve a confirmar las marcas, la búsqueda automática la resuelve sola y la quita de pendientes.
    soportaMarcas = true
    await autoVincular({ forzar: true })
    expect((await db.presentaciones.toArray()).map((p) => p.nombre_en_tienda)).toEqual(['Arroz Diana 1000 g'])
    expect((await db.meta.get('marcasPendientes'))?.valor).toEqual([])
  })

  it('si no hay conexión con la cuenta lo dice y queda pendiente para reintentar', async () => {
    h.manejar = () => ({ tipo: 'error', codigo: 'sin_conexion', mensaje: 'La cuenta no está conectada.' })
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Sal', unidad_base: 'g', marca: 'Refisal' }))
    const { vincularMarca } = await import('./vincularLote.ts')
    expect(await vincularMarca(p)).toEqual({ tipo: 'fallo', motivo: 'La cuenta no está conectada.' })
    expect((await db.meta.get('marcasPendientes'))?.valor).toEqual([p.producto_id])
  })
})

describe('revisión: reintentos', () => {
  it('si el servicio no confirma las marcas, la búsqueda automática se reintenta a la hora y no se da por revisada', async () => {
    h.manejar = (accion, params) => accion === 'buscarVarios'
      // Sin "marcas: true": el servicio no puede confirmar las marcas.
      ? { tipo: 'ok', data: { resultados: (params.items as { id: string }[]).map((it) => ({ id: it.id, porTienda: { OLIMPICA: [], EXITO: [] } })), errores: [] } }
      : { tipo: 'ok', data: {} }
    await db.productos.clear()
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', marca: 'Diana' }))
    await autoVincular()
    const estado = (await db.meta.get('autoVinculo'))!.valor as { ultimo: number; fallo?: number }
    expect(estado.fallo).toBeGreaterThan(0) // quedó como fallo: se reintenta pronto
    expect(estado.ultimo).toBe(0) // y no como una revisión hecha hoy
  })

  it('un fallo de red sí se reintenta a la hora', async () => {
    h.manejar = (accion) => (accion === 'buscarVarios' ? { tipo: 'desconocido', motivo: 'Failed to fetch' } : { tipo: 'ok', data: {} })
    await autoVincular()
    const estado = (await db.meta.get('autoVinculo'))!.valor as { ultimo: number; fallo?: number }
    expect(estado.fallo).toBeGreaterThan(0)
  })
})

describe('el precio anotado en el estante no se duplica con el de internet (D1)', () => {
  /** Arroz vinculado en Olímpica y, en D1, una presentación creada al escanear en la tienda (sin vínculo online). */
  async function conEstanteEnD1() {
    const arroz = (await db.productos.toArray()).find((p) => p.nombre === 'Arroz')!
    const [olim] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'OLIMPICA', sku_id: 'OLIMPICA-Arroz Diana 1000 g', ean: '7702001234561', auto: true, contenido: 1000 }))
    const [estante] = await guardar('Presentaciones', {
      ...nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', ean: '7702001234561', contenido: 1000, nombre_en_tienda: 'Arroz Diana 1 kg' }),
      presentacion_id: `ean-${arroz.producto_id}-D1-7702001234561`,
    })
    return { arroz, olim, estante }
  }

  it('el producto ya está en D1 (por el mismo código de barras): no se vuelve a buscar ahí', async () => {
    const { arroz } = await conEstanteEnD1()
    expect((await productosSinTienda('D1')).map((p) => p.producto_id)).not.toContain(arroz.producto_id)
    expect((await productosSinTienda('EXITO')).map((p) => p.producto_id)).toContain(arroz.producto_id)
  })

  it('si igual aparece el candidato de D1 con ese código, se vincula la presentación del estante en vez de crear otra', async () => {
    const { arroz, estante } = await conEstanteEnD1()
    const cand = { ...opcion('D1', 'Arroz Diana 1000 g', 4200, 1000, 'g', true, '7702001234561'), region: 'DEFAULT' as const }
    const p = await crearDesdeCandidato(arroz, cand as never, 1000)
    expect(p?.presentacion_id).toBe(estante.presentacion_id)
    const deD1 = (await db.presentaciones.toArray()).filter((x) => x.tienda === 'D1')
    expect(deD1).toHaveLength(1)
    expect(deD1[0]).toMatchObject({ sku_id: 'D1-Arroz Diana 1000 g', auto: true, activo: true, contenido: 1000 })
    // El precio de internet queda en la misma presentación, junto al del estante (que manda mientras esté vigente).
    expect(await db.preciosActuales.where('presentacion_id').equals(estante.presentacion_id).toArray()).toEqual([expect.objectContaining({ origen: 'online', precio: 4200, region: 'DEFAULT' })])
  })

  it('una presentación del estante que la persona quitó no se revive sola', async () => {
    const { arroz, estante } = await conEstanteEnD1()
    await guardar('Presentaciones', { ...estante, activo: false })
    const cand = { ...opcion('D1', 'Arroz Diana 1000 g', 4200, 1000, 'g', true, '7702001234561'), region: 'DEFAULT' as const }
    expect(await crearDesdeCandidato(arroz, cand as never, 1000)).toBeNull()
    expect((await db.presentaciones.get(estante.presentacion_id))?.activo).toBe(false)
  })

  it('con otro código de barras sí es otro producto de la tienda: se crea aparte', async () => {
    const { arroz } = await conEstanteEnD1()
    const cand = { ...opcion('D1', 'Arroz Roa 1000 g', 4000, 1000, 'g', true, '7709999999999'), region: 'DEFAULT' as const }
    await crearDesdeCandidato(arroz, cand as never, 1000)
    expect((await db.presentaciones.toArray()).filter((x) => x.tienda === 'D1')).toHaveLength(2)
  })
})

describe('marca preferida al completar las otras tiendas', () => {
  /** Arroz de marca Diana, vinculado en Olímpica con otra marca (Roa): Diana no apareció allí. */
  async function conRoaEnOlimpica() {
    await db.productos.clear()
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', marca: 'Diana' }))
    await guardar('Presentaciones', nuevaPresentacion({
      producto_id: arroz.producto_id, tienda: 'OLIMPICA', sku_id: 'o-roa', ean: '770-roa', contenido: 1000, auto: true, nombre_en_tienda: 'Arroz Roa 1000 g', marca: 'Roa',
    }))
    return arroz
  }
  const roa = { ...opcion('D1', 'Arroz Roa 1000 g', 4400, 1000, 'g', true, '770-roa'), marca: 'Roa', region: 'DEFAULT' }
  const diana = { ...opcion('D1', 'Arroz Diana 1000 g', 5100, 1000, 'g', true, '770-diana'), marca: 'Diana', region: 'DEFAULT' }

  it('si D1 vende la marca preferida, se vincula esa y no la otra marca por el código de barras de Roa', async () => {
    const arroz = await conRoaEnOlimpica()
    const pedidos: { items: (Item & { marca?: string })[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      pedidos.push(params as never)
      const resultados = (params.items as (Item & { marca?: string })[]).map((it) => ({
        id: it.id,
        porTienda: { D1: it.ean === '770-roa' ? [roa] : it.marca === 'Diana' ? [diana] : [], OLIMPICA: [], EXITO: [] },
      }))
      return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
    }
    await autoVincular({ forzar: true })
    const d1 = (await db.presentaciones.toArray()).filter((p) => p.tienda === 'D1')
    expect(d1.map((p) => p.nombre_en_tienda)).toEqual(['Arroz Diana 1000 g'])
    // Se buscó primero por nombre y marca, no por el código de barras de la otra marca.
    const aD1 = pedidos.filter((p) => p.tiendas.length === 1 && p.tiendas[0] === 'D1')
    expect(aD1[0].items.find((i) => i.id === arroz.producto_id)).toMatchObject({ q: 'Arroz', marca: 'Diana' })
  })

  it('si D1 no tiene la marca preferida, queda la otra marca por su código de barras (mejor un precio de otra marca que ninguno)', async () => {
    await conRoaEnOlimpica()
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      const resultados = (params.items as (Item & { marca?: string })[]).map((it) => ({
        id: it.id, porTienda: { D1: it.ean === '770-roa' ? [roa] : [], OLIMPICA: [], EXITO: [] },
      }))
      return { tipo: 'ok', data: { resultados, errores: [], marcas: true } }
    }
    await autoVincular({ forzar: true })
    expect((await db.presentaciones.toArray()).filter((p) => p.tienda === 'D1').map((p) => p.nombre_en_tienda)).toEqual(['Arroz Roa 1000 g'])
  })
})

describe('la cuota del servicio de precios', () => {
  /** Productos ya vinculados en Olímpica (con código de barras) que Éxito y D1 no tienen. */
  async function conVinculados(n: number) {
    await db.productos.clear()
    const productos = await guardar('Productos', Array.from({ length: n }, (_, i) => nuevoProducto({ nombre: `Prod ${String(i).padStart(2, '0')}`, unidad_base: 'g' })))
    await guardar('Presentaciones', productos.map((p, i) => nuevaPresentacion({ producto_id: p.producto_id, tienda: 'OLIMPICA', sku_id: `o${i}`, ean: `77${i}`, contenido: 1000, auto: true })))
    return productos
  }
  const sinNada = (params: Record<string, unknown>) => ({
    tipo: 'ok', data: { resultados: (params.items as Item[]).map((it) => ({ id: it.id, porTienda: { OLIMPICA: [], EXITO: [], D1: [] } })), errores: [], marcas: true },
  })

  it('pegar la lista otra vez no vuelve a preguntar por lo que ya se revisó hace poco (aunque se fuerce)', async () => {
    const [p] = await conVinculados(1)
    const pedidos: { items: Item[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      pedidos.push(params as never)
      return sinNada(params)
    }
    await autoVincular({ forzar: true })
    const primera = pedidos.filter((x) => x.items.some((i) => i.id === p.producto_id)).length
    expect(primera).toBeGreaterThan(0) // Éxito y D1 se preguntaron
    await autoVincular({ forzar: true })
    expect(pedidos.filter((x) => x.items.some((i) => i.id === p.producto_id)).length).toBe(primera) // y no otra vez
  })

  it('con más de 40 productos por completar, cada vuelta sigue por los que faltan (no repite siempre los mismos 40)', async () => {
    const productos = await conVinculados(45)
    const vistos = new Set<string>()
    let ronda = new Set<string>()
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      for (const it of params.items as Item[]) { vistos.add(it.id); ronda.add(it.id) }
      return sinNada(params)
    }
    await autoVincular({ forzar: true })
    expect(ronda.size).toBe(40)
    ronda = new Set()
    await autoVincular({ forzar: true })
    expect(ronda.size).toBe(5)
    expect(vistos.size).toBe(productos.length)
  })

  it('el paso por código de barras pide solo las tiendas que faltan', async () => {
    const pedidos: { items: Item[]; tiendas: string[] }[] = []
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      pedidos.push(params as never)
      return { tipo: 'ok', data: { resultados: (params.items as Item[]).map((it) => ({ id: it.id, porTienda: { OLIMPICA: it.q === 'Arroz' ? [opcion('OLIMPICA', 'Arroz Diana 1000 g', 5200, 1000, 'g', true, '770')] : [], EXITO: [], D1: [] } })), errores: [], marcas: true } }
    }
    await autoVincular()
    // Arroz salió en Olímpica: por código de barras se pregunta solo en Éxito y D1 (no otra vez en Olímpica).
    const porCodigo = pedidos.filter((x) => x.tiendas.length > 1 && x.items.some((i) => i.ean === '770'))
    expect(porCodigo).toHaveLength(1)
    expect([...porCodigo[0].tiendas].sort()).toEqual(['D1', 'EXITO'])
  })

  it('si el servicio pide esperar a mitad de la lista, dice cuántos quedaron sin buscar y reintenta en minutos, no en una hora', async () => {
    await guardar('Productos', Array.from({ length: 20 }, (_, i) => nuevoProducto({ nombre: `Extra ${i}`, unidad_base: 'g' })))
    let llamadas = 0
    h.manejar = (accion, params) => {
      if (accion !== 'buscarVarios') return { tipo: 'ok', data: {} }
      llamadas++
      return llamadas === 1 ? sinNada(params) : { tipo: 'error', codigo: 'rate_limit', mensaje: 'Espera un minuto antes de volver a consultar precios.' }
    }
    const r = await autoVincular()
    expect(r).toMatchObject({ limite: true })
    expect(r!.sinBuscar).toBeGreaterThan(0)
    const estado = (await db.meta.get('autoVinculo'))!.valor as { fallo?: number; espera?: number }
    expect(estado.fallo).toBeGreaterThan(0)
    expect(estado.espera).toBeLessThanOrEqual(5 * 60_000)
    // Pasado ese rato vuelve a intentar solo (no una hora después).
    await db.meta.put({ clave: 'autoVinculo', valor: { ...estado, fallo: Date.now() - 6 * 60_000, ultimo: 0, revisados: {} } })
    llamadas = 0
    expect(await autoVincular()).not.toBeNull()
  })
})

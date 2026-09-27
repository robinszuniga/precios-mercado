import { describe, expect, it } from 'vitest'
import { manejarGet, manejarPost } from '../src/router.ts'
import { continuarPrecios, tareaDiaria } from '../src/acciones.ts'
import { leerJob } from '../src/job.ts'
import { AHORA, crearServicios } from './fakes.ts'

const post = (s: ReturnType<typeof crearServicios>['s'], cuerpo: Record<string, unknown>) =>
  manejarPost(s, JSON.stringify({ t: 'secreto', v: 1, ...cuerpo }))

function producto(id: string, updated_at = AHORA, extra = {}) {
  return { producto_id: id, nombre: 'Arroz', categoria_id: 'g', unidad_base: 'g', recurrente: true, cantidad_habitual: 2, activo: true, updated_at, ...extra }
}

describe('router', () => {
  it('rechaza JSON inválido, token malo y acciones desconocidas', () => {
    const { s } = crearServicios()
    expect(manejarPost(s, 'no json').error?.codigo).toBe('json_invalido')
    expect(manejarPost(s, JSON.stringify({ a: 'ping', t: 'otro' })).error?.codigo).toBe('token_invalido')
    expect(manejarPost(s, JSON.stringify({ a: 'ping' })).error?.codigo).toBe('token_invalido')
    expect(post(s, { a: 'borrarTodo' }).error?.codigo).toBe('accion_desconocida')
    expect(post(s, { a: 'toString' }).error?.codigo).toBe('accion_desconocida')
    expect(post(s, { a: 'ping', v: 99 }).error?.codigo).toBe('version')
  })

  it('sin token configurado pide inicializar', () => {
    const f = crearServicios()
    f.props.delete('TOKEN')
    expect(post(f.s, { a: 'ping' }).error?.codigo).toBe('sin_configurar')
  })

  it('GET responde ping sin token y sin datos', () => {
    const { s } = crearServicios()
    const r = manejarGet(s)
    expect(r).toMatchObject({ ok: true, data: { app: 'precios-mercado' }, v: 1 })
  })

  it('el lock ocupado se informa como ocupado', () => {
    const { s } = crearServicios({ lockOcupado: true })
    expect(post(s, { a: 'upsert', cambios: [] }).error?.codigo).toBe('ocupado')
  })
})

describe('upsert y pull', () => {
  it('aplicar dos veces el mismo lote deja el Sheet igual', () => {
    const { s, repo } = crearServicios()
    const cambios = [{ tabla: 'Productos', fila: producto('p1') }]
    const r1 = post(s, { a: 'upsert', cambios })
    const tras1 = repo.leer('Productos')
    const r2 = post(s, { a: 'upsert', cambios })
    expect((r1.data as { resultados: { r: string }[] }).resultados[0].r).toBe('aplicado')
    expect((r2.data as { resultados: { r: string }[] }).resultados[0].r).toBe('igual')
    expect(repo.leer('Productos')).toEqual(tras1)
    expect(tras1).toHaveLength(1)
  })

  it('gana el updated_at mayor', () => {
    const { s, repo } = crearServicios()
    post(s, { a: 'upsert', cambios: [{ tabla: 'Productos', fila: producto('p1', '2026-09-27T10:00:05.000-05:00', { nombre: 'Nuevo' }) }] })
    const r = post(s, { a: 'upsert', cambios: [{ tabla: 'Productos', fila: producto('p1', '2026-09-27T10:00:01.000-05:00', { nombre: 'Viejo' }) }] })
    expect((r.data as { resultados: { r: string }[] }).resultados[0].r).toBe('antiguo')
    expect(repo.leer('Productos')[0].nombre).toBe('Nuevo')
  })

  it('no deja escribir tablas del servidor ni valores inválidos', () => {
    const { s } = crearServicios()
    const r = post(s, { a: 'upsert', cambios: [
      { tabla: 'Precios', fila: { precio_id: 'x' } },
      { tabla: 'Productos', fila: { producto_id: 'p', updated_at: 'ayer' } },
      { tabla: 'Inventada', fila: {} },
    ] })
    expect((r.data as { resultados: { r: string }[] }).resultados.map((x) => x.r)).toEqual(['error', 'error', 'error'])
  })

  it('las observaciones alimentan Precios_actuales y el histórico solo si cambia', () => {
    const f = crearServicios()
    const obs = (id: string, precio: number, fecha: string) => ({ tabla: 'Observaciones', fila: {
      obs_id: id, presentacion_id: 'pr1', tienda: 'D1', origen: 'tienda', fuente: 'manual', precio, precio_lista: null,
      disponible: true, region: '', fecha_observado: fecha, compra_id: '' } })
    post(f.s, { a: 'upsert', cambios: [obs('o1', 4000, AHORA)] })
    post(f.s, { a: 'upsert', cambios: [obs('o2', 4000, '2026-09-27T11:00:00.000-05:00')] })
    post(f.s, { a: 'upsert', cambios: [obs('o3', 4200, '2026-09-27T12:00:00.000-05:00')] })
    post(f.s, { a: 'upsert', cambios: [obs('o3', 4200, '2026-09-27T12:00:00.000-05:00')] })
    expect(f.repo.leer('Precios').map((p) => p.precio_id)).toEqual(['o1', 'o3'])
    expect(f.repo.leer('Precios_actuales')).toHaveLength(1)
    expect(f.repo.leer('Precios_actuales')[0]).toMatchObject({ precio: 4200, fecha_verificado: '2026-09-27T12:00:00.000-05:00' })
  })

  it('pull incremental devuelve solo lo nuevo desde el cursor', () => {
    const f = crearServicios()
    post(f.s, { a: 'upsert', cambios: [{ tabla: 'Productos', fila: producto('p1') }] })
    f.avanzar(5 * 60_000) // el cursor lleva 2 min de margen: lo escrito justo antes del pull vuelve a llegar
    const r1 = post(f.s, { a: 'pull', desde: null }).data as { tablas: Record<string, unknown[]>; cursor: string }
    expect(r1.tablas.Productos).toHaveLength(1)
    expect(r1.tablas).not.toHaveProperty('Precios')
    expect(r1.tablas).not.toHaveProperty('Log')
    f.avanzar(10 * 60_000)
    post(f.s, { a: 'upsert', cambios: [{ tabla: 'Productos', fila: producto('p2', '2026-09-27T10:10:00.000-05:00') }] })
    const r2 = post(f.s, { a: 'pull', desde: r1.cursor }).data as { tablas: Record<string, { producto_id: string }[]> }
    expect(r2.tablas.Productos.map((p) => p.producto_id)).toEqual(['p2'])
  })
})

describe('cerrarCompra', () => {
  it('es idempotente y guarda resumen y precios pagados', () => {
    const f = crearServicios()
    const cuerpo = {
      a: 'cerrarCompra',
      compra: { compra_id: 'c1', estado: 'cerrada', fecha_inicio: AHORA, fecha_cierre: AHORA, presupuesto: 100000, total_final: 8000, updated_at: AHORA },
      detalle: [{ detalle_id: 'd1', compra_id: 'c1', producto_id: 'p1', presentacion_id: 'pr1', tienda: 'D1', cantidad: 2, precio_unitario: 4000, subtotal: 8000, estado: 'en_carrito', updated_at: AHORA }],
      observaciones: [{ obs_id: 'compra:d1', presentacion_id: 'pr1', tienda: 'D1', origen: 'tienda', fuente: 'compra', precio: 4000, precio_lista: null, disponible: true, region: '', fecha_observado: AHORA, compra_id: 'c1' }],
      resumen: [{ clave: 'c1|D1', compra_id: 'c1', tienda: 'D1', total_hipotetico: 8000, items_con_precio: 1, items_total: 1, completo: true, created_at: AHORA }],
    }
    expect(post(f.s, cuerpo).ok).toBe(true)
    const antes = JSON.stringify([...f.repo.tablas.entries()])
    const r2 = post(f.s, cuerpo)
    expect(r2.ok).toBe(true)
    expect(JSON.stringify([...f.repo.tablas.entries()])).toBe(antes)
    expect(f.repo.leer('Compras_resumen')).toHaveLength(1)
    expect(f.repo.leer('Precios')).toHaveLength(1)
    expect(f.repo.leer('Compras')[0].estado).toBe('cerrada')
  })
})

// ---------- Trabajo de actualización de precios ----------

function vtexProducto(sku: string, precio: number, ean = '') {
  return JSON.stringify([{
    productId: `p${sku}`, productName: 'Arroz 1000 g', brand: 'X', link: 'l', linkText: 'x',
    items: [{ itemId: sku, ean, name: 'Arroz 1000 g', measurementUnit: 'un', unitMultiplier: 1,
      sellers: [{ sellerId: '1', sellerDefault: true, commertialOffer: { Price: precio, ListPrice: precio, AvailableQuantity: 100, IsAvailable: true } }] }],
  }])
}

function presentacion(id: string, tienda: string, sku: string, ean = '') {
  return { presentacion_id: id, producto_id: 'p1', tienda, nombre_en_tienda: id, marca: '', contenido: 1000, granel: false,
    sku_id: sku, ean, vtex_product_id: '', url: '', auto: true, activo: true, ultimo_error: '', updated_at: AHORA }
}

function prepararRegion(f: ReturnType<typeof crearServicios>) {
  const region = JSON.stringify({ regionId: null, channel: '1', sellers: [], localizada: false, fecha: AHORA })
  f.repo.guardar('Config', ['EXITO', 'OLIMPICA', 'D1'].map((t) => ({ clave: `region.${t}`, valor: region, updated_at: AHORA })))
}

describe('actualización de precios', () => {
  it('el botón deja el trabajo en cola y no deja repetir enseguida', () => {
    const f = crearServicios()
    const r1 = post(f.s, { a: 'actualizarPrecios' })
    expect((r1.data as { job: { estado: string } }).job.estado).toBe('en_cola')
    expect(f.triggers).toContain('unaVez:1000')
    // Mientras está en cola devuelve el mismo trabajo.
    const r2 = post(f.s, { a: 'actualizarPrecios' })
    expect((r2.data as { job: { id: string } }).job.id).toBe((r1.data as { job: { id: string } }).job.id)
    continuarPrecios(f.s)
    expect(leerJob(f.s)?.estado).toBe('terminado')
    expect(post(f.s, { a: 'actualizarPrecios' }).error?.codigo).toBe('rate_limit')
  })

  it('reintenta un 429, busca por EAN si cambió el SKU y guarda los precios', () => {
    let intentosOlim = 0
    const f = crearServicios({
      responder: (p) => {
        if (p.url.includes('exito.com') && p.url.includes('skuId:55')) return { status: 200, cuerpo: '[]', setCookie: [] }
        if (p.url.includes('exito.com') && p.url.includes('alternateIds_Ean:770')) return { status: 206, cuerpo: vtexProducto('60', 5100, '770'), setCookie: [] }
        if (p.url.includes('olimpica.com')) {
          intentosOlim++
          return intentosOlim === 1 ? { status: 429, cuerpo: '', setCookie: [] } : { status: 200, cuerpo: vtexProducto('77', 4900), setCookie: [] }
        }
        return { status: 404, cuerpo: '', setCookie: [] }
      },
    })
    prepararRegion(f)
    f.repo.guardar('Presentaciones', [presentacion('pe', 'EXITO', '55', '770'), presentacion('po', 'OLIMPICA', '77'), presentacion('pa', 'ARA', 'x')])
    const job = tareaDiaria(f.s)
    expect(job).toMatchObject({ estado: 'terminado', total: 2, hechos: 2, actualizados: 2, errores: [] })
    const actuales = f.repo.leer('Precios_actuales')
    expect(actuales.map((a) => [a.presentacion_id, a.precio, a.region]).sort()).toEqual([['pe', 5100, 'DEFAULT'], ['po', 4900, 'DEFAULT']])
    expect(f.repo.leer('Presentaciones').find((p) => p.presentacion_id === 'pe')?.sku_id).toBe('60')
    expect(intentosOlim).toBe(2)
    // Otra corrida sin cambios no agrega histórico.
    f.avanzar(2 * 3600_000)
    tareaDiaria(f.s)
    expect(f.repo.leer('Precios')).toHaveLength(2)
  })

  it('si se acerca el límite de tiempo guarda el avance y programa la continuación', () => {
    const f = crearServicios({ responder: (p) => ({ status: 200, cuerpo: vtexProducto(p.url.match(/skuId:(\d+)/)![1], 1000), setCookie: [] }) })
    prepararRegion(f)
    f.repo.guardar('Presentaciones', Array.from({ length: 12 }, (_, i) => presentacion(`p${i}`, 'EXITO', String(100 + i))))
    f.repo.guardar('Config', [{ clave: 'espaciado_ms', valor: '100000', updated_at: AHORA }])
    const job = tareaDiaria(f.s)
    expect(job?.estado).toBe('en_cola')
    expect(f.triggers).toContain('unaVez:60000')
    expect(job!.hechos).toBeLessThan(12)
    f.repo.guardar('Config', [{ clave: 'espaciado_ms', valor: '10', updated_at: '2026-09-27T12:00:00.000-05:00' }])
    const fin = continuarPrecios(f.s)
    expect(fin).toMatchObject({ estado: 'terminado', hechos: 12, total: 12 })
    expect(f.repo.leer('Precios_actuales')).toHaveLength(12)
  })

  it('un 403 queda como error anotado en la presentación', () => {
    const f = crearServicios({ responder: () => ({ status: 403, cuerpo: 'blocked', setCookie: [] }) })
    prepararRegion(f)
    f.repo.guardar('Presentaciones', [presentacion('pe', 'EXITO', '55')])
    const job = tareaDiaria(f.s)
    expect(job?.errores[0]).toContain('bloqueado')
    expect(String(f.repo.leer('Presentaciones')[0].ultimo_error)).toContain('bloqueado')
    expect(f.repo.leer('Log').at(-1)?.nivel).toBe('aviso')
  })
})

describe('buscarEnTienda', () => {
  it('con * exige EAN y usa la región de Riohacha si está localizada', () => {
    const f = crearServicios({ responder: (p) => ({ status: 200, cuerpo: vtexProducto('9', 3000, '770'), setCookie: [] }) })
    f.repo.guardar('Config', [
      { clave: 'region.EXITO', valor: JSON.stringify({ regionId: 'v2.R', channel: '1', sellers: ['s1'], localizada: true, fecha: AHORA }), updated_at: AHORA },
      { clave: 'region.OLIMPICA', valor: JSON.stringify({ regionId: null, channel: '1', sellers: [], localizada: false, fecha: AHORA }), updated_at: AHORA },
      { clave: 'region.D1', valor: JSON.stringify({ regionId: null, channel: '1', sellers: [], localizada: false, fecha: AHORA }), updated_at: AHORA },
    ])
    expect(post(f.s, { a: 'buscarEnTienda', tienda: '*', q: 'arroz' }).error?.codigo).toBe('validacion')
    const r = post(f.s, { a: 'buscarEnTienda', tienda: '*', ean: '770' })
    const data = r.data as { candidatos: { tienda: string; region: string }[] }
    expect(data.candidatos.map((c) => [c.tienda, c.region])).toEqual([['EXITO', 'RIOHACHA'], ['OLIMPICA', 'DEFAULT'], ['D1', 'DEFAULT']])
    expect(f.pedidas[0].cabeceras?.Cookie).toMatch(/^vtex_segment=/)
    expect(f.pedidas[1].cabeceras?.Cookie).toBeUndefined()
  })
})

describe('región de Riohacha', () => {
  function servidorRegiones(riohacha: string[], bogota: string[]) {
    return crearServicios({
      responder: (p) => {
        if (!p.url.includes('/regions')) return { status: 200, cuerpo: '<html></html>', setCookie: [] }
        const s = p.url.includes('-72.907') ? riohacha : bogota
        return { status: 200, cuerpo: JSON.stringify([{ id: `R${s.join('')}`, sellers: s.map((id) => ({ id })) }]), setCookie: [] }
      },
    })
  }

  it('se consulta por coordenadas y compara con Bogotá; D1 con seller genérico queda manual', () => {
    const f = servidorRegiones(['d1ats12109cc'], ['d1ats12109cc', 'd1bon11808cc'])
    const r = post(f.s, { a: 'probarRegion', tienda: 'D1' })
    expect(r.data).toMatchObject({ region: { localizada: false }, autoD1: false, contexto: { region: 'DEFAULT', segmento: null } })
    expect(f.pedidas.some((p) => p.url.includes('postalCode'))).toBe(false)
    expect(f.repo.leer('Config').find((c) => c.clave === 'tienda_auto.D1')?.valor).toBe('no')
  })

  it('Olímpica con seller propio en Riohacha usa la cookie de la región', () => {
    const f = servidorRegiones(['olimpicaswl1212'], ['olimpicaswl1402'])
    const r = post(f.s, { a: 'probarRegion', tienda: 'OLIMPICA' })
    expect(r.data).toMatchObject({ region: { localizada: true, sellers: ['olimpicaswl1212'] }, contexto: { region: 'RIOHACHA' } })
    expect((r.data as { contexto: { segmento: string } }).contexto.segmento).toBeTruthy()
  })
})

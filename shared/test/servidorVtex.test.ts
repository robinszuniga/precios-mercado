import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// La función del servidor (Deno) se ejecuta aquí con Supabase y las tiendas simuladas. Lo que se protege: una tienda que
// no responde (D1, por ejemplo) no puede tumbar la consulta de las demás, y el cobro de cuota sigue el total de tiendas en línea.

type Handler = (req: Request) => Promise<Response>
const captura = vi.hoisted(() => ({ cuotas: [] as number[] }))

vi.mock('npm:@supabase/supabase-js@2', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'usuario-1' } }, error: null }) },
    rpc: async (_nombre: string, args: { p_unidades: number }) => { captura.cuotas.push(args.p_unidades); return { data: true, error: null } },
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

function producto(nombre: string, precio: number, ean: string, sku: string) {
  return {
    productId: `p-${sku}`, productName: nombre, brand: 'Diana', link: 'l', linkText: 'x',
    items: [{
      itemId: sku, ean, name: nombre, measurementUnit: 'un', unitMultiplier: 1,
      sellers: [{ sellerId: '1', sellerDefault: true, commertialOffer: { Price: precio, ListPrice: precio, AvailableQuantity: 10, IsAvailable: true } }],
    }],
  }
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })

/** Las tiendas simuladas: Éxito y Olímpica responden; D1 (d1.com.co) se configura por prueba. */
function tiendas(d1: (url: string) => Response) {
  return vi.fn(async (entrada: string | URL | Request) => {
    const url = String(entrada)
    if (url.includes('d1.com.co')) return d1(url)
    if (url.includes('/api/checkout/pub/regions')) return json([{ id: 'v2.generica', sellers: [{ id: '1' }] }])
    if (url.includes('/api/catalog_system/pub/products/search')) return json([producto('Arroz Diana 1000 g', 5200, '770', '55')], 206)
    return new Response('<html></html>', { status: 200 }) // la portada (para leer la cookie)
  })
}

async function servidor() {
  vi.resetModules()
  let handler: Handler | null = null
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' } as Record<string, string>)[k] },
    serve: (h: Handler) => { handler = h },
  })
  // La ruta va en una variable: es código de Deno y `tsc` (typecheck de Node) no debe intentar compilarlo.
  const ruta = '../../supabase/functions/vtex/index.ts'
  await import(/* @vite-ignore */ ruta)
  return async (cuerpo: Record<string, unknown>) => {
    const r = await handler!(new Request('https://x.supabase.co/functions/v1/vtex', {
      method: 'POST',
      headers: { authorization: 'Bearer token', origin: 'https://robinszuniga.github.io', 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }))
    return (await r.json()) as { ok: boolean; data: any; error: { codigo: string; mensaje: string } | null }
  }
}

beforeEach(() => { captura.cuotas.length = 0 })
afterEach(() => { vi.unstubAllGlobals() })

const items = [{ id: 'a', q: 'arroz', unidad: 'g' }]
const d1Caido = () => new Response('Service Unavailable', { status: 503 })
const FALLO_D1 = 'No se pudo consultar la región de D1.'

describe('función del servidor: una tienda caída no tumba a las demás', () => {
  it('buscarVarios: D1 sin región → Éxito y Olímpica responden; el error de D1 viaja aparte', async () => {
    vi.stubGlobal('fetch', tiendas(d1Caido))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarVarios', tiendas: ['EXITO', 'OLIMPICA', 'D1'], items })
    expect(r.ok).toBe(true)
    const porTienda = r.data.resultados[0].porTienda
    expect(porTienda.EXITO[0]).toMatchObject({ nombre: 'Arroz Diana 1000 g', precio: 5200 })
    expect(porTienda.OLIMPICA[0]).toMatchObject({ precio: 5200 })
    expect(porTienda.D1).toBeUndefined()
    expect(r.data.errores).toEqual([`D1: ${FALLO_D1}`])
  })

  it('buscarVarios: si D1 responde bien (precio nacional), sale como las demás y marcada DEFAULT', async () => {
    vi.stubGlobal('fetch', tiendas((url) => url.includes('/regions')
      ? json([{ id: 'v2.generica', sellers: [{ id: '1' }] }])
      : json([producto('Arroz Diana 1000 g', 4900, '770', '99')], 206)))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarVarios', tiendas: ['EXITO', 'D1'], items })
    expect(r.ok).toBe(true)
    expect(r.data.errores).toEqual([])
    expect(r.data.resultados[0].porTienda.D1[0]).toMatchObject({ tienda: 'D1', precio: 4900, region: 'DEFAULT' })
    expect(r.data.resultados[0].porTienda.EXITO[0]).toMatchObject({ tienda: 'EXITO', region: 'DEFAULT' })
  })

  it('buscarEnTienda con *: D1 caído no impide ver el producto en las otras tiendas', async () => {
    vi.stubGlobal('fetch', tiendas(d1Caido))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarEnTienda', tienda: '*', ean: '770' })
    expect(r.ok).toBe(true)
    expect(r.data.candidatos.map((c: { tienda: string }) => c.tienda).sort()).toEqual(['EXITO', 'OLIMPICA'])
    expect(r.data.errores).toEqual([`D1: ${FALLO_D1}`])
  })

  it('actualizarVinculadas: las presentaciones de D1 llevan su error y las demás traen su precio', async () => {
    vi.stubGlobal('fetch', tiendas(d1Caido))
    const llamar = await servidor()
    const r = await llamar({
      a: 'actualizarVinculadas',
      presentaciones: [
        { tienda: 'EXITO', presentacion_id: 'pe', sku_id: '55', ean: '770' },
        { tienda: 'D1', presentacion_id: 'pd1', sku_id: '99', ean: '770' },
        { tienda: 'D1', presentacion_id: 'pd2', sku_id: '98', ean: '771' },
      ],
    })
    expect(r.ok).toBe(true)
    const porId = Object.fromEntries(r.data.resultados.map((x: { presentacion_id: string }) => [x.presentacion_id, x]))
    expect(porId.pe).toMatchObject({ tienda: 'EXITO', precio: 5200 })
    expect(porId.pd1).toEqual({ presentacion_id: 'pd1', tienda: 'D1', error: FALLO_D1 })
    expect(porId.pd2).toMatchObject({ error: FALLO_D1 })
  })

  it('probarRegion de D1 sí avisa del fallo (es lo que pide la persona en Ajustes)', async () => {
    vi.stubGlobal('fetch', tiendas(d1Caido))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'D1' })
    expect(r.ok).toBe(false)
    expect(r.error?.mensaje).toBe(FALLO_D1)
  })

  it('probarRegion: sin vendedor propio en Riohacha es precio nacional, no «atiende Riohacha»', async () => {
    vi.stubGlobal('fetch', tiendas((url) => url.includes('/regions')
      ? json([{ id: 'v2.generica', sellers: [{ id: 'd1ats12109cc' }] }]) // los mismos vendedores para Riohacha y para Bogotá
      : json([], 200)))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'D1' })
    expect(r.ok).toBe(true)
    expect(r.data.region).toMatchObject({ localizada: false, sellers: ['d1ats12109cc'] })
  })

  it('probarRegion: con un vendedor propio de Riohacha sí queda como local', async () => {
    vi.stubGlobal('fetch', tiendas((url) => {
      if (!url.includes('/regions')) return json([], 200)
      return url.includes('-72.907')
        ? json([{ id: 'v2.rio', sellers: [{ id: 'd1rio' }] }])
        : json([{ id: 'v2.bog', sellers: [{ id: 'd1ats12109cc' }] }])
    }))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'D1' })
    expect(r.data.region).toMatchObject({ localizada: true, sellers: ['d1rio'] })
  })
})

describe('función del servidor: Metro y Ara no son tiendas de internet', () => {
  it('rechaza a Metro en cualquier consulta (su página de internet es la de Jumbo y no atiende Riohacha)', async () => {
    const pedir = vi.fn(async () => json([]))
    vi.stubGlobal('fetch', pedir)
    const llamar = await servidor()
    expect((await llamar({ a: 'buscarVarios', tiendas: ['EXITO', 'METRO'], items })).error?.mensaje).toBe('La lista de tiendas no es válida.')
    expect((await llamar({ a: 'buscarEnTienda', tienda: 'METRO', q: 'arroz' })).error?.mensaje).toBe('Búsqueda inválida.')
    expect((await llamar({ a: 'probarRegion', tienda: 'METRO' })).error?.mensaje).toBe('Tienda inválida.')
    expect((await llamar({ a: 'actualizarVinculadas', presentaciones: [{ tienda: 'METRO', presentacion_id: 'p', sku_id: '1' }] })).error?.mensaje).toBe('Presentación de tienda inválida.')
    expect(pedir).not.toHaveBeenCalled() // ni una sola petición a jumbocolombia.com
  })
})

describe('función del servidor: cobro de cuota', () => {
  it('cada tienda consultada cuenta', async () => {
    vi.stubGlobal('fetch', tiendas(() => json([])))
    const llamar = await servidor()
    const ocho = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, q: `arroz ${i}`, unidad: 'g' }))
    await llamar({ a: 'buscarVarios', tiendas: ['OLIMPICA', 'EXITO', 'D1'], items: ocho })
    await llamar({ a: 'buscarVarios', tiendas: ['OLIMPICA', 'EXITO'], items: ocho })
    await llamar({ a: 'buscarEnTienda', tienda: '*', ean: '770' })
    const presentaciones = Array.from({ length: 8 }, (_, i) => ({ tienda: 'EXITO', presentacion_id: `p${i}`, sku_id: String(100 + i), ean: '' }))
    await llamar({ a: 'actualizarVinculadas', presentaciones })
    // 8 presentaciones + las consultas de región de cada tienda en línea (portada y dos regiones = 3 por tienda).
    expect(captura.cuotas).toEqual([8 * 3 + 3 * 3, 8 * 2 + 3 * 2, 12, 8 + 3 * 3])
    expect(Math.max(...captura.cuotas)).toBeLessThanOrEqual(100) // la base rechaza más de 100 unidades por llamada
  })
})

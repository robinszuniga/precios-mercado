import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// La función del servidor (Deno) se ejecuta aquí con Supabase y las tiendas simuladas. Lo que se protege: una tienda que
// no responde (Metro, por ejemplo) no puede tumbar la consulta de las demás, y el cobro de cuota sigue el total de tiendas.

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

/** Las tiendas simuladas: Éxito, Olímpica y D1 responden; Metro (jumbocolombia.com) se configura por prueba. */
function tiendas(metro: (url: string) => Response) {
  return vi.fn(async (entrada: string | URL | Request) => {
    const url = String(entrada)
    if (url.includes('jumbocolombia.com')) return metro(url)
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
const metroCaido = () => new Response('Service Unavailable', { status: 503 })

describe('función del servidor: una tienda caída no tumba a las demás', () => {
  it('buscarVarios: Metro sin región → Éxito y Olímpica responden; el error de Metro viaja aparte', async () => {
    vi.stubGlobal('fetch', tiendas(metroCaido))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarVarios', tiendas: ['EXITO', 'OLIMPICA', 'METRO'], items })
    expect(r.ok).toBe(true)
    const porTienda = r.data.resultados[0].porTienda
    expect(porTienda.EXITO[0]).toMatchObject({ nombre: 'Arroz Diana 1000 g', precio: 5200 })
    expect(porTienda.OLIMPICA[0]).toMatchObject({ precio: 5200 })
    expect(porTienda.METRO).toBeUndefined()
    expect(r.data.errores).toEqual(['METRO: No se pudo consultar la región de Metro.'])
  })

  it('buscarVarios: si Metro responde bien (precio nacional), sale como las demás y marcada DEFAULT', async () => {
    vi.stubGlobal('fetch', tiendas((url) => url.includes('/regions')
      ? json([{ id: 'v2.generica', sellers: [{ id: '1' }] }])
      : json([producto('Arroz Diana 1000 g', 4900, '770', '99')], 206)))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarVarios', tiendas: ['EXITO', 'METRO'], items })
    expect(r.ok).toBe(true)
    expect(r.data.errores).toEqual([])
    expect(r.data.resultados[0].porTienda.METRO[0]).toMatchObject({ tienda: 'METRO', precio: 4900, region: 'DEFAULT' })
    expect(r.data.resultados[0].porTienda.EXITO[0]).toMatchObject({ tienda: 'EXITO', region: 'DEFAULT' })
  })

  it('buscarEnTienda con *: Metro caído no impide ver el producto en las otras tiendas', async () => {
    vi.stubGlobal('fetch', tiendas(metroCaido))
    const llamar = await servidor()
    const r = await llamar({ a: 'buscarEnTienda', tienda: '*', ean: '770' })
    expect(r.ok).toBe(true)
    expect(r.data.candidatos.map((c: { tienda: string }) => c.tienda).sort()).toEqual(['D1', 'EXITO', 'OLIMPICA'])
    expect(r.data.errores).toEqual(['METRO: No se pudo consultar la región de Metro.'])
  })

  it('actualizarVinculadas: la presentación de Metro lleva su error y las demás traen su precio', async () => {
    vi.stubGlobal('fetch', tiendas(metroCaido))
    const llamar = await servidor()
    const r = await llamar({
      a: 'actualizarVinculadas',
      presentaciones: [
        { tienda: 'EXITO', presentacion_id: 'pe', sku_id: '55', ean: '770' },
        { tienda: 'METRO', presentacion_id: 'pm1', sku_id: '99', ean: '770' },
        { tienda: 'METRO', presentacion_id: 'pm2', sku_id: '98', ean: '771' },
      ],
    })
    expect(r.ok).toBe(true)
    const porId = Object.fromEntries(r.data.resultados.map((x: { presentacion_id: string }) => [x.presentacion_id, x]))
    expect(porId.pe).toMatchObject({ tienda: 'EXITO', precio: 5200 })
    expect(porId.pm1).toEqual({ presentacion_id: 'pm1', tienda: 'METRO', error: 'No se pudo consultar la región de Metro.' })
    expect(porId.pm2).toMatchObject({ error: 'No se pudo consultar la región de Metro.' })
  })

  it('probarRegion de Metro sí avisa del fallo (es lo que pide la persona en Ajustes)', async () => {
    vi.stubGlobal('fetch', tiendas(metroCaido))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'METRO' })
    expect(r.ok).toBe(false)
    expect(r.error?.mensaje).toBe('No se pudo consultar la región de Metro.')
  })

  it('probarRegion de Metro: sin vendedor propio en Riohacha es precio nacional, no «atiende Riohacha»', async () => {
    vi.stubGlobal('fetch', tiendas((url) => url.includes('/regions')
      ? json([{ id: 'v2.generica', sellers: [{ id: 'jumboCol' }] }]) // los mismos vendedores para Riohacha y para Bogotá
      : json([], 200)))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'METRO' })
    expect(r.ok).toBe(true)
    expect(r.data.region).toMatchObject({ localizada: false, sellers: ['jumboCol'] })
  })

  it('probarRegion de Metro: con un vendedor propio de Riohacha sí queda como local', async () => {
    vi.stubGlobal('fetch', tiendas((url) => {
      if (!url.includes('/regions')) return json([], 200)
      return url.includes('-72.907')
        ? json([{ id: 'v2.rio', sellers: [{ id: 'metrorio' }] }])
        : json([{ id: 'v2.bog', sellers: [{ id: 'jumboCol' }] }])
    }))
    const llamar = await servidor()
    const r = await llamar({ a: 'probarRegion', tienda: 'METRO' })
    expect(r.data.region).toMatchObject({ localizada: true, sellers: ['metrorio'] })
  })
})

describe('función del servidor: cobro de cuota', () => {
  it('cada tienda consultada cuenta; con las 4 en línea ya no se cobra como si fueran 3', async () => {
    vi.stubGlobal('fetch', tiendas(() => json([])))
    const llamar = await servidor()
    const ocho = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, q: `arroz ${i}`, unidad: 'g' }))
    await llamar({ a: 'buscarVarios', tiendas: ['OLIMPICA', 'EXITO', 'D1', 'METRO'], items: ocho })
    await llamar({ a: 'buscarVarios', tiendas: ['OLIMPICA', 'EXITO'], items: ocho })
    await llamar({ a: 'buscarEnTienda', tienda: '*', ean: '770' })
    const presentaciones = Array.from({ length: 8 }, (_, i) => ({ tienda: 'EXITO', presentacion_id: `p${i}`, sku_id: String(100 + i), ean: '' }))
    await llamar({ a: 'actualizarVinculadas', presentaciones })
    // 8 presentaciones + las consultas de región de cada tienda en línea (portada y dos regiones = 3 por tienda).
    expect(captura.cuotas).toEqual([8 * 4 + 3 * 4, 8 * 2 + 3 * 2, 16, 8 + 3 * 4])
    expect(Math.max(...captura.cuotas)).toBeLessThanOrEqual(100) // la base rechaza más de 100 unidades por llamada
  })
})

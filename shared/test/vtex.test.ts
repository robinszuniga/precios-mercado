import { describe, expect, it } from 'vitest'
import { candidatosDeProductos, clasificarRespuesta } from '../src/vtex/parse.ts'
import { planificarPeticiones, presentacionesAuto, procesarRespuesta } from '../src/vtex/plan.ts'
import { esLocal, estaLocalizada, parseRegiones } from '../src/vtex/region.ts'
import { armarSegmento, decodificarSegmento, segmentoDeSetCookie } from '../src/vtex/segmento.ts'
import { urlBusqueda, urlPorEan, urlPorSku, urlRegiones } from '../src/vtex/urls.ts'
import { AHORA, pres, productoVtex } from './ayudas.ts'

describe('urls', () => {
  it('Éxito usa /io y los espacios van como %20, nunca +', () => {
    const u = urlBusqueda('EXITO', { ft: 'arroz diana' })
    expect(u).toBe('https://www.exito.com/io/api/catalog_system/pub/products/search?ft=arroz%20diana&_from=0&_to=49')
    expect(u).not.toContain('+')
  })
  it('Olímpica y D1 van sin /io', () => {
    expect(urlPorSku('OLIMPICA', '123')).toBe('https://www.olimpica.com/api/catalog_system/pub/products/search?fq=skuId:123&_from=0&_to=49')
    expect(urlPorEan('D1', '7702001')).toContain('https://www.d1.com.co/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7702001')
  })
  it('la ventana nunca pasa de 50 ni de 2500', () => {
    expect(urlBusqueda('D1', { ft: 'x', desde: 100, hasta: 500 })).toContain('_from=100&_to=149')
    expect(urlBusqueda('D1', { ft: 'x', desde: 2480 })).toContain('_from=2480&_to=2499')
  })
  it('regiones por código postal y por coordenadas', () => {
    expect(urlRegiones('EXITO', { cp: '440001' })).toBe('https://www.exito.com/io/api/checkout/pub/regions?country=COL&postalCode=440001')
    expect(urlRegiones('D1', { lon: -72.907, lat: 11.544 })).toBe('https://www.d1.com.co/api/checkout/pub/regions?country=COL&geoCoordinates=-72.907%3B11.544')
  })
  it('codifica caracteres especiales del texto', () => {
    expect(urlBusqueda('EXITO', { ft: 'café & té' })).toContain('ft=caf%C3%A9%20%26%20t%C3%A9')
  })
})

describe('segmento', () => {
  it('arma la cookie con regionId y channel y se puede leer de vuelta', () => {
    const s = armarSegmento('v2.ABC', '1')
    expect(decodificarSegmento(s)).toMatchObject({ regionId: 'v2.ABC', channel: '1', countryCode: 'COL' })
  })
  it('conserva lo que venía de la tienda', () => {
    const base = { channel: '3', priceTables: 'x', raro: 1 }
    expect(decodificarSegmento(armarSegmento('R', undefined, base))).toMatchObject({ channel: '3', priceTables: 'x', raro: 1, regionId: 'R' })
  })
  it('lee vtex_segment de un Set-Cookie', () => {
    const s = armarSegmento('v2.Z', '2')
    expect(segmentoDeSetCookie([`other=1; Path=/`, `vtex_segment=${s}; Path=/; secure`])?.channel).toBe('2')
    expect(segmentoDeSetCookie('sin=cookie')).toBeNull()
  })
})

describe('regiones', () => {
  it('con sellers está localizada', () => {
    const r = parseRegiones(200, JSON.stringify([{ id: 'v2.1A', sellers: [{ id: 'exitocol041', name: 'x' }] }]))
    expect(r).toEqual({ regionId: 'v2.1A', sellers: ['exitocol041'] })
    expect(estaLocalizada(r)).toBe(true)
  })
  it('sin sellers no está localizada', () => {
    const r = parseRegiones(200, JSON.stringify([{ id: 'v2.1A', sellers: [] }]))
    expect(estaLocalizada(r)).toBe(false)
    expect(estaLocalizada(parseRegiones(200, '[]'))).toBe(false)
  })
  // Respuestas reales medidas el 27-sep-2026 (smoke test desde GitHub Actions).
  const reg = (id: string, sellers: string[]) => parseRegiones(200, JSON.stringify([{ id, sellers: sellers.map((s) => ({ id: s })) }]))
  it('Olímpica atiende Riohacha: seller propio, distinto al de Bogotá', () => {
    expect(esLocal(reg('U1cjb2xpbXBpY2Fzd2wxMjEy', ['olimpicaswl1212']), reg('U1cjb2xpbXBpY2Fzd2wxNDAy', ['olimpicaswl1402']))).toBe(true)
  })
  it('Éxito no atiende Riohacha: la región por coordenadas viene vacía', () => {
    expect(esLocal(reg('U1cj', []), reg('U1cjZXhpdG9jb2wwODg=', ['exitocol088']))).toBe(false)
  })
  it('D1 no atiende Riohacha: su único seller también aparece en Bogotá', () => {
    expect(esLocal(reg('v2.C3EB', ['d1ats12109cc']), reg('v2.B33F', ['d1ats12109cc', 'd1bon11808cc']))).toBe(false)
  })
  it('el código postal da la misma región genérica en cualquier ciudad: no cuenta como local', () => {
    const generica = reg('v2.68492AFE', ['d1nacional'])
    expect(esLocal(generica, generica)).toBe(false)
    // Si falló la consulta de Bogotá no se puede saber: precio nacional, nunca "Riohacha" por error.
    expect(esLocal(reg('v2.x', ['d1generico']), null)).toBe(false)
  })

  it('respuestas inválidas', () => {
    expect(parseRegiones(500, '')).toBeNull()
    expect(parseRegiones(200, '<html>')).toBeNull()
  })
})

describe('clasificarRespuesta', () => {
  it('200 y 206 con array son válidos', () => {
    expect(clasificarRespuesta(200, '[]').tipo).toBe('ok')
    expect(clasificarRespuesta(206, ' [{"a":1}]').tipo).toBe('ok')
  })
  it('HTML con 200 se reintenta', () => {
    expect(clasificarRespuesta(200, '<!doctype html>').tipo).toBe('reintentar')
  })
  it('429 y 5xx se reintentan; 403 y el WAF no', () => {
    expect(clasificarRespuesta(429, '').tipo).toBe('reintentar')
    expect(clasificarRespuesta(503, '').tipo).toBe('reintentar')
    expect(clasificarRespuesta(403, '').tipo).toBe('error')
    expect(clasificarRespuesta(400, 'Bad Request! Scripts are not allowed!')).toMatchObject({ tipo: 'error', motivo: expect.stringContaining('waf') })
  })
})

describe('candidatosDeProductos', () => {
  it('toma la oferta del seller de la región antes que la del marketplace', () => {
    const p = productoVtex({
      nombre: 'Arroz Diana 1000 g',
      skus: [{ itemId: '55', ean: '770', sellers: [
        { sellerId: 'mkp-otro', price: 3000 },
        { sellerId: '1', def: true, price: 5200, list: 5500 },
        { sellerId: 'exitocol041', price: 4900, list: 5500 },
      ] }],
    })
    const [c] = candidatosDeProductos('EXITO', [p], ['exitocol041'])
    expect(c).toMatchObject({ skuId: '55', ean: '770', precio: 4900, precioLista: 5500, oferta: true, sellerId: 'exitocol041', disponible: true })
    expect(c.contenido).toMatchObject({ valor: 1000, unidad: 'g', fuente: 'nombre' })
    const [sinRegion] = candidatosDeProductos('EXITO', [p])
    expect(sinRegion.precio).toBe(5200)
  })

  it('precio 0 o sin existencias queda como no disponible y sin precio', () => {
    const p = productoVtex({ nombre: 'Aceite 1 L', skus: [
      { itemId: '1', sellers: [{ sellerId: '1', def: true, price: 0 }] },
      { itemId: '2', sellers: [{ sellerId: '1', def: true, price: 9000, qty: 0 }] },
    ] })
    const [a, b] = candidatosDeProductos('OLIMPICA', [p])
    expect(a).toMatchObject({ precio: null, disponible: false })
    expect(b).toMatchObject({ precio: 9000, disponible: false })
  })

  it('sin seller propio ni por defecto no hay candidato', () => {
    const p = productoVtex({ nombre: 'X', skus: [{ itemId: '1', sellers: [{ sellerId: 'mkp', price: 100 }] }] })
    expect(candidatosDeProductos('EXITO', [p])).toEqual([])
  })

  it('usa la especificación PUM si el nombre no dice el contenido', () => {
    const p = productoVtex({
      nombre: 'Queso Doble Crema Alpina',
      skus: [{ itemId: '1', sellers: [{ sellerId: '1', def: true, price: 12000 }] }],
      extra: { 'Factor Neto PUM': ['400'], 'Unidad de Medida PUM Calculado': ['GRAMO'] },
    })
    expect(candidatosDeProductos('EXITO', [p])[0].contenido).toMatchObject({ valor: 400, unidad: 'g', fuente: 'pum' })
  })

  it('granel: measurementUnit × unitMultiplier', () => {
    const p = productoVtex({ nombre: 'Tomate chonto', skus: [{ itemId: '1', measurementUnit: 'kg', unitMultiplier: 0.5, sellers: [{ sellerId: '1', def: true, price: 1800 }] }] })
    expect(candidatosDeProductos('OLIMPICA', [p])[0].contenido).toMatchObject({ valor: 500, unidad: 'g', fuente: 'medida' })
  })

  it('tolera basura en la respuesta', () => {
    expect(candidatosDeProductos('EXITO', [null, 3, { items: 'no' }, { items: [null] }])).toEqual([])
  })
})

describe('plan de actualización', () => {
  const exito = pres('pe', 'EXITO', 1000, { sku_id: '55', ean: '770', auto: true })
  const olim = pres('po', 'OLIMPICA', 1000, { sku_id: '77', auto: true })
  const d1 = pres('pd', 'D1', 1000, { sku_id: '9', auto: true })
  const ara = pres('pa', 'ARA', 1000, { auto: true, sku_id: 'x' })

  it('D1 solo entra si su región atiende Riohacha; Ara nunca', () => {
    expect(presentacionesAuto([exito, d1, ara], false).map((p) => p.presentacion_id)).toEqual(['pe'])
    expect(presentacionesAuto([exito, d1, ara], true).map((p) => p.presentacion_id)).toEqual(['pe', 'pd'])
  })

  it('alterna tiendas y manda la cookie de región', () => {
    const e2 = { ...exito, presentacion_id: 'pe2', sku_id: '56' }
    const ps = planificarPeticiones([exito, e2, olim], { EXITO: { segmento: 'SEG', sellers: ['s'], region: 'RIOHACHA' } })
    expect(ps.map((p) => p.presentacion_id)).toEqual(['pe', 'po', 'pe2'])
    expect(ps[0].cabeceras.Cookie).toBe('vtex_segment=SEG')
    expect(ps[1].cabeceras.Cookie).toBeUndefined()
  })

  it('encuentra el SKU y arma la observación online', () => {
    const [pet] = planificarPeticiones([exito], {})
    const cuerpo = JSON.stringify([productoVtex({ nombre: 'Arroz 1 kg', skus: [{ itemId: '55', ean: '770', sellers: [{ sellerId: '1', def: true, price: 5000 }] }] })])
    const r = procesarRespuesta(pet, 206, cuerpo, exito, undefined, AHORA)
    expect(r).toMatchObject({ tipo: 'obs', obs: { precio: 5000, origen: 'online', fuente: 'auto', region: 'DEFAULT', obs_id: 'auto:pe:2026-09-27T10' } })
  })

  it('si el SKU no aparece, pide por EAN y corrige el SKU', () => {
    const [pet] = planificarPeticiones([exito], {})
    const r1 = procesarRespuesta(pet, 200, '[]', exito, undefined, AHORA)
    expect(r1.tipo).toBe('respaldo')
    if (r1.tipo !== 'respaldo') return
    expect(r1.peticion.url).toContain('alternateIds_Ean:770')
    const cuerpo = JSON.stringify([productoVtex({ productId: '900', nombre: 'Arroz 1 kg', skus: [{ itemId: '60', ean: '770', sellers: [{ sellerId: '1', def: true, price: 5100 }] }] })])
    const r2 = procesarRespuesta(r1.peticion, 200, cuerpo, exito, undefined, AHORA)
    expect(r2).toMatchObject({ tipo: 'obs', parche: { sku_id: '60', vtex_product_id: '900' } })
  })

  it('sin EAN y sin resultado, deja el error anotado', () => {
    const [pet] = planificarPeticiones([olim], {})
    const r = procesarRespuesta(pet, 200, '[]', olim, undefined, AHORA)
    expect(r).toMatchObject({ tipo: 'error', parche: { ultimo_error: expect.stringContaining('no encontrado') } })
  })

  it('429 se reintenta, 403 es error', () => {
    const [pet] = planificarPeticiones([olim], {})
    expect(procesarRespuesta(pet, 429, '', olim, undefined, AHORA).tipo).toBe('reintentar')
    expect(procesarRespuesta(pet, 403, '', olim, undefined, AHORA).tipo).toBe('error')
  })
})

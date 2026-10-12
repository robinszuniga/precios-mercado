import { describe, expect, it } from 'vitest'
import {
  claveSede, consultaOverpass, distanciaKm, distanciaViaKm, enlaceGoogleMaps, enlaceWaze, formatoKm, fusionarSedes, ordenarRuta, sedeDeFila,
  sedeMasCercana, sedesDeConfig, sedesDeOverpass, tiendaDeNombre, valorSede, type Sede,
} from '../src/mapa.ts'

const sede = (id: string, tienda: Sede['tienda'], lat: number, lng: number, nombre = id): Sede => ({ id, tienda, nombre, lat, lng })

describe('distancias', () => {
  it('un grado de latitud son unos 111 km, y es simétrica', () => {
    const a = { lat: 11, lng: -72.9 }
    const b = { lat: 12, lng: -72.9 }
    expect(distanciaKm(a, b)).toBeCloseTo(111.2, 0)
    expect(distanciaKm(b, a)).toBeCloseTo(distanciaKm(a, b), 9)
    expect(distanciaKm(a, a)).toBe(0)
    expect(distanciaViaKm(a, b)).toBeCloseTo(distanciaKm(a, b) * 1.3, 9)
  })

  it('formatoKm: metros por debajo de 1 km, con coma decimal por encima', () => {
    expect(formatoKm(0.004)).toBe('10 m')
    expect(formatoKm(0.85)).toBe('850 m')
    expect(formatoKm(1.234)).toBe('1,2 km')
    expect(formatoKm(12)).toBe('12,0 km')
    // Justo por debajo de 1 km no puede salir "1000 m".
    expect(formatoKm(0.996)).toBe('1,0 km')
    expect(formatoKm(0.994)).toBe('990 m')
  })
})

describe('sedes guardadas (una fila de configuración por sede)', () => {
  const fila = (s: Sede) => ({ clave: claveSede(s.id), valor: valorSede(s) })

  it('ida y vuelta, en un orden estable por tienda y nombre; lo ajeno, vacío o mal formado se ignora', () => {
    const sedes = [sede('b', 'EXITO', 11.54, -72.9, 'Éxito Centro'), sede('a', 'D1', 11.5444, -72.9072, 'D1 Calle 15'), sede('osm:node1', 'D1', 11.5, -72.9, 'D1 Avenida')]
    const leidas = sedesDeConfig([...sedes.map(fila), { clave: 'vigencia_auto_dias', valor: '3' }])
    expect(leidas.map((s) => s.id)).toEqual(['b', 'osm:node1', 'a']) // por tienda (Éxito, Olímpica, D1, Ara) y luego por nombre
    expect(leidas.find((s) => s.id === 'a')).toEqual(sedes[1])
    const raras = [
      { clave: claveSede('quitada'), valor: '' },
      { clave: claveSede('mal-json'), valor: 'no es json' },
      { clave: claveSede('otra-tienda'), valor: JSON.stringify({ tienda: 'JUMBO', nombre: 'x', lat: 11.5, lng: -72.9 }) },
      { clave: claveSede('lat-fuera'), valor: JSON.stringify({ tienda: 'D1', nombre: 'x', lat: 999, lng: -72.9 }) },
      { clave: claveSede('lat-texto'), valor: JSON.stringify({ tienda: 'D1', nombre: 'x', lat: '11', lng: -72.9 }) },
      { clave: claveSede('sin-nombre'), valor: JSON.stringify({ tienda: 'OLIMPICA', lat: 11.5, lng: -72.9 }) },
      { clave: claveSede(' espacios '), valor: JSON.stringify({ tienda: 'ARA', nombre: ' Ara ', lat: 11.5, lng: -72.9 }) },
    ]
    expect(sedesDeConfig(raras).map((s) => [s.id, s.nombre])).toEqual([['sin-nombre', 'Olímpica'], [' espacios ', 'Ara']])
    expect(sedeDeFila('sede.', JSON.stringify({ tienda: 'D1', lat: 11, lng: -72 }))).toBeNull() // sin id
    expect(sedeDeFila('otra.clave', valorSede(sedes[0]))).toBeNull()
  })

  it('fusionar: no repite el mismo id ni la misma tienda a menos de 80 m; otra tienda cercana sí entra', () => {
    const actuales = [sede('a', 'D1', 11.5444, -72.9072)]
    const nuevas = [
      sede('a', 'D1', 11.9, -72.0), // mismo id
      sede('b', 'D1', 11.54445, -72.90725), // misma tienda, ~7 m
      sede('c', 'EXITO', 11.54445, -72.90725), // otra tienda en el mismo punto
      sede('d', 'D1', 11.56, -72.9072), // misma tienda, lejos
    ]
    const r = fusionarSedes(actuales, nuevas)
    expect(r.agregadas.map((s) => s.id)).toEqual(['c', 'd'])
    expect(r.sedes).toHaveLength(3)
  })
})

describe('tiendaDeNombre', () => {
  it.each([
    ['Éxito', 'EXITO'], ['Almacenes Éxito', 'EXITO'], ['EXITO Express', 'EXITO'],
    ['Olímpica', 'OLIMPICA'], ['Supertiendas Olímpica', 'OLIMPICA'], ['olimpica', 'OLIMPICA'],
    ['D1', 'D1'], ['Tiendas D1', 'D1'], ['Tienda D1 Calle 15', 'D1'],
    ['Ara', 'ARA'], ['Tiendas Ara', 'ARA'], ['ARA', 'ARA'],
  ])('%s → %s', (texto, tienda) => expect(tiendaDeNombre(texto)).toBe(tienda))

  it.each([['Supertiendas Olímpica', 'OLIMPICA'], ['Hipermercado Éxito', 'EXITO'], ['Tiendas Olímpica', 'OLIMPICA']])('%s → %s', (texto, tienda) => expect(tiendaDeNombre(texto)).toBe(tienda))

  it.each([
    'Araújo', 'Ara Mueblería', 'Carulla', 'Jumbo', 'D12 Papelería', 'Mi Éxitos Perfumería ', '', undefined, 5,
    // Otros negocios que solo llevan la palabra: no son el supermercado.
    'Droguería Olímpica', 'Peluquería Éxito', 'Papelería Éxito', 'Distribuidora Exito del Caribe', 'Ferretería Olímpica', 'Farmacia Olimpica',
  ])('%s no es de las cuatro', (texto) => {
    // "Éxitos" sí contiene la palabra "éxito" como prefijo pero no como palabra completa.
    expect(tiendaDeNombre(texto)).toBeNull()
  })
})

describe('Overpass', () => {
  it('la consulta redondea el centro a ~1 km y acota el radio', () => {
    const q = consultaOverpass({ lat: 11.54449, lng: -72.90721 }, 999_999)
    expect(q).toContain('around:30000,11.54,-72.91')
    expect(q).not.toContain('11.54449')
    expect(q).toContain('out center tags')
    // Solo locales que pueden ser un supermercado o tienda de barrio, no cualquier "shop".
    expect(q).toContain('["shop"~"^(supermarket|convenience|')
    expect(q).not.toContain('nwr["shop"]')
    expect(consultaOverpass({ lat: 11, lng: -72 }, 5)).toContain('around:1000,')
  })

  it('lee nodos y vías (con centro), usa la marca si el nombre no sirve, y descarta lo que no es de las cuatro', () => {
    const respuesta = {
      elements: [
        { type: 'node', id: 1, lat: 11.5444, lon: -72.9072, tags: { name: 'Tiendas D1', shop: 'supermarket', 'addr:street': 'Calle 15' } },
        { type: 'way', id: 2, center: { lat: 11.55, lon: -72.91 }, tags: { name: 'Almacén del centro', brand: 'Olímpica', shop: 'supermarket' } },
        { type: 'node', id: 3, lat: 11.5, lon: -72.9, tags: { name: 'Araújo', shop: 'clothes' } },
        { type: 'node', id: 4, tags: { name: 'Éxito' } }, // sin posición
        { type: 'node', id: 1, lat: 11.5444, lon: -72.9072, tags: { name: 'Tiendas D1' } }, // repetido
        { type: 'node', id: 5, lat: 11.52, lon: -72.89, tags: { brand: 'Ara' } },
      ],
    }
    const sedes = sedesDeOverpass(respuesta)
    expect(sedes.map((s) => [s.id, s.tienda, s.nombre])).toEqual([
      ['osm:node1', 'D1', 'Tiendas D1 · Calle 15'],
      ['osm:way2', 'OLIMPICA', 'Almacén del centro'],
      ['osm:node5', 'ARA', 'Ara'],
    ])
    expect(sedes[1]).toMatchObject({ lat: 11.55, lng: -72.91 })
    expect(sedesDeOverpass(null)).toEqual([])
    expect(sedesDeOverpass({ elements: 'no' })).toEqual([])
  })
})

describe('ordenarRuta', () => {
  // Tres puntos sobre una línea (latitud): A en 0, B en 0,1, C en 0,3. Desde cerca de A: A → B → C.
  const a = sede('a', 'EXITO', 11.0, -72.9)
  const b = sede('b', 'D1', 11.1, -72.9)
  const c = sede('c', 'OLIMPICA', 11.3, -72.9)

  it('desde un punto: el orden más corto, con la distancia de cada tramo', () => {
    const r = ordenarRuta({ lat: 10.99, lng: -72.9 }, [c, a, b], ['OLIMPICA', 'EXITO', 'D1'])
    expect(r.paradas.map((p) => p.sede.id)).toEqual(['a', 'b', 'c'])
    expect(r.paradas[0].km).toBeCloseTo(distanciaViaKm({ lat: 10.99, lng: -72.9 }, a), 6)
    expect(r.totalKm).toBeCloseTo(r.paradas.reduce((s, p) => s + p.km, 0), 6)
    expect(r.sinSede).toEqual([])
  })

  it('desde el otro extremo el orden se invierte', () => {
    const r = ordenarRuta({ lat: 11.31, lng: -72.9 }, [a, b, c], ['EXITO', 'D1', 'OLIMPICA'])
    expect(r.paradas.map((p) => p.sede.id)).toEqual(['c', 'b', 'a'])
  })

  it('con varias sedes de una tienda elige la que acorta el recorrido; y avisa de las tiendas sin sede', () => {
    const lejos = sede('exito-lejos', 'EXITO', 11.9, -72.9)
    const r = ordenarRuta({ lat: 10.99, lng: -72.9 }, [lejos, a, b], ['EXITO', 'D1', 'ARA'])
    expect(r.paradas.map((p) => p.sede.id)).toEqual(['a', 'b'])
    expect(r.sinSede).toEqual(['ARA'])
  })

  it('sin punto de partida el primer tramo vale 0; sin sedes no hay ruta', () => {
    const r = ordenarRuta(null, [a, b], ['EXITO', 'D1'])
    expect(r.paradas[0].km).toBe(0)
    expect(r.totalKm).toBeCloseTo(distanciaViaKm(a, b), 6)
    expect(ordenarRuta(null, [], ['EXITO'])).toEqual({ paradas: [], totalKm: 0, sinSede: ['EXITO'] })
  })

  it('con muchas sedes por tienda no se demora (limita las combinaciones)', () => {
    const muchas = (tienda: Sede['tienda'], desde: number) => Array.from({ length: 30 }, (_, i) => sede(`${tienda}${i}`, tienda, desde + i * 0.01, -72.9))
    const t0 = Date.now()
    const r = ordenarRuta({ lat: 11, lng: -72.9 }, [...muchas('EXITO', 11), ...muchas('D1', 11.1), ...muchas('OLIMPICA', 11.2), ...muchas('ARA', 11.3)], ['EXITO', 'D1', 'OLIMPICA', 'ARA'])
    expect(r.paradas).toHaveLength(4)
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('sin punto de partida y con muchísimas sedes, igual halla el recorrido más corto (no corta por el orden de guardado)', () => {
    // 2 Éxito, 5 Olímpica, 12 D1, 10 Ara: la última de cada cadena está en el mismo lugar; las demás, repartidas lejos.
    const lejos = (tienda: Sede['tienda'], n: number, desde: number) => Array.from({ length: n - 1 }, (_, i) => sede(`${tienda}-${i}`, tienda, 11 + (i + 1) * 0.1, desde + (i + 1) * 0.01))
    const juntas = [sede('EXITO-ult', 'EXITO', 11.5, -72.5), sede('OLIMPICA-ult', 'OLIMPICA', 11.5001, -72.5), sede('D1-ult', 'D1', 11.5, -72.5001), sede('ARA-ult', 'ARA', 11.5001, -72.5001)]
    const todas = [...lejos('EXITO', 2, -74), ...lejos('OLIMPICA', 5, -73.6), ...lejos('D1', 12, -73.2), ...lejos('ARA', 10, -72.8), ...juntas]
    const r = ordenarRuta(null, todas, ['EXITO', 'OLIMPICA', 'D1', 'ARA'])
    expect(r.paradas.map((p) => p.sede.id).sort()).toEqual(['ARA-ult', 'D1-ult', 'EXITO-ult', 'OLIMPICA-ult'])
    expect(r.totalKm).toBeLessThan(0.5)
  })

  it('es óptima: coincide con probar todas las combinaciones y órdenes (muchos casos al azar)', () => {
    let semilla = 12345
    const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296 }
    const permutar = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutar([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])))
    const producto = <T,>(ls: T[][]): T[][] => ls.reduce<T[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]])
    for (let caso = 0; caso < 60; caso++) {
      const tiendas = (['EXITO', 'OLIMPICA', 'D1', 'ARA'] as const).slice(0, 2 + (caso % 3))
      const sedes = tiendas.flatMap((t) => Array.from({ length: 1 + Math.floor(azar() * 4) }, (_, i) => sede(`${t}${i}`, t, 11 + azar() * 0.2, -73 + azar() * 0.2)))
      const origen = caso % 2 ? { lat: 11 + azar() * 0.2, lng: -73 + azar() * 0.2 } : null
      const largo = (orden: Sede[]) => orden.reduce((km, s, i) => km + (i === 0 ? (origen ? distanciaViaKm(origen, s) : 0) : distanciaViaKm(orden[i - 1], s)), 0)
      const mejor = Math.min(...producto(tiendas.map((t) => sedes.filter((s) => s.tienda === t))).flatMap((e) => permutar(e)).map(largo))
      const r = ordenarRuta(origen, sedes, tiendas)
      expect(r.totalKm).toBeCloseTo(mejor, 9)
      expect(largo(r.paradas.map((p) => p.sede))).toBeCloseTo(r.totalKm, 9)
    }
  })

  it('sedeMasCercana', () => {
    expect(sedeMasCercana({ lat: 11.29, lng: -72.9 }, [a, b, c, sede('d1-2', 'D1', 11.28, -72.9)], 'D1')?.sede.id).toBe('d1-2')
    expect(sedeMasCercana({ lat: 11, lng: -72.9 }, [a], 'ARA')).toBeNull()
  })
})

describe('enlaces', () => {
  it('Google Maps: la última parada es el destino, las demás van en waypoints, y el origen es opcional', () => {
    const url = new URL(enlaceGoogleMaps([a1(), b1(), c1()], { lat: 11.0, lng: -72.9 })!)
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('destination')).toBe('11.300000,-72.900000')
    expect(url.searchParams.get('waypoints')).toBe('11.100000,-72.900000|11.200000,-72.900000')
    expect(url.searchParams.get('origin')).toBe('11.000000,-72.900000')
    expect(new URL(enlaceGoogleMaps([a1()])!).searchParams.has('origin')).toBe(false)
    expect(new URL(enlaceGoogleMaps([a1()])!).searchParams.has('waypoints')).toBe(false)
    expect(enlaceGoogleMaps([])).toBeNull()
  })

  it('Waze lleva a un solo destino', () => {
    expect(enlaceWaze({ lat: 11.5444, lng: -72.9072 })).toBe('https://waze.com/ul?ll=11.544400,-72.907200&navigate=yes')
  })
})

const a1 = () => ({ lat: 11.1, lng: -72.9 })
const b1 = () => ({ lat: 11.2, lng: -72.9 })
const c1 = () => ({ lat: 11.3, lng: -72.9 })

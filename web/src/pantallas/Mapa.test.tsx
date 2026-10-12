import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claveSede, MAX_SEDES, sedesDeConfig, valorSede, type Punto, type Sede } from '@shared/mapa.ts'
import type { PinSede } from '../componentes/MapaLeaflet.tsx'
import { leerRuta } from '../app/ruta.ts'
import { db } from '../datos/db.ts'
import { agregarALaCompra, asegurarCompra, guardar, guardarConfig, nuevaPresentacion, nuevoProducto, observacion, registrarObservaciones, registrarPrecioManual } from '../datos/escritura.ts'
import { agregarSede } from '../datos/sedes.ts'
import { Mapa } from './Mapa.tsx'

// Leaflet necesita un mapa de verdad (tamaño, teselas): aquí se cambia por un doble que muestra los pines y deja "tocar".
vi.mock('../componentes/MapaLeaflet.tsx', () => ({
  default: (p: { pines: PinSede[]; onSeleccionar: (id: string) => void; onTocarMapa?: (x: Punto) => void; yo: Punto | null }) => (
    <div data-testid="mapa" data-yo={p.yo ? 'si' : 'no'}>
      {p.pines.map((x) => <button key={x.sede.id} type="button" onClick={() => p.onSeleccionar(x.sede.id)}>{`pin ${x.sede.tienda} ${x.etiqueta} ${x.mejor ? 'mejor' : ''}`}</button>)}
      {p.onTocarMapa && <button type="button" onClick={() => p.onTocarMapa!({ lat: 11.5, lng: -72.91 })}>tocar el mapa</button>}
    </div>
  ),
}))

const ESPERA = 10_000
const sede = (id: string, tienda: Sede['tienda'], lat: number, lng: number, nombre = id): Sede => ({ id, tienda, nombre, lat, lng })

function ubicadoEn(lat: number, lng: number) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: lat, longitude: lng } }) },
  })
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = '#/mapa'
})
afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
})

/** Arroz (D1 muy barato, Éxito caro), leche (Éxito algo más barato) y aceite (solo Éxito): el plan de hoy usa D1 y Éxito. */
async function conLista() {
  const [arroz, leche, aceite] = await guardar('Productos', [
    nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', cantidad_habitual: 1 }),
    nuevoProducto({ nombre: 'Leche', unidad_base: 'ml', cantidad_habitual: 1.1 }),
    nuevoProducto({ nombre: 'Aceite', unidad_base: 'ml', cantidad_habitual: 1 }),
  ])
  const pres = async (p: typeof arroz, tienda: Sede['tienda'], contenido: number, precio: number) => {
    const [x] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda, contenido }))
    await registrarPrecioManual(x, precio)
  }
  await pres(arroz, 'D1', 1000, 1000)
  await pres(arroz, 'EXITO', 1000, 5000)
  await pres(leche, 'D1', 1100, 4800)
  await pres(leche, 'EXITO', 1100, 4500)
  await pres(aceite, 'EXITO', 1000, 9000)
  await asegurarCompra(['D1', 'EXITO', 'OLIMPICA', 'ARA'])
  for (const p of [arroz, leche, aceite]) await agregarALaCompra(p, ['D1', 'EXITO', 'OLIMPICA', 'ARA'])
}

const sedesGuardadas = async () => sedesDeConfig(await db.config.toArray())
/** Deja guardadas estas sedes, como las guarda la app: una fila de configuración por sede. */
const conSedes = async (sedes: Sede[]) => { for (const s of sedes) await guardarConfig(claveSede(s.id), valorSede(s)) }

describe('ruta del mapa', () => {
  it('#/mapa es una ruta', () => {
    expect(leerRuta('#/mapa')).toEqual({ vista: 'mapa' })
  })
})

describe('Mapa · sin lista ni sedes', () => {
  it('explica cómo empezar', async () => {
    render(<Mapa />)
    expect(await screen.findByText('Todavía no hay una lista para comparar.', {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(screen.getByText('Aún no hay sedes guardadas.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '#/plan')
  })
})

describe('Mapa · lo que cuesta tu lista en cada tienda', () => {
  it('ordena las tiendas: la más barata con todo primero, y las que no tienen precios al final', async () => {
    await conLista()
    render(<Mapa />)
    await screen.findByText('Tu lista en cada tienda', {}, { timeout: ESPERA })
    const tarjetas = screen.getAllByRole('listitem').filter((li) => /Toda tu lista|Tiene \d+ de|Sin precios de tu lista/.test(li.textContent ?? ''))
    expect(tarjetas).toHaveLength(4)
    // Solo Éxito tiene los 3 productos: es la única "con todo".
    expect(tarjetas[0]).toHaveTextContent('Éxito')
    expect(tarjetas[0]).toHaveTextContent('Más barata con todo')
    expect(tarjetas[0]).toHaveTextContent(/Toda tu lista:\s*\$\s*18\.500/)
    expect(tarjetas[1]).toHaveTextContent('D1')
    expect(tarjetas[1]).toHaveTextContent(/Tiene 2 de 3 productos/)
    expect(tarjetas[1]).toHaveTextContent(/5\.800/)
    expect(tarjetas[2]).toHaveTextContent(/Sin precios de tu lista todavía/)
    expect(tarjetas[3]).toHaveTextContent(/Sin precios de tu lista todavía/)
  })

  it('un total que usa el precio nacional de internet de D1 sale marcado como tal (pines y tarjeta)', async () => {
    const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g', cantidad_habitual: 1 }))
    const [d1] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', contenido: 1000, sku_id: 's1', auto: true }))
    await registrarObservaciones([observacion({ presentacion: d1, precio: 4000, origen: 'online', fuente: 'auto', region: 'DEFAULT' })])
    await asegurarCompra(['D1'])
    await agregarALaCompra(arroz, ['D1'])
    await conSedes([sede('d1', 'D1', 11.5, -72.9, 'D1 Calle 15')])
    render(<Mapa />)
    expect(await screen.findByRole('button', { name: /pin D1 .*con precio nacional/ }, { timeout: ESPERA })).toBeInTheDocument()
    const tarjeta = (await screen.findAllByRole('listitem')).find((li) => /Toda tu lista/.test(li.textContent ?? ''))!
    expect(tarjeta).toHaveTextContent(/incluye precio nacional de internet/)
    // La ruta de hoy también lo dice: el total de la parada y la frase de «lo más conveniente».
    expect(await screen.findByText(/Lo más conveniente: todo en D1 \(con su precio nacional de internet\)/)).toBeInTheDocument()
    expect(screen.getAllByText(/precio nacional/).some((e) => /\$\s*4\.000 · precio nacional/.test(e.textContent ?? ''))).toBe(true)
  })

  it('con sedes: los pines llevan lo que cuesta la lista y marcan la más barata; elegir uno muestra cómo ir', async () => {
    await conLista()
    await conSedes([sede('d1', 'D1', 11.5, -72.9, 'D1 Calle 15'), sede('ex', 'EXITO', 11.6, -72.9, 'Éxito Centro')])
    render(<Mapa />)
    const pinExito = await screen.findByRole('button', { name: /pin EXITO .*18\.500 mejor/ }, { timeout: ESPERA })
    expect(screen.getByRole('button', { name: /pin D1 .*5\.800 \(2 de 3\)\s*$/ })).toBeInTheDocument()
    fireEvent.click(pinExito)
    const ir = await screen.findByRole('link', { name: 'Ir en Google Maps' })
    // Sin punto de partida: Google Maps parte de donde esté la persona (y el enlace no dice dónde estaba).
    expect(ir.getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=11.600000%2C-72.900000')
    expect(ir).toHaveAttribute('target', '_blank')
    expect(ir).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getAllByRole('link', { name: 'Waze' }).map((a) => a.getAttribute('href'))).toContain('https://waze.com/ul?ll=11.600000,-72.900000&navigate=yes')
  })
})

describe('Mapa · ruta de hoy', () => {
  it('ordena las paradas desde donde estás y arma el enlace con la parada intermedia', async () => {
    await conLista()
    await conSedes([sede('d1', 'D1', 11.5, -72.9, 'D1 Calle 15'), sede('ex', 'EXITO', 11.6, -72.9, 'Éxito Centro')])
    ubicadoEn(11.49, -72.9)
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mi ubicación' }, { timeout: ESPERA }))
    await waitFor(() => expect(screen.getByTestId('mapa')).toHaveAttribute('data-yo', 'si'))
    const paradas = screen.getAllByRole('listitem').filter((li) => /^\d\./.test((li.textContent ?? '').trim()))
    expect(paradas[0]).toHaveTextContent(/1\. D1/)
    expect(paradas[1]).toHaveTextContent(/2\. Éxito/)
    expect(screen.getByText(/Recorrido aproximado/)).toBeInTheDocument()
    // Cuánto se gasta en cada parada y cuánto se ahorra frente a la mejor tienda única.
    expect(paradas[0]).toHaveTextContent(/\$\s*1\.000/)
    expect(paradas[1]).toHaveTextContent(/\$\s*13\.500/)
    expect(screen.getByText(/Ahorras \$\s*4\.000 frente a comprar todo en Éxito/)).toBeInTheDocument()
    const abrir = screen.getByRole('link', { name: 'Abrir ruta en Google Maps' })
    const url = new URL(abrir.getAttribute('href')!)
    expect(url.searchParams.has('origin')).toBe(false)
    expect(url.searchParams.get('waypoints')).toBe('11.500000,-72.900000')
    expect(url.searchParams.get('destination')).toBe('11.600000,-72.900000')
  })

  it('desde el otro lado, el orden se invierte; y compartir manda el mensaje con el enlace', async () => {
    await conLista()
    await conSedes([sede('d1', 'D1', 11.5, -72.9, 'D1 Calle 15'), sede('ex', 'EXITO', 11.6, -72.9, 'Éxito Centro')])
    ubicadoEn(11.61, -72.9)
    const compartido: string[] = []
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { text: string }) => { compartido.push(d.text) } })
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mi ubicación' }, { timeout: ESPERA }))
    await waitFor(() => expect(screen.getByTestId('mapa')).toHaveAttribute('data-yo', 'si'))
    const paradas = screen.getAllByRole('listitem').filter((li) => /^\d\./.test((li.textContent ?? '').trim()))
    expect(paradas[0]).toHaveTextContent(/1\. Éxito/)
    fireEvent.click(screen.getByRole('button', { name: 'Compartir ruta' }))
    await waitFor(() => expect(compartido).toHaveLength(1))
    expect(compartido[0]).toContain('Ruta de mercado')
    expect(compartido[0]).toMatch(/1\. \*Éxito\*/)
    expect(compartido[0]).toMatch(/2\. \*D1\*/)
    expect(compartido[0]).toContain('https://www.google.com/maps/dir/?api=1')
    // Lo que se comparte no lleva dónde estabas tú.
    expect(compartido[0]).not.toContain('origin=')
    expect(compartido[0]).not.toContain('11.61')
  })

  it('si falta la sede de una tienda del plan, lo dice', async () => {
    await conLista()
    await conSedes([sede('ex', 'EXITO', 11.6, -72.9)])
    render(<Mapa />)
    expect(await screen.findByText(/Falta la sede de D1/, {}, { timeout: ESPERA })).toBeInTheDocument()
  })

  it('un permiso de ubicación negado se explica, sin romper nada', async () => {
    await conLista()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_: unknown, mal: (e: { code: number }) => void) => mal({ code: 1 }) } })
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mi ubicación' }, { timeout: ESPERA }))
    expect(await screen.findByText(/No tengo permiso para ver dónde estás/)).toBeInTheDocument()
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-yo', 'no')
  })
})

describe('Mapa · sedes', () => {
  it('"Estoy en una tienda" guarda la sede donde estás, con la tienda que elijas; y se sincroniza con la cuenta', async () => {
    ubicadoEn(11.5444, -72.9072)
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Estoy en una tienda' }, { timeout: ESPERA }))
    expect(await screen.findByRole('dialog', { name: '¿Qué tienda es?' })).toBeInTheDocument()
    const guardar = screen.getByRole('button', { name: 'Guardar sede' })
    expect(guardar).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'D1' }))
    fireEvent.change(screen.getByLabelText(/Nombre o barrio/), { target: { value: 'Calle 15' } })
    fireEvent.click(guardar)
    await waitFor(async () => expect(await sedesGuardadas()).toHaveLength(1))
    expect((await sedesGuardadas())[0]).toMatchObject({ tienda: 'D1', nombre: 'Calle 15', lat: 11.5444, lng: -72.9072 })
    // Va a la cola de sincronización como un cambio de la configuración.
    expect((await db.outbox.toArray()).some((e) => JSON.stringify(e.payload).includes('"sede.'))).toBe(true)
  })

  it('"Marcar en el mapa" espera un toque y abre la elección de tienda con ese punto', async () => {
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar en el mapa' }, { timeout: ESPERA }))
    expect(screen.getByText(/Toca en el mapa el lugar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'tocar el mapa' }))
    expect(await screen.findByRole('dialog', { name: '¿Qué tienda es?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Olímpica' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar sede' }))
    await waitFor(async () => expect(await sedesGuardadas()).toHaveLength(1))
    expect((await sedesGuardadas())[0]).toMatchObject({ tienda: 'OLIMPICA', lat: 11.5, lng: -72.91 })
    expect(screen.queryByText(/Toca en el mapa el lugar/)).toBeNull()
  })

  it('la hoja de guardar sede no se cierra con un toque afuera (se perdería el punto y lo escrito)', async () => {
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar en el mapa' }, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('button', { name: 'tocar el mapa' }))
    const hoja = await screen.findByRole('dialog', { name: '¿Qué tienda es?' })
    fireEvent.click(hoja.parentElement!) // el fondo oscuro
    expect(screen.getByRole('dialog', { name: '¿Qué tienda es?' })).toBeInTheDocument()
  })

  it('avisa si la ubicación de GPS es poco precisa antes de guardar', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 11.5, longitude: -72.9, accuracy: 850 } }) } })
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Estoy en una tienda' }, { timeout: ESPERA }))
    expect(await screen.findByText(/poco precisa \(±850 m\)/)).toBeInTheDocument()
    expect(screen.getByText(/Se guarda este punto en tu cuenta/)).toBeInTheDocument()
  })

  it('al llegar al máximo de sedes no guarda otra y lo dice', async () => {
    for (let i = 0; i < MAX_SEDES; i++) await guardarConfig(claveSede(`s${i}`), valorSede(sede(`s${i}`, 'D1', 11 + i * 0.0001, -72.9)))
    expect(await agregarSede('ARA', { lat: 11.3, lng: -72.8 })).toBeNull()
    expect((await sedesGuardadas()).length).toBe(MAX_SEDES)
  })

  it('dos celulares que agregan sedes a la vez no se pisan: cada sede es su propia fila', async () => {
    const a = await agregarSede('D1', { lat: 11.5, lng: -72.9 }, 'Calle 15')
    const b = await agregarSede('EXITO', { lat: 11.6, lng: -72.9 }, 'Centro')
    const claves = (await db.config.toArray()).map((f) => f.clave).filter((c) => c.startsWith('sede.'))
    expect(new Set(claves).size).toBe(2)
    expect(claves).toContain(claveSede(a!.id))
    expect(claves).toContain(claveSede(b!.id))
  })

  it('"Buscar sedes cerca" trae las de OpenStreetMap y no repite las que ya están', async () => {
    const respuesta = { elements: [
      { type: 'node', id: 1, lat: 11.5444, lon: -72.9072, tags: { name: 'Tiendas D1', shop: 'supermarket' } },
      { type: 'way', id: 2, center: { lat: 11.55, lon: -72.91 }, tags: { name: 'Éxito', shop: 'supermarket' } },
    ] }
    const pedidos: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { pedidos.push({ url, body: String(init.body) }); return new Response(JSON.stringify(respuesta)) }))
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar sedes cerca' }, { timeout: ESPERA }))
    await waitFor(async () => expect(await sedesGuardadas()).toHaveLength(2))
    expect(pedidos[0].url).toContain('overpass')
    expect(decodeURIComponent(pedidos[0].body.replace(/\+/g, ' '))).toContain('around:15000,11.54,-72.91') // Riohacha por defecto, redondeado
    fireEvent.click(screen.getByRole('button', { name: 'Buscar sedes cerca' }))
    expect(await screen.findByText('Las sedes que encontré ya estaban guardadas.')).toBeInTheDocument()
    expect(await sedesGuardadas()).toHaveLength(2)
  })

  it('si la búsqueda falla, lo dice y sugiere agregarlas a mano', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar sedes cerca' }, { timeout: ESPERA }))
    expect(await screen.findByText(/No pude buscar las tiendas: sin señal o sin respuesta/)).toBeInTheDocument()
    expect(await sedesGuardadas()).toHaveLength(0)
  })

  it('si el servicio responde 200 pero con una nota de que no pudo terminar, no lo toma por "no hay tiendas"', async () => {
    const llamadas: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { llamadas.push(url); return new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' })) }))
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar sedes cerca' }, { timeout: ESPERA }))
    expect(await screen.findByText(/No pude buscar las tiendas: el servicio está ocupado/)).toBeInTheDocument()
    expect(llamadas).toHaveLength(2) // probó también el servidor de respaldo
    expect(screen.queryByText(/No encontré tiendas/)).toBeNull()
    // Los botones se liberan: se puede volver a intentar.
    expect(screen.getByRole('button', { name: 'Buscar sedes cerca' })).toBeEnabled()
  })

  it('si la búsqueda no encuentra nada, lo explica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }))))
    render(<Mapa />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar sedes cerca' }, { timeout: ESPERA }))
    expect(await screen.findByText(/No encontré tiendas de las cuatro cadenas/)).toBeInTheDocument()
  })

  it('"Quitar" saca la sede de la cuenta', async () => {
    await conSedes([sede('a', 'D1', 11.5, -72.9, 'D1 Calle 15'), sede('b', 'ARA', 11.6, -72.9, 'Ara Norte')])
    render(<Mapa />)
    fireEvent.click(await screen.findByText('Mis sedes (2)', {}, { timeout: ESPERA }))
    fireEvent.click(screen.getByRole('button', { name: 'Quitar D1 D1 Calle 15' }))
    await waitFor(async () => expect((await sedesGuardadas()).map((s) => s.id)).toEqual(['b']))
  })
})

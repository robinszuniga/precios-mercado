import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { isoBogota } from '@shared/fechas.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// La app solo muestra el estado de la conexión cuando hay base de datos en la nube: se simula, sin sesión abierta
// (así la sincronización no hace nada y no toca la red).
vi.mock('../datos/supabase.ts', () => ({
  supabaseConfigurado: true,
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  clienteDeCuenta: () => null,
}))

import { AlCarrito } from '../componentes/AlCarrito.tsx'
import { cargarCatalogo } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
import { agregarALaCompra, asegurarCompra, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from '../datos/escritura.ts'
import { Compra } from '../pantallas/Compra.tsx'
import { Historico } from '../pantallas/Historico.tsx'
import { Lista } from '../pantallas/Lista.tsx'
import { Plan } from '../pantallas/Plan.tsx'
import { EstadoConexion } from './EstadoConexion.tsx'
import { InstalarEnIphone } from './InstalarEnIphone.tsx'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  // sin sesión: la sincronización no hace nada
})
afterEach(() => vi.restoreAllMocks())

describe('primer uso', () => {
  it('la pantalla vacía dice para qué sirve la app', async () => {
    render(<Lista />)
    expect(await screen.findByText(/Compara cuánto cuesta tu mercado/)).toBeInTheDocument()
    expect(screen.getByText(/Éxito, Olímpica, D1 y Ara/)).toBeInTheDocument()
  })

  it('con productos pero sin ningún precio, la lista dice cuál es el siguiente paso', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    render(<Lista />)
    expect(await screen.findByText('Siguiente paso: los precios')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anotar precios en la tienda/ })).toBeInTheDocument()
  })

  it('el Plan sin precios explica por qué no hay total, en vez de mostrar $ 0', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await agregarALaCompra(p, ['D1'])
    render(<Plan />)
    expect(await screen.findByText('Aún no hay precios')).toBeInTheDocument()
    expect(screen.queryByText(/Total con este plan/)).toBeNull()
  })
})

describe('instalar en iPhone', () => {
  const ua = (v: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(v)
  it('en Safari de iPhone avisa que hay que instalarla antes de empezar, y se puede cerrar', async () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    render(<InstalarEnIphone />)
    expect(await screen.findByText(/Añadir a pantalla de inicio/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    await waitFor(() => expect(screen.queryByText(/Añadir a pantalla de inicio/)).toBeNull())
  })

  it('no sale en Android ni en un iPhone donde ya está instalada', async () => {
    ua('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')
    const { container, unmount } = render(<InstalarEnIphone />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('')
    unmount()
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const otro = render(<InstalarEnIphone />)
    await new Promise((r) => setTimeout(r, 50))
    expect(otro.container.textContent).toBe('')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: undefined })
  })
})

describe('en la tienda', () => {
  async function sembrar() {
    const [arroz, leche] = await guardar('Productos', [nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }), nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' })])
    const [pa] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', marca: 'Diana', contenido: 1000 }))
    const [pl] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: leche.producto_id, tienda: 'OLIMPICA', marca: 'Alquería', contenido: 1000 }))
    await registrarPrecioManual(pa, 5000)
    await registrarPrecioManual(pl, 4000)
    await asegurarCompra(['D1', 'OLIMPICA'])
    await agregarALaCompra(arroz, ['D1', 'OLIMPICA'])
    await agregarALaCompra(leche, ['D1', 'OLIMPICA'])
    const c = (await db.compras.toArray())[0]
    await guardar('Compras', { ...c, estado: 'en_curso' })
    return { arroz, leche }
  }

  it('"¿En qué tienda estás?" pliega las otras tiendas y deja abierta la tuya', async () => {
    await sembrar()
    render(<Compra />)
    expect(await screen.findByText('¿En qué tienda estás?')).toBeInTheDocument()
    expect(screen.getByText('Tu compra de hoy')).toBeInTheDocument()
    const grupo = screen.getByText('¿En qué tienda estás?').parentElement!
    fireEvent.click(within(grupo).getByRole('button', { name: /^D1/ }))
    await waitFor(() => expect(screen.getByText(/1 pendientes/)).toBeInTheDocument())
  })

  it('un precio de tienda de más de una semana no se marca con un toque: abre la hoja para confirmarlo', async () => {
    const { arroz } = await sembrar()
    const pa = (await db.presentaciones.where('producto_id').equals(arroz.producto_id).first())!
    const vieja = isoBogota(Date.now() - 12 * 86_400_000 - 3_600_000)
    const actual = (await db.preciosActuales.where('presentacion_id').equals(pa.presentacion_id).first())!
    await db.preciosActuales.put({ ...actual, fecha_observado: vieja, fecha_verificado: vieja })
    render(<Compra />)
    expect(await screen.findByText(/Precio visto hace 12 d: confírmalo/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Arroz como comprado' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect((await db.detalle.toArray()).find((d) => d.producto_id === arroz.producto_id)?.estado).toBe('pendiente')
  })

  it('la hoja de compra tiene una sola cantidad ("Cuántos llevas") y el precio ya tiene el cursor', async () => {
    const { arroz } = await sembrar()
    await cargarCatalogo()
    const d = (await db.detalle.toArray()).find((x) => x.producto_id === arroz.producto_id)!
    const cat = await cargarCatalogo()
    render(<AlCarrito d={d} producto={arroz} cat={cat} tiendasHoy={['D1']} onListo={() => {}} />)
    expect(screen.queryByText('Esta vez necesito')).toBeNull()
    expect(screen.getByLabelText('Cuántos llevas')).toBeInTheDocument()
    expect(screen.getByLabelText('Precio de cada uno')).toHaveAttribute('data-autofocus')
  })
})

describe('compra: barra fija, tachado y agregar directo', () => {
  async function compraConDos() {
    const [arroz, leche] = await guardar('Productos', [nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }), nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' })])
    const [pa] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', marca: 'Diana', contenido: 1000 }))
    const [pl] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: leche.producto_id, tienda: 'D1', marca: 'Alquería', contenido: 1000 }))
    await registrarPrecioManual(pa, 5000)
    await registrarPrecioManual(pl, 4000)
    await asegurarCompra(['D1'])
    await agregarALaCompra(arroz, ['D1'])
    await agregarALaCompra(leche, ['D1'])
    const c = (await db.compras.toArray())[0]
    await guardar('Compras', { ...c, estado: 'en_curso' })
    return { arroz, leche }
  }

  it('la barra de acciones está siempre: Terminar apagado hasta marcar algo, y + Agregar abre la búsqueda', async () => {
    await compraConDos()
    render(<Compra />)
    const terminar = await screen.findByRole('button', { name: /^Terminar/ })
    expect(terminar).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anotar precios en la tienda' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }))
    expect(await screen.findByLabelText('Buscar en tus productos')).toBeInTheDocument()
  })

  it('el producto marcado se queda tachado en su sitio, se puede desmarcar con otro toque y después baja al carrito', async () => {
    await compraConDos()
    render(<Compra />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar Arroz como comprado' }))
    const desmarcar = await screen.findByRole('button', { name: 'Desmarcar Arroz' })
    expect(desmarcar).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Arroz')).toHaveClass('line-through')
    expect(screen.queryByText(/En el carrito \(/)).toBeInTheDocument() // ya cuenta, aunque la tarjeta aún no lo muestre
    await new Promise((r) => setTimeout(r, 1500))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Desmarcar Arroz' })).toBeNull())
    expect(screen.getByText('Arroz')).toBeInTheDocument() // ahora está en la tarjeta del carrito

    // Desmarcar dentro de la ventana de un segundo: vuelve a pendiente.
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Leche como comprado' }))
    await screen.findByRole('button', { name: 'Desmarcar Leche' })
    await new Promise((r) => setTimeout(r, 450))
    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar Leche' }))
    await waitFor(async () => expect((await db.detalle.toArray()).find((d) => d.nombre_libre === '' && d.estado === 'pendiente')).toBeTruthy())
    expect(await screen.findByRole('button', { name: 'Marcar Leche como comprado' })).toBeInTheDocument()
  })

  it('al agregar un producto, su hoja se abre sola con el cursor en el precio', async () => {
    const { arroz, leche } = await compraConDos()
    const d = (await db.detalle.toArray()).find((x) => x.producto_id === leche.producto_id)!
    await guardar('Compras_detalle', { ...d, borrado: true }) // la leche sale de la compra; se vuelve a agregar
    render(<Compra />)
    await screen.findByText('Arroz')
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Leche' }))
    const precio = await screen.findByLabelText('Precio de cada uno', {}, { timeout: 4000 })
    expect(precio).toHaveAttribute('data-autofocus')
    expect(arroz.nombre).toBe('Arroz')
  })
})

describe('pantalla Empezar compra', () => {
  it('sin barra de acciones, los avisos no suben de más; con la compra en curso sí', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await agregarALaCompra(p, ['D1'])
    const valor = () => document.documentElement.style.getPropertyValue('--barra-acciones')
    const { unmount } = render(<Compra />)
    await screen.findByText('Empezar a comprar')
    expect(valor()).toBe('')
    unmount()
    const c = (await db.compras.toArray())[0]
    await guardar('Compras', { ...c, estado: 'en_curso' })
    const otra = render(<Compra />)
    await screen.findByText('Tu compra de hoy')
    // El efecto que fija la barra corre cuando llega la consulta a la base local: se espera, no se asume.
    await waitFor(() => expect(valor()).toBe('4.25rem'))
    otra.unmount()
    expect(valor()).toBe('')
  })
})

describe('historial', () => {
  it('no celebra el ahorro cuando solo se pudo comparar una parte de la compra', async () => {
    await db.compras.put({
      compra_id: 'c1', estado: 'cerrada', fecha_inicio: '2026-09-28T10:00:00.000-05:00', fecha_cierre: '2026-09-28T11:00:00.000-05:00',
      presupuesto: null, tiendas_hoy: 'D1', total_final: 87000, tienda_referencia: 'OLIMPICA', total_referencia: 88400,
      items_comparados: 3, items_total: 4, ahorro: 1400, notas: '', updated_at: '2026-09-28T11:00:00.000-05:00', borrado: false,
    } as never)
    render(<Historico compraId="c1" />)
    expect(await screen.findByText(/Hasta donde pude comparar, ahorraste/)).toBeInTheDocument()
    expect(screen.queryByText(/¡Ahorraste/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Empezar otra compra' })).toBeInTheDocument()
  })
})

describe('señal fantasma (falsa alarma)', () => {
  it('mientras una sincronización está en marcha (la primera, con muchos cambios) no se dice "sin respuesta"', async () => {
    await guardarMeta('estadoSync', { enCurso: true, ultimoOk: null, error: null })
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [] }, intentos: 0, proximo: 0, creado: Date.now() - 60_000 })
    const { container } = render(<EstadoConexion />)
    await new Promise((r) => setTimeout(r, 150))
    expect(container.textContent).toBe('')
  })
})

describe('señal fantasma', () => {
  async function conCola(hace: number) {
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [] }, intentos: 1, proximo: Date.now() + 60_000, creado: Date.now() - hace })
  }

  it('si lo último que marcaste lleva más de 15 segundos sin salir, lo dice', async () => {
    await conCola(20_000)
    render(<EstadoConexion />)
    expect(await screen.findByText(/1 por enviar · sin respuesta de la nube/)).toBeInTheDocument()
  })

  it('si acaba de quedar en la cola, no alarma', async () => {
    await conCola(3_000)
    const { container } = render(<EstadoConexion />)
    await new Promise((r) => setTimeout(r, 150))
    expect(container.textContent).toBe('')
  })
})

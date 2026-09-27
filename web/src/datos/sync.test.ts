import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, guardarMeta } from './db.ts'
import { guardar, nuevoProducto, registrarPrecioManual, nuevaPresentacion } from './escritura.ts'
import { sincronizar } from './sync.ts'

type Llamada = { a: string; cambios?: { tabla: string; fila: Record<string, unknown> }[]; desde?: string | null }

function respuesta(data: unknown, ok = true, error: unknown = null) {
  return new Response(JSON.stringify({ ok, data, error, v: 1, srv: '2026-09-27T10:00:00.000-05:00' }))
}

function servidor(manejar: (c: Llamada) => Response) {
  const llamadas: Llamada[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body)) as Llamada
    llamadas.push(c)
    return manejar(c)
  }))
  return llamadas
}

const pullVacio = () => respuesta({ tablas: {}, cursor: '2026-09-27T09:58:00.000-05:00' })

beforeEach(async () => {
  vi.useRealTimers()
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: 'https://script.google.com/macros/s/x/exec', token: 't' })
})

describe('cola de envíos', () => {
  it('una respuesta ok borra lo enviado y trae lo nuevo', async () => {
    const llamadas = servidor((c) => (c.a === 'upsert' ? respuesta({ resultados: c.cambios!.map((x) => ({ id: x.fila.producto_id, r: 'aplicado' })) }) : pullVacio()))
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    expect(llamadas.map((l) => l.a)).toEqual(['upsert', 'pull'])
    expect(await db.meta.get('cursor')).toMatchObject({ valor: '2026-09-27T09:58:00.000-05:00' })
  })

  it('HTML de Google (resultado desconocido) deja el cambio en la cola para reintentar', async () => {
    servidor(() => new Response('<!doctype html><p>Página no encontrada</p>', { status: 404 }))
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    const [e] = await db.outbox.toArray()
    expect(e).toMatchObject({ intentos: 1 })
    expect(e.proximo).toBeGreaterThan(Date.now())
    expect(e.error).toContain('no es JSON')
  })

  it('un reintento no duplica: el mismo id viaja otra vez y el servidor responde igual', async () => {
    let fallar = true
    const llamadas = servidor((c) => {
      if (c.a === 'pull') return pullVacio()
      if (fallar) { fallar = false; throw new TypeError('Failed to fetch') }
      return respuesta({ resultados: c.cambios!.map((x) => ({ id: x.fila.producto_id, r: 'aplicado' })) })
    })
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    expect(await db.outbox.count()).toBe(1)
    await db.outbox.toCollection().modify({ proximo: 0 })
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    const enviados = llamadas.filter((l) => l.a === 'upsert').flatMap((l) => l.cambios!.map((x) => x.fila.producto_id))
    expect(enviados).toEqual([p.producto_id, p.producto_id])
  })

  it('un error de validación pasa a rechazados y no bloquea la cola', async () => {
    servidor((c) => (c.a === 'upsert' ? respuesta(null, false, { codigo: 'validacion', mensaje: 'máximo 300' }) : pullVacio()))
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    expect((await db.rechazados.toArray())[0].mensaje).toContain('validacion')
  })

  it('un token malo detiene la cola sin perder nada', async () => {
    servidor(() => respuesta(null, false, { codigo: 'token_invalido', mensaje: 'Token inválido' }))
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    expect(await db.outbox.count()).toBe(1)
    expect((await db.meta.get('estadoSync'))?.valor).toMatchObject({ error: expect.stringMatching(/clave \(token\) no coincide/) })
  })

  it('junta varias escrituras en un solo envío', async () => {
    const llamadas = servidor((c) => (c.a === 'upsert' ? respuesta({ resultados: [] }) : pullVacio()))
    for (const n of ['Arroz', 'Aceite', 'Huevos']) await guardar('Productos', nuevoProducto({ nombre: n }))
    await sincronizar()
    expect(llamadas.filter((l) => l.a === 'upsert')).toHaveLength(1)
    expect(llamadas[0].cambios).toHaveLength(3)
  })
})

describe('arranque sin conexión', () => {
  it('si la app arrancó sin backend, al configurarlo sí sincroniza', async () => {
    await guardarMeta('conexion', { url: '', token: '' })
    await sincronizar()
    await guardarMeta('conexion', { url: 'https://script.google.com/macros/s/x/exec', token: 't' })
    const llamadas = servidor(() => pullVacio())
    await sincronizar()
    expect(llamadas.map((l) => l.a)).toEqual(['pull'])
  })
})

describe('pull', () => {
  it('gana el updated_at mayor: no pisa un cambio local más nuevo', async () => {
    const [local] = await guardar('Productos', nuevoProducto({ nombre: 'Local nuevo' }))
    await db.outbox.clear()
    servidor(() => respuesta({
      tablas: {
        Productos: [
          { ...local, nombre: 'Servidor viejo', updated_at: '2020-01-01T00:00:00.000-05:00' },
          { ...nuevoProducto({ nombre: 'Del servidor' }), producto_id: 'srv1', updated_at: '2026-09-27T10:00:00.000-05:00' },
        ],
      },
      cursor: 'c',
    }))
    await sincronizar()
    expect((await db.productos.get(local.producto_id))?.nombre).toBe('Local nuevo')
    expect((await db.productos.get('srv1'))?.nombre).toBe('Del servidor')
  })
})

describe('precios locales', () => {
  it('anotar un precio lo muestra al instante y lo encola como observación', async () => {
    const [p] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: 'x', tienda: 'D1', contenido: 1000 }))
    await registrarPrecioManual(p, 4500)
    const actual = await db.preciosActuales.get(`${p.presentacion_id}|tienda`)
    expect(actual).toMatchObject({ precio: 4500, origen: 'tienda', fuente: 'manual' })
    const cola = await db.outbox.toArray()
    expect(cola.at(-1)?.payload.cambios).toEqual([expect.objectContaining({ tabla: 'Observaciones' })])
  })
})

describe('celular y servidor siempre terminan iguales', () => {
  it('si el servidor tenía una versión más nueva, el celular la toma', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    const vigente = { ...p, nombre: 'Arroz Diana', updated_at: '2099-01-01T00:00:00.000-05:00' }
    servidor((c) => (c.a === 'upsert' ? respuesta({ resultados: [{ id: p.producto_id, r: 'antiguo', tabla: 'Productos', fila: vigente }] }) : pullVacio()))
    await sincronizar()
    expect((await db.productos.get(p.producto_id))?.nombre).toBe('Arroz Diana')
  })

  it('una edición siempre queda con fecha posterior a la que traía la fila (reloj atrasado)', async () => {
    const futuro = '2099-01-01T00:00:00.000-05:00'
    const [p] = await guardar('Productos', { ...nuevoProducto({ nombre: 'Arroz' }), updated_at: futuro })
    const [editado] = await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, updated_at: futuro, nombre: 'Arroz 2' })
    expect(editado.updated_at > futuro).toBe(true)
  })

  it('una lista enorme se envía en tandas de 100 (el servidor no rechaza todo)', async () => {
    await guardar('Productos', Array.from({ length: 250 }, (_, i) => nuevoProducto({ nombre: `P${i}` })))
    const entradas = await db.outbox.toArray()
    expect(entradas.map((e) => (e.payload.cambios as unknown[]).length)).toEqual([100, 100, 50])
  })
})

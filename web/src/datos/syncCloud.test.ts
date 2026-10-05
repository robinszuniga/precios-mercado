import { beforeEach, describe, expect, it, vi } from 'vitest'

// Servidor Supabase falso: guarda lo que se le envía (con `version`, como el trigger real) y sirve páginas con el mismo
// filtro (updated_at, id) que usa la app.
const h = vi.hoisted(() => {
  type Fila = Record<string, unknown>
  type Op = 'select' | 'upsert' | 'update'
  const ID: Record<string, string> = {
    config: 'clave', categorias: 'categoria_id', productos: 'producto_id', presentaciones: 'presentacion_id',
    compras: 'compra_id', compras_detalle: 'detalle_id', compras_resumen: 'clave', precios_actuales: 'clave', precios_historial: 'precio_id',
  }
  const servidor = {
    tablas: new Map<string, Fila[]>(),
    envios: [] as { op: 'upsert' | 'update'; tabla: string; filas: Fila[]; token: string; base?: number }[],
    paginas: [] as { tabla: string; token: string }[],
    rechazar: (_tabla: string, _filas: Fila[]): { message: string; code: string; status: number } | null => null,
    antesDeEnviar: null as null | (() => Promise<void>),
    antesDePagina: null as null | ((tabla: string, n: number) => Promise<void> | void),
    pedidas: 0,
  }
  const sesion = { actual: null as null | { user: { id: string }; access_token: string } }
  const ahora = () => new Date().toISOString().replace('Z', '+00:00')
  function cliente(token: string) {
    return {
      from(tabla: string) {
        const q: { op: Op; gt?: string; or?: string; limit?: number; payload?: Fila[]; ignorar?: boolean; eqs: [string, unknown][]; enIds?: string[] } = { op: 'select', eqs: [] }
        const id = ID[tabla]
        const filasDe = () => { if (!servidor.tablas.has(tabla)) servidor.tablas.set(tabla, []); return servidor.tablas.get(tabla)! }
        const ejecutar = async () => {
          if (q.op === 'upsert') {
            await servidor.antesDeEnviar?.()
            servidor.envios.push({ op: 'upsert', tabla, filas: q.payload!, token })
            const e = servidor.rechazar(tabla, q.payload!)
            if (e) return { data: null, error: { message: e.message, code: e.code }, status: e.status }
            const aceptadas: Fila[] = []
            for (const f of q.payload!) {
              const existente = id ? filasDe().find((x) => x[id] === f[id]) : undefined
              if (existente && q.ignorar) continue
              // Como el trigger de precios_actuales: un precio más viejo que el guardado se ignora sin avisar.
              if (existente && tabla === 'precios_actuales' && Date.parse(f.fecha_verificado as string) < Date.parse(existente.fecha_verificado as string)) continue
              if (existente) Object.assign(existente, f, { updated_at: ahora() })
              else if (id) { const nueva = { user_id: 'u1', ...f, version: 1, updated_at: ahora() }; filasDe().push(nueva); aceptadas.push(nueva) }
            }
            return { data: q.ignorar ? aceptadas.map((x) => ({ [id]: x[id], version: x.version })) : null, error: null, status: 201 }
          }
          if (q.op === 'update') {
            await servidor.antesDeEnviar?.()
            const [fila] = q.payload!
            const version = q.eqs.find(([c]) => c === 'version')![1] as number
            servidor.envios.push({ op: 'update', tabla, filas: [fila], token, base: version })
            const e = servidor.rechazar(tabla, [fila])
            if (e) return { data: null, error: { message: e.message, code: e.code }, status: e.status }
            const objetivo = q.eqs.find(([c]) => c === id)![1]
            const existente = filasDe().find((x) => x[id] === objetivo && x.version === version)
            if (!existente) return { data: [], error: null, status: 200 }
            Object.assign(existente, fila, { version: version + 1, updated_at: ahora() })
            return { data: [{ [id]: existente[id], version: existente.version }], error: null, status: 200 }
          }
          servidor.paginas.push({ tabla, token })
          await servidor.antesDePagina?.(tabla, ++servidor.pedidas)
          let filas = [...filasDe()].sort((a, b) =>
            Date.parse(a.updated_at as string) - Date.parse(b.updated_at as string) || String(a[id]).localeCompare(String(b[id])))
          if (q.enIds) filas = filas.filter((f) => q.enIds!.includes(String(f[id])))
          if (q.or) {
            const m = /^updated_at\.gt\."(.+?)",and\(updated_at\.eq\."(.+?)",(\w+)\.gt\."(.+?)"\)$/.exec(q.or)
            if (!m) throw new Error(`filtro or inesperado: ${q.or}`)
            const [, marca, marca2, col, ultimo] = m
            if (marca !== marca2 || col !== id) throw new Error(`filtro or inconsistente: ${q.or}`)
            filas = filas.filter((f) => {
              const d = Date.parse(f.updated_at as string) - Date.parse(marca)
              return d > 0 || (d === 0 && String(f[id]) > ultimo)
            })
          } else if (q.gt) filas = filas.filter((f) => Date.parse(f.updated_at as string) > Date.parse(q.gt!))
          return { data: filas.slice(0, q.limit ?? filas.length), error: null, status: 200 }
        }
        const b = {
          select: () => b,
          gt: (_c: string, v: string) => { q.gt = v; return b },
          or: (s: string) => { q.or = s; return b },
          in: (_c: string, ids: string[]) => { q.enIds = ids; return b },
          eq: (c: string, v: unknown) => { q.eqs.push([c, v]); return b },
          order: () => b,
          limit: (n: number) => { q.limit = n; return b },
          upsert: (filas: Fila[], opts: { ignoreDuplicates?: boolean } = {}) => { q.op = 'upsert'; q.payload = filas; q.ignorar = opts.ignoreDuplicates; return b },
          update: (fila: Fila) => { q.op = 'update'; q.payload = [fila]; return b },
          then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => ejecutar().then(ok, ko),
        }
        return b
      },
    }
  }
  return { servidor, sesion, cliente }
})

vi.mock('./supabase.ts', () => ({
  supabaseConfigurado: true,
  supabase: { auth: { getSession: async () => ({ data: { session: h.sesion.actual } }) } },
  clienteDeCuenta: (token: string) => h.cliente(token),
}))

import { cerrarCompra } from './cierre.ts'
import { CuentaCambiada, db, usarBaseLocal, invalidarCuenta } from './db.ts'
import { guardar, nuevoProducto, nuevaPresentacion, registrarPrecioManual } from './escritura.ts'
import { actualMasNuevo, clasificarError, ErrorCloud, filaCloud, filaLocalDeCloud, sincronizar } from './sync.ts'

const cuenta = (id: string) => ({ user: { id }, access_token: `token-${id}` })

async function entrarComo(id: string) {
  h.sesion.actual = cuenta(id)
  usarBaseLocal(id)
  await Promise.all(db.tables.map((t) => t.clear()))
}

beforeEach(async () => {
  vi.useRealTimers()
  h.servidor.tablas.clear()
  h.servidor.envios.length = 0
  h.servidor.paginas.length = 0
  h.servidor.rechazar = () => null
  h.servidor.antesDeEnviar = null
  h.servidor.antesDePagina = null
  h.servidor.pedidas = 0
  await entrarComo('u1')
})

const filaProducto = (i: number, extra: Record<string, unknown> = {}) => ({
  user_id: 'u1', producto_id: `p${String(i).padStart(4, '0')}`, nombre: `Producto ${i}`, categoria_id: '', unidad_base: 'g', recurrente: false,
  cantidad_habitual: 1, notas: '', activo: true, marca: '', borrado: false, version: 1,
  updated_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString().replace('Z', '+00:00'), editado_en: null, ...extra,
})

describe('envío a la nube', () => {
  it('las observaciones de precio se sincronizan: solo con sus columnas, junto a los precios actuales', async () => {
    const [p] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: 'x', tienda: 'D1', contenido: 1000 }))
    await registrarPrecioManual(p, 4500)
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    const obs = h.servidor.envios.find((e) => e.tabla === 'observaciones')
    expect(obs).toBeDefined()
    expect(Object.keys(obs!.filas[0]).sort()).toEqual([
      'compra_id', 'disponible', 'fecha_observado', 'fuente', 'obs_id', 'origen', 'precio', 'precio_lista', 'presentacion_id', 'region', 'tienda',
    ])
    expect(h.servidor.envios.some((e) => e.tabla === 'precios_actuales')).toBe(true)
    expect(h.servidor.envios.some((e) => e.tabla === 'precios_historial')).toBe(true)
  })

  it('manda la fecha de edición como editado_en y no toca updated_at ni version (los pone el servidor)', async () => {
    const [prod] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    const fila = h.servidor.envios.find((e) => e.tabla === 'productos')!.filas[0]
    expect(fila.editado_en).toBe(prod.updated_at)
    expect('updated_at' in fila).toBe(false)
    expect('version' in fila).toBe(false)
    expect(filaCloud('Compras', { compra_id: 'c', fecha_cierre: '', updated_at: prod.updated_at }).fila).toMatchObject({ fecha_cierre: null, editado_en: prod.updated_at })
    // Los datos que no se editan a mano no llevan fecha de edición.
    expect('editado_en' in filaCloud('Precios_actuales', { clave: 'k', precio: 1 }).fila).toBe(false)
  })

  it('un cambio que el servidor nunca acepta se rechaza solo, sin frenar ni descartar los demás', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'MALO' }))
    await guardar('Productos', nuevoProducto({ nombre: 'Bueno' }))
    h.servidor.rechazar = (_t, filas) => (filas.some((f) => f.nombre === 'MALO') ? { message: 'violates check constraint', code: '23514', status: 400 } : null)
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    const rechazados = await db.rechazados.toArray()
    expect(rechazados).toHaveLength(1)
    expect(rechazados[0].mensaje).toContain('check constraint')
    // Lo rechazado se conserva para poder recuperarlo a mano.
    expect(JSON.stringify(rechazados[0].payload)).toContain('MALO')
    expect(h.servidor.envios.some((e) => e.filas.some((f) => f.nombre === 'Bueno'))).toBe(true)
    // El aviso se queda hasta que la persona revise la lista de rechazados.
    expect((await db.meta.get('estadoSync'))?.valor).toMatchObject({ error: expect.stringContaining('no fue aceptado') })
  })

  it('un fallo de red se reintenta y se avisa; no se descarta nada', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    h.servidor.rechazar = () => ({ message: 'TypeError: Failed to fetch', code: '', status: 0 })
    await sincronizar()
    expect(await db.rechazados.count()).toBe(0)
    const [e] = await db.outbox.toArray()
    expect(e).toMatchObject({ intentos: 1 })
    expect((await db.meta.get('estadoSync'))?.valor).toMatchObject({ error: expect.stringContaining('Failed to fetch') })
  })

  it('una sesión vencida avisa que hay que entrar de nuevo y conserva los cambios', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    h.servidor.rechazar = () => ({ message: 'JWT expired', code: 'PGRST301', status: 401 })
    await sincronizar()
    expect(await db.outbox.count()).toBe(1)
    expect(await db.rechazados.count()).toBe(0)
    expect((await db.meta.get('estadoSync'))?.valor).toMatchObject({ error: expect.stringContaining('Inicia sesión') })
  })

  it('si lo más viejo de la cola espera un reintento, nada pasa por delante (un producto antes que su presentación)', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Primero' }))
    await guardar('Productos', nuevoProducto({ nombre: 'Segundo' }))
    const [primera] = await db.outbox.orderBy('seq').toArray()
    await db.outbox.update(primera.seq!, { proximo: Date.now() + 60_000 })
    await sincronizar()
    expect(h.servidor.envios).toHaveLength(0)
    expect(await db.outbox.count()).toBe(2)
  })
})

describe('versiones y conflictos', () => {
  const guardarLocal = async (nombre: string, version: number) => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre }))
    await db.productos.update(p.producto_id, { version } as never)
    await db.outbox.clear()
    return p
  }

  it('una fila nueva queda con la versión del servidor; la siguiente edición se envía sobre esa versión', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    expect(h.servidor.envios.find((e) => e.tabla === 'productos')).toMatchObject({ op: 'upsert' })
    expect(((await db.productos.get(p.producto_id)) as { version?: number }).version).toBe(1)
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Arroz 2' })
    await sincronizar()
    const edicion = h.servidor.envios.filter((e) => e.tabla === 'productos').at(-1)!
    expect(edicion).toMatchObject({ op: 'update', base: 1 })
    expect(h.servidor.tablas.get('productos')![0]).toMatchObject({ nombre: 'Arroz 2', version: 2 })
    expect(((await db.productos.get(p.producto_id)) as { version?: number }).version).toBe(2)
  })

  it('si otro celular cambió la fila antes y su edición es más nueva, gana el servidor y se guarda aquí enseguida', async () => {
    const p = await guardarLocal('Mío', 1)
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: p.producto_id, nombre: 'Del servidor', version: 2, editado_en: '2099-01-01T00:00:00+00:00' })])
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Mío editado' })
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    const local = (await db.productos.get(p.producto_id)) as unknown as { nombre: string; version: number }
    expect(local).toMatchObject({ nombre: 'Del servidor', version: 2 })
    expect(h.servidor.tablas.get('productos')![0]).toMatchObject({ nombre: 'Del servidor', version: 2 })
    expect(h.servidor.envios.filter((e) => e.op === 'update')).toHaveLength(1)
  })

  it('si lo de este celular se editó después, se reenvía sobre la versión nueva del servidor', async () => {
    const p = await guardarLocal('Mío', 1)
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: p.producto_id, nombre: 'Del servidor', version: 2, editado_en: '2020-01-01T00:00:00+00:00' })])
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Mío editado' })
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    const updates = h.servidor.envios.filter((e) => e.op === 'update')
    expect(updates.map((e) => e.base)).toEqual([1, 2])
    expect(h.servidor.tablas.get('productos')![0]).toMatchObject({ nombre: 'Mío editado', version: 3 })
    expect(((await db.productos.get(p.producto_id)) as { version?: number }).version).toBe(3)
  })

  it('un envío que quedó viejo frente a lo local (algo más nuevo llegó de la nube) no se manda', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Viejo' }))
    await db.productos.put({ ...(await db.productos.get(p.producto_id))!, nombre: 'Más nuevo', updated_at: '2099-01-01T00:00:00.000-05:00', version: 2 } as never)
    await sincronizar()
    expect(h.servidor.envios.filter((e) => e.tabla === 'productos')).toHaveLength(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('la misma fila dos veces en un mismo envío se manda una sola vez (la última)', async () => {
    const p = nuevoProducto({ nombre: 'A' })
    await guardar('Productos', [p, { ...p, nombre: 'B' }])
    await sincronizar()
    const envios = h.servidor.envios.filter((e) => e.tabla === 'productos')
    expect(envios).toHaveLength(1)
    expect(envios[0].filas).toHaveLength(1)
    expect(envios[0].filas[0].nombre).toBe('B')
  })

  it('una fila sin cambios pendientes toma la versión nueva del servidor aunque el reloj de quien la escribió vaya atrasado', async () => {
    const p = await guardarLocal('Local', 1)
    await db.productos.update(p.producto_id, { updated_at: '2099-01-01T00:00:00.000-05:00' } as never) // reloj adelantado
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: p.producto_id, nombre: 'Servidor', version: 5, editado_en: '2020-01-01T00:00:00+00:00' })])
    await sincronizar({ completo: true })
    const local = (await db.productos.get(p.producto_id)) as unknown as { nombre: string; version: number }
    expect(local).toMatchObject({ nombre: 'Servidor', version: 5 })
  })

  it('crear un producto, una presentación suya y editar el producto: el producto llega primero, con lo último', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'A' }))
    await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 500 }))
    await guardar('Productos', { ...p, nombre: 'B' })
    await sincronizar()
    const tablas = h.servidor.envios.map((e) => e.tabla)
    expect(tablas.slice(0, 2)).toEqual(['productos', 'presentaciones'])
    expect(h.servidor.envios[0]).toMatchObject({ op: 'upsert' })
    expect(h.servidor.envios[0].filas[0].nombre).toBe('B')
    expect(await db.outbox.count()).toBe(0)
  })

  it('una edición hecha mientras se resolvía un choque no se pisa con la fila del servidor', async () => {
    const id = 'p-choque'
    const fila = (nombre: string, fecha: string) => ({ ...nuevoProducto({ nombre }), producto_id: id, updated_at: fecha })
    await db.productos.put({ ...fila('Viejo', '2026-01-01T00:00:00.000-05:00'), version: 1 } as never)
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [{ tabla: 'Productos', fila: fila('Viejo', '2026-01-01T00:00:00.000-05:00') }] }, intentos: 0, proximo: 0, creado: Date.now() })
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: id, nombre: 'Del servidor', version: 2, editado_en: '2026-06-01T00:00:00+00:00' })])
    let consultas = 0
    let visto = ''
    h.servidor.antesDePagina = async () => {
      consultas++
      if (consultas === 1) {
        // La persona edita otra vez mientras llega la respuesta del servidor.
        const nueva = fila('Editado después', '2026-12-01T00:00:00.000-05:00')
        await db.productos.put({ ...nueva, version: 1 } as never)
        await db.outbox.add({ tipo: 'upsert', payload: { cambios: [{ tabla: 'Productos', fila: nueva }] }, intentos: 0, proximo: 0, creado: Date.now() })
      }
      if (consultas === 2) visto = (await db.productos.get(id))!.nombre
    }
    await sincronizar()
    expect(visto).toBe('Editado después')
    expect(h.servidor.tablas.get('productos')![0].nombre).toBe('Editado después')
  })
})

describe('lo que el servidor ignora o lo que se cancela', () => {
  it('una fila con un cambio pendiente no se reemplaza al descargar, aunque el servidor traiga una versión más nueva', async () => {
    const id = 'p-pendiente'
    const mio = { ...nuevoProducto({ nombre: 'Mío pendiente' }), producto_id: id, updated_at: '2026-01-01T00:00:00.000-05:00' }
    await db.productos.put({ ...mio, version: 1 } as never)
    // El envío queda esperando un reintento: el cambio sigue en la cola mientras se descarga.
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [{ tabla: 'Productos', fila: mio }] }, intentos: 1, proximo: Date.now() + 60_000, creado: Date.now() })
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: id, nombre: 'Del servidor', version: 4, editado_en: '2027-01-01T00:00:00+00:00' })])
    await sincronizar({ completo: true })
    expect(await db.outbox.count()).toBe(1)
    expect(await db.productos.get(id)).toMatchObject({ nombre: 'Mío pendiente', version: 1 })
  })

  it('una fila sin cambios pendientes no vuelve a una versión más vieja del servidor, aunque su fecha de edición sea posterior', async () => {
    const id = 'p-limpio'
    await db.productos.put({ ...nuevoProducto({ nombre: 'Versión 2' }), producto_id: id, updated_at: '2026-01-01T00:00:00.000-05:00', version: 2 } as never)
    h.servidor.tablas.set('productos', [filaProducto(1, { producto_id: id, nombre: 'Versión 1 atrasada', version: 1, editado_en: '2027-01-01T00:00:00+00:00' })])
    await sincronizar({ completo: true })
    expect(await db.productos.get(id)).toMatchObject({ nombre: 'Versión 2', version: 2 })
  })

  it('un precio actual viejo que el servidor ignora no deja el precio local desactualizado (aunque la descarga ya lo haya pasado)', async () => {
    const fila = (precio: number, fecha: string) => ({
      clave: 'pr1|tienda', presentacion_id: 'pr1', tienda: 'D1', origen: 'tienda', fuente: 'manual', precio, precio_lista: null,
      disponible: true, region: '', fecha_observado: fecha, fecha_verificado: fecha,
    })
    // Una copia de respaldo vieja trae un precio viejo; el servidor ya tiene uno más nuevo desde antes del cursor.
    await db.preciosActuales.put(fila(1000, '2026-01-01T00:00:00.000-05:00') as never)
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [{ tabla: 'Precios_actuales', fila: fila(1000, '2026-01-01T00:00:00.000-05:00') }] }, intentos: 0, proximo: 0, creado: Date.now() })
    h.servidor.tablas.set('precios_actuales', [{ user_id: 'u1', ...fila(2000, '2026-06-01T00:00:00+00:00'), updated_at: '2026-06-01T00:00:00+00:00' }])
    await db.meta.put({ clave: 'cursorCloud:precios_actuales', valor: '2026-12-01T00:00:00.000Z' })
    await sincronizar()
    expect(await db.outbox.count()).toBe(0)
    expect((await db.preciosActuales.get('pr1|tienda'))?.precio).toBe(2000)
  })

  it('cerrar una compra cuando la cuenta cambia a medias no escribe nada', async () => {
    const compra = { compra_id: 'c1', estado: 'en_curso', fecha_inicio: '2026-10-05T10:00:00.000-05:00', fecha_cierre: '', updated_at: '2026-10-05T10:00:00.000-05:00', borrado: false } as never
    const cierre = cerrarCompra(compra)
    invalidarCuenta() // la cuenta cambia antes de que el cierre llegue a escribir
    await expect(cierre).rejects.toBeInstanceOf(CuentaCambiada)
    expect(await db.compras.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('clasificación de errores', () => {
  it('separa sesión, permanentes y transitorios', () => {
    expect(clasificarError(new ErrorCloud('x', 'PGRST301', 401))).toBe('sesion')
    expect(clasificarError(new ErrorCloud('new row violates row-level security policy', '42501', 403))).toBe('sesion')
    expect(clasificarError(new ErrorCloud('x', '23514', 400))).toBe('permanente')
    expect(clasificarError(new ErrorCloud('x', '23503', 409))).toBe('permanente')
    expect(clasificarError(new ErrorCloud('x', '22P02', 400))).toBe('permanente')
    expect(clasificarError(new ErrorCloud('Failed to fetch', '', 0))).toBe('transitorio')
    expect(clasificarError(new ErrorCloud('x', '', 503))).toBe('transitorio')
    expect(clasificarError(new ErrorCloud('Otro dispositivo cambió este dato', '', 409))).toBe('transitorio')
    // Falta una columna (migración sin aplicar): se reintenta, no se tira el dato.
    expect(clasificarError(new ErrorCloud('column does not exist', '42703', 400))).toBe('transitorio')
  })
})

describe('descarga de la nube', () => {
  it('descarga por páginas sin saltarse filas aunque una cambie a mitad de la descarga', async () => {
    h.servidor.tablas.set('productos', Array.from({ length: 1200 }, (_, i) => filaProducto(i)))
    // Mientras se pide la segunda página, otra persona edita la primera fila: pasa a ser la más nueva.
    h.servidor.antesDePagina = (tabla, n) => {
      if (tabla === 'productos' && n === 2) h.servidor.tablas.get('productos')![0].updated_at = '2030-01-01T00:00:00+00:00'
    }
    await sincronizar({ completo: true })
    const ids = new Set((await db.productos.toArray()).map((p) => p.producto_id))
    expect(ids.size).toBe(1200)
    expect(ids.has('p0500')).toBe(true)
  })

  it('usa la fecha de edición del celular, conserva la versión y normaliza las fechas a -05:00', async () => {
    h.servidor.tablas.set('productos', [filaProducto(1, { editado_en: '2026-10-05T15:00:00+00:00', updated_at: '2026-10-05T18:00:00+00:00', version: 7 })])
    await sincronizar({ completo: true })
    const p = (await db.productos.toArray())[0] as unknown as Record<string, unknown>
    expect(p.updated_at).toBe('2026-10-05T10:00:00.000-05:00')
    expect(p.version).toBe(7)
    expect('user_id' in p).toBe(false)
    expect('editado_en' in p).toBe(false)
  })

  it('un resumen de compra ya guardado no rompe la descarga (no tiene updated_at local)', async () => {
    await db.resumen.put({ clave: 'c1|D1', compra_id: 'c1', tienda: 'D1', total_hipotetico: 10, items_con_precio: 1, items_total: 1, completo: true, created_at: '2026-10-05T10:00:00.000-05:00' })
    h.servidor.tablas.set('compras_resumen', [{
      user_id: 'u1', clave: 'c1|D1', compra_id: 'c1', tienda: 'D1', total_hipotetico: 10, items_con_precio: 1, items_total: 1, completo: true,
      created_at: '2026-10-05T15:00:00+00:00', updated_at: '2026-10-05T15:00:00+00:00',
    }])
    await sincronizar({ completo: true })
    expect((await db.meta.get('estadoSync'))?.valor).toMatchObject({ error: null })
    expect(await db.meta.get('cursorCloud:compras_resumen')).toBeDefined()
  })

  it('compara instantes, no texto: un precio más viejo en UTC no reemplaza a uno más nuevo en -05:00', () => {
    const local = { fecha_verificado: '2026-10-05T10:00:00.000-05:00' } as never // 15:00 UTC
    expect(actualMasNuevo(local, { fecha_verificado: '2026-10-05T14:00:00+00:00' } as never)).toBe(false)
    expect(actualMasNuevo(local, { fecha_verificado: '2026-10-05T16:00:00+00:00' } as never)).toBe(true)
    expect(actualMasNuevo(undefined, { fecha_verificado: '2026-10-05T14:00:00+00:00' } as never)).toBe(true)
  })

  it('convierte lo que Postgres devuelve al modelo local', () => {
    expect(filaLocalDeCloud({ user_id: 'u', compra_id: 'c', fecha_cierre: null, fecha_inicio: '2026-10-05T15:00:00.123456+00:00' }))
      .toEqual({ compra_id: 'c', fecha_cierre: '', fecha_inicio: '2026-10-05T10:00:00.123-05:00' })
    // Solo las compras tienen fecha_cierre: no se agrega a otras tablas.
    expect('fecha_cierre' in filaLocalDeCloud({ producto_id: 'p' })).toBe(false)
  })
})

describe('cambio de cuenta durante una sincronización', () => {
  const pausa = () => {
    let soltar!: () => void
    const espera = new Promise<void>((r) => { soltar = r })
    return { espera, soltar }
  }
  const hasta = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)) }

  it('los envíos en curso siguen siendo de la cuenta que los empezó y no pasan a la nueva', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'De la cuenta A' }))
    const { espera, soltar } = pausa()
    let primera = true
    h.servidor.antesDeEnviar = async () => { if (primera) { primera = false; await espera } }
    const corriendo = sincronizar()
    await hasta(() => !primera)
    // La persona entra con otra cuenta mientras el envío sigue en vuelo.
    invalidarCuenta()
    h.sesion.actual = cuenta('u2')
    usarBaseLocal('u2')
    const baseB = db
    soltar()
    await corriendo
    expect(h.servidor.envios.every((e) => e.token === 'token-u1')).toBe(true)
    expect(await baseB.productos.count()).toBe(0)
    expect(await baseB.outbox.count()).toBe(0)
  })

  it('lo que se estaba descargando de la cuenta anterior no se escribe en la nueva', async () => {
    h.servidor.tablas.set('productos', [filaProducto(1)])
    const { espera, soltar } = pausa()
    let enPagina = false
    h.servidor.antesDePagina = async () => { enPagina = true; await espera }
    const corriendo = sincronizar({ completo: true })
    await hasta(() => enPagina)
    invalidarCuenta()
    h.sesion.actual = cuenta('u2')
    usarBaseLocal('u2')
    const baseB = db
    h.servidor.antesDePagina = null
    soltar()
    await corriendo
    expect(await baseB.productos.count()).toBe(0)
    expect(await baseB.meta.get('cursorCloud:productos')).toBeUndefined()
  })

  it('no sincroniza si la base local y la sesión son de cuentas distintas (cambio a medias)', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'De la cuenta A' }))
    h.sesion.actual = cuenta('u2') // la sesión ya es de B, pero la base sigue siendo la de A
    await sincronizar()
    expect(h.servidor.envios).toHaveLength(0)
    expect(h.servidor.paginas).toHaveLength(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

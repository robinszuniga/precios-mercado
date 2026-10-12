// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integración: el código real de sincronización contra un Postgres de verdad (PGlite) con las migraciones del proyecto,
 * RLS y los roles `anon` / `authenticated`. Solo se simula la capa HTTP (PostgREST), traduciendo cada llamada de
 * supabase-js al mismo SQL que genera PostgREST. Así se prueba que cliente y base se entienden: columnas, versiones,
 * triggers, llaves foráneas y aislamiento entre cuentas.
 */
const h = vi.hoisted(() => ({
  pg: null as unknown as import('@electric-sql/pglite').PGlite,
  sesion: { actual: null as null | { user: { id: string }; access_token: string } },
}))

const TABLAS_PK: Record<string, string> = {
  config: 'clave', categorias: 'categoria_id', productos: 'producto_id', presentaciones: 'presentacion_id',
  compras: 'compra_id', compras_detalle: 'detalle_id', compras_resumen: 'clave', observaciones: 'obs_id',
  precios_actuales: 'clave', precios_historial: 'precio_id',
}
const columna = (c: string) => { if (!/^[a-z_]+$/.test(c)) throw new Error(`columna inválida ${c}`); return c }
const tabla = (t: string) => { if (!(t in TABLAS_PK)) throw new Error(`tabla inválida ${t}`); return `public.${t}` }
const httpDe = (code?: string) => (!code ? 400 : code === '42501' ? 403 : code.startsWith('23') ? 409 : 400)

function clienteSql(token: string) {
  const uid = token.replace('token-', '')
  /** Cada petición va en su transacción, como el rol `authenticated` con el JWT de la cuenta (igual que PostgREST). */
  const correr = async <T>(fn: (tx: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>) => {
    try {
      const data = await h.pg.transaction(async (tx) => {
        await tx.exec('set local role authenticated')
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
        return fn(tx)
      })
      return { data, error: null, status: 200 }
    } catch (e) {
      const err = e as { message: string; code?: string }
      return { data: null, error: { message: err.message, code: err.code ?? '' }, status: httpDe(err.code) }
    }
  }
  return {
    from(nombre: string) {
      const q: { op: 'select' | 'upsert' | 'update'; gt?: [string, string]; or?: string; limit?: number; payload?: Record<string, unknown>[]; ignorar?: boolean; eqs: [string, unknown][]; enIds?: [string, string[]]; cols?: string } = { op: 'select', eqs: [] }
      const pk = TABLAS_PK[nombre]
      const devolver = () => `returning jsonb_build_object(${(q.cols ?? '').split(',').map((c) => `'${columna(c.trim())}', ${columna(c.trim())}`).join(',')}) as j`
      const ejecutar = () => correr(async (tx) => {
        const t = tabla(nombre)
        if (q.op === 'upsert') {
          const filas = q.payload!
          const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].map(columna)
          const lista = cols.join(',')
          const conflicto = q.ignorar
            ? 'do nothing'
            : `do update set ${cols.filter((c) => c !== 'user_id' && c !== pk).map((c) => `${c} = excluded.${c}`).join(', ')}`
          const sql = `insert into ${t} (${lista}) select ${lista} from jsonb_populate_recordset(null::${t}, $1::jsonb) on conflict (user_id, ${pk}) ${conflicto} ${q.cols ? devolver() : ''}`
          const r = await tx.query(sql, [JSON.stringify(filas)])
          return q.cols ? r.rows.map((x) => x.j) : null
        }
        if (q.op === 'update') {
          const fila = q.payload![0]
          const cols = Object.keys(fila).map(columna)
          const donde = q.eqs.map(([c], i) => `${columna(c)} = $${i + 2}`).join(' and ')
          const sql = `update ${t} set (${cols.join(',')}) = (select ${cols.join(',')} from jsonb_populate_record(null::${t}, $1::jsonb)) where ${donde} ${q.cols ? devolver() : ''}`
          const r = await tx.query(sql, [JSON.stringify(fila), ...q.eqs.map(([, v]) => v)])
          return q.cols ? r.rows.map((x) => x.j) : null
        }
        const params: unknown[] = []
        const filtros: string[] = []
        if (q.enIds) { params.push(q.enIds[1]); filtros.push(`${columna(q.enIds[0])} = any($${params.length}::text[])`) }
        if (q.gt) { params.push(q.gt[1]); filtros.push(`updated_at > $${params.length}::timestamptz`) }
        if (q.or) {
          const m = /^updated_at\.gt\."(.+?)",and\(updated_at\.eq\."(.+?)",(\w+)\.gt\."(.+?)"\)$/.exec(q.or)
          if (!m) throw new Error(`filtro or inesperado: ${q.or}`)
          params.push(m[1], m[4])
          filtros.push(`(updated_at > $${params.length - 1}::timestamptz or (updated_at = $${params.length - 1}::timestamptz and ${columna(m[3])} > $${params.length}))`)
        }
        const sql = `select to_jsonb(x) as j from ${t} x ${filtros.length ? `where ${filtros.join(' and ')}` : ''} order by updated_at, ${pk} ${q.limit ? `limit ${q.limit}` : ''}`
        const r = await tx.query(sql, params)
        return r.rows.map((x) => x.j)
      })
      const b = {
        select: (cols = '*') => { if (cols !== '*') q.cols = cols; return b },
        gt: (c: string, v: string) => { q.gt = [c, v]; return b },
        or: (s: string) => { q.or = s; return b },
        in: (c: string, ids: string[]) => { q.enIds = [c, ids]; return b },
        eq: (c: string, v: unknown) => { q.eqs.push([c, v]); return b },
        order: () => b,
        limit: (n: number) => { q.limit = n; return b },
        upsert: (filas: Record<string, unknown>[], opts: { ignoreDuplicates?: boolean } = {}) => { q.op = 'upsert'; q.payload = filas; q.ignorar = opts.ignoreDuplicates; return b },
        update: (fila: Record<string, unknown>) => { q.op = 'update'; q.payload = [fila]; return b },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => ejecutar().then(ok, ko),
      }
      return b
    },
  }
}

vi.mock('./supabase.ts', () => ({
  supabaseConfigurado: true,
  supabase: { auth: { getSession: async () => ({ data: { session: h.sesion.actual } }) } },
  clienteDeCuenta: (token: string) => clienteSql(token),
}))

import { cerrarCompra } from './cierre.ts'
import { db, guardarMeta, usarBaseLocal } from './db.ts'
import { agregarALaCompra, compraAbierta, eliminarProductos, guardar, guardarConfig, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from './escritura.ts'
import { reenviarRechazados, resubirBase, sincronizar } from './sync.ts'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

async function admin<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await h.pg.query<T>(sql, params)).rows
}
async function entrarComo(uid: string) {
  h.sesion.actual = { user: { id: uid }, access_token: `token-${uid}` }
  usarBaseLocal(uid)
  await Promise.all(db.tables.map((t) => t.clear()))
}
const estadoSync = async () => (await db.meta.get('estadoSync'))?.valor as { error: string | null } | undefined
const versionLocal = async (tabla: 'productos', id: string) => ((await db[tabla].get(id)) as unknown as { version?: number } | undefined)?.version

beforeAll(async () => {
  h.pg = new PGlite()
  await h.pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `)
  const carpeta = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url))
  for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.sql')).sort()) await h.pg.exec(readFileSync(carpeta + f, 'utf8'))
}, 120_000)
afterAll(async () => { await h.pg?.close() })

beforeEach(async () => {
  await h.pg.exec(`truncate public.config, public.categorias, public.productos, public.presentaciones, public.compras, public.compras_detalle,
    public.compras_resumen, public.observaciones, public.precios_actuales, public.precios_historial, public.vtex_rate_limits cascade`)
  await entrarComo(A)
})

describe('app + Postgres real', () => {
  it('producto, presentación y precio: suben en orden, con versiones, sin errores', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
    await registrarPrecioManual(pres, 4500)
    await sincronizar()
    expect((await estadoSync())?.error).toBeNull()
    expect(await db.outbox.count()).toBe(0)
    expect(await db.rechazados.count()).toBe(0)
    const prods = await admin('select producto_id, version, unidad_base from public.productos')
    expect(prods).toEqual([expect.objectContaining({ producto_id: p.producto_id, unidad_base: 'g' })])
    expect(Number(prods[0].version)).toBe(1)
    expect((await admin('select count(*)::int n from public.presentaciones'))[0].n).toBe(1)
    expect((await admin('select count(*)::int n from public.observaciones'))[0].n).toBe(1)
    expect((await admin('select count(*)::int n from public.precios_actuales'))[0].n).toBe(1)
    expect((await admin('select count(*)::int n from public.precios_historial'))[0].n).toBe(1)
    expect(await versionLocal('productos', p.producto_id)).toBe(1)
  })

  it('un producto por unidad (huevos) se guarda: el CHECK acepta "unidad"', async () => {
    await guardar('Productos', nuevoProducto({ nombre: 'Huevos', unidad_base: 'unidad' }))
    await sincronizar()
    expect(await db.rechazados.count()).toBe(0)
    expect((await admin('select unidad_base from public.productos'))[0].unidad_base).toBe('unidad')
  })

  it('editar sube la versión en el servidor y en el celular; sin cambios no se manda nada', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    await sincronizar()
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Arroz Diana' })
    await sincronizar()
    const fila = (await admin('select nombre, version from public.productos'))[0]
    expect(fila.nombre).toBe('Arroz Diana')
    expect(Number(fila.version)).toBe(2)
    expect(await versionLocal('productos', p.producto_id)).toBe(2)
    await sincronizar()
    expect(Number((await admin('select version from public.productos'))[0].version)).toBe(2)
  })

  it('250 productos: suben en tandas y la segunda sincronización no repite nada', async () => {
    await guardar('Productos', Array.from({ length: 250 }, (_, i) => nuevoProducto({ nombre: `P${i}` })))
    await sincronizar()
    expect((await admin('select count(*)::int n from public.productos'))[0].n).toBe(250)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.productos.count()).toBe(250)
  })

  it('dos celulares editan lo mismo: gana la edición más nueva y nadie se queda desactualizado', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Base' }))
    await sincronizar()
    const copiaCelular2 = await db.productos.toArray() // lo que el celular 2 ya tenía descargado (versión 1)

    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Celular 1' })
    await sincronizar()
    expect((await admin('select nombre, version from public.productos'))[0]).toMatchObject({ nombre: 'Celular 1' })

    // Celular 2, sin haber visto lo anterior, edita después (reloj más nuevo).
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.productos.bulkPut(copiaCelular2)
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Celular 2 (más nueva)' })
    await sincronizar()
    const fila = (await admin('select nombre, version from public.productos'))[0]
    expect(fila.nombre).toBe('Celular 2 (más nueva)')
    expect(Number(fila.version)).toBe(3)
    expect(await db.productos.get(p.producto_id)).toMatchObject({ nombre: 'Celular 2 (más nueva)' })
    expect((await estadoSync())?.error).toBeNull()
  })

  it('dos celulares: si la edición de este es más vieja, gana la del servidor y se baja enseguida', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Base' }))
    await sincronizar()
    const copiaCelular2 = await db.productos.toArray()
    await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Celular 1' })
    await sincronizar()

    await Promise.all(db.tables.map((t) => t.clear()))
    await db.productos.bulkPut(copiaCelular2)
    const vieja = { ...(await db.productos.get(p.producto_id))!, nombre: 'Celular 2 (vieja)', updated_at: '2020-01-01T00:00:00.000-05:00' }
    await db.productos.put(vieja)
    await db.outbox.add({ tipo: 'upsert', payload: { cambios: [{ tabla: 'Productos', fila: vieja }] }, intentos: 0, proximo: 0, creado: Date.now() })
    await sincronizar()
    expect((await admin('select nombre, version from public.productos'))[0]).toMatchObject({ nombre: 'Celular 1' })
    expect(await db.productos.get(p.producto_id)).toMatchObject({ nombre: 'Celular 1' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('un celular nuevo (vacío) descarga todo lo de la cuenta', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
    const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 500 }))
    await registrarPrecioManual(pres, 3200)
    await sincronizar()
    await Promise.all(db.tables.map((t) => t.clear())) // celular nuevo
    await sincronizar()
    expect(await db.productos.count()).toBe(1)
    expect(await db.presentaciones.count()).toBe(1)
    expect((await db.preciosActuales.toArray())[0]?.precio).toBe(3200)
    expect(await versionLocal('productos', p.producto_id)).toBe(1)
  })

  it('cada cuenta ve solo lo suyo, aunque usen los mismos ids', async () => {
    const [pa] = await guardar('Productos', nuevoProducto({ nombre: 'De A' }))
    await sincronizar()
    await entrarComo(B)
    expect(await db.productos.count()).toBe(0)
    await sincronizar() // B descarga: no debe traer lo de A
    expect(await db.productos.count()).toBe(0)
    await guardar('Productos', { ...nuevoProducto({ nombre: 'De B' }), producto_id: pa.producto_id }) // mismo id
    await sincronizar()
    const filas = await admin('select user_id, nombre from public.productos order by nombre')
    expect(filas).toEqual([expect.objectContaining({ user_id: A, nombre: 'De A' }), expect.objectContaining({ user_id: B, nombre: 'De B' })])
    await entrarComo(A)
    await sincronizar()
    expect((await db.productos.toArray()).map((x) => x.nombre)).toEqual(['De A'])
  })

  it('cerrar una compra sube compra, detalle, resumen, observaciones y precios', async () => {
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
    const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
    await registrarPrecioManual(pres, 4500)
    const d = await agregarALaCompra(p, ['D1'])
    await guardar('Compras_detalle', {
      ...d, estado: 'en_carrito', presentacion_id: pres.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 4600, subtotal: 4600, precio_confirmado: true,
    })
    const compra = (await compraAbierta())!
    await guardar('Compras', { ...compra, estado: 'en_curso' })
    await cerrarCompra((await compraAbierta())!)
    await sincronizar()
    expect((await estadoSync())?.error).toBeNull()
    expect(await db.rechazados.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect((await admin('select estado, total_final from public.compras'))[0].estado).toBe('cerrada')
    expect((await admin('select count(*)::int n from public.compras_detalle'))[0].n).toBe(1)
    expect((await admin('select count(*)::int n from public.compras_resumen'))[0].n).toBeGreaterThanOrEqual(1)
    expect((await admin('select count(*)::int n from public.observaciones'))[0].n).toBeGreaterThanOrEqual(2)
  })

  describe('una base de la nube a la que le faltan los datos de arriba (el servidor perdió o nunca recibió la presentación)', () => {
    /** El celular cree que ya subió la presentación (versión > 0), pero el servidor no la tiene. */
    async function conPresentacionPerdida() {
      const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
      const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'EXITO', contenido: 1000 }))
      await sincronizar()
      expect(await db.presentaciones.get(pres.presentacion_id)).toMatchObject({ version: 1 })
      await h.pg.exec('delete from public.presentaciones')
      return { p, pres }
    }

    it('un precio nuevo de esa presentación se rechaza por la llave foránea (reproduce el error de la persona)', async () => {
      const { pres } = await conPresentacionPerdida()
      await guardarMeta('reparoFk', Date.now()) // sin la reparación automática, para ver el rechazo
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      const rechazos = await db.rechazados.toArray()
      expect(rechazos.length).toBeGreaterThan(0)
      expect(rechazos[0].mensaje).toMatch(/foreign key constraint "observaciones_user_id_presentacion_id_fkey"/)
    })

    it('la app lo repara sola (una vez cada 6 horas) en cuanto ve el rechazo', async () => {
      const { pres } = await conPresentacionPerdida()
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      await vi.waitFor(async () => {
        expect(await db.rechazados.count()).toBe(0)
        expect(await db.outbox.count()).toBe(0)
        expect((await admin('select count(*)::int n from public.observaciones'))[0].n).toBe(1)
      }, { timeout: 10_000 })
      expect((await admin('select count(*)::int n from public.presentaciones'))[0].n).toBe(1)
    })

    it('si la reparación no alcanza, no se repite en bucle: espera sus 6 horas', async () => {
      const { pres } = await conPresentacionPerdida()
      await guardarMeta('reparoFk', Date.now() - 60_000)
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      await new Promise((r) => setTimeout(r, 300))
      expect(await db.rechazados.count()).toBeGreaterThan(0) // no se tocó
    })

    it('"Reenviar" repara: vuelve a subir lo de arriba y luego los precios rechazados, sin duplicar ni pisar nada', async () => {
      const { p, pres } = await conPresentacionPerdida()
      await guardarMeta('reparoFk', Date.now()) // aquí la repara la persona, no la reparación automática
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      expect(await db.rechazados.count()).toBeGreaterThan(0)

      expect(await reenviarRechazados()).toBeGreaterThan(0)
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
      expect(await admin('select presentacion_id from public.presentaciones')).toEqual([{ presentacion_id: pres.presentacion_id }])
      expect((await admin('select count(*)::int n from public.observaciones'))[0].n).toBe(1)
      expect((await admin('select count(*)::int n from public.precios_actuales'))[0].n).toBe(1)
      // Lo que ya estaba bien no se duplicó ni se tocó.
      expect((await admin('select count(*)::int n from public.productos'))[0].n).toBe(1)
      expect(Number((await admin('select version from public.productos where producto_id = $1', [p.producto_id]))[0].version)).toBe(1)
      // Una segunda vez no cambia nada.
      expect(await reenviarRechazados()).toBe(0)
      expect((await admin('select count(*)::int n from public.presentaciones'))[0].n).toBe(1)
    })
  })

  describe('eliminar productos para siempre', () => {
    async function conArroz() {
      const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', marca: 'Diana' }))
      const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      return { p, pres }
    }
    const cuenta = async (sql: string, params: unknown[] = []) => Number((await admin<{ n: number }>(sql, params))[0].n)

    it('en la nube queda solo la marca y se borran sus presentaciones, observaciones, precio actual e historial', async () => {
      const { p } = await conArroz()
      expect(await cuenta('select count(*)::int n from public.presentaciones')).toBe(1)
      expect(await cuenta('select count(*)::int n from public.precios_historial')).toBe(1)

      await eliminarProductos([p.producto_id])
      await sincronizar()
      expect((await estadoSync())?.error).toBeNull()
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect((await admin('select nombre, marca, borrado, activo from public.productos'))[0]).toEqual({ nombre: '', marca: '', borrado: true, activo: false })
      for (const t of ['presentaciones', 'observaciones', 'precios_actuales', 'precios_historial']) {
        expect(await cuenta(`select count(*)::int n from public.${t}`), t).toBe(0)
      }
    })

    it('lo de la otra cuenta no se toca, aunque use los mismos ids', async () => {
      const { p, pres } = await conArroz()
      await entrarComo(B)
      await guardar('Productos', { ...nuevoProducto({ nombre: 'Arroz de B' }), producto_id: p.producto_id })
      await guardar('Presentaciones', { ...nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }), presentacion_id: pres.presentacion_id })
      await sincronizar()
      await entrarComo(A)
      await sincronizar()
      await eliminarProductos([p.producto_id])
      await sincronizar()
      const deB = await admin('select p.nombre, (select count(*)::int from public.presentaciones x where x.user_id = p.user_id) as pres from public.productos p where p.user_id = $1', [B])
      expect(deB).toEqual([{ nombre: 'Arroz de B', pres: 1 }])
    })

    it('un segundo celular que recibe la marca borra también lo suyo, y no vuelve a verlo', async () => {
      const { p, pres } = await conArroz()
      // Celular 2: una copia de todo lo que A tenía descargado.
      const copia = await Promise.all(db.tables.map(async (t) => ({ t, filas: await t.toArray() })))

      await eliminarProductos([p.producto_id])
      await sincronizar()

      await Promise.all(db.tables.map((t) => t.clear()))
      for (const { t, filas } of copia) await t.bulkPut(filas)
      expect(await db.presentaciones.count()).toBe(1) // el celular 2 todavía lo tiene
      await sincronizar()
      expect(await db.presentaciones.get(pres.presentacion_id)).toBeUndefined()
      expect(await db.preciosActuales.where('presentacion_id').equals(pres.presentacion_id).count()).toBe(0)
      expect(await db.historial.where('presentacion_id').equals(pres.presentacion_id).count()).toBe(0)
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: true, nombre: '' })
      await sincronizar()
      expect((await estadoSync())?.error).toBeNull()
    })

    it('un celular nuevo descarga la marca de eliminado pero nada de sus datos', async () => {
      const { p } = await conArroz()
      await eliminarProductos([p.producto_id])
      await sincronizar()
      await Promise.all(db.tables.map((t) => t.clear()))
      await sincronizar()
      expect(await db.productos.count()).toBe(1)
      expect((await db.productos.toArray())[0]).toMatchObject({ borrado: true, nombre: '' })
      expect(await db.presentaciones.count()).toBe(0)
      expect(await db.preciosActuales.count()).toBe(0)
    })

    it('no se puede des-eliminar desde la base: borrado se queda en verdadero y los datos vacíos', async () => {
      const { p } = await conArroz()
      await eliminarProductos([p.producto_id])
      await sincronizar()
      await h.pg.exec(`update public.productos set borrado = false, nombre = 'Resucitado', activo = true where producto_id = '${p.producto_id}'`)
      expect((await admin('select nombre, borrado, activo from public.productos'))[0]).toEqual({ nombre: '', borrado: true, activo: false })
    })
  })
  describe('auditoría: filas mixtas y eliminaciones entre celulares', () => {
    const cuenta = async (sql: string, params: unknown[] = []) => Number((await admin<{ n: number }>(sql, params))[0].n)
    const instantanea = () => Promise.all(db.tables.map(async (t) => ({ t, filas: await t.toArray() })))
    const restaurar = async (copia: Awaited<ReturnType<typeof instantanea>>) => {
      await Promise.all(db.tables.map((t) => t.clear()))
      for (const { t, filas } of copia) await t.bulkPut(filas)
    }
    /** Arroz con una presentación y un precio, ya en la nube. */
    async function arroz() {
      const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', marca: 'Diana' }))
      const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(pres, 4500)
      await sincronizar()
      return { p, pres }
    }
    /** El «celular 1» (el estado actual) elimina el producto y sincroniza; después se vuelve al estado del «celular 2». */
    async function eliminaOtroCelular(id: string, celular2: Awaited<ReturnType<typeof instantanea>>) {
      await eliminarProductos([id])
      await sincronizar()
      await restaurar(celular2)
    }

    it('productos bajados de la nube y productos creados aquí suben juntos a una base vacía (resubirBase)', async () => {
      const { p } = await arroz()
      await Promise.all(db.tables.map((t) => t.clear()))
      await sincronizar() // baja Arroz, que trae `borrado: false`
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: false })
      await guardar('Productos', nuevoProducto({ nombre: 'Leche' })) // creado aquí: sin la clave `borrado`
      await sincronizar()
      await h.pg.exec('truncate public.productos cascade') // la base se reinstaló vacía
      expect(await resubirBase()).toBeGreaterThan(0)
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
      expect((await admin('select nombre from public.productos order by nombre')).map((x) => x.nombre)).toEqual(['Arroz', 'Leche'])
      expect(await cuenta('select count(*)::int n from public.presentaciones')).toBe(1)
    })

    it('celular 2 edita (después) un producto que el celular 1 eliminó: pierde, y queda eliminado también ahí (sin zombi)', async () => {
      const { p } = await arroz()
      const celular2 = await instantanea()
      await eliminaOtroCelular(p.producto_id, celular2)
      expect(await db.presentaciones.count()).toBe(1) // el celular 2 aún no se entera
      await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Arroz Diana 2' })
      await sincronizar()
      await sincronizar()
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: true, nombre: '', activo: false })
      expect(await db.presentaciones.count()).toBe(0)
      expect(await db.preciosActuales.count()).toBe(0)
      expect(await db.historial.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect(await db.rechazados.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
      expect((await admin('select nombre, borrado from public.productos'))[0]).toEqual({ nombre: '', borrado: true })
    })

    it('celular 2 editó (antes) y pierde contra la eliminación: se limpia lo dependiente y la cola no se atasca', async () => {
      const { p } = await arroz()
      const celular1 = await instantanea()
      // El celular 2 edita el producto antes de que el 1 lo elimine, pero sincroniza después.
      await guardar('Productos', { ...(await db.productos.get(p.producto_id))!, nombre: 'Arroz 2' })
      const celular2 = await instantanea()
      await restaurar(celular1)
      await eliminarProductos([p.producto_id])
      await sincronizar()
      await restaurar(celular2)
      await sincronizar()
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: true, nombre: '' })
      expect(await db.presentaciones.count()).toBe(0)
      expect(await db.preciosActuales.count()).toBe(0)
      expect(await db.historial.count()).toBe(0)
      // Un producto nuevo llega: nada quedó atascado.
      await guardar('Productos', nuevoProducto({ nombre: 'Leche (después)' }))
      await sincronizar()
      expect(await db.outbox.count()).toBe(0)
      expect(await cuenta(`select count(*)::int n from public.productos where nombre = 'Leche (después)'`)).toBe(1)
      expect((await estadoSync())?.error).toBeNull()
    })

    it('zombi que ya existe (misma versión que la lápida del servidor): la descarga lo corrige', async () => {
      const { p } = await arroz()
      await h.pg.exec(`update public.productos set borrado = true where producto_id = '${p.producto_id}'`)
      const v = Number((await admin('select version from public.productos'))[0].version)
      await db.table('productos').update(p.producto_id, { version: v, nombre: 'Arroz zombi' }) // misma versión, sin `borrado`
      await sincronizar({ completo: true })
      expect(await db.productos.get(p.producto_id)).toMatchObject({ borrado: true, nombre: '' })
      expect(await db.presentaciones.count()).toBe(0)
    })

    it('presentación editada sin señal mientras el otro celular elimina el producto: no resucita en la nube (aun sin el seguro del servidor)', async () => {
      // Se quita el disparador de la migración nueva: lo que protege aquí es el propio celular. La base se comparte entre
      // pruebas, así que se vuelve a instalar al terminar.
      await h.pg.exec('drop trigger if exists presentaciones_de_eliminados on public.presentaciones')
      try {
        const { p, pres } = await arroz()
        const celular1 = await instantanea()
        await guardar('Presentaciones', { ...(await db.presentaciones.get(pres.presentacion_id))!, contenido: 500 })
        const celular2 = await instantanea()
        await restaurar(celular1)
        await eliminarProductos([p.producto_id])
        await sincronizar()
        await restaurar(celular2)
        await sincronizar()
        await sincronizar()
        expect(await cuenta('select count(*)::int n from public.presentaciones')).toBe(0)
        expect(await db.presentaciones.count()).toBe(0)
        expect(await db.outbox.count()).toBe(0)
        expect(await db.rechazados.count()).toBe(0)
      } finally {
        await h.pg.exec(readFileSync(new URL('../../../supabase/migrations/20261012000100_presentaciones_de_eliminados.sql', import.meta.url), 'utf8'))
      }
    })

    it('con el seguro del servidor: presentación y precio nuevos, anotados sin señal en un producto eliminado, no dejan nada colgando ni avisos rojos', async () => {
      const { p } = await arroz()
      const celular1 = await instantanea()
      const [pres2] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: p.producto_id, tienda: 'EXITO', contenido: 500 }))
      await registrarPrecioManual(pres2, 2500)
      const celular2 = await instantanea()
      await restaurar(celular1)
      await eliminarProductos([p.producto_id])
      await sincronizar()
      await restaurar(celular2)
      await sincronizar()
      await sincronizar()
      for (const t of ['presentaciones', 'observaciones', 'precios_actuales', 'precios_historial']) {
        expect(await cuenta(`select count(*)::int n from public.${t}`), t).toBe(0)
      }
      expect(await db.presentaciones.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect(await db.rechazados.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
    })

    it('el servidor no acepta presentaciones nuevas de un producto eliminado (RAISE 23503)', async () => {
      const { p } = await arroz()
      await eliminarProductos([p.producto_id])
      await sincronizar()
      await expect(h.pg.exec(`insert into public.presentaciones (user_id, presentacion_id, producto_id, tienda) values ('${A}', 'x1', '${p.producto_id}', 'D1')`)).rejects.toThrow(/eliminado/i)
    })

    it('cerrar una compra con un producto que otro celular eliminó: se guarda todo lo demás y nada queda rechazado', async () => {
      const [pa] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
      const [prA] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: pa.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(prA, 4500)
      const [pl] = await guardar('Productos', nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' }))
      const [prL] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: pl.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(prL, 3000)
      const dA = await agregarALaCompra(pa, ['D1'])
      const dL = await agregarALaCompra(pl, ['D1'])
      await guardar('Compras_detalle', [
        { ...dA, estado: 'en_carrito', presentacion_id: prA.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 4600, subtotal: 4600, precio_confirmado: true },
        { ...dL, estado: 'en_carrito', presentacion_id: prL.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 3100, subtotal: 3100, precio_confirmado: true },
      ])
      const compra = (await compraAbierta())!
      await guardar('Compras', { ...compra, estado: 'en_curso' })
      await sincronizar()
      const celular2 = await instantanea()
      await eliminarProductos([pa.producto_id])
      await sincronizar()
      await restaurar(celular2) // el celular 2, en la tienda, todavía tiene el arroz
      await cerrarCompra((await compraAbierta())!)
      await sincronizar()
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
      expect((await admin('select estado from public.compras'))[0].estado).toBe('cerrada')
      expect(await cuenta('select count(*)::int n from public.compras_resumen')).toBeGreaterThanOrEqual(1)
      expect(await cuenta('select count(*)::int n from public.observaciones where presentacion_id = $1', [prL.presentacion_id])).toBeGreaterThanOrEqual(2)
      expect(await cuenta('select count(*)::int n from public.observaciones where presentacion_id = $1', [prA.presentacion_id])).toBe(0)
    })
  })
  describe('re-auditoría: eliminaciones entre celulares, segunda vuelta', () => {
    const cuenta = async (sql: string, params: unknown[] = []) => Number((await admin<{ n: number }>(sql, params))[0].n)
    const instantanea = () => Promise.all(db.tables.map(async (t) => ({ t, filas: await t.toArray() })))
    const restaurar = async (copia: Awaited<ReturnType<typeof instantanea>>) => {
      await Promise.all(db.tables.map((t) => t.clear()))
      for (const { t, filas } of copia) await t.bulkPut(filas)
    }
    /** Arroz y leche, cada uno con presentación y precio, ya en la nube; ambos en una compra en curso con el carrito marcado. */
    async function compraConArrozYLeche() {
      const [pa] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', unidad_base: 'g' }))
      const [prA] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: pa.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(prA, 4500)
      const [pl] = await guardar('Productos', nuevoProducto({ nombre: 'Leche', unidad_base: 'ml' }))
      const [prL] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: pl.producto_id, tienda: 'D1', contenido: 1000 }))
      await registrarPrecioManual(prL, 3000)
      const dA = await agregarALaCompra(pa, ['D1'])
      const dL = await agregarALaCompra(pl, ['D1'])
      await guardar('Compras_detalle', [
        { ...dA, estado: 'en_carrito', presentacion_id: prA.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 4600, subtotal: 4600, precio_confirmado: true },
        { ...dL, estado: 'en_carrito', presentacion_id: prL.presentacion_id, tienda: 'D1', cantidad: 1, precio_unitario: 3100, subtotal: 3100, precio_confirmado: true },
      ])
      const compra = (await compraAbierta())!
      await guardar('Compras', { ...compra, estado: 'en_curso' })
      await sincronizar()
      return { pa, prA, pl, prL }
    }

    it('una eliminación hecha sin señal gana aunque otro celular haya editado después el mismo producto', async () => {
      const { pa } = await compraConArrozYLeche()
      const celular1 = await instantanea()
      await eliminarProductos([pa.producto_id]) // el celular 2 elimina sin señal
      const celular2 = await instantanea()
      await restaurar(celular1)
      await guardar('Productos', { ...(await db.productos.get(pa.producto_id))!, nombre: 'Arroz editado por 1' })
      await sincronizar() // el celular 1 sube su edición (más nueva)
      await restaurar(celular2)
      await sincronizar()
      await sincronizar()
      expect((await admin('select nombre, borrado from public.productos where producto_id = $1', [pa.producto_id]))[0]).toEqual({ nombre: '', borrado: true })
      expect(await cuenta('select count(*)::int n from public.presentaciones where producto_id = $1', [pa.producto_id])).toBe(0)
      expect(await db.productos.get(pa.producto_id)).toMatchObject({ borrado: true, nombre: '' })
      expect(await db.outbox.count()).toBe(0)
      expect(await db.rechazados.count()).toBe(0)
    })

    it('un precio anotado con la presentación vieja en memoria, ya eliminado el producto, no deja huérfanos ni rechazos', async () => {
      const { pa, prA } = await compraConArrozYLeche()
      await eliminarProductos([pa.producto_id])
      await registrarPrecioManual(prA, 5000) // la pantalla seguía con la presentación de antes
      await sincronizar()
      await sincronizar()
      expect(await db.preciosActuales.where('presentacion_id').equals(prA.presentacion_id).count()).toBe(0)
      expect(await db.historial.where('presentacion_id').equals(prA.presentacion_id).count()).toBe(0)
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect((await estadoSync())?.error).toBeNull()
    })

    it('un envío con precios de una presentación que este celular ya no tiene se recorta: el resto del cierre llega', async () => {
      const { pa, prA, prL } = await compraConArrozYLeche()
      await eliminarProductos([pa.producto_id])
      await sincronizar()
      // Un cierre armado con la lista vieja: trae el precio de una presentación que ya no existe aquí.
      const hoy = new Date().toISOString()
      const compra = (await compraAbierta())!
      const obs = (id: string, precio: number) => ({ obs_id: `x-${id}`, presentacion_id: id, tienda: 'D1', origen: 'tienda', fuente: 'compra', precio, precio_lista: null, disponible: true, region: '', fecha_observado: hoy, compra_id: compra.compra_id })
      const { encolar } = await import('./sync.ts')
      await encolar('cerrarCompra', {
        compra: { ...compra, estado: 'cerrada' }, detalle: [], observaciones: [obs(prA.presentacion_id, 4600), obs(prL.presentacion_id, 3100)],
        resumen: [], preciosActuales: [], preciosHistorial: [],
      })
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect(await cuenta(`select count(*)::int n from public.observaciones where obs_id = 'x-${prL.presentacion_id}'`)).toBe(1)
    })

    it('el cierre de una compra llega completo aunque detrás haya una edición pendiente del producto que otro celular eliminó', async () => {
      const { pa, prL } = await compraConArrozYLeche()
      const celular2 = await instantanea()
      await eliminarProductos([pa.producto_id])
      await sincronizar()
      await restaurar(celular2)
      await guardarMeta('reparoFk', Date.now()) // sin la reparación automática de por medio
      await cerrarCompra((await compraAbierta())!)
      await guardar('Productos', { ...(await db.productos.get(pa.producto_id))!, cantidad_habitual: 3 }) // edición pendiente detrás del cierre
      await sincronizar()
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect(await cuenta('select count(*)::int n from public.compras_resumen')).toBeGreaterThanOrEqual(1)
      expect(await cuenta('select count(*)::int n from public.observaciones where presentacion_id = $1', [prL.presentacion_id])).toBeGreaterThanOrEqual(2)
    })

    it('la línea de compra de un producto eliminado por otro celular sale de la compra abierta', async () => {
      const [pa] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz' }))
      await guardar('Productos', nuevoProducto({ nombre: 'Leche' }))
      await sincronizar()
      const celular1 = await instantanea()
      await eliminarProductos([pa.producto_id])
      await sincronizar()
      await restaurar(celular1)
      const linea = await agregarALaCompra(pa, ['D1']) // el celular 2 lo agrega sin saber que ya no existe
      await sincronizar()
      await sincronizar()
      expect(await db.detalle.get(linea.detalle_id)).toMatchObject({ borrado: true })
    })

    it('en una compra ya cerrada la línea conserva el nombre como texto, aunque el producto lo haya eliminado otro celular', async () => {
      const { pa } = await compraConArrozYLeche()
      const celular2 = await instantanea()
      await eliminarProductos([pa.producto_id])
      await sincronizar()
      await restaurar(celular2)
      const abierta = (await compraAbierta())!
      await cerrarCompra(abierta)
      await sincronizar()
      await sincronizar()
      const lineas = (await db.detalle.toArray()).filter((d) => d.compra_id === abierta.compra_id && !d.borrado)
      expect(lineas.map((d) => d.nombre_libre).sort()).toEqual(['', 'Arroz'])
      expect(lineas.find((d) => d.nombre_libre === 'Arroz')?.producto_id).toBe('')
      expect((await db.compras.get(abierta.compra_id))?.total_final).toBe(7700)
    })

    it('«Reenviar» con la nube vacía sube también la configuración, los resúmenes de compras y los precios actuales', async () => {
      const { prL } = await compraConArrozYLeche()
      await guardarConfig('prueba.clave', 'un valor')
      await cerrarCompra((await compraAbierta())!)
      await sincronizar()
      await guardarMeta('reparoFk', Date.now())
      await h.pg.exec('truncate public.config, public.categorias, public.productos, public.presentaciones, public.compras, public.compras_detalle, public.compras_resumen, public.observaciones, public.precios_actuales, public.precios_historial cascade')
      expect(await resubirBase()).toBeGreaterThan(0)
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect(await cuenta(`select count(*)::int n from public.config where clave = 'prueba.clave'`)).toBe(1)
      expect(await cuenta('select count(*)::int n from public.compras_resumen')).toBeGreaterThanOrEqual(1)
      expect(await cuenta('select count(*)::int n from public.precios_actuales where presentacion_id = $1', [prL.presentacion_id])).toBeGreaterThanOrEqual(1)
    })

    it('lo pendiente que depende de la base va detrás de su resubida, no antes: un precio nuevo no se rechaza', async () => {
      const { prL } = await compraConArrozYLeche()
      await guardarMeta('reparoFk', Date.now())
      await h.pg.exec('truncate public.config, public.categorias, public.productos, public.presentaciones, public.compras, public.compras_detalle, public.compras_resumen, public.observaciones, public.precios_actuales, public.precios_historial cascade')
      await registrarPrecioManual(prL, 3300) // pendiente; depende de la presentación que la nube perdió
      await resubirBase()
      const primera = (await db.outbox.orderBy('seq').first())!
      expect(((primera.payload.cambios as { tabla: string }[])[0]).tabla).not.toBe('Observaciones')
      await sincronizar()
      await sincronizar()
      expect(await db.rechazados.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
      expect(Number((await admin('select precio from public.precios_actuales where presentacion_id = $1 and origen = $2', [prL.presentacion_id, 'tienda']))[0].precio)).toBe(3300)
    })
  })
})


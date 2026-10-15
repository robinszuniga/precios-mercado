import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const raiz = (ruta: string) => fileURLToPath(new URL(`../../../${ruta}`, import.meta.url))
const BASE_VACIA = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
`
const MIGRACION_METRO = '20261014000100_tienda_metro.sql'
const TABLAS = ['presentaciones', 'compras_resumen', 'observaciones', 'precios_actuales', 'precios_historial']
const USUARIO = '00000000-0000-4000-8000-000000000001'

const migraciones = () => readdirSync(raiz('supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()
const texto = (f: string) => readFileSync(raiz(`supabase/migrations/${f}`), 'utf8')

/** Una base como la de la persona antes de Metro: todas las migraciones menos la de Metro. */
async function baseSinMetro() {
  const pg = new PGlite()
  await pg.exec(BASE_VACIA)
  for (const f of migraciones().filter((x) => x !== MIGRACION_METRO)) await pg.exec(texto(f))
  await pg.exec(`insert into auth.users (id) values ('${USUARIO}')`)
  await pg.exec(`insert into public.productos (user_id, producto_id, nombre) values ('${USUARIO}', 'p1', 'Arroz')`)
  return pg
}

const presentacionDe = (tienda: string, id: string) =>
  `insert into public.presentaciones (user_id, presentacion_id, producto_id, tienda) values ('${USUARIO}', '${id}', 'p1', '${tienda}')`

/** Las restricciones que limitan la columna tienda, por tabla. */
async function restriccionesDeTienda(pg: PGlite) {
  const r = await pg.query<{ tabla: string; nombre: string; def: string }>(`
    select k.relname as tabla, c.conname as nombre, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_class k on k.oid = c.conrelid
    where c.contype = 'c' and k.relnamespace = 'public'::regnamespace and k.relname = any($1) and pg_get_constraintdef(c.oid) ~ '^CHECK \\(\\(tienda = ANY'
    order by 1, 2`, [TABLAS])
  return r.rows
}

describe('migración de Metro (supabase/migrations/20261014000100_tienda_metro.sql)', () => {
  it('existe, y es la última: las demás ya estaban aplicadas cuando se escribió', () => {
    expect(migraciones()).toContain(MIGRACION_METRO)
  })

  it('antes rechaza METRO; después lo acepta en las cinco tablas, sigue rechazando valores raros y conserva las demás tiendas', async () => {
    const pg = await baseSinMetro()
    await expect(pg.exec(presentacionDe('METRO', 'x'))).rejects.toThrow(/check|violates/i)
    expect((await restriccionesDeTienda(pg)).map((r) => r.tabla)).toEqual(TABLAS.slice().sort())

    await pg.exec(texto(MIGRACION_METRO))

    const despues = await restriccionesDeTienda(pg)
    expect(despues.map((r) => r.tabla)).toEqual(TABLAS.slice().sort()) // una por tabla, ni de más ni de menos
    for (const r of despues) {
      expect(r.nombre).toBe(`${r.tabla}_tienda_check`)
      for (const t of ['EXITO', 'OLIMPICA', 'D1', 'METRO', 'ARA']) expect(r.def, `${r.tabla} acepta ${t}`).toContain(`'${t}'`)
    }
    for (const t of ['METRO', 'EXITO', 'OLIMPICA', 'D1', 'ARA']) await pg.exec(presentacionDe(t, `ok-${t}`))
    await expect(pg.exec(presentacionDe('JUMBO', 'raro'))).rejects.toThrow(/check|violates/i)
    expect((await pg.query<{ n: number }>(`select count(*)::int n from public.presentaciones`)).rows[0].n).toBe(5)

    // Las otras cuatro tablas con tienda también: una observación de Metro entra.
    await pg.exec(`insert into public.observaciones (user_id, obs_id, presentacion_id, tienda, origen, fuente, precio, region, fecha_observado)
      values ('${USUARIO}', 'o1', 'ok-METRO', 'METRO', 'online', 'auto', 4200, 'DEFAULT', now())`)
    await pg.close()
  }, 120_000)

  it('supabase/diagnostico.sql avisa «tienda sin METRO» en las cinco tablas mientras falte la migración, y deja de avisar al aplicarla', async () => {
    const pg = await baseSinMetro()
    const diagnostico = readFileSync(raiz('supabase/diagnostico.sql'), 'utf8')
    const problemas = async () => (await pg.query<{ tipo: string; nombre: string }>(diagnostico)).rows
    const antes = (await problemas()).filter((f) => f.tipo === 'tienda sin METRO')
    expect(antes.map((f) => f.nombre.split(':')[0]).sort()).toEqual(TABLAS.slice().sort())
    await pg.exec(texto(MIGRACION_METRO))
    const despues = await problemas()
    expect(despues.filter((f) => f.tipo === 'tienda sin METRO')).toEqual([])
    expect(despues.at(-1)).toMatchObject({ tipo: 'resumen' }) // y la base queda sin nada que reportar
    await pg.close()
  }, 120_000)

  it('se puede correr dos veces (y los datos de antes siguen ahí)', async () => {
    const pg = await baseSinMetro()
    await pg.exec(presentacionDe('EXITO', 'antes'))
    await pg.exec(texto(MIGRACION_METRO))
    const primera = await restriccionesDeTienda(pg)
    await pg.exec(texto(MIGRACION_METRO))
    expect(await restriccionesDeTienda(pg)).toEqual(primera)
    expect((await pg.query<{ presentacion_id: string }>(`select presentacion_id from public.presentaciones`)).rows).toEqual([{ presentacion_id: 'antes' }])
    await pg.close()
  }, 120_000)

  it('encuentra las restricciones por lo que dicen, aunque tengan otro nombre (una base armada a mano)', async () => {
    const pg = await baseSinMetro()
    await pg.exec(`alter table public.presentaciones drop constraint presentaciones_tienda_check;
      alter table public.presentaciones add constraint tienda_valida check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA'))`)
    await pg.exec(texto(MIGRACION_METRO))
    const fila = (await restriccionesDeTienda(pg)).filter((r) => r.tabla === 'presentaciones')
    expect(fila).toHaveLength(1) // la de otro nombre se reemplazó, no quedó una vieja que siga rechazando METRO
    await pg.exec(presentacionDe('METRO', 'm'))
    await pg.close()
  }, 120_000)
})

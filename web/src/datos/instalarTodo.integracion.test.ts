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

describe('supabase/instalar_todo.sql (todas las migraciones en un archivo)', () => {
  const todo = readFileSync(raiz('supabase/instalar_todo.sql'), 'utf8')

  it('trae cada migración completa y en orden (si no, hay que volver a correr tools/instalar-supabase.mjs)', () => {
    let desde = 0
    for (const f of readdirSync(raiz('supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
      const texto = readFileSync(raiz(`supabase/migrations/${f}`), 'utf8').trimEnd()
      const en = todo.indexOf(texto, desde)
      expect(en, `${f} no está completa y en orden en instalar_todo.sql`).toBeGreaterThanOrEqual(desde)
      desde = en + texto.length
    }
  })

  it('en una base vacía se instala de una vez; el producto eliminado ya funciona; y una segunda corrida no toca nada', async () => {
    const pg = new PGlite()
    await pg.exec(BASE_VACIA)
    await pg.exec(todo)
    const triggers = (await pg.query<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'public.productos'::regclass and not tgisinternal order by 1`)).rows.map((r) => r.tgname)
    expect(triggers).toEqual(expect.arrayContaining(['productos_eliminar', 'productos_purgar']))
    const tablas = (await pg.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n
    expect(tablas).toBe(11) // las 10 de la app + vtex_rate_limits
    await expect(pg.exec(todo)).rejects.toThrow(/ya existe/)
    expect((await pg.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n).toBe(11)
    await pg.close()
  }, 120_000)
})

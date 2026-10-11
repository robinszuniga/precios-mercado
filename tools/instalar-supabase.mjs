// Junta las migraciones de supabase/migrations/ en un solo archivo para pegarlo una vez en el SQL Editor de una base vacía.
// Uso: node tools/instalar-supabase.mjs   → escribe supabase/instalar_todo.sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const carpeta = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const salida = fileURLToPath(new URL('../supabase/instalar_todo.sql', import.meta.url))

export const ENCABEZADO = `-- Precios de Mercado · instalación completa en una base de Supabase VACÍA (todas las migraciones, en orden).
-- Pégalo entero en SQL Editor → New query → Run. No lo corras dos veces ni en una base que ya tenga estas tablas:
-- si public.productos ya existe, se detiene al instante sin tocar nada.
-- Archivo generado por tools/instalar-supabase.mjs: no se edita a mano; cambia las migraciones y vuelve a generarlo.

do $$
begin
  if to_regclass('public.productos') is not null then
    raise exception 'public.productos ya existe: esta instalación es solo para una base vacía. No se cambió nada.';
  end if;
end
$$;
`

export function armar() {
  const partes = [ENCABEZADO]
  for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.sql')).sort()) {
    partes.push(`-- ===== ${f} =====\n${readFileSync(carpeta + f, 'utf8').trimEnd()}\n`)
  }
  return partes.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(salida, armar())
  console.log('listo: supabase/instalar_todo.sql')
}

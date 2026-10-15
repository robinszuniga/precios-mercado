-- Metro como quinta tienda (precio de internet nacional, vía jumbocolombia.com).
-- La columna `tienda` de estas cinco tablas solo aceptaba EXITO, OLIMPICA, D1 y ARA: sin este cambio, guardar una
-- presentación o un precio de Metro lo rechaza la base y la cola de envío del celular se atasca.
-- Es seguro correrlo más de una vez. No toca datos: solo amplía la lista de valores permitidos.

do $$
declare
  r record;
begin
  -- Las restricciones se buscan por lo que dicen (no por su nombre), así sirve igual en una base creada con las
  -- migraciones o con instalar_todo.sql. Cada una se reemplaza por otra con el mismo nombre y la lista ampliada.
  for r in
    select c.conrelid::regclass as tabla, k.relname as tabla_nombre, c.conname as nombre
    from pg_constraint c
    join pg_class k on k.oid = c.conrelid
    where c.contype = 'c'
      and k.relnamespace = 'public'::regnamespace
      and k.relname in ('presentaciones', 'compras_resumen', 'observaciones', 'precios_actuales', 'precios_historial')
      and pg_get_constraintdef(c.oid) ~ '^CHECK \(\(tienda = ANY'
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.nombre);
    execute format(
      'alter table %s add constraint %I check (tienda in (''EXITO'', ''OLIMPICA'', ''D1'', ''METRO'', ''ARA''))',
      r.tabla, r.tabla_nombre || '_tienda_check'
    );
  end loop;
end
$$;

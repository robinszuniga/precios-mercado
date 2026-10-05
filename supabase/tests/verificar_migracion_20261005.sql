-- Verifica el comportamiento de supabase/migrations/20261005000100_correcciones_revision.sql.
--
-- Cómo usarlo:
--   1. Ejecútalo en una RAMA de Supabase (o un proyecto de prueba), nunca en producción: borra los contadores de cuota.
--   2. Necesita al menos un usuario en auth.users (inicia sesión una vez en la app).
--   3. Termina con un error A PROPÓSITO: eso deshace todo lo que insertó y muestra el resultado en el mensaje.
--      Cada línea dice qué se esperaba; si todas coinciden, la migración se comporta como se diseñó.

do $$
declare
  u uuid := (select id from auth.users limit 1);
  r text := '';
  v bigint;
  n int;
  ok boolean;
begin
  if u is null then raise exception 'Primero crea un usuario (inicia sesión una vez en la app).'; end if;

  -- Unidad y versiones
  insert into public.productos (user_id, producto_id, nombre, unidad_base) values (u, 'zz-p', 'x', 'unidad');
  select version into v from public.productos where user_id = u and producto_id = 'zz-p';
  r := r || format(E'insert -> version %s (esperado 1)\n', v);

  update public.productos set nombre = 'y' where user_id = u and producto_id = 'zz-p' and version = 1;
  get diagnostics n = row_count;
  r := r || format(E'update con version 1 -> %s fila(s) (esperado 1)\n', n);

  update public.productos set nombre = 'z' where user_id = u and producto_id = 'zz-p' and version = 1;
  get diagnostics n = row_count;
  r := r || format(E'update con version vieja -> %s fila(s) (esperado 0)\n', n);

  select version into v from public.productos where user_id = u and producto_id = 'zz-p';
  r := r || format(E'version final %s (esperado 2)\n', v);

  -- Precio actual: uno viejo no debe reemplazar a uno nuevo
  insert into public.presentaciones (user_id, presentacion_id, producto_id, tienda) values (u, 'zz-pr', 'zz-p', 'D1');
  insert into public.precios_actuales (user_id, clave, presentacion_id, tienda, origen, fuente, precio, fecha_observado, fecha_verificado)
    values (u, 'zz-pr|tienda', 'zz-pr', 'D1', 'tienda', 'manual', 2000, '2026-06-01', '2026-06-01');
  insert into public.precios_actuales (user_id, clave, presentacion_id, tienda, origen, fuente, precio, fecha_observado, fecha_verificado)
    values (u, 'zz-pr|tienda', 'zz-pr', 'D1', 'tienda', 'manual', 1000, '2026-01-01', '2026-01-01')
    on conflict (user_id, clave) do update set precio = excluded.precio, fecha_verificado = excluded.fecha_verificado;
  select precio into v from public.precios_actuales where user_id = u and clave = 'zz-pr|tienda';
  r := r || format(E'precio tras subir uno viejo: %s (esperado 2000)\n', v);

  -- Cuota VTEX
  perform set_config('request.jwt.claims', json_build_object('sub', u::text)::text, true);
  delete from public.vtex_rate_limits where bucket_key in ('global', 'user:' || u::text);
  ok := public.consumir_cuota_vtex(100);
  r := r || format(E'cuota 100 -> %s (esperado true)\n', ok::text);
  ok := public.consumir_cuota_vtex(30);
  r := r || format(E'cuota +30 (130 > 120) -> %s (esperado false)\n', ok::text);
  select unidades into v from public.vtex_rate_limits where bucket_key = 'global';
  r := r || format(E'global tras el rechazo: %s (esperado 100, no 130)\n', v);

  raise exception E'RESULTADO (se deshace todo a propósito):\n%', r;
end $$;

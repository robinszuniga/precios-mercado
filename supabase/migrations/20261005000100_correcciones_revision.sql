-- Correcciones de la revisión de los commits de multiusuario y VTEX.
-- Las migraciones anteriores no se editan: pueden estar aplicadas en algún proyecto.

-- 1. La app guarda la unidad como 'unidad', no 'und'. Con el CHECK anterior, un producto por unidad (huevos, limones)
--    no se podía subir y rechazaba todo el lote.
alter table public.productos drop constraint if exists productos_unidad_base_check;
update public.productos set unidad_base = 'unidad' where unidad_base = 'und';
alter table public.productos add constraint productos_unidad_base_check check (unidad_base in ('g', 'ml', 'unidad'));

-- 2. Conflictos entre celulares. Cada fila editable lleva una `version` que solo pone el servidor: 1 al crearla y +1 en
--    cada cambio. El celular dice sobre qué versión se basó su edición (UPDATE ... WHERE version = <esa>): si otro
--    celular cambió la fila antes, la edición no se aplica y el celular lo sabe (no devuelve fila) y lo resuelve.
--    `updated_at` sigue siendo la marca del servidor (cursor de descarga). `editado_en` es la fecha de edición del
--    celular: solo desempata un choque real, no decide qué se acepta.
create or replace function public.set_fila_conflicto()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.set_fila_conflicto() from public, anon, authenticated;

do $$
declare
  tabla text;
begin
  foreach tabla in array array['config', 'categorias', 'productos', 'presentaciones', 'compras', 'compras_detalle'] loop
    execute format('alter table public.%I add column if not exists editado_en timestamptz', tabla);
    execute format('alter table public.%I add column if not exists version bigint not null default 1', tabla);
    execute format('drop trigger if exists %I on public.%I', tabla || '_set_updated_at', tabla);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.set_fila_conflicto()',
      tabla || '_set_updated_at', tabla
    );
  end loop;
end
$$;

-- 2b. Precio actual: un celular sin señal que sube una observación vieja no debe reemplazar un precio más reciente.
create or replace function public.set_precio_actual_conflicto()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new.fecha_verificado < old.fecha_verificado then
    return null;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.set_precio_actual_conflicto() from public, anon, authenticated;

drop trigger if exists precios_actuales_set_updated_at on public.precios_actuales;
create trigger precios_actuales_set_updated_at
  before insert or update on public.precios_actuales
  for each row execute function public.set_precio_actual_conflicto();

-- 3. Cuota de VTEX. Antes cada llamada sumaba al contador global aunque el usuario ya hubiera agotado la suya: una sola
--    cuenta, llamando al RPC en bucle, dejaba sin servicio a todos. Ahora se reserva primero la cuota personal; si está
--    agotada se rechaza sin tocar el contador global, y si el global está lleno se devuelve lo reservado al usuario.
create or replace function public.consumir_cuota_vtex(p_unidades integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ventana bigint := floor(extract(epoch from clock_timestamp()) / 60);
  v_clave text;
  v_user_count integer;
  v_global_count integer;
begin
  if v_user is null or p_unidades is null or p_unidades < 1 or p_unidades > 100 then
    return false;
  end if;
  v_clave := 'user:' || v_user::text;

  insert into public.vtex_rate_limits as actual (bucket_key, ventana, unidades, updated_at)
  values (v_clave, v_ventana, p_unidades, clock_timestamp())
  on conflict (bucket_key) do update
    set ventana = excluded.ventana,
        unidades = case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end,
        updated_at = excluded.updated_at
    where (case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end) <= 120
  returning unidades into v_user_count;

  if v_user_count is null then
    return false;
  end if;

  insert into public.vtex_rate_limits as actual (bucket_key, ventana, unidades, updated_at)
  values ('global', v_ventana, p_unidades, clock_timestamp())
  on conflict (bucket_key) do update
    set ventana = excluded.ventana,
        unidades = case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end,
        updated_at = excluded.updated_at
    where (case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end) <= 1200
  returning unidades into v_global_count;

  if v_global_count is null then
    update public.vtex_rate_limits
      set unidades = greatest(unidades - p_unidades, 0)
      where bucket_key = v_clave and ventana = v_ventana;
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.consumir_cuota_vtex(integer) from public, anon;
grant execute on function public.consumir_cuota_vtex(integer) to authenticated;

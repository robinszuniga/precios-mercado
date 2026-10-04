-- Límites globales y por usuario para evitar que la función de búsquedas sobrecargue las tiendas.
-- La tabla no se expone al navegador; el RPC deriva la identidad del JWT autenticado.
create table public.vtex_rate_limits (
  bucket_key text primary key,
  ventana bigint not null,
  unidades integer not null,
  updated_at timestamptz not null default now()
);

alter table public.vtex_rate_limits enable row level security;
revoke all on table public.vtex_rate_limits from public, anon, authenticated;

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
  v_user_count integer;
  v_global_count integer;
begin
  if v_user is null or p_unidades is null or p_unidades < 1 or p_unidades > 100 then
    return false;
  end if;

  insert into public.vtex_rate_limits as actual (bucket_key, ventana, unidades, updated_at)
  values ('user:' || v_user::text, v_ventana, p_unidades, clock_timestamp())
  on conflict (bucket_key) do update
    set ventana = excluded.ventana,
        unidades = case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end,
        updated_at = excluded.updated_at
  returning unidades into v_user_count;

  insert into public.vtex_rate_limits as actual (bucket_key, ventana, unidades, updated_at)
  values ('global', v_ventana, p_unidades, clock_timestamp())
  on conflict (bucket_key) do update
    set ventana = excluded.ventana,
        unidades = case when actual.ventana = excluded.ventana then actual.unidades + excluded.unidades else excluded.unidades end,
        updated_at = excluded.updated_at
  returning unidades into v_global_count;

  return v_user_count <= 120 and v_global_count <= 1200;
end;
$$;

revoke all on function public.consumir_cuota_vtex(integer) from public, anon;
grant execute on function public.consumir_cuota_vtex(integer) to authenticated;

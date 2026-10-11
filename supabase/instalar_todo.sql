-- Precios de Mercado · instalación completa en una base de Supabase VACÍA (todas las migraciones, en orden).
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

-- ===== 20261003000100_multiusuario.sql =====
-- Primera base de datos multiusuario. Cada fila privada pertenece a una cuenta autenticada.
-- No usar una clave service_role desde la PWA: omite RLS.

create table public.config (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clave text not null,
  valor text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, clave)
);

create table public.categorias (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria_id text not null,
  nombre text not null default '',
  orden numeric not null default 0,
  borrado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, categoria_id)
);

create table public.productos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producto_id text not null,
  nombre text not null default '',
  categoria_id text not null default '',
  unidad_base text not null default 'g' check (unidad_base in ('g', 'ml', 'und')),
  recurrente boolean not null default false,
  cantidad_habitual numeric not null default 1,
  notas text not null default '',
  activo boolean not null default true,
  marca text not null default '',
  borrado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, producto_id)
);

-- categoria_id admite '' en el modelo actual para productos sin categoría.
-- Por eso la integridad de esta relación se valida en la app hasta migrar ese valor a NULL.

create table public.presentaciones (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentacion_id text not null,
  producto_id text not null,
  tienda text not null check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA')),
  nombre_en_tienda text not null default '',
  marca text not null default '',
  contenido numeric,
  granel boolean not null default false,
  sku_id text not null default '',
  ean text not null default '',
  vtex_product_id text not null default '',
  url text not null default '',
  auto boolean not null default false,
  activo boolean not null default true,
  ultimo_error text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, presentacion_id),
  foreign key (user_id, producto_id) references public.productos(user_id, producto_id) on delete cascade
);

create table public.compras (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compra_id text not null,
  estado text not null check (estado in ('borrador', 'en_curso', 'cerrada', 'cancelada')),
  fecha_inicio timestamptz not null,
  fecha_cierre timestamptz,
  presupuesto numeric,
  tiendas_hoy text not null default '',
  total_final numeric,
  tienda_referencia text not null default '',
  total_referencia numeric,
  items_comparados integer,
  items_total integer,
  ahorro numeric,
  notas text not null default '',
  borrado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, compra_id)
);

create table public.compras_detalle (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  detalle_id text not null,
  compra_id text not null,
  producto_id text not null default '',
  nombre_libre text not null default '',
  necesidad numeric,
  presentacion_id text not null default '',
  tienda text not null default '',
  cantidad numeric,
  precio_unitario numeric,
  subtotal numeric,
  estado text not null check (estado in ('pendiente', 'en_carrito', 'no_encontrado')),
  orden numeric not null default 0,
  precio_confirmado boolean not null default false,
  borrado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, detalle_id),
  foreign key (user_id, compra_id) references public.compras(user_id, compra_id) on delete cascade
);

create table public.compras_resumen (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clave text not null,
  compra_id text not null,
  tienda text not null check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA')),
  total_hipotetico numeric not null default 0,
  items_con_precio integer not null default 0,
  items_total integer not null default 0,
  completo boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, clave),
  foreign key (user_id, compra_id) references public.compras(user_id, compra_id) on delete cascade
);

create table public.observaciones (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  obs_id text not null,
  presentacion_id text not null,
  tienda text not null check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA')),
  origen text not null check (origen in ('online', 'tienda')),
  fuente text not null check (fuente in ('auto', 'manual', 'compra')),
  precio numeric check (precio is null or precio >= 0),
  precio_lista numeric check (precio_lista is null or precio_lista >= 0),
  disponible boolean not null default true,
  region text not null default '' check (region in ('', 'RIOHACHA', 'DEFAULT')),
  fecha_observado timestamptz not null,
  compra_id text not null default '',
  primary key (user_id, obs_id),
  foreign key (user_id, presentacion_id) references public.presentaciones(user_id, presentacion_id) on delete cascade
);

create table public.precios_actuales (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clave text not null,
  presentacion_id text not null,
  tienda text not null check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA')),
  origen text not null check (origen in ('online', 'tienda')),
  fuente text not null check (fuente in ('auto', 'manual', 'compra')),
  precio numeric check (precio is null or precio >= 0),
  precio_lista numeric check (precio_lista is null or precio_lista >= 0),
  disponible boolean not null default true,
  region text not null default '' check (region in ('', 'RIOHACHA', 'DEFAULT')),
  fecha_observado timestamptz not null,
  fecha_verificado timestamptz not null,
  primary key (user_id, clave),
  foreign key (user_id, presentacion_id) references public.presentaciones(user_id, presentacion_id) on delete cascade
);

create table public.precios_historial (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  precio_id text not null,
  presentacion_id text not null,
  tienda text not null check (tienda in ('EXITO', 'OLIMPICA', 'D1', 'ARA')),
  origen text not null check (origen in ('online', 'tienda')),
  fuente text not null check (fuente in ('auto', 'manual', 'compra')),
  precio numeric check (precio is null or precio >= 0),
  precio_lista numeric check (precio_lista is null or precio_lista >= 0),
  disponible boolean not null default true,
  region text not null default '' check (region in ('', 'RIOHACHA', 'DEFAULT')),
  fecha_observado timestamptz not null,
  compra_id text not null default '',
  primary key (user_id, precio_id),
  foreign key (user_id, presentacion_id) references public.presentaciones(user_id, presentacion_id) on delete cascade
);

-- RLS on every user table. Policies compare against the authenticated identity, never a client-supplied owner.
create or replace function public.set_fila_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.set_fila_updated_at() from public, anon, authenticated;

do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'config', 'categorias', 'productos', 'presentaciones', 'compras', 'compras_detalle',
    'compras_resumen', 'observaciones', 'precios_actuales', 'precios_historial'
  ] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', tabla);
    execute format('create index if not exists %I on public.%I (user_id, updated_at)', tabla || '_user_updated_idx', tabla);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_fila_updated_at()', tabla || '_set_updated_at', tabla);
    execute format('alter table public.%I enable row level security', tabla);
    execute format('revoke all on table public.%I from anon, authenticated', tabla);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tabla);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', tabla || '_select_own', tabla);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', tabla || '_insert_own', tabla);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', tabla || '_update_own', tabla);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', tabla || '_delete_own', tabla);
  end loop;
end
$$;

-- ===== 20261003000200_limites_vtex.sql =====
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

-- ===== 20261005000100_correcciones_revision.sql =====
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

-- ===== 20261005000200_eliminar_productos.sql =====
-- Eliminar productos para siempre.
-- Las migraciones anteriores no se editan: pueden estar aplicadas en algún proyecto.
--
-- Un producto eliminado (borrado = true) se queda solo como una marca: sin nombre ni datos. La marca sirve para que los
-- otros celulares de la cuenta se enteren (la descargan como cualquier cambio) y dejen de mostrarlo. Sus presentaciones
-- (marcas y tamaños) se borran de verdad, y con ellas, por las llaves foráneas con ON DELETE CASCADE, sus observaciones,
-- su precio actual y su historial de precios. Las compras ya cerradas no se tocan: la app deja el nombre como texto.

-- 1. Antes de guardar: se vacían los datos y no se puede "des-eliminar".
create or replace function public.productos_al_eliminar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and old.borrado then
    new.borrado := true;
  end if;
  if new.borrado then
    new.nombre := '';
    new.notas := '';
    new.marca := '';
    new.activo := false;
    new.recurrente := false;
  end if;
  return new;
end
$$;

revoke all on function public.productos_al_eliminar() from public, anon, authenticated;

drop trigger if exists productos_eliminar on public.productos;
create trigger productos_eliminar
  before insert or update on public.productos
  for each row execute function public.productos_al_eliminar();

-- 2. Después de guardar un producto eliminado: se borran sus presentaciones (y, en cascada, sus precios). Corre con los
--    permisos de quien edita: la política de RLS de `presentaciones` ya limita el borrado a las filas de su cuenta.
create or replace function public.productos_purgar_datos()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  delete from public.presentaciones
   where user_id = new.user_id and producto_id = new.producto_id;
  return null;
end
$$;

revoke all on function public.productos_purgar_datos() from public, anon, authenticated;

drop trigger if exists productos_purgar on public.productos;
create trigger productos_purgar
  after insert or update on public.productos
  for each row when (new.borrado)
  execute function public.productos_purgar_datos();

-- 3. Si ya hubiera productos con la marca (no los hay: la app no la usaba), se limpian ahora.
delete from public.presentaciones p
 using public.productos x
 where x.user_id = p.user_id and x.producto_id = p.producto_id and x.borrado;

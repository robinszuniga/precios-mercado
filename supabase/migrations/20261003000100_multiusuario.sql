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

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

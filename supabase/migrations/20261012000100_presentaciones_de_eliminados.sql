-- Un producto eliminado no puede volver a tener presentaciones (marcas y tamaños).
-- Las migraciones anteriores no se editan: pueden estar aplicadas en algún proyecto.
--
-- Al eliminar un producto, la base borra sus presentaciones (y, en cascada, sus precios). Pero un celular que no se había
-- enterado todavía podía subir después una presentación nueva o editada de ese producto: la llave foránea se cumple (la
-- marca de eliminado sigue ahí) y la presentación resucitaba en la nube y bajaba a todos los celulares.
-- Con este disparador el servidor la rechaza con el código 23503 (llave foránea): la app lo trata como un dato que nunca se
-- aceptará, baja la marca de eliminado y descarta lo que dependía de ese producto.

create or replace function public.presentaciones_de_eliminados()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from public.productos p
     where p.user_id = new.user_id and p.producto_id = new.producto_id and p.borrado
  ) then
    raise exception 'El producto está eliminado: ya no admite presentaciones.' using errcode = '23503';
  end if;
  return new;
end
$$;

revoke all on function public.presentaciones_de_eliminados() from public, anon, authenticated;

drop trigger if exists presentaciones_de_eliminados on public.presentaciones;
create trigger presentaciones_de_eliminados
  before insert or update on public.presentaciones
  for each row execute function public.presentaciones_de_eliminados();

-- Si ya hubiera presentaciones de productos eliminados (se colaron antes de este disparador), se limpian ahora; sus
-- observaciones, precio actual e historial se van en cascada.
delete from public.presentaciones p
 using public.productos x
 where x.user_id = p.user_id and x.producto_id = p.producto_id and x.borrado;

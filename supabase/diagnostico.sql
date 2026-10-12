-- Qué le falta a la base respecto a las migraciones del proyecto. Solo LEE: no cambia nada.
-- Pégalo en SQL Editor → Run. Si la última fila dice "resumen | 0", no falta nada.
with problemas as (
  select 'falta tabla' as tipo, t as nombre
    from unnest(array['config','categorias','productos','presentaciones','compras','compras_detalle','compras_resumen',
                      'observaciones','precios_actuales','precios_historial','vtex_rate_limits']) t
   where to_regclass('public.' || t) is null
  union all
  select 'falta columna', v.t || '.' || v.c
    from (values
      ('config','version'),('config','editado_en'),('categorias','version'),('categorias','editado_en'),
      ('productos','version'),('productos','editado_en'),('productos','marca'),('productos','borrado'),
      ('presentaciones','version'),('presentaciones','editado_en'),
      ('compras','version'),('compras','editado_en'),('compras_detalle','version'),('compras_detalle','editado_en')
    ) as v(t, c)
   where to_regclass('public.' || v.t) is not null
     and not exists (select 1 from information_schema.columns k
                      where k.table_schema = 'public' and k.table_name = v.t and k.column_name = v.c)
  union all
  select 'falta función', f
    from unnest(array['set_fila_updated_at','set_fila_conflicto','set_precio_actual_conflicto','consumir_cuota_vtex',
                      'productos_al_eliminar','productos_purgar_datos','presentaciones_de_eliminados']) f
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = f)
  union all
  select 'falta trigger', v.t || '.' || v.g
    from (values
      ('productos','productos_set_updated_at'),('productos','productos_eliminar'),('productos','productos_purgar'),
      ('presentaciones','presentaciones_set_updated_at'),('presentaciones','presentaciones_de_eliminados'),
      ('precios_actuales','precios_actuales_set_updated_at')
    ) as v(t, g)
   where to_regclass('public.' || v.t) is not null
     and not exists (select 1 from pg_trigger x where x.tgrelid = to_regclass('public.' || v.t) and x.tgname = v.g and not x.tgisinternal)
  union all
  select 'unidad_base sin "unidad"', pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = to_regclass('public.productos') and c.conname = 'productos_unidad_base_check'
     and pg_get_constraintdef(c.oid) not like '%''unidad''%'
  union all
  select 'presentación de un producto eliminado', p.presentacion_id
    from public.presentaciones p
    join public.productos x on x.user_id = p.user_id and x.producto_id = p.producto_id and x.borrado
  union all
  select 'sin RLS', c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
)
select * from problemas
union all
select 'resumen', (select count(*) from problemas)::text
order by 1, 2;

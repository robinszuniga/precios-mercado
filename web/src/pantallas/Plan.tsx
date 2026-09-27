import { useLiveQuery } from 'dexie-react-hooks'
import type { Detalle } from '@shared/esquema.ts'
import { planCompra } from '@shared/recomendacion.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible } from '@shared/unidades.ts'
import { ActualizarPrecios } from '../componentes/ActualizarPrecios.tsx'
import { describirPresentacion } from '../componentes/RegistrarPrecio.tsx'
import { Boton, ChipTienda, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { itemsDelPlan, useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { asegurarCompra, compraAbierta, guardar } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

function nombreDe(cat: Catalogo, d: Detalle) {
  return d.producto_id ? cat.producto.get(d.producto_id)?.nombre ?? '?' : d.nombre_libre
}

function FijarTienda({ d, tiendas }: { d: Detalle; tiendas: Tienda[] }) {
  return (
    <select
      aria-label="Fijar tienda"
      className="rounded-lg border border-stone-200 bg-white px-1 py-0.5 text-xs text-stone-600"
      value={d.tienda}
      onChange={(e) => void guardar('Compras_detalle', { ...d, tienda: e.target.value as Tienda | '' })}
    >
      <option value="">auto</option>
      {tiendas.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
    </select>
  )
}

export function Plan() {
  const cat = useCatalogo()
  const [tiendasHoy, alternar] = useTiendasHoy()
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles }
  }, [])
  if (!cat || !datos) return null
  const { compra, detalles } = datos
  const ahora = ahoraIso()
  const items = itemsDelPlan(cat, detalles, ahora, tiendasHoy)
  const plan = planCompra(items, tiendasHoy, cat.cfg.ahorroMinimoTienda)
  const porId = new Map(detalles.map((d) => [d.detalle_id, d]))
  const libres = detalles.filter((d) => d.estado === 'pendiente' && !d.producto_id)

  return (
    <section className="space-y-3">
      <Titulo>Dónde comprar</Titulo>
      <div>
        <p className="mb-1 text-sm text-stone-600">Tiendas que visito hoy</p>
        <div className="flex flex-wrap gap-2">
          {TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}
        </div>
      </div>
      <ActualizarPrecios />

      {!compra && (
        <Vacio>
          No hay lista abierta.
          <Boton className="mt-3 w-full" onClick={() => void asegurarCompra(tiendasHoy)}>Armar lista con mis recurrentes</Boton>
        </Vacio>
      )}
      {compra && items.length === 0 && libres.length === 0 && <Vacio>La lista está vacía. Agrega productos desde la pestaña Lista (+).</Vacio>}

      {plan.grupos.map((g) => (
        <Tarjeta key={g.tienda}>
          <div className="mb-1 flex items-center justify-between">
            <NombreTienda tienda={g.tienda} className="font-semibold" />
            <span className="font-semibold">{pesos(g.total)}</span>
          </div>
          <ul className="divide-y divide-stone-100 text-sm">
            {g.items.map(({ id, costo }) => {
              const d = porId.get(id)!
              const p = cat.producto.get(d.producto_id)!
              return (
                <li key={id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.nombre}</div>
                    <div className="truncate text-xs text-stone-500">
                      {costo.opcion.presentacion.granel ? `${costo.paquetes} ${etiquetaVisible(p.unidad_base)}` : `${costo.paquetes} ×`} {describirPresentacion(costo.opcion.presentacion, p)}
                      {costo.opcion.efectivo.distintivo !== 'tienda' && ' · online'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span>{pesos(costo.costoReal)}</span>
                    <FijarTienda d={d} tiendas={tiendasHoy} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      ))}

      {(plan.sinPrecio.length > 0 || libres.length > 0) && (
        <Tarjeta>
          <h2 className="mb-1 font-semibold">Sin precio en las tiendas de hoy</h2>
          <ul className="text-sm text-stone-600">
            {plan.sinPrecio.map((id) => {
              const d = porId.get(id)!
              return <li key={id}><a className="underline" href={`#/producto/${encodeURIComponent(d.producto_id)}`}>{nombreDe(cat, d)}</a></li>
            })}
            {libres.map((d) => <li key={d.detalle_id}>{d.nombre_libre}</li>)}
          </ul>
        </Tarjeta>
      )}

      {items.length > 0 && (
        <Tarjeta className="space-y-1 text-sm">
          <div className="flex justify-between text-base font-semibold"><span>Total con este plan</span><span>{pesos(plan.total)}</span></div>
          {plan.todoEn.map((x) => (
            <div key={x.tienda} className="flex justify-between text-stone-600">
              <span>Todo en <NombreTienda tienda={x.tienda} /> {x.items < x.de && <span className="text-xs">({x.items} de {x.de})</span>}</span>
              <span>{x.items ? pesos(x.total) : '—'}</span>
            </div>
          ))}
          {plan.ahorro != null && plan.mejorUnica && (
            <p className={`pt-1 font-medium ${plan.ahorro > 0 ? 'text-ok' : 'text-stone-600'}`}>
              {plan.ahorro > 0
                ? `Ahorras ${pesos(plan.ahorro)} frente a comprar todo en ${INFO_TIENDAS[plan.mejorUnica.tienda].nombre}.`
                : `Lo más conveniente es comprar todo en ${INFO_TIENDAS[plan.mejorUnica.tienda].nombre}.`}
            </p>
          )}
          {compra?.presupuesto != null && (
            <p className={plan.total > compra.presupuesto ? 'text-peligro' : 'text-stone-600'}>
              Presupuesto {pesos(compra.presupuesto)}: {plan.total > compra.presupuesto ? `faltan ${pesos(plan.total - compra.presupuesto)}` : `sobran ${pesos(compra.presupuesto - plan.total)}`}
            </p>
          )}
          <p className="text-xs text-stone-500">Cada tienda extra cuenta {pesos(cat.cfg.ahorroMinimoTienda)} por el viaje (se cambia en Ajustes).</p>
        </Tarjeta>
      )}
      {compra && <a href="#/compra" className="block text-center text-marca">Ir a la compra →</a>}
    </section>
  )
}

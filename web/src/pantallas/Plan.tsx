import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { diasEntre } from '@shared/fechas.ts'
import { planCompra } from '@shared/recomendacion.ts'
import { INFO_TIENDAS, TIENDAS } from '@shared/tiendas.ts'
import { formatoCantidadVisible } from '@shared/unidades.ts'
import { ActualizarPrecios } from '../componentes/ActualizarPrecios.tsx'
import { BotonModoTienda } from '../escaner/ModoTienda.tsx'
import { AvisoSinVincular } from '../componentes/VincularTodos.tsx'
import { HojaItemPlan } from '../componentes/ItemPlan.tsx'
import { describirPresentacion } from '../componentes/RegistrarPrecio.tsx'
import { Boton, Campo, Cargando, ChipTienda, Distintivo, hace, Hoja, leerNumero, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { compartirTexto, textoPlan } from '../datos/compartir.ts'
import { comparadorPasillo, itemsDelPlan, useCatalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { asegurarCompra, compraAbierta, guardar } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'

export function Plan() {
  const cat = useCatalogo()
  const [tiendasHoy, alternar] = useTiendasHoy()
  const [abierto, setAbierto] = useState<string | null>(null)
  const [editandoPresupuesto, setEditandoPresupuesto] = useState(false)
  const datos = useLiveQuery(async () => {
    const compra = await compraAbierta()
    const detalles = compra ? (await db.detalle.where('compra_id').equals(compra.compra_id).toArray()).filter((d) => !d.borrado) : []
    return { compra, detalles }
  }, [])
  if (!cat || !datos) return <Cargando />
  const { compra, detalles } = datos
  const ahora = ahoraIso()
  const items = itemsDelPlan(cat, detalles, ahora, tiendasHoy)
  const plan = planCompra(items, tiendasHoy, cat.cfg.ahorroMinimoTienda)
  const porId = new Map(detalles.map((d) => [d.detalle_id, d]))
  const itemPorId = new Map(items.map((i) => [i.id, i]))
  const libres = detalles.filter((d) => d.estado === 'pendiente' && !d.producto_id)
  const orden = comparadorPasillo(cat)
  const nombre = (id: string) => cat.producto.get(porId.get(id)?.producto_id ?? '')?.nombre ?? '?'
  const dAbierto = abierto ? porId.get(abierto) : undefined
  const pAbierto = dAbierto ? cat.producto.get(dAbierto.producto_id) : undefined
  const tiendaDe = (id: string) => plan.grupos.find((g) => g.items.some((i) => i.id === id))?.tienda
  const ordenados = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => orden(porId.get(a.id)!.producto_id, porId.get(b.id)!.producto_id))

  function enviar() {
    const grupos = plan.grupos.map((g) => ({
      tienda: g.tienda,
      total: g.total,
      lineas: ordenados(g.items).map(({ id, costo }) => {
        const p = cat!.producto.get(porId.get(id)!.producto_id)!
        const cuanto = costo.opcion.presentacion.granel ? formatoCantidadVisible(costo.paquetes, p.unidad_base) : `${costo.paquetes} ×`
        return { nombre: p.nombre, detalle: `${cuanto} ${describirPresentacion(costo.opcion.presentacion, p)}`, costo: costo.costoReal }
      }),
    }))
    // Lo que va sin precio también lleva cuánto se necesita ("Arroz — 5 kg"): quien compra no tiene que adivinarlo.
    const sinPrecio = ordenados(plan.sinPrecio.map((id) => ({ id }))).map((x) => {
      const d = porId.get(x.id)!
      const p = cat!.producto.get(d.producto_id)
      const cuanto = p && d.necesidad != null ? formatoCantidadVisible(d.necesidad, p.unidad_base) : p ? formatoCantidadVisible(p.cantidad_habitual, p.unidad_base) : ''
      return cuanto ? `${nombre(x.id)} — ${cuanto}` : nombre(x.id)
    })
    const sin = [...sinPrecio, ...libres.map((d) => d.nombre_libre)]
    void compartirTexto(textoPlan(grupos, sin, plan.total))
  }

  return (
    <section className="space-y-3">
      <Titulo>Dónde comprar</Titulo>
      <div>
        <p className="mb-1 text-sm text-stone-700">Tiendas que visito hoy</p>
        <div className="flex flex-wrap gap-2">
          {TIENDAS.map((t) => <ChipTienda key={t} tienda={t} activo={tiendasHoy.includes(t)} onClick={() => alternar(t)} />)}
        </div>
      </div>

      {!compra && (
        <Vacio>
          <p>No hay compra armada.</p>
          <Boton className="mt-3 w-full" onClick={() => void asegurarCompra(tiendasHoy)}>Armar compra con mis productos ★</Boton>
        </Vacio>
      )}
      {compra && items.length === 0 && libres.length === 0 && <Vacio>La compra está vacía. Agrega productos desde la pestaña Productos.</Vacio>}

      {items.length > 0 && plan.grupos.length === 0 && (
        <Tarjeta className="space-y-2">
          <h2 className="font-semibold">Aún no hay precios</h2>
          <p className="text-sm text-stone-700">Anota el precio de algunos productos en la tienda o búscalo en internet; aquí verás dónde conviene comprar cada cosa.</p>
        </Tarjeta>
      )}
      {items.length > 0 && plan.grupos.length > 0 && (
        <Tarjeta className="space-y-1">
          <p className="text-sm text-stone-700">Total con este plan ({plan.grupos.length} {plan.grupos.length === 1 ? 'tienda' : 'tiendas'})</p>
          <p className="text-3xl font-bold">{pesos(plan.total)}</p>
          {plan.sinPrecio.length > 0 && <p className="text-sm text-stone-700">Sin contar {plan.sinPrecio.length === 1 ? nombre(plan.sinPrecio[0]) : `${plan.sinPrecio.length} productos`} que aún no {plan.sinPrecio.length === 1 ? 'tiene' : 'tienen'} precio.</p>}
          {plan.ahorro != null && plan.mejorUnica && (
            <p className={`font-medium ${plan.ahorro > 0 ? 'text-ok' : 'text-stone-700'}`}>
              {plan.ahorro > 0
                ? `Ahorras ${pesos(plan.ahorro)} frente a comprar todo en ${INFO_TIENDAS[plan.mejorUnica.tienda].nombre}`
                : `Lo más conveniente: todo en ${INFO_TIENDAS[plan.mejorUnica.tienda].nombre}`}
            </p>
          )}
          <button type="button" className="min-h-11 text-left text-sm text-stone-700" onClick={() => setEditandoPresupuesto(true)}>
            {compra?.presupuesto != null ? (
              <span className={plan.total > compra.presupuesto ? 'font-medium text-peligro' : ''}>
                Presupuesto {pesos(compra.presupuesto)}: {plan.total > compra.presupuesto ? `te faltarían ${pesos(plan.total - compra.presupuesto)}` : `te sobrarían ${pesos(compra.presupuesto - plan.total)}`}
                <span className="ml-1 text-marca">Cambiar</span>
              </span>
            ) : (
              <span className="text-marca">+ Poner presupuesto</span>
            )}
          </button>
        </Tarjeta>
      )}

      <AvisoSinVincular />
      <ActualizarPrecios />
      {compra && <BotonModoTienda className="w-full" />}

      {plan.grupos.map((g) => (
        <Tarjeta key={g.tienda} className="px-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <NombreTienda tienda={g.tienda} className="font-semibold" tam={22} />
            <span className="font-semibold">{pesos(g.total)}</span>
          </div>
          <ul className="divide-y divide-stone-100">
            {ordenados(g.items).map(({ id, costo, alternativa }) => {
              const d = porId.get(id)!
              const p = cat.producto.get(d.producto_id)!
              const e = costo.opcion.efectivo
              return (
                <li key={id}>
                  <button type="button" onClick={() => setAbierto(id)} className="flex w-full items-start justify-between gap-2 rounded-xl px-1 py-2 text-left active:bg-stone-100">
                    <span className="min-w-0">
                      <span className="block font-medium">{p.nombre}{d.tienda && <span className="ml-1 text-xs text-stone-600">(fijado)</span>}</span>
                      <span className="block truncate text-sm text-stone-700">
                        {costo.opcion.presentacion.granel ? formatoCantidadVisible(costo.paquetes, p.unidad_base) : `${costo.paquetes} ×`} {describirPresentacion(costo.opcion.presentacion, p)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-stone-700">
                        <Distintivo tipo={e.distintivo} amarillo={e.estado === 'amarillo'} dias={e.edadDias} />
                        {e.estado !== 'amarillo' && <span>{hace(diasEntre(e.fecha, ahora))}</span>}
                        {alternativa && alternativa.diferencia > 0 && (
                          <span>· {pesos(alternativa.diferencia)} menos que en {INFO_TIENDAS[alternativa.tienda].nombre}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold">{pesos(costo.costoReal)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      ))}

      {(plan.sinPrecio.length > 0 || libres.length > 0) && (
        <Tarjeta>
          <h2 className="mb-1 font-semibold">Sin precio en las tiendas de hoy</h2>
          <ul className="text-sm">
            {[...plan.sinPrecio].sort((a, b) => orden(porId.get(a)!.producto_id, porId.get(b)!.producto_id)).map((id) => (
              <li key={id}><a className="flex min-h-11 items-center text-marca underline" href={`#/producto/${encodeURIComponent(porId.get(id)!.producto_id)}`}>{nombre(id)} · anotar precio</a></li>
            ))}
            {libres.map((d) => <li key={d.detalle_id} className="py-1">{d.nombre_libre}</li>)}
          </ul>
        </Tarjeta>
      )}

      {items.length > 0 && plan.grupos.length > 0 && plan.todoEn.length > 1 && (
        <Tarjeta className="space-y-2 text-sm">
          <h2 className="text-base font-semibold">Si compraras todo en una sola tienda</h2>
          {plan.todoEn.map((x) => (
            <div key={x.tienda}>
              <div className="flex justify-between">
                <NombreTienda tienda={x.tienda} tam={18} />
                <span className="font-medium">{x.items ? pesos(x.total) : '—'}</span>
              </div>
              {x.items < x.de && x.items > 0 && (
                <p className="text-xs text-stone-700">
                  Le faltan {x.faltan.map(nombre).join(', ')}. En esos mismos {x.items} productos, este plan cuesta {pesos(x.planMismosItems)}.
                </p>
              )}
              {x.items === 0 && <p className="text-xs text-stone-700">No hay precios de esta tienda para tu compra.</p>}
            </div>
          ))}
          <p className="text-xs text-stone-600">Solo se propone ir a otra tienda si ahorras más de {pesos(cat.cfg.ahorroMinimoTienda)} por viaje (se cambia en Ajustes).</p>
        </Tarjeta>
      )}
      {compra && (items.length > 0 || libres.length > 0) && (
        <Boton variante="secundario" className="w-full" onClick={enviar}>Enviar la lista por WhatsApp</Boton>
      )}
      {compra && items.length > 0 && <a href="#/compra" className="flex min-h-11 items-center justify-center font-medium text-marca">Ir a comprar →</a>}

      <Hoja abierta={!!dAbierto && !!pAbierto} titulo={pAbierto?.nombre ?? ''} onCerrar={() => setAbierto(null)}>
        {dAbierto && pAbierto && (
          <HojaItemPlan d={dAbierto} producto={pAbierto} item={itemPorId.get(dAbierto.detalle_id)} tiendas={tiendasHoy} elegida={tiendaDe(dAbierto.detalle_id)} onListo={() => setAbierto(null)} />
        )}
      </Hoja>
      <Hoja abierta={editandoPresupuesto} titulo="Presupuesto de esta compra" onCerrar={() => setEditandoPresupuesto(false)} protegida>
        <EditarPresupuesto
          valor={compra?.presupuesto ?? null}
          onGuardar={async (v) => {
            const c = compra ?? (await asegurarCompra(tiendasHoy))
            await guardar('Compras', { ...c, presupuesto: v })
            setEditandoPresupuesto(false)
          }}
        />
      </Hoja>
    </section>
  )
}

export function EditarPresupuesto({ valor, onGuardar }: { valor: number | null; onGuardar: (v: number | null) => void | Promise<void> }) {
  const [texto, setTexto] = useState(valor != null ? String(valor) : '')
  const n = leerNumero(texto)
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void onGuardar(n && n > 0 ? Math.round(n) : null) }}>
      <Campo etiqueta="¿Cuánto tienes para este mercado?" inputMode="numeric" placeholder="Ej: 300.000" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus ayuda={n ? pesos(n) : 'Déjalo vacío para no usar presupuesto.'} />
      <Boton type="submit" className="w-full">Guardar</Boton>
    </form>
  )
}

